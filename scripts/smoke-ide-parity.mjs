import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  ["Prepare VS Code dev-preview artifacts", "npm", ["run", "prepare:vscode-preview"]],
  ["Smoke VS Code first-message surface", "npm", ["run", "smoke:vscode-first-message"]],
  ["Smoke VS Code read-only wrapper surface", "npm", ["run", "smoke:vscode-wrapper-browser"]],
  ["Smoke VS Code confirmed edit preview/apply surface", "npm", ["run", "smoke:vscode-edit-proposal"]],
  ["Prepare JetBrains dev-preview artifacts", "npm", ["run", "prepare:jetbrains-preview"]],
  ["Smoke JetBrains first-message surface", "npm", ["run", "smoke:jetbrains-first-message"]],
  ["Smoke JetBrains read-only wrapper surface", "npm", ["run", "smoke:jetbrains-wrapper-browser"]],
  ["Smoke JetBrains confirmed edit dev-preview contract", "npm", ["run", "smoke:jetbrains-edit-proposal"]],
  ["Validate cross-IDE surface contract", "npm", ["run", "validate:ide-surface-contract"]],
];

validateReferencedPackageScripts();

console.log("Cross-IDE parity smoke is local-only and fail-fast.");
console.log("It prepares ignored dev-preview artifacts and does not launch real IDEs, call providers, require a hosted backend, sign, publish, or claim a production release.");
console.log("JetBrains confirmed edit apply is included only as a bounded dev-preview contract smoke over existing apply/result bridge messages.");

for (const [label, command, args] of steps) {
  runStep(label, command, args);
}

console.log("\nCross-IDE parity smoke passed.");

function validateReferencedPackageScripts() {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const missingScripts = steps
    .filter(([, command, args]) => command === "npm" && args[0] === "run")
    .map(([, , args]) => args[1])
    .filter((scriptName) => typeof scripts[scriptName] !== "string");
  if (missingScripts.length > 0) {
    console.error(`Cross-IDE parity smoke references missing root scripts: ${missingScripts.join(", ")}`);
    process.exit(1);
  }
}

function runStep(label, command, args) {
  const printable = [command, ...args].join(" ");
  console.log(`\n=== ${label} ===`);
  console.log(`> ${printable}`);
  const result = spawnSync(platformCommand(command), args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error?.code === "ENOENT") {
    console.error(`Required command \`${command}\` was not found on PATH.`);
    process.exit(1);
  }
  if (result.error !== undefined) {
    console.error(`Could not run \`${printable}\`: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal !== null) {
    process.exit(signalExitCode(result.signal));
  }
  if (result.status !== 0) {
    console.error(`\nCross-IDE parity smoke failed at step: ${label}`);
    console.error("See the step output above for sanitized actionable diagnostics from the underlying local smoke.");
    process.exit(result.status ?? 1);
  }
}

function platformCommand(command) {
  if (process.platform !== "win32") return command;
  return { npm: "npm.cmd" }[command] ?? command;
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
