import * as vscode from "vscode";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { EngineConnection, getLoopbackOrigin } from "./engineConnection";
import { ProductIdentity, bridgeVersion, configurationPrefix } from "./identity";

export type HostMessage = {
  version: string;
  type: "host.ready" | "host.openedFromCommand" | "host.contextSnapshot";
  requestId?: string;
  payload?: Record<string, unknown>;
};

type HostContextPayload = {
  kind: "active_editor";
  source: "vscode";
  file?: {
    displayPath?: string;
    workspaceRelativePath?: string;
    languageId?: string;
  };
  selection?: {
    startLine?: number;
    startCharacter?: number;
    endLine?: number;
    endCharacter?: number;
    text?: string;
  };
};

type GuiMessage = {
  version: string;
  type: "gui.ready";
  requestId?: string;
  payload?: Record<string, unknown>;
};

export function openYetAiWebview(
  context: vscode.ExtensionContext,
  identity: ProductIdentity,
  connection: EngineConnection,
): void {
  const panel = vscode.window.createWebviewPanel(
    "yetAiChat",
    identity.vscode.displayName,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    },
  );

  panel.webview.html = renderWebviewHtml(panel.webview, context.extensionUri, identity, connection);
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isGuiMessage(message)) {
      console.log("Yet AI rejected invalid GUI bridge message");
      return;
    }
    console.log(`Yet AI received ${message.type}`);
    void panel.webview.postMessage(createHostReady(identity, connection, message.requestId));
    void panel.webview.postMessage({
      version: bridgeVersion,
      type: "host.openedFromCommand",
      payload: {},
    } satisfies HostMessage);
    void panel.webview.postMessage(createHostContextSnapshot(message.requestId));
  });
}

export function createHostReady(
  identity: ProductIdentity,
  connection: EngineConnection,
  requestId: string | undefined,
): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.ready",
    requestId,
    payload: {
      productId: identity.product.id,
      displayName: identity.product.displayName,
      runtimeUrl: connection.runtimeUrl,
      sessionToken: connection.sessionToken,
      cloudRequired: false,
    },
  };
}

export function createHostContextSnapshot(requestId: string | undefined): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.contextSnapshot",
    requestId,
    payload: createActiveEditorContextPayload(),
  };
}

function createActiveEditorContextPayload(): HostContextPayload {
  const payload: HostContextPayload = {
    kind: "active_editor",
    source: "vscode",
  };
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return payload;
  }

  const file = createActiveEditorFileContext(editor.document);
  if (file) {
    payload.file = file;
  }

  const selection = createActiveEditorSelectionContext(editor.document, editor.selection);
  if (selection) {
    payload.selection = selection;
  }

  return payload;
}

function createActiveEditorFileContext(document: vscode.TextDocument): HostContextPayload["file"] | undefined {
  const file: NonNullable<HostContextPayload["file"]> = {};
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspaceRelativePath = workspaceFolder ? sanitizeRelativePath(vscode.workspace.asRelativePath(document.uri, false), 512) : undefined;
  const displayPath = workspaceRelativePath ?? sanitizeDisplayPath(getDocumentDisplayLabel(document));
  const languageId = sanitizeLanguageId(document.languageId);

  if (displayPath) {
    file.displayPath = displayPath;
  }
  if (workspaceRelativePath) {
    file.workspaceRelativePath = workspaceRelativePath;
  }
  if (languageId) {
    file.languageId = languageId;
  }

  return Object.keys(file).length > 0 ? file : undefined;
}

function createActiveEditorSelectionContext(document: vscode.TextDocument, selection: vscode.Selection): HostContextPayload["selection"] | undefined {
  if (selection.isEmpty) {
    return undefined;
  }
  const startLine = sanitizePositionNumber(selection.start.line);
  const startCharacter = sanitizePositionNumber(selection.start.character);
  const endLine = sanitizePositionNumber(selection.end.line);
  const endCharacter = sanitizePositionNumber(selection.end.character);
  if (startLine === undefined || startCharacter === undefined || endLine === undefined || endCharacter === undefined) {
    return undefined;
  }

  const text = sanitizeSelectionText(document.getText(selection));
  const result: NonNullable<HostContextPayload["selection"]> = {
    startLine,
    startCharacter,
    endLine,
    endCharacter,
  };
  if (text !== undefined) {
    result.text = text;
  }
  return result;
}

export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  identity: ProductIdentity,
  connection: EngineConnection,
): string {
  const nonce = createNonce();
  const guiDevOrigin = connection.guiDevUrl
    ? getLoopbackOrigin(connection.guiDevUrl, `${configurationPrefix}.guiDevUrl`)
    : undefined;
  const packagedGui = connection.guiDevUrl ? undefined : findPackagedGui(extensionUri);
  const bootstrap = serializeScriptJson({
    bridgeVersion,
    requestId: createRequestId(),
    productId: identity.product.id,
    displayName: identity.product.displayName,
    runtimeUrl: connection.runtimeUrl,
    cloudRequired: false,
    guiDevOrigin,
  });
  const frameSource = connection.guiDevUrl
    ? `<iframe title="${escapeHtml(identity.vscode.displayName)} GUI" src="${escapeHtml(connection.guiDevUrl)}"></iframe>`
    : "";
  const placeholder = connection.guiDevUrl || packagedGui ? "" : `<main><h1>${escapeHtml(identity.vscode.displayName)}</h1><p>Local runtime shell is ready.</p><p>Runtime: <code>${escapeHtml(connection.runtimeUrl)}</code></p><p>Run <code>cd apps/gui && npm run build</code> and <code>cd apps/plugins/vscode && npm run copy:gui</code> to package the GUI, or set <code>yetai.guiDevUrl</code> to a loopback Vite dev server during development.</p></main>`;
  const packagedGuiHtml = packagedGui ? rewritePackagedGuiHtml(packagedGui.html, packagedGui.root, webview) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src ${webview.cspSource} 'nonce-${nonce}'; connect-src http://127.0.0.1:* http://localhost:* http://[::1]:* https://127.0.0.1:* https://localhost:* https://[::1]:*; frame-src http://127.0.0.1:* http://localhost:* http://[::1]:* https://127.0.0.1:* https://localhost:* https://[::1]:*;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(identity.vscode.displayName)}</title>
<style nonce="${nonce}">
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
main { padding: 24px; }
code { color: var(--vscode-textLink-foreground); }
iframe { width: 100vw; height: 100vh; border: 0; }
</style>
</head>
<body>
${placeholder}${frameSource}${packagedGuiHtml}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const bootstrap = ${bootstrap};
window.yetAiBootstrap = bootstrap;
const frame = document.querySelector("iframe");
const frameTargetOrigin = bootstrap.guiDevOrigin;
let latestHostReady;
let frameReady = false;
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isBoundedRequestId = (value) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 128);
const isStrictGuiReadyPayload = (payload) => {
  if (payload === undefined) {
    return true;
  }
  return isPlainObject(payload) && Object.keys(payload).every((key) => key === "supportedBridgeVersion") && (payload.supportedBridgeVersion === undefined || payload.supportedBridgeVersion === bootstrap.bridgeVersion);
};
const isFrameGuiMessage = (message) => isPlainObject(message) && Object.keys(message).every((key) => key === "version" || key === "type" || key === "requestId" || key === "payload") && message.version === bootstrap.bridgeVersion && message.type === "gui.ready" && isBoundedRequestId(message.requestId) && isStrictGuiReadyPayload(message.payload);
const isHostMessage = (message) => isPlainObject(message) && message.version === bootstrap.bridgeVersion && (message.type === "host.ready" || message.type === "host.openedFromCommand" || message.type === "host.contextSnapshot");
const sendToFrame = (message) => {
  if (frame && frame.contentWindow && frameTargetOrigin) {
    frame.contentWindow.postMessage(message, frameTargetOrigin);
  }
};
const replayHostReady = () => {
  if (frameReady && latestHostReady) {
    sendToFrame(latestHostReady);
  }
};
vscode.postMessage({ version: bootstrap.bridgeVersion, type: "gui.ready", requestId: bootstrap.requestId, payload: { supportedBridgeVersion: bootstrap.bridgeVersion } });
window.addEventListener("message", (event) => {
  if (event.source === frame?.contentWindow) {
    if (event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isFrameGuiMessage(event.data)) {
      frameReady = true;
      vscode.postMessage(event.data);
      replayHostReady();
    } else {
      console.log("Yet AI rejected invalid iframe GUI bridge message");
    }
    return;
  }
  if (isHostMessage(event.data)) {
    console.log("Yet AI host message", event.data.type);
    if (event.data.type === "host.ready") {
      latestHostReady = event.data;
      replayHostReady();
      return;
    }
    sendToFrame(event.data);
  }
});
</script>
</body>
</html>`;
}

type PackagedGui = {
  root: vscode.Uri;
  html: string;
};

function findPackagedGui(extensionUri: vscode.Uri): PackagedGui | undefined {
  const root = vscode.Uri.joinPath(extensionUri, "media", "gui");
  const index = vscode.Uri.joinPath(root, "index.html");
  try {
    return {
      root,
      html: fs.readFileSync(index.fsPath, "utf8"),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function rewritePackagedGuiHtml(html: string, root: vscode.Uri, webview: vscode.Webview): string {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  return `${rewritePackagedGuiHeadAssets(head, root, webview)}${rewritePackagedGuiAssetReferences(body, root, webview)}`;
}

function rewritePackagedGuiHeadAssets(head: string, root: vscode.Uri, webview: vscode.Webview): string {
  const assets: string[] = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = getHtmlAttribute(tag, "rel");
    const href = getHtmlAttribute(tag, "href");
    if (rel?.toLowerCase() === "stylesheet" && href && resolvePackagedAssetUri(href, root, webview)) {
      assets.push(rewritePackagedGuiAssetReferences(tag, root, webview));
    }
  }
  for (const match of head.matchAll(/<script\b[^>]*\bsrc=("|').+?\1[^>]*><\/script>/gi)) {
    const tag = match[0];
    const src = getHtmlAttribute(tag, "src");
    if (src && resolvePackagedAssetUri(src, root, webview)) {
      assets.push(rewritePackagedGuiAssetReferences(tag, root, webview));
    }
  }
  return assets.join("\n");
}

function rewritePackagedGuiAssetReferences(html: string, root: vscode.Uri, webview: vscode.Webview): string {
  return html.replace(/\b(src|href)=("|')(.+?)\2/g, (_match: string, attribute: string, quote: string, value: string) => {
    const uri = resolvePackagedAssetUri(value, root, webview);
    return `${attribute}=${quote}${uri ?? value}${quote}`;
  });
}

function getHtmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=("|')(.+?)\\1`, "i"));
  return match?.[2];
}

function resolvePackagedAssetUri(value: string, root: vscode.Uri, webview: vscode.Webview): string | undefined {
  if (!value.startsWith("./") && !value.startsWith("/")) {
    return undefined;
  }
  if (value.length === 0 || value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")) {
    return undefined;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (decoded.includes("\\") || decoded.includes("?") || decoded.includes("#")) {
    return undefined;
  }

  const relativePath = decoded.replace(/^\.\//, "").replace(/^\//, "");
  if (relativePath.length === 0 || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relativePath)) {
    return undefined;
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }

  return webview.asWebviewUri(vscode.Uri.joinPath(root, ...segments)).toString();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function getDocumentDisplayLabel(document: vscode.TextDocument): string | undefined {
  if (document.isUntitled) {
    return sanitizeDisplayPath(path.posix.basename(document.uri.path)) ?? "untitled";
  }
  if (document.uri.scheme === "file") {
    return path.basename(document.uri.fsPath);
  }
  return path.posix.basename(document.uri.path);
}

function sanitizeLanguageId(value: string): string | undefined {
  if (/^[A-Za-z0-9_.+-]{1,64}$/.test(value)) {
    return value;
  }
  return undefined;
}

function sanitizePositionNumber(value: number): number | undefined {
  if (Number.isInteger(value) && value >= 0 && value <= 1000000) {
    return value;
  }
  return undefined;
}

function sanitizeSelectionText(value: string): string | undefined {
  if (value.length === 0 || value.length > 8000 || hasSecretLikeText(value) || hasBinaryLikeText(value)) {
    return undefined;
  }
  return value;
}

function sanitizeDisplayPath(value: string | undefined): string | undefined {
  return sanitizeSafePath(value, 256);
}

function sanitizeRelativePath(value: string | undefined, maxLength: number): string | undefined {
  return sanitizeSafePath(value, maxLength);
}

function sanitizeSafePath(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replaceAll(path.sep, "/");
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    /[\u0000-\u001f]/.test(normalized) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(normalized) ||
    hasSecretLikeText(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function hasSecretLikeText(value: string): boolean {
  return /(?:authorization|bearer\s+|sessiontoken|session[_-]?token|api[_-]?key|secret|sk-[A-Za-z0-9_-]+)/i.test(value);
}

function hasBinaryLikeText(value: string): boolean {
  return value.includes("\u0000") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

export function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function isGuiMessage(value: unknown): value is GuiMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, ["version", "type", "requestId", "payload"]) &&
    record.version === bridgeVersion &&
    record.type === "gui.ready" &&
    isBoundedRequestId(record.requestId) &&
    isGuiReadyPayload(record.payload)
  );
}

export function createNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function isBoundedRequestId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 128);
}

function isGuiReadyPayload(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return hasOnlyKeys(record, ["supportedBridgeVersion"]) && (record.supportedBridgeVersion === undefined || record.supportedBridgeVersion === bridgeVersion);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${createNonce()}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
