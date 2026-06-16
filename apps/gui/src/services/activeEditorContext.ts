import type { HostContextSnapshotPayload, WorkspaceEditRange } from "../bridge/bridgeAdapter";
import type { ActiveFileExcerptAttachment } from "../bridge/bridgeAdapter";
import type { ChatContext } from "./runtimeClient";
import { redactSecrets, sanitizeDisplayText } from "./redaction";

export type ActiveEditorContextUsability = "none" | "file" | "selection";

export type BoundedContextPreviewResult = {
  text: string;
  redacted: boolean;
  truncated: boolean;
};

const contextPreviewLimit = 360;

export type ActiveFileExcerptPreviewResult = {
  fileLabel: string;
  language: string;
  range: string;
  characters: number;
  text: string;
  redacted: boolean;
  truncated: boolean;
  hostTruncated: boolean;
};

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

export function attachedContextRequiresAcknowledgement(context: HostContextSnapshotPayload | null | undefined): boolean {
  const selectedText = context?.selection?.text;
  if (!selectedText) {
    return false;
  }
  const preview = classifyBoundedContextPreview(selectedText);
  return preview.redacted || preview.truncated;
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

export function activeFileExcerptToChatContext(attachment: ActiveFileExcerptAttachment): ChatContext {
  return {
    kind: "active_editor",
    source: attachment.source,
    file: attachment.file,
    selection: {
      startLine: attachment.range.start.line,
      startCharacter: attachment.range.start.character,
      endLine: attachment.range.end.line,
      endCharacter: attachment.range.end.character,
      text: attachment.text,
    },
  };
}

export function activeFileExcerptSummary(attachment: ActiveFileExcerptAttachment): string {
  return `${activeEditorSourceLabel(attachment.source)} ${sanitizeDisplayText(attachment.file.workspaceRelativePath ?? attachment.file.displayPath ?? "active file excerpt")}`;
}

export function activeFileExcerptPreview(attachment: ActiveFileExcerptAttachment): ActiveFileExcerptPreviewResult {
  const preview = classifyBoundedContextPreview(attachment.text);
  return {
    fileLabel: activeFileExcerptFileLabel(attachment),
    language: attachment.file.languageId ? sanitizeDisplayText(attachment.file.languageId) : "unknown language",
    range: formatEditRange(attachment.range),
    characters: attachment.text.length,
    text: preview.text,
    redacted: preview.redacted,
    truncated: preview.truncated,
    hostTruncated: attachment.truncated,
  };
}

export function activeFileExcerptFileLabel(attachment: ActiveFileExcerptAttachment): string {
  const displayPath = attachment.file.displayPath;
  const workspacePath = attachment.file.workspaceRelativePath;
  if (displayPath && workspacePath && displayPath !== workspacePath) {
    return `${sanitizeDisplayText(displayPath)} (${sanitizeDisplayText(workspacePath)})`;
  }
  return sanitizeDisplayText(displayPath ?? workspacePath ?? "Active file");
}

function formatEditRange(range: WorkspaceEditRange): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
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
