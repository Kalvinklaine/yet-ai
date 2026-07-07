import { describe, expect, it } from "vitest";
import validFixture from "../../../../packages/contracts/examples/engine/controlled-agent-patch-plan.json";
import autoApplyFixture from "../../../../packages/contracts/examples-invalid/engine/controlled-agent-patch-plan-auto-apply.json";
import createOperationFixture from "../../../../packages/contracts/examples-invalid/engine/controlled-agent-patch-plan-create-operation.json";
import rawDiffFixture from "../../../../packages/contracts/examples-invalid/engine/controlled-agent-patch-plan-raw-diff.json";
import { evaluateControlledAgentPatchPlanPreview } from "./controlledAgentPatchPlanPreview";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("evaluateControlledAgentPatchPlanPreview", () => {
  it("accepts the review-only patch plan fixture as bounded sanitized preview rows", () => {
    const result = evaluateControlledAgentPatchPlanPreview(clone(validFixture));

    expect(result.state).toBe("ready");
    if (result.state !== "ready") {
      throw new Error("expected ready patch plan preview");
    }
    expect(result.preview).toEqual({
      kind: "controlled_agent_patch_plan",
      planId: "patch-plan-s102",
      workspaceLabel: "controlled worktree",
      summary: "One bounded replacement candidate is ready for review.",
      rows: [
        {
          operation: "replace",
          fileLabel: "docs/safe-copy.md",
          workspaceRelativePath: "docs/safe-copy.md",
          lineRangeLabel: "lines 8-10",
          replacementLabel: "bounded wording replacement",
          replacementByteCountLabel: "96 bytes",
          expectedContentHashLabel: "sha256:bbbbbbbbbbb…",
          requiresUserApply: true,
        },
      ],
      metadataOnly: true,
      reviewOnly: true,
      dryRunOnly: true,
      automaticApplyAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain("rawDiff");
    expect(JSON.stringify(result)).not.toContain("rawReplacement");
  });

  it("accepts JSON text input for the valid patch plan fixture", () => {
    const result = evaluateControlledAgentPatchPlanPreview(JSON.stringify(validFixture));

    expect(result.state).toBe("ready");
  });

  it("rejects malformed input", () => {
    const result = evaluateControlledAgentPatchPlanPreview("{\"kind\":\"controlled_agent_patch_plan\",");

    expect(result.state).toBe("rejected");
    expect(result.diagnostics[0]?.code).toBe("malformed_input");
  });

  it("blocks auto-apply and execution authority claims", () => {
    const result = evaluateControlledAgentPatchPlanPreview(clone(autoApplyFixture));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics[0]?.code).toMatch(/unsupported_authority|unsafe_metadata/);
  });

  it("blocks raw diff and file body metadata without leaking raw content", () => {
    for (const extra of [clone(rawDiffFixture), { ...clone(validFixture), patchPlan: { ...(clone(validFixture) as any).patchPlan, fileBody: "const secret = true;" } }]) {
      const result = evaluateControlledAgentPatchPlanPreview(extra);

      expect(result.state).toBe("blocked");
      expect(result.diagnostics[0]?.message).toMatch(/raw diff|raw file|raw content|unsupported/i);
      expect(JSON.stringify(result)).not.toContain("diff body");
      expect(JSON.stringify(result)).not.toContain("const secret");
    }
  });

  it("blocks create operation and unsafe operation authority", () => {
    const result = evaluateControlledAgentPatchPlanPreview(clone(createOperationFixture));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics[0]?.code).toMatch(/unsupported_authority|unsupported_operation|unsafe_metadata/);
    expect(JSON.stringify(result)).not.toContain("docs/new-copy.md");
  });

  it("rejects unsafe non-existing replacement claims without exposing private paths", () => {
    const input = clone(validFixture) as any;
    input.patchPlan.candidates[0].workspaceRelativePath = "/Users/alice/project/secret.md";

    const result = evaluateControlledAgentPatchPlanPreview(input);

    expect(result.state).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("/Users/alice");
  });
});
