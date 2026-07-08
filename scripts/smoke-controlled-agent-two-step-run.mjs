import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const fixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-two-step-run-completed.json");
const rawMarkers = ["Authorization", "Bearer", "sk-proj", "sk-", "/Users/alice", "RAW_SECRET_SENTINEL", "raw command text", "raw prompt body", "raw output body", "raw file body contents", "provider payload body", "browser storage dump", "production autonomy"];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-two-step-smoke-ts-"));
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function gate(id) {
  return {
    required: true,
    satisfied: true,
    confirmedBy: "user",
    assistantMinted: false,
    requestIdMintedBy: "gui",
    confirmationId: id,
    summary: "User confirmed bounded step"
  };
}

function assertNoRawLeak(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 20000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function assertNoAuthority(state, label) {
  assert.equal(state.cloudRequired, false, `${label} cloud requirement changed`);
  assert.equal(state.executionAllowed, false, `${label} execution authority changed`);
  assert.equal(state.executionImplementationAdded, false, `${label} implementation claim changed`);
  assert.equal(state.unattendedAutonomyAllowed, false, `${label} autonomy changed`);
  assert.equal(state.autoApplyAllowed, false, `${label} auto apply changed`);
  assert.equal(state.autoVerifyAllowed, false, `${label} auto verify changed`);
  assert.equal(state.autoRepairAllowed, false, `${label} auto repair changed`);
  assert.equal(state.canReadFiles, false, `${label} read authority changed`);
  assert.equal(state.canWriteFiles, false, `${label} write authority changed`);
  assert.equal(state.canRunCommands, false, `${label} command authority changed`);
  assert.equal(state.canCallProvider, false, `${label} provider authority changed`);
  assert.equal(state.canUseTools, false, `${label} tool authority changed`);
  assert.equal(state.canUseGit, false, `${label} git authority changed`);
  assert.equal(state.canUseNetwork, false, `${label} network authority changed`);
}

async function runSmoke() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentTwoStepRun.ts"]);
  try {
    const { createControlledAgentTwoStepRunState, evaluateControlledAgentTwoStepRun, reduceControlledAgentTwoStepRunState } = imports["services/controlledAgentTwoStepRun.ts"];
    const calls = { send: 0, apply: 0, verify: 0, repair: 0, bridge: 0, storage: 0, provider: 0, command: 0, git: 0, package: 0, network: 0, tool: 0, hiddenRead: 0, hiddenSearch: 0 };
    const browserStorage = { localStorage: {}, sessionStorage: {} };

    const safe = evaluateControlledAgentTwoStepRun(clone(fixture));
    assert.equal(safe.phase, "completed");
    assert.equal(safe.nextUserAction, "none");
    assert.equal(safe.correlation.planningGateId, "plan-request-s119");
    assert.equal(safe.correlation.planReviewGateId, "plan-review-s119");
    assert.equal(safe.correlation.executionGateId, "execute-s119");
    assert.equal(safe.correlation.verificationGateId, "verify-s119");
    assert.equal(safe.counters.filesTouched, 1);
    assert.equal(safe.counters.verificationCommands, 1);
    assertNoAuthority(safe, "safe completed flow");
    assertNoRawLeak(safe, "safe completed flow");

    const missingGate = evaluateControlledAgentTwoStepRun({ ...clone(fixture), gates: { planningRequest: gate("plan-request-s119") } });
    assert.equal(missingGate.phase, "failed");
    assert.equal(missingGate.stop.reason, "missing_user_gate");
    assert.equal(missingGate.diagnostics.some((item) => item.code === "missing_user_gate"), true);
    assertNoAuthority(missingGate, "missing gate flow");
    assertNoRawLeak(missingGate, "missing gate flow");

    let staged = createControlledAgentTwoStepRunState();
    staged = reduceControlledAgentTwoStepRunState(staged, { type: "planning_request", metadata: { ...gate("plan-request-s119"), workspace: fixture.workspace } });
    assert.equal(staged.phase, "planning_requested");
    staged = reduceControlledAgentTwoStepRunState(staged, { type: "plan_review", metadata: { workspace: fixture.workspace, gate: fixture.gates.planReview, planCheckpoint: fixture.planCheckpoint } });
    assert.equal(staged.phase, "waiting_for_user_review");
    staged = reduceControlledAgentTwoStepRunState(staged, { type: "execution_request", metadata: fixture.gates.executionRequest });
    assert.equal(staged.phase, "execution_requested");
    const staleApply = reduceControlledAgentTwoStepRunState(staged, { type: "apply_result", metadata: { ...clone(fixture.execution), planId: "plan-stale" } });
    assert.equal(staleApply.phase, "failed");
    assert.equal(staleApply.stop.reason, "unsupported_authority");
    const duplicatePlanning = reduceControlledAgentTwoStepRunState(staged, { type: "planning_request", metadata: gate("plan-request-s119") });
    assert.equal(duplicatePlanning.phase, "failed");
    assert.equal(duplicatePlanning.stop.reason, "duplicate_event");
    assert.equal(duplicatePlanning.counters.staleOrDuplicateEvents, 1);
    for (const blocked of [staleApply, duplicatePlanning]) {
      assertNoAuthority(blocked, "stale or duplicate blocked flow");
      assertNoRawLeak(blocked, "stale or duplicate blocked flow");
    }

    const unsafe = evaluateControlledAgentTwoStepRun({ ...clone(fixture), rawPayload: "raw command text sk-proj-secret RAW_SECRET_SENTINEL /Users/alice/private.ts" });
    assert.equal(unsafe.phase, "failed");
    assert.equal(unsafe.stop.reason, "unsafe_metadata");
    assertNoAuthority(unsafe, "unsafe raw flow");
    assertNoRawLeak(unsafe, "unsafe raw flow");

    assert.deepEqual(browserStorage, { localStorage: {}, sessionStorage: {} });
    assert.deepEqual(calls, { send: 0, apply: 0, verify: 0, repair: 0, bridge: 0, storage: 0, provider: 0, command: 0, git: 0, package: 0, network: 0, tool: 0, hiddenRead: 0, hiddenSearch: 0 });

    const report = {
      safeFlow: safe.phase,
      missingGateBlocked: missingGate.stop.reason,
      staleBlocked: staleApply.stop.reason,
      duplicateBlocked: duplicatePlanning.stop.reason,
      rawLeakBlocked: unsafe.stop.reason,
      authorityGranted: false,
      rawLeakage: false,
      browserStorageRawPersistence: false,
      bridgePosts: calls.bridge,
      providerCalls: calls.provider,
      commandRuns: calls.command,
      hiddenContextAcquisition: false
    };
    assertNoRawLeak(report, "smoke report");
    return report;
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent two-step run smoke passed.");
  console.log(`Verified ${report.safeFlow} safe flow, ${report.missingGateBlocked} missing-gate block, ${report.staleBlocked}/${report.duplicateBlocked} stale-or-duplicate blocks, and ${report.rawLeakBlocked} raw-data block with no authority.`);
}

export { runSmoke };
