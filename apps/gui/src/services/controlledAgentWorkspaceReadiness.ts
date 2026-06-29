import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentWorkspaceReadinessState =
  | "disabled"
  | "needs_user_opt_in"
  | "unsupported_host"
  | "workspace_not_isolated"
  | "checkpoint_required"
  | "rollback_plan_required"
  | "ready_for_future_controlled_mode"
  | "blocked";

export type ControlledAgentWorkspaceReadinessDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unknown_or_invalid_field"
  | "unsafe_metadata"
  | "invalid_authority"
  | "execution_allowed"
  | "agent_start_allowed"
  | "assistant_opt_in"
  | "missing_user_opt_in"
  | "unsupported_host"
  | "workspace_not_isolated"
  | "checkpoint_required"
  | "rollback_plan_required";

export type ControlledAgentWorkspaceReadinessDiagnostic = {
  code: ControlledAgentWorkspaceReadinessDiagnosticCode;
  message: string;
};

export type ControlledAgentWorkspaceReadinessSummary = {
  state: ControlledAgentWorkspaceReadinessState;
  canStartAgent: false;
  canReadFiles: false;
  canWriteFiles: false;
  canRunCommands: false;
  canApplyEdits: false;
  canCallProvider: false;
  canUseGit: false;
  canAutoRollback: false;
  canStartAutonomousLoop: false;
  summary: string;
  diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

type WorkspaceMode = "none" | "disposable" | "worktree" | "existing";
type Host = "browser" | "vscode" | "jetbrains";

type OptIn = {
  origin: "user" | "assistant";
  confirmedBy: "user" | "assistant";
  confirmedAt: string;
  requestIdMintedBy: "gui" | "host" | "assistant";
  grantsStartAuthority: boolean;
  label?: string;
};

type Isolation = {
  status: "disabled" | "not_ready" | "ready" | "blocked";
  workspaceMode: WorkspaceMode;
  hostOwned: boolean;
  workspaceLabel: string;
  privatePathExposed: boolean;
  readinessId?: string;
};

type Checkpoint = {
  status: "not_applicable" | "missing" | "pending" | "verified" | "blocked";
  verified: boolean;
  metadataOnly: boolean;
  autoCreateAllowed: boolean;
  checkpointId?: string;
  checkedAt?: string;
  contentHash?: string;
  label?: string;
};

type Rollback = {
  status: "not_applicable" | "missing" | "planned" | "ready" | "blocked";
  metadataOnly: boolean;
  autoRollbackAllowed: boolean;
  requiresUserConfirmation: boolean;
  planId?: string;
  planHash?: string;
  label?: string;
};

type Limits = {
  maxSteps: number;
  maxTouchedFiles: number;
  maxPatchBytes: number;
  maxRuntimeSeconds: number;
  limitLabel?: string;
};

type PolicyFlags = {
  fileReadAllowed: boolean;
  fileWriteAllowed: boolean;
  shellAllowed: boolean;
  gitAllowed: boolean;
  providerAllowed: boolean;
  toolAllowed: boolean;
  autoStartAllowed: boolean;
  autoApplyAllowed: boolean;
  autoRunAllowed: boolean;
  autoRollbackAllowed: boolean;
};

type ReadinessRecord = {
  kind: "controlled_agent_workspace_readiness";
  version: "2026-06-29";
  authority: "metadata_only";
  cloudRequired: boolean;
  executionAllowed: boolean;
  agentStartAllowed: boolean;
  workspaceMode: WorkspaceMode;
  host: Host;
  optIn?: OptIn;
  isolation: Isolation;
  checkpoint: Checkpoint;
  rollback: Rollback;
  limits: Limits;
  policyFlags: PolicyFlags;
  summary: string;
};

const workspaceModes = new Set<unknown>(["none", "disposable", "worktree", "existing"]);
const hosts = new Set<unknown>(["browser", "vscode", "jetbrains"]);
const isolationStatuses = new Set<unknown>(["disabled", "not_ready", "ready", "blocked"]);
const checkpointStatuses = new Set<unknown>(["not_applicable", "missing", "pending", "verified", "blocked"]);
const rollbackStatuses = new Set<unknown>(["not_applicable", "missing", "planned", "ready", "blocked"]);
const topLevelKeys = new Set(["kind", "version", "authority", "cloudRequired", "executionAllowed", "agentStartAllowed", "workspaceMode", "host", "optIn", "isolation", "checkpoint", "rollback", "limits", "policyFlags", "summary"]);
const optInKeys = new Set(["origin", "confirmedBy", "confirmedAt", "requestIdMintedBy", "grantsStartAuthority", "label"]);
const isolationKeys = new Set(["status", "workspaceMode", "hostOwned", "workspaceLabel", "privatePathExposed", "readinessId"]);
const checkpointKeys = new Set(["status", "verified", "metadataOnly", "autoCreateAllowed", "checkpointId", "checkedAt", "contentHash", "label"]);
const rollbackKeys = new Set(["status", "metadataOnly", "autoRollbackAllowed", "requiresUserConfirmation", "planId", "planHash", "label"]);
const limitsKeys = new Set(["maxSteps", "maxTouchedFiles", "maxPatchBytes", "maxRuntimeSeconds", "limitLabel"]);
const policyFlagKeys = new Set(["fileReadAllowed", "fileWriteAllowed", "shellAllowed", "gitAllowed", "providerAllowed", "toolAllowed", "autoStartAllowed", "autoApplyAllowed", "autoRunAllowed", "autoRollbackAllowed"]);
const blockedKeyPattern = /^(?:command|cmd|cwd|env|environment|network|git|provider|tool|shell|rawcommand|raw_command|rawfile|raw_file|rawfilebody|raw_file_body|filebody|file_body|filecontents|file_contents|rawprompt|raw_prompt|rawdiff|raw_diff|rawlog|raw_log|rawoutput|raw_output|browserstorage|browser_storage|storagedump|storage_dump|stacktrace|stack_trace|callstack|hiddenread|hidden_read|hiddenscan|hidden_scan|hiddensearch|hidden_search|autoapply|auto_apply|autorun|auto_run|autostart|auto_start|autorollback|auto_rollback)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response)|browser[_ -]?storage|storage[_ -]?dump|stack[_ -]?trace|callstack|shell|command|cwd|\benv\b|\bgit\b|\btool\b|provider|network|hidden[_ -]?(?:scan|read|search)|auto[_ -]?(?:start|apply|run|rollback)|apply[_ -]?patch|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;

export function evaluateControlledAgentWorkspaceReadiness(input: unknown): ControlledAgentWorkspaceReadinessSummary {
  const diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push({ code: "missing_input", message: "Controlled workspace readiness metadata is absent and remains disabled." });
    return buildEvaluation("disabled", "Controlled workspace readiness is disabled.", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = parseReadiness(input, diagnostics);
  if (!metadata) {
    return buildEvaluation("blocked", "Controlled workspace readiness metadata is blocked because it is malformed.", diagnostics, { displayOnly: true });
  }

  validateAuthority(metadata, diagnostics);
  validatePolicyFlags(metadata.policyFlags, diagnostics);

  if (hasBlockingDiagnostics(diagnostics)) {
    return buildEvaluation("blocked", "Controlled workspace readiness metadata is blocked. Raw payload omitted.", diagnostics, buildDetails(metadata));
  }

  const state = determineState(metadata, diagnostics);
  if (hasBlockingDiagnostics(diagnostics)) {
    return buildEvaluation("blocked", "Controlled workspace readiness metadata is blocked. Raw payload omitted.", diagnostics, buildDetails(metadata));
  }

  return buildEvaluation(state, sanitizeBoundedText(metadata.summary || defaultSummary(state), 240, defaultSummary(state)), diagnostics, buildDetails(metadata));
}

function parseReadiness(input: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): ReadinessRecord | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace readiness metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, topLevelKeys, diagnostics, "readiness");

  const workspaceMode = workspaceModes.has(input.workspaceMode) ? input.workspaceMode as WorkspaceMode : undefined;
  const host = hosts.has(input.host) ? input.host as Host : undefined;
  const optIn = input.optIn === undefined ? undefined : parseOptIn(input.optIn, diagnostics);
  const isolation = parseIsolation(input.isolation, diagnostics);
  const checkpoint = parseCheckpoint(input.checkpoint, diagnostics);
  const rollback = parseRollback(input.rollback, diagnostics);
  const limits = parseLimits(input.limits, diagnostics);
  const policyFlags = parsePolicyFlags(input.policyFlags, diagnostics);

  if (input.kind !== "controlled_agent_workspace_readiness" || input.version !== "2026-06-29" || !workspaceMode || !host || !isolation || !checkpoint || !rollback || !limits || !policyFlags || typeof input.summary !== "string") {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace readiness metadata does not match the S73 contract." });
    return undefined;
  }

  return {
    kind: "controlled_agent_workspace_readiness",
    version: "2026-06-29",
    authority: input.authority === "metadata_only" ? "metadata_only" : input.authority as "metadata_only",
    cloudRequired: input.cloudRequired === false ? false : input.cloudRequired as boolean,
    executionAllowed: input.executionAllowed === false ? false : input.executionAllowed as boolean,
    agentStartAllowed: input.agentStartAllowed === false ? false : input.agentStartAllowed as boolean,
    workspaceMode,
    host,
    optIn,
    isolation,
    checkpoint,
    rollback,
    limits,
    policyFlags,
    summary: input.summary,
  };
}

function parseOptIn(input: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): OptIn | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace opt-in metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, optInKeys, diagnostics, "opt-in");
  const origin = input.origin === "user" || input.origin === "assistant" ? input.origin : undefined;
  const confirmedBy = input.confirmedBy === "user" || input.confirmedBy === "assistant" ? input.confirmedBy : undefined;
  const requestIdMintedBy = input.requestIdMintedBy === "gui" || input.requestIdMintedBy === "host" || input.requestIdMintedBy === "assistant" ? input.requestIdMintedBy : undefined;
  if (!origin || !confirmedBy || !requestIdMintedBy || typeof input.confirmedAt !== "string" || typeof input.grantsStartAuthority !== "boolean") {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace opt-in metadata is invalid." });
    return undefined;
  }
  return { origin, confirmedBy, confirmedAt: input.confirmedAt, requestIdMintedBy, grantsStartAuthority: input.grantsStartAuthority, label: typeof input.label === "string" ? input.label : undefined };
}

function parseIsolation(input: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): Isolation | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace isolation metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, isolationKeys, diagnostics, "isolation");
  const status = isolationStatuses.has(input.status) ? input.status as Isolation["status"] : undefined;
  const workspaceMode = workspaceModes.has(input.workspaceMode) ? input.workspaceMode as WorkspaceMode : undefined;
  if (!status || !workspaceMode || typeof input.hostOwned !== "boolean" || typeof input.workspaceLabel !== "string" || typeof input.privatePathExposed !== "boolean" || (input.readinessId !== undefined && (typeof input.readinessId !== "string" || !safeIdPattern.test(input.readinessId)))) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace isolation metadata is invalid." });
    return undefined;
  }
  return { status, workspaceMode, hostOwned: input.hostOwned, workspaceLabel: input.workspaceLabel, privatePathExposed: input.privatePathExposed, readinessId: input.readinessId };
}

function parseCheckpoint(input: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): Checkpoint | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace checkpoint metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, checkpointKeys, diagnostics, "checkpoint");
  const status = checkpointStatuses.has(input.status) ? input.status as Checkpoint["status"] : undefined;
  if (!status || typeof input.verified !== "boolean" || typeof input.metadataOnly !== "boolean" || typeof input.autoCreateAllowed !== "boolean" || !optionalSafeId(input.checkpointId) || !optionalSafeHash(input.contentHash) || (input.checkedAt !== undefined && typeof input.checkedAt !== "string")) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace checkpoint metadata is invalid." });
    return undefined;
  }
  return { status, verified: input.verified, metadataOnly: input.metadataOnly, autoCreateAllowed: input.autoCreateAllowed, checkpointId: input.checkpointId, checkedAt: input.checkedAt, contentHash: input.contentHash, label: typeof input.label === "string" ? input.label : undefined };
}

function parseRollback(input: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): Rollback | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace rollback metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, rollbackKeys, diagnostics, "rollback");
  const status = rollbackStatuses.has(input.status) ? input.status as Rollback["status"] : undefined;
  if (!status || typeof input.metadataOnly !== "boolean" || typeof input.autoRollbackAllowed !== "boolean" || typeof input.requiresUserConfirmation !== "boolean" || !optionalSafeId(input.planId) || !optionalSafeHash(input.planHash)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace rollback metadata is invalid." });
    return undefined;
  }
  return { status, metadataOnly: input.metadataOnly, autoRollbackAllowed: input.autoRollbackAllowed, requiresUserConfirmation: input.requiresUserConfirmation, planId: input.planId, planHash: input.planHash, label: typeof input.label === "string" ? input.label : undefined };
}

function parseLimits(input: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): Limits | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace limits metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, limitsKeys, diagnostics, "limits");
  if (!boundedInteger(input.maxSteps, 1, 20) || !boundedInteger(input.maxTouchedFiles, 0, 12) || !boundedInteger(input.maxPatchBytes, 0, 50000) || !boundedInteger(input.maxRuntimeSeconds, 1, 1800)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace limits metadata is outside allowed bounds." });
    return undefined;
  }
  return { maxSteps: input.maxSteps, maxTouchedFiles: input.maxTouchedFiles, maxPatchBytes: input.maxPatchBytes, maxRuntimeSeconds: input.maxRuntimeSeconds, limitLabel: typeof input.limitLabel === "string" ? input.limitLabel : undefined };
}

function parsePolicyFlags(input: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): PolicyFlags | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled workspace policy flags must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, policyFlagKeys, diagnostics, "policy flags");
  for (const key of policyFlagKeys) {
    if (typeof input[key] !== "boolean") {
      diagnostics.push({ code: "malformed_input", message: "Controlled workspace policy flags are invalid." });
      return undefined;
    }
  }
  return input as PolicyFlags;
}

function validateAuthority(metadata: ReadinessRecord, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): void {
  if (metadata.authority !== "metadata_only" || metadata.cloudRequired !== false) {
    diagnostics.push({ code: "invalid_authority", message: "Controlled workspace readiness metadata must remain metadata-only and local-first." });
  }
  if (metadata.executionAllowed !== false) {
    diagnostics.push({ code: "execution_allowed", message: "Controlled workspace readiness metadata cannot allow execution." });
  }
  if (metadata.agentStartAllowed !== false) {
    diagnostics.push({ code: "agent_start_allowed", message: "Controlled workspace readiness metadata cannot allow agent start." });
  }
  if (metadata.optIn && metadata.optIn.grantsStartAuthority !== false) {
    diagnostics.push({ code: "agent_start_allowed", message: "Controlled workspace opt-in cannot grant start authority." });
  }
  if (metadata.checkpoint.metadataOnly !== true || metadata.checkpoint.autoCreateAllowed !== false || metadata.rollback.metadataOnly !== true || metadata.rollback.autoRollbackAllowed !== false) {
    diagnostics.push({ code: "invalid_authority", message: "Controlled workspace checkpoint and rollback metadata cannot grant automatic authority." });
  }
}

function validatePolicyFlags(policyFlags: PolicyFlags, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): void {
  if (Object.values(policyFlags).some((value) => value !== false)) {
    diagnostics.push({ code: "invalid_authority", message: "Controlled workspace policy flags must all be false." });
  }
}

function determineState(metadata: ReadinessRecord, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): ControlledAgentWorkspaceReadinessState {
  if (metadata.workspaceMode === "none") {
    if (metadata.isolation.status !== "disabled" || metadata.isolation.workspaceMode !== "none" || metadata.checkpoint.status !== "not_applicable" || metadata.rollback.status !== "not_applicable") {
      diagnostics.push({ code: "workspace_not_isolated", message: "Disabled controlled workspace metadata must not describe an active workspace." });
      return "workspace_not_isolated";
    }
    return "disabled";
  }

  if (!metadata.optIn || !isValidUserOptIn(metadata.optIn)) {
    if (metadata.optIn && (metadata.optIn.origin === "assistant" || metadata.optIn.confirmedBy === "assistant" || metadata.optIn.requestIdMintedBy === "assistant")) {
      diagnostics.push({ code: "assistant_opt_in", message: "Assistant-origin opt-in cannot enable controlled workspace readiness." });
    } else {
      diagnostics.push({ code: "missing_user_opt_in", message: "Controlled workspace readiness requires explicit user opt-in metadata." });
    }
    return metadata.optIn ? "blocked" : "needs_user_opt_in";
  }

  if (metadata.host === "browser") {
    diagnostics.push({ code: "unsupported_host", message: "Browser preview cannot support controlled workspace readiness." });
    return "unsupported_host";
  }

  if (metadata.isolation.status !== "ready" || metadata.isolation.workspaceMode !== metadata.workspaceMode || metadata.isolation.hostOwned !== true || metadata.isolation.privatePathExposed !== false || metadata.workspaceMode === "existing") {
    diagnostics.push({ code: "workspace_not_isolated", message: "Controlled workspace readiness requires an isolated host-owned disposable workspace or worktree." });
    return "workspace_not_isolated";
  }

  if (metadata.checkpoint.status !== "verified" || metadata.checkpoint.verified !== true) {
    diagnostics.push({ code: "checkpoint_required", message: "Controlled workspace readiness requires verified checkpoint metadata." });
    return "checkpoint_required";
  }

  if ((metadata.rollback.status !== "planned" && metadata.rollback.status !== "ready") || metadata.rollback.requiresUserConfirmation !== true) {
    diagnostics.push({ code: "rollback_plan_required", message: "Controlled workspace readiness requires rollback plan metadata with user confirmation." });
    return "rollback_plan_required";
  }

  return "ready_for_future_controlled_mode";
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value) || unsafePathPattern.test(value)) {
      diagnostics.push({ code: "unsafe_metadata", message: `Unsafe controlled workspace metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.` });
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
        diagnostics.push({ code: "unsafe_metadata", message: `Unsupported controlled workspace metadata field ${sanitizeDisplayText(key)}.` });
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function buildDetails(metadata: ReadinessRecord): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({
    displayOnly: true,
    workspaceMode: metadata.workspaceMode,
    host: metadata.host,
    authority: metadata.authority,
    executionAllowed: metadata.executionAllowed,
    agentStartAllowed: metadata.agentStartAllowed,
    optInOrigin: metadata.optIn?.origin,
    requestIdMintedBy: metadata.optIn?.requestIdMintedBy,
    isolationStatus: metadata.isolation.status,
    workspaceLabel: metadata.isolation.workspaceLabel,
    checkpointStatus: metadata.checkpoint.status,
    checkpointVerified: metadata.checkpoint.verified,
    rollbackStatus: metadata.rollback.status,
    limits: [
      `maxSteps:${metadata.limits.maxSteps}`,
      `maxTouchedFiles:${metadata.limits.maxTouchedFiles}`,
      `maxPatchBytes:${metadata.limits.maxPatchBytes}`,
      `maxRuntimeSeconds:${metadata.limits.maxRuntimeSeconds}`,
    ],
  });
}

function buildEvaluation(state: ControlledAgentWorkspaceReadinessState, summary: string, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentWorkspaceReadinessSummary {
  const unsafeBlocked = diagnostics.some((item) => item.code === "unsafe_metadata");
  return {
    state,
    canStartAgent: false,
    canReadFiles: false,
    canWriteFiles: false,
    canRunCommands: false,
    canApplyEdits: false,
    canCallProvider: false,
    canUseGit: false,
    canAutoRollback: false,
    canStartAutonomousLoop: false,
    summary: sanitizeBoundedText(unsafeBlocked ? `${summary} [redacted]` : summary, 240, "Controlled workspace readiness is disabled."),
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: sanitizeBoundedText(item.message, 200, "Controlled workspace readiness blocked.") })).slice(0, 20),
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
      details[safeKey] = sanitizeBoundedText(value, 120, "[redacted]");
    } else if (typeof value === "number" && Number.isFinite(value)) {
      details[safeKey] = value;
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => sanitizeBoundedText(item, 80, "[redacted]")).slice(0, 8);
    }
  }
  return details;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>, diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[], label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported controlled workspace ${label} field ${sanitizeDisplayText(key)}.` });
    }
  }
}

function isValidUserOptIn(value: OptIn): boolean {
  return value.origin === "user" && value.confirmedBy === "user" && (value.requestIdMintedBy === "gui" || value.requestIdMintedBy === "host") && value.grantsStartAuthority === false;
}

function hasBlockingDiagnostics(diagnostics: ControlledAgentWorkspaceReadinessDiagnostic[]): boolean {
  return diagnostics.some((item) => item.code === "malformed_input" || item.code === "unknown_or_invalid_field" || item.code === "unsafe_metadata" || item.code === "invalid_authority" || item.code === "execution_allowed" || item.code === "agent_start_allowed" || item.code === "assistant_opt_in");
}

function optionalSafeId(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && safeIdPattern.test(value));
}

function optionalSafeHash(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && safeHashPattern.test(value));
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function sanitizeBoundedText(input: string, limit: number, fallback: string): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function defaultSummary(state: ControlledAgentWorkspaceReadinessState): string {
  if (state === "disabled") {
    return "Controlled workspace readiness is disabled.";
  }
  if (state === "needs_user_opt_in") {
    return "Controlled workspace readiness requires user opt-in.";
  }
  if (state === "unsupported_host") {
    return "Controlled workspace readiness is not supported in this host.";
  }
  if (state === "workspace_not_isolated") {
    return "Controlled workspace readiness requires an isolated workspace.";
  }
  if (state === "checkpoint_required") {
    return "Controlled workspace readiness requires verified checkpoint metadata.";
  }
  if (state === "rollback_plan_required") {
    return "Controlled workspace readiness requires rollback plan metadata.";
  }
  if (state === "ready_for_future_controlled_mode") {
    return "Controlled workspace readiness metadata is ready for future review only.";
  }
  return "Controlled workspace readiness metadata is blocked.";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
