import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagedGuiRoot = path.join(root, "apps", "plugins", "vscode", "media", "gui");
const packagedGuiIndex = path.join(packagedGuiRoot, "index.html");
const guiDistIndex = path.join(root, "apps", "gui", "dist", "index.html");
const staleToleranceMs = 2000;
const bridgeVersion = "2026-05-15";
const runtimeToken = `vscode-wrapper-runtime-${randomUUID()}`;
const providerKey = `sk-vscode-wrapper-${randomUUID()}`;
const authorizationSentinel = `Authorization: Bearer ${runtimeToken}`;
const rejectedSecretMessage = `Invalid host result must not render ${providerKey}`;
const progressSummary = "IDE action policy check started.";
const resultMessage = "Context snapshot delivered.";
const failures = [];
const consoleMessages = [];
let observedRuntimeAuthorization = false;

await requirePackagedGui();
const { chromium } = await requireChromium();
const guiServer = await startStaticServer(packagedGuiRoot);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeServer = await startMockRuntimeServer();
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:8001/") && !url.startsWith(`${runtimeBaseUrl}/`)) {
      await route.abort();
      return;
    }
    if (isAllowedUrl(url, [guiBaseUrl, runtimeBaseUrl])) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request: ${redactUrl(url)}`);
    await route.abort();
  });

  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(text);
    if (containsSecret(text)) failures.push("Browser console exposed a smoke secret marker.");
  });
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`));
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactUrl(request.url())} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(guiBaseUrl) && (response.status() === 404 || response.status() >= 500)) {
      failures.push(`Broken packaged GUI response: ${response.status()} ${redactUrl(response.url())}`);
    }
  });

  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.__yetAiHostMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Yet AI", "packaged Yet AI title");
  await expectVisibleText(page, "Chat with Yet AI", "packaged chat UI");
  await expectVisibleText(page, "Bridge debug", "packaged bridge debug UI");
  const bodyText = (await page.locator("body").innerText()).trim();
  if (bodyText.length < 80) failures.push(`Packaged GUI body text is too short or blank (${bodyText.length} characters).`);

  const guiReady = await waitForGuiMessage(page, "gui.ready");
  if (guiReady?.version !== bridgeVersion || guiReady?.payload?.supportedBridgeVersion !== bridgeVersion) {
    failures.push("VS Code-like acquireVsCodeApi bridge did not collect strict gui.ready.");
  }

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ready",
    requestId: guiReady?.requestId,
    payload: { runtimeUrl: runtimeBaseUrl, sessionToken: runtimeToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await expectAttachedText(page, "Host runtime settings received", "host.ready bridge log");
  await expectVisibleText(page, "bridge vscode", "VS Code bridge mode badge");
  await expectAttachedText(page, "VS Code controlled actions", "controlled action availability");

  const getContextButton = page.getByRole("button", { name: "Get IDE context", exact: true });
  await getContextButton.waitFor({ state: "visible", timeout: 10_000 });
  if (await getContextButton.isDisabled()) failures.push("Get IDE context button was disabled in VS Code host mode.");
  await getContextButton.click();

  const ideRequest = await waitForGuiMessage(page, "gui.ideActionRequest");
  if (!ideRequest) {
    failures.push("Clicking Get IDE context did not send gui.ideActionRequest.");
  } else {
    if (ideRequest.version !== bridgeVersion) failures.push("IDE action request used the wrong bridge version.");
    if (ideRequest.payload?.action !== "getContextSnapshot" || Object.keys(ideRequest.payload ?? {}).length !== 1) {
      failures.push("IDE action request payload was not strict getContextSnapshot.");
    }
    if (typeof ideRequest.requestId !== "string" || !/^gui-ide-action-\d+$/.test(ideRequest.requestId) || ideRequest.requestId.length > 128) {
      failures.push("IDE action request id was missing, unbounded, or not deterministic.");
    }
  }

  const requestId = ideRequest?.requestId ?? "gui-ide-action-missing";
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionProgress",
    requestId,
    payload: { phase: "checkingPolicy", status: "inProgress", summary: progressSummary, cloudRequired: false, action: "getContextSnapshot" },
  });
  await expectVisibleText(page, "Get IDE context: inProgress", "correlated IDE action progress");
  await expectVisibleText(page, progressSummary, "IDE action progress summary");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId,
    payload: { status: "succeeded", message: resultMessage, cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } },
  });
  await expectVisibleText(page, "Get IDE context: succeeded", "correlated IDE action result");
  await expectVisibleText(page, resultMessage, "IDE action result message");
  await expectVisibleText(page, "Context: active editor true · workspace folders 1", "IDE action result context metadata");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: "invalid-secret-result",
    payload: { status: "succeeded", message: rejectedSecretMessage, cloudRequired: false, action: "getContextSnapshot", extra: "free-form" },
  });
  await page.waitForTimeout(150);
  const rejectedVisible = await page.getByText(rejectedSecretMessage, { exact: false }).first().isVisible().catch(() => false);
  if (rejectedVisible) failures.push("Schema-invalid/free-form host.ideActionResult with a secret-like message rendered in the DOM.");
  await expectVisibleText(page, "Get IDE context: succeeded", "valid IDE action result remains visible after invalid result");

  if (!observedRuntimeAuthorization) failures.push("Mock runtime did not observe Authorization from host.ready session token.");
  const visibleState = await collectVisibleState(page);
  assertNoSecretLeak(visibleState, "DOM, browser storage, collected GUI messages, host messages, or console");

  if (failures.length > 0) reportFailures();
  console.log("VS Code wrapper browser smoke passed.");
  console.log("Verified packaged VS Code GUI assets in a VS Code-like browser bridge, gui.ready, trusted host.ready, controlled getContextSnapshot request, correlated progress/result rendering, loopback-only networking, invalid host-result rejection, and secret redaction.");
  console.log("No real VS Code launch, provider credentials, OpenAI/ChatGPT calls, hosted Yet AI service, or non-loopback provider call was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close();
  await guiServer.close();
}

async function requirePackagedGui() {
  let packagedGuiStat;
  try {
    packagedGuiStat = await stat(packagedGuiIndex);
    if (!packagedGuiStat.isFile()) throw new Error("not a file");
  } catch {
    console.error("VS Code wrapper browser smoke failed: packaged VS Code GUI assets are missing.");
    console.error("Run `npm run prepare:vscode-preview` from the repository root.");
    console.error(`Expected file: ${path.relative(root, packagedGuiIndex)}`);
    process.exit(1);
  }

  try {
    const guiDistStat = await stat(guiDistIndex);
    if (guiDistStat.isFile() && packagedGuiStat.mtimeMs + staleToleranceMs < guiDistStat.mtimeMs) {
      console.error("VS Code wrapper browser smoke failed: packaged VS Code GUI assets are stale.");
      console.error("Run `npm run prepare:vscode-preview` from the repository root to rebuild and copy GUI assets before running wrapper smoke.");
      console.error(`Packaged file: ${path.relative(root, packagedGuiIndex)}`);
      console.error(`Newer GUI build file: ${path.relative(root, guiDistIndex)}`);
      process.exit(1);
    }
  } catch {
    // If apps/gui/dist/index.html does not exist, the packaged-GUI existence check above
    // is still sufficient for this smoke. prepare:vscode-preview creates both when needed.
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code wrapper browser smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
    console.error(`Load error: ${messageOf(error)}`);
    process.exit(1);
  }
}

async function waitForGuiMessage(page, type) {
  await page.waitForFunction((messageType) => window.__yetAiVsCodeMessages?.some((message) => message?.type === messageType), type, { timeout: 10_000 });
  return await page.evaluate((messageType) => window.__yetAiVsCodeMessages.find((message) => message?.type === messageType), type);
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
    window.__yetAiHostMessages.push(hostMessage);
    window.dispatchEvent(new MessageEvent("message", { data: hostMessage }));
  }, message);
}

async function startMockRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders()).end();
      return;
    }
    if (request.headers.authorization === `Bearer ${runtimeToken}`) observedRuntimeAuthorization = true;
    if (request.headers.authorization !== `Bearer ${runtimeToken}`) {
      json(response, 401, { error: "Unauthorized local runtime request." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/ping") {
      json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0-smoke", ready: true, serverTime: new Date(0).toISOString() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/caps") {
      json(response, 200, { productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: ["chat"], features: {}, providers: [], ide: { bridge: true, lsp: false, host: "vscode-wrapper-browser-smoke" } });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: [] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Mock-only wrapper smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats") {
      json(response, 200, { chats: [] });
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

async function startStaticServer(staticRoot) {
  const realStaticRoot = await realpath(staticRoot);
  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    const requestedPath = path.normalize(path.join(realStaticRoot, pathname));
    try {
      const realRequestedPath = await realpath(requestedPath);
      if (!isPathInsideRoot(realStaticRoot, realRequestedPath) || !(await stat(realRequestedPath)).isFile()) throw new Error("not found");
      response.writeHead(200, { "content-type": contentType(realRequestedPath) });
      createReadStream(realRequestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return listen(server);
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({ port: address.port, close: () => new Promise((closeResolve) => server.close(closeResolve)) });
    });
  });
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function expectAttachedText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function collectVisibleState(page) {
  return JSON.stringify(await page.evaluate(() => ({
    domText: document.documentElement.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
    vscodeMessages: window.__yetAiVsCodeMessages,
    hostMessageTypes: window.__yetAiHostMessages?.map((message) => ({ type: message?.type, requestId: message?.requestId })),
    hostPayloadKeys: window.__yetAiHostMessages?.map((message) => Object.keys(message?.payload ?? {})),
    hostPayloadValues: window.__yetAiHostMessages?.map((message) => Object.fromEntries(Object.entries(message?.payload ?? {}).filter(([key]) => key !== "sessionToken" && key !== "message"))),
  }))) + JSON.stringify(consoleMessages);
}

function json(response, status, body) {
  response.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, accept" };
}

function isAllowedUrl(value, origins) {
  try { return origins.includes(new URL(value).origin); } catch { return false; }
}

function isPathInsideRoot(rootPath, requestedPath) {
  const relativePath = path.relative(rootPath, requestedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isJsOrCssAssetRequest(url, resourceType) {
  return url.startsWith(guiBaseUrl) && (resourceType === "script" || resourceType === "stylesheet" || /\.(js|css)$/.test(new URL(url).pathname));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function assertNoSecretLeak(text, source) {
  if (containsSecret(text)) throw new Error(`Secret marker leaked through ${source}.`);
}

function containsSecret(text) {
  const lower = String(text).toLowerCase();
  return [runtimeToken, providerKey, authorizationSentinel, `Bearer ${runtimeToken}`, `Bearer ${providerKey}`].some((marker) => lower.includes(marker.toLowerCase()));
}

function redactSecrets(text) {
  let redacted = String(text);
  for (const marker of [runtimeToken, providerKey, authorizationSentinel]) redacted = redacted.split(marker).join("[redacted]");
  return redacted.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return redactSecrets(value); }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code wrapper browser smoke failed:");
  for (const failure of failures) console.error(`- ${redactSecrets(failure)}`);
  process.exit(1);
}
