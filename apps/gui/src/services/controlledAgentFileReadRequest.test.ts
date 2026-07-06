import { describe, expect, it } from "vitest";
import readyRuntime from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json";
import readyReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import blockedResultFixture from "../../../../packages/contracts/examples/bridge/host-controlled-agent-file-read-result-blocked.json";
import successResultFixture from "../../../../packages/contracts/examples/bridge/host-controlled-agent-file-read-result-success.json";
import { buildControlledAgentFileReadRequest, correlateControlledAgentFileReadResult, type ControlledAgentFileReadRequestCorrelation } from "./controlledAgentFileReadRequest";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function runtime(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyRuntime) as Record<string, any>;
  input.session.sessionId = "run-s83-request";
  input.workspace.controlledWorkspaceId = "workspace-s83-request";
  Object.assign(input, overrides);
  return input;
}

function readiness(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyReadiness) as Record<string, any>;
  Object.assign(input, overrides);
  return input;
}

function requestInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: "vscode",
    runtimeSessionMetadata: runtime(),
    workspaceReadinessMetadata: readiness(),
    workspaceRelativePath: "docs/architecture/013-agent-readiness-milestone.md",
    maxBytes: 2048,
    maxLines: 80,
    requestSeed: "unit",
    ...overrides,
  };
}

function readyRequest() {
  const result = buildControlledAgentFileReadRequest(requestInput());
  expect(result.state).toBe("ready");
  expect(result.correlation).toBeDefined();
  return result as typeof result & { correlation: ControlledAgentFileReadRequestCorrelation };
}

function successMessage(correlation: ControlledAgentFileReadRequestCorrelation): Record<string, any> {
  const message = clone(successResultFixture) as Record<string, any>;
  message.requestId = correlation.requestId;
  message.payload.request.requestId = correlation.requestId;
  message.payload.workspace.runId = correlation.runId;
  message.payload.workspace.controlledWorkspaceId = correlation.controlledWorkspaceId;
  message.payload.request.workspaceRelativePath = correlation.workspaceRelativePath;
  message.payload.result.sanitizedPathLabel = correlation.workspaceRelativePath;
  return message;
}

function blockedMessage(correlation: ControlledAgentFileReadRequestCorrelation): Record<string, any> {
  const message = clone(blockedResultFixture) as Record<string, any>;
  message.requestId = correlation.requestId;
  message.payload.request.requestId = correlation.requestId;
  message.payload.workspace.runId = correlation.runId;
  message.payload.workspace.controlledWorkspaceId = correlation.controlledWorkspaceId;
  message.payload.request.source = "gui";
  message.payload.request.requestIdMintedBy = "gui";
  message.payload.request.workspaceRelativePath = correlation.workspaceRelativePath;
  return message;
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

function noAuthority(value: { authority: Record<string, boolean> }): boolean[] {
  return Object.values(value.authority);
}

describe("controlledAgentFileReadRequest", () => {
  it("keeps disabled or absent metadata from building a request", () => {
    const result = buildControlledAgentFileReadRequest({ host: "vscode" });

    expect(result.state).toBe("blocked");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.correlation).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("runtime_session_not_ready");
    expect(result.diagnostics.map((item) => item.code)).toContain("workspace_not_ready");
    expect(noAuthority(result).every((value) => value === false)).toBe(true);
  });

  it("blocks browser hosts", () => {
    const result = buildControlledAgentFileReadRequest(requestInput({ host: "browser" }));

    expect(result.state).toBe("unsupported");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("browser_host");
  });

  it("builds a ready VS Code bridge request from ready metadata", () => {
    const result = buildControlledAgentFileReadRequest(requestInput());

    expect(result.state).toBe("ready");
    expect(result.bridgeRequest).toMatchObject({
      version: "2026-05-15",
      type: "gui.controlledAgentFileReadRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        controlledWorkspaceId: "workspace-s83-request",
        runId: "run-s83-request",
        runtimeSessionId: "run-s83-request",
        workspaceRelativePath: "docs/architecture/013-agent-readiness-milestone.md",
        allowBody: true,
        singleFileOnly: true,
        recursive: false,
        globAllowed: false,
        regexAllowed: false,
        indexingAllowed: false,
      },
    });
    expect(result.bridgeRequest?.requestId).toMatch(/^gui-s83-[a-z0-9]+$/);
    expect(noAuthority(result).every((value) => value === false)).toBe(true);
  });

  it("keeps JetBrains controlled read fail-closed even with ready-looking metadata", () => {
    const jetbrainsRuntime = runtime();
    jetbrainsRuntime.host.kind = "jetbrains";
    const result = buildControlledAgentFileReadRequest(requestInput({ host: "jetbrains", runtimeSessionMetadata: jetbrainsRuntime, jetbrainsFileReadSupported: true }));

    expect(result.state).toBe("unsupported");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.correlation).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host");
    expect(output(result)).toContain("JetBrains controlled file read remains fail-closed");
  });

  it("blocks assistant-minted metadata", () => {
    const assistantRuntime = runtime();
    assistantRuntime.preconditions.optIn.assistantMinted = true;
    const result = buildControlledAgentFileReadRequest(requestInput({ runtimeSessionMetadata: assistantRuntime }));

    expect(result.state).toBe("blocked");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
  });

  it("blocks unsafe paths and fields without leaking raw values", () => {
    const result = buildControlledAgentFileReadRequest(requestInput({ workspaceRelativePath: "../secret.env", rawFileBody: "SECRET_SENTINEL", env: { API_KEY: "sk-secret123456789" } }));
    const rendered = output(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_path");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("sk-secret123456789");
    expect(rendered).not.toContain("../secret.env");
  });

  it("ignores stale result request id mismatches", () => {
    const { correlation } = readyRequest();
    const message = successMessage(correlation);
    message.requestId = "other-request";

    const result = correlateControlledAgentFileReadResult({ current: correlation, hostMessage: message });

    expect(result.state).toBe("ignored");
    expect(result.fileRead).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("stale_result");
  });

  it("ignores duplicate terminal results", () => {
    const { correlation } = readyRequest();
    const first = correlateControlledAgentFileReadResult({ current: correlation, hostMessage: successMessage(correlation) });
    const duplicate = correlateControlledAgentFileReadResult({ current: correlation, hostMessage: successMessage(correlation), existingFileRead: first.fileRead });

    expect(first.state).toBe("accepted");
    expect(duplicate.state).toBe("duplicate");
    expect(duplicate.diagnostics.map((item) => item.code)).toContain("duplicate_result");
  });

  it("accepts success and truncated results into read metadata without raw summary leakage", () => {
    const { correlation } = readyRequest();
    const success = correlateControlledAgentFileReadResult({ current: correlation, hostMessage: successMessage(correlation) });
    const truncatedMessage = successMessage(correlation);
    truncatedMessage.payload.result.status = "truncated";
    truncatedMessage.payload.result.truncated = true;
    truncatedMessage.payload.result.byteCount = 2048;
    const truncated = correlateControlledAgentFileReadResult({ current: correlation, hostMessage: truncatedMessage });

    expect(success.state).toBe("accepted");
    expect(success.fileRead?.state).toBe("success");
    expect(success.fileRead?.preview?.text).toContain("bounded excerpt");
    expect(output(success.details)).not.toContain("bounded excerpt");
    expect(truncated.state).toBe("accepted");
    expect(truncated.fileRead?.state).toBe("truncated");
    expect(truncated.fileRead?.preview?.truncated).toBe(true);
  });

  it("accepts blocked results only when no body is present", () => {
    const { correlation } = readyRequest();
    const blocked = correlateControlledAgentFileReadResult({ current: correlation, hostMessage: blockedMessage(correlation) });
    const bodyBlockedMessage = blockedMessage(correlation);
    bodyBlockedMessage.payload.result.bodyIncluded = true;
    bodyBlockedMessage.payload.result.text = "body must not pass";
    const bodyBlocked = correlateControlledAgentFileReadResult({ current: correlation, hostMessage: bodyBlockedMessage });

    expect(blocked.state).toBe("accepted");
    expect(blocked.fileRead?.state).toBe("blocked");
    expect(blocked.fileRead?.preview).toBeUndefined();
    expect(bodyBlocked.state).toBe("blocked");
    expect(bodyBlocked.fileRead).toBeUndefined();
  });

  it("does not write browser storage while building or correlating", () => {
    localStorage.clear();
    sessionStorage.clear();

    const request = readyRequest();
    const result = correlateControlledAgentFileReadResult({ current: request.correlation, hostMessage: successMessage(request.correlation) });

    expect(request.state).toBe("ready");
    expect(result.state).toBe("accepted");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
