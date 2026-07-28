import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const binary = path.join(root, "target", "debug", process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName);
const token = `command-center-${randomUUID()}`;
const noteBody = `Architecture preference ${randomUUID().replaceAll("-", "")}`;
const sentMessage = `MANUAL_SEND_${randomUUID()}`;
const timeoutMs = 30_000;
let tempRoot;
let child;
let childExit;
let browser;
let stdout = "";
let stderr = "";
const failures = [];
const commandBodies = [];
const criticalResponseFailures = [];

try {
  await requireFile(binary);
  await requireFile(path.join(distRoot, "index.html"));
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-command-center-"));
  const home = path.join(tempRoot, "home");
  const projectRoot = path.join(home, "workspace");
  await mkdir(projectRoot, { recursive: true });
  const env = isolatedEnvironment(home);
  const project = JSON.parse(await runCli(env, ["project", "add", projectRoot, "--name", "Command Center Project"]));
  await runCli(env, ["project", "open", project.projectId]);

  const port = await allocatePort();
  child = spawn(binary, [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, YET_AI_HTTP_PORT: String(port), YET_AI_AUTH_TOKEN: token, YET_AI_WEB_UI_DIST_DIR: distRoot },
  });
  child.stdout.on("data", (chunk) => { stdout = remember(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = remember(stderr, chunk); });
  childExit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  await waitForEngine(port);

  const api = createApi(port);
  await api("POST", "/v1/demo-mode", { enabled: true });
  const chat = await api("POST", `/p/${project.projectId}/v1/chats`);
  const memory = await api("POST", `/p/${project.projectId}/v1/project-memory`, {
    protocolVersion: "2026-06-17",
    title: "Selected architecture memory",
    text: noteBody,
    tags: ["architecture"],
    source: "manual",
  });
  const now = new Date().toISOString();
  await api("POST", `/p/${project.projectId}/v1/agent-progress/events`, progressEvent("active-event", "active-run", "T-149", "started", "running", "Active continuity", now));
  await api("POST", `/p/${project.projectId}/v1/agent-progress/events`, progressEvent("blocked-event", "blocked-run", "T-150", "failed", "failed", "Blocked continuity", now));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) failures.push(`console error: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) failures.push(`non-loopback request: ${url.origin}`);
    if (url.pathname.startsWith(`/p/${project.projectId}/v1/chats/`) && url.pathname.endsWith("/commands") && request.method() === "POST") commandBodies.push(request.postData() ?? "");
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const expectedNavigationAbort = url.pathname.endsWith("/v1/chats/subscribe") && request.failure()?.errorText.includes("ERR_ABORTED");
    if (!expectedNavigationAbort && isCriticalAppRequest(url)) failures.push(`critical request failed: ${request.method()} ${url.pathname} ${request.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (isCriticalAppRequest(url) && response.status() >= 400) criticalResponseFailures.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await page.goto(`${baseUrl}/projects`);
  await expectText(page, "Projects");
  await page.getByRole("link", { name: "Open project Command Center Project" }).click();
  await page.waitForURL(`${baseUrl}/p/${project.projectId}/`);
  await expectText(page, "Command Center Project command center");
  await expectText(page, "Local runtime");
  await expectText(page, "ready provider-model pairing");
  await expectText(page, "Selected architecture memory");
  await expectText(page, "T-149");
  await expectText(page, "In progress");
  await expectText(page, "T-150");
  await expectText(page, "Needs attention");
  const homeEvidence = await page.locator("body").innerText();
  assert(!homeEvidence.includes(noteBody), "Command center exposed a memory note body.");

  await page.getByLabel("Select Selected architecture memory").check();
  const createResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/p/${project.projectId}/v1/chats` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start new chat", exact: true }).click();
  assert((await createResponse).ok(), "Start new chat create request was not accepted.");
  await page.waitForURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/p/${project.projectId}/chat/[A-Za-z0-9_-]+`));
  const finalChatId = page.url().split("/").at(-1);
  assert(Boolean(finalChatId) && finalChatId !== chat.chatId, "Start new did not bind the engine-issued fresh chat id.");
  await expectText(page, "Selected project memory attached for review");
  await expectText(page, noteBody);
  assert(commandBodies.length === 0, "Selecting memory and resuming sent a command before manual Send.");

  const composer = page.locator('[data-testid="chat-composer"] textarea');
  await composer.fill(sentMessage);
  const commandResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/p/${project.projectId}/v1/chats/${finalChatId}/commands` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  assert((await commandResponse).ok(), "Manual Send command was not accepted.");
  await expectText(page, sentMessage);
  assert(commandBodies.length === 1, `Expected one manual command, observed ${commandBodies.length}.`);
  const command = JSON.parse(commandBodies[0]);
  const commandEvidence = JSON.stringify(command);
  assert(commandEvidence.includes(sentMessage), "Manual command omitted the typed message.");
  assert(commandEvidence.includes(noteBody), "Manual command omitted explicit project-memory context.");
  await page.getByLabel("Selected project memory attached for next send").waitFor({ state: "detached", timeout: timeoutMs }).catch(async () => {
    assert(!await page.getByLabel("Selected project memory attached for next send").isVisible().catch(() => false), "Accepted Send did not clear the one-shot attachment.");
  });
  assert((await page.locator('[data-testid="chat-composer"]').innerText()).includes("Next send: prompt only"), "Accepted Send did not reset the next-send context.");

  await page.goto(`${baseUrl}/p/${project.projectId}/`);
  await expectText(page, "T-149");
  const commandsBeforeProgress = commandBodies.length;
  await page.getByRole("button", { name: "Open T-149 in Agent" }).click();
  await page.waitForURL(`${baseUrl}/p/${project.projectId}/agent`);
  assert(commandBodies.length === commandsBeforeProgress, "Opening active work implicitly resumed or started execution.");
  await page.getByText("Agent progress", { exact: true }).click();
  await expectText(page, "Active continuity");
  assert(page.url() === `${baseUrl}/p/${project.projectId}/agent`, "Active work navigation escaped its project scope.");

  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => { const key = localStorage.key(index) ?? ""; return [key, localStorage.getItem(key)]; })),
    session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => { const key = sessionStorage.key(index) ?? ""; return [key, sessionStorage.getItem(key)]; })),
    documentCookie: document.cookie,
  }));
  const storageEvidence = JSON.stringify(storage);
  for (const forbidden of [sentMessage, noteBody, token, projectRoot, memory.id, "selectedNoteIds", "project_home", "raw payload"]) {
    assert(!storageEvidence.includes(forbidden), "Browser storage retained private command-center evidence.");
  }
  const cookies = await context.cookies();
  assert(cookies.some((cookie) => cookie.name === "yet_ai_loopback_session" && cookie.httpOnly), "Loopback session cookie was missing or not HttpOnly.");
  for (const forbidden of [token, noteBody, sentMessage, projectRoot]) {
    assert(!JSON.stringify(cookies).includes(forbidden), "Browser cookie metadata exposed private command-center evidence.");
  }
  assert(criticalResponseFailures.length === 0, `Unexpected critical non-2xx responses:\n${criticalResponseFailures.join("\n")}`);
  assert(failures.length === 0, failures.join("\n"));
  const output = `${stdout}\n${stderr}`;
  assert(!output.includes(token) && !output.includes(projectRoot) && !output.includes(noteBody), "Runtime output exposed private smoke evidence.");
  console.log("Project Command Center smoke passed.");
  console.log("Verified built GUI dashboard, explicit memory-to-chat Send, one-shot clear, and project-scoped progress continuity using loopback-only fixtures.");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  const tail = redact(`${stdout}\n${stderr}`.trim());
  if (tail) console.error(`Runtime output tail:\n${tail}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([childExit, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

async function requireFile(candidate) {
  try {
    if (!(await stat(candidate)).isFile()) throw new Error();
  } catch {
    throw new Error(`Missing smoke prerequisite ${path.relative(root, candidate)}.`);
  }
}

function isolatedEnvironment(home) {
  return { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache") };
}

function runCli(env, args) {
  return new Promise((resolve, reject) => {
    const command = spawn(binary, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    command.stdout.on("data", (chunk) => { output += chunk; });
    command.stderr.on("data", (chunk) => { errors += chunk; });
    command.once("error", reject);
    command.once("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Engine CLI failed (${code}): ${errors.trim()}`)));
  });
}

function createApi(port) {
  return async (method, pathname, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert(response.ok, `${method} ${pathname} returned ${response.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

function progressEvent(eventId, runId, cardId, phase, status, message, timestamp) {
  return { protocolVersion: "2026-05-29", eventId, runId, cardId, timestamp, phase, status, message };
}

function isCriticalAppRequest(url) {
  return ["127.0.0.1", "localhost", "::1"].includes(url.hostname) && (url.pathname.startsWith("/v1/") || url.pathname.includes("/v1/"));
}

async function expectText(page, text) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${JSON.stringify(text)} at ${page.url()}. Body: ${redact(body).slice(0, 3000)}`);
  }
}

async function waitForEngine(port) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for the loopback runtime.");
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : address && typeof address === "object" ? resolve(address.port) : reject(new Error("Could not allocate a port.")));
    });
  });
}

function remember(target, chunk) {
  return (target + chunk.toString("utf8")).slice(-8_000);
}

function redact(value) {
  return String(value).split(token).join("[REDACTED]").split(noteBody).join("[REDACTED]").split(tempRoot ?? "never-match").join("[TEMP]");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
