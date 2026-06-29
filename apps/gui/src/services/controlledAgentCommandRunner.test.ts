import { describe, expect, it } from "vitest";
import { evaluateControlledAgentCommandRun } from "./controlledAgentCommandRunner";

const hash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function commandRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "controlled_agent_command_runner",
    version: "2026-06-29",
    authority: "allowlisted_command_id_metadata",
    cloudRequired: false,
    executionAllowed: false,
    freeformCommandAllowed: false,
    agentStartAllowed: false,
    workspace: {
      controlledWorkspaceId: "workspace-s75-demo",
      runId: "run-s75-demo",
      workspaceMode: "worktree",
      host: "vscode",
      privatePathExposed: false,
      workspaceLabel: "Controlled worktree demo",
    },
    request: {
      requestId: "request-s75-demo",
      source: "gui",
      requestIdMintedBy: "gui",
      assistantMinted: false,
      correlation: {
        origin: "user",
        confirmedBy: "user",
        confirmationId: "confirm-s75-demo",
        hostCorrelationId: "host-s75-demo",
        confirmedAt: "2026-06-29T18:30:00Z",
        label: "User confirmed verification preset",
      },
      commandId: "repository-check",
      limits: {
        timeoutMs: 600000,
        maxOutputBytes: 12000,
        maxOutputLines: 240,
        tailOnly: true,
        commandStringAllowed: false,
        argsAllowed: false,
        cwdAllowed: false,
        envAllowed: false,
        shellAllowed: false,
        limitLabel: "Bounded sanitized tail only",
      },
      requestedAt: "2026-06-29T18:30:01Z",
      reason: "Verify repository state with an allowlisted preset",
    },
    policyFlags: {
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
    },
    result: {
      status: "succeeded",
      cloudRequired: false,
      freeformCommandAllowed: false,
      truncated: false,
      message: "Allowlisted preset completed successfully",
      exitCode: 0,
      durationMs: 2450,
      outputTail: "Repository validation completed with sanitized metadata",
      outputByteCount: 512,
      outputLineCount: 12,
      resultHash: hash,
    },
    ...overrides,
  };
}

function withResult(status: string, resultOverrides: Record<string, unknown>): Record<string, unknown> {
  return commandRun({
    result: {
      status,
      cloudRequired: false,
      freeformCommandAllowed: false,
      truncated: false,
      message: `Allowlisted preset ${status}`,
      ...resultOverrides,
    },
  });
}

function expectNoRawLeak(value: unknown): void {
  const rendered = JSON.stringify(value);
  expect(rendered).not.toContain("/Users/alice");
  expect(rendered).not.toContain("sk-secret123456789");
  expect(rendered).not.toContain("SECRET_SENTINEL");
  expect(rendered).not.toContain("Authorization");
  expect(rendered).not.toContain("npm test");
}

describe("evaluateControlledAgentCommandRun", () => {
  it.each([
    ["succeeded", { exitCode: 0, durationMs: 2450, outputTail: "Repository validation completed", outputByteCount: 512, outputLineCount: 12, resultHash: hash }],
    ["failed", { exitCode: 1, durationMs: 3450, outputTail: "Repository validation reported a bounded failure summary", outputByteCount: 640, outputLineCount: 18, resultHash: hash }],
    ["timed_out", { exitCode: null, durationMs: 600000, outputTail: "Allowlisted preset stopped after the configured time limit", outputByteCount: 700, outputLineCount: 22, resultHash: hash, truncated: true }],
    ["killed", { exitCode: null, durationMs: 4800, outputTail: "Allowlisted preset was stopped by host policy", outputByteCount: 300, outputLineCount: 8, resultHash: hash }],
  ])("returns sanitized allow summary for %s command metadata", (status, result) => {
    const evaluation = evaluateControlledAgentCommandRun(withResult(status, result));

    expect(evaluation.state).toBe(status);
    expect(evaluation.status).toBe(status);
    expect(evaluation.allowedToRunCommand).toBe(true);
    expect(evaluation.canRunShell).toBe(false);
    expect(evaluation.canUseGit).toBe(false);
    expect(evaluation.canUseNetwork).toBe(false);
    expect(evaluation.commandId).toBe("repository-check");
    expect(evaluation.commandIdLabel).toBe("Repository check");
    expect(evaluation.diagnostics).toEqual([]);
    expect(evaluation.outputTail?.resultHash).toBe(hash);
  });

  it("returns disabled and blocked metadata without command-run eligibility", () => {
    const disabled = evaluateControlledAgentCommandRun(withResult("disabled", { blockedReason: "runner_disabled" }));
    const blocked = evaluateControlledAgentCommandRun(withResult("blocked", { blockedReason: "policy_denied" }));

    expect(disabled.state).toBe("disabled");
    expect(disabled.allowedToRunCommand).toBe(false);
    expect(disabled.outputTail).toBeUndefined();
    expect(blocked.state).toBe("blocked");
    expect(blocked.allowedToRunCommand).toBe(false);
    expect(blocked.outputTail).toBeUndefined();
  });

  it("returns running metadata without output tail", () => {
    const evaluation = evaluateControlledAgentCommandRun(withResult("running", { durationMs: 1250 }));

    expect(evaluation.state).toBe("running");
    expect(evaluation.allowedToRunCommand).toBe(true);
    expect(evaluation.outputTail).toBeUndefined();
    expect(evaluation.details).toMatchObject({ displayOnly: true, durationMs: 1250, commandId: "repository-check" });
  });

  it("blocks unknown command ids", () => {
    const input = commandRun({ request: { ...commandRun().request as Record<string, unknown>, commandId: "npm-test" } });
    const evaluation = evaluateControlledAgentCommandRun(input);

    expect(evaluation.state).toBe("blocked");
    expect(evaluation.allowedToRunCommand).toBe(false);
    expect(evaluation.diagnostics.map((item) => item.code)).toContain("unknown_command_id");
  });

  it("blocks raw command cwd args env shell git provider tool and network authority fields", () => {
    const input = commandRun({
      command: "npm test",
      args: ["--", "all"],
      cwd: "/Users/alice/project",
      env: { API_KEY: "sk-secret123456789" },
      shell: true,
      git: "status",
      provider: "tool-call",
      network: true,
    });
    const evaluation = evaluateControlledAgentCommandRun(input);

    expect(evaluation.state).toBe("blocked");
    expect(evaluation.allowedToRunCommand).toBe(false);
    expect(evaluation.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unknown_or_invalid_field", "unsafe_metadata"]));
    expectNoRawLeak(evaluation);
  });

  it("fails closed on assistant authority claims", () => {
    const base = commandRun();
    const request = base.request as Record<string, unknown>;
    const evaluation = evaluateControlledAgentCommandRun(commandRun({
      request: {
        ...request,
        requestId: "assistant-s75-demo",
        assistantMinted: true,
      },
    }));

    expect(evaluation.state).toBe("blocked");
    expect(evaluation.allowedToRunCommand).toBe(false);
    expect(evaluation.diagnostics.map((item) => item.code)).toContain("assistant_authority");
  });

  it("fails closed on private or secret output metadata without leaking raw values", () => {
    const evaluation = evaluateControlledAgentCommandRun(withResult("failed", {
      exitCode: 1,
      durationMs: 1000,
      outputTail: "Authorization: Bearer sk-secret123456789 failed in /Users/alice/project SECRET_SENTINEL",
      outputByteCount: 120,
      outputLineCount: 2,
      resultHash: hash,
    }));

    expect(evaluation.state).toBe("blocked");
    expect(evaluation.allowedToRunCommand).toBe(false);
    expect(evaluation.outputTail).toBeUndefined();
    expect(evaluation.diagnostics.map((item) => item.code)).toContain("unsafe_output_metadata");
    expectNoRawLeak(evaluation);
  });

  it("fails closed on unbounded timeout and output metadata", () => {
    const base = commandRun();
    const request = base.request as Record<string, unknown>;
    const limits = request.limits as Record<string, unknown>;
    const evaluation = evaluateControlledAgentCommandRun(commandRun({
      request: {
        ...request,
        limits: { ...limits, timeoutMs: 1800001, maxOutputBytes: 20001 },
      },
    }));

    expect(evaluation.state).toBe("blocked");
    expect(evaluation.allowedToRunCommand).toBe(false);
    expect(evaluation.diagnostics.map((item) => item.code)).toContain("unbounded_limits");
  });

  it("does not write browser storage while evaluating command-run metadata", () => {
    localStorage.clear();
    sessionStorage.clear();

    const evaluation = evaluateControlledAgentCommandRun(commandRun());

    expect(evaluation.state).toBe("succeeded");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
