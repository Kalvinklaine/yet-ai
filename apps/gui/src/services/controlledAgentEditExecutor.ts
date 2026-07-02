import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ControlledAgentEditExecutorState = "disabled" | "planned" | "applied" | "blocked" | "failed";

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

const allowedTopLevelFields = new Set([
  "type",
  "schemaVersion",
  "state",
  "runId",
  "workspaceReadinessId",
  "requestId",
  "requestIdMintedBy",
  "userConfirmed",
  "limits",
  "edits",
]);

const forbiddenTopLevelFields = new Set([
  "assistantAuthority",
  "authority",
  "autoApply",
  "autoRun",
  "autoRepair",
  "binary",
  "body",
  "bridge",
  "chmod",
  "command",
  "cwd",
  "diff",
  "env",
  "fileBody",
  "fileContent",
  "git",
  "patch",
  "provider",
  "rawBody",
  "rawDiff",
  "rawPatch",
  "replacement",
  "runtime",
  "shell",
  "symlink",
  "tool",
]);

const allowedEditFields = new Set([
  "operation",
  "workspaceRelativePath",
  "fileLabel",
  "expectedContentHash",
  "startLine",
  "endLine",
  "replacementByteCount",
  "sanitizedSummary",
]);

const forbiddenEditFields = new Set([
  "binary",
  "body",
  "chmod",
  "command",
  "create",
  "cwd",
  "delete",
  "diff",
  "env",
  "fileBody",
  "fileContent",
  "git",
  "move",
  "patch",
  "provider",
  "rawBody",
  "rawDiff",
  "rawPatch",
  "rename",
  "replacement",
  "replacementHash",
  "shell",
  "symlink",
  "tool",
]);

const allowedStates = new Set<ControlledAgentEditExecutorState>(["disabled", "planned", "applied", "blocked", "failed"]);
const allowedRequestIdMinters = new Set(["gui", "host", "runtime"]);
const workspaceRelativePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const sha256HashPattern = /^sha256:[a-f0-9]{64}$/;
const safeIdPattern = /^(?!assistant(?:[._:-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._:-]*$/i;
const unsafeTextPattern = /api[-_ ]?key|authorization|bearer|cookie|token|secret|password|raw[-_ ]?(?:file|body|patch|diff|command)|file[-_ ]?(?:body|content)|provider|shell|command|cwd|env|git|tool|chmod|symlink|binary|create|delete|rename|move|auto[-_ ]?(?:apply|run|repair)|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/users(?=\/|$|[^A-Za-z0-9_])|\/home(?=\/|$|[^A-Za-z0-9_])|\/tmp(?=\/|$|[^A-Za-z0-9_])|\/var(?=\/|$|[^A-Za-z0-9_])|\/etc(?=\/|$|[^A-Za-z0-9_])|\/private(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)|begin [A-Za-z ]*private key/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && safeIdPattern.test(value);
}

function isSafeWorkspaceRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 180 && workspaceRelativePathPattern.test(value);
}

function isSha256Hash(value: unknown): value is string {
  return typeof value === "string" && sha256HashPattern.test(value);
}

function isSafeDisplayString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !unsafeTextPattern.test(value);
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function safeSummary(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n]+/g, " ").trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > 220 ? `${safe.slice(0, 220)}…` : safe;
}

function validateLimits(value: unknown, diagnostics: string[]): boolean {
  if (!isRecord(value)) {
    diagnostics.push("missing_or_malformed_limits");
    return false;
  }

  const allowedLimitFields = new Set(["maxFiles", "maxEdits", "maxPatchBytes"]);
  let valid = true;
  for (const field of Object.keys(value)) {
    if (!allowedLimitFields.has(field)) {
      diagnostics.push(`forbidden_limits_field:${field}`);
      valid = false;
    }
  }
  if (!isBoundedInteger(value.maxFiles, 1, 50)) {
    diagnostics.push("invalid_limit:maxFiles");
    valid = false;
  }
  if (!isBoundedInteger(value.maxEdits, 1, 500)) {
    diagnostics.push("invalid_limit:maxEdits");
    valid = false;
  }
  if (!isBoundedInteger(value.maxPatchBytes, 1, 1048576)) {
    diagnostics.push("invalid_limit:maxPatchBytes");
    valid = false;
  }
  return valid;
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

  for (const field of Object.keys(input)) {
    if (!allowedTopLevelFields.has(field) || forbiddenTopLevelFields.has(field)) {
      summary.diagnostics.push(`forbidden_top_level_field:${field}`);
    }
  }

  if (input.type !== "controlled_agent_edit_executor") {
    summary.diagnostics.push("missing_or_invalid_type");
  }
  if (input.schemaVersion !== "2026-07-02") {
    summary.diagnostics.push("missing_or_invalid_schema_version");
  }
  if (!isSafeId(input.runId)) {
    summary.diagnostics.push("missing_or_invalid_run_id");
  }
  if (!isSafeId(input.workspaceReadinessId)) {
    summary.diagnostics.push("missing_or_invalid_workspace_readiness_id");
  }
  if (!isSafeId(input.requestId)) {
    summary.diagnostics.push("missing_or_invalid_request_id");
  }
  if (!allowedRequestIdMinters.has(input.requestIdMintedBy as string)) {
    summary.diagnostics.push("missing_or_invalid_request_id_minter");
  }
  if (input.userConfirmed !== true && input.state !== "disabled") {
    summary.diagnostics.push("missing_user_confirmation");
  }

  if (allowedStates.has(input.state as ControlledAgentEditExecutorState)) {
    summary.state = input.state as ControlledAgentEditExecutorState;
  } else {
    summary.state = "blocked";
    summary.diagnostics.push("missing_or_invalid_state");
  }

  summary.summary = `Controlled edit ${summary.state} metadata is visible.`;

  const limitsValid = validateLimits(input.limits, summary.diagnostics);

  if (!Array.isArray(input.edits)) {
    summary.diagnostics.push("missing_or_malformed_edits");
    return summary;
  }

  summary.editCount = input.edits.length;
  if (input.edits.length > 500) {
    summary.diagnostics.push("too_many_edits");
  }

  const validEdits = input.edits.every((edit, index) => {
    if (!isRecord(edit)) {
      summary.diagnostics.push(`malformed_edit:${index}`);
      return false;
    }

    let valid = true;
    for (const field of Object.keys(edit)) {
      if (!allowedEditFields.has(field) || forbiddenEditFields.has(field)) {
        summary.diagnostics.push(`forbidden_edit_field:${index}:${field}`);
        valid = false;
      }
    }

    if (edit.operation !== "replace") {
      summary.diagnostics.push(`unsupported_operation:${index}`);
      valid = false;
    }

    if (!isSafeWorkspaceRelativePath(edit.workspaceRelativePath)) {
      summary.diagnostics.push(`unsafe_workspace_relative_path:${index}`);
      valid = false;
    }

    if (!isSafeDisplayString(edit.fileLabel, 160)) {
      summary.diagnostics.push(`missing_or_unsafe_file_label:${index}`);
      valid = false;
    }

    if (!isSha256Hash(edit.expectedContentHash)) {
      summary.diagnostics.push(`missing_expected_content_hash:${index}`);
      valid = false;
    }

    if (!isBoundedInteger(edit.startLine, 1, 1000000) || !isBoundedInteger(edit.endLine, 1, 1000000)) {
      summary.diagnostics.push(`missing_or_invalid_range:${index}`);
      valid = false;
    } else if (edit.endLine < edit.startLine) {
      summary.diagnostics.push(`reversed_range:${index}`);
      valid = false;
    }

    if (!isBoundedInteger(edit.replacementByteCount, 0, 1048576)) {
      summary.diagnostics.push(`missing_or_invalid_replacement_byte_count:${index}`);
      valid = false;
    }

    if (!isSafeDisplayString(edit.sanitizedSummary, 240)) {
      summary.diagnostics.push(`missing_or_unsafe_sanitized_summary:${index}`);
      valid = false;
    }

    if (!valid) {
      return false;
    }

    const fileLabel = edit.fileLabel as string;
    const expectedContentHash = edit.expectedContentHash as string;
    const startLine = edit.startLine as number;
    const endLine = edit.endLine as number;
    const replacementByteCount = edit.replacementByteCount as number;
    summary.touchedFileLabels.push(sanitizeDisplayText(fileLabel));
    summary.expectedContentHashLabels.push(expectedContentHash);
    summary.rangeLabels.push(`lines ${startLine}-${endLine}`);
    summary.replacementByteCount += replacementByteCount;
    summary.summary = safeSummary(edit.sanitizedSummary, summary.summary);
    return true;
  });

  if (limitsValid && isRecord(input.limits)) {
    const maxFiles = input.limits.maxFiles;
    const maxEdits = input.limits.maxEdits;
    const maxPatchBytes = input.limits.maxPatchBytes;
    if (typeof maxFiles === "number" && summary.touchedFileLabels.length > maxFiles) {
      summary.diagnostics.push("max_files_exceeded");
    }
    if (typeof maxEdits === "number" && summary.editCount > maxEdits) {
      summary.diagnostics.push("max_edits_exceeded");
    }
    if (typeof maxPatchBytes === "number" && summary.replacementByteCount > maxPatchBytes) {
      summary.diagnostics.push("max_patch_bytes_exceeded");
    }
  }

  summary.canApplyControlledEdit =
    summary.diagnostics.length === 0 && validEdits && summary.state === "planned";

  return summary;
}
