import assert from "node:assert/strict";
import process from "node:process";
import { agentRunBuiltGuiApplyResult, agentRunBuiltGuiAssistantMessage, agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiRawMarkers, agentRunBuiltGuiVerificationProgress, agentRunBuiltGuiVerificationResult, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { agentRunBuiltGuiDistRoot, buildAgentRunBuiltGui, isAgentRunAllowedNetworkUrl, isAgentRunJsOrCssAssetRequest, isAgentRunRuntimeOriginUrl, isAgentRunStaticServerAsset, isExpectedAgentRunFetchConsoleError, messageOf, redactAgentRunUrl, requireAgentRunBuiltGui, requireAgentRunChromium, startAgentRunStaticServer } from "./lib/agent-run-built-gui-smoke-bootstrap.mjs";

const smokeName = "Multi-step task timeline smoke";
const smokeCommand = "smoke:multi-step-task-timeline";
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
const submittedRequestId = "multi-step-task-timeline-request-1";
const optimisticUserMessageId = `${activeChatId}-optimistic-user-1`;
const rawMarkers = [
  ...new Set([
    ...agentRunBuiltGuiRawMarkers,
    fixture.userPrompt,
    fixture.explicitContext.selection.text,
    fixture.safeEdit.edits[0].textReplacements[0].replacementText,
    fixture.verificationOutputTail,
    "providerPayload",
    "providerResponse",
    "browserStorage",
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
    assistantMessage: agentRunBuiltGuiAssistantMessage(),
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

await buildAgentRunBuiltGui({ smokeName, smokeCommand, redact: redactSecrets });
await requireAgentRunBuiltGui({ smokeName, failures, redact: redactSecrets });
const { chromium } = await requireAgentRunChromium({ smokeName, redact: redactSecrets });

try {
  server = await startAgentRunStaticServer(agentRunBuiltGuiDistRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });

  await runTimelineScenario(guiBaseUrl);

  if (failures.length > 0) {
    throw new Error(`${smokeName} failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Multi-step task timeline smoke passed.");
  console.log("Verified collapsed-by-default metadata-only timeline coverage for goal/context-omitted, proposal, apply, verification, fix draft, and final-result entries with no auto apply/verify, hidden memory/provider calls, non-loopback network, or raw prompt/file/diff/command/storage leakage.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function runTimelineScenario(guiBaseUrl) {
  resetScenario();
  const page = await createSmokePage(guiBaseUrl);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, "Manual timeline", "manual timeline summary", 20_000);
  await expectVisibleText(page, "metadata only", "timeline metadata-only badge", 20_000);
  await expectVisibleText(page, "no automatic execution", "timeline no-automatic-execution badge", 20_000);
  await assertTimelineCollapsed(page, "initial page load");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit user action");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit user action");
  await assertNoHiddenRuntimeCalls("initial page load");
  assert.equal(commandCount, 0, "chat command was sent before explicit user action");

  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  await page.getByRole("button", { name: "Attach active file excerpt" }).click();
  const excerptRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "getActiveFileExcerpt");
  await dispatchHostMessage(page, {
    version: fixture.bridgeVersion,
    type: "host.ideActionResult",
    requestId: excerptRequest.requestId,
    payload: {
      status: "succeeded",
      message: "Returned one timeline fixture excerpt.",
      cloudRequired: false,
      action: "getActiveFileExcerpt",
      contextAttachment: {
        kind: "active_file_excerpt",
        source: fixture.explicitContext.source,
        file: fixture.explicitContext.file,
        range: {
          start: { line: fixture.explicitContext.selection.startLine, character: fixture.explicitContext.selection.startCharacter },
          end: { line: fixture.explicitContext.selection.endLine, character: fixture.explicitContext.selection.endCharacter },
        },
        text: fixture.explicitContext.selection.text,
        truncated: false,
      },
    },
  });
  await expectVisibleText(page, "Result excerpt: src/agentRunFixture.ts", "mock active editor excerpt", 20_000);
  await page.getByRole("button", { name: "Add to multi-file context bundle" }).click();
  await page.getByRole("button", { name: "Draft Safe edit/proposal prompt" }).click();
  const prompt = await firstTextareaValueContaining(page, "Safe-edit request", "safe-edit proposal prompt");
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Manual state: Ready for manual apply", "ready for apply", 20_000);
  assert.equal(commandCount, 1, `expected one explicit Send command, received ${commandCount}`);
  assert.equal(lastCommandBody?.payload?.content, prompt, "explicit Send did not use drafted prompt");
  assert.equal(abortCount, 0, "smoke unexpectedly sent abort command");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after Send before Apply");
  await assertNoIdeAction(page, "runVerificationCommand", "after Send before Verify");

  await page.getByRole("button", { name: "Apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert.equal(applyRequest.payload?.requiresUserConfirmation, true, "apply request did not require user confirmation");
  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId));
  await expectVisibleText(page, "Manual state: Ready for manual verification", "ready for verification", 20_000);

  await page.getByRole("button", { name: "Run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  assert.deepEqual(verificationRequest.payload, { action: "runVerificationCommand", commandId: fixture.commandId }, "verification request must contain commandId only");
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationProgress(verificationRequest.requestId));
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest.requestId, { status: "failed", exitCode: 1, outputTail: "Repository fixture check failed." }));
  await expectVisibleText(page, "Manual state: Verification failed", "failed verification state", 20_000);
  await page.getByRole("button", { name: "Draft Agent Run fix prompt" }).click();
  await firstTextareaValueContaining(page, "Verification fix prompt", "failed verification fix draft");

  await assertTimelineCollapsed(page, "before manual timeline expansion");
  await page.getByTestId("multi-step-task-timeline-details").click();
  await expectVisibleText(page, "Read-only manual timeline: metadata only", "timeline read-only policy", 20_000);
  await assertTimelineExpandedCoverage(page);
  await assertNoForbiddenBridgeActions(page);
  await assertNoHiddenRuntimeCalls("after timeline expansion");
  await assertTimelineStorageSafe(page);
  const timelineEvidence = await page.getByTestId("multi-step-task-timeline-panel").innerText();
  assertNoRawMarkers(timelineEvidence, "timeline panel");
  assertAgentRunBuiltGuiFixtureSafe({ timeline: sanitizeEvidence(timelineEvidence), messages: await sanitizedMessages(page), runtimeRequests }, "multi-step timeline smoke evidence");
  await page.close();
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
    if (message.type() === "error" && !isExpectedAgentRunFetchConsoleError(text)) {
      failures.push(`Browser console error: ${redactSecrets(text)}`);
    }
  });
  page.on("pageerror", (error) => {
    assertNoRawMarkers(error.message, "page error");
    failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`);
  });
  page.on("request", (request) => {
    if (!isAgentRunAllowedNetworkUrl(request.url(), guiBaseUrl)) {
      failures.push(`Unexpected network request: ${request.method()} ${redactAgentRunUrl(request.url(), redactSecrets)}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (isAgentRunStaticServerAsset(request.url(), guiBaseUrl) && isAgentRunJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactAgentRunUrl(request.url(), redactSecrets)} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    if (isAgentRunStaticServerAsset(response.url(), guiBaseUrl) && response.status() >= 400) {
      failures.push(`Broken local asset response: ${response.status()} ${redactAgentRunUrl(response.url(), redactSecrets)}`);
    }
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (isAgentRunRuntimeOriginUrl(url)) {
      runtimeRequests.push({ method: request.method(), url: redactAgentRunUrl(url, redactSecrets) });
      const response = await mockRuntimeResponse(url, request.method(), request.postData() ?? "");
      if (!response) {
        failures.push(`Unexpected runtime request: ${request.method()} ${redactAgentRunUrl(url, redactSecrets)}`);
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unexpected local mock endpoint" }) });
        return;
      }
      await route.fulfill(response);
      return;
    }
    if (isAgentRunStaticServerAsset(url, guiBaseUrl)) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request blocked: ${request.method()} ${redactAgentRunUrl(url, redactSecrets)}`);
    await route.abort("blockedbyclient");
  });
  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await waitForGuiMessage(page, "gui.ready");
  return page;
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
  if (method === "GET" && url.pathname === "/v1/project-memory") {
    return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
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

async function firstTextareaValueContaining(page, text, description = "textarea value") {
  const matched = await page.locator("textarea").evaluateAll((textareas, expected) => textareas.find((textarea) => textarea.value.includes(expected))?.value ?? null, text);
  if (matched) {
    return matched;
  }
  const values = await page.locator("textarea").evaluateAll((textareas) => textareas.map((textarea) => textarea.value).join("\n---\n"));
  throw new Error(`Timed out waiting for ${description}. Textarea values: ${redactSecrets(values).slice(0, 2000)}`);
}

async function assertTimelineCollapsed(page, label) {
  const state = await timelineState(page);
  assert.equal(state.exists, true, `timeline panel missing during ${label}`);
  assert.equal(state.open, false, `timeline panel was not collapsed during ${label}`);
  assert.equal(state.text.includes("Manual timeline"), true, `timeline summary missing during ${label}`);
  assert.equal(state.text.includes("Goal and context"), false, `timeline groups were visible while collapsed during ${label}`);
}

async function assertTimelineExpandedCoverage(page) {
  const state = await timelineState(page);
  assert.equal(state.open, true, "timeline panel did not expand");
  const text = state.text;
  for (const expected of [
    "Manual timeline",
    "metadata only",
    "no automatic execution",
    "latest failed",
    "Goal and context",
    "Task goal ready",
    "Explicit context omitted",
    "No explicit context is attached; hidden reads remain unavailable.",
    "Task memory skipped",
    "Review and apply",
    "Proposal detected",
    "Apply requested",
    "in progress",
    "Apply completed",
    "Verification",
    "Verification requested",
    "Verification in progress",
    "Verification failed",
    "Follow-up and final",
    "Follow-up draft prepared",
    "Agent Run verification failed after user confirmation",
    "Policy: metadata_only · display only true · auto send false · auto apply false · auto verification false",
  ]) {
    assert.equal(text.includes(expected), true, `timeline omitted current UI text: ${expected}`);
  }
  assert.equal(await page.getByTestId("multi-step-task-timeline-panel").locator("button").count(), 0, "timeline exposed action buttons");
}

async function timelineState(page) {
  return await page.getByTestId("multi-step-task-timeline-panel").evaluate((panel) => {
    const details = panel.querySelector("details");
    return { exists: Boolean(details), open: Boolean(details?.open), text: panel.textContent ?? "" };
  });
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
  const allowedTypes = new Set(["gui.ready", "gui.applyWorkspaceEditRequest", "gui.ideActionRequest"]);
  const forbiddenTypes = messages.map((message) => message?.type).filter((type) => typeof type === "string" && !allowedTypes.has(type));
  assert.deepEqual(forbiddenTypes, [], `unexpected bridge message type(s): ${forbiddenTypes.join(",")}`);
  const ideActions = messages.filter((message) => message?.type === "gui.ideActionRequest").map((message) => message.payload?.action);
  const allowedIdeActions = new Set(["getActiveFileExcerpt", "runVerificationCommand"]);
  const forbiddenIdeActions = ideActions.filter((action) => !allowedIdeActions.has(action));
  assert.deepEqual(forbiddenIdeActions, [], `unexpected IDE action request(s): ${forbiddenIdeActions.join(",")}`);
  assert.equal(messages.some((message) => /repair|rollback|revert|retry|memory|provider/i.test(JSON.stringify(message))), false, "hidden memory/provider/repair-like bridge message was emitted");
}

function assertNoHiddenRuntimeCalls(label) {
  const hidden = runtimeRequests.filter((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/v1/project-memory" && request.method === "GET") {
      return false;
    }
    return /project-memory\/search|project-memory$|provider-call|chat\/completions|completions|embeddings|tools|tool|git|shell|exec|command-runner|repair|rollback|revert/i.test(`${request.method} ${url.pathname}`);
  });
  assert.deepEqual(hidden, [], `hidden memory/provider/tool runtime request(s) during ${label}: ${hidden.map((request) => `${request.method} ${request.url}`).join(", ")}`);
}

async function assertTimelineStorageSafe(page) {
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
  assert.equal(storageText.includes(fixture.goal), false, "persisted Agent Run goal in browser storage");
  assert.equal(storageText.includes(fixture.userPrompt), false, "persisted raw prompt in browser storage");
  assert.equal(storageText.includes(fixture.explicitContext.selection.text), false, "persisted raw file body in browser storage");
  assert.equal(storageText.includes(fixture.safeEdit.edits[0].textReplacements[0].replacementText), false, "persisted raw diff replacement in browser storage");
  assertNoRawMarkers(storageText, "browser storage");
}

async function sanitizedMessages(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
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

function sanitizeEvidence(value) {
  let sanitized = String(value);
  for (const marker of rawMarkers) {
    sanitized = sanitized.split(marker).join("[redacted]");
  }
  return sanitized;
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
