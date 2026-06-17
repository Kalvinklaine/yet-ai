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
const token = `smoke-local-runtime-token-${randomUUID()}`;
const providerId = `smoke-ollama-local-${Date.now()}`;
const chatId = `smoke-local-chat-${randomUUID()}`;
const modelId = "smoke-llama-local";
const providerName = "Smoke Ollama Local";
const userMessage = "Say hello from local Ollama smoke.";
const assistantText = "Hello from mock local Ollama provider.";
const fakeProviderSecret = `sk-local-provider-secret-${randomUUID()}`;
const fakeCookie = `cookie-local-provider-${randomUUID()}`;
const fakePrivatePath = `/Users/smoke/private-${randomUUID()}`;
const secretMarkers = [
  token,
  fakeProviderSecret,
  fakeCookie,
  fakePrivatePath,
  `Bearer ${token}`,
  `Bearer ${fakeProviderSecret}`,
  "authorization: bearer",
  "provider secret",
];
const failures = [];
const runtimeRequests = [];
const ollamaRequests = [];
let engine;
let guiServer;
let mockOllama;
let tempHome;
let browser;

await requireBuiltGui();
await requireEngineBinary();
const { chromium } = await requireChromium();

try {
  tempHome = await makeTempHome();
  mockOllama = await startMockOllama();
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
  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });

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
    if (url.startsWith(`${runtimeBaseUrl}/`)) {
      const authorization = request.headers().authorization;
      const hasExpectedLocalAuth = authorization === `Bearer ${token}`;
      runtimeRequests.push({ method: request.method(), url: redactUrl(url), hasExpectedLocalAuth });
      if (!hasExpectedLocalAuth) {
        failures.push(`Runtime request missed local auth token: ${request.method()} ${redactUrl(url)}`);
      }
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
  const guiReady = await waitForGuiMessage(page, "gui.ready");
  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.ready",
    requestId: guiReady?.requestId,
    payload: { runtimeUrl: runtimeBaseUrl, sessionToken: token, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await expectAttachedText(page, "Host runtime settings received", "host runtime settings bridge log", 20_000);

  const refreshButton = page.locator("section", { has: page.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: "Refresh runtime" });
  await openDetailsBySummary(page, "Local runtime connection", refreshButton);
  await refreshButton.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Refresh runtime" && !button.disabled), undefined, { timeout: 20_000 });
  await refreshButton.click();
  await expectAttachedText(page, "Runtime connected", "runtime connection feedback", 20_000);

  await page.getByRole("button", { name: "Ollama local (native)" }).click();
  await page.getByLabel("Provider id").fill(providerId);
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill(providerName);
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill(mockOllama.baseUrl);
  await page.getByLabel("Auth").selectOption("none");
  await page.getByRole("textbox", { name: "API key" }).fill(fakeProviderSecret);
  await page.getByLabel("Model id").fill(modelId);
  await page.getByLabel("Model display name").fill(modelId);
  await page.getByRole("button", { name: "Create provider" }).click();
  await expectVisibleText(page, providerName, "created local provider", 20_000);
  await expectVisibleText(page, `Ready to send using ${modelId} through the local runtime directly to your local provider.`, "local-provider chat readiness", 20_000);
  await expectVisibleText(page, "Provider send ready", "local-provider send-ready checkpoint", 20_000);

  await setChatId(page, chatId);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessage);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessage, "visible local-provider user chat bubble", 20_000);
  await expectVisibleText(page, assistantText, "streamed local-provider assistant response", 30_000);
  await assertAssistantAnswerCount(page, assistantText, 1, "streamed local-provider assistant response");
  await waitForOllamaRequests(1);

  assert(runtimeRequests.length > 0, "GUI did not issue any runtime requests to assert local auth on");
  assert(ollamaRequests.length === 1, `mock Ollama received ${ollamaRequests.length} chat request(s), expected 1`);
  const ollamaRequest = ollamaRequests[0];
  assert(ollamaRequest.url === "/api/chat", `mock Ollama request used unexpected path: ${ollamaRequest.url}`);
  assert(!ollamaRequest.authorization, "native Ollama request unexpectedly included an Authorization header");
  assert(!ollamaRequest.cookie, "native Ollama request unexpectedly included a Cookie header");
  const parsedOllamaBody = JSON.parse(ollamaRequest.body);
  assert(parsedOllamaBody.model === modelId, "mock Ollama request used the wrong model");
  assert(parsedOllamaBody.stream === true, "mock Ollama request was not streaming");
  assert(parsedOllamaBody.messages?.[0]?.content === userMessage, "mock Ollama request missed first user message");

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
  assertNoSecretLeak(JSON.stringify(runtimeRequests), "runtime request evidence");
  assertNoSecretLeak(JSON.stringify(ollamaRequests), "mock Ollama request evidence");

  if (failures.length > 0) {
    throw new Error(`Local provider first-message smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Local provider first-message smoke passed.");
  console.log("Verified built GUI, loopback runtime, mock native Ollama provider setup, send-ready local-provider readiness, one first message, streamed assistant response rendering, runtime local auth on every runtime request, native Ollama no-auth request, and sanitized DOM/storage/evidence.");
  console.log("No real Ollama server, provider credentials, non-loopback URL, hosted Yet AI service, IDE launch, signing, publication, or cloud workspace was used.");
} finally {
  await browser?.close().catch(() => undefined);
  if (engine) {
    await stopProcess(engine);
  }
  if (mockOllama) {
    await closeServer(mockOllama.server).catch(() => undefined);
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
        "Run `cd apps/gui && npm run build` before `npm run smoke:local-provider-first-message`.",
      ]);
    }
  } catch {
    failActionable("built GUI is missing.", [
      "Run `cd apps/gui && npm run build` before `npm run smoke:local-provider-first-message`.",
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
      "Run `cargo build -p yet-lsp` before `npm run smoke:local-provider-first-message`.",
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
  const home = path.join(os.tmpdir(), `yet-ai-local-provider-smoke-${process.pid}-${Date.now()}`);
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

async function startMockOllama() {
  const server = http.createServer((request, response) => {
    if (request.url === "/api/tags" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ models: [{ name: modelId, model: modelId }] }));
      return;
    }
    if (request.url !== "/api/chat" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      ollamaRequests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        body,
      });
      response.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
      });
      response.write(`${JSON.stringify({ message: { role: "assistant", content: assistantText }, done: false })}\n`);
      response.end(`${JSON.stringify({ done: true })}\n`);
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

async function waitForGuiMessage(page, type) {
  await page.waitForFunction((messageType) => window.__yetAiVsCodeMessages?.some((message) => message?.type === messageType), type, { timeout: 10_000 });
  return await page.evaluate((messageType) => window.__yetAiVsCodeMessages.find((message) => message?.type === messageType), type);
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
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 6000)}`);
  }
}

async function expectAttachedText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 6000)}`);
  }
}

async function assertAssistantAnswerCount(page, text, expected, description) {
  const count = await page.locator(".chat-bubble.assistant").evaluateAll(
    (elements, answer) => elements.filter((element) => element.textContent?.includes(String(answer))).length,
    text,
  );
  assert(count === expected, `Expected ${description} to appear exactly ${expected} time(s) in assistant bubbles, observed ${count}: ${text}`);
}

async function openAdvancedChatControls(page) {
  await page.getByTestId("chat-advanced-controls").evaluate((element) => {
    if (element instanceof HTMLDetailsElement) element.open = true;
  });
  await page.getByLabel("Chat id").waitFor({ state: "attached", timeout: 10_000 });
}

async function setChatId(page, value) {
  await openAdvancedChatControls(page);
  await page.getByLabel("Chat id").evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function openDetailsBySummary(page, summaryText, visibleLocator) {
  if (await visibleLocator.isVisible().catch(() => false)) return;
  const summary = page.locator("summary", { hasText: summaryText }).first();
  await summary.click({ timeout: 5000 }).catch(async () => {
    await page.locator("details", { hasText: summaryText }).first().evaluate((element) => {
      if (element instanceof HTMLDetailsElement) element.open = true;
    });
  });
  await visibleLocator.waitFor({ state: "visible", timeout: 10_000 });
}

async function waitForOllamaRequests(expected) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (ollamaRequests.length >= expected) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expected} mock Ollama request(s); received ${ollamaRequests.length}.`);
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
  const value = String(text);
  const lower = value.toLowerCase();
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
  console.error(`Local provider first-message smoke failed: ${summary}`);
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
