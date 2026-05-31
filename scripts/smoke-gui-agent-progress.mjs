import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const distRoot = path.join(guiRoot, "dist");
const indexPath = path.join(distRoot, "index.html");
const runtimeOrigin = "http://127.0.0.1:8001";
const rawMarkers = [
  "Bearer gui-agent-progress-secret-000",
  "api_key=sk-gui-agent-progress-secret-000",
  "Cookie: session=gui-agent-progress-cookie",
  "session_token=gui-agent-progress-token",
  "/Users/Gui Agent/.codex/auth.json",
  "raw prompt: inspect the whole workspace",
  "provider response raw dump",
  "SECRET_RAW_PROMPT_BODY",
  "SECRET_PROVIDER_RESPONSE_BODY",
  "SECRET_FILE_CONTENT_BODY",
  "SECRET_WORKSPACE_CONTENT_BODY",
  "STRUCTURED_RAW_PROMPT_BODY",
  "STRUCTURED_PROVIDER_BODY",
  "STRUCTURED_BOARD_DUMP_BODY",
  "STRUCTURED_RAW_TOOL_OUTPUT_BODY",
  "STRUCTURED_RAW_OUTPUT_BODY",
  "STRUCTURED_RAW_DUMP_BODY",
  "FALLBACK_PROVIDER_RESPONSE_SENTINEL",
  "GUI-SMOKE-BOUNDED-20",
];
const failures = [];
let agentProgressResponse = emptyAgentProgress();
let browser;
let server;

await buildGui();
await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  server = await startStaticServer(distRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    failActionable("Playwright Chromium is not installed or cannot be launched.", [
      "Run `npm install` from the repository root if needed.",
      "Run `npx playwright install chromium`.",
      `Launch error: ${messageOf(error)}`,
    ]);
  }

  const page = await browser.newPage();
  page.on("console", (message) => {
    const text = message.text();
    assertNoRawMarkers(text, "browser console");
    if (message.type() === "error" && !isExpectedFetchConsoleError(text)) {
      failures.push(`Browser console error: ${redactSecrets(text)}`);
    }
  });
  page.on("pageerror", (error) => {
    assertNoRawMarkers(error.message, "page error");
    failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`);
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
    if (isStaticServerAsset(url, guiBaseUrl) && (response.status() === 404 || response.status() >= 500)) {
      failures.push(`Broken local asset response: ${response.status()} ${redactUrl(url)}`);
    }
  });

  await page.route(`${runtimeOrigin}/**`, async (route) => {
    const request = route.request();
    const response = mockRuntimeResponse(request.url(), request.method());
    if (!response) {
      failures.push(`Unexpected runtime request: ${request.method()} ${redactUrl(request.url())}`);
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unexpected local mock endpoint" }) });
      return;
    }
    await route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
  });

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await expectVisibleText(page, "Agent progress", "agent progress panel");
  await expectVisibleText(page, "Read-only local observability only.", "read-only agent progress copy");
  await assertNoMutatingAgentControls(page);

  agentProgressResponse = emptyAgentProgress();
  await refreshAgentProgress(page);
  await expectVisibleText(page, "No local agent runs", "empty no-runs state");
  await expectVisibleText(page, "Generated at: 2026-05-29T15:00:00Z", "empty freshness state");
  await expectVisibleText(page, "Read-only local observability; refresh only re-reads local progress.", "read-only refresh state");

  agentProgressResponse = progressList([progressSnapshot({ cardId: "GUI-SMOKE-LONG", status: "long_running", message: "Verification is still running with fresh heartbeats", elapsedMs: 900000 })]);
  await refreshAgentProgress(page);
  await expectVisibleText(page, "Populated local progress", "populated progress state");
  await expectVisibleText(page, "1 local agent run returned by the read-only runtime endpoint.", "populated progress count");
  await expectVisibleText(page, "GUI-SMOKE-LONG / run-gui-smoke", "healthy long-running run");
  await expectVisibleText(page, "long-running, not stuck", "healthy long-running not stuck label");
  await expectAbsentText(page, "stuck: heartbeat_timeout", "healthy long-running stuck label");

  agentProgressResponse = progressList([progressSnapshot({ cardId: "GUI-SMOKE-STUCK", phase: "stuck", status: "stuck", stuckReason: "heartbeat_timeout", message: "Heartbeat timeout detected" })]);
  await refreshAgentProgress(page);
  await expectVisibleText(page, "GUI-SMOKE-STUCK / run-gui-smoke", "stuck run");
  await expectVisibleText(page, "stuck: heartbeat_timeout", "stuck status label");
  await expectVisibleText(page, "Stuck reason: heartbeat_timeout", "stuck reason detail");

  agentProgressResponse = progressList([progressSnapshot({
    cardId: "GUI-SMOKE-FAILED",
    phase: "failed",
    status: "failed",
    stuckReason: "explicit_failure",
    message: `Failed with ${rawMarkers.join(" ")}`,
    outputTail: `Failed command output ${rawMarkers.join("\n")}`,
    recentEvents: [{ eventId: "event-failed", timestamp: "2026-05-29T15:00:30Z", phase: "failed", status: "failed", message: `Failure event ${rawMarkers.join(" ")}` }],
  })]);
  await refreshAgentProgress(page);
  await expectVisibleText(page, "GUI-SMOKE-FAILED / run-gui-smoke", "failed run");
  await expectVisibleText(page, "failed", "failed status");
  await expectVisibleText(page, "[redacted]", "failed redaction marker");

  agentProgressResponse = progressList([progressSnapshot({
    cardId: "GUI-SMOKE-OVERFLOW",
    phase: "failed",
    status: "failed",
    stuckReason: "explicit_failure",
    message: "context_length_exceeded after full task_board_get output",
    outputTail: `${"task board output too large. ".repeat(100)} ${rawMarkers.join(" ")}`,
    overflowRecovery: {
      kind: "task_board_output_too_large",
      message: "Retry with scoped context: use task_ready_cards, specific task_board_get(card_id), targeted search_pattern, targeted cat, and summaries.",
      retryable: true,
    },
    recentEvents: [{ eventId: "event-overflow", timestamp: "2026-05-29T15:00:40Z", phase: "failed", status: "failed", message: `Task board output too large ${rawMarkers.join(" ")}` }],
  })]);
  await refreshAgentProgress(page);
  await expectVisibleText(page, "GUI-SMOKE-OVERFLOW / run-gui-smoke", "overflow run");
  await expectVisibleText(page, "Task-board output was too large.", "overflow recovery title");
  await expectVisibleText(page, "Use a specific card id, ready cards, or scoped search instead of a full task-board dump.", "overflow recovery action");
  await expectVisibleText(page, "task_ready_cards", "overflow scoped ready cards guidance");
  await expectVisibleText(page, "task_board_get(card_id)", "overflow scoped card guidance");
  await expectVisibleText(page, "targeted search_pattern", "overflow targeted search guidance");
  await assertNoMutatingAgentControls(page);

  agentProgressResponse = progressList([progressSnapshot({
    cardId: "GUI-SMOKE-DONE-AFTER-OVERFLOW",
    phase: "done",
    status: "done",
    message: "Done after previous context_length_exceeded recovery",
    outputTail: "Previous task board output too large event resolved.",
    overflowRecovery: {
      kind: "task_board_output_too_large",
      message: "Retry with task_ready_cards or task_board_get(card_id).",
      retryable: true,
    },
    recentEvents: [{ eventId: "event-done-overflow", timestamp: "2026-05-29T15:00:45Z", phase: "done", status: "done", message: "Done after overflow" }],
  })]);
  await refreshAgentProgress(page);
  await expectVisibleText(page, "GUI-SMOKE-DONE-AFTER-OVERFLOW / run-gui-smoke", "done after overflow run");
  await expectAbsentText(page, "Task-board output was too large.", "stale done overflow recovery");

  const noisyMarker = "SAFE_GUI_AGENT_PROGRESS_NOISY_OUTPUT_";
  agentProgressResponse = progressList([progressSnapshot({
    cardId: "GUI-SMOKE-NOISY-BOUNDED",
    phase: "failed",
    status: "failed",
    stuckReason: "explicit_failure",
    message: "Tool output too large after raw prompt: SECRET_RAW_PROMPT_BODY",
    outputTail: [
      "raw prompt SECRET_RAW_PROMPT_BODY",
      "provider response: SECRET_PROVIDER_RESPONSE_BODY",
      "file content=SECRET_FILE_CONTENT_BODY",
      "workspace contents: SECRET_WORKSPACE_CONTENT_BODY",
      noisyMarker.repeat(1200),
    ].join("\n"),
    recentEvents: [{ eventId: "event-noisy", timestamp: "2026-05-29T15:00:50Z", phase: "failed", status: "failed", message: `tool output too large ${noisyMarker.repeat(1200)}` }],
  })]);
  await refreshAgentProgress(page);
  await expectVisibleText(page, "GUI-SMOKE-NOISY-BOUNDED / run-gui-smoke", "noisy bounded run");
  await expectVisibleText(page, "Agent output was too large.", "noisy fallback recovery title");
  await assertBoundedNoisyOutput(page, noisyMarker);

  agentProgressResponse = progressList([progressSnapshot({
    cardId: "GUI-SMOKE-FALLBACK-RAW-LABEL",
    phase: "failed",
    status: "failed",
    stuckReason: "explicit_failure",
    message: "Provider failed before explicit overflow recovery was attached",
    outputTail: "provider response: context_length_exceeded FALLBACK_PROVIDER_RESPONSE_SENTINEL",
    recentEvents: [],
  })]);
  await refreshAgentProgress(page);
  await expectVisibleText(page, "GUI-SMOKE-FALLBACK-RAW-LABEL / run-gui-smoke", "fallback raw label overflow run");
  await expectVisibleText(page, "Planner context was too large.", "fallback raw label recovery title");
  await expectVisibleText(page, "Retry with scoped context", "fallback raw label recovery message");

  agentProgressResponse = progressList(Array.from({ length: 25 }, (_, index) => progressSnapshot({
    cardId: `GUI-SMOKE-BOUNDED-${index}`,
    runId: `run-gui-bounded-${index}`,
    message: "Bounded structured progress payload",
    rawPrompt: { nested: "STRUCTURED_RAW_PROMPT_BODY" },
    providerBody: ["STRUCTURED_PROVIDER_BODY"],
    taskBoardDump: { raw: "STRUCTURED_BOARD_DUMP_BODY" },
    rawToolOutput: { nested: "STRUCTURED_RAW_TOOL_OUTPUT_BODY" },
    rawOutput: { nested: "STRUCTURED_RAW_OUTPUT_BODY" },
    rawDump: { nested: "STRUCTURED_RAW_DUMP_BODY" },
    recentEvents: Array.from({ length: 18 }, (_, eventIndex) => ({
      eventId: `event-bounded-${index}-${eventIndex}`,
      timestamp: "2026-05-29T15:01:00Z",
      phase: "running_command",
      status: "healthy_running",
      message: `bounded recent summary ${eventIndex}`,
    })),
  })));
  await refreshAgentProgress(page);
  await expectVisibleText(page, "GUI-SMOKE-BOUNDED-0 / run-gui-bounded-0", "bounded first run");
  await expectVisibleText(page, "5 more agent runs hidden.", "bounded hidden run count");
  await expectVisibleText(page, "6 more summaries hidden.", "bounded hidden summary count");

  agentProgressResponse = unavailableAgentProgress();
  await refreshAgentProgress(page);
  await expectVisibleText(page, "Agent progress unavailable", "unavailable progress state");
  await expectVisibleText(page, "The local progress source is unavailable, corrupt, oversized, or unsafe. Runtime 503: agent progress unavailable", "unavailable sanitized progress copy");
  await assertNoMutatingAgentControls(page);

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
  assertNoRawMarkers(JSON.stringify(pageState), "DOM or browser storage");

  if (failures.length > 0) {
    throw new Error(`GUI agent progress smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("GUI agent progress smoke passed.");
  console.log("Verified built GUI rendering against deterministic loopback runtime mocks for no-runs, healthy long-running, stuck, failed-redacted, and overflow recovery agent progress states.");
  console.log("No provider calls, real agents, task-board calls, git operations, shell/tool execution, workspace mutation, non-loopback network, or cloud calls were used.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    await server.close().catch(() => undefined);
  }
}

async function buildGui() {
  const result = spawnSync("npm", ["run", "build"], { cwd: guiRoot, stdio: "inherit", env: { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" } });
  if (result.status !== 0) {
    failActionable("GUI build failed.", ["Run `cd apps/gui && npm install` if dependencies are missing, then retry `npm run smoke:gui-agent-progress`."]);
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
      failures.push("Built GUI index.html does not reference Vite assets.");
    }
  } catch {
    failActionable("built GUI is missing after build.", [`Expected file: ${path.relative(root, indexPath)}`]);
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

async function refreshAgentProgress(page) {
  const button = page.getByRole("button", { name: "Refresh agent progress" });
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((item) => item.textContent?.trim() === "Refresh agent progress" && !item.disabled), undefined, { timeout: 10_000 });
}

async function assertNoMutatingAgentControls(page) {
  const labels = await page.locator("button").evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ""));
  for (const label of ["Start agent", "Stop agent", "Merge", "Apply", "Run tool", "Execute shell"]) {
    if (labels.includes(label)) {
      throw new Error(`Mutating agent control is visible: ${label}`);
    }
  }
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 4000)}`);
  }
}

async function expectAbsentText(page, text, description) {
  const body = await page.locator("body").innerText();
  if (body.includes(text)) {
    throw new Error(`Unexpected ${description} text was visible.`);
  }
}

async function assertBoundedNoisyOutput(page, marker) {
  const body = await page.locator("body").innerText();
  const occurrences = body.split(marker).length - 1;
  if (occurrences > 220) {
    throw new Error(`Oversized non-secret output is visible in bulk: ${occurrences} repeated markers.`);
  }
  if (body.length > 18000) {
    throw new Error(`Agent progress page text is too large after noisy output: ${body.length} characters.`);
  }
}

function mockRuntimeResponse(value, method) {
  const url = new URL(value);
  if (method !== "GET") {
    return undefined;
  }
  if (url.pathname === "/v1/ping") {
    return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-29T15:00:00Z" });
  }
  if (url.pathname === "/v1/caps") {
    return json({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
  }
  if (url.pathname === "/v1/models") {
    return json({ models: [] });
  }
  if (url.pathname === "/v1/providers") {
    return json({ providers: [], cloudRequired: false, providerAccess: "direct" });
  }
  if (url.pathname === "/v1/provider-auth/openai/status") {
    return json({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "OpenAI account login is not available for this local mock." });
  }
  if (url.pathname === "/v1/chats") {
    return json({ chats: [] });
  }
  if (url.pathname === "/v1/agent-progress") {
    if (agentProgressResponse?.unavailable === true) {
      return json({ error: "agent progress unavailable provider response: SECRET_PROVIDER_RESPONSE_BODY Authorization: Bearer gui-agent-progress-secret-000" }, 503);
    }
    return json(agentProgressResponse);
  }
  return undefined;
}

function json(body, status = 200) {
  return { status, body };
}

function emptyAgentProgress() {
  return progressList([]);
}

function unavailableAgentProgress() {
  return { unavailable: true };
}

function progressList(snapshots) {
  return { cloudRequired: false, providerAccess: "direct", generatedAt: "2026-05-29T15:00:00Z", snapshots };
}

function progressSnapshot(overrides = {}) {
  return {
    protocolVersion: "2026-05-29",
    runId: "run-gui-smoke",
    cardId: "GUI-SMOKE",
    startedAt: "2026-05-29T14:00:00Z",
    updatedAt: "2026-05-29T14:01:00Z",
    phase: "running_command",
    status: "healthy_running",
    message: "Running deterministic GUI agent progress smoke",
    elapsedMs: 61000,
    ageMs: 1000,
    currentTool: { kind: "test", label: "npm run smoke:gui-agent-progress", startedAt: "2026-05-29T14:00:30Z", elapsedMs: 30000 },
    stuckReason: "none",
    recentEvents: [
      { eventId: "event-started", timestamp: "2026-05-29T14:00:30Z", phase: "running_command", status: "healthy_running", message: "Started deterministic smoke" },
    ],
    ...overrides,
  };
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

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "ws:") && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isJsOrCssAssetRequest(url, resourceType) {
  return isLoopbackUrl(url) && (resourceType === "script" || resourceType === "stylesheet" || isJsOrCssAssetUrl(url));
}

function isJsOrCssAssetUrl(value) {
  const pathname = new URL(value).pathname;
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}

function isStaticServerAsset(url, guiBaseUrl) {
  return url.startsWith(`${guiBaseUrl}/`);
}

function isExpectedFetchConsoleError(text) {
  return /^Failed to load resource: (net::ERR_CONNECTION_REFUSED|the server responded with a status of (401 \(Unauthorized\)|503 \(Service Unavailable\)))$/.test(text);
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

function assertNoRawMarkers(value, source) {
  const text = String(value);
  for (const [index, marker] of rawMarkers.entries()) {
    if (text.includes(marker)) {
      throw new Error(`Raw secret marker ${index + 1} leaked through ${source}.`);
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
    .replace(/api_key=[^\s]+/gi, "api_key=[redacted]")
    .replace(/Cookie:\s*[^\n]+/gi, "Cookie: [redacted]")
    .replace(/token=[^\s]+/gi, "token=[redacted]")
    .replace(/\/Users\/[^\n]+/g, "/Users/[redacted]")
    .replace(/\/private\/tmp\/[^\s]+/g, "/private/tmp/[redacted]");
}

function failActionable(summary, lines) {
  console.error(`GUI agent progress smoke failed: ${summary}`);
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
