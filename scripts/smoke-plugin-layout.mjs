import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "apps", "gui", "dist");
const indexPath = path.join(distRoot, "index.html");
const evidenceRoot = path.join(root, "dist", "visual-smoke", "plugin-layout");
const runtimeSessionValue = `pl-${randomUUID()}`;
const failures = [];
const JETBRAINS_SMOKE_PANEL_ID = "plugin-layout-smoke";
const BRIDGE_VERSION = "2026-05-15";
const SMOKE_PROJECT_ID = "prj_abcdefghijklmnopqrstuA";
const SMOKE_PROJECT_DISPLAY_NAME = "Plugin Layout Workspace";
const LAYOUT_CONTRACT_VERSION = "T-4-project-context-compact-layout";
const LAYOUT_THRESHOLDS = Object.freeze({
  maxContextHeight: 112,
  minTextareaHeight: 56,
  minChatScrollHeight: 120,
  minControlHeight: 36,
  maxComposerControlStackGap: 180,
  hosts: Object.freeze({
    vscode: Object.freeze({ minComposerLowerOffset: 0, maxComposerScrollOverlap: 1 }),
    jetbrains: Object.freeze({ minComposerLowerOffset: -16, maxComposerScrollOverlap: 316 }),
  }),
});
const LAYOUT_CONTRACT = Object.freeze({ version: LAYOUT_CONTRACT_VERSION, thresholds: LAYOUT_THRESHOLDS });
const DRAWER_SUMMARY_VISIBLE_AREA = Object.freeze({ minWidth: 96, minHeight: 24, minCoverage: 0.5 });
let guiServer;
let runtimeServer;
let browser;
let chatCommandCount = 0;
let contextPlanGate = null;
const subscribers = new Map();

verifyDrawerSummaryVisibleAreaContract();
await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  guiServer = await startStaticServer(distRoot);
  await verifyStaticServerContract(guiServer.port);
  runtimeServer = await startRuntimeServer();
  browser = await chromium.launch({ headless: true });

  console.log(`Plugin layout smoke contract: ${LAYOUT_CONTRACT_VERSION} ${JSON.stringify(LAYOUT_THRESHOLDS)}`);
  const evidence = [];
  evidence.push(await exercisePluginViewport({ chromium: browser, width: 790, height: 540, name: "vscode-790x540", host: "vscode" }));
  evidence.push(await exercisePluginViewport({ chromium: browser, width: 600, height: 500, name: "vscode-600x500", host: "vscode" }));
  evidence.push(await exercisePluginViewport({ chromium: browser, width: 600, height: 500, name: "jetbrains-600x500", host: "jetbrains" }));

  assert(chatCommandCount === 6, `expected six real Send clicks across three viewport scenarios, observed ${chatCommandCount}`);
  if (failures.length > 0) {
    throw new Error(`Plugin layout smoke failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  console.log("Plugin layout smoke passed.");
  console.log("Verified VS Code and JetBrains hosted compact chat with injected active editor context, real Chats drawer, textarea, Send, and Coding Actions clicks.");
  console.log(`Saved sanitized screenshots/DOM/metrics under ${path.relative(root, evidenceRoot)}/ (${evidence.map((item) => path.basename(item.metricsPath)).join(", ")}).`);
} finally {
  await browser?.close().catch(() => undefined);
  await guiServer?.close().catch(() => undefined);
  await runtimeServer?.close().catch(() => undefined);
}

async function exercisePluginViewport({ chromium, width, height, name, host }) {
  const page = await chromium.newPage({ viewport: { width, height } });
  const hostedPath = host === "vscode" ? "/vscode/hosted-chat" : `/panel/${JETBRAINS_SMOKE_PANEL_ID}/hosted-chat`;
  page.on("pageerror", (error) => failures.push(`${name} page JavaScript error: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:")) failures.push(`${name} non-loopback request attempted: ${url}`);
  });
  await page.addInitScript((bridgeHost) => {
    window.__yetAiBridgePosts = [];
    window.__yetAiInitialRuntimeConfig = { ...window.__yetAiInitialRuntimeConfig, entryMode: "hosted_chat" };
    window.__yetAiSmokeTrustedEntryInjected = window.__yetAiInitialRuntimeConfig.entryMode === "hosted_chat";
    if (bridgeHost === "vscode") {
      window.acquireVsCodeApi = () => ({ postMessage: (message) => window.__yetAiBridgePosts.push(message) });
    } else if (bridgeHost === "jetbrains") {
      window.postIntellijMessage = (message) => window.__yetAiBridgePosts.push(message);
    }
  }, host);
  await page.goto(`http://127.0.0.1:${guiServer.port}${hostedPath}`, { waitUntil: "domcontentloaded" });
  await assertHostedEntryRoute(page, { host, hostedPath, name });
  await waitForGuiReady(page, name);
  const hostGeneration = createHostGeneration();
  await dispatchHostedWorkspaceAuthority(page, hostGeneration);
  await enterCurrentWorkspaceChat(page, name);
  await page.waitForFunction(() => document.body.innerText.includes("ready to chat") || document.body.innerText.includes("Ready to send"), undefined, { timeout: 20_000 }).catch(() => failures.push(`Missing ${name} runtime ready state`));
  await page.waitForFunction(() => document.querySelector(".chat-scroll-region"), undefined, { timeout: 10_000 }).catch(() => failures.push(`Missing ${name} chat scroll region`));
  await openComposerDrawer(page, "ide-actions-drawer", name);
  const explainSelectionButton = page.getByRole("button", { name: "Explain selection", exact: true });
  await requireVisibleDisabledButton(page, explainSelectionButton, `${name} Explain selection button before context`, name);
  await assertActionable(page.getByRole("button", { name: "Send", exact: true }), `${name} Send button before context`);
  await injectActiveEditorContext(page, host, hostGeneration);
  const contextReady = await waitForActiveSelectedContext(page);
  if (!contextReady) await failViewport(page, name, "active selected context was not accepted before Coding Actions checks");
  await openComposerDrawer(page, "ide-actions-drawer", name);
  await requireActionableButton(page, explainSelectionButton, `${name} Explain selection button`, name);

  const chatsButton = page.getByRole("button", { name: "Chats", exact: true });
  await chatsButton.scrollIntoViewIfNeeded();
  await assertActionable(chatsButton, `${name} Chats button`);
  await chatsButton.click();
  assert(await page.locator(".conversations-drawer.open").isVisible().catch(() => false), `${name} Chats drawer did not open`);
  const closeChatsButton = page.locator(".conversations-drawer.open").getByRole("button", { name: "Close", exact: true });
  await closeChatsButton.scrollIntoViewIfNeeded();
  await assertActionable(closeChatsButton, `${name} Chats drawer Close button`);
  await closeChatsButton.click();

  const planningGate = holdNextContextPlan(name);
  try {
    await clickActionableButton(page, explainSelectionButton, `${name} Explain selection button`, { viewportName: name, controlLabel: "Explain selection" });
    await expectComposerValue(page, "Explain the selected code", `${name} Coding Actions prompt`);
    await planningGate.waitForRequest();
    const promptOnlyFallback = page.getByRole("button", { name: "Send without project context", exact: true });
    await promptOnlyFallback.waitFor({ state: "visible", timeout: 5000 });
    const planningMetrics = await collectLayoutMetrics(page, { width, height, name: `${name}-planning`, host });
    assert(planningMetrics.requiredControls.fallback.present, `${name} planning fallback was not present while its context plan request was held`);
    assertRequiredControlLayout(planningMetrics, `${name} planning controls`);
    await clickActionableButton(page, promptOnlyFallback, `${name} Send without project context button`, { viewportName: name, controlLabel: "Send without project context" });
  } finally {
    planningGate.release();
  }
  const sendButton = page.getByRole("button", { name: "Send", exact: true });
  await requireActionableButton(page, sendButton, `${name} Send button with expanded Coding Actions drawer`, name);
  const expandedDrawerMetrics = await collectLayoutMetrics(page, { width, height, name: `${name}-expanded-drawer`, host });
  assert(expandedDrawerMetrics.ideActionsDrawerOpen, `${name} ide-actions-drawer is not open for expanded drawer layout assertions`);
  assertLayoutMetrics(expandedDrawerMetrics, `${name} expanded ide-actions drawer`, height, host);
  await closeComposerDrawer(page, "ide-actions-drawer", name);
  await clickActionableButton(page, sendButton, `${name} Send button after Coding Actions prompt`, { viewportName: name, controlLabel: "Send" });
  await expectVisibleText(page, "Explain the selected code", `${name} sent coding-action prompt`);

  const textarea = page.getByPlaceholder("Ask about the current file, selection, or project...");
  await textarea.fill(`Follow-up from ${name}`);
  await clickActionableButton(page, page.getByRole("button", { name: "Send", exact: true }), `${name} Send button after follow-up prompt`, { viewportName: name, controlLabel: "Send" });
  await expectVisibleText(page, `Follow-up from ${name}`, `${name} user follow-up`);

  const metrics = await collectLayoutMetrics(page, { width, height, name, host });
  assertLayoutMetrics(metrics, name, height, host);
  await exerciseComposerDrawerIfPresent(page, "task-agent-tools-drawer", name);

  return saveEvidence(page, name, metrics);
}

async function assertHostedEntryRoute(page, { host, hostedPath, name }) {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 }).catch(() => undefined);
  const state = await page.evaluate((expectedPath) => ({
    url: window.location.href,
    path: window.location.pathname,
    expectedPath,
    trustedEntryInjected: window.__yetAiSmokeTrustedEntryInjected === true,
    entryMode: window.__yetAiInitialRuntimeConfig?.entryMode ?? null,
    notFound: document.body.innerText.includes("Not Found"),
    bodySnippet: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 700),
  }), hostedPath);
  if (!state.bodySnippet || state.notFound || state.path !== hostedPath || !state.trustedEntryInjected || state.entryMode !== "hosted_chat") {
    throw new Error(`${name} hosted route/bootstrap failed: ${sanitizeEvidenceText(JSON.stringify({ host, ...state }))}`);
  }
}

function assertLayoutMetrics(metrics, label, height, host) {
  assert(metrics.routedProjectChat, `${label} layout evidence was not collected from the routed project chat phase`);
  assert(metrics.heroState === "absent", `${label} routed project chat unexpectedly rendered a hosted hero: ${metrics.heroState}`);
  assert(host !== "jetbrains" || metrics.hostJetbrainsClass, `${label} did not render main.app-shell.host-jetbrains`);
  assert(host !== "jetbrains" || !metrics.hostBrowserClass, `${label} incorrectly kept host-browser class in JetBrains scenario`);
  assert(metrics.sendVisible && metrics.sendWithinViewport && metrics.sendEnabled, `${label} Send is not visible/enabled within viewport: ${JSON.stringify(metrics.sendRect)}`);
  assert(metrics.textareaVisible && metrics.textareaWithinViewport, `${label} textarea is not visible within viewport: ${JSON.stringify(metrics.textareaRect)}`);
  assert(metrics.chatScrollHeight >= LAYOUT_THRESHOLDS.minChatScrollHeight, `${label} chat-scroll-region too short: ${metrics.chatScrollHeight}`);
  assert(metrics.composerHeight <= 240, `${label} composer too tall: ${metrics.composerHeight}`);
  assert(metrics.composerBottom <= height + 1, `${label} composer extends below viewport: ${metrics.composerBottom} > ${height}`);
  assert(metrics.contextDetailsOpen === false || metrics.contextDetailsOpen === null, `${label} active editor context details should be collapsed`);
  assert(metrics.projectContextExpanded === false, `${label} project-context detail should stay collapsed`);
  assert(metrics.textareaRect?.height >= LAYOUT_THRESHOLDS.minTextareaHeight, `${label} textarea lost useful height: ${JSON.stringify(metrics.textareaRect)}`);
  const maxContextHeight = LAYOUT_THRESHOLDS.maxContextHeight;
  assert(metrics.contextHeight <= maxContextHeight, `${label} active editor context dominates composer: ${metrics.contextHeight}, maxContextHeight=${maxContextHeight}`);
  assert(metrics.composerAfterScroll, `${label} composer does not follow chat scroll region in DOM order`);
  const hostThresholds = LAYOUT_THRESHOLDS.hosts[host];
  assert(hostThresholds, `${label} has no layout thresholds for host: ${host}`);
  const minComposerLowerOffset = hostThresholds.minComposerLowerOffset;
  assert(metrics.composerTop - metrics.scrollTop > minComposerLowerOffset, `${label} composer is not placed in the lower chat area: scrollTop=${metrics.scrollTop}, scrollHeight=${metrics.chatScrollHeight}, composerTop=${metrics.composerTop}, minComposerLowerOffset=${minComposerLowerOffset}`);
  const maxComposerScrollGap = LAYOUT_THRESHOLDS.maxComposerControlStackGap;
  const maxComposerScrollOverlap = hostThresholds.maxComposerScrollOverlap;
  assert(metrics.composerScrollGap <= maxComposerScrollGap, `${label} controls between chat scroll and composer exceed the bounded stack: scrollBottom=${metrics.scrollBottom}, composerTop=${metrics.composerTop}, composerBottom=${metrics.composerBottom}, composerScrollGap=${metrics.composerScrollGap}, maxComposerControlStackGap=${maxComposerScrollGap}`);
  assert(metrics.composerScrollOverlap <= maxComposerScrollOverlap, `${label} composer overlaps chat scroll region too deeply: scrollBottom=${metrics.scrollBottom}, composerTop=${metrics.composerTop}, composerBottom=${metrics.composerBottom}, composerScrollOverlap=${metrics.composerScrollOverlap}, maxComposerScrollOverlap=${maxComposerScrollOverlap}`);
  assertRequiredControlLayout(metrics, label);
}

function assertRequiredControlLayout(metrics, label) {
  for (const control of ["projectContext", "lifecycle", "textarea", "send", "stop"]) {
    const state = metrics.requiredControls[control];
    assert(state?.visible && state.withinViewport, `${label} ${control} is clipped or outside the viewport: ${JSON.stringify(state)}`);
  }
  if (metrics.requiredControls.fallback.present) {
    assert(metrics.requiredControls.fallback.visible && metrics.requiredControls.fallback.withinViewport, `${label} manual fallback is clipped: ${JSON.stringify(metrics.requiredControls.fallback)}`);
  }
  assert(metrics.requiredControls.send.rect.height >= LAYOUT_THRESHOLDS.minControlHeight, `${label} Send hit target is too short`);
  assert(metrics.requiredControls.stop.rect.height >= LAYOUT_THRESHOLDS.minControlHeight, `${label} Stop hit target is too short`);
  assert(metrics.requiredControls.fallback.present === false || metrics.requiredControls.fallback.rect.height >= LAYOUT_THRESHOLDS.minControlHeight, `${label} manual fallback hit target is too short`);
  assert(metrics.requiredControls.send.hitTarget, `${label} Send center is not hit-testable`);
  assert(metrics.requiredControls.stop.hitTarget, `${label} Stop center is not hit-testable`);
  assert(metrics.requiredControls.fallback.present === false || metrics.requiredControls.fallback.hitTarget, `${label} manual fallback center is not hit-testable`);
  assert(metrics.requiredControlOverlaps.length === 0, `${label} required controls overlap: ${JSON.stringify(metrics.requiredControlOverlaps)}`);
}

async function waitForActiveSelectedContext(page) {
  return page.waitForFunction(() => {
    const details = document.querySelector("[data-testid='attached-context-active-details']");
    if (!(details instanceof HTMLElement)) return false;
    const text = details.innerText.replace(/\s+/g, " ");
    const normalizedText = text.toLowerCase();
    return normalizedText.includes("active editor context") && normalizedText.includes("attach to next message") && text.includes("src/plugin-layout.ts") && text.includes("10:2-10:40");
  }, undefined, { timeout: 10_000 }).then(() => true).catch(() => false);
}

async function openComposerDrawer(page, testId, viewportName) {
  const drawer = page.locator(`[data-testid='${testId}']`).first();
  const attached = await drawer.waitFor({ state: "attached", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!attached) await failViewport(page, viewportName, `${testId} drawer did not attach`);
  const summary = drawer.locator(":scope > summary").first();
  const summaryVisible = await summary.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  if (!summaryVisible) await failViewport(page, viewportName, `${testId} drawer summary did not become visible`, await drawerStateSnapshot(drawer));
  const open = await drawer.evaluate((element) => element instanceof HTMLDetailsElement && element.open).catch(() => false);
  if (!open) {
    await clickComposerDrawerSummary(page, drawer, summary, testId, viewportName, "open");
  }
  const body = drawer.locator(":scope > .composer-drawer-body").first();
  const bodyVisible = await body.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!bodyVisible) await failViewport(page, viewportName, `${testId} drawer body did not become visible after summary click`, await drawerStateSnapshot(drawer));
  await body.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    const tools = element.closest(".composer-tools");
    if (tools instanceof HTMLElement) {
      const toolsRect = tools.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      tools.scrollTop += elementRect.top - toolsRect.top - Math.max(0, (tools.clientHeight - elementRect.height) / 2);
      return;
    }
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
  }).catch(() => undefined);
}

async function closeComposerDrawer(page, testId, viewportName) {
  const drawer = page.locator(`[data-testid='${testId}']`).first();
  const attached = await drawer.waitFor({ state: "attached", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!attached) await failViewport(page, viewportName, `${testId} drawer did not attach for close`);
  const open = await drawer.evaluate((element) => element instanceof HTMLDetailsElement && element.open).catch(() => false);
  if (!open) return;
  const summary = drawer.locator(":scope > summary").first();
  const summaryVisible = await summary.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  if (!summaryVisible) await failViewport(page, viewportName, `${testId} drawer summary did not become visible for close`, await drawerStateSnapshot(drawer));
  await clickComposerDrawerSummary(page, drawer, summary, testId, viewportName, "close");
  const closed = await drawer.evaluate((element) => element instanceof HTMLDetailsElement && !element.open).catch(() => false);
  if (!closed) await failViewport(page, viewportName, `${testId} drawer did not close after summary click`, await drawerStateSnapshot(drawer));
}

async function exerciseComposerDrawerIfPresent(page, testId, viewportName) {
  if (await page.locator(`[data-testid='${testId}']`).count() === 0) return;
  await openComposerDrawer(page, testId, viewportName);
  await closeComposerDrawer(page, testId, viewportName);
}

async function clickComposerDrawerSummary(page, drawer, summary, testId, viewportName, action) {
  await summary.scrollIntoViewIfNeeded({ timeout: 5000 });
  const safePoint = await findTopmostVisiblePoint(summary);
  if (!safePoint.ok || !safePoint.position) {
    await failViewport(page, viewportName, `${testId} drawer summary has no topmost visible point for ${action}`, {
      safePoint,
      drawer: await drawerStateSnapshot(drawer),
    });
  }
  await summary.click({ position: safePoint.position, timeout: 5000 }).catch(async (error) => {
    await failViewport(page, viewportName, `${testId} drawer summary ${action} click failed: ${error instanceof Error ? error.message : String(error)}`, {
      safePoint,
      drawer: await drawerStateSnapshot(drawer),
    });
  });
}

async function findTopmostVisiblePoint(locator) {
  const sampled = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, reason: "not an HTMLElement" };
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    let visible = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(window.innerWidth, rect.right),
      bottom: Math.min(window.innerHeight, rect.bottom),
    };
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const ancestorStyle = window.getComputedStyle(ancestor);
      const clipsX = ancestorStyle.overflowX !== "visible";
      const clipsY = ancestorStyle.overflowY !== "visible";
      if (!clipsX && !clipsY) continue;
      const ancestorRect = ancestor.getBoundingClientRect();
      if (clipsX) {
        visible.left = Math.max(visible.left, ancestorRect.left);
        visible.right = Math.min(visible.right, ancestorRect.right);
      }
      if (clipsY) {
        visible.top = Math.max(visible.top, ancestorRect.top);
        visible.bottom = Math.min(visible.bottom, ancestorRect.bottom);
      }
    }
    const width = visible.right - visible.left;
    const height = visible.bottom - visible.top;
    const inset = Math.min(4, Math.max(0, width / 4), Math.max(0, height / 4));
    const xs = [visible.left + inset, visible.left + width / 2, visible.right - inset];
    const ys = [visible.top + inset, visible.top + height / 2, visible.bottom - inset];
    const candidates = [];
    for (const y of ys) {
      for (const x of xs) {
        const top = document.elementFromPoint(x, y);
        candidates.push({
          x,
          y,
          hit: top === element || element.contains(top),
          topTag: top?.tagName,
          topText: top?.textContent?.trim().slice(0, 80),
        });
      }
    }
    const safe = candidates.find((candidate) => candidate.hit);
    const visibleStyle = style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
    return {
      position: safe ? { x: safe.x - rect.left, y: safe.y - rect.top } : null,
      rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      visible,
      visibleStyle,
      visibility: style.visibility,
      display: style.display,
      pointerEvents: style.pointerEvents,
      candidates,
    };
  }).catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error), position: null }));
  if (!sampled.rect || !sampled.visible) return sampled;
  const visibleArea = assessDrawerSummaryVisibleArea(sampled.rect, sampled.visible);
  const ok = Boolean(sampled.position && sampled.visibleStyle && visibleArea.ok);
  return {
    ...sampled,
    ok,
    reason: !visibleArea.ok
      ? "visible summary area is too small"
      : sampled.position
        ? undefined
        : "no sampled point hit the summary or its descendant",
    visibleArea,
  };
}

function assessDrawerSummaryVisibleArea(rect, visible) {
  const visibleWidth = Math.max(0, visible.right - visible.left);
  const visibleHeight = Math.max(0, visible.bottom - visible.top);
  const fullArea = Math.max(0, rect.width) * Math.max(0, rect.height);
  const visibleArea = visibleWidth * visibleHeight;
  const coverage = fullArea > 0 ? Math.min(1, visibleArea / fullArea) : 0;
  return {
    ok: visibleWidth >= DRAWER_SUMMARY_VISIBLE_AREA.minWidth
      && visibleHeight >= DRAWER_SUMMARY_VISIBLE_AREA.minHeight
      && coverage >= DRAWER_SUMMARY_VISIBLE_AREA.minCoverage,
    visibleWidth,
    visibleHeight,
    coverage,
    thresholds: DRAWER_SUMMARY_VISIBLE_AREA,
  };
}

function verifyDrawerSummaryVisibleAreaContract() {
  const rect = { width: 240, height: 40 };
  const fullyVisible = assessDrawerSummaryVisibleArea(rect, { left: 0, top: 0, right: 240, bottom: 40 });
  const meaningfullyClipped = assessDrawerSummaryVisibleArea(rect, { left: 24, top: 8, right: 216, bottom: 36 });
  const tinyStrip = assessDrawerSummaryVisibleArea(rect, { left: 0, top: 38, right: 240, bottom: 40 });
  if (!fullyVisible.ok || !meaningfullyClipped.ok || tinyStrip.ok) {
    throw new Error(`Plugin layout drawer-summary visible-area self-check failed: ${JSON.stringify({ fullyVisible, meaningfullyClipped, tinyStrip })}`);
  }
}

async function drawerStateSnapshot(drawer) {
  return drawer.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, reason: "not an HTMLElement" };
    const summary = element.querySelector(":scope > summary");
    const body = element.querySelector(":scope > .composer-drawer-body");
    return {
      open: element instanceof HTMLDetailsElement ? element.open : null,
      drawer: elementState(element),
      summary: summary instanceof HTMLElement ? elementState(summary) : null,
      body: body instanceof HTMLElement ? elementState(body) : null,
      bodyText: body instanceof HTMLElement ? body.innerText.replace(/\s+/g, " ").slice(0, 500) : null,
    };
    function elementState(target) {
      const rect = target.getBoundingClientRect();
      const style = window.getComputedStyle(target);
      return {
        visible: style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0,
        rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        visibility: style.visibility,
        display: style.display,
        pointerEvents: style.pointerEvents,
      };
    }
  }).catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
}

async function requireVisibleDisabledButton(page, locator, label, viewportName) {
  const visible = await locator.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  if (!visible) await failViewport(page, viewportName, `${label} did not become visible`);
  const disabled = await locator.isDisabled({ timeout: 5000 }).catch(() => false);
  if (!disabled) await failViewport(page, viewportName, `${label} was enabled before selected context was attached`, await buttonStateSnapshot(locator));
  await locator.scrollIntoViewIfNeeded();
  const visibleHitTarget = await describeVisibleHitTarget(locator);
  if (!visibleHitTarget.ok) await failViewport(page, viewportName, `${label} is not visibly hit-testable while disabled`, visibleHitTarget);
  return { ok: true, label, reason: "visible disabled", visibleHitTarget };
}

async function buttonStateSnapshot(locator) {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, reason: "not an HTMLElement" };
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      disabled: element.hasAttribute("disabled"),
      ariaDisabled: element.getAttribute("aria-disabled"),
      rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      visibility: style.visibility,
      display: style.display,
      pointerEvents: style.pointerEvents,
    };
  }).catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
}

async function describeVisibleHitTarget(locator) {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, reason: "not an HTMLElement" };
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    return {
      ok: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none" && (top === element || element.contains(top)),
      rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      visibility: style.visibility,
      display: style.display,
      pointerEvents: style.pointerEvents,
      disabled: element.hasAttribute("disabled"),
      topTag: top?.tagName,
      topText: top?.textContent?.trim().slice(0, 80),
    };
  }).catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
}

async function requireActionableButton(page, locator, label, viewportName) {
  const result = await buttonActionability(locator, label);
  if (!result.ok) await failViewport(page, viewportName, `${label} ${result.reason}`, result);
  return result;
}

async function buttonActionability(locator, label) {
  const visible = await locator.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  if (!visible) return { ok: false, label, reason: "did not become visible" };
  const enabled = await locator.waitFor({ state: "attached", timeout: 1000 }).then(() => locator.isEnabled({ timeout: 5000 })).catch(() => false);
  if (!enabled) return { ok: false, label, reason: "stayed disabled" };
  await locator.scrollIntoViewIfNeeded();
  const actionable = await describeActionability(locator);
  if (!actionable.ok) return { ok: false, label, reason: "is not actionable/hit-testable", actionable };
  return { ok: true, label, reason: "ready", actionable };
}

async function clickActionableButton(page, locator, label, options = {}) {
  const viewportName = options.viewportName ?? label;
  const result = await buttonActionability(locator, label);
  if (!result.ok) await failViewport(page, viewportName, `${label} ${result.reason}`, result);
  try {
    await locator.click({ timeout: 5000 });
  } catch (error) {
    await failViewport(page, viewportName, `${label} Playwright click failed: ${error instanceof Error ? error.message : String(error)}`, result);
  }
}

async function failViewport(page, name, reason, actionability) {
  throw new Error(`${name} ${reason}: ${await contextDiagnostic(page, actionability)}`);
}

async function contextDiagnostic(page, actionability) {
  const diagnostic = await page.evaluate((actionabilityInput) => {
    const explainButton = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "Explain selection");
    const sendButton = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "Send");
    const context = document.querySelector("[data-testid='attached-context-active-details']") ?? document.querySelector("[data-testid='attached-context-compact-details']");
    const composer = document.querySelector("textarea[placeholder='Ask about the current file, selection, or project...']");
    const bridgePosts = Array.isArray(window.__yetAiBridgePosts) ? window.__yetAiBridgePosts.slice(-8) : [];
    return {
      hostClass: document.querySelector("main.app-shell")?.className ?? null,
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
      activeElement: elementSummary(document.activeElement),
      actionability: actionabilityInput ?? null,
      ideActionsDrawer: drawerState(document.querySelector("[data-testid='ide-actions-drawer']")),
      explainButton: buttonState(explainButton),
      sendButton: buttonState(sendButton),
      contextText: context instanceof HTMLElement ? context.innerText.replace(/\s+/g, " ").slice(0, 700) : null,
      composerValue: composer instanceof HTMLTextAreaElement ? composer.value.slice(0, 500) : null,
      composerState: composer instanceof HTMLTextAreaElement ? elementState(composer) : null,
      bridgePosts: bridgePosts.map((message) => ({ type: message?.type, version: message?.version, requestId: message?.requestId, payloadKeys: Object.keys(message?.payload ?? {}) })),
      bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 1200),
    };
    function elementSummary(element) {
      if (!(element instanceof HTMLElement)) return null;
      return { tag: element.tagName, text: element.innerText?.trim().slice(0, 120), className: String(element.className).slice(0, 160) };
    }
    function elementState(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        visible: style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0,
        disabled: element.hasAttribute("disabled"),
        ariaDisabled: element.getAttribute("aria-disabled"),
        rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      };
    }
    function buttonState(button) {
      if (!(button instanceof HTMLButtonElement)) return null;
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      return {
        text: button.innerText,
        disabled: button.disabled,
        ariaDisabled: button.getAttribute("aria-disabled"),
        title: button.title,
        visible: style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0,
        rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      };
    }
    function drawerState(drawer) {
      if (!(drawer instanceof HTMLElement)) return null;
      const summary = drawer.querySelector(":scope > summary");
      const body = drawer.querySelector(":scope > .composer-drawer-body");
      return {
        open: drawer instanceof HTMLDetailsElement ? drawer.open : null,
        summary: summary instanceof HTMLElement ? elementState(summary) : null,
        body: body instanceof HTMLElement ? elementState(body) : null,
        bodyText: body instanceof HTMLElement ? body.innerText.replace(/\s+/g, " ").slice(0, 500) : null,
      };
    }
  }, actionability ?? null);
  return sanitizeEvidenceText(JSON.stringify(diagnostic)).slice(0, 2200);
}

async function assertActionable(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  const actionable = await describeActionability(locator);
  assert(actionable.ok, `${label} is not actionable/hit-testable: ${JSON.stringify(actionable)}`);
  return actionable.ok;
}

async function describeActionability(locator) {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return { ok: false, reason: "not an HTMLElement" };
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    return {
      ok: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.pointerEvents !== "none" && !element.hasAttribute("disabled") && (top === element || element.contains(top)),
      rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      disabled: element.hasAttribute("disabled"),
      topTag: top?.tagName,
      topText: top?.textContent?.trim().slice(0, 80),
    };
  }).catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }));
}

async function collectLayoutMetrics(page, scenario) {
  return page.evaluate((scenarioInfo) => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
    };
    const withinViewport = (box) => Boolean(box && box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0 && box.bottom <= scenarioInfo.height && box.right <= scenarioInfo.width);
    const send = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Send");
    const textarea = document.querySelector("textarea[placeholder='Ask about the current file, selection, or project...']");
    const details = document.querySelector("[data-testid='attached-context-active-details']");
    const scrollElement = document.querySelector(".chat-scroll-region");
    const composerElement = document.querySelector(".chat-composer");
    const ideActionsDrawer = document.querySelector("[data-testid='ide-actions-drawer']");
    const projectContext = document.querySelector("[data-testid='project-context-entrypoint']");
    const lifecycle = document.querySelector("[data-testid='chat-lifecycle-status']");
    const stop = document.querySelector("[data-testid='chat-stop-response']");
    const fallback = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Send without project context");
    const scroll = rect(".chat-scroll-region");
    const composer = rect(".chat-composer");
    const context = rect(".attached-context-card");
    const sendRect = send instanceof HTMLElement ? rectForElement(send) : null;
    const textareaRect = textarea instanceof HTMLElement ? rectForElement(textarea) : null;
    const requiredElements = { projectContext, lifecycle, textarea, send, stop, fallback };
    const requiredControls = Object.fromEntries(Object.entries(requiredElements).map(([key, element]) => {
      const elementRect = element instanceof HTMLElement ? rectForElement(element) : null;
      const style = element instanceof HTMLElement ? getComputedStyle(element) : null;
      return [key, {
        present: element instanceof HTMLElement,
        visible: Boolean(elementRect && style && style.visibility !== "hidden" && style.display !== "none" && elementRect.width > 0 && elementRect.height > 0),
        withinViewport: withinViewport(elementRect),
        hitTarget: element instanceof HTMLButtonElement ? isHitTarget(element, elementRect) : null,
        rect: elementRect,
      }];
    }));
    const overlapKeys = Object.keys(requiredElements).filter((key) => requiredControls[key].present);
    const requiredControlOverlaps = [];
    for (let leftIndex = 0; leftIndex < overlapKeys.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < overlapKeys.length; rightIndex += 1) {
        const leftKey = overlapKeys[leftIndex];
        const rightKey = overlapKeys[rightIndex];
        if ((leftKey === "lifecycle" && rightKey === "stop") || (leftKey === "projectContext" && rightKey === "fallback")) continue;
        const leftRect = requiredControls[leftKey].rect;
        const rightRect = requiredControls[rightKey].rect;
        if (leftRect && rightRect && leftRect.left < rightRect.right && leftRect.right > rightRect.left && leftRect.top < rightRect.bottom && leftRect.bottom > rightRect.top) requiredControlOverlaps.push(`${leftKey}:${rightKey}`);
      }
    }
    return {
      ...scenarioInfo,
      bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
      heroState: heroState(document.querySelector(".hero")),
      routedProjectChat: document.querySelector("main.app-shell[data-project-page='chat']") instanceof HTMLElement
        && document.querySelector("[data-testid='project-chat-boundary']") instanceof HTMLElement,
      hostJetbrainsClass: document.querySelector("main.app-shell.host-jetbrains") instanceof HTMLElement,
      hostBrowserClass: document.querySelector("main.app-shell.host-browser") instanceof HTMLElement,
      ideActionsDrawerOpen: ideActionsDrawer instanceof HTMLDetailsElement ? ideActionsDrawer.open : null,
      sendVisible: send instanceof HTMLElement && getComputedStyle(send).visibility !== "hidden" && getComputedStyle(send).display !== "none" && sendRect !== null && sendRect.width > 0 && sendRect.height > 0,
      sendWithinViewport: withinViewport(sendRect),
      sendEnabled: send instanceof HTMLButtonElement && !send.disabled,
      sendRect,
      textareaVisible: textarea instanceof HTMLElement && getComputedStyle(textarea).visibility !== "hidden" && getComputedStyle(textarea).display !== "none" && textareaRect !== null && textareaRect.width > 0 && textareaRect.height > 0,
      textareaWithinViewport: withinViewport(textareaRect),
      textareaRect,
      chatScrollHeight: scroll?.height ?? 0,
      scrollTop: scroll?.top ?? 0,
      scrollBottom: scroll?.bottom ?? 0,
      composerHeight: composer?.height ?? 0,
      composerTop: composer?.top ?? 0,
      composerBottom: composer?.bottom ?? 0,
      composerScrollGap: scroll && composer ? Math.max(0, composer.top - scroll.bottom) : 0,
      composerScrollOverlap: scroll && composer ? Math.max(0, scroll.bottom - composer.top) : 0,
      composerLowerThanScrollTop: scroll && composer ? composer.top > scroll.top : false,
      composerAfterScroll: scrollElement instanceof HTMLElement && composerElement instanceof HTMLElement && Boolean(scrollElement.compareDocumentPosition(composerElement) & Node.DOCUMENT_POSITION_FOLLOWING),
      contextHeight: context?.height ?? 0,
      contextDetailsOpen: details instanceof HTMLDetailsElement ? details.open : null,
      projectContextExpanded: projectContext?.querySelector("button[aria-controls='project-chat-context-advanced']")?.getAttribute("aria-expanded") === "true",
      requiredControls,
      requiredControlOverlaps,
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
    };
    function rectForElement(element) {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
    }
    function isHitTarget(element, box) {
      if (!box) return false;
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top === element || element.contains(top);
    }
    function heroState(element) {
      if (!(element instanceof HTMLElement)) return "absent";
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || box.width === 0 || box.height === 0
        ? "hidden"
        : "visible";
    }
  }, scenario);
}

async function saveEvidence(page, name, metrics) {
  await mkdir(evidenceRoot, { recursive: true });
  const screenshotPath = path.join(evidenceRoot, `${name}.png`);
  const domPath = path.join(evidenceRoot, `${name}.dom.txt`);
  const metricsPath = path.join(evidenceRoot, `${name}.metrics.json`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const dom = await page.evaluate(() => document.body.innerText).then(sanitizeEvidenceText);
  await writeFile(domPath, dom, "utf8");
  await writeFile(metricsPath, `${JSON.stringify({ ...metrics, layoutContract: LAYOUT_CONTRACT }, null, 2)}\n`, "utf8");
  return { screenshotPath, domPath, metricsPath };
}

async function waitForGuiReady(page, name) {
  const ready = await page.waitForFunction(() => {
    if (!Array.isArray(window.__yetAiBridgePosts)) return undefined;
    const message = window.__yetAiBridgePosts.find((candidate) => candidate?.type === "gui.ready");
    return message ? { version: message.version, type: message.type, supportedBridgeVersion: message.payload?.supportedBridgeVersion } : undefined;
  }, undefined, { timeout: 5000 }).then((handle) => handle.jsonValue()).catch(() => undefined);
  if (!ready) throw new Error(`Missing ${name} GUI bridge ready post`);
  if (ready.version !== BRIDGE_VERSION || ready.type !== "gui.ready" || ready.supportedBridgeVersion !== BRIDGE_VERSION) {
    throw new Error(`${name} gui.ready did not match the supported bridge contract`);
  }
}

function createHostGeneration() {
  const requestId = `host-ready-${randomUUID().replaceAll("-", "")}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(requestId)) throw new Error("Generated invalid host readiness requestId");
  return requestId;
}

async function dispatchHostedWorkspaceAuthority(page, requestId) {
  await page.evaluate(({ version, requestId, readyPayload, bindingPayload }) => {
    window.dispatchEvent(new MessageEvent("message", { data: { version, type: "host.ready", requestId, payload: readyPayload } }));
    window.dispatchEvent(new MessageEvent("message", { data: { version, type: "host.workspaceBinding", requestId, payload: { ...bindingPayload, requestId } } }));
  }, {
    version: BRIDGE_VERSION,
    requestId,
    readyPayload: { runtimeUrl: `http://127.0.0.1:${runtimeServer.port}`, sessionToken: runtimeSessionValue, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
    bindingPayload: { protocolVersion: "workspace_binding_v1", state: "auto_bound", projectId: SMOKE_PROJECT_ID, displayName: SMOKE_PROJECT_DISPLAY_NAME },
  });
}

async function enterCurrentWorkspaceChat(page, name) {
  await page.getByText("Current Workspace Dashboard", { exact: true }).waitFor({ state: "attached", timeout: 10_000 })
    .catch(() => { throw new Error(`${name} did not render the authorized Current Workspace Dashboard`); });
  await page.getByText(SMOKE_PROJECT_DISPLAY_NAME, { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => { throw new Error(`${name} dashboard did not render the safe workspace display name`); });
  const composer = page.getByPlaceholder("Ask about the current file, selection, or project...");
  if (await composer.count() !== 0) throw new Error(`${name} dashboard mounted the composer before explicit Start new chat`);
  const startNew = page.getByRole("button", { name: "Start new chat", exact: true });
  await requireActionableButton(page, startNew, `${name} Start new chat button`, name);
  await startNew.click();
  await page.locator("main.app-shell[data-project-page='chat']").waitFor({ state: "visible", timeout: 10_000 });
  await composer.waitFor({ state: "visible", timeout: 10_000 })
    .catch(async () => { throw new Error(`${name} project chat lost the original pre-dashboard host authority after Start new chat: ${await contextDiagnostic(page)}`); });
}

async function injectActiveEditorContext(page, host, requestId) {
  await page.evaluate(({ source, requestId }) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: "2026-05-15",
        type: "host.contextSnapshot",
        requestId,
        payload: {
          kind: "active_editor",
          source,
          file: { displayPath: "src/plugin-layout.ts", workspaceRelativePath: "src/plugin-layout.ts", languageId: "typescript" },
          selection: { startLine: 10, startCharacter: 2, endLine: 10, endCharacter: 40, text: "function add(a, b) { return a + b; }" },
        },
      },
    }));
  }, { source: host, requestId });
}

async function requireBuiltGui() {
  try {
    const fileStat = await stat(indexPath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const html = await readFile(indexPath, "utf8");
    if (!html.includes("/assets/") && !html.includes("./assets/")) throw new Error("built GUI index.html does not reference Vite assets");
  } catch (error) {
    console.error("Plugin layout smoke failed: built GUI is missing or invalid.");
    console.error("Run `cd apps/gui && npm run build` before `npm run smoke:plugin-layout`.");
    console.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function requireChromium() {
  try { return await import("playwright"); } catch (error) {
    console.error("Plugin layout smoke failed: Playwright is not installed or cannot be loaded.");
    console.error(`Load error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function startStaticServer(staticRoot) {
  const server = http.createServer(async (request, response) => {
    const rawPath = rawRequestPath(request.url);
    const spaEntry = isStrictHostedEntryPath(rawPath);
    const pathname = staticRequestPath(hostedRelativeAssetPath(rawPath) ?? rawPath);
    if (pathname === null) return response.writeHead(403).end("Forbidden");
    const requestedPath = spaEntry ? path.join(staticRoot, "index.html") : path.resolve(staticRoot, `.${pathname}`);
    if (!requestedPath.startsWith(staticRoot + path.sep) && requestedPath !== staticRoot) return response.writeHead(403).end("Forbidden");
    try {
      const fileStat = await stat(requestedPath);
      if (!fileStat.isFile()) return response.writeHead(404).end("Not found");
      response.writeHead(200, { "content-type": contentType(requestedPath) });
      createReadStream(requestedPath).pipe(response);
    } catch { response.writeHead(404).end("Not found"); }
  });
  return listen(server);
}

function rawRequestPath(requestTarget) {
  const target = requestTarget ?? "/";
  const queryIndex = target.indexOf("?");
  return queryIndex < 0 ? target : target.slice(0, queryIndex);
}

function isStrictHostedEntryPath(rawPath) {
  return rawPath === "/vscode/hosted-chat" || rawPath === `/panel/${JETBRAINS_SMOKE_PANEL_ID}/hosted-chat`;
}

function hostedRelativeAssetPath(rawPath) {
  const jetbrainsAssetPrefix = `/panel/${JETBRAINS_SMOKE_PANEL_ID}/assets/`;
  const match = /^\/vscode\/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(rawPath)
    ?? (rawPath.startsWith(jetbrainsAssetPrefix)
      ? /^([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(rawPath.slice(jetbrainsAssetPrefix.length))
      : null);
  return match ? `/assets/${match[1]}` : null;
}

function staticRequestPath(rawPath) {
  if (!rawPath.startsWith("/") || rawPath.includes("\\")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return decoded === "/" ? "/index.html" : decoded;
}

async function verifyStaticServerContract(port) {
  const indexHtml = await readFile(indexPath, "utf8");
  const assetPath = /(?:src|href)=(?:"|')\.\/(assets\/[^"']+)/.exec(indexHtml)?.[1];
  if (!assetPath) throw new Error("Plugin layout smoke server self-check failed: built entry has no relative asset reference.");
  const validHostedPaths = ["/vscode/hosted-chat", `/panel/${JETBRAINS_SMOKE_PANEL_ID}/hosted-chat`];
  const rejectedHostedPaths = [
    "/vscode%2fhosted-chat",
    "/vscode\\hosted-chat",
    `/panel/${JETBRAINS_SMOKE_PANEL_ID}%2fhosted-chat`,
    `/panel/${JETBRAINS_SMOKE_PANEL_ID}/%68osted-chat`,
    `/panel/${JETBRAINS_SMOKE_PANEL_ID}/../hosted-chat`,
    "/panel//hosted-chat",
    "/panel/bad.id/hosted-chat",
    "/panel/plugin-layout-other/hosted-chat",
    "/panel/valid/hosted-chat/extra",
  ];
  for (const requestPath of validHostedPaths) {
    const result = await requestStaticServer(port, requestPath);
    if (result.status !== 200 || !result.contentType.startsWith("text/html") || result.body !== indexHtml) {
      throw new Error(`Plugin layout smoke server self-check failed for valid hosted entry: ${sanitizeEvidenceText(requestPath)}`);
    }
  }
  for (const requestPath of rejectedHostedPaths) {
    const result = await requestStaticServer(port, requestPath);
    if (result.status === 200 && result.contentType.startsWith("text/html")) {
      throw new Error(`Plugin layout smoke server self-check accepted malformed hosted entry: ${sanitizeEvidenceText(requestPath)}`);
    }
  }
  const hostedAssetPaths = [
    `/vscode/${assetPath}`,
    `/panel/${JETBRAINS_SMOKE_PANEL_ID}/${assetPath}`,
  ];
  for (const requestPath of hostedAssetPaths) {
    const result = await requestStaticServer(port, requestPath);
    if (result.status !== 200 || result.contentType.startsWith("text/html") || result.body.length === 0) {
      throw new Error(`Plugin layout smoke server self-check failed for hosted-relative asset: ${sanitizeEvidenceText(requestPath)}`);
    }
  }
  const rejectedHostedAssetPaths = [
    `/vscode/assets/../${path.basename(assetPath)}`,
    `/vscode/assets/%2e%2e/${path.basename(assetPath)}`,
    `/panel/bad.id/${assetPath}`,
    `/panel/plugin-layout-other/${assetPath}`,
    `/panel/${JETBRAINS_SMOKE_PANEL_ID}/assets/nested/${path.basename(assetPath)}`,
  ];
  for (const requestPath of rejectedHostedAssetPaths) {
    const result = await requestStaticServer(port, requestPath);
    if (result.status === 200) {
      throw new Error(`Plugin layout smoke server self-check accepted malformed hosted-relative asset: ${sanitizeEvidenceText(requestPath)}`);
    }
  }
  const assetResult = await requestStaticServer(port, `/${assetPath}`);
  if (assetResult.status !== 200 || assetResult.contentType === "text/html; charset=utf-8" || assetResult.body.length === 0) {
    throw new Error("Plugin layout smoke server self-check failed for a regular built asset.");
  }
  console.log("Plugin layout smoke server contract passed: strict raw hosted routes and hosted-relative assets verified.");
}

function requestStaticServer(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: requestPath }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        contentType: String(response.headers["content-type"] ?? ""),
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
  });
}

async function startRuntimeServer() {
  const chats = new Map([["chat-001", { chatId: "chat-001", title: "Plugin layout smoke", createdAt: now(), updatedAt: now(), messages: [] }]]);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const projectPrefix = `/p/${SMOKE_PROJECT_ID}`;
    const scoped = url.pathname.startsWith(`${projectPrefix}/v1/`);
    const runtimePath = scoped ? url.pathname.slice(projectPrefix.length) : url.pathname;
    if (request.method === "OPTIONS") return empty(response, 204);
    if (isProjectOwnedRuntimePath(url.pathname) && !scoped) {
      failures.push(`mock runtime rejected project-owned request outside ${projectPrefix}: ${request.method ?? "GET"} ${url.pathname}`);
      return json(response, 404, { error: "Project-owned runtime request must use the current project scope." });
    }
    if (request.method === "GET" && runtimePath === "/v1/ping") return json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: now() });
    if (request.method === "GET" && runtimePath === "/v1/caps") return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
    if (request.method === "GET" && runtimePath === "/v1/demo-mode") return json(response, 200, { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Local canned responses." });
    if (request.method === "GET" && runtimePath === "/v1/models") return json(response, 200, { models: [demoModel()] });
    if (request.method === "GET" && runtimePath === "/v1/providers") return json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && runtimePath === "/v1/provider-auth/openai/status") return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "No account login." });
    if (request.method === "GET" && runtimePath === "/v1/project-memory") return json(response, 200, { notes: [], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && runtimePath === "/v1/context/status") return json(response, 200, { protocolVersion: "2026-08-02", schemaVersion: 1, projectId: SMOKE_PROJECT_ID, state: "ready", inventoryGeneration: 1, cloudRequired: false, providerAccess: "direct" });
    if (request.method === "POST" && runtimePath === "/v1/context/plan") {
      const body = JSON.parse(await readBody(request));
      const gate = contextPlanGate;
      if (gate) {
        contextPlanGate = null;
        gate.started.resolve();
        await gate.released.promise;
      }
      return json(response, 200, contextPlan(body));
    }
    if (request.method === "GET" && url.pathname === "/v1/projects") return json(response, 200, { projects: [{ projectId: SMOKE_PROJECT_ID, displayName: SMOKE_PROJECT_DISPLAY_NAME, status: "available", revision: "1", createdAt: now(), lastOpenedAt: now(), rootAvailable: true, cloudRequired: false, providerAccess: "direct" }], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === `/v1/projects/${SMOKE_PROJECT_ID}`) return json(response, 200, { projectId: SMOKE_PROJECT_ID, displayName: SMOKE_PROJECT_DISPLAY_NAME, status: "available", revision: "1", createdAt: now(), lastOpenedAt: now(), rootAvailable: true, cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && runtimePath === "/v1/agent-progress") return json(response, 200, { snapshots: [], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "POST" && runtimePath === "/v1/chats") return json(response, 201, chats.get("chat-001"));
    if (request.method === "GET" && runtimePath === "/v1/chats") return json(response, 200, { chats: Array.from(chats.values()).map((chat) => ({ chatId: chat.chatId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length })) });
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(runtimePath);
    if (chatMatch && request.method === "GET") return json(response, 200, chats.get(decodeURIComponent(chatMatch[1])) ?? chats.get("chat-001"));
    if (request.method === "GET" && runtimePath === "/v1/chats/subscribe") return sse(response, chats.get(url.searchParams.get("chat_id") ?? "chat-001") ?? chats.get("chat-001"));
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(runtimePath);
    if (commandMatch && request.method === "POST") {
      const chatId = decodeURIComponent(commandMatch[1]);
      const body = JSON.parse(await readBody(request));
      const chat = chats.get(chatId) ?? { chatId, title: chatId, createdAt: now(), updatedAt: now(), messages: [] };
      chatCommandCount += 1;
      chat.messages.push({ id: `user-${chat.messages.length}`, role: "user", content: body.payload?.content ?? "", createdAt: now(), status: "complete" });
      chat.messages.push({ id: `assistant-${chat.messages.length}`, role: "assistant", content: "Plugin layout canned response from local smoke runtime.", createdAt: now(), status: "complete" });
      chat.updatedAt = now();
      chats.set(chatId, chat);
      pushSse(chatId, { seq: chat.messages.length, type: "message_added", chatId, payload: { message: chat.messages.at(-1) } });
      return json(response, 200, { accepted: true, chatId, requestId: body.requestId ?? "request-001", type: body.type });
    }
    response.writeHead(404, { "content-type": "application/json", ...corsHeaders() }).end(JSON.stringify({ error: "not found" }));
  });
  return listen(server);
}

function isProjectOwnedRuntimePath(pathname) {
  const unscopedPath = /^\/v1\/(?:chats(?:\/|$)|project-memory(?:\/|$)|agent-progress(?:\/|$))/.test(pathname);
  const projectPath = /^\/p\/[^/]+\/v1\/(?:chats(?:\/|$)|project-memory(?:\/|$)|agent-progress(?:\/|$))/.test(pathname);
  return unscopedPath || projectPath;
}

async function readBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8") || "{}"; }
function sse(response, chat) { response.writeHead(200, corsHeaders({ "content-type": "text/event-stream", "cache-control": "no-cache" })); response.write(`event: snapshot\ndata: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: chat.chatId, payload: { thread: chat, messages: chat.messages, runtime: { streaming: false, waitingForResponse: false } } })}\n\n`); const chatSubscribers = subscribers.get(chat.chatId) ?? new Set(); chatSubscribers.add(response); subscribers.set(chat.chatId, chatSubscribers); response.on("close", () => chatSubscribers.delete(response)); }
function pushSse(chatId, event) { for (const response of subscribers.get(chatId) ?? []) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }
function demoModel() { return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function demoProvider() { return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
function holdNextContextPlan(label) {
  if (contextPlanGate) throw new Error(`Cannot hold ${label} context planning while another plan gate is armed.`);
  const started = deferred();
  const released = deferred();
  contextPlanGate = { started, released };
  let didRelease = false;
  return {
    waitForRequest: async () => {
      let timeout;
      try {
        await Promise.race([
          started.promise,
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label} context planning request did not reach the held mock endpoint`)), 5000); }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    },
    release: () => {
      if (didRelease) return;
      didRelease = true;
      if (contextPlanGate?.started === started) contextPlanGate = null;
      released.resolve();
    },
  };
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function contextPlan(body) { const hash = `sha256:${"a".repeat(64)}`; return { protocolVersion: "2026-08-02", schemaVersion: 1, planId: "plugin-layout-plan", projectId: SMOKE_PROJECT_ID, mode: body.mode ?? "balanced", queryLabel: "Compact layout prompt", status: "ready", manifest: { protocolVersion: "2026-08-02", schemaVersion: 1, manifestId: `plugin-layout-manifest-${randomUUID()}`, projectId: SMOKE_PROJECT_ID, planId: "plugin-layout-plan", mode: body.mode ?? "balanced", inventoryGeneration: 1, queryHash: hash, rankingVersion: "layout-smoke", budget: { maxFiles: 12, maxChunks: 32, maxBytes: 131072, maxEstimatedTokens: 24000, usedFiles: 1, usedChunks: 1, usedBytes: 32, usedEstimatedTokens: 8, truncated: false }, entries: [{ kind: "file_chunk", chunkId: "layout-chunk", sourceRef: "src/plugin-layout.ts", range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, contentHash: hash, inclusionReason: "lexical_match", provenance: "lexical", redaction: "none", byteCount: 32, estimatedTokens: 8, rank: 1 }], omissions: [], redaction: { metadataOnlyCount: 0, contentRedactedCount: 0, omittedCount: 0 }, createdAt: now() }, createdAt: now(), expiresAt: "2026-05-29T07:21:30Z", cloudRequired: false }; }
async function listen(server) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port."); return { port: address.port, close: () => new Promise((resolve) => server.close(resolve)) }; }
async function expectVisibleText(page, text, label, timeout = 20_000) { const visible = await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false); assert(visible, `Missing visible ${label}: ${text}`); }
async function expectComposerValue(page, text, label) { const ok = await page.getByPlaceholder("Ask about the current file, selection, or project...").evaluate((element, expected) => element instanceof HTMLTextAreaElement && element.value.includes(expected), text).catch(() => false); assert(ok, `Missing ${label} in composer: ${text}`); }
function sanitizeEvidenceText(text) { return text.replaceAll(runtimeSessionValue, "[redacted-runtime-token]").replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]").replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]").replace(/[A-Z]:\\[^\s)]+/g, "[redacted-absolute-path]").replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]"); }
function empty(response, status) { response.writeHead(status, corsHeaders()); response.end(); }
function json(response, status, payload) { response.writeHead(status, corsHeaders({ "content-type": "application/json" })); response.end(JSON.stringify(payload)); }
function corsHeaders(extra = {}) { return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-yet-ai-caller", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", ...extra }; }
function contentType(filePath) { if (filePath.endsWith(".html")) return "text/html; charset=utf-8"; if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8"; if (filePath.endsWith(".css")) return "text/css; charset=utf-8"; if (filePath.endsWith(".svg")) return "image/svg+xml"; return "application/octet-stream"; }
function now() { return "2026-05-29T07:16:30Z"; }
function assert(condition, message) { if (!condition) failures.push(message); }
