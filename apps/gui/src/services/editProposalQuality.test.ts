import { describe, expect, it } from "vitest";
import type { ApplyWorkspaceEditPayload, BridgeHost, WorkspaceTextReplacement } from "../bridge/bridgeAdapter";
import { buildEditProposalQualitySummary } from "./editProposalQuality";

function replacement(line: number, replacementText: string): WorkspaceTextReplacement {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 8 } },
    replacementText,
  };
}

function payload(edits: ApplyWorkspaceEditPayload["edits"]): ApplyWorkspaceEditPayload {
  return {
    requiresUserConfirmation: true,
    summary: "Review bounded workspace edits before manual apply.",
    cloudRequired: false,
    edits,
  };
}

function summary(options: {
  proposal?: ApplyWorkspaceEditPayload;
  host?: BridgeHost;
  pending?: boolean;
  hasRedactedPreview?: boolean;
  acknowledgedRedactedPreview?: boolean;
} = {}) {
  return buildEditProposalQualitySummary({
    payload: options.proposal ?? payload([{ workspaceRelativePath: "src/example.ts", textReplacements: [replacement(4, "const label = 'Yet AI';")] }]),
    host: options.host ?? "vscode",
    pending: options.pending ?? false,
    hasRedactedPreview: options.hasRedactedPreview ?? false,
    acknowledgedRedactedPreview: options.acknowledgedRedactedPreview ?? false,
  });
}

describe("buildEditProposalQualitySummary", () => {
  it("builds a deterministic single-file small proposal summary without raw replacement bodies", () => {
    const result = summary({
      proposal: payload([{ workspaceRelativePath: "src/example.ts", textReplacements: [replacement(4, "const label = 'Yet AI';")] }]),
    });

    expect(result).toMatchObject({
      fileCount: 1,
      replacementCount: 1,
      totalReplacementChars: 23,
      maxReplacementChars: 23,
      hasRedactedPreview: false,
      latestStatus: "ready for manual apply request",
      riskBadges: ["single file", "IDE confirmation required"],
      disabledApplyReasons: [],
      fileSummaries: [
        {
          workspaceRelativePath: "src/example.ts",
          replacementCount: 1,
          lineRangeSummary: "line 4",
          replacementCharCount: 23,
          hasDeletionLikeReplacement: false,
          hasMultilineReplacement: false,
        },
      ],
    });
    expect(result.reviewChecklist).toEqual([
      "Review every listed file and range before requesting IDE apply.",
      "Confirm the proposal only changes the intended workspace-relative files.",
      "Confirm edits are replacement-only and do not rely on hidden reads or follow-up actions.",
      "Use the IDE confirmation dialog for the final manual apply decision.",
    ]);
    expect(JSON.stringify(result)).not.toContain("Yet AI");
  });

  it("builds a multi-file proposal summary with per-file bounded facts", () => {
    const result = summary({
      proposal: payload([
        { workspaceRelativePath: "src/alpha.ts", textReplacements: [replacement(1, "alpha"), replacement(3, "beta")] },
        { workspaceRelativePath: "docs/readme.md", textReplacements: [replacement(8, "docs")] },
      ]),
    });

    expect(result.fileCount).toBe(2);
    expect(result.replacementCount).toBe(3);
    expect(result.totalReplacementChars).toBe(13);
    expect(result.maxReplacementChars).toBe(5);
    expect(result.riskBadges).toEqual(["multi file", "IDE confirmation required"]);
    expect(result.fileSummaries).toEqual([
      {
        workspaceRelativePath: "src/alpha.ts",
        replacementCount: 2,
        lineRangeSummary: "line 1, line 3",
        replacementCharCount: 9,
        hasDeletionLikeReplacement: false,
        hasMultilineReplacement: false,
      },
      {
        workspaceRelativePath: "docs/readme.md",
        replacementCount: 1,
        lineRangeSummary: "line 8",
        replacementCharCount: 4,
        hasDeletionLikeReplacement: false,
        hasMultilineReplacement: false,
      },
    ]);
  });

  it("adds a large replacement badge", () => {
    const result = summary({
      proposal: payload([{ workspaceRelativePath: "src/large.ts", textReplacements: [replacement(2, "x".repeat(120))] }]),
    });

    expect(result.maxReplacementChars).toBe(120);
    expect(result.riskBadges).toContain("large replacement");
  });

  it("adds a multiline replacement badge and checklist reminder", () => {
    const result = summary({
      proposal: payload([{ workspaceRelativePath: "src/multiline.ts", textReplacements: [replacement(2, "first\nsecond")] }]),
    });

    expect(result.riskBadges).toContain("multiline replacement");
    expect(result.fileSummaries[0].hasMultilineReplacement).toBe(true);
    expect(result.reviewChecklist).toContain("Check multiline replacements for indentation and surrounding context.");
  });

  it("adds an empty replacement deletion-like badge and checklist reminder", () => {
    const result = summary({
      proposal: payload([{ workspaceRelativePath: "src/delete.ts", textReplacements: [replacement(2, "")] }]),
    });

    expect(result.riskBadges).toContain("deletion-like replacement");
    expect(result.fileSummaries[0].hasDeletionLikeReplacement).toBe(true);
    expect(result.reviewChecklist).toContain("Check deletion-like replacements carefully because they may remove existing text.");
  });

  it("keeps redacted preview disabled until acknowledged", () => {
    const blocked = summary({ hasRedactedPreview: true, acknowledgedRedactedPreview: false });
    const acknowledged = summary({ hasRedactedPreview: true, acknowledgedRedactedPreview: true });

    expect(blocked.riskBadges).toContain("preview redacted");
    expect(blocked.disabledApplyReasons).toEqual(["Acknowledge the redacted/shortened preview before IDE apply."]);
    expect(blocked.latestStatus).toBe("review blocked");
    expect(acknowledged.disabledApplyReasons).toEqual([]);
    expect(acknowledged.latestStatus).toBe("ready for manual apply request");
  });

  it("disables apply for browser hosts", () => {
    const result = summary({ host: "browser" });

    expect(result.riskBadges).toContain("browser preview only");
    expect(result.disabledApplyReasons).toEqual(["Browser preview cannot apply. Open VS Code or JetBrains for host confirmation."]);
    expect(result.latestStatus).toBe("browser preview only");
  });

  it("marks VS Code and JetBrains ready only when no blocking reason exists", () => {
    for (const host of ["vscode", "jetbrains"] as const) {
      expect(summary({ host }).latestStatus).toBe("ready for manual apply request");
      expect(summary({ host }).disabledApplyReasons).toEqual([]);
      expect(summary({ host, pending: true }).latestStatus).toBe("apply request pending");
      expect(summary({ host, pending: true }).disabledApplyReasons).toEqual(["An IDE apply request is already pending; clear pending state before requesting another apply."]);
      expect(summary({ host, hasRedactedPreview: true, acknowledgedRedactedPreview: false }).latestStatus).toBe("review blocked");
    }
  });
});
