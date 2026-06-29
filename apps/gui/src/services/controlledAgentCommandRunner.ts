import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";
import { toolAuthorityPolicyAllowlistedCommandIds, type ToolAuthorityPolicyAllowlistedCommandId } from "./toolAuthorityPolicy";

export type ControlledAgentCommandRunState = "disabled" | "blocked" | "running" | "succeeded" | "failed" | "timed_out" | "killed";

export type ControlledAgentCommandRunDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unknown_or_invalid_field"
  | "unsafe_metadata"
  | "unsafe_output_metadata"
  | "invalid_authority"
  | "assistant_authority"
  | "workspace_not_controlled"
  | "unknown_command_id"
  | "unbounded_limits"
  | "unbounded_output";

export type ControlledAgentCommandRunDiagnostic = {
  code: ControlledAgentCommandRunDiagnosticCode;
  message: string;
};

export type ControlledAgentCommandRunOutputTail = {
  outputTail: string;
  outputByteCount: number;
  outputLineCount: number;
  resultHash: string;
  truncated: boolean;
};

export type ControlledAgentCommandRunSummary = {
  state: ControlledAgentCommandRunState;
  status: ControlledAgentCommandRunState;
  allowedToRunCommand: boolean;
  canRunShell: false;
  canUseGit: false;
  canUseNetwork: false;
  canCallProvider: false;
  canUseTools: false;
  canReadFiles: false;
  canWriteFiles: false;
  commandId?: ToolAuthorityPolicyAllowlistedCommandId;
  commandIdLabel?: string;
  summary: string;
  diagnostics: ControlledAgentCommandRunDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  outputTail?: ControlledAgentCommandRunOutputTail;
};

type WorkspaceMode = "disposable" | "worktree" | "existing";
type Host = "vscode" | "jetbrains";
type RequestSource = "gui" | "host";
type CorrelationOrigin = "user" | "host";
type BlockedReason = "runner_disabled" | "policy_denied" | "unknown_command_id" | "missing_user_confirmation" | "untrusted_request_id" | "workspace_not_ready" | "timeout_exceeds_limit" | "output_limit_exceeds_limit";

type CommandRunWorkspace = {
  controlledWorkspaceId: string;
  runId: string;
  workspaceMode: WorkspaceMode;
  host: Host;
  privatePathExposed: boolean;
  workspaceLabel?: string;
};

type CommandRunCorrelation = {
  origin: CorrelationOrigin;
  confirmedBy: CorrelationOrigin;
  confirmationId: string;
  hostCorrelationId: string;
  confirmedAt?: string;
  label?: string;
};

type CommandRunLimits = {
  timeoutMs: number;
  maxOutputBytes: number;
  maxOutputLines: number;
  tailOnly: boolean;
  commandStringAllowed: boolean;
  argsAllowed: boolean;
  cwdAllowed: boolean;
  envAllowed: boolean;
  shellAllowed: boolean;
  limitLabel?: string;
};

type CommandRunRequest = {
  requestId: string;
  source: RequestSource;
  requestIdMintedBy: RequestSource;
  assistantMinted: boolean;
  correlation: CommandRunCorrelation;
  commandId: ToolAuthorityPolicyAllowlistedCommandId;
  limits: CommandRunLimits;
  requestedAt?: string;
  reason?: string;
};

type CommandRunPolicyFlags = {
  allowlistedCommandIdOnly: boolean;
  freeformCommandAllowed: boolean;
  argsAllowed: boolean;
  cwdAllowed: boolean;
  envAllowed: boolean;
  shellAllowed: boolean;
  gitAllowed: boolean;
  networkAllowed: boolean;
  providerAllowed: boolean;
  toolAllowed: boolean;
  packageInstallAllowed: boolean;
  fileReadAllowed: boolean;
  fileWriteAllowed: boolean;
  hiddenSearchAllowed: boolean;
  indexingAllowed: boolean;
  autoStartAllowed: boolean;
  autoApplyAllowed: boolean;
  autoRunAllowed: boolean;
  autoVerifyAllowed: boolean;
  autoFixAllowed: boolean;
};

type CommandRunResult = {
  status: ControlledAgentCommandRunState;
  cloudRequired: boolean;
  freeformCommandAllowed: boolean;
  exitCode?: number | null;
  durationMs?: number;
  truncated: boolean;
  outputTail?: string;
  outputByteCount?: number;
  outputLineCount?: number;
  resultHash?: string;
  blockedReason?: BlockedReason;
  message: string;
};

type CommandRunRecord = {
  kind: "controlled_agent_command_runner";
  version: "2026-06-29";
  authority: "allowlisted_command_id_metadata";
  cloudRequired: boolean;
  executionAllowed: boolean;
  freeformCommandAllowed: boolean;
  agentStartAllowed: boolean;
  workspace: CommandRunWorkspace;
  request: CommandRunRequest;
  policyFlags: CommandRunPolicyFlags;
  result: CommandRunResult;
};

const topLevelKeys = new Set(["kind", "version", "authority", "cloudRequired", "executionAllowed", "freeformCommandAllowed", "agentStartAllowed", "workspace", "request", "policyFlags", "result"]);
const workspaceKeys = new Set(["controlledWorkspaceId", "runId", "workspaceMode", "host", "privatePathExposed", "workspaceLabel"]);
const requestKeys = new Set(["requestId", "source", "requestIdMintedBy", "assistantMinted", "correlation", "commandId", "limits", "requestedAt", "reason"]);
const correlationKeys = new Set(["origin", "confirmedBy", "confirmationId", "hostCorrelationId", "confirmedAt", "label"]);
const limitKeys = new Set(["timeoutMs", "maxOutputBytes", "maxOutputLines", "tailOnly", "commandStringAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed", "limitLabel"]);
const policyFlagKeys = new Set(["allowlistedCommandIdOnly", "freeformCommandAllowed", "argsAllowed", "cwdAllowed", "envAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "providerAllowed", "toolAllowed", "packageInstallAllowed", "fileReadAllowed", "fileWriteAllowed", "hiddenSearchAllowed", "indexingAllowed", "autoStartAllowed", "autoApplyAllowed", "autoRunAllowed", "autoVerifyAllowed", "autoFixAllowed"]);
const resultKeys = new Set(["status", "cloudRequired", "freeformCommandAllowed", "exitCode", "durationMs", "truncated", "outputTail", "outputByteCount", "outputLineCount", "resultHash", "blockedReason", "message"]);
const workspaceModes = new Set<unknown>(["disposable", "worktree", "existing"]);
const hosts = new Set<unknown>(["vscode", "jetbrains"]);
const sources = new Set<unknown>(["gui", "host"]);
const correlationOrigins = new Set<unknown>(["user", "host"]);
const statuses = new Set<unknown>(["disabled", "blocked", "running", "succeeded", "failed", "timed_out", "killed"]);
const blockedReasons = new Set<unknown>(["runner_disabled", "policy_denied", "unknown_command_id", "missing_user_confirmation", "untrusted_request_id", "workspace_not_ready", "timeout_exceeds_limit", "output_limit_exceeds_limit"]);
const allowedCommandIds = new Set<unknown>(toolAuthorityPolicyAllowlistedCommandIds);
const commandLabels: Record<ToolAuthorityPolicyAllowlistedCommandId, string> = {
  "repository-check": "Repository check",
  "gui-app-tests": "GUI app tests",
  "engine-chat-tests": "Engine chat tests",
};
const safeIdPattern = /^(?!assistant(?:[._-]|$))(?!.*assistant)(?!.*sk-(?:proj-)?)[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/i;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider(?:[-_ ]?(?:payload|response))?|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|package[_ -]?install|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|verify|fix|repair)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const blockedKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerTool|provider_tool|tool|toolCall|tool_call|rawCommand|raw_command|rawArgs|raw_args|rawCwd|raw_cwd|rawEnv|raw_env|rawOutput|raw_output|rawLog|raw_log|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawDiff|raw_diff|privatePath|private_path|browserStorage|browser_storage|storageDump|storage_dump|packageInstall|package_install|hiddenRead|hidden_read|hiddenScan|hidden_scan|hiddenSearch|hidden_search|search|glob|regex|index|indexing|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoFix|auto_fix|autoRepair|auto_repair)$/i;

export function evaluateControlledAgentCommandRun(input: unknown): ControlledAgentCommandRunSummary {
  const diagnostics: ControlledAgentCommandRunDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push(diagnostic("missing_input", "Controlled command runner metadata is absent and remains disabled."));
    return buildEvaluation("disabled", false, "Controlled command runner is disabled.", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = parseCommandRun(input, diagnostics);
  if (!metadata) {
    return buildEvaluation("blocked", false, "Controlled command runner metadata is blocked because it is malformed.", diagnostics, { displayOnly: true });
  }

  validateCommandRun(metadata, diagnostics);
  const details = buildDetails(metadata);
  if (hasBlockingDiagnostics(diagnostics)) {
    return buildEvaluation("blocked", false, "Controlled command runner metadata is blocked. Raw payload omitted.", diagnostics, details, metadata);
  }

  const allowedToRunCommand = metadata.result.status !== "disabled" && metadata.result.status !== "blocked";
  return buildEvaluation(metadata.result.status, allowedToRunCommand, sanitizeBoundedText(metadata.result.message, 240, defaultSummary(metadata.result.status)), diagnostics, details, metadata);
}

function parseCommandRun(input: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[]): CommandRunRecord | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, topLevelKeys, diagnostics);
  const workspace = parseWorkspace(input.workspace, diagnostics);
  const request = parseRequest(input.request, diagnostics);
  const policyFlags = parsePolicyFlags(input.policyFlags, diagnostics);
  const result = parseResult(input.result, diagnostics);
  if (input.kind !== "controlled_agent_command_runner" || input.version !== "2026-06-29" || input.authority !== "allowlisted_command_id_metadata" || !workspace || !request || !policyFlags || !result) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner metadata does not match the S75 contract."));
    return undefined;
  }
  return {
    kind: "controlled_agent_command_runner",
    version: "2026-06-29",
    authority: "allowlisted_command_id_metadata",
    cloudRequired: input.cloudRequired === false ? false : input.cloudRequired as boolean,
    executionAllowed: input.executionAllowed === false ? false : input.executionAllowed as boolean,
    freeformCommandAllowed: input.freeformCommandAllowed === false ? false : input.freeformCommandAllowed as boolean,
    agentStartAllowed: input.agentStartAllowed === false ? false : input.agentStartAllowed as boolean,
    workspace,
    request,
    policyFlags,
    result,
  };
}

function parseWorkspace(input: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[]): CommandRunWorkspace | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner workspace metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, workspaceKeys, diagnostics);
  const workspaceMode = workspaceModes.has(input.workspaceMode) ? input.workspaceMode as WorkspaceMode : undefined;
  const host = hosts.has(input.host) ? input.host as Host : undefined;
  if (!safeId(input.controlledWorkspaceId) || !safeId(input.runId) || !workspaceMode || !host || typeof input.privatePathExposed !== "boolean") {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner workspace metadata is invalid."));
    return undefined;
  }
  return { controlledWorkspaceId: input.controlledWorkspaceId, runId: input.runId, workspaceMode, host, privatePathExposed: input.privatePathExposed, workspaceLabel: typeof input.workspaceLabel === "string" ? input.workspaceLabel : undefined };
}

function parseRequest(input: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[]): CommandRunRequest | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner request metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, requestKeys, diagnostics);
  const source = sources.has(input.source) ? input.source as RequestSource : undefined;
  const requestIdMintedBy = sources.has(input.requestIdMintedBy) ? input.requestIdMintedBy as RequestSource : undefined;
  const commandId = allowedCommandIds.has(input.commandId) ? input.commandId as ToolAuthorityPolicyAllowlistedCommandId : undefined;
  const correlation = parseCorrelation(input.correlation, diagnostics);
  const limits = parseLimits(input.limits, diagnostics);
  if (input.assistantMinted === true || (typeof input.requestId === "string" && input.requestId.toLowerCase().includes("assistant"))) {
    diagnostics.push(diagnostic("assistant_authority", "Assistant-minted controlled command runner requests cannot grant command eligibility."));
  }
  if (input.commandId !== undefined && !commandId) {
    diagnostics.push(diagnostic("unknown_command_id", "Controlled command runner requires a known allowlisted command id."));
  }
  if (!safeId(input.requestId) || !source || !requestIdMintedBy || typeof input.assistantMinted !== "boolean" || !correlation || !commandId || !limits || (input.requestedAt !== undefined && typeof input.requestedAt !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner request metadata is invalid."));
    return undefined;
  }
  return { requestId: input.requestId, source, requestIdMintedBy, assistantMinted: input.assistantMinted, correlation, commandId, limits, requestedAt: input.requestedAt, reason: typeof input.reason === "string" ? input.reason : undefined };
}

function parseCorrelation(input: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[]): CommandRunCorrelation | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner correlation metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, correlationKeys, diagnostics);
  const origin = correlationOrigins.has(input.origin) ? input.origin as CorrelationOrigin : undefined;
  const confirmedBy = correlationOrigins.has(input.confirmedBy) ? input.confirmedBy as CorrelationOrigin : undefined;
  if (!origin || !confirmedBy || !safeId(input.confirmationId) || !safeId(input.hostCorrelationId) || (input.confirmedAt !== undefined && typeof input.confirmedAt !== "string")) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner correlation metadata is invalid."));
    return undefined;
  }
  return { origin, confirmedBy, confirmationId: input.confirmationId, hostCorrelationId: input.hostCorrelationId, confirmedAt: input.confirmedAt, label: typeof input.label === "string" ? input.label : undefined };
}

function parseLimits(input: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[]): CommandRunLimits | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner limits metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, limitKeys, diagnostics);
  if (!boundedInteger(input.timeoutMs, 1000, 1800000) || !boundedInteger(input.maxOutputBytes, 1, 20000) || !boundedInteger(input.maxOutputLines, 1, 400) || typeof input.tailOnly !== "boolean" || typeof input.commandStringAllowed !== "boolean" || typeof input.argsAllowed !== "boolean" || typeof input.cwdAllowed !== "boolean" || typeof input.envAllowed !== "boolean" || typeof input.shellAllowed !== "boolean") {
    diagnostics.push(diagnostic("unbounded_limits", "Controlled command runner limits must be bounded command-id metadata."));
    return undefined;
  }
  return { timeoutMs: input.timeoutMs, maxOutputBytes: input.maxOutputBytes, maxOutputLines: input.maxOutputLines, tailOnly: input.tailOnly, commandStringAllowed: input.commandStringAllowed, argsAllowed: input.argsAllowed, cwdAllowed: input.cwdAllowed, envAllowed: input.envAllowed, shellAllowed: input.shellAllowed, limitLabel: typeof input.limitLabel === "string" ? input.limitLabel : undefined };
}

function parsePolicyFlags(input: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[]): CommandRunPolicyFlags | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner policy flags must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, policyFlagKeys, diagnostics);
  for (const key of policyFlagKeys) {
    if (typeof input[key] !== "boolean") {
      diagnostics.push(diagnostic("malformed_input", "Controlled command runner policy flags are invalid."));
      return undefined;
    }
  }
  return input as CommandRunPolicyFlags;
}

function parseResult(input: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[]): CommandRunResult | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner result metadata must be an object."));
    return undefined;
  }
  rejectUnknownKeys(input, resultKeys, diagnostics);
  const status = statuses.has(input.status) ? input.status as ControlledAgentCommandRunState : undefined;
  const blockedReason = input.blockedReason === undefined ? undefined : blockedReasons.has(input.blockedReason) ? input.blockedReason as BlockedReason : undefined;
  if (!status || typeof input.cloudRequired !== "boolean" || typeof input.freeformCommandAllowed !== "boolean" || typeof input.truncated !== "boolean" || typeof input.message !== "string" || (input.exitCode !== undefined && input.exitCode !== null && !boundedInteger(input.exitCode, 0, 255)) || (input.durationMs !== undefined && !boundedInteger(input.durationMs, 0, 1800000)) || (input.outputTail !== undefined && typeof input.outputTail !== "string") || (input.outputByteCount !== undefined && !boundedInteger(input.outputByteCount, 0, 20000)) || (input.outputLineCount !== undefined && !boundedInteger(input.outputLineCount, 0, 400)) || (input.resultHash !== undefined && (typeof input.resultHash !== "string" || !safeHashPattern.test(input.resultHash))) || (input.blockedReason !== undefined && !blockedReason)) {
    diagnostics.push(diagnostic("malformed_input", "Controlled command runner result metadata is invalid."));
    return undefined;
  }
  return { status, cloudRequired: input.cloudRequired, freeformCommandAllowed: input.freeformCommandAllowed, exitCode: input.exitCode, durationMs: input.durationMs, truncated: input.truncated, outputTail: input.outputTail, outputByteCount: input.outputByteCount, outputLineCount: input.outputLineCount, resultHash: input.resultHash, blockedReason, message: input.message };
}

function validateCommandRun(metadata: CommandRunRecord, diagnostics: ControlledAgentCommandRunDiagnostic[]): void {
  if (metadata.cloudRequired !== false || metadata.executionAllowed !== false || metadata.freeformCommandAllowed !== false || metadata.agentStartAllowed !== false || metadata.result.cloudRequired !== false || metadata.result.freeformCommandAllowed !== false) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled command runner metadata cannot require cloud, execution, free-form command, or agent start authority."));
  }
  if (metadata.request.assistantMinted || metadata.request.requestId.toLowerCase().includes("assistant") || metadata.request.correlation.confirmationId.toLowerCase().includes("assistant")) {
    diagnostics.push(diagnostic("assistant_authority", "Assistant-minted controlled command runner requests cannot grant command eligibility."));
  }
  if (metadata.workspace.privatePathExposed !== false || metadata.workspace.workspaceMode === "existing") {
    diagnostics.push(diagnostic("workspace_not_controlled", "Controlled command runner requires an isolated host-owned disposable workspace or worktree."));
  }
  validateLimits(metadata.request.limits, diagnostics);
  validatePolicyFlags(metadata.policyFlags, diagnostics);
  validateResult(metadata, diagnostics);
}

function validateLimits(limits: CommandRunLimits, diagnostics: ControlledAgentCommandRunDiagnostic[]): void {
  if (limits.tailOnly !== true || limits.commandStringAllowed !== false || limits.argsAllowed !== false || limits.cwdAllowed !== false || limits.envAllowed !== false || limits.shellAllowed !== false) {
    diagnostics.push(diagnostic("unbounded_limits", "Controlled command runner limits cannot allow command strings, args, cwd, env, shell, or full output."));
  }
}

function validatePolicyFlags(policyFlags: CommandRunPolicyFlags, diagnostics: ControlledAgentCommandRunDiagnostic[]): void {
  const deniedFlags = [policyFlags.freeformCommandAllowed, policyFlags.argsAllowed, policyFlags.cwdAllowed, policyFlags.envAllowed, policyFlags.shellAllowed, policyFlags.gitAllowed, policyFlags.networkAllowed, policyFlags.providerAllowed, policyFlags.toolAllowed, policyFlags.packageInstallAllowed, policyFlags.fileReadAllowed, policyFlags.fileWriteAllowed, policyFlags.hiddenSearchAllowed, policyFlags.indexingAllowed, policyFlags.autoStartAllowed, policyFlags.autoApplyAllowed, policyFlags.autoRunAllowed, policyFlags.autoVerifyAllowed, policyFlags.autoFixAllowed];
  if (policyFlags.allowlistedCommandIdOnly !== true || deniedFlags.some((value) => value !== false)) {
    diagnostics.push(diagnostic("invalid_authority", "Controlled command runner policy flags cannot grant shell, args, cwd, env, git, network, provider, tool, file, hidden search, install, or automation authority."));
  }
}

function validateResult(metadata: CommandRunRecord, diagnostics: ControlledAgentCommandRunDiagnostic[]): void {
  const result = metadata.result;
  if (result.status === "disabled" || result.status === "blocked") {
    if (result.exitCode !== undefined || result.durationMs !== undefined || result.outputTail !== undefined || result.outputByteCount !== undefined || result.outputLineCount !== undefined || result.resultHash !== undefined || result.truncated !== false || !result.blockedReason) {
      diagnostics.push(diagnostic("invalid_authority", "Disabled or blocked controlled command runs cannot include output metadata."));
    }
    return;
  }
  if (result.status === "running") {
    if (result.exitCode !== undefined || result.outputTail !== undefined || result.resultHash !== undefined || result.truncated !== false || result.durationMs === undefined) {
      diagnostics.push(diagnostic("invalid_authority", "Running controlled command runs can include only bounded duration metadata."));
    }
    return;
  }
  if (result.durationMs === undefined || result.outputTail === undefined || result.outputByteCount === undefined || result.outputLineCount === undefined || result.resultHash === undefined) {
    diagnostics.push(diagnostic("unbounded_output", "Terminal controlled command runs require bounded output tail metadata."));
    return;
  }
  if (result.durationMs > metadata.request.limits.timeoutMs || result.outputByteCount > metadata.request.limits.maxOutputBytes || result.outputLineCount > metadata.request.limits.maxOutputLines || result.outputTail.length > metadata.request.limits.maxOutputBytes || result.outputTail.length > 2000) {
    diagnostics.push(diagnostic("unbounded_output", "Controlled command runner output exceeds the requested bounded limits."));
  }
  if (result.status === "succeeded" && result.exitCode !== 0) {
    diagnostics.push(diagnostic("invalid_authority", "Succeeded controlled command runs require exit code 0."));
  }
  if (result.status === "failed" && (typeof result.exitCode !== "number" || result.exitCode === 0)) {
    diagnostics.push(diagnostic("invalid_authority", "Failed controlled command runs require a non-zero bounded exit code."));
  }
  if ((result.status === "timed_out" || result.status === "killed") && result.exitCode !== null) {
    diagnostics.push(diagnostic("invalid_authority", "Timed out and killed controlled command runs require a null exit code."));
  }
  if (unsafeTextPattern.test(result.outputTail) || stackTracePattern.test(result.outputTail)) {
    diagnostics.push(diagnostic("unsafe_output_metadata", "Controlled command runner output tail contains unsafe, private, or secret metadata."));
  }
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentCommandRunDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  const keyParts = keyPath.split(".");
  const currentKey = (keyParts[keyParts.length - 1] ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    if (currentKey === "outputTail") {
      if (unsafeTextPattern.test(value) || stackTracePattern.test(value)) {
        diagnostics.push(diagnostic("unsafe_output_metadata", "Controlled command runner output tail contains unsafe, private, or secret metadata."));
      }
      return;
    }
    if (unsafeTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", "Unsafe controlled command runner metadata was omitted."));
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
        diagnostics.push(diagnostic("unsafe_metadata", "Unsupported controlled command runner execution authority field."));
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function buildEvaluation(state: ControlledAgentCommandRunState, allowedToRunCommand: boolean, summary: string, diagnostics: ControlledAgentCommandRunDiagnostic[], details: Record<string, string | number | boolean | string[]>, metadata?: CommandRunRecord): ControlledAgentCommandRunSummary {
  const blocked = hasBlockingDiagnostics(diagnostics);
  const safeState = blocked ? "blocked" : state;
  const outputTail = !blocked && metadata ? buildOutputTail(metadata) : undefined;
  return {
    state: safeState,
    status: safeState,
    allowedToRunCommand: blocked ? false : allowedToRunCommand,
    canRunShell: false,
    canUseGit: false,
    canUseNetwork: false,
    canCallProvider: false,
    canUseTools: false,
    canReadFiles: false,
    canWriteFiles: false,
    commandId: metadata?.request.commandId,
    commandIdLabel: metadata ? sanitizeBoundedText(commandLabels[metadata.request.commandId], 100, "Allowlisted command") : undefined,
    summary: sanitizeBoundedText(blocked ? `${summary} [redacted]` : summary, 240, "Controlled command runner is blocked."),
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: sanitizeDetails(blocked && diagnostics.some((item) => item.code === "unsafe_metadata" || item.code === "unsafe_output_metadata") ? { ...details, redacted: "[redacted]" } : details),
    outputTail,
  };
}

function buildOutputTail(metadata: CommandRunRecord): ControlledAgentCommandRunOutputTail | undefined {
  const result = metadata.result;
  if (result.outputTail === undefined || result.outputByteCount === undefined || result.outputLineCount === undefined || result.resultHash === undefined) {
    return undefined;
  }
  return {
    outputTail: sanitizeBoundedText(result.outputTail, Math.min(metadata.request.limits.maxOutputBytes, 2000), "[redacted]"),
    outputByteCount: result.outputByteCount,
    outputLineCount: result.outputLineCount,
    resultHash: result.resultHash,
    truncated: result.truncated,
  };
}

function buildDetails(metadata: CommandRunRecord): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({
    displayOnly: true,
    workspaceMode: metadata.workspace.workspaceMode,
    host: metadata.workspace.host,
    workspaceLabel: metadata.workspace.workspaceLabel,
    requestSource: metadata.request.source,
    requestIdMintedBy: metadata.request.requestIdMintedBy,
    correlationOrigin: metadata.request.correlation.origin,
    confirmedBy: metadata.request.correlation.confirmedBy,
    commandId: metadata.request.commandId,
    commandIdLabel: commandLabels[metadata.request.commandId],
    timeoutMs: metadata.request.limits.timeoutMs,
    maxOutputBytes: metadata.request.limits.maxOutputBytes,
    maxOutputLines: metadata.request.limits.maxOutputLines,
    tailOnly: metadata.request.limits.tailOnly,
    resultStatus: metadata.result.status,
    blockedReason: metadata.result.blockedReason,
    exitCode: metadata.result.exitCode,
    durationMs: metadata.result.durationMs,
    outputByteCount: metadata.result.outputByteCount,
    outputLineCount: metadata.result.outputLineCount,
  });
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>, diagnostics: ControlledAgentCommandRunDiagnostic[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push(diagnostic("unknown_or_invalid_field", "Unsupported controlled command runner metadata field."));
    }
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 28)) {
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

function hasBlockingDiagnostics(diagnostics: ControlledAgentCommandRunDiagnostic[]): boolean {
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

function diagnostic(code: ControlledAgentCommandRunDiagnosticCode, message: string): ControlledAgentCommandRunDiagnostic {
  return { code, message: sanitizeBoundedText(message, 200, "Controlled command runner blocked.") };
}

function defaultSummary(state: ControlledAgentCommandRunState): string {
  if (state === "succeeded") {
    return "Allowlisted command completed successfully.";
  }
  if (state === "failed") {
    return "Allowlisted command returned a failure status.";
  }
  if (state === "timed_out") {
    return "Allowlisted command reached its time limit.";
  }
  if (state === "killed") {
    return "Allowlisted command was stopped before completion.";
  }
  if (state === "running") {
    return "Allowlisted command is running.";
  }
  if (state === "disabled") {
    return "Controlled command runner is disabled.";
  }
  return "Controlled command runner is blocked.";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
