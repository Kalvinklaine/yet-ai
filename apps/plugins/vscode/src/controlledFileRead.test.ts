import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runControlledFileReadRequest } from "./controlledFileRead";

async function main(): Promise<void> {
  await testSafeRead();
  await testUnsafePathsFailClosed();
  await testBinaryOversizeSymlinkAndSecretBodiesFailClosed();
}

async function testSafeRead(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "docs"), { recursive: true });
  await fs.writeFile(path.join(workspace, "docs", "note.md"), "hello\nthere\n", "utf8");

  const result = await runControlledFileReadRequest(createRequest("docs/note.md"), [workspace]);

  assert.equal(result.type, "host.controlledAgentFileReadResult");
  assert.equal(result.requestId, "req-read-safe");
  assert.equal(result.payload.result.status, "success");
  assert.equal(result.payload.result.text, "hello\nthere\n");
  assert.equal(result.payload.result.sanitizedPathLabel, "docs/note.md");
  assert.equal(result.payload.result.bodyIncluded, true);
  assert.equal(result.payload.workspace.privatePathExposed, false);
  assert.equal(JSON.stringify(result).includes(workspace), false);
}

async function testUnsafePathsFailClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "main.ts"), "export const ok = true;\n", "utf8");

  for (const unsafePath of ["/src/main.ts", "../src/main.ts", "src\\main.ts", "src/.hidden.ts", "node_modules/pkg/index.js", "dist/app.js", "src/api_key.txt"]) {
    const result = await runControlledFileReadRequest(createRequest(unsafePath), [workspace]);
    assert.equal(result.payload.result.status, "blocked", unsafePath);
    assert.equal(result.payload.result.bodyIncluded, false, unsafePath);
    assert.equal("text" in result.payload.result, false, unsafePath);
  }
}

async function testBinaryOversizeSymlinkAndSecretBodiesFailClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "bin.txt"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(workspace, "src", "large.txt"), "a".repeat(8193), "utf8");
  await fs.writeFile(path.join(workspace, "src", "marker.txt"), "password = nope\n", "utf8");
  await fs.symlink(path.join(workspace, "src", "marker.txt"), path.join(workspace, "src", "link.txt"));

  for (const [workspaceRelativePath, reason] of [["src/bin.txt", "binary_file"], ["src/large.txt", "too_large"], ["src/marker.txt", "policy_denied"], ["src/link.txt", "symlink_denied"]] as const) {
    const result = await runControlledFileReadRequest(createRequest(workspaceRelativePath), [workspace]);
    assert.equal(result.payload.result.status, "blocked", workspaceRelativePath);
    assert.equal(result.payload.result.blockedReason, reason, workspaceRelativePath);
    assert.equal(result.payload.result.bodyIncluded, false, workspaceRelativePath);
    assert.equal("text" in result.payload.result, false, workspaceRelativePath);
  }
}

async function createWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "yet-ai-controlled-read-"));
}

function createRequest(workspaceRelativePath: string): Parameters<typeof runControlledFileReadRequest>[0] {
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentFileReadRequest",
    requestId: "req-read-safe",
    payload: {
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-read-safe",
      runId: "run-read-safe",
      runtimeSessionId: "runtime-read-safe",
      sessionId: "session-read-safe",
      workspaceRelativePath,
      maxBytes: 8192,
      maxLines: 240,
      allowBody: true,
      singleFileOnly: true,
      recursive: false,
      globAllowed: false,
      regexAllowed: false,
      indexingAllowed: false,
    },
  };
}

void main();
