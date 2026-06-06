import { describe, expect, it } from "vitest";
import type { HostContextSnapshotPayload } from "../bridge/bridgeAdapter";
import { activeEditorContextUsability, activeEditorSourceLabel, attachedContextFileLabel, attachedContextSummary, boundedContextPreview, classifyBoundedContextPreview, formatSelectionRange, hasUsableAttachedContext, rangeFromContextSelection } from "./activeEditorContext";

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

  it("uses safe source labels", () => {
    expect(activeEditorSourceLabel("vscode")).toBe("vscode");
    expect(activeEditorSourceLabel("token-host")).toBe("unknown host");
    expect(activeEditorSourceLabel(undefined)).toBe("unknown host");
  });
});
