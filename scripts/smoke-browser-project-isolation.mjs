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
const binaryName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const binary = path.join(root, "target", "debug", binaryName);
const token = `browser-isolation-${randomUUID()}`;
const timeoutMs = 20_000;
let evidenceRoot;
let child;
let childExit;
let browser;
let stdout = "";
let stderr = "";
const browserFailures = [];
const browserPages = [];
const browserNetworkLog = [];

try {
  await requirePrerequisites();
  evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-browser-project-isolation-"));
  const home = path.join(evidenceRoot, "home");
  const projectARoot = path.join(home, "Project Alpha Root");
  const projectBRoot = path.join(home, "Project Beta Root");
  await mkdir(projectARoot, { recursive: true });
  await mkdir(projectBRoot, { recursive: true });
  const engineEnv = isolatedEnvironment(home);
  const projectA = await registerProject(engineEnv, projectARoot, "Alpha safe label");
  const projectB = await registerProject(engineEnv, projectBRoot, "Beta safe label");
  await runEngineCli(engineEnv, ["project", "open", projectA.projectId]);

  const port = await allocatePort();
  child = spawn(binary, [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...engineEnv,
      YET_AI_HTTP_PORT: String(port),
      YET_AI_AUTH_TOKEN: token,
      YET_AI_WEB_UI_DIST_DIR: distRoot,
    },
  });
  child.stdout.on("data", (chunk) => { stdout = remember(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = remember(stderr, chunk); });
  childExit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  child.once("error", (error) => { stderr = remember(stderr, error.message); });
  await waitForEngine(port);

  const api = createApi(port);
  await api("POST", "/v1/demo-mode", { enabled: true });
  const legacyChat = await api("POST", "/v1/chats");
  const legacyMemory = await api("POST", "/v1/project-memory", memoryBody("Shared memory label", "legacy-memory-only"));
  const chatA = await api("POST", `/p/${projectA.projectId}/v1/chats`);
  const chatB = await api("POST", `/p/${projectB.projectId}/v1/chats`);
  const memoryA = await api("POST", `/p/${projectA.projectId}/v1/project-memory`, memoryBody("Shared memory label", "alpha-memory-only"));
  const memoryB = await api("POST", `/p/${projectB.projectId}/v1/project-memory`, memoryBody("Shared memory label", "beta-memory-only"));
  await api("POST", `/p/${projectA.projectId}/v1/agent-progress/events`, progressBody("alpha-event", "shared-run", "alpha-progress-only"));
  await api("POST", `/p/${projectB.projectId}/v1/agent-progress/events`, progressBody("beta-event", "shared-run", "beta-progress-only"));
  await api("POST", "/v1/agent-progress/events", progressBody("legacy-event", "shared-run", "legacy-progress-only"));

  await verifyApiIsolation(api, projectA, projectB, chatA, chatB, memoryA, memoryB, legacyChat, legacyMemory);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const baseUrl = `http://127.0.0.1:${port}`;
  const pageA = await createPage(context, baseUrl);
  await pageA.goto(`${baseUrl}/`);
  await pageA.waitForURL(`${baseUrl}/projects`);
  await expectText(pageA, "Projects");
  await expectText(pageA, "Alpha safe label");
  await expectText(pageA, "Beta safe label");
  await expectText(pageA, "Readiness");
  await expectText(pageA, "Recent activity");
  await expectText(pageA, "Last opened");
  await expectText(pageA, "Add local project");
  await expectText(pageA, "Unscoped legacy data");
  const hubText = await pageA.locator("body").innerText();
  assert(!hubText.includes(projectARoot) && !hubText.includes(projectBRoot), "Project hub exposed a raw project root.");
  for (const forbidden of ["Authorization", "Bearer ", token, "worker", "LSP", "cron", "session token", "directoryHandle"]) {
    assert(!hubText.includes(forbidden), `Project hub exposed forbidden operational text: ${forbidden}`);
  }

  await pageA.getByRole("link", { name: "Open project Alpha safe label" }).click();
  await pageA.waitForURL(`${baseUrl}/p/${projectA.projectId}/`);
  await expectText(pageA, "Alpha safe label");
  await pageA.reload();
  await expectText(pageA, "Alpha safe label");

  const pageB = await createPage(context, baseUrl);
  await pageB.goto(`${baseUrl}/p/${projectB.projectId}/memory`);
  await expectText(pageB, "beta-memory-only");
  assert(!(await pageB.locator("body").innerText()).includes("alpha-memory-only"), "Project B memory UI exposed project A data.");
  await pageA.goto(`${baseUrl}/p/${projectA.projectId}/memory`);
  await expectText(pageA, "alpha-memory-only");
  assert(!(await pageA.locator("body").innerText()).includes("beta-memory-only"), "Project A memory UI exposed project B data.");
  assert(pageB.url().includes(projectB.projectId), "Simultaneous project B tab lost its route while project A navigated.");

  await pageA.goto(`${baseUrl}/p/${projectA.projectId}/agent`);
  await pageA.getByText("Agent progress", { exact: true }).click();
  await expectText(pageA, "alpha-progress-only");
  assert(!(await pageA.locator("body").innerText()).includes("beta-progress-only"), "Project A progress UI exposed project B data.");
  await pageB.goto(`${baseUrl}/p/${projectB.projectId}/agent`);
  await pageB.getByText("Agent progress", { exact: true }).click();
  await expectText(pageB, "beta-progress-only");
  assert(!(await pageB.locator("body").innerText()).includes("alpha-progress-only"), "Project B progress UI exposed project A data.");

  await pageA.goto(`${baseUrl}/`);
  await pageA.waitForURL(`${baseUrl}/projects`);
  await pageA.getByRole("link", { name: "Open project Alpha safe label" }).click();
  await pageA.waitForURL(`${baseUrl}/p/${projectA.projectId}/`);
  await pageA.getByRole("link", { name: "Chat", exact: true }).click();
  await pageA.waitForURL(`${baseUrl}/p/${projectA.projectId}/chat`);
  await expectText(pageA, chatA.chatId);
  const alphaCommandMarker = "alpha-in-flight-only";
  const alphaPendingLabels = [
    "Sending your message through the local runtime",
    "Message accepted; opening the response stream",
    "Connecting to the local response stream",
    "Assistant is responding",
    "Assistant is streaming",
  ];
  const commandPath = `/p/${projectA.projectId}/v1/chats/${chatA.chatId}/commands`;
  const subscribePath = `/p/${projectA.projectId}/v1/chats/subscribe`;
  const commandAccepted = waitForSuccessfulResponse(pageA, commandPath, "project A chat command");
  const sseAccepted = waitForSuccessfulResponse(pageA, subscribePath, "project A SSE subscription", "text/event-stream");
  const composer = pageA.locator('[data-testid="chat-composer"] textarea');
  await composer.fill(alphaCommandMarker);
  await pageA.getByRole("button", { name: "Send", exact: true }).click();
  await Promise.all([commandAccepted, sseAccepted]);
  await expectText(pageA, "Assistant is responding");
  assert((await pageA.locator("body").innerText()).includes(alphaCommandMarker), "Accepted project A command was not visible before the route switch.");
  const alphaPendingDraftMarker = "alpha-pending-draft-only";
  await composer.fill(alphaPendingDraftMarker);
  assert(await composer.inputValue() === alphaPendingDraftMarker, "Project A pending composer draft was not available before the route switch.");
  await pageA.evaluate(() => { Reflect.set(window, "__yetAiSmokeDocumentSentinel", { identity: "same-document-project-switch" }); });
  await pageA.getByRole("link", { name: "Projects", exact: false }).click();
  await pageA.waitForURL(`${baseUrl}/projects`);
  await pageA.getByRole("link", { name: "Open project Beta safe label" }).click();
  await pageA.waitForURL(`${baseUrl}/p/${projectB.projectId}/`);
  await pageA.getByRole("link", { name: "Chat", exact: true }).click();
  await pageA.waitForURL(`${baseUrl}/p/${projectB.projectId}/chat`);
  await expectText(pageA, "Beta safe label");
  await expectText(pageA, chatB.chatId);
  assert(pageA.url() === `${baseUrl}/p/${projectB.projectId}/chat`, "Same-tab typed-router switch did not retain the project B chat route.");
  assert(await pageA.evaluate(() => Reflect.get(window, "__yetAiSmokeDocumentSentinel")?.identity) === "same-document-project-switch", "Project switch replaced the browser document instead of using the typed SPA router.");
  const projectBComposer = pageA.locator('[data-testid="chat-composer"] textarea');
  assert(await projectBComposer.inputValue() === "", "Project A pending composer draft survived in project B.");
  const forbiddenInB = [
    alphaCommandMarker,
    alphaPendingDraftMarker,
    chatA.chatId,
    projectA.projectId,
    "Alpha safe label",
    "alpha-memory-only",
    "alpha-progress-only",
    projectARoot,
    token,
    ...alphaPendingLabels,
  ];
  await assertPageExcludes(pageA, forbiddenInB, "Project B immediately after switching from active project A work");
  const aTerminal = await waitForChatTerminalEvent(port, projectA.projectId, chatA.chatId);
  assert(["abort", "stop"].includes(aTerminal.payload?.finishReason), `Project A route-switch terminal event was invalid: ${JSON.stringify(aTerminal)}`);
  assert(browserNetworkLog.some((entry) => entry.includes(`request-failed GET ${subscribePath}`) && entry.includes("ERR_ABORTED")), "Project A browser SSE subscription was not retired during navigation.");
  await pageA.waitForTimeout(200);
  await assertPageExcludes(pageA, forbiddenInB, "Project B after project A terminal/abort timing");
  await assertPageExcludes(pageB, forbiddenInB, "independent project B tab after project A terminal/abort timing");

  const aThread = JSON.stringify(await api("GET", `/p/${projectA.projectId}/v1/chats/${chatA.chatId}`));
  const bThread = JSON.stringify(await api("GET", `/p/${projectB.projectId}/v1/chats/${chatB.chatId}`));
  assert(aThread.includes(alphaCommandMarker), "Project A API did not retain its accepted user command after route-switch retirement.");
  if (aTerminal.payload?.finishReason === "stop") {
    assert(aThread.includes("Hello from Yet AI Demo Mode"), "Completed project A terminal result was missing from project A history.");
  }
  assert(!bThread.includes(alphaCommandMarker) && !bThread.includes(chatA.chatId), "Project B API received project A chat history after route switching.");
  await pageA.goto(`${baseUrl}/p/${projectA.projectId}/chat/${chatA.chatId}`);
  await pageA.reload();
  await expectText(pageA, "Alpha safe label");
  await expectText(pageA, alphaCommandMarker);
  const returnedAEvidence = `${await pageA.content()}\n${await pageA.locator("body").innerText()}`;
  assert(!returnedAEvidence.includes("beta-memory-only") && !returnedAEvidence.includes("beta-progress-only") && !returnedAEvidence.includes(chatB.chatId), "Returning to project A exposed project B state.");

  await pageA.goto(`${baseUrl}/projects/legacy`);
  await expectText(pageA, "Legacy");
  const legacyText = await pageA.locator("body").innerText();
  assert(!legacyText.includes("alpha-memory-only") && !legacyText.includes("beta-memory-only"), "Legacy UI blended project memory.");

  let lifecycle = await api("POST", `/v1/projects/${projectA.projectId}/archive`, { expectedRevision: "2" });
  assert(lifecycle.status === "archived", "Archive did not return archived lifecycle state.");
  await pageA.goto(`${baseUrl}/p/${projectA.projectId}/memory`);
  await expectText(pageA, "Project archived");
  const archivedApi = await api("GET", `/p/${projectA.projectId}/v1/project-memory`, undefined, 409);
  assert(archivedApi.category === "archived", "Archived scoped API did not fail with the bounded archived category.");
  lifecycle = await api("POST", `/v1/projects/${projectA.projectId}/restore`, { expectedRevision: lifecycle.revision });
  assert(lifecycle.status === "available", "Restore did not return available lifecycle state.");
  await pageA.goto(`${baseUrl}/p/${projectA.projectId}/memory`);
  await expectText(pageA, "alpha-memory-only");

  await verifyBrowserPrivacy(context, browserPages, [projectARoot, projectBRoot, token]);
  assert(browserFailures.length === 0, `Browser diagnostics failed:\n${browserFailures.join("\n")}`);
  const engineOutput = `${stdout}\n${stderr}`;
  for (const privateValue of [projectARoot, projectBRoot, token]) {
    assert(!engineOutput.includes(privateValue), "Engine logs exposed a raw project root or auth marker.");
  }

  console.log("Browser project isolation smoke passed.");
  console.log("Verified two real projects across hub, scoped API/UI, tabs, refresh, switching/SSE retirement, archive/restore, and legacy separation.");
  console.log("Verified loopback-only execution and absence of project roots or auth material from browser-visible and engine-log evidence.");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  if (browserNetworkLog.length > 0) console.error(`Browser request/SSE log:\n${redact(browserNetworkLog.join("\n"))}`);
  const tail = redact([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
  if (tail) console.error(`Engine output tail:\n${tail}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}

async function requirePrerequisites() {
  for (const candidate of [binary, path.join(distRoot, "index.html")]) {
    try {
      if (!(await stat(candidate)).isFile()) throw new Error();
    } catch {
      throw new Error(`Missing smoke prerequisite ${path.relative(root, candidate)}. Run the package smoke command so the GUI and engine are built first.`);
    }
  }
}

function isolatedEnvironment(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
  };
}

async function registerProject(env, projectRoot, label) {
  const output = await runEngineCli(env, ["project", "add", projectRoot, "--name", label]);
  const summary = JSON.parse(output);
  assert(summary.displayName === label, `CLI registered an unexpected project label for ${label}.`);
  assert(/^prj_[A-Za-z0-9_-]{22}$/.test(summary.projectId), `CLI returned an invalid opaque project id for ${label}.`);
  assert(!output.includes(projectRoot), `CLI registration output exposed the project root for ${label}.`);
  return summary;
}

function runEngineCli(env, args) {
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
  return async (method, pathname, body, expectedStatus) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const expected = expectedStatus ?? (method === "POST" && pathname.endsWith("/chats") || method === "POST" && pathname.includes("project-memory") && !pathname.endsWith("search") ? 201 : 200);
    assert(response.status === expected, `${method} ${pathname} returned ${response.status}, expected ${expected}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}

async function verifyApiIsolation(api, projectA, projectB, chatA, chatB, memoryA, memoryB, legacyChat, legacyMemory) {
  const projects = await api("GET", "/v1/projects");
  const serializedProjects = JSON.stringify(projects);
  assert(projects.projects.length === 2, `Expected two registered projects, received ${projects.projects.length}.`);
  for (const forbidden of ["canonicalRoot", "rootPath", "directoryHandle", "worker", "lsp", "cron", "token", "port"]) {
    assert(!serializedProjects.toLowerCase().includes(forbidden.toLowerCase()), `Project list exposed forbidden field ${forbidden}.`);
  }
  assert(projects.projects.some((project) => project.projectId === projectA.projectId && project.lastOpenedAt), "Project A did not expose useful last-opened activity.");
  assert(projects.projects.some((project) => project.projectId === projectB.projectId && project.lastOpenedAt === null), "Project B did not preserve the never-opened activity state.");

  const aMemory = JSON.stringify(await api("GET", `/p/${projectA.projectId}/v1/project-memory`));
  const bMemory = JSON.stringify(await api("GET", `/p/${projectB.projectId}/v1/project-memory`));
  assert(aMemory.includes("alpha-memory-only") && !aMemory.includes("beta-memory-only") && !aMemory.includes("legacy-memory-only"), "Project A memory API blended namespaces.");
  assert(bMemory.includes("beta-memory-only") && !bMemory.includes("alpha-memory-only") && !bMemory.includes("legacy-memory-only"), "Project B memory API blended namespaces.");
  await api("GET", `/p/${projectB.projectId}/v1/project-memory/${memoryA.id}`, undefined, 404);
  await api("GET", `/p/${projectA.projectId}/v1/project-memory/${memoryB.id}`, undefined, 404);
  await api("GET", `/p/${projectB.projectId}/v1/chats/${chatA.chatId}`, undefined, 404);
  await api("GET", `/p/${projectA.projectId}/v1/chats/${chatB.chatId}`, undefined, 404);

  const aProgress = JSON.stringify(await api("GET", `/p/${projectA.projectId}/v1/agent-progress`));
  const bProgress = JSON.stringify(await api("GET", `/p/${projectB.projectId}/v1/agent-progress`));
  const legacyProgress = JSON.stringify(await api("GET", "/v1/agent-progress"));
  assert(aProgress.includes("shared-run") && aProgress.includes("alpha-progress-only") && !aProgress.includes("beta-progress-only"), "Project A progress API blended namespaces.");
  assert(bProgress.includes("shared-run") && bProgress.includes("beta-progress-only") && !bProgress.includes("alpha-progress-only"), "Project B progress API blended namespaces.");
  assert(legacyProgress.includes("legacy-progress-only") && !legacyProgress.includes("alpha-progress-only") && !legacyProgress.includes("beta-progress-only"), "Legacy progress blended project data.");

  const legacyChats = JSON.stringify(await api("GET", "/v1/chats"));
  const legacyMemoryList = JSON.stringify(await api("GET", "/v1/project-memory"));
  assert(legacyChats.includes(legacyChat.chatId) && !legacyChats.includes(chatA.chatId) && !legacyChats.includes(chatB.chatId), "Legacy chat API blended project chats.");
  assert(legacyMemoryList.includes(legacyMemory.id) && !legacyMemoryList.includes(memoryA.id) && !legacyMemoryList.includes(memoryB.id), "Legacy memory API blended project notes.");
}

async function createPage(context, baseUrl) {
  const page = await context.newPage();
  browserPages.push(page);
  page.on("pageerror", (error) => browserFailures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserFailures.push(`console error: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      browserFailures.push(`non-loopback request: ${request.url()}`);
    }
    if (isChatDiagnosticRequest(url.pathname)) browserNetworkLog.push(`request ${request.method()} ${url.pathname}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (isChatDiagnosticRequest(url.pathname)) browserNetworkLog.push(`response ${response.status()} ${url.pathname} ${response.headers()["content-type"] ?? "no-content-type"}`);
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (isChatDiagnosticRequest(url.pathname)) browserNetworkLog.push(`request-failed ${request.method()} ${url.pathname} ${request.failure()?.errorText ?? "unknown"}`);
  });
  return page;
}

function isChatDiagnosticRequest(pathname) {
  return pathname.includes("/chats/") && (pathname.endsWith("/commands") || pathname.endsWith("/subscribe"));
}

async function waitForSuccessfulResponse(page, pathname, label, expectedContentType) {
  const response = await page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname === pathname;
  }, { timeout: timeoutMs });
  assert(response.ok(), `${label} returned HTTP ${response.status()}.`);
  if (expectedContentType) {
    assert((response.headers()["content-type"] ?? "").includes(expectedContentType), `${label} did not return ${expectedContentType}.`);
  }
  return response;
}

async function waitForChatTerminalEvent(port, projectId, chatId) {
  const pathname = `/p/${projectId}/v1/chats/subscribe?chat_id=${encodeURIComponent(chatId)}`;
  browserNetworkLog.push(`probe GET ${pathname.split("?", 1)[0]}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });
    browserNetworkLog.push(`probe-response ${response.status} ${pathname.split("?", 1)[0]} ${response.headers.get("content-type") ?? "no-content-type"}`);
    assert(response.ok && response.body, `Project A terminal SSE probe returned HTTP ${response.status}.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const frame of buffer.split(/\r?\n\r?\n/).slice(0, -1)) {
        const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"));
        if (!data) continue;
        const event = JSON.parse(data.slice(5).trim());
        if (event.type === "stream_finished" && event.chatId === chatId) {
          browserNetworkLog.push(`probe-event stream_finished ${event.payload?.finishReason ?? "unknown"} ${chatId}`);
          await reader.cancel();
          return event;
        }
      }
      buffer = buffer.split(/\r?\n\r?\n/).at(-1) ?? "";
    }
    throw new Error("Project A terminal SSE probe ended before stream_finished.");
  } finally {
    clearTimeout(timer);
  }
}

async function assertPageExcludes(page, forbiddenValues, label) {
  const html = await page.content();
  const body = await page.locator("body").innerText();
  for (const value of forbiddenValues) {
    const htmlIndex = html.indexOf(value);
    assert(htmlIndex === -1, `${label} HTML contained forbidden project A evidence ${JSON.stringify(value)} near ${JSON.stringify(html.slice(Math.max(0, htmlIndex - 120), htmlIndex + value.length + 120))}.`);
    assert(!body.includes(value), `${label} body contained forbidden project A evidence ${JSON.stringify(value)}.`);
  }
}

async function verifyBrowserPrivacy(context, pages, privateValues) {
  for (const page of pages) {
    const evidence = `${page.url()}\n${await page.content()}\n${await page.locator("body").innerText()}`;
    for (const privateValue of privateValues) assert(!evidence.includes(privateValue), "Browser URL, HTML, or visible UI exposed private evidence.");
  }
  for (const page of pages) {
    const storage = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
      cookies: document.cookie,
    }));
    const evidence = JSON.stringify(storage);
    for (const privateValue of privateValues) assert(!evidence.includes(privateValue), "Browser storage exposed private evidence.");
  }
  const cookies = await context.cookies();
  assert(cookies.some((cookie) => cookie.name === "yet_ai_loopback_session" && cookie.httpOnly), "Browser session cookie was missing or not HttpOnly.");
  assert(!JSON.stringify(cookies).includes(token), "Browser cookie storage exposed the runtime token.");
}

function memoryBody(title, text) {
  return { protocolVersion: "2026-06-17", title, text, tags: ["shared-label"], source: "manual" };
}

function progressBody(eventId, runId, message) {
  return { protocolVersion: "2026-05-29", eventId, runId, cardId: "T-15", timestamp: "2026-07-22T04:00:00Z", phase: "started", status: "running", message };
}

async function expectText(page, text) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    const body = await page.locator("body").innerText().catch(() => "<body unavailable>");
    throw new Error(`Timed out waiting for visible text ${JSON.stringify(text)} at ${page.url()}. Body: ${body.slice(0, 1200)}`);
  }
}

async function waitForEngine(port) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for the engine on 127.0.0.1:${port}.`);
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : address && typeof address === "object" ? resolve(address.port) : reject(new Error("Could not allocate a loopback port.")));
    });
  });
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([childExit, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (evidenceRoot) await rm(evidenceRoot, { recursive: true, force: true });
}

function remember(target, chunk) {
  return (target + chunk.toString("utf8")).slice(-8_000);
}

function redact(value) {
  return String(value).split(token).join("[REDACTED]").split(evidenceRoot ?? "never-match").join("[TEMP]");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
