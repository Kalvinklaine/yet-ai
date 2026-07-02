import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled agent runtime session smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "runtime-session-secret-should-not-leak",
  "raw prompt from runtime session smoke",
  "raw file from runtime session smoke",
  "raw diff from runtime session smoke",
  "npm run runtime-session-hidden",
  "/Users/private/runtime-session-smoke",
  "sk-runtime-session-secret",
];

const { evaluateControlledAgentRuntimeSession } = await importRuntimeSessionService();
const report = { statuses: [], blocked: [] };

const disabled = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  workspace: { workspaceMode: "none", workspaceReady: false, hostOwned: false },
  preconditions: {
    optIn: { status: "not_required", origin: "none", confirmedBy: "none", requestIdMintedBy: "none" },
    workspaceReadiness: { status: "not_applicable" },
    checkpoint: { status: "not_applicable", verified: false },
    rollback: { status: "not_applicable" },
  },
  session: { state: "disabled", sessionId: "session-disabled" },
  details: { summary: "Runtime session view is disabled." },
}));
assert.equal(disabled.status, "disabled", "disabled metadata stays disabled");
assert.equal(disabled.nextUserAction, "none", "disabled metadata needs no user action");
assertNoAuthority(disabled, "disabled");
report.statuses.push({ label: "disabled", status: disabled.status });

const browserUnsupported = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  host: { kind: "browser", supported: false, surface: "browser_preview", label: "Browser preview" },
  details: { summary: "Runtime session view is unavailable in browser preview." },
}));
assert.equal(browserUnsupported.status, "unsupported_host", "browser host is unsupported");
assert.ok(hasDiagnostic(browserUnsupported, "unsupported_host"), "browser unsupported diagnostic is surfaced");
assertNoAuthority(browserUnsupported, "browser unsupported");
report.statuses.push({ label: "browser", status: browserUnsupported.status });

const missingOptIn = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  preconditions: {
    optIn: { status: "missing", origin: "none", confirmedBy: "none", requestIdMintedBy: "none" },
  },
  details: { summary: "Runtime session view needs user consent." },
}));
assert.ok(["opt_in_required", "blocked"].includes(missingOptIn.status), "missing opt-in requires review or blocks");
assert.ok(hasDiagnostic(missingOptIn, "missing_user_opt_in") || hasDiagnostic(missingOptIn, "invalid_authority"), "missing opt-in diagnostic is surfaced");
assertNoAuthority(missingOptIn, "missing opt-in");
report.statuses.push({ label: "missing opt-in", status: missingOptIn.status });

const preconditionsBlocked = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  preconditions: {
    checkpoint: { status: "pending", verified: false },
  },
  details: { summary: "Runtime session view waits for checkpoint proof." },
}));
assert.equal(preconditionsBlocked.status, "preconditions_blocked", "pending checkpoint blocks readiness");
assert.ok(hasDiagnostic(preconditionsBlocked, "preconditions_blocked"), "precondition diagnostic is surfaced");
assertNoAuthority(preconditionsBlocked, "preconditions blocked");
report.statuses.push({ label: "preconditions", status: preconditionsBlocked.status });

const ready = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata());
assert.equal(ready.status, "ready_to_start", "ready workspace, checkpoint, and rollback metadata is ready");
assert.equal(ready.preconditions.workspaceReady, true, "ready metadata reports workspace readiness");
assert.equal(ready.preconditions.checkpoint, "verified", "ready metadata reports checkpoint proof");
assert.equal(ready.preconditions.rollback, "planned", "ready metadata reports rollback plan");
assert.equal(ready.nextUserAction, "request_start", "ready metadata asks user to request start");
assertNoAuthority(ready, "ready");
report.statuses.push({ label: "ready", status: ready.status });

const startRequested = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  session: {
    state: "start_requested_metadata",
    sequence: 1,
    startRequest: sessionRequest({ requestId: "start-request-1" }),
  },
  details: { summary: "Runtime session start request is visible.", nextUserAction: "review_session" },
}));
assert.equal(startRequested.status, "start_requested_metadata", "start-requested metadata is visible");
assert.equal(startRequested.session.startRequested, true, "start request flag is visible");
assertNoAuthority(startRequested, "start requested");
report.statuses.push({ label: "start requested", status: startRequested.status });

const sessionOpen = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  session: { state: "session_open_metadata", sequence: 2, startRequest: sessionRequest({ requestId: "start-request-2" }) },
  details: { summary: "Runtime session open state is visible." },
}));
assert.equal(sessionOpen.status, "session_open_metadata", "session-open metadata is visible");
assert.equal(sessionOpen.session.terminal, false, "open metadata is non-terminal");
assertNoAuthority(sessionOpen, "session open");
report.statuses.push({ label: "open", status: sessionOpen.status });

const stopRequested = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  session: {
    state: "stop_requested_metadata",
    sequence: 3,
    startRequest: sessionRequest({ requestId: "start-request-3" }),
    stopRequest: sessionRequest({ requestId: "stop-request-1" }),
  },
  details: { summary: "Runtime session stop request is visible." },
}));
assert.equal(stopRequested.status, "stop_requested_metadata", "stop-requested metadata is visible");
assert.equal(stopRequested.session.stopRequested, true, "stop request flag is visible");
assert.equal(stopRequested.nextUserAction, "review_stop", "stop request asks for stop review");
assertNoAuthority(stopRequested, "stop requested");
report.statuses.push({ label: "stop requested", status: stopRequested.status });

const stopped = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  session: {
    state: "stopped",
    sequence: 4,
    startRequest: sessionRequest({ requestId: "start-request-4" }),
    stopRequest: sessionRequest({ requestId: "stop-request-2" }),
  },
  details: { summary: "Runtime session stopped state is visible." },
}));
assert.equal(stopped.status, "stopped", "stopped metadata is visible");
assert.equal(stopped.session.terminal, true, "stopped metadata is terminal");
assertNoAuthority(stopped, "stopped");
report.statuses.push({ label: "stopped", status: stopped.status });

const assistantStart = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  session: { state: "start_requested_metadata", sequence: 5, startRequest: sessionRequest({ requestId: "start-request-assistant", assistantMinted: true }) },
  details: { summary: "Runtime session start request is visible." },
}));
assert.equal(assistantStart.status, "blocked", "assistant-minted start request blocks");
assert.ok(hasDiagnostic(assistantStart, "assistant_minted_request"), "assistant start block is diagnosed");
assertNoAuthority(assistantStart, "assistant start");
report.blocked.push({ label: "assistant start", status: assistantStart.status });

const assistantStop = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata({
  session: {
    state: "stop_requested_metadata",
    sequence: 6,
    startRequest: sessionRequest({ requestId: "start-request-6" }),
    stopRequest: sessionRequest({ requestId: "stop-request-assistant", assistantMinted: true }),
  },
  details: { summary: "Runtime session stop request is visible." },
}));
assert.equal(assistantStop.status, "blocked", "assistant-minted stop request blocks");
assert.ok(hasDiagnostic(assistantStop, "assistant_minted_request"), "assistant stop block is diagnosed");
assertNoAuthority(assistantStop, "assistant stop");
report.blocked.push({ label: "assistant stop", status: assistantStop.status });

const unsafeCases = [
  { label: "raw prompt", value: { rawPrompt: rawMarkers[1] } },
  { label: "raw file", value: { rawFile: rawMarkers[2] } },
  { label: "raw diff", value: { rawDiff: rawMarkers[3] } },
  { label: "raw command", value: { rawCommand: rawMarkers[4] } },
  { label: "private path", value: { privatePath: rawMarkers[5] } },
];
for (const item of unsafeCases) {
  const evaluated = evaluateControlledAgentRuntimeSession(runtimeSessionMetadata(item.value));
  assert.equal(evaluated.status, "blocked", `${item.label} blocks metadata`);
  assert.ok(hasDiagnostic(evaluated, "unsafe_metadata") || hasDiagnostic(evaluated, "unknown_or_invalid_field"), `${item.label} block is diagnosed`);
  assertNoAuthority(evaluated, item.label);
  assertNoRawMarkers(evaluated, `${item.label} evaluation`);
  report.blocked.push({ label: item.label, status: evaluated.status });
}

assert.equal(report.statuses.length, 9, "all expected non-unsafe status cases ran");
assert.equal(report.blocked.length, 7, "all expected blocked cases ran");
assertNoRawMarkers({ report, disabled, browserUnsupported, missingOptIn, preconditionsBlocked, ready, startRequested, sessionOpen, stopRequested, stopped, assistantStart, assistantStop }, "runtime session smoke result");
console.log(`${smokeName} passed.`);
console.log(`Verified ${report.statuses.length} lifecycle/status cases and ${report.blocked.length} blocked unsafe or assistant-minted cases with sanitized metadata only.`);

function runtimeSessionMetadata(overrides = {}) {
  const metadata = {
    kind: "controlled_agent_runtime_session",
    version: "2026-07-02",
    authority: "runtime_session_metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    agentStartAllowed: false,
    autoStartAllowed: false,
    host: { kind: "vscode", supported: true, surface: "ide_extension", label: "VS Code extension" },
    workspace: {
      workspaceMode: "worktree",
      workspaceReady: true,
      privatePathExposed: false,
      hostOwned: true,
      controlledWorkspaceId: "workspace-s82-c4",
      readinessId: "ready-s82-c4",
      label: "Controlled worktree",
    },
    preconditions: {
      optIn: {
        status: "confirmed",
        origin: "user",
        confirmedBy: "user",
        requestIdMintedBy: "gui",
        assistantMinted: false,
        grantsStartAuthority: false,
        confirmedAt: "2026-07-02T00:00:00.000Z",
        label: "User consent visible",
      },
      workspaceReadiness: { status: "ready", readinessId: "ready-s82-c4", metadataOnly: true, label: "Workspace ready" },
      checkpoint: { status: "verified", verified: true, metadataOnly: true, autoCreateAllowed: false, checkpointId: "checkpoint-s82-c4", checkedAt: "2026-07-02T00:01:00.000Z", label: "Checkpoint verified" },
      rollback: { status: "planned", metadataOnly: true, autoRollbackAllowed: false, requiresUserConfirmation: true, planId: "rollback-s82-c4", label: "Rollback plan ready" },
      correlation: { correlationId: "correlation-s82-c4", readinessId: "ready-s82-c4", checkpointId: "checkpoint-s82-c4", rollbackPlanId: "rollback-s82-c4", label: "Correlation ready" },
    },
    session: { state: "ready_to_start", sessionId: "session-s82-c4", metadataOnly: true, sequence: 0, enteredAt: "2026-07-02T00:02:00.000Z", label: "Session review" },
    limits: { maxSteps: 6, maxFileReads: 4, maxTouchedFiles: 2, maxPatchBytes: 4096, maxVerificationRuns: 1, maxRuntimeSeconds: 300, limitLabel: "Bounded review" },
    policyFlags: falsePolicyFlags(),
    details: { summary: "Runtime session metadata is ready for user review.", sanitized: true, nextUserAction: "request_start", evidenceLabel: "Safe lifecycle evidence" },
  };
  return deepMerge(metadata, overrides);
}

function sessionRequest(overrides = {}) {
  return {
    requestId: "request-s82-c4",
    requestedBy: "user",
    requestIdMintedBy: "gui",
    assistantMinted: false,
    correlationId: "correlation-s82-c4",
    requestedAt: "2026-07-02T00:03:00.000Z",
    reason: "User reviewed session metadata.",
    ...overrides,
  };
}

function falsePolicyFlags() {
  return {
    runtimeSessionMetadataOnly: true,
    autoStartAllowed: false,
    autoApplyAllowed: false,
    autoRunAllowed: false,
    autoVerifyAllowed: false,
    autoFixAllowed: false,
    autoRollbackAllowed: false,
    fileReadAllowed: false,
    fileWriteAllowed: false,
    shellAllowed: false,
    gitAllowed: false,
    networkAllowed: false,
    providerAllowed: false,
    toolAllowed: false,
    rawPromptAllowed: false,
    rawFileAllowed: false,
    rawDiffAllowed: false,
    rawCommandAllowed: false,
    rawLogAllowed: false,
  };
}

function deepMerge(base, overrides) {
  const result = structuredClone(base);
  mergeInto(result, overrides);
  return result;
}

function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

function hasDiagnostic(evaluation, code) {
  return evaluation.diagnostics.some((item) => item.code === code);
}

function assertNoAuthority(evaluation, label) {
  const flags = evaluation.safetyFlags;
  for (const key of ["cloudRequired", "executionAllowed", "agentStartAllowed", "autoStartAllowed", "canReadFiles", "canWriteFiles", "canRunCommands", "canApplyEdits", "canCallProvider", "canUseTools", "canUseGit", "canUseNetwork", "canAutoRollback", "canStartAutonomousLoop"]) {
    assert.equal(flags[key], false, `${label} ${key} must stay false`);
  }
}

function assertNoRawMarkers(value, source) {
  const text = JSON.stringify(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker ${index + 1} leaked through ${source}`);
  }
  for (const marker of [tmpdir(), homedir()]) {
    assert.equal(text.includes(marker.toLowerCase()), false, `${source} leaked local path marker`);
  }
  assert.equal(/\/(?:Users|home|tmp|private)\//i.test(text), false, `${source} leaked a private path`);
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(text), false, `${source} leaked a provider-style secret`);
}

async function importRuntimeSessionService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentRuntimeSession.ts"]);
  try {
    return imports.get("services/controlledAgentRuntimeSession.ts");
  } finally {
    await cleanup();
  }
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-runtime-session-smoke-ts-"));
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

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
