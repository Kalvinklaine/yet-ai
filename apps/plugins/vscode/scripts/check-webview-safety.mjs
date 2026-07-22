import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
  "record.type === \"gui.ideActionRequest\"",
  "record.type === \"gui.applyWorkspaceEditRequest\"",
  "const maxForwardedApplyWorkspaceEditMessageBytes = 65536;",
  "const maxForwardedIdeActionMessageBytes = 8192;",
  "const maxControlledIdeActionFileBytes = 2 * 1024 * 1024;",
  "const maxActiveFileExcerptTextLength = 8000;",
  "payload.action === \"getActiveFileExcerpt\"",
  "payload.action === \"searchWorkspaceSnippets\"",
  "const maxVerificationOutputTailLength = 4000;",
  "payload.action === \"getContextSnapshot\"",
  "payload.action === \"openWorkspaceFile\"",
  "payload.action === \"revealWorkspaceRange\"",
  "const maxVerificationOutputTailLength = 4000;",
  "const maxWorkspaceSnippetSearchFiles = 500;",
  "const maxWorkspaceSnippetSearchResults = 20;",
  "const maxWorkspaceSnippetSearchSnippetsPerFile = 8;",
  "const maxWorkspaceSnippetSearchSnippetLength = 400;",
  "const pendingWorkspaceSnippetSearchQueries = new Set<string>();",
  "vscode.workspace.findFiles(",
  "vscode.workspace.fs.readFile(uri)",
  "new vscode.RelativePattern(workspaceFolder, \"**/*\")",
  "maxWorkspaceSnippetSearchFiles,",
  "const sortedFiles = files",
  ".sort((left, right) => left.workspaceRelativePath.localeCompare(right.workspaceRelativePath, \"en-US\"))",
  "languageIdForWorkspaceSnippetPath(workspaceRelativePath)",
  "function compareWorkspaceSnippets(left: WorkspaceSnippet, right: WorkspaceSnippet): number",
  "{**/.git/**,**/node_modules/**,**/dist/**,**/target/**,**/build/**,**/cache/**}",
  "message.type === \"gui.ideActionRequest\" && isRequiredRequestId(message.requestId) && isBoundedForwardedIdeActionMessage(message) && isStrictIdeActionPayload(message.payload)",
  "payload.action === \"searchWorkspaceSnippets\" && isWorkspaceSnippetSearchQuery(payload.query)",
  "host.ideActionResult",
  "createHostContextSnapshot(guiReadyRequestId)",
  "vscode.window.onDidChangeActiveTextEditor(() => scheduleContextRefresh())",
  "vscode.window.onDidChangeTextEditorSelection(() => scheduleContextRefresh())",
  "contextRefreshTimer = setTimeout(() => {",
  "}, 200);",
  "activeEditorListener.dispose();",
  "selectionListener.dispose();",
  "isInvalidIdeActionRequestMessage(message)",
  "createIdeActionResult(requestId, \"rejected\", \"IDE action rejected by host policy.\")",
  "console.log(\"Yet AI rejected invalid GUI bridge message\")",
  "replayHostReady();",
  "crypto.randomBytes(24).toString(\"base64url\")",
  "validateRuntimeUrl(connection.runtimeUrl",
  "isBridgeSafeSessionToken(connection.sessionToken)",
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

if (!renderWebviewHtmlSource.includes('const isBoundedRequestId = (value) => value === undefined || (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !hasSecretRequestIdMarker(value));')) {
  throw new Error("VS Code webview wrapper must enforce path/secret-safe bounded gui.ready requestId values.");
}

if (!/Object\.keys\(message\)\.every\(\(key\) => key === "version" \|\| key === "type" \|\| key === "requestId" \|\| key === "payload"\)/.test(renderWebviewHtmlSource)) {
  throw new Error("VS Code webview wrapper must reject gui.ready messages with extra top-level fields.");
}

if (!renderWebviewHtmlSource.includes("new TextEncoder().encode(JSON.stringify(value)).length <= maxForwardedApplyWorkspaceEditMessageBytes")) {
  throw new Error("VS Code webview wrapper rendered JS must enforce serialized size before forwarding iframe apply requests.");
}

if (!renderWebviewHtmlSource.includes("message.type === \"gui.ideActionRequest\" && isRequiredRequestId(message.requestId) && isBoundedForwardedIdeActionMessage(message) && isStrictIdeActionPayload(message.payload)")) {
  throw new Error("VS Code webview wrapper rendered JS must require requestId and apply serialized-size guard to iframe IDE action requests.");
}

if (!renderWebviewHtmlSource.includes("!hasSecretRequestIdMarker(value)")) {
  throw new Error("VS Code webview wrapper rendered JS must reject secret-like request IDs.");
}

if (!renderWebviewHtmlSource.includes("message.type === \"gui.applyWorkspaceEditRequest\" && isRequiredRequestId(message.requestId) && isBoundedForwardedApplyWorkspaceEditMessage(message)")) {
  throw new Error("VS Code webview wrapper rendered JS must require requestId and apply the serialized-size guard to iframe apply requests.");
}

const ideActionRunSource = extractSection("async function runIdeActionRequest", "function toVscodeRange");
const activeFileExcerptSource = extractSection("function createActiveFileExcerptResult", "function toVscodeRange");
for (const snippet of [
  "vscode.workspace.openTextDocument",
  "vscode.window.showTextDocument",
  "vscode.workspace.applyEdit",
  "new vscode.WorkspaceEdit",
  "workspaceEdit.replace",
  "vscode.workspace.fs.writeFile",
  "vscode.workspace.fs.delete",
  "vscode.workspace.fs.rename",
  "vscode.commands.executeCommand",
  "vscode.window.createTerminal",
  "vscode.tasks.executeTask",
]) {
  if (activeFileExcerptSource.includes(snippet)) {
    throw new Error(`Active-file excerpt handler must not call mutation/navigation/provider/task API: ${snippet}`);
  }
}
if (!activeFileExcerptSource.includes("document.uri.scheme !== \"file\"") || !activeFileExcerptSource.includes("activeDocumentWorkspaceRelativePath(document)")) {
  throw new Error("Active-file excerpt handler must require local file scheme inside exactly one workspace folder.");
}
if (!activeFileExcerptSource.includes("editor.visibleRanges[0]") || !activeFileExcerptSource.includes("document.offsetAt(toVscodePosition(range.start))") || !activeFileExcerptSource.includes("document.positionAt(boundedEndOffset)")) {
  throw new Error("Active-file excerpt handler must compute bounded active-editor offsets before getText.");
}
if (activeFileExcerptSource.indexOf("document.getText(toVscodeRange(boundedRange))") < activeFileExcerptSource.indexOf("const boundedEndOffset")) {
  throw new Error("Active-file excerpt handler must not get text before computing bounded end offset.");
}
if (!ideActionRunSource.includes("resolveExistingWorkspaceFile(request.workspaceRelativePath, workspaceFolders, maxControlledIdeActionFileBytes)")) {
  throw new Error("Controlled IDE navigation must resolve files with a max-size guard before openTextDocument.");
}
if (ideActionRunSource.indexOf("maxControlledIdeActionFileBytes") > ideActionRunSource.indexOf("vscode.workspace.openTextDocument(uri)")) {
  throw new Error("Controlled IDE navigation file-size guard must appear before openTextDocument.");
}

if (!source.includes("return \"IDE action status changed.\";") || extractSection("export function createIdeActionProgress", "export async function handleIdeActionRequest").includes("Edit request status changed.")) {
  throw new Error("IDE action status/result sanitizer fallback must not be edit-specific.");
}

const disabledGuiMessageTypes = [
  "gui.openFile",
  "gui.revealRange",
  "gui.executeIdeTool",
  "gui.copyText",
  "gui.showNotification",
  "gui.getHostContext",
  "gui.executeShellCommand",
  "gui.runTask",
  "gui.gitOperation",
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

const controlledIdeActionSource = extractSection("export async function handleIdeActionRequest", "export async function handleApplyWorkspaceEditRequest");
for (const snippet of [
  "vscode.workspace.applyEdit",
  "new vscode.WorkspaceEdit",
  "workspaceEdit.replace",
  "vscode.workspace.fs.writeFile",
  "vscode.workspace.fs.delete",
  "vscode.workspace.fs.rename",
  "vscode.commands.executeCommand",
  "vscode.window.createTerminal",
  "vscode.tasks.executeTask",
]) {
  if (controlledIdeActionSource.includes(snippet)) {
    throw new Error(`Controlled IDE action handler must not call write/shell/task API: ${snippet}`);
  }
}

const verificationResultPayloadSource = extractSection("export function createIdeActionResult", "function hardenIdeActionResultPayload");
for (const snippet of [
  "import { spawn } from \"node:child_process\";",
  "async function runVerificationCommandRequest",
  "function spawnVerificationCommand",
  "verificationCommandConfirmationLabel",
  "pendingVerificationCommandIds",
  "spawn(command, args, {",
]) {
  if (source.includes(snippet)) {
    throw new Error(`S84 VS Code webview must not include verification execution path: ${snippet}`);
  }
}
if (source.includes("payload.action === \"runVerificationCommand\" && isVerificationCommandId(payload.commandId)")) {
  throw new Error("S84 VS Code webview wrapper must reject iframe verification command requests.");
}
const parseIdeActionRequestSource = extractSection("export function parseIdeActionRequest", "async function resolveExistingWorkspaceFile");
if (parseIdeActionRequestSource.includes("return { requestId: message.requestId, action: \"runVerificationCommand\"")) {
  throw new Error("S84 VS Code parser must not accept verification command requests.");
}
for (const forbidden of ["payload.command =", "payload.args", "payload.cwd", "payload.env", "payload.shell"]) {
  if (verificationResultPayloadSource.includes(forbidden)) {
    throw new Error(`Verification command result must not return free-form process fields: ${forbidden}`);
  }
}
if (!extractSection("export async function handleApplyWorkspaceEditRequest", "export async function validateWorkspaceEditBeforeApply").includes("vscode.workspace.applyEdit(workspaceEdit)")) {
  throw new Error("Confirmed edit proposal path must remain the only workspace.applyEdit path.");
}

const originalLoad = Module._load;
const fakeChildProcess = {
  spawn(command, args, options) {
    fakeChildProcess.calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      fakeChildProcess.kills += 1;
      child.killed = true;
    };
    const complete = () => {
      child.stdout.emit("data", Buffer.from(fakeChildProcess.stdout));
      child.stderr.emit("data", Buffer.from(fakeChildProcess.stderr));
      child.emit("close", fakeChildProcess.exitCode);
    };
    if (fakeChildProcess.holdClose) {
      fakeChildProcess.pendingChildren.push({ child, complete });
    } else {
      setImmediate(complete);
    }
    return child;
  },
  calls: [],
  kills: 0,
  stdout: "verification ok",
  stderr: "",
  exitCode: 0,
  holdClose: false,
  pendingChildren: [],
};

const fakeVscode = {
  Uri: {
    joinPath(base, ...segments) {
      return { fsPath: path.join(base.fsPath, ...segments), scheme: base.scheme ?? "file", path: path.posix.join(base.path ?? base.fsPath, ...segments) };
    },
    parse(value) {
      return { fsPath: value, scheme: "file", path: value };
    },
  },
  RelativePattern: class RelativePattern {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  window: {
    activeTextEditor: undefined,
    showWarningMessage() {
      return Promise.resolve(undefined);
    },
    showTextDocument(document, options) {
      fakeVscode.__shownDocuments.push({ document, options });
      return Promise.resolve({
        revealRange(range, revealType) {
          fakeVscode.__revealedRanges.push({ range, revealType });
        },
      });
    },
  },
  __shownDocuments: [],
  __revealedRanges: [],
  workspace: {
    workspaceFolders: undefined,
    fs: {
      stat() {
        return Promise.reject(new Error("missing"));
      },
      readFile() {
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
    findFiles() {
      return Promise.resolve([]);
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
    constructor(startOrLine, startCharacter, endLine, endCharacter) {
      if (typeof startOrLine === "object") {
        this.start = startOrLine;
        this.end = startCharacter;
      } else {
        this.start = { line: startOrLine, character: startCharacter };
        this.end = { line: endLine, character: endCharacter };
      }
    }
  },
  TextEditorRevealType: {
    InCenterIfOutsideViewport: 2,
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
let createConnectedHostRuntimeStatus;
let createRuntimeFailureHostRuntimeStatus;
let createHostContextSnapshot;
let createApplyWorkspaceEditResult;
let handleApplyWorkspaceEditRequest;
let handleIdeActionRequest;
let parseIdeActionRequest;
let createIdeActionResult;
let isInvalidApplyWorkspaceEditRequestMessage;
let isInvalidIdeActionRequestMessage;
let isGuiMessage;
let renderWebviewHtml;
try {
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return fakeVscode;
    }
    if (request === "node:child_process") {
      return fakeChildProcess;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ createHostReady, createConnectedHostRuntimeStatus, createRuntimeFailureHostRuntimeStatus, createHostContextSnapshot, createApplyWorkspaceEditResult, handleApplyWorkspaceEditRequest, handleIdeActionRequest, parseIdeActionRequest, createIdeActionResult, isInvalidApplyWorkspaceEditRequestMessage, isInvalidIdeActionRequestMessage, isGuiMessage, renderWebviewHtml } = await import("../out/webview.js"));
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
const validIdeActionRequests = [
  createIdeActionRequest({ action: "getContextSnapshot" }),
  createIdeActionRequest({ action: "getActiveFileExcerpt" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "hello" }),
  createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "src/main.ts" }),
  createIdeActionRequest({ action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }),
];
const invalidIdeActionRequests = [
  createIdeActionRequest({ action: "runShellCommand", payload: { command: "git status" } }),
  createIdeActionRequest({ action: "gitOperation", payload: { operation: "status" } }),
  createIdeActionRequest({ action: "runTask", payload: { task: "build" } }),
  createIdeActionRequest({ action: "applyEdit", payload: { workspaceRelativePath: "src/main.ts" } }),
  createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "../src/main.ts" }),
  createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "/src/main.ts" }),
  createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "src//main.ts" }),
  createIdeActionRequest({ action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 2, character: 0 }, end: { line: 1, character: 0 } } }),
  createIdeActionRequest({ action: "getContextSnapshot", payload: { includeFileContent: true } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", workspaceRelativePath: "src/main.ts" }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { path: "src/main.ts" } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { glob: "**/*" } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { includeFullFile: true } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { recursive: true } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { indexWorkspace: true } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { provider: "openai" } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { model: "model" } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { auth: "token" } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { tool: "read" } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { shell: "cat" } }),
  createIdeActionRequest({ action: "getActiveFileExcerpt", payload: { git: "show" } }),
  createIdeActionRequest({ action: "runVerificationCommand", commandId: "unknown-command" }),
  createIdeActionRequest({ action: "runVerificationCommand", commandId: "repository-check", payload: { command: "git status" } }),
  createIdeActionRequest({ action: "runVerificationCommand", commandId: "repository-check", payload: { args: ["install"] } }),
  createIdeActionRequest({ action: "runVerificationCommand", commandId: "repository-check", payload: { cwd: "apps/gui" } }),
  createIdeActionRequest({ action: "runVerificationCommand", commandId: "repository-check", payload: { env: { TOKEN: "value" } } }),
  createIdeActionRequest({ action: "runVerificationCommand", commandId: "repository-check", payload: { shell: true } }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "x".repeat(121) }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "*.ts" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "src/path" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "git status" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "regex hello" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "apiKey" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "assistant" }),
  createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "hello", payload: { path: "src/main.ts" } }),
  createIdeActionRequest({ action: "getContextSnapshot", requestId: undefined }),
];
const unsafeEditTextSamples = [
  "Authorization handling",
  "bearer handling",
  "setCookie handling",
  "cookieValue handling",
  "apiKey handling",
  "api-key handling",
  "client_token handling",
  "csrf_token handling",
  "oauthToken handling",
  "xToken handling",
  "access_token handling",
  "refresh_token handling",
  "secret handling",
  "password handling",
  "private_path handling",
  "private-path handling",
  "provider_response handling",
  "provider-response handling",
  "raw_prompt handling",
  "raw-prompt handling",
  "file_content handling",
  "file-content handling",
  "sk-abcdefghijklmnopqrstuvwxyz handling",
  "sk-proj-abcdefghijklmnopqrstuvwxyz handling",
];
const invalidApplyWorkspaceEditRequests = [
  createApplyWorkspaceEditRequest({ summary: "Update /Users" }),
  createApplyWorkspaceEditRequest({ summary: "Update /Users/alice/project/src/main.ts." }),
  createApplyWorkspaceEditRequest({ summary: "Update /home" }),
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
  createApplyWorkspaceEditRequest({ summary: "Update access_token handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update refresh_token handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update id_token handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update authToken handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update providerToken handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update Cookie handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update cookie handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update password handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update provider_response handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update raw_prompt handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update file_content handling." }),
  createApplyWorkspaceEditRequest({ summary: "Update private_path handling." }),
  ...unsafeEditTextSamples.map((sample) => createApplyWorkspaceEditRequest({ summary: `Update ${sample}.` })),
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
for (const message of validIdeActionRequests) {
  assert.equal(isGuiMessage(message), true, `VS Code host should accept strict IDE action request: ${message.payload.action}`);
  assert.notEqual(parseIdeActionRequest(message), undefined, `VS Code host should parse strict IDE action request: ${message.payload.action}`);
}
for (const message of invalidIdeActionRequests) {
  assert.equal(isGuiMessage(message), false, `VS Code host must reject malformed/forbidden IDE action request: ${message.payload.action}`);
  assert.equal(parseIdeActionRequest(message), undefined, `VS Code host must not parse malformed/forbidden IDE action request: ${message.payload.action}`);
}
assert.equal(isGuiMessage(validApplyWorkspaceEditRequest), true, "VS Code host should accept strict confirmed apply requests.");
assert.deepEqual(validIdeActionRequests.map((message) => message.payload.action), ["getContextSnapshot", "getActiveFileExcerpt", "searchWorkspaceSnippets", "openWorkspaceFile", "revealWorkspaceRange"], "VS Code static parity assertions must cover context, active excerpt, snippet search, and controlled navigation surfaces.");
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
assert.equal(isInvalidIdeActionRequestMessage(validIdeActionRequests[0]), false, "VS Code host must not classify valid IDE action requests as invalid correlated rejections.");
assert.equal(isInvalidIdeActionRequestMessage(invalidIdeActionRequests[0]), true, "VS Code host real receive path must identify malformed IDE action requests for correlated rejection.");
assert.equal(isInvalidIdeActionRequestMessage(invalidIdeActionRequests.at(-1)), false, "VS Code host must not correlate invalid IDE action requests without required request ids.");
assert.equal(isInvalidIdeActionRequestMessage({ ...invalidIdeActionRequests[0], requestId: "bad\nrequest" }), false, "VS Code host must not correlate invalid IDE action requests with unsafe request ids.");
assert.equal(isInvalidIdeActionRequestMessage(validApplyWorkspaceEditRequest), false, "VS Code host must not route apply requests through IDE action rejection.");
assert.equal(createIdeActionResult(invalidIdeActionRequests[0].requestId, "rejected", "IDE action rejected by host policy.").requestId, invalidIdeActionRequests[0].requestId, "VS Code host correlated malformed IDE action rejection must preserve safe request id.");
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
assert.equal(hostReady.payload.controlledCapabilities.protocolVersion, "controlled_host_capabilities_v2");
assert.equal(hostReady.payload.controlledCapabilities.hostSurface, "vscode");
assert.equal(hostReady.payload.controlledCapabilities.authority, "metadata_only");
assert.equal(hostReady.payload.controlledCapabilities.capabilities.controlledRead, "supported");
assert.equal(hostReady.payload.controlledCapabilities.capabilities.controlledEdit, "supported");
assert.equal(hostReady.payload.controlledCapabilities.capabilities.controlledVerification, "supported");
assert.equal(hostReady.payload.controlledCapabilities.authorityFlags.metadataOnly, true);
assert.equal(hostReady.payload.controlledCapabilities.authorityFlags.controlledRead, false);
assert.equal(hostReady.payload.controlledCapabilities.authorityFlags.controlledEdit, false);
assert.equal(hostReady.payload.controlledCapabilities.authorityFlags.controlledVerification, false);
assert.equal(hostReady.payload.controlledCapabilities.authorityFlags.shell, false);
assert.equal(hostReady.payload.controlledCapabilities.correlationRequirements.includes("host_ready_request_id"), true);
assert.equal(JSON.stringify(hostReady.payload.controlledCapabilities).includes(connection.sessionToken), false, "controlledCapabilities must not carry session token");
assert.equal(JSON.stringify(hostReady.payload.controlledCapabilities).includes("/Users"), false, "controlledCapabilities must not carry private paths");
const hostRuntimeStatus = createConnectedHostRuntimeStatus(connection, "auto");
assert.equal(hostRuntimeStatus.type, "host.runtimeStatus");
assert.equal(hostRuntimeStatus.requestId, undefined);
assert.equal(hostRuntimeStatus.payload.protocolVersion, "2026-06-21");
assert.equal(hostRuntimeStatus.payload.surface, "vscode");
assert.equal(hostRuntimeStatus.payload.lifecycle, "connected");
assert.equal(hostRuntimeStatus.payload.runtimeOwner, "ide_host");
assert.equal(hostRuntimeStatus.payload.launchMode, "auto");
assert.equal(hostRuntimeStatus.payload.tokenState, "present");
assert.equal(hostRuntimeStatus.payload.processState, "running");
assert.equal(hostRuntimeStatus.payload.cloudRequired, false);
assert.equal(hostRuntimeStatus.payload.authority, "metadata_only");
assert.equal(JSON.stringify(hostRuntimeStatus).includes(connection.runtimeUrl), false, "runtimeStatus must not carry runtime URL");
assert.equal(JSON.stringify(hostRuntimeStatus).includes(connection.sessionToken), false, "runtimeStatus must not carry session token");
const hostRuntimeFailure = createRuntimeFailureHostRuntimeStatus(new Error(`HTTP 401 unauthorized token mismatch ${connection.sessionToken} /Users/private/runtime.sock`), "connect");
assert.equal(hostRuntimeFailure.type, "host.runtimeStatus");
assert.equal(hostRuntimeFailure.payload.lifecycle, "auth_mismatch");
assert.equal(hostRuntimeFailure.payload.tokenState, "mismatch");
assert.equal(JSON.stringify(hostRuntimeFailure).includes(connection.sessionToken), false, "runtimeStatus failure must redact session token");
assert.equal(JSON.stringify(hostRuntimeFailure).includes("/Users/private"), false, "runtimeStatus failure must redact private paths");
assert.throws(
  () => createHostReady(identity, { runtimeUrl: "http://127.0.0.1", sessionToken: connection.sessionToken }, "valid-gui-ready-request"),
  /must include an explicit valid port/,
);
const unsafeTokenHostReady = createHostReady(identity, { runtimeUrl: connection.runtimeUrl, sessionToken: "sk-abcdefghijkl" }, "valid-gui-ready-request");
assert.equal(unsafeTokenHostReady.payload.sessionToken, undefined);
assert.equal(unsafeTokenHostReady.payload.runtimeUrl, connection.runtimeUrl);

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
await assertIdeActionBehavior();

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
assert.equal(createIdeActionResult("req-open-context", "succeeded", "Workspace file opened.", { action: "openWorkspaceFile", workspaceRelativePath: "src/main.ts", context: { hasActiveEditor: true } }).payload.context, undefined);
assert.equal(createIdeActionResult("req-reveal-context", "succeeded", "Workspace range revealed.", { action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, context: { hasActiveEditor: true } }).payload.context, undefined);
for (const privateResultMessage of [
  "Failed at /Users.",
  "Failed at /home.",
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
  "Failed with access_token value.",
  "Failed with refresh_token value.",
  "Failed with id_token value.",
  "Failed with authToken value.",
  "Failed with providerToken value.",
  "Failed with Cookie value.",
  "Failed with cookie value.",
  "Failed with standalone token value.",
  "Failed with password value.",
  "Failed with provider_response details.",
  "Failed with raw_prompt details.",
  "Failed with file_content details.",
  "Failed with private_path details.",
  ...unsafeEditTextSamples.map((sample) => `Failed with ${sample}.`),
]) {
  assert.equal(createApplyWorkspaceEditResult("req-private-result", "failed", privateResultMessage).payload.message, "Edit request status changed.");
  assert.equal(createIdeActionResult("req-private-result", "failed", privateResultMessage).payload.message, "IDE action status changed.");
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

  const escapedGuiDevUrl = guiDevUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expectedIframe = new RegExp(`<iframe title="Yet AI Test GUI" src="${escapedGuiDevUrl}/vscode/hosted-chat\\?yetAiHostedBootstrap=[A-Za-z0-9_-]{32}"></iframe>`);
  if (!expectedIframe.test(httpsGuiDevHtml)) {
    throw new Error(`${label} missing authenticated hosted iframe src.`);
  }

  if (!httpsLoopbackFrameSourcePattern.test(httpsGuiDevHtml)) {
    throw new Error(`${label} missing HTTPS loopback CSP frame-src entries.`);
  }

  assertNoInlineSessionToken(httpsGuiDevHtml, label);
}

function createFakeActiveTextEditor({ fsPath, scheme = "file", languageId, selectionText, selection, visibleRanges, isUntitled = false }) {
  const visibleRange = visibleRanges?.[0] ?? selection;
  const sourceRange = selection.isEmpty ? visibleRange : selection;
  const lineLengths = new Map();
  for (const range of [selection, ...(visibleRanges ?? [])]) {
    lineLengths.set(range.start.line, Math.max(lineLengths.get(range.start.line) ?? 0, range.start.character));
    lineLengths.set(range.end.line, Math.max(lineLengths.get(range.end.line) ?? 0, range.end.character));
  }
  function offsetAt(position) {
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) {
      offset += (lineLengths.get(line) ?? 200) + 1;
    }
    return offset + position.character;
  }
  function positionAt(offset) {
    let remaining = offset;
    for (let line = 0; line < 100; line += 1) {
      const lineLength = lineLengths.get(line) ?? 200;
      if (remaining <= lineLength) {
        return { line, character: remaining };
      }
      remaining -= lineLength + 1;
    }
    return { line: 99, character: Math.max(0, remaining) };
  }
  const expectedTextStartOffset = offsetAt(sourceRange.start);
  return {
    document: {
      uri: { fsPath, scheme, path: fsPath },
      languageId,
      isUntitled,
      lineCount: 100,
      lineAt(line) {
        const length = lineLengths.get(line) ?? 200;
        return {
          text: "x".repeat(length),
          range: {
            start: { line, character: 0 },
            end: { line, character: length },
          },
        };
      },
      offsetAt,
      positionAt,
      getText(range) {
        assert.equal(range.start.line, sourceRange.start.line);
        assert.equal(range.start.character, sourceRange.start.character);
        const requestedLength = offsetAt(range.end) - expectedTextStartOffset;
        return selectionText.slice(0, requestedLength);
      },
    },
    selection,
    visibleRanges: visibleRanges ?? [selection],
  };
}

function createFakeSelection(startLine, startCharacter, endLine, endCharacter) {
  return {
    isEmpty: startLine === endLine && startCharacter === endCharacter,
    active: { line: endLine, character: endCharacter },
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

function createIdeActionRequest(overrides = {}) {
  const payload = {
    action: overrides.action ?? "getContextSnapshot",
    ...(overrides.workspaceRelativePath === undefined ? {} : { workspaceRelativePath: overrides.workspaceRelativePath }),
    ...(overrides.range === undefined ? {} : { range: overrides.range }),
    ...(overrides.commandId === undefined ? {} : { commandId: overrides.commandId }),
    ...(overrides.query === undefined ? {} : { query: overrides.query }),
    ...(overrides.payload ?? {}),
  };
  return {
    version: "2026-05-15",
    type: "gui.ideActionRequest",
    requestId: Object.hasOwn(overrides, "requestId") ? overrides.requestId : `req-ide-action-${payload.action}`,
    payload,
  };
}

async function assertIdeActionBehavior() {
  const existingPath = path.join(workspaceRoot, "src", "main.ts");
  const webviewMessages = [];
  const testWebview = {
    postMessage(message) {
      webviewMessages.push(message);
      return Promise.resolve(true);
    },
  };

  fakeVscode.__shownDocuments = [];
  fakeVscode.__revealedRanges = [];
  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } }];
  fakeVscode.workspace.fs.stat = (uri) => uri.fsPath === existingPath ? Promise.resolve({ type: fakeVscode.FileType.File, size: 1024 }) : Promise.reject(new Error("missing"));
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
  let applyCalls = 0;
  fakeVscode.workspace.applyEdit = () => {
    applyCalls += 1;
    return Promise.resolve(true);
  };

  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "runShellCommand", payload: { command: "git status" } }));
  assert.equal(webviewMessages.at(-1).type, "host.ideActionResult");
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");

  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "../src/main.ts" }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");

  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "src/missing.ts" }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");

  let openTextDocumentCalls = 0;
  const originalOpenTextDocument = fakeVscode.workspace.openTextDocument;
  fakeVscode.workspace.fs.stat = (uri) => uri.fsPath === existingPath ? Promise.resolve({ type: fakeVscode.FileType.File, size: (2 * 1024 * 1024) + 1 }) : Promise.reject(new Error("missing"));
  fakeVscode.workspace.openTextDocument = (uri) => {
    openTextDocumentCalls += 1;
    return originalOpenTextDocument(uri);
  };
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "src/main.ts" }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(openTextDocumentCalls, 0, "Controlled IDE action oversized files must be rejected before openTextDocument.");
  fakeVscode.workspace.fs.stat = (uri) => uri.fsPath === existingPath ? Promise.resolve({ type: fakeVscode.FileType.File, size: 1024 }) : Promise.reject(new Error("missing"));
  fakeVscode.workspace.openTextDocument = originalOpenTextDocument;

  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 0, character: 8 }, end: { line: 0, character: 2 } } }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");

  fakeVscode.workspace.workspaceFolders = undefined;
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "src/main.ts" }));
  assert.equal(webviewMessages.at(-1).payload.status, "unavailable");

  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } }];
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "openWorkspaceFile", workspaceRelativePath: "src/main.ts" }));
  assert.equal(webviewMessages.at(-1).payload.status, "succeeded");
  assert.equal(fakeVscode.__shownDocuments.length, 1);

  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }));
  assert.equal(webviewMessages.at(-1).payload.status, "succeeded");
  assert.equal(fakeVscode.__revealedRanges.length, 1);

  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getContextSnapshot" }));
  assert.equal(webviewMessages.at(-1).payload.status, "succeeded");
  assert.equal(webviewMessages.at(-1).payload.context.source, "vscode");

  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "runVerificationCommand", commandId: "repository-check", payload: { command: "npm run check", cwd: "/Users/private/workspace", env: { TOKEN: "secret" } } }));
  assert.equal(webviewMessages.at(-1).type, "host.ideActionResult");
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(webviewMessages.at(-1).payload.message, "IDE action rejected by host policy.");
  assert.equal(JSON.stringify(webviewMessages.at(-1)).includes("npm"), false, "S84 verification rejection must not echo command text.");
  assert.equal(JSON.stringify(webviewMessages.at(-1)).includes("/Users"), false, "S84 verification rejection must not echo cwd.");
  assert.equal(JSON.stringify(webviewMessages.at(-1)).includes("TOKEN"), false, "S84 verification rejection must not echo env.");
  assert.equal(fakeChildProcess.calls.length, 0, "S84 verification command request must not spawn.");

  const searchablePath = path.join(workspaceRoot, "src", "searchable.txt");
  const earlierSearchablePath = path.join(workspaceRoot, "docs", "earlier.ts");
  const remoteSearchablePath = path.join(workspaceRoot, "src", "remote.txt");
  const excludedPath = path.join(workspaceRoot, "node_modules", "hidden.txt");
  const binaryPath = path.join(workspaceRoot, "src", "binary.txt");
  const secretPath = path.join(workspaceRoot, "src", "secretish.txt");
  let findFilesCalls = 0;
  let readFileCalls = 0;
  fakeVscode.workspace.findFiles = (include, exclude, maxResults) => {
    findFilesCalls += 1;
    assert.equal(include.pattern, "**/*");
    assert.equal(exclude, "{**/.git/**,**/node_modules/**,**/dist/**,**/target/**,**/build/**,**/cache/**}");
    assert.equal(maxResults, 500);
    return Promise.resolve([
      { fsPath: searchablePath, scheme: "file", path: searchablePath },
      { fsPath: remoteSearchablePath, scheme: "vscode-remote", path: remoteSearchablePath },
      { fsPath: earlierSearchablePath, scheme: "file", path: earlierSearchablePath },
      { fsPath: excludedPath, scheme: "file", path: excludedPath },
      { fsPath: binaryPath, scheme: "file", path: binaryPath },
      { fsPath: secretPath, scheme: "file", path: secretPath },
    ]);
  };
  fakeVscode.workspace.fs.stat = (uri) => Promise.resolve({ type: fakeVscode.FileType.File, size: 1024 });
  fakeVscode.workspace.fs.readFile = (uri) => {
    readFileCalls += 1;
    if (uri.fsPath === binaryPath) {
      return Promise.resolve(Buffer.from("hello\u0000binary"));
    }
    if (uri.fsPath === secretPath) {
      return Promise.resolve(Buffer.from("hello Authorization Bearer fake-session-token-webview-behavioral-sentinel"));
    }
    if (uri.fsPath === earlierSearchablePath) {
      return Promise.resolve(Buffer.from("alpha hello line"));
    }
    return Promise.resolve(Buffer.from("first hello line\nsecond hello line\nthird hello line"));
  };
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "hello" }));
  assert.equal(webviewMessages.at(-1).payload.status, "succeeded");
  assert.equal(webviewMessages.at(-1).payload.action, "searchWorkspaceSnippets");
  assert.equal(webviewMessages.at(-1).payload.queryLabel, "hello");
  assert.equal(webviewMessages.at(-1).payload.resultCount, 4);
  assert.equal(webviewMessages.at(-1).payload.snippets.length, 4);
  assert.deepEqual(webviewMessages.at(-1).payload.snippets.map((snippet) => snippet.workspaceRelativePath), ["docs/earlier.ts", "src/searchable.txt", "src/searchable.txt", "src/searchable.txt"]);
  assert.equal(webviewMessages.at(-1).payload.snippets[0].languageId, "typescript");
  assert.equal(webviewMessages.at(-1).payload.snippets[0].text.length <= 400, true);
  assert.equal(findFilesCalls, 1);
  assert.equal(readFileCalls, 3, "Excluded and non-file-scheme workspace snippet paths must not be read.");

  fakeVscode.workspace.workspaceFolders = [
    { uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } },
    { uri: { fsPath: path.join(workspaceRoot, "other"), scheme: "file", path: path.join(workspaceRoot, "other") } },
  ];
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "searchWorkspaceSnippets", query: "hello" }));
  assert.equal(webviewMessages.at(-1).payload.status, "unavailable");
  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } }];

  fakeVscode.window.activeTextEditor = undefined;
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getActiveFileExcerpt" }));
  assert.equal(webviewMessages.at(-1).payload.status, "unavailable");
  assert.equal(webviewMessages.at(-1).payload.contextAttachment, undefined);

  fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
    fsPath: path.join(workspaceRoot, "src", "main.ts"),
    languageId: "typescript",
    selectionText: "const visible = true;\n",
    selection: createFakeSelection(0, 0, 0, 0),
    visibleRanges: [createFakeSelection(2, 0, 2, 21)],
  });
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getActiveFileExcerpt" }));
  assert.equal(webviewMessages.at(-1).payload.status, "succeeded");
  assert.deepEqual(webviewMessages.at(-1).payload.contextAttachment, {
    kind: "active_file_excerpt",
    source: "vscode",
    file: {
      displayPath: "src/main.ts",
      workspaceRelativePath: "src/main.ts",
      languageId: "typescript",
    },
    range: {
      start: { line: 2, character: 0 },
      end: { line: 2, character: 21 },
    },
    text: "const visible = true;",
    truncated: false,
  });

  fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
    fsPath: path.join(workspaceRoot, "src", "main.ts"),
    languageId: "typescript",
    selectionText: "x".repeat(8001),
    selection: createFakeSelection(0, 0, 0, 0),
    visibleRanges: [createFakeSelection(0, 0, 0, 9000)],
  });
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getActiveFileExcerpt" }));
  assert.equal(webviewMessages.at(-1).payload.status, "succeeded");
  assert.equal(webviewMessages.at(-1).payload.contextAttachment.text.length, 8000);
  assert.deepEqual(webviewMessages.at(-1).payload.contextAttachment.range, { start: { line: 0, character: 0 }, end: { line: 0, character: 8000 } });
  assert.equal(webviewMessages.at(-1).payload.contextAttachment.truncated, true);

  fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
    fsPath: path.join(workspaceRoot, "src", "main.ts"),
    languageId: "typescript",
    selectionText: "selected text",
    selection: createFakeSelection(1, 2, 1, 15),
    visibleRanges: [createFakeSelection(0, 0, 0, 9000)],
  });
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getActiveFileExcerpt" }));
  assert.equal(webviewMessages.at(-1).payload.status, "succeeded");
  assert.deepEqual(webviewMessages.at(-1).payload.contextAttachment.range, { start: { line: 1, character: 2 }, end: { line: 1, character: 15 } });
  assert.equal(webviewMessages.at(-1).payload.contextAttachment.text, "selected text");

  fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
    fsPath: path.join(workspaceRoot, "src", "empty.ts"),
    languageId: "typescript",
    selectionText: "",
    selection: createFakeSelection(0, 0, 0, 0),
    visibleRanges: [createFakeSelection(0, 0, 0, 0)],
  });
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getActiveFileExcerpt" }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");

  fakeVscode.workspace.workspaceFolders = [
    { uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } },
    { uri: { fsPath: path.join(workspaceRoot, "src"), scheme: "file", path: path.join(workspaceRoot, "src") } },
  ];
  fakeVscode.window.activeTextEditor = createFakeActiveTextEditor({
    fsPath: path.join(workspaceRoot, "src", "main.ts"),
    languageId: "typescript",
    selectionText: "const ambiguous = true;",
    selection: createFakeSelection(0, 0, 0, 0),
    visibleRanges: [createFakeSelection(0, 0, 0, 23)],
  });
  await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getActiveFileExcerpt" }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot, scheme: "file", path: workspaceRoot } }];

  for (const editor of [
    createFakeActiveTextEditor({ fsPath: path.join(workspaceRoot, "src", "main.ts"), scheme: "untitled", languageId: "typescript", selectionText: "const visible = true;", selection: createFakeSelection(0, 0, 0, 0), visibleRanges: [createFakeSelection(0, 0, 0, 21)] }),
    createFakeActiveTextEditor({ fsPath: path.join(workspaceRoot, "src", "main.ts"), scheme: "vscode-remote", languageId: "typescript", selectionText: "const visible = true;", selection: createFakeSelection(0, 0, 0, 0), visibleRanges: [createFakeSelection(0, 0, 0, 21)] }),
    createFakeActiveTextEditor({ fsPath: "/Users/example/private/outside.ts", languageId: "typescript", selectionText: "const visible = true;", selection: createFakeSelection(0, 0, 0, 0), visibleRanges: [createFakeSelection(0, 0, 0, 21)] }),
    createFakeActiveTextEditor({ fsPath: path.join(workspaceRoot, "src", "main.ts"), languageId: "typescript", selectionText: "Authorization Bearer fake-session-token-webview-behavioral-sentinel", selection: createFakeSelection(0, 0, 0, 0), visibleRanges: [createFakeSelection(0, 0, 0, 64)] }),
    createFakeActiveTextEditor({ fsPath: path.join(workspaceRoot, "src", "main.ts"), languageId: "typescript", selectionText: "private path /Users/example/project", selection: createFakeSelection(0, 0, 0, 0), visibleRanges: [createFakeSelection(0, 0, 0, 33)] }),
    createFakeActiveTextEditor({ fsPath: path.join(workspaceRoot, "src", "main.ts"), languageId: "typescript", selectionText: "binary\u0000text", selection: createFakeSelection(0, 0, 0, 0), visibleRanges: [createFakeSelection(0, 0, 0, 11)] }),
  ]) {
    fakeVscode.window.activeTextEditor = editor;
    await handleIdeActionRequest(testWebview, createIdeActionRequest({ action: "getActiveFileExcerpt" }));
    assert.equal(webviewMessages.at(-1).payload.status, "rejected");
    assert.equal(webviewMessages.at(-1).payload.contextAttachment, undefined);
  }
  assert.equal(applyCalls, 0, "Controlled IDE actions must not apply workspace edits.");
  assertNoSecretSentinels(JSON.stringify(webviewMessages), fakeSecretValues, "VS Code IDE action messages");
  assertNoAbsolutePath(JSON.stringify(webviewMessages), "VS Code IDE action messages");

  fakeVscode.workspace.workspaceFolders = undefined;
  fakeVscode.window.showWarningMessage = () => Promise.resolve(undefined);
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
      return Promise.resolve({ type: fakeVscode.FileType.File, size: 1024 });
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
    textReplacements: [
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, replacementText: "!" },
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, replacementText: "?" },
    ],
  }));
  assert.equal(webviewMessages.at(-1).payload.status, "rejected");
  assert.equal(warningCalls, 0);
  assert.equal(applyCalls, 0);

  await handleApplyWorkspaceEditRequest(testWebview, createApplyWorkspaceEditRequest({
    textReplacements: [
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, replacementText: "!" },
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } }, replacementText: "wa" },
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
      return Promise.resolve({ type: fakeVscode.FileType.File, size: 1024 });
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
      return Promise.resolve({ type: fakeVscode.FileType.File, size: 1024 });
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
