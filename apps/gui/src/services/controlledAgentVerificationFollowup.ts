import { correlateControlledAgentVerificationBundleResult, type ControlledAgentVerificationBundleCommandSummary, type ControlledAgentVerificationBundleRequestCorrelation, type ControlledAgentVerificationBundleState } from "./controlledAgentVerificationBundle";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentVerificationFollowupAction = "explain_result" | "suggest_manual_next_step" | "draft_manual_fix_prompt" | "close_run" | "no_action";
export type ControlledAgentVerificationFollowupDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unsafe_metadata"
  | "stale_lineage"
  | "missing_lineage"
  | "missing_user_action"
  | "non_terminal_verification"
  | "invalid_authority";

export type ControlledAgentVerificationFollowupDiagnostic = {
  code: ControlledAgentVerificationFollowupDiagnosticCode;
  message: string;
};

export type ControlledAgentVerificationFollowupAuthority = {
  cloudRequired: false;
  executionAllowed: false;
  automaticProviderSendAllowed: false;
  automaticRepairAllowed: false;
  autoApplyAllowed: false;
  hiddenContextGatheringAllowed: false;
  canCallProvider: false;
  canRunRepair: false;
  canApplyEdits: false;
  canRunVerification: false;
  canReadFiles: false;
  canUseTools: false;
  draftOnly: true;
  requiresUserSend: true;
};

export type ControlledAgentVerificationFollowupDraft = {
  kind: "controlled_agent_verification_followup";
  version: "2026-07-08";
  authority: "verification_followup_metadata";
  cloudRequired: false;
  executionAllowed: false;
  automaticProviderSendAllowed: false;
  automaticRepairAllowed: false;
  autoApplyAllowed: false;
  hiddenContextGatheringAllowed: false;
  sourceBundle: {
    kind: "controlled_agent_verification_bundle";
    bundleId: string;
    aggregateStatus: Exclude<ControlledAgentVerificationBundleState, "planned" | "running">;
    commandCount: number;
    failedCount: number;
    resultHash: string;
    summary: string;
  };
  verificationSummaries: Array<{
    commandId: ControlledAgentVerificationBundleCommandSummary["commandId"];
    label: string;
    status: Exclude<ControlledAgentVerificationBundleState, "planned" | "running">;
    exitCode?: number | null;
    safeOutputTailSummary: string;
    outputTailHash: string;
    outputByteCount: number;
    outputLineCount: number;
    errorCategory: "none" | "test_failure" | "type_error" | "lint_error" | "timeout" | "policy_denied" | "runner_error" | "unknown";
    truncated: boolean;
  }>;
  userSelectedNextAction: ControlledAgentVerificationFollowupAction;
  followupProposal: {
    intent: "followup" | "fix" | "explain" | "close";
    title: string;
    promptSummary: string;
    draftOnly: true;
    requiresUserSend: true;
    contextDigestHash: string;
  };
  contextPolicy: {
    allowedSources: ["sanitized_verification_summary_metadata", "user_selected_next_action"];
    forbidRawStdoutStderr: true;
    forbidCommandStrings: true;
    forbidCwdEnv: true;
    forbidPrivatePathsAndSecrets: true;
    forbidProviderToolCalls: true;
    forbidHiddenContextGathering: true;
  };
  manualActionPolicy: {
    requiresExplicitUserNextAction: true;
    requiresExplicitUserSendClick: true;
    noAutomaticProviderSend: true;
    noAutomaticRepair: true;
    noAutoApply: true;
    noAutoVerification: true;
    noWorkspaceMutation: true;
    noExecutionAuthority: true;
    noProductionAutonomyClaim: true;
  };
};

export type ControlledAgentVerificationFollowupResult = {
  state: "ready" | "blocked";
  draft?: ControlledAgentVerificationFollowupDraft;
  diagnostics: ControlledAgentVerificationFollowupDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  authority: ControlledAgentVerificationFollowupAuthority;
};

export type ControlledAgentVerificationFollowupInput = {
  current?: ControlledAgentVerificationBundleRequestCorrelation;
  bundleResult?: unknown;
  userSelectedNextAction?: unknown;
};

const authority: ControlledAgentVerificationFollowupAuthority = {
  cloudRequired: false,
  executionAllowed: false,
  automaticProviderSendAllowed: false,
  automaticRepairAllowed: false,
  autoApplyAllowed: false,
  hiddenContextGatheringAllowed: false,
  canCallProvider: false,
  canRunRepair: false,
  canApplyEdits: false,
  canRunVerification: false,
  canReadFiles: false,
  canUseTools: false,
  draftOnly: true,
  requiresUserSend: true,
};

const contextPolicy: ControlledAgentVerificationFollowupDraft["contextPolicy"] = {
  allowedSources: ["sanitized_verification_summary_metadata", "user_selected_next_action"],
  forbidRawStdoutStderr: true,
  forbidCommandStrings: true,
  forbidCwdEnv: true,
  forbidPrivatePathsAndSecrets: true,
  forbidProviderToolCalls: true,
  forbidHiddenContextGathering: true,
};

const manualActionPolicy: ControlledAgentVerificationFollowupDraft["manualActionPolicy"] = {
  requiresExplicitUserNextAction: true,
  requiresExplicitUserSendClick: true,
  noAutomaticProviderSend: true,
  noAutomaticRepair: true,
  noAutoApply: true,
  noAutoVerification: true,
  noWorkspaceMutation: true,
  noExecutionAuthority: true,
  noProductionAutonomyClaim: true,
};

const actionSet = new Set<ControlledAgentVerificationFollowupAction>(["explain_result", "suggest_manual_next_step", "draft_manual_fix_prompt", "close_run", "no_action"]);
const terminalStatusSet = new Set(["succeeded", "failed", "timed_out", "blocked", "killed"]);
const unsafeKeyPattern = /^(?:stdout|stderr|rawStdout|rawStderr|rawOutput|rawLog|command|cmd|commandString|rawCommand|args|arguments|cwd|env|environment|shell|git|network|provider|providerPayload|providerResponse|providerTool|tool|toolCall|rawFile|fileBody|fileContents|rawDiff|diff|patch|replacement|secret|token|authorization|hiddenRead|hiddenSearch|hiddenScan|autoSend|automaticProviderSend|automaticProviderSendAllowed|autoRun|autoVerify|autoFix|autoRepair|automaticRepair|automaticRepairAllowed|autoApply|autoApplyAllowed|productionClaim|productionClaimAllowed|autonomyClaim|autonomyClaimAllowed)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|secret|password|cookie|raw[_ -]?(?:stdout|stderr|file|prompt|command|output|log|diff)|stdout[_ -]?(?:dump|tail)|stderr[_ -]?(?:dump|tail)|command[_ -]?(?:string|field)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool|call)|tool[_ -]?(?:call|use)|\bcwd\b|\benv\b|\bshell\b|\bgit\b|network|hidden[_ -]?(?:scan|read|search)|index(?:ing)?|auto[_ -]?(?:send|start|apply|run|verify|fix|repair|rollback)|autonom(?:y|ous)|production|release|marketplace|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;

export function buildControlledAgentVerificationFollowup(input: unknown): ControlledAgentVerificationFollowupResult {
  const diagnostics: ControlledAgentVerificationFollowupDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Verification follow-up metadata is absent."));
    return blocked(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as ControlledAgentVerificationFollowupInput;
  if (!isPlainObject(metadata.current)) {
    diagnostics.push(diagnostic("missing_lineage", "Verification follow-up requires prior GUI verification bundle correlation."));
  }
  const userSelectedNextAction = safeAction(metadata.userSelectedNextAction);
  if (!userSelectedNextAction) {
    diagnostics.push(diagnostic("missing_user_action", "Verification follow-up requires an explicit user selected next action."));
  }

  const correlated = correlateControlledAgentVerificationBundleResult({ current: metadata.current, bundleResult: metadata.bundleResult });
  if (correlated.state === "ignored") {
    diagnostics.push(diagnostic("stale_lineage", "Verification follow-up ignored a stale bundle result that does not match current correlation."));
  } else if (correlated.state !== "accepted" || !correlated.bundle) {
    diagnostics.push(...correlated.diagnostics.map((item) => diagnostic(item.code === "stale_result" ? "stale_lineage" : "malformed_input", item.message)));
  }

  const bundle = correlated.bundle;
  if (bundle && (!bundle.status || !terminalStatusSet.has(bundle.status))) {
    diagnostics.push(diagnostic("non_terminal_verification", "Verification follow-up requires a terminal verification bundle result."));
  }
  if (hasAuthorityOverclaim(input)) {
    diagnostics.push(diagnostic("invalid_authority", "Verification follow-up cannot claim provider send, repair, apply, verify, execution, production, or autonomy authority."));
  }

  const details = sanitizeDetails({ displayOnly: true, bundleId: bundle?.bundleId, runId: bundle?.runId, controlledWorkspaceId: bundle?.controlledWorkspaceId, workspaceReadinessId: bundle?.workspaceReadinessId, status: bundle?.status, userSelectedNextAction });
  if (diagnostics.length > 0 || !bundle || !bundle.bundleId || !bundle.status || !userSelectedNextAction || !terminalStatusSet.has(bundle.status)) {
    return blocked(diagnostics, details);
  }

  const aggregateStatus = bundle.status as Exclude<ControlledAgentVerificationBundleState, "planned" | "running">;
  const verificationSummaries = bundle.commands.map((command) => commandSummary(command));
  const failedCount = verificationSummaries.filter((item) => item.status !== "succeeded").length;
  const sourceSummary = safeSummary(statusSummary(aggregateStatus, failedCount, verificationSummaries.length));
  const sourceHash = firstSafeHash(bundle.commands.map((command) => command.resultHash)) ?? digestHash(`${bundle.bundleId}:${aggregateStatus}:${verificationSummaries.map((item) => `${item.commandId}:${item.status}:${item.outputTailHash}`).join("|")}`);
  const proposal = followupProposal(userSelectedNextAction, aggregateStatus, failedCount, verificationSummaries);
  const draft: ControlledAgentVerificationFollowupDraft = {
    kind: "controlled_agent_verification_followup",
    version: "2026-07-08",
    authority: "verification_followup_metadata",
    cloudRequired: false,
    executionAllowed: false,
    automaticProviderSendAllowed: false,
    automaticRepairAllowed: false,
    autoApplyAllowed: false,
    hiddenContextGatheringAllowed: false,
    sourceBundle: {
      kind: "controlled_agent_verification_bundle",
      bundleId: bundle.bundleId,
      aggregateStatus,
      commandCount: verificationSummaries.length,
      failedCount,
      resultHash: sourceHash,
      summary: sourceSummary,
    },
    verificationSummaries,
    userSelectedNextAction,
    followupProposal: {
      ...proposal,
      draftOnly: true,
      requiresUserSend: true,
      contextDigestHash: digestHash(`${bundle.bundleId}:${userSelectedNextAction}:${JSON.stringify(verificationSummaries)}`),
    },
    contextPolicy,
    manualActionPolicy,
  };
  return { state: "ready", draft, diagnostics: [], details, authority };
}

function commandSummary(command: ControlledAgentVerificationBundleCommandSummary): ControlledAgentVerificationFollowupDraft["verificationSummaries"][number] {
  const status = terminalStatusSet.has(command.status) ? command.status as Exclude<ControlledAgentVerificationBundleState, "planned" | "running"> : "blocked";
  const safeOutputTailSummary = safeSummary(command.summary || `${labelForCommand(command.commandId)} completed with bounded verification metadata.`);
  return stripUndefined({
    commandId: command.commandId,
    label: labelForCommand(command.commandId),
    status,
    exitCode: command.exitCode,
    safeOutputTailSummary,
    outputTailHash: command.resultHash && safeHashPattern.test(command.resultHash) ? command.resultHash : digestHash(`${command.commandId}:${command.status}:${command.summary}`),
    outputByteCount: boundedNumber(command.outputByteCount, 0, 20000),
    outputLineCount: boundedNumber(command.outputLineCount, 0, 400),
    errorCategory: errorCategory(status, command.summary),
    truncated: command.truncated === true,
  });
}

function followupProposal(action: ControlledAgentVerificationFollowupAction, status: Exclude<ControlledAgentVerificationBundleState, "planned" | "running">, failedCount: number, summaries: ControlledAgentVerificationFollowupDraft["verificationSummaries"]): Pick<ControlledAgentVerificationFollowupDraft["followupProposal"], "intent" | "title" | "promptSummary"> {
  if (action === "draft_manual_fix_prompt") {
    return { intent: "fix", title: "Draft manual fix prompt", promptSummary: safeSummary("Ask for a bounded explanation and a manually reviewed fix proposal using summary metadata only.") };
  }
  if (action === "explain_result") {
    return { intent: "explain", title: "Explain verification result", promptSummary: safeSummary("Ask for a concise explanation of the sanitized verification result summary only.") };
  }
  if (action === "close_run" || action === "no_action") {
    return { intent: "close", title: action === "close_run" ? "Close verified run" : "No follow-up action", promptSummary: safeSummary("Record that no automatic follow-up action is requested from this metadata draft.") };
  }
  const failingLabels = summaries.filter((item) => item.status !== "succeeded").map((item) => item.label).slice(0, 2).join(", ");
  return { intent: failedCount > 0 || status !== "succeeded" ? "followup" : "explain", title: "Suggest manual next step", promptSummary: safeSummary(failingLabels ? `Suggest a bounded manual next step for ${failingLabels} using summary metadata only.` : "Suggest a bounded manual next step using summary metadata only.") };
}

function scanUnsafeMetadata(value: unknown, diagnostics: ControlledAgentVerificationFollowupDiagnostic[], keyPath = "input", depth = 0, seen = new WeakSet<object>()): void {
  if (value === undefined || diagnostics.length > 32 || depth > 8) return;
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe verification follow-up metadata omitted near ${safeDiagnosticLabel(keyPath)}.`));
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (unsafeKeyPattern.test(key) && key !== "userSelectedNextAction" && !(key.endsWith("Allowed") && item === false)) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported verification follow-up field ${safeDiagnosticLabel(key)}.`));
      }
      scanUnsafeMetadata(item, diagnostics, `${keyPath}.${safeDiagnosticLabel(key)}`, depth + 1, seen);
    }
  }
}

function hasAuthorityOverclaim(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const rendered = JSON.stringify(sanitizeDisplayValue(value));
  return /"(?:executionAllowed|automaticProviderSendAllowed|automaticRepairAllowed|autoApplyAllowed|hiddenContextGatheringAllowed|autoVerifyAllowed|providerAllowed|repairAllowed|productionClaimAllowed|autonomyClaimAllowed)"\s*:\s*true/i.test(rendered);
}

function safeAction(value: unknown): ControlledAgentVerificationFollowupAction | undefined {
  return typeof value === "string" && actionSet.has(value as ControlledAgentVerificationFollowupAction) ? value as ControlledAgentVerificationFollowupAction : undefined;
}

function statusSummary(status: Exclude<ControlledAgentVerificationBundleState, "planned" | "running">, failedCount: number, commandCount: number): string {
  if (status === "succeeded") return `${commandCount} user approved checks completed with sanitized summary metadata.`;
  if (failedCount > 0) return `${failedCount} user approved check reported a bounded failure category.`;
  return `User approved verification ended with ${status} status using sanitized summary metadata.`;
}

function errorCategory(status: Exclude<ControlledAgentVerificationBundleState, "planned" | "running">, summary: string): ControlledAgentVerificationFollowupDraft["verificationSummaries"][number]["errorCategory"] {
  if (status === "succeeded") return "none";
  if (status === "timed_out") return "timeout";
  if (status === "blocked" || status === "killed") return "policy_denied";
  if (/type/i.test(summary)) return "type_error";
  if (/lint/i.test(summary)) return "lint_error";
  if (/test|assert|spec/i.test(summary)) return "test_failure";
  return "unknown";
}

function labelForCommand(commandId: ControlledAgentVerificationBundleCommandSummary["commandId"]): string {
  if (commandId === "repository-check") return "Repository check";
  if (commandId === "gui-app-tests") return "GUI app tests";
  if (commandId === "engine-chat-tests") return "Engine chat tests";
  return "Verification check";
}

function firstSafeHash(values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && safeHashPattern.test(value));
}

function digestHash(value: string): string {
  let first = 2166136261;
  let second = 16777619;
  for (let index = 0; index < value.length; index += 1) {
    first ^= value.charCodeAt(index);
    first = Math.imul(first, 16777619);
    second ^= value.charCodeAt(value.length - index - 1);
    second = Math.imul(second, 2166136261);
  }
  const seed = `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
  return `sha256:${seed.repeat(4).slice(0, 64)}`;
}

function safeSummary(value: string): string {
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n\t<>]+/g, " ").trim();
  const safe = sanitized && !unsafeTextPattern.test(sanitized) && !stackTracePattern.test(sanitized) ? sanitizeDisplayText(sanitized) : "Sanitized verification summary metadata is available for manual review.";
  return safe.length > 360 ? `${safe.slice(0, 360)}…` : safe;
}

function safeDiagnosticLabel(value: string): string {
  const sanitized = sanitizeDisplayText(value).replace(/[\r\n\t<>]+/g, " ").trim();
  return sanitized && !unsafeTextPattern.test(sanitized) ? sanitized.slice(0, 80) : "field";
}

function boundedNumber(value: unknown, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : 0;
}

function blocked(diagnostics: ControlledAgentVerificationFollowupDiagnostic[], details: Record<string, string | number | boolean | string[]>): ControlledAgentVerificationFollowupResult {
  const unsafe = diagnostics.some((item) => item.code === "unsafe_metadata");
  return { state: "blocked", diagnostics: sanitizedDiagnostics(diagnostics), details: sanitizeDetails(unsafe ? { ...details, redacted: "[redacted]" } : details), authority };
}

function sanitizedDiagnostics(diagnostics: ControlledAgentVerificationFollowupDiagnostic[]): ControlledAgentVerificationFollowupDiagnostic[] {
  return diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 32);
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) return { displayOnly: true };
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") details[safeKey] = safeSummary(value).slice(0, 180);
    if (typeof value === "number" && Number.isFinite(value)) details[safeKey] = value;
    if (typeof value === "boolean") details[safeKey] = value;
    if (Array.isArray(value)) details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeSummary(item).slice(0, 80)).slice(0, 8);
  }
  return details;
}

function diagnostic(code: ControlledAgentVerificationFollowupDiagnosticCode, message: string): ControlledAgentVerificationFollowupDiagnostic {
  return { code, message: safeSummary(message).slice(0, 200) };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
