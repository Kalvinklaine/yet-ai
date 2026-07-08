import { describe, expect, it } from "vitest";
import basicFixture from "../../../../packages/contracts/examples/engine/controlled-agent-multifile-patch-plan-basic.json";
import hostAppliedFixture from "../../../../packages/contracts/examples/bridge/host-controlled-agent-multifile-apply-result-applied.json";
import { buildControlledAgentMultifileApplyRequest, correlateControlledAgentMultifileApplyResult } from "./controlledAgentMultifileApplyRequest";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function safeInput(overrides: Record<string, unknown> = {}) {
  return {
    host: "vscode",
    patchPlanMetadata: clone(basicFixture),
    userConfirmed: true,
    requestSeed: "multifile-apply-s116",
    runtimeSessionId: "runtime-s116",
    workspaceReadinessId: "ready-s116",
    replacementContentHashes: {
      "edit-s114-1": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "edit-s114-2": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    ...overrides,
  };
}

function resultText(value: unknown): string {
  return JSON.stringify(value);
}

describe("controlledAgentMultifileApplyRequest", () => {
  it("builds a metadata-only explicit VS Code multi-file apply request from a ready plan", () => {
    const result = buildControlledAgentMultifileApplyRequest(safeInput());

    expect(result.state).toBe("ready");
    if (result.state !== "ready") throw new Error("expected ready multi-file apply request");
    expect(result.bridgeRequest).toEqual({
      version: "2026-05-15",
      type: "gui.controlledAgentMultifileApplyRequest",
      requestId: "multifile-apply-s116",
      payload: {
        requestId: "multifile-apply-s116",
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        controlledWorkspaceId: "controlled-workspace-s114",
        runId: "controlled-run-s114",
        runtimeSessionId: "runtime-s116",
        workspaceReadinessId: "ready-s116",
        patchPlanId: "multifile-plan-s114",
        userConfirmed: true,
        confirmationKind: "explicit_user_multifile_apply",
        limits: {
          maxFiles: 3,
          maxEdits: 6,
          maxReplacementBytesPerEdit: 800,
          maxTotalReplacementBytes: 1600,
        },
        policy: {
          host: "vscode",
          browserSupported: false,
          jetbrainsSupported: false,
          vscodeExecutionOnly: true,
          existingTextFilesOnly: true,
          boundedReplacementOnly: true,
          rawReplacementIncluded: false,
          rawDiffIncluded: false,
          fileBodyIncluded: false,
          createAllowed: false,
          deleteAllowed: false,
          renameAllowed: false,
          moveAllowed: false,
          dependencyEditAllowed: false,
          generatedEditAllowed: false,
          hiddenPathAllowed: false,
          commandAllowed: false,
          providerAllowed: false,
          toolAllowed: false,
          automaticApplyAllowed: false,
        },
        edits: [
          {
            editId: "edit-s114-1",
            operation: "replace",
            workspaceRelativePath: "apps/gui/src/SafePanel.tsx",
            fileLabel: "apps/gui/src/SafePanel.tsx",
            existingTextFile: true,
            expectedPreEditHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            expectedRangeHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            replacementContentHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
            startLine: 12,
            endLine: 14,
            replacementByteCount: 120,
            sanitizedSummary: "Updates a bounded label branch.",
          },
          {
            editId: "edit-s114-2",
            operation: "replace",
            workspaceRelativePath: "docs/architecture/safe-note.md",
            fileLabel: "docs/architecture/safe-note.md",
            existingTextFile: true,
            expectedPreEditHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            expectedRangeHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            replacementContentHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            startLine: 20,
            endLine: 22,
            replacementByteCount: 100,
            sanitizedSummary: "Updates a bounded note paragraph.",
          },
        ],
      },
    });
    expect(result.correlation).toEqual({
      requestId: "multifile-apply-s116",
      controlledWorkspaceId: "controlled-workspace-s114",
      runId: "controlled-run-s114",
      runtimeSessionId: "runtime-s116",
      workspaceReadinessId: "ready-s116",
      patchPlanId: "multifile-plan-s114",
      expectedFileCount: 2,
      expectedEditCount: 2,
      expectedFiles: ["apps/gui/src/SafePanel.tsx", "docs/architecture/safe-note.md"],
    });
    expect(result.authority.executionAllowed).toBe(false);
    expect(result.authority.hostApplyImplemented).toBe(false);
    expect(resultText(result)).not.toContain("replacementText");
  });

  it("blocks Browser, JetBrains, missing confirmation, assistant ids, missing hashes, and unsafe raw fields", () => {
    for (const input of [
      safeInput({ host: "browser" }),
      safeInput({ host: "jetbrains" }),
      safeInput({ userConfirmed: false }),
      safeInput({ requestSeed: "assistant-apply-1" }),
      safeInput({ replacementContentHashes: { "edit-s114-1": "sha256:2222222222222222222222222222222222222222222222222222222222222222" } }),
      safeInput({ rawDiff: "diff --git a/x b/x" }),
    ]) {
      const result = buildControlledAgentMultifileApplyRequest(input);

      expect(result.state).not.toBe("ready");
      expect(result.bridgeRequest).toBeUndefined();
      expect(result.authority.executionAllowed).toBe(false);
      expect(result.authority.canAutoApply).toBe(false);
    }
  });

  it("blocks stale or over-budget patch plans", () => {
    const stalePlan = clone(basicFixture) as Record<string, any>;
    stalePlan.plan.status = "applied";
    const overBudgetPlan = clone(basicFixture) as Record<string, any>;
    overBudgetPlan.limits.maxFiles = 1;

    expect(buildControlledAgentMultifileApplyRequest(safeInput({ patchPlanMetadata: stalePlan })).state).toBe("blocked");
    expect(buildControlledAgentMultifileApplyRequest(safeInput({ patchPlanMetadata: overBudgetPlan })).state).toBe("blocked");
  });

  it("correlates matching host results into sanitized per-file summaries", () => {
    const request = buildControlledAgentMultifileApplyRequest(safeInput());
    if (!request.correlation) throw new Error("expected correlation");
    const hostMessage = clone(hostAppliedFixture) as Record<string, any>;
    hostMessage.payload.controlledWorkspaceId = request.correlation.controlledWorkspaceId;
    hostMessage.payload.runId = request.correlation.runId;
    hostMessage.payload.runtimeSessionId = request.correlation.runtimeSessionId;
    hostMessage.payload.workspaceReadinessId = request.correlation.workspaceReadinessId;
    hostMessage.payload.edits[0].editId = "edit-s114-1";
    hostMessage.payload.edits[0].workspaceRelativePath = "apps/gui/src/SafePanel.tsx";
    hostMessage.payload.edits[0].fileLabel = "apps/gui/src/SafePanel.tsx";
    hostMessage.payload.edits[1].editId = "edit-s114-2";
    hostMessage.payload.edits[1].workspaceRelativePath = "docs/architecture/safe-note.md";
    hostMessage.payload.edits[1].fileLabel = "docs/architecture/safe-note.md";
    hostMessage.payload.result.affectedFiles = ["apps/gui/src/SafePanel.tsx", "docs/architecture/safe-note.md"];

    const result = correlateControlledAgentMultifileApplyResult({ current: request.correlation, hostMessage });

    expect(result.state).toBe("accepted");
    expect(result.summary).toMatchObject({
      state: "applied",
      patchPlanId: "multifile-plan-s114",
      appliedFileCount: 2,
      appliedEditCount: 2,
      metadataOnly: true,
      rawReplacementIncluded: false,
      rawDiffIncluded: false,
      fileBodyIncluded: false,
    });
    expect(result.summary?.files).toHaveLength(2);
    expect(result.summary?.files[0]).toMatchObject({
      workspaceRelativePath: "apps/gui/src/SafePanel.tsx",
      expectedPreEditHashLabel: "sha256:0123456789a…",
      replacementContentHashLabel: "sha256:22222222222…",
    });
    expect(resultText(result)).not.toContain("rawReplacementBody");
    expect(resultText(result)).not.toContain("fileBodyText");
  });

  it("ignores stale results and blocks unsafe host result metadata", () => {
    const request = buildControlledAgentMultifileApplyRequest(safeInput());
    if (!request.correlation) throw new Error("expected correlation");
    const stale = clone(hostAppliedFixture) as Record<string, any>;
    stale.requestId = "other-request";
    stale.payload.requestId = "other-request";
    const unsafe = clone(hostAppliedFixture) as Record<string, any>;
    unsafe.payload.controlledWorkspaceId = request.correlation.controlledWorkspaceId;
    unsafe.payload.runId = request.correlation.runId;
    unsafe.payload.runtimeSessionId = request.correlation.runtimeSessionId;
    unsafe.payload.workspaceReadinessId = request.correlation.workspaceReadinessId;
    unsafe.payload.rawDiff = "diff --git a/x b/x";

    expect(correlateControlledAgentMultifileApplyResult({ current: request.correlation, hostMessage: stale }).state).toBe("ignored");
    const blocked = correlateControlledAgentMultifileApplyResult({ current: request.correlation, hostMessage: unsafe });
    expect(blocked.state).toBe("blocked");
    expect(blocked.summary).toBeUndefined();
  });
});
