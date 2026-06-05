import { describe, expect, it } from "vitest";
import type { ApplyWorkspaceEditPayload } from "../bridge/bridgeAdapter";
import {
  editProposalCandidateIdentityMatches,
  editProposalCandidateMatchesIdentity,
  editProposalIdentityMatchesCandidate,
  editProposalPayloadKey,
  isCompleteAssistantEditProposalStatus,
  latestEditProposalCandidateFromMessages,
  parseEditProposalContent,
  type EditProposalCandidate,
  type EditProposalIdentity,
  type EditProposalSourceMessage,
} from "./editProposal";

const bridgeVersion = "2026-05-15";

function safeEditProposalPayload(): ApplyWorkspaceEditPayload {
  return {
    requiresUserConfirmation: true,
    summary: "Replace one visible editor line after user review.",
    cloudRequired: false,
    edits: [
      {
        workspaceRelativePath: "src/example.ts",
        textReplacements: [
          {
            range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
            replacementText: "const label = \"Yet AI\";",
          },
        ],
      },
    ],
  };
}

function assistantMessage(id: string, content: string, status: EditProposalSourceMessage["status"] = "complete"): EditProposalSourceMessage {
  return { id, role: "assistant", status, content };
}

function assistantMessageWithoutStatus(id: string, content: string): EditProposalSourceMessage {
  return { id, role: "assistant", content };
}

describe("parseEditProposalContent", () => {
  it("accepts the bounded payload form", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify(proposal))).toEqual(proposal);
  });

  it("accepts the requestId-free full envelope form", () => {
    const proposal = safeEditProposalPayload();
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal };
    expect(parseEditProposalContent(JSON.stringify(envelope))).toEqual(proposal);
  });

  it("accepts whitespace around a JSON object", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(`\n\t ${JSON.stringify(proposal)} \n`)).toEqual(proposal);
  });

  it("rejects markdown fenced JSON", () => {
    const json = JSON.stringify(safeEditProposalPayload());
    expect(parseEditProposalContent("```json\n" + json + "\n```")).toBeNull();
    expect(parseEditProposalContent("```\n" + json + "\n```")).toBeNull();
  });

  it("rejects prose before or after JSON", () => {
    const json = JSON.stringify(safeEditProposalPayload());
    expect(parseEditProposalContent("Please confirm " + json)).toBeNull();
    expect(parseEditProposalContent("Here you go: " + json + " thanks.")).toBeNull();
    expect(parseEditProposalContent(json + "\nThanks.")).toBeNull();
  });

  it("rejects partial object extraction across surrounding text", () => {
    const proposal = safeEditProposalPayload();
    const json = JSON.stringify(proposal);
    expect(parseEditProposalContent(`prefix ${json} suffix`)).toBeNull();
    expect(parseEditProposalContent(`> ${json}`)).toBeNull();
    expect(parseEditProposalContent(json + " " + json)).toBeNull();
  });

  it("rejects arrays, primitives, and multiple top-level objects", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify([proposal]))).toBeNull();
    expect(parseEditProposalContent("true")).toBeNull();
    expect(parseEditProposalContent("42")).toBeNull();
    expect(parseEditProposalContent("\"hello\"")).toBeNull();
    expect(parseEditProposalContent("null")).toBeNull();
    expect(parseEditProposalContent(JSON.stringify(proposal) + " " + JSON.stringify(proposal))).toBeNull();
  });

  it("rejects an assistant-supplied requestId envelope", () => {
    const proposal = safeEditProposalPayload();
    const envelopeWithRequestId = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, requestId: "assistant-supplied", payload: proposal };
    expect(parseEditProposalContent(JSON.stringify(envelopeWithRequestId))).toBeNull();
  });

  it("rejects envelope with unknown fields or wrong version", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal, extra: true }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: "1", payload: proposal }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal, summary: "wrong location" }))).toBeNull();
  });

  it("rejects bounded payload form that mixes envelope-like keys", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, type: "gui.applyWorkspaceEditRequest" }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, version: bridgeVersion }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, payload: { requiresUserConfirmation: true } }))).toBeNull();
  });

  it("rejects invalid payload values", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, requiresUserConfirmation: false }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, edits: [] }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, cloudRequired: true }))).toBeNull();
  });

  it("rejects non-string and oversized content", () => {
    expect(parseEditProposalContent("")).toBeNull();
    // @ts-expect-error - intentionally passing a non-string to confirm runtime guard
    expect(parseEditProposalContent(undefined)).toBeNull();
    // @ts-expect-error - intentionally passing a non-string to confirm runtime guard
    expect(parseEditProposalContent(null)).toBeNull();
  });
});

describe("isCompleteAssistantEditProposalStatus", () => {
  it("treats undefined and complete as active", () => {
    expect(isCompleteAssistantEditProposalStatus(undefined)).toBe(true);
    expect(isCompleteAssistantEditProposalStatus("complete")).toBe(true);
  });

  it("treats streaming, pending, and error as inactive", () => {
    expect(isCompleteAssistantEditProposalStatus("streaming")).toBe(false);
    expect(isCompleteAssistantEditProposalStatus("pending")).toBe(false);
    expect(isCompleteAssistantEditProposalStatus("error")).toBe(false);
  });
});

describe("latestEditProposalCandidateFromMessages", () => {
  it("returns the latest persisted complete assistant proposal", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
    ]);

    expect(candidate?.proposal).toEqual(proposal);
    expect(candidate?.sourceMessageId).toBe("a1");
    expect(candidate?.payloadKey).toBe(editProposalPayloadKey(proposal));
  });

  it("treats statusless persisted assistant messages as complete", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessageWithoutStatus("a1", JSON.stringify(proposal)),
    ]);

    expect(candidate?.sourceMessageId).toBe("a1");
    expect(candidate?.proposal).toEqual(proposal);
  });

  it("ignores streaming and pending assistant messages", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", JSON.stringify({ ...proposal, summary: "Streaming truncated" }), "streaming"),
      assistantMessage("a3", JSON.stringify({ ...proposal, summary: "Pending truncated" }), "pending"),
    ]);

    expect(candidate?.sourceMessageId).toBe("a1");
    expect(candidate?.proposal).toEqual(proposal);
  });

  it("clears active proposal when the latest complete assistant message is normal text", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", "Normal assistant response."),
    ]);

    expect(candidate).toBeNull();
  });

  it("clears active proposal when the latest complete assistant message is invalid JSON", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", "not json"),
    ]);

    expect(candidate).toBeNull();
  });

  it("ignores non-assistant roles", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      { id: "u1", role: "user", status: "complete", content: JSON.stringify(proposal) },
      { id: "e1", role: "error", status: "complete", content: JSON.stringify(proposal) },
    ]);

    expect(candidate).toBeNull();
  });

  it("uses canonical payload keys independent of JSON field order", () => {
    const proposal = safeEditProposalPayload();
    const ordered = JSON.stringify(proposal);
    const reordered = JSON.stringify({
      edits: proposal.edits,
      cloudRequired: proposal.cloudRequired,
      summary: proposal.summary,
      requiresUserConfirmation: proposal.requiresUserConfirmation,
    });
    expect(ordered).not.toBe(reordered);

    const fromOrdered = latestEditProposalCandidateFromMessages([assistantMessage("a1", ordered)]);
    const fromReordered = latestEditProposalCandidateFromMessages([assistantMessage("a1", reordered)]);
    expect(fromOrdered?.payloadKey).toBe(fromReordered?.payloadKey);
  });

  it("changes payload keys when the semantic payload changes", () => {
    const first = safeEditProposalPayload();
    const second = { ...first, summary: "Different safe summary." };

    const firstCandidate = latestEditProposalCandidateFromMessages([assistantMessage("a1", JSON.stringify(first))]);
    const secondCandidate = latestEditProposalCandidateFromMessages([assistantMessage("a1", JSON.stringify(second))]);

    expect(firstCandidate?.payloadKey).not.toBe(secondCandidate?.payloadKey);
  });

  it("returns a stable candidate identity for the same source message and payload", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([assistantMessage("a1", JSON.stringify(proposal))]);
    expect(candidate).not.toBeNull();

    const identity: EditProposalIdentity = { sourceMessageId: candidate!.sourceMessageId, payloadKey: candidate!.payloadKey };
    expect(editProposalIdentityMatchesCandidate(identity, candidate)).toBe(true);
    expect(editProposalCandidateIdentityMatches(identity, candidate)).toBe(true);
    expect(editProposalCandidateMatchesIdentity(candidate, identity)).toBe(true);
  });

  it("rejects identity matches that differ in source message or payload key", () => {
    const proposal = safeEditProposalPayload();
    const candidate: EditProposalCandidate = {
      proposal,
      sourceMessageId: "a1",
      payloadKey: editProposalPayloadKey(proposal),
    };

    const mismatchedSource: EditProposalIdentity = { sourceMessageId: "a2", payloadKey: candidate.payloadKey };
    const mismatchedKey: EditProposalIdentity = { sourceMessageId: "a1", payloadKey: editProposalPayloadKey({ ...proposal, summary: "Different." }) };

    expect(editProposalIdentityMatchesCandidate(mismatchedSource, candidate)).toBe(false);
    expect(editProposalIdentityMatchesCandidate(mismatchedKey, candidate)).toBe(false);
    expect(editProposalCandidateIdentityMatches(null, candidate)).toBe(false);
    expect(editProposalCandidateIdentityMatches(candidate, null)).toBe(false);
  });
});

describe("editProposalPayloadKey", () => {
  it("treats omitted cloudRequired and explicit cloudRequired:false as the same key", () => {
    const proposal = safeEditProposalPayload();
    const omitted = { ...proposal };
    delete (omitted as Partial<ApplyWorkspaceEditPayload>).cloudRequired;
    const explicit = { ...proposal, cloudRequired: false } as ApplyWorkspaceEditPayload;

    expect(editProposalPayloadKey(omitted as ApplyWorkspaceEditPayload)).toBe(editProposalPayloadKey(explicit));
  });

  it("preserves the same key for a payload that already has cloudRequired:false", () => {
    const proposal = safeEditProposalPayload();
    expect(editProposalPayloadKey(proposal)).toBe(editProposalPayloadKey({ ...proposal, cloudRequired: false }));
  });

  it("changes the key when a different summary is set", () => {
    const proposal = safeEditProposalPayload();
    const omitted = { ...proposal };
    delete (omitted as Partial<ApplyWorkspaceEditPayload>).cloudRequired;
    const changed = { ...omitted, summary: "Different summary." } as ApplyWorkspaceEditPayload;

    expect(editProposalPayloadKey(omitted as ApplyWorkspaceEditPayload)).not.toBe(editProposalPayloadKey(changed));
  });
});
