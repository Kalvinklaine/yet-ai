import { describe, expect, it } from "vitest";
import { createControlledExecutionContextBundleSnapshot } from "./controlledExecutionContextBundle";
import type { ExplicitContextBundleItem } from "./activeEditorContext";
import type { ActiveFileExcerptAttachment } from "../bridge/bridgeAdapter";

describe("controlledExecutionContextBundle", () => {
  it("normalizes only explicit selected inputs into a frozen sanitized summary", () => {
    const rawSecret = "access_token=" + "x".repeat(64);
    const snapshot = createControlledExecutionContextBundleSnapshot({
      explicitContextItems: [workspaceSnippet("apps/gui/src/App.tsx", `function ChatComposer() { return "${rawSecret}"; }`)],
    });

    expect(snapshot.authority).toBe("explicit_execution_context_snapshot");
    expect(snapshot.itemCount).toBe(1);
    expect(snapshot.totalCharacters).toBeGreaterThan(0);
    expect(snapshot.redacted).toBe(true);
    expect(snapshot.summary).toContain("Frozen execution context: 1 explicit item");
    expect(snapshot.summary).toContain("project snippet apps/gui/src/App.tsx");
    expect(snapshot.summary).not.toContain(rawSecret);
    expect(snapshot.summary).not.toContain("access_token");
    expect(snapshot.labels.join("\n")).not.toContain(rawSecret);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
  });

  it("bounds item count and label length without raw prompt or replacement text", () => {
    const snapshot = createControlledExecutionContextBundleSnapshot({
      explicitContextItems: [
        workspaceSnippet("src/one.ts", "one".repeat(10)),
        workspaceSnippet("src/two.ts", "two".repeat(10)),
        workspaceSnippet("src/three.ts", "three".repeat(10)),
      ],
      maxItems: 2,
      maxLabelCharacters: 70,
    });

    expect(snapshot.itemCount).toBe(2);
    expect(snapshot.omittedItemCount).toBe(1);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.labels.every((label) => label.length <= 70)).toBe(true);
    expect(snapshot.summary).not.toContain("oneoneone");
    expect(snapshot.summary).not.toContain("twotwotwo");
  });

  it("can include active editor context as an explicit start snapshot input", () => {
    const snapshot = createControlledExecutionContextBundleSnapshot({
      activeFileExcerpt: activeExcerpt("src/visible.ts", "export const visible = true;"),
      includeActiveFileExcerpt: true,
      explicitContextItems: [],
    });

    expect(snapshot.itemCount).toBe(1);
    expect(snapshot.items[0]?.typeLabel).toBe("active file excerpt");
    expect(snapshot.summary).toContain("src/visible.ts");
    expect(snapshot.summary).not.toContain("export const visible");
  });
});

function workspaceSnippet(path: string, text: string): ExplicitContextBundleItem {
  return {
    kind: "workspace_snippet",
    workspaceRelativePath: path,
    languageId: "typescript",
    range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
    text,
    key: `workspace_snippet|${path}`,
  };
}

function activeExcerpt(path: string, text: string): ActiveFileExcerptAttachment {
  return {
    kind: "active_file_excerpt",
    source: "vscode",
    file: { displayPath: path, workspaceRelativePath: path, languageId: "typescript" },
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: text.length } },
    text,
    truncated: false,
  };
}
