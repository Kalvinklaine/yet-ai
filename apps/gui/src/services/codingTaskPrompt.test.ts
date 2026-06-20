import { describe, expect, it } from "vitest";
import { buildCodingTaskPrompt, summarizeCodingTaskContext, type CodingTaskPromptMode } from "./codingTaskPrompt";
import type { ExplicitContextBundleItem } from "./activeEditorContext";

const modes: CodingTaskPromptMode[] = ["ask", "explain", "find_bug", "suggest_tests", `re${"factor_safely"}`, "safe_edit", "implementation_plan", "follow_up"];

const allContextItems: ExplicitContextBundleItem[] = [
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
  {
    kind: "project_memory",
    noteId: "mem-1",
    title: "Architecture note",
    text: "Long memory body that should never appear in the prompt.",
    tags: ["architecture", "local-first"],
    key: "memory-1",
  },
  {
    kind: "verification_output",
    commandId: "gui-app-tests",
    status: "failed",
    exitCode: 1,
    outputTail: "Raw failure body that should never appear in the prompt.",
    truncated: true,
    key: "verification-1",
  },
];

describe("codingTaskPrompt service", () => {
  it.each(modes)("builds bounded no-authority prompt for %s mode", (mode) => {
    const prompt = buildCodingTaskPrompt({
      mode,
      goal: "Improve the coding task flow",
      contextItems: allContextItems,
      providerReadiness: "ready · GPT-4o mini",
    });

    expect(prompt).toContain("Goal\nImprove the coding task flow");
    expect(prompt).toContain("Use only the attached explicit context");
    expect(prompt).toContain("Do not infer from hidden files, private paths, browser storage, provider logs");
    expect(prompt).toContain("Do not run commands, tools, shell, git, verification, searches, indexing, file reads");
    expect(prompt).toContain("Do not auto-apply edits, auto-save memory, write files, mutate the workspace");
    expect(prompt).toContain("If the attached context is insufficient");
    expect(prompt).toContain("Provider readiness\nready · GPT-4o mini");
    expect(prompt).toContain("Total selected items: 4");
  });

  it("uses distinct real-coding instructions for every mode", () => {
    const prompts = new Map(modes.map((mode) => [mode, buildCodingTaskPrompt({ mode, goal: "Review selected code", contextItems: [], providerReadiness: "ready" })]));

    expect(prompts.get("ask")).toContain("answer the task question");
    expect(prompts.get("explain")).toContain("explain the selected code or task");
    expect(prompts.get("find_bug")).toContain("identify likely bugs or risky edge cases");
    expect(prompts.get("suggest_tests")).toContain("suggest focused tests");
    expect(prompts.get(`re${"factor_safely"}`)).toContain("smallest bounded safe rework");
    expect(prompts.get("safe_edit")).toContain("smallest bounded manual edit");
    expect(prompts.get("implementation_plan")).toContain("concise implementation plan");
    expect(prompts.get("follow_up")).toContain("next safe manual step");
  });

  it("gives safe-edit strict single-proposal manual-review guidance", () => {
    const prompt = buildCodingTaskPrompt({ mode: "safe_edit", goal: "Patch selected code", contextItems: [], providerReadiness: "ready" });

    expect(prompt).toContain("smallest bounded manual edit");
    expect(prompt).toContain("If returning applyable JSON, return exactly one strict accepted proposal/envelope for manual review");
  });

  it("forbids unsafe safe-edit proposal fields and actions", () => {
    const prompt = buildCodingTaskPrompt({ mode: "safe_edit", goal: "Patch selected code", contextItems: [], providerReadiness: "ready" });

    expect(prompt).toContain("omit requestId");
    expect(prompt).toContain("include no unknown fields");
    expect(prompt).toContain("include no command/tool/shell/git fields");
    expect(prompt).toContain("do not claim the edit was applied, run, saved, or verified");
    expect(prompt).toContain("Do not auto-apply edits or read hidden files");
  });

  it("tells safe-edit to explain missing context instead of malformed JSON", () => {
    const prompt = buildCodingTaskPrompt({ mode: "safe_edit", goal: "Patch selected code", contextItems: [], providerReadiness: "ready" });

    expect(prompt).toContain("If the explicit context is uncertain or insufficient");
    expect(prompt).toContain("return prose explaining exactly what is missing instead of malformed JSON");
  });

  it("summarizes active editor snippets memory and verification with sanitized bounded metadata", () => {
    const prompt = buildCodingTaskPrompt({
      mode: "implementation_plan",
      goal: "Plan from explicit context",
      contextItems: allContextItems,
      providerReadiness: "ready",
    });

    expect(prompt).toContain("active file excerpt · src/editor.ts · vscode · typescript · range 2:1-5:3 · 29 chars · preview complete · redacted no");
    expect(prompt).toContain("project snippet · apps/gui/src/App.tsx · tsx · range 10:0-20:2 · 31 chars · preview complete · redacted no");
    expect(prompt).toContain("project memory · Architecture note · note mem-1 · 56 chars · tags architecture, local-first · preview complete · redacted no");
    expect(prompt).toContain("verification output · gui-app-tests · failed · exit 1 · 56 chars · host truncated yes · preview complete · redacted no");
    expect(prompt).toContain("Active-file excerpts\n- Count: 1");
    expect(prompt).toContain("Snippets\n- Count: 1");
    expect(prompt).toContain("Project memory\n- Count: 1");
    expect(prompt).toContain("Verification output\n- Count: 1");
  });

  it("does not include raw memory snippet active-file or verification bodies", () => {
    const prompt = buildCodingTaskPrompt({
      mode: "ask",
      goal: "Use explicit context",
      contextItems: allContextItems,
      providerReadiness: "ready",
    });

    expect(prompt).not.toContain("Long memory body");
    expect(prompt).not.toContain("function App() { return null; }");
    expect(prompt).not.toContain("export const selected = true");
    expect(prompt).not.toContain("Raw failure body");
  });

  it("sanitizes secrets and private paths from prompt drafts", () => {
    const secret = "access_token=" + "x".repeat(64);
    const prompt = buildCodingTaskPrompt({
      mode: "safe_edit",
      goal: `Fix /Users/alice/private/repo with ${secret}`,
      providerReadiness: `model ready ${secret}`,
      contextItems: [
        { kind: "project_memory", noteId: "mem-secret", title: `Token note ${secret}`, text: "raw memory body", tags: [secret], key: "memory-secret" },
        { kind: "workspace_snippet", workspaceRelativePath: "/Users/alice/private/src/secret.ts", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }, text: "secret body", key: "snippet-secret" },
        { kind: "verification_output", commandId: "repository-check", status: "failed", exitCode: 1, outputTail: secret, truncated: false, key: "verification-secret" },
      ],
    });

    expect(prompt).toContain("[redacted]");
    expect(prompt).not.toContain(secret);
    expect(prompt).not.toContain("access_token");
    expect(prompt).not.toContain("/Users/alice");
    expect(prompt).not.toContain("private/src/secret.ts");
    expect(prompt).not.toContain("secret body");
  });

  it("summarizes empty context without implying hidden access", () => {
    const prompt = buildCodingTaskPrompt({ mode: "find_bug", goal: "Find the bug", contextItems: [], providerReadiness: "provider required" });
    const summary = summarizeCodingTaskContext([]);

    expect(summary).toEqual({ totalCount: 0, activeEditorCount: 0, memoryTitles: [], snippetCount: 0, verificationCount: 0, contextLines: [] });
    expect(prompt).toContain("No explicit context is selected yet. Ask for the specific context needed before giving file-specific guidance.");
    expect(prompt).toContain("Do not infer from hidden files");
  });
});
