import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const bridgeVersion = "2026-05-15";
const secretMarkers = [
  `sk-vscode-edit-${randomUUID()}`,
  `Bearer vscode-edit-token-${randomUUID()}`,
  `access_token=${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`,
  "/Users/alice/private/yet-ai-secret.ts",
  "C:\\Users\\Alice\\private\\yet-ai-secret.ts",
];
const safeProposal = createProposal();
const oversizedProposal = createProposal({ edit: { replacementText: "x".repeat(8193) }, summary: "Oversized replacement rejected locally." });
const unsafePathProposal = createProposal({ edit: { workspaceRelativePath: "../private/secret.ts" }, summary: "Unsafe path rejected locally." });
const failures = [];
const consoleMessages = [];
const hostResults = [];
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-vscode-edit-smoke-"));
const fixturePath = path.join(workspaceRoot, "src", "main.ts");
let browser;

try {
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, "const label = \"Before\";\n", { flag: "w" });

  const { chromium } = await requireChromium();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/*", async (route) => {
    failures.push("Unexpected browser network request outside local inline harness.");
    await route.abort();
  });
  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(text);
    assertNoLeak(text, "browser console");
  });
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${sanitize(error.message)}`));

  await page.setContent(harnessHtml(), { waitUntil: "domcontentloaded" });
  await page.evaluate(({ version, proposal, oversized, unsafe }) => {
    window.__yetAiLoadProposal(version, proposal);
    window.__yetAiOversizedProposal = oversized;
    window.__yetAiUnsafeProposal = unsafe;
  }, { version: bridgeVersion, proposal: safeProposal, oversized: oversizedProposal, unsafe: unsafePathProposal });

  await expectVisible(page, "Confirmed edit proposal");
  await expectVisible(page, "preview only");
  await expectVisible(page, "Files: 1");
  await expectVisible(page, "Text edits: 1");
  await expectVisible(page, "src/main.ts");
  await expectVisible(page, "const label = \"After\";");

  const beforeClickMessages = await bridgeMessages(page);
  if (beforeClickMessages.some((message) => message.type === "gui.applyWorkspaceEditRequest")) {
    failures.push("GUI emitted an apply request before explicit user action.");
  }

  await page.getByRole("button", { name: "Request host apply after review" }).click();
  const acceptedRequest = await waitForApplyRequest(page, 1);
  const acceptedResult = await handleApplyWorkspaceEditRequest(acceptedRequest, { confirmed: true });
  hostResults.push(acceptedResult);
  await dispatchHostResult(page, acceptedRequest.requestId, acceptedResult);
  await expectVisible(page, "Applied 1 edit to 1 file.");
  const editedFixture = await readFile(fixturePath, "utf8");
  if (editedFixture !== "const label = \"After\";\n") {
    failures.push("Accepted host confirmation did not apply the controlled temp fixture edit.");
  }

  await writeFile(fixturePath, "const label = \"Before\";\n");
  await page.evaluate(({ version, proposal }) => window.__yetAiLoadProposal(version, proposal), { version: bridgeVersion, proposal: safeProposal });
  await page.getByRole("button", { name: "Request host apply after review" }).click();
  const deniedRequest = await waitForApplyRequest(page, 2);
  const deniedResult = await handleApplyWorkspaceEditRequest(deniedRequest, { confirmed: false });
  hostResults.push(deniedResult);
  await dispatchHostResult(page, deniedRequest.requestId, deniedResult);
  await expectVisible(page, "Host confirmation denied the edit request.");
  const deniedFixture = await readFile(fixturePath, "utf8");
  if (deniedFixture !== "const label = \"Before\";\n") {
    failures.push("Denied host confirmation mutated the controlled temp fixture.");
  }

  const unsafeResult = await handleApplyWorkspaceEditRequest(createApplyRequest("unsafe-path", unsafePathProposal), { confirmed: true });
  hostResults.push(unsafeResult);
  if (unsafeResult.payload.status !== "rejected") {
    failures.push("Unsafe workspace-relative path was not rejected.");
  }
  const oversizedResult = await handleApplyWorkspaceEditRequest(createApplyRequest("oversized-edit", oversizedProposal), { confirmed: true });
  hostResults.push(oversizedResult);
  if (oversizedResult.payload.status !== "rejected") {
    failures.push("Oversized edit was not rejected.");
  }

  const visibleState = await page.evaluate(() => [document.body.innerText, JSON.stringify(window.__yetAiBridgeMessages ?? []), JSON.stringify(window.__yetAiHostResults ?? []), safeStorageLength("localStorage"), safeStorageLength("sessionStorage")].join("\n"));
  assertNoLeak(visibleState, "browser-visible text, bridge messages, or storage");
  assertNoLeak(JSON.stringify(hostResults), "host result payloads");
  assertBoundedOutput(visibleState, "browser-visible state");
  assertBoundedOutput(consoleMessages.join("\n"), "browser console output");

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("VS Code edit-proposal smoke passed.");
  console.log("Verified preview-only rendering, explicit apply emission, accepted and denied host confirmations, unsafe path rejection, oversized edit rejection, temp-fixture cleanup, loopback-free browser harness, and browser-visible redaction.");
  console.log("No OpenAI, ChatGPT, hosted Yet AI service, real provider credential, VS Code launch, shell/tool/task/git execution, or real workspace mutation was used.");
} finally {
  await browser?.close().catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
}

async function requireChromium() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("VS Code edit-proposal smoke failed: Playwright is not installed or cannot be loaded.");
    console.error("Run `npm install` from the repository root, then run `npx playwright install chromium` if Chromium is not installed yet.");
    console.error(`Load error: ${sanitize(messageOf(error))}`);
    process.exit(1);
  }
}

function createProposal(overrides = {}) {
  const editOverrides = overrides.edit ?? {};
  const { edit: _edit, ...payloadOverrides } = overrides;
  return {
    requiresUserConfirmation: true,
    summary: "Replace one visible editor line after user review.",
    cloudRequired: false,
    edits: [{
      workspaceRelativePath: "src/main.ts",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 23 } },
      replacementText: "const label = \"After\";",
      ...editOverrides,
    }],
    ...payloadOverrides,
  };
}

function harnessHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Yet AI VS Code edit smoke</title></head>
<body>
  <main id="root" aria-label="Yet AI edit proposal smoke"></main>
  <script>
    const secretPatterns = [/Bearer\\s+\\S+/gi, /sk-[A-Za-z0-9_-]{8,}/g, /access_token=[A-Za-z0-9_-]+/gi, /\\/Users\\/[^\\s]+/g, /C:\\\\Users\\\\[^\\s]+/g];
    window.__yetAiBridgeMessages = [];
    window.__yetAiHostResults = [];
    window.acquireVsCodeApi = () => ({ postMessage(message) { window.__yetAiBridgeMessages.push(message); } });
    const vscode = window.acquireVsCodeApi();
    function sanitize(value) {
      let text = String(value ?? "");
      for (const pattern of secretPatterns) text = text.replace(pattern, "[redacted]");
      return text.slice(0, 1000);
    }
    function safeStorageLength(name) {
      try { return window[name].length; } catch { return 0; }
    }
    function renderProposal(version, proposal) {
      const root = document.getElementById("root");
      root.innerHTML = "";
      if (!isProposal(proposal)) {
        root.textContent = "No valid edit proposal.";
        return;
      }
      const section = document.createElement("section");
      section.setAttribute("aria-label", "Edit proposal preview");
      const title = document.createElement("h1");
      title.textContent = "Confirmed edit proposal";
      const badge = document.createElement("span");
      badge.textContent = "preview only";
      const summary = document.createElement("p");
      summary.textContent = sanitize(proposal.summary);
      const stats = document.createElement("p");
      stats.textContent = "Files: " + new Set(proposal.edits.map((edit) => edit.workspaceRelativePath)).size + " · Text edits: " + proposal.edits.length;
      const list = document.createElement("ul");
      for (const edit of proposal.edits) {
        const item = document.createElement("li");
        item.textContent = sanitize(edit.workspaceRelativePath) + " → " + sanitize(edit.replacementText);
        list.append(item);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Request host apply after review";
      button.addEventListener("click", () => {
        vscode.postMessage({ version, type: "gui.applyWorkspaceEditRequest", requestId: "gui-edit-proposal-smoke-" + Date.now(), payload: proposal });
      });
      const result = document.createElement("p");
      result.id = "apply-result";
      section.append(title, badge, summary, stats, list, button, result);
      root.append(section);
    }
    function isProposal(value) {
      return value && value.requiresUserConfirmation === true && value.cloudRequired === false && typeof value.summary === "string" && Array.isArray(value.edits) && value.edits.length > 0 && value.edits.length <= 8;
    }
    window.__yetAiLoadProposal = renderProposal;
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.version !== "${bridgeVersion}" || message.type !== "host.applyWorkspaceEditResult" || !message.payload) return;
      window.__yetAiHostResults.push(message);
      const target = document.getElementById("apply-result");
      if (!target) return;
      if (message.payload.status === "applied") target.textContent = "Applied " + message.payload.appliedEditCount + " edit to " + message.payload.affectedFiles.length + " file.";
      else if (message.payload.status === "denied") target.textContent = "Host confirmation denied the edit request.";
      else target.textContent = "Host rejected the edit request.";
    });
  </script>
</body>
</html>`;
}

async function handleApplyWorkspaceEditRequest(message, options) {
  if (!isApplyRequest(message)) {
    return result(message?.requestId, "rejected", "Invalid edit request.");
  }
  const edit = message.payload.edits[0];
  if (!options.confirmed) {
    return result(message.requestId, "denied", "Host confirmation denied.");
  }
  const target = path.join(workspaceRoot, edit.workspaceRelativePath);
  const relative = path.relative(workspaceRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || edit.workspaceRelativePath.includes("\\") || edit.workspaceRelativePath.startsWith("/")) {
    return result(message.requestId, "rejected", "Unsafe workspace path rejected.");
  }
  if (edit.replacementText.length > 8192) {
    return result(message.requestId, "rejected", "Oversized edit rejected.");
  }
  if (edit.range.start.line > edit.range.end.line || (edit.range.start.line === edit.range.end.line && edit.range.start.character > edit.range.end.character)) {
    return result(message.requestId, "rejected", "Invalid edit range rejected.");
  }
  if (edit.workspaceRelativePath !== "src/main.ts") {
    return result(message.requestId, "rejected", "File outside fixture rejected.");
  }
  const current = await readFile(target, "utf8");
  const lines = current.split("\n");
  const line = lines[edit.range.start.line];
  if (typeof line !== "string" || edit.range.end.line !== edit.range.start.line || edit.range.end.character > line.length) {
    return result(message.requestId, "rejected", "Range outside fixture rejected.");
  }
  lines[edit.range.start.line] = line.slice(0, edit.range.start.character) + edit.replacementText + line.slice(edit.range.end.character);
  await writeFile(target, lines.join("\n"));
  return {
    version: bridgeVersion,
    type: "host.applyWorkspaceEditResult",
    requestId: message.requestId,
    payload: { status: "applied", message: "Applied confirmed edit.", appliedEditCount: 1, affectedFiles: [edit.workspaceRelativePath] },
  };
}

function isApplyRequest(message) {
  if (!message || message.version !== bridgeVersion || message.type !== "gui.applyWorkspaceEditRequest" || typeof message.requestId !== "string") return false;
  const payload = message.payload;
  if (!payload || payload.requiresUserConfirmation !== true || payload.cloudRequired !== false || !Array.isArray(payload.edits) || payload.edits.length !== 1) return false;
  const edit = payload.edits[0];
  return typeof payload.summary === "string" && typeof edit?.workspaceRelativePath === "string" && isRange(edit.range) && typeof edit.replacementText === "string";
}

function isRange(range) {
  return isPosition(range?.start) && isPosition(range?.end);
}

function isPosition(position) {
  return Number.isInteger(position?.line) && position.line >= 0 && Number.isInteger(position?.character) && position.character >= 0;
}

function result(requestId, status, message) {
  return { version: bridgeVersion, type: "host.applyWorkspaceEditResult", requestId: String(requestId ?? "unknown"), payload: { status, message, appliedEditCount: 0, affectedFiles: [] } };
}

function createApplyRequest(requestId, payload) {
  return { version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", requestId: `gui-edit-proposal-${requestId}`, payload };
}

async function waitForApplyRequest(page, count) {
  await page.waitForFunction((expected) => (window.__yetAiBridgeMessages ?? []).filter((message) => message?.type === "gui.applyWorkspaceEditRequest").length >= expected, count, { timeout: 5000 });
  return page.evaluate((expected) => window.__yetAiBridgeMessages.filter((message) => message?.type === "gui.applyWorkspaceEditRequest")[expected - 1], count);
}

async function dispatchHostResult(page, requestId, message) {
  await page.evaluate(({ version, requestId, payload }) => {
    window.dispatchEvent(new MessageEvent("message", { data: { version, type: "host.applyWorkspaceEditResult", requestId, payload } }));
  }, { version: bridgeVersion, requestId, payload: message.payload });
}

async function bridgeMessages(page) {
  return page.evaluate(() => window.__yetAiBridgeMessages ?? []);
}

async function expectVisible(page, text) {
  const visible = await page.getByText(text, { exact: false }).first().isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    failures.push(`Missing expected visible smoke text: ${text}`);
  }
}

function assertNoLeak(value, source) {
  const text = String(value);
  for (const marker of secretMarkers) {
    if (text.includes(marker)) {
      throw new Error(`${source} leaked a raw secret or private-path marker.`);
    }
  }
}

function assertBoundedOutput(value, source) {
  if (String(value).length > 20000) {
    failures.push(`${source} exceeded the smoke output bound.`);
  }
}

function sanitize(value) {
  let text = String(value);
  for (const marker of secretMarkers) {
    text = text.split(marker).join("[redacted]");
  }
  return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/\/Users\/[^\s]+/g, "[redacted]").slice(0, 1000);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportFailures() {
  console.error("VS Code edit-proposal smoke failed:");
  for (const failure of failures.slice(0, 20)) {
    console.error(`- ${sanitize(failure)}`);
  }
  process.exit(1);
}
