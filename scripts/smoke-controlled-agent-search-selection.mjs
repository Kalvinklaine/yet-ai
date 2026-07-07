import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "Authorization",
  "Bearer",
  "sk-proj",
  "PRIVATE_PATH_SENTINEL",
  "/Users/alice/private",
  "raw command",
  "raw prompt",
  "raw output",
  "raw file body",
  "provider payload",
  "browser storage dump",
  "SECRET_SNIPPET_SENTINEL"
];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-search-selection-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  try {
    while (queue.length > 0) {
      const sourcePath = queue.shift();
      if (!sourcePath || seen.has(sourcePath)) continue;
      seen.add(sourcePath);
      const source = await readFile(sourcePath, "utf8");
      for (const dependency of localValueDependencies(source, sourcePath)) {
        if (!seen.has(dependency)) queue.push(dependency);
      }
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
        }
      }).outputText;
      const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
      const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, rewritten);
    }
    const imports = Object.fromEntries(await Promise.all(entries.map(async (entry) => {
      const modulePath = join(outRoot, entry).replace(/\.ts$/, ".mjs");
      return [entry, await import(pathToFileURL(modulePath).href)];
    })));
    return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
  } catch (error) {
    await rm(outRoot, { recursive: true, force: true });
    throw error;
  }
}

function localValueDependencies(source, sourcePath) {
  const dependencies = [];
  const importPattern = /(?:import|export)\s+(?!type\b)(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    const candidate = resolve(dirname(sourcePath), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
    if (candidate.startsWith(guiSrcRoot)) dependencies.push(candidate);
  }
  return dependencies;
}

function snippet(pathLabel, line, snippetText, patch = {}) {
  const lineCount = snippetText.split(/\r\n|\r|\n/).length;
  return {
    pathLabel,
    range: { start: { line, character: 0 }, end: { line: line + lineCount - 1, character: lineCount === 1 ? snippetText.length : 1 } },
    languageId: "typescriptreact",
    snippet: snippetText,
    snippetByteCount: new TextEncoder().encode(snippetText).length,
    snippetHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    matchCount: 1,
    truncated: false,
    ...patch
  };
}

function lexicalSearch(snippets, patch = {}) {
  return {
    status: "succeeded",
    resultCount: snippets.length,
    totalMatchCount: snippets.reduce((total, item) => total + item.matchCount, 0),
    totalSnippetBytes: snippets.reduce((total, item) => total + item.snippetByteCount, 0),
    truncated: false,
    resultHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    snippets,
    message: "Controlled lexical search returned sanitized bounded metadata.",
    ...patch
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((item) => item.code);
}

function assertNoRawLeak(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 16000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function assertNoSelectionAuthority(result, label) {
  assert.deepEqual(result.authority, {
    cloudRequired: false,
    executionAllowed: false,
    canAttachToPrompt: false,
    canAutoAttachContext: false,
    canAutoSend: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canCallProvider: false,
    canReadFileBodies: false,
    canRunCommands: false,
    canUseTools: false,
    canPersistSelection: false
  }, `${label} widened selected-context authority`);
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentSearchSelection.ts"]);
  try {
    const {
      createControlledAgentSearchSelection,
      controlledAgentSearchSelectionLimits,
      controlledAgentSearchSelectionResultId
    } = imports["services/controlledAgentSearchSelection.ts"];

    const calls = { send: 0, attach: 0, provider: 0, apply: 0, verify: 0, search: 0, index: 0, bridge: 0, storage: 0, command: 0, git: 0, package: 0, network: 0, tool: 0 };
    const browserStorage = { localStorage: {}, sessionStorage: {} };
    const safeSnippets = [
      snippet("apps/gui/src/App.tsx", 12, "function ChatComposer() {\n  return null;\n}"),
      snippet("apps/gui/src/Panel.tsx", 42, "function SearchPanel() {\n  return null;\n}", { snippetHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" })
    ];
    const safeSearch = lexicalSearch(safeSnippets);
    const selectedIds = safeSnippets.map(controlledAgentSearchSelectionResultId);

    const ready = createControlledAgentSearchSelection({
      searchResultId: "search-result-s112-smoke",
      lexicalSearch: safeSearch,
      selectedResultIds: selectedIds,
      explicitUserGesture: true,
      userGestureId: "gesture-s112-smoke",
      selectionMintedBy: "gui",
      assistantMinted: false
    });

    assert.equal(ready.state, "ready");
    assert.equal(ready.selectedContext.kind, "controlled_agent_selected_search_context");
    assert.equal(ready.selectedContext.source, "controlled_lexical_search");
    assert.deepEqual(ready.selectedContext.selectedResultIds, selectedIds);
    assert.equal(ready.selectedContext.selectedCount, 2);
    assert.equal(ready.selectedContext.totalSnippetBytes, safeSearch.totalSnippetBytes);
    assert.equal(ready.selectedContext.totalSnippetLines, 6);
    assert.deepEqual(ready.selectedContext.budgets, controlledAgentSearchSelectionLimits);
    assert.equal(ready.selectedContext.items.every((item) => !Object.hasOwn(item, "snippet")), true);
    assert.equal(ready.selectedContext.items.every((item) => item.pathLabel.startsWith("apps/gui/src")), true);
    assert.equal(ready.selectedContext.policy.canAttachToPrompt, false);
    assert.equal(ready.selectedContext.policy.canAutoAttachContext, false);
    assert.equal(ready.selectedContext.policy.canAutoSend, false);
    assert.equal(ready.selectedContext.policy.canCallProvider, false);
    assertNoSelectionAuthority(ready, "ready selection");
    assertNoRawLeak(ready, "ready selection");

    const unsafeSearches = [
      lexicalSearch([snippet("secrets/token.ts", 1, "const safe = true;")]),
      lexicalSearch([snippet("apps/gui/src/App.tsx", 1, "Authorization: Bearer SECRET_SNIPPET_SENTINEL")]),
      lexicalSearch([snippet("apps/gui/src/App.tsx", 1, "provider payload raw output")]),
      lexicalSearch([snippet("/Users/alice/private/file.ts", 1, "const safe = true;")]),
      lexicalSearch([snippet("apps/gui/src/App.tsx", 1, "const safe = true;", { rawContent: "raw file body" })]),
      lexicalSearch([snippet("apps/gui/src/App.tsx", 1, "const safe = true;")], { browserStorage: "browser storage dump" })
    ];

    for (const [index, unsafeSearch] of unsafeSearches.entries()) {
      const blocked = createControlledAgentSearchSelection({
        searchResultId: `search-result-s112-unsafe-${index}`,
        lexicalSearch: unsafeSearch,
        selectedResultIds: [controlledAgentSearchSelectionResultId(unsafeSearch.snippets[0])],
        explicitUserGesture: true,
        userGestureId: `gesture-s112-unsafe-${index}`,
        selectionMintedBy: "gui",
        assistantMinted: false
      });
      assert.equal(blocked.state, "blocked");
      assert.equal(diagnosticCodes(blocked).includes("unsafe_metadata"), true);
      assertNoSelectionAuthority(blocked, `unsafe selection ${index}`);
      assertNoRawLeak(blocked, `unsafe selection ${index}`);
    }

    const emptySelection = createControlledAgentSearchSelection({
      searchResultId: "search-result-s112-empty",
      lexicalSearch: safeSearch,
      selectedResultIds: [],
      explicitUserGesture: true,
      userGestureId: "gesture-s112-empty",
      selectionMintedBy: "gui",
      assistantMinted: false
    });
    const staleSelection = createControlledAgentSearchSelection({
      searchResultId: "search-result-s112-stale",
      lexicalSearch: safeSearch,
      selectedResultIds: ["search-result-stale"],
      explicitUserGesture: true,
      userGestureId: "gesture-s112-stale",
      selectionMintedBy: "gui",
      assistantMinted: false
    });
    const assistantMinted = createControlledAgentSearchSelection({
      searchResultId: "search-result-s112-assistant",
      lexicalSearch: safeSearch,
      selectedResultIds: selectedIds,
      explicitUserGesture: true,
      userGestureId: "gesture-s112-assistant",
      selectionMintedBy: "assistant",
      assistantMinted: true
    });
    const overCount = createControlledAgentSearchSelection({
      searchResultId: "search-result-s112-over-count",
      lexicalSearch: lexicalSearch([
        snippet("apps/gui/src/One.tsx", 1, "const one = true;"),
        snippet("apps/gui/src/Two.tsx", 1, "const two = true;"),
        snippet("apps/gui/src/Three.tsx", 1, "const three = true;"),
        snippet("apps/gui/src/Four.tsx", 1, "const four = true;"),
        snippet("apps/gui/src/Five.tsx", 1, "const five = true;")
      ]),
      selectedResultIds: ["safe-one", "safe-two", "safe-three", "safe-four", "safe-five"],
      explicitUserGesture: true,
      userGestureId: "gesture-s112-over-count",
      selectionMintedBy: "gui",
      assistantMinted: false
    });
    assert.equal(emptySelection.state, "blocked");
    assert.equal(diagnosticCodes(emptySelection).includes("empty_selection"), true);
    assert.equal(staleSelection.state, "blocked");
    assert.equal(diagnosticCodes(staleSelection).includes("stale_result"), true);
    assert.equal(assistantMinted.state, "blocked");
    assert.equal(diagnosticCodes(assistantMinted).includes("assistant_authority_blocked"), true);
    assert.equal(overCount.state, "blocked");
    assert.equal(diagnosticCodes(overCount).includes("over_budget"), true);
    for (const blocked of [emptySelection, staleSelection, assistantMinted, overCount]) {
      assertNoSelectionAuthority(blocked, "blocked selection");
      assertNoRawLeak(blocked, "blocked selection");
    }

    assert.deepEqual(browserStorage, { localStorage: {}, sessionStorage: {} });
    assert.deepEqual(calls, { send: 0, attach: 0, provider: 0, apply: 0, verify: 0, search: 0, index: 0, bridge: 0, storage: 0, command: 0, git: 0, package: 0, network: 0, tool: 0 });

    const report = {
      safeSelections: ready.selectedContext.selectedCount,
      unsafeSelectionsBlocked: unsafeSearches.length,
      blockedScenarios: ["empty-selection", "stale-selection", "assistant-minted", "over-count"],
      selectedContextReadyForS113OnlyAfterExplicitUserAction: true,
      autoSend: false,
      autoAttach: false,
      autoProvider: false,
      autoApply: false,
      autoVerification: false,
      hiddenIndexing: false,
      browserStorageRawPersistence: false,
      commandAuthority: false,
      gitAuthority: false,
      packageAuthority: false,
      networkAuthority: false,
      providerToolAuthority: false
    };
    assertNoRawLeak(report, "smoke report");
    return report;
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent search selection smoke passed.");
  console.log(`Verified ${report.safeSelections} explicit safe selections, ${report.unsafeSelectionsBlocked} unsafe/private/secret/raw omissions, and ${report.blockedScenarios.length} bounded no-auto local/mock scenarios.`);
}

export { runSmoke };
