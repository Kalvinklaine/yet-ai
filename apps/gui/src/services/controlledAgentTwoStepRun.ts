import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentTwoStepRunPhase = "idle" | "planning_requested" | "waiting_for_user_review" | "execution_requested" | "applying_edits" | "running_verification_bundle" | "followup_ready" | "completed" | "failed" | "stopped";
export type ControlledAgentTwoStepRunStopReason = "missing_user_gate" | "invalid_transition" | "stale_result" | "duplicate_event" | "unsafe_metadata" | "unsupported_authority" | "budget_exceeded" | "verification_failed" | "user_stop" | "malformed_input";
export type ControlledAgentTwoStepRunDiagnosticCode = "malformed_input" | "unsafe_metadata" | "missing_user_gate" | "invalid_transition" | "stale_result" | "duplicate_event" | "unsupported_authority" | "limit_exceeded" | "verification_failed";

export type ControlledAgentTwoStepRunDiagnostic = {
  code: ControlledAgentTwoStepRunDiagnosticCode;
  message: string;
};

export type ControlledAgentTwoStepRunBudgets = {
  maxPlannerSteps: number;
  maxSelectedContextItems: number;
  maxSearchQueries: number;
  maxSearchResults: number;
  maxTouchedFiles: number;
  maxEditBytes: number;
  maxVerificationCommands: number;
  maxRuntimeSeconds: number;
};

export type ControlledAgentTwoStepRunCounters = {
  plannerSteps: number;
  selectedContextItems: number;
  searchQueries: number;
  searchResults: number;
  filesTouched: number;
  editBytes: number;
  verificationCommands: number;
  userTurns: number;
  staleOrDuplicateEvents: number;
  runtimeSeconds: number;
};

export type ControlledAgentTwoStepRunCorrelation = {
  controlledWorkspaceId?: string;
  runtimeSessionId?: string;
  runId?: string;
  workspaceReadinessId?: string;
  planningGateId?: string;
  planReviewGateId?: string;
  executionGateId?: string;
  verificationGateId?: string;
  planId?: string;
  executionRequestId?: string;
  verificationRequestId?: string;
};

export type ControlledAgentTwoStepRunState = {
  phase: ControlledAgentTwoStepRunPhase;
  authority: "two_step_run_metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  executionImplementationAdded: false;
  unattendedAutonomyAllowed: false;
  autoApplyAllowed: false;
  autoVerifyAllowed: false;
  autoRepairAllowed: false;
  canReadFiles: false;
  canWriteFiles: false;
  canRunCommands: false;
  canCallProvider: false;
  canUseTools: false;
  canUseGit: false;
  canUseNetwork: false;
  enabled: boolean;
  stopped: boolean;
  budgets: ControlledAgentTwoStepRunBudgets;
  counters: ControlledAgentTwoStepRunCounters;
  correlation: ControlledAgentTwoStepRunCorrelation;
  summary: string;
  nextUserAction: "request_plan" | "review_plan" | "request_execution" | "request_verification" | "review_followup" | "review_failure" | "none";
  stop?: {
    reason: ControlledAgentTwoStepRunStopReason;
    recoverable: boolean;
    message: string;
  };
  diagnostics: ControlledAgentTwoStepRunDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type ControlledAgentTwoStepRunEvent =
  | { type: "planning_request"; metadata: unknown }
  | { type: "plan_review"; metadata: unknown }
  | { type: "execution_request"; metadata: unknown }
  | { type: "apply_result"; metadata: unknown }
  | { type: "verification_request"; metadata: unknown }
  | { type: "verification_result"; metadata: unknown }
  | { type: "followup_ready"; metadata: unknown }
  | { type: "tick"; runtimeSeconds: number }
  | { type: "stop"; summary?: unknown };

const defaultBudgets: ControlledAgentTwoStepRunBudgets = {
  maxPlannerSteps: 4,
  maxSelectedContextItems: 3,
  maxSearchQueries: 1,
  maxSearchResults: 4,
  maxTouchedFiles: 2,
  maxEditBytes: 1200,
  maxVerificationCommands: 1,
  maxRuntimeSeconds: 900,
};

const zeroCounters: ControlledAgentTwoStepRunCounters = {
  plannerSteps: 0,
  selectedContextItems: 0,
  searchQueries: 0,
  searchResults: 0,
  filesTouched: 0,
  editBytes: 0,
  verificationCommands: 0,
  userTurns: 0,
  staleOrDuplicateEvents: 0,
  runtimeSeconds: 0,
};

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const safeIdPattern = /^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/i;
const workspacePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerTool|provider_tool|tool|tools|toolCall|tool_call|packageInstall|package_install|rawCommand|raw_command|rawArgs|raw_args|rawCwd|raw_cwd|rawEnv|raw_env|rawOutput|raw_output|rawLog|raw_log|rawPayload|raw_payload|payload|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|prompt|rawDiff|raw_diff|rawPatch|raw_patch|diff|patch|privatePath|private_path|hiddenRead|hidden_read|hiddenSearch|hidden_search|searchAll|glob|regex|index|indexing|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoFix|auto_fix|autoRepair|auto_repair|broadMutationAllowed)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff|patch|payload)|file[_ -]?(?:body|content)|provider(?:[_ -]?(?:payload|response|call))?|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|package[_ -]?install|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|production|release|auto[_ -]?(?:start|apply|run|verify|fix|repair)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;

export function createControlledAgentTwoStepRunState(): ControlledAgentTwoStepRunState {
  return buildState("idle", false, false, defaultBudgets, zeroCounters, "Two-step controlled run is idle until explicit user planning request.", "request_plan", [], {});
}

export function evaluateControlledAgentTwoStepRun(input: unknown): ControlledAgentTwoStepRunState {
  const parsed = parseInput(input);
  if (!parsed) return failedState(createControlledAgentTwoStepRunState(), "malformed_input", stopMessage("malformed_input"));
  const unsafe = findUnsafeMetadataReason(parsed);
  if (unsafe) return failedState(createControlledAgentTwoStepRunState(), "unsafe_metadata", unsafe);
  const base = createControlledAgentTwoStepRunState();
  const contractError = validateContractEnvelope(parsed);
  if (contractError) return failedState(base, contractError, stopMessage(contractError));
  const gates = parsed.gates as Record<string, unknown>;
  if (!isSatisfiedGate(gates.planningRequest) || !isSatisfiedGate(gates.planReview) || !isSatisfiedGate(gates.executionRequest) || !isSatisfiedGate(gates.verificationRequest)) {
    return failedState(base, "missing_user_gate", stopMessage("missing_user_gate"));
  }
  const plan = validatePlanCheckpoint(parsed.planCheckpoint, gates.planReview);
  if ("code" in plan) return failedState(base, plan.code, stopMessage(plan.code));
  const execution = validateExecution(parsed.execution, gates.executionRequest, plan.planId);
  if ("code" in execution) return failedState(base, execution.code, stopMessage(execution.code));
  const verification = validateVerification(parsed.verification, gates.verificationRequest);
  if ("code" in verification) return failedState(base, verification.code, stopMessage(verification.code));
  const budgets = readBudgets(parsed.limits) ?? defaultBudgets;
  const counters = countersFromContract(parsed.counters, execution, verification);
  if (verification.state === "failed") return failedState({ ...base, budgets, counters }, "verification_failed", stopMessage("verification_failed"));
  const state = buildState("completed", false, true, budgets, counters, safeText(summaryOf(parsed.followup) ?? summaryOf(parsed.phase) ?? "Two-step controlled run completed after explicit user gates.", 240), "none", [], correlationFromContract(parsed, plan, execution, verification));
  return enforceBudgets(state);
}

export function reduceControlledAgentTwoStepRunState(current: ControlledAgentTwoStepRunState, event: unknown): ControlledAgentTwoStepRunState {
  if (isTerminal(current.phase)) return current;
  const shellError = validateEventShell(event);
  if (shellError) return failedState(current, shellError, stopMessage(shellError));
  const typed = event as ControlledAgentTwoStepRunEvent;
  if (typed.type === "stop") return stoppedState(current, "user_stop", typeof typed.summary === "string" ? typed.summary : stopMessage("user_stop"));
  if (typed.type === "tick") return enforceBudgets({ ...current, counters: { ...current.counters, runtimeSeconds: typed.runtimeSeconds }, summary: "Two-step run runtime metadata was updated." });
  if (typed.type === "planning_request") return recordPlanningRequest(current, typed.metadata);
  if (typed.type === "plan_review") return recordPlanReview(current, typed.metadata);
  if (typed.type === "execution_request") return recordExecutionRequest(current, typed.metadata);
  if (typed.type === "apply_result") return recordApplyResult(current, typed.metadata);
  if (typed.type === "verification_request") return recordVerificationRequest(current, typed.metadata);
  if (typed.type === "verification_result") return recordVerificationResult(current, typed.metadata);
  return recordFollowup(current, typed.metadata);
}

function recordPlanningRequest(current: ControlledAgentTwoStepRunState, metadata: unknown): ControlledAgentTwoStepRunState {
  if (current.phase !== "idle") return duplicateState(current, "Duplicate planning request was blocked for the active two-step run.");
  const gate = validateGate(metadata);
  if (!gate) return failedState(current, "missing_user_gate", stopMessage("missing_user_gate"));
  const nextCorrelation = isPlainObject(metadata) ? { ...current.correlation, ...correlationFromMetadata(metadata), planningGateId: gate } : { ...current.correlation, planningGateId: gate };
  return buildState("planning_requested", true, false, current.budgets, { ...current.counters, userTurns: current.counters.userTurns + 1 }, summaryOf(metadata) ?? "User requested sanitized planning.", "review_plan", current.diagnostics, nextCorrelation);
}

function recordPlanReview(current: ControlledAgentTwoStepRunState, metadata: unknown): ControlledAgentTwoStepRunState {
  if (current.phase === "waiting_for_user_review") return duplicateState(current, "Duplicate plan review was blocked for the active two-step run.");
  if (current.phase !== "planning_requested") return failedState(current, "invalid_transition", stopMessage("invalid_transition"));
  const parsed = parseInput(metadata);
  if (!parsed) return failedState(current, "malformed_input", stopMessage("malformed_input"));
  const unsafe = findUnsafeMetadataReason(parsed);
  if (unsafe) return failedState(current, "unsafe_metadata", unsafe);
  const gate = validateGate(parsed.gate);
  const plan = validatePlanCheckpoint(parsed.planCheckpoint, parsed.gate);
  if (!gate || ("code" in plan)) return failedState(current, gate ? (plan as { code: ControlledAgentTwoStepRunStopReason }).code : "missing_user_gate", stopMessage(gate ? (plan as { code: ControlledAgentTwoStepRunStopReason }).code : "missing_user_gate"));
  const evidence = correlationFromMetadata(parsed);
  if (!matchesCorrelation(current.correlation, evidence)) return failedState(current, "stale_result", stopMessage("stale_result"));
  const counters = { ...current.counters, plannerSteps: plan.plannerStepCount, userTurns: current.counters.userTurns + 1 };
  return enforceBudgets(buildState("waiting_for_user_review", true, false, current.budgets, counters, plan.summary, "request_execution", current.diagnostics, { ...current.correlation, ...evidence, planReviewGateId: gate, planId: plan.planId }));
}

function recordExecutionRequest(current: ControlledAgentTwoStepRunState, metadata: unknown): ControlledAgentTwoStepRunState {
  if (current.phase === "execution_requested") return duplicateState(current, "Duplicate execution request was blocked for the active two-step run.");
  if (current.phase !== "waiting_for_user_review") return failedState(current, "invalid_transition", stopMessage("invalid_transition"));
  const gate = validateGate(metadata);
  if (!gate) return failedState(current, "missing_user_gate", stopMessage("missing_user_gate"));
  return buildState("execution_requested", true, false, current.budgets, { ...current.counters, userTurns: current.counters.userTurns + 1 }, summaryOf(metadata) ?? "User requested bounded execution after plan review.", "request_verification", current.diagnostics, { ...current.correlation, executionGateId: gate });
}

function recordApplyResult(current: ControlledAgentTwoStepRunState, metadata: unknown): ControlledAgentTwoStepRunState {
  if (current.phase === "applying_edits") return duplicateState(current, "Duplicate apply result was blocked for the active two-step run.");
  if (current.phase !== "execution_requested") return failedState(current, "invalid_transition", stopMessage("invalid_transition"));
  const parsed = parseInput(metadata);
  if (!parsed) return failedState(current, "malformed_input", stopMessage("malformed_input"));
  const unsafe = findUnsafeMetadataReason(parsed);
  if (unsafe) return failedState(current, "unsafe_metadata", unsafe);
  const execution = validateExecution(parsed, { confirmationId: current.correlation.executionGateId, satisfied: true, confirmedBy: "user", assistantMinted: false, requestIdMintedBy: "gui" }, current.correlation.planId);
  if ("code" in execution) return failedState(current, execution.code, stopMessage(execution.code));
  const evidence = { planId: execution.planId, executionRequestId: execution.requestId };
  if (!matchesCorrelation(current.correlation, evidence)) return failedState(current, "stale_result", stopMessage("stale_result"));
  const counters = { ...current.counters, filesTouched: execution.filesTouched, editBytes: execution.editBytes };
  return enforceBudgets(buildState("applying_edits", true, false, current.budgets, counters, execution.summary, "request_verification", current.diagnostics, { ...current.correlation, executionRequestId: execution.requestId }));
}

function recordVerificationRequest(current: ControlledAgentTwoStepRunState, metadata: unknown): ControlledAgentTwoStepRunState {
  if (current.phase === "running_verification_bundle") return duplicateState(current, "Duplicate verification request was blocked for the active two-step run.");
  if (current.phase !== "applying_edits") return failedState(current, "invalid_transition", stopMessage("invalid_transition"));
  const gate = validateGate(metadata);
  if (!gate) return failedState(current, "missing_user_gate", stopMessage("missing_user_gate"));
  return buildState("running_verification_bundle", true, false, current.budgets, { ...current.counters, userTurns: current.counters.userTurns + 1 }, summaryOf(metadata) ?? "User requested allowlisted verification.", "review_followup", current.diagnostics, { ...current.correlation, verificationGateId: gate });
}

function recordVerificationResult(current: ControlledAgentTwoStepRunState, metadata: unknown): ControlledAgentTwoStepRunState {
  if (current.phase === "completed") return duplicateState(current, "Duplicate verification result was blocked for the active two-step run.");
  if (current.phase !== "running_verification_bundle") return failedState(current, "invalid_transition", stopMessage("invalid_transition"));
  const parsed = parseInput(metadata);
  if (!parsed) return failedState(current, "malformed_input", stopMessage("malformed_input"));
  const unsafe = findUnsafeMetadataReason(parsed);
  if (unsafe) return failedState(current, "unsafe_metadata", unsafe);
  const verification = validateVerification(parsed, { confirmationId: current.correlation.verificationGateId, satisfied: true, confirmedBy: "user", assistantMinted: false, requestIdMintedBy: "gui" });
  if ("code" in verification) return failedState(current, verification.code, stopMessage(verification.code));
  const counters = { ...current.counters, verificationCommands: verification.commandCount };
  if (verification.state === "failed") return failedState({ ...current, counters }, "verification_failed", stopMessage("verification_failed"));
  const next = buildState("completed", false, true, current.budgets, counters, verification.summary, "none", current.diagnostics, { ...current.correlation, verificationRequestId: verification.requestId });
  return enforceBudgets(next);
}

function recordFollowup(current: ControlledAgentTwoStepRunState, metadata: unknown): ControlledAgentTwoStepRunState {
  if (current.phase !== "completed") return failedState(current, "invalid_transition", stopMessage("invalid_transition"));
  const parsed = parseInput(metadata);
  if (!parsed || parsed.state !== "draft_ready" || parsed.adjacentContract !== "agent-run-followup-prompt-draft" || parsed.autoSendAllowed !== false || !safeString(parsed.summary, 1, 240)) return failedState(current, "malformed_input", stopMessage("malformed_input"));
  return buildState("followup_ready", false, true, current.budgets, current.counters, parsed.summary, "review_followup", current.diagnostics, current.correlation);
}

function validateContractEnvelope(value: Record<string, unknown>): ControlledAgentTwoStepRunStopReason | undefined {
  if (value.kind !== "controlled_agent_two_step_run" || value.version !== "2026-07-08" || value.authority !== "two_step_run_metadata_only") return "malformed_input";
  if (value.cloudRequired !== false || value.executionImplementationAdded !== false || value.unattendedAutonomyAllowed !== false) return "unsupported_authority";
  if (!isWorkspace(value.workspace) || !isPolicyFlags(value.policyFlags) || !readBudgets(value.limits) || !isCounters(value.counters)) return "malformed_input";
  return undefined;
}

function validatePlanCheckpoint(value: unknown, gate: unknown): { planId: string; plannerStepCount: number; summary: string } | { code: ControlledAgentTwoStepRunStopReason } {
  if (!isPlainObject(value) || !isPlainObject(gate) || value.reviewGateId !== gate.confirmationId || !isSafeId(value.planId) || value.state !== "accepted" || value.reviewedByUser !== true || value.sanitizedOnly !== true || !boundedInt(value.plannerStepCount, 0, 6) || !safeString(value.summary, 1, 240) || !Array.isArray(value.steps) || value.steps.length > 6 || !value.steps.every(isPlanStep)) return { code: "missing_user_gate" };
  return { planId: value.planId, plannerStepCount: value.plannerStepCount, summary: value.summary };
}

function validateExecution(value: unknown, gate: unknown, expectedPlanId: unknown): { requestId: string; planId: string; filesTouched: number; editBytes: number; summary: string } | { code: ControlledAgentTwoStepRunStopReason } {
  if (!isPlainObject(value) || !isPlainObject(gate) || value.executionGateId !== gate.confirmationId || value.requestedByUser !== true || !isSafeId(value.requestId) || !isSafeId(value.planId) || (expectedPlanId !== undefined && value.planId !== expectedPlanId) || value.applyState !== "applied" || value.existingTextFilesOnly !== true || value.operation !== "replace" || value.broadMutation !== false || !Array.isArray(value.edits) || value.edits.length < 1 || value.edits.length > 8 || !value.edits.every(isEdit)) return { code: "unsupported_authority" };
  return { requestId: value.requestId, planId: value.planId, filesTouched: value.edits.length, editBytes: value.edits.reduce((sum, edit) => sum + edit.replacementByteCount, 0), summary: summaryOf(value) ?? "Bounded replacement metadata was applied." };
}

function validateVerification(value: unknown, gate: unknown): { requestId: string; state: "succeeded" | "failed"; commandCount: number; summary: string } | { code: ControlledAgentTwoStepRunStopReason } {
  if (!isPlainObject(value) || !isPlainObject(gate) || value.verificationGateId !== gate.confirmationId || value.requestedByUser !== true || !isSafeId(value.requestId) || (value.state !== "succeeded" && value.state !== "failed") || value.allowlistedOnly !== true || value.freeformCommandAllowed !== false || !Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > 4 || !value.commands.every(isVerificationCommand)) return { code: "unsupported_authority" };
  return { requestId: value.requestId, state: value.state, commandCount: value.commands.length, summary: value.commands.map((item) => item.summary).join("; ") || "Allowlisted verification metadata completed." };
}

function validateGate(value: unknown): string | undefined {
  return isSatisfiedGate(value) && isPlainObject(value) && isSafeId(value.confirmationId) ? value.confirmationId : undefined;
}

function isSatisfiedGate(value: unknown): boolean {
  return isPlainObject(value) && value.required === true && value.satisfied === true && value.confirmedBy === "user" && value.assistantMinted === false && (value.requestIdMintedBy === "gui" || value.requestIdMintedBy === "host") && isSafeId(value.confirmationId) && (value.summary === undefined || safeString(value.summary, 1, 240));
}

function isWorkspace(value: unknown): boolean {
  return isPlainObject(value) && isSafeId(value.controlledWorkspaceId) && isSafeId(value.runtimeSessionId) && isSafeId(value.runId) && isSafeId(value.workspaceReadinessId) && (value.workspaceMode === "disposable" || value.workspaceMode === "worktree" || value.workspaceMode === "existing") && (value.host === "vscode" || value.host === "jetbrains") && value.workspaceReady === true && value.privatePathExposed === false;
}

function isPolicyFlags(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const trueKeys = ["metadataOnly", "explicitPlanReviewRequired", "explicitExecutionRequestRequired", "explicitVerificationRequestRequired", "selectedContextOnly", "selectedSearchOnly"];
  const falseKeys = ["hiddenReadAllowed", "hiddenSearchAllowed", "indexingAllowed", "autoApplyAllowed", "autoVerifyAllowed", "autoRepairAllowed", "freeformCommandAllowed", "broadMutationAllowed", "providerCallsAllowed", "toolCallsAllowed", "rawPromptStored", "rawFileStored", "rawDiffStored", "rawCommandStored", "rawOutputStored"];
  return trueKeys.every((key) => value[key] === true) && falseKeys.every((key) => value[key] === false);
}

function isPlanStep(value: unknown): boolean {
  return isPlainObject(value) && isSafeId(value.stepId) && ["inspect_selected_context", "review_selected_search", "prepare_existing_file_replacement", "prepare_allowlisted_verification", "prepare_followup"].includes(String(value.kind)) && safeString(value.summary, 1, 240);
}

function isEdit(value: unknown): value is { replacementByteCount: number; summary: string } {
  return isPlainObject(value) && isSafeId(value.editId) && safeWorkspacePath(value.workspaceRelativePath) && isHash(value.expectedContentHash) && isHash(value.replacementContentHash) && boundedInt(value.replacementByteCount, 0, 50000) && safeString(value.summary, 1, 240);
}

function isVerificationCommand(value: unknown): value is { summary: string } {
  return isPlainObject(value) && (value.commandId === "repository-check" || value.commandId === "gui-app-tests" || value.commandId === "engine-chat-tests") && value.tailOnly === true && value.rawOutputStored === false && (value.exitCode === undefined || value.exitCode === null || boundedInt(value.exitCode, 0, 255)) && safeString(value.summary, 1, 240);
}

function readBudgets(value: unknown): ControlledAgentTwoStepRunBudgets | undefined {
  if (!isPlainObject(value) || !boundedInt(value.maxPlannerSteps, 1, 6) || !boundedInt(value.maxSelectedContextItems, 0, 12) || !boundedInt(value.maxSearchQueries, 0, 4) || !boundedInt(value.maxSearchResults, 0, 16) || !boundedInt(value.maxTouchedFiles, 0, 8) || !boundedInt(value.maxEditBytes, 0, 50000) || !boundedInt(value.maxVerificationCommands, 0, 4) || !boundedInt(value.maxRuntimeSeconds, 1, 1800)) return undefined;
  return value as ControlledAgentTwoStepRunBudgets;
}

function isCounters(value: unknown): boolean {
  return isPlainObject(value) && boundedInt(value.plannerSteps, 0, 6) && boundedInt(value.selectedContextItems, 0, 12) && boundedInt(value.searchQueries, 0, 4) && boundedInt(value.searchResults, 0, 16) && boundedInt(value.filesTouched, 0, 8) && boundedInt(value.editBytes, 0, 50000) && boundedInt(value.verificationCommands, 0, 4) && boundedInt(value.userTurns, 0, 20);
}

function countersFromContract(value: unknown, execution: { filesTouched: number; editBytes: number }, verification: { commandCount: number }): ControlledAgentTwoStepRunCounters {
  if (!isPlainObject(value)) return zeroCounters;
  return { ...zeroCounters, plannerSteps: Number(value.plannerSteps), selectedContextItems: Number(value.selectedContextItems), searchQueries: Number(value.searchQueries), searchResults: Number(value.searchResults), filesTouched: execution.filesTouched, editBytes: execution.editBytes, verificationCommands: verification.commandCount, userTurns: Number(value.userTurns) };
}

function correlationFromContract(value: Record<string, unknown>, plan: { planId: string }, execution: { requestId: string }, verification: { requestId: string }): ControlledAgentTwoStepRunCorrelation {
  const workspace = isPlainObject(value.workspace) ? value.workspace : {};
  const gates = isPlainObject(value.gates) ? value.gates : {};
  return { ...correlationFromMetadata({ workspace }), planningGateId: gateId(gates.planningRequest), planReviewGateId: gateId(gates.planReview), executionGateId: gateId(gates.executionRequest), verificationGateId: gateId(gates.verificationRequest), planId: plan.planId, executionRequestId: execution.requestId, verificationRequestId: verification.requestId };
}

function correlationFromMetadata(value: Record<string, unknown>): ControlledAgentTwoStepRunCorrelation {
  const workspace = isPlainObject(value.workspace) ? value.workspace : value;
  return {
    controlledWorkspaceId: asSafeId(workspace.controlledWorkspaceId),
    runtimeSessionId: asSafeId(workspace.runtimeSessionId),
    runId: asSafeId(workspace.runId),
    workspaceReadinessId: asSafeId(workspace.workspaceReadinessId),
  };
}

function matchesCorrelation(current: ControlledAgentTwoStepRunCorrelation, next: ControlledAgentTwoStepRunCorrelation): boolean {
  for (const key of Object.keys(next) as (keyof ControlledAgentTwoStepRunCorrelation)[]) {
    if (next[key] !== undefined && current[key] !== undefined && next[key] !== current[key]) return false;
  }
  return true;
}

function gateId(value: unknown): string | undefined {
  return isPlainObject(value) && isSafeId(value.confirmationId) ? value.confirmationId : undefined;
}

function asSafeId(value: unknown): string | undefined {
  return isSafeId(value) ? value : undefined;
}

function enforceBudgets(state: ControlledAgentTwoStepRunState): ControlledAgentTwoStepRunState {
  const over = firstExceededBudget(state.budgets, state.counters);
  return over ? failedState(state, over, stopMessage(over)) : { ...state, details: buildDetails(state.budgets, state.counters, state.correlation) };
}

function firstExceededBudget(budgets: ControlledAgentTwoStepRunBudgets, counters: ControlledAgentTwoStepRunCounters): ControlledAgentTwoStepRunStopReason | undefined {
  if (counters.plannerSteps > budgets.maxPlannerSteps || counters.selectedContextItems > budgets.maxSelectedContextItems || counters.searchQueries > budgets.maxSearchQueries || counters.searchResults > budgets.maxSearchResults || counters.filesTouched > budgets.maxTouchedFiles || counters.editBytes > budgets.maxEditBytes || counters.verificationCommands > budgets.maxVerificationCommands || counters.runtimeSeconds > budgets.maxRuntimeSeconds) return "budget_exceeded";
  return undefined;
}

function duplicateState(current: ControlledAgentTwoStepRunState, message: string): ControlledAgentTwoStepRunState {
  return failedState({ ...current, counters: { ...current.counters, staleOrDuplicateEvents: current.counters.staleOrDuplicateEvents + 1 } }, "duplicate_event", message);
}

function failedState(current: ControlledAgentTwoStepRunState, reason: ControlledAgentTwoStepRunStopReason, message: string): ControlledAgentTwoStepRunState {
  const code = diagnosticCode(reason);
  return buildState("failed", false, true, current.budgets, current.counters, message, "review_failure", [...current.diagnostics, diagnostic(code, message)], current.correlation, { reason, recoverable: reason === "verification_failed" || reason === "stale_result", message: safeText(message, 240) });
}

function stoppedState(current: ControlledAgentTwoStepRunState, reason: ControlledAgentTwoStepRunStopReason, message: string): ControlledAgentTwoStepRunState {
  return buildState("stopped", false, true, current.budgets, current.counters, message, "review_failure", [...current.diagnostics, diagnostic(diagnosticCode(reason), message)], current.correlation, { reason, recoverable: true, message: safeText(message, 240) });
}

function buildState(phase: ControlledAgentTwoStepRunPhase, enabled: boolean, stopped: boolean, budgets: ControlledAgentTwoStepRunBudgets, counters: ControlledAgentTwoStepRunCounters, summary: string, nextUserAction: ControlledAgentTwoStepRunState["nextUserAction"], diagnostics: ControlledAgentTwoStepRunDiagnostic[], correlation: ControlledAgentTwoStepRunCorrelation, stop?: ControlledAgentTwoStepRunState["stop"]): ControlledAgentTwoStepRunState {
  return {
    phase,
    authority: "two_step_run_metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    executionImplementationAdded: false,
    unattendedAutonomyAllowed: false,
    autoApplyAllowed: false,
    autoVerifyAllowed: false,
    autoRepairAllowed: false,
    canReadFiles: false,
    canWriteFiles: false,
    canRunCommands: false,
    canCallProvider: false,
    canUseTools: false,
    canUseGit: false,
    canUseNetwork: false,
    enabled,
    stopped,
    budgets,
    counters,
    correlation: sanitizeCorrelation(correlation),
    summary: safeText(summary, 240),
    nextUserAction,
    stop,
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: buildDetails(budgets, counters, correlation),
  };
}

function validateEventShell(event: unknown): ControlledAgentTwoStepRunStopReason | undefined {
  if (!isPlainObject(event) || typeof event.type !== "string") return "malformed_input";
  const shell = ["planning_request", "plan_review", "execution_request", "apply_result", "verification_request", "verification_result", "followup_ready"].includes(event.type) ? { ...event, metadata: undefined } : event;
  const unsafe = findUnsafeMetadataReason(shell);
  if (unsafe) return "unsafe_metadata";
  if (!["planning_request", "plan_review", "execution_request", "apply_result", "verification_request", "verification_result", "followup_ready", "tick", "stop"].includes(event.type)) return "malformed_input";
  if (event.type === "tick" && !boundedNumber(event.runtimeSeconds, 0, 1800)) return "malformed_input";
  return undefined;
}

function findUnsafeMetadataReason(value: unknown, depth = 0, seen = new WeakSet<object>()): string | undefined {
  if (depth > 8) return undefined;
  if (typeof value === "string") return unsafeTextPattern.test(value) ? "Two-step run metadata contained unsafe raw, authority, private path, or auto-action text." : undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    for (const item of value.slice(0, 80)) {
      const reason = findUnsafeMetadataReason(item, depth + 1, seen);
      if (reason) return reason;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (!isAllowedUnsafeLookingKey(key) && unsafeKeyPattern.test(key)) return "Two-step run metadata contained unsupported authority or raw payload fields.";
    if (key === "adjacentContract" && item === "agent-run-followup-prompt-draft") continue;
    const reason = findUnsafeMetadataReason(item, depth + 1, seen);
    if (reason) return reason;
  }
  return undefined;
}

function isAllowedUnsafeLookingKey(key: string): boolean {
  return ["selectedSearch", "searchQueries", "searchResults", "maxSearchQueries", "maxSearchResults", "indexing", "indexingAllowed", "hiddenSearches", "hiddenReads", "autoApplyAllowed", "autoVerifyAllowed", "autoRepairAllowed", "freeformCommandAllowed", "broadMutation", "broadMutationAllowed", "providerCallsAllowed", "toolCallsAllowed", "rawPromptStored", "rawFileStored", "rawDiffStored", "rawCommandStored", "rawOutputStored", "rawPayloadStored", "allowlistedOnly"].includes(key);
}

function parseInput(input: unknown): Record<string, unknown> | undefined {
  if (isPlainObject(input)) return input;
  if (typeof input !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(input);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeCorrelation(correlation: ControlledAgentTwoStepRunCorrelation): ControlledAgentTwoStepRunCorrelation {
  const sanitized: ControlledAgentTwoStepRunCorrelation = {};
  for (const [key, value] of Object.entries(correlation)) {
    if (isSafeId(value)) sanitized[key as keyof ControlledAgentTwoStepRunCorrelation] = value;
  }
  return sanitized;
}

function buildDetails(budgets: ControlledAgentTwoStepRunBudgets, counters: ControlledAgentTwoStepRunCounters, correlation: ControlledAgentTwoStepRunCorrelation): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue({ displayOnly: true, ...budgets, ...counters, ...sanitizeCorrelation(correlation), sanitized: true });
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

function diagnosticCode(reason: ControlledAgentTwoStepRunStopReason): ControlledAgentTwoStepRunDiagnosticCode {
  if (reason === "missing_user_gate") return "missing_user_gate";
  if (reason === "invalid_transition") return "invalid_transition";
  if (reason === "stale_result") return "stale_result";
  if (reason === "duplicate_event") return "duplicate_event";
  if (reason === "unsafe_metadata") return "unsafe_metadata";
  if (reason === "unsupported_authority") return "unsupported_authority";
  if (reason === "budget_exceeded") return "limit_exceeded";
  if (reason === "verification_failed") return "verification_failed";
  return "malformed_input";
}

function stopMessage(reason: ControlledAgentTwoStepRunStopReason): string {
  if (reason === "missing_user_gate") return "Two-step run requires explicit user gates before planning, execution, and verification.";
  if (reason === "invalid_transition") return "Two-step run event order is invalid; no automatic action was started.";
  if (reason === "stale_result") return "Two-step run failed closed because event correlation did not match the active run.";
  if (reason === "duplicate_event") return "Two-step run failed closed on duplicate event metadata.";
  if (reason === "unsafe_metadata") return "Two-step run failed closed because unsafe metadata was omitted.";
  if (reason === "unsupported_authority") return "Two-step run metadata claimed unsupported authority or mutation scope.";
  if (reason === "budget_exceeded") return "Two-step run stopped because a bounded counter exceeded its budget.";
  if (reason === "verification_failed") return "Two-step run stopped because allowlisted verification did not succeed.";
  if (reason === "user_stop") return "Two-step run stopped by explicit user request.";
  return "Two-step run failed closed because metadata was malformed.";
}

function diagnostic(code: ControlledAgentTwoStepRunDiagnosticCode, message: string): ControlledAgentTwoStepRunDiagnostic {
  return { code, message: safeText(message, 200) };
}

function summaryOf(value: unknown): string | undefined {
  return isPlainObject(value) && typeof value.summary === "string" && safeString(value.summary, 1, 240) ? value.summary : undefined;
}

function safeText(input: string, limit: number): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : "Two-step run metadata is unavailable.";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function safeString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && !/[\u0000-\u001F\u007F-\u009F]/u.test(value) && !unsafeTextPattern.test(value);
}

function safeWorkspacePath(value: unknown): value is string {
  return typeof value === "string" && workspacePathPattern.test(value) && !unsafeTextPattern.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && hashPattern.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}

function boundedInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isTerminal(phase: ControlledAgentTwoStepRunPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "stopped" || phase === "followup_ready";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
