import * as assert from "node:assert/strict";
import Module from "node:module";

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function main(): Promise<void> {
  const moduleWithLoad = Module as ModuleWithLoad;
  const originalLoad = moduleWithLoad._load;
  const fakeVscode = {
    workspace: {
      workspaceFolders: [{ uri: { scheme: "file", fsPath: "/tmp/yet-ai-should-not-write" } }],
    },
  };
  try {
    moduleWithLoad._load = function load(request: string, parent: NodeModule | null, isMain: boolean) {
      if (request === "vscode") {
        return fakeVscode;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const webview = await import("./webview");
    assert.equal(webview.isPrivilegedGuiMessageType("gui.controlledAgentEditRequest"), true);
    assert.equal(webview.isPrivilegedGuiMessageType("gui.ready"), false);
    assert.equal(webview.isPrivilegedGuiMessageAllowed({ guiReady: false }), false);
    assert.equal(webview.isPrivilegedGuiMessageAllowed({ guiReady: true }), true);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: false, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-1" }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: undefined }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-2" }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: undefined, latestHostReadyRequestId: undefined }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-1" }), true);
    await assertPreReadyControlledEditRejectsWithoutWrite(webview);
  } finally {
    moduleWithLoad._load = originalLoad;
  }
}

async function assertPreReadyControlledEditRejectsWithoutWrite(webview: typeof import("./webview")): Promise<void> {
  const messages: unknown[] = [];
  const testWebview = {
    postMessage(message: unknown) {
      messages.push(message);
      return Promise.resolve(true);
    },
  };
  await webview.rejectPrivilegedGuiMessageBeforeReady(testWebview as never, {
    version: "2026-05-15",
    type: "gui.controlledAgentEditRequest",
    requestId: "edit-before-ready",
    payload: {
      requestId: "edit-before-ready",
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-edit-before-ready",
      runId: "run-edit-before-ready",
      workspaceReadinessId: "ready-edit-before-ready",
      userConfirmed: true,
      limits: {
        maxFiles: 1,
        maxEdits: 1,
        maxPatchBytes: 16,
      },
      edits: [
        {
          operation: "replace",
          workspaceRelativePath: "src/main.ts",
          fileLabel: "src/main.ts",
          expectedContentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          startLine: 1,
          endLine: 1,
          replacementText: "safe\n",
          replacementByteCount: 5,
          sanitizedSummary: "Update selected lines.",
        },
      ],
    },
  });
  assert.equal(messages.length, 1);
  const result = messages[0] as { type?: string; requestId?: string; payload?: { state?: string; result?: { status?: string; appliedEditCount?: number; blockedReason?: string }; edits?: Record<string, unknown>[] } };
  assert.equal(result.type, "host.controlledAgentEditResult");
  assert.equal(result.requestId, "edit-before-ready");
  assert.equal(result.payload?.state, "blocked");
  assert.equal(result.payload?.result?.status, "blocked");
  assert.equal(result.payload?.result?.appliedEditCount, 0);
  assert.equal(result.payload?.result?.blockedReason, "policy_denied");
  assert.equal(JSON.stringify(result).includes("safe"), false);
  assert.equal(result.payload?.edits?.some((edit) => "replacementText" in edit), false);
}

void main();
