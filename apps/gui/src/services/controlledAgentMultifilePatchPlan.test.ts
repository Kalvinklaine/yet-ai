import { describe, expect, it } from "vitest";
import basicFixture from "../../../../packages/contracts/examples/engine/controlled-agent-multifile-patch-plan-basic.json";
import { evaluateControlledAgentMultifilePatchPlan } from "./controlledAgentMultifilePatchPlan";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function plan(overrides: Record<string, unknown> = {}): Record<string, any> {
  return { ...(clone(basicFixture) as Record<string, any>), ...overrides };
}

function resultText(value: unknown): string {
  return JSON.stringify(value);
}

describe("evaluateControlledAgentMultifilePatchPlan", () => {
  it("produces sanitized review-only dry-run preview metadata for the safe S114 fixture", () => {
    const result = evaluateControlledAgentMultifilePatchPlan(plan());

    expect(result.state).toBe("ready");
    if (result.state !== "ready") {
      throw new Error("expected ready multi-file patch plan preview");
    }
    expect(result.preview).toEqual({
      kind: "controlled_agent_multifile_patch_plan",
      planId: "multifile-plan-s114",
      status: "review_pending",
      workspaceLabel: "controlled worktree",
      summary: "Two bounded text replacements are ready for user review.",
      fileCount: 2,
      editCount: 2,
      totalReplacementBytes: 220,
      touchedPathLabels: ["apps/gui/src/SafePanel.tsx", "docs/architecture/safe-note.md"],
      files: [
        {
          workspaceRelativePath: "apps/gui/src/SafePanel.tsx",
          fileLabel: "apps/gui/src/SafePanel.tsx",
          fileSummary: "Adjusts a small display label for review.",
          riskLabel: "low",
          expectedPreEditHashLabel: "sha256:aaaaaaaaaaa…",
          editCount: 1,
          replacementByteTotal: 120,
          edits: [
            {
              editId: "edit-s114-1",
              operation: "replace",
              rangeLabel: "lines 12-14",
              startLine: 12,
              endLine: 14,
              expectedRangeHashLabel: "sha256:bbbbbbbbbbb…",
              replacementByteCount: 120,
              replacementSummary: "Updates a bounded label branch.",
            },
          ],
        },
        {
          workspaceRelativePath: "docs/architecture/safe-note.md",
          fileLabel: "docs/architecture/safe-note.md",
          fileSummary: "Refreshes a short architecture note.",
          riskLabel: "medium",
          expectedPreEditHashLabel: "sha256:ccccccccccc…",
          editCount: 1,
          replacementByteTotal: 100,
          edits: [
            {
              editId: "edit-s114-2",
              operation: "replace",
              rangeLabel: "lines 20-22",
              startLine: 20,
              endLine: 22,
              expectedRangeHashLabel: "sha256:ddddddddddd…",
              replacementByteCount: 100,
              replacementSummary: "Updates a bounded note paragraph.",
            },
          ],
        },
      ],
      budgets: {
        maxFiles: 3,
        maxEdits: 6,
        maxReplacementBytesPerEdit: 800,
        maxTotalReplacementBytes: 1600,
      },
      metadataOnly: true,
      reviewOnly: true,
      dryRunOnly: true,
      automaticApplyAllowed: false,
      assistantMintedApplyAllowed: false,
    });
    expect(resultText(result)).not.toContain("rawReplacementIncluded");
    expect(resultText(result)).not.toContain("rawDiffIncluded");
    expect(resultText(result)).not.toContain("replacementBody");
  });

  it("accepts JSON text input for the safe fixture", () => {
    const result = evaluateControlledAgentMultifilePatchPlan(JSON.stringify(basicFixture));

    expect(result.state).toBe("ready");
  });

  it("blocks raw replacement bodies without leaking raw output", () => {
    const input = plan();
    input.plan.files[0].edits[0].replacementBody = "const leakedSecret = 'do not show';";

    const result = evaluateControlledAgentMultifilePatchPlan(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics[0]?.code).toBe("unsafe_metadata");
    expect(resultText(result)).not.toContain("leakedSecret");
    expect(resultText(result)).not.toContain("do not show");
  });

  it("blocks absolute private traversal hidden dependency and generated paths without exposing the path", () => {
    for (const workspaceRelativePath of ["/Users/alice/project/file.ts", "../safe/file.ts", ".hidden/file.ts", "node_modules/pkg/index.ts", "src/generated/client.ts"]) {
      const input = plan();
      input.plan.files[0].workspaceRelativePath = workspaceRelativePath;
      input.plan.files[0].fileLabel = workspaceRelativePath;

      const result = evaluateControlledAgentMultifilePatchPlan(input);

      expect(result.state).toMatch(/blocked|rejected/);
      expect(resultText(result)).not.toContain(workspaceRelativePath);
    }
  });

  it("blocks unsupported create delete rename move chmod binary and symlink operations", () => {
    for (const operation of ["create", "delete", "rename", "move", "chmod", "binary", "symlink"]) {
      const input = plan();
      input.plan.files[0].edits[0].operation = operation;

      const result = evaluateControlledAgentMultifilePatchPlan(input);

      expect(result.state).toBe("blocked");
      expect(result.diagnostics[0]?.code).toBe("unsupported_operation");
    }
  });

  it("blocks missing expected pre-edit hashes", () => {
    const input = plan();
    delete input.plan.files[0].expectedPreEditHash;

    const result = evaluateControlledAgentMultifilePatchPlan(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics[0]?.code).toBe("missing_hash");
  });

  it("blocks over-budget files edits and replacement bytes", () => {
    const overFiles = plan();
    overFiles.limits.maxFiles = 1;

    const overEdits = plan();
    overEdits.limits.maxEdits = 1;

    const overBytes = plan();
    overBytes.limits.maxTotalReplacementBytes = 100;

    for (const input of [overFiles, overEdits, overBytes]) {
      const result = evaluateControlledAgentMultifilePatchPlan(input);

      expect(result.state).toBe("blocked");
      expect(result.diagnostics[0]?.code).toBe("over_budget");
    }
  });

  it("blocks assistant apply authority and command provider tool fields", () => {
    for (const mutate of [
      (input: Record<string, any>) => {
        input.applyAuthority.assistantMintedApplyAllowed = true;
      },
      (input: Record<string, any>) => {
        input.command = "npm test";
      },
      (input: Record<string, any>) => {
        input.providerPayload = { model: "example" };
      },
      (input: Record<string, any>) => {
        input.toolCall = { name: "apply_patch" };
      },
    ]) {
      const input = plan();
      mutate(input);

      const result = evaluateControlledAgentMultifilePatchPlan(input);

      expect(result.state).toBe("blocked");
      expect(resultText(result)).not.toContain("npm test");
      expect(resultText(result)).not.toContain("apply_patch");
    }
  });
});
