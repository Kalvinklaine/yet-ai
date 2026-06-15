import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ideSurfaceContract } from "./ide-surface-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jetbrainsRoot = path.join(root, "apps", "plugins", "jetbrains");
const failures = [];
const apply = ideSurfaceContract.surfaces.find((surface) => surface.id === "confirmed-edit-apply");
const preview = ideSurfaceContract.surfaces.find((surface) => surface.id === "confirmed-edit-preview");
const reason = apply?.jetbrains?.reason ?? "";
const gradleApplyTests = [
  "ai.yet.plugin.bridge.ControlledIdeActionsTest.*ApplyWorkspaceEdit*",
  "ai.yet.plugin.ui.JetBrainsIdeActionHostTest.*",
  "ai.yet.plugin.ui.YetToolWindowFactoryTest.wrapperSafelyForwardsStrictApplyWorkspaceEditRequestsAfterReadyHandshake",
  "ai.yet.plugin.ui.YetToolWindowFactoryTest.applyWorkspaceEditBridgeRequiresConfirmationBeforeApplying",
  "ai.yet.plugin.ui.YetToolWindowFactoryTest.applyWorkspaceEditBridgeReturnsDeniedWithoutMutation",
  "ai.yet.plugin.ui.YetToolWindowFactoryTest.applyWorkspaceEditBridgeRejectsInvalidAndSanitizesFailures",
  "ai.yet.plugin.ui.YetToolWindowFactoryTest.applyWorkspaceEditReadinessGateRequiresAcceptedHostReadyForCurrentFrame",
  "ai.yet.plugin.ui.YetToolWindowFactoryTest.applyWorkspaceEditBridgeDoesNotCorrelateOversizedInvalidRequestOrLeakRawValues",
  "ai.yet.plugin.ui.YetToolWindowFactoryTest.panelDefersHostReadyUntilPreparedRuntimeConnection",
];

assert(preview?.jetbrains?.status === "supported", "JetBrains confirmed edit preview must remain supported.");
assert(apply?.jetbrains?.status === "dev-preview", "JetBrains confirmed edit apply must remain dev-preview.");
assert(apply?.jetbrains?.smoke?.includes("npm run smoke:jetbrains-edit-proposal"), "JetBrains edit proposal smoke must be registered in the surface contract.");
assert(apply?.jetbrains?.smoke?.includes("npm run smoke:jetbrains-wrapper-browser"), "JetBrains apply dev-preview must include deterministic wrapper-browser lifecycle smoke coverage.");
assert(/existing gui\.applyWorkspaceEditRequest \/ host\.applyWorkspaceEditResult only/i.test(reason), "JetBrains apply must use only existing apply/result bridge messages.");
assert(/explicit GUI apply/i.test(reason), "JetBrains apply must require explicit GUI apply.");
assert(/user confirmation/i.test(reason), "JetBrains apply must require IDE/user confirmation.");
assert(/bounded/i.test(reason), "JetBrains apply must be bounded.");
assert(/existing workspace-relative files/i.test(reason), "JetBrains apply must stay limited to existing workspace-relative files.");
assert(/sanitized/i.test(reason), "JetBrains apply must return sanitized results.");
assert(/no new write-capable bridge messages/i.test(reason), "JetBrains apply must not add write-capable bridge messages.");
for (const phrase of [
  "shell",
  "git",
  "tools",
  "tasks",
  "provider calls",
  "create/delete/rename",
  "apply-patch",
  "arbitrary reads/indexing",
  "autonomous edits",
  "silent mutation",
]) {
  assert(reason.toLowerCase().includes(phrase), `JetBrains apply reason must forbid ${phrase}.`);
}

if (failures.length > 0) {
  reportFailures();
}

console.log("JetBrains edit proposal smoke uses focused Kotlin apply/bridge tests plus the registered wrapper-browser lifecycle smoke as deterministic local evidence.");
console.log("It does not launch IntelliJ/JCEF, call providers, require hosted services, sign, publish, or claim production JetBrains apply support.");
runGradleApplyEvidence();
console.log("JetBrains edit proposal dev-preview smoke passed: surface contract, browser preview-only boundary, focused apply safety tests, readiness gate, denial/rejection, unsafe/oversized requests, sanitized failures, and no silent/autonomous mutation.");

function runGradleApplyEvidence() {
  const args = ["test", "--console=plain", ...gradleApplyTests.flatMap((test) => ["--tests", test])];
  const result = spawnSync(platformCommand("gradle"), args, {
    cwd: jetbrainsRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
    env: process.env,
  });
  const command = `cd apps/plugins/jetbrains && gradle ${args.join(" ")}`;
  if (result.error?.code === "ENOENT") {
    console.error("JetBrains edit proposal smoke failed: Gradle was not found on PATH.");
    console.error("Install Gradle or add it to PATH, then rerun npm run smoke:jetbrains-edit-proposal.");
    process.exit(1);
  }
  if (result.error !== undefined) {
    console.error(`JetBrains edit proposal smoke failed while launching Gradle: ${sanitizeText(result.error.message)}`);
    process.exit(1);
  }
  if (result.signal !== null) {
    console.error(`JetBrains edit proposal smoke interrupted by ${sanitizeText(result.signal)}.`);
    process.exit(signalExitCode(result.signal));
  }
  if (result.status !== 0) {
    console.error("JetBrains edit proposal focused Gradle evidence failed.");
    console.error(`> ${command}`);
    printBoundedOutput(result.stdout, "stdout");
    printBoundedOutput(result.stderr, "stderr");
    process.exit(result.status ?? 1);
  }
  console.log(`Focused Kotlin apply/bridge safety evidence passed: ${command}`);
  printSuccessTail(result.stdout);
}

function printSuccessTail(output) {
  const lines = sanitizeText(output).split(/\r?\n/).filter(Boolean);
  const useful = lines.filter((line) => /BUILD SUCCESSFUL|tests? completed|actionable tasks/i.test(line)).slice(-4);
  for (const line of useful) console.log(line);
}

function printBoundedOutput(output, label) {
  const lines = sanitizeText(output).split(/\r?\n/).filter(Boolean).slice(-80);
  if (lines.length === 0) return;
  console.error(`--- sanitized ${label} tail ---`);
  for (const line of lines) console.error(line.slice(0, 1000));
}

function sanitizeText(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{8,}/gi, "[redacted-api-key]")
    .replace(/([?&](?:token|code|key|secret|session|verifier)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|cookie)\b\s*[:=]\s*[^\s,;]+/gi, "=[redacted]")
    .replace(/\/Users\/[^\s)]+/g, "[redacted-absolute-path]")
    .replace(/file:\/\/[^\s)]+/g, "[redacted-file-url]");
}

function reportFailures() {
  console.error("JetBrains edit proposal smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function platformCommand(command) {
  if (process.platform !== "win32") return command;
  return { gradle: "gradle.bat" }[command] ?? command;
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}
