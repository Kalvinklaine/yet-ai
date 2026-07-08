import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled Agent recovery matrix smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "raw recovery output from smoke",
  "npm run hidden-recovery",
  "provider recovery payload",
  "/Users/private/recovery-matrix",
  "sk-recovery-matrix-secret",
  "BEGIN PRIVATE KEY",
];

const { evaluateControlledAgentRecoveryMatrix } = await importRecoveryMatrixService();

const cases = [
  ["stop_requested", 0],
  ["stop_completed", 0],
  ["stale_duplicate_result", 0],
  ["host_disconnect_runtime_restart", 1],
  ["provider_timeout", 1],
  ["edit_hash_mismatch", 0],
  ["verification_bundle_failure", 1],
  ["repair_followup_exhausted", 0],
  ["checkpoint_rollback_review", 0],
  ["unsupported_host", 0],
];

for (const [userVisibleState, maxAttempts] of cases) {
  const result = evaluateControlledAgentRecoveryMatrix({
    userVisibleState,
    terminal: userVisibleState === "stop_completed" || userVisibleState === "repair_followup_exhausted" || userVisibleState === "unsupported_host",
    attemptBudget: { maxAttempts, attemptsUsed: 0, moreAttemptsAllowed: maxAttempts > 0, requiresUserConfirmation: true },
    privacy: { sanitizedOnly: true, rawOutputStored: false, privatePathStored: false, secretStored: false },
    policyFlags: { hiddenRetryAllowed: false, automaticRollbackAllowed: false, hiddenRepairAllowed: false, staleResultAccepted: false, rawOutputPersistenceAllowed: false, privatePathPersistenceAllowed: false, secretPersistenceAllowed: false, unboundedRepairAllowed: false, unsupportedHostClaimsSupport: false },
  });
  assert.equal(result.state, "ready", `${userVisibleState} is ready display guidance`);
  assert.equal(result.authority.executionAllowed, false, `${userVisibleState} cannot execute`);
  assert.equal(result.authority.canAutoRetry, false, `${userVisibleState} cannot auto retry`);
  assert.equal(result.authority.canAutoRollback, false, `${userVisibleState} cannot auto rollback`);
  assert.equal(result.authority.canAutoRepair, false, `${userVisibleState} cannot auto repair`);
  assert.equal(result.authority.canMutateWorkspace, false, `${userVisibleState} cannot mutate workspace`);
  assert.equal(result.authority.canCallProvider, false, `${userVisibleState} cannot call provider`);
  assert.equal(result.authority.canRunCommands, false, `${userVisibleState} cannot run commands`);
  assert.equal(result.authority.canUseTools, false, `${userVisibleState} cannot use tools`);
  assert.equal(result.authority.canUseGit, false, `${userVisibleState} cannot use git`);
  assert.equal(result.authority.canUseNetwork, false, `${userVisibleState} cannot use network`);
  assert.equal(result.authority.canPersistRawOutput, false, `${userVisibleState} cannot persist raw output`);
  assert.equal(result.authority.canPersistPrivatePath, false, `${userVisibleState} cannot persist private paths`);
  assert.equal(result.authority.canPersistSecrets, false, `${userVisibleState} cannot persist secrets`);
  assert.equal(result.allowedManualNextActions.every((action) => action.manualOnly === true && action.actionPayload === null), true, `${userVisibleState} actions are manual-only`);
  assertNoRawMarkers(result, userVisibleState);
}

const unsafeAutomatic = evaluateControlledAgentRecoveryMatrix({ userVisibleState: "provider_timeout", autoRetry: true, policyFlags: { automaticRollbackAllowed: true } });
assert.equal(unsafeAutomatic.state, "blocked", "automatic recovery claims block guidance");
assert.equal(unsafeAutomatic.diagnostics.some((item) => item.code === "automatic_recovery_blocked"), true, "automatic diagnostic is present");
assert.equal(unsafeAutomatic.allowedManualNextActions.length, 0, "blocked automatic recovery has no actions");

const staleAccepted = evaluateControlledAgentRecoveryMatrix({ userVisibleState: "stale_duplicate_result", resultAccepted: true });
assert.equal(staleAccepted.state, "blocked", "stale accepted result blocks guidance");
assert.equal(staleAccepted.diagnostics.some((item) => item.code === "stale_acceptance_blocked"), true, "stale acceptance diagnostic is present");

const unsafeRaw = evaluateControlledAgentRecoveryMatrix({ userVisibleState: "verification_bundle_failure", rawOutput: rawMarkers[0], privatePath: rawMarkers[3], secret: rawMarkers[4] });
assert.equal(unsafeRaw.state, "blocked", "raw/private/secret metadata blocks guidance");
assert.equal(unsafeRaw.diagnostics.some((item) => item.code === "unsafe_metadata"), true, "unsafe metadata diagnostic is present");
assertNoRawMarkers(unsafeRaw, "unsafe blocked result");

const unsupportedOverclaim = evaluateControlledAgentRecoveryMatrix({ userVisibleState: "unsupported_host", hostSupportClaimed: true });
assert.equal(unsupportedOverclaim.state, "blocked", "unsupported host overclaim blocks guidance");
assert.equal(unsupportedOverclaim.diagnostics.some((item) => item.code === "unsupported_host_overclaim"), true, "unsupported overclaim diagnostic is present");

const componentSources = [
  await readFile(join(guiSrcRoot, "components", "AgentRunPanel.tsx"), "utf8"),
  await readFile(join(guiSrcRoot, "components", "ControlledAgentRunPanel.tsx"), "utf8"),
].join("\n");
for (const required of ["Controlled recovery guidance", "S120 recovery guidance", "no auto retry/rollback/repair", "Browser remains unsupported", "JetBrains remains partial/fail-closed", "No automatic retry, rollback, repair, apply, verification, provider call, hidden read"]) {
  assert.equal(componentSources.includes(required), true, `UI source includes ${required}`);
}
assert.equal(/onClick=\{\s*on(?:Retry|Rollback|Repair)|executeRollback/i.test(componentSources), false, "recovery guidance does not wire recovery action handlers");
assert.equal(/\bauto(?:Retry|Rollback|Repair)\s*=/.test(componentSources), false, "recovery guidance does not expose automatic recovery controls");
assertNoRawMarkers(componentSources, "component sources");

console.log(`${smokeName} passed.`);
console.log("Verified all S120 recovery states, fail-closed unsafe claims, sanitized/manual-only guidance, unsupported-host limitation copy, and no automatic recovery wiring.");
console.log("This smoke is deterministic local/mock evidence only: no runtime, provider, network, bridge, file read, apply, verification, shell, git, tool, storage, or workspace mutation authority.");

function assertNoRawMarkers(value, source) {
  const text = JSON.stringify(value).toLowerCase();
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker leaked through ${source}: ${marker}`);
  }
}

async function importRecoveryMatrixService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentRecoveryMatrix.ts"]);
  try {
    return imports.get("services/controlledAgentRecoveryMatrix.ts");
  } finally {
    await cleanup();
  }
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-recovery-matrix-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const sourcePath = queue[index];
    if (seen.has(sourcePath)) continue;
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
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  const imports = new Map();
  for (const entry of entries) {
    imports.set(entry, await import(pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}
