import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  agentRunBuiltGuiDistRoot,
  agentRunBuiltGuiRuntimeOrigin,
  buildAgentRunBuiltGui,
  isAgentRunAllowedNetworkUrl,
  isAgentRunJsOrCssAssetRequest,
  isExpectedAgentRunFetchConsoleError,
  messageOf,
  redactAgentRunUrl,
  requireAgentRunBuiltGui,
  requireAgentRunChromium,
  startAgentRunStaticServer,
} from "./lib/agent-run-built-gui-smoke-bootstrap.mjs";
import { agentRunBuiltGuiModelSummary, agentRunBuiltGuiProviderSummary } from "./lib/agent-run-built-gui-fixtures.mjs";

const smokeName = "Controlled agent dev-preview recovery built-GUI smoke";
const smokeCommand = "smoke:controlled-agent-dev-preview-recovery";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const guiSrcRoot = path.join(repoRoot, "apps", "gui", "src");
const bridgeVersion = "2026-05-15";
const rawMarkers = [
  "sk-controlled-recovery-secret",
  "Authorization",
  "Bearer",
  "raw prompt",
  "raw file body",
  "raw diff",
  "raw command",
  "npm run hidden-controlled-recovery",
  "/Users/private/controlled-recovery",
  "C:\\Users\\controlled-recovery",
];
const failures = [];
const runtimeRequests = [];
let browser;
let server;

const fixtures = {
  workspace: await readFixture("packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json"),
  runtimeSession: await readFixture("packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json"),
  editExecutor: await readFixture("packages/contracts/examples/engine/controlled-agent-edit-executor-planned.json"),
  fileRead: await readFixture("packages/contracts/examples/bridge/host-controlled-agent-file-read-result-success.json"),
  editApplied: await readFixture("packages/contracts/examples/bridge/host-controlled-agent-edit-result-applied.json"),
};
const { createControlledAgentDevPreviewReport } = await importGuiService("services/controlledAgentDevPreviewReport.ts");
const { evaluateControlledAgentRepairLoop } = await importGuiService("services/controlledAgentRepairLoop.ts");

await buildAgentRunBuiltGui({ smokeName, smokeCommand, redact: redactSecrets });
await requireAgentRunBuiltGui({ smokeName, failures, redact: redactSecrets });
const { chromium } = await requireAgentRunChromium({ smokeName, redact: redactSecrets });

try {
  server = await startAgentRunStaticServer(agentRunBuiltGuiDistRoot);
  const guiBaseUrl = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });

  await runStopAfterStartScenario(guiBaseUrl);
  await runStaleEditAfterStopScenario(guiBaseUrl);
  await runStaleCommandAfterStopScenario(guiBaseUrl);
  await runFailedVerificationScenario(guiBaseUrl);
  await runRuntimeDisconnectScenario(guiBaseUrl);
  verifyRepairAndUnsafeMetadataContracts();

  if (failures.length > 0) {
    throw new Error(`${smokeName} failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  const evidence = {
    cases: ["stop_after_start", "stale_read_after_stop", "stale_edit_after_stop", "stale_command_after_stop", "failed_verification", "one_explicit_repair_attempt", "runtime_disconnect", "unsafe_metadata_blocked"],
    runtimeRequests,
  };
  assertNoRawMarkers(JSON.stringify(evidence), "sanitized smoke evidence");
  console.log(`${smokeName} passed.`);
  console.log("Verified built-GUI controlled dev-preview recovery paths with deterministic local mocks: Stop after Start, stale read/edit/command ignored after Stop, failed verification state, runtime disconnect blocking continuation, and unsafe metadata shown as blocked/non-actionable.");
  console.log("Verified one repair attempt is metadata-only and becomes available only after explicit confirmation; a second attempt is exhausted. No real provider, real IDE, non-loopback network, shell/git/tool authority, hidden requests, raw output, private paths, or secrets were used.");
} catch (error) {
  console.error(redactSecrets(messageOf(error)));
  process.exit(1);
} finally {
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
}

async function runStopAfterStartScenario(guiBaseUrl) {
  const page = await createSmokePage(guiBaseUrl);
  await startOneStep(page);
  const readRequest = await firstBridgeMessage(page, (message) => message?.type === "gui.controlledAgentFileReadRequest");
  assert(readRequest?.requestId, "Start did not post one controlled read request");
  await page.getByRole("button", { name: "Stop one-step Agent Run" }).click();
  await expectVisibleText(page, "Phase: stopped", "stopped phase after explicit Stop");
  await dispatchHostMessage(page, controlledReadHostMessage(readRequest));
  await page.waitForTimeout(150);
  assert.equal(await bridgeMessageCount(page, "gui.controlledAgentEditRequest"), 0, "stale read after Stop posted an edit request");
  await expectVisibleText(page, "User stop recorded; stale results ignored", "stopped sanitized report");
  await page.close();
}

async function runStaleEditAfterStopScenario(guiBaseUrl) {
  const page = await createSmokePage(guiBaseUrl);
  await startOneStep(page);
  const readRequest = await firstBridgeMessage(page, (message) => message?.type === "gui.controlledAgentFileReadRequest");
  await dispatchHostMessage(page, controlledReadHostMessage(readRequest));
  const editRequest = await firstBridgeMessage(page, (message) => message?.type === "gui.controlledAgentEditRequest");
  assert(editRequest?.requestId, "read result did not post one controlled edit request");
  await page.getByRole("button", { name: "Stop one-step Agent Run" }).click();
  await dispatchHostMessage(page, controlledEditHostMessage(editRequest));
  await page.waitForTimeout(150);
  assert.equal(await bridgeMessageCount(page, "gui.controlledAgentCommandRunRequest"), 0, "stale edit after Stop posted a command request");
  await expectVisibleText(page, "Phase: stopped", "stale edit kept stopped phase");
  await page.close();
}

async function runStaleCommandAfterStopScenario(guiBaseUrl) {
  const page = await createSmokePage(guiBaseUrl);
  const commandRequest = await reachOneStepCommandRequest(page);
  await page.getByRole("button", { name: "Stop one-step Agent Run" }).click();
  await dispatchHostMessage(page, controlledCommandRunHostMessage(commandRequest));
  await page.waitForTimeout(150);
  await expectVisibleText(page, "Phase: stopped", "stale command kept stopped phase");
  await assertNoVisibleText(page, "Phase: completed", "completed state after stale command");
  await page.close();
}

async function runFailedVerificationScenario(guiBaseUrl) {
  const page = await createSmokePage(guiBaseUrl);
  const commandRequest = await reachOneStepCommandRequest(page);
  await dispatchHostMessage(page, controlledCommandRunHostMessage(commandRequest, { status: "failed", exitCode: 1, message: "Checks failed safely.", outputTail: "sanitized verification failure" }));
  await expectVisibleText(page, "Phase: failed", "failed verification phase");
  await expectVisibleText(page, "Verification failed or recovery failed closed", "failed sanitized report");
  await expectVisibleText(page, "Allowlisted verification failed; no automatic repair is started.", "failed verification limitation");
  await assertNoVisibleText(page, rawMarkers[7], "hidden command marker after failed verification");
  await page.close();
}

async function runRuntimeDisconnectScenario(guiBaseUrl) {
  const page = await createSmokePage(guiBaseUrl);
  const commandRequest = await reachOneStepCommandRequest(page);
  await dispatchHostMessage(page, {
    version: bridgeVersion,
    type: "host.runtimeStatus",
    payload: runtimeStatusPayload({ lifecycle: "disconnected", diagnosis: "runtime disconnected", nextAction: "Reconnect manually." }),
  });
  await dispatchHostMessage(page, controlledCommandRunHostMessage(commandRequest));
  await page.waitForTimeout(150);
  assert.equal(await bridgeMessageCount(page, "gui.controlledAgentCommandRunRequest"), 1, "runtime disconnect caused a retry command request");
  const blocked = createDevPreviewReport({
    host: "vscode",
    status: "blocked",
    limitations: ["runtime_disconnect"],
    evidence: [{ kind: "status", status: "runtime_disconnect", summary: "Runtime disconnected; stale host results ignored." }],
  });
  assert(blocked.limitationLabels.includes("Runtime disconnect stopped the controlled run; stale host results are ignored and no auto-retry starts."), "runtime disconnect limitation was not surfaced as blocked metadata");
  await page.close();
}

function verifyRepairAndUnsafeMetadataContracts() {
  const failed = createDevPreviewReport({
    host: "vscode",
    status: "failed",
    limitations: ["verification_failed"],
    evidence: [{ kind: "verification", status: "verification_failed", summary: "sanitized verification failure" }],
  });
  assert.equal(failed.statusLabel, "Verification failed or recovery failed closed");
  assert(failed.limitationLabels.includes("Allowlisted verification failed; no automatic repair is started."));

  const eligibleRepair = createRepairLoop({ verification: { status: "failed", result: { status: "failed", message: "Failed allowlisted verification." } } });
  assert.equal(eligibleRepair.state, "eligible");
  assert.equal(eligibleRepair.canAttemptRepair, true);
  assert.equal(eligibleRepair.attemptCount, 0);

  const confirmedRepair = createRepairLoop({ verification: { status: "failed" }, userConfirmed: true, proposal: { state: "planned", summary: "Sanitized repair draft ready." } });
  assert.equal(confirmedRepair.state, "proposal_ready");
  assert.equal(confirmedRepair.userTurns, 1);
  assert.equal(confirmedRepair.attemptCount, 0);

  const exhaustedRepair = createRepairLoop({ verification: { status: "failed" }, attemptCount: 1 });
  assert.equal(exhaustedRepair.state, "exhausted");
  assert.equal(exhaustedRepair.canAttemptRepair, false);
  assert.equal(exhaustedRepair.attemptCount, 1);

  const unsafe = createDevPreviewReport({
    host: "vscode",
    status: "completed",
    evidence: [{ kind: "status", rawCommand: rawMarkers[7], summary: `${rawMarkers[0]} ${rawMarkers[8]}` }],
  });
  assert.equal(unsafe.evidence[0]?.label, "Omitted unsafe evidence");
  assertNoRawMarkers(JSON.stringify({ failed, eligibleRepair, confirmedRepair, exhaustedRepair, unsafe }), "service recovery contracts");
}

function createDevPreviewReport(input) {
  return createControlledAgentDevPreviewReport(input);
}

function createRepairLoop(input) {
  return evaluateControlledAgentRepairLoop(input);
}

async function reachOneStepCommandRequest(page) {
  await startOneStep(page);
  const readRequest = await firstBridgeMessage(page, (message) => message?.type === "gui.controlledAgentFileReadRequest");
  await dispatchHostMessage(page, controlledReadHostMessage(readRequest));
  const editRequest = await firstBridgeMessage(page, (message) => message?.type === "gui.controlledAgentEditRequest");
  await dispatchHostMessage(page, controlledEditHostMessage(editRequest));
  const commandRequest = await firstBridgeMessage(page, (message) => message?.type === "gui.controlledAgentCommandRunRequest");
  assert.equal(commandRequest?.payload?.commandId, "repository-check", "one-step command request must be allowlisted by id");
  return commandRequest;
}

async function startOneStep(page) {
  await expectVisibleText(page, "S96 useful one-step Agent Run", "one-step panel");
  await page.getByRole("button", { name: "Start one-step Agent Run" }).click();
}

async function createSmokePage(guiBaseUrl) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__yetAiVsCodeMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__yetAiVsCodeMessages.push(message);
      },
    });
  });
  page.on("console", (message) => {
    const text = message.text();
    assertNoRawMarkers(text, "browser console");
    if (message.type() === "error" && !isExpectedAgentRunFetchConsoleError(text)) failures.push(`Browser console error: ${redactSecrets(text)}`);
  });
  page.on("pageerror", (error) => {
    assertNoRawMarkers(error.message, "page error");
    failures.push(`Page JavaScript error: ${redactSecrets(error.message)}`);
  });
  page.on("request", (request) => {
    if (!isAgentRunAllowedNetworkUrl(request.url(), guiBaseUrl)) failures.push(`Unexpected network request: ${request.method()} ${redactAgentRunUrl(request.url(), redactSecrets)}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(`${guiBaseUrl}/`) && isAgentRunJsOrCssAssetRequest(request.url(), request.resourceType())) failures.push(`Failed JS/CSS asset request: ${request.method()} ${redactAgentRunUrl(request.url(), redactSecrets)}`);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (new URL(url).origin === agentRunBuiltGuiRuntimeOrigin) {
      runtimeRequests.push({ method: request.method(), endpoint: new URL(url).pathname });
      const response = await mockRuntimeResponse(url, request.method(), request.postData() ?? "");
      if (!response) {
        failures.push(`Unexpected runtime request: ${request.method()} ${redactAgentRunUrl(url, redactSecrets)}`);
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unexpected local mock endpoint" }) });
        return;
      }
      await route.fulfill(response);
      return;
    }
    if (url.startsWith(`${guiBaseUrl}/`)) {
      await route.continue();
      return;
    }
    failures.push(`Unexpected network request blocked: ${request.method()} ${redactAgentRunUrl(url, redactSecrets)}`);
    await route.abort("blockedbyclient");
  });
  await page.goto(`${guiBaseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 5000 });
  await firstBridgeMessage(page, (message) => message?.type === "gui.ready");
  return page;
}

async function mockRuntimeResponse(value, method) {
  const url = new URL(value);
  if (method === "GET" && url.pathname === "/v1/ping") return json({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-07-07T00:00:00Z" });
  if (method === "GET" && url.pathname === "/v1/caps") return json(capsResponse());
  if (method === "GET" && url.pathname === "/v1/models") return json({ models: [agentRunBuiltGuiModelSummary()] });
  if (method === "GET" && url.pathname === "/v1/demo-mode") return json({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "Demo Mode disabled for recovery smoke." });
  if (method === "GET" && url.pathname === "/v1/providers") return json({ providers: [agentRunBuiltGuiProviderSummary()], cloudRequired: false, providerAccess: "direct" });
  if (method === "GET" && url.pathname === "/v1/provider-auth/openai/status") return json({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: false, supportsApiKey: true, cloudRequired: false, message: "OpenAI account login is not available for this local mock." });
  if (method === "GET" && url.pathname === "/v1/chats") return json({ chats: [] });
  if (method === "GET" && url.pathname === "/v1/chats/chat-001") return json({ chatId: "chat-001", title: "Recovery smoke", createdAt: "2026-07-07T00:00:00Z", updatedAt: "2026-07-07T00:00:00Z", messages: [] });
  if (method === "GET" && url.pathname === "/v1/agent-progress") return json({ cloudRequired: false, providerAccess: "direct", generatedAt: "2026-07-07T00:00:00Z", snapshots: [] });
  if (method === "GET" && url.pathname === "/v1/project-memory") return json({ notes: [], cloudRequired: false, providerAccess: "direct" });
  if (method === "POST" && url.pathname === "/v1/project-memory/search") return json({ queryLabel: "recovery", matches: [], cloudRequired: false, providerAccess: "direct" });
  return undefined;
}

function capsResponse() {
  return {
    productId: "yet-ai",
    protocolVersion: bridgeVersion,
    runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
    capabilities: [],
    features: {},
    providers: [agentRunBuiltGuiProviderSummary()],
    ide: { bridge: true, lsp: false, host: "vscode" },
    controlledAgentWorkspaceReadiness: fixtures.workspace,
    controlledAgentRuntimeSession: fixtures.runtimeSession,
    controlledAgentEditExecutor: controlledEditMetadata(),
  };
}

function controlledEditMetadata() {
  const replacementText = "const title = \"Yet AI\";\n";
  const metadata = structuredClone(fixtures.editExecutor);
  metadata.runId = "run-s97-recovery";
  metadata.workspaceReadinessId = "ready-s97-recovery";
  metadata.edits[0].replacementText = replacementText;
  metadata.edits[0].replacementByteCount = new TextEncoder().encode(replacementText).length;
  metadata.edits[0].sanitizedSummary = "Update selected UI metadata lines.";
  return metadata;
}

function controlledReadHostMessage(message, overrides = {}) {
  const payload = structuredClone(fixtures.fileRead.payload);
  payload.request.requestId = overrides.requestId ?? message.requestId;
  payload.request.workspaceRelativePath = message.payload.workspaceRelativePath;
  payload.workspace.runId = message.payload.runId;
  payload.workspace.controlledWorkspaceId = message.payload.controlledWorkspaceId;
  payload.result.sanitizedPathLabel = message.payload.workspaceRelativePath;
  return { version: bridgeVersion, type: "host.controlledAgentFileReadResult", requestId: message.requestId, payload };
}

function controlledEditHostMessage(message, overrides = {}) {
  const payload = structuredClone(fixtures.editApplied.payload);
  payload.requestId = overrides.requestId ?? message.requestId;
  payload.runId = message.payload.runId;
  payload.controlledWorkspaceId = message.payload.controlledWorkspaceId;
  payload.runtimeSessionId = message.payload.runtimeSessionId;
  payload.workspaceReadinessId = message.payload.workspaceReadinessId;
  payload.edits = structuredClone(message.payload.edits).map((edit) => {
    delete edit.replacementText;
    return edit;
  });
  return { version: bridgeVersion, type: "host.controlledAgentEditResult", requestId: message.requestId, payload: { ...payload, ...overrides } };
}

function controlledCommandRunHostMessage(message, overrides = {}) {
  const status = overrides.status ?? "succeeded";
  const outputTail = overrides.outputTail ?? "Repository validation completed with sanitized metadata";
  return {
    version: bridgeVersion,
    type: "host.controlledAgentCommandRunResult",
    requestId: message.requestId,
    payload: {
      requestId: overrides.requestId ?? message.requestId,
      requestIdMintedBy: "gui",
      controlledWorkspaceId: message.payload.controlledWorkspaceId,
      runId: message.payload.runId,
      runtimeSessionId: message.payload.runtimeSessionId,
      workspaceReadinessId: message.payload.workspaceReadinessId,
      userConfirmed: true,
      commandId: message.payload.commandId,
      authority: "allowlisted_command_id",
      cloudRequired: false,
      executionAllowed: false,
      freeformCommandAllowed: false,
      policyFlags: message.payload.policyFlags,
      status,
      message: overrides.message ?? (status === "succeeded" ? "Repository validation succeeded safely." : "Checks failed safely."),
      exitCode: overrides.exitCode ?? (status === "succeeded" ? 0 : 1),
      durationMs: 1234,
      outputTail,
      outputByteCount: String(outputTail).length,
      outputLineCount: 1,
      resultHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      truncated: false,
    },
  };
}

function runtimeStatusPayload(overrides = {}) {
  return {
    protocolVersion: "2026-06-21",
    productId: "yet-ai",
    surface: "vscode",
    lifecycle: "connected",
    tokenState: "valid",
    diagnosis: "runtime connected",
    nextAction: "Use explicit controls when ready.",
    ...overrides,
  };
}

async function firstBridgeMessage(page, predicate) {
  await page.waitForFunction((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiVsCodeMessages?.some((message) => matcher(message));
  }, predicate.toString(), { timeout: 10_000 });
  return await page.evaluate((predicateText) => {
    const matcher = new Function("message", `return (${predicateText})(message);`);
    return window.__yetAiVsCodeMessages.find((message) => matcher(message));
  }, predicate.toString());
}

async function bridgeMessageCount(page, type) {
  return await page.evaluate((messageType) => (window.__yetAiVsCodeMessages ?? []).filter((message) => message?.type === messageType).length, type);
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((hostMessage) => window.dispatchEvent(new MessageEvent("message", { data: hostMessage })), message);
}

async function expectVisibleText(page, text, description) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for ${description}. ${messageOf(error)}\nVisible body excerpt: ${redactSecrets(body).slice(0, 5000)}`);
  }
}

async function assertNoVisibleText(page, text, description) {
  const count = await page.getByText(text, { exact: false }).count();
  assert.equal(count, 0, `unexpected ${description}`);
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function importGuiService(entry) {
  const { imports, cleanup } = await transpileGuiServices([entry]);
  try {
    return imports.get(entry);
  } finally {
    await cleanup();
  }
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(path.join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(path.join(tmpdir(), "yet-controlled-recovery-smoke-ts-"));
  const queue = entries.map((entry) => path.join(guiSrcRoot, entry));
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const sourcePath = queue[index];
    if (seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = path.join(path.dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) queue.push(dependency);
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = path.join(outRoot, path.relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  const imports = new Map();
  for (const entry of entries) {
    imports.set(entry, await import(pathToFileURL(path.join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}

function assertNoRawMarkers(value, source) {
  const text = String(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker ${index + 1} leaked through ${source}`);
  }
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(String(value)), false, `${source} leaked provider-style secret`);
  assert.equal(/\/(?:Users|home|private)\//i.test(String(value)), false, `${source} leaked private path`);
}

function redactSecrets(value) {
  let text = String(value);
  for (const marker of rawMarkers) text = text.split(marker).join("[redacted]");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\/(?:Users|home|private)\/[^\n\s]*/gi, "/[redacted]");
}
