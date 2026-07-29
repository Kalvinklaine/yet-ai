import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const panelHostedRoute = /^\/panel\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/hosted-chat$/;
const vscodeHostedRoute = "/vscode/hosted-chat";
const browserRoute = "/projects";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export function defineGuiSmokeEntry({ mode, route, entryMode } = {}) {
  if (mode === "browser" && route === browserRoute && entryMode === undefined) {
    return Object.freeze({ mode, route, host: "browser", initialConfig: undefined });
  }
  if (mode === "hosted" && entryMode === "hosted_chat" && route === vscodeHostedRoute) {
    return Object.freeze({ mode, route, host: "vscode", initialConfig: { entryMode } });
  }
  if (mode === "hosted" && entryMode === "hosted_chat" && panelHostedRoute.test(route ?? "")) {
    return Object.freeze({ mode, route, host: "panel", initialConfig: { entryMode } });
  }
  throw new Error("GUI smoke entry must use one canonical browser or hosted route without mixing modes.");
}

export async function createGuiSmokeBootstrap({ distRoot, chromium, entry, viewport = { width: 800, height: 600 }, privacyMarkers = [], criticalRequest = defaultCriticalRequest, launchOptions = {} }) {
  const normalizedEntry = defineGuiSmokeEntry(entry);
  await requireBuiltGui(distRoot);
  const failures = [];
  const criticalResponseFailures = [];
  const requests = [];
  const bridgePosts = [];
  let server;
  let browser;
  let context;
  let page;

  try {
    server = await startSpaServer(distRoot, normalizedEntry);
    browser = await chromium.launch({ headless: true, ...launchOptions });
    context = await browser.newContext();
    page = await context.newPage({ viewport });
    page.on("pageerror", (error) => failures.push(`page error: ${safeDiagnostic(error.message, privacyMarkers)}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) failures.push(`console error: ${safeDiagnostic(message.text(), privacyMarkers)}`);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      requests.push({ method: request.method(), url: url.href, path: url.pathname });
      if ((url.protocol === "http:" || url.protocol === "https:") && !loopbackHosts.has(url.hostname)) failures.push(`non-loopback request: ${url.origin}`);
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (criticalRequest(url)) failures.push(`critical request failed: ${request.method()} ${url.pathname}`);
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (criticalRequest(url) && response.status() >= 400) criticalResponseFailures.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
    });
    await page.addInitScript(({ smokeEntry }) => {
      window.__yetAiSmokeBridgePosts = [];
      if (smokeEntry.initialConfig) window.__yetAiInitialRuntimeConfig = smokeEntry.initialConfig;
      if (smokeEntry.host === "vscode") {
        window.acquireVsCodeApi = () => ({ postMessage: (message) => window.__yetAiSmokeBridgePosts.push(message) });
      } else if (smokeEntry.host === "panel") {
        window.postIntellijMessage = (message) => window.__yetAiSmokeBridgePosts.push(message);
      }
    }, { smokeEntry: normalizedEntry });
    await page.goto(`http://127.0.0.1:${server.port}${normalizedEntry.route}`, { waitUntil: "domcontentloaded" });
  } catch (error) {
    await close();
    throw error;
  }

  async function waitForGuiReady(timeout = 5000) {
    if (normalizedEntry.mode !== "hosted") throw new Error("Browser smoke entries do not perform trusted-host readiness.");
    try {
      await page.waitForFunction(() => window.__yetAiSmokeBridgePosts?.some((message) => message?.type === "gui.ready"), undefined, { timeout });
    } catch (error) {
      assertHealthy();
      throw error;
    }
    bridgePosts.splice(0, bridgePosts.length, ...await page.evaluate(() => window.__yetAiSmokeBridgePosts));
    return bridgePosts.find((message) => message?.type === "gui.ready");
  }

  async function sendHostReady({ requestId, runtimeUrl, runtimeProxyBaseUrl, sessionToken, workspaceBinding }) {
    if (normalizedEntry.mode !== "hosted") throw new Error("Browser smoke entries cannot receive trusted-host authority.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId ?? "")) throw new Error("Hosted smoke readiness requires a bounded generation requestId.");
    const readyPayload = runtimeProxyBaseUrl
      ? { runtimeProxyBaseUrl, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false }
      : { runtimeUrl, sessionToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false };
    await page.waitForTimeout(50);
    await page.evaluate(({ requestId: generation, readyPayload: payload }) => {
      window.dispatchEvent(new MessageEvent("message", { data: { version: "2026-05-15", type: "host.ready", requestId: generation, payload } }));
    }, { requestId, readyPayload });
    await page.waitForTimeout(50);
    await page.evaluate(({ requestId: generation, binding }) => {
      window.dispatchEvent(new MessageEvent("message", { data: { version: "2026-05-15", type: "host.workspaceBinding", requestId: generation, payload: { protocolVersion: "workspace_binding_v1", requestId: generation, ...binding } } }));
    }, { requestId, binding: workspaceBinding });
  }

  async function assertPrivacy() {
    const state = await page.evaluate(() => ({
      local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => { const key = localStorage.key(index) ?? ""; return [key, localStorage.getItem(key)]; })),
      session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => { const key = sessionStorage.key(index) ?? ""; return [key, sessionStorage.getItem(key)]; })),
      body: document.body.innerText,
    }));
    const serialized = JSON.stringify(state);
    for (const marker of privacyMarkers) {
      if (marker && serialized.includes(marker)) throw new Error("GUI smoke privacy marker reached the DOM or browser storage.");
    }
    const cookies = await context.cookies();
    const smokeCookie = cookies.find((cookie) => cookie.name === "yet_ai_smoke_session");
    if (!smokeCookie?.httpOnly) throw new Error("GUI smoke session cookie was not HttpOnly.");
  }

  function assertHealthy() {
    if (failures.length > 0 || criticalResponseFailures.length > 0) {
      throw new Error(safeDiagnostic([...failures, ...criticalResponseFailures].join("; "), privacyMarkers));
    }
  }

  async function close() {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    browser = undefined;
    server = undefined;
  }

  return { entry: normalizedEntry, page, requests, bridgePosts, criticalResponseFailures, waitForGuiReady, sendHostReady, assertPrivacy, assertHealthy, close };
}

export async function waitForGuiSmokeChat(page) {
  await page.waitForFunction(() => !document.body.innerText.includes("Loading local runtime conversations…"), undefined, { timeout: 10_000 });
  const badge = page.locator(".chat-id-badge");
  await badge.waitFor({ state: "visible", timeout: 10_000 });
  const chatId = (await badge.textContent())?.trim();
  if (!chatId || chatId === "draft") throw new Error("GUI smoke requires a selected local chat before interaction.");
  return chatId;
}

async function requireBuiltGui(distRoot) {
  const indexPath = path.join(distRoot, "index.html");
  const fileStat = await stat(indexPath);
  if (!fileStat.isFile()) throw new Error("Built GUI prerequisite missing: run the GUI build.");
  const html = await readFile(indexPath, "utf8");
  if (!html.includes("/assets/") && !html.includes("./assets/")) throw new Error("Built GUI index does not reference Vite assets.");
}

async function startSpaServer(staticRoot, entry) {
  const indexPath = path.join(staticRoot, "index.html");
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname);
      const assetOffset = pathname.indexOf("/assets/");
      const staticPathname = assetOffset >= 0 ? pathname.slice(assetOffset) : pathname;
      const requestedPath = path.resolve(staticRoot, `.${staticPathname}`);
      if (!requestedPath.startsWith(`${path.resolve(staticRoot)}${path.sep}`)) return response.writeHead(403).end("Forbidden");
      let servedPath = requestedPath;
      let fileStat = await stat(servedPath).catch(() => undefined);
      if ((!fileStat || !fileStat.isFile()) && pathname === entry.route) {
        servedPath = indexPath;
        fileStat = await stat(servedPath);
      }
      if (!fileStat?.isFile()) return response.writeHead(404).end("Not found");
      const headers = { "content-type": contentType(servedPath) };
      if (servedPath === indexPath) headers["set-cookie"] = "yet_ai_smoke_session=present; HttpOnly; SameSite=Strict; Path=/";
      response.writeHead(200, headers);
      createReadStream(servedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("GUI smoke server did not bind.");
  return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) };
}

function defaultCriticalRequest(url) {
  return url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.includes("/v1/");
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function safeDiagnostic(value, markers) {
  let result = String(value).replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]").replace(/\/Users\/[^\s;]+/g, "/Users/[redacted]");
  for (const marker of markers) if (marker) result = result.split(marker).join("[redacted]");
  return result.slice(0, 1000);
}
