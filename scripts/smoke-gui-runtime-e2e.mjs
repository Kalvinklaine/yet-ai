import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const engineBinary = path.join(root, "target", "debug", process.platform === "win32" ? "yet-lsp.exe" : "yet-lsp");
const timeoutMs = 120_000;
const token = `smoke-runtime-token-${randomUUID()}`;
const fakeApiKey = `sk-smoke-secret-${randomUUID()}`;
const providerId = `smoke-provider-${Date.now()}`;
const chatId = `smoke-chat-${randomUUID()}`;
const modelId = "smoke-model";
const providerName = "Smoke Mock Provider";
const userMessageWithContext = "Say hello from GUI runtime smoke with attached context.";
const userMessageWithoutContext = "Say hello from GUI runtime smoke without attached context.";
const assistantText = "Hello smoke from mock provider.";
const activeContextSentinel = `ACTIVE_CONTEXT_SENTINEL_${"x".repeat(64)}`;
const activeContextText = `function smokeContext() { return "${activeContextSentinel}"; }`;
const activeContextPath = "src/smoke-context.ts";
const secretMarkers = [
  token,
  fakeApiKey,
  activeContextSentinel,
  `Bearer ${token}`,
  `Bearer ${fakeApiKey}`,
  "authorization: bearer",
  "provider secret",
];
const failures = [];
let engine;
let guiServer;
let mockProvider;
let tempHome;
let browser;
let providerAuth;
const providerRequestBodies = [];
let providerHits = 0;

await requireBuiltGui();
await requireEngineBinary();
const { chromium } = await requireChromium();

try {
  tempHome = await makeTempHome();
  mockProvider = await startMockProvider();
  guiServer = await startStaticServer(distRoot);
  const enginePort = await freePort();
  engine = startEngine(enginePort, tempHome);
  const runtimeBaseUrl = `http://127.0.0.1:${enginePort}`;
  const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
  await waitForEngine(runtimeBaseUrl);

  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  } catch (error) {
    failActionable("Playwright Chromium is not installed or cannot be launched.", [
      "Run `npm install` from the repository root if needed.",
      "Run `npx playwright install chromium`.",
      `Launch error: ${messageOf(error)}`,
    ]);
  }

  const page = await browser.newPage();
  const browserVisible = [];
  page.on("console", (message) => {
    const text = message.text();
    browserVisible.push(text);
    assertNoSecretLeak(text, "browser console");
    if (message.type() === "error" && !isExpectedFetchConsoleError(text)) {
      failures.push(`Browser console error: ${redactSecrets(text)}`);
    }
  });
  page.on("pageerror", (error) => {
    const text = error.message;
    browserVisible.push(text);
    assertNoSecretLeak(text, "page error");
    failures.push(`Page JavaScript error: ${redactSecrets(text)}`);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!isLoopbackUrl(url)) {
      failures.push(`Non-loopback request attempted: ${redactUrl(url)}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactUrl(request.url())} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isStaticServerAsset(url) && (response.status() === 404 || response.status() >= 500)) {
      failures.push(`Broken local asset response: ${response.status()} ${redactUrl(url)}`);
    }
  });

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });

  await page.getByLabel("Runtime base URL").fill(runtimeBaseUrl);
  await page.getByRole("textbox", { name: "Session token", exact: true }).fill(token);
  const refreshButton = page.locator("section", { has: page.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: "Refresh runtime" });
  await refreshButton.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Refresh runtime" && !button.disabled), undefined, { timeout: 20_000 });
  await refreshButton.click();
  await expectVisibleText(page, "Runtime connected", "runtime connection feedback", 20_000);
  await expectVisibleText(page, "runtime connected", "runtime connected badge", 20_000);

  await page.getByRole("button", { name: "New provider" }).click();
  await page.getByLabel("Provider id").fill(providerId);
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill(providerName);
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill(`${mockProvider.baseUrl}/v1`);
  await page.getByLabel("Auth").selectOption("api_key");
  await page.getByRole("textbox", { name: "API key" }).fill(fakeApiKey);
  await page.getByLabel("Model id").fill(modelId);
  await page.getByLabel("Model display name").fill(modelId);
  await page.getByRole("button", { name: "Create provider" }).click();
  await expectVisibleText(page, providerName, "created provider", 20_000);
  await expectVisibleText(page, `Ready to send using ${modelId}.`, "chat readiness", 20_000);

  await page.getByLabel("Chat id").fill(chatId);
  await deliverActiveContext(page);
  await expectVisibleText(page, "Active editor context", "active editor context card", 20_000);
  await expectVisibleText(page, activeContextPath, "active context file path", 20_000);
  await expectVisibleText(page, "Selected characters:", "active context selected character count", 20_000);
  await expectVisibleText(page, "Attach to next message", "active context include state", 20_000);
  await assertContextSentinelNotVisible(page, "bounded active context preview");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageWithContext);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessageWithContext, "visible included-context user chat bubble", 20_000);
  await expectVisibleText(page, assistantText, "included-context streamed assistant response", 30_000);
  await expectVisibleText(page, "Context attached to the last accepted message", "one-shot context attached status", 20_000);

  await deliverActiveContext(page);
  await expectVisibleText(page, "Attach to next message", "refreshed active context include state", 20_000);
  await page.locator("label.attached-context-toggle", { hasText: "Attach to next message" }).getByRole("checkbox").uncheck();
  await expectVisibleText(page, "Do not attach", "active context omit state", 20_000);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageWithoutContext);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessageWithoutContext, "visible omitted-context user chat bubble", 20_000);
  await expectVisibleText(page, assistantText, "omitted-context streamed assistant response", 30_000);
  await waitForProviderHits(2);

  assert(providerAuth === `Bearer ${fakeApiKey}`, "mock provider did not receive the configured fake bearer key");
  assert(providerRequestBodies.length === 2, `mock provider received ${providerRequestBodies.length} chat request(s), expected 2`);
  const parsedProviderBodies = providerRequestBodies.map((body) => JSON.parse(body));
  const includedPrompt = parsedProviderBodies[0].messages?.[0]?.content;
  const omittedPrompt = parsedProviderBodies[1].messages?.[0]?.content;
  assert(parsedProviderBodies.every((body) => body.stream === true), "mock provider requests were not streaming");
  assert(parsedProviderBodies.every((body) => body.model === modelId), "mock provider request used the wrong model");
  assert(typeof includedPrompt === "string" && includedPrompt.includes("IDE context"), "included-context request did not prepend IDE context");
  assert(includedPrompt.includes(`Workspace-relative path: ${activeContextPath}`), "included-context request missed active file path");
  assert(includedPrompt.includes(activeContextSentinel), "included-context request missed bounded active selection text");
  assert(includedPrompt.includes(userMessageWithContext), "included-context request missed user content");
  assert(omittedPrompt === userMessageWithoutContext, "omitted-context request unexpectedly included IDE context");
  assert(!omittedPrompt.includes(activeContextSentinel), "omitted-context request leaked active context sentinel");

  await exerciseHistoryReload(page, runtimeBaseUrl);

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
  assertNoSecretLeak(JSON.stringify(pageState), "DOM or browser storage");
  assertNoSecretLeak(JSON.stringify(browserVisible), "browser console/page errors");

  if (failures.length > 0) {
    throw new Error(`GUI runtime e2e smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("GUI runtime e2e smoke passed.");
  console.log("Verified built GUI, loopback runtime, mock OpenAI-compatible streaming provider, IDE-like active context include/omit, streamed chat responses, local history reload, and browser-state redaction.");
  console.log("No OpenAI/ChatGPT, hosted Yet AI service, non-loopback URL, IDE, or real provider credential was used.");
} finally {
  await browser?.close().catch(() => undefined);
  if (engine) {
    await stopProcess(engine);
  }
  if (mockProvider) {
    await closeServer(mockProvider.server).catch(() => undefined);
  }
  if (guiServer) {
    await guiServer.close().catch(() => undefined);
  }
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
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
      failActionable("Built GUI index.html does not reference Vite assets.", [
        "Run `cd apps/gui && npm run build` before `npm run smoke:gui-runtime-e2e`.",
      ]);
    }
  } catch {
    failActionable("built GUI is missing.", [
      "Run `cd apps/gui && npm run build` before `npm run smoke:gui-runtime-e2e`.",
      `Expected file: ${path.relative(root, indexPath)}`,
    ]);
  }
}

async function requireEngineBinary() {
  try {
    const fileStat = await stat(engineBinary);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
  } catch {
    failActionable("engine binary is missing.", [
      "Run `cargo build -p yet-lsp` before `npm run smoke:gui-runtime-e2e`.",
      `Expected file: ${path.relative(root, engineBinary)}`,
    ]);
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

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-gui-e2e-${process.pid}-${Date.now()}`);
  await mkdir(path.join(home, "Library", "Application Support"), { recursive: true });
  await mkdir(path.join(home, ".config"), { recursive: true });
  await mkdir(path.join(home, ".cache"), { recursive: true });
  return home;
}

function startEngine(port, home) {
  const child = spawn(engineBinary, [], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      YET_AI_AUTH_TOKEN: token,
      YET_AI_HTTP_PORT: String(port),
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.output = () => redactSecrets(output);
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      failures.push(`Engine exited with code ${code}.`);
    } else if (signal && signal !== "SIGTERM") {
      failures.push(`Engine exited with signal ${signal}.`);
    }
  });
  return child;
}

async function waitForEngine(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (engine.exitCode !== null) {
      failActionable("runtime exited before becoming ready.", [engine.output()]);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/ping`, { headers: authHeaders() });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
    }
    await delay(250);
  }
  failActionable("runtime did not become ready before the startup timeout.", [
    "Check that `cargo build -p yet-lsp` succeeds and no local security software blocks loopback servers.",
    engine.output(),
  ]);
}

async function startMockProvider() {
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/v1/chat/completions") || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    providerHits += 1;
    providerAuth = request.headers.authorization;
    let requestBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      providerRequestBodies.push(requestBody);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"smoke "}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"from mock provider."}}]}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const fileStat = await stat(requestedPath);
      if (!fileStat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(requestedPath) });
      createReadStream(requestedPath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return {
    port: address.port,
    close: () => closeServer(server),
  };
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 6000)}`);
  }
}

async function deliverActiveContext(page) {
  await page.evaluate(({ text, path }) => {
    window.postMessage({
      version: "2026-05-15",
      type: "host.contextSnapshot",
      requestId: "smoke-context-001",
      payload: {
        kind: "active_editor",
        source: "vscode",
        file: {
          displayPath: path,
          workspaceRelativePath: path,
          languageId: "typescript",
        },
        selection: {
          startLine: 12,
          startCharacter: 2,
          endLine: 12,
          endCharacter: 80,
          text,
        },
      },
    }, window.location.origin);
  }, { text: activeContextText, path: activeContextPath });
}

async function assertContextSentinelNotVisible(page, description) {
  const body = await page.locator("body").innerText();
  assert(!body.includes(activeContextSentinel), `${description} leaked the active context sentinel`);
}

async function waitForProviderHits(expected) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (providerHits >= expected) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expected} mock provider request(s); received ${providerHits}.`);
}

async function exerciseHistoryReload(page, runtimeBaseUrl) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await page.getByLabel("Runtime base URL").fill(runtimeBaseUrl);
  await page.getByRole("textbox", { name: "Session token", exact: true }).fill(token);
  await assertContextSentinelNotVisible(page, "browser storage after reload before refresh");
  const refreshButton = page.locator("section", { has: page.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: "Refresh runtime" });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Refresh runtime" && !button.disabled), undefined, { timeout: 20_000 });
  await refreshButton.click();
  await expectVisibleText(page, "Runtime connected", "runtime connection after reload", 20_000);
  await expectVisibleText(page, userMessageWithContext, "persisted included-context message after reload", 20_000);
  await expectVisibleText(page, userMessageWithoutContext, "persisted omitted-context message after reload", 20_000);
  await expectVisibleText(page, assistantText, "persisted assistant response after reload", 20_000);
  await assertContextSentinelNotVisible(page, "reloaded history DOM");
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function freePort() {
  const server = http.createServer();
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  const port = address.port;
  await closeServer(server);
  return port;
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

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => false),
  ]);
  if (exited === false) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function isJsOrCssAssetRequest(url, resourceType) {
  return isStaticServerAsset(url) && (resourceType === "script" || resourceType === "stylesheet" || isJsOrCssAssetUrl(url));
}

function isStaticServerAsset(url) {
  return url.startsWith("http://127.0.0.1:");
}

function isJsOrCssAssetUrl(value) {
  const pathname = new URL(value).pathname;
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}

function isExpectedFetchConsoleError(text) {
  return /^Failed to load resource: (net::ERR_CONNECTION_REFUSED|the server responded with a status of 401 \(Unauthorized\))$/.test(text);
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "ws:") && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
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

function assertNoSecretLeak(text, source) {
  const lower = String(text).toLowerCase();
  for (const marker of secretMarkers) {
    if (marker && lower.includes(marker.toLowerCase())) {
      throw new Error(`Secret marker leaked through ${source}.`);
    }
  }
}

function redactSecrets(text) {
  let redacted = String(text);
  for (const marker of secretMarkers) {
    if (marker) {
      redacted = redacted.split(marker).join("[redacted]");
    }
  }
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

function failActionable(summary, lines) {
  console.error(`GUI runtime e2e smoke failed: ${summary}`);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
