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
const chatId = "chat-001";
const modelId = "guided-coding-smoke-model";
const providerId = "guided-coding-smoke-provider";
const memoryNote = {
  id: "guided-memory-note-1",
  title: "Guided task memory",
  text: "Prefer explicit user review before applying guided coding task edits.",
  tags: ["guided", "smoke"],
  source: "manual",
  createdAt: "2026-06-18T12:00:00Z",
  updatedAt: "2026-06-18T12:00:00Z",
};
const activeFileText = "export function guidedAnswer() {\n  return 'old value';\n}\n";
const snippetText = "function guidedSnippet() { return 'context'; }";
const taskGoal = "Update the guided answer copy after reviewing explicit local context.";
const userPrompt = "Goal: Update the guided answer copy after reviewing explicit local context.";
const verificationTail = "Repository check passed for guided coding task smoke.";
const rawMarkers = [
  "Bearer guided-coding-raw-secret",
  "sk-guided-coding-secret-00000000",
  "authorization: bearer",
  "cookie: guided-coding",
  "raw prompt",
  "provider response raw dump",
  "/Users/Guided/private/project",
];
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let lastCommandBody;
let commandCount = 0;
let abortCount = 0;

await buildGui();
await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  server = await startStaticServer(distRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });
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
  await expectVisibleText(page, "Coding task session", "guided coding task panel", 20_000);
  await expectVisibleText(page, "Ready to send using guided-coding-smoke-model through the local runtime.", "mock model readiness", 20_000);
  await assertCodingTaskTemplatesVisible(page);
  await expectVisibleText(page, "Explicit context bundle summary", "context summary section before Send", 20_000);
  await expectVisibleText(page, "No explicit bundle items selected", "empty context summary before Send", 20_000);

  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit apply");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit verification");
  assert(commandCount === 0, "chat command was sent before explicit Send");

  await page.getByLabel("Task goal (local React state only)").fill(taskGoal);
  await page.getByRole("button", { name: "Draft ask prompt" }).click();
  await expectTextareaValue(page, taskGoal, "local guided task prompt draft");
  assert(commandCount === 0, "drafting guided task prompt auto-sent chat");

  await page.getByRole("button", { name: "Attach active file excerpt" }).click();
  const excerptRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "getActiveFileExcerpt");
  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.ideActionResult",
    requestId: excerptRequest.requestId,
    payload: {
      status: "succeeded",
      message: "Returned one guided active-file excerpt.",
      cloudRequired: false,
      action: "getActiveFileExcerpt",
      contextAttachment: {
        kind: "active_file_excerpt",
        source: "vscode",
        file: { displayPath: "src/guided.ts", workspaceRelativePath: "src/guided.ts", languageId: "typescript" },
        range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
        text: activeFileText,
        truncated: false,
      },
    },
  });
  await expectVisibleText(page, "Result excerpt: src/guided.ts", "mock active editor excerpt", 20_000);
  await page.getByRole("button", { name: "Add to multi-file context bundle" }).click();
  await expectVisibleText(page, "active file excerpt · src/guided.ts", "active excerpt in guided session summary", 20_000);

  await page.getByLabel("Literal snippet query").fill("guidedSnippet");
  await page.getByRole("button", { name: "Search project snippets" }).click();
  const snippetRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "searchWorkspaceSnippets");
  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.ideActionResult",
    requestId: snippetRequest.requestId,
    payload: {
      status: "succeeded",
      message: "Returned one guided coding snippet.",
      cloudRequired: false,
      action: "searchWorkspaceSnippets",
      queryLabel: "guidedSnippet",
      resultCount: 1,
      truncated: false,
      snippets: [{ workspaceRelativePath: "src/snippet.ts", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 43 } }, text: snippetText }],
    },
  });
  await expectVisibleText(page, "1 sanitized snippet", "snippet search result", 20_000);
  await page.locator("label", { hasText: "src/snippet.ts" }).locator("input[type='checkbox']").check();
  await page.getByRole("button", { name: "Attach selected snippets (1)" }).click();
  await expectVisibleText(page, "project snippet · src/snippet.ts", "snippet in guided session summary", 20_000);

  await page.getByLabel("Memory title").fill(memoryNote.title);
  await page.getByLabel("Tags (comma separated)").fill(memoryNote.tags.join(","));
  await page.getByLabel("Memory note text").fill(memoryNote.text);
  await page.getByRole("button", { name: "Create memory note" }).click();
  await expectVisibleText(page, `Saved local memory note ${memoryNote.title}.`, "memory create status", 20_000);
  await page.getByRole("button", { name: "Attach memory to next message" }).click();
  await expectVisibleText(page, "project memory · Guided task memory", "memory in guided session summary", 20_000);
  await expectVisibleText(page, "Memory attachments: 1", "guided memory count", 20_000);
  await expectVisibleText(page, "Explicit context bundle: 3 selected · one-shot manual include", "selected context count before Send", 20_000);
  await assertVisibleContextSummary(page, ["active file excerpt · src/guided.ts", "project snippet · src/snippet.ts", "project memory · Guided task memory"]);
  await assertNoRawText(page, [activeFileText, snippetText, memoryNote.text], "sanitized context summary before Send");
  assert(commandCount === 0, "attaching context auto-sent chat");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userPrompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Proposed a safe edit. Review the proposal card below. It will not apply automatically.", "assistant safe edit proposal", 20_000);
  await expectVisibleText(page, "Edit proposed/applied: proposal visible for review", "guided safe proposal status", 20_000);
  assert(commandCount === 1, `expected one explicit chat command, received ${commandCount}`);
  assert(abortCount === 0, "smoke unexpectedly sent abort command");
  assert(lastCommandBody?.payload?.context?.kind === "explicit_context_bundle", "send did not include explicit context bundle");
  assert(lastCommandBody.payload.context.items.length === 3, `expected exactly three explicit context items, received ${lastCommandBody.payload.context.items.length}`);
  assert(lastCommandBody.payload.context.items.some((item) => item.kind === "active_editor"), "send missed active editor context item");
  assert(lastCommandBody.payload.context.items.some((item) => item.kind === "workspace_snippet"), "send missed workspace snippet context item");
  assert(lastCommandBody.payload.context.items.some((item) => item.kind === "project_memory"), "send missed project memory context item");
  assert(lastCommandBody.payload.content === userPrompt, "send command did not wait for the explicit prompt filled before Send");
  await expectVisibleText(page, "One-shot explicit context bundle attached to the last accepted message and cleared.", "bundle clear after send", 20_000);
  await expectVisibleText(page, "Explicit context bundle: empty · add context manually if needed", "empty context summary after Send", 20_000);
  await expectVisibleText(page, "No explicit bundle items selected", "cleared context summary after Send", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after proposal before apply click");
  await assertNoIdeAction(page, "runVerificationCommand", "after proposal before verification click");

  await page.getByRole("button", { name: "Apply in VS Code after review" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert(applyRequest.payload?.requiresUserConfirmation === true, "apply request did not require user confirmation");
  assert(applyRequest.payload?.cloudRequired === false, "apply request was not cloudRequired false");
  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.applyWorkspaceEditResult",
    requestId: applyRequest.requestId,
    payload: {
      status: "applied",
      message: "Mock host applied after explicit user confirmation.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/guided.ts"],
    },
  });
  await expectVisibleText(page, "Host apply result: applied", "explicit apply result", 20_000);
  await expectVisibleText(page, "Next safe step: run verification.", "verification cue after apply", 20_000);

  await page.getByRole("button", { name: "Repository check" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.ideActionResult",
    requestId: verificationRequest.requestId,
    payload: {
      status: "succeeded",
      message: "Mock verification completed.",
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: "repository-check",
      exitCode: 0,
      durationMs: 42,
      outputTail: verificationTail,
      truncated: false,
    },
  });
  await expectVisibleText(page, verificationTail, "verification result", 20_000);
  await expectVisibleText(page, "Verification/follow-up: repository-check: succeeded", "guided verification status", 20_000);
  await page.getByRole("button", { name: "Attach verification result to next message" }).click();
  await expectVisibleText(page, "Verification/follow-up: repository-check: succeeded · attached for follow-up", "guided verification follow-up cue", 20_000);
  await expectVisibleText(page, "Use the attached verification_output from repository-check", "verification follow-up prompt cue", 20_000);

  await assertNoForbiddenBridgeActions(page);
  const pageState = await page.evaluate(() => ({
    body: document.body.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key)];
    })),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) ?? "";
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  const storageText = JSON.stringify({ localStorage: pageState.localStorage, sessionStorage: pageState.sessionStorage });
  assert(!storageText.includes(memoryNote.text) && !storageText.includes(taskGoal), "guided task memory or goal persisted in browser storage");
  assertNoRawMarkers(JSON.stringify(pageState), "DOM or browser storage");

  if (failures.length > 0) {
    throw new Error(`Guided coding task smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Guided coding task smoke passed.");
  console.log("Verified deterministic mock-only guided coding task loop: local goal, explicit context/memory/snippet attachment, one explicit mock-provider send, safe edit proposal, explicit apply result, explicit verification result attachment, no auto-send/apply/run, no browser-storage persistence, no non-loopback network, and no shell/git/tool execution.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:guided-coding-task`."]);
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
    return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-06-18T12:00:00Z" });
  }
  if (method === "GET" && url.pathname === "/v1/caps") {
    return json({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [providerSummary()], ide: { bridge: true, lsp: false, host: "vscode" } });
  }
  if (method === "GET" && url.pathname === "/v1/models") {
    return json({ models: [{ id: modelId, displayName: modelId, providerId, capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }] });
  }
  if (method === "GET" && url.pathname === "/v1/demo-mode") {
    return json(demoModeDisabledResponse());
  }
  if (method === "GET" && url.pathname === "/v1/providers") {
    return json({ providers: [providerSummary()], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "GET" && url.pathname === "/v1/provider-auth/openai/status") {
    return json({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "OpenAI account login is not available for this local mock." });
  }
  if (method === "GET" && url.pathname === "/v1/chats") {
    return json({ chats: [] });
  }
  if (method === "GET" && url.pathname === `/v1/chats/${chatId}`) {
    return json(chatThread([]));
  }
  if (method === "POST" && url.pathname === "/v1/project-memory") {
    return json(memoryNote);
  }
  if (method === "GET" && url.pathname === "/v1/project-memory") {
    return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "POST" && url.pathname === "/v1/project-memory/search") {
    return json({ queryLabel: "guided", matches: [{ note: memoryNote, scoreLabel: "exact" }], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "POST" && url.pathname === `/v1/chats/${chatId}/commands`) {
    const parsed = JSON.parse(body);
    if (parsed.type === "abort") {
      abortCount += 1;
    } else {
      commandCount += 1;
      lastCommandBody = parsed;
    }
    return json({ accepted: true, chatId, requestId: parsed.requestId, type: parsed.type });
  }
  if (method === "GET" && url.pathname === "/v1/chats/subscribe" && url.searchParams.get("chat_id") === chatId) {
    return sse([
      { seq: 0, type: "snapshot", chatId, payload: { messages: [] } },
      { seq: 1, type: "message_added", chatId, payload: { message: assistantMessage() } },
      { seq: 2, type: "stream_finished", chatId, payload: {} },
    ]);
  }
  if (method === "POST" && url.pathname === "/v1/chats") {
    return json(chatThread([]));
  }
  if (method === "GET" && url.pathname === "/v1/agent-progress") {
    return json({ cloudRequired: false, providerAccess: "direct", generatedAt: "2026-06-18T12:00:00Z", snapshots: [] });
  }
  return undefined;
}

function providerSummary() {
  return {
    id: providerId,
    kind: "openai-compatible",
    displayName: "Guided Coding Smoke Provider",
    enabled: true,
    baseUrl: "http://127.0.0.1:43210/v1",
    auth: { type: "none", configured: false },
    models: [{ id: modelId, displayName: modelId, providerId, capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function chatThread(messages) {
  return { chatId, title: "Guided coding smoke", createdAt: "2026-06-18T12:00:00Z", updatedAt: "2026-06-18T12:00:00Z", messages };
}

function assistantMessage() {
  return {
    id: "guided-assistant-proposal-1",
    chatId,
    role: "assistant",
    status: "complete",
    createdAt: "2026-06-18T12:00:01Z",
    content: JSON.stringify({
      type: "gui.applyWorkspaceEditRequest",
      version: "2026-05-15",
      payload: {
        requiresUserConfirmation: true,
        cloudRequired: false,
        summary: "Replace guided answer after explicit review.",
        edits: [{
          workspaceRelativePath: "src/guided.ts",
          textReplacements: [{
            range: { start: { line: 2, character: 9 }, end: { line: 2, character: 20 } },
            replacementText: "'new value'",
          }],
        }],
      },
    }),
  };
}

function demoModeDisabledResponse() {
  return { enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality. Configure a BYOK provider for real answers." };
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

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
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

async function assertCodingTaskTemplatesVisible(page) {
  const templateLabels = ["Ask", "Explain", "Find bug", "Suggest tests", "Safe edit/proposal", "Implementation plan", "Follow-up"];
  for (const label of templateLabels) {
    await expectVisibleText(page, `Draft ${label} prompt`, `coding task template ${label}`, 20_000);
  }
  await page.waitForFunction(() => document.body.innerText.includes("Draft Re") && document.body.innerText.includes("prompt"), undefined, { timeout: 20_000 });
}

async function assertVisibleContextSummary(page, labels) {
  for (const label of labels) {
    await expectVisibleText(page, label, `context summary ${label}`, 20_000);
  }
}

async function assertNoRawText(page, rawValues, source) {
  const panelText = await page.getByLabel("Coding task session").innerText().catch(() => "");
  for (const value of rawValues) {
    assert(value && !panelText.includes(value), `raw context body leaked in ${source}`);
  }
}

async function expectTextareaValue(page, text, description) {
  const matched = await page.locator("textarea").evaluateAll((textareas, expected) => textareas.some((textarea) => textarea.value.includes(expected)), text);
  if (!matched) {
    const values = await page.locator("textarea").evaluateAll((textareas) => textareas.map((textarea) => textarea.value).join("\n---\n"));
    throw new Error(`Timed out waiting for ${description}. Textarea values: ${redactSecrets(values).slice(0, 2000)}`);
  }
}

async function assertNoRequestsOfType(page, type, label) {
  const count = await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  assert(count === 0, `unexpected ${type} ${label}`);
}

async function assertNoIdeAction(page, action, label) {
  const count = await page.evaluate((actionName) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === actionName).length, action);
  assert(count === 0, `unexpected ${action} ${label}`);
}

async function assertNoForbiddenBridgeActions(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const ideActions = messages.filter((message) => message?.type === "gui.ideActionRequest").map((message) => message.payload?.action);
  const allowed = new Set(["getActiveFileExcerpt", "searchWorkspaceSnippets", "runVerificationCommand"]);
  const forbiddenIdeActions = ideActions.filter((action) => !allowed.has(action));
  assert(forbiddenIdeActions.length === 0, `unexpected IDE action request(s): ${forbiddenIdeActions.join(",")}`);
  assert(messages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length === 1, "expected exactly one explicit apply request");
  assert(!runtimeRequests.some((request) => /git|shell|tool|exec|command-runner/i.test(request.url)), "runtime shell/git/tool-like endpoint was requested");
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
  console.error(`Guided coding task smoke failed: ${summary}`);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
