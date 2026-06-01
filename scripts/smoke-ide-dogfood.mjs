import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitStatusLimit = 40;

if (process.argv.includes("--check-git-status-only")) {
  assertCleanTrackedGitStatus();
  process.exit(0);
}

const steps = [
  ["JetBrains Gradle tests", "gradle", ["test", "--console=plain"], "apps/plugins/jetbrains"],
  ["VS Code compile and engine connection checks", "npm", ["run", "compile"], "apps/plugins/vscode"],
  ["Cross-IDE preview and first-message dogfood gate", "npm", ["run", "smoke:ide-preview"], "."],
  ["Repository check", "npm", ["run", "check"], "."],
];

for (const [label, command, args, cwd] of steps) {
  runStep(label, command, args, cwd);
}

assertCleanTrackedGitStatus();

console.log("\nIDE dogfood closure gate passed.");
console.log("Verified local IDE dogfood checks fail-fast with clean tracked status and without real provider credentials, OpenAI/ChatGPT calls, hosted Yet AI services, real IDE launch, signing, publishing, or production release claims.");

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

function assertCleanTrackedGitStatus() {
  const label = "Clean tracked git status";
  const args = ["status", "--short", "--untracked-files=no"];
  const printable = ["git", ...args].join(" ");
  console.log(`\n=== ${label} ===`);
  console.log(`> ${printable}`);

  const result = spawnSync(platformCommand("git"), args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nIDE dogfood closure gate failed at step: ${label}`);
    console.error("Required command `git` was not found on PATH.");
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
    if (result.stderr.trim() !== "") {
      console.error(result.stderr.trim());
    }
    process.exit(result.status ?? 1);
  }

  const statusLines = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (statusLines.length === 0) {
    console.log("Tracked git status is clean.");
    return;
  }

  console.error("\nIDE dogfood closure gate failed at step: Clean tracked git status");
  console.error("Tracked git status is dirty. Commit, revert, or intentionally account for these tracked changes before closing the gate.");
  for (const line of statusLines.slice(0, gitStatusLimit)) {
    console.error(line);
  }
  if (statusLines.length > gitStatusLimit) {
    console.error(`... ${statusLines.length - gitStatusLimit} additional tracked status lines omitted`);
  }
  process.exit(1);
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
