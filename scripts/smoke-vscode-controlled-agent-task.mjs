import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui", "dist");
const evidenceRoot = path.join(root, "dist", "visual-smoke", "vscode-controlled-agent-task");
const bridgeVersion = "2026-05-15";
const runtimeToken = `vscodeControlledTask${randomUUID().replaceAll("-", "")}`;
const forbiddenVisibleCopy = [
  "Controlled repair eligibility",
  "Confirm one repair attempt",
  "no automatic repair",
  "no auto retry/rollback/repair",
  "no automatic retry/rollback/repair",
];
const forbiddenAuthorityKeys = new Set(["shell", "command", "commandString", "args", "cwd", "env", "git", "provider", "network", "tool"]);
const failures = [];
const consoleMessages = [];
const runtimeRequests = [];
let observedRuntimeAuthorization = false;

const fixtures = await loadFixtures();
await requireBuiltGui();
const { chromium } = await requireChromium();
const guiServer = await startStaticServer(guiRoot);
const runtimeServer = await startMockRuntimeServer();
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 850 } });

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (isAllowedUrl(url, [guiBaseUrl, runtimeBaseUrl])) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request: ${redactUrl(url)}`);
    await route.abort();
  });
  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(text);
    if (containsSecret(text)) failures.push("Browser console exposed a runtime token.");
  });
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(guiBaseUrl) && ["script", "stylesheet"].includes(request.resourceType())) {
      failures.push(`Failed GUI asset request: ${redactUrl(request.url())}`);
    }
  });

  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.__yetAiHostMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await expectText(page, "Chat readiness", "chat readiness surface");
  const guiReady = await waitForGuiMessage(page, "gui.ready");
  if (guiReady?.version !== bridgeVersion || guiReady?.payload?.supportedBridgeVersion !== bridgeVersion) {
    failures.push("VS Code bridge did not emit strict gui.ready.");
  }

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ready",
    requestId: guiReady?.requestId,
    payload: { runtimeUrl: runtimeBaseUrl, sessionToken: runtimeToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.runtimeStatus",
    payload: {
      protocolVersion: "2026-06-21",
      surface: "vscode",
      lifecycle: "ready",
      runtimeOwner: "ide_host",
      launchMode: "auto",
      tokenState: "ok",
      processState: "running",
      cloudRequired: false,
      authority: "metadata_only",
    },
  });
  await assertGuiCollectedHostMessage(page, "host.ready", "trusted host.ready bridge message");
  await assertGuiCollectedHostMessage(page, "host.runtimeStatus", "runtime status bridge message");
  await assertVscodeHostClass(page);
  await expectText(page, "Runtime connected", "trusted loopback runtime connection");

  await openTaskAgentDrawer(page);
  const panel = page.locator("[data-testid='agent-run-panel']").first();
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  await expectTextIn(panel, "Controlled task execution Start", "controlled task Start panel");
  await expectTextIn(panel, "VS Code-only", "VS Code-only controlled task gate");
  await expectTextIn(panel, "Start is the single explicit VS Code-only gate for a bounded controlled task run.", "single explicit Start copy");
  await expectTextIn(panel, "Read request: ready", "ready controlled read metadata");
  await expectTextIn(panel, "Edit request: ready", "ready controlled edit metadata");
  await expectTextIn(panel, "Verification request: ready", "ready verification metadata");
  await assertNoLegacyRepairCopy(page, "pre-start controlled task UI");

  const beforeStartReadCount = await getGuiMessageCount(page, "gui.controlledAgentFileReadRequest");
  const beforeStartEditCount = await getGuiMessageCount(page, "gui.controlledAgentEditRequest");
  const beforeStartVerificationCount = await getGuiMessageCount(page, "gui.controlledAgentVerificationBundleRequest");
  const startButton = panel.getByRole("button", { name: "Start one-step Agent Run", exact: true });
  await clickControl(page, startButton, "Start one-step Agent Run");
  const readRequest = await waitForGuiMessageAfter(page, "gui.controlledAgentFileReadRequest", beforeStartReadCount);
  if (!readRequest) {
    failures.push("Clicking Start did not post the started-run controlled read request.");
  } else {
    assertControlledStartReadRequest(readRequest);
  }
  const afterStartEditCount = await getGuiMessageCount(page, "gui.controlledAgentEditRequest");
  const afterStartVerificationCount = await getGuiMessageCount(page, "gui.controlledAgentVerificationBundleRequest");
  if (afterStartEditCount !== beforeStartEditCount) failures.push("Start click posted an edit request before the bounded read result.");
  if (afterStartVerificationCount !== beforeStartVerificationCount) failures.push("Start click posted verification before bounded edit success.");

  await expectTextIn(panel, "Controlled phase: context ready", "started controlled task state");
  await expectTextIn(panel, "Start recorded; autonomous verification may request only the allowlisted verification bundle", "started-run frozen context summary");
  await assertNoLegacyRepairCopy(page, "post-start controlled task state");
  await assertNoAuthorityRequests(page);
  if (!observedRuntimeAuthorization) failures.push("Mock runtime did not observe Authorization from host.ready session token.");

  await panel.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const metrics = await collectMetrics(page);
  const evidence = await saveEvidence(page, metrics);
  assertNoSecretLeak(JSON.stringify({ dom: await page.locator("body").innerText(), messages: await page.evaluate(() => window.__yetAiVsCodeMessages), consoleMessages }), "visible state");

  if (failures.length > 0) reportFailures();
  console.log("VS Code controlled-agent task smoke passed.");
  console.log("Verified gui.ready, trusted loopback host.ready, visible VS Code controlled task Start UI, real user Start click, controlled started-run state, absence of legacy repair copy, and loopback-only mock runtime authority.");
  console.log(`Saved sanitized visual evidence under ${path.relative(root, evidenceRoot)}/ (${path.basename(evidence.screenshotPath)}, ${path.basename(evidence.domPath)}, ${path.basename(evidence.metricsPath)}).`);
  console.log("No real shell, git, provider credentials, hosted backend, VS Code launch, or non-loopback provider call was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close();
  await guiServer.close();
}

async function loadFixtures() {
  const base = path.join(root, "packages", "contracts", "examples", "engine");
  const [runtimeSession, workspaceReadiness, editExecutor, verificationBundle, taskHarness, workflowTranscript] = await Promise.all([
    readJson(path.join(base, "controlled-agent-runtime-session-ready-vscode-worktree.json")),
    readJson(path.join(base, "controlled-agent-workspace-readiness-worktree.json")),
    readJson(path.join(base, "controlled-agent-edit-executor-planned.json")),
    readJson(path.join(base, "controlled-agent-verification-bundle-planned.json")),
    readJson(path.join(base, "controlled-agent-task-harness-vscode-happy-path.json")),
    readJson(path.join(base, "controlled-agent-workflow-transcript-completed.json")),
  ]);
  const editExecutorWithReplacement = {
    ...editExecutor,
    edits: Array.isArray(editExecutor.edits) ? editExecutor.edits.map((edit) => ({ ...edit, replacementText: "x".repeat(edit.replacementByteCount ?? 0) })) : editExecutor.edits,
  };
  return { runtimeSession, workspaceReadiness, editExecutor: editExecutorWithReplacement, verificationBundle, taskHarness, workflowTranscript };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function requireBuiltGui() {
  try {
    const index = path.join(guiRoot, "index.html");
    const indexStat = await stat(index);
    if (!indexStat.isFile()) throw new Error("index.html is not a file");
  } catch (error) {
    console.error("VS Code controlled-agent task smoke failed: GUI dist is missing.");
    console.error("Run `npm --prefix apps/gui run build` before this smoke.");
    console.error(`Reason: ${messageOf(error)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code controlled-agent task smoke failed: Playwright is not installed or cannot be loaded.");
    console.error(`Load error: ${messageOf(error)}`);
    process.exit(1);
  }
}

async function startMockRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders()).end();
      return;
    }
    runtimeRequests.push({ method: request.method ?? "GET", pathname: requestUrl.pathname });
    if (request.headers.authorization === `Bearer ${runtimeToken}`) observedRuntimeAuthorization = true;
    if (request.headers.authorization !== `Bearer ${runtimeToken}`) {
      json(response, 401, { error: "Unauthorized local runtime request." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/ping") {
      json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0-smoke", ready: true, serverTime: new Date(0).toISOString() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/caps") {
      json(response, 200, {
        productId: "yet-ai",
        protocolVersion: bridgeVersion,
        runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
        capabilities: ["chat"],
        features: {},
        providers: [],
        ide: { bridge: true, lsp: false, host: "vscode-controlled-agent-task-smoke" },
        controlledAgentRuntimeSession: fixtures.runtimeSession,
        controlledAgentWorkspaceReadiness: fixtures.workspaceReadiness,
        controlledAgentEditExecutor: fixtures.editExecutor,
        controlledAgentVerificationBundle: fixtures.verificationBundle,
        controlledAgentTaskHarness: fixtures.taskHarness,
        controlledAgentWorkflowTranscript: fixtures.workflowTranscript,
      });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, { enabled: false, cloudRequired: false, providerAccess: "direct", message: "Mock-only controlled task smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: [] });
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
      json(response, 200, { chats: [{ chatId: "chat-001", title: "Controlled task smoke", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), messageCount: 0 }] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/chat-001") {
      json(response, 200, { chatId: "chat-001", title: "Controlled task smoke", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), messages: [] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/subscribe") {
      response.writeHead(200, { ...corsHeaders(), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      response.write(`event: snapshot\ndata: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: "chat-001", payload: { thread: { chatId: "chat-001", messages: [] }, messages: [], runtime: { streaming: false, waitingForResponse: false } } })}\n\n`);
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
  await page.waitForFunction((messageType) => window.__yetAiVsCodeMessages?.some((message) => message?.type === messageType), type, { timeout: 10_000 });
  return await page.evaluate((messageType) => window.__yetAiVsCodeMessages.find((message) => message?.type === messageType), type);
}

async function waitForGuiMessageAfter(page, type, previousCount) {
  await page.waitForFunction(({ messageType, count }) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length > count, { messageType: type, count: previousCount }, { timeout: 10_000 });
  return await page.evaluate(({ messageType, count }) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).at(count), { messageType: type, count: previousCount });
}

async function getGuiMessageCount(page, type) {
  return await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
    window.__yetAiHostMessages.push(hostMessage);
    window.dispatchEvent(new MessageEvent("message", { data: hostMessage }));
  }, message);
}

async function assertGuiCollectedHostMessage(page, type, label) {
  const found = await page.evaluate((messageType) => (window.__yetAiHostMessages ?? []).some((message) => message?.type === messageType), type);
  if (!found) failures.push(`GUI did not collect ${label}.`);
}

async function assertVscodeHostClass(page) {
  const hasClass = await page.evaluate(() => document.querySelector("main.app-shell.host-vscode") instanceof HTMLElement);
  if (!hasClass) failures.push("VS Code host class was not applied after acquireVsCodeApi bridge initialization.");
}

async function openTaskAgentDrawer(page) {
  const drawer = page.locator("[data-testid='task-agent-tools-drawer']").first();
  await drawer.waitFor({ state: "attached", timeout: 10_000 });
  const summary = drawer.locator(":scope > summary").first();
  if (!await drawer.evaluate((element) => element instanceof HTMLDetailsElement && element.open).catch(() => false)) {
    await summary.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
    await summary.click({ timeout: 5000 });
  }
  await drawer.locator(":scope > .composer-drawer-body").first().waitFor({ state: "visible", timeout: 10_000 });
}

async function clickControl(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const before = await describeControl(locator);
  if (!before.ok || before.disabled) {
    throw new Error(`${label}: control is not hit-testable/enabled before click. ${JSON.stringify(before)}`);
  }
  await page.mouse.click((before.rect.left + before.rect.right) / 2, (before.rect.top + before.rect.bottom) / 2);
}

async function describeControl(locator) {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, reason: "not an HTMLElement" };
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    const style = window.getComputedStyle(element);
    return {
      ok: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none" && !element.hasAttribute("disabled") && (top === element || element.contains(top)),
      disabled: element instanceof HTMLButtonElement ? element.disabled : element.hasAttribute("disabled"),
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
      topTag: top?.tagName,
      topText: top?.textContent?.trim().slice(0, 80),
    };
  });
}

async function expectText(page, text, description) {
  try {
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), text, { timeout: 10_000 });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function expectTextIn(locator, text, description) {
  try {
    await locator.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout: 10_000 });
  } catch (error) {
    const body = await locator.innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nPanel excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function assertNoLegacyRepairCopy(page, label) {
  const text = await page.locator("body").innerText();
  for (const marker of forbiddenVisibleCopy) {
    if (text.includes(marker)) failures.push(`${label} exposed legacy repair copy: ${marker}.`);
  }
}

function assertControlledStartReadRequest(message) {
  if (message.version !== bridgeVersion) failures.push("Controlled read request used the wrong bridge version.");
  if (message.type !== "gui.controlledAgentFileReadRequest") failures.push("Start emitted an unexpected bridge message type.");
  const payload = message.payload ?? {};
  if (message.requestId !== payload.requestId && payload.requestId !== undefined) failures.push("Controlled read request id was inconsistent.");
  if (payload.source !== "gui" || payload.requestIdMintedBy !== "gui" || payload.assistantMinted !== false) failures.push("Controlled read request was not GUI-minted after user Start.");
  if (payload.workspaceRelativePath !== "docs/architecture/013-agent-readiness-milestone.md") failures.push("Controlled read request did not stay on the bounded workspace path.");
  if (payload.allowBody !== true || payload.singleFileOnly !== true || payload.recursive !== false || payload.globAllowed !== false || payload.regexAllowed !== false || payload.indexingAllowed !== false) failures.push("Controlled read request widened file-read authority.");
  if (hasForbiddenAuthority(message)) failures.push("Controlled Start request contained shell/git/provider/network authority fields.");
}

async function assertNoAuthorityRequests(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const forbiddenMessages = messages.filter((message) => ["gui.ideActionRequest", "gui.applyWorkspaceEditRequest", "gui.controlledRunRequest", "gui.controlledRuntimeSessionRequest"].includes(message?.type));
  if (forbiddenMessages.length > 0) failures.push(`Unexpected broader bridge authority request(s): ${forbiddenMessages.map((message) => message.type).join(", ")}.`);
  for (const message of messages) {
    if (hasForbiddenAuthority(message)) failures.push(`Bridge message ${message?.type ?? "unknown"} contained forbidden authority fields.`);
  }
  const forbiddenRuntime = runtimeRequests.filter((entry) => entry.method !== "GET");
  if (forbiddenRuntime.length > 0) failures.push(`Unexpected runtime authority request(s): ${forbiddenRuntime.map((entry) => `${entry.method} ${entry.pathname}`).join(", ")}.`);
}

function hasForbiddenAuthority(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenAuthority);
  return Object.entries(value).some(([key, nested]) => forbiddenAuthorityKeys.has(key) || hasForbiddenAuthority(nested));
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-testid='agent-run-panel']");
    const startButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Start one-step Agent Run");
    const rectFor = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hostVscodeClass: document.querySelector("main.app-shell.host-vscode") instanceof HTMLElement,
      runtimeConnectedVisible: document.body.innerText.includes("Runtime connected"),
      controlledStartVisible: document.body.innerText.includes("Controlled task execution Start"),
      startedRunVisible: document.body.innerText.includes("Controlled phase: context ready"),
      startButtonVisible: startButton instanceof HTMLElement && getComputedStyle(startButton).display !== "none" && getComputedStyle(startButton).visibility !== "hidden",
      panelRect: rectFor(panel),
      startButtonRect: rectFor(startButton),
      bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 800),
    };
  });
}

async function saveEvidence(page, metrics) {
  await mkdir(evidenceRoot, { recursive: true });
  const screenshotPath = path.join(evidenceRoot, "controlled-agent-task.png");
  const domPath = path.join(evidenceRoot, "controlled-agent-task.dom.txt");
  const metricsPath = path.join(evidenceRoot, "controlled-agent-task.metrics.json");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const dom = sanitizeEvidenceText(await page.locator("body").innerText());
  await writeFile(domPath, dom, "utf8");
  await writeFile(metricsPath, `${JSON.stringify(JSON.parse(sanitizeEvidenceText(JSON.stringify(metrics))), null, 2)}\n`, "utf8");
  return { screenshotPath, domPath, metricsPath };
}

function json(response, status, body) {
  response.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, accept" };
}

function isAllowedUrl(value, origins) {
  try { return origins.includes(new URL(value).origin); } catch { return false; }
}

function isPathInsideRoot(rootPath, requestedPath) {
  const relativePath = path.relative(rootPath, requestedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function containsSecret(text) {
  return String(text).includes(runtimeToken) || /Bearer\s+\S+/i.test(String(text));
}

function assertNoSecretLeak(text, source) {
  if (containsSecret(text)) throw new Error(`Runtime token leaked through ${source}.`);
}

function redactSecrets(text) {
  return String(text).split(runtimeToken).join("[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

function sanitizeEvidenceText(text) {
  return redactSecrets(text)
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/[A-Z]:\\[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return redactSecrets(value); }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code controlled-agent task smoke failed:");
  for (const failure of failures) console.error(`- ${sanitizeEvidenceText(failure)}`);
  process.exit(1);
}
