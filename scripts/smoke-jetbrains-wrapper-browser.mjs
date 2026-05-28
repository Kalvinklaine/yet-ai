import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const requiredVisibleText = ["Yet AI", "Local runtime connection", "Provider setup", "Chat", "Bridge debug"];
const bridgeVersion = "2026-05-15";
const failures = [];
const runtimeToken = `jb-wrapper-runtime-token-${crypto.randomUUID()}`;
const oauthSentinels = {
  accessToken: `jb-oauth-access-${crypto.randomUUID()}`,
  refreshToken: `jb-oauth-refresh-${crypto.randomUUID()}`,
  authCode: `jb-oauth-code-${crypto.randomUUID()}`,
  verifier: `jb-oauth-verifier-${crypto.randomUUID()}`,
  cookie: `jb-cookie-secret-${crypto.randomUUID()}`,
  apiKey: `sk-jb-wrapper-${crypto.randomUUID()}`,
};
const consoleMessages = [];
let observedRuntimeAuthorization = false;
let chatCommandRequest;
let chatCommandRequestCount = 0;
let chatSubscriptionCount = 0;

await requireBuiltGui();

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error("JetBrains wrapper browser smoke failed: Playwright is not installed or cannot be loaded.");
  console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
  console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const guiServer = await startStaticServer(distRoot);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeServer = await startMockRuntimeServer();
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
const wrapperServer = await startWrapperServer(guiBaseUrl, runtimeBaseUrl);
const wrapperBaseUrl = `http://127.0.0.1:${wrapperServer.port}`;
let browser;

try {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error("JetBrains wrapper browser smoke failed: Playwright Chromium is not installed or cannot be launched.");
    console.error("Run `npm install` from the repository root if needed, then run `npx playwright install chromium`.");
    console.error(`Launch error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const page = await browser.newPage();

  page.on("pageerror", (error) => {
    failures.push(`Page JavaScript error: ${error.message}`);
  });
  page.on("console", (message) => {
    consoleMessages.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isLoopbackServerAsset(url) && (isJsOrCssAssetUrl(url) || response.status() === 404 || response.status() >= 500)) {
      if (response.status() === 404 || response.status() >= 500) {
        failures.push(`Broken local asset response: ${response.status()} ${url}`);
      }
    }
  });

  await page.goto(`${wrapperBaseUrl}/wrapper.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__yetAiWrapperInitialized === true, undefined, { timeout: 5000 }).catch(() => failures.push("Wrapper helper initialization marker was not set."));
  const adoptionState = await page.evaluate(() => ({
    hostAdopted: window.__yetAiAdoptedPreInitHost === true,
    diagnosticAdopted: window.__yetAiAdoptedPreInitDiagnostic === true,
  }));
  if (!adoptionState.hostAdopted) {
    failures.push("Wrapper did not deterministically adopt the pre-init host-message queue.");
  }
  if (!adoptionState.diagnosticAdopted) {
    failures.push("Wrapper did not deterministically adopt the pre-init diagnostic queue.");
  }
  await page.waitForSelector("iframe[title='Yet AI GUI']", { state: "visible", timeout: 5000 });

  const iframeElement = page.locator("iframe[title='Yet AI GUI']");
  const iframeBox = await iframeElement.boundingBox();
  if (!iframeBox || iframeBox.width < 100 || iframeBox.height < 100) {
    failures.push("Wrapper iframe is missing, hidden, or too small.");
  }

  const frameLocator = page.frameLocator("iframe[title='Yet AI GUI']");
  await frameLocator.locator("body").waitFor({ state: "visible", timeout: 5000 });
  await frameLocator.getByText("Yet AI", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });

  for (const text of requiredVisibleText) {
    const visible = await frameLocator.getByText(text, { exact: true }).first().isVisible().catch(() => false);
    if (!visible) {
      failures.push(`Missing visible iframe GUI text: ${text}`);
    }
  }

  const bodyText = (await frameLocator.locator("body").innerText()).trim();
  if (bodyText.length < 80) {
    failures.push(`Iframe GUI body text is too short or blank (${bodyText.length} characters).`);
  }

  const collectedMessages = await page.waitForFunction(() => window.__yetAiBridgeMessages?.some((message) => message?.type === "gui.ready"), undefined, { timeout: 5000 })
    .then(() => page.evaluate(() => window.__yetAiBridgeMessages))
    .catch(() => []);
  if (!Array.isArray(collectedMessages) || !collectedMessages.some((message) => message?.type === "gui.ready" && message?.version === bridgeVersion)) {
    failures.push("Wrapper fake postIntellijMessage bridge did not collect gui.ready from the iframe.");
  }

  const iframeGuiReady = await page.evaluate(() => window.__yetAiIframeGuiReady === true);
  if (!iframeGuiReady) {
    failures.push("GUI iframe did not send gui.ready to the parent wrapper.");
  }
  const bridgeMessageCountBeforeHostileGui = await page.evaluate(() => window.__yetAiBridgeMessages.length);
  await frameLocator.locator("body").evaluate((body, version) => {
    window.parent.postMessage({
      version,
      type: "gui.ready",
      payload: {
        supportedBridgeVersion: version,
        extra: true,
      },
    }, document.referrer ? new URL(document.referrer).origin : "*");
  }, bridgeVersion);
  await frameLocator.locator("body").evaluate((body, version) => {
    window.parent.postMessage({
      version: `${version}-old`,
      type: "gui.ready",
      payload: {
        supportedBridgeVersion: version,
      },
    }, document.referrer ? new URL(document.referrer).origin : "*");
  }, bridgeVersion);
  await page.waitForTimeout(100);
  const bridgeMessageCountAfterHostileGui = await page.evaluate(() => window.__yetAiBridgeMessages.length);
  if (bridgeMessageCountAfterHostileGui !== bridgeMessageCountBeforeHostileGui) {
    failures.push("Wrapper forwarded schema-invalid or wrong-version gui.ready from the iframe.");
  }
  const queueStateAfterReady = await page.evaluate(() => ({
    hostQueue: window.__yetAiPendingHostMessages?.length,
    diagnosticQueue: window.__yetAiPendingDiagnostics?.length,
    flushedPreInitHost: window.__yetAiPreInitHostFlushed === true,
    flushedPreInitDiagnostic: window.__yetAiPreInitDiagnosticFlushed === true,
    diagnosticText: document.getElementById("yet-ai-shell-status")?.textContent ?? "",
    diagnosticDisplayedBeforeFlush: window.__yetAiDiagnosticDisplayedBeforeFlush === true,
    bootstrapHostReadySentCount: window.__yetAiBootstrapHostReadySentCount,
  }));
  if (queueStateAfterReady.hostQueue !== 0 || !queueStateAfterReady.flushedPreInitHost) {
    failures.push("Wrapper did not flush the pre-init queued host message after iframe load/gui.ready.");
  }
  if (queueStateAfterReady.diagnosticQueue !== 0 || !queueStateAfterReady.flushedPreInitDiagnostic || !queueStateAfterReady.diagnosticText.includes("Queued diagnostic before wrapper init") || queueStateAfterReady.diagnosticDisplayedBeforeFlush) {
    failures.push("Wrapper did not prove queued diagnostic adoption and flush without pre-ready direct display.");
  }
  if (queueStateAfterReady.bootstrapHostReadySentCount !== 1) {
    failures.push(`Wrapper sent ${String(queueStateAfterReady.bootstrapHostReadySentCount)} bootstrap host.ready messages instead of exactly one.`);
  }

  await page.evaluate(({ version, runtimeUrl, token }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ready",
      requestId: "login-shaped-runtime-ready",
      payload: {
        runtimeUrl,
        sessionToken: token,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
  }, { version: bridgeVersion, runtimeUrl: runtimeBaseUrl, token: runtimeToken });

  const runtimeInput = frameLocator.getByLabel("Runtime base URL");
  await page.waitForTimeout(250);
  const runtimeInputValue = await runtimeInput.inputValue({ timeout: 5000 }).catch(() => "");
  if (runtimeInputValue !== runtimeBaseUrl) {
    failures.push("Iframe GUI did not apply wrapper host.ready runtime settings.");
  }
  await frameLocator.getByRole("textbox", { name: "Session token", exact: true }).fill(runtimeToken);

  const hostMessagesPostedBeforeInvalidOpened = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate((version) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.openedFromCommand",
      payload: {
        command: "free-form",
      },
    });
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ready",
      requestId: "invalid-host-ready-extra-field",
      payload: {
        runtimeUrl: "http://127.0.0.1:9010",
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
        extra: true,
      },
    });
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ready",
      requestId: "invalid-host-ready-cloud",
      payload: {
        runtimeUrl: "http://127.0.0.1:9011",
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: true,
      },
    });
  }, bridgeVersion);
  await page.waitForTimeout(100);
  const hostMessagesPostedAfterInvalidOpened = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  if (hostMessagesPostedAfterInvalidOpened !== hostMessagesPostedBeforeInvalidOpened) {
    failures.push("Wrapper relayed a schema-invalid host message into the iframe.");
  }

  await page.evaluate((version) => {
    window.postMessage({
      version,
      type: "host.ready",
      payload: {
        runtimeUrl: "http://127.0.0.1:9009",
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    }, window.location.origin);
  }, bridgeVersion);
  await page.waitForTimeout(250);
  const runtimeInputValueAfterHostileMessage = await runtimeInput.inputValue({ timeout: 5000 }).catch(() => "");
  if (runtimeInputValueAfterHostileMessage !== runtimeBaseUrl) {
    failures.push("Wrapper relayed an arbitrary wrapper-origin host.ready postMessage into the iframe.");
  }

  const refreshButton = frameLocator.getByRole("button", { name: "Refresh runtime" });
  await refreshButton.click();
  await refreshButton.click();
  await page.waitForTimeout(500);
  const refreshFeedbackVisible = await frameLocator.getByText(/Runtime (connected|check failed)|Checking runtime…/).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (!refreshFeedbackVisible) {
    failures.push("Refresh runtime click did not produce visible iframe feedback.");
  }
  const refreshAttemptVisible = await frameLocator.getByText(/Attempt \d+ at/).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (!refreshAttemptVisible) {
    failures.push("Refresh runtime feedback did not include a visible attempt/timestamp marker.");
  }

  const targetOrigin = await page.evaluate(() => window.__yetAiFrameTargetOrigin);
  if (targetOrigin !== guiBaseUrl) {
    failures.push(`Wrapper iframe target origin mismatch: expected ${guiBaseUrl}, got ${String(targetOrigin)}.`);
  }

  if (!observedRuntimeAuthorization) {
    failures.push("Mock runtime did not observe the wrapper-supplied runtime session token.");
  }

  await frameLocator.getByText("OpenAI account connected", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show connected OpenAI account login state."));
  await frameLocator.locator("body").evaluate(() => document.documentElement.innerText).then((text) => {
    if (!text.includes("Experimental OpenAI account / gpt-5-codex")) failures.push(`GUI did not show experimental account chat readiness. Body: ${text}`);
  });
  await frameLocator.getByText(/Ready to send using|Experimental Codex-like OpenAI account chat is connected/).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show chat readiness for the experimental account path."));
  if (failures.length > 0) {
    reportFailures();
  }
  await frameLocator.getByRole("button", { name: "Send" }).waitFor({ state: "visible", timeout: 5000 });

  await frameLocator.getByPlaceholder("Ask Yet AI...").fill("Say hello through JetBrains login-shaped smoke.");
  await frameLocator.getByRole("button", { name: "Send" }).click();
  await frameLocator.getByText("JetBrains login smoke", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not render the assistant response from mock SSE."));
  if (chatCommandRequestCount !== 1) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests instead of exactly one.`);
  }
  if (chatSubscriptionCount !== 1) {
    failures.push(`Mock runtime received ${chatSubscriptionCount} chat subscriptions instead of exactly one.`);
  }
  if (chatCommandRequest?.payload?.content !== "Say hello through JetBrains login-shaped smoke.") {
    failures.push("Mock runtime did not receive the expected GUI chat message content.");
  }

  await page.waitForTimeout(250);
  const browserVisibleState = await collectBrowserVisibleState(page);
  assertNoSecretLeak(browserVisibleState, [
    runtimeToken,
    oauthSentinels.accessToken,
    oauthSentinels.refreshToken,
    oauthSentinels.authCode,
    oauthSentinels.verifier,
    oauthSentinels.cookie,
    oauthSentinels.apiKey,
    "authorization: bearer",
    "set-cookie",
    "client_secret",
  ]);

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("JetBrains wrapper browser smoke passed.");
  console.log("Checked JetBrains-like wrapper iframe rendering, exact loopback target origin, real gui.ready to host.ready wrapper bridge delivery, Refresh runtime click feedback, bridge collector, login-shaped first-message chat through mock runtime/SSE, JavaScript execution, and local JS/CSS asset responses.");
  console.log("No engine, provider credentials, OpenAI/ChatGPT, hosted Yet AI services, JetBrains IDE, or JCEF automation were used.");
} finally {
  await browser?.close().catch(() => undefined);
  await wrapperServer.close();
  await runtimeServer.close();
  await guiServer.close();
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) {
      failures.push("Built GUI index.html does not reference Vite assets. Run `cd apps/gui && npm run build` and retry.");
    }
  } catch {
    console.error("JetBrains wrapper browser smoke failed: built GUI is missing.");
    console.error("Run `cd apps/gui && npm run build` before `npm run smoke:jetbrains-wrapper-browser`.");
    console.error(`Expected file: ${path.relative(root, indexPath)}`);
    process.exit(1);
  }
}

async function startWrapperServer(guiBaseUrl, runtimeBaseUrl) {
  const wrapperHtml = renderWrapperHtml(guiBaseUrl, runtimeBaseUrl);
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || (requestUrl.pathname !== "/" && requestUrl.pathname !== "/wrapper.html")) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(wrapperHtml);
  });
  return listen(server);
}

function renderWrapperHtml(guiBaseUrl, runtimeBaseUrl) {
  const indexUrl = `${guiBaseUrl}/index.html`;
  const bootstrapHostReady = JSON.stringify({
    version: bridgeVersion,
    type: "host.ready",
    requestId: "browser-smoke",
    payload: {
      runtimeUrl: runtimeBaseUrl,
      sessionToken: runtimeToken,
      productId: "yet-ai",
      displayName: "Yet AI",
      cloudRequired: false,
    },
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yet AI</title>
<style>
body { margin: 0; font-family: sans-serif; }
iframe { width: 100vw; height: 100vh; border: 0; }
#yet-ai-shell-status, #yet-ai-shell-fallback { position: fixed; left: 12px; bottom: 12px; z-index: 1; max-width: 80vw; padding: 8px 10px; border-radius: 8px; background: #111827; color: #f9fafb; font-size: 12px; }
#yet-ai-shell-fallback { top: 24px; bottom: auto; background: #7f1d1d; }
#yet-ai-shell-fallback[hidden], #yet-ai-shell-status[hidden] { display: none; }
</style>
</head>
<body>
<div id="yet-ai-shell-status" role="status">Loading packaged Yet AI GUI from <code>${escapeHtml(indexUrl)}</code> with origin <code>${escapeHtml(guiBaseUrl)}</code>.</div>
<div id="yet-ai-shell-fallback" role="alert" hidden>Packaged Yet AI GUI did not finish loading from the local loopback server.</div>
<iframe title="Yet AI GUI" src="${escapeHtml(indexUrl)}"></iframe>
<script>
window.__yetAiPendingHostMessages = [{
  version: "${bridgeVersion}",
  type: "host.ready",
  requestId: "pre-init-smoke",
  payload: {
    runtimeUrl: ${JSON.stringify(runtimeBaseUrl)},
    sessionToken: ${JSON.stringify(runtimeToken)},
    productId: "yet-ai",
    displayName: "Yet AI",
    cloudRequired: false,
  },
}];
window.__yetAiPendingDiagnostics = ["Queued diagnostic before wrapper init"];
</script>
<script defer>
const bootstrapHostReady = ${bootstrapHostReady};
const bridgeVersion = "${bridgeVersion}";
const frame = document.querySelector("iframe");
const frameTargetOrigin = "${guiBaseUrl}";
const shellStatus = document.getElementById("yet-ai-shell-status");
const shellFallback = document.getElementById("yet-ai-shell-fallback");
window.__yetAiBridgeMessages = [];
window.__yetAiFrameTargetOrigin = frameTargetOrigin;
window.__yetAiIframeGuiReady = false;
window.__yetAiBootstrapHostReadySentCount = 0;
window.__yetAiHostMessagesPostedCount = 0;
let frameLoaded = false;
let frameReady = false;
let flushingPending = false;
let bootstrapSent = false;
const pendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages : [];
const pendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics : [];
window.__yetAiAdoptedPreInitHost = pendingHostMessages.some((message) => message?.requestId === "pre-init-smoke");
window.__yetAiAdoptedPreInitDiagnostic = pendingDiagnostics.includes("Queued diagnostic before wrapper init");
window.__yetAiPendingHostMessages = pendingHostMessages;
window.__yetAiPendingDiagnostics = pendingDiagnostics;
const showDiagnostic = (message) => {
  if (shellStatus && typeof message === "string") {
    if (message === "Queued diagnostic before wrapper init" && !flushingPending) window.__yetAiDiagnosticDisplayedBeforeFlush = true;
    shellStatus.hidden = false;
    shellStatus.textContent = "Runtime error: " + message;
    if (message === "Queued diagnostic before wrapper init" && flushingPending) window.__yetAiPreInitDiagnosticFlushed = true;
  }
};
window.__yetAiSetRuntimeDiagnostic = (message) => {
  if (!frameReady) {
    pendingDiagnostics.push(message);
    return;
  }
  showDiagnostic(message);
};
const markLoaded = () => {
  frameLoaded = true;
  if (shellStatus) shellStatus.hidden = true;
  if (shellFallback) shellFallback.hidden = true;
};
if (shellFallback && frame) {
  window.setTimeout(() => {
    if (!frameLoaded) shellFallback.hidden = false;
  }, 8000);
}
window.postIntellijMessage = (message) => {
  window.__yetAiBridgeMessages.push(message);
};
const postToFrame = (message) => {
  if (frame && frame.contentWindow && frameTargetOrigin && isHostMessage(message)) {
    frame.contentWindow.postMessage(message, frameTargetOrigin);
    window.__yetAiHostMessagesPostedCount += 1;
    if (message?.requestId === "pre-init-smoke") window.__yetAiPreInitHostFlushed = true;
  }
};
const flushPending = () => {
  flushingPending = true;
  while (pendingDiagnostics.length > 0) showDiagnostic(pendingDiagnostics.shift());
  while (pendingHostMessages.length > 0) postToFrame(pendingHostMessages.shift());
  flushingPending = false;
};
const sendToFrame = (message) => {
  if (!isHostMessage(message)) return;
  if (!frameReady) {
    pendingHostMessages.push(message);
    return;
  }
  postToFrame(message);
};
const sendBootstrap = () => {
  if (bootstrapSent) return;
  bootstrapSent = true;
  window.__yetAiBootstrapHostReadySentCount += 1;
  sendToFrame(bootstrapHostReady);
};
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (record, keys) => Object.keys(record).every((key) => keys.includes(key));
const isRequestId = (value) => value === undefined || (typeof value === "string" && value.length >= 1 && value.length <= 128);
const optionalString = (value) => value === undefined || typeof value === "string";
const isHostReadyPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["runtimeUrl", "sessionToken", "productId", "displayName", "cloudRequired"]) && optionalString(payload.runtimeUrl) && optionalString(payload.sessionToken) && optionalString(payload.productId) && optionalString(payload.displayName) && payload.cloudRequired === false;
const isHostMessage = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || !isRequestId(message.requestId)) return false;
  if (message.type === "host.ready") return isHostReadyPayload(message.payload);
  if (message.type === "host.openedFromCommand") return message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0);
  return false;
};
const isGuiMessage = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.ready" || !isRequestId(message.requestId)) return false;
  return message.payload === undefined || (isPlainObject(message.payload) && hasOnlyKeys(message.payload, ["supportedBridgeVersion"]) && (message.payload.supportedBridgeVersion === undefined || message.payload.supportedBridgeVersion === bridgeVersion));
};
window.__yetAiSendHostMessageToFrame = sendToFrame;
window.__yetAiWrapperInitialized = true;
window.addEventListener("message", (event) => {
  if (event.source === frame?.contentWindow) {
    if (frameTargetOrigin && frameTargetOrigin !== "*" && event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isGuiMessage(event.data)) {
      frameReady = true;
      flushPending();
      window.__yetAiIframeGuiReady = true;
      window.postIntellijMessage(event.data);
      sendBootstrap();
    } else {
      console.log("Yet AI rejected invalid iframe GUI bridge message");
    }
    return;
  }
});
if (frame) {
  frame.addEventListener("load", () => {
    markLoaded();
    frameReady = true;
    flushPending();
    sendBootstrap();
  });
}
</script>
</body>
</html>`;
}

async function startMockRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (request.headers.authorization === `Bearer ${runtimeToken}`) {
      observedRuntimeAuthorization = true;
    }
    if (!isAuthorizedRuntimeRequest(request)) {
      json(response, 401, { error: "Unauthorized local runtime request. Check the session token." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/ping") {
      json(response, 200, {
        productId: "yet-ai",
        displayName: "Yet AI",
        version: "0.0.0-smoke",
        ready: true,
        serverTime: new Date(0).toISOString(),
      });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/caps") {
      json(response, 200, {
        productId: "yet-ai",
        protocolVersion: "2026-05-15",
        runtime: {
          mode: "local",
          cloudRequired: false,
          providerAccess: "direct",
        },
        capabilities: ["chat"],
        features: {},
        providers: [],
        ide: {
          bridge: true,
          lsp: false,
          host: "jetbrains-wrapper-smoke",
        },
      });
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
      json(response, 200, connectedProviderAuthStatus());
      return;
    }
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(requestUrl.pathname);
    if (request.method === "POST" && commandMatch) {
      const body = await readRequestBody(request);
      chatCommandRequestCount += 1;
      chatCommandRequest = JSON.parse(body);
      json(response, 200, {
        accepted: true,
        chatId: decodeURIComponent(commandMatch[1]),
        requestId: chatCommandRequest.requestId,
        type: chatCommandRequest.type,
      });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/subscribe") {
      chatSubscriptionCount += 1;
      const chatId = requestUrl.searchParams.get("chat_id") ?? "chat-001";
      response.writeHead(200, {
        ...corsHeaders(),
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify({
        seq: 0,
        type: "snapshot",
        chatId,
        payload: {
          thread: { id: chatId, messages: [] },
          runtime: { streaming: false },
        },
      })}\n\n`);
      setTimeout(() => {
        response.write(`data: ${JSON.stringify({ seq: 1, type: "stream_started", chatId, payload: { role: "assistant" } })}\n\n`);
        response.write(`data: ${JSON.stringify({ seq: 2, type: "stream_delta", chatId, payload: { delta: { content: "JetBrains" } } })}\n\n`);
        response.write(`data: ${JSON.stringify({ seq: 3, type: "stream_delta", chatId, payload: { delta: { content: " login smoke" } } })}\n\n`);
        response.write(`data: ${JSON.stringify({ seq: 4, type: "stream_finished", chatId, payload: { finishReason: "stop" } })}\n\n`);
        response.end();
      }, 100);
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

function connectedProviderAuthStatus() {
  return {
    provider: "openai",
    configured: true,
    status: "connected",
    authSource: "oauth",
    supportsLogin: true,
    supportsApiKey: true,
    cloudRequired: false,
    accountLabel: "jetbrains-smoke@example.test",
    scopes: ["openid", "profile", "email"],
    redacted: "cod-...safe",
    expiresAt: "2030-01-01T00:00:00Z",
    message: "Experimental Codex-like account path connected by mock runtime.",
  };
}

function isAuthorizedRuntimeRequest(request) {
  return request.headers.authorization === `Bearer ${runtimeToken}`;
}

function json(response, status, body) {
  response.writeHead(status, {
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept",
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function collectBrowserVisibleState(page) {
  const pageState = await page.evaluate(() => ({
    dom: document.documentElement.innerText,
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
    bridgeMessages: window.__yetAiBridgeMessages,
  }));
  const frameState = await page.frameLocator("iframe[title='Yet AI GUI']").locator("body").evaluate(() => ({
    dom: document.documentElement.innerText,
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  }));
  return JSON.stringify({ pageState, frameState, consoleMessages });
}

function assertNoSecretLeak(text, values) {
  const lower = text.toLowerCase();
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (lower.includes(String(value).toLowerCase())) {
      failures.push(`Secret marker leaked to browser-visible state: ${value}`);
    }
  }
}

async function startStaticServer(staticRoot) {
  const realStaticRoot = await realpath(staticRoot);
  const server = http.createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }
    let requestUrl;
    let pathname;
    try {
      requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
    const requestedPath = path.normalize(path.join(realStaticRoot, pathname));
    let realRequestedPath;
    try {
      realRequestedPath = await realpath(requestedPath);
    } catch {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    if (!isPathInsideRoot(realStaticRoot, realRequestedPath)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const fileStat = await stat(realRequestedPath);
      if (!fileStat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(realRequestedPath) });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = createReadStream(realRequestedPath);
      stream.on("error", () => {
        if (!response.headersSent) {
          response.writeHead(404);
        }
        response.end();
      });
      stream.pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  return listen(server);
}

function isPathInsideRoot(rootPath, requestedPath) {
  const relativePath = path.relative(rootPath, requestedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port.");
  }

  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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
  return isLoopbackServerAsset(url) && (resourceType === "script" || resourceType === "stylesheet" || isJsOrCssAssetUrl(url));
}

function isLoopbackServerAsset(url) {
  return url.startsWith("http://127.0.0.1:");
}

function isJsOrCssAssetUrl(value) {
  const pathname = new URL(value).pathname;
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function reportFailures() {
  console.error("JetBrains wrapper browser smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
