import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "S99 controlled run history smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const appPath = join(guiSrcRoot, "App.tsx");
const panelPath = join(guiSrcRoot, "components", "AgentRunPanel.tsx");
const historyPath = join(guiSrcRoot, "services", "controlledRunHistory.ts");
const rawMarkers = [
  "raw prompt from S99 history smoke",
  "raw file body from S99 history smoke",
  "raw diff from S99 history smoke",
  "npm run hidden-s99-history",
  "stdout from S99 history smoke",
  "provider payload from S99 history smoke",
  "/Users/private/s99-history",
  "access_token=" + "s".repeat(64),
  "sk-s99-history-secret",
  "Authorization: Bearer s99-history-token",
];

const [appSource, panelSource, historySource] = await Promise.all([
  readFile(appPath, "utf8"),
  readFile(panelPath, "utf8"),
  readFile(historyPath, "utf8"),
]);

const { createControlledRunHistoryItem, appendControlledRunHistoryItem } = await importHistoryService();

assertSourceContracts();
assertHistorySanitization();

console.log(`${smokeName} passed.`);
console.log("Verified S99 controlled run history remains bounded, sanitized GUI-local metadata with no raw evidence or browser-storage persistence.");

function assertSourceContracts() {
  assert.match(appSource, /useState<ControlledRunHistoryItem\[\]>\(\[\]\)/, "App must keep controlled-run history in GUI React state");
  assert.match(appSource, /appendControlledRunHistoryItem\(current\.filter\(\(existing\) => existing\.runId !== item\.runId\), item, 8\)/, "App must keep a bounded deduplicated controlled-run history list");
  assert.doesNotMatch(appSource, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:controlledRunHistory|controlled-run-history|controlled_run_history|controlled run history)/i, "App must not persist controlled-run history to browser storage");
  assert.doesNotMatch(appSource, /(?:indexedDB|caches)\.[^\n]*(?:controlledRunHistory|controlled-run-history|controlled_run_history|controlled run history)/i, "App must not persist controlled-run history through browser storage APIs");

  assert.match(panelSource, /aria-label="Controlled run local history"/, "AgentRunPanel must expose the controlled-run history section with an accessible label");
  assert.match(panelSource, /<span className="badge">local metadata<\/span>/, "AgentRunPanel must label history as local metadata");
  assert.match(panelSource, /<span className="badge">sanitized labels only<\/span>/, "AgentRunPanel must label history as sanitized labels only");
  assert.match(panelSource, /<span className="badge">no persistence<\/span>/, "AgentRunPanel must disclose no persistence");
  assert.match(panelSource, /Raw prompts, file bodies, diffs, command strings\/output, provider payloads, private paths, and secrets are omitted\./, "AgentRunPanel must disclose omitted raw data classes");
  assert.doesNotMatch(panelSource, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:controlledRunHistory|controlled-run-history|controlled_run_history|rawPrompt|rawDiff|providerPayload)/i, "AgentRunPanel must not write history or raw evidence to browser storage");

  assert.match(historySource, /const unsafeTextPattern = \/raw\\s\+\(\?:prompt\|file\|diff\|command\|stdout\|stderr\|log\|provider\|payload\)/, "history service must reject raw prompt/file/diff/command/provider markers");
  assert.match(historySource, /const unsafeKeyPattern = \/\(\?:prompt\|body\|diff\|patch\|command\|cmd\|stdout\|stderr\|provider\|payload\|path\|secret\|token/, "history service must reject unsafe evidence keys");
  assert.match(historySource, /resultLabel: omittedUnsafeCount > 0 \? "unsafe_metadata_blocked" : normalizeResultLabel\(draft\.resultLabel\)/, "history service must fail unsafe drafts closed");
  assert.match(historySource, /safetyLabels\.push\("unsafe_metadata_omitted"\)/, "history service must mark unsafe omissions");
}

function assertHistorySanitization() {
  const checksum = `sha256:${"a".repeat(64)}`;
  const safe = createControlledRunHistoryItem({
    runId: "s99-history-safe",
    createdAt: "2026-07-07T10:00:00.000Z",
    updatedAt: "2026-07-07T10:05:00.000Z",
    hostLabel: "vscode",
    readinessLabels: ["opt_in_ready", "workspace_ready", "checkpoint_ready"],
    phaseLabel: "completed",
    resultLabel: "succeeded",
    counters: [
      { name: "read_count", value: 1 },
      { name: "edit_count", value: 1 },
      { name: "verification_count", value: 1 },
    ],
    summaryLabels: ["controlled run completed", "verification passed"],
    artifactLabels: [{ label: "patch preview artifact", checksumLabel: checksum, sizeBucketLabel: "small", retentionLabel: "short_retention" }],
    checksumLabels: [checksum],
  }, fixedNow);

  assert.equal(safe.schemaVersion, "controlled_run_history.v1", "history item must use the S99 schema");
  assert.equal(safe.resultLabel, "succeeded", "safe metadata must preserve safe result label");
  assert.deepEqual(safe.safetyLabels, ["metadata_only", "raw_payloads_omitted"], "safe metadata must carry metadata-only safety labels");
  assertNoRawMarkers(safe, "safe history item");

  const unsafe = createControlledRunHistoryItem({
    runId: rawMarkers[7],
    createdAt: "not a date",
    updatedAt: "2026-07-07T10:06:00.000Z",
    hostLabel: "vscode",
    readinessLabels: ["workspace_ready", rawMarkers[0]],
    phaseLabel: "running",
    resultLabel: "succeeded",
    counters: [
      { name: "read_count", value: 1.9 },
      { name: "byte_bucket", value: 20000 },
      { name: "command", value: 1 },
    ],
    summaryLabels: [
      "safe visible status",
      rawMarkers[0],
      rawMarkers[5],
      rawMarkers[6],
      rawMarkers[7],
    ],
    artifactLabels: [
      { label: "safe artifact", checksumLabel: checksum, sizeBucketLabel: "small" },
      { label: rawMarkers[2], checksumLabel: checksum },
      { label: "private artifact", privatePath: rawMarkers[6] },
    ],
    checksumLabels: [checksum, "sha256:not-valid", `sha256:${"b".repeat(64)} ${rawMarkers[7]}`],
    rawPrompt: rawMarkers[0],
    rawFileBody: rawMarkers[1],
    rawDiff: rawMarkers[2],
    command: rawMarkers[3],
    stdout: rawMarkers[4],
    providerPayload: { body: rawMarkers[5] },
    privatePath: rawMarkers[6],
    authToken: rawMarkers[7],
  }, fixedNow);

  assert.equal(unsafe.runId, "run-omitted-unsafe", "unsafe run ids must be omitted");
  assert.equal(unsafe.resultLabel, "unsafe_metadata_blocked", "unsafe drafts must fail closed");
  assert.deepEqual(unsafe.summaryLabels, ["safe visible status"], "history summaries must keep only safe labels");
  assert.deepEqual(unsafe.artifactLabels, [{ label: "safe artifact", checksumLabel: checksum, sizeBucketLabel: "small" }], "artifact labels must omit unsafe raw/private evidence");
  assert.deepEqual(unsafe.checksumLabels, [checksum], "checksum labels must stay bounded safe checksums only");
  assert.ok(unsafe.counters.some((counter) => counter.name === "omitted_unsafe_count" && counter.value > 0), "unsafe omissions must be counted");
  assert.ok(unsafe.safetyLabels.includes("unsafe_metadata_omitted"), "unsafe omissions must be labeled");
  assertNoRawMarkers(unsafe, "unsafe history item");

  const bounded = appendControlledRunHistoryItem([
    createControlledRunHistoryItem({ runId: "history-1", phaseLabel: "queued", resultLabel: "pending" }, fixedNow),
    createControlledRunHistoryItem({ runId: "history-2", phaseLabel: "running", resultLabel: "pending" }, fixedNow),
  ], createControlledRunHistoryItem({ runId: "history-3", phaseLabel: "completed", resultLabel: "succeeded" }, fixedNow), 2);
  assert.deepEqual(bounded.map((item) => item.runId), ["history-2", "history-3"], "history list must retain newest bounded items");
}

function assertNoRawMarkers(value, label) {
  const rendered = JSON.stringify(value);
  for (const marker of rawMarkers) {
    assert.doesNotMatch(rendered, escapedPattern(marker), `${label} must not contain raw marker: ${marker}`);
  }
  for (const rawKey of ["rawPrompt", "rawFileBody", "rawDiff", "command", "stdout", "providerPayload", "privatePath", "authToken", "localStorage", "sessionStorage"]) {
    assert.doesNotMatch(rendered, escapedPattern(rawKey), `${label} must not contain raw key or storage marker: ${rawKey}`);
  }
}

function escapedPattern(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function fixedNow() {
  return new Date("2026-07-07T10:10:00.000Z");
}

async function importHistoryService() {
  const { imports, cleanup } = await transpileGuiModules(["services/controlledRunHistory.ts"]);
  try {
    return imports.get("services/controlledRunHistory.ts");
  } finally {
    await cleanup();
  }
}

async function transpileGuiModules(entries) {
  const require = createRequire(import.meta.url);
  const ts = require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
  const outRoot = await mkdtemp(join(tmpdir(), "yet-ai-s99-history-smoke-"));
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
