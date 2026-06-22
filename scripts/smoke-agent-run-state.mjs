import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyBoundedPatchPlan, createBoundedPatchPlan, evaluateAllowlistedVerificationRequest } from "./bounded-patch-loop-state.mjs";
import { createSandboxCheckpoint, verifySandboxCheckpoint } from "./sandbox-checkpoint-state.mjs";

const CREATED_AT = "2026-06-22T12:00:00Z";
const APPLIED_AT = "2026-06-22T12:05:00Z";
const ORIGINAL = "export const agentRun = 'proposal';\n";
const UPDATED = "export const agentRun = 'applied';\n";
const RAW_MARKERS = [
  ORIGINAL.trim(),
  UPDATED.trim(),
  "npm run check",
  "--watch",
  "cwd",
  "env",
  "raw diff",
  "raw file body",
  "PRIVATE_TEMP_PATH",
  "sk-secret123456789"
];

async function disposableWorkspace(root) {
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ workspaceLabel: "agent run smoke" })}\n`);
  return workspaceRoot;
}

function editForSource() {
  return { path: "src/agent-run.ts", start: 0, end: ORIGINAL.length, expectedText: ORIGINAL, replacement: UPDATED };
}

function assertNoRawMarkers(value, label, tempRoot) {
  const text = JSON.stringify(value);
  for (const marker of [...RAW_MARKERS, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
  assert.equal(text.length < 8000, true, `${label} was not bounded`);
}

function baseBoundedLoop(summary, verificationStatus = "not_requested", result = undefined) {
  const policyDecision = verificationStatus === "succeeded" ? "completed" : verificationStatus === "not_requested" ? "ready_for_user_apply" : "ready_for_user_verification";
  const status = verificationStatus === "succeeded" ? "verified" : verificationStatus === "failed" ? "verification_failed" : verificationStatus === "ready" ? "ready_for_verification" : "ready_for_apply";
  const reasonCodes = ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "allowlisted_verification_command_id"];
  if (status !== "ready_for_apply") {
    reasonCodes.push("user_apply_result_recorded");
  }
  if (result) {
    reasonCodes.push("sanitized_result_metadata_only");
  }
  return {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status,
    loopId: "loop-agent-run-smoke",
    sandbox: {
      modeStatus: "checkpoint_ready",
      checkpointId: summary.checkpointId,
      checkpointVerified: true,
      checkpointHash: `sha256:${summary.checkpointHash}`
    },
    limits: {
      maxTouchedFiles: 4,
      maxPatchBytes: 4096,
      maxSteps: 4,
      maxVerificationSeconds: 120
    },
    patch: {
      proposalId: summary.proposalId,
      source: "assistant_proposal",
      touchedFiles: ["src/agent-run.ts"],
      editCount: summary.editCount,
      patchBytes: summary.patchBytes,
      contentHash: `sha256:${summary.planHash}`,
      summary: "Bounded replacement-only patch metadata is ready"
    },
    policy: {
      decision: policyDecision,
      requiresUserConfirmation: true,
      reasonCodes
    },
    verification: {
      commandId: summary.verificationCommandId,
      status: verificationStatus,
      ...(result ? { result } : {})
    },
    summary: "Agent Run patch metadata is ready for explicit user action"
  };
}

function evaluateMockAgentRun(input) {
  const autonomy = {
    canAutoSend: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canAutoRollback: false,
    canStartAutonomousLoop: false
  };
  if (input.stopped === true) {
    return { state: "completed", stopped: true, rollbackAvailable: input.rollback?.available === true, nextUserAction: "stop", ...autonomy };
  }
  if (!input.goal) {
    return { state: "idle", stopped: false, rollbackAvailable: false, nextUserAction: "none", ...autonomy };
  }
  if (!input.proposal) {
    return { state: "goal_ready", stopped: false, rollbackAvailable: false, nextUserAction: "review_goal", ...autonomy };
  }
  if (!input.boundedLoop || input.boundedLoop.sandbox?.checkpointVerified !== true || !["ready_for_user_apply", "ready_for_user_verification", "completed"].includes(input.boundedLoop.policy?.decision)) {
    return { state: "prerequisites_blocked", stopped: false, rollbackAvailable: false, nextUserAction: "review_prerequisites", ...autonomy };
  }
  if (input.applyRequest?.requested === true && input.applyRequest.source !== "user") {
    return { state: "blocked", stopped: true, rollbackAvailable: false, nextUserAction: "review_prerequisites", ...autonomy };
  }
  if (!input.applyResult) {
    return input.applyRequest?.requested === true ? { state: "apply_requested", stopped: false, rollbackAvailable: false, nextUserAction: "wait_for_apply", ...autonomy } : { state: "ready_for_apply", stopped: false, rollbackAvailable: false, nextUserAction: "confirm_apply", ...autonomy };
  }
  if (!input.verificationResult) {
    if (input.verificationRequest?.requested === true && input.verificationRequest.source !== "user") {
      return { state: "blocked", stopped: true, rollbackAvailable: false, nextUserAction: "review_prerequisites", ...autonomy };
    }
    if (input.verificationProgress?.status === "running") {
      return { state: "verification_running", stopped: false, rollbackAvailable: false, nextUserAction: "review_verification", ...autonomy };
    }
    return input.verificationRequest?.requested === true ? { state: "verification_requested", stopped: false, rollbackAvailable: false, nextUserAction: "review_verification", ...autonomy } : { state: "ready_for_verification", stopped: false, rollbackAvailable: false, nextUserAction: "confirm_verification", ...autonomy };
  }
  if (input.verificationResult.status === "succeeded") {
    return { state: "verified", stopped: true, rollbackAvailable: false, nextUserAction: "stop", ...autonomy };
  }
  return { state: input.rollback?.available === true ? "rollback_available" : "verification_failed", stopped: true, rollbackAvailable: input.rollback?.available === true, nextUserAction: input.rollback?.available === true ? "review_rollback" : "review_verification", ...autonomy };
}

function assertNoAutonomy(view, label) {
  assert.equal(view.canAutoSend, false, `${label} auto-send`);
  assert.equal(view.canAutoApply, false, `${label} auto-apply`);
  assert.equal(view.canAutoRunVerification, false, `${label} auto-verification`);
  assert.equal(view.canAutoRollback, false, `${label} auto-rollback`);
  assert.equal(view.canStartAutonomousLoop, false, `${label} autonomous-loop`);
}

function createMockHost() {
  return {
    storageWrites: 0,
    networkRequests: 0,
    shellRuns: 0,
    gitRuns: 0,
    providerCalls: 0,
    hiddenWorkspaceScans: 0,
    autoRepairRuns: 0,
    autoRollbackRuns: 0,
    events: [],
    apply(patchPlan) {
      this.events.push({ type: "user_click_apply", proposalId: patchPlan.proposalId });
      return { status: "applied", appliedFileCount: patchPlan.files.length, summary: "Mock host apply result recorded" };
    },
    verify(commandId, status) {
      this.events.push({ type: "user_click_verification", commandId });
      this.events.push({ type: "mock_host_verification_progress", status: "running" });
      this.events.push({ type: "mock_host_verification_result", status });
      return { status, exitCode: status === "succeeded" ? 0 : 1, durationMs: 42, outputTail: status === "succeeded" ? "repository-check passed" : "repository-check failed" };
    }
  };
}

function createSanitizedReport(input, view) {
  return {
    title: view.state === "verified" ? "Agent Run completed after explicit verification" : "Agent Run stopped after failed verification",
    status: view.state === "verified" ? "succeeded" : "failed",
    state: view.state,
    stopped: view.stopped,
    rollbackAvailable: view.rollbackAvailable,
    nextUserAction: view.nextUserAction,
    userConfirmedSteps: ["apply_requested_by_user", "apply_result_recorded", "verification_requested_by_user", "verification_result_recorded"],
    details: {
      goalId: input.goal.id,
      proposalId: input.proposal.id,
      touchedFileCount: input.boundedLoop.patch.touchedFiles.length,
      editCount: input.boundedLoop.patch.editCount,
      verificationCommandId: input.boundedLoop.verification.commandId,
      verificationStatus: input.verificationResult.status,
      verificationExitCode: input.verificationResult.exitCode,
      rollbackAvailable: input.rollback?.available === true,
      displayOnly: true
    },
    summary: view.state === "verified" ? "Manual apply and allowlisted verification completed; no autonomous follow-up was started." : "Verification failed after an explicit user request; no automatic repair or rollback was started."
  };
}

function assertMockHostSafe(host) {
  assert.equal(host.storageWrites, 0, "browser storage persistence occurred");
  assert.equal(host.networkRequests, 0, "network request occurred");
  assert.equal(host.shellRuns, 0, "shell command occurred");
  assert.equal(host.gitRuns, 0, "git command occurred");
  assert.equal(host.providerCalls, 0, "provider call occurred");
  assert.equal(host.hiddenWorkspaceScans, 0, "hidden workspace scan occurred");
  assert.equal(host.autoRepairRuns, 0, "auto repair occurred");
  assert.equal(host.autoRollbackRuns, 0, "auto rollback occurred");
}

async function runLifecycle({ workspaceRoot, checkpointRoot, manifest, patchPlan, summary, verificationStatus }) {
  const host = createMockHost();
  const run = {
    goal: { id: "goal-agent-run-smoke", title: "Run one safe Agent Run step" },
    proposal: { id: summary.proposalId, summary: "Proposal detected", touchedFiles: ["src/agent-run.ts"] }
  };

  let view = evaluateMockAgentRun({ goal: run.goal });
  assert.equal(view.state, "goal_ready");
  assertNoAutonomy(view, "goal visible");

  view = evaluateMockAgentRun(run);
  assert.equal(view.state, "prerequisites_blocked");
  assert.equal(view.nextUserAction, "review_prerequisites");
  assertNoAutonomy(view, "blocked before readiness");

  const verificationReady = await evaluateAllowlistedVerificationRequest({ verificationCommandId: summary.verificationCommandId, checkpointManifest: manifest, patchPlan });
  assert.equal(verificationReady.commandId, "repository-check");
  assert.equal(verificationReady.shellAllowed, false);

  run.boundedLoop = baseBoundedLoop(summary);
  view = evaluateMockAgentRun(run);
  assert.equal(view.state, "ready_for_apply");
  assert.equal(view.nextUserAction, "confirm_apply");
  assertNoAutonomy(view, "ready apply");

  run.applyRequest = { requested: true, source: "user", requestId: "apply-click-smoke" };
  view = evaluateMockAgentRun(run);
  assert.equal(view.state, "apply_requested");

  run.applyResult = host.apply(patchPlan);
  const applied = await applyBoundedPatchPlan({ workspaceRoot, checkpointRoot, checkpointManifest: manifest, patchPlan, appliedAt: APPLIED_AT });
  assert.equal(applied.applied, true);
  assert.equal(await readFile(join(workspaceRoot, "src", "agent-run.ts"), "utf8"), UPDATED);

  view = evaluateMockAgentRun(run);
  assert.equal(view.state, "ready_for_verification");
  assert.equal(view.nextUserAction, "confirm_verification");

  run.verificationRequest = { requested: true, source: "user", requestId: "verify-click-smoke" };
  view = evaluateMockAgentRun(run);
  assert.equal(view.state, "verification_requested");

  run.verificationProgress = { status: "running", summary: "Mock host verification running" };
  view = evaluateMockAgentRun(run);
  assert.equal(view.state, "verification_running");

  run.verificationResult = host.verify(summary.verificationCommandId, verificationStatus);
  run.boundedLoop = baseBoundedLoop(summary, verificationStatus === "succeeded" ? "succeeded" : "failed", {
    exitCode: run.verificationResult.exitCode,
    durationMs: run.verificationResult.durationMs,
    outputTail: run.verificationResult.outputTail,
    truncated: false,
    resultHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  });
  if (verificationStatus === "failed") {
    run.rollback = { available: true, summary: "Checkpoint rollback metadata is available for user review only" };
  }
  view = evaluateMockAgentRun(run);
  assert.equal(view.stopped, true);
  assert.equal(view.state, verificationStatus === "succeeded" ? "verified" : "rollback_available");
  assert.equal(view.nextUserAction, verificationStatus === "succeeded" ? "stop" : "review_rollback");
  assertNoAutonomy(view, "final state");
  assertMockHostSafe(host);

  const report = createSanitizedReport(run, view);
  assert.equal(report.details.verificationCommandId, "repository-check");
  assert.equal(report.details.editCount, 1);
  assert.equal(report.details.touchedFileCount, 1);
  assert.equal(report.rollbackAvailable, verificationStatus === "failed");
  assertNoRawMarkers({ report, hostEvents: host.events }, `${verificationStatus} report`, workspaceRoot);
  return { report, hostEvents: host.events };
}

async function runSmoke() {
  const tmp = await mkdtemp(join(tmpdir(), "yet-agent-run-state-smoke-"));
  try {
    const checkpointRoot = join(tmp, "checkpoints");
    const workspaceRoot = await disposableWorkspace(tmp);
    await writeFile(join(workspaceRoot, "src", "agent-run.ts"), ORIGINAL);
    const { manifest } = await createSandboxCheckpoint({
      workspaceRoot,
      checkpointRoot,
      checkpointId: "checkpoint-agent-run-smoke",
      createdAt: CREATED_AT,
      files: ["src/agent-run.ts"],
      limits: { maxFiles: 4, maxFileBytes: 1024, maxTotalBytes: 2048 }
    });
    await verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest });
    const { patchPlan, summary } = await createBoundedPatchPlan({
      workspaceRoot,
      checkpointRoot,
      checkpointManifest: manifest,
      proposalId: "proposal-agent-run-smoke",
      edits: [editForSource()],
      limits: { maxFiles: 4, maxEdits: 4, maxFileBytes: 4096, maxPatchBytes: 4096, maxReplacementBytes: 1024 },
      verificationCommandId: "repository-check"
    });
    assert.equal(patchPlan.files[0].edits.length, 1);
    assert.equal(patchPlan.files[0].edits[0].replacement, UPDATED);
    assertNoRawMarkers(summary, "bounded plan summary", tmp);

    const success = await runLifecycle({ workspaceRoot, checkpointRoot, manifest, patchPlan, summary, verificationStatus: "succeeded" });

    await writeFile(join(workspaceRoot, "src", "agent-run.ts"), ORIGINAL);
    const { patchPlan: failedPatchPlan, summary: failedSummary } = await createBoundedPatchPlan({
      workspaceRoot,
      checkpointRoot,
      checkpointManifest: manifest,
      proposalId: "proposal-agent-run-failed",
      edits: [editForSource()],
      limits: { maxFiles: 4, maxEdits: 4, maxFileBytes: 4096, maxPatchBytes: 4096, maxReplacementBytes: 1024 },
      verificationCommandId: "repository-check"
    });
    const failed = await runLifecycle({ workspaceRoot, checkpointRoot, manifest, patchPlan: failedPatchPlan, summary: failedSummary, verificationStatus: "failed" });

    const finalReport = { success: success.report, failed: failed.report, eventCounts: { success: success.hostEvents.length, failed: failed.hostEvents.length } };
    assertNoRawMarkers(finalReport, "final smoke report", tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Agent Run state smoke passed.");
}

export { runSmoke };
