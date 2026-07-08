import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxSummaryLines = 80;
const maxSummaryChars = 12000;

const steps = [
  {
    label: "Repository whitespace check",
    command: "git",
    args: ["diff", "--check"],
    allowOutput: false,
  },
  {
    label: "Repository tracked status check",
    command: "git",
    args: ["status", "--short", "--untracked-files=no"],
    allowOutput: true,
    requireEmptyOutput: true,
  },
];

console.log("Controlled-agent repo hygiene verification starting.");
console.log("Scope: local git diff whitespace check and tracked status check only; no provider calls, IDE launch, package publication, or network authority.");

for (const step of steps) {
  runStep(step);
}

console.log("\nControlled-agent repo hygiene verification passed.");

function runStep(step) {
  console.log(`\n=== ${step.label} ===`);
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    env: localOnlyEnv(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
    shell: false,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  printSummary(step.label, output, step.allowOutput);

  if (result.error !== undefined) {
    console.error(`${step.label} could not start.`);
    console.error(sanitize(result.error.message));
    process.exit(1);
  }
  if (result.signal !== null) {
    console.error(`${step.label} was interrupted by ${sanitize(result.signal)}.`);
    process.exit(signalExitCode(result.signal));
  }
  if (result.status !== 0) {
    console.error(`${step.label} failed with exit status ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }
  if (step.requireEmptyOutput && output.trim() !== "") {
    console.error(`${step.label} found tracked changes. Commit, revert, or explicitly document expected tracked changes before treating repo hygiene as passing.`);
    process.exit(1);
  }
}

function printSummary(label, output, allowOutput) {
  const summary = boundedTail(sanitize(output));
  if (summary.length === 0) {
    console.log(`${label} produced no output.`);
    return;
  }
  console.log(`${label} sanitized output tail:`);
  console.log(summary);
  if (!allowOutput) {
    console.log("Non-empty output from this step is diagnostic only; the child exit status remains authoritative.");
  }
}

function boundedTail(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const tail = lines.slice(-maxSummaryLines).join("\n");
  return tail.length > maxSummaryChars ? `${tail.slice(-maxSummaryChars)}\n[summary truncated]` : tail;
}

function sanitize(text) {
  let sanitized = String(text)
    .replaceAll(root, "<repo>")
    .replaceAll(process.cwd(), "<cwd>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/(?:api[-_]?key|token|password|secret)=\S+/gi, "=[redacted]");
  if (process.env.HOME !== undefined && process.env.HOME !== "") {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(process.env.HOME), "g"), "<home>");
  }
  return sanitized;
}

function localOnlyEnv() {
  return { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
