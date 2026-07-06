import { evaluateControlledAgentCommandRun } from "./controlledAgentCommandRunner";
import { evaluateControlledAgentEditExecutor } from "./controlledAgentEditExecutor";
import { evaluateControlledAgentFileRead } from "./controlledAgentFileRead";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledOneStepAgentLoopPhase = "idle" | "start_requested" | "read_context" | "model_step_pending" | "edit_ready" | "edit_applied" | "verification_requested" | "completed" | "failed" | "stopped";
export type ControlledOneStepAgentLoopStopReason = "missing_user_start" | "invalid_transition" | "stale_result" | "read_blocked" | "unsafe_proposal" | "edit_failed" | "verification_failed" | "timeout" | "user_stop" | "runtime_disconnected" | "budget_exceeded" | "repair_disabled" | "unsafe_metadata" | "malformed_input";
export type ControlledOneStepAgentLoopDiagnosticCode = "missing_input" | "malformed_input" | "unsafe_metadata" | "invalid_transition" | "stale_result" | "duplicate_result" | "limit_exceeded" | "policy_blocked";

export type ControlledOneStepAgentLoopDiagnostic = {
  code: ControlledOneStepAgentLoopDiagnosticCode;
  message: string;
};

export type ControlledOneStepAgentLoopBudgets = {
  maxLoopSteps: 1;
  maxFileReads: 1;
  maxReadBytes: number;
  maxTouchedFiles: 1;
  maxEditBytes: number;
  maxVerificationRuns: 1;
  maxRuntimeSeconds: number;
  maxRepairAttempts: 0;
};

export type ControlledOneStepAgentLoopCounters = {
  loopSteps: number;
  fileReads: number;
  readBytes: number;
  filesTouched: number;
  editBytes: number;
  verificationRuns: number;
  runtimeSeconds: number;
  userTurns: number;
  repairAttempts: number;
};

export type ControlledOneStepAgentLoopStop = {
  reason: ControlledOneStepAgentLoopStopReason;
  recoverable: boolean;
  message: string;
};

export type ControlledOneStepAgentLoopCorrelation = {
  startRequestId?: string;
  readRequestId?: string;
  editRequestId?: string;
  verificationRequestId?: string;
  runId?: string;
  controlledWorkspaceId?: string;
  workspaceReadinessId?: string;
  commandId?: string;
  staleOrDuplicateEvents: number;
};

export type ControlledOneStepAgentLoopState = {
  phase: ControlledOneStepAgentLoopPhase;
  authority: "one_step_loop_metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  autoStartAllowed: false;
  canReadFiles: false;
  canWriteFiles: false;
  canRunCommands: false;
  canApplyEdits: false;
  canCallProvider: false;
  canUseGit: false;
  canUseNetwork: false;
  canUseTools: false;
  canInstallPackages: false;
  canRepair: false;
  enabled: boolean;
  stopped: boolean;
  budgets: ControlledOneStepAgentLoopBudgets;
  counters: ControlledOneStepAgentLoopCounters;
  stop?: ControlledOneStepAgentLoopStop;
  correlation: ControlledOneStepAgentLoopCorrelation;
  summary: string;
  diagnostics: ControlledOneStepAgentLoopDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type ControlledOneStepAgentLoopStartInput = {
  source?: unknown;
  confirmedBy?: unknown;
  assistantMinted?: unknown;
  explicitUserStart?: unknown;
  requestId?: unknown;
  summary?: unknown;
  budgets?: Partial<Omit<ControlledOneStepAgentLoopBudgets, "maxLoopSteps" | "maxFileReads" | "maxTouchedFiles" | "maxVerificationRuns" | "maxRepairAttempts">>;
};

export type ControlledOneStepAgentLoopProposalInput = {
  state?: unknown;
  stepCount?: unknown;
  sanitizedOnly?: unknown;
  modelProposalAllowed?: unknown;
  providerPayloadStored?: unknown;
  providerResponseStored?: unknown;
  summary?: unknown;
};

export type ControlledOneStepAgentLoopEvent =
  | { type: "start"; metadata: ControlledOneStepAgentLoopStartInput }
  | { type: "read"; metadata: unknown }
  | { type: "model_step"; metadata: ControlledOneStepAgentLoopProposalInput }
  | { type: "edit"; metadata: unknown }
  | { type: "verification"; metadata: unknown }
  | { type: "tick"; runtimeSeconds: number }
  | { type: "stop"; summary?: unknown }
  | { type: "runtime_disconnect"; summary?: unknown }
  | { type: "repair"; metadata?: unknown };

const defaultBudgets: ControlledOneStepAgentLoopBudgets = {
  maxLoopSteps: 1,
  maxFileReads: 1,
  maxReadBytes: 8192,
  maxTouchedFiles: 1,
  maxEditBytes: 12000,
  maxVerificationRuns: 1,
  maxRuntimeSeconds: 300,
  maxRepairAttempts: 0,
};

const zeroCounters: ControlledOneStepAgentLoopCounters = {
  loopSteps: 0,
  fileReads: 0,
  readBytes: 0,
  filesTouched: 0,
  editBytes: 0,
  verificationRuns: 0,
  runtimeSeconds: 0,
  userTurns: 0,
  repairAttempts: 0,
};

const emptyCorrelation: ControlledOneStepAgentLoopCorrelation = {
  staleOrDuplicateEvents: 0,
};

const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerTool|provider_tool|tool|toolCall|tool_call|packageInstall|package_install|rawCommand|raw_command|rawArgs|raw_args|rawCwd|raw_cwd|rawEnv|raw_env|rawOutput|raw_output|rawLog|raw_log|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|prompt|rawDiff|raw_diff|rawPatch|raw_patch|diff|patch|privatePath|private_path|hiddenRead|hidden_read|hiddenSearch|hidden_search|search|glob|regex|index|indexing|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoFix|auto_fix|autoRepair|auto_repair)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff|patch)|file[_ -]?(?:body|content)|provider(?:[_ -]?(?:payload|response))?|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|package[_ -]?install|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|verify|fix|repair)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;

export function createControlledOneStepAgentLoopState(): ControlledOneStepAgentLoopState {
  return buildState("idle", false, false, defaultBudgets, zeroCounters, "One-step controlled loop is idle until explicit user start.", []);
}

export function reduceControlledOneStepAgentLoopState(current: ControlledOneStepAgentLoopState, event: unknown): ControlledOneStepAgentLoopState {
  if (isTerminal(current.phase)) return current;
  const eventError = validateEventShell(event);
  if (eventError) return stoppedState("failed", current.budgets, current.counters, eventError, false, stopMessage(eventError), current.diagnostics, current.correlation);
  const typed = event as ControlledOneStepAgentLoopEvent;

  if (typed.type === "start") return startLoop(current, typed.metadata);
  if (current.phase === "idle") return stoppedState("failed", current.budgets, current.counters, "missing_user_start", false, stopMessage("missing_user_start"), current.diagnostics, current.correlation);
  if (typed.type === "stop") return stoppedState("stopped", current.budgets, current.counters, "user_stop", true, typeof typed.summary === "string" ? typed.summary : stopMessage("user_stop"), current.diagnostics, current.correlation);
  if (typed.type === "runtime_disconnect") return stoppedState("stopped", current.budgets, current.counters, "runtime_disconnected", true, typeof typed.summary === "string" ? typed.summary : stopMessage("runtime_disconnected"), current.diagnostics, current.correlation);
  if (typed.type === "tick") return enforceBudgets({ ...current, counters: { ...current.counters, runtimeSeconds: typed.runtimeSeconds }, summary: "One-step loop runtime metadata was updated." });
  if (typed.type === "repair") return stoppedState("failed", current.budgets, { ...current.counters, repairAttempts: current.counters.repairAttempts + 1 }, "repair_disabled", false, stopMessage("repair_disabled"), current.diagnostics, current.correlation);
  if (typed.type === "read") return recordRead(current, typed.metadata);
  if (typed.type === "model_step") return recordModelStep(current, typed.metadata);
  if (typed.type === "edit") return recordEdit(current, typed.metadata);
  return recordVerification(current, typed.metadata);
}

function startLoop(current: ControlledOneStepAgentLoopState, metadata: ControlledOneStepAgentLoopStartInput): ControlledOneStepAgentLoopState {
  if (current.phase !== "idle") return duplicateState(current, "Duplicate start metadata was ignored because the one-step loop is already started.");
  const diagnostics: ControlledOneStepAgentLoopDiagnostic[] = [];
  scanUnsafeMetadata(metadata, diagnostics);
  const budgets = normalizeBudgets(metadata?.budgets);
  if (diagnostics.length > 0) return stoppedState("failed", budgets, current.counters, "unsafe_metadata", false, stopMessage("unsafe_metadata"), diagnostics, current.correlation);
  if (!isPlainObject(metadata) || metadata.source !== "gui" || metadata.confirmedBy !== "user" || metadata.assistantMinted !== false || metadata.explicitUserStart !== true || !safeId(metadata.requestId)) {
    return stoppedState("failed", budgets, current.counters, "missing_user_start", false, stopMessage("missing_user_start"), current.diagnostics, current.correlation);
  }
  return buildState("start_requested", true, false, budgets, { ...zeroCounters, userTurns: 1 }, safeText(typeof metadata.summary === "string" ? metadata.summary : "Explicit user start recorded for one-step loop.", 240), [], undefined, { ...emptyCorrelation, startRequestId: typeof metadata.requestId === "string" ? metadata.requestId : undefined });
}

function recordRead(current: ControlledOneStepAgentLoopState, metadata: unknown): ControlledOneStepAgentLoopState {
  if (current.phase === "read_context") return duplicateState(current, "Duplicate read metadata was ignored after bounded read context was recorded.");
  if (current.phase !== "start_requested") return stoppedState("failed", current.budgets, current.counters, "invalid_transition", false, stopMessage("invalid_transition"), current.diagnostics, current.correlation);
  const read = evaluateControlledAgentFileRead(metadata);
  const evidence = readCorrelation(metadata);
  if (!matchesCorrelation(current.correlation, evidence, "read")) return stoppedState("failed", current.budgets, current.counters, "stale_result", false, stopMessage("stale_result"), current.diagnostics, current.correlation);
  if (read.state !== "success" && read.state !== "truncated") return stoppedState("failed", current.budgets, current.counters, "read_blocked", false, "Bounded read evidence was blocked.", diagnosticsFromText(current.diagnostics, read.diagnostics.map((item) => item.message)), current.correlation);
  const counters = { ...current.counters, fileReads: current.counters.fileReads + 1, readBytes: current.counters.readBytes + (read.preview?.byteCount ?? 0) };
  return enforceBudgets(buildState("read_context", true, false, current.budgets, counters, read.summary, current.diagnostics, undefined, mergeCorrelation(current.correlation, evidence)));
}

function recordModelStep(current: ControlledOneStepAgentLoopState, metadata: ControlledOneStepAgentLoopProposalInput): ControlledOneStepAgentLoopState {
  if (current.phase === "model_step_pending") return duplicateState(current, "Duplicate model-step metadata was ignored after the one-step proposal was recorded.");
  if (current.phase !== "read_context") return stoppedState("failed", current.budgets, current.counters, "invalid_transition", false, stopMessage("invalid_transition"), current.diagnostics, current.correlation);
  const diagnostics: ControlledOneStepAgentLoopDiagnostic[] = [...current.diagnostics];
  scanUnsafeMetadata(metadata, diagnostics);
  const safe = isPlainObject(metadata) && metadata.state === "completed" && metadata.stepCount === 1 && metadata.sanitizedOnly === true && metadata.modelProposalAllowed === true && metadata.providerPayloadStored === false && metadata.providerResponseStored === false;
  if (!safe || diagnostics.length > current.diagnostics.length) return stoppedState("failed", current.budgets, current.counters, diagnostics.length > current.diagnostics.length ? "unsafe_metadata" : "unsafe_proposal", false, stopMessage(diagnostics.length > current.diagnostics.length ? "unsafe_metadata" : "unsafe_proposal"), diagnostics, current.correlation);
  const counters = { ...current.counters, loopSteps: current.counters.loopSteps + 1 };
  return enforceBudgets(buildState("model_step_pending", true, false, current.budgets, counters, safeText(typeof metadata.summary === "string" ? metadata.summary : "One sanitized model proposal step recorded.", 240), diagnostics, undefined, current.correlation));
}

function recordEdit(current: ControlledOneStepAgentLoopState, metadata: unknown): ControlledOneStepAgentLoopState {
  if (current.phase === "edit_applied") return duplicateState(current, "Duplicate edit metadata was ignored after the bounded edit was applied.");
  if (current.phase !== "model_step_pending" && current.phase !== "edit_ready") return stoppedState("failed", current.budgets, current.counters, "invalid_transition", false, stopMessage("invalid_transition"), current.diagnostics, current.correlation);
  const edit = evaluateControlledAgentEditExecutor(metadata);
  const evidence = editCorrelation(metadata);
  if (!matchesCorrelation(current.correlation, evidence, "edit")) return stoppedState("failed", current.budgets, current.counters, "stale_result", false, stopMessage("stale_result"), current.diagnostics, current.correlation);
  if (edit.diagnostics.length > 0 || (edit.state !== "planned" && edit.state !== "applied")) {
    return stoppedState("failed", current.budgets, current.counters, "edit_failed", true, "Bounded edit evidence failed closed.", diagnosticsFromText(current.diagnostics, edit.diagnostics), current.correlation);
  }
  const counters = { ...current.counters, filesTouched: edit.touchedFileLabels.length, editBytes: edit.replacementByteCount, userTurns: current.counters.userTurns + (edit.state === "applied" ? 1 : 0) };
  const phase = edit.state === "applied" ? "edit_applied" : "edit_ready";
  return enforceBudgets(buildState(phase, true, false, current.budgets, counters, edit.summary, current.diagnostics, undefined, mergeCorrelation(current.correlation, evidence)));
}

function recordVerification(current: ControlledOneStepAgentLoopState, metadata: unknown): ControlledOneStepAgentLoopState {
  if (current.phase !== "edit_applied" && current.phase !== "verification_requested") return stoppedState("failed", current.budgets, current.counters, "invalid_transition", false, stopMessage("invalid_transition"), current.diagnostics, current.correlation);
  const command = evaluateControlledAgentCommandRun(metadata);
  const evidence = verificationCorrelation(metadata);
  if (!matchesCorrelation(current.correlation, evidence, "verification")) return stoppedState("failed", current.budgets, current.counters, "stale_result", false, stopMessage("stale_result"), current.diagnostics, current.correlation);
  if (current.phase === "verification_requested" && current.correlation.verificationRequestId === evidence.verificationRequestId && command.state === "running") return duplicateState(current, "Duplicate verification-running metadata was ignored while verification remains pending.");
  const counters = { ...current.counters, verificationRuns: current.counters.verificationRuns + 1 };
  if (command.state === "succeeded") return enforceBudgets(buildState("completed", false, true, current.budgets, counters, command.summary, current.diagnostics, undefined, mergeCorrelation(current.correlation, evidence)));
  if (command.state === "running") return enforceBudgets(buildState("verification_requested", true, false, current.budgets, counters, command.summary, current.diagnostics, undefined, mergeCorrelation(current.correlation, evidence)));
  const reason = command.state === "timed_out" ? "timeout" : "verification_failed";
  return stoppedState("failed", current.budgets, counters, reason, reason === "verification_failed", command.summary, diagnosticsFromText(current.diagnostics, command.diagnostics.map((item) => item.message)), mergeCorrelation(current.correlation, evidence));
}

function enforceBudgets(state: ControlledOneStepAgentLoopState): ControlledOneStepAgentLoopState {
  const reason = firstExceededBudget(state.budgets, state.counters);
  return reason ? stoppedState("failed", state.budgets, state.counters, reason, false, stopMessage(reason), state.diagnostics, state.correlation) : { ...state, details: buildDetails(state.budgets, state.counters, state.correlation) };
}

function firstExceededBudget(budgets: ControlledOneStepAgentLoopBudgets, counters: ControlledOneStepAgentLoopCounters): ControlledOneStepAgentLoopStopReason | undefined {
  if (counters.loopSteps > budgets.maxLoopSteps || counters.fileReads > budgets.maxFileReads || counters.readBytes > budgets.maxReadBytes || counters.filesTouched > budgets.maxTouchedFiles || counters.editBytes > budgets.maxEditBytes || counters.verificationRuns > budgets.maxVerificationRuns || counters.repairAttempts > budgets.maxRepairAttempts) return "budget_exceeded";
  if (counters.runtimeSeconds > budgets.maxRuntimeSeconds) return "timeout";
  return undefined;
}

function normalizeBudgets(input: ControlledOneStepAgentLoopStartInput["budgets"]): ControlledOneStepAgentLoopBudgets {
  return {
    ...defaultBudgets,
    maxReadBytes: bounded(input?.maxReadBytes, 1, 8192, defaultBudgets.maxReadBytes),
    maxEditBytes: bounded(input?.maxEditBytes, 1, 12000, defaultBudgets.maxEditBytes),
    maxRuntimeSeconds: bounded(input?.maxRuntimeSeconds, 1, 300, defaultBudgets.maxRuntimeSeconds),
  };
}

function validateEventShell(event: unknown): ControlledOneStepAgentLoopStopReason | undefined {
  const diagnostics: ControlledOneStepAgentLoopDiagnostic[] = [];
  if (!isPlainObject(event) || typeof event.type !== "string") return "malformed_input";
  const shell = event.type === "read" || event.type === "edit" || event.type === "verification" || event.type === "model_step" || event.type === "start" ? { ...event, metadata: undefined } : event;
  scanUnsafeMetadata(shell, diagnostics);
  if (diagnostics.length > 0) return "unsafe_metadata";
  if (!["start", "read", "model_step", "edit", "verification", "tick", "stop", "runtime_disconnect", "repair"].includes(event.type)) return "malformed_input";
  if (event.type === "tick" && !boundedNumber(event.runtimeSeconds, 0, 1800)) return "malformed_input";
  return undefined;
}

function stoppedState(phase: "failed" | "stopped", budgets: ControlledOneStepAgentLoopBudgets, counters: ControlledOneStepAgentLoopCounters, reason: ControlledOneStepAgentLoopStopReason, recoverable: boolean, message: string, diagnostics: ControlledOneStepAgentLoopDiagnostic[], correlation: ControlledOneStepAgentLoopCorrelation = emptyCorrelation): ControlledOneStepAgentLoopState {
  const code: ControlledOneStepAgentLoopDiagnosticCode = reason === "unsafe_metadata" ? "unsafe_metadata" : reason === "budget_exceeded" || reason === "timeout" ? "limit_exceeded" : reason === "malformed_input" ? "malformed_input" : reason === "invalid_transition" ? "invalid_transition" : reason === "stale_result" ? "stale_result" : "policy_blocked";
  return buildState(phase, false, true, budgets, counters, message, [...diagnostics, diagnostic(code, message)], { reason, recoverable, message: safeText(message, 240) }, correlation);
}

function buildState(phase: ControlledOneStepAgentLoopPhase, enabled: boolean, stopped: boolean, budgets: ControlledOneStepAgentLoopBudgets, counters: ControlledOneStepAgentLoopCounters, summary: string, diagnostics: ControlledOneStepAgentLoopDiagnostic[], stop?: ControlledOneStepAgentLoopStop, correlation: ControlledOneStepAgentLoopCorrelation = emptyCorrelation): ControlledOneStepAgentLoopState {
  const sanitizedCorrelation = sanitizeCorrelation(correlation);
  return {
    phase,
    authority: "one_step_loop_metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    agentStartAllowed: false,
    autoStartAllowed: false,
    canReadFiles: false,
    canWriteFiles: false,
    canRunCommands: false,
    canApplyEdits: false,
    canCallProvider: false,
    canUseGit: false,
    canUseNetwork: false,
    canUseTools: false,
    canInstallPackages: false,
    canRepair: false,
    enabled,
    stopped,
    budgets,
    counters,
    stop,
    correlation: sanitizedCorrelation,
    summary: safeText(summary, 240),
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: buildDetails(budgets, counters, sanitizedCorrelation),
  };
}

function buildDetails(budgets: ControlledOneStepAgentLoopBudgets, counters: ControlledOneStepAgentLoopCounters, correlation: ControlledOneStepAgentLoopCorrelation): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue({ displayOnly: true, sanitized: true, ...budgets, ...counters, repairEnabled: false, ...correlation });
  if (!isPlainObject(sanitized)) return { displayOnly: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeText(value, 120);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
  }
  return details;
}

function duplicateState(current: ControlledOneStepAgentLoopState, message: string): ControlledOneStepAgentLoopState {
  const correlation = sanitizeCorrelation({ ...current.correlation, staleOrDuplicateEvents: current.correlation.staleOrDuplicateEvents + 1 });
  return {
    ...current,
    correlation,
    summary: safeText(message, 240),
    diagnostics: [...current.diagnostics, diagnostic("duplicate_result", message)].slice(0, 24),
    details: buildDetails(current.budgets, current.counters, correlation),
  };
}

function sanitizeCorrelation(correlation: ControlledOneStepAgentLoopCorrelation): ControlledOneStepAgentLoopCorrelation {
  return {
    startRequestId: safeId(correlation.startRequestId) ? correlation.startRequestId : undefined,
    readRequestId: safeId(correlation.readRequestId) ? correlation.readRequestId : undefined,
    editRequestId: safeId(correlation.editRequestId) ? correlation.editRequestId : undefined,
    verificationRequestId: safeId(correlation.verificationRequestId) ? correlation.verificationRequestId : undefined,
    runId: safeId(correlation.runId) ? correlation.runId : undefined,
    controlledWorkspaceId: safeId(correlation.controlledWorkspaceId) ? correlation.controlledWorkspaceId : undefined,
    workspaceReadinessId: safeId(correlation.workspaceReadinessId) ? correlation.workspaceReadinessId : undefined,
    commandId: safeId(correlation.commandId) ? correlation.commandId : undefined,
    staleOrDuplicateEvents: bounded(correlation.staleOrDuplicateEvents, 0, 100, 0),
  };
}

function mergeCorrelation(current: ControlledOneStepAgentLoopCorrelation, next: Partial<ControlledOneStepAgentLoopCorrelation>): ControlledOneStepAgentLoopCorrelation {
  return sanitizeCorrelation({ ...current, ...next, staleOrDuplicateEvents: current.staleOrDuplicateEvents });
}

function matchesCorrelation(current: ControlledOneStepAgentLoopCorrelation, evidence: Partial<ControlledOneStepAgentLoopCorrelation>, kind: "read" | "edit" | "verification"): boolean {
  if (!evidence.runId) return false;
  if (current.runId && evidence.runId !== current.runId) return false;
  if (current.controlledWorkspaceId && evidence.controlledWorkspaceId && evidence.controlledWorkspaceId !== current.controlledWorkspaceId) return false;
  if (current.workspaceReadinessId && evidence.workspaceReadinessId && evidence.workspaceReadinessId !== current.workspaceReadinessId) return false;
  if (kind === "read") return Boolean(evidence.readRequestId);
  if (kind === "edit") return Boolean(evidence.editRequestId);
  return Boolean(evidence.verificationRequestId && evidence.commandId);
}

function readCorrelation(input: unknown): Partial<ControlledOneStepAgentLoopCorrelation> {
  const metadata = isPlainObject(input) ? input : {};
  const workspace = isPlainObject(metadata.workspace) ? metadata.workspace : {};
  const request = isPlainObject(metadata.request) ? metadata.request : {};
  return {
    readRequestId: safeString(request.requestId),
    runId: safeString(workspace.runId),
    controlledWorkspaceId: safeString(workspace.controlledWorkspaceId),
  };
}

function editCorrelation(input: unknown): Partial<ControlledOneStepAgentLoopCorrelation> {
  const metadata = isPlainObject(input) ? input : {};
  return {
    editRequestId: safeString(metadata.requestId),
    runId: safeString(metadata.runId),
    workspaceReadinessId: safeString(metadata.workspaceReadinessId),
  };
}

function verificationCorrelation(input: unknown): Partial<ControlledOneStepAgentLoopCorrelation> {
  const metadata = isPlainObject(input) ? input : {};
  const workspace = isPlainObject(metadata.workspace) ? metadata.workspace : {};
  const request = isPlainObject(metadata.request) ? metadata.request : {};
  return {
    verificationRequestId: safeString(request.requestId),
    runId: safeString(workspace.runId),
    controlledWorkspaceId: safeString(workspace.controlledWorkspaceId),
    commandId: safeString(request.commandId),
  };
}

function safeString(value: unknown): string | undefined {
  return safeId(value) && typeof value === "string" ? value : undefined;
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledOneStepAgentLoopDiagnostic[], depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value)) diagnostics.push(diagnostic("unsafe_metadata", "Unsafe one-step loop metadata was omitted."));
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item) => scanUnsafeMetadata(item, diagnostics, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (unsafeKeyPattern.test(key)) diagnostics.push(diagnostic("unsafe_metadata", "Unsupported one-step loop authority field was omitted."));
      scanUnsafeMetadata(item, diagnostics, depth + 1, seen);
    }
  }
}

function diagnosticsFromText(existing: ControlledOneStepAgentLoopDiagnostic[], messages: string[]): ControlledOneStepAgentLoopDiagnostic[] {
  return [...existing, ...messages.map((message) => diagnostic("policy_blocked", message))];
}

function stopMessage(reason: ControlledOneStepAgentLoopStopReason): string {
  if (reason === "missing_user_start") return "One-step loop requires explicit user start before any action metadata.";
  if (reason === "invalid_transition") return "One-step loop event order is invalid for S96.";
  if (reason === "stale_result") return "One-step loop failed closed because event correlation did not match the active run.";
  if (reason === "read_blocked") return "One-step loop stopped because bounded read evidence was blocked.";
  if (reason === "unsafe_proposal") return "One-step loop stopped because proposal metadata was not sanitized one-step evidence.";
  if (reason === "edit_failed") return "One-step loop stopped because bounded edit evidence failed.";
  if (reason === "verification_failed") return "One-step loop stopped because allowlisted verification failed.";
  if (reason === "timeout") return "One-step loop stopped because the runtime budget timed out.";
  if (reason === "user_stop") return "One-step loop stopped by explicit user request.";
  if (reason === "runtime_disconnected") return "One-step loop stopped because the runtime disconnected. No auto-retry was started.";
  if (reason === "budget_exceeded") return "One-step loop stopped because an S96 one-step budget was exceeded.";
  if (reason === "repair_disabled") return "One-step loop stopped because repair is disabled for S96.";
  if (reason === "unsafe_metadata") return "One-step loop failed closed because unsafe metadata was omitted.";
  return "One-step loop failed closed because event metadata was malformed.";
}

function diagnostic(code: ControlledOneStepAgentLoopDiagnosticCode, message: string): ControlledOneStepAgentLoopDiagnostic {
  return { code, message: safeText(message, 200) };
}

function safeText(input: string, limit: number): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : "One-step loop metadata is unavailable.";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function safeId(value: unknown): boolean {
  return typeof value === "string" && /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/i.test(value);
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isTerminal(phase: ControlledOneStepAgentLoopPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "stopped";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
