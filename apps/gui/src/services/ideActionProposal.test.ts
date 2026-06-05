import { describe, expect, it } from "vitest";
import { describeIdeActionProposal, ideActionProposalMatchesCandidate, ideActionProposalPayloadKey, latestIdeActionProposalCandidateFromMessages, parseAssistantIdeActionProposalContent, toIdeActionRequestPayload, type IdeActionProposalSourceMessage, type IdeActionProposalState } from "./ideActionProposal";

const base = {
  type: "assistant.ideActionProposal",
  version: "2026-05-15",
  requiresUserConfirmation: true,
  cloudRequired: false,
  summary: "Review local IDE context.",
};

const contextProposal = { ...base, action: "getContextSnapshot" };

function assistantMessage(id: string, content: string, status = "complete"): IdeActionProposalSourceMessage {
  return { id, role: "assistant", status, content };
}

describe("ideActionProposal", () => {
  it("accepts context proposals", () => {
    const proposal = parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "getContextSnapshot" }));

    expect(proposal).not.toBeNull();
    expect(toIdeActionRequestPayload(proposal!)).toEqual({ action: "getContextSnapshot" });
    expect(describeIdeActionProposal(proposal!)).toBe("Get IDE context");
  });

  it("accepts open proposals", () => {
    const proposal = parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, summary: "Open reviewed file.", action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx" }));

    expect(proposal).not.toBeNull();
    expect(toIdeActionRequestPayload(proposal!)).toEqual({ action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx" });
    expect(describeIdeActionProposal(proposal!)).toBe("Open workspace file");
  });

  it("accepts reveal proposals", () => {
    const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } };
    const proposal = parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, summary: "Reveal reviewed range.", action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx", range }));

    expect(proposal).not.toBeNull();
    expect(toIdeActionRequestPayload(proposal!)).toEqual({ action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx", range });
    expect(describeIdeActionProposal(proposal!)).toBe("Reveal workspace range");
  });

  it("accepts whitespace around a JSON object", () => {
    expect(parseAssistantIdeActionProposalContent(`\n\t ${JSON.stringify({ ...base, action: "getContextSnapshot" })} \n`)).not.toBeNull();
  });

  it("rejects markdown fenced JSON and prose around JSON", () => {
    const json = JSON.stringify({ ...base, action: "getContextSnapshot" });

    expect(parseAssistantIdeActionProposalContent(`\`\`\`json\n${json}\n\`\`\``)).toBeNull();
    expect(parseAssistantIdeActionProposalContent(`Please confirm ${json}`)).toBeNull();
    expect(parseAssistantIdeActionProposalContent(`${json}\nThanks.`)).toBeNull();
  });

  it("rejects arrays, primitives, unknown fields, and extra requestId", () => {
    expect(parseAssistantIdeActionProposalContent(JSON.stringify([{ ...base, action: "getContextSnapshot" }]))).toBeNull();
    expect(parseAssistantIdeActionProposalContent("true")).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "getContextSnapshot", extra: true }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "getContextSnapshot", requestId: "req-1" }))).toBeNull();
  });

  it("rejects shell, git, task, tool, and edit actions", () => {
    for (const action of ["shell", "git", "task", "tool", "applyWorkspaceEdit", "editWorkspaceFile"]) {
      expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action }))).toBeNull();
    }
  });

  it("rejects unsafe paths", () => {
    for (const workspaceRelativePath of ["/Users/alice/project/src/App.tsx", "../src/App.tsx", "src/../App.tsx", "config/SK-proj-abcdefghijklmnop.env"]) {
      expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "openWorkspaceFile", workspaceRelativePath }))).toBeNull();
    }
  });

  it("rejects control, secret, or private summaries", () => {
    for (const summary of ["Review local\nIDE context.", "Review local\u007fIDE context.", "Open token configuration.", "Open /Users/alice/project/src/App.tsx.", "Open private_path metadata.", "Open sk-proj-abcdefghijklmnop."]) {
      expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, summary, action: "getContextSnapshot" }))).toBeNull();
    }
  });

  it("rejects invalid action-specific path and range combinations", () => {
    const range = { start: { line: 2, character: 0 }, end: { line: 1, character: 4 } };
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx", range }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "getContextSnapshot", workspaceRelativePath: "src/App.tsx" }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "getContextSnapshot", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "revealWorkspaceRange", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, action: "revealWorkspaceRange", workspaceRelativePath: "src/App.tsx" }))).toBeNull();
  });

  it("rejects wrong version, cloud requirement, or confirmation", () => {
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, version: "1", action: "getContextSnapshot" }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, cloudRequired: true, action: "getContextSnapshot" }))).toBeNull();
    expect(parseAssistantIdeActionProposalContent(JSON.stringify({ ...base, requiresUserConfirmation: false, action: "getContextSnapshot" }))).toBeNull();
  });

  it("derives the latest complete assistant proposal candidate", () => {
    const older = JSON.stringify(contextProposal);
    const latest = JSON.stringify({ ...base, summary: "Open reviewed file.", action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx" });

    const candidate = latestIdeActionProposalCandidateFromMessages([
      assistantMessage("a1", older),
      { id: "u1", role: "user", content: "open file" },
      assistantMessage("a2", latest),
    ]);

    expect(candidate).toEqual({
      proposal: JSON.parse(latest),
      payload: { action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx" },
      sourceMessageId: "a2",
      payloadKey: latest,
    });
  });

  it("returns no candidate when the latest complete assistant message is normal or invalid", () => {
    expect(latestIdeActionProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(contextProposal)),
      assistantMessage("a2", "Normal assistant copy."),
    ])).toBeNull();

    expect(latestIdeActionProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(contextProposal)),
      assistantMessage("a2", JSON.stringify({ ...base, action: "shell" })),
    ])).toBeNull();
  });

  it("ignores incomplete or streaming assistant messages while deriving candidates", () => {
    const complete = JSON.stringify(contextProposal);
    const streaming = JSON.stringify({ ...base, summary: "Open reviewed file.", action: "openWorkspaceFile", workspaceRelativePath: "src/App.tsx" });

    const candidate = latestIdeActionProposalCandidateFromMessages([
      assistantMessage("a1", complete),
      assistantMessage("a2", streaming, "streaming"),
      assistantMessage("a3", "Normal but incomplete.", "streaming"),
    ]);

    expect(candidate?.sourceMessageId).toBe("a1");
    expect(candidate?.payload).toEqual({ action: "getContextSnapshot" });
  });

  it("keeps payload keys stable and matches identity by source message and payload", () => {
    const proposal = parseAssistantIdeActionProposalContent(JSON.stringify(contextProposal))!;
    const candidate = latestIdeActionProposalCandidateFromMessages([assistantMessage("a1", JSON.stringify(contextProposal))]);
    const state: IdeActionProposalState = { ...candidate!, requestId: "gui-ide-proposal-1" };

    expect(ideActionProposalPayloadKey(proposal)).toBe(JSON.stringify(contextProposal));
    expect(ideActionProposalMatchesCandidate(state, candidate)).toBe(true);
    expect(ideActionProposalMatchesCandidate({ ...state, payloadKey: JSON.stringify({ ...contextProposal, summary: "Different safe summary." }) }, candidate)).toBe(false);
    expect(ideActionProposalMatchesCandidate({ ...state, sourceMessageId: "a2" }, candidate)).toBe(false);
  });
});
