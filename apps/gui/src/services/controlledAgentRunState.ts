import { evaluateControlledAgentCommandRun } from "./controlledAgentCommandRunner";
import { evaluateControlledAgentEditExecutor } from "./controlledAgentEditExecutor";
import { evaluateControlledAgentFileRead } from "./controlledAgentFileRead";
import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentRunPhase = "idle" | "opt_in_required" | "workspace_ready" | "reading_context" | "planning" | "waiting_for_user" | "running_verification" | "stopping" | "stopped" | "blocked" | "failed" | "completed";
export type ControlledAgentRunStopReason = "user_stop" | "user_kill" | "read_budget_exhausted" | "step_limit" | "file_limit" | "patch_limit" | "runtime_limit" | "repair_limit" | "verification_failed" | "policy_blocked" | "unsafe_metadata" | "internal_error";
export type ControlledAgentRunNextUserAction = "none" | "review_opt_in" | "review_plan" | "review_stop" | "review_failure" | "review_completion";
export type ControlledAgentRunDiagnosticCode = "missing_input" | "malformed_input" | "unsafe_metadata" | "invalid_authority" | "workspace_not_ready" | "limit_exceeded" | "terminal_state";

export type ControlledAgentRunDiagnostic = {
  code: ControlledAgentRunDiagnosticCode;
  message: string;
};

export type ControlledAgentRunLimits = {
  maxSteps: number;
  maxFileReads: number;
  maxReadBytes: number;
  maxTouchedFiles: number;
  maxPatchBytes: number;
  maxRuntimeSeconds: number;
  maxRepairAttempts: number;
};

export type ControlledAgentRunCounters = {
  stepsCompleted: number;
  fileReadsUsed: number;
  readBytesUsed: number;
  filesTouched: number;
  patchBytesUsed: number;
  verificationRuns: number;
  repairAttempts: number;
  runtimeSeconds: number;
  userTurns: number;
};

export type ControlledAgentRunStop = {
  reason: ControlledAgentRunStopReason;
  recoverable: boolean;
  message: string;
};

export type ControlledAgentRunState = {
  phase: ControlledAgentRunPhase;
  authority: "state_metadata_only";
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
  canUseTools: false;
  canAutoRollback: false;
  canStartAutonomousLoop: false;
  enabled: boolean;
  stopped: boolean;
  limits: ControlledAgentRunLimits;
  counters: ControlledAgentRunCounters;
  stop?: ControlledAgentRunStop;
  summary: string;
  nextUserAction: ControlledAgentRunNextUserAction;
  diagnostics: ControlledAgentRunDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type ControlledAgentRunInitInput = {
  readiness?: unknown;
  userOptIn?: {
    source?: "user" | "assistant" | "host";
    confirmed?: boolean;
    requestId?: string;
  };
  limits?: Partial<ControlledAgentRunLimits>;
};

export type ControlledAgentRunEvent =
  | { type: "workspace_ready"; summary?: string }
  | { type: "read"; metadata: unknown }
  | { type: "command"; metadata: unknown }
  | { type: "edit"; metadata: unknown }
  | { type: "wait"; summary?: string }
  | { type: "complete"; summary?: string }
  | { type: "blocked"; reason?: string; summary?: string }
  | { type: "failed"; reason?: string; summary?: string }
  | { type: "stop"; reason?: string; summary?: string }
  | { type: "kill"; reason?: string; summary?: string }
  | { type: "tick"; runtimeSeconds: number }
  | { type: "touch"; filesTouched?: number; patchBytes?: number }
  | { type: "repair" };

const defaultLimits: ControlledAgentRunLimits = {
  maxSteps: 6,
  maxFileReads: 6,
  maxReadBytes: 8192,
  maxTouchedFiles: 4,
  maxPatchBytes: 12000,
  maxRuntimeSeconds: 600,
  maxRepairAttempts: 0,
};

const zeroCounters: ControlledAgentRunCounters = {
  stepsCompleted: 0,
  fileReadsUsed: 0,
  readBytesUsed: 0,
  filesTouched: 0,
  patchBytesUsed: 0,
  verificationRuns: 0,
  repairAttempts: 0,
  runtimeSeconds: 0,
  userTurns: 0,
};

const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerTool|provider_tool|tool|toolCall|tool_call|rawCommand|raw_command|rawArgs|raw_args|rawCwd|raw_cwd|rawEnv|raw_env|rawOutput|raw_output|rawLog|raw_log|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawDiff|raw_diff|privatePath|private_path|browserStorage|browser_storage|storageDump|storage_dump|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoFix|auto_fix|autoRepair|auto_repair)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|auto[_ -]?(?:start|apply|run|verify|fix|repair)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;

export function initializeControlledAgentRunState(input: ControlledAgentRunInitInput | undefined): ControlledAgentRunState {
  const diagnostics: ControlledAgentRunDiagnostic[] = [];
  if (!input) {
    diagnostics.push(diagnostic("missing_input", "Controlled run state is idle until readiness metadata is available."));
    return buildState("idle", false, false, normalizeLimits(undefined), zeroCounters, "Controlled run state is idle.", "review_opt_in", diagnostics);
  }

  scanUnsafeMetadata(input, diagnostics);
  scanUnsafeMetadata(input, diagnostics);
  const limits = normalizeLimits(input.limits);
  if (diagnostics.length > 0) {
    return stoppedState("blocked", limits, zeroCounters, "unsafe_metadata", false, "Controlled run initialization is blocked because unsafe metadata was omitted.", diagnostics);
  }
  if (hasInvalidLimitInput(input.limits)) {
    return stoppedState("blocked", defaultLimits, zeroCounters, "internal_error", false, "Controlled run initialization is blocked because limits are malformed or unbounded.", diagnostics);
  }

  const readiness = evaluateControlledAgentWorkspaceReadiness(input.readiness);
  const explicitOptIn = input.userOptIn?.confirmed === true && input.userOptIn.source === "user";
  if (!explicitOptIn) {
    diagnostics.push(diagnostic("workspace_not_ready", "Controlled run requires explicit user opt-in before planning."));
    return buildState("opt_in_required", false, false, limits, zeroCounters, "Controlled run requires explicit user opt-in.", "review_opt_in", diagnostics);
  }
  if (readiness.state !== "ready_for_future_controlled_mode") {
    diagnostics.push(diagnostic("workspace_not_ready", "Controlled run requires ready controlled workspace metadata."));
    return buildState("blocked", false, true, limits, zeroCounters, "Controlled run workspace readiness is blocked.", "review_failure", diagnostics, stop("policy_blocked", false, "Workspace readiness is not sufficient."));
  }

  return buildState("workspace_ready", true, false, limits, { ...zeroCounters, userTurns: 1 }, "Controlled run is ready for a user-reviewed plan.", "review_plan", diagnostics);
}

export function reduceControlledAgentRunState(current: ControlledAgentRunState, event: unknown): ControlledAgentRunState {
  const malformed = validateEvent(event);
  if (malformed) {
    return stoppedState("blocked", current.limits, current.counters, malformed, false, "Controlled run event is blocked because it is unsafe or malformed.", current.diagnostics);
  }
  if (isTerminal(current.phase)) {
    return { ...current, diagnostics: [...current.diagnostics, diagnostic("terminal_state", "Controlled run is already terminal.")].slice(0, 24) };
  }

  const typed = event as ControlledAgentRunEvent;
  if (typed.type === "workspace_ready") {
    return advance(current, "planning", "Controlled run is planning with sanitized state metadata only.", "review_plan", 1);
  }
  if (typed.type === "read") {
    const read = evaluateControlledAgentFileRead(typed.metadata);
    if (read.state !== "success" && read.state !== "truncated") {
      return stoppedState("blocked", current.limits, current.counters, "policy_blocked", false, "Controlled file read metadata was blocked.", current.diagnostics);
    }
    const counters = incrementCounters(current.counters, { fileReadsUsed: 1, readBytesUsed: read.preview?.byteCount ?? 0 });
    return enforceLimits({ ...current, phase: "reading_context", counters, summary: "Controlled run recorded a bounded file read.", nextUserAction: "review_plan" }, 1);
  }
  if (typed.type === "command") {
    const command = evaluateControlledAgentCommandRun(typed.metadata);
    if (command.state === "blocked" || command.state === "disabled" || command.state === "killed" || command.state === "timed_out") {
      return stoppedState(command.state === "killed" ? "stopped" : "failed", current.limits, current.counters, command.state === "killed" ? "user_kill" : "verification_failed", command.state === "killed", "Controlled command run reached a terminal sanitized state.", current.diagnostics);
    }
    const counters = incrementCounters(current.counters, { verificationRuns: 1 });
    const phase: ControlledAgentRunPhase = command.state === "running" ? "running_verification" : command.state === "failed" ? "failed" : "planning";
    const next = { ...current, phase, counters, summary: command.summary, nextUserAction: phase === "failed" ? "review_failure" as const : "review_plan" as const, stopped: phase === "failed", stop: phase === "failed" ? stop("verification_failed", true, "Verification command failed.") : undefined };
    return enforceLimits(next, 1);
  }
  if (typed.type === "edit") {
    const edit = evaluateControlledAgentEditExecutor(typed.metadata);
    if (edit.state === "blocked" || edit.state === "failed" || edit.diagnostics.length > 0) {
      return stoppedState(edit.state === "failed" ? "failed" : "blocked", current.limits, current.counters, edit.state === "failed" ? "internal_error" : "policy_blocked", false, "Controlled edit metadata stopped the run before any apply bridge request.", current.diagnostics);
    }
    const counters = incrementCounters(current.counters, { filesTouched: edit.touchedFileLabels.length, patchBytesUsed: edit.replacementByteCount });
    const phase: ControlledAgentRunPhase = edit.state === "applied" ? "completed" : "waiting_for_user";
    const next = { ...current, phase, counters, summary: edit.summary, nextUserAction: phase === "completed" ? "review_completion" as const : "review_plan" as const, stopped: phase === "completed" };
    return enforceLimits(next, 1);
  }
  if (typed.type === "wait") {
    return advance(current, "waiting_for_user", typed.summary ?? "Controlled run is waiting for explicit user review.", "review_plan", 1);
  }
  if (typed.type === "complete") {
    return { ...advance(current, "completed", typed.summary ?? "Controlled run completed with sanitized state metadata.", "review_completion", 1), stopped: true };
  }
  if (typed.type === "blocked") {
    return stoppedState("blocked", current.limits, current.counters, "policy_blocked", false, typed.summary ?? "Controlled run was blocked by policy.", current.diagnostics);
  }
  if (typed.type === "failed") {
    return stoppedState("failed", current.limits, current.counters, "internal_error", true, typed.summary ?? "Controlled run failed safely.", current.diagnostics);
  }
  if (typed.type === "stop") {
    return stoppedState("stopped", current.limits, current.counters, "user_stop", true, typed.summary ?? "Controlled run stopped by explicit user request.", current.diagnostics);
  }
  if (typed.type === "kill") {
    return stoppedState("stopped", current.limits, current.counters, "user_kill", true, typed.summary ?? "Controlled run was killed by explicit user request.", current.diagnostics);
  }
  if (typed.type === "tick") {
    return enforceLimits({ ...current, counters: { ...current.counters, runtimeSeconds: typed.runtimeSeconds }, summary: "Controlled run runtime counter was updated." }, 0);
  }
  if (typed.type === "touch") {
    return enforceLimits({ ...current, counters: incrementCounters(current.counters, { filesTouched: typed.filesTouched ?? 0, patchBytesUsed: typed.patchBytes ?? 0 }), summary: "Controlled run touched-file counters were updated." }, 1);
  }
  return enforceLimits({ ...current, counters: incrementCounters(current.counters, { repairAttempts: 1 }), summary: "Controlled run repair placeholder counter was updated." }, 1);
}

function advance(current: ControlledAgentRunState, phase: ControlledAgentRunPhase, summary: string, nextUserAction: ControlledAgentRunNextUserAction, stepDelta: number): ControlledAgentRunState {
  return enforceLimits({ ...current, phase, counters: incrementCounters(current.counters, { stepsCompleted: stepDelta }), summary: safeText(summary, 240), nextUserAction }, 0);
}

function enforceLimits(state: ControlledAgentRunState, stepDelta: number): ControlledAgentRunState {
  const counters = stepDelta > 0 ? incrementCounters(state.counters, { stepsCompleted: stepDelta }) : state.counters;
  const over = firstExceededLimit(state.limits, counters);
  if (!over) {
    return { ...state, counters, details: buildDetails(state.limits, counters) };
  }
  return stoppedState("blocked", state.limits, counters, over, over === "read_budget_exhausted" || over === "step_limit", "Controlled run stopped because a bounded limit was reached.", state.diagnostics);
}

function firstExceededLimit(limits: ControlledAgentRunLimits, counters: ControlledAgentRunCounters): ControlledAgentRunStopReason | undefined {
  if (counters.stepsCompleted > limits.maxSteps) return "step_limit";
  if (counters.fileReadsUsed > limits.maxFileReads || counters.readBytesUsed > limits.maxReadBytes) return "read_budget_exhausted";
  if (counters.filesTouched > limits.maxTouchedFiles) return "file_limit";
  if (counters.patchBytesUsed > limits.maxPatchBytes) return "patch_limit";
  if (counters.runtimeSeconds > limits.maxRuntimeSeconds) return "runtime_limit";
  if (counters.repairAttempts > limits.maxRepairAttempts) return "repair_limit";
  return undefined;
}

function normalizeLimits(input: Partial<ControlledAgentRunLimits> | undefined): ControlledAgentRunLimits {
  const limits = { ...defaultLimits, ...input };
  return {
    maxSteps: bounded(limits.maxSteps, 1, 12, defaultLimits.maxSteps),
    maxFileReads: bounded(limits.maxFileReads, 0, 24, defaultLimits.maxFileReads),
    maxReadBytes: bounded(limits.maxReadBytes, 0, 50000, defaultLimits.maxReadBytes),
    maxTouchedFiles: bounded(limits.maxTouchedFiles, 0, 8, defaultLimits.maxTouchedFiles),
    maxPatchBytes: bounded(limits.maxPatchBytes, 0, 24000, defaultLimits.maxPatchBytes),
    maxRuntimeSeconds: bounded(limits.maxRuntimeSeconds, 1, 1800, defaultLimits.maxRuntimeSeconds),
    maxRepairAttempts: bounded(limits.maxRepairAttempts, 0, 3, defaultLimits.maxRepairAttempts),
  };
}

function hasInvalidLimitInput(input: Partial<ControlledAgentRunLimits> | undefined): boolean {
  if (input === undefined) return false;
  return Object.entries(input).some(([key, value]) => {
    if (!(key in defaultLimits)) return true;
    if (typeof value !== "number" || !Number.isInteger(value)) return true;
    if (key === "maxSteps") return value < 1 || value > 12;
    if (key === "maxFileReads") return value < 0 || value > 24;
    if (key === "maxReadBytes") return value < 0 || value > 50000;
    if (key === "maxTouchedFiles") return value < 0 || value > 8;
    if (key === "maxPatchBytes") return value < 0 || value > 24000;
    if (key === "maxRuntimeSeconds") return value < 1 || value > 1800;
    if (key === "maxRepairAttempts") return value < 0 || value > 3;
    return true;
  });
}

function validateEvent(event: unknown): ControlledAgentRunStopReason | undefined {
  const diagnostics: ControlledAgentRunDiagnostic[] = [];
  if (!isPlainObject(event) || typeof event.type !== "string") return "internal_error";
  const eventShell = event.type === "read" || event.type === "command" ? { ...event, type: undefined, metadata: undefined } : { ...event, type: undefined };
  scanUnsafeMetadata(eventShell, diagnostics);
  if (diagnostics.length > 0) return "unsafe_metadata";
  const allowed = new Set(["workspace_ready", "read", "command", "edit", "wait", "complete", "blocked", "failed", "stop", "kill", "tick", "touch", "repair"]);
  if (!allowed.has(event.type)) return "internal_error";
  if (event.type === "tick" && !boundedNumber(event.runtimeSeconds, 0, 1800)) return "internal_error";
  if (event.type === "touch" && (event.filesTouched !== undefined && !boundedNumber(event.filesTouched, 0, 8) || event.patchBytes !== undefined && !boundedNumber(event.patchBytes, 0, 24000))) return "internal_error";
  return undefined;
}

function stoppedState(phase: "stopped" | "blocked" | "failed", limits: ControlledAgentRunLimits, counters: ControlledAgentRunCounters, reason: ControlledAgentRunStopReason, recoverable: boolean, message: string, diagnostics: ControlledAgentRunDiagnostic[]): ControlledAgentRunState {
  return buildState(phase, false, true, limits, counters, safeText(message, 240), phase === "stopped" ? "review_stop" : "review_failure", [...diagnostics, diagnostic(reason === "unsafe_metadata" ? "unsafe_metadata" : reason === "internal_error" ? "malformed_input" : reason.includes("limit") || reason.includes("budget") ? "limit_exceeded" : "invalid_authority", message)], stop(reason, recoverable, message));
}

function buildState(phase: ControlledAgentRunPhase, enabled: boolean, stopped: boolean, limits: ControlledAgentRunLimits, counters: ControlledAgentRunCounters, summary: string, nextUserAction: ControlledAgentRunNextUserAction, diagnostics: ControlledAgentRunDiagnostic[], stopMetadata?: ControlledAgentRunStop): ControlledAgentRunState {
  return {
    phase,
    authority: "state_metadata_only",
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
    canUseTools: false,
    canAutoRollback: false,
    canStartAutonomousLoop: false,
    enabled,
    stopped,
    limits,
    counters,
    stop: stopMetadata,
    summary: safeText(summary, 240),
    nextUserAction,
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: buildDetails(limits, counters),
  };
}

function buildDetails(limits: ControlledAgentRunLimits, counters: ControlledAgentRunCounters): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue({ displayOnly: true, ...limits, ...counters, sanitized: true });
  if (!isPlainObject(sanitized)) return { displayOnly: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeText(value, 120);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
  }
  return details;
}

function incrementCounters(counters: ControlledAgentRunCounters, patch: Partial<ControlledAgentRunCounters>): ControlledAgentRunCounters {
  return {
    ...counters,
    stepsCompleted: counters.stepsCompleted + (patch.stepsCompleted ?? 0),
    fileReadsUsed: counters.fileReadsUsed + (patch.fileReadsUsed ?? 0),
    readBytesUsed: counters.readBytesUsed + (patch.readBytesUsed ?? 0),
    filesTouched: counters.filesTouched + (patch.filesTouched ?? 0),
    patchBytesUsed: counters.patchBytesUsed + (patch.patchBytesUsed ?? 0),
    verificationRuns: counters.verificationRuns + (patch.verificationRuns ?? 0),
    repairAttempts: counters.repairAttempts + (patch.repairAttempts ?? 0),
    runtimeSeconds: patch.runtimeSeconds ?? counters.runtimeSeconds,
    userTurns: counters.userTurns + (patch.userTurns ?? 0),
  };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentRunDiagnostic[], depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value)) diagnostics.push(diagnostic("unsafe_metadata", "Unsafe controlled run metadata was omitted."));
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
      if (unsafeKeyPattern.test(key)) diagnostics.push(diagnostic("unsafe_metadata", "Unsupported controlled run authority field was omitted."));
      scanUnsafeMetadata(item, diagnostics, depth + 1, seen);
    }
  }
}

function stop(reason: ControlledAgentRunStopReason, recoverable: boolean, message: string): ControlledAgentRunStop {
  return { reason, recoverable, message: safeText(message, 240) };
}

function diagnostic(code: ControlledAgentRunDiagnosticCode, message: string): ControlledAgentRunDiagnostic {
  return { code, message: safeText(message, 200) };
}

function safeText(input: string, limit: number): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : "Controlled run state metadata is unavailable.";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isTerminal(phase: ControlledAgentRunPhase): boolean {
  return phase === "stopped" || phase === "blocked" || phase === "failed" || phase === "completed";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
