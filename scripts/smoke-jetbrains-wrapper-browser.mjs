import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const requiredVisibleText = ["Yet AI", "Local runtime connection", "Provider setup", "Chat with Yet AI", "Bridge debug"];
const bridgeVersion = "2026-05-15";
const failures = [];
const runtimeToken = `jb-wrapper-runtime-token-${randomUUID()}`;
const oauthSentinels = {
  accessToken: `jb-oauth-access-${randomUUID()}`,
  refreshToken: `jb-oauth-refresh-${randomUUID()}`,
  authCode: `jb-oauth-code-${randomUUID()}`,
  verifier: `jb-oauth-verifier-${randomUUID()}`,
  cookie: `jb-cookie-secret-${randomUUID()}`,
  apiKey: `sk-jb-wrapper-${randomUUID()}`,
};
const activeContextSelectionMarker = `context marker ${randomUUID()}`;
const jetbrainsContextSnapshot = {
  kind: "active_editor",
  source: "jetbrains",
  file: {
    displayPath: "src/main/kotlin/ContextSmoke.kt",
    workspaceRelativePath: "src/main/kotlin/ContextSmoke.kt",
    languageId: "kotlin",
  },
  selection: {
    startLine: 12,
    startCharacter: 4,
    endLine: 12,
    endCharacter: 42,
    text: activeContextSelectionMarker,
  },
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
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:8001/")) {
      await route.abort();
      return;
    }
    if (isAllowedBrowserUrl(url, [wrapperBaseUrl, guiBaseUrl, runtimeBaseUrl])) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected browser request outside wrapper/GUI/runtime allowlist: ${redactUrl(url)}`);
    await route.abort();
  });

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
    if ((url.startsWith(guiBaseUrl) || url.startsWith(wrapperBaseUrl)) && (isJsOrCssAssetUrl(url) || response.status() === 404 || response.status() >= 500)) {
      if (response.status() === 404 || response.status() >= 500) {
        failures.push(`Broken local asset response: ${response.status()} ${url}`);
      }
    }
  });

  await page.goto(`${wrapperBaseUrl}/wrapper.html`, { waitUntil: "domcontentloaded" });
  await assertLeakDetectorSelfCheck(page);
  const initialLeakState = await collectWrapperLeakState(page);
  assertNoSecretLeak(initialLeakState, [
    { label: "runtime token", value: runtimeToken },
    { label: "OAuth access token", value: oauthSentinels.accessToken },
    { label: "OAuth refresh token", value: oauthSentinels.refreshToken },
    { label: "OAuth auth code", value: oauthSentinels.authCode },
    { label: "OAuth verifier", value: oauthSentinels.verifier },
    { label: "cookie secret", value: oauthSentinels.cookie },
    { label: "API key", value: oauthSentinels.apiKey },
    { label: "active context selection marker", value: activeContextSelectionMarker },
  ]);
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
  const bridgeMessageCountBeforeHostileGui = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
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
  const bridgeMessageCountAfterHostileGui = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
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
  }));
  if (queueStateAfterReady.hostQueue !== 0 || queueStateAfterReady.flushedPreInitHost) {
    failures.push("Wrapper did not drop the pre-init queued host messages after iframe load/gui.ready.");
  }
  if (queueStateAfterReady.diagnosticQueue !== 0 || !queueStateAfterReady.flushedPreInitDiagnostic || !queueStateAfterReady.diagnosticText.includes("Queued diagnostic before wrapper init") || queueStateAfterReady.diagnosticDisplayedBeforeFlush) {
    failures.push("Wrapper did not prove queued diagnostic adoption and flush without pre-ready direct display.");
  }
  await page.waitForFunction(() => typeof window.__yetAiSendHostMessageToFrame === "function", undefined, { timeout: 5000 }).catch(() => failures.push("Wrapper host-message sender helper was not installed."));
  const currentReadyRequestId = await page.evaluate(() => window.__yetAiCurrentReadyRequestId);
  assertRandomReadyRequestId(currentReadyRequestId, "initial gui.ready");
  await assertInvalidRuntimeUrlsRejected(page, bridgeVersion, currentReadyRequestId);
  await assertRepeatedExplicitRequestIdUsesWrapperNonce(page, frameLocator, bridgeVersion, guiBaseUrl, runtimeBaseUrl, runtimeToken);
  if (failures.length > 0) {
    reportFailures();
  }
  const activeReadyRequestId = await page.evaluate(() => window.__yetAiCurrentReadyRequestId);
  await page.evaluate(({ version, runtimeUrl, token, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ready",
      requestId,
      payload: {
        runtimeUrl,
        sessionToken: token,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
  }, { version: bridgeVersion, runtimeUrl: runtimeBaseUrl, token: runtimeToken, requestId: activeReadyRequestId });

  const runtimeInput = frameLocator.getByLabel("Runtime base URL");
  await page.waitForTimeout(250);
  const runtimeInputValue = await runtimeInput.inputValue({ timeout: 5000 }).catch(() => "");
  if (runtimeInputValue !== runtimeBaseUrl) {
    failures.push("Iframe GUI did not apply wrapper host.ready runtime settings.");
  }
  await page.evaluate(({ version, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.openedFromCommand",
      requestId,
      payload: {},
    });
  }, { version: bridgeVersion, requestId: activeReadyRequestId });
  const hostMessagesPostedBeforeInvalidOpened = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ version, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.openedFromCommand",
      requestId,
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
  }, { version: bridgeVersion, requestId: activeReadyRequestId });
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

  await assertOldDocumentGuiReadyCannotAuthorizeDelivery(page, frameLocator, bridgeVersion, guiBaseUrl, runtimeBaseUrl, runtimeToken);
  await assertReloadRequiresFreshGuiReady(page, bridgeVersion, guiBaseUrl, runtimeBaseUrl, runtimeToken);

  await frameLocator.getByText("State: Experimental OpenAI account / gpt-5-codex", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not use host.ready runtime endpoints to enter connected experimental readiness."));

  const refreshButton = frameLocator.getByRole("button", { name: "Refresh runtime" }).first();
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
  await frameLocator.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "visible", timeout: 5000 });
  if (await frameLocator.getByRole("button", { name: "Send", exact: true }).isDisabled().catch(() => true)) {
    failures.push("Send was not enabled for the JetBrains first-message preview path after safe mock readiness.");
  }

  const contextRequestId = await page.evaluate(() => window.__yetAiCurrentReadyRequestId);
  await page.evaluate(({ version, payload, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.contextSnapshot",
      requestId,
      payload,
    });
  }, { version: bridgeVersion, payload: jetbrainsContextSnapshot, requestId: contextRequestId });
  await frameLocator.getByText("Active editor context", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show attached context preview for JetBrains context."));
  await frameLocator.getByText("jetbrains", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context source label."));
  await frameLocator.getByText("File: src/main/kotlin/ContextSmoke.kt", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show safe JetBrains context file label."));
  await frameLocator.getByText("Language: kotlin", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context language id."));
  await frameLocator.getByText(activeContextSelectionMarker, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context selected text preview."));
  const includeContextToggle = frameLocator.locator("label.attached-context-toggle", { hasText: "Attach to next message" }).getByRole("checkbox");
  if (!await includeContextToggle.isChecked({ timeout: 5000 }).catch(() => false)) {
    failures.push("JetBrains attached context include toggle was not enabled by default.");
  }
  await includeContextToggle.uncheck();
  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill("Send without JetBrains context.");
  await frameLocator.getByRole("button", { name: "Send", exact: true }).click();
  await frameLocator.getByText("JetBrains login smoke", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not render the assistant response from mock SSE."));
  if (chatCommandRequestCount !== 1) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests after disabled-toggle send instead of exactly one.`);
  }
  if (chatCommandRequest?.payload?.content !== "Send without JetBrains context.") {
    failures.push("Mock runtime did not receive the expected disabled-toggle chat message content.");
  }
  if (chatCommandRequest?.payload && Object.prototype.hasOwnProperty.call(chatCommandRequest.payload, "context")) {
    failures.push("Mock runtime received active context even though the include toggle was disabled.");
  }

  await page.evaluate(({ version, payload, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.contextSnapshot",
      requestId,
      payload,
    });
  }, { version: bridgeVersion, payload: jetbrainsContextSnapshot, requestId: contextRequestId });
  await includeContextToggle.waitFor({ state: "visible", timeout: 5000 });
  if (!await includeContextToggle.isChecked({ timeout: 5000 }).catch(() => false)) {
    failures.push("JetBrains attached context include toggle was not re-enabled for the next context snapshot.");
  }
  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill("Say hello through JetBrains login-shaped smoke.");
  await frameLocator.getByRole("button", { name: "Send", exact: true }).click();
  await frameLocator.getByText("JetBrains login smoke", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not render the assistant response from mock SSE after context send."));
  if (chatCommandRequestCount !== 2) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests instead of exactly two.`);
  }
  if (chatSubscriptionCount < 1 || chatSubscriptionCount > 2) {
    failures.push(`Mock runtime received ${chatSubscriptionCount} chat subscriptions instead of one or two expected local subscriptions.`);
  }
  if (chatCommandRequest?.payload?.content !== "Say hello through JetBrains login-shaped smoke.") {
    failures.push("Mock runtime did not receive the expected GUI chat message content.");
  }
  assertJetBrainsContext(chatCommandRequest?.payload?.context);

  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__yetAiHostMessagesPosted = window.__yetAiHostMessagesPosted?.filter((message) => message?.type !== "host.contextSnapshot") ?? [];
    window.__yetAiBridgeMessages = window.__yetAiBridgeMessages?.filter((message) => message?.type !== "host.ready") ?? [];
    window.__yetAiPendingHostMessages = [];
  });
  const browserVisibleState = await collectBrowserVisibleState(page);
  assertNoSecretLeak(browserVisibleState, [
    { label: "runtime token", value: runtimeToken },
    { label: "OAuth access token", value: oauthSentinels.accessToken },
    { label: "OAuth refresh token", value: oauthSentinels.refreshToken },
    { label: "OAuth auth code", value: oauthSentinels.authCode },
    { label: "OAuth verifier", value: oauthSentinels.verifier },
    { label: "cookie secret", value: oauthSentinels.cookie },
    { label: "API key", value: oauthSentinels.apiKey },
    { label: "active context selection marker", value: activeContextSelectionMarker },
    { label: "authorization header marker", value: "authorization: bearer" },
    { label: "set-cookie marker", value: "set-cookie" },
    { label: "client secret marker", value: "client_secret" },
  ]);

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("JetBrains wrapper browser smoke passed.");
  console.log("Checked JetBrains-like wrapper iframe rendering, exact loopback target origin, real gui.ready to host.ready/contextSnapshot wrapper bridge delivery, attached-context preview/default include/disabled-toggle behavior, Refresh runtime click feedback, bridge collector, login-shaped first-message chat through mock runtime/SSE, JavaScript execution, and local JS/CSS asset responses.");
  console.log("No engine, provider credentials, OpenAI/ChatGPT, hosted Yet AI services, JetBrains IDE, or JCEF automation were used.");
} finally {
  await browser?.close().catch(() => undefined);
  await wrapperServer.close();
  await runtimeServer.close();
  await guiServer.close();
}

function assertRandomReadyRequestId(requestId, label) {
  if (typeof requestId !== "string" || !/^gui-ready-\d+-\d+-[0-9a-f]{32}$/.test(requestId)) {
    failures.push(`Wrapper did not synthesize a random authoritative ready id for ${label}, got ${String(requestId)}.`);
  }
}

async function assertInvalidRuntimeUrlsRejected(page, version, currentReadyRequestId) {
  const invalidRuntimeUrls = [
    undefined,
    "",
    "https://example.com/",
    "http://user@127.0.0.1/",
    "http://127.0.0.1/?token=unsafe",
    "http://127.0.0.1/#token",
    "http://127.0.0.1/v1",
  ];
  const before = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ bridgeVersion, urls }) => {
    for (const runtimeUrl of urls) {
      window.__yetAiSendHostMessageToFrame({
        version: bridgeVersion,
        type: "host.ready",
        requestId: `invalid-runtime-url-${runtimeUrl}`,
        payload: {
          ...(runtimeUrl === undefined ? {} : { runtimeUrl }),
          productId: "yet-ai",
          displayName: "Yet AI",
          cloudRequired: false,
        },
      });
    }
  }, { bridgeVersion: version, urls: invalidRuntimeUrls });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  if (after !== before) {
    failures.push("Wrapper relayed host.ready with a non-loopback, credentialed, queried, fragmented, or non-root runtime URL.");
  }
  const batchBefore = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ bridgeVersion, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.ready",
      requestId,
      payload: {
        runtimeUrl: "http://127.0.0.1/v1",
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.openedFromCommand",
      requestId,
      payload: {},
    });
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.contextSnapshot",
      requestId,
      payload: {
        kind: "active_editor",
        source: "jetbrains",
        file: {
          displayPath: "src/main/kotlin/Blocked.kt",
        },
      },
    });
  }, { bridgeVersion: version, requestId: currentReadyRequestId });
  const batchAfter = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  if (batchAfter !== batchBefore) {
    failures.push("Wrapper relayed opened/context messages from a batch whose host.ready runtime URL was invalid.");
  }
}

async function assertOldDocumentGuiReadyCannotAuthorizeDelivery(page, frameLocator, version, guiUrl, runtimeUrl, token) {
  const beforeUnloadEvents = await page.evaluate(() => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.unloaded").length);
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame) => {
    frame.src = "about:blank";
  });
  await page.waitForFunction((count) => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.unloaded").length > count, beforeUnloadEvents, { timeout: 5000 }).catch(() => failures.push("Wrapper did not report iframe unload during old-document gui.ready smoke."));
  const beforeReadySequence = await page.evaluate(() => window.__yetAiGuiReadySequence ?? 0);
  const beforePostedCount = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  const staleAttempt = await page.evaluate(({ bridgeVersion, readyUrl, sessionToken }) => new Promise((resolve) => {
    const oldWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
    oldWindow?.postMessage({
      version: bridgeVersion,
      type: "gui.ready",
      payload: { supportedBridgeVersion: bridgeVersion },
    }, "*");
    window.setTimeout(() => {
      const requestId = window.__yetAiCurrentReadyRequestId;
      window.__yetAiSendHostMessageToFrame({
        version: bridgeVersion,
        type: "host.ready",
        requestId,
        payload: {
          runtimeUrl: readyUrl,
          sessionToken,
          productId: "yet-ai",
          displayName: "Yet AI",
          cloudRequired: false,
        },
      });
      resolve({
        readySequence: window.__yetAiGuiReadySequence ?? 0,
        postedCount: window.__yetAiHostMessagesPostedCount,
      });
    }, 50);
  }), { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token });
  if (staleAttempt.readySequence !== beforeReadySequence) {
    failures.push("Wrapper accepted stale old-document gui.ready from the previous iframe document.");
  }
  if (staleAttempt.postedCount !== beforePostedCount) {
    failures.push("Wrapper allowed stale old-document gui.ready to authorize host delivery.");
  }
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame, url) => {
    frame.src = `${url}/index.html`;
  }, guiUrl);
  await page.waitForFunction((count) => (window.__yetAiGuiReadySequence ?? 0) > count, beforeReadySequence, { timeout: 5000 }).catch(() => failures.push("Wrapper did not observe fresh gui.ready after old-document regression reload."));
  const currentRequestId = await page.evaluate(() => window.__yetAiCurrentReadyRequestId);
  assertRandomReadyRequestId(currentRequestId, "fresh gui.ready after old-document regression");
  await page.evaluate(({ bridgeVersion, readyUrl, sessionToken, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.ready",
      requestId,
      payload: {
        runtimeUrl: readyUrl,
        sessionToken,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token, requestId: currentRequestId });
  await frameLocator.getByLabel("Runtime base URL").inputValue({ timeout: 5000 }).catch(() => failures.push("Current gui.ready path did not keep working after old-document regression."));
}

async function assertReloadRequiresFreshGuiReady(page, version, guiUrl, runtimeUrl, token) {
  const beforeUnloadEvents = await page.evaluate(() => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.unloaded").length);
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame) => {
    frame.src = "about:blank";
  });
  await page.waitForFunction((count) => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.unloaded").length > count, beforeUnloadEvents, { timeout: 5000 }).catch(() => failures.push("Wrapper did not report iframe unload during reload smoke."));
  const beforeReloadCount = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  const afterReloadState = await page.evaluate(({ bridgeVersion, readyUrl, sessionToken }) => {
    const staleRequestId = "stale-before-fresh-ready";
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.ready",
      requestId: staleRequestId,
      payload: {
        runtimeUrl: readyUrl,
        sessionToken,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
    return {
      count: window.__yetAiHostMessagesPostedCount,
      queueLength: window.__yetAiPendingHostMessages.length,
      bridgeMessages: window.__yetAiBridgeMessages,
    };
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token });
  if (afterReloadState.count !== beforeReloadCount) {
    failures.push("Wrapper delivered host.ready after iframe reload before fresh gui.ready.");
  }
  if (afterReloadState.queueLength !== 0) {
    failures.push("Wrapper queued stale host.ready after iframe reload before fresh gui.ready.");
  }
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame, url) => {
    frame.src = `${url}/index.html`;
  }, guiUrl);
  await page.waitForFunction((count) => (window.__yetAiGuiReadySequence ?? 0) > count, afterReloadState.bridgeMessages.filter((message) => message?.type === "gui.ready").length, { timeout: 5000 }).catch(() => failures.push("Wrapper did not observe fresh gui.ready after reload."));
  const staleDeliveredAfterFreshReady = await page.evaluate((beforeCount) => window.__yetAiHostMessagesPosted?.slice(beforeCount).some((message) => message?.requestId === "stale-before-fresh-ready"), beforeReloadCount);
  if (staleDeliveredAfterFreshReady) {
    failures.push("Wrapper delivered stale old-frame host.ready after fresh gui.ready following reload.");
  }
  const currentRequestId = await page.evaluate(() => window.__yetAiCurrentReadyRequestId);
  await page.evaluate(({ bridgeVersion, readyUrl, sessionToken, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.ready",
      requestId,
      payload: {
        runtimeUrl: readyUrl,
        sessionToken,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token, requestId: currentRequestId });
}

async function assertRepeatedExplicitRequestIdUsesWrapperNonce(page, frameLocator, version, guiUrl, runtimeUrl, token) {
  await frameLocator.locator("body").evaluate((body, bridgeVersion) => {
    window.parent.postMessage({
      version: bridgeVersion,
      type: "gui.ready",
      requestId: "same",
      payload: { supportedBridgeVersion: bridgeVersion },
    }, document.referrer ? new URL(document.referrer).origin : "*");
  }, version);
  await page.waitForTimeout(100);
  const oldNonce = await page.evaluate(() => window.__yetAiCurrentReadyRequestId);
  assertRandomReadyRequestId(oldNonce, "explicit same requestId before reload");
  if (oldNonce === "same") {
    failures.push(`Wrapper used GUI-supplied requestId instead of authoritative nonce before reload: ${String(oldNonce)}.`);
  }
  const beforeUnloadEvents = await page.evaluate(() => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.unloaded").length);
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame) => {
    frame.src = "about:blank";
  });
  await page.waitForFunction((count) => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.unloaded").length > count, beforeUnloadEvents, { timeout: 5000 }).catch(() => failures.push("Wrapper did not report iframe unload during repeated requestId smoke."));
  const beforeStaleCount = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ bridgeVersion, readyUrl, sessionToken }) => {
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.ready",
      requestId: "same",
      payload: {
        runtimeUrl: readyUrl,
        sessionToken,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token });
  const afterStaleState = await page.evaluate(() => ({
    count: window.__yetAiHostMessagesPostedCount,
    queueLength: window.__yetAiPendingHostMessages.length,
    guiReadySequence: window.__yetAiGuiReadySequence,
  }));
  if (afterStaleState.count !== beforeStaleCount) {
    failures.push("Wrapper delivered stale same-requestId host.ready during iframe reload.");
  }
  if (afterStaleState.queueLength !== 0) {
    failures.push("Wrapper queued stale same-requestId host.ready during iframe reload.");
  }
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame, url) => {
    frame.src = `${url}/index.html`;
  }, guiUrl);
  await page.waitForFunction((count) => (window.__yetAiGuiReadySequence ?? 0) > count, afterStaleState.guiReadySequence, { timeout: 5000 }).catch(() => failures.push("Wrapper did not observe fresh gui.ready after repeated requestId reload."));
  await frameLocator.locator("body").evaluate((body, bridgeVersion) => {
    window.parent.postMessage({
      version: bridgeVersion,
      type: "gui.ready",
      requestId: "same",
      payload: { supportedBridgeVersion: bridgeVersion },
    }, document.referrer ? new URL(document.referrer).origin : "*");
  }, version);
  await page.waitForTimeout(100);
  const afterRepeatedReady = await page.evaluate(({ beforeCount, oldRequestId }) => ({
    currentRequestId: window.__yetAiCurrentReadyRequestId,
    deliveredSame: window.__yetAiHostMessagesPosted?.slice(beforeCount).some((message) => message?.requestId === "same") === true,
    deliveredOldNonce: window.__yetAiHostMessagesPosted?.slice(beforeCount).some((message) => message?.requestId === oldRequestId) === true,
  }), { beforeCount: beforeStaleCount, oldRequestId: oldNonce });
  assertRandomReadyRequestId(afterRepeatedReady.currentRequestId, "explicit same requestId after reload");
  if (!afterRepeatedReady.currentRequestId || afterRepeatedReady.currentRequestId === "same" || afterRepeatedReady.currentRequestId === oldNonce) {
    failures.push("Wrapper did not issue a fresh authoritative nonce for repeated explicit gui.ready requestId after reload.");
  }
  if (afterRepeatedReady.deliveredSame || afterRepeatedReady.deliveredOldNonce) {
    failures.push("Wrapper delivered stale host message after repeated explicit gui.ready requestId across reload.");
  }
  const beforeOldNonceReplayCount = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ bridgeVersion, readyUrl, sessionToken, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.ready",
      requestId,
      payload: {
        runtimeUrl: readyUrl,
        sessionToken,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token, requestId: oldNonce });
  const afterOldNonceReplayCount = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  if (afterOldNonceReplayCount !== beforeOldNonceReplayCount) {
    failures.push("Wrapper delivered a stale host.ready bound to the previous authoritative ready id after a new ready id was accepted.");
  }
}

function assertJetBrainsContext(context) {
  if (!context || typeof context !== "object") {
    failures.push("Mock runtime did not receive active context on the enabled-toggle chat command.");
    return;
  }
  if (context.kind !== "active_editor") {
    failures.push("Mock runtime active context kind was not active_editor.");
  }
  if (context.source !== "jetbrains") {
    failures.push("Mock runtime active context source was not jetbrains.");
  }
  if (context.file?.displayPath !== jetbrainsContextSnapshot.file.displayPath) {
    failures.push("Mock runtime active context did not include the expected safe display path.");
  }
  if (context.file?.workspaceRelativePath !== jetbrainsContextSnapshot.file.workspaceRelativePath) {
    failures.push("Mock runtime active context did not include the expected safe workspace-relative path.");
  }
  if (context.file?.languageId !== jetbrainsContextSnapshot.file.languageId) {
    failures.push("Mock runtime active context did not include the expected language id.");
  }
  if (context.selection?.text !== activeContextSelectionMarker) {
    failures.push("Mock runtime active context did not include the expected selected text marker.");
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
  requestId: "gui-ready",
  payload: {
    runtimeUrl: "${runtimeBaseUrl}",
    productId: "yet-ai",
    displayName: "Yet AI",
    cloudRequired: false,
  },
}, {
  version: "${bridgeVersion}",
  type: "host.openedFromCommand",
  requestId: "gui-ready",
  payload: {},
}];
window.__yetAiPendingDiagnostics = ["Queued diagnostic before wrapper init"];
</script>
<script defer>
const bridgeVersion = "${bridgeVersion}";
const frame = document.querySelector("iframe");
const frameTargetOrigin = "${guiBaseUrl}";
const shellStatus = document.getElementById("yet-ai-shell-status");
const shellFallback = document.getElementById("yet-ai-shell-fallback");
window.__yetAiBridgeMessages = [];
window.__yetAiFrameTargetOrigin = frameTargetOrigin;
window.__yetAiIframeGuiReady = false;
window.__yetAiHostMessagesPostedCount = 0;
window.__yetAiHostMessagesPosted = [];
window.__yetAiGuiReadySequence = 0;
let frameLoaded = false;
let frameReady = false;
let frameGeneration = 0;
let currentFrameWindow = frame?.contentWindow;
let currentGuiReadyRequestId;
let guiReadySequence = 0;
let currentGuiReadySequence = 0;
let acceptedHostReadyRequestId;
let hostReadyAcceptedForCurrentFrame = false;
let flushingPending = false;
const pendingHostMessages = Array.isArray(window.__yetAiPendingHostMessages) ? window.__yetAiPendingHostMessages : [];
const pendingDiagnostics = Array.isArray(window.__yetAiPendingDiagnostics) ? window.__yetAiPendingDiagnostics : [];
window.__yetAiAdoptedPreInitHost = pendingHostMessages.some((message) => message?.requestId === "gui-ready");
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
const currentReadyRequestId = () => currentGuiReadyRequestId;
const randomReadyToken = () => {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") return undefined;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const wrapperReadyRequestId = (sequence) => {
  const token = randomReadyToken();
  return token === undefined ? undefined : "gui-ready-" + frameGeneration + "-" + sequence + "-" + token;
};
const messageMatchesCurrentReady = (message) => frameReady && currentGuiReadySequence === guiReadySequence && message.requestId === currentReadyRequestId();
const canDeliverHostMessage = (message) => {
  if (!messageMatchesCurrentReady(message)) return false;
  if (message.type === "host.ready") return true;
  return hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId();
};
const postToFrame = (message) => {
  if (frame && currentFrameWindow && frame.contentWindow === currentFrameWindow && frameTargetOrigin && isHostMessage(message) && canDeliverHostMessage(message)) {
    currentFrameWindow.postMessage(message, frameTargetOrigin);
    window.__yetAiHostMessagesPostedCount += 1;
    window.__yetAiHostMessagesPosted.push(message);
    if (message.type === "host.ready") {
      acceptedHostReadyRequestId = message.requestId;
      hostReadyAcceptedForCurrentFrame = true;
    }
    if (message?.type === "host.ready" && message?.requestId === "gui-ready") window.__yetAiPreInitHostFlushed = true;
    if (message?.type === "host.openedFromCommand" && message?.requestId === "gui-ready") window.__yetAiPreInitOpenedFlushed = true;
  }
};
const flushPending = () => {
  flushingPending = true;
  while (pendingDiagnostics.length > 0) showDiagnostic(pendingDiagnostics.shift());
  pendingHostMessages.length = 0;
  flushingPending = false;
};
const sendToFrame = (message) => {
  if (!isHostMessage(message)) return;
  if (!frameReady) return;
  postToFrame(message);
};
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (record, keys) => Object.keys(record).every((key) => keys.includes(key));
const isRequestId = (value) => value === undefined || (typeof value === "string" && value.length >= 1 && value.length <= 128 && value.split("").every((char) => char >= " " && char.charCodeAt(0) !== 127));
const optionalString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length <= maxLength);
const optionalNonEmptyString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
const requiredLoopbackRuntimeUrl = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopback && parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "" && (parsed.pathname === "" || parsed.pathname === "/");
  } catch (_) {
    return false;
  }
};
const optionalNumber = (value) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 1000000);
const safePath = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.startsWith("/") && !value.startsWith("~") && !value.includes("\\\\") && !value.includes(":") && value.split("").every((char) => char >= " ") && value.split("/").every((part) => part !== "." && part !== ".."));
const isContextFile = (file) => file === undefined || (isPlainObject(file) && hasOnlyKeys(file, ["displayPath", "workspaceRelativePath", "languageId"]) && Object.keys(file).length > 0 && safePath(file.displayPath, 256) && safePath(file.workspaceRelativePath, 512) && (file.languageId === undefined || (typeof file.languageId === "string" && file.languageId.length > 0 && file.languageId.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(file.languageId))));
const isContextSelection = (selection) => selection === undefined || (isPlainObject(selection) && hasOnlyKeys(selection, ["startLine", "startCharacter", "endLine", "endCharacter", "text"]) && Object.keys(selection).length > 0 && optionalNumber(selection.startLine) && optionalNumber(selection.startCharacter) && optionalNumber(selection.endLine) && optionalNumber(selection.endCharacter) && optionalString(selection.text, 8000));
const isContextSnapshotPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["kind", "source", "file", "selection"]) && payload.kind === "active_editor" && (payload.source === "vscode" || payload.source === "jetbrains" || payload.source === "browser") && isContextFile(payload.file) && isContextSelection(payload.selection);
const isHostReadyPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["runtimeUrl", "sessionToken", "productId", "displayName", "cloudRequired"]) && requiredLoopbackRuntimeUrl(payload.runtimeUrl) && optionalString(payload.sessionToken, 4096) && optionalNonEmptyString(payload.productId, 256) && optionalNonEmptyString(payload.displayName, 256) && (payload.cloudRequired === undefined || payload.cloudRequired === false);
const isHostMessage = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || !isRequestId(message.requestId)) return false;
  if (message.type === "host.ready") return isHostReadyPayload(message.payload);
  if (message.type === "host.contextSnapshot") return isContextSnapshotPayload(message.payload);
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
  if (event.source === currentFrameWindow && event.source === frame?.contentWindow) {
    if (frameTargetOrigin && frameTargetOrigin !== "*" && event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isGuiMessage(event.data)) {
      frameReady = true;
      guiReadySequence += 1;
      currentGuiReadySequence = guiReadySequence;
      window.__yetAiGuiReadySequence = guiReadySequence;
      currentGuiReadyRequestId = wrapperReadyRequestId(currentGuiReadySequence);
      if (currentGuiReadyRequestId === undefined) {
        frameReady = false;
        currentGuiReadySequence = 0;
        console.log("Yet AI rejected gui.ready because secure wrapper randomness is unavailable");
        return;
      }
      const readyMessage = { ...event.data, requestId: currentGuiReadyRequestId };
      window.__yetAiCurrentReadyRequestId = currentGuiReadyRequestId;
      acceptedHostReadyRequestId = undefined;
      hostReadyAcceptedForCurrentFrame = false;
      flushPending();
      window.__yetAiIframeGuiReady = true;
      window.postIntellijMessage(readyMessage);
    } else {
      console.log("Yet AI rejected invalid iframe GUI bridge message");
    }
    return;
  }
});
if (frame) {
  frame.addEventListener("load", () => {
    frameReady = false;
    frameGeneration += 1;
    currentFrameWindow = frame.contentWindow;
    currentGuiReadySequence = 0;
    currentGuiReadyRequestId = undefined;
    acceptedHostReadyRequestId = undefined;
    hostReadyAcceptedForCurrentFrame = false;
    pendingHostMessages.length = 0;
    window.postIntellijMessage({ version: bridgeVersion, type: "gui.unloaded", payload: {} });
    markLoaded();
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
    const allowedOrigin = request.headers.origin === undefined || request.headers.origin === runtimeBaseUrl || request.headers.origin === wrapperBaseUrl || request.headers.origin === guiBaseUrl;
    if (!allowedOrigin) {
      failures.push(`Mock runtime received request from unexpected origin ${String(request.headers.origin)}.`);
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
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats") {
      json(response, 200, { chats: [] });
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

async function assertLeakDetectorSelfCheck(page) {
  const leaked = await page.evaluate((token) => {
    const marker = document.createElement("div");
    marker.id = "yet-ai-leak-detector-self-check";
    marker.textContent = token;
    document.body.append(marker);
    window.localStorage.setItem("yet-ai-leak-detector-self-check", token);
    window.sessionStorage.setItem("yet-ai-leak-detector-self-check", token);
    return JSON.stringify({
      dom: document.documentElement.innerText,
      localStorage: { ...window.localStorage },
      sessionStorage: { ...window.sessionStorage },
    });
  }, runtimeToken);
  const before = failures.length;
  assertNoSecretLeak(leaked, [{ label: "runtime token self-check", value: runtimeToken }]);
  if (failures.length === before) {
    failures.push("Runtime token leak detector self-check did not catch DOM/storage leaks.");
  } else {
    failures.splice(before, failures.length - before);
  }
  await page.evaluate(() => {
    document.getElementById("yet-ai-leak-detector-self-check")?.remove();
    window.localStorage.removeItem("yet-ai-leak-detector-self-check");
    window.sessionStorage.removeItem("yet-ai-leak-detector-self-check");
  });
}

async function collectWrapperLeakState(page) {
  return page.evaluate(() => {
    const globals = Object.fromEntries(Object.entries(window)
      .filter(([key]) => key.startsWith("__yetAi"))
      .map(([key, value]) => [key, typeof value === "function" ? "[function]" : value]));
    return JSON.stringify({
      outerHTML: document.documentElement.outerHTML,
      scripts: Array.from(document.scripts, (script) => script.textContent ?? ""),
      globals,
    });
  });
}

async function collectPageLeakState(page) {
  return page.evaluate(() => ({
    dom: document.documentElement.innerText,
    outerHTML: document.documentElement.outerHTML,
    scriptText: Array.from(document.scripts, (script) => script.textContent ?? ""),
    globals: Object.fromEntries(Object.entries(window)
      .filter(([key]) => key.startsWith("__yetAi"))
      .filter(([key]) => !["__yetAiBridgeMessages", "__yetAiPendingHostMessages", "__yetAiHostMessagesPosted", "__yetAiRuntimeTokenSentinel"].includes(key))
      .map(([key, value]) => [key, typeof value === "function" ? "[function]" : value])),
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  }));
}

async function collectBrowserVisibleState(page) {
  const pageState = await collectPageLeakState(page);
  const frameState = await page.frameLocator("iframe[title='Yet AI GUI']").locator("body").evaluate(() => {
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]'));
    const inputValues = Array.from(document.querySelectorAll("input, textarea"), (input) => {
      if (passwordInputs.includes(input)) return undefined;
      return input.value;
    }).filter((value) => typeof value === "string");
    return {
      dom: document.documentElement.innerText,
      outerHTML: (() => {
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll('input[type="password"]').forEach((input) => input.setAttribute("value", "[password-value]"));
        return clone.outerHTML;
      })(),
      scriptText: Array.from(document.scripts, (script) => script.textContent ?? ""),
      globals: Object.fromEntries(Object.entries(window)
        .filter(([key]) => key.startsWith("__yetAi"))
        .map(([key, value]) => [key, typeof value === "function" ? "[function]" : value])),
      passwordInputs: Array.from(document.querySelectorAll('input[type="password"]'), (input) => ({
        autocomplete: input.autocomplete,
        placeholder: input.placeholder,
        type: input.type,
      })),
      inputValues,
      localStorage: { ...window.localStorage },
      sessionStorage: { ...window.sessionStorage },
    };
  });
  return JSON.stringify({ pageState, frameState, consoleMessages });
}

function assertNoSecretLeak(text, markers) {
  const lower = text.toLowerCase();
  for (const marker of markers) {
    if (!marker?.value) {
      continue;
    }
    if (lower.includes(String(marker.value).toLowerCase())) {
      failures.push(`Secret marker leaked to browser-visible state: ${marker.label}`);
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

function isAllowedBrowserUrl(value, origins) {
  try {
    const url = new URL(value);
    return origins.includes(url.origin);
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
    return String(value);
  }
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
