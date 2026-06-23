import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "sk-agent-run-apply-secret",
  "access_token",
  "Authorization",
  "Bearer",
  "raw diff",
  "raw file body",
  "npm run check",
  "--watch",
  "\"cwd\"",
  "\"env\"",
  "PRIVATE_TEMP_PATH",
  "/Users/",
  "C:\\Users\\",
  "src/applySmoke.ts",
];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-agent-run-apply-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  try {
    while (queue.length > 0) {
      const sourcePath = queue.shift();
      if (!sourcePath || seen.has(sourcePath)) {
        continue;
      }
      seen.add(sourcePath);
      const source = await readFile(sourcePath, "utf8");
      for (const dependency of localValueDependencies(source, sourcePath)) {
        if (!seen.has(dependency)) {
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
    if (candidate.startsWith(guiSrcRoot)) {
      dependencies.push(candidate);
    }
  }
  return dependencies;
}

function baseProposal() {
  return {
    id: "proposalApplySmoke",
    summary: "Apply one reviewed safe edit after user confirmation.",
    touchedFiles: ["src/applySmoke.ts"],
  };
}

function safeEditProposal() {
  return {
    requiresUserConfirmation: true,
    summary: "Apply one reviewed safe edit after user confirmation.",
    cloudRequired: false,
    edits: [{
      workspaceRelativePath: "src/applySmoke.ts",
      textReplacements: [{ range: { start: { line: 1, character: 20 }, end: { line: 1, character: 25 } }, replacementText: "ready" }],
    }],
  };
}

function boundedLoop() {
  return {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status: "ready_for_apply",
    loopId: "loopApplySmoke",
    sandbox: {
      modeStatus: "checkpoint_ready",
      checkpointId: "checkpointApplySmoke",
      checkpointVerified: true,
      checkpointHash: `sha256:${"a".repeat(64)}`,
    },
    limits: { maxTouchedFiles: 4, maxPatchBytes: 4096, maxSteps: 4, maxVerificationSeconds: 120 },
    patch: {
      proposalId: "proposalApplySmoke",
      source: "assistant_proposal",
      touchedFiles: ["src/applySmoke.ts"],
      editCount: 1,
      patchBytes: 128,
      contentHash: `sha256:${"b".repeat(64)}`,
      summary: "Reviewed patch metadata is ready for manual apply.",
    },
    policy: {
      decision: "ready_for_user_apply",
      requiresUserConfirmation: true,
      reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "allowlisted_verification_command_id"],
    },
    verification: { commandId: "repository-check", status: "not_requested" },
    summary: "Agent Run apply is ready for an explicit user click.",
  };
}

function baseRun() {
  return {
    goal: { id: "goalApplySmoke", title: "Complete one reviewed Agent Run apply step." },
    proposal: baseProposal(),
    boundedLoop: boundedLoop(),
  };
}

function createMockHost({ status }) {
  return {
    providerCalls: 0,
    ideLaunches: 0,
    shellRuns: 0,
    gitRuns: 0,
    toolRuns: 0,
    networkRequests: 0,
    hiddenWorkspaceScans: 0,
    storageWrites: 0,
    autoApplyAttempts: 0,
    autoRetryAttempts: 0,
    autoRollbackAttempts: 0,
    applyCalls: [],
    post(message) {
      assert.equal(message.type, "gui.applyWorkspaceEditRequest");
      this.applyCalls.push({ requestId: message.requestId, type: message.type, payload: message.payload });
      return {
        requestId: message.requestId,
        payload: {
          status,
          message: status === "applied" ? "Mock host apply result recorded." : "Mock host rejected apply request.",
          cloudRequired: false,
          appliedEditCount: status === "applied" ? 1 : 0,
          affectedFiles: ["src/applySmoke.ts"],
        },
      };
    },
  };
}

function assertNoAutonomy(view, label) {
  assert.equal(view.canAutoSend, false, `${label} auto send`);
  assert.equal(view.canAutoApply, false, `${label} auto apply`);
  assert.equal(view.canAutoRunVerification, false, `${label} auto verification`);
  assert.equal(view.canAutoRollback, false, `${label} auto rollback`);
  assert.equal(view.canStartAutonomousLoop, false, `${label} autonomous loop`);
}

function assertHostSafe(host) {
  assert.equal(host.providerCalls, 0);
  assert.equal(host.ideLaunches, 0);
  assert.equal(host.shellRuns, 0);
  assert.equal(host.gitRuns, 0);
  assert.equal(host.toolRuns, 0);
  assert.equal(host.networkRequests, 0);
  assert.equal(host.hiddenWorkspaceScans, 0);
  assert.equal(host.storageWrites, 0);
  assert.equal(host.autoApplyAttempts, 0);
  assert.equal(host.autoRetryAttempts, 0);
  assert.equal(host.autoRollbackAttempts, 0);
}

function assertSanitized(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 9000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function bridgeMessage(requestId) {
  return {
    version: "2026-05-15",
    type: "gui.applyWorkspaceEditRequest",
    requestId,
    payload: safeEditProposal(),
  };
}

async function runAppliedLifecycle(services) {
  const { evaluateAgentRunState } = services["services/agentRunState.ts"];
  const { normalizeAgentRunApplyRequest, correlateAgentRunApplyResult } = services["services/agentRunApply.ts"];
  const { createAgentRunReport } = services["services/agentRunReport.ts"];
  const { createCodingSessionTraceEntry } = services["services/codingSessionTrace.ts"];
  const host = createMockHost({ status: "applied" });
  const run = baseRun();

  const ready = evaluateAgentRunState(run);
  assert.equal(ready.state, "ready_for_apply");
  assert.equal(ready.nextUserAction, "confirm_apply");
  assertNoAutonomy(ready, "ready");
  assert.equal(host.applyCalls.length, 0, "apply posted before explicit click");

  const requestId = "guiAgentRunApplySmoke1";
  const normalized = normalizeAgentRunApplyRequest({ source: "user", requestId, requestIdMintedBy: "gui", runId: "runApplySmoke", proposalId: run.proposal.id, agentRunInput: run });
  assert.equal(normalized.state, "ready");
  run.applyRequest = normalized.applyRequest;

  const requested = evaluateAgentRunState(run);
  assert.equal(requested.state, "apply_requested");
  assertNoAutonomy(requested, "requested");

  const outbound = bridgeMessage(requestId);
  const hostMessage = host.post(outbound);
  assert.equal(host.applyCalls.length, 1, "explicit click posted one existing apply request");
  assert.deepEqual(host.applyCalls[0].payload, safeEditProposal());

  const correlated = correlateAgentRunApplyResult({ current: normalized.correlation, hostMessage });
  assert.equal(correlated.state, "accepted");
  assert.equal(correlated.applyResult.status, "applied");
  run.applyResult = correlated.applyResult;

  const afterApply = evaluateAgentRunState(run);
  assert.equal(afterApply.state, "ready_for_verification");
  assert.equal(afterApply.nextUserAction, "confirm_verification");
  assertNoAutonomy(afterApply, "after apply");

  const trace = [
    createCodingSessionTraceEntry({ family: "agentRun.applyRequested", title: "Agent Run apply requested", status: "pending", summary: "User requested Agent Run apply through the existing workspace-edit bridge.", requestId, details: normalized.details }, { id: "traceApplyRequested", timestamp: "2026-06-23T00:00:00Z" }),
    createCodingSessionTraceEntry({ family: "agentRun.applyResult", title: "Agent Run apply result", status: "succeeded", summary: "Host apply result correlated to the current Agent Run request.", requestId, details: correlated.details }, { id: "traceApplyResult", timestamp: "2026-06-23T00:00:01Z" }),
  ];
  const report = createAgentRunReport(run);
  assert.equal(report.kind, "in_progress");
  assert.equal(report.details.applyStatus, "applied");
  assert.deepEqual(report.userConfirmedSteps, ["apply_requested_by_user", "apply_result_recorded"]);
  assertHostSafe(host);
  assertSanitized({ trace, report, hostEvents: host.applyCalls.map(({ requestId: id, type }) => ({ requestId: id, type })) }, "applied lifecycle");
}

async function runFailedLifecycle(services) {
  const { evaluateAgentRunState } = services["services/agentRunState.ts"];
  const { normalizeAgentRunApplyRequest, correlateAgentRunApplyResult } = services["services/agentRunApply.ts"];
  const { createAgentRunReport } = services["services/agentRunReport.ts"];
  const host = createMockHost({ status: "rejected" });
  const run = baseRun();

  const requestId = "guiAgentRunApplySmokeFailed1";
  const normalized = normalizeAgentRunApplyRequest({ source: "user", requestId, requestIdMintedBy: "gui", runId: "runApplySmoke", proposalId: run.proposal.id, agentRunInput: run });
  assert.equal(normalized.state, "ready");
  run.applyRequest = normalized.applyRequest;

  const hostMessage = host.post(bridgeMessage(requestId));
  const correlated = correlateAgentRunApplyResult({ current: normalized.correlation, hostMessage });
  assert.equal(correlated.state, "accepted");
  assert.equal(correlated.applyResult.status, "failed");
  run.applyResult = correlated.applyResult;
  run.rollback = { available: true, summary: "Checkpoint rollback metadata is available for user review only." };

  const failed = evaluateAgentRunState(run);
  assert.equal(failed.state, "rollback_available");
  assert.equal(failed.stopped, true);
  assert.equal(failed.rollbackAvailable, true);
  assert.equal(failed.nextUserAction, "review_rollback");
  assertNoAutonomy(failed, "failed apply");

  const duplicate = correlateAgentRunApplyResult({ current: normalized.correlation, hostMessage, existingResult: run.applyResult });
  assert.equal(duplicate.state, "duplicate");
  assert.equal(host.applyCalls.length, 1, "failed apply was not retried automatically");

  const stale = correlateAgentRunApplyResult({ current: normalized.correlation, hostMessage: { requestId: "otherRequest", payload: hostMessage.payload } });
  assert.equal(stale.state, "ignored");

  const report = createAgentRunReport(run);
  assert.equal(report.kind, "rollback_available");
  assert.equal(report.status, "pending");
  assert.equal(report.details.applyStatus, "failed");
  assert.deepEqual(report.userConfirmedSteps, ["apply_requested_by_user", "apply_result_recorded"]);
  assertHostSafe(host);
  assertSanitized({ duplicate, stale, report, hostEvents: host.applyCalls.map(({ requestId: id, type }) => ({ requestId: id, type })) }, "failed lifecycle");
}

async function runBlockedAuthorityLifecycle(services) {
  const { normalizeAgentRunApplyRequest } = services["services/agentRunApply.ts"];
  const { evaluateAgentRunState } = services["services/agentRunState.ts"];
  const host = createMockHost({ status: "applied" });
  const run = baseRun();
  const blocked = normalizeAgentRunApplyRequest({ source: "assistant", requestId: "assistantApplySmoke", requestIdMintedBy: "assistant", runId: "runApplySmoke", proposalId: run.proposal.id, agentRunInput: run, rawDiff: "raw diff", env: { API_KEY: "sk-agent-run-apply-secret" } });
  assert.equal(blocked.state, "blocked");
  assert.equal(host.applyCalls.length, 0);
  const view = evaluateAgentRunState({ ...run, applyRequest: { requested: true, source: "assistant", requestId: "assistantApplySmoke" } });
  assert.equal(view.state, "blocked");
  assertNoAutonomy(view, "assistant blocked");
  assertSanitized({ blockedState: blocked.state, blockedDiagnostics: blocked.diagnostics, viewState: view.state, viewDiagnostics: view.diagnostics }, "blocked authority");
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices([
    "services/agentRunApply.ts",
    "services/agentRunReport.ts",
    "services/agentRunState.ts",
    "services/codingSessionTrace.ts",
  ]);
  try {
    await runAppliedLifecycle(imports);
    await runFailedLifecycle(imports);
    await runBlockedAuthorityLifecycle(imports);
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Agent Run apply smoke passed.");
}

export { runSmoke };
