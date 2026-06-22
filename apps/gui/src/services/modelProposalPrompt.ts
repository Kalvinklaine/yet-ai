import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { summarizeCodingTaskContext } from "./codingTaskPrompt";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type OneStepModelProposalPromptMode = "safe_edit";

export type OneStepModelProposalPromptInput = {
  goal: string;
  contextItems: ExplicitContextBundleItem[];
  providerReadiness: string;
  mode: OneStepModelProposalPromptMode;
};

export type OneStepModelProposalPromptResult = {
  prompt: string;
  goalSummary: string;
  contextSummary: string[];
  safetySummary: string[];
};

const goalFallback = "No coding goal was provided. Ask the user for a concrete goal before proposing edits.";
const noContextSummary = "No explicit context is attached. Return prose naming the missing file excerpt, snippet, memory title, or verification output needed before proposing an edit.";
const maxContextSummaryItems = 4;
const maxContextLineLength = 360;
const maxProviderLineLength = 500;

export function buildOneStepModelProposalPrompt(input: OneStepModelProposalPromptInput): OneStepModelProposalPromptResult {
  const goalSummary = sanitizePromptLine(input.goal, goalFallback);
  const contextSummary = boundedContextSummary(input.contextItems);
  const providerSummary = providerReadinessSummary(input.providerReadiness);
  const safetySummary = [
    "Use only attached explicit context and bounded summaries; do not infer from hidden files, private paths, provider logs, browser storage, raw secrets, raw memory bodies, raw file bodies, unshared workspace state, or unselected project files.",
    "Do not run tools, shell, git, searches, indexing, verification, file reads, browser storage access, network calls, provider-side actions, or runtime/bridge actions.",
    "Do not apply edits, save files, write memory, mutate settings, create checkpoints, start autonomous loops, claim production autonomy, or claim anything was run/applied/verified.",
    "If an edit is possible from explicit context only, return exactly one strict safe-edit proposal/envelope for manual review; omit requestId and include no unknown, tool, command, shell, git, execution, storage, search, or indexing fields.",
    "If explicit context is missing or uncertain, return prose explaining exactly what additional explicit context is needed instead of JSON.",
  ];
  const lines = [
    "One-step safe-edit model proposal request",
    "",
    "Goal summary",
    goalSummary,
    "",
    "Explicit context summary",
    ...contextSummary.map((line) => `- ${line}`),
    "",
    "Provider readiness",
    providerSummary,
    "",
    "Local-first BYOK boundary",
    "Yet AI is local-first and BYOK. Provider settings and credentials stay local. This prompt must not require a hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace.",
    "Demo mode is a local no-key preview and not production model autonomy. Local providers depend on the user's local runtime/server. Not-ready providers require user setup before real model sending.",
    "",
    "Safety constraints",
    ...safetySummary.map((line) => `- ${line}`),
    "",
    "Strict response contract",
    "Return exactly one of these:",
    "1. Prose explaining missing explicit context, if the attached context is insufficient or provider readiness says the model is not ready.",
    "2. Exactly one JSON safe-edit proposal/envelope for manual review, with no surrounding prose, no requestId, and no unknown/tool/command/shell/git/search/indexing/storage/execution fields.",
    "The proposal may describe only a small bounded manual edit visible from the attached explicit context. Do not claim it was applied, saved, run, verified, committed, or rolled back.",
  ];
  return {
    prompt: lines.join("\n"),
    goalSummary,
    contextSummary,
    safetySummary,
  };
}

function boundedContextSummary(items: ExplicitContextBundleItem[]): string[] {
  const summary = summarizeCodingTaskContext(items);
  if (summary.contextLines.length === 0) {
    return [noContextSummary];
  }
  const bounded = summary.contextLines.slice(0, maxContextSummaryItems).map((line) => truncatePromptLine(line, maxContextLineLength));
  if (summary.contextLines.length > maxContextSummaryItems) {
    bounded.push(`${summary.contextLines.length - maxContextSummaryItems} additional explicit context item(s) omitted from the prompt summary by the safety bound.`);
  }
  return bounded;
}

function providerReadinessSummary(value: string): string {
  const sanitized = truncatePromptLine(sanitizePromptLine(value, "Provider readiness is unknown or not ready."), maxProviderLineLength);
  const normalized = sanitized.toLowerCase();
  if (/demo|preview/.test(normalized)) {
    return `${sanitized} Demo mode is a local no-key preview for safe UI flow checks, not production autonomy or a claim that edits can be applied.`;
  }
  if (/ollama|local|localhost|127\.0\.0\.1|custom provider/.test(normalized)) {
    return `${sanitized} Local provider readiness depends on the user's local runtime/server and saved local configuration; do not expose or request credentials.`;
  }
  if (/not ready|required|missing|unavailable|disabled|unsupported|error|mismatch|unknown|failed/.test(normalized)) {
    return `${sanitized} The model is not send-ready; return prose naming the setup or explicit context needed before a real model proposal.`;
  }
  return `${sanitized} Use BYOK/local provider wording only; never include or infer credential values.`;
}

function sanitizePromptLine(value: string, fallback: string): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
  return sanitized || fallback;
}

function truncatePromptLine(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}
