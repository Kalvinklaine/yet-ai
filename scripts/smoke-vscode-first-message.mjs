import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

await import("./smoke-vscode-preview.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packagedGuiRoot = path.join(root, "apps", "plugins", "vscode", "media", "gui");
const packagedGuiIndex = path.join(packagedGuiRoot, "index.html");
const hostedChatPath = "/vscode/hosted-chat";
const bridgeVersion = "2026-05-15";
const projectId = "prj_abcdefghijklmnopqrstuA";
const projectDisplayName = "VS Code First Message Workspace";
const chatId = "chat-vscode-first-message-001";
const runtimeToken = `vscsession.${randomUUID()}`;
const providerKey = `sk-vscode-provider-${randomUUID()}`;
const contextSentinel = `VSCODE_CONTEXT_SENTINEL_${randomUUID()}`;
const contextText = "safe short VS Code selected text for first-message context";
const userMessageText = "Say hello through VS Code packaged GUI smoke.";
const assistantText = "VS Code packaged smoke response.";
const failures = [];
const consoleMessages = [];
let runtimeReady = true;
const runtimeApiRequests = [];
let observedRuntimeAuthorization = false;
let chatCommandRequest;
let chatCommandRequestCount = 0;
let chatSubscriptionCount = 0;
let chatCreated = false;
let matchingUserMessageCommandReceived = false;
let hostGeneration;
let resolveMatchingUserMessageCommand;
const matchingUserMessageCommand = new Promise((resolve) => {
  resolveMatchingUserMessageCommand = resolve;
});

if (packageJson.scripts?.["smoke:gui-runtime-e2e"] !== "node scripts/smoke-gui-runtime-e2e.mjs") {
  failures.push("Root package.json must keep smoke:gui-runtime-e2e available as the deeper local mock-provider runtime/chat verification path.");
}

await requirePackagedGui();
const { chromium } = await requireChromium();
const guiServer = await startStaticServer(packagedGuiRoot);
await verifyStaticServerContract(guiServer.port);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeServer = await startMockRuntimeServer();
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:8001/")) {
      await route.abort();
      return;
    }
    if (url.startsWith(`${runtimeBaseUrl}/p/${projectId}/v1/chats/subscribe?`)) {
      chatSubscriptionCount += 1;
      const authorization = route.request().headers().authorization;
      if (authorization !== `Bearer ${runtimeToken}`) {
        failures.push("SSE subscription did not use the VS Code host.ready runtime session token.");
      }
      runtimeApiRequests.push({ method: route.request().method(), pathname: `/p/${projectId}/v1/chats/subscribe`, authorized: authorization === `Bearer ${runtimeToken}` });
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" },
        body: await commandDrivenSseBodyFromUrl(url),
      });
      return;
    }
    if (isAllowedUrl(url, [guiBaseUrl, runtimeBaseUrl])) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request: ${redactUrl(url)}`);
    await route.abort();
  });
  await page.addInitScript(({ token }) => {
    window.__yetAiVsCodeMessages = [];
    window.__yetAiInitialRuntimeConfig = { ...window.__yetAiInitialRuntimeConfig, entryMode: "hosted_chat" };
    window.__yetAiSmokeTrustedEntryInjected = window.__yetAiInitialRuntimeConfig.entryMode === "hosted_chat";
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
    window.__yetAiRuntimeTokenProbe = token;
  }, { token: runtimeToken });
  page.on("console", (message) => {
    consoleMessages.push(message.text());
    assertNoSecretLeak(message.text(), "browser console");
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

  await page.goto(`${guiBaseUrl}${hostedChatPath}`, { waitUntil: "domcontentloaded" });
  await assertHostedEntryRoute(page);
  await waitForGuiReady(page);
  if (runtimeApiRequests.length !== 0) {
    throw new Error(`VS Code first-message GUI sent runtime requests before host.ready: ${runtimeApiRequests.map((entry) => `${entry.method} ${entry.pathname}`).join(", ")}.`);
  }
  hostGeneration = createHostGeneration();
  await dispatchHostedWorkspaceAuthority(page, hostGeneration);

  await page.evaluate(({ version }) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version,
        type: "host.runtimeStatus",
        payload: {
          protocolVersion: "2026-06-21",
          surface: "vscode",
          lifecycle: "connected",
          runtimeOwner: "ide_host",
          launchMode: "auto",
          tokenState: "present",
          processState: "running",
          diagnosis: "runtime connected",
          nextAction: "Type a prompt or refresh provider readiness.",
          cloudRequired: false,
          authority: "metadata_only",
        },
      },
    }));
  }, { version: bridgeVersion });

  await page.getByText("Current Workspace Dashboard", { exact: true }).waitFor({ state: "attached", timeout: 10_000 });
  await page.getByText(projectDisplayName, { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
  if (await page.getByPlaceholder("Ask about the current file, selection, or project...").count() !== 0) {
    failures.push("Current Workspace Dashboard mounted the composer before explicit Start new chat.");
  }
  const startNewChat = page.getByRole("button", { name: "Start new chat", exact: true });
  await waitForEnabledStart(page, startNewChat);
  if (consoleMessages.includes("Rejected invalid host bridge message")) {
    throw new Error("VS Code first-message host.ready was rejected by the GUI bridge contract.");
  }
  await startNewChat.click();
  await page.getByText("Project chat", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("textarea").waitFor({ state: "visible", timeout: 10_000 }).catch(async (error) => {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Project chat did not mount its composer after Start new chat. ${messageOf(error)}\nVisible body excerpt: ${sanitizeDiagnosticText(body).slice(0, 4000)}`);
  });
  await page.locator("main.app-shell.host-vscode").waitFor({ state: "attached", timeout: 10_000 });
  await waitForLazyAppSubscriber(page);
  runtimeReady = true;
  await dispatchHostedWorkspaceAuthority(page, hostGeneration);
  await page.locator("[data-testid='ide-actions-drawer']").waitFor({ state: "attached", timeout: 20_000 });
  if (!observedRuntimeAuthorization) {
    failures.push("Mock runtime did not observe the VS Code host.ready runtime session token.");
  }

  await expectVisibleBodyText(page, "Sends go through VS Code Smoke Model (vscode-smoke-provider) via the local runtime", "safe mock provider/model readiness", 20_000);
  await expectVisibleBodyText(page, "Ready to send.", "exact send readiness", 20_000);
  if (await sendButton(page).isDisabled()) {
    failures.push("Send stayed disabled after safe mock provider/model readiness.");
  }

  await page.evaluate(({ version, text, requestId }) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version,
        type: "host.contextSnapshot",
        requestId,
        payload: {
          kind: "active_editor",
          source: "vscode",
          file: {
            displayPath: "src/vscode-smoke.ts",
            workspaceRelativePath: "src/vscode-smoke.ts",
            languageId: "typescript",
          },
          selection: { text },
        },
      },
    }));
  }, { version: bridgeVersion, text: contextText, requestId: hostGeneration });
  await expectVisibleActiveContext(page);

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageText);
  await sendButton(page).click();
  await expectVisibleText(page, userMessageText, "visible user first message", 20_000);
  await expectVisibleText(page, assistantText, "mock SSE assistant response", 20_000);
  await assertAssistantAnswerCount(page, assistantText, 1, "mock SSE assistant response");

  if (chatCommandRequestCount !== 1) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests instead of exactly one.`);
  }
  if (chatSubscriptionCount < 1 || chatSubscriptionCount > 2) {
    failures.push(`Mock runtime received ${chatSubscriptionCount} chat subscriptions instead of one or two expected local subscriptions.`);
  }
  if (chatCommandRequest?.type !== "user_message") {
    failures.push("Mock runtime did not receive a user_message command.");
  }
  if (chatCommandRequest?.payload?.content !== userMessageText) {
    failures.push("Mock runtime did not receive the expected first-message content.");
  }
  if (chatCommandRequest?.payload?.context?.source !== "vscode" || chatCommandRequest?.payload?.context?.selection?.text !== contextText) {
    failures.push("Mock runtime did not receive the VS Code active context on the first message.");
  }
  assertProjectOwnedRuntimeRequestsScoped();
  assertAllRuntimeApiRequestsAuthorized();

  const visibleState = await collectVisibleState(page);
  assertNoSecretLeak(visibleState, "DOM, console, localStorage, or sessionStorage");

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("VS Code first-message preview smoke passed.");
  console.log("Verified VS Code dev-preview artifacts plus packaged GUI host.ready bootstrap, ready Project Command Center, explicit Start new chat, lazy App authority handoff, safe mock provider/model readiness, manual user_message command, mock SSE assistant rendering, active-context include, loopback-only networking, and browser-visible redaction.");
  console.log("No OpenAI, ChatGPT, hosted Yet AI service, real provider credential, non-loopback provider call, or VS Code launch was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close();
  await guiServer.close();
}

async function requirePackagedGui() {
  try {
    const fileStat = await stat(packagedGuiIndex);
    if (!fileStat.isFile()) throw new Error("not a file");
  } catch {
    console.error("VS Code first-message preview smoke failed: packaged GUI is missing.");
    console.error("Run `npm run prepare:vscode-preview` from the repository root.");
    console.error(`Expected file: ${path.relative(root, packagedGuiIndex)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code first-message preview smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
    console.error(`Load error: ${messageOf(error)}`);
    process.exit(1);
  }
}

async function waitForGuiReady(page) {
  const ready = await page.waitForFunction(() => {
    const message = window.__yetAiVsCodeMessages?.find((candidate) => candidate?.type === "gui.ready");
    return message ? {
      version: message.version,
      type: message.type,
      supportedBridgeVersion: message.payload?.supportedBridgeVersion,
    } : undefined;
  }, undefined, { timeout: 10_000 }).then((handle) => handle.jsonValue());
  if (ready.version !== bridgeVersion || ready.type !== "gui.ready" || ready.supportedBridgeVersion !== bridgeVersion) {
    throw new Error("VS Code first-message gui.ready did not match the supported direct bridge contract.");
  }
}

function createHostGeneration() {
  const requestId = `host-ready-${randomUUID().replaceAll("-", "")}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(requestId)) throw new Error("Generated invalid host readiness requestId.");
  return requestId;
}

async function dispatchHostedWorkspaceAuthority(page, requestId) {
  await page.evaluate(({ version, runtimeUrl, token, requestId: generation, projectId: boundProjectId, displayName }) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version,
        type: "host.ready",
        requestId: generation,
        payload: { runtimeUrl, sessionToken: token, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
      },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version,
        type: "host.workspaceBinding",
        requestId: generation,
        payload: { protocolVersion: "workspace_binding_v1", requestId: generation, state: "auto_bound", projectId: boundProjectId, displayName },
      },
    }));
  }, { version: bridgeVersion, runtimeUrl: runtimeBaseUrl, token: runtimeToken, requestId, projectId, displayName: projectDisplayName });
}

async function waitForEnabledStart(page, startButton) {
  try {
    await page.waitForFunction(() => {
      const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "Start new chat");
      return button instanceof HTMLButtonElement && !button.disabled;
    }, undefined, { timeout: 20_000 });
  } catch (error) {
    const diagnostic = await startButton.evaluate((button) => {
      const reasonId = button.getAttribute("aria-describedby");
      const reason = reasonId ? document.getElementById(reasonId)?.textContent?.trim() : "";
      return { disabled: button instanceof HTMLButtonElement ? button.disabled : null, reason: reason || "No blocked reason was rendered." };
    }).catch(() => ({ disabled: null, reason: "Start new chat was not attached." }));
    throw new Error(`Start new chat did not become truthfully ready: ${sanitizeDiagnosticText(JSON.stringify(diagnostic)).slice(0, 800)}. ${messageOf(error)}`);
  }
}

async function waitForLazyAppSubscriber(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function expectVisibleActiveContext(page) {
  await openComposerDrawer(page, "ide-actions-drawer", "VS Code active context bridge delivery");
  const contextDetails = page.locator("[data-testid='attached-context-active-details']").first();
  await contextDetails.waitFor({ state: "visible", timeout: 10_000 });
  const contextSummary = contextDetails.locator(":scope > summary").first();
  await contextSummary.waitFor({ state: "visible", timeout: 5000 });
  await expectVisibleTextWithin(contextDetails, "Active editor context", "VS Code active context summary");
  await expectVisibleTextWithin(contextDetails, "Attach to next message", "VS Code active context attach state");
  await expectVisibleTextWithin(contextDetails, "src/vscode-smoke.ts", "VS Code active context file");
  if (!await contextDetails.evaluate((element) => element instanceof HTMLDetailsElement && element.open).catch(() => false)) {
    await contextSummary.click({ timeout: 5000 });
  }
  await expectVisibleTextWithin(contextDetails, "Selection range", "VS Code active context selection range");
  await expectVisibleTextWithin(contextDetails, contextText, "VS Code active context bounded preview");
}

async function openComposerDrawer(page, testId, description) {
  const drawer = page.locator(`[data-testid='${testId}']`).first();
  await drawer.waitFor({ state: "attached", timeout: 10_000 });
  const summary = drawer.locator(":scope > summary").first();
  await summary.waitFor({ state: "visible", timeout: 5000 });
  if (!await drawer.evaluate((element) => element instanceof HTMLDetailsElement && element.open).catch(() => false)) {
    await summary.scrollIntoViewIfNeeded({ timeout: 5000 });
    await summary.click({ timeout: 5000 });
  }
  const body = drawer.locator(":scope > .composer-drawer-body").first();
  await body.waitFor({ state: "visible", timeout: 10_000 }).catch(async (error) => {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out opening ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(bodyText).slice(0, 4000)}`);
  });
}

function sendButton(page) {
  return page.getByRole("button", { name: "Send", exact: true });
}

async function startMockRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const projectPrefix = `/p/${projectId}`;
    const scoped = requestUrl.pathname.startsWith(`${projectPrefix}/v1/`);
    const runtimePath = scoped ? requestUrl.pathname.slice(projectPrefix.length) : requestUrl.pathname;
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders()).end();
      return;
    }
    const authorized = request.headers.authorization === `Bearer ${runtimeToken}`;
    if (requestUrl.pathname.startsWith("/v1/") || scoped) {
      runtimeApiRequests.push({ method: request.method ?? "GET", pathname: requestUrl.pathname, authorized });
    }
    if (request.headers.authorization === `Bearer ${runtimeToken}`) {
      observedRuntimeAuthorization = true;
    }
    if (request.headers.authorization !== `Bearer ${runtimeToken}`) {
      json(response, 401, { error: "Unauthorized local runtime request. Check the session token." });
      return;
    }
    if (isProjectOwnedRuntimePath(requestUrl.pathname) && !scoped) {
      failures.push(`Mock runtime rejected unscoped project-owned request: ${request.method ?? "GET"} ${requestUrl.pathname}`);
      json(response, 404, { error: "Project-owned runtime request must use the current project scope." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/ping") {
      json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0-smoke", ready: true, serverTime: new Date(0).toISOString() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/caps") {
      json(response, 200, { productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: ["chat"], features: {}, providers: [], ide: { bridge: true, lsp: false, host: "vscode-preview-smoke" } });
      return;
    }
    if ((request.method === "GET" || request.method === "POST") && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, demoModeDisabledResponse());
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: runtimeReady ? [mockProvider()] : [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: runtimeReady ? [mockModel()] : [] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Use a safe local mock provider for this preview smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/projects") {
      json(response, 200, { projects: [mockProjectSummary()], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === `/v1/projects/${projectId}`) {
      json(response, 200, mockProjectSummary());
      return;
    }
    if (request.method === "GET" && runtimePath === "/v1/project-memory") {
      json(response, 200, { notes: [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && runtimePath === "/v1/agent-progress") {
      json(response, 200, { snapshots: [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "POST" && runtimePath === "/v1/chats") {
      chatCreated = true;
      runtimeReady = false;
      json(response, 201, mockChatThread());
      return;
    }
    if (request.method === "GET" && runtimePath === "/v1/chats") {
      json(response, 200, { chats: chatCreated ? [mockChatSummary()] : [] });
      return;
    }
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(runtimePath);
    if (request.method === "GET" && chatMatch) {
      if (decodeURIComponent(chatMatch[1]) !== chatId) {
        json(response, 404, { error: "Unknown chat" });
        return;
      }
      json(response, 200, mockChatThread());
      return;
    }
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(runtimePath);
    if (request.method === "POST" && commandMatch) {
      chatCommandRequestCount += 1;
      chatCommandRequest = JSON.parse(await readRequestBody(request));
      const commandChatId = decodeURIComponent(commandMatch[1]);
      if (commandChatId !== chatId) failures.push(`Chat command used ${commandChatId} instead of the engine-created chat ID.`);
      if (isMatchingUserMessageCommand(chatCommandRequest)) {
        matchingUserMessageCommandReceived = true;
        resolveMatchingUserMessageCommand();
      }
      json(response, 200, { accepted: true, chatId: commandChatId, requestId: chatCommandRequest.requestId, type: chatCommandRequest.type });
      return;
    }
    if (request.method === "GET" && runtimePath === "/v1/chats/subscribe") {
      json(response, 500, { error: "SSE should be fulfilled by the browser route in this deterministic preview smoke." });
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

async function commandDrivenSseBodyFromUrl(value) {
  if (!matchingUserMessageCommandReceived) {
    await matchingUserMessageCommand;
  }
  return sseBodyFromUrl(value);
}

function sseBodyFromUrl(value) {
  const url = new URL(value);
  const subscribedChatId = url.searchParams.get("chat_id") ?? chatId;
  if (subscribedChatId !== chatId) failures.push(`SSE subscribed to ${subscribedChatId} instead of the engine-created chat ID.`);
  return [
    { seq: 0, type: "snapshot", chatId: subscribedChatId, payload: { thread: mockChatThread(), messages: [], runtime: { streaming: false, waitingForResponse: false } } },
    { seq: 1, type: "stream_started", chatId: subscribedChatId, payload: { role: "assistant" } },
    { seq: 2, type: "stream_delta", chatId: subscribedChatId, payload: { delta: { content: "VS Code packaged " } } },
    { seq: 3, type: "stream_delta", chatId: subscribedChatId, payload: { delta: { content: "smoke response." } } },
    { seq: 4, type: "stream_finished", chatId: subscribedChatId, payload: { finishReason: "stop" } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "\n";
}

function isMatchingUserMessageCommand(command) {
  return command?.type === "user_message"
    && command?.payload?.content === userMessageText
    && command?.payload?.context?.source === "vscode"
    && command?.payload?.context?.selection?.text === contextText;
}

function mockProvider() {
  return { id: "vscode-smoke-provider", kind: "openai-compatible", displayName: "VS Code Smoke Provider", enabled: true, baseUrl: "http://127.0.0.1/mock/v1", auth: { type: "api_key", configured: true, redacted: "sk-...safe" }, models: [mockModel()], capabilities: { chat: true, completion: false, embeddings: false } };
}

function mockModel() {
  return { id: "vscode-smoke-model", providerId: "vscode-smoke-provider", displayName: "VS Code Smoke Model", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

function demoModeDisabledResponse() {
  return { enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality. Configure a BYOK provider for real answers." };
}

function mockProjectSummary() {
  return { projectId, displayName: projectDisplayName, status: "available", revision: "1", createdAt: new Date(0).toISOString(), lastOpenedAt: new Date(0).toISOString(), rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
}

function mockChatThread() {
  return { chatId, title: "VS Code first-message smoke", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), messages: [] };
}

function mockChatSummary() {
  const thread = mockChatThread();
  return { chatId: thread.chatId, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt, messageCount: thread.messages.length };
}

function isProjectOwnedRuntimePath(pathname) {
  return /^\/v1\/(?:chats(?:\/|$)|project-memory(?:\/|$)|agent-progress(?:\/|$))/.test(pathname)
    || /^\/p\/[^/]+\/v1\/(?:chats(?:\/|$)|project-memory(?:\/|$)|agent-progress(?:\/|$))/.test(pathname);
}

async function startStaticServer(staticRoot) {
  const realStaticRoot = await realpath(staticRoot);
  const server = http.createServer(async (request, response) => {
    const rawPath = rawRequestPath(request.url);
    const hostedEntry = rawPath === hostedChatPath;
    const pathname = staticRequestPath(hostedAssetPath(rawPath) ?? rawPath);
    if (pathname === null) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const requestedPath = path.resolve(realStaticRoot, `.${hostedEntry ? "/index.html" : pathname}`);
    let realRequestedPath;
    try {
      realRequestedPath = await realpath(requestedPath);
      if (!isPathInsideRoot(realStaticRoot, realRequestedPath) || !(await stat(realRequestedPath)).isFile()) throw new Error("not found");
      response.writeHead(200, { "content-type": contentType(realRequestedPath) });
      createReadStream(realRequestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return listen(server);
}

function rawRequestPath(requestTarget) {
  const target = requestTarget ?? "/";
  const queryIndex = target.indexOf("?");
  return queryIndex < 0 ? target : target.slice(0, queryIndex);
}

function hostedAssetPath(rawPath) {
  const match = /^\/vscode\/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(rawPath);
  return match ? `/assets/${match[1]}` : null;
}

function staticRequestPath(rawPath) {
  if (!rawPath.startsWith("/") || rawPath.includes("\\")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return decoded === "/" ? "/index.html" : decoded;
}

async function verifyStaticServerContract(port) {
  const indexHtml = await readFile(packagedGuiIndex, "utf8");
  const assetPath = /(?:src|href)=(?:"|')\.\/(assets\/[^"']+)/.exec(indexHtml)?.[1];
  if (!assetPath) throw new Error("VS Code first-message smoke server self-check failed: packaged entry has no relative asset reference.");

  const hostedEntry = await requestStaticServer(port, hostedChatPath);
  if (hostedEntry.status !== 200 || !hostedEntry.contentType.startsWith("text/html") || hostedEntry.body !== indexHtml) {
    throw new Error("VS Code first-message smoke server self-check failed for the trusted hosted entry.");
  }

  for (const requestPath of [
    "/vscode%2fhosted-chat",
    "/vscode/%68osted-chat",
    "/vscode/../hosted-chat",
    "/vscode\\hosted-chat",
    "/vscode/hosted-chat/",
  ]) {
    const result = await requestStaticServer(port, requestPath);
    if (result.status === 200 && result.contentType.startsWith("text/html")) {
      throw new Error(`VS Code first-message smoke server self-check accepted malformed hosted entry: ${sanitizeDiagnosticText(requestPath)}`);
    }
  }

  const hostedAsset = await requestStaticServer(port, `/vscode/${assetPath}`);
  if (hostedAsset.status !== 200 || hostedAsset.contentType.startsWith("text/html") || hostedAsset.body.length === 0) {
    throw new Error("VS Code first-message smoke server self-check failed for a hosted flat asset.");
  }

  for (const requestPath of [
    `/vscode/assets/../${path.basename(assetPath)}`,
    `/vscode/assets/%2e%2e/${path.basename(assetPath)}`,
    `/vscode/assets/nested/${path.basename(assetPath)}`,
    `/vscode/assets%2f${path.basename(assetPath)}`,
    `/vscode/assets/${path.basename(assetPath)}/extra`,
  ]) {
    const result = await requestStaticServer(port, requestPath);
    if (result.status === 200) {
      throw new Error(`VS Code first-message smoke server self-check accepted malformed hosted asset: ${sanitizeDiagnosticText(requestPath)}`);
    }
  }

  const rootAsset = await requestStaticServer(port, `/${assetPath}`);
  if (rootAsset.status !== 200 || rootAsset.contentType.startsWith("text/html") || rootAsset.body.length === 0) {
    throw new Error("VS Code first-message smoke server self-check failed for regular root static serving.");
  }
  console.log("VS Code first-message smoke server contract passed: strict hosted entry and flat assets verified.");
}

function requestStaticServer(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: requestPath }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        contentType: String(response.headers["content-type"] ?? ""),
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
  });
}

async function assertHostedEntryRoute(page) {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 }).catch(() => undefined);
  const state = await page.evaluate((expectedPath) => ({
    url: window.location.href,
    path: window.location.pathname,
    expectedPath,
    trustedEntryInjected: window.__yetAiSmokeTrustedEntryInjected === true,
    entryMode: window.__yetAiInitialRuntimeConfig?.entryMode ?? null,
    notFound: document.body.innerText.includes("Not Found"),
    bodySnippet: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 700),
  }), hostedChatPath);
  if (!state.bodySnippet || state.notFound || state.path !== hostedChatPath || !state.trustedEntryInjected || state.entryMode !== "hosted_chat") {
    const diagnostic = {
      ...state,
      url: redactUrl(state.url),
      path: sanitizeDiagnosticText(state.path),
      expectedPath: sanitizeDiagnosticText(state.expectedPath),
      bodySnippet: sanitizeDiagnosticText(state.bodySnippet),
    };
    throw new Error(`VS Code first-message hosted route/bootstrap failed: ${JSON.stringify(diagnostic)}`);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({ port: address.port, close: () => new Promise((closeResolve) => server.close(closeResolve)) });
    });
  });
}

async function readRequestBody(request) {
  return await new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 4000)}`);
  }
}

async function expectVisibleTextWithin(locator, text, description, timeout = 10_000) {
  try {
    await locator.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const textContent = await locator.innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nScoped text excerpt: ${redactSecrets(textContent).slice(0, 4000)}`);
  }
}

async function expectVisibleBodyText(page, text, description, timeout = 10_000) {
  await expectVisibleBodyTextAny(page, [text], description, timeout);
}

async function expectVisibleBodyTextAny(page, texts, description, timeout = 10_000) {
  try {
    await page.waitForFunction((expectedTexts) => {
      const bodyText = document.body?.innerText ?? "";
      return expectedTexts.some((text) => bodyText.includes(text));
    }, texts, { timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 4000)}`);
  }
}

async function expectAttachedText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 4000)}`);
  }
}

async function assertAssistantAnswerCount(page, text, expected, description) {
  const count = await page.locator(".chat-bubble.assistant").evaluateAll(
    (elements, answer) => elements.filter((element) => element.textContent?.includes(String(answer))).length,
    text,
  );
  if (count !== expected) {
    failures.push(`Expected ${description} to appear exactly ${expected} time(s) in assistant bubbles, observed ${count}: ${text}`);
  }
}

async function collectVisibleState(page) {
  return JSON.stringify(await page.evaluate(() => ({
    dom: document.documentElement.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
    vscodeMessages: window.__yetAiVsCodeMessages,
  }))) + JSON.stringify(consoleMessages);
}

function json(response, status, body) {
  response.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, accept" };
}

function isAllowedUrl(value, origins) {
  try {
    const url = new URL(value);
    return origins.includes(url.origin);
  } catch {
    return false;
  }
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

function assertAllRuntimeApiRequestsAuthorized() {
  if (runtimeApiRequests.length === 0) {
    failures.push("Mock runtime did not observe any /v1/* requests.");
    return;
  }
  const unauthorized = runtimeApiRequests.filter((entry) => !entry.authorized);
  if (unauthorized.length > 0) {
    failures.push(`Runtime /v1/* request(s) missed the VS Code host.ready bearer token: ${unauthorized.map((entry) => `${entry.method} ${entry.pathname}`).join(", ")}.`);
  }
}

function assertProjectOwnedRuntimeRequestsScoped() {
  const expectedPrefix = `/p/${projectId}/v1/`;
  const unscoped = runtimeApiRequests.filter((entry) => isProjectOwnedRuntimePath(entry.pathname) && !entry.pathname.startsWith(expectedPrefix));
  if (unscoped.length > 0) {
    failures.push(`Project-owned runtime request(s) escaped ${expectedPrefix}: ${unscoped.map((entry) => `${entry.method} ${entry.pathname}`).join(", ")}.`);
  }
  for (const expected of [
    { method: "POST", pathname: `${expectedPrefix}chats` },
    { method: "POST", pathname: `${expectedPrefix}chats/${chatId}/commands` },
    { method: "GET", pathname: `${expectedPrefix}chats/subscribe` },
  ]) {
    if (!runtimeApiRequests.some((entry) => entry.method === expected.method && entry.pathname === expected.pathname)) {
      failures.push(`Missing project-scoped runtime evidence: ${expected.method} ${expected.pathname}.`);
    }
  }
}

function assertNoSecretLeak(text, source) {
  const lower = String(text).toLowerCase();
  for (const marker of [runtimeToken, providerKey, contextSentinel, `Bearer ${runtimeToken}`, `Bearer ${providerKey}`, "authorization: bearer", "provider secret"]) {
    if (marker && lower.includes(marker.toLowerCase())) {
      throw new Error(`Secret marker leaked through ${source}.`);
    }
  }
}

function redactSecrets(text) {
  let redacted = String(text);
  for (const marker of [runtimeToken, providerKey, contextSentinel]) {
    redacted = redacted.split(marker).join("[redacted]");
  }
  return redacted.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

function sanitizeDiagnosticText(text) {
  return redactSecrets(text)
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/[A-Z]:\\[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactSecrets(value);
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code first-message preview smoke failed:");
  for (const failure of failures) {
    console.error(`- ${redactSecrets(failure)}`);
  }
  process.exit(1);
}
