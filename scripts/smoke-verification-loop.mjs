import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const bridgeVersion = "2026-05-15";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeOrigin = "http://127.0.0.1:8001";
const chatId = "chat-001";
const providerId = "verification-loop-mock-provider";
const modelId = "verification-loop-mock-model";
const userPrompt = "Return one safe edit proposal for the verification loop smoke.";
const failedOutputTail = "Repository check failed: src/loop.ts line 2 expected fixed value. Sensitive details redacted.";
const succeededOutputTail = "Repository check passed after reviewed edit.";
const rawMarkers = [
  "Bearer verification-loop-secret",
  "sk-verification-loop-secret-00000000",
  "authorization: bearer",
  "cookie: verification-loop",
  "raw provider response",
  "raw prompt",
  "/Users/Verification/private/project",
  "C:\\Users\\Verification\\private\\project",
];
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let commandCount = 0;
let abortCount = 0;
let lastCommandBody;

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

  instrumentPage(page, guiBaseUrl);

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await waitForBridgeMessage(page, (message) => message?.type === "gui.ready");
  await expectVisibleText(page, "Ready to send using verification-loop-mock-model through the local runtime.", "mock model readiness", 20_000);
  await expectVisibleText(page, "Coding task session", "coding task session panel", 20_000);

  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit send/apply");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit verification");
  assert(commandCount === 0, "chat command was sent before explicit Send");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userPrompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Proposed a safe edit. Review the proposal card below. It will not apply automatically.", "assistant safe edit proposal", 20_000);
  await expectVisibleText(page, "Replace loop answer after explicit review.", "edit proposal summary", 20_000);
  assert(commandCount === 1, `expected one explicit chat command, received ${commandCount}`);
  assert(abortCount === 0, "smoke unexpectedly sent abort command");
  assert(lastCommandBody?.type === "user_message", "explicit Send did not submit a user_message command");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after proposal before apply click");
  await assertNoIdeAction(page, "runVerificationCommand", "after proposal before verification click");

  await page.getByRole("button", { name: "Apply in VS Code after review" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assertApplyRequestShape(applyRequest);
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.applyWorkspaceEditResult",
    requestId: applyRequest.requestId,
    payload: {
      status: "applied",
      message: "Mock host applied after explicit user confirmation.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/loop.ts"],
    },
  });
  await expectVisibleText(page, "Host apply result: applied", "explicit apply result", 20_000);
  await expectVisibleText(page, "Next safe step: run verification.", "verification cue after explicit apply", 20_000);
  await assertBridgeMessageCount(page, "gui.applyWorkspaceEditRequest", 1, "after explicit apply");
  await assertNoIdeAction(page, "runVerificationCommand", "after apply before verification click");

  await page.getByRole("button", { name: "Repository check" }).click();
  const failedVerificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  assertVerificationRequestShape(failedVerificationRequest, "failed verification request");
  await dispatchHostMessage(page, verificationProgressMessage(failedVerificationRequest.requestId, "failed", failedOutputTail));
  await dispatchHostMessage(page, verificationResultMessage(failedVerificationRequest.requestId, "succeeded", 1, failedOutputTail));
  await expectVisibleText(page, failedOutputTail, "failed verification output", 20_000);
  await expectVisibleText(page, "Verification: repository-check: succeeded", "failed verification session status", 20_000);
  await assertBridgeMessageCount(page, "gui.ideActionRequest", 1, "after explicit failed verification");
  assert(commandCount === 1, "verification result auto-sent chat command");

  await page.getByRole("button", { name: "Draft verification follow-up prompt" }).click();
  await expectTextareaValue(page, "Verification follow-up prompt", "manual verification follow-up prompt draft");
  await expectTextareaValue(page, "Command id: repository-check", "manual verification command id draft");
  await expectTextareaValue(page, failedOutputTail, "manual failed verification output draft");
  assert(commandCount === 1, "drafting verification follow-up prompt auto-sent chat");
  await assertBridgeMessageCount(page, "gui.applyWorkspaceEditRequest", 1, "after follow-up draft");
  await assertBridgeMessageCount(page, "gui.ideActionRequest", 1, "after follow-up draft");

  await page.getByRole("button", { name: "Attach verification result to next message" }).click();
  await expectVisibleText(page, "Verification: repository-check: succeeded · attached for follow-up", "attached failed verification status", 20_000);
  await expectVisibleText(page, "verification output · repository-check · succeeded", "attached failed verification bundle", 20_000);
  assert(commandCount === 1, "attaching verification result auto-sent chat");

  await page.getByRole("button", { name: "Repository check" }).click();
  const succeededVerificationRequest = await waitForBridgeMessageCount(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand", 2);
  assertVerificationRequestShape(succeededVerificationRequest, "succeeded verification request");
  await dispatchHostMessage(page, verificationResultMessage(succeededVerificationRequest.requestId, "succeeded", 0, succeededOutputTail));
  await expectVisibleText(page, succeededOutputTail, "succeeded verification output", 20_000);
  await expectVisibleText(page, "Verification: repository-check: succeeded", "succeeded verification session status", 20_000);
  await assertBridgeMessageCount(page, "gui.ideActionRequest", 2, "after explicit succeeded verification");
  assert(commandCount === 1, "succeeded verification result auto-sent chat command");

  await assertNoForbiddenBridgeActions(page);
  await assertStorageClean(page);

  if (failures.length > 0) {
    throw new Error(`Verification loop smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Verification loop smoke passed.");
  console.log("Verified deterministic mock-only edit→verify→follow-up loop: one explicit mock send, safe edit proposal review, explicit apply request/result, explicit allowlisted failed and succeeded verification requests/results, manual follow-up draft and one-shot attachment, no auto-run/send/fix/apply, no shell/git/tool endpoints, no non-loopback network, and no browser-storage secret persistence.");
} catch (error) {
  console.error(redactSecrets(error instanceof Error && error.stack ? error.stack : messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) await server.close().catch(() => undefined);
}

function instrumentPage(page, guiBaseUrl) {
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
  page.route("**/*", async (route) => {
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
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:verification-loop`."]);
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
    return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode disabled for verification loop smoke." });
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
  return undefined;
}

function providerSummary() {
  return {
    id: providerId,
    kind: "openai-compatible",
    displayName: "Verification Loop Mock Provider",
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
  return { chatId, title: "Verification loop smoke", createdAt: "2026-06-18T12:00:00Z", updatedAt: "2026-06-18T12:00:00Z", messages };
}

function assistantMessage() {
  return {
    id: "verification-loop-assistant-proposal-1",
    chatId,
    role: "assistant",
    status: "complete",
    createdAt: "2026-06-18T12:00:01Z",
    content: JSON.stringify({
      type: "gui.applyWorkspaceEditRequest",
      version: bridgeVersion,
      payload: {
        requiresUserConfirmation: true,
        cloudRequired: false,
        summary: "Replace loop answer after explicit review.",
        edits: [{
          workspaceRelativePath: "src/loop.ts",
          textReplacements: [{
            range: { start: { line: 1, character: 9 }, end: { line: 1, character: 20 } },
            replacementText: "'fixed value'",
          }],
        }],
      },
    }),
  };
}

function verificationProgressMessage(requestId, status, outputTail) {
  return {
    version: bridgeVersion,
    type: "host.ideActionProgress",
    requestId,
    payload: {
      phase: "completed",
      status,
      summary: `Mock verification ${status}: ${outputTail}`,
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: "repository-check",
    },
  };
}

function verificationResultMessage(requestId, status, exitCode, outputTail) {
  return {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId,
    payload: {
      status,
      message: `Mock verification ${status}.`,
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: "repository-check",
      exitCode,
      durationMs: 42,
      outputTail,
      truncated: false,
    },
  };
}

function assertApplyRequestShape(message) {
  assert(message?.version === bridgeVersion, "apply request had unexpected bridge version");
  assert(message?.type === "gui.applyWorkspaceEditRequest", "apply request had unexpected type");
  assert(typeof message.requestId === "string" && message.requestId.length > 0, "apply request missed requestId");
  assert(message.payload?.requiresUserConfirmation === true, "apply request did not require user confirmation");
  assert(message.payload?.cloudRequired === false, "apply request was not cloudRequired false");
  assert(Array.isArray(message.payload?.edits) && message.payload.edits.length === 1, "apply request did not contain one bounded edit");
  assert(message.payload.edits[0]?.workspaceRelativePath === "src/loop.ts", "apply request targeted unexpected file");
}

function assertVerificationRequestShape(message, label) {
  assert(message?.version === bridgeVersion, `${label} had unexpected bridge version`);
  assert(message?.type === "gui.ideActionRequest", `${label} had unexpected type`);
  assert(typeof message.requestId === "string" && message.requestId.length > 0, `${label} missed requestId`);
  assert(message.payload?.action === "runVerificationCommand", `${label} was not a verification command`);
  assert(message.payload?.commandId === "repository-check", `${label} used unexpected command id`);
  assert(!("command" in message.payload), `${label} leaked command text`);
  assert(!("cwd" in message.payload), `${label} leaked cwd`);
  assert(!("env" in message.payload), `${label} leaked env`);
  assert(!("shell" in message.payload), `${label} leaked shell`);
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function sse(events) {
  return { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") };
}

async function waitForBridgeMessage(page, predicate) {
  return waitForBridgeMessageCount(page, predicate, 1);
}

async function waitForBridgeMessageCount(page, predicate, count) {
  await page.waitForFunction(({ predicateText, expected }) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return (window.__yetAiVsCodeMessages ?? []).filter((message) => matcher(message)).length >= expected;
  }, { predicateText: predicate.toString(), expected: count }, { timeout: 10_000 });
  return page.evaluate(({ predicateText, expected }) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return (window.__yetAiVsCodeMessages ?? []).filter((message) => matcher(message))[expected - 1];
  }, { predicateText: predicate.toString(), expected: count });
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

async function expectTextareaValue(page, text, description) {
  const matched = await page.locator("textarea").evaluateAll((textareas, expected) => textareas.some((textarea) => textarea.value.includes(expected)), text);
  if (!matched) {
    const values = await page.locator("textarea").evaluateAll((textareas) => textareas.map((textarea) => textarea.value).join("\n---\n"));
    throw new Error(`Timed out waiting for ${description}. Textarea values: ${redactSecrets(values).slice(0, 2000)}`);
  }
}

async function assertNoRequestsOfType(page, type, label) {
  const count = await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  assert(count === 0, `unexpected  `);
}

async function assertBridgeMessageCount(page, type, expected, label) {
  const count = await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  assert(count === expected, `expected   message(s) , found `);
}

async function assertNoIdeAction(page, action, label) {
  const count = await page.evaluate((actionName) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === actionName).length, action);
  assert(count === 0, `unexpected  `);
}

async function assertNoForbiddenBridgeActions(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const ideActions = messages.filter((message) => message?.type === "gui.ideActionRequest").map((message) => message.payload?.action);
  const allowed = new Set(["runVerificationCommand"]);
  const forbiddenIdeActions = ideActions.filter((action) => !allowed.has(action));
  assert(forbiddenIdeActions.length === 0, `unexpected IDE action request(s): ${forbiddenIdeActions.join(",")}`);
  assert(messages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length === 1, "expected exactly one explicit apply request");
  assert(messages.filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand").length === 2, "expected exactly two explicit verification requests");
  assert(!runtimeRequests.some((request) => /git|shell|tool|exec|command-runner/i.test(request.url)), "runtime shell/git/tool-like endpoint was requested");
}

async function assertStorageClean(page) {
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
  for (const fragment of ["src/loop.ts", "fixed value", "textReplacements", "workspaceRelativePath", "replacementText", failedOutputTail, succeededOutputTail, userPrompt]) {
    if (storageText.includes(fragment)) {
      failures.push(`Browser storage leaked verification loop fragment: ${fragment}.`);
    }
  }
  assertNoRawMarkers(JSON.stringify(state), "DOM, bridge messages, or browser storage");
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
    .replace(/\/Users\/[^\n]+/g, "/Users/[redacted]")
    .replace(/C:\\Users\\[^\n]+/g, "C:\\Users\\[redacted]");
}

function failActionable(summary, lines) {
  console.error(`Verification loop smoke failed: ${summary}`);
  for (const line of lines) {
    if (line) console.error(redactSecrets(line));
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
