import { copyFile, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";

const MANIFEST_VERSION = 1;
const SENTINEL_FILE = ".yet-ai-disposable-workspace.json";
const DEFAULT_LIMITS = {
  maxFiles: 32,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 5 * 1024 * 1024
};
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SECRET_SEGMENT = /(?:secret|credential|password|passwd|token|api[-_]?key|apikey|auth|cookie|session|ssh|private[-_]?key|id_rsa|id_ed25519)/i;
const BLOCKED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", "target"]);

function checkpointError(message) {
  const error = new Error(message);
  error.name = "SandboxCheckpointError";
  return error;
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw checkpointError(`${label}: invalid checkpoint input.`);
  }
}

function assertSafeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw checkpointError(`${label}: invalid checkpoint input.`);
  }
}

function assertDateTime(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw checkpointError(`${label}: invalid checkpoint input.`);
  }
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(value);
}

function normalizeLimits(limits = {}) {
  assertPlainObject(limits, "limits");
  const normalized = {
    maxFiles: Number.isInteger(limits.maxFiles) ? limits.maxFiles : DEFAULT_LIMITS.maxFiles,
    maxFileBytes: Number.isInteger(limits.maxFileBytes) ? limits.maxFileBytes : DEFAULT_LIMITS.maxFileBytes,
    maxTotalBytes: Number.isInteger(limits.maxTotalBytes) ? limits.maxTotalBytes : DEFAULT_LIMITS.maxTotalBytes
  };
  if (normalized.maxFiles < 1 || normalized.maxFiles > 512 || normalized.maxFileBytes < 1 || normalized.maxTotalBytes < 1) {
    throw checkpointError("limits: invalid checkpoint input.");
  }
  return normalized;
}

function validateRelativePath(path) {
  if (typeof path !== "string" || path.length < 1 || path.length > 240) {
    throw checkpointError("file path: unsafe checkpoint path.");
  }
  if (path.startsWith("/") || path.startsWith("~") || path.includes("\\") || URL_LIKE.test(path)) {
    throw checkpointError("file path: unsafe checkpoint path.");
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length < 1 || segment === "." || segment === ".." || segment.startsWith(".") || BLOCKED_SEGMENTS.has(segment) || SECRET_SEGMENT.test(segment)) {
      throw checkpointError("file path: unsafe checkpoint path.");
    }
  }
  return segments.join("/");
}

function workspacePath(workspaceRoot, relativePath) {
  const fullPath = join(workspaceRoot, relativePath);
  const back = relative(workspaceRoot, fullPath);
  if (back.startsWith("..") || back === ".." || back.includes(`..${sep}`)) {
    throw checkpointError("file path: unsafe checkpoint path.");
  }
  return fullPath;
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

function manifestBody(manifest) {
  return {
    version: manifest.version,
    id: manifest.id,
    createdAt: manifest.createdAt,
    workspace: manifest.workspace,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    files: manifest.files
  };
}

function computeManifestHash(manifest) {
  return hashText(stableJson(manifestBody(manifest)));
}

function manifestPath(checkpointRoot, checkpointId) {
  return join(checkpointRoot, "manifests", `${checkpointId}.json`);
}

function snapshotPath(checkpointRoot, checkpointId, storageKey) {
  return join(checkpointRoot, "snapshots", checkpointId, storageKey);
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, bytes, { mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readDisposableSentinel(workspaceRoot) {
  let entry;
  try {
    entry = await lstat(join(workspaceRoot, SENTINEL_FILE));
  } catch {
    throw checkpointError("disposable workspace sentinel is required.");
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw checkpointError("disposable workspace sentinel is invalid.");
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(join(workspaceRoot, SENTINEL_FILE), "utf8"));
  } catch {
    throw checkpointError("disposable workspace sentinel is invalid.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw checkpointError("disposable workspace sentinel is invalid.");
  }
  const rawLabel = typeof parsed.workspaceLabel === "string" ? parsed.workspaceLabel : typeof parsed.label === "string" ? parsed.label : "disposable-workspace";
  const label = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/.test(rawLabel) && !SECRET_SEGMENT.test(rawLabel) ? rawLabel : "disposable-workspace";
  return { label };
}

async function assertNoSymlinkPath(root, relativePath, options = {}) {
  const segments = relativePath.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT" && options.allowMissingFinal === true && index === segments.length - 1) {
        return;
      }
      if (error?.code === "ENOENT" && options.allowMissingParents === true) {
        return;
      }
      throw checkpointError("file path: unsafe checkpoint path.");
    }
    if (entry.isSymbolicLink()) {
      throw checkpointError("file path: unsafe checkpoint path.");
    }
    if (index < segments.length - 1 && !entry.isDirectory()) {
      throw checkpointError("file path: unsafe checkpoint path.");
    }
  }
}

function validateFiles(files, limits) {
  if (!Array.isArray(files) || files.length < 1 || files.length > limits.maxFiles) {
    throw checkpointError("files: invalid checkpoint input.");
  }
  const seen = new Set();
  return files.map((file) => {
    const safePath = validateRelativePath(file);
    if (seen.has(safePath)) {
      throw checkpointError("files: invalid checkpoint input.");
    }
    seen.add(safePath);
    return safePath;
  });
}

function validateManifest(manifest) {
  assertPlainObject(manifest, "manifest");
  if (manifest.version !== MANIFEST_VERSION) {
    throw checkpointError("manifest: invalid checkpoint manifest.");
  }
  assertSafeId(manifest.id, "manifest.id");
  assertDateTime(manifest.createdAt, "manifest.createdAt");
  assertPlainObject(manifest.workspace, "manifest.workspace");
  if (typeof manifest.workspace.label !== "string" || manifest.workspace.label.length < 1 || manifest.workspace.label.length > 80 || SECRET_SEGMENT.test(manifest.workspace.label)) {
    throw checkpointError("manifest: invalid checkpoint manifest.");
  }
  if (!Number.isInteger(manifest.fileCount) || manifest.fileCount < 1 || !Number.isInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
    throw checkpointError("manifest: invalid checkpoint manifest.");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) {
    throw checkpointError("manifest: invalid checkpoint manifest.");
  }
  let totalBytes = 0;
  const seen = new Set();
  for (const file of manifest.files) {
    assertPlainObject(file, "manifest.file");
    const path = validateRelativePath(file.path);
    if (seen.has(path)) {
      throw checkpointError("manifest: invalid checkpoint manifest.");
    }
    seen.add(path);
    if (!Number.isInteger(file.size) || file.size < 0 || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.storageKey !== "string" || !/^[a-f0-9]{64}\.bin$/.test(file.storageKey)) {
      throw checkpointError("manifest: invalid checkpoint manifest.");
    }
    totalBytes += file.size;
  }
  if (totalBytes !== manifest.totalBytes || typeof manifest.manifestHash !== "string" || !/^[a-f0-9]{64}$/.test(manifest.manifestHash) || computeManifestHash(manifest) !== manifest.manifestHash) {
    throw checkpointError("manifest: invalid checkpoint manifest.");
  }
  return manifest;
}

async function createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId, createdAt, files, limits = {} }) {
  assertSafeId(checkpointId, "checkpointId");
  assertDateTime(createdAt, "createdAt");
  if (typeof workspaceRoot !== "string" || workspaceRoot.length < 1 || typeof checkpointRoot !== "string" || checkpointRoot.length < 1) {
    throw checkpointError("checkpoint roots: invalid checkpoint input.");
  }
  const normalizedLimits = normalizeLimits(limits);
  const sentinel = await readDisposableSentinel(workspaceRoot);
  const safeFiles = validateFiles(files, normalizedLimits);
  const entries = [];
  let totalBytes = 0;
  for (const safePath of safeFiles) {
    await assertNoSymlinkPath(workspaceRoot, safePath);
    const fullPath = workspacePath(workspaceRoot, safePath);
    const entry = await lstat(fullPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > normalizedLimits.maxFileBytes) {
      throw checkpointError("file path: unsafe checkpoint path.");
    }
    totalBytes += entry.size;
    if (totalBytes > normalizedLimits.maxTotalBytes) {
      throw checkpointError("files: checkpoint size limit exceeded.");
    }
    const bytes = await readFile(fullPath);
    if (bytes.length !== entry.size || isBinary(bytes)) {
      throw checkpointError("file path: unsafe checkpoint path.");
    }
    const sha256 = hashBuffer(bytes);
    const storageKey = `${sha256}.bin`;
    await writeAtomic(snapshotPath(checkpointRoot, checkpointId, storageKey), bytes);
    entries.push({ path: safePath, size: bytes.length, sha256, storageKey });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    version: MANIFEST_VERSION,
    id: checkpointId,
    createdAt,
    workspace: { label: sentinel.label },
    fileCount: entries.length,
    totalBytes,
    files: entries
  };
  manifest.manifestHash = computeManifestHash(manifest);
  await writeAtomic(manifestPath(checkpointRoot, checkpointId), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest };
}

async function verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest }) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length < 1 || typeof checkpointRoot !== "string" || checkpointRoot.length < 1) {
    throw checkpointError("checkpoint roots: invalid checkpoint input.");
  }
  await readDisposableSentinel(workspaceRoot);
  const validManifest = validateManifest(manifest);
  for (const file of validManifest.files) {
    const path = snapshotPath(checkpointRoot, validManifest.id, file.storageKey);
    const entry = await lstat(path).catch(() => {
      throw checkpointError("checkpoint snapshot is missing.");
    });
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== file.size) {
      throw checkpointError("checkpoint snapshot is invalid.");
    }
    const bytes = await readFile(path);
    if (hashBuffer(bytes) !== file.sha256) {
      throw checkpointError("checkpoint snapshot is invalid.");
    }
  }
  return {
    verified: true,
    manifest: validManifest,
    summary: {
      id: validManifest.id,
      workspaceLabel: validManifest.workspace.label,
      fileCount: validManifest.fileCount,
      totalBytes: validManifest.totalBytes,
      manifestHash: validManifest.manifestHash
    }
  };
}

async function prepareRestorePlan(workspaceRoot, checkpointRoot, manifest) {
  const validManifest = validateManifest(manifest);
  const snapshots = [];
  for (const file of validManifest.files) {
    await assertNoSymlinkPath(workspaceRoot, file.path, { allowMissingFinal: true });
    const fullPath = workspacePath(workspaceRoot, file.path);
    const parentRelative = dirname(file.path);
    if (parentRelative !== ".") {
      await assertNoSymlinkPath(workspaceRoot, parentRelative, { allowMissingParents: true });
    }
    const source = snapshotPath(checkpointRoot, validManifest.id, file.storageKey);
    const entry = await lstat(source).catch(() => {
      throw checkpointError("checkpoint snapshot is missing.");
    });
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== file.size) {
      throw checkpointError("checkpoint snapshot is invalid.");
    }
    const bytes = await readFile(source);
    if (hashBuffer(bytes) !== file.sha256) {
      throw checkpointError("checkpoint snapshot is invalid.");
    }
    snapshots.push({ ...file, source, target: fullPath, parent: dirname(fullPath) });
  }
  return { manifest: validManifest, snapshots };
}

async function restoreSandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest, restoredAt }) {
  assertDateTime(restoredAt, "restoredAt");
  if (typeof workspaceRoot !== "string" || workspaceRoot.length < 1 || typeof checkpointRoot !== "string" || checkpointRoot.length < 1) {
    throw checkpointError("checkpoint roots: invalid checkpoint input.");
  }
  await readDisposableSentinel(workspaceRoot);
  const plan = await prepareRestorePlan(workspaceRoot, checkpointRoot, manifest);
  const restoreRoot = join(checkpointRoot, "restore-tmp", `${plan.manifest.id}-${process.pid}-${randomUUID()}`);
  const staged = [];
  const backups = [];
  try {
    for (const item of plan.snapshots) {
      const stagedPath = join(restoreRoot, item.path);
      await mkdir(dirname(stagedPath), { recursive: true });
      await copyFile(item.source, stagedPath);
      staged.push({ ...item, stagedPath });
    }
    for (const item of staged) {
      await mkdir(item.parent, { recursive: true });
      const backupPath = join(restoreRoot, "backup", item.path);
      let existed = false;
      try {
        const entry = await lstat(item.target);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw checkpointError("file path: unsafe checkpoint path.");
        }
        await mkdir(dirname(backupPath), { recursive: true });
        await copyFile(item.target, backupPath);
        existed = true;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
      backups.push({ target: item.target, backupPath, existed });
      await rename(item.stagedPath, item.target);
    }
  } catch (error) {
    for (let index = backups.length - 1; index >= 0; index -= 1) {
      const backup = backups[index];
      if (backup.existed) {
        await mkdir(dirname(backup.target), { recursive: true }).catch(() => {});
        await copyFile(backup.backupPath, backup.target).catch(() => {});
      } else {
        await rm(backup.target, { force: true }).catch(() => {});
      }
    }
    throw error?.name === "SandboxCheckpointError" ? error : checkpointError("checkpoint restore failed.");
  } finally {
    await rm(restoreRoot, { recursive: true, force: true }).catch(() => {});
  }
  return {
    restored: true,
    restoredAt,
    summary: {
      id: plan.manifest.id,
      workspaceLabel: plan.manifest.workspace.label,
      fileCount: plan.manifest.fileCount,
      totalBytes: plan.manifest.totalBytes,
      manifestHash: plan.manifest.manifestHash
    }
  };
}

export {
  createSandboxCheckpoint,
  restoreSandboxCheckpoint,
  verifySandboxCheckpoint,
  validateManifest
};
