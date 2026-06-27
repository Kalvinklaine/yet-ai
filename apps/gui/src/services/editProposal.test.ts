import { describe, expect, it } from "vitest";
import type { ApplyWorkspaceEditPayload } from "../bridge/bridgeAdapter";
import {
  analyzeEditProposalContent,
  editProposalCandidateIdentityMatches,
  editProposalCandidateMatchesIdentity,
  editProposalIdentityMatchesCandidate,
  editProposalPayloadKey,
  editProposalRejectedRecoveryGuidance,
  isCompleteAssistantEditProposalStatus,
  latestEditProposalCandidateFromMessages,
  latestEditProposalReviewFromMessages,
  parseEditProposalContent,
  type EditProposalCandidate,
  type EditProposalIdentity,
  type EditProposalSourceMessage,
} from "./editProposal";
import planToPatchContractFixture from "../../../../packages/contracts/examples/engine/agent-run-plan-to-patch-proposal.json";

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

function safeEditProposalPayloadWith(overrides: Partial<ApplyWorkspaceEditPayload>): Record<string, unknown> {
  return { ...safeEditProposalPayload(), ...overrides } as Record<string, unknown>;
}

function planToPatchEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    version: "2026-06-24",
    type: "agent_run.plan_to_patch_proposal",
    summary: "Replace one visible editor label after manual review.",
    plan: ["Review the visible proposal metadata", "Apply only after explicit user confirmation"],
    risks: ["Small UI copy change may need focused review"],
    editProposal: safeEditProposalPayload(),
    verificationSuggestions: [{ commandId: "gui-app-tests", label: "GUI app tests" }],
    ...overrides,
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

  it("accepts one fenced json envelope with surrounding prose", () => {
    const proposal = safeEditProposalPayload();
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal };
    expect(parseEditProposalContent(`Review this safe edit:\n\n\`\`\`json\n${JSON.stringify(envelope, null, 2)}\n\`\`\`\n\nNothing is applied automatically.`)).toEqual(proposal);
  });

  it("accepts a strict plan-to-patch proposal envelope and extracts the nested safe edit proposal", () => {
    const proposal = safeEditProposalPayload();
    const envelope = planToPatchEnvelope({ editProposal: proposal });

    expect(parseEditProposalContent(JSON.stringify(envelope))).toEqual(proposal);
    expect(analyzeEditProposalContent(JSON.stringify(envelope))).toEqual({
      state: "valid",
      proposal,
      planToPatchMetadata: {
        summary: "Replace one visible editor label after manual review.",
        plan: ["Review the visible proposal metadata", "Apply only after explicit user confirmation"],
        risks: ["Small UI copy change may need focused review"],
        verificationSuggestions: [{ commandId: "gui-app-tests", label: "GUI app tests" }],
      },
    });
  });

  it("accepts the positive contract fixture through the parser", () => {
    const analysis = analyzeEditProposalContent(JSON.stringify(planToPatchContractFixture));

    expect(analysis.state).toBe("valid");
    if (analysis.state === "valid") {
      expect(analysis.proposal).toEqual(planToPatchContractFixture.editProposal);
      expect(analysis.planToPatchMetadata).toEqual({
        summary: planToPatchContractFixture.summary,
        plan: planToPatchContractFixture.plan,
        risks: planToPatchContractFixture.risks,
        verificationSuggestions: planToPatchContractFixture.verificationSuggestions,
      });
    }
  });

  it("accepts a fenced strict plan-to-patch proposal envelope", () => {
    const proposal = safeEditProposalPayload();
    const envelope = planToPatchEnvelope({ editProposal: proposal });

    expect(parseEditProposalContent(`\`\`\`json\n${JSON.stringify(envelope, null, 2)}\n\`\`\``)).toEqual(proposal);
  });

  it.each([
    ["assistant_request_id", { requestId: "assistant-minted-id" }, "assistant_request_id"],
    ["unsafe_path", { editProposal: safeEditProposalPayloadWith({ edits: [{ ...safeEditProposalPayload().edits[0], workspaceRelativePath: "/Users/alice/project/src/example.ts" }] }) }, "unsafe_path"],
    ["missing_confirmation", { editProposal: { ...safeEditProposalPayload(), requiresUserConfirmation: false } }, "missing_confirmation"],
    ["oversized_content", { editProposal: safeEditProposalPayloadWith({ edits: [{ ...safeEditProposalPayload().edits[0], textReplacements: [{ ...safeEditProposalPayload().edits[0].textReplacements[0], replacementText: "x".repeat(8193) }] }] }) }, "oversized_content"],
    ["unsupported_verification", { verificationSuggestions: [{ commandId: "shell", label: "npm test" }] }, "unsupported_verification"],
    ["command_tool_smuggling", { editProposal: { ...safeEditProposalPayload(), toolCall: { name: "apply_patch" } } }, "command_tool_smuggling"],
    ["unknown_keys", { extra: "unsupported" }, "unknown_keys"],
    ["wrong_version", { version: "2026-01-01" }, "wrong_version"],
  ] as Array<[string, Record<string, unknown>, string]>)("rejects unsafe plan-to-patch proposals with %s diagnostics", (_label, overrides, reasonCode) => {
    const result = analyzeEditProposalContent(JSON.stringify(planToPatchEnvelope(overrides)));

    expect(result.state).toBe("rejected");
    expect(result.state === "rejected" ? result.diagnostic.reasonCode : undefined).toBe(reasonCode);
    expect(parseEditProposalContent(JSON.stringify(planToPatchEnvelope(overrides)))).toBeNull();
  });

  it("rejects fenced json direct payloads and non-json fences", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(`\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``)).toBeNull();
    expect(parseEditProposalContent(`\`\`\`\n${JSON.stringify(proposal)}\n\`\`\``)).toBeNull();
  });

  it("rejects prose before or after raw JSON", () => {
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

  it("rejects prose with multiple candidate envelopes", () => {
    const proposal = safeEditProposalPayload();
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal };
    const json = JSON.stringify(envelope);
    expect(parseEditProposalContent(`Option A:\n\`\`\`json\n${json}\n\`\`\`\nOption B:\n\`\`\`json\n${json}\n\`\`\``)).toBeNull();
    expect(parseEditProposalContent(`\`\`\`json\n${json}\n\`\`\`\nAlso consider {"type":"gui.applyWorkspaceEditRequest"}`)).toBeNull();
  });

  it("rejects command and tool smuggling fields", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, command: "npm test" }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, tool: { name: "apply_patch" } }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal, command: "apply" }))).toBeNull();
  });

  it("rejects invalid payload values", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, requiresUserConfirmation: false }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, edits: [] }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, cloudRequired: true }))).toBeNull();
  });

  it("rejects unsafe paths, duplicate file groups, and unsupported edit operations", () => {
    const proposal = safeEditProposalPayload();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, edits: [{ ...proposal.edits[0], workspaceRelativePath: "../secret.txt" }] }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, edits: [{ ...proposal.edits[0], workspaceRelativePath: "/Users/private/project/src/example.ts" }] }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, edits: [proposal.edits[0], { ...proposal.edits[0] }] }))).toBeNull();
    expect(parseEditProposalContent(JSON.stringify({ ...proposal, edits: [{ ...proposal.edits[0], operation: "deleteFile" }] }))).toBeNull();
  });

  it("rejects non-string and oversized content", () => {
    expect(parseEditProposalContent("")).toBeNull();
    // @ts-expect-error - intentionally passing a non-string to confirm runtime guard
    expect(parseEditProposalContent(undefined)).toBeNull();
    // @ts-expect-error - intentionally passing a non-string to confirm runtime guard
    expect(parseEditProposalContent(null)).toBeNull();
  });

  it("rejects oversized content before parsing", () => {
    expect(parseEditProposalContent(`{"summary":"${"safe ".repeat(12000)}"}`)).toBeNull();
  });
});

describe("analyzeEditProposalContent", () => {
  it("reports valid direct payload and fenced envelope states", () => {
    const proposal = safeEditProposalPayload();
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal };

    expect(analyzeEditProposalContent(JSON.stringify(proposal))).toEqual({ state: "valid", proposal });
    expect(analyzeEditProposalContent(`Review:\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``)).toEqual({ state: "valid", proposal });
  });

  it("reports sanitized diagnostics for fenced direct payload and non-json fences", () => {
    const proposal = safeEditProposalPayload();
    const fencedDirect = analyzeEditProposalContent(`\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``);
    const nonJsonFence = analyzeEditProposalContent(`\`\`\`ts\n${JSON.stringify(proposal)}\n\`\`\``);

    expect(fencedDirect).toEqual({ state: "rejected", diagnostic: { reasonCode: "fenced_payload_requires_envelope", message: expect.any(String) } });
    expect(nonJsonFence).toEqual({ state: "rejected", diagnostic: { reasonCode: "invalid_fence", message: expect.any(String) } });
  });

  it("reports diagnostics for ambiguous or invalid JSON candidates", () => {
    const proposal = safeEditProposalPayload();
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal };

    expect(analyzeEditProposalContent(`${JSON.stringify(proposal)} ${JSON.stringify(proposal)}`)).toEqual({ state: "rejected", diagnostic: { reasonCode: "ambiguous", message: expect.any(String) } });
    expect(analyzeEditProposalContent(`\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``)).toEqual({ state: "rejected", diagnostic: { reasonCode: "ambiguous", message: expect.any(String) } });
    expect(analyzeEditProposalContent("{bad json}")).toEqual({ state: "rejected", diagnostic: { reasonCode: "invalid_json", message: expect.any(String) } });
  });

  it("reports envelope diagnostics for wrong version, requestId, and unknown keys", () => {
    const proposal = safeEditProposalPayload();

    expect(analyzeEditProposalContent(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: "1", payload: proposal }))).toEqual({ state: "rejected", diagnostic: { reasonCode: "wrong_version", message: expect.any(String) } });
    expect(analyzeEditProposalContent(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, requestId: "assistant", payload: proposal }))).toEqual({ state: "rejected", diagnostic: { reasonCode: "assistant_request_id", message: expect.any(String) } });
    expect(analyzeEditProposalContent(JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal, extra: true }))).toEqual({ state: "rejected", diagnostic: { reasonCode: "unknown_keys", message: expect.any(String) } });
  });

  it("reports smuggling, envelope-like direct payload, invalid payload, and no-json diagnostics", () => {
    const proposal = safeEditProposalPayload();

    expect(analyzeEditProposalContent(JSON.stringify({ ...proposal, command: "npm test" }))).toEqual({ state: "rejected", diagnostic: { reasonCode: "command_tool_smuggling", message: expect.any(String) } });
    expect(analyzeEditProposalContent(JSON.stringify({ ...proposal, version: bridgeVersion }))).toEqual({ state: "rejected", diagnostic: { reasonCode: "envelope_like_direct_payload", message: expect.any(String) } });
    expect(analyzeEditProposalContent(JSON.stringify({ ...proposal, requiresUserConfirmation: false }))).toEqual({ state: "rejected", diagnostic: { reasonCode: "invalid_payload", message: expect.any(String) } });
    expect(analyzeEditProposalContent("Please apply this workspaceRelativePath edit.")).toEqual({ state: "rejected", diagnostic: { reasonCode: "no_json", message: expect.any(String) } });
  });

  it("reports safe bounded diagnostics for smuggled command tool request ids and multiple JSON", () => {
    const proposal = safeEditProposalPayload();
    const rawSecret = "access_token=" + "e".repeat(64);
    const cases = [
      JSON.stringify({ ...proposal, command: `npm test ${rawSecret}` }),
      JSON.stringify({ ...proposal, tool: { name: "apply_patch", token: rawSecret } }),
      JSON.stringify({ type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, requestId: rawSecret, payload: proposal }),
      `${JSON.stringify(proposal)} ${JSON.stringify({ ...proposal, summary: `second ${rawSecret}` })}`,
    ];

    for (const content of cases) {
      const analysis = analyzeEditProposalContent(content);
      expect(analysis.state).toBe("rejected");
      if (analysis.state === "rejected") {
        const rendered = JSON.stringify(analysis.diagnostic);
        expect(rendered.length).toBeLessThan(220);
        expect(rendered).not.toContain(rawSecret);
        expect(rendered).not.toContain("access_token");
        expect(rendered).not.toContain("npm test");
        expect(rendered).not.toContain("apply_patch");
        expect(rendered).not.toContain("second");
      }
    }
  });

  it("returns none for normal assistant text and sanitized diagnostics without raw content", () => {
    const rawPath = "/Users/private/project/src/secret.ts";
    const rawSecret = "sk-" + "x".repeat(40);
    const analysis = analyzeEditProposalContent(`Apply this workspaceRelativePath ${rawPath} ${rawSecret}`);

    expect(analyzeEditProposalContent("Normal assistant response.")).toEqual({ state: "none" });
    expect(analysis.state).toBe("rejected");
    if (analysis.state === "rejected") {
      expect(analysis.diagnostic.message).not.toContain(rawPath);
      expect(analysis.diagnostic.message).not.toContain(rawSecret);
      expect(analysis.diagnostic).toEqual({ reasonCode: "no_json", message: expect.any(String) });
    }
  });
});

describe("editProposalRejectedRecoveryGuidance", () => {
  it.each([
    ["invalid_json", "one strict safe-edit JSON proposal"],
    ["ambiguous", "single smaller patch proposal"],
    ["unsafe_path", "corrected workspace-relative paths only"],
    ["command_tool_smuggling", "replacement-only safe-edit JSON"],
    ["assistant_request_id", "without any requestId field"],
    ["unsupported_verification", "supported display-only verification suggestions"],
  ] as Array<[Parameters<typeof editProposalRejectedRecoveryGuidance>[0], string]>)("maps %s to concise manual guidance", (reasonCode, expectedCopy) => {
    const guidance = editProposalRejectedRecoveryGuidance(reasonCode);

    expect(guidance.nextStep).toContain(expectedCopy);
    expect(`${guidance.title} ${guidance.nextStep} ${guidance.formatHint}`).not.toMatch(/auto[- ]?(?:fix|apply|run|verify)|\b(?:shell|git|cwd|env)\b|hidden read|hidden search|apply automatically|run automatically/i);
  });

  it("keeps recovery guidance generic without unsafe diagnostic content", () => {
    const rawSecret = "access_token=" + "r".repeat(64);
    const rawPath = "/Users/alice/private/project/src/secret.ts";

    for (const reasonCode of ["unsafe_path", "command_tool_smuggling", "invalid_payload"] as const) {
      const guidance = editProposalRejectedRecoveryGuidance(reasonCode);
      const rendered = JSON.stringify(guidance);
      expect(rendered).not.toContain(rawSecret);
      expect(rendered).not.toContain(rawPath);
      expect(rendered).not.toContain("/Users/alice");
      expect(rendered).not.toContain("api_key");
      expect(rendered.length).toBeLessThan(520);
    }
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

  it("keeps the latest valid proposal when later complete assistant messages are normal text", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", "Normal assistant response."),
    ]);

    expect(candidate?.sourceMessageId).toBe("a1");
    expect(candidate?.proposal).toEqual(proposal);
  });

  it("keeps the latest valid proposal when later complete assistant messages are non-json text", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", "not json"),
    ]);

    expect(candidate?.sourceMessageId).toBe("a1");
    expect(candidate?.proposal).toEqual(proposal);
  });

  it("clears active proposal when the latest complete assistant message looks like an invalid edit proposal", () => {
    const proposal = safeEditProposalPayload();
    const candidate = latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", JSON.stringify({ ...proposal, requiresUserConfirmation: false })),
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

describe("latestEditProposalReviewFromMessages", () => {
  it("returns the latest valid candidate review", () => {
    const proposal = safeEditProposalPayload();
    const review = latestEditProposalReviewFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
    ]);

    expect(review.state).toBe("valid");
    if (review.state === "valid") {
      expect(review.candidate.proposal).toEqual(proposal);
      expect(review.candidate.sourceMessageId).toBe("a1");
      expect(review.candidate.payloadKey).toBe(editProposalPayloadKey(proposal));
    }
  });

  it("returns a rejected review for the latest invalid proposal-like assistant message", () => {
    const proposal = safeEditProposalPayload();
    const review = latestEditProposalReviewFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", JSON.stringify({ ...proposal, requiresUserConfirmation: false })),
    ]);

    expect(review).toEqual({ state: "rejected", sourceMessageId: "a2", diagnostic: { reasonCode: "invalid_payload", message: expect.any(String) } });
    expect(latestEditProposalCandidateFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", JSON.stringify({ ...proposal, requiresUserConfirmation: false })),
    ])).toBeNull();
  });

  it("preserves current latest valid behavior after a normal assistant message", () => {
    const proposal = safeEditProposalPayload();
    const review = latestEditProposalReviewFromMessages([
      assistantMessage("a1", JSON.stringify(proposal)),
      assistantMessage("a2", "Normal assistant response."),
    ]);

    expect(review.state).toBe("valid");
    if (review.state === "valid") {
      expect(review.candidate.sourceMessageId).toBe("a1");
      expect(review.candidate.proposal).toEqual(proposal);
    }
  });

  it("returns none when there are no complete assistant proposal reviews", () => {
    const proposal = safeEditProposalPayload();
    expect(latestEditProposalReviewFromMessages([
      { id: "u1", role: "user", status: "complete", content: JSON.stringify(proposal) },
      assistantMessage("a1", JSON.stringify(proposal), "streaming"),
    ])).toEqual({ state: "none" });
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
