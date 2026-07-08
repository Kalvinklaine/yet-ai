import { describe, expect, it } from "vitest";
import completedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-two-step-run-completed.json";
import { createControlledAgentTwoStepRunState, evaluateControlledAgentTwoStepRun, reduceControlledAgentTwoStepRunState, type ControlledAgentTwoStepRunState } from "./controlledAgentTwoStepRun";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function fixture(overrides: Record<string, unknown> = {}): Record<string, any> {
  return { ...(clone(completedFixture) as Record<string, any>), ...overrides };
}

function resultText(value: unknown): string {
  return JSON.stringify(value);
}

function gate(id: string): Record<string, unknown> {
  return {
    required: true,
    satisfied: true,
    confirmedBy: "user",
    assistantMinted: false,
    requestIdMintedBy: "gui",
    confirmationId: id,
    confirmedAt: "2026-07-08T00:00:00Z",
    summary: "User confirmed bounded step",
  };
}

function startPlan(state = createControlledAgentTwoStepRunState()): ControlledAgentTwoStepRunState {
  return reduceControlledAgentTwoStepRunState(state, { type: "planning_request", metadata: { ...gate("plan-request-s119"), workspace: fixture().workspace } });
}

function reviewedPlan(): Record<string, unknown> {
  const input = fixture();
  return {
    workspace: input.workspace,
    gate: input.gates.planReview,
    planCheckpoint: input.planCheckpoint,
  };
}

function applyResult(): Record<string, unknown> {
  return clone(fixture().execution);
}

function verificationResult(): Record<string, unknown> {
  return clone(fixture().verification);
}

function authorityValues(state: ControlledAgentTwoStepRunState): boolean[] {
  return [
    state.cloudRequired,
    state.executionAllowed,
    state.executionImplementationAdded,
    state.unattendedAutonomyAllowed,
    state.autoApplyAllowed,
    state.autoVerifyAllowed,
    state.autoRepairAllowed,
    state.canReadFiles,
    state.canWriteFiles,
    state.canRunCommands,
    state.canCallProvider,
    state.canUseTools,
    state.canUseGit,
    state.canUseNetwork,
  ];
}

describe("controlledAgentTwoStepRun", () => {
  it("evaluates the safe S119 completed fixture as metadata-only completed state", () => {
    const state = evaluateControlledAgentTwoStepRun(fixture());

    expect(state.phase).toBe("completed");
    expect(state.stopped).toBe(true);
    expect(state.authority).toBe("two_step_run_metadata_only");
    expect(authorityValues(state).every((value) => value === false)).toBe(true);
    expect(state.counters).toMatchObject({ plannerSteps: 3, filesTouched: 1, editBytes: 320, verificationCommands: 1, userTurns: 4 });
    expect(state.correlation).toMatchObject({
      controlledWorkspaceId: "workspace-s119",
      runtimeSessionId: "runtime-s119",
      runId: "run-s119",
      workspaceReadinessId: "ready-s119",
      planReviewGateId: "plan-review-s119",
      executionGateId: "execute-s119",
      verificationGateId: "verify-s119",
      planId: "plan-s119",
      executionRequestId: "exec-request-s119",
      verificationRequestId: "verify-request-s119",
    });
    expect(resultText(state)).not.toContain("rawPayload");
  });

  it("requires explicit user gates between planning, execution, and verification", () => {
    const idle = createControlledAgentTwoStepRunState();
    const missingStart = reduceControlledAgentTwoStepRunState(idle, { type: "plan_review", metadata: reviewedPlan() });
    const afterPlanning = startPlan(idle);
    const afterReview = reduceControlledAgentTwoStepRunState(afterPlanning, { type: "plan_review", metadata: reviewedPlan() });
    const missingExecutionGate = reduceControlledAgentTwoStepRunState(afterReview, { type: "apply_result", metadata: applyResult() });
    const afterExecutionGate = reduceControlledAgentTwoStepRunState(afterReview, { type: "execution_request", metadata: gate("execute-s119") });
    const afterApply = reduceControlledAgentTwoStepRunState(afterExecutionGate, { type: "apply_result", metadata: applyResult() });
    const missingVerificationGate = reduceControlledAgentTwoStepRunState(afterApply, { type: "verification_result", metadata: verificationResult() });

    expect(missingStart.stop?.reason).toBe("invalid_transition");
    expect(afterPlanning.phase).toBe("planning_requested");
    expect(afterReview.phase).toBe("waiting_for_user_review");
    expect(missingExecutionGate.stop?.reason).toBe("invalid_transition");
    expect(afterApply.phase).toBe("applying_edits");
    expect(missingVerificationGate.stop?.reason).toBe("invalid_transition");
  });

  it("reduces the safe ordered two-step flow through separate user confirmations", () => {
    const afterPlanning = startPlan();
    const afterReview = reduceControlledAgentTwoStepRunState(afterPlanning, { type: "plan_review", metadata: reviewedPlan() });
    const afterExecutionGate = reduceControlledAgentTwoStepRunState(afterReview, { type: "execution_request", metadata: gate("execute-s119") });
    const afterApply = reduceControlledAgentTwoStepRunState(afterExecutionGate, { type: "apply_result", metadata: applyResult() });
    const afterVerificationGate = reduceControlledAgentTwoStepRunState(afterApply, { type: "verification_request", metadata: gate("verify-s119") });
    const completed = reduceControlledAgentTwoStepRunState(afterVerificationGate, { type: "verification_result", metadata: verificationResult() });

    expect(completed.phase).toBe("completed");
    expect(completed.stop).toBeUndefined();
    expect(completed.counters).toMatchObject({ plannerSteps: 3, filesTouched: 1, editBytes: 320, verificationCommands: 1, userTurns: 4 });
    expect(authorityValues(completed).every((value) => value === false)).toBe(true);
  });

  it("fails closed on missing user gate in completed contract metadata", () => {
    const input = fixture();
    input.gates.executionRequest.satisfied = false;
    input.gates.executionRequest.confirmedBy = "none";
    input.gates.executionRequest.requestIdMintedBy = "none";

    const state = evaluateControlledAgentTwoStepRun(input);

    expect(state.phase).toBe("failed");
    expect(state.stop?.reason).toBe("missing_user_gate");
    expect(resultText(state)).not.toContain("execute-s119");
  });

  it("fails closed on unsafe raw metadata, free-form command fields, and auto-action claims", () => {
    for (const mutate of [
      (input: Record<string, any>) => {
        input.rawPayload = "raw output from /Users/example";
      },
      (input: Record<string, any>) => {
        input.verification.commands[0].command = "npm test";
      },
      (input: Record<string, any>) => {
        input.policyFlags.autoVerifyAllowed = true;
      },
      (input: Record<string, any>) => {
        input.policyFlags.providerCallsAllowed = true;
      },
      (input: Record<string, any>) => {
        input.execution.broadMutation = true;
      },
    ]) {
      const input = fixture();
      mutate(input);

      const state = evaluateControlledAgentTwoStepRun(input);

      expect(state.phase).toBe("failed");
      expect(resultText(state)).not.toContain("/Users/example");
      expect(resultText(state)).not.toContain("npm test");
    }
  });

  it("fails closed on stale and duplicate events", () => {
    const afterPlanning = startPlan();
    const stalePlan = reviewedPlan() as Record<string, any>;
    stalePlan.workspace.runId = "run-s119-stale";
    const stale = reduceControlledAgentTwoStepRunState(afterPlanning, { type: "plan_review", metadata: stalePlan });
    const duplicate = reduceControlledAgentTwoStepRunState(afterPlanning, { type: "planning_request", metadata: gate("plan-request-s119") });

    expect(stale.phase).toBe("failed");
    expect(stale.stop?.reason).toBe("stale_result");
    expect(duplicate.phase).toBe("failed");
    expect(duplicate.stop?.reason).toBe("duplicate_event");
    expect(duplicate.counters.staleOrDuplicateEvents).toBe(1);
  });

  it("fails closed on unbounded counters and verification failure", () => {
    const overBudget = fixture();
    overBudget.counters.plannerSteps = 7;
    const failedVerification = fixture();
    failedVerification.verification.state = "failed";
    failedVerification.verification.commands[0].exitCode = 1;

    expect(evaluateControlledAgentTwoStepRun(overBudget).stop?.reason).toBe("malformed_input");
    expect(evaluateControlledAgentTwoStepRun(failedVerification).stop?.reason).toBe("verification_failed");
  });
});
