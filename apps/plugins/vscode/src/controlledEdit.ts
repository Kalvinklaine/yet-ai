import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import { bridgeVersion } from "./identity";

export type ControlledAgentEditGuiMessage = {
  version: string;
  type: "gui.controlledAgentEditRequest";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export type ControlledAgentEditHostMessage = {
  version: string;
  type: "host.controlledAgentEditResult";
  requestId: string;
  payload: ControlledAgentEditResultPayload;
};

type ControlledAgentEditRequest = {
  requestId: string;
  requestIdMintedBy: "gui";
  source: "gui";
  assistantMinted: false;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  sessionId?: string;
  workspaceReadinessId: string;
  userConfirmed: true;
  limits: ControlledAgentEditLimits;
  edits: ControlledAgentReplacementEdit[];
};

type ControlledAgentEditLimits = {
  maxFiles: number;
  maxEdits: number;
  maxPatchBytes: number;
};

type ControlledAgentReplacementEdit = {
  operation: "replace";
  workspaceRelativePath: string;
  fileLabel: string;
  expectedContentHash: string;
  startLine: number;
  endLine: number;
  replacementText: string;
  replacementByteCount: number;
  sanitizedSummary: string;
};

type ControlledAgentResultEdit = Omit<ControlledAgentReplacementEdit, "replacementText"> & {
  actualContentHash?: string;
};

type ControlledAgentEditBlockedReason = "edit_disabled" | "policy_denied" | "unsafe_path" | "outside_workspace" | "hidden_path" | "dependency_path" | "generated_path" | "unsupported_operation" | "missing_expected_hash" | "hash_mismatch" | "unconfirmed_request" | "assistant_minted" | "budget_exceeded" | "line_range_invalid";

type ControlledAgentEditResultPayload = {
  type: "controlled_agent_edit_executor";
  schemaVersion: "2026-07-02";
  state: "applied" | "blocked" | "failed";
  authority: "bounded_replacement_edit";
  cloudRequired: false;
  controlledWorkspaceId: string;
  runId: string;
  runtimeSessionId?: string;
  sessionId?: string;
  workspaceReadinessId: string;
  requestId: string;
  requestIdMintedBy: "gui";
  userConfirmed: true;
  limits: ControlledAgentEditLimits;
  edits: ControlledAgentResultEdit[];
  policyFlags: ControlledAgentEditPolicyFlags;
  result: {
    status: "applied" | "blocked" | "failed";
    cloudRequired: false;
    privatePathExposed: false;
    rawBodyIncluded: false;
    rawDiffIncluded: false;
    authority: "bounded_replacement_edit";
    message: string;
    appliedEditCount: number;
    affectedFiles?: string[];
    blockedReason?: ControlledAgentEditBlockedReason;
  };
};

type ControlledAgentEditPolicyFlags = {
  boundedReplacementEditAllowed: boolean;
  fileCreateAllowed: false;
  fileDeleteAllowed: false;
  fileRenameAllowed: false;
  fileMoveAllowed: false;
  chmodAllowed: false;
  symlinkAllowed: false;
  binaryEditAllowed: false;
  directoryEditAllowed: false;
  shellAllowed: false;
  gitAllowed: false;
  providerAllowed: false;
  toolAllowed: false;
  networkAllowed: false;
  autoApplyAllowed: false;
  autoRunAllowed: false;
};

type ResolvedEdit = {
  edit: ControlledAgentReplacementEdit;
  filePath: string;
  currentText: string;
  currentHash: string;
  replacementStart: number;
  replacementEnd: number;
};

const maxControlledAgentEditFiles = 4;
const maxControlledAgentEditEdits = 16;
const maxControlledAgentEditPatchBytes = 12000;
const maxControlledAgentEditFileBytes = 2 * 1024 * 1024;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const safeHashPattern = /^sha256:[a-f0-9]{64}$/;
const dependencySegments = new Set(["node_modules", "vendor"]);
const generatedSegments = new Set(["dist", "build", "out", "target", "coverage", "__pycache__", "generated", "tmp", "temp"]);
const secretNamePattern = /^(?:secrets?|credentials?|private)$/i;
const secretSegmentPattern = /auth|credential|password|secret|token|access[_-]?token|api[_-]?key|^\.env$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|credential|cookie|BEGIN [A-Z ]*PRIVATE KEY|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i;

export function isControlledAgentEditGuiMessage(value: unknown): value is ControlledAgentEditGuiMessage {
  return parseControlledAgentEditRequest(value) !== undefined;
}

export function isInvalidControlledAgentEditRequestMessage(value: unknown): value is ControlledAgentEditGuiMessage & { requestId: string } {
  if (!isPlainRecord(value)) {
    return false;
  }
  return hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) &&
    value.version === bridgeVersion &&
    value.type === "gui.controlledAgentEditRequest" &&
    isRequiredRequestId(value.requestId) &&
    parseControlledAgentEditRequest(value) === undefined;
}

export async function runControlledAgentEditRequest(message: ControlledAgentEditGuiMessage, workspaceRoots: readonly string[]): Promise<ControlledAgentEditHostMessage> {
  const parsed = parseControlledAgentEditRequest(message);
  if (!parsed) {
    const requestId = isRequiredRequestId(message.requestId) ? message.requestId : "invalid-request";
    return createControlledAgentEditHostMessage(createFallbackRequest(requestId), "blocked", "policy_denied", "Bounded replacement edit blocked by policy.");
  }

  const budgetCheck = validateBudget(parsed);
  if (budgetCheck !== "ok") {
    return createControlledAgentEditHostMessage(parsed, "blocked", budgetCheck, "Bounded replacement edit blocked by policy.");
  }

  const resolvedEdits: ResolvedEdit[] = [];
  for (const edit of parsed.edits) {
    const pathCheck = validateControlledAgentEditPath(edit.workspaceRelativePath);
    if (pathCheck !== "ok") {
      return createControlledAgentEditHostMessage(parsed, "blocked", pathCheck, "Bounded replacement edit blocked by policy.");
    }
    const resolvedFile = await resolveControlledWorkspaceFile(edit.workspaceRelativePath, workspaceRoots);
    if (!resolvedFile.ok) {
      return createControlledAgentEditHostMessage(parsed, "blocked", resolvedFile.reason, "Bounded replacement edit blocked by policy.");
    }
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(resolvedFile.filePath);
    } catch {
      return createControlledAgentEditHostMessage(parsed, "failed", "policy_denied", "Bounded replacement edit failed.");
    }
    if (bytes.byteLength !== resolvedFile.size || bytes.byteLength > maxControlledAgentEditFileBytes || isBinaryBytes(bytes)) {
      return createControlledAgentEditHostMessage(parsed, "blocked", "policy_denied", "Bounded replacement edit blocked by policy.");
    }
    let currentText: string;
    try {
      currentText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return createControlledAgentEditHostMessage(parsed, "blocked", "policy_denied", "Bounded replacement edit blocked by policy.");
    }
    if (hasBinaryLikeText(currentText) || unsafeTextPattern.test(currentText)) {
      return createControlledAgentEditHostMessage(parsed, "blocked", "policy_denied", "Bounded replacement edit blocked by policy.");
    }
    const currentHash = hashBytes(bytes);
    if (currentHash !== edit.expectedContentHash) {
      return createControlledAgentEditHostMessage(parsed, "blocked", "hash_mismatch", "Bounded replacement edit blocked by policy.", [{ edit, actualContentHash: currentHash }]);
    }
    const range = lineRangeOffsets(currentText, edit.startLine, edit.endLine);
    if (!range) {
      return createControlledAgentEditHostMessage(parsed, "blocked", "line_range_invalid", "Bounded replacement edit blocked by policy.", [{ edit, actualContentHash: currentHash }]);
    }
    resolvedEdits.push({ edit, filePath: resolvedFile.filePath, currentText, currentHash, replacementStart: range.start, replacementEnd: range.end });
  }

  const editGroups = groupResolvedEdits(resolvedEdits);
  for (const group of editGroups) {
    if (hasOverlappingResolvedEdits(group)) {
      return createControlledAgentEditHostMessage(parsed, "blocked", "line_range_invalid", "Bounded replacement edit blocked by policy.", resolvedEdits.map(({ edit, currentHash }) => ({ edit, actualContentHash: currentHash })));
    }
  }

  try {
    for (const group of editGroups) {
      const latestBytes = await fs.readFile(group[0].filePath);
      if (hashBytes(latestBytes) !== group[0].currentHash || isBinaryBytes(latestBytes)) {
        return createControlledAgentEditHostMessage(parsed, "blocked", "hash_mismatch", "Bounded replacement edit blocked by policy.", resolvedEdits.map(({ edit, currentHash }) => ({ edit, actualContentHash: currentHash })));
      }
      let nextText = group[0].currentText;
      for (const resolvedEdit of [...group].sort((left, right) => right.replacementStart - left.replacementStart)) {
        nextText = nextText.slice(0, resolvedEdit.replacementStart) + resolvedEdit.edit.replacementText + nextText.slice(resolvedEdit.replacementEnd);
      }
      await fs.writeFile(group[0].filePath, nextText, "utf8");
    }
  } catch {
    return createControlledAgentEditHostMessage(parsed, "failed", "policy_denied", "Bounded replacement edit failed.", resolvedEdits.map(({ edit, currentHash }) => ({ edit, actualContentHash: currentHash })));
  }

  return createControlledAgentEditHostMessage(parsed, "applied", undefined, "Bounded replacement edit applied.", resolvedEdits.map(({ edit, currentHash }) => ({ edit, actualContentHash: currentHash })));
}

export function parseControlledAgentEditRequest(value: unknown): ControlledAgentEditRequest | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "payload"]) || value.version !== bridgeVersion || value.type !== "gui.controlledAgentEditRequest" || !isRequiredRequestId(value.requestId) || !isPlainRecord(value.payload)) {
    return undefined;
  }
  const payload = value.payload;
  if (!hasOnlyKeys(payload, ["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "sessionId", "workspaceReadinessId", "userConfirmed", "limits", "edits"]) || payload.requestId !== value.requestId || !isSafeId(payload.requestId) || payload.requestIdMintedBy !== "gui" || payload.source !== "gui" || payload.assistantMinted !== false || !isSafeId(payload.controlledWorkspaceId) || !isSafeId(payload.runId) || (payload.runtimeSessionId !== undefined && !isSafeId(payload.runtimeSessionId)) || (payload.sessionId !== undefined && !isSafeId(payload.sessionId)) || !isSafeId(payload.workspaceReadinessId) || payload.userConfirmed !== true || !isControlledAgentEditLimits(payload.limits) || !Array.isArray(payload.edits) || payload.edits.length < 1 || payload.edits.length > maxControlledAgentEditEdits) {
    return undefined;
  }
  const edits: ControlledAgentReplacementEdit[] = [];
  for (const edit of payload.edits) {
    if (!isControlledAgentReplacementEdit(edit)) {
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
    ...(payload.sessionId === undefined ? {} : { sessionId: payload.sessionId }),
    workspaceReadinessId: payload.workspaceReadinessId,
    userConfirmed: true,
    limits: payload.limits,
    edits,
  };
}

function validateBudget(request: ControlledAgentEditRequest): "ok" | ControlledAgentEditBlockedReason {
  if (request.limits.maxFiles > maxControlledAgentEditFiles || request.limits.maxEdits > maxControlledAgentEditEdits || request.limits.maxPatchBytes > maxControlledAgentEditPatchBytes || request.edits.length > request.limits.maxEdits) {
    return "budget_exceeded";
  }
  const paths = new Set(request.edits.map((edit) => edit.workspaceRelativePath));
  if (paths.size > request.limits.maxFiles) {
    return "budget_exceeded";
  }
  let patchBytes = 0;
  for (const edit of request.edits) {
    patchBytes += edit.replacementByteCount;
    if (patchBytes > request.limits.maxPatchBytes) {
      return "budget_exceeded";
    }
  }
  return "ok";
}

function createControlledAgentEditHostMessage(request: ControlledAgentEditRequest, state: "applied" | "blocked" | "failed", blockedReason: ControlledAgentEditBlockedReason | undefined, message: string, resolvedEdits: { edit: ControlledAgentReplacementEdit; actualContentHash?: string }[] = []): ControlledAgentEditHostMessage {
  const affectedFiles = state === "applied" ? uniquePaths(request.edits.map((edit) => edit.workspaceRelativePath)) : undefined;
  return {
    version: bridgeVersion,
    type: "host.controlledAgentEditResult",
    requestId: request.requestId,
    payload: {
      type: "controlled_agent_edit_executor",
      schemaVersion: "2026-07-02",
      state,
      authority: "bounded_replacement_edit",
      cloudRequired: false,
      controlledWorkspaceId: request.controlledWorkspaceId,
      runId: request.runId,
      ...(request.runtimeSessionId === undefined ? {} : { runtimeSessionId: request.runtimeSessionId }),
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      workspaceReadinessId: request.workspaceReadinessId,
      requestId: request.requestId,
      requestIdMintedBy: request.requestIdMintedBy,
      userConfirmed: true,
      limits: request.limits,
      edits: request.edits.map((edit) => sanitizeResultEdit(edit, resolvedEdits.find((entry) => entry.edit === edit)?.actualContentHash)),
      policyFlags: createPolicyFlags(state === "applied"),
      result: {
        status: state,
        cloudRequired: false,
        privatePathExposed: false,
        rawBodyIncluded: false,
        rawDiffIncluded: false,
        authority: "bounded_replacement_edit",
        message,
        appliedEditCount: state === "applied" ? request.edits.length : 0,
        ...(affectedFiles ? { affectedFiles } : {}),
        ...(state === "applied" ? {} : { blockedReason: blockedReason ?? "policy_denied" }),
      },
    },
  };
}

function sanitizeResultEdit(edit: ControlledAgentReplacementEdit, actualContentHash: string | undefined): ControlledAgentResultEdit {
  return {
    operation: "replace",
    workspaceRelativePath: edit.workspaceRelativePath,
    fileLabel: edit.fileLabel,
    expectedContentHash: edit.expectedContentHash,
    ...(actualContentHash === undefined ? {} : { actualContentHash }),
    startLine: edit.startLine,
    endLine: edit.endLine,
    replacementByteCount: edit.replacementByteCount,
    sanitizedSummary: edit.sanitizedSummary,
  };
}

function createPolicyFlags(boundedReplacementEditAllowed: boolean): ControlledAgentEditPolicyFlags {
  return {
    boundedReplacementEditAllowed,
    fileCreateAllowed: false,
    fileDeleteAllowed: false,
    fileRenameAllowed: false,
    fileMoveAllowed: false,
    chmodAllowed: false,
    symlinkAllowed: false,
    binaryEditAllowed: false,
    directoryEditAllowed: false,
    shellAllowed: false,
    gitAllowed: false,
    providerAllowed: false,
    toolAllowed: false,
    networkAllowed: false,
    autoApplyAllowed: false,
    autoRunAllowed: false,
  };
}

function createFallbackRequest(requestId: string): ControlledAgentEditRequest {
  return {
    requestId,
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-edit-blocked",
    runId: "run-edit-blocked",
    workspaceReadinessId: "ready-edit-blocked",
    userConfirmed: true,
    limits: { maxFiles: 1, maxEdits: 1, maxPatchBytes: 1 },
    edits: [{
      operation: "replace",
      workspaceRelativePath: "blocked/edit.txt",
      fileLabel: "blocked/edit.txt",
      expectedContentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      startLine: 1,
      endLine: 1,
      replacementText: "",
      replacementByteCount: 0,
      sanitizedSummary: "Bounded replacement edit blocked by policy.",
    }],
  };
}

function isControlledAgentEditLimits(value: unknown): value is ControlledAgentEditLimits {
  return isPlainRecord(value) && hasOnlyKeys(value, ["maxFiles", "maxEdits", "maxPatchBytes"]) && boundedInteger(value.maxFiles, 1, maxControlledAgentEditFiles) && boundedInteger(value.maxEdits, 1, maxControlledAgentEditEdits) && boundedInteger(value.maxPatchBytes, 1, maxControlledAgentEditPatchBytes);
}

function isControlledAgentReplacementEdit(value: unknown): value is ControlledAgentReplacementEdit {
  return isPlainRecord(value) &&
    hasOnlyKeys(value, ["operation", "workspaceRelativePath", "fileLabel", "expectedContentHash", "startLine", "endLine", "replacementText", "replacementByteCount", "sanitizedSummary"]) &&
    value.operation === "replace" &&
    typeof value.workspaceRelativePath === "string" &&
    validateControlledAgentEditPath(value.workspaceRelativePath) === "ok" &&
    typeof value.fileLabel === "string" &&
    value.fileLabel === value.workspaceRelativePath &&
    safeHashPattern.test(String(value.expectedContentHash)) &&
    boundedInteger(value.startLine, 1, 1000000) &&
    boundedInteger(value.endLine, value.startLine, 1000000) &&
    typeof value.replacementText === "string" &&
    Buffer.byteLength(value.replacementText, "utf8") <= maxControlledAgentEditPatchBytes &&
    !hasBinaryLikeText(value.replacementText) &&
    !unsafeTextPattern.test(value.replacementText) &&
    boundedInteger(value.replacementByteCount, 0, maxControlledAgentEditPatchBytes) &&
    Buffer.byteLength(value.replacementText, "utf8") === value.replacementByteCount &&
    typeof value.sanitizedSummary === "string" &&
    isSafeSummary(value.sanitizedSummary);
}

function validateControlledAgentEditPath(value: string): "ok" | ControlledAgentEditBlockedReason {
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

async function resolveControlledWorkspaceFile(workspaceRelativePath: string, workspaceRoots: readonly string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledAgentEditBlockedReason }> {
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

async function resolveUnderRoot(root: string, segments: string[]): Promise<{ ok: true; filePath: string; size: number } | { ok: false; reason: ControlledAgentEditBlockedReason }> {
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
  if (!stat.isFile() || stat.size > maxControlledAgentEditFileBytes) {
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
  return [...new Set(values)].slice(0, maxControlledAgentEditFiles);
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
