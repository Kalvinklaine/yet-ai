import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vscodePluginRoot = join(repoRoot, "apps", "plugins", "vscode");
const sentinelQuery = "bounded sentinel";
const safeBody = "alpha\nbounded sentinel lives here\nomega\n";
const secondSafeBody = "intro bounded sentinel outro\n";
const privateMarker = "private-temp-path-marker";
const secretMarker = "yet-real-search-secret-marker-should-not-leak";
const commandMarker = "yet-real-search-command-marker-should-not-leak";
const rawMarker = "raw broad dump marker should not leak";
const maxSnippetBytes = 80;
const forbiddenFragments = [
  secretMarker,
  commandMarker,
  privateMarker,
  rawMarker,
  "password value",
  "api key value",
  "raw file body",
  "raw prompt",
  "raw output",
  "git status",
  "curl https://example.invalid",
  "npm test",
];

async function main() {
  execFileSync("npm", ["run", "compile"], { cwd: vscodePluginRoot, encoding: "utf8", stdio: "pipe" });
  const moduleUrl = pathToFileURL(join(vscodePluginRoot, "out", "controlledLexicalSearch.js")).href;
  const { runControlledLexicalSearchRequest, parseControlledLexicalSearchRequest } = await import(`${moduleUrl}?smoke=${Date.now()}`);
  const tempRoot = await mkdtemp(join(tmpdir(), "yet-real-controlled-search-"));
  const report = { allowed: [], denied: [] };
  try {
    const workspaceRoot = await createDisposableWorkspace(tempRoot);

    const safe = await runControlledLexicalSearchRequest(createRequest(["src/safe.ts", "docs/notes.md"]), [workspaceRoot]);
    assertAllowedSearch(safe, ["docs/notes.md", "src/safe.ts"]);
    assert.equal(JSON.stringify(safe).includes(workspaceRoot), false);
    report.allowed.push(sanitizeOutcome("safe bounded literal search", safe));

    const bounded = await runControlledLexicalSearchRequest(createRequest(["src/many.txt"], { maxMatches: 3, maxSnippetBytes: 24 }), [workspaceRoot]);
    assert.equal(bounded.payload.status, "truncated");
    assert.equal(bounded.payload.truncated, true);
    assert.equal(bounded.payload.resultCount, 3);
    assert.equal(bounded.payload.snippets.every((snippet) => snippet.snippetByteCount <= 24), true);
    assert.equal(bounded.payload.totalMatchCount, 8);
    assertNoUnexpectedAuthority(bounded);
    report.allowed.push(sanitizeOutcome("bounded truncated literal search", bounded));

    const deniedCases = [
      ["empty query", createRequest(["src/safe.ts"], { query: "" })],
      ["regex query", createRequest(["src/safe.ts"], { query: "bounded.*sentinel" })],
      ["path query", createRequest(["src/safe.ts"], { query: "../secret" })],
      ["private path query", createRequest(["src/safe.ts"], { query: "/Users/private/project" })],
      ["raw marker query", createRequest(["src/safe.ts"], { query: "raw output" })],
      ["assistant minted request", createRequest(["src/safe.ts"], { assistantMinted: true })],
      ["browser host", createRequest(["src/safe.ts"], { host: "browser" })],
      ["jetbrains host", createRequest(["src/safe.ts"], { host: "jetbrains" })],
      ["hidden path", createRequest([".hidden/file.ts"])],
      ["dependency path", createRequest(["node_modules/pkg/index.js"])],
      ["generated path", createRequest(["dist/bundle.js"])],
      ["secret path", createRequest(["src/token.txt"])],
      ["traversal path", createRequest(["../outside.txt"])],
      ["absolute path", createRequest([join(workspaceRoot, "src", "safe.ts")])],
      ["symlink path", createRequest(["src/link.ts"])],
      ["binary file", createRequest(["src/binary.txt"])],
      ["secret content", createRequest(["src/secretish.txt"])],
      ["private path content", createRequest(["src/private.txt"])],
      ["raw authority fields", createRequest(["src/safe.ts"], { command: commandMarker, provider: "model", tool: "shell", rawOutput: rawMarker })],
      ["broad scan over budget", createRequest(["src/safe.ts"], { maxFilesScanned: 201 })],
      ["glob enabled", createRequest(["src/safe.ts"], { globAllowed: true })],
      ["indexing enabled", createRequest(["src/safe.ts"], { indexingAllowed: true })],
    ];

    for (const [label, request] of deniedCases) {
      if (["empty query", "regex query", "path query", "private path query", "raw marker query", "assistant minted request", "browser host", "jetbrains host", "raw authority fields", "broad scan over budget", "glob enabled", "indexing enabled"].includes(label)) {
        assert.equal(parseControlledLexicalSearchRequest(request), undefined, label);
      }
      const result = await runControlledLexicalSearchRequest(request, [workspaceRoot]);
      assertDeniedSearch(result, label);
      report.denied.push(sanitizeOutcome(label, result));
    }

    assert.equal(report.allowed.length, 2);
    assert.equal(report.denied.length, deniedCases.length);
    assertNoLeaks(report, tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  assertNoLeaks(report, dirname(fileURLToPath(import.meta.url)));
  console.log("Controlled agent real lexical search smoke passed.");
  console.log(`Verified ${report.allowed.length} bounded VS Code lexical search outcomes and ${report.denied.length} fail-closed unsafe cases with sanitized metadata only.`);
}

async function createDisposableWorkspace(tempRoot) {
  const workspaceRoot = join(tempRoot, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await mkdir(join(workspaceRoot, "docs"), { recursive: true });
  await mkdir(join(workspaceRoot, ".hidden"), { recursive: true });
  await mkdir(join(workspaceRoot, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(workspaceRoot, "dist"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ label: "real bounded lexical search smoke", privatePath: privateMarker })}\n`, "utf8");
  await writeFile(join(workspaceRoot, "src", "safe.ts"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, "docs", "notes.md"), secondSafeBody, "utf8");
  await writeFile(join(workspaceRoot, "src", "many.txt"), Array.from({ length: 8 }, (_, index) => `bounded sentinel ${index} safe text`).join("\n"), "utf8");
  await writeFile(join(workspaceRoot, ".hidden", "file.ts"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, "node_modules", "pkg", "index.js"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, "dist", "bundle.js"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, "src", "token.txt"), safeBody, "utf8");
  await writeFile(join(workspaceRoot, "src", "binary.txt"), Buffer.from([0, 1, 2, 3, 4]));
  await writeFile(join(workspaceRoot, "src", "secretish.txt"), `bounded sentinel ${secretMarker} password value\n`, "utf8");
  await writeFile(join(workspaceRoot, "src", "private.txt"), "bounded sentinel /Users/private/project\n", "utf8");
  await writeFile(join(tempRoot, "outside.txt"), safeBody, "utf8");
  await symlink(join(workspaceRoot, "src", "safe.ts"), join(workspaceRoot, "src", "link.ts"));
  assert.equal((await readFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), "utf8")).includes("real bounded lexical search smoke"), true);
  return workspaceRoot;
}

function createRequest(includePathLabels, overrides = {}) {
  const query = overrides.query ?? sentinelQuery;
  const requestId = `search-${String(includePathLabels[0] ?? "safe").replace(/[^A-Za-z0-9]/g, "-").slice(0, 36) || "safe"}`;
  const payload = {
    requestId,
    requestIdMintedBy: overrides.requestIdMintedBy ?? "gui",
    source: overrides.source ?? "gui",
    assistantMinted: overrides.assistantMinted ?? false,
    controlledWorkspaceId: "workspace-real-search",
    runId: "run-real-search",
    runtimeSessionId: "runtime-real-search",
    workspaceReadinessId: "ready-real-search",
    explicitUserGesture: true,
    userGestureId: "gesture-real-search",
    host: overrides.host ?? "vscode",
    query,
    queryMode: "literal_text",
    scope: {
      kind: "controlled_workspace_bounded",
      controlledWorkspaceOnly: true,
      includePathLabels,
      excludeHidden: true,
      excludeDependencies: true,
      excludeGenerated: true,
      excludeBinary: true,
      excludeSecretLikePaths: true,
      recursiveAllowed: false,
      broadWorkspaceScanAllowed: false,
    },
    limits: {
      maxFilesScanned: overrides.maxFilesScanned ?? 40,
      maxMatches: overrides.maxMatches ?? 10,
      maxSnippetBytes: overrides.maxSnippetBytes ?? maxSnippetBytes,
      literalOnly: true,
      regexAllowed: false,
      globAllowed: overrides.globAllowed ?? false,
      pathQueryAllowed: false,
      indexingAllowed: overrides.indexingAllowed ?? false,
      backgroundAllowed: false,
    },
    policyFlags: {
      explicitLiteralSearchAllowed: true,
      hiddenSearchAllowed: false,
      backgroundSearchAllowed: false,
      indexingAllowed: false,
      regexAllowed: false,
      globAllowed: false,
      pathQueryAllowed: false,
      broadWorkspaceScanAllowed: false,
      fileReadBodyAllowed: false,
      fileWriteAllowed: false,
      shellAllowed: false,
      gitAllowed: false,
      providerAllowed: false,
      toolAllowed: false,
      autoSearchAllowed: false,
      autoApplyAllowed: false,
      autoRunAllowed: false,
    },
  };
  const message = { version: "2026-05-15", type: "gui.controlledAgentLexicalSearchRequest", requestId, payload };
  if ("command" in overrides || "provider" in overrides || "tool" in overrides || "rawOutput" in overrides) {
    return { ...message, payload: { ...payload, command: overrides.command, provider: overrides.provider, tool: overrides.tool, rawOutput: overrides.rawOutput } };
  }
  return message;
}

function assertAllowedSearch(result, expectedPaths) {
  assert.equal(result.type, "host.controlledAgentLexicalSearchResult");
  assert.equal(result.payload.status, "succeeded");
  assert.equal(result.payload.searchAllowed, true);
  assert.equal(result.payload.privatePathExposed, false);
  assert.equal(result.payload.rawContentIncluded, false);
  assert.equal(result.payload.resultCount, expectedPaths.length);
  assert.deepEqual(result.payload.snippets.map((snippet) => snippet.pathLabel), expectedPaths);
  assert.equal(result.payload.snippets.every((snippet) => snippet.snippet.includes(sentinelQuery)), true);
  assert.equal(result.payload.snippets.every((snippet) => snippet.snippetByteCount <= maxSnippetBytes), true);
  assert.equal(result.payload.snippets.every((snippet) => /^sha256:[a-f0-9]{64}$/.test(snippet.snippetHash)), true);
  assertNoUnexpectedAuthority(result);
}

function assertDeniedSearch(result, label) {
  assert.equal(result.type, "host.controlledAgentLexicalSearchResult", label);
  assert.equal(result.payload.status, "blocked", label);
  assert.equal(result.payload.searchAllowed, false, label);
  assert.equal(result.payload.privatePathExposed, false, label);
  assert.equal(result.payload.rawContentIncluded, false, label);
  assert.equal(result.payload.snippets.length, 0, label);
  assertNoUnexpectedAuthority(result, label);
  assertNoLeaks(result, "", label);
}

function assertNoUnexpectedAuthority(result, label = "authority") {
  assert.equal(result.payload.cloudRequired, false, label);
  assert.equal(result.payload.executionAllowed, false, label);
  assert.equal(result.payload.policyFlags.backgroundSearchAllowed, false, label);
  assert.equal(result.payload.policyFlags.indexingAllowed, false, label);
  assert.equal(result.payload.policyFlags.regexAllowed, false, label);
  assert.equal(result.payload.policyFlags.globAllowed, false, label);
  assert.equal(result.payload.policyFlags.pathQueryAllowed, false, label);
  assert.equal(result.payload.policyFlags.broadWorkspaceScanAllowed, false, label);
  assert.equal(result.payload.policyFlags.fileReadBodyAllowed, false, label);
  assert.equal(result.payload.policyFlags.fileWriteAllowed, false, label);
  assert.equal(result.payload.policyFlags.shellAllowed, false, label);
  assert.equal(result.payload.policyFlags.gitAllowed, false, label);
  assert.equal(result.payload.policyFlags.providerAllowed, false, label);
  assert.equal(result.payload.policyFlags.toolAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoSearchAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoApplyAllowed, false, label);
  assert.equal(result.payload.policyFlags.autoRunAllowed, false, label);
  assert.equal("command" in result.payload, false, label);
  assert.equal("provider" in result.payload, false, label);
  assert.equal("tool" in result.payload, false, label);
  assert.equal("rawOutput" in result.payload, false, label);
}

function sanitizeOutcome(label, result) {
  const outcome = {
    label,
    status: result.payload.status,
    blockedReason: result.payload.blockedReason,
    resultCount: result.payload.resultCount,
    totalMatchCount: result.payload.totalMatchCount,
    totalSnippetBytes: result.payload.totalSnippetBytes,
    truncated: result.payload.truncated,
    pathLabels: result.payload.snippets.map((snippet) => snippet.pathLabel),
    byteCounts: result.payload.snippets.map((snippet) => snippet.snippetByteCount),
    resultHash: result.payload.resultHash,
  };
  const text = JSON.stringify(outcome);
  assert.equal(text.includes("command"), false, label);
  assert.equal(text.includes("provider"), false, label);
  assert.equal(text.includes("tool"), false, label);
  return outcome;
}

function assertNoLeaks(value, tempRoot, label = "sanitized smoke report") {
  const text = JSON.stringify(value);
  for (const fragment of [...forbiddenFragments, tempRoot, tmpdir(), homedir()].filter(Boolean)) {
    assert.equal(text.includes(fragment), false, `${label} leaked ${fragment}`);
  }
  assert.equal(/\/Users\//.test(text), false, `${label} leaked a macOS user path`);
  assert.equal(/\/tmp\//.test(text), false, `${label} leaked a temp path`);
  assert.equal(/\/home\//.test(text), false, `${label} leaked a home path`);
  assert.equal(/[A-Za-z]:\\/.test(text), false, `${label} leaked a Windows drive path`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { main as runSmoke };
