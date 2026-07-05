import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled Agent one-step loop smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "one-step-loop-secret-should-not-leak",
  "raw prompt from one-step loop smoke",
  "raw file body from one-step loop smoke",
  "raw diff from one-step loop smoke",
  "npm run hidden-one-step-loop",
  "provider payload from one-step loop smoke",
  "shell git network package tool claim from one-step loop smoke",
  "/Users/private/one-step-loop",
  "sk-one-step-loop-secret",
];

const {
  createControlledOneStepAgentLoopState,
  reduceControlledOneStepAgentLoopState,
} = await importOneStepService();

const fileReadSuccess = await readFixture("packages/contracts/examples/engine/controlled-agent-file-read-success.json");
const fileReadBlocked = await readFixture("packages/contracts/examples/engine/controlled-agent-file-read-blocked.json");
const editPlanned = await readFixture("packages/contracts/examples/engine/controlled-agent-edit-executor-planned.json");
const commandSucceeded = await readFixture("packages/contracts/examples/engine/controlled-agent-command-runner-succeeded.json");

const started = reduceControlledOneStepAgentLoopState(createControlledOneStepAgentLoopState(), {
  type: "start",
  metadata: {
    source: "gui",
    confirmedBy: "user",
    assistantMinted: false,
    explicitUserStart: true,
    requestId: "s86-smoke-start",
    summary: "User explicitly started the S86 one-step controlled loop.",
    budgets: { maxReadBytes: 8192, maxEditBytes: 12000, maxRuntimeSeconds: 300 },
  },
});
const afterRead = reduceControlledOneStepAgentLoopState(started, { type: "read", metadata: fileReadSuccess });
const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, {
  type: "model_step",
  metadata: {
    state: "completed",
    stepCount: 1,
    sanitizedOnly: true,
    modelProposalAllowed: true,
    providerPayloadStored: false,
    providerResponseStored: false,
    summary: "Sanitized proposal metadata selected one bounded replacement edit.",
  },
});
const appliedEdit = { ...editPlanned, state: "applied" };
const afterEdit = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: appliedEdit });
const completed = reduceControlledOneStepAgentLoopState(afterEdit, { type: "verification", metadata: commandSucceeded });

assert.equal(started.phase, "start_requested", "explicit Start records the first GUI-local state");
assert.equal(afterRead.phase, "read_context", "one bounded read is accepted after Start");
assert.equal(afterProposal.phase, "model_step_pending", "one sanitized proposal step is accepted after read");
assert.equal(afterEdit.phase, "edit_applied", "one bounded replacement edit metadata step is accepted after proposal");
assert.equal(completed.phase, "completed", "one allowlisted verification completes the loop");
assert.equal(completed.stopped, true, "completed report is terminal");
assert.deepEqual(completed.counters, {
  loopSteps: 1,
  fileReads: 1,
  readBytes: 72,
  filesTouched: 1,
  editBytes: 128,
  verificationRuns: 1,
  runtimeSeconds: 0,
  userTurns: 2,
  repairAttempts: 0,
});
assert.equal(completed.authority, "one_step_loop_metadata_only", "final report authority remains metadata-only");
assert.equal(completed.summary, "Allowlisted preset completed successfully", "terminal report keeps sanitized verification summary");
assert.equal(completed.details.maxLoopSteps, 1, "report exposes bounded loop budget");
assert.equal(completed.details.maxFileReads, 1, "report exposes bounded read budget");
assert.equal(completed.details.maxVerificationRuns, 1, "report exposes bounded verification budget");
assert.equal(completed.details.maxRepairAttempts, 0, "S86 repair budget stays zero");
assertNoAuthority(completed, "completed one-step loop");
assertNoRawMarkers(completed, "completed one-step loop report");

const missingStart = reduceControlledOneStepAgentLoopState(createControlledOneStepAgentLoopState(), { type: "read", metadata: fileReadSuccess });
assert.equal(missingStart.phase, "failed", "read before Start fails closed");
assert.equal(missingStart.stop?.reason, "missing_user_start", "read before Start reports missing user start");
assertNoAuthority(missingStart, "missing-start failure");

const blockedRead = reduceControlledOneStepAgentLoopState(startLoop(), { type: "read", metadata: fileReadBlocked });
assert.equal(blockedRead.phase, "failed", "blocked read stops the loop");
assert.equal(blockedRead.stop?.reason, "read_blocked", "blocked read reason is preserved");
assertNoRawMarkers(blockedRead, "blocked read failure");

const afterSafeRead = reduceControlledOneStepAgentLoopState(startLoop(), { type: "read", metadata: fileReadSuccess });
const unsafeProposal = reduceControlledOneStepAgentLoopState(afterSafeRead, {
  type: "model_step",
  metadata: {
    state: "completed",
    stepCount: 1,
    sanitizedOnly: true,
    modelProposalAllowed: true,
    providerPayloadStored: false,
    providerResponseStored: false,
    rawPrompt: `${rawMarkers[1]} ${rawMarkers[7]}`,
    providerPayload: rawMarkers[5],
  },
});
assert.equal(unsafeProposal.phase, "failed", "unsafe proposal metadata fails closed");
assert.equal(unsafeProposal.stop?.reason, "unsafe_metadata", "unsafe proposal reports unsafe metadata");
assertNoAuthority(unsafeProposal, "unsafe proposal failure");
assertNoRawMarkers(unsafeProposal, "unsafe proposal failure");

const stopState = reduceControlledOneStepAgentLoopState(startLoop(), { type: "stop", summary: "User stopped S86 locally." });
assert.equal(stopState.phase, "stopped", "explicit Stop is terminal local state");
assert.equal(stopState.stop?.reason, "user_stop", "Stop does not request host cancellation");
assertNoAuthority(stopState, "explicit Stop state");

const disconnectState = reduceControlledOneStepAgentLoopState(startLoop(), { type: "runtime_disconnect", summary: "Runtime disconnected before more actions." });
assert.equal(disconnectState.phase, "stopped", "runtime disconnect stops locally");
assert.equal(disconnectState.stop?.reason, "runtime_disconnected", "runtime disconnect reason is preserved");
assertNoAuthority(disconnectState, "runtime disconnect state");

const repairAttempt = reduceControlledOneStepAgentLoopState(startLoop(), { type: "repair", metadata: { attempt: 1 } });
assert.equal(repairAttempt.phase, "failed", "S86 repair attempt is disabled");
assert.equal(repairAttempt.stop?.reason, "repair_disabled", "repair stop reason is preserved");
assert.equal(repairAttempt.counters.repairAttempts, 1, "repair attempt counter is bounded and visible");
assertNoAuthority(repairAttempt, "repair-disabled state");

const smokeReport = {
  smoke: smokeName,
  finalPhase: completed.phase,
  finalSummary: completed.summary,
  counters: completed.counters,
  budgets: completed.budgets,
  boundaries: {
    explicitStartRequired: true,
    boundedReadCount: completed.counters.fileReads,
    sanitizedProposalSteps: completed.counters.loopSteps,
    boundedEditFilesTouched: completed.counters.filesTouched,
    allowlistedVerificationRuns: completed.counters.verificationRuns,
    repairLoopEnabled: false,
    arbitraryShellAllowed: false,
    hiddenReadsAllowed: false,
    broadMutationAllowed: false,
    gitPackageNetworkToolAuthority: false,
    rawPersistenceAllowed: false,
  },
};
assertNoRawMarkers(smokeReport, "sanitized smoke report");

console.log(`${smokeName} passed.`);
console.log("Verified explicit Start through one bounded read, one sanitized proposal step, one bounded replacement-edit metadata step, one allowlisted verification metadata step, and a sanitized terminal report.");
console.log("Verified fail-closed missing Start, blocked read, unsafe proposal metadata, explicit Stop, runtime disconnect, and S86 repair-disabled behavior.");
console.log("This smoke is deterministic local/mock evidence only: no arbitrary shell, hidden reads/search/indexing, broad mutation, git/package/network/tool authority, raw persistence, repair loop, real-provider CI, or production autonomy claim.");

function startLoop() {
  return reduceControlledOneStepAgentLoopState(createControlledOneStepAgentLoopState(), {
    type: "start",
    metadata: {
      source: "gui",
      confirmedBy: "user",
      assistantMinted: false,
      explicitUserStart: true,
      requestId: "s86-smoke-start-secondary",
      summary: "User explicitly started the S86 one-step controlled loop.",
    },
  });
}

function assertNoAuthority(state, label) {
  assert.equal(state.cloudRequired, false, `${label} cloudRequired stays false`);
  assert.equal(state.executionAllowed, false, `${label} executionAllowed stays false`);
  assert.equal(state.agentStartAllowed, false, `${label} agentStartAllowed stays false`);
  assert.equal(state.autoStartAllowed, false, `${label} autoStartAllowed stays false`);
  assert.equal(state.canReadFiles, false, `${label} canReadFiles stays false`);
  assert.equal(state.canWriteFiles, false, `${label} canWriteFiles stays false`);
  assert.equal(state.canRunCommands, false, `${label} canRunCommands stays false`);
  assert.equal(state.canApplyEdits, false, `${label} canApplyEdits stays false`);
  assert.equal(state.canCallProvider, false, `${label} canCallProvider stays false`);
  assert.equal(state.canUseGit, false, `${label} canUseGit stays false`);
  assert.equal(state.canUseNetwork, false, `${label} canUseNetwork stays false`);
  assert.equal(state.canUseTools, false, `${label} canUseTools stays false`);
  assert.equal(state.canInstallPackages, false, `${label} canInstallPackages stays false`);
  assert.equal(state.canRepair, false, `${label} canRepair stays false`);
}

function assertNoRawMarkers(value, source) {
  const text = JSON.stringify(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker ${index + 1} leaked through ${source}`);
  }
  assert.equal(text.includes("# 013 agent run readiness milestone"), false, `Raw read body leaked through ${source}`);
  assert.equal(text.includes("this bounded excerpt is explicit"), false, `Raw read excerpt leaked through ${source}`);
}

async function readFixture(path) {
  return JSON.parse(await readFile(join(repoRoot, path), "utf8"));
}

async function importOneStepService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledOneStepAgentLoop.ts"]);
  try {
    return imports.get("services/controlledOneStepAgentLoop.ts");
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
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-one-step-loop-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const sourcePath = queue[index];
    if (seen.has(sourcePath)) {
      continue;
    }
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = join(dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) {
        queue.push(dependency);
      }
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
