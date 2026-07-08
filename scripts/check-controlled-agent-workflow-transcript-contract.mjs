import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const transcriptSchemaPath = "packages/contracts/schemas/engine/controlled-agent-workflow-transcript.schema.json";
const safeTranscriptFixturePaths = [
  "packages/contracts/examples/engine/controlled-agent-workflow-transcript-completed.json",
  "packages/contracts/examples/engine/controlled-agent-workflow-transcript-blocked.json"
];
const expectedInvalidLabels = ["bridge-dump", "browser-storage-dump", "command-output", "missing-task-preset-label", "overclaim", "private-path", "raw-data"];

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
  assert.deepEqual(labels, expectedInvalidLabels);
  return names.map((name) => ({
    label: name.slice(prefix.length, -".json".length),
    path: `packages/contracts/examples-invalid/engine/${name}`,
  }));
}

async function compileTranscriptSchemaValidator() {
  const schema = await readJson(transcriptSchemaPath);
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

async function runCheck() {
  const validateTranscriptSchema = await compileTranscriptSchemaValidator();
  const validFixtures = [];
  const invalidFixtures = [];

  for (const path of safeTranscriptFixturePaths) {
    const input = await readJson(path);
    assert.equal(validateTranscriptSchema(input), true, `${path} should match the workflow transcript contract schema`);
    validFixtures.push(path);
  }

  for (const fixture of await listInvalidWorkflowTranscriptFixtures()) {
    const input = await readJson(fixture.path);
    assert.equal(validateTranscriptSchema(input), false, `${fixture.path} should be rejected by the workflow transcript contract schema`);
    invalidFixtures.push(fixture.label);
  }

  return { validFixtures, invalidFixtures };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runCheck();
  console.log(`Controlled-agent workflow transcript contract validation passed for ${report.validFixtures.length} safe fixtures and ${report.invalidFixtures.length} rejected invalid fixtures.`);
}

export { runCheck };
