import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSandboxCheckpoint, restoreSandboxCheckpoint, verifySandboxCheckpoint } from "./sandbox-checkpoint-state.mjs";

const CREATED_AT = "2026-06-21T12:00:00Z";
const RESTORED_AT = "2026-06-21T12:05:00Z";
const RAW_MARKERS = [
  "checkpoint body alpha",
  "restored exact body",
  "secret-marker-should-not-leak",
  tmpdir()
];

async function disposableWorkspace(root, label = "sandbox fixture") {
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ workspaceLabel: label })}\n`);
  return workspaceRoot;
}

function assertNoRawMarkers(value, label) {
  const text = JSON.stringify(value);
  for (const marker of RAW_MARKERS) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

async function assertRejectsClosed(fn, label) {
  await assert.rejects(fn, (error) => {
    assert.equal(error?.name, "SandboxCheckpointError", `${label} used unexpected error type`);
    assertNoRawMarkers({ message: error.message }, `${label} error`);
    return true;
  });
}

async function runSmoke() {
  const tmp = await mkdtemp(join(tmpdir(), "yet-sandbox-checkpoint-smoke-"));
  try {
    const checkpointRoot = join(tmp, "checkpoints");
    const workspaceRoot = await disposableWorkspace(tmp);
    await writeFile(join(workspaceRoot, "README.md"), "checkpoint body alpha\n");
    await writeFile(join(workspaceRoot, "src", "app.txt"), "restored exact body\n");

    const { manifest } = await createSandboxCheckpoint({
      workspaceRoot,
      checkpointRoot,
      checkpointId: "checkpoint-main",
      createdAt: CREATED_AT,
      files: ["README.md", "src/app.txt"],
      limits: { maxFiles: 4, maxFileBytes: 1024, maxTotalBytes: 2048 }
    });
    assert.equal(manifest.version, 1);
    assert.equal(manifest.fileCount, 2);
    assert.equal(manifest.files[0].path, "README.md");
    assert.equal(typeof manifest.files[0].sha256, "string");
    assertNoRawMarkers(manifest, "manifest");

    const verified = await verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest });
    assert.equal(verified.verified, true);
    assert.equal(verified.summary.fileCount, 2);
    assertNoRawMarkers(verified, "verify result");

    await writeFile(join(workspaceRoot, "README.md"), "modified body\n");
    await rm(join(workspaceRoot, "src", "app.txt"));
    const restored = await restoreSandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest, restoredAt: RESTORED_AT });
    assert.equal(restored.restored, true);
    assert.equal(await readFile(join(workspaceRoot, "README.md"), "utf8"), "checkpoint body alpha\n");
    assert.equal(await readFile(join(workspaceRoot, "src", "app.txt"), "utf8"), "restored exact body\n");
    assertNoRawMarkers(restored, "restore result");

    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-absolute", createdAt: CREATED_AT, files: [join(workspaceRoot, "README.md")] }),
      "absolute path"
    );
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-parent", createdAt: CREATED_AT, files: ["../README.md"] }),
      "parent path"
    );
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-hidden", createdAt: CREATED_AT, files: [".env"] }),
      "hidden path"
    );
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-url", createdAt: CREATED_AT, files: ["file://README.md"] }),
      "url path"
    );
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-secret", createdAt: CREATED_AT, files: ["config/token.txt"] }),
      "secret path"
    );
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-too-many", createdAt: CREATED_AT, files: ["README.md", "src/app.txt"], limits: { maxFiles: 1 } }),
      "too many files"
    );

    const noSentinelRoot = join(tmp, "no-sentinel");
    await mkdir(noSentinelRoot, { recursive: true });
    await writeFile(join(noSentinelRoot, "README.md"), "body\n");
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot: noSentinelRoot, checkpointRoot, checkpointId: "bad-sentinel", createdAt: CREATED_AT, files: ["README.md"] }),
      "no sentinel"
    );

    await symlink(join(workspaceRoot, "README.md"), join(workspaceRoot, "src", "link.txt"));
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-symlink", createdAt: CREATED_AT, files: ["src/link.txt"] }),
      "symlink path"
    );

    const binaryPath = join(workspaceRoot, "src", "binary.txt");
    await writeFile(binaryPath, Buffer.from([0, 1, 2, 3]));
    await assertRejectsClosed(
      () => createSandboxCheckpoint({ workspaceRoot, checkpointRoot, checkpointId: "bad-binary", createdAt: CREATED_AT, files: ["src/binary.txt"] }),
      "binary path"
    );

    const missingSnapshotManifest = structuredClone(manifest);
    await rm(join(checkpointRoot, "snapshots", manifest.id, manifest.files[0].storageKey));
    await assertRejectsClosed(
      () => verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: missingSnapshotManifest }),
      "missing snapshot"
    );
    await assertRejectsClosed(
      () => restoreSandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: missingSnapshotManifest, restoredAt: RESTORED_AT }),
      "missing restore snapshot"
    );
    assert.equal(await readFile(join(workspaceRoot, "README.md"), "utf8"), "checkpoint body alpha\n", "missing snapshot mutated workspace");

    const tamperedManifest = structuredClone(manifest);
    tamperedManifest.files[0].size += 1;
    await assertRejectsClosed(
      () => verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest: tamperedManifest }),
      "manifest hash mismatch"
    );

    const targetEntry = await lstat(join(workspaceRoot, "README.md"));
    assert.equal(targetEntry.isFile(), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Sandbox checkpoint smoke passed.");
}

export { runSmoke };
