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
const userMessageWithBundle = "Say hello from GUI runtime smoke with multi-file bundle.";
const userMessageAfterBundle = "Say hello from GUI runtime smoke after multi-file bundle cleared.";
const userMessageAfterVerification = "Say hello from GUI runtime smoke with attached verification output.";
const safeEditPrompt = "Coding action: propose_safe_edit\n\nPropose a safe edit for the selected code. Nothing is applied automatically.";
const assistantTextWithContext = "Hello smoke from mock provider with context.";
const assistantTextWithoutContext = "Hello smoke from mock provider without context.";
const assistantTextWithBundle = "Hello smoke from mock provider with multi-file bundle.";
const assistantTextAfterBundle = "Hello smoke from mock provider after bundle cleared.";
const assistantTextAfterVerification = "Hello smoke from mock provider after verification output.";
const activeContextSentinel = `ACTIVE_CONTEXT_SENTINEL_${"x".repeat(64)}`;
const activeContextText = `function smokeContext() { return "${activeContextSentinel}"; }`;
const activeContextPath = "src/smoke-context.ts";
const verificationOutputTail = "Repository check failed.\nSmoke fixture expected one failing assertion.\nNo real shell command ran.";
const bundleSentinelOne = `BUNDLE_CONTEXT_ONE_${"a".repeat(48)}`;
const bundleSentinelTwo = `BUNDLE_CONTEXT_TWO_${"b".repeat(48)}`;
const bundlePreviewOne = `export const bundleOnePreview = "${"a".repeat(16)}";`;
const bundlePreviewTwo = `export const bundleTwoPreview = "${"b".repeat(16)}";`;
const bundleContextOne = { path: "src/smoke-bundle-one.ts", text: `${bundlePreviewOne}\nexport const bundleOne = "${bundleSentinelOne}";`, startLine: 1, startCharacter: 0, endLine: 2, endCharacter: 48 };
const bundleContextTwo = { path: "src/smoke-bundle-two.ts", text: `${bundlePreviewTwo}\nexport const bundleTwo = "${bundleSentinelTwo}";`, startLine: 3, startCharacter: 0, endLine: 4, endCharacter: 48 };
const safeEditProposal = {
  type: "gui.applyWorkspaceEditRequest",
  version: "2026-05-15",
  payload: {
    requiresUserConfirmation: true,
    summary: "Mock provider proposes one safe edit after user review.",
    cloudRequired: false,
    edits: [{
      workspaceRelativePath: activeContextPath,
      textReplacements: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 27 } },
        replacementText: "function smokeContextEdited() { return true; }",
      }],
    }],
  },
};
const secretMarkers = [
  token,
  fakeApiKey,
  activeContextSentinel,
  bundleSentinelOne,
  bundleSentinelTwo,
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
  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });
  await page.route("http://127.0.0.1:8001/v1/demo-mode", async (route) => {
    if (route.request().method() !== "GET" && route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
      body: JSON.stringify(demoModeDisabledResponse()),
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
  await expectAttachedText(page, "runtime connected", "runtime connected badge", 20_000);

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
  await expectVisibleText(page, `Ready to send using ${modelId} through the local runtime.`, "chat readiness", 20_000);

  await exerciseManualRunnerStart(page);

  await exerciseExplicitContextBundle(page);

  await setChatId(page, chatId);
  await deliverActiveContext(page);
  await expectVisibleText(page, "Active editor context", "active editor context card", 20_000);
  await expectVisibleText(page, activeContextPath, "active context file path", 20_000);
  await page.getByTestId("attached-context-active-details").evaluate((element) => {
    if (element instanceof HTMLDetailsElement) element.open = true;
  });
  await expectVisibleText(page, "Selected characters:", "active context selected character count", 20_000);
  await acknowledgeHiddenContextIfNeeded(page);
  await expectVisibleText(page, "Attach to next message", "active context include state", 20_000);
  await assertContextSentinelNotVisible(page, "bounded active context preview");

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageWithContext);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessageWithContext, "visible included-context user chat bubble", 20_000);
  await expectVisibleText(page, assistantTextWithContext, "included-context streamed assistant response", 30_000);
  await assertAssistantAnswerCount(page, assistantTextWithContext, 1, "included-context streamed assistant response");
  await expectVisibleText(page, "Context attached to the last accepted message", "one-shot context attached status", 20_000);

  await deliverActiveContext(page);
  await acknowledgeHiddenContextIfNeeded(page);
  await expectVisibleText(page, "Attach to next message", "refreshed active context include state", 20_000);
  await page.locator("label.attached-context-toggle", { hasText: "Attach to next message" }).getByRole("checkbox").uncheck();
  await expectVisibleText(page, "Do not attach", "active context omit state", 20_000);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageWithoutContext);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessageWithoutContext, "visible omitted-context user chat bubble", 20_000);
  await expectVisibleText(page, assistantTextWithoutContext, "omitted-context streamed assistant response", 30_000);
  await assertAssistantAnswerCount(page, assistantTextWithoutContext, 1, "omitted-context streamed assistant response");

  const applyRequestsBeforeSafeEdit = await applyWorkspaceEditRequestCount(page);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(safeEditPrompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, "Coding action: propose_safe_edit", "visible safe-edit coding action prompt", 20_000);
  await expectVisibleText(page, "Proposed a safe edit. Review the proposal card below. It will not apply automatically.", "safe-edit compact assistant bubble", 30_000);
  await expectVisibleText(page, safeEditProposal.payload.summary, "mock-provider safe-edit proposal summary", 20_000);
  await expectVisibleText(page, activeContextPath, "mock-provider safe-edit proposal workspace path", 20_000);
  await expectVisibleText(page, "Apply in VS Code after review", "VS Code safe-edit apply boundary", 20_000);
  const applyRequestsAfterSafeEdit = await applyWorkspaceEditRequestCount(page);
  assert(applyRequestsAfterSafeEdit === applyRequestsBeforeSafeEdit, "GUI emitted a workspace edit apply request before an explicit apply click");
  await waitForProviderHits(5);

  await exerciseEditVerifyLoop(page);
  await waitForProviderHits(6);

  await assertNoAutonomousBridgeActions(page);

  assert(providerAuth === `Bearer ${fakeApiKey}`, "mock provider did not receive the configured fake bearer key");
  assert(providerRequestBodies.length === 6, "mock provider received " + providerRequestBodies.length + " chat request(s), expected 6");
  const parsedProviderBodies = providerRequestBodies.map((body) => JSON.parse(body));
  const bundlePrompt = parsedProviderBodies[0].messages?.[0]?.content;
  const afterBundlePrompt = parsedProviderBodies[1].messages?.[0]?.content;
  const includedPrompt = parsedProviderBodies[2].messages?.[0]?.content;
  const omittedPrompt = parsedProviderBodies[3].messages?.[0]?.content;
  const safeEditProviderPrompt = parsedProviderBodies[4].messages?.[0]?.content;
  const verificationPrompt = parsedProviderBodies[5].messages?.[0]?.content;
  assert(parsedProviderBodies.every((body) => body.stream === true), "mock provider requests were not streaming");
  assert(parsedProviderBodies.every((body) => body.model === modelId), "mock provider request used the wrong model");
  assert(typeof bundlePrompt === "string" && bundlePrompt.includes("IDE context bundle"), "bundle request did not prepend IDE context bundle");
  assert(bundlePrompt.includes(`path=${bundleContextOne.path}`), "bundle request missed first bundle path");
  assert(bundlePrompt.includes(`path=${bundleContextTwo.path}`), "bundle request missed second bundle path");
  assert(bundlePrompt.includes(bundleSentinelOne), "bundle request missed first bounded active selection text");
  assert(bundlePrompt.includes(bundleSentinelTwo), "bundle request missed second bounded active selection text");
  assert(bundlePrompt.includes(userMessageWithBundle), "bundle request missed user content");
  assert(afterBundlePrompt === userMessageAfterBundle, "post-bundle request unexpectedly included one-shot bundle context");
  assert(!afterBundlePrompt.includes(bundleSentinelOne) && !afterBundlePrompt.includes(bundleSentinelTwo), "post-bundle request leaked one-shot bundle sentinels");
  assert(typeof includedPrompt === "string" && includedPrompt.includes("IDE context"), "included-context request did not prepend IDE context");
  assert(includedPrompt.includes(`Workspace-relative path: ${activeContextPath}`), "included-context request missed active file path");
  assert(includedPrompt.includes(activeContextSentinel), "included-context request missed bounded active selection text");
  assert(includedPrompt.includes(userMessageWithContext), "included-context request missed user content");
  assert(omittedPrompt === userMessageWithoutContext, "omitted-context request unexpectedly included IDE context");
  assert(!omittedPrompt.includes(activeContextSentinel), "omitted-context request leaked active context sentinel");
  assert(safeEditProviderPrompt === safeEditPrompt, "safe-edit request did not reach the mock provider as the user coding action prompt");
  assert(!safeEditProviderPrompt.includes(activeContextSentinel), "safe-edit request unexpectedly included stale active context sentinel");
  assert(typeof verificationPrompt === "string" && verificationPrompt.includes("IDE context bundle"), "verification follow-up request did not prepend explicit context bundle");
  assert(verificationPrompt.includes("verification output commandId=repository-check status=failed exitCode=1 truncated=false"), "verification follow-up request missed verification output metadata");
  assert(verificationPrompt.includes(verificationOutputTail), "verification follow-up request missed failed output tail");
  assert(verificationPrompt.includes(userMessageAfterVerification), "verification follow-up request missed user content");
  assert(!verificationPrompt.includes(activeContextSentinel) && !verificationPrompt.includes(bundleSentinelOne) && !verificationPrompt.includes(bundleSentinelTwo), "verification follow-up request leaked stale editor context");

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
  console.log("Verified built GUI, loopback runtime, mock OpenAI-compatible streaming provider, Manual runner progress guide, IDE-like active-file multi-file bundle include/one-shot clear, active context include/omit, streamed chat responses, mock safe-edit JSON proposal preview without auto-send or auto-apply, explicit apply result to user-clicked verification to one-shot verification_output attachment, no hidden search/read/navigation actions, local history reload, and browser-state redaction.");
  console.log("No OpenAI/ChatGPT, hosted Yet AI service, non-loopback URL, real IDE launch, or real provider credential was used.");
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
      const responseText = providerHits === 1 ? assistantTextWithBundle : providerHits === 2 ? assistantTextAfterBundle : providerHits === 3 ? assistantTextWithContext : providerHits === 4 ? assistantTextWithoutContext : providerHits === 5 ? JSON.stringify(safeEditProposal) : assistantTextAfterVerification;
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write("data: " + JSON.stringify({ choices: [{ delta: { content: responseText } }] }) + "\n\n");
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

async function exerciseManualRunnerStart(page) {
  await expectVisibleText(page, "Manual runner · Coding loop", "manual runner panel", 20_000);
  await expectVisibleText(page, "manual only", "manual runner manual-only badge", 20_000);
  await expectAttachedText(page, "Progress guide only. It never auto-sends, auto-attaches context, auto-applies edits, auto-runs verification, reads hidden files, or writes browser storage.", "manual runner no-autonomy copy", 20_000);
  await expectVisibleText(page, "Current manual lifecycle step: 1. Goal", "manual runner initial current step", 20_000);
  await page.getByLabel("Manual runner coding loop").getByLabel("Draft plan (local UI state only)").fill("Inspect attached context, ask for a safe edit, apply only after explicit review, run verification manually, then send a follow-up with verification output.");
  await expectVisibleText(page, "Current manual lifecycle step: 2. Context selected", "manual runner context current step", 20_000);
  await assertNoManualRunnerSideEffects(page, "manual runner start/draft");
}

async function assertManualRunnerCompleted(page) {
  await expectVisibleText(page, "Current manual lifecycle step: 7. Follow-up", "manual runner final current step", 20_000);
  await expectVisibleText(page, "Verification output is attached as explicit one-shot context.", "manual runner verification-attached detail", 20_000);
  const manualRunnerText = await page.getByLabel("Manual runner coding loop").textContent();
  for (const label of ["1. Goal", "2. Context selected", "3. Prompt drafted", "4. Response received", "5. Edit proposed/applied", "6. Verification", "7. Follow-up"]) {
    assert(manualRunnerText?.includes(label), `Manual runner panel missed step label: ${label}`);
  }
}

async function assertNoManualRunnerSideEffects(page, description) {
  const counts = await page.evaluate(() => {
    const messages = window.__yetAiVsCodeMessages ?? [];
    return {
      apply: messages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length,
      ideActions: messages.filter((message) => message?.type === "gui.ideActionRequest").length,
    };
  });
  assert(counts.apply === 0, `${description} unexpectedly emitted apply request(s): ${counts.apply}`);
  assert(counts.ideActions === 0, `${description} unexpectedly emitted IDE action request(s): ${counts.ideActions}`);
  assert(providerHits === 0, `${description} unexpectedly sent provider request(s): ${providerHits}`);
}

async function assertNoAutonomousBridgeActions(page) {
  const messages = await page.evaluate(() => window.__yetAiVsCodeMessages ?? []);
  const applyRequests = messages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest");
  const ideActionRequests = messages.filter((message) => message?.type === "gui.ideActionRequest");
  const ideActions = ideActionRequests.map((message) => message?.payload?.action);
  assert(applyRequests.length === 1, `Expected exactly one explicit apply request, observed ${applyRequests.length}.`);
  assert(deepEqual(applyRequests[0]?.payload, safeEditProposal.payload), "The only apply request was not the reviewed safe-edit proposal.");
  assert(ideActionRequests.length === 3, `Expected three explicit IDE action requests (two active-file excerpts and one repository verification), observed ${ideActionRequests.length}: ${ideActions.join(", ")}`);
  assert(ideActions.filter((action) => action === "getActiveFileExcerpt").length === 2, `Expected exactly two explicit active-file excerpt requests, observed ${ideActions.join(", ")}`);
  assert(ideActions.filter((action) => action === "runVerificationCommand").length === 1, `Expected exactly one explicit verification request, observed ${ideActions.join(", ")}`);
  assert(!ideActions.includes("getContextSnapshot"), "Manual runner loop performed a hidden context read.");
  assert(!ideActions.includes("searchWorkspaceSnippets"), "Manual runner loop performed a hidden project snippet search.");
  assert(!ideActions.includes("openWorkspaceFile") && !ideActions.includes("revealWorkspaceRange"), "Manual runner loop performed hidden navigation/read actions.");
  const verificationPayloads = ideActionRequests.filter((message) => message?.payload?.action === "runVerificationCommand").map((message) => message.payload);
  assert(deepEqual(verificationPayloads[0], { action: "runVerificationCommand", commandId: "repository-check" }), "Verification request was not the strict explicit repository-check payload.");
}

async function exerciseExplicitContextBundle(page) {
  await setChatId(page, chatId);
  await deliverActiveFileExcerpt(page, bundleContextOne);
  await expectVisibleText(page, "Active file excerpt", "first active-file excerpt card", 20_000);
  await expectVisibleText(page, bundleContextOne.path, "first active-file excerpt path", 20_000);
  await page.getByRole("button", { name: "Add to multi-file context bundle" }).click();
  await expectVisibleText(page, "1/4 excerpts", "first explicit context bundle item", 20_000);
  await deliverActiveFileExcerpt(page, bundleContextTwo);
  await expectVisibleText(page, bundleContextTwo.path, "second active-file excerpt path", 20_000);
  await page.getByRole("button", { name: "Add to multi-file context bundle" }).click();
  await expectVisibleText(page, "2/4 excerpts", "second explicit context bundle item", 20_000);
  await expectVisibleText(page, "Include bundle with next message", "explicit context bundle include state", 20_000);
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageWithBundle);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessageWithBundle, "visible bundle-context user chat bubble", 20_000);
  await expectVisibleText(page, assistantTextWithBundle, "bundle-context streamed assistant response", 30_000);
  await assertAssistantAnswerCount(page, assistantTextWithBundle, 1, "bundle-context streamed assistant response");
  await expectVisibleText(page, "One-shot explicit context bundle attached to the last accepted message and cleared.", "one-shot explicit bundle clear status", 20_000);
  await expectVisibleText(page, "Multi-file context bundle", "explicit context bundle panel after clear", 20_000);
  await expectVisibleText(page, "empty", "explicit context bundle empty after accepted send", 20_000);
  await assertContextSentinelNotVisible(page, "bundle preview after accepted send");
  const activeExcerptInclude = page.locator("label.attached-context-toggle", { hasText: "Attach excerpt to next message" }).getByRole("checkbox");
  if (await activeExcerptInclude.isVisible().catch(() => false)) {
    await activeExcerptInclude.uncheck();
  }
  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageAfterBundle);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessageAfterBundle, "visible post-bundle user chat bubble", 20_000);
  await expectVisibleText(page, assistantTextAfterBundle, "post-bundle streamed assistant response", 30_000);
  await assertAssistantAnswerCount(page, assistantTextAfterBundle, 1, "post-bundle streamed assistant response");
}

async function exerciseEditVerifyLoop(page) {
  const applyRequestsBeforeClick = await getGuiMessageCount(page, "gui.applyWorkspaceEditRequest");
  await page.getByRole("button", { name: "Apply in VS Code after review" }).click();
  const applyRequest = await waitForGuiMessageAfter(page, "gui.applyWorkspaceEditRequest", applyRequestsBeforeClick);
  assert(applyRequest?.version === "2026-05-15", "safe-edit apply request used the wrong bridge version");
  assert(typeof applyRequest.requestId === "string" && /^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/.test(applyRequest.requestId), "safe-edit apply request id was not GUI-owned");
  assert(deepEqual(applyRequest.payload, safeEditProposal.payload), "safe-edit apply request payload did not match the reviewed proposal");
  await page.waitForTimeout(150);
  assert(providerHits === 5, "safe-edit apply click auto-sent a chat request before host result or verification attachment");

  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.applyWorkspaceEditResult",
    requestId: applyRequest.requestId,
    payload: { status: "applied", message: "Mock host applied the reviewed smoke edit.", cloudRequired: false, appliedEditCount: 1, affectedFiles: [activeContextPath] },
  });
  await expectVisibleText(page, "Host apply result: applied", "safe-edit applied host result", 20_000);
  await expectVisibleText(page, "Next safe step: run verification.", "post-apply verification next step", 20_000);
  await page.waitForTimeout(150);
  assert(providerHits === 5, "applied host result auto-sent a chat request before explicit verification attachment");

  const verificationRequestsBeforeClick = await getGuiMessageCount(page, "gui.ideActionRequest");
  await page.getByRole("button", { name: "Repository check", exact: true }).click();
  const verificationRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", verificationRequestsBeforeClick);
  assert(verificationRequest?.version === "2026-05-15", "verification request used the wrong bridge version");
  assert(typeof verificationRequest.requestId === "string" && /^gui-verification-command-\d+$/.test(verificationRequest.requestId), "verification request id was not GUI-owned");
  assert(deepEqual(verificationRequest.payload, { action: "runVerificationCommand", commandId: "repository-check" }), "verification request payload was not the strict repository-check command");
  await expectVisibleText(page, "Run verification command: pending", "verification pending status", 20_000);

  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.ideActionResult",
    requestId: verificationRequest.requestId,
    payload: { status: "failed", message: "Repository check failed in the mock host.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 1, durationMs: 45, outputTail: verificationOutputTail, truncated: false },
  });
  await expectVisibleText(page, "Run verification command: failed", "failed verification result status", 20_000);
  await expectVisibleText(page, "Repository check failed.", "failed verification output tail", 20_000);
  await expectVisibleText(page, "Attach verification result to next message", "explicit verification attach action", 20_000);
  await page.waitForTimeout(150);
  assert(providerHits === 5, "failed verification result auto-sent a chat request before explicit attach and send");

  await page.getByRole("button", { name: "Attach verification result to next message" }).click();
  await expectVisibleText(page, "Verification result attached to next message", "verification result attached button state", 20_000);
  await expectVisibleText(page, "Added repository-check verification output to the one-shot bundle.", "verification output bundle status", 20_000);
  await expectVisibleText(page, "Verification output", "verification output bundle preview", 20_000);
  await page.waitForTimeout(150);
  assert(providerHits === 5, "verification attachment auto-sent a chat request before explicit Send");

  await assertManualRunnerCompleted(page);

  await page.getByPlaceholder("Ask about the current file, selection, or project...").fill(userMessageAfterVerification);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectVisibleText(page, userMessageAfterVerification, "visible verification-context user chat bubble", 20_000);
  await expectVisibleText(page, assistantTextAfterVerification, "verification-context streamed assistant response", 30_000);
  await assertAssistantAnswerCount(page, assistantTextAfterVerification, 1, "verification-context streamed assistant response");
  await expectVisibleText(page, "One-shot explicit context bundle attached to the last accepted message and cleared.", "verification context one-shot clear status", 20_000);
  await expectVisibleText(page, "empty", "explicit context bundle empty after verification send", 20_000);
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

async function applyWorkspaceEditRequestCount(page) {
  return page.evaluate(() => (window.__yetAiSmokeApplyRequests ?? []).length);
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

async function deliverActiveFileExcerpt(page, excerpt) {
  const before = await getGuiMessageCount(page, "gui.ideActionRequest");
  await page.getByRole("button", { name: "Attach active file excerpt", exact: true }).click();
  const request = await waitForGuiMessageAfter(page, "gui.ideActionRequest", before);
  assert(request?.payload?.action === "getActiveFileExcerpt", "GUI did not request active-file excerpt through host bridge");
  await page.evaluate(({ text, path, startLine, startCharacter, endLine, endCharacter, requestId }) => {
    window.postMessage({
      version: "2026-05-15",
      type: "host.ideActionResult",
      requestId,
      payload: {
        status: "succeeded",
        message: "Active file excerpt ready.",
        cloudRequired: false,
        action: "getActiveFileExcerpt",
        contextAttachment: {
          kind: "active_file_excerpt",
          source: "vscode",
          file: { displayPath: path, workspaceRelativePath: path, languageId: "typescript" },
          range: { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } },
          text,
          truncated: false,
        },
      },
    }, window.location.origin);
  }, { ...excerpt, requestId: request.requestId });
}

async function acknowledgeHiddenContextIfNeeded(page) {
  const acknowledgementLabel = page.locator("label.attached-context-toggle", { hasText: "I understand the hidden selected text may be included" });
  if (await acknowledgementLabel.isVisible().catch(() => false)) {
    await acknowledgementLabel.click();
    await page.locator("label.attached-context-toggle", { hasText: "Do not attach" }).getByRole("checkbox").check();
  }
}

async function assertContextSentinelNotVisible(page, description) {
  const body = await page.locator("body").innerText();
  assert(!body.includes(activeContextSentinel) && !body.includes(bundleSentinelOne) && !body.includes(bundleSentinelTwo), `${description} leaked raw context sentinel`);
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
  const guiReady = await waitForGuiMessage(page, "gui.ready");
  await dispatchHostMessage(page, {
    version: "2026-05-15",
    type: "host.ready",
    requestId: guiReady?.requestId,
    payload: { runtimeUrl: runtimeBaseUrl, sessionToken: token, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await assertContextSentinelNotVisible(page, "browser storage after reload before refresh");
  const refreshButton = page.locator("section", { has: page.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: "Refresh runtime" });
  await openDetailsBySummary(page, "Local runtime connection", refreshButton);
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Refresh runtime" && !button.disabled), undefined, { timeout: 20_000 });
  await refreshButton.click();
  await expectAttachedText(page, "Runtime connected", "runtime connection after reload", 20_000);
  await expectVisibleText(page, userMessageWithBundle, "persisted bundle-context message after reload", 20_000);
  await expectVisibleText(page, userMessageAfterBundle, "persisted post-bundle message after reload", 20_000);
  await expectVisibleText(page, userMessageWithContext, "persisted included-context message after reload", 20_000);
  await expectVisibleText(page, userMessageWithoutContext, "persisted omitted-context message after reload", 20_000);
  await expectVisibleText(page, userMessageAfterVerification, "persisted verification-context message after reload", 20_000);
  await expectVisibleText(page, assistantTextWithBundle, "persisted bundle-context assistant response after reload", 20_000);
  await expectVisibleText(page, assistantTextAfterBundle, "persisted post-bundle assistant response after reload", 20_000);
  await expectVisibleText(page, assistantTextWithContext, "persisted included-context assistant response after reload", 20_000);
  await expectVisibleText(page, assistantTextWithoutContext, "persisted omitted-context assistant response after reload", 20_000);
  await expectVisibleText(page, assistantTextAfterVerification, "persisted verification-context assistant response after reload", 20_000);
  await assertContextSentinelNotVisible(page, "reloaded history DOM");
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
  const allowsCurrentPreview = source === "DOM or browser storage";
  for (const marker of secretMarkers) {
    if (marker && lower.includes(marker.toLowerCase())) {
      if (allowsCurrentPreview && (marker === activeContextSentinel || marker === bundleSentinelOne || marker === bundleSentinelTwo) && documentPreviewAllowsMarker(value, marker)) {
        continue;
      }
      throw new Error(`Secret marker leaked through ${source}.`);
    }
  }
}

function documentPreviewAllowsMarker(text, marker) {
  if (!text.includes(marker)) {
    return true;
  }
  const state = JSON.parse(text);
  const storage = JSON.stringify({ localStorage: state.localStorage, sessionStorage: state.sessionStorage });
  if (storage.includes(marker)) {
    return false;
  }
  const body = String(state.body ?? "");
  if (marker === activeContextSentinel) {
    return body.includes(marker) && body.includes("Active editor context") && body.includes(activeContextPath);
  }
  if (!body.includes(marker)) {
    return true;
  }
  return body.includes(marker) && body.includes("Active file excerpt") && (body.includes(bundleContextOne.path) || body.includes(bundleContextTwo.path));
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

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
