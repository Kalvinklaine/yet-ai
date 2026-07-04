import { describe, expect, it } from "vitest";
import readyRuntime from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json";
import readyReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import { buildControlledAgentCommandRunRequest, correlateControlledAgentCommandRunResult, type ControlledAgentCommandRunRequestCorrelation } from "./controlledAgentCommandRunRequest";

const hash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function runtime(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyRuntime) as Record<string, any>;
  input.session.sessionId = "run-s85-request";
  input.workspace.controlledWorkspaceId = "workspace-s85-request";
  input.workspace.readinessId = "ready-s85-request";
  input.preconditions.workspaceReadiness.readinessId = "ready-s85-request";
  input.preconditions.correlation.readinessId = "ready-s85-request";
  Object.assign(input, overrides);
  return input;
}

function readiness(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyReadiness) as Record<string, any>;
  input.isolation.readinessId = "ready-s85-request";
  Object.assign(input, overrides);
  return input;
}

function requestInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: "vscode",
    runtimeSessionMetadata: runtime(),
    workspaceReadinessMetadata: readiness(),
    commandId: "gui-app-tests",
    userConfirmed: true,
    requestSeed: "unit",
    ...overrides,
  };
}

function readyRequest() {
  const result = buildControlledAgentCommandRunRequest(requestInput());
  expect(result.state).toBe("ready");
  expect(result.correlation).toBeDefined();
  return result as typeof result & { correlation: ControlledAgentCommandRunRequestCorrelation };
}

function resultMessage(correlation: ControlledAgentCommandRunRequestCorrelation, overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    version: "2026-05-15",
    type: "host.controlledAgentCommandRunResult",
    requestId: correlation.requestId,
    payload: {
      requestId: correlation.requestId,
      requestIdMintedBy: "gui",
      userConfirmed: true,
      controlledWorkspaceId: correlation.controlledWorkspaceId,
      runId: correlation.runId,
      runtimeSessionId: correlation.runtimeSessionId,
      workspaceReadinessId: correlation.workspaceReadinessId,
      commandId: correlation.commandId,
      status: "succeeded",
      authority: "allowlisted_command_id",
      cloudRequired: false,
      executionAllowed: false,
      freeformCommandAllowed: false,
      policyFlags: safePolicyFlags(),
      durationMs: 1200,
      exitCode: 0,
      outputTail: "All checks passed.",
      outputByteCount: 18,
      outputLineCount: 1,
      resultHash: hash,
      truncated: false,
      message: "Verification completed safely.",
      ...overrides,
    },
  };
}

function safePolicyFlags() {
  return {
    allowlistedCommandIdOnly: true,
    freeformCommandAllowed: false,
    argsAllowed: false,
    cwdAllowed: false,
    envAllowed: false,
    shellAllowed: false,
    gitAllowed: false,
    networkAllowed: false,
    providerAllowed: false,
    toolAllowed: false,
    packageInstallAllowed: false,
    fileReadAllowed: false,
    fileWriteAllowed: false,
    hiddenSearchAllowed: false,
    indexingAllowed: false,
    autoStartAllowed: false,
    autoApplyAllowed: false,
    autoRunAllowed: false,
    autoVerifyAllowed: false,
    autoFixAllowed: false,
  };
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

describe("controlledAgentCommandRunRequest", () => {
  it("builds a ready request with only S85 allowlisted fields", () => {
    const result = buildControlledAgentCommandRunRequest(requestInput());

    expect(result.state).toBe("ready");
    expect(result.bridgeRequest).toMatchObject({
      version: "2026-05-15",
      type: "gui.controlledAgentCommandRunRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        controlledWorkspaceId: "workspace-s85-request",
        runId: "run-s85-request",
        runtimeSessionId: "run-s85-request",
        workspaceReadinessId: "ready-s85-request",
        userConfirmed: true,
        commandId: "gui-app-tests",
        limits: {
          tailOnly: true,
          commandStringAllowed: false,
          argsAllowed: false,
          cwdAllowed: false,
          envAllowed: false,
          shellAllowed: false,
        },
      },
    });
    expect(result.bridgeRequest?.requestId).toMatch(/^gui-s85-[a-z0-9]+$/);
    expect(result.bridgeRequest?.payload.requestId).toBe(result.bridgeRequest?.requestId);
    expect(Object.keys(result.bridgeRequest?.payload ?? {})).toEqual(["requestId", "requestIdMintedBy", "source", "assistantMinted", "controlledWorkspaceId", "runId", "runtimeSessionId", "workspaceReadinessId", "userConfirmed", "commandId", "limits", "policyFlags"]);
    expect(result.bridgeRequest?.payload).not.toHaveProperty("command");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("cwd");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("env");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("shell");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("args");
  });

  it("blocks missing confirmation, unsupported commands, browser hosts, and assistant-minted ids", () => {
    const unconfirmed = buildControlledAgentCommandRunRequest(requestInput({ userConfirmed: false }));
    const unsupported = buildControlledAgentCommandRunRequest(requestInput({ commandId: "npm-test" }));
    const browser = buildControlledAgentCommandRunRequest(requestInput({ host: "browser" }));
    const assistantRuntime = runtime();
    assistantRuntime.preconditions.optIn.assistantMinted = true;
    const assistant = buildControlledAgentCommandRunRequest(requestInput({ runtimeSessionMetadata: assistantRuntime }));

    expect(unconfirmed.state).toBe("blocked");
    expect(unconfirmed.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
    expect(unsupported.state).toBe("blocked");
    expect(unsupported.diagnostics.map((item) => item.code)).toContain("unsupported_command");
    expect(browser.state).toBe("unsupported");
    expect(browser.diagnostics.map((item) => item.code)).toContain("browser_host");
    expect(assistant.state).toBe("blocked");
    expect(assistant.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
  });

  it("rejects raw, private, or privileged metadata without echoing unsafe values", () => {
    const result = buildControlledAgentCommandRunRequest(requestInput({ rawOutput: "SECRET_SENTINEL", plannedCommandRunMetadata: { commandId: "gui-app-tests", userConfirmed: true, cwd: "/Users/alice/project" } }));
    const rendered = output(result);

    expect(result.state).toBe("blocked");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
  });

  it("accepts matching running and terminal results", () => {
    const { correlation } = readyRequest();
    const running = resultMessage(correlation, { status: "running", durationMs: 50, exitCode: undefined, outputTail: undefined, outputByteCount: undefined, outputLineCount: undefined, resultHash: undefined, truncated: false, message: "Verification is running." });
    const terminal = resultMessage(correlation);

    const runningResult = correlateControlledAgentCommandRunResult({ current: correlation, hostMessage: running });
    const terminalResult = correlateControlledAgentCommandRunResult({ current: correlation, hostMessage: terminal });

    expect(runningResult.state).toBe("accepted");
    expect(runningResult.commandRun?.status).toBe("running");
    expect(terminalResult.state).toBe("accepted");
    expect(terminalResult.commandRun).toMatchObject({ status: "succeeded", commandId: "gui-app-tests", outputTail: "All checks passed." });
  });

  it("ignores stale and mismatched results", () => {
    const { correlation } = readyRequest();
    const stale = resultMessage(correlation);
    stale.payload.runId = "other-run";
    const mismatched = resultMessage(correlation, { commandId: "repository-check" });

    expect(correlateControlledAgentCommandRunResult({ current: correlation, hostMessage: stale }).state).toBe("ignored");
    expect(correlateControlledAgentCommandRunResult({ current: correlation, hostMessage: mismatched }).state).toBe("ignored");
  });

  it("deduplicates terminal results and blocks unsafe host output", () => {
    const { correlation } = readyRequest();
    const message = resultMessage(correlation);
    const duplicate = correlateControlledAgentCommandRunResult({ current: correlation, hostMessage: message, existingResult: { status: "succeeded", commandId: "gui-app-tests", message: "done" } });
    const unsafe = resultMessage(correlation, { outputTail: "Authorization: Bearer unsafe", message: "Verification completed safely." });

    expect(duplicate.state).toBe("duplicate");
    const unsafeResult = correlateControlledAgentCommandRunResult({ current: correlation, hostMessage: unsafe });
    expect(unsafeResult.state).toBe("blocked");
    expect(output(unsafeResult)).not.toContain("Bearer unsafe");
  });

  it("blocks authority-widening host results", () => {
    const { correlation } = readyRequest();
    const widened = resultMessage(correlation);
    widened.payload.policyFlags.shellAllowed = true;

    const result = correlateControlledAgentCommandRunResult({ current: correlation, hostMessage: widened });

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("invalid_authority");
  });
});
