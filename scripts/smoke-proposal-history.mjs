import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "sk-proposal-history-secret",
  "access_token",
  "Authorization",
  "Bearer",
  "raw prompt",
  "raw diff",
  "raw file body",
  "raw command",
  "raw output",
  "npm run check",
  "PRIVATE_TEMP_PATH",
  "/Users/",
  "C:\\Users\\",
  "apply_patch",
  "tool call",
  "provider payload",
  "SECRET_SENTINEL",
];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-proposal-history-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  try {
    while (queue.length > 0) {
      const sourcePath = queue.shift();
      if (!sourcePath || seen.has(sourcePath)) {
        continue;
      }
      seen.add(sourcePath);
      const source = await readFile(sourcePath, "utf8");
      for (const dependency of localValueDependencies(source, sourcePath)) {
        if (!seen.has(dependency)) {
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
    const imports = Object.fromEntries(await Promise.all(entries.map(async (entry) => {
      const modulePath = join(outRoot, entry).replace(/\.ts$/, ".mjs");
      return [entry, await import(pathToFileURL(modulePath).href)];
    })));
    return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
  } catch (error) {
    await rm(outRoot, { recursive: true, force: true });
    throw error;
  }
}

function localValueDependencies(source, sourcePath) {
  const dependencies = [];
  const importPattern = /(?:import|export)\s+(?!type\b)(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    const candidate = resolve(dirname(sourcePath), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
    if (candidate.startsWith(guiSrcRoot)) {
      dependencies.push(candidate);
    }
  }
  return dependencies;
}

function proposal(overrides = {}) {
  return {
    id: "proposalHistorySmokeOriginal",
    source: "assistant-proposal-history-smoke",
    kind: "original",
    summary: "Review one visible label after manual proposal comparison.",
    touchedFiles: ["apps/gui/src/App.tsx"],
    editCount: 1,
    timestamp: "2026-06-25T19:00:00.000Z",
    ...overrides,
  };
}

function assertNoAuthority(policy, label) {
  assert.deepEqual(policy, {
    canRequestApply: false,
    canRequestVerification: false,
    canRunCommand: false,
    canReadFiles: false,
    canWriteFiles: false,
    canCallProvider: false,
    displayOnly: true,
  }, `${label} policy`);
}

function assertMetadataOnly(history, summary, label) {
  assert.equal(history.kind, "proposal_history", `${label} history kind`);
  assert.equal(history.authority, "metadata_only", `${label} history authority`);
  assert.equal(summary.kind, "proposal_history_comparison", `${label} summary kind`);
  assert.equal(summary.authority, "metadata_only", `${label} summary authority`);
  assert.equal(history.entries.length <= 12, true, `${label} entries bounded`);
  assert.equal(history.diagnostics.length <= 12, true, `${label} diagnostics bounded`);
  assert.equal(summary.comparisonLabels.length <= 12, true, `${label} labels bounded`);
  assert.equal(summary.diagnostics.length <= 12, true, `${label} summary diagnostics bounded`);
  assertNoAuthority(history.policy, `${label} history`);
  assertNoAuthority(summary.policy, `${label} summary`);
}

function assertSanitized(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 12000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices(["services/proposalHistory.ts"]);
  try {
    const {
      appendProposalHistoryEntry,
      createProposalHistory,
      createProposalHistoryComparisonSummary,
      emptyProposalHistory,
      updateProposalHistoryEntry,
    } = imports["services/proposalHistory.ts"];

    const emptyHistory = emptyProposalHistory();
    const emptySummary = createProposalHistoryComparisonSummary(emptyHistory);
    assertMetadataOnly(emptyHistory, emptySummary, "empty");
    assert.equal(emptySummary.totalCount, 0);
    assert.equal(emptySummary.latestStatus, "none");

    const original = createProposalHistory([proposal()]);
    const originalSummary = createProposalHistoryComparisonSummary(original);
    assertMetadataOnly(original, originalSummary, "original");
    assert.equal(original.entries[0].kind, "original");
    assert.equal(original.entries[0].status, "detected");
    assert.equal(originalSummary.visibleCount, 1);
    assert.deepEqual(originalSummary.touchedFileLabels, ["apps/gui/src/App.tsx"]);

    const followUp = appendProposalHistoryEntry(original, proposal({
      id: "proposalHistorySmokeFollowUp",
      source: "assistant-proposal-history-follow-up",
      kind: "follow_up",
      summary: "Compare a revised safe proposal before the user chooses any next action.",
      touchedFiles: ["apps/gui/src/App.tsx", "apps/gui/src/components/ProposalHistoryPanel.tsx"],
      timestamp: "2026-06-25T19:01:00.000Z",
    }));
    const followUpSummary = createProposalHistoryComparisonSummary(followUp);
    assertMetadataOnly(followUp, followUpSummary, "follow-up");
    assert.equal(followUp.entries.length, 2);
    assert.equal(followUpSummary.visibleCount, 2);
    assert.equal(followUpSummary.latestSource, "assistant-proposal-history-follow-up");

    const rejected = appendProposalHistoryEntry(followUp, proposal({
      id: "proposalHistorySmokeRejected",
      source: "assistant-proposal-history-rejected",
      kind: "rejected",
      status: "rejected",
      summary: "Rejected before apply because the user chose not to continue.",
      diagnostic: "Manual review rejected this proposal.",
      timestamp: "2026-06-25T19:02:00.000Z",
    }));
    const rejectedSummary = createProposalHistoryComparisonSummary(rejected);
    assertMetadataOnly(rejected, rejectedSummary, "rejected");
    assert.equal(rejectedSummary.rejectedCount, 1);
    assert.equal(rejected.entries.find((entry) => entry.kind === "rejected")?.diagnostics[0], "Manual review rejected this proposal.");

    const applied = updateProposalHistoryEntry(rejected, {
      id: "proposalHistorySmokeFollowUp",
      source: "assistant-proposal-history-follow-up",
    }, {
      kind: "applied",
      status: "applied",
      applyStatus: "applied",
      summary: "User-confirmed apply metadata recorded for comparison only.",
      timestamp: "2026-06-25T19:03:00.000Z",
    });
    const appliedSummary = createProposalHistoryComparisonSummary(applied);
    assertMetadataOnly(applied, appliedSummary, "applied");
    assert.equal(appliedSummary.appliedCount, 1);
    assert.equal(applied.entries.find((entry) => entry.id === "proposalHistorySmokeFollowUp")?.applyStatus, "applied");

    const verified = updateProposalHistoryEntry(applied, {
      id: "proposalHistorySmokeFollowUp",
      source: "assistant-proposal-history-follow-up",
    }, {
      kind: "verification",
      status: "verification_succeeded",
      verificationStatus: "succeeded",
      summary: "Allowlisted verification metadata succeeded after explicit user action.",
      diagnostic: "Sanitized verification result metadata only.",
      timestamp: "2026-06-25T19:04:00.000Z",
    });
    const verifiedSummary = createProposalHistoryComparisonSummary(verified);
    assertMetadataOnly(verified, verifiedSummary, "verified");
    assert.equal(verifiedSummary.verificationSucceededCount, 1);
    assert.equal(verified.entries.find((entry) => entry.id === "proposalHistorySmokeFollowUp")?.verificationStatus, "succeeded");

    const unsafe = createProposalHistory([
      proposal({
        id: "bad-/Users/alice/.config/auth.json",
        source: "assistant-/Users/alice/project",
        summary: "raw prompt with Authorization: Bearer sk-proposal-history-secret",
        touchedFiles: ["/Users/alice/private/repo/secret.ts", "apps/gui/src/services/proposalHistory.ts"],
        diagnostic: "raw command npm run check cwd PRIVATE_TEMP_PATH provider payload SECRET_SENTINEL",
      }),
    ]);
    const unsafeSummary = createProposalHistoryComparisonSummary(unsafe);
    assertMetadataOnly(unsafe, unsafeSummary, "unsafe");
    assert.equal(unsafe.entries[0].id, undefined);
    assert.equal(unsafe.entries[0].source, "assistant");
    assert.equal(unsafe.entries[0].summary, "[redacted]");
    assert.deepEqual(unsafe.entries[0].touchedFiles, ["apps/gui/src/services/proposalHistory.ts"]);
    assertSanitized(unsafe, "unsafe history");
    assertSanitized(unsafeSummary, "unsafe summary");
    assertSanitized(verified, "verified history");
    assertSanitized(verifiedSummary, "verified summary");
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Proposal history smoke passed.");
}

export { runSmoke };
