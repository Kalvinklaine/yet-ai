import { createAgentRunReport } from "./agentRunReport";
import type { CodingSessionTraceEntry } from "./codingSessionTrace";
import { createCodingTaskSessionSnapshot, type CodingTaskSessionInput } from "./codingTaskSession";
import { createProposalHistoryComparisonSummary, type ProposalHistory, type ProposalHistoryEntryInput } from "./proposalHistory";
import { redactSecrets, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";
import { countSuggestionStatuses, type TaskMemorySuggestion, type TaskMemorySuggestionSummary } from "./taskMemorySuggestions";

export type MultiStepTaskTimelineFamily =
  | "task.goal"
  | "context.attachment"
  | "memory.attachment"
  | "plan.preview"
  | "proposal.review"
  | "apply.request"
  | "apply.result"
  | "verification.request"
  | "verification.progress"
  | "verification.result"
  | "followup.draft"
  | "final.result";

export type MultiStepTaskTimelineStatus = "info" | "pending" | "in_progress" | "succeeded" | "rejected" | "failed" | "blocked" | "skipped";

export type MultiStepTaskTimelineItem = {
  id: string;
  family: MultiStepTaskTimelineFamily;
  title: string;
  status: MultiStepTaskTimelineStatus;
  summary: string;
  timestamp?: string;
  requestId?: string;
  labels?: string[];
};

export type MultiStepTaskTimelinePolicy = {
  authority: "metadata_only";
  displayOnly: true;
  canAutoSend: false;
  canAutoApply: false;
  canAutoRunVerification: false;
  canAutoRepair: false;
  canReadFiles: false;
  canWriteFiles: false;
  canCallProvider: false;
};

export type MultiStepTaskTimelineInput = CodingTaskSessionInput & {
  planPreview?: unknown;
  followupDraft?: unknown;
  maxItems?: unknown;
};

export type MultiStepTaskTimeline = {
  kind: "multi_step_task_timeline";
  authority: "metadata_only";
  displayOnly: true;
  items: MultiStepTaskTimelineItem[];
  diagnostics: string[];
  policy: MultiStepTaskTimelinePolicy;
};

const defaultMaxItems = 24;
const hardMaxItems = 40;
const maxDiagnostics = 16;
const maxLabels = 8;
const maxLabelLength = 140;
const maxTitleLength = 96;
const maxSummaryLength = 220;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const unsafeKeyPattern = /^(?:prompt|rawPrompt|raw_prompt|file|filePath|absolutePath|path|privatePath|private_path|diff|rawDiff|raw_diff|patch|body|fileBody|file_body|fileContent|file_content|command|cmd|args|arguments|cwd|env|environment|shell|git|provider|providerPayload|provider_payload|providerResponse|provider_response|tool|toolCall|tool_call|output|rawOutput|raw_output|stdout|stderr|browserStorage|browser_storage|bridgeDump|bridge_dump|stackTrace|stack_trace)$/i;
const unsafeTextPattern = /(?:^|\b)(?:raw[_ -]?(?:prompt|file|diff|patch|command|output|response|body)|file[_ -]?(?:body|content|contents)|provider[_ -]?(?:payload|response|tool)|browser[_ -]?storage|bridge[_ -]?dump|tool[_ -]?call|private[_ -]?path|chain[_ -]?of[_ -]?thought|command|cmd|cwd|env|shell|git|stdout|stderr|apply[_ -]?patch|auto[_ -]?(?:send|apply|run|verify|repair|rollback))(?:\b|$)/i;
const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function createMultiStepTaskTimeline(input: MultiStepTaskTimelineInput = {}): MultiStepTaskTimeline {
  const diagnostics: string[] = [];
  scanUnsafeValues(input, diagnostics);
  const snapshot = createCodingTaskSessionSnapshot(input);
  const traceEntries = Array.isArray(input.traceEntries) ? input.traceEntries : [];
  const agentRun = isPlainObject(input.agentRun) ? input.agentRun : undefined;
  const items = compactItems([
    createGoalItem(input.goal, snapshot.goal.present, snapshot.goal.label, traceEntries),
    createContextItem(snapshot.context, traceEntries),
    createMemoryItem(snapshot.memory, input.memorySuggestions, traceEntries),
    createPlanPreviewItem(input.planPreview, input.proposalHistory, snapshot.proposalHistory, traceEntries, diagnostics),
    createProposalItem(snapshot.proposalHistory, snapshot.statuses.proposal, traceEntries),
    createApplyRequestItem(agentRun, traceEntries),
    createApplyResultItem(agentRun, snapshot.statuses.apply, traceEntries),
    createVerificationRequestItem(agentRun, traceEntries),
    createVerificationProgressItem(agentRun, traceEntries),
    createVerificationResultItem(agentRun, snapshot.statuses.verification, traceEntries),
    createFollowupDraftItem(input.followupDraft, traceEntries),
    createFinalResultItem(input.agentRun, snapshot.statuses.agentRunState, traceEntries),
  ]);
  return {
    kind: "multi_step_task_timeline",
    authority: "metadata_only",
    displayOnly: true,
    items: items.slice(0, normalizeMaxItems(input.maxItems)),
    diagnostics: uniqueStrings([...diagnostics, ...snapshot.diagnostics]).slice(0, maxDiagnostics),
    policy: conservativePolicy(),
  };
}

function createGoalItem(goal: unknown, present: boolean, label: string, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem {
  const trace = latestTrace(traceEntries, ["agentRun.goalReady"]);
  return item("task-goal", "task.goal", present ? "Task goal ready" : "Task goal not selected", present ? "succeeded" : "pending", present ? label : "Select or describe a local coding task goal before starting the manual flow.", trace, present ? [label] : []);
}

function createContextItem(context: ReturnType<typeof createCodingTaskSessionSnapshot>["context"], traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem {
  const trace = latestTrace(traceEntries, ["context.snapshot", "context.activeExcerpt", "context.snippets", "context.verificationAttachment"]);
  const count = context.selectedCount;
  const status: MultiStepTaskTimelineStatus = count > 0 ? "succeeded" : "skipped";
  const summary = count > 0 ? `${count} explicit context item${count === 1 ? "" : "s"} attached for user-reviewed Send.` : "No explicit context is attached; hidden reads remain unavailable.";
  return item("context-attachment", "context.attachment", count > 0 ? "Explicit context attached" : "Explicit context omitted", status, summary, trace, context.labels);
}

function createMemoryItem(memory: ReturnType<typeof createCodingTaskSessionSnapshot>["memory"], suggestionsInput: MultiStepTaskTimelineInput["memorySuggestions"], traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem {
  const trace = latestTrace(traceEntries, ["context.memory"]);
  const suggestions = normalizeMemorySuggestions(suggestionsInput);
  const counts = countSuggestionStatuses(suggestions);
  const labels = [...memory.labels, ...memory.suggestionLabels].slice(0, maxLabels);
  if (memory.count > 0) {
    return item("memory-attached", "memory.attachment", "Task memory attached", "succeeded", `${memory.count} memory item${memory.count === 1 ? "" : "s"} attached by explicit user action.`, trace, labels);
  }
  if (counts.suggested > 0) {
    return item("memory-suggested", "memory.attachment", "Task memory suggested", "pending", `${counts.suggested} safe memory suggestion${counts.suggested === 1 ? "" : "s"} await explicit attach.`, trace, labels);
  }
  return item("memory-skipped", "memory.attachment", "Task memory skipped", "skipped", "No task memory is attached; suggestions are display-only metadata.", trace, labels);
}

function createPlanPreviewItem(planPreview: unknown, proposalHistory: ProposalHistory | readonly ProposalHistoryEntryInput[] | undefined, proposalSummary: ReturnType<typeof createProposalHistoryComparisonSummary>, traceEntries: readonly CodingSessionTraceEntry[], diagnostics: string[]): MultiStepTaskTimelineItem | undefined {
  const trace = latestTrace(traceEntries, ["agentRun.proposalDetected"]);
  const labels = safeLabels(labelsFromUnknown(planPreview));
  const title = safeField(planPreview, "title") || (proposalSummary.planPreviewCount > 0 ? "Multi-step plan preview detected" : "");
  const summary = safeField(planPreview, "summary") || (proposalSummary.planPreviewCount > 0 ? `${proposalSummary.planPreviewCount} inert plan preview item${proposalSummary.planPreviewCount === 1 ? "" : "s"} recorded in proposal history.` : "");
  if (!title && !summary && !hasPlanPreviewHistory(proposalHistory)) {
    return undefined;
  }
  if (planPreview !== undefined && labels.length === 0 && !title && !summary) {
    diagnostics.push("Unsafe plan preview metadata was omitted.");
  }
  return item("plan-preview", "plan.preview", title || "Multi-step plan preview", "info", summary || "Plan preview metadata is available for manual review only.", trace, labels);
}

function createProposalItem(proposalHistory: ReturnType<typeof createProposalHistoryComparisonSummary>, proposalStatus: string, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem {
  const trace = latestTrace(traceEntries, ["agentRun.proposalDetected", "edit.detected", "edit.rejected"]);
  if (proposalHistory.rejectedCount > 0 && proposalHistory.appliedCount === 0) {
    return item("proposal-rejected", "proposal.review", "Proposal rejected", "rejected", "One or more proposals were rejected for manual review; no apply authority was created.", trace, proposalHistory.comparisonLabels);
  }
  if (proposalHistory.visibleCount > 0 || proposalStatus !== "not_detected") {
    return item("proposal-detected", "proposal.review", "Proposal detected", "succeeded", proposalHistory.latestSummary !== "none" ? proposalHistory.latestSummary : "Safe proposal metadata is ready for manual review.", trace, proposalHistory.comparisonLabels);
  }
  return item("proposal-pending", "proposal.review", "Proposal not detected", "pending", "No safe-edit proposal metadata has been detected yet.", trace, []);
}

function createApplyRequestItem(agentRun: Record<string, unknown> | undefined, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem | undefined {
  const request = isPlainObject(agentRun?.applyRequest) ? agentRun.applyRequest : undefined;
  const trace = latestTrace(traceEntries, ["agentRun.applyRequested", "edit.applyRequested"]);
  if (request?.requested !== true && !trace) {
    return undefined;
  }
  return item("apply-request", "apply.request", "Apply requested", request?.requested === true ? "in_progress" : "pending", request?.requested === true ? "Apply was requested by explicit user action." : "Apply request metadata is pending user confirmation.", trace, [], safeRequestId(request?.requestId));
}

function createApplyResultItem(agentRun: Record<string, unknown> | undefined, applyStatus: string, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem | undefined {
  const result = isPlainObject(agentRun?.applyResult) ? agentRun.applyResult : undefined;
  const trace = latestTrace(traceEntries, ["agentRun.applyResult", "edit.applyResult"]);
  if (!result && applyStatus === "not_requested" && !trace) {
    return undefined;
  }
  const status = result?.status === "failed" || applyStatus === "failed" ? "failed" : result?.status === "applied" || applyStatus === "applied" ? "succeeded" : "pending";
  return item("apply-result", "apply.result", status === "failed" ? "Apply failed" : status === "succeeded" ? "Apply completed" : "Apply result pending", status, safeValue(result?.summary) || (status === "pending" ? "Apply result metadata has not been recorded." : "Apply result metadata was recorded."), trace);
}

function createVerificationRequestItem(agentRun: Record<string, unknown> | undefined, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem | undefined {
  const request = isPlainObject(agentRun?.verificationRequest) ? agentRun.verificationRequest : undefined;
  const trace = latestTrace(traceEntries, ["agentRun.verificationRequested", "verification.runRequested"]);
  if (request?.requested !== true && !trace) {
    return undefined;
  }
  return item("verification-request", "verification.request", "Verification requested", request?.requested === true ? "in_progress" : "pending", request?.requested === true ? "Verification was requested by explicit user action." : "Verification request metadata is pending user confirmation.", trace, [], safeRequestId(request?.requestId));
}

function createVerificationProgressItem(agentRun: Record<string, unknown> | undefined, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem | undefined {
  const progress = isPlainObject(agentRun?.verificationProgress) ? agentRun.verificationProgress : undefined;
  const trace = latestTrace(traceEntries, ["agentRun.verificationProgress", "verification.progress"]);
  if (!progress && !trace) {
    return undefined;
  }
  return item("verification-progress", "verification.progress", "Verification in progress", "in_progress", safeValue(progress?.status) || "Verification progress metadata was recorded.", trace);
}

function createVerificationResultItem(agentRun: Record<string, unknown> | undefined, verificationStatus: string, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem | undefined {
  const result = isPlainObject(agentRun?.verificationResult) ? agentRun.verificationResult : undefined;
  const trace = latestTrace(traceEntries, ["agentRun.verificationResult", "verification.result"]);
  if (!result && verificationStatus === "not_requested" && !trace) {
    return undefined;
  }
  const status = result?.status === "failed" || verificationStatus === "failed" ? "failed" : result?.status === "succeeded" || verificationStatus === "succeeded" ? "succeeded" : "pending";
  const labels = [typeof result?.exitCode === "number" ? `exit ${result.exitCode}` : "", typeof result?.durationMs === "number" ? `${result.durationMs}ms` : ""].filter(Boolean);
  return item("verification-result", "verification.result", status === "failed" ? "Verification failed" : status === "succeeded" ? "Verification completed" : "Verification result pending", status, safeValue(result?.summary) || (status === "pending" ? "Verification result metadata has not been recorded." : "Verification result metadata was recorded."), trace, labels);
}

function createFollowupDraftItem(followupDraft: unknown, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem | undefined {
  const trace = latestTrace(traceEntries, ["verification.followupPromptDrafted"]);
  const intent = safeField(followupDraft, "intent");
  const summary = safeField(followupDraft, "summary") || safeField(followupDraft, "title");
  const labels = safeLabels(labelsFromUnknown(followupDraft));
  if (!followupDraft && !trace) {
    return undefined;
  }
  return item("followup-draft", "followup.draft", intent === "fix" ? "Fix draft prepared" : "Follow-up draft prepared", "pending", summary || "A follow-up draft is available for user review only; Send remains manual.", trace, labels);
}

function createFinalResultItem(agentRun: unknown, agentRunState: string, traceEntries: readonly CodingSessionTraceEntry[]): MultiStepTaskTimelineItem | undefined {
  const trace = latestTrace(traceEntries, ["agentRun.completed", "agentRun.blocked", "agentRun.rollbackAvailable"]);
  const terminal = ["completed", "verified", "verification_failed", "blocked", "rollback_available"].includes(agentRunState);
  if (!terminal && !trace) {
    return undefined;
  }
  const metadata = isPlainObject(agentRun) ? agentRun : undefined;
  const verificationResult = isPlainObject(metadata?.verificationResult) ? metadata.verificationResult : undefined;
  const applyResult = isPlainObject(metadata?.applyResult) ? metadata.applyResult : undefined;
  if (verificationResult?.status === "succeeded") {
    return item("final-result", "final.result", "Agent Run completed after user-confirmed verification", "succeeded", "Manual apply and verification metadata are complete; no autonomous follow-up was started.", trace, ["apply_result_recorded", "verification_result_recorded"]);
  }
  if (verificationResult?.status === "failed") {
    return item("final-result", "final.result", "Agent Run verification failed after user confirmation", "failed", "Verification failed after an explicit user request; no automatic repair was started.", trace, ["verification_result_recorded"]);
  }
  if (applyResult?.status === "failed") {
    return item("final-result", "final.result", "Agent Run apply failed after user confirmation", "failed", "Apply failed after an explicit user request; no automatic repair or retry was started.", trace, ["apply_result_recorded"]);
  }
  const report = createAgentRunReport(agentRun);
  const status: MultiStepTaskTimelineStatus = report.status === "succeeded" ? "succeeded" : report.status === "failed" ? "failed" : report.status === "blocked" ? "blocked" : "pending";
  return item("final-result", "final.result", report.title, status, report.summary, trace, report.userConfirmedSteps);
}

function item(id: string, family: MultiStepTaskTimelineFamily, title: string, status: MultiStepTaskTimelineStatus, summary: string, trace?: CodingSessionTraceEntry, labels: readonly string[] = [], requestId?: string): MultiStepTaskTimelineItem {
  const next: MultiStepTaskTimelineItem = {
    id,
    family,
    title: safeValue(title, maxTitleLength) || "Timeline item",
    status,
    summary: safeValue(summary, maxSummaryLength) || "Metadata is unavailable.",
  };
  const timestamp = safeTimestamp(trace?.timestamp);
  if (timestamp) {
    next.timestamp = timestamp;
  }
  const safeTraceRequestId = requestId ?? safeRequestId(trace?.requestId);
  if (safeTraceRequestId) {
    next.requestId = safeTraceRequestId;
  }
  const safeItemLabels = safeLabels(labels);
  if (safeItemLabels.length > 0) {
    next.labels = safeItemLabels;
  }
  return next;
}

function compactItems(values: Array<MultiStepTaskTimelineItem | undefined>): MultiStepTaskTimelineItem[] {
  return values.filter((value): value is MultiStepTaskTimelineItem => Boolean(value));
}

function latestTrace(entries: readonly CodingSessionTraceEntry[], families: readonly string[]): CodingSessionTraceEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && families.includes(entry.family)) {
      return entry;
    }
  }
  return undefined;
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

function hasPlanPreviewHistory(value: ProposalHistory | readonly ProposalHistoryEntryInput[] | undefined): boolean {
  if (!value) {
    return false;
  }
  const summary = createProposalHistoryComparisonSummary(value);
  return summary.planPreviewCount > 0;
}

function labelsFromUnknown(value: unknown): string[] {
  if (!isPlainObject(value)) {
    return [];
  }
  const labels: string[] = [];
  for (const key of ["labels", "riskLabels", "steps", "expectedTouchedFiles"]) {
    const item = value[key];
    if (Array.isArray(item)) {
      labels.push(...item.flatMap((entry) => isPlainObject(entry) ? [entry.title, entry.summary, entry.label] : [entry]).filter((entry): entry is string => typeof entry === "string"));
    }
  }
  return labels;
}

function safeField(value: unknown, field: string): string | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  return safeValue(value[field]);
}

function safeLabels(values: readonly unknown[]): string[] {
  return uniqueStrings(values.map((value) => safeValue(value, maxLabelLength)).filter((value): value is string => Boolean(value))).slice(0, maxLabels);
}

function safeValue(value: unknown, limit = maxSummaryLength): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return undefined;
  }
  const raw = String(value);
  if (isUnsafeString(raw)) {
    return "[redacted]";
  }
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(raw)).replace(/[\r\n]+/g, " ").trim();
  const redacted = redactUnsafeText(sanitized);
  if (!redacted) {
    return undefined;
  }
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

function redactUnsafeText(value: string): string {
  const secretRedacted = redactSecrets(value);
  if (privatePathPattern.test(secretRedacted) || stackTracePattern.test(secretRedacted) || unsafeTextPattern.test(secretRedacted)) {
    return "[redacted]";
  }
  return secretRedacted;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(text) && !isUnsafeString(text) && !/(?:authorization|bearer|api[_-]?key|token|secret|access[_-]?token)/i.test(text) ? text : undefined;
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function scanUnsafeValues(value: unknown, diagnostics: string[], keyPath = "input", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8 || diagnostics.length >= maxDiagnostics * 2) {
    return;
  }
  if (typeof value === "string") {
    if (isUnsafeString(value)) {
      diagnostics.push(`Unsafe timeline metadata omitted near ${safeValue(keyPath, 80) || "input"}.`);
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
      const safeKey = safeValue(key, 80) || "field";
      if (unsafeKeyPattern.test(key)) {
        diagnostics.push(`Unsafe timeline field omitted near ${safeValue(`${keyPath}.${safeKey}`, 80) || "input"}.`);
      }
      scanUnsafeValues(item, diagnostics, `${keyPath}.${safeKey}`, depth + 1, seen);
    }
  }
}

function isUnsafeString(value: string): boolean {
  return redactSecrets(value) !== value || unsafeTextPattern.test(value) || privatePathPattern.test(value) || stackTracePattern.test(value);
}

function normalizeMaxItems(value: unknown): number {
  if (!Number.isInteger(value)) {
    return defaultMaxItems;
  }
  return Math.max(0, Math.min(value as number, hardMaxItems));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function conservativePolicy(): MultiStepTaskTimelinePolicy {
  return {
    authority: "metadata_only",
    displayOnly: true,
    canAutoSend: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canAutoRepair: false,
    canReadFiles: false,
    canWriteFiles: false,
    canCallProvider: false,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
