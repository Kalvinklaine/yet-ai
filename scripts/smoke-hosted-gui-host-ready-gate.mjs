import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGuiSmokeBootstrap } from "./lib/gui-smoke-bootstrap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const runtimeSessionValue = `hr-${randomUUID().replaceAll("-", "")}`;
const readyGeneration = "hosted-smoke-ready-1";
const projectId = "prj_abcdefghijklmnopqrstuA";
const runtimeRequests = [];
let smoke;
let runtimeServer;

const chromium = await requireChromium();

try {
  runtimeServer = await startRuntimeServer();
  smoke = await createGuiSmokeBootstrap({
    distRoot,
    chromium,
    entry: { mode: "hosted", route: "/vscode/hosted-chat", entryMode: "hosted_chat" },
    privacyMarkers: [runtimeSessionValue],
  });
  await smoke.waitForGuiReady();
  assert(smoke.entry.host === "vscode", `expected hosted VS Code entry, observed ${smoke.entry.host}`);
  await smoke.page.waitForTimeout(750);
  assert(runtimeRequests.length === 0, `runtime requests before host.ready: ${describeRequests(runtimeRequests)}`);
  await smoke.sendHostReady({
    requestId: readyGeneration,
    runtimeUrl: `http://127.0.0.1:${runtimeServer.port}`,
    sessionToken: runtimeSessionValue,
    workspaceBinding: { state: "auto_bound", projectId, displayName: "Hosted smoke workspace" },
  });
  await waitForPostReadyRuntimeRequest();
  await smoke.page.waitForTimeout(250);
  const missingAuthorization = runtimeRequests.filter((request) => request.authorization !== `Bearer ${runtimeSessionValue}`);
  const missingCaller = runtimeRequests.filter((request) => request.caller !== "gui_runtime_client");
  assert(missingAuthorization.length === 0, `post-ready runtime requests missing Authorization: ${describeRequests(missingAuthorization)}`);
  assert(missingCaller.length === 0, `post-ready runtime requests missing caller header: ${describeRequests(missingCaller)}`);
  await smoke.assertPrivacy();
  smoke.assertHealthy();
  console.log("Hosted GUI host.ready gate smoke passed.");
  console.log(`Verified the canonical hosted route, correlated workspace generation, zero pre-ready runtime requests, and ${runtimeRequests.length} authorized post-ready runtime requests.`);
} finally {
  await smoke?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function waitForPostReadyRuntimeRequest() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (runtimeRequests.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for post-ready runtime request.");
}

async function requireChromium() {
  try {
    const playwright = await import("playwright");
    const browserCheck = await playwright.chromium.launch({ headless: true });
    await browserCheck.close();
    return playwright.chromium;
  } catch {
    console.error("Hosted GUI host.ready gate smoke prerequisite missing: install Playwright browsers with `npx playwright install chromium`.");
    process.exit(1);
  }
}

async function startRuntimeServer() {
  const chats = new Map([["chat-001", { chatId: "chat-001", title: "Hosted gate smoke", createdAt: now(), updatedAt: now(), messages: [] }]]);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "OPTIONS" && url.pathname.includes("/v1/")) {
      runtimeRequests.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization ?? null, caller: request.headers["x-yet-ai-caller"] ?? null });
    }
    if (request.method === "OPTIONS") return empty(response, 204);
    if (request.method === "GET" && url.pathname.endsWith("/v1/ping")) return json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: now() });
    if (request.method === "GET" && url.pathname.endsWith("/v1/caps")) return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
    if (request.method === "GET" && url.pathname.endsWith("/v1/models")) return json(response, 200, { models: [demoModel()] });
    if (request.method === "GET" && url.pathname.endsWith("/v1/providers")) return json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname.endsWith("/v1/demo-mode")) return json(response, 200, { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Local canned responses." });
    if (request.method === "GET" && url.pathname.endsWith("/v1/provider-auth/openai/status")) return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "No account login." });
    if (request.method === "GET" && url.pathname.endsWith("/v1/chats")) return json(response, 200, { chats: Array.from(chats.values()).map((chat) => ({ chatId: chat.chatId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length })) });
    if (request.method === "GET" && url.pathname.endsWith(`/v1/projects/${projectId}`)) return json(response, 200, { project: { projectId, displayName: "Hosted smoke workspace", state: "available", archived: false } });
    if (request.method === "GET" && url.pathname.endsWith("/v1/project-memory")) return json(response, 200, { notes: [] });
    if (request.method === "GET" && url.pathname.endsWith("/v1/agent-progress")) return json(response, 200, { snapshots: [] });
    const chatMatch = /\/v1\/chats\/([^/]+)$/.exec(url.pathname);
    if (chatMatch && request.method === "GET") return json(response, 200, chats.get(decodeURIComponent(chatMatch[1])) ?? chats.get("chat-001"));
    response.writeHead(404, { "content-type": "application/json", ...corsHeaders() }).end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Runtime server did not bind.");
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
function now() { return "2026-05-29T07:16:30Z"; }
function sanitizeText(text) { return String(text).replaceAll(runtimeSessionValue, "[redacted-runtime-token]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"); }
function assert(condition, message) { if (!condition) throw new Error(sanitizeText(message)); }
