import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  {
    label: "S125 controlled task harness metadata gate",
    script: "scripts/smoke-controlled-agent-task-harness.mjs",
    purpose: "validates controlled task harness metadata, fail-closed states, and no widened authority",
  },
  {
    label: "S126 controlled workflow transcript metadata gate",
    script: "scripts/smoke-controlled-agent-workflow-transcript.mjs",
    purpose: "validates sanitized controlled workflow transcript shaping and unsafe marker omission",
  },
  {
    label: "S127 controlled-agent storage/privacy checker",
    script: "scripts/check-controlled-agent-storage-privacy.mjs",
    purpose: "validates safe evidence inventory inputs and expected unsafe fixture rejection",
  },
  {
    label: "S129 packaged VS Code controlled task gate",
    script: "scripts/smoke-vscode-packaged-controlled-task.mjs",
    purpose: "validates local dev-preview VSIX controlled-task archive evidence without launching VS Code",
  },
  {
    label: "Existing controlled-agent explicit search selection gate",
    script: "scripts/smoke-controlled-agent-search-selection.mjs",
    purpose: "validates bounded user-selected search/context metadata and unsafe omission",
  },
  {
    label: "Existing controlled-agent task preset gate",
    script: "scripts/smoke-controlled-agent-task-presets.mjs",
    purpose: "validates safe task preset drafts, visible gates, and no automatic send or authority",
  },
  {
    label: "Existing controlled-agent patch plan preview gate",
    script: "scripts/smoke-controlled-agent-patch-plan-preview.mjs",
    purpose: "validates bounded patch-plan review metadata and fail-closed unsafe edits",
  },
  {
    label: "Existing controlled-agent recovery matrix gate",
    script: "scripts/smoke-controlled-agent-recovery-matrix.mjs",
    purpose: "validates visible recovery guidance and unsafe automatic recovery blocking",
  },
  {
    label: "Existing controlled-agent verification follow-up gate",
    script: "scripts/smoke-controlled-agent-verification-followup.mjs",
    purpose: "validates allowlisted verification metadata and explicit follow-up gates",
  },
];

validateReferencedScripts();

console.log("Controlled-agent hardening bundle starting.");
console.log(`Running ${steps.length} deterministic local/mock child gates with fail-fast execution.`);
console.log("Scope: sanitized dev-preview evidence only; no provider calls, hosted backend, package publication, marketplace, signing, notarization, release claim, hidden reads, apply execution, verification execution, shell expansion, or workspace mutation beyond child local/mock behavior.");

const passed = [];
for (const step of steps) {
  runStep(step);
  passed.push(step.script);
}

console.log("\nControlled-agent hardening bundle passed.");
console.log(`Passed ${passed.length} child gates: ${passed.join("; ")}.`);
console.log("Sanitized summary: controlled task harness, workflow transcript, storage/privacy, packaged VS Code archive evidence, selected context, task presets, patch-plan preview, recovery matrix, and verification follow-up gates passed.");
console.log("This is fail-fast hardening evidence only, not real-provider CI, production autonomy, release readiness, marketplace approval, hosted-backend readiness, publication approval, signing, notarization, or public distribution approval.");

function validateReferencedScripts() {
  const missing = [];
  for (const step of steps) {
    try {
      accessSync(path.join(root, step.script));
    } catch {
      missing.push(step.script);
    }
  }
  if (missing.length > 0) {
    console.error("Controlled-agent hardening bundle references missing required child gates.");
    for (const script of missing) console.error(`- ${script}`);
    process.exit(1);
  }
}

function runStep(step) {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const args = [step.script];
  const printable = ["node", ...args].join(" ");

  console.log(`\n=== Controlled-agent hardening step: ${step.label} (${step.script}) ===`);
  console.log(`Purpose: ${step.purpose}`);
  console.log(`> ${printable}`);

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env,
    shell: false,
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nControlled-agent hardening bundle failed while starting step: ${step.label} (${step.script}).`);
    console.error("Required Node.js executable was not found.");
    printDependencyGuidance(step);
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nControlled-agent hardening bundle failed while starting step: ${step.label} (${step.script}).`);
    console.error(`Spawn error: ${result.error.message}`);
    printDependencyGuidance(step);
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nControlled-agent hardening bundle was interrupted at step: ${step.label} (${step.script}).`);
    console.error(`Signal: ${result.signal}`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nControlled-agent hardening bundle failed at step: ${step.label} (${step.script}).`);
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error("The bundle stops here so later hardening gates cannot mask this required child gate failure.");
    printDependencyGuidance(step);
    process.exit(result.status ?? 1);
  }
}

function printDependencyGuidance(step) {
  console.error("\nActionable dependency guidance:");
  console.error("- From the repository root, restore local Node dependencies if a child GUI or package inspection smoke reports missing modules.");
  console.error("- For the packaged VS Code gate, run `npm run prepare:vscode-preview` first if the dev-preview VSIX or checksum is absent.");
  console.error("- Missing scripts, missing dependencies, or failed child gates must not be treated as a passing hardening bundle.");
  console.error("- The bundle remains local/mock-only and does not use real provider credentials, hosted Yet AI services, cloud workspaces, managed gateways, product credits, package publication, signing, notarization, release approval, marketplace approval, hidden reads, shell expansion, automatic apply, or automatic verification.");
  console.error(`- To isolate the failure, rerun the failing command directly: node ${step.script}`);
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
