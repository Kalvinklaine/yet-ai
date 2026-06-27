import type { AgentRunVerificationResultMetadata } from "./agentRunState";
import type { CodingTaskSessionSnapshot } from "./codingTaskSession";
import type { ProposalHistory, ProposalHistoryComparisonSummary, ProposalHistoryEntry } from "./proposalHistory";
import type { VerificationFollowupPromptDraftMetadata } from "./verificationFollowupPrompt";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type GuidedFixLoopStatus = "idle" | "no_fix_needed" | "fix_draft_available" | "fix_drafted" | "awaiting_manual_send" | "new_proposal_detected" | "blocked";

export type GuidedFixLoopDraftState = {
  present?: boolean;
  awaitingManualSend?: boolean;
  metadata?: VerificationFollowupPromptDraftMetadata;
  label?: unknown;
};

export type GuidedFixLoopInput = {
  verificationResult?: AgentRunVerificationResultMetadata;
  priorProposal?: {
    id?: unknown;
    summary?: unknown;
    source?: unknown;
  };
  proposalHistory?: ProposalHistory | ProposalHistoryComparisonSummary | readonly ProposalHistoryEntry[];
  sessionSnapshot?: CodingTaskSessionSnapshot;
  draft?: GuidedFixLoopDraftState;
  lineage?: {
    verificationRequestId?: unknown;
    priorProposalId?: unknown;
    followupDraftId?: unknown;
  };
};

export type GuidedFixLoopPolicy = {
  displayOnly: true;
};

export type GuidedFixLoopResult = {
  kind: "guided_fix_loop";
  authority: "metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  status: GuidedFixLoopStatus;
  reason: string;
  cta: string;
  labels: string[];
  diagnostics: string[];
  policy: GuidedFixLoopPolicy;
};

const maxLabels = 8;
const maxDiagnostics = 8;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|patch|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|prompt|rawOutput|raw_output|output|stdout|stderr|stackTrace|stack_trace|callstack|privatePath|private_path|providerPayload|provider_payload|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoRepair|auto_repair|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const unsafeTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool|call)|stack[_ -]?trace|callstack|shell|\bcommand\s*[:=]|\bcmd\s*[:=]|\bargs\s*[:=]|\bcwd\s*[:=]|\benv\s*[:=]|\bgit\b|\bnpm\s+(?:run|test|install)|\bcargo\s+(?:check|test|run)|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:send|apply|run|verify|fix|repair|rollback)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function deriveGuidedFixLoopStatus(input: GuidedFixLoopInput = {}): GuidedFixLoopResult {
  const diagnostics: string[] = [];
  scanUnsafeMetadata(input, diagnostics);
  if (diagnostics.length > 0) {
    return result("blocked", "Guided fix metadata is blocked because unsafe fields were omitted.", "Review sanitized metadata before drafting a fix.", [], diagnostics);
  }

  const verification = sanitizeVerification(input.verificationResult, diagnostics);
  const priorProposal = sanitizeProposal(input.priorProposal, diagnostics);
  const history = summarizeHistory(input.proposalHistory, input.sessionSnapshot, diagnostics);
  const draft = sanitizeDraft(input.draft, diagnostics);
  const lineage = sanitizeLineage(input.lineage, diagnostics);

  if (diagnostics.length > 0) {
    return result("blocked", "Guided fix metadata is incomplete or inconsistent.", "Review Agent Run metadata before drafting a fix.", labels(priorProposal, history, draft), diagnostics);
  }
  if (!verification) {
    return result("idle", "No terminal verification metadata is available.", "Run verification manually when ready.", labels(priorProposal, history, draft), []);
  }
  if (verification.status === "succeeded") {
    return result("no_fix_needed", "Verification succeeded; no guided fix is needed.", "Review the completed verification metadata.", labels(priorProposal, history, draft, "verification succeeded"), []);
  }
  if (!priorProposal && !history.hasSafeProposal) {
    return result("blocked", "Failed verification has no prior safe proposal metadata.", "Review the failed run and request a manual proposal before drafting a fix.", labels(priorProposal, history, draft), ["Missing prior safe proposal metadata."]);
  }

    const correlatedProposal = findCorrelatedProposal(history, priorProposal, lineage, draft);
  if (correlatedProposal) {
    return result("new_proposal_detected", "A later correlated proposal is available after the failed verification.", "Review the new proposal manually before applying anything.", labels(priorProposal, { ...history, latestProposalId: correlatedProposal.id, latestStatus: correlatedProposal.status, latestSummary: correlatedProposal.summary, latestSource: correlatedProposal.source }, draft, "new proposal detected"), []);
  }
  if (draft.present && draft.awaitingManualSend) {
    return result("awaiting_manual_send", "A fix draft is waiting in the composer for manual review.", "Edit the draft if needed, then click Send manually only if you choose.", labels(priorProposal, history, draft), []);
  }
  if (draft.present) {
    return result("fix_drafted", "A fix draft already exists as display-only metadata.", "Review the draft manually; nothing is sent automatically.", labels(priorProposal, history, draft), []);
  }

  return result("fix_draft_available", "Failed verification can be turned into a manual fix draft.", "Draft a fix prompt for manual review only.", labels(priorProposal, history, draft, "draft available"), []);
}

function sanitizeVerification(value: AgentRunVerificationResultMetadata | undefined, diagnostics: string[]): { status: "succeeded" | "failed"; exitCode?: number } | undefined {
  if (!value) {
    return undefined;
  }
  if (value.status !== "succeeded" && value.status !== "failed") {
    diagnostics.push("Verification metadata is not terminal.");
    return undefined;
  }
  return {
    status: value.status,
    exitCode: typeof value.exitCode === "number" && Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255 ? value.exitCode : undefined,
  };
}

function sanitizeProposal(value: GuidedFixLoopInput["priorProposal"], diagnostics: string[]): { id?: string; summary?: string; source?: string } | undefined {
  if (!value) {
    return undefined;
  }
  const id = safeId(value.id, diagnostics, "prior proposal id");
  const summary = safeLabel(value.summary, 160, diagnostics, "prior proposal summary");
  const source = safeLabel(value.source, 80, diagnostics, "prior proposal source");
  return id || summary || source ? stripUndefined({ id, summary, source }) : undefined;
}

type SafeHistoryEntry = {
  id?: string;
  kind: string;
  status: string;
  summary?: string;
  source?: string;
  lineage?: {
    priorProposalId?: string;
    verificationRequestId?: string;
    followupDraftId?: string;
    intent?: "fix" | "followup";
  };
};

type HistorySummary = {
  hasSafeProposal: boolean;
  latestProposalId?: string;
  latestStatus?: string;
  latestSummary?: string;
  latestSource?: string;
  entries: SafeHistoryEntry[];
};

function summarizeHistory(history: GuidedFixLoopInput["proposalHistory"], session: CodingTaskSessionSnapshot | undefined, diagnostics: string[]): HistorySummary {
  if (Array.isArray(history)) {
    const safeEntries = history.map((entry) => sanitizeHistoryEntry(entry, diagnostics)).filter((entry): entry is SafeHistoryEntry => Boolean(entry));
    const proposalEntries = safeEntries.filter((entry) => entry.kind === "original" || entry.kind === "follow_up");
    const displayProposalEntries = proposalEntries.filter((entry) => entry.kind !== "follow_up" || entry.lineage?.intent === "fix");
    const latestDisplayProposal = displayProposalEntries[displayProposalEntries.length - 1] ?? proposalEntries[proposalEntries.length - 1];
    const latest = safeEntries[safeEntries.length - 1];
    const latestDisplayEntry = latest?.kind === "follow_up" && latest.lineage?.intent !== "fix" ? latestDisplayProposal : latest;
    return stripUndefined({
      hasSafeProposal: proposalEntries.length > 0,
      latestProposalId: latestDisplayProposal?.id,
      latestStatus: latestDisplayEntry?.status,
      latestSummary: latestDisplayEntry?.summary,
      latestSource: latestDisplayEntry?.source,
      entries: safeEntries,
    });
  }
  if (history && "entries" in history && Array.isArray(history.entries)) {
    return summarizeHistory(history.entries, session, diagnostics);
  }
  if (history && "kind" in history && history.kind === "proposal_history_comparison") {
    const latestStatus = safeLabel(history.latestStatus, 80, diagnostics, "history latest status");
    const latestSummary = safeLabel(history.latestSummary, 160, diagnostics, "history latest summary");
    const latestSource = safeLabel(history.latestSource, 80, diagnostics, "history latest source");
    return stripUndefined({ hasSafeProposal: history.visibleCount > 0, latestStatus, latestSummary, latestSource, entries: [] });
  }
  if (session?.proposalHistory) {
    return summarizeHistory(session.proposalHistory, undefined, diagnostics);
  }
  return { hasSafeProposal: false, entries: [] };
}

function sanitizeHistoryEntry(entry: ProposalHistoryEntry, diagnostics: string[]): SafeHistoryEntry | undefined {
  if (!entry || typeof entry !== "object") {
    diagnostics.push("Proposal history metadata is malformed.");
    return undefined;
  }
  const id = safeId(entry.id, diagnostics, "proposal history id");
  const kind = safeLabel(entry.kind, 80, diagnostics, "proposal history kind");
  const status = safeLabel(entry.status, 80, diagnostics, "proposal history status");
  const summary = safeLabel(entry.summary, 160, diagnostics, "proposal history summary");
  const source = safeLabel(entry.source, 80, diagnostics, "proposal history source");
  const lineage = sanitizeHistoryLineage(entry.lineage, diagnostics);
  if (!kind || !status) {
    diagnostics.push("Proposal history metadata is missing safe labels.");
    return undefined;
  }
  return stripUndefined({ id, kind, status, summary, source, lineage });
}

function sanitizeHistoryLineage(value: ProposalHistoryEntry["lineage"], diagnostics: string[]): SafeHistoryEntry["lineage"] | undefined {
  if (!value) {
    return undefined;
  }
  const priorProposalId = safeId(value.priorProposalId, diagnostics, "proposal history lineage prior proposal id");
  const verificationRequestId = safeId(value.verificationRequestId, diagnostics, "proposal history lineage verification request id");
  const followupDraftId = safeId(value.followupDraftId, diagnostics, "proposal history lineage follow-up draft id");
  const intent = value.intent === "fix" || value.intent === "followup" ? value.intent : undefined;
  if (value.intent !== undefined && !intent) {
    diagnostics.push("Unsafe proposal history lineage intent metadata was omitted.");
  }
  const lineage = stripUndefined({ priorProposalId, verificationRequestId, followupDraftId, intent });
  return Object.keys(lineage).length > 0 ? lineage : undefined;
}

function sanitizeDraft(value: GuidedFixLoopDraftState | undefined, diagnostics: string[]): { present: boolean; awaitingManualSend: boolean; label?: string; followupDraftId?: string; verificationRequestId?: string; priorProposalId?: string } {
  if (!value) {
    return { present: false, awaitingManualSend: false };
  }
  const metadata = value.metadata;
  let followupDraftId: string | undefined;
  let verificationRequestId: string | undefined;
  let priorProposalId: string | undefined;
  if (metadata) {
    if (metadata.kind !== "agent_run.followup_prompt_draft" || metadata.authority !== "metadata_only" || metadata.cloudRequired !== false || metadata.executionAllowed !== false || metadata.draftOnly !== true) {
      diagnostics.push("Fix draft metadata is not display-only.");
    }
    if (metadata.mode !== "fix") {
      diagnostics.push("Fix draft metadata is not a fix draft.");
    }
    followupDraftId = safeId(metadata.draftId, diagnostics, "fix draft id");
    verificationRequestId = safeId(metadata.verification.requestId, diagnostics, "fix draft verification request id");
    priorProposalId = safeId(metadata.priorProposal?.id, diagnostics, "fix draft prior proposal id");
  }
  const label = safeLabel(value.label, 120, diagnostics, "draft label");
  return stripUndefined({ present: value.present === true || Boolean(metadata), awaitingManualSend: value.awaitingManualSend === true, label, followupDraftId, verificationRequestId, priorProposalId });
}

function sanitizeLineage(value: GuidedFixLoopInput["lineage"], diagnostics: string[]): { verificationRequestId?: string; priorProposalId?: string; followupDraftId?: string } {
  if (!value) {
    return {};
  }
  return stripUndefined({
    verificationRequestId: safeId(value.verificationRequestId, diagnostics, "verification request id"),
    priorProposalId: safeId(value.priorProposalId, diagnostics, "lineage prior proposal id"),
    followupDraftId: safeId(value.followupDraftId, diagnostics, "lineage follow-up draft id"),
  });
}

function findCorrelatedProposal(history: HistorySummary, priorProposal: { id?: string } | undefined, lineage: { verificationRequestId?: string; priorProposalId?: string; followupDraftId?: string }, draft: { followupDraftId?: string; verificationRequestId?: string; priorProposalId?: string }): SafeHistoryEntry | undefined {
  const priorProposalId = priorProposal?.id ?? draft.priorProposalId ?? lineage.priorProposalId;
  const verificationRequestId = draft.verificationRequestId ?? lineage.verificationRequestId;
  const followupDraftId = draft.followupDraftId ?? lineage.followupDraftId;
  if (!priorProposalId || !verificationRequestId) {
    return undefined;
  }
  const proposalEntries = history.entries.filter((entry) => entry.kind === "original" || entry.kind === "follow_up");
  const priorIndex = proposalEntries.findIndex((entry) => entry.id === priorProposalId);
  return proposalEntries.find((entry, index) => {
    if (priorIndex >= 0 && index <= priorIndex) {
      return false;
    }
    if (!entry.id || entry.id === priorProposalId || entry.kind !== "follow_up") {
      return false;
    }
    const entryLineage = entry.lineage;
    if (entryLineage?.intent !== "fix") {
      return false;
    }
    if (entryLineage.priorProposalId !== priorProposalId || entryLineage.verificationRequestId !== verificationRequestId) {
      return false;
    }
    return followupDraftId ? entryLineage.followupDraftId === followupDraftId : true;
  });
}

function labels(priorProposal: { id?: string; summary?: string; source?: string } | undefined, history: { latestProposalId?: string; latestStatus?: string; latestSummary?: string; latestSource?: string }, draft: { present: boolean; awaitingManualSend: boolean; label?: string }, extra?: string): string[] {
  return uniqueStrings([
    priorProposal?.id ? `prior proposal ${priorProposal.id}` : undefined,
    priorProposal?.summary,
    history.latestProposalId ? `latest proposal ${history.latestProposalId}` : undefined,
    history.latestStatus,
    history.latestSummary,
    history.latestSource,
    draft.present ? draft.awaitingManualSend ? "draft awaiting manual send" : "draft present" : undefined,
    draft.label,
    extra,
  ]).slice(0, maxLabels);
}

function result(status: GuidedFixLoopStatus, reason: string, cta: string, inputLabels: string[], diagnostics: string[]): GuidedFixLoopResult {
  return {
    kind: "guided_fix_loop",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status,
    reason: safeBoundedText(reason, 220),
    cta: safeBoundedText(cta, 220),
    labels: uniqueStrings(inputLabels.map((item) => safeBoundedText(item, 140))).slice(0, maxLabels),
    diagnostics: uniqueStrings(diagnostics.map((item) => safeBoundedText(item, 180))).slice(0, maxDiagnostics),
    policy: conservativePolicy(),
  };
}

function conservativePolicy(): GuidedFixLoopPolicy {
  return {
    displayOnly: true,
  };
}

function scanUnsafeMetadata(value: unknown, diagnostics: string[], keyPath = "input", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8 || diagnostics.length >= maxDiagnostics * 2) {
    return;
  }
  if (typeof value === "string") {
    if (isUnsafeString(value)) {
      diagnostics.push(`Unsafe guided fix metadata omitted near ${safeBoundedText(keyPath, 80)}.`);
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
      const safeKey = sanitizeDisplayText(key) || "field";
      if (unsafeKeyPattern.test(key)) {
        diagnostics.push(`Unsupported guided fix execution field ${safeBoundedText(safeKey, 80)}.`);
      }
      scanUnsafeMetadata(item, diagnostics, `${keyPath}.${safeKey}`, depth + 1, seen);
    }
  }
}

function safeId(value: unknown, diagnostics: string[], field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    diagnostics.push(`Unsafe ${field} metadata was omitted.`);
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  if (!safeIdPattern.test(sanitized) || isUnsafeString(sanitized)) {
    diagnostics.push(`Unsafe ${field} metadata was omitted.`);
    return undefined;
  }
  return sanitized;
}

function safeLabel(value: unknown, limit: number, diagnostics: string[], field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    diagnostics.push(`Unsafe ${field} metadata was omitted.`);
    return undefined;
  }
  const raw = String(value);
  if (isUnsafeString(raw)) {
    diagnostics.push(`Unsafe ${field} metadata was omitted.`);
    return undefined;
  }
  const label = safeBoundedText(raw, limit);
  return label && label !== "[redacted]" ? label : undefined;
}

function safeBoundedText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
  const safe = sanitized && !isUnsafeString(sanitized) ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function isUnsafeString(value: string): boolean {
  return unsafeTextPattern.test(value) || secretTextPattern.test(value) || privatePathPattern.test(value) || stackTracePattern.test(value);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  const sanitized = sanitizeDisplayValue(value);
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized) && typeof value === "object" && value !== null && !Array.isArray(value);
}
