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
    expect(result.agentRunInput.proposal).toEqual({ id: "assistant-1", summary: "Replace one visible line after manual review.", touchedFiles: ["src/example.ts"] });
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
