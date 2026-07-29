import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createGuiSmokeBootstrap } from "./lib/gui-smoke-bootstrap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const evidenceRoot = path.join(root, "dist", "visual-smoke", "gui-demo-mode");
const projectId = "prj_abcdefghijklmnopqrstuA";
const projectName = "Disposable Demo Project";
const projectRootMarker = `/private/demo-smoke-${randomUUID()}`;
const providerSecret = `sk-demo-provider-${randomUUID()}`;
const chatId = "demo-project-chat";
const assistantAnswer = "Yet AI Demo Mode canned response — no provider call was made.";
const prompts = ["First manual Demo Mode project prompt.", "Second manual Demo Mode project prompt."];
const chats = new Map();
const subscribers = new Map();
const eventSequences = new Map();
const runtimeRequests = [];
let runtimeServer;
let smoke;
let registered = false;
let demoEnabled = false;
let providerHits = 0;
let chatCommandCount = 0;

try {
  const { chromium } = await import("playwright");
  runtimeServer = await startRuntimeServer();
  smoke = await createGuiSmokeBootstrap({
    distRoot,
    chromium,
    entry: { mode: "browser", route: "/projects" },
    viewport: { width: 1280, height: 900 },
    privacyMarkers: [providerSecret, projectRootMarker],
    criticalRequest: (url) => url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.startsWith(`/p/${projectId}/v1/`),
    launchOptions: { args: ["--disable-web-security"] },
  });
  const page = smoke.page;

  await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Add your first project", exact: true }).click();
  await page.getByRole("dialog", { name: "Add local project" }).waitFor({ state: "visible" });
  await page.getByLabel("Project display name").fill(projectName);
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.waitForURL(new RegExp(`/p/${projectId}/?$`));
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForURL(/\/settings$/);
  await page.getByRole("tab", { name: /^Setup/ }).click();
  const demoToggle = page.locator("button").filter({ hasText: "Try Demo Mode" }).first();
  await demoToggle.waitFor({ state: "attached" });
  await demoToggle.evaluate((button) => button.click());
  await page.getByRole("tab", { name: /^Chat/ }).click();
  await page.locator(".chat-lifecycle-state").filter({ hasText: "Demo Mode ready — local canned responses" }).waitFor({ state: "visible" });
  await page.goBack();
  await page.waitForURL(new RegExp(`/p/${projectId}/?$`));
  await page.getByRole("navigation", { name: `${projectName} navigation` }).getByRole("link", { name: "Chat", exact: true }).click();
  await page.waitForURL(new RegExp(`/p/${projectId}/chat$`));
  await page.getByText("Demo Mode ready", { exact: false }).first().waitFor({ state: "visible" });
  const transcript = page.getByLabel("Chat messages", { exact: true });
  const userBubbles = transcript.locator(".chat-bubble.user");
  const assistantBubbles = transcript.locator(".chat-bubble.assistant");

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    await page.getByTestId("chat-composer").getByRole("textbox").fill(prompt);
    const commandResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname.endsWith("/commands");
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    assert((await commandResponse).ok(), `Manual Send ${index + 1} was not accepted.`);
    await userBubbles.filter({ hasText: prompt }).waitFor({ state: "visible" });
    await waitForAssistantCount(page, assistantBubbles, index + 1);
  }

  await page.locator(".chat-lifecycle-state").filter({ hasText: "Demo Mode ready — local canned responses, no provider calls. Ready to send." }).waitFor({ state: "visible" });
  const userBubbleTexts = await userBubbles.allTextContents();
  const assistantBubbleTexts = await assistantBubbles.allTextContents();
  assert(userBubbleTexts.length === 2, `Expected exactly two user transcript bubbles, observed ${userBubbleTexts.length}.`);
  assert(prompts.every((prompt) => userBubbleTexts.some((text) => text.includes(prompt))), "A manual prompt was missing from the user transcript bubbles.");
  assert(assistantBubbleTexts.length === 2, `Expected exactly two canned assistant responses, observed ${assistantBubbleTexts.length}.`);
  assert(assistantBubbleTexts.every((text) => text.includes(assistantAnswer)), "A Demo Mode response did not contain the canned local answer.");
  assert(chatCommandCount === 2, `Expected exactly two manual chat commands, observed ${chatCommandCount}.`);
  assert(providerHits === 0, `Demo Mode unexpectedly made ${providerHits} provider call(s).`);
  assert(runtimeRequests.some((item) => item.path.startsWith(`/p/${projectId}/v1/`)), "No project-scoped runtime request was observed.");
  assert(!runtimeRequests.some((item) => item.method === "POST" && /^\/v1\/chats(?:\/|$)/.test(item.path)), "Manual project chat command escaped to the unscoped legacy runtime route.");
  assert(!runtimeRequests.some((item) => item.path.includes("prj_other")), "Runtime request escaped into another project scope.");

  const bridgePosts = await page.evaluate(() => window.__yetAiSmokeBridgePosts ?? []);
  const privilegedPosts = bridgePosts.filter((message) => typeof message?.type === "string" && (
    message.type === "gui.ideActionRequest"
    || message.type === "gui.applyWorkspaceEditRequest"
    || message.type.startsWith("gui.controlledAgent")
  ));
  assert(privilegedPosts.length === 0, `Browser emitted ${privilegedPosts.length} privileged IDE action(s).`);
  assert(await page.locator("main.host-browser").isVisible(), "Project chat did not remain in browser host mode.");

  await smoke.assertPrivacy();
  smoke.assertHealthy();
  const evidence = await saveVisualEvidence(page);
  console.log("GUI Demo Mode smoke passed.");
  console.log("Verified canonical /projects registration, project-scoped chat setup, exactly two manual canned responses, zero provider calls, browser-only authority, project isolation, and sanitized storage evidence.");
  console.log(`Saved sanitized visual evidence under ${path.relative(root, evidence.dir)}/.`);
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  console.error(`Runtime request tail: ${runtimeRequests.slice(-20).map((item) => `${item.method} ${item.path}`).join(", ")}`);
  if (smoke?.page) {
    console.error(`Page ${smoke.page.url()} body: ${redact((await smoke.page.locator("body").innerText().catch(() => "")).slice(0, 1200))}`);
    console.error(`Buttons: ${redact(JSON.stringify(await smoke.page.getByRole("button").allTextContents().catch(() => [])))}`);
  }
  process.exitCode = 1;
} finally {
  await smoke?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function startRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    runtimeRequests.push({ method: request.method ?? "GET", path: url.pathname });
    if (request.method === "OPTIONS") return empty(response, 204);

    if (request.method === "GET" && url.pathname === "/v1/projects") {
      return json(response, 200, { projects: registered ? [projectSummary()] : [], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" });
    }
    if (request.method === "POST" && url.pathname === "/v1/project-browser/sessions") {
      return json(response, 200, { sessionId: "demo-discovery", expiresAt: "2099-01-01T00:00:00Z", root: { handle: "opaque-demo-root", displayName: "Demo workspace", selectable: true }, cloudRequired: false, providerAccess: "direct" });
    }
    if (request.method === "POST" && url.pathname === "/v1/project-browser/sessions/demo-discovery/list") {
      return json(response, 200, { sessionId: "demo-discovery", directoryHandle: "opaque-demo-root", expiresAt: "2099-01-01T00:00:00Z", entries: [], cloudRequired: false, providerAccess: "direct" });
    }
    if (request.method === "POST" && url.pathname === "/v1/projects") {
      const body = await readJsonBody(request);
      assert(body.directoryHandle === "opaque-demo-root", "Project registration did not use the opaque discovery handle.");
      assert(!JSON.stringify(body).includes(projectRootMarker), "Project registration exposed a private path marker.");
      registered = true;
      return json(response, 200, projectSummary());
    }
    if (request.method === "GET" && url.pathname === `/v1/projects/${projectId}`) return json(response, registered ? 200 : 404, registered ? projectSummary() : { error: "not found" });
    if (request.method === "GET" && url.pathname === "/v1/ping") return json(response, 200, pingResponse());
    if (request.method === "GET" && url.pathname === "/v1/caps") return json(response, 200, capsResponse());
    if (request.method === "GET" && url.pathname === "/v1/demo-mode") return json(response, 200, demoModeResponse());
    if (request.method === "POST" && url.pathname === "/v1/demo-mode") {
      const body = await readJsonBody(request);
      demoEnabled = body.enabled === true;
      return json(response, 200, demoModeResponse());
    }
    if (request.method === "GET" && url.pathname === "/v1/models") return json(response, 200, { models: demoEnabled ? [demoModel()] : [] });
    if (request.method === "GET" && url.pathname === "/v1/providers") return json(response, 200, { providers: demoEnabled ? [demoProvider()] : [], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Demo smoke has no account login." });
    if (request.method === "POST" && /^\/v1\/providers\//.test(url.pathname)) {
      providerHits += 1;
      return json(response, 500, { error: `provider unavailable ${providerSecret}` });
    }

    const scopedBase = `/p/${projectId}/v1`;
    if (request.method === "GET" && url.pathname === `${scopedBase}/ping`) return json(response, 200, pingResponse());
    if (request.method === "GET" && url.pathname === `${scopedBase}/caps`) return json(response, 200, capsResponse());
    if (request.method === "GET" && url.pathname === `${scopedBase}/models`) return json(response, 200, { models: demoEnabled ? [demoModel()] : [] });
    if (request.method === "GET" && url.pathname === `${scopedBase}/demo-mode`) return json(response, 200, demoModeResponse());
    if (request.method === "GET" && url.pathname === `${scopedBase}/providers`) return json(response, 200, { providers: demoEnabled ? [demoProvider()] : [], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === `${scopedBase}/provider-auth/openai/status`) return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Demo smoke has no account login." });
    if (request.method === "GET" && url.pathname === `${scopedBase}/chats`) return json(response, 200, { chats: Array.from(chats.values()).map(toSummary) });
    if (request.method === "POST" && url.pathname === `${scopedBase}/chats`) {
      const item = thread(chatId, projectName, []);
      chats.set(chatId, item);
      return json(response, 200, item);
    }
    if (request.method === "GET" && url.pathname === `${scopedBase}/project-memory`) return json(response, 200, { notes: [] });
    if (request.method === "GET" && url.pathname === `${scopedBase}/agent-progress`) return json(response, 200, { snapshots: [] });
    if (request.method === "GET" && url.pathname === `${scopedBase}/chats/subscribe`) {
      subscribe(response, url.searchParams.get("chat_id") ?? chatId);
      return;
    }
    const chatGet = new RegExp(`^${scopedBase}/chats/([^/]+)$`).exec(url.pathname);
    if (request.method === "GET" && chatGet) {
      const item = chats.get(decodeURIComponent(chatGet[1]));
      return json(response, item ? 200 : 404, item ?? { error: "not found" });
    }
    const command = new RegExp(`^${scopedBase}/chats/([^/]+)/commands$`).exec(url.pathname);
    if (request.method === "POST" && command) {
      const targetChatId = decodeURIComponent(command[1]);
      const body = await readJsonBody(request);
      const item = chats.get(targetChatId);
      if (!item) return json(response, 404, { error: "chat not found" });
      if (body.type === "user_message") {
        chatCommandCount += 1;
        const content = body.payload?.content ?? "";
        item.messages.push(message(targetChatId, `user-${chatCommandCount}`, "user", content));
        setTimeout(() => addAssistantResponse(targetChatId), 50);
      }
      return json(response, 200, { accepted: true, chatId: targetChatId, requestId: body.requestId ?? `demo-request-${chatCommandCount}`, type: body.type });
    }
    return json(response, 404, { error: "not found" });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(8001, "127.0.0.1", resolve); });
  return { close: () => new Promise((resolve) => server.close(resolve)) };
}

function projectSummary() {
  return { projectId, displayName: projectName, status: "available", revision: "1", createdAt: "2026-07-29T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
}
function pingResponse() { return { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: new Date().toISOString() }; }
function capsResponse() { return { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: false, lsp: false } }; }
function demoModeResponse() { return { enabled: demoEnabled, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality." }; }
function demoModel() { return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function demoProvider() { return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
function thread(id, title, messages) { return { chatId: id, title, createdAt: "2026-07-29T00:00:00Z", updatedAt: "2026-07-29T00:00:00Z", messages }; }
function message(id, messageId, role, content) { return { chatId: id, id: messageId, role, content, createdAt: "2026-07-29T00:00:00Z", status: "complete" }; }
function toSummary(item) { return { chatId: item.chatId, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, messageCount: item.messages.length }; }

function subscribe(response, targetChatId) {
  response.writeHead(200, corsHeaders({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" }));
  const item = chats.get(targetChatId) ?? thread(targetChatId, projectName, []);
  writeSse(response, { seq: 0, type: "snapshot", chatId: targetChatId, payload: { thread: { id: targetChatId, title: item.title, messages: item.messages }, messages: item.messages, runtime: { streaming: false, waitingForResponse: false } } });
  const active = subscribers.get(targetChatId) ?? new Set();
  active.add(response);
  subscribers.set(targetChatId, active);
  const remove = () => active.delete(response);
  response.on("close", remove);
  response.on("error", remove);
}
function addAssistantResponse(targetChatId) {
  const item = chats.get(targetChatId);
  if (!item) return;
  const assistant = message(targetChatId, `assistant-${chatCommandCount}`, "assistant", assistantAnswer);
  item.messages.push(assistant);
  pushEvent(targetChatId, "stream_started", {});
  pushEvent(targetChatId, "message_added", { message: assistant });
  pushEvent(targetChatId, "stream_finished", { finishReason: "stop" });
}
function pushEvent(targetChatId, type, payload) {
  const seq = (eventSequences.get(targetChatId) ?? 0) + 1;
  eventSequences.set(targetChatId, seq);
  const event = { seq, type, chatId: targetChatId, payload };
  for (const response of subscribers.get(targetChatId) ?? []) writeSse(response, event);
}
function writeSse(response, event) { response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }

async function waitForAssistantCount(page, assistantBubbles, count) {
  await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected, { selector: ".chat-scroll-region[aria-label='Chat messages'] .chat-bubble.assistant", expected: count }, { timeout: 20_000 });
  assert(await assistantBubbles.count() === count, `Expected ${count} canned assistant response(s), observed ${await assistantBubbles.count()}.`);
}
async function saveVisualEvidence(page) {
  await mkdir(evidenceRoot, { recursive: true });
  const screenshotPath = path.join(evidenceRoot, "gui-demo-mode.png");
  const domPath = path.join(evidenceRoot, "gui-demo-mode.dom.txt");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const text = redact(await page.locator("body").innerText());
  await writeFile(domPath, text, "utf8");
  return { dir: evidenceRoot, screenshotPath, domPath };
}
async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function empty(response, status) { response.writeHead(status, corsHeaders()); response.end(); }
function json(response, status, payload) { response.writeHead(status, corsHeaders({ "content-type": "application/json; charset=utf-8" })); response.end(JSON.stringify(payload)); }
function corsHeaders(extra = {}) { return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", ...extra }; }
function redact(value) { return String(value).split(providerSecret).join("[redacted]").split(projectRootMarker).join("[redacted-private-path]").replace(/\/Users\/[^\s;]+/g, "/Users/[redacted]").replace(/sk-[A-Za-z0-9._-]+/g, "[redacted-api-key]"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
