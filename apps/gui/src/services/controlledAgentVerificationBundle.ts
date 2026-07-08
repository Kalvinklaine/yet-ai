import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";
import { toolAuthorityPolicyAllowlistedCommandIds, type ToolAuthorityPolicyAllowlistedCommandId } from "./toolAuthorityPolicy";

export type ControlledAgentVerificationBundleCommandId = ToolAuthorityPolicyAllowlistedCommandId;
export type ControlledAgentVerificationBundleState = "planned" | "running" | "succeeded" | "failed" | "timed_out" | "killed" | "blocked";
export type ControlledAgentVerificationBundleDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unsupported_host"
  | "browser_host"
  | "missing_confirmation"
  | "assistant_authority_blocked"
  | "unsupported_command"
  | "unbounded_sequence"
  | "unbounded_timeout"
  | "unbounded_output"
  | "unsafe_metadata"
  | "invalid_authority"
  | "stale_result"
  | "duplicate_result";

export type ControlledAgentVerificationBundleDiagnostic = {
  code: ControlledAgentVerificationBundleDiagnosticCode;
  message: string;
};

export type ControlledAgentVerificationBundleAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  freeformCommandAllowed: false;
  canRunShell: false;
  canUseArgs: false;
  canSetCwd: false;
  canSetEnv: false;
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

export type ControlledAgentVerificationBundleCommandSummary = {
  stepId: string;
  sequenceIndex: number;
  commandId: ControlledAgentVerificationBundleCommandId;
  timeoutMs: number;
  maxOutputBytes: number;
  maxOutputLines: number;
  status: ControlledAgentVerificationBundleState;
  exitCode?: number | null;
  durationMs?: number;
  outputTail?: string;
  outputByteCount?: number;
  outputLineCount?: number;
  truncated?: boolean;
  resultHash?: string;
  summary: string;
};

export type ControlledAgentVerificationBundleEvaluation = {
  state: "accepted" | "blocked";
  status?: ControlledAgentVerificationBundleState;
  bundleId?: string;
  runId?: string;
  controlledWorkspaceId?: string;
  workspaceReadinessId?: string;
  commandCount?: number;
  commands: ControlledAgentVerificationBundleCommandSummary[];
  diagnostics: ControlledAgentVerificationBundleDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentVerificationBundleAuthority;
};

export type ControlledAgentVerificationBundleRequestInput = {
  host: "browser" | "vscode" | "jetbrains";
  bundleMetadata?: unknown;
  userConfirmed?: unknown;
  requestSeed?: unknown;
};

export type ControlledAgentVerificationBundleBridgeRequest = {
  version: "2026-05-15";
  type: "gui.controlledAgentVerificationBundleRequest";
  requestId: string;
  payload: {
    requestId: string;
    requestIdMintedBy: "gui";
    source: "gui";
    assistantMinted: false;
    controlledWorkspaceId: string;
    runId: string;
    workspaceReadinessId?: string;
    bundleId: string;
    userConfirmed: true;
    confirmationKind: "explicit_user_verification_bundle";
    commandIds: ControlledAgentVerificationBundleCommandId[];
    limits: {
      maxCommands: 3;
      maxTimeoutMs: 1800000;
      maxOutputBytes: 20000;
      maxOutputLines: 400;
      tailOnly: true;
      commandStringAllowed: false;
      argsAllowed: false;
      cwdAllowed: false;
      envAllowed: false;
      shellAllowed: false;
    };
    policyFlags: ControlledAgentVerificationBundlePolicyFlags;
  };
};

export type ControlledAgentVerificationBundleRequestCorrelation = {
  requestId: string;
  runId: string;
  controlledWorkspaceId: string;
  workspaceReadinessId?: string;
  bundleId: string;
  commandIds: ControlledAgentVerificationBundleCommandId[];
};

export type ControlledAgentVerificationBundleRequestResult = {
  state: "ready" | "blocked" | "unsupported";
  bridgeRequest?: ControlledAgentVerificationBundleBridgeRequest;
  correlation?: ControlledAgentVerificationBundleRequestCorrelation;
  diagnostics: ControlledAgentVerificationBundleDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentVerificationBundleAuthority;
};

export type ControlledAgentVerificationBundleCorrelationResult = {
  state: "accepted" | "ignored" | "duplicate" | "blocked";
  bundle?: ControlledAgentVerificationBundleEvaluation;
  diagnostics: ControlledAgentVerificationBundleDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentVerificationBundleAuthority;
};

type ControlledAgentVerificationBundlePolicyFlags = {
  allowlistedCommandIdsOnly: true;
  boundedSequenceOnly: true;
  explicitUserConfirmationRequired: true;
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
  productionClaimAllowed: false;
  releaseClaimAllowed: false;
};

const authority: ControlledAgentVerificationBundleAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  freeformCommandAllowed: false,
  canRunShell: false,
  canUseArgs: false,
  canSetCwd: false,
  canSetEnv: false,
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

const policyFlags: ControlledAgentVerificationBundlePolicyFlags = {
  allowlistedCommandIdsOnly: true,
  boundedSequenceOnly: true,
  explicitUserConfirmationRequired: true,
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
  productionClaimAllowed: false,
  releaseClaimAllowed: false,
};

const allowedCommandIds = new Set<ControlledAgentVerificationBundleCommandId>(toolAuthorityPolicyAllowlistedCommandIds);
const safeIdPattern = /^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/i;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const unsafeKeyPattern = /^(?:command|cmd|commandString|rawCommand|args|arguments|cwd|env|environment|shell|git|network|provider|tool|package|packageInstall|rawOutput|rawLog|rawFile|fileBody|fileContents|secret|token|authorization|autoRun|autoVerify|autoStart|autoApply|autoFix|autoRepair)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider|shell|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|package[_ -]?install|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|verify|fix|repair)|production|release|marketplace|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function evaluateControlledAgentVerificationBundle(input: unknown): ControlledAgentVerificationBundleEvaluation {
  const diagnostics: ControlledAgentVerificationBundleDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Verification bundle metadata is absent."));
    return evaluationBlocked(diagnostics, { displayOnly: true }, []);
  }

  scanUnsafeMetadata(input, diagnostics, { allowOutputTail: true });
  const workspace = isPlainObject(input.workspace) ? input.workspace : undefined;
  const confirmation = isPlainObject(input.confirmation) ? input.confirmation : undefined;
  const bundle = isPlainObject(input.bundle) ? input.bundle : undefined;
  const aggregate = isPlainObject(input.aggregateResult) ? input.aggregateResult : undefined;
  const commandsInput = Array.isArray(bundle?.commands) ? bundle.commands : [];
  const commands = commandsInput.map(parseCommand).filter((item): item is ControlledAgentVerificationBundleCommandSummary => item !== undefined);

  const bundleId = safeId(bundle?.bundleId);
  const runId = safeId(workspace?.runId);
  const controlledWorkspaceId = safeId(workspace?.controlledWorkspaceId);
  const workspaceReadinessId = safeId(workspace?.workspaceReadinessId);
  const status = safeStatus(aggregate?.status);
  const commandCount = boundedInteger(aggregate?.commandCount, 1, 3) ? aggregate.commandCount : undefined;

  if (!hasBundleShape(input, workspace, confirmation, bundle, aggregate) || !bundleId || !runId || !controlledWorkspaceId || !status) {
    diagnostics.push(diagnostic("malformed_input", "Verification bundle metadata does not match the S117 metadata shape."));
  }
  if (confirmation?.userConfirmed !== true || confirmation?.confirmedBy !== "user" || confirmation?.required !== true) {
    diagnostics.push(diagnostic("missing_confirmation", "Verification bundle requires explicit user confirmation."));
  }
  if (confirmation?.assistantMinted !== false || confirmation?.requestIdMintedBy === "assistant") {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Assistant-minted verification bundle requests are blocked."));
  }
  if (commandsInput.length < 1 || commandsInput.length > 3 || bundle?.maxCommands !== 3 && !boundedInteger(bundle?.maxCommands, 1, 3) || bundle?.requestedCommandCount !== commandsInput.length) {
    diagnostics.push(diagnostic("unbounded_sequence", "Verification bundle sequence must contain one to three bounded commands."));
  }
  if (commands.length !== commandsInput.length || commands.some((item, index) => item.sequenceIndex !== index)) {
    diagnostics.push(diagnostic("unsupported_command", "Verification bundle commands must use fixed allowlisted command ids in sequence."));
  }
  if (commandsInput.some((item) => isPlainObject(item) && typeof item.timeoutMs === "number" && item.timeoutMs > 1800000)) {
    diagnostics.push(diagnostic("unbounded_timeout", "Verification bundle command timeout exceeds the bounded limit."));
  }
  if (commandsInput.some((item) => isPlainObject(item) && ((typeof item.maxOutputBytes === "number" && item.maxOutputBytes > 20000) || (typeof item.maxOutputLines === "number" && item.maxOutputLines > 400)))) {
    diagnostics.push(diagnostic("unbounded_output", "Verification bundle output budget exceeds the bounded tail limit."));
  }
  if (!policyIsSafe(input.policyFlags) || input.executionAllowed !== false || input.freeformCommandAllowed !== false || input.agentStartAllowed !== false || input.cloudRequired !== false || input.authority !== "verification_bundle_metadata") {
    diagnostics.push(diagnostic("invalid_authority", "Verification bundle cannot widen authority beyond metadata-only fixed command ids."));
  }
  if (aggregate?.rawOutputStored !== false || aggregate?.rawOutputReturned !== false) {
    diagnostics.push(diagnostic("unsafe_metadata", "Verification bundle cannot store or return raw output."));
  }

  const details = bundleDetails(bundleId, runId, controlledWorkspaceId, workspaceReadinessId, status, commandCount ?? commands.length);
  if (diagnostics.length > 0) {
    return evaluationBlocked(diagnostics, details, commands);
  }
  return { state: "accepted", status, bundleId, runId, controlledWorkspaceId, workspaceReadinessId, commandCount: commandCount ?? commands.length, commands, diagnostics: [], details, authority };
}

export function buildControlledAgentVerificationBundleRequest(input: unknown): ControlledAgentVerificationBundleRequestResult {
  const diagnostics: ControlledAgentVerificationBundleDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Verification bundle request metadata is absent."));
    return requestBlocked("blocked", diagnostics, { displayOnly: true });
  }
  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as ControlledAgentVerificationBundleRequestInput;
  if (metadata.host === "browser") {
    diagnostics.push(diagnostic("browser_host", "Browser preview cannot request controlled verification bundle execution."));
  } else if (metadata.host === "jetbrains") {
    diagnostics.push(diagnostic("unsupported_host", "JetBrains verification bundle execution requests remain fail-closed."));
  } else if (metadata.host !== "vscode") {
    diagnostics.push(diagnostic("unsupported_host", "Verification bundle execution requests require a supported IDE host."));
  }
  if (metadata.userConfirmed !== true) {
    diagnostics.push(diagnostic("missing_confirmation", "Verification bundle request requires explicit user confirmation."));
  }

  const evaluation = evaluateControlledAgentVerificationBundle(metadata.bundleMetadata);
  if (evaluation.state !== "accepted" || evaluation.status !== "planned") {
    diagnostics.push(...evaluation.diagnostics, diagnostic("invalid_authority", "Only accepted planned verification bundles can be converted to request metadata."));
  }
  const requestId = buildRequestId(evaluation.runId, evaluation.controlledWorkspaceId, evaluation.bundleId, metadata.requestSeed);
  const commandIds = evaluation.commands.map((item) => item.commandId);
  const details = bundleDetails(evaluation.bundleId, evaluation.runId, evaluation.controlledWorkspaceId, evaluation.workspaceReadinessId, evaluation.status, evaluation.commandCount);
  if (diagnostics.length > 0 || !requestId || !evaluation.runId || !evaluation.controlledWorkspaceId || !evaluation.bundleId || commandIds.length === 0) {
    return requestBlocked(diagnostics.some((item) => item.code === "browser_host" || item.code === "unsupported_host") ? "unsupported" : "blocked", diagnostics, details);
  }

  const bridgeRequest: ControlledAgentVerificationBundleBridgeRequest = {
    version: "2026-05-15",
    type: "gui.controlledAgentVerificationBundleRequest",
    requestId,
    payload: {
      requestId,
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: evaluation.controlledWorkspaceId,
      runId: evaluation.runId,
      workspaceReadinessId: evaluation.workspaceReadinessId,
      bundleId: evaluation.bundleId,
      userConfirmed: true,
      confirmationKind: "explicit_user_verification_bundle",
      commandIds,
      limits: {
        maxCommands: 3,
        maxTimeoutMs: 1800000,
        maxOutputBytes: 20000,
        maxOutputLines: 400,
        tailOnly: true,
        commandStringAllowed: false,
        argsAllowed: false,
        cwdAllowed: false,
        envAllowed: false,
        shellAllowed: false,
      },
      policyFlags,
    },
  };
  return { state: "ready", bridgeRequest, correlation: { requestId, runId: evaluation.runId, controlledWorkspaceId: evaluation.controlledWorkspaceId, workspaceReadinessId: evaluation.workspaceReadinessId, bundleId: evaluation.bundleId, commandIds }, diagnostics: [], details, authority };
}

export function correlateControlledAgentVerificationBundleResult(input: unknown): ControlledAgentVerificationBundleCorrelationResult {
  const diagnostics: ControlledAgentVerificationBundleDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Verification bundle result correlation metadata must be an object."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  scanUnsafeMetadata(input, diagnostics, { allowOutputTail: true });
  const current = sanitizeCorrelation(input.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Verification bundle result requires current correlation metadata."));
    return resultBlocked(diagnostics, { displayOnly: true });
  }
  if (input.existingResult && isPlainObject(input.existingResult) && isTerminalStatus(input.existingResult.status)) {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate verification bundle result ignored after the first terminal result."));
    return { state: "duplicate", diagnostics, details: correlationDetails(current, undefined), authority };
  }
  const result = evaluateControlledAgentVerificationBundle(input.bundleResult);
  if (result.state !== "accepted") {
    diagnostics.push(...result.diagnostics);
    return resultBlocked(diagnostics, correlationDetails(current, result.bundleId));
  }
  if (result.runId !== current.runId || result.controlledWorkspaceId !== current.controlledWorkspaceId || result.workspaceReadinessId !== current.workspaceReadinessId || result.bundleId !== current.bundleId || result.commands.map((item) => item.commandId).join(",") !== current.commandIds.join(",")) {
    diagnostics.push(diagnostic("stale_result", "Ignored verification bundle result that does not match request, run, workspace, readiness, bundle, and command ids."));
    return { state: "ignored", diagnostics, details: correlationDetails(current, result.bundleId), authority };
  }
  if (diagnostics.length > 0) {
    return resultBlocked(diagnostics, correlationDetails(current, result.bundleId));
  }
  return { state: "accepted", bundle: result, diagnostics: [], details: correlationDetails(current, result.bundleId), authority };
}

function hasBundleShape(input: Record<string, unknown>, workspace: unknown, confirmation: unknown, bundle: unknown, aggregate: unknown): boolean {
  return input.kind === "controlled_agent_verification_bundle" && input.version === "2026-07-08" && isPlainObject(workspace) && isPlainObject(confirmation) && isPlainObject(bundle) && isPlainObject(aggregate);
}

function parseCommand(input: unknown): ControlledAgentVerificationBundleCommandSummary | undefined {
  if (!isPlainObject(input)) return undefined;
  const stepId = safeId(input.stepId);
  const sequenceIndex = boundedInteger(input.sequenceIndex, 0, 2) ? input.sequenceIndex : undefined;
  const commandId = safeCommandId(input.commandId);
  const timeoutMs = boundedInteger(input.timeoutMs, 1000, 1800000) ? input.timeoutMs : undefined;
  const maxOutputBytes = boundedInteger(input.maxOutputBytes, 1, 20000) ? input.maxOutputBytes : undefined;
  const maxOutputLines = boundedInteger(input.maxOutputLines, 1, 400) ? input.maxOutputLines : undefined;
  const status = safeStatus(input.status);
  const summary = safeDisplayText(input.summary, 240);
  if (!stepId || sequenceIndex === undefined || !commandId || timeoutMs === undefined || maxOutputBytes === undefined || maxOutputLines === undefined || !status || !summary || input.tailOnly !== true || input.commandStringAllowed !== false || input.argsAllowed !== false || input.cwdAllowed !== false || input.envAllowed !== false || input.shellAllowed !== false) {
    return undefined;
  }
  const exitCode = input.exitCode === null || boundedInteger(input.exitCode, 0, 255) ? input.exitCode : undefined;
  const durationMs = boundedInteger(input.durationMs, 0, 1800000) ? input.durationMs : undefined;
  const outputTail = typeof input.outputTail === "string" ? safeOutputTail(input.outputTail) : undefined;
  const outputByteCount = boundedInteger(input.outputByteCount, 0, 20000) ? input.outputByteCount : undefined;
  const outputLineCount = boundedInteger(input.outputLineCount, 0, 400) ? input.outputLineCount : undefined;
  const truncated = typeof input.truncated === "boolean" ? input.truncated : undefined;
  const resultHash = typeof input.resultHash === "string" && safeHashPattern.test(input.resultHash) ? input.resultHash : undefined;
  return stripUndefined({ stepId, sequenceIndex, commandId, timeoutMs, maxOutputBytes, maxOutputLines, status, exitCode, durationMs, outputTail, outputByteCount, outputLineCount, truncated, resultHash, summary });
}

function policyIsSafe(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const expected = policyFlags as Record<string, boolean>;
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue) && Object.keys(value).every((key) => key in expected);
}

function sanitizeCorrelation(value: unknown): ControlledAgentVerificationBundleRequestCorrelation | undefined {
  if (!isPlainObject(value)) return undefined;
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const controlledWorkspaceId = safeId(value.controlledWorkspaceId);
  const workspaceReadinessId = value.workspaceReadinessId === undefined ? undefined : safeId(value.workspaceReadinessId);
  const bundleId = safeId(value.bundleId);
  const commandIds = Array.isArray(value.commandIds) ? value.commandIds.map(safeCommandId).filter((item): item is ControlledAgentVerificationBundleCommandId => item !== undefined) : [];
  return requestId && runId && controlledWorkspaceId && bundleId && commandIds.length > 0 && commandIds.length <= 3 ? { requestId, runId, controlledWorkspaceId, workspaceReadinessId, bundleId, commandIds } : undefined;
}

function buildRequestId(runId: string | undefined, workspaceId: string | undefined, bundleId: string | undefined, seed: unknown): string | undefined {
  if (!runId || !workspaceId || !bundleId) return undefined;
  const safeSeed = typeof seed === "string" && safeIdPattern.test(seed) ? seed : "verification-bundle";
  return `gui-s117-${stableHash(`${runId}:${workspaceId}:${bundleId}:${safeSeed}`)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentVerificationBundleDiagnostic[], options: { allowOutputTail?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  const currentKey = (keyPath.split(".").pop() ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    const protocolAllowed = (currentKey === "kind" && value === "controlled_agent_verification_bundle") || (currentKey === "version" && value === "2026-07-08") || (currentKey === "authority" && value === "verification_bundle_metadata") || (currentKey === "commandId" && safeCommandId(value) !== undefined) || (currentKey === "status" && safeStatus(value) !== undefined);
    if (options.allowOutputTail && currentKey === "outputTail") {
      if (unsafeTextPattern.test(value) || stackTracePattern.test(value)) diagnostics.push(diagnostic("unsafe_metadata", "Unsafe verification bundle output tail omitted."));
      return;
    }
    if (!protocolAllowed && (unsafeTextPattern.test(value) || stackTracePattern.test(value))) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe verification bundle metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
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
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (unsafeKeyPattern.test(key) && !(options.allowOutputTail && key === "outputTail") && !key.endsWith("Allowed")) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported verification bundle field ${sanitizeDisplayText(key)}.`));
      }
      scanUnsafeMetadata(item, diagnostics, options, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function evaluationBlocked(diagnostics: ControlledAgentVerificationBundleDiagnostic[], details: Record<string, string | number | boolean | string[]>, commands: ControlledAgentVerificationBundleCommandSummary[]): ControlledAgentVerificationBundleEvaluation {
  return { state: "blocked", commands, diagnostics: sanitizedDiagnostics(diagnostics), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function requestBlocked(state: "blocked" | "unsupported", diagnostics: ControlledAgentVerificationBundleDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentVerificationBundleRequestResult {
  return { state, diagnostics: sanitizedDiagnostics(diagnostics), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function resultBlocked(diagnostics: ControlledAgentVerificationBundleDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentVerificationBundleCorrelationResult {
  return { state: "blocked", diagnostics: sanitizedDiagnostics(diagnostics), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details), authority };
}

function bundleDetails(bundleId: string | undefined, runId: string | undefined, workspaceId: string | undefined, readinessId: string | undefined, status: string | undefined, commandCount: number | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, bundleId, runId, controlledWorkspaceId: workspaceId, workspaceReadinessId: readinessId, status, commandCount });
}

function correlationDetails(current: ControlledAgentVerificationBundleRequestCorrelation, bundleId: string | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId: current.requestId, runId: current.runId, controlledWorkspaceId: current.controlledWorkspaceId, workspaceReadinessId: current.workspaceReadinessId, bundleId: current.bundleId, hostBundleId: bundleId, commandIds: current.commandIds });
}

function sanitizedDiagnostics(diagnostics: ControlledAgentVerificationBundleDiagnostic[]): ControlledAgentVerificationBundleDiagnostic[] {
  return diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 32);
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

function safeCommandId(value: unknown): ControlledAgentVerificationBundleCommandId | undefined {
  return typeof value === "string" && allowedCommandIds.has(value as ControlledAgentVerificationBundleCommandId) ? value as ControlledAgentVerificationBundleCommandId : undefined;
}

function safeStatus(value: unknown): ControlledAgentVerificationBundleState | undefined {
  return value === "planned" || value === "running" || value === "succeeded" || value === "failed" || value === "timed_out" || value === "killed" || value === "blocked" ? value : undefined;
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
  if (unsafeTextPattern.test(sanitized) || stackTracePattern.test(sanitized)) return undefined;
  return sanitized.length > 2000 ? undefined : sanitized;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function diagnostic(code: ControlledAgentVerificationBundleDiagnosticCode, message: string): ControlledAgentVerificationBundleDiagnostic {
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
