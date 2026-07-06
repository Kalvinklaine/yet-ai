import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
const steps = [
  {
    label: "S90 controlled-autonomy readiness bundle",
    scriptName: "smoke:controlled-autonomy-readiness",
    coverage: "bounded one-step, one-attempt repair, useful dogfood, optional resilience, and wording safety gates",
  },
  {
    label: "S92 sanitized dev-preview report evidence",
    scriptName: "smoke:controlled-agent-dev-preview-report",
    coverage: "pure sanitized report metadata over supplied local/mock status, one-step, repair, and run evidence only",
  },
  {
    label: "S91 public wording guard",
    scriptName: "audit:controlled-autonomy-wording",
    coverage: "public wording remains bounded for the experimental controlled local agent dev-preview",
  },
];
const missingScripts = steps.map((step) => step.scriptName).filter((scriptName) => typeof scripts[scriptName] !== "string");

if (missingScripts.length > 0) {
  console.error("Controlled agent dev-preview smoke references missing required root scripts.");
  console.error(`Missing package.json scripts: ${missingScripts.join(", ")}`);
  process.exit(1);
}

console.log("Controlled agent dev-preview smoke starting.");
console.log(`Running ${steps.length} deterministic local/mock gates with fail-fast execution.`);
console.log("This skeleton adds no provider calls, package installs, network, git/tool authority, runtime start, broad workspace mutation, release evidence, marketplace evidence, or production autonomy claim.");

const passed = [];
for (const step of steps) {
  runStep(step);
  passed.push(step.scriptName);
}

console.log("\nControlled agent dev-preview smoke passed.");
console.log(`Passed ${passed.length} local/mock gates: ${passed.join(", ")}.`);
console.log("Sanitized summary: S91/S92 dev-preview evidence is limited to existing bounded local/mock readiness, pure sanitized report metadata, and wording gates.");
console.log("This is not production autonomy, release evidence, marketplace evidence, real-provider CI, hosted-backend evidence, cloud-workspace evidence, or broad workspace authority.");

function runStep(step) {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation(step.scriptName, [], { env });
  const printable = [command, ...args].join(" ");

  console.log(`\n=== Controlled agent dev-preview step: ${step.label} (${step.scriptName}) ===`);
  console.log(`Coverage: ${step.coverage}`);
  console.log(`> ${printable}`);

  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env, shell: false });

  if (result.error?.code === "ENOENT") {
    console.error(`\nControlled agent dev-preview smoke failed while starting step: ${step.label} (${step.scriptName}).`);
    console.error(`Required command \`${command}\` was not found on PATH.`);
    printDependencyGuidance(step.scriptName);
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nControlled agent dev-preview smoke failed while starting step: ${step.label} (${step.scriptName}).`);
    console.error(`Spawn error: ${result.error.message}`);
    printDependencyGuidance(step.scriptName);
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nControlled agent dev-preview smoke was interrupted at step: ${step.label} (${step.scriptName}).`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nControlled agent dev-preview smoke failed at step: ${step.label} (${step.scriptName}).`);
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error("The skeleton stops here so later dev-preview gates cannot mask this failure.");
    printDependencyGuidance(step.scriptName);
    process.exit(result.status ?? 1);
  }
}

function printDependencyGuidance(scriptName) {
  console.error("\nActionable dependency guidance:");
  console.error("- From the repository root, run `npm install` if root Node dependencies are missing.");
  console.error("- If GUI or VS Code plugin dependencies are missing in this worktree, restore their local node_modules, then retry.");
  console.error("- This smoke remains local/mock-only and does not use real provider credentials, hosted Yet AI services, cloud workspaces, managed gateways, product credits, package installation, git authority, runtime start, or non-loopback runtime evidence.");
  console.error(`- To isolate the failure, rerun the failing command directly: npm run ${scriptName}`);
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
