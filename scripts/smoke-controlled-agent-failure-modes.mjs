import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled agent failure-mode smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const fixtureRoot = join(repoRoot, "packages", "contracts", "examples", "engine");
const rawMarkers = [
  "controlled-failure-mode-secret-should-not-leak",
  "raw prompt from controlled failure-mode smoke",
  "raw file body from controlled failure-mode smoke",
  "raw diff from controlled failure-mode smoke",
  "npm run hidden-controlled-failure-mode",
  "/Users/private/controlled-failure-mode",
  "sk-controlled-failure-mode-secret",
];

const readyReadiness = await readFixture("controlled-agent-workspace-readiness-worktree.json");
const failedCommand = await readFixture("controlled-agent-command-runner-failed.json");
const killedCommand = await readFixture("controlled-agent-command-runner-killed.json");
const timedOutCommand = await readFixture("controlled-agent-command-runner-timed_out.json");
const plannedEdit = await readFixture("controlled-agent-edit-executor-planned.json");
const { initializeControlledAgentRunState, reduceControlledAgentRunState } = await importRunStateService();
const { buildControlledAgentProgressReport } = await importProgressReportService();
const report = { blocked: [], stopped: [], failed: [], surfaced: [] };

const ready = initializeControlledAgentRunState({
  readiness: readyReadiness,
  userOptIn: { source: "user", confirmed: true, requestId: "failure-mode-opt-in" },
  limits: { maxSteps: 6, maxFileReads: 2, maxReadBytes: 4096, maxTouchedFiles: 2, maxPatchBytes: 4096, maxRuntimeSeconds: 30, maxRepairAttempts: 0 },
});
assert.equal(ready.phase, "workspace_ready", "smoke starts from explicit opt-in readiness metadata");
assertNoAuthority(ready, "ready state");

const unsafeEvent = reduceControlledAgentRunState(ready, {
  type: "wait",
  summary: "Review safe metadata.",
  rawPrompt: rawMarkers[1],
  rawFile: rawMarkers[2],
  rawDiff: rawMarkers[3],
  rawCommand: rawMarkers[4],
  privatePath: rawMarkers[5],
  token: rawMarkers[6],
});
assert.equal(unsafeEvent.phase, "blocked", "unsafe event metadata blocks the run");
assert.equal(unsafeEvent.stop?.reason, "unsafe_metadata", "unsafe event uses sanitized unsafe_metadata reason");
report.blocked.push({ label: "unsafe event", reason: unsafeEvent.stop?.reason });

const terminal = reduceControlledAgentRunState(ready, { type: "stop", reason: "stop_requested", summary: "User reviewed stop metadata." });
const duplicateComplete = reduceControlledAgentRunState(terminal, { type: "complete", summary: "Do not resurrect terminal state." });
const duplicateWorkspaceReady = reduceControlledAgentRunState(terminal, { type: "workspace_ready", summary: "Do not restart terminal state." });
assert.deepEqual(duplicateComplete, terminal, "duplicate complete event cannot resurrect a stopped run");
assert.deepEqual(duplicateWorkspaceReady, terminal, "duplicate workspace_ready event cannot resurrect a stopped run");
report.stopped.push({ label: "duplicate terminal", reason: terminal.stop?.reason });

const explicitTimeout = reduceControlledAgentRunState(ready, { type: "failed", reason: "timeout" });
assert.equal(explicitTimeout.phase, "failed", "explicit timeout is terminal");
assert.equal(explicitTimeout.stop?.reason, "timeout", "explicit timeout reason is preserved");
assert.equal(explicitTimeout.stopped, true, "explicit timeout stops the run");
report.failed.push({ label: "explicit timeout", reason: explicitTimeout.stop?.reason });

const runtimeLimit = reduceControlledAgentRunState(ready, { type: "tick", runtimeSeconds: 31 });
assert.equal(runtimeLimit.phase, "blocked", "runtime limit blocks the run");
assert.equal(runtimeLimit.stop?.reason, "runtime_limit", "runtime limit reason is surfaced as bounded metadata");
assert.equal(runtimeLimit.stopped, true, "runtime limit stops the run");
report.blocked.push({ label: "runtime limit", reason: runtimeLimit.stop?.reason });

const stuck = reduceControlledAgentRunState(ready, { type: "failed", reason: "stuck_no_heartbeat" });
assert.equal(stuck.phase, "failed", "stuck heartbeat state is terminal");
assert.equal(stuck.stop?.reason, "stuck_no_heartbeat", "stuck/no heartbeat reason is preserved");
assert.equal(stuck.stop?.recoverable, true, "stuck/no heartbeat remains recoverable metadata");
report.failed.push({ label: "stuck heartbeat", reason: stuck.stop?.reason });

const malformedEdit = reduceControlledAgentRunState(ready, { type: "edit", metadata: { ...plannedEdit, rawDiff: rawMarkers[3] } });
assert.equal(malformedEdit.phase, "blocked", "malformed edit metadata blocks the run");
assert.equal(malformedEdit.stop?.reason, "policy_blocked", "malformed edit blocks with policy metadata only");
report.blocked.push({ label: "malformed edit", reason: malformedEdit.stop?.reason });

const malformedHashEdit = reduceControlledAgentRunState(ready, { type: "edit", metadata: { ...plannedEdit, edits: plannedEdit.edits.map((edit) => ({ ...edit, expectedContentHash: "not-a-hash" })) } });
assert.equal(malformedHashEdit.phase, "blocked", "malformed edit hash metadata blocks the run");
assert.equal(malformedHashEdit.stop?.reason, "policy_blocked", "malformed edit hash blocks with policy metadata only");
report.blocked.push({ label: "malformed edit hash", reason: malformedHashEdit.stop?.reason });

const editHashMismatch = reduceControlledAgentRunState(ready, { type: "failed", reason: "edit_hash_mismatch" });
assert.equal(editHashMismatch.phase, "failed", "edit hash mismatch failure is terminal");
assert.equal(editHashMismatch.stop?.reason, "edit_hash_mismatch", "edit hash mismatch reason is surfaced");
report.failed.push({ label: "edit hash mismatch", reason: editHashMismatch.stop?.reason });

const failedVerification = reduceControlledAgentRunState(ready, { type: "command", metadata: failedCommand });
assert.equal(failedVerification.phase, "failed", "failed verification is terminal failed");
assert.equal(failedVerification.stop?.reason, "verification_failed", "failed verification reason is surfaced");
assert.equal(failedVerification.stopped, true, "failed verification stops the run");
report.failed.push({ label: "failed verification", reason: failedVerification.stop?.reason });

const killedVerification = reduceControlledAgentRunState(ready, { type: "command", metadata: killedCommand });
assert.equal(killedVerification.phase, "stopped", "killed verification is terminal stopped");
assert.equal(killedVerification.stop?.reason, "verification_killed", "killed verification reason is surfaced");
assert.equal(killedVerification.stopped, true, "killed verification stops the run");
report.stopped.push({ label: "killed verification", reason: killedVerification.stop?.reason });

const timedOutVerification = reduceControlledAgentRunState(ready, { type: "command", metadata: timedOutCommand });
assert.equal(timedOutVerification.phase, "failed", "timed-out verification is terminal failed");
assert.equal(timedOutVerification.stop?.reason, "verification_timeout", "timed-out verification reason is surfaced");
assert.equal(timedOutVerification.stopped, true, "timed-out verification stops the run");
report.failed.push({ label: "timed-out verification", reason: timedOutVerification.stop?.reason });

const malformedProvider = reduceControlledAgentRunState(ready, { type: "failed", reason: "malformed_provider_response" });
assert.equal(malformedProvider.phase, "failed", "malformed provider response is terminal failed");
assert.equal(malformedProvider.stop?.reason, "malformed_provider_response", "malformed provider reason is enum metadata only");
report.failed.push({ label: "malformed provider metadata", reason: malformedProvider.stop?.reason });

const progressReports = {
  unsafe: buildControlledAgentProgressReport({ runState: unsafeEvent, rawPrompt: rawMarkers[1], rawDiff: rawMarkers[3], commandRunner: { state: "running", rawCommand: rawMarkers[4], privatePath: rawMarkers[5] } }),
  timeout: buildControlledAgentProgressReport({ runState: explicitTimeout }),
  stuck: buildControlledAgentProgressReport({ runState: stuck }),
  failedVerification: buildControlledAgentProgressReport({ runState: failedVerification, commandRunner: { state: "failed", durationMs: 3450 } }),
  killedVerification: buildControlledAgentProgressReport({ runState: killedVerification, commandRunner: { state: "killed", durationMs: 4800 } }),
};
assert.equal(progressReports.unsafe.status, "blocked", "unsafe progress report is blocked");
assert.ok(progressReports.unsafe.diagnostics.includes("unsafe_metadata"), "unsafe progress report includes sanitized diagnostic");
assert.equal(progressReports.timeout.finalReport?.reason, "timeout", "timeout final report surfaces reason");
assert.equal(progressReports.stuck.finalReport?.reason, "stuck no heartbeat", "stuck final report surfaces sanitized reason");
assert.equal(progressReports.failedVerification.finalReport?.reason, "verification failed", "failed verification final report surfaces reason");
assert.equal(progressReports.killedVerification.finalReport?.reason, "verification killed", "killed verification final report surfaces reason");
for (const [label, progress] of Object.entries(progressReports)) {
  assertNoProgressAuthority(progress, `${label} progress`);
  report.surfaced.push({ label, status: progress.status, reason: progress.finalReport?.reason });
}

assertNoRawMarkers({ report, unsafeEvent, terminal, explicitTimeout, runtimeLimit, stuck, malformedEdit, malformedHashEdit, editHashMismatch, failedVerification, killedVerification, timedOutVerification, malformedProvider, progressReports }, "failure-mode smoke result");
console.log(`${smokeName} passed.`);
console.log(`Verified ${report.blocked.length} blocked, ${report.failed.length} failed, ${report.stopped.length} stopped, and ${report.surfaced.length} sanitized progress failure/stuck metadata cases.`);

async function readFixture(fileName) {
  return JSON.parse(await readFile(join(fixtureRoot, fileName), "utf8"));
}

async function importRunStateService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentRunState.ts"]);
  try {
    return imports.get("services/controlledAgentRunState.ts");
  } finally {
    await cleanup();
  }
}

async function importProgressReportService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentProgressReport.ts"]);
  try {
    return imports.get("services/controlledAgentProgressReport.ts");
  } finally {
    await cleanup();
  }
}

function assertNoAuthority(state, label) {
  for (const key of ["cloudRequired", "executionAllowed", "agentStartAllowed", "autoStartAllowed", "canReadFiles", "canWriteFiles", "canRunCommands", "canApplyEdits", "canCallProvider", "canUseGit", "canUseTools", "canAutoRollback", "canStartAutonomousLoop"]) {
    assert.equal(state[key], false, `${label} ${key} must stay false`);
  }
}

function assertNoProgressAuthority(progress, label) {
  for (const key of ["cloudRequired", "executionAllowed", "agentStartAllowed", "autoStartAllowed", "canReadFiles", "canWriteFiles", "canRunCommands", "canApplyEdits", "canCallProvider", "canUseGit", "canUseTools", "canAutoRollback", "canStartAutonomousLoop"]) {
    assert.equal(progress.safetyFlags[key], false, `${label} ${key} must stay false`);
  }
}

function assertNoRawMarkers(value, source) {
  const text = JSON.stringify(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker ${index + 1} leaked through ${source}`);
  }
  for (const marker of [tmpdir(), homedir()]) {
    assert.equal(text.includes(marker.toLowerCase()), false, `${source} leaked local path marker`);
  }
  assert.equal(/\/(?:Users|home|tmp|private)\//i.test(text), false, `${source} leaked a private path`);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(text), false, `${source} leaked a provider-style secret`);
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-failure-modes-smoke-ts-"));
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
