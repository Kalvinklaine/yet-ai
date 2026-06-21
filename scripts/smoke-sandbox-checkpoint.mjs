import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSandboxCheckpoint, restoreSandboxCheckpoint, verifySandboxCheckpoint } from "./sandbox-checkpoint-state.mjs";

const CREATED_AT = "2026-06-21T12:00:00Z";
const RESTORED_AT = "2026-06-21T12:05:00Z";
const README_ORIGINAL = "checkpoint body alpha\n";
const EXAMPLE_ORIGINAL = "export const answer = 41;\n";
const README_MUTATED = "modified body secret-marker-should-not-leak\n";
const COMMAND_MARKERS = ["npm test", "git status", "curl https://example.invalid", "rm -rf"];
const RAW_MARKERS = [README_ORIGINAL.trim(), EXAMPLE_ORIGINAL.trim(), README_MUTATED.trim(), "secret-marker-should-not-leak", ...COMMAND_MARKERS];

async function disposableWorkspace(root, label = "sandbox fixture") {
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

async function assertRejectsClosed(fn, label, tempRoot) {
  await assert.rejects(fn, (error) => {
    assert.equal(error?.name, "SandboxCheckpointError", `${label} used unexpected error type`);
    assertNoRawMarkers({ message: error.message }, `${label} error`, tempRoot);
    return true;
  });
}

async function runSmoke() {
  const tmp = await mkdtemp(join(tmpdir(), "yet-sandbox-checkpoint-smoke-"));
  const report = { steps: [], denied: [] };
  try {
    const checkpointRoot = join(tmp, "checkpoints");
    const workspaceRoot = await disposableWorkspace(tmp);
    await writeFile(join(workspaceRoot, "README.md"), README_ORIGINAL);
    await writeFile(join(workspaceRoot, "src", "example.ts"), EXAMPLE_ORIGINAL);

    const { manifest } = await createSandboxCheckpoint({
      workspaceRoot,
      checkpointRoot,
      checkpointId: "checkpoint-main",
      createdAt: CREATED_AT,
      files: ["src/example.ts", "README.md"],
      limits: { maxFiles: 4, maxFileBytes: 1024, maxTotalBytes: 2048 }
    });
    assert.equal(manifest.version, 1);
    assert.equal(manifest.fileCount, 2);
    assert.deepEqual(manifest.files.map((file) => file.path), ["README.md", "src/example.ts"]);
    assert.equal(typeof manifest.files[0].sha256, "string");
    assert.equal(typeof manifest.files[0].storageKey, "string");
    assertNoRawMarkers(manifest, "manifest", tmp);
    report.steps.push({ name: "created", fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, manifestHash: manifest.manifestHash });

    const verified = await verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest });
    assert.equal(verified.verified, true);
    assert.equal(verified.summary.fileCount, 2);
    assertNoRawMarkers(verified, "verify result", tmp);
    report.steps.push({ name: "verified", summary: verified.summary });

    await writeFile(join(workspaceRoot, "README.md"), README_MUTATED);
    await rm(join(workspaceRoot, "src", "example.ts"));
    const restored = await restoreSandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest, restoredAt: RESTORED_AT });
    assert.equal(restored.restored, true);
    assert.equal(await readFile(join(workspaceRoot, "README.md"), "utf8"), README_ORIGINAL);
    assert.equal(await readFile(join(workspaceRoot, "src", "example.ts"), "utf8"), EXAMPLE_ORIGINAL);
    assertNoRawMarkers(restored, "restore result", tmp);
    report.steps.push({ name: "restored", summary: restored.summary });

    const deniedCases = [
      ["absolute path", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-absolute", createdAt: CREATED_AT, files: [join(workspaceRoot, "README.md")] })],
      ["traversal path", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-parent", createdAt: CREATED_AT, files: ["../README.md"] })],
      ["home path", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-home", createdAt: CREATED_AT, files: ["~/README.md"] })],
      ["hidden path", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-hidden", createdAt: CREATED_AT, files: [".env"] })],
      ["secret-like path", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-secret", createdAt: CREATED_AT, files: ["config/token.txt"] })],
      ["command metadata", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-command", createdAt: CREATED_AT, files: ["README.md"], command: "npm test" })],
      ["cwd metadata", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-cwd", createdAt: CREATED_AT, files: ["README.md"], cwd: join(workspaceRoot, "src") })],
      ["env metadata", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-env", createdAt: CREATED_AT, files: ["README.md"], env: { API_KEY: "secret-marker-should-not-leak" } })],
      ["background scan request", () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-scan", createdAt: CREATED_AT, files: ["README.md"], backgroundScan: true })]
    ];

    for (const [label, fn] of deniedCases) {
      await assertRejectsClosed(fn, label, tmp);
      report.denied.push(label);
    }

    const noSentinelRoot = join(tmp, "no-sentinel");
    await mkdir(noSentinelRoot, { recursive: true });
    await writeFile(join(noSentinelRoot, "README.md"), "body\n");
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot: noSentinelRoot, checkpointRoot, checkpointId: "bad-sentinel", createdAt: CREATED_AT, files: ["README.md"] }),
      "no sentinel",
      tmp
    );
    report.denied.push("no sentinel");

    await symlink(join(workspaceRoot, "README.md"), join(workspaceRoot, "src", "link.txt"));
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-symlink", createdAt: CREATED_AT, files: ["src/link.txt"] }),
      "symlink path",
      tmp
    );
    report.denied.push("symlink");

    await writeFile(join(workspaceRoot, "src", "large.txt"), "x".repeat(32));
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-too-large", createdAt: CREATED_AT, files: ["src/large.txt"], limits: { maxFileBytes: 8 } }),
      "too-large file",
      tmp
    );
    report.denied.push("too-large file");

    const missingSnapshotManifest = structuredClone(manifest);
    await rm(join(checkpointRoot, "snapshots", manifest.id, manifest.files[0].storageKey));
    await assertRejectsClosed(
      () => verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: missingSnapshotManifest }),
      "missing snapshot",
      tmp
    );
    await assertRejectsClosed(
      () => restoreSandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: missingSnapshotManifest, restoredAt: RESTORED_AT }),
      "missing restore snapshot",
      tmp
    );
    assert.equal(await readFile(join(workspaceRoot, "README.md"), "utf8"), README_ORIGINAL, "missing snapshot mutated workspace");

    const tamperedManifest = structuredClone(manifest);
    tamperedManifest.files[0].size += 1;
    await assertRejectsClosed(
      () => verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: tamperedManifest }),
      "manifest hash mismatch",
      tmp
    );

    const targetEntry = await lstat(join(workspaceRoot, "README.md"));
    assert.equal(targetEntry.isFile(), true);
    assertNoRawMarkers(report, "smoke report", tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Sandbox checkpoint smoke passed.");
}

export { runSmoke };
