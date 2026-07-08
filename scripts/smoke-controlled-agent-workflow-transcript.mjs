import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { requireGuiTypescript } from "./lib/require-gui-typescript.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawLeakMarkers = ["/Users/alice", "sk-proj", "Raw prompt body", "command output", "provider payload", "bridge dump", "localStorage", "production release marketplace"];

async function transpileGuiServices(entries) {
  const ts = requireGuiTypescript({ repoRoot, smokeName: "Controlled agent workflow transcript smoke" });
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

async function listInvalidWorkflowTranscriptFixtures() {
  const fixtureRoot = join(repoRoot, "packages", "contracts", "examples-invalid", "engine");
  const prefix = "controlled-agent-workflow-transcript-";
  const names = (await readdir(fixtureRoot))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  const labels = names.map((name) => name.slice(prefix.length, -".json".length));
  const expectedLabels = ["bridge-dump", "browser-storage-dump", "command-output", "missing-task-preset-label", "overclaim", "private-path", "raw-data"];
  assert.deepEqual(labels, expectedLabels);
  return names.map((name) => ({
    label: name.slice(prefix.length, -".json".length),
    path: `packages/contracts/examples-invalid/engine/${name}`,
  }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSanitized(value, label) {
  const output = JSON.stringify(value);
  for (const marker of rawLeakMarkers) assert.equal(output.includes(marker), false, `${label} leaked ${marker}`);
}

async function compileTranscriptSchemaValidator() {
  const schema = await readJson("packages/contracts/schemas/engine/controlled-agent-workflow-transcript.schema.json");
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function diagnosticCodes(result) {
  return new Set(result.diagnostics.map((item) => item.code));
}

async function runSmoke() {
  const completed = await readJson("packages/contracts/examples/engine/controlled-agent-workflow-transcript-completed.json");
  const blocked = await readJson("packages/contracts/examples/engine/controlled-agent-workflow-transcript-blocked.json");
  const invalidFixtures = await listInvalidWorkflowTranscriptFixtures();
  const validateTranscriptSchema = await compileTranscriptSchemaValidator();

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

    const contradictory = clone(completed);
    contradictory.verification.commandCount = 1;
    contradictory.verification.commandIds = ["repository-check", "gui-app-tests"];
    contradictory.verification.passedCount = 1;
    contradictory.verification.failedCount = 1;
    const contradictoryResult = buildControlledAgentWorkflowTranscript(contradictory);
    assert.equal(contradictoryResult.diagnostics.some((item) => item.code === "inconsistent_verification_counts"), true);
    assert.deepEqual(contradictoryResult.transcript.verification.commandIds, []);
    assert.equal(contradictoryResult.transcript.verification.commandCount, 0);
    assert.equal(isControlledAgentWorkflowTranscriptSafe(contradictoryResult.transcript), true);
    assertSanitized(contradictoryResult, "contradictory verification transcript");

    assert.equal(validateTranscriptSchema(completed), true, "completed transcript fixture should match the contract schema");
    assert.equal(validateTranscriptSchema(blocked), true, "blocked transcript fixture should match the contract schema");

    const invalidFixtureResults = [];
    for (const fixture of invalidFixtures) {
      const input = await readJson(fixture.path);
      assert.equal(validateTranscriptSchema(input), false, `${fixture.label} should be rejected by the contract schema`);
      const result = buildControlledAgentWorkflowTranscript(input);
      assert.equal(isControlledAgentWorkflowTranscriptSafe(result.transcript), true, `${fixture.label} should be sanitized to safe transcript metadata`);
      assertSanitized(result, `${fixture.label} invalid transcript fixture`);
      assert.equal(validateTranscriptSchema(result.transcript) || diagnosticCodes(result).size > 0 || JSON.stringify(result.transcript) !== JSON.stringify(input), true, `${fixture.label} should be rejected or sanitized`);
      invalidFixtureResults.push(fixture.label);
    }

    return {
      contractFixtures: 2,
      invalidFixtures: invalidFixtureResults,
      guiScenarios: ["completed", "blocked", "unsafe-raw-markers", "contradictory-verification-counts"],
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
  console.log(`Verified ${report.contractFixtures} safe fixtures, ${report.invalidFixtures.length} real invalid fixture files, and ${report.guiScenarios.length} local/mock GUI-service scenarios with sanitized metadata only.`);
}

export { runSmoke };
