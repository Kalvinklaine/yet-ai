import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiRawMarkers, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { agentRunBuiltGuiDistRoot, buildAgentRunBuiltGui, isAgentRunAllowedNetworkUrl, isAgentRunJsOrCssAssetRequest, isAgentRunRuntimeOriginUrl, isAgentRunStaticServerAsset, isExpectedAgentRunFetchConsoleError, messageOf, redactAgentRunUrl, requireAgentRunBuiltGui, requireAgentRunChromium, startAgentRunStaticServer } from "./lib/agent-run-built-gui-smoke-bootstrap.mjs";

const smokeName = "Controlled agent workspace readiness smoke";
const smokeCommand = "smoke:controlled-agent-workspace-readiness";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const readinessFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-workspace-readiness-worktree.json");
const fixture = agentRunBuiltGuiFixture;
const activeChatId = "chat-001";
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
    "private-readiness-path",
    "controlled-readiness-secret",
    "raw prompt",
    "raw file body",
    "raw diff",
    "raw log",
  ]),
];
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let currentCapsResponse;

const readyReadiness = JSON.parse(await readFile(readinessFixturePath, "utf8"));

await buildAgentRunBuiltGui({ smokeName, smokeCommand, redact: redactSecrets });
await requireAgentRunBuiltGui({ smokeName, failures, redact: redactSecrets });
const { chromium } = await requireAgentRunChromium({ smokeName, redact: redactSecrets });

try {
  await runEvaluatorScenarios();

  server = await startAgentRunStaticServer(agentRunBuiltGuiDistRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });

  await runPanelScenario(guiBaseUrl, "disabled metadata", disabledReadiness(), async (page) => {
    await assertSummaryReady(page, "disabled", "Controlled workspace readiness is disabled.");
    await expandReadiness(page);
    await expectVisibleText(page, "Can start agent: false", "disabled start flag");
    await expectVisibleText(page, "Authority: metadata only", "disabled metadata authority");
  });

  await runPanelScenario(guiBaseUrl, "explicit opt-in display readiness", readyReadiness, async (page) => {
    await assertSummaryReady(page, "ready for future controlled mode", "Worktree readiness metadata is available but cannot start an agent");
    await expandReadiness(page);
    await expectVisibleText(page, "Cannot start an agent.", "future gated no-start copy");
    await expectVisibleText(page, "workspaceMode: worktree", "worktree metadata");
    await expectVisibleText(page, "agentStartAllowed: false", "agent start false detail");
    await expectVisibleText(page, "Can read files: false", "read false flag");
    await expectVisibleText(page, "Can write files: false", "write false flag");
    await expectVisibleText(page, "Can run commands: false", "run false flag");
    await expectVisibleText(page, "Can apply edits: false", "apply false flag");
    await expectVisibleText(page, "Can call provider: false", "provider false flag");
    await expectVisibleText(page, "Can use git: false", "git false flag");
    await expectVisibleText(page, "Can auto rollback: false", "rollback false flag");
    await assertNoButtonNamed(page, "Start Agent", "future-ready Start Agent button");
    await assertNoButtonNamed(page, "Create Worktree", "future-ready worktree creation button");
  });

  await runPanelScenario(guiBaseUrl, "missing isolation blocks readiness", readinessWith({ isolation: { ...readyReadiness.isolation, status: "not_ready" } }), async (page) => {
    await assertSummaryReady(page, "workspace not isolated", "Worktree readiness metadata is available but cannot start an agent");
    await expandReadiness(page);
    await expectVisibleText(page, "workspace_not_isolated", "isolation diagnostic");
    await expectVisibleText(page, "Can start agent: false", "blocked isolation start flag");
  });

  await runPanelScenario(guiBaseUrl, "missing checkpoint blocks readiness", readinessWith({ checkpoint: { ...readyReadiness.checkpoint, status: "missing", verified: false } }), async (page) => {
    await assertSummaryReady(page, "checkpoint required", "Worktree readiness metadata is available but cannot start an agent");
    await expandReadiness(page);
    await expectVisibleText(page, "checkpoint_required", "checkpoint diagnostic");
    await expectVisibleText(page, "Can start agent: false", "blocked checkpoint start flag");
  });

  await runPanelScenario(guiBaseUrl, "missing rollback blocks readiness", readinessWith({ rollback: { ...readyReadiness.rollback, status: "missing" } }), async (page) => {
    await assertSummaryReady(page, "rollback plan required", "Worktree readiness metadata is available but cannot start an agent");
    await expandReadiness(page);
    await expectVisibleText(page, "rollback_plan_required", "rollback diagnostic");
    await expectVisibleText(page, "Can start agent: false", "blocked rollback start flag");
  });

  await runPanelScenario(guiBaseUrl, "unsafe metadata is redacted", readinessWith({ summary: "private-readiness-path controlled-readiness-secret raw prompt", rawLog: "raw log" }), async (page) => {
    await assertSummaryReady(page, "blocked", "Controlled workspace readiness metadata is blocked. Raw payload omitted.");
    await expandReadiness(page);
    await expectVisibleText(page, "unsafe_metadata", "unsafe metadata diagnostic");
    await assertRenderedEvidenceSafe(page, "unsafe metadata scenario");
  });

  if (failures.length > 0) {
    throw new Error(`${smokeName} failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Controlled agent workspace readiness smoke passed.");
  console.log("Verified S73 local/mock readiness metadata only: safe inert default, explicit opt-in display readiness only, blocked isolation/checkpoint/rollback prerequisites, no Start Agent/worktree controls, no bridge apply/verify/read/search/rollback messages, no hidden runtime/tool/git/shell/provider endpoints, loopback-only network, clean browser storage, and no raw prompt/file/diff/command/log/private-path/secret leakage.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function runEvaluatorScenarios() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentWorkspaceReadiness.ts"]);
  try {
    const { evaluateControlledAgentWorkspaceReadiness } = imports.get("services/controlledAgentWorkspaceReadiness.ts");
    const missing = evaluateControlledAgentWorkspaceReadiness(undefined);
    assert.equal(missing.state, "disabled", "missing evaluator input starts disabled");
    assert.equal(missing.canStartAgent, false, "missing evaluator input cannot start agent");
    assert.equal(missing.canReadFiles, false, "missing evaluator input cannot read files");
    assert.equal(missing.canRunCommands, false, "missing evaluator input cannot run commands");
    assert.equal(missing.canApplyEdits, false, "missing evaluator input cannot apply edits");
    assert.equal(missing.canCallProvider, false, "missing evaluator input cannot call providers");

    const noOptIn = evaluateControlledAgentWorkspaceReadiness(readinessWith({ optIn: undefined }));
    assert.equal(noOptIn.state, "needs_user_opt_in", "missing opt-in only changes display readiness state");
    assert(noOptIn.diagnostics.some((item) => item.code === "missing_user_opt_in"), "missing opt-in diagnostic is present");
    assert.equal(noOptIn.canStartAgent, false, "missing opt-in cannot start agent");

    const ready = evaluateControlledAgentWorkspaceReadiness(readyReadiness);
    assert.equal(ready.state, "ready_for_future_controlled_mode", "future-ready fixture evaluates to display-ready");
    assert.equal(ready.canStartAgent, false, "future-ready fixture still cannot start agent");
    assert.equal(ready.canStartAutonomousLoop, false, "future-ready fixture cannot start autonomous loop");
    assertNoRawMarkers(JSON.stringify({ missing, noOptIn, ready }), "evaluator output");
  } finally {
    await cleanup();
  }
}

async function runPanelScenario(guiBaseUrl, label, readiness, assertions) {
  runtimeRequests.length = 0;
  currentCapsResponse = agentRunBuiltGuiCapsResponse({ controlledAgentWorkspaceReadiness: readiness });
  const page = await createSmokePage(guiBaseUrl);
  try {
    await expectVisibleText(page, "Controlled workspace readiness", `${label} panel`, 20_000);
    await assertions(page);
    await assertNoForbiddenEvidence(page, label);
    await assertRenderedEvidenceSafe(page, label);
  } finally {
    await page.close().catch(() => undefined);
  }
}

function disabledReadiness() {
  return readinessWith({
    workspaceMode: "none",
    optIn: undefined,
    isolation: { status: "disabled", workspaceMode: "none", hostOwned: false, workspaceLabel: "No controlled workspace", privatePathExposed: false },
    checkpoint: { status: "not_applicable", verified: false, metadataOnly: true, autoCreateAllowed: false },
    rollback: { status: "not_applicable", metadataOnly: true, autoRollbackAllowed: false, requiresUserConfirmation: true },
    summary: "Controlled workspace readiness is disabled.",
  });
}

function readinessWith(overrides) {
  return deepMerge(readyReadiness, overrides);
}

function deepMerge(base, overrides) {
  if (overrides === undefined) {
    return undefined;
  }
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return overrides;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = deepMerge(base[key], value);
    }
  }
  return merged;
}

async function assertSummaryReady(page, stateText, summaryText) {
  await expectVisibleText(page, stateText, `${stateText} summary`, 20_000);
  const state = await readinessState(page);
  assert.equal(state.open, false, "readiness details must start collapsed");
  assert.equal(state.text.includes("Controlled workspace readiness"), true, "readiness summary missing");
  assert.equal(state.text.includes(summaryText), false, "details content rendered while collapsed");
}

async function expandReadiness(page) {
  await page.getByTestId("controlled-agent-workspace-readiness-details").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='controlled-agent-workspace-readiness-details']")?.open === true, undefined, { timeout: 10_000 });
}

async function readinessState(page) {
  return await page.getByTestId("controlled-agent-workspace-readiness-panel").evaluate((panel) => {
    const details = panel.querySelector("details");
    return { open: Boolean(details?.open), text: panel.textContent ?? "" };
  });
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

async function mockRuntimeResponse(value, method) {
  const url = new URL(value);
  if (method === "GET" && url.pathname === "/v1/ping") {
    return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: fixture.checkpoint.checkedAt });
  }
  if (method === "GET" && url.pathname === "/v1/caps") {
    return json(currentCapsResponse);
  }
  if (method === "GET" && url.pathname === "/v1/models") {
    return json({ models: [agentRunBuiltGuiProviderSummary().models[0]] });
  }
  if (method === "GET" && url.pathname === "/v1/demo-mode") {
    return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode is disabled for this controlled readiness fixture." });
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
    return json({ ...agentRunBuiltGuiChatThread([]), chatId: activeChatId, messages: [] });
  }
  if (method === "POST" && url.pathname === "/v1/chats") {
    return json({ ...agentRunBuiltGuiChatThread([]), chatId: activeChatId, messages: [] });
  }
  if (method === "GET" && url.pathname === "/v1/chats/subscribe" && url.searchParams.get("chat_id") === activeChatId) {
    return sse([{ seq: 0, type: "snapshot", chatId: activeChatId, payload: { messages: [] } }]);
  }
  if (method === "GET" && url.pathname === "/v1/project-memory") {
    return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (method === "GET" && url.pathname === "/v1/agent-progress") {
    return json({ cloudRequired: false, providerAccess: "direct", generatedAt: fixture.checkpoint.checkedAt, snapshots: [] });
  }
  return undefined;
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
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 8000)}`);
  }
}

async function assertNoVisibleText(page, text, description) {
  const count = await page.getByText(text, { exact: false }).count();
  assert.equal(count, 0, `${description} unexpectedly rendered`);
}

async function assertNoButtonNamed(page, name, description) {
  const count = await page.getByRole("button", { name, exact: true }).count();
  assert.equal(count, 0, `${description} unexpectedly rendered`);
}

async function bridgeMessages(page) {
  return await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
}

async function assertNoForbiddenEvidence(page, label) {
  await page.waitForTimeout(150);
  const messages = await bridgeMessages(page);
  const forbiddenBridge = messages.filter((message) => message?.type !== "gui.ready" && /applyWorkspaceEditRequest|ideActionRequest|read|search|rollback|verify|verification|attach|provider|tool|git|shell/i.test(JSON.stringify(message)));
  assert.deepEqual(forbiddenBridge, [], `${label} emitted forbidden bridge evidence`);
  const hiddenRuntime = runtimeRequests.filter((request) => {
    const url = new URL(request.url);
    if (["/v1/ping", "/v1/caps", "/v1/models", "/v1/demo-mode", "/v1/providers", "/v1/provider-auth/openai/status", "/v1/chats", `/v1/chats/${activeChatId}`, "/v1/chats/subscribe", "/v1/project-memory", "/v1/agent-progress"].includes(url.pathname)) {
      return false;
    }
    return true;
  });
  assert.deepEqual(hiddenRuntime, [], `${label} requested hidden runtime endpoint(s)`);
  assert.equal(runtimeRequests.some((request) => /project-memory\/search|provider-call|chat\/completions|completions|embeddings|tools|tool|git|shell|exec|command-runner|repair|rollback|revert|retry|search|index/i.test(new URL(request.url).pathname)), false, `${label} requested hidden runtime authority`);
  await assertStorageSafe(page, label);
}

async function assertRenderedEvidenceSafe(page, label) {
  const body = await page.locator("body").innerText();
  assertNoRawMarkers(body, `${label} rendered body`);
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
  assert.equal(storageText.includes("controlled_agent_workspace_readiness"), false, `${label} persisted readiness payload in browser storage`);
  assert.equal(storageText.includes("Sanitized worktree readiness label"), false, `${label} persisted readiness label in browser storage`);
  assertNoRawMarkers(storageText, `${label} browser storage`);
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-readiness-smoke-ts-"));
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

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
