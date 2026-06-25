import { evaluateBoundedPatchVerificationLoop } from "./boundedPatchVerificationLoop";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export const agentRunStates = [
  "idle",
  "goal_ready",
  "proposal_detected",
  "prerequisites_blocked",
  "ready_for_apply",
  "apply_requested",
  "applied",
  "ready_for_verification",
  "verification_requested",
  "verification_running",
  "verified",
  "verification_failed",
  "rollback_available",
  "blocked",
  "completed",
] as const;

export type AgentRunState = (typeof agentRunStates)[number];
export type AgentRunNextUserAction = "none" | "review_goal" | "review_prerequisites" | "confirm_apply" | "wait_for_apply" | "confirm_verification" | "review_verification" | "review_rollback" | "stop";
export type AgentRunDiagnosticCode = "missing_goal" | "missing_proposal" | "prerequisites_blocked" | "unsafe_metadata" | "raw_execution_metadata" | "malformed_input" | "assistant_authority_blocked";

export type AgentRunDiagnostic = {
  code: AgentRunDiagnosticCode;
  message: string;
};

export type AgentRunGoalMetadata = {
  id?: string;
  title?: string;
  summary?: string;
};

export type AgentRunProposalMetadata = {
  id?: string;
  summary?: string;
  touchedFiles?: string[];
  planSummary?: string;
  planSteps?: string[];
  risks?: string[];
  verificationSuggestions?: string[];
};

export type AgentRunPlanPreviewMetadata = {
  title?: string;
  summary?: string;
  steps?: string[];
  risks?: string[];
  expectedTouchedFiles?: string[];
  verificationSuggestions?: string[];
};

export type AgentRunExplicitRequestMetadata = {
  requested: boolean;
  source: "user" | "assistant" | "system";
  requestId?: string;
};

export type AgentRunApplyResultMetadata = {
  status: "applied" | "failed";
  summary?: string;
  appliedFileCount?: number;
};

export type AgentRunVerificationProgressMetadata = {
  status: "queued" | "running";
  summary?: string;
};

export type AgentRunVerificationResultMetadata = {
  status: "succeeded" | "failed";
  exitCode?: number;
  durationMs?: number;
  outputTail?: string;
};

export type AgentRunRollbackMetadata = {
  available: boolean;
  summary?: string;
};

export type AgentRunCheckpointRollbackStateMetadata = {
  kind?: "agent_run_checkpoint_rollback_state";
  displayState?: string;
  checkpoint?: {
    status?: string;
    label?: string;
  };
  rollback?: {
    status?: string;
    label?: string;
  };
  rollbackAction?: {
    trigger?: string;
    owner?: string;
    automatic?: boolean;
    label?: string;
  };
  summary?: string;
};

export type AgentRunInput = {
  goal?: AgentRunGoalMetadata;
  proposal?: AgentRunProposalMetadata;
  planPreview?: AgentRunPlanPreviewMetadata;
  planDiagnostics?: string[];
  boundedLoop?: unknown;
  applyRequest?: AgentRunExplicitRequestMetadata;
  applyResult?: AgentRunApplyResultMetadata;
  verificationRequest?: AgentRunExplicitRequestMetadata;
  verificationProgress?: AgentRunVerificationProgressMetadata;
  verificationResult?: AgentRunVerificationResultMetadata;
  rollback?: AgentRunRollbackMetadata;
  checkpointRollbackState?: AgentRunCheckpointRollbackStateMetadata;
  stopped?: boolean;
};

export type AgentRunViewModel = {
  state: AgentRunState;
  canAutoSend: false;
  canAutoApply: false;
  canAutoRunVerification: false;
  canAutoRollback: false;
  canStartAutonomousLoop: false;
  enabled: boolean;
  stopped: boolean;
  rollbackAvailable: boolean;
  summary: string;
  nextUserAction: AgentRunNextUserAction;
  diagnostics: AgentRunDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|stackTrace|stack_trace|callstack|privatePath|private_path|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const unsafeTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|stack[_ -]?trace|callstack|\bcommand\b|\bcmd\b|\bargs\b|\bcwd\b|\benv\b|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:send|apply|rollback)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathTextPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\u0000-\u001f\u007f-\u009f]+$/;

export function evaluateAgentRunState(input: unknown): AgentRunViewModel {
  const diagnostics: AgentRunDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push({ code: "missing_goal", message: "Agent Run is idle until a local task goal is selected." });
    return buildView("idle", false, false, "Agent Run is idle.", "none", diagnostics, { displayOnly: true });
  }
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Agent Run metadata must be an object." });
    return buildView("blocked", false, true, "Agent Run metadata is blocked.", "review_prerequisites", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as AgentRunInput;
  const rollbackAvailable = metadata.rollback?.available === true || metadata.checkpointRollbackState?.rollback?.status === "available";
  if (diagnostics.length > 0) {
    return buildView("blocked", true, true, "Agent Run metadata is blocked because unsafe fields were omitted.", rollbackAvailable ? "review_rollback" : "review_prerequisites", diagnostics, buildDetails(metadata, undefined));
  }
  if (metadata.stopped === true) {
    return buildView("completed", hasGoal(metadata.goal), true, "Agent Run is stopped.", "stop", diagnostics, buildDetails(metadata, undefined));
  }
  if (!hasGoal(metadata.goal)) {
    diagnostics.push({ code: "missing_goal", message: "Agent Run requires a local task goal before any action is enabled." });
    return buildView("idle", false, false, "Agent Run is idle.", "none", diagnostics, { displayOnly: true });
  }
  if (!hasProposal(metadata.proposal)) {
    return buildView("goal_ready", true, false, safeSummary(metadata.goal?.summary ?? metadata.goal?.title ?? "Goal is ready for proposal review."), "review_goal", diagnostics, buildDetails(metadata, undefined));
  }

  const boundedLoop = evaluateBoundedPatchVerificationLoop(metadata.boundedLoop);
  const boundedState = boundedLoop.state;
  const boundedDetails = boundedLoop.details;
  if (boundedState === "disabled" || boundedState === "blocked") {
    diagnostics.push({ code: "prerequisites_blocked", message: "Checkpoint and policy metadata must be ready before apply can be offered." });
    return buildView("prerequisites_blocked", true, false, `Prerequisites blocked: `, "review_prerequisites", diagnostics, buildDetails(metadata, boundedDetails));
  }

  const explicitApplyRequested = isExplicitUserRequest(metadata.applyRequest);
  const explicitVerificationRequested = isExplicitUserRequest(metadata.verificationRequest);
  if (metadata.applyRequest?.requested === true && !explicitApplyRequested) {
    diagnostics.push({ code: "assistant_authority_blocked", message: "Apply requests must come from an explicit user event." });
    return buildView("blocked", true, true, "Agent Run apply request is blocked because it was not user-confirmed.", rollbackAvailable ? "review_rollback" : "review_prerequisites", diagnostics, buildDetails(metadata, boundedDetails));
  }
  if (metadata.verificationRequest?.requested === true && !explicitVerificationRequested) {
    diagnostics.push({ code: "assistant_authority_blocked", message: "Verification requests must come from an explicit user event." });
    return buildView("blocked", true, true, "Agent Run verification request is blocked because it was not user-confirmed.", rollbackAvailable ? "review_rollback" : "review_prerequisites", diagnostics, buildDetails(metadata, boundedDetails));
  }

  if (!metadata.applyResult) {
    if (explicitApplyRequested) {
      return buildView("apply_requested", true, false, "User-confirmed apply request is recorded; waiting for apply result metadata.", "wait_for_apply", diagnostics, buildDetails(metadata, boundedDetails));
    }
    return buildView("ready_for_apply", true, false, boundedLoop.summary, "confirm_apply", diagnostics, buildDetails(metadata, boundedDetails));
  }

  if (metadata.applyResult.status === "failed") {
    return buildView(rollbackAvailable ? "rollback_available" : "blocked", true, true, safeSummary(metadata.applyResult.summary ?? "Apply failed and the run is stopped."), rollbackAvailable ? "review_rollback" : "stop", diagnostics, buildDetails(metadata, boundedDetails));
  }

  if (!metadata.verificationResult) {
    if (metadata.verificationProgress?.status === "running") {
      return buildView("verification_running", true, false, safeSummary(metadata.verificationProgress.summary ?? "User-confirmed verification is running."), "review_verification", diagnostics, buildDetails(metadata, boundedDetails));
    }
    if (explicitVerificationRequested) {
      return buildView("verification_requested", true, false, "User-confirmed verification request is recorded.", "review_verification", diagnostics, buildDetails(metadata, boundedDetails));
    }
    return buildView("ready_for_verification", true, false, "Patch apply metadata is recorded and verification requires explicit user confirmation.", "confirm_verification", diagnostics, buildDetails(metadata, boundedDetails));
  }

  if (metadata.verificationResult.status === "succeeded") {
    return buildView(rollbackAvailable ? "rollback_available" : "verified", true, true, safeSummary(metadata.verificationResult.outputTail ?? "User-confirmed verification succeeded."), rollbackAvailable ? "review_rollback" : "stop", diagnostics, buildDetails(metadata, boundedDetails));
  }
  return buildView(rollbackAvailable ? "rollback_available" : "verification_failed", true, true, safeSummary(metadata.verificationResult.outputTail ?? "User-confirmed verification failed. No automatic repair is started."), rollbackAvailable ? "review_rollback" : "review_verification", diagnostics, buildDetails(metadata, boundedDetails));
}

function hasGoal(goal: AgentRunGoalMetadata | undefined): boolean {
  return typeof goal?.title === "string" && goal.title.trim().length > 0 || typeof goal?.summary === "string" && goal.summary.trim().length > 0;
}

function hasProposal(proposal: AgentRunProposalMetadata | undefined): boolean {
  return typeof proposal?.summary === "string" && proposal.summary.trim().length > 0 || typeof proposal?.id === "string" && proposal.id.trim().length > 0;
}

function isExplicitUserRequest(request: AgentRunExplicitRequestMetadata | undefined): boolean {
  return request?.requested === true && request.source === "user";
}

function buildView(state: AgentRunState, enabled: boolean, stopped: boolean, summary: string, nextUserAction: AgentRunNextUserAction, diagnostics: AgentRunDiagnostic[], details: Record<string, string | number | boolean | string[]>): AgentRunViewModel {
  return {
    state,
    canAutoSend: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canAutoRollback: false,
    canStartAutonomousLoop: false,
    enabled,
    stopped,
    rollbackAvailable: state === "rollback_available" || details.rollbackAvailable === true,
    summary: safeSummary(summary),
    nextUserAction,
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: safeSummary(item.message, 200) })).slice(0, 24),
    details,
  };
}

function buildDetails(metadata: AgentRunInput, boundedDetails: Record<string, string | number | boolean | string[]> | undefined): Record<string, string | number | boolean | string[]> {
  const details = sanitizeDetails({
    displayOnly: true,
    goalId: safeOptionalId(metadata.goal?.id),
    goalTitle: metadata.goal?.title,
    proposalId: safeOptionalId(metadata.proposal?.id),
    proposalSummary: metadata.proposal?.summary,
    proposalPlanSummary: metadata.proposal?.planSummary,
    proposalPlanSteps: metadata.proposal?.planSteps,
    proposalRisks: metadata.proposal?.risks,
    proposalVerificationSuggestions: metadata.proposal?.verificationSuggestions,
    planPreviewTitle: metadata.planPreview?.title,
    planPreviewSummary: metadata.planPreview?.summary,
    planPreviewSteps: metadata.planPreview?.steps,
    planPreviewRisks: metadata.planPreview?.risks,
    planPreviewExpectedTouchedFiles: metadata.planPreview?.expectedTouchedFiles,
    planPreviewVerificationSuggestions: metadata.planPreview?.verificationSuggestions,
    planDiagnostics: metadata.planDiagnostics,
    touchedFiles: sanitizeTouchedFiles(metadata.proposal?.touchedFiles),
    boundedLoopState: boundedDetails?.state,
    boundedPolicyDecision: boundedDetails?.policyDecision,
    touchedFileCount: boundedDetails?.touchedFileCount,
    editCount: boundedDetails?.editCount,
    verificationCommandId: boundedDetails?.verificationCommandId,
    applyRequested: metadata.applyRequest?.requested === true,
    applyRequestSource: metadata.applyRequest?.source,
    applyStatus: metadata.applyResult?.status,
    appliedFileCount: metadata.applyResult?.appliedFileCount,
    verificationRequested: metadata.verificationRequest?.requested === true,
    verificationRequestSource: metadata.verificationRequest?.source,
    verificationProgress: metadata.verificationProgress?.status,
    verificationStatus: metadata.verificationResult?.status,
    verificationExitCode: metadata.verificationResult?.exitCode,
    verificationDurationMs: metadata.verificationResult?.durationMs,
    verificationOutputTail: metadata.verificationResult?.outputTail,
    rollbackAvailable: metadata.rollback?.available === true || metadata.checkpointRollbackState?.rollback?.status === "available",
    rollbackSummary: metadata.rollback?.summary,
    checkpointRollbackDisplayState: metadata.checkpointRollbackState?.displayState,
    checkpointRollbackSummary: metadata.checkpointRollbackState?.summary,
    checkpointRollbackCheckpointStatus: metadata.checkpointRollbackState?.checkpoint?.status,
    checkpointRollbackCheckpointLabel: metadata.checkpointRollbackState?.checkpoint?.label,
    checkpointRollbackStatus: metadata.checkpointRollbackState?.rollback?.status,
    checkpointRollbackLabel: metadata.checkpointRollbackState?.rollback?.label,
    checkpointRollbackActionLabel: metadata.checkpointRollbackState?.rollbackAction?.label,
    checkpointRollbackActionAutomatic: metadata.checkpointRollbackState?.rollbackAction?.automatic === true,
  });
  return details;
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 48)) {
    const safeKey = sanitizeDisplayText(key);
    if (value === undefined) {
      continue;
    }
    if (typeof value === "string") {
      details[safeKey] = safeSummary(value, 240);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      details[safeKey] = value;
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeSummary(item, 160)).slice(0, 12);
    }
  }
  return details;
}

function sanitizeTouchedFiles(files: string[] | undefined): string[] | undefined {
  if (!Array.isArray(files)) {
    return undefined;
  }
  return files.filter((item) => typeof item === "string" && item.length <= 240 && safeRelativePathPattern.test(item)).slice(0, 12).map((item) => safeSummary(item, 160));
}

function safeOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function scanUnsafeMetadata(value: unknown, diagnostics: AgentRunDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value) || secretTextPattern.test(value) || unsafePathTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push({ code: "unsafe_metadata", message: `Unsafe Agent Run metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.` });
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
      if (unsafeKeyPattern.test(key)) {
        diagnostics.push({ code: "raw_execution_metadata", message: `Unsupported Agent Run execution field ${sanitizeDisplayText(key)}.` });
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function safeSummary(input: string, limit = 280): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : "Agent Run metadata is unavailable.";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
