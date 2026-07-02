import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { summarizeExplicitContextBundleItem } from "./activeEditorContext";
import type { AgentRunCheckpointDecisionSummary } from "./agentRunCheckpointDecision";
import { evaluateAgentRunState, type AgentRunViewModel } from "./agentRunState";
import type { CodingSessionTraceEntry, CodingSessionTraceFamily, CodingSessionTraceStatus } from "./codingSessionTrace";
import { createProposalHistoryComparisonSummary, type ProposalHistory, type ProposalHistoryComparisonSummary, type ProposalHistoryEntryInput } from "./proposalHistory";
import { redactSecrets, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";
import { countSuggestionStatuses, type TaskMemorySuggestion, type TaskMemorySuggestionStatus, type TaskMemorySuggestionSummary } from "./taskMemorySuggestions";

export type CodingTaskSessionInput = {
  goal?: unknown;
  contextItems?: readonly ExplicitContextBundleItem[];
  memoryItems?: readonly ExplicitContextBundleItem[];
  memorySuggestions?: TaskMemorySuggestionSummary | readonly TaskMemorySuggestion[];
  agentRun?: unknown;
  checkpointDecision?: AgentRunCheckpointDecisionSummary;
  traceEntries?: readonly CodingSessionTraceEntry[];
  proposalHistory?: ProposalHistory | readonly ProposalHistoryEntryInput[];
  diagnostics?: readonly unknown[];
};

export type CodingTaskSessionPolicy = {
  canAutoSend: false;
  canAutoAttachContext: false;
  canAutoApply: false;
  canAutoRunVerification: false;
  canAutoRepair: false;
  canAutoRetry: false;
  canAutoRollback: false;
  canReadHiddenFiles: false;
  canRunHiddenTools: false;
};

export type CodingTaskSessionSnapshot = {
  kind: "coding_task_session";
  authority: "metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  goal: {
    present: boolean;
    label: string;
  };
  context: {
    totalCount: number;
    selectedCount: number;
    activeEditorCount: number;
    snippetCount: number;
    verificationAttachmentCount: number;
    labels: string[];
  };
  memory: {
    count: number;
    labels: string[];
    suggestionCounts: Record<TaskMemorySuggestionStatus, number>;
    suggestionLabels: string[];
  };
  statuses: {
    proposal: string;
    apply: string;
    verification: string;
    agentRunState: string;
    checkpointDecision: string;
    checkpointRecommendedStep: string;
  };
  trace: {
    totalCount: number;
    families: Array<{ family: string; count: number; latestStatus: string }>;
    labels: string[];
  };
  controlledFileRead: {
    present: boolean;
    latestStatus: string;
    labels: string[];
  };
  controlledCommandRun: {
    present: boolean;
    latestStatus: string;
    labels: string[];
  };
  controlledRuntimeSession: {
    present: boolean;
    latestStatus: string;
    labels: string[];
  };
  proposalHistory: ProposalHistoryComparisonSummary;
  nextSafeManualStep: string;
  diagnostics: string[];
  policy: CodingTaskSessionPolicy;
};

const maxLabels = 12;
const maxDiagnostics = 24;
const maxTraceFamilies = 12;
const labelLimit = 160;
const goalLimit = 180;
const stepLimit = 220;
const unsafeKeyPattern = /^(?:prompt|rawPrompt|raw_prompt|file|filePath|absolutePath|path|privatePath|private_path|diff|rawDiff|raw_diff|patch|command|cmd|args|arguments|cwd|env|environment|secret|token|apiKey|api_key|provider|providerPayload|provider_payload|tool|toolCall|tool_call|output|rawOutput|raw_output|stdout|stderr)$/i;
const unsafeTextPattern = /(?:^|\b)(?:raw[_ -]?(?:prompt|file|diff|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|tool[_ -]?call|private[_ -]?path|command|cmd|cwd|env|shell|git|stdout|stderr)(?:\b|$)/i;
const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function createCodingTaskSessionSnapshot(input: CodingTaskSessionInput = {}): CodingTaskSessionSnapshot {
  const diagnostics: string[] = [];
  scanUnsafeValues(input, diagnostics);
  const contextItems = Array.isArray(input.contextItems) ? input.contextItems : [];
  const memoryItems = collectMemoryItems(contextItems, Array.isArray(input.memoryItems) ? input.memoryItems : []);
  const run = evaluateAgentRunState(input.agentRun ?? goalAsAgentRunInput(input.goal));
  const traceEntries = Array.isArray(input.traceEntries) ? input.traceEntries : [];

  for (const item of input.diagnostics ?? []) {
    const diagnostic = safeLabel(item, labelLimit);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  return {
    kind: "coding_task_session",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    goal: summarizeGoal(input.goal, run),
    context: summarizeContext(contextItems),
    memory: summarizeMemory(memoryItems, input.memorySuggestions),
    statuses: summarizeStatuses(run, input.checkpointDecision),
    trace: summarizeTrace(traceEntries),
    controlledFileRead: summarizeControlledFileRead(traceEntries),
    controlledCommandRun: summarizeControlledCommandRun(traceEntries),
    controlledRuntimeSession: summarizeControlledRuntimeSession(traceEntries),
    proposalHistory: createProposalHistoryComparisonSummary(input.proposalHistory),
    nextSafeManualStep: nextSafeManualStep(run),
    diagnostics: uniqueStrings(diagnostics).slice(0, maxDiagnostics),
    policy: conservativePolicy(),
  };
}

export function createTaskAttachTraceLabel(taskLabel: unknown): string {
  return attachTraceLabel("task", taskLabel);
}

export function createSessionAttachTraceLabel(sessionLabel: unknown): string {
  return attachTraceLabel("session", sessionLabel);
}

export function createMemoryAttachTraceLabel(memoryLabel: unknown): string {
  return attachTraceLabel("memory", memoryLabel);
}

export function createTaskMemoryLabel(existingLabel: unknown, goal: unknown): string {
  const existing = safeMemoryDisplayLabel(existingLabel, 80);
  if (existing) {
    return existing;
  }
  const label = safeMemoryDisplayLabel(goalLabel(goal), 80);
  return label || "Task-linked memory attach";
}

export function createSessionMemoryLabel(existingLabel: unknown, chatId: unknown): string {
  const existing = safeMemoryDisplayLabel(existingLabel, 80);
  if (existing) {
    return existing;
  }
  const safeChatId = safeIdSegment(chatId, 60);
  return `Chat ${safeChatId || "current"}`;
}

export function createLinkedMemoryAttachTraceLabel(chatId: unknown, memoryId: unknown): string {
  const safeChatId = safeIdSegment(chatId, 24) || "chat";
  const safeMemoryId = safeIdSegment(memoryId, 24) || "memory";
  return safeLabel(`memory-attach-${safeChatId}-${safeMemoryId}`, 80);
}

function summarizeGoal(goal: unknown, run: AgentRunViewModel): CodingTaskSessionSnapshot["goal"] {
  const label = goalLabel(goal) ?? run.details.goalTitle ?? run.summary;
  const safe = safeLabel(label, goalLimit);
  return {
    present: safe.length > 0 && run.state !== "idle",
    label: safe || "No coding task goal selected.",
  };
}

function summarizeContext(items: readonly ExplicitContextBundleItem[]): CodingTaskSessionSnapshot["context"] {
  const safeItems = items.slice(0, maxLabels);
  return {
    totalCount: items.length,
    selectedCount: items.length,
    activeEditorCount: items.filter((item) => item.kind === "active_editor").length,
    snippetCount: items.filter((item) => item.kind === "workspace_snippet").length,
    verificationAttachmentCount: items.filter((item) => item.kind === "verification_output").length,
    labels: safeItems.map((item) => safeContextLabel(item)).filter(Boolean),
  };
}

function summarizeMemory(items: readonly ExplicitContextBundleItem[], suggestionsInput?: TaskMemorySuggestionSummary | readonly TaskMemorySuggestion[]): CodingTaskSessionSnapshot["memory"] {
  const suggestions = normalizeMemorySuggestions(suggestionsInput);
  return {
    count: items.length,
    labels: items.slice(0, maxLabels).map((item) => item.kind === "project_memory" ? safeLabel(item.title, labelLimit) : safeContextLabel(item)).filter(Boolean),
    suggestionCounts: countSuggestionStatuses(suggestions),
    suggestionLabels: suggestions.slice(0, maxLabels).map((suggestion) => safeLabel(`memory suggestion · ${suggestion.status} · ${suggestion.titleLabel}`, labelLimit)).filter(Boolean),
  };
}

function normalizeMemorySuggestions(value: TaskMemorySuggestionSummary | readonly TaskMemorySuggestion[] | undefined): readonly TaskMemorySuggestion[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isPlainObject(value) && Array.isArray(value.suggestions)) {
    return value.suggestions;
  }
  return [];
}

function summarizeStatuses(run: AgentRunViewModel, decision: AgentRunCheckpointDecisionSummary | undefined): CodingTaskSessionSnapshot["statuses"] {
  return {
    proposal: statusFromDetails(run.details.proposalId, run.details.proposalSummary, run.state === "goal_ready" ? "not_detected" : "detected"),
    apply: statusFromDetails(run.details.applyStatus, run.details.applyRequested === true ? "requested" : undefined, "not_requested"),
    verification: statusFromDetails(run.details.verificationStatus, run.details.verificationProgress, run.details.verificationRequested === true ? "requested" : "not_requested"),
    agentRunState: safeLabel(run.state, labelLimit),
    checkpointDecision: checkpointDecisionStatusLabel(decision),
    checkpointRecommendedStep: checkpointDecisionRecommendedStepLabel(decision),
  };
}

function summarizeTrace(entries: readonly CodingSessionTraceEntry[]): CodingTaskSessionSnapshot["trace"] {
  const familyMap = new Map<CodingSessionTraceFamily, { count: number; latestStatus: CodingSessionTraceStatus }>();
  for (const entry of entries) {
    const current = familyMap.get(entry.family);
    familyMap.set(entry.family, { count: (current?.count ?? 0) + 1, latestStatus: entry.status });
  }
  return {
    totalCount: entries.length,
    families: Array.from(familyMap.entries()).slice(0, maxTraceFamilies).map(([family, value]) => ({ family: safeLabel(family, labelLimit), count: value.count, latestStatus: safeLabel(value.latestStatus, labelLimit) })),
    labels: entries.slice(-maxLabels).map((entry) => safeLabel(`${entry.family} · ${entry.status} · ${entry.title}`, labelLimit)).filter(Boolean),
  };
}

function summarizeControlledFileRead(entries: readonly CodingSessionTraceEntry[]): CodingTaskSessionSnapshot["controlledFileRead"] {
  const readEntries = entries.filter((entry) => entry.family === "controlledAgent.fileReadPlanned" || entry.family === "controlledAgent.fileReadResult" || entry.family === "controlledAgent.fileReadBlocked");
  const latest = readEntries[readEntries.length - 1];
  return {
    present: readEntries.length > 0,
    latestStatus: safeLabel(latest?.status ?? "not_recorded", labelLimit),
    labels: readEntries.slice(-maxLabels).map((entry) => safeLabel(`${entry.family} · ${entry.status} · ${entry.title}`, labelLimit)).filter(Boolean),
  };
}

function summarizeControlledCommandRun(entries: readonly CodingSessionTraceEntry[]): CodingTaskSessionSnapshot["controlledCommandRun"] {
  const commandEntries = entries.filter((entry) => entry.family === "controlledAgent.commandPlanned" || entry.family === "controlledAgent.commandRunning" || entry.family === "controlledAgent.commandResult" || entry.family === "controlledAgent.commandBlocked");
  const latest = commandEntries[commandEntries.length - 1];
  return {
    present: commandEntries.length > 0,
    latestStatus: safeLabel(latest?.status ?? "not_recorded", labelLimit),
    labels: commandEntries.slice(-maxLabels).map((entry) => safeLabel(`${entry.family} · ${entry.status} · ${entry.title}`, labelLimit)).filter(Boolean),
  };
}

function summarizeControlledRuntimeSession(entries: readonly CodingSessionTraceEntry[]): CodingTaskSessionSnapshot["controlledRuntimeSession"] {
  const sessionEntries = entries.filter((entry) => entry.family === "controlledAgent.runtimeSessionReady" || entry.family === "controlledAgent.runtimeSessionStartRequested" || entry.family === "controlledAgent.runtimeSessionStopRequested" || entry.family === "controlledAgent.runtimeSessionBlocked");
  const latest = sessionEntries[sessionEntries.length - 1];
  return {
    present: sessionEntries.length > 0,
    latestStatus: safeLabel(latest?.status ?? "not_recorded", labelLimit),
    labels: sessionEntries.slice(-maxLabels).map((entry) => safeLabel(`${entry.family} · ${entry.status} · ${entry.title}`, labelLimit)).filter(Boolean),
  };
}

function checkpointDecisionStatusLabel(decision: AgentRunCheckpointDecisionSummary | undefined): string {
  if (!decision || decision.status === "unavailable") {
    return "unavailable";
  }
  return safeLabel(decision.status, labelLimit);
}

function checkpointDecisionRecommendedStepLabel(decision: AgentRunCheckpointDecisionSummary | undefined): string {
  if (!decision || decision.status === "unavailable" || decision.recommendedDecision === "none") {
    return "none";
  }
  const recommendedCard = decision.decisionCards.find((card) => card.state === "recommended");
  const label = recommendedCard ? `${decision.recommendedDecision} · ${recommendedCard.label}` : decision.recommendedDecision;
  return safeLabel(label, labelLimit);
}

function nextSafeManualStep(run: AgentRunViewModel): string {
  const mapping: Record<string, string> = {
    none: "Select or describe a local coding task goal before asking for assistance.",
    review_goal: "Review the goal and ask for a manual proposal if it is accurate.",
    review_prerequisites: "Review blocked prerequisites; do not apply or verify until metadata is safe.",
    confirm_apply: "Review the proposal, then explicitly confirm apply only if it is safe.",
    wait_for_apply: "Wait for user-confirmed apply result metadata.",
    confirm_verification: "Review apply metadata, then explicitly confirm verification if desired.",
    review_verification: "Review verification metadata and decide the next manual step.",
    review_rollback: "Review rollback availability and choose manually; no rollback is automatic.",
    stop: "Stop and review the completed metadata before starting another manual step.",
  };
  return safeLabel(mapping[run.nextUserAction] ?? mapping.none, stepLimit);
}

function conservativePolicy(): CodingTaskSessionPolicy {
  return {
    canAutoSend: false,
    canAutoAttachContext: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canAutoRepair: false,
    canAutoRetry: false,
    canAutoRollback: false,
    canReadHiddenFiles: false,
    canRunHiddenTools: false,
  };
}

function safeContextLabel(item: ExplicitContextBundleItem): string {
  const summary = summarizeExplicitContextBundleItem(item);
  return safeLabel(summary.line, labelLimit);
}

function collectMemoryItems(contextItems: readonly ExplicitContextBundleItem[], memoryItems: readonly ExplicitContextBundleItem[]): ExplicitContextBundleItem[] {
  const combined = [...contextItems.filter((item) => item.kind === "project_memory"), ...memoryItems.filter((item) => item.kind === "project_memory")];
  const seen = new Set<string>();
  return combined.filter((item) => {
    const key = item.key;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function statusFromDetails(primary: unknown, secondary: unknown, fallback: string): string {
  const value = typeof primary === "string" && primary.trim() ? primary : typeof secondary === "string" && secondary.trim() ? secondary : fallback;
  return safeLabel(value, labelLimit);
}

function goalAsAgentRunInput(goal: unknown): unknown {
  const label = goalLabel(goal);
  return label ? { goal: { title: label } } : undefined;
}

function goalLabel(goal: unknown): string | undefined {
  if (typeof goal === "string") {
    return goal;
  }
  if (isPlainObject(goal)) {
    const title = goal.title;
    const summary = goal.summary;
    if (typeof title === "string" && title.trim()) {
      return title;
    }
    if (typeof summary === "string" && summary.trim()) {
      return summary;
    }
  }
  return undefined;
}

function attachTraceLabel(prefix: string, value: unknown): string {
  const label = safeLabel(value, 96) || "unlabeled";
  return safeLabel(`${prefix}:${label}`, 120);
}

function safeMemoryDisplayLabel(value: unknown, limit: number): string {
  const label = safeLabel(value, limit);
  if (!label || label.includes("[redacted]")) {
    return "";
  }
  return label;
}

function safeIdSegment(value: unknown, limit: number): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return "";
  }
  const sanitized = sanitizeDisplayText(String(value)).trim();
  if (!sanitized || sanitized.includes("[redacted]") || sanitized.includes("..") || /[\\/]/.test(sanitized) || isUnsafeString(sanitized)) {
    return "";
  }
  const compact = sanitized.replace(/[^A-Za-z0-9_.-]/g, "");
  return compact.slice(0, limit);
}

function safeLabel(value: unknown, limit: number): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return "";
  }
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(String(value))).replace(/[\r\n]+/g, " ").trim();
  const redacted = redactUnsafeText(sanitized);
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

function redactUnsafeText(value: string): string {
  if (!value) {
    return value;
  }
  const secretRedacted = redactSecrets(value);
  if (privatePathPattern.test(secretRedacted) || stackTracePattern.test(secretRedacted)) {
    return "[redacted]";
  }
  return secretRedacted;
}

function scanUnsafeValues(value: unknown, diagnostics: string[], keyPath = "input", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8 || diagnostics.length >= maxDiagnostics * 2) {
    return;
  }
  if (typeof value === "string") {
    if (isUnsafeString(value)) {
      diagnostics.push(`Unsafe metadata omitted near ${safeLabel(keyPath, 80)}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeValues(item, diagnostics, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      const nextPath = `${keyPath}.${safeLabel(key, 80) || "field"}`;
      if (unsafeKeyPattern.test(key)) {
        diagnostics.push(`Unsafe execution field omitted near ${safeLabel(nextPath, 80)}.`);
      }
      scanUnsafeValues(item, diagnostics, nextPath, depth + 1, seen);
    }
  }
}

function isUnsafeString(value: string): boolean {
  return redactSecrets(value) !== value || unsafeTextPattern.test(value) || privatePathPattern.test(value) || stackTracePattern.test(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => safeLabel(value, labelLimit)).filter(Boolean)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
