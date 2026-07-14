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
let guiServer;
let runtimeServer;
let browser;
let chatCommandCount = 0;
const subscribers = new Map();

await requireBuiltGui();
const { chromium } = await requireChromium();

try {
  guiServer = await startStaticServer(distRoot);
  runtimeServer = await startRuntimeServer();
  browser = await chromium.launch({ headless: true });

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
  page.on("pageerror", (error) => failures.push(`${name} page JavaScript error: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:")) failures.push(`${name} non-loopback request attempted: ${url}`);
  });
  await page.addInitScript((bridgeHost) => {
    window.__yetAiBridgePosts = [];
    if (bridgeHost === "vscode") {
      window.acquireVsCodeApi = () => ({ postMessage: (message) => window.__yetAiBridgePosts.push(message) });
    } else if (bridgeHost === "jetbrains") {
      window.postIntellijMessage = (message) => window.__yetAiBridgePosts.push(message);
    }
  }, host);
  await page.goto(`http://127.0.0.1:${guiServer.port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await waitForGuiReady(page, name);
  await dispatchHostReady(page);
  await page.waitForFunction(() => document.body.innerText.includes("ready to chat") || document.body.innerText.includes("Ready to send"), undefined, { timeout: 20_000 }).catch(() => failures.push(`Missing ${name} runtime ready state`));
  await page.waitForFunction(() => document.querySelector(".chat-scroll-region"), undefined, { timeout: 10_000 }).catch(() => failures.push(`Missing ${name} chat scroll region`));
  await openComposerDrawer(page, "ide-actions-drawer", name);
  const explainSelectionButton = page.getByRole("button", { name: "Explain selection", exact: true });
  await requireVisibleDisabledButton(page, explainSelectionButton, `${name} Explain selection button before context`, name);
  await assertActionable(page.getByRole("button", { name: "Send", exact: true }), `${name} Send button before context`);
  await injectActiveEditorContext(page, host);
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

  await clickActionableButton(page, explainSelectionButton, `${name} Explain selection button`, { viewportName: name, controlLabel: "Explain selection" });
  await expectComposerValue(page, "Explain the selected code", `${name} Coding Actions prompt`);
  await closeComposerDrawer(page, "ide-actions-drawer", name);
  await clickActionableButton(page, page.getByRole("button", { name: "Send", exact: true }), `${name} Send button after Coding Actions prompt`, { viewportName: name, controlLabel: "Send" });
  await expectVisibleText(page, "Explain the selected code", `${name} sent coding-action prompt`);

  const textarea = page.getByPlaceholder("Ask about the current file, selection, or project...");
  await textarea.fill(`Follow-up from ${name}`);
  await clickActionableButton(page, page.getByRole("button", { name: "Send", exact: true }), `${name} Send button after follow-up prompt`, { viewportName: name, controlLabel: "Send" });
  await expectVisibleText(page, `Follow-up from ${name}`, `${name} user follow-up`);

  const metrics = await collectLayoutMetrics(page, { width, height, name, host });
  assert(metrics.heroHidden, `${name} hosted hero is visible`);
  assert(host !== "jetbrains" || metrics.hostJetbrainsClass, `${name} did not render main.app-shell.host-jetbrains`);
  assert(host !== "jetbrains" || !metrics.hostBrowserClass, `${name} incorrectly kept host-browser class in JetBrains scenario`);
  assert(metrics.sendVisible && metrics.sendWithinViewport && metrics.sendEnabled, `${name} Send is not visible/enabled within viewport: ${JSON.stringify(metrics.sendRect)}`);
  assert(metrics.textareaVisible && metrics.textareaWithinViewport, `${name} textarea is not visible within viewport: ${JSON.stringify(metrics.textareaRect)}`);
  assert(metrics.chatScrollHeight >= 160, `${name} chat-scroll-region too short: ${metrics.chatScrollHeight}`);
  assert(metrics.composerHeight <= 240, `${name} composer too tall: ${metrics.composerHeight}`);
  assert(metrics.composerBottom <= height + 1, `${name} composer extends below viewport: ${metrics.composerBottom} > ${height}`);
  assert(metrics.contextDetailsOpen === false || metrics.contextDetailsOpen === null, `${name} active editor context details should be collapsed`);
  assert(metrics.contextHeight <= 96, `${name} active editor context dominates composer: ${metrics.contextHeight}`);
  assert(metrics.composerAfterScroll, `${name} composer does not follow chat scroll region in DOM order`);
  assert(metrics.composerLowerThanScrollTop, `${name} composer is not placed in the lower chat area: scrollTop=${metrics.scrollTop}, scrollHeight=${metrics.chatScrollHeight}, composerTop=${metrics.composerTop}`);
  assert(metrics.composerScrollGap >= -1 || metrics.composerStickyOverlap <= 32, `${name} composer overlaps chat scroll region too deeply: scrollBottom=${metrics.scrollBottom}, composerTop=${metrics.composerTop}, composerBottom=${metrics.composerBottom}, gap=${metrics.composerScrollGap}, stickyOverlap=${metrics.composerStickyOverlap}`);
  assert(metrics.composerScrollGap <= 32 || metrics.composerStickyOverlap <= 32, `${name} composer detached from chat scroll region: scrollBottom=${metrics.scrollBottom}, composerTop=${metrics.composerTop}, composerBottom=${metrics.composerBottom}, gap=${metrics.composerScrollGap}, stickyOverlap=${metrics.composerStickyOverlap}`);

  return saveEvidence(page, name, metrics);
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
    await summary.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
    await summary.click({ timeout: 5000 }).catch(async (error) => {
      await failViewport(page, viewportName, `${testId} drawer summary click failed: ${error instanceof Error ? error.message : String(error)}`, await drawerStateSnapshot(drawer));
    });
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
  await summary.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await summary.click({ timeout: 5000 }).catch(async (error) => {
    await failViewport(page, viewportName, `${testId} drawer summary close click failed: ${error instanceof Error ? error.message : String(error)}`, await drawerStateSnapshot(drawer));
  });
  const closed = await drawer.evaluate((element) => element instanceof HTMLDetailsElement && !element.open).catch(() => false);
  if (!closed) await failViewport(page, viewportName, `${testId} drawer did not close after summary click`, await drawerStateSnapshot(drawer));
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
    const scroll = rect(".chat-scroll-region");
    const composer = rect(".chat-composer");
    const context = rect(".attached-context-card");
    const sendRect = send instanceof HTMLElement ? rectForElement(send) : null;
    const textareaRect = textarea instanceof HTMLElement ? rectForElement(textarea) : null;
    return {
      ...scenarioInfo,
      bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
      heroHidden: document.querySelector(".hero") instanceof HTMLElement && getComputedStyle(document.querySelector(".hero")).display === "none",
      hostJetbrainsClass: document.querySelector("main.app-shell.host-jetbrains") instanceof HTMLElement,
      hostBrowserClass: document.querySelector("main.app-shell.host-browser") instanceof HTMLElement,
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
      composerScrollGap: scroll && composer ? composer.top - scroll.bottom : 0,
      composerStickyOverlap: scroll && composer ? Math.max(0, scroll.bottom - composer.bottom) : 0,
      composerLowerThanScrollTop: scroll && composer ? composer.top > scroll.top : false,
      composerAfterScroll: scrollElement instanceof HTMLElement && composerElement instanceof HTMLElement && Boolean(scrollElement.compareDocumentPosition(composerElement) & Node.DOCUMENT_POSITION_FOLLOWING),
      contextHeight: context?.height ?? 0,
      contextDetailsOpen: details instanceof HTMLDetailsElement ? details.open : null,
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
    };
    function rectForElement(element) {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
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
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  return { screenshotPath, domPath, metricsPath };
}

async function waitForGuiReady(page, name) {
  await page.waitForFunction(() => Array.isArray(window.__yetAiBridgePosts) && window.__yetAiBridgePosts.some((message) => message?.type === "gui.ready"), undefined, { timeout: 5000 }).catch(() => failures.push(`Missing ${name} GUI bridge ready post`));
}

async function dispatchHostReady(page) {
  await page.evaluate((payload) => {
    window.dispatchEvent(new MessageEvent("message", { data: { version: "2026-05-15", type: "host.ready", payload } }));
  }, { runtimeUrl: `http://127.0.0.1:${runtimeServer.port}`, sessionToken: runtimeSessionValue, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false });
}

async function injectActiveEditorContext(page, host) {
  await page.evaluate((source) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: "2026-05-15",
        type: "host.contextSnapshot",
        payload: {
          kind: "active_editor",
          source,
          file: { displayPath: "src/plugin-layout.ts", workspaceRelativePath: "src/plugin-layout.ts", languageId: "typescript" },
          selection: { startLine: 10, startCharacter: 2, endLine: 10, endCharacter: 40, text: "function add(a, b) { return a + b; }" },
        },
      },
    }));
  }, host);
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
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const requestedPath = path.normalize(path.join(staticRoot, pathname));
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

async function startRuntimeServer() {
  const chats = new Map([["chat-001", { chatId: "chat-001", title: "Plugin layout smoke", createdAt: now(), updatedAt: now(), messages: [] }]]);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") return empty(response, 204);
    if (request.method === "GET" && url.pathname === "/v1/ping") return json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: now() });
    if (request.method === "GET" && url.pathname === "/v1/caps") return json(response, 200, { productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
    if (request.method === "GET" && url.pathname === "/v1/demo-mode") return json(response, 200, { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Local canned responses." });
    if (request.method === "GET" && url.pathname === "/v1/models") return json(response, 200, { models: [demoModel()] });
    if (request.method === "GET" && url.pathname === "/v1/providers") return json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
    if (request.method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "No account login." });
    if (request.method === "GET" && url.pathname === "/v1/chats") return json(response, 200, { chats: Array.from(chats.values()).map((chat) => ({ chatId: chat.chatId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length })) });
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(url.pathname);
    if (chatMatch && request.method === "GET") return json(response, 200, chats.get(decodeURIComponent(chatMatch[1])) ?? chats.get("chat-001"));
    if (request.method === "GET" && url.pathname === "/v1/chats/subscribe") return sse(response, chats.get(url.searchParams.get("chat_id") ?? "chat-001") ?? chats.get("chat-001"));
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(url.pathname);
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

async function readBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8") || "{}"; }
function sse(response, chat) { response.writeHead(200, corsHeaders({ "content-type": "text/event-stream", "cache-control": "no-cache" })); response.write(`event: snapshot\ndata: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: chat.chatId, payload: { thread: chat, messages: chat.messages, runtime: { streaming: false, waitingForResponse: false } } })}\n\n`); const chatSubscribers = subscribers.get(chat.chatId) ?? new Set(); chatSubscribers.add(response); subscribers.set(chat.chatId, chatSubscribers); response.on("close", () => chatSubscribers.delete(response)); }
function pushSse(chatId, event) { for (const response of subscribers.get(chatId) ?? []) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }
function demoModel() { return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } }; }
function demoProvider() { return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } }; }
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
