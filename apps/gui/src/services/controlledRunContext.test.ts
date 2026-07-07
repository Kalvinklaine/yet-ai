import { describe, expect, it } from "vitest";
import { addControlledRunContextItem, buildControlledRunContextReport, clearControlledRunContextBundle, controlledRunContextLimits, createControlledRunContextBundle, isSafeWorkspaceRelativePath, summarizeControlledRunContextItem, validateControlledRunContextItem, type ControlledRunContextInput } from "./controlledRunContext";

const baseFragment: ControlledRunContextInput = {
  id: "ctx-1",
  sourceKind: "workspace_fragment",
  label: "src/service.ts lines 2-4",
  workspaceRelativePath: "src/service.ts",
  range: { startLine: 2, endLine: 4 },
  previewText: "export function service() {\n  return true;\n}",
  hostSurfaceLabel: "VS Code controlled context",
  draftId: "draft-1",
};

describe("controlledRunContext", () => {
  it("validates explicit user-selected workspace fragments with bounded metadata", () => {
    const result = validateControlledRunContextItem(baseFragment);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.item).toMatchObject({
      id: "ctx-1",
      sourceKind: "workspace_fragment",
      label: "src/service.ts lines 2-4",
      workspaceRelativePath: "src/service.ts",
      range: { startLine: 2, endLine: 4 },
      previewLineCount: 3,
      truncated: false,
      hostSurfaceLabel: "VS Code controlled context",
    });
    expect(result.item.previewByteCount).toBeGreaterThan(0);
    expect(result.item.key).toContain("workspace_fragment|src/service.ts|2-4");
  });

  it("accepts non-workspace explicit sources without requiring file paths", () => {
    const pasted = validateControlledRunContextItem({
      id: "paste-1",
      sourceKind: "pasted_text",
      label: "manual pasted reproduction",
      previewText: "The user pasted this short reproduction after review.",
      hostSurfaceLabel: "browser preview",
      truncated: true,
    });
    const verification = validateControlledRunContextItem({
      id: "verify-1",
      sourceKind: "verification_summary",
      label: "npm test controlledRunContext failed exit 1",
      previewText: "exit 1: expected true to be false",
    });
    const memory = validateControlledRunContextItem({
      id: "mem-1",
      sourceKind: "memory_summary",
      label: "architecture memory summary",
      previewText: "S100 context is one-shot and user selected.",
    });

    expect(pasted.ok).toBe(true);
    expect(verification.ok).toBe(true);
    expect(memory.ok).toBe(true);
  });

  it("requires valid ranges for fragments and active editor selections", () => {
    expect(validateControlledRunContextItem({ ...baseFragment, range: undefined }).ok).toBe(false);
    expect(validateControlledRunContextItem({ ...baseFragment, range: { startLine: 5, endLine: 4 } })).toMatchObject({ ok: false, reason: "invalid_range" });
    expect(validateControlledRunContextItem({ id: "active-1", sourceKind: "active_editor_selection", label: "active selection", previewText: "selected", range: { startLine: 1, endLine: 1 } }).ok).toBe(true);
    expect(validateControlledRunContextItem({ id: "active-2", sourceKind: "active_editor_selection", label: "active selection", previewText: "selected" })).toMatchObject({ ok: false, reason: "invalid_range" });
  });

  it("rejects hidden unsafe generated and dependency workspace paths", () => {
    const unsafePaths = [
      ".env",
      "src/.hidden/file.ts",
      "../src/app.ts",
      "/Users/alice/project/src/app.ts",
      "C:/Users/alice/project/src/app.ts",
      "node_modules/pkg/index.js",
      "apps/gui/dist/assets/app.js",
      "coverage/report.html",
      "src/generated.bundle.js",
      "src/app.js.map",
      "package-lock.json",
      "src\\app.ts",
    ];

    for (const workspaceRelativePath of unsafePaths) {
      expect(isSafeWorkspaceRelativePath(workspaceRelativePath), workspaceRelativePath).toBe(false);
      expect(validateControlledRunContextItem({ ...baseFragment, id: `ctx-${workspaceRelativePath.length}`, workspaceRelativePath })).toMatchObject({ ok: false, reason: "unsafe_path" });
    }
    expect(isSafeWorkspaceRelativePath("apps/gui/src/App.tsx")).toBe(true);
  });

  it("rejects previews labels and ids that exceed safety boundaries", () => {
    expect(validateControlledRunContextItem({ ...baseFragment, previewText: "" })).toMatchObject({ ok: false, reason: "empty_preview" });
    expect(validateControlledRunContextItem({ ...baseFragment, label: "Authorization: Bearer sk-proj-1234567890abcdef" })).toMatchObject({ ok: false, reason: "unsafe_label" });
    expect(validateControlledRunContextItem({ ...baseFragment, previewText: `const apiKey = "sk-proj-1234567890abcdef";` })).toMatchObject({ ok: false, reason: "unsafe_label" });
    expect(validateControlledRunContextItem({ ...baseFragment, previewText: "safe text ".repeat(controlledRunContextLimits.maxBytesPerItemPreview) })).toMatchObject({ ok: false, reason: "item_too_large" });
    expect(validateControlledRunContextItem({ ...baseFragment, previewText: Array.from({ length: controlledRunContextLimits.maxLinesPerItemPreview + 1 }, () => "line").join("\n") })).toMatchObject({ ok: false, reason: "too_many_lines" });
  });

  it("adds items deterministically with dedupe file fragment and total budgets", () => {
    const first = mustItem(baseFragment);
    const duplicate = mustItem(baseFragment);
    let bundle = createControlledRunContextBundle();

    bundle = addControlledRunContextItem(bundle, first);
    bundle = addControlledRunContextItem(bundle, duplicate);
    expect(bundle.items).toHaveLength(1);

    for (let index = 0; index < controlledRunContextLimits.maxFragments + 2; index += 1) {
      bundle = addControlledRunContextItem(bundle, mustItem({ ...baseFragment, id: `ctx-extra-${index}`, label: `src/${index}.ts`, workspaceRelativePath: `src/${index}.ts`, previewText: `export const value${index} = ${index};` }));
    }
    expect(bundle.items.length).toBeLessThanOrEqual(controlledRunContextLimits.maxFragments);
    expect(new Set(bundle.items.map((item) => item.workspaceRelativePath).filter(Boolean)).size).toBeLessThanOrEqual(controlledRunContextLimits.maxContextFiles);
  });

  it("keeps reports and summaries sanitized without raw preview bodies", () => {
    const item = mustItem({ ...baseFragment, label: "src/service.ts with a very useful label", truncated: true });
    const bundle = createControlledRunContextBundle([item]);
    const report = buildControlledRunContextReport(bundle, ["unsafe_path", "item_too_large"]);
    const summary = summarizeControlledRunContextItem(item);
    const reportText = JSON.stringify(report);

    expect(summary).toContain("workspace_fragment");
    expect(summary).toContain("src/service.ts");
    expect(summary).toContain("truncated yes");
    expect(report.selectedContextCount).toBe(1);
    expect(report.truncatedCount).toBe(1);
    expect(report.blockedReasons).toEqual(["unsafe_path", "item_too_large"]);
    expect(reportText).not.toContain(item.previewText);
    expect(reportText).not.toContain("Authorization");
  });

  it("clears selected context as a one-shot bundle after terminal draft events", () => {
    const bundle = createControlledRunContextBundle([mustItem(baseFragment)]);
    const cleared = clearControlledRunContextBundle(bundle, "accepted_send");
    const afterClear = addControlledRunContextItem(cleared, mustItem({ ...baseFragment, id: "ctx-after", label: "after clear" }));

    expect(cleared).toEqual({ items: [], cleared: true, clearReason: "accepted_send" });
    expect(afterClear.items).toHaveLength(0);
  });
});

function mustItem(input: ControlledRunContextInput) {
  const result = validateControlledRunContextItem(input);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.item;
}
