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
  "hasOnlyKeys(record, [\"version\", \"type\", \"requestId\", \"payload\"])",
  "hasOnlyKeys(record, [\"supportedBridgeVersion\"])",
  "record.supportedBridgeVersion === undefined || record.supportedBridgeVersion === bridgeVersion",
  "isBoundedRequestId(record.requestId)",
  "frame.contentWindow.postMessage(message, frameTargetOrigin)",
  "event.origin !== frameTargetOrigin",
  "isFrameGuiMessage(event.data)",
  "latestHostReady = event.data",
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

if (!/const isBoundedRequestId = \(value\) => value === undefined \|\| \(typeof value === "string" && value\.length > 0 && value\.length <= 128\);/.test(renderWebviewHtmlSource)) {
  throw new Error("VS Code webview wrapper must enforce bounded non-empty gui.ready requestId values.");
}

if (!/Object\.keys\(message\)\.every\(\(key\) => key === "version" \|\| key === "type" \|\| key === "requestId" \|\| key === "payload"\)/.test(renderWebviewHtmlSource)) {
  throw new Error("VS Code webview wrapper must reject gui.ready messages with extra top-level fields.");
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      Uri: {
        joinPath(base, ...segments) {
          return { fsPath: path.join(base.fsPath, ...segments) };
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { renderWebviewHtml } = await import("../out/webview.js");
Module._load = originalLoad;

const fakeSecretValues = [
  "fake-session-token-webview-behavioral-sentinel",
  "sk-webview-behavioral-provider-key-sentinel",
  "Bearer fake-session-token-webview-behavioral-sentinel",
  "Authorization",
  "sessionToken",
  "connection.sessionToken",
];

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
</head>
<body>
  <main data-yet-ai-packaged-gui-marker="behavioral-safety-check">Fake packaged GUI marker</main>
  <link rel="stylesheet" href="./assets/app.css">
  <script type="module" src="/assets/app.js"></script>
</body>
</html>`,
  );
  fs.writeFileSync(path.join(fakeGuiRoot, "assets", "app.js"), "window.fakeYetAiPackagedGui = true;\n");
  fs.writeFileSync(path.join(fakeGuiRoot, "assets", "app.css"), "body { color: var(--vscode-foreground); }\n");

  const html = renderWebviewHtml(
    {
      cspSource: "vscode-resource://yet-ai-test",
      asWebviewUri(uri) {
        return {
          toString() {
            return `vscode-resource://yet-ai-test/${path.relative(tempExtensionRoot, uri.fsPath).replaceAll(path.sep, "/")}`;
          },
        };
      },
    },
    { fsPath: tempExtensionRoot },
    {
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
    },
    {
      runtimeUrl: "http://127.0.0.1:8025",
      sessionToken: "fake-session-token-webview-behavioral-sentinel",
      providerApiKey: "sk-webview-behavioral-provider-key-sentinel",
      headers: {
        Authorization: "Bearer fake-session-token-webview-behavioral-sentinel",
      },
    },
  );

  for (const value of fakeSecretValues) {
    if (html.includes(value)) {
      throw new Error(`VS Code behavioral webview render leaked secret sentinel: ${value}`);
    }
  }

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
      throw new Error(`VS Code behavioral webview render missing expected safety structure: ${pattern}`);
    }
  }

  if (!html.includes('data-yet-ai-packaged-gui-marker="behavioral-safety-check"')) {
    throw new Error("VS Code behavioral webview render did not use the packaged GUI path.");
  }

  if (html.includes("Local runtime shell is ready")) {
    throw new Error("VS Code behavioral webview render unexpectedly used the fallback placeholder path.");
  }

  const expectedAssetUris = [
    'href="vscode-resource://yet-ai-test/media/gui/assets/app.css"',
    'src="vscode-resource://yet-ai-test/media/gui/assets/app.js"',
  ];
  for (const expectedAssetUri of expectedAssetUris) {
    if (!html.includes(expectedAssetUri)) {
      throw new Error(`VS Code behavioral webview render did not rewrite packaged asset URI: ${expectedAssetUri}`);
    }
  }

  if (/sessionToken\s*:/.test(html) || /"sessionToken"/.test(html)) {
    throw new Error("VS Code behavioral webview render must not expose inline sessionToken data.");
  }
} finally {
  fs.rmSync(tempExtensionRoot, { recursive: true, force: true });
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
