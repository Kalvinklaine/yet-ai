import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxSummaryLines = 28;
const maxSummaryChars = 7000;

const steps = [
  {
    label: "Lightweight repository validation",
    invocation: npmRunInvocation("check"),
  },
  {
    label: "GUI controlled-agent verification wrapper",
    invocation: npmRunInvocation("verify:controlled-agent-gui"),
  },
  {
    label: "VS Code controlled-agent verification wrapper",
    invocation: npmRunInvocation("verify:controlled-agent-vscode"),
  },
  {
    label: "Controlled-agent task harness smoke",
    invocation: npmRunInvocation("smoke:controlled-agent-task-harness"),
  },
  {
    label: "Controlled-agent workflow transcript smoke",
    invocation: npmRunInvocation("smoke:controlled-agent-workflow-transcript"),
  },
  {
    label: "Controlled-agent storage/privacy checker",
    invocation: npmRunInvocation("check:controlled-agent-storage-privacy"),
  },
  {
    label: "Packaged controlled-agent wrapper (runs local dev-preview artifact prep, then archive smoke)",
    invocation: npmRunInvocation("verify:controlled-agent-packaged"),
  },
  {
    label: "Controlled-agent repository hygiene wrapper",
    invocation: npmRunInvocation("verify:controlled-agent-repo-hygiene"),
  },
];

console.log("Final controlled-agent hardening verification starting.");
console.log("Scope: fail-fast local verification evidence only; no provider calls, IDE launch, hosted backend, workspace mutation, publication, signing, notarization, release, marketplace, or distribution claim.");
console.log("Output policy: sanitized step labels and bounded output tails only. The packaged wrapper explicitly runs local dev-preview artifact prep before archive/content smoke evidence.");

for (const step of steps) {
  runStep(step);
}

console.log("\nFinal controlled-agent hardening verification passed.");
console.log("Summary: lightweight check, GUI wrapper, VS Code wrapper, task harness smoke, workflow transcript smoke, storage/privacy checker, packaged prep/archive wrapper, and repo hygiene wrapper passed as local hardening evidence only.");

function runStep(step) {
  console.log(`\n=== ${step.label} ===`);
  const result = spawnSync(step.invocation.command, step.invocation.args, {
    cwd: root,
    env: localOnlyEnv(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 30,
    shell: false,
  });

  printSummary(step.label, result.stdout, result.stderr);

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
    console.error("Final hardening verification stops here so later evidence cannot mask this failure.");
    process.exit(result.status ?? 1);
  }
}

function printSummary(label, stdout, stderr) {
  const output = [stdout, stderr].filter(Boolean).join("\n");
  const summary = boundedTail(sanitize(output));
  if (summary.length === 0) {
    console.log(`${label} produced no output.`);
    return;
  }
  console.log(`${label} sanitized output tail:`);
  console.log(summary);
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
