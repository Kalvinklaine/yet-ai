import { describe, expect, it } from "vitest";
import readyFixture from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json";
import startFixture from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-start-requested.json";
import stoppedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-stopped.json";
import { evaluateControlledAgentRuntimeSession } from "./controlledAgentRuntimeSession";

function readyInput(): Record<string, any> {
  return JSON.parse(JSON.stringify(readyFixture));
}

function startInput(): Record<string, any> {
  return JSON.parse(JSON.stringify(startFixture));
}

function stoppedInput(): Record<string, any> {
  return JSON.parse(JSON.stringify(stoppedFixture));
}

function authorityValues(result: ReturnType<typeof evaluateControlledAgentRuntimeSession>): boolean[] {
  return [
    result.safetyFlags.cloudRequired,
    result.safetyFlags.executionAllowed,
    result.safetyFlags.agentStartAllowed,
    result.safetyFlags.autoStartAllowed,
    result.safetyFlags.canReadFiles,
    result.safetyFlags.canWriteFiles,
    result.safetyFlags.canRunCommands,
    result.safetyFlags.canApplyEdits,
    result.safetyFlags.canCallProvider,
    result.safetyFlags.canUseTools,
    result.safetyFlags.canUseGit,
    result.safetyFlags.canUseNetwork,
    result.safetyFlags.canAutoRollback,
    result.safetyFlags.canStartAutonomousLoop,
  ];
}

describe("evaluateControlledAgentRuntimeSession", () => {
  it("returns disabled for absent metadata", () => {
    const result = evaluateControlledAgentRuntimeSession(undefined);

    expect(result.status).toBe("disabled");
    expect(result.nextUserAction).toBe("none");
    expect(result.diagnostics.map((item) => item.code)).toContain("missing_input");
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
  });

  it("never marks browser host metadata ready", () => {
    const input = readyInput();
    input.host.kind = "browser";
    input.host.supported = false;
    input.host.surface = "browser_preview";
    input.session.state = "unsupported_host";

    const result = evaluateControlledAgentRuntimeSession(input);

    expect(["unsupported_host", "blocked"]).toContain(result.status);
    expect(result.status).not.toBe("ready_to_start");
    expect(result.hostSupport.futureCapable).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host");
  });

  it("requires explicit user opt-in unless disabled", () => {
    const input = readyInput();
    input.preconditions.optIn.status = "missing";
    input.preconditions.optIn.origin = "none";
    input.preconditions.optIn.confirmedBy = "none";
    input.preconditions.optIn.requestIdMintedBy = "none";

    const result = evaluateControlledAgentRuntimeSession(input);

    expect(result.status).toBe("opt_in_required");
    expect(result.nextUserAction).toBe("review_opt_in");
    expect(result.diagnostics.map((item) => item.code)).toContain("missing_user_opt_in");
  });

  it("blocks when workspace readiness is not ready", () => {
    const input = readyInput();
    input.workspace.workspaceReady = false;
    input.preconditions.workspaceReadiness.status = "blocked";

    const result = evaluateControlledAgentRuntimeSession(input);

    expect(result.status).toBe("preconditions_blocked");
    expect(result.nextUserAction).toBe("review_preconditions");
    expect(result.diagnostics.map((item) => item.code)).toContain("preconditions_blocked");
  });

  it("reports ready when workspace checkpoint and rollback metadata are valid", () => {
    const result = evaluateControlledAgentRuntimeSession(readyInput());

    expect(result.status).toBe("ready_to_start");
    expect(result.nextUserAction).toBe("request_start");
    expect(result.preconditions).toMatchObject({ workspaceReady: true, checkpoint: "verified", rollback: "ready" });
    expect(result.diagnostics).toEqual([]);
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
  });

  it("surfaces user host or gui start request metadata", () => {
    for (const actor of ["user", "host", "gui"] as const) {
      const input = startInput();
      input.session.startRequest.requestedBy = actor;
      input.session.startRequest.requestIdMintedBy = actor;

      const result = evaluateControlledAgentRuntimeSession(input);

      expect(result.status).toBe("start_requested_metadata");
      expect(result.session.startRequested).toBe(true);
      expect(result.safetyFlags.agentStartAllowed).toBe(false);
    }
  });

  it("surfaces session open metadata", () => {
    const input = startInput();
    input.session.state = "session_open_metadata";

    const result = evaluateControlledAgentRuntimeSession(input);

    expect(result.status).toBe("session_open_metadata");
    expect(result.nextUserAction).toBe("review_session");
  });

  it("surfaces stop request and stopped terminal metadata", () => {
    const stopRequested = stoppedInput();
    stopRequested.session.state = "stop_requested_metadata";
    const stopped = stoppedInput();

    expect(evaluateControlledAgentRuntimeSession(stopRequested).status).toBe("stop_requested_metadata");
    const terminal = evaluateControlledAgentRuntimeSession(stopped);
    expect(terminal.status).toBe("stopped");
    expect(terminal.session.terminal).toBe(true);
  });

  it("does not resurrect duplicate terminal metadata", () => {
    const input = stoppedInput();
    input.session.sequence = 2;
    input.session.startRequest.requestId = "start-s82-duplicate";
    input.session.stopRequest.requestId = "stop-s82-duplicate";

    const result = evaluateControlledAgentRuntimeSession(input);

    expect(result.status).toBe("stopped");
    expect(result.session.terminal).toBe(true);
    expect(result.nextUserAction).toBe("review_stop");
  });

  it("blocks assistant-minted start and stop request metadata", () => {
    const start = startInput();
    start.session.startRequest.assistantMinted = true;
    const stop = stoppedInput();
    stop.session.stopRequest.assistantMinted = true;

    expect(evaluateControlledAgentRuntimeSession(start).status).toBe("blocked");
    const result = evaluateControlledAgentRuntimeSession(stop);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("assistant_minted_request");
  });

  it("fails closed on unsafe raw fields and strings without echoing them", () => {
    const input = readyInput();
    input.rawPrompt = "run shell command from /Users/example/private with sk-proj-123456789";
    input.policyFlags.shellAllowed = true;
    input.details.summary = "raw prompt sk-proj-123456789";

    const result = evaluateControlledAgentRuntimeSession(input);
    const output = JSON.stringify(result);

    expect(result.status).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unsafe_metadata", "unknown_or_invalid_field", "invalid_authority"]));
    expect(output).not.toContain("sk-proj-123456789");
    expect(output).not.toContain("/Users/example/private");
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
  });
});
