import { describe, expect, it } from "vitest";
import type { HostMessage } from "../bridge/bridgeAdapter";
import {
  correlateAgentRunVerificationProgress,
  correlateAgentRunVerificationResult,
  normalizeAgentRunVerificationRequest,
  type AgentRunVerificationCorrelationMetadata,
} from "./agentRunVerification";

const correlation: AgentRunVerificationCorrelationMetadata = {
  requestId: "verify-s47-c1",
  runId: "run-s47-c1",
  commandId: "repository-check",
};

function userRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "user",
    requestId: "verify-s47-c1",
    requestIdMintedBy: "gui",
    runId: "run-s47-c1",
    commandId: "repository-check",
    ...overrides,
  };
}

function progress(requestId = "verify-s47-c1", overrides: Record<string, unknown> = {}): HostMessage {
  return {
    version: "2026-05-15",
    type: "host.ideActionProgress",
    requestId,
    payload: {
      phase: "running",
      status: "inProgress",
      summary: "Repository check is running",
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: "repository-check",
      ...overrides,
    },
  };
}

function result(requestId = "verify-s47-c1", overrides: Record<string, unknown> = {}): HostMessage {
  return {
    version: "2026-05-15",
    type: "host.ideActionResult",
    requestId,
    payload: {
      status: "succeeded",
      message: "Repository check passed",
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: "repository-check",
      exitCode: 0,
      durationMs: 1250,
      outputTail: "Repository validation passed",
      truncated: false,
      ...overrides,
    },
  };
}

function expectNoRawLeak(value: unknown): void {
  const rendered = JSON.stringify(value);
  expect(rendered).not.toContain("/Users/alice");
  expect(rendered).not.toContain("sk-secret123456789");
  expect(rendered).not.toContain("SECRET_SENTINEL");
  expect(rendered).not.toContain("Authorization");
  expect(rendered).not.toContain("localStorage");
}

describe("normalizeAgentRunVerificationRequest", () => {
  it("accepts allowed command ids with explicit GUI-owned user request metadata", () => {
    for (const commandId of ["repository-check", "gui-app-tests", "engine-chat-tests"] as const) {
      const request = normalizeAgentRunVerificationRequest(userRequest({ commandId }));

      expect(request.state).toBe("ready");
      expect(request.verificationRequest).toEqual({ requested: true, source: "user", requestId: "verify-s47-c1" });
      expect(request.ideActionRequest).toEqual({ action: "runVerificationCommand", commandId });
      expect(request.correlation).toEqual({ requestId: "verify-s47-c1", runId: "run-s47-c1", commandId });
      expect(request.details).toMatchObject({ displayOnly: true, verificationRequested: true, commandId });
    }
  });

  it("blocks unknown command ids", () => {
    const request = normalizeAgentRunVerificationRequest(userRequest({ commandId: "npm-test" }));

    expect(request.state).toBe("blocked");
    expect(request.ideActionRequest).toBeUndefined();
    expect(request.diagnostics.map((item) => item.code)).toContain("unsupported_command");
  });

  it("blocks assistant and system supplied request ids", () => {
    const assistant = normalizeAgentRunVerificationRequest(userRequest({ source: "assistant", requestIdMintedBy: "assistant" }));
    const system = normalizeAgentRunVerificationRequest(userRequest({ source: "system", requestIdMintedBy: "system" }));

    expect(assistant.state).toBe("blocked");
    expect(system.state).toBe("blocked");
    expect(assistant.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
    expect(system.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
  });

  it("rejects unsafe request metadata without leaking raw paths, secrets, or storage fields", () => {
    localStorage.clear();
    sessionStorage.clear();

    const request = normalizeAgentRunVerificationRequest(userRequest({
      cwd: "/Users/alice/project",
      rawOutput: "SECRET_SENTINEL",
      env: { API_KEY: "sk-secret123456789" },
      storage: "localStorage.setItem",
    }));

    expect(request.state).toBe("blocked");
    expect(request.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expectNoRawLeak(request);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("correlateAgentRunVerificationProgress", () => {
  it("ignores stale progress with non-current request ids", () => {
    const correlated = correlateAgentRunVerificationProgress({ current: correlation, hostMessage: progress("verify-old") });

    expect(correlated.state).toBe("ignored");
    expect(correlated.verificationProgress).toBeUndefined();
    expect(correlated.diagnostics.map((item) => item.code)).toContain("stale_result");
  });

  it("normalizes queued and running progress for the current request", () => {
    const queued = correlateAgentRunVerificationProgress({ current: correlation, hostMessage: progress("verify-s47-c1", { phase: "queued", status: "pending", summary: "Verification queued" }) });
    const running = correlateAgentRunVerificationProgress({ current: correlation, hostMessage: progress() });

    expect(queued.state).toBe("accepted");
    expect(queued.verificationProgress).toEqual({ status: "queued", summary: "Verification queued" });
    expect(running.state).toBe("accepted");
    expect(running.verificationProgress).toEqual({ status: "running", summary: "Repository check is running" });
  });
});

describe("correlateAgentRunVerificationResult", () => {
  it("ignores stale results with non-current request or command ids", () => {
    const staleRequest = correlateAgentRunVerificationResult({ current: correlation, hostMessage: result("verify-old") });
    const staleCommand = correlateAgentRunVerificationResult({ current: correlation, hostMessage: result("verify-s47-c1", { commandId: "gui-app-tests" }) });

    expect(staleRequest.state).toBe("ignored");
    expect(staleCommand.state).toBe("ignored");
    expect(staleRequest.verificationResult).toBeUndefined();
    expect(staleCommand.verificationResult).toBeUndefined();
  });

  it("keeps duplicate results stable", () => {
    const existingResult = { status: "succeeded" as const, exitCode: 0, durationMs: 1000, outputTail: "First pass" };
    const correlated = correlateAgentRunVerificationResult({ current: correlation, hostMessage: result(), existingResult });

    expect(correlated.state).toBe("duplicate");
    expect(correlated.verificationResult).toEqual(existingResult);
    expect(correlated.diagnostics.map((item) => item.code)).toContain("duplicate_result");
  });

  it("ignores duplicate results with missing payload without throwing", () => {
    const existingResult = { status: "succeeded" as const, exitCode: 0, durationMs: 1000, outputTail: "First pass" };
    const correlated = correlateAgentRunVerificationResult({
      current: correlation,
      hostMessage: { version: "2026-05-15", type: "host.ideActionResult", requestId: "verify-s47-c1" } as HostMessage,
      existingResult,
    });

    expect(correlated.state).toBe("ignored");
    expect(correlated.verificationResult).toBeUndefined();
    expect(correlated.diagnostics.map((item) => item.code)).toContain("stale_result");
    expect(correlated.details).toMatchObject({ displayOnly: true, requestId: "verify-s47-c1", hostRequestId: "verify-s47-c1", commandId: "repository-check" });
  });

  it("ignores duplicate results with malformed payload without throwing", () => {
    const existingResult = { status: "failed" as const, exitCode: 1, durationMs: 1000, outputTail: "First fail" };
    const correlated = correlateAgentRunVerificationResult({
      current: correlation,
      hostMessage: result("verify-s47-c1", { action: "runVerificationCommand", commandId: "repository-check", message: undefined }),
      existingResult,
    });

    expect(correlated.state).toBe("ignored");
    expect(correlated.verificationResult).toBeUndefined();
    expect(correlated.diagnostics.map((item) => item.code)).toContain("stale_result");
    expect(correlated.details).toMatchObject({ displayOnly: true, requestId: "verify-s47-c1", hostRequestId: "verify-s47-c1", commandId: "repository-check" });
  });

  it("normalizes successful host result to sanitized Agent Run metadata", () => {
    const correlated = correlateAgentRunVerificationResult({ current: correlation, hostMessage: result() });

    expect(correlated.state).toBe("accepted");
    expect(correlated.verificationResult).toEqual({
      status: "succeeded",
      exitCode: 0,
      durationMs: 1250,
      outputTail: "Repository validation passed",
    });
  });

  it("normalizes failed host result and bounds exit and duration metadata", () => {
    const correlated = correlateAgentRunVerificationResult({ current: correlation, hostMessage: result("verify-s47-c1", {
      status: "failed",
      message: "Repository check failed",
      exitCode: 1,
      durationMs: 3600001,
      outputTail: "Repository validation failed",
    }) });

    expect(correlated.state).toBe("accepted");
    expect(correlated.verificationResult).toEqual({
      status: "failed",
      exitCode: 1,
      outputTail: "Repository validation failed",
    });
  });

  it("redacts secret and private path output tail without leaking raw values", () => {
    localStorage.clear();
    sessionStorage.clear();

    const correlated = correlateAgentRunVerificationResult({ current: correlation, hostMessage: result("verify-s47-c1", {
      outputTail: "Authorization: Bearer sk-secret123456789 failed in /Users/alice/project SECRET_SENTINEL",
    }) });

    expect(correlated.state).toBe("accepted");
    expect(correlated.verificationResult?.outputTail).toContain("[redacted]");
    expectNoRawLeak(correlated);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
