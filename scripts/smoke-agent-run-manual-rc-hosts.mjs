import assert from "node:assert/strict";
import process from "node:process";
import { agentRunBuiltGuiApplyResult, agentRunBuiltGuiAssistantMessage, agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiRawMarkers, agentRunBuiltGuiVerificationProgress, agentRunBuiltGuiVerificationResult, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { agentRunBuiltGuiDistRoot, buildAgentRunBuiltGui, isAgentRunAllowedNetworkUrl, isAgentRunJsOrCssAssetRequest, isAgentRunRuntimeOriginUrl, isAgentRunStaticServerAsset, isExpectedAgentRunFetchConsoleError, messageOf, redactAgentRunUrl, requireAgentRunBuiltGui, requireAgentRunChromium, startAgentRunStaticServer } from "./lib/agent-run-built-gui-smoke-bootstrap.mjs";

const smokeName = "Agent Run manual RC host parity smoke";
const smokeCommand = "smoke:agent-run-manual-rc-hosts";
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
const submittedRequestId = "agent-run-manual-rc-request-1";
const optimisticUserMessageId = `${activeChatId}-optimistic-user-1`;
const rawMarkers = [...new Set([...agentRunBuiltGuiRawMarkers, "manual-rc-secret", "Apply in VS Code after review", "Apply in JetBrains after review"])] ;
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let commandCount = 0;
let abortCount = 0;
let lastCommandBody;
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

  await runBrowserStandaloneScenario(guiBaseUrl);
  await runVsCodeManualBoundaryScenario(guiBaseUrl);
  await runJetBrainsManualBoundaryScenario(guiBaseUrl);
  await runJetBrainsUnsupportedHostDataScenario(guiBaseUrl);

  if (failures.length > 0) {
    throw new Error(`Agent Run manual RC host parity smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Agent Run manual RC host parity smoke passed.");
  console.log("Browser parity: standalone preview renders Agent Run but apply/verification stay unavailable, no IDE bridge messages are emitted, storage remains clean, and only loopback/static mock traffic is allowed.");
  console.log("VS Code parity: explicit Send is required before proposal, apply and verification emit only existing bridge messages after explicit clicks, and payloads are GUI-minted/sanitized.");
  console.log("JetBrains parity: postIntellijMessage host mode follows the same manual Apply/Verification boundary as VS Code; runtime status is display-only metadata, and unsupported host data fails closed.");
  console.log("No real providers, credentials, hosted backend, workspace mutation, auto repair/retry/rollback/attach/search/save, or non-loopback network were used.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function runBrowserStandaloneScenario(guiBaseUrl) {
  resetScenario({ host: "browser" });
  const page = await prepareProposalPage(guiBaseUrl, { expectProposal: true });
  await expectVisibleText(page, "Browser standalone mode", "browser standalone preview card", 20_000);
  await expectVisibleText(page, "Agent Run · dev-preview, not autonomy", "browser Agent Run panel", 20_000);
  await expectVisibleText(page, "Browser preview cannot apply. Open VS Code or JetBrains for host confirmation.", "browser apply unavailable guidance", 20_000);
  await assertButtonDisabled(page, "Manually apply reviewed patch", "browser apply");
  await assertButtonDisabled(page, "Manually run allowlisted verification", "browser verification");
  await clickIfPresent(page, "Manually apply reviewed patch");
  await clickIfPresent(page, "Manually run allowlisted verification");
  await assertNoBridgeMessages(page, "browser standalone mode");
  await assertNoForbiddenEvidence(page, "browser standalone mode");
  await page.close();
}

async function runVsCodeManualBoundaryScenario(guiBaseUrl) {
  resetScenario({ host: "vscode" });
  const page = await prepareProposalPage(guiBaseUrl, { expectProposal: true });
  await expectVisibleText(page, "Manual state: Ready for manual apply", "VS Code ready manual state", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "VS Code before explicit Apply");
  await assertNoIdeAction(page, "runVerificationCommand", "VS Code before explicit Apply");
  await assertHostManualApplyAndVerification(page, "VS Code");
  await assertNoForbiddenEvidence(page, "VS Code manual boundary");
  assertAgentRunBuiltGuiFixtureSafe({ messages: await sanitizedBridgeMessages(page), runtimeRequests }, "VS Code host parity evidence");
  await page.close();
}

async function runJetBrainsManualBoundaryScenario(guiBaseUrl) {
  resetScenario({ host: "jetbrains" });
  const page = await prepareProposalPage(guiBaseUrl, { expectProposal: true });
  await dispatchHostMessage(page, hostRuntimeStatus("jetbrains"));
  await expectVisibleText(page, "JETBRAINS EXPLICIT CONTROLS", "JetBrains explicit host controls", 20_000);
  await assertBridgeLogContains(page, "Bridge host jetbrains", "JetBrains bridge log");
  await expectVisibleText(page, "Host capability metadata", "JetBrains runtime metadata title", 20_000);
  await expectVisibleText(page, "METADATA ONLY", "JetBrains runtime metadata authority", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "JetBrains before explicit Apply");
  await assertNoIdeAction(page, "runVerificationCommand", "JetBrains before explicit Apply");
  await assertHostManualApplyAndVerification(page, "JetBrains");
  await assertNoForbiddenEvidence(page, "JetBrains manual boundary");
  assertAgentRunBuiltGuiFixtureSafe({ messages: await sanitizedBridgeMessages(page), runtimeRequests }, "JetBrains host parity evidence");
  await page.close();
}

async function runJetBrainsUnsupportedHostDataScenario(guiBaseUrl) {
  resetScenario({ host: "jetbrains" });
  const page = await createSmokePage(guiBaseUrl, "jetbrains");
  await expectVisibleText(page, "Coding task session", "JetBrains unsupported host data page", 20_000);
  await dispatchRawHostMessage(page, { version: fixture.bridgeVersion, type: "host.ready", payload: { runtimeUrl: "https://example.com/", cloudRequired: false } });
  await dispatchRawHostMessage(page, hostRuntimeStatus("jetbrains", { runtimeOwner: "host_root", authority: "execute", diagnosis: "manual-rc-secret" }));
  await page.waitForTimeout(150);
  await assertBridgeLogContains(page, "Rejected invalid host bridge message", "JetBrains invalid host data rejection");
  await assertNoVisibleText(page, "manual-rc-secret", "unsupported JetBrains host data secret");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "unsupported JetBrains host data");
  await assertNoIdeAction(page, "runVerificationCommand", "unsupported JetBrains host data");
  await assertNoForbiddenEvidence(page, "unsupported JetBrains host data");
  await page.close();
}

async function prepareProposalPage(guiBaseUrl, { expectProposal = true } = {}) {
  const page = await createSmokePage(guiBaseUrl, currentScenario.host);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, "Provider/model readiness: ready", "mock model readiness", 20_000);
  await expectVisibleText(page, "Agent Run · dev-preview, not autonomy", "Agent Run panel", 20_000);
  assert.equal(commandCount, 0, "chat command was sent before explicit Send");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit Send");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit Send");

  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  await page.getByRole("button", { name: "Draft Safe edit/proposal prompt" }).click();
  const prompt = await firstTextareaValueContaining(page, "Safe-edit request", "safe-edit proposal prompt");
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  assert.equal(commandCount, 1, `expected one explicit Send command, received ${commandCount}`);
  assert.equal(lastCommandBody?.payload?.content, prompt, "explicit Send did not use the reviewed draft prompt");
  assert.equal(abortCount, 0, "smoke unexpectedly sent abort command");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after Send before Apply");
  await assertNoIdeAction(page, "runVerificationCommand", "after Send before Apply");
  if (expectProposal) {
    await expectVisibleText(page, "Manual state: Ready for manual apply", "ready for manual apply", 20_000);
  }
  await assertStorageSafe(page, "prepared proposal page", prompt);
  return page;
}

async function assertHostManualApplyAndVerification(page, hostLabel) {
  await page.getByRole("button", { name: "Manually apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assertGuiMintedRequestId(applyRequest.requestId, `${hostLabel} apply request id`);
  assert.equal(applyRequest.payload?.requiresUserConfirmation, true, `${hostLabel} apply request must require host/user confirmation`);
  assert.deepEqual(applyRequest.payload, fixture.safeEdit, `${hostLabel} apply request must contain only the reviewed safe edit`);
  await assertNoIdeAction(page, "runVerificationCommand", `${hostLabel} after Apply before host result`);

  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId));
  await expectVisibleText(page, "Manual state: Ready for manual verification", `${hostLabel} ready for manual verification`, 20_000);
  await page.getByRole("button", { name: "Manually run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  assertGuiMintedRequestId(verificationRequest.requestId, `${hostLabel} verification request id`);
  assert.deepEqual(verificationRequest.payload, { action: "runVerificationCommand", commandId: fixture.commandId }, `${hostLabel} verification request must contain commandId only`);
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationProgress(verificationRequest.requestId));
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest.requestId));
  await expectVisibleText(page, "Manual state: Ready for follow-up", `${hostLabel} ready for follow-up`, 20_000);
}

async function createSmokePage(guiBaseUrl, host) {
  const page = await browser.newPage();
  if (host === "vscode") {
    await page.addInitScript(() => {
      window.__yetAiBridgeMessages = [];
      window.__yetAiVsCodeMessages = window.__yetAiBridgeMessages;
      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          window.__yetAiBridgeMessages.push(message);
        },
      });
    });
  } else if (host === "jetbrains") {
    await page.addInitScript(() => {
      window.__yetAiBridgeMessages = [];
      window.__yetAiVsCodeMessages = window.__yetAiBridgeMessages;
      window.postIntellijMessage = (message) => {
        window.__yetAiBridgeMessages.push(message);
      };
    });
  } else {
    await page.addInitScript(() => {
      window.__yetAiBridgeMessages = [];
      window.__yetAiVsCodeMessages = window.__yetAiBridgeMessages;
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
  if (host !== "browser") {
    await waitForBridgeMessage(page, (message) => message?.type === "gui.ready");
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

function hostRuntimeStatus(surface, overrides = {}) {
  return {
    version: fixture.bridgeVersion,
    type: "host.runtimeStatus",
    payload: {
      protocolVersion: "2026-06-21",
      surface,
      lifecycle: "connected",
      runtimeOwner: "test_harness",
      launchMode: "manual",
      tokenState: "not_required",
      processState: "running",
      diagnosis: "runtime connected and host supports controlled actions",
      nextAction: "Use explicit controls when ready.",
      cloudRequired: false,
      authority: "metadata_only",
      ...overrides,
    },
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

async function waitForBridgeMessage(page, predicate) {
  await page.waitForFunction((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiBridgeMessages?.some((message) => matcher(message));
  }, predicate.toString(), { timeout: 10_000 });
  return await page.evaluate((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiBridgeMessages.find((message) => matcher(message));
  }, predicate.toString());
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
    window.dispatchEvent(new MessageEvent("message", { data: hostMessage }));
  }, message);
}

async function dispatchRawHostMessage(page, message) {
  await dispatchHostMessage(page, message);
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 8000)}`);
  }
}

async function assertNoVisibleText(page, text, description) {
  const count = await page.getByText(text, { exact: false }).count();
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
  const count = await page.evaluate((messageType) => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === messageType).length, type);
  assert.equal(count, 0, `unexpected ${type} ${label}`);
}

async function assertNoIdeAction(page, action, label) {
  const count = await page.evaluate((actionName) => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === actionName).length, action);
  assert.equal(count, 0, `unexpected ${action} ${label}`);
}

async function assertNoBridgeMessages(page, label) {
  const messages = await page.evaluate(() => window.__yetAiBridgeMessages ?? []);
  assert.deepEqual(messages, [], `${label} emitted IDE bridge messages`);
}

async function assertBridgeLogContains(page, text, label) {
  const found = await page.locator(".timeline-entry").evaluateAll((entries, expected) => entries.some((entry) => entry.textContent?.includes(expected)), text).catch(() => false);
  assert.equal(found, true, `${label} was not recorded`);
}

async function sanitizedBridgeMessages(page) {
  const messages = await page.evaluate(() => window.__yetAiBridgeMessages ?? []);
  return messages.map((message) => ({ type: message?.type, requestId: message?.requestId, action: message?.payload?.action, commandId: message?.payload?.commandId, requiresUserConfirmation: message?.payload?.requiresUserConfirmation }));
}

async function assertNoForbiddenEvidence(page, label) {
  await page.waitForTimeout(150);
  assert.equal(abortCount, 0, `${label} sent an abort command`);
  const messages = await page.evaluate(() => window.__yetAiBridgeMessages ?? []);
  const bridgeText = JSON.stringify(messages);
  assert.equal(/repair|rollback|revert|retry|attach|searchWorkspaceSnippets|save|provider/i.test(bridgeText), false, `${label} emitted broader authority bridge evidence`);
  assert.equal(runtimeRequests.some((request) => /git|shell|tool|exec|command-runner|repair|rollback|revert|provider-auth\/[^/]+\/(?:start|exchange|disconnect)|project-memory\/search/i.test(request.url)), false, `${label} requested forbidden runtime endpoint`);
  await assertStorageSafe(page, label);
}

async function assertStorageSafe(page, label, draft) {
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
  assert.equal(draft === undefined || !storageText.includes(draft), true, `${label} persisted drafted prompt in browser storage`);
  assertNoRawMarkers(storageText, `${label} browser storage`);
}

function assertGuiMintedRequestId(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, `${label} must be bounded`);
  assert.equal(/assistant|model|provider|secret|token|bearer|authorization|sk-/i.test(value), false, `${label} must not carry sensitive or assistant/provider markers`);
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
