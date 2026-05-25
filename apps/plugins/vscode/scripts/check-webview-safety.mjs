import fs from "node:fs";
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
