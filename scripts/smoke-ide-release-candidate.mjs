import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitStatusLimit = 40;
const maxCommandOutputBytes = 96 * 1024 * 1024;

const steps = [
  ["Repository contracts/check bundle", "npm", ["run", "check"], "."],
  ["Build GUI assets for packaged/browser smokes", "npm", ["run", "build"], "apps/gui"],
  ["Check packaged GUI asset freshness fixtures", "npm", ["run", "check:gui-asset-freshness"], "."],
  ["Prepare VS Code dev-preview artifact", "npm", ["run", "prepare:vscode-preview"], "."],
  ["Prepare JetBrains dev-preview artifact", "npm", ["run", "prepare:jetbrains-preview"], "."],
  ["Smoke packaged plugin layout", "npm", ["run", "smoke:plugin-layout"], "."],
  ["Smoke VS Code installable artifact", "npm", ["run", "smoke:vscode-installable"], "."],
  ["Smoke VS Code first-message coverage", "npm", ["run", "smoke:vscode-first-message"], "."],
  ["Smoke JetBrains installable artifact", "npm", ["run", "smoke:jetbrains-installable"], "."],
  ["Smoke JetBrains first-message coverage", "npm", ["run", "smoke:jetbrains-first-message"], "."],
  ["Smoke installed-plugin chat visual coverage", "npm", ["run", "smoke:installed-plugin-chat-visual"], "."],
  ["Smoke installed-plugin Demo Mode first-message coverage", "npm", ["run", "smoke:installed-plugin-demo-mode"], "."],
  ["Smoke login-first mock provider-auth first message", "npm", ["run", "smoke:login-first-message"], "."],
  ["Smoke local runtime/chat/provider path", "npm", ["run", "smoke:local"], "."],
  ["Smoke JetBrains bundled runtime startup", "npm", ["run", "smoke:jetbrains-bundled-runtime"], "."],
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

console.log("\nIDE release-candidate smoke gate passed.");
console.log("Verified repository contracts/checks, GUI build/freshness, dev-preview artifact preparation, packaged plugin layout, VS Code and JetBrains installable artifacts, VS Code and JetBrains first-message coverage, installed-plugin visual coverage, installed-plugin Demo Mode first-message coverage, login-first mock provider-auth first-message coverage, local runtime smoke, JetBrains bundled runtime startup, GitHub staging, manifest combination, workflow/report safety checks, expected public artifact summary, and clean tracked status.");
console.log("This gate is local/mock-only. It does NOT launch real IDEs or JCEF automation, use real provider credentials, call OpenAI/ChatGPT, contact hosted Yet AI services, require a Yet AI account/cloud workspace/managed model gateway/product credits, sign or publish artifacts, upload a marketplace package, or create a production release.");

function runStep(label, command, args, cwd) {
  const printable = [command, ...args].join(" ");
  const stepCwd = path.resolve(root, cwd);
  console.log(`\n=== ${label} ===`);
  console.log(`> ${printable}`);

  const result = spawnSync(platformCommand(command), args, {
    cwd: stepCwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: safeEnv(),
    maxBuffer: maxCommandOutputBytes,
  });

  writeSanitizedOutput(result.stdout, process.stdout);
  writeSanitizedOutput(result.stderr, process.stderr);

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
  const safeNames = new Set([
    "PATH",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LC_COLLATE",
    "LC_MESSAGES",
    "LC_MONETARY",
    "LC_NUMERIC",
    "LC_TIME",
    "LC_ADDRESS",
    "LC_IDENTIFICATION",
    "LC_MEASUREMENT",
    "LC_NAME",
    "LC_PAPER",
    "LC_TELEPHONE",
    "NPM_CONFIG_CACHE",
    "PLAYWRIGHT_BROWSERS_PATH",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "RUST_BACKTRACE",
    "NO_COLOR",
    "FORCE_COLOR",
    "CI",
  ]);
  const unsafeName = /(^|[_-])(?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|api[_-]?key|authorization|bearer|cookie|client[_-]?secret|secret|provider|openai|anthropic|github|aws|azure|google)(?:$|[_-])/i;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => safeNames.has(name.toUpperCase()) && !unsafeName.test(name)),
  );
  env.PATH = process.env.PATH ?? "";
  return env;
}

function writeSanitizedOutput(value, stream) {
  if (typeof value !== "string" || value.length === 0) {
    return;
  }
  stream.write(sanitizeDiagnostic(value));
}

function sanitizeDiagnostic(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "Bearer [redacted]")
    .replace(/sk-(?:proj-)?[A-Za-z0-9._-]{8,}/gi, "[redacted-api-key]")
    .replace(/((?:access|refresh|session|auth)[_-]?token)[\"'`\s:=]+[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi, "=[redacted]")
    .replace(/(authorization|cookie|set-cookie|client_secret|auth_code|code|verifier)[\"'`\s:=]+[^\s,;)]+/gi, "=[redacted]")
    .replace(/mock-(auth-code|access-token|refresh-token|cookie|session|state)-[A-Za-z0-9-]+/gi, "mock-$1-[redacted]")
    .replace(/(?:codex|provider-login)-(session|state)-[A-Za-z0-9-]+/gi, "$1-[redacted]")
    .replace(/(?:vscode-runtime-token|login-smoke-runtime-token)-[A-Za-z0-9-]+/gi, "$1-[redacted]")
    .replace(/jb\.wrapper\.runtime\.[A-Za-z0-9._-]+/gi, "jb.wrapper.runtime.[redacted]")
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]");
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
