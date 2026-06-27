import { describe, expect, it } from "vitest";
import { deriveGuidedFixLoopStatus, type GuidedFixLoopInput } from "./guidedFixLoop";
import { createProposalHistory } from "./proposalHistory";

function failedInput(overrides: Partial<GuidedFixLoopInput> = {}): GuidedFixLoopInput {
  return {
    verificationResult: { status: "failed", exitCode: 1, durationMs: 25 },
    priorProposal: { id: "proposal-1", summary: "Adjust the visible status label.", source: "assistant" },
    proposalHistory: createProposalHistory([
      { id: "proposal-1", source: "assistant", kind: "original", summary: "Adjust the visible status label.", touchedFiles: ["apps/gui/src/App.tsx"] },
    ]),
    ...overrides,
  };
}

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

describe("deriveGuidedFixLoopStatus", () => {
  it("detects successful terminal verification as no fix needed", () => {
    const state = deriveGuidedFixLoopStatus({
      verificationResult: { status: "succeeded", exitCode: 0, durationMs: 10 },
      priorProposal: { id: "proposal-1", summary: "Adjust the visible status label." },
    });

    expect(state).toMatchObject({
      kind: "guided_fix_loop",
      authority: "metadata_only",
      cloudRequired: false,
      executionAllowed: false,
      status: "no_fix_needed",
    });
    expect(state.policy).toEqual({ displayOnly: true });
    expect(state.cta).toContain("Review");
  });

  it("detects failed verification with prior proposal as draft available only", () => {
    const state = deriveGuidedFixLoopStatus(failedInput());

    expect(state.status).toBe("fix_draft_available");
    expect(state.reason).toContain("manual fix draft");
    expect(state.cta).toContain("manual review only");
    expect(rendered(state)).not.toContain("canAuto");
    expect(state.policy).toEqual({ displayOnly: true });
  });

  it("detects an existing fix draft without sending it", () => {
    const drafted = deriveGuidedFixLoopStatus(failedInput({
      draft: {
        present: true,
        label: "Composer draft created",
        metadata: {
          kind: "agent_run.followup_prompt_draft",
          authority: "metadata_only",
          cloudRequired: false,
          executionAllowed: false,
          draftOnly: true,
          mode: "fix",
          verification: { commandId: "gui-app-tests", status: "failed", exitCode: 1, truncated: true },
        },
      },
    }));
    const awaiting = deriveGuidedFixLoopStatus(failedInput({ draft: { present: true, awaitingManualSend: true, label: "Composer draft ready" } }));

    expect(drafted.status).toBe("fix_drafted");
    expect(drafted.cta).toContain("nothing is sent automatically");
    expect(awaiting.status).toBe("awaiting_manual_send");
    expect(awaiting.cta).toContain("click Send manually");
    expect(awaiting.policy).toEqual({ displayOnly: true });
  });

  it("detects a later proposal only from matching sanitized proposal-history lineage", () => {
    const state = deriveGuidedFixLoopStatus(failedInput({
      proposalHistory: createProposalHistory([
        { id: "proposal-1", source: "assistant", kind: "original", summary: "Adjust the visible status label." },
        { id: "proposal-2", source: "assistant", kind: "follow_up", summary: "Use safer manual fix copy.", lineage: { priorProposalId: "proposal-1", verificationRequestId: "verify-1", followupDraftId: "fix-draft-1", intent: "fix" } },
      ]),
      draft: {
        present: true,
        metadata: {
          kind: "agent_run.followup_prompt_draft",
          authority: "metadata_only",
          cloudRequired: false,
          executionAllowed: false,
          draftOnly: true,
          mode: "fix",
          draftId: "fix-draft-1",
          verification: { commandId: "gui-app-tests", status: "failed", exitCode: 1, truncated: true, requestId: "verify-1" },
          priorProposal: { id: "proposal-1" },
        },
      },
      lineage: { priorProposalId: "proposal-1", verificationRequestId: "verify-1", followupDraftId: "fix-draft-1" },
    }));

    expect(state.status).toBe("new_proposal_detected");
    expect(state.reason).toContain("later correlated proposal");
    expect(state.cta).toContain("Review the new proposal manually");
    expect(state.labels).toEqual(expect.arrayContaining(["latest proposal proposal-2"]));
  });

  it("does not detect unrelated later follow-up proposals as guided fixes", () => {
    const state = deriveGuidedFixLoopStatus(failedInput({
      proposalHistory: createProposalHistory([
        { id: "proposal-1", source: "assistant", kind: "original", summary: "Adjust the visible status label." },
        { id: "proposal-2", source: "assistant", kind: "follow_up", summary: "Unrelated follow-up copy.", lineage: { priorProposalId: "proposal-x", verificationRequestId: "verify-other", intent: "followup" } },
      ]),
      lineage: { priorProposalId: "proposal-1", verificationRequestId: "verify-1" },
    }));

    expect(state.status).toBe("fix_draft_available");
    expect(state.reason).not.toContain("later correlated proposal");
  });

  it("blocks failed verification when prior proposal metadata is missing", () => {
    const state = deriveGuidedFixLoopStatus({ verificationResult: { status: "failed", exitCode: 1 } });

    expect(state.status).toBe("blocked");
    expect(state.diagnostics).toEqual(expect.arrayContaining(["Missing prior safe proposal metadata."]));
    expect(state.cta).toContain("manual proposal");
  });

  it("blocks unsafe raw-looking metadata and omits private details", () => {
    const privatePath = "/Users/alice/project";
    const state = deriveGuidedFixLoopStatus(failedInput({
      verificationResult: { status: "failed", exitCode: 1, outputTail: `command: npm test ${privatePath}` },
      priorProposal: { id: "proposal-1", summary: "raw prompt: include file body", source: "assistant" },
      draft: { present: true, label: "auto repair ready" },
    }));
    const output = rendered(state);

    expect(state.status).toBe("blocked");
    expect(state.diagnostics.length).toBeGreaterThan(0);
    expect(output).not.toContain(privatePath);
    expect(output).not.toContain("npm test");
    expect(output).not.toContain("raw prompt");
    expect(output).not.toContain("file body");
    expect(output).not.toContain("auto repair");
    expect(output).not.toContain("command:");
  });
});
