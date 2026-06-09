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
const runtimeToken = `history-runtime-token-${randomUUID()}`;
const providerSecret = `sk-history-provider-${randomUUID()}`;
const deletedSentinel = `deleted-history-sentinel-${randomUUID()}`;
const failures = [];

let guiServer;
let runtimeServer;
let browser;

const chats = new Map([
  ["chat-alpha", thread("chat-alpha", "Alpha local thread", [message("chat-alpha", "alpha-user", "user", `Alpha deleted ${deletedSentinel}`)])],
  ["chat-beta", thread("chat-beta", "Beta local thread", [message("chat-beta", "beta-user", "user", "Beta persisted prompt"), message("chat-beta", "beta-assistant", "assistant", "Beta persisted answer")])],
]);

await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  guiServer = await startStaticServer(distRoot);
  runtimeServer = await startRuntimeServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${error.message}`));
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:")) {
      failures.push(`Non-loopback request attempted: ${request.url()}`);
    }
  });

  await page.goto(`http://127.0.0.1:${guiServer.port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await openDetailsBySummary(page, "Local runtime connection", page.getByRole("textbox", { name: "Session token", exact: true }));
  await page.getByRole("textbox", { name: "Session token", exact: true }).fill(runtimeToken);
  await page.getByLabel("Runtime base URL").fill(`http://127.0.0.1:${runtimeServer.port}`);
  const refreshButton = page.locator("section", { has: page.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: "Refresh runtime" });
  await openDetailsBySummary(page, "Local runtime connection", refreshButton);
  await refreshButton.click();

  await expectVisibleText(page, "Alpha local thread", "initial alpha chat");
  await expectVisibleText(page, "Beta local thread", "initial beta chat");
  await expectVisibleText(page, "2 local runtime conversations returned.", "initial conversation count");
  await expectConversationRow(page, {
    title: "Alpha local thread",
    updatedAt: "2026-05-29T07:16:30Z",
    messageCountLabel: "1 persisted message",
    positionLabel: "Conversation 1 of 2",
  });
  await expectConversationRow(page, {
    title: "Beta local thread",
    updatedAt: "2026-05-29T07:16:30Z",
    messageCountLabel: "2 persisted messages",
    positionLabel: "Conversation 2 of 2",
  });

  await page.getByRole("button", { name: /^Open conversation: Beta local thread$/ }).click();
  await expectVisibleText(page, "Beta persisted prompt", "selected beta thread prompt");
  await expectVisibleText(page, "Beta persisted answer", "selected beta thread answer");

  await page.getByRole("button", { name: "New chat" }).click();
  await expectVisibleText(page, "Created smoke thread", "created chat title");
  await expectVisibleText(page, providerSecret, "created chat visible runtime message");

  await page.getByRole("button", { name: /^Delete conversation: Created smoke thread \(current\)$/ }).click();
  await expectVisibleText(page, "Beta local thread", "fallback chat after delete");
  await page.waitForFunction(() => !document.body.innerText.includes("Created smoke thread"), undefined, { timeout: 5000 }).catch(() => undefined);
  const bodyAfterDelete = await page.locator("body").innerText();
  assert(!bodyAfterDelete.includes("Created smoke thread"), "deleted current chat title stayed visible after fallback");

  const browserState = await page.evaluate(() => JSON.stringify({
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
    assert(!browserState.includes(marker), `browser storage leaked ${marker}`);
  }

  if (failures.length > 0) {
    throw new Error(`GUI conversation-history smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  console.log("GUI conversation-history smoke passed.");
  console.log("Verified built GUI local runtime list/select/create/delete fallback and no browser history/token/provider-secret storage leaks.");
} finally {
  await browser?.close().catch(() => undefined);
  await guiServer?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) {
      throw new Error("built GUI index.html does not reference Vite assets");
    }
  } catch (error) {
    console.error("GUI conversation-history smoke failed: built GUI is missing or invalid.");
    console.error("Run `cd apps/gui && npm run build` before `npm run smoke:gui-conversation-history`.");
    console.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("GUI conversation-history smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
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
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/ping") {
      json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: new Date().toISOString() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/caps") {
      json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
      return;
    }
    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/v1/demo-mode") {
      json(response, 200, demoModeDisabledResponse());
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      json(response, 200, { models: [] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/providers") {
      json(response, 200, { providers: [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "No account login in local smoke." });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/chats") {
      json(response, 200, { chats: Array.from(chats.values()).map(toSummary) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chats") {
      const created = thread("chat-created", "Created smoke thread", [message("chat-created", "created-user", "user", providerSecret)]);
      chats.set(created.chatId, created);
      json(response, 200, created);
      return;
    }
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(url.pathname);
    if (chatMatch && request.method === "GET") {
      const chatId = decodeURIComponent(chatMatch[1]);
      json(response, chats.has(chatId) ? 200 : 404, chats.get(chatId) ?? { error: "chat not found" });
      return;
    }
    if (chatMatch && request.method === "DELETE") {
      const chatId = decodeURIComponent(chatMatch[1]);
      chats.delete(chatId);
      json(response, 200, { deleted: true, chatId });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
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
  return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function expectVisibleText(page, text, label, timeout = 20_000) {
  const visible = await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
  assert(visible, `Missing visible ${label}: ${text}`);
}

async function expectConversationRow(page, { title, updatedAt, messageCountLabel, positionLabel }) {
  const openButton = page.getByRole("button", { name: new RegExp(`^Open conversation: ${escapeRegExp(title)}$`) });
  await openButton.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  assert(await openButton.count() === 1, `Expected exactly one accessible open-conversation button for ${title}`);

  const row = page.locator(".conversation-item", { has: openButton }).first();
  await row.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  assert(await row.count() === 1, `Missing readable conversation row for ${title}`);

  const rowParts = await row.evaluate((element) => {
    const text = (selector) => element.querySelector(selector)?.textContent?.trim() ?? "";
    return {
      label: element.getAttribute("aria-label") ?? "",
      titleLine: text(".conversation-title-line"),
      title: text(".conversation-title"),
      metaLine: text(".conversation-meta-line"),
      updated: text(".conversation-updated"),
      messageCount: text(".conversation-message-count"),
      position: text(".conversation-position"),
    };
  }).catch(() => undefined);

  assert(rowParts?.label === `${title} conversation row`, `Conversation row aria-label is not readable for ${title}`);
  assert(rowParts?.title === title, `Conversation row title is not structured/readable for ${title}`);
  assert(rowParts?.titleLine.includes(title), `Conversation row title line is missing ${title}`);
  assert(rowParts?.updated === `Updated ${updatedAt}`, `Conversation row updated label is not structured/readable for ${title}`);
  assert(rowParts?.messageCount === messageCountLabel, `Conversation row message-count label is not structured/readable for ${title}`);
  assert(rowParts?.position === positionLabel, `Conversation row position label is not structured/readable for ${title}`);
  assert(rowParts?.metaLine.includes(`Updated ${updatedAt}`), `Conversation row meta line is missing updated text for ${title}`);
  assert(rowParts?.metaLine.includes(messageCountLabel), `Conversation row meta line is missing message count for ${title}`);
  assert(rowParts?.metaLine.includes(positionLabel), `Conversation row meta line is missing position for ${title}`);

  const deleteButton = page.getByRole("button", { name: new RegExp(`^Delete conversation: ${escapeRegExp(title)}(?: \\(current\\))?$`) });
  await deleteButton.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  assert(await deleteButton.count() === 1, `Expected one clear delete-conversation label for ${title}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function thread(chatId, title, messages) {
  return { chatId, title, createdAt: "2026-05-29T07:16:30Z", updatedAt: "2026-05-29T07:16:30Z", messages };
}

function message(chatId, id, role, content) {
  return { chatId, id, role, content, createdAt: "2026-05-29T07:16:30Z", status: "complete" };
}

function toSummary(item) {
  return { chatId: item.chatId, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, messageCount: item.messages.length };
}

function demoModeDisabledResponse() {
  return { enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality. Configure a BYOK provider for real answers." };
}

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    ...extra,
  };
}

function json(response, status, payload) {
  response.writeHead(status, corsHeaders({ "content-type": "application/json" }));
  response.end(JSON.stringify(payload));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}
