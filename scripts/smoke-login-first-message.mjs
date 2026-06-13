import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const evidenceRoot = path.join(root, "dist", "visual-smoke", "login-first-message");
const runtimeToken = `login-smoke-runtime-token-${randomUUID()}`;
const fakeAuthCode = `mock-auth-code-${randomUUID()}`;
const fakeAccessToken = `mock-access-token-${randomUUID()}`;
const fakeRefreshToken = `mock-refresh-token-${randomUUID()}`;
const fakeCookie = `mock-cookie-${randomUUID()}`;
const fakeApiKey = `sk-login-smoke-${randomUUID()}`;
const chatId = "login-smoke-chat";
const firstPrompt = "Login-shaped first message smoke prompt.";
const assistantAnswer = "Mock login-shaped GPT first-message answer from local loopback runtime; no provider call was made.";
const failures = [];
const requests = [];
let guiServer;
let runtimeServer;
let browser;
let loginStatus = "login_available";
let sessionId;
let authState;
let chatCommandCount = 0;
let internalProviderSecrets;
let apiKeyFallbackReady = false;
let demoModeEnabled = false;
let providerTestHits = 0;
const chats = new Map([[chatId, thread(chatId, "Login-shaped mock smoke chat", [])]]);
const subscribers = new Map();
const chatEventSeq = new Map();
const runtimeApiRequests = [];

const staticSecretMarkers = [runtimeToken, fakeAuthCode, fakeAccessToken, fakeRefreshToken, fakeCookie, fakeApiKey, `Bearer ${runtimeToken}`, `Bearer ${fakeAccessToken}`];

await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  guiServer = await startStaticServer(distRoot);
  runtimeServer = await startRuntimeServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserVisible = [];

  page.on("console", (message) => {
    const text = message.text();
    browserVisible.push(text);
    assertNoSecretLeak(text, "browser console");
    if (message.type() === "error" && !isExpectedFetchConsoleError(text)) failures.push(`Browser console error: ${redactSecrets(text)}`);
  });
  page.on("pageerror", (error) => {
    browserVisible.push(error.message);
    assertNoSecretLeak(error.message, "page error");
    failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`);
  });
  page.on("request", (request) => {
    const url = request.url();
    requests.push(`${request.method()} ${url}`);
    if (!isLoopbackUrl(url)) failures.push(`Non-loopback request attempted: ${redactUrl(url)}`);
  });

  await page.goto(`http://127.0.0.1:${guiServer.port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });

  await configureRuntimeConnection(page);
  await expectVisibleText(page, "Runtime connected", "runtime connected");

  await expectVisibleText(page, "Account login available", "login available state");
  await expectVisibleText(page, "experimental/non-default", "non-default login copy");
  await expectVisibleText(page, "Use OpenAI API key fallback", "API-key fallback button");
  await expectVisibleText(page, "Provider required for first message", "no-provider readiness");
  await expectSendDisabled(page, "no provider before login");

  await page.getByRole("button", { name: "Experimental high-risk account login" }).click();
  await expectVisibleText(page, "Finish browser verification", "pending provider-auth state");
  await expectVisibleText(page, "high-risk and private-endpoint-style", "high-risk warning");
  await expectVisibleText(page, "Session is tracked locally by the runtime and hidden here", "hidden session copy");
  await expectVisibleText(page, "Manual authorization-code exchange", "manual code exchange");
  await expectSendDisabled(page, "pending provider-auth without provider");
  assert(chatCommandCount === 0, `pending state sent an unexpected command, observed ${chatCommandCount}`);
  assertNoSecretLeak(await page.locator("body").innerText(), "DOM after provider-auth start");
  assertNoSecretLeak(requests.join("\n"), "browser request list after provider-auth start");
  await assertNoVisibleText(page, sessionId ?? "provider-login-session", "raw provider-auth session id");

  await page.getByLabel("Authorization code").fill(fakeAuthCode);
  await page.getByRole("button", { name: "Exchange authorization code" }).click();
  await page.evaluate(() => {
    const details = document.querySelector('[data-testid="provider-setup-details"]');
    if (details instanceof HTMLDetailsElement) details.open = true;
  });
  const connectedAccountVisible = await page.locator('[data-testid="provider-setup-details"]').getByText("OpenAI account connected", { exact: false }).first().isVisible().catch(() => false);
  if (connectedAccountVisible) {
    await expectVisibleText(page, "OpenAI account connected", "connected provider-auth state");
  } else {
    await expectVisibleText(page, "Experimental Codex-like OpenAI account chat is connected through the local runtime", "connected login-ready state");
  }
  await expectVisibleText(page, "Experimental Codex-like OpenAI account chat is connected through the local runtime", "login-ready chat copy");
  await expectVisibleText(page, "not official public OAuth support, and not production-ready", "non-default connected copy");
  await expectVisibleText(page, "Use OpenAI API key fallback", "API-key fallback preserved after login");
  await expectVisibleText(page, "OpenAI API-key fallback remains the safe/default setup", "API-key fallback safe/default copy");
  await expectSendEnabled(page, "experimental connected without API-key or Demo Mode");
  assertNoSecretLeak(await page.locator("body").innerText(), "DOM after provider-auth exchange");
  assertNoSecretLeak(requests.join("\n"), "browser request list after provider-auth exchange");

  await openDetailsBySummary(page, "Advanced chat controls", page.getByLabel("Chat id"));
  await page.getByLabel("Chat id").fill(chatId);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(firstPrompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, firstPrompt, "first user message");
  await expectVisibleText(page, assistantAnswer, "assistant first response");
  await assertAssistantAnswerCount(page, assistantAnswer, 1, "login-shaped assistant response");
  assert(chatCommandCount === 1, `expected one connected first-message command, observed ${chatCommandCount}`);

  await openDetailsBySummary(page, "Provider setup", page.getByRole("button", { name: "Disconnect login" }));
  await page.getByRole("button", { name: "Disconnect login" }).click();
  await expectVisibleText(page, "Provider required for first message", "post-disconnect no-provider readiness");
  await expectSendDisabled(page, "disconnect without API-key or Demo Mode");
  assert(chatCommandCount === 1, `disconnect state sent an unexpected command, observed ${chatCommandCount}`);

  await page.getByRole("button", { name: "Experimental high-risk account login" }).click();
  await expectVisibleText(page, "Manual authorization-code exchange", "manual code exchange after reconnect");
  await page.getByLabel("Authorization code").fill(fakeAuthCode);
  await page.getByRole("button", { name: "Exchange authorization code" }).click();
  await expectVisibleText(page, "Experimental Codex-like OpenAI account chat is connected through the local runtime", "reconnected login-ready chat copy");
  await expectSendEnabled(page, "experimental reconnected before precedence checks");

  apiKeyFallbackReady = true;
  await refreshRuntimeFromUi(page);
  await expectVisibleText(page, "Ready for your first message", "API-key precedence readiness title");
  await expectVisibleText(page, "Mock API-key fallback model", "API-key precedence model");
  await expectVisibleText(page, "Ready to send using Mock API-key fallback model", "API-key precedence ready copy");
  await expectSendEnabled(page, "API-key fallback precedence over experimental connected");

  demoModeEnabled = true;
  await refreshRuntimeFromUi(page);
  await expectVisibleText(page, "Demo Mode is ready", "Demo Mode precedence readiness title");
  await expectVisibleText(page, "Demo Mode ready — local canned responses, no provider calls. Ready to send.", "Demo Mode precedence lifecycle");
  await expectSendEnabled(page, "Demo Mode precedence over experimental connected");

  const pageState = await page.evaluate(() => JSON.stringify({
    body: document.body.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])) ,
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])) ,
  }));
  assertNoSecretLeak(pageState, "DOM or browser storage");
  assertNoSecretLeak(JSON.stringify(browserVisible), "browser console/page errors");
  assertNoSecretLeak(requests.join("\n"), "browser request list");
  assert(chatCommandCount === 1, `expected only one first-message command across transitions, observed ${chatCommandCount}`);
  assert(providerTestHits === 0, `mock login smoke unexpectedly tested a provider ${providerTestHits} time(s)`);
  assert(runtimeApiRequests.length > 0, "expected runtime API requests to be observed");
  assert(runtimeApiRequests.every((item) => item.authorized), "runtime API route missing Authorization: Bearer session token");
  assert(internalProviderSecrets?.accessToken === fakeAccessToken, "fake access token sentinel was not stored server-side after exchange");
  assert(internalProviderSecrets?.refreshToken === fakeRefreshToken, "fake refresh token sentinel was not stored server-side after exchange");
  assert(internalProviderSecrets?.cookie === fakeCookie, "fake cookie sentinel was not stored server-side after exchange");
  assert(internalProviderSecrets?.apiKey === fakeApiKey, "fake API-key sentinel was not stored server-side after exchange");

  const evidence = await saveVisualEvidence(page);
  if (failures.length > 0) throw new Error(`Login first-message smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  console.log("Login first-message smoke passed.");
  console.log("Verified built GUI against a loopback mock runtime: runtime connected; no-provider and pending states kept Send disabled; experimental/non-default provider-auth moved login_available -> pending -> connected via fake local authorization-code exchange; connected sent exactly one first message and rendered one mock assistant response; disconnect returned to disabled/no-provider state; API-key fallback and Demo Mode each took precedence over experimental connected; and no real provider/hosted service/IDE/JCEF/signing/publishing path was used.");
  console.log("Limit: this is bounded mock-only login-shaped coverage; it does not prove official production OpenAI/ChatGPT account login or model quality.");
  console.log(`Saved sanitized visual evidence under ${path.relative(root, evidence.dir)}/ (${path.basename(evidence.screenshotPath)}, ${path.basename(evidence.domPath)}).`);
} finally {
  await browser?.close().catch(() => undefined);
  await guiServer?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) throw new Error("built GUI index.html does not reference Vite assets");
  } catch (error) {
    console.error("Login first-message smoke failed: built GUI is missing or invalid.");
    console.error("Run `cd apps/gui && npm run build` before `npm run smoke:login-first-message`.");
    console.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
async function requireChromium() {
  try { return await import("playwright"); } catch (error) {
    console.error("Login first-message smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if needed.");
    console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
async function saveVisualEvidence(page) {
  await mkdir(evidenceRoot, { recursive: true });
  const screenshotPath = path.join(evidenceRoot, "login-first-message.png");
  const domPath = path.join(evidenceRoot, "login-first-message.dom.txt");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const sanitizedText = await page.evaluate(() => document.body.innerText).then((text) => redactSecrets(text));
  await writeFile(domPath, sanitizedText, "utf8");
  return { dir: evidenceRoot, screenshotPath, domPath };
}
async function startRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") return empty(response, 204);
    if (url.pathname.startsWith("/v1/")) {
      const authorized = request.headers.authorization === `Bearer ${runtimeToken}`;
      runtimeApiRequests.push({ method: request.method, path: url.pathname, authorized });
      if (!authorized) return json(response, 401, { error: "missing runtime Authorization bearer token" });
    }
    if (request.method === "GET" && url.pathname === "/v1/ping") return json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: new Date().toISOString() });
    if (request.method === "GET" && url.pathname === "/v1/caps") return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: { providerAuthMock: true }, providers: providerSummaries(), ide: { bridge: true, lsp: false } });
    if (request.method === "GET" && url.pathname === "/v1/demo-mode") return json(response, 200, demoModeResponse());
    if (request.method === "GET" && url.pathname === "/v1/models") return json(response, 200, { models: modelSummaries() });
    if (request.method === "GET" && url.pathname === "/v1/providers") return json(response, 200, { providers: providerSummaries(), cloudRequired: false, providerAccess: "direct" });
    if (request.method === "POST" && url.pathname === "/v1/demo-mode") {
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      demoModeEnabled = body.enabled === true;
      return json(response, 200, demoModeResponse());
    }
    if (request.method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json(response, 200, providerAuthResponse());
    if (request.method === "POST" && url.pathname === "/v1/provider-auth/openai/start") {
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      if (body.experimentalCodexLike !== true) return json(response, 400, { error: "mock login smoke requires explicit experimentalCodexLike" });
      loginStatus = "pending";
      sessionId = `mock-session-${randomUUID()}`;
      authState = `mock-state-${randomUUID()}`;
      internalProviderSecrets = undefined;
      return json(response, 200, providerAuthResponse());
    }
    if (request.method === "POST" && url.pathname === "/v1/provider-auth/openai/exchange") {
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      if (body.sessionId !== sessionId || body.code !== fakeAuthCode || body.state !== authState) return json(response, 400, { error: "mock exchange rejected sanitized invalid code" });
      loginStatus = "connected";
      internalProviderSecrets = { accessToken: fakeAccessToken, refreshToken: fakeRefreshToken, cookie: fakeCookie, apiKey: fakeApiKey };
      return json(response, 200, providerAuthResponse());
    }
    if (request.method === "POST" && url.pathname === "/v1/provider-auth/openai/disconnect") {
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      if (Object.keys(body).length !== 0) return json(response, 400, { error: "disconnect request body must be an empty JSON object" });
      loginStatus = "not_configured";
      sessionId = undefined;
      authState = undefined;
      internalProviderSecrets = undefined;
      return json(response, 200, providerAuthResponse());
    }
    if (request.method === "GET" && url.pathname === "/v1/chats") return json(response, 200, { chats: Array.from(chats.values()).map(toSummary) });
    if (request.method === "POST" && url.pathname === "/v1/chats") return json(response, 200, thread("chat-created", "Created login smoke chat", []));
    if (request.method === "GET" && url.pathname === "/v1/chats/subscribe") { subscribe(response, url.searchParams.get("chat_id") ?? chatId); return; }
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(url.pathname);
    if (chatMatch && request.method === "GET") return json(response, 200, chats.get(decodeURIComponent(chatMatch[1])) ?? thread(decodeURIComponent(chatMatch[1]), "Login smoke chat", []));
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(url.pathname);
    if (commandMatch && request.method === "POST") {
      const targetChatId = decodeURIComponent(commandMatch[1]);
      const body = await readJsonBody(request, response);
      if (body === undefined) return;
      const item = chats.get(targetChatId) ?? thread(targetChatId, targetChatId, []);
      if (body.type === "user_message") {
        chatCommandCount += 1;
        item.messages.push(message(targetChatId, `user-${item.messages.length}`, "user", body.payload?.content ?? ""));
        chats.set(targetChatId, item);
        setTimeout(() => addAssistantResponse(targetChatId), 25);
      }
      return json(response, 200, { accepted: true, chatId: targetChatId, requestId: body.requestId ?? "request-001", type: body.type });
    }
    if (request.method === "POST" && /^\/v1\/providers\/.+\/test$/.test(url.pathname)) {
      providerTestHits += 1;
      return json(response, 200, { ok: true, providerId: decodeURIComponent(url.pathname.split("/")[3] ?? "openai-api"), status: "reachable", message: "Mock provider readiness only; no upstream provider call was made.", modelId: demoModeEnabled ? "yet-demo-chat" : "gpt-4o-mini", cloudRequired: false });
    }
    if (/^\/v1\/providers\//.test(url.pathname)) return json(response, 500, { error: "provider endpoints are disabled in mock login smoke" });
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
  });
  return listen(server);
}
function providerAuthResponse() {
  const common = { provider: "openai", supportsLogin: true, supportsApiKey: true, cloudRequired: false, message: "Mock-only experimental/non-default account login state from loopback smoke runtime. Not production official login." };
  if (loginStatus === "pending") return { ...common, configured: false, status: "pending", authSource: "oauth", authorizationUrl: `http://127.0.0.1:${runtimeServer.port}/mock-auth?state=${encodeURIComponent(authState)}`, sessionId, expiresAt: "2026-05-24T01:00:00Z", scopes: ["openid", "profile", "email"] };
  if (loginStatus === "connected") return { ...common, configured: true, status: "connected", authSource: "oauth", accountLabel: "mock login smoke account", scopes: ["openid", "profile", "email"], expiresAt: "2026-05-24T02:00:00Z", redacted: "mock-oauth-token-redacted" };
  if (loginStatus === "not_configured") return { ...common, configured: false, status: "not_configured", authSource: "none" };
  return { ...common, configured: false, status: "login_available", authSource: "none" };
}
function addAssistantResponse(targetChatId) {
  const item = chats.get(targetChatId) ?? thread(targetChatId, targetChatId, []);
  const assistantMessage = message(targetChatId, `assistant-${item.messages.length}`, "assistant", assistantAnswer);
  item.messages.push(assistantMessage);
  chats.set(targetChatId, item);
  pushSse(targetChatId, "stream_started", {});
  pushSse(targetChatId, "message_added", { message: assistantMessage });
  pushSse(targetChatId, "stream_finished", { finishReason: "stop" });
}
function subscribe(response, targetChatId) {
  response.writeHead(200, corsHeaders({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" }));
  writeSse(response, { seq: 0, type: "snapshot", chatId: targetChatId, payload: { thread: chats.get(targetChatId) ?? thread(targetChatId, targetChatId, []), messages: chats.get(targetChatId)?.messages ?? [], runtime: { streaming: false, waitingForResponse: false } } });
  const set = subscribers.get(targetChatId) ?? new Set();
  set.add(response);
  subscribers.set(targetChatId, set);
  response.on("close", () => set.delete(response));
}
function pushSse(targetChatId, type, payload) {
  const seq = (chatEventSeq.get(targetChatId) ?? 0) + 1;
  chatEventSeq.set(targetChatId, seq);
  for (const response of subscribers.get(targetChatId) ?? []) writeSse(response, { seq, type, chatId: targetChatId, payload });
}
function writeSse(response, event) { response.write(`event: ${event.type}\n`); response.write(`data: ${JSON.stringify(event)}\n\n`); }
async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) return response.writeHead(403).end("Forbidden");
    try { const fileStat = await stat(requestedPath); if (!fileStat.isFile()) return response.writeHead(404).end("Not found"); response.writeHead(200, { "content-type": contentType(requestedPath) }); createReadStream(requestedPath).pipe(response); } catch { response.writeHead(404).end("Not found"); }
  });
  return listen(server);
}
async function readBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
function demoModeResponse() { return { enabled: demoModeEnabled, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: demoModeEnabled ? "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality." : "Demo Mode disabled for login-shaped smoke; this smoke uses mock provider-auth and canned local chat." }; }
function modelSummaries() {
  if (demoModeEnabled) return [demoModel()];
  if (apiKeyFallbackReady) return [apiKeyFallbackModel()];
  return [];
}
function providerSummaries() {
  if (demoModeEnabled) return [demoProvider()];
  if (apiKeyFallbackReady) return [apiKeyFallbackProvider()];
  return [];
}
function apiKeyFallbackModel() { return { id: "gpt-4o-mini", displayName: "Mock API-key fallback model", providerId: "openai-api", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function apiKeyFallbackProvider() { return { id: "openai-api", kind: "openai-compatible", displayName: "Mock OpenAI API-key fallback", enabled: true, baseUrl: "http://127.0.0.1/mock-openai/v1", auth: { type: "api_key", configured: true, redacted: "provider-key-redacted" }, models: [apiKeyFallbackModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
function demoModel() { return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function demoProvider() { return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
function thread(id, title, messages) { return { chatId: id, title, createdAt: "2026-05-29T07:16:30Z", updatedAt: "2026-05-29T07:16:30Z", messages }; }
function message(id, messageId, role, content) { return { chatId: id, id: messageId, role, content, createdAt: "2026-05-29T07:16:30Z", status: "complete" }; }
function toSummary(item) { return { chatId: item.chatId, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, messageCount: item.messages.length }; }
async function listen(server) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port."); return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) }; }
async function readJsonBody(request, response) {
  let value;
  try {
    value = JSON.parse(await readBody(request));
  } catch {
    json(response, 400, { error: "malformed JSON request body" });
    return undefined;
  }
  if (!isPlainObject(value)) {
    json(response, 400, { error: "request body must be a JSON object" });
    return undefined;
  }
  return value;
}
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
async function configureRuntimeConnection(page) {
  await openDetailsBySummary(page, "Local runtime connection", page.getByRole("textbox", { name: "Session token", exact: true }));
  await page.getByRole("textbox", { name: "Session token", exact: true }).fill(runtimeToken);
  await page.getByLabel("Runtime base URL").fill(`http://127.0.0.1:${runtimeServer.port}`);
  await refreshRuntimeFromUi(page);
}
async function refreshRuntimeFromUi(page) {
  const refreshButton = page.locator("section", { has: page.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: "Refresh runtime" });
  await openDetailsBySummary(page, "Local runtime connection", refreshButton);
  await refreshButton.click();
  await expectVisibleText(page, "Runtime connected", "runtime connected after refresh");
}
async function expectSendDisabled(page, label) {
  const disabled = await page.getByRole("button", { name: "Send", exact: true }).isDisabled().catch(() => false);
  assert(disabled, `Expected Send to be disabled for ${label}.`);
  await expectVisibleText(page, "Send disabled", `${label} send-disabled badge`);
}
async function expectSendEnabled(page, label) {
  const enabled = await page.getByRole("button", { name: "Send", exact: true }).isEnabled().catch(() => false);
  assert(enabled, `Expected Send to be enabled for ${label}.`);
  await expectVisibleText(page, "Send available", `${label} send-available badge`);
}
async function openDetailsBySummary(page, summaryText, visibleLocator) { if (await visibleLocator.isVisible().catch(() => false)) return; const summary = page.locator("summary", { hasText: summaryText }).first(); await summary.click({ timeout: 5000 }).catch(async () => { await page.locator("details", { hasText: summaryText }).first().evaluate((element) => { if (element instanceof HTMLDetailsElement) element.open = true; }); }); await visibleLocator.waitFor({ state: "visible", timeout: 10_000 }); }
async function expectVisibleText(page, text, label, timeout = 20_000) { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).catch(async (error) => { const body = await page.locator("body").innerText().catch(() => ""); throw new Error(`Missing visible ${label}: ${text}\n${error.message}\nBody: ${redactSecrets(body).slice(0, 4000)}`); }); }
async function assertNoVisibleText(page, text, label) { const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false); assert(!visible, `Unexpected visible ${label}: ${text}`); }
async function assertAssistantAnswerCount(page, text, expected, label) { const count = await page.locator(".chat-bubble.assistant").evaluateAll((elements, answer) => elements.filter((element) => element.textContent?.includes(String(answer))).length, text); assert(count === expected, `Expected ${label} ${expected} time(s), observed ${count}`); }
function secretMarkers() { return [...staticSecretMarkers, sessionId, authState].filter(Boolean); }
function assertNoSecretLeak(text, source) { const value = String(text); const lower = value.toLowerCase(); for (const marker of secretMarkers()) { if (marker && lower.includes(marker.toLowerCase())) throw new Error(`Secret marker leaked through ${source}.`); } if (/sk-[A-Za-z0-9._-]{8,}/.test(value)) throw new Error(`API-key-like marker leaked through ${source}.`); if (/mock-(auth-code|access-token|refresh-token|cookie|session|state)-[A-Za-z0-9-]+/.test(value)) throw new Error(`Provider auth secret marker leaked through ${source}.`); if (/(?:codex|provider-login)-(?:session|state)-[A-Za-z0-9-]+/i.test(value)) throw new Error(`Provider auth session/state marker leaked through ${source}.`); }
function redactSecrets(text) { let redacted = String(text); for (const marker of secretMarkers()) if (marker) redacted = redacted.split(marker).join("[redacted]"); return redacted.replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9._-]{8,}/g, "[redacted-api-key]").replace(/mock-(auth-code|access-token|refresh-token|cookie|session|state)-[A-Za-z0-9-]+/g, "mock-$1-[redacted]").replace(/(?:codex|provider-login)-(session|state)-[A-Za-z0-9-]+/gi, "$1-[redacted]").replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]").replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]"); }
function isExpectedFetchConsoleError(text) { return /^Failed to load resource: (net::ERR_CONNECTION_REFUSED|the server responded with a status of 401 \(Unauthorized\))$/.test(text); }
function isLoopbackUrl(value) { try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "ws:") && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname); } catch { return false; } }
function redactUrl(value) { try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); } catch { return redactSecrets(value); } }
function empty(response, status) { response.writeHead(status, corsHeaders()); response.end(); }
function json(response, status, payload) { response.writeHead(status, corsHeaders({ "content-type": "application/json" })); response.end(JSON.stringify(payload)); }
function corsHeaders(extra = {}) { return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", ...extra }; }
function contentType(filePath) { if (filePath.endsWith(".html")) return "text/html; charset=utf-8"; if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8"; if (filePath.endsWith(".css")) return "text/css; charset=utf-8"; if (filePath.endsWith(".svg")) return "image/svg+xml"; return "application/octet-stream"; }
function assert(condition, message) { if (!condition) failures.push(message); }
