import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitStatusLimit = 40;

const steps = [
  ["Prepare VS Code dev-preview artifact", "npm", ["run", "prepare:vscode-preview"], "."],
  ["Prepare JetBrains dev-preview artifact", "npm", ["run", "prepare:jetbrains-preview"], "."],
  ["Write required IDE artifact manifest", "npm", ["run", "artifact:manifest", "--", "--require", "vscode,jetbrains"], "."],
  ["Stage split GitHub IDE artifacts", "npm", ["run", "artifact:stage-github"], "."],
  ["Smoke staged GitHub IDE artifacts", "npm", ["run", "smoke:github-ide-artifacts"], "."],
  ["Combine per-platform plugin artifact manifests", "node", ["scripts/combine-plugin-artifact-manifests.mjs", "--input", "dist/github-artifacts", "--output", "dist/combined-plugin-manifest/manifest.json"], "."],
  ["Validate IDE artifact workflow", "npm", ["run", "validate:ide-artifact-workflow"], "."],
  ["Dogfood report template safety check", "npm", ["run", "dogfood:ide-report", "--", "--check-template"], "."],
  ["Dogfood report helper self-test", "npm", ["run", "dogfood:ide-report", "--", "--self-test"], "."],
  ["Print expected public artifact summary", "npm", ["run", "artifact:github-summary"], "."],
];

for (const [label, command, args, cwd] of steps) {
  runStep(label, command, args, cwd);
}

assertCleanTrackedGitStatus();

console.log("\nIDE release-candidate artifact gate passed.");
console.log("Verified local dev-preview artifact preparation, GitHub staging, manifest combination, workflow/report safety checks, expected public artifact summary, and clean tracked status.");
console.log("This gate does NOT launch real IDEs, use real provider credentials, call OpenAI/ChatGPT, contact hosted Yet AI services, sign or publish artifacts, upload a marketplace package, or create a production release.");

function runStep(label, command, args, cwd) {
  const printable = [command, ...args].join(" ");
  const stepCwd = path.resolve(root, cwd);
  console.log(`\n=== ${label} ===`);
  console.log(`> ${printable}`);

  const result = spawnSync(platformCommand(command), args, {
    cwd: stepCwd,
    encoding: "utf8",
    stdio: "inherit",
    env: safeEnv(),
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nIDE release-candidate artifact gate failed at step: ${label}`);
    console.error(`Required command \`${command}\` was not found on PATH.`);
    process.exit(1);
  }
  if (result.error !== undefined) {
    console.error(`\nIDE release-candidate artifact gate failed at step: ${label}`);
    console.error(`Could not run \`${printable}\`: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal !== null) {
    console.error(`\nIDE release-candidate artifact gate was interrupted at step: ${label}`);
    console.error(`Command interrupted: ${printable}`);
    process.exit(signalExitCode(result.signal));
  }
  if (result.status !== 0) {
    console.error(`\nIDE release-candidate artifact gate failed at step: ${label}`);
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
    env: safeEnv(),
  });

  if (result.error?.code === "ENOENT") {
    console.error(`\nIDE release-candidate artifact gate failed at step: ${label}`);
    console.error("Required command `git` was not found on PATH.");
    process.exit(1);
  }
  if (result.error !== undefined) {
    console.error(`\nIDE release-candidate artifact gate failed at step: ${label}`);
    console.error(`Could not run \`${printable}\`: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal !== null) {
    console.error(`\nIDE release-candidate artifact gate was interrupted at step: ${label}`);
    console.error(`Command interrupted: ${printable}`);
    process.exit(signalExitCode(result.signal));
  }
  if (result.status !== 0) {
    console.error(`\nIDE release-candidate artifact gate failed at step: ${label}`);
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

  console.error("\nIDE release-candidate artifact gate failed at step: Clean tracked git status");
  console.error("Tracked git status is dirty. Commit, revert, or intentionally account for these tracked changes before closing the gate.");
  for (const line of statusLines.slice(0, gitStatusLimit)) {
    console.error(line);
  }
  if (statusLines.length > gitStatusLimit) {
    console.error(`... ${statusLines.length - gitStatusLimit} additional tracked status lines omitted`);
  }
  process.exit(1);
}

function safeEnv() {
  return { ...process.env, PATH: process.env.PATH ?? "" };
}

function platformCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return { git: "git.exe", node: "node.exe", npm: "npm.cmd" }[command] ?? command;
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
