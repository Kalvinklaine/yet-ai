import * as vscode from "vscode";
import { EngineConnection } from "./engineConnection";
import { ProductIdentity, bridgeVersion } from "./identity";

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

  panel.webview.html = renderWebviewHtml(panel.webview, identity, connection);
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!isGuiMessage(message)) {
      console.log("Yet AI rejected invalid GUI bridge message");
      return;
    }
    console.log(`Yet AI received ${message.type}`);
    if (message.type === "gui.ready") {
      void panel.webview.postMessage(createHostReady(identity, connection));
      void panel.webview.postMessage({
        version: bridgeVersion,
        type: "host.openedFromCommand",
        payload: {},
      } satisfies HostMessage);
    }
  });
}

function createHostReady(identity: ProductIdentity, connection: EngineConnection): HostMessage {
  return {
    version: bridgeVersion,
    type: "host.ready",
    payload: {
      productId: identity.product.id,
      displayName: identity.product.displayName,
      runtimeUrl: connection.runtimeUrl,
      sessionToken: connection.sessionToken,
      cloudRequired: false,
    },
  };
}

function renderWebviewHtml(
  webview: vscode.Webview,
  identity: ProductIdentity,
  connection: EngineConnection,
): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify({
    bridgeVersion,
    productId: identity.product.id,
    displayName: identity.product.displayName,
    runtimeUrl: connection.runtimeUrl,
    sessionToken: connection.sessionToken,
    cloudRequired: false,
  }).replace(/</g, "\\u003c");
  const frameSource = connection.guiDevUrl ? `<iframe title="${escapeHtml(identity.vscode.displayName)} GUI" src="${escapeHtml(connection.guiDevUrl)}"></iframe>` : "";
  const placeholder = connection.guiDevUrl
    ? ""
    : `<main><h1>${escapeHtml(identity.vscode.displayName)}</h1><p>Local runtime shell is ready.</p><p>Runtime: <code>${escapeHtml(connection.runtimeUrl)}</code></p><p>Set <code>yetai.guiDevUrl</code> to a loopback Vite dev server to host the GUI during development.</p></main>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-src http://127.0.0.1:* http://localhost:* http://[::1]:*;">
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
${placeholder}${frameSource}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const bootstrap = ${bootstrap};
window.yetAiBootstrap = bootstrap;
const frame = document.querySelector("iframe");
const sendToFrame = (message) => {
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(message, "*");
  }
};
vscode.postMessage({ version: bootstrap.bridgeVersion, type: "gui.ready", payload: { supportedBridgeVersion: bootstrap.bridgeVersion } });
window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "host.ready") {
    console.log("Yet AI host ready", event.data.payload);
    sendToFrame(event.data);
  }
});
if (frame) {
  frame.addEventListener("load", () => sendToFrame({ version: bootstrap.bridgeVersion, type: "host.ready", payload: bootstrap }));
}
</script>
</body>
</html>`;
}

function isGuiMessage(value: unknown): value is GuiMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    record.version.length > 0 &&
    record.type === "gui.ready" &&
    (record.requestId === undefined || (typeof record.requestId === "string" && record.requestId.length > 0)) &&
    (record.payload === undefined || (typeof record.payload === "object" && record.payload !== null && !Array.isArray(record.payload)))
  );
}

function createNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => {
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
