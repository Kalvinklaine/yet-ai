import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeOrigin = "http://127.0.0.1:8001";
const bridgeVersion = "2026-05-15";
const chatId = "chat-001";
const modelId = "yet-demo-chat";
const providerId = "yet-demo";
const query = "snippetSearchV2Target";
const promptWithSnippet = "Use the attached snippet search v2 result once.";
const promptAfterClear = "Confirm the snippet bundle was one-shot.";
const snippet = {
  workspaceRelativePath: "src/snippet-search-v2.ts",
  languageId: "typescript",
  range: { start: { line: 3, character: 0 }, end: { line: 5, character: 1 } },
  text: "export function snippetSearchV2Target() {\n  return 'bounded';\n}",
};
const rawMarkers = [
  "Bearer snippet-search-v2-secret",
  "sk-snippet-search-v2-secret-00000000",
  "authorization: bearer",
  "cookie: snippet-search-v2",
  "/Users/Snippet/private/project",
  "C:\\Users\\Snippet\\private\\project",
];
const failures = [];
const runtimeRequests = [];
const commandBodies = [];
let browser;
let server;

await buildGui();
await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  server = await startStaticServer(distRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.__yetAiHostMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });

  page.on("console", (message) => {
    const text = message.text();
    assertNoRawMarkers(text, "browser console");
    if (message.type() === "error" && !isExpectedFetchConsoleError(text)) {
      failures.push(`Browser console error: ${redactSecrets(text)}`);
    }
  });
  page.on("pageerror", (error) => {
    assertNoRawMarkers(error.message, "page error");
    failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`);
  });
  page.on("request", (request) => {
    if (!isAllowedNetworkUrl(request.url(), guiBaseUrl)) {
      failures.push(`Unexpected network request: ${request.method()} ${redactUrl(request.url())}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (isStaticServerAsset(request.url(), guiBaseUrl) && isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactUrl(request.url())} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    if (isStaticServerAsset(response.url(), guiBaseUrl) && response.status() >= 400) {
      failures.push(`Broken local asset response: ${response.status()} ${redactUrl(response.url())}`);
    }
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (isRuntimeOriginUrl(url)) {
      runtimeRequests.push({ method: request.method(), url: redactUrl(url), path: new URL(url).pathname });
      const response = await mockRuntimeResponse(url, request.method(), request.postData() ?? "");
      if (!response) {
        failures.push(`Unexpected runtime request: ${request.method()} ${redactUrl(url)}`);
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unexpected local mock endpoint" }) });
        return;
      }
      await route.fulfill(response);
      return;
    }
    if (isStaticServerAsset(url, guiBaseUrl)) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request blocked: ${request.method()} ${redactUrl(url)}`);
    await route.abort("blockedbyclient");
  });

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await waitForGuiMessage(page, "gui.ready");
  await expectVisibleText(page, "VS Code controlled actions", "mock VS Code bridge controls", 20_000);
  await expectVisibleText(page, "Demo Mode is ready", "mock demo readiness", 20_000);
  await page.locator(".workspace-snippet-search-card").waitFor({ state: "visible", timeout: 20_000 });

  await assertNoIdeAction(page, "searchWorkspaceSnippets", "before explicit query or click");
  await page.getByLabel("Literal snippet query", { exact: true }).fill(query);
  await page.waitForTimeout(100);
  await assertNoIdeAction(page, "searchWorkspaceSnippets", "after typing query before explicit click");
  await assertBrowserStorageDoesNotContain(page, [query, snippet.text], "after typing query");

  await page.getByRole("button", { name: "Search project snippets", exact: true }).click();
  const searchRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "searchWorkspaceSnippets");
  assert(searchRequest.version === bridgeVersion, "snippet search request used the wrong bridge version");
  assert(/^gui-workspace-snippet-search-\d+$/.test(searchRequest.requestId ?? ""), "snippet search request id was not GUI-owned");
  assert(JSON.stringify(searchRequest.payload) === JSON.stringify({ action: "searchWorkspaceSnippets", query }), "snippet search request payload was not the strict literal query payload");
  assert(!hasForbiddenPrivilegedKeys(searchRequest.payload), "snippet search request included privileged keys");
  await expectVisibleText(page, "Project snippet search pending", "snippet search pending state", 20_000);

  const requestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  await page.getByRole("button", { name: "Search project snippets", exact: true }).click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(100);
  assert(await getGuiMessageCount(page, "gui.ideActionRequest") === requestCount, "pending snippet search allowed duplicate request");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: searchRequest.requestId,
    payload: {
      status: "succeeded",
      message: "Returned one snippet search v2 result.",
      cloudRequired: false,
      action: "searchWorkspaceSnippets",
      queryLabel: query,
      resultCount: 1,
      truncated: false,
      snippets: [snippet],
    },
  });
  await expectVisibleText(page, "1 sanitized snippet", "sanitized snippet result", 20_000);
  await expectVisibleText(page, snippet.workspaceRelativePath, "snippet result path", 20_000);
  await expectAttachedText(page, snippet.text, "snippet result preview", 20_000);

  await page.locator("label.provider-item", { hasText: snippet.workspaceRelativePath }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Attach selected snippets (1)", exact: true }).click();
  await expectVisibleText(page, "Attached 1 selected project snippet", "selected snippet attached status", 20_000);
  await expectVisibleText(page, "project snippet · src/snippet-search-v2.ts", "snippet in coding task bundle summary", 20_000);
  await expectVisibleText(page, "Project snippet", "snippet in explicit bundle", 20_000);
  await assertBrowserStorageDoesNotContain(page, [query, snippet.workspaceRelativePath, snippet.text], "after snippet attach");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(promptWithSnippet);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Snippet search v2 mock response.", "first mock assistant response", 20_000);
  assert(commandBodies.length === 1, `expected one command after first send, received ${commandBodies.length}`);
  assertSnippetCommand(commandBodies[0]);
  await expectVisibleText(page, "One-shot explicit context bundle attached to the last accepted message and cleared.", "bundle cleared after accepted send", 20_000);
  await expectVisibleText(page, "empty", "explicit bundle empty after send", 20_000);

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(promptAfterClear);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Snippet search v2 mock response.", "second mock assistant response", 20_000);
  assert(commandBodies.length === 2, `expected two commands after second send, received ${commandBodies.length}`);
  assert(commandBodies[1]?.payload?.content === promptAfterClear, "second command content did not match prompt");
  assert(commandBodies[1]?.payload?.context === undefined, "snippet context was reused after one-shot clear");

  await assertNoForbiddenBridgeActions(page);
  assertNoForbiddenRuntimeRequests();
  const state = await collectBrowserState(page);
  assertNoRawMarkers(JSON.stringify(state), "DOM, browser storage, bridge messages, or host messages");
  await assertBrowserStorageDoesNotContain(page, [query, snippet.workspaceRelativePath, snippet.text, promptWithSnippet, promptAfterClear], "final browser state");

  if (failures.length > 0) {
    throw new Error(`Snippet search v2 smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Snippet search v2 smoke passed.");
  console.log("Verified explicit mock-host literal snippet search, bounded result select/attach, one-shot context send and clear, no auto-search, no browser-storage persistence, loopback-only networking, and no shell/git/tool endpoints.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) await server.close().catch(() => undefined);
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:snippet-search-v2`."]);
  }
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) failures.push("Built GUI index.html does not reference Vite assets.");
  } catch {
    failActionable("built GUI is missing after build.", [`Expected file: ${path.relative(root, indexPath)}`]);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    failActionable("Playwright is not installed or cannot be loaded.", [
      "Run `npm install` from the repository root.",
      "Run `npx playwright install chromium` if Chromium is not installed yet.",
      `Load error: ${messageOf(error)}`,
    ]);
  }
}

async function mockRuntimeResponse(value, method, body) {
  const url = new URL(value);
  if (method === "GET" && url.pathname === "/v1/ping") return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-06-18T12:00:00Z" });
  if (method === "GET" && url.pathname === "/v1/caps") return json({ productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: ["chat"], features: {}, providers: [providerSummary()], ide: { bridge: true, lsp: false, host: "vscode" } });
  if (method === "GET" && url.pathname === "/v1/models") return json({ models: [demoModel()] });
  if (method === "GET" && url.pathname === "/v1/demo-mode") return json({ enabled: true, providerId, modelId, displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Snippet search v2 smoke uses local canned responses only." });
  if (method === "GET" && url.pathname === "/v1/providers") return json({ providers: [providerSummary()], cloudRequired: false, providerAccess: "direct" });
  if (method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Mock-only snippet search v2 smoke." });
  if (method === "GET" && url.pathname === "/v1/chats") return json({ chats: [] });
  if (method === "GET" && url.pathname === `/v1/chats/${chatId}`) return json(chatThread([]));
  if (method === "GET" && url.pathname === "/v1/project-memory") return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
  if (method === "POST" && url.pathname === `/v1/chats/${chatId}/commands`) {
    const parsed = JSON.parse(body);
    if (parsed.type !== "abort") commandBodies.push(parsed);
    return json({ accepted: true, chatId, requestId: parsed.requestId, type: parsed.type });
  }
  if (method === "GET" && url.pathname === "/v1/chats/subscribe" && url.searchParams.get("chat_id") === chatId) {
    return sse([
      { seq: 0, type: "snapshot", chatId, payload: { messages: [] } },
      { seq: 1, type: "message_added", chatId, payload: { message: assistantMessage() } },
      { seq: 2, type: "stream_finished", chatId, payload: {} },
    ]);
  }
  if (method === "POST" && url.pathname === "/v1/chats") return json(chatThread([]));
  if (method === "GET" && url.pathname === "/v1/agent-progress") return json({ cloudRequired: false, providerAccess: "direct", generatedAt: "2026-06-18T12:00:00Z", snapshots: [] });
  return undefined;
}

function demoModel() {
  return { id: modelId, displayName: "Yet AI Demo Chat", providerId, capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

function providerSummary() {
  return { id: providerId, kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } };
}

function chatThread(messages) {
  return { chatId, title: "Snippet search v2 smoke", createdAt: "2026-06-18T12:00:00Z", updatedAt: "2026-06-18T12:00:00Z", messages };
}

function assistantMessage() {
  return { id: `assistant-snippet-search-v2-${commandBodies.length}`, chatId, role: "assistant", status: "complete", createdAt: "2026-06-18T12:00:01Z", content: "Snippet search v2 mock response." };
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function sse(events) {
  return { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") };
}

async function waitForGuiMessage(page, type) {
  await page.waitForFunction((messageType) => window.__yetAiVsCodeMessages?.some((message) => message?.type === messageType), type, { timeout: 10_000 });
  return await page.evaluate((messageType) => window.__yetAiVsCodeMessages.find((message) => message?.type === messageType), type);
}

async function waitForBridgeMessage(page, predicate) {
  await page.waitForFunction((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiVsCodeMessages?.some((message) => matcher(message));
  }, predicate.toString(), { timeout: 10_000 });
  return await page.evaluate((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiVsCodeMessages.find((message) => matcher(message));
  }, predicate.toString());
}

async function getGuiMessageCount(page, type) {
  return await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
    window.__yetAiHostMessages.push({ type: hostMessage?.type, requestId: hostMessage?.requestId });
    window.dispatchEvent(new MessageEvent("message", { data: hostMessage }));
  }, message);
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 5000)}`);
  }
}

async function expectAttachedText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 5000)}`);
  }
}

async function assertNoIdeAction(page, action, label) {
  const count = await page.evaluate((actionName) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === actionName).length, action);
  assert(count === 0, `unexpected ${action} ${label}`);
}

async function assertNoForbiddenBridgeActions(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const ideActions = messages.filter((message) => message?.type === "gui.ideActionRequest").map((message) => message.payload?.action);
  const allowed = new Set(["searchWorkspaceSnippets"]);
  const forbiddenIdeActions = ideActions.filter((action) => !allowed.has(action));
  assert(forbiddenIdeActions.length === 0, `unexpected IDE action request(s): ${forbiddenIdeActions.join(",")}`);
  assert(messages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length === 0, "unexpected workspace edit request");
}

async function collectBrowserState(page) {
  return await page.evaluate(() => ({
    body: document.body.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
    vscodeMessages: window.__yetAiVsCodeMessages,
    hostMessages: window.__yetAiHostMessages,
  }));
}

async function assertBrowserStorageDoesNotContain(page, markers, description) {
  const storageText = JSON.stringify(await page.evaluate(() => ({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
  })));
  for (const marker of markers) {
    if (marker && storageText.includes(marker)) failures.push(`Browser storage contained ${redactSecrets(marker)} during ${description}.`);
  }
}

function assertSnippetCommand(command) {
  assert(command?.payload?.content === promptWithSnippet, "snippet command content did not match prompt");
  const context = command?.payload?.context;
  assert(context?.kind === "explicit_context_bundle", "snippet command context was not explicit_context_bundle");
  assert(Array.isArray(context.items) && context.items.length === 1, "snippet command did not include exactly one bundle item");
  const item = context.items[0];
  assert(item.kind === "workspace_snippet", "bundle item was not a workspace_snippet");
  assert(item.workspaceRelativePath === snippet.workspaceRelativePath, "bundle item path was wrong");
  assert(item.languageId === snippet.languageId, "bundle item language was wrong");
  assert(JSON.stringify(item.range) === JSON.stringify(snippet.range), "bundle item range was wrong");
  assert(item.text === snippet.text, "bundle item text was wrong");
}

async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
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
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { port: address.port, close: () => closeServer(server) };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function isAllowedNetworkUrl(value, guiBaseUrl) {
  return isStaticServerAsset(value, guiBaseUrl) || isRuntimeOriginUrl(value);
}

function isRuntimeOriginUrl(value) {
  try {
    return new URL(value).origin === runtimeOrigin;
  } catch {
    return false;
  }
}

function isStaticServerAsset(url, guiBaseUrl) {
  return url.startsWith(`${guiBaseUrl}/`);
}

function isJsOrCssAssetRequest(url, resourceType) {
  return resourceType === "script" || resourceType === "stylesheet" || new URL(url).pathname.endsWith(".js") || new URL(url).pathname.endsWith(".css");
}

function isExpectedFetchConsoleError(text) {
  return /^Failed to load resource: (net::ERR_CONNECTION_REFUSED|the server responded with a status of (401 \(Unauthorized\)|404 \(Not Found\)))$/.test(text);
}

function assertNoForbiddenRuntimeRequests() {
  const forbidden = runtimeRequests.filter((request) => /git|shell|tool|exec|command-runner/i.test(request.url) || /^\/v1\/provider-auth\//.test(request.path) && request.method !== "GET");
  assert(forbidden.length === 0, `runtime shell/git/tool-like endpoint was requested: ${forbidden.map((request) => `${request.method} ${request.path}`).join(", ")}`);
}

function hasForbiddenPrivilegedKeys(value) {
  const forbidden = new Set(["shell", "command", "edit", "edits", "tool", "tools", "git", "task", "tasks", "applyWorkspaceEdit", "execute", "executeCommand", "glob", "regex", "path"]);
  const visit = (current) => {
    if (!current || typeof current !== "object") return false;
    if (Array.isArray(current)) return current.some(visit);
    return Object.entries(current).some(([key, nested]) => forbidden.has(key) || visit(nested));
  };
  return visit(value);
}

function assertNoRawMarkers(value, source) {
  const text = String(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    if (marker && text.includes(marker.toLowerCase())) {
      throw new Error(`Raw marker ${index + 1} leaked through ${source}.`);
    }
  }
}

function redactSecrets(value) {
  let redacted = String(value);
  for (const marker of rawMarkers) redacted = redacted.split(marker).join("[redacted]");
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/authorization:\s*bearer[^\n]*/gi, "authorization: bearer [redacted]")
    .replace(/cookie:\s*[^\n]+/gi, "cookie: [redacted]")
    .replace(/\/Users\/[^\n]+/g, "/Users/[redacted]")
    .replace(/[A-Za-z]:\\[^\n]+/g, "C:\\[redacted]");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactSecrets(value);
  }
}

function failActionable(summary, lines) {
  console.error(`Snippet search v2 smoke failed: ${summary}`);
  for (const line of lines) if (line) console.error(redactSecrets(line));
  process.exit(1);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
