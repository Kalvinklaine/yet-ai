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
    label: "S112 explicit controlled search and selection",
    scriptName: "smoke:controlled-agent-search-selection",
    args: [],
    purpose: "validates bounded user-selected search/context metadata and unsafe omission",
  },
  {
    label: "S121 task preset metadata",
    scriptName: "smoke:controlled-agent-task-presets",
    args: [],
    purpose: "validates safe task preset drafts, visible gates, and no automatic send or authority",
  },
  {
    label: "S114 multi-file patch plan review",
    scriptName: "smoke:controlled-agent-patch-plan-preview",
    args: [],
    purpose: "validates bounded patch-plan review metadata and fail-closed unsafe edits",
  },
  {
    label: "S119 staged task run, verification, and follow-up",
    scriptName: "smoke:controlled-agent-two-step-run",
    args: [],
    purpose: "validates staged review, explicit apply/verification gates, and sanitized follow-up state",
  },
  {
    label: "S120 recovery matrix",
    scriptName: "smoke:controlled-agent-recovery-matrix",
    args: [],
    purpose: "validates visible recovery guidance and unsafe automatic recovery blocking",
  },
  {
    label: "S123 beta report template validation",
    scriptName: "dogfood:controlled-agent-task-beta-report",
    args: ["--check-template"],
    purpose: "validates the packaged task-level beta report template stays complete and sanitized",
  },
  {
    label: "S123 beta report sanitizer self-test",
    scriptName: "dogfood:controlled-agent-task-beta-report",
    args: ["--self-test"],
    purpose: "validates sanitized report acceptance and unsafe evidence rejection",
  },
];

const missingScripts = [...new Set(steps.map((step) => step.scriptName))].filter((scriptName) => typeof scripts[scriptName] !== "string");

if (missingScripts.length > 0) {
  console.error("Controlled agent task-level beta smoke bundle references missing required root scripts.");
  console.error(`Missing package.json scripts: ${missingScripts.join(", ")}`);
  process.exit(1);
}

console.log("Controlled agent task-level beta smoke bundle starting.");
console.log(`Running ${steps.length} deterministic local/mock child gates with fail-fast execution.`);
console.log("This bundle preserves child smoke failures and adds no provider calls, real-provider CI, hosted service, account, managed gateway, product credit, cloud workspace, release, marketplace, signing, notarization, production approval, hidden read/search/indexing, apply execution, or verification execution authority.");

const passed = [];
for (const step of steps) {
  runStep(step);
  passed.push(formatStepName(step));
}

console.log("\nControlled agent task-level beta smoke bundle passed.");
console.log(`Passed ${passed.length} local/mock child gates: ${passed.join("; ")}.`);
console.log("Sanitized summary: task preset, explicit search/context selection, bounded patch-plan review, staged apply/verification/follow-up metadata, recovery guidance, and S123 report validation all passed as deterministic local/mock evidence.");
console.log("This is dev-preview beta gate evidence only, not real-provider CI, production autonomy, release readiness, marketplace approval, hosted-backend readiness, publication approval, signing, notarization, or public distribution approval.");

function runStep(step) {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation(step.scriptName, step.args, { env });
  const printable = [command, ...args].join(" ");

  console.log(`\n=== Controlled agent task beta step: ${step.label} (${formatStepName(step)}) ===`);
  console.log(`Purpose: ${step.purpose}`);
  console.log(`> ${printable}`);

  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env, shell: false });

  if (result.error?.code === "ENOENT") {
    console.error(`\nControlled agent task-level beta smoke bundle failed while starting step: ${step.label} (${formatStepName(step)}).`);
    console.error(`Required command \`${command}\` was not found on PATH.`);
    printDependencyGuidance(step);
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nControlled agent task-level beta smoke bundle failed while starting step: ${step.label} (${formatStepName(step)}).`);
    console.error(`Spawn error: ${result.error.message}`);
    printDependencyGuidance(step);
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nControlled agent task-level beta smoke bundle was interrupted at step: ${step.label} (${formatStepName(step)}).`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nControlled agent task-level beta smoke bundle failed at step: ${step.label} (${formatStepName(step)}).`);
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error("The bundle stops here so later beta gates cannot mask this required child gate failure.");
    printDependencyGuidance(step);
    process.exit(result.status ?? 1);
  }
}

function printDependencyGuidance(step) {
  console.error("\nActionable dependency guidance:");
  console.error("- From the repository root, run `npm install` if root Node dependencies are missing.");
  console.error("- If GUI or VS Code plugin dependencies are missing in this worktree, restore their local node_modules, then retry.");
  console.error("- Missing scripts, missing dependencies, or failed child gates must not be treated as a passing task-level beta bundle.");
  console.error("- This bundle remains local/mock-only and does not use real provider credentials, hosted Yet AI services, cloud workspaces, managed gateways, product credits, real-provider CI, package publishing, signing, release approval, or marketplace approval.");
  console.error(`- To isolate the failure, rerun the failing command directly: npm run ${step.scriptName}${step.args.length > 0 ? ` -- ${step.args.join(" ")}` : ""}`);
}

function formatStepName(step) {
  return `${step.scriptName}${step.args.length > 0 ? ` ${step.args.join(" ")}` : ""}`;
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
