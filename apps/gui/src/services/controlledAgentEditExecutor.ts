import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ControlledAgentEditExecutorState = "disabled" | "pending" | "planned" | "applied" | "blocked" | "failed";

export type ControlledAgentEditExecutorSummary = {
  state: ControlledAgentEditExecutorState;
  canApplyControlledEdit: boolean;
  canCreateFiles: false;
  canDeleteFiles: false;
  canRenameFiles: false;
  canRunCommands: false;
  diagnostics: string[];
  touchedFileLabels: string[];
  editCount: number;
  replacementByteCount: number;
  replacementHashLabels: string[];
  expectedContentHashLabels: string[];
  rangeLabels: string[];
  summary: string;
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
  "diff",
  "body",
  "fileBody",
  "patch",
];

const unsafePathParts = [
  "node_modules",
  "dist",
  "target",
  "secret",
  ".env",
];

const allowedStates = new Set<ControlledAgentEditExecutorState>(["pending", "planned", "applied", "blocked", "failed"]);

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
  if (typeof edit.replacementByteCount === "number" && Number.isInteger(edit.replacementByteCount) && edit.replacementByteCount >= 0 && edit.replacementByteCount <= 24000) {
    return edit.replacementByteCount;
  }

  const replacement = edit.replacement;
  if (typeof replacement !== "string") {
    return 0;
  }

  return new TextEncoder().encode(replacement).byteLength;
}

function safeHashLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = sanitizeDisplayText(value).trim();
  if (!/^sha256:[a-f0-9]{8,64}$/i.test(text)) {
    return undefined;
  }
  return text;
}

function safeRangeLabel(edit: Record<string, unknown>): string | undefined {
  const range = isRecord(edit.range) ? edit.range : undefined;
  const start = isRecord(range?.start) ? range.start : undefined;
  const end = isRecord(range?.end) ? range.end : undefined;
  const startLine = typeof start?.line === "number" && Number.isInteger(start.line) && start.line >= 0 ? start.line : undefined;
  const endLine = typeof end?.line === "number" && Number.isInteger(end.line) && end.line >= 0 ? end.line : undefined;
  if (startLine === undefined || endLine === undefined) {
    return undefined;
  }
  return `lines ${startLine}-${endLine}`;
}

function safeSummary(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n]+/g, " ").trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > 220 ? `${safe.slice(0, 220)}…` : safe;
}

export function evaluateControlledAgentEditExecutor(
  input: unknown,
): ControlledAgentEditExecutorSummary {
  const summary: ControlledAgentEditExecutorSummary = {
    state: "disabled",
    canApplyControlledEdit: false,
    canCreateFiles: false,
    canDeleteFiles: false,
    canRenameFiles: false,
    canRunCommands: false,
    diagnostics: [],
    touchedFileLabels: [],
    editCount: 0,
    replacementByteCount: 0,
    replacementHashLabels: [],
    expectedContentHashLabels: [],
    rangeLabels: [],
    summary: "Controlled edit metadata is unavailable.",
  };

  if (input === undefined) {
    summary.diagnostics.push("missing_input");
    return summary;
  }

  if (!isRecord(input)) {
    summary.state = "blocked";
    summary.diagnostics.push("missing_or_malformed_input");
    summary.summary = "Controlled edit metadata is malformed.";
    return summary;
  }

  for (const field of forbiddenTopLevelFields) {
    if (field in input) {
      summary.diagnostics.push(`forbidden_top_level_field:${field}`);
    }
  }

  if (allowedStates.has(input.state as ControlledAgentEditExecutorState)) {
    summary.state = input.state as ControlledAgentEditExecutorState;
  } else {
    summary.state = "blocked";
    summary.diagnostics.push("missing_or_invalid_state");
  }

  summary.summary = safeSummary(input.summary ?? input.message, `Controlled edit ${summary.state} metadata is visible.`);

  if (!Array.isArray(input.edits)) {
    summary.diagnostics.push("missing_or_malformed_edits");
    summary.canApplyControlledEdit = false;
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

    if (typeof edit.replacement === "string") {
      summary.diagnostics.push(`raw_replacement_body_omitted:${index}`);
      return false;
    }

    const expectedContentHash = safeHashLabel(edit.expectedContentHash);
    if (!expectedContentHash) {
      summary.diagnostics.push(`missing_expected_content_hash:${index}`);
      return false;
    }

    const replacementHash = safeHashLabel(edit.replacementHash);
    if (!replacementHash) {
      summary.diagnostics.push(`missing_replacement_hash:${index}`);
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

    summary.touchedFileLabels.push(sanitizeDisplayText(edit.workspaceRelativePath));
    summary.expectedContentHashLabels.push(expectedContentHash);
    summary.replacementHashLabels.push(replacementHash);
    const rangeLabel = safeRangeLabel(edit);
    if (rangeLabel) {
      summary.rangeLabels.push(rangeLabel);
    }
    summary.replacementByteCount += getReplacementByteCount(edit);
    return true;
  });

  summary.editCount = input.edits.length;
  summary.canApplyControlledEdit =
    summary.diagnostics.length === 0 && validEdits && summary.state === "planned";

  return summary;
}
