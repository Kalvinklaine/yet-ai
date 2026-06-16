import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertPackagedGuiFreshness } from "./gui-asset-freshness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiDistRoot = path.join(root, "apps", "gui", "dist");
const packagedGuiRoot = path.join(root, "apps", "plugins", "vscode", "media", "gui");
const packagedGuiIndex = path.join(packagedGuiRoot, "index.html");
const bridgeVersion = "2026-05-15";
const headed = process.argv.includes("--headed");
const runtimeToken = `vscode-verification-runtime-${randomUUID()}`;
const forbiddenOutput = `Authorization: Bearer ${runtimeToken}\nsk-verification-${randomUUID().replaceAll("-", "")}`;
const verificationOutput = "Repository check passed.\nNo shell command ran in this smoke.";
const failures = [];
const runtimeRequestLog = [];
const consoleMessages = [];
let observedRuntimeAuthorization = false;

await requirePackagedGui();
const { chromium } = await requireChromium();
const guiServer = await startStaticServer(packagedGuiRoot);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeServer = await startMockRuntimeServer();
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
let browser;

try {
  browser = await chromium.launch({ headless: !headed });
  await runBrowserPreviewScenario(browser);
  await runVsCodeScenario(browser);
  if (failures.length > 0) reportFailures();
  console.log("VS Code verification command smoke passed.");
  console.log("Verified browser-wrapper verification command lifecycle with loopback mocks only: browser preview cannot execute, VS Code-mode click posts one allowlisted request, duplicate clicks are suppressed, correlated progress/result render, stale and duplicate results are ignored, unsafe output is rejected before rendering, browser storage stays clean, and no real shell/provider/cloud/IDE command was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close();
  await guiServer.close();
}

async function runBrowserPreviewScenario(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  try {
    await installNetworkPolicy(page);
    await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
    await expectVisibleText(page, "Verification commands", "browser verification command panel");
    await expectVisibleText(page, "browser preview only", "browser preview-only verification badge");
    await expectVisibleText(page, "Browser preview only. Open Yet AI in VS Code or JetBrains", "browser preview-only warning");
    const repositoryButton = page.getByRole("button", { name: "Repository check", exact: true });
    await repositoryButton.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await repositoryButton.isDisabled())) failures.push("Browser preview Repository check button was enabled.");
    await repositoryButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(150);
    await assertBrowserStorageDoesNotContain(page, [runtimeToken, forbiddenOutput, verificationOutput], "browser preview storage");
    await assertNoSecretLeak(await collectPageState(page), "browser preview page state");
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function runVsCodeScenario(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  try {
    await installNetworkPolicy(page);
    page.on("console", (message) => {
      const text = message.text();
      consoleMessages.push(text);
      if (containsSecret(text)) failures.push("Browser console exposed a verification smoke secret marker.");
    });
    page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`));
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
    const guiReady = await waitForGuiMessage(page, "gui.ready");
    if (guiReady?.version !== bridgeVersion || guiReady?.payload?.supportedBridgeVersion !== bridgeVersion) {
      failures.push("VS Code verification smoke did not collect strict gui.ready.");
    }
    await dispatchHostMessage(page, {
      version: bridgeVersion,
      type: "host.ready",
      requestId: guiReady?.requestId,
      payload: { runtimeUrl: runtimeBaseUrl, sessionToken: runtimeToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
    });
    await expectAttachedText(page, "bridge vscode", "VS Code bridge mode badge");
    await expectAttachedText(page, "Runtime connected", "mock runtime connection");
    await expectVisibleText(page, "Verification commands", "VS Code verification command panel");
    await expectVisibleText(page, "vscode explicit run", "VS Code explicit verification badge");

    const preClickCount = await getGuiMessageCount(page, "gui.ideActionRequest");
    const repositoryButton = page.getByRole("button", { name: "Repository check", exact: true });
    await repositoryButton.waitFor({ state: "visible", timeout: 10_000 });
    if (await repositoryButton.isDisabled()) failures.push("VS Code Repository check button was disabled before a request was pending.");
    await repositoryButton.click();
    const request = await waitForGuiMessageAfter(page, "gui.ideActionRequest", preClickCount);
    if (!request) {
      failures.push("Clicking Repository check did not post gui.ideActionRequest.");
      return;
    }
    if (request.version !== bridgeVersion) failures.push("Verification command request used the wrong bridge version.");
    if (typeof request.requestId !== "string" || !/^gui-verification-command-\d+$/.test(request.requestId)) failures.push("Verification command request id was not GUI-owned with the expected prefix.");
    if (!deepEqual(request.payload, { action: "runVerificationCommand", commandId: "repository-check" })) failures.push("Verification command request payload was not the strict allowlisted repository-check action.");
    if (hasForbiddenPrivilegedKeys(request.payload)) failures.push("Verification command request payload contained forbidden execution metadata.");

    const requestId = request.requestId;
    const duplicatePreCount = await getGuiMessageCount(page, "gui.ideActionRequest");
    await repositoryButton.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(150);
    const duplicatePostCount = await getGuiMessageCount(page, "gui.ideActionRequest");
    if (duplicatePostCount !== duplicatePreCount) failures.push("Pending verification command allowed a duplicate gui.ideActionRequest.");

    await dispatchHostMessage(page, {
      version: bridgeVersion,
      type: "host.ideActionProgress",
      requestId: `${requestId}-stale`,
      payload: { phase: "running", status: "inProgress", summary: "Stale verification progress must not render.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check" },
    });
    await page.waitForTimeout(100);
    await expectNoVisibleText(page, "Stale verification progress must not render.", "stale verification progress");

    await dispatchHostMessage(page, {
      version: bridgeVersion,
      type: "host.ideActionProgress",
      requestId,
      payload: { phase: "running", status: "inProgress", summary: "Repository check is running in the mock host.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check" },
    });
    await expectVisibleText(page, "Run verification command: inProgress", "verification progress status");
    await expectVisibleText(page, "Repository check is running in the mock host.", "verification progress summary");
    await expectVisibleText(page, "Verification pending…", "active verification pending button label");

    await dispatchHostMessage(page, {
      version: bridgeVersion,
      type: "host.ideActionResult",
      requestId,
      payload: { status: "succeeded", message: "Unsafe verification output must not render.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 0, durationMs: 12, outputTail: forbiddenOutput, truncated: false },
    });
    await page.waitForTimeout(150);
    await expectNoVisibleText(page, "Unsafe verification output must not render.", "unsafe verification result message");
    await expectNoVisibleText(page, "Authorization: Bearer", "unsafe verification authorization output");
    await expectVisibleText(page, "Run verification command: inProgress", "verification remains pending after unsafe result rejection");

    await dispatchHostMessage(page, {
      version: bridgeVersion,
      type: "host.ideActionResult",
      requestId,
      payload: { status: "succeeded", message: "Repository check completed in the mock host.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 0, durationMs: 34, outputTail: verificationOutput, truncated: false },
    });
    await expectVisibleText(page, "Run verification command: succeeded", "verification result status");
    await expectVisibleText(page, "Repository check completed in the mock host.", "verification result message");
    await expectVisibleText(page, "Command id: repository-check", "verification command id metadata");
    await expectVisibleText(page, "Exit code: 0", "verification exit code metadata");
    await expectVisibleText(page, "Duration: 34 ms", "verification duration metadata");
    await expectVisibleText(page, "Repository check passed.", "verification output tail");
    await expectVisibleText(page, "Output truncated: no", "verification truncation metadata");

    await dispatchHostMessage(page, {
      version: bridgeVersion,
      type: "host.ideActionResult",
      requestId,
      payload: { status: "failed", message: "Duplicate verification result must not replace the first result.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check" },
    });
    await page.waitForTimeout(150);
    await expectVisibleText(page, "Ignored duplicate IDE action result.", "duplicate verification result ignore note");
    await expectNoVisibleText(page, "Duplicate verification result must not replace the first result.", "duplicate verification result body");
    await expectVisibleText(page, "Run verification command: succeeded", "valid verification result remains after duplicate");

    await assertBrowserStorageDoesNotContain(page, [runtimeToken, forbiddenOutput, verificationOutput], "VS Code verification command storage");
    await assertNoSecretLeak(await collectPageState(page), "VS Code verification page state");
    if (!observedRuntimeAuthorization) failures.push("Mock runtime did not observe Authorization from host.ready session token.");
    assertNoRealCommandRequests();
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function installNetworkPolicy(page) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:8001/") && !url.startsWith(`${runtimeBaseUrl}/`)) {
      await route.abort();
      return;
    }
    if (isAllowedUrl(url, [guiBaseUrl, runtimeBaseUrl])) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request: ${redactUrl(url)}`);
    await route.abort();
  });
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactUrl(request.url())} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(guiBaseUrl) && (response.status() === 404 || response.status() >= 500)) {
      failures.push(`Broken packaged GUI response: ${response.status()} ${redactUrl(response.url())}`);
    }
  });
}

async function requirePackagedGui() {
  try {
    await assertPackagedGuiFreshness({ sourceRoot: guiDistRoot, packagedRoot: packagedGuiRoot, label: "VS Code packaged GUI assets" });
  } catch (error) {
    console.error("VS Code verification command smoke failed: packaged VS Code GUI assets are missing or stale.");
    console.error("Run `npm run prepare:vscode-preview` from the repository root before running this smoke.");
    console.error(`Expected packaged file: ${path.relative(root, packagedGuiIndex)}`);
    console.error(`Reason: ${messageOf(error)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code verification command smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
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
    runtimeRequestLog.push({ method: request.method ?? "GET", pathname: requestUrl.pathname });
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
      json(response, 200, { productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: ["chat"], features: {}, providers: [], ide: { bridge: true, lsp: false, host: "vscode-verification-command-smoke" } });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, demoModeResponse());
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: [demoModel()] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Mock-only verification command smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats") {
      json(response, 200, { chats: [] });
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

function demoModeResponse() {
  return { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Verification command smoke uses local canned responses only." };
}

function demoModel() {
  return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

function demoProvider() {
  return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } };
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

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
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

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function expectAttachedText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function expectNoVisibleText(page, text, description) {
  const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  if (visible) failures.push(`${description} rendered unexpectedly.`);
}

async function assertBrowserStorageDoesNotContain(page, markers, description) {
  const storageState = JSON.stringify(await page.evaluate(() => ({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
  })));
  for (const marker of markers) {
    if (marker && storageState.includes(marker)) failures.push(`Browser storage contained ${redactSecrets(marker)} during ${description}.`);
  }
}

async function collectPageState(page) {
  return JSON.stringify(await page.evaluate(() => ({
    domText: document.documentElement.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
    vscodeMessages: window.__yetAiVsCodeMessages,
    hostMessages: window.__yetAiHostMessages?.map((message) => ({ type: message?.type, requestId: message?.requestId, payloadKeys: Object.keys(message?.payload ?? {}) })),
  }))) + JSON.stringify(consoleMessages);
}

function assertNoSecretLeak(text, source) {
  if (containsSecret(text)) throw new Error(`Secret marker leaked through ${source}.`);
}

function assertNoRealCommandRequests() {
  const forbidden = runtimeRequestLog.filter((entry) => entry.pathname.includes("command") || entry.pathname.includes("verification"));
  if (forbidden.length > 0) failures.push(`Unexpected runtime command request(s): ${forbidden.map((entry) => `${entry.method} ${entry.pathname}`).join(", ")}.`);
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, accept" };
}

function json(response, status, body) {
  response.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isAllowedUrl(value, origins) {
  try { return origins.includes(new URL(value).origin); } catch { return false; }
}

function isPathInsideRoot(rootPath, requestedPath) {
  const relativePath = path.relative(rootPath, requestedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isJsOrCssAssetRequest(url, resourceType) {
  return url.startsWith(guiBaseUrl) && (resourceType === "script" || resourceType === "stylesheet" || /\.(js|css)$/.test(new URL(url).pathname));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasForbiddenPrivilegedKeys(value) {
  const forbidden = new Set(["shell", "command", "cwd", "env", "edit", "edits", "tool", "tools", "git", "task", "tasks", "applyWorkspaceEdit", "execute", "executeCommand"]);
  const visit = (current) => {
    if (!current || typeof current !== "object") return false;
    if (Array.isArray(current)) return current.some(visit);
    return Object.entries(current).some(([key, nested]) => forbidden.has(key) || visit(nested));
  };
  return visit(value);
}

function containsSecret(text) {
  const lower = String(text).toLowerCase();
  return [runtimeToken, forbiddenOutput, `Bearer ${runtimeToken}`].some((marker) => lower.includes(marker.toLowerCase()));
}

function redactSecrets(text) {
  return String(text)
    .split(runtimeToken).join("[redacted]")
    .split(forbiddenOutput).join("[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
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

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code verification command smoke failed:");
  for (const failure of failures) console.error(`- ${redactSecrets(failure)}`);
  process.exit(1);
}
