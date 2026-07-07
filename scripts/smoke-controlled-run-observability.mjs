import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled run observability smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "controlled-observability-secret-should-not-leak",
  "raw prompt from controlled observability smoke",
  "raw file body from controlled observability smoke",
  "raw diff from controlled observability smoke",
  "npm run hidden-controlled-observability",
  "provider payload from controlled observability smoke",
  "/Users/private/controlled-observability",
  "sk-controlled-observability-secret",
  "Authorization: Bearer controlled-observability-token",
];

const {
  createControlledRunTimelineEvent,
  normalizeControlledRunTimelineEventType,
  normalizeControlledRunTimelineOutcome,
} = await importTraceService();
const { createSanitizedControlledRunExport } = await importReportService();

const fixedDate = new Date("2026-07-07T10:05:00.000Z");
const timeline = [
  createControlledRunTimelineEvent({
    type: "start",
    outcome: "succeeded",
    label: "VS Code explicit start",
    requestId: "start-105",
    runId: "run-105",
    details: { confirmedBy: "user", rawPrompt: rawMarkers[1], secret: rawMarkers[7] },
  }, { id: "trace-start", timestamp: fixedDate }),
  createControlledRunTimelineEvent({
    type: "read",
    outcome: "succeeded",
    label: "docs/dogfood/s105-observability.md",
    requestId: "read-105",
    runId: "run-105",
    details: { pathLabel: "docs/dogfood/s105-observability.md", fileBody: rawMarkers[2], privatePath: rawMarkers[6] },
  }, { id: "trace-read", timestamp: fixedDate }),
  createControlledRunTimelineEvent({
    type: "edit",
    outcome: "planned",
    label: "bounded replacement metadata",
    requestId: "edit-105",
    runId: "run-105",
    details: { patchSummary: "one bounded replacement", rawDiff: rawMarkers[3] },
  }, { id: "trace-edit", timestamp: fixedDate }),
  createControlledRunTimelineEvent({
    type: "verify",
    outcome: "running",
    label: "repository-check",
    requestId: "verify-105",
    runId: "run-105",
    details: { commandId: "repository-check", command: rawMarkers[4], providerPayload: rawMarkers[5] },
  }, { id: "trace-verify", timestamp: fixedDate }),
  createControlledRunTimelineEvent({
    type: "report",
    outcome: "succeeded",
    label: "sanitized export ready",
    requestId: "report-105",
    runId: "run-105",
    details: { reportStatus: "completed", rawOutput: rawMarkers[0] },
  }, { id: "trace-report", timestamp: fixedDate }),
  createControlledRunTimelineEvent({
    type: "recovery",
    outcome: "recovered",
    label: "runtime reconnect metadata",
    requestId: "recovery-105",
    runId: "run-105",
    details: { recoveryMode: "manual_restart", rawLog: rawMarkers[8] },
  }, { id: "trace-recovery", timestamp: fixedDate }),
];

assert.deepEqual(timeline.map((entry) => entry.family), [
  "controlledRun.start",
  "controlledRun.read",
  "controlledRun.edit",
  "controlledRun.verify",
  "controlledRun.report",
  "controlledRun.recovery",
], "timeline records only controlledRun families");
assert.deepEqual(timeline.map((entry) => entry.status), ["succeeded", "succeeded", "pending", "in_progress", "succeeded", "succeeded"], "timeline maps controlled outcomes to safe trace statuses");
assert.ok(timeline.every((entry) => entry.details?.displayOnly === true), "timeline is display-only");
assert.ok(timeline.every((entry) => entry.details?.metadataOnly === true), "timeline is metadata-only");
assert.ok(timeline.every((entry) => entry.details?.rawPayloadStored === false), "timeline stores no raw payload");
assert.ok(timeline.every((entry) => entry.details?.rawPayloadReturned === false), "timeline returns no raw payload");
assert.ok(timeline.every((entry) => entry.details?.executionAuthority === false), "timeline grants no execution authority");
assert.equal(normalizeControlledRunTimelineEventType("shell"), "report", "unknown timeline event type fails closed");
assert.equal(normalizeControlledRunTimelineOutcome("executed"), "blocked", "unknown timeline outcome fails closed");

const sanitizedExport = createSanitizedControlledRunExport({
  runId: "run-105",
  host: "vscode",
  status: "completed",
  startedAt: "2026-07-07T10:00:00.000Z",
  completedAt: "2026-07-07T10:05:00.000Z",
  counters: { loopSteps: 4, fileReads: 1, filesTouched: 1, verificationRuns: 1, repairAttempts: 1, userTurns: 3, runtimeSeconds: 300, rawOutputBytes: 4096 },
  trace: [
    { type: "start", outcome: "succeeded", label: "VS Code explicit start", summary: "User started the controlled run." },
    { type: "read", outcome: "succeeded", label: "bounded read", summary: "Read metadata recorded.", fileBody: rawMarkers[2] },
    { type: "verify", outcome: "succeeded", label: "repository-check", summary: "Allowlisted verification passed." },
    { type: "report", outcome: "succeeded", label: rawMarkers[8], summary: rawMarkers[5] },
    { type: "shell", outcome: "executed", label: rawMarkers[4], summary: rawMarkers[6] },
  ],
  evidence: [
    { kind: "start", status: "confirmed", summary: "Explicit user start recorded." },
    { kind: "verification", status: "succeeded", summary: "Allowlisted verification passed." },
    { kind: "status", status: "unsafe", providerPayload: rawMarkers[5] },
  ],
  safetyBoundaries: ["local_first", "explicit_user_start", "metadata_only", "bounded_work", "no_raw_secrets"],
});

assert.equal(sanitizedExport.kind, "controlled_run.sanitized_export", "export has controlled-run kind");
assert.equal(sanitizedExport.displayOnly, true, "export is display-only");
assert.equal(sanitizedExport.metadataOnly, true, "export is metadata-only");
assert.equal(sanitizedExport.rawPayloadStored, false, "export stores no raw payload");
assert.equal(sanitizedExport.rawPayloadReturned, false, "export returns no raw payload");
assert.equal(sanitizedExport.executionAuthority, false, "export grants no execution authority");
assert.equal(sanitizedExport.status, "completed", "export preserves safe completed status");
assert.deepEqual(sanitizedExport.trace.map((item) => item.type), ["start", "verify", "report", "report"], "export omits raw trace items and keeps sanitized placeholders");
assert.deepEqual(sanitizedExport.diagnostics.map((item) => item.code), ["raw_payload_omitted"], "export records raw omission diagnostic");
assert.ok(sanitizedExport.safetyBoundaryLabels.includes("Raw file bodies, diffs, command output, provider payloads, private paths, and secrets are omitted."), "export includes raw omission boundary");
assertNoRawMarkers({ timeline, sanitizedExport }, "controlled-run observability smoke output");

console.log(`${smokeName} passed.`);
console.log("Verified controlledRun timeline events and sanitized export stay display-only, metadata-only, no-authority, and omit raw prompt/file/diff/command/provider/private path/secret markers with deterministic local GUI service imports.");

async function importTraceService() {
  const { imports, cleanup } = await transpileGuiServices(["services/codingSessionTrace.ts"]);
  try {
    return imports.get("services/codingSessionTrace.ts");
  } finally {
    await cleanup();
  }
}

async function importReportService() {
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
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-run-observability-smoke-ts-"));
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
