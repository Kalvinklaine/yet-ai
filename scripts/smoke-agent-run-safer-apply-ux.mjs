import assert from "node:assert/strict";
import process from "node:process";
import { agentRunBuiltGuiAssistantMessage, agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiRawMarkers, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { agentRunBuiltGuiDistRoot, buildAgentRunBuiltGui, isAgentRunAllowedNetworkUrl, isAgentRunJsOrCssAssetRequest, isAgentRunRuntimeOriginUrl, isAgentRunStaticServerAsset, isExpectedAgentRunFetchConsoleError, messageOf, redactAgentRunUrl, requireAgentRunBuiltGui, requireAgentRunChromium, startAgentRunStaticServer } from "./lib/agent-run-built-gui-smoke-bootstrap.mjs";

const smokeName = "Agent Run safer apply UX smoke";
const smokeCommand = "smoke:agent-run-safer-apply-ux";
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
const submittedRequestId = "agent-run-safer-apply-request-1";
const optimisticUserMessageId = `${activeChatId}-optimistic-user-1`;
const unsafeCheckpointLabel = "Unsafe checkpoint label [redacted]";
const rawMarkers = [...new Set([...agentRunBuiltGuiRawMarkers, "agent-run-safer-secret", "unsafe-private-path-marker", "Apply in VS Code after review"])] ;
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let commandCount = 0;
let abortCount = 0;
let currentScenario = scenario();

function scenario(overrides = {}) {
  return {
    capsResponse: agentRunBuiltGuiCapsResponse(),
    assistantMessage: agentRunBuiltGuiAssistantMessage(),
    host: "vscode",
    ...overrides,
  };
}

function resetScenario(overrides = {}) {
  currentScenario = scenario(overrides);
  commandCount = 0;
  abortCount = 0;
  runtimeRequests.length = 0;
}

await buildAgentRunBuiltGui({ smokeName, smokeCommand, redact: redactSecrets });
await requireAgentRunBuiltGui({ smokeName, failures, redact: redactSecrets });
const { chromium } = await requireAgentRunChromium({ smokeName, redact: redactSecrets });

try {
  server = await startAgentRunStaticServer(agentRunBuiltGuiDistRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });

  await runReadyManualApplyScenario(guiBaseUrl);
  await runBrowserPreviewBlockedScenario(guiBaseUrl);
  await runRejectedProposalScenario(guiBaseUrl);
  await runUnsafeNoLeakScenario(guiBaseUrl);

  if (failures.length > 0) {
    throw new Error(`Agent Run safer apply UX smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Agent Run safer apply UX smoke passed.");
  console.log("Verified local/mock-only S68 apply review UX: ready, blocked, browser-preview, rejected, unsafe/no-leak states; no apply/verify/repair/rollback/attach/persistence before explicit user action.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function runReadyManualApplyScenario(guiBaseUrl) {
  resetScenario();
  const page = await prepareProposalPage(guiBaseUrl);
  await expectVisibleText(page, "Manual state: Ready for manual apply", "ready manual apply state", 20_000);
  await expectVisibleText(page, "Apply readiness and risk", "apply readiness card", 20_000);
  await expectVisibleText(page, "manual apply only", "manual apply badge", 20_000);
  await expectVisibleText(page, "sanitized metadata", "sanitized metadata badge", 20_000);
  await expectVisibleText(page, "File labels: src/agentRunFixture.ts", "safe file label", 20_000);
  await expectVisibleText(page, "Review the listed workspace-relative files, then use the IDE confirmation dialog if you choose to apply.", "ready guidance", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit Agent Run apply click");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit Agent Run apply click");
  await assertNoForbiddenEvidence(page, "ready before click");

  await page.getByRole("button", { name: "Manually apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert.equal(applyRequest.payload?.requiresUserConfirmation, true, "manual apply request must require host/user confirmation");
  assert.deepEqual(applyRequest.payload, fixture.safeEdit, "manual apply request must reuse the reviewed safe-edit payload only");
  await assertNoIdeAction(page, "runVerificationCommand", "after apply before verification click");
  assertAgentRunBuiltGuiFixtureSafe({ messages: await sanitizedBridgeMessages(page), runtimeRequests }, "ready safer apply smoke evidence");
  await page.close();
}

async function runBrowserPreviewBlockedScenario(guiBaseUrl) {
  resetScenario({ host: "browser" });
  const page = await prepareProposalPage(guiBaseUrl);
  await expectVisibleText(page, "Browser standalone mode", "browser standalone card", 20_000);
  await expectVisibleText(page, "Apply readiness and risk", "browser apply readiness card", 20_000);
  await expectVisibleText(page, "browser preview only", "browser preview apply badge", 20_000);
  await expectVisibleText(page, "Browser preview cannot apply. Open VS Code or JetBrains for host confirmation.", "browser blocked apply guidance", 20_000);
  await assertButtonDisabled(page, "Manually apply reviewed patch", "browser Agent Run apply");
  await clickIfPresent(page, "Manually apply reviewed patch");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "browser preview after click attempt");
  await assertNoIdeAction(page, "runVerificationCommand", "browser preview");
  await assertNoForbiddenEvidence(page, "browser preview");
  await page.close();
}

async function runRejectedProposalScenario(guiBaseUrl) {
  resetScenario({ assistantMessage: agentRunBuiltGuiAssistantMessage({ content: "{\"requiresUserConfirmation\": true, \"edits\": [" }) });
  const page = await prepareProposalPage(guiBaseUrl, { expectProposal: false });
  await expectVisibleText(page, "Edit proposal detected but rejected", "rejected proposal card", 20_000);
  await expectVisibleText(page, "Apply is unavailable because this response did not pass safe-edit proposal validation.", "rejected apply unavailable guidance", 20_000);
  await expectVisibleText(page, "Proposal format needs correction.", "rejected recovery guidance", 20_000);
  await expectVisibleText(page, "Ask for one strict safe-edit JSON proposal", "rejected next step guidance", 20_000);
  await assertButtonDisabled(page, "Manually apply reviewed patch", "Agent Run apply for rejected proposal");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "rejected proposal");
  await assertNoIdeAction(page, "runVerificationCommand", "rejected proposal");
  await assertNoForbiddenEvidence(page, "rejected proposal");
  await page.close();
}

async function runUnsafeNoLeakScenario(guiBaseUrl) {
  const unsafeProposal = {
    requiresUserConfirmation: true,
    summary: "Unsafe path marker must stay hidden.",
    cloudRequired: false,
    edits: [{
      workspaceRelativePath: "/Users/unsafe-private-path-marker/agent-run-safer-secret.ts",
      textReplacements: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, replacementText: "safe" }],
    }],
  };
  resetScenario({ assistantMessage: agentRunBuiltGuiAssistantMessage({ content: JSON.stringify(unsafeProposal) }) });
  const page = await prepareProposalPage(guiBaseUrl, { expectProposal: false });
  await expectVisibleText(page, "Edit proposal detected but rejected", "unsafe rejected proposal card", 20_000);
  await expectVisibleText(page, "Edit proposal detected but rejected", "unsafe rejected proposal guidance", 20_000);
  await expectVisibleText(page, "No apply request is available for this response.", "unsafe no apply guidance", 20_000);
  await assertButtonDisabled(page, "Manually apply reviewed patch", "unsafe Agent Run apply");
  await assertNoVisibleText(page, "agent-run-safer-secret", "unsafe secret marker");
  await assertNoVisibleText(page, "unsafe-private-path-marker", "unsafe private path marker");
  await assertNoVisibleText(page, "/Users/", "unsafe absolute path marker");
  await assertStorageSafe(page, "unsafe safer apply");
  await clickIfPresent(page, "Manually apply reviewed patch");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "unsafe metadata after click attempt");
  await assertNoIdeAction(page, "runVerificationCommand", "unsafe metadata");
  await assertNoForbiddenEvidence(page, "unsafe metadata");
  await page.close();
}

async function prepareProposalPage(guiBaseUrl, { expectProposal = true } = {}) {
  const page = await createSmokePage(guiBaseUrl, currentScenario.host);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Ready to send using ${fixture.modelId} through the local runtime.`, "mock model readiness", 20_000);
  await expectVisibleText(page, "Agent Run · dev-preview, not autonomy", "Agent Run panel", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit Send");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit Send");
  assert.equal(commandCount, 0, "chat command was sent before explicit Send");

  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  await page.getByRole("button", { name: "Draft Safe edit/proposal prompt" }).click();
  const prompt = await firstTextareaValueContaining(page, "Safe-edit request", "safe-edit proposal prompt");
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  assert.equal(commandCount, 1, `expected one explicit Send command, received ${commandCount}`);
  assert.equal(abortCount, 0, "smoke unexpectedly sent abort command");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after Send before apply review");
  await assertNoIdeAction(page, "runVerificationCommand", "after Send before apply review");
  if (expectProposal) {
    await expectVisibleText(page, "Manual state: Ready for manual apply", "ready for manual apply", 20_000);
  }
  await assertStorageSafe(page, "prepared proposal page");
  return page;
}

async function createSmokePage(guiBaseUrl, host) {
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
  } else {
    await page.addInitScript(() => {
      window.__yetAiVsCodeMessages = [];
    });
  }
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
  if (host === "vscode") {
    await waitForGuiMessage(page, "gui.ready");
  }
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
    { seq: 0, type: "snapshot", chatId: activeChatId, payload: { messages: [] } },
    { seq: 1, type: "message_added", chatId: activeChatId, payload: { message: normalizeChatMessage(currentScenario.assistantMessage, activeChatId) } },
    { seq: 2, type: "stream_finished", chatId: activeChatId, payload: {} },
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

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 12000)}`);
  }
}

async function assertNoVisibleText(page, text, description) {
  const count = await page.getByText(text, { exact: false }).count();
  assert.equal(count, 0, `${description} unexpectedly rendered`);
}

async function expectNoButton(page, name, description) {
  const count = await page.getByRole("button", { name }).count();
  assert.equal(count, 0, `${description} unexpectedly rendered`);
}

async function assertButtonDisabled(page, name, description) {
  const button = page.getByRole("button", { name }).first();
  await button.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await button.isDisabled(), true, `${description} button was enabled`);
}

async function clickIfPresent(page, name) {
  const button = page.getByRole("button", { name }).first();
  if (await button.count()) {
    await button.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(100);
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

async function assertNoRequestsOfType(page, type, label) {
  const count = await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  assert.equal(count, 0, `unexpected ${type} ${label}`);
}

async function assertNoIdeAction(page, action, label) {
  const count = await page.evaluate((actionName) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === actionName).length, action);
  assert.equal(count, 0, `unexpected ${action} ${label}`);
}

async function assertNoForbiddenEvidence(page, label) {
  await page.waitForTimeout(150);
  assert.equal(abortCount, 0, `${label} sent an abort command`);
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  assert.equal(messages.some((message) => /repair|rollback|revert|retry|attach/i.test(JSON.stringify(message))), false, `${label} emitted repair/rollback/retry/attach evidence`);
  assert.equal(runtimeRequests.some((request) => /git|shell|tool|exec|command-runner|repair|rollback|revert|attach/i.test(request.url)), false, `${label} requested forbidden runtime endpoint`);
  await assertStorageSafe(page, label);
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
  assert.equal(storageText.includes(fixture.safeEdit.edits[0].textReplacements[0].replacementText), false, `${label} persisted raw diff replacement in browser storage`);
  assertNoRawMarkers(storageText, `${label} browser storage`);
}

async function sanitizedBridgeMessages(page) {
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
