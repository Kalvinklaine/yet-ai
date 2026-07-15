import { describe, expect, it } from "vitest";
import {
  canStartControlledTaskExecution,
  canStopControlledTaskExecution,
  createInitialControlledTaskExecutionState,
  isControlledTaskExecutionActive,
  reduceControlledTaskExecution,
  summarizeControlledTaskExecution,
  type ControlledTaskExecutionPhase,
  type ControlledTaskExecutionState,
} from "./controlledTaskExecution";

describe("controlledTaskExecution", () => {
  it("creates an initial idle state without a run id", () => {
    const state = createInitialControlledTaskExecutionState();

    expect(state).toEqual({
      phase: "idle",
      lineage: {},
    });
    expect(state.lineage.runId).toBeUndefined();
  });

  it("supports representative controlled task execution phases in constructed state", () => {
    const phases: ControlledTaskExecutionPhase[] = ["planning", "context_ready", "proposal_ready", "applying", "verifying", "repairing", "completed", "blocked", "stopped"];
    const states: ControlledTaskExecutionState[] = phases.map((phase) => ({
      phase,
      lineage: { runId: `run-${phase}` },
    }));

    expect(states.map((state) => state.phase)).toEqual(phases);
    expect(states.every((state) => state.lineage.runId?.startsWith("run-") === true)).toBe(true);
  });

  it("reports active phases deterministically", () => {
    const phases: ControlledTaskExecutionPhase[] = ["idle", "planning", "context_ready", "proposal_ready", "applying", "verifying", "repairing", "completed", "blocked", "stopped"];

    expect(phases.map((phase) => isControlledTaskExecutionActive(stateForPhase(phase)))).toEqual([false, true, true, true, true, true, true, false, false, false]);
  });

  it("allows starting only from inactive restartable phases", () => {
    const phases: ControlledTaskExecutionPhase[] = ["idle", "planning", "context_ready", "proposal_ready", "applying", "verifying", "repairing", "completed", "blocked", "stopped"];

    expect(phases.map((phase) => canStartControlledTaskExecution(stateForPhase(phase)))).toEqual([true, false, false, false, false, false, false, true, true, true]);
  });

  it("allows stopping only active phases", () => {
    const phases: ControlledTaskExecutionPhase[] = ["idle", "planning", "context_ready", "proposal_ready", "applying", "verifying", "repairing", "completed", "blocked", "stopped"];

    expect(phases.map((phase) => canStopControlledTaskExecution(stateForPhase(phase)))).toEqual([false, true, true, true, true, true, true, false, false, false]);
  });

  it("summarizes phase and lineage presence without raw text", () => {
    const state: ControlledTaskExecutionState = {
      phase: "verifying",
      lineage: {
        runId: "raw-run-id",
        workspaceReadinessId: "raw-workspace-id",
        runtimeSessionId: "raw-runtime-id",
        proposalId: "raw-proposal-id",
        verificationBundleId: "raw-verification-id",
      },
      frozenContextSummary: "raw prompt and context text",
      lastError: "raw replacement failure text",
      stoppedReason: "raw stop reason text",
    };

    const summary = summarizeControlledTaskExecution(state);

    expect(summary).toEqual({
      phase: "verifying",
      hasRunId: true,
      lineage: {
        hasWorkspaceReadinessId: true,
        hasRuntimeSessionId: true,
        hasProposalId: true,
        hasVerificationBundleId: true,
      },
    });
    expect(JSON.stringify(summary)).not.toContain("raw");
  });

  it("summarizes missing lineage ids", () => {
    expect(summarizeControlledTaskExecution(createInitialControlledTaskExecutionState())).toEqual({
      phase: "idle",
      hasRunId: false,
      lineage: {
        hasWorkspaceReadinessId: false,
        hasRuntimeSessionId: false,
        hasProposalId: false,
        hasVerificationBundleId: false,
      },
    });
  });

  it("moves idle to planning and records the run id", () => {
    const state = createInitialControlledTaskExecutionState();

    expect(reduceControlledTaskExecution(state, { type: "startPlanning", runId: "run-1" })).toEqual({
      phase: "planning",
      lineage: { runId: "run-1" },
    });
  });

  it("records matching context readiness lineage and frozen context summary", () => {
    const planning = reduceControlledTaskExecution(createInitialControlledTaskExecutionState(), { type: "startPlanning", runId: "run-1" });

    expect(
      reduceControlledTaskExecution(planning, {
        type: "contextReady",
        runId: "run-1",
        workspaceReadinessId: "workspace-1",
        runtimeSessionId: "runtime-1",
        frozenContextSummary: "frozen summary",
      }),
    ).toEqual({
      phase: "context_ready",
      lineage: {
        runId: "run-1",
        workspaceReadinessId: "workspace-1",
        runtimeSessionId: "runtime-1",
      },
      frozenContextSummary: "frozen summary",
    });
  });

  it("ignores stale events with the wrong run id", () => {
    const planning = reduceControlledTaskExecution(createInitialControlledTaskExecutionState(), { type: "startPlanning", runId: "run-1" });
    const contextReady = reduceControlledTaskExecution(planning, {
      type: "contextReady",
      runId: "run-1",
      workspaceReadinessId: "workspace-1",
      runtimeSessionId: "runtime-1",
      frozenContextSummary: "frozen summary",
    });

    expect(reduceControlledTaskExecution(planning, { type: "contextReady", runId: "stale-run", workspaceReadinessId: "stale-workspace" })).toBe(planning);
    expect(reduceControlledTaskExecution(contextReady, { type: "proposalReady", runId: "stale-run", proposalId: "stale-proposal" })).toBe(contextReady);
    expect(reduceControlledTaskExecution(contextReady, { type: "stopped", runId: "stale-run", stoppedReason: "stale stop" })).toBe(contextReady);
  });

  it("moves an active run to stopped and stores the stop reason", () => {
    const planning = reduceControlledTaskExecution(createInitialControlledTaskExecutionState(), { type: "startPlanning", runId: "run-1" });

    expect(reduceControlledTaskExecution(planning, { type: "stopped", runId: "run-1", stoppedReason: "user stopped" })).toEqual({
      phase: "stopped",
      lineage: { runId: "run-1" },
      stoppedReason: "user stopped",
    });
  });

  it("restarts terminal states only through start planning and ignores duplicate active starts", () => {
    const terminalPhases: ControlledTaskExecutionPhase[] = ["stopped", "completed", "blocked"];

    for (const phase of terminalPhases) {
      expect(reduceControlledTaskExecution(stateForPhase(phase), { type: "startPlanning", runId: `restart-${phase}` })).toEqual({
        phase: "planning",
        lineage: { runId: `restart-${phase}` },
      });
    }

    const active = stateForPhase("planning");

    expect(reduceControlledTaskExecution(active, { type: "startPlanning", runId: "duplicate-run" })).toBe(active);
  });
});

function stateForPhase(phase: ControlledTaskExecutionPhase): ControlledTaskExecutionState {
  return {
    phase,
    lineage: { runId: `run-${phase}` },
  };
}
