import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vscodePluginRoot = join(repoRoot, "apps", "plugins", "vscode");
const safeBody = "export const boundedSentinel = 42;\n";
const longBody = `${"bounded preview line\n".repeat(260)}bounded preview tail\n`;
const secretMarker = "yet-real-read-secret-marker-should-not-leak";
const commandMarker = "yet-real-read-command-marker-should-not-leak";
const maxBytes = 8192;
const maxLines = 240;
const forbiddenFragments = [
  safeBody.trim(),
  longBody.slice(0, 64),
  secretMarker,
  commandMarker,
  "private-temp-path",
  "raw file body",
  "git status",
  "curl https://example.invalid",
  "npm test",
];

async function main() {
  execFileSync("npm", ["run", "compile"], { cwd: vscodePluginRoot, encoding: "utf8", stdio: "pipe" });
  const moduleUrl = pathToFileURL(join(vscodePluginRoot, "out", "controlledFileRead.js")).href;
  const { runControlledFileReadRequest } = await import(`${moduleUrl}?smoke=${Date.now()}`);
  const tempRoot = await mkdtemp(join(tmpdir(), "yet-real-controlled-read-"));
  const report = { allowed: [], denied: [] };
  try {
    const workspaceRoot = await createDisposableWorkspace(tempRoot);

    const safe = await runControlledFileReadRequest(createRequest("src/safe.ts"), [workspaceRoot]);
    assertAllowedRead(safe, "success", "src/safe.ts", safeBody);
    report.allowed.push(sanitizeOutcome("safe bounded read", safe));

    const truncated = await runControlledFileReadRequest(createRequest("src/long.txt", { maxBytes: 96, maxLines: 4 }), [workspaceRoot]);
    assertAllowedRead(truncated, "truncated", "src/long.txt", undefined);
    assert.equal(truncated.payload.result.truncated, true);
    assert.equal(truncated.payload.result.byteCount <= 96, true);
    assert.equal(truncated.payload.result.lineCount <= 4, true);
    report.allowed.push(sanitizeOutcome("truncated bounded read", truncated));

    const deniedCases = [
      ["traversal path", createRequest("../outside.txt")],
      ["absolute path", createRequest(join(workspaceRoot, "src", "safe.ts"))],
      ["hidden file", createRequest(".env")],
      ["secret path", createRequest("src/token.txt")],
      ["dependency path", createRequest("node_modules/dep/index.js")],
      ["generated path", createRequest("generated/client.ts")],
      ["build path", createRequest("dist/bundle.js")],
      ["symlink", createRequest("src/link.ts")],
      ["binary file", createRequest("src/binary.bin")],
      ["oversized file", createRequest("src/huge.txt")],
      ["glob request", createRequest("src/*.ts", { globAllowed: true })],
      ["search request", createRequest("src/safe.ts", { search: "boundedSentinel" })],
      ["index request", createRequest("src/safe.ts", { indexingAllowed: true })],
      ["budget exhaustion", createRequest("src/safe.ts", { maxBytes: maxBytes + 1 })],
      ["assistant minted request", createRequest("src/safe.ts", { assistantMinted: true, requestIdMintedBy: "host", source: "host" })],
      ["authority fields", createRequest("src/safe.ts", { command: commandMarker, cwd: tempRoot, env: { TOKEN: secretMarker }, provider: "model", tool: "shell", git: "status" })],
    ];

    for (const [label, request] of deniedCases) {
      const result = await runControlledFileReadRequest(request, [workspaceRoot]);
      assertDeniedRead(result, label);
      report.denied.push(sanitizeOutcome(label, result));
    }

    assert.equal(report.allowed.length, 2);
    assert.equal(report.denied.length, deniedCases.length);
    assertNoLeaks(report, tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  assertNoLeaks(report, dirname(fileURLToPath(import.meta.url)));
  console.log("Controlled agent real file read smoke passed.");
  console.log(`Verified ${report.allowed.length} bounded local read outcomes and ${report.denied.length} fail-closed unsafe cases with sanitized metadata only.`);
}

async function createDisposableWorkspace(tempRoot) {
  const workspaceRoot = join(tempRoot, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, "node_modules", "dep"), { recursive: true });
  await mkdir(join(workspaceRoot, "generated"), { recursive: true });
  await mkdir(join(workspaceRoot, "dist"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ label: "real bounded read smoke", privatePath: "private-temp-path" })}\n`, "utf8");
  await writeFile(join(workspaceRoot, "src", "safe.ts"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, "src", "long.txt"), longBody, "utf8");
  await writeFile(join(workspaceRoot, ".env"), secretMarker, "utf8");
  await writeFile(join(workspaceRoot, "src", "token.txt"), secretMarker, "utf8");
  await writeFile(join(workspaceRoot, "node_modules", "dep", "index.js"), "module.exports = true;\n", "utf8");
  await writeFile(join(workspaceRoot, "generated", "client.ts"), "export const generated = true;\n", "utf8");
  await writeFile(join(workspaceRoot, "dist", "bundle.js"), "console.log('bundle');\n", "utf8");
  await writeFile(join(workspaceRoot, "src", "binary.bin"), Buffer.from([0, 1, 2, 3, 4]));
  await writeFile(join(workspaceRoot, "src", "huge.txt"), "x".repeat(maxBytes + 1), "utf8");
  await writeFile(join(tempRoot, "outside.txt"), "outside workspace\n", "utf8");
  await symlink(join(workspaceRoot, "src", "safe.ts"), join(workspaceRoot, "src", "link.ts"));
  assert.equal((await readFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), "utf8")).includes("real bounded read smoke"), true);
  return workspaceRoot;
}

function createRequest(workspaceRelativePath, overrides = {}) {
  const payload = {
    requestIdMintedBy: "gui",
    source: "gui",
    assistantMinted: false,
    controlledWorkspaceId: "workspace-real-read",
    runId: "run-real-read",
    runtimeSessionId: "runtime-real-read",
    sessionId: "session-real-read",
    workspaceRelativePath,
    maxBytes,
    maxLines,
    allowBody: true,
    singleFileOnly: true,
    recursive: false,
    globAllowed: false,
    regexAllowed: false,
    indexingAllowed: false,
  };
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentFileReadRequest",
    requestId: `req-${String(workspaceRelativePath).replace(/[^A-Za-z0-9]/g, "-").slice(0, 40) || "read"}`,
    payload: { ...payload, ...overrides },
  };
}

function assertAllowedRead(result, expectedStatus, expectedPath, expectedText) {
  assert.equal(result.type, "host.controlledAgentFileReadResult");
  assert.equal(result.payload.result.status, expectedStatus);
  assert.equal(result.payload.result.bodyIncluded, true);
  assert.equal(result.payload.result.sanitizedPathLabel, expectedPath);
  assert.equal(result.payload.result.cloudRequired, false);
  assert.equal(result.payload.result.executionAllowed, false);
  assert.equal(result.payload.policyFlags.fileReadAllowed, true);
  assertNoExtraAuthority(result);
  if (expectedText !== undefined) {
    assert.equal(result.payload.result.text, expectedText);
  }
}

function assertDeniedRead(result, label) {
  assert.equal(result.type, "host.controlledAgentFileReadResult", label);
  assert.equal(result.payload.result.status, "blocked", label);
  assert.equal(result.payload.result.bodyIncluded, false, label);
  assert.equal("text" in result.payload.result, false, label);
  assert.equal(result.payload.result.cloudRequired, false, label);
  assert.equal(result.payload.result.executionAllowed, false, label);
  assertNoExtraAuthority(result, label);
}

function assertNoExtraAuthority(result, label = "authority") {
  assert.equal(result.payload.cloudRequired, false, label);
  assert.equal(result.payload.executionAllowed, false, label);
  assert.equal(result.payload.agentStartAllowed, false, label);
  assert.equal(result.payload.policyFlags.fileWriteAllowed, false, label);
  assert.equal(result.payload.policyFlags.shellAllowed, false, label);
  assert.equal(result.payload.policyFlags.gitAllowed, false, label);
  assert.equal(result.payload.policyFlags.providerAllowed, false, label);
  assert.equal(result.payload.policyFlags.toolAllowed, false, label);
  assert.equal(result.payload.policyFlags.hiddenSearchAllowed, false, label);
  assert.equal(result.payload.policyFlags.indexingAllowed, false, label);
  assert.equal(result.payload.policyFlags.binaryReadAllowed, false, label);
  assert.equal(result.payload.policyFlags.symlinkAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoStartAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoApplyAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoRunAllowed, false, label);
}

function sanitizeOutcome(label, result) {
  const outcome = {
    label,
    status: result.payload.result.status,
    blockedReason: result.payload.result.blockedReason,
    sanitizedPathLabel: result.payload.result.sanitizedPathLabel,
    byteCount: result.payload.result.byteCount,
    lineCount: result.payload.result.lineCount,
    truncated: result.payload.result.truncated,
    bodyIncluded: result.payload.result.bodyIncluded,
    authority: {
      cloudRequired: result.payload.cloudRequired,
      executionAllowed: result.payload.executionAllowed,
      shellAllowed: result.payload.policyFlags.shellAllowed,
      gitAllowed: result.payload.policyFlags.gitAllowed,
      providerAllowed: result.payload.policyFlags.providerAllowed,
      toolAllowed: result.payload.policyFlags.toolAllowed,
    },
  };
  assert.equal(JSON.stringify(outcome).includes("text"), false, label);
  return outcome;
}

function assertNoLeaks(value, tempRoot) {
  const text = JSON.stringify(value);
  for (const fragment of [...forbiddenFragments, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(fragment), false, `sanitized smoke report leaked ${fragment}`);
  }
  assert.equal(/\/Users\//.test(text), false, "sanitized smoke report leaked a macOS user path");
  assert.equal(/\/tmp\//.test(text), false, "sanitized smoke report leaked a temp path");
  assert.equal(/\/home\//.test(text), false, "sanitized smoke report leaked a home path");
  assert.equal(/[A-Za-z]:\\/.test(text), false, "sanitized smoke report leaked a Windows drive path");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { main as runSmoke };
