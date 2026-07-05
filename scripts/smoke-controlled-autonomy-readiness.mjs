import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
const requiredSteps = [
  ["S86 one-step controlled loop", "smoke:controlled-agent-one-step-loop"],
  ["S87 one-attempt repair loop", "smoke:controlled-agent-repair-loop"],
  ["S88 useful dogfood fixture gate", "smoke:controlled-agent-dogfood-useful"],
  ["S90 public wording audit", "audit:controlled-autonomy-wording"],
];
const optionalSteps = [["S89 resilience gate", "smoke:controlled-agent-resilience"]];
const steps = [...requiredSteps, ...optionalSteps.filter(([, scriptName]) => typeof scripts[scriptName] === "string")];
const missingScripts = requiredSteps.map(([, scriptName]) => scriptName).filter((scriptName) => typeof scripts[scriptName] !== "string");

if (missingScripts.length > 0) {
  console.error("Controlled autonomy readiness smoke references missing required root scripts.");
  console.error(`Missing package.json scripts: ${missingScripts.join(", ")}`);
  process.exit(1);
}

console.log("Controlled autonomy readiness smoke starting.");
console.log(`Running ${steps.length} deterministic local/mock gates with fail-fast execution.`);
console.log("This bundle adds no provider, network, git, package-install, runtime, broad workspace, or production autonomy authority.");

const passed = [];
for (const [label, scriptName] of steps) {
  runStep(label, scriptName);
  passed.push(scriptName);
}

console.log("\nControlled autonomy readiness smoke passed.");
console.log(`Passed ${passed.length} local/mock gates: ${passed.join(", ")}.`);
console.log("Verified bounded one-step loop, one-attempt repair loop, useful dogfood fixtures, optional resilience when listed, and public wording safety.");
console.log("This is not production autonomy, release evidence, marketplace evidence, real-provider CI, hosted-backend evidence, or broad workspace authority.");

function runStep(label, scriptName) {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation(scriptName, [], { env });
  const printable = [command, ...args].join(" ");

  console.log(`\n=== Controlled autonomy readiness step: ${label} (${scriptName}) ===`);
  console.log(`> ${printable}`);

  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env, shell: false });

  if (result.error?.code === "ENOENT") {
    console.error(`\nControlled autonomy readiness smoke failed while starting step: ${label} (${scriptName}).`);
    console.error(`Required command \`${command}\` was not found on PATH.`);
    printDependencyGuidance(scriptName);
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nControlled autonomy readiness smoke failed while starting step: ${label} (${scriptName}).`);
    console.error(`Spawn error: ${result.error.message}`);
    printDependencyGuidance(scriptName);
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nControlled autonomy readiness smoke was interrupted at step: ${label} (${scriptName}).`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nControlled autonomy readiness smoke failed at step: ${label} (${scriptName}).`);
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error("The bundle stops here so later readiness gates cannot mask this failure.");
    printDependencyGuidance(scriptName);
    process.exit(result.status ?? 1);
  }
}

function printDependencyGuidance(scriptName) {
  console.error("\nActionable dependency guidance:");
  console.error("- From the repository root, run `npm install` if root Node dependencies are missing.");
  console.error("- If GUI or VS Code plugin dependencies are missing in this worktree, restore their local node_modules, then retry.");
  console.error("- This smoke remains local/mock-only and does not use real provider credentials, hosted Yet AI services, cloud workspaces, package installation, git authority, or non-loopback runtime evidence.");
  console.error(`- To isolate the failure, rerun the failing command directly: npm run ${scriptName}`);
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
