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
const oversizedProposal = createProposal({ replacement: { replacementText: "x".repeat(8193) }, summary: "Oversized replacement rejected locally." });
const unsafeSummaryProposal = createProposal({ summary: `Review sanitized marker ${secretMarkers[0]}.` });
const leakProposal = createProposal({ summary: "Review sanitized replacement marker.", replacement: { replacementText: `const label = "${secretMarkers[1]}";` } });
const invalidPathProposals = [
  ["traversal", "../private/secret.ts"],
  ["empty-segment", "src//main.ts"],
  ["trailing-slash", "src/"],
  ["backslash", "src\\main.ts"],
  ["url-like", "https://example.invalid/src/main.ts"],
  ["encoded-traversal", "src/%2e%2e/private.ts"],
  ["posix-absolute", "/tmp/yet-ai/private.ts"],
  ["drive-letter", "C:\\Users\\Alice\\workspace\\main.ts"],
].map(([name, workspaceRelativePath]) => [name, createProposal({ edit: { workspaceRelativePath }, summary: "Unsafe path rejected locally." })]);
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
    collectNoLeak(text, "browser console");
  });
  page.on("pageerror", (error) => failures.push(`Page JavaScript error: ${sanitize(error.message)}`));

  await page.setContent(harnessHtml(), { waitUntil: "load" });
  if (await page.evaluate(() => typeof window.__yetAiLoadProposal !== "function")) {
    failures.push("Inline edit proposal harness did not initialize.");
    reportFailures();
  }
  await page.evaluate(({ version, proposal, oversized, leak }) => {
    window.__yetAiLoadProposal(version, proposal);
    window.__yetAiOversizedProposal = oversized;
    window.__yetAiLeakProposal = leak;
  }, { version: bridgeVersion, proposal: safeProposal, oversized: oversizedProposal, leak: leakProposal });

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
  assertApplyRequestShape(acceptedRequest, "accepted request");
  await page.getByRole("button", { name: "Host apply pending…" }).click({ trial: true }).catch(() => undefined);
  await page.getByRole("button", { name: "Host apply pending…" }).click({ force: true }).catch(() => undefined);
  const pendingDoubleClickCount = (await bridgeMessages(page)).filter((message) => message.type === "gui.applyWorkspaceEditRequest").length;
  if (pendingDoubleClickCount !== 1) {
    failures.push("Double-click/pending apply emitted more than one request.");
  }
  await dispatchHostResult(page, "gui-edit-proposal-mismatch", result("gui-edit-proposal-mismatch", "failed", "Mismatched pending result ignored."));
  if ((await page.evaluate(() => document.body.innerText)).includes("Mismatched pending result ignored.")) {
    failures.push("Mismatched host result was displayed while a different request was pending.");
  }
  const acceptedResult = await handleApplyWorkspaceEditRequest(acceptedRequest, { confirmed: true });
  assertHostResultShape(acceptedResult, "accepted result");
  hostResults.push(acceptedResult);
  await dispatchHostResult(page, acceptedRequest.requestId, acceptedResult);
  await expectVisible(page, "Applied 1 edit to 1 file.");
  await dispatchHostResult(page, acceptedRequest.requestId, result(acceptedRequest.requestId, "failed", "Stale second result ignored."));
  if ((await page.evaluate(() => document.body.innerText)).includes("Stale second result ignored.")) {
    failures.push("Stale second matching host result replaced the completed pending result.");
  }
  const editedFixture = await readFile(fixturePath, "utf8");
  if (editedFixture !== "const label = \"After\";\n") {
    failures.push("Accepted host confirmation did not apply the controlled temp fixture edit.");
  }

  await writeFile(fixturePath, "const label = \"Before\";\n");
  await page.evaluate(({ version, proposal }) => window.__yetAiLoadProposal(version, proposal), { version: bridgeVersion, proposal: safeProposal });
  await page.getByRole("button", { name: "Request host apply after review" }).click();
  const deniedRequest = await waitForApplyRequest(page, 2);
  assertApplyRequestShape(deniedRequest, "denied request");
  const deniedResult = await handleApplyWorkspaceEditRequest(deniedRequest, { confirmed: false });
  assertHostResultShape(deniedResult, "denied result");
  hostResults.push(deniedResult);
  await dispatchHostResult(page, deniedRequest.requestId, deniedResult);
  await expectVisible(page, "Host confirmation denied the edit request.");
  const deniedFixture = await readFile(fixturePath, "utf8");
  if (deniedFixture !== "const label = \"Before\";\n") {
    failures.push("Denied host confirmation mutated the controlled temp fixture.");
  }

  for (const [name, proposal] of invalidPathProposals) {
    const unsafeResult = await handleApplyWorkspaceEditRequest(createApplyRequest(`unsafe-path-${name}`, proposal), { confirmed: true });
    assertHostResultShape(unsafeResult, `unsafe path result ${name}`);
    hostResults.push(unsafeResult);
    if (unsafeResult.payload.status !== "rejected") {
      failures.push(`Unsafe workspace-relative path variant was not rejected: ${name}.`);
    }
  }
  const oversizedResult = await handleApplyWorkspaceEditRequest(createApplyRequest("oversized-edit", oversizedProposal), { confirmed: true });
  assertHostResultShape(oversizedResult, "oversized result");
  hostResults.push(oversizedResult);
  if (oversizedResult.payload.status !== "rejected") {
    failures.push("Oversized edit was not rejected.");
  }

  await page.evaluate(({ version, proposal }) => window.__yetAiLoadProposal(version, proposal), { version: bridgeVersion, proposal: unsafeSummaryProposal });
  const unsafeSummaryText = await page.evaluate(() => document.body.innerText);
  if (!unsafeSummaryText.includes("No valid edit proposal.") || unsafeSummaryText.includes("Confirmed edit proposal")) {
    failures.push("Unsafe key-like proposal summary rendered a proposal card.");
  }

  const hostResultCountBeforeUnsafeResult = await page.evaluate(() => (window.__yetAiHostResults ?? []).length);
  await page.evaluate(({ version, rawMessage }) => {
    window.dispatchEvent(new MessageEvent("message", { data: rawMessage }));
  }, {
    version: bridgeVersion,
    rawMessage: {
      version: bridgeVersion,
      type: "host.applyWorkspaceEditResult",
      requestId: "gui-edit-proposal-unsafe-result",
      payload: { status: "failed", message: `Failed ${secretMarkers[0]}`, cloudRequired: false, appliedEditCount: 0, affectedFiles: [] },
    },
  });
  const hostResultCountAfterUnsafeResult = await page.evaluate(() => (window.__yetAiHostResults ?? []).length);
  if (hostResultCountAfterUnsafeResult !== hostResultCountBeforeUnsafeResult) {
    failures.push("Unsafe key-like host result was captured or rendered.");
  }

  const hostResultCountBeforeLeak = await page.evaluate(() => (window.__yetAiHostResults ?? []).length);
  await page.evaluate(({ version, proposal, rawMessage }) => {
    window.__yetAiLoadProposal(version, proposal);
    window.dispatchEvent(new MessageEvent("message", { data: rawMessage }));
  }, {
    version: bridgeVersion,
    proposal: leakProposal,
    rawMessage: {
      version: bridgeVersion,
      type: "host.applyWorkspaceEditResult",
      requestId: "gui-edit-proposal-leak",
      payload: { status: "failed", message: `Raw ${secretMarkers[0]} ${secretMarkers[2]} ${secretMarkers[3]} ${secretMarkers[4]}`, cloudRequired: false, appliedEditCount: 0, affectedFiles: [] },
    },
  });
  await expectVisible(page, "[redacted]");
  const hostResultCountAfterLeak = await page.evaluate(() => (window.__yetAiHostResults ?? []).length);
  if (hostResultCountAfterLeak !== hostResultCountBeforeLeak) {
    failures.push("Unsafe raw host result was not rejected before browser-visible capture.");
  }

  const visibleState = await page.evaluate(() => [document.body.innerText, JSON.stringify(window.__yetAiBridgeMessages ?? []), JSON.stringify(window.__yetAiHostResults ?? []), storageSnapshot("localStorage"), storageSnapshot("sessionStorage")].join("\n"));
  assertNoLeak(visibleState, "browser-visible text, bridge messages, host results, localStorage, or sessionStorage");
  assertNoLeak(JSON.stringify(hostResults), "captured host result payloads");
  assertNoLeak(consoleMessages.join("\n"), "console output");
  assertBoundedOutput(visibleState, "browser-visible state");
  assertBoundedOutput(consoleMessages.join("\n"), "browser console output");

  if (failures.length > 0) {
    reportFailures();
  }

  console.log("VS Code edit-proposal smoke passed.");
  console.log("Verified contract-shaped textReplacements, explicit apply emission, accepted and denied host confirmations, unsafe path variants, oversized edit rejection, sanitized leak handling, temp-fixture cleanup, and loopback-free browser harness.");
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
  const replacementOverrides = overrides.replacement ?? {};
  const { edit: _edit, replacement: _replacement, ...payloadOverrides } = overrides;
  return {
    requiresUserConfirmation: true,
    summary: "Replace one visible editor line after user review.",
    cloudRequired: false,
    edits: [{
      workspaceRelativePath: "src/main.ts",
      textReplacements: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 23 } },
        replacementText: "const label = \"After\";",
        ...replacementOverrides,
      }],
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
    const secretPatterns = [new RegExp("Bearer\\\\s+\\\\S+", "gi"), new RegExp("sk-[A-Za-z0-9_-]{8,}", "g"), new RegExp("access_token=[A-Za-z0-9_-]+", "gi")];
    window.__yetAiBridgeMessages = [];
    window.__yetAiHostResults = [];
    window.acquireVsCodeApi = () => ({ postMessage(message) { window.__yetAiBridgeMessages.push(message); } });
    const vscode = window.acquireVsCodeApi();
    function sanitize(value) {
      let text = String(value ?? "");
      for (const pattern of secretPatterns) text = text.replace(pattern, "[redacted]");
      return text.slice(0, 1000);
    }
    function storageSnapshot(name) {
      try {
        const storage = window[name];
        const entries = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          entries.push([sanitize(key), sanitize(storage.getItem(key))]);
        }
        return JSON.stringify(entries).slice(0, 2000);
      } catch {
        return "[]";
      }
    }
    let pendingRequestId = null;
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
      stats.textContent = "Files: " + new Set(proposal.edits.map((edit) => edit.workspaceRelativePath)).size + " · Text edits: " + proposal.edits.reduce((count, edit) => count + edit.textReplacements.length, 0);
      const list = document.createElement("ul");
      for (const edit of proposal.edits) {
        for (const replacement of edit.textReplacements) {
          const item = document.createElement("li");
          item.textContent = sanitize(edit.workspaceRelativePath) + " → " + sanitize(replacement.replacementText);
          list.append(item);
        }
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Request host apply after review";
      button.addEventListener("click", () => {
        if (pendingRequestId) return;
        pendingRequestId = "gui-edit-proposal-smoke-" + Date.now();
        button.disabled = true;
        button.textContent = "Host apply pending…";
        vscode.postMessage({ version, type: "gui.applyWorkspaceEditRequest", requestId: pendingRequestId, payload: proposal });
      });
      const result = document.createElement("p");
      result.id = "apply-result";
      section.append(title, badge, summary, stats, list, button, result);
      root.append(section);
    }
    function isProposal(value) {
      return value && value.requiresUserConfirmation === true && value.cloudRequired === false && safeSummary(value.summary) && Array.isArray(value.edits) && value.edits.length > 0 && value.edits.length <= 4 && value.edits.every((edit) => safeRelativePath(edit.workspaceRelativePath) && Array.isArray(edit.textReplacements) && edit.textReplacements.length > 0 && edit.textReplacements.length <= 16 && edit.textReplacements.every((replacement) => replacement && isRange(replacement.range) && typeof replacement.replacementText === "string" && replacement.replacementText.length <= 8192));
    }
    function safeSummary(value) {
      return typeof value === "string" && value.length > 0 && value.length <= 1000 && !/authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content/i.test(value) && !/(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}/.test(value) && !hasPrivatePathLikeText(value);
    }
    function hasPrivatePathLikeText(value) {
      return value.includes("/Users/") || value.includes("/home/") || value.includes("/tmp/") || value.includes("/var/") || value.includes("/Volumes/") || value.includes("/Private/") || value.includes("~/") || value.includes(String.fromCharCode(126, 92)) || /[A-Za-z]:[\\/]/.test(value);
    }
    function safeRelativePath(value) {
      return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes(String.fromCharCode(92)) && !value.includes(":") && !value.includes("?") && !value.includes("#") && !hasControlCharacter(value) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
    }
    function hasControlCharacter(value) {
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || (code >= 127 && code <= 159)) return true;
      }
      return false;
    }
    function isRange(range) {
      return isPosition(range?.start) && isPosition(range?.end) && (range.end.line > range.start.line || (range.end.line === range.start.line && range.end.character >= range.start.character));
    }
    function isPosition(position) {
      return Number.isInteger(position?.line) && position.line >= 0 && Number.isInteger(position?.character) && position.character >= 0;
    }
    function isHostResult(message) {
      if (!message || message.version !== "${bridgeVersion}" || message.type !== "host.applyWorkspaceEditResult" || typeof message.requestId !== "string") return false;
      const payload = message.payload;
      if (!payload || payload.cloudRequired !== false || !["applied", "denied", "rejected", "failed"].includes(payload.status) || typeof payload.message !== "string" || payload.message.length === 0 || payload.message.length > 1000) return false;
      if (/authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content/i.test(payload.message)) return false;
      if (/(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}/.test(payload.message)) return false;
      if (hasPrivatePathLikeText(payload.message)) return false;
      return payload.appliedEditCount === undefined || Number.isInteger(payload.appliedEditCount);
    }
    window.__yetAiLoadProposal = renderProposal;
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!isHostResult(message)) return;
      if (message.requestId !== pendingRequestId) return;
      pendingRequestId = null;
      window.__yetAiHostResults.push(message);
      const target = document.getElementById("apply-result");
      if (!target) return;
      const button = document.querySelector("button");
      if (button) {
        button.disabled = false;
        button.textContent = "Request host apply after review";
      }
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
  const replacement = edit.textReplacements[0];
  if (!options.confirmed) {
    return result(message.requestId, "denied", "Host confirmation denied.");
  }
  const target = path.join(workspaceRoot, edit.workspaceRelativePath);
  const relative = path.relative(workspaceRoot, target);
  if (!safeRelativePath(edit.workspaceRelativePath) || relative.startsWith("..") || path.isAbsolute(relative)) {
    return result(message.requestId, "rejected", "Unsafe workspace path rejected.");
  }
  if (replacement.replacementText.length > 8192) {
    return result(message.requestId, "rejected", "Oversized edit rejected.");
  }
  if (replacement.range.start.line > replacement.range.end.line || (replacement.range.start.line === replacement.range.end.line && replacement.range.start.character > replacement.range.end.character)) {
    return result(message.requestId, "rejected", "Invalid edit range rejected.");
  }
  if (edit.workspaceRelativePath !== "src/main.ts") {
    return result(message.requestId, "rejected", "File outside fixture rejected.");
  }
  const current = await readFile(target, "utf8");
  const lines = current.split("\n");
  const line = lines[replacement.range.start.line];
  if (typeof line !== "string" || replacement.range.end.line !== replacement.range.start.line || replacement.range.end.character > line.length) {
    return result(message.requestId, "rejected", "Range outside fixture rejected.");
  }
  lines[replacement.range.start.line] = line.slice(0, replacement.range.start.character) + replacement.replacementText + line.slice(replacement.range.end.character);
  await writeFile(target, lines.join("\n"));
  return {
    version: bridgeVersion,
    type: "host.applyWorkspaceEditResult",
    requestId: message.requestId,
    payload: { status: "applied", message: "Applied confirmed edit.", cloudRequired: false, appliedEditCount: 1, affectedFiles: [edit.workspaceRelativePath] },
  };
}

function isApplyRequest(message) {
  if (!message || message.version !== bridgeVersion || message.type !== "gui.applyWorkspaceEditRequest" || typeof message.requestId !== "string") return false;
  const payload = message.payload;
  if (!payload || payload.requiresUserConfirmation !== true || payload.cloudRequired !== false || !Array.isArray(payload.edits) || payload.edits.length !== 1) return false;
  const edit = payload.edits[0];
  return typeof payload.summary === "string" && typeof edit?.workspaceRelativePath === "string" && Array.isArray(edit.textReplacements) && edit.textReplacements.length === 1 && isTextReplacement(edit.textReplacements[0]) && edit.range === undefined && edit.replacementText === undefined;
}

function isTextReplacement(replacement) {
  return isRange(replacement?.range) && typeof replacement.replacementText === "string";
}

function isRange(range) {
  return isPosition(range?.start) && isPosition(range?.end);
}

function isPosition(position) {
  return Number.isInteger(position?.line) && position.line >= 0 && Number.isInteger(position?.character) && position.character >= 0;
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes("\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && /^[^\u0000-\u001f\u007f-\u009f]+$/.test(value) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function result(requestId, status, message) {
  return { version: bridgeVersion, type: "host.applyWorkspaceEditResult", requestId: String(requestId ?? "unknown"), payload: { status, message, cloudRequired: false, appliedEditCount: 0, affectedFiles: [] } };
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

function assertApplyRequestShape(message, source) {
  if (!isApplyRequest(message)) {
    failures.push(`${source} did not use the strict textReplacements apply request shape.`);
    return;
  }
  const edit = message.payload.edits[0];
  if (Object.hasOwn(edit, "range") || Object.hasOwn(edit, "replacementText")) {
    failures.push(`${source} used obsolete flat range/replacementText fields.`);
  }
  if (!Array.isArray(edit.textReplacements) || !isTextReplacement(edit.textReplacements[0])) {
    failures.push(`${source} did not include valid textReplacements.`);
  }
}

function assertHostResultShape(message, source) {
  if (!message || message.version !== bridgeVersion || message.type !== "host.applyWorkspaceEditResult" || typeof message.requestId !== "string") {
    failures.push(`${source} did not return a correlated host.applyWorkspaceEditResult.`);
    return;
  }
  if (!message.payload || message.payload.cloudRequired !== false) {
    failures.push(`${source} omitted required cloudRequired: false.`);
  }
}

function collectNoLeak(value, source) {
  try {
    assertNoLeak(value, source);
  } catch (error) {
    failures.push(sanitize(messageOf(error)));
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
  return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/access_token=[A-Za-z0-9_-]+/gi, "access_token=[redacted]").replace(/\/Users\/[^\s]+/g, "[redacted]").replace(/C:\\Users\\[^\s]+/g, "[redacted]").slice(0, 1000);
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
