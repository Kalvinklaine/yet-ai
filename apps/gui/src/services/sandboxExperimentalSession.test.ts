import { describe, expect, it } from "vitest";
import { evaluateSandboxExperimentalSession } from "./sandboxExperimentalSession";

const checkpointReady = {
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
    confirmedAt: "2026-06-21T17:00:00Z",
    disposableWorkspaceAcknowledged: true,
    requestIdMintedBy: "gui",
    optInLabel: "User enabled disposable sandbox preview",
  },
  limits: {
    maxSteps: 6,
    maxTouchedFiles: 4,
    maxPatchBytes: 12000,
    maxRuntimeSeconds: 600,
    workspaceRelativePaths: ["apps/gui/src/App.tsx", "docs/README.md"],
  },
  checkpoint: {
    status: "verified",
    checkpointId: "checkpoint-s41-c1",
    createdAt: "2026-06-21T17:01:00Z",
    verified: true,
    fileCount: 2,
    contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    label: "Verified disposable workspace checkpoint",
  },
  rollback: {
    status: "planned",
    planId: "rollback-plan-s41-c1",
    planHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    affectedFileCount: 2,
    requiresUserConfirmation: true,
    label: "Rollback plan prepared for review",
  },
  summary: "Checkpoint is verified and rollback plan metadata is ready",
} as const;

function cloneCheckpointReady(): Record<string, unknown> {
  return structuredClone(checkpointReady) as Record<string, unknown>;
}

describe("evaluateSandboxExperimentalSession", () => {
  it("returns disabled metadata state for missing input", () => {
    const result = evaluateSandboxExperimentalSession(undefined);

    expect(result.state).toBe("disabled");
    expect(result.allowedToExecute).toBe(false);
    expect(result.canStartLoop).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("missing_input");
    expect(localStorage.length).toBe(0);
  });

  it("blocks malformed input without leaking the raw payload", () => {
    const result = evaluateSandboxExperimentalSession("command: rm -rf /Users/alice/private sk-secret123456789");
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.allowedToExecute).toBe(false);
    expect(result.canStartLoop).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unsafe_metadata", "malformed_input"]));
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("rm -rf");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("allows opt-in display metadata without granting authority", () => {
    const input = cloneCheckpointReady();
    input.modeStatus = "opted_in";
    delete input.checkpoint;
    delete input.rollback;

    const result = evaluateSandboxExperimentalSession(input);

    expect(result.state).toBe("opted_in");
    expect(result.allowedToExecute).toBe(false);
    expect(result.canStartLoop).toBe(false);
    expect(result.diagnostics).toEqual([]);
    expect(result.details.displayOnly).toBe(true);
  });

  it("reports checkpoint-ready display as non-authoritative metadata", () => {
    const result = evaluateSandboxExperimentalSession(checkpointReady);

    expect(result.state).toBe("checkpoint_ready");
    expect(result.allowedToExecute).toBe(false);
    expect(result.canStartLoop).toBe(false);
    expect(result.diagnostics).toEqual([]);
    expect(result.details.checkpointVerified).toBe(true);
    expect(result.details.rollbackStatus).toBe("planned");
    expect(JSON.stringify(result)).not.toContain("sha256:aaaaaaaa");
  });

  it("blocks assistant-origin opt-in", () => {
    const input = cloneCheckpointReady();
    input.userOptIn = { ...(input.userOptIn as Record<string, unknown>), origin: "assistant", requestIdMintedBy: "assistant" };

    const result = evaluateSandboxExperimentalSession(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("assistant_opt_in");
    expect(result.allowedToExecute).toBe(false);
  });

  it("blocks cloud requirements and execution authority smuggling", () => {
    const input = cloneCheckpointReady();
    input.cloudRequired = true;
    input.defaultEnabled = true;
    input.authority = "tool_executor";
    input.executionAllowed = true;

    const result = evaluateSandboxExperimentalSession(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["cloud_required", "default_enabled", "invalid_authority", "execution_allowed"]));
    expect(result.allowedToExecute).toBe(false);
    expect(result.canStartLoop).toBe(false);
  });

  it("blocks raw command cwd env and unknown authority fields", () => {
    const input = cloneCheckpointReady();
    input.command = "npm test";
    input.cwd = "/Users/alice/project";
    input.env = { API_KEY: "sk-secret123456789" };

    const result = evaluateSandboxExperimentalSession(input);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unknown_or_invalid_field", "unsafe_metadata"]));
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("blocks unsafe paths secrets stack traces and raw file bodies", () => {
    const input = cloneCheckpointReady();
    input.summary = "Stack trace at run (/Users/alice/project/app.ts:1:2) sk-secret123456789 raw file body SECRET_SENTINEL";
    input.limits = { ...(input.limits as Record<string, unknown>), workspaceRelativePaths: ["../secret.txt", "apps/gui/src/App.tsx"] };

    const result = evaluateSandboxExperimentalSession(input);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("../secret.txt");
  });

  it("requires verified checkpoint metadata before checkpoint-ready display", () => {
    const input = cloneCheckpointReady();
    input.checkpoint = { ...(input.checkpoint as Record<string, unknown>), status: "pending", verified: false };

    const result = evaluateSandboxExperimentalSession(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("checkpoint_not_verified");
  });

  it("requires rollback plan metadata before rollback-ready display", () => {
    const input = cloneCheckpointReady();
    input.modeStatus = "rollback_ready";
    delete input.rollback;

    const result = evaluateSandboxExperimentalSession(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("rollback_plan_missing");
  });

  it("bounds sanitized display output and does not write browser storage", () => {
    const input = cloneCheckpointReady();
    input.summary = "safe summary ".repeat(80);
    input.limits = { ...(input.limits as Record<string, unknown>), workspaceRelativePaths: Array.from({ length: 12 }, (_, index) => `apps/gui/src/file-${index}.ts`) };

    const result = evaluateSandboxExperimentalSession(input);
    const rendered = JSON.stringify(result);

    expect(result.summary.length).toBeLessThanOrEqual(281);
    expect(result.details.workspaceRelativePaths).toHaveLength(12);
    expect(rendered.length).toBeLessThan(2200);
    expect(localStorage.length).toBe(0);
  });
});
