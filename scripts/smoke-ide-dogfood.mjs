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
  ["Dogfood report template safety check", "npm", ["run", "dogfood:ide-report", "--", "--check-template"], "."],
  ["Dogfood report helper self-test", "npm", ["run", "dogfood:ide-report", "--", "--self-test"], "."],
  ["Cross-IDE preview and first-message dogfood gate", "npm", ["run", "smoke:ide-preview"], "."],
  ["Repository check", "npm", ["run", "check"], "."],
];

for (const [label, command, args, cwd] of steps) {
  runStep(label, command, args, cwd);
}

assertCleanTrackedGitStatus();

console.log("\nIDE dogfood closure gate passed.");
printFinalGuidance();

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

function printFinalGuidance() {
  console.log("Verified local/mock-only IDE dogfood checks fail-fast with clean tracked status.");
  console.log("This gate does NOT launch real VS Code or JetBrains IDEs, use real provider credentials, call OpenAI/ChatGPT, contact hosted Yet AI services, sign or publish artifacts, or create a production release.");
  console.log("\nNext manual dogfood steps:");
  console.log("1. Download and install the generated VS Code/JetBrains dev-preview artifacts from the manual GitHub Actions artifact workflow, or use the local generated artifacts under dist/plugins/ after this gate.");
  console.log("2. Keep the normal plugin-launched runtime path: VS Code launch mode `auto`; JetBrains `Launch mode` as `auto` or `launch`. Use `connect` only for an explicitly manual loopback runtime.");
  console.log("3. Generate the safe report template with `npm run dogfood:ide-report -- --template` and validate any local report with `npm run dogfood:ide-report -- --check path/to/local-report.md` before sharing.");
  console.log("4. Record only sanitized status labels, sanitized failure summaries, and `not run` values for untested items.");
  console.log("5. Never include tokens, provider keys, bearer headers, auth codes, OAuth tokens, cookies, private paths, raw bridge payloads, request bodies, browser storage dumps, raw provider responses, raw prompts, file contents, or screenshots with secrets.");
}
