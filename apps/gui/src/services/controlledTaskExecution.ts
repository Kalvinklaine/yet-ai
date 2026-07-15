export type ControlledTaskExecutionPhase = "idle" | "planning" | "context_ready" | "proposal_ready" | "applying" | "verifying" | "repairing" | "completed" | "blocked" | "stopped";

export interface ControlledTaskExecutionLineage {
  runId?: string;
  workspaceReadinessId?: string;
  runtimeSessionId?: string;
  proposalId?: string;
  verificationBundleId?: string;
}

export interface ControlledTaskExecutionState {
  phase: ControlledTaskExecutionPhase;
  lineage: ControlledTaskExecutionLineage;
  frozenContextSummary?: string;
  lastError?: string;
  stoppedReason?: string;
}

export function createInitialControlledTaskExecutionState(): ControlledTaskExecutionState {
  return {
    phase: "idle",
    lineage: {},
  };
}
