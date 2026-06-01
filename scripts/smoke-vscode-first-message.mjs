import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

await import("./smoke-vscode-preview.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packagedGuiRoot = path.join(root, "apps", "plugins", "vscode", "media", "gui");
const packagedGuiIndex = path.join(packagedGuiRoot, "index.html");
const bridgeVersion = "2026-05-15";
const runtimeToken = `vscode-runtime-token-${randomUUID()}`;
const providerKey = `sk-vscode-provider-${randomUUID()}`;
const contextSentinel = `VSCODE_CONTEXT_SENTINEL_${randomUUID()}`;
const contextText = `${"safe vscode context ".repeat(80)}${contextSentinel}`;
const assistantText = "VS Code packaged smoke response.";
const failures = [];
const consoleMessages = [];
let runtimeReady = false;
let observedRuntimeAuthorization = false;
let chatCommandRequest;
let chatCommandRequestCount = 0;
let chatSubscriptionCount = 0;

if (packageJson.scripts?.["smoke:gui-runtime-e2e"] !== "node scripts/smoke-gui-runtime-e2e.mjs") {
  failures.push("Root package.json must keep smoke:gui-runtime-e2e available as the deeper local mock-provider runtime/chat verification path.");
}

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
    if (url.startsWith("http://127.0.0.1:8001/")) {
      await route.abort();
      return;
    }
    if (url.startsWith(`${runtimeBaseUrl}/v1/chats/subscribe?`)) {
      chatSubscriptionCount += 1;
      const authorization = route.request().headers().authorization;
      if (authorization !== `Bearer ${runtimeToken}`) {
        failures.push("SSE subscription did not use the VS Code host.ready runtime session token.");
      }
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" },
        body: sseBodyFromUrl(url),
      });
      return;
    }
    if (isAllowedUrl(url, [guiBaseUrl, runtimeBaseUrl])) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request: ${redactUrl(url)}`);
    await route.abort();
  });
  await page.addInitScript(({ token }) => {
    window.__yetAiVsCodeMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
    window.__yetAiRuntimeTokenProbe = token;
  }, { token: runtimeToken });
  page.on("console", (message) => {
    consoleMessages.push(message.text());
    assertNoSecretLeak(message.text(), "browser console");
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

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__yetAiVsCodeMessages?.some((message) => message?.type === "gui.ready"), undefined, { timeout: 10_000 });
  await page.evaluate(({ version, runtimeUrl, token }) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version,
        type: "host.ready",
        requestId: "vscode-first-message-ready",
        payload: {
          runtimeUrl,
          sessionToken: token,
          productId: "yet-ai",
          displayName: "Yet AI",
          cloudRequired: false,
        },
      },
    }));
  }, { version: bridgeVersion, runtimeUrl: runtimeBaseUrl, token: runtimeToken });

  await expectAttachedText(page, "Host runtime settings received", "host.ready runtime bootstrap");
  await expectVisibleText(page, "Runtime connected", "runtime connected through host.ready", 20_000);
  await expectVisibleText(page, "State: Provider required", "provider-required first-message state", 20_000);
  await expectVisibleText(page, "Provider required for first message", "provider-required guidance", 20_000);
  if (!await sendButton(page).isDisabled()) {
    failures.push("Send was enabled before provider/model readiness.");
  }
  if (!observedRuntimeAuthorization) {
    failures.push("Mock runtime did not observe the VS Code host.ready runtime session token.");
  }

  runtimeReady = true;
  await refreshRuntime(page);
  await expectVisibleText(page, "Ready to send using VS Code Smoke Model.", "safe mock provider/model readiness", 20_000);
  if (await sendButton(page).isDisabled()) {
    failures.push("Send stayed disabled after safe mock provider/model readiness.");
  }

  await page.evaluate(({ version, text }) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version,
        type: "host.contextSnapshot",
        requestId: "vscode-context-smoke",
        payload: {
          kind: "active_editor",
          source: "vscode",
          file: {
            displayPath: "src/vscode-smoke.ts",
            workspaceRelativePath: "src/vscode-smoke.ts",
            languageId: "typescript",
          },
          selection: { text },
        },
      },
    }));
  }, { version: bridgeVersion, text: contextText });
  await expectVisibleText(page, "Active editor context", "VS Code active context bridge delivery");

  await page.locator("textarea").fill("Say hello through VS Code packaged GUI smoke.");
  await sendButton(page).click();
  await expectVisibleText(page, "Say hello through VS Code packaged GUI smoke.", "visible user first message", 20_000);
  await expectVisibleText(page, assistantText, "mock SSE assistant response", 20_000);

  if (chatCommandRequestCount !== 1) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests instead of exactly one.`);
  }
  if (chatSubscriptionCount < 1 || chatSubscriptionCount > 2) {
    failures.push(`Mock runtime received ${chatSubscriptionCount} chat subscriptions instead of one or two expected local subscriptions.`);
  }
  if (chatCommandRequest?.type !== "user_message") {
    failures.push("Mock runtime did not receive a user_message command.");
  }
  if (chatCommandRequest?.payload?.content !== "Say hello through VS Code packaged GUI smoke.") {
    failures.push("Mock runtime did not receive the expected first-message content.");
  }
  if (chatCommandRequest?.payload?.context?.source !== "vscode" || chatCommandRequest?.payload?.context?.selection?.text !== contextText) {
    failures.push("Mock runtime did not receive the VS Code active context on the first message.");
  }

  const visibleState = await collectVisibleState(page);
  assertNoSecretLeak(visibleState, "DOM, console, localStorage, or sessionStorage");

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("VS Code first-message preview smoke passed.");
  console.log("Verified VS Code dev-preview artifacts plus packaged GUI host.ready bootstrap, provider-required gate, safe mock provider/model readiness, user_message command, mock SSE assistant rendering, active-context include, loopback-only networking, and browser-visible redaction.");
  console.log("No OpenAI, ChatGPT, hosted Yet AI service, real provider credential, non-loopback provider call, or VS Code launch was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close();
  await guiServer.close();
}

async function requirePackagedGui() {
  try {
    const fileStat = await stat(packagedGuiIndex);
    if (!fileStat.isFile()) throw new Error("not a file");
  } catch {
    console.error("VS Code first-message preview smoke failed: packaged GUI is missing.");
    console.error("Run `npm run prepare:vscode-preview` from the repository root.");
    console.error(`Expected file: ${path.relative(root, packagedGuiIndex)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code first-message preview smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
    console.error(`Load error: ${messageOf(error)}`);
    process.exit(1);
  }
}

async function refreshRuntime(page) {
  const button = page.locator("section", { has: page.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: "Refresh runtime" });
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((item) => item.textContent?.trim() === "Refresh runtime" && !item.disabled), undefined, { timeout: 20_000 });
  await button.click();
}

function sendButton(page) {
  return page.getByRole("button", { name: "Send", exact: true });
}

async function startMockRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders()).end();
      return;
    }
    if (request.headers.authorization === `Bearer ${runtimeToken}`) {
      observedRuntimeAuthorization = true;
    }
    if (request.headers.authorization !== `Bearer ${runtimeToken}`) {
      json(response, 401, { error: "Unauthorized local runtime request. Check the session token." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/ping") {
      json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0-smoke", ready: true, serverTime: new Date(0).toISOString() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/caps") {
      json(response, 200, { productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: ["chat"], features: {}, providers: [], ide: { bridge: true, lsp: false, host: "vscode-preview-smoke" } });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: runtimeReady ? [mockProvider()] : [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: runtimeReady ? [mockModel()] : [] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Use a safe local mock provider for this preview smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats") {
      json(response, 200, { chats: [] });
      return;
    }
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(requestUrl.pathname);
    if (request.method === "GET" && chatMatch) {
      json(response, 200, { chatId: decodeURIComponent(chatMatch[1]), title: "Preview smoke", messages: [] });
      return;
    }
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(requestUrl.pathname);
    if (request.method === "POST" && commandMatch) {
      chatCommandRequestCount += 1;
      chatCommandRequest = JSON.parse(await readRequestBody(request));
      const chatId = decodeURIComponent(commandMatch[1]);
      json(response, 200, { accepted: true, chatId, requestId: chatCommandRequest.requestId, type: chatCommandRequest.type });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/subscribe") {
      json(response, 500, { error: "SSE should be fulfilled by the browser route in this deterministic preview smoke." });
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

function sseBodyFromUrl(value) {
  const url = new URL(value);
  const chatId = url.searchParams.get("chat_id") ?? "chat-001";
  return [
    { seq: 0, type: "snapshot", chatId, payload: { messages: [] } },
    { seq: 1, type: "stream_started", chatId, payload: { role: "assistant" } },
    { seq: 2, type: "stream_delta", chatId, payload: { delta: { content: "VS Code packaged " } } },
    { seq: 3, type: "stream_delta", chatId, payload: { delta: { content: "smoke response." } } },
    { seq: 4, type: "stream_finished", chatId, payload: { finishReason: "stop" } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "\n";
}

function mockProvider() {
  return { id: "vscode-smoke-provider", kind: "openai-compatible", displayName: "VS Code Smoke Provider", enabled: true, baseUrl: "http://127.0.0.1/mock/v1", auth: { type: "api_key", configured: true, redacted: "sk-...safe" }, models: [mockModel()], capabilities: { chat: true, completion: false, embeddings: false } };
}

function mockModel() {
  return { id: "vscode-smoke-model", providerId: "vscode-smoke-provider", displayName: "VS Code Smoke Model", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

async function startStaticServer(staticRoot) {
  const realStaticRoot = await realpath(staticRoot);
  const server = http.createServer(async (request, response) => {
    let requestUrl;
    let pathname;
    try {
      requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    const requestedPath = path.normalize(path.join(realStaticRoot, pathname));
    let realRequestedPath;
    try {
      realRequestedPath = await realpath(requestedPath);
      if (!isPathInsideRoot(realStaticRoot, realRequestedPath) || !(await stat(realRequestedPath)).isFile()) throw new Error("not found");
      response.writeHead(200, { "content-type": contentType(realRequestedPath) });
      createReadStream(realRequestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return listen(server);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({ port: address.port, close: () => new Promise((closeResolve) => server.close(closeResolve)) });
    });
  });
}

async function readRequestBody(request) {
  return await new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 4000)}`);
  }
}

async function expectAttachedText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 4000)}`);
  }
}

async function collectVisibleState(page) {
  return JSON.stringify(await page.evaluate(() => ({
    dom: document.documentElement.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
    vscodeMessages: window.__yetAiVsCodeMessages,
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
  try {
    const url = new URL(value);
    return origins.includes(url.origin);
  } catch {
    return false;
  }
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
  const lower = String(text).toLowerCase();
  for (const marker of [runtimeToken, providerKey, contextSentinel, `Bearer ${runtimeToken}`, `Bearer ${providerKey}`, "authorization: bearer", "provider secret"]) {
    if (marker && lower.includes(marker.toLowerCase())) {
      throw new Error(`Secret marker leaked through ${source}.`);
    }
  }
}

function redactSecrets(text) {
  let redacted = String(text);
  for (const marker of [runtimeToken, providerKey, contextSentinel]) {
    redacted = redacted.split(marker).join("[redacted]");
  }
  return redacted.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactSecrets(value);
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code first-message preview smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
