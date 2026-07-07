import { describe, expect, it } from "vitest";
import readyRuntime from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json";
import readyReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import successResultFixture from "../../../../packages/contracts/examples/bridge/host-controlled-agent-lexical-search-result-succeeded.json";
import { buildControlledAgentLexicalSearchRequest, correlateControlledAgentLexicalSearchResult, type ControlledAgentLexicalSearchCorrelation } from "./controlledAgentLexicalSearch";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function runtime(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyRuntime) as Record<string, any>;
  input.session.sessionId = "run-s110-request";
  input.workspace.controlledWorkspaceId = "workspace-s110-request";
  input.workspace.readinessId = "ready-s110-request";
  input.preconditions.workspaceReadiness.readinessId = "ready-s110-request";
  input.preconditions.correlation.readinessId = "ready-s110-request";
  Object.assign(input, overrides);
  return input;
}

function readiness(overrides: Record<string, any> = {}): Record<string, any> {
  const input = clone(readyReadiness) as Record<string, any>;
  input.isolation.readinessId = "ready-s110-request";
  Object.assign(input, overrides);
  return input;
}

function requestInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: "vscode",
    runtimeSessionMetadata: runtime(),
    workspaceReadinessMetadata: readiness(),
    query: "chat composer",
    includePathLabels: ["apps/gui/src/App.tsx"],
    explicitUserGesture: true,
    userGestureId: "gesture-s110-unit",
    requestSeed: "unit",
    ...overrides,
  };
}

function readyRequest() {
  const result = buildControlledAgentLexicalSearchRequest(requestInput());
  expect(result.state).toBe("ready");
  expect(result.correlation).toBeDefined();
  return result as typeof result & { correlation: ControlledAgentLexicalSearchCorrelation };
}

function resultMessage(correlation: ControlledAgentLexicalSearchCorrelation, overrides: Record<string, unknown> = {}): Record<string, any> {
  const message = clone(successResultFixture) as Record<string, any>;
  message.requestId = correlation.requestId;
  message.payload.requestId = correlation.requestId;
  message.payload.controlledWorkspaceId = correlation.controlledWorkspaceId;
  message.payload.runId = correlation.runId;
  message.payload.runtimeSessionId = correlation.runtimeSessionId;
  message.payload.workspaceReadinessId = correlation.workspaceReadinessId;
  Object.assign(message.payload, overrides);
  return message;
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

describe("controlledAgentLexicalSearch", () => {
  it("builds a VS Code-only explicit lexical search bridge request", () => {
    const result = buildControlledAgentLexicalSearchRequest(requestInput());

    expect(result.state).toBe("ready");
    expect(result.bridgeRequest).toMatchObject({
      version: "2026-05-15",
      type: "gui.controlledAgentLexicalSearchRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        controlledWorkspaceId: "workspace-s110-request",
        runId: "run-s110-request",
        runtimeSessionId: "run-s110-request",
        workspaceReadinessId: "ready-s110-request",
        explicitUserGesture: true,
        userGestureId: "gesture-s110-unit",
        host: "vscode",
        query: "chat composer",
        queryMode: "literal_text",
        scope: {
          controlledWorkspaceOnly: true,
          includePathLabels: ["apps/gui/src/App.tsx"],
          recursiveAllowed: false,
          broadWorkspaceScanAllowed: false,
        },
        limits: {
          literalOnly: true,
          regexAllowed: false,
          globAllowed: false,
          pathQueryAllowed: false,
          indexingAllowed: false,
          backgroundAllowed: false,
        },
      },
    });
    expect(result.bridgeRequest?.requestId).toMatch(/^gui-s110-[a-z0-9]+$/);
    expect(result.bridgeRequest?.payload.requestId).toBe(result.bridgeRequest?.requestId);
    expect(output(result.bridgeRequest?.payload)).not.toContain("rawContent");
    expect(result.bridgeRequest?.payload.policyFlags.providerAllowed).toBe(false);
    expect(result.bridgeRequest?.payload.policyFlags.shellAllowed).toBe(false);
  });

  it("blocks unsafe query, missing user gesture, unsupported hosts, and assistant-minted ids", () => {
    const unsafeQuery = buildControlledAgentLexicalSearchRequest(requestInput({ query: "chat.*composer" }));
    const unconfirmed = buildControlledAgentLexicalSearchRequest(requestInput({ explicitUserGesture: false }));
    const browser = buildControlledAgentLexicalSearchRequest(requestInput({ host: "browser" }));
    const jetbrains = buildControlledAgentLexicalSearchRequest(requestInput({ host: "jetbrains" }));
    const assistantRuntime = runtime();
    assistantRuntime.preconditions.optIn.requestIdMintedBy = "assistant";
    const assistant = buildControlledAgentLexicalSearchRequest(requestInput({ runtimeSessionMetadata: assistantRuntime }));

    expect(unsafeQuery.state).toBe("blocked");
    expect(unsafeQuery.diagnostics.map((item) => item.code)).toContain("unsafe_query");
    expect(unconfirmed.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
    expect(browser.state).toBe("unsupported");
    expect(browser.diagnostics.map((item) => item.code)).toContain("browser_host");
    expect(jetbrains.state).toBe("unsupported");
    expect(jetbrains.diagnostics.map((item) => item.code)).toContain("unsupported_host");
    expect(assistant.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
  });

  it("rejects raw payload markers without leaking them", () => {
    const result = buildControlledAgentLexicalSearchRequest(requestInput({ rawContent: "Authorization: Bearer unsafe" }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(output(result)).not.toContain("Bearer unsafe");
  });

  it("accepts sanitized host results without attaching snippets to prompt authority", () => {
    const { correlation } = readyRequest();
    const result = correlateControlledAgentLexicalSearchResult({ current: correlation, hostMessage: resultMessage(correlation) });

    expect(result.state).toBe("accepted");
    expect(result.lexicalSearch).toMatchObject({ status: "succeeded", resultCount: 1, snippets: [{ pathLabel: "apps/gui/src/App.tsx", snippet: "function ChatComposer() {\n  return null;\n}" }] });
    expect(Object.values(result.authority).every((value) => value === false)).toBe(true);
  });

  it("ignores stale results and deduplicates terminal results", () => {
    const { correlation } = readyRequest();
    const stale = resultMessage(correlation, { runId: "other-run" });
    const duplicate = correlateControlledAgentLexicalSearchResult({ current: correlation, hostMessage: resultMessage(correlation), existingResult: { status: "succeeded", resultCount: 1, totalMatchCount: 1, totalSnippetBytes: 41, truncated: false, snippets: [], message: "done" } });

    expect(correlateControlledAgentLexicalSearchResult({ current: correlation, hostMessage: stale }).state).toBe("ignored");
    expect(duplicate.state).toBe("duplicate");
  });

  it("blocks unsafe snippets and authority-widening host results", () => {
    const { correlation } = readyRequest();
    const unsafeSnippet = resultMessage(correlation);
    unsafeSnippet.payload.snippets[0].snippet = "Authorization: Bearer unsafe";
    const widened = resultMessage(correlation);
    widened.payload.policyFlags.indexingAllowed = true;

    const unsafeResult = correlateControlledAgentLexicalSearchResult({ current: correlation, hostMessage: unsafeSnippet });
    const widenedResult = correlateControlledAgentLexicalSearchResult({ current: correlation, hostMessage: widened });

    expect(unsafeResult.state).toBe("blocked");
    expect(output(unsafeResult)).not.toContain("Bearer unsafe");
    expect(widenedResult.state).toBe("blocked");
    expect(widenedResult.diagnostics.map((item) => item.code)).toContain("invalid_authority");
  });
});
