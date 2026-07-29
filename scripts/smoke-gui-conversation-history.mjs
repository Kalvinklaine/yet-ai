import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createGuiSmokeBootstrap } from "./lib/gui-smoke-bootstrap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const projectId = "prj_abcdefghijklmnopqrstuA";
const projectName = "Conversation history workspace";
const readyGeneration = "conversation-history-ready-1";
const runtimeToken = `history-runtime-token-${randomUUID()}`;
const providerSecret = `sk-history-provider-${randomUUID()}`;
const deletedSentinel = `deleted-history-sentinel-${randomUUID()}`;
const failures = [];
const runtimeRequests = [];

let runtimeServer;
let smoke;

const chats = new Map([
  ["chat-alpha", thread("chat-alpha", "Alpha local thread", [message("chat-alpha", "alpha-user", "user", `Alpha deleted ${deletedSentinel}`)])],
  ["chat-beta", thread("chat-beta", "Beta local thread", [message("chat-beta", "beta-user", "user", "Beta persisted prompt"), message("chat-beta", "beta-assistant", "assistant", "Beta persisted answer")])],
]);

const chromium = await requireChromium();

try {
  runtimeServer = await startRuntimeServer();
  smoke = await createGuiSmokeBootstrap({
    distRoot,
    chromium,
    entry: { mode: "hosted", route: "/vscode/hosted-chat", entryMode: "hosted_chat" },
    viewport: { width: 1440, height: 1000 },
    privacyMarkers: [runtimeToken],
  });
  const page = smoke.page;
  await smoke.waitForGuiReady();
  assert(smoke.entry.host === "vscode", `expected hosted VS Code entry, observed ${smoke.entry.host}`);
  await page.waitForTimeout(250);
  assert(runtimeRequests.length === 0, `runtime requests were sent before host.ready: ${describeRequests(runtimeRequests)}`);
  await smoke.sendHostReady({
    requestId: readyGeneration,
    runtimeUrl: `http://127.0.0.1:${runtimeServer.port}`,
    sessionToken: runtimeToken,
    workspaceBinding: { state: "auto_bound", projectId, displayName: projectName },
  });

  await expectVisibleText(page, "Hosted workspace", "current-workspace dashboard");
  await expectVisibleText(page, projectName, "safe workspace binding");
  await expectVisibleText(page, "Alpha local thread", "dashboard alpha conversation");
  await expectVisibleText(page, "Beta local thread", "dashboard beta conversation");
  await page.getByRole("button", { name: "Open Beta local thread", exact: true }).click();

  await expectVisibleText(page, "2 local runtime conversations returned.", "initial conversation count");
  await expectConversationRow(page, {
    title: "Alpha local thread",
    updatedAt: "2026-05-29T07:16:30Z",
    messageCountLabel: "1 persisted message",
    positionLabel: "Conversation 2 of 2",
    active: false,
  });
  await expectConversationRow(page, {
    title: "Beta local thread",
    updatedAt: "2026-05-29T07:16:30Z",
    messageCountLabel: "2 persisted messages",
    positionLabel: "Conversation 1 of 2",
    active: true,
  });
  await expectVisibleText(page, "Beta persisted prompt", "selected beta thread prompt");
  await expectVisibleText(page, "Beta persisted answer", "selected beta thread answer");

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expectVisibleText(page, "Created smoke thread", "created chat title");
  const createdRow = page.locator(".conversation-item").filter({ has: page.locator(".conversation-title", { hasText: "Created smoke thread" }) }).first();
  await createdRow.waitFor({ state: "visible", timeout: 10_000 });
  const createdSelect = createdRow.locator("button.conversation-select");
  if (await createdSelect.isEnabled()) await createdSelect.click();
  const createdDelete = createdRow.locator("button.conversation-delete");
  await createdDelete.waitFor({ state: "visible", timeout: 10_000 });
  page.once("dialog", (dialog) => dialog.accept());
  await createdDelete.click();
  await expectVisibleText(page, "Beta local thread", "truthful retained selection after deleting created chat");
  await expectVisibleText(page, "Deleted Created smoke thread.", "truthful delete notice");
  await page.waitForFunction(() => !Array.from(document.querySelectorAll(".conversation-title")).some((element) => element.textContent?.trim() === "Created smoke thread"), undefined, { timeout: 5000 }).catch(() => undefined);
  assert(await page.locator(".conversation-title", { hasText: "Created smoke thread" }).count() === 0, "deleted chat stayed in the conversation list");

  const browserStorage = await page.evaluate(() => JSON.stringify({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)];
    })),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? "";
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  for (const marker of [runtimeToken, providerSecret, deletedSentinel, "Created smoke thread"]) {
    assert(!browserStorage.includes(marker), `browser storage leaked ${marker}`);
  }

  const unauthorized = runtimeRequests.filter((request) => request.authorization !== `Bearer ${runtimeToken}` || request.caller !== "gui_runtime_client");
  assert(unauthorized.length === 0, `runtime requests lacked trusted headers: ${describeRequests(unauthorized)}`);
  assert(runtimeRequests.some((request) => request.method === "GET" && request.path === `/p/${projectId}/v1/chats`), "project-scoped chat list was not requested");
  assert(runtimeRequests.some((request) => request.method === "POST" && request.path === `/p/${projectId}/v1/chats`), "project-scoped chat create was not requested");
  assert(runtimeRequests.some((request) => request.method === "DELETE" && request.path === `/p/${projectId}/v1/chats/chat-created`), "project-scoped chat delete was not requested");
  smoke.assertHealthy();
  if (failures.length > 0) throw new Error(`GUI conversation-history smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);

  console.log("GUI conversation-history smoke passed.");
  console.log("Verified canonical hosted current-workspace routing, project-scoped list/select/create/delete fallback, and no browser-storage history/token/provider-secret leaks.");
} finally {
  await smoke?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function requireChromium() {
  try {
    const playwright = await import("playwright");
    const browserCheck = await playwright.chromium.launch({ headless: true });
    await browserCheck.close();
    return playwright.chromium;
  } catch {
    console.error("GUI conversation-history smoke prerequisite missing: install Playwright browsers with `npx playwright install chromium`.");
    process.exit(1);
  }
}

async function startRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") return empty(response, 204);
    if (url.pathname.includes("/v1/")) {
      runtimeRequests.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization ?? null, caller: request.headers["x-yet-ai-caller"] ?? null });
    }
    const scopedMatch = /^\/p\/([^/]+)\/v1(?:\/|$)/.exec(url.pathname);
    if (scopedMatch && scopedMatch[1] !== projectId) {
      failures.push(`unexpected project id requested: ${scopedMatch[1]}`);
      return json(response, 404, { error: "project not found" });
    }

    if (request.method === "GET" && url.pathname === "/v1/ping") return json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: now() });
    if (request.method === "GET" && url.pathname === "/v1/caps") return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
    if (request.method === "GET" && url.pathname === "/v1/models") return json(response, 200, { models: [demoModel()] });
    if (request.method === "GET" && url.pathname === "/v1/providers") return json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === "/v1/demo-mode") return json(response, 200, { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Local canned responses." });
    if (request.method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "No account login." });
    if (request.method === "GET" && url.pathname === `/v1/projects/${projectId}`) return json(response, 200, projectSummary());
    if (url.pathname.startsWith("/v1/projects/") && request.method === "GET") {
      failures.push(`unexpected project summary path requested: ${url.pathname}`);
      return json(response, 404, { error: "project not found" });
    }

    const chatsPath = `/p/${projectId}/v1/chats`;
    if (request.method === "GET" && url.pathname === chatsPath) return json(response, 200, { chats: Array.from(chats.values()).map(toSummary) });
    if (request.method === "POST" && url.pathname === chatsPath) {
      const created = thread("chat-created", "Created smoke thread", [message("chat-created", "created-user", "user", providerSecret)]);
      chats.set(created.chatId, created);
      return json(response, 201, created);
    }
    if (request.method === "GET" && url.pathname === `/p/${projectId}/v1/project-memory`) return json(response, 200, { notes: [], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === `/p/${projectId}/v1/agent-progress`) return json(response, 200, { snapshots: [], cloudRequired: false, providerAccess: "direct" });
    const chatMatch = new RegExp(`^/p/${projectId}/v1/chats/([^/]+)$`).exec(url.pathname);
    if (chatMatch && request.method === "GET") {
      const chatId = decodeURIComponent(chatMatch[1]);
      return json(response, chats.has(chatId) ? 200 : 404, chats.get(chatId) ?? { error: "chat not found" });
    }
    if (chatMatch && request.method === "DELETE") {
      const chatId = decodeURIComponent(chatMatch[1]);
      chats.delete(chatId);
      return json(response, 200, { deleted: true, chatId });
    }

    failures.push(`unexpected runtime request: ${request.method} ${url.pathname}`);
    return json(response, 404, { error: "not found" });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Runtime server did not bind.");
  return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function expectVisibleText(page, text, label, timeout = 20_000) {
  const visible = await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
  assert(visible, `Missing visible ${label}: ${text}`);
}

async function expectConversationRow(page, { title, updatedAt, messageCountLabel, positionLabel, active }) {
  const row = page.locator(".conversation-item").filter({ has: page.locator(".conversation-title", { hasText: title }) }).first();
  await row.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  const rowParts = await row.evaluate((element) => {
    const text = (selector) => element.querySelector(selector)?.textContent?.trim() ?? "";
    const select = element.querySelector("button.conversation-select");
    return { label: element.getAttribute("aria-label") ?? "", selectLabel: select?.getAttribute("aria-label") ?? "", title: text(".conversation-title"), updated: text(".conversation-updated"), messageCount: text(".conversation-message-count"), position: text(".conversation-position") };
  }).catch(() => undefined);
  const currentCopy = active ? ", current conversation" : "";
  const selectPrefix = active ? "Current conversation" : "Open conversation";
  assert(rowParts?.label === `${positionLabel}: ${title}${currentCopy}. Updated ${updatedAt}. ${messageCountLabel}.`, `Conversation row aria-label is not readable for ${title}`);
  assert(rowParts?.selectLabel === `${selectPrefix}: ${title}. ${positionLabel}. ${messageCountLabel}.`, `Conversation selector aria-label is not readable for ${title}`);
  assert(rowParts?.title === title, `Conversation row title is not structured/readable for ${title}`);
  assert(rowParts?.updated === `Updated ${updatedAt}`, `Conversation row updated label is not structured/readable for ${title}`);
  assert(rowParts?.messageCount === messageCountLabel, `Conversation row message-count label is not structured/readable for ${title}`);
  assert(rowParts?.position === positionLabel, `Conversation row position label is not structured/readable for ${title}`);
  const deleteLabel = `Delete conversation: ${title} (${active ? "current; " : ""}confirmation required)`;
  assert(await row.locator("button.conversation-delete").getAttribute("aria-label") === deleteLabel, `Expected one clear delete-conversation label for ${title}`);
}

function projectSummary() {
  return { projectId, displayName: projectName, status: "available", revision: "1", createdAt: now(), lastOpenedAt: now(), rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
}
function demoModel() { return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function demoProvider() { return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function thread(chatId, title, messages) { return { chatId, title, createdAt: now(), updatedAt: now(), messages }; }
function message(chatId, id, role, content) { return { chatId, id, role, content, createdAt: now(), status: "complete" }; }
function toSummary(item) { return { chatId: item.chatId, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, messageCount: item.messages.length }; }
function now() { return "2026-05-29T07:16:30Z"; }
function empty(response, status) { response.writeHead(status, corsHeaders()); response.end(); }
function json(response, status, payload) { response.writeHead(status, corsHeaders({ "content-type": "application/json" })); response.end(JSON.stringify(payload)); }
function corsHeaders(extra = {}) { return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-yet-ai-caller", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", ...extra }; }
function describeRequests(requests) { return JSON.stringify(requests.map((request) => ({ method: request.method, path: request.path, authorized: request.authorization === `Bearer ${runtimeToken}`, caller: request.caller }))); }
function assert(condition, message) { if (!condition) failures.push(String(message).replaceAll(runtimeToken, "[redacted-runtime-token]").replaceAll(providerSecret, "[redacted-provider-secret]")); }
