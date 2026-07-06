import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const fixtureDir = "docs/dogfood/fixtures/controlled-agent-dev-preview";
const requiredKinds = new Set([
  "success",
  "verification-failure-repair",
  "user-stop",
  "runtime-disconnect",
  "browser-unsupported",
  "jetbrains-partial-fail-closed"
]);
const allowedHosts = new Set(["vscode", "browser", "jetbrains"]);
const allowedCommandIds = new Set(["repository-check", "gui-app-tests", "engine-chat-tests"]);
const forbiddenKeyPattern = /(?:raw|body|diff|output|secret|token|privatePath|commandText|shell|git|package|network|providerPayload|cwd|env|absolutePath)/i;
const forbiddenTextPatterns = [
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\b(?:sk|pk)-[a-z0-9_-]{8,}/i,
  /\/Users\//,
  /C:\\Users\\/i,
  /https?:\/\//i,
  /github\.com\//i,
  /raw\s+(?:file|body|diff|command|output|prompt|response)/i,
  /(?:shell|git|package|network)\s+(?:claim|step|action|authority)/i,
  /production[- ](?:ready\s+)?autonomy/i,
  /production\s+autonomy/i,
  /fully\s+autonomous/i,
  /marketplace[- ]ready/i,
  /release[- ]ready/i,
  /automatic\s+repair/i,
  /auto[- ]repair/i,
  /hidden\s+(?:workspace\s+)?read/i,
  /arbitrary\s+command/i
];
const requiredFields = [
  "fixtureVersion",
  "scenarioId",
  "scenarioKind",
  "host",
  "startCondition",
  "boundedReadMetadata",
  "boundedEditMetadata",
  "verificationMetadata",
  "repairMetadata",
  "finalReportStatus",
  "limitations",
  "nonGoalClaims"
];

const failures = [];
const files = (await readdir(fixtureDir)).filter((file) => file.endsWith(".json")).sort();
const seenKinds = new Set();
assert.equal(files.length, requiredKinds.size, "fixture file count matches required scenarios");

for (const file of files) {
  const path = join(fixtureDir, file);
  const text = await readFile(path, "utf8");
  if (text.length > 5000) {
    failures.push(`${path}: fixture is too large`);
  }
  for (const pattern of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      failures.push(`${path}: contains forbidden text pattern ${pattern}`);
    }
  }
  let fixture;
  try {
    fixture = JSON.parse(text);
  } catch (error) {
    failures.push(`${path}: invalid JSON (${error.message})`);
    continue;
  }
  for (const field of requiredFields) {
    if (!(field in fixture)) {
      failures.push(`${path}: missing ${field}`);
    }
  }
  if (fixture.fixtureVersion !== 1) {
    failures.push(`${path}: fixtureVersion must be 1`);
  }
  if (!requiredKinds.has(fixture.scenarioKind)) {
    failures.push(`${path}: unknown scenarioKind ${fixture.scenarioKind}`);
  } else {
    seenKinds.add(fixture.scenarioKind);
  }
  if (!allowedHosts.has(fixture.host)) {
    failures.push(`${path}: unknown host ${fixture.host}`);
  }
  if (!allowedCommandIds.has(fixture.verificationMetadata?.commandId)) {
    failures.push(`${path}: verification command id is not allowlisted`);
  }
  if (fixture.boundedReadMetadata?.contentCaptured !== false) {
    failures.push(`${path}: bounded read must not capture content`);
  }
  if (fixture.boundedEditMetadata?.replacementCaptured !== false) {
    failures.push(`${path}: bounded edit must not capture replacement text`);
  }
  if (fixture.verificationMetadata?.outputCaptured !== false) {
    failures.push(`${path}: verification must not capture output`);
  }
  if (!Array.isArray(fixture.limitations) || fixture.limitations.length === 0) {
    failures.push(`${path}: limitations must be non-empty`);
  }
  if (!Array.isArray(fixture.nonGoalClaims) || fixture.nonGoalClaims.length === 0) {
    failures.push(`${path}: nonGoalClaims must be non-empty`);
  }
  inspectKeysAndStrings(fixture, path);
}

for (const kind of requiredKinds) {
  if (!seenKinds.has(kind)) {
    failures.push(`${fixtureDir}: missing scenario kind ${kind}`);
  }
}

if (failures.length > 0) {
  console.error("Controlled agent dev-preview fixture validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Controlled agent dev-preview fixture validation passed for ${files.length} deterministic fixtures.`);

function inspectKeysAndStrings(value, path, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectKeysAndStrings(item, path, [...trail, String(index)]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeyPattern.test(key) && !["outputCaptured", "contentCaptured", "replacementCaptured"].includes(key)) {
        failures.push(`${path}: forbidden key ${[...trail, key].join(".")}`);
      }
      inspectKeysAndStrings(nested, path, [...trail, key]);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of forbiddenTextPatterns) {
      if (pattern.test(value)) {
        failures.push(`${path}: forbidden string at ${trail.join(".")} matched ${pattern}`);
      }
    }
  }
}
