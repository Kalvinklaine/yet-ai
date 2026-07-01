type ControlledAgentRepairLoopEvaluation = {
  state: string;
  canAttemptRepair: boolean;
  mustStop: boolean;
  attemptCount: number;
  maxAttempts: number;
  diagnostics: string[];
};

export function evaluateControlledAgentRepairLoop(input: unknown): ControlledAgentRepairLoopEvaluation {
  const diagnostics: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      state: "blocked",
      canAttemptRepair: false,
      mustStop: true,
      attemptCount: 0,
      maxAttempts: 0,
      diagnostics: ["malformed"],
    };
  }

  const value = input as Record<string, unknown>;
  const state = typeof value.state === "string" ? value.state : "blocked";
  const attemptCount = typeof value.attemptCount === "number" && Number.isFinite(value.attemptCount) ? value.attemptCount : 0;
  const maxAttempts = typeof value.maxAttempts === "number" && Number.isFinite(value.maxAttempts) ? value.maxAttempts : 0;
  const checkpointReady = value.checkpointReady === true;
  const rollbackReady = value.rollbackReady === true;
  const userStopped = value.userStopped === true;
  const unsafeMetadata = value.unsafeMetadata === true;

  if (typeof value.state !== "string") {
    diagnostics.push("state_defaulted");
  }

  if (typeof value.attemptCount !== "number" || !Number.isFinite(value.attemptCount)) {
    diagnostics.push("attemptCount_defaulted");
  }

  if (typeof value.maxAttempts !== "number" || !Number.isFinite(value.maxAttempts)) {
    diagnostics.push("maxAttempts_defaulted");
  }

  if (!checkpointReady) {
    diagnostics.push("checkpoint_not_ready");
  }

  if (!rollbackReady) {
    diagnostics.push("rollback_not_ready");
  }

  if (userStopped) {
    diagnostics.push("user_stopped");
  }

  if (unsafeMetadata) {
    diagnostics.push("unsafe_metadata");
  }

  if (attemptCount >= maxAttempts) {
    diagnostics.push("attempts_exhausted");
  }

  if (state === "blocked") {
    diagnostics.push("blocked");
  }

  const canAttemptRepair = state === "eligible" && attemptCount < maxAttempts && checkpointReady && rollbackReady && !userStopped && !unsafeMetadata;
  const mustStop = state === "exhausted" || state === "blocked" || userStopped || unsafeMetadata || attemptCount >= maxAttempts;

  return {
    state,
    canAttemptRepair,
    mustStop,
    attemptCount,
    maxAttempts,
    diagnostics,
  };
}
