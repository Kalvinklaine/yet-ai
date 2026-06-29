import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const HARD_MAX_FILE_BYTES = 8192;
const HARD_MAX_LINES = 240;
const DEFAULT_TOTAL_BYTES = 8192;
const SECRET_MARKER = "controlled-file-read-secret-should-not-leak";
const SAFE_BODY = "export const visibleValue = 42;\n";
const SECOND_BODY = "export const secondValue = true;\n";
const TRUNCATED_BODY = `${"line\n".repeat(260)}tail\n`;
const RAW_MARKERS = [SECRET_MARKER, SAFE_BODY.trim(), SECOND_BODY.trim(), TRUNCATED_BODY.slice(0, 40), "private-temp-path", "raw file body", "npm test", "git status", "curl https://example.invalid"];

class ControlledFileReadError extends Error {
  constructor(reason) {
    super(`Controlled file read blocked: ${reason}`);
    this.name = "ControlledFileReadError";
    this.reason = reason;
  }
}

async function disposableWorkspace(root) {
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, "node_modules", "dep"), { recursive: true });
  await mkdir(join(workspaceRoot, "dist"), { recursive: true });
  await mkdir(join(workspaceRoot, "generated"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ workspaceLabel: "S74 controlled file read disposable workspace", privatePath: "private-temp-path" })}\n`);
  await writeFile(join(workspaceRoot, "src", "safe.ts"), SAFE_BODY);
  await writeFile(join(workspaceRoot, "src", "second.ts"), SECOND_BODY);
  await writeFile(join(workspaceRoot, "src", "long.txt"), TRUNCATED_BODY);
  await writeFile(join(workspaceRoot, ".env"), SECRET_MARKER);
  await writeFile(join(workspaceRoot, "src", "token.txt"), SECRET_MARKER);
  await writeFile(join(workspaceRoot, "node_modules", "dep", "index.js"), "module.exports = true;\n");
  await writeFile(join(workspaceRoot, "dist", "bundle.js"), "console.log('generated');\n");
  await writeFile(join(workspaceRoot, "generated", "client.ts"), "export const generated = true;\n");
  await writeFile(join(workspaceRoot, "src", "binary.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));
  await writeFile(join(workspaceRoot, "src", "huge.txt"), "x".repeat(HARD_MAX_FILE_BYTES + 1));
  await symlink(join(workspaceRoot, "src", "safe.ts"), join(workspaceRoot, "src", "link.ts"));
  return workspaceRoot;
}

function createBudget(overrides = {}) {
  return { maxFileBytes: HARD_MAX_FILE_BYTES, maxLines: HARD_MAX_LINES, totalBytes: DEFAULT_TOTAL_BYTES, usedBytes: 0, allowBody: true, ...overrides };
}

async function readControlledFile({ workspaceRoot, workspaceRelativePath, budget, glob = false, regex = false, recursive = false, search = false }) {
  await assertDisposableWorkspace(workspaceRoot);
  validateRequestShape({ workspaceRelativePath, budget, glob, regex, recursive, search });
  const targetPath = join(workspaceRoot, workspaceRelativePath);
  const relativePath = relative(workspaceRoot, targetPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ControlledFileReadError("outside_workspace");
  }
  const targetStat = await lstat(targetPath).catch(() => undefined);
  if (targetStat?.isSymbolicLink()) {
    throw new ControlledFileReadError("symlink_denied");
  }
  if (!targetStat?.isFile()) {
    throw new ControlledFileReadError("unsafe_path");
  }
  const workspaceReal = await realpath(workspaceRoot);
  const targetReal = await realpath(targetPath);
  if (!targetReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new ControlledFileReadError("outside_workspace");
  }
  if (targetStat.size > HARD_MAX_FILE_BYTES) {
    throw new ControlledFileReadError("too_large");
  }
  const bytes = await readFile(targetPath);
  if (isBinary(bytes)) {
    throw new ControlledFileReadError("binary_file");
  }
  const text = bytes.toString("utf8");
  if (looksSecret(text)) {
    throw new ControlledFileReadError("unsafe_body");
  }
  const maxFileBytes = Math.min(budget.maxFileBytes, HARD_MAX_FILE_BYTES);
  const maxLines = Math.min(budget.maxLines, HARD_MAX_LINES);
  const truncatedByBytes = bytes.byteLength > maxFileBytes;
  const lines = text.split("\n");
  const lineCount = text.endsWith("\n") ? lines.length - 1 : lines.length;
  const truncatedByLines = lineCount > maxLines;
  const boundedText = truncateText(text, maxFileBytes, maxLines);
  const includedBytes = Buffer.byteLength(boundedText, "utf8");
  if (budget.usedBytes + includedBytes > budget.totalBytes) {
    throw new ControlledFileReadError("budget_exceeded");
  }
  budget.usedBytes += includedBytes;
  return sanitizeResult({
    status: truncatedByBytes || truncatedByLines ? "truncated" : "success",
    pathLabel: workspaceRelativePath,
    byteCount: Math.min(bytes.byteLength, maxFileBytes),
    lineCount: Math.min(lineCount, maxLines),
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    truncated: truncatedByBytes || truncatedByLines,
    bodyIncluded: budget.allowBody,
    text: budget.allowBody ? boundedText : undefined,
  });
}

async function assertDisposableWorkspace(workspaceRoot) {
  const markerPath = join(workspaceRoot, ".yet-ai-disposable-workspace.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(typeof marker.workspaceLabel, "string");
}

function validateRequestShape({ workspaceRelativePath, budget, glob, regex, recursive, search }) {
  if (glob || regex || recursive || search || workspaceRelativePath.includes("*") || workspaceRelativePath.includes("?")) {
    throw new ControlledFileReadError("search_or_glob_denied");
  }
  if (!budget?.allowBody || !Number.isInteger(budget.maxFileBytes) || !Number.isInteger(budget.maxLines) || !Number.isInteger(budget.totalBytes)) {
    throw new ControlledFileReadError("unbounded_request");
  }
  if (budget.maxFileBytes < 1 || budget.maxFileBytes > HARD_MAX_FILE_BYTES || budget.maxLines < 1 || budget.maxLines > HARD_MAX_LINES || budget.totalBytes < 1 || budget.totalBytes > DEFAULT_TOTAL_BYTES) {
    throw new ControlledFileReadError("unbounded_request");
  }
  if (typeof workspaceRelativePath !== "string" || workspaceRelativePath.length === 0 || isAbsolute(workspaceRelativePath) || workspaceRelativePath.startsWith("~") || workspaceRelativePath.includes("\\")) {
    throw new ControlledFileReadError("unsafe_path");
  }
  const normalized = normalize(workspaceRelativePath);
  if (normalized !== workspaceRelativePath || normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`)) {
    throw new ControlledFileReadError("outside_workspace");
  }
  const parts = workspaceRelativePath.split("/");
  if (parts.some((part) => part.length === 0 || part.startsWith("."))) {
    throw new ControlledFileReadError("hidden_path");
  }
  if (parts.some((part) => /^(node_modules|vendor)$/.test(part))) {
    throw new ControlledFileReadError("dependency_path");
  }
  if (parts.some((part) => /^(dist|build|out|target|coverage|generated)$/.test(part))) {
    throw new ControlledFileReadError("generated_path");
  }
  if (parts.some((part) => /(?:secret|token|password|credential|api[_-]?key|auth)/i.test(part))) {
    throw new ControlledFileReadError("secret_path");
  }
}

function truncateText(text, maxBytes, maxLines) {
  const lineBounded = text.split("\n").slice(0, maxLines).join("\n");
  const bytes = Buffer.from(lineBounded, "utf8");
  if (bytes.byteLength <= maxBytes) {
    return lineBounded;
  }
  return bytes.subarray(0, maxBytes).toString("utf8");
}

function sanitizeResult(result) {
  return {
    status: result.status,
    pathLabel: result.pathLabel,
    byteCount: result.byteCount,
    lineCount: result.lineCount,
    contentHash: result.contentHash,
    truncated: result.truncated,
    bodyIncluded: result.bodyIncluded,
  };
}

function isBinary(bytes) {
  return bytes.subarray(0, Math.min(bytes.length, 512)).includes(0);
}

function looksSecret(text) {
  return /secret|password|api[_-]?key|access[_-]?token|bearer|authorization|cookie|sk-[A-Za-z0-9_-]{8,}/i.test(text);
}

async function assertDenied(fn, expectedReason, label, tempRoot, report) {
  await assert.rejects(fn, (error) => {
    assert.equal(error?.name, "ControlledFileReadError", `${label} used unexpected error type`);
    assert.equal(error.reason, expectedReason, `${label} used unexpected denial reason`);
    assertNoRawMarkers({ message: error.message, reason: error.reason }, `${label} error`, tempRoot);
    report.denied.push({ label, reason: error.reason });
    return true;
  });
}

function assertNoRawMarkers(value, label, tempRoot) {
  const text = JSON.stringify(value);
  for (const marker of [...RAW_MARKERS, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
  assert.equal(/\/Users\//.test(text), false, `${label} leaked a user path`);
}

async function runSmoke() {
  const tempRoot = await mkdtemp(join(tmpdir(), "yet-controlled-file-read-smoke-"));
  const report = { passed: [], denied: [] };
  try {
    const workspaceRoot = await disposableWorkspace(tempRoot);
    const success = await readControlledFile({ workspaceRoot, workspaceRelativePath: "src/safe.ts", budget: createBudget() });
    assert.equal(success.status, "success");
    assert.equal(success.pathLabel, "src/safe.ts");
    assert.equal(success.bodyIncluded, true);
    assert.equal("text" in success, false);
    report.passed.push({ label: "success", result: success });

    const truncated = await readControlledFile({ workspaceRoot, workspaceRelativePath: "src/long.txt", budget: createBudget({ maxFileBytes: 128, maxLines: 8 }) });
    assert.equal(truncated.status, "truncated");
    assert.equal(truncated.truncated, true);
    assert.equal(truncated.byteCount <= 128, true);
    assert.equal(truncated.lineCount <= 8, true);
    report.passed.push({ label: "truncation", result: truncated });

    const sharedBudget = createBudget({ totalBytes: 40 });
    await readControlledFile({ workspaceRoot, workspaceRelativePath: "src/safe.ts", budget: sharedBudget });
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "src/second.ts", budget: sharedBudget }), "budget_exceeded", "budget exhaustion", tempRoot, report);

    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "../outside.txt", budget: createBudget() }), "outside_workspace", "traversal path", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: join(workspaceRoot, "src", "safe.ts"), budget: createBudget() }), "unsafe_path", "absolute private path", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: ".env", budget: createBudget() }), "hidden_path", "hidden path", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "src/token.txt", budget: createBudget() }), "secret_path", "secret path", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "node_modules/dep/index.js", budget: createBudget() }), "dependency_path", "dependency path", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "dist/bundle.js", budget: createBudget() }), "generated_path", "build path", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "generated/client.ts", budget: createBudget() }), "generated_path", "generated path", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "src/link.ts", budget: createBudget() }), "symlink_denied", "symlink", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "src/binary.bin", budget: createBudget() }), "binary_file", "binary", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "src/huge.txt", budget: createBudget() }), "too_large", "oversized body", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "src/*.ts", budget: createBudget(), glob: true }), "search_or_glob_denied", "glob rejection", tempRoot, report);
    await assertDenied(() => readControlledFile({ workspaceRoot, workspaceRelativePath: "src/safe.ts", budget: createBudget(), search: true }), "search_or_glob_denied", "search rejection", tempRoot, report);

    assert.equal(report.passed.length, 2);
    assert.equal(report.denied.length, 13);
    assertNoRawMarkers(report, "smoke report", tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  assertNoRawMarkers(report, "final smoke output", dirname(process.argv[1]));
  console.log("Controlled agent file read smoke passed.");
  console.log(`Verified ${report.passed.length} allowed bounded read outcomes and ${report.denied.length} denied unsafe local/mock cases with sanitized metadata only.`);
}

export { runSmoke };
