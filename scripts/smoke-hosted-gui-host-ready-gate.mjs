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
const runtimeSessionValue = `hr-${randomUUID().replaceAll("-", "")}`;
const runtimeRequests = [];
let guiServer;
let runtimeServer;
let browser;

await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  guiServer = await startStaticServer(distRoot);
  runtimeServer = await startRuntimeServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", (error) => { throw new Error(`Hosted GUI page error: ${sanitizeText(error.message)}`); });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:")) throw new Error(`Non-loopback request attempted: ${sanitizeText(url)}`);
  });
  await page.addInitScript(() => {
    window.__yetAiBridgePosts = [];
    window.acquireVsCodeApi = () => ({ postMessage: (message) => window.__yetAiBridgePosts.push(message) });
  });
  await page.goto(`http://127.0.0.1:${guiServer.port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Array.isArray(window.__yetAiBridgePosts) && window.__yetAiBridgePosts.some((message) => message?.type === "gui.ready"), undefined, { timeout: 5000 });
  const bridgeHost = await page.evaluate(() => document.querySelector("main.app-shell")?.classList.contains("host-vscode") ? "vscode" : null);
  assert(bridgeHost === "vscode", `expected hosted VS Code bridge, observed ${bridgeHost ?? "unknown"}`);
  await page.waitForTimeout(750);
  assert(runtimeRequests.length === 0, `runtime requests before host.ready: ${describeRequests(runtimeRequests)}`);
  await dispatchHostReady(page);
  await waitForPostReadyRuntimeRequest();
  await page.waitForTimeout(250);
  const missingAuthorization = runtimeRequests.filter((request) => request.method !== "OPTIONS" && request.authorization !== `Bearer ${runtimeSessionValue}`);
  const missingCaller = runtimeRequests.filter((request) => request.method !== "OPTIONS" && request.caller !== "gui_runtime_client");
  assert(missingAuthorization.length === 0, `post-ready runtime requests missing Authorization: ${describeRequests(missingAuthorization)}`);
  assert(missingCaller.length === 0, `post-ready runtime requests missing caller header: ${describeRequests(missingCaller)}`);
  console.log("Hosted GUI host.ready gate smoke passed.");
  console.log(`Verified zero runtime requests before host.ready and ${runtimeRequests.filter((request) => request.method !== "OPTIONS").length} authorized post-ready runtime requests.`);
} finally {
  await browser?.close().catch(() => undefined);
  await guiServer?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function dispatchHostReady(page) {
  await page.evaluate((payload) => {
    window.dispatchEvent(new MessageEvent("message", { data: { version: "2026-05-15", type: "host.ready", payload } }));
  }, { runtimeUrl: `http://127.0.0.1:${runtimeServer.port}`, sessionToken: runtimeSessionValue, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false });
}

async function waitForPostReadyRuntimeRequest() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (runtimeRequests.some((request) => request.method !== "OPTIONS")) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for post-ready runtime request.");
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) throw new Error("built GUI index.html does not reference Vite assets");
  } catch {
    console.error("Hosted GUI host.ready gate smoke prerequisite missing: run `npm --prefix apps/gui run build`.");
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    const playwright = await import("playwright");
    const browserCheck = await playwright.chromium.launch({ headless: true });
    await browserCheck.close();
    return playwright;
  } catch {
    console.error("Hosted GUI host.ready gate smoke prerequisite missing: install Playwright browsers with `npx playwright install chromium`.");
    process.exit(1);
  }
}

async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) return response.writeHead(403).end("Forbidden");
    try {
      const fileStat = await stat(requestedPath);
      if (!fileStat.isFile()) return response.writeHead(404).end("Not found");
      response.writeHead(200, { "content-type": contentType(requestedPath) });
      createReadStream(requestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return listen(server);
}

async function startRuntimeServer() {
  const chats = new Map([["chat-001", { chatId: "chat-001", title: "Hosted gate smoke", createdAt: now(), updatedAt: now(), messages: [] }]]);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "OPTIONS" && url.pathname.startsWith("/v1/")) {
      runtimeRequests.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization ?? null, caller: request.headers["x-yet-ai-caller"] ?? null });
    }
    if (request.method === "OPTIONS") return empty(response, 204);
    if (request.method === "GET" && url.pathname === "/v1/ping") return json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: now() });
    if (request.method === "GET" && url.pathname === "/v1/caps") return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
    if (request.method === "GET" && url.pathname === "/v1/models") return json(response, 200, { models: [demoModel()] });
    if (request.method === "GET" && url.pathname === "/v1/providers") return json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === "/v1/demo-mode") return json(response, 200, { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Local canned responses." });
    if (request.method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "No account login." });
    if (request.method === "GET" && url.pathname === "/v1/chats") return json(response, 200, { chats: Array.from(chats.values()).map((chat) => ({ chatId: chat.chatId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length })) });
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(url.pathname);
    if (chatMatch && request.method === "GET") return json(response, 200, chats.get(decodeURIComponent(chatMatch[1])) ?? chats.get("chat-001"));
    response.writeHead(404, { "content-type": "application/json", ...corsHeaders() }).end(JSON.stringify({ error: "not found" }));
  });
  return listen(server);
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port.");
  return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) };
}

function describeRequests(requests) {
  return sanitizeText(JSON.stringify(requests.map((request) => ({ method: request.method, path: request.path, hasAuthorization: request.authorization === `Bearer ${runtimeSessionValue}`, caller: request.caller }))));
}
function demoModel() { return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function demoProvider() { return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
function empty(response, status) { response.writeHead(status, corsHeaders()); response.end(); }
function json(response, status, payload) { response.writeHead(status, corsHeaders({ "content-type": "application/json" })); response.end(JSON.stringify(payload)); }
function corsHeaders(extra = {}) { return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-yet-ai-caller", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", ...extra }; }
function contentType(filePath) { if (filePath.endsWith(".html")) return "text/html; charset=utf-8"; if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8"; if (filePath.endsWith(".css")) return "text/css; charset=utf-8"; if (filePath.endsWith(".svg")) return "image/svg+xml"; return "application/octet-stream"; }
function now() { return "2026-05-29T07:16:30Z"; }
function sanitizeText(text) { return String(text).replaceAll(runtimeSessionValue, "[redacted-runtime-token]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"); }
function assert(condition, message) { if (!condition) throw new Error(sanitizeText(message)); }
