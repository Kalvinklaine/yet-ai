import { redactSecrets, sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentRecoveryCategory = "stop" | "stale" | "disconnect" | "timeout" | "edit_mismatch" | "verification_failure" | "repair_exhausted" | "rollback_review" | "unsupported_host";
export type ControlledAgentRecoveryVisibleState = "stop_requested" | "stop_completed" | "stale_duplicate_result" | "host_disconnect_runtime_restart" | "provider_timeout" | "edit_hash_mismatch" | "verification_bundle_failure" | "repair_followup_exhausted" | "checkpoint_rollback_review" | "unsupported_host";
export type ControlledAgentRecoveryNextAction = "acknowledge" | "start_new_run" | "manual_retry" | "review_checkpoint" | "request_user_choice" | "open_safe_summary" | "dismiss" | "contact_owner";
export type ControlledAgentRecoveryEvaluationState = "ready" | "blocked";
export type ControlledAgentRecoveryDiagnosticCode = "missing_input" | "malformed_input" | "unsafe_metadata" | "automatic_recovery_blocked" | "stale_acceptance_blocked" | "raw_private_or_secret_blocked" | "unbounded_attempts_blocked" | "unsupported_host_overclaim";

export type ControlledAgentRecoveryDiagnostic = {
  code: ControlledAgentRecoveryDiagnosticCode;
  message: string;
};

export type ControlledAgentRecoveryManualAction = {
  kind: ControlledAgentRecoveryNextAction;
  label: string;
  manualOnly: true;
  actionPayload: null;
};

export type ControlledAgentRecoveryAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  displayOnly: true;
  hasExecutableAuthority: false;
  canAutoRetry: false;
  canAutoRollback: false;
  canAutoRepair: false;
  canAcceptStaleResult: false;
  canPersistRawOutput: false;
  canPersistPrivatePath: false;
  canPersistSecrets: false;
  canMutateWorkspace: false;
  canCallProvider: false;
  canRunCommands: false;
  canUseTools: false;
  canUseGit: false;
  canUseNetwork: false;
};

export type ControlledAgentRecoveryEvaluation = {
  state: ControlledAgentRecoveryEvaluationState;
  category?: ControlledAgentRecoveryCategory;
  userVisibleState?: ControlledAgentRecoveryVisibleState;
  terminal: boolean;
  guidance: string;
  allowedManualNextActions: ControlledAgentRecoveryManualAction[];
  blockedReasons: string[];
  diagnostics: ControlledAgentRecoveryDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentRecoveryAuthority;
};

type RecoveryInput = {
  category?: unknown;
  userVisibleState?: unknown;
  visibleState?: unknown;
  state?: unknown;
  terminal?: unknown;
  resultAccepted?: unknown;
  hostSupportClaimed?: unknown;
  allowedNextActions?: unknown;
  attemptBudget?: unknown;
  privacy?: unknown;
  policyFlags?: unknown;
  summary?: unknown;
  stateId?: unknown;
  host?: unknown;
};

type AttemptBudget = {
  maxAttempts: number;
  attemptsUsed: number;
  moreAttemptsAllowed: boolean;
  requiresUserConfirmation: boolean;
};

const authority: ControlledAgentRecoveryAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  displayOnly: true,
  hasExecutableAuthority: false,
  canAutoRetry: false,
  canAutoRollback: false,
  canAutoRepair: false,
  canAcceptStaleResult: false,
  canPersistRawOutput: false,
  canPersistPrivatePath: false,
  canPersistSecrets: false,
  canMutateWorkspace: false,
  canCallProvider: false,
  canRunCommands: false,
  canUseTools: false,
  canUseGit: false,
  canUseNetwork: false,
};

const visibleStateToCategory: Record<ControlledAgentRecoveryVisibleState, ControlledAgentRecoveryCategory> = {
  stop_requested: "stop",
  stop_completed: "stop",
  stale_duplicate_result: "stale",
  host_disconnect_runtime_restart: "disconnect",
  provider_timeout: "timeout",
  edit_hash_mismatch: "edit_mismatch",
  verification_bundle_failure: "verification_failure",
  repair_followup_exhausted: "repair_exhausted",
  checkpoint_rollback_review: "rollback_review",
  unsupported_host: "unsupported_host",
};

const categoryFallbackState: Record<ControlledAgentRecoveryCategory, ControlledAgentRecoveryVisibleState> = {
  stop: "stop_requested",
  stale: "stale_duplicate_result",
  disconnect: "host_disconnect_runtime_restart",
  timeout: "provider_timeout",
  edit_mismatch: "edit_hash_mismatch",
  verification_failure: "verification_bundle_failure",
  repair_exhausted: "repair_followup_exhausted",
  rollback_review: "checkpoint_rollback_review",
  unsupported_host: "unsupported_host",
};

const guidanceByState: Record<ControlledAgentRecoveryVisibleState, string> = {
  stop_requested: "The run is stopping visibly. Wait for closure or open the sanitized summary; retry remains user chosen.",
  stop_completed: "The stopped run is closed. Start a new run only after an explicit user choice.",
  stale_duplicate_result: "A late or duplicate result was ignored. Do not accept stale output; review only the sanitized summary.",
  host_disconnect_runtime_restart: "The host or local runtime disconnected. Ask the user before any manual retry or new run.",
  provider_timeout: "The configured model timed out within the bounded window. A manual retry needs visible user confirmation and remaining budget.",
  edit_hash_mismatch: "The edit no longer matches reviewed hashes. Keep apply blocked and show safe evidence only.",
  verification_bundle_failure: "Verification failed, timed out, or was blocked. Offer only bounded manual choices and safe summaries.",
  repair_followup_exhausted: "The repair budget is exhausted. Stop repair guidance and wait for a new user-started run.",
  checkpoint_rollback_review: "A checkpoint is available for review only. File restoration needs a separate explicit action elsewhere.",
  unsupported_host: "This host is unsupported for the controlled-agent path. Fail closed without claiming recovery support.",
};

const defaultActionsByState: Record<ControlledAgentRecoveryVisibleState, ControlledAgentRecoveryNextAction[]> = {
  stop_requested: ["acknowledge", "open_safe_summary"],
  stop_completed: ["acknowledge", "start_new_run", "dismiss"],
  stale_duplicate_result: ["acknowledge", "start_new_run", "open_safe_summary"],
  host_disconnect_runtime_restart: ["request_user_choice", "manual_retry", "start_new_run"],
  provider_timeout: ["acknowledge", "manual_retry", "start_new_run"],
  edit_hash_mismatch: ["acknowledge", "start_new_run", "open_safe_summary"],
  verification_bundle_failure: ["acknowledge", "manual_retry", "start_new_run", "open_safe_summary"],
  repair_followup_exhausted: ["acknowledge", "start_new_run", "open_safe_summary"],
  checkpoint_rollback_review: ["review_checkpoint", "request_user_choice", "dismiss"],
  unsupported_host: ["acknowledge", "dismiss", "contact_owner"],
};

const actionLabels: Record<ControlledAgentRecoveryNextAction, string> = {
  acknowledge: "Acknowledge visible state",
  start_new_run: "Start a new run manually",
  manual_retry: "Retry manually after confirmation",
  review_checkpoint: "Review checkpoint",
  request_user_choice: "Ask for user choice",
  open_safe_summary: "Open sanitized summary",
  dismiss: "Dismiss",
  contact_owner: "Contact owner",
};

const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerPayload|provider_payload|providerResponse|provider_response|tool|toolCall|tool_call|rawOutput|raw_output|rawLog|raw_log|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawDiff|raw_diff|diff|patch|privatePath|private_path|secret|token|apiKey|api_key|password|autoRetry|auto_retry|autoRollback|auto_rollback|autoRepair|auto_repair|hiddenRetry|hidden_retry|hiddenRepair|hidden_repair|executeRollback|execute_rollback|mutateWorkspace|mutate_workspace)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:output|log|file|prompt|diff|patch)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response)|shell|\bcommand\s*[:=]|\bcwd\s*[:=]|\benv\s*[:=]|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:retry|rollback|repair|run|apply)|hidden[_ -]?(?:retry|repair|read|search)|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const supportedCategories = new Set<ControlledAgentRecoveryCategory>(["stop", "stale", "disconnect", "timeout", "edit_mismatch", "verification_failure", "repair_exhausted", "rollback_review", "unsupported_host"]);
const supportedStates = new Set<ControlledAgentRecoveryVisibleState>(Object.keys(visibleStateToCategory) as ControlledAgentRecoveryVisibleState[]);
const supportedActions = new Set<ControlledAgentRecoveryNextAction>(["acknowledge", "start_new_run", "manual_retry", "review_checkpoint", "request_user_choice", "open_safe_summary", "dismiss", "contact_owner"]);

export function evaluateControlledAgentRecoveryMatrix(input: unknown): ControlledAgentRecoveryEvaluation {
  const diagnostics: ControlledAgentRecoveryDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Recovery metadata is absent."));
    return blocked(diagnostics, "Recovery guidance is unavailable until sanitized metadata is present.");
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as RecoveryInput;
  const visibleState = readVisibleState(metadata);
  const category = readCategory(metadata, visibleState);
  const attemptBudget = readAttemptBudget(metadata.attemptBudget);

  if (!visibleState || !category) {
    diagnostics.push(diagnostic("malformed_input", "Recovery metadata needs a supported visible state or category."));
  }

  detectUnsafePolicy(metadata, visibleState, category, attemptBudget, diagnostics);

  if (diagnostics.length > 0 || !visibleState || !category) {
    return blocked(diagnostics, visibleState ? guidanceByState[visibleState] : "Recovery guidance is blocked until safe metadata is available.", visibleState, category, metadata, attemptBudget);
  }

  const allowedManualNextActions = buildActions(visibleState, metadata.allowedNextActions, attemptBudget);
  return {
    state: "ready",
    category,
    userVisibleState: visibleState,
    terminal: metadata.terminal === true,
    guidance: safeText(guidanceByState[visibleState], 260),
    allowedManualNextActions,
    blockedReasons: [],
    diagnostics: [],
    details: details(metadata, visibleState, category, attemptBudget, allowedManualNextActions.length),
    authority,
  };
}

function readVisibleState(input: RecoveryInput): ControlledAgentRecoveryVisibleState | undefined {
  const value = typeof input.userVisibleState === "string" ? input.userVisibleState : typeof input.visibleState === "string" ? input.visibleState : typeof input.state === "string" ? input.state : undefined;
  const normalized = value?.trim();
  return normalized && supportedStates.has(normalized as ControlledAgentRecoveryVisibleState) ? normalized as ControlledAgentRecoveryVisibleState : undefined;
}

function readCategory(input: RecoveryInput, visibleState: ControlledAgentRecoveryVisibleState | undefined): ControlledAgentRecoveryCategory | undefined {
  if (visibleState) return visibleStateToCategory[visibleState];
  const value = typeof input.category === "string" ? input.category.trim() : undefined;
  return value && supportedCategories.has(value as ControlledAgentRecoveryCategory) ? value as ControlledAgentRecoveryCategory : undefined;
}

function readAttemptBudget(value: unknown): AttemptBudget {
  if (!isPlainObject(value)) return { maxAttempts: 0, attemptsUsed: 0, moreAttemptsAllowed: false, requiresUserConfirmation: true };
  return {
    maxAttempts: boundedInteger(value.maxAttempts, 0, 100, 0),
    attemptsUsed: boundedInteger(value.attemptsUsed, 0, 100, 0),
    moreAttemptsAllowed: value.moreAttemptsAllowed === true,
    requiresUserConfirmation: value.requiresUserConfirmation !== false,
  };
}

function detectUnsafePolicy(input: RecoveryInput, visibleState: ControlledAgentRecoveryVisibleState | undefined, category: ControlledAgentRecoveryCategory | undefined, attemptBudget: AttemptBudget, diagnostics: ControlledAgentRecoveryDiagnostic[]): void {
  const policy = isPlainObject(input.policyFlags) ? input.policyFlags : {};
  const privacy = isPlainObject(input.privacy) ? input.privacy : {};
  if (policy.hiddenRetryAllowed === true || policy.automaticRollbackAllowed === true || policy.hiddenRepairAllowed === true || booleanField(input, ["autoRetry", "autoRollback", "autoRepair", "hiddenRetry", "hiddenRepair", "executeRollback"])) {
    diagnostics.push(diagnostic("automatic_recovery_blocked", "Automatic retry, rollback, and hidden repair are blocked."));
  }
  if (policy.staleResultAccepted === true || (visibleState === "stale_duplicate_result" && input.resultAccepted === true)) {
    diagnostics.push(diagnostic("stale_acceptance_blocked", "Stale or duplicate recovery results cannot be accepted."));
  }
  if (policy.rawOutputPersistenceAllowed === true || policy.privatePathPersistenceAllowed === true || policy.secretPersistenceAllowed === true || privacy.sanitizedOnly === false || privacy.rawOutputStored === true || privacy.privatePathStored === true || privacy.secretStored === true) {
    diagnostics.push(diagnostic("raw_private_or_secret_blocked", "Raw output, private paths, and secrets cannot be persisted in recovery metadata."));
  }
  if (policy.unboundedRepairAllowed === true || attemptBudget.maxAttempts > 2 || attemptBudget.attemptsUsed > attemptBudget.maxAttempts || (attemptBudget.moreAttemptsAllowed && attemptBudget.maxAttempts > 2)) {
    diagnostics.push(diagnostic("unbounded_attempts_blocked", "Recovery attempts must stay bounded to at most two visible attempts."));
  }
  if (policy.unsupportedHostClaimsSupport === true || (category === "unsupported_host" && input.hostSupportClaimed === true)) {
    diagnostics.push(diagnostic("unsupported_host_overclaim", "Unsupported hosts cannot claim controlled-agent recovery support."));
  }
}

function buildActions(visibleState: ControlledAgentRecoveryVisibleState, requestedActions: unknown, attemptBudget: AttemptBudget): ControlledAgentRecoveryManualAction[] {
  const defaults = defaultActionsByState[visibleState];
  const requested = Array.isArray(requestedActions) ? requestedActions.filter((item): item is ControlledAgentRecoveryNextAction => typeof item === "string" && supportedActions.has(item as ControlledAgentRecoveryNextAction)) : defaults;
  const safe = requested.filter((item) => defaults.includes(item));
  const deduped = [...new Set(safe.length > 0 ? safe : defaults)];
  return deduped.filter((item) => item !== "manual_retry" || (attemptBudget.requiresUserConfirmation && attemptBudget.maxAttempts > 0 && attemptBudget.attemptsUsed < attemptBudget.maxAttempts && attemptBudget.moreAttemptsAllowed)).map((kind) => ({ kind, label: actionLabels[kind], manualOnly: true, actionPayload: null }));
}

function blocked(diagnostics: ControlledAgentRecoveryDiagnostic[], guidance: string, visibleState?: ControlledAgentRecoveryVisibleState, category?: ControlledAgentRecoveryCategory, input?: RecoveryInput, attemptBudget: AttemptBudget = { maxAttempts: 0, attemptsUsed: 0, moreAttemptsAllowed: false, requiresUserConfirmation: true }): ControlledAgentRecoveryEvaluation {
  const cleanDiagnostics = diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24);
  return {
    state: "blocked",
    category,
    userVisibleState: visibleState,
    terminal: input?.terminal === true,
    guidance: safeText(guidance, 260),
    allowedManualNextActions: [],
    blockedReasons: cleanDiagnostics.map((item) => item.message),
    diagnostics: cleanDiagnostics,
    details: details(input, visibleState, category, attemptBudget, 0),
    authority,
  };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentRecoveryDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value) || redactSecrets(value) !== value) diagnostics.push(diagnostic("unsafe_metadata", `Unsafe recovery metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (!isPlainObject(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    const childPath = keyPath ? `${keyPath}.${key}` : key;
    if (unsafeKeyPattern.test(key)) diagnostics.push(diagnostic("unsafe_metadata", `Unsupported recovery metadata field ${sanitizeDisplayText(key)}.`));
    scanUnsafeMetadata(item, diagnostics, childPath, depth + 1, seen);
  }
}

function details(input: RecoveryInput | undefined, visibleState: ControlledAgentRecoveryVisibleState | undefined, category: ControlledAgentRecoveryCategory | undefined, attemptBudget: AttemptBudget, allowedActionCount: number): Record<string, string | number | boolean | string[]> {
  const summary = typeof input?.summary === "string" && !unsafeTextPattern.test(input.summary) ? input.summary : undefined;
  const value = sanitizeDisplayValue({
    displayOnly: true,
    visibleState,
    category,
    terminal: input?.terminal === true,
    maxAttempts: attemptBudget.maxAttempts,
    attemptsUsed: attemptBudget.attemptsUsed,
    moreAttemptsAllowed: attemptBudget.moreAttemptsAllowed,
    requiresUserConfirmation: attemptBudget.requiresUserConfirmation,
    allowedActionCount,
    summary,
    executionAllowed: false,
    automaticRecoveryAllowed: false,
  });
  if (!isPlainObject(value)) return { displayOnly: true };
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof item === "string") output[safeKey] = safeText(item, 180);
    if (typeof item === "number" && Number.isFinite(item)) output[safeKey] = item;
    if (typeof item === "boolean") output[safeKey] = item;
    if (Array.isArray(item)) output[safeKey] = item.filter((entry): entry is string => typeof entry === "string").map((entry) => safeText(entry, 80)).slice(0, 8);
  }
  return output;
}

function booleanField(input: RecoveryInput, keys: string[]): boolean {
  return keys.some((key) => (input as Record<string, unknown>)[key] === true);
}

function diagnostic(code: ControlledAgentRecoveryDiagnosticCode, message: string): ControlledAgentRecoveryDiagnostic {
  return { code, message: safeText(message, 220) };
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n\t<>]+/g, " ").trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function controlledAgentRecoveryVisibleStateForCategory(category: ControlledAgentRecoveryCategory): ControlledAgentRecoveryVisibleState {
  return categoryFallbackState[category];
}
