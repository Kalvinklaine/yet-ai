import { evaluateBoundedPatchVerificationLoop, type BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";
import type { AgentRunGoalMetadata, AgentRunInput, AgentRunProposalMetadata } from "./agentRunState";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";
import { evaluateSandboxExperimentalSession } from "./sandboxExperimentalSession";
import { evaluateToolAuthorityPolicy, type ToolAuthorityPolicyAllowlistedCommandId } from "./toolAuthorityPolicy";

export type AgentRunReadinessDiagnosticCode =
  | "missing_goal"
  | "missing_proposal"
  | "missing_checkpoint"
  | "checkpoint_not_verified"
  | "sandbox_not_ready"
  | "policy_not_ready"
  | "missing_verification_command_id"
  | "unsafe_metadata"
  | "unsafe_path"
  | "raw_execution_metadata"
  | "malformed_input";

export type AgentRunReadinessDiagnostic = {
  code: AgentRunReadinessDiagnosticCode;
  message: string;
};

export type AgentRunReadinessState = "blocked" | "ready";

export type AgentRunReadinessProposalMetadata = AgentRunProposalMetadata & {
  source?: "assistant_proposal" | "gui_review";
  editCount: number;
  patchBytes: number;
  contentHash: string;
};

export type AgentRunReadinessCheckpointMetadata = {
  checkpointId: string;
  checkpointVerified: boolean;
  checkpointHash?: string;
  checkedAt?: string;
  label?: string;
};

export type AgentRunReadinessInput = {
  loopId: string;
  goal: AgentRunGoalMetadata;
  proposal: AgentRunReadinessProposalMetadata;
  checkpoint: AgentRunReadinessCheckpointMetadata;
  sandbox: unknown;
  policy: unknown;
  verificationCommandId: ToolAuthorityPolicyAllowlistedCommandId;
};

export type AgentRunReadinessResult = {
  state: AgentRunReadinessState;
  agentRunInput: AgentRunInput;
  boundedLoop?: BoundedPatchVerificationLoopMetadata;
  diagnostics: AgentRunReadinessDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const commandIds = new Set<ToolAuthorityPolicyAllowlistedCommandId>(["repository-check", "gui-app-tests", "engine-chat-tests"]);
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|stackTrace|stack_trace|callstack|privatePath|private_path|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const unsafeTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|stack[_ -]?trace|callstack|shell|\bcommand\s*[:=]|\bcmd\s*[:=]|\bargs\s*[:=]|\bcwd\s*[:=]|\benv\s*[:=]|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:send|apply|run|rollback)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathTextPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)(?!.*(?:^|\/)(?:auth|authorization|bearer|cookie|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))(?!.*(?:^|\/)sk-(?:proj-)?[A-Za-z0-9_-]{8,})[^\u0000-\u001f\u007f-\u009f]+$/i;

export function composeAgentRunReadiness(input: unknown): AgentRunReadinessResult {
  const diagnostics: AgentRunReadinessDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Agent Run readiness metadata must be an object."));
    return blocked({}, diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as Partial<AgentRunReadinessInput>;
  const goal = sanitizeGoal(metadata.goal, diagnostics);
  const proposal = sanitizeProposal(metadata.proposal, diagnostics);
  const checkpoint = sanitizeCheckpoint(metadata.checkpoint, diagnostics);
  const verificationCommandId = sanitizeVerificationCommandId(metadata.verificationCommandId, diagnostics);
  const loopId = safeRequiredId(metadata.loopId) ? metadata.loopId : undefined;
  if (!loopId) {
    diagnostics.push(diagnostic("malformed_input", "Readiness metadata requires a safe loop correlation id."));
  }

  const agentRunInput: AgentRunInput = stripUndefined({ goal, proposal: proposal ? { id: proposal.id, summary: proposal.summary, touchedFiles: proposal.touchedFiles } : undefined });
  const sandbox = evaluateSandboxExperimentalSession(metadata.sandbox);
  const policy = evaluateToolAuthorityPolicy(metadata.policy);
  if (sandbox.state !== "checkpoint_ready" && sandbox.state !== "rollback_ready") {
    diagnostics.push(diagnostic("sandbox_not_ready", "Sandbox metadata must be checkpoint-ready or rollback-ready."));
  }
  if (policy.decision !== "requires_confirmation" || policy.allowlistedCommandId !== verificationCommandId || policy.capability !== "allowlisted_verification") {
    diagnostics.push(diagnostic("policy_not_ready", "Policy metadata must require confirmation for the selected allowlisted verification command id."));
  }
  if (checkpoint && sandbox.details.checkpointVerified !== true) {
    diagnostics.push(diagnostic("checkpoint_not_verified", "Sandbox details must confirm the checkpoint is verified."));
  }

  if (diagnostics.length > 0 || !goal || !proposal || !checkpoint || !verificationCommandId || !loopId) {
    return blocked(agentRunInput, diagnostics, readinessDetails(goal, proposal, checkpoint, verificationCommandId, sandbox.state, policy.decision));
  }

  const boundedLoop: BoundedPatchVerificationLoopMetadata = {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status: "ready_for_apply",
    loopId,
    sandbox: {
      modeStatus: sandbox.state === "rollback_ready" ? "rollback_ready" : "checkpoint_ready",
      checkpointId: checkpoint.checkpointId,
      checkpointVerified: true,
      checkpointHash: checkpoint.checkpointHash,
      checkedAt: checkpoint.checkedAt,
      label: checkpoint.label,
    },
    limits: {
      maxTouchedFiles: 4,
      maxPatchBytes: 50000,
      maxSteps: 20,
      maxVerificationSeconds: 1800,
    },
    patch: {
      proposalId: proposal.id,
      source: proposal.source,
      touchedFiles: proposal.touchedFiles,
      editCount: proposal.editCount,
      patchBytes: proposal.patchBytes,
      contentHash: proposal.contentHash,
      summary: proposal.summary,
    },
    policy: {
      decision: "ready_for_user_apply",
      requiresUserConfirmation: true,
      reasonCodes: ["explicit_user_confirmation_required", "checkpoint_required", "checkpoint_verified", "bounded_patch_metadata_only", "allowlisted_verification_command_id"],
    },
    verification: {
      commandId: verificationCommandId,
      status: "not_requested",
    },
    summary: safeText(`Ready for explicit user apply: ${goal.summary ?? goal.title ?? proposal.summary}`, 280),
  };
  const boundedEvaluation = evaluateBoundedPatchVerificationLoop(boundedLoop);
  if (boundedEvaluation.state !== "ready_for_user_apply") {
    diagnostics.push(...boundedEvaluation.diagnostics.map((item) => diagnostic(item.code === "unsafe_path" ? "unsafe_path" : item.code === "raw_execution_metadata" ? "raw_execution_metadata" : item.code === "checkpoint_not_verified" ? "checkpoint_not_verified" : "malformed_input", item.message)));
    return blocked(agentRunInput, diagnostics, boundedEvaluation.details);
  }

  return {
    state: "ready",
    agentRunInput: { ...agentRunInput, boundedLoop },
    boundedLoop,
    diagnostics: [],
    details: boundedEvaluation.details,
  };
}

function blocked(agentRunInput: AgentRunInput, diagnostics: AgentRunReadinessDiagnostic[], details: Record<string, string | number | boolean | string[]>): AgentRunReadinessResult {
  return {
    state: "blocked",
    agentRunInput,
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata" || item.code === "raw_execution_metadata") ? { ...details, redacted: "[redacted]" } : details),
  };
}

function sanitizeGoal(goal: unknown, diagnostics: AgentRunReadinessDiagnostic[]): AgentRunGoalMetadata | undefined {
  if (!isPlainObject(goal)) {
    diagnostics.push(diagnostic("missing_goal", "Agent Run readiness requires goal metadata."));
    return undefined;
  }
  const id = safeOptionalId(goal.id);
  const title = typeof goal.title === "string" ? safeText(goal.title, 160) : undefined;
  const summary = typeof goal.summary === "string" ? safeText(goal.summary, 240) : undefined;
  if (!title && !summary) {
    diagnostics.push(diagnostic("missing_goal", "Agent Run readiness requires a goal title or summary."));
    return undefined;
  }
  return stripUndefined({ id, title, summary });
}

function sanitizeProposal(proposal: unknown, diagnostics: AgentRunReadinessDiagnostic[]): Required<Pick<AgentRunReadinessProposalMetadata, "id" | "summary" | "touchedFiles" | "source" | "editCount" | "patchBytes" | "contentHash">> | undefined {
  if (!isPlainObject(proposal)) {
    diagnostics.push(diagnostic("missing_proposal", "Agent Run readiness requires proposal metadata."));
    return undefined;
  }
  const id = safeOptionalId(proposal.id);
  const summary = typeof proposal.summary === "string" ? safeText(proposal.summary, 240) : undefined;
  const touchedFiles = sanitizeTouchedFiles(proposal.touchedFiles, diagnostics);
  const source = proposal.source === "gui_review" ? "gui_review" : "assistant_proposal";
  const editCount = boundedInteger(proposal.editCount, 1, 64) ? proposal.editCount : undefined;
  const patchBytes = boundedInteger(proposal.patchBytes, 1, 50000) ? proposal.patchBytes : undefined;
  const contentHash = typeof proposal.contentHash === "string" && safeHashPattern.test(proposal.contentHash) ? proposal.contentHash : undefined;
  if (!id || !summary || !touchedFiles || !editCount || !patchBytes || !contentHash) {
    diagnostics.push(diagnostic("missing_proposal", "Proposal metadata must include safe id, summary, touched files, edit count, patch byte count, and content hash."));
    return undefined;
  }
  return { id, summary, touchedFiles, source, editCount, patchBytes, contentHash };
}

function sanitizeCheckpoint(checkpoint: unknown, diagnostics: AgentRunReadinessDiagnostic[]): AgentRunReadinessCheckpointMetadata | undefined {
  if (!isPlainObject(checkpoint)) {
    diagnostics.push(diagnostic("missing_checkpoint", "Agent Run readiness requires checkpoint metadata."));
    return undefined;
  }
  const checkpointId = safeOptionalId(checkpoint.checkpointId);
  const checkpointHash = typeof checkpoint.checkpointHash === "string" && safeHashPattern.test(checkpoint.checkpointHash) ? checkpoint.checkpointHash : undefined;
  if (!checkpointId) {
    diagnostics.push(diagnostic("missing_checkpoint", "Checkpoint metadata requires a safe checkpoint id."));
    return undefined;
  }
  if (checkpoint.checkpointVerified !== true) {
    diagnostics.push(diagnostic("checkpoint_not_verified", "Agent Run readiness requires a verified checkpoint."));
    return undefined;
  }
  return stripUndefined({
    checkpointId,
    checkpointVerified: true,
    checkpointHash,
    checkedAt: typeof checkpoint.checkedAt === "string" ? safeText(checkpoint.checkedAt, 80) : undefined,
    label: typeof checkpoint.label === "string" ? safeText(checkpoint.label, 120) : undefined,
  });
}

function sanitizeVerificationCommandId(value: unknown, diagnostics: AgentRunReadinessDiagnostic[]): ToolAuthorityPolicyAllowlistedCommandId | undefined {
  if (commandIds.has(value as ToolAuthorityPolicyAllowlistedCommandId)) {
    return value as ToolAuthorityPolicyAllowlistedCommandId;
  }
  diagnostics.push(diagnostic("missing_verification_command_id", "Readiness metadata requires an allowlisted verification command id."));
  return undefined;
}

function sanitizeTouchedFiles(value: unknown, diagnostics: AgentRunReadinessDiagnostic[]): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    diagnostics.push(diagnostic("unsafe_path", "Proposal touched files must be a bounded non-empty list."));
    return undefined;
  }
  const files: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > 240 || !safeRelativePathPattern.test(item) || files.includes(item)) {
      diagnostics.push(diagnostic("unsafe_path", "Proposal touched files must be safe workspace-relative paths."));
      continue;
    }
    files.push(safeText(item, 160));
  }
  return files.length === value.length ? files : undefined;
}

function readinessDetails(goal: AgentRunGoalMetadata | undefined, proposal: AgentRunProposalMetadata | undefined, checkpoint: AgentRunReadinessCheckpointMetadata | undefined, verificationCommandId: ToolAuthorityPolicyAllowlistedCommandId | undefined, sandboxState: string, policyDecision: string): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({
    displayOnly: true,
    goalId: goal?.id,
    proposalId: proposal?.id,
    touchedFiles: proposal?.touchedFiles,
    checkpointVerified: checkpoint?.checkpointVerified === true,
    sandboxState,
    policyDecision,
    verificationCommandId,
  });
}

function scanUnsafeMetadata(value: unknown, diagnostics: AgentRunReadinessDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value) || secretTextPattern.test(value) || unsafePathTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe Agent Run readiness metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
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
        diagnostics.push(diagnostic("raw_execution_metadata", `Unsupported Agent Run readiness execution field ${sanitizeDisplayText(key)}.`));
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") {
      details[safeKey] = safeText(value, 240);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      details[safeKey] = value;
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 160)).slice(0, 12);
    }
  }
  return details;
}

function safeRequiredId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(sanitizeDisplayText(value).trim());
}

function safeOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function diagnostic(code: AgentRunReadinessDiagnosticCode, message: string): AgentRunReadinessDiagnostic {
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
