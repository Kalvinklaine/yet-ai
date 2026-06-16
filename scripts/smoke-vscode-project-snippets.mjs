import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertPackagedGuiFreshness } from "./gui-asset-freshness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiDistRoot = path.join(root, "apps", "gui", "dist");
const packagedGuiRoot = path.join(root, "apps", "plugins", "vscode", "media", "gui");
const packagedGuiIndex = path.join(packagedGuiRoot, "index.html");
const bridgeVersion = "2026-05-15";
const headed = process.argv.includes("--headed");
const runtimeToken = `vscode-project-snippets-${randomUUID()}`;
const query = "snippetQuerySmoke";
const prompt = "Use the attached project snippets to explain the smoke target.";
const rejectedSecret = `sk-snippet-${randomUUID().replaceAll("-", "")}`;
const snippets = [
  {
    workspaceRelativePath: "src/snippet-one.ts",
    languageId: "typescript",
    range: { start: { line: 4, character: 0 }, end: { line: 6, character: 1 } },
    text: "export function snippetQuerySmokeOne() {\n  return 'one';\n}",
  },
  {
    workspaceRelativePath: "src/snippet-two.ts",
    languageId: "typescript",
    range: { start: { line: 8, character: 2 }, end: { line: 10, character: 3 } },
    text: "if (snippetQuerySmokeTwo) {\n  renderSnippetSmoke();\n}",
  },
];
const staleSnippetText = "staleSnippetShouldNotRender";
const duplicateSnippetText = "duplicateSnippetShouldNotRender";
const runtimeRequestLog = [];
const chatCommandBodies = [];
const failures = [];
const consoleMessages = [];
let observedRuntimeAuthorization = false;
const mockChatMessages = [];
const mockChatSubscribers = new Set();

await requirePackagedGui();
const { chromium } = await requireChromium();
const guiServer = await startStaticServer(packagedGuiRoot);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeServer = await startMockRuntimeServer();
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
let browser;

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

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
  const guiReady = await waitForGuiMessage(page, "gui.ready");
  if (guiReady?.version !== bridgeVersion || guiReady?.payload?.supportedBridgeVersion !== bridgeVersion) {
    failures.push("VS Code-like bridge did not collect strict gui.ready.");
  }

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ready",
    requestId: guiReady?.requestId,
    payload: { runtimeUrl: runtimeBaseUrl, sessionToken: runtimeToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await expectAttachedText(page, "Host runtime settings received", "host.ready bridge log");
  await expectAttachedText(page, "bridge vscode", "VS Code bridge badge");
  await expectAttachedText(page, "Runtime connected", "runtime connected state");
  await expectVisibleText(page, "Demo Mode is ready", "demo mode send readiness");
  await page.locator(".workspace-snippet-search-card").waitFor({ state: "visible", timeout: 10_000 });
  await assertBrowserStorageDoesNotContain(page, [query, snippets[0].text, snippets[1].text, runtimeToken, rejectedSecret], "initial storage cleanliness");

  const queryInput = page.getByLabel("Literal snippet query", { exact: true });
  await queryInput.fill(query);
  await page.waitForTimeout(100);
  const preClickIdeRequestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  if (preClickIdeRequestCount !== 0) failures.push("Typing a project snippet query posted gui.ideActionRequest before explicit click.");
  await assertBrowserStorageDoesNotContain(page, [query], "typed query storage cleanliness");

  const searchButton = page.getByRole("button", { name: "Search project snippets", exact: true });
  await searchButton.click();
  const searchRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", preClickIdeRequestCount);
  if (!searchRequest) {
    failures.push("Clicking Search project snippets did not send gui.ideActionRequest.");
  } else {
    if (searchRequest.version !== bridgeVersion) failures.push("Project snippet request used the wrong bridge version.");
    if (typeof searchRequest.requestId !== "string" || !/^gui-workspace-snippet-search-\d+$/.test(searchRequest.requestId)) {
      failures.push("Project snippet request id was not GUI-owned with the expected prefix.");
    }
    if (!deepEqual(searchRequest.payload, { action: "searchWorkspaceSnippets", query })) failures.push("Project snippet request payload was not the strict searchWorkspaceSnippets query payload.");
    if (hasForbiddenPrivilegedKeys(searchRequest.payload)) failures.push("Project snippet request payload contained privileged fields.");
  }

  const requestId = searchRequest?.requestId ?? "gui-workspace-snippet-search-missing";
  await expectVisibleText(page, "Project snippet search pending…", "project snippet pending state");
  const duplicateClickCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  await searchButton.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(100);
  const duplicatePostClickCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  if (duplicatePostClickCount !== duplicateClickCount) failures.push("Pending project snippet search allowed a duplicate gui.ideActionRequest.");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: `${requestId}-stale`,
    payload: snippetResultPayload({ message: "Stale snippets ready.", resultSnippets: [{ ...snippets[0], text: staleSnippetText }] }),
  });
  await page.waitForTimeout(150);
  await expectNoVisibleText(page, staleSnippetText, "stale project snippet result");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId,
    payload: snippetResultPayload({ message: "Unsafe snippets ready.", resultSnippets: [{ ...snippets[0], text: `const bad = \"${rejectedSecret}\";` }] }),
  });
  await page.waitForTimeout(150);
  await expectNoVisibleText(page, rejectedSecret, "unsafe project snippet host result");
  await expectVisibleText(page, "Search project snippets: pending", "project snippet remains pending after unsafe result");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionProgress",
    requestId,
    payload: { phase: "running", status: "inProgress", summary: "Searching local workspace snippets.", cloudRequired: false, action: "searchWorkspaceSnippets", queryLabel: query, resultCount: 0 },
  });
  await expectVisibleText(page, "Search project snippets: inProgress", "project snippet progress state");
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId,
    payload: snippetResultPayload({ message: "Project snippets ready.", resultSnippets: snippets }),
  });
  await expectVisibleText(page, "Search project snippets: succeeded", "project snippet succeeded state");
  await expectVisibleText(page, "2 sanitized snippets returned", "sanitized result status");
  await expectVisibleText(page, snippets[0].workspaceRelativePath, "first snippet path");
  await expectVisibleText(page, snippets[1].workspaceRelativePath, "second snippet path");
  await expectAttachedText(page, snippets[0].text, "first snippet preview");
  await expectAttachedText(page, snippets[1].text, "second snippet preview");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId,
    payload: snippetResultPayload({ message: "Duplicate snippets should be ignored.", resultSnippets: [{ ...snippets[0], text: duplicateSnippetText }] }),
  });
  await page.waitForTimeout(150);
  await expectNoVisibleText(page, duplicateSnippetText, "duplicate project snippet result");

  await page.locator("label.provider-item", { hasText: snippets[0].workspaceRelativePath }).getByRole("checkbox").check();
  await page.locator("label.provider-item", { hasText: snippets[1].workspaceRelativePath }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Attach selected snippets (2)", exact: true }).click();
  await expectVisibleText(page, "Attached 2 selected project snippets", "selected snippets attached status");
  await expectVisibleText(page, "2/4 excerpts", "explicit context bundle count after snippets");
  await expectAttachedText(page, "Project snippet", "workspace snippet bundle item label");
  await assertBrowserStorageDoesNotContain(page, [query, snippets[0].workspaceRelativePath, snippets[0].text, snippets[1].workspaceRelativePath, snippets[1].text, runtimeToken, rejectedSecret], "selected snippet storage cleanliness");

  const chatCommandCountBeforeSend = countChatCommandPosts();
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await clickSendButton(page);
  await expectVisibleText(page, prompt, "snippet prompt user bubble");
  await expectVisibleText(page, "Project snippet smoke canned response.", "snippet canned assistant bubble");
  const chatPosts = countChatCommandPosts() - chatCommandCountBeforeSend;
  if (chatPosts !== 1) failures.push(`Project snippet send posted ${chatPosts} chat commands instead of exactly one.`);
  assertProjectSnippetChatCommand(chatCommandBodies.at(-1));
  await expectVisibleText(page, "One-shot explicit context bundle attached to the last accepted message and cleared.", "one-shot bundle clear status");
  await expectVisibleText(page, "empty", "bundle empty after project snippet send");
  await assertBrowserStorageDoesNotContain(page, [query, snippets[0].workspaceRelativePath, snippets[0].text, snippets[1].workspaceRelativePath, snippets[1].text, runtimeToken, rejectedSecret], "final storage cleanliness");

  if (!observedRuntimeAuthorization) failures.push("Mock runtime did not observe Authorization from host.ready session token.");
  assertNoForbiddenRuntimeRequests();
  const visibleState = await collectVisibleState(page);
  assertNoSecretLeak(visibleState, "DOM, browser storage, GUI messages, host message metadata, or console");

  if (failures.length > 0) reportFailures();
  console.log("VS Code project snippets smoke passed.");
  console.log("Verified explicit project snippet search click, strict GUI-owned request, pending duplicate suppression, stale/unsafe/duplicate result rejection, two-snippet selection, one-shot context bundle send, browser storage cleanliness, loopback-only networking, and mock-only runtime behavior.");
  console.log("No real shell, provider, hosted Yet AI service, VS Code launch, workspace index, or IDE API was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close();
  await guiServer.close();
}

async function requirePackagedGui() {
  try {
    await assertPackagedGuiFreshness({ sourceRoot: guiDistRoot, packagedRoot: packagedGuiRoot, label: "VS Code packaged GUI assets" });
  } catch (error) {
    console.error("VS Code project snippets smoke failed: packaged VS Code GUI assets are missing or stale.");
    console.error("Run `npm run prepare:vscode-preview` from the repository root before running this smoke.");
    console.error(`Expected packaged file: ${path.relative(root, packagedGuiIndex)}`);
    console.error(`Reason: ${messageOf(error)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code project snippets smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
    console.error(`Load error: ${messageOf(error)}`);
    process.exit(1);
  }
}

function snippetResultPayload({ message, resultSnippets }) {
  return {
    status: "succeeded",
    message,
    cloudRequired: false,
    action: "searchWorkspaceSnippets",
    queryLabel: query,
    resultCount: resultSnippets.length,
    snippets: resultSnippets,
    truncated: false,
  };
}

function assertProjectSnippetChatCommand(command) {
  if (command?.payload?.content !== prompt) failures.push("Project snippet chat command content did not match the prompt.");
  const context = command?.payload?.context;
  if (!context || typeof context !== "object") {
    failures.push("Project snippet chat command did not include prompt context.");
    return;
  }
  if (context.kind !== "explicit_context_bundle") failures.push("Project snippet chat command context kind was not explicit_context_bundle.");
  if (!Array.isArray(context.items) || context.items.length !== 2) {
    failures.push("Project snippet chat command did not include exactly two bundle items.");
    return;
  }
  for (const [index, expected] of snippets.entries()) {
    const item = context.items[index];
    if (item?.kind !== "workspace_snippet") failures.push(`Bundle item ${index + 1} was not a workspace_snippet.`);
    if (item?.workspaceRelativePath !== expected.workspaceRelativePath) failures.push(`Bundle item ${index + 1} path was wrong.`);
    if (item?.languageId !== expected.languageId) failures.push(`Bundle item ${index + 1} language was wrong.`);
    if (!deepEqual(item?.range, expected.range)) failures.push(`Bundle item ${index + 1} range was wrong.`);
    if (item?.text !== expected.text) failures.push(`Bundle item ${index + 1} text was wrong.`);
  }
}

async function startMockRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders()).end();
      return;
    }
    runtimeRequestLog.push({ method: request.method ?? "GET", pathname: requestUrl.pathname });
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
      json(response, 200, { productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: ["chat"], features: {}, providers: [], ide: { bridge: true, lsp: false, host: "vscode-project-snippets-smoke" } });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, demoModeResponse());
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: [demoModel()] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Mock-only project snippets smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats") {
      json(response, 200, { chats: [mockChatSummary()] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/chat-001") {
      json(response, 200, mockChatThread());
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/subscribe") {
      const chat = mockChatThread();
      response.writeHead(200, { ...corsHeaders(), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      response.write(`event: snapshot\ndata: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: chat.chatId, payload: { thread: chat, messages: chat.messages, runtime: { streaming: false, waitingForResponse: false } } })}\n\n`);
      mockChatSubscribers.add(response);
      response.on("close", () => mockChatSubscribers.delete(response));
      return;
    }
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(requestUrl.pathname);
    if (request.method === "POST" && commandMatch) {
      const chatId = decodeURIComponent(commandMatch[1]);
      const body = JSON.parse(await readBody(request));
      chatCommandBodies.push(body);
      const createdAt = new Date(0).toISOString();
      const userMessage = { id: `user-project-snippets-${mockChatMessages.length}`, chatId, role: "user", content: body.payload?.content ?? "", createdAt, status: "complete" };
      const assistantMessage = { id: `assistant-project-snippets-${mockChatMessages.length}`, chatId, role: "assistant", content: "Project snippet smoke canned response.", createdAt, status: "complete" };
      mockChatMessages.push(userMessage, assistantMessage);
      pushMockChatEvent({ seq: mockChatMessages.length - 1, type: "message_added", chatId, payload: { message: userMessage } });
      pushMockChatEvent({ seq: mockChatMessages.length, type: "message_added", chatId, payload: { message: assistantMessage } });
      json(response, 200, { accepted: true, chatId, requestId: body.requestId ?? "project-snippets-smoke", type: body.type });
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

function demoModeResponse() {
  return { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "VS Code project snippets smoke uses local canned responses only." };
}

function demoModel() {
  return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

function demoProvider() {
  return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } };
}

function mockChatSummary() {
  return { chatId: "chat-001", title: "VS Code project snippets smoke", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), messageCount: mockChatMessages.length };
}

function mockChatThread() {
  return { chatId: "chat-001", title: "VS Code project snippets smoke", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), messages: mockChatMessages };
}

function pushMockChatEvent(event) {
  for (const subscriber of mockChatSubscribers) {
    subscriber.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8") || "{}";
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

async function waitForGuiMessage(page, type) {
  await page.waitForFunction((messageType) => window.__yetAiVsCodeMessages?.some((message) => message?.type === messageType), type, { timeout: 10_000 });
  return await page.evaluate((messageType) => window.__yetAiVsCodeMessages.find((message) => message?.type === messageType), type);
}

async function waitForGuiMessageAfter(page, type, previousCount) {
  await page.waitForFunction(({ messageType, count }) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length > count, { messageType: type, count: previousCount }, { timeout: 10_000 });
  return await page.evaluate(({ messageType, count }) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).at(count), { messageType: type, count: previousCount });
}

async function getGuiMessageCount(page, type) {
  return await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
    window.__yetAiHostMessages.push(hostMessage);
    window.dispatchEvent(new MessageEvent("message", { data: hostMessage }));
  }, message);
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

async function expectNoVisibleText(page, text, description) {
  const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  if (visible) failures.push(`${description} rendered unexpectedly.`);
}

async function assertBrowserStorageDoesNotContain(page, markers, description) {
  const storageState = JSON.stringify(await page.evaluate(() => ({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
  })));
  for (const marker of markers) {
    if (marker && storageState.includes(marker)) failures.push(`Browser storage contained ${redactSecrets(marker)} during ${description}.`);
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
  }))) + JSON.stringify(consoleMessages);
}

async function clickSendButton(page) {
  const sendButton = page.getByRole("button", { name: "Send", exact: true }).last();
  await sendButton.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  if (await sendButton.isDisabled()) failures.push("Send button was disabled before project snippet prompt send.");
  await sendButton.click({ timeout: 5000 });
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

function countRuntimeRequests(method, pathname) {
  return runtimeRequestLog.filter((entry) => entry.method === method && entry.pathname === pathname).length;
}

function countChatCommandPosts() {
  return runtimeRequestLog.filter((entry) => entry.method === "POST" && /^\/v1\/chats\/[^/]+\/commands$/.test(entry.pathname)).length;
}

function assertNoForbiddenRuntimeRequests() {
  const forbidden = runtimeRequestLog.filter((entry) => /^\/v1\/provider-auth\//.test(entry.pathname) && entry.method !== "GET");
  if (forbidden.length > 0) failures.push(`Unexpected provider/auth mutation request(s): ${forbidden.map((entry) => `${entry.method} ${entry.pathname}`).join(", ")}.`);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasForbiddenPrivilegedKeys(value) {
  const forbidden = new Set(["shell", "command", "edit", "edits", "tool", "tools", "git", "task", "tasks", "applyWorkspaceEdit", "execute", "executeCommand"]);
  const visit = (current) => {
    if (!current || typeof current !== "object") return false;
    if (Array.isArray(current)) return current.some(visit);
    return Object.entries(current).some(([key, nested]) => forbidden.has(key) || visit(nested));
  };
  return visit(value);
}

function containsSecret(text) {
  const lower = String(text).toLowerCase();
  return [runtimeToken, rejectedSecret, `Bearer ${runtimeToken}`].some((marker) => lower.includes(marker.toLowerCase()));
}

function assertNoSecretLeak(text, source) {
  if (containsSecret(text)) throw new Error(`Secret marker leaked through ${source}.`);
}

function redactSecrets(text) {
  let redacted = String(text);
  for (const marker of [runtimeToken, rejectedSecret]) redacted = redacted.split(marker).join("[redacted]");
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
  console.error("VS Code project snippets smoke failed:");
  for (const failure of failures) console.error(`- ${redactSecrets(failure)}`);
  process.exit(1);
}
