import { describe, expect, it } from "vitest";
import plannedBundle from "../../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-planned.json";
import succeededBundle from "../../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-succeeded.json";
import { buildControlledAgentVerificationBundleRequest, correlateControlledAgentVerificationBundleResult, evaluateControlledAgentVerificationBundle, type ControlledAgentVerificationBundleRequestCorrelation } from "./controlledAgentVerificationBundle";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

function readyRequest() {
  const result = buildControlledAgentVerificationBundleRequest({
    host: "vscode",
    bundleMetadata: plannedBundle,
    userConfirmed: true,
    requestSeed: "unit",
  });
  expect(result.state).toBe("ready");
  expect(result.correlation).toBeDefined();
  return result as typeof result & { correlation: ControlledAgentVerificationBundleRequestCorrelation };
}

describe("controlledAgentVerificationBundle", () => {
  it("accepts the safe planned fixture as metadata only", () => {
    const result = evaluateControlledAgentVerificationBundle(plannedBundle);

    expect(result.state).toBe("accepted");
    expect(result.status).toBe("planned");
    expect(result.commandCount).toBe(3);
    expect(result.commands.map((item) => item.commandId)).toEqual(["repository-check", "gui-app-tests", "engine-chat-tests"]);
    expect(result.authority).toMatchObject({
      executionAllowed: false,
      freeformCommandAllowed: false,
      canRunShell: false,
      canUseGit: false,
      canUseNetwork: false,
      canCallProvider: false,
      canUseTools: false,
      canAutoRun: false,
      canAutoVerify: false,
    });
  });

  it("accepts the safe succeeded fixture with sanitized bounded tails", () => {
    const result = evaluateControlledAgentVerificationBundle(succeededBundle);

    expect(result.state).toBe("accepted");
    expect(result.status).toBe("succeeded");
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toMatchObject({ status: "succeeded", outputTail: "Repository check completed with bounded sanitized evidence.", outputByteCount: 64, outputLineCount: 1 });
    expect(output(result)).not.toContain("/Users/");
    expect(output(result)).not.toContain("Authorization");
  });

  it("builds explicit GUI-minted request metadata without command strings or execution authority", () => {
    const result = buildControlledAgentVerificationBundleRequest({
      host: "vscode",
      bundleMetadata: plannedBundle,
      userConfirmed: true,
      requestSeed: "unit",
    });

    expect(result.state).toBe("ready");
    expect(result.bridgeRequest).toMatchObject({
      version: "2026-05-15",
      type: "gui.controlledAgentVerificationBundleRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        userConfirmed: true,
        confirmationKind: "explicit_user_verification_bundle",
        commandIds: ["repository-check", "gui-app-tests", "engine-chat-tests"],
        limits: {
          maxCommands: 3,
          maxTimeoutMs: 1800000,
          maxOutputBytes: 20000,
          maxOutputLines: 400,
          tailOnly: true,
          commandStringAllowed: false,
          argsAllowed: false,
          cwdAllowed: false,
          envAllowed: false,
          shellAllowed: false,
        },
      },
    });
    expect(result.bridgeRequest?.requestId).toMatch(/^gui-s117-[a-z0-9]+$/);
    expect(result.bridgeRequest?.payload.requestId).toBe(result.bridgeRequest?.requestId);
    expect(output(result.bridgeRequest)).not.toContain("npm test");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("command");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("args");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("cwd");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("env");
    expect(result.bridgeRequest?.payload).not.toHaveProperty("shell");
  });

  it("fails closed for browser and JetBrains execution requests", () => {
    const browser = buildControlledAgentVerificationBundleRequest({ host: "browser", bundleMetadata: plannedBundle, userConfirmed: true });
    const jetbrains = buildControlledAgentVerificationBundleRequest({ host: "jetbrains", bundleMetadata: plannedBundle, userConfirmed: true });

    expect(browser.state).toBe("unsupported");
    expect(browser.bridgeRequest).toBeUndefined();
    expect(browser.diagnostics.map((item) => item.code)).toContain("browser_host");
    expect(jetbrains.state).toBe("unsupported");
    expect(jetbrains.bridgeRequest).toBeUndefined();
    expect(jetbrains.diagnostics.map((item) => item.code)).toContain("unsupported_host");
  });

  it("blocks free-form command strings, privileged fields, assistant-minted ids, and auto-run attempts without echoing unsafe values", () => {
    const unsafe = clone(plannedBundle) as Record<string, any>;
    unsafe.confirmation.requestIdMintedBy = "assistant";
    unsafe.confirmation.assistantMinted = true;
    unsafe.bundle.commands[0].command = "npm test -- --runInBand SECRET_SENTINEL";
    unsafe.bundle.commands[0].cwd = "/Users/alice/project";
    unsafe.bundle.commands[0].env = { API_KEY: "sk-proj-abcdef1234567890" };
    unsafe.policyFlags.autoRunAllowed = true;

    const result = evaluateControlledAgentVerificationBundle(unsafe);
    const rendered = output(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["assistant_authority_blocked", "unsafe_metadata", "invalid_authority"]));
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-proj");
  });

  it("blocks unknown commands and unbounded sequence, timeout, and output budgets", () => {
    const unsafe = clone(plannedBundle) as Record<string, any>;
    unsafe.bundle.maxCommands = 4;
    unsafe.bundle.requestedCommandCount = 4;
    unsafe.bundle.commands.push({ ...unsafe.bundle.commands[2], stepId: "step-extra", sequenceIndex: 3, commandId: "npm-test", timeoutMs: 1800001, maxOutputBytes: 20001, maxOutputLines: 401 });
    unsafe.aggregateResult.commandCount = 4;

    const result = evaluateControlledAgentVerificationBundle(unsafe);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unbounded_sequence", "unsupported_command", "unbounded_timeout", "unbounded_output"]));
  });

  it("correlates matching sanitized succeeded bundle results and ignores stale results", () => {
    const { correlation } = readyRequest();
    const matching = clone(succeededBundle) as Record<string, any>;
    matching.workspace.controlledWorkspaceId = correlation.controlledWorkspaceId;
    matching.workspace.runId = correlation.runId;
    matching.workspace.workspaceReadinessId = correlation.workspaceReadinessId;
    matching.bundle.bundleId = correlation.bundleId;
    matching.bundle.requestedCommandCount = 3;
    matching.bundle.commands.push({
      stepId: "step-s117-engine",
      sequenceIndex: 2,
      commandId: "engine-chat-tests",
      timeoutMs: 300000,
      maxOutputBytes: 8000,
      maxOutputLines: 160,
      tailOnly: true,
      commandStringAllowed: false,
      argsAllowed: false,
      cwdAllowed: false,
      envAllowed: false,
      shellAllowed: false,
      status: "succeeded",
      exitCode: 0,
      durationMs: 1000,
      outputTail: "Engine chat tests completed with bounded sanitized evidence.",
      outputByteCount: 60,
      outputLineCount: 1,
      truncated: false,
      resultHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      summary: "Engine chat tests passed with local deterministic evidence.",
    });
    matching.aggregateResult.commandCount = 3;
    matching.aggregateResult.succeededCount = 3;

    const accepted = correlateControlledAgentVerificationBundleResult({ current: correlation, bundleResult: matching });
    const stale = clone(matching) as Record<string, any>;
    stale.workspace.runId = "other-run";

    expect(accepted.state).toBe("accepted");
    expect(accepted.bundle?.status).toBe("succeeded");
    expect(correlateControlledAgentVerificationBundleResult({ current: correlation, bundleResult: stale }).state).toBe("ignored");
  });

  it("blocks raw output result attempts and duplicate terminal results", () => {
    const { correlation } = readyRequest();
    const unsafe = clone(succeededBundle) as Record<string, any>;
    unsafe.workspace.controlledWorkspaceId = correlation.controlledWorkspaceId;
    unsafe.workspace.runId = correlation.runId;
    unsafe.workspace.workspaceReadinessId = correlation.workspaceReadinessId;
    unsafe.bundle.bundleId = correlation.bundleId;
    unsafe.aggregateResult.rawOutputReturned = true;
    unsafe.bundle.commands[0].outputTail = "Authorization: Bearer unsafe";

    const blocked = correlateControlledAgentVerificationBundleResult({ current: correlation, bundleResult: unsafe });
    const duplicate = correlateControlledAgentVerificationBundleResult({ current: correlation, bundleResult: succeededBundle, existingResult: { status: "succeeded" } });

    expect(blocked.state).toBe("blocked");
    expect(blocked.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(output(blocked)).not.toContain("Bearer unsafe");
    expect(duplicate.state).toBe("duplicate");
  });
});
