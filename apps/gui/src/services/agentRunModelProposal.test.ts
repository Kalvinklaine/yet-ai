import { describe, expect, it } from "vitest";
import type { ApplyWorkspaceEditPayload } from "../bridge/bridgeAdapter";
import { evaluateAgentRunModelProposal, type AgentRunModelProposalInput } from "./agentRunModelProposal";
import { editProposalPayloadKey } from "./editProposal";

function proposal(path = "src/example.ts", summary = "Replace one visible line after manual review."): ApplyWorkspaceEditPayload {
  return {
    requiresUserConfirmation: true,
    summary,
    cloudRequired: false,
    edits: [
      {
        workspaceRelativePath: path,
        textReplacements: [
          {
            range: { start: { line: 2, character: 0 }, end: { line: 2, character: 12 } },
            replacementText: "const label = \"Yet AI\";",
          },
        ],
      },
    ],
  };
}

function envelope(payload = proposal()): string {
  return JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: "2026-05-15", payload });
}

function planToPatchEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: "2026-06-24",
    type: "agent_run.plan_to_patch_proposal",
    summary: "Replace one visible label after review.",
    plan: ["Review the visible proposal", "Apply only after user confirmation"],
    risks: [],
    editProposal: proposal(),
    verificationSuggestions: [{ commandId: "gui-app-tests", label: "GUI app tests" }],
    ...overrides,
  });
}

function multistepPlan(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: "2026-06-25",
    kind: "agent_run.multistep_plan",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    title: "Review a manual multi-step plan",
    summary: "Preview bounded steps before the user chooses the next action.",
    steps: [
      { id: "step-1", title: "Inspect visible state", summary: "Review already visible context only.", status: "preview_only", expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.ts"], riskLabels: [] },
      { id: "step-2", title: "Show plan metadata", summary: "Render display metadata without apply authority.", status: "preview_only", expectedTouchedFiles: [], riskLabels: ["Manual review remains required"] },
    ],
    risks: ["Manual confirmation remains required"],
    expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.ts"],
    verificationSuggestions: [{ commandId: "gui-app-tests", label: "GUI app tests", description: "Run the focused GUI application test gate after explicit user selection.", riskLevel: "medium", expectedDuration: "Usually 5 to 10 minutes", cwdPolicyLabel: "Repository root selected by host", outputBoundLabel: "Sanitized tail only" }],
    manualActionPolicy: { noAutoSend: true, noAutoApply: true, noAutoVerification: true, noAutoRollback: true, noHiddenReads: true, requiresExplicitUserAction: true },
    ...overrides,
  });
}

function providerProposal(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "controlled_agent_provider_proposal",
    version: "2026-07-07",
    authority: "provider_proposal_metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    providerToolCallingAllowed: false,
    rawProviderPayloadStored: false,
    automaticApplyAllowed: false,
    automaticRunAllowed: false,
    workspace: { controlledWorkspaceId: "workspace-1", runId: "run-1", workspaceMode: "worktree", host: "vscode", privatePathExposed: false },
    providerProposal: {
      proposalId: "provider-proposal-1",
      source: "model",
      sanitizedOnly: true,
      rawPayloadStored: false,
      toolCallsIncluded: false,
      automaticActionsIncluded: false,
      summary: "Review a bounded model proposal.",
      plan: { stepCount: 2, steps: ["Review visible metadata", "Wait for manual apply"] },
      editMetadata: { operation: "replace", workspaceRelativePath: "apps/gui/src/App.tsx", expectedContentHash: `sha256:${"a".repeat(64)}`, startLine: 3, endLine: 3, replacementByteCount: 42, rawReplacementStored: false, rawDiffStored: false, requiresUserApply: true },
      verificationSuggestion: { commandId: "gui-app-tests", allowlistedCommandIdOnly: true, freeformCommandAllowed: false, requiresUserRun: true },
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
    ...overrides,
  });
}

function input(content: string, overrides: Partial<AgentRunModelProposalInput> = {}): AgentRunModelProposalInput {
  return {
    chatId: "chat-1",
    goal: "Update the visible label.",
    submittedPromptRequestId: "prompt-1",
    latestUserMessageId: "user-1",
    runtimeSettingsVersion: "runtime-1",
    latestAssistantMessage: {
      id: "assistant-1",
      chatId: "chat-1",
      role: "assistant",
      status: "complete",
      content,
      responseToRequestId: "prompt-1",
      userMessageId: "user-1",
      runtimeSettingsVersion: "runtime-1",
    },
    ...overrides,
  };
}

describe("evaluateAgentRunModelProposal", () => {
  it("detects a valid strict proposal and emits display-only Agent Run metadata", () => {
    const result = evaluateAgentRunModelProposal(input(JSON.stringify(proposal())));

    expect(result.proposalPathState).toBe("proposal_detected");
    expect(result.diagnostics).toEqual([]);
    expect(result.agentRunInput.goal?.summary).toBe("Update the visible label.");
    expect(result.agentRunInput.proposal).toEqual({ id: "assistant-1", summary: "Replace one visible line after manual review.", touchedFiles: ["src/example.ts"] });
    expect(result.agentRunInput.applyRequest).toBeUndefined();
    expect(result.agentRunInput.verificationRequest).toBeUndefined();
  });

  it("detects a fenced JSON proposal when it uses the strict envelope", () => {
    const result = evaluateAgentRunModelProposal(input(`\`\`\`json\n${envelope()}\n\`\`\``));

    expect(result.proposalPathState).toBe("proposal_detected");
    expect(result.agentRunInput.proposal?.touchedFiles).toEqual(["src/example.ts"]);
  });

  it("detects a valid plan-to-patch proposal envelope", () => {
    const result = evaluateAgentRunModelProposal(input(planToPatchEnvelope()));

    expect(result.proposalPathState).toBe("proposal_detected");
    expect(result.diagnostics).toEqual([]);
    expect(result.agentRunInput.proposal).toEqual({
      id: "assistant-1",
      summary: "Replace one visible line after manual review.",
      touchedFiles: ["src/example.ts"],
      planSummary: "Replace one visible label after review.",
      planSteps: ["Review the visible proposal", "Apply only after user confirmation"],
      risks: [],
      verificationSuggestions: ["GUI app tests (gui-app-tests)"],
    });
  });

  it("detects an inert multi-step plan without creating edit proposal authority", () => {
    const result = evaluateAgentRunModelProposal(input(multistepPlan()));

    expect(result.proposalPathState).toBe("plan_detected");
    expect(result.diagnostics).toEqual([]);
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.agentRunInput.applyRequest).toBeUndefined();
    expect(result.agentRunInput.verificationRequest).toBeUndefined();
    expect(result.planPreview).toEqual({
      sourceMessageId: "assistant-1",
      plan: expect.objectContaining({
        kind: "agent_run.multistep_plan",
        title: "Review a manual multi-step plan",
        verificationSuggestions: [{ commandId: "gui-app-tests", label: "GUI app tests" }],
      }),
    });
  });

  it("detects metadata-only provider proposals without apply authority", () => {
    const result = evaluateAgentRunModelProposal(input(providerProposal()));

    expect(result.proposalPathState).toBe("proposal_detected");
    expect(result.diagnostics).toEqual([]);
    expect(result.agentRunInput.proposal).toEqual({
      id: "provider-proposal-1",
      summary: "Review a bounded model proposal.",
      touchedFiles: ["apps/gui/src/App.tsx"],
      planSteps: ["Review visible metadata", "Wait for manual apply"],
      verificationSuggestions: ["GUI app tests"],
    });
    expect(result.agentRunInput.applyRequest).toBeUndefined();
    expect(result.agentRunInput.verificationRequest).toBeUndefined();
  });

  it("rejects unsafe provider proposals", () => {
    const result = evaluateAgentRunModelProposal(input(providerProposal({ rawProviderPayloadStored: true })));

    expect(result.proposalPathState).toBe("blocked");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("unsafe_metadata");
  });

  it("prevents duplicate provider proposal adoption", () => {
    const first = evaluateAgentRunModelProposal(input(providerProposal()));
    const second = evaluateAgentRunModelProposal(input(providerProposal(), {
      providerProposalState: {
        sourceMessageId: "assistant-1",
        proposalId: "provider-proposal-1",
        payloadKey: first.proposalPathState === "proposal_detected" ? "not-needed-for-id-match" : "unused",
      },
    }));

    expect(first.proposalPathState).toBe("proposal_detected");
    expect(second.proposalPathState).toBe("stale_response");
    expect(second.agentRunInput.proposal).toBeUndefined();
    expect(second.diagnostics[0]?.code).toBe("duplicate_proposal");
  });

  it("treats normal prose as a non-authoritative normal response", () => {
    const result = evaluateAgentRunModelProposal(input("I need the selected file excerpt before I can propose a safe edit."));

    expect(result.proposalPathState).toBe("normal_response");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("normal_response");
  });

  it("rejects malformed JSON and does not keep stale valid proposal metadata", () => {
    const stale = proposal();
    const result = evaluateAgentRunModelProposal(input("{ \"requiresUserConfirmation\": true, \"edits\": [", { editProposalState: { sourceMessageId: "assistant-old", payloadKey: editProposalPayloadKey(stale) } }));

    expect(result.proposalPathState).toBe("proposal_rejected");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain("not valid");
  });

  it("rejects multiple proposals", () => {
    const content = `${JSON.stringify(proposal())}\n${JSON.stringify(proposal("src/other.ts"))}`;
    const result = evaluateAgentRunModelProposal(input(content));

    expect(result.proposalPathState).toBe("proposal_rejected");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain("multiple");
  });

  it("rejects assistant-supplied request ids", () => {
    const result = evaluateAgentRunModelProposal(input(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: "2026-05-15", requestId: "assistant-apply-1", payload: proposal() })));

    expect(result.proposalPathState).toBe("proposal_rejected");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain("must not supply");
  });

  it("rejects unsafe path, command, and tool fields", () => {
    const unsafePath = evaluateAgentRunModelProposal(input(JSON.stringify(proposal("/Users/alice/project/src/example.ts"))));
    const commandField = evaluateAgentRunModelProposal(input(JSON.stringify({ ...proposal(), command: "npm test" })));
    const toolField = evaluateAgentRunModelProposal(input(envelope({ ...proposal(), tool: "apply_patch" } as ApplyWorkspaceEditPayload)));

    expect(unsafePath.proposalPathState).toBe("proposal_rejected");
    expect(commandField.proposalPathState).toBe("proposal_rejected");
    expect(toolField.proposalPathState).toBe("proposal_rejected");
    expect(unsafePath.agentRunInput.proposal).toBeUndefined();
    expect(commandField.agentRunInput.proposal).toBeUndefined();
    expect(toolField.agentRunInput.proposal).toBeUndefined();
  });

  it.each([
    ["unsupported verification", { verificationSuggestions: [{ commandId: "npm-test", label: "npm test" }] }, "unsupported verification"],
    ["missing confirmation", { editProposal: { ...proposal(), requiresUserConfirmation: false } }, "explicit user confirmation"],
    ["unsafe path", { editProposal: proposal("/Users/alice/project/src/example.ts") }, "unsafe workspace path"],
    ["oversized content", { editProposal: proposal("src/example.ts", "Replace one visible line after manual review.") }, "too large"],
  ])("surfaces sanitized plan-to-patch diagnostics for %s", (_label, overrides, expected) => {
    const nextOverrides = _label === "oversized content"
      ? { editProposal: { ...proposal(), edits: [{ ...proposal().edits[0], textReplacements: [{ ...proposal().edits[0].textReplacements[0], replacementText: "x".repeat(8193) }] }] } }
      : overrides;
    const result = evaluateAgentRunModelProposal(input(planToPatchEnvelope(nextOverrides as Record<string, unknown>)));

    expect(result.proposalPathState).toBe("proposal_rejected");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain(expected);
    expect(JSON.stringify(result)).not.toContain("/Users/alice");
    expect(JSON.stringify(result)).not.toContain("npm test");
  });

  it("ignores stale chat responses", () => {
    const result = evaluateAgentRunModelProposal(input(JSON.stringify(proposal()), { latestAssistantMessage: { ...input("").latestAssistantMessage!, content: JSON.stringify(proposal()), chatId: "chat-old" } }));

    expect(result.proposalPathState).toBe("stale_response");
    expect(result.agentRunInput.proposal).toBeUndefined();
  });

  it("stales a proposal after a newer user message changes correlation", () => {
    const result = evaluateAgentRunModelProposal(input(JSON.stringify(proposal()), { latestUserMessageId: "user-2" }));

    expect(result.proposalPathState).toBe("stale_response");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain("latest user message");
  });

  it("stales correlation after runtime settings change", () => {
    const result = evaluateAgentRunModelProposal(input(JSON.stringify(proposal()), { runtimeSettingsVersion: "runtime-2" }));

    expect(result.proposalPathState).toBe("stale_response");
    expect(result.agentRunInput.proposal).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain("settings changed");
  });

  it("redacts secret and private path diagnostics", () => {
    const result = evaluateAgentRunModelProposal(input("{}", { submittedPromptRequestId: "prompt-/Users/alice/.codex/auth.json-sk-abcdefghi" }));

    expect(result.proposalPathState).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("/Users/alice");
    expect(JSON.stringify(result)).not.toContain("sk-abcdefghi");
  });

  it("does not write browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = evaluateAgentRunModelProposal(input(JSON.stringify(proposal())));

    expect(result.proposalPathState).toBe("proposal_detected");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
