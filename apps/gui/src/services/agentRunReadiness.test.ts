import { describe, expect, it } from "vitest";
import { evaluateAgentRunState } from "./agentRunState";
import { composeAgentRunReadiness } from "./agentRunReadiness";

const sandbox = {
  kind: "experimental_sandbox_session",
  version: "2026-06-21",
  mode: "sandbox_experimental",
  defaultEnabled: false,
  cloudRequired: false,
  authority: "metadata_only",
  executionAllowed: false,
  modeStatus: "checkpoint_ready",
  userOptIn: {
    origin: "user",
    confirmedBy: "user",
    confirmedAt: "2026-06-22T20:00:00Z",
    disposableWorkspaceAcknowledged: true,
    requestIdMintedBy: "gui",
  },
  limits: {
    maxSteps: 4,
    maxTouchedFiles: 4,
    maxPatchBytes: 12000,
    maxRuntimeSeconds: 600,
    workspaceRelativePaths: ["apps/gui/src/services/agentRunReadiness.ts"],
  },
  checkpoint: {
    status: "verified",
    checkpointId: "checkpoint-s45-c1",
    createdAt: "2026-06-22T20:01:00Z",
    verified: true,
    fileCount: 1,
    contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  rollback: {
    status: "planned",
    planId: "rollback-s45-c1",
    planHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    affectedFileCount: 1,
    requiresUserConfirmation: true,
  },
};

const policy = {
  kind: "tool_authority_policy",
  version: "2026-06-21",
  mode: "sandbox_preview",
  defaultDecision: "deny",
  cloudRequired: false,
  summary: "Allowlisted verification can be displayed only by command id and explicit confirmation.",
  capability: "allowlisted_verification",
  source: {
    origin: "gui",
    requestIdMintedBy: "gui",
    hostSurface: "vscode",
  },
  risk: ["metadata_only"],
  requirements: ["explicit_user_confirmation", "trusted_request_id", "schema_validation", "trace_entry", "allowlisted_command_id"],
  decision: "allow_with_confirmation",
  allowlistedCommandId: "repository-check",
};

const readyInput = {
  loopId: "loop-s45-c1",
  goal: {
    id: "goal-s45-c1",
    title: "Compose Agent Run readiness metadata",
  },
  proposal: {
    id: "proposal-s45-c1",
    summary: "Add the pure readiness composer",
    touchedFiles: ["apps/gui/src/services/agentRunReadiness.ts"],
    source: "assistant_proposal",
    editCount: 2,
    patchBytes: 4096,
    contentHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
  checkpoint: {
    checkpointId: "checkpoint-s45-c1",
    checkpointVerified: true,
    checkpointHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    checkedAt: "2026-06-22T20:02:00Z",
  },
  sandbox,
  policy,
  verificationCommandId: "repository-check",
};

function cloneReadyInput(): Record<string, unknown> {
  return structuredClone(readyInput) as Record<string, unknown>;
}

function nested(input: Record<string, unknown>, key: string): Record<string, unknown> {
  return input[key] as Record<string, unknown>;
}

describe("composeAgentRunReadiness", () => {
  it("blocks missing checkpoint metadata", () => {
    const input = cloneReadyInput();
    delete input.checkpoint;

    const result = composeAgentRunReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.boundedLoop).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("missing_checkpoint");
  });

  it("blocks unverified checkpoint metadata", () => {
    const input = cloneReadyInput();
    input.checkpoint = { ...(input.checkpoint as Record<string, unknown>), checkpointVerified: false };

    const result = composeAgentRunReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.boundedLoop).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("checkpoint_not_verified");
  });

  it("creates ready bounded-loop metadata for verified checkpoint and valid proposal", () => {
    const result = composeAgentRunReadiness(readyInput);
    const runState = evaluateAgentRunState(result.agentRunInput);

    expect(result.state).toBe("ready");
    expect(result.diagnostics).toEqual([]);
    expect(result.boundedLoop).toMatchObject({
      kind: "bounded_patch_verification_loop",
      authority: "metadata_only",
      cloudRequired: false,
      executionAllowed: false,
      status: "ready_for_apply",
      verification: { commandId: "repository-check", status: "not_requested" },
      sandbox: { checkpointVerified: true },
    });
    expect(result.details.verificationCommandId).toBe("repository-check");
    expect(runState.state).toBe("ready_for_apply");
    expect(runState.canAutoApply).toBe(false);
  });

  it("blocks unsafe proposal paths without leaking them", () => {
    const input = cloneReadyInput();
    nested(input, "proposal").touchedFiles = ["../secret.txt", "apps/gui/src/services/agentRunReadiness.ts"];

    const result = composeAgentRunReadiness(input);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_path");
    expect(rendered).not.toContain("../secret.txt");
  });

  it("rejects raw execution fields without leaking command cwd args env or raw diff", () => {
    const input = cloneReadyInput();
    input.command = "npm test";
    input.cwd = "/Users/alice/project";
    input.args = ["--watch"];
    input.env = { API_KEY: "sk-secret123456789" };
    input.rawDiff = "diff --git SECRET_SENTINEL";

    const result = composeAgentRunReadiness(input);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["raw_execution_metadata", "unsafe_metadata"]));
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("--watch");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
    expect(rendered).not.toContain("SECRET_SENTINEL");
  });

  it("does not write browser storage while composing readiness", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = composeAgentRunReadiness(readyInput);

    expect(result.state).toBe("ready");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
