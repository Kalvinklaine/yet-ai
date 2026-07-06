import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "docs/dogfood/fixtures/controlled-agent-dev-preview");
const validatorScript = path.join(root, "scripts/validate-controlled-agent-dev-preview-fixtures.mjs");
const summaryLimit = 6;

console.log("Controlled agent dev-preview fixture smoke starting.");
console.log("Running deterministic local fixture validation before reading sanitized metadata.");
console.log("This gate uses static JSON fixtures only: no providers, network, package installs, git authority, runtime start, or workspace mutation.");

const validation = spawnSync(process.execPath, [validatorScript], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1"
  },
  shell: false
});

if (validation.error?.code === "ENOENT") {
  console.error("Controlled agent dev-preview fixture smoke failed before fixture summary.");
  console.error(`Required command \`${process.execPath}\` was not found.`);
  process.exit(1);
}

if (validation.error !== undefined) {
  console.error("Controlled agent dev-preview fixture smoke failed before fixture summary.");
  console.error(`Spawn error: ${validation.error.message}`);
  process.exit(1);
}

if (validation.signal !== null) {
  console.error("Controlled agent dev-preview fixture smoke was interrupted before fixture summary.");
  process.exit(signalExitCode(validation.signal));
}

if (validation.status !== 0) {
  console.error("Controlled agent dev-preview fixture smoke failed closed before fixture summary.");
  process.exit(validation.status ?? 1);
}

const files = readdirSync(fixtureDir).filter((file) => file.endsWith(".json")).sort();
const summaries = files.map((file) => {
  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, file), "utf8"));
  return {
    id: fixture.scenarioId,
    host: fixture.host,
    kind: fixture.scenarioKind,
    start: fixture.startCondition.status,
    read: fixture.boundedReadMetadata.status,
    edit: fixture.boundedEditMetadata.status,
    verify: fixture.verificationMetadata.status,
    repairAttempts: `${fixture.repairMetadata.attemptsUsed}/${fixture.repairMetadata.attemptLimit}`,
    final: fixture.finalReportStatus.status,
    evidence: fixture.finalReportStatus.safeEvidenceCount
  };
});

console.log("\nControlled agent dev-preview fixture smoke passed.");
console.log(`Sanitized summary: ${summaries.length} validated deterministic fixtures.`);
for (const summary of summaries.slice(0, summaryLimit)) {
  console.log(`- ${summary.id}: host=${summary.host}; kind=${summary.kind}; start=${summary.start}; read=${summary.read}; edit=${summary.edit}; verify=${summary.verify}; repair=${summary.repairAttempts}; final=${summary.final}; safeEvidence=${summary.evidence}`);
}
if (summaries.length > summaryLimit) {
  console.log(`- ${summaries.length - summaryLimit} additional validated fixture summaries omitted by bound.`);
}
console.log("Fixture smoke summary contains labels and counters only; no raw bodies, diffs, command output, private paths, secrets, external authority, or production-use claim.");

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
