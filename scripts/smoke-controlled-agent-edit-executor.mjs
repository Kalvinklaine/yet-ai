import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_PATCH_BYTES = 4096;
const MAX_FILE_BYTES = 8192;
const SENTINEL = "controlled-edit-executor-sentinel";
const ORIGINAL_BODY = `export const value = "${SENTINEL}-before";\nexport const mode = "planned";\n`;
const REPLACEMENT_BODY = `export const mode = "applied";\n`;
const SECRET_MARKER = "controlled-edit-executor-secret-should-not-leak";
const PRIVATE_PATH_MARKER = "/Users/private/controlled-edit-executor";
const RAW_MARKERS = [
  SECRET_MARKER,
  PRIVATE_PATH_MARKER,
  ORIGINAL_BODY.trim(),
  REPLACEMENT_BODY.trim(),
  SENTINEL,
  "raw diff",
  "raw body",
  "npm test",
  "git status",
  "provider payload",
];
const ALLOWED_TOP_LEVEL_FIELDS = new Set([
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
const ALLOWED_EDIT_FIELDS = new Set([
  "operation",
  "workspaceRelativePath",
  "fileLabel",
  "expectedContentHash",
  "startLine",
  "endLine",
  "replacementByteCount",
  "sanitizedSummary",
]);
const FORBIDDEN_FIELDS = new Set([
  "assistantAuthority",
  "authority",
  "autoApply",
  "autoRun",
  "binary",
  "body",
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
  "shell",
  "symlink",
  "tool",
]);

class ControlledEditExecutorError extends Error {
  constructor(reason) {
    super(`Controlled edit executor blocked: ${reason}`);
    this.name = "ControlledEditExecutorError";
    this.reason = reason;
  }
}

async function disposableWorkspace(root) {
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ workspaceLabel: "S81 controlled edit executor disposable workspace", privatePath: "private-temp-path" })}\n`);
  await writeFile(join(workspaceRoot, "src", "safe.ts"), ORIGINAL_BODY);
  await writeFile(join(workspaceRoot, ".hidden.ts"), ORIGINAL_BODY);
  await writeFile(join(workspaceRoot, "src", "binary.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));
  await writeFile(join(workspaceRoot, "src", "huge.ts"), "x".repeat(MAX_FILE_BYTES + 1));
  await symlink(join(workspaceRoot, "src", "safe.ts"), join(workspaceRoot, "src", "link.ts"));
  return workspaceRoot;
}

function canonicalMetadata(overrides = {}, editOverrides = {}) {
  const bodyHash = sha256(ORIGINAL_BODY);
  return {
    type: "controlled_agent_edit_executor",
    schemaVersion: "2026-07-02",
    state: "planned",
    runId: "run-s81-c2",
    workspaceReadinessId: "ready-s81-c2",
    requestId: "edit-s81-c2",
    requestIdMintedBy: "gui",
    userConfirmed: true,
    limits: {
      maxFiles: 1,
      maxEdits: 1,
      maxPatchBytes: MAX_PATCH_BYTES,
    },
    edits: [
      {
        operation: "replace",
        workspaceRelativePath: "src/safe.ts",
        fileLabel: "src/safe.ts",
        expectedContentHash: bodyHash,
        startLine: 2,
        endLine: 2,
        replacementByteCount: Buffer.byteLength(REPLACEMENT_BODY, "utf8"),
        sanitizedSummary: "Replace one safe metadata line.",
        ...editOverrides,
      },
    ],
    ...overrides,
  };
}

async function applyControlledEdit({ workspaceRoot, metadata, replacementText = REPLACEMENT_BODY }) {
  await assertDisposableWorkspace(workspaceRoot);
  validateMetadata(metadata);
  const edit = metadata.edits[0];
  const replacementBytes = Buffer.byteLength(replacementText, "utf8");
  if (replacementBytes !== edit.replacementByteCount || replacementBytes > metadata.limits.maxPatchBytes) {
    throw new ControlledEditExecutorError("patch_size_exceeded");
  }

  const targetPath = join(workspaceRoot, edit.workspaceRelativePath);
  const relativePath = relative(workspaceRoot, targetPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ControlledEditExecutorError("outside_workspace");
  }

  const targetStat = await lstat(targetPath).catch(() => undefined);
  if (targetStat?.isSymbolicLink()) {
    throw new ControlledEditExecutorError("symlink_denied");
  }
  if (!targetStat?.isFile()) {
    throw new ControlledEditExecutorError("unsafe_path");
  }
  if (targetStat.size > MAX_FILE_BYTES) {
    throw new ControlledEditExecutorError("file_too_large");
  }

  const workspaceReal = await realpath(workspaceRoot);
  const targetReal = await realpath(targetPath);
  if (!targetReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new ControlledEditExecutorError("outside_workspace");
  }

  const beforeBytes = await readFile(targetPath);
  if (isBinary(beforeBytes)) {
    throw new ControlledEditExecutorError("binary_file");
  }
  const beforeContentHash = sha256(beforeBytes);
  if (beforeContentHash !== edit.expectedContentHash) {
    throw new ControlledEditExecutorError("hash_mismatch");
  }

  const beforeText = beforeBytes.toString("utf8");
  const lines = beforeText.split("\n");
  const lineCount = beforeText.endsWith("\n") ? lines.length - 1 : lines.length;
  if (edit.startLine > lineCount || edit.endLine > lineCount) {
    throw new ControlledEditExecutorError("invalid_range");
  }

  const nextText = replaceLines(beforeText, edit.startLine, edit.endLine, replacementText);
  await writeFile(targetPath, nextText);
  const afterContentHash = sha256(nextText);
  return sanitizeResult({
    fileLabel: edit.fileLabel,
    editCount: metadata.edits.length,
    byteCount: replacementBytes,
    replacementHash: sha256(replacementText),
    beforeContentHash,
    afterContentHash,
  });
}

async function assertDisposableWorkspace(workspaceRoot) {
  const marker = JSON.parse(await readFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), "utf8"));
  assert.equal(marker.workspaceLabel, "S81 controlled edit executor disposable workspace");
}

function validateMetadata(metadata) {
  if (!isPlainObject(metadata)) {
    throw new ControlledEditExecutorError("malformed_metadata");
  }
  assertAllowedKeys(metadata, ALLOWED_TOP_LEVEL_FIELDS, "forbidden_metadata_field");
  if (metadata.type !== "controlled_agent_edit_executor" || metadata.schemaVersion !== "2026-07-02") {
    throw new ControlledEditExecutorError("invalid_contract");
  }
  if (metadata.state !== "planned" || metadata.userConfirmed !== true) {
    throw new ControlledEditExecutorError("not_user_confirmed_planned_edit");
  }
  if (!isPlainObject(metadata.limits) || metadata.limits.maxFiles !== 1 || metadata.limits.maxEdits !== 1 || !isBoundedInteger(metadata.limits.maxPatchBytes, 1, MAX_PATCH_BYTES)) {
    throw new ControlledEditExecutorError("unbounded_limits");
  }
  if (!Array.isArray(metadata.edits) || metadata.edits.length !== 1) {
    throw new ControlledEditExecutorError("invalid_edit_count");
  }

  const edit = metadata.edits[0];
  if (!isPlainObject(edit)) {
    throw new ControlledEditExecutorError("malformed_edit");
  }
  assertAllowedKeys(edit, ALLOWED_EDIT_FIELDS, "forbidden_edit_field");
  if (edit.operation !== "replace") {
    throw new ControlledEditExecutorError("unsupported_operation");
  }
  validateWorkspaceRelativePath(edit.workspaceRelativePath);
  if (edit.fileLabel !== edit.workspaceRelativePath || !isSafeLabel(edit.fileLabel)) {
    throw new ControlledEditExecutorError("unsafe_file_label");
  }
  if (!isSha256(edit.expectedContentHash)) {
    throw new ControlledEditExecutorError("missing_expected_hash");
  }
  if (!isBoundedInteger(edit.startLine, 1, 1_000_000) || !isBoundedInteger(edit.endLine, edit.startLine, 1_000_000)) {
    throw new ControlledEditExecutorError("invalid_range");
  }
  if (!isBoundedInteger(edit.replacementByteCount, 0, MAX_PATCH_BYTES)) {
    throw new ControlledEditExecutorError("patch_size_exceeded");
  }
  if (!isSafeLabel(edit.sanitizedSummary)) {
    throw new ControlledEditExecutorError("unsafe_summary");
  }
}

function assertAllowedKeys(value, allowed, reason) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || FORBIDDEN_FIELDS.has(key)) {
      throw new ControlledEditExecutorError(reason);
    }
  }
}

function validateWorkspaceRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 180 || isAbsolute(value) || value.startsWith("~") || value.includes("\\")) {
    throw new ControlledEditExecutorError("unsafe_path");
  }
  const normalized = normalize(value);
  if (normalized !== value || normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`)) {
    throw new ControlledEditExecutorError("outside_workspace");
  }
  const parts = value.split("/");
  if (parts.some((part) => part.length === 0 || part.startsWith("."))) {
    throw new ControlledEditExecutorError("hidden_path");
  }
}

function replaceLines(text, startLine, endLine, replacement) {
  const lines = text.split("\n");
  const hasFinalNewline = text.endsWith("\n");
  const contentLines = hasFinalNewline ? lines.slice(0, -1) : lines;
  const replacementLines = replacement.endsWith("\n") ? replacement.slice(0, -1).split("\n") : replacement.split("\n");
  contentLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
  return `${contentLines.join("\n")}${hasFinalNewline ? "\n" : ""}`;
}

function sanitizeResult(result) {
  return {
    fileLabel: result.fileLabel,
    editCount: result.editCount,
    byteCount: result.byteCount,
    replacementHash: result.replacementHash,
    beforeContentHash: result.beforeContentHash,
    afterContentHash: result.afterContentHash,
  };
}

function isBinary(bytes) {
  return bytes.subarray(0, Math.min(bytes.length, 512)).includes(0);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isSha256(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isSafeLabel(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !/secret|password|token|api[_-]?key|bearer|authorization|cookie|raw|diff|body|command|shell|git|provider|\/users|\/home|\/tmp|\/private|sk-[A-Za-z0-9_-]{8,}/i.test(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function assertDenied(fn, expectedReason, label, tempRoot, report) {
  await assert.rejects(fn, (error) => {
    assert.equal(error?.name, "ControlledEditExecutorError", `${label} used unexpected error type`);
    assert.equal(error.reason, expectedReason, `${label} used unexpected denial reason`);
    assertNoRawMarkers({ message: error.message, reason: error.reason }, `${label} error`, tempRoot);
    report.blocked.push({ label, reason: error.reason });
    return true;
  });
}

function assertNoRawMarkers(value, label, tempRoot) {
  const text = JSON.stringify(value);
  for (const marker of [...RAW_MARKERS, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
  assert.equal(/\/(?:Users|home|tmp|private)\//.test(text), false, `${label} leaked a private path`);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(text), false, `${label} leaked a provider-style secret`);
}

async function runSmoke() {
  const tempRoot = await mkdtemp(join(tmpdir(), "yet-controlled-edit-executor-smoke-"));
  const report = { applied: [], blocked: [] };
  try {
    const workspaceRoot = await disposableWorkspace(tempRoot);
    const success = await applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata() });
    assert.equal(success.fileLabel, "src/safe.ts");
    assert.equal(success.editCount, 1);
    assert.equal(success.byteCount, Buffer.byteLength(REPLACEMENT_BODY, "utf8"));
    assert.equal(success.replacementHash, sha256(REPLACEMENT_BODY));
    assert.equal(success.beforeContentHash, sha256(ORIGINAL_BODY));
    assert.notEqual(success.afterContentHash, success.beforeContentHash);
    assertNoRawMarkers(success, "success result", tempRoot);
    report.applied.push({ label: "bounded replacement", result: success });

    await writeFile(join(workspaceRoot, "src", "safe.ts"), ORIGINAL_BODY);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { workspaceRelativePath: join(workspaceRoot, "src", "safe.ts"), fileLabel: join(workspaceRoot, "src", "safe.ts") }) }), "unsafe_path", "absolute path", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { workspaceRelativePath: "../outside.ts", fileLabel: "outside.ts" }) }), "outside_workspace", "traversal path", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { workspaceRelativePath: ".hidden.ts", fileLabel: ".hidden.ts" }) }), "hidden_path", "hidden path", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { workspaceRelativePath: "src/link.ts", fileLabel: "src/link.ts" }) }), "symlink_denied", "symlink", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { workspaceRelativePath: "src/binary.bin", fileLabel: "src/binary.bin", expectedContentHash: sha256(Buffer.from([0, 1, 2, 3, 4, 5])) }) }), "binary_file", "binary", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { replacementByteCount: MAX_PATCH_BYTES + 1 }) }), "patch_size_exceeded", "oversized patch metadata", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { replacementByteCount: MAX_PATCH_BYTES }), replacementText: "x".repeat(MAX_PATCH_BYTES + 1) }), "patch_size_exceeded", "oversized patch body", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { operation: "create" }) }), "unsupported_operation", "create operation", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { operation: "delete" }) }), "unsupported_operation", "delete operation", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { operation: "rename" }) }), "unsupported_operation", "rename operation", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { operation: "insert" }) }), "unsupported_operation", "unsupported operation", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { expectedContentHash: sha256("not current") }) }), "hash_mismatch", "hash mismatch", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({ rawDiff: `raw diff ${ORIGINAL_BODY}` }) }), "forbidden_metadata_field", "raw top-level diff", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { replacement: `${REPLACEMENT_BODY}${SECRET_MARKER}` }) }), "forbidden_edit_field", "raw replacement leakage", tempRoot, report);
    await assertDenied(() => applyControlledEdit({ workspaceRoot, metadata: canonicalMetadata({}, { sanitizedSummary: PRIVATE_PATH_MARKER }) }), "unsafe_summary", "private path leakage", tempRoot, report);

    assert.equal(report.applied.length, 1);
    assert.equal(report.blocked.length, 15);
    assertNoRawMarkers(report, "smoke report", tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  assertNoRawMarkers(report, "final smoke output", "yet-controlled-edit-executor-smoke");
  console.log("Controlled agent edit executor smoke passed.");
  console.log(`Verified ${report.applied.length} bounded local/mock edit and ${report.blocked.length} blocked unsafe edit-executor cases with sanitized metadata only.`);
}

export { runSmoke };
