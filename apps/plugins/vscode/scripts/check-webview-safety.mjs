import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "src/webview.ts"), "utf8");
const renderWebviewHtmlSource = extractSection("function renderWebviewHtml", "type PackagedGui");
const bootstrapSource = extractSection("const bootstrap = serializeScriptJson({", "});", renderWebviewHtmlSource);

const requiredSnippets = [
  "record.version === bridgeVersion",
  "record.type === \"gui.ready\"",
  "record.type === \"gui.applyWorkspaceEditRequest\"",
  "const maxForwardedApplyWorkspaceEditMessageBytes = 65536;",
  "isBoundedForwardedApplyWorkspaceEditMessage(record)",
  "Buffer.byteLength(JSON.stringify(value), \"utf8\") <= maxForwardedApplyWorkspaceEditMessageBytes",
  "hasOnlyKeys(record, [\"version\", \"type\", \"requestId\", \"payload\"])",
  "hasOnlyKeys(record, [\"supportedBridgeVersion\"])",
  "record.supportedBridgeVersion === undefined || record.supportedBridgeVersion === bridgeVersion",
  "isBoundedRequestId(record.requestId)",
  "frame.contentWindow.postMessage(message, frameTargetOrigin)",
  "event.origin !== frameTargetOrigin",
  "isFrameGuiMessage(event.data)",
  "latestHostReady = event.data",
  "host.contextSnapshot",
  "createHostContextSnapshot(message.requestId)",
  "console.log(\"Yet AI rejected invalid GUI bridge message\")",
  "replayHostReady();",
  "crypto.randomBytes(24).toString(\"base64url\")",
  ".replace(/</g, \"\\\\u003c\")",
  ".replace(/\\u2028/g, \"\\\\u2028\")",
  ".replace(/\\u2029/g, \"\\\\u2029\")",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`VS Code webview safety check missing: ${snippet}`);
  }
}

const forbiddenSnippets = [
  "postMessage(message, \"*\")",
  "postMessage(event.data, \"*\")",
  "console.log(\"Yet AI host ready\", event.data.payload)",
  "console.log(\"Yet AI host message\", event.data)",
  "console.log(\"Yet AI rejected invalid GUI bridge message\", message)",
  "console.log(\"Yet AI rejected invalid GUI bridge message\", event.data)",
  "Math.random()",
];

for (const snippet of forbiddenSnippets) {
  if (source.includes(snippet)) {
    throw new Error(`VS Code webview safety check forbids: ${snippet}`);
  }
}

for (const forbidden of ["sessionToken", "connection.sessionToken"]) {
  if (renderWebviewHtmlSource.includes(forbidden)) {
    throw new Error(`VS Code webview render must not inline runtime token data: ${forbidden}`);
  }
  if (bootstrapSource.includes(forbidden)) {
    throw new Error(`VS Code webview bootstrap must not include runtime token data: ${forbidden}`);
  }
}

if (!/const isBoundedRequestId = \(value\) => value === undefined \|\| \(typeof value === "string" && value\.length > 0 && value\.length <= 128 && !\/\[\\u0000-\\u001f\\u007f-\\u009f\]\/\.test\(value\)\);/.test(renderWebviewHtmlSource)) {
  throw new Error("VS Code webview wrapper must enforce bounded non-empty control-free gui.ready requestId values.");
}

if (!/Object\.keys\(message\)\.every\(\(key\) => key === "version" \|\| key === "type" \|\| key === "requestId" \|\| key === "payload"\)/.test(renderWebviewHtmlSource)) {
  throw new Error("VS Code webview wrapper must reject gui.ready messages with extra top-level fields.");
}

const disabledGuiMessageTypes = [
  "gui.openFile",
  "gui.revealRange",
  "gui.executeIdeTool",
  "gui.copyText",
  "gui.showNotification",
  "gui.getHostContext",
];
for (const type of disabledGuiMessageTypes) {
  if (source.includes(`record.type === \"${type}\"`) || renderWebviewHtmlSource.includes(`message.type === \"${type}\"`)) {
    throw new Error(`VS Code webview host must not allow disabled GUI bridge message: ${type}`);
  }
}

const privilegedVscodeApiSnippets = [
  "vscode.window.showTextDocument",
  "vscode.commands.executeCommand",
  "vscode.env.clipboard",
  "vscode.window.showInformationMessage",
  "vscode.window.showErrorMessage",
  "vscode.window.createTerminal",
  "vscode.workspace.fs.writeFile",
  "vscode.workspace.fs.delete",
  "vscode.workspace.fs.rename",
];
const webviewHostReceiveSource = extractSection("export function openYetAiWebview", "export function createHostReady");
for (const snippet of privilegedVscodeApiSnippets) {
  if (webviewHostReceiveSource.includes(snippet)) {
    throw new Error(`VS Code webview host receive path must not call privileged API: ${snippet}`);
  }
}

const originalLoad = Module._load;
const fakeVscode = {
  Uri: {
    joinPath(base, ...segments) {
      return { fsPath: path.join(base.fsPath, ...segments), scheme: base.scheme ?? "file", path: path.posix.join(base.path ?? base.fsPath, ...segments) };
    },
    parse(value) {
      return { fsPath: value, scheme: "file", path: value };
    },
  },
  window: {
    activeTextEditor: undefined,
    showWarningMessage() {
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    workspaceFolders: undefined,
    fs: {
      stat() {
        return Promise.reject(new Error("missing"));
      },
    },
    getWorkspaceFolder() {
      return undefined;
    },
    asRelativePath(uri) {
      return uri.fsPath;
    },
    openTextDocument() {
      return Promise.reject(new Error("missing"));
    },
    applyEdit() {
      return Promise.resolve(false);
    },
  },
  FileType: {
    File: 1,
  },
  Position: class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  WorkspaceEdit: class WorkspaceEdit {
    constructor() {
      this.replacements = [];
    }
    replace(uri, range, replacementText) {
      this.replacements.push({ uri, range, replacementText });
    }
  },
};
let createHostReady;
let createHostContextSnapshot;
let createApplyWorkspaceEditResult;
let handleApplyWorkspaceEditRequest;
let isInvalidApplyWorkspaceEditRequestMessage;
let isGuiMessage;
let renderWebviewHtml;
try {
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return fakeVscode;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ createHostReady, createHostContextSnapshot, createApplyWorkspaceEditResult, handleApplyWorkspaceEditRequest, isInvalidApplyWorkspaceEditRequestMessage, isGuiMessage, renderWebviewHtml } = await import("../out/webview.js"));
} finally {
  Module._load = originalLoad;
}

const fakeSecretValues = [
  "fake-session-token-webview-behavioral-sentinel",
  "sk-webview-behavioral-provider-key-sentinel",
  "Bearer fake-session-token-webview-behavioral-sentinel",
  "Authorization",
  "sessionToken",
  "connection.sessionToken",
];

const webview = {
  cspSource: "vscode-resource://yet-ai-test",
  asWebviewUri(uri) {
    return {
      toString() {
        return `vscode-resource://yet-ai-test/${uri.fsPath}`;
      },
    };
  },
};
const extensionUri = { fsPath: path.join(process.cwd(), "__missing_extension_root__") };
const identity = {
  product: {
    id: "yet-ai-test",
    displayName: "Yet AI Test",
  },
  engine: {
    binaryName: "yet-lsp",
  },
  gui: {
    npmPackage: "@yet-ai/gui",
  },
  vscode: {
    publisher: "yet-ai-placeholder",
    name: "yet-ai",
    displayName: "Yet AI Test",
    configurationPrefix: "yetai",
    commandPrefix: "yetaicmd",
    activityBarId: "yet-ai-toolbox-pane",
  },
};
const connection = {
  runtimeUrl: "http://127.0.0.1:8025",
  sessionToken: "fake-session-token-webview-behavioral-sentinel",
  providerApiKey: "sk-webview-behavioral-provider-key-sentinel",
  headers: {
    Authorization: "Bearer fake-session-token-webview-behavioral-sentinel",
  },
};

const html = renderWebviewHtml(webview, extensionUri, identity, connection);
const acceptedGuiReadyMessage = {
  version: "2026-05-15",
  type: "gui.ready",
  requestId: "valid-gui-ready-request",
  payload: {
    supportedBridgeVersion: "2026-05-15",
  },
};
const rejectedControlCharGuiReadyMessage = { ...acceptedGuiReadyMessage, requestId: "bad\nrequest" };
const rejectedPrivilegedGuiMessages = [
  {
    version: "2026-05-15",
    type: "gui.openFile",
    requestId: "req-gui-open-file-disabled-001",
    payload: {
      workspaceRelativePath: "src/example.ts",
    },
  },
  {
    version: "2026-05-15",
    type: "gui.revealRange",
    requestId: "req-gui-reveal-range-disabled-001",
    payload: {
      workspaceRelativePath: "src/example.ts",
      range: {
        startLine: 1,
        startCharacter: 0,
        endLine: 1,
        endCharacter: 8,
      },
    },
  },
  {
    version: "2026-05-15",
    type: "gui.applyWorkspaceEditRequest",
    requestId: "req-gui-edit-disabled-001",
    payload: {
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          newText: "should-not-write",
        },
      ],
    },
  },
  {
    version: "2026-05-15",
    type: "gui.executeIdeTool",
    requestId: "req-gui-execute-tool-disabled-001",
    payload: {
      toolName: "example.disabledTool",
      arguments: {},
    },
  },
  {
    version: "2026-05-15",
    type: "gui.copyText",
    requestId: "req-gui-copy-disabled-001",
    payload: {
      text: "should-not-copy",
    },
  },
  {
    version: "2026-05-15",
    type: "gui.showNotification",
    requestId: "req-gui-notification-disabled-001",
    payload: {
      message: "should-not-show",
    },
  },
  {
    version: "2026-05-15",
    type: "gui.getHostContext",
    requestId: "req-gui-host-context-disabled-001",
    payload: {},
  },
];

const validApplyWorkspaceEditRequest = createApplyWorkspaceEditRequest();
const invalidApplyWorkspaceEditRequests = [
  createApplyWorkspaceEditRequest({ summary: "Update /Users/alice/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update /home/alice/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update /tmp/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update /var/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update /Volumes/work/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update /Private/work/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update ~/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update C:/Users/alice/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update C:\\Users\\alice\\project\\src\\main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update sk-abcdefghijklmnopqrstuvwxyz." }),
  createApplyWorkspaceEditRequest({ summary: "Update sk-proj-abcdefghijklmnopqrstuvwxyz." }),
  createApplyWorkspaceEditRequest({ workspaceRelativePath: "src//main.ts" }),
  createApplyWorkspaceEditRequest({ workspaceRelativePath: "src/" }),
  createApplyWorkspaceEditRequest({ workspaceRelativePath: "/src/main.ts" }),
  createApplyWorkspaceEditRequest({ workspaceRelativePath: "./src/main.ts" }),
  { ...acceptedGuiReadyMessage, requestId: "bad\nrequest" },
  createApplyWorkspaceEditRequest({ omitConfirmation: true }),
  createApplyWorkspaceEditRequest({ workspaceRelativePath: "../src/main.ts" }),
  createApplyWorkspaceEditRequest({ workspaceRelativePath: "src\\main.ts" }),
  createApplyWorkspaceEditRequest({ workspaceRelativePath: "https://example.invalid/main.ts" }),
  createApplyWorkspaceEditRequest({ replacementText: "x".repeat(8193) }),
  createApplyWorkspaceEditRequest({ range: { start: { line: 2, character: 0 }, end: { line: 1, character: 0 } } }),
  createApplyWorkspaceEditRequest({ requestId: undefined }),
];

assert.equal(isGuiMessage(acceptedGuiReadyMessage), true);
assert.equal(isGuiMessage(rejectedControlCharGuiReadyMessage), false, "VS Code host must reject gui.ready with control-char requestId.");
assert.equal(isGuiMessage(validApplyWorkspaceEditRequest), true, "VS Code host should accept strict confirmed apply requests.");
for (const message of rejectedPrivilegedGuiMessages) {
  if (message.type === "gui.applyWorkspaceEditRequest") {
    continue;
  }
  assert.equal(isGuiMessage(message), false, `VS Code host must reject disabled GUI bridge message: ${message.type}`);
}
invalidApplyWorkspaceEditRequests.forEach((message, index) => {
  assert.equal(isGuiMessage(message), false, `VS Code host must reject malformed or unsafe apply requests at index ${index}.`);
});
assert.equal(isInvalidApplyWorkspaceEditRequestMessage(validApplyWorkspaceEditRequest), false, "VS Code host must not classify valid apply requests as invalid correlated rejections.");
assert.equal(isInvalidApplyWorkspaceEditRequestMessage(invalidApplyWorkspaceEditRequests[0]), true, "VS Code host real receive path must identify malformed apply requests for correlated rejection.");
assert.equal(isInvalidApplyWorkspaceEditRequestMessage({ ...invalidApplyWorkspaceEditRequests[0], requestId: "bad\nrequest" }), false, "VS Code host must not correlate invalid apply requests with unsafe request ids.");
assert.equal(isInvalidApplyWorkspaceEditRequestMessage(rejectedPrivilegedGuiMessages[0]), false, "VS Code host must not route other invalid GUI message types through apply rejection.");
assert.equal(createApplyWorkspaceEditResult(invalidApplyWorkspaceEditRequests[0].requestId, "rejected", "Edit request rejected by host policy.").requestId, invalidApplyWorkspaceEditRequests[0].requestId, "VS Code host correlated malformed apply rejection must preserve safe request id.");
const hostReady = createHostReady(identity, connection, "valid-gui-ready-request");
const workspaceRoot = path.join(os.tmpdir(), "yet-ai-safe-workspace");
fakeVscode.workspace.getWorkspaceFolder = (uri) => uri.fsPath.startsWith(workspaceRoot) ? { uri: { fsPath: workspaceRoot } } : undefined;
fakeVscode.workspace.asRelativePath = (uri) => path.relative(workspaceRoot, uri.fsPath).replaceAll(path.sep, "/");
fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
  fsPath: path.join(workspaceRoot, "src", "main.ts"),
  languageId: "typescript",
  selectionText: "function greet() {\n  return \"hello\";\n}",
  selection: createFakeSelection(10, 2, 12, 1),
});
const contextSnapshot = createHostContextSnapshot("valid-gui-ready-request");
fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
  fsPath: path.join(workspaceRoot, "private", "sk-webview-behavioral-provider-key-sentinel.ts"),
  languageId: "typescript",
  selectionText: "Authorization: Bearer fake-session-token-webview-behavioral-sentinel",
  selection: createFakeSelection(1, 0, 1, 64),
});
const secretContextSnapshot = createHostContextSnapshot("valid-gui-ready-request");
fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
  fsPath: "/Users/example/private/outside.ts",
  languageId: "typescript",
  selectionText: "const outside = true;",
  selection: createFakeSelection(0, 0, 0, 21),
});
const outsideContextSnapshot = createHostContextSnapshot("valid-gui-ready-request");
fakeVscode.window.activeTextEditor = undefined;

assert.equal(hostReady.version, "2026-05-15");
assert.equal(hostReady.type, "host.ready");
assert.equal(hostReady.requestId, "valid-gui-ready-request");
assert.equal(hostReady.payload.runtimeUrl, connection.runtimeUrl);
assert.equal(hostReady.payload.sessionToken, connection.sessionToken);
assert.equal(hostReady.payload.cloudRequired, false);

assert.equal(contextSnapshot.version, "2026-05-15");
assert.equal(contextSnapshot.type, "host.contextSnapshot");
assert.equal(contextSnapshot.requestId, "valid-gui-ready-request");
assert.deepEqual(contextSnapshot.payload, {
  kind: "active_editor",
  source: "vscode",
  file: {
    displayPath: "src/main.ts",
    workspaceRelativePath: "src/main.ts",
    languageId: "typescript",
  },
  selection: {
    startLine: 10,
    startCharacter: 2,
    endLine: 12,
    endCharacter: 1,
    text: "function greet() {\n  return \"hello\";\n}",
  },
});
assertNoSecretSentinels(JSON.stringify(contextSnapshot), fakeSecretValues, "VS Code active context snapshot");
assertNoAbsolutePath(JSON.stringify(contextSnapshot), "VS Code active context snapshot");
assert.equal(secretContextSnapshot.payload.file.languageId, "typescript");
assert.equal(secretContextSnapshot.payload.file.displayPath, undefined);
assert.equal(secretContextSnapshot.payload.file.workspaceRelativePath, undefined);
assert.equal(secretContextSnapshot.payload.selection.text, undefined);
assertNoSecretSentinels(JSON.stringify(secretContextSnapshot), fakeSecretValues, "VS Code secret-like active context snapshot");
assert.equal(outsideContextSnapshot.payload.file.displayPath, "outside.ts");
assert.equal(outsideContextSnapshot.payload.file.workspaceRelativePath, undefined);
assertNoAbsolutePath(JSON.stringify(outsideContextSnapshot), "VS Code outside-workspace active context snapshot");

await assertApplyWorkspaceEditBehavior();

const sanitizedResult = createApplyWorkspaceEditResult(
  "req-apply-edit-result-sanitize",
  "failed",
  "Failed at /Users/example/private/secret.ts with Authorization Bearer fake-session-token-webview-behavioral-sentinel",
  999,
  ["src/main.ts", "../private.ts", "src/second.ts", "src/third.ts", "src/fourth.ts", "src/fifth.ts"],
);
assert.equal(sanitizedResult.type, "host.applyWorkspaceEditResult");
assert.equal(sanitizedResult.requestId, "req-apply-edit-result-sanitize");
assert.equal(sanitizedResult.payload.status, "failed");
assert.equal(sanitizedResult.payload.message, "Edit request status changed.");
assert.equal(sanitizedResult.payload.cloudRequired, false);
assert.equal(sanitizedResult.payload.appliedEditCount, 64);
assert.deepEqual(sanitizedResult.payload.affectedFiles, ["src/main.ts", "src/second.ts", "src/third.ts", "src/fourth.ts"]);
for (const privateResultMessage of [
  "Failed at /home/alice/project/src/main.ts.",
  "Failed at /tmp/project/src/main.ts.",
  "Failed at /var/project/src/main.ts.",
  "Failed at /Volumes/work/project/src/main.ts.",
  "Failed at /Private/work/project/src/main.ts.",
  "Failed at ~/project/src/main.ts.",
  "Failed at C:/Users/alice/project/src/main.ts.",
  "Failed at C:\\Users\\alice\\project\\src\\main.ts.",
  "Failed with sk-abcdefghijklmnopqrstuvwxyz.",
  "Failed with sk-proj-abcdefghijklmnopqrstuvwxyz.",
]) {
  assert.equal(createApplyWorkspaceEditResult("req-private-result", "failed", privateResultMessage).payload.message, "Edit request status changed.");
}
assertNoSecretSentinels(JSON.stringify(sanitizedResult), fakeSecretValues, "VS Code apply edit sanitized result");
assertNoAbsolutePath(JSON.stringify(sanitizedResult), "VS Code apply edit sanitized result");

assertNoSecretSentinels(html, fakeSecretValues, "VS Code behavioral webview render");
assertRequiredSafetyStructure(html, "VS Code behavioral webview render");
assertNoInlineSessionToken(html, "VS Code behavioral webview render");

const tempExtensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yet-ai-vscode-webview-safety-"));
try {
  const fakeGuiRoot = path.join(tempExtensionRoot, "media", "gui");
  fs.mkdirSync(path.join(fakeGuiRoot, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(fakeGuiRoot, "index.html"),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Fake Packaged GUI</title>
  <link rel="stylesheet" href="./assets/app.css">
  <script type="module" src="/assets/head.js"></script>
</head>
<body>
  <main data-yet-ai-packaged-gui-marker="behavioral-safety-check">Fake packaged GUI marker</main>
  <script type="module" src="/assets/app.js"></script>
  <script src="../escape.js"></script>
  <script src="/%2e%2e/escape.js"></script>
  <script src="/assets\\escape.js"></script>
  <script src="/assets//empty.js"></script>
  <script src="/assets/app.js?token=secret"></script>
  <script src="/assets/app.js#fragment"></script>
  <script src="//example.invalid/remote.js"></script>
  <script src="/http://example.invalid/remote.js"></script>
  <script src="https://example.invalid/remote.js"></script>
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <a href="#local-anchor">anchor</a>
</body>
</html>`,
  );
  fs.writeFileSync(path.join(fakeGuiRoot, "assets", "app.js"), "window.fakeYetAiPackagedGui = true;\n");
  fs.writeFileSync(path.join(fakeGuiRoot, "assets", "head.js"), "window.fakeYetAiPackagedGuiHead = true;\n");
  fs.writeFileSync(path.join(fakeGuiRoot, "assets", "app.css"), "body { color: var(--vscode-foreground); }\n");

  const packagedWebview = {
    ...webview,
    asWebviewUri(uri) {
      return {
        toString() {
          return `vscode-resource://yet-ai-test/${path.relative(tempExtensionRoot, uri.fsPath).replaceAll(path.sep, "/")}`;
        },
      };
    },
  };
  const packagedHtml = renderWebviewHtml(packagedWebview, { fsPath: tempExtensionRoot }, identity, connection);

  assertNoSecretSentinels(packagedHtml, fakeSecretValues, "VS Code packaged behavioral webview render");
  assertRequiredSafetyStructure(packagedHtml, "VS Code packaged behavioral webview render");
  assertNoInlineSessionToken(packagedHtml, "VS Code packaged behavioral webview render");

  if (!packagedHtml.includes('data-yet-ai-packaged-gui-marker="behavioral-safety-check"')) {
    throw new Error("VS Code behavioral webview render did not use the packaged GUI path.");
  }

  if (packagedHtml.includes("Local runtime shell is ready")) {
    throw new Error("VS Code behavioral webview render unexpectedly used the fallback placeholder path.");
  }

  const expectedAssetUris = [
    'href="vscode-resource://yet-ai-test/media/gui/assets/app.css"',
    'src="vscode-resource://yet-ai-test/media/gui/assets/head.js"',
    'src="vscode-resource://yet-ai-test/media/gui/assets/app.js"',
  ];
  for (const expectedAssetUri of expectedAssetUris) {
    if (!packagedHtml.includes(expectedAssetUri)) {
      throw new Error(`VS Code behavioral webview render did not rewrite packaged asset URI: ${expectedAssetUri}`);
    }
  }

  const forbiddenAssetUriFragments = [
    "vscode-resource://yet-ai-test/media/escape.js",
    "vscode-resource://yet-ai-test/escape.js",
    "vscode-resource://yet-ai-test/media/gui/../escape.js",
    "vscode-resource://yet-ai-test/media/gui/%2e%2e/escape.js",
    "vscode-resource://yet-ai-test/media/gui/assets\\escape.js",
    "vscode-resource://yet-ai-test/media/gui/assets//empty.js",
    "vscode-resource://yet-ai-test/media/gui/assets/app.js?token=secret",
    "vscode-resource://yet-ai-test/media/gui/assets/app.js#fragment",
    "vscode-resource://yet-ai-test/media/gui/http://example.invalid/remote.js",
    "vscode-resource://yet-ai-test/media/gui/example.invalid/remote.js",
  ];
  for (const forbiddenAssetUriFragment of forbiddenAssetUriFragments) {
    if (packagedHtml.includes(forbiddenAssetUriFragment)) {
      throw new Error(`VS Code behavioral webview render rewrote unsafe packaged asset URI: ${forbiddenAssetUriFragment}`);
    }
  }

  const preservedUnsafeReferences = [
    'src="../escape.js"',
    'src="/%2e%2e/escape.js"',
    'src="/assets\\escape.js"',
    'src="/assets//empty.js"',
    'src="/assets/app.js?token=secret"',
    'src="/assets/app.js#fragment"',
    'src="//example.invalid/remote.js"',
    'src="/http://example.invalid/remote.js"',
    'src="https://example.invalid/remote.js"',
    'src="data:image/gif;base64,R0lGODlhAQABAAAAACw="',
    'href="#local-anchor"',
  ];
  for (const preservedUnsafeReference of preservedUnsafeReferences) {
    if (!packagedHtml.includes(preservedUnsafeReference)) {
      throw new Error(`VS Code behavioral webview render unexpectedly changed unsafe packaged reference: ${preservedUnsafeReference}`);
    }
  }
} finally {
  fs.rmSync(tempExtensionRoot, { recursive: true, force: true });
}

const httpsLoopbackFrameSourcePattern = /frame-src [^";]*http:\/\/127\.0\.0\.1:\* [^";]*http:\/\/localhost:\* [^";]*http:\/\/\[::1\]:\* [^";]*https:\/\/127\.0\.0\.1:\* [^";]*https:\/\/localhost:\* [^";]*https:\/\/\[::1\]:\*/;
const httpsLoopbackGuiDevUrls = [
  "https://127.0.0.1:5173",
  "https://localhost:5173",
  "https://[::1]:5173",
];

for (const guiDevUrl of httpsLoopbackGuiDevUrls) {
  const httpsGuiDevHtml = renderWebviewHtml(webview, extensionUri, identity, {
    ...connection,
    guiDevUrl,
  });
  const label = `VS Code HTTPS loopback webview render for ${guiDevUrl}`;

  assertNoSecretSentinels(httpsGuiDevHtml, fakeSecretValues, label);

  const expectedIframe = `<iframe title="Yet AI Test GUI" src="${guiDevUrl}"></iframe>`;
  if (!httpsGuiDevHtml.includes(expectedIframe)) {
    throw new Error(`${label} missing exact iframe src: ${expectedIframe}`);
  }

  if (!httpsLoopbackFrameSourcePattern.test(httpsGuiDevHtml)) {
    throw new Error(`${label} missing HTTPS loopback CSP frame-src entries.`);
  }

  assertNoInlineSessionToken(httpsGuiDevHtml, label);
}

function createFakeActiveTextEditor({ fsPath, languageId, selectionText, selection }) {
  return {
    document: {
      uri: { fsPath, scheme: "file", path: fsPath },
      languageId,
      isUntitled: false,
      getText(range) {
        assert.equal(range, selection);
        return selectionText;
      },
    },
    selection,
  };
}

function createFakeSelection(startLine, startCharacter, endLine, endCharacter) {
  return {
    isEmpty: startLine === endLine && startCharacter === endCharacter,
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

function createApplyWorkspaceEditRequest(overrides = {}) {
  const range = overrides.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
  const textReplacements = overrides.textReplacements ?? [
    {
      range,
      replacementText: overrides.replacementText ?? "hello",
    },
  ];
  const payload = {
    requiresUserConfirmation: true,
    summary: overrides.summary ?? "Update greeting text.",
    cloudRequired: false,
    edits: [
      {
        workspaceRelativePath: overrides.workspaceRelativePath ?? "src/main.ts",
        textReplacements,
      },
    ],
    ...(overrides.payload ?? {}),
  };
  if (overrides.omitConfirmation) {
    delete payload.requiresUserConfirmation;
  }
  return {
    version: "2026-05-15",
    type: "gui.applyWorkspaceEditRequest",
    requestId: Object.hasOwn(overrides, "requestId") ? overrides.requestId : "req-apply-edit-valid-001",
    payload,
  };
}

async function assertApplyWorkspaceEditBehavior() {
  const existingPath = path.join(workspaceRoot, "src", "main.ts");
  const webviewMessages = [];
  const testWebview = {
    postMessage(message) {
      webviewMessages.push(message);
      return Promise.resolve(true);
    },
  };
  let confirmation = undefined;
  let applyCalls = 0;
  let warningCalls = 0;

  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } }];
  fakeVscode.workspace.fs.stat = (uri) => {
    if (uri.fsPath === existingPath) {
      return Promise.resolve({ type: fakeVscode.FileType.File });
    }
    return Promise.reject(new Error("missing"));
  };
  fakeVscode.workspace.openTextDocument = (uri) => {
    if (uri.fsPath !== existingPath) {
      return Promise.reject(new Error("missing"));
    }
    return Promise.resolve({
      isUntitled: false,
      lineCount: 1,
      lineAt(line) {
        assert.equal(line, 0);
        return { text: "hello world" };
      },
    });
  };
  fakeVscode.window.showWarningMessage = (message, options, action) => {
    warningCalls += 1;
    assert.equal(options.modal, true);
    assert.equal(action, "Apply edits");
    assert.equal(message.includes("Yet AI wants to apply 1 confirmed text edit"), true);
    return Promise.resolve(confirmation);
  };
  fakeVscode.workspace.applyEdit = (workspaceEdit) => {
    applyCalls += 1;
    assert.equal(workspaceEdit.replacements.length, 1);
    assert.equal(workspaceEdit.replacements[0].uri.fsPath, existingPath);
    assert.equal(workspaceEdit.replacements[0].replacementText, "hello");
    return Promise.resolve(true);
  };

  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest({ workspaceRelativePath: "../src/main.ts" }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);

  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest({ workspaceRelativePath: "src/missing.ts" }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);

  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest({ range: { start: { line: 0, character: 7 }, end: { line: 0, character: 2 } } }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);

  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest({ replacementText: "x".repeat(8193) }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);

  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest({
    textReplacements: [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, replacementText: "hello" },
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 7 } }, replacementText: "wave" },
    ],
  }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);

  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest({
    payload: {
      edits: [
        { workspaceRelativePath: "src/main.ts", textReplacements: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, replacementText: "hello" }] },
        { workspaceRelativePath: "src/main.ts", textReplacements: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, replacementText: "world" }] },
      ],
    },
  }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);

  const secondWorkspaceRoot = path.join(os.tmpdir(), "yet-ai-safe-workspace-second");
  fakeVscode.workspace.workspaceFolders = [
    { uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } },
    { uri: { fsPath: secondWorkspaceRoot, scheme: "file", path: secondWorkspaceRoot } },
  ];
  fakeVscode.workspace.fs.stat = (uri) => {
    if (uri.fsPath === existingPath || uri.fsPath === path.join(secondWorkspaceRoot, "src", "main.ts")) {
      return Promise.resolve({ type: fakeVscode.FileType.File });
    }
    return Promise.reject(new Error("missing"));
  };
  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest());
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);
  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } }];
  fakeVscode.workspace.fs.stat = (uri) => {
    if (uri.fsPath === existingPath) {
      return Promise.resolve({ type: fakeVscode.FileType.File });
    }
    return Promise.reject(new Error("missing"));
  };

  confirmation = undefined;
  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest());
  assert.equal(webviewMessages.at(-1).payload.status, "denied");
  assert.equal(warningCalls, 1);
  assert.equal(applyCalls, 0);

  confirmation = "Apply edits";
  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest());
  assert.equal(webviewMessages.at(-1).payload.status, "applied");
  assert.equal(webviewMessages.at(-1).payload.appliedEditCount, 1);
  assert.deepEqual(webviewMessages.at(-1).payload.affectedFiles, ["src/main.ts"]);
  assert.equal(warningCalls, 2);
  assert.equal(applyCalls, 1);

  fakeVscode.workspace.workspaceFolders = undefined;
}

function assertNoAbsolutePath(value, label) {
  if (value.includes(os.tmpdir()) || value.includes("/Users/") || value.includes(workspaceRoot)) {
    throw new Error(`${label} leaked absolute path data.`);
  }
}

function assertNoSecretSentinels(html, values, label) {
  for (const value of values) {
    if (html.includes(value)) {
      throw new Error(`${label} leaked secret sentinel: ${value}`);
    }
  }
}

function assertRequiredSafetyStructure(html, label) {
  const requiredHtmlPatterns = [
    /<meta http-equiv="Content-Security-Policy" content="[^"]*script-src [^"]*'nonce-[^']+'[^"]*">/,
    /<style nonce="[^"]+">/,
    /<script nonce="[^"]+">/,
    /const vscode = acquireVsCodeApi\(\);/,
    /window\.yetAiBootstrap = bootstrap;/,
    /vscode\.postMessage\(\{ version: bootstrap\.bridgeVersion, type: "gui\.ready"/,
  ];

  for (const pattern of requiredHtmlPatterns) {
    if (!pattern.test(html)) {
      throw new Error(`${label} missing expected safety structure: ${pattern}`);
    }
  }
}

function assertNoInlineSessionToken(html, label) {
  if (/sessionToken\s*:/.test(html) || /"sessionToken"/.test(html)) {
    throw new Error(`${label} must not expose inline sessionToken data.`);
  }
}

function extractSection(startMarker, endMarker, haystack = source) {
  const start = haystack.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`VS Code webview safety check missing section start: ${startMarker}`);
  }
  const end = haystack.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    throw new Error(`VS Code webview safety check missing section end: ${endMarker}`);
  }
  return haystack.slice(start, end);
}
