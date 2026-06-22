import { describe, expect, it, vi } from "vitest";
import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { buildOneStepModelProposalPrompt } from "./modelProposalPrompt";

const contextItems: ExplicitContextBundleItem[] = [
  {
    kind: "active_editor",
    source: "vscode",
    file: { displayPath: "/Users/alice/private/repo/src/editor.ts", workspaceRelativePath: "src/editor.ts", languageId: "typescript" },
    selection: { startLine: 2, startCharacter: 1, endLine: 5, endCharacter: 3, text: "export const selected = true;" },
    key: "active-editor-1",
  },
  {
    kind: "workspace_snippet",
    workspaceRelativePath: "apps/gui/src/App.tsx",
    languageId: "tsx",
    range: { start: { line: 10, character: 0 }, end: { line: 20, character: 2 } },
    text: "function App() { return null; }",
    key: "snippet-1",
  },
];

function build(overrides: Partial<Parameters<typeof buildOneStepModelProposalPrompt>[0]> = {}) {
  return buildOneStepModelProposalPrompt({
    goal: "Patch the selected UI copy",
    contextItems,
    providerReadiness: "ready · OpenAI-compatible BYOK model",
    mode: "safe_edit",
    ...overrides,
  });
}

describe("modelProposalPrompt", () => {
  it("handles an empty goal without inventing work", () => {
    const result = build({ goal: "   " });

    expect(result.goalSummary).toBe("No coding goal was provided. Ask the user for a concrete goal before proposing edits.");
    expect(result.prompt).toContain("No coding goal was provided");
    expect(result.prompt).toContain("return prose explaining exactly what additional explicit context is needed");
  });

  it("handles no explicit context without implying hidden access", () => {
    const result = build({ contextItems: [] });

    expect(result.contextSummary).toEqual(["No explicit context is attached. Return prose naming the missing file excerpt, snippet, memory title, or verification output needed before proposing an edit."]);
    expect(result.prompt).toContain("Use only attached explicit context");
    expect(result.prompt).toContain("do not infer from hidden files");
    expect(result.prompt).toContain("Do not run tools, shell, git, searches, indexing, verification, file reads");
  });

  it("redacts secret-like goal and provider text", () => {
    const secret = "access_token=" + "x".repeat(64);
    const result = build({ goal: `Fix selected code with ${secret}`, providerReadiness: `ready ${secret}` });

    expect(result.prompt).toContain("[redacted]");
    expect(result.prompt).not.toContain(secret);
    expect(result.prompt).not.toContain("access_token");
  });

  it("redacts private paths in goal and context summaries", () => {
    const result = build({
      goal: "Fix /Users/alice/private/repo/src/editor.ts",
      contextItems: [
        {
          kind: "workspace_snippet",
          workspaceRelativePath: "/Users/alice/private/repo/src/secret.ts",
          languageId: "typescript",
          range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
          text: "export const privateValue = true;",
          key: "private-snippet",
        },
      ],
    });

    expect(result.prompt).toContain("[redacted]");
    expect(result.prompt).not.toContain("/Users/alice");
    expect(result.prompt).not.toContain("private/repo");
    expect(result.prompt).not.toContain("privateValue");
  });

  it("bounds oversized context summaries", () => {
    const longPath = `src/${"deep/".repeat(120)}file.ts`;
    const result = build({
      contextItems: [
        { kind: "workspace_snippet", workspaceRelativePath: longPath, languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "x", key: "long-1" },
        { kind: "workspace_snippet", workspaceRelativePath: "src/two.ts", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "x", key: "long-2" },
        { kind: "workspace_snippet", workspaceRelativePath: "src/three.ts", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "x", key: "long-3" },
        { kind: "workspace_snippet", workspaceRelativePath: "src/four.ts", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "x", key: "long-4" },
        { kind: "workspace_snippet", workspaceRelativePath: "src/five.ts", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "x", key: "long-5" },
      ],
    });

    expect(result.contextSummary).toHaveLength(5);
    expect(result.contextSummary[0].length).toBeLessThanOrEqual(361);
    expect(result.contextSummary[result.contextSummary.length - 1]).toContain("additional explicit context item(s) omitted");
  });

  it("marks provider not ready as prose-only", () => {
    const result = build({ providerReadiness: "missing credentials for selected model" });

    expect(result.prompt).toContain("The model is not send-ready");
    expect(result.prompt).toContain("Return exactly one of these:");
    expect(result.prompt).toContain("Prose explaining missing explicit context");
  });

  it("distinguishes demo mode from real BYOK provider wording", () => {
    const demo = build({ providerReadiness: "demo-local runtime preview ready" });
    const real = build({ providerReadiness: "ready · OpenAI-compatible BYOK model" });

    expect(demo.prompt).toContain("Demo mode is a local no-key preview");
    expect(demo.prompt).toContain("not production autonomy");
    expect(real.prompt).toContain("Use BYOK/local provider wording only");
    expect(real.prompt).toContain("must not require a hosted Yet AI backend");
  });

  it("adds local provider wording without leaking credentials", () => {
    const result = build({ providerReadiness: "Local Ollama model ready with api_key=" + "x".repeat(64) });

    expect(result.prompt).toContain("Local provider readiness depends on the user's local runtime/server");
    expect(result.prompt).toContain("do not expose or request credentials");
    expect(result.prompt).not.toContain("api_key");
  });

  it("includes strict safe-edit JSON and envelope constraints", () => {
    const result = build();

    expect(result.prompt).toContain("exactly one strict safe-edit proposal/envelope");
    expect(result.prompt).toContain("omit requestId");
    expect(result.prompt).toContain("include no unknown, tool, command, shell, git, execution, storage, search, or indexing fields");
    expect(result.prompt).toContain("no surrounding prose");
    expect(result.prompt).toContain("Do not apply edits");
  });

  it("does not write browser storage", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);

    build();

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
