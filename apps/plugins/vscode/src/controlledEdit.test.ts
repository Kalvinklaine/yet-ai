import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runControlledAgentEditRequest } from "./controlledEdit";

async function main(): Promise<void> {
  await testSafeReplacement();
  await testHashMismatchFailsClosed();
  await testUnsafePathsFailClosed();
  await testBinarySymlinkGeneratedAndDependencyFailClosed();
}

async function testSafeReplacement(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const filePath = path.join(workspace, "src", "main.ts");
  const original = "one\ntwo\nthree\n";
  await fs.writeFile(filePath, original, "utf8");

  const result = await runControlledAgentEditRequest(createRequest("src/main.ts", original, 2, 2, "TWO\n"), [workspace]);

  assert.equal(result.type, "host.controlledAgentEditResult");
  assert.equal(result.requestId, "edit-safe");
  assert.equal(result.payload.state, "applied");
  assert.equal(result.payload.result.status, "applied");
  assert.equal(result.payload.result.appliedEditCount, 1);
  assert.deepEqual(result.payload.result.affectedFiles, ["src/main.ts"]);
  assert.equal(result.payload.edits[0].workspaceRelativePath, "src/main.ts");
  assert.equal("replacementText" in result.payload.edits[0], false);
  assert.equal(JSON.stringify(result).includes(workspace), false);
  assert.equal(JSON.stringify(result).includes("TWO"), false);
  assert.equal(await fs.readFile(filePath, "utf8"), "one\nTWO\nthree\n");
}

async function testHashMismatchFailsClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const filePath = path.join(workspace, "src", "main.ts");
  await fs.writeFile(filePath, "one\ntwo\n", "utf8");

  const result = await runControlledAgentEditRequest(createRequest("src/main.ts", "different\n", 1, 1, "ONE\n"), [workspace]);

  assert.equal(result.payload.state, "blocked");
  assert.equal(result.payload.result.blockedReason, "hash_mismatch");
  assert.equal(result.payload.result.appliedEditCount, 0);
  assert.equal(await fs.readFile(filePath, "utf8"), "one\ntwo\n");
  assert.equal(JSON.stringify(result).includes(workspace), false);
  assert.equal(JSON.stringify(result).includes("ONE"), false);
}

async function testUnsafePathsFailClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const original = "one\ntwo\n";
  await fs.writeFile(path.join(workspace, "src", "main.ts"), original, "utf8");

  for (const unsafePath of ["/src/main.ts", "../src/main.ts", "src\\main.ts", "src/.hidden.ts", "src/api_key.txt"]) {
    const result = await runControlledAgentEditRequest(createRequest(unsafePath, original, 1, 1, "ONE\n"), [workspace]);
    assert.equal(result.payload.state, "blocked", unsafePath);
    assert.equal(result.payload.result.appliedEditCount, 0, unsafePath);
    assert.equal(JSON.stringify(result).includes("ONE"), false, unsafePath);
  }
  assert.equal(await fs.readFile(path.join(workspace, "src", "main.ts"), "utf8"), original);
}

async function testBinarySymlinkGeneratedAndDependencyFailClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(workspace, "dist"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "bin.txt"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(workspace, "src", "target.txt"), "safe\n", "utf8");
  await fs.writeFile(path.join(workspace, "node_modules", "pkg", "index.js"), "safe\n", "utf8");
  await fs.writeFile(path.join(workspace, "dist", "app.js"), "safe\n", "utf8");
  await fs.symlink(path.join(workspace, "src", "target.txt"), path.join(workspace, "src", "link.txt"));

  for (const [workspaceRelativePath, original] of [["src/bin.txt", "\u0000\u0001\u0002"], ["src/link.txt", "safe\n"], ["node_modules/pkg/index.js", "safe\n"], ["dist/app.js", "safe\n"]] as const) {
    const result = await runControlledAgentEditRequest(createRequest(workspaceRelativePath, original, 1, 1, "SAFE\n"), [workspace]);
    assert.equal(result.payload.state, "blocked", workspaceRelativePath);
    assert.equal(result.payload.result.appliedEditCount, 0, workspaceRelativePath);
    assert.equal(JSON.stringify(result).includes("SAFE"), false, workspaceRelativePath);
  }
  assert.equal(await fs.readFile(path.join(workspace, "src", "target.txt"), "utf8"), "safe\n");
}

async function createWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "yet-ai-controlled-edit-"));
}

function createRequest(workspaceRelativePath: string, currentText: string, startLine: number, endLine: number, replacementText: string): Parameters<typeof runControlledAgentEditRequest>[0] {
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentEditRequest",
    requestId: "edit-safe",
    payload: {
      requestId: "edit-safe",
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-edit-safe",
      runId: "run-edit-safe",
      runtimeSessionId: "runtime-edit-safe",
      workspaceReadinessId: "ready-edit-safe",
      userConfirmed: true,
      limits: {
        maxFiles: 1,
        maxEdits: 1,
        maxPatchBytes: 4096,
      },
      edits: [
        {
          operation: "replace",
          workspaceRelativePath,
          fileLabel: workspaceRelativePath,
          expectedContentHash: hashText(currentText),
          startLine,
          endLine,
          replacementText,
          replacementByteCount: Buffer.byteLength(replacementText, "utf8"),
          sanitizedSummary: "Update selected lines.",
        },
      ],
    },
  };
}

function hashText(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

void main();
