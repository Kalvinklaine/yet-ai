import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const plannedFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-verification-bundle-planned.json");
const succeededFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-verification-bundle-succeeded.json");
const rawMarkers = ["Authorization", "Bearer", "sk-proj", "sk-", "/Users/alice", "RAW_SECRET_SENTINEL", "raw command", "raw output", "raw diff", "provider payload", "replacement text", "cwd", "env"];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-verification-followup-smoke-ts-"));
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

function assertNoRawLeak(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 24000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function matchingBundle(correlation, fixture, status = "succeeded") {
  const bundle = clone(fixture);
  bundle.workspace.controlledWorkspaceId = correlation.controlledWorkspaceId;
  bundle.workspace.runId = correlation.runId;
  bundle.workspace.workspaceReadinessId = correlation.workspaceReadinessId;
  bundle.bundle.bundleId = correlation.bundleId;
  bundle.bundle.commands.push({ ...bundle.bundle.commands[1], stepId: "step-s117-engine", sequenceIndex: 2, commandId: "engine-chat-tests", status: "succeeded", exitCode: 0, resultHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333", outputTail: "Engine chat tests completed with bounded sanitized evidence.", summary: "Engine chat tests passed with local deterministic evidence." });
  bundle.bundle.requestedCommandCount = 3;
  bundle.aggregateResult.commandCount = 3;
  if (status === "failed") {
    bundle.bundle.commands[1].status = "failed";
    bundle.bundle.commands[1].exitCode = 1;
    bundle.bundle.commands[1].summary = "GUI app tests failed with bounded local evidence.";
    bundle.bundle.commands[1].outputTail = "GUI app tests reported a bounded failure category.";
    bundle.bundle.summary = "One user approved check reported a bounded failure category.";
    bundle.aggregateResult.status = "failed";
    bundle.aggregateResult.succeededCount = 1;
    bundle.aggregateResult.failedCount = 1;
    bundle.aggregateResult.truncated = true;
    bundle.aggregateResult.commandCount = 3;
    bundle.aggregateResult.summary = "One user approved check reported a bounded failure category.";
  }
  return bundle;
}

async function runSmoke() {
  const planned = JSON.parse(await readFile(plannedFixturePath, "utf8"));
  const succeeded = JSON.parse(await readFile(succeededFixturePath, "utf8"));
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentVerificationBundle.ts", "services/controlledAgentVerificationFollowup.ts"]);
  try {
    const { buildControlledAgentVerificationBundleRequest } = imports["services/controlledAgentVerificationBundle.ts"];
    const { buildControlledAgentVerificationFollowup } = imports["services/controlledAgentVerificationFollowup.ts"];
    const calls = { send: 0, bridge: 0, provider: 0, repair: 0, apply: 0, verify: 0, storage: 0, hiddenRead: 0 };

    const request = buildControlledAgentVerificationBundleRequest({ host: "vscode", bundleMetadata: planned, userConfirmed: true, requestSeed: "followup-smoke" });
    assert.equal(request.state, "ready");
    assert.ok(request.correlation);

    const safe = buildControlledAgentVerificationFollowup({ current: request.correlation, bundleResult: matchingBundle(request.correlation, succeeded), userSelectedNextAction: "suggest_manual_next_step" });
    assert.equal(safe.state, "ready");
    assert.equal(safe.draft.manualActionPolicy.requiresExplicitUserSendClick, true);
    assert.equal(safe.draft.manualActionPolicy.noAutomaticProviderSend, true);
    assert.equal(safe.draft.contextPolicy.forbidRawStdoutStderr, true);
    assert.equal(safe.draft.followupProposal.requiresUserSend, true);
    assertNoRawLeak(safe, "safe follow-up draft");

    const failed = buildControlledAgentVerificationFollowup({ current: request.correlation, bundleResult: matchingBundle(request.correlation, succeeded, "failed"), userSelectedNextAction: "draft_manual_fix_prompt" });
    assert.equal(failed.state, "ready");
    assert.equal(failed.draft.followupProposal.intent, "fix");
    assert.equal(failed.draft.sourceBundle.failedCount, 1);
    assertNoRawLeak(failed, "failed-verification fix draft");

    const staleBundle = matchingBundle(request.correlation, succeeded);
    staleBundle.workspace.runId = "other-run";
    const stale = buildControlledAgentVerificationFollowup({ current: request.correlation, bundleResult: staleBundle, userSelectedNextAction: "explain_result" });
    assert.equal(stale.state, "blocked");
    assert.equal(stale.diagnostics.some((item) => item.code === "stale_lineage"), true);
    assertNoRawLeak(stale, "stale lineage block");

    const unsafeBundle = matchingBundle(request.correlation, succeeded);
    unsafeBundle.rawStdout = "RAW_SECRET_SENTINEL Authorization Bearer sk-proj-secret /Users/alice/private";
    const unsafe = buildControlledAgentVerificationFollowup({ current: request.correlation, bundleResult: unsafeBundle, userSelectedNextAction: "suggest_manual_next_step" });
    assert.equal(unsafe.state, "blocked");
    assert.equal(unsafe.diagnostics.some((item) => item.code === "unsafe_metadata"), true);
    assertNoRawLeak(unsafe, "unsafe raw metadata block");

    assert.deepEqual(calls, { send: 0, bridge: 0, provider: 0, repair: 0, apply: 0, verify: 0, storage: 0, hiddenRead: 0 });
    return { safe: safe.state, failed: failed.draft.followupProposal.intent, stale: stale.state, unsafe: unsafe.state, authorityGranted: false, rawLeakage: false };
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent verification follow-up smoke passed.");
  console.log(`Verified ${report.safe} follow-up draft, ${report.failed} failed-verification draft, ${report.stale} stale-lineage block, and ${report.unsafe} unsafe-metadata block with no authority.`);
}

export { runSmoke };
