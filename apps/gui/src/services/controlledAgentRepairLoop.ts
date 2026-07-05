import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentRepairLoopState = "disabled" | "eligible" | "proposal_ready" | "edit_applied" | "verification_requested" | "repaired" | "exhausted" | "stopped" | "blocked";
export type ControlledAgentRepairLoopStopReason = "missing_failed_verification" | "ineligible_verification_status" | "missing_user_confirmation" | "attempts_exhausted" | "invalid_transition" | "user_stop" | "unsafe_metadata" | "malformed_input";
export type ControlledAgentRepairLoopDiagnosticCode = "missing_input" | "malformed_input" | "unsafe_metadata" | "invalid_transition" | "limit_exceeded" | "policy_blocked";

export type ControlledAgentRepairLoopDiagnostic = {
  code: ControlledAgentRepairLoopDiagnosticCode;
  message: string;
};

export type ControlledAgentRepairLoopStop = {
  reason: ControlledAgentRepairLoopStopReason;
  recoverable: boolean;
  message: string;
};

export type ControlledAgentRepairLoopEvaluation = {
  state: ControlledAgentRepairLoopState;
  authority: "repair_loop_metadata_only";
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
  canAttemptRepair: boolean;
  mustStop: boolean;
  attemptCount: number;
  maxAttempts: 1;
  verificationRuns: number;
  userTurns: number;
  summary: string;
  stop?: ControlledAgentRepairLoopStop;
  diagnostics: ControlledAgentRepairLoopDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

type ControlledAgentRepairLoopInput = {
  verification?: unknown;
  verificationStatus?: unknown;
  attemptCount?: unknown;
  maxAttempts?: unknown;
  userConfirmed?: unknown;
  userStopped?: unknown;
  proposal?: unknown;
  edit?: unknown;
  repairVerification?: unknown;
  summary?: unknown;
};

const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerTool|provider_tool|tool|toolCall|tool_call|packageInstall|package_install|rawCommand|raw_command|rawArgs|raw_args|rawCwd|raw_cwd|rawEnv|raw_env|rawOutput|raw_output|rawLog|raw_log|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|prompt|rawDiff|raw_diff|rawPatch|raw_patch|diff|patch|privatePath|private_path|hiddenRead|hidden_read|hiddenSearch|hidden_search|search|glob|regex|index|indexing|autoStart|auto_start|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoFix|auto_fix|autoRepair|auto_repair)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff|patch)|file[_ -]?(?:body|content)|provider(?:[_ -]?(?:payload|response))?|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|package[_ -]?install|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:start|apply|run|verify|fix|repair)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const terminalStates = new Set<ControlledAgentRepairLoopState>(["repaired", "exhausted", "stopped", "blocked"]);
const ineligibleStatuses = new Set(["succeeded", "running", "blocked", "disabled", "killed"]);

export function evaluateControlledAgentRepairLoop(input: unknown): ControlledAgentRepairLoopEvaluation {
  const diagnostics: ControlledAgentRepairLoopDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Controlled repair loop metadata is absent and remains disabled."));
    return buildEvaluation("disabled", false, false, 0, 1, 0, 0, "Controlled repair loop is disabled until failed verification metadata is available.", diagnostics);
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as ControlledAgentRepairLoopInput;
  const attemptCount = boundedInteger(metadata.attemptCount, 0, 3, 0);
  const maxAttempts = 1;
  const verificationStatus = readVerificationStatus(metadata);
  const userStopped = metadata.userStopped === true;
  const userConfirmed = metadata.userConfirmed === true;

  if (metadata.maxAttempts !== undefined && metadata.maxAttempts !== 1) diagnostics.push(diagnostic("limit_exceeded", "Controlled repair loop allows exactly one bounded repair attempt."));
  if (userStopped) return stoppedEvaluation("stopped", attemptCount, maxAttempts, "user_stop", true, "Controlled repair loop stopped by explicit user request.", diagnostics);
  if (diagnostics.some((item) => item.code === "unsafe_metadata")) return stoppedEvaluation("blocked", attemptCount, maxAttempts, "unsafe_metadata", false, "Controlled repair loop blocked unsafe repair metadata.", diagnostics);
  if (!verificationStatus) return stoppedEvaluation("blocked", attemptCount, maxAttempts, "missing_failed_verification", false, "Controlled repair loop requires failed verification metadata.", diagnostics);
  if (verificationStatus !== "failed" && verificationStatus !== "timed_out") {
    const reason = ineligibleStatuses.has(verificationStatus) ? "ineligible_verification_status" : "malformed_input";
    return stoppedEvaluation("blocked", attemptCount, maxAttempts, reason, false, "Controlled repair loop is ineligible for this verification status.", diagnostics);
  }
  if (attemptCount >= maxAttempts) return stoppedEvaluation("exhausted", attemptCount, maxAttempts, "attempts_exhausted", false, "Controlled repair loop stopped after one bounded repair attempt.", diagnostics);
  if (!userConfirmed && (metadata.proposal !== undefined || metadata.edit !== undefined || metadata.repairVerification !== undefined)) {
    return stoppedEvaluation("blocked", attemptCount, maxAttempts, "missing_user_confirmation", false, "Controlled repair loop requires user confirmation before repair metadata.", diagnostics);
  }

  const previousSummary = previousVerificationSummary(metadata);
  if (!userConfirmed) {
    return buildEvaluation("eligible", true, false, attemptCount, maxAttempts, 1, 0, previousSummary, diagnostics, { previousVerificationStatus: verificationStatus });
  }

  const cycle = evaluateRepairCycle(metadata, diagnostics);
  return buildEvaluation(cycle.state, cycle.canAttemptRepair, terminalStates.has(cycle.state), cycle.attemptCount, maxAttempts, cycle.verificationRuns, 1, cycle.summary, diagnostics, { previousVerificationStatus: verificationStatus, repairCycleStarted: true });
}

function evaluateRepairCycle(input: ControlledAgentRepairLoopInput, diagnostics: ControlledAgentRepairLoopDiagnostic[]): { state: ControlledAgentRepairLoopState; canAttemptRepair: boolean; attemptCount: number; verificationRuns: number; summary: string } {
  const proposalState = readState(input.proposal);
  const editState = readState(input.edit);
  const repairStatus = readVerificationStatus({ verification: input.repairVerification });

  if (input.repairVerification !== undefined && input.edit === undefined) {
    diagnostics.push(diagnostic("invalid_transition", "Controlled repair verification requires bounded repair edit metadata first."));
    return { state: "blocked", canAttemptRepair: false, attemptCount: 0, verificationRuns: 0, summary: "Controlled repair loop blocked invalid repair verification order." };
  }
  if (input.edit !== undefined && input.proposal === undefined) {
    diagnostics.push(diagnostic("invalid_transition", "Controlled repair edit requires user-confirmed proposal metadata first."));
    return { state: "blocked", canAttemptRepair: false, attemptCount: 0, verificationRuns: 0, summary: "Controlled repair loop blocked invalid repair edit order." };
  }
  if (proposalState === "blocked" || proposalState === "failed" || editState === "blocked" || editState === "failed") {
    diagnostics.push(diagnostic("policy_blocked", "Controlled repair proposal or edit metadata failed closed."));
    return { state: "blocked", canAttemptRepair: false, attemptCount: 0, verificationRuns: 0, summary: "Controlled repair loop blocked failed repair metadata." };
  }
  if (repairStatus === "succeeded") return { state: "repaired", canAttemptRepair: false, attemptCount: 1, verificationRuns: 1, summary: "Controlled repair loop completed one user-confirmed repair verification." };
  if (repairStatus === "failed" || repairStatus === "timed_out") return { state: "exhausted", canAttemptRepair: false, attemptCount: 1, verificationRuns: 1, summary: "Controlled repair loop stopped after failed bounded repair verification." };
  if (input.repairVerification !== undefined) {
    diagnostics.push(diagnostic("policy_blocked", "Controlled repair verification must be terminal sanitized metadata."));
    return { state: "blocked", canAttemptRepair: false, attemptCount: 0, verificationRuns: 0, summary: "Controlled repair loop blocked ineligible repair verification metadata." };
  }
  if (editState === "applied") return { state: "edit_applied", canAttemptRepair: true, attemptCount: 0, verificationRuns: 0, summary: "Controlled repair loop recorded one user-confirmed bounded edit." };
  if (proposalState === "completed" || proposalState === "planned" || input.proposal !== undefined) return { state: "proposal_ready", canAttemptRepair: true, attemptCount: 0, verificationRuns: 0, summary: "Controlled repair loop recorded one user-confirmed sanitized repair proposal." };
  return { state: "eligible", canAttemptRepair: true, attemptCount: 0, verificationRuns: 0, summary: "Controlled repair loop is eligible after user confirmation; no repair metadata has started." };
}

function readVerificationStatus(input: ControlledAgentRepairLoopInput): string | undefined {
  const verification = isPlainObject(input.verification) ? input.verification : undefined;
  const result = isPlainObject(verification?.result) ? verification.result : undefined;
  const status = input.verificationStatus ?? verification?.state ?? verification?.status ?? result?.status;
  return typeof status === "string" ? status : undefined;
}

function previousVerificationSummary(input: ControlledAgentRepairLoopInput): string {
  const verification = isPlainObject(input.verification) ? input.verification : undefined;
  const result = isPlainObject(verification?.result) ? verification.result : undefined;
  const summary = typeof input.summary === "string" ? input.summary : typeof verification?.summary === "string" ? verification.summary : typeof result?.message === "string" ? result.message : "Failed allowlisted verification is eligible for one user-confirmed bounded repair attempt.";
  return safeText(summary, 240);
}

function readState(input: unknown): string | undefined {
  if (!isPlainObject(input)) return undefined;
  const value = input.state ?? input.status;
  return typeof value === "string" ? value : undefined;
}

function stoppedEvaluation(state: ControlledAgentRepairLoopState, attemptCount: number, maxAttempts: 1, reason: ControlledAgentRepairLoopStopReason, recoverable: boolean, message: string, diagnostics: ControlledAgentRepairLoopDiagnostic[]): ControlledAgentRepairLoopEvaluation {
  const code = reason === "unsafe_metadata" ? "unsafe_metadata" : reason === "attempts_exhausted" ? "limit_exceeded" : reason === "malformed_input" ? "malformed_input" : reason === "invalid_transition" ? "invalid_transition" : "policy_blocked";
  return buildEvaluation(state, false, true, attemptCount, maxAttempts, 1, 0, message, [...diagnostics, diagnostic(code, message)], undefined, { reason, recoverable, message: safeText(message, 240) });
}

function buildEvaluation(state: ControlledAgentRepairLoopState, canAttemptRepair: boolean, mustStop: boolean, attemptCount: number, maxAttempts: 1, verificationRuns: number, userTurns: number, summary: string, diagnostics: ControlledAgentRepairLoopDiagnostic[], details: Record<string, unknown> = {}, stop?: ControlledAgentRepairLoopStop): ControlledAgentRepairLoopEvaluation {
  return {
    state,
    authority: "repair_loop_metadata_only",
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
    canAttemptRepair,
    mustStop,
    attemptCount,
    maxAttempts,
    verificationRuns,
    userTurns,
    summary: safeText(summary, 240),
    stop,
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: sanitizeDetails({ displayOnly: true, sanitized: true, repairEnabled: canAttemptRepair, autoStartAllowed: false, attemptCount, maxAttempts, verificationRuns, userTurns, ...details }),
  };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentRepairLoopDiagnostic[], depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value)) diagnostics.push(diagnostic("unsafe_metadata", "Unsafe repair loop metadata was omitted."));
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
      if (unsafeKeyPattern.test(key)) diagnostics.push(diagnostic("unsafe_metadata", "Unsupported repair loop authority field was omitted."));
      scanUnsafeMetadata(item, diagnostics, depth + 1, seen);
    }
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) return { displayOnly: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeText(value, 120);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
    if (Array.isArray(value)) details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 80)).slice(0, 8);
  }
  return details;
}

function diagnostic(code: ControlledAgentRepairLoopDiagnosticCode, message: string): ControlledAgentRepairLoopDiagnostic {
  return { code, message: safeText(message, 200) };
}

function safeText(input: string, limit: number): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : "Controlled repair loop metadata is unavailable.";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
