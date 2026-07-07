import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawLeakMarkers = ["Bearer unsafe", "private/path", "sk-proj", "Authorization"];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-lexical-search-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  const imports = new Map();
  while (queue.length > 0) {
    const sourcePath = queue.shift();
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = join(dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) queue.push(dependency);
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  for (const entry of entries) {
    imports.set(entry, await import(`${pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href}?smoke=${Date.now()}`));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}

async function readJson(path) {
  return JSON.parse(await readFile(join(repoRoot, path), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeFromFixture(fixture) {
  const input = clone(fixture);
  input.session.sessionId = "run-s110-smoke";
  input.workspace.controlledWorkspaceId = "workspace-s110-smoke";
  input.workspace.readinessId = "ready-s110-smoke";
  input.preconditions.workspaceReadiness.readinessId = "ready-s110-smoke";
  input.preconditions.correlation.readinessId = "ready-s110-smoke";
  return input;
}

function readinessFromFixture(fixture) {
  const input = clone(fixture);
  input.isolation.readinessId = "ready-s110-smoke";
  return input;
}

function requestInput(readyRuntime, readyReadiness, overrides = {}) {
  return {
    host: "vscode",
    runtimeSessionMetadata: runtimeFromFixture(readyRuntime),
    workspaceReadinessMetadata: readinessFromFixture(readyReadiness),
    query: "chat composer",
    includePathLabels: ["apps/gui/src/App.tsx"],
    explicitUserGesture: true,
    userGestureId: "gesture-s110-smoke",
    requestSeed: "smoke",
    ...overrides,
  };
}

function resultMessage(fixture, correlation, overrides = {}) {
  const message = clone(fixture);
  message.requestId = correlation.requestId;
  message.payload.requestId = correlation.requestId;
  message.payload.controlledWorkspaceId = correlation.controlledWorkspaceId;
  message.payload.runId = correlation.runId;
  message.payload.runtimeSessionId = correlation.runtimeSessionId;
  message.payload.workspaceReadinessId = correlation.workspaceReadinessId;
  Object.assign(message.payload, overrides);
  return message;
}

function diagnosticCodes(result) {
  return result.diagnostics.map((item) => item.code);
}

function assertSanitized(value, label) {
  const output = JSON.stringify(value);
  for (const marker of rawLeakMarkers) {
    assert.equal(output.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function assertNoGrantedGuiAuthority(result, label) {
  assert.deepEqual(result.authority, {
    cloudRequired: false,
    executionAllowed: false,
    searchAllowed: false,
    canReadFileBodies: false,
    canSearchHidden: false,
    canSearchInBackground: false,
    canUseIndexing: false,
    canUseRegex: false,
    canUseGlob: false,
    canQueryPaths: false,
    canRunCommands: false,
    canWriteFiles: false,
    canUseGit: false,
    canCallProvider: false,
    canUseTools: false,
    canAutoSearch: false,
    canAttachToPrompt: false,
  }, `${label} widened GUI authority`);
}

function assertContractFixtures(engineSafe, bridgeRequest, bridgeResult, invalidNames) {
  assert.equal(engineSafe.authority, "explicit_literal_lexical_search_metadata");
  assert.equal(engineSafe.workspace.host, "vscode");
  assert.equal(engineSafe.request.source, "gui");
  assert.equal(engineSafe.request.requestIdMintedBy, "gui");
  assert.equal(engineSafe.request.assistantMinted, false);
  assert.equal(engineSafe.request.explicitUserGesture, true);
  assert.equal(engineSafe.request.queryMode, "literal_text");
  assert.equal(engineSafe.request.scope.controlledWorkspaceOnly, true);
  assert.equal(engineSafe.request.scope.recursiveAllowed, false);
  assert.equal(engineSafe.request.scope.broadWorkspaceScanAllowed, false);
  assert.equal(engineSafe.request.limits.indexingAllowed, false);
  assert.equal(engineSafe.request.limits.backgroundAllowed, false);
  assert.equal(engineSafe.request.limits.regexAllowed, false);
  assert.equal(engineSafe.request.limits.globAllowed, false);
  assert.equal(engineSafe.request.limits.pathQueryAllowed, false);
  assert.equal(engineSafe.policyFlags.providerAllowed, false);
  assert.equal(engineSafe.policyFlags.toolAllowed, false);
  assert.equal(engineSafe.policyFlags.autoSearchAllowed, false);
  assert.equal(engineSafe.policyFlags.autoApplyAllowed, false);
  assert.equal(engineSafe.policyFlags.autoRunAllowed, false);
  assert.equal(bridgeRequest.type, "gui.controlledAgentLexicalSearchRequest");
  assert.equal(bridgeRequest.payload.host, "vscode");
  assert.equal(bridgeRequest.payload.queryMode, "literal_text");
  assert.equal(bridgeResult.type, "host.controlledAgentLexicalSearchResult");
  assert.equal(bridgeResult.payload.host, "vscode");
  assert.equal(bridgeResult.payload.rawContentIncluded, false);
  assert.equal(bridgeResult.payload.privatePathExposed, false);
  assert.deepEqual(bridgeResult.payload.snippets.map((item) => Object.keys(item).sort()), [["languageId", "matchCount", "pathLabel", "range", "snippet", "snippetByteCount", "snippetHash", "truncated"].sort()]);
  for (const expected of ["assistant-minted", "browser", "jetbrains", "regex", "glob", "indexing", "private-path", "hidden-path", "secret-snippet", "provider-field", "tool-field", "raw-content-field", "broad-recursive"]) {
    assert.equal(invalidNames.some((name) => name.includes(expected)), true, `missing invalid fixture coverage for ${expected}`);
  }
}

async function runSmoke() {
  const readyRuntime = await readJson("packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json");
  const readyReadiness = await readJson("packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json");
  const engineSafe = await readJson("packages/contracts/examples/engine/controlled-agent-lexical-search-succeeded.json");
  const bridgeRequest = await readJson("packages/contracts/examples/bridge/gui-controlled-agent-lexical-search-request.json");
  const bridgeResult = await readJson("packages/contracts/examples/bridge/host-controlled-agent-lexical-search-result-succeeded.json");
  const invalidNames = [
    "engine/controlled-agent-lexical-search-assistant-minted.json",
    "engine/controlled-agent-lexical-search-broad-recursive.json",
    "engine/controlled-agent-lexical-search-browser-execution.json",
    "engine/controlled-agent-lexical-search-dependency-path.json",
    "engine/controlled-agent-lexical-search-glob-query.json",
    "engine/controlled-agent-lexical-search-hidden-path.json",
    "engine/controlled-agent-lexical-search-indexing.json",
    "engine/controlled-agent-lexical-search-jetbrains-execution.json",
    "engine/controlled-agent-lexical-search-private-path.json",
    "engine/controlled-agent-lexical-search-provider-field.json",
    "engine/controlled-agent-lexical-search-regex-query.json",
    "engine/controlled-agent-lexical-search-secret-snippet.json",
    "bridge/gui-controlled-agent-lexical-search-request-assistant-minted.json",
    "bridge/gui-controlled-agent-lexical-search-request-browser-host.json",
    "bridge/gui-controlled-agent-lexical-search-request-glob.json",
    "bridge/gui-controlled-agent-lexical-search-request-indexing.json",
    "bridge/gui-controlled-agent-lexical-search-request-jetbrains-host.json",
    "bridge/gui-controlled-agent-lexical-search-request-private-path.json",
    "bridge/gui-controlled-agent-lexical-search-request-regex.json",
    "bridge/gui-controlled-agent-lexical-search-request-tool-field.json",
    "bridge/host-controlled-agent-lexical-search-result-browser-success.json",
    "bridge/host-controlled-agent-lexical-search-result-private-path.json",
    "bridge/host-controlled-agent-lexical-search-result-raw-content-field.json",
    "bridge/host-controlled-agent-lexical-search-result-secret-snippet.json",
  ];
  assertContractFixtures(engineSafe, bridgeRequest, bridgeResult, invalidNames);

  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentLexicalSearch.ts"]);
  try {
    const { buildControlledAgentLexicalSearchRequest, correlateControlledAgentLexicalSearchResult } = imports.get("services/controlledAgentLexicalSearch.ts");
    const ready = buildControlledAgentLexicalSearchRequest(requestInput(readyRuntime, readyReadiness));
    assert.equal(ready.state, "ready");
    assert.equal(ready.bridgeRequest.type, "gui.controlledAgentLexicalSearchRequest");
    assert.equal(ready.bridgeRequest.payload.host, "vscode");
    assert.equal(ready.bridgeRequest.payload.queryMode, "literal_text");
    assert.deepEqual(ready.bridgeRequest.payload.scope.includePathLabels, ["apps/gui/src/App.tsx"]);
    assert.equal(ready.bridgeRequest.payload.scope.broadWorkspaceScanAllowed, false);
    assert.equal(ready.bridgeRequest.payload.limits.indexingAllowed, false);
    assert.equal(ready.bridgeRequest.payload.limits.backgroundAllowed, false);
    assert.equal(ready.bridgeRequest.payload.policyFlags.hiddenSearchAllowed, false);
    assert.equal(ready.bridgeRequest.payload.policyFlags.providerAllowed, false);
    assert.equal(ready.bridgeRequest.payload.policyFlags.toolAllowed, false);
    assert.equal(ready.bridgeRequest.payload.policyFlags.autoSearchAllowed, false);
    assert.equal(ready.bridgeRequest.payload.policyFlags.autoApplyAllowed, false);
    assert.equal(ready.bridgeRequest.payload.policyFlags.autoRunAllowed, false);
    assertNoGrantedGuiAuthority(ready, "ready request");
    assertSanitized(ready, "ready request");

    const browser = buildControlledAgentLexicalSearchRequest(requestInput(readyRuntime, readyReadiness, { host: "browser" }));
    const jetbrains = buildControlledAgentLexicalSearchRequest(requestInput(readyRuntime, readyReadiness, { host: "jetbrains" }));
    const unsafeQuery = buildControlledAgentLexicalSearchRequest(requestInput(readyRuntime, readyReadiness, { query: "chat.*composer" }));
    const hiddenClaim = buildControlledAgentLexicalSearchRequest(requestInput(readyRuntime, readyReadiness, { hiddenSearch: true, backgroundSearch: true, indexing: true }));
    const rawPayload = buildControlledAgentLexicalSearchRequest(requestInput(readyRuntime, readyReadiness, { rawContent: "Authorization: Bearer unsafe" }));
    assert.equal(browser.state, "unsupported");
    assert.equal(diagnosticCodes(browser).includes("browser_host"), true);
    assert.equal(jetbrains.state, "unsupported");
    assert.equal(diagnosticCodes(jetbrains).includes("unsupported_host"), true);
    assert.equal(unsafeQuery.state, "blocked");
    assert.equal(diagnosticCodes(unsafeQuery).includes("unsafe_query"), true);
    assert.equal(hiddenClaim.state, "blocked");
    assert.equal(diagnosticCodes(hiddenClaim).includes("unsafe_metadata"), true);
    assert.equal(rawPayload.state, "blocked");
    assert.equal(diagnosticCodes(rawPayload).includes("unsafe_metadata"), true);
    for (const blocked of [browser, jetbrains, unsafeQuery, hiddenClaim, rawPayload]) {
      assertNoGrantedGuiAuthority(blocked, "blocked request");
      assertSanitized(blocked, "blocked request");
    }

    const accepted = correlateControlledAgentLexicalSearchResult({ current: ready.correlation, hostMessage: resultMessage(bridgeResult, ready.correlation) });
    assert.equal(accepted.state, "accepted");
    assert.equal(accepted.lexicalSearch.status, "succeeded");
    assert.equal(accepted.lexicalSearch.resultCount, 1);
    assert.equal(accepted.lexicalSearch.snippets[0].pathLabel, "apps/gui/src/App.tsx");
    assertNoGrantedGuiAuthority(accepted, "accepted result");
    assertSanitized(accepted, "accepted result");

    const unsafeSnippet = resultMessage(bridgeResult, ready.correlation);
    unsafeSnippet.payload.snippets[0].pathLabel = "/private/path/secret.ts";
    unsafeSnippet.payload.snippets[0].snippet = "Authorization: Bearer unsafe";
    const unsafeResult = correlateControlledAgentLexicalSearchResult({ current: ready.correlation, hostMessage: unsafeSnippet });
    const widenedResultMessage = resultMessage(bridgeResult, ready.correlation);
    widenedResultMessage.payload.policyFlags.indexingAllowed = true;
    const widenedResult = correlateControlledAgentLexicalSearchResult({ current: ready.correlation, hostMessage: widenedResultMessage });
    assert.equal(unsafeResult.state, "blocked");
    assert.equal(diagnosticCodes(unsafeResult).includes("unsafe_metadata"), true);
    assert.equal(widenedResult.state, "blocked");
    assert.equal(diagnosticCodes(widenedResult).includes("invalid_authority"), true);
    assertNoGrantedGuiAuthority(unsafeResult, "unsafe result");
    assertNoGrantedGuiAuthority(widenedResult, "widened result");
    assertSanitized(unsafeResult, "unsafe result");
    assertSanitized(widenedResult, "widened result");

    const report = {
      contractFixtures: 3,
      invalidFixtureGroups: invalidNames.length,
      guiScenarios: ["vscode-ready", "browser-unsupported", "jetbrains-fail-closed", "unsafe-query", "hidden-claims", "raw-payload", "sanitized-result", "unsafe-result", "authority-widening"],
      hostExecution: false,
      providerCalls: false,
      workspaceSearch: false,
      automaticContextAttachment: false,
      automaticApply: false,
      automaticVerification: false,
    };
    assertSanitized(report, "smoke report");
    return report;
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent lexical search smoke passed.");
  console.log(`Verified ${report.contractFixtures} safe fixtures, ${report.invalidFixtureGroups} invalid fixture labels, and ${report.guiScenarios.length} local/mock GUI-service scenarios with sanitized metadata only.`);
}

export { runSmoke };
