import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled agent dev-preview report smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "controlled-dev-preview-report-secret-should-not-leak",
  "raw prompt from controlled dev-preview report smoke",
  "raw file body from controlled dev-preview report smoke",
  "raw diff from controlled dev-preview report smoke",
  "npm run hidden-controlled-dev-preview-report",
  "provider payload from controlled dev-preview report smoke",
  "/Users/private/controlled-dev-preview-report",
  "sk-controlled-dev-preview-report-secret",
];

const { createControlledAgentDevPreviewReport } = await importDevPreviewReportService();

const reports = {
  completed: createControlledAgentDevPreviewReport({
    host: "vscode",
    status: "completed",
    capabilities: {
      explicit_start: true,
      bounded_read: true,
      bounded_edit: true,
      allowlisted_verification: true,
      bounded_repair: true,
      sanitized_report: true,
    },
    counters: { loopSteps: 1, fileReads: 1, filesTouched: 1, verificationRuns: 1, repairAttempts: 0, userTurns: 2, runtimeSeconds: 18 },
    currentUserAction: "review",
    evidence: [
      { kind: "start", status: "confirmed", summary: "Explicit VS Code user start recorded." },
      { kind: "read", status: "completed", summary: "One bounded local read recorded." },
      { kind: "edit", status: "completed", summary: "One bounded replacement edit recorded." },
      { kind: "verification", status: "succeeded", summary: "Allowlisted verification passed." },
      { kind: "repair", status: "unused", summary: "Repair attempt remained unused." },
    ],
  }),
  failed: createControlledAgentDevPreviewReport({
    host: "vscode",
    status: "failed",
    capabilities: { explicit_start: true, bounded_read: true, bounded_edit: true, allowlisted_verification: true, sanitized_report: true },
    counters: { loopSteps: 1, fileReads: 1, filesTouched: 1, verificationRuns: 1, repairAttempts: 1 },
    evidence: [{ kind: "verification", status: "failed", summary: "Allowlisted verification failed after bounded metadata." }],
  }),
  stopped: createControlledAgentDevPreviewReport({
    host: "vscode",
    status: "stopped",
    capabilities: { explicit_start: true, bounded_read: true, sanitized_report: true },
    evidence: [{ kind: "stop", status: "confirmed", summary: "User stopped the dev-preview." }],
  }),
  browser: createControlledAgentDevPreviewReport({
    host: "browser",
    status: "running",
    capabilities: { explicit_start: true, bounded_read: true, sanitized_report: true },
    evidence: [{ kind: "status", status: "unsupported", summary: "Browser preview cannot start trusted workspace execution." }],
  }),
  jetbrains: createControlledAgentDevPreviewReport({
    host: "jetbrains",
    status: "running",
    capabilities: { explicit_start: true, bounded_read: true, sanitized_report: true },
    evidence: [{ kind: "status", status: "fail-closed", summary: "JetBrains stays fail-closed for controlled execution parity." }],
  }),
  unsafe: createControlledAgentDevPreviewReport({
    host: "vscode",
    status: "completed",
    evidence: [
      { kind: "status", status: "recorded", summary: `${rawMarkers[0]} ${rawMarkers[1]}` },
      { kind: "verification", status: `failed with ${rawMarkers[4]}`, summary: "unsafe status should not echo" },
      { kind: "edit", status: "recorded", command: rawMarkers[4], summary: "unsafe key should omit" },
      { kind: "read", status: "recorded", summary: rawMarkers[6] },
    ],
    rawPrompt: rawMarkers[1],
    rawFile: rawMarkers[2],
    rawDiff: rawMarkers[3],
    providerPayload: rawMarkers[5],
    privatePath: rawMarkers[6],
    secret: rawMarkers[7],
  }),
};

assert.equal(reports.completed.host, "vscode", "completed host is VS Code");
assert.equal(reports.completed.status, "completed", "completed status is preserved");
assert.ok(reports.completed.capabilityLabels.includes("Sanitized display-only report"), "completed report includes sanitized report capability");
assert.equal(reports.completed.counters.loopSteps, 1, "completed report preserves bounded counters");
assert.equal(reports.completed.evidence.length, 5, "completed report includes deterministic evidence list");
assert.ok(reports.completed.safetyBoundaryLabels.includes("Report is display-only sanitized metadata, not runtime authority."), "completed report includes metadata-only boundary");

assert.equal(reports.failed.status, "failed", "failed status is preserved");
assert.ok(reports.failed.limitationLabels.includes("Allowlisted verification failed; no automatic repair is started."), "failed report includes no automatic repair limitation");
assert.equal(reports.stopped.status, "stopped", "stopped status is preserved");
assert.ok(reports.stopped.limitationLabels.includes("Controlled dev-preview is stopped until the user starts it again."), "stopped report includes explicit restart boundary");

assert.equal(reports.browser.status, "blocked", "browser report fails closed");
assert.deepEqual(reports.browser.capabilityLabels, ["Sanitized display-only report"], "browser report stays display-only");
assert.ok(reports.browser.limitationLabels.includes("Browser preview cannot start the controlled local agent dev-preview."), "browser report includes unsupported limitation");

assert.equal(reports.jetbrains.status, "blocked", "JetBrains running status fails closed");
assert.ok(reports.jetbrains.limitationLabels.includes("JetBrains support is partial and fail-closed in this VS Code-first dev-preview."), "JetBrains report includes partial limitation");

assert.equal(reports.unsafe.status, "completed", "unsafe report still normalizes top-level status");
assert.ok(reports.unsafe.evidence.some((item) => item.summary === "Sanitized evidence summary was unavailable."), "unsafe text is summarized without echo");
assert.ok(reports.unsafe.evidence.some((item) => item.label === "Omitted unsafe evidence"), "unsafe keys are omitted");
assertNoRawMarkers(reports, "dev-preview report smoke output");

console.log(`${smokeName} passed.`);
console.log("Verified deterministic local/mock sanitized report evidence for VS Code completed/failed/stopped, browser unsupported, JetBrains fail-closed, and unsafe raw-marker omission without provider, network, git, package, shell, runtime, or broad workspace authority.");

async function importDevPreviewReportService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentDevPreviewReport.ts"]);
  try {
    return imports.get("services/controlledAgentDevPreviewReport.ts");
  } finally {
    await cleanup();
  }
}

function assertNoRawMarkers(value, source) {
  const text = JSON.stringify(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker ${index + 1} leaked through ${source}`);
  }
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-dev-preview-report-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const sourcePath = queue[index];
    if (seen.has(sourcePath)) {
      continue;
    }
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = join(dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) {
        queue.push(dependency);
      }
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  const imports = new Map();
  for (const entry of entries) {
    imports.set(entry, await import(pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}
