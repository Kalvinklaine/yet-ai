import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentFileReadState = "disabled" | "blocked" | "success" | "truncated";

export type ControlledAgentFileReadDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unknown_or_invalid_field"
  | "unsafe_metadata"
  | "invalid_authority"
  | "assistant_authority"
  | "workspace_not_controlled"
  | "unsafe_path"
  | "unbounded_request"
  | "unsafe_body";

export type ControlledAgentFileReadDiagnostic = {
  code: ControlledAgentFileReadDiagnosticCode;
  message: string;
};

export type ControlledAgentFileReadPreview = {
  pathLabel: string;
  byteCount: number;
  lineCount: number;
  contentHash: string;
  truncated: boolean;
  text?: string;
};

export type ControlledAgentFileReadSummary = {
  state: ControlledAgentFileReadState;
  allowedToRead: boolean;
  canReadHiddenFiles: false;
  canSearchWorkspace: false;
  canRunCommands: false;
  canWriteFiles: false;
  canUseGit: false;
  canCallProvider: false;
  canUseTools: false;
  summary: string;
  diagnostics: ControlledAgentFileReadDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  preview?: ControlledAgentFileReadPreview;
};

type WorkspaceMode = "disposable" | "worktree" | "existing";
type Host = "vscode" | "jetbrains";
type RequestSource = "gui" | "host";
type ReadStatus = "disabled" | "blocked" | "success" | "truncated";
type BlockedReason = "read_disabled" | "policy_denied" | "unsafe_path" | "outside_workspace" | "hidden_path" | "dependency_path" | "generated_path" | "binary_file" | "symlink_denied" | "too_large" | "budget_exceeded";

type FileReadWorkspace = {
  controlledWorkspaceId: string;
  runId: string;
  workspaceMode: WorkspaceMode;
  host: Host;
  privatePathExposed: boolean;
  workspaceLabel?: string;
};

type FileReadBudget = {
  scope: "single_explicit_file";
  maxBytes: number;
  maxLines: number;
  allowBody: boolean;
  singleFileOnly: boolean;
  recursive: boolean;
  globAllowed: boolean;
  regexAllowed: boolean;
  indexingAllowed: boolean;
  budgetLabel?: string;
};

type FileReadRequest = {
  requestId: string;
  source: RequestSource;
  requestIdMintedBy: RequestSource;
  assistantMinted: boolean;
  workspaceRelativePath: string;
  textOnly: boolean;
  maxBytes: number;
  budget: FileReadBudget;
  requestedAt?: string;
  reason?: string;
};

type FileReadPolicyFlags = {
  fileReadAllowed: boolean;
  fileWriteAllowed: boolean;
  shellAllowed: boolean;
  gitAllowed: boolean;
  providerAllowed: boolean;
  toolAllowed: boolean;
  hiddenSearchAllowed: boolean;
  indexingAllowed: boolean;
  binaryReadAllowed: boolean;
  symlinkAllowed: boolean;
  autoStartAllowed: boolean;
  autoApplyAllowed: boolean;
  autoRunAllowed: boolean;
};

type FileReadResult = {
  status: ReadStatus;
  cloudRequired: boolean;
  executionAllowed: boolean;
  bodyIncluded: boolean;
  truncated: boolean;
  sanitizedPathLabel?: string;
  byteCount?: number;
  lineCount?: number;
  contentHash?: string;
  text?: string;
  blockedReason?: BlockedReason;
  message: string;
};

type FileReadRecord = {
  kind: "controlled_agent_file_read";
  version: "2026-06-29";
  authority: "bounded_text_file_read";
  cloudRequired: boolean;
  executionAllowed: boolean;
  agentStartAllowed: boolean;
  workspace: FileReadWorkspace;
  request: FileReadRequest;
  policyFlags: FileReadPolicyFlags;
  result: FileReadResult;
};

const topLevelKeys = new Set(["kind", "version", "authority", "cloudRequired", "executionAllowed", "agentStartAllowed", "workspace", "request", "policyFlags", "result"]);
const workspaceKeys = new Set(["controlledWorkspaceId", "runId", "workspaceMode", "host", "privatePathExposed", "workspaceLabel"]);
const requestKeys = new Set(["requestId", "source", "requestIdMintedBy", "assistantMinted", "workspaceRelativePath", "textOnly", "maxBytes", "budget", "requestedAt", "reason"]);
const budgetKeys = new Set(["scope", "maxBytes", "maxLines", "allowBody", "singleFileOnly", "recursive", "globAllowed", "regexAllowed", "indexingAllowed", "budgetLabel"]);
const policyFlagKeys = new Set(["fileReadAllowed", "fileWriteAllowed", "shellAllowed", "gitAllowed", "providerAllowed", "toolAllowed", "hiddenSearchAllowed", "indexingAllowed", "binaryReadAllowed", "symlinkAllowed", "autoStartAllowed", "autoApplyAllowed", "autoRunAllowed"]);
const resultKeys = new Set(["status", "cloudRequired", "executionAllowed", "bodyIncluded", "truncated", "sanitizedPathLabel", "byteCount", "lineCount", "contentHash", "text", "blockedReason", "message"]);
const workspaceModes = new Set<unknown>(["disposable", "worktree", "existing"]);
const hosts = new Set<unknown>(["vscode", "jetbrains"]);
const sources = new Set<unknown>(["gui", "host"]);
const statuses = new Set<unknown>(["disabled", "blocked", "success", "truncated"]);
const blockedReasons = new Set<unknown>(["read_disabled", "policy_denied", "unsafe_path", "outside_workspace", "hidden_path", "dependency_path", "generated_path", "binary_file", "symlink_denied", "too_large", "budget_exceeded"]);
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const safeRelativePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const blockedKeyPattern = /^(?:command|cmd|cwd|env|environment|network|git|provider|tool|shell|rawcommand|raw_command|rawfile|raw_file|rawfilebody|raw_file_body|filebody|file_body|filecontents|file_contents|rawprompt|raw_prompt|rawdiff|raw_diff|rawlog|raw_log|rawoutput|raw_output|browserstorage|browser_storage|storagedump|storage_dump|hiddenread|hidden_read|hiddenscan|hidden_scan|hiddensearch|hidden_search|search|glob|regex|index|indexing|autoapply|auto_apply|autorun|auto_run|autostart|auto_start)$/i;

export function evaluateControlledAgentFileRead(input: unknown): ControlledAgentFileReadSummary {
  const diagnostics: ControlledAgentFileReadDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push({ code: "missing_input", message: "Controlled file read metadata is absent and remains disabled." });
    return buildEvaluation("disabled", false, "Controlled file read is disabled.", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = parseFileRead(input, diagnostics);
  if (!metadata) {
    return buildEvaluation("blocked", false, "Controlled file read metadata is blocked because it is malformed.", diagnostics, { displayOnly: true });
  }

  validateFileRead(metadata, diagnostics);
  const details = buildDetails(metadata);
  if (hasBlockingDiagnostics(diagnostics)) {
    return buildEvaluation("blocked", false, "Controlled file read metadata is blocked. Raw payload omitted.", diagnostics, details);
  }

  const allowedToRead = (metadata.result.status === "success" || metadata.result.status === "truncated") && metadata.policyFlags.fileReadAllowed === true;
  const preview = allowedToRead ? buildPreview(metadata, diagnostics) : undefined;
  if (hasBlockingDiagnostics(diagnostics)) {
    return buildEvaluation("blocked", false, "Controlled file read metadata is blocked. Raw payload omitted.", diagnostics, details);
  }

  return buildEvaluation(metadata.result.status, allowedToRead, sanitizeBoundedText(metadata.result.message, 240, defaultSummary(metadata.result.status)), diagnostics, details, preview);
}

function parseFileRead(input: unknown, diagnostics: ControlledAgentFileReadDiagnostic[]): FileReadRecord | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, topLevelKeys, diagnostics, "file read");
  const workspace = parseWorkspace(input.workspace, diagnostics);
  const request = parseRequest(input.request, diagnostics);
  const policyFlags = parsePolicyFlags(input.policyFlags, diagnostics);
  const result = parseResult(input.result, diagnostics);
  if (input.kind !== "controlled_agent_file_read" || input.version !== "2026-06-29" || input.authority !== "bounded_text_file_read" || !workspace || !request || !policyFlags || !result) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read metadata does not match the S74 contract." });
    return undefined;
  }
  return {
    kind: "controlled_agent_file_read",
    version: "2026-06-29",
    authority: "bounded_text_file_read",
    cloudRequired: input.cloudRequired === false ? false : input.cloudRequired as boolean,
    executionAllowed: input.executionAllowed === false ? false : input.executionAllowed as boolean,
    agentStartAllowed: input.agentStartAllowed === false ? false : input.agentStartAllowed as boolean,
    workspace,
    request,
    policyFlags,
    result,
  };
}

function parseWorkspace(input: unknown, diagnostics: ControlledAgentFileReadDiagnostic[]): FileReadWorkspace | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read workspace metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, workspaceKeys, diagnostics, "workspace");
  const workspaceMode = workspaceModes.has(input.workspaceMode) ? input.workspaceMode as WorkspaceMode : undefined;
  const host = hosts.has(input.host) ? input.host as Host : undefined;
  if (!safeId(input.controlledWorkspaceId) || !safeId(input.runId) || !workspaceMode || !host || typeof input.privatePathExposed !== "boolean") {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read workspace metadata is invalid." });
    return undefined;
  }
  return { controlledWorkspaceId: input.controlledWorkspaceId, runId: input.runId, workspaceMode, host, privatePathExposed: input.privatePathExposed, workspaceLabel: typeof input.workspaceLabel === "string" ? input.workspaceLabel : undefined };
}

function parseRequest(input: unknown, diagnostics: ControlledAgentFileReadDiagnostic[]): FileReadRequest | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read request metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, requestKeys, diagnostics, "request");
  const source = sources.has(input.source) ? input.source as RequestSource : undefined;
  const requestIdMintedBy = sources.has(input.requestIdMintedBy) ? input.requestIdMintedBy as RequestSource : undefined;
  const budget = parseBudget(input.budget, diagnostics);
  if (!safeId(input.requestId) || !source || !requestIdMintedBy || typeof input.assistantMinted !== "boolean" || typeof input.workspaceRelativePath !== "string" || typeof input.textOnly !== "boolean" || !boundedInteger(input.maxBytes, 1, 8192) || !budget || (input.requestedAt !== undefined && typeof input.requestedAt !== "string")) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read request metadata is invalid." });
    return undefined;
  }
  return { requestId: input.requestId, source, requestIdMintedBy, assistantMinted: input.assistantMinted, workspaceRelativePath: input.workspaceRelativePath, textOnly: input.textOnly, maxBytes: input.maxBytes, budget, requestedAt: input.requestedAt, reason: typeof input.reason === "string" ? input.reason : undefined };
}

function parseBudget(input: unknown, diagnostics: ControlledAgentFileReadDiagnostic[]): FileReadBudget | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read budget metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, budgetKeys, diagnostics, "budget");
  if (input.scope !== "single_explicit_file" || !boundedInteger(input.maxBytes, 1, 8192) || !boundedInteger(input.maxLines, 1, 240) || typeof input.allowBody !== "boolean" || typeof input.singleFileOnly !== "boolean" || typeof input.recursive !== "boolean" || typeof input.globAllowed !== "boolean" || typeof input.regexAllowed !== "boolean" || typeof input.indexingAllowed !== "boolean") {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read budget metadata is invalid." });
    return undefined;
  }
  return { scope: "single_explicit_file", maxBytes: input.maxBytes, maxLines: input.maxLines, allowBody: input.allowBody, singleFileOnly: input.singleFileOnly, recursive: input.recursive, globAllowed: input.globAllowed, regexAllowed: input.regexAllowed, indexingAllowed: input.indexingAllowed, budgetLabel: typeof input.budgetLabel === "string" ? input.budgetLabel : undefined };
}

function parsePolicyFlags(input: unknown, diagnostics: ControlledAgentFileReadDiagnostic[]): FileReadPolicyFlags | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read policy flags must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, policyFlagKeys, diagnostics, "policy flags");
  for (const key of policyFlagKeys) {
    if (typeof input[key] !== "boolean") {
      diagnostics.push({ code: "malformed_input", message: "Controlled file read policy flags are invalid." });
      return undefined;
    }
  }
  return input as FileReadPolicyFlags;
}

function parseResult(input: unknown, diagnostics: ControlledAgentFileReadDiagnostic[]): FileReadResult | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read result metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, resultKeys, diagnostics, "result");
  const status = statuses.has(input.status) ? input.status as ReadStatus : undefined;
  const blockedReason = input.blockedReason === undefined ? undefined : blockedReasons.has(input.blockedReason) ? input.blockedReason as BlockedReason : undefined;
  if (!status || typeof input.cloudRequired !== "boolean" || typeof input.executionAllowed !== "boolean" || typeof input.bodyIncluded !== "boolean" || typeof input.truncated !== "boolean" || typeof input.message !== "string" || (input.blockedReason !== undefined && !blockedReason) || (input.sanitizedPathLabel !== undefined && typeof input.sanitizedPathLabel !== "string") || (input.byteCount !== undefined && !boundedInteger(input.byteCount, 0, 8192)) || (input.lineCount !== undefined && !boundedInteger(input.lineCount, 0, 240)) || (input.contentHash !== undefined && (typeof input.contentHash !== "string" || !safeHashPattern.test(input.contentHash))) || (input.text !== undefined && typeof input.text !== "string")) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read result metadata is invalid." });
    return undefined;
  }
  return { status, cloudRequired: input.cloudRequired, executionAllowed: input.executionAllowed, bodyIncluded: input.bodyIncluded, truncated: input.truncated, sanitizedPathLabel: input.sanitizedPathLabel, byteCount: input.byteCount, lineCount: input.lineCount, contentHash: input.contentHash, text: input.text, blockedReason, message: input.message };
}

function validateFileRead(metadata: FileReadRecord, diagnostics: ControlledAgentFileReadDiagnostic[]): void {
  if (metadata.cloudRequired !== false || metadata.executionAllowed !== false || metadata.agentStartAllowed !== false || metadata.result.cloudRequired !== false || metadata.result.executionAllowed !== false) {
    diagnostics.push({ code: "invalid_authority", message: "Controlled file read metadata cannot require cloud, execution, or agent start authority." });
  }
  if (metadata.request.assistantMinted || metadata.request.requestId.toLowerCase().includes("assistant")) {
    diagnostics.push({ code: "assistant_authority", message: "Assistant-minted controlled file read requests cannot grant read eligibility." });
  }
  if (metadata.workspace.privatePathExposed !== false || metadata.workspace.workspaceMode === "existing") {
    diagnostics.push({ code: "workspace_not_controlled", message: "Controlled file read requires an isolated host-owned disposable workspace or worktree." });
  }
  if (!safeRelativePathPattern.test(metadata.request.workspaceRelativePath) || (metadata.result.sanitizedPathLabel !== undefined && !safeRelativePathPattern.test(metadata.result.sanitizedPathLabel))) {
    diagnostics.push({ code: "unsafe_path", message: "Controlled file read path must be a safe workspace-relative text path." });
  }
  if (metadata.result.sanitizedPathLabel !== undefined && metadata.result.sanitizedPathLabel !== metadata.request.workspaceRelativePath) {
    diagnostics.push({ code: "unsafe_path", message: "Controlled file read result path label must match the requested path." });
  }
  if (metadata.request.textOnly !== true || metadata.request.maxBytes !== metadata.request.budget.maxBytes || metadata.request.budget.singleFileOnly !== true || metadata.request.budget.recursive !== false || metadata.request.budget.globAllowed !== false || metadata.request.budget.regexAllowed !== false || metadata.request.budget.indexingAllowed !== false) {
    diagnostics.push({ code: "unbounded_request", message: "Controlled file read requires one explicit bounded text file with search and indexing disabled." });
  }
  validatePolicyFlags(metadata.policyFlags, diagnostics);
  validateResult(metadata, diagnostics);
}

function validatePolicyFlags(policyFlags: FileReadPolicyFlags, diagnostics: ControlledAgentFileReadDiagnostic[]): void {
  const deniedFlags = [policyFlags.fileWriteAllowed, policyFlags.shellAllowed, policyFlags.gitAllowed, policyFlags.providerAllowed, policyFlags.toolAllowed, policyFlags.hiddenSearchAllowed, policyFlags.indexingAllowed, policyFlags.binaryReadAllowed, policyFlags.symlinkAllowed, policyFlags.autoStartAllowed, policyFlags.autoApplyAllowed, policyFlags.autoRunAllowed];
  if (deniedFlags.some((value) => value !== false)) {
    diagnostics.push({ code: "invalid_authority", message: "Controlled file read policy flags cannot grant write, command, git, provider, tool, hidden, binary, symlink, or automation authority." });
  }
}

function validateResult(metadata: FileReadRecord, diagnostics: ControlledAgentFileReadDiagnostic[]): void {
  const result = metadata.result;
  if (result.status === "disabled" || result.status === "blocked") {
    if (result.bodyIncluded !== false || result.truncated !== false || result.text !== undefined || !result.blockedReason) {
      diagnostics.push({ code: "invalid_authority", message: "Disabled or blocked controlled file reads cannot include file body metadata." });
    }
    return;
  }
  if (!metadata.policyFlags.fileReadAllowed || !metadata.request.budget.allowBody || result.bodyIncluded !== true || result.text === undefined || !result.sanitizedPathLabel || result.byteCount === undefined || result.lineCount === undefined || !result.contentHash) {
    diagnostics.push({ code: "invalid_authority", message: "Successful controlled file reads require read eligibility, allowed body, and bounded preview metadata." });
  }
  if (result.status === "success" && result.truncated !== false) {
    diagnostics.push({ code: "invalid_authority", message: "Successful controlled file read metadata cannot be marked truncated." });
  }
  if (result.status === "truncated" && result.truncated !== true) {
    diagnostics.push({ code: "invalid_authority", message: "Truncated controlled file read metadata must be marked truncated." });
  }
  if ((result.byteCount ?? 0) > metadata.request.budget.maxBytes || (result.lineCount ?? 0) > metadata.request.budget.maxLines || (result.text?.length ?? 0) > metadata.request.budget.maxBytes) {
    diagnostics.push({ code: "unsafe_body", message: "Controlled file read body exceeds the requested bounded budget." });
  }
  if (result.text !== undefined && unsafeTextPattern.test(result.text)) {
    diagnostics.push({ code: "unsafe_body", message: "Controlled file read body contains unsafe display text and is omitted." });
  }
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentFileReadDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    const bodyKey = keyPath.endsWith(".text") || keyPath === "text";
    if (!bodyKey && unsafeTextPattern.test(value)) {
      diagnostics.push({ code: "unsafe_metadata", message: `Unsafe controlled file read metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.` });
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
        diagnostics.push({ code: "unsafe_metadata", message: `Unsupported controlled file read metadata field ${sanitizeDisplayText(key)}.` });
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function buildPreview(metadata: FileReadRecord, diagnostics: ControlledAgentFileReadDiagnostic[]): ControlledAgentFileReadPreview | undefined {
  const result = metadata.result;
  if (!result.sanitizedPathLabel || result.byteCount === undefined || result.lineCount === undefined || !result.contentHash || result.text === undefined) {
    diagnostics.push({ code: "malformed_input", message: "Controlled file read preview metadata is incomplete." });
    return undefined;
  }
  return {
    pathLabel: sanitizeBoundedText(result.sanitizedPathLabel, 180, "[redacted]"),
    byteCount: result.byteCount,
    lineCount: result.lineCount,
    contentHash: result.contentHash,
    truncated: result.truncated,
    text: sanitizeBoundedText(result.text, metadata.request.budget.maxBytes, ""),
  };
}

function buildDetails(metadata: FileReadRecord): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({
    displayOnly: true,
    workspaceMode: metadata.workspace.workspaceMode,
    host: metadata.workspace.host,
    workspaceLabel: metadata.workspace.workspaceLabel,
    requestSource: metadata.request.source,
    requestIdMintedBy: metadata.request.requestIdMintedBy,
    pathLabel: metadata.request.workspaceRelativePath,
    maxBytes: metadata.request.budget.maxBytes,
    maxLines: metadata.request.budget.maxLines,
    allowBody: metadata.request.budget.allowBody,
    resultStatus: metadata.result.status,
    blockedReason: metadata.result.blockedReason,
    byteCount: metadata.result.byteCount,
    lineCount: metadata.result.lineCount,
  });
}

function buildEvaluation(state: ControlledAgentFileReadState, allowedToRead: boolean, summary: string, diagnostics: ControlledAgentFileReadDiagnostic[], details: Record<string, string | number | boolean | string[]>, preview?: ControlledAgentFileReadPreview): ControlledAgentFileReadSummary {
  const blocked = hasBlockingDiagnostics(diagnostics);
  return {
    state: blocked ? "blocked" : state,
    allowedToRead: blocked ? false : allowedToRead,
    canReadHiddenFiles: false,
    canSearchWorkspace: false,
    canRunCommands: false,
    canWriteFiles: false,
    canUseGit: false,
    canCallProvider: false,
    canUseTools: false,
    summary: sanitizeBoundedText(blocked ? `${summary} [redacted]` : summary, 240, "Controlled file read is blocked."),
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: sanitizeBoundedText(item.message, 200, "Controlled file read blocked.") })).slice(0, 20),
    details,
    preview: blocked ? undefined : preview,
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
      details[safeKey] = sanitizeBoundedText(value, 180, "[redacted]");
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

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>, diagnostics: ControlledAgentFileReadDiagnostic[], label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported controlled file read ${label} field ${sanitizeDisplayText(key)}.` });
    }
  }
}

function hasBlockingDiagnostics(diagnostics: ControlledAgentFileReadDiagnostic[]): boolean {
  return diagnostics.some((item) => item.code !== "missing_input");
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function sanitizeBoundedText(input: string, limit: number, fallback: string): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function defaultSummary(state: ControlledAgentFileReadState): string {
  if (state === "success") {
    return "Bounded file read completed within budget.";
  }
  if (state === "truncated") {
    return "Bounded file read returned a truncated preview.";
  }
  if (state === "disabled") {
    return "Controlled file read is disabled.";
  }
  return "Controlled file read is blocked.";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
