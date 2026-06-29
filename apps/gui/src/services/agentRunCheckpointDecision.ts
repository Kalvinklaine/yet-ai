import { evaluateAgentRunState, type AgentRunDiagnostic, type AgentRunInput, type AgentRunViewModel } from "./agentRunState";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type AgentRunCheckpointDecisionStatus = "continue_available" | "rollback_review_available" | "separate_run_suggested" | "blocked" | "unavailable";
export type AgentRunCheckpointRecommendedDecision = "continue_current_checkpoint" | "review_rollback" | "start_separate_manual_run" | "stop" | "none";
export type AgentRunCheckpointDecisionCardKind = "continue" | "stop" | "review_rollback" | "start_separate_manual_run";
export type AgentRunCheckpointDecisionCardState = "available" | "recommended" | "disabled";
export type AgentRunCheckpointDecisionDiagnosticCode = "malformed_input" | "unsafe_metadata" | "raw_execution_metadata" | "assistant_authority_blocked" | "unsupported_host" | "checkpoint_unavailable" | "manual_review_required";
export type AgentRunCheckpointDecisionHost = "browser" | "vscode" | "jetbrains";

export type AgentRunCheckpointDecisionDiagnostic = {
  code: AgentRunCheckpointDecisionDiagnosticCode;
  message: string;
};

export type AgentRunCheckpointDecisionCard = {
  kind: AgentRunCheckpointDecisionCardKind;
  label: string;
  state: AgentRunCheckpointDecisionCardState;
  reason: string;
  manualOnly: true;
  actionPayload: null;
};

export type AgentRunCheckpointDecisionSummary = {
  status: AgentRunCheckpointDecisionStatus;
  recommendedDecision: AgentRunCheckpointRecommendedDecision;
  decisionCards: AgentRunCheckpointDecisionCard[];
  diagnostics: AgentRunCheckpointDecisionDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
  canAutoContinue: false;
  canAutoApply: false;
  canAutoRollback: false;
  canAutoRunVerification: false;
  canStartAutonomousLoop: false;
  hasExecutableAuthority: false;
  displayOnly: true;
};

type DecisionInput = {
  agentRun?: unknown;
  host?: unknown;
  checkpoint?: unknown;
  rollback?: unknown;
  applyResult?: unknown;
  verificationResult?: unknown;
  boundedLoop?: unknown;
};

const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|stackTrace|stack_trace|callstack|privatePath|private_path|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoRollback|auto_rollback|autoContinue|auto_continue|applyPatch|apply_patch|rollbackRequest|rollback_request|executeRollback|execute_rollback|actionPayload|action_payload)$/i;
const unsafeTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|stack[_ -]?trace|callstack|shell|\bcommand\s*[:=]|\bcmd\s*[:=]|\bargs\s*[:=]|\bcwd\s*[:=]|\benv\s*[:=]|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:send|apply|run|rollback|continue)|apply[_ -]?patch|execute[_ -]?rollback/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathTextPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const supportedHosts = new Set<unknown>(["vscode", "jetbrains"]);

export function buildAgentRunCheckpointDecision(input: unknown): AgentRunCheckpointDecisionSummary {
  const diagnostics: AgentRunCheckpointDecisionDiagnostic[] = [];
  if (input === undefined || input === null) {
    diagnostics.push({ code: "malformed_input", message: "Checkpoint decision metadata is unavailable." });
    return buildSummary("unavailable", "none", diagnostics, undefined, "Checkpoint decision is unavailable.");
  }
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_input", message: "Checkpoint decision metadata must be an object." });
    return buildSummary("blocked", "none", diagnostics, undefined, "Checkpoint decision metadata is blocked.");
  }

  scanUnsafeMetadata(input, diagnostics);
  const decisionInput = input as DecisionInput;
  const host = typeof decisionInput.host === "string" ? decisionInput.host : "browser";
  const agentRunInput = normalizeAgentRunInput(decisionInput);
  const agentRun = evaluateAgentRunState(agentRunInput);
  diagnostics.push(...agentRunDiagnostics(agentRun.diagnostics));

  if (host !== "browser" && !supportedHosts.has(host)) {
    diagnostics.push({ code: "unsupported_host", message: "Checkpoint decisions are display-only for unsupported hosts." });
  }
  if (host === "browser") {
    diagnostics.push({ code: "unsupported_host", message: "Browser preview can display checkpoint decisions but cannot continue, apply, verify, or rollback." });
  }

  if (diagnostics.some((item) => item.code === "unsafe_metadata" || item.code === "raw_execution_metadata" || item.code === "assistant_authority_blocked")) {
    return buildSummary("blocked", "stop", diagnostics, agentRun, "Checkpoint decision metadata is blocked because unsafe executable fields were omitted.");
  }
  if (host === "browser" || !supportedHosts.has(host)) {
    return buildSummary("unavailable", "none", diagnostics, agentRun, "Open a supported IDE host to choose a manual checkpoint decision.");
  }

  const rollbackAvailable = agentRun.rollbackAvailable === true;
  const applyFailed = agentRun.details.applyStatus === "failed";
  const verificationFailed = agentRun.details.verificationStatus === "failed" || agentRun.state === "verification_failed";
  const verificationSucceeded = agentRun.details.verificationStatus === "succeeded" || agentRun.state === "verified";
  const applySucceeded = agentRun.details.applyStatus === "applied";

  if (rollbackAvailable && (applyFailed || verificationFailed || agentRun.state === "rollback_available")) {
    return buildSummary("rollback_review_available", "review_rollback", diagnostics, agentRun, "Rollback metadata is available for manual review only.");
  }
  if (applyFailed) {
    diagnostics.push({ code: "manual_review_required", message: "Apply failed; stop this checkpoint unless rollback review metadata is available." });
    return buildSummary("blocked", "stop", diagnostics, agentRun, "Apply failed and no automatic rollback is available.");
  }
  if (verificationFailed) {
    diagnostics.push({ code: "manual_review_required", message: "Verification failed; use a separate manual run for follow-up work." });
    return buildSummary("separate_run_suggested", "start_separate_manual_run", diagnostics, agentRun, "Verification failed; start a separate manual run if follow-up changes are needed.");
  }
  if (applySucceeded && verificationSucceeded) {
    return buildSummary("continue_available", "continue_current_checkpoint", diagnostics, agentRun, "Checkpoint can be continued manually after successful verification metadata.");
  }

  diagnostics.push({ code: "checkpoint_unavailable", message: "Checkpoint decision requires safe apply and verification result metadata." });
  return buildSummary("unavailable", "none", diagnostics, agentRun, "Checkpoint decision is unavailable until apply and verification metadata are recorded.");
}

function normalizeAgentRunInput(input: DecisionInput): unknown {
  if (input.agentRun !== undefined) {
    return input.agentRun;
  }
  const run = input as AgentRunInput;
  return {
    ...run,
    boundedLoop: run.boundedLoop ?? input.boundedLoop,
    applyResult: run.applyResult ?? input.applyResult,
    verificationResult: run.verificationResult ?? input.verificationResult,
    rollback: run.rollback ?? input.rollback,
  };
}

function agentRunDiagnostics(items: AgentRunDiagnostic[]): AgentRunCheckpointDecisionDiagnostic[] {
  return items.map((item) => ({ code: mapAgentRunDiagnosticCode(item.code), message: item.message })).slice(0, 12);
}

function mapAgentRunDiagnosticCode(code: AgentRunDiagnostic["code"]): AgentRunCheckpointDecisionDiagnosticCode {
  if (code === "raw_execution_metadata") {
    return "raw_execution_metadata";
  }
  if (code === "unsafe_metadata") {
    return "unsafe_metadata";
  }
  if (code === "assistant_authority_blocked") {
    return "assistant_authority_blocked";
  }
  if (code === "malformed_input") {
    return "malformed_input";
  }
  return "checkpoint_unavailable";
}

function buildSummary(status: AgentRunCheckpointDecisionStatus, recommendedDecision: AgentRunCheckpointRecommendedDecision, diagnostics: AgentRunCheckpointDecisionDiagnostic[], agentRun: AgentRunViewModel | undefined, fallbackReason: string): AgentRunCheckpointDecisionSummary {
  return {
    status,
    recommendedDecision,
    decisionCards: buildDecisionCards(status, recommendedDecision, fallbackReason),
    diagnostics: sanitizeDiagnostics(diagnostics),
    details: buildDetails(agentRun, fallbackReason),
    canAutoContinue: false,
    canAutoApply: false,
    canAutoRollback: false,
    canAutoRunVerification: false,
    canStartAutonomousLoop: false,
    hasExecutableAuthority: false,
    displayOnly: true,
  };
}

function buildDecisionCards(status: AgentRunCheckpointDecisionStatus, recommendedDecision: AgentRunCheckpointRecommendedDecision, fallbackReason: string): AgentRunCheckpointDecisionCard[] {
  const cards: Array<{ kind: AgentRunCheckpointDecisionCardKind; decision: AgentRunCheckpointRecommendedDecision; label: string; available: boolean; reason: string }> = [
    { kind: "continue", decision: "continue_current_checkpoint", label: "Continue current checkpoint", available: status === "continue_available", reason: "Continue is a manual recommendation after successful apply and verification metadata." },
    { kind: "review_rollback", decision: "review_rollback", label: "Review rollback", available: status === "rollback_review_available", reason: "Rollback is review-only and has no execute payload." },
    { kind: "start_separate_manual_run", decision: "start_separate_manual_run", label: "Start separate manual run", available: status === "separate_run_suggested", reason: "Follow-up work should start as a separate user-controlled run." },
    { kind: "stop", decision: "stop", label: "Stop", available: status === "blocked" || status === "rollback_review_available" || status === "separate_run_suggested", reason: "Stop keeps the current checkpoint closed without executing follow-up actions." },
  ];
  return cards.map((card): AgentRunCheckpointDecisionCard => ({
    kind: card.kind,
    label: safeText(card.label, 80),
    state: card.decision === recommendedDecision ? "recommended" : card.available ? "available" : "disabled",
    reason: safeText(card.available ? card.reason : fallbackReason, 220),
    manualOnly: true,
    actionPayload: null,
  })).slice(0, 4);
}

function buildDetails(agentRun: AgentRunViewModel | undefined, fallbackReason: string): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue({
    displayOnly: true,
    reason: fallbackReason,
    agentRunState: agentRun?.state,
    nextUserAction: agentRun?.nextUserAction,
    rollbackAvailable: agentRun?.rollbackAvailable,
    applyStatus: agentRun?.details.applyStatus,
    verificationStatus: agentRun?.details.verificationStatus,
    verificationExitCode: agentRun?.details.verificationExitCode,
    appliedFileCount: agentRun?.details.appliedFileCount,
    touchedFiles: agentRun?.details.touchedFiles,
  });
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 20)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") {
      details[safeKey] = safeText(value, 220);
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

function sanitizeDiagnostics(diagnostics: AgentRunCheckpointDecisionDiagnostic[]): AgentRunCheckpointDecisionDiagnostic[] {
  return diagnostics.map((item) => ({ code: item.code, message: safeText(item.message, 200) })).slice(0, 24);
}

function scanUnsafeMetadata(value: unknown, diagnostics: AgentRunCheckpointDecisionDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value) || secretTextPattern.test(value) || unsafePathTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push({ code: "unsafe_metadata", message: `Unsafe checkpoint decision metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.` });
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
        diagnostics.push({ code: "raw_execution_metadata", message: `Unsupported checkpoint execution field ${sanitizeDisplayText(key)}.` });
      }
      if (isAssistantExecutionHint(key, item)) {
        diagnostics.push({ code: "assistant_authority_blocked", message: "Assistant-origin execution hints cannot produce checkpoint decisions." });
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function isAssistantExecutionHint(key: string, value: unknown): boolean {
  const normalized = key.replace(/[._ -]+/g, "_").toLowerCase();
  if ((normalized.includes("execution") || normalized.includes("authority") || normalized.includes("request")) && value === "assistant") {
    return true;
  }
  if (normalized === "source" && value === "assistant") {
    return true;
  }
  if ((normalized.includes("auto") || normalized.includes("execute")) && value === true) {
    return true;
  }
  return false;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
