import { describe, expect, it } from "vitest";
import { parseControlledAgentProviderProposal } from "./providerProposalParser";

function providerProposal(overrides: Record<string, unknown> = {}) {
  const proposal = {
    kind: "controlled_agent_provider_proposal",
    version: "2026-07-07",
    authority: "provider_proposal_metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    providerToolCallingAllowed: false,
    rawProviderPayloadStored: false,
    automaticApplyAllowed: false,
    automaticRunAllowed: false,
    workspace: {
      controlledWorkspaceId: "workspace-1",
      runId: "run-1",
      workspaceMode: "worktree",
      host: "vscode",
      privatePathExposed: false,
      workspaceLabel: "Controlled worktree",
    },
    providerProposal: {
      proposalId: "provider-proposal-1",
      source: "model",
      sanitizedOnly: true,
      rawPayloadStored: false,
      toolCallsIncluded: false,
      automaticActionsIncluded: false,
      summary: "Review bounded model metadata.",
      plan: { stepCount: 2, steps: ["Review the visible goal", "Apply manually only after confirmation"] },
      editMetadata: {
        operation: "replace",
        workspaceRelativePath: "apps/gui/src/App.tsx",
        expectedContentHash: `sha256:${"a".repeat(64)}`,
        startLine: 4,
        endLine: 4,
        replacementByteCount: 42,
        rawReplacementStored: false,
        rawDiffStored: false,
        requiresUserApply: true,
        fileLabel: "App component",
        summary: "Replace one visible UI label after review.",
      },
      verificationSuggestion: {
        commandId: "gui-app-tests",
        allowlistedCommandIdOnly: true,
        freeformCommandAllowed: false,
        requiresUserRun: true,
        summary: "Run focused GUI tests only after user confirmation.",
      },
    },
    policyFlags: {
      metadataOnly: true,
      boundedPlanMetadataAllowed: true,
      boundedEditMetadataAllowed: true,
      providerToolCallingAllowed: false,
      rawProviderPayloadPersistenceAllowed: false,
      rawPromptPersistenceAllowed: false,
      rawFilePersistenceAllowed: false,
      rawDiffPersistenceAllowed: false,
      rawCommandPersistenceAllowed: false,
      rawOutputPersistenceAllowed: false,
      automaticApplyAllowed: false,
      automaticRunAllowed: false,
      automaticVerifyAllowed: false,
      automaticRepairAllowed: false,
      shellAllowed: false,
      gitAllowed: false,
      networkAllowed: false,
      packageInstallAllowed: false,
      hiddenReadAllowed: false,
      searchAllowed: false,
      indexingAllowed: false,
      toolAuthorityAllowed: false,
    },
  };
  return { ...proposal, ...overrides };
}

describe("parseControlledAgentProviderProposal", () => {
  it("accepts strict metadata-only provider proposals", () => {
    const result = parseControlledAgentProviderProposal(JSON.stringify(providerProposal()));

    expect(result.state).toBe("valid");
    if (result.state !== "valid") {
      return;
    }
    expect(result.proposal).toEqual({
      proposalId: "provider-proposal-1",
      summary: "Review bounded model metadata.",
      planSteps: ["Review the visible goal", "Apply manually only after confirmation"],
      touchedFile: "apps/gui/src/App.tsx",
      verificationSuggestion: "GUI app tests",
      replacementByteCount: 42,
    });
    expect(result.payloadKey).toContain("controlled_agent_provider_proposal");
  });

  it("accepts sanitized hash placeholders after GUI-facing SSE redaction", () => {
    const result = parseControlledAgentProviderProposal(JSON.stringify(providerProposal({
      providerProposal: {
        ...providerProposal().providerProposal,
        editMetadata: {
          ...providerProposal().providerProposal.editMetadata,
          expectedContentHash: "sha256:[redacted]",
        },
      },
    })));

    expect(result.state).toBe("valid");
    expect(result.state === "valid" ? result.proposal.touchedFile : undefined).toBe("apps/gui/src/App.tsx");
  });

  it("rejects raw payload, tool-call, and automatic authority metadata", () => {
    const rawPayload = parseControlledAgentProviderProposal(JSON.stringify(providerProposal({ rawProviderPayloadStored: true })));
    const toolCall = parseControlledAgentProviderProposal(JSON.stringify(providerProposal({ providerProposal: { ...providerProposal().providerProposal, toolCallsIncluded: true } })));
    const automatic = parseControlledAgentProviderProposal(JSON.stringify(providerProposal({ automaticRunAllowed: true })));

    expect(rawPayload.state).toBe("rejected");
    expect(toolCall.state).toBe("rejected");
    expect(automatic.state).toBe("rejected");
  });

  it("rejects unsafe text, private paths, freeform commands, and oversized output", () => {
    const unsafeText = parseControlledAgentProviderProposal(JSON.stringify(providerProposal({ providerProposal: { ...providerProposal().providerProposal, summary: "Use raw provider payload from /Users/alice/private/auth.json" } })));
    const freeformCommand = parseControlledAgentProviderProposal(JSON.stringify(providerProposal({ providerProposal: { ...providerProposal().providerProposal, verificationSuggestion: { ...(providerProposal().providerProposal as Record<string, unknown>).verificationSuggestion as Record<string, unknown>, freeformCommandAllowed: true } } })));
    const oversized = parseControlledAgentProviderProposal(JSON.stringify(providerProposal()) + "x".repeat(24001));

    expect(unsafeText.state).toBe("rejected");
    expect(freeformCommand.state).toBe("rejected");
    expect(oversized.state).toBe("rejected");
    expect(JSON.stringify(unsafeText)).not.toContain("/Users/alice");
  });

  it("treats prose as no provider proposal and rejects prose mixed with JSON", () => {
    const prose = parseControlledAgentProviderProposal("I need more explicit context before proposing metadata.");
    const mixed = parseControlledAgentProviderProposal(`Here you go\n${JSON.stringify(providerProposal())}`);

    expect(prose.state).toBe("none");
    expect(mixed.state).toBe("rejected");
  });
});
