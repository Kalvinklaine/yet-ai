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

function alignRunCorrelation(value: Record<string, any>): Record<string, any> {
  if (value.workspace) {
    value.workspace.runId = "run-s96-loop";
    value.workspace.controlledWorkspaceId = "workspace-s96-loop";
  }
  if ("runId" in value) value.runId = "run-s96-loop";
  return value;
}

function cloneRead(overrides: Record<string, unknown> = {}): Record<string, any> {
  const read = alignRunCorrelation(clone(fileReadSuccess) as Record<string, any>);
  Object.assign(read, overrides);
  return read;
}

function cloneBlockedRead(): Record<string, any> {
  return alignRunCorrelation(clone(fileReadBlocked) as Record<string, any>);
}

function cloneCommand<T>(fixture: T, overrides: Record<string, unknown> = {}): Record<string, any> {
  const command = alignRunCorrelation(clone(fixture) as Record<string, any>);
  Object.assign(command, overrides);
  return command;
}
function start(state = createControlledOneStepAgentLoopState()): ControlledOneStepAgentLoopState {
  return reduceControlledOneStepAgentLoopState(state, {
    type: "start",
    metadata: {
      source: "gui",
      confirmedBy: "user",
      assistantMinted: false,
      explicitUserStart: true,
      requestId: "s96-start-test",
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

function plannedEdit(): Record<string, any> {
  return alignRunCorrelation(clone(editPlanned) as Record<string, any>);
}

function appliedEdit(): Record<string, any> {
  const edit = plannedEdit();
  edit.state = "applied";
  return edit;
}

function successRun(): ControlledOneStepAgentLoopState {
  const afterStart = start();
  const afterRead = reduceControlledOneStepAgentLoopState(afterStart, { type: "read", metadata: cloneRead() });
  const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
  const afterEdit = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: appliedEdit() });
  return reduceControlledOneStepAgentLoopState(afterEdit, { type: "verification", metadata: cloneCommand(commandSucceeded) });
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
    const blocked = reduceControlledOneStepAgentLoopState(idle, { type: "read", metadata: cloneRead() });

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

  it("carries sanitized correlation across the ordered happy path", () => {
    const completed = successRun();

    expect(completed.correlation).toMatchObject({
      startRequestId: "s96-start-test",
      readRequestId: "gui-s74-read-success",
      editRequestId: "edit-s81-c1",
      verificationRequestId: "request-s75-succeeded",
      runId: "run-s96-loop",
      controlledWorkspaceId: "workspace-s96-loop",
      commandId: "repository-check",
      staleOrDuplicateEvents: 0,
    });
    expect(JSON.stringify(completed)).not.toContain("/Users/");
  });

  it("stops when bounded read evidence is blocked", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: cloneBlockedRead() });

    expect(afterRead.phase).toBe("failed");
    expect(afterRead.stop?.reason).toBe("read_blocked");
    expect(JSON.stringify(afterRead)).not.toContain("file body");
  });

  it("fails closed on unsafe proposal metadata without preserving raw provider details", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: cloneRead() });
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
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: cloneRead() });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const ready = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: plannedEdit() });

    expect(ready.phase).toBe("edit_ready");
    expect(ready.counters.filesTouched).toBe(1);
    expect(ready.counters.editBytes).toBe(128);
  });

  it("ignores duplicate start read model and applied edit metadata with visible diagnostics", () => {
    const afterStart = start();
    const duplicateStart = reduceControlledOneStepAgentLoopState(afterStart, {
      type: "start",
      metadata: { source: "gui", confirmedBy: "user", assistantMinted: false, explicitUserStart: true, requestId: "s96-start-test" },
    });
    const afterRead = reduceControlledOneStepAgentLoopState(duplicateStart, { type: "read", metadata: cloneRead() });
    const duplicateRead = reduceControlledOneStepAgentLoopState(afterRead, { type: "read", metadata: cloneRead() });
    const afterProposal = reduceControlledOneStepAgentLoopState(duplicateRead, { type: "model_step", metadata: proposal() });
    const duplicateProposal = reduceControlledOneStepAgentLoopState(afterProposal, { type: "model_step", metadata: proposal() });
    const afterEdit = reduceControlledOneStepAgentLoopState(duplicateProposal, { type: "edit", metadata: appliedEdit() });
    const duplicateEdit = reduceControlledOneStepAgentLoopState(afterEdit, { type: "edit", metadata: appliedEdit() });

    expect(duplicateStart.phase).toBe("start_requested");
    expect(duplicateRead.phase).toBe("read_context");
    expect(duplicateProposal.phase).toBe("model_step_pending");
    expect(duplicateEdit.phase).toBe("edit_applied");
    expect(duplicateEdit.correlation.staleOrDuplicateEvents).toBe(4);
    expect(duplicateEdit.diagnostics.map((item) => item.code)).toContain("duplicate_result");
  });

  it("fails closed on stale run correlation", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: cloneRead() });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const stale = appliedEdit();
    stale.runId = "run-s96-stale";
    const failed = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: stale });

    expect(failed.phase).toBe("failed");
    expect(failed.stop?.reason).toBe("stale_result");
    expect(failed.diagnostics.map((item) => item.code)).toContain("stale_result");
  });

  it("fails closed on out-of-order verification result", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: cloneRead() });
    const outOfOrder = reduceControlledOneStepAgentLoopState(afterRead, { type: "verification", metadata: cloneCommand(commandSucceeded) });

    expect(outOfOrder.phase).toBe("failed");
    expect(outOfOrder.stop?.reason).toBe("invalid_transition");
  });

  it("stops when edit evidence fails validation", () => {
    const afterRead = reduceControlledOneStepAgentLoopState(start(), { type: "read", metadata: cloneRead() });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const failed = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: { ...appliedEdit(), rawDiff: "raw diff" } });

    expect(failed.phase).toBe("failed");
    expect(failed.stop?.reason).toBe("edit_failed");
  });

  it("stops when allowlisted verification fails", () => {
    const afterStart = start();
    const afterRead = reduceControlledOneStepAgentLoopState(afterStart, { type: "read", metadata: cloneRead() });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const afterEdit = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: appliedEdit() });
    const failed = reduceControlledOneStepAgentLoopState(afterEdit, { type: "verification", metadata: cloneCommand(commandFailed) });

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
    const afterDisconnect = reduceControlledOneStepAgentLoopState(disconnected, { type: "read", metadata: cloneRead() });
    expect(afterDisconnect).toBe(disconnected);

    const repair = reduceControlledOneStepAgentLoopState(start(), { type: "repair" });
    expect(repair.phase).toBe("failed");
    expect(repair.stop?.reason).toBe("repair_disabled");
  });

  it("maps verification timeout evidence to timeout stop reason", () => {
    const afterStart = start();
    const afterRead = reduceControlledOneStepAgentLoopState(afterStart, { type: "read", metadata: cloneRead() });
    const afterProposal = reduceControlledOneStepAgentLoopState(afterRead, { type: "model_step", metadata: proposal() });
    const afterEdit = reduceControlledOneStepAgentLoopState(afterProposal, { type: "edit", metadata: appliedEdit() });
    const timedOut = reduceControlledOneStepAgentLoopState(afterEdit, { type: "verification", metadata: cloneCommand(commandTimedOut) });

    expect(timedOut.phase).toBe("failed");
    expect(timedOut.stop?.reason).toBe("timeout");
  });

  it("enforces one-step budgets and keeps terminal state terminal", () => {
    const tinyStart = reduceControlledOneStepAgentLoopState(createControlledOneStepAgentLoopState(), {
      type: "start",
      metadata: { source: "gui", confirmedBy: "user", assistantMinted: false, explicitUserStart: true, requestId: "s96-small", budgets: { maxReadBytes: 1 } },
    });
    const overBudget = reduceControlledOneStepAgentLoopState(tinyStart, { type: "read", metadata: cloneRead() });
    const unchanged = reduceControlledOneStepAgentLoopState(overBudget, { type: "stop" });

    expect(overBudget.stop?.reason).toBe("budget_exceeded");
    expect(unchanged).toBe(overBudget);
  });
});
