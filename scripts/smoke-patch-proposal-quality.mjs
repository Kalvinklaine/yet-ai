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
let lastUserPrompt = "";

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
const malformedAssistantProposal = [
  "```json",
  "{ \"version\": \"2026-05-15\", \"type\": \"gui.applyWorkspaceEditRequest\", \"requestId\": \"assistant-must-not-set-this\", \"payload\": { \"requiresUserConfirmation\": true, \"summary\": \"Malformed proposal-like output\", \"edits\": [ }",
  "```",
].join("\n");
const largeReplacementText = `export const quality = '${"large safe review text ".repeat(18)}done';`;
const largeProposalPayload = {
  requiresUserConfirmation: true,
  summary: "Replace one reviewed line with a large acknowledged patch quality fixture.",
  cloudRequired: false,
  edits: [{
    workspaceRelativePath: "src/quality-large.ts",
    textReplacements: [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 28 } },
      replacementText: largeReplacementText,
    }],
  }],
};
const largeAssistantProposal = [
  "```json",
  JSON.stringify({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: largeProposalPayload }, null, 2),
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
  await runHostedApplyCase(guiBaseUrl, "vscode");
  await runHostedApplyCase(guiBaseUrl, "jetbrains");
  await runRejectedProposalCase(guiBaseUrl);
  await runLargeAcknowledgementCase(guiBaseUrl);

  if (failures.length > 0) {
    throw new Error(`Patch proposal quality smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Patch proposal quality smoke passed.");
  console.log("Verified built-GUI mock-only safe edit proposal review: strict fenced JSON proposals extracted, quality panel and risk/status copy rendered, browser stays preview-only with no capable host, VS Code and JetBrains mock hosts emit no apply request before explicit click, apply/reject only after clicks, malformed proposal-like output shows a rejected non-actionable card with no stale apply request, large/shortened previews keep apply disabled until explicit acknowledgement, and no non-loopback network, shell/git/tool endpoints, browser-storage proposal/secret persistence, hosted service, real provider, or credential use occurred.");
} catch (error) {
  console.error(redactSecrets(error instanceof Error && error.stack ? error.stack : messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) await server.close().catch(() => undefined);
}

async function runBrowserPreviewCase(guiBaseUrl) {
  const page = await newInstrumentedPage(guiBaseUrl, { host: "browser" });
  try {
    await loadAndSendSafeEditRequest(page, guiBaseUrl, "Preview a safe edit proposal for the patch quality smoke.");
    await expectVisibleText(page, "Propose safe edit", "browser edit proposal card");
    await expectVisibleText(page, "Quality summary", "quality summary");
    await expectVisibleText(page, "1 files · 1 replacements · total chars 32 · max chars 32 · preview none · status browser preview only", "browser quality status");
    await expectVisibleText(page, "browser preview only", "browser preview risk badge");
    await expectVisibleText(page, "Preview only in this host. Browser cannot apply proposed edits", "browser preview-only guard");
    await assertProposalCount(page, 1, "browser preview");
    await assertBridgeMessagesOfTypeCount(page, "gui.applyWorkspaceEditRequest", 0, "browser preview");
    await assertNoForbiddenBridgeActions(page);
    await assertStorageClean(page, "browser preview");
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function runHostedApplyCase(guiBaseUrl, host) {
  const page = await newInstrumentedPage(guiBaseUrl, { host });
  const hostLabel = host === "jetbrains" ? "JetBrains" : "VS Code";
  try {
    await loadAndSendSafeEditRequest(page, guiBaseUrl, `Return a safe edit proposal for explicit ${hostLabel} apply review.`);
    await expectVisibleText(page, "Propose safe edit", `${hostLabel} edit proposal card`);
    await expectVisibleText(page, "Quality summary", `${hostLabel} quality summary`);
    await expectVisibleText(page, "1 files · 1 replacements · total chars 32 · max chars 32 · preview none · status ready for manual apply request", `${hostLabel} quality status`);
    await expectVisibleText(page, "IDE confirmation required", `${hostLabel} IDE confirmation badge`);
    await expectVisibleText(page, `Apply in ${hostLabel} after review`, `${hostLabel} explicit apply button`);
    await assertProposalCount(page, 1, `${hostLabel} preview`);
    await assertBridgeMessagesOfTypeCount(page, "gui.applyWorkspaceEditRequest", 0, `${hostLabel} before explicit apply click`);
    await assertNoForbiddenBridgeActions(page);

    await page.getByRole("button", { name: `Apply in ${hostLabel} after review` }).click();
    const appliedRequest = await waitForApplyRequest(page, 1);
    assertApplyRequestShape(appliedRequest, "applied request", proposalPayload);
    await expectVisibleText(page, `${hostLabel} apply request pending…`, "pending apply status");
    await dispatchHostApplyResult(page, appliedRequest.requestId, "applied", "Applied by deterministic patch quality host.", 1, ["src/quality.ts"]);
    await expectVisibleText(page, "Host apply result: applied", "applied host result");
    await expectVisibleText(page, "Applied by deterministic patch quality host.", "applied host message");

    await loadAndSendSafeEditRequest(page, guiBaseUrl, `Return a second safe edit proposal for explicit ${hostLabel} rejection review.`);
    await page.getByRole("button", { name: `Apply in ${hostLabel} after review` }).click();
    const rejectedRequest = await waitForApplyRequest(page, 1);
    assertApplyRequestShape(rejectedRequest, "rejected request", proposalPayload);
    await dispatchHostApplyResult(page, rejectedRequest.requestId, "rejected", "Rejected by deterministic patch quality host.", 0, []);
    await expectVisibleText(page, "Host apply result: rejected", "rejected host result");
    await expectVisibleText(page, "Rejected by deterministic patch quality host.", "rejected host message");

    await assertNoForbiddenBridgeActions(page);
    await assertStorageClean(page, `${hostLabel} hosted apply`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function runRejectedProposalCase(guiBaseUrl) {
  const page = await newInstrumentedPage(guiBaseUrl, { host: "vscode" });
  try {
    await loadAndSendSafeEditRequest(page, guiBaseUrl, "Return a safe edit proposal before the invalid output case.");
    await expectVisibleText(page, "Apply in VS Code after review", "initial valid apply button");
    await assertBridgeMessagesOfTypeCount(page, "gui.applyWorkspaceEditRequest", 0, "valid proposal before rejected case");

    await loadAndSendSafeEditRequest(page, guiBaseUrl, "Return malformed proposal-like output for rejection review.", "Edit proposal detected but rejected");
    await expectVisibleText(page, "Edit proposal detected but rejected", "rejected proposal card");
    await expectVisibleText(page, "The edit proposal JSON is not valid.", "rejected proposal diagnostic");
    await expectVisibleText(page, "No apply request is available for this response.", "rejected proposal no apply guidance");
    await assertProposalCount(page, 0, "rejected proposal");
    await assertNoVisibleApplyButton(page, "rejected proposal");
    await assertBridgeMessagesOfTypeCount(page, "gui.applyWorkspaceEditRequest", 0, "rejected proposal");
    await assertNoForbiddenBridgeActions(page);
    await assertStorageClean(page, "rejected proposal");
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function runLargeAcknowledgementCase(guiBaseUrl) {
  const page = await newInstrumentedPage(guiBaseUrl, { host: "jetbrains" });
  try {
    await loadAndSendSafeEditRequest(page, guiBaseUrl, "Return a large acknowledged safe edit proposal for patch quality smoke.", "Replace one reviewed line with a large acknowledged patch quality fixture.");
    await expectVisibleText(page, "large replacement", "large replacement risk badge");
    await expectVisibleText(page, "preview redacted", "preview redacted risk badge");
    await expectVisibleText(page, "preview redacted/shortened · status review blocked", "large proposal blocked status");
    await expectVisibleText(page, "Acknowledge the redacted/shortened preview before IDE apply.", "large proposal disabled reason");
    const applyButton = page.getByTestId("edit-proposal-apply-button");
    await applyButton.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await applyButton.isDisabled())) {
      failures.push("Large/redacted proposal apply button was enabled before explicit acknowledgement.");
    }
    await assertBridgeMessagesOfTypeCount(page, "gui.applyWorkspaceEditRequest", 0, "large proposal before acknowledgement");
    await page.getByTestId("edit-proposal-acknowledge-redaction").check();
    if (await applyButton.isDisabled()) {
      failures.push("Large/redacted proposal apply button stayed disabled after explicit acknowledgement.");
    }
    await applyButton.click();
    const request = await waitForApplyRequest(page, 1);
    assertApplyRequestShape(request, "large acknowledged request", largeProposalPayload);
    await dispatchHostApplyResult(page, request.requestId, "applied", "Applied large acknowledged proposal by deterministic host.", 1, ["src/quality-large.ts"]);
    await expectVisibleText(page, "Host apply result: applied", "large acknowledged host result");
    await assertNoForbiddenBridgeActions(page);
    await assertStorageClean(page, "large acknowledged proposal");
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function newInstrumentedPage(guiBaseUrl, { host }) {
  const page = await browser.newPage();
  if (host === "vscode") {
    await page.addInitScript(() => {
      window.__yetAiVsCodeMessages = [];
      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          window.__yetAiVsCodeMessages.push(message);
        },
      });
    });
  } else if (host === "jetbrains") {
    await page.addInitScript(() => {
      window.__yetAiVsCodeMessages = [];
      window.postIntellijMessage = (message) => {
        window.__yetAiVsCodeMessages.push(message);
      };
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

async function loadAndSendSafeEditRequest(page, guiBaseUrl, prompt, expectedAssistantText = "Replace one reviewed line in the patch quality smoke fixture.") {
  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  if (await hasVsCodeBridge(page)) {
    await waitForBridgeMessage(page, (message) => message?.type === "gui.ready");
  }
  await expectSendReady(page);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, expectedAssistantText, "assistant proposal response", 20_000);
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
    else {
      commandCount += 1;
      lastUserPrompt = String(parsed.payload?.content ?? "");
    }
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
  return { id, chatId, role: "assistant", status: "complete", createdAt: "2026-06-18T12:00:01Z", content: assistantContentForPrompt(lastUserPrompt) };
}

function assistantContentForPrompt(prompt) {
  if (/malformed proposal-like/i.test(prompt)) {
    return malformedAssistantProposal;
  }
  if (/large acknowledged|large/i.test(prompt)) {
    return largeAssistantProposal;
  }
  return assistantProposal;
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

async function expectSendReady(page) {
  try {
    await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some((button) => button.textContent?.trim() === "Send" && !button.disabled);
    }, undefined, { timeout: 20_000 });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for enabled Send button. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 5000)}`);
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

async function assertBridgeMessagesOfTypeCount(page, type, expected, label) {
  const count = await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  if (count !== expected) {
    failures.push(`Expected ${expected} ${type} message(s) in ${label}, found ${count}.`);
  }
}

async function assertNoVisibleApplyButton(page, label) {
  const count = await page.getByTestId("edit-proposal-apply-button").count();
  for (let index = 0; index < count; index += 1) {
    if (await page.getByTestId("edit-proposal-apply-button").nth(index).isVisible()) {
      failures.push(`Unexpected visible edit proposal apply button in ${label}.`);
      return;
    }
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

function assertApplyRequestShape(message, source, expectedPayload) {
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
  const expectedEdit = expectedPayload.edits[0];
  if (edit.workspaceRelativePath !== expectedEdit.workspaceRelativePath || !Array.isArray(edit.textReplacements) || edit.textReplacements.length !== 1) {
    failures.push(`${source} did not preserve the expected single-file textReplacements shape.`);
  }
  if (edit.textReplacements?.[0]?.replacementText !== expectedEdit.textReplacements[0].replacementText) {
    failures.push(`${source} did not preserve the expected replacement text.`);
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
