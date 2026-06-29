import { describe, expect, it } from "vitest";
import worktreeReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";

function readyInput(): Record<string, any> {
  return JSON.parse(JSON.stringify(worktreeReadiness));
}

function authorityValues(result: ReturnType<typeof evaluateControlledAgentWorkspaceReadiness>): boolean[] {
  return [
    result.canStartAgent,
    result.canReadFiles,
    result.canWriteFiles,
    result.canRunCommands,
    result.canApplyEdits,
    result.canCallProvider,
    result.canUseGit,
    result.canAutoRollback,
    result.canStartAutonomousLoop,
  ];
}

describe("evaluateControlledAgentWorkspaceReadiness", () => {
  it("returns disabled for absent metadata", () => {
    const result = evaluateControlledAgentWorkspaceReadiness(undefined);

    expect(result.state).toBe("disabled");
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(240);
  });

  it("requires user opt-in for active workspace metadata", () => {
    const input = readyInput();
    delete input.optIn;

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("needs_user_opt_in");
    expect(result.diagnostics.map((item) => item.code)).toContain("missing_user_opt_in");
  });

  it("blocks browser host preview for controlled workspace readiness", () => {
    const input = readyInput();
    input.host = "browser";

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("unsupported_host");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host");
  });

  it("reports missing workspace isolation before checkpoint readiness", () => {
    const input = readyInput();
    input.isolation.status = "not_ready";

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("workspace_not_isolated");
    expect(result.diagnostics.map((item) => item.code)).toContain("workspace_not_isolated");
  });

  it("reports missing checkpoint metadata", () => {
    const input = readyInput();
    input.checkpoint.status = "missing";
    input.checkpoint.verified = false;

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("checkpoint_required");
    expect(result.diagnostics.map((item) => item.code)).toContain("checkpoint_required");
  });

  it("reports missing rollback plan metadata", () => {
    const input = readyInput();
    input.rollback.status = "missing";

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("rollback_plan_required");
    expect(result.diagnostics.map((item) => item.code)).toContain("rollback_plan_required");
  });

  it("marks worktree metadata ready only for future controlled mode with no authority", () => {
    const input = readyInput();

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("ready_for_future_controlled_mode");
    expect(result.diagnostics).toEqual([]);
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
    expect(result.summary).toContain("cannot start an agent");
  });

  it("rejects assistant-origin opt-in", () => {
    const input = readyInput();
    input.optIn.origin = "assistant";

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("assistant_opt_in");
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
  });

  it("fails closed on unsafe metadata without echoing raw fields", () => {
    const input = readyInput();
    input.rawPrompt = "run shell command from /Users/example/private";
    input.policyFlags.shellAllowed = true;
    input.summary = "raw prompt with sk-proj-123456789 secret";

    const result = evaluateControlledAgentWorkspaceReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unsafe_metadata", "unknown_or_invalid_field", "invalid_authority"]));
    expect(JSON.stringify(result)).not.toContain("sk-proj-123456789");
    expect(JSON.stringify(result)).not.toContain("/Users/example/private");
    expect(authorityValues(result).every((value) => value === false)).toBe(true);
  });
});
