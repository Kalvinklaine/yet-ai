import type { IdeActionResultPayload } from "../bridge/bridgeAdapter";
import type { AgentRunPlanPreviewMetadata, AgentRunProposalMetadata } from "./agentRunState";
import type { CodingTaskSessionSnapshot } from "./codingTaskSession";
import type { ProposalHistory, ProposalHistoryComparisonSummary, ProposalHistoryEntry } from "./proposalHistory";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type VerificationFollowupPromptMode = "followup" | "fix";

export type VerificationResultForPrompt = IdeActionResultPayload & {
  action: "runVerificationCommand";
  status: "succeeded" | "failed";
  commandId: NonNullable<IdeActionResultPayload["commandId"]>;
  exitCode: number;
  outputTail: string;
  truncated: boolean;
};

export type VerificationFollowupPromptContext = {
  priorProposal?: AgentRunProposalMetadata;
  proposalHistory?: ProposalHistory | ProposalHistoryComparisonSummary | readonly ProposalHistoryEntry[];
  planPreview?: AgentRunPlanPreviewMetadata;
  planStepLabel?: unknown;
  sessionLabel?: unknown;
  sessionSnapshot?: CodingTaskSessionSnapshot;
  touchedFiles?: string[];
  verificationRequestId?: unknown;
  followupDraftId?: unknown;
};

export type VerificationFollowupPromptDraftMetadata = {
  kind: "agent_run.followup_prompt_draft";
  authority: "metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  draftOnly: true;
  mode: VerificationFollowupPromptMode;
  draftId?: string;
  verification: {
    commandId: string;
    status: string;
    exitCode: number | "unknown";
    truncated: boolean;
    requestId?: string;
  };
  priorProposal?: {
    id?: string;
    summary?: string;
  };
  planPreview?: {
    title?: string;
    summary?: string;
    steps?: string[];
    stepLabel?: string;
  };
  proposalHistory?: {
    latestProposalId?: string;
    latestStatus?: string;
    latestSummary?: string;
    latestSource?: string;
    lineageLabels?: string[];
  };
  session?: {
    label?: string;
  };
  touchedFiles?: string[];
  diagnostics?: string[];
};

export type VerificationFollowupPromptDraft = {
  prompt: string;
  metadata: VerificationFollowupPromptDraftMetadata;
};

const outputSummaryLimit = 1000;
const promptLimit = 2400;
const maxDiagnostics = 10;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\u0000-\u001f\u007f-\u009f]+$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providerPayload|provider_payload|providerTool|provider_tool|tool|toolCall|tool_call|rawDiff|raw_diff|diff|patch|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|prompt|rawOutput|raw_output|output|stdout|stderr|stackTrace|stack_trace|callstack|privatePath|private_path|requestId|request_id|authority|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoVerify|auto_verify|autoRepair|auto_repair|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const unsafeContextTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool|call)|stack[_ -]?trace|callstack|tool[_ -]?call|private[_ -]?path|chain[_ -]?of[_ -]?thought|\b(?:command|cmd|args|cwd|env|shell|git|stdout|stderr)\b|\bnpm\s+(?:run|test|install)|\bcargo\s+(?:check|test|run)|auto[_ -]?(?:send|apply|run|verify|fix|repair|rollback)|hidden[_ -]?(?:read|search|scan)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function buildVerificationFollowupPrompt(result: VerificationResultForPrompt, mode: VerificationFollowupPromptMode, context?: VerificationFollowupPromptContext): string {
  return buildVerificationFollowupPromptDraft(result, mode, context).prompt;
}

export function buildVerificationFollowupPromptDraft(result: VerificationResultForPrompt, mode: VerificationFollowupPromptMode, context?: VerificationFollowupPromptContext): VerificationFollowupPromptDraft {
  const diagnostics: string[] = [];
  scanUnsafeMetadata(context, diagnostics);
  const commandId = safeId(result.commandId, diagnostics, "verification command id") ?? "verification-command";
  const status = safeContextLine(result.status, 40, diagnostics, "verification status") ?? "unknown";
  const exitCode = Number.isInteger(result.exitCode) && result.exitCode >= 0 && result.exitCode <= 255 ? result.exitCode : "unknown";
  const truncated = result.truncated ? "yes" : "no";
  const verificationRequestId = safeId(context?.verificationRequestId, diagnostics, "verification request id");
  const followupDraftId = safeId(context?.followupDraftId, diagnostics, "follow-up draft id");
  const outputSummary = mode === "fix" ? undefined : boundedOutputSummary(result.outputTail, diagnostics);
  const priorProposal = sanitizePriorProposal(context?.priorProposal, diagnostics);
  const planPreview = sanitizePlanPreview(context?.planPreview, context?.planStepLabel, diagnostics);
  const proposalHistory = sanitizeProposalHistory(context?.proposalHistory ?? context?.sessionSnapshot?.proposalHistory, diagnostics);
  const session = sanitizeSession(context?.sessionLabel ?? context?.sessionSnapshot?.goal.label, diagnostics);
  const touchedFiles = sanitizeTouchedFileLabels(context?.touchedFiles ?? context?.priorProposal?.touchedFiles ?? context?.planPreview?.expectedTouchedFiles ?? context?.sessionSnapshot?.proposalHistory.touchedFileLabels, diagnostics);
  const title = mode === "fix" ? "Verification fix prompt" : "Verification follow-up prompt";
  const instruction = mode === "fix"
    ? "Propose a safe edit only. Use the failed verification status label, previous proposal label, sanitized lineage labels, and touched file labels above to suggest the smallest safe fix. Do not apply edits, run commands, attach context, save memory, repair, rollback, or send anything automatically. If more context is needed, ask for it explicitly."
    : "Explain this verification result and recommend the next safe manual step. Do not apply edits, run commands, attach context, save memory, or send anything automatically. If more context is needed, ask for it explicitly.";
  const metadata: VerificationFollowupPromptDraftMetadata = stripUndefined({
    kind: "agent_run.followup_prompt_draft",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    draftOnly: true,
    mode,
    draftId: followupDraftId,
    verification: stripUndefined({
      commandId,
      status,
      exitCode,
      truncated: result.truncated,
      requestId: verificationRequestId,
    }),
    priorProposal,
    planPreview,
    proposalHistory,
    session,
    touchedFiles,
    diagnostics: diagnostics.length > 0 ? uniqueStrings(diagnostics).slice(0, maxDiagnostics) : undefined,
  });

  const lines = [
    title,
    "",
    "Draft-only handoff",
    "This text was placed in the composer only. It does not send chat, run commands, apply edits, attach context, save memory, or start repair automatically.",
    "The user must review this draft, edit it if needed, then click Send manually only if they choose.",
    "",
    "Verification result metadata",
    `Command id: ${commandId}`,
    `Status: ${status}`,
    `Exit code: ${exitCode}`,
    `Output truncated: ${truncated}`,
    `Mode: ${mode}`,
    ...contextLines(priorProposal, planPreview, proposalHistory, session, touchedFiles, metadata.diagnostics),
    ...(outputSummary === undefined ? ["", "Raw command output is intentionally omitted from this fix draft."] : ["", "Bounded sanitized output summary", outputSummary || "No output tail was returned."]),
    "",
    instruction,
  ];
  return { prompt: boundPrompt(lines.join("\n")), metadata };
}

function boundedOutputSummary(value: string, diagnostics: string[]): string {
  const sanitized = sanitizeTimelineText(value)
    .split(/\r?\n/)
    .map((line) => {
      if (isUnsafeString(line)) {
        diagnostics.push("Unsafe verification output line was omitted.");
        return "[redacted]";
      }
      return line;
    })
    .join("\n")
    .trim();
  return sanitized.length > outputSummaryLimit ? `${sanitized.slice(0, outputSummaryLimit)}…` : sanitized;
}

function contextLines(priorProposal: VerificationFollowupPromptDraftMetadata["priorProposal"], planPreview: VerificationFollowupPromptDraftMetadata["planPreview"], proposalHistory: VerificationFollowupPromptDraftMetadata["proposalHistory"], session: VerificationFollowupPromptDraftMetadata["session"], touchedFiles: string[] | undefined, diagnostics: string[] | undefined): string[] {
  const lines: string[] = [];
  if (priorProposal || planPreview || proposalHistory || session || touchedFiles?.length || diagnostics?.length) {
    lines.push("", "Sanitized Agent Run context");
  }
  if (priorProposal) {
    if (priorProposal.id) {
      lines.push(`Previous proposal id: ${priorProposal.id}`);
    }
    if (priorProposal.summary) {
      lines.push(`Previous proposal label: ${priorProposal.summary}`);
    }
  }
  if (proposalHistory) {
    if (proposalHistory.latestProposalId) {
      lines.push(`Latest proposal id: ${proposalHistory.latestProposalId}`);
    }
    if (proposalHistory.latestStatus) {
      lines.push(`Latest proposal status: ${proposalHistory.latestStatus}`);
    }
    if (proposalHistory.latestSummary) {
      lines.push(`Latest proposal label: ${proposalHistory.latestSummary}`);
    }
    if (proposalHistory.latestSource) {
      lines.push(`Latest proposal source: ${proposalHistory.latestSource}`);
    }
    if (proposalHistory.lineageLabels?.length) {
      lines.push(`Proposal lineage labels: ${proposalHistory.lineageLabels.join("; ")}`);
    }
  }
  if (planPreview) {
    if (planPreview.title) {
      lines.push(`Plan title: ${planPreview.title}`);
    }
    if (planPreview.summary) {
      lines.push(`Plan summary: ${planPreview.summary}`);
    }
    if (planPreview.stepLabel) {
      lines.push(`Current plan step: ${planPreview.stepLabel}`);
    }
    if (planPreview.steps?.length) {
      lines.push(`Plan steps: ${planPreview.steps.join("; ")}`);
    }
  }
  if (session?.label) {
    lines.push(`Session label: ${session.label}`);
  }
  if (touchedFiles?.length) {
    lines.push(`Touched file labels: ${touchedFiles.join(", ")}`);
  }
  if (diagnostics?.length) {
    lines.push(`Sanitization diagnostics: ${diagnostics.join("; ")}`);
  }
  return lines;
}

function sanitizePriorProposal(value: AgentRunProposalMetadata | undefined, diagnostics: string[]): VerificationFollowupPromptDraftMetadata["priorProposal"] | undefined {
  if (!value) {
    return undefined;
  }
  const id = safeId(value.id, diagnostics, "prior proposal id");
  const summary = safeContextLine(value.summary, 220, diagnostics, "prior proposal label");
  return id || summary ? stripUndefined({ id, summary }) : undefined;
}

function sanitizePlanPreview(value: AgentRunPlanPreviewMetadata | undefined, stepLabel: unknown, diagnostics: string[]): VerificationFollowupPromptDraftMetadata["planPreview"] | undefined {
  const title = safeContextLine(value?.title, 160, diagnostics, "plan title");
  const summary = safeContextLine(value?.summary, 220, diagnostics, "plan summary");
  const steps = Array.isArray(value?.steps) ? value.steps.map((item) => safeContextLine(item, 120, diagnostics, "plan step")).filter((item): item is string => Boolean(item)).slice(0, 6) : undefined;
  const safeStepLabel = safeContextLine(stepLabel, 120, diagnostics, "current plan step label");
  return title || summary || steps?.length || safeStepLabel ? stripUndefined({ title, summary, steps, stepLabel: safeStepLabel }) : undefined;
}

function sanitizeProposalHistory(value: VerificationFollowupPromptContext["proposalHistory"], diagnostics: string[]): VerificationFollowupPromptDraftMetadata["proposalHistory"] | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const entries = value.map((entry) => sanitizeHistoryEntry(entry, diagnostics)).filter((entry): entry is NonNullable<ReturnType<typeof sanitizeHistoryEntry>> => Boolean(entry));
    const latest = entries[entries.length - 1];
    const proposalEntries = entries.filter((entry) => entry.kind === "original" || entry.kind === "follow_up");
    const latestProposal = proposalEntries[proposalEntries.length - 1];
    const lineageLabels = entries.map((entry) => [entry.id, entry.status, entry.summary].filter(Boolean).join(" · ")).filter(Boolean).slice(-6);
    return latest || latestProposal || lineageLabels.length ? stripUndefined({
      latestProposalId: latestProposal?.id,
      latestStatus: latest?.status,
      latestSummary: latest?.summary,
      latestSource: latest?.source,
      lineageLabels,
    }) : undefined;
  }
  if ("entries" in value && Array.isArray(value.entries)) {
    return sanitizeProposalHistory(value.entries, diagnostics);
  }
  if ("kind" in value && value.kind === "proposal_history_comparison") {
    const latestStatus = safeContextLine(value.latestStatus, 80, diagnostics, "history latest status");
    const latestSummary = safeContextLine(value.latestSummary, 160, diagnostics, "history latest label");
    const latestSource = safeContextLine(value.latestSource, 80, diagnostics, "history latest source");
    const lineageLabels = Array.isArray(value.comparisonLabels) ? value.comparisonLabels.map((item) => safeContextLine(item, 160, diagnostics, "history lineage label")).filter((item): item is string => Boolean(item)).slice(0, 6) : undefined;
    return latestStatus || latestSummary || latestSource || lineageLabels?.length ? stripUndefined({ latestStatus, latestSummary, latestSource, lineageLabels }) : undefined;
  }
  return undefined;
}

function sanitizeHistoryEntry(entry: ProposalHistoryEntry, diagnostics: string[]): { id?: string; kind?: string; status?: string; summary?: string; source?: string } | undefined {
  if (!entry || typeof entry !== "object") {
    diagnostics.push("Unsafe proposal history entry was omitted.");
    return undefined;
  }
  const id = safeId(entry.id, diagnostics, "proposal history id");
  const kind = safeContextLine(entry.kind, 80, diagnostics, "proposal history kind");
  const status = safeContextLine(entry.status, 80, diagnostics, "proposal history status");
  const summary = safeContextLine(entry.summary, 160, diagnostics, "proposal history label");
  const source = safeContextLine(entry.source, 80, diagnostics, "proposal history source");
  return id || kind || status || summary || source ? stripUndefined({ id, kind, status, summary, source }) : undefined;
}

function sanitizeSession(value: unknown, diagnostics: string[]): VerificationFollowupPromptDraftMetadata["session"] | undefined {
  const label = safeContextLine(value, 160, diagnostics, "session label");
  return label ? { label } : undefined;
}

function sanitizeTouchedFileLabels(files: readonly unknown[] | undefined, diagnostics: string[]): string[] | undefined {
  if (!Array.isArray(files)) {
    return undefined;
  }
  const labels = files.map((item) => safeFileLabel(item, diagnostics)).filter((item): item is string => Boolean(item)).slice(0, 8);
  return labels.length > 0 ? uniqueStrings(labels) : undefined;
}

function safeId(value: unknown, diagnostics: string[], field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    diagnostics.push(`Unsafe ${field} was omitted.`);
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  if (!safeIdPattern.test(sanitized) || isUnsafeString(sanitized)) {
    diagnostics.push(`Unsafe ${field} was omitted.`);
    return undefined;
  }
  return sanitized;
}

function safeFileLabel(value: unknown, diagnostics: string[]): string | undefined {
  if (typeof value !== "string") {
    diagnostics.push("Unsafe touched file label was omitted.");
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  if (!sanitized || sanitized.includes("[redacted]") || isUnsafeString(sanitized) || !safeRelativePathPattern.test(sanitized)) {
    diagnostics.push("Unsafe touched file label was omitted.");
    return undefined;
  }
  return sanitized;
}

function safeContextLine(value: unknown, limit: number, diagnostics: string[], field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    diagnostics.push(`Unsafe ${field} was omitted.`);
    return undefined;
  }
  const sanitized = sanitizeTimelineText(String(value)).replace(/[\r\n]+/g, " ").trim();
  if (!sanitized || isUnsafeString(sanitized)) {
    diagnostics.push(`Unsafe ${field} was omitted.`);
    return undefined;
  }
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function scanUnsafeMetadata(value: unknown, diagnostics: string[], keyPath = "context", depth = 0, seen = new WeakSet<object>()): void {
  if (value === undefined || depth > 8 || diagnostics.length >= maxDiagnostics * 2) {
    return;
  }
  if (typeof value === "string") {
    if (isUnsafeString(value)) {
      diagnostics.push(`Unsafe context metadata omitted near ${safeDiagnosticLabel(keyPath)}.`);
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
      const safeKey = safeDiagnosticLabel(key) || "field";
      if (unsafeKeyPattern.test(key)) {
        diagnostics.push(`Unsupported execution field ${safeKey} was omitted.`);
      }
      scanUnsafeMetadata(item, diagnostics, `${keyPath}.${safeKey}`, depth + 1, seen);
    }
  }
}

function safeDiagnosticLabel(value: string): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
  return sanitized && !isUnsafeString(sanitized) ? sanitized.slice(0, 80) : "field";
}

function isUnsafeString(value: string): boolean {
  return unsafeContextTextPattern.test(value) || secretTextPattern.test(value) || privatePathPattern.test(value) || stackTracePattern.test(value);
}

function boundPrompt(value: string): string {
  return value.length > promptLimit ? `${value.slice(0, promptLimit)}…` : value;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  const sanitized = sanitizeDisplayValue(value);
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized) && typeof value === "object" && value !== null && !Array.isArray(value);
}
