import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  ["JetBrains Gradle tests", "gradle", ["test", "--console=plain"], "apps/plugins/jetbrains"],
  ["VS Code compile and engine connection checks", "npm", ["run", "compile"], "apps/plugins/vscode"],
  ["Cross-IDE preview and first-message dogfood gate", "npm", ["run", "smoke:ide-preview"], "."],
  ["Repository check", "npm", ["run", "check"], "."],
  ["Print tracked git status", "git", ["status", "--short"], "."],
];

for (const [label, command, args, cwd] of steps) {
  runStep(label, command, args, cwd);
}

console.log("\nIDE dogfood closure gate passed.");
console.log("Review the printed git status before closing the gate; final closure should have no unexpected tracked changes.");
console.log("Verified local IDE dogfood checks fail-fast without real provider credentials, OpenAI/ChatGPT calls, hosted Yet AI services, real IDE launch, signing, publishing, or production release claims.");

function runStep(label, command, args, cwd) {
  const printable = [command, ...args].join(" ");
  const stepCwd = path.resolve(root, cwd);
  console.log(`\n=== ${label} ===`);
  console.log(`> ${printable}`);

  const result = spawnSync(platformCommand(command), args, {
    cwd: stepCwd,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nIDE dogfood closure gate failed at step: ${label}`);
    console.error(`Required command \`${command}\` was not found on PATH.`);
    process.exit(1);
  }

  if (result.error !== undefined) {
    console.error(`\nIDE dogfood closure gate failed at step: ${label}`);
    console.error(`Could not run \`${printable}\`: ${result.error.message}`);
    process.exit(1);
  }

  if (result.signal !== null) {
    console.error(`\nIDE dogfood closure gate was interrupted at step: ${label}`);
    console.error(`Command interrupted: ${printable}`);
    process.exit(signalExitCode(result.signal));
  }

  if (result.status !== 0) {
    console.error(`\nIDE dogfood closure gate failed at step: ${label}`);
    console.error(`Command failed: ${printable}`);
    console.error("The gate stops here so later commands cannot mask this failure.");
    process.exit(result.status ?? 1);
  }
}

function platformCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return {
    gradle: "gradle.bat",
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
