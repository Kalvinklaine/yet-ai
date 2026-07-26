import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Module from "node:module";

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function main(): Promise<void> {
  const moduleWithLoad = Module as ModuleWithLoad;
  const originalLoad = moduleWithLoad._load;
  const fakeVscode = {
    Uri: {
      parse(value: string) {
        return { toString: () => value };
      },
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
    assert.equal(webview.isPrivilegedGuiMessageType("gui.controlledAgentVerificationBundleRequest"), true);
    assert.equal(webview.isPrivilegedGuiMessageType("gui.ready"), false);
    assert.equal(webview.isPrivilegedGuiMessageAllowed({ guiReady: false }), false);
    assert.equal(webview.isPrivilegedGuiMessageAllowed({ guiReady: true }), true);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: false, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-1" }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: undefined }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-2" }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: undefined, latestHostReadyRequestId: undefined }), false);
    assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-1", latestHostReadyRequestId: "ready-1" }), true);
    assertHostReadyIncludesMetadataOnlyCapabilities(webview);
    assertVerificationRequestsRejectWithoutExecution(webview);
    await assertVerificationHandlerRejectsWithoutExecution(webview);
    assertIframeValidatorRejectsVerificationRequests(webview);
    assertHostedChatBootstrapPrecedesPackagedGui(webview);
    assertDevBootstrapLifecycleIsTerminal(webview);
    assertDevFallbackKeepsPackageInert(webview);
    assertDevFallbackWithoutPackageIsBounded(webview);
    assertHostedChatUrlStripsQueryAndHash(webview);
    assertDevIframeForwardsVerificationBundleResult(webview);
    await assertPreReadyControlledEditRejectsWithoutWrite(webview);
    await assertPreReadyControlledCommandRunRejectsWithoutExecution(webview);
    await assertPreReadyControlledVerificationBundleRejectsWithoutExecution(webview);
    assertFrameReadinessBlocksStaleHostReady(webview);
    assertControlledLexicalSearchRejectsRawOutputAtWebviewGate(webview);
    await assertWorkspaceBindingResolution(webview);
    assertWorkspaceBindingStaleGuard(webview);
    assertWorkspaceBindingWrapperValidation(webview);
  } finally {
    moduleWithLoad._load = originalLoad;
  }
}

async function assertWorkspaceBindingResolution(webview: typeof import("./webview")): Promise<void> {
  const connection = { runtimeUrl: "http://127.0.0.1:8001", sessionToken: "safeLocalSessionValue" };
  const root = "/Users/private/workspace-binding-root";
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchBinding = async (input: string | URL, init?: RequestInit) => {
    calls.push({ input: input.toString(), init });
    return new Response(JSON.stringify({
      projectId: "prj_AbCdEfGhIjKlMnOpQrStUA",
      displayName: "Safe Workspace",
      status: "available",
      revision: "1",
      createdAt: "2026-07-26T00:00:00Z",
      lastOpenedAt: null,
      rootAvailable: true,
      cloudRequired: false,
      providerAccess: "direct",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const bound = await webview.resolveWorkspaceBinding(connection, [{ uri: { scheme: "file", fsPath: root } }], "workspace-bind-1", fetchBinding);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "http://127.0.0.1:8001/v1/projects/resolve-local-workspace");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(calls[0].init?.headers, {
    Authorization: "Bearer safeLocalSessionValue",
    "Content-Type": "application/json",
    "X-Yet-AI-Caller": "ide_host",
  });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { root });
  assert.deepEqual(bound, {
    version: "2026-05-15",
    type: "host.workspaceBinding",
    requestId: "workspace-bind-1",
    payload: {
      protocolVersion: "workspace_binding_v1",
      requestId: "workspace-bind-1",
      state: "auto_bound",
      projectId: "prj_AbCdEfGhIjKlMnOpQrStUA",
      displayName: "Safe Workspace",
    },
  });
  assert.equal(JSON.stringify(bound).includes(root), false);
  assert.equal(JSON.stringify(bound).includes(connection.sessionToken), false);

  const noRoot = await webview.resolveWorkspaceBinding(connection, [], "workspace-bind-none", fetchBinding);
  const duplicateRoot = await webview.resolveWorkspaceBinding(connection, [{ uri: { scheme: "file", fsPath: root } }, { uri: { scheme: "file", fsPath: root } }], "workspace-bind-duplicate", fetchBinding);
  const multipleRoots = await webview.resolveWorkspaceBinding(connection, [{ uri: { scheme: "file", fsPath: root } }, { uri: { scheme: "file", fsPath: "/Users/private/other" } }], "workspace-bind-many", fetchBinding);
  const remoteRoot = await webview.resolveWorkspaceBinding(connection, [{ uri: { scheme: "vscode-remote", fsPath: root } }], "workspace-bind-remote", fetchBinding);
  const ambiguousRoot = await webview.resolveWorkspaceBinding(connection, [{ uri: { scheme: "file", fsPath: root } }, { uri: { scheme: "vscode-remote", fsPath: root } }], "workspace-bind-ambiguous", fetchBinding);
  assert.equal(noRoot.payload?.state, "selection_required");
  assert.equal((noRoot.payload as any).reason, "no_root");
  assert.equal(duplicateRoot.payload?.state, "auto_bound");
  assert.equal((multipleRoots.payload as any).reason, "multiple_roots");
  assert.equal((remoteRoot.payload as any).reason, "root_unavailable");
  assert.equal((ambiguousRoot.payload as any).reason, "multiple_roots");
  assert.equal(calls.length, 2);

  const failed = await webview.resolveWorkspaceBinding(connection, [{ uri: { scheme: "file", fsPath: root } }], "workspace-bind-failed", async () => new Response("private failure", { status: 500 }));
  const malformed = await webview.resolveWorkspaceBinding(connection, [{ uri: { scheme: "file", fsPath: root } }], "workspace-bind-malformed", async () => new Response(JSON.stringify({ projectId: "readable", displayName: root }), { status: 200 }));
  const absentToken = await webview.resolveWorkspaceBinding({ runtimeUrl: connection.runtimeUrl }, [{ uri: { scheme: "file", fsPath: root } }], "workspace-bind-token", fetchBinding);
  for (const result of [failed, malformed, absentToken]) {
    assert.equal((result.payload as any).reason, "root_unavailable");
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.equal(JSON.stringify(result).includes("private failure"), false);
  }
}

function assertWorkspaceBindingStaleGuard(webview: typeof import("./webview")): void {
  assert.equal(webview.isCurrentWorkspaceBindingDelivery({ disposed: false, generation: 2, latestGeneration: 2, guiReady: true, requestId: "ready-2", latestRequestId: "ready-2" }), true);
  assert.equal(webview.isCurrentWorkspaceBindingDelivery({ disposed: true, generation: 2, latestGeneration: 2, guiReady: true, requestId: "ready-2", latestRequestId: "ready-2" }), false);
  assert.equal(webview.isCurrentWorkspaceBindingDelivery({ disposed: false, generation: 1, latestGeneration: 2, guiReady: true, requestId: "ready-1", latestRequestId: "ready-1" }), false);
  assert.equal(webview.isCurrentWorkspaceBindingDelivery({ disposed: false, generation: 2, latestGeneration: 2, guiReady: true, requestId: "ready-1", latestRequestId: "ready-2" }), false);
}

function assertWorkspaceBindingWrapperValidation(webview: typeof import("./webview")): void {
  const html = renderDevWebview(webview, "/tmp/yet-ai-extension");
  assert.equal(html.includes('message.type === "host.workspaceBinding"'), true);
  assert.equal(html.includes("message.payload.requestId === message.requestId"), true);
  assert.equal(html.includes('message.type === "gui.runtimeRefresh"'), true);
  assert.equal(html.includes('message.type === "gui.unloaded"'), true);
  assert.equal(html.includes("frameReadyRequestId = event.data.requestId"), true);
  assert.equal(html.includes("frameReadyRequestId = undefined"), true);
  assert.equal(html.includes("const canForwardWorkspaceBinding = (message) => frameReady && frameReadyRequestId !== undefined && latestHostReady && latestHostReady.requestId === frameReadyRequestId && message.requestId === frameReadyRequestId"), true);
  assert.equal(html.includes('event.data.type === "host.workspaceBinding" && !canForwardWorkspaceBinding(event.data)'), true);
  assert.equal(html.includes("/Users/private/workspace-binding-root"), false);
  assert.equal(html.includes("safeLocalSessionValue"), false);
}

function assertDevBootstrapLifecycleIsTerminal(webview: typeof import("./webview")): void {
  let clearCount = 0;
  let mountCount = 0;
  const queuedTimeoutAfterReady = webview.createDevBootstrapLifecycle(
    () => { clearCount += 1; },
    () => { mountCount += 1; },
  );
  const queuedTimeoutCallback = () => queuedTimeoutAfterReady.fallBack();
  assert.equal(queuedTimeoutAfterReady.complete(), true);
  assert.equal(queuedTimeoutAfterReady.phase(), "ready");
  assert.equal(queuedTimeoutCallback(), false);
  assert.equal(queuedTimeoutAfterReady.complete(), false);
  assert.equal(clearCount, 1);
  assert.equal(mountCount, 0);

  clearCount = 0;
  mountCount = 0;
  const timeoutBeforeReady = webview.createDevBootstrapLifecycle(
    () => { clearCount += 1; },
    () => { mountCount += 1; },
  );
  assert.equal(timeoutBeforeReady.fallBack(), true);
  assert.equal(timeoutBeforeReady.phase(), "fallen_back");
  assert.equal(timeoutBeforeReady.fallBack(), false);
  assert.equal(timeoutBeforeReady.complete(), false);
  assert.equal(clearCount, 0);
  assert.equal(mountCount, 1);
}

function assertDevFallbackKeepsPackageInert(webview: typeof import("./webview")): void {
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yet-ai-vscode-fallback-"));
  try {
    fs.mkdirSync(path.join(extensionRoot, "media", "gui"), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, "media", "gui", "index.html"), '<!doctype html><html><head><script type="module" src="./assets/gui.js"></script></head><body><main id="packaged-fallback-marker">Packaged fallback</main></body></html>');
    const html = renderDevWebview(webview, extensionRoot);
    assert.equal(webview.hostedBootstrapTimeoutMs, 3000);
    assert.equal((html.match(/<iframe\b/g) ?? []).length, 1);
    assert.equal((html.match(/id=\\?"packaged-fallback-marker\\?"/g) ?? []).length, 1);
    assert.equal(html.includes('<main id="packaged-fallback-marker">Packaged fallback</main>\n<script nonce='), false);
    assert.equal(html.includes("setTimeout(activatePackagedFallback, 3000)"), true);
    assert.equal(html.includes('currentPhase = "ready"'), true);
    assert.equal(html.includes('currentPhase = "fallen_back"'), true);
    assert.equal(html.includes('activeGui !== "dev"'), true);
    assert.equal(html.includes("frame.removeAttribute(\"src\")"), true);
    assert.equal(html.includes("frame.remove()"), true);
    assert.equal(html.includes("Yet AI ignored late iframe message after local GUI fallback"), true);
    assert.equal((html.match(/acquireVsCodeApi\(\)/g) ?? []).length, 1);
  } finally {
    fs.rmSync(extensionRoot, { recursive: true, force: true });
  }
}

function assertDevFallbackWithoutPackageIsBounded(webview: typeof import("./webview")): void {
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yet-ai-vscode-no-fallback-"));
  try {
    const html = renderDevWebview(webview, extensionRoot);
    assert.equal(html.includes("const packagedFallbackHtml = null"), true);
    assert.equal(html.includes("The local GUI could not be started. Rebuild the packaged GUI or restart its local development server."), true);
    assert.equal(html.includes("Not Found"), false);
  } finally {
    fs.rmSync(extensionRoot, { recursive: true, force: true });
  }
}

function renderDevWebview(webview: typeof import("./webview"), extensionRoot: string): string {
  return webview.renderWebviewHtml(
    { cspSource: "vscode-resource:", asWebviewUri: (uri: { toString(): string }) => uri.toString() } as never,
    { fsPath: extensionRoot, path: extensionRoot } as never,
    {
      product: { id: "yet-ai", displayName: "Yet AI" },
      engine: { binaryName: "yet-lsp" },
      gui: { npmPackage: "@yet-ai/gui" },
      vscode: { publisher: "yet-ai-placeholder", name: "yet-ai", displayName: "Yet AI", configurationPrefix: "yetai", commandPrefix: "yetaicmd", activityBarId: "yet-ai-toolbox-pane" },
    } as never,
    { runtimeUrl: "http://127.0.0.1:8001", guiDevUrl: "http://127.0.0.1:5173" } as never,
  );
}

function assertHostedChatUrlStripsQueryAndHash(webview: typeof import("./webview")): void {
  const url = new URL(webview.vscodeHostedChatUrl(
    "http://127.0.0.1:5173/source/path?unrelated=value#private-fragment",
    "abcdefghijklmnopqrstuvwxABCDEFGH",
  ));
  assert.equal(url.pathname, "/vscode/hosted-chat");
  assert.equal(url.search, "?yetAiHostedBootstrap=abcdefghijklmnopqrstuvwxABCDEFGH");
  assert.equal(url.hash, "");
  assert.deepEqual([...url.searchParams.keys()], ["yetAiHostedBootstrap"]);
}

function assertDevIframeForwardsVerificationBundleResult(webview: typeof import("./webview")): void {
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yet-ai-vscode-verification-result-"));
  try {
    const html = renderDevWebview(webview, extensionRoot);
    const hostValidator = html.match(/const isHostMessage = \(message\) => ([^;]+);/)?.[1];
    assert.ok(hostValidator);
    assert.equal(hostValidator.includes('message.type === "host.controlledAgentVerificationBundleResult"'), true);
    assert.equal(hostValidator.includes('Object.keys(message).every((key) => key === "version" || key === "type" || key === "requestId" || key === "payload")'), true);
    assert.equal(hostValidator.includes("message.version === bootstrap.bridgeVersion"), true);
    assert.equal(html.includes("if (isHostMessage(event.data))"), true);
    assert.equal(html.includes("sendToFrame(event.data)"), true);
  } finally {
    fs.rmSync(extensionRoot, { recursive: true, force: true });
  }
}

function assertHostedChatBootstrapPrecedesPackagedGui(webview: typeof import("./webview")): void {
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
  assert.equal(webview.vscodeHostedChatPath, "/vscode/hosted-chat");
  assert.equal(html.includes('history.replaceState(null, "", "/vscode/hosted-chat")'), true);
  assert.equal(html.includes('window.__yetAiInitialRuntimeConfig = { entryMode: "hosted_chat" }'), true);
  assert.ok(html.indexOf("window.__yetAiInitialRuntimeConfig") < html.indexOf("window.yetAiBootstrap"));
  assert.equal((html.match(/acquireVsCodeApi\(\)/g) ?? []).length, 1);

  const devHtml = webview.renderWebviewHtml(
    { cspSource: "vscode-resource:", asWebviewUri: (uri: { toString(): string }) => uri.toString() } as never,
    { fsPath: "/tmp/yet-ai-extension", path: "/tmp/yet-ai-extension" } as never,
    {
      product: { id: "yet-ai", displayName: "Yet AI" },
      engine: { binaryName: "yet-lsp" },
      gui: { npmPackage: "@yet-ai/gui" },
      vscode: { publisher: "yet-ai-placeholder", name: "yet-ai", displayName: "Yet AI", configurationPrefix: "yetai", commandPrefix: "yetaicmd", activityBarId: "yet-ai-toolbox-pane" },
    } as never,
    { runtimeUrl: "http://127.0.0.1:8001", guiDevUrl: "http://127.0.0.1:5173" } as never,
  );
  assert.match(devHtml, /src="http:\/\/127\.0\.0\.1:5173\/vscode\/hosted-chat\?yetAiHostedBootstrap=[A-Za-z0-9_-]{32}"/);
  assert.equal(devHtml.includes('type: "yet-ai.hosted-bootstrap", token: bootstrap.guiDevBootstrapToken, entryMode: "hosted_chat"'), true);
  assert.equal(devHtml.includes('event.data.type === "yet-ai.hosted-bootstrap.request" && event.data.token === hostedBootstrapMessage.token'), true);
  assert.equal(devHtml.includes('postMessage(message, "*")'), false);
}

function assertHostReadyIncludesMetadataOnlyCapabilities(webview: typeof import("./webview")): void {
  const hostReady = webview.createHostReady(
    {
      product: { id: "yet-ai", displayName: "Yet AI" },
      engine: { binaryName: "yet-lsp" },
      gui: { npmPackage: "@yet-ai/gui" },
      vscode: { publisher: "yet-ai-placeholder", name: "yet-ai", displayName: "Yet AI", configurationPrefix: "yetai", commandPrefix: "yetaicmd", activityBarId: "yet-ai-toolbox-pane" },
    } as never,
    { runtimeUrl: "http://127.0.0.1:8001", sessionToken: "safeLocalSessionValue" } as never,
    "ready-with-capabilities",
  );
  const capabilities = (hostReady.payload as Record<string, any> | undefined)?.controlledCapabilities as Record<string, any> | undefined;
  assert.equal(capabilities?.protocolVersion, "controlled_host_capabilities_v2");
  assert.equal(capabilities?.hostSurface, "vscode");
  assert.equal(capabilities?.authority, "metadata_only");
  assert.equal(capabilities?.capabilities?.controlledRead, "supported");
  assert.equal(capabilities?.capabilities?.controlledEdit, "supported");
  assert.equal(capabilities?.capabilities?.controlledVerification, "supported");
  assert.equal(capabilities?.authorityFlags?.metadataOnly, true);
  assert.equal(capabilities?.authorityFlags?.controlledRead, false);
  assert.equal(capabilities?.authorityFlags?.controlledEdit, false);
  assert.equal(capabilities?.authorityFlags?.controlledVerification, false);
  assert.equal(capabilities?.authorityFlags?.shell, false);
  assert.equal(capabilities?.authorityFlags?.autoRun, false);
  assert.equal(capabilities?.correlationRequirements.includes("host_ready_request_id"), true);
  const serialized = JSON.stringify(capabilities);
  assert.equal(serialized.includes("safeLocalSessionValue"), false);
  assert.equal(serialized.includes("/Users"), false);
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

async function assertPreReadyControlledVerificationBundleRejectsWithoutExecution(webview: typeof import("./webview")): Promise<void> {
  const messages: unknown[] = [];
  const testWebview = {
    postMessage(message: unknown) {
      messages.push(message);
      return Promise.resolve(true);
    },
  };
  await webview.rejectPrivilegedGuiMessageBeforeReady(testWebview as never, controlledVerificationBundleMessage("bundle-before-ready") as never);
  assert.equal(messages.length, 1);
  const result = messages[0] as { type?: string; requestId?: string; payload?: { status?: string; freeformCommandAllowed?: boolean; policyFlags?: { allowlistedCommandIdsOnly?: boolean; shellAllowed?: boolean } } };
  assert.equal(result.type, "host.controlledAgentVerificationBundleResult");
  assert.equal(result.requestId, "bundle-before-ready");
  assert.equal(result.payload?.status, "blocked");
  assert.equal(result.payload?.freeformCommandAllowed, false);
  assert.equal(result.payload?.policyFlags?.allowlistedCommandIdsOnly, true);
  assert.equal(result.payload?.policyFlags?.shellAllowed, false);
}

function assertFrameReadinessBlocksStaleHostReady(webview: typeof import("./webview")): void {
  assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-old", latestHostReadyRequestId: "ready-new" }), false);
  assert.equal(webview.isFramePrivilegedGuiMessageAllowed({ frameReady: true, frameReadyRequestId: "ready-new", latestHostReadyRequestId: "ready-new" }), true);
}

function assertControlledLexicalSearchRejectsRawOutputAtWebviewGate(webview: typeof import("./webview")): void {
  const message = controlledLexicalSearchMessage("raw output");
  assert.equal(webview.isGuiMessage(message), false);
}

function controlledVerificationBundleMessage(requestId: string) {
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentVerificationBundleRequest",
    requestId,
    payload: {
      requestId,
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-bundle-safe",
      runId: "run-bundle-safe",
      workspaceReadinessId: "ready-bundle-safe",
      bundleId: "bundle-safe",
      userConfirmed: true,
      confirmationKind: "explicit_user_verification_bundle",
      commandIds: ["repository-check"],
      limits: {
        maxCommands: 3,
        maxTimeoutMs: 5000,
        maxOutputBytes: 2000,
        maxOutputLines: 40,
        tailOnly: true,
        commandStringAllowed: false,
        argsAllowed: false,
        cwdAllowed: false,
        envAllowed: false,
        shellAllowed: false,
      },
      policyFlags: {
        allowlistedCommandIdsOnly: true,
        boundedSequenceOnly: true,
        explicitUserConfirmationRequired: true,
        freeformCommandAllowed: false,
        argsAllowed: false,
        cwdAllowed: false,
        envAllowed: false,
        shellAllowed: false,
        gitAllowed: false,
        networkAllowed: false,
        providerAllowed: false,
        toolAllowed: false,
        packageInstallAllowed: false,
        fileReadAllowed: false,
        fileWriteAllowed: false,
        hiddenSearchAllowed: false,
        indexingAllowed: false,
        autoStartAllowed: false,
        autoApplyAllowed: false,
        autoRunAllowed: false,
        autoVerifyAllowed: false,
        autoFixAllowed: false,
        productionClaimAllowed: false,
        releaseClaimAllowed: false,
      },
    },
  };
}

function controlledLexicalSearchMessage(query: string) {
  return {
    version: "2026-05-15",
    type: "gui.controlledAgentLexicalSearchRequest",
    requestId: "search-raw-output",
    payload: {
      requestId: "search-raw-output",
      requestIdMintedBy: "gui",
      source: "gui",
      assistantMinted: false,
      controlledWorkspaceId: "workspace-search-safe",
      runId: "run-search-safe",
      runtimeSessionId: "runtime-search-safe",
      workspaceReadinessId: "ready-search-safe",
      explicitUserGesture: true,
      userGestureId: "gesture-search-safe",
      host: "vscode",
      query,
      queryMode: "literal_text",
      scope: {
        kind: "controlled_workspace_bounded",
        controlledWorkspaceOnly: true,
        includePathLabels: ["src/app.ts"],
        excludeHidden: true,
        excludeDependencies: true,
        excludeGenerated: true,
        excludeBinary: true,
        excludeSecretLikePaths: true,
        recursiveAllowed: false,
        broadWorkspaceScanAllowed: false,
      },
      limits: {
        maxFilesScanned: 40,
        maxMatches: 10,
        maxSnippetBytes: 400,
        literalOnly: true,
        regexAllowed: false,
        globAllowed: false,
        pathQueryAllowed: false,
        indexingAllowed: false,
        backgroundAllowed: false,
      },
      policyFlags: {
        explicitLiteralSearchAllowed: true,
        hiddenSearchAllowed: false,
        backgroundSearchAllowed: false,
        indexingAllowed: false,
        regexAllowed: false,
        globAllowed: false,
        pathQueryAllowed: false,
        broadWorkspaceScanAllowed: false,
        fileReadBodyAllowed: false,
        fileWriteAllowed: false,
        shellAllowed: false,
        gitAllowed: false,
        providerAllowed: false,
        toolAllowed: false,
        autoSearchAllowed: false,
        autoApplyAllowed: false,
        autoRunAllowed: false,
      },
    },
  };
}

void main();
