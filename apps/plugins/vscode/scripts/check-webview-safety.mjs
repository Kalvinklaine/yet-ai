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
let createHostReady;
let renderWebviewHtml;
try {
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return {
        Uri: {
          joinPath(base, ...segments) {
            return { fsPath: path.join(base.fsPath, ...segments) };
          },
          parse(value) {
            return { fsPath: value };
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ createHostReady, renderWebviewHtml } = await import("../out/webview.js"));
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
const hostReady = createHostReady(identity, connection, "valid-gui-ready-request");

assert.equal(hostReady.version, "2026-05-15");
assert.equal(hostReady.type, "host.ready");
assert.equal(hostReady.requestId, "valid-gui-ready-request");
assert.equal(hostReady.payload.runtimeUrl, connection.runtimeUrl);
assert.equal(hostReady.payload.sessionToken, connection.sessionToken);
assert.equal(hostReady.payload.cloudRequired, false);

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
</head>
<body>
  <main data-yet-ai-packaged-gui-marker="behavioral-safety-check">Fake packaged GUI marker</main>
  <link rel="stylesheet" href="./assets/app.css">
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
