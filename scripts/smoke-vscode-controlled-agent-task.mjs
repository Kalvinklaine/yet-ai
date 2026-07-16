import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const evidenceRoot = path.join(root, "dist", "visual-smoke", "vscode-controlled-agent-task");
const bridgeVersion = "2026-05-15";
const headed = process.argv.includes("--headed");
const failures = [];
const runtimeRequestLog = [];
const consoleMessages = [];
const forbiddenLegacyCopy = [
  "Controlled repair eligibility",
  "Confirm one repair attempt",
  "no automatic repair",
  "no auto retry/rollback/repair",
];
const allowedBridgeTypes = new Set([
  "gui.ready",
  "gui.ideActionRequest",
  "gui.controlledAgentFileReadRequest",
  "gui.controlledAgentEditRequest",
  "gui.controlledAgentVerificationBundleRequest",
]);
const allowedIdeActions = new Set(["getActiveFileExcerpt"]);
const goalText = "Update the controlled task smoke fixture with bounded VS Code evidence.";
const activeContextPath = "apps/gui/src/App.tsx";
const activeContextText = "const controlledTaskSmoke = true;";
const activeContextRange = { start: { line: 42, character: 0 }, end: { line: 42, character: activeContextText.length } };
const runtimeToken = "controlledTaskRuntimeSession";

await buildGui();
await requireBuiltGui();
await mkdir(evidenceRoot, { recursive: true });
const { chromium } = await requireChromium();
const fixtures = await loadControlledFixtures();
const runtimeServer = await startMockRuntimeServer(fixtures.capsResponse);
const guiServer = await startStaticServer(distRoot);
let browser;

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await installNetworkPolicy(page, `http://127.0.0.1:${guiServer.port}`, `http://127.0.0.1:${runtimeServer.port}`);
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${redact(error.message)}`));

  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.__yetAiHostMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });

  await page.goto(`http://127.0.0.1:${guiServer.port}/index.html`, { waitUntil: "domcontentloaded" });
  const ready = await waitForGuiMessage(page, "gui.ready");
  assert.equal(ready?.version, bridgeVersion, "gui.ready uses bridge version");
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ready",
    requestId: ready?.requestId,
    payload: { runtimeUrl: `http://127.0.0.1:${runtimeServer.port}`, sessionToken: runtimeToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.runtimeStatus",
    payload: { protocolVersion: "2026-06-21", surface: "vscode", lifecycle: "ready", runtimeOwner: "ide_host", launchMode: "auto", tokenState: "matched", processState: "running", cloudRequired: false, authority: "metadata_only" },
  });

  await expectBodyText(page, "Runtime connected", "local runtime readiness");
  await openDrawer(page, "task-agent-tools-drawer");
  await expectBodyText(page, "Controlled task execution Start", "controlled Start card");

  const goalTextarea = page.getByPlaceholder("Describe the coding task goal before choosing context and asking the model.");
  await goalTextarea.fill(goalText);
  await expectBodyText(page, "Goal: Update the controlled task smoke fixture with bounded VS Code evidence.", "explicit task goal state");

  await openDrawer(page, "ide-actions-drawer");
  const beforeContextMessageCount = await countGuiMessages(page);
  const activeExcerptButton = page.getByRole("button", { name: "Attach active file excerpt", exact: true }).first();
  await clickControl(page, activeExcerptButton, "Attach active file excerpt");
  const activeExcerptRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", await countGuiMessagesOfType(page, "gui.ideActionRequest") - 1);
  assert.equal(activeExcerptRequest?.payload?.action, "getActiveFileExcerpt", "explicit context uses bounded active excerpt action");
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: activeExcerptRequest.requestId,
    payload: activeFileExcerptResultPayload(),
  });
  await expectBodyText(page, "Attach active file excerpt: succeeded", "explicit active context accepted");
  await clickControl(page, page.getByRole("button", { name: "Add to multi-file context bundle", exact: true }).first(), "Add active excerpt to explicit bundle");
  await expectBodyText(page, "Next send: 1 explicit item", "explicit context bundle selected");
  await openDrawer(page, "task-agent-tools-drawer");
  await expectBodyText(page, "Context selected: 1 explicit item", "controlled task explicit context summary");

  const beforeStart = await snapshotBridgeMessages(page);
  assert.equal(countType(beforeStart, "gui.controlledAgentFileReadRequest"), 0, "no controlled read before Start");
  assert.equal(countType(beforeStart, "gui.controlledAgentEditRequest"), 0, "no controlled edit before Start");
  assert.equal(countType(beforeStart, "gui.controlledAgentVerificationBundleRequest"), 0, "no verification bundle before Start");
  assertBridgeAllowlist(beforeStart, beforeContextMessageCount);

  const startButton = page.getByRole("button", { name: "Start one-step Agent Run", exact: true }).first();
  await expectEnabled(startButton, "Start one-step Agent Run is the single gate");
  await clickControl(page, startButton, "Start one-step Agent Run");
  await expectBodyText(page, "Start is the single explicit VS Code-only gate", "single Start gate copy");
  await expectBodyText(page, "Controlled task execution is already active", "duplicate Start disabled state");
  await expectDisabled(startButton, "duplicate Start button disabled during active run");
  await assertForbiddenLegacyCopyAbsent(page, "after Start");

  const readRequest = await waitForGuiMessageAfter(page, "gui.controlledAgentFileReadRequest", countType(beforeStart, "gui.controlledAgentFileReadRequest"));
  assertControlledReadRequest(readRequest);
  assert.equal(await countGuiMessagesOfType(page, "gui.controlledAgentEditRequest"), 0, "edit waits for read result");
  assert.equal(await countGuiMessagesOfType(page, "gui.controlledAgentVerificationBundleRequest"), 0, "verification waits for read and edit results");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.controlledAgentFileReadResult",
    requestId: readRequest.requestId,
    payload: controlledReadResult(fixtures.fileReadSuccess, readRequest),
  });
  const editRequest = await waitForGuiMessageAfter(page, "gui.controlledAgentEditRequest", 0);
  assertControlledEditRequest(editRequest);
  assert.equal(await countGuiMessagesOfType(page, "gui.controlledAgentVerificationBundleRequest"), 0, "verification waits for edit result");
  await assertForbiddenLegacyCopyAbsent(page, "after bounded read");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.controlledAgentEditResult",
    requestId: editRequest.requestId,
    payload: controlledEditResult(fixtures.editApplied, editRequest),
  });
  const bundleRequest = await waitForGuiMessageAfter(page, "gui.controlledAgentVerificationBundleRequest", 0);
  assertControlledVerificationBundleRequest(bundleRequest);
  assert.equal(await countGuiMessagesOfType(page, "gui.controlledAgentVerificationBundleRequest"), 1, "exactly one verification bundle request is posted");
  assert.equal(await countGuiMessagesOfType(page, "gui.controlledAgentCommandRunRequest"), 0, "legacy command-run verification is not used in started task flow");
  await expectBodyText(page, "Controlled phase: verifying", "started run reaches verification phase");
  await assertForbiddenLegacyCopyAbsent(page, "during verification");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.controlledAgentVerificationBundleResult",
    requestId: bundleRequest.requestId,
    payload: controlledVerificationBundleResult(fixtures.verificationSucceeded, bundleRequest),
  });
  await expectBodyText(page, "Controlled phase: completed", "controlled task completed status");
  await expectBodyText(page, "Verification bundle result accepted: succeeded.", "verification result accepted");
  await assertForbiddenLegacyCopyAbsent(page, "after completion");

  const finalMessages = await snapshotBridgeMessages(page);
  assertBridgeAllowlist(finalMessages, 0);
  const controlledCounts = {
    read: countType(finalMessages, "gui.controlledAgentFileReadRequest"),
    edit: countType(finalMessages, "gui.controlledAgentEditRequest"),
    verificationBundle: countType(finalMessages, "gui.controlledAgentVerificationBundleRequest"),
    commandRun: countType(finalMessages, "gui.controlledAgentCommandRunRequest"),
  };
  assert.deepEqual(controlledCounts, { read: 1, edit: 1, verificationBundle: 1, commandRun: 0 }, "controlled run bridge message counts stay bounded");
  assertNoForbiddenRuntimeRequests();

  const evidence = {
    status: "passed",
    goalLabel: goalText,
    explicitContext: { path: activeContextPath, source: "active editor excerpt", selectedByUser: true },
    bridgeMessageTypes: finalMessages.map((message) => message.type),
    controlledCounts,
    runtimeRequests: runtimeRequestLog,
    forbiddenLegacyCopy,
  };
  await writeFile(path.join(evidenceRoot, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await page.screenshot({ path: path.join(evidenceRoot, "completed.png"), fullPage: true });

  if (failures.length > 0) reportFailures();
  console.log("VS Code controlled-agent task smoke passed.");
  console.log(`Evidence: ${path.relative(root, evidenceRoot)}`);
} catch (error) {
  failures.push(messageOf(error));
  await writeFailureEvidence(browser).catch(() => undefined);
  reportFailures();
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close().catch(() => undefined);
  await guiServer.close().catch(() => undefined);
}

async function buildGui() {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation("build", [], { env });
  const result = spawnSync(command, args, { cwd: guiRoot, stdio: "inherit", env });
  if (result.status !== 0) throw new Error("GUI build failed before controlled-agent task smoke.");
}

async function requireBuiltGui() {
  const fileStat = await stat(indexPath).catch(() => null);
  if (!fileStat?.isFile()) throw new Error("GUI dist/index.html is missing after build.");
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(`Playwright is required for this smoke. ${messageOf(error)}`);
  }
}

async function loadControlledFixtures() {
  const workspaceReadiness = await readJson("packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json");
  const runtimeSession = await readJson("packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json");
  const editExecutor = await readJson("packages/contracts/examples/engine/controlled-agent-edit-executor-planned.json");
  const verificationBundle = await readJson("packages/contracts/examples/engine/controlled-agent-verification-bundle-planned.json");
  const fileReadSuccess = await readJson("packages/contracts/examples/bridge/host-controlled-agent-file-read-result-success.json");
  const editApplied = await readJson("packages/contracts/examples/bridge/host-controlled-agent-edit-result-applied.json");
  const verificationSucceeded = await readJson("packages/contracts/examples/engine/controlled-agent-verification-bundle-succeeded.json");
  runtimeSession.session.sessionId = "session-s82-demo";
  runtimeSession.workspace.controlledWorkspaceId = "workspace-session-s82-demo";
  runtimeSession.workspace.readinessId = "readiness-session-s82-demo";
  runtimeSession.preconditions.workspaceReadiness.readinessId = "readiness-session-s82-demo";
  runtimeSession.preconditions.correlation.readinessId = "readiness-session-s82-demo";
  editExecutor.runId = "session-s82-demo";
  editExecutor.workspaceReadinessId = "readiness-session-s82-demo";
  editExecutor.edits[0].replacementText = "const controlledTaskSmoke = true;\n";
  editExecutor.edits[0].replacementByteCount = new TextEncoder().encode(editExecutor.edits[0].replacementText).length;
  editExecutor.edits[0].sanitizedSummary = "Update controlled task smoke metadata lines.";
  verificationBundle.workspace.runId = "session-s82-demo";
  verificationBundle.workspace.controlledWorkspaceId = "workspace-session-s82-demo";

  const capsResponse = {
    productId: "yet-ai",
    protocolVersion: bridgeVersion,
    runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
    capabilities: ["chat"],
    features: {},
    providers: [],
    ide: { bridge: true, lsp: false, host: "vscode-controlled-agent-task-smoke" },
    controlledAgentWorkspaceReadiness: workspaceReadiness,
    controlledAgentRuntimeSession: runtimeSession,
    controlledAgentEditExecutor: editExecutor,
    controlledAgentVerificationBundle: verificationBundle,
  };
  return { capsResponse, fileReadSuccess, editApplied, verificationSucceeded };
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function installNetworkPolicy(page, guiBaseUrl, runtimeBaseUrl) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (isAllowedLoopbackUrl(url, guiBaseUrl, runtimeBaseUrl)) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected non-loopback or unmocked network request: ${redact(url)}`);
    await route.abort();
  });
}

function isAllowedLoopbackUrl(value, guiBaseUrl, runtimeBaseUrl) {
  try {
    const url = new URL(value);
    return (value.startsWith(`${guiBaseUrl}/`) || value === `${guiBaseUrl}/index.html` || value.startsWith(`${runtimeBaseUrl}/`)) && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function startMockRuntimeServer(capsResponse) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders()).end();
      return;
    }
    runtimeRequestLog.push({ method: request.method ?? "GET", pathname: requestUrl.pathname });
    if (request.headers.authorization !== `Bearer ${runtimeToken}`) {
      json(response, 401, { error: "Unauthorized local runtime request." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/ping") {
      json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0-smoke", ready: true, serverTime: new Date(0).toISOString() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/caps") {
      json(response, 200, capsResponse);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, { enabled: true, cloudRequired: false, providerAccess: "direct", message: "Local smoke demo mode." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: [{ id: "local-smoke-model", name: "Local smoke model", provider: "local", available: true }], cloudRequired: false });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Mock-only controlled task smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/project-memory") {
      json(response, 200, { notes: [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats") {
      json(response, 200, { chats: [] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/subscribe") {
      response.writeHead(200, { ...corsHeaders(), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      response.write(`event: snapshot\ndata: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: null, payload: { thread: null, messages: [], runtime: { streaming: false, waitingForResponse: false } } })}\n\n`);
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

async function startStaticServer(staticRoot) {
  const realStaticRoot = await realpath(staticRoot);
  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    const requestedPath = path.normalize(path.join(realStaticRoot, pathname));
    try {
      const realRequestedPath = await realpath(requestedPath);
      if (!isPathInsideRoot(realStaticRoot, realRequestedPath) || !(await stat(realRequestedPath)).isFile()) throw new Error("not found");
      response.writeHead(200, { "content-type": contentType(realRequestedPath) });
      createReadStream(realRequestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return listen(server);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({ port: address.port, close: () => new Promise((closeResolve) => server.close(closeResolve)) });
    });
  });
}

async function waitForGuiMessage(page, type) {
  await page.waitForFunction((messageType) => window.__yetAiVsCodeMessages?.some((message) => message?.type === messageType), type, { timeout: 15_000 });
  return page.evaluate((messageType) => window.__yetAiVsCodeMessages.find((message) => message?.type === messageType), type);
}

async function waitForGuiMessageAfter(page, type, previousCount) {
  await page.waitForFunction(({ messageType, count }) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length > count, { messageType: type, count: previousCount }, { timeout: 15_000 });
  return page.evaluate(({ messageType, count }) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).at(count), { messageType: type, count: previousCount });
}

async function countGuiMessages(page) {
  return page.evaluate(() => (window.__yetAiVsCodeMessages ?? []).length);
}

async function countGuiMessagesOfType(page, type) {
  return page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
}

async function snapshotBridgeMessages(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__yetAiVsCodeMessages ?? [])));
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
    window.__yetAiHostMessages.push(hostMessage);
    window.dispatchEvent(new MessageEvent("message", { data: hostMessage }));
  }, message);
}

async function openDrawer(page, testId) {
  const drawer = page.locator(`[data-testid='${testId}']`).first();
  await drawer.waitFor({ state: "attached", timeout: 15_000 });
  const summary = drawer.locator(":scope > summary").first();
  if (!await drawer.evaluate((element) => element instanceof HTMLDetailsElement && element.open).catch(() => false)) {
    await clickControl(page, summary, `${testId} summary`);
  }
  await drawer.locator(":scope > .composer-drawer-body").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function clickControl(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const state = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, disabled: true, reason: "not HTMLElement" };
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    const style = window.getComputedStyle(element);
    return { ok: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !element.hasAttribute("disabled") && (top === element || element.contains(top)), disabled: element.hasAttribute("disabled"), rect };
  });
  if (!state.ok || state.disabled) throw new Error(`${label} is not user-clickable: ${JSON.stringify(state)}`);
  await locator.click({ timeout: 5000 });
}

async function expectEnabled(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  if (await locator.isDisabled()) throw new Error(`${label} is disabled.`);
}

async function expectDisabled(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  if (!await locator.isDisabled()) failures.push(`${label} is not disabled.`);
}

async function expectBodyText(page, text, description) {
  try {
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), text, { timeout: 15_000 });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redact(body).slice(0, 2000)}`);
  }
}

async function assertForbiddenLegacyCopyAbsent(page, phase) {
  const body = await page.locator("body").innerText();
  for (const marker of forbiddenLegacyCopy) {
    if (body.includes(marker)) failures.push(`Forbidden legacy repair copy rendered ${phase}: ${marker}`);
  }
}

function assertControlledReadRequest(message) {
  assert.equal(message?.version, bridgeVersion, "read request bridge version");
  assert.equal(message?.type, "gui.controlledAgentFileReadRequest", "read request type");
  assert.match(message?.requestId ?? "", /^gui-s83-/u, "read request id is GUI-owned");
  assert.equal(message.payload?.requestIdMintedBy, "gui");
  assert.equal(message.payload?.source, "gui");
  assert.equal(message.payload?.assistantMinted, false);
  assert.equal(message.payload?.workspaceRelativePath, "docs/architecture/013-agent-readiness-milestone.md");
  assert.equal(message.payload?.singleFileOnly, true);
  assert.equal(message.payload?.recursive, false);
  assert.equal(message.payload?.globAllowed, false);
  assert.equal(message.payload?.regexAllowed, false);
  assert.equal(message.payload?.indexingAllowed, false);
  assertNoForbiddenRequestKeys(message.payload, "controlled read request");
}

function assertControlledEditRequest(message) {
  assert.equal(message?.version, bridgeVersion, "edit request bridge version");
  assert.equal(message?.type, "gui.controlledAgentEditRequest", "edit request type");
  assert.match(message?.requestId ?? "", /^gui-s84-/u, "edit request id is GUI-owned");
  assert.equal(message.payload?.requestIdMintedBy, "gui");
  assert.equal(message.payload?.source, "gui");
  assert.equal(message.payload?.assistantMinted, false);
  assert.equal(message.payload?.limits?.maxFiles, 1);
  assert.equal(message.payload?.limits?.maxEdits, 1);
  assert.equal(Array.isArray(message.payload?.edits), true);
  assert.equal(message.payload.edits.length, 1);
  assert.equal(message.payload.edits[0].operation, "replace");
  assertNoForbiddenRequestKeys(message.payload, "controlled edit request", { allowEdits: true });
}

function assertControlledVerificationBundleRequest(message) {
  assert.equal(message?.version, bridgeVersion, "verification bundle bridge version");
  assert.equal(message?.type, "gui.controlledAgentVerificationBundleRequest", "verification bundle request type");
  assert.match(message?.requestId ?? "", /^gui-s117-/u, "verification bundle request id is GUI-owned");
  assert.equal(message.payload?.requestIdMintedBy, "gui");
  assert.equal(message.payload?.source, "gui");
  assert.equal(message.payload?.assistantMinted, false);
  assert.deepEqual(message.payload?.commandIds, ["repository-check", "gui-app-tests", "engine-chat-tests"]);
  assert.equal(message.payload?.limits?.maxCommands, 3);
  assert.equal(message.payload?.limits?.commandStringAllowed, false);
  assert.equal(message.payload?.limits?.argsAllowed, false);
  assert.equal(message.payload?.limits?.cwdAllowed, false);
  assert.equal(message.payload?.limits?.envAllowed, false);
  assert.equal(message.payload?.limits?.shellAllowed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(message.payload, "command"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(message.payload, "cwd"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(message.payload, "env"), false);
}

function assertNoForbiddenRequestKeys(value, label, options = {}) {
  const forbidden = new Set(["shell", "command", "cmd", "args", "arguments", "cwd", "env", "environment", "git", "provider", "tool", "tools", "network", "package", "packageInstall"]);
  if (!options.allowEdits) forbidden.add("edits");
  const visit = (current) => {
    if (!current || typeof current !== "object") return undefined;
    if (Array.isArray(current)) return current.map(visit).find(Boolean);
    for (const [key, nested] of Object.entries(current)) {
      if (forbidden.has(key)) return key;
      const found = visit(nested);
      if (found) return found;
    }
    return undefined;
  };
  const found = visit(value);
  assert.equal(found, undefined, `${label} contains forbidden privileged key ${found}`);
}

function assertBridgeAllowlist(messages, startIndex) {
  for (const message of messages.slice(startIndex)) {
    if (!allowedBridgeTypes.has(message?.type)) failures.push(`Unexpected bridge message type: ${message?.type}`);
    if (message?.type === "gui.ideActionRequest" && !allowedIdeActions.has(message.payload?.action)) failures.push(`Unexpected IDE action in controlled task smoke: ${message.payload?.action}`);
    if (message?.type === "gui.ideActionRequest" && hasPrivilegedIdePayload(message.payload)) failures.push("IDE action payload widened beyond bounded context action.");
  }
}

function hasPrivilegedIdePayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  return ["command", "cmd", "args", "cwd", "env", "shell", "git", "provider", "tool", "network"].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function assertNoForbiddenRuntimeRequests() {
  const allowedGet = ["/v1/ping", "/v1/caps", "/v1/demo-mode", "/v1/models", "/v1/providers", "/v1/provider-auth/openai/status", "/v1/project-memory", "/v1/chats", "/v1/chats/subscribe"];
  const allowed = runtimeRequestLog.filter((entry) => entry.method === "GET" && allowedGet.includes(entry.pathname));
  const forbidden = runtimeRequestLog.filter((entry) => entry.method !== "GET" || !allowedGet.includes(entry.pathname));
  if (forbidden.length > 0) failures.push(`Unexpected runtime mutation or endpoint request: ${forbidden.map((entry) => `${entry.method} ${entry.pathname}`).join(", ")}`);
  if (allowed.length !== runtimeRequestLog.length) failures.push("Runtime requests escaped the deterministic GET-only allowlist.");
}

function activeFileExcerptResultPayload() {
  return {
    status: "succeeded",
    message: "Active file excerpt ready.",
    cloudRequired: false,
    action: "getActiveFileExcerpt",
    contextAttachment: {
      kind: "active_file_excerpt",
      source: "vscode",
      file: { displayPath: activeContextPath, workspaceRelativePath: activeContextPath, languageId: "typescript" },
      range: activeContextRange,
      text: activeContextText,
      truncated: false,
    },
  };
}

function controlledReadResult(fixture, request) {
  const payload = structuredClone(fixture.payload);
  payload.request.requestId = request.requestId;
  payload.request.workspaceRelativePath = request.payload.workspaceRelativePath;
  payload.workspace.runId = request.payload.runId;
  payload.workspace.controlledWorkspaceId = request.payload.controlledWorkspaceId;
  payload.result.sanitizedPathLabel = request.payload.workspaceRelativePath;
  payload.result.text = "# Controlled task smoke\n\nExplicit bounded context was read locally.";
  payload.result.byteCount = new TextEncoder().encode(payload.result.text).length;
  payload.result.lineCount = 3;
  return payload;
}

function controlledEditResult(fixture, request) {
  const payload = structuredClone(fixture.payload);
  payload.requestId = request.requestId;
  payload.runId = request.payload.runId;
  payload.controlledWorkspaceId = request.payload.controlledWorkspaceId;
  payload.runtimeSessionId = request.payload.runtimeSessionId;
  payload.workspaceReadinessId = request.payload.workspaceReadinessId;
  payload.edits = request.payload.edits.map((edit) => {
    const clone = { ...edit };
    delete clone.replacementText;
    clone.actualContentHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    return clone;
  });
  payload.result.message = "Bounded replacement edit applied.";
  return payload;
}

function controlledVerificationBundleResult(fixture, request) {
  const payload = structuredClone(fixture);
  payload.workspace.controlledWorkspaceId = request.payload.controlledWorkspaceId;
  payload.workspace.runId = request.payload.runId;
  payload.workspace.workspaceReadinessId = request.payload.workspaceReadinessId;
  payload.bundle.bundleId = request.payload.bundleId;
  payload.bundle.requestedCommandCount = request.payload.commandIds.length;
  payload.bundle.commands = request.payload.commandIds.map((commandId, index) => ({
    stepId: `step-smoke-${index}`,
    sequenceIndex: index,
    commandId,
    timeoutMs: index === 2 ? 300000 : 600000,
    maxOutputBytes: index === 2 ? 8000 : 12000,
    maxOutputLines: index === 2 ? 160 : 240,
    tailOnly: true,
    commandStringAllowed: false,
    argsAllowed: false,
    cwdAllowed: false,
    envAllowed: false,
    shellAllowed: false,
    status: "succeeded",
    exitCode: 0,
    durationMs: 1000 + index,
    outputTail: `${commandId} completed with bounded sanitized evidence.`,
    outputByteCount: `${commandId} completed with bounded sanitized evidence.`.length,
    outputLineCount: 1,
    truncated: false,
    resultHash: `sha256:${String(index).repeat(64)}`,
    summary: `${commandId} passed with local deterministic evidence.`,
  }));
  payload.aggregateResult.status = "succeeded";
  payload.aggregateResult.commandCount = request.payload.commandIds.length;
  payload.aggregateResult.succeededCount = request.payload.commandIds.length;
  payload.aggregateResult.failedCount = 0;
  payload.aggregateResult.timedOutCount = 0;
  payload.aggregateResult.truncated = false;
  payload.aggregateResult.rawOutputStored = false;
  payload.aggregateResult.rawOutputReturned = false;
  payload.aggregateResult.summary = "All user approved checks passed with sanitized aggregate evidence.";
  return payload;
}

function countType(messages, type) {
  return messages.filter((message) => message?.type === type).length;
}

async function writeFailureEvidence(browserInstance) {
  await mkdir(evidenceRoot, { recursive: true });
  const pages = browserInstance?.contexts?.()?.flatMap((context) => context.pages()) ?? [];
  if (pages[0]) {
    await pages[0].screenshot({ path: path.join(evidenceRoot, "failure.png"), fullPage: true }).catch(() => undefined);
    const body = await pages[0].locator("body").innerText().catch(() => "");
    await writeFile(path.join(evidenceRoot, "failure-body.txt"), redact(body));
  }
  await writeFile(path.join(evidenceRoot, "failure.json"), `${JSON.stringify({ failures, runtimeRequestLog, consoleMessages: consoleMessages.map(redact) }, null, 2)}\n`);
}

function json(response, status, payload) {
  response.writeHead(status, corsHeaders({ "content-type": "application/json" }));
  response.end(JSON.stringify(payload));
}

function corsHeaders(extra = {}) {
  return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-yet-ai-caller", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", ...extra };
}

function isPathInsideRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function redact(value) {
  return String(value)
    .replaceAll(runtimeToken, "[redacted-runtime-token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/[A-Z]:\\[^\s)]+/g, "[redacted-absolute-path]");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code controlled-agent task smoke failed:");
  for (const failure of failures) console.error(`- ${redact(failure)}`);
  process.exit(1);
}
