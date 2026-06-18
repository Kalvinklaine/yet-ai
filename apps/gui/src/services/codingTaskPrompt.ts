import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { formatSelectionRange } from "./activeEditorContext";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type CodingTaskPromptMode = "ask" | "implementation_plan" | "safe_edit" | "follow_up";

export type CodingTaskPromptInput = {
  mode: CodingTaskPromptMode;
  goal: string;
  contextItems: ExplicitContextBundleItem[];
  providerReadiness: string;
};

export type CodingTaskPromptContextSummary = {
  totalCount: number;
  memoryTitles: string[];
  snippetCount: number;
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
    summary.contextLines.length > 0 ? summary.contextLines.map((line) => `- ${line}`).join("\n") : "- No explicit context is selected yet.",
    "",
    "Memory",
    `- Count: ${summary.memoryTitles.length}`,
    summary.memoryTitles.length > 0 ? `- Titles: ${summary.memoryTitles.join(", ")}` : "- Titles: none",
    "",
    "Snippets",
    `- Count: ${summary.snippetCount}`,
    "",
    "Provider readiness",
    providerReadiness,
    "",
    "Ground rules",
    "Use only the attached explicit context and the summaries above. Do not infer from hidden files, private paths, browser storage, provider logs, raw secrets, or unshared workspace state.",
    "Do not auto-run commands, auto-apply edits, auto-save memory, or perform workspace changes. Ask before any action outside the existing explicit controls.",
    "",
    modeInstruction(input.mode),
  ];
  return sections.join("\n");
}

export function summarizeCodingTaskContext(items: ExplicitContextBundleItem[]): CodingTaskPromptContextSummary {
  const memoryTitles = items.filter((item) => item.kind === "project_memory").map((item) => sanitizePromptLine(item.title)).filter(Boolean);
  const snippetCount = items.filter((item) => item.kind === "workspace_snippet").length;
  return {
    totalCount: items.length,
    memoryTitles,
    snippetCount,
    contextLines: items.map((item, index) => `${index + 1}. ${contextItemSummary(item)}`),
  };
}

function modeTitle(mode: CodingTaskPromptMode): string {
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
  if (mode === "implementation_plan") {
    return "Request: draft a concise implementation plan with files to inspect/change, tests to run, risks, and a stop point before edits.";
  }
  if (mode === "safe_edit") {
    return "Request: propose the smallest safe edit for the goal. Return a reviewable proposal only; do not assume it will be applied automatically.";
  }
  if (mode === "follow_up") {
    return "Request: use the visible response, edit, and verification state to suggest the next safe manual step. Do not assume any action was run unless it is shown above.";
  }
  return "Request: answer the task question, identify missing explicit context, and suggest the next safe step.";
}

function contextItemSummary(item: ExplicitContextBundleItem): string {
  if (item.kind === "project_memory") {
    return `memory: ${sanitizePromptLine(item.title)}`;
  }
  if (item.kind === "workspace_snippet") {
    return `snippet: ${sanitizePromptLine(item.workspaceRelativePath)} (${sanitizePromptLine(item.languageId)}, ${formatWorkspaceRange(item.range)})`;
  }
  if (item.kind === "verification_output") {
    return `verification: ${sanitizePromptLine(item.commandId)} ${sanitizePromptLine(item.status)} exit ${item.exitCode}`;
  }
  const file = item.file?.workspaceRelativePath ?? item.file?.displayPath ?? "active editor";
  return `active editor: ${sanitizePromptLine(file)} (${sanitizePromptLine(item.file?.languageId ?? "unknown language")}, ${formatSelectionRange(item.selection)})`;
}

function formatWorkspaceRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function sanitizePromptLine(value: string): string {
  return sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
}
