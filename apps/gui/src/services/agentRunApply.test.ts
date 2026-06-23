import { describe, expect, it } from "vitest";
import type { HostMessage } from "../bridge/bridgeAdapter";
import type { AgentRunInput } from "./agentRunState";
import { correlateAgentRunApplyResult, normalizeAgentRunApplyRequest, type AgentRunApplyCorrelationMetadata } from "./agentRunApply";

const baseRun: AgentRunInput = {
  goal: {
    id: "goal-s46-c1",
    title: "Correlate explicit Apply",
  },
  proposal: {
    id: "proposal-s46-c1",
    summary: "Apply a reviewed patch",
    touchedFiles: ["apps/gui/src/services/agentRunApply.ts"],
  },
};

const correlation: AgentRunApplyCorrelationMetadata = {
  requestId: "apply-s46-c1",
  runId: "run-s46-c1",
  proposalId: "proposal-s46-c1",
};

function userRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "user",
    requestId: "apply-s46-c1",
    requestIdMintedBy: "gui",
    runId: "run-s46-c1",
    agentRunInput: baseRun,
    ...overrides,
  };
}

function hostResult(requestId = "apply-s46-c1", overrides: Record<string, unknown> = {}): HostMessage {
  return {
    version: "2026-05-15",
    type: "host.applyWorkspaceEditResult",
    requestId,
    payload: {
      status: "applied",
      message: "Patch applied after explicit user confirmation",
      cloudRequired: false,
      appliedEditCount: 2,
      affectedFiles: ["apps/gui/src/services/agentRunApply.ts"],
      ...overrides,
    },
  };
}

function expectNoRawLeak(value: unknown): void {
  const rendered = JSON.stringify(value);
  expect(rendered).not.toContain("/Users/alice");
  expect(rendered).not.toContain("sk-secret123456789");
  expect(rendered).not.toContain("SECRET_SENTINEL");
  expect(rendered).not.toContain("localStorage");
}

describe("normalizeAgentRunApplyRequest", () => {
  it("accepts explicit user request metadata with GUI-owned ids only", () => {
    const result = normalizeAgentRunApplyRequest(userRequest());

    expect(result.state).toBe("ready");
    expect(result.applyRequest).toEqual({ requested: true, source: "user", requestId: "apply-s46-c1" });
    expect(result.correlation).toEqual(correlation);
    expect(result.details).toMatchObject({ displayOnly: true, applyRequested: true, requestId: "apply-s46-c1" });
  });

  it("blocks assistant and system supplied request ids", () => {
    const assistant = normalizeAgentRunApplyRequest(userRequest({ source: "assistant", requestIdMintedBy: "assistant" }));
    const system = normalizeAgentRunApplyRequest(userRequest({ source: "system", requestIdMintedBy: "system" }));

    expect(assistant.state).toBe("blocked");
    expect(system.state).toBe("blocked");
    expect(assistant.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
    expect(system.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
  });

  it("rejects unsafe request metadata without leaking raw paths, secrets, or storage fields", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = normalizeAgentRunApplyRequest(userRequest({
      cwd: "/Users/alice/project",
      rawDiff: "SECRET_SENTINEL",
      env: { API_KEY: "sk-secret123456789" },
      storage: "localStorage.setItem",
    }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expectNoRawLeak(result);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("correlateAgentRunApplyResult", () => {
  it("ignores stale host results with non-current request ids", () => {
    const result = correlateAgentRunApplyResult({ current: correlation, hostMessage: hostResult("apply-old") });

    expect(result.state).toBe("ignored");
    expect(result.applyResult).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("stale_result");
  });

  it("keeps duplicate host results stable", () => {
    const existingResult = { status: "applied" as const, summary: "First apply result", appliedFileCount: 1 };
    const result = correlateAgentRunApplyResult({ current: correlation, hostMessage: hostResult(), existingResult });

    expect(result.state).toBe("duplicate");
    expect(result.applyResult).toEqual(existingResult);
    expect(result.diagnostics.map((item) => item.code)).toContain("duplicate_result");
  });

  it("normalizes applied host result to sanitized Agent Run metadata", () => {
    const result = correlateAgentRunApplyResult({ current: correlation, hostMessage: hostResult() });

    expect(result.state).toBe("accepted");
    expect(result.applyResult).toEqual({
      status: "applied",
      summary: "Patch applied after explicit user confirmation",
      appliedFileCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("apps/gui/src/services/agentRunApply.ts");
  });

  it("turns denied rejected and failed host results into stopped failed metadata", () => {
    const denied = correlateAgentRunApplyResult({ current: correlation, hostMessage: hostResult("apply-s46-c1", { status: "denied", message: "User denied apply" }) });
    const failed = correlateAgentRunApplyResult({ current: correlation, hostMessage: hostResult("apply-s46-c1", { status: "failed", message: "Host could not finish" }) });

    expect(denied.state).toBe("accepted");
    expect(denied.applyResult).toEqual({ status: "failed", summary: "User denied apply" });
    expect(failed.applyResult).toEqual({ status: "failed", summary: "Host could not finish" });
  });

  it("does not leak unsafe host result metadata or write browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = correlateAgentRunApplyResult({
      current: correlation,
      hostMessage: hostResult("apply-s46-c1", {
        message: "Authorization: Bearer sk-secret123456789",
        affectedFiles: ["/Users/alice/project/secret.ts"],
        rawDiff: "SECRET_SENTINEL",
      }),
    });

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expectNoRawLeak(result);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
