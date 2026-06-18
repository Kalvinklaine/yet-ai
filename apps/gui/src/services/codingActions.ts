import type { HostContextSnapshotPayload } from "../bridge/bridgeAdapter";
import { attachedContextFileLabel, formatSelectionRange } from "./activeEditorContext";

export type CodingActionId = "explain_selection" | "find_issue" | "improve_selection" | "generate_tests" | "propose_safe_edit";

export type CodingAction = {
  id: CodingActionId;
  label: string;
  shortLabel: string;
  description: string;
  buildPrompt: (context: HostContextSnapshotPayload) => string;
};

function actionMarker(action: CodingActionId): string {
  return `Coding action: ${action}`;
}

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
    buildPrompt: (context) => `${contextLine(context)}\n${actionMarker("explain_selection")}\n\nExplain the selected code clearly. Cover purpose, inputs/outputs, important control flow, and any assumptions. Do not read other files unless I explicitly attach them.`,
  },
  {
    id: "find_issue",
    label: "Find issue",
    shortLabel: "Find issue",
    description: "Look for a likely bug, edge case, or safety concern.",
    buildPrompt: (context) => `${contextLine(context)}\n${actionMarker("find_issue")}\n\nReview the selected code for likely bugs, edge cases, security/privacy concerns, or maintainability risks. Prioritize concrete issues and explain how to verify them. Do not apply changes.`,
  },
  {
    id: "improve_selection",
    label: "Improve safely",
    shortLabel: "Improve",
    description: "Suggest a local improvement for the selected code.",
    buildPrompt: (context) => `${contextLine(context)}\n${actionMarker("improve_selection")}\n\nSuggest a focused improvement for the selected code that preserves behavior. Explain the tradeoffs and show the proposed replacement in a code block. Do not apply changes automatically.`,
  },
  {
    id: "generate_tests",
    label: "Generate tests",
    shortLabel: "Tests",
    description: "Draft tests that exercise the selected code.",
    buildPrompt: (context) => `${contextLine(context)}\n${actionMarker("generate_tests")}\n\nGenerate focused tests for the selected code. Include meaningful cases, edge cases, and any setup/mocking needed. Keep the answer reviewable and do not modify files automatically.`,
  },
  {
    id: "propose_safe_edit",
    label: "Safe edit",
    shortLabel: "Safe edit",
    description: "Ask for a reviewed edit proposal; nothing is applied automatically.",
    buildPrompt: (context) => `${contextLine(context)}\n${actionMarker("propose_safe_edit")}\n\nPropose a safe edit for the selected code. Return either normal explanatory prose or exactly one complete JSON proposal. If you return JSON, prefer exactly one raw JSON object with no prose; one fenced \`\`\`json block is acceptable only when it contains exactly the same single complete bridge envelope and no other JSON. The envelope must be: {\"type\": \"gui.applyWorkspaceEditRequest\", \"version\": \"2026-05-15\", \"payload\": {\"requiresUserConfirmation\": true, \"cloudRequired\": false, \"summary\": \"short safe summary\", \"edits\": [{\"workspaceRelativePath\": \"src/example.ts\", \"textReplacements\": [{\"range\": {\"start\": {\"line\": 1, \"character\": 0}, \"end\": {\"line\": 1, \"character\": 1}}, \"replacementText\": \"replacement text\"}]}]}}. Do not include requestId, command, tool, or any unknown fields. Use bounded replacements in existing workspace-relative files only. Do not create, delete, rename, move, patch files, traverse paths, or use absolute/private paths. Do not provide multiple alternatives or multiple JSON objects. Nothing is applied automatically: the GUI will show a review first and the IDE may apply only after explicit user confirmation. Do not auto-apply. Do not ask to run tools, shell, git, or file system commands.`,
  },
];
