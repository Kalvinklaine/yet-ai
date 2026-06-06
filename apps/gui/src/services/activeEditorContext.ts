import type { HostContextSnapshotPayload, WorkspaceEditRange } from "../bridge/bridgeAdapter";
import { redactSecrets, sanitizeDisplayText } from "./redaction";

export type ActiveEditorContextUsability = "none" | "file" | "selection";

export type BoundedContextPreviewResult = {
  text: string;
  redacted: boolean;
  truncated: boolean;
};

const contextPreviewLimit = 360;

export function activeEditorContextUsability(context: HostContextSnapshotPayload | null | undefined): ActiveEditorContextUsability {
  if (!context) {
    return "none";
  }
  if (context.selection?.text?.trim() || formatSelectionRange(context.selection) !== "unknown range") {
    return "selection";
  }
  if (context.file?.displayPath || context.file?.workspaceRelativePath || context.file?.languageId) {
    return "file";
  }
  return "none";
}

export function hasUsableAttachedContext(context: HostContextSnapshotPayload | null | undefined): boolean {
  return activeEditorContextUsability(context) !== "none";
}

export function attachedContextSummary(context: HostContextSnapshotPayload): string {
  return `${activeEditorSourceLabel(context.source)} ${sanitizeDisplayText(context.file?.workspaceRelativePath ?? context.file?.displayPath ?? "active editor")}`;
}

export function attachedContextFileLabel(context: HostContextSnapshotPayload): string {
  const displayPath = context.file?.displayPath;
  const workspacePath = context.file?.workspaceRelativePath;
  if (displayPath && workspacePath && displayPath !== workspacePath) {
    return `${sanitizeDisplayText(displayPath)} (${sanitizeDisplayText(workspacePath)})`;
  }
  return sanitizeDisplayText(displayPath ?? workspacePath ?? "Untitled editor");
}

export function activeEditorSourceLabel(source: HostContextSnapshotPayload["source"] | string | undefined): string {
  if (source === "vscode" || source === "jetbrains" || source === "browser") {
    return sanitizeDisplayText(source);
  }
  return "unknown host";
}

export function boundedContextPreview(text: string): string {
  return classifyBoundedContextPreview(text).text;
}

export function classifyBoundedContextPreview(text: string): BoundedContextPreviewResult {
  if (!text.trim()) {
    return { text: "No selected text preview.", redacted: false, truncated: false };
  }
  const redactedText = redactSecrets(text);
  const truncated = redactedText.length > contextPreviewLimit;
  const bounded = truncated ? `${redactedText.slice(0, contextPreviewLimit)}…` : redactedText;
  const sanitized = sanitizeDisplayText(bounded);
  return {
    text: sanitized,
    redacted: redactedText !== text,
    truncated: truncated || sanitized.length < bounded.trim().length,
  };
}

export function formatSelectionRange(selection: HostContextSnapshotPayload["selection"] | null | undefined): string {
  if (!selection) {
    return "unknown range";
  }
  const hasStart = selection.startLine !== undefined && selection.startCharacter !== undefined;
  const hasEnd = selection.endLine !== undefined && selection.endCharacter !== undefined;
  if (hasStart && hasEnd) {
    return `${selection.startLine}:${selection.startCharacter}-${selection.endLine}:${selection.endCharacter}`;
  }
  if (hasStart) {
    return `${selection.startLine}:${selection.startCharacter}`;
  }
  return "unknown range";
}

export function rangeFromContextSelection(selection: HostContextSnapshotPayload["selection"] | null | undefined): WorkspaceEditRange | undefined {
  if (!selection || selection.startLine === undefined || selection.startCharacter === undefined || selection.endLine === undefined || selection.endCharacter === undefined) {
    return undefined;
  }
  if (selection.endLine < selection.startLine || (selection.endLine === selection.startLine && selection.endCharacter < selection.startCharacter)) {
    return undefined;
  }
  return {
    start: { line: selection.startLine, character: selection.startCharacter },
    end: { line: selection.endLine, character: selection.endCharacter },
  };
}
