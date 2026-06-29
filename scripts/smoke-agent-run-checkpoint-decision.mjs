import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentRunBuiltGuiApplyResult, agentRunBuiltGuiAssistantMessage, agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiRawMarkers, agentRunBuiltGuiVerificationProgress, agentRunBuiltGuiVerificationResult, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { agentRunBuiltGuiDistRoot, buildAgentRunBuiltGui, isAgentRunAllowedNetworkUrl, isAgentRunJsOrCssAssetRequest, isAgentRunRuntimeOriginUrl, isAgentRunStaticServerAsset, isExpectedAgentRunFetchConsoleError, messageOf, redactAgentRunUrl, requireAgentRunBuiltGui, requireAgentRunChromium, startAgentRunStaticServer } from "./lib/agent-run-built-gui-smoke-bootstrap.mjs";

const smokeName = "Agent Run checkpoint decision smoke";
const smokeCommand = "smoke:agent-run-checkpoint-decision";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
const submittedRequestId = "agent-run-checkpoint-decision-request-1";
const optimisticUserMessageId = `${activeChatId}-optimistic-user-1`;
const rawMarkers = [...new Set([...agentRunBuiltGuiRawMarkers, fixture.userPrompt, fixture.explicitContext.selection.text, "checkpoint-decision-replacement-marker", "checkpoint-decision-output-tail-marker", "providerPayload", "providerResponse", "browserStorage", "checkpoint-decision-secret", "private-checkpoint-path"])] ;
const renderedRawMarkers = rawMarkers.filter((marker) => !new Set(["raw diff", "raw file body", "raw command", "npm run check", "\"command\""]).has(marker));
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

  await runRollbackReviewScenario(guiBaseUrl);
  await runSeparateManualRunScenario(guiBaseUrl);
  await runContinueScenario(guiBaseUrl);
  await runStopDecisionServiceScenario();

  if (failures.length > 0) {
    throw new Error(`${smokeName} failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Agent Run checkpoint decision smoke passed.");
  console.log("Verified local/mock-only S72 manual checkpoint decisions: continue, stop, rollback review, and separate manual run metadata; rollback remains review-only; no auto send/apply/verification/repair/retry/rollback, hidden reads/search/indexing/memory attach, bridge apply/verify before explicit clicks, non-loopback network, browser-storage persistence, or raw prompt/file/diff/command/output/private-data leakage.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function runRollbackReviewScenario(guiBaseUrl) {
  resetScenario();
  const page = await prepareProposalPage(guiBaseUrl);
  await page.getByRole("button", { name: "Manually apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert.equal(applyRequest.payload?.requiresUserConfirmation, true, "manual apply must require host/user confirmation");
  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId, { status: "failed", message: "Patch could not apply cleanly.", appliedEditCount: 0 }));
  await expectVisibleText(page, "Manual checkpoint decision", "rollback checkpoint decision card", 20_000);
  await expectVisibleText(page, "Rollback review is available as a manual review-only decision; this card has no rollback execution payload.", "rollback review-only copy", 20_000);
  await expectVisibleText(page, "Recommended manual decision: review rollback", "rollback recommended decision", 20_000);
  await expectVisibleText(page, "Review rollback: recommended", "rollback recommended card", 20_000);
  await expectVisibleText(page, "No automatic rollback, continuation, apply, verification, repair, retry, chat send, context attach, file read, search, or separate run starts from this panel.", "checkpoint decision no-auto copy", 20_000);
  const beforeReviewMessages = await bridgeMessages(page);
  await page.getByRole("button", { name: "Manually review rollback" }).click();
  await expectVisibleText(page, "Rollback review is display-only in this experimental shell", "rollback review display-only note", 20_000);
  await assertNoNewBridgeMessages(page, beforeReviewMessages.length, "rollback review click");
  await assertNoForbiddenEvidence(page, "rollback review scenario");
  await assertRenderedEvidenceSafe(page, "rollback review scenario");
  await page.close();
}

async function runSeparateManualRunScenario(guiBaseUrl) {
  resetScenario();
  const page = await prepareProposalPage(guiBaseUrl);
  await clickApplyAndDispatch(page, { status: "applied", message: "Mock host applied after explicit user confirmation." });
  await page.getByRole("button", { name: "Manually run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  assert.deepEqual(verificationRequest.payload, { action: "runVerificationCommand", commandId: fixture.commandId }, "verification request must contain commandId only");
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationProgress(verificationRequest.requestId));
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest.requestId, { status: "failed", exitCode: 1, outputTail: "Repository fixture check failed." }));
  await expectVisibleText(page, "Verification failed; start a separate manual run only if the user chooses to draft follow-up work.", "separate manual run guidance", 20_000);
  await expectVisibleText(page, "Recommended manual decision: start separate manual run", "separate recommended decision", 20_000);
  await expectVisibleText(page, "Start separate manual run: recommended", "separate recommended card", 20_000);
  await expectVisibleText(page, "Start separate manual run is guidance only and creates nothing.", "separate run creates nothing copy", 20_000);
  await assertNoVisibleText(page, "New run created", "separate run creation text");
  const commandsBeforeDraft = commandCount;
  await page.getByRole("button", { name: "Draft Agent Run fix prompt" }).click();
  await firstTextareaValueContaining(page, "Verification fix prompt", "manual fix draft");
  assert.equal(commandCount, commandsBeforeDraft, "fix draft sent chat automatically");
  await assertNoForbiddenEvidence(page, "separate manual run scenario");
  await assertRenderedEvidenceSafe(page, "separate manual run scenario");
  await page.close();
}

async function runContinueScenario(guiBaseUrl) {
  resetScenario();
  const page = await prepareProposalPage(guiBaseUrl);
  await clickApplyAndDispatch(page, { status: "applied", message: "Mock host applied after explicit user confirmation." });
  await page.getByRole("button", { name: "Manually run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationProgress(verificationRequest.requestId));
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest.requestId, { status: "succeeded", exitCode: 0, outputTail: fixture.verificationOutputTail }));
  await expectVisibleText(page, "Continue in the current checkpoint is available as manual guidance after successful apply and verification metadata.", "continue checkpoint decision", 20_000);
  await expectVisibleText(page, "Recommended manual decision: continue in current checkpoint", "continue recommended decision", 20_000);
  await expectVisibleText(page, "Continue current checkpoint: recommended", "continue recommended card", 20_000);
  await expectVisibleText(page, "Continue means keep working in the current checkpoint by explicit user choice only.", "continue manual-only copy", 20_000);
  const commandsBeforeDraft = commandCount;
  await page.getByRole("button", { name: "Draft Agent Run follow-up prompt" }).click();
  await firstTextareaValueContaining(page, "Verification follow-up prompt", "manual follow-up draft");
  assert.equal(commandCount, commandsBeforeDraft, "follow-up draft sent chat automatically");
  await assertNoForbiddenEvidence(page, "continue scenario");
  await assertRenderedEvidenceSafe(page, "continue scenario");
  await page.close();
}

async function runStopDecisionServiceScenario() {
  const { imports, cleanup } = await transpileGuiServices(["services/agentRunCheckpointDecision.ts"]);
  try {
    const { buildAgentRunCheckpointDecision } = imports.get("services/agentRunCheckpointDecision.ts");
    const decision = buildAgentRunCheckpointDecision({
      host: "vscode",
      agentRun: {
        goal: { id: "goal-s72-stop", title: "Review unsafe checkpoint metadata" },
        proposal: { id: "proposal-s72-stop", summary: "Unsafe metadata must fail closed", touchedFiles: ["apps/gui/src/App.tsx"] },
        applyRequest: { requested: true, source: "assistant", requestId: "apply-s72-stop" },
        autoApply: true,
        autoRollback: true,
        rollback: { available: true, summary: "checkpoint-decision-secret private-checkpoint-path" },
      },
    });
    assert.equal(decision.status, "blocked", "unsafe decision must be blocked");
    assert.equal(decision.recommendedDecision, "stop", "unsafe decision must recommend stop");
    assert.equal(decision.displayOnly, true, "decision remains display-only");
    assert.equal(decision.hasExecutableAuthority, false, "decision must not expose executable authority");
    assert.equal(decision.canAutoContinue, false, "decision must not auto continue");
    assert.equal(decision.canAutoApply, false, "decision must not auto apply");
    assert.equal(decision.canAutoRollback, false, "decision must not auto rollback");
    assert.equal(decision.canAutoRunVerification, false, "decision must not auto verify");
    assert.equal(decision.canStartAutonomousLoop, false, "decision must not start an autonomous loop");
    assert(decision.diagnostics.map((item) => item.code).includes("assistant_authority_blocked"), "unsafe assistant authority must be diagnosed");
    assert(decision.decisionCards.some((card) => card.kind === "stop" && card.state === "recommended" && card.actionPayload === null), "stop decision must be recommended without payload");
    assertNoRawMarkers(JSON.stringify(decision), "stop decision service output");
  } finally {
    await cleanup();
  }
}

async function prepareProposalPage(guiBaseUrl) {
  const page = await createSmokePage(guiBaseUrl);
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
  assert.equal(lastCommandBody?.payload?.content, prompt, "explicit Send did not use drafted prompt");
  assert.equal(abortCount, 0, "smoke unexpectedly sent abort command");
  await expectVisibleText(page, "Manual state: Ready for manual apply", "ready for manual apply", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after Send before Apply");
  await assertNoIdeAction(page, "runVerificationCommand", "after Send before Verify");
  await assertStorageSafe(page, "prepared proposal page");
  return page;
}

async function clickApplyAndDispatch(page, resultOverrides) {
  await page.getByRole("button", { name: "Manually apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert.equal(applyRequest.payload?.requiresUserConfirmation, true, "manual apply must require host/user confirmation");
  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId, resultOverrides));
  await expectVisibleText(page, "Manual state: Ready for manual verification", "ready for manual verification", 20_000);
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
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 12000)}`);
  }
}

async function assertNoVisibleText(page, text, description) {
  const count = await page.getByText(text, { exact: false }).count();
  assert.equal(count, 0, `${description} unexpectedly rendered`);
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

async function bridgeMessages(page) {
  return await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
}

async function assertNoNewBridgeMessages(page, beforeCount, label) {
  await page.waitForTimeout(100);
  const messages = await bridgeMessages(page);
  assert.equal(messages.length, beforeCount, `${label} emitted a bridge message`);
}

async function assertNoForbiddenEvidence(page, label) {
  await page.waitForTimeout(150);
  assert.equal(abortCount, 0, `${label} sent an abort command`);
  const messages = await bridgeMessages(page);
  const forbiddenBridge = messages.filter((message) => /repair|rollbackRequest|revert|retry|attach|search|index|memory/i.test(JSON.stringify(message)));
  assert.deepEqual(forbiddenBridge, [], `${label} emitted forbidden bridge evidence`);
  const hiddenRuntime = runtimeRequests.filter((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/v1/project-memory" && request.method === "GET") {
      return false;
    }
    return /project-memory\/search|provider-call|chat\/completions|completions|embeddings|tools|tool|git|shell|exec|command-runner|repair|rollback|revert|retry|search|index/i.test(`${request.method} ${url.pathname}`);
  });
  assert.deepEqual(hiddenRuntime, [], `${label} requested hidden runtime endpoint(s)`);
  await assertStorageSafe(page, label);
}

async function assertRenderedEvidenceSafe(page, label) {
  const body = await page.locator("body").innerText();
  assertNoRenderedRawMarkers(body, `${label} rendered body`);
  const messages = await bridgeMessages(page);
  const sanitized = messages.map((message) => ({ type: message?.type, requestId: message?.requestId, action: message?.payload?.action, commandId: message?.payload?.commandId }));
  assertAgentRunBuiltGuiFixtureSafe({ messages: sanitized, runtimeRequests }, `${label} smoke evidence`);
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

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-agent-run-checkpoint-decision-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const sourcePath = queue[index];
    if (seen.has(sourcePath)) {
      continue;
    }
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = join(dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) {
        queue.push(dependency);
      }
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  const imports = new Map();
  for (const entry of entries) {
    imports.set(entry, await import(pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}

function assertNoRawMarkers(value, source) {
  const text = String(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    if (marker && text.includes(marker.toLowerCase())) {
      throw new Error(`Raw marker ${index + 1} leaked through ${source}.`);
    }
  }
}

function assertNoRenderedRawMarkers(value, source) {
  const text = String(value).toLowerCase();
  for (const [index, marker] of renderedRawMarkers.entries()) {
    if (marker && text.includes(marker.toLowerCase())) {
      throw new Error(`Rendered raw marker ${index + 1} leaked through ${source}.`);
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
