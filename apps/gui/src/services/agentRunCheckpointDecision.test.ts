import { describe, expect, it } from "vitest";
import type { AgentRunInput } from "./agentRunState";
import type { BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";
import { buildAgentRunCheckpointDecision } from "./agentRunCheckpointDecision";

const readyLoop: BoundedPatchVerificationLoopMetadata = {
  kind: "bounded_patch_verification_loop",
  version: "2026-06-21",
  authority: "metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  status: "ready_for_apply",
  loopId: "loop-s72-ready",
  sandbox: {
    modeStatus: "checkpoint_ready",
    checkpointId: "checkpoint-s72-ready",
    checkpointVerified: true,
    checkpointHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  limits: {
    maxTouchedFiles: 4,
    maxPatchBytes: 12000,
    maxSteps: 4,
    maxVerificationSeconds: 600,
  },
  patch: {
    proposalId: "proposal-s72-ready",
    source: "assistant_proposal",
    touchedFiles: ["apps/gui/src/App.tsx"],
    editCount: 1,
    patchBytes: 1024,
    contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    summary: "Reviewable patch metadata is ready",
  },
  policy: {
    decision: "ready_for_user_apply",
    requiresUserConfirmation: true,
    reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only"],
  },
  verification: {
    commandId: "repository-check",
    status: "not_requested",
  },
  summary: "Patch can be applied after explicit user confirmation",
};

const baseRun: AgentRunInput = {
  goal: { id: "goal-s72", title: "Decide the next checkpoint step" },
  proposal: { id: "proposal-s72-ready", summary: "Patch metadata detected", touchedFiles: ["apps/gui/src/App.tsx"] },
  boundedLoop: readyLoop,
  applyRequest: { requested: true, source: "user", requestId: "apply-s72" },
};

function cloneRun(): AgentRunInput {
  return structuredClone(baseRun) as AgentRunInput;
}

function verifiedRun(): AgentRunInput {
  const run = cloneRun();
  run.applyResult = { status: "applied", appliedFileCount: 1, summary: "Patch applied by user request" };
  run.verificationRequest = { requested: true, source: "user", requestId: "verify-s72" };
  run.verificationResult = { status: "succeeded", exitCode: 0, durationMs: 800, outputTail: "repository check passed" };
  return run;
}

function expectNoAuthority(result: ReturnType<typeof buildAgentRunCheckpointDecision>): void {
  expect(result.canAutoContinue).toBe(false);
  expect(result.canAutoApply).toBe(false);
  expect(result.canAutoRollback).toBe(false);
  expect(result.canAutoRunVerification).toBe(false);
  expect(result.canStartAutonomousLoop).toBe(false);
  expect(result.hasExecutableAuthority).toBe(false);
  expect(result.displayOnly).toBe(true);
  expect(result.decisionCards.every((card) => card.manualOnly && card.actionPayload === null)).toBe(true);
}

function expectNoRawLeak(value: unknown): void {
  const rendered = JSON.stringify(value);
  expect(rendered).not.toContain("/Users/alice");
  expect(rendered).not.toContain("SECRET_SENTINEL");
  expect(rendered).not.toContain("sk-secret123456789");
  expect(rendered).not.toContain("npm test");
}

describe("buildAgentRunCheckpointDecision", () => {
  it("offers a manual continue decision after safe applied and verified metadata", () => {
    const result = buildAgentRunCheckpointDecision({ host: "vscode", agentRun: verifiedRun() });

    expect(result.status).toBe("continue_available");
    expect(result.recommendedDecision).toBe("continue_current_checkpoint");
    expect(result.decisionCards).toContainEqual(expect.objectContaining({ kind: "continue", state: "recommended", actionPayload: null }));
    expect(result.decisionCards).toContainEqual(expect.objectContaining({ kind: "stop", state: "disabled", actionPayload: null }));
    expect(result.diagnostics).toEqual([]);
    expectNoAuthority(result);
    expectNoRawLeak(result);
  });

  it("offers rollback review only after failed verification with rollback metadata", () => {
    const run = cloneRun();
    run.applyResult = { status: "applied", appliedFileCount: 1, summary: "Patch applied by user request" };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-s72" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 900, outputTail: "repository check failed" };
    run.rollback = { available: true, summary: "Checkpoint rollback can be reviewed" };

    const result = buildAgentRunCheckpointDecision({ host: "jetbrains", agentRun: run });

    expect(result.status).toBe("rollback_review_available");
    expect(result.recommendedDecision).toBe("review_rollback");
    expect(result.decisionCards).toContainEqual(expect.objectContaining({ kind: "review_rollback", state: "recommended", actionPayload: null }));
    expect(result.decisionCards).toContainEqual(expect.objectContaining({ kind: "stop", state: "available", actionPayload: null }));
    expectNoAuthority(result);
  });

  it("stops after apply failure unless rollback review metadata is available", () => {
    const failed = cloneRun();
    failed.applyResult = { status: "failed", summary: "Patch did not apply" };

    const stopped = buildAgentRunCheckpointDecision({ host: "vscode", agentRun: failed });

    expect(stopped.status).toBe("blocked");
    expect(stopped.recommendedDecision).toBe("stop");
    expect(stopped.diagnostics.map((item) => item.code)).toContain("manual_review_required");
    expect(stopped.decisionCards).toContainEqual(expect.objectContaining({ kind: "stop", state: "recommended", actionPayload: null }));

    failed.rollback = { available: true, summary: "Rollback can be reviewed" };
    const rollback = buildAgentRunCheckpointDecision({ host: "vscode", agentRun: failed });

    expect(rollback.status).toBe("rollback_review_available");
    expect(rollback.recommendedDecision).toBe("review_rollback");
    expectNoAuthority(rollback);
  });

  it("suggests a separate manual run after failed verification without rollback", () => {
    const run = cloneRun();
    run.applyResult = { status: "applied", appliedFileCount: 1 };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-s72" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 900, outputTail: "repository check failed" };

    const result = buildAgentRunCheckpointDecision({ host: "vscode", agentRun: run });

    expect(result.status).toBe("separate_run_suggested");
    expect(result.recommendedDecision).toBe("start_separate_manual_run");
    expect(result.decisionCards).toContainEqual(expect.objectContaining({ kind: "start_separate_manual_run", state: "recommended", actionPayload: null }));
    expectNoAuthority(result);
  });

  it("keeps browser decisions display-only and unavailable", () => {
    const result = buildAgentRunCheckpointDecision({ host: "browser", agentRun: verifiedRun() });

    expect(result.status).toBe("unavailable");
    expect(result.recommendedDecision).toBe("none");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host");
    expect(result.decisionCards.every((card) => card.state === "disabled")).toBe(true);
    expectNoAuthority(result);
  });

  it("fails closed and redacts unsafe executable metadata", () => {
    const run = verifiedRun() as AgentRunInput & { command: string; cwd: string; rawDiff: string; assistantExecution: string; autoRollback: boolean };
    run.command = "npm test -- --watch";
    run.cwd = "/Users/alice/project";
    run.rawDiff = "SECRET_SENTINEL";
    run.assistantExecution = "assistant";
    run.autoRollback = true;
    run.rollback = { available: true, summary: "sk-secret123456789" };

    const result = buildAgentRunCheckpointDecision({ host: "vscode", agentRun: run });

    expect(result.status).toBe("blocked");
    expect(result.recommendedDecision).toBe("stop");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["raw_execution_metadata", "unsafe_metadata", "assistant_authority_blocked"]));
    expect(result.decisionCards).toContainEqual(expect.objectContaining({ kind: "review_rollback", state: "disabled", actionPayload: null }));
    expectNoAuthority(result);
    expectNoRawLeak(result);
  });
});
