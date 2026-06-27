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
    latestProposalId?: unknown;
    latestProposalSource?: unknown;
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

  if (history.latestProposalId && isLaterProposal(history.latestProposalId, priorProposal?.id, lineage.latestProposalId, lineage.priorProposalId)) {
    return result("new_proposal_detected", "A later correlated proposal is available after the failed verification.", "Review the new proposal manually before applying anything.", labels(priorProposal, history, draft, "new proposal detected"), []);
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

function summarizeHistory(history: GuidedFixLoopInput["proposalHistory"], session: CodingTaskSessionSnapshot | undefined, diagnostics: string[]): { hasSafeProposal: boolean; latestProposalId?: string; latestStatus?: string; latestSummary?: string; latestSource?: string } {
  if (Array.isArray(history)) {
    const safeEntries = history.map((entry) => sanitizeHistoryEntry(entry, diagnostics)).filter((entry): entry is NonNullable<ReturnType<typeof sanitizeHistoryEntry>> => Boolean(entry));
    const proposalEntries = safeEntries.filter((entry) => entry.kind === "original" || entry.kind === "follow_up");
    const latestProposal = proposalEntries[proposalEntries.length - 1];
    const latest = safeEntries[safeEntries.length - 1];
    return stripUndefined({
      hasSafeProposal: proposalEntries.length > 0,
      latestProposalId: latestProposal?.id,
      latestStatus: latest?.status,
      latestSummary: latest?.summary,
      latestSource: latest?.source,
    });
  }
  if (history && "entries" in history && Array.isArray(history.entries)) {
    return summarizeHistory(history.entries, session, diagnostics);
  }
  if (history && "kind" in history && history.kind === "proposal_history_comparison") {
    const latestStatus = safeLabel(history.latestStatus, 80, diagnostics, "history latest status");
    const latestSummary = safeLabel(history.latestSummary, 160, diagnostics, "history latest summary");
    const latestSource = safeLabel(history.latestSource, 80, diagnostics, "history latest source");
    return stripUndefined({ hasSafeProposal: history.visibleCount > 0, latestStatus, latestSummary, latestSource });
  }
  if (session?.proposalHistory) {
    return summarizeHistory(session.proposalHistory, undefined, diagnostics);
  }
  return { hasSafeProposal: false };
}

function sanitizeHistoryEntry(entry: ProposalHistoryEntry, diagnostics: string[]): { id?: string; kind: string; status: string; summary?: string; source?: string } | undefined {
  if (!entry || typeof entry !== "object") {
    diagnostics.push("Proposal history metadata is malformed.");
    return undefined;
  }
  const id = safeId(entry.id, diagnostics, "proposal history id");
  const kind = safeLabel(entry.kind, 80, diagnostics, "proposal history kind");
  const status = safeLabel(entry.status, 80, diagnostics, "proposal history status");
  const summary = safeLabel(entry.summary, 160, diagnostics, "proposal history summary");
  const source = safeLabel(entry.source, 80, diagnostics, "proposal history source");
  if (!kind || !status) {
    diagnostics.push("Proposal history metadata is missing safe labels.");
    return undefined;
  }
  return stripUndefined({ id, kind, status, summary, source });
}

function sanitizeDraft(value: GuidedFixLoopDraftState | undefined, diagnostics: string[]): { present: boolean; awaitingManualSend: boolean; label?: string } {
  if (!value) {
    return { present: false, awaitingManualSend: false };
  }
  const metadata = value.metadata;
  if (metadata) {
    if (metadata.kind !== "agent_run.followup_prompt_draft" || metadata.authority !== "metadata_only" || metadata.cloudRequired !== false || metadata.executionAllowed !== false || metadata.draftOnly !== true) {
      diagnostics.push("Fix draft metadata is not display-only.");
    }
    if (metadata.mode !== "fix") {
      diagnostics.push("Fix draft metadata is not a fix draft.");
    }
  }
  const label = safeLabel(value.label, 120, diagnostics, "draft label");
  return { present: value.present === true || Boolean(metadata), awaitingManualSend: value.awaitingManualSend === true, label };
}

function sanitizeLineage(value: GuidedFixLoopInput["lineage"], diagnostics: string[]): { verificationRequestId?: string; priorProposalId?: string; latestProposalId?: string; latestProposalSource?: string } {
  if (!value) {
    return {};
  }
  return stripUndefined({
    verificationRequestId: safeId(value.verificationRequestId, diagnostics, "verification request id"),
    priorProposalId: safeId(value.priorProposalId, diagnostics, "lineage prior proposal id"),
    latestProposalId: safeId(value.latestProposalId, diagnostics, "lineage latest proposal id"),
    latestProposalSource: safeLabel(value.latestProposalSource, 80, diagnostics, "lineage latest proposal source"),
  });
}

function isLaterProposal(historyLatestId: string, priorProposalId: string | undefined, lineageLatestId: string | undefined, lineagePriorId: string | undefined): boolean {
  const prior = priorProposalId ?? lineagePriorId;
  const latest = lineageLatestId ?? historyLatestId;
  return Boolean(prior && latest && latest !== prior && historyLatestId === latest);
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
