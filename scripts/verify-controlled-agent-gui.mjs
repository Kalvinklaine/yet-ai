import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const maxSummaryLines = 24;
const maxSummaryChars = 6000;

const steps = [
  {
    label: "GUI typecheck",
    cwd: guiRoot,
    invocation: npmRunInvocation("typecheck"),
  },
  {
    label: "GUI controlled agent focused tests",
    cwd: guiRoot,
    invocation: packageBinInvocation("vitest", [
      "run",
      "src/App.test.tsx",
      "src/components/AgentRunPanel.test.tsx",
      "src/components/ControlledAgentRunPanel.test.tsx",
      "src/components/ControlledAgentWorkflowTranscriptPanel.test.tsx",
    ]),
  },
  {
    label: "GUI production build",
    cwd: guiRoot,
    invocation: packageBinInvocation("vite", ["build"]),
  },
];

console.log("Controlled-agent GUI verification starting.");
console.log("Scope: local GUI typecheck, focused local Vitest files, and local GUI build only; no provider calls, IDE launch, package publication, or network authority.");

for (const step of steps) {
  runStep(step);
}

console.log("\nControlled-agent GUI verification passed.");

function runStep(step) {
  console.log(`\n=== ${step.label} ===`);
  const result = spawnSync(step.invocation.command, step.invocation.args, {
    cwd: step.cwd,
    env: localOnlyEnv(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
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
    process.exit(result.status ?? 1);
  }
}

function packageBinInvocation(name, args) {
  const command = path.join(guiRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
  return { command, args };
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
