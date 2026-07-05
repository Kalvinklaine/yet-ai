import { describe, expect, it } from "vitest";
import commandFailed from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-failed.json";
import commandSucceeded from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-succeeded.json";
import commandTimedOut from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-timed_out.json";
import editPlanned from "../../../../packages/contracts/examples/engine/controlled-agent-edit-executor-planned.json";
import fileReadBlocked from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-blocked.json";
import fileReadSuccess from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-success.json";
import { createControlledOneStepAgentLoopState, reduceControlledOneStepAgentLoopState, type ControlledOneStepAgentLoopState } from "./controlledOneStepAgentLoop";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function start(state = createControlledOneStepAgentLoopState()): ControlledOneStepAgentLoopState {
  return reduceControlledOneStepAgentLoopState(state, {
    type: "start",
    metadata: {
      source: "gui",
      confirmedBy: "user",
      assistantMinted: false,
      explicitUserStart: true,
      requestId: "s86-start-test",
      summary: "User started one step",
    },
  });
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: "completed",
    stepCount: 1,
    sanitizedOnly: true,
    modelProposalAllowed: true,
    providerPayloadStored: false,
    providerResponseStored: false,
    summary: "Sanitized model step metadata recorded",
    ...overrides,
  };
}

function appliedEdit(): Record<string, unknown> {
  const edit = clone(editPlanned) as Record<string, unknown>;
  edit.state = "applied";
  return edit;
}

function successRun(): ControlledOneStepAgentLoopState {
  const afterStart = start();
  const afterRead = reduceControlledOneStepAgentLoopState(afterStart, { type: "read", metadata: clone(fileReadSuccess) });
  const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
  const afterEdit = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: appliedEdit() });
  return reduceControlledOneStepAgentLoopState(afterEdit, { type: "verification", metadata: clone(commandSucceeded) });
}

function authorityValues(result: ControlledOneStepAgentLoopState): boolean[] {
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
    result.canUseNetwork,
    result.canUseTools,
    result.canInstallPackages,
    result.canRepair,
  ];
}

describe("controlledOneStepAgentLoop", () => {
  it("requires explicit user start before recording any loop evidence", () => {
    const idle = createControlledOneStepAgentLoopState();
    const blocked = reduceControlledOneStepAgentLoopState(idle, { type: "read", metadata: clone(fileReadSuccess) });

    expect(idle.phase).toBe("idle");
    expect(blocked.phase).toBe("failed");
    expect(blocked.stop?.reason).toBe("missing_user_start");
    expect(authorityValues(blocked).every((value) => value === false)).toBe(true);
  });

  it("covers the happy path through one read, one model step, one edit, and one verification", () => {
    const completed = successRun();

    expect(completed.phase).toBe("completed");
    expect(completed.stopped).toBe(true);
    expect(completed.counters).toMatchObject({ loopSteps: 1, fileReads: 1, filesTouched: 1, verificationRuns: 1 });
    expect(completed.counters.editBytes).toBeGreaterThan(0);
    expect(completed.stop).toBeUndefined();
    expect(completed.authority).toBe("one_step_loop_metadata_only");
    expect(authorityValues(completed).every((value) => value === false)).toBe(true);
  });

  it("stops when bounded read evidence is blocked", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: clone(fileReadBlocked) });

    expect(afterRead.phase).toBe("failed");
    expect(afterRead.stop?.reason).toBe("read_blocked");
    expect(JSON.stringify(afterRead)).not.toContain("file body");
  });

  it("fails closed on unsafe proposal metadata without preserving raw provider details", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: clone(fileReadSuccess) });
    const unsafe = reduceControlledOneStepAgentLoopState(afterRead, {
      type: "model_step",
      metadata: proposal({ providerResponseStored: true, rawPrompt: "raw provider response from /Users/example" }),
    });

    expect(unsafe.phase).toBe("failed");
    expect(unsafe.stop?.reason).toBe("unsafe_metadata");
    expect(JSON.stringify(unsafe)).not.toContain("/Users/example");
    expect(JSON.stringify(unsafe)).not.toContain("raw provider response");
  });

  it("records safe planned edit as edit_ready before applied edit evidence", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: clone(fileReadSuccess) });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const ready = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: clone(editPlanned) });

    expect(ready.phase).toBe("edit_ready");
    expect(ready.counters.filesTouched).toBe(1);
    expect(ready.counters.editBytes).toBe(128);
  });

  it("stops when edit evidence fails validation", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: clone(fileReadSuccess) });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const failed = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: { ...appliedEdit(), rawDiff: "raw diff" } });

    expect(failed.phase).toBe("failed");
    expect(failed.stop?.reason).toBe("edit_failed");
  });

  it("stops when allowlisted verification fails", () => {
    const afterStart = start();
    const afterRead = reduceControlledOneStepAgentLoopState(afterStart, { type: "read", metadata: clone(fileReadSuccess) });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const afterEdit = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: appliedEdit() });
    const failed = reduceControlledOneStepAgentLoopState(afterEdit, { type: "verification", metadata: clone(commandFailed) });

    expect(failed.phase).toBe("failed");
    expect(failed.stop?.reason).toBe("verification_failed");
    expect(failed.counters.verificationRuns).toBe(1);
  });

  it("covers timeout explicit stop runtime disconnect and no repair", () => {
    const timed = reduceControlledOneStepAgentLoopState(start(), { type: "tick", runtimeSeconds: 301 });
    expect(timed.phase).toBe("failed");
    expect(timed.stop?.reason).toBe("timeout");

    const stopped = reduceControlledOneStepAgentLoopState(start(), { type: "stop", summary: "User stopped" });
    expect(stopped.phase).toBe("stopped");
    expect(stopped.stop?.reason).toBe("user_stop");

    const disconnected = reduceControlledOneStepAgentLoopState(start(), { type: "runtime_disconnect", summary: "Runtime disconnected" });
    expect(disconnected.phase).toBe("stopped");
    expect(disconnected.stop?.reason).toBe("runtime_disconnected");
    expect(disconnected.enabled).toBe(false);

    const repair = reduceControlledOneStepAgentLoopState(start(), { type: "repair" });
    expect(repair.phase).toBe("failed");
    expect(repair.stop?.reason).toBe("repair_disabled");
  });

  it("maps verification timeout evidence to timeout stop reason", () => {
    const afterStart = start();
    const afterRead = reduceControlledOneStepAgentLoopState(afterStart, { type: "read", metadata: clone(fileReadSuccess) });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const afterEdit = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: appliedEdit() });
    const timedOut = reduceControlledOneStepAgentLoopState(afterEdit, { type: "verification", metadata: clone(commandTimedOut) });

    expect(timedOut.phase).toBe("failed");
    expect(timedOut.stop?.reason).toBe("timeout");
  });

  it("enforces one-step budgets and keeps terminal state terminal", () => {
    const tinyStart = reduceControlledOneStepAgentLoopState(createControlledOneStepAgentLoopState(), {
      type: "start",
      metadata: { source: "gui", confirmedBy: "user", assistantMinted: false, explicitUserStart: true, requestId: "s86-small", budgets: { maxReadBytes: 1 } },
    });
    const overBudget = reduceControlledOneStepAgentLoopState(tinyStart, { type: "read", metadata: clone(fileReadSuccess) });
    const unchanged = reduceControlledOneStepAgentLoopState(overBudget, { type: "stop" });

    expect(overBudget.stop?.reason).toBe("budget_exceeded");
    expect(unchanged).toBe(overBudget);
  });
});
