import type { IdeActionResultPayload } from "../bridge/bridgeAdapter";
import type { AgentRunPlanPreviewMetadata, AgentRunProposalMetadata } from "./agentRunState";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

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
  planPreview?: AgentRunPlanPreviewMetadata;
  touchedFiles?: string[];
};

export type VerificationFollowupPromptDraftMetadata = {
  kind: "agent_run.followup_prompt_draft";
  authority: "metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  draftOnly: true;
  mode: VerificationFollowupPromptMode;
  verification: {
    commandId: string;
    status: string;
    exitCode: number | "unknown";
    truncated: boolean;
  };
  priorProposal?: {
    id?: string;
    summary?: string;
  };
  planPreview?: {
    title?: string;
    summary?: string;
    steps?: string[];
  };
  touchedFiles?: string[];
};

export type VerificationFollowupPromptDraft = {
  prompt: string;
  metadata: VerificationFollowupPromptDraftMetadata;
};

const outputSummaryLimit = 1200;
const promptLimit = 2400;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\u0000-\u001f\u007f-\u009f]+$/;
const unsafeContextTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool|call)|stack[_ -]?trace|callstack|\b(?:command|cmd|args|cwd|env|shell|git)\b|\bnpm\s+(?:run|test|install)|\bcargo\s+(?:check|test|run)|auto[_ -]?(?:send|apply|run|verify|fix|repair|rollback)|hidden[_ -]?(?:read|search|scan)|apply[_ -]?patch/i;

export function buildVerificationFollowupPrompt(result: VerificationResultForPrompt, mode: VerificationFollowupPromptMode, context?: VerificationFollowupPromptContext): string {
  return buildVerificationFollowupPromptDraft(result, mode, context).prompt;
}

export function buildVerificationFollowupPromptDraft(result: VerificationResultForPrompt, mode: VerificationFollowupPromptMode, context?: VerificationFollowupPromptContext): VerificationFollowupPromptDraft {
  const commandId = sanitizeDisplayText(result.commandId);
  const status = sanitizeDisplayText(result.status);
  const exitCode = Number.isFinite(result.exitCode) ? result.exitCode : "unknown";
  const truncated = result.truncated ? "yes" : "no";
  const outputSummary = boundedOutputSummary(result.outputTail);
  const priorProposal = sanitizePriorProposal(context?.priorProposal);
  const planPreview = sanitizePlanPreview(context?.planPreview);
  const touchedFiles = sanitizeTouchedFileLabels(context?.touchedFiles ?? context?.priorProposal?.touchedFiles ?? context?.planPreview?.expectedTouchedFiles);
  const title = mode === "fix" ? "Verification fix prompt" : "Verification follow-up prompt";
  const instruction = mode === "fix"
    ? "Suggest the smallest safe fix plan for this verification result. Do not apply edits, run commands, attach context, save memory, or send anything automatically. If more context is needed, ask for it explicitly."
    : "Explain this verification result and recommend the next safe manual step. Do not apply edits, run commands, attach context, save memory, or send anything automatically. If more context is needed, ask for it explicitly.";
  const metadata: VerificationFollowupPromptDraftMetadata = stripUndefined({
    kind: "agent_run.followup_prompt_draft",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    draftOnly: true,
    mode,
    verification: {
      commandId,
      status,
      exitCode,
      truncated: result.truncated,
    },
    priorProposal,
    planPreview,
    touchedFiles,
  });

  const lines = [
    title,
    "",
    "Draft-only handoff",
    "This text was placed in the composer only. It does not send chat, run commands, apply edits, attach context, save memory, or start repair automatically.",
    "",
    "Verification result metadata",
    `Command id: ${commandId}`,
    `Status: ${status}`,
    `Exit code: ${exitCode}`,
    `Output truncated: ${truncated}`,
    `Mode: ${mode}`,
    ...contextLines(priorProposal, planPreview, touchedFiles),
    "",
    "Bounded sanitized output summary",
    outputSummary || "No output tail was returned.",
    "",
    instruction,
  ];
  return { prompt: boundPrompt(lines.join("\n")), metadata };
}

function boundedOutputSummary(value: string): string {
  const sanitized = sanitizeTimelineText(value)
    .split(/\r?\n/)
    .map((line) => unsafeContextTextPattern.test(line) ? "[redacted]" : line)
    .join("\n")
    .trim();
  return sanitized.length > outputSummaryLimit ? `${sanitized.slice(0, outputSummaryLimit)}…` : sanitized;
}

function contextLines(priorProposal: VerificationFollowupPromptDraftMetadata["priorProposal"], planPreview: VerificationFollowupPromptDraftMetadata["planPreview"], touchedFiles: string[] | undefined): string[] {
  const lines: string[] = [];
  if (priorProposal || planPreview || touchedFiles?.length) {
    lines.push("", "Sanitized Agent Run context");
  }
  if (priorProposal) {
    if (priorProposal.id) {
      lines.push(`Previous proposal id: ${priorProposal.id}`);
    }
    if (priorProposal.summary) {
      lines.push(`Previous proposal summary: ${priorProposal.summary}`);
    }
  }
  if (planPreview) {
    if (planPreview.title) {
      lines.push(`Plan title: ${planPreview.title}`);
    }
    if (planPreview.summary) {
      lines.push(`Plan summary: ${planPreview.summary}`);
    }
    if (planPreview.steps?.length) {
      lines.push(`Plan steps: ${planPreview.steps.join("; ")}`);
    }
  }
  if (touchedFiles?.length) {
    lines.push(`Touched file labels: ${touchedFiles.join(", ")}`);
  }
  return lines;
}

function sanitizePriorProposal(value: AgentRunProposalMetadata | undefined): VerificationFollowupPromptDraftMetadata["priorProposal"] | undefined {
  if (!value) {
    return undefined;
  }
  const id = safeId(value.id);
  const summary = safeContextLine(value.summary, 220);
  return id || summary ? stripUndefined({ id, summary }) : undefined;
}

function sanitizePlanPreview(value: AgentRunPlanPreviewMetadata | undefined): VerificationFollowupPromptDraftMetadata["planPreview"] | undefined {
  if (!value) {
    return undefined;
  }
  const title = safeContextLine(value.title, 160);
  const summary = safeContextLine(value.summary, 220);
  const steps = Array.isArray(value.steps) ? value.steps.map((item) => safeContextLine(item, 120)).filter((item): item is string => Boolean(item)).slice(0, 6) : undefined;
  return title || summary || steps?.length ? stripUndefined({ title, summary, steps }) : undefined;
}

function sanitizeTouchedFileLabels(files: string[] | undefined): string[] | undefined {
  if (!Array.isArray(files)) {
    return undefined;
  }
  const labels = files.map((item) => safeFileLabel(item)).filter((item): item is string => Boolean(item)).slice(0, 8);
  return labels.length > 0 ? labels : undefined;
}

function safeId(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safeFileLabel(value: string): string | undefined {
  const sanitized = sanitizeDisplayText(value).trim();
  if (!sanitized || sanitized.includes("[redacted]") || !safeRelativePathPattern.test(sanitized)) {
    return undefined;
  }
  return sanitized;
}

function safeContextLine(value: string | undefined, limit: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n]+/g, " ").trim();
  if (!sanitized || unsafeContextTextPattern.test(sanitized)) {
    return undefined;
  }
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function boundPrompt(value: string): string {
  return value.length > promptLimit ? `${value.slice(0, promptLimit)}…` : value;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
