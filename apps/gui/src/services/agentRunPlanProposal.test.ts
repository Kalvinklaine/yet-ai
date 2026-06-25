import { describe, expect, it } from "vitest";
import { evaluateAgentRunPlanProposal } from "./agentRunPlanProposal";

function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "2026-06-25",
    kind: "agent_run.multistep_plan",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    title: "Review a manual multi-step plan",
    summary: "Preview two bounded steps before the user chooses what to do next.",
    steps: [
      {
        id: "step-1",
        title: "Inspect visible state",
        summary: "Use already visible context to decide the next review point.",
        status: "preview_only",
        expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.ts"],
        riskLabels: ["May need follow-up review"],
      },
      {
        id: "step-2",
        title: "Prepare display metadata",
        summary: "Show a bounded preview without creating apply or run authority.",
        status: "preview_only",
        expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.test.ts"],
        riskLabels: [],
      },
    ],
    risks: ["Manual confirmation remains required"],
    expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.ts", "apps/gui/src/services/agentRunPlanProposal.test.ts"],
    verificationSuggestions: [
      {
        commandId: "gui-app-tests",
        label: "GUI app tests",
        description: "Run the focused GUI application test gate after explicit user selection.",
        riskLevel: "medium",
        expectedDuration: "Usually 5 to 10 minutes",
        cwdPolicyLabel: "Repository root selected by host",
        outputBoundLabel: "Sanitized tail only",
      },
    ],
    manualActionPolicy: {
      noAutoSend: true,
      noAutoApply: true,
      noAutoVerification: true,
      noAutoRollback: true,
      noHiddenReads: true,
      requiresExplicitUserAction: true,
    },
    ...overrides,
  };
}

function analyze(value: Record<string, unknown> | string) {
  return evaluateAgentRunPlanProposal(typeof value === "string" ? value : JSON.stringify(value));
}

describe("evaluateAgentRunPlanProposal", () => {
  it("parses a valid inert multi-step plan into sanitized display metadata", () => {
    const result = analyze(plan());

    expect(result.state).toBe("plan_detected");
    if (result.state !== "plan_detected") {
      throw new Error("expected plan_detected");
    }
    expect(result.plan).toEqual({
      kind: "agent_run.multistep_plan",
      title: "Review a manual multi-step plan",
      summary: "Preview two bounded steps before the user chooses what to do next.",
      steps: [
        {
          id: "step-1",
          title: "Inspect visible state",
          summary: "Use already visible context to decide the next review point.",
          expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.ts"],
          riskLabels: ["May need follow-up review"],
        },
        {
          id: "step-2",
          title: "Prepare display metadata",
          summary: "Show a bounded preview without creating apply or run authority.",
          expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.test.ts"],
          riskLabels: [],
        },
      ],
      risks: ["Manual confirmation remains required"],
      expectedTouchedFiles: ["apps/gui/src/services/agentRunPlanProposal.ts", "apps/gui/src/services/agentRunPlanProposal.test.ts"],
      verificationSuggestions: [{ commandId: "gui-app-tests", label: "GUI app tests" }],
    });
    expect(JSON.stringify(result)).not.toContain("requestId");
    expect(JSON.stringify(result)).not.toContain("executionAllowed");
  });

  it("rejects malformed plan JSON", () => {
    const result = analyze("{ \"kind\": \"agent_run.multistep_plan\",");

    expect(result.state).toBe("plan_rejected");
    expect(result.diagnostics[0]?.code).toBe("malformed_input");
  });

  it("rejects unsafe command cwd and env metadata", () => {
    for (const extra of [{ command: "npm test" }, { cwd: "/Users/alice/project" }, { env: { TOKEN: "hidden" } }]) {
      const result = analyze(plan(extra));

      expect(result.state).toBe("blocked");
      expect(JSON.stringify(result)).not.toContain("npm test");
      expect(JSON.stringify(result)).not.toContain("/Users/alice");
      expect(JSON.stringify(result)).not.toContain("TOKEN");
    }
  });

  it("rejects private path labels without leaking the path", () => {
    const result = analyze(plan({ expectedTouchedFiles: ["/Users/alice/project/src/file.ts"] }));

    expect(result.state).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("/Users/alice");
  });

  it("rejects auto-apply flags", () => {
    const result = analyze(plan({ autoApply: true }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics[0]?.message).toContain("authority");
  });

  it("rejects raw diff and file body metadata", () => {
    for (const extra of [{ rawDiff: "diff --git a/file b/file" }, { fileBody: "const secret = true;" }]) {
      const result = analyze(plan(extra));

      expect(result.state).toBe("blocked");
      expect(result.diagnostics[0]?.message).toMatch(/raw content|authority/);
      expect(JSON.stringify(result)).not.toContain("diff --git");
      expect(JSON.stringify(result)).not.toContain("const secret");
    }
  });

  it("rejects oversized text", () => {
    const result = analyze(plan({ summary: "x".repeat(361) }));

    expect(result.state).toBe("plan_rejected");
    expect(result.diagnostics[0]?.code).toBe("unsafe_metadata");
  });

  it("treats normal non-plan assistant response as normal response", () => {
    const result = analyze("I can outline this in prose, but I am not returning plan JSON.");

    expect(result.state).toBe("normal_response");
  });
});
