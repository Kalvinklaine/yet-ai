import type { HostContextSnapshotPayload } from "../bridge/bridgeAdapter";
import { attachedContextFileLabel, formatSelectionRange } from "./activeEditorContext";

export type CodingActionId = "explain_selection" | "find_issue" | "refactor_selection" | "generate_tests" | "propose_safe_edit";

export type CodingAction = {
  id: CodingActionId;
  label: string;
  shortLabel: string;
  description: string;
  buildPrompt: (context: HostContextSnapshotPayload) => string;
};

function contextLine(context: HostContextSnapshotPayload): string {
  const file = attachedContextFileLabel(context);
  const language = context.file?.languageId ? ` (${context.file.languageId})` : "";
  const range = formatSelectionRange(context.selection);
  return `Use only the attached one-shot editor context for ${file}${language}, selection range ${range}.`;
}

export const codingActions: CodingAction[] = [
  {
    id: "explain_selection",
    label: "Explain selection",
    shortLabel: "Explain",
    description: "Explain what the attached selected code does.",
    buildPrompt: (context) => `${contextLine(context)}\n\nExplain the selected code clearly. Cover purpose, inputs/outputs, important control flow, and any assumptions. Do not read other files unless I explicitly attach them.`,
  },
  {
    id: "find_issue",
    label: "Find issue",
    shortLabel: "Find issue",
    description: "Look for a likely bug, edge case, or safety concern.",
    buildPrompt: (context) => `${contextLine(context)}\n\nReview the selected code for likely bugs, edge cases, security/privacy concerns, or maintainability risks. Prioritize concrete issues and explain how to verify them. Do not apply changes.`,
  },
  {
    id: "refactor_selection",
    label: "Refactor selection",
    shortLabel: "Refactor",
    description: "Suggest a local refactor for the selected code.",
    buildPrompt: (context) => `${contextLine(context)}\n\nSuggest a focused refactor for the selected code that preserves behavior. Explain the tradeoffs and show the proposed replacement in a code block. Do not apply changes automatically.`,
  },
  {
    id: "generate_tests",
    label: "Generate tests",
    shortLabel: "Tests",
    description: "Draft tests that exercise the selected code.",
    buildPrompt: (context) => `${contextLine(context)}\n\nGenerate focused tests for the selected code. Include meaningful cases, edge cases, and any setup/mocking needed. Keep the answer reviewable and do not modify files automatically.`,
  },
  {
    id: "propose_safe_edit",
    label: "Safe edit",
    shortLabel: "Safe edit",
    description: "Ask for a reviewed edit proposal; nothing is applied automatically.",
    buildPrompt: (context) => `${contextLine(context)}\n\nPropose a safe edit for the selected code. Nothing is applied automatically: provide a reviewable proposal only, explain why it is safe, list risks, and wait for explicit review/approval before any workspace edit is requested. If you output machine-readable edit JSON, use only the bounded safe edit proposal payload shape with requiresUserConfirmation true and no requestId; the GUI hides raw JSON until I explicitly inspect it.`,
  },
];
