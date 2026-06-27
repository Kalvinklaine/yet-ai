import { describe, expect, it } from "vitest";
import type { ApplyWorkspaceEditPayload, WorkspaceTextReplacement } from "../bridge/bridgeAdapter";
import type { AgentRunInput } from "./agentRunState";
import type { BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";
import { buildAgentRunApplyRiskSummary } from "./agentRunApplyRisk";

function replacement(line: number, replacementText: string): WorkspaceTextReplacement {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 8 } },
    replacementText,
  };
}

function proposal(edits: ApplyWorkspaceEditPayload["edits"]): ApplyWorkspaceEditPayload {
  return {
    requiresUserConfirmation: true,
    summary: "Review bounded workspace edits before manual apply.",
    cloudRequired: false,
    edits,
  };
}

const readyLoop: BoundedPatchVerificationLoopMetadata = {
  kind: "bounded_patch_verification_loop",
  version: "2026-06-21",
  authority: "metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  status: "ready_for_apply",
  loopId: "loop-s68-ready",
  sandbox: {
    modeStatus: "checkpoint_ready",
    checkpointId: "checkpoint-s68-ready",
    checkpointVerified: true,
    checkpointHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  limits: {
    maxTouchedFiles: 4,
    maxPatchBytes: 12000,
    maxSteps: 4,
    maxVerificationSeconds: 600,
  },
  patch: {
    proposalId: "proposal-s68-ready",
    source: "assistant_proposal",
    touchedFiles: ["src/example.ts"],
    editCount: 1,
    patchBytes: 1024,
    contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    summary: "Reviewable patch metadata is ready",
  },
  policy: {
    decision: "ready_for_user_apply",
    requiresUserConfirmation: true,
    reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only"],
  },
  verification: {
    commandId: "repository-check",
    status: "not_requested",
  },
  summary: "Patch can be applied after explicit user confirmation",
};

const readyRun: AgentRunInput = {
  goal: { id: "goal-s68", title: "Summarize apply risk" },
  proposal: { id: "proposal-s68-ready", summary: "Patch metadata detected", touchedFiles: ["src/example.ts"] },
  boundedLoop: readyLoop,
};

function baseProposal(): ApplyWorkspaceEditPayload {
  return proposal([{ workspaceRelativePath: "src/example.ts", textReplacements: [replacement(4, "const label = 'Yet AI';")] }]);
}

function readySummary(options: Parameters<typeof buildAgentRunApplyRiskSummary>[0] = {}) {
  return buildAgentRunApplyRiskSummary({
    proposal: baseProposal(),
    agentRun: readyRun,
    host: "vscode",
    ...options,
  });
}

function expectNoRawLeak(value: unknown): void {
  const rendered = JSON.stringify(value);
  expect(rendered).not.toContain("/Users/alice");
  expect(rendered).not.toContain("sk-secret123456789");
  expect(rendered).not.toContain("SECRET_SENTINEL");
  expect(rendered).not.toContain("const label");
  expect(rendered).not.toContain("npm test");
}

describe("buildAgentRunApplyRiskSummary", () => {
  it("summarizes a safe single-file apply proposal as bounded metadata only", () => {
    const result = readySummary();

    expect(result).toMatchObject({
      status: "ready",
      fileCount: 1,
      editCount: 1,
      totalReplacementChars: 23,
      maxReplacementChars: 23,
      fileLabels: ["src/example.ts"],
      riskBadges: [],
      disabledReasons: [],
    });
    expect(result.readinessItems).toEqual([
      { label: "proposal parsed", state: "ready" },
      { label: "checkpoint ready", state: "ready" },
      { label: "host supports apply", state: "ready" },
      { label: "user review required", state: "ready" },
      { label: "no pending apply", state: "ready" },
    ]);
    expect(result.recoveryGuidance).toEqual(["Review the listed workspace-relative files, then use the IDE confirmation dialog if you choose to apply."]);
    expectNoRawLeak(result);
  });

  it("marks multi-file large deletion-like proposals for review without replacement bodies", () => {
    const result = readySummary({
      proposal: proposal([
        { workspaceRelativePath: "src/alpha.ts", textReplacements: [replacement(1, "x".repeat(120))] },
        { workspaceRelativePath: "docs/readme.md", textReplacements: [replacement(8, "")] },
      ]),
    });

    expect(result.status).toBe("review_required");
    expect(result.fileCount).toBe(2);
    expect(result.editCount).toBe(2);
    expect(result.totalReplacementChars).toBe(120);
    expect(result.maxReplacementChars).toBe(120);
    expect(result.riskBadges).toEqual(["multi-file", "large replacement", "deletion-like replacement"]);
    expect(result.readinessItems.find((item) => item.label === "user review required")?.state).toBe("review_required");
    expectNoRawLeak(result);
  });

  it("blocks browser-only previews", () => {
    const result = readySummary({ host: "browser" });

    expect(result.status).toBe("blocked");
    expect(result.riskBadges).toContain("browser preview only");
    expect(result.disabledReasons).toContain("Browser preview cannot apply. Open VS Code or JetBrains for host confirmation.");
    expect(result.readinessItems).toContainEqual({ label: "host supports apply", state: "blocked" });
  });

  it("blocks missing checkpoint and blocked policy metadata", () => {
    const missingCheckpoint = readySummary({
      agentRun: { goal: { title: "Risk" }, proposal: { id: "proposal-s68", summary: "Patch" } },
    });
    const blockedLoop = structuredClone(readyLoop) as BoundedPatchVerificationLoopMetadata;
    blockedLoop.sandbox.modeStatus = "blocked";
    blockedLoop.sandbox.checkpointVerified = false;
    blockedLoop.policy.decision = "blocked";
    blockedLoop.policy.blockReason = "Policy requires checkpoint review";
    const policyBlocked = readySummary({ agentRun: { ...readyRun, boundedLoop: blockedLoop } });

    expect(missingCheckpoint.status).toBe("blocked");
    expect(missingCheckpoint.riskBadges).toEqual(expect.arrayContaining(["checkpoint missing", "policy blocked"]));
    expect(policyBlocked.status).toBe("blocked");
    expect(policyBlocked.riskBadges).toEqual(expect.arrayContaining(["checkpoint missing", "policy blocked"]));
    expect(policyBlocked.disabledReasons).toContain("Apply policy metadata is blocked or unavailable.");
  });

  it("blocks while an apply request is pending", () => {
    const result = readySummary({ pendingApply: true });

    expect(result.status).toBe("blocked");
    expect(result.disabledReasons).toContain("An IDE apply request is already pending; wait for the current result before requesting another apply.");
    expect(result.readinessItems).toContainEqual({ label: "no pending apply", state: "blocked" });
  });

  it("requires review acknowledgement for redacted previews", () => {
    const blocked = readySummary({ hasRedactedPreview: true, acknowledgedRedactedPreview: false });
    const acknowledged = readySummary({ hasRedactedPreview: true, acknowledgedRedactedPreview: true });

    expect(blocked.status).toBe("blocked");
    expect(blocked.riskBadges).toContain("preview redacted");
    expect(blocked.disabledReasons).toContain("Acknowledge the redacted preview before requesting manual IDE apply.");
    expect(acknowledged.status).toBe("review_required");
    expect(acknowledged.disabledReasons).toEqual([]);
    expect(acknowledged.riskBadges).toContain("preview redacted");
  });

  it("redacts unsafe private paths and fails closed for unsafe metadata", () => {
    const result = readySummary({
      proposal: proposal([{ workspaceRelativePath: "/Users/alice/project/secret.ts", textReplacements: [replacement(2, "SECRET_SENTINEL")] }]),
      applyResult: { rawDiff: "SECRET_SENTINEL", cwd: "/Users/alice/project", env: { API_KEY: "sk-secret123456789" } },
    });

    expect(result.status).toBe("blocked");
    expect(result.fileLabels).toEqual(["[redacted]"]);
    expect(result.disabledReasons).toEqual(expect.arrayContaining([
      "Proposal metadata contains unsafe or private labels and must be reviewed from a sanitized source.",
      "Apply result metadata contains unsafe fields and is omitted from readiness.",
    ]));
    expect(result.readinessItems).toContainEqual({ label: "proposal parsed", state: "blocked" });
    expectNoRawLeak(result);
  });

  it("fails closed for malformed proposals", () => {
    const result = readySummary({ proposal: { rawPrompt: "SECRET_SENTINEL" } });

    expect(result.status).toBe("blocked");
    expect(result.fileCount).toBe(0);
    expect(result.editCount).toBe(0);
    expect(result.disabledReasons).toContain("Proposal metadata could not be safely parsed for manual apply review.");
    expectNoRawLeak(result);
  });
});
