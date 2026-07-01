import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled agent progress report smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "controlled-progress-report-secret-should-not-leak",
  "raw prompt from controlled progress report smoke",
  "raw file body from controlled progress report smoke",
  "npm run hidden-controlled-progress-report",
  "/Users/private/controlled-progress-report",
  "sk-controlled-progress-report-secret",
];

const { buildControlledAgentProgressReport } = await importProgressReportService();

const reports = {
  disabled: buildControlledAgentProgressReport(undefined),
  running: buildControlledAgentProgressReport({
    runState: {
      enabled: true,
      phase: "running_verification",
      summary: "Review allowlisted verification metadata.",
      counters: { stepsCompleted: 2, fileReadsUsed: 1, readBytesUsed: 256, userTurns: 1 },
      limits: { maxSteps: 5, maxFileReads: 3, maxReadBytes: 4096, maxTouchedFiles: 2, maxPatchBytes: 4096, maxRuntimeSeconds: 120, maxRepairAttempts: 1 },
    },
    editExecutor: { state: "preview", touchedFileCount: 1, replacementByteCount: 120, summary: "Review sanitized edit metadata." },
    commandRunner: { state: "running", durationMs: 1250, summary: "Review allowlisted verification metadata." },
  }),
  stopped: buildControlledAgentProgressReport({
    runState: { enabled: true, phase: "stopped", stopped: true, summary: "User stopped the controlled run." },
    commandRunner: { state: "killed", durationMs: 2250 },
  }),
  failed: buildControlledAgentProgressReport({
    runState: { enabled: true, phase: "failed", summary: "Verification failed after bounded repair metadata." },
    commandRunner: { state: "failed", durationMs: 3000, diagnostics: ["verification_failed"] },
    repairLoop: { state: "exhausted", attemptCount: 1, maxAttempts: 1, diagnostics: [{ code: "repair_exhausted" }] },
  }),
  repairExhausted: buildControlledAgentProgressReport({
    runState: { enabled: true, phase: "planning", summary: "Repair loop exhausted bounded attempts." },
    repairLoop: { state: "exhausted", mustStop: true, attemptCount: 2, maxAttempts: 2, diagnostics: ["repair_exhausted"] },
  }),
  completed: buildControlledAgentProgressReport({
    runState: { enabled: true, phase: "completed", summary: "Controlled run completed." },
    editExecutor: { state: "applied", touchedFileCount: 2, replacementByteCount: 512 },
    commandRunner: { state: "succeeded", durationMs: 1750 },
  }),
  unsafe: buildControlledAgentProgressReport({
    runState: {
      enabled: true,
      phase: "running_verification",
      summary: `${rawMarkers[1]} ${rawMarkers[0]}`,
    },
    rawPrompt: rawMarkers[1],
    rawFile: rawMarkers[2],
    commandRunner: { state: "running", rawCommand: rawMarkers[3], privatePath: rawMarkers[4], secret: rawMarkers[5] },
  }),
};

assert.equal(reports.disabled.status, "disabled", "missing input is disabled");
assert.equal(reports.disabled.phaseLabel, "Disabled", "disabled phase label is deterministic");
assert.equal(reports.disabled.safetyFlags.authority, "progress_report_metadata_only", "disabled authority is metadata-only");
assert.equal(reports.disabled.finalReport, undefined, "disabled is non-terminal");

assert.equal(reports.running.status, "running", "running verification metadata stays running");
assert.equal(reports.running.phaseLabel, "Running verification", "running verification phase label is deterministic");
assert.equal(reports.running.currentStepLabel, "Review allowlisted verification metadata.", "running command summary wins");
assert.equal(reports.running.counters.fileReadsUsed, 1, "running preserves read counter");
assert.equal(reports.running.counters.filesTouched, 1, "running merges touched file count");
assert.equal(reports.running.counters.patchBytesUsed, 120, "running merges patch byte count");
assert.equal(reports.running.counters.verificationRuns, 1, "running command counts verification run");
assert.equal(reports.running.counters.runtimeSeconds, 2, "running command duration is rounded to seconds");
assert.equal(reports.running.finalReport, undefined, "running is non-terminal");

assertTerminalReport(reports.stopped, "stopped");
assert.equal(reports.stopped.counters.runtimeSeconds, 3, "stopped duration is rounded");

assertTerminalReport(reports.failed, "failed");
assert.equal(reports.failed.counters.repairAttempts, 1, "failed report includes repair attempts");
assert.equal(reports.failed.limits.maxRepairAttempts, 1, "failed report includes repair limit");
assert.ok(reports.failed.diagnostics.includes("repair_exhausted"), "failed report includes sanitized repair diagnostic");

assertTerminalReport(reports.repairExhausted, "blocked");
assert.equal(reports.repairExhausted.counters.repairAttempts, 2, "repair exhausted report includes bounded attempts");
assert.ok(reports.repairExhausted.diagnostics.includes("repair_exhausted"), "repair exhausted report includes sanitized diagnostic");

assertTerminalReport(reports.completed, "completed");
assert.equal(reports.completed.counters.filesTouched, 2, "completed report includes touched files");
assert.equal(reports.completed.counters.patchBytesUsed, 512, "completed report includes patch bytes");

assertTerminalReport(reports.unsafe, "blocked");
assert.ok(reports.unsafe.diagnostics.includes("unsafe_metadata"), "unsafe metadata is diagnosed");
assert.equal(reports.unsafe.currentStepLabel, "Unsafe controlled agent metadata was omitted.", "unsafe current step is redacted");
assertNoRawMarkers(reports, "progress report smoke output");

for (const [label, report] of Object.entries(reports)) {
  assertNoAuthority(report, label);
}

console.log(`${smokeName} passed.`);
console.log("Verified deterministic disabled, running, stopped, failed, repair-exhausted blocked, completed, and unsafe-redacted progress/final report metadata with fail-closed authority flags only.");

async function importProgressReportService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentProgressReport.ts"]);
  try {
    return imports.get("services/controlledAgentProgressReport.ts");
  } finally {
    await cleanup();
  }
}

function assertTerminalReport(report, status) {
  assert.equal(report.status, status, `${status} status`);
  assert.equal(report.finalReport?.status, status, `${status} final report status`);
  assert.equal(report.finalReport?.counters, report.counters, `${status} final report reuses counters metadata`);
  assert.equal(report.finalReport?.limits, report.limits, `${status} final report reuses limits metadata`);
  assert.equal(report.finalReport?.diagnostics, report.diagnostics, `${status} final report reuses diagnostics metadata`);
}

function assertNoAuthority(report, label) {
  for (const key of ["cloudRequired", "executionAllowed", "agentStartAllowed", "autoStartAllowed", "canReadFiles", "canWriteFiles", "canRunCommands", "canApplyEdits", "canCallProvider", "canUseGit", "canUseTools", "canAutoRollback", "canStartAutonomousLoop"]) {
    assert.equal(report.safetyFlags[key], false, `${label} ${key} must stay false`);
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
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-progress-report-smoke-ts-"));
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
