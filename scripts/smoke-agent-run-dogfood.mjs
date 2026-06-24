import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { agentRunBuiltGuiApplyResult, agentRunBuiltGuiAssistantMessage, agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiVerificationProgress, agentRunBuiltGuiVerificationResult, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeOrigin = "http://127.0.0.1:8001";
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
const submittedRequestId = "agent-run-dogfood-request-1";
const optimisticUserMessageId = `${activeChatId}-optimistic-user-1`;
const sanitizedVerificationSummary = "Sanitized repository-check pass summary.";
const sanitizedVerificationFailureSummary = "Sanitized repository-check failure summary.";
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
let lastCommandBody;
let commandCount = 0;
let sentPrompt = "";
let abortCount = 0;
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
  lastCommandBody = undefined;
  commandCount = 0;
  sentPrompt = "";
  abortCount = 0;
  runtimeRequests.length = 0;
}

await buildGui();
await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  server = await startStaticServer(distRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });
  resetScenario();
  const page = await createSmokePage(guiBaseUrl);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Ready to send using ${fixture.modelId} through the local runtime.`, "mock model readiness", 20_000);
  await expectVisibleText(page, "Experimental Agent Run · one-step manual shell", "Agent Run panel", 20_000);
  await expectVisibleText(page, "Checkpoint status: missing", "initial missing checkpoint status", 20_000);
  await assertTracePanelCollapsed(page);
  await openTracePanel(page);
  await assertTraceEntries(page, ["Coding session trace", "Runtime refresh started", "Runtime refresh connected"], "initial trace");

  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit apply");
  await assertNoIdeAction(page, "runVerificationCommand", "before explicit verification");
  assert.equal(commandCount, 0, "chat command was sent before explicit Send");

  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult("assistant-supplied-apply-id", { message: "Uncorrelated apply result should be ignored." }));
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult("assistant-supplied-verification-id", { outputTail: "Uncorrelated verification result should be ignored." }));
  await page.waitForTimeout(150);
  await assertNoVisibleText(page, "Uncorrelated apply result should be ignored.", "uncorrelated apply result");
  await assertNoVisibleText(page, "Uncorrelated verification result should be ignored.", "uncorrelated verification result");

  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  assert.equal(commandCount, 0, "writing Agent Run goal auto-sent chat");

  await page.getByRole("button", { name: "Attach active file excerpt" }).click();
  const excerptRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "getActiveFileExcerpt");
  await dispatchHostMessage(page, {
    version: fixture.bridgeVersion,
    type: "host.ideActionResult",
    requestId: excerptRequest.requestId,
    payload: {
      status: "succeeded",
      message: "Returned one Agent Run fixture excerpt.",
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
  await expectVisibleText(page, "active file excerpt · src/agentRunFixture.ts", "fixture excerpt in context summary", 20_000);
  await assertTraceEntries(page, ["IDE action requested", "IDE action result received"], "active excerpt trace");
  assert.equal(commandCount, 0, "attaching explicit context auto-sent chat");
  await page.getByRole("button", { name: "Draft Safe edit/proposal prompt" }).click();
  sentPrompt = await firstTextareaValueContaining(page, "Safe-edit request", "safe-edit proposal prompt with explicit context");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(sentPrompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Proposed a safe edit. Review the proposal card below. It will not apply automatically.", "assistant safe edit proposal", 20_000);
  await expectVisibleText(page, "Manual state: Ready for manual apply", "Agent Run ready for apply", 20_000);
  await expectVisibleText(page, "Checkpoint status: verified", "Agent Run verified checkpoint", 20_000);
  await expectVisibleText(page, "Policy decision: ready_for_user_apply", "Agent Run policy readiness", 20_000);
  await expectVisibleText(page, "One-step model proposal", "one-step model proposal panel", 20_000);
  await assertTraceEntries(page, ["Send requested", "Send accepted", "Chat stream finished", "Edit proposal detected"], "send and response trace");
  assert.equal(commandCount, 1, `expected one explicit chat command, received ${commandCount}`);
  assert.equal(abortCount, 0, "smoke unexpectedly sent abort command");
  assert.equal(lastCommandBody?.payload?.context?.kind, "explicit_context_bundle", "send did not include explicit context bundle");
  assert.equal(lastCommandBody.payload.context.items.length, 1, `expected one explicit context item, received ${lastCommandBody.payload.context.items.length}`);
  assert.equal(lastCommandBody.payload.content, sentPrompt, "send command did not wait for explicit prompt filled before Send");
  await expectVisibleText(page, "One-shot explicit context bundle attached to the last accepted message and cleared.", "bundle clear after send", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after proposal before apply click");
  await assertNoIdeAction(page, "runVerificationCommand", "after proposal before verification click");

  await page.getByRole("button", { name: "Apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert.equal(applyRequest.payload?.requiresUserConfirmation, true, "apply request did not require user confirmation");
  assert.equal(applyRequest.payload?.cloudRequired, false, "apply request was not cloudRequired false");
  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId));
  await expectVisibleText(page, "Manual state: Ready for manual verification", "Agent Run ready for verification", 20_000);
  await expectVisibleText(page, "Apply status: applied", "Agent Run apply result", 20_000);
  await assertTraceEntries(page, ["Agent Run apply requested", "Agent Run apply result received"], "Agent Run apply lifecycle trace");
  await assertNoIdeAction(page, "runVerificationCommand", "after apply before verification click");

  await page.getByRole("button", { name: "Run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  assert.deepEqual(verificationRequest.payload, { action: "runVerificationCommand", commandId: fixture.commandId }, "verification request must contain commandId only");
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationProgress(verificationRequest.requestId));
  await expectVisibleText(page, "Verification status/result: Verification running", "Agent Run verification progress", 20_000);
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest.requestId, { outputTail: sanitizedVerificationSummary }));
  await expectVisibleText(page, "Manual state: Ready for follow-up", "Agent Run verified status", 20_000);
  await expectVisibleText(page, "Verification status/result: Verified · exit 0 · sanitized result available", "Agent Run verification result", 20_000);
  await expectVisibleText(page, "Agent Run completed after user-confirmed verification", "final Agent Run report title", 20_000);
  await assertNoVisibleText(page, "Agent Run has a user-reviewable rollback option", "successful final report should not be rollback report");
  await assertTraceEntries(page, ["Agent Run verification requested", "Agent Run verification progress received", "Agent Run completed after user-confirmed verification"], "Agent Run verification trace");

  await assertNoForbiddenBridgeActions(page);
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  assert.equal(messages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length, 1, "expected exactly one explicit apply request");
  assert.equal(messages.filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand").length, 1, "expected exactly one explicit verification request");
  const bridgeEvidence = sanitizeBridgeMessagesForEvidence(messages);

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
  assert.equal(storageText.includes(fixture.goal), false, "Agent Run goal persisted in browser storage");
  assert.equal(storageText.includes(fixture.explicitContext.selection.text), false, "Agent Run raw context persisted in browser storage");
  assertNoRawMarkers(JSON.stringify({ localStorage: pageState.localStorage, sessionStorage: pageState.sessionStorage }), "browser storage");
  assertNoRawMarkers(sanitizeDomForEvidence(pageState.body), "DOM sanitized final report evidence");
  const dogfoodReport = createSanitizedDogfoodReport({ storageText, bridgeEvidence, runtimeRequests });
  assertSanitizedDogfoodReport(dogfoodReport);
  assert.equal(dogfoodReport.flow.manualSequence.join(" > "), "context_selected > prompt_sent > proposal_reviewed > apply_clicked > apply_result_recorded > verification_clicked > verification_result_recorded");
  assert.equal(dogfoodReport.safety.networkLoopbackOnly, true);
  assert.equal(dogfoodReport.safety.noAutoApply, true);
  assert.equal(dogfoodReport.safety.noAutoVerification, true);
  assert.equal(dogfoodReport.safety.browserStorageContainsReport, false);
  assert.equal(dogfoodReport.evidence.verificationOutput, "sanitized status only");
  assertAgentRunBuiltGuiFixtureSafe({ lastCommandBody, messages: bridgeEvidence, runtimeRequests, dogfoodReport }, "Agent Run dogfood evidence");

  await page.close();
  await runMalformedProposalScenario(guiBaseUrl);
  await runMissingCheckpointScenario(guiBaseUrl);
  await runFailedVerificationScenario(guiBaseUrl);
  await runStaleResponseScenario(guiBaseUrl);

  if (failures.length > 0) {
    throw new Error(`Agent Run dogfood smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Agent Run dogfood smoke passed.");
  console.log("Verified deterministic mock-only Agent Run dogfood path through built GUI: explicit context, one explicit model proposal Send, explicit apply result, explicit verification result, sanitized safe-share report/evidence, loopback-only runtime/bridge/host, no auto-apply/auto-verification, and no browser-storage persistence.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
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

async function prepareModelProposalPage(guiBaseUrl, scenarioOverrides = {}) {
  resetScenario(scenarioOverrides);
  const page = await createSmokePage(guiBaseUrl);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Ready to send using ${fixture.modelId} through the local runtime.`, "mock model readiness", 20_000);
  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  await page.getByRole("button", { name: "Draft one-step safe-edit prompt" }).click();
  const prompt = await firstTextareaValueContaining(page, "One-step safe-edit model proposal request", "one-step model proposal prompt");
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  return { page, prompt };
}

async function prepareLegacyProposalPage(guiBaseUrl) {
  resetScenario();
  const page = await createSmokePage(guiBaseUrl);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Ready to send using ${fixture.modelId} through the local runtime.`, "mock model readiness", 20_000);
  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  await page.getByRole("button", { name: "Attach active file excerpt" }).click();
  const excerptRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "getActiveFileExcerpt");
  await dispatchHostMessage(page, {
    version: fixture.bridgeVersion,
    type: "host.ideActionResult",
    requestId: excerptRequest.requestId,
    payload: {
      status: "succeeded",
      message: "Returned one Agent Run fixture excerpt.",
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
  return { page, prompt };
}

async function runMalformedProposalScenario(guiBaseUrl) {
  const { page } = await prepareModelProposalPage(guiBaseUrl, {
    assistantMessage: agentRunBuiltGuiAssistantMessage({ id: "assistantAgentRunMalformedProposal", content: "{ \"summary\": \"Broken proposal\", \"edits\": [" }),
  });
  await expectVisibleText(page, "Edit proposal detected but rejected", "malformed proposal rejection", 20_000);
  await expectVisibleText(page, "The edit proposal JSON is not valid.", "malformed proposal diagnostic", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after malformed proposal rejection");
  await assertNoIdeAction(page, "runVerificationCommand", "after malformed proposal rejection");
  await page.close();
}

async function runMissingCheckpointScenario(guiBaseUrl) {
  const readiness = agentRunBuiltGuiCapsResponse();
  delete readiness.agentRunReadiness.checkpoint;
  delete readiness.agentRunReadiness.sandbox.checkpoint;
  readiness.agentRunReadiness.sandbox.modeStatus = "blocked";
  const { page } = await prepareModelProposalPage(guiBaseUrl, { capsResponse: readiness });
  await expectVisibleText(page, "Manual state: Checkpoint required", "missing checkpoint blocked status", 20_000);
  await expectVisibleText(page, "Proposal status: detected but checkpoint metadata is missing", "missing checkpoint proposal status", 20_000);
  await expectVisibleText(page, "Checkpoint status: missing", "missing checkpoint status", 20_000);
  await assertButtonDisabled(page, "Apply reviewed patch", "missing checkpoint apply button");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "with missing checkpoint prerequisites");
  await assertNoIdeAction(page, "runVerificationCommand", "with missing checkpoint prerequisites");
  await page.close();
}

async function runFailedVerificationScenario(guiBaseUrl) {
  const { page } = await prepareLegacyProposalPage(guiBaseUrl);
  await expectVisibleText(page, "Manual state: Ready for manual apply", "failed verification scenario ready for apply", 20_000);
  await page.getByRole("button", { name: "Apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId));
  await expectVisibleText(page, "Manual state: Ready for manual verification", "failed verification scenario ready for verification", 20_000);
  await page.getByRole("button", { name: "Run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand");
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest.requestId, { status: "failed", exitCode: 1, outputTail: sanitizedVerificationFailureSummary }));
  await expectVisibleText(page, "Manual state: Verification failed", "failed verification status", 20_000);
  await expectVisibleText(page, "Verification status/result: Verification failed · exit 1 · sanitized result available", "failed verification result", 20_000);
  await expectVisibleText(page, sanitizedVerificationFailureSummary, "failed verification sanitized output", 20_000);
  await assertButtonDisabled(page, "Run allowlisted verification", "failed verification run button");
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  assert.equal(messages.filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand").length, 1, "failed verification scenario emitted more than one verification request");
  await page.close();
}

async function runStaleResponseScenario(guiBaseUrl) {
  const { page } = await prepareModelProposalPage(guiBaseUrl, { sseChatId: "chat-stale-after-change" });
  await page.waitForTimeout(300);
  await assertNoVisibleText(page, "Proposed a safe edit.", "stale response safe edit proposal");
  await assertNoVisibleText(page, "Manual state: Ready for manual apply", "stale response Agent Run readiness");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after stale response");
  await assertNoIdeAction(page, "runVerificationCommand", "after stale response");
  await page.close();
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:agent-run-dogfood`."]);
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

async function assertTracePanelCollapsed(page) {
  const traceState = await page.getByTestId("coding-session-trace-details").evaluate((details) => ({ open: details.open, text: details.textContent ?? "" }));
  assert.equal(traceState.open, false, "coding session trace panel was not collapsed by default");
  assert.equal(traceState.text.includes("Coding session trace") && traceState.text.includes("read-only"), true, "coding session trace summary was missing read-only metadata");
  assert.equal(traceState.text.includes("Runtime refresh started"), false, "collapsed trace panel rendered entry details");
}

async function openTracePanel(page) {
  const details = page.getByTestId("coding-session-trace-details");
  if (!(await details.evaluate((node) => node.open))) {
    await details.locator("summary").click();
  }
  await expectVisibleText(page, "Read-only sanitized in-memory trace; no actions, execution, persistence, or auto-run.", "trace read-only disclaimer", 20_000);
}

async function assertTraceEntries(page, expectedTexts, description) {
  const traceText = await page.getByTestId("coding-session-trace-details").evaluate((details) => details.textContent ?? "").catch(() => "");
  for (const text of expectedTexts) {
    assert.equal(traceText.includes(text), true, `missing ${description} entry in coding session trace: ${text}`);
  }
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
  const allowed = new Set(["getActiveFileExcerpt", "runVerificationCommand"]);
  const forbiddenIdeActions = ideActions.filter((action) => !allowed.has(action));
  assert.deepEqual(forbiddenIdeActions, [], `unexpected IDE action request(s): ${forbiddenIdeActions.join(",")}`);
  assert.equal(runtimeRequests.some((request) => /git|shell|tool|exec|command-runner/i.test(request.url)), false, "runtime shell/git/tool-like endpoint was requested");
}

async function assertButtonDisabled(page, name, description) {
  const disabled = await page.getByRole("button", { name }).first().evaluate((button) => button.disabled).catch(() => false);
  assert.equal(disabled, true, `${description} was not disabled`);
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

function createSanitizedDogfoodReport({ storageText, bridgeEvidence, runtimeRequests }) {
  const applyRequests = bridgeEvidence.filter((message) => message.type === "gui.applyWorkspaceEditRequest");
  const verificationRequests = bridgeEvidence.filter((message) => message.type === "gui.ideActionRequest" && message.action === "runVerificationCommand");
  return {
    kind: "agent_run_one_step_dogfood_report",
    mode: "mock_loopback_only",
    ciStatus: "deterministic smoke evidence only",
    runMetadata: {
      commitArtifact: "local checkout",
      runtimeConnection: "browser wrapper with mocked loopback runtime",
      hostSurface: "mock VS Code bridge",
      providerKind: "mock openai-compatible category",
      modelLabel: fixture.modelId,
      screenshotEvidence: "none",
    },
    flow: {
      manualSequence: ["context_selected", "prompt_sent", "proposal_reviewed", "apply_clicked", "apply_result_recorded", "verification_clicked", "verification_result_recorded"],
      proposalResult: "detected and reviewable",
      checkpointReadiness: "verified",
      applyStatus: "applied by explicit user action",
      verificationStatus: "passed with sanitized summary",
      verificationCommandLabel: fixture.commandId,
      finalResult: "completed after user-confirmed verification",
    },
    safety: {
      networkLoopbackOnly: runtimeRequests.every((request) => request.url.startsWith("http://127.0.0.1:")),
      noAutoApply: applyRequests.length === 1,
      noAutoVerification: verificationRequests.length === 1,
      commandIdOnlyVerification: verificationRequests.every((message) => message.commandId === fixture.commandId && !message.workspaceRelativePath),
      browserStorageContainsReport: storageText.includes("agent_run_one_step_dogfood_report"),
      rawPromptsAbsent: true,
      rawFileBodiesAbsent: true,
      rawDiffsAbsent: true,
      rawVerificationOutputAbsent: true,
      secretsAbsent: true,
    },
    evidence: {
      runtimeRequestCount: runtimeRequests.length,
      bridgeMessageCount: bridgeEvidence.length,
      applyRequestCount: applyRequests.length,
      verificationRequestCount: verificationRequests.length,
      contextEvidence: "explicit active-file excerpt label only",
      proposalEvidence: "safe-edit metadata only",
      applyEvidence: "status and affected-file label only",
      verificationOutput: "sanitized status only",
    },
  };
}

function assertSanitizedDogfoodReport(report) {
  assert.equal(report.kind, "agent_run_one_step_dogfood_report");
  assert.equal(report.mode, "mock_loopback_only");
  assert.equal(report.safety.networkLoopbackOnly, true, "dogfood report found non-loopback network evidence");
  assert.equal(report.safety.commandIdOnlyVerification, true, "dogfood report found non-command-id verification evidence");
  const text = JSON.stringify(report);
  assert.equal(text.includes(fixture.userPrompt), false, "dogfood report leaked raw prompt");
  assert.equal(text.includes(fixture.explicitContext.selection.text), false, "dogfood report leaked raw file body");
  assert.equal(text.includes(fixture.safeEdit.edits[0].textReplacements[0].replacementText), false, "dogfood report leaked raw diff replacement");
  assert.equal(text.includes(fixture.verificationOutputTail), false, "dogfood report leaked raw verification output");
  assertNoRawMarkers(text, "sanitized dogfood report");
}

function sanitizeBridgeMessagesForEvidence(messages) {
  return messages.map((message) => ({ type: message?.type, requestId: message?.requestId, action: message?.payload?.action, commandId: message?.payload?.commandId }));
}

function sanitizeDomForEvidence(text) {
  return String(text)
    .replace(/raw command/gi, "[redacted command phrase]")
    .replace(/raw diff/gi, "[redacted diff phrase]")
    .replace(/\"command\"/gi, "[redacted command key]")
    .replace(/\"args\"/gi, "[redacted args key]")
    .replace(/\"cwd\"/gi, "[redacted cwd key]")
    .replace(/\"env\"/gi, "[redacted env key]");
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
  console.error(`Agent Run dogfood smoke failed: ${summary}`);
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
