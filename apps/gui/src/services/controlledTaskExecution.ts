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

export type ControlledTaskExecutionEvent =
  | { type: "startPlanning"; runId: string }
  | { type: "contextReady"; runId: string; workspaceReadinessId?: string; runtimeSessionId?: string; frozenContextSummary?: string }
  | { type: "proposalReady"; runId: string; proposalId: string; verificationBundleId?: string }
  | { type: "applying"; runId: string; proposalId: string }
  | { type: "verifying"; runId: string; proposalId: string; verificationBundleId: string }
  | { type: "repairing"; runId: string; proposalId: string; verificationBundleId: string; lastError?: string }
  | { type: "completed"; runId: string; verificationBundleId: string }
  | { type: "blocked"; runId: string; proposalId?: string; verificationBundleId?: string; lastError?: string }
  | { type: "stopped"; runId: string; stoppedReason: string }
  | { type: "reset" };

export function createInitialControlledTaskExecutionState(): ControlledTaskExecutionState {
  return {
    phase: "idle",
    lineage: {},
  };
}

export function reduceControlledTaskExecution(state: ControlledTaskExecutionState, event: ControlledTaskExecutionEvent): ControlledTaskExecutionState {
  switch (event.type) {
    case "startPlanning":
      if (!["idle", "stopped", "blocked", "completed"].includes(state.phase)) {
        return state;
      }
      return {
        phase: "planning",
        lineage: { runId: event.runId },
      };
    case "contextReady":
      if (state.phase !== "planning" || !hasRunId(state, event.runId)) {
        return state;
      }
      return {
        phase: "context_ready",
        lineage: {
          ...state.lineage,
          workspaceReadinessId: event.workspaceReadinessId,
          runtimeSessionId: event.runtimeSessionId,
        },
        frozenContextSummary: event.frozenContextSummary,
      };
    case "proposalReady":
      if (!canAcceptProposalReady(state, event)) {
        return state;
      }
      return {
        phase: "proposal_ready",
        lineage: {
          ...state.lineage,
          proposalId: event.proposalId,
          verificationBundleId: undefined,
        },
        frozenContextSummary: state.frozenContextSummary,
      };
    case "applying":
      if (state.phase !== "proposal_ready" || !hasRunId(state, event.runId) || !hasProposalId(state, event.proposalId)) {
        return state;
      }
      return {
        ...state,
        phase: "applying",
      };
    case "verifying":
      if (state.phase !== "applying" || !hasRunId(state, event.runId) || !hasProposalId(state, event.proposalId)) {
        return state;
      }
      return {
        ...state,
        phase: "verifying",
        lineage: {
          ...state.lineage,
          verificationBundleId: event.verificationBundleId,
        },
      };
    case "repairing":
      if (state.phase !== "verifying" || !hasRunId(state, event.runId) || !hasProposalId(state, event.proposalId) || !hasVerificationBundleId(state, event.verificationBundleId)) {
        return state;
      }
      return {
        ...state,
        phase: "repairing",
        lastError: event.lastError,
      };
    case "completed":
      if (state.phase !== "verifying" || !hasRunId(state, event.runId) || !hasVerificationBundleId(state, event.verificationBundleId)) {
        return state;
      }
      return {
        ...state,
        phase: "completed",
      };
    case "blocked":
      if (state.phase !== "repairing" || !hasRunId(state, event.runId) || !matchesCurrentId(state.lineage.proposalId, event.proposalId) || !matchesCurrentId(state.lineage.verificationBundleId, event.verificationBundleId)) {
        return state;
      }
      return {
        ...state,
        phase: "blocked",
        lastError: event.lastError,
      };
    case "stopped":
      if (!isActivePhase(state.phase) || !hasRunId(state, event.runId)) {
        return state;
      }
      return {
        ...state,
        phase: "stopped",
        stoppedReason: event.stoppedReason,
      };
    case "reset":
      return createInitialControlledTaskExecutionState();
    default:
      return state;
  }
}

function canAcceptProposalReady(state: ControlledTaskExecutionState, event: Extract<ControlledTaskExecutionEvent, { type: "proposalReady" }>): boolean {
  if (!hasRunId(state, event.runId)) {
    return false;
  }
  if (state.phase === "context_ready") {
    return event.verificationBundleId === undefined;
  }
  if (state.phase === "repairing") {
    return hasVerificationBundleId(state, event.verificationBundleId ?? "");
  }
  return false;
}

function isActivePhase(phase: ControlledTaskExecutionPhase): boolean {
  return ["planning", "context_ready", "proposal_ready", "applying", "verifying", "repairing"].includes(phase);
}

function hasRunId(state: ControlledTaskExecutionState, runId: string): boolean {
  return state.lineage.runId === runId;
}

function hasProposalId(state: ControlledTaskExecutionState, proposalId: string): boolean {
  return state.lineage.proposalId === proposalId;
}

function hasVerificationBundleId(state: ControlledTaskExecutionState, verificationBundleId: string): boolean {
  return state.lineage.verificationBundleId === verificationBundleId;
}

function matchesCurrentId(currentId: string | undefined, eventId: string | undefined): boolean {
  return eventId === undefined || currentId === eventId;
}
