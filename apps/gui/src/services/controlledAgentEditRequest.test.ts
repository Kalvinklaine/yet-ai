import { describe, expect, it } from "vitest";
import readyRuntime from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json";
import readyReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import appliedResultFixture from "../../../../packages/contracts/examples/bridge/host-controlled-agent-edit-result-applied.json";
import blockedResultFixture from "../../../../packages/contracts/examples/bridge/host-controlled-agent-edit-result-blocked.json";
import failedResultFixture from "../../../../packages/contracts/examples/bridge/host-controlled-agent-edit-result-failed.json";
import { buildControlledAgentEditRequest, correlateControlledAgentEditResult, type ControlledAgentEditRequestCorrelation } from "./controlledAgentEditRequest";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function runtime(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyRuntime) as Record<string, any>;
  input.session.sessionId = "run-s84-request";
  input.workspace.controlledWorkspaceId = "workspace-s84-request";
  input.workspace.readinessId = "ready-s84-request";
  input.preconditions.workspaceReadiness.readinessId = "ready-s84-request";
  input.preconditions.correlation.readinessId = "ready-s84-request";
  Object.assign(input, overrides);
  return input;
}

function readiness(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyReadiness) as Record<string, any>;
  input.isolation.readinessId = "ready-s84-request";
  Object.assign(input, overrides);
  return input;
}

function plannedEdit(overrides: Record<string, any> = {}): Record<string, any> {
  const replacementText = "const title = \"Yet AI\";\n";
  return {
    type: "controlled_agent_edit_executor",
    schemaVersion: "2026-07-02",
    state: "planned",
    runId: "run-s84-request",
    workspaceReadinessId: "ready-s84-request",
    requestId: "planned-s84-request",
    requestIdMintedBy: "gui",
    userConfirmed: true,
    limits: {
      maxFiles: 1,
      maxEdits: 1,
      maxPatchBytes: 4096,
    },
    edits: [
      {
        operation: "replace",
        workspaceRelativePath: "apps/gui/src/App.tsx",
        fileLabel: "apps/gui/src/App.tsx",
        expectedContentHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        startLine: 12,
        endLine: 14,
        replacementText,
        replacementByteCount: bytes(replacementText),
        sanitizedSummary: "Update selected UI metadata lines.",
      },
    ],
    ...overrides,
  };
}

function requestInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: "vscode",
    runtimeSessionMetadata: runtime(),
    workspaceReadinessMetadata: readiness(),
    plannedEditMetadata: plannedEdit(),
    requestSeed: "unit",
    ...overrides,
  };
}

function readyRequest() {
  const result = buildControlledAgentEditRequest(requestInput());
  expect(result.state).toBe("ready");
  expect(result.correlation).toBeDefined();
  return result as typeof result & { correlation: ControlledAgentEditRequestCorrelation };
}

function resultMessage(correlation: ControlledAgentEditRequestCorrelation, fixture: Record<string, any>): Record<string, any> {
  const message = clone(fixture) as Record<string, any>;
  message.requestId = correlation.requestId;
  message.payload.requestId = correlation.requestId;
  message.payload.runId = correlation.runId;
  message.payload.controlledWorkspaceId = correlation.controlledWorkspaceId;
  message.payload.runtimeSessionId = correlation.runtimeSessionId;
  message.payload.workspaceReadinessId = correlation.workspaceReadinessId;
  message.payload.edits[0].replacementByteCount = bytes("const title = \"Yet AI\";\n");
  return message;
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

function noAuthority(value: { authority: Record<string, boolean> }): boolean[] {
  return Object.values(value.authority);
}

describe("controlledAgentEditRequest", () => {
  it("keeps disabled or absent metadata from building a request", () => {
    const result = buildControlledAgentEditRequest({ host: "vscode" });

    expect(result.state).toBe("blocked");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.correlation).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("runtime_session_not_ready");
    expect(result.diagnostics.map((item) => item.code)).toContain("workspace_not_ready");
    expect(result.diagnostics.map((item) => item.code)).toContain("edit_not_ready");
    expect(noAuthority(result).every((value) => value === false)).toBe(true);
  });

  it("blocks browser hosts", () => {
    const result = buildControlledAgentEditRequest(requestInput({ host: "browser" }));

    expect(result.state).toBe("unsupported");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("browser_host");
  });

  it("builds a ready VS Code bridge request from ready metadata and safe planned edits", () => {
    const result = buildControlledAgentEditRequest(requestInput());

    expect(result.state).toBe("ready");
    expect(result.bridgeRequest).toMatchObject({
      version: "2026-05-15",
      type: "gui.controlledAgentEditRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        controlledWorkspaceId: "workspace-s84-request",
        runId: "run-s84-request",
        runtimeSessionId: "run-s84-request",
        workspaceReadinessId: "ready-s84-request",
        userConfirmed: true,
        limits: {
          maxFiles: 1,
          maxEdits: 1,
          maxPatchBytes: 4096,
        },
      },
    });
    expect(result.bridgeRequest?.requestId).toMatch(/^gui-s84-[a-z0-9]+$/);
    expect(result.bridgeRequest?.payload.requestId).toBe(result.bridgeRequest?.requestId);
    expect(result.bridgeRequest?.payload.edits[0]).toMatchObject({
      operation: "replace",
      workspaceRelativePath: "apps/gui/src/App.tsx",
      replacementText: "const title = \"Yet AI\";\n",
    });
    expect(output(result.details)).not.toContain("const title");
    expect(noAuthority(result).every((value) => value === false)).toBe(true);
  });

  it("keeps JetBrains controlled edit fail-closed even with ready-looking metadata", () => {
    const jetbrainsRuntime = runtime();
    jetbrainsRuntime.host.kind = "jetbrains";
    const result = buildControlledAgentEditRequest(requestInput({ host: "jetbrains", runtimeSessionMetadata: jetbrainsRuntime, jetbrainsEditSupported: true }));

    expect(result.state).toBe("unsupported");
    expect(result.bridgeRequest).toBeUndefined();
    expect(result.correlation).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host");
    expect(output(result)).toContain("JetBrains controlled edit remains fail-closed");
  });

  it("blocks assistant-minted or unconfirmed metadata", () => {
    const assistantRuntime = runtime();
    assistantRuntime.preconditions.optIn.assistantMinted = true;
    const assistant = buildControlledAgentEditRequest(requestInput({ runtimeSessionMetadata: assistantRuntime }));
    const unconfirmed = buildControlledAgentEditRequest(requestInput({ plannedEditMetadata: plannedEdit({ userConfirmed: false }) }));

    expect(assistant.state).toBe("blocked");
    expect(assistant.bridgeRequest).toBeUndefined();
    expect(assistant.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
    expect(unconfirmed.state).toBe("blocked");
    expect(unconfirmed.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
  });

  it("blocks unsafe paths, fields, and oversized replacements without leaking raw values", () => {
    const largeText = "x".repeat(50001);
    const unsafe = buildControlledAgentEditRequest(requestInput({
      rawDiff: "SECRET_SENTINEL",
      plannedEditMetadata: plannedEdit({
        edits: [
          {
            ...plannedEdit().edits[0],
            workspaceRelativePath: "../secret.env",
            replacementText: largeText,
            replacementByteCount: bytes(largeText),
          },
        ],
      }),
    }));
    const rendered = output(unsafe);

    expect(unsafe.state).toBe("blocked");
    expect(unsafe.bridgeRequest).toBeUndefined();
    expect(unsafe.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(unsafe.diagnostics.map((item) => item.code)).toContain("unsafe_path");
    expect(unsafe.diagnostics.map((item) => item.code)).toContain("unsafe_replacement");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("../secret.env");
    expect(rendered).not.toContain(largeText);
  });

  it("ignores stale result request id mismatches", () => {
    const { correlation } = readyRequest();
    const message = resultMessage(correlation, appliedResultFixture as Record<string, any>);
    message.requestId = "other-request";

    const result = correlateControlledAgentEditResult({ current: correlation, hostMessage: message });

    expect(result.state).toBe("ignored");
    expect(result.edit).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("stale_result");
  });

  it("ignores duplicate terminal results", () => {
    const { correlation } = readyRequest();
    const first = correlateControlledAgentEditResult({ current: correlation, hostMessage: resultMessage(correlation, appliedResultFixture as Record<string, any>) });
    const duplicate = correlateControlledAgentEditResult({ current: correlation, hostMessage: resultMessage(correlation, appliedResultFixture as Record<string, any>), existingEdit: first.edit });

    expect(first.state).toBe("accepted");
    expect(duplicate.state).toBe("duplicate");
    expect(duplicate.diagnostics.map((item) => item.code)).toContain("duplicate_result");
  });

  it("accepts applied, blocked, and failed results into edit metadata", () => {
    const { correlation } = readyRequest();
    const applied = correlateControlledAgentEditResult({ current: correlation, hostMessage: resultMessage(correlation, appliedResultFixture as Record<string, any>) });
    const blocked = correlateControlledAgentEditResult({ current: correlation, hostMessage: resultMessage(correlation, blockedResultFixture as Record<string, any>) });
    const failed = correlateControlledAgentEditResult({ current: correlation, hostMessage: resultMessage(correlation, failedResultFixture as Record<string, any>) });

    expect(applied.state).toBe("accepted");
    expect(applied.edit?.state).toBe("applied");
    expect(blocked.state).toBe("accepted");
    expect(blocked.edit?.state).toBe("blocked");
    expect(failed.state).toBe("accepted");
    expect(failed.edit?.state).toBe("failed");
    expect(output(applied.details)).not.toContain("replacement edit applied");
  });

  it("does not write browser storage while building or correlating", () => {
    localStorage.clear();
    sessionStorage.clear();

    const request = readyRequest();
    const result = correlateControlledAgentEditResult({ current: request.correlation, hostMessage: resultMessage(request.correlation, appliedResultFixture as Record<string, any>) });

    expect(request.state).toBe("ready");
    expect(result.state).toBe("accepted");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
