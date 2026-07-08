import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runControlledAgentMultifileApplyRequest } from "./controlledMultifileEdit";

async function main(): Promise<void> {
  await testAppliesTwoFiles();
  await testEmptyReplacementDeletesRange();
  await testHashMismatchFailsAllOrNothing();
  await testUnsafePathFailsClosed();
  await testUnsupportedOperationFailsClosed();
  await testOverBudgetFailsClosed();
  await testUnsafeReplacementTextFailsClosed();
  await testOverlappingRangesFailClosed();
  await testRawLeakageBlockedResults();
}

async function testAppliesTwoFiles(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "packages", "contracts", "src"), { recursive: true });
  const firstPath = path.join(workspace, "src", "main.ts");
  const secondPath = path.join(workspace, "packages", "contracts", "src", "index.ts");
  const firstOriginal = "one\ntwo\nthree\n";
  const secondOriginal = "alpha\nbeta\ngamma\n";
  await fs.writeFile(firstPath, firstOriginal, "utf8");
  await fs.writeFile(secondPath, secondOriginal, "utf8");

  const result = await runControlledAgentMultifileApplyRequest(createRequest([
    edit("edit-one", "src/main.ts", firstOriginal, 2, 2, "TWO\n"),
    edit("edit-two", "packages/contracts/src/index.ts", secondOriginal, 2, 2, "BETA\n"),
  ]), [workspace]);

  assert.equal(result.type, "host.controlledAgentMultifileApplyResult");
  assert.equal(result.requestId, "multifile-apply-safe");
  assert.equal(result.payload.state, "applied");
  assert.equal(result.payload.result.status, "applied");
  assert.equal(result.payload.result.appliedFileCount, 2);
  assert.equal(result.payload.result.appliedEditCount, 2);
  assert.deepEqual(result.payload.result.affectedFiles, ["src/main.ts", "packages/contracts/src/index.ts"]);
  assert.equal("replacementText" in result.payload.edits[0], false);
  assert.equal(JSON.stringify(result).includes(workspace), false);
  assert.equal(JSON.stringify(result).includes("TWO"), false);
  assert.equal(JSON.stringify(result).includes("BETA"), false);
  assert.equal(await fs.readFile(firstPath, "utf8"), "one\nTWO\nthree\n");
  assert.equal(await fs.readFile(secondPath, "utf8"), "alpha\nBETA\ngamma\n");
}

async function testEmptyReplacementDeletesRange(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const filePath = path.join(workspace, "src", "main.ts");
  const original = "keep\ndelete\nend\n";
  await fs.writeFile(filePath, original, "utf8");

  const result = await runControlledAgentMultifileApplyRequest(createRequest([
    edit("edit-empty", "src/main.ts", original, 2, 2, ""),
  ]), [workspace]);

  assert.equal(result.payload.state, "applied");
  assert.equal(result.payload.edits[0].replacementByteCount, 0);
  assert.equal(await fs.readFile(filePath, "utf8"), "keep\nend\n");
}

async function testHashMismatchFailsAllOrNothing(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const firstPath = path.join(workspace, "src", "one.ts");
  const secondPath = path.join(workspace, "src", "two.ts");
  const firstOriginal = "one\ntwo\n";
  const secondOriginal = "alpha\nbeta\n";
  await fs.writeFile(firstPath, firstOriginal, "utf8");
  await fs.writeFile(secondPath, secondOriginal, "utf8");

  const result = await runControlledAgentMultifileApplyRequest(createRequest([
    edit("edit-one", "src/one.ts", firstOriginal, 1, 1, "ONE\n"),
    edit("edit-two", "src/two.ts", "stale\n", 1, 1, "ALPHA\n"),
  ]), [workspace]);

  assert.equal(result.payload.state, "blocked");
  assert.equal(result.payload.result.blockedReason, "hash_mismatch");
  assert.equal(result.payload.result.appliedEditCount, 0);
  assert.equal(await fs.readFile(firstPath, "utf8"), firstOriginal);
  assert.equal(await fs.readFile(secondPath, "utf8"), secondOriginal);
  assert.equal(JSON.stringify(result).includes("ONE"), false);
  assert.equal(JSON.stringify(result).includes("ALPHA"), false);
}

async function testUnsafePathFailsClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const original = "one\ntwo\n";
  await fs.writeFile(path.join(workspace, "src", "main.ts"), original, "utf8");

  for (const unsafePath of ["/src/main.ts", "../src/main.ts", "src\\main.ts", "src/.hidden.ts", "src/api_key.txt", "node_modules/pkg/index.js", "dist/app.js"]) {
    const result = await runControlledAgentMultifileApplyRequest(createRequest([
      edit("edit-unsafe", unsafePath, original, 1, 1, "ONE\n"),
    ]), [workspace]);
    assert.equal(result.payload.state, "blocked", unsafePath);
    assert.equal(result.payload.result.appliedEditCount, 0, unsafePath);
    assert.equal(JSON.stringify(result).includes("ONE"), false, unsafePath);
  }
  assert.equal(await fs.readFile(path.join(workspace, "src", "main.ts"), "utf8"), original);
}

async function testUnsupportedOperationFailsClosed(): Promise<void> {
  const workspace = await createWorkspace();
  const message = createRequest([edit("edit-create", "src/main.ts", "one\n", 1, 1, "ONE\n")]) as Record<string, any>;
  message.payload.edits[0].operation = "create";

  const result = await runControlledAgentMultifileApplyRequest(message as Parameters<typeof runControlledAgentMultifileApplyRequest>[0], [workspace]);

  assert.equal(result.payload.state, "blocked");
  assert.equal(result.payload.result.appliedEditCount, 0);
  assert.equal(JSON.stringify(result).includes("ONE"), false);
}

async function testOverBudgetFailsClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const filePath = path.join(workspace, "src", "main.ts");
  const original = "one\ntwo\n";
  await fs.writeFile(filePath, original, "utf8");
  const message = createRequest([edit("edit-large", "src/main.ts", original, 1, 1, "01234567890\n")]) as Record<string, any>;
  message.payload.limits.maxTotalReplacementBytes = 4;

  const result = await runControlledAgentMultifileApplyRequest(message as Parameters<typeof runControlledAgentMultifileApplyRequest>[0], [workspace]);

  assert.equal(result.payload.state, "blocked");
  assert.equal(result.payload.result.blockedReason, "budget_exceeded");
  assert.equal(await fs.readFile(filePath, "utf8"), original);
  assert.equal(JSON.stringify(result).includes("012345"), false);
}

async function testUnsafeReplacementTextFailsClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const filePath = path.join(workspace, "src", "main.ts");
  const original = "one\ntwo\n";
  await fs.writeFile(filePath, original, "utf8");

  for (const unsafeText of ["Bearer sk-proj-1234567890", "diff --git a/x b/x\n", "/Users/alice/private/file.ts"]) {
    const result = await runControlledAgentMultifileApplyRequest(createRequest([
      edit("edit-unsafe-text", "src/main.ts", original, 1, 1, unsafeText),
    ]), [workspace]);
    assert.equal(result.payload.state, "blocked", unsafeText);
    assert.equal(await fs.readFile(filePath, "utf8"), original, unsafeText);
    assert.equal(JSON.stringify(result).includes(unsafeText), false, unsafeText);
  }
}

async function testOverlappingRangesFailClosed(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const filePath = path.join(workspace, "src", "main.ts");
  const original = "one\ntwo\nthree\nfour\n";
  await fs.writeFile(filePath, original, "utf8");

  const result = await runControlledAgentMultifileApplyRequest(createRequest([
    edit("edit-one", "src/main.ts", original, 1, 2, "ONE\nTWO\n"),
    edit("edit-two", "src/main.ts", original, 2, 3, "TWO\nTHREE\n"),
  ], { maxFiles: 1, maxEdits: 2, maxReplacementBytesPerEdit: 100, maxTotalReplacementBytes: 200 }), [workspace]);

  assert.equal(result.payload.state, "blocked");
  assert.equal(result.payload.result.blockedReason, "line_range_invalid");
  assert.equal(await fs.readFile(filePath, "utf8"), original);
  assert.equal(JSON.stringify(result).includes("ONE"), false);
}

async function testRawLeakageBlockedResults(): Promise<void> {
  const workspace = await createWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  const filePath = path.join(workspace, "src", "main.ts");
  const original = "one\ntwo\n";
  await fs.writeFile(filePath, original, "utf8");

  const result = await runControlledAgentMultifileApplyRequest(createRequest([
    edit("edit-one", "src/main.ts", "stale\n", 1, 1, "VISIBLE_REPLACEMENT\n"),
  ]), [workspace]);
  const output = JSON.stringify(result);

  assert.equal(result.payload.state, "blocked");
  assert.equal(output.includes(workspace), false);
  assert.equal(output.includes(filePath), false);
  assert.equal(output.includes("VISIBLE_REPLACEMENT"), false);
  assert.equal(output.includes(original), false);
  assert.equal(result.payload.result.rawReplacementIncluded, false);
  assert.equal(result.payload.result.rawDiffIncluded, false);
  assert.equal(result.payload.result.fileBodyIncluded, false);
}

async function createWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "yet-ai-controlled-multifile-"));
}

function createRequest(edits: ControlledEdit[], limits = { maxFiles: 4, maxEdits: 12, maxReplacementBytesPerEdit: 12000, maxTotalReplacementBytes: 48000 }): Parameters<typeof runControlledAgentMultifileApplyRequest>[0] {
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentMultifileApplyRequest",
    requestId: "multifile-apply-safe",
    payload: {
      requestId: "multifile-apply-safe",
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-apply-safe",
      runId: "run-apply-safe",
      runtimeSessionId: "runtime-apply-safe",
      workspaceReadinessId: "ready-apply-safe",
      patchPlanId: "multifile-plan-safe",
      userConfirmed: true,
      confirmationKind: "explicit_user_multifile_apply",
      limits,
      policy: {
        host: "vscode",
        browserSupported: false,
        jetbrainsSupported: false,
        vscodeExecutionOnly: true,
        existingTextFilesOnly: true,
        boundedReplacementOnly: true,
        rawReplacementIncluded: false,
        rawDiffIncluded: false,
        fileBodyIncluded: false,
        createAllowed: false,
        deleteAllowed: false,
        renameAllowed: false,
        moveAllowed: false,
        dependencyEditAllowed: false,
        generatedEditAllowed: false,
        hiddenPathAllowed: false,
        commandAllowed: false,
        providerAllowed: false,
        toolAllowed: false,
        automaticApplyAllowed: false,
      },
      edits,
    },
  };
}

type ControlledEdit = {
  editId: string;
  operation: "replace";
  workspaceRelativePath: string;
  fileLabel: string;
  existingTextFile: true;
  expectedPreEditHash: string;
  expectedRangeHash: string;
  replacementContentHash: string;
  replacementText: string;
  startLine: number;
  endLine: number;
  replacementByteCount: number;
  sanitizedSummary: string;
};

function edit(editId: string, workspaceRelativePath: string, currentText: string, startLine: number, endLine: number, replacementText: string): ControlledEdit {
  return {
    editId,
    operation: "replace",
    workspaceRelativePath,
    fileLabel: workspaceRelativePath,
    existingTextFile: true,
    expectedPreEditHash: hashText(currentText),
    expectedRangeHash: hashText(rangeText(currentText, startLine, endLine)),
    replacementContentHash: hashText(replacementText),
    replacementText,
    startLine,
    endLine,
    replacementByteCount: Buffer.byteLength(replacementText, "utf8"),
    sanitizedSummary: "Update selected lines.",
  };
}

function rangeText(text: string, startLine: number, endLine: number): string {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n" && index + 1 < text.length) {
      starts.push(index + 1);
    }
  }
  const start = starts[startLine - 1];
  const end = endLine === starts.length ? text.length : starts[endLine];
  return text.slice(start, end);
}

function hashText(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

void main();
