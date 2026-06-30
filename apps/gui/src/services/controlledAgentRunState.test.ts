import { describe, expect, it } from "vitest";
import commandFailed from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-failed.json";
import commandKilled from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-killed.json";
import commandRunning from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-running.json";
import commandSucceeded from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-succeeded.json";
import fileReadSuccess from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-success.json";
import worktreeReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import { initializeControlledAgentRunState, reduceControlledAgentRunState, type ControlledAgentRunState } from "./controlledAgentRunState";

function readyRun(): ControlledAgentRunState {
  return initializeControlledAgentRunState({
    readiness: structuredClone(worktreeReadiness),
    userOptIn: { source: "user", confirmed: true, requestId: "user-s76" },
    limits: { maxSteps: 4, maxFileReads: 2, maxReadBytes: 4096, maxTouchedFiles: 2, maxPatchBytes: 2048, maxRuntimeSeconds: 60, maxRepairAttempts: 1 },
  });
}

function noAuthority(result: ControlledAgentRunState): boolean[] {
  return [
    result.cloudRequired,
    result.executionAllowed,
    result.agentStartAllowed,
    result.autoStartAllowed,
    result.canReadFiles,
    result.canWriteFiles,
    result.canRunCommands,
    result.canApplyEdits,
    result.canCallProvider,
    result.canUseGit,
    result.canUseTools,
    result.canAutoRollback,
    result.canStartAutonomousLoop,
  ];
}

describe("controlledAgentRunState", () => {
  it("initializes as opt-in required until an explicit user opt-in is present", () => {
    const result = initializeControlledAgentRunState({ readiness: structuredClone(worktreeReadiness) });

    expect(result.phase).toBe("opt_in_required");
    expect(result.nextUserAction).toBe("review_opt_in");
    expect(noAuthority(result).every((value) => value === false)).toBe(true);
  });

  it("initializes ready state from readiness and user opt-in without granting authority", () => {
    const result = readyRun();

    expect(result.phase).toBe("workspace_ready");
    expect(result.enabled).toBe(true);
    expect(result.counters.userTurns).toBe(1);
    expect(noAuthority(result).every((value) => value === false)).toBe(true);
  });

  it("transitions through read, command, waiting, and completed phases", () => {
    const afterRead = reduceControlledAgentRunState(readyRun(), { type: "read", metadata: structuredClone(fileReadSuccess) });
    expect(afterRead.phase).toBe("reading_context");
    expect(afterRead.counters.fileReadsUsed).toBe(1);
    expect(afterRead.counters.readBytesUsed).toBeGreaterThan(0);

    const running = reduceControlledAgentRunState(afterRead, { type: "command", metadata: structuredClone(commandRunning) });
    expect(running.phase).toBe("running_verification");
    expect(running.counters.verificationRuns).toBe(1);

    const waiting = reduceControlledAgentRunState(running, { type: "wait", summary: "Review sanitized plan" });
    expect(waiting.phase).toBe("waiting_for_user");

    const completed = reduceControlledAgentRunState(waiting, { type: "complete", summary: "Finished safely" });
    expect(completed.phase).toBe("completed");
    expect(completed.stopped).toBe(true);
    expect(completed.nextUserAction).toBe("review_completion");
  });

  it("records succeeded commands as planning metadata and failed commands as stopped failures", () => {
    const succeeded = reduceControlledAgentRunState(readyRun(), { type: "command", metadata: structuredClone(commandSucceeded) });
    expect(succeeded.phase).toBe("planning");
    expect(succeeded.stop).toBeUndefined();

    const failed = reduceControlledAgentRunState(readyRun(), { type: "command", metadata: structuredClone(commandFailed) });
    expect(failed.phase).toBe("failed");
    expect(failed.stop?.reason).toBe("verification_failed");
    expect(failed.stopped).toBe(true);
  });

  it("supports explicit stop and kill transitions", () => {
    const stopped = reduceControlledAgentRunState(readyRun(), { type: "stop", summary: "User stopped" });
    expect(stopped.phase).toBe("stopped");
    expect(stopped.stop?.reason).toBe("user_stop");

    const killed = reduceControlledAgentRunState(readyRun(), { type: "kill", summary: "User killed" });
    expect(killed.phase).toBe("stopped");
    expect(killed.stop?.reason).toBe("user_kill");

    const commandKill = reduceControlledAgentRunState(readyRun(), { type: "command", metadata: structuredClone(commandKilled) });
    expect(commandKill.phase).toBe("stopped");
    expect(commandKill.stop?.reason).toBe("user_kill");
  });

  it("fails closed on blocked, failed, malformed, and unsafe events", () => {
    expect(reduceControlledAgentRunState(readyRun(), { type: "blocked", summary: "Policy blocked" }).phase).toBe("blocked");
    expect(reduceControlledAgentRunState(readyRun(), { type: "failed", summary: "Internal issue" }).phase).toBe("failed");

    const malformed = reduceControlledAgentRunState(readyRun(), { type: "mystery" });
    expect(malformed.phase).toBe("blocked");
    expect(malformed.stop?.reason).toBe("internal_error");

    const unsafe = reduceControlledAgentRunState(readyRun(), { type: "wait", rawCommand: "npm test from /Users/example" });
    expect(unsafe.phase).toBe("blocked");
    expect(unsafe.stop?.reason).toBe("unsafe_metadata");
    expect(JSON.stringify(unsafe)).not.toContain("npm test");
    expect(JSON.stringify(unsafe)).not.toContain("/Users/example");
  });

  it("enforces step, read byte, touched file, runtime, and repair attempt limits", () => {
    const stepLimit = initializeControlledAgentRunState({ readiness: structuredClone(worktreeReadiness), userOptIn: { source: "user", confirmed: true }, limits: { maxSteps: 1 } });
    const overStep = reduceControlledAgentRunState(reduceControlledAgentRunState(stepLimit, { type: "wait" }), { type: "wait" });
    expect(overStep.stop?.reason).toBe("step_limit");

    const readLimit = initializeControlledAgentRunState({ readiness: structuredClone(worktreeReadiness), userOptIn: { source: "user", confirmed: true }, limits: { maxReadBytes: 1 } });
    expect(reduceControlledAgentRunState(readLimit, { type: "read", metadata: structuredClone(fileReadSuccess) }).stop?.reason).toBe("read_budget_exhausted");

    expect(reduceControlledAgentRunState(readyRun(), { type: "touch", filesTouched: 3 }).stop?.reason).toBe("file_limit");
    expect(reduceControlledAgentRunState(readyRun(), { type: "touch", patchBytes: 4096 }).stop?.reason).toBe("patch_limit");
    expect(reduceControlledAgentRunState(readyRun(), { type: "tick", runtimeSeconds: 61 }).stop?.reason).toBe("runtime_limit");

    const repairLimit = initializeControlledAgentRunState({ readiness: structuredClone(worktreeReadiness), userOptIn: { source: "user", confirmed: true }, limits: { maxRepairAttempts: 0 } });
    expect(reduceControlledAgentRunState(repairLimit, { type: "repair" }).stop?.reason).toBe("repair_limit");
  });

  it("does not write browser storage while reducing", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = reduceControlledAgentRunState(readyRun(), { type: "wait" });

    expect(result.phase).toBe("waiting_for_user");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
