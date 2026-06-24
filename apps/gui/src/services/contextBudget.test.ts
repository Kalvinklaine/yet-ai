import { describe, expect, it } from "vitest";
import type { ActiveFileExcerptAttachment } from "../bridge/bridgeAdapter";
import type { ExplicitContextBundleItem } from "./activeEditorContext";
import { buildContextBudgetSummary } from "./contextBudget";

const activeExcerpt: ActiveFileExcerptAttachment = {
  kind: "active_file_excerpt",
  source: "vscode",
  file: { displayPath: "src/active.ts", workspaceRelativePath: "src/active.ts", languageId: "typescript" },
  range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
  text: "export const active = true;",
  truncated: false,
};

const activeItem: ExplicitContextBundleItem = {
  kind: "active_editor",
  source: "vscode",
  file: { displayPath: "src/bundle.ts", workspaceRelativePath: "src/bundle.ts", languageId: "typescript" },
  selection: { startLine: 5, startCharacter: 0, endLine: 6, endCharacter: 1, text: "const bundled = true;" },
  key: "active",
};

const snippetItem: ExplicitContextBundleItem = {
  kind: "workspace_snippet",
  workspaceRelativePath: "apps/gui/src/App.tsx",
  languageId: "tsx",
  range: { start: { line: 10, character: 0 }, end: { line: 12, character: 2 } },
  text: "function App() { return null; }",
  key: "snippet",
};

const memoryItem: ExplicitContextBundleItem = {
  kind: "project_memory",
  noteId: "mem-1",
  title: "Architecture note access_token=" + "x".repeat(64),
  text: "Keep provider settings local only.",
  tags: ["architecture"],
  key: "memory",
};

const verificationItem: ExplicitContextBundleItem = {
  kind: "verification_output",
  commandId: "gui-app-tests",
  status: "failed",
  exitCode: 1,
  outputTail: "failed test summary\nexpected true to be false",
  truncated: false,
  key: "verification",
};

describe("contextBudget service", () => {
  it("summarizes goal active file snippet memory verification and display-only proposal metadata without raw bodies", () => {
    const summary = buildContextBudgetSummary({
      goal: "Fix the guided context panel",
      activeFileExcerpt: activeExcerpt,
      includeActiveFileExcerpt: true,
      explicitContextItems: [activeItem, snippetItem, memoryItem, verificationItem],
      includeExplicitContextBundle: true,
      proposalMetadata: [{ label: "Edit proposal metadata · Update panel", charCount: 19, itemCount: 2 }],
    });

    expect(summary.totalIncludedItems).toBe(5);
    expect(summary.totalIncludedCharacters).toBe(159);
    expect(summary.sources.map((source) => source.kind)).toEqual(["goal", "active_file_excerpt", "explicit_context_bundle"]);
    expect(summary.localReviewMetadata).toEqual([{ label: "Edit proposal metadata · Update panel", charCount: 19, itemCount: 2, sent: false }]);
    expect(summary.labels).toEqual(expect.arrayContaining([
      expect.stringContaining("project snippet · apps/gui/src/App.tsx"),
      expect.stringContaining("project memory · Architecture note [redacted]"),
      expect.stringContaining("verification output · gui-app-tests · failed"),
    ]));
    expect(summary.labels.join("\n")).not.toContain("vscode src/active.ts");
    expect(summary.labels.join("\n")).not.toContain("Edit proposal metadata · Update panel");
    expect(summary.labels.join("\n")).not.toContain("expected true to be false");
    expect(summary.labels.join("\n")).not.toContain("Keep provider settings local only");
    expect(summary.labels.join("\n")).not.toContain("function App() { return null; }");
    expect(summary.labels.join("\n")).not.toContain("access_token");
    expect(summary.warnings.map((warning) => warning.code)).not.toContain("too_many_items");
  });

  it("warns for large context omitted and excluded items", () => {
    const summary = buildContextBudgetSummary({
      goal: "Large context task",
      activeFileExcerpt: { ...activeExcerpt, text: "a".repeat(80) },
      includeActiveFileExcerpt: false,
      explicitContextItems: [{ ...snippetItem, text: "b".repeat(160) }],
      includeExplicitContextBundle: true,
      excludedItemCount: 2,
      largeContextWarningCharacters: 100,
    });

    expect(summary.totalIncludedCharacters).toBe(178);
    expect(summary.omittedItemCount).toBe(1);
    expect(summary.excludedItemCount).toBe(2);
    expect(summary.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "large_context" }),
      expect.objectContaining({ code: "omitted_context" }),
      expect.objectContaining({ code: "excluded_context" }),
    ]));
  });

  it("matches send precedence when explicit bundle and standalone active excerpt are both selected", () => {
    const summary = buildContextBudgetSummary({
      goal: "Fix send precedence",
      activeFileExcerpt: activeExcerpt,
      includeActiveFileExcerpt: true,
      explicitContextItems: [snippetItem],
      includeExplicitContextBundle: true,
    });

    expect(summary.totalIncludedItems).toBe(2);
    expect(summary.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "active_file_excerpt", included: false }),
      expect.objectContaining({ kind: "explicit_context_bundle", included: true, itemCount: 1 }),
    ]));
    expect(summary.omittedItemCount).toBe(1);
    expect(summary.labels.join("\n")).toContain("project snippet · apps/gui/src/App.tsx");
    expect(summary.labels.join("\n")).not.toContain("src/active.ts");
    expect(summary.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "omitted_context" })]));
  });

  it("does not list omitted bundle or active excerpt labels as sent", () => {
    const summary = buildContextBudgetSummary({
      goal: "Review context",
      activeFileExcerpt: activeExcerpt,
      includeActiveFileExcerpt: false,
      explicitContextItems: [snippetItem],
      includeExplicitContextBundle: false,
    });

    expect(summary.totalIncludedItems).toBe(1);
    expect(summary.omittedItemCount).toBe(2);
    expect(summary.labels).toEqual([]);
    expect(summary.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "active_file_excerpt", included: false }),
      expect.objectContaining({ kind: "explicit_context_bundle", included: false }),
    ]));
  });

  it("warns on actual context item count without counting goal or proposal metadata", () => {
    const summary = buildContextBudgetSummary({
      goal: "Task goal should not count toward context max",
      explicitContextItems: [activeItem, snippetItem, memoryItem, verificationItem],
      includeExplicitContextBundle: true,
      proposalMetadata: [{ label: "Edit proposal metadata · four edits", itemCount: 4, charCount: 40 }],
      maxItems: 4,
    });

    expect(summary.totalIncludedItems).toBe(5);
    expect(summary.totalIncludedCharacters).toBe(176);
    expect(summary.localReviewMetadata).toEqual([{ label: "Edit proposal metadata · four edits", itemCount: 4, charCount: 40, sent: false }]);
    expect(summary.labels).toHaveLength(4);
    expect(summary.labels.join("\n")).not.toContain("Edit proposal metadata · four edits");
    expect(summary.warnings.map((warning) => warning.code)).not.toContain("too_many_items");
  });

  it("keeps computation deterministic and local for empty context", () => {
    const first = buildContextBudgetSummary({ goal: "", explicitContextItems: [], includeExplicitContextBundle: true });
    const second = buildContextBudgetSummary({ goal: "", explicitContextItems: [], includeExplicitContextBundle: true });

    expect(first).toEqual(second);
    expect(first).toEqual({
      totalIncludedItems: 0,
      totalIncludedCharacters: 0,
      omittedItemCount: 0,
      excludedItemCount: 0,
      sources: [{ kind: "goal", label: "Task goal", itemCount: 0, charCount: 0, included: false }],
      localReviewMetadata: [],
      labels: [],
      warnings: [],
    });
  });
});
