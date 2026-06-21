import { lstat, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { validateManifest, verifySandboxCheckpoint } from "./sandbox-checkpoint-state.mjs";

const PLAN_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SECRET_SEGMENT = /(?:secret|credential|password|passwd|token|api[-_]?key|apikey|auth|cookie|session|ssh|private[-_]?key|id_rsa|id_ed25519)/i;
const BLOCKED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", "target"]);
const FORBIDDEN_REQUEST_KEYS = new Set(["command", "cwd", "env", "args", "backgroundScan", "shell", "git", "network", "provider", "ide"]);
const ALLOWED_COMMANDS = new Map([
  ["repository-check", { label: "Repository check", category: "repository" }],
  ["gui-app-tests", { label: "GUI app tests", category: "gui" }],
  ["engine-chat-tests", { label: "Engine chat tests", category: "engine" }]
]);
const DEFAULT_LIMITS = {
  maxFiles: 8,
  maxEdits: 32,
  maxFileBytes: 1024 * 1024,
  maxPatchBytes: 64 * 1024,
  maxReplacementBytes: 16 * 1024
};
const TEXT_ENCODER = new TextEncoder();

function boundedPatchError(message) {
  const error = new Error(message);
  error.name = "BoundedPatchLoopError";
  return error;
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw boundedPatchError(`${label}: invalid bounded patch input.`);
  }
}

function assertAllowedKeys(value, allowedKeys, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key) || FORBIDDEN_REQUEST_KEYS.has(key)) {
      throw boundedPatchError(`${label}: invalid bounded patch input.`);
    }
  }
}

function assertSafeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw boundedPatchError(`${label}: invalid bounded patch input.`);
  }
}

function assertDateTime(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw boundedPatchError(`${label}: invalid bounded patch input.`);
  }
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hashText(text) {
  return hashBuffer(Buffer.from(text));
}

function stableJson(value) {
  return JSON.stringify(value);
}

function byteLength(text) {
  return TEXT_ENCODER.encode(text).length;
}

function isBinary(buffer) {
  if (buffer.includes(0)) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return sample.length > 0 && suspicious / sample.length > 0.02;
}

function normalizeLimits(limits = {}) {
  assertAllowedKeys(limits, new Set(["maxFiles", "maxEdits", "maxFileBytes", "maxPatchBytes", "maxReplacementBytes"]), "limits");
  const normalized = {
    maxFiles: Number.isInteger(limits.maxFiles) ? limits.maxFiles : DEFAULT_LIMITS.maxFiles,
    maxEdits: Number.isInteger(limits.maxEdits) ? limits.maxEdits : DEFAULT_LIMITS.maxEdits,
    maxFileBytes: Number.isInteger(limits.maxFileBytes) ? limits.maxFileBytes : DEFAULT_LIMITS.maxFileBytes,
    maxPatchBytes: Number.isInteger(limits.maxPatchBytes) ? limits.maxPatchBytes : DEFAULT_LIMITS.maxPatchBytes,
    maxReplacementBytes: Number.isInteger(limits.maxReplacementBytes) ? limits.maxReplacementBytes : DEFAULT_LIMITS.maxReplacementBytes
  };
  if (normalized.maxFiles < 1 || normalized.maxFiles > 64 || normalized.maxEdits < 1 || normalized.maxEdits > 256 || normalized.maxFileBytes < 1 || normalized.maxPatchBytes < 1 || normalized.maxReplacementBytes < 1) {
    throw boundedPatchError("limits: invalid bounded patch input.");
  }
  return normalized;
}

function validateRelativePath(path) {
  if (typeof path !== "string" || path.length < 1 || path.length > 240) {
    throw boundedPatchError("file path: unsafe bounded patch path.");
  }
  if (path.startsWith("/") || path.startsWith("~") || path.includes("\\") || URL_LIKE.test(path)) {
    throw boundedPatchError("file path: unsafe bounded patch path.");
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length < 1 || segment === "." || segment === ".." || segment.startsWith(".") || BLOCKED_SEGMENTS.has(segment) || SECRET_SEGMENT.test(segment)) {
      throw boundedPatchError("file path: unsafe bounded patch path.");
    }
  }
  return segments.join("/");
}

function workspacePath(workspaceRoot, relativePath) {
  const fullPath = join(workspaceRoot, relativePath);
  const back = relative(workspaceRoot, fullPath);
  if (back.startsWith("..") || back === ".." || back.includes(`..${sep}`)) {
    throw boundedPatchError("file path: unsafe bounded patch path.");
  }
  return fullPath;
}

async function assertNoSymlinkPath(root, relativePath) {
  const segments = relativePath.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let entry;
    try {
      entry = await lstat(current);
    } catch {
      throw boundedPatchError("file path: unsafe bounded patch path.");
    }
    if (entry.isSymbolicLink()) {
      throw boundedPatchError("file path: unsafe bounded patch path.");
    }
    if (index < segments.length - 1 && !entry.isDirectory()) {
      throw boundedPatchError("file path: unsafe bounded patch path.");
    }
  }
}

function manifestFileMap(checkpointManifest) {
  const manifest = validateManifest(checkpointManifest);
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  return { manifest, files };
}

function requireAllowedVerificationCommand(verificationCommandId) {
  if (!ALLOWED_COMMANDS.has(verificationCommandId)) {
    throw boundedPatchError("verification command id is not allowlisted.");
  }
  return ALLOWED_COMMANDS.get(verificationCommandId);
}

function planBody(patchPlan) {
  return {
    version: patchPlan.version,
    proposalId: patchPlan.proposalId,
    checkpointId: patchPlan.checkpoint.id,
    checkpointHash: patchPlan.checkpoint.manifestHash,
    verificationCommandId: patchPlan.verificationCommandId,
    limits: patchPlan.limits,
    files: patchPlan.files.map((file) => ({
      path: file.path,
      checkpointSha256: file.checkpointSha256,
      expectedSha256: file.expectedSha256,
      resultingSha256: file.resultingSha256,
      editCount: file.edits.length,
      edits: file.edits.map((edit) => ({
        start: edit.start,
        end: edit.end,
        expectedSha256: edit.expectedSha256,
        replacementSha256: edit.replacementSha256
      }))
    }))
  };
}

function computePlanHash(patchPlan) {
  return hashText(stableJson(planBody(patchPlan)));
}

function summarizePlan(patchPlan) {
  return {
    proposalId: patchPlan.proposalId,
    checkpointId: patchPlan.checkpoint.id,
    checkpointHash: patchPlan.checkpoint.manifestHash,
    fileCount: patchPlan.files.length,
    editCount: patchPlan.files.reduce((sum, file) => sum + file.edits.length, 0),
    patchBytes: patchPlan.patchBytes,
    verificationCommandId: patchPlan.verificationCommandId,
    planHash: patchPlan.planHash
  };
}

async function readAndValidateTarget(workspaceRoot, file, limits) {
  await assertNoSymlinkPath(workspaceRoot, file.path);
  const fullPath = workspacePath(workspaceRoot, file.path);
  const entry = await lstat(fullPath);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > limits.maxFileBytes) {
    throw boundedPatchError("file path: unsafe bounded patch path.");
  }
  const bytes = await readFile(fullPath);
  if (bytes.length !== entry.size || isBinary(bytes)) {
    throw boundedPatchError("file path: unsafe bounded patch path.");
  }
  return { fullPath, text: bytes.toString("utf8"), sha256: hashBuffer(bytes), size: bytes.length };
}

function normalizeEdit(edit, path, index, currentText, limits) {
  assertAllowedKeys(edit, new Set(["path", "start", "end", "expectedText", "replacement", "intent", "operation", "type"]), "edit");
  if (edit.path !== path) {
    throw boundedPatchError("edit path: invalid bounded patch input.");
  }
  const intent = edit.intent ?? edit.operation ?? edit.type ?? "replace";
  if (intent !== "replace") {
    throw boundedPatchError("edit intent is not allowed.");
  }
  if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > currentText.length) {
    throw boundedPatchError("edit range: invalid bounded patch input.");
  }
  if (typeof edit.expectedText !== "string" || typeof edit.replacement !== "string") {
    throw boundedPatchError("edit body: invalid bounded patch input.");
  }
  if (byteLength(edit.replacement) > limits.maxReplacementBytes) {
    throw boundedPatchError("patch size limit exceeded.");
  }
  if (currentText.slice(edit.start, edit.end) !== edit.expectedText) {
    throw boundedPatchError("edit range does not match expected content.");
  }
  return {
    index,
    start: edit.start,
    end: edit.end,
    expectedSha256: hashText(edit.expectedText),
    replacementSha256: hashText(edit.replacement),
    replacement: edit.replacement
  };
}

function applyEdits(text, edits) {
  let cursor = 0;
  let output = "";
  for (const edit of edits) {
    if (edit.start < cursor) {
      throw boundedPatchError("edit range: invalid bounded patch input.");
    }
    output += text.slice(cursor, edit.start);
    output += edit.replacement;
    cursor = edit.end;
  }
  return output + text.slice(cursor);
}

async function createBoundedPatchPlan(options) {
  assertAllowedKeys(options, new Set(["workspaceRoot", "checkpointRoot", "checkpointManifest", "proposalId", "edits", "limits", "verificationCommandId"]), "bounded patch request");
  const { workspaceRoot, checkpointRoot, checkpointManifest, proposalId, edits, limits = {}, verificationCommandId } = options;
  if (typeof workspaceRoot !== "string" || workspaceRoot.length < 1 || typeof checkpointRoot !== "string" || checkpointRoot.length < 1) {
    throw boundedPatchError("bounded patch roots: invalid bounded patch input.");
  }
  assertSafeId(proposalId, "proposalId");
  const command = requireAllowedVerificationCommand(verificationCommandId);
  const normalizedLimits = normalizeLimits(limits);
  const verified = await verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: checkpointManifest }).catch((error) => {
    if (error?.name === "SandboxCheckpointError") {
      throw boundedPatchError("checkpoint is missing or unverified.");
    }
    throw error;
  });
  const { manifest, files: checkpointFiles } = manifestFileMap(verified.manifest);
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > normalizedLimits.maxEdits) {
    throw boundedPatchError("edits: invalid bounded patch input.");
  }
  const byPath = new Map();
  for (const edit of edits) {
    assertPlainObject(edit, "edit");
    const safePath = validateRelativePath(edit.path);
    if (!checkpointFiles.has(safePath)) {
      throw boundedPatchError("file path is not in the verified checkpoint.");
    }
    const list = byPath.get(safePath) ?? [];
    list.push({ ...edit, path: safePath });
    byPath.set(safePath, list);
  }
  if (byPath.size > normalizedLimits.maxFiles) {
    throw boundedPatchError("files: bounded patch file limit exceeded.");
  }
  const planFiles = [];
  let patchBytes = 0;
  for (const [path, pathEdits] of [...byPath.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const checkpointFile = checkpointFiles.get(path);
    const target = await readAndValidateTarget(workspaceRoot, checkpointFile, normalizedLimits);
    if (target.sha256 !== checkpointFile.sha256) {
      throw boundedPatchError("file hash mismatch before apply.");
    }
    const normalizedEdits = pathEdits
      .map((edit, index) => normalizeEdit(edit, path, index, target.text, normalizedLimits))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const nextText = applyEdits(target.text, normalizedEdits);
    patchBytes += normalizedEdits.reduce((sum, edit) => sum + byteLength(edit.replacement), 0);
    if (patchBytes > normalizedLimits.maxPatchBytes || byteLength(nextText) > normalizedLimits.maxFileBytes) {
      throw boundedPatchError("patch size limit exceeded.");
    }
    planFiles.push({
      path,
      checkpointSha256: checkpointFile.sha256,
      expectedSha256: target.sha256,
      resultingSha256: hashText(nextText),
      sizeBefore: target.size,
      sizeAfter: byteLength(nextText),
      edits: normalizedEdits
    });
  }
  const patchPlan = {
    version: PLAN_VERSION,
    proposalId,
    checkpoint: {
      id: manifest.id,
      manifestHash: manifest.manifestHash,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes
    },
    verificationCommandId,
    verification: {
      commandId: verificationCommandId,
      label: command.label,
      category: command.category,
      mode: "in-process-allowlist"
    },
    limits: normalizedLimits,
    patchBytes,
    files: planFiles
  };
  patchPlan.planHash = computePlanHash(patchPlan);
  return { patchPlan, summary: summarizePlan(patchPlan) };
}

function validatePatchPlan(patchPlan, checkpointManifest) {
  assertPlainObject(patchPlan, "patch plan");
  const allowedKeys = new Set(["version", "proposalId", "checkpoint", "verificationCommandId", "verification", "limits", "patchBytes", "files", "planHash"]);
  for (const key of Object.keys(patchPlan)) {
    if (!allowedKeys.has(key) || FORBIDDEN_REQUEST_KEYS.has(key)) {
      throw boundedPatchError("patch plan: invalid bounded patch input.");
    }
  }
  if (patchPlan.version !== PLAN_VERSION) {
    throw boundedPatchError("patch plan: invalid bounded patch input.");
  }
  assertSafeId(patchPlan.proposalId, "proposalId");
  requireAllowedVerificationCommand(patchPlan.verificationCommandId);
  const limits = normalizeLimits(patchPlan.limits);
  const command = requireAllowedVerificationCommand(patchPlan.verificationCommandId);
  assertAllowedKeys(patchPlan.verification, new Set(["commandId", "label", "category", "mode"]), "patch plan verification");
  if (patchPlan.verification.commandId !== patchPlan.verificationCommandId || patchPlan.verification.label !== command.label || patchPlan.verification.category !== command.category || patchPlan.verification.mode !== "in-process-allowlist") {
    throw boundedPatchError("patch plan: invalid bounded patch input.");
  }
  const { manifest, files: checkpointFiles } = manifestFileMap(checkpointManifest);
  assertPlainObject(patchPlan.checkpoint, "patch plan checkpoint");
  if (patchPlan.checkpoint.id !== manifest.id || patchPlan.checkpoint.manifestHash !== manifest.manifestHash) {
    throw boundedPatchError("checkpoint hash mismatch.");
  }
  if (!Array.isArray(patchPlan.files) || patchPlan.files.length < 1 || patchPlan.files.length > limits.maxFiles) {
    throw boundedPatchError("patch plan: invalid bounded patch input.");
  }
  if (!Number.isInteger(patchPlan.patchBytes) || patchPlan.patchBytes < 1 || patchPlan.patchBytes > limits.maxPatchBytes || computePlanHash(patchPlan) !== patchPlan.planHash) {
    throw boundedPatchError("patch plan hash mismatch.");
  }
  for (const file of patchPlan.files) {
    assertPlainObject(file, "patch plan file");
    const path = validateRelativePath(file.path);
    const checkpointFile = checkpointFiles.get(path);
    if (!checkpointFile || checkpointFile.sha256 !== file.checkpointSha256 || file.expectedSha256 !== checkpointFile.sha256) {
      throw boundedPatchError("file hash mismatch before apply.");
    }
    if (!Array.isArray(file.edits) || file.edits.length < 1 || file.edits.length > limits.maxEdits) {
      throw boundedPatchError("patch plan: invalid bounded patch input.");
    }
    for (const edit of file.edits) {
      assertPlainObject(edit, "patch plan edit");
      if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || typeof edit.replacement !== "string" || byteLength(edit.replacement) > limits.maxReplacementBytes) {
        throw boundedPatchError("patch plan: invalid bounded patch input.");
      }
    }
  }
  return { manifest, limits };
}

async function applyBoundedPatchPlan(options) {
  assertAllowedKeys(options, new Set(["workspaceRoot", "checkpointRoot", "checkpointManifest", "patchPlan", "appliedAt"]), "bounded patch apply request");
  const { workspaceRoot, checkpointRoot, checkpointManifest, patchPlan, appliedAt } = options;
  assertDateTime(appliedAt, "appliedAt");
  if (typeof workspaceRoot !== "string" || workspaceRoot.length < 1 || typeof checkpointRoot !== "string" || checkpointRoot.length < 1) {
    throw boundedPatchError("bounded patch roots: invalid bounded patch input.");
  }
  await verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: checkpointManifest }).catch((error) => {
    if (error?.name === "SandboxCheckpointError") {
      throw boundedPatchError("checkpoint is missing or unverified.");
    }
    throw error;
  });
  validatePatchPlan(patchPlan, checkpointManifest);
  const staged = [];
  for (const file of patchPlan.files) {
    const target = await readAndValidateTarget(workspaceRoot, file, patchPlan.limits);
    if (target.sha256 !== file.expectedSha256) {
      throw boundedPatchError("file hash mismatch before apply.");
    }
    const edits = file.edits.map((edit) => ({ ...edit, expectedSha256: edit.expectedSha256, replacement: edit.replacement })).sort((a, b) => a.start - b.start || a.end - b.end);
    for (const edit of edits) {
      if (hashText(target.text.slice(edit.start, edit.end)) !== edit.expectedSha256) {
        throw boundedPatchError("edit range does not match expected content.");
      }
    }
    const nextText = applyEdits(target.text, edits);
    if (hashText(nextText) !== file.resultingSha256) {
      throw boundedPatchError("patch plan hash mismatch.");
    }
    staged.push({ path: file.path, fullPath: target.fullPath, bytes: `${nextText}` });
  }
  for (const item of staged) {
    await writeFile(item.fullPath, item.bytes);
  }
  return {
    applied: true,
    appliedAt,
    summary: summarizePlan(patchPlan)
  };
}

async function evaluateAllowlistedVerificationRequest(options) {
  assertAllowedKeys(options, new Set(["verificationCommandId", "checkpointManifest", "patchPlan"]), "verification request");
  const { verificationCommandId, checkpointManifest, patchPlan } = options;
  const command = requireAllowedVerificationCommand(verificationCommandId);
  validatePatchPlan(patchPlan, checkpointManifest);
  if (verificationCommandId !== patchPlan.verificationCommandId) {
    throw boundedPatchError("verification command id does not match patch plan.");
  }
  return {
    status: "ready",
    action: "runVerificationCommand",
    commandId: verificationCommandId,
    mode: "in-process-allowlist",
    cloudRequired: false,
    shellAllowed: false,
    metadata: {
      label: command.label,
      category: command.category,
      checkpointId: patchPlan.checkpoint.id,
      checkpointHash: patchPlan.checkpoint.manifestHash,
      proposalId: patchPlan.proposalId,
      planHash: patchPlan.planHash,
      fileCount: patchPlan.files.length,
      editCount: patchPlan.files.reduce((sum, file) => sum + file.edits.length, 0)
    }
  };
}

export {
  applyBoundedPatchPlan,
  createBoundedPatchPlan,
  evaluateAllowlistedVerificationRequest
};
