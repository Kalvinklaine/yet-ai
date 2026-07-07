import { isRawContentLikeKey, isSecretLikeKey, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ControlledAgentPatchPlanPreviewState = "ready" | "rejected" | "blocked";

export type ControlledAgentPatchPlanPreviewDiagnosticCode =
  | "malformed_input"
  | "unsafe_metadata"
  | "unsupported_authority"
  | "unsupported_operation";

export type ControlledAgentPatchPlanPreviewDiagnostic = {
  code: ControlledAgentPatchPlanPreviewDiagnosticCode;
  message: string;
};

export type ControlledAgentPatchPlanPreviewRow = {
  operation: "replace";
  fileLabel: string;
  workspaceRelativePath: string;
  lineRangeLabel: string;
  replacementLabel: string;
  replacementByteCountLabel: string;
  expectedContentHashLabel: string;
  requiresUserApply: true;
};

export type ControlledAgentPatchPlanPreview = {
  kind: "controlled_agent_patch_plan";
  planId: string;
  workspaceLabel: string;
  summary: string;
  rows: ControlledAgentPatchPlanPreviewRow[];
  metadataOnly: true;
  reviewOnly: true;
  dryRunOnly: true;
  automaticApplyAllowed: false;
};

export type ControlledAgentPatchPlanPreviewResult =
  | { state: "ready"; preview: ControlledAgentPatchPlanPreview; diagnostics: [] }
  | { state: "rejected" | "blocked"; diagnostics: ControlledAgentPatchPlanPreviewDiagnostic[] };

const patchPlanKind = "controlled_agent_patch_plan";
const patchPlanVersion = "2026-07-07";
const patchPlanAuthority = "review_only_dry_run_metadata";
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const safeIdPattern = /^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/i;
const workspacePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const unsafeTextPattern = /api[-_ ]?key|authorization|bearer|cookie|token|secret|password|raw[-_ ]?(?:prompt|payload|response|file|body|diff|patch|command|output)|file[-_ ]?(?:body|content)|provider(?:[-_ ]?(?:tool|payload|response))?|tool[-_ ]?call|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|network|package[-_ ]?install|hidden[-_ ]?(?:scan|read|search)|index(?:ing)?|auto[-_ ]?(?:start|apply|run|verify|fix|repair)|apply[-_ ]?patch|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)|begin [A-Za-z ]*private key/i;
const rawKeyPattern = /^(?:raw|rawdiff|raw_diff|diff|patch|rawpatch|raw_patch|rawreplacement|raw_replacement|replacementbody|replacement_body|filebody|file_body|filecontent|file_content|filecontents|file_contents|providerpayload|provider_payload|providerresponse|provider_response)$/i;
const unsafeAuthorityKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|provider|providertool|provider_tool|tool|toolcall|tool_call|packageinstall|package_install|hiddenread|hidden_read|hiddensearch|hidden_search|search|glob|regex|index|indexing|autostart|auto_start|autoapply|auto_apply|autorun|auto_run|autoverify|auto_verify|autofix|auto_fix|autorepair|auto_repair|applypatch|apply_patch)$/i;
const allowedRootKeys = ["kind", "version", "authority", "cloudRequired", "executionAllowed", "reviewOnly", "dryRunOnly", "automaticApplyAllowed", "workspace", "patchPlan", "policyFlags"] as const;
const allowedWorkspaceKeys = ["controlledWorkspaceId", "runId", "workspaceMode", "host", "privatePathExposed", "workspaceLabel"] as const;
const allowedPatchPlanKeys = ["planId", "dryRunStatus", "summary", "candidates"] as const;
const allowedCandidateKeys = ["operation", "existingFileRequired", "workspaceRelativePath", "fileLabel", "expectedContentHash", "startLine", "endLine", "replacementByteCount", "replacementLabel", "rawReplacementStored", "rawDiffStored", "requiresUserApply"] as const;
const allowedPolicyKeys = ["metadataOnly", "reviewOnly", "dryRunOnly", "existingFileReplacementOnly", "rawDiffPersistenceAllowed", "rawFilePersistenceAllowed", "rawProviderPayloadPersistenceAllowed", "automaticApplyAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "packageInstallAllowed", "providerToolCallingAllowed", "toolAuthorityAllowed", "hiddenReadAllowed", "searchAllowed", "indexingAllowed", "createAllowed", "deleteAllowed", "renameAllowed", "moveAllowed", "chmodAllowed", "binaryEditAllowed", "symlinkEditAllowed", "directoryEditAllowed"] as const;
const forbiddenTruePolicyKeys = ["rawDiffPersistenceAllowed", "rawFilePersistenceAllowed", "rawProviderPayloadPersistenceAllowed", "automaticApplyAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "packageInstallAllowed", "providerToolCallingAllowed", "toolAuthorityAllowed", "hiddenReadAllowed", "searchAllowed", "indexingAllowed", "createAllowed", "deleteAllowed", "renameAllowed", "moveAllowed", "chmodAllowed", "binaryEditAllowed", "symlinkEditAllowed", "directoryEditAllowed"] as const;

type ReplacementCandidate = {
  operation: "replace";
  existingFileRequired: true;
  workspaceRelativePath: string;
  fileLabel: string;
  expectedContentHash: string;
  startLine: number;
  endLine: number;
  replacementByteCount: number;
  replacementLabel: string;
  rawReplacementStored: false;
  rawDiffStored: false;
  requiresUserApply: true;
};

type ValidatedPatchPlan = {
  planId: string;
  workspaceLabel: string;
  summary: string;
  candidates: ReplacementCandidate[];
};

export function evaluateControlledAgentPatchPlanPreview(input: unknown): ControlledAgentPatchPlanPreviewResult {
  const parsed = parseInput(input);
  if (!parsed.ok) {
    return rejected("malformed_input", "Patch plan preview metadata must be one JSON object.");
  }
  if (parsed.value.kind !== patchPlanKind) {
    return rejected("malformed_input", "Patch plan preview metadata does not use the supported controlled patch plan kind.");
  }
  const unsafeReason = findUnsafeMetadataReason(parsed.value);
  if (unsafeReason) {
    return blocked("unsafe_metadata", unsafeReason);
  }
  const validated = validatePatchPlan(parsed.value);
  if ("code" in validated) {
    return validated.blocked ? blocked(validated.code, validated.message) : rejected(validated.code, validated.message);
  }
  return {
    state: "ready",
    preview: {
      kind: patchPlanKind,
      planId: safeLine(validated.planId, "patch-plan"),
      workspaceLabel: safeLine(validated.workspaceLabel, "controlled workspace"),
      summary: safeLine(validated.summary, "Patch plan preview is ready for review."),
      rows: validated.candidates.slice(0, 3).map(candidateToRow),
      metadataOnly: true,
      reviewOnly: true,
      dryRunOnly: true,
      automaticApplyAllowed: false,
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

function validatePatchPlan(value: Record<string, unknown>): ValidatedPatchPlan | { code: ControlledAgentPatchPlanPreviewDiagnosticCode; message: string; blocked?: boolean } {
  if (!hasOnlyKeys(value, allowedRootKeys)) {
    return { code: "unsafe_metadata", message: "Patch plan preview contains unsupported root metadata fields.", blocked: true };
  }
  if (value.version !== patchPlanVersion || value.authority !== patchPlanAuthority || value.cloudRequired !== false || value.executionAllowed !== false || value.reviewOnly !== true || value.dryRunOnly !== true || value.automaticApplyAllowed !== false) {
    return { code: "unsupported_authority", message: "Patch plan preview must be review-only dry-run metadata with no execution or automatic apply authority.", blocked: true };
  }
  if (!isWorkspace(value.workspace)) {
    return { code: "malformed_input", message: "Patch plan preview workspace metadata is malformed or unsafe." };
  }
  const unsafeOperation = findUnsafeOperationReason(value.patchPlan);
  if (unsafeOperation) {
    return { code: "unsupported_operation", message: unsafeOperation, blocked: true };
  }
  if (!isPatchPlan(value.patchPlan)) {
    return { code: "malformed_input", message: "Patch plan preview candidate metadata is malformed or unsafe." };
  }
  if (!isPolicyFlags(value.policyFlags)) {
    return { code: "unsupported_authority", message: "Patch plan preview policy flags must deny unsafe operations and authority claims.", blocked: true };
  }
  return {
    planId: value.patchPlan.planId,
    workspaceLabel: value.workspace.workspaceLabel ?? "controlled workspace",
    summary: value.patchPlan.summary,
    candidates: value.patchPlan.candidates,
  };
}

function isWorkspace(value: unknown): value is { workspaceLabel?: string } {
  return isPlainObject(value) && hasOnlyKeys(value, allowedWorkspaceKeys) && safeId(value.controlledWorkspaceId) && safeId(value.runId) && (value.workspaceMode === "disposable" || value.workspaceMode === "worktree" || value.workspaceMode === "existing") && (value.host === "vscode" || value.host === "jetbrains") && value.privatePathExposed === false && (value.workspaceLabel === undefined || safeText(value.workspaceLabel, 1, 120));
}

function isPatchPlan(value: unknown): value is { planId: string; summary: string; candidates: ReplacementCandidate[] } {
  return isPlainObject(value) && hasOnlyKeys(value, allowedPatchPlanKeys) && safeId(value.planId) && value.dryRunStatus === "not_applied" && safeText(value.summary, 1, 240) && Array.isArray(value.candidates) && value.candidates.length >= 1 && value.candidates.length <= 3 && value.candidates.every(isReplacementCandidate);
}

function isReplacementCandidate(value: unknown): value is ReplacementCandidate {
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedCandidateKeys)) {
    return false;
  }
  return value.operation === "replace" && value.existingFileRequired === true && safeWorkspacePath(value.workspaceRelativePath) && safeText(value.fileLabel, 1, 120) && typeof value.expectedContentHash === "string" && hashPattern.test(value.expectedContentHash) && boundedInt(value.startLine, 1, 1000000) && boundedInt(value.endLine, 1, 1000000) && value.endLine >= value.startLine && boundedInt(value.replacementByteCount, 0, 12000) && safeText(value.replacementLabel, 1, 120) && value.rawReplacementStored === false && value.rawDiffStored === false && value.requiresUserApply === true;
}

function isPolicyFlags(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedPolicyKeys)) {
    return false;
  }
  return value.metadataOnly === true && value.reviewOnly === true && value.dryRunOnly === true && value.existingFileReplacementOnly === true && forbiddenTruePolicyKeys.every((key) => value[key] === false);
}

function findUnsafeOperationReason(value: unknown): string | null {
  if (!isPlainObject(value) || !Array.isArray(value.candidates)) {
    return null;
  }
  for (const candidate of value.candidates.slice(0, 3)) {
    if (!isPlainObject(candidate)) {
      continue;
    }
    if (candidate.operation !== "replace" || candidate.existingFileRequired !== true) {
      return "Patch plan preview only supports existing-file replacement candidates.";
    }
    if (candidate.requiresUserApply !== true) {
      return "Patch plan preview candidates must require explicit user apply.";
    }
  }
  return null;
}

function findUnsafeMetadataReason(value: unknown, depth = 0, seen = new WeakSet<object>()): string | null {
  if (depth > 8) {
    return null;
  }
  if (typeof value === "string") {
    return unsafeTextPattern.test(value) ? "Patch plan preview contains unsafe text metadata." : null;
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
    if (isSecretLikeKey(key) || isRawContentLikeKey(key) || rawKeyPattern.test(normalizeKey(key))) {
      return "Patch plan preview contains raw diff, raw file, or secret-like metadata.";
    }
    if (unsafeAuthorityKeyPattern.test(normalizeKey(key))) {
      return "Patch plan preview contains unsupported execution or authority metadata.";
    }
    const reason = findUnsafeMetadataReason(item, depth + 1, seen);
    if (reason) {
      return reason;
    }
  }
  return null;
}

function candidateToRow(candidate: ReplacementCandidate): ControlledAgentPatchPlanPreviewRow {
  return {
    operation: "replace",
    fileLabel: safeLine(candidate.fileLabel, "existing file"),
    workspaceRelativePath: safeLine(candidate.workspaceRelativePath, "existing/file"),
    lineRangeLabel: `lines ${candidate.startLine}-${candidate.endLine}`,
    replacementLabel: safeLine(candidate.replacementLabel, "bounded replacement"),
    replacementByteCountLabel: `${candidate.replacementByteCount} bytes`,
    expectedContentHashLabel: `${candidate.expectedContentHash.slice(0, 18)}…`,
    requiresUserApply: true,
  };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(code: ControlledAgentPatchPlanPreviewDiagnosticCode, message: string): ControlledAgentPatchPlanPreviewDiagnostic {
  return { code, message: safeLine(message, "Patch plan preview metadata was blocked.") };
}

function rejected(code: ControlledAgentPatchPlanPreviewDiagnosticCode, message: string): ControlledAgentPatchPlanPreviewResult {
  return { state: "rejected", diagnostics: [diagnostic(code, message)] };
}

function blocked(code: ControlledAgentPatchPlanPreviewDiagnosticCode, message: string): ControlledAgentPatchPlanPreviewResult {
  return { state: "blocked", diagnostics: [diagnostic(code, message)] };
}

function safeLine(value: string, fallback: string): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
  return sanitized || fallback;
}
