import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const bridgeVersion = "2026-05-15";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeOrigin = "http://127.0.0.1:8001";
const chatId = "chat-001";
const providerId = "patch-quality-mock-provider";
const modelId = "patch-quality-mock-model";
const secretMarkers = [
  "Bearer patch-quality-secret",
  "sk-patch-quality-secret-00000000",
  "access_token=patchqualitysecret",
  "/Users/Patch/private/secret.ts",
  "C:\\Users\\Patch\\private\\secret.ts",
];
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let commandCount = 0;
let abortCount = 0;

const proposalPayload = {
  requiresUserConfirmation: true,
  summary: "Replace one reviewed line in the patch quality smoke fixture.",
  cloudRequired: false,
  edits: [{
    workspaceRelativePath: "src/quality.ts",
    textReplacements: [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 29 } },
      replacementText: "export const quality = 'better';",
    }],
  }],
};
const assistantProposal = [
  "```json",
  JSON.stringify({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposalPayload }, null, 2),
  "```",
].join("\n");

await buildGui();
await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  server = await startStaticServer(distRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });

  await runBrowserPreviewCase(guiBaseUrl);
  await runHostedApplyCase(guiBaseUrl);

  if (failures.length > 0) {
    throw new Error(`Patch proposal quality smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Patch proposal quality smoke passed.");
  console.log("Verified built-GUI mock-only safe edit proposal review: exactly one fenced JSON proposal extracted, quality panel and risk/status copy rendered, browser stays preview-only with no capable host, VS Code mock host emits no apply request before explicit click, applies/rejects only after clicks, and no non-loopback network, shell/git/tool endpoints, browser-storage proposal/secret persistence, hosted service, real provider, or credential use occurred.");
} catch (error) {
  console.error(redactSecrets(error instanceof Error && error.stack ? error.stack : messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) await server.close().catch(() => undefined);
}

async function runBrowserPreviewCase(guiBaseUrl) {
  const page = await newInstrumentedPage(guiBaseUrl, { hosted: false });
  try {
    await loadAndSendSafeEditRequest(page, guiBaseUrl, "Preview a safe edit proposal for the patch quality smoke.");
    await expectVisibleText(page, "Propose safe edit", "browser edit proposal card");
    await expectVisibleText(page, "Quality summary", "quality summary");
    await expectVisibleText(page, "1 files · 1 replacements · total chars 32 · max chars 32 · preview none · status browser preview only", "browser quality status");
    await expectVisibleText(page, "browser preview only", "browser preview risk badge");
    await expectVisibleText(page, "Preview only in this host. Browser cannot apply proposed edits", "browser preview-only guard");
    await assertProposalCount(page, 1, "browser preview");
    await assertNoBridgeMessagesOfType(page, "gui.applyWorkspaceEditRequest", "browser preview");
    await assertNoForbiddenBridgeActions(page);
    await assertStorageClean(page, "browser preview");
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function runHostedApplyCase(guiBaseUrl) {
  const page = await newInstrumentedPage(guiBaseUrl, { hosted: true });
  try {
    await loadAndSendSafeEditRequest(page, guiBaseUrl, "Return a safe edit proposal for explicit hosted apply review.");
    await expectVisibleText(page, "Propose safe edit", "hosted edit proposal card");
    await expectVisibleText(page, "Quality summary", "hosted quality summary");
    await expectVisibleText(page, "1 files · 1 replacements · total chars 32 · max chars 32 · preview none · status ready for manual apply request", "hosted quality status");
    await expectVisibleText(page, "IDE confirmation required", "hosted IDE confirmation badge");
    await expectVisibleText(page, "Apply in VS Code after review", "hosted explicit apply button");
    await assertProposalCount(page, 1, "hosted preview");
    await assertNoBridgeMessagesOfType(page, "gui.applyWorkspaceEditRequest", "before explicit apply click");
    await assertNoForbiddenBridgeActions(page);

    await page.getByRole("button", { name: "Apply in VS Code after review" }).click();
    const appliedRequest = await waitForApplyRequest(page, 1);
    assertApplyRequestShape(appliedRequest, "applied request");
    await expectVisibleText(page, "VS Code apply request pending…", "pending apply status");
    await dispatchHostApplyResult(page, appliedRequest.requestId, "applied", "Applied by deterministic patch quality host.", 1, ["src/quality.ts"]);
    await expectVisibleText(page, "Host apply result: applied", "applied host result");
    await expectVisibleText(page, "Applied by deterministic patch quality host.", "applied host message");

    await loadAndSendSafeEditRequest(page, guiBaseUrl, "Return a second safe edit proposal for explicit rejection review.");
    await page.getByRole("button", { name: "Apply in VS Code after review" }).click();
    const rejectedRequest = await waitForApplyRequest(page, 1);
    assertApplyRequestShape(rejectedRequest, "rejected request");
    await dispatchHostApplyResult(page, rejectedRequest.requestId, "rejected", "Rejected by deterministic patch quality host.", 0, []);
    await expectVisibleText(page, "Host apply result: rejected", "rejected host result");
    await expectVisibleText(page, "Rejected by deterministic patch quality host.", "rejected host message");

    await assertNoForbiddenBridgeActions(page);
    await assertStorageClean(page, "hosted apply");
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function newInstrumentedPage(guiBaseUrl, { hosted }) {
  const page = await browser.newPage();
  if (hosted) {
    await page.addInitScript(() => {
      window.__yetAiVsCodeMessages = [];
      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          window.__yetAiVsCodeMessages.push(message);
        },
      });
    });
  } else {
    await page.addInitScript(() => {
      window.__yetAiVsCodeMessages = [];
    });
  }
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
      runtimeRequests.push({ method: request.method(), url: redactUrl(url) });
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
  return page;
}

async function loadAndSendSafeEditRequest(page, guiBaseUrl, prompt) {
  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  if (await hasVsCodeBridge(page)) {
    await waitForBridgeMessage(page, (message) => message?.type === "gui.ready");
  }
  await expectVisibleText(page, "Ready to send using patch-quality-mock-model through the local runtime.", "mock model readiness", 20_000);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Replace one reviewed line in the patch quality smoke fixture.", "assistant proposal summary", 20_000);
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:patch-proposal-quality`."]);
  }
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) {
      failures.push("Built GUI index.html does not reference Vite assets.");
    }
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
  if (/git|shell|tool|exec|command-runner/i.test(url.pathname)) {
    failures.push(`Runtime shell/git/tool-like endpoint was requested: ${method} ${redactUrl(value)}`);
    return json({ error: "forbidden" }, 403);
  }
  if (method === "GET" && url.pathname === "/v1/ping") {
    return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-06-18T12:00:00Z" });
  }
  if (method === "GET" && url.pathname === "/v1/caps") {
    return json({ productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [providerSummary()], ide: { bridge: true, lsp: false, host: "vscode" } });
  }
  if (method === "GET" && url.pathname === "/v1/models") {
    return json({ models: [modelSummary()] });
  }
  if (method === "GET" && url.pathname === "/v1/demo-mode") {
    return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode disabled for patch quality smoke." });
  }
  if (method === "GET" && url.pathname === "/v1/providers") {
    return json({ providers: [providerSummary()], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "GET" && url.pathname === "/v1/provider-auth/openai/status") {
    return json({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Provider auth is unavailable in this local mock." });
  }
  if (method === "GET" && url.pathname === "/v1/chats") {
    return json({ chats: [] });
  }
  if (method === "GET" && url.pathname === `/v1/chats/${chatId}`) {
    return json(chatThread([]));
  }
  if (method === "GET" && url.pathname === "/v1/project-memory") {
    return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "GET" && url.pathname === "/v1/agent-progress") {
    return json({ cloudRequired: false, providerAccess: "direct", generatedAt: "2026-06-18T12:00:00Z", snapshots: [] });
  }
  if (method === "POST" && url.pathname === "/v1/chats") {
    return json(chatThread([]));
  }
  if (method === "POST" && url.pathname === `/v1/chats/${chatId}/commands`) {
    const parsed = JSON.parse(body);
    if (parsed.type === "abort") abortCount += 1;
    else commandCount += 1;
    return json({ accepted: true, chatId, requestId: parsed.requestId, type: parsed.type });
  }
  if (method === "GET" && url.pathname === "/v1/chats/subscribe" && url.searchParams.get("chat_id") === chatId) {
    return sse([
      { seq: 0, type: "snapshot", chatId, payload: { messages: [] } },
      { seq: 1, type: "message_added", chatId, payload: { message: assistantMessage(`patch-quality-assistant-${commandCount + 1}`) } },
      { seq: 2, type: "stream_finished", chatId, payload: {} },
    ]);
  }
  return undefined;
}

function providerSummary() {
  return {
    id: providerId,
    kind: "openai-compatible",
    displayName: "Patch Quality Mock Provider",
    enabled: true,
    baseUrl: "http://127.0.0.1:43210/v1",
    auth: { type: "none", configured: false },
    models: [modelSummary()],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function modelSummary() {
  return { id: modelId, displayName: modelId, providerId, capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

function chatThread(messages) {
  return { chatId, title: "Patch proposal quality smoke", createdAt: "2026-06-18T12:00:00Z", updatedAt: "2026-06-18T12:00:00Z", messages };
}

function assistantMessage(id) {
  return { id, chatId, role: "assistant", status: "complete", createdAt: "2026-06-18T12:00:01Z", content: assistantProposal };
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function sse(events) {
  return { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") };
}

async function startStaticServer(staticRoot) {
  const staticServer = http.createServer(async (request, response) => {
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
  await listen(staticServer, "127.0.0.1", 0);
  const address = staticServer.address();
  return { port: address.port, close: () => closeServer(staticServer) };
}

function listen(targetServer, host, port) {
  return new Promise((resolve, reject) => {
    targetServer.once("error", reject);
    targetServer.listen(port, host, () => {
      targetServer.off("error", reject);
      resolve();
    });
  });
}

function closeServer(targetServer) {
  return new Promise((resolve, reject) => targetServer.close((error) => (error ? reject(error) : resolve())));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 5000)}`);
  }
}

async function assertProposalCount(page, expected, label) {
  const count = await page.locator("[data-testid='edit-proposal-quality-summary']").count();
  if (count !== expected) {
    failures.push(`Expected ${expected} extracted edit proposal quality panel(s) in ${label}, found ${count}.`);
  }
}

async function hasVsCodeBridge(page) {
  return page.evaluate(() => typeof window.acquireVsCodeApi === "function");
}

async function waitForBridgeMessage(page, predicate) {
  await page.waitForFunction((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiVsCodeMessages?.some((message) => matcher(message));
  }, predicate.toString(), { timeout: 10_000 });
  return page.evaluate((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiVsCodeMessages.find((message) => matcher(message));
  }, predicate.toString());
}

async function waitForApplyRequest(page, count) {
  try {
    await page.waitForFunction((expected) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length >= expected, count, { timeout: 10_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({ body: document.body.innerText, messages: window.__yetAiVsCodeMessages ?? [] })).catch(() => ({ body: "", messages: [] }));
    throw new Error(`Timed out waiting for apply request ${count}. ${messageOf(error)}\nMessages: ${JSON.stringify(state.messages).slice(0, 2000)}\nBody: ${redactSecrets(state.body).slice(0, 5000)}`);
  }
  return page.evaluate((expected) => window.__yetAiVsCodeMessages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest")[expected - 1], count);
}

async function assertNoBridgeMessagesOfType(page, type, label) {
  const count = await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  if (count !== 0) {
    failures.push(`Unexpected ${type} message in ${label}.`);
  }
}

async function assertNoForbiddenBridgeActions(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const ideActions = messages.filter((message) => message?.type === "gui.ideActionRequest").map((message) => message.payload?.action);
  const forbiddenIdeActions = ideActions.filter((action) => /git|shell|tool|exec|command|verification|runVerificationCommand/i.test(String(action)));
  if (forbiddenIdeActions.length > 0) {
    failures.push(`Unexpected shell/git/tool/verification bridge action(s): ${forbiddenIdeActions.join(",")}.`);
  }
}

async function dispatchHostApplyResult(page, requestId, status, message, appliedEditCount, affectedFiles) {
  await page.evaluate(({ version, requestId, payload }) => {
    window.dispatchEvent(new MessageEvent("message", { data: { version, type: "host.applyWorkspaceEditResult", requestId, payload } }));
  }, { version: bridgeVersion, requestId, payload: { status, message, cloudRequired: false, appliedEditCount, affectedFiles } });
}

function assertApplyRequestShape(message, source) {
  if (!message || message.version !== bridgeVersion || message.type !== "gui.applyWorkspaceEditRequest" || typeof message.requestId !== "string") {
    failures.push(`${source} did not emit a correlated gui.applyWorkspaceEditRequest.`);
    return;
  }
  const payload = message.payload;
  if (payload?.requiresUserConfirmation !== true || payload?.cloudRequired !== false || !Array.isArray(payload?.edits) || payload.edits.length !== 1) {
    failures.push(`${source} did not carry the strict bounded proposal payload.`);
    return;
  }
  const edit = payload.edits[0];
  if (edit.workspaceRelativePath !== "src/quality.ts" || !Array.isArray(edit.textReplacements) || edit.textReplacements.length !== 1) {
    failures.push(`${source} did not preserve the expected single-file textReplacements shape.`);
  }
}

async function assertStorageClean(page, label) {
  const state = await page.evaluate(() => {
    const snapshot = { body: document.body.innerText, localStorage: {}, sessionStorage: {}, bridgeMessages: window.__yetAiVsCodeMessages ?? [] };
    for (const name of ["localStorage", "sessionStorage"]) {
      const storage = window[name];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? "";
        snapshot[name][key] = storage.getItem(key) ?? "";
      }
    }
    return snapshot;
  });
  const storageText = JSON.stringify({ localStorage: state.localStorage, sessionStorage: state.sessionStorage });
  for (const fragment of ["src/quality.ts", "quality = 'better'", "textReplacements", "workspaceRelativePath", "replacementText"]) {
    if (storageText.includes(fragment)) {
      failures.push(`Browser storage leaked proposal fragment in ${label}: ${fragment}.`);
    }
  }
  assertNoRawMarkers(JSON.stringify(state), `${label} DOM, bridge messages, or browser storage`);
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

function assertNoRawMarkers(value, source) {
  const text = String(value).toLowerCase();
  for (const [index, marker] of secretMarkers.entries()) {
    if (marker && text.includes(marker.toLowerCase())) {
      throw new Error(`Raw marker ${index + 1} leaked through ${source}.`);
    }
  }
}

function redactSecrets(value) {
  let redacted = String(value);
  for (const marker of secretMarkers) {
    redacted = redacted.split(marker).join("[redacted]");
  }
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/access_token=[A-Za-z0-9_-]+/gi, "access_token=[redacted]")
    .replace(/\/Users\/[^\n]+/g, "/Users/[redacted]")
    .replace(/C:\\Users\\[^\n]+/g, "C:\\Users\\[redacted]");
}

function failActionable(summary, lines) {
  console.error(`Patch proposal quality smoke failed: ${summary}`);
  for (const line of lines) {
    if (line) console.error(redactSecrets(line));
  }
  process.exit(1);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
