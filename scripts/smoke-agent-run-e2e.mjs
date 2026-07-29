import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { agentRunBuiltGuiApplyResult, agentRunBuiltGuiAssistantMessage, agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiVerificationProgress, agentRunBuiltGuiVerificationResult, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { createGuiSmokeBootstrap } from "./lib/gui-smoke-bootstrap.mjs";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeOrigin = "http://127.0.0.1:8001";
const hostedReadyGeneration = "agent-run-hosted-ready-1";
const hostedProjectId = "prj_abcdefghijklmnopqrstuA";
const hostedSessionToken = "agent-run-hosted-session-token";
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
const submittedRequestId = "agent-run-e2e-request-1";
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
const smokePages = new Map();
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
  resetScenario();
  const page = await createSmokePage(chromium);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Sends go through ${fixture.modelId} (${fixture.providerId}) via the local runtime`, "mock model readiness", 20_000);
  await expectVisibleText(page, "Agent Run · dev-preview, not autonomy", "Agent Run panel", 20_000);
  await expectVisibleText(page, "Checkpoint status: missing", "initial missing checkpoint status", 20_000);
  await assertTracePanelCollapsed(page);
  await openTracePanel(page);
  await assertTraceEntries(page, ["Coding session trace", "Runtime refresh started", "Runtime refresh connected"], "initial trace");

  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "before explicit apply");
  await assertNoControlledVerification(page, "before explicit verification");
  assert.equal(commandCount, 0, "chat command was sent before explicit Send");

  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult("assistant-supplied-apply-id", { message: "Uncorrelated apply result should be ignored." }));
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult({ requestId: "assistant-supplied-verification-id" }, { outputTail: "Uncorrelated verification result should be ignored." }));
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
  await expectVisibleText(page, "1. src/agentRunFixture.ts", "fixture excerpt in controlled context summary", 20_000);
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
  await assertNoControlledVerification(page, "after proposal before verification click");

  await page.getByRole("button", { name: "Manually apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert.equal(applyRequest.payload?.requiresUserConfirmation, true, "apply request did not require user confirmation");
  assert.equal(applyRequest.payload?.cloudRequired, false, "apply request was not cloudRequired false");
  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId));
  await expectVisibleText(page, "Manual state: Ready for controlled verification", "Agent Run ready for verification", 20_000);
  await expectVisibleText(page, "Apply status: applied", "Agent Run apply result", 20_000);
  await assertTraceEntries(page, ["Agent Run apply requested", "Agent Run apply result received"], "Agent Run apply lifecycle trace");
  await assertNoControlledVerification(page, "after apply before verification click");

  await page.getByRole("button", { name: "Manually run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.controlledAgentCommandRunRequest");
  assert.equal(verificationRequest.payload?.commandId, fixture.commandId, "controlled verification request used the wrong command id");
  assert.equal(verificationRequest.payload?.requestIdMintedBy, "gui", "controlled verification request was not GUI-minted");
  assert.equal(verificationRequest.payload?.userConfirmed, true, "controlled verification request was not user-confirmed");
  for (const forbidden of ["command", "args", "cwd", "env", "shell"]) assert.equal(forbidden in verificationRequest.payload, false, `controlled verification request exposed ${forbidden}`);
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationProgress(verificationRequest));
  await expectVisibleText(page, "Verification status/result: Verification running", "Agent Run verification progress", 20_000);
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest));
  await expectVisibleText(page, "Manual state: Ready for follow-up", "Agent Run verified status", 20_000);
  await expectVisibleText(page, "Verification status/result: Verified · exit 0 · sanitized result available", "Agent Run verification result", 20_000);
  await assertNoVisibleText(page, "Agent Run has a user-reviewable rollback option", "successful final report should not be rollback report");
  await assertTraceEntries(page, ["Controlled Agent Run verification requested", "Controlled Agent Run verification running", "Agent Run completed after user-confirmed verification"], "Agent Run verification trace");

  await assertNoForbiddenBridgeActions(page);
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  assert.equal(messages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length, 1, "expected exactly one explicit apply request");
  assert.equal(messages.filter((message) => message?.type === "gui.controlledAgentCommandRunRequest").length, 1, "expected exactly one explicit controlled verification request");
  assert.equal(messages.filter((message) => message?.type === "gui.ideActionRequest" && message?.payload?.action === "runVerificationCommand").length, 0, "legacy verification request was emitted");

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
  assertAgentRunBuiltGuiFixtureSafe({ lastCommandBody, messages: sanitizeBridgeMessagesForEvidence(messages), runtimeRequests }, "Agent Run built-GUI E2E evidence");

  await closeSmokePage(page);
  await runMalformedProposalScenario(chromium);
  await runMissingCheckpointScenario(chromium);
  await runFailedVerificationScenario(chromium);
  await runStaleResponseScenario(chromium);

  if (failures.length > 0) {
    throw new Error(`Agent Run built-GUI E2E smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Agent Run built-GUI E2E smoke passed.");
  console.log("Verified successful and failed manual one-step Agent Run paths through built GUI: success, malformed proposal rejection, missing checkpoint block, failed verification stop, stale response ignore, sanitized mock-only loopback runtime/bridge/host, and no browser-storage persistence.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await Promise.all([...smokePages.values()].map((smoke) => smoke.close().catch(() => undefined)));
}

async function createSmokePage(chromium) {
  const smoke = await createGuiSmokeBootstrap({
    distRoot,
    chromium,
    entry: { mode: "hosted", route: "/vscode/hosted-chat", entryMode: "hosted_chat" },
    privacyMarkers: [hostedSessionToken, "sk-agent-run-built-gui-secret", "PRIVATE_TEMP_PATH"],
    criticalRequest: (url) => url.pathname.endsWith(".js") || url.pathname.endsWith(".css"),
  });
  const page = smoke.page;
  smokePages.set(page, smoke);
  await page.evaluate(() => { window.__yetAiVsCodeMessages = window.__yetAiSmokeBridgePosts; });
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
    if (!isRuntimeOriginUrl(url)) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request blocked: ${request.method()} ${redactUrl(url)}`);
    await route.abort("blockedbyclient");
  });
  await smoke.waitForGuiReady();
  await page.waitForTimeout(150);
  assert.equal(runtimeRequests.length, 0, "runtime request was sent before host.ready");
  await smoke.sendHostReady({
    requestId: hostedReadyGeneration,
    runtimeUrl: runtimeOrigin,
    sessionToken: hostedSessionToken,
    workspaceBinding: { state: "auto_bound", projectId: hostedProjectId, displayName: "Agent Run smoke workspace" },
  });
  await page.getByRole("button", { name: "Legacy data", exact: true }).click();
  await dispatchHostMessage(page, {
    version: fixture.bridgeVersion,
    type: "host.ready",
    requestId: hostedReadyGeneration,
    payload: { runtimeUrl: runtimeOrigin, sessionToken: hostedSessionToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("details")) details.open = details.dataset.testid !== "coding-session-trace-details";
  });
  return page;
}

async function closeSmokePage(page) {
  const smoke = smokePages.get(page);
  smokePages.delete(page);
  await smoke?.assertPrivacy();
  smoke?.assertHealthy();
  await smoke?.close();
}

async function prepareModelProposalPage(chromium, scenarioOverrides = {}) {
  resetScenario(scenarioOverrides);
  const page = await createSmokePage(chromium);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Sends go through ${fixture.modelId} (${fixture.providerId}) via the local runtime`, "mock model readiness", 20_000);
  await page.getByLabel("Task goal (local React state only)").fill(fixture.goal);
  await page.getByRole("button", { name: "Draft one-step safe-edit prompt" }).click();
  const prompt = await firstTextareaValueContaining(page, "One-step safe-edit model proposal request", "one-step model proposal prompt");
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  return { page, prompt };
}

async function prepareLegacyProposalPage(chromium) {
  resetScenario();
  const page = await createSmokePage(chromium);
  await expectVisibleText(page, "Coding task session", "coding task session", 20_000);
  await expectVisibleText(page, `Sends go through ${fixture.modelId} (${fixture.providerId}) via the local runtime`, "mock model readiness", 20_000);
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

async function runMalformedProposalScenario(chromium) {
  const { page } = await prepareModelProposalPage(chromium, {
    assistantMessage: agentRunBuiltGuiAssistantMessage({ id: "assistantAgentRunMalformedProposal", content: "{ \"summary\": \"Broken proposal\", \"edits\": [" }),
  });
  await expectVisibleText(page, "Edit proposal detected but rejected", "malformed proposal rejection", 20_000);
  await expectVisibleText(page, "The edit proposal JSON is not valid.", "malformed proposal diagnostic", 20_000);
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after malformed proposal rejection");
  await assertNoControlledVerification(page, "after malformed proposal rejection");
  await closeSmokePage(page);
}

async function runMissingCheckpointScenario(chromium) {
  const readiness = agentRunBuiltGuiCapsResponse();
  delete readiness.agentRunReadiness.checkpoint;
  delete readiness.agentRunReadiness.sandbox.checkpoint;
  readiness.agentRunReadiness.sandbox.modeStatus = "blocked";
  const { page } = await prepareModelProposalPage(chromium, { capsResponse: readiness });
  await expectVisibleText(page, "Manual state: Checkpoint required", "missing checkpoint blocked status", 20_000);
  await expectVisibleText(page, "Proposal status: detected but checkpoint metadata is missing", "missing checkpoint proposal status", 20_000);
  await expectVisibleText(page, "Checkpoint status: missing", "missing checkpoint status", 20_000);
  await assertButtonDisabled(page, "Manually apply reviewed patch", "missing checkpoint apply button");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "with missing checkpoint prerequisites");
  await assertNoControlledVerification(page, "with missing checkpoint prerequisites");
  await closeSmokePage(page);
}

async function runFailedVerificationScenario(chromium) {
  const { page } = await prepareLegacyProposalPage(chromium);
  await expectVisibleText(page, "Manual state: Ready for manual apply", "failed verification scenario ready for apply", 20_000);
  await page.getByRole("button", { name: "Manually apply reviewed patch" }).click();
  const applyRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.applyWorkspaceEditRequest");
  await dispatchHostMessage(page, agentRunBuiltGuiApplyResult(applyRequest.requestId));
  await expectVisibleText(page, "Manual state: Ready for controlled verification", "failed verification scenario ready for verification", 20_000);
  await page.getByRole("button", { name: "Manually run allowlisted verification" }).click();
  const verificationRequest = await waitForBridgeMessage(page, (message) => message?.type === "gui.controlledAgentCommandRunRequest");
  await dispatchHostMessage(page, agentRunBuiltGuiVerificationResult(verificationRequest, { status: "failed", exitCode: 1, outputTail: "Repository fixture check failed." }));
  await expectVisibleText(page, "Manual state: Verification failed", "failed verification status", 20_000);
  await expectVisibleText(page, "Verification status/result: Verification failed · exit 1 · sanitized result available", "failed verification result", 20_000);
  await expectVisibleText(page, "Repository fixture check failed.", "failed verification sanitized output", 20_000);
  await assertButtonDisabled(page, "Manually run allowlisted verification", "failed verification run button");
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  assert.equal(messages.filter((message) => message?.type === "gui.controlledAgentCommandRunRequest").length, 1, "failed verification scenario emitted more than one controlled verification request");
  await closeSmokePage(page);
}

async function runStaleResponseScenario(chromium) {
  const { page } = await prepareModelProposalPage(chromium, { sseChatId: "chat-stale-after-change" });
  await page.waitForTimeout(300);
  await assertNoVisibleText(page, "Proposed a safe edit.", "stale response safe edit proposal");
  await assertNoVisibleText(page, "Manual state: Ready for manual apply", "stale response Agent Run readiness");
  await assertNoRequestsOfType(page, "gui.applyWorkspaceEditRequest", "after stale response");
  await assertNoControlledVerification(page, "after stale response");
  await closeSmokePage(page);
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:agent-run-e2e`."]);
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
  if (method === "GET" && url.pathname === `/v1/projects/${hostedProjectId}`) {
    return json({ project: { projectId: hostedProjectId, displayName: "Agent Run smoke workspace", state: "available", archived: false } });
  }
  const projectPrefix = `/p/${hostedProjectId}`;
  const runtimePath = url.pathname.startsWith(projectPrefix) ? url.pathname.slice(projectPrefix.length) : url.pathname;
  if (method === "GET" && runtimePath === "/v1/ping") {
    return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: fixture.checkpoint.checkedAt });
  }
  if (method === "GET" && runtimePath === "/v1/caps") {
    return json(currentScenario.capsResponse);
  }
  if (method === "GET" && runtimePath === "/v1/models") {
    return json({ models: [agentRunBuiltGuiProviderSummary().models[0]] });
  }
  if (method === "GET" && runtimePath === "/v1/demo-mode") {
    return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode is disabled for this Agent Run fixture." });
  }
  if (method === "GET" && runtimePath === "/v1/providers") {
    return json({ providers: [agentRunBuiltGuiProviderSummary()], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "GET" && runtimePath === "/v1/provider-auth/openai/status") {
    return json({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "OpenAI account login is not available for this local mock." });
  }
  if (method === "GET" && runtimePath === "/v1/chats") {
    return json({ chats: [] });
  }
  if (method === "GET" && runtimePath === `/v1/chats/${activeChatId}`) {
    return json(chatThread([]));
  }
  if (method === "POST" && runtimePath === "/v1/project-memory") {
    return json({ id: "agent-run-memory-unused", title: "unused", text: "unused", tags: [], source: "manual", createdAt: fixture.checkpoint.checkedAt, updatedAt: fixture.checkpoint.checkedAt });
  }
  if (method === "GET" && runtimePath === "/v1/project-memory") {
    return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "POST" && runtimePath === "/v1/project-memory/search") {
    return json({ queryLabel: "agent-run", matches: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "POST" && runtimePath === `/v1/chats/${activeChatId}/commands`) {
    const parsed = JSON.parse(body);
    if (parsed.type === "abort") {
      abortCount += 1;
    } else {
      commandCount += 1;
      lastCommandBody = parsed;
    }
    return json({ accepted: true, chatId: activeChatId, requestId: submittedRequestId, type: parsed.type });
  }
  if (method === "GET" && runtimePath === "/v1/chats/subscribe" && url.searchParams.get("chat_id") === activeChatId) {
    return sse(sseEvents());
  }
  if (method === "POST" && runtimePath === "/v1/chats") {
    return json(chatThread([]));
  }
  if (method === "GET" && runtimePath === "/v1/agent-progress") {
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
  await page.getByRole("tab", { name: /^Debug \/ Trace/ }).click();
  const details = page.getByTestId("coding-session-trace-details");
  if (!(await details.evaluate((node) => node.open))) {
    await details.evaluate((node) => { node.open = true; });
  }
  await expectVisibleText(page, "Read-only sanitized in-memory trace; no actions, execution, persistence, or auto-run.", "trace read-only disclaimer", 20_000);
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
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

async function assertNoControlledVerification(page, label) {
  await assertNoRequestsOfType(page, "gui.controlledAgentCommandRunRequest", label);
  await assertNoIdeAction(page, "runVerificationCommand", `${label} through the legacy contract`);
}

async function assertNoForbiddenBridgeActions(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const ideActions = messages.filter((message) => message?.type === "gui.ideActionRequest").map((message) => message.payload?.action);
  const allowed = new Set(["getActiveFileExcerpt"]);
  const forbiddenIdeActions = ideActions.filter((action) => !allowed.has(action));
  assert.deepEqual(forbiddenIdeActions, [], `unexpected IDE action request(s): ${forbiddenIdeActions.join(",")}`);
  assert.equal(runtimeRequests.some((request) => /git|shell|tool|exec|command-runner/i.test(request.url)), false, "runtime shell/git/tool-like endpoint was requested");
}

async function assertButtonDisabled(page, name, description) {
  const disabled = await page.getByRole("button", { name }).first().evaluate((button) => button.disabled).catch(() => false);
  assert.equal(disabled, true, `${description} was not disabled`);
}

function isRuntimeOriginUrl(value) {
  try {
    return new URL(value).origin === runtimeOrigin;
  } catch {
    return false;
  }
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
  console.error(`Agent Run built-GUI E2E smoke failed: ${summary}`);
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
