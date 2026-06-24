import { describe, expect, it } from "vitest";
import type { HostContextSnapshotPayload } from "../bridge/bridgeAdapter";
import { activeEditorContextUsability, activeEditorSourceLabel, activeFileExcerptPreview, activeFileExcerptSummary, activeFileExcerptToBundleItem, activeFileExcerptToChatContext, addExplicitContextBundleItem, explicitContextBundleMaxItems, explicitContextBundleToChatContext, attachedContextFileLabel, attachedContextRequiresAcknowledgement, attachedContextSummary, boundedContextPreview, classifyBoundedContextPreview, formatSelectionRange, hasUsableAttachedContext, rangeFromContextSelection, summarizeExplicitContextBundleItem, workspaceSnippetToBundleItem, projectMemoryToBundleItem } from "./activeEditorContext";

const baseContext: HostContextSnapshotPayload = { kind: "active_editor", source: "vscode" };

describe("activeEditorContext", () => {
  it("classifies no active editor context as unusable", () => {
    expect(activeEditorContextUsability(undefined)).toBe("none");
    expect(hasUsableAttachedContext(baseContext)).toBe(false);
    expect(attachedContextFileLabel(baseContext)).toBe("Untitled editor");
  });

  it("classifies file-only context and formats safe labels", () => {
    const context: HostContextSnapshotPayload = {
      ...baseContext,
      file: { displayPath: "src/App.tsx", workspaceRelativePath: "apps/gui/src/App.tsx", languageId: "typescriptreact" },
    };

    expect(activeEditorContextUsability(context)).toBe("file");
    expect(hasUsableAttachedContext(context)).toBe(true);
    expect(attachedContextFileLabel(context)).toBe("src/App.tsx (apps/gui/src/App.tsx)");
    expect(attachedContextSummary(context)).toBe("vscode apps/gui/src/App.tsx");
  });

  it("classifies selections with a range and converts reveal ranges", () => {
    const selection = { startLine: 2, startCharacter: 1, endLine: 4, endCharacter: 8, text: "selected code" };
    expect(activeEditorContextUsability({ ...baseContext, selection })).toBe("selection");
    expect(formatSelectionRange(selection)).toBe("2:1-4:8");
    expect(rangeFromContextSelection(selection)).toEqual({ start: { line: 2, character: 1 }, end: { line: 4, character: 8 } });
  });

  it("does not produce reveal ranges for invalid or missing ranges", () => {
    expect(rangeFromContextSelection(undefined)).toBeUndefined();
    expect(rangeFromContextSelection({ startLine: 5, startCharacter: 1, endLine: 4, endCharacter: 1 })).toBeUndefined();
    expect(rangeFromContextSelection({ startLine: 5, startCharacter: 2 })).toBeUndefined();
    expect(formatSelectionRange(undefined)).toBe("unknown range");
  });

  it("bounds huge selection previews", () => {
    const preview = classifyBoundedContextPreview("abcd ".repeat(200));

    expect(preview.truncated).toBe(true);
    expect(preview.redacted).toBe(false);
    expect(preview.text.endsWith("…")).toBe(true);
    expect(preview.text.length).toBeLessThanOrEqual(241);
  });

  it("redacts secret-like selection previews and keeps raw selected text out of display output", () => {
    const rawSecret = "sk-proj-1234567890abcdef";
    const preview = classifyBoundedContextPreview(`const key = "${rawSecret}";`);

    expect(preview.redacted).toBe(true);
    expect(preview.text).toContain("[redacted]");
    expect(preview.text).not.toContain(rawSecret);
    expect(boundedContextPreview(`Authorization: Bearer ${rawSecret}`)).not.toContain(rawSecret);
  });

  it("requires acknowledgement for redacted or truncated selected text previews but not safe short previews", () => {
    expect(attachedContextRequiresAcknowledgement({ ...baseContext, selection: { text: "safe short selected text" } })).toBe(false);
    expect(attachedContextRequiresAcknowledgement({ ...baseContext, selection: { text: "Authorization: Bearer sk-proj-1234567890abcdef" } })).toBe(true);
    expect(attachedContextRequiresAcknowledgement({ ...baseContext, selection: { text: "safe long text ".repeat(100) } })).toBe(true);
  });

  it("formats active-file excerpt metadata and converts it to chat context", () => {
    const attachment = {
      kind: "active_file_excerpt" as const,
      source: "jetbrains" as const,
      file: { displayPath: "src/Main.kt", workspaceRelativePath: "src/Main.kt", languageId: "kotlin" },
      range: { start: { line: 3, character: 2 }, end: { line: 8, character: 1 } },
      text: "fun greet() = \"hello\"",
      truncated: false,
    };

    expect(activeFileExcerptSummary(attachment)).toBe("jetbrains src/Main.kt");
    expect(activeFileExcerptPreview(attachment)).toMatchObject({
      fileLabel: "src/Main.kt",
      language: "kotlin",
      range: "3:2-8:1",
      characters: 21,
      text: "fun greet() = \"hello\"",
      redacted: false,
      truncated: false,
      hostTruncated: false,
    });
    expect(activeFileExcerptToChatContext(attachment)).toEqual({
      kind: "active_editor",
      source: "jetbrains",
      file: attachment.file,
      selection: { startLine: 3, startCharacter: 2, endLine: 8, endCharacter: 1, text: attachment.text },
    });
  });

  it("builds explicit context bundle items with dedupe and max limit", () => {
    const attachment = {
      kind: "active_file_excerpt" as const,
      source: "vscode" as const,
      file: { displayPath: "src/A.ts", workspaceRelativePath: "src/A.ts", languageId: "typescript" },
      range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
      text: "export const a = 1;",
      truncated: false,
    };
    const item = activeFileExcerptToBundleItem(attachment);
    const duplicate = activeFileExcerptToBundleItem(attachment);
    const different = Array.from({ length: explicitContextBundleMaxItems }, (_, index) => activeFileExcerptToBundleItem({ ...attachment, file: { ...attachment.file, workspaceRelativePath: `src/${index}.ts` }, text: `export const value${index} = ${index};` }));

    expect(item.key).toBe(duplicate.key);
    expect(addExplicitContextBundleItem([item], duplicate)).toEqual([item]);
    expect(different.reduce((items, next) => addExplicitContextBundleItem(items, next), [] as typeof different)).toHaveLength(explicitContextBundleMaxItems);
    expect(addExplicitContextBundleItem(different, item)).toHaveLength(explicitContextBundleMaxItems);
    expect(explicitContextBundleToChatContext([item])).toEqual({
      kind: "explicit_context_bundle",
      items: [{
        kind: "active_editor",
        source: "vscode",
        file: attachment.file,
        selection: { startLine: 1, startCharacter: 0, endLine: 2, endCharacter: 0, text: attachment.text },
      }],
    });
  });

  it("summarizes explicit context bundle items with sanitized metadata", () => {
    const active = activeFileExcerptToBundleItem({
      kind: "active_file_excerpt",
      source: "vscode",
      file: { displayPath: "/Users/alice/private/src/editor.ts", workspaceRelativePath: "src/editor.ts", languageId: "typescript" },
      range: { start: { line: 3, character: 1 }, end: { line: 4, character: 2 } },
      text: "export const value = 1;",
      truncated: false,
    });
    const snippet = workspaceSnippetToBundleItem({
      workspaceRelativePath: "apps/gui/src/App.tsx",
      languageId: "tsx",
      range: { start: { line: 10, character: 0 }, end: { line: 12, character: 2 } },
      text: "function App() { return null; }",
    });
    const memory = projectMemoryToBundleItem({
      kind: "project_memory",
      noteId: "mem-1",
      title: "Architecture note",
      text: "Local memory body with access_token=" + "x".repeat(64),
      tags: ["architecture"],
      taskLabel: "Task ABC",
      sessionLabel: "Session 123",
      attachTraceLabel: "memory-attach-chat-001-mem-1",
    });
    const verification = {
      kind: "verification_output" as const,
      commandId: "repository-check" as const,
      status: "failed" as const,
      exitCode: 1,
      outputTail: "failed with access_token=" + "y".repeat(64),
      truncated: true,
      key: "verification-1",
    };

    expect(summarizeExplicitContextBundleItem(active).line).toContain("active file excerpt · src/editor.ts · vscode · typescript · range 3:1-4:2 · 23 chars · preview complete · redacted no");
    expect(summarizeExplicitContextBundleItem(snippet).line).toContain("project snippet · apps/gui/src/App.tsx · tsx · range 10:0-12:2 · 31 chars · preview complete · redacted no");
    expect(summarizeExplicitContextBundleItem(memory).line).toContain("project memory · Architecture note · note mem-1 · task Task ABC · session Session 123 · trace memory-attach-chat-001-mem-1 · 100 chars · tags architecture · preview complete · redacted yes");
    expect(summarizeExplicitContextBundleItem(verification).line).toContain("verification output · repository-check · failed · exit 1 · 89 chars · host truncated yes · preview complete · redacted yes");
    expect(summarizeExplicitContextBundleItem(memory).line).not.toContain("access_token");
    expect(summarizeExplicitContextBundleItem(verification).line).not.toContain("access_token");
  });

  it("redacts active-file excerpt previews and reports host truncation", () => {
    const rawSecret = "sk-proj-1234567890abcdef";
    const preview = activeFileExcerptPreview({
      kind: "active_file_excerpt",
      source: "vscode",
      file: { workspaceRelativePath: "src/main.ts" },
      range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
      text: `const key = "${rawSecret}";`,
      truncated: true,
    });

    expect(preview.redacted).toBe(true);
    expect(preview.hostTruncated).toBe(true);
    expect(preview.text).toContain("[redacted]");
    expect(preview.text).not.toContain(rawSecret);
  });

  it("uses safe source labels", () => {
    expect(activeEditorSourceLabel("vscode")).toBe("vscode");
    expect(activeEditorSourceLabel("token-host")).toBe("unknown host");
    expect(activeEditorSourceLabel(undefined)).toBe("unknown host");
  });
});
