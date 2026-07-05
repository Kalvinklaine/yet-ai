import * as assert from "node:assert/strict";
import Module from "node:module";

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function main(): Promise<void> {
  const moduleWithLoad = Module as ModuleWithLoad;
  const originalLoad = moduleWithLoad._load;
  const fakeVscode = {
    Uri: {
      joinPath(base: { fsPath: string; path?: string }, ...segments: string[]) {
        const joined = [base.fsPath, ...segments].join("/");
        return { fsPath: joined, path: joined, toString: () => joined };
      },
    },
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
    assert.equal(webview.isPrivilegedGuiMessageType("gui.controlledAgentCommandRunRequest"), true);
    assert.equal(webview.isPrivilegedGuiMessageType("gui.ready"), false);
    assert.equal(webview.isPrivilegedGuiMessageAllowed({ guiReady: false }), false);
    assert.equal(webview.isPrivilegedGuiMessageAllowed({ guiReady: true }), true);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: false, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-1" }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: undefined }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-2" }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: undefined, latestHostReadyRequestId: undefined }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-1" }), true);
    assertVerificationRequestsRejectWithoutExecution(webview);
    await assertVerificationHandlerRejectsWithoutExecution(webview);
    assertIframeValidatorRejectsVerificationRequests(webview);
    await assertPreReadyControlledEditRejectsWithoutWrite(webview);
    await assertPreReadyControlledCommandRunRejectsWithoutExecution(webview);
    assertFrameReadinessBlocksStaleHostReady(webview);
  } finally {
    moduleWithLoad._load = originalLoad;
  }
}

function assertVerificationRequestsRejectWithoutExecution(webview: typeof import("./webview")): void {
  const message = {
    version: "2026-05-15",
    type: "gui.ideActionRequest",
    requestId: "verify-rejected",
    payload: {
      action: "runVerificationCommand",
      commandId: "repository-check",
    },
  };
  assert.equal(webview.parseIdeActionRequest(message as never), undefined);
  assert.equal(webview.isGuiMessage(message), false);
  assert.equal(webview.isInvalidIdeActionRequestMessage(message), true);
}

async function assertVerificationHandlerRejectsWithoutExecution(webview: typeof import("./webview")): Promise<void> {
  const messages: unknown[] = [];
  const testWebview = {
    postMessage(message: unknown) {
      messages.push(message);
      return Promise.resolve(true);
    },
  };
  await webview.handleIdeActionRequest(testWebview as never, {
    version: "2026-05-15",
    type: "gui.ideActionRequest",
    requestId: "verify-handler-rejected",
    payload: {
      action: "runVerificationCommand",
      commandId: "repository-check",
      command: "npm run secret-check",
      cwd: "/Users/private/workspace",
      env: { TOKEN: "secret" },
    },
  } as never);
  assert.equal(messages.length, 1);
  const result = messages[0] as { type?: string; requestId?: string; payload?: Record<string, unknown> };
  assert.equal(result.type, "host.ideActionResult");
  assert.equal(result.requestId, "verify-handler-rejected");
  assert.equal(result.payload?.status, "rejected");
  assert.equal(result.payload?.message, "IDE action rejected by host policy.");
  assert.equal(result.payload?.cloudRequired, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("npm"), false);
  assert.equal(serialized.includes("/Users"), false);
  assert.equal(serialized.includes("TOKEN"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("cwd"), false);
  assert.equal(serialized.includes("env"), false);
}

function assertIframeValidatorRejectsVerificationRequests(webview: typeof import("./webview")): void {
  const html = webview.renderWebviewHtml(
    { cspSource: "vscode-resource:", asWebviewUri: (uri: { toString(): string }) => uri.toString() } as never,
    { fsPath: "/tmp/yet-ai-extension", path: "/tmp/yet-ai-extension" } as never,
    {
      product: { id: "yet-ai", displayName: "Yet AI" },
      engine: { binaryName: "yet-lsp" },
      gui: { npmPackage: "@yet-ai/gui" },
      vscode: { publisher: "yet-ai-placeholder", name: "yet-ai", displayName: "Yet AI", configurationPrefix: "yetai", commandPrefix: "yetaicmd", activityBarId: "yet-ai-toolbox-pane" },
    } as never,
    { runtimeUrl: "http://127.0.0.1:8001" } as never,
  );
  assert.equal(html.includes('payload.action === "runVerificationCommand"'), false);
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

async function assertPreReadyControlledCommandRunRejectsWithoutExecution(webview: typeof import("./webview")): Promise<void> {
  const messages: unknown[] = [];
  const testWebview = {
    postMessage(message: unknown) {
      messages.push(message);
      return Promise.resolve(true);
    },
  };
  await webview.rejectPrivilegedGuiMessageBeforeReady(testWebview as never, {
    version: "2026-05-15",
    type: "gui.controlledAgentCommandRunRequest",
    requestId: "command-before-ready",
    payload: {
      requestId: "command-before-ready",
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-command-before-ready",
      runId: "run-command-before-ready",
      workspaceReadinessId: "ready-command-before-ready",
      userConfirmed: true,
      correlation: {
        origin: "user",
        confirmedBy: "user",
        confirmationId: "confirm-command-before-ready",
        hostCorrelationId: "host-command-before-ready",
      },
      commandId: "repository-check",
      limits: {
        timeoutMs: 5000,
        maxOutputBytes: 2000,
        maxOutputLines: 40,
        tailOnly: true,
        commandStringAllowed: false,
        argsAllowed: false,
        cwdAllowed: false,
        envAllowed: false,
        shellAllowed: false,
      },
    },
  });
  assert.equal(messages.length, 1);
  const result = messages[0] as { type?: string; requestId?: string; payload?: { status?: string; freeformCommandAllowed?: boolean; policyFlags?: { allowlistedCommandIdOnly?: boolean; shellAllowed?: boolean } } };
  assert.equal(result.type, "host.controlledAgentCommandRunResult");
  assert.equal(result.requestId, "command-before-ready");
  assert.equal(result.payload?.status, "blocked");
  assert.equal(result.payload?.freeformCommandAllowed, false);
  assert.equal(result.payload?.policyFlags?.allowlistedCommandIdOnly, true);
  assert.equal(result.payload?.policyFlags?.shellAllowed, false);
}

function assertFrameReadinessBlocksStaleHostReady(webview: typeof import("./webview")): void {
  assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-old", latestHostReadyRequestId: "ready-new" }), false);
  assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-new", latestHostReadyRequestId: "ready-new" }), true);
}

void main();
