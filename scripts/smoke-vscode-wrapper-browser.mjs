import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagedGuiRoot = path.join(root, "apps", "plugins", "vscode", "media", "gui");
const packagedGuiIndex = path.join(packagedGuiRoot, "index.html");
const guiDistIndex = path.join(root, "apps", "gui", "dist", "index.html");
const evidenceRoot = path.join(root, "dist", "visual-smoke", "vscode-wrapper-browser");
const staleToleranceMs = 2000;
const bridgeVersion = "2026-05-15";
const headed = process.argv.includes("--headed");
const runtimeToken = `vscode-wrapper-runtime-${randomUUID()}`;
const providerKey = `sk-vscode-wrapper-${randomUUID()}`;
const authorizationSentinel = `Authorization: Bearer ${runtimeToken}`;
const rejectedSecretMessage = `Invalid host result must not render ${providerKey}`;
const progressSummary = "IDE action policy check started.";
const resultMessage = "Context snapshot delivered.";
const activeContextPath = "src/smoke-active.ts";
const activeContextRange = { start: { line: 7, character: 1 }, end: { line: 7, character: 12 } };
const activeContextSelection = "selectedReadOnlyContext";
const liveContextPath = "src/smoke-live.ts";
const liveContextSelection = "selectedLiveContextReplacement";
const openResultMessage = "Workspace file opened.";
const revealProgressSummary = "Reveal policy check started.";
const revealResultMessage = "Workspace range revealed.";
const proposalAssistantMessageId = "assistant-proposal-message-001";
const proposalSummary = "Reveal the reviewed workspace range.";
const proposalPath = "src/example.ts";
const proposalRange = { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } };
const proposalProgressSummary = "IDE proposal navigation started.";
const proposalResultMessage = "Workspace range revealed from proposal.";
const assistantIdeActionProposal = {
  type: "assistant.ideActionProposal",
  version: bridgeVersion,
  requiresUserConfirmation: true,
  cloudRequired: false,
  summary: proposalSummary,
  action: "revealWorkspaceRange",
  workspaceRelativePath: proposalPath,
  range: proposalRange,
};
const mockChatMessages = [{ id: proposalAssistantMessageId, chatId: "chat-001", role: "assistant", content: JSON.stringify(assistantIdeActionProposal), createdAt: new Date(0).toISOString(), status: "complete" }];
const mockChatSubscribers = new Set();
const failures = [];
const consoleMessages = [];
let observedRuntimeAuthorization = false;

await requirePackagedGui();
const { chromium } = await requireChromium();
const guiServer = await startStaticServer(packagedGuiRoot);
const guiBaseUrl = `http://127.0.0.1:${guiServer.port}`;
const runtimeServer = await startMockRuntimeServer();
const runtimeBaseUrl = `http://127.0.0.1:${runtimeServer.port}`;
let browser;

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:8001/") && !url.startsWith(`${runtimeBaseUrl}/`)) {
      await route.abort();
      return;
    }
    if (isAllowedUrl(url, [guiBaseUrl, runtimeBaseUrl])) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request: ${redactUrl(url)}`);
    await route.abort();
  });

  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(text);
    if (containsSecret(text)) failures.push("Browser console exposed a smoke secret marker.");
  });
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`));
  page.on("requestfailed", (request) => {
    if (isJsOrCssAssetRequest(request.url(), request.resourceType())) {
      failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactUrl(request.url())} (${request.failure()?.errorText ?? "unknown failure"})`);
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(guiBaseUrl) && (response.status() === 404 || response.status() >= 500)) {
      failures.push(`Broken packaged GUI response: ${response.status()} ${redactUrl(response.url())}`);
    }
  });

  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.__yetAiHostMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });

  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await expectHiddenHeroTitle(page, "VS Code hosted packaged GUI hero title");
  await expectVisibleText(page, "Chat readiness", "hosted chat readiness card");
  await expectAttachedText(page, "Conversations", "hosted conversations workbench");
  await expectAttachedText(page, "Coding Actions", "hosted coding actions workbench");
  const bodyText = (await page.locator("body").innerText()).trim();
  if (bodyText.length < 80) failures.push(`Packaged GUI body text is too short or blank (${bodyText.length} characters).`);

  const guiReady = await waitForGuiMessage(page, "gui.ready");
  if (guiReady?.version !== bridgeVersion || guiReady?.payload?.supportedBridgeVersion !== bridgeVersion) {
    failures.push("VS Code-like acquireVsCodeApi bridge did not collect strict gui.ready.");
  }

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ready",
    requestId: guiReady?.requestId,
    payload: { runtimeUrl: runtimeBaseUrl, sessionToken: runtimeToken, productId: "yet-ai", displayName: "Yet AI", cloudRequired: false },
  });
  await expectAttachedText(page, "Host runtime settings received", "host.ready bridge log");
  await expectAttachedText(page, "bridge vscode", "VS Code bridge mode badge");
  await expectAttachedText(page, "VS Code controlled actions", "controlled action availability");
  await expectAttachedText(page, "Provider setup", "VS Code provider setup surface");
  await expectVisibleText(page, "Demo Mode", "VS Code demo-mode setup surface");
  await expectAttachedText(page, "Runtime connected", "VS Code runtime readiness surface");

  const initialChatText = await page.locator("body").innerText();
  if (initialChatText.includes('"type":"assistant.ideActionProposal"') || initialChatText.includes('"type": "assistant.ideActionProposal"')) {
    failures.push("Assistant IDE action proposal raw JSON rendered instead of compact proposal copy before inspection.");
  }
  await expectVisibleText(page, "Proposed a read-only IDE action: Reveal workspace range. Review the proposal card below. It will not run automatically.", "compact assistant proposal chat copy");
  await expectVisibleText(page, "Read-only IDE action proposal", "assistant read-only IDE action proposal card");
  await expectVisibleText(page, proposalSummary, "assistant proposal summary");
  await expectVisibleText(page, "Reveal workspace range", "assistant proposal action label");
  await expectVisibleText(page, `Path: ${proposalPath}`, "assistant proposal workspace-relative path");
  await expectVisibleText(page, "Range: 4:2-4:8", "assistant proposal range");
  await assertProposalSecretsOnlyInVisibleUi(page, "initial compact proposal render");

  const proposalPreClickIdeRequestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  if (proposalPreClickIdeRequestCount !== 0) failures.push("Assistant IDE action proposal auto-posted gui.ideActionRequest before explicit confirmation.");

  const runProposalButton = page.getByRole("button", { name: "Run read-only IDE action", exact: true });
  await runProposalButton.waitFor({ state: "visible", timeout: 10_000 });
  if (await runProposalButton.isDisabled()) failures.push("Run read-only IDE action button was disabled before any proposal request was pending.");
  await runProposalButton.click();

  const proposalIdeRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", proposalPreClickIdeRequestCount);
  if (!proposalIdeRequest) {
    failures.push("Clicking Run read-only IDE action did not send gui.ideActionRequest.");
  } else {
    const expectedProposalPayload = { action: "revealWorkspaceRange", workspaceRelativePath: proposalPath, range: proposalRange };
    if (proposalIdeRequest.version !== bridgeVersion) failures.push("Proposal IDE action request used the wrong bridge version.");
    if (typeof proposalIdeRequest.requestId !== "string" || !/^gui-ide-proposal-action-\d+$/.test(proposalIdeRequest.requestId)) {
      failures.push("Proposal IDE action request id was not GUI-owned with the expected prefix.");
    }
    if (proposalIdeRequest.requestId === proposalAssistantMessageId) failures.push("Proposal IDE action request reused an assistant message/request id.");
    if (!deepEqual(proposalIdeRequest.payload, expectedProposalPayload)) failures.push("Proposal IDE action request payload did not match the strict assistant proposal action/path/range.");
    if (hasForbiddenPrivilegedKeys(proposalIdeRequest.payload)) failures.push("Proposal IDE action request payload contained shell/edit/tool/git/task-like fields.");
  }

  const proposalRequestId = proposalIdeRequest?.requestId ?? "gui-ide-proposal-action-missing";
  await expectVisibleText(page, "IDE action pending…", "pending proposal IDE action button label");
  await expectVisibleText(page, "Clear pending IDE action state", "clear pending IDE action state button");
  const clearPendingButtonCount = await page.getByRole("button", { name: "Clear pending IDE action state", exact: true }).count();
  if (clearPendingButtonCount !== 1) failures.push(`Expected exactly one clear pending IDE action state button during proposal pending state; found ${clearPendingButtonCount}.`);

  const clearPendingButton = page.getByRole("button", { name: "Clear pending IDE action state", exact: true }).first();
  await clearPendingButton.click();
  const proposalPostClearIdeRequestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  if (proposalPostClearIdeRequestCount !== proposalPreClickIdeRequestCount + 1) failures.push("Clearing pending IDE action state posted a new gui.ideActionRequest or changed request count.");
  await expectAttachedText(page, "Cleared pending IDE action state in the GUI only. No host-side cancellation was requested.", "local-only clear pending IDE action note");
  await runProposalButton.waitFor({ state: "visible", timeout: 10_000 });
  if (await runProposalButton.isDisabled()) failures.push("Run read-only IDE action button stayed disabled after clearing pending state.");

  const staleProgressSummary = "Stale first proposal progress should not render.";
  const staleResultMessage = "Stale first proposal result should not render.";
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionProgress",
    requestId: proposalRequestId,
    payload: { phase: "running", status: "inProgress", summary: staleProgressSummary, cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: proposalPath },
  });
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: proposalRequestId,
    payload: { status: "failed", message: staleResultMessage, cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: proposalPath, range: proposalRange },
  });
  await page.waitForTimeout(150);
  await expectNoVisibleText(page, staleProgressSummary, "stale proposal IDE action progress after clear");
  await expectNoVisibleText(page, staleResultMessage, "stale proposal IDE action result after clear");

  const retryPreClickIdeRequestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  await runProposalButton.click();
  const retryProposalIdeRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", retryPreClickIdeRequestCount);
  if (!retryProposalIdeRequest) {
    failures.push("Retrying Run read-only IDE action did not send a fresh gui.ideActionRequest.");
  } else {
    if (retryProposalIdeRequest.requestId === proposalRequestId) failures.push("Retrying proposal IDE action reused the stale cleared request id.");
    if (typeof retryProposalIdeRequest.requestId !== "string" || !/^gui-ide-proposal-action-\d+$/.test(retryProposalIdeRequest.requestId)) {
      failures.push("Retry proposal IDE action request id was not GUI-owned with the expected prefix.");
    }
    if (!deepEqual(retryProposalIdeRequest.payload, proposalIdeRequest?.payload)) failures.push("Retry proposal IDE action payload changed from the original strict proposal payload.");
  }

  const retryProposalRequestId = retryProposalIdeRequest?.requestId ?? "gui-ide-proposal-action-retry-missing";
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionProgress",
    requestId: retryProposalRequestId,
    payload: { phase: "running", status: "inProgress", summary: proposalProgressSummary, cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: proposalPath },
  });
  await expectVisibleText(page, "Reveal range: inProgress", "correlated proposal IDE action progress");
  await expectVisibleText(page, proposalProgressSummary, "proposal IDE action progress summary");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: retryProposalRequestId,
    payload: { status: "succeeded", message: proposalResultMessage, cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: proposalPath, range: proposalRange },
  });
  await expectVisibleText(page, "Reveal range: succeeded", "correlated proposal IDE action result");
  await expectVisibleText(page, proposalResultMessage, "proposal IDE action result message");
  await expectVisibleText(page, `Path: ${proposalPath}`, "proposal IDE action result path");
  await expectVisibleText(page, "Range: 4:2-4:8", "proposal IDE action result range");
  await assertProposalSecretsOnlyInVisibleUi(page, "matched retry proposal result render");

  const firstMessageTextarea = page.getByPlaceholder("Ask about the current file, selection, or project...");
  await firstMessageTextarea.fill("VS Code packaged wrapper visual first message.");
  await clickSendButtonWithActionability(page, "VS Code first-message visual smoke");
  await expectVisibleText(page, "VS Code packaged wrapper visual first message.", "VS Code first-message user bubble");
  await expectVisibleText(page, "VS Code wrapper canned chat response.", "VS Code first-message assistant bubble");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.contextSnapshot",
    requestId: "host-active-context-smoke-001",
    payload: {
      kind: "active_editor",
      source: "vscode",
      file: { displayPath: activeContextPath, workspaceRelativePath: activeContextPath, languageId: "typescript" },
      selection: { startLine: activeContextRange.start.line, startCharacter: activeContextRange.start.character, endLine: activeContextRange.end.line, endCharacter: activeContextRange.end.character, text: activeContextSelection },
    },
  });
  await expectVisibleText(page, "Active editor context", "active context preview card");
  await expectAttachedText(page, `File: ${activeContextPath}`, "active context safe file label");
  await expectAttachedText(page, "Selection range: 7:1-7:12", "active context safe selection range");
  await expectAttachedText(page, activeContextSelection, "bounded active context preview text");
  await expectVisibleText(page, "Attach to next message", "safe active context default include policy");
  await expectAttachedText(page, `Active safe path: ${activeContextPath}`, "IDE action safe active path");
  await expectAttachedText(page, "Active safe range: 7:1-7:12", "IDE action safe active range");
  const openFileButton = page.getByRole("button", { name: "Open file", exact: true });
  const revealRangeButton = page.getByRole("button", { name: "Reveal range", exact: true });
  if (await openFileButton.isDisabled()) failures.push("Open file button stayed disabled after safe active context snapshot.");
  if (await revealRangeButton.isDisabled()) failures.push("Reveal range button stayed disabled after safe active context snapshot.");
  await assertBrowserStorageDoesNotContain(page, [activeContextPath, activeContextSelection], "trusted active context preview");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.contextSnapshot",
    requestId: "host-active-context-smoke-002",
    payload: {
      kind: "active_editor",
      source: "vscode",
      file: { displayPath: liveContextPath, workspaceRelativePath: liveContextPath, languageId: "typescript" },
      selection: { startLine: 9, startCharacter: 2, endLine: 9, endCharacter: 18, text: liveContextSelection },
    },
  });
  await expectAttachedText(page, `File: ${liveContextPath}`, "live active context replacement file label");
  await expectAttachedText(page, "Selection range: 9:2-9:18", "live active context replacement range");
  await expectAttachedText(page, liveContextSelection, "live active context replacement text");
  await expectNoVisibleText(page, activeContextSelection, "stale active context selection after live update");
  if (await openFileButton.isDisabled()) failures.push("Open file button was disabled after live context refresh.");
  if (await revealRangeButton.isDisabled()) failures.push("Reveal range button was disabled after live context refresh.");
  await assertBrowserStorageDoesNotContain(page, [liveContextPath, liveContextSelection], "live trusted active context preview");

  const getContextButton = page.getByRole("button", { name: "Get IDE context", exact: true });
  await getContextButton.waitFor({ state: "visible", timeout: 10_000 });
  if (await getContextButton.isDisabled()) failures.push("Get IDE context button was disabled in VS Code host mode.");
  const manualPreClickIdeRequestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  await getContextButton.click();
  const ideRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", manualPreClickIdeRequestCount);
  if (!ideRequest) {
    failures.push("Clicking Get IDE context did not send gui.ideActionRequest.");
  } else {
    if (ideRequest.version !== bridgeVersion) failures.push("IDE action request used the wrong bridge version.");
    if (ideRequest.payload?.action !== "getContextSnapshot" || Object.keys(ideRequest.payload ?? {}).length !== 1) {
      failures.push("IDE action request payload was not strict getContextSnapshot.");
    }
    if (typeof ideRequest.requestId !== "string" || !/^gui-ide-action-\d+$/.test(ideRequest.requestId) || ideRequest.requestId.length > 128) {
      failures.push("IDE action request id was missing, unbounded, or not deterministic.");
    }
  }

  const requestId = ideRequest?.requestId ?? "gui-ide-action-missing";
  await expectVisibleText(page, "IDE action pending…", "manual getContext pending button label");
  const duplicateManualClickCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  await getContextButton.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(100);
  const duplicateManualPostClickCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  if (duplicateManualPostClickCount !== duplicateManualClickCount) failures.push("Pending manual getContextSnapshot allowed a duplicate gui.ideActionRequest.");
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionProgress",
    requestId,
    payload: { phase: "checkingPolicy", status: "inProgress", summary: progressSummary, cloudRequired: false, action: "getContextSnapshot" },
  });
  await expectVisibleText(page, "Get IDE context: inProgress", "correlated IDE action progress");
  await expectVisibleText(page, progressSummary, "IDE action progress summary");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId,
    payload: { status: "succeeded", message: resultMessage, cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } },
  });
  await expectVisibleText(page, "Get IDE context: succeeded", "correlated IDE action result");
  await expectVisibleText(page, resultMessage, "IDE action result message");
  await expectVisibleText(page, "Result context: source vscode · active editor present yes · workspace folders 1", "IDE action result context metadata");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: "invalid-secret-result",
    payload: { status: "succeeded", message: rejectedSecretMessage, cloudRequired: false, action: "getContextSnapshot", extra: "free-form" },
  });
  await page.waitForTimeout(150);
  const rejectedVisible = await page.getByText(rejectedSecretMessage, { exact: false }).first().isVisible().catch(() => false);
  if (rejectedVisible) failures.push("Schema-invalid/free-form host.ideActionResult with a secret-like message rendered in the DOM.");
  await expectVisibleText(page, "Get IDE context: succeeded", "valid IDE action result remains visible after invalid result");

  const openPreClickIdeRequestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  await openFileButton.click();
  const openIdeRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", openPreClickIdeRequestCount);
  if (!openIdeRequest) {
    failures.push("Clicking Open file did not send gui.ideActionRequest.");
  } else {
    if (!deepEqual(openIdeRequest.payload, { action: "openWorkspaceFile", workspaceRelativePath: liveContextPath })) failures.push("Open file IDE action payload did not use the live safe active workspace path only.");
    if (hasForbiddenPrivilegedKeys(openIdeRequest.payload)) failures.push("Open file IDE action request payload contained privileged fields.");
  }
  const openRequestId = openIdeRequest?.requestId ?? "gui-ide-action-open-missing";
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: openRequestId,
    payload: { status: "succeeded", message: openResultMessage, cloudRequired: false, action: "openWorkspaceFile", workspaceRelativePath: liveContextPath },
  });
  await expectVisibleText(page, "Open file: succeeded", "correlated open file IDE action result");
  await expectVisibleText(page, openResultMessage, "open file IDE action result message");
  await expectVisibleText(page, `Result path: ${liveContextPath}`, "open file IDE action result path metadata");

  const revealPreClickIdeRequestCount = await getGuiMessageCount(page, "gui.ideActionRequest");
  await revealRangeButton.click();
  const revealIdeRequest = await waitForGuiMessageAfter(page, "gui.ideActionRequest", revealPreClickIdeRequestCount);
  if (!revealIdeRequest) {
    failures.push("Clicking Reveal range did not send gui.ideActionRequest.");
  } else {
    if (!deepEqual(revealIdeRequest.payload, { action: "revealWorkspaceRange", workspaceRelativePath: liveContextPath, range: { start: { line: 9, character: 2 }, end: { line: 9, character: 18 } } })) failures.push("Reveal range IDE action payload did not use the live safe active path/range only.");
    if (hasForbiddenPrivilegedKeys(revealIdeRequest.payload)) failures.push("Reveal range IDE action request payload contained privileged fields.");
  }
  const revealRequestId = revealIdeRequest?.requestId ?? "gui-ide-action-reveal-missing";
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionProgress",
    requestId: revealRequestId,
    payload: { phase: "checkingPolicy", status: "inProgress", summary: revealProgressSummary, cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: liveContextPath, range: { start: { line: 9, character: 2 }, end: { line: 9, character: 18 } } },
  });
  await expectVisibleText(page, "Reveal range: inProgress", "correlated reveal range IDE action progress");
  await expectVisibleText(page, revealProgressSummary, "reveal range IDE action progress summary");
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: revealRequestId,
    payload: { status: "succeeded", message: revealResultMessage, cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: liveContextPath, range: { start: { line: 9, character: 2 }, end: { line: 9, character: 18 } } },
  });
  await expectVisibleText(page, "Reveal range: succeeded", "correlated reveal range IDE action result");
  await expectVisibleText(page, revealResultMessage, "reveal range IDE action result message");
  await expectVisibleText(page, `Result path: ${liveContextPath} · result range: 9:2-9:18`, "reveal range IDE action result path/range metadata");

  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.ideActionResult",
    requestId: revealRequestId,
    payload: { status: "succeeded", message: `Secret-like result must not render ${providerKey}`, cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: `token/${providerKey}.ts`, range: activeContextRange },
  });
  await page.waitForTimeout(150);
  await expectNoVisibleText(page, `Secret-like result must not render ${providerKey}`, "secret-like reveal host result");
  await expectVisibleText(page, "Reveal range: succeeded", "valid reveal result remains visible after rejected secret-like result");
  await assertBrowserStorageDoesNotContain(page, [runtimeToken, providerKey, authorizationSentinel, activeContextPath, activeContextSelection, liveContextPath, liveContextSelection], "final storage no-secret/no-context persistence check");

  if (!observedRuntimeAuthorization) failures.push("Mock runtime did not observe Authorization from host.ready session token.");
  const layoutMetrics = await collectVisualLayoutMetrics(page);
  assertVsCodeVisualLayout(layoutMetrics);
  const evidence = await saveVsCodeWrapperEvidence(page, layoutMetrics);
  const visibleState = await collectVisibleState(page);
  assertNoSecretLeak(visibleState, "DOM, browser storage, collected GUI messages, host messages, or console");

  if (failures.length > 0) reportFailures();
  console.log("VS Code wrapper browser smoke passed.");
  console.log("Verified packaged VS Code GUI assets in a VS Code-like browser bridge, gui.ready, trusted loopback host.ready, readiness/provider/Demo Mode setup surfaces, first-message Send click through mock runtime, active context preview and safe include policy, compact assistant read-only IDE action proposal rendering without auto-post, explicit proposal confirmation with GUI-owned strict request, duplicate pending suppression, GUI-only pending clear, stale progress/result ignore, retry with a fresh request id, matching getContextSnapshot/openWorkspaceFile/revealWorkspaceRange progress and result rendering, loopback-only networking, invalid and secret-like host-result rejection/non-rendering, and browser storage no-secret/no-context persistence checks.");
  console.log(`Saved sanitized layout screenshot/DOM/metrics under ${path.relative(root, evidenceRoot)}/ (${path.basename(evidence.screenshotPath)}, ${path.basename(evidence.domPath)}, ${path.basename(evidence.metricsPath)}).`);
  console.log("No real VS Code launch, provider credentials, OpenAI/ChatGPT calls, hosted Yet AI service, or non-loopback provider call was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await runtimeServer.close();
  await guiServer.close();
}

async function requirePackagedGui() {
  let packagedGuiStat;
  try {
    packagedGuiStat = await stat(packagedGuiIndex);
    if (!packagedGuiStat.isFile()) throw new Error("not a file");
  } catch {
    console.error("VS Code wrapper browser smoke failed: packaged VS Code GUI assets are missing.");
    console.error("Run `npm run prepare:vscode-preview` from the repository root.");
    console.error(`Expected file: ${path.relative(root, packagedGuiIndex)}`);
    process.exit(1);
  }

  try {
    const guiDistStat = await stat(guiDistIndex);
    if (guiDistStat.isFile() && packagedGuiStat.mtimeMs + staleToleranceMs < guiDistStat.mtimeMs) {
      console.error("VS Code wrapper browser smoke failed: packaged VS Code GUI assets are stale.");
      console.error("Run `npm run prepare:vscode-preview` from the repository root to rebuild and copy GUI assets before running wrapper smoke.");
      console.error(`Packaged file: ${path.relative(root, packagedGuiIndex)}`);
      console.error(`Newer GUI build file: ${path.relative(root, guiDistIndex)}`);
      process.exit(1);
    }
  } catch {
    // If apps/gui/dist/index.html does not exist, the packaged-GUI existence check above
    // is still sufficient for this smoke. prepare:vscode-preview creates both when needed.
  }
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code wrapper browser smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
    console.error(`Load error: ${messageOf(error)}`);
    process.exit(1);
  }
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

async function clickSendButtonWithActionability(page, label) {
  const sendButton = page.getByRole("button", { name: "Send", exact: true }).last();
  await sendButton.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const state = await sendButton.evaluate((button) => {
    if (!(button instanceof HTMLElement)) return { ok: false, reason: "send button is not an HTMLElement" };
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      ok: top === button || button.contains(top),
      disabled: button instanceof HTMLButtonElement ? button.disabled : undefined,
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height },
      topTag: top?.tagName,
      topText: top?.textContent?.trim().slice(0, 80),
    };
  }).catch((error) => ({ ok: false, reason: messageOf(error) }));
  if (!state.ok || state.disabled) failures.push(`${label}: Send is not hit-testable/enabled before click (${JSON.stringify(state)}).`);
  await sendButton.click({ timeout: 5000 });
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => {
    window.__yetAiHostMessages.push(hostMessage);
    window.dispatchEvent(new MessageEvent("message", { data: hostMessage }));
  }, message);
}

async function startMockRuntimeServer() {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders()).end();
      return;
    }
    if (request.headers.authorization === `Bearer ${runtimeToken}`) observedRuntimeAuthorization = true;
    if (request.headers.authorization !== `Bearer ${runtimeToken}`) {
      json(response, 401, { error: "Unauthorized local runtime request." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/ping") {
      json(response, 200, { productId: "yet-ai", displayName: "Yet AI", version: "0.0.0-smoke", ready: true, serverTime: new Date(0).toISOString() });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/caps") {
      json(response, 200, { productId: "yet-ai", protocolVersion: bridgeVersion, runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: ["chat"], features: {}, providers: [], ide: { bridge: true, lsp: false, host: "vscode-wrapper-browser-smoke" } });
      return;
    }
    if ((request.method === "GET" || request.method === "POST") && requestUrl.pathname === "/v1/demo-mode") {
      json(response, 200, demoModeEnabledResponse());
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      json(response, 200, { models: [demoModel()] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/providers") {
      json(response, 200, { providers: [demoProvider()], cloudRequired: false, providerAccess: "direct" });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/provider-auth/openai/status") {
      json(response, 200, { provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "Mock-only wrapper smoke." });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats") {
      json(response, 200, { chats: [mockProposalChatSummary()] });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/chat-001") {
      json(response, 200, mockProposalChatThread());
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/v1/chats/subscribe") {
      const chat = mockProposalChatThread();
      response.writeHead(200, { ...corsHeaders(), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      response.write(`event: snapshot\ndata: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: chat.chatId, payload: { thread: chat, messages: chat.messages, runtime: { streaming: false, waitingForResponse: false } } })}\n\n`);
      mockChatSubscribers.add(response);
      response.on("close", () => mockChatSubscribers.delete(response));
      return;
    }
    const commandMatch = /^\/v1\/chats\/([^/]+)\/commands$/.exec(requestUrl.pathname);
    if (request.method === "POST" && commandMatch) {
      const chatId = decodeURIComponent(commandMatch[1]);
      const body = JSON.parse(await readBody(request));
      const createdAt = new Date(0).toISOString();
      const userMessage = { id: `user-visual-chat-${mockChatMessages.length}`, chatId, role: "user", content: body.payload?.content ?? "", createdAt, status: "complete" };
      const assistantMessage = { id: `assistant-visual-chat-${mockChatMessages.length}`, chatId, role: "assistant", content: "VS Code wrapper canned chat response.", createdAt, status: "complete" };
      mockChatMessages.push(userMessage, assistantMessage);
      pushMockChatEvent({ seq: mockChatMessages.length - 1, type: "message_added", chatId, payload: { message: userMessage } });
      pushMockChatEvent({ seq: mockChatMessages.length, type: "message_added", chatId, payload: { message: assistantMessage } });
      json(response, 200, { accepted: true, chatId, requestId: body.requestId ?? "vscode-wrapper-visual-chat", type: body.type });
      return;
    }
    json(response, 404, { error: "Not found" });
  });
  return listen(server);
}

function mockProposalChatSummary() {
  return { chatId: "chat-001", title: "VS Code proposal smoke", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), messageCount: mockChatMessages.length };
}

function mockProposalChatThread() {
  return {
    chatId: "chat-001",
    title: "VS Code proposal smoke",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    messages: mockChatMessages,
  };
}

function pushMockChatEvent(event) {
  for (const subscriber of mockChatSubscribers) {
    subscriber.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8") || "{}";
}

async function startStaticServer(staticRoot) {
  const realStaticRoot = await realpath(staticRoot);
  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    const requestedPath = path.normalize(path.join(realStaticRoot, pathname));
    try {
      const realRequestedPath = await realpath(requestedPath);
      if (!isPathInsideRoot(realStaticRoot, realRequestedPath) || !(await stat(realRequestedPath)).isFile()) throw new Error("not found");
      response.writeHead(200, { "content-type": contentType(realRequestedPath) });
      createReadStream(realRequestedPath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return listen(server);
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({ port: address.port, close: () => new Promise((closeResolve) => server.close(closeResolve)) });
    });
  });
}

async function expectVisibleText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function expectHiddenHeroTitle(page, description) {
  const hidden = await page.locator(".hero h1").first().evaluate((element) => {
    const hero = element.closest(".hero");
    return getComputedStyle(element).display === "none"
      || getComputedStyle(element).visibility === "hidden"
      || (hero !== null && (getComputedStyle(hero).display === "none" || getComputedStyle(hero).visibility === "hidden"));
  }).catch(() => false);
  if (!hidden) failures.push(`${description} was not hidden in hosted mode.`);
}

async function expectAttachedText(page, text, description, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "attached", timeout });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 2000)}`);
  }
}

async function expectNoVisibleText(page, text, description) {
  const visible = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  if (visible) failures.push(`${description} rendered unexpectedly.`);
}

async function assertProposalSecretsOnlyInVisibleUi(page, description) {
  const nonUiState = JSON.stringify(await page.evaluate(() => ({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
  }))) + JSON.stringify(consoleMessages);
  if (nonUiState.includes(proposalPath) || nonUiState.includes(proposalSummary)) {
    failures.push(`Proposal path/summary leaked outside expected visible UI during ${description}.`);
  }
}

async function assertBrowserStorageDoesNotContain(page, markers, description) {
  const storageState = JSON.stringify(await page.evaluate(() => ({
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
  })));
  for (const marker of markers) {
    if (marker && storageState.includes(marker)) failures.push(`Browser storage contained ${redactSecrets(marker)} during ${description}.`);
  }
}

async function collectVisibleState(page) {
  return JSON.stringify(await page.evaluate(() => ({
    domText: document.documentElement.innerText,
    localStorage: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index) ?? "", localStorage.getItem(localStorage.key(index) ?? "")])),
    sessionStorage: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index) ?? "", sessionStorage.getItem(sessionStorage.key(index) ?? "")])),
    vscodeMessages: window.__yetAiVsCodeMessages,
    hostMessageTypes: window.__yetAiHostMessages?.map((message) => ({ type: message?.type, requestId: message?.requestId })),
    hostPayloadKeys: window.__yetAiHostMessages?.map((message) => Object.keys(message?.payload ?? {})),
    hostPayloadValues: window.__yetAiHostMessages?.map((message) => Object.fromEntries(Object.entries(message?.payload ?? {}).filter(([key]) => key !== "sessionToken" && key !== "message" && key !== "workspaceRelativePath"))),
  }))) + JSON.stringify(consoleMessages);
}

async function collectVisualLayoutMetrics(page) {
  return page.evaluate(() => {
    const rectFor = (selectorOrElement) => {
      const element = typeof selectorOrElement === "string" ? document.querySelector(selectorOrElement) : selectorOrElement;
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    };
    const visible = (element) => element instanceof HTMLElement && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden" && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const textVisible = (needle) => Array.from(document.querySelectorAll("body *")).some((element) => element instanceof HTMLElement && visible(element) && (element.textContent ?? "").includes(needle));
    const send = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Send");
    const textarea = document.querySelector("textarea");
    const scroll = document.querySelector(".chat-scroll-region");
    const composer = document.querySelector(".chat-composer");
    const sendRect = rectFor(send);
    const textareaRect = rectFor(textarea);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const withinViewport = (box) => Boolean(box && box.top >= 0 && box.left >= 0 && box.bottom <= viewport.height && box.right <= viewport.width);
    const hitCenter = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return { ok: top === element || element.contains(top), tag: top?.tagName, text: top?.textContent?.trim().slice(0, 80), className: top instanceof HTMLElement ? top.className : undefined };
    };
    return {
      viewport,
      packagedHost: "vscode-wrapper-browser",
      bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
      heroHidden: document.querySelector(".hero") instanceof HTMLElement && getComputedStyle(document.querySelector(".hero")).display === "none",
      hostVscodeClass: document.querySelector("main.app-shell.host-vscode") instanceof HTMLElement,
      chatReadinessVisible: textVisible("Chat readiness"),
      runtimeConnectedVisible: textVisible("Runtime connected"),
      providerSetupVisible: textVisible("Provider setup"),
      demoModeVisible: textVisible("Demo Mode"),
      firstMessageVisible: textVisible("VS Code packaged wrapper visual first message."),
      cannedAssistantVisible: textVisible("VS Code wrapper canned chat response."),
      sendVisible: send instanceof HTMLElement && visible(send),
      sendEnabled: send instanceof HTMLButtonElement && !send.disabled,
      sendWithinViewport: withinViewport(sendRect),
      sendHitTest: hitCenter(send),
      sendRect,
      textareaVisible: textarea instanceof HTMLElement && visible(textarea),
      textareaWithinViewport: withinViewport(textareaRect),
      textareaRect,
      chatScrollHeight: rectFor(scroll)?.height ?? 0,
      composerHeight: rectFor(composer)?.height ?? 0,
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
    };
  });
}

function assertVsCodeVisualLayout(metrics) {
  if (!metrics.heroHidden) failures.push("VS Code visual evidence: hosted hero is visible.");
  if (!metrics.hostVscodeClass) failures.push("VS Code visual evidence: main.app-shell.host-vscode is missing.");
  if (!metrics.chatReadinessVisible || !metrics.runtimeConnectedVisible || !metrics.providerSetupVisible || !metrics.demoModeVisible) failures.push(`VS Code visual evidence: missing readiness/setup surfaces (${JSON.stringify({ chatReadinessVisible: metrics.chatReadinessVisible, runtimeConnectedVisible: metrics.runtimeConnectedVisible, providerSetupVisible: metrics.providerSetupVisible, demoModeVisible: metrics.demoModeVisible })}).`);
  if (!metrics.firstMessageVisible || !metrics.cannedAssistantVisible) failures.push("VS Code visual evidence: first-message path did not render user/assistant bubbles.");
  if (!metrics.sendVisible || !metrics.sendEnabled || !metrics.sendWithinViewport || !metrics.sendHitTest?.ok) failures.push(`VS Code visual evidence: Send is not visible/enabled/hit-testable (${JSON.stringify(metrics.sendRect)}, ${JSON.stringify(metrics.sendHitTest)}).`);
  if (!metrics.textareaVisible || !metrics.textareaWithinViewport) failures.push(`VS Code visual evidence: composer textarea is not visible in viewport (${JSON.stringify(metrics.textareaRect)}).`);
  if (metrics.chatScrollHeight < 240) failures.push(`VS Code visual evidence: chat area is too small (${metrics.chatScrollHeight}).`);
  if (metrics.composerHeight > 260) failures.push(`VS Code visual evidence: composer is too tall (${metrics.composerHeight}).`);
}

async function saveVsCodeWrapperEvidence(page, metrics) {
  await mkdir(evidenceRoot, { recursive: true });
  const screenshotPath = path.join(evidenceRoot, "vscode-wrapper-layout.png");
  const domPath = path.join(evidenceRoot, "vscode-wrapper-layout.dom.txt");
  const metricsPath = path.join(evidenceRoot, "vscode-wrapper-layout.metrics.json");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const dom = await page.locator("body").evaluate((body) => body.innerText).then(sanitizeEvidenceText);
  await writeFile(domPath, dom, "utf8");
  await writeFile(metricsPath, `${JSON.stringify(sanitizeEvidenceObject(metrics), null, 2)}\n`, "utf8");
  return { screenshotPath, domPath, metricsPath };
}

function sanitizeEvidenceObject(value) {
  return JSON.parse(sanitizeEvidenceText(JSON.stringify(value)));
}

function json(response, status, body) {
  response.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function demoModeEnabledResponse() {
  return { enabled: true, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "VS Code wrapper smoke uses local canned responses only." };
}

function demoModel() {
  return { id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

function demoProvider() {
  return { id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel()], capabilities: { chat: true, completion: false, embeddings: false } };
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, accept" };
}

function isAllowedUrl(value, origins) {
  try { return origins.includes(new URL(value).origin); } catch { return false; }
}

function isPathInsideRoot(rootPath, requestedPath) {
  const relativePath = path.relative(rootPath, requestedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isJsOrCssAssetRequest(url, resourceType) {
  return url.startsWith(guiBaseUrl) && (resourceType === "script" || resourceType === "stylesheet" || /\.(js|css)$/.test(new URL(url).pathname));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function assertNoSecretLeak(text, source) {
  if (containsSecret(text)) throw new Error(`Secret marker leaked through ${source}.`);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasForbiddenPrivilegedKeys(value) {
  const forbidden = new Set(["shell", "command", "edit", "edits", "tool", "tools", "git", "task", "tasks", "applyWorkspaceEdit", "execute", "executeCommand"]);
  const visit = (current) => {
    if (!current || typeof current !== "object") return false;
    if (Array.isArray(current)) return current.some(visit);
    return Object.entries(current).some(([key, nested]) => forbidden.has(key) || visit(nested));
  };
  return visit(value);
}

function containsSecret(text) {
  const lower = String(text).toLowerCase();
  return [runtimeToken, providerKey, authorizationSentinel, `Bearer ${runtimeToken}`, `Bearer ${providerKey}`].some((marker) => lower.includes(marker.toLowerCase()));
}

function redactSecrets(text) {
  let redacted = String(text);
  for (const marker of [runtimeToken, providerKey, authorizationSentinel]) redacted = redacted.split(marker).join("[redacted]");
  return redacted.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

function sanitizeEvidenceText(text) {
  return redactSecrets(text)
    .replaceAll(activeContextSelection, "[redacted-active-selection]")
    .replaceAll(liveContextSelection, "[redacted-live-selection]")
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return redactSecrets(value); }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code wrapper browser smoke failed:");
  for (const failure of failures) console.error(`- ${redactSecrets(failure)}`);
  process.exit(1);
}
