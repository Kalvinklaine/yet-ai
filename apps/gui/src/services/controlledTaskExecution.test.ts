import { describe, expect, it } from "vitest";
import { createInitialControlledTaskExecutionState, type ControlledTaskExecutionPhase, type ControlledTaskExecutionState } from "./controlledTaskExecution";

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
});
