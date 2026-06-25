import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeOrigin = "http://127.0.0.1:8001";
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
const submittedRequestId = "agent-run-multistep-plan-request-1";
const optimisticUserMessageId = `${activeChatId}-optimistic-user-1`;
const rawMarkers = [
  ...new Set([
    "sk-agent-run-built-gui-secret",
    "access_token",
    "Authorization",
    "Bearer",
    "raw diff",
    "raw file body",
    "raw command",
    "npm run check",
    "--watch",
    "\"command\"",
    "\"args\"",
    "\"cwd\"",
    "\"env\"",
    "PRIVATE_TEMP_PATH",
    "/Users/",
    "C:\\Users\\",
  ]),
];
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let commandCount = 0;
let abortCount = 0;
let lastCommandBody;
let currentScenario = builtGuiScenario();

function builtGuiScenario(overrides = {}) {
  return {
    capsResponse: agentRunBuiltGuiCapsResponse(),
    assistantMessage: agentRunPlanAssistantMessage(validPlanPreview()),
    sseChatId: activeChatId,
    ...overrides,
  };
}

function resetScenario(overrides = {}) {
  currentScenario = builtGuiScenario(overrides);
  commandCount = 0;
  abortCount = 0;
  lastCommandBody = undefined;
  runtimeRequests.length = 0;
}

await buildGui();
await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  server = await startStaticServer(distRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });

  await runValidPlanPreviewScenario(guiBaseUrl);
  await runUnsafePlanRejectedScenario(guiBaseUrl);

  if (failures.length > 0) {
    throw new Error(`Agent Run multi-step plan preview smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Agent Run multi-step plan preview smoke passed.");
  console.log("Verified deterministic mock-only valid and rejected inert multi-step Agent Run plan previews, no auto apply/verification bridge messages, loopback-only runtime, and no browser-storage leakage.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function runValidPlanPreviewScenario(guiBaseUrl) {
  resetScenario({ assistantMessage: agentRunPlanAssistantMessage(validPlanPreview()) });
  const { page, prompt } = await preparePlanPromptPage(guiBaseUrl);
  await expectVisibleText(page, "Multi-step plan preview · Review only", "valid multi-step plan preview", 20_000);
  await expectVisibleText(page, "inert", "valid plan inert badge", 20_000);
  await expectVisibleText(page, "metadata only", "valid plan metadata-only badge", 20_000);
  await expectVisibleText(page, "Title: Review Agent Run plan preview", "valid plan title", 20_000);
  await expectVisibleText(page, "Inspect local readiness", "valid plan first step", 20_000);
  await expectVisibleText(page, "Expected file labels: apps/gui/src/App.tsx · apps/gui/src/components/AgentRunPanel.tsx", "valid plan expected file labels", 20_000);
  await expectVisibleText(page, "Verification suggestions (display-only command IDs): GUI app tests (gui-app-tests)", "valid plan verification suggestion", 20_000);
  await expectVisibleText(page, "This plan preview cannot send chat, apply edits, run verification, read files, call providers, or mutate the workspace. Future send, apply, and verification remain explicit user actions.", "plan preview explicit-authority disclaimer", 20_000);
  assert.equal(commandCount, 1, `expected exactly one explicit Send command for valid plan, received ${commandCount}`);
  assert.equal(abortCount, 0, "valid plan smoke unexpectedly sent abort command");
  assert.equal(lastCommandBody?.payload?.content, prompt, "valid plan Send did not use the drafted prompt after explicit click");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after valid inert plan preview");
  await assertNoIdeAction(page, "runVerificationCommand", "after valid inert plan preview");
  await assertNoForbiddenBridgeActions(page);
  await assertStorageSafe(page, "valid inert plan preview");
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  assertAgentRunBuiltGuiFixtureSafe({ messages: sanitizeBridgeMessagesForEvidence(messages), runtimeRequests }, "valid multi-step plan smoke evidence");
  await page.close();
}

async function runUnsafePlanRejectedScenario(guiBaseUrl) {
  resetScenario({ assistantMessage: agentRunPlanAssistantMessage(unsafePlanPreview(), { id: "assistantAgentRunUnsafePlan" }) });
  const { page, prompt } = await preparePlanPromptPage(guiBaseUrl);
  await expectVisibleText(page, "plan_rejected", "unsafe plan rejected diagnostic state", 20_000);
  await expectVisibleText(page, "The multi-step plan preview must be metadata-only with no execution authority.", "unsafe plan rejection diagnostic", 20_000);
  await assertNoVisibleText(page, "Multi-step plan preview · Review only", "unsafe rejected plan preview card");
  await assertNoVisibleText(page, "Title: Review Agent Run unsafe plan", "unsafe rejected plan title");
  assert.equal(commandCount, 1, `expected exactly one explicit Send command for unsafe plan, received ${commandCount}`);
  assert.equal(abortCount, 0, "unsafe plan smoke unexpectedly sent abort command");
  assert.equal(lastCommandBody?.payload?.content, prompt, "unsafe plan Send did not use the drafted prompt after explicit click");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after unsafe plan rejection");
  await assertNoIdeAction(page, "runVerificationCommand", "after unsafe plan rejection");
  await assertNoForbiddenBridgeActions(page);
  await assertStorageSafe(page, "unsafe rejected plan preview");
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  assertAgentRunBuiltGuiFixtureSafe({ messages: sanitizeBridgeMessagesForEvidence(messages), runtimeRequests }, "unsafe multi-step plan smoke evidence");
  await page.close();
}

async function preparePlanPromptPage(guiBaseUrl) {
  const page = await createSmokePage(guiBaseUrl);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Ready to send using ${fixture.modelId} through the local runtime.`, "mock model readiness", 20_000);
  await expectVisibleText(page, "Experimental Agent Run · one-step manual shell", "Agent Run panel", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit Send");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit Send");
  assert.equal(commandCount, 0, "chat command was sent before explicit Send");
  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  await page.getByRole("button", { name: "Draft one-step safe-edit prompt" }).click();
  const prompt = await firstTextareaValueContaining(page, "One-step safe-edit model proposal request", "one-step model proposal prompt");
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  return { page, prompt };
}

async function createSmokePage(guiBaseUrl) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
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
  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await waitForGuiMessage(page, "gui.ready");
  return page;
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:agent-run-multistep-plan`."]);
  }
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
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
  if (method === "GET" && url.pathname === "/v1/ping") {
    return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: fixture.checkpoint.checkedAt });
  }
  if (method === "GET" && url.pathname === "/v1/caps") {
    return json(currentScenario.capsResponse);
  }
  if (method === "GET" && url.pathname === "/v1/models") {
    return json({ models: [agentRunBuiltGuiProviderSummary().models[0]] });
  }
  if (method === "GET" && url.pathname === "/v1/demo-mode") {
    return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode is disabled for this Agent Run fixture." });
  }
  if (method === "GET" && url.pathname === "/v1/providers") {
    return json({ providers: [agentRunBuiltGuiProviderSummary()], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "GET" && url.pathname === "/v1/provider-auth/openai/status") {
    return json({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "OpenAI account login is not available for this local mock." });
  }
  if (method === "GET" && url.pathname === "/v1/chats") {
    return json({ chats: [] });
  }
  if (method === "GET" && url.pathname === `/v1/chats/${activeChatId}`) {
    return json(chatThread([]));
  }
  if (method === "POST" && url.pathname === "/v1/project-memory") {
    return json({ id: "agent-run-memory-unused", title: "unused", text: "unused", tags: [], source: "manual", createdAt: fixture.checkpoint.checkedAt, updatedAt: fixture.checkpoint.checkedAt });
  }
  if (method === "GET" && url.pathname === "/v1/project-memory") {
    return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "POST" && url.pathname === "/v1/project-memory/search") {
    return json({ queryLabel: "agent-run", matches: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "POST" && url.pathname === `/v1/chats/${activeChatId}/commands`) {
    const parsed = JSON.parse(body);
    if (parsed.type === "abort") {
      abortCount += 1;
    } else {
      commandCount += 1;
      lastCommandBody = parsed;
    }
    return json({ accepted: true, chatId: activeChatId, requestId: submittedRequestId, type: parsed.type });
  }
  if (method === "GET" && url.pathname === "/v1/chats/subscribe" && url.searchParams.get("chat_id") === activeChatId) {
    return sse(sseEvents());
  }
  if (method === "POST" && url.pathname === "/v1/chats") {
    return json(chatThread([]));
  }
  if (method === "GET" && url.pathname === "/v1/agent-progress") {
    return json({ cloudRequired: false, providerAccess: "direct", generatedAt: fixture.checkpoint.checkedAt, snapshots: [] });
  }
  return undefined;
}

function validPlanPreview() {
  return {
    version: "2026-06-25",
    kind: "agent_run.multistep_plan",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    title: "Review Agent Run plan preview",
    summary: "Preview two manual plan steps before any explicit future action.",
    steps: [
      { id: "step-1", title: "Inspect local readiness", summary: "Review visible provider and checkpoint labels without reading files.", status: "preview_only", expectedTouchedFiles: ["apps/gui/src/App.tsx"], riskLabels: ["Display only"] },
      { id: "step-2", title: "Review inert plan card", summary: "Confirm steps and risks are labels only before the user decides next actions.", status: "preview_only", expectedTouchedFiles: ["apps/gui/src/components/AgentRunPanel.tsx"], riskLabels: ["No apply authority"] },
    ],
    risks: ["User must choose any future send, apply, or verification manually."],
    expectedTouchedFiles: ["apps/gui/src/App.tsx", "apps/gui/src/components/AgentRunPanel.tsx"],
    verificationSuggestions: [
      { commandId: "gui-app-tests", label: "GUI app tests", description: "Run the focused GUI application test gate after explicit user selection.", riskLevel: "medium", expectedDuration: "Usually 5 to 10 minutes", cwdPolicyLabel: "Repository root selected by host", outputBoundLabel: "Sanitized tail only" },
    ],
    manualActionPolicy: { noAutoSend: true, noAutoApply: true, noAutoVerification: true, noAutoRollback: true, noHiddenReads: true, requiresExplicitUserAction: true },
  };
}

function unsafePlanPreview() {
  return {
    ...validPlanPreview(),
    title: "Review Agent Run unsafe plan",
    executionAllowed: true,
  };
}

function agentRunPlanAssistantMessage(plan, overrides = {}) {
  return {
    id: "assistantAgentRunMultistepPlanFixture",
    chatId: activeChatId,
    role: "assistant",
    status: "complete",
    createdAt: "2026-06-25T12:00:01Z",
    content: JSON.stringify(plan),
    ...overrides,
  };
}

function chatThread(messages) {
  return { ...agentRunBuiltGuiChatThread(messages), chatId: activeChatId, messages: messages.map(normalizeChatMessage) };
}

function sseEvents() {
  return [
    { seq: 0, type: "snapshot", chatId: currentScenario.sseChatId, payload: { messages: [] } },
    { seq: 1, type: "message_added", chatId: currentScenario.sseChatId, payload: { message: normalizeChatMessage(currentScenario.assistantMessage, currentScenario.sseChatId) } },
    { seq: 2, type: "stream_finished", chatId: currentScenario.sseChatId, payload: {} },
  ];
}

function normalizeChatMessage(message, chatId = activeChatId) {
  return {
    ...message,
    chatId,
    responseToRequestId: message.role === "assistant" ? submittedRequestId : message.responseToRequestId,
    userMessageId: message.role === "assistant" ? optimisticUserMessageId : message.userMessageId,
    runtimeSettingsVersion: message.role === "assistant" ? "0" : message.runtimeSettingsVersion,
  };
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function sse(events) {
  return {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
    body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  };
}

async function waitForGuiMessage(page, type) {
  await page.waitForFunction((messageType) => window.__yetAiVsCodeMessages?.some((message) => message?.type === messageType), type, { timeout: 10_000 });
  return await page.evaluate((messageType) => window.__yetAiVsCodeMessages.find((message) => message?.type === messageType), type);
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 5000)}`);
  }
}

async function assertNoVisibleText(page, text, description) {
  const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  assert.equal(visible, false, `${description} rendered unexpectedly`);
}

async function firstTextareaValueContaining(page, text, description = "textarea value") {
  const matched = await page.locator("textarea").evaluateAll((textareas, expected) => textareas.find((textarea) => textarea.value.includes(expected))?.value ?? null, text);
  if (matched) {
    return matched;
  }
  const values = await page.locator("textarea").evaluateAll((textareas) => textareas.map((textarea) => textarea.value).join("\n---\n"));
  throw new Error(`Timed out waiting for ${description}. Textarea values: ${redactSecrets(values).slice(0, 2000)}`);
}

async function assertNoRequestsOfType(page, type, label) {
  const count = await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  assert.equal(count, 0, `unexpected ${type} ${label}`);
}

async function assertNoIdeAction(page, action, label) {
  const count = await page.evaluate((actionName) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === actionName).length, action);
  assert.equal(count, 0, `unexpected ${action} ${label}`);
}

async function assertNoForbiddenBridgeActions(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const ideActions = messages.filter((message) => message?.type === "gui.ideActionRequest").map((message) => message.payload?.action);
  assert.deepEqual(ideActions, [], `unexpected IDE action request(s): ${ideActions.join(",")}`);
  assert.equal(runtimeRequests.some((request) => /git|shell|tool|exec|command-runner/i.test(request.url)), false, "runtime shell/git/tool-like endpoint was requested");
}

async function assertStorageSafe(page, label) {
  const pageState = await page.evaluate(() => ({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)];
    })),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? "";
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  const storageText = JSON.stringify(pageState);
  assert.equal(storageText.includes(fixture.goal), false, `${label} persisted Agent Run goal in browser storage`);
  assert.equal(storageText.includes(fixture.userPrompt), false, `${label} persisted raw prompt in browser storage`);
  assert.equal(storageText.includes(fixture.explicitContext.selection.text), false, `${label} persisted raw file body in browser storage`);
  assert.equal(storageText.includes(fixture.safeEdit.edits[0].textReplacements[0].replacementText), false, `${label} persisted raw diff replacement in browser storage`);
  assertNoRawMarkers(storageText, `${label} browser storage`);
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

function sanitizeBridgeMessagesForEvidence(messages) {
  return messages.map((message) => ({ type: message?.type, requestId: message?.requestId, action: message?.payload?.action, commandId: message?.payload?.commandId }));
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
  for (const marker of rawMarkers) {
    redacted = redacted.split(marker).join("[redacted]");
  }
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/authorization:\s*bearer[^\n]*/gi, "authorization: bearer [redacted]")
    .replace(/cookie:\s*[^\n]+/gi, "cookie: [redacted]")
    .replace(/\/Users\/[^\n]+/g, "/Users/[redacted]");
}

function failActionable(summary, lines) {
  console.error(`Agent Run multi-step plan preview smoke failed: ${summary}`);
  for (const line of lines) {
    if (line) {
      console.error(redactSecrets(line));
    }
  }
  process.exit(1);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
