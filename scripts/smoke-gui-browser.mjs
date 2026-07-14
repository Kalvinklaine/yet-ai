import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const requiredVisibleText = ["Yet AI", "Local runtime connection", "Provider setup", "Chat with Yet AI"];
const failures = [];

await requireBuiltGui();

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error("GUI browser smoke failed: Playwright is not installed or cannot be loaded.");
  console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
  console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const server = await startStaticServer(distRoot);
const baseUrl = `http://127.0.0.1:${server.port}`;
let browser;

try {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error("GUI browser smoke failed: Playwright Chromium is not installed or cannot be launched.");
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
    if (isStaticServerAsset(url) && (isJsOrCssAssetUrl(url) || response.status() === 404 || response.status() >= 500)) {
      if (response.status() === 404 || response.status() >= 500) {
        failures.push(`Broken local asset response: ${response.status()} ${url}`);
      }
    }
  });

  await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });

  for (const text of requiredVisibleText) {
    const visible = await page.getByText(text, { exact: true }).first().isVisible().catch(() => false);
    if (!visible) {
      failures.push(`Missing visible GUI text: ${text}`);
    }
  }

  const bridgeDebugChromeVisible = await page.getByText("Bridge debug", { exact: true }).first().isVisible().catch(() => false);
  if (bridgeDebugChromeVisible) {
    failures.push("Bridge debug should not be visible as default page chrome.");
  }

  const bridgeDebugDetails = page.getByTestId("bridge-debug-details");
  const bridgeDebugState = await bridgeDebugDetails.evaluate((details) => ({ open: details.open, text: details.textContent ?? "" })).catch(() => null);
  if (!bridgeDebugState) {
    failures.push("Missing diagnostics bridge debug disclosure.");
  } else {
    if (bridgeDebugState.open) {
      failures.push("Bridge diagnostics disclosure should be collapsed by default.");
    }
    if (!/Diagnostics\s*\/\s*bridge debug/i.test(bridgeDebugState.text)) {
      failures.push("Bridge diagnostics disclosure summary is missing.");
    }
    if (/token|secret|authorization|cookie|raw prompt|provider response/i.test(bridgeDebugState.text)) {
      failures.push("Bridge diagnostics disclosure contains sensitive wording while collapsed.");
    }
    await bridgeDebugDetails.locator("summary").first().click();
    const openedBridgeDebugState = await bridgeDebugDetails.evaluate((details) => ({ open: details.open, text: details.textContent ?? "" })).catch(() => null);
    if (!openedBridgeDebugState?.open) {
      failures.push("Bridge diagnostics disclosure did not open.");
    } else {
      if (!openedBridgeDebugState.text.includes("Inspect bridge message log") || !/No bridge messages logged|bridge messages/i.test(openedBridgeDebugState.text)) {
        failures.push("Bridge diagnostics disclosure does not expose bridge diagnostic evidence.");
      }
      if (/token|secret|authorization|cookie|raw prompt|provider response/i.test(openedBridgeDebugState.text)) {
        failures.push("Bridge diagnostics disclosure contains sensitive wording while open.");
      }
    }
  }

  const bodyText = (await page.locator("body").innerText()).trim();
  if (bodyText.length < 80) {
    failures.push(`GUI body text is too short or blank (${bodyText.length} characters).`);
  }

  const traceDetails = page.getByTestId("coding-session-trace-details");
  const traceState = await traceDetails.evaluate((details) => ({ open: details.open, text: details.textContent ?? "" })).catch(() => null);
  if (!traceState) {
    failures.push("Missing coding session trace panel.");
  } else {
    if (traceState.open) {
      failures.push("Coding session trace panel should be collapsed by default.");
    }
    if (!traceState.text.includes("Coding session trace") || !traceState.text.includes("read-only")) {
      failures.push("Coding session trace summary is missing read-only metadata.");
    }
    if (/token|secret|authorization|cookie|raw prompt|provider response/i.test(traceState.text)) {
      failures.push("Coding session trace summary contains sensitive wording.");
    }
  }

  const storageText = await page.evaluate(() => JSON.stringify({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)];
    })),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? "";
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  if (/codingSessionTrace|coding-session-trace|raw prompt|provider response|secret|authorization|cookie/i.test(storageText)) {
    failures.push("Browser storage unexpectedly contains trace or sensitive coding-session data.");
  }

  await page.waitForTimeout(250);

  if (failures.length > 0) {
    console.error("GUI browser smoke failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("GUI browser smoke passed.");
  console.log("Checked built GUI rendering, visible core sections, collapsed read-only coding-session trace, JavaScript execution, storage hygiene, and local JS/CSS asset responses.");
  console.log("No engine, provider credentials, OpenAI/ChatGPT, hosted Yet AI services, plugin, or JCEF automation were used.");
} finally {
  await browser?.close().catch(() => undefined);
  await server.close();
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
    console.error("GUI browser smoke failed: built GUI is missing.");
    console.error("Run `cd apps/gui && npm run build` before `npm run smoke:gui-browser`.");
    console.error(`Expected file: ${path.relative(root, indexPath)}`);
    process.exit(1);
  }
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

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Static server did not bind to a TCP port.");
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
  return isStaticServerAsset(url) && (resourceType === "script" || resourceType === "stylesheet" || isJsOrCssAssetUrl(url));
}

function isStaticServerAsset(url) {
  return url.startsWith("http://127.0.0.1:");
}

function isJsOrCssAssetUrl(value) {
  const pathname = new URL(value).pathname;
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}
