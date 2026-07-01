export type ControlledAgentEditExecutorSummary = {
  state: string | undefined;
  canApplyControlledEdit: boolean;
  canCreateFiles: boolean;
  canDeleteFiles: boolean;
  canRenameFiles: boolean;
  canRunCommands: boolean;
  diagnostics: string[];
  touchedFileLabels: string[];
  editCount: number;
  replacementByteCount: number;
};

const forbiddenTopLevelFields = [
  "command",
  "cwd",
  "env",
  "provider",
  "tool",
  "shell",
  "git",
  "rawDiff",
  "rawBody",
];

const unsafePathParts = [
  "node_modules",
  "dist",
  "target",
  "secret",
  ".env",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeWorkspaceRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.startsWith(".") || value.includes("..")) {
    return false;
  }

  return !unsafePathParts.some((part) => value.includes(part));
}

function getReplacementByteCount(edit: Record<string, unknown>): number {
  const replacement = edit.replacement;

  if (typeof replacement !== "string") {
    return 0;
  }

  return new TextEncoder().encode(replacement).byteLength;
}

export function evaluateControlledAgentEditExecutor(
  input: unknown,
): ControlledAgentEditExecutorSummary {
  const summary: ControlledAgentEditExecutorSummary = {
    state: undefined,
    canApplyControlledEdit: false,
    canCreateFiles: false,
    canDeleteFiles: false,
    canRenameFiles: false,
    canRunCommands: false,
    diagnostics: [],
    touchedFileLabels: [],
    editCount: 0,
    replacementByteCount: 0,
  };

  if (!isRecord(input)) {
    summary.diagnostics.push("missing_or_malformed_input");
    return summary;
  }

  for (const field of forbiddenTopLevelFields) {
    if (field in input) {
      summary.diagnostics.push(`forbidden_top_level_field:${field}`);
    }
  }

  if (typeof input.state === "string") {
    summary.state = input.state;
  }

  if (!Array.isArray(input.edits)) {
    summary.diagnostics.push("missing_or_malformed_edits");
    return summary;
  }

  const validEdits = input.edits.every((edit, index) => {
    if (!isRecord(edit)) {
      summary.diagnostics.push(`malformed_edit:${index}`);
      return false;
    }

    if (edit.operation !== "replace") {
      summary.diagnostics.push(`unsupported_operation:${index}`);
      return false;
    }

    if (typeof edit.expectedContentHash !== "string") {
      summary.diagnostics.push(`missing_expected_content_hash:${index}`);
      return false;
    }

    if (typeof edit.workspaceRelativePath !== "string") {
      summary.diagnostics.push(`missing_workspace_relative_path:${index}`);
      return false;
    }

    if (!isSafeWorkspaceRelativePath(edit.workspaceRelativePath)) {
      summary.diagnostics.push(`unsafe_workspace_relative_path:${index}`);
      return false;
    }

    summary.touchedFileLabels.push(edit.workspaceRelativePath);
    summary.replacementByteCount += getReplacementByteCount(edit);
    return true;
  });

  summary.editCount = input.edits.length;
  summary.canApplyControlledEdit =
    summary.diagnostics.length === 0 && validEdits && summary.state === "planned";

  return summary;
}
