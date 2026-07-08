import { isRawContentLikeKey, isSecretLikeKey, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ControlledAgentMultifilePatchPlanState = "ready" | "rejected" | "blocked";

export type ControlledAgentMultifilePatchPlanDiagnosticCode =
  | "malformed_input"
  | "unsafe_metadata"
  | "unsupported_authority"
  | "unsupported_operation"
  | "missing_hash"
  | "over_budget";

export type ControlledAgentMultifilePatchPlanDiagnostic = {
  code: ControlledAgentMultifilePatchPlanDiagnosticCode;
  message: string;
};

export type ControlledAgentMultifilePatchPlanEditPreview = {
  editId: string;
  operation: "replace";
  rangeLabel: string;
  startLine: number;
  endLine: number;
  expectedRangeHashLabel: string;
  replacementByteCount: number;
  replacementSummary: string;
};

export type ControlledAgentMultifilePatchPlanFilePreview = {
  workspaceRelativePath: string;
  fileLabel: string;
  fileSummary: string;
  riskLabel: "low" | "medium" | "high";
  expectedPreEditHashLabel: string;
  editCount: number;
  replacementByteTotal: number;
  edits: ControlledAgentMultifilePatchPlanEditPreview[];
};

export type ControlledAgentMultifilePatchPlanPreview = {
  kind: "controlled_agent_multifile_patch_plan";
  planId: string;
  status: "review_pending";
  workspaceLabel: string;
  summary: string;
  fileCount: number;
  editCount: number;
  totalReplacementBytes: number;
  touchedPathLabels: string[];
  files: ControlledAgentMultifilePatchPlanFilePreview[];
  budgets: {
    maxFiles: number;
    maxEdits: number;
    maxReplacementBytesPerEdit: number;
    maxTotalReplacementBytes: number;
  };
  metadataOnly: true;
  reviewOnly: true;
  dryRunOnly: true;
  automaticApplyAllowed: false;
  assistantMintedApplyAllowed: false;
};

export type ControlledAgentMultifilePatchPlanResult =
  | { state: "ready"; preview: ControlledAgentMultifilePatchPlanPreview; diagnostics: [] }
  | { state: "rejected" | "blocked"; diagnostics: ControlledAgentMultifilePatchPlanDiagnostic[] };

const planKind = "controlled_agent_multifile_patch_plan";
const planVersion = "2026-07-07";
const planAuthority = "review_only_multifile_replacement_metadata";
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const safeIdPattern = /^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/i;
const workspacePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const unsafeTextPattern = /api[-_ ]?key|authorization|bearer|cookie|token|secret|password|raw[-_ ]?(?:prompt|payload|response|file|body|diff|patch|command|output)|file[-_ ]?(?:body|content)|provider(?:[-_ ]?(?:payload|response))?|tool[-_ ]?call|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|network|package[-_ ]?install|hidden[-_ ]?(?:scan|read|search)|index(?:ing)?|auto[-_ ]?(?:start|apply|run|verify|fix|repair)|apply[-_ ]?patch|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)|begin [A-Za-z ]*private key/i;
const rawKeyPattern = /^(?:raw|rawdiff|rawdiffs|raw_diff|raw_diffs|diff|patch|rawpatch|raw_patch|rawreplacement|rawreplacements|raw_replacement|raw_replacements|replacementbody|replacementbodies|replacement_body|replacement_bodies|filebody|file_body|filecontent|file_content|filecontents|file_contents|providerpayload|provider_payload|providerresponse|provider_response)$/i;
const authorityKeyPattern = /^(?:command|commands|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providertool|provider_tool|tool|tools|toolcall|tool_call|packageinstall|package_install|hiddenread|hidden_read|hiddensearch|hidden_search|search|glob|regex|index|indexing|autostart|auto_start|autoapply|auto_apply|autorun|auto_run|autoverify|auto_verify|autofix|auto_fix|autorepair|auto_repair|applypatch|apply_patch|browserstorage|browser_storage|localstorage|local_storage|persistence)$/i;
const allowedRootKeys = ["kind", "version", "authority", "cloudRequired", "reviewOnly", "applyAuthority", "workspace", "limits", "plan", "policyFlags"] as const;
const allowedApplyAuthorityKeys = ["automaticApplyAllowed", "assistantMintedApplyAllowed", "requiresFutureExplicitHostApply", "modelMintedApplyAuthorityAllowed"] as const;
const allowedWorkspaceKeys = ["controlledWorkspaceId", "runId", "workspaceMode", "host", "privatePathExposed", "workspaceLabel"] as const;
const allowedLimitKeys = ["maxFiles", "maxEdits", "maxReplacementBytesPerEdit", "maxTotalReplacementBytes"] as const;
const allowedPlanKeys = ["planId", "status", "summary", "fileCount", "editCount", "totalReplacementBytes", "files"] as const;
const allowedFileKeys = ["workspaceRelativePath", "fileLabel", "existingTextFileRequired", "expectedPreEditHash", "fileSummary", "riskLabel", "edits"] as const;
const allowedEditKeys = ["editId", "operation", "range", "expectedRangeHash", "replacementByteCount", "replacementSummary", "rawReplacementIncluded", "rawDiffIncluded"] as const;
const allowedRangeKeys = ["startLine", "endLine"] as const;
const allowedPolicyKeys = ["metadataOnly", "reviewOnly", "existingFileReplacementOnly", "rawReplacementBodiesAllowed", "rawDiffsAllowed", "rawBodiesInReportExportHistoryAllowed", "createAllowed", "deleteAllowed", "renameAllowed", "moveAllowed", "chmodAllowed", "binaryEditAllowed", "symlinkEditAllowed", "generatedFileEditAllowed", "dependencyEditAllowed", "hiddenPathEditAllowed", "privatePathAllowed", "assistantMintedApplyAllowed", "modelMintedApplyAuthorityAllowed", "automaticApplyAllowed", "commandExecutionAllowed", "providerToolCallingAllowed", "localToolAuthorityAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "packageInstallAllowed"] as const;
const falsePolicyKeys = ["rawReplacementBodiesAllowed", "rawDiffsAllowed", "rawBodiesInReportExportHistoryAllowed", "createAllowed", "deleteAllowed", "renameAllowed", "moveAllowed", "chmodAllowed", "binaryEditAllowed", "symlinkEditAllowed", "generatedFileEditAllowed", "dependencyEditAllowed", "hiddenPathEditAllowed", "privatePathAllowed", "assistantMintedApplyAllowed", "modelMintedApplyAuthorityAllowed", "automaticApplyAllowed", "commandExecutionAllowed", "providerToolCallingAllowed", "localToolAuthorityAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "packageInstallAllowed"] as const;

type Limits = {
  maxFiles: number;
  maxEdits: number;
  maxReplacementBytesPerEdit: number;
  maxTotalReplacementBytes: number;
};

type PlanEdit = {
  editId: string;
  operation: "replace";
  range: { startLine: number; endLine: number };
  expectedRangeHash: string;
  replacementByteCount: number;
  replacementSummary: string;
  rawReplacementIncluded: false;
  rawDiffIncluded: false;
};

type PlanFile = {
  workspaceRelativePath: string;
  fileLabel: string;
  existingTextFileRequired: true;
  expectedPreEditHash: string;
  fileSummary: string;
  riskLabel: "low" | "medium" | "high";
  edits: PlanEdit[];
};

type ValidatedPlan = {
  planId: string;
  status: "review_pending";
  workspaceLabel: string;
  summary: string;
  fileCount: number;
  editCount: number;
  totalReplacementBytes: number;
  limits: Limits;
  files: PlanFile[];
};

export function evaluateControlledAgentMultifilePatchPlan(input: unknown): ControlledAgentMultifilePatchPlanResult {
  const parsed = parseInput(input);
  if (!parsed.ok) {
    return rejected("malformed_input", "Multi-file patch plan metadata must be one JSON object.");
  }
  if (parsed.value.kind !== planKind) {
    return rejected("malformed_input", "Multi-file patch plan metadata does not use the supported kind.");
  }
  const unsafeReason = findUnsafeMetadataReason(parsed.value);
  if (unsafeReason) {
    return blocked("unsafe_metadata", unsafeReason);
  }
  const validated = validatePlan(parsed.value);
  if ("code" in validated) {
    return validated.blocked ? blocked(validated.code, validated.message) : rejected(validated.code, validated.message);
  }
  return {
    state: "ready",
    preview: {
      kind: planKind,
      planId: safeLine(validated.planId, "multifile-plan"),
      status: validated.status,
      workspaceLabel: safeLine(validated.workspaceLabel, "controlled workspace"),
      summary: safeLine(validated.summary, "Multi-file patch plan is ready for review."),
      fileCount: validated.fileCount,
      editCount: validated.editCount,
      totalReplacementBytes: validated.totalReplacementBytes,
      touchedPathLabels: validated.files.map((file) => safeLine(file.fileLabel, "existing file")),
      files: validated.files.map(fileToPreview),
      budgets: validated.limits,
      metadataOnly: true,
      reviewOnly: true,
      dryRunOnly: true,
      automaticApplyAllowed: false,
      assistantMintedApplyAllowed: false,
    },
    diagnostics: [],
  };
}

function parseInput(input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (isPlainObject(input)) {
    return { ok: true, value: input };
  }
  if (typeof input !== "string") {
    return { ok: false };
  }
  try {
    const parsed: unknown = JSON.parse(input);
    return isPlainObject(parsed) ? { ok: true, value: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function validatePlan(value: Record<string, unknown>): ValidatedPlan | { code: ControlledAgentMultifilePatchPlanDiagnosticCode; message: string; blocked?: boolean } {
  if (!hasOnlyKeys(value, allowedRootKeys)) {
    return { code: "unsafe_metadata", message: "Multi-file patch plan contains unsupported root metadata fields.", blocked: true };
  }
  if (value.version !== planVersion || value.authority !== planAuthority || value.cloudRequired !== false || value.reviewOnly !== true) {
    return { code: "unsupported_authority", message: "Multi-file patch plan must be review-only metadata without cloud or execution authority.", blocked: true };
  }
  if (!isApplyAuthority(value.applyAuthority)) {
    return { code: "unsupported_authority", message: "Multi-file patch plan must not include assistant-minted or automatic apply authority.", blocked: true };
  }
  if (!isWorkspace(value.workspace)) {
    return { code: "malformed_input", message: "Multi-file patch plan workspace metadata is malformed or unsafe." };
  }
  if (!isLimits(value.limits)) {
    return { code: "over_budget", message: "Multi-file patch plan limits are missing or outside supported preview budgets.", blocked: true };
  }
  if (!isPolicyFlags(value.policyFlags)) {
    return { code: "unsupported_authority", message: "Multi-file patch plan policy flags must deny unsafe operations and authority claims.", blocked: true };
  }
  const operationReason = findUnsafeOperationReason(value.plan);
  if (operationReason) {
    return { code: "unsupported_operation", message: operationReason, blocked: true };
  }
  const hashReason = findMissingHashReason(value.plan);
  if (hashReason) {
    return { code: "missing_hash", message: hashReason, blocked: true };
  }
  if (!isPlan(value.plan)) {
    return { code: "malformed_input", message: "Multi-file patch plan file or edit metadata is malformed or unsafe." };
  }
  const budgetReason = findBudgetReason(value.plan, value.limits);
  if (budgetReason) {
    return { code: "over_budget", message: budgetReason, blocked: true };
  }
  return {
    planId: value.plan.planId,
    status: value.plan.status,
    workspaceLabel: value.workspace.workspaceLabel ?? "controlled workspace",
    summary: value.plan.summary,
    fileCount: value.plan.fileCount,
    editCount: value.plan.editCount,
    totalReplacementBytes: value.plan.totalReplacementBytes,
    limits: value.limits,
    files: value.plan.files,
  };
}

function isApplyAuthority(value: unknown): value is Record<string, false | true> {
  return isPlainObject(value) && hasOnlyKeys(value, allowedApplyAuthorityKeys) && value.automaticApplyAllowed === false && value.assistantMintedApplyAllowed === false && value.requiresFutureExplicitHostApply === true && value.modelMintedApplyAuthorityAllowed === false;
}

function isWorkspace(value: unknown): value is { workspaceLabel?: string } {
  return isPlainObject(value) && hasOnlyKeys(value, allowedWorkspaceKeys) && safeId(value.controlledWorkspaceId) && safeId(value.runId) && (value.workspaceMode === "disposable" || value.workspaceMode === "worktree" || value.workspaceMode === "existing") && (value.host === "vscode" || value.host === "jetbrains") && value.privatePathExposed === false && (value.workspaceLabel === undefined || safeText(value.workspaceLabel, 1, 120));
}

function isLimits(value: unknown): value is Limits {
  return isPlainObject(value) && hasOnlyKeys(value, allowedLimitKeys) && boundedInt(value.maxFiles, 1, 3) && boundedInt(value.maxEdits, 1, 6) && boundedInt(value.maxReplacementBytesPerEdit, 1, 800) && boundedInt(value.maxTotalReplacementBytes, 1, 1600);
}

function isPolicyFlags(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedPolicyKeys)) {
    return false;
  }
  return value.metadataOnly === true && value.reviewOnly === true && value.existingFileReplacementOnly === true && falsePolicyKeys.every((key) => value[key] === false);
}

function isPlan(value: unknown): value is { planId: string; status: "review_pending"; summary: string; fileCount: number; editCount: number; totalReplacementBytes: number; files: PlanFile[] } {
  return isPlainObject(value) && hasOnlyKeys(value, allowedPlanKeys) && safeId(value.planId) && value.status === "review_pending" && safeText(value.summary, 1, 240) && boundedInt(value.fileCount, 1, 3) && boundedInt(value.editCount, 1, 6) && boundedInt(value.totalReplacementBytes, 1, 1600) && Array.isArray(value.files) && value.files.length >= 1 && value.files.length <= 3 && value.files.every(isPlanFile);
}

function isPlanFile(value: unknown): value is PlanFile {
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedFileKeys)) {
    return false;
  }
  return safeWorkspacePath(value.workspaceRelativePath) && safeText(value.fileLabel, 1, 120) && value.fileLabel === value.workspaceRelativePath && value.existingTextFileRequired === true && typeof value.expectedPreEditHash === "string" && hashPattern.test(value.expectedPreEditHash) && safeText(value.fileSummary, 1, 160) && (value.riskLabel === "low" || value.riskLabel === "medium" || value.riskLabel === "high") && Array.isArray(value.edits) && value.edits.length >= 1 && value.edits.length <= 6 && value.edits.every(isPlanEdit);
}

function isPlanEdit(value: unknown): value is PlanEdit {
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedEditKeys) || !isPlainObject(value.range) || !hasOnlyKeys(value.range, allowedRangeKeys)) {
    return false;
  }
  return safeId(value.editId) && value.operation === "replace" && boundedInt(value.range.startLine, 1, 1000000) && boundedInt(value.range.endLine, 1, 1000000) && value.range.endLine >= value.range.startLine && typeof value.expectedRangeHash === "string" && hashPattern.test(value.expectedRangeHash) && boundedInt(value.replacementByteCount, 1, 800) && safeText(value.replacementSummary, 1, 160) && value.rawReplacementIncluded === false && value.rawDiffIncluded === false;
}

function findUnsafeOperationReason(value: unknown): string | null {
  if (!isPlainObject(value) || !Array.isArray(value.files)) {
    return null;
  }
  for (const file of value.files.slice(0, 6)) {
    if (!isPlainObject(file)) {
      continue;
    }
    if (file.existingTextFileRequired !== true) {
      return "Multi-file patch plan only supports existing text file replacements.";
    }
    if (!Array.isArray(file.edits)) {
      continue;
    }
    for (const edit of file.edits.slice(0, 10)) {
      if (!isPlainObject(edit)) {
        continue;
      }
      if (edit.operation !== "replace") {
        return "Multi-file patch plan only supports replace operations.";
      }
      if (edit.rawReplacementIncluded !== false || edit.rawDiffIncluded !== false) {
        return "Multi-file patch plan must not include raw replacement bodies or raw diffs.";
      }
    }
  }
  return null;
}

function findMissingHashReason(value: unknown): string | null {
  if (!isPlainObject(value) || !Array.isArray(value.files)) {
    return null;
  }
  for (const file of value.files.slice(0, 6)) {
    if (!isPlainObject(file)) {
      continue;
    }
    if (typeof file.expectedPreEditHash !== "string" || !hashPattern.test(file.expectedPreEditHash)) {
      return "Multi-file patch plan files require expected pre-edit hashes.";
    }
    if (!Array.isArray(file.edits)) {
      continue;
    }
    for (const edit of file.edits.slice(0, 10)) {
      if (isPlainObject(edit) && (typeof edit.expectedRangeHash !== "string" || !hashPattern.test(edit.expectedRangeHash))) {
        return "Multi-file patch plan edits require expected range hashes.";
      }
    }
  }
  return null;
}

function findBudgetReason(plan: { fileCount: number; editCount: number; totalReplacementBytes: number; files: PlanFile[] }, limits: Limits): string | null {
  const actualFileCount = plan.files.length;
  const actualEditCount = plan.files.reduce((sum, file) => sum + file.edits.length, 0);
  const actualBytes = plan.files.reduce((sum, file) => sum + file.edits.reduce((fileSum, edit) => fileSum + edit.replacementByteCount, 0), 0);
  if (plan.fileCount !== actualFileCount || actualFileCount > limits.maxFiles) {
    return "Multi-file patch plan exceeds the file preview budget.";
  }
  if (plan.editCount !== actualEditCount || actualEditCount > limits.maxEdits) {
    return "Multi-file patch plan exceeds the edit preview budget.";
  }
  if (plan.totalReplacementBytes !== actualBytes || actualBytes > limits.maxTotalReplacementBytes) {
    return "Multi-file patch plan exceeds the replacement byte preview budget.";
  }
  if (plan.files.some((file) => file.edits.some((edit) => edit.replacementByteCount > limits.maxReplacementBytesPerEdit))) {
    return "Multi-file patch plan exceeds the per-edit replacement byte preview budget.";
  }
  return null;
}

function findUnsafeMetadataReason(value: unknown, depth = 0, seen = new WeakSet<object>()): string | null {
  if (depth > 8) {
    return null;
  }
  if (typeof value === "string") {
    return unsafeTextPattern.test(value) ? "Multi-file patch plan contains unsafe text metadata." : null;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    for (const item of value.slice(0, 50)) {
      const reason = findUnsafeMetadataReason(item, depth + 1, seen);
      if (reason) {
        return reason;
      }
    }
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    const normalized = normalizeKey(key);
    if (isSecretLikeKey(key) || isRawContentLikeKey(key) || rawKeyPattern.test(normalized)) {
      return "Multi-file patch plan contains raw replacement, raw diff, raw file, or secret-like metadata.";
    }
    if (!isAllowedAuthorityKey(key) && authorityKeyPattern.test(normalized)) {
      return "Multi-file patch plan contains unsupported command, provider, tool, persistence, or authority metadata.";
    }
    const reason = findUnsafeMetadataReason(item, depth + 1, seen);
    if (reason) {
      return reason;
    }
  }
  return null;
}

function fileToPreview(file: PlanFile): ControlledAgentMultifilePatchPlanFilePreview {
  return {
    workspaceRelativePath: safeLine(file.workspaceRelativePath, "existing/file"),
    fileLabel: safeLine(file.fileLabel, "existing file"),
    fileSummary: safeLine(file.fileSummary, "Existing file replacement."),
    riskLabel: file.riskLabel,
    expectedPreEditHashLabel: hashLabel(file.expectedPreEditHash),
    editCount: file.edits.length,
    replacementByteTotal: file.edits.reduce((sum, edit) => sum + edit.replacementByteCount, 0),
    edits: file.edits.map(editToPreview),
  };
}

function editToPreview(edit: PlanEdit): ControlledAgentMultifilePatchPlanEditPreview {
  return {
    editId: safeLine(edit.editId, "edit"),
    operation: "replace",
    rangeLabel: `lines ${edit.range.startLine}-${edit.range.endLine}`,
    startLine: edit.range.startLine,
    endLine: edit.range.endLine,
    expectedRangeHashLabel: hashLabel(edit.expectedRangeHash),
    replacementByteCount: edit.replacementByteCount,
    replacementSummary: safeLine(edit.replacementSummary, "Bounded replacement."),
  };
}

function isAllowedAuthorityKey(key: string): boolean {
  return [...allowedApplyAuthorityKeys, ...allowedPolicyKeys].some((allowedKey) => allowedKey === key);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}

function safeText(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength && !hasControlCharacters(value) && !unsafeTextPattern.test(value);
}

function safeWorkspacePath(value: unknown): value is string {
  return typeof value === "string" && workspacePathPattern.test(value) && !unsafeTextPattern.test(value);
}

function boundedInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function normalizeKey(key: string): string {
  return key.replace(/[\s._-]+/g, "").toLowerCase();
}

function hashLabel(hash: string): string {
  return `${hash.slice(0, 18)}…`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(code: ControlledAgentMultifilePatchPlanDiagnosticCode, message: string): ControlledAgentMultifilePatchPlanDiagnostic {
  return { code, message: safeLine(message, "Multi-file patch plan metadata was blocked.") };
}

function rejected(code: ControlledAgentMultifilePatchPlanDiagnosticCode, message: string): ControlledAgentMultifilePatchPlanResult {
  return { state: "rejected", diagnostics: [diagnostic(code, message)] };
}

function blocked(code: ControlledAgentMultifilePatchPlanDiagnosticCode, message: string): ControlledAgentMultifilePatchPlanResult {
  return { state: "blocked", diagnostics: [diagnostic(code, message)] };
}

function safeLine(value: string, fallback: string): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
  return sanitized || fallback;
}
