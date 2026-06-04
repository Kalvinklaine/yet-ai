import { describe, expect, it } from "vitest";
import { describeIdeActionProposal, parseAssistantIdeActionProposalContent, toIdeActionRequestPayload } from "./ideActionProposal";

const base = {
  type: "assistant.ideActionProposal",
  version: "2026-05-15",
  requiresUserConfirmation: true,
  cloudRequired: false,
  summary: "Review local IDE context.",
};

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
});
