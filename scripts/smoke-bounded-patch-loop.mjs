import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyBoundedPatchPlan, createBoundedPatchPlan, evaluateAllowlistedVerificationRequest } from "./bounded-patch-loop-state.mjs";
import { createSandboxCheckpoint, restoreSandboxCheckpoint } from "./sandbox-checkpoint-state.mjs";

const CREATED_AT = "2026-06-21T13:00:00Z";
const APPLIED_AT = "2026-06-21T13:05:00Z";
const RESTORED_AT = "2026-06-21T13:10:00Z";
const ORIGINAL = "export const answer = 41;\n";
const UPDATED = "export const answer = 42;\n";
const OTHER = "export const other = true;\n";
const SECRET_MARKER = "secret-marker-should-not-leak";
const RAW_MARKERS = [ORIGINAL.trim(), UPDATED.trim(), OTHER.trim(), SECRET_MARKER, "npm test", "git status", "curl https://example.invalid", "rm -rf"];

async function disposableWorkspace(root, label = "bounded patch fixture") {
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ workspaceLabel: label })}\n`);
  return workspaceRoot;
}

function assertNoRawMarkers(value, label, tempRoot) {
  const text = JSON.stringify(value);
  for (const marker of [...RAW_MARKERS, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

async function assertRejectsClosed(fn, label, tempRoot, unchangedFiles = []) {
  const before = new Map();
  for (const path of unchangedFiles) {
    before.set(path, await readFile(path, "utf8"));
  }
  await assert.rejects(fn, (error) => {
    assert(["BoundedPatchLoopError", "SandboxCheckpointError"].includes(error?.name), `${label} used unexpected error type`);
    assertNoRawMarkers({ message: error.message }, `${label} error`, tempRoot);
    return true;
  });
  for (const [path, bytes] of before.entries()) {
    assert.equal(await readFile(path, "utf8"), bytes, `${label} mutated ${path}`);
  }
}

function editFor(path = "src/example.ts", expectedText = ORIGINAL, replacement = UPDATED) {
  return { path, start: 0, end: expectedText.length, expectedText, replacement };
}

async function checkpoint(workspaceRoot, checkpointRoot, files = ["src/example.ts", "src/other.ts"], id = "checkpoint-main") {
  return createSandboxCheckpoint({
    workspaceRoot,
    checkpointRoot,
    checkpointId: id,
    createdAt: CREATED_AT,
    files,
    limits: { maxFiles: 8, maxFileBytes: 4096, maxTotalBytes: 8192 }
  });
}

async function createValidPlan(workspaceRoot, checkpointRoot, manifest, overrides = {}) {
  return createBoundedPatchPlan({
    workspaceRoot,
    checkpointRoot,
    checkpointManifest: manifest,
    proposalId: overrides.proposalId ?? "proposal-main",
    edits: overrides.edits ?? [editFor()],
    limits: overrides.limits ?? { maxFiles: 4, maxEdits: 8, maxFileBytes: 4096, maxPatchBytes: 4096, maxReplacementBytes: 1024 },
    verificationCommandId: overrides.verificationCommandId ?? "repository-check",
    ...overrides.extra
  });
}

async function runSmoke() {
  const tmp = await mkdtemp(join(tmpdir(), "yet-bounded-patch-loop-smoke-"));
  const report = { steps: [], denied: [] };
  try {
    const checkpointRoot = join(tmp, "checkpoints");
    const workspaceRoot = await disposableWorkspace(tmp);
    const examplePath = join(workspaceRoot, "src", "example.ts");
    const otherPath = join(workspaceRoot, "src", "other.ts");
    await writeFile(examplePath, ORIGINAL);
    await writeFile(otherPath, OTHER);

    const { manifest } = await checkpoint(workspaceRoot, checkpointRoot);
    const { patchPlan, summary } = await createValidPlan(workspaceRoot, checkpointRoot, manifest);
    assert.equal(summary.fileCount, 1);
    assert.equal(summary.editCount, 1);
    assert.equal(summary.verificationCommandId, "repository-check");
    assertNoRawMarkers(summary, "plan summary", tmp);
    report.steps.push({ name: "planned", summary });

    const applied = await applyBoundedPatchPlan({ workspaceRoot, checkpointRoot, checkpointManifest: manifest, patchPlan, appliedAt: APPLIED_AT });
    assert.equal(applied.applied, true);
    assert.equal(await readFile(examplePath, "utf8"), UPDATED);
    assert.equal(await readFile(otherPath, "utf8"), OTHER);
    assertNoRawMarkers(applied, "apply result", tmp);
    report.steps.push({ name: "applied", summary: applied.summary });

    const verification = await evaluateAllowlistedVerificationRequest({ verificationCommandId: "repository-check", checkpointManifest: manifest, patchPlan });
    assert.deepEqual(Object.keys(verification).sort(), ["action", "cloudRequired", "commandId", "metadata", "mode", "shellAllowed", "status"].sort());
    assert.equal(verification.status, "ready");
    assert.equal(verification.commandId, "repository-check");
    assert.equal(verification.cloudRequired, false);
    assert.equal(verification.shellAllowed, false);
    assert.equal("command" in verification, false);
    assert.equal("cwd" in verification, false);
    assert.equal("env" in verification, false);
    assertNoRawMarkers(verification, "verification report", tmp);
    report.steps.push({ name: "verification-ready", commandId: verification.commandId });

    const restored = await restoreSandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest, restoredAt: RESTORED_AT });
    assert.equal(restored.restored, true);
    assert.equal(await readFile(examplePath, "utf8"), ORIGINAL);
    assertNoRawMarkers(restored, "restore result", tmp);

    const deniedCases = [
      ["absolute path", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [editFor(join(workspaceRoot, "src", "example.ts"))] })],
      ["traversal path", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [editFor("../src/example.ts")] })],
      ["home path", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [editFor("~/src/example.ts")] })],
      ["hidden path", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [editFor(".env")] })],
      ["secret-like path", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [editFor("src/token.txt")] })],
      ["url-like path", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [editFor("https://example.invalid/file.ts")] })],
      ["backslash path", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [editFor("src\\example.ts")] })],
      ["create intent", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [{ ...editFor(), intent: "create" }] })],
      ["delete intent", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [{ ...editFor(), intent: "delete" }] })],
      ["rename intent", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [{ ...editFor(), intent: "rename" }] })],
      ["move intent", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { edits: [{ ...editFor(), intent: "move" }] })],
      ["raw command metadata", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { extra: { command: "npm test" } })],
      ["raw cwd metadata", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { extra: { cwd: workspaceRoot } })],
      ["raw env metadata", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { extra: { env: { API_KEY: SECRET_MARKER } } })],
      ["raw args metadata", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { extra: { args: ["--watch"] } })],
      ["background scan", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { extra: { backgroundScan: true } })],
      ["unknown command", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { verificationCommandId: "npm-test" })],
      ["too many files", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { limits: { maxFiles: 1 }, edits: [editFor(), editFor("src/other.ts", OTHER, "export const other = false;\n")] })],
      ["too large patch", () => createValidPlan(workspaceRoot, checkpointRoot, manifest, { limits: { maxPatchBytes: 4 }, edits: [editFor()] })]
    ];

    for (const [label, fn] of deniedCases) {
      await assertRejectsClosed(fn, label, tmp, [examplePath, otherPath]);
      report.denied.push(label);
    }

    const noSentinelRoot = join(tmp, "no-sentinel");
    await mkdir(join(noSentinelRoot, "src"), { recursive: true });
    await writeFile(join(noSentinelRoot, "src", "example.ts"), ORIGINAL);
    await assertRejectsClosed(
      () => createBoundedPatchPlan({ workspaceRoot: noSentinelRoot, checkpointRoot, checkpointManifest: manifest, proposalId: "bad-sentinel", edits: [editFor()], verificationCommandId: "repository-check" }),
      "missing sentinel",
      tmp,
      [examplePath]
    );
    report.denied.push("missing sentinel");

    await symlink(examplePath, join(workspaceRoot, "src", "link.ts"));
    const { manifest: linkManifest } = await checkpoint(workspaceRoot, checkpointRoot, ["src/link.ts"], "checkpoint-link").catch((error) => ({ error }));
    assert.equal(linkManifest, undefined, "symlink checkpoint unexpectedly succeeded");
    report.denied.push("symlink");

    await writeFile(join(workspaceRoot, "src", "binary.ts"), Buffer.from([0, 1, 2, 3]));
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "checkpoint-binary", createdAt: CREATED_AT, files: ["src/binary.ts"] }),
      "binary file checkpoint",
      tmp,
      [examplePath]
    );
    report.denied.push("binary");

    await writeFile(join(workspaceRoot, "src", "large.ts"), "x".repeat(64));
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "checkpoint-large", createdAt: CREATED_AT, files: ["src/large.ts"], limits: { maxFileBytes: 8 } }),
      "oversized file checkpoint",
      tmp,
      [examplePath]
    );
    report.denied.push("oversized");

    const tamperedManifest = structuredClone(manifest);
    tamperedManifest.files[0].sha256 = "0".repeat(64);
    await assertRejectsClosed(
      () => createValidPlan(workspaceRoot, checkpointRoot, tamperedManifest),
      "checkpoint mismatch",
      tmp,
      [examplePath]
    );
    report.denied.push("checkpoint mismatch");

    const missingSnapshotManifest = structuredClone(manifest);
    await rm(join(checkpointRoot, "snapshots", manifest.id, manifest.files[0].storageKey));
    await assertRejectsClosed(
      () => createValidPlan(workspaceRoot, checkpointRoot, missingSnapshotManifest),
      "missing unverified checkpoint",
      tmp,
      [examplePath]
    );
    report.denied.push("missing unverified checkpoint");

    const { manifest: freshManifest } = await checkpoint(workspaceRoot, checkpointRoot, ["src/example.ts", "src/other.ts"], "checkpoint-fresh");
    const { patchPlan: freshPlan } = await createValidPlan(workspaceRoot, checkpointRoot, freshManifest);
    await writeFile(examplePath, "export const answer = 43;\n");
    await assertRejectsClosed(
      () => applyBoundedPatchPlan({ workspaceRoot, checkpointRoot, checkpointManifest: freshManifest, patchPlan: freshPlan, appliedAt: APPLIED_AT }),
      "file hash mismatch before apply",
      tmp,
      [examplePath, otherPath]
    );
    report.denied.push("file hash mismatch");

    await assertRejectsClosed(
      () => evaluateAllowlistedVerificationRequest({ verificationCommandId: "engine-chat-tests", checkpointManifest: freshManifest, patchPlan: freshPlan }),
      "verification id mismatch",
      tmp,
      [examplePath, otherPath]
    );
    report.denied.push("verification id mismatch");

    assertNoRawMarkers(report, "smoke report", tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Bounded patch loop smoke passed.");
}

export { runSmoke };
