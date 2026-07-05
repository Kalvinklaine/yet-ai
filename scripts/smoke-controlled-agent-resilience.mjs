import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guiRoot = path.join(root, "apps", "gui");
const vscodeRoot = path.join(root, "apps", "plugins", "vscode");
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
const steps = [
  {
    label: "GUI controlled resilience tests",
    cwd: guiRoot,
    invocation: npmInvocation(["test", "--", "App", "controlledOneStepAgentLoop", "controlledRepairLoop"], { env }),
    coverage: "stale controlled verification results, duplicate terminal results, explicit Stop, runtime disconnect, and bounded repair stop states",
  },
  {
    label: "VS Code webview privileged-message readiness tests",
    cwd: vscodeRoot,
    invocation: npmInvocation(["run", "compile"], { env }),
    coverage: "compiled webview guards for pre-ready controlled edit/command rejection and stale host-ready blocking",
  },
  {
    label: "VS Code webview stale-ready smoke",
    cwd: vscodeRoot,
    invocation: { command: process.execPath, args: [path.join(vscodeRoot, "out", "webview.test.js")] },
    coverage: "stale host-ready correlation, pre-ready command rejection, and sanitized fail-closed results",
  },
];

console.log("Controlled Agent resilience smoke starting.");
console.log("This smoke is local/mock-only and covers stale, duplicate, Stop, and runtime-disconnect resilience without adding bridge or runtime authority.");

for (const step of steps) {
  runStep(step);
}

console.log("\nControlled Agent resilience smoke passed.");
console.log("Verified stale/duplicate host result handling, explicit Stop handling, runtime-disconnect stop behavior, repair stop eligibility, and VS Code stale host-ready fail-closed guards.");
console.log("This is not real-provider CI, production autonomy, broad command authority, background workspace access, marketplace evidence, or release evidence.");

function runStep(step) {
  const printable = [step.invocation.command, ...step.invocation.args].join(" ");
  console.log(`\n=== Controlled resilience step: ${step.label} ===`);
  console.log(`Coverage: ${step.coverage}`);
  console.log(`> ${printable}`);

  const result = spawnSync(step.invocation.command, step.invocation.args, {
    cwd: step.cwd,
    stdio: "inherit",
    env,
    shell: false,
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nControlled Agent resilience smoke failed while starting: ${step.label}.`);
    console.error(`Required command \`${step.invocation.command}\` was not found on PATH.`);
    printDependencyGuidance();
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nControlled Agent resilience smoke failed while starting: ${step.label}.`);
    console.error(`Spawn error: ${result.error.message}`);
    printDependencyGuidance();
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nControlled Agent resilience smoke was interrupted at step: ${step.label}.`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nControlled Agent resilience smoke failed at step: ${step.label}.`);
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error("The smoke stops here so later steps cannot mask this resilience failure.");
    printDependencyGuidance();
    process.exit(result.status ?? 1);
  }
}

function printDependencyGuidance() {
  console.error("\nActionable dependency guidance:");
  console.error("- From the repository root, run `npm install` if root Node dependencies are missing.");
  console.error("- If GUI dependencies are missing in this worktree, restore or install `apps/gui/node_modules`, then retry.");
  console.error("- If VS Code plugin dependencies are missing, restore or install `apps/plugins/vscode/node_modules`, then retry.");
  console.error("- This smoke remains local/mock-only and does not use real provider credentials, hosted Yet AI services, shell/git/tool authority through the product, or non-loopback runtime evidence.");
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
