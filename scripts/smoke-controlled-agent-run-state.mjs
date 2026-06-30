import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiRawMarkers, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";
import { agentRunBuiltGuiDistRoot, buildAgentRunBuiltGui, isAgentRunAllowedNetworkUrl, isAgentRunJsOrCssAssetRequest, isAgentRunRuntimeOriginUrl, isAgentRunStaticServerAsset, isExpectedAgentRunFetchConsoleError, messageOf, redactAgentRunUrl, requireAgentRunBuiltGui, requireAgentRunChromium, startAgentRunStaticServer } from "./lib/agent-run-built-gui-smoke-bootstrap.mjs";

const smokeName = "Controlled agent run state smoke";
const smokeCommand = "smoke:controlled-agent-run-state";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const readinessFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-workspace-readiness-worktree.json");
const fileReadFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-file-read-success.json");
const commandRunningFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-command-runner-running.json");
const commandSucceededFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-command-runner-succeeded.json");
const fixtureTime = "2026-06-30T00:00:00Z";
const activeChatId = "chat-controlled-run-state";
const unsafeSecret = "controlled-run-state-secret-should-not-render";
const unsafePrivatePath = "/Users/private/controlled-run-state";
const unsafeRawPrompt = "raw prompt from controlled run state smoke";
const rawMarkers = [
  ...new Set([
    unsafeSecret,
    unsafePrivatePath,
    unsafeRawPrompt,
    "raw command from controlled run state smoke",
    "raw file body from controlled run state smoke",
    "providerPayloadControlledRunState",
    "browserStorageControlledRunState",
    "npm run hidden-controlled-state",
    "sk-controlled-run-state-secret",
    "access_token=controlled-run-state",
  ]),
];
const failures = [];
const runtimeRequests = [];
let browser;
let server;
let currentCapsResponse;

const readyReadiness = JSON.parse(await readFile(readinessFixturePath, "utf8"));
const fileReadSuccess = JSON.parse(await readFile(fileReadFixturePath, "utf8"));
const commandRunning = JSON.parse(await readFile(commandRunningFixturePath, "utf8"));
const commandSucceeded = JSON.parse(await readFile(commandSucceededFixturePath, "utf8"));

await buildAgentRunBuiltGui({ smokeName, smokeCommand, redact: redactSecrets });
await requireAgentRunBuiltGui({ smokeName, failures, redact: redactSecrets });
const { chromium } = await requireAgentRunChromium({ smokeName, redact: redactSecrets });

try {
  await runReducerScenarios();

  server = await startAgentRunStaticServer(agentRunBuiltGuiDistRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });

  await runPanelScenario(guiBaseUrl, "local mock run creation", capsWith({ controlledAgentWorkspaceReadiness: readyReadiness }), async (page) => {
    await expectVisibleText(page, "Controlled agent run skeleton", "controlled run panel", 20_000);
    await expectVisibleText(page, "S76 preview only", "preview badge");
    await expectVisibleText(page, "GUI-local state", "local state badge");
    await expectVisibleText(page, "metadata only", "metadata badge");
    await expectVisibleText(page, "Phase: planning", "planning phase");
    await expectVisibleText(page, "Current step: Review sanitized plan metadata", "planning step");
    await expectVisibleText(page, "Execution allowed: false", "execution flag");
    await expectVisibleText(page, "Agent start allowed: false", "agent start flag");
    await expectVisibleText(page, "Can read files: false", "read authority false");
    await expectVisibleText(page, "Can write files: false", "write authority false");
    await expectVisibleText(page, "Can run commands: false", "command authority false");
    await expectVisibleText(page, "Can apply edits: false", "apply authority false");
    await expectVisibleText(page, "Can call provider: false", "provider authority false");
    await expectVisibleText(page, "Can use tools: false", "tool authority false");
    await assertNoButtonNamed(page, "Start Agent", "start agent button");
    await assertNoButtonNamed(page, "Apply", "controlled run apply button");
    await assertNoButtonNamed(page, "Verify", "controlled run verify button");
  });

  await runPanelScenario(guiBaseUrl, "phase transitions from mock metadata", capsWith({ controlledAgentWorkspaceReadiness: readyReadiness, controlledAgentFileRead: fileReadSuccess, controlledAgentCommandRunner: commandRunning }), async (page) => {
    await expectVisibleText(page, "Phase: running verification", "running verification phase", 20_000);
    await expectVisibleText(page, "Current step: Review allowlisted verification metadata", "running verification step");
    await expectVisibleText(page, "Counter fileReadsUsed: 1", "file read counter");
    await expectVisibleText(page, "Counter verificationRuns: 1", "verification counter");
    await expectVisibleText(page, "Stop controlled run", "stop button");
  });

  await runPanelScenario(guiBaseUrl, "explicit stop is gui local", capsWith({ controlledAgentWorkspaceReadiness: readyReadiness, controlledAgentFileRead: fileReadSuccess, controlledAgentCommandRunner: commandSucceeded }), async (page) => {
    await expectVisibleText(page, "Phase: planning", "succeeded command planning phase", 20_000);
    await page.getByRole("button", { name: "Stop controlled run", exact: true }).click();
    await expectVisibleText(page, "Phase: stopped", "stopped phase after click");
    await expectVisibleText(page, "Stop reason", "stop reason card");
    await expectVisibleText(page, "user stop: Controlled run stopped from the S76 skeleton UI.", "user stop reason");
  });

  await runPanelScenario(guiBaseUrl, "unsafe metadata blocks display", capsWith({ controlledAgentWorkspaceReadiness: unsafeReadiness() }), async (page) => {
    await expectVisibleText(page, "Phase: blocked", "blocked unsafe phase", 20_000);
    await expectVisibleText(page, "unsafe metadata", "unsafe metadata stop reason");
    await expectVisibleText(page, "Controlled run initialization is blocked because unsafe metadata was omitted.", "unsafe blocked summary");
  });

  if (failures.length > 0) {
    throw new Error(`${smokeName} failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Controlled agent run state smoke passed.");
  console.log("Verified S76 local/mock run-state skeleton: disabled until explicit opt-in in the pure reducer, GUI-local run state creation, metadata-driven phase transitions, visible Stop as local state only, blocked unsafe metadata, no real agent start or worktree mutation, no hidden read/search/write/apply/verify/command/rollback/provider bridge messages, loopback-only runtime mocks, clean browser storage, and no raw prompt/file/command/private-path/secret leakage.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function runReducerScenarios() {
  const { imports, cleanup } = await transpileGuiServices([
    "services/controlledAgentRunState.ts",
    "services/controlledAgentWorkspaceReadiness.ts",
    "services/controlledAgentFileRead.ts",
    "services/controlledAgentCommandRunner.ts",
  ]);
  try {
    const { initializeControlledAgentRunState, reduceControlledAgentRunState } = imports.get("services/controlledAgentRunState.ts");
    const idle = initializeControlledAgentRunState(undefined);
    assert.equal(idle.phase, "idle", "missing input is idle");
    assert.equal(idle.executionAllowed, false, "idle cannot execute");

    const optInRequired = initializeControlledAgentRunState({ readiness: readyReadiness });
    assert.equal(optInRequired.phase, "opt_in_required", "readiness stays disabled until explicit user opt-in");
    assert.equal(optInRequired.enabled, false, "missing opt-in is not enabled");
    assert.equal(optInRequired.agentStartAllowed, false, "missing opt-in cannot start an agent");

    const ready = initializeControlledAgentRunState({ readiness: readyReadiness, userOptIn: { source: "user", confirmed: true, requestId: "smoke-opt-in" }, limits: { maxSteps: 5, maxFileReads: 2, maxReadBytes: 4096, maxTouchedFiles: 2, maxPatchBytes: 4096, maxRuntimeSeconds: 120, maxRepairAttempts: 0 } });
    assert.equal(ready.phase, "workspace_ready", "explicit opt-in creates local mock run state");
    assertNoAuthority(ready, "ready state");

    const afterRead = reduceControlledAgentRunState(ready, { type: "read", metadata: fileReadSuccess });
    assert.equal(afterRead.phase, "reading_context", "read metadata moves to reading_context");
    const running = reduceControlledAgentRunState(afterRead, { type: "command", metadata: commandRunning });
    assert.equal(running.phase, "running_verification", "running command metadata moves to running_verification");
    const planning = reduceControlledAgentRunState(running, { type: "command", metadata: commandSucceeded });
    assert.equal(planning.phase, "planning", "succeeded command returns to planning metadata");
    const waiting = reduceControlledAgentRunState(planning, { type: "wait", summary: "Review sanitized state" });
    assert.equal(waiting.phase, "waiting_for_user", "wait event is user-review only");
    const stopped = reduceControlledAgentRunState(waiting, { type: "stop", summary: "User pressed stop" });
    assert.equal(stopped.phase, "stopped", "stop is terminal");
    assert.equal(stopped.stop.reason, "user_stop", "stop reason is user_stop");
    assertNoAuthority(stopped, "stopped state");

    const unsafe = reduceControlledAgentRunState(ready, { type: "wait", rawCommand: "npm run hidden-controlled-state", privatePath: unsafePrivatePath, rawPrompt: unsafeRawPrompt });
    assert.equal(unsafe.phase, "blocked", "unsafe event metadata is blocked");
    assert.equal(unsafe.stop.reason, "unsafe_metadata", "unsafe event reason is unsafe_metadata");
    assertNoRawMarkers(JSON.stringify({ idle, optInRequired, ready, afterRead, running, planning, waiting, stopped, unsafe }), "reducer output");
  } finally {
    await cleanup();
  }
}

function capsWith(overrides) {
  return agentRunBuiltGuiCapsResponse(overrides);
}

function unsafeReadiness() {
  return {
    ...readyReadiness,
    summary: `${unsafeRawPrompt} ${unsafeSecret}`,
    rawCommand: "npm run hidden-controlled-state",
    privatePath: unsafePrivatePath,
  };
}

async function runPanelScenario(guiBaseUrl, label, capsResponse, assertions) {
  runtimeRequests.length = 0;
  currentCapsResponse = capsResponse;
  const page = await createSmokePage(guiBaseUrl);
  try {
    await assertions(page);
    await assertNoForbiddenEvidence(page, label);
    await assertRenderedEvidenceSafe(page, label);
  } finally {
    await page.close().catch(() => undefined);
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
      const response = await mockRuntimeResponse(url, request.method());
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
    return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: fixtureTime });
  }
  if (method === "GET" && url.pathname === "/v1/caps") {
    return json(currentCapsResponse);
  }
  if (method === "GET" && url.pathname === "/v1/models") {
    return json({ models: [agentRunBuiltGuiProviderSummary().models[0]] });
  }
  if (method === "GET" && url.pathname === "/v1/demo-mode") {
    return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode is disabled for this controlled run state fixture." });
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
    return json({ cloudRequired: false, providerAccess: "direct", generatedAt: fixtureTime, snapshots: [] });
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
  const forbiddenBridge = messages.filter((message) => message?.type !== "gui.ready" && /applyWorkspaceEditRequest|ideActionRequest|read|search|rollback|verify|verification|attach|provider|tool|git|shell|command/i.test(JSON.stringify(message)));
  assert.deepEqual(forbiddenBridge, [], `${label} emitted forbidden bridge evidence`);
  const allowedPaths = new Set(["/v1/ping", "/v1/caps", "/v1/models", "/v1/demo-mode", "/v1/providers", "/v1/provider-auth/openai/status", "/v1/chats", `/v1/chats/${activeChatId}`, "/v1/chats/subscribe", "/v1/project-memory", "/v1/agent-progress"]);
  const hiddenRuntime = runtimeRequests.filter((request) => !allowedPaths.has(new URL(request.url).pathname));
  assert.deepEqual(hiddenRuntime, [], `${label} requested hidden runtime endpoint(s)`);
  assert.equal(runtimeRequests.some((request) => /project-memory\/search|provider-call|chat\/completions|completions|embeddings|tools|tool|git|shell|exec|command-runner|repair|rollback|revert|retry|search|index|read|write|apply|verify/i.test(new URL(request.url).pathname)), false, `${label} requested hidden runtime authority`);
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
  assert.equal(storageText.includes("controlled_agent_run"), false, `${label} persisted run state payload in browser storage`);
  assert.equal(storageText.includes("Controlled run is ready"), false, `${label} persisted run state summary in browser storage`);
  assertNoRawMarkers(storageText, `${label} browser storage`);
}

function assertNoAuthority(state, label) {
  for (const key of ["cloudRequired", "executionAllowed", "agentStartAllowed", "autoStartAllowed", "canReadFiles", "canWriteFiles", "canRunCommands", "canApplyEdits", "canCallProvider", "canUseGit", "canUseTools", "canAutoRollback", "canStartAutonomousLoop"]) {
    assert.equal(state[key], false, `${label} ${key} must stay false`);
  }
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-run-state-smoke-ts-"));
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
