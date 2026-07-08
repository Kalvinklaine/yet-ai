import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vscodePluginRoot = join(repoRoot, "apps", "plugins", "vscode");
const firstBody = "alpha\nbeta\ngamma\n";
const secondBody = "one\ntwo\nthree\n";
const firstReplacement = "BETA\n";
const secondReplacement = "TWO\n";
const forbiddenFragments = [
  firstBody.trim(),
  secondBody.trim(),
  firstReplacement.trim(),
  secondReplacement.trim(),
  "replacementText",
  "diff --git",
  "rawDiff",
  "fileBody",
  "secret token",
  "/Users/private/yet-multifile",
  "git status",
  "provider payload",
];

async function main() {
  execFileSync("npm", ["run", "compile"], { cwd: vscodePluginRoot, encoding: "utf8", stdio: "pipe" });
  const moduleUrl = pathToFileURL(join(vscodePluginRoot, "out", "controlledMultifileEdit.js")).href;
  const imported = await import(`${moduleUrl}?smoke=${Date.now()}`);
  const runControlledAgentMultifileApplyRequest = imported.runControlledAgentMultifileApplyRequest ?? imported.default?.runControlledAgentMultifileApplyRequest;
  assert.equal(typeof runControlledAgentMultifileApplyRequest, "function");

  const tempRoot = await mkdtemp(join(tmpdir(), "yet-real-multifile-edit-"));
  const report = { applied: [], blocked: [] };
  try {
    const workspaceRoot = await createWorkspace(tempRoot);
    const safeRequest = createRequest([
      edit("edit-one", "src/first.txt", firstBody, 2, 2, firstReplacement),
      edit("edit-two", "docs/second.txt", secondBody, 2, 2, secondReplacement),
    ]);
    const applied = await runControlledAgentMultifileApplyRequest(safeRequest, [workspaceRoot]);
    assertApplied(applied);
    assert.equal(await readFile(join(workspaceRoot, "src", "first.txt"), "utf8"), "alpha\nBETA\ngamma\n");
    assert.equal(await readFile(join(workspaceRoot, "docs", "second.txt"), "utf8"), "one\nTWO\nthree\n");
    report.applied.push(sanitizeOutcome("safe two file replacement", applied));

    await writeFile(join(workspaceRoot, "src", "first.txt"), firstBody, "utf8");
    await writeFile(join(workspaceRoot, "docs", "second.txt"), secondBody, "utf8");

    const blockedCases = [
      ["hash mismatch", createRequest([edit("edit-one", "src/first.txt", "stale\n", 1, 1, "SAFE\n")])],
      ["unsafe path", createRequest([edit("edit-one", "../outside.txt", firstBody, 1, 1, "SAFE\n")])],
      ["unsupported operation", mutateRequest(createRequest([edit("edit-one", "src/first.txt", firstBody, 1, 1, "SAFE\n")]), (request) => { request.payload.edits[0].operation = "delete"; })],
      ["unsafe replacement", mutateRequest(createRequest([edit("edit-one", "src/first.txt", firstBody, 1, 1, "secret token\n")]), (request) => { request.payload.edits[0].replacementContentHash = sha256("secret token\n"); })],
      ["over budget", createRequest([edit("edit-one", "src/first.txt", firstBody, 1, 1, "SAFE\n")], { maxFiles: 1, maxEdits: 1, maxReplacementBytesPerEdit: 1, maxTotalReplacementBytes: 1 })],
    ];

    for (const [label, request] of blockedCases) {
      const beforeFirst = await readFile(join(workspaceRoot, "src", "first.txt"), "utf8");
      const beforeSecond = await readFile(join(workspaceRoot, "docs", "second.txt"), "utf8");
      const result = await runControlledAgentMultifileApplyRequest(request, [workspaceRoot]);
      assertBlocked(result, label);
      assert.equal(await readFile(join(workspaceRoot, "src", "first.txt"), "utf8"), beforeFirst, label);
      assert.equal(await readFile(join(workspaceRoot, "docs", "second.txt"), "utf8"), beforeSecond, label);
      report.blocked.push(sanitizeOutcome(label, result));
    }

    assert.equal(report.applied.length, 1);
    assert.equal(report.blocked.length, blockedCases.length);
    assertNoLeaks(report, tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  assertNoLeaks(report, dirname(fileURLToPath(import.meta.url)));
  console.log("Controlled agent real multi-file edit smoke passed.");
  console.log(`Verified ${report.applied.length} safe multi-file apply and ${report.blocked.length} unsafe fail-closed cases with sanitized metadata only.`);
}

async function createWorkspace(tempRoot) {
  const workspaceRoot = join(tempRoot, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, "docs"), { recursive: true });
  await writeFile(join(workspaceRoot, "src", "first.txt"), firstBody, "utf8");
  await writeFile(join(workspaceRoot, "docs", "second.txt"), secondBody, "utf8");
  await writeFile(join(tempRoot, "outside.txt"), "outside\n", "utf8");
  return workspaceRoot;
}

function createRequest(edits, limits = { maxFiles: 4, maxEdits: 12, maxReplacementBytesPerEdit: 12000, maxTotalReplacementBytes: 48000 }) {
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentMultifileApplyRequest",
    requestId: "multifile-apply-safe",
    payload: {
      requestId: "multifile-apply-safe",
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-real-multifile",
      runId: "run-real-multifile",
      runtimeSessionId: "runtime-real-multifile",
      workspaceReadinessId: "ready-real-multifile",
      patchPlanId: "plan-real-multifile",
      userConfirmed: true,
      confirmationKind: "explicit_user_multifile_apply",
      limits,
      policy: policy(),
      edits,
    },
  };
}

function edit(editId, workspaceRelativePath, currentBody, startLine, endLine, replacementText) {
  const rangeText = currentBody.split("\n").slice(startLine - 1, endLine).join("\n") + (currentBody.endsWith("\n") ? "\n" : "");
  return {
    editId,
    operation: "replace",
    workspaceRelativePath,
    fileLabel: workspaceRelativePath,
    existingTextFile: true,
    expectedPreEditHash: sha256(currentBody),
    expectedRangeHash: sha256(rangeText),
    replacementContentHash: sha256(replacementText),
    replacementText,
    startLine,
    endLine,
    replacementByteCount: Buffer.byteLength(replacementText, "utf8"),
    sanitizedSummary: "Update selected text lines.",
  };
}

function mutateRequest(request, mutate) {
  mutate(request);
  return request;
}

function policy() {
  return { host: "vscode", browserSupported: false, jetbrainsSupported: false, vscodeExecutionOnly: true, existingTextFilesOnly: true, boundedReplacementOnly: true, rawReplacementIncluded: false, rawDiffIncluded: false, fileBodyIncluded: false, createAllowed: false, deleteAllowed: false, renameAllowed: false, moveAllowed: false, dependencyEditAllowed: false, generatedEditAllowed: false, hiddenPathAllowed: false, commandAllowed: false, providerAllowed: false, toolAllowed: false, automaticApplyAllowed: false };
}

function assertApplied(result) {
  assert.equal(result.type, "host.controlledAgentMultifileApplyResult");
  assert.equal(result.payload.state, "applied");
  assert.equal(result.payload.result.appliedFileCount, 2);
  assert.equal(result.payload.result.appliedEditCount, 2);
  assert.equal(result.payload.result.rawReplacementIncluded, false);
  assert.equal(result.payload.result.rawDiffIncluded, false);
  assert.equal(result.payload.result.fileBodyIncluded, false);
  assertSafePolicy(result);
  assertNoEditBodies(result);
}

function assertBlocked(result, label) {
  assert.equal(result.type, "host.controlledAgentMultifileApplyResult", label);
  assert.equal(result.payload.state, "blocked", label);
  assert.equal(result.payload.result.appliedEditCount, 0, label);
  assert.equal(result.payload.result.rawReplacementIncluded, false, label);
  assert.equal(result.payload.result.rawDiffIncluded, false, label);
  assert.equal(result.payload.result.fileBodyIncluded, false, label);
  assert.equal(typeof result.payload.result.blockedReason, "string", label);
  assertSafePolicy(result);
  assertNoEditBodies(result);
}

function assertSafePolicy(result) {
  assert.equal(result.payload.cloudRequired, false);
  assert.equal(result.payload.authority, "vscode_bounded_multifile_replacement_apply");
  assert.equal(result.payload.policyFlags.createAllowed, false);
  assert.equal(result.payload.policyFlags.deleteAllowed, false);
  assert.equal(result.payload.policyFlags.renameAllowed, false);
  assert.equal(result.payload.policyFlags.commandAllowed, false);
  assert.equal(result.payload.policyFlags.providerAllowed, false);
  assert.equal(result.payload.policyFlags.toolAllowed, false);
  assert.equal(result.payload.policyFlags.automaticApplyAllowed, false);
}

function assertNoEditBodies(result) {
  const text = JSON.stringify(result.payload.edits);
  assert.equal(text.includes("replacementText"), false);
  assert.equal(text.includes("rawDiff"), false);
  assert.equal(text.includes("fileBody"), false);
}

function sanitizeOutcome(label, result) {
  const outcome = {
    label,
    status: result.payload.result.status,
    blockedReason: result.payload.result.blockedReason,
    appliedFileCount: result.payload.result.appliedFileCount,
    appliedEditCount: result.payload.result.appliedEditCount,
    blockedFileCount: result.payload.result.blockedFileCount,
    affectedFiles: result.payload.result.affectedFiles,
    files: result.payload.edits.map((item) => ({ path: item.workspaceRelativePath, status: item.status, lines: `${item.startLine}-${item.endLine}`, bytes: item.replacementByteCount, hasHash: typeof item.actualPostEditHash === "string" })),
  };
  assert.equal(JSON.stringify(outcome).includes("replacementText"), false, label);
  return outcome;
}

function assertNoLeaks(value, tempRoot) {
  const text = JSON.stringify(value);
  for (const fragment of [...forbiddenFragments, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(fragment), false, `sanitized smoke report leaked ${fragment}`);
  }
  assert.equal(/\/(?:Users|home|tmp|private)\//i.test(text), false);
  assert.equal(/[A-Za-z]:\\/.test(text), false);
  assert.equal(/sk-(?:proj-)?[A-Za-z0-9_-]{8,}/.test(text), false);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { main as runSmoke };
