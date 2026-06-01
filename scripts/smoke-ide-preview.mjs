import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  ["Prepare VS Code dev-preview", "npm", ["run", "prepare:vscode-preview"]],
  ["Smoke VS Code installable artifact", "npm", ["run", "smoke:vscode-installable"]],
  ["Smoke VS Code generated preview", "npm", ["run", "smoke:vscode-preview"]],
  ["Smoke VS Code first-message preview", "npm", ["run", "smoke:vscode-first-message"]],
  ["Prepare JetBrains dev-preview", "npm", ["run", "prepare:jetbrains-preview"]],
  ["Smoke JetBrains installable artifact", "npm", ["run", "smoke:jetbrains-installable"]],
  ["Smoke JetBrains generated preview", "npm", ["run", "smoke:jetbrains-preview"]],
  ["Smoke JetBrains packaged GUI browser", "npm", ["run", "smoke:jetbrains-gui-browser"]],
  ["Smoke JetBrains first-message preview", "npm", ["run", "smoke:jetbrains-first-message"]],
];

validateReferencedPackageScripts();

for (const [label, command, args] of steps) {
  runStep(label, command, args);
}

console.log("\nCross-IDE preview smoke passed.");
console.log("Verified VS Code and JetBrains local installable/generated artifacts and first-message preview paths without launching real IDEs, using provider credentials, calling OpenAI/ChatGPT, or contacting hosted Yet AI services.");

function validateReferencedPackageScripts() {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const missingScripts = steps
    .filter(([, command, args]) => command === "npm" && args[0] === "run")
    .map(([, , args]) => args[1])
    .filter((scriptName) => typeof scripts[scriptName] !== "string");

  if (missingScripts.length > 0) {
    console.error("Cross-IDE preview smoke configuration is inconsistent.");
    console.error(`Missing root package.json scripts: ${missingScripts.join(", ")}`);
    process.exit(1);
  }
}

function runStep(label, command, args) {
  const printable = [command, ...args].join(" ");
  console.log(`\n=== ${label} ===`);
  console.log(`> ${printable}`);

  const result = spawnSync(platformCommand(command), args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nCross-IDE preview smoke failed at step: ${label}`);
    console.error(`Required command \`${command}\` was not found on PATH.`);
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nCross-IDE preview smoke failed at step: ${label}`);
    console.error(`Could not run \`${printable}\`: ${result.error.message}`);
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nCross-IDE preview smoke was interrupted at step: ${label}`);
    console.error(`Command interrupted: ${printable}`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nCross-IDE preview smoke failed at step: ${label}`);
    console.error(`Command failed: ${printable}`);
    console.error("See the step output above for sanitized actionable diagnostics from the underlying prepare/smoke script.");
    process.exit(result.status ?? 1);
  }
}

function platformCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return {
    npm: "npm.cmd",
  }[command] ?? command;
}

function signalExitCode(signal) {
  return {
    SIGHUP: 129,
    SIGINT: 130,
    SIGTERM: 143,
  }[signal] ?? 1;
}
