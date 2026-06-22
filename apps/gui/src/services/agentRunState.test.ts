import { describe, expect, it } from "vitest";
import { evaluateAgentRunState, type AgentRunInput } from "./agentRunState";
import type { BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";

const readyLoop: BoundedPatchVerificationLoopMetadata = {
  kind: "bounded_patch_verification_loop",
  version: "2026-06-21",
  authority: "metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  status: "ready_for_apply",
  loopId: "loop-s43-ready",
  sandbox: {
    modeStatus: "checkpoint_ready",
    checkpointId: "checkpoint-s43-ready",
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
    proposalId: "proposal-s43-ready",
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
  goal: {
    id: "goal-s43",
    title: "Add a visible one-step Agent Run shell",
    summary: "Prepare one manual Agent Run step",
  },
  proposal: {
    id: "proposal-s43-ready",
    summary: "Patch metadata detected",
    touchedFiles: ["apps/gui/src/App.tsx"],
  },
  boundedLoop: readyLoop,
};

function cloneRun(): AgentRunInput {
  return structuredClone(baseRun) as AgentRunInput;
}

function cloneLoop(): BoundedPatchVerificationLoopMetadata {
  return structuredClone(readyLoop) as BoundedPatchVerificationLoopMetadata;
}

function expectNoAutonomy(result: ReturnType<typeof evaluateAgentRunState>) {
  expect(result.canAutoSend).toBe(false);
  expect(result.canAutoApply).toBe(false);
  expect(result.canAutoRunVerification).toBe(false);
  expect(result.canAutoRollback).toBe(false);
  expect(result.canStartAutonomousLoop).toBe(false);
}

describe("evaluateAgentRunState", () => {
  it("returns idle and disabled for missing goal", () => {
    const result = evaluateAgentRunState(undefined);

    expect(result.state).toBe("idle");
    expect(result.enabled).toBe(false);
    expect(result.nextUserAction).toBe("none");
    expect(result.diagnostics.map((item) => item.code)).toContain("missing_goal");
    expectNoAutonomy(result);
  });

  it("returns goal ready for goal-only metadata", () => {
    const result = evaluateAgentRunState({ goal: { id: "goal-s43", title: "Ship one safe run" } });

    expect(result.state).toBe("goal_ready");
    expect(result.enabled).toBe(true);
    expect(result.nextUserAction).toBe("review_goal");
    expect(result.summary).toContain("Ship one safe run");
    expectNoAutonomy(result);
  });

  it("blocks proposal metadata without checkpoint and policy readiness", () => {
    const result = evaluateAgentRunState({
      goal: { title: "Ship one safe run" },
      proposal: { id: "proposal-s43", summary: "Patch detected" },
    });

    expect(result.state).toBe("prerequisites_blocked");
    expect(result.nextUserAction).toBe("review_prerequisites");
    expect(result.diagnostics.map((item) => item.code)).toContain("prerequisites_blocked");
    expectNoAutonomy(result);
  });

  it("returns ready for explicit apply when checkpoint and policy are ready", () => {
    const result = evaluateAgentRunState(baseRun);

    expect(result.state).toBe("ready_for_apply");
    expect(result.nextUserAction).toBe("confirm_apply");
    expect(result.details.applyRequested).toBe(false);
    expectNoAutonomy(result);
  });

  it("records apply request only after an explicit user event", () => {
    const run = cloneRun();
    run.applyRequest = { requested: true, source: "user", requestId: "apply-s43" };

    const result = evaluateAgentRunState(run);

    expect(result.state).toBe("apply_requested");
    expect(result.nextUserAction).toBe("wait_for_apply");
    expect(result.details.applyRequested).toBe(true);
    expectNoAutonomy(result);

    run.applyRequest = { requested: true, source: "assistant", requestId: "apply-s43" };
    const blocked = evaluateAgentRunState(run);

    expect(blocked.state).toBe("blocked");
    expect(blocked.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
    expectNoAutonomy(blocked);
  });

  it("moves applied result to ready for explicit verification", () => {
    const run = cloneRun();
    run.applyRequest = { requested: true, source: "user", requestId: "apply-s43" };
    run.applyResult = { status: "applied", appliedFileCount: 1, summary: "Patch applied by user request" };

    const result = evaluateAgentRunState(run);

    expect(result.state).toBe("ready_for_verification");
    expect(result.nextUserAction).toBe("confirm_verification");
    expect(result.details.applyStatus).toBe("applied");
    expectNoAutonomy(result);
  });

  it("models verification request progress and successful result", () => {
    const requested = cloneRun();
    requested.applyResult = { status: "applied", appliedFileCount: 1 };
    requested.verificationRequest = { requested: true, source: "user", requestId: "verify-s43" };

    expect(evaluateAgentRunState(requested).state).toBe("verification_requested");

    const running = cloneRun();
    running.applyResult = { status: "applied", appliedFileCount: 1 };
    running.verificationRequest = { requested: true, source: "user", requestId: "verify-s43" };
    running.verificationProgress = { status: "running", summary: "Verification is running" };

    expect(evaluateAgentRunState(running).state).toBe("verification_running");

    const verified = cloneRun();
    verified.applyResult = { status: "applied", appliedFileCount: 1 };
    verified.verificationRequest = { requested: true, source: "user", requestId: "verify-s43" };
    verified.verificationResult = { status: "succeeded", exitCode: 0, durationMs: 1250, outputTail: "repository check passed" };

    const result = evaluateAgentRunState(verified);

    expect(result.state).toBe("verified");
    expect(result.stopped).toBe(true);
    expect(result.nextUserAction).toBe("stop");
    expectNoAutonomy(result);
  });

  it("blocks verification requests without an explicit user event", () => {
    const run = cloneRun();
    run.applyResult = { status: "applied", appliedFileCount: 1 };
    run.verificationRequest = { requested: true, source: "assistant", requestId: "verify-s43" };

    const result = evaluateAgentRunState(run);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
    expectNoAutonomy(result);
  });

  it("stops on failed verification without implying automatic repair", () => {
    const run = cloneRun();
    run.applyResult = { status: "applied", appliedFileCount: 1 };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-s43" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 1250, outputTail: "repository check failed" };

    const result = evaluateAgentRunState(run);

    expect(result.state).toBe("verification_failed");
    expect(result.stopped).toBe(true);
    expect(result.summary).toContain("failed");
    expect(result.nextUserAction).toBe("review_verification");
    expectNoAutonomy(result);
  });

  it("shows rollback availability without auto-triggering rollback", () => {
    const run = cloneRun();
    run.applyResult = { status: "applied", appliedFileCount: 1 };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-s43" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 1250, outputTail: "repository check failed" };
    run.rollback = { available: true, summary: "Checkpoint rollback can be offered to the user" };

    const result = evaluateAgentRunState(run);

    expect(result.rollbackAvailable).toBe(true);
    expect(result.canAutoRollback).toBe(false);
    expect(result.nextUserAction).toBe("review_rollback");
    expect(result.stopped).toBe(true);
  });

  it("redacts or rejects unsafe raw fields in user-facing summaries", () => {
    const run = cloneRun() as AgentRunInput & { command: string; rawDiff: string; cwd: string };
    run.command = "npm test -- --watch";
    run.rawDiff = "SECRET_SENTINEL";
    run.cwd = "/Users/alice/project";
    run.goal = { title: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" };

    const result = evaluateAgentRunState(run);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["raw_execution_metadata", "unsafe_metadata"]));
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expectNoAutonomy(result);
  });

  it("composes blocked bounded-loop metadata as prerequisites blocked", () => {
    const run = cloneRun();
    const loop = cloneLoop();
    loop.sandbox.modeStatus = "blocked";
    loop.sandbox.checkpointVerified = false;
    run.boundedLoop = loop;

    const result = evaluateAgentRunState(run);

    expect(result.state).toBe("prerequisites_blocked");
    expect(result.summary).toContain("blocked");
    expectNoAutonomy(result);
  });

  it("does not write browser storage while evaluating", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = evaluateAgentRunState(baseRun);

    expect(result.state).toBe("ready_for_apply");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
