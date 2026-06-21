import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";
import { toolAuthorityPolicyAllowlistedCommandIds, type ToolAuthorityPolicyAllowlistedCommandId } from "./toolAuthorityPolicy";

export const boundedPatchVerificationLoopStatuses = [
  "blocked",
  "ready_for_apply",
  "applied",
  "ready_for_verification",
  "verified",
  "verification_failed",
] as const;

export const boundedPatchVerificationLoopPolicyDecisions = [
  "blocked",
  "ready_for_user_apply",
  "ready_for_user_verification",
  "completed",
] as const;

export const boundedPatchVerificationLoopVerificationStatuses = ["not_requested", "ready", "succeeded", "failed", "blocked"] as const;

export type BoundedPatchVerificationLoopStatus = (typeof boundedPatchVerificationLoopStatuses)[number];
export type BoundedPatchVerificationLoopPolicyDecision = (typeof boundedPatchVerificationLoopPolicyDecisions)[number];
export type BoundedPatchVerificationLoopVerificationStatus = (typeof boundedPatchVerificationLoopVerificationStatuses)[number];
export type BoundedPatchVerificationLoopDisplayState = "disabled" | "blocked" | "ready_for_user_apply" | "ready_for_user_verification" | "completed";
export type BoundedPatchVerificationLoopNextUserAction = "none" | "review_prerequisites" | "confirm_apply" | "confirm_verification" | "review_verification_result";
export type BoundedPatchVerificationLoopDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unknown_or_invalid_field"
  | "unsafe_metadata"
  | "cloud_required"
  | "invalid_authority"
  | "execution_allowed"
  | "sandbox_not_ready"
  | "checkpoint_not_verified"
  | "assistant_authority_blocked"
  | "missing_trusted_request_correlation"
  | "unsafe_path"
  | "limit_exceeded"
  | "unknown_command_id"
  | "raw_execution_metadata";

export type BoundedPatchVerificationLoopDiagnostic = {
  code: BoundedPatchVerificationLoopDiagnosticCode;
  message: string;
};

export type BoundedPatchVerificationLoopSummary = {
  state: BoundedPatchVerificationLoopDisplayState;
  allowedToAutoApply: false;
  allowedToAutoRunVerification: false;
  allowedToAutoRollback: false;
  canStartAutonomousLoop: false;
  summary: string;
  nextUserAction: BoundedPatchVerificationLoopNextUserAction;
  diagnostics: BoundedPatchVerificationLoopDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

type SandboxMetadata = {
  modeStatus: "blocked" | "checkpoint_ready" | "rollback_ready";
  checkpointId: string;
  checkpointVerified: boolean;
  checkpointHash?: string;
  checkedAt?: string;
  label?: string;
};

type LimitsMetadata = {
  maxTouchedFiles: number;
  maxPatchBytes: number;
  maxSteps: number;
  maxVerificationSeconds?: number;
};

type PatchMetadata = {
  proposalId: string;
  source: "assistant_proposal" | "gui_review";
  touchedFiles: string[];
  editCount: number;
  patchBytes: number;
  contentHash: string;
  summary?: string;
};

type PolicyMetadata = {
  decision: BoundedPatchVerificationLoopPolicyDecision;
  requiresUserConfirmation: true;
  reasonCodes: string[];
  blockReason?: string;
};

type VerificationResultMetadata = {
  exitCode: number;
  durationMs: number;
  outputTail: string;
  truncated: boolean;
  resultHash: string;
};

type VerificationMetadata = {
  commandId: ToolAuthorityPolicyAllowlistedCommandId;
  status: BoundedPatchVerificationLoopVerificationStatus;
  result?: VerificationResultMetadata;
};

export type BoundedPatchVerificationLoopMetadata = {
  kind: "bounded_patch_verification_loop";
  version: "2026-06-21";
  authority: "metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  status: BoundedPatchVerificationLoopStatus;
  loopId: string;
  sandbox: SandboxMetadata;
  limits: LimitsMetadata;
  patch: PatchMetadata;
  policy: PolicyMetadata;
  verification: VerificationMetadata;
  summary?: string;
};

const statusSet = new Set<unknown>(boundedPatchVerificationLoopStatuses);
const policyDecisionSet = new Set<unknown>(boundedPatchVerificationLoopPolicyDecisions);
const verificationStatusSet = new Set<unknown>(boundedPatchVerificationLoopVerificationStatuses);
const commandIdSet = new Set<unknown>(toolAuthorityPolicyAllowlistedCommandIds);
const topLevelKeys = new Set(["kind", "version", "authority", "cloudRequired", "executionAllowed", "status", "loopId", "sandbox", "limits", "patch", "policy", "verification", "summary"]);
const sandboxKeys = new Set(["modeStatus", "checkpointId", "checkpointVerified", "checkpointHash", "checkedAt", "label"]);
const limitsKeys = new Set(["maxTouchedFiles", "maxPatchBytes", "maxSteps", "maxVerificationSeconds"]);
const patchKeys = new Set(["proposalId", "source", "touchedFiles", "editCount", "patchBytes", "contentHash", "summary"]);
const policyKeys = new Set(["decision", "requiresUserConfirmation", "reasonCodes", "blockReason"]);
const verificationKeys = new Set(["commandId", "status", "result"]);
const verificationResultKeys = new Set(["exitCode", "durationMs", "outputTail", "truncated", "resultHash"]);
const reasonCodes = new Set([
  "explicit_user_confirmation_required",
  "checkpoint_required",
  "checkpoint_verified",
  "bounded_patch_metadata_only",
  "allowlisted_verification_command_id",
  "sanitized_result_metadata_only",
  "user_apply_result_recorded",
  "blocked_by_policy",
]);
const blockedKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|stackTrace|stack_trace|callstack|privatePath|private_path|autoApply|auto_apply|autoRun|auto_run|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const rawTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|stack[_ -]?trace|callstack|shell|\bcommand\b|\bcmd\b|\bargs\b|\bcwd\b|\benv\b|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:apply|run|rollback)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathTextPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)(?!.*(?:^|\/)(?:auth|authorization|bearer|cookie|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))(?!.*(?:^|\/)sk-(?:proj-)?[A-Za-z0-9_-]{8,})[^\u0000-\u001f\u007f-\u009f]+$/i;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;

export function evaluateBoundedPatchVerificationLoop(input: unknown): BoundedPatchVerificationLoopSummary {
  const diagnostics: BoundedPatchVerificationLoopDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push({ code: "missing_input", message: "Bounded patch verification loop metadata is absent." });
    return buildEvaluation("disabled", "Bounded patch verification loop is disabled.", "none", diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = parseMetadata(input, diagnostics);
  if (!metadata) {
    return buildEvaluation("blocked", "Bounded patch verification loop metadata is blocked because it is malformed.", "review_prerequisites", diagnostics, { displayOnly: true });
  }

  if (metadata.cloudRequired !== false) {
    diagnostics.push({ code: "cloud_required", message: "Loop metadata cannot require hosted service authority." });
  }
  if (metadata.authority !== "metadata_only") {
    diagnostics.push({ code: "invalid_authority", message: "Loop metadata must be metadata only." });
  }
  if (metadata.executionAllowed !== false) {
    diagnostics.push({ code: "execution_allowed", message: "Loop metadata cannot allow execution." });
  }
  if (!safeIdPattern.test(metadata.loopId) || metadata.loopId.startsWith("assistant")) {
    diagnostics.push({ code: "missing_trusted_request_correlation", message: "Loop metadata requires safe GUI or host request correlation." });
  }
  if (metadata.patch.source !== "assistant_proposal" && metadata.patch.source !== "gui_review") {
    diagnostics.push({ code: "assistant_authority_blocked", message: "Patch proposal source cannot grant assistant authority." });
  }
  if (metadata.patch.source === "assistant_proposal" && metadata.policy.requiresUserConfirmation !== true) {
    diagnostics.push({ code: "assistant_authority_blocked", message: "Assistant-authored patch metadata requires explicit user confirmation." });
  }
  if (!commandIdSet.has(metadata.verification.commandId)) {
    diagnostics.push({ code: "unknown_command_id", message: "Verification command must be one known allowlisted command id." });
  }

  validateSandboxReadiness(metadata, diagnostics);
  validateLimits(metadata, diagnostics);
  validatePolicyState(metadata, diagnostics);
  validateVerificationResult(metadata, diagnostics);

  const details = buildDetails(metadata);
  const safeSummary = sanitizeBoundedText(metadata.summary ?? defaultSummary(metadata.status), 280, defaultSummary(metadata.status));
  if (diagnostics.length > 0 || metadata.status === "blocked" || metadata.policy.decision === "blocked") {
    return buildEvaluation("blocked", metadata.policy.blockReason ?? safeSummary, "review_prerequisites", diagnostics, details);
  }
  if (metadata.status === "ready_for_apply") {
    return buildEvaluation("ready_for_user_apply", safeSummary, "confirm_apply", diagnostics, details);
  }
  if (metadata.status === "applied" || metadata.status === "ready_for_verification" || metadata.status === "verification_failed") {
    const state = metadata.status === "verification_failed" ? "ready_for_user_verification" : "ready_for_user_verification";
    const action = metadata.status === "verification_failed" ? "review_verification_result" : "confirm_verification";
    return buildEvaluation(state, safeSummary, action, diagnostics, details);
  }
  return buildEvaluation("completed", safeSummary, "review_verification_result", diagnostics, details);
}

function parseMetadata(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): BoundedPatchVerificationLoopMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Loop metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, topLevelKeys, diagnostics);
  const status = statusSet.has(input.status) ? input.status as BoundedPatchVerificationLoopStatus : undefined;
  const sandbox = parseSandbox(input.sandbox, diagnostics);
  const limits = parseLimits(input.limits, diagnostics);
  const patch = parsePatch(input.patch, diagnostics);
  const policy = parsePolicy(input.policy, diagnostics);
  const verification = parseVerification(input.verification, diagnostics);
  if (input.kind !== "bounded_patch_verification_loop" || input.version !== "2026-06-21" || !status || typeof input.loopId !== "string" || !sandbox || !limits || !patch || !policy || !verification) {
    diagnostics.push({ code: "malformed_input", message: "Loop metadata does not match the bounded patch verification contract." });
    return undefined;
  }
  return {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: input.authority === "metadata_only" ? "metadata_only" : input.authority as "metadata_only",
    cloudRequired: input.cloudRequired === false ? false : input.cloudRequired as false,
    executionAllowed: input.executionAllowed === false ? false : input.executionAllowed as false,
    status,
    loopId: input.loopId,
    sandbox,
    limits,
    patch,
    policy,
    verification,
    summary: typeof input.summary === "string" ? input.summary : undefined,
  };
}

function parseSandbox(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): SandboxMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Sandbox metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, sandboxKeys, diagnostics);
  const modeStatus = input.modeStatus === "blocked" || input.modeStatus === "checkpoint_ready" || input.modeStatus === "rollback_ready" ? input.modeStatus : undefined;
  if (!modeStatus || typeof input.checkpointId !== "string" || typeof input.checkpointVerified !== "boolean") {
    diagnostics.push({ code: "malformed_input", message: "Sandbox checkpoint metadata is invalid." });
    return undefined;
  }
  return {
    modeStatus,
    checkpointId: input.checkpointId,
    checkpointVerified: input.checkpointVerified,
    checkpointHash: typeof input.checkpointHash === "string" ? input.checkpointHash : undefined,
    checkedAt: typeof input.checkedAt === "string" ? input.checkedAt : undefined,
    label: typeof input.label === "string" ? input.label : undefined,
  };
}

function parseLimits(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): LimitsMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Loop limits must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, limitsKeys, diagnostics);
  if (!boundedInteger(input.maxTouchedFiles, 1, 12) || !boundedInteger(input.maxPatchBytes, 1, 50000) || !boundedInteger(input.maxSteps, 1, 20) || (input.maxVerificationSeconds !== undefined && !boundedInteger(input.maxVerificationSeconds, 1, 1800))) {
    diagnostics.push({ code: "limit_exceeded", message: "Loop limits are outside allowed bounds." });
    return undefined;
  }
  return {
    maxTouchedFiles: input.maxTouchedFiles,
    maxPatchBytes: input.maxPatchBytes,
    maxSteps: input.maxSteps,
    maxVerificationSeconds: input.maxVerificationSeconds,
  };
}

function parsePatch(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): PatchMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Patch metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, patchKeys, diagnostics);
  const touchedFiles = parseTouchedFiles(input.touchedFiles, diagnostics);
  const source = input.source === "assistant_proposal" || input.source === "gui_review" ? input.source : undefined;
  if (input.source !== undefined && !source) {
    diagnostics.push({ code: "assistant_authority_blocked", message: "Patch source is not a non-authoritative metadata source." });
  }
  if (typeof input.proposalId !== "string" || !source || !touchedFiles || !boundedInteger(input.editCount, 1, 64) || !boundedInteger(input.patchBytes, 1, 50000) || typeof input.contentHash !== "string") {
    diagnostics.push({ code: "malformed_input", message: "Patch metadata is invalid." });
    return undefined;
  }
  return {
    proposalId: input.proposalId,
    source,
    touchedFiles,
    editCount: input.editCount,
    patchBytes: input.patchBytes,
    contentHash: input.contentHash,
    summary: typeof input.summary === "string" ? input.summary : undefined,
  };
}

function parsePolicy(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): PolicyMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Loop policy metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, policyKeys, diagnostics);
  const decision = policyDecisionSet.has(input.decision) ? input.decision as BoundedPatchVerificationLoopPolicyDecision : undefined;
  const codes = parseReasonCodes(input.reasonCodes, diagnostics);
  if (input.requiresUserConfirmation !== true) {
    diagnostics.push({ code: "assistant_authority_blocked", message: "Loop policy must require explicit user confirmation." });
  }
  if (!decision || codes.length === 0) {
    diagnostics.push({ code: "malformed_input", message: "Loop policy metadata is invalid." });
    return undefined;
  }
  return { decision, requiresUserConfirmation: input.requiresUserConfirmation as true, reasonCodes: codes, blockReason: typeof input.blockReason === "string" ? input.blockReason : undefined };
}

function parseVerification(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): VerificationMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Verification metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, verificationKeys, diagnostics);
  const commandId = commandIdSet.has(input.commandId) ? input.commandId as ToolAuthorityPolicyAllowlistedCommandId : undefined;
  const status = verificationStatusSet.has(input.status) ? input.status as BoundedPatchVerificationLoopVerificationStatus : undefined;
  const result = input.result === undefined ? undefined : parseVerificationResult(input.result, diagnostics);
  if (!commandId) {
    diagnostics.push({ code: "unknown_command_id", message: "Verification command id is not allowlisted." });
  }
  if (!status || !commandId || (input.result !== undefined && !result)) {
    diagnostics.push({ code: "malformed_input", message: "Verification metadata is invalid." });
    return undefined;
  }
  return { commandId, status, result };
}

function parseVerificationResult(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): VerificationResultMetadata | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Verification result metadata must be an object." });
    return undefined;
  }
  rejectUnknownKeys(input, verificationResultKeys, diagnostics);
  if (!boundedInteger(input.exitCode, 0, 255) || !boundedInteger(input.durationMs, 0, 1800000) || typeof input.outputTail !== "string" || input.truncated !== true && input.truncated !== false || typeof input.resultHash !== "string") {
    diagnostics.push({ code: "malformed_input", message: "Verification result metadata is invalid." });
    return undefined;
  }
  return { exitCode: input.exitCode, durationMs: input.durationMs, outputTail: input.outputTail, truncated: input.truncated, resultHash: input.resultHash };
}

function parseTouchedFiles(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 12) {
    diagnostics.push({ code: "limit_exceeded", message: "Touched files must be a bounded non-empty array." });
    return undefined;
  }
  const files: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || item.length > 240 || !safeRelativePathPattern.test(item) || files.includes(item)) {
      diagnostics.push({ code: "unsafe_path", message: "Touched files must be safe workspace-relative paths." });
      continue;
    }
    files.push(item);
  }
  return files.length === input.length ? files : undefined;
}

function parseReasonCodes(input: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 8) {
    diagnostics.push({ code: "malformed_input", message: "Policy reason codes must be a bounded array." });
    return [];
  }
  const codes: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || !reasonCodes.has(item) || codes.includes(item)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: "Policy reason code is unsupported." });
      continue;
    }
    codes.push(item);
  }
  return codes;
}

function validateSandboxReadiness(metadata: BoundedPatchVerificationLoopMetadata, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): void {
  if (metadata.status !== "blocked" && metadata.sandbox.modeStatus !== "checkpoint_ready" && metadata.sandbox.modeStatus !== "rollback_ready") {
    diagnostics.push({ code: "sandbox_not_ready", message: "Loop display requires checkpoint-ready or rollback-ready sandbox metadata." });
  }
  if (metadata.status !== "blocked" && metadata.sandbox.checkpointVerified !== true) {
    diagnostics.push({ code: "checkpoint_not_verified", message: "Loop display requires verified checkpoint metadata." });
  }
  if (metadata.sandbox.checkpointHash !== undefined && !safeHashPattern.test(metadata.sandbox.checkpointHash)) {
    diagnostics.push({ code: "malformed_input", message: "Checkpoint hash metadata is invalid." });
  }
}

function validateLimits(metadata: BoundedPatchVerificationLoopMetadata, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): void {
  if (metadata.patch.touchedFiles.length > metadata.limits.maxTouchedFiles) {
    diagnostics.push({ code: "limit_exceeded", message: "Patch touches more files than the loop limit." });
  }
  if (metadata.patch.patchBytes > metadata.limits.maxPatchBytes) {
    diagnostics.push({ code: "limit_exceeded", message: "Patch metadata exceeds the loop byte limit." });
  }
  if (metadata.patch.editCount > metadata.limits.maxSteps) {
    diagnostics.push({ code: "limit_exceeded", message: "Patch edit count exceeds the loop step limit." });
  }
  if (!safeIdPattern.test(metadata.patch.proposalId) || !safeHashPattern.test(metadata.patch.contentHash)) {
    diagnostics.push({ code: "malformed_input", message: "Patch id or content hash metadata is invalid." });
  }
}

function validatePolicyState(metadata: BoundedPatchVerificationLoopMetadata, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): void {
  if (metadata.policy.requiresUserConfirmation !== true || !metadata.policy.reasonCodes.includes("explicit_user_confirmation_required")) {
    diagnostics.push({ code: "assistant_authority_blocked", message: "Loop policy must keep explicit user confirmation required." });
  }
  if ((metadata.status === "ready_for_apply" && metadata.policy.decision !== "ready_for_user_apply") || ((metadata.status === "applied" || metadata.status === "ready_for_verification" || metadata.status === "verification_failed") && metadata.policy.decision !== "ready_for_user_verification") || (metadata.status === "verified" && metadata.policy.decision !== "completed") || (metadata.status === "blocked" && metadata.policy.decision !== "blocked")) {
    diagnostics.push({ code: "malformed_input", message: "Loop status and policy decision are inconsistent." });
  }
  if ((metadata.status === "applied" || metadata.status === "ready_for_verification" || metadata.status === "verified" || metadata.status === "verification_failed") && !metadata.policy.reasonCodes.includes("user_apply_result_recorded")) {
    diagnostics.push({ code: "malformed_input", message: "Applied loop states require user apply result metadata." });
  }
}

function validateVerificationResult(metadata: BoundedPatchVerificationLoopMetadata, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): void {
  if ((metadata.status === "verified" || metadata.status === "verification_failed") && !metadata.verification.result) {
    diagnostics.push({ code: "malformed_input", message: "Finished verification states require sanitized result metadata." });
  }
  if (metadata.status === "verified" && (metadata.verification.status !== "succeeded" || metadata.verification.result?.exitCode !== 0)) {
    diagnostics.push({ code: "malformed_input", message: "Verified loops require succeeded verification metadata." });
  }
  if (metadata.status === "verification_failed" && metadata.verification.status !== "failed") {
    diagnostics.push({ code: "malformed_input", message: "Failed verification loops require failed verification metadata." });
  }
  if (metadata.verification.result && !safeHashPattern.test(metadata.verification.result.resultHash)) {
    diagnostics.push({ code: "malformed_input", message: "Verification result hash metadata is invalid." });
  }
}

function scanUnsafeMetadata(value: unknown, diagnostics: BoundedPatchVerificationLoopDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (secretTextPattern.test(value) || rawTextPattern.test(value) || unsafePathTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push({ code: "unsafe_metadata", message: `Unsafe loop metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.` });
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
        diagnostics.push({ code: "raw_execution_metadata", message: `Unsupported execution metadata field ${sanitizeDisplayText(key)}.` });
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function buildDetails(metadata: BoundedPatchVerificationLoopMetadata): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({
    displayOnly: true,
    loopId: metadata.loopId,
    status: metadata.status,
    policyDecision: metadata.policy.decision,
    patchSource: metadata.patch.source,
    proposalId: metadata.patch.proposalId,
    touchedFiles: metadata.patch.touchedFiles,
    touchedFileCount: metadata.patch.touchedFiles.length,
    editCount: metadata.patch.editCount,
    patchBytes: metadata.patch.patchBytes,
    sandboxModeStatus: metadata.sandbox.modeStatus,
    checkpointVerified: metadata.sandbox.checkpointVerified,
    verificationCommandId: metadata.verification.commandId,
    verificationStatus: metadata.verification.status,
    verificationExitCode: metadata.verification.result?.exitCode,
    verificationDurationMs: metadata.verification.result?.durationMs,
    verificationOutputTail: metadata.verification.result?.outputTail,
    verificationResultTruncated: metadata.verification.result?.truncated,
    trustedRequestCorrelation: "loopId",
  });
}

function buildEvaluation(state: BoundedPatchVerificationLoopDisplayState, summary: string, nextUserAction: BoundedPatchVerificationLoopNextUserAction, diagnostics: BoundedPatchVerificationLoopDiagnostic[], details: Record<string, string | number | boolean | string[]>): BoundedPatchVerificationLoopSummary {
  const unsafeBlocked = diagnostics.some((item) => item.code === "unsafe_metadata" || item.code === "raw_execution_metadata");
  return {
    state,
    allowedToAutoApply: false,
    allowedToAutoRunVerification: false,
    allowedToAutoRollback: false,
    canStartAutonomousLoop: false,
    summary: sanitizeBoundedText(unsafeBlocked ? `${summary} [redacted]` : summary, 280, "Bounded patch verification loop is blocked."),
    nextUserAction,
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: sanitizeBoundedText(item.message, 200, "Loop metadata blocked.") })).slice(0, 24),
    details,
  };
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
      details[safeKey] = sanitizeBoundedText(value, 240, "[redacted]");
    } else if (typeof value === "number" && Number.isFinite(value)) {
      details[safeKey] = value;
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => sanitizeBoundedText(item, 160, "[redacted]")).slice(0, 12);
    }
  }
  return details;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>, diagnostics: BoundedPatchVerificationLoopDiagnostic[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported loop field ${sanitizeDisplayText(key)}.` });
    }
  }
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function sanitizeBoundedText(input: string, limit: number, fallback: string): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function defaultSummary(status: BoundedPatchVerificationLoopStatus): string {
  if (status === "ready_for_apply") {
    return "Bounded patch metadata is ready for explicit user apply.";
  }
  if (status === "applied" || status === "ready_for_verification") {
    return "Patch apply metadata is recorded and verification is waiting for explicit user confirmation.";
  }
  if (status === "verified") {
    return "User-confirmed verification metadata completed.";
  }
  if (status === "verification_failed") {
    return "Allowlisted verification metadata failed and awaits user review.";
  }
  return "Bounded patch verification loop metadata is blocked.";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
