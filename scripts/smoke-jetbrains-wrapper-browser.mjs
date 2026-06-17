import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertPackagedGuiFreshness } from "./gui-asset-freshness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const packagedGuiRoot = path.join(root, "apps", "plugins", "jetbrains", "build", "generated", "resources", "yet-ai-gui", "yet-ai-gui");
const packagedGuiIndexPath = path.join(packagedGuiRoot, "index.html");
const evidenceRoot = path.join(root, "dist", "visual-smoke", "jetbrains-wrapper-browser");
const requiredVisibleText = ["Chat readiness", "Conversations", "Coding Actions"];
const bridgeVersion = "2026-05-15";
const pluginLikeViewport = { width: 800, height: 800 };
const headed = process.argv.includes("--headed");
const demoModeFirstMessage = process.argv.includes("--demo-mode-first-message");
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
const liveContextSelectionMarker = `live context marker ${randomUUID()}`;
const activeFileExcerptMarker = `jetbrains active excerpt ${randomUUID()}`;
const activeFileExcerptPath = "src/main/kotlin/ActiveExcerptSmoke.kt";
const activeFileExcerptPrompt = "Use the attached JetBrains active file excerpt.";
const activeFileExcerptRange = { start: { line: 4, character: 0 }, end: { line: 6, character: 1 } };
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
const liveJetbrainsContextSnapshot = {
  ...jetbrainsContextSnapshot,
  file: {
    displayPath: "src/main/kotlin/LiveContextSmoke.kt",
    workspaceRelativePath: "src/main/kotlin/LiveContextSmoke.kt",
    languageId: "kotlin",
  },
  selection: {
    startLine: 16,
    startCharacter: 2,
    endLine: 16,
    endCharacter: 34,
    text: liveContextSelectionMarker,
  },
};
const jetbrainsEditProposal = {
  requiresUserConfirmation: true,
  summary: "JetBrains confirmed edit smoke proposal.",
  cloudRequired: false,
  edits: [{
    workspaceRelativePath: "src/main/kotlin/ApplySmoke.kt",
    textReplacements: [{
      range: {
        start: { line: 0, character: 12 },
        end: { line: 0, character: 20 },
      },
      replacementText: "\"After\"",
    }],
  }],
};
const jetbrainsDeniedEditProposal = {
  ...jetbrainsEditProposal,
  summary: "JetBrains denied edit smoke proposal.",
};
const jetbrainsRejectedEditProposal = {
  ...jetbrainsEditProposal,
  summary: "JetBrains rejected edit smoke proposal.",
  edits: [{
    workspaceRelativePath: "src/main/kotlin/ApplySmoke.kt",
    textReplacements: [{
      ...jetbrainsEditProposal.edits[0].textReplacements[0],
      replacementText: "\"Rejected\"",
    }],
  }],
};
const jetbrainsUnsafeEditProposal = {
  ...jetbrainsEditProposal,
  summary: "Unsafe JetBrains edit smoke proposal.",
  edits: [{
    workspaceRelativePath: "../private/secret.kt",
    textReplacements: jetbrainsEditProposal.edits[0].textReplacements,
  }],
};

const consoleMessages = [];
const runtimeRequestLog = [];
let observedRuntimeAuthorization = false;
let chatCommandRequest;
let chatCommandRequestCount = 0;
let chatSubscriptionCount = 0;
let chatCommandRequestCountBeforeEditSmoke = 0;
let demoModeEnabled = false;
const chatSseSubscribers = new Map();
const pendingAssistantResponsesByChat = new Map();
let nextAssistantResponseContent;
const maxRuntimeRequestBodyBytes = 1024 * 1024;
const maxPendingHostMessages = 32;
const maxPendingDiagnostics = 16;

const scrollIntoViewIfNeeded = async (locator) => {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
};

const centerInNearestScrollContainer = async (locator) => {
  await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    let parent = element.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      const canScroll = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1;
      if (canScroll) {
        const parentRect = parent.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        parent.scrollTop += elementRect.top - parentRect.top - Math.max(0, (parent.clientHeight - elementRect.height) / 2);
        return;
      }
      parent = parent.parentElement;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
  }).catch(() => undefined);
};

class RequestBodyTooLargeError extends Error {}

await requireFreshPackagedGui();

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error("JetBrains wrapper browser smoke failed: Playwright is not installed or cannot be loaded.");
  console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
  console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const guiServer = await startStaticServer(packagedGuiRoot);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeServer = await startMockRuntimeServer();
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
const wrapperServer = await startWrapperServer(guiBaseUrl, runtimeBaseUrl);
const wrapperBaseUrl = `http://127.0.0.1:${wrapperServer.port}`;
let browser;

try {
  try {
    browser = await chromium.launch({ headless: !headed });
  } catch (error) {
    console.error("JetBrains wrapper browser smoke failed: Playwright Chromium is not installed or cannot be launched.");
    console.error("Run `npm install` from the repository root if needed, then run `npx playwright install chromium`.");
    console.error(`Launch error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const page = await browser.newPage({ viewport: pluginLikeViewport });
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
    { label: "live active context selection marker", value: liveContextSelectionMarker },
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
  const hiddenHeroTitle = await frameLocator.locator(".hero h1").first().evaluate((element) => {
    const hero = element.closest(".hero");
    return getComputedStyle(element).display === "none"
      || getComputedStyle(element).visibility === "hidden"
      || (hero !== null && (getComputedStyle(hero).display === "none" || getComputedStyle(hero).visibility === "hidden"));
  }).catch(() => false);
  if (!hiddenHeroTitle) failures.push("Hosted JetBrains iframe did not hide the in-webview hero title.");

  const initialBodyText = await frameLocator.locator("body").evaluate((body) => body.textContent ?? "").catch(() => "");
  for (const text of requiredVisibleText) {
    if (!initialBodyText.includes(text)) {
      failures.push(`Missing iframe GUI text: ${text}`);
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
    failures.push("Wrapper bridge collector did not collect gui.ready from the iframe.");
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
  await assertPendingQueuesAreBounded(page);
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
  const bridgeIdentityAttached = await frameLocator.getByText("bridge jetbrains", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 }).then(() => true).catch(() => false);
  if (!bridgeIdentityAttached) {
    failures.push("GUI did not expose JetBrains host identity / bridge mode after wrapper bootstrap.");
  }
  await assertSingleBackslashContextPathRejected(page, bridgeVersion, activeReadyRequestId);
  await assertSecretLikeContextPathRejected(page, bridgeVersion, activeReadyRequestId);
  await page.evaluate(({ version }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.openedFromCommand",
      payload: {},
    });
  }, { version: bridgeVersion });
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

  const bridgeMessageCountBeforeSecretRequestIds = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
  await frameLocator.locator("body").evaluate((body, version) => {
    for (const requestId of ["provider_key", "openai_api_key"]) {
      window.parent.postMessage({
        version,
        type: "gui.ideActionRequest",
        requestId,
        payload: { action: "getContextSnapshot" },
      }, document.referrer ? new URL(document.referrer).origin : "*");
    }
  }, bridgeVersion);
  await page.waitForTimeout(100);
  const bridgeMessageCountAfterSecretRequestIds = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
  if (bridgeMessageCountAfterSecretRequestIds !== bridgeMessageCountBeforeSecretRequestIds) {
    failures.push("Wrapper forwarded IDE action request ids containing provider_key/openai_api_key secret markers.");
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

  await frameLocator.getByText("Runtime connected", { exact: false }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("Runtime refresh did not reach connected/provider-required state after trusted host.ready."));
  await frameLocator.getByText("Provider setup", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("Provider setup panel was not mounted in the JetBrains first-use GUI path."));

  if (demoModeFirstMessage) {
    await runDemoModeFirstMessageScenario(page, frameLocator);
    console.log("JetBrains wrapper Demo Mode first-message smoke passed.");
    console.log("Checked packaged JetBrains wrapper bridge mode, no-key provider-required state, runtime-owned Demo Mode enablement, first-message post/SSE render exactly once, token secrecy, and loopback-only browser requests.");
  } else {

  const compactSetup = frameLocator.locator("[data-testid='compact-host-setup']");
  const compactRefreshButton = compactSetup.getByRole("button", { name: /Refresh runtime|Checking runtime…/ }).first();
  let openedCompactSetupForRefresh = false;
  if (await compactSetup.isVisible().catch(() => false) && !await compactRefreshButton.isVisible().catch(() => false)) {
    await compactSetup.locator("summary").click();
    openedCompactSetupForRefresh = true;
  }
  const runtimeRefreshButton = frameLocator.locator("section", { has: frameLocator.getByRole("heading", { name: "Local runtime connection" }) }).getByRole("button", { name: /Refresh runtime|Checking runtime…/ }).first();
  const refreshButton = await compactRefreshButton.isVisible().catch(() => false) ? compactRefreshButton : runtimeRefreshButton;
  if (await refreshButton.isVisible().catch(() => false)) {
    const runtimeRefreshMessageCountBeforeClick = await page.evaluate(() => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.runtimeRefresh").length);
    if (refreshButton === runtimeRefreshButton) {
      await openDetailsBySummary(frameLocator, "Local runtime connection", refreshButton);
    }
    await refreshButton.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
    await refreshButton.click();
    await page.waitForTimeout(100);
    const runtimeRefreshMessageCountAfterFirstClick = await page.evaluate(() => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.runtimeRefresh").length);
    const runtimeRefreshMessagesPostedByFirstClick = runtimeRefreshMessageCountAfterFirstClick - runtimeRefreshMessageCountBeforeClick;
    if (runtimeRefreshMessagesPostedByFirstClick !== 1) {
      failures.push(`Refresh runtime click posted ${runtimeRefreshMessagesPostedByFirstClick} gui.runtimeRefresh bridge messages instead of exactly one.`);
    }
    if (!await refreshButton.isDisabled().catch(() => true)) {
      await refreshButton.click();
    }
    if (openedCompactSetupForRefresh) {
      await compactSetup.locator("summary").click();
    }
    await page.waitForTimeout(500);
    const refreshFeedbackVisible = await frameLocator.getByText(/Runtime (connected|check failed)|Checking runtime…/).first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!refreshFeedbackVisible) {
      failures.push("Refresh runtime click did not produce visible iframe feedback.");
    }
    const refreshAttemptVisible = await frameLocator.getByText(/Attempt \d+ at/).first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!refreshAttemptVisible) {
      failures.push("Refresh runtime feedback did not include a visible attempt/timestamp marker.");
    }
  } else {
    const compactSetupRefreshVisible = await frameLocator.locator("[data-testid='compact-host-setup']").locator("button").filter({ hasText: /Refresh runtime|Checking runtime…/ }).first().isVisible().catch(() => false);
    const runtimeDetailsVisible = await frameLocator.locator("[data-testid='runtime-connection-details']").isVisible().catch(() => false);
    if (runtimeDetailsVisible && !compactSetupRefreshVisible) {
      failures.push("Runtime connection details are visible while Refresh runtime is hidden in compact hosted layout.");
    }
  }

  const targetOrigin = await page.evaluate(() => window.__yetAiFrameTargetOrigin);
  if (targetOrigin !== guiBaseUrl) {
    failures.push(`Wrapper iframe target origin mismatch: expected ${guiBaseUrl}, got ${String(targetOrigin)}.`);
  }

  if (!observedRuntimeAuthorization) {
    failures.push("Mock runtime did not observe the wrapper-supplied runtime session token.");
  }

  await frameLocator.getByText("Ready to send.", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not show compact ready-to-send status for the experimental account path."));
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
  await frameLocator.getByText("File: src/main/kotlin/ContextSmoke.kt", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("GUI did not show safe JetBrains context file label."));
  await frameLocator.getByText("Language: kotlin", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context language id."));
  await frameLocator.getByText(activeContextSelectionMarker, { exact: false }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("GUI did not show JetBrains context selected text preview."));
  await page.evaluate(({ version, runtimeUrl, token, payload, requestId }) => {
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
      type: "host.contextSnapshot",
      requestId,
      payload,
    });
  }, { version: bridgeVersion, payload: liveJetbrainsContextSnapshot, requestId: contextRequestId });
  await frameLocator.getByText("File: src/main/kotlin/LiveContextSmoke.kt", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("GUI did not replace JetBrains context file label on live refresh."));
  await frameLocator.getByText("Selection range: 16:2-16:34", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("GUI did not replace JetBrains context selection range on live refresh."));
  await frameLocator.getByText(liveContextSelectionMarker, { exact: false }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("GUI did not show live JetBrains context selected text preview."));
  if (await frameLocator.getByText(activeContextSelectionMarker, { exact: false }).first().isVisible().catch(() => false)) {
    failures.push("GUI kept stale JetBrains selected text after live context refresh.");
  }
  await page.evaluate(({ version, payload, requestId }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.contextSnapshot",
      requestId,
      payload,
    });
  }, { version: bridgeVersion, payload: jetbrainsContextSnapshot, requestId: contextRequestId });
  await frameLocator.getByText(activeContextSelectionMarker, { exact: false }).first().waitFor({ state: "attached", timeout: 5000 }).catch(() => failures.push("GUI did not restore JetBrains context after live refresh smoke."));
  await assertJetBrainsIdeActionRoundtrip(page, frameLocator);
  await frameLocator.locator("details.attached-context-card").evaluate((details) => { details.open = true; }).catch(() => failures.push("JetBrains attached context details could not be opened for include toggle."));
  const includeContextToggle = frameLocator.locator("label.attached-context-toggle", { hasText: /Attach to next message|Do not attach/ }).getByRole("checkbox");
  if (!await includeContextToggle.isChecked({ timeout: 5000 }).catch(() => false)) {
    failures.push("JetBrains attached context include toggle was not enabled by default.");
  }
  await scrollIntoViewIfNeeded(includeContextToggle);
  await includeContextToggle.uncheck();
  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill("Send without JetBrains context.");
  await clickSendButtonWithActionability(frameLocator, "first disabled-context send");
  await frameLocator.getByText("JetBrains login smoke", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("GUI did not render the assistant response from mock SSE."));
  await assertAssistantAnswerCount(frameLocator, "JetBrains login smoke", 1, "first JetBrains mock SSE assistant response");
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
  await assertJetBrainsActiveFileExcerptRoundtrip(page, frameLocator);
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
    failures.push("JetBrains attached context include toggle was not re-enabled after active-file excerpt smoke.");
  }
  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill("Say hello through JetBrains login-shaped smoke.");
  await clickSendButtonWithActionability(frameLocator, "second enabled-context send");
  await waitForAssistantAnswerCount(frameLocator, "JetBrains login smoke", 3, "JetBrains mock SSE assistant response after three canned sends");
  await assertAssistantAnswerCount(frameLocator, "JetBrains login smoke", 3, "JetBrains mock SSE assistant response after three canned sends");
  chatCommandRequestCountBeforeEditSmoke = chatCommandRequestCount;
  if (chatCommandRequestCount !== 4) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests instead of exactly four.`);
  }
  if (chatSubscriptionCount < 1 || chatSubscriptionCount > 2) {
    failures.push(`Mock runtime received ${chatSubscriptionCount} chat subscriptions instead of one or two expected local subscriptions.`);
  }
  if (chatCommandRequest?.payload?.content !== "Say hello through JetBrains login-shaped smoke.") {
    failures.push("Mock runtime did not receive the expected GUI chat message content.");
  }
  assertJetBrainsContext(chatCommandRequest?.payload?.context);

  await assertJetBrainsConfirmedEditLifecycle(page, frameLocator);

  const finalLayoutMetrics = await collectJetBrainsIframeLayoutMetrics(frameLocator);
  assertJetBrainsHostedLayout(finalLayoutMetrics, "post-chat JetBrains wrapper iframe");
  const evidence = await saveJetBrainsWrapperEvidence(page, finalLayoutMetrics);
  await page.evaluate(() => {
    window.__yetAiHostMessagesPosted = window.__yetAiHostMessagesPosted?.filter((message) => message?.type !== "host.contextSnapshot") ?? [];
    window.__yetAiBridgeMessages = window.__yetAiBridgeMessages?.filter((message) => message?.type !== "host.ready") ?? [];
    window.__yetAiPendingHostMessages = [];
  });
  await page.evaluate(() => {
    window.__yetAiHostMessagesPosted = window.__yetAiHostMessagesPosted?.filter((message) => message?.payload?.contextAttachment === undefined) ?? [];
  });
  console.log(`JetBrains wrapper smoke viewport: ${finalLayoutMetrics.viewport.width}x${finalLayoutMetrics.viewport.height}.`);
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
    { label: "live active context selection marker", value: liveContextSelectionMarker },
    { label: "authorization header marker", value: "authorization: bearer" },
    { label: "active file excerpt marker", value: activeFileExcerptMarker },
    { label: "set-cookie marker", value: "set-cookie" },
    { label: "client secret marker", value: "client_secret" },
  ]);

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("JetBrains wrapper browser smoke passed.");
  console.log("Checked JetBrains-like wrapper iframe rendering, exact loopback target origin, real gui.ready to host.ready/contextSnapshot wrapper bridge delivery, attached-context preview/default include/disabled-toggle behavior, Refresh runtime click feedback, bridge collector, login-shaped first-message chat through mock runtime/SSE, JavaScript execution, and local JS/CSS asset responses.");
  console.log(`Saved sanitized layout screenshot/metrics/DOM under ${path.relative(root, evidenceRoot)}/ (${path.basename(evidence.screenshotPath)}, ${path.basename(evidence.metricsPath)}, ${path.basename(evidence.domPath)}).`);
  console.log("No engine, provider credentials, OpenAI/ChatGPT, hosted Yet AI services, JetBrains IDE, or JCEF automation were used.");
  }
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

async function waitForAssistantAnswerCount(frameLocator, text, expected, description) {
  await frameLocator.locator(".chat-bubble.assistant", { hasText: text }).nth(expected - 1).waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push(`Expected ${description} to appear at least ${expected} time(s) in assistant bubbles before assertion: ${text}`));
}

async function assertAssistantAnswerCount(frameLocator, text, expected, description) {
  const count = await frameLocator.locator(".chat-bubble.assistant").evaluateAll(
    (elements, answer) => elements.filter((element) => element.textContent?.includes(String(answer))).length,
    text,
  );
  if (count !== expected) {
    failures.push(`Expected ${description} to appear exactly ${expected} time(s) in assistant bubbles, observed ${count}: ${text}`);
  }
}

async function clickSendButtonWithActionability(frameLocator, label) {
  const send = frameLocator.getByRole("button", { name: "Send", exact: true });
  await clickControlWithActionability(send, label);
}

async function clickControlWithActionability(locator, label, { assertHitTest = false } = {}) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  await centerInNearestScrollContainer(locator);
  if (assertHitTest) {
    await assertElementReceivesPointerAtCenter(locator, label);
  }
  await locator.click({ trial: true });
  await locator.click();
}

async function runDemoModeFirstMessageScenario(page, frameLocator) {
  const body = frameLocator.locator("body");
  await frameLocator.getByText("bridge jetbrains", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 })
    .catch(() => failures.push("Demo Mode first-message smoke did not observe active JetBrains bridge mode."));
  await frameLocator.getByText("Provider required for first message", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 })
    .catch(() => failures.push("Demo Mode first-message smoke did not show provider-required/no-key first-message state."));
  await frameLocator.getByText("Provider or Demo Mode needed", { exact: true }).first().waitFor({ state: "attached", timeout: 5000 })
    .catch(() => failures.push("Demo Mode first-message smoke did not show no-key provider-or-demo readiness."));
  const compactSetup = frameLocator.locator("[data-testid='compact-host-setup']");
  if (await compactSetup.isVisible().catch(() => false)) {
    await compactSetup.locator("summary").click().catch(() => undefined);
  }
  const tryDemoModeButton = frameLocator.getByRole("button", { name: "Try Demo Mode", exact: true }).first();
  await tryDemoModeButton.waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Demo Mode first-message smoke did not show Try Demo Mode."));
  if (failures.length > 0) {
    reportFailures();
  }
  if (chatCommandRequestCount !== 0) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests before Demo Mode first send.`);
  }

  const initialDemoModePostCount = countRuntimeRequests("POST", "/v1/demo-mode");
  const initialChatCommandPostCount = countChatCommandPosts();
  await clickControlWithActionability(tryDemoModeButton, "Try Demo Mode", { assertHitTest: true });
  await frameLocator.getByText("Demo Mode is active in the local runtime", { exact: false }).first().waitFor({ state: "attached", timeout: 5000 })
    .catch(() => failures.push("GUI did not render Demo Mode active no-provider-call copy after enabling."));
  await frameLocator.getByText("no provider calls", { exact: false }).first().waitFor({ state: "attached", timeout: 5000 })
    .catch(() => failures.push("GUI did not render no provider calls Demo Mode copy."));
  await frameLocator.getByText("Demo Mode ready — local canned responses, no provider calls. Ready to send.", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("GUI did not show Demo Mode ready first-message lifecycle."));

  const send = frameLocator.getByRole("button", { name: "Send", exact: true });
  if (await send.isDisabled().catch(() => true)) {
    failures.push("Send was not enabled after runtime-owned Demo Mode enablement.");
  }
  if (chatCommandRequestCount !== 0) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} chat command requests before Demo Mode Send click.`);
  }
  const demoModePostsAfterEnable = runtimeRequestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/v1/demo-mode").slice(initialDemoModePostCount);
  if (demoModePostsAfterEnable.length !== 1) {
    failures.push(`Demo Mode first-message smoke expected exactly one POST /v1/demo-mode after clicking Try Demo Mode; observed ${demoModePostsAfterEnable.length}: ${formatRuntimeRequestLog(demoModePostsAfterEnable)}.`);
  } else if (!deepEqual(demoModePostsAfterEnable[0].body, { enabled: true })) {
    failures.push(`Demo Mode first-message smoke POST /v1/demo-mode body was not exactly {"enabled":true}: ${JSON.stringify(demoModePostsAfterEnable[0].body)}.`);
  }

  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill("Try Demo Mode from JetBrains wrapper.");
  await clickSendButtonWithActionability(frameLocator, "Demo Mode first-message send");
  await frameLocator.getByText("JetBrains Demo Mode smoke", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("GUI did not render canned Demo Mode assistant response from mock runtime."));
  await assertAssistantAnswerCount(frameLocator, "JetBrains Demo Mode smoke", 1, "Demo Mode canned assistant response");
  if (chatCommandRequestCount !== 1) {
    failures.push(`Mock runtime received ${chatCommandRequestCount} Demo Mode chat command requests instead of exactly one.`);
  }
  if (chatCommandRequest?.payload?.content !== "Try Demo Mode from JetBrains wrapper.") {
    failures.push("Mock runtime did not receive the expected Demo Mode first-message content.");
  }
  const chatCommandPosts = runtimeRequestLog.filter((entry) => entry.method === "POST" && /^\/v1\/chats\/[^/]+\/commands$/.test(entry.pathname)).slice(initialChatCommandPostCount);
  if (chatCommandPosts.length !== 1) {
    failures.push(`Demo Mode first-message smoke expected exactly one chat command POST; observed ${chatCommandPosts.length}: ${formatRuntimeRequestLog(chatCommandPosts)}.`);
  }
  assertNoForbiddenRuntimeMutationRequests();
  if (!observedRuntimeAuthorization) {
    failures.push("Mock runtime did not observe the wrapper-supplied runtime token as Authorization.");
  }
  assertAllRuntimeApiRequestsAuthorized();

  const finalLayoutMetrics = await collectJetBrainsIframeLayoutMetrics(frameLocator);
  await saveJetBrainsWrapperEvidence(page, finalLayoutMetrics);
  const bodyText = await body.innerText().catch(() => "");
  if ((bodyText.match(/JetBrains Demo Mode smoke/g) ?? []).length !== 1) {
    failures.push("Canned Demo Mode assistant response did not render exactly once in iframe body text.");
  }
  const browserVisibleState = await collectBrowserVisibleState(page);
  assertNoSecretLeak(browserVisibleState, [
    { label: "runtime token", value: runtimeToken },
    { label: "authorization header marker", value: "authorization: bearer" },
    { label: "set-cookie marker", value: "set-cookie" },
    { label: "client secret marker", value: "client_secret" },
  ]);
  if (failures.length > 0) {
    reportFailures();
  }
}

async function assertElementReceivesPointerAtCenter(locator, label) {
  const hitTest = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, reason: "not an HTMLElement" };
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      ok: top === element || element.contains(top),
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
      point: { x, y },
      topTag: top?.tagName,
      topText: top?.textContent?.trim().slice(0, 80),
      topClass: top instanceof HTMLElement ? top.className : undefined,
    };
  }).catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
  if (!hitTest.ok) {
    failures.push(`${label}: elementFromPoint did not hit the intended control (${JSON.stringify(hitTest)}).`);
  }
}

async function assertInvalidRuntimeUrlsRejected(page, version, currentReadyRequestId) {
  const invalidRuntimeUrls = [
    undefined,
    "",
    "https://example.com/",
    "http://user@127.0.0.1/",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
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
    failures.push("Wrapper relayed host.ready with a non-loopback, missing/invalid port, credentialed, queried, fragmented, or non-root runtime URL.");
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
  const previousFrameNonce = await page.evaluate(() => window.__yetAiLastFrameNonceForSmoke ?? window.__yetAiCurrentFrameNonce);
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame) => {
    frame.src = "about:blank";
  });
  await page.waitForFunction(() => document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow?.location.href === "about:blank", undefined, { timeout: 5000 })
    .catch(() => failures.push("Wrapper did not navigate iframe to about:blank during old-document regression reload."));
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame, { url, cacheBust }) => {
    frame.src = `${url}/index.html?old-document-regression=${cacheBust}`;
  }, { url: guiUrl, cacheBust: randomUUID() });
  const freshReadyState = await forceFreshGuiReadyAfterReload(page, {
    version,
    origin: guiUrl,
    sequenceBeforeReload: beforeReadySequence,
    previousFrameNonce,
  });
  if ((freshReadyState.readySequence ?? 0) <= beforeReadySequence) {
    failures.push("Wrapper did not observe fresh gui.ready after old-document regression reload.");
  }
  const currentRequestId = freshReadyState.currentRequestId;
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
  const previousFrameNonce = await page.evaluate(() => window.__yetAiLastFrameNonceForSmoke ?? window.__yetAiCurrentFrameNonce);
  await page.locator("iframe[title='Yet AI GUI']").evaluate((frame, url) => {
    frame.src = `${url}/index.html`;
  }, guiUrl);
  const afterExplicitReloadReady = await forceFreshGuiReadyAfterReload(page, {
    version,
    origin: guiUrl,
    sequenceBeforeReload: afterStaleState.guiReadySequence,
    requestId: "same",
    previousFrameNonce,
  });
  if ((afterExplicitReloadReady.readySequence ?? 0) <= afterStaleState.guiReadySequence) {
    failures.push("Wrapper did not observe fresh gui.ready after repeated requestId reload.");
  }
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

async function collectJetBrainsIframeLayoutMetrics(frameLocator) {
  return frameLocator.locator("body").evaluate(() => {
    const rectFor = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
    };
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
    };
    const textVisible = (text) => Array.from(document.querySelectorAll("body *")).some((element) => element instanceof HTMLElement && element.childElementCount === 0 && element.textContent?.includes(text) && visible(element));
    const send = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Send");
    const scroll = document.querySelector(".chat-scroll-region");
    const composer = document.querySelector(".chat-composer");
    const composerTools = document.querySelector(".composer-tools");
    const inputArea = document.querySelector(".composer-input-area");
    const main = document.querySelector("main.app-shell");
    const conversationsRail = document.querySelector(".conversations-rail");
    const compactSetup = document.querySelector("[data-testid='compact-host-setup']");
    const runtimeDetails = document.querySelector("[data-testid='runtime-connection-details']");
    const providerDetails = document.querySelector("[data-testid='provider-setup-details']");
    const runtimeCard = document.querySelector(".runtime-card");
    const providerCard = document.querySelector(".provider-setup-card");
    const advancedDebugCard = document.querySelector(".debug-card");
    const setupControlMatchers = [/Refresh runtime/i, /Provider setup/i, /API key/i, /OpenAI account/i, /Demo Mode/i, /Use OpenAI API key fallback/i];
    const accessibleSetupControls = Array.from(document.querySelectorAll("summary, button, label, input, select, [role='button']"))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => (element.textContent || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").trim())
      .filter((text) => setupControlMatchers.some((matcher) => matcher.test(text)));
    const sendRect = rectFor(send);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const documentElement = document.documentElement;
    const scrollTopBefore = window.scrollY;
    window.scrollTo(0, documentElement.scrollHeight);
    const scrollTopAfter = window.scrollY;
    const chatScrollTopBefore = scroll instanceof HTMLElement ? scroll.scrollTop : 0;
    if (scroll instanceof HTMLElement) scroll.scrollTo(0, scroll.scrollHeight);
    const chatScrollTopAfter = scroll instanceof HTMLElement ? scroll.scrollTop : 0;
    const composerToolsTopBefore = composerTools instanceof HTMLElement ? composerTools.scrollTop : 0;
    if (composerTools instanceof HTMLElement) composerTools.scrollTo(0, composerTools.scrollHeight);
    const composerToolsTopAfter = composerTools instanceof HTMLElement ? composerTools.scrollTop : 0;
    const sendRectAfterInnerScroll = rectFor(send);
    const composerRectAfterInnerScroll = rectFor(composer);
    const chatScrollRectAfterInnerScroll = rectFor(scroll);
    const inputAreaRectAfterInnerScroll = rectFor(inputArea);
    const composerToolsRectAfterInnerScroll = rectFor(composerTools);
    const hitCenter = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return {
        ok: top === element || element.contains(top),
        tag: top?.tagName,
        text: top?.textContent?.trim().slice(0, 80),
        className: top instanceof HTMLElement ? top.className : undefined,
      };
    };
    return {
      viewport,
      documentScrollHeight: documentElement.scrollHeight,
      documentClientHeight: documentElement.clientHeight,
      outerScrollMoves: scrollTopAfter > scrollTopBefore,
      outerOverflow: documentElement.scrollHeight > documentElement.clientHeight + 1,
      hasUsablePanelScrollOwner: (scrollTopAfter > scrollTopBefore) || (chatScrollTopAfter > chatScrollTopBefore),
      chatScrollMoves: chatScrollTopAfter > chatScrollTopBefore,
      composerToolsScrollMoves: composerToolsTopAfter > composerToolsTopBefore,
      composerToolsOverflow: composerTools instanceof HTMLElement && composerTools.scrollHeight > composerTools.clientHeight + 1,
      hostJetbrainsClass: main instanceof HTMLElement && main.classList.contains("host-jetbrains"),
      hostBrowserClass: main instanceof HTMLElement && main.classList.contains("host-browser"),
      advancedChatControlsVisible: textVisible("Advanced chat controls"),
      sseDebugDetailsVisible: textVisible("SSE debug details"),
      bridgeDebugVisible: textVisible("Bridge debug"),
      conversationsRailVisible: visible(conversationsRail),
      chatReadinessCardVisible: visible(document.querySelector(".chat-primary-card > .readiness-card")),
      firstMessageWizardVisible: textVisible("Provider required for first message") || textVisible("Ready for first message"),
      compactSetupVisible: visible(compactSetup),
      runtimeDetailsAttached: runtimeDetails instanceof HTMLElement,
      providerDetailsAttached: providerDetails instanceof HTMLElement,
      runtimeCardVisible: visible(runtimeCard),
      providerCardVisible: visible(providerCard),
      advancedDebugCardVisible: visible(advancedDebugCard),
      accessibleSetupControls,
      setupControlCount: accessibleSetupControls.length,
      sendVisible: send instanceof HTMLElement && visible(send),
      sendEnabled: send instanceof HTMLButtonElement && !send.disabled,
      sendWithinViewport: Boolean(sendRect && sendRect.top >= 0 && sendRect.left >= 0 && sendRect.bottom <= viewport.height && sendRect.right <= viewport.width),
      sendReachableAfterInnerScroll: Boolean(sendRectAfterInnerScroll && sendRectAfterInnerScroll.top >= 0 && sendRectAfterInnerScroll.left >= 0 && sendRectAfterInnerScroll.bottom <= viewport.height && sendRectAfterInnerScroll.right <= viewport.width),
      sendHitTestAfterInnerScroll: hitCenter(send),
      sendRect,
      sendRectAfterInnerScroll,
      chatScrollHeight: rectFor(scroll)?.height ?? 0,
      composerHeight: rectFor(composer)?.height ?? 0,
      composerToolsHeight: rectFor(composerTools)?.height ?? 0,
      composerRect: rectFor(composer),
      composerRectAfterInnerScroll,
      chatScrollRectAfterInnerScroll,
      inputAreaRectAfterInnerScroll,
      composerToolsRectAfterInnerScroll,
      chatScrollComposerOverlapAfterInnerScroll: Boolean(chatScrollRectAfterInnerScroll && composerRectAfterInnerScroll && chatScrollRectAfterInnerScroll.bottom > composerRectAfterInnerScroll.top + 1 && chatScrollRectAfterInnerScroll.top < composerRectAfterInnerScroll.bottom - 1),
      composerToolsInputOverlapAfterInnerScroll: Boolean(composerToolsRectAfterInnerScroll && inputAreaRectAfterInnerScroll && composerToolsRectAfterInnerScroll.bottom > inputAreaRectAfterInnerScroll.top + 1 && composerToolsRectAfterInnerScroll.top < inputAreaRectAfterInnerScroll.bottom - 1),
      bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
    };
  });
}

function assertJetBrainsHostedLayout(metrics, label) {
  if (!metrics.hostJetbrainsClass) failures.push(`${label}: missing main.app-shell.host-jetbrains inside iframe.`);
  if (metrics.hostBrowserClass) failures.push(`${label}: iframe shell still has host-browser class.`);
  if (metrics.advancedChatControlsVisible) failures.push(`${label}: Advanced chat controls are visible in hosted layout.`);
  if (metrics.sseDebugDetailsVisible) failures.push(`${label}: SSE debug details are visible in hosted layout.`);
  if (metrics.bridgeDebugVisible || metrics.advancedDebugCardVisible) failures.push(`${label}: advanced bridge/debug internals are visible in hosted layout.`);
  if (metrics.conversationsRailVisible) failures.push(`${label}: left conversations rail is visible in compact hosted layout.`);
  if (metrics.chatReadinessCardVisible) failures.push(`${label}: full chat readiness card is visible in compact hosted layout.`);
  if (metrics.firstMessageWizardVisible) failures.push(`${label}: verbose first-message wizard is visible in compact hosted layout.`);
  if (!metrics.compactSetupVisible) failures.push(`${label}: compact Setup strip is not visible in hosted layout.`);
  if (!metrics.runtimeDetailsAttached || !metrics.runtimeCardVisible) failures.push(`${label}: runtime refresh/status setup card is not mounted and visible below compact chat.`);
  if (!metrics.providerDetailsAttached || !metrics.providerCardVisible) failures.push(`${label}: provider/API-key/OpenAI account setup card is not mounted and visible below compact chat.`);
  if (metrics.setupControlCount < 1) failures.push(`${label}: no visible/accesssible compact setup control for provider/API key/OpenAI account/Demo Mode/runtime was found.`);
  if (!metrics.sendVisible || !metrics.sendEnabled || !metrics.sendReachableAfterInnerScroll) failures.push(`${label}: Send is not visible/enabled/reachable after inner panel scroll (${JSON.stringify(metrics.sendRectAfterInnerScroll)} in ${JSON.stringify(metrics.viewport)}).`);
  if (!metrics.sendHitTestAfterInnerScroll?.ok) failures.push(`${label}: Send center is covered or not hit-testable after inner scroll (${JSON.stringify(metrics.sendHitTestAfterInnerScroll)}).`);
  if (metrics.outerOverflow && !metrics.hasUsablePanelScrollOwner) failures.push(`${label}: hosted iframe overflows without a usable panel scroll owner (document ${metrics.documentScrollHeight} > ${metrics.documentClientHeight}, outer moved: ${metrics.outerScrollMoves}, chat moved: ${metrics.chatScrollMoves}).`);
  if (metrics.chatScrollHeight < 280) failures.push(`${label}: chat message region is too small for compact hosted chat (${metrics.chatScrollHeight}).`);
  if (metrics.composerHeight > 230) failures.push(`${label}: composer is too tall for compact hosted chat (${metrics.composerHeight}).`);
  if (metrics.composerToolsHeight > 100) failures.push(`${label}: composer tools area is too tall for compact hosted chat (${metrics.composerToolsHeight}).`);
  if (metrics.composerToolsOverflow && !metrics.composerToolsScrollMoves) failures.push(`${label}: composer status/context cards overflow but their tool region did not scroll.`);
  if (metrics.chatScrollComposerOverlapAfterInnerScroll) failures.push(`${label}: chat scroll region overlaps the composer after inner scrolling (${JSON.stringify(metrics.chatScrollRectAfterInnerScroll)} vs ${JSON.stringify(metrics.composerRectAfterInnerScroll)}).`);
  if (metrics.composerToolsInputOverlapAfterInnerScroll) failures.push(`${label}: composer status/context cards overlap the input controls after inner scrolling (${JSON.stringify(metrics.composerToolsRectAfterInnerScroll)} vs ${JSON.stringify(metrics.inputAreaRectAfterInnerScroll)}).`);
}

async function saveJetBrainsWrapperEvidence(page, metrics) {
  await mkdir(evidenceRoot, { recursive: true });
  const screenshotPath = path.join(evidenceRoot, "jetbrains-wrapper-layout.png");
  const metricsPath = path.join(evidenceRoot, "jetbrains-wrapper-layout.metrics.json");
  const domPath = path.join(evidenceRoot, "jetbrains-wrapper-layout.dom.txt");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(metricsPath, `${JSON.stringify(sanitizeEvidenceObject(metrics), null, 2)}\n`, "utf8");
  const dom = await page.frameLocator("iframe[title='Yet AI GUI']").locator("body").evaluate(() => document.body.innerText).then(sanitizeEvidenceText);
  await writeFile(domPath, dom, "utf8");
  return { screenshotPath, metricsPath, domPath };
}

function sanitizeEvidenceObject(value) {
  return JSON.parse(sanitizeEvidenceText(JSON.stringify(value)));
}

async function forceFreshGuiReadyAfterReload(page, { version, origin, sequenceBeforeReload, requestId, previousFrameNonce }) {
  return page.evaluate(({ bridgeVersion, messageOrigin, sequenceBeforeReload, requestId, previousFrameNonce }) => new Promise((resolve) => {
    const readyIdPattern = /^gui-ready-\d+-\d+-[0-9a-f]{32}$/;
    const frameNoncePattern = /^[0-9a-f]{32}$/;
    const deadline = Date.now() + 10000;
    const sendFreshReady = () => {
      const frameWindow = document.querySelector("iframe[title='Yet AI GUI']")?.contentWindow;
      const frameNonce = window.__yetAiCurrentFrameNonce;
      const hasFreshFrameNonce = typeof frameNonce === "string" && frameNoncePattern.test(frameNonce) && frameNonce === window.__yetAiLastFrameNonceForSmoke && frameNonce !== previousFrameNonce;
      if (frameWindow && hasFreshFrameNonce) {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            version: bridgeVersion,
            type: "gui.ready",
            ...(requestId === undefined ? {} : { requestId }),
            payload: { supportedBridgeVersion: bridgeVersion, frameNonce },
          },
          origin: messageOrigin,
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
  }), { bridgeVersion: version, messageOrigin: origin, sequenceBeforeReload, requestId, previousFrameNonce });
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

async function assertSecretLikeContextPathRejected(page, version, requestId) {
  for (const file of [
    { displayPath: "credentials/api_key.txt", workspaceRelativePath: "credentials/api_key.txt" },
    { displayPath: "auth/token.json", workspaceRelativePath: "auth/token.json" },
  ]) {
    const before = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
    await page.evaluate(({ bridgeVersion, activeRequestId, file }) => {
      window.__yetAiSendHostMessageToFrame({
        version: bridgeVersion,
        type: "host.contextSnapshot",
        requestId: activeRequestId,
        payload: {
          kind: "active_editor",
          source: "jetbrains",
          file: {
            ...file,
            languageId: "text",
          },
        },
      });
    }, { bridgeVersion: version, activeRequestId: requestId, file });
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => window.__yetAiHostMessagesPostedCount);
    if (after !== before) {
      failures.push(`Wrapper relayed host.contextSnapshot with a secret-like path: ${file.workspaceRelativePath}.`);
    }
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

function activeFileExcerptResultPayload({ text = activeFileExcerptMarker, path = activeFileExcerptPath } = {}) {
  return {
    status: "succeeded",
    message: "Active file excerpt ready.",
    cloudRequired: false,
    action: "getActiveFileExcerpt",
    contextAttachment: {
      kind: "active_file_excerpt",
      source: "jetbrains",
      file: { displayPath: path, workspaceRelativePath: path, languageId: "kotlin" },
      range: activeFileExcerptRange,
      text,
      truncated: false,
    },
  };
}

function assertJetBrainsActiveFileExcerptContext(context) {
  if (!context || typeof context !== "object") {
    failures.push("Mock runtime did not receive active-file excerpt context.");
    return;
  }
  if (context.kind !== "active_editor" || context.source !== "jetbrains") failures.push("Active-file excerpt context kind/source was wrong.");
  if (context.file?.displayPath !== activeFileExcerptPath || context.file?.workspaceRelativePath !== activeFileExcerptPath || context.file?.languageId !== "kotlin") {
    failures.push("Active-file excerpt context file metadata was wrong.");
  }
  if (context.selection?.text !== activeFileExcerptMarker) failures.push("Active-file excerpt context text was wrong.");
  if (context.selection?.startLine !== activeFileExcerptRange.start.line || context.selection?.startCharacter !== activeFileExcerptRange.start.character || context.selection?.endLine !== activeFileExcerptRange.end.line || context.selection?.endCharacter !== activeFileExcerptRange.end.character) {
    failures.push("Active-file excerpt context range was wrong.");
  }
}

async function assertJetBrainsActiveFileExcerptRoundtrip(page, frameLocator) {
  const invalidAssistantProposal = JSON.stringify({
    type: "assistant.ideActionProposal",
    version: bridgeVersion,
    requiresUserConfirmation: true,
    cloudRequired: false,
    summary: "JetBrains assistant must not request active excerpts.",
    action: "getActiveFileExcerpt",
  });
  await page.evaluate(({ content }) => window.__yetAiSetNextAssistantResponseForSmoke?.(content), { content: invalidAssistantProposal });
  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill("Render invalid JetBrains active excerpt proposal.");
  const beforeInvalidProposalIdeRequests = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0);
  await clickSendButtonWithActionability(frameLocator, "JetBrains invalid active-file excerpt proposal send");
  await page.waitForTimeout(250);
  const afterInvalidProposalIdeRequests = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0);
  if (afterInvalidProposalIdeRequests !== beforeInvalidProposalIdeRequests) failures.push("Assistant getActiveFileExcerpt proposal caused a gui.ideActionRequest.");
  if (await frameLocator.getByText("Read-only IDE action proposal", { exact: true }).first().isVisible().catch(() => false)) failures.push("Assistant getActiveFileExcerpt proposal rendered a read-only proposal card.");
  if (await frameLocator.getByRole("button", { name: "Run read-only IDE action", exact: true }).first().isVisible().catch(() => false)) failures.push("Assistant getActiveFileExcerpt proposal rendered a runnable IDE action button.");

  const button = frameLocator.getByRole("button", { name: "Attach active file excerpt", exact: true }).first();
  await button.waitFor({ state: "visible", timeout: 5000 }).catch(() => failures.push("JetBrains active-file excerpt button was not visible."));
  const before = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0);
  await centerInNearestScrollContainer(button);
  await button.click();
  await page.waitForFunction((count) => (window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0) === count + 1, before, { timeout: 5000 })
    .catch(() => failures.push("Wrapper did not collect exactly one active-file excerpt gui.ideActionRequest."));
  const requests = await page.evaluate((count) => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").slice(count) ?? [], before);
  const request = requests[0];
  if (!request || request.version !== bridgeVersion || request.payload?.action !== "getActiveFileExcerpt" || Object.keys(request.payload ?? {}).length !== 1) {
    failures.push(`Wrapper collected malformed active-file excerpt request: ${JSON.stringify(request)}`);
    return;
  }
  if (typeof request.requestId !== "string" || !/^gui-active-file-excerpt-\d+$/.test(request.requestId)) failures.push(`Active-file excerpt request id was not GUI-owned: ${String(request.requestId)}.`);
  await button.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(100);
  const afterDuplicate = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0);
  if (afterDuplicate !== before + 1) failures.push("Pending JetBrains active-file excerpt allowed a duplicate request.");

  await page.evaluate(({ version, requestId, payload }) => {
    window.__yetAiSendHostMessageToFrame({ version, type: "host.ideActionResult", requestId: `${requestId}-stale`, payload });
  }, { version: bridgeVersion, requestId: request.requestId, payload: activeFileExcerptResultPayload({ text: "staleJetBrainsExcerptShouldNotRender", path: "src/main/kotlin/Stale.kt" }) });
  await page.waitForTimeout(150);
  if (await frameLocator.getByText("staleJetBrainsExcerptShouldNotRender", { exact: false }).first().isVisible().catch(() => false)) failures.push("Stale JetBrains active-file excerpt result rendered.");

  await page.evaluate(({ version, requestId, payload }) => {
    window.__yetAiSendHostMessageToFrame({ version, type: "host.ideActionResult", requestId, payload });
  }, { version: bridgeVersion, requestId: request.requestId, payload: activeFileExcerptResultPayload({ text: "const access_token = \"must-not-render\";" }) });
  await page.waitForTimeout(150);
  if (await frameLocator.getByText("access_token", { exact: false }).first().isVisible().catch(() => false)) failures.push("Invalid secret-like JetBrains active-file excerpt rendered.");

  await page.evaluate(({ version, requestId }) => {
    window.__yetAiSendHostMessageToFrame({ version, type: "host.ideActionProgress", requestId, payload: { phase: "running", status: "inProgress", summary: "Reading JetBrains active visible editor excerpt.", cloudRequired: false, action: "getActiveFileExcerpt" } });
  }, { version: bridgeVersion, requestId: request.requestId });
  await frameLocator.getByText("Attach active file excerpt: inProgress", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render active-file excerpt progress."));
  await page.evaluate(({ version, requestId, payload }) => {
    window.__yetAiSendHostMessageToFrame({ version, type: "host.ideActionResult", requestId, payload });
  }, { version: bridgeVersion, requestId: request.requestId, payload: activeFileExcerptResultPayload() });
  await frameLocator.getByText("Attach active file excerpt: succeeded", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render active-file excerpt success."));
  await frameLocator.getByText(`File: ${activeFileExcerptPath}`, { exact: true }).first().waitFor({ state: "attached", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not show active-file excerpt file label."));
  await frameLocator.getByText(activeFileExcerptMarker, { exact: false }).first().waitFor({ state: "attached", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not show active-file excerpt preview text."));

  const beforeSend = chatCommandRequestCount;
  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill(activeFileExcerptPrompt);
  await clickSendButtonWithActionability(frameLocator, "JetBrains active-file excerpt send");
  await waitForAssistantAnswerCount(frameLocator, "JetBrains login smoke", beforeSend, "JetBrains active-file excerpt assistant response");
  if (chatCommandRequestCount !== beforeSend + 1) failures.push("Active-file excerpt send did not post exactly one chat command.");
  if (chatCommandRequest?.payload?.content !== activeFileExcerptPrompt) failures.push("Active-file excerpt chat command prompt was wrong.");
  assertJetBrainsActiveFileExcerptContext(chatCommandRequest?.payload?.context);
  await page.waitForTimeout(100);
  if (await frameLocator.getByText(activeFileExcerptMarker, { exact: false }).first().isVisible().catch(() => false)) failures.push("One-shot active-file excerpt preview remained visible after send.");
}

async function assertJetBrainsIdeActionRoundtrip(page, frameLocator) {
  await frameLocator.getByText("JetBrains controlled actions", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not expose JetBrains controlled action controls."));
  await frameLocator.locator("section[aria-label='Agent activity IDE actions'] details").first().evaluate((element) => {
    if (element instanceof HTMLDetailsElement) element.open = true;
  }).catch(() => undefined);
  const before = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.ideActionRequest").length ?? 0);
  const ideActionText = await frameLocator.locator("section[aria-label='Agent activity IDE actions']").innerText({ timeout: 5000 }).catch(() => "");
  if (!ideActionText.includes("Get IDE context")) {
    failures.push(`Iframe GUI JetBrains IDE action panel did not include Get IDE context. Panel: ${ideActionText}`);
    return;
  }
  const getContextButton = frameLocator.locator("section[aria-label='Agent activity IDE actions'] button").filter({ hasText: "Get IDE context" }).first();
  await centerInNearestScrollContainer(getContextButton);
  await getContextButton.click();
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

async function assertJetBrainsConfirmedEditLifecycle(page, frameLocator) {
  const baselineChatCommandCount = chatCommandRequestCountBeforeEditSmoke;
  await injectJetBrainsAssistantProposal(page, frameLocator, jetbrainsEditProposal);
  await frameLocator.getByText("JetBrains confirmed edit smoke proposal.", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render the JetBrains confirmed edit proposal."));
  await frameLocator.getByText("Apply in JetBrains after review", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not show JetBrains explicit apply action."));
  const beforeClickMessages = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length ?? 0);
  if (beforeClickMessages !== 0) {
    failures.push("JetBrains confirmed edit apply request was emitted before explicit user action.");
  }

  const applyButton = frameLocator.getByRole("button", { name: "Apply in JetBrains after review", exact: true }).first();
  await centerInNearestScrollContainer(applyButton);
  await applyButton.click();
  const acceptedRequest = await waitForJetBrainsApplyRequest(page, 1);
  assertJetBrainsApplyRequestShape(acceptedRequest, "accepted JetBrains apply request");
  await frameLocator.getByRole("button", { name: "JetBrains apply request pending…", exact: true }).first().click({ force: true }).catch(() => undefined);
  const pendingDoubleClickCount = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length ?? 0);
  if (pendingDoubleClickCount !== 1) {
    failures.push(`JetBrains duplicate pending apply emitted ${pendingDoubleClickCount} requests instead of one.`);
  }
  await dispatchJetBrainsApplyResult(page, acceptedRequest.requestId, { status: "applied", message: "Applied 1 JetBrains edit to 1 file.", appliedEditCount: 1, affectedFiles: ["src/main/kotlin/ApplySmoke.kt"] });
  await frameLocator.getByText("Host apply result: applied", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render JetBrains accepted apply result."));
  await frameLocator.getByText("Applied 1 JetBrains edit to 1 file.", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render sanitized JetBrains applied message."));

  await injectJetBrainsAssistantProposal(page, frameLocator, jetbrainsDeniedEditProposal);
  await centerInNearestScrollContainer(frameLocator.getByRole("button", { name: "Apply in JetBrains after review", exact: true }).first());
  await frameLocator.getByRole("button", { name: "Apply in JetBrains after review", exact: true }).first().click();
  const deniedRequest = await waitForJetBrainsApplyRequest(page, 2);
  assertJetBrainsApplyRequestShape(deniedRequest, "denied JetBrains apply request");
  await dispatchJetBrainsApplyResult(page, deniedRequest.requestId, { status: "denied", message: "Host confirmation denied the JetBrains edit request.", appliedEditCount: 0, affectedFiles: [] });
  await frameLocator.getByText("Host apply result: denied", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render JetBrains denied apply result."));
  await frameLocator.getByText("Host confirmation denied the JetBrains edit request.", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 })
    .catch(() => failures.push("Iframe GUI did not render sanitized JetBrains denial message."));

  await injectJetBrainsAssistantProposal(page, frameLocator, jetbrainsEditProposal);
  await centerInNearestScrollContainer(frameLocator.getByRole("button", { name: "Apply in JetBrains after review", exact: true }).first());
  await frameLocator.getByRole("button", { name: "Apply in JetBrains after review", exact: true }).first().click();
  const rejectedRequest = await waitForJetBrainsApplyRequest(page, 3);
  if (!rejectedRequest || rejectedRequest.requestId === deniedRequest.requestId) {
    failures.push("JetBrains rejected apply did not emit a fresh request after denial.");
    return;
  }
  const rawRejectedMessage = `Rejected unsafe JetBrains request with ${oauthSentinels.apiKey} and /Users/alice/private/secret.kt`;
  await dispatchJetBrainsApplyResult(page, rejectedRequest.requestId, { status: "rejected", message: rawRejectedMessage, appliedEditCount: 0, affectedFiles: [] });
  await page.waitForTimeout(100);
  const rejectedVisibleState = await frameLocator.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (rejectedVisibleState.includes(oauthSentinels.apiKey) || rejectedVisibleState.includes("/Users/alice/private/secret.kt") || rejectedVisibleState.includes("../private/secret.kt")) {
    failures.push("JetBrains rejected apply result leaked a raw secret or unsafe path in GUI-visible text.");
  }

  const beforeUnsafe = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length ?? 0);
  await injectJetBrainsAssistantProposal(page, frameLocator, jetbrainsUnsafeEditProposal);
  await page.waitForTimeout(100);
  const unsafeText = await frameLocator.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (unsafeText.includes("Apply in JetBrains after review")) {
    failures.push("Iframe GUI exposed a JetBrains apply action for an unsafe traversal proposal.");
  }
  const afterUnsafe = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length ?? 0);
  if (afterUnsafe > beforeUnsafe) {
    failures.push("Unsafe JetBrains edit proposal emitted an apply request.");
  }
  chatCommandRequestCount = baselineChatCommandCount;
}

async function injectJetBrainsAssistantProposal(page, frameLocator, proposal) {
  await page.evaluate(({ version, payload }) => window.__yetAiSetNextAssistantResponseForSmoke?.(JSON.stringify({
    type: "gui.applyWorkspaceEditRequest",
    version,
    payload,
  })), { version: bridgeVersion, payload: proposal });
  await frameLocator.getByPlaceholder("Ask about the current file, selection, or project...").fill("Render JetBrains confirmed edit smoke proposal.");
  await clickSendButtonWithActionability(frameLocator, "JetBrains edit proposal injection send");
  await page.waitForFunction((text) => document.querySelector("iframe[title='Yet AI GUI']")?.contentDocument?.body?.innerText.includes(text), proposal.summary, { timeout: 5000 }).catch(() => undefined);
}

async function waitForJetBrainsApplyRequest(page, expectedCount) {
  await page.waitForFunction((count) => (window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length ?? 0) >= count, expectedCount, { timeout: 5000 })
    .catch(() => failures.push(`Wrapper did not collect JetBrains apply request #${expectedCount}.`));
  const requests = await page.evaluate((count) => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").slice(0, count) ?? [], expectedCount);
  return requests[expectedCount - 1];
}

function assertJetBrainsApplyRequestShape(request, label) {
  if (!request || request.version !== bridgeVersion || request.type !== "gui.applyWorkspaceEditRequest") {
    failures.push(`${label} had the wrong bridge envelope: ${JSON.stringify(request)}`);
    return;
  }
  if (typeof request.requestId !== "string" || !/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]{0,127}-\d+$/.test(request.requestId)) {
    failures.push(`${label} had an invalid GUI-owned request id: ${String(request.requestId)}.`);
  }
  if (request.payload?.requiresUserConfirmation !== true || request.payload?.cloudRequired !== false) {
    failures.push(`${label} did not require user confirmation and cloudRequired false.`);
  }
  if (request.payload?.summary !== jetbrainsEditProposal.summary && request.payload?.summary !== jetbrainsDeniedEditProposal.summary && request.payload?.summary !== jetbrainsRejectedEditProposal.summary) {
    failures.push(`${label} did not carry the expected sanitized proposal summary.`);
  }
  if (request.payload?.edits?.[0]?.workspaceRelativePath !== "src/main/kotlin/ApplySmoke.kt") {
    failures.push(`${label} did not carry the expected workspace-relative file.`);
  }
}

async function dispatchJetBrainsApplyResult(page, requestId, payload) {
  await page.evaluate(({ version, requestId, payload }) => {
    window.__yetAiSendHostMessageToFrame({
      version,
      type: "host.applyWorkspaceEditResult",
      requestId,
      payload: {
        cloudRequired: false,
        ...payload,
      },
    });
  }, { version: bridgeVersion, requestId, payload: sanitizeApplyResultForSmoke(payload) });
}

function sanitizeApplyResultForSmoke(payload) {
  const message = sanitizeEvidenceText(String(payload.message ?? "JetBrains apply result.")).slice(0, 1000) || "JetBrains apply result.";
  const affectedFiles = Array.isArray(payload.affectedFiles)
    ? payload.affectedFiles.filter((file) => typeof file === "string" && safeSmokeWorkspacePath(file)).slice(0, 16)
    : [];
  return {
    status: payload.status,
    message,
    appliedEditCount: payload.appliedEditCount,
    affectedFiles,
  };
}

function safeSmokeWorkspacePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.includes("\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && !value.split("/").some((part) => part.length === 0 || part === "." || part === ".." || /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)|^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(part));
}

async function assertForbiddenIdeActionMessagesRejected(page, frameLocator) {
  const before = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
  const beforeApply = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length ?? 0);
  await frameLocator.locator("body").evaluate((body, version) => {
    const target = document.referrer ? new URL(document.referrer).origin : "*";
    const messages = [
      { version, type: "gui.applyWorkspaceEditRequest", requestId: "forbidden-apply", payload: {} },
      { version, type: "gui.openFile", requestId: "forbidden-open", payload: { workspaceRelativePath: "src/App.tsx" } },
      { version, type: "gui.revealRange", requestId: "forbidden-reveal", payload: { workspaceRelativePath: "src/App.tsx" } },
      { version, type: "gui.executeIdeTool", requestId: "forbidden-tool", payload: { tool: "anything" } },
      { version, type: "gui.ideActionRequest", requestId: "unsafe-path", payload: { action: "openWorkspaceFile", workspaceRelativePath: "../secret.txt" } },
      { version, type: "gui.ideActionRequest", requestId: "unknown-action", payload: { action: "runShellCommand" } },
      { version, type: "gui.ideActionRequest", requestId: "active-excerpt-path", payload: { action: "getActiveFileExcerpt", workspaceRelativePath: "src/App.tsx" } },
      { version, type: "gui.ideActionRequest", requestId: "active-excerpt-shell", payload: { action: "getActiveFileExcerpt", shell: "cat" } },
      { version, type: "gui.ideActionRequest", requestId: "forbidden-shell", payload: { action: "runShellCommand", command: "pwd" } },
      { version, type: "gui.ideActionRequest", requestId: "forbidden-task", payload: { action: "runTask", task: "build" } },
      { version, type: "gui.ideActionRequest", requestId: "forbidden-provider", payload: { action: "callProvider", providerId: "openai" } },
    ];
    for (const message of messages) window.parent.postMessage(message, target);
  }, bridgeVersion);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__yetAiBridgeMessages?.length ?? 0);
  if (after !== before) {
    failures.push("Wrapper forwarded a forbidden or malformed iframe-origin GUI-to-host message.");
  }
  const afterApply = await page.evaluate(() => window.__yetAiBridgeMessages?.filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length ?? 0);
  if (afterApply !== beforeApply) {
    failures.push("Wrapper forwarded a malformed iframe-origin apply workspace edit request.");
  }
}

async function openDetailsBySummary(scope, summaryText, visibleLocator) {
  if (await visibleLocator.isVisible().catch(() => false)) return;
  const summary = scope.locator("summary", { hasText: summaryText }).first();
  await summary.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await summary.click({ timeout: 5000 });
  await visibleLocator.waitFor({ state: "visible", timeout: 10_000 });
}

async function assertPendingQueuesAreBounded(page) {
  const boundedState = await page.evaluate(() => window.__yetAiSmokeBoundPendingQueues?.());
  if (!boundedState) {
    failures.push("Wrapper bounded pending queue smoke helper was not installed.");
    return;
  }
  if (boundedState.hostLength > maxPendingHostMessages || boundedState.diagnosticLength > maxPendingDiagnostics) {
    failures.push(`Wrapper pending queues exceeded production bounds: host=${boundedState.hostLength}/${maxPendingHostMessages}, diagnostics=${boundedState.diagnosticLength}/${maxPendingDiagnostics}.`);
  }
  if (!boundedState.restoredHostContents || !boundedState.restoredDiagnosticContents) {
    failures.push("Wrapper bounded pending queue smoke helper did not restore closure queue contents.");
  }
}

async function requireFreshPackagedGui() {
  try {
    await assertPackagedGuiFreshness({
      sourceRoot: distRoot,
      packagedRoot: packagedGuiRoot,
      label: "JetBrains packaged generated GUI",
    });
  } catch (error) {
    console.error("JetBrains wrapper browser smoke failed: packaged generated GUI is missing or stale.");
    console.error("Run `cd apps/gui && npm run build`, then `npm run prepare:jetbrains-preview -- --skip-engine-prepare` before `npm run smoke:jetbrains-wrapper-browser` so the smoke serves fresh packaged GUI resources.");
    console.error(`Expected built GUI file: ${path.relative(root, indexPath)}`);
    console.error(`Expected packaged GUI file: ${path.relative(root, packagedGuiIndexPath)}`);
    console.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
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
  payload: {},
}];
window.__yetAiPendingDiagnostics = ["Queued diagnostic before wrapper init"];
</script>
<script defer>
const bridgeVersion = "${bridgeVersion}";
const maxIdeActionRequestBytes = 8192;
const maxApplyWorkspaceEditRequestBytes = 16384;
const maxPendingHostMessages = ${maxPendingHostMessages};
const maxPendingDiagnostics = ${maxPendingDiagnostics};
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
const boundedArray = (value, maxSize) => Array.isArray(value) ? value.slice(-maxSize) : [];
const pushBounded = (queue, message, maxSize) => {
  queue.push(message);
  while (queue.length > maxSize) queue.shift();
};
const pendingHostMessages = boundedArray(window.__yetAiPendingHostMessages, maxPendingHostMessages);
const pendingDiagnostics = boundedArray(window.__yetAiPendingDiagnostics, maxPendingDiagnostics);
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
    pushBounded(pendingDiagnostics, message, maxPendingDiagnostics);
    return;
  }
  showDiagnostic(message);
};
window.__yetAiSmokeBoundPendingQueues = () => {
  const initialHostMessages = pendingHostMessages.slice();
  const initialDiagnostics = pendingDiagnostics.slice();
  let hostLength = pendingHostMessages.length;
  let diagnosticLength = pendingDiagnostics.length;
  try {
    for (let index = 0; index < maxPendingHostMessages + 8; index += 1) pushBounded(pendingHostMessages, { requestId: "pre-init-" + index }, maxPendingHostMessages);
    for (let index = 0; index < maxPendingDiagnostics + 8; index += 1) pushBounded(pendingDiagnostics, "pre-init diagnostic " + index, maxPendingDiagnostics);
    hostLength = pendingHostMessages.length;
    diagnosticLength = pendingDiagnostics.length;
  } finally {
    pendingHostMessages.splice(0, pendingHostMessages.length, ...initialHostMessages);
    pendingDiagnostics.splice(0, pendingDiagnostics.length, ...initialDiagnostics);
  }
  return {
    initialHostLength: initialHostMessages.length,
    initialDiagnosticLength: initialDiagnostics.length,
    hostLength,
    diagnosticLength,
    restoredHostContents: pendingHostMessages.length === initialHostMessages.length && pendingHostMessages.every((message, index) => message === initialHostMessages[index]),
    restoredDiagnosticContents: pendingDiagnostics.length === initialDiagnostics.length && pendingDiagnostics.every((message, index) => message === initialDiagnostics[index]),
  };
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
window.__yetAiSetNextAssistantResponseForSmoke = (content) => {
  if (typeof content === "string" && content.length > 0 && content.length <= 50000) {
    fetch("${runtimeBaseUrl}/__smoke/next-assistant-response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch(() => undefined);
  }
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
const isGuiUnloadedMessage = (message) => isPlainObject(message) && hasOnlyKeys(message, ["version", "type", "payload"]) && message.version === bridgeVersion && message.type === "gui.unloaded" && isPlainObject(message.payload) && Object.keys(message.payload).length === 0;
const messageMatchesCurrentReady = (message) => frameReady && currentGuiReadySequence === guiReadySequence && message.requestId === currentReadyRequestId();
const canDeliverHostMessage = (message) => {
  if (message.type === "host.ideActionProgress" || message.type === "host.ideActionResult") return frameReady && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId();
  if (message.type === "host.applyWorkspaceEditResult") return frameReady && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId();
  if (message.type === "host.openedFromCommand") return frameReady && hostReadyAcceptedForCurrentFrame && acceptedHostReadyRequestId === currentReadyRequestId() && message.requestId === undefined;
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
    if (message?.type === "host.openedFromCommand" && message?.requestId === undefined) window.__yetAiPreInitOpenedFlushed = true;
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
const allowedIdeActionNames = ["getContextSnapshot", "openWorkspaceFile", "revealWorkspaceRange", "getActiveFileExcerpt"];
const hasUnsafeExcerptText = (text) => /(authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|\\/(?:Users|Home|Tmp|Var|Etc|Opt|Mnt|Volumes|Private)(?=\\/|$|[^A-Za-z0-9_])|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(text);
const isActiveFileExcerptText = (text) => typeof text === "string" && text.length > 0 && text.length <= 8000 && !hasUnsafeExcerptText(text);
const isActiveFileExcerptAttachment = (attachment) => isPlainObject(attachment) && hasOnlyKeys(attachment, ["kind", "source", "file", "range", "text", "truncated"]) && attachment.kind === "active_file_excerpt" && attachment.source === "jetbrains" && isPlainObject(attachment.file) && hasOnlyKeys(attachment.file, ["displayPath", "workspaceRelativePath", "languageId"]) && safePath(attachment.file.displayPath, 256) && safePath(attachment.file.workspaceRelativePath, 512) && (attachment.file.languageId === undefined || (typeof attachment.file.languageId === "string" && attachment.file.languageId.length > 0 && attachment.file.languageId.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(attachment.file.languageId))) && isIdeActionRange(attachment.range) && isActiveFileExcerptText(attachment.text) && typeof attachment.truncated === "boolean";
const requiredLoopbackRuntimeUrl = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopback && /^[1-9][0-9]{0,4}$/.test(parsed.port) && Number(parsed.port) <= 65535 && parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "" && (parsed.pathname === "" || parsed.pathname === "/");
  } catch (_) {
    return false;
  }
};
const optionalNumber = (value) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 1000000);
// This Node template literal emits browser JavaScript, so "\\\\" here becomes the browser-side single-backslash check used by the production wrapper.
const isSecretLikePathSegment = (value) => /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(value) || /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(value) || /^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
const safePath = (value, maxLength) => value === undefined || (typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes("\\\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && value.split("").every((char) => char >= " " && (char < "\u007f" || char > "\u009f")) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !isSecretLikePathSegment(part)));
const isContextFile = (file) => file === undefined || (isPlainObject(file) && hasOnlyKeys(file, ["displayPath", "workspaceRelativePath", "languageId"]) && Object.keys(file).length > 0 && safePath(file.displayPath, 256) && safePath(file.workspaceRelativePath, 512) && (file.languageId === undefined || (typeof file.languageId === "string" && file.languageId.length > 0 && file.languageId.length <= 64 && /^[A-Za-z0-9_.+-]+$/.test(file.languageId))));
const isContextSelection = (selection) => selection === undefined || (isPlainObject(selection) && hasOnlyKeys(selection, ["startLine", "startCharacter", "endLine", "endCharacter", "text"]) && Object.keys(selection).length > 0 && optionalNumber(selection.startLine) && optionalNumber(selection.startCharacter) && optionalNumber(selection.endLine) && optionalNumber(selection.endCharacter) && optionalString(selection.text, 8000));
const isContextSnapshotPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["kind", "source", "file", "selection"]) && payload.kind === "active_editor" && (payload.source === "vscode" || payload.source === "jetbrains" || payload.source === "browser") && isContextFile(payload.file) && isContextSelection(payload.selection);
const isHostReadyPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["runtimeUrl", "sessionToken", "productId", "displayName", "cloudRequired"]) && requiredLoopbackRuntimeUrl(payload.runtimeUrl) && optionalString(payload.sessionToken, 4096) && optionalNonEmptyString(payload.productId, 256) && optionalNonEmptyString(payload.displayName, 256) && (payload.cloudRequired === undefined || payload.cloudRequired === false);
const isIdeActionPosition = (position) => isPlainObject(position) && hasOnlyKeys(position, ["line", "character"]) && Number.isInteger(position.line) && position.line >= 0 && position.line <= 1000000 && Number.isInteger(position.character) && position.character >= 0 && position.character <= 1000000;
const isIdeActionRange = (range) => isPlainObject(range) && hasOnlyKeys(range, ["start", "end"]) && isIdeActionPosition(range.start) && isIdeActionPosition(range.end) && (range.end.line > range.start.line || (range.end.line === range.start.line && range.end.character >= range.start.character));
const isHostIdeActionProgressPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["phase", "status", "summary", "cloudRequired", "action", "workspaceRelativePath"]) && ["queued", "checkingPolicy", "running", "completed"].includes(payload.phase) && ["pending", "inProgress", "succeeded", "rejected", "unavailable", "failed"].includes(payload.status) && typeof payload.summary === "string" && payload.summary.length > 0 && payload.summary.length <= 1000 && (payload.cloudRequired === undefined || payload.cloudRequired === false) && (payload.action === undefined || allowedIdeActionNames.includes(payload.action)) && safePath(payload.workspaceRelativePath, 512);
const isHostIdeActionResultContext = (context) => isPlainObject(context) && hasOnlyKeys(context, ["source", "hasActiveEditor", "workspaceFolderCount"]) && context.source === "jetbrains" && typeof context.hasActiveEditor === "boolean" && Number.isInteger(context.workspaceFolderCount) && context.workspaceFolderCount >= 0 && context.workspaceFolderCount <= 100;
const isHostIdeActionResultPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["status", "message", "cloudRequired", "action", "workspaceRelativePath", "range", "context", "contextAttachment"]) && ["succeeded", "rejected", "unavailable", "failed"].includes(payload.status) && typeof payload.message === "string" && payload.message.length > 0 && payload.message.length <= 1000 && (payload.cloudRequired === undefined || payload.cloudRequired === false) && (payload.action === undefined || allowedIdeActionNames.includes(payload.action)) && safePath(payload.workspaceRelativePath, 512) && (payload.range === undefined || isIdeActionRange(payload.range)) && (payload.context === undefined || isHostIdeActionResultContext(payload.context)) && (payload.contextAttachment === undefined || (payload.status === "succeeded" && payload.action === "getActiveFileExcerpt" && isActiveFileExcerptAttachment(payload.contextAttachment))) && (payload.action !== "getActiveFileExcerpt" || (payload.workspaceRelativePath === undefined && payload.range === undefined && payload.context === undefined)) && (payload.status !== "succeeded" || payload.action !== "getActiveFileExcerpt" || isActiveFileExcerptAttachment(payload.contextAttachment));
const isHostApplyWorkspaceEditResultPayload = (payload) => isPlainObject(payload) && hasOnlyKeys(payload, ["status", "message", "cloudRequired", "appliedEditCount", "affectedFiles"]) && ["applied", "denied", "rejected", "failed"].includes(payload.status) && typeof payload.message === "string" && payload.message.length > 0 && payload.message.length <= 1000 && payload.cloudRequired === false && (payload.appliedEditCount === undefined || (Number.isInteger(payload.appliedEditCount) && payload.appliedEditCount >= 0 && payload.appliedEditCount <= 64)) && (payload.affectedFiles === undefined || (Array.isArray(payload.affectedFiles) && payload.affectedFiles.length <= 16 && payload.affectedFiles.every((file) => safePath(file, 512))));
const isHostMessage = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion) return false;
  if (message.type === "host.openedFromCommand") return message.requestId === undefined && (message.payload === undefined || (isPlainObject(message.payload) && Object.keys(message.payload).length === 0));
  if (!isRequestId(message.requestId)) return false;
  if (message.type === "host.ready") return isHostReadyPayload(message.payload);
  if (message.type === "host.contextSnapshot") return isContextSnapshotPayload(message.payload);
  if (message.type === "host.ideActionProgress") return isHostIdeActionProgressPayload(message.payload);
  if (message.type === "host.ideActionResult") return isHostIdeActionResultPayload(message.payload);
  if (message.type === "host.applyWorkspaceEditResult") return isHostApplyWorkspaceEditResultPayload(message.payload);
  return false;
};
const requiredRequestId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !/(authorization|bearer|api[_-]?key|token|secret|access[_-]?token|provider[_-]?key|openai[_-]?api[_-]?key|sk-(?:proj-)?[A-Za-z0-9_-]{8,})/i.test(value);
const safeRequiredWorkspacePath = (value) => safePath(value, 512) && !value.includes("%") && !value.includes("?") && !value.includes("#") && !value.includes("//") && !value.endsWith("/") && value.split("/").every((part) => part.length > 0 && !/(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)|^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(part));
const isGuiIdeActionPayload = (payload) => {
  if (!isPlainObject(payload) || typeof payload.action !== "string" || !allowedIdeActionNames.includes(payload.action)) return false;
  if (payload.action === "getContextSnapshot") return hasOnlyKeys(payload, ["action"]);
  if (payload.action === "getActiveFileExcerpt") return hasOnlyKeys(payload, ["action"]);
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
const isApplyPosition = (position) => isPlainObject(position) && hasOnlyKeys(position, ["line", "character"]) && Number.isInteger(position.line) && position.line >= 0 && position.line <= 1000000 && Number.isInteger(position.character) && position.character >= 0 && position.character <= 1000000;
const isApplyRange = (range) => isPlainObject(range) && hasOnlyKeys(range, ["start", "end"]) && isApplyPosition(range.start) && isApplyPosition(range.end) && (range.end.line > range.start.line || (range.end.line === range.start.line && range.end.character >= range.start.character));
const isApplyReplacement = (replacement) => isPlainObject(replacement) && hasOnlyKeys(replacement, ["range", "replacementText"]) && isApplyRange(replacement.range) && typeof replacement.replacementText === "string" && replacement.replacementText.length <= 8192;
const isApplyFileEdit = (fileEdit) => isPlainObject(fileEdit) && hasOnlyKeys(fileEdit, ["workspaceRelativePath", "textReplacements"]) && safeRequiredWorkspacePath(fileEdit.workspaceRelativePath) && Array.isArray(fileEdit.textReplacements) && fileEdit.textReplacements.length >= 1 && fileEdit.textReplacements.length <= 8 && fileEdit.textReplacements.every(isApplyReplacement);
const isGuiApplyWorkspaceEditPayload = (payload) => {
  if (!isPlainObject(payload) || !hasOnlyKeys(payload, ["requiresUserConfirmation", "summary", "cloudRequired", "edits"])) return false;
  if (payload.requiresUserConfirmation !== true || typeof payload.summary !== "string" || payload.summary.length < 1 || payload.summary.length > 1000 || (payload.cloudRequired !== undefined && payload.cloudRequired !== false)) return false;
  if (!Array.isArray(payload.edits) || payload.edits.length < 1 || payload.edits.length > 4) return false;
  const seen = new Set();
  let totalReplacementText = 0;
  for (const fileEdit of payload.edits) {
    if (!isApplyFileEdit(fileEdit) || seen.has(fileEdit.workspaceRelativePath)) return false;
    seen.add(fileEdit.workspaceRelativePath);
    for (const replacement of fileEdit.textReplacements) {
      totalReplacementText += replacement.replacementText.length;
      if (totalReplacementText > 32768) return false;
    }
  }
  return true;
};
const isGuiApplyWorkspaceEditRequest = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.applyWorkspaceEditRequest" || !requiredRequestId(message.requestId)) return false;
  let serialized;
  try { serialized = JSON.stringify(message); } catch (_) { return false; }
  if (typeof serialized !== "string" || new Blob([serialized]).size > maxApplyWorkspaceEditRequestBytes) return false;
  return isGuiApplyWorkspaceEditPayload(message.payload);
};
const isGuiRuntimeRefresh = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.runtimeRefresh" || !requiredRequestId(message.requestId)) return false;
  return isPlainObject(message.payload) && Object.keys(message.payload).length === 0;
};
const isGuiMessage = (message) => {
  if (!isPlainObject(message) || !hasOnlyKeys(message, ["version", "type", "requestId", "payload"]) || message.version !== bridgeVersion || message.type !== "gui.ready" || !isRequestId(message.requestId)) return false;
  return isPlainObject(message.payload) && hasOnlyKeys(message.payload, ["supportedBridgeVersion", "frameNonce"]) && (message.payload.supportedBridgeVersion === undefined || message.payload.supportedBridgeVersion === bridgeVersion) && isFrameNonce(currentFrameNonce) && isFrameNonce(message.payload.frameNonce) && message.payload.frameNonce === currentFrameNonce;
};
window.__yetAiSendHostMessageToFrame = sendToFrame;
window.__yetAiWrapperInitialized = true;
window.addEventListener("message", (event) => {
  if (event.source === currentFrameWindow && event.source === frame?.contentWindow) {
    if (frameTargetOrigin && frameTargetOrigin !== "*" && event.origin !== frameTargetOrigin) {
      console.log("Yet AI rejected iframe message from unexpected origin");
      return;
    }
    if (isGuiUnloadedMessage(event.data)) {
      invalidateFrameAuthority("gui.unloaded");
      window.postIntellijMessage(event.data);
    } else if (isGuiRuntimeRefresh(event.data)) {
      if (!frameReady) {
        console.log("Yet AI rejected runtime refresh before current GUI ready handshake");
        return;
      }
      window.postIntellijMessage(event.data);
    } else if (isGuiIdeActionRequest(event.data)) {
      if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
        console.log("Yet AI rejected IDE action request before GUI bridge readiness");
        return;
      }
      window.postIntellijMessage(event.data);
    } else if (isGuiApplyWorkspaceEditRequest(event.data)) {
      if (!frameReady || !hostReadyAcceptedForCurrentFrame || acceptedHostReadyRequestId !== currentReadyRequestId()) {
        console.log("Yet AI rejected apply workspace edit request before GUI bridge readiness");
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
    if (request.method === "POST" && requestUrl.pathname === "/__smoke/next-assistant-response") {
      let body;
      try {
        body = await readRequestBody(request);
      } catch {
        json(response, 400, { error: "Invalid smoke body" });
        return;
      }
      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        json(response, 400, { error: "Invalid smoke JSON" });
        return;
      }
      if (typeof parsedBody?.content !== "string" || parsedBody.content.length === 0 || parsedBody.content.length > 50000) {
        json(response, 400, { error: "Invalid smoke content" });
        return;
      }
      nextAssistantResponseContent = parsedBody.content;
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    const authorized = request.headers.authorization === `Bearer ${runtimeToken}`;
    if (authorized) {
      observedRuntimeAuthorization = true;
    }
    const runtimeLogEntry = { method: request.method ?? "GET", pathname: requestUrl.pathname, authorized };
    runtimeRequestLog.push(runtimeLogEntry);
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
    if (request.method === "GET" && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, demoModeResponse(demoModeEnabled));
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/v1/demo-mode") {
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
        json(response, 400, { error: "Invalid Demo Mode JSON" });
        return;
      }
      runtimeLogEntry.body = parsedBody;
      demoModeEnabled = parsedBody?.enabled === true;
      json(response, 200, demoModeResponse(demoModeEnabled));
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: demoModeEnabled ? [readyDemoModel()] : [] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: demoModeEnabled ? [readyDemoProvider()] : [], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, demoModeFirstMessage ? unavailableProviderAuthStatus() : connectedProviderAuthStatus());
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
      runtimeLogEntry.body = parsedBody;
      chatCommandRequestCount += 1;
      chatCommandRequest = parsedBody;
      const chatId = decodeURIComponent(commandMatch[1]);
      json(response, 200, {
        accepted: true,
        chatId,
        requestId: chatCommandRequest.requestId,
        type: chatCommandRequest.type,
      });
      if (chatCommandRequest?.type === "user_message") {
        emitAssistantResponseAfterUserMessage(chatId);
      }
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
      registerChatSseSubscriber(chatId, response);
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

function registerChatSseSubscriber(chatId, response) {
  const subscribers = chatSseSubscribers.get(chatId) ?? new Set();
  const subscriber = { response, nextSeq: 1 };
  subscribers.add(subscriber);
  chatSseSubscribers.set(chatId, subscribers);
  response.on("close", () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      chatSseSubscribers.delete(chatId);
    }
  });
  const pendingCount = pendingAssistantResponsesByChat.get(chatId) ?? 0;
  if (pendingCount > 0) {
    pendingAssistantResponsesByChat.set(chatId, pendingCount - 1);
    setTimeout(() => emitAssistantResponse(chatId), 0);
  }
}

function emitAssistantResponseAfterUserMessage(chatId) {
  if (chatSseSubscribers.has(chatId)) {
    setTimeout(() => emitAssistantResponse(chatId), 0);
    return;
  }
  pendingAssistantResponsesByChat.set(chatId, (pendingAssistantResponsesByChat.get(chatId) ?? 0) + 1);
}

function emitAssistantResponse(chatId) {
  const subscribers = chatSseSubscribers.get(chatId);
  if (!subscribers || subscribers.size === 0) {
    pendingAssistantResponsesByChat.set(chatId, (pendingAssistantResponsesByChat.get(chatId) ?? 0) + 1);
    return;
  }
  for (const subscriber of Array.from(subscribers).reverse()) {
    if (!isWritableSseResponse(subscriber.response)) {
      subscribers.delete(subscriber);
      continue;
    }
    if (emitAssistantResponseToSubscriber(chatId, subscriber)) {
      return;
    }
    subscribers.delete(subscriber);
  }
  if (subscribers.size === 0) {
    chatSseSubscribers.delete(chatId);
  }
  pendingAssistantResponsesByChat.set(chatId, (pendingAssistantResponsesByChat.get(chatId) ?? 0) + 1);
}

function emitAssistantResponseToSubscriber(chatId, subscriber) {
  const customAssistantContent = nextAssistantResponseContent;
  nextAssistantResponseContent = undefined;
  const assistantChunks = customAssistantContent === undefined
    ? (demoModeFirstMessage ? ["JetBrains", " Demo Mode smoke"] : ["JetBrains", " login smoke"])
    : [customAssistantContent];
  const events = [
    { type: "stream_started", chatId, payload: { role: "assistant" } },
    { type: "stream_delta", chatId, payload: { delta: { content: assistantChunks[0] } } },
    ...(assistantChunks[1] ? [{ type: "stream_delta", chatId, payload: { delta: { content: assistantChunks[1] } } }] : []),
    { type: "stream_finished", chatId, payload: { finishReason: "stop" } },
  ];
  try {
    for (const event of events) {
      writeSseToSubscriber(subscriber, event);
    }
    return true;
  } catch {
    return false;
  }
}

function writeSseToSubscriber(subscriber, event) {
  if (!isWritableSseResponse(subscriber.response)) {
    throw new Error("SSE subscriber is no longer writable.");
  }
  writeSse(subscriber.response, { seq: subscriber.nextSeq, ...event });
  subscriber.nextSeq += 1;
}

function isWritableSseResponse(response) {
  return !response.destroyed && !response.writableEnded;
}

function writeSse(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
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

function unavailableProviderAuthStatus() {
  return {
    provider: "openai",
    configured: false,
    status: "login_unavailable",
    authSource: "none",
    supportsLogin: false,
    supportsApiKey: true,
    cloudRequired: false,
    message: "No OpenAI account or provider API key is configured in the local mock runtime.",
  };
}

function demoModeResponse(enabled) {
  return { enabled, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality. Configure a BYOK provider for real answers." };
}

function readyDemoProvider() {
  return {
    id: "yet-demo",
    kind: "demo-local",
    displayName: "Yet AI Demo Mode",
    enabled: true,
    baseUrl: "local-runtime-demo-mode",
    auth: { type: "none", configured: true },
    models: [readyDemoModel()],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function readyDemoModel() {
  return {
    id: "yet-demo-chat",
    providerId: "yet-demo",
    displayName: "Yet AI Demo Chat",
    capabilities: { chat: true, streaming: true, tools: false, reasoning: false },
    readiness: { status: "ready" },
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
    return sanitizeEvidenceText(url.toString());
  } catch {
    return sanitizeEvidenceText(value);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeEvidenceText(text) {
  return String(text)
    .replaceAll(runtimeToken, "[redacted-runtime-token]")
    .replaceAll(oauthSentinels.accessToken, "[redacted-oauth-access]")
    .replaceAll(oauthSentinels.refreshToken, "[redacted-oauth-refresh]")
    .replaceAll(oauthSentinels.authCode, "[redacted-oauth-code]")
    .replaceAll(oauthSentinels.verifier, "[redacted-oauth-verifier]")
    .replaceAll(oauthSentinels.cookie, "[redacted-cookie]")
    .replaceAll(oauthSentinels.apiKey, "[redacted-api-key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]");
}

function countRuntimeRequests(method, pathname) {
  return runtimeRequestLog.filter((entry) => entry.method === method && entry.pathname === pathname).length;
}

function countChatCommandPosts() {
  return runtimeRequestLog.filter((entry) => entry.method === "POST" && /^\/v1\/chats\/[^/]+\/commands$/.test(entry.pathname)).length;
}

function assertNoForbiddenRuntimeMutationRequests() {
  const forbidden = runtimeRequestLog.filter((entry) => entry.method !== "GET" && (/^\/v1\/providers(?:\/|$)/.test(entry.pathname) || /^\/v1\/provider-auth\//.test(entry.pathname)));
  if (forbidden.length > 0) {
    failures.push(`Unexpected provider/provider-auth mutation request(s): ${formatRuntimeRequestLog(forbidden)}.`);
  }
}

function assertAllRuntimeApiRequestsAuthorized() {
  const runtimeApiRequests = runtimeRequestLog.filter((entry) => entry.pathname.startsWith("/v1/"));
  if (runtimeApiRequests.length === 0) {
    failures.push("Mock runtime did not observe any /v1/* requests.");
    return;
  }
  const unauthorized = runtimeApiRequests.filter((entry) => !entry.authorized);
  if (unauthorized.length > 0) {
    failures.push(`Runtime /v1/* request(s) missed the JetBrains wrapper host.ready bearer token: ${formatRuntimeRequestLog(unauthorized)}.`);
  }
}

function formatRuntimeRequestLog(entries) {
  return entries.map((entry) => `${entry.method} ${entry.pathname}${entry.body === undefined ? "" : ` body=${JSON.stringify(entry.body)}`}`).join(", ");
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reportFailures() {
  console.error("JetBrains wrapper browser smoke failed:");
  for (const failure of failures) {
    console.error(`- ${sanitizeEvidenceText(failure)}`);
  }
  process.exit(1);
}
