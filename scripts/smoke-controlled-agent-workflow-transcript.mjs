import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawLeakMarkers = ["/Users/alice", "sk-proj", "Raw prompt body", "command output", "provider payload", "bridge dump", "localStorage", "production release marketplace"];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-workflow-transcript-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  const imports = new Map();
  while (queue.length > 0) {
    const sourcePath = queue.shift();
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.?\.?\/[^"']+)["']/g)) {
      const dependency = join(dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) queue.push(dependency);
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.?\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  for (const entry of entries) imports.set(entry, await import(`${pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href}?smoke=${Date.now()}`));
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}

async function readJson(path) {
  return JSON.parse(await readFile(join(repoRoot, path), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSanitized(value, label) {
  const output = JSON.stringify(value);
  for (const marker of rawLeakMarkers) assert.equal(output.includes(marker), false, `${label} leaked ${marker}`);
}

async function runSmoke() {
  const completed = await readJson("packages/contracts/examples/engine/controlled-agent-workflow-transcript-completed.json");
  const blocked = await readJson("packages/contracts/examples/engine/controlled-agent-workflow-transcript-blocked.json");
  const invalidNames = [
    "engine/controlled-agent-workflow-transcript-raw-data.json",
    "engine/controlled-agent-workflow-transcript-private-path.json",
    "engine/controlled-agent-workflow-transcript-command-output.json",
    "engine/controlled-agent-workflow-transcript-bridge-dump.json",
    "engine/controlled-agent-workflow-transcript-browser-storage-dump.json",
    "engine/controlled-agent-workflow-transcript-overclaim.json",
    "engine/controlled-agent-workflow-transcript-missing-task-preset-label.json",
  ];
  for (const expected of ["raw-data", "private-path", "command-output", "bridge-dump", "browser-storage-dump", "overclaim", "missing-task-preset-label"]) {
    assert.equal(invalidNames.some((name) => name.includes(expected)), true, `missing invalid fixture coverage for ${expected}`);
  }

  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentWorkflowTranscript.ts"]);
  try {
    const { buildControlledAgentWorkflowTranscript, isControlledAgentWorkflowTranscriptSafe } = imports.get("services/controlledAgentWorkflowTranscript.ts");
    const completedResult = buildControlledAgentWorkflowTranscript(completed);
    assert.deepEqual(completedResult.transcript, completed);
    assert.deepEqual(completedResult.diagnostics, []);
    assert.equal(completedResult.transcript.executionAllowed, false);
    assert.equal(completedResult.transcript.taskPresetLabel, "Small focused fix");
    assert.equal(isControlledAgentWorkflowTranscriptSafe(completedResult.transcript), true);
    assertSanitized(completedResult, "completed transcript");

    const blockedResult = buildControlledAgentWorkflowTranscript(blocked);
    assert.deepEqual(blockedResult.transcript, blocked);
    assert.deepEqual(blockedResult.diagnostics, []);
    assert.equal(blockedResult.transcript.finalEvidence.result, "blocked");
    assert.equal(blockedResult.transcript.providerAccess, "not-used");
    assert.equal(isControlledAgentWorkflowTranscriptSafe(blockedResult.transcript), true);
    assertSanitized(blockedResult, "blocked transcript");

    const unsafe = clone(completed);
    unsafe.rawPrompt = "Raw prompt body /Users/alice/private sk-proj-123456789";
    unsafe.contextSearch.selectedContextLabels = ["safe label", "/Users/alice/private/file.ts"];
    unsafe.proposal.summary = "Raw prompt body was pasted into the transcript.";
    unsafe.verification.commandOutput = "stdout showed full command output";
    unsafe.finalEvidence.summary = "This proves production release marketplace readiness.";
    const unsafeResult = buildControlledAgentWorkflowTranscript(unsafe);
    assert.deepEqual(new Set(unsafeResult.diagnostics.map((item) => item.code)), new Set(["unsafe_metadata_omitted", "unsafe_text_replaced"]));
    assert.equal(Object.hasOwn(unsafeResult.transcript, "rawPrompt"), false);
    assert.equal(Object.hasOwn(unsafeResult.transcript.verification, "commandOutput"), false);
    assert.equal(unsafeResult.transcript.proposal.summary, "Proposal metadata unavailable after unsafe content was omitted.");
    assert.equal(unsafeResult.transcript.contextSearch.selectedContextLabels[1], "Sanitized metadata omitted unsafe raw content.");
    assert.equal(unsafeResult.transcript.finalEvidence.summary, "Task evidence was sanitized after unsafe content was omitted.");
    assert.equal(isControlledAgentWorkflowTranscriptSafe(unsafeResult.transcript), true);
    assertSanitized(unsafeResult, "unsafe transcript");

    return {
      contractFixtures: 2,
      invalidFixtureGroups: invalidNames.length,
      guiScenarios: ["completed", "blocked", "unsafe-raw-markers"],
      hostExecution: false,
      providerCalls: false,
      workspaceMutation: false,
      browserStorage: false,
      automaticApply: false,
      automaticVerification: false,
    };
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent workflow transcript smoke passed.");
  console.log(`Verified ${report.contractFixtures} safe fixtures, ${report.invalidFixtureGroups} invalid fixture labels, and ${report.guiScenarios.length} local/mock GUI-service scenarios with sanitized metadata only.`);
}

export { runSmoke };
