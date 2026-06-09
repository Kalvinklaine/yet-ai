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
const runtimeToken = `jb.wrapper.runtime.${randomUUID().replaceAll("-", "")}`;
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
const maxRuntimeRequestBodyBytes = 1024 * 1024;

class RequestBodyTooLargeError extends Error {}

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

const guiServer = await startStaticServer(distRoot, { injectJetBrainsFrameBridge: true });
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
  const sessionTokenInputMetadata = await frameLocator.locator('input[type="password"]').first().evaluate((input) => ({ autocomplete: input.autocomplete, placeholder: input.placeholder })).catch(() => undefined);
  if (sessionTokenInputMetadata?.autocomplete !== "off") {
    failures.push("Runtime Session token input did not disable browser autocomplete in the JetBrains wrapper GUI.");
  }
  const deliveredHostReady = await page.evaluate((readyUrl) => window.__yetAiHostMessagesPosted?.some((message) => message?.type === "host.ready" && message?.payload?.runtimeUrl === readyUrl), runtimeBaseUrl);
  if (!deliveredHostReady) {
    failures.push("Wrapper did not deliver trusted host.ready runtime bootstrap to the GUI iframe.");
  }
  const bridgeIdentityVisible = await frameLocator.getByText("bridge jetbrains", { exact: true }).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (!bridgeIdentityVisible) {
    failures.push("GUI did not expose JetBrains host identity / bridge mode after wrapper bootstrap.");
  }
  await assertSingleBackslashContextPathRejected(page, bridgeVersion, activeReadyRequestId);
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
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ready",
      requestId: "bad\u0080request",
      payload: {
        runtimeUrl: "http://127.0.0.1:9012",
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
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
  await resendCurrentHostReadyAndWaitForRuntimeInput(page, frameLocator, bridgeVersion, runtimeBaseUrl, runtimeToken);

  await frameLocator.getByText("Runtime connected", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("Runtime refresh did not reach connected/provider-required state after trusted host.ready."));
  await frameLocator.getByText("Provider setup", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("Provider setup panel was not visible in the JetBrains first-use GUI path."));
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

  const contextRequestId = await page.evaluate(({ version, runtimeUrl, token, payload }) => {
    const requestId = window.__yetAiCurrentReadyRequestId;
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
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.openedFromCommand",
      requestId,
      payload: {},
    });
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.contextSnapshot",
      requestId,
      payload,
    });
    return requestId;
  }, { version: bridgeVersion, runtimeUrl: runtimeBaseUrl, token: runtimeToken, payload: jetbrainsContextSnapshot });
  await frameLocator.getByText("Active editor context", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show attached context preview for JetBrains context."));
  await frameLocator.getByText("jetbrains", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context source label."));
  await frameLocator.getByText("File: src/main/kotlin/ContextSmoke.kt", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show safe JetBrains context file label."));
  await frameLocator.getByText("Language: kotlin", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context language id."));
  await frameLocator.getByText(activeContextSelectionMarker, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context selected text preview."));
  await assertJetBrainsIdeActionRoundtrip(page, frameLocator);
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

  await assertMockRuntimeRejectsBadChatBodies(runtimeBaseUrl);

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
  const oldFrameState = await page.evaluate(() => ({
    oldWindow: document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow,
    oldNonce: window.__yetAiCurrentFrameNonce,
  }));
  const beforeReadySequence = await page.evaluate(() => window.__yetAiGuiReadySequence ?? 0);
  const beforePostedCount = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ bridgeVersion, origin }) => {
    const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
    window.dispatchEvent(new MessageEvent("message", {
      data: { version: bridgeVersion, type: "gui.unloaded", payload: {} },
      origin,
      source: frameWindow,
    }));
  }, { bridgeVersion: version, origin: guiUrl });
  await page.waitForFunction((count) => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.unloaded").length > count, beforeUnloadEvents, { timeout: 5000 }).catch(() => failures.push("Wrapper did not report iframe unload during old-document gui.ready smoke."));
  const afterUnloadState = await page.evaluate(() => ({
    currentRequestId: window.__yetAiCurrentReadyRequestId,
    currentNonce: window.__yetAiCurrentFrameNonce,
    pendingHostMessages: window.__yetAiPendingHostMessages?.length,
  }));
  if (afterUnloadState.currentRequestId !== undefined || afterUnloadState.currentNonce !== undefined || afterUnloadState.pendingHostMessages !== 0) {
    failures.push("Wrapper did not invalidate ready id, frame nonce, and pending host messages on gui.unloaded before iframe load.");
  }
  const staleAttempt = await page.evaluate(({ bridgeVersion, readyUrl, sessionToken, oldNonce, origin }) => new Promise((resolve) => {
    const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
    const currentNonce = window.__yetAiCurrentFrameNonce;
    const attempts = [undefined, "0".repeat(32), oldNonce].filter((nonce) => nonce !== currentNonce);
    for (const frameNonce of attempts) {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          version: bridgeVersion,
          type: "gui.ready",
          payload: { supportedBridgeVersion: bridgeVersion, ...(frameNonce === undefined ? {} : { frameNonce }) },
        },
        origin,
        source: frameWindow,
      }));
    }
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
  }), { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token, oldNonce: oldFrameState.oldNonce, origin: guiUrl });
  if (staleAttempt.readySequence !== beforeReadySequence) {
    failures.push("Wrapper accepted stale, missing, or wrong-nonce gui.ready through the parent message handler.");
  }
  if (staleAttempt.postedCount !== beforePostedCount) {
    failures.push("Wrapper allowed rejected stale gui.ready to authorize host delivery.");
  }
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame) => {
    frame.src = "about:blank";
  });
  await page.waitForTimeout(100);
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
      guiReadySequence: window.__yetAiGuiReadySequence ?? 0,
    };
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token });
  if (afterReloadState.count !== beforeReloadCount) {
    failures.push("Wrapper delivered host.ready after iframe reload before fresh gui.ready.");
  }
  if (afterReloadState.queueLength !== 0) {
    failures.push("Wrapper queued stale host.ready after iframe reload before fresh gui.ready.");
  }
  const beforeRandomFailureSequence = await page.evaluate(() => window.__yetAiGuiReadySequence ?? 0);
  const randomFailureState = await page.evaluate(({ bridgeVersion, origin }) => {
    const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
    const originalGetRandomValues = globalThis.crypto?.getRandomValues;
    try {
      Object.defineProperty(globalThis.crypto, "getRandomValues", { value: undefined, configurable: true });
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          version: bridgeVersion,
          type: "gui.ready",
          payload: { supportedBridgeVersion: bridgeVersion, frameNonce: window.__yetAiCurrentFrameNonce },
        },
        origin,
        source: frameWindow,
      }));
    } finally {
      Object.defineProperty(globalThis.crypto, "getRandomValues", { value: originalGetRandomValues, configurable: true });
    }
    return {
      readySequence: window.__yetAiGuiReadySequence ?? 0,
      currentRequestId: window.__yetAiCurrentReadyRequestId,
    };
  }, { bridgeVersion: version, origin: guiUrl });
  if (randomFailureState.readySequence !== beforeRandomFailureSequence || randomFailureState.currentRequestId !== undefined) {
    failures.push(`Wrapper mutated readiness state when secure randomness was unavailable for gui.ready: before=${beforeRandomFailureSequence} after=${randomFailureState.readySequence} requestId=${String(randomFailureState.currentRequestId)}.`);
  }
  const randomFailureDiagnostic = await page.evaluate(() => document.getElementById("yet-ai-shell-status")?.textContent ?? "");
  if (!randomFailureDiagnostic.includes("Secure browser randomness is unavailable")) {
    failures.push("Wrapper did not show a bounded shell diagnostic when secure randomness was unavailable.");
  }
  const previousFrameNonce = await page.evaluate(() => window.__yetAiLastFrameNonceForSmoke ?? window.__yetAiCurrentFrameNonce);
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame, url) => {
    frame.src = `${url}/index.html`;
  }, guiUrl);
  await page.waitForFunction((oldNonce) => {
    const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
    const currentNonce = window.__yetAiCurrentFrameNonce;
    const lastNonce = window.__yetAiLastFrameNonceForSmoke;
    return frameWindow && typeof currentNonce === "string" && /^[0-9a-f]{32}$/.test(currentNonce) && currentNonce === lastNonce && currentNonce !== oldNonce;
  }, previousFrameNonce, { timeout: 5000 }).catch(() => failures.push("Wrapper did not create a fresh frame nonce after reload."));
  const freshReadyState = await page.evaluate(({ bridgeVersion, origin, sequenceBeforeReload }) => new Promise((resolve) => {
    const readyIdPattern = /^gui-ready-\d+-\d+-[0-9a-f]{32}$/;
    const deadline = Date.now() + 5000;
    const sendFreshReady = () => {
      const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
      const frameNonce = window.__yetAiCurrentFrameNonce;
      if (frameWindow && typeof frameNonce === "string" && /^[0-9a-f]{32}$/.test(frameNonce)) {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            version: bridgeVersion,
            type: "gui.ready",
            payload: { supportedBridgeVersion: bridgeVersion, frameNonce },
          },
          origin,
          source: frameWindow,
        }));
      }
      const readySequence = window.__yetAiGuiReadySequence ?? 0;
      const currentRequestId = window.__yetAiCurrentReadyRequestId;
      if (readySequence > sequenceBeforeReload && readyIdPattern.test(currentRequestId)) {
        resolve({ readySequence, currentRequestId });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ readySequence, currentRequestId });
        return;
      }
      window.setTimeout(sendFreshReady, 100);
    };
    sendFreshReady();
  }), { bridgeVersion: version, origin: guiUrl, sequenceBeforeReload: afterReloadState.guiReadySequence });
  if ((freshReadyState.readySequence ?? 0) <= afterReloadState.guiReadySequence) {
    failures.push("Wrapper did not observe fresh gui.ready after reload.");
  }
  assertRandomReadyRequestId(freshReadyState.currentRequestId, "fresh gui.ready after reload");
  const staleDeliveredAfterFreshReady = await page.evaluate((beforeCount) => window.__yetAiHostMessagesPosted?.slice(beforeCount).some((message) => message?.requestId === "stale-before-fresh-ready"), beforeReloadCount);
  if (staleDeliveredAfterFreshReady) {
    failures.push("Wrapper delivered stale old-frame host.ready after fresh gui.ready following reload.");
  }
  await page.waitForFunction(() => window.__yetAiCurrentReadyRequestId !== undefined, undefined, { timeout: 5000 }).catch(() => failures.push("Wrapper did not expose current ready id after reload."));
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
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.openedFromCommand",
      requestId,
      payload: {},
    });
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token, requestId: currentRequestId });
}

async function resendCurrentHostReadyAndWaitForRuntimeInput(page, frameLocator, version, runtimeUrl, token) {
  await page.waitForFunction(() => window.__yetAiCurrentReadyRequestId !== undefined, undefined, { timeout: 5000 }).catch(() => undefined);
  const requestId = await page.evaluate(() => window.__yetAiCurrentReadyRequestId);
  assertRandomReadyRequestId(requestId, "post-reload host.ready resend");
  if (typeof requestId !== "string") return;
  await page.evaluate(({ bridgeVersion, readyUrl, sessionToken, currentRequestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.ready",
      requestId: currentRequestId,
      payload: {
        runtimeUrl: readyUrl,
        sessionToken,
        productId: "yet-ai",
        displayName: "Yet AI",
        cloudRequired: false,
      },
    });
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.openedFromCommand",
      requestId: currentRequestId,
      payload: {},
    });
  }, { bridgeVersion: version, readyUrl: runtimeUrl, sessionToken: token, currentRequestId: requestId });

  const runtimeInput = frameLocator.getByLabel("Runtime base URL");
  const deadline = Date.now() + 5000;
  let value = "";
  while (Date.now() < deadline) {
    value = await runtimeInput.inputValue({ timeout: 1000 }).catch(() => "");
    if (value === runtimeUrl) return;
    await page.waitForTimeout(100);
  }
  failures.push(`Iframe GUI did not apply post-reload wrapper host.ready runtime settings. Expected ${runtimeUrl}, got ${value || "<empty>"}.`);
}

async function assertRepeatedExplicitRequestIdUsesWrapperNonce(page, frameLocator, version, guiUrl, runtimeUrl, token) {
  await page.evaluate(({ bridgeVersion, origin }) => {
    const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "gui.ready",
        requestId: "same",
        payload: { supportedBridgeVersion: bridgeVersion, frameNonce: window.__yetAiCurrentFrameNonce },
      },
      origin,
      source: frameWindow,
    }));
  }, { bridgeVersion: version, origin: guiUrl });
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
  await page.evaluate(({ bridgeVersion, origin }) => {
    const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "gui.ready",
        requestId: "same",
        payload: { supportedBridgeVersion: bridgeVersion, frameNonce: window.__yetAiCurrentFrameNonce },
      },
      origin,
      source: frameWindow,
    }));
  }, { bridgeVersion: version, origin: guiUrl });
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

async function assertSingleBackslashContextPathRejected(page, version, requestId) {
  const before = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ bridgeVersion, activeRequestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version: bridgeVersion,
      type: "host.contextSnapshot",
      requestId: activeRequestId,
      payload: {
        kind: "active_editor",
        source: "jetbrains",
        file: {
          displayPath: "src\\Secret.kt",
          workspaceRelativePath: "src\\Secret.kt",
          languageId: "kotlin",
        },
      },
    });
  }, { bridgeVersion: version, activeRequestId: requestId });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  if (after !== before) {
    failures.push("Wrapper relayed host.contextSnapshot with a single-backslash path.");
  }
}

async function assertMockRuntimeRejectsBadChatBodies(baseUrl) {
  const malformed = await fetch(`${baseUrl}/v1/chats/chat-001/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${runtimeToken}`,
      "content-type": "application/json",
    },
    body: "{not-json",
  });
  const malformedText = await malformed.text();
  if (malformed.status !== 400 || !malformedText.includes("Invalid chat command JSON") || malformedText.includes("not-json")) {
    failures.push("Mock runtime did not reject malformed chat command JSON with a generic 400 response.");
  }
  const oversized = await fetch(`${baseUrl}/v1/chats/chat-001/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${runtimeToken}`,
      "content-type": "application/json",
    },
    body: "x".repeat(maxRuntimeRequestBodyBytes + 1),
  });
  const oversizedText = await oversized.text();
  if (oversized.status !== 413 || !oversizedText.includes("Request body too large") || oversizedText.includes("xxx")) {
    failures.push("Mock runtime did not reject oversized chat command bodies with a generic 413 response.");
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

async function assertJetBrainsIdeActionRoundtrip(page, frameLocator) {
  await frameLocator.getByText("JetBrains controlled actions", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not expose JetBrains controlled action controls."));
  const before = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0);
  const ideActionText = await frameLocator.locator("section[aria-label='Agent activity IDE actions']").innerText({ timeout: 5000 }).catch(() => "");
  if (!ideActionText.includes("Get IDE context")) {
    failures.push(`Iframe GUI JetBrains IDE action panel did not include Get IDE context. Panel: ${ideActionText}`);
    return;
  }
  await frameLocator.locator("section[aria-label='Agent activity IDE actions'] button").filter({ hasText: "Get IDE context" }).first().click();
  await page.waitForFunction((count) => (window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0) === count + 1, before, { timeout: 5000 })
    .catch(() => failures.push("Wrapper did not collect exactly one gui.ideActionRequest after Get IDE context click."));

  const requests = await page.evaluate((count) => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").slice(count) ?? [], before);
  if (requests.length !== 1) {
    failures.push(`Wrapper collected ${requests.length} gui.ideActionRequest messages after one Get IDE context click.`);
    return;
  }
  const request = requests[0];
  if (!request || request.version !== bridgeVersion || request.payload?.action !== "getContextSnapshot" || Object.keys(request.payload ?? {}).length !== 1) {
    failures.push(`Wrapper collected malformed gui.ideActionRequest: ${JSON.stringify(request)}`);
    return;
  }
  if (typeof request.requestId !== "string" || request.requestId.length === 0 || request.requestId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(request.requestId)) {
    failures.push(`Wrapper collected unbounded or invalid IDE action request id: ${String(request.requestId)}.`);
    return;
  }

  await page.evaluate(({ version, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ideActionProgress",
      requestId,
      payload: { phase: "running", status: "inProgress", summary: "Reading active editor context.", cloudRequired: false, action: "getContextSnapshot" },
    });
  }, { version: bridgeVersion, requestId: request.requestId });
  await frameLocator.getByText("Get IDE context: inProgress", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render JetBrains IDE action progress."));

  const beforeOldContextDelivery = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  await page.evaluate(({ version, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ideActionResult",
      requestId,
      payload: { status: "succeeded", message: "Old context shape should be rejected.", cloudRequired: false, action: "getContextSnapshot", context: { source: "jetbrains", kind: "active_editor" } },
    });
  }, { version: bridgeVersion, requestId: request.requestId });
  await page.waitForTimeout(100);
  const afterOldContextDelivery = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
  if (afterOldContextDelivery !== beforeOldContextDelivery) failures.push("Wrapper/private delivery accepted old {source, kind} IDE action result context shape.");
  const oldContextRendered = await frameLocator.getByText("Old context shape should be rejected.", { exact: false }).first().isVisible().catch(() => false);
  if (oldContextRendered) failures.push("Iframe GUI rendered rejected old {source, kind} IDE action result context shape.");

  await page.evaluate(({ version, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.ideActionResult",
      requestId,
      payload: {
        status: "succeeded",
        message: "IDE context snapshot captured.",
        cloudRequired: false,
        action: "getContextSnapshot",
        context: { source: "jetbrains", hasActiveEditor: true, workspaceFolderCount: 1 },
      },
    });
  }, { version: bridgeVersion, requestId: request.requestId });
  await frameLocator.getByText("Get IDE context: succeeded", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render JetBrains IDE action success."));
  await frameLocator.getByText("Result context: source jetbrains · active editor present yes · workspace folders 1", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render sanitized JetBrains IDE action result context metadata."));
  await assertForbiddenIdeActionMessagesRejected(page, frameLocator);
}

async function assertForbiddenIdeActionMessagesRejected(page, frameLocator) {
  const before = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
  await frameLocator.locator("body").evaluate((body, version) => {
    const target = document.referrer ? new URL(document.referrer).origin : "*";
    const messages = [
      { version, type: "gui.applyWorkspaceEditRequest", requestId: "forbidden-apply", payload: {} },
      { version, type: "gui.openFile", requestId: "forbidden-open", payload: { workspaceRelativePath: "src/App.tsx" } },
      { version, type: "gui.revealRange", requestId: "forbidden-reveal", payload: { workspaceRelativePath: "src/App.tsx" } },
      { version, type: "gui.executeIdeTool", requestId: "forbidden-tool", payload: { tool: "anything" } },
      { version, type: "gui.ideActionRequest", requestId: "unsafe-path", payload: { action: "openWorkspaceFile", workspaceRelativePath: "../secret.txt" } },
      { version, type: "gui.ideActionRequest", requestId: "unknown-action", payload: { action: "runShellCommand" } },
    ];
    for (const message of messages) window.parent.postMessage(message, target);
  }, bridgeVersion);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
  if (after !== before) {
    failures.push("Wrapper forwarded a forbidden or malformed iframe-origin GUI-to-host message.");
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
const maxIdeActionRequestBytes = 8192;
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
let currentFrameNonce;
let frameNonceChallengeAttempts = 0;
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
const randomToken = () => {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") return undefined;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const wrapperReadyRequestId = (sequence) => {
  const token = randomToken();
  return token === undefined ? undefined : "gui-ready-" + frameGeneration + "-" + sequence + "-" + token;
};
const newFrameNonce = () => randomToken();
const sendFrameNonceChallenge = () => {
  if (frameReady || !frame || !currentFrameWindow || frame.contentWindow !== currentFrameWindow || !frameTargetOrigin || !isFrameNonce(currentFrameNonce)) return;
  currentFrameWindow.postMessage({ version: bridgeVersion, type: "host.frameNonce", payload: { frameNonce: currentFrameNonce } }, frameTargetOrigin);
  window.__yetAiCurrentFrameNonce = currentFrameNonce;
  frameNonceChallengeAttempts += 1;
  if (!frameReady && frameNonceChallengeAttempts < 20) {
    window.setTimeout(sendFrameNonceChallenge, 50);
  }
};
const showRandomnessDiagnostic = () => {
  showDiagnostic("Secure browser randomness is unavailable. Yet AI cannot authorize the embedded GUI bridge until the shell is reloaded in a secure context.");
};
const resetFrameNonceChallenge = () => {
  currentFrameNonce = newFrameNonce();
  frameNonceChallengeAttempts = 0;
  if (currentFrameNonce === undefined) {
    console.log("Yet AI cannot create frame nonce because secure wrapper randomness is unavailable");
    showRandomnessDiagnostic();
    return;
  }
  window.__yetAiLastFrameNonceForSmoke = currentFrameNonce;
  sendFrameNonceChallenge();
};
const invalidateFrameAuthority = (reason) => {
  frameReady = false;
  currentGuiReadySequence = 0;
  currentGuiReadyRequestId = undefined;
  window.__yetAiCurrentReadyRequestId = undefined;
  acceptedHostReadyRequestId = undefined;
  hostReadyAcceptedForCurrentFrame = false;
  currentFrameNonce = undefined;
  window.__yetAiCurrentFrameNonce = undefined;
  pendingHostMessages.length = 0;
};
const isGuiUnloadedMessage = (message) => isPlainObject(message) && hasOnlyKeys(message, ["version", "type", "payload"]) && message.version === bridgeVersion && message.type === "gui.unloaded" && (message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0));
const messageMatchesCurrentReady = (message) => frameReady && currentGuiReadySequence === guiReadySequence && message.requestId === currentReadyRequestId();
const canDeliverHostMessage = (message) => {
  if (message.type === "host.ideActionProgress" || message.type === "host.ideActionResult") return frameReady && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId();
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
const isRequestId = (value) => value === undefined || (typeof value === "string" && value.length >= 1 && value.length <= 128 && value.split("").every((char) => {
  const code = char.charCodeAt(0);
  return code >= 0x20 && (code < 0x7f || code > 0x9f);
}));
const isFrameNonce = (value) => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
const optionalString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length <= maxLength);
const optionalNonEmptyString = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength);
const allowedIdeActionNames = ["getContextSnapshot", "openWorkspaceFile", "revealWorkspaceRange"];
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
// This Node template literal emits browser JavaScript, so "\\\\" here becomes the browser-side single-backslash check used by the production wrapper.
const safePath = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.startsWith("/") && !value.startsWith("~") && !value.includes("\\\\") && !value.includes(":") && value.split("").every((char) => char >= " ") && value.split("/").every((part) => part !== "." && part !== ".."));
const isContextFile = (file) => file === undefined || (isPlainObject(file) && hasOnlyKeys(file, ["displayPath", "workspaceRelativePath", "languageId"]) && Object.keys(file).length > 0 && safePath(file.displayPath, 256) && safePath(file.workspaceRelativePath, 512) && (file.languageId === undefined || (typeof file.languageId === "string" && file.languageId.length > 0 && file.languageId.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(file.languageId))));
const isContextSelection = (selection) => selection === undefined || (isPlainObject(selection) && hasOnlyKeys(selection, ["startLine", "startCharacter", "endLine", "endCharacter", "text"]) && Object.keys(selection).length > 0 && optionalNumber(selection.startLine) && optionalNumber(selection.startCharacter) && optionalNumber(selection.endLine) && optionalNumber(selection.endCharacter) && optionalString(selection.text, 8000));
const isContextSnapshotPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["kind", "source", "file", "selection"]) && payload.kind === "active_editor" && (payload.source === "vscode" || payload.source === "jetbrains" || payload.source === "browser") && isContextFile(payload.file) && isContextSelection(payload.selection);
const isHostReadyPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["runtimeUrl", "sessionToken", "productId", "displayName", "cloudRequired"]) && requiredLoopbackRuntimeUrl(payload.runtimeUrl) && optionalString(payload.sessionToken, 4096) && optionalNonEmptyString(payload.productId, 256) && optionalNonEmptyString(payload.displayName, 256) && (payload.cloudRequired === undefined || payload.cloudRequired === false);
const isIdeActionPosition = (position) => isPlainObject(position) && hasOnlyKeys(position, ["line", "character"]) && Number.isInteger(position.line) && position.line >= 0 && position.line <= 1000000 && Number.isInteger(position.character) && position.character >= 0 && position.character <= 1000000;
const isIdeActionRange = (range) => isPlainObject(range) && hasOnlyKeys(range, ["start", "end"]) && isIdeActionPosition(range.start) && isIdeActionPosition(range.end) && (range.end.line > range.start.line || (range.end.line === range.start.line && range.end.character >= range.start.character));
const isHostIdeActionProgressPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["phase", "status", "summary", "cloudRequired", "action", "workspaceRelativePath"]) && ["queued", "checkingPolicy", "running", "completed"].includes(payload.phase) && ["pending", "inProgress", "succeeded", "rejected", "unavailable", "failed"].includes(payload.status) && typeof payload.summary === "string" && payload.summary.length > 0 && payload.summary.length <= 1000 && (payload.cloudRequired === undefined || payload.cloudRequired === false) && (payload.action === undefined || allowedIdeActionNames.includes(payload.action)) && safePath(payload.workspaceRelativePath, 512);
const isHostIdeActionResultContext = (context) => isPlainObject(context) && hasOnlyKeys(context, ["source", "hasActiveEditor", "workspaceFolderCount"]) && context.source === "jetbrains" && typeof context.hasActiveEditor === "boolean" && Number.isInteger(context.workspaceFolderCount) && context.workspaceFolderCount >= 0 && context.workspaceFolderCount <= 100;
const isHostIdeActionResultPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["status", "message", "cloudRequired", "action", "workspaceRelativePath", "range", "context"]) && ["succeeded", "rejected", "unavailable", "failed"].includes(payload.status) && typeof payload.message === "string" && payload.message.length > 0 && payload.message.length <= 1000 && (payload.cloudRequired === undefined || payload.cloudRequired === false) && (payload.action === undefined || allowedIdeActionNames.includes(payload.action)) && safePath(payload.workspaceRelativePath, 512) && (payload.range === undefined || isIdeActionRange(payload.range)) && (payload.context === undefined || isHostIdeActionResultContext(payload.context));
const isHostMessage = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || !isRequestId(message.requestId)) return false;
  if (message.type === "host.ready") return isHostReadyPayload(message.payload);
  if (message.type === "host.contextSnapshot") return isContextSnapshotPayload(message.payload);
  if (message.type === "host.openedFromCommand") return message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0);
  if (message.type === "host.ideActionProgress") return isHostIdeActionProgressPayload(message.payload);
  if (message.type === "host.ideActionResult") return isHostIdeActionResultPayload(message.payload);
  return false;
};
const requiredRequestId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
const safeRequiredWorkspacePath = (value) => safePath(value, 512) && !value.includes("%") && !value.includes("?") && !value.includes("#") && !value.includes("//") && !value.endsWith("/") && value.split("/").every((part) => part.length > 0 && !/(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)|^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(part));
const isGuiIdeActionPayload = (payload) => {
  if (!isPlainObject(payload) || typeof payload.action !== "string" || !allowedIdeActionNames.includes(payload.action)) return false;
  if (payload.action === "getContextSnapshot") return hasOnlyKeys(payload, ["action"]);
  if (payload.action === "openWorkspaceFile") return hasOnlyKeys(payload, ["action", "workspaceRelativePath"]) && safeRequiredWorkspacePath(payload.workspaceRelativePath);
  if (payload.action === "revealWorkspaceRange") return hasOnlyKeys(payload, ["action", "workspaceRelativePath", "range"]) && safeRequiredWorkspacePath(payload.workspaceRelativePath) && isIdeActionRange(payload.range);
  return false;
};
const isGuiIdeActionRequest = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.ideActionRequest" || !requiredRequestId(message.requestId)) return false;
  let serialized;
  try { serialized = JSON.stringify(message); } catch (_) { return false; }
  if (typeof serialized !== "string" || new Blob([serialized]).size > maxIdeActionRequestBytes) return false;
  return isGuiIdeActionPayload(message.payload);
};
const isGuiMessage = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.ready" || !isRequestId(message.requestId)) return false;
  return isPlainObject(message.payload) && hasOnlyKeys(message.payload, ["supportedBridgeVersion", "frameNonce"]) && (message.payload.supportedBridgeVersion === undefined || message.payload.supportedBridgeVersion === bridgeVersion) && isFrameNonce(currentFrameNonce) && isFrameNonce(message.payload.frameNonce) && message.payload.frameNonce === currentFrameNonce;
};
window.__yetAiSendHostMessageToFrame = sendToFrame;
window.__yetAiWrapperInitialized = true;
window.addEventListener("message", (event) => {
  if (event.source === currentFrameWindow && event.source === frame?.contentWindow && event.data?.__yetAiSmokeFrameNonceRequest === true && isFrameNonce(currentFrameNonce)) {
    sendFrameNonceChallenge();
    return;
  }
  if (event.source === currentFrameWindow && event.source === frame?.contentWindow) {
    if (frameTargetOrigin && frameTargetOrigin !== "*" && event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isGuiUnloadedMessage(event.data)) {
      invalidateFrameAuthority("gui.unloaded");
      window.postIntellijMessage(event.data);
    } else if (isGuiIdeActionRequest(event.data)) {
      if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
        console.log("Yet AI rejected IDE action request before GUI bridge readiness");
        return;
      }
      window.postIntellijMessage(event.data);
    } else if (isGuiMessage(event.data)) {
      if (frameReady && event.data.payload.frameNonce === currentFrameNonce) return;
      const nextGuiReadySequence = guiReadySequence + 1;
      const nextGuiReadyRequestId = wrapperReadyRequestId(nextGuiReadySequence);
      if (nextGuiReadyRequestId === undefined) {
        console.log("Yet AI rejected gui.ready because secure wrapper randomness is unavailable");
        showRandomnessDiagnostic();
        return;
      }
      frameReady = true;
      guiReadySequence = nextGuiReadySequence;
      currentGuiReadySequence = nextGuiReadySequence;
      window.__yetAiGuiReadySequence = guiReadySequence;
      currentGuiReadyRequestId = nextGuiReadyRequestId;
      const readyMessage = { ...event.data, requestId: currentGuiReadyRequestId, payload: { supportedBridgeVersion: event.data.payload?.supportedBridgeVersion } };
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
    invalidateFrameAuthority("frame.load");
    frameGeneration += 1;
    currentFrameWindow = frame.contentWindow;
    window.postIntellijMessage({ version: bridgeVersion, type: "gui.unloaded", payload: {} });
    markLoaded();
    resetFrameNonceChallenge();
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
    if ((request.method === "GET" || request.method === "POST") && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, demoModeDisabledResponse());
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
      let body;
      try {
        body = await readRequestBody(request);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          json(response, 413, { error: "Request body too large" });
          return;
        }
        json(response, 400, { error: "Invalid request body" });
        return;
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        json(response, 400, { error: "Invalid chat command JSON" });
        return;
      }
      chatCommandRequestCount += 1;
      chatCommandRequest = parsedBody;
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

function demoModeDisabledResponse() {
  return { enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality. Configure a BYOK provider for real answers." };
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
    let bytes = 0;
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > maxRuntimeRequestBodyBytes) {
        tooLarge = true;
        reject(new RequestBodyTooLargeError());
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (!tooLarge) resolve(body);
    });
    request.on("error", (error) => {
      if (!tooLarge) reject(error);
    });
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

async function startStaticServer(staticRoot, options = {}) {
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
      if (options.injectJetBrainsFrameBridge && path.basename(realRequestedPath) === "index.html") {
        const html = await readFile(realRequestedPath, "utf8");
        response.end(injectJetBrainsFrameBridge(html));
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

function injectJetBrainsFrameBridge(html) {
  const script = `<script>
(() => {
  let frameNonce;
  let pendingReady;
  const parentOrigin = () => {
    try { return document.referrer ? new URL(document.referrer).origin : "*"; } catch (_) { return "*"; }
  };
  const send = (message) => window.parent.postMessage(message, parentOrigin());
  const sendReady = (message) => send({ ...message, payload: { ...(message.payload || {}), frameNonce } });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.version === "${bridgeVersion}" && message.type === "host.frameNonce" && message.payload && typeof message.payload.frameNonce === "string") {
      frameNonce = message.payload.frameNonce;
      if (pendingReady) {
        sendReady(pendingReady);
        pendingReady = undefined;
      }
    }
  });
  window.postIntellijMessage = (message) => {
    if (message && message.type === "gui.ready") {
      if (!frameNonce) {
        const requestNonce = () => window.parent.postMessage({ __yetAiSmokeFrameNonceRequest: true }, parentOrigin());
        pendingReady = message;
        requestNonce();
        window.setTimeout(() => { if (pendingReady && !frameNonce) requestNonce(); }, 25);
        window.setTimeout(() => { if (pendingReady && !frameNonce) requestNonce(); }, 100);
        return;
      }
      sendReady(message);
      return;
    }
    send(message);
  };
})();
</script>`;
  return html.replace("<head>", `<head>${script}`);
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
