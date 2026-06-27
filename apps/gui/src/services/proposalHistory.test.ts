import { describe, expect, it } from "vitest";
import { appendProposalHistoryEntry, createProposalHistory, createProposalHistoryComparisonSummary, emptyProposalHistory, updateProposalHistoryEntry, type ProposalHistoryEntryInput } from "./proposalHistory";

function original(overrides: Partial<ProposalHistoryEntryInput> = {}): ProposalHistoryEntryInput {
  return {
    id: "proposal-1",
    source: "assistant-1",
    kind: "original",
    summary: "Replace one visible label after manual review.",
    touchedFiles: ["apps/gui/src/App.tsx"],
    editCount: 1,
    timestamp: "2026-06-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("proposalHistory", () => {
  it("records an original proposal as bounded display metadata", () => {
    const history = createProposalHistory([original()]);

    expect(history.kind).toBe("proposal_history");
    expect(history.authority).toBe("metadata_only");
    expect(history.entries).toEqual([
      {
        id: "proposal-1",
        source: "assistant-1",
        kind: "original",
        status: "detected",
        summary: "Replace one visible label after manual review.",
        touchedFiles: ["apps/gui/src/App.tsx"],
        touchedFileCount: 1,
        editCount: 1,
        diagnostics: [],
        timestamp: "2026-06-25T10:00:00.000Z",
      },
    ]);
  });

  it("records follow-up proposals and derives compact comparison metadata", () => {
    const history = createProposalHistory([
      original(),
      original({ id: "proposal-2", source: "assistant-2", kind: "follow_up", summary: "Adjust the visible label copy.", touchedFiles: ["apps/gui/src/App.tsx", "apps/gui/src/main.tsx"], timestamp: "2026-06-25T10:01:00.000Z" }),
    ]);

    const summary = createProposalHistoryComparisonSummary(history);

    expect(summary).toMatchObject({
      kind: "proposal_history_comparison",
      authority: "metadata_only",
      totalCount: 2,
      visibleCount: 2,
      latestStatus: "detected",
      latestSource: "assistant-2",
      touchedFileCount: 2,
    });
    expect(summary.touchedFileLabels).toEqual(["apps/gui/src/App.tsx", "apps/gui/src/main.tsx"]);
  });

  it("records sanitized proposal lineage metadata", () => {
    const history = createProposalHistory([
      original({
        kind: "follow_up",
        lineage: {
          priorProposalId: "proposal-0",
          verificationRequestId: "verify-1",
          followupDraftId: "fix-draft-1",
          intent: "fix",
        },
      }),
    ]);

    expect(history.entries[0].lineage).toEqual({
      priorProposalId: "proposal-0",
      verificationRequestId: "verify-1",
      followupDraftId: "fix-draft-1",
      intent: "fix",
    });
  });

  it("omits unsafe proposal lineage metadata", () => {
    const history = createProposalHistory([
      original({
        lineage: {
          priorProposalId: "proposal-/Users/alice/private",
          verificationRequestId: "verify-1",
          followupDraftId: "raw prompt body",
          intent: "repair-now",
        },
      }),
    ]);
    const serialized = JSON.stringify(history);

    expect(history.entries[0].lineage).toEqual({ verificationRequestId: "verify-1" });
    expect(history.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("repair-now");
  });

  it("records rejected proposals with safe diagnostics only", () => {
    const history = createProposalHistory([
      original({ id: "proposal-bad", kind: "rejected", status: "rejected", summary: "Proposal rejected before apply.", diagnostic: "Missing explicit user confirmation." }),
    ]);

    expect(history.entries[0]).toMatchObject({ kind: "rejected", status: "rejected", diagnostics: ["Missing explicit user confirmation."] });
    expect(createProposalHistoryComparisonSummary(history).rejectedCount).toBe(1);
  });

  it("records plan previews without apply authority", () => {
    const history = createProposalHistory([
      original({ id: "plan-1", source: "assistant-plan", kind: "plan_preview", summary: "Preview manual steps before a user selects the next action.", touchedFiles: ["apps/gui/src/services/proposalHistory.ts"] }),
    ]);

    expect(history.entries[0]).toMatchObject({ kind: "plan_preview", status: "preview" });
    expect(createProposalHistoryComparisonSummary(history).planPreviewCount).toBe(1);
    expect(history.policy.canRequestApply).toBe(false);
    expect(history.policy.canRunCommand).toBe(false);
  });

  it("correlates apply status by updating the existing safe proposal identity", () => {
    const history = updateProposalHistoryEntry(createProposalHistory([original()]), { id: "proposal-1", source: "assistant-1" }, { kind: "applied", status: "applied", applyStatus: "applied", summary: "Apply completed for one file.", touchedFileCount: 1 });

    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({ kind: "applied", status: "applied", applyStatus: "applied", summary: "Apply completed for one file." });
    expect(createProposalHistoryComparisonSummary(history).appliedCount).toBe(1);
  });

  it("correlates verification status by updating the existing safe proposal identity", () => {
    const applied = createProposalHistory([original({ kind: "applied", status: "applied", applyStatus: "applied" })]);
    const history = updateProposalHistoryEntry(applied, { id: "proposal-1", source: "assistant-1" }, { kind: "verification", status: "verification_failed", verificationStatus: "failed", diagnostic: "Sanitized test tail is available." });

    expect(history.entries[0]).toMatchObject({ kind: "verification", status: "verification_failed", verificationStatus: "failed" });
    expect(createProposalHistoryComparisonSummary(history).verificationFailedCount).toBe(1);
  });

  it("deduplicates matching source/id entries and ignores stale updates", () => {
    const first = createProposalHistory([original({ summary: "Initial safe summary.", timestamp: "2026-06-25T10:05:00.000Z" })]);
    const duplicate = appendProposalHistoryEntry(first, original({ summary: "Newer safe summary.", timestamp: "2026-06-25T10:06:00.000Z" }));
    const stale = appendProposalHistoryEntry(duplicate, original({ summary: "Older stale summary.", timestamp: "2026-06-25T10:04:00.000Z" }));

    expect(duplicate.entries).toHaveLength(1);
    expect(duplicate.entries[0].summary).toBe("Newer safe summary.");
    expect(stale.entries[0].summary).toBe("Newer safe summary.");
    expect(stale.diagnostics.map((item) => item.code)).toContain("stale_entry");
  });

  it("redacts or omits unsafe values and does not preserve raw authority material", () => {
    const history = createProposalHistory([
      original({
        id: "bad-/Users/alice/.codex/auth.json",
        source: "assistant-/Users/alice/project",
        summary: "raw prompt includes Authorization: Bearer sk-abcdefghi",
        touchedFiles: ["/Users/alice/project/secret.ts", "apps/gui/src/App.tsx"],
        diagnostic: "command npm test cwd /Users/alice/project",
      }),
    ]);
    const serialized = JSON.stringify(history);

    expect(history.entries[0].id).toBeUndefined();
    expect(history.entries[0].source).toBe("assistant");
    expect(history.entries[0].summary).toBe("[redacted]");
    expect(history.entries[0].diagnostics).toEqual(["[redacted]"]);
    expect(history.entries[0].touchedFiles).toEqual(["apps/gui/src/App.tsx"]);
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("sk-abcdefghi");
    expect(serialized).not.toContain("npm test");
    expect(history.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
  });

  it("bounds entries, touched files, and diagnostics", () => {
    const entries = Array.from({ length: 16 }, (_, index) => original({ id: `proposal-${index}`, source: `assistant-${index}`, touchedFiles: Array.from({ length: 12 }, (_unused, fileIndex) => `apps/gui/src/file-${index}-${fileIndex}.ts`) }));
    const history = createProposalHistory(entries, 5);

    expect(history.entries).toHaveLength(5);
    expect(history.entries[0].id).toBe("proposal-11");
    expect(history.entries[0].touchedFiles).toHaveLength(8);
    expect(history.diagnostics.length).toBeLessThanOrEqual(12);
    expect(history.diagnostics.map((item) => item.code)).toContain("bounded_output");
  });

  it("keeps conservative no-authority flags and performs no browser storage writes", () => {
    localStorage.clear();
    sessionStorage.clear();

    const history = appendProposalHistoryEntry(emptyProposalHistory(), original());
    const summary = createProposalHistoryComparisonSummary(history);

    expect(history.policy).toEqual({
      canRequestApply: false,
      canRequestVerification: false,
      canRunCommand: false,
      canReadFiles: false,
      canWriteFiles: false,
      canCallProvider: false,
      displayOnly: true,
    });
    expect(summary.policy.canCallProvider).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
