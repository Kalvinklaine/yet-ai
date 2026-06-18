import { describe, expect, it } from "vitest";
import type { HostContextSnapshotPayload } from "../bridge/bridgeAdapter";
import { codingActions } from "./codingActions";

function activeEditorContext(): HostContextSnapshotPayload {
  return {
    kind: "active_editor",
    source: "vscode",
    file: {
      workspaceRelativePath: "src/example.ts",
      displayPath: "src/example.ts",
      languageId: "typescript",
    },
    selection: {
      startLine: 3,
      startCharacter: 2,
      endLine: 5,
      endCharacter: 1,
      text: "const name = \"Yet AI\";",
    },
  };
}

describe("codingActions", () => {
  it("builds a real-model safe edit prompt with exact confirmed-apply JSON constraints", () => {
    const action = codingActions.find((item) => item.id === "propose_safe_edit");
    expect(action).toBeDefined();

    const prompt = action!.buildPrompt(activeEditorContext());

    expect(prompt).toContain("Coding action: propose_safe_edit");
    expect(prompt).toContain("Return either normal explanatory prose or exactly one complete JSON proposal");
    expect(prompt).toContain("one fenced ```json block is acceptable");
    expect(prompt).toContain("single complete bridge envelope");
    expect(prompt).toContain("Do not include requestId, command, tool, or any unknown fields");
    expect(prompt).toContain('"version": "2026-05-15"');
    expect(prompt).toContain('"type": "gui.applyWorkspaceEditRequest"');
    expect(prompt).toContain('"requiresUserConfirmation": true');
    expect(prompt).toContain('"cloudRequired": false');
    expect(prompt).toContain("Do not create, delete, rename, move, patch files, traverse paths, or use absolute/private paths");
    expect(prompt).toContain("textReplacements");
    expect(prompt).toContain("Do not provide multiple alternatives or multiple JSON objects");
    expect(prompt).toContain("Do not auto-apply");
    expect(prompt).toContain("Do not ask to run tools, shell, git, or file system commands");
  });
});
