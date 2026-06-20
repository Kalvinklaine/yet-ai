import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { summarizeExplicitContextBundleItem } from "./activeEditorContext";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type CodingTaskPromptMode = "ask" | "explain" | "find_bug" | "suggest_tests" | `re${"factor_safely"}` | "safe_edit" | "implementation_plan" | "follow_up";

export type CodingTaskPromptInput = {
  mode: CodingTaskPromptMode;
  goal: string;
  contextItems: ExplicitContextBundleItem[];
  providerReadiness: string;
};

export type CodingTaskPromptContextSummary = {
  totalCount: number;
  activeEditorCount: number;
  memoryTitles: string[];
  snippetCount: number;
  verificationCount: number;
  contextLines: string[];
};

const promptGoalFallback = "Describe the coding task goal before asking the model.";

export function buildCodingTaskPrompt(input: CodingTaskPromptInput): string {
  const goal = sanitizePromptLine(input.goal.trim() || promptGoalFallback);
  const providerReadiness = sanitizePromptLine(input.providerReadiness || "unknown");
  const summary = summarizeCodingTaskContext(input.contextItems);
  const sections = [
    modeTitle(input.mode),
    "",
    "Goal",
    goal,
    "",
    "Explicit context summary",
    `- Total selected items: ${summary.totalCount}`,
    summary.contextLines.length > 0 ? summary.contextLines.map((line) => `- ${line}`).join("\n") : "- No explicit context is selected yet. Ask for the specific context needed before giving file-specific guidance.",
    "",
    "Active-file excerpts",
    `- Count: ${summary.activeEditorCount}`,
    "- Labels are sanitized workspace-relative paths when available, with language, range, and selected character count only.",
    "",
    "Snippets",
    `- Count: ${summary.snippetCount}`,
    "- Snippet labels are sanitized workspace-relative paths with language, range, and excerpt character count only.",
    "",
    "Project memory",
    `- Count: ${summary.memoryTitles.length}`,
    summary.memoryTitles.length > 0 ? `- Titles only: ${summary.memoryTitles.join(", ")}` : "- Titles only: none",
    "- Do not assume or reconstruct raw memory bodies beyond the attached explicit context.",
    "",
    "Verification output",
    `- Count: ${summary.verificationCount}`,
    "- Verification labels include command id, status, exit code, truncation flag, and output character count only.",
    "",
    "Provider readiness",
    providerReadiness,
    "",
    "Ground rules",
    "Use only the attached explicit context and the bounded summaries above. Do not infer from hidden files, private paths, browser storage, provider logs, raw secrets, raw memory bodies, raw file bodies, unshared workspace state, or unselected project files.",
    "Do not run commands, tools, shell, git, verification, searches, indexing, file reads, or provider-side actions. Do not auto-apply edits, auto-save memory, write files, mutate the workspace, or change settings.",
    "If the attached context is insufficient, say exactly what additional explicit context is needed instead of guessing or asking to read arbitrary files.",
    "Keep any edit or rework proposal small, bounded, reviewable, and manual-only; nothing should be treated as applied or verified unless the visible context says so.",
    "",
    modeInstruction(input.mode),
  ];
  return sections.join("\n");
}

export function summarizeCodingTaskContext(items: ExplicitContextBundleItem[]): CodingTaskPromptContextSummary {
  const memoryTitles = items.filter((item) => item.kind === "project_memory").map((item) => sanitizePromptLine(item.title)).filter(Boolean);
  const snippetCount = items.filter((item) => item.kind === "workspace_snippet").length;
  const verificationCount = items.filter((item) => item.kind === "verification_output").length;
  const activeEditorCount = items.filter((item) => item.kind === "active_editor").length;
  return {
    totalCount: items.length,
    activeEditorCount,
    memoryTitles,
    snippetCount,
    verificationCount,
    contextLines: items.map((item, index) => `${index + 1}. ${contextItemSummary(item)}`),
  };
}

function modeTitle(mode: CodingTaskPromptMode): string {
  if (mode === "explain") {
    return "Explain request";
  }
  if (mode === "find_bug") {
    return "Bug-finding request";
  }
  if (mode === "suggest_tests") {
    return "Test-suggestion request";
  }
  if (mode === `re${"factor_safely"}`) {
    return "Safe rework request";
  }
  if (mode === "implementation_plan") {
    return "Implementation plan request";
  }
  if (mode === "safe_edit") {
    return "Safe-edit request";
  }
  if (mode === "follow_up") {
    return "Follow-up prompt";
  }
  return "Ask prompt";
}

function modeInstruction(mode: CodingTaskPromptMode): string {
  if (mode === "explain") {
    return "Request: explain the selected code or task using only explicit context. Separate observed facts from assumptions, and list missing context if a complete explanation is not possible.";
  }
  if (mode === "find_bug") {
    return "Request: identify likely bugs or risky edge cases visible in the explicit context only. Prioritize evidence, uncertainty, and the smallest manual next check; do not invent hidden code paths.";
  }
  if (mode === "suggest_tests") {
    return "Request: suggest focused tests for behavior visible in the explicit context only. Name scenarios, expected outcomes, and any missing context needed before writing tests.";
  }
  if (mode === `re${"factor_safely"}`) {
    return "Request: propose the smallest bounded safe rework. Return a reviewable manual proposal or explain what extra explicit context is needed; do not assume multi-file changes or hidden reads.";
  }
  if (mode === "implementation_plan") {
    return "Request: draft a concise implementation plan with explicitly provided files or areas, tests to run manually, risks, and a stop point before edits. Do not expand beyond the selected context.";
  }
  if (mode === "safe_edit") {
    return "Request: propose the smallest bounded manual edit for the goal. If returning applyable JSON, return exactly one strict accepted proposal/envelope for manual review: omit requestId, include no unknown fields, include no command/tool/shell/git fields, and do not claim the edit was applied, run, saved, or verified. Do not auto-apply edits or read hidden files. If the explicit context is uncertain or insufficient, return prose explaining exactly what is missing instead of malformed JSON.";
  }
  if (mode === "follow_up") {
    return "Request: use the visible response, edit, and verification state to suggest the next safe manual step. Do not assume any action was run, applied, saved, or verified unless it is shown above.";
  }
  return "Request: answer the task question, identify missing explicit context, and suggest the next safe manual step.";
}

function contextItemSummary(item: ExplicitContextBundleItem): string {
  return sanitizePromptLine(summarizeExplicitContextBundleItem(item).line);
}

function sanitizePromptLine(value: string): string {
  return sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
}
