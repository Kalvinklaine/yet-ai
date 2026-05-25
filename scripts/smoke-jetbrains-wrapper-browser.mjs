import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const requiredVisibleText = ["Yet AI", "Local runtime connection", "Provider setup", "Chat", "Bridge debug"];
const bridgeVersion = "2026-05-15";
const failures = [];

await requireBuiltGui();

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error("JetBrains wrapper browser smoke failed: Playwright is not installed or cannot be loaded.");
  console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
  console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const guiServer = await startStaticServer(distRoot);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const wrapperServer = await startWrapperServer(guiBaseUrl);
const wrapperBaseUrl = `http://127.0.0.1:${wrapperServer.port}`;
let browser;

try {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error("JetBrains wrapper browser smoke failed: Playwright Chromium is not installed or cannot be launched.");
    console.error("Run `npm install` from the repository root if needed, then run `npx playwright install chromium`.");
    console.error(`Launch error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const page = await browser.newPage();
  page.on("pageerror", (error) => {
    failures.push(`Page JavaScript error: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isLoopbackServerAsset(url) && (isJsOrCssAssetUrl(url) || response.status() === 404 || response.status() >= 500)) {
      if (response.status() === 404 || response.status() >= 500) {
        failures.push(`Broken local asset response: ${response.status()} ${url}`);
      }
    }
  });

  await page.goto(`${wrapperBaseUrl}/wrapper.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("iframe[title='Yet AI GUI']", { state: "visible", timeout: 5000 });

  const iframeElement = page.locator("iframe[title='Yet AI GUI']");
  const iframeBox = await iframeElement.boundingBox();
  if (!iframeBox || iframeBox.width < 100 || iframeBox.height < 100) {
    failures.push("Wrapper iframe is missing, hidden, or too small.");
  }

  const frameLocator = page.frameLocator("iframe[title='Yet AI GUI']");
  await frameLocator.locator("body").waitFor({ state: "visible", timeout: 5000 });
  await frameLocator.getByText("Yet AI", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });

  for (const text of requiredVisibleText) {
    const visible = await frameLocator.getByText(text, { exact: true }).first().isVisible().catch(() => false);
    if (!visible) {
      failures.push(`Missing visible iframe GUI text: ${text}`);
    }
  }

  const bodyText = (await frameLocator.locator("body").innerText()).trim();
  if (bodyText.length < 80) {
    failures.push(`Iframe GUI body text is too short or blank (${bodyText.length} characters).`);
  }

  const hostReadyVisible = await frameLocator.getByText("Host runtime settings received", { exact: true }).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (!hostReadyVisible) {
    failures.push("Iframe GUI did not visibly log Host runtime settings received after wrapper host.ready delivery.");
  }

  const collectedMessages = await page.waitForFunction(() => window.__yetAiBridgeMessages?.some((message) => message?.type === "gui.ready"), undefined, { timeout: 5000 })
    .then(() => page.evaluate(() => window.__yetAiBridgeMessages))
    .catch(() => []);
  if (!Array.isArray(collectedMessages) || !collectedMessages.some((message) => message?.type === "gui.ready" && message?.version === bridgeVersion)) {
    failures.push("Wrapper fake postIntellijMessage bridge did not collect gui.ready.");
  }

  const targetOrigin = await page.evaluate(() => window.__yetAiFrameTargetOrigin);
  if (targetOrigin !== guiBaseUrl) {
    failures.push(`Wrapper iframe target origin mismatch: expected ${guiBaseUrl}, got ${String(targetOrigin)}.`);
  }

  await page.waitForTimeout(250);

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("JetBrains wrapper browser smoke passed.");
  console.log("Checked JetBrains-like wrapper iframe rendering, exact loopback target origin, host.ready delivery, bridge collector, JavaScript execution, and local JS/CSS asset responses.");
  console.log("No engine, provider credentials, OpenAI/ChatGPT, hosted Yet AI services, JetBrains IDE, or JCEF automation were used.");
} finally {
  await browser?.close().catch(() => undefined);
  await wrapperServer.close();
  await guiServer.close();
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) {
      failures.push("Built GUI index.html does not reference Vite assets. Run `cd apps/gui && npm run build` and retry.");
    }
  } catch {
    console.error("JetBrains wrapper browser smoke failed: built GUI is missing.");
    console.error("Run `cd apps/gui && npm run build` before `npm run smoke:jetbrains-wrapper-browser`.");
    console.error(`Expected file: ${path.relative(root, indexPath)}`);
    process.exit(1);
  }
}

async function startWrapperServer(guiBaseUrl) {
  const wrapperHtml = renderWrapperHtml(guiBaseUrl);
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || (requestUrl.pathname !== "/" && requestUrl.pathname !== "/wrapper.html")) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(wrapperHtml);
  });
  return listen(server);
}

function renderWrapperHtml(guiBaseUrl) {
  const indexUrl = `${guiBaseUrl}/index.html`;
  const bootstrapHostReady = JSON.stringify({
    version: bridgeVersion,
    type: "host.ready",
    requestId: "browser-smoke",
    payload: {
      runtimeUrl: "http://127.0.0.1:8001",
      productId: "yet-ai",
      displayName: "Yet AI",
      cloudRequired: false,
    },
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yet AI</title>
<style>
body { margin: 0; font-family: sans-serif; }
iframe { width: 100vw; height: 100vh; border: 0; }
#yet-ai-shell-status, #yet-ai-shell-fallback { position: fixed; left: 12px; bottom: 12px; z-index: 1; max-width: 80vw; padding: 8px 10px; border-radius: 8px; background: #111827; color: #f9fafb; font-size: 12px; }
#yet-ai-shell-fallback { top: 24px; bottom: auto; background: #7f1d1d; }
#yet-ai-shell-fallback[hidden], #yet-ai-shell-status[hidden] { display: none; }
</style>
</head>
<body>
<div id="yet-ai-shell-status" role="status">Loading packaged Yet AI GUI from <code>${escapeHtml(indexUrl)}</code> with origin <code>${escapeHtml(guiBaseUrl)}</code>.</div>
<div id="yet-ai-shell-fallback" role="alert" hidden>Packaged Yet AI GUI did not finish loading from the local loopback server.</div>
<iframe title="Yet AI GUI" src="${escapeHtml(indexUrl)}"></iframe>
<script>
const bootstrapHostReady = ${bootstrapHostReady};
const bridgeVersion = "${bridgeVersion}";
const requestId = "browser-smoke";
const frame = document.querySelector("iframe");
const frameTargetOrigin = "${guiBaseUrl}";
const shellStatus = document.getElementById("yet-ai-shell-status");
const shellFallback = document.getElementById("yet-ai-shell-fallback");
window.__yetAiBridgeMessages = [];
window.__yetAiFrameTargetOrigin = frameTargetOrigin;
let frameLoaded = false;
const markLoaded = () => {
  frameLoaded = true;
  if (shellStatus) shellStatus.hidden = true;
  if (shellFallback) shellFallback.hidden = true;
};
if (shellFallback && frame) {
  window.setTimeout(() => {
    if (!frameLoaded) shellFallback.hidden = false;
  }, 8000);
}
window.postIntellijMessage = (message) => {
  window.__yetAiBridgeMessages.push(message);
};
const sendToFrame = (message) => {
  if (frame && frame.contentWindow && frameTargetOrigin) {
    frame.contentWindow.postMessage(message, frameTargetOrigin);
  }
};
const isHostMessage = (message) => message && message.version === bridgeVersion && (message.type === "host.ready" || message.type === "host.openedFromCommand");
const isGuiMessage = (message) => message && message.version === bridgeVersion && message.type === "gui.ready";
window.addEventListener("message", (event) => {
  if (event.source === frame?.contentWindow) {
    if (frameTargetOrigin && frameTargetOrigin !== "*" && event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isGuiMessage(event.data)) {
      window.postIntellijMessage(event.data);
    } else {
      console.log("Yet AI rejected invalid iframe GUI bridge message");
    }
    return;
  }
  if (isHostMessage(event.data)) {
    console.log("Yet AI host message", event.data.type);
    sendToFrame(event.data);
  }
});
window.postIntellijMessage({ version: bridgeVersion, type: "gui.ready", requestId, payload: { supportedBridgeVersion: bridgeVersion } });
if (frame) {
  frame.addEventListener("load", () => {
    markLoaded();
    sendToFrame(bootstrapHostReady);
  });
}
</script>
</body>
</html>`;
}

async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const fileStat = await stat(requestedPath);
      if (!fileStat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(requestedPath) });
      createReadStream(requestedPath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  return listen(server);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port.");
  }

  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function isJsOrCssAssetRequest(url, resourceType) {
  return isLoopbackServerAsset(url) && (resourceType === "script" || resourceType === "stylesheet" || isJsOrCssAssetUrl(url));
}

function isLoopbackServerAsset(url) {
  return url.startsWith("http://127.0.0.1:");
}

function isJsOrCssAssetUrl(value) {
  const pathname = new URL(value).pathname;
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function reportFailures() {
  console.error("JetBrains wrapper browser smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
