import { describe, expect, it } from "vitest";
import happyPathFixture from "../../../../packages/contracts/examples/engine/controlled-agent-task-harness-vscode-happy-path.json";
import jetbrainsPartialFixture from "../../../../packages/contracts/examples/engine/controlled-agent-task-harness-jetbrains-partial.json";
import rawDataFixture from "../../../../packages/contracts/examples-invalid/engine/controlled-agent-task-harness-raw-data.json";
import staleAcceptedFixture from "../../../../packages/contracts/examples-invalid/engine/controlled-agent-task-harness-stale-lineage-accepted.json";
import browserFixture from "../../../../packages/contracts/examples-invalid/engine/controlled-agent-task-harness-unsupported-browser-host.json";
import invalidLineageAcceptedStateFixture from "../../../../packages/contracts/examples-invalid/engine/controlled-agent-task-harness-invalid-lineage-accepted-proposal-state.json";
import { evaluateControlledAgentTaskHarness } from "./controlledAgentTaskHarness";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

function expectNoUnsafeLeak(value: unknown) {
  const text = rendered(value);
  for (const marker of ["Raw prompt", "raw prompt", "/Users/", "sk-proj", "provider payload", "browser storage", "raw diff", "raw command", "Authorization"]) {
    expect(text).not.toContain(marker);
  }
}

describe("evaluateControlledAgentTaskHarness", () => {
  it("summarizes the VS Code happy path as bounded metadata only", () => {
    const result = evaluateControlledAgentTaskHarness(clone(happyPathFixture));

    expect(result.state).toBe("ready");
    expect(result.host).toBe("vscode");
    expect(result.presetId).toBe("fix-small-bug");
    expect(result.statusLabel).toBe("VS Code harness metadata ready");
    expect(result.counters).toEqual({
      selectedItemCount: 3,
      searchQueryCount: 1,
      searchResultCount: 2,
      activeFileExcerptCount: 1,
      patchFileCount: 2,
      replacementByteCount: 320,
      verificationCommandCount: 2,
      unsafeOmittedCount: 0,
    });
    expect(result.gates).toMatchObject({
      presetSelected: true,
      contextSelected: true,
      proposalReviewed: true,
      proposalAccepted: true,
      patchPlanReviewed: true,
      patchPlanAccepted: true,
      applyConfirmed: true,
      verificationConfirmed: true,
      followupRequiresUserChoice: true,
    });
    expect(result.policy).toEqual({
      metadataOnly: true,
      cloudRequired: false,
      executionAllowed: true,
      canAutoSend: false,
      canReadHiddenFiles: false,
      canSearchHiddenFiles: false,
      canIndexWorkspace: false,
      canAutoApply: false,
      canAutoVerify: false,
      canAutoRepair: false,
      canUseFreeformCommands: false,
      canUseProviderTools: false,
      canUseNetwork: false,
      canMutateGit: false,
      canInstallPackages: false,
      canStoreRawData: false,
      canStoreBrowserData: false,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.labels.length).toBeLessThanOrEqual(12);
    expectNoUnsafeLeak(result);
  });

  it("blocks incomplete explicit user gate preconditions", () => {
    const input = clone(happyPathFixture) as Record<string, any>;
    input.contextSelection.selectedByUser = false;
    input.proposal.reviewedByUser = false;
    input.patchPlanReview.reviewedByUser = false;

    const result = evaluateControlledAgentTaskHarness(input);

    expect(result.state).toBe("blocked");
    expect(result.gates.contextSelected).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("blocked_precondition");
    expectNoUnsafeLeak(result);
  });

  it("keeps Browser unsupported and metadata fail-closed", () => {
    const result = evaluateControlledAgentTaskHarness(clone(browserFixture));

    expect(result.state).toBe("unsupported");
    expect(result.host).toBe("browser");
    expect(result.policy.executionAllowed).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host");
    expectNoUnsafeLeak(result);
  });

  it("keeps JetBrains partial metadata fail-closed", () => {
    const result = evaluateControlledAgentTaskHarness(clone(jetbrainsPartialFixture));

    expect(result.state).toBe("partial_fail_closed");
    expect(result.host).toBe("jetbrains");
    expect(result.policy.executionAllowed).toBe(false);
    expect(result.gates.proposalAccepted).toBe(false);
    expect(result.gates.applyConfirmed).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["partial_host", "invalid_lineage"]));
    expectNoUnsafeLeak(result);
  });

  it("fails closed on stale or mismatched lineage that still claims acceptance", () => {
    const stale = evaluateControlledAgentTaskHarness(clone(staleAcceptedFixture));
    const mismatched = evaluateControlledAgentTaskHarness(clone(invalidLineageAcceptedStateFixture));

    for (const result of [stale, mismatched]) {
      expect(result.state).toBe("blocked");
      expect(result.policy.executionAllowed).toBe(true);
      expect(result.diagnostics.map((item) => item.code)).toContain("invalid_lineage");
      expectNoUnsafeLeak(result);
    }
  });

  it("reports bounded failed verification without enabling automatic recovery", () => {
    const input = clone(happyPathFixture) as Record<string, any>;
    input.verification.state = "failed";
    input.verification.summary = "User approved checks and saw sanitized failed status.";
    input.followupRecovery.state = "ready";
    input.followupRecovery.nextStep = "manual_retry";

    const result = evaluateControlledAgentTaskHarness(input);

    expect(result.state).toBe("failed");
    expect(result.gates.verificationConfirmed).toBe(true);
    expect(result.policy.canAutoRepair).toBe(false);
    expect(result.policy.canAutoVerify).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("failed_verification");
    expectNoUnsafeLeak(result);
  });

  it("marks follow-up ready as user-choice metadata when verification has not succeeded", () => {
    const input = clone(happyPathFixture) as Record<string, any>;
    input.apply.state = "not_requested";
    input.apply.userConfirmed = false;
    input.apply.requestIdMintedBy = "none";
    input.verification.state = "not_requested";
    input.verification.userConfirmed = false;
    input.verification.commandCount = 0;
    input.followupRecovery.state = "ready";
    input.followupRecovery.nextStep = "manual_followup";

    const result = evaluateControlledAgentTaskHarness(input);

    expect(result.state).toBe("followup_ready");
    expect(result.gates.applyConfirmed).toBe(false);
    expect(result.gates.verificationConfirmed).toBe(false);
    expect(result.gates.followupRequiresUserChoice).toBe(true);
    expect(result.policy.canAutoSend).toBe(false);
    expectNoUnsafeLeak(result);
  });

  it("rejects and omits unsafe raw markers and widened authority", () => {
    const input = clone(rawDataFixture) as Record<string, any>;
    input.extra = {
      rawPrompt: "raw prompt /Users/alice/project sk-proj-secretvalue",
      command: "npm test",
      browserStorageDump: "browser storage dump",
    };
    input.policyFlags.autoApplyAllowed = true;

    const result = evaluateControlledAgentTaskHarness(input);

    expect(result.state).toBe("blocked");
    expect(result.counters.unsafeOmittedCount).toBeGreaterThan(0);
    expect(result.policy.canStoreRawData).toBe(true);
    expect(result.policy.canAutoApply).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unsafe_metadata", "unsafe_authority"]));
    expectNoUnsafeLeak(result);
  });
});
