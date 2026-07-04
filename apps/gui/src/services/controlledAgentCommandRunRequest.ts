import { evaluateControlledAgentRuntimeSession } from "./controlledAgentRuntimeSession";
import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";
import { toolAuthorityPolicyAllowlistedCommandIds, type ToolAuthorityPolicyAllowlistedCommandId } from "./toolAuthorityPolicy";

export type ControlledAgentCommandRunRequestDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "browser_host"
  | "unsupported_host"
  | "runtime_session_not_ready"
  | "workspace_not_ready"
  | "command_not_ready"
  | "assistant_authority_blocked"
  | "unsupported_command"
  | "unsafe_metadata"
  | "stale_result"
  | "duplicate_result"
  | "invalid_authority";

export type ControlledAgentCommandRunRequestDiagnostic = {
  code: ControlledAgentCommandRunRequestDiagnosticCode;
  message: string;
};

export type ControlledAgentCommandRunCommandId = ToolAuthorityPolicyAllowlistedCommandId;

export type ControlledAgentCommandRunLimits = {
  timeoutMs: number;
  maxOutputBytes: number;
  maxOutputLines: number;
  tailOnly: true;
  commandStringAllowed: false;
  argsAllowed: false;
  cwdAllowed: false;
  envAllowed: false;
  shellAllowed: false;
};

export type ControlledAgentCommandRunPolicyFlags = {
  allowlistedCommandIdOnly: true;
  freeformCommandAllowed: false;
  argsAllowed: false;
  cwdAllowed: false;
  envAllowed: false;
  shellAllowed: false;
  gitAllowed: false;
  networkAllowed: false;
  providerAllowed: false;
  toolAllowed: false;
  packageInstallAllowed: false;
  fileReadAllowed: false;
  fileWriteAllowed: false;
  hiddenSearchAllowed: false;
  indexingAllowed: false;
  autoStartAllowed: false;
  autoApplyAllowed: false;
  autoRunAllowed: false;
  autoVerifyAllowed: false;
  autoFixAllowed: false;
};

export type ControlledAgentCommandRunBridgeRequest = {
  version: "2026-05-15";
  type: "gui.controlledAgentCommandRunRequest";
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
    commandId: ControlledAgentCommandRunCommandId;
    limits: ControlledAgentCommandRunLimits;
    policyFlags: ControlledAgentCommandRunPolicyFlags;
  };
};

export type ControlledAgentCommandRunRequestCorrelation = {
  requestId: string;
  runId: string;
  controlledWorkspaceId: string;
  runtimeSessionId: string;
  workspaceReadinessId: string;
  commandId: ControlledAgentCommandRunCommandId;
};

export type ControlledAgentCommandRunRequestInput = {
  host: "browser" | "vscode" | "jetbrains";
  runtimeSessionMetadata?: unknown;
  workspaceReadinessMetadata?: unknown;
  plannedCommandRunMetadata?: unknown;
  commandId?: unknown;
  userConfirmed?: unknown;
  requestSeed?: unknown;
};

export type ControlledAgentCommandRunRequestResult = {
  state: "ready" | "blocked" | "unsupported";
  bridgeRequest?: ControlledAgentCommandRunBridgeRequest;
  correlation?: ControlledAgentCommandRunRequestCorrelation;
  diagnostics: ControlledAgentCommandRunRequestDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentCommandRunRequestAuthority;
};

export type ControlledAgentCommandRunResultState = "running" | "succeeded" | "failed" | "timed_out" | "killed" | "blocked";

export type ControlledAgentCommandRunResultSummary = {
  status: ControlledAgentCommandRunResultState;
  commandId: ControlledAgentCommandRunCommandId;
  durationMs?: number;
  exitCode?: number | null;
  outputTail?: string;
  outputByteCount?: number;
  outputLineCount?: number;
  resultHash?: string;
  truncated?: boolean;
  message: string;
};

export type ControlledAgentCommandRunResultInput = {
  current: ControlledAgentCommandRunRequestCorrelation;
  hostMessage: { version?: string; type?: string; requestId?: string; payload?: unknown };
  existingResult?: ControlledAgentCommandRunResultSummary;
};

export type ControlledAgentCommandRunResultCorrelationResult = {
  state: "accepted" | "ignored" | "duplicate" | "blocked";
  commandRun?: ControlledAgentCommandRunResultSummary;
  diagnostics: ControlledAgentCommandRunRequestDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentCommandRunRequestAuthority;
};

export type ControlledAgentCommandRunRequestAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  freeformCommandAllowed: false;
  canRunShell: false;
  canUseGit: false;
  canUseNetwork: false;
  canCallProvider: false;
  canUseTools: false;
  canReadFiles: false;
  canWriteFiles: false;
  canInstallPackages: false;
  canAutoRun: false;
  canAutoVerify: false;
  canAutoFix: false;
};

const authority: ControlledAgentCommandRunRequestAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  freeformCommandAllowed: false,
  canRunShell: false,
  canUseGit: false,
  canUseNetwork: false,
  canCallProvider: false,
  canUseTools: false,
  canReadFiles: false,
  canWriteFiles: false,
  canInstallPackages: false,
  canAutoRun: false,
  canAutoVerify: false,
  canAutoFix: false,
};

const defaultLimits: ControlledAgentCommandRunLimits = {
  timeoutMs: 600000,
  maxOutputBytes: 12000,
  maxOutputLines: 240,
  tailOnly: true,
  commandStringAllowed: false,
  argsAllowed: false,
  cwdAllowed: false,
  envAllowed: false,
  shellAllowed: false,
};

const policyFlags: ControlledAgentCommandRunPolicyFlags = {
  allowlistedCommandIdOnly: true,
  freeformCommandAllowed: false,
  argsAllowed: false,
  cwdAllowed: false,
  envAllowed: false,
  shellAllowed: false,
  gitAllowed: false,
  networkAllowed: false,
  providerAllowed: false,
  toolAllowed: false,
  packageInstallAllowed: false,
  fileReadAllowed: false,
  fileWriteAllowed: false,
  hiddenSearchAllowed: false,
  indexingAllowed: false,
  autoStartAllowed: false,
  autoApplyAllowed: false,
  autoRunAllowed: false,
  autoVerifyAllowed: false,
  autoFixAllowed: false,
};

const allowedCommandIds = new Set<ControlledAgentCommandRunCommandId>(toolAuthorityPolicyAllowlistedCommandIds);
const safeIdPattern = /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/i;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const unsafeKeyPattern = /^(?:command|cmd|arguments|environment|network|git|provider|tool|shell|rawCommand|raw_command|rawArgs|raw_args|rawCwd|raw_cwd|rawEnv|raw_env|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|rawLog|raw_log|browserStorage|browser_storage|storageDump|storage_dump|hiddenRead|hidden_read|hiddenSearch|hidden_search|search|glob|regex|index|indexing|packageInstall|package_install|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoFix|auto_fix|autoRepair|auto_repair)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|body|diff|patch)|file[_ -]?(?:body|content)|provider|shell|command|cwd|\benv\b|\bgit\b|\btool\b|network|package[_ -]?install|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|verify|fix|repair)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function buildControlledAgentCommandRunRequest(input: unknown): ControlledAgentCommandRunRequestResult {
  const diagnostics: ControlledAgentCommandRunRequestDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Controlled command-run request metadata is absent."));
    return requestBlocked("blocked", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as ControlledAgentCommandRunRequestInput;
  const host = metadata.host;
  if (host === "browser") {
    diagnostics.push(diagnostic("browser_host", "Browser preview cannot post controlled command-run requests."));
  } else if (host !== "vscode" && host !== "jetbrains") {
    diagnostics.push(diagnostic("unsupported_host", "Controlled command-run requests require a supported IDE host."));
  }

  const runtime = evaluateControlledAgentRuntimeSession(metadata.runtimeSessionMetadata);
  const readiness = evaluateControlledAgentWorkspaceReadiness(metadata.workspaceReadinessMetadata);
  if (runtime.status !== "ready_to_start" && runtime.status !== "start_requested_metadata" && runtime.status !== "session_open_metadata") {
    diagnostics.push(diagnostic("runtime_session_not_ready", "Controlled command-run requires ready runtime session metadata."));
  }
  if (readiness.state !== "ready_for_future_controlled_mode") {
    diagnostics.push(diagnostic("workspace_not_ready", "Controlled command-run requires ready workspace metadata."));
  }

  const source = extractSource(metadata.runtimeSessionMetadata, metadata.workspaceReadinessMetadata, metadata.plannedCommandRunMetadata);
  if (source.assistantMinted) {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Assistant-minted metadata cannot request controlled command runs."));
  }
  if (source.host && source.host !== host) {
    diagnostics.push(diagnostic("unsupported_host", "Controlled command-run host metadata does not match the active host."));
  }

  const commandId = safeCommandId(metadata.commandId) ?? safeCommandId(isPlainObject(metadata.plannedCommandRunMetadata) ? metadata.plannedCommandRunMetadata.commandId : undefined);
  if ((metadata.commandId !== undefined || (isPlainObject(metadata.plannedCommandRunMetadata) && metadata.plannedCommandRunMetadata.commandId !== undefined)) && !commandId) {
    diagnostics.push(diagnostic("unsupported_command", "Controlled command-run requires an allowlisted command id."));
  }
  if (metadata.userConfirmed !== true && !(isPlainObject(metadata.plannedCommandRunMetadata) && metadata.plannedCommandRunMetadata.userConfirmed === true)) {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Controlled command-run requires explicit user confirmation."));
  }
  if (!commandId) {
    diagnostics.push(diagnostic("command_not_ready", "Controlled command-run requires safe command metadata."));
  }

  const requestId = buildRequestId(source.runId, source.controlledWorkspaceId, commandId, metadata.requestSeed);
  const details = requestDetails(requestId, source.runId, source.controlledWorkspaceId, source.workspaceReadinessId, commandId, host);
  if (diagnostics.length > 0 || !source.runId || !source.controlledWorkspaceId || !source.runtimeSessionId || !source.workspaceReadinessId || !commandId || !requestId) {
    return requestBlocked(diagnostics.some((item) => item.code === "unsupported_host" || item.code === "browser_host") ? "unsupported" : "blocked", diagnostics, details);
  }

  const bridgeRequest: ControlledAgentCommandRunBridgeRequest = {
    version: "2026-05-15",
    type: "gui.controlledAgentCommandRunRequest",
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
      commandId,
      limits: defaultLimits,
      policyFlags,
    },
  };
  const correlation: ControlledAgentCommandRunRequestCorrelation = { requestId, runId: source.runId, controlledWorkspaceId: source.controlledWorkspaceId, runtimeSessionId: source.runtimeSessionId, workspaceReadinessId: source.workspaceReadinessId, commandId };
  return { state: "ready", bridgeRequest, correlation, diagnostics: [], details, authority };
}

export function correlateControlledAgentCommandRunResult(input: unknown): ControlledAgentCommandRunResultCorrelationResult {
  const diagnostics: ControlledAgentCommandRunRequestDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command-run result correlation metadata must be an object."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics, { allowOutputTail: true });
  const metadata = input as Partial<ControlledAgentCommandRunResultInput>;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command-run result requires current safe correlation metadata."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  if (diagnostics.length > 0) {
    return resultBlocked(diagnostics, resultDetails(current, undefined, undefined, undefined, undefined, undefined));
  }

  const hostMessage = isPlainObject(metadata.hostMessage) ? metadata.hostMessage : undefined;
  const hostRequestId = safeId(hostMessage?.requestId);
  const payload = isPlainObject(hostMessage?.payload) ? sanitizeResultPayload(hostMessage.payload) : undefined;
  const payloadRequestId = payload?.requestId;
  const payloadRunId = payload?.runId;
  const payloadWorkspaceId = payload?.controlledWorkspaceId;
  const payloadRuntimeSessionId = payload?.runtimeSessionId;
  const payloadReadinessId = payload?.workspaceReadinessId;
  const payloadCommandId = payload?.commandId;

  if (hostMessage?.type !== "host.controlledAgentCommandRunResult" || !hostRequestId || hostRequestId !== current.requestId || payloadRequestId !== current.requestId || payloadRunId !== current.runId || payloadWorkspaceId !== current.controlledWorkspaceId || payloadRuntimeSessionId !== current.runtimeSessionId || payloadReadinessId !== current.workspaceReadinessId || payloadCommandId !== current.commandId) {
    diagnostics.push(diagnostic("stale_result", "Ignored controlled command-run result that does not match request, run, workspace, runtime, readiness, and command ids."));
    return { state: "ignored", diagnostics, details: resultDetails(current, undefined, hostRequestId, payloadRunId, payloadWorkspaceId, payloadCommandId), authority };
  }

  if (metadata.existingResult && isTerminalStatus(metadata.existingResult.status)) {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate controlled command-run result ignored after the first terminal result."));
    return { state: "duplicate", commandRun: sanitizeExistingResult(metadata.existingResult), diagnostics, details: resultDetails(current, metadata.existingResult.status, hostRequestId, payloadRunId, payloadWorkspaceId, payloadCommandId), authority };
  }

  if (!payload || !resultAuthorityIsSafe(payload)) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled command-run host result is blocked because authority widened or metadata is malformed."));
    return resultBlocked(diagnostics, resultDetails(current, payload?.status, hostRequestId, payloadRunId, payloadWorkspaceId, payloadCommandId));
  }

  const commandRun = normalizeCommandRun(payload);
  return { state: "accepted", commandRun, diagnostics: [], details: resultDetails(current, commandRun.status, hostRequestId, payloadRunId, payloadWorkspaceId, payloadCommandId), authority };
}

function extractSource(runtimeInput: unknown, readinessInput: unknown, commandInput: unknown): { runId?: string; controlledWorkspaceId?: string; runtimeSessionId?: string; workspaceReadinessId?: string; host?: "vscode" | "jetbrains" | "browser"; assistantMinted: boolean } {
  const runtime = isPlainObject(runtimeInput) ? runtimeInput : undefined;
  const workspace = isPlainObject(runtime?.workspace) ? runtime.workspace : undefined;
  const session = isPlainObject(runtime?.session) ? runtime.session : undefined;
  const hostRecord = isPlainObject(runtime?.host) ? runtime.host : undefined;
  const preconditions = isPlainObject(runtime?.preconditions) ? runtime.preconditions : undefined;
  const optIn = isPlainObject(preconditions?.optIn) ? preconditions.optIn : undefined;
  const readiness = isPlainObject(readinessInput) ? readinessInput : undefined;
  const readinessOptIn = isPlainObject(readiness?.optIn) ? readiness.optIn : undefined;
  const isolation = isPlainObject(readiness?.isolation) ? readiness.isolation : undefined;
  const command = isPlainObject(commandInput) ? commandInput : undefined;
  const runId = safeId(command?.runId) ?? safeId(session?.sessionId);
  const readinessId = safeId(command?.workspaceReadinessId) ?? safeId(workspace?.readinessId) ?? safeId(isolation?.readinessId);
  return {
    runId,
    controlledWorkspaceId: safeId(workspace?.controlledWorkspaceId),
    runtimeSessionId: safeId(session?.sessionId),
    workspaceReadinessId: readinessId,
    host: hostRecord?.kind === "vscode" || hostRecord?.kind === "jetbrains" || hostRecord?.kind === "browser" ? hostRecord.kind : undefined,
    assistantMinted: optIn?.assistantMinted === true || optIn?.origin === "assistant" || optIn?.confirmedBy === "assistant" || optIn?.requestIdMintedBy === "assistant" || readinessOptIn?.origin === "assistant" || readinessOptIn?.confirmedBy === "assistant" || readinessOptIn?.requestIdMintedBy === "assistant" || command?.assistantMinted === true || command?.requestIdMintedBy === "assistant",
  };
}

function sanitizeResultPayload(value: Record<string, unknown>): (ControlledAgentCommandRunResultSummary & ControlledAgentCommandRunRequestCorrelation & { requestIdMintedBy: string; userConfirmed: boolean; authority: string; cloudRequired: boolean; executionAllowed: boolean; freeformCommandAllowed: boolean; policyFlags: Record<string, unknown> }) | undefined {
  const status = safeResultStatus(value.status);
  const commandId = safeCommandId(value.commandId);
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const runtimeSessionId = safeId(value.runtimeSessionId);
  const workspaceReadinessId = safeId(value.workspaceReadinessId);
  const message = safeDisplayText(value.message, 240);
  const policy = isPlainObject(value.policyFlags) ? value.policyFlags : undefined;
  if (!status || !commandId || !requestId || !runId || !controlledWorkspaceId || !runtimeSessionId || !workspaceReadinessId || !message || value.requestIdMintedBy !== "gui" || value.userConfirmed !== true || value.authority !== "allowlisted_command_id" || value.cloudRequired !== false || value.executionAllowed !== false || value.freeformCommandAllowed !== false || !policy) {
    return undefined;
  }
  const durationMs = boundedInteger(value.durationMs, 0, 1800000) ? value.durationMs : undefined;
  const exitCode = value.exitCode === null || boundedInteger(value.exitCode, 0, 255) ? value.exitCode : undefined;
  const outputTail = typeof value.outputTail === "string" ? safeOutputTail(value.outputTail) : undefined;
  const outputByteCount = boundedInteger(value.outputByteCount, 0, 20000) ? value.outputByteCount : undefined;
  const outputLineCount = boundedInteger(value.outputLineCount, 0, 400) ? value.outputLineCount : undefined;
  const resultHash = typeof value.resultHash === "string" && safeHashPattern.test(value.resultHash) ? value.resultHash : undefined;
  const truncated = typeof value.truncated === "boolean" ? value.truncated : undefined;
  if (status === "running") {
    if (exitCode !== undefined || outputTail !== undefined || outputByteCount !== undefined || outputLineCount !== undefined || resultHash !== undefined || truncated !== false || durationMs === undefined) return undefined;
  } else if (status === "blocked") {
    if (exitCode !== undefined || outputTail !== undefined || outputByteCount !== undefined || outputLineCount !== undefined || resultHash !== undefined || truncated !== false) return undefined;
  } else {
    if (durationMs === undefined || exitCode === undefined || outputTail === undefined || outputByteCount === undefined || outputLineCount === undefined || resultHash === undefined || truncated === undefined) return undefined;
    if (status === "succeeded" && exitCode !== 0) return undefined;
    if (status === "failed" && (typeof exitCode !== "number" || exitCode === 0)) return undefined;
    if ((status === "timed_out" || status === "killed") && exitCode !== null) return undefined;
  }
  return stripUndefined({ status, commandId, requestId, runId, controlledWorkspaceId, runtimeSessionId, workspaceReadinessId, requestIdMintedBy: "gui", userConfirmed: true, authority: "allowlisted_command_id", cloudRequired: false, executionAllowed: false, freeformCommandAllowed: false, policyFlags: policy, durationMs, exitCode, outputTail, outputByteCount, outputLineCount, resultHash, truncated, message });
}

function resultAuthorityIsSafe(payload: ReturnType<typeof sanitizeResultPayload>): boolean {
  if (!payload) return false;
  for (const [key, value] of Object.entries(payload.policyFlags)) {
    if (key === "allowlistedCommandIdOnly") {
      if (value !== true) return false;
    } else if (value !== false) {
      return false;
    }
  }
  return true;
}

function normalizeCommandRun(payload: NonNullable<ReturnType<typeof sanitizeResultPayload>>): ControlledAgentCommandRunResultSummary {
  return stripUndefined({ status: payload.status, commandId: payload.commandId, durationMs: payload.durationMs, exitCode: payload.exitCode, outputTail: payload.outputTail, outputByteCount: payload.outputByteCount, outputLineCount: payload.outputLineCount, resultHash: payload.resultHash, truncated: payload.truncated, message: payload.message });
}

function sanitizeExistingResult(value: ControlledAgentCommandRunResultSummary): ControlledAgentCommandRunResultSummary {
  return stripUndefined({ status: safeResultStatus(value.status) ?? "blocked", commandId: safeCommandId(value.commandId) ?? "repository-check", durationMs: boundedInteger(value.durationMs, 0, 1800000) ? value.durationMs : undefined, exitCode: value.exitCode === null || boundedInteger(value.exitCode, 0, 255) ? value.exitCode : undefined, outputTail: typeof value.outputTail === "string" ? safeOutputTail(value.outputTail) : undefined, outputByteCount: boundedInteger(value.outputByteCount, 0, 20000) ? value.outputByteCount : undefined, outputLineCount: boundedInteger(value.outputLineCount, 0, 400) ? value.outputLineCount : undefined, resultHash: typeof value.resultHash === "string" && safeHashPattern.test(value.resultHash) ? value.resultHash : undefined, truncated: typeof value.truncated === "boolean" ? value.truncated : undefined, message: safeDisplayText(value.message, 240) ?? "Controlled command-run result." });
}

function sanitizeCorrelation(value: unknown): ControlledAgentCommandRunRequestCorrelation | undefined {
  if (!isPlainObject(value)) return undefined;
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const runtimeSessionId = safeId(value.runtimeSessionId);
  const workspaceReadinessId = safeId(value.workspaceReadinessId);
  const commandId = safeCommandId(value.commandId);
  return requestId && runId && controlledWorkspaceId && runtimeSessionId && workspaceReadinessId && commandId ? { requestId, runId, controlledWorkspaceId, runtimeSessionId, workspaceReadinessId, commandId } : undefined;
}

function buildRequestId(runId: string | undefined, workspaceId: string | undefined, commandId: ControlledAgentCommandRunCommandId | undefined, seed: unknown): string | undefined {
  if (!runId || !workspaceId || !commandId) return undefined;
  const safeSeed = typeof seed === "string" && safeIdPattern.test(seed) ? seed : "command-run";
  return `gui-s85-${stableHash(`${runId}:${workspaceId}:${commandId}:${safeSeed}`)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function requestDetails(requestId: string | undefined, runId: string | undefined, workspaceId: string | undefined, readinessId: string | undefined, commandId: ControlledAgentCommandRunCommandId | undefined, host: unknown): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId, runId, controlledWorkspaceId: workspaceId, workspaceReadinessId: readinessId, commandId, host, requestReady: requestId !== undefined });
}

function resultDetails(correlation: ControlledAgentCommandRunRequestCorrelation, state: string | undefined, hostRequestId: string | undefined, hostRunId: string | undefined, hostWorkspaceId: string | undefined, hostCommandId: ControlledAgentCommandRunCommandId | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId: correlation.requestId, hostRequestId, runId: correlation.runId, hostRunId, controlledWorkspaceId: correlation.controlledWorkspaceId, hostWorkspaceId, workspaceReadinessId: correlation.workspaceReadinessId, commandId: correlation.commandId, hostCommandId, resultState: state });
}

function requestBlocked(state: "blocked" | "unsupported", diagnostics: ControlledAgentCommandRunRequestDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentCommandRunRequestResult {
  return { state, diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function resultBlocked(diagnostics: ControlledAgentCommandRunRequestDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentCommandRunResultCorrelationResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentCommandRunRequestDiagnostic[], options: { allowOutputTail?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  const keyParts = keyPath.split(".");
  const currentKey = (keyParts[keyParts.length - 1] ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    const protocolTextAllowed = (currentKey === "type" && (value === "host.controlledAgentCommandRunResult" || value === "gui.controlledAgentCommandRunRequest")) || (currentKey === "authority" && value === "allowlisted_command_id") || (currentKey === "commandId" && safeCommandId(value) !== undefined);
    if (options.allowOutputTail && currentKey === "outputTail") {
      if (value !== "Command output hidden by host policy." && (unsafeTextPattern.test(value) || stackTracePattern.test(value))) diagnostics.push(diagnostic("unsafe_metadata", "Unsafe controlled command-run output tail omitted."));
      return;
    }
    if (!protocolTextAllowed && (unsafeTextPattern.test(value) || stackTracePattern.test(value))) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe controlled command-run metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
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
      if (unsafeKeyPattern.test(key) && !(options.allowOutputTail && key === "outputTail") && !(key === "policyFlags" || key.endsWith("Allowed"))) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported controlled command-run field ${sanitizeDisplayText(key)}.`));
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

function safeCommandId(value: unknown): ControlledAgentCommandRunCommandId | undefined {
  return typeof value === "string" && allowedCommandIds.has(value as ControlledAgentCommandRunCommandId) ? value as ControlledAgentCommandRunCommandId : undefined;
}

function safeResultStatus(value: unknown): ControlledAgentCommandRunResultState | undefined {
  return value === "running" || value === "succeeded" || value === "failed" || value === "timed_out" || value === "killed" || value === "blocked" ? value : undefined;
}

function isTerminalStatus(value: unknown): boolean {
  return value === "succeeded" || value === "failed" || value === "timed_out" || value === "killed" || value === "blocked";
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safeDisplayText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n\t<>]+/g, " ").trim();
  return sanitized.length > 0 && sanitized.length <= limit && !unsafeTextPattern.test(sanitized) && !stackTracePattern.test(sanitized) ? sanitizeDisplayText(sanitized) : undefined;
}

function safeOutputTail(value: string): string | undefined {
  const sanitized = sanitizeTimelineText(value).trim();
  if (sanitized !== "Command output hidden by host policy." && (unsafeTextPattern.test(sanitized) || stackTracePattern.test(sanitized))) return undefined;
  return sanitized.length > 1200 ? `…` : sanitized;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function diagnostic(code: ControlledAgentCommandRunRequestDiagnosticCode, message: string): ControlledAgentCommandRunRequestDiagnostic {
  return { code, message: safeText(message, 200) };
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
