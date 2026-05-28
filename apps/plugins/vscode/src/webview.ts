import * as vscode from "vscode";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { EngineConnection, getLoopbackOrigin } from "./engineConnection";
import { ProductIdentity, bridgeVersion, configurationPrefix } from "./identity";

export type HostMessage = {
  version: string;
  type: "host.ready" | "host.openedFromCommand";
  requestId?: string;
  payload?: Record<string, unknown>;
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
const isHostMessage = (message) => isPlainObject(message) && message.version === bootstrap.bridgeVersion && (message.type === "host.ready" || message.type === "host.openedFromCommand");
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
