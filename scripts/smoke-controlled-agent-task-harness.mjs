import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireGuiTypescript } from "./lib/require-gui-typescript.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = ["raw prompt", "Raw prompt", "raw diff", "raw command", "provider payload", "browser storage", "/Users/", "sk-proj", "Authorization"];

function requireTypescript() {
  return requireGuiTypescript({ repoRoot, smokeName: "Controlled agent task harness smoke" });
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-task-harness-smoke-ts-"));
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
    const candidate = resolve(dirname(sourcePath), match[1].endsWith(".ts") ? match[1] : `${match[1]}.ts`);
    if (candidate.startsWith(guiSrcRoot)) dependencies.push(candidate);
  }
  return dependencies;
}

async function readJson(path) {
  return JSON.parse(await readFile(join(repoRoot, path), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoUnsafeLeak(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 20000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function assertNoAuthority(summary, label) {
  assert.equal(summary.policy.canAutoSend, false, `${label} auto-send must stay disabled`);
  assert.equal(summary.policy.canReadHiddenFiles, false, `${label} hidden reads must stay disabled`);
  assert.equal(summary.policy.canSearchHiddenFiles, false, `${label} hidden search must stay disabled`);
  assert.equal(summary.policy.canIndexWorkspace, false, `${label} indexing must stay disabled`);
  assert.equal(summary.policy.canAutoVerify, false, `${label} auto-verify must stay disabled`);
  assert.equal(summary.policy.canAutoRepair, false, `${label} auto-repair must stay disabled`);
  assert.equal(summary.policy.canUseFreeformCommands, false, `${label} freeform commands must stay disabled`);
  assert.equal(summary.policy.canUseProviderTools, false, `${label} provider tools must stay disabled`);
  assert.equal(summary.policy.canUseNetwork, false, `${label} network authority must stay disabled`);
  assert.equal(summary.policy.canStoreBrowserData, false, `${label} browser storage must stay disabled`);
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentTaskHarness.ts"]);
  try {
    const { evaluateControlledAgentTaskHarness } = imports["services/controlledAgentTaskHarness.ts"];
    const happy = await readJson("packages/contracts/examples/engine/controlled-agent-task-harness-vscode-happy-path.json");
    const jetbrains = await readJson("packages/contracts/examples/engine/controlled-agent-task-harness-jetbrains-partial.json");
    const browser = await readJson("packages/contracts/examples-invalid/engine/controlled-agent-task-harness-unsupported-browser-host.json");
    const stale = await readJson("packages/contracts/examples-invalid/engine/controlled-agent-task-harness-stale-lineage-accepted.json");
    const raw = await readJson("packages/contracts/examples-invalid/engine/controlled-agent-task-harness-raw-data.json");

    const calls = { bridge: 0, runtime: 0, provider: 0, read: 0, apply: 0, verify: 0, storage: 0 };
    const browserStorage = { localStorage: {}, sessionStorage: {} };

    const ready = evaluateControlledAgentTaskHarness(clone(happy));
    assert.equal(ready.state, "ready");
    assert.equal(ready.host, "vscode");
    assert.equal(ready.counters.verificationCommandCount, 2);
    assertNoAuthority(ready, "happy path");
    assertNoUnsafeLeak(ready, "happy path");

    const partial = evaluateControlledAgentTaskHarness(clone(jetbrains));
    assert.equal(partial.state, "partial_fail_closed");
    assert.equal(partial.policy.executionAllowed, false);
    assertNoUnsafeLeak(partial, "jetbrains partial");

    const unsupported = evaluateControlledAgentTaskHarness(clone(browser));
    assert.equal(unsupported.state, "unsupported");
    assert.equal(unsupported.policy.executionAllowed, false);
    assertNoUnsafeLeak(unsupported, "browser unsupported");

    const staleResult = evaluateControlledAgentTaskHarness(clone(stale));
    assert.equal(staleResult.state, "blocked");
    assert.equal(staleResult.diagnostics.some((item) => item.code === "invalid_lineage"), true);
    assertNoUnsafeLeak(staleResult, "stale lineage");

    const failedInput = clone(happy);
    failedInput.verification.state = "failed";
    failedInput.verification.summary = "User approved checks and saw sanitized failed status.";
    const failed = evaluateControlledAgentTaskHarness(failedInput);
    assert.equal(failed.state, "failed");
    assert.equal(failed.policy.canAutoRepair, false);
    assertNoUnsafeLeak(failed, "failed verification");

    const unsafeInput = clone(raw);
    unsafeInput.extra = { rawPrompt: "raw prompt /Users/alice/project sk-proj-secret", command: "npm test", browserStorageDump: "browser storage dump" };
    const unsafe = evaluateControlledAgentTaskHarness(unsafeInput);
    assert.equal(unsafe.state, "blocked");
    assert.equal(unsafe.counters.unsafeOmittedCount > 0, true);
    assert.equal(unsafe.diagnostics.some((item) => item.code === "unsafe_metadata"), true);
    assertNoUnsafeLeak(unsafe, "unsafe markers");

    assert.deepEqual(calls, { bridge: 0, runtime: 0, provider: 0, read: 0, apply: 0, verify: 0, storage: 0 });
    assert.deepEqual(browserStorage, { localStorage: {}, sessionStorage: {} });
    return { safeScenarios: 2, failClosedScenarios: 4, noAuthorityCalls: true };
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent task harness smoke passed.");
  console.log(`Verified ${report.safeScenarios} safe scenarios, ${report.failClosedScenarios} fail-closed scenarios, and no bridge/runtime/provider/storage calls.`);
}

export { runSmoke };
