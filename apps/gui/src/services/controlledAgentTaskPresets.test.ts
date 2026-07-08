import { describe, expect, it } from "vitest";
import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { buildControlledAgentTaskPresetGuidance, controlledAgentTaskPresets, validateControlledAgentTaskPresetConfig, type ControlledAgentTaskPresetId } from "./controlledAgentTaskPresets";

const presetIds: ControlledAgentTaskPresetId[] = ["fix-small-bug", "add-focused-test", "refactor-small-function", "explain-selected-code", "improve-copy-or-typing"];

const contextItems: ExplicitContextBundleItem[] = [
  {
    kind: "active_editor",
    source: "vscode",
    file: { displayPath: "/Users/alice/private/project/src/bug.ts", workspaceRelativePath: "src/bug.ts", languageId: "typescript" },
    selection: { startLine: 4, startCharacter: 2, endLine: 8, endCharacter: 1, text: "export const visible = true;" },
    key: "active-1",
  },
  {
    kind: "workspace_snippet",
    workspaceRelativePath: "src/bug.test.ts",
    languageId: "typescript",
    range: { start: { line: 10, character: 0 }, end: { line: 18, character: 0 } },
    text: "test('visible behavior', () => undefined);",
    key: "snippet-1",
  },
  {
    kind: "project_memory",
    noteId: "mem-1",
    title: "Bug boundary note",
    text: "Memory body should not be copied into preset prompt guidance.",
    tags: ["bounded"],
    key: "memory-1",
  },
  {
    kind: "verification_output",
    commandId: "gui-app-tests",
    status: "failed",
    exitCode: 1,
    outputTail: "Failure body should not be copied into preset prompt guidance.",
    truncated: false,
    key: "verification-1",
  },
];

describe("controlledAgentTaskPresets service", () => {
  it("defines the five S121 safe presets", () => {
    expect(controlledAgentTaskPresets.map((preset) => preset.presetId)).toEqual(presetIds);
    expect(controlledAgentTaskPresets.every((preset) => preset.maxFiles >= 0 && preset.maxFiles <= 3)).toBe(true);
  });

  it.each(presetIds)("builds bounded draft guidance for %s", (presetId) => {
    const guidance = buildControlledAgentTaskPresetGuidance(presetId, {
      goal: "Fix the selected visible behavior",
      contextItems,
      selectedSearchResultCount: 1,
      selectedMemoryCount: 1,
      verificationEvidenceCount: 1,
    });

    expect(guidance.kind).toBe("controlled_agent_task_preset_guidance");
    expect(guidance.authority).toBe("draft_guidance_only");
    expect(guidance.presetId).toBe(presetId);
    expect(guidance.useful).toBe(true);
    expect(guidance.diagnostics).toEqual([]);
    expect(guidance.contextSummary).toMatchObject({ totalCount: 4, activeEditorCount: 1, snippetCount: 1, memoryCount: 2, verificationCount: 2, selectedSearchResultCount: 2 });
    expect(guidance.draftPrompt).toContain("Fix the selected visible behavior");
    expect(guidance.draftPrompt).toContain("Use only the explicit selected context listed above");
    expect(guidance.draftPrompt).toContain("Do not auto-send, auto-search, auto-attach context");
    expect(guidance.draftPrompt).toContain("call providers");
    expect(guidance.draftPrompt).toContain("run shell or git commands");
    expect(guidance.draftPrompt).not.toContain("export const visible");
    expect(guidance.draftPrompt).not.toContain("Memory body should not");
    expect(guidance.draftPrompt).not.toContain("Failure body should not");
    expect(guidance.policy).toEqual({
      canAutoSend: false,
      canAutoSearch: false,
      canAutoAttachContext: false,
      canAutoApply: false,
      canAutoRunVerification: false,
      canCallProviders: false,
      canReadHiddenFiles: false,
      canUseFreeformCommands: false,
    });
  });

  it("gives preset-specific next steps", () => {
    expect(buildControlledAgentTaskPresetGuidance("fix-small-bug", { contextItems }).recommendedNextSteps.join("\n")).toContain("likely cause");
    expect(buildControlledAgentTaskPresetGuidance("add-focused-test", { contextItems }).recommendedNextSteps.join("\n")).toContain("focused test scenarios");
    expect(buildControlledAgentTaskPresetGuidance("refactor-small-function", { contextItems }).recommendedNextSteps.join("\n")).toContain("one selected function");
    expect(buildControlledAgentTaskPresetGuidance("explain-selected-code", { contextItems }).recommendedNextSteps.join("\n")).toContain("explanation");
    expect(buildControlledAgentTaskPresetGuidance("improve-copy-or-typing", { contextItems }).recommendedNextSteps.join("\n")).toContain("copy or typing improvement");
  });

  it("does not imply mutation or verification authority for explain preset", () => {
    const guidance = buildControlledAgentTaskPresetGuidance("explain-selected-code", { goal: "Explain the selected code", contextItems });

    expect(guidance.draftPrompt).toContain("This preset is explanation-only. Do not propose workspace mutations.");
    expect(guidance.draftPrompt).toContain("Do not suggest running verification for this explanation-only preset");
  });

  it("asks for explicit context when none is selected", () => {
    const guidance = buildControlledAgentTaskPresetGuidance("fix-small-bug", { goal: "Find the bug" });

    expect(guidance.contextSummary.totalCount).toBe(0);
    expect(guidance.draftPrompt).toContain("No explicit context is selected yet.");
    expect(guidance.recommendedNextSteps.join("\n")).toContain("Attach explicit selected context first");
    expect(guidance.draftPrompt).toContain("do not ask the assistant to read hidden files or search automatically");
  });

  it("sanitizes private paths and secrets from goal and labels", () => {
    const secret = "sk-proj-" + "x".repeat(32);
    const guidance = buildControlledAgentTaskPresetGuidance("fix-small-bug", {
      goal: `Fix /Users/alice/private/project with ${secret}`,
      contextItems: [
        {
          kind: "workspace_snippet",
          workspaceRelativePath: "/Users/alice/private/project/src/secret.ts",
          languageId: "typescript",
          range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
          text: secret,
          key: "secret-snippet",
        },
      ],
    });

    expect(guidance.draftPrompt).toContain("[redacted]");
    expect(guidance.draftPrompt).not.toContain(secret);
    expect(guidance.draftPrompt).not.toContain("/Users/alice");
    expect(guidance.draftPrompt).not.toContain("private/project");
  });

  it("rejects unsafe hidden read and hidden search claims", () => {
    const diagnostics = validateControlledAgentTaskPresetConfig({ contextSelection: { hiddenReadAllowed: true, hiddenSearchAllowed: true, summary: "use hidden search" } });

    expect(diagnostics.join("\n")).toContain("Unsafe preset flag rejected");
    expect(diagnostics.join("\n")).toContain("Unsafe preset text rejected");
  });

  it("rejects free-form command suggestions", () => {
    const diagnostics = validateControlledAgentTaskPresetConfig({ verification: { freeformCommandAllowed: true, allowedCommandMode: "freeform_shell", command: "npm test" } });

    expect(diagnostics.join("\n")).toContain("Unsafe preset flag rejected");
    expect(diagnostics.join("\n")).toContain("Unsafe command mode rejected");
    expect(diagnostics.join("\n")).toContain("Unsafe preset field rejected");
  });

  it("rejects broad mutation settings", () => {
    const diagnostics = validateControlledAgentTaskPresetConfig({ apply: { broadWorkspaceMutationAllowed: true, workspaceMutationScope: "entire_workspace", maxFiles: 99, summary: "broad workspace rewrite" } });

    expect(diagnostics.join("\n")).toContain("Unsafe preset flag rejected");
    expect(diagnostics.join("\n")).toContain("Unsafe workspace mutation scope rejected");
    expect(diagnostics.join("\n")).toContain("Unsafe broad file count rejected");
  });

  it("rejects raw payloads private paths and secrets", () => {
    const secret = "access_token=" + "x".repeat(64);
    const diagnostics = validateControlledAgentTaskPresetConfig({ proposal: { rawProviderPayloadStored: true, rawPrompt: `read /Users/alice/private ${secret}` } });

    expect(diagnostics.join("\n")).toContain("Unsafe preset flag rejected");
    expect(diagnostics.join("\n")).toContain("Unsafe preset field rejected");
    expect(diagnostics.join("\n")).toContain("Unsafe preset text rejected");
    expect(diagnostics.join("\n")).not.toContain(secret);
    expect(diagnostics.join("\n")).not.toContain("/Users/alice");
  });

  it("rejects production readiness claims and blocks draft usefulness", () => {
    const guidance = buildControlledAgentTaskPresetGuidance("fix-small-bug", { presetConfig: { claims: { productionReady: true, releaseReady: true, marketplaceReady: true } } });

    expect(guidance.useful).toBe(false);
    expect(guidance.diagnostics.join("\n")).toContain("Unsafe preset flag rejected");
    expect(guidance.recommendedNextSteps).toEqual(["Stop: the selected preset metadata is unsafe. Choose a safe preset before drafting a prompt."]);
    expect(guidance.draftPrompt).toContain("Unsafe preset metadata was detected");
  });
});
