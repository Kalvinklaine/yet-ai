import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireGuiTypescript } from "./lib/require-gui-typescript.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = ["sk-proj", "PRIVATE_PATH_SENTINEL", "/Users/alice/private", "raw prompt", "raw file body", "raw diff", "raw command", "provider payload", "browser storage dump"];

function requireTypescript() {
  return requireGuiTypescript({ repoRoot, smokeName: "Controlled agent task presets smoke" });
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-task-presets-smoke-ts-"));
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

function assertNoAuthority(guidance, label) {
  assert.deepEqual(guidance.policy, {
    canAutoSend: false,
    canAutoSearch: false,
    canAutoAttachContext: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canCallProviders: false,
    canReadHiddenFiles: false,
    canUseFreeformCommands: false
  }, `${label} widened task preset authority`);
  assert.equal(guidance.authority, "draft_guidance_only", `${label} must stay draft-only`);
  assert.equal(guidance.draftPrompt.includes("Do not auto-send, auto-search, auto-attach context"), true, `${label} must expose no-auto copy`);
  assert.equal(guidance.draftPrompt.includes("Use only the explicit selected context"), true, `${label} must expose explicit-context copy`);
}

function assertNoRawLeak(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 20000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentTaskPresets.ts"]);
  try {
    const { controlledAgentTaskPresets, buildControlledAgentTaskPresetGuidance } = imports["services/controlledAgentTaskPresets.ts"];
    const calls = { send: 0, search: 0, index: 0, attach: 0, provider: 0, apply: 0, verify: 0, bridge: 0, storage: 0, command: 0, git: 0, network: 0, tool: 0 };
    const browserStorage = { localStorage: {}, sessionStorage: {} };
    assert.deepEqual(controlledAgentTaskPresets.map((preset) => preset.presetId), ["fix-small-bug", "add-focused-test", "refactor-small-function", "explain-selected-code", "improve-copy-or-typing"]);

    const guidance = [];
    for (const preset of controlledAgentTaskPresets) {
      const item = buildControlledAgentTaskPresetGuidance(preset.presetId, {
        goal: `Use ${preset.label} for selected local code`,
        selectedSearchResultCount: 1,
        selectedMemoryCount: 1,
        verificationEvidenceCount: preset.verificationSupported ? 1 : 0
      });
      assert.equal(item.kind, "controlled_agent_task_preset_guidance");
      assert.equal(item.presetId, preset.presetId);
      assert.equal(item.label, preset.label);
      assert.equal(item.useful, true);
      assert.equal(item.contextSummary.selectedSearchResultCount, 1);
      assert.equal(item.contextSummary.memoryCount, 1);
      assert.equal(item.recommendedNextSteps.length > 1, true);
      assertNoAuthority(item, preset.presetId);
      assertNoRawLeak(item, preset.presetId);
      guidance.push({ presetId: item.presetId, label: item.label, steps: item.recommendedNextSteps.length });
    }

    const unsafe = buildControlledAgentTaskPresetGuidance("fix-small-bug", {
      goal: "Fix a visible local issue",
      presetConfig: {
        presetId: "fix-small-bug",
        label: "Unsafe preset",
        hiddenSearchAllowed: true,
        automaticApplyAllowed: true,
        freeformCommandAllowed: true,
        rawPrompt: "raw prompt",
        privatePath: "/Users/alice/private/project"
      }
    });
    assert.equal(unsafe.useful, false);
    assert.equal(unsafe.diagnostics.length > 0, true);
    assert.equal(unsafe.recommendedNextSteps[0].startsWith("Stop:"), true);
    assertNoAuthority(unsafe, "unsafe preset");
    assertNoRawLeak(unsafe, "unsafe preset");

    assert.deepEqual(calls, { send: 0, search: 0, index: 0, attach: 0, provider: 0, apply: 0, verify: 0, bridge: 0, storage: 0, command: 0, git: 0, network: 0, tool: 0 });
    assert.deepEqual(browserStorage, { localStorage: {}, sessionStorage: {} });
    const report = { presetsCovered: guidance.length, unsafeBlocked: true, noAutoAuthority: true, guidance };
    assertNoRawLeak(report, "smoke report");
    return report;
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent task presets smoke passed.");
  console.log(`Verified ${report.presetsCovered} presets, unsafe preset blocking, and no auto-send/search/apply/verification authority.`);
}

export { runSmoke };
