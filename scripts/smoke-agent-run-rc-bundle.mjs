import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { npmRunInvocation } from "./lib/npm-spawn.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  ["S67 manual Agent Run dogfood safety", "smoke:agent-run-dogfood"],
  ["S67-S68 Agent Run safety regression bundle", "smoke:agent-run-safety-bundle"],
  ["S67 guided fix loop safety", "smoke:agent-run-guided-fix-loop"],
  ["S68 safer apply UX safety", "smoke:agent-run-safer-apply-ux"],
  ["S69 task memory suggestions safety", "smoke:task-memory-suggestions"],
  ["S69 coding task session safety", "smoke:coding-task-session"],
  ["S69 proposal history safety", "smoke:proposal-history"],
  ["S70 cross-IDE parity evidence", "smoke:ide-parity"],
  ["S70 IDE dogfood local closure evidence", "smoke:ide-dogfood"],
  ["S70 manual RC host parity evidence", "smoke:agent-run-manual-rc-hosts"],
];

validateReferencedPackageScripts();

console.log("Agent Run manual RC smoke bundle starting.");
console.log("This bundle is fail-fast, local/mock-only, and preserves each child smoke command's output.");
console.log("It covers S67/S68/S69 safety surfaces and S70 browser, VS Code, and JetBrains host parity evidence.");

for (const [label, scriptName] of steps) {
  runStep(label, scriptName);
}

console.log("\nAgent Run manual RC smoke bundle passed.");
console.log("Verified curated local/mock-only manual RC evidence for S67/S68/S69 safety surfaces and S70 host parity.");
console.log("This is not real-provider CI evidence, production evidence, release evidence, hosted-backend evidence, workspace mutation evidence, or autonomy evidence.");
console.log("No real provider credentials, hosted Yet AI backend, cloud workspace, managed gateway, product credits, non-loopback runtime evidence, automatic apply, automatic verification, repair, retry, rollback, raw prompts, raw file bodies, diffs, commands, secrets, or browser storage dumps are used as RC evidence by this bundle.");

function validateReferencedPackageScripts() {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const missingScripts = steps.map(([, scriptName]) => scriptName).filter((scriptName) => typeof scripts[scriptName] !== "string");
  if (missingScripts.length > 0) {
    console.error("Agent Run manual RC smoke bundle references missing root scripts.");
    console.error(`Missing package.json scripts: ${missingScripts.join(", ")}`);
    process.exit(1);
  }
}

function runStep(label, scriptName) {
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  const { command, args } = npmRunInvocation(scriptName, [], { env });
  const printable = [command, ...args].join(" ");

  console.log(`\n=== Agent Run RC step: ${label} (${scriptName}) ===`);
  console.log(`> ${printable}`);

  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env,
    shell: false,
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nAgent Run manual RC smoke bundle failed while starting step: ${label} (${scriptName}).`);
    console.error(`Required command \`${command}\` was not found on PATH.`);
    printDependencyGuidance(scriptName);
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nAgent Run manual RC smoke bundle failed while starting step: ${label} (${scriptName}).`);
    console.error(`Spawn error: ${result.error.message}`);
    printDependencyGuidance(scriptName);
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nAgent Run manual RC smoke bundle was interrupted at step: ${label} (${scriptName}).`);
    console.error(`Command interrupted: ${printable}`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nAgent Run manual RC smoke bundle failed at step: ${label} (${scriptName}).`);
    console.error(`Exit status: ${result.status ?? "unknown"}`);
    console.error("The bundle stops here so later smoke commands cannot mask this required RC smoke failure.");
    printDependencyGuidance(scriptName);
    process.exit(result.status ?? 1);
  }
}

function printDependencyGuidance(scriptName) {
  console.error("\nActionable dependency guidance:");
  console.error("- From the repository root, run `npm install` if root Node dependencies are missing.");
  console.error("- For GUI/build/Playwright-backed steps, run `cd apps/gui && npm install && npx playwright install chromium`, then retry the bundle.");
  console.error("- For IDE dogfood-backed steps, ensure Gradle and plugin dependencies required by the existing IDE smokes are available locally.");
  console.error("- Missing dependencies or a failed required RC smoke must not be treated as a passing RC bundle.");
  console.error("- The bundle does not use real provider credentials, hosted Yet AI services, cloud workspaces, shell/git/tool authority through the product, or non-loopback runtime evidence.");
  console.error(`- To isolate the failure, rerun the failing command directly: npm run ${scriptName}`);
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
