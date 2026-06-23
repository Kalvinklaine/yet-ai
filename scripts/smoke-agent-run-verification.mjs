import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "sk-agent-run-verification-secret",
  "access_token",
  "Authorization",
  "Bearer",
  "raw diff",
  "raw file body",
  "raw command",
  "npm run check",
  "--watch",
  "\"command\"",
  "\"args\"",
  "\"cwd\"",
  "\"env\"",
  "PRIVATE_TEMP_PATH",
  "/Users/",
  "C:\\Users\\",
  "src/verificationSmoke.ts",
];
const forbiddenRequestKeys = ["command", "cmd", "args", "arguments", "cwd", "env", "environment", "shell", "git", "network", "providerTool", "toolCall", "rawOutput", "rawCommand"];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-agent-run-verification-smoke-ts-"));
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

function boundedLoop(status = "ready_for_verification", verificationStatus = "ready", result = undefined) {
  const completed = verificationStatus === "succeeded";
  return {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status,
    loopId: "loopVerificationSmoke",
    sandbox: {
      modeStatus: "checkpoint_ready",
      checkpointId: "checkpointVerificationSmoke",
      checkpointVerified: true,
      checkpointHash: `sha256:${"a".repeat(64)}`,
    },
    limits: { maxTouchedFiles: 4, maxPatchBytes: 4096, maxSteps: 4, maxVerificationSeconds: 120 },
    patch: {
      proposalId: "proposalVerificationSmoke",
      source: "assistant_proposal",
      touchedFiles: ["src/verificationSmoke.ts"],
      editCount: 1,
      patchBytes: 128,
      contentHash: `sha256:${"b".repeat(64)}`,
      summary: "Reviewed patch metadata is ready for manual verification.",
    },
    policy: {
      decision: completed ? "completed" : "ready_for_user_verification",
      requiresUserConfirmation: true,
      reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "allowlisted_verification_command_id", "user_apply_result_recorded", ...(result ? ["sanitized_result_metadata_only"] : [])],
    },
    verification: { commandId: "repository-check", status: verificationStatus, ...(result ? { result } : {}) },
    summary: completed ? "User-confirmed verification metadata completed." : "Agent Run apply is recorded and verification awaits an explicit user click.",
  };
}

function baseRun() {
  return {
    goal: { id: "goalVerificationSmoke", title: "Complete one reviewed Agent Run verification step." },
    proposal: {
      id: "proposalVerificationSmoke",
      summary: "Verify one reviewed safe edit after user confirmation.",
      touchedFiles: ["src/verificationSmoke.ts"],
    },
    boundedLoop: boundedLoop(),
    applyRequest: { requested: true, source: "user", requestId: "applyVerificationSmoke" },
    applyResult: { status: "applied", appliedFileCount: 1, summary: "User-confirmed apply completed." },
  };
}

function createMockHost({ resultStatus }) {
  return {
    providerCalls: 0,
    ideLaunches: 0,
    shellRuns: 0,
    gitRuns: 0,
    toolRuns: 0,
    networkRequests: 0,
    hiddenWorkspaceScans: 0,
    storageWrites: 0,
    autoVerificationAttempts: 0,
    autoRepairAttempts: 0,
    autoRollbackAttempts: 0,
    ideActionCalls: [],
    post(message) {
      assert.equal(message.type, "gui.ideActionRequest");
      assert.deepEqual(Object.keys(message.payload), ["action", "commandId"]);
      assert.deepEqual(message.payload, { action: "runVerificationCommand", commandId: "repository-check" });
      assert.equal(forbiddenRequestKeys.some((key) => key in message.payload), false);
      this.ideActionCalls.push({ requestId: message.requestId, type: message.type, payload: message.payload });
      const progress = {
        requestId: message.requestId,
        payload: { phase: "running", status: "inProgress", summary: "Allowlisted check is running.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check" },
      };
      const result = {
        requestId: message.requestId,
        payload: {
          status: resultStatus,
          message: resultStatus === "succeeded" ? "Allowlisted check passed." : "Allowlisted check failed.",
          cloudRequired: false,
          action: "runVerificationCommand",
          commandId: "repository-check",
          exitCode: resultStatus === "succeeded" ? 0 : 1,
          durationMs: 42,
          outputTail: resultStatus === "succeeded" ? "allowlisted check passed" : "allowlisted check failed",
          truncated: false,
        },
      };
      return { progress, result };
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
  assert.equal(host.autoVerificationAttempts, 0);
  assert.equal(host.autoRepairAttempts, 0);
  assert.equal(host.autoRollbackAttempts, 0);
}

function assertSanitized(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 9000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function updateLoopAfterResult(run, verificationResult) {
  const succeeded = verificationResult.status === "succeeded";
  run.boundedLoop = boundedLoop(succeeded ? "verified" : "verification_failed", verificationResult.status, {
    exitCode: verificationResult.exitCode,
    durationMs: verificationResult.durationMs,
    outputTail: verificationResult.outputTail,
    truncated: false,
    resultHash: `sha256:${"c".repeat(64)}`,
  });
}

function traceEntry(createCodingSessionTraceEntry, draft, id) {
  return createCodingSessionTraceEntry(draft, { id, timestamp: "2026-06-23T00:00:00Z" });
}

async function runSucceededLifecycle(services) {
  const { evaluateAgentRunState } = services["services/agentRunState.ts"];
  const { normalizeAgentRunVerificationRequest, correlateAgentRunVerificationProgress, correlateAgentRunVerificationResult } = services["services/agentRunVerification.ts"];
  const { createAgentRunReport, createAgentRunTraceDetails } = services["services/agentRunReport.ts"];
  const { createCodingSessionTraceEntry } = services["services/codingSessionTrace.ts"];
  const host = createMockHost({ resultStatus: "succeeded" });
  const run = baseRun();

  const ready = evaluateAgentRunState(run);
  assert.equal(ready.state, "ready_for_verification");
  assert.equal(ready.nextUserAction, "confirm_verification");
  assertNoAutonomy(ready, "ready");
  assert.equal(host.ideActionCalls.length, 0, "verification posted before explicit click");

  const requestId = "guiAgentRunVerificationSmoke1";
  const normalized = normalizeAgentRunVerificationRequest({ source: "user", requestId, requestIdMintedBy: "gui", runId: "runVerificationSmoke", commandId: "repository-check" });
  assert.equal(normalized.state, "ready");
  assert.deepEqual(normalized.ideActionRequest, { action: "runVerificationCommand", commandId: "repository-check" });
  run.verificationRequest = normalized.verificationRequest;

  const requested = evaluateAgentRunState(run);
  assert.equal(requested.state, "verification_requested");
  assertNoAutonomy(requested, "requested");

  const hostMessages = host.post({ version: "2026-05-15", type: "gui.ideActionRequest", requestId, payload: normalized.ideActionRequest });
  assert.equal(host.ideActionCalls.length, 1, "explicit click posted one IDE action request");

  const progress = correlateAgentRunVerificationProgress({ current: normalized.correlation, hostMessage: hostMessages.progress });
  assert.equal(progress.state, "accepted");
  assert.equal(progress.verificationProgress.status, "running");
  run.verificationProgress = progress.verificationProgress;
  const running = evaluateAgentRunState(run);
  assert.equal(running.state, "verification_running");

  const result = correlateAgentRunVerificationResult({ current: normalized.correlation, hostMessage: hostMessages.result });
  assert.equal(result.state, "accepted");
  assert.equal(result.verificationResult.status, "succeeded");
  run.verificationResult = result.verificationResult;
  updateLoopAfterResult(run, result.verificationResult);

  const verified = evaluateAgentRunState(run);
  assert.equal(verified.state, "verified");
  assert.equal(verified.stopped, true);
  assert.equal(verified.nextUserAction, "stop");
  assertNoAutonomy(verified, "verified");

  const trace = [
    traceEntry(createCodingSessionTraceEntry, { family: "agentRun.verificationRequested", title: "Agent Run verification requested", status: "pending", summary: "User requested Agent Run verification through the existing IDE action bridge.", requestId, details: normalized.details }, "traceVerificationRequested"),
    traceEntry(createCodingSessionTraceEntry, { family: "agentRun.verificationProgress", title: "Agent Run verification progress", status: "in_progress", summary: "Host progress matched the current Agent Run verification request.", requestId, details: progress.details }, "traceVerificationProgress"),
    traceEntry(createCodingSessionTraceEntry, { family: "agentRun.completed", title: "Agent Run completed", status: "succeeded", summary: "Agent Run completed after explicit verification.", requestId, details: createAgentRunTraceDetails(run) }, "traceVerificationCompleted"),
  ];
  const report = createAgentRunReport(run);
  assert.equal(report.kind, "success");
  assert.equal(report.status, "succeeded");
  assert.deepEqual(report.userConfirmedSteps, ["apply_requested_by_user", "apply_result_recorded", "verification_requested_by_user", "verification_result_recorded"]);
  assert.equal(report.details.verificationCommandId, "repository-check");
  assertHostSafe(host);
  assertSanitized({ trace, report, hostEvents: host.ideActionCalls.map(({ requestId: id, type, payload }) => ({ requestId: id, type, payload })) }, "succeeded lifecycle");
}

async function runFailedLifecycle(services) {
  const { evaluateAgentRunState } = services["services/agentRunState.ts"];
  const { normalizeAgentRunVerificationRequest, correlateAgentRunVerificationProgress, correlateAgentRunVerificationResult } = services["services/agentRunVerification.ts"];
  const { createAgentRunReport, createAgentRunTraceDetails } = services["services/agentRunReport.ts"];
  const { createCodingSessionTraceEntry } = services["services/codingSessionTrace.ts"];
  const host = createMockHost({ resultStatus: "failed" });
  const run = baseRun();
  const requestId = "guiAgentRunVerificationSmokeFailed1";
  const normalized = normalizeAgentRunVerificationRequest({ source: "user", requestId, requestIdMintedBy: "gui", runId: "runVerificationSmoke", commandId: "repository-check" });
  assert.equal(normalized.state, "ready");
  run.verificationRequest = normalized.verificationRequest;

  const hostMessages = host.post({ version: "2026-05-15", type: "gui.ideActionRequest", requestId, payload: normalized.ideActionRequest });
  const progress = correlateAgentRunVerificationProgress({ current: normalized.correlation, hostMessage: hostMessages.progress });
  assert.equal(progress.state, "accepted");
  run.verificationProgress = progress.verificationProgress;
  const result = correlateAgentRunVerificationResult({ current: normalized.correlation, hostMessage: hostMessages.result });
  assert.equal(result.state, "accepted");
  assert.equal(result.verificationResult.status, "failed");
  run.verificationResult = result.verificationResult;
  updateLoopAfterResult(run, result.verificationResult);

  let failed = evaluateAgentRunState(run);
  assert.equal(failed.state, "verification_failed");
  assert.equal(failed.stopped, true);
  assert.equal(failed.rollbackAvailable, false);
  assert.equal(failed.nextUserAction, "review_verification");
  assertNoAutonomy(failed, "failed verification");

  const duplicate = correlateAgentRunVerificationResult({ current: normalized.correlation, hostMessage: hostMessages.result, existingResult: run.verificationResult });
  assert.equal(duplicate.state, "duplicate");
  const stale = correlateAgentRunVerificationResult({ current: normalized.correlation, hostMessage: { requestId: "otherRequest", payload: hostMessages.result.payload } });
  assert.equal(stale.state, "ignored");
  assert.equal(host.ideActionCalls.length, 1, "failed verification was not retried automatically");

  const reportWithoutRollback = createAgentRunReport(run);
  assert.equal(reportWithoutRollback.kind, "failed_verification");
  assert.equal(reportWithoutRollback.status, "failed");
  assert.equal(reportWithoutRollback.summary.includes("no automatic repair was started"), true);

  run.rollback = { available: true, summary: "Checkpoint rollback metadata is available for user review only." };
  failed = evaluateAgentRunState(run);
  assert.equal(failed.state, "rollback_available");
  assert.equal(failed.rollbackAvailable, true);
  assert.equal(failed.nextUserAction, "review_rollback");
  assertNoAutonomy(failed, "rollback review");

  const report = createAgentRunReport(run);
  assert.equal(report.kind, "rollback_available");
  assert.equal(report.status, "pending");
  assert.equal(report.details.rollbackAvailable, true);
  const trace = [
    traceEntry(createCodingSessionTraceEntry, { family: "agentRun.verificationResult", title: "Agent Run verification result", status: "failed", summary: "Verification failed after an explicit user request; no automatic repair started.", requestId, details: createAgentRunTraceDetails(run) }, "traceVerificationFailed"),
    traceEntry(createCodingSessionTraceEntry, { family: "agentRun.rollbackAvailable", title: "Agent Run rollback metadata available", status: "pending", summary: "Rollback metadata is available for user review only.", requestId, details: createAgentRunTraceDetails(run) }, "traceRollbackAvailable"),
  ];
  assertHostSafe(host);
  assertSanitized({ duplicate, stale, trace, report, hostEvents: host.ideActionCalls.map(({ requestId: id, type, payload }) => ({ requestId: id, type, payload })) }, "failed lifecycle");
}

async function runBlockedAuthorityLifecycle(services) {
  const { normalizeAgentRunVerificationRequest } = services["services/agentRunVerification.ts"];
  const { evaluateAgentRunState } = services["services/agentRunState.ts"];
  const host = createMockHost({ resultStatus: "succeeded" });
  const run = baseRun();
  const blocked = normalizeAgentRunVerificationRequest({
    source: "assistant",
    requestId: "assistantVerificationSmoke",
    requestIdMintedBy: "assistant",
    runId: "runVerificationSmoke",
    commandId: "repository-check",
    rawCommand: "raw command",
    args: ["--watch"],
    cwd: "PRIVATE_TEMP_PATH",
    env: { API_KEY: "sk-agent-run-verification-secret" },
  });
  assert.equal(blocked.state, "blocked");
  assert.equal(host.ideActionCalls.length, 0);
  const view = evaluateAgentRunState({ ...run, verificationRequest: { requested: true, source: "assistant", requestId: "assistantVerificationSmoke" } });
  assert.equal(view.state, "blocked");
  assertNoAutonomy(view, "assistant blocked");
  assertSanitized({ blockedState: blocked.state, blockedDiagnostics: blocked.diagnostics, viewState: view.state, viewDiagnostics: view.diagnostics }, "blocked authority");
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices([
    "services/agentRunVerification.ts",
    "services/agentRunReport.ts",
    "services/agentRunState.ts",
    "services/codingSessionTrace.ts",
  ]);
  try {
    await runSucceededLifecycle(imports);
    await runFailedLifecycle(imports);
    await runBlockedAuthorityLifecycle(imports);
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Agent Run verification smoke passed.");
}

export { runSmoke };
