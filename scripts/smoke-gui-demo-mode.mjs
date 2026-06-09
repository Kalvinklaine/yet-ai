import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeToken = `demo-runtime-token-${randomUUID()}`;
const providerSecret = `sk-demo-provider-${randomUUID()}`;
const failures = [];
let guiServer;
let runtimeServer;
let browser;
let demoEnabled = false;
let providerHits = 0;
let chatCommandCount = 0;
const chats = new Map([["chat-001", thread("chat-001", "Demo smoke chat", [])]]);
const chatEvents = new Map();
const subscribers = new Map();

await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  guiServer = await startStaticServer(distRoot);
  runtimeServer = await startRuntimeServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:")) {
      failures.push(`Non-loopback request attempted: ${url}`);
    }
  });

  await page.goto(`http://127.0.0.1:${guiServer.port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await openDetailsBySummary(page, "Local runtime connection", page.getByRole("textbox", { name: "Session token", exact: true }));
  await page.getByRole("textbox", { name: "Session token", exact: true }).fill(runtimeToken);
  await page.getByLabel("Runtime base URL").fill(`http://127.0.0.1:${runtimeServer.port}`);
  await openDetailsBySummary(page, "Local runtime connection", page.getByRole("button", { name: "Refresh runtime" }).last());
  await page.getByRole("button", { name: "Refresh runtime" }).last().click();

  await expectVisibleText(page, "Runtime connected", "runtime connected");
  await expectVisibleText(page, "Try Demo Mode", "demo-mode offer");
  await page.getByRole("button", { name: "Try Demo Mode" }).first().click();
  await expectVisibleText(page, "Demo Mode is active in the local runtime", "demo enabled status");
  await expectVisibleText(page, "Ready to send using Yet AI Demo Chat.", "demo readiness");

  const firstPrompt = "Terminal message_added first prompt smoke.";
  const firstAnswer = "Terminal message_added first answer from Yet AI Demo Mode — no provider call was made.";
  const secondPrompt = "Terminal message_added second prompt smoke.";
  const secondAnswer = "Terminal message_added second answer from Yet AI Demo Mode — no provider call was made.";
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(firstPrompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, firstPrompt, "visible first user prompt");
  await expectVisibleText(page, firstAnswer, "first terminal message_added assistant response");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(secondPrompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, secondPrompt, "visible second user prompt");
  await expectVisibleText(page, firstAnswer, "first terminal message_added assistant response still visible after second send");
  await expectVisibleText(page, secondAnswer, "second terminal message_added assistant response without a third send");
  await expectVisibleText(page, "no provider call was made", "demo no-provider copy");
  await expectVisibleText(page, "Message sent; waiting for response stream.", "post-response terminal command accepted status");
  const postResponseBody = await page.evaluate(() => document.body.innerText);
  assert(!postResponseBody.includes("Ready when the local runtime and provider model are ready"), "post-response body still shows stale provider-ready waiting copy");
  assert(!postResponseBody.includes("Waiting for engine"), "post-response body still shows stale engine waiting copy");

  await page.getByRole("button", { name: "Disable Demo Mode" }).first().click();
  await expectVisibleText(page, "Try Demo Mode", "demo disabled offer");

  const pageState = await page.evaluate(() => JSON.stringify({
    body: document.body.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)];
    })),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? "";
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  for (const marker of [runtimeToken, providerSecret]) {
    assert(!pageState.includes(marker), `browser state leaked ${marker}`);
  }
  assert(providerHits === 0, `demo smoke unexpectedly hit provider ${providerHits} time(s)`);
  assert(chatCommandCount === 2, `demo smoke expected exactly two chat sends without a third send, observed ${chatCommandCount}`);

  if (failures.length > 0) {
    throw new Error(`GUI Demo Mode smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  console.log("GUI Demo Mode smoke passed.");
  console.log("Verified built GUI toggles local runtime Demo Mode, sends canned chat over local command/SSE/history, uses only loopback, and makes no provider calls or browser-storage secret writes.");
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
    console.error("GUI Demo Mode smoke failed: built GUI is missing or invalid.");
    console.error("Run `cd apps/gui && npm run build` before `npm run smoke:gui-demo-mode`.");
    console.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("GUI Demo Mode smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if needed.");
    console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function openDetailsBySummary(page, summaryText, visibleLocator) {
  if (await visibleLocator.isVisible().catch(() => false)) return;
  const summary = page.locator("summary", { hasText: summaryText }).first();
  await summary.click({ timeout: 5000 }).catch(async () => {
    await page.locator("details", { hasText: summaryText }).first().evaluate((element) => {
      if (element instanceof HTMLDetailsElement) element.open = true;
    });
  });
  await visibleLocator.waitFor({ state: "visible", timeout: 10_000 });
}

async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const fileStat = await stat(requestedPath);
      if (!fileStat.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(requestedPath) });
      createReadStream(requestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return listen(server);
}

async function startRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") return empty(response, 204);
    if (request.method === "GET" && url.pathname === "/v1/ping") return json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: new Date().toISOString() });
    if (request.method === "GET" && url.pathname === "/v1/caps") return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
    if (request.method === "GET" && url.pathname === "/v1/demo-mode") return json(response, 200, demoModeResponse());
    if (request.method === "POST" && url.pathname === "/v1/demo-mode") {
      const body = JSON.parse(await readBody(request));
      demoEnabled = body.enabled === true;
      return json(response, 200, demoModeResponse());
    }
    if (request.method === "GET" && url.pathname === "/v1/models") return json(response, 200, { models: demoEnabled ? [demoModel()] : [] });
    if (request.method === "GET" && url.pathname === "/v1/providers") return json(response, 200, { providers: demoEnabled ? [demoProvider()] : [], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "No account login in local demo smoke." });
    if (request.method === "GET" && url.pathname === "/v1/chats") return json(response, 200, { chats: Array.from(chats.values()).map(toSummary) });
    if (request.method === "POST" && url.pathname === "/v1/chats") {
      const created = thread("chat-created", "Created demo smoke chat", []);
      chats.set(created.chatId, created);
      return json(response, 200, created);
    }
    if (request.method === "GET" && url.pathname === "/v1/chats/subscribe") {
      subscribe(response, url.searchParams.get("chat_id") ?? "chat-001");
      return;
    }
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(url.pathname);
    if (chatMatch && request.method === "GET") {
      const chatId = decodeURIComponent(chatMatch[1]);
      return json(response, chats.has(chatId) ? 200 : 404, chats.get(chatId) ?? { error: "chat not found" });
    }
    if (request.method === "POST" && /^\/v1\/providers\//.test(url.pathname)) {
      providerHits += 1;
      return json(response, 500, { error: `provider should not be called ${providerSecret}` });
    }
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(url.pathname);
    if (commandMatch && request.method === "POST") {
      const chatId = decodeURIComponent(commandMatch[1]);
      const body = JSON.parse(await readBody(request));
      const item = chats.get(chatId) ?? thread(chatId, chatId, []);
      if (body.type === "user_message") {
        chatCommandCount += 1;
        item.messages.push(message(chatId, `user-${item.messages.length}`, "user", body.payload?.content ?? ""));
        chats.set(chatId, item);
        setTimeout(() => addTerminalDemoAssistantResponse(chatId, body.payload?.content ?? ""), 25);
      }
      return json(response, 200, { accepted: true, chatId, requestId: body.requestId ?? "request-001", type: body.type });
    }
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
  });
  return listen(server);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8") || "{}";
}

function demoModeResponse() {
  return { enabled: demoEnabled, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality." };
}
function subscribe(response, chatId) {
  response.writeHead(200, corsHeaders({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  }));
  writeSse(response, snapshotEvent(chatId));
  for (const event of chatEvents.get(chatId) ?? []) writeSse(response, event);
  const chatSubscribers = subscribers.get(chatId) ?? new Set();
  chatSubscribers.add(response);
  subscribers.set(chatId, chatSubscribers);
  const remove = () => chatSubscribers.delete(response);
  response.on("close", remove);
  response.on("error", remove);
}
function addTerminalDemoAssistantResponse(chatId, prompt) {
  const content = terminalDemoAnswer(prompt);
  const item = chats.get(chatId) ?? thread(chatId, chatId, []);
  const assistantMessage = message(chatId, `assistant-${item.messages.length}`, "assistant", content);
  item.messages.push(assistantMessage);
  chats.set(chatId, item);
  pushChatEvent(chatId, "message_added", { message: assistantMessage });
}
function terminalDemoAnswer(prompt) {
  if (prompt === "Terminal message_added second prompt smoke.") return "Terminal message_added second answer from Yet AI Demo Mode — no provider call was made.";
  return "Terminal message_added first answer from Yet AI Demo Mode — no provider call was made.";
}
function pushChatEvent(chatId, type, payload) {
  const events = chatEvents.get(chatId) ?? [];
  const event = { seq: events.length + 1, type, chatId, payload };
  events.push(event);
  chatEvents.set(chatId, events);
  for (const response of subscribers.get(chatId) ?? []) writeSse(response, event);
}
function snapshotEvent(chatId) {
  const item = chats.get(chatId) ?? thread(chatId, chatId, []);
  return { seq: 0, type: "snapshot", chatId, payload: { thread: { id: chatId, title: item.title, messages: item.messages }, messages: item.messages, runtime: { streaming: false, waitingForResponse: false } } };
}
function writeSse(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
function demoModel() { return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function demoProvider() { return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
function thread(chatId, title, messages) { return { chatId, title, createdAt: "2026-05-29T07:16:30Z", updatedAt: "2026-05-29T07:16:30Z", messages }; }
function message(chatId, id, role, content) { return { chatId, id, role, content, createdAt: "2026-05-29T07:16:30Z", status: "complete" }; }
function toSummary(item) { return { chatId: item.chatId, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, messageCount: item.messages.length }; }
async function listen(server) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port."); return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) }; }
async function expectVisibleText(page, text, label, timeout = 20_000) { const visible = await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false); assert(visible, `Missing visible ${label}: ${text}`); }
function empty(response, status) { response.writeHead(status, corsHeaders()); response.end(); }
function json(response, status, payload) { response.writeHead(status, corsHeaders({ "content-type": "application/json" })); response.end(JSON.stringify(payload)); }
function corsHeaders(extra = {}) { return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", ...extra }; }
function contentType(filePath) { if (filePath.endsWith(".html")) return "text/html; charset=utf-8"; if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8"; if (filePath.endsWith(".css")) return "text/css; charset=utf-8"; if (filePath.endsWith(".svg")) return "image/svg+xml"; return "application/octet-stream"; }
function assert(condition, message) { if (!condition) failures.push(message); }
