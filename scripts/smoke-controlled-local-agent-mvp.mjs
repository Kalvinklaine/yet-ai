import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled local agent MVP smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const hash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const rawMarkers = [
  "controlled-local-agent-mvp-secret-should-not-leak",
  "raw prompt from controlled local agent MVP smoke",
  "raw file body from controlled local agent MVP smoke",
  "raw diff from controlled local agent MVP smoke",
  "npm run hidden-controlled-local-agent-mvp",
  "provider payload from controlled local agent MVP smoke",
  "shell git network browser storage claim from controlled local agent MVP smoke",
  "/Users/private/controlled-local-agent-mvp",
  "sk-controlled-local-agent-mvp-secret",
];

const { buildControlledLocalAgentMvp } = await importMvpService();

const reports = {
  disabled: buildControlledLocalAgentMvp(undefined),
  blockedNoWorkspace: buildControlledLocalAgentMvp({
    userOptIn: userOptIn(),
    readiness: readiness({ workspaceMode: "none", isolationStatus: "disabled", checkpointStatus: "not_applicable", rollbackStatus: "not_applicable", summary: "No controlled workspace metadata is available." }),
  }),
  ready: buildControlledLocalAgentMvp({
    userOptIn: userOptIn(),
    readiness: readiness(),
    progress: { runState: { enabled: true, phase: "waiting_for_user", summary: "Preview bounded metadata before the user starts anything." } },
  }),
  running: buildControlledLocalAgentMvp({
    userOptIn: userOptIn(),
    readiness: readiness(),
    boundedRead: fileRead(),
    editMetadata: editMetadata("planned"),
    verification: commandRun("running"),
    repair: repairMetadata("eligible", 0, 1),
    progress: {
      runState: { enabled: true, phase: "running_verification", summary: "Review allowlisted verification metadata.", counters: { stepsCompleted: 3, fileReadsUsed: 1, readBytesUsed: 120, userTurns: 1 } },
      commandRunner: { state: "running", durationMs: 1250, summary: "Review allowlisted verification metadata." },
    },
  }),
  completed: buildControlledLocalAgentMvp({
    userOptIn: userOptIn(),
    readiness: readiness(),
    boundedRead: fileRead(),
    editMetadata: editMetadata("applied"),
    verification: commandRun("succeeded"),
    repair: repairMetadata("completed", 1, 2),
    progress: { runState: { enabled: true, phase: "completed", summary: "Controlled metadata flow completed." } },
  }),
  stopped: buildControlledLocalAgentMvp({
    userOptIn: userOptIn(),
    readiness: readiness(),
    verification: commandRun("killed"),
    progress: { runState: { enabled: true, phase: "stopped", stopped: true, summary: "User stopped the controlled metadata flow." } },
  }),
  repairExhausted: buildControlledLocalAgentMvp({
    userOptIn: userOptIn(),
    readiness: readiness(),
    repair: repairMetadata("exhausted", 2, 2),
    progress: { runState: { enabled: true, phase: "planning", summary: "Repair attempts are exhausted." }, repairLoop: { state: "exhausted", mustStop: true, attemptCount: 2, maxAttempts: 2, diagnostics: ["repair_exhausted"] } },
  }),
  unsafe: buildControlledLocalAgentMvp({
    userOptIn: userOptIn(),
    readiness: { ...readiness(), rawPrompt: rawMarkers[1], rawFile: rawMarkers[2], rawDiff: rawMarkers[3], command: rawMarkers[4], provider: rawMarkers[5], browserStorage: rawMarkers[6], privatePath: rawMarkers[7], secret: rawMarkers[8] },
    progress: { runState: { enabled: true, phase: "running_verification", summary: `${rawMarkers[0]} ${rawMarkers[1]}` }, rawPrompt: rawMarkers[1] },
  }),
};

assert.equal(reports.disabled.status, "disabled", "missing input is disabled");
assert.equal(reports.disabled.label, "Controlled local agent MVP metadata is disabled.", "disabled label is deterministic");
assertStep(reports.disabled, "explicit_opt_in", "disabled");
assertStep(reports.disabled, "final_report", "disabled");

assert.equal(reports.blockedNoWorkspace.status, "blocked", "no workspace blocks after opt-in");
assert.ok(reports.blockedNoWorkspace.diagnostics.includes("workspace_not_ready"), "blocked no workspace includes workspace diagnostic");
assertStep(reports.blockedNoWorkspace, "workspace_readiness", "blocked");
assertStep(reports.blockedNoWorkspace, "bounded_read", "pending");

assert.equal(reports.ready.status, "ready_to_preview", "ready metadata stays preview-only");
assert.equal(reports.ready.label, "Ready to preview", "ready label is deterministic");
assertStep(reports.ready, "workspace_readiness", "ready");
assertStep(reports.ready, "final_report", "pending");

assert.equal(reports.running.status, "running_metadata_flow", "running metadata flow is not execution authority");
assert.equal(reports.running.label, "Running metadata flow", "running label is deterministic");
assertStep(reports.running, "bounded_read", "completed");
assertStep(reports.running, "edit_metadata", "ready");
assertStep(reports.running, "verification", "running");
assertStep(reports.running, "repair", "ready");
assertStep(reports.running, "final_report", "running");

assertTerminal(reports.completed, "completed", "Completed");
assertStep(reports.completed, "edit_metadata", "completed");
assertStep(reports.completed, "verification", "completed");
assertStep(reports.completed, "final_report", "completed");

assertTerminal(reports.stopped, "stopped", "Stopped");
assertStep(reports.stopped, "verification", "stopped");
assertStep(reports.stopped, "final_report", "stopped");

assert.equal(reports.repairExhausted.status, "blocked", "repair exhaustion blocks and fails closed");
assertStep(reports.repairExhausted, "repair", "failed");
assertStep(reports.repairExhausted, "final_report", "blocked");
assert.ok(reports.repairExhausted.diagnostics.includes("repair_exhausted"), "repair exhaustion diagnostic is preserved");

assert.equal(reports.unsafe.status, "blocked", "unsafe/raw metadata fails closed");
assertStep(reports.unsafe, "workspace_readiness", "blocked");
assert.ok(reports.unsafe.diagnostics.includes("unsafe_metadata"), "unsafe metadata is diagnosed");
assertNoRawMarkers(reports.unsafe, "unsafe MVP output");

for (const [label, report] of Object.entries(reports)) {
  assertNoAuthority(report, label);
  assertNoRawMarkers(report, `${label} MVP output`);
}

console.log(`${smokeName} passed.`);
console.log("Verified disabled, blocked no-workspace, ready/running metadata flow, completed/stopped final reports, repair exhaustion, and unsafe raw-marker fail-closed behavior with metadata-only authority flags.");

async function importMvpService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledLocalAgentMvp.ts"]);
  try {
    return imports.get("services/controlledLocalAgentMvp.ts");
  } finally {
    await cleanup();
  }
}

function userOptIn() {
  return { origin: "user", confirmedBy: "user", grantsStartAuthority: false };
}

function readiness(overrides = {}) {
  const workspaceMode = overrides.workspaceMode ?? "worktree";
  const ready = workspaceMode !== "none";
  return {
    kind: "controlled_agent_workspace_readiness",
    version: "2026-06-29",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    agentStartAllowed: false,
    workspaceMode,
    host: "vscode",
    optIn: { origin: "user", confirmedBy: "user", confirmedAt: "2026-06-29T00:00:00.000Z", requestIdMintedBy: "gui", grantsStartAuthority: false, label: "User confirmed preview" },
    isolation: { status: overrides.isolationStatus ?? "ready", workspaceMode, hostOwned: ready, workspaceLabel: ready ? "controlled-worktree" : "no-workspace", privatePathExposed: false, readinessId: ready ? "ready-1" : undefined },
    checkpoint: { status: overrides.checkpointStatus ?? "verified", verified: ready, metadataOnly: true, autoCreateAllowed: false, checkpointId: ready ? "checkpoint-1" : undefined, contentHash: ready ? hash : undefined },
    rollback: { status: overrides.rollbackStatus ?? "ready", metadataOnly: true, autoRollbackAllowed: false, requiresUserConfirmation: ready, planId: ready ? "rollback-1" : undefined, planHash: ready ? hash : undefined },
    limits: { maxSteps: 6, maxTouchedFiles: 4, maxPatchBytes: 12000, maxRuntimeSeconds: 600 },
    policyFlags: { fileReadAllowed: false, fileWriteAllowed: false, shellAllowed: false, gitAllowed: false, providerAllowed: false, toolAllowed: false, autoStartAllowed: false, autoApplyAllowed: false, autoRunAllowed: false, autoRollbackAllowed: false },
    summary: overrides.summary ?? "Controlled workspace readiness metadata is ready for future review only.",
  };
}

function fileRead() {
  return {
    kind: "controlled_agent_file_read",
    version: "2026-06-29",
    authority: "bounded_text_file_read",
    cloudRequired: false,
    executionAllowed: false,
    agentStartAllowed: false,
    workspace: { controlledWorkspaceId: "workspace-1", runId: "run-1", workspaceMode: "worktree", host: "vscode", privatePathExposed: false, workspaceLabel: "controlled-worktree" },
    request: { requestId: "read-1", source: "gui", requestIdMintedBy: "gui", assistantMinted: false, workspaceRelativePath: "src/example.ts", textOnly: true, maxBytes: 512, budget: { scope: "single_explicit_file", maxBytes: 512, maxLines: 40, allowBody: true, singleFileOnly: true, recursive: false, globAllowed: false, regexAllowed: false, indexingAllowed: false } },
    policyFlags: { fileReadAllowed: true, fileWriteAllowed: false, shellAllowed: false, gitAllowed: false, providerAllowed: false, toolAllowed: false, hiddenSearchAllowed: false, indexingAllowed: false, binaryReadAllowed: false, symlinkAllowed: false, autoStartAllowed: false, autoApplyAllowed: false, autoRunAllowed: false },
    result: { status: "success", cloudRequired: false, executionAllowed: false, bodyIncluded: false, truncated: false, sanitizedPathLabel: "src/example.ts", byteCount: 120, lineCount: 8, contentHash: hash, message: "Bounded file read metadata completed." },
  };
}

function editMetadata(state) {
  return {
    state,
    summary: `Controlled edit ${state} metadata is visible.`,
    edits: [{ operation: "replace", workspaceRelativePath: "src/example.ts", expectedContentHash: hash, replacementHash: hash, replacementByteCount: 64, range: { start: { line: 1 }, end: { line: 2 } } }],
  };
}

function commandRun(status) {
  return {
    kind: "controlled_agent_command_runner",
    version: "2026-06-29",
    authority: "allowlisted_command_id_metadata",
    cloudRequired: false,
    executionAllowed: false,
    freeformCommandAllowed: false,
    agentStartAllowed: false,
    workspace: { controlledWorkspaceId: "workspace-1", runId: "run-1", workspaceMode: "worktree", host: "vscode", privatePathExposed: false, workspaceLabel: "controlled-worktree" },
    request: { requestId: "verify-1", source: "gui", requestIdMintedBy: "gui", assistantMinted: false, correlation: { origin: "user", confirmedBy: "user", confirmationId: "confirmation-1", hostCorrelationId: "host-1" }, commandId: "repository-check", limits: { timeoutMs: 120000, maxOutputBytes: 4096, maxOutputLines: 120, tailOnly: true, commandStringAllowed: false, argsAllowed: false, cwdAllowed: false, envAllowed: false, shellAllowed: false } },
    policyFlags: { allowlistedCommandIdOnly: true, freeformCommandAllowed: false, argsAllowed: false, cwdAllowed: false, envAllowed: false, shellAllowed: false, gitAllowed: false, networkAllowed: false, providerAllowed: false, toolAllowed: false, packageInstallAllowed: false, fileReadAllowed: false, fileWriteAllowed: false, hiddenSearchAllowed: false, indexingAllowed: false, autoStartAllowed: false, autoApplyAllowed: false, autoRunAllowed: false, autoVerifyAllowed: false, autoFixAllowed: false },
    result: { status, cloudRequired: false, freeformCommandAllowed: false, durationMs: status === "running" ? 1250 : 1750, truncated: false, outputByteCount: 0, outputLineCount: 0, resultHash: hash, message: `Allowlisted verification ${status} metadata is visible.` },
  };
}

function repairMetadata(state, attemptCount, maxAttempts) {
  return { state, attemptCount, maxAttempts, checkpointReady: true, rollbackReady: true, diagnostics: state === "exhausted" ? ["repair_exhausted"] : [] };
}

function assertStep(report, id, state) {
  const found = report.checklist.find((item) => item.id === id);
  assert.ok(found, `${id} step exists`);
  assert.equal(found.state, state, `${id} step state`);
}

function assertTerminal(report, status, label) {
  assert.equal(report.status, status, `${status} status`);
  assert.equal(report.label, label, `${status} label`);
  assert.equal(report.finalReport?.status, status, `${status} final report status`);
  assert.equal(report.finalReport?.label, label, `${status} final report label`);
  assert.equal(typeof report.finalReport?.summary, "string", `${status} final report summary exists`);
}

function assertNoAuthority(report, label) {
  assert.equal(report.safetyFlags.authority, "controlled_local_agent_mvp_metadata_only", `${label} authority is metadata-only`);
  for (const key of ["shell", "git", "providerTool", "hiddenRead", "freeformCommand", "rawPersistence", "cloudRequired", "executionAllowed", "agentStartAllowed", "autoStartAllowed", "canReadFiles", "canWriteFiles", "canRunCommands", "canApplyEdits", "canCallProvider", "canUseTools", "canUseGit"]) {
    assert.equal(report.safetyFlags[key], false, `${label} ${key} must stay false`);
  }
}

function assertNoRawMarkers(value, source) {
  const text = JSON.stringify(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker ${index + 1} leaked through ${source}`);
  }
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-local-agent-mvp-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const sourcePath = queue[index];
    if (seen.has(sourcePath)) {
      continue;
    }
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = join(dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) {
        queue.push(dependency);
      }
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  const imports = new Map();
  for (const entry of entries) {
    imports.set(entry, await import(pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}
