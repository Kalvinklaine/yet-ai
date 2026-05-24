import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "src/webview.ts"), "utf8");

const requiredSnippets = [
  "record.version === bridgeVersion",
  "record.type === \"gui.ready\"",
  "frame.contentWindow.postMessage(message, frameTargetOrigin)",
  "event.origin !== frameTargetOrigin",
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
];

for (const snippet of forbiddenSnippets) {
  if (source.includes(snippet)) {
    throw new Error(`VS Code webview safety check forbids: ${snippet}`);
  }
}
