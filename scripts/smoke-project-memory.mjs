import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const timeoutMs = 120_000;
const token = `smoke-project-memory-token-${crypto.randomUUID()}`;
const fakeApiKey = `sk-smoke-project-memory-${crypto.randomUUID()}`;
const providerId = `smoke-project-memory-${Date.now()}`;
const chatId = `smoke-memory-chat-${crypto.randomUUID()}`;
const modelId = "smoke-project-memory-model";
const noteTitle = `Memory smoke ${crypto.randomUUID().slice(0, 8)}`;
const noteTag = "memory-smoke";
const memorySentinel = `PROJECT_MEMORY_SENTINEL_${crypto.randomUUID()}`;
const noteText = `Remember deterministic local project memory smoke marker ${memorySentinel}.`;
const userMessage = "Use the attached local project memory note and reply with the smoke acknowledgement.";
const assistantText = "Project memory smoke acknowledgement.";
const privatePathMarker = "/Users/example/private/project";
const secretMarkers = [token, fakeApiKey, `Bearer ${token}`, `Bearer ${fakeApiKey}`, "authorization: bearer", privatePathMarker];
const failures = [];
const providerRequestBodies = [];
let providerAuth;
let providerHits = 0;
let engine;
let guiServer;
let mockProvider;
let browser;
let tempHome;

try {
  await runCommand("npm", ["run", "build"], { cwd: guiRoot, label: "GUI build" });
  await requireBuiltGui();
  const { chromium } = await requireChromium();
  tempHome = await makeTempHome();
  mockProvider = await startMockProvider();
  guiServer = await startStaticServer(distRoot);
  const enginePort = await freePort();
  engine = startEngine(enginePort, tempHome);
  const runtimeBaseUrl = `http://127.0.0.1:${enginePort}`;
  const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
  await waitForEngine(runtimeBaseUrl);

  browser = await chromium.launch({ headless: true, args: ["--disable-web-security"] });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });
  await page.route("http://127.0.0.1:8001/v1/demo-mode", async (route) => {
    if (!["GET", "POST"].includes(route.request().method())) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
      body: JSON.stringify(demoModeDisabledResponse()),
    });
  });
  page.on("console", (message) => {
    const text = message.text();
    assertNoSecretLeak(text, "browser console");
    if (message.type() === "error" && !isExpectedFetchConsoleError(text)) {
      failures.push(`Browser console error: ${redactSecrets(text)}`);
    }
  });
  page.on("pageerror", (error) => {
    assertNoSecretLeak(error.message, "page error");
    failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`);
  });
  page.on("request", (request) => {
    if (!isLoopbackUrl(request.url())) {
      failures.push(`Non-loopback request attempted: ${redactUrl(request.url())}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactUrl(request.url())} (${request.failure()?.errorText ?? "unknown failure"})`);
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
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Refresh runtime" && !button.disabled), undefined, { timeout: 20_000 });
  await refreshButton.click();
  await expectAttachedText(page, "Runtime connected", "runtime connection feedback", 20_000);

  await page.getByRole("button", { name: "New provider" }).click();
  await page.getByLabel("Provider id").fill(providerId);
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Project Memory Smoke Provider");
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill(`${mockProvider.baseUrl}/v1`);
  await page.getByLabel("Auth").selectOption("api_key");
  await page.getByRole("textbox", { name: "API key" }).fill(fakeApiKey);
  await page.getByLabel("Model id").fill(modelId);
  await page.getByLabel("Model display name").fill(modelId);
  await page.getByRole("button", { name: "Create provider" }).click();
  await expectVisibleText(page, `Ready to send using ${modelId} through the local runtime.`, "chat readiness", 20_000);
  assert(providerHits === 0, "mock provider was called before explicit Send");

  await setChatId(page, chatId);
  await expectVisibleText(page, "Local project memory", "project memory panel", 20_000);
  await expectVisibleText(page, "No local memory notes are listed", "empty memory list", 20_000);
  await page.getByLabel("Memory title").fill(noteTitle);
  await page.getByLabel("Tags (comma separated)").fill(noteTag);
  await page.getByLabel("Memory note text").fill(noteText);
  await page.getByRole("button", { name: "Create memory note" }).click();
  await expectVisibleText(page, `Saved local memory note ${noteTitle}.`, "memory save status", 20_000);
  await expectVisibleText(page, `${noteText.length} chars`, "created memory note character count", 20_000);

  await page.getByLabel("Search local memory").fill(memorySentinel);
  await page.getByRole("button", { name: "Search memory" }).click();
  await expectVisibleText(page, "1 local memory note matched", "memory search result", 20_000);
  await expectVisibleText(page, noteTitle, "searched memory title", 20_000);

  await page.getByRole("button", { name: "Attach memory to next message" }).click();
  await expectVisibleText(page, `Attached local memory note ${noteTitle} to the next message context.`, "memory attach status", 20_000);
  await expectVisibleText(page, "Project memory", "project memory bundle item", 20_000);
  assert(providerHits === 0, "memory attach unexpectedly called mock provider");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessage);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessage, "visible memory-context user message", 20_000);
  await expectVisibleText(page, assistantText, "memory-context assistant response", 30_000);
  await expectVisibleText(page, "One-shot explicit context bundle attached to the last accepted message and cleared.", "memory bundle clear status", 20_000);
  await expectVisibleText(page, "empty", "empty explicit bundle after memory send", 20_000);

  await waitForProviderHits(1);
  assert(providerAuth === `Bearer ${fakeApiKey}`, "mock provider did not receive configured fake bearer key");
  assert(providerRequestBodies.length === 1, `mock provider received ${providerRequestBodies.length} chat request(s), expected 1`);
  const providerBody = JSON.parse(providerRequestBodies[0]);
  const providerPrompt = providerBody.messages?.[0]?.content;
  assert(providerBody.stream === true, "mock provider request was not streaming");
  assert(providerBody.model === modelId, "mock provider request used the wrong model");
  assert(typeof providerPrompt === "string" && providerPrompt.includes("IDE context bundle"), "provider prompt missed explicit context bundle");
  assert(providerPrompt.includes(`project memory noteId=`), "provider prompt missed project memory metadata");
  assert(providerPrompt.includes(`title=${noteTitle}`), "provider prompt missed memory title");
  assert(providerPrompt.includes(`tags=${noteTag}`), "provider prompt missed memory tag");
  assert(providerPrompt.includes(noteText), "provider prompt missed memory note text");
  assert(providerPrompt.includes(userMessage), "provider prompt missed user message");

  const bridgeMessages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const ideActionRequests = bridgeMessages.filter((message) => message?.type === "gui.ideActionRequest");
  const applyRequests = bridgeMessages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest");
  assert(ideActionRequests.length === 0, `project memory smoke emitted IDE action request(s): ${ideActionRequests.map((message) => message?.payload?.action).join(",")}`);
  assert(applyRequests.length === 0, "project memory smoke emitted workspace edit apply request(s)");

  await page.getByRole("button", { name: "Delete memory" }).click();
  await expectVisibleText(page, `Deleted local memory note ${noteTitle}.`, "memory delete status", 20_000);
  await page.getByLabel("Search local memory").fill(memorySentinel);
  await page.getByRole("button", { name: "Search memory" }).click();
  await expectVisibleText(page, "0 local memory notes matched", "memory deleted search result", 20_000);

  const runtimeListAfterDelete = await requestJson(runtimeBaseUrl, "/v1/project-memory");
  assert(Array.isArray(runtimeListAfterDelete.notes) && runtimeListAfterDelete.notes.length === 0, "runtime project memory list was not empty after delete");

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
  assert(!storageText.includes(memorySentinel) && !storageText.includes(noteTitle), "project memory note persisted in browser storage");
  assertNoSecretLeak(JSON.stringify(pageState), "DOM or browser storage");
  assertNoSecretLeak(engine.output(), "engine output");

  if (failures.length > 0) {
    throw new Error(`Project memory smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Project memory smoke passed.");
  console.log("Verified loopback GUI/runtime flow: create manual memory note, list/search, explicit one-shot attach, send through one mock provider call, clear attached context after accepted Send, delete note, no browser storage persistence, no IDE workspace reads, no non-loopback requests, and no secret/private path leakage.");
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

async function runCommand(command, args, { cwd, label }) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code}.\n${redactSecrets(output)}`));
      }
    });
  });
}

async function requireBuiltGui() {
  const fileStat = await stat(indexPath);
  if (!fileStat.isFile()) {
    throw new Error(`Built GUI index is not a file: ${path.relative(root, indexPath)}`);
  }
  const html = await readFile(indexPath, "utf8");
  assert(html.includes("/assets/") || html.includes("./assets/"), "built GUI index.html does not reference Vite assets");
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(`Playwright is not installed or cannot be loaded. Run npm install and npx playwright install chromium. ${messageOf(error)}`);
  }
}

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-project-memory-smoke-${process.pid}-${Date.now()}`);
  await mkdir(path.join(home, "Library", "Application Support"), { recursive: true });
  await mkdir(path.join(home, ".config"), { recursive: true });
  await mkdir(path.join(home, ".cache"), { recursive: true });
  return home;
}

function startEngine(port, home) {
  const child = spawn("cargo", ["run", "-p", "yet-lsp", "--quiet"], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      CARGO_HOME: process.env.CARGO_HOME ?? path.join(process.env.HOME ?? home, ".cargo"),
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(process.env.HOME ?? home, ".rustup"),
      YET_AI_AUTH_TOKEN: token,
      YET_AI_HTTP_PORT: String(port),
      NO_PROXY: appendNoProxy(process.env.NO_PROXY),
      no_proxy: appendNoProxy(process.env.no_proxy),
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
  while (Date.now() - started < timeoutMs) {
    if (engine.exitCode !== null) {
      throw new Error(`Engine exited before becoming ready.\n${engine.output()}`);
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
  throw new Error(`Engine did not become ready within ${timeoutMs}ms.\n${engine.output()}`);
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
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write("data: " + JSON.stringify({ choices: [{ delta: { content: assistantText } }] }) + "\n\n");
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

async function requestJson(baseUrl, route, init = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      ...authHeaders(),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request ${route} returned unexpected HTTP status ${response.status}: ${redactSecrets(text)}`);
  }
  return JSON.parse(text);
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

async function setChatId(page, value) {
  await page.getByTestId("chat-advanced-controls").evaluate((element) => {
    if (element instanceof HTMLDetailsElement) element.open = true;
  });
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

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function demoModeDisabledResponse() {
  return { enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality. Configure a BYOK provider for real answers." };
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

function appendNoProxy(value) {
  const entries = new Set(String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
  for (const entry of ["127.0.0.1", "localhost", "::1"]) {
    entries.add(entry);
  }
  return [...entries].join(",");
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function isJsOrCssAssetRequest(url, resourceType) {
  return url.startsWith("http://127.0.0.1:") && (resourceType === "script" || resourceType === "stylesheet" || new URL(url).pathname.endsWith(".js") || new URL(url).pathname.endsWith(".css"));
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
  for (const marker of [...secretMarkers, memorySentinel]) {
    if (marker) {
      redacted = redacted.split(marker).join("[redacted]");
    }
  }
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
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
