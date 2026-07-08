import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import { bridgeVersion } from "./identity";

export type ControlledAgentMultifileApplyGuiMessage = {
  version: string;
  type: "gui.controlledAgentMultifileApplyRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type ControlledAgentMultifileApplyHostMessage = {
  version: string;
  type: "host.controlledAgentMultifileApplyResult";
  requestId: string;
  payload: ControlledAgentMultifileApplyResultPayload;
};

type ControlledAgentMultifileApplyRequest = {
  requestId: string;
  requestIdMintedBy: "gui";
  source: "gui";
  assistantMinted: false;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  workspaceReadinessId: string;
  patchPlanId: string;
  userConfirmed: true;
  confirmationKind: "explicit_user_multifile_apply";
  limits: ControlledAgentMultifileApplyLimits;
  policy: ControlledAgentMultifileApplyPolicy;
  edits: ControlledAgentMultifileApplyEdit[];
};

type ControlledAgentMultifileApplyLimits = {
  maxFiles: number;
  maxEdits: number;
  maxReplacementBytesPerEdit: number;
  maxTotalReplacementBytes: number;
};

type ControlledAgentMultifileApplyPolicy = {
  host: "vscode";
  browserSupported: false;
  jetbrainsSupported: false;
  vscodeExecutionOnly: true;
  existingTextFilesOnly: true;
  boundedReplacementOnly: true;
  rawReplacementIncluded: false;
  rawDiffIncluded: false;
  fileBodyIncluded: false;
  createAllowed: false;
  deleteAllowed: false;
  renameAllowed: false;
  moveAllowed: false;
  dependencyEditAllowed: false;
  generatedEditAllowed: false;
  hiddenPathAllowed: false;
  commandAllowed: false;
  providerAllowed: false;
  toolAllowed: false;
  automaticApplyAllowed: false;
};

type ControlledAgentMultifileApplyEdit = {
  editId: string;
  operation: "replace";
  workspaceRelativePath: string;
  fileLabel: string;
  existingTextFile: true;
  expectedPreEditHash: string;
  expectedRangeHash: string;
  replacementContentHash: string;
  replacementText: string;
  startLine: number;
  endLine: number;
  replacementByteCount: number;
  sanitizedSummary: string;
};

type ControlledAgentMultifileApplyResultEdit = Omit<ControlledAgentMultifileApplyEdit, "replacementText" | "existingTextFile"> & {
  status: "applied" | "blocked" | "failed" | "skipped";
  actualPostEditHash: string;
  blockedReason?: ControlledAgentMultifileApplyBlockedReason;
};

type ControlledAgentMultifileApplyBlockedReason = "apply_disabled" | "policy_denied" | "unsupported_host" | "unsafe_path" | "outside_workspace" | "hidden_path" | "dependency_path" | "generated_path" | "unsupported_operation" | "missing_expected_hash" | "hash_mismatch" | "unconfirmed_request" | "assistant_minted" | "budget_exceeded" | "line_range_invalid";

type ControlledAgentMultifileApplyResultPayload = {
  type: "controlled_agent_multifile_apply";
  schemaVersion: "2026-07-07";
  state: "applied" | "blocked" | "failed" | "partial";
  authority: "vscode_bounded_multifile_replacement_apply";
  cloudRequired: false;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  workspaceReadinessId: string;
  requestId: string;
  requestIdMintedBy: "gui";
  userConfirmed: true;
  patchPlanId: string;
  limits: ControlledAgentMultifileApplyLimits;
  edits: ControlledAgentMultifileApplyResultEdit[];
  policyFlags: ControlledAgentMultifileApplyPolicy;
  result: {
    status: "applied" | "blocked" | "failed" | "partial";
    cloudRequired: false;
    privatePathExposed: false;
    rawReplacementIncluded: false;
    rawDiffIncluded: false;
    fileBodyIncluded: false;
    message: string;
    appliedFileCount: number;
    appliedEditCount: number;
    blockedFileCount: number;
    failedEditCount: number;
    affectedFiles?: string[];
    blockedReason?: ControlledAgentMultifileApplyBlockedReason;
  };
};

type ResolvedEdit = {
  edit: ControlledAgentMultifileApplyEdit;
  filePath: string;
  currentText: string;
  currentHash: string;
  replacementStart: number;
  replacementEnd: number;
};

type PreparedFile = {
  filePath: string;
  currentHash: string;
  nextText: string;
  edits: ResolvedEdit[];
  postHash: string;
};

const maxControlledAgentMultifileApplyFiles = 4;
const maxControlledAgentMultifileApplyEdits = 12;
const maxControlledAgentMultifileApplyReplacementBytes = 12000;
const maxControlledAgentMultifileApplyTotalReplacementBytes = 48000;
const maxControlledAgentMultifileApplyFileBytes = 2 * 1024 * 1024;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const dependencySegments = new Set(["node_modules", "vendor"]);
const generatedSegments = new Set(["dist", "build", "out", "target", "coverage", "__pycache__", "generated", "tmp", "temp"]);
const secretNamePattern = /^(?:secrets?|credentials?|private)$/i;
const secretSegmentPattern = /auth|credential|password|secret|token|access[_-]?token|api[_-]?key|^\.env$/i;
const unsafeTextPattern = /authorization|bearer|cookie|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|credential|private[_-]?path|BEGIN [A-Z ]*PRIVATE KEY|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i;
const rawDiffTextPattern = /(?:^|\n)(?:diff --git |@@ |--- |\+\+\+ )/;

export function isControlledAgentMultifileApplyGuiMessage(value: unknown): value is ControlledAgentMultifileApplyGuiMessage {
  return parseControlledAgentMultifileApplyRequest(value) !== undefined;
}

export function isInvalidControlledAgentMultifileApplyRequestMessage(value: unknown): value is ControlledAgentMultifileApplyGuiMessage & { requestId: string } {
  if (!isPlainRecord(value)) {
    return false;
  }
  return hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) &&
    value.version === bridgeVersion &&
    value.type === "gui.controlledAgentMultifileApplyRequest" &&
    isRequiredRequestId(value.requestId) &&
    parseControlledAgentMultifileApplyRequest(value) === undefined;
}

export async function runControlledAgentMultifileApplyRequest(message: ControlledAgentMultifileApplyGuiMessage, workspaceRoots: readonly string[]): Promise<ControlledAgentMultifileApplyHostMessage> {
  const parsed = parseControlledAgentMultifileApplyRequest(message);
  if (!parsed) {
    const requestId = isRequiredRequestId(message.requestId) ? message.requestId : "invalid-request";
    return createControlledAgentMultifileApplyHostMessage(createFallbackRequest(requestId), "blocked", "policy_denied", "Bounded multi-file replacements blocked by VS Code host policy.");
  }

  const budgetCheck = validateBudget(parsed);
  if (budgetCheck !== "ok") {
    return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", budgetCheck, "Bounded multi-file replacements blocked by VS Code host policy.");
  }

  const resolvedEdits: ResolvedEdit[] = [];
  for (const edit of parsed.edits) {
    const pathCheck = validateControlledAgentMultifileApplyPath(edit.workspaceRelativePath);
    if (pathCheck !== "ok") {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", pathCheck, "Bounded multi-file replacements blocked by VS Code host policy.");
    }
    const resolvedFile = await resolveControlledWorkspaceFile(edit.workspaceRelativePath, workspaceRoots);
    if (!resolvedFile.ok) {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", resolvedFile.reason, "Bounded multi-file replacements blocked by VS Code host policy.");
    }
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(resolvedFile.filePath);
    } catch {
      return createControlledAgentMultifileApplyHostMessage(parsed, "failed", "policy_denied", "Bounded multi-file replacement apply failed.");
    }
    if (bytes.byteLength !== resolvedFile.size || bytes.byteLength > maxControlledAgentMultifileApplyFileBytes || isBinaryBytes(bytes)) {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "policy_denied", "Bounded multi-file replacements blocked by VS Code host policy.");
    }
    let currentText: string;
    try {
      currentText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "policy_denied", "Bounded multi-file replacements blocked by VS Code host policy.");
    }
    if (hasBinaryLikeText(currentText) || unsafeTextPattern.test(currentText)) {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "policy_denied", "Bounded multi-file replacements blocked by VS Code host policy.");
    }
    const currentHash = hashBytes(bytes);
    if (currentHash !== edit.expectedPreEditHash) {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "hash_mismatch", "Bounded multi-file replacements blocked by VS Code host policy.", [{ edit, actualPostEditHash: currentHash }]);
    }
    const range = lineRangeOffsets(currentText, edit.startLine, edit.endLine);
    if (!range) {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "line_range_invalid", "Bounded multi-file replacements blocked by VS Code host policy.", [{ edit, actualPostEditHash: currentHash }]);
    }
    if (hashText(currentText.slice(range.start, range.end)) !== edit.expectedRangeHash) {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "hash_mismatch", "Bounded multi-file replacements blocked by VS Code host policy.", [{ edit, actualPostEditHash: currentHash }]);
    }
    resolvedEdits.push({ edit, filePath: resolvedFile.filePath, currentText, currentHash, replacementStart: range.start, replacementEnd: range.end });
  }

  const editGroups = groupResolvedEdits(resolvedEdits);
  for (const group of editGroups) {
    if (hasOverlappingResolvedEdits(group)) {
      return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "line_range_invalid", "Bounded multi-file replacements blocked by VS Code host policy.", resolvedEdits.map(({ edit, currentHash }) => ({ edit, actualPostEditHash: currentHash })));
    }
  }

  const preparedFiles: PreparedFile[] = [];
  for (const group of editGroups) {
    let nextText = group[0].currentText;
    for (const resolvedEdit of [...group].sort((left, right) => right.replacementStart - left.replacementStart)) {
      nextText = nextText.slice(0, resolvedEdit.replacementStart) + resolvedEdit.edit.replacementText + nextText.slice(resolvedEdit.replacementEnd);
    }
    preparedFiles.push({ filePath: group[0].filePath, currentHash: group[0].currentHash, nextText, edits: group, postHash: hashText(nextText) });
  }

  try {
    for (const preparedFile of preparedFiles) {
      const latestBytes = await fs.readFile(preparedFile.filePath);
      if (hashBytes(latestBytes) !== preparedFile.currentHash || isBinaryBytes(latestBytes)) {
        return createControlledAgentMultifileApplyHostMessage(parsed, "blocked", "hash_mismatch", "Bounded multi-file replacements blocked by VS Code host policy.", resolvedEdits.map(({ edit, currentHash }) => ({ edit, actualPostEditHash: currentHash })));
      }
    }
    for (const preparedFile of preparedFiles) {
      await fs.writeFile(preparedFile.filePath, preparedFile.nextText, "utf8");
    }
  } catch {
    return createControlledAgentMultifileApplyHostMessage(parsed, "failed", "policy_denied", "Bounded multi-file replacement apply failed.", resolvedEdits.map(({ edit, currentHash }) => ({ edit, actualPostEditHash: currentHash })));
  }

  return createControlledAgentMultifileApplyHostMessage(parsed, "applied", undefined, "Bounded multi-file replacements applied by VS Code host.", preparedFiles.flatMap((file) => file.edits.map(({ edit }) => ({ edit, actualPostEditHash: file.postHash }))));
}

export function parseControlledAgentMultifileApplyRequest(value: unknown): ControlledAgentMultifileApplyRequest | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) || value.version !== bridgeVersion || value.type !== "gui.controlledAgentMultifileApplyRequest" || !isRequiredRequestId(value.requestId) || !isPlainRecord(value.payload)) {
    return undefined;
  }
  const payload = value.payload;
  if (!hasOnlyKeys(payload, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "workspaceReadinessId", "patchPlanId", "userConfirmed", "confirmationKind", "limits", "policy", "edits"]) || payload.requestId !== value.requestId || !isSafeId(payload.requestId) || payload.requestIdMintedBy !== "gui" || payload.source !== "gui" || payload.assistantMinted !== false || !isSafeId(payload.controlledWorkspaceId) || !isSafeId(payload.runId) || (payload.runtimeSessionId !== undefined && !isSafeId(payload.runtimeSessionId)) || !isSafeId(payload.workspaceReadinessId) || !isSafeId(payload.patchPlanId) || payload.userConfirmed !== true || payload.confirmationKind !== "explicit_user_multifile_apply" || !isControlledAgentMultifileApplyLimits(payload.limits) || !isControlledAgentMultifileApplyPolicy(payload.policy) || !Array.isArray(payload.edits) || payload.edits.length < 1 || payload.edits.length > maxControlledAgentMultifileApplyEdits) {
    return undefined;
  }
  const edits: ControlledAgentMultifileApplyEdit[] = [];
  for (const edit of payload.edits) {
    if (!isControlledAgentMultifileApplyEdit(edit)) {
      return undefined;
    }
    edits.push(edit);
  }
  return {
    requestId: value.requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: payload.controlledWorkspaceId,
    runId: payload.runId,
    ...(payload.runtimeSessionId === undefined ? {} : { runtimeSessionId: payload.runtimeSessionId }),
    workspaceReadinessId: payload.workspaceReadinessId,
    patchPlanId: payload.patchPlanId,
    userConfirmed: true,
    confirmationKind: "explicit_user_multifile_apply",
    limits: payload.limits,
    policy: payload.policy,
    edits,
  };
}

function validateBudget(request: ControlledAgentMultifileApplyRequest): "ok" | ControlledAgentMultifileApplyBlockedReason {
  if (request.limits.maxFiles > maxControlledAgentMultifileApplyFiles || request.limits.maxEdits > maxControlledAgentMultifileApplyEdits || request.limits.maxReplacementBytesPerEdit > maxControlledAgentMultifileApplyReplacementBytes || request.limits.maxTotalReplacementBytes > maxControlledAgentMultifileApplyTotalReplacementBytes || request.edits.length > request.limits.maxEdits) {
    return "budget_exceeded";
  }
  const paths = new Set(request.edits.map((edit) => edit.workspaceRelativePath));
  if (paths.size > request.limits.maxFiles) {
    return "budget_exceeded";
  }
  let totalReplacementBytes = 0;
  for (const edit of request.edits) {
    if (edit.replacementByteCount > request.limits.maxReplacementBytesPerEdit) {
      return "budget_exceeded";
    }
    totalReplacementBytes += edit.replacementByteCount;
    if (totalReplacementBytes > request.limits.maxTotalReplacementBytes) {
      return "budget_exceeded";
    }
  }
  return "ok";
}

function createControlledAgentMultifileApplyHostMessage(request: ControlledAgentMultifileApplyRequest, state: "applied" | "blocked" | "failed", blockedReason: ControlledAgentMultifileApplyBlockedReason | undefined, message: string, resolvedEdits: { edit: ControlledAgentMultifileApplyEdit; actualPostEditHash?: string }[] = []): ControlledAgentMultifileApplyHostMessage {
  const affectedFiles = state === "applied" ? uniquePaths(request.edits.map((edit) => edit.workspaceRelativePath)) : undefined;
  return {
    version: bridgeVersion,
    type: "host.controlledAgentMultifileApplyResult",
    requestId: request.requestId,
    payload: {
      type: "controlled_agent_multifile_apply",
      schemaVersion: "2026-07-07",
      state,
      authority: "vscode_bounded_multifile_replacement_apply",
      cloudRequired: false,
      controlledWorkspaceId: request.controlledWorkspaceId,
      runId: request.runId,
      ...(request.runtimeSessionId === undefined ? {} : { runtimeSessionId: request.runtimeSessionId }),
      workspaceReadinessId: request.workspaceReadinessId,
      requestId: request.requestId,
      requestIdMintedBy: request.requestIdMintedBy,
      userConfirmed: true,
      patchPlanId: request.patchPlanId,
      limits: request.limits,
      edits: request.edits.map((edit) => sanitizeResultEdit(edit, state === "applied" ? "applied" : "blocked", resolvedEdits.find((entry) => entry.edit === edit)?.actualPostEditHash, state === "applied" ? undefined : blockedReason ?? "policy_denied")),
      policyFlags: createPolicyFlags(),
      result: {
        status: state,
        cloudRequired: false,
        privatePathExposed: false,
        rawReplacementIncluded: false,
        rawDiffIncluded: false,
        fileBodyIncluded: false,
        message,
        appliedFileCount: state === "applied" ? uniquePaths(request.edits.map((edit) => edit.workspaceRelativePath)).length : 0,
        appliedEditCount: state === "applied" ? request.edits.length : 0,
        blockedFileCount: state === "applied" ? 0 : uniquePaths(request.edits.map((edit) => edit.workspaceRelativePath)).length,
        failedEditCount: state === "failed" ? request.edits.length : 0,
        ...(affectedFiles ? { affectedFiles } : {}),
        ...(state === "applied" ? {} : { blockedReason: blockedReason ?? "policy_denied" }),
      },
    },
  };
}

function sanitizeResultEdit(edit: ControlledAgentMultifileApplyEdit, status: "applied" | "blocked" | "failed" | "skipped", actualPostEditHash: string | undefined, blockedReason: ControlledAgentMultifileApplyBlockedReason | undefined): ControlledAgentMultifileApplyResultEdit {
  return {
    editId: edit.editId,
    operation: "replace",
    workspaceRelativePath: edit.workspaceRelativePath,
    fileLabel: edit.fileLabel,
    status,
    expectedPreEditHash: edit.expectedPreEditHash,
    expectedRangeHash: edit.expectedRangeHash,
    replacementContentHash: edit.replacementContentHash,
    actualPostEditHash: actualPostEditHash ?? edit.expectedPreEditHash,
    startLine: edit.startLine,
    endLine: edit.endLine,
    replacementByteCount: edit.replacementByteCount,
    sanitizedSummary: edit.sanitizedSummary,
    ...(blockedReason === undefined ? {} : { blockedReason }),
  };
}

function createPolicyFlags(): ControlledAgentMultifileApplyPolicy {
  return {
    host: "vscode",
    browserSupported: false,
    jetbrainsSupported: false,
    vscodeExecutionOnly: true,
    existingTextFilesOnly: true,
    boundedReplacementOnly: true,
    rawReplacementIncluded: false,
    rawDiffIncluded: false,
    fileBodyIncluded: false,
    createAllowed: false,
    deleteAllowed: false,
    renameAllowed: false,
    moveAllowed: false,
    dependencyEditAllowed: false,
    generatedEditAllowed: false,
    hiddenPathAllowed: false,
    commandAllowed: false,
    providerAllowed: false,
    toolAllowed: false,
    automaticApplyAllowed: false,
  };
}

function createFallbackRequest(requestId: string): ControlledAgentMultifileApplyRequest {
  return {
    requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-apply-blocked",
    runId: "run-apply-blocked",
    workspaceReadinessId: "ready-apply-blocked",
    patchPlanId: "multifile-plan-blocked",
    userConfirmed: true,
    confirmationKind: "explicit_user_multifile_apply",
    limits: { maxFiles: 1, maxEdits: 1, maxReplacementBytesPerEdit: 1, maxTotalReplacementBytes: 1 },
    policy: createPolicyFlags(),
    edits: [{
      editId: "edit-blocked",
      operation: "replace",
      workspaceRelativePath: "blocked/edit.txt",
      fileLabel: "blocked/edit.txt",
      existingTextFile: true,
      expectedPreEditHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      expectedRangeHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      replacementContentHash: hashText(""),
      replacementText: "",
      startLine: 1,
      endLine: 1,
      replacementByteCount: 0,
      sanitizedSummary: "Bounded multi-file apply blocked by policy.",
    }],
  };
}

function isControlledAgentMultifileApplyLimits(value: unknown): value is ControlledAgentMultifileApplyLimits {
  return isPlainRecord(value) && hasOnlyKeys(value, ["maxFiles", "maxEdits", "maxReplacementBytesPerEdit", "maxTotalReplacementBytes"]) && boundedInteger(value.maxFiles, 1, maxControlledAgentMultifileApplyFiles) && boundedInteger(value.maxEdits, 1, maxControlledAgentMultifileApplyEdits) && boundedInteger(value.maxReplacementBytesPerEdit, 1, maxControlledAgentMultifileApplyReplacementBytes) && boundedInteger(value.maxTotalReplacementBytes, 1, maxControlledAgentMultifileApplyTotalReplacementBytes);
}

function isControlledAgentMultifileApplyPolicy(value: unknown): value is ControlledAgentMultifileApplyPolicy {
  const expected = createPolicyFlags();
  return isPlainRecord(value) && hasOnlyKeys(value, Object.keys(expected)) && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function isControlledAgentMultifileApplyEdit(value: unknown): value is ControlledAgentMultifileApplyEdit {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["editId", "operation", "workspaceRelativePath", "fileLabel", "existingTextFile", "expectedPreEditHash", "expectedRangeHash", "replacementContentHash", "replacementText", "startLine", "endLine", "replacementByteCount", "sanitizedSummary"])) {
    return false;
  }
  return isSafeId(value.editId) &&
    value.operation === "replace" &&
    typeof value.workspaceRelativePath === "string" &&
    validateControlledAgentMultifileApplyPath(value.workspaceRelativePath) === "ok" &&
    typeof value.fileLabel === "string" &&
    value.fileLabel === value.workspaceRelativePath &&
    value.existingTextFile === true &&
    safeHashPattern.test(String(value.expectedPreEditHash)) &&
    safeHashPattern.test(String(value.expectedRangeHash)) &&
    safeHashPattern.test(String(value.replacementContentHash)) &&
    boundedInteger(value.startLine, 1, 1000000) &&
    boundedInteger(value.endLine, value.startLine, 1000000) &&
    typeof value.replacementText === "string" &&
    Buffer.byteLength(value.replacementText, "utf8") <= maxControlledAgentMultifileApplyReplacementBytes &&
    !hasBinaryLikeText(value.replacementText) &&
    !unsafeTextPattern.test(value.replacementText) &&
    !rawDiffTextPattern.test(value.replacementText) &&
    !hasPrivatePathLikeText(value.replacementText) &&
    boundedInteger(value.replacementByteCount, 0, maxControlledAgentMultifileApplyReplacementBytes) &&
    Buffer.byteLength(value.replacementText, "utf8") === value.replacementByteCount &&
    hashText(value.replacementText) === value.replacementContentHash &&
    typeof value.sanitizedSummary === "string" &&
    isSafeSummary(value.sanitizedSummary);
}

function validateControlledAgentMultifileApplyPath(value: string): "ok" | ControlledAgentMultifileApplyBlockedReason {
  if (value.length === 0 || value.length > 180 || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/.test(value) || value.includes("\\") || /[:*?"<>|{}[\]$^+]/.test(value) || value.includes("%") || /[\u0000-\u001f\u007f-\u009f]/.test(value) || value.includes("//") || value.endsWith("/")) {
    return "unsafe_path";
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "..") {
      return "unsafe_path";
    }
    if (segment === "." || segment.startsWith(".")) {
      return "hidden_path";
    }
    if (dependencySegments.has(segment)) {
      return "dependency_path";
    }
    if (generatedSegments.has(segment)) {
      return "generated_path";
    }
    if (secretNamePattern.test(segment) || secretSegmentPattern.test(segment)) {
      return "unsafe_path";
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
      return "unsafe_path";
    }
  }
  return "ok";
}

async function resolveControlledWorkspaceFile(workspaceRelativePath: string, workspaceRoots: readonly string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledAgentMultifileApplyBlockedReason }> {
  const segments = workspaceRelativePath.split("/");
  const matches: { filePath: string; size: number }[] = [];
  for (const root of workspaceRoots) {
    const match = await resolveUnderRoot(root, segments);
    if (match.ok) {
      matches.push({ filePath: match.filePath, size: match.size });
    } else if (match.reason === "policy_denied") {
      return match;
    }
  }
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length === 0 ? "outside_workspace" : "policy_denied" };
  }
  return { ok: true, filePath: matches[0].filePath, size: matches[0].size };
}

async function resolveUnderRoot(root: string, segments: string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledAgentMultifileApplyBlockedReason }> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    return { ok: false, reason: "outside_workspace" };
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let entry;
    try {
      entry = await fs.lstat(current);
    } catch {
      return { ok: false, reason: "outside_workspace" };
    }
    if (entry.isSymbolicLink()) {
      return { ok: false, reason: "policy_denied" };
    }
  }
  let stat;
  try {
    stat = await fs.stat(current);
  } catch {
    return { ok: false, reason: "outside_workspace" };
  }
  if (!stat.isFile() || stat.size > maxControlledAgentMultifileApplyFileBytes) {
    return { ok: false, reason: stat.isFile() ? "budget_exceeded" : "outside_workspace" };
  }
  const fileReal = await fs.realpath(current);
  const relative = path.relative(rootReal, fileReal);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "outside_workspace" };
  }
  return { ok: true, filePath: current, size: stat.size };
}

function groupResolvedEdits(resolvedEdits: ResolvedEdit[]): ResolvedEdit[][] {
  const groups = new Map<string, ResolvedEdit[]>();
  for (const resolvedEdit of resolvedEdits) {
    const group = groups.get(resolvedEdit.filePath) ?? [];
    group.push(resolvedEdit);
    groups.set(resolvedEdit.filePath, group);
  }
  return [...groups.values()];
}

function hasOverlappingResolvedEdits(resolvedEdits: ResolvedEdit[]): boolean {
  const sorted = [...resolvedEdits].sort((left, right) => left.replacementStart - right.replacementStart);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].replacementEnd > sorted[index].replacementStart) {
      return true;
    }
  }
  return false;
}

function lineRangeOffsets(text: string, startLine: number, endLine: number): { start: number; end: number } | undefined {
  const starts = lineStarts(text);
  if (startLine > starts.length || endLine > starts.length || endLine < startLine) {
    return undefined;
  }
  return {
    start: starts[startLine - 1],
    end: endLine === starts.length ? text.length : starts[endLine],
  };
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n" && index + 1 < text.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function uniquePaths(values: string[]): string[] {
  return [...new Set(values)].slice(0, maxControlledAgentMultifileApplyFiles);
}

function hashText(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isBinaryBytes(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0 || (byte < 9 || (byte > 13 && byte < 32))) {
      return true;
    }
  }
  return false;
}

function hasBinaryLikeText(value: string): boolean {
  return value.includes("\u0000") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function isSafeSummary(value: string): boolean {
  return value.length > 0 && value.length <= 240 && !hasBinaryLikeText(value) && !unsafeTextPattern.test(value) && !hasPrivatePathLikeText(value) && !/\b(?:raw|provider|shell|command|cwd|env|git|tool|network|chmod|symlink|binary|create|delete|rename|move)\b/i.test(value);
}

function hasPrivatePathLikeText(value: string): boolean {
  return /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i.test(value);
}

function isRequiredRequestId(value: unknown): value is string {
  return typeof value === "string" && safeRequestIdPattern.test(value) && !unsafeTextPattern.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value) && !/assistant|sk-(?:proj-)?/i.test(value);
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}
