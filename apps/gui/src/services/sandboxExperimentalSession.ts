import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type SandboxExperimentalSessionModeStatus = "disabled" | "opted_in" | "checkpoint_ready" | "rollback_ready" | "rollback_blocked" | "blocked";
export type SandboxExperimentalSessionDisplayState = SandboxExperimentalSessionModeStatus;
export type SandboxExperimentalSessionDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unknown_or_invalid_field"
  | "unsafe_metadata"
  | "default_enabled"
  | "cloud_required"
  | "invalid_authority"
  | "execution_allowed"
  | "missing_user_opt_in"
  | "assistant_opt_in"
  | "checkpoint_not_verified"
  | "rollback_plan_missing";

export type SandboxExperimentalSessionDiagnostic = {
  code: SandboxExperimentalSessionDiagnosticCode;
  message: string;
};

export type SandboxExperimentalSessionSummary = {
  state: SandboxExperimentalSessionDisplayState;
  allowedToExecute: false;
  canStartLoop: false;
  summary: string;
  diagnostics: SandboxExperimentalSessionDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

type UserOptIn = {
  origin: "user" | "assistant";
  confirmedBy: "user" | "assistant";
  confirmedAt: string;
  disposableWorkspaceAcknowledged: boolean;
  requestIdMintedBy: "gui" | "host" | "assistant";
  optInLabel?: string;
};

type Limits = {
  maxSteps: number;
  maxTouchedFiles: number;
  maxPatchBytes: number;
  maxRuntimeSeconds: number;
  workspaceRelativePaths?: string[];
};

type Checkpoint = {
  status: "missing" | "pending" | "verified" | "failed";
  checkpointId: string;
  createdAt: string;
  verified: boolean;
  fileCount: number;
  contentHash: string;
  label?: string;
};

type Rollback = {
  status: "not_ready" | "planned" | "ready" | "blocked";
  planId: string;
  planHash: string;
  affectedFileCount: number;
  requiresUserConfirmation: boolean;
  blockReason?: string;
  label?: string;
};

type SandboxExperimentalSessionRecord = {
  kind: "experimental_sandbox_session";
  version: "2026-06-21";
  mode: "sandbox_experimental";
  defaultEnabled: false;
  cloudRequired: false;
  authority: "metadata_only";
  executionAllowed: false;
  modeStatus: SandboxExperimentalSessionModeStatus;
  userOptIn?: UserOptIn;
  limits?: Limits;
  checkpoint?: Checkpoint;
  rollback?: Rollback;
  summary?: string;
};

const modeStatuses = new Set<unknown>(["disabled", "opted_in", "checkpoint_ready", "rollback_ready", "rollback_blocked", "blocked"]);
const topLevelKeys = new Set(["kind", "version", "mode", "defaultEnabled", "cloudRequired", "authority", "executionAllowed", "modeStatus", "userOptIn", "limits", "checkpoint", "rollback", "summary"]);
const userOptInKeys = new Set(["origin", "confirmedBy", "confirmedAt", "disposableWorkspaceAcknowledged", "requestIdMintedBy", "optInLabel"]);
const limitsKeys = new Set(["maxSteps", "maxTouchedFiles", "maxPatchBytes", "maxRuntimeSeconds", "workspaceRelativePaths"]);
const checkpointKeys = new Set(["status", "checkpointId", "createdAt", "verified", "fileCount", "contentHash", "label"]);
const rollbackKeys = new Set(["status", "planId", "planHash", "affectedFileCount", "requiresUserConfirmation", "blockReason", "label"]);
const blockedKeyPattern = /^(?:command|cmd|cwd|env|environment|network|git|provider|tool|shell|rawcommand|raw_command|rawfile|raw_file|rawfilebody|raw_file_body|filebody|file_body|filecontents|file_contents|rawprompt|raw_prompt|rawoutput|raw_output|stacktrace|stack_trace|callstack|hiddenread|hidden_read|hiddenscan|hidden_scan|hiddensearch|hidden_search|autoapply|auto_apply|autorun|auto_run|autorollback|auto_rollback)$/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const rawTextPattern = /raw[_ -]?(?:file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response)|stack[_ -]?trace|callstack|shell|command|cwd|\benv\b|\bgit\b|network|hidden[_ -]?(?:scan|read|search)|auto[_ -]?(?:apply|run|rollback)|apply[_ -]?patch/i;
const unsafePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)(?!.*(?:^|\/)(?:auth|authorization|bearer|cookie|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))(?!.*(?:^|\/)sk-(?:proj-)?[A-Za-z0-9_-]{8,})[^\u0000-\u001f\u007f-\u009f]+$/i;

export function evaluateSandboxExperimentalSession(input: unknown): SandboxExperimentalSessionSummary {
  const diagnostics: SandboxExperimentalSessionDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push({ code: "missing_input", message: "Sandbox metadata is absent and remains disabled." });
    return buildEvaluation("disabled", "Sandbox preview is disabled.", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const session = parseSession(input, diagnostics);
  if (!session) {
    return buildEvaluation("blocked", "Sandbox metadata is blocked because it is malformed.", diagnostics, { displayOnly: true });
  }

  if (session.defaultEnabled !== false) {
    diagnostics.push({ code: "default_enabled", message: "Sandbox metadata cannot be enabled by default." });
  }
  if (session.cloudRequired !== false) {
    diagnostics.push({ code: "cloud_required", message: "Sandbox metadata cannot require a hosted service." });
  }
  if (session.authority !== "metadata_only") {
    diagnostics.push({ code: "invalid_authority", message: "Sandbox metadata must be metadata only." });
  }
  if (session.executionAllowed !== false) {
    diagnostics.push({ code: "execution_allowed", message: "Sandbox metadata cannot allow execution." });
  }

  if (session.modeStatus !== "disabled") {
    if (!isValidUserOptIn(session.userOptIn) || !isValidLimits(session.limits)) {
      diagnostics.push({ code: "missing_user_opt_in", message: "Non-disabled sandbox metadata requires explicit user opt-in and bounded limits." });
    }
    if (session.userOptIn && (session.userOptIn.origin === "assistant" || session.userOptIn.confirmedBy === "assistant" || session.userOptIn.requestIdMintedBy === "assistant")) {
      diagnostics.push({ code: "assistant_opt_in", message: "Assistant-origin opt-in cannot enable sandbox readiness display." });
    }
  }

  if ((session.modeStatus === "checkpoint_ready" || session.modeStatus === "rollback_ready" || session.modeStatus === "rollback_blocked") && !isVerifiedCheckpoint(session.checkpoint)) {
    diagnostics.push({ code: "checkpoint_not_verified", message: "Checkpoint-ready display requires verified checkpoint metadata." });
  }
  if (session.modeStatus === "checkpoint_ready" && session.rollback?.status !== "planned") {
    diagnostics.push({ code: "rollback_plan_missing", message: "Checkpoint-ready display requires rollback plan metadata." });
  }
  if (session.modeStatus === "rollback_ready" && session.rollback?.status !== "ready") {
    diagnostics.push({ code: "rollback_plan_missing", message: "Rollback-ready display requires ready rollback plan metadata." });
  }
  if (session.modeStatus === "rollback_blocked" && (session.rollback?.status !== "blocked" || !session.rollback.blockReason)) {
    diagnostics.push({ code: "rollback_plan_missing", message: "Rollback-blocked display requires blocked rollback plan metadata." });
  }

  const details = buildDetails(session);
  const safeSummary = sanitizeBoundedText(session.summary ?? defaultSummary(session.modeStatus), 280, defaultSummary(session.modeStatus));
  if (diagnostics.length > 0) {
    return buildEvaluation("blocked", "Sandbox metadata is blocked. Raw payload omitted.", diagnostics, details);
  }
  return buildEvaluation(session.modeStatus, safeSummary, diagnostics, details);
}

function parseSession(input: unknown, diagnostics: SandboxExperimentalSessionDiagnostic[]): SandboxExperimentalSessionRecord | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox metadata must be an object." });
    return undefined;
  }
  for (const key of Object.keys(input)) {
    if (!topLevelKeys.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported sandbox field ${sanitizeDisplayText(key)}.` });
    }
  }
  const modeStatus = modeStatuses.has(input.modeStatus) ? input.modeStatus as SandboxExperimentalSessionModeStatus : undefined;
  if (input.kind !== "experimental_sandbox_session" || input.version !== "2026-06-21" || input.mode !== "sandbox_experimental" || !modeStatus) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox metadata does not match the experimental session contract." });
    return undefined;
  }

  const userOptIn = input.userOptIn === undefined ? undefined : parseUserOptIn(input.userOptIn, diagnostics);
  const limits = input.limits === undefined ? undefined : parseLimits(input.limits, diagnostics);
  const checkpoint = input.checkpoint === undefined ? undefined : parseCheckpoint(input.checkpoint, diagnostics);
  const rollback = input.rollback === undefined ? undefined : parseRollback(input.rollback, diagnostics);
  return {
    kind: "experimental_sandbox_session",
    version: "2026-06-21",
    mode: "sandbox_experimental",
    defaultEnabled: input.defaultEnabled === false ? false : input.defaultEnabled as false,
    cloudRequired: input.cloudRequired === false ? false : input.cloudRequired as false,
    authority: input.authority === "metadata_only" ? "metadata_only" : input.authority as "metadata_only",
    executionAllowed: input.executionAllowed === false ? false : input.executionAllowed as false,
    modeStatus,
    userOptIn,
    limits,
    checkpoint,
    rollback,
    summary: typeof input.summary === "string" ? input.summary : undefined,
  };
}

function parseUserOptIn(input: unknown, diagnostics: SandboxExperimentalSessionDiagnostic[]): UserOptIn | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox user opt-in must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, userOptInKeys, diagnostics);
  const origin = input.origin === "user" || input.origin === "assistant" ? input.origin : undefined;
  const confirmedBy = input.confirmedBy === "user" || input.confirmedBy === "assistant" ? input.confirmedBy : undefined;
  const requestIdMintedBy = input.requestIdMintedBy === "gui" || input.requestIdMintedBy === "host" || input.requestIdMintedBy === "assistant" ? input.requestIdMintedBy : undefined;
  if (!origin || !confirmedBy || !requestIdMintedBy || typeof input.confirmedAt !== "string" || input.disposableWorkspaceAcknowledged !== true) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox user opt-in metadata is invalid." });
    return undefined;
  }
  return { origin, confirmedBy, confirmedAt: input.confirmedAt, disposableWorkspaceAcknowledged: true, requestIdMintedBy, optInLabel: typeof input.optInLabel === "string" ? input.optInLabel : undefined };
}

function parseLimits(input: unknown, diagnostics: SandboxExperimentalSessionDiagnostic[]): Limits | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox limits must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, limitsKeys, diagnostics);
  const workspaceRelativePaths = input.workspaceRelativePaths === undefined ? undefined : parseWorkspacePaths(input.workspaceRelativePaths, diagnostics);
  if (!boundedInteger(input.maxSteps, 1, 20) || !boundedInteger(input.maxTouchedFiles, 1, 12) || !boundedInteger(input.maxPatchBytes, 1, 50000) || !boundedInteger(input.maxRuntimeSeconds, 1, 1800)) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox limits are outside allowed bounds." });
    return undefined;
  }
  return { maxSteps: input.maxSteps, maxTouchedFiles: input.maxTouchedFiles, maxPatchBytes: input.maxPatchBytes, maxRuntimeSeconds: input.maxRuntimeSeconds, workspaceRelativePaths };
}

function parseCheckpoint(input: unknown, diagnostics: SandboxExperimentalSessionDiagnostic[]): Checkpoint | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox checkpoint must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, checkpointKeys, diagnostics);
  if ((input.status !== "missing" && input.status !== "pending" && input.status !== "verified" && input.status !== "failed") || typeof input.checkpointId !== "string" || typeof input.createdAt !== "string" || typeof input.verified !== "boolean" || !boundedInteger(input.fileCount, 0, 200) || typeof input.contentHash !== "string") {
    diagnostics.push({ code: "malformed_input", message: "Sandbox checkpoint metadata is invalid." });
    return undefined;
  }
  return { status: input.status, checkpointId: input.checkpointId, createdAt: input.createdAt, verified: input.verified, fileCount: input.fileCount, contentHash: input.contentHash, label: typeof input.label === "string" ? input.label : undefined };
}

function parseRollback(input: unknown, diagnostics: SandboxExperimentalSessionDiagnostic[]): Rollback | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox rollback must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, rollbackKeys, diagnostics);
  if ((input.status !== "not_ready" && input.status !== "planned" && input.status !== "ready" && input.status !== "blocked") || typeof input.planId !== "string" || typeof input.planHash !== "string" || !boundedInteger(input.affectedFileCount, 0, 200) || input.requiresUserConfirmation !== true) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox rollback metadata is invalid." });
    return undefined;
  }
  return { status: input.status, planId: input.planId, planHash: input.planHash, affectedFileCount: input.affectedFileCount, requiresUserConfirmation: true, blockReason: typeof input.blockReason === "string" ? input.blockReason : undefined, label: typeof input.label === "string" ? input.label : undefined };
}

function scanUnsafeMetadata(value: unknown, diagnostics: SandboxExperimentalSessionDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (secretTextPattern.test(value) || rawTextPattern.test(value) || unsafePathPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push({ code: "unsafe_metadata", message: `Unsafe sandbox metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.` });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (blockedKeyPattern.test(key)) {
        diagnostics.push({ code: "unsafe_metadata", message: `Unsupported sandbox metadata field ${sanitizeDisplayText(key)}.` });
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function parseWorkspacePaths(input: unknown, diagnostics: SandboxExperimentalSessionDiagnostic[]): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 12) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox workspace paths must be a bounded array." });
    return undefined;
  }
  const paths: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || item.length > 240 || !safeRelativePathPattern.test(item) || paths.includes(item)) {
      diagnostics.push({ code: "unsafe_metadata", message: "Sandbox workspace paths must be safe relative paths." });
      continue;
    }
    paths.push(item);
  }
  return paths.length > 0 ? paths : undefined;
}

function buildDetails(session: SandboxExperimentalSessionRecord): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({
    displayOnly: true,
    modeStatus: session.modeStatus,
    authority: session.authority,
    defaultEnabled: session.defaultEnabled,
    cloudRequired: session.cloudRequired,
    executionAllowed: session.executionAllowed,
    userOptInOrigin: session.userOptIn?.origin,
    requestIdMintedBy: session.userOptIn?.requestIdMintedBy,
    limits: session.limits ? [
      `maxSteps:${session.limits.maxSteps}`,
      `maxTouchedFiles:${session.limits.maxTouchedFiles}`,
      `maxPatchBytes:${session.limits.maxPatchBytes}`,
      `maxRuntimeSeconds:${session.limits.maxRuntimeSeconds}`,
    ] : undefined,
    workspaceRelativePaths: session.limits?.workspaceRelativePaths,
    checkpointStatus: session.checkpoint?.status,
    checkpointVerified: session.checkpoint?.verified,
    checkpointFileCount: session.checkpoint?.fileCount,
    rollbackStatus: session.rollback?.status,
    rollbackAffectedFileCount: session.rollback?.affectedFileCount,
  });
}

function buildEvaluation(state: SandboxExperimentalSessionDisplayState, summary: string, diagnostics: SandboxExperimentalSessionDiagnostic[], details: Record<string, string | number | boolean | string[]>): SandboxExperimentalSessionSummary {
  const unsafeBlocked = diagnostics.some((item) => item.code === "unsafe_metadata");
  return {
    state,
    allowedToExecute: false,
    canStartLoop: false,
    summary: sanitizeBoundedText(unsafeBlocked ? `${summary} [redacted]` : summary, 280, "Sandbox preview is disabled."),
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: sanitizeBoundedText(item.message, 200, "Sandbox metadata blocked.") })).slice(0, 20),
    details,
  };
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 24)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") {
      details[safeKey] = sanitizeBoundedText(value, 160, "[redacted]");
    } else if (typeof value === "number" && Number.isFinite(value)) {
      details[safeKey] = value;
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => sanitizeBoundedText(item, 120, "[redacted]")).slice(0, 12);
    }
  }
  return details;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>, diagnostics: SandboxExperimentalSessionDiagnostic[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported sandbox field ${sanitizeDisplayText(key)}.` });
    }
  }
}

function isValidUserOptIn(value: UserOptIn | undefined): value is UserOptIn {
  return value?.origin === "user" && value.confirmedBy === "user" && value.disposableWorkspaceAcknowledged === true && (value.requestIdMintedBy === "gui" || value.requestIdMintedBy === "host");
}

function isValidLimits(value: Limits | undefined): value is Limits {
  return value !== undefined;
}

function isVerifiedCheckpoint(value: Checkpoint | undefined): boolean {
  return value?.status === "verified" && value.verified === true;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function sanitizeBoundedText(input: string, limit: number, fallback: string): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function defaultSummary(status: SandboxExperimentalSessionModeStatus): string {
  if (status === "disabled") {
    return "Sandbox preview is disabled.";
  }
  if (status === "checkpoint_ready") {
    return "Sandbox checkpoint metadata is ready for display.";
  }
  if (status === "rollback_ready") {
    return "Sandbox rollback metadata is ready for display.";
  }
  if (status === "rollback_blocked") {
    return "Sandbox rollback metadata is blocked pending review.";
  }
  if (status === "blocked") {
    return "Sandbox metadata is blocked.";
  }
  return "Sandbox metadata is opted in for display only.";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
