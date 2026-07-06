import { evaluateControlledAgentFileRead, type ControlledAgentFileReadSummary } from "./controlledAgentFileRead";
import { evaluateControlledAgentRuntimeSession } from "./controlledAgentRuntimeSession";
import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentFileReadRequestDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "browser_host"
  | "unsupported_host"
  | "runtime_session_not_ready"
  | "workspace_not_ready"
  | "assistant_authority_blocked"
  | "unsafe_metadata"
  | "unsafe_path"
  | "stale_result"
  | "duplicate_result"
  | "invalid_authority";

export type ControlledAgentFileReadRequestDiagnostic = {
  code: ControlledAgentFileReadRequestDiagnosticCode;
  message: string;
};

export type ControlledAgentFileReadBridgeRequest = {
  version: "2026-05-15";
  type: "gui.controlledAgentFileReadRequest";
  requestId: string;
  payload: {
    requestIdMintedBy: "gui";
    source: "gui";
    assistantMinted: false;
    controlledWorkspaceId: string;
    runId: string;
    runtimeSessionId: string;
    sessionId: string;
    workspaceRelativePath: string;
    maxBytes: number;
    maxLines: number;
    allowBody: true;
    singleFileOnly: true;
    recursive: false;
    globAllowed: false;
    regexAllowed: false;
    indexingAllowed: false;
  };
};

export type ControlledAgentFileReadRequestCorrelation = {
  requestId: string;
  runId: string;
  controlledWorkspaceId: string;
  runtimeSessionId: string;
  workspaceRelativePath: string;
};

export type ControlledAgentFileReadRequestInput = {
  host: "browser" | "vscode" | "jetbrains";
  runtimeSessionMetadata?: unknown;
  workspaceReadinessMetadata?: unknown;
  workspaceRelativePath?: string;
  maxBytes?: number;
  maxLines?: number;
  requestSeed?: string;
  jetbrainsFileReadSupported?: boolean;
};

export type ControlledAgentFileReadRequestResult = {
  state: "ready" | "blocked" | "unsupported";
  bridgeRequest?: ControlledAgentFileReadBridgeRequest;
  correlation?: ControlledAgentFileReadRequestCorrelation;
  diagnostics: ControlledAgentFileReadRequestDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentFileReadRequestAuthority;
};

export type ControlledAgentFileReadResultInput = {
  current: ControlledAgentFileReadRequestCorrelation;
  hostMessage: { version?: string; type?: string; requestId?: string; payload?: unknown };
  existingFileRead?: ControlledAgentFileReadSummary;
};

export type ControlledAgentFileReadResultCorrelationResult = {
  state: "accepted" | "ignored" | "duplicate" | "blocked";
  fileRead?: ControlledAgentFileReadSummary;
  diagnostics: ControlledAgentFileReadRequestDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentFileReadRequestAuthority;
};

export type ControlledAgentFileReadRequestAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  canReadHiddenFiles: false;
  canSearchWorkspace: false;
  canRunCommands: false;
  canWriteFiles: false;
  canUseGit: false;
  canCallProvider: false;
  canUseTools: false;
};

const authority: ControlledAgentFileReadRequestAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  canReadHiddenFiles: false,
  canSearchWorkspace: false,
  canRunCommands: false,
  canWriteFiles: false,
  canUseGit: false,
  canCallProvider: false,
  canUseTools: false,
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeRelativePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/i;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|network|git|provider|tool|shell|rawCommand|raw_command|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|browserStorage|browser_storage|storageDump|storage_dump|hiddenRead|hidden_read|hiddenSearch|hidden_search|search|glob|regex|index|indexing|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;

export function buildControlledAgentFileReadRequest(input: unknown): ControlledAgentFileReadRequestResult {
  const diagnostics: ControlledAgentFileReadRequestDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Controlled file read request metadata is absent."));
    return requestBlocked("blocked", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as ControlledAgentFileReadRequestInput;
  const host = metadata.host;
  if (host === "browser") {
    diagnostics.push(diagnostic("browser_host", "Browser preview cannot post controlled file read requests."));
  } else if (host === "jetbrains") {
    diagnostics.push(diagnostic("unsupported_host", "JetBrains controlled file read remains fail-closed until verified parity support exists."));
  } else if (host !== "vscode") {
    diagnostics.push(diagnostic("unsupported_host", "Controlled file read requests require a supported IDE host."));
  }

  const runtime = evaluateControlledAgentRuntimeSession(metadata.runtimeSessionMetadata);
  const readiness = evaluateControlledAgentWorkspaceReadiness(metadata.workspaceReadinessMetadata);
  if (runtime.status !== "ready_to_start" && runtime.status !== "start_requested_metadata" && runtime.status !== "session_open_metadata") {
    diagnostics.push(diagnostic("runtime_session_not_ready", "Controlled file read requires ready runtime session metadata."));
  }
  if (readiness.state !== "ready_for_future_controlled_mode") {
    diagnostics.push(diagnostic("workspace_not_ready", "Controlled file read requires ready workspace metadata."));
  }

  const source = extractSource(metadata.runtimeSessionMetadata, metadata.workspaceReadinessMetadata);
  if (source.assistantMinted) {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Assistant-minted metadata cannot request controlled file reads."));
  }
  if (source.host && source.host !== host) {
    diagnostics.push(diagnostic("unsupported_host", "Controlled file read host metadata does not match the active host."));
  }

  const workspaceRelativePath = safePath(metadata.workspaceRelativePath);
  if (!workspaceRelativePath) {
    diagnostics.push(diagnostic("unsafe_path", "Controlled file read requires a safe workspace-relative path."));
  }
  const maxBytes = boundedInteger(metadata.maxBytes, 1, 8192) ? metadata.maxBytes : 2048;
  const maxLines = boundedInteger(metadata.maxLines, 1, 240) ? metadata.maxLines : 80;
  const requestId = buildRequestId(source.runId, source.controlledWorkspaceId, workspaceRelativePath, metadata.requestSeed);

  const details = requestDetails(requestId, source.runId, source.controlledWorkspaceId, workspaceRelativePath, host);
  if (diagnostics.length > 0 || !source.runId || !source.controlledWorkspaceId || !source.sessionId || !workspaceRelativePath || !requestId) {
    return requestBlocked(diagnostics.some((item) => item.code === "unsupported_host" || item.code === "browser_host") ? "unsupported" : "blocked", diagnostics, details);
  }

  const bridgeRequest: ControlledAgentFileReadBridgeRequest = {
    version: "2026-05-15",
    type: "gui.controlledAgentFileReadRequest",
    requestId,
    payload: {
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: source.controlledWorkspaceId,
      runId: source.runId,
      runtimeSessionId: source.sessionId,
      sessionId: source.sessionId,
      workspaceRelativePath,
      maxBytes,
      maxLines,
      allowBody: true,
      singleFileOnly: true,
      recursive: false,
      globAllowed: false,
      regexAllowed: false,
      indexingAllowed: false,
    },
  };
  const correlation: ControlledAgentFileReadRequestCorrelation = { requestId, runId: source.runId, controlledWorkspaceId: source.controlledWorkspaceId, runtimeSessionId: source.sessionId, workspaceRelativePath };
  return { state: "ready", bridgeRequest, correlation, diagnostics: [], details, authority };
}

export function correlateControlledAgentFileReadResult(input: unknown): ControlledAgentFileReadResultCorrelationResult {
  const diagnostics: ControlledAgentFileReadRequestDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled file read result correlation metadata must be an object."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics, { allowText: true });
  const metadata = input as Partial<ControlledAgentFileReadResultInput>;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Controlled file read result requires current safe correlation metadata."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  if (diagnostics.length > 0) {
    return resultBlocked(diagnostics, resultDetails(current, undefined, undefined, undefined, undefined));
  }

  const hostMessage = isPlainObject(metadata.hostMessage) ? metadata.hostMessage : undefined;
  const hostRequestId = safeId(hostMessage?.requestId);
  const payload = isPlainObject(hostMessage?.payload) ? hostMessage.payload : undefined;
  const payloadRequest = isPlainObject(payload?.request) ? payload.request : undefined;
  const payloadWorkspace = isPlainObject(payload?.workspace) ? payload.workspace : undefined;
  const payloadResult = isPlainObject(payload?.result) ? payload.result : undefined;
  const payloadRequestId = safeId(payloadRequest?.requestId);
  const payloadRunId = safeId(payloadWorkspace?.runId);
  const payloadWorkspaceId = safeId(payloadWorkspace?.controlledWorkspaceId);
  const resultStatus = typeof payloadResult?.status === "string" ? payloadResult.status : undefined;
  if (hostMessage?.type !== "host.controlledAgentFileReadResult" || !hostRequestId || hostRequestId !== current.requestId || payloadRequestId !== current.requestId || payloadRunId !== current.runId || payloadWorkspaceId !== current.controlledWorkspaceId) {
    diagnostics.push(diagnostic("stale_result", "Ignored controlled file read result that does not match request, run, and workspace ids."));
    return { state: "ignored", diagnostics, details: resultDetails(current, undefined, hostRequestId, payloadRunId, payloadWorkspaceId), authority };
  }

  if (metadata.existingFileRead?.state === "success" || metadata.existingFileRead?.state === "truncated" || metadata.existingFileRead?.state === "blocked") {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate controlled file read result ignored after the first terminal result."));
    return { state: "duplicate", fileRead: metadata.existingFileRead, diagnostics, details: resultDetails(current, metadata.existingFileRead.state, hostRequestId, payloadRunId, payloadWorkspaceId), authority };
  }

  const fileRead = evaluateControlledAgentFileRead(payload);
  if (fileRead.diagnostics.length > 0 || (resultStatus === "blocked" && fileRead.preview !== undefined)) {
    diagnostics.push(diagnostic(resultStatus === "blocked" ? "invalid_authority" : "malformed_input", "Controlled file read host result is blocked or malformed."));
    return resultBlocked(diagnostics, resultDetails(current, fileRead.state, hostRequestId, payloadRunId, payloadWorkspaceId));
  }

  return { state: "accepted", fileRead, diagnostics: [], details: resultDetails(current, fileRead.state, hostRequestId, payloadRunId, payloadWorkspaceId), authority };
}

function extractSource(runtimeInput: unknown, readinessInput: unknown): { runId?: string; controlledWorkspaceId?: string; sessionId?: string; host?: "vscode" | "jetbrains" | "browser"; assistantMinted: boolean } {
  const runtime = isPlainObject(runtimeInput) ? runtimeInput : undefined;
  const workspace = isPlainObject(runtime?.workspace) ? runtime.workspace : undefined;
  const session = isPlainObject(runtime?.session) ? runtime.session : undefined;
  const hostRecord = isPlainObject(runtime?.host) ? runtime.host : undefined;
  const preconditions = isPlainObject(runtime?.preconditions) ? runtime.preconditions : undefined;
  const optIn = isPlainObject(preconditions?.optIn) ? preconditions.optIn : undefined;
  const readiness = isPlainObject(readinessInput) ? readinessInput : undefined;
  const readinessOptIn = isPlainObject(readiness?.optIn) ? readiness.optIn : undefined;
  return {
    runId: safeId(session?.sessionId),
    controlledWorkspaceId: safeId(workspace?.controlledWorkspaceId),
    sessionId: safeId(session?.sessionId),
    host: hostRecord?.kind === "vscode" || hostRecord?.kind === "jetbrains" || hostRecord?.kind === "browser" ? hostRecord.kind : undefined,
    assistantMinted: optIn?.assistantMinted === true || optIn?.origin === "assistant" || optIn?.confirmedBy === "assistant" || optIn?.requestIdMintedBy === "assistant" || readinessOptIn?.origin === "assistant" || readinessOptIn?.confirmedBy === "assistant" || readinessOptIn?.requestIdMintedBy === "assistant",
  };
}

function sanitizeCorrelation(value: unknown): ControlledAgentFileReadRequestCorrelation | undefined {
  if (!isPlainObject(value)) return undefined;
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const runtimeSessionId = safeId(value.runtimeSessionId);
  const workspaceRelativePath = safePath(value.workspaceRelativePath);
  return requestId && runId && controlledWorkspaceId && runtimeSessionId && workspaceRelativePath ? { requestId, runId, controlledWorkspaceId, runtimeSessionId, workspaceRelativePath } : undefined;
}

function buildRequestId(runId: string | undefined, workspaceId: string | undefined, path: string | undefined, seed: unknown): string | undefined {
  if (!runId || !workspaceId || !path) return undefined;
  const safeSeed = typeof seed === "string" && safeIdPattern.test(seed) ? seed : "read";
  return `gui-s83-${stableHash(`${runId}:${workspaceId}:${path}:${safeSeed}`)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function requestDetails(requestId: string | undefined, runId: string | undefined, workspaceId: string | undefined, path: string | undefined, host: unknown): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId, runId, controlledWorkspaceId: workspaceId, pathLabel: path, host, requestReady: requestId !== undefined });
}

function resultDetails(correlation: ControlledAgentFileReadRequestCorrelation, state: string | undefined, hostRequestId: string | undefined, hostRunId: string | undefined, hostWorkspaceId: string | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId: correlation.requestId, hostRequestId, runId: correlation.runId, hostRunId, controlledWorkspaceId: correlation.controlledWorkspaceId, hostWorkspaceId, pathLabel: correlation.workspaceRelativePath, resultState: state });
}

function requestBlocked(state: "blocked" | "unsupported", diagnostics: ControlledAgentFileReadRequestDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentFileReadRequestResult {
  return { state, diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function resultBlocked(diagnostics: ControlledAgentFileReadRequestDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentFileReadResultCorrelationResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentFileReadRequestDiagnostic[], options: { allowText?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  const keyParts = keyPath.split(".");
  const currentKey = (keyParts[keyParts.length - 1] ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    if (!(options.allowText && currentKey === "text") && unsafeTextPattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe controlled file read request metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, options, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (unsafeKeyPattern.test(key) && !(options.allowText && key === "text")) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported controlled file read request field ${sanitizeDisplayText(key)}.`));
      }
      scanUnsafeMetadata(item, diagnostics, options, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) return { displayOnly: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeText(value, 180);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
    if (Array.isArray(value)) details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 80)).slice(0, 8);
  }
  return details;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safeRelativePathPattern.test(sanitized) ? sanitized : undefined;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function diagnostic(code: ControlledAgentFileReadRequestDiagnosticCode, message: string): ControlledAgentFileReadRequestDiagnostic {
  return { code, message: safeText(message, 200) };
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
