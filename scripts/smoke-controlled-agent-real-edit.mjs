import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vscodePluginRoot = join(repoRoot, "apps", "plugins", "vscode");
const safeBody = "alpha\nbeta\ngamma\n";
const replacementBody = "BETA\n";
const secretMarker = "yet-real-edit-secret-marker-should-not-leak";
const commandMarker = "yet-real-edit-command-marker-should-not-leak";
const privatePathMarker = "/Users/private/yet-real-edit";
const maxPatchBytes = 12000;
const forbiddenFragments = [
  safeBody.trim(),
  replacementBody.trim(),
  secretMarker,
  commandMarker,
  privatePathMarker,
  "raw body",
  "raw diff",
  "replacement text",
  "git status",
  "npm test",
  "curl https://example.invalid",
];

async function main() {
  execFileSync("npm", ["run", "compile"], { cwd: vscodePluginRoot, encoding: "utf8", stdio: "pipe" });
  const moduleUrl = pathToFileURL(join(vscodePluginRoot, "out", "controlledEdit.js")).href;
  const imported = await import(`${moduleUrl}?smoke=${Date.now()}`);
  const runControlledAgentEditRequest = imported.runControlledAgentEditRequest ?? imported.default?.runControlledAgentEditRequest;
  assert.equal(typeof runControlledAgentEditRequest, "function");

  const tempRoot = await mkdtemp(join(tmpdir(), "yet-real-controlled-edit-"));
  const report = { applied: [], denied: [] };
  try {
    const workspaceRoot = await createDisposableWorkspace(tempRoot);
    const safeFile = join(workspaceRoot, "src", "safe.ts");

    const safe = await runControlledAgentEditRequest(createRequest("safe-edit", "src/safe.ts", safeBody, { replacementText: replacementBody, startLine: 2, endLine: 2 }), [workspaceRoot]);
    assertAppliedEdit(safe, "safe bounded replacement", "src/safe.ts");
    assert.equal(await readFile(safeFile, "utf8"), "alpha\nBETA\ngamma\n");
    report.applied.push(sanitizeOutcome("safe bounded replacement", safe));

    await writeFile(safeFile, safeBody, "utf8");

    const deniedCases = [
      ["hash mismatch", createRequest("hash-mismatch", "src/safe.ts", "different\n")],
      ["traversal path", createRequest("traversal", "../outside.ts", safeBody)],
      ["absolute path", createRequest("absolute", join(workspaceRoot, "src", "safe.ts"), safeBody)],
      ["hidden path", createRequest("hidden", ".hidden.ts", safeBody)],
      ["secret path", createRequest("secret-path", "src/api_key.txt", secretMarker)],
      ["dependency path", createRequest("dependency", "node_modules/dep/index.js", "module.exports = true;\n")],
      ["generated path", createRequest("generated", "generated/client.ts", "export const generated = true;\n")],
      ["symlink", createRequest("symlink", "src/link.ts", safeBody)],
      ["binary file", createRequest("binary", "src/binary.bin", Buffer.from([0, 1, 2, 3, 4]))],
      ["oversized file", createRequest("oversized", "src/huge.txt", "x".repeat((2 * 1024 * 1024) + 1))],
      ["unbounded replacement", createRequest("unbounded-replacement", "src/safe.ts", safeBody, { replacementText: "x".repeat(maxPatchBytes + 1), limits: { maxFiles: 1, maxEdits: 1, maxPatchBytes: maxPatchBytes + 1 } })],
      ["create operation", createRequest("create", "src/safe.ts", safeBody, { operation: "create" })],
      ["delete operation", createRequest("delete", "src/safe.ts", safeBody, { operation: "delete" })],
      ["rename operation", createRequest("rename", "src/safe.ts", safeBody, { operation: "rename" })],
      ["move operation", createRequest("move", "src/safe.ts", safeBody, { operation: "move" })],
      ["chmod operation", createRequest("chmod", "src/safe.ts", safeBody, { operation: "chmod" })],
      ["directory target", createRequest("directory", "src", "")],
      ["command field", createRequest("command-field", "src/safe.ts", safeBody, { payloadExtras: { command: commandMarker } })],
      ["cwd field", createRequest("cwd-field", "src/safe.ts", safeBody, { payloadExtras: { cwd: tempRoot } })],
      ["env field", createRequest("env-field", "src/safe.ts", safeBody, { payloadExtras: { env: { TOKEN: secretMarker } } })],
      ["provider field", createRequest("provider-field", "src/safe.ts", safeBody, { payloadExtras: { provider: "model" } })],
      ["tool field", createRequest("tool-field", "src/safe.ts", safeBody, { payloadExtras: { tool: "shell" } })],
      ["git field", createRequest("git-field", "src/safe.ts", safeBody, { payloadExtras: { git: "status" } })],
      ["body authority field", createRequest("raw-body", "src/safe.ts", safeBody, { editExtras: { rawBody: `` } })],
      ["diff authority field", createRequest("raw-diff", "src/safe.ts", safeBody, { payloadExtras: { rawDiff: `raw diff ` } })],
      ["extra patch field", createRequest("replacement-field", "src/safe.ts", safeBody, { editExtras: { replacement: `replacement text ` } })],
    ];

    for (const [label, request] of deniedCases) {
      const before = await readFile(safeFile, "utf8");
      const result = await runControlledAgentEditRequest(request, [workspaceRoot]);
      assertDeniedEdit(result, label);
      assert.equal(await readFile(safeFile, "utf8"), before, label);
      report.denied.push(sanitizeOutcome(label, result));
    }

    assert.equal(report.applied.length, 1);
    assert.equal(report.denied.length, deniedCases.length);
    assertNoLeaks(report, tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  assertNoLeaks(report, dirname(fileURLToPath(import.meta.url)));
  console.log("Controlled agent real bounded edit smoke passed.");
  console.log(`Verified ${report.applied.length} real bounded replacement edit and ${report.denied.length} fail-closed unsafe edit cases with sanitized results only.`);
}

async function createDisposableWorkspace(tempRoot) {
  const workspaceRoot = join(tempRoot, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, "node_modules", "dep"), { recursive: true });
  await mkdir(join(workspaceRoot, "generated"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ label: "real bounded edit smoke", privatePath: "private-temp-path" })}\n`, "utf8");
  await writeFile(join(workspaceRoot, "src", "safe.ts"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, ".hidden.ts"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, "src", "api_key.txt"), secretMarker, "utf8");
  await writeFile(join(workspaceRoot, "node_modules", "dep", "index.js"), "module.exports = true;\n", "utf8");
  await writeFile(join(workspaceRoot, "generated", "client.ts"), "export const generated = true;\n", "utf8");
  await writeFile(join(workspaceRoot, "src", "binary.bin"), Buffer.from([0, 1, 2, 3, 4]));
  await writeFile(join(workspaceRoot, "src", "huge.txt"), "x".repeat((2 * 1024 * 1024) + 1), "utf8");
  await writeFile(join(tempRoot, "outside.ts"), "outside workspace\n", "utf8");
  await symlink(join(workspaceRoot, "src", "safe.ts"), join(workspaceRoot, "src", "link.ts"));
  assert.equal((await readFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), "utf8")).includes("real bounded edit smoke"), true);
  return workspaceRoot;
}

function createRequest(requestId, workspaceRelativePath, currentBody, options = {}) {
  const replacementText = options.replacementText ?? "safe replacement\n";
  const operation = options.operation ?? "replace";
  const limits = options.limits ?? { maxFiles: 1, maxEdits: 1, maxPatchBytes: maxPatchBytes };
  const edit = {
    operation,
    workspaceRelativePath,
    fileLabel: workspaceRelativePath,
    expectedContentHash: sha256(currentBody),
    startLine: options.startLine ?? 1,
    endLine: options.endLine ?? 1,
    replacementText,
    replacementByteCount: Buffer.byteLength(replacementText, "utf8"),
    sanitizedSummary: "Update selected lines.",
    ...(options.editExtras ?? {}),
  };
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentEditRequest",
    requestId,
    payload: {
      requestId,
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-real-edit",
      runId: "run-real-edit",
      runtimeSessionId: "runtime-real-edit",
      sessionId: "session-real-edit",
      workspaceReadinessId: "ready-real-edit",
      userConfirmed: true,
      limits,
      edits: [edit],
      ...(options.payloadExtras ?? {}),
    },
  };
}

function assertAppliedEdit(result, label, expectedPath) {
  assert.equal(result.type, "host.controlledAgentEditResult", label);
  assert.equal(result.payload.state, "applied", label);
  assert.equal(result.payload.result.status, "applied", label);
  assert.equal(result.payload.result.appliedEditCount, 1, label);
  assert.deepEqual(result.payload.result.affectedFiles, [expectedPath], label);
  assert.equal(result.payload.result.cloudRequired, false, label);
  assert.equal(result.payload.result.privatePathExposed, false, label);
  assert.equal(result.payload.result.rawBodyIncluded, false, label);
  assert.equal(result.payload.result.rawDiffIncluded, false, label);
  assertNoExtraAuthority(result, label);
  assertNoEditBodies(result, label);
}

function assertDeniedEdit(result, label) {
  assert.equal(result.type, "host.controlledAgentEditResult", label);
  assert.equal(result.payload.state, "blocked", label);
  assert.equal(result.payload.result.status, "blocked", label);
  assert.equal(result.payload.result.appliedEditCount, 0, label);
  assert.equal(result.payload.result.cloudRequired, false, label);
  assert.equal(result.payload.result.privatePathExposed, false, label);
  assert.equal(result.payload.result.rawBodyIncluded, false, label);
  assert.equal(result.payload.result.rawDiffIncluded, false, label);
  assert.equal(typeof result.payload.result.blockedReason, "string", label);
  assertNoExtraAuthority(result, label);
  assertNoEditBodies(result, label);
}

function assertNoExtraAuthority(result, label) {
  assert.equal(result.payload.cloudRequired, false, label);
  assert.equal(result.payload.authority, "bounded_replacement_edit", label);
  assert.equal(result.payload.policyFlags.fileCreateAllowed, false, label);
  assert.equal(result.payload.policyFlags.fileDeleteAllowed, false, label);
  assert.equal(result.payload.policyFlags.fileRenameAllowed, false, label);
  assert.equal(result.payload.policyFlags.fileMoveAllowed, false, label);
  assert.equal(result.payload.policyFlags.chmodAllowed, false, label);
  assert.equal(result.payload.policyFlags.symlinkAllowed, false, label);
  assert.equal(result.payload.policyFlags.binaryEditAllowed, false, label);
  assert.equal(result.payload.policyFlags.directoryEditAllowed, false, label);
  assert.equal(result.payload.policyFlags.shellAllowed, false, label);
  assert.equal(result.payload.policyFlags.gitAllowed, false, label);
  assert.equal(result.payload.policyFlags.providerAllowed, false, label);
  assert.equal(result.payload.policyFlags.toolAllowed, false, label);
  assert.equal(result.payload.policyFlags.networkAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoApplyAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoRunAllowed, false, label);
}

function assertNoEditBodies(result, label) {
  assert.equal(JSON.stringify(result.payload.edits).includes("replacementText"), false, label);
  assert.equal(JSON.stringify(result.payload.edits).includes("rawBody"), false, label);
  assert.equal(JSON.stringify(result.payload.edits).includes("rawDiff"), false, label);
}

function sanitizeOutcome(label, result) {
  const outcome = {
    label,
    status: result.payload.result.status,
    blockedReason: result.payload.result.blockedReason,
    appliedEditCount: result.payload.result.appliedEditCount,
    affectedFiles: result.payload.result.affectedFiles,
    edits: result.payload.edits.map((edit) => ({
      operation: edit.operation,
      workspaceRelativePath: edit.workspaceRelativePath,
      startLine: edit.startLine,
      endLine: edit.endLine,
      replacementByteCount: edit.replacementByteCount,
      hasActualContentHash: typeof edit.actualContentHash === "string",
    })),
    authority: {
      cloudRequired: result.payload.cloudRequired,
      boundedReplacementEditAllowed: result.payload.policyFlags.boundedReplacementEditAllowed,
      shellAllowed: result.payload.policyFlags.shellAllowed,
      gitAllowed: result.payload.policyFlags.gitAllowed,
      providerAllowed: result.payload.policyFlags.providerAllowed,
      toolAllowed: result.payload.policyFlags.toolAllowed,
    },
  };
  assert.equal(JSON.stringify(outcome).includes("replacementText"), false, label);
  return outcome;
}

function assertNoLeaks(value, tempRoot) {
  const text = JSON.stringify(value);
  for (const fragment of [...forbiddenFragments, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(fragment), false, `sanitized smoke report leaked ${fragment}`);
  }
  assert.equal(/\/(?:Users|home|tmp|private)\//i.test(text), false, "sanitized smoke report leaked a private path");
  assert.equal(/[A-Za-z]:\\/.test(text), false, "sanitized smoke report leaked a Windows drive path");
  assert.equal(/sk-(?:proj-)?[A-Za-z0-9_-]{8,}/.test(text), false, "sanitized smoke report leaked a provider-style secret");
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { main as runSmoke };
