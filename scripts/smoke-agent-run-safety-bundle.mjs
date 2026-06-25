import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const steps = [
  ["Model proposal safety", "smoke:model-proposal-agent-run"],
  ["Checkpoint readiness safety", "smoke:agent-run-checkpoint-readiness"],
  ["Explicit apply safety", "smoke:agent-run-apply"],
  ["Explicit verification safety", "smoke:agent-run-verification"],
  ["S61 multi-step plan preview safety", "smoke:agent-run-multistep-plan"],
  ["S62 follow-up loop safety", "smoke:agent-run-followup-loop"],
];

console.log("Agent Run safety regression bundle starting.");
console.log("This bundle is local/mock-only and preserves each smoke command's output.");

for (const [label, scriptName] of steps) {
  console.log(`\n=== Agent Run safety step: ${label} (${scriptName}) ===`);
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation(scriptName, [], { env });
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env, shell: false });

  if (result.error) {
    console.error(`\nAgent Run safety bundle failed while starting step: ${label} (${scriptName}).`);
    console.error(`Spawn error: ${result.error.message}`);
    printDependencyGuidance(scriptName);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\nAgent Run safety bundle failed at step: ${label} (${scriptName}).`);
    console.error(`Exit status: ${result.status ?? "unknown"}${result.signal ? ` (signal ${result.signal})` : ""}`);
    printDependencyGuidance(scriptName);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAgent Run safety regression bundle passed.");
console.log("Verified curated local/mock safety gates for model proposal, checkpoint readiness, apply, verification, S61 plan preview, and S62 follow-up loop.");

function printDependencyGuidance(scriptName) {
  console.error("\nActionable dependency guidance:");
  console.error("- From the repository root, run `npm install` if root Node dependencies are missing.");
  console.error("- For GUI/build/Playwright-backed steps, run `cd apps/gui && npm install && npx playwright install chromium`, then retry the bundle.");
  console.error("- The bundle does not use real provider credentials, hosted Yet AI services, cloud workspaces, shell/git/tool authority through the product, or non-loopback runtime evidence.");
  console.error(`- To isolate the failure, rerun the failing command directly: npm run ${scriptName}`);
}
