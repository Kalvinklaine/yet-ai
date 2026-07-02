import { evaluateControlledAgentEditExecutor, type ControlledAgentEditExecutorSummary } from "./controlledAgentEditExecutor";
import { evaluateControlledAgentRuntimeSession } from "./controlledAgentRuntimeSession";
import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentEditRequestDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "browser_host"
  | "unsupported_host"
  | "runtime_session_not_ready"
  | "workspace_not_ready"
  | "edit_not_ready"
  | "assistant_authority_blocked"
  | "unsafe_metadata"
  | "unsafe_path"
  | "unsafe_replacement"
  | "stale_result"
  | "duplicate_result"
  | "invalid_authority";

export type ControlledAgentEditRequestDiagnostic = {
  code: ControlledAgentEditRequestDiagnosticCode;
  message: string;
};

export type ControlledAgentEditBridgeEdit = {
  operation: "replace";
  workspaceRelativePath: string;
  fileLabel: string;
  expectedContentHash: string;
  startLine: number;
  endLine: number;
  replacementText: string;
  replacementByteCount: number;
  sanitizedSummary: string;
};

export type ControlledAgentEditBridgeRequest = {
  version: "2026-05-15";
  type: "gui.controlledAgentEditRequest";
  requestId: string;
  payload: {
    requestId: string;
    requestIdMintedBy: "gui";
    source: "gui";
    assistantMinted: false;
    controlledWorkspaceId: string;
    runId: string;
    runtimeSessionId: string;
    workspaceReadinessId: string;
    userConfirmed: true;
    limits: {
      maxFiles: number;
      maxEdits: number;
      maxPatchBytes: number;
    };
    edits: ControlledAgentEditBridgeEdit[];
  };
};

export type ControlledAgentEditRequestCorrelation = {
  requestId: string;
  runId: string;
  controlledWorkspaceId: string;
  runtimeSessionId: string;
  workspaceReadinessId: string;
};

export type ControlledAgentEditRequestInput = {
  host: "browser" | "vscode" | "jetbrains";
  runtimeSessionMetadata?: unknown;
  workspaceReadinessMetadata?: unknown;
  plannedEditMetadata?: unknown;
  requestSeed?: string;
  jetbrainsEditSupported?: boolean;
};

export type ControlledAgentEditRequestResult = {
  state: "ready" | "blocked" | "unsupported";
  bridgeRequest?: ControlledAgentEditBridgeRequest;
  correlation?: ControlledAgentEditRequestCorrelation;
  diagnostics: ControlledAgentEditRequestDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentEditRequestAuthority;
};

export type ControlledAgentEditResultInput = {
  current: ControlledAgentEditRequestCorrelation;
  hostMessage: { version?: string; type?: string; requestId?: string; payload?: unknown };
  existingEdit?: ControlledAgentEditExecutorSummary;
};

export type ControlledAgentEditResultCorrelationResult = {
  state: "accepted" | "ignored" | "duplicate" | "blocked";
  edit?: ControlledAgentEditExecutorSummary;
  diagnostics: ControlledAgentEditRequestDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentEditRequestAuthority;
};

export type ControlledAgentEditRequestAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  canCreateFiles: false;
  canDeleteFiles: false;
  canRenameFiles: false;
  canMoveFiles: false;
  canChangePermissions: false;
  canEditBinary: false;
  canEditDirectories: false;
  canRunCommands: false;
  canUseGit: false;
  canCallProvider: false;
  canUseTools: false;
  canUseNetwork: false;
  canAutoApply: false;
  canAutoRun: false;
};

const authority: ControlledAgentEditRequestAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  canCreateFiles: false,
  canDeleteFiles: false,
  canRenameFiles: false,
  canMoveFiles: false,
  canChangePermissions: false,
  canEditBinary: false,
  canEditDirectories: false,
  canRunCommands: false,
  canUseGit: false,
  canCallProvider: false,
  canUseTools: false,
  canUseNetwork: false,
  canAutoApply: false,
  canAutoRun: false,
};

const safeIdPattern = /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/i;
const safeRelativePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/i;
const sha256HashPattern = /^sha256:[a-f0-9]{64}$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|network|git|provider|tool|shell|rawCommand|raw_command|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|rawBody|raw_body|rawDiff|raw_diff|rawPatch|raw_patch|diff|patch|browserStorage|browser_storage|storageDump|storage_dump|hiddenRead|hidden_read|hiddenSearch|hidden_search|search|glob|regex|index|indexing|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoRepair|auto_repair|create|delete|rename|move|chmod|symlink|binary)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|body|diff|patch)|file[_ -]?(?:body|content)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|repair)|create|delete|rename|move|chmod|symlink|binary|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;

export function buildControlledAgentEditRequest(input: unknown): ControlledAgentEditRequestResult {
  const diagnostics: ControlledAgentEditRequestDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Controlled edit request metadata is absent."));
    return requestBlocked("blocked", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics, { allowReplacementText: true });
  const metadata = input as ControlledAgentEditRequestInput;
  const host = metadata.host;
  if (host === "browser") {
    diagnostics.push(diagnostic("browser_host", "Browser preview cannot post controlled edit requests."));
  } else if (host !== "vscode" && host !== "jetbrains") {
    diagnostics.push(diagnostic("unsupported_host", "Controlled edit requests require a supported IDE host."));
  } else if (host === "jetbrains" && metadata.jetbrainsEditSupported !== true) {
    diagnostics.push(diagnostic("unsupported_host", "JetBrains controlled edit bridge support is not available."));
  }

  const runtime = evaluateControlledAgentRuntimeSession(metadata.runtimeSessionMetadata);
  const readiness = evaluateControlledAgentWorkspaceReadiness(metadata.workspaceReadinessMetadata);
  if (runtime.status !== "ready_to_start" && runtime.status !== "start_requested_metadata" && runtime.status !== "session_open_metadata") {
    diagnostics.push(diagnostic("runtime_session_not_ready", "Controlled edit requires ready runtime session metadata."));
  }
  if (readiness.state !== "ready_for_future_controlled_mode") {
    diagnostics.push(diagnostic("workspace_not_ready", "Controlled edit requires ready workspace metadata."));
  }

  const source = extractSource(metadata.runtimeSessionMetadata, metadata.workspaceReadinessMetadata, metadata.plannedEditMetadata);
  if (source.assistantMinted) {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Assistant-minted metadata cannot request controlled edits."));
  }
  if (source.host && source.host !== host) {
    diagnostics.push(diagnostic("unsupported_host", "Controlled edit host metadata does not match the active host."));
  }

  const plan = sanitizePlannedEdit(metadata.plannedEditMetadata, diagnostics);
  if (!plan) {
    diagnostics.push(diagnostic("edit_not_ready", "Controlled edit requires safe planned replacement metadata."));
  }
  const requestId = buildRequestId(source.runId, source.controlledWorkspaceId, plan, metadata.requestSeed);
  const details = requestDetails(requestId, source.runId, source.controlledWorkspaceId, source.workspaceReadinessId, plan?.edits.length, plan?.replacementByteCount, host);

  if (diagnostics.length > 0 || !source.runId || !source.controlledWorkspaceId || !source.runtimeSessionId || !source.workspaceReadinessId || !plan || !requestId) {
    return requestBlocked(diagnostics.some((item) => item.code === "unsupported_host" || item.code === "browser_host") ? "unsupported" : "blocked", diagnostics, details);
  }

  const bridgeRequest: ControlledAgentEditBridgeRequest = {
    version: "2026-05-15",
    type: "gui.controlledAgentEditRequest",
    requestId,
    payload: {
      requestId,
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: source.controlledWorkspaceId,
      runId: source.runId,
      runtimeSessionId: source.runtimeSessionId,
      workspaceReadinessId: source.workspaceReadinessId,
      userConfirmed: true,
      limits: plan.limits,
      edits: plan.edits,
    },
  };
  const correlation: ControlledAgentEditRequestCorrelation = { requestId, runId: source.runId, controlledWorkspaceId: source.controlledWorkspaceId, runtimeSessionId: source.runtimeSessionId, workspaceReadinessId: source.workspaceReadinessId };
  return { state: "ready", bridgeRequest, correlation, diagnostics: [], details, authority };
}

export function correlateControlledAgentEditResult(input: unknown): ControlledAgentEditResultCorrelationResult {
  const diagnostics: ControlledAgentEditRequestDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled edit result correlation metadata must be an object."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics, { allowResultText: true });
  const metadata = input as Partial<ControlledAgentEditResultInput>;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Controlled edit result requires current safe correlation metadata."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  if (diagnostics.length > 0) {
    return resultBlocked(diagnostics, resultDetails(current, undefined, undefined, undefined, undefined, undefined));
  }

  const hostMessage = isPlainObject(metadata.hostMessage) ? metadata.hostMessage : undefined;
  const hostRequestId = safeId(hostMessage?.requestId);
  const payload = isPlainObject(hostMessage?.payload) ? hostMessage.payload : undefined;
  const payloadRequestId = safeId(payload?.requestId);
  const payloadRunId = safeId(payload?.runId);
  const payloadWorkspaceId = safeId(payload?.controlledWorkspaceId);
  const payloadReadinessId = safeId(payload?.workspaceReadinessId);
  const status = payload?.state === "applied" || payload?.state === "blocked" || payload?.state === "failed" ? payload.state : undefined;

  if (hostMessage?.type !== "host.controlledAgentEditResult" || !hostRequestId || hostRequestId !== current.requestId || payloadRequestId !== current.requestId || payloadRunId !== current.runId || payloadWorkspaceId !== current.controlledWorkspaceId || payloadReadinessId !== current.workspaceReadinessId) {
    diagnostics.push(diagnostic("stale_result", "Ignored controlled edit result that does not match request, run, and workspace ids."));
    return { state: "ignored", diagnostics, details: resultDetails(current, undefined, hostRequestId, payloadRunId, payloadWorkspaceId, payloadReadinessId), authority };
  }

  if (metadata.existingEdit?.state === "applied" || metadata.existingEdit?.state === "blocked" || metadata.existingEdit?.state === "failed") {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate controlled edit result ignored after the first terminal result."));
    return { state: "duplicate", edit: metadata.existingEdit, diagnostics, details: resultDetails(current, metadata.existingEdit.state, hostRequestId, payloadRunId, payloadWorkspaceId, payloadReadinessId), authority };
  }

  if (!payload || !resultAuthorityIsSafe(payload) || !status) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled edit host result is blocked because authority widened."));
    return resultBlocked(diagnostics, resultDetails(current, status, hostRequestId, payloadRunId, payloadWorkspaceId, payloadReadinessId));
  }

  const normalized = normalizeResultPayload(payload);
  const edit = evaluateControlledAgentEditExecutor(normalized);
  if (edit.diagnostics.length > 0 || edit.state !== status) {
    diagnostics.push(diagnostic("malformed_input", "Controlled edit host result is malformed."));
    return resultBlocked(diagnostics, resultDetails(current, status, hostRequestId, payloadRunId, payloadWorkspaceId, payloadReadinessId));
  }

  return { state: "accepted", edit, diagnostics: [], details: resultDetails(current, edit.state, hostRequestId, payloadRunId, payloadWorkspaceId, payloadReadinessId), authority };
}

function sanitizePlannedEdit(value: unknown, diagnostics: ControlledAgentEditRequestDiagnostic[]): { limits: ControlledAgentEditBridgeRequest["payload"]["limits"]; edits: ControlledAgentEditBridgeEdit[]; replacementByteCount: number } | undefined {
  if (!isPlainObject(value)) return undefined;
  const metadata = value as Record<string, unknown>;
  if (metadata.requestIdMintedBy !== "gui" && metadata.requestIdMintedBy !== "host") diagnostics.push(diagnostic("assistant_authority_blocked", "Controlled edit request id must not be assistant-minted."));
  if (metadata.userConfirmed !== true) diagnostics.push(diagnostic("assistant_authority_blocked", "Controlled edit requires explicit user confirmation metadata."));
  const limits = sanitizeLimits(metadata.limits, diagnostics);
  const edits = Array.isArray(metadata.edits) ? metadata.edits.map((edit, index) => sanitizeEdit(edit, index, diagnostics)).filter((edit): edit is ControlledAgentEditBridgeEdit => edit !== undefined) : [];
  if (!Array.isArray(metadata.edits)) diagnostics.push(diagnostic("malformed_input", "Controlled edit list is missing."));
  if (limits && edits.length > limits.maxEdits) diagnostics.push(diagnostic("unsafe_replacement", "Controlled edit count exceeds bounded limits."));
  const uniqueFiles = new Set(edits.map((edit) => edit.workspaceRelativePath));
  if (limits && uniqueFiles.size > limits.maxFiles) diagnostics.push(diagnostic("unsafe_path", "Controlled edit file count exceeds bounded limits."));
  const replacementByteCount = edits.reduce((total, edit) => total + edit.replacementByteCount, 0);
  if (limits && replacementByteCount > limits.maxPatchBytes) diagnostics.push(diagnostic("unsafe_replacement", "Controlled edit replacement bytes exceed bounded limits."));
  if (!limits || edits.length === 0) return undefined;
  const executorInput = {
    type: "controlled_agent_edit_executor",
    schemaVersion: "2026-07-02",
    state: "planned",
    runId: safeId(metadata.runId) ?? "run-placeholder",
    workspaceReadinessId: safeId(metadata.workspaceReadinessId) ?? "ready-placeholder",
    requestId: safeId(metadata.requestId) ?? "request-placeholder",
    requestIdMintedBy: metadata.requestIdMintedBy,
    userConfirmed: metadata.userConfirmed,
    limits,
    edits: edits.map(({ replacementText: _replacementText, ...edit }) => edit),
  };
  const summary = evaluateControlledAgentEditExecutor(executorInput);
  if (!summary.canApplyControlledEdit) diagnostics.push(diagnostic("edit_not_ready", "Controlled edit executor metadata is not ready."));
  return { limits, edits, replacementByteCount };
}

function sanitizeLimits(value: unknown, diagnostics: ControlledAgentEditRequestDiagnostic[]): ControlledAgentEditBridgeRequest["payload"]["limits"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const maxFiles = boundedInteger(value.maxFiles, 1, 12) ? value.maxFiles : undefined;
  const maxEdits = boundedInteger(value.maxEdits, 1, 50) ? value.maxEdits : undefined;
  const maxPatchBytes = boundedInteger(value.maxPatchBytes, 1, 50000) ? value.maxPatchBytes : undefined;
  if (!maxFiles || !maxEdits || !maxPatchBytes) diagnostics.push(diagnostic("unsafe_replacement", "Controlled edit limits are missing or out of bounds."));
  return maxFiles && maxEdits && maxPatchBytes ? { maxFiles, maxEdits, maxPatchBytes } : undefined;
}

function sanitizeEdit(value: unknown, index: number, diagnostics: ControlledAgentEditRequestDiagnostic[]): ControlledAgentEditBridgeEdit | undefined {
  if (!isPlainObject(value)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled edit entry is malformed."));
    return undefined;
  }
  if (value.operation !== "replace") diagnostics.push(diagnostic("invalid_authority", "Controlled edit only supports replacement edits."));
  const workspaceRelativePath = safePath(value.workspaceRelativePath);
  if (!workspaceRelativePath) diagnostics.push(diagnostic("unsafe_path", "Controlled edit requires safe workspace-relative paths."));
  const fileLabel = safeDisplayText(value.fileLabel, 160);
  const expectedContentHash = typeof value.expectedContentHash === "string" && sha256HashPattern.test(value.expectedContentHash) ? value.expectedContentHash : undefined;
  const startLine = boundedInteger(value.startLine, 1, 1000000) ? value.startLine : undefined;
  const endLine = boundedInteger(value.endLine, 1, 1000000) ? value.endLine : undefined;
  const replacementText = safeReplacementText(value.replacementText);
  const replacementByteCount = boundedInteger(value.replacementByteCount, 0, 50000) ? value.replacementByteCount : undefined;
  const sanitizedSummary = safeDisplayText(value.sanitizedSummary, 240);
  if (!fileLabel || !expectedContentHash || !startLine || !endLine || endLine < startLine || replacementText === undefined || replacementByteCount === undefined || !sanitizedSummary) diagnostics.push(diagnostic("unsafe_replacement", `Controlled edit ${index} is missing bounded replacement metadata.`));
  if (replacementText !== undefined && replacementByteCount !== undefined && byteLength(replacementText) !== replacementByteCount) diagnostics.push(diagnostic("unsafe_replacement", `Controlled edit ${index} replacement byte count does not match.`));
  return value.operation === "replace" && workspaceRelativePath && fileLabel && expectedContentHash && startLine && endLine && endLine >= startLine && replacementText !== undefined && replacementByteCount !== undefined && sanitizedSummary && byteLength(replacementText) === replacementByteCount
    ? { operation: "replace", workspaceRelativePath, fileLabel, expectedContentHash, startLine, endLine, replacementText, replacementByteCount, sanitizedSummary }
    : undefined;
}

function extractSource(runtimeInput: unknown, readinessInput: unknown, editInput: unknown): { runId?: string; controlledWorkspaceId?: string; runtimeSessionId?: string; workspaceReadinessId?: string; host?: "vscode" | "jetbrains" | "browser"; assistantMinted: boolean } {
  const runtime = isPlainObject(runtimeInput) ? runtimeInput : undefined;
  const workspace = isPlainObject(runtime?.workspace) ? runtime.workspace : undefined;
  const session = isPlainObject(runtime?.session) ? runtime.session : undefined;
  const hostRecord = isPlainObject(runtime?.host) ? runtime.host : undefined;
  const preconditions = isPlainObject(runtime?.preconditions) ? runtime.preconditions : undefined;
  const optIn = isPlainObject(preconditions?.optIn) ? preconditions.optIn : undefined;
  const readiness = isPlainObject(readinessInput) ? readinessInput : undefined;
  const readinessOptIn = isPlainObject(readiness?.optIn) ? readiness.optIn : undefined;
  const isolation = isPlainObject(readiness?.isolation) ? readiness.isolation : undefined;
  const edit = isPlainObject(editInput) ? editInput : undefined;
  const runId = safeId(edit?.runId) ?? safeId(session?.sessionId);
  const readinessId = safeId(edit?.workspaceReadinessId) ?? safeId(workspace?.readinessId) ?? safeId(isolation?.readinessId);
  return {
    runId,
    controlledWorkspaceId: safeId(workspace?.controlledWorkspaceId),
    runtimeSessionId: safeId(session?.sessionId),
    workspaceReadinessId: readinessId,
    host: hostRecord?.kind === "vscode" || hostRecord?.kind === "jetbrains" || hostRecord?.kind === "browser" ? hostRecord.kind : undefined,
    assistantMinted: optIn?.assistantMinted === true || optIn?.origin === "assistant" || optIn?.confirmedBy === "assistant" || optIn?.requestIdMintedBy === "assistant" || readinessOptIn?.origin === "assistant" || readinessOptIn?.confirmedBy === "assistant" || readinessOptIn?.requestIdMintedBy === "assistant" || edit?.assistantMinted === true || edit?.requestIdMintedBy === "assistant",
  };
}

function normalizeResultPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const edits = Array.isArray(payload.edits) ? payload.edits.map((edit) => {
    if (!isPlainObject(edit)) return edit;
    return {
      operation: edit.operation,
      workspaceRelativePath: edit.workspaceRelativePath,
      fileLabel: edit.fileLabel,
      expectedContentHash: edit.expectedContentHash,
      startLine: edit.startLine,
      endLine: edit.endLine,
      replacementByteCount: edit.replacementByteCount,
      sanitizedSummary: edit.sanitizedSummary,
    };
  }) : payload.edits;
  return {
    type: payload.type,
    schemaVersion: payload.schemaVersion,
    state: payload.state,
    runId: payload.runId,
    workspaceReadinessId: payload.workspaceReadinessId,
    requestId: payload.requestId,
    requestIdMintedBy: payload.requestIdMintedBy,
    userConfirmed: payload.userConfirmed,
    limits: payload.limits,
    edits,
  };
}

function resultAuthorityIsSafe(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  if (payload.authority !== "bounded_replacement_edit" || payload.cloudRequired !== false) return false;
  const policyFlags = isPlainObject(payload.policyFlags) ? payload.policyFlags : undefined;
  const result = isPlainObject(payload.result) ? payload.result : undefined;
  if (!policyFlags || !result) return false;
  const allowedTrue = payload.state === "applied" ? "boundedReplacementEditAllowed" : undefined;
  for (const [key, value] of Object.entries(policyFlags)) {
    if (key === allowedTrue) {
      if (value !== true) return false;
    } else if (value !== false) {
      return false;
    }
  }
  return result.cloudRequired === false && result.privatePathExposed === false && result.rawBodyIncluded === false && result.rawDiffIncluded === false && result.authority === "bounded_replacement_edit";
}

function sanitizeCorrelation(value: unknown): ControlledAgentEditRequestCorrelation | undefined {
  if (!isPlainObject(value)) return undefined;
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const runtimeSessionId = safeId(value.runtimeSessionId);
  const workspaceReadinessId = safeId(value.workspaceReadinessId);
  return requestId && runId && controlledWorkspaceId && runtimeSessionId && workspaceReadinessId ? { requestId, runId, controlledWorkspaceId, runtimeSessionId, workspaceReadinessId } : undefined;
}

function buildRequestId(runId: string | undefined, workspaceId: string | undefined, plan: { edits: ControlledAgentEditBridgeEdit[] } | undefined, seed: unknown): string | undefined {
  if (!runId || !workspaceId || !plan) return undefined;
  const safeSeed = typeof seed === "string" && safeIdPattern.test(seed) ? seed : "edit";
  const editShape = plan.edits.map((edit) => `${edit.workspaceRelativePath}:${edit.startLine}:${edit.endLine}:${edit.replacementByteCount}:${edit.expectedContentHash}`).join("|");
  return `gui-s84-${stableHash(`${runId}:${workspaceId}:${editShape}:${safeSeed}`)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function requestDetails(requestId: string | undefined, runId: string | undefined, workspaceId: string | undefined, readinessId: string | undefined, editCount: number | undefined, replacementByteCount: number | undefined, host: unknown): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId, runId, controlledWorkspaceId: workspaceId, workspaceReadinessId: readinessId, editCount, replacementByteCount, host, requestReady: requestId !== undefined });
}

function resultDetails(correlation: ControlledAgentEditRequestCorrelation, state: string | undefined, hostRequestId: string | undefined, hostRunId: string | undefined, hostWorkspaceId: string | undefined, hostReadinessId: string | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId: correlation.requestId, hostRequestId, runId: correlation.runId, hostRunId, controlledWorkspaceId: correlation.controlledWorkspaceId, hostWorkspaceId, workspaceReadinessId: correlation.workspaceReadinessId, hostReadinessId, resultState: state });
}

function requestBlocked(state: "blocked" | "unsupported", diagnostics: ControlledAgentEditRequestDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentEditRequestResult {
  return { state, diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function resultBlocked(diagnostics: ControlledAgentEditRequestDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentEditResultCorrelationResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentEditRequestDiagnostic[], options: { allowReplacementText?: boolean; allowResultText?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  const keyParts = keyPath.split(".");
  const currentKey = (keyParts[keyParts.length - 1] ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    const textAllowed = (options.allowReplacementText && currentKey === "replacementText") || (options.allowResultText && (currentKey === "message" || currentKey === "blockedReason"));
    if (!textAllowed && unsafeTextPattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe controlled edit request metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
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
      const allowedReplacement = options.allowReplacementText && key === "replacementText";
      if (unsafeKeyPattern.test(key) && !allowedReplacement) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported controlled edit request field ${sanitizeDisplayText(key)}.`));
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

function safeDisplayText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n\t<>]+/g, " ").trim();
  return sanitized.length > 0 && sanitized.length <= limit && !unsafeTextPattern.test(sanitized) ? sanitizeDisplayText(sanitized) : undefined;
}

function safeReplacementText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return byteLength(value) <= 50000 && !unsafeTextPattern.test(value) ? value : undefined;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function diagnostic(code: ControlledAgentEditRequestDiagnosticCode, message: string): ControlledAgentEditRequestDiagnostic {
  return { code, message: safeText(message, 200) };
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
