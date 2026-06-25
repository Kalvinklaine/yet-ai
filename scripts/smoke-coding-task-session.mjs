import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "sk-coding-task-session-secret",
  "access_token",
  "Authorization",
  "Bearer",
  "raw prompt",
  "raw diff",
  "raw file body",
  "raw command",
  "npm run check",
  "--watch",
  "PRIVATE_TEMP_PATH",
  "/Users/",
  "C:\\Users\\",
  "function hiddenBody",
  "Long memory body",
  "verification tail with raw command",
  "SECRET_SENTINEL",
];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-coding-task-session-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  try {
    while (queue.length > 0) {
      const sourcePath = queue.shift();
      if (!sourcePath || seen.has(sourcePath)) {
        continue;
      }
      seen.add(sourcePath);
      const source = await readFile(sourcePath, "utf8");
      for (const dependency of localValueDependencies(source, sourcePath)) {
        if (!seen.has(dependency)) {
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
    const imports = Object.fromEntries(await Promise.all(entries.map(async (entry) => {
      const modulePath = join(outRoot, entry).replace(/\.ts$/, ".mjs");
      return [entry, await import(pathToFileURL(modulePath).href)];
    })));
    return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
  } catch (error) {
    await rm(outRoot, { recursive: true, force: true });
    throw error;
  }
}

function localValueDependencies(source, sourcePath) {
  const dependencies = [];
  const importPattern = /(?:import|export)\s+(?!type\b)(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    const candidate = resolve(dirname(sourcePath), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
    if (candidate.startsWith(guiSrcRoot)) {
      dependencies.push(candidate);
    }
  }
  return dependencies;
}

function boundedLoop(status = "ready_for_apply", verificationStatus = "not_requested", result = undefined) {
  const completed = verificationStatus === "succeeded";
  return {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status: completed ? "verified" : status,
    loopId: "loopCodingTaskSessionSmoke",
    sandbox: {
      modeStatus: "checkpoint_ready",
      checkpointId: "checkpointCodingTaskSessionSmoke",
      checkpointVerified: true,
      checkpointHash: `sha256:${"a".repeat(64)}`,
    },
    limits: { maxTouchedFiles: 4, maxPatchBytes: 4096, maxSteps: 4, maxVerificationSeconds: 120 },
    patch: {
      proposalId: "proposalCodingTaskSessionSmoke",
      source: "assistant_proposal",
      touchedFiles: ["apps/gui/src/services/codingTaskSession.ts"],
      editCount: 1,
      patchBytes: 128,
      contentHash: `sha256:${"b".repeat(64)}`,
      summary: "Reviewed coding task session metadata is ready.",
    },
    policy: {
      decision: completed ? "completed" : status === "ready_for_verification" ? "ready_for_user_verification" : "ready_for_user_apply",
      requiresUserConfirmation: true,
      reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", ...(status === "ready_for_verification" || status === "verified" ? ["user_apply_result_recorded"] : []), ...(result ? ["sanitized_result_metadata_only"] : [])],
    },
    verification: { commandId: "repository-check", status: verificationStatus, ...(result ? { result } : {}) },
    summary: completed ? "User-confirmed verification metadata completed." : "Coding task session metadata awaits explicit user action.",
  };
}

function contextItems() {
  return [
    {
      kind: "active_editor",
      source: "vscode",
      file: { displayPath: "/Users/alice/private/repo/src/editor.ts", workspaceRelativePath: "src/editor.ts", languageId: "typescript" },
      selection: { startLine: 2, startCharacter: 1, endLine: 5, endCharacter: 3, text: "function hiddenBody() { return true; }" },
      key: "active-editor-1",
    },
    {
      kind: "workspace_snippet",
      workspaceRelativePath: "apps/gui/src/App.tsx",
      languageId: "tsx",
      range: { start: { line: 10, character: 0 }, end: { line: 20, character: 2 } },
      text: "raw file body SECRET_SENTINEL",
      key: "snippet-1",
    },
    {
      kind: "project_memory",
      noteId: "mem-1",
      title: "Architecture note",
      text: "Long memory body that should never appear in snapshot metadata.",
      tags: ["architecture", "local-first"],
      taskLabel: "S65",
      sessionLabel: "manual-session",
      attachTraceLabel: "trace-memory",
      key: "memory-1",
    },
    {
      kind: "verification_output",
      commandId: "repository-check",
      status: "failed",
      exitCode: 1,
      outputTail: "verification tail with raw command npm run check",
      truncated: true,
      key: "verification-1",
    },
  ];
}

function traceEntries() {
  return [
    { id: "trace-1", timestamp: "2026-06-25T18:00:00.000Z", family: "agentRun.goalReady", title: "Goal ready", status: "succeeded", summary: "Goal metadata was recorded" },
    { id: "trace-2", timestamp: "2026-06-25T18:01:00.000Z", family: "agentRun.applyResult", title: "Apply result metadata", status: "failed" },
    { id: "trace-3", timestamp: "2026-06-25T18:02:00.000Z", family: "agentRun.applyResult", title: "Apply result reviewed", status: "succeeded" },
  ];
}

function baseRun() {
  return {
    goal: { id: "goalCodingTaskSessionSmoke", title: "Add a coding task session backbone smoke" },
    proposal: { id: "proposalCodingTaskSessionSmoke", summary: "Patch metadata detected", touchedFiles: ["apps/gui/src/services/codingTaskSession.ts"] },
    boundedLoop: boundedLoop(),
  };
}

function assertMetadataOnly(snapshot, label) {
  assert.equal(snapshot.kind, "coding_task_session", `${label} kind`);
  assert.equal(snapshot.authority, "metadata_only", `${label} authority`);
  assert.equal(snapshot.cloudRequired, false, `${label} cloud`);
  assert.equal(snapshot.executionAllowed, false, `${label} execution`);
  assert.deepEqual(snapshot.policy, {
    canAutoSend: false,
    canAutoAttachContext: false,
    canAutoApply: false,
    canAutoRunVerification: false,
    canAutoRepair: false,
    canAutoRetry: false,
    canAutoRollback: false,
    canReadHiddenFiles: false,
    canRunHiddenTools: false,
  }, `${label} policy`);
}

function assertSanitized(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 10000, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function assertSnapshotBasics(snapshot, label) {
  assertMetadataOnly(snapshot, label);
  assertSanitized(snapshot, label);
  assert.equal(snapshot.context.labels.length <= 12, true, `${label} context labels bounded`);
  assert.equal(snapshot.memory.labels.length <= 12, true, `${label} memory labels bounded`);
  assert.equal(snapshot.trace.labels.length <= 12, true, `${label} trace labels bounded`);
  assert.equal(snapshot.diagnostics.length <= 24, true, `${label} diagnostics bounded`);
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices(["services/codingTaskSession.ts"]);
  try {
    const {
      createCodingTaskSessionSnapshot,
      createLinkedMemoryAttachTraceLabel,
      createTaskMemoryLabel,
      createSessionMemoryLabel,
    } = imports["services/codingTaskSession.ts"];

    const empty = createCodingTaskSessionSnapshot();
    assertSnapshotBasics(empty, "empty snapshot");
    assert.equal(empty.goal.present, false);
    assert.equal(empty.statuses.agentRunState, "idle");
    assert.equal(empty.context.totalCount, 0);

    const goalContext = createCodingTaskSessionSnapshot({ goal: { title: "Review explicit local context" }, contextItems: contextItems() });
    assertSnapshotBasics(goalContext, "goal context snapshot");
    assert.equal(goalContext.goal.present, true);
    assert.equal(goalContext.context.totalCount, 4);
    assert.equal(goalContext.context.activeEditorCount, 1);
    assert.equal(goalContext.context.snippetCount, 1);
    assert.equal(goalContext.context.verificationAttachmentCount, 1);
    assert.equal(goalContext.memory.count, 1);
    assert.deepEqual(goalContext.memory.labels, ["Architecture note"]);

    const proposal = createCodingTaskSessionSnapshot({ agentRun: baseRun(), contextItems: contextItems(), traceEntries: traceEntries() });
    assertSnapshotBasics(proposal, "proposal snapshot");
    assert.equal(proposal.statuses.agentRunState, "ready_for_apply");
    assert.equal(proposal.statuses.proposal, "proposalCodingTaskSessionSmoke");
    assert.equal(proposal.statuses.apply, "not_requested");
    assert.equal(proposal.trace.totalCount, 3);
    assert.equal(proposal.trace.families.find((entry) => entry.family === "agentRun.applyResult")?.count, 2);

    const appliedRun = baseRun();
    Object.assign(appliedRun, {
      applyRequest: { requested: true, source: "user", requestId: "applyCodingTaskSessionSmoke" },
      applyResult: { status: "applied", appliedFileCount: 1, summary: "User-confirmed apply completed." },
    });
    appliedRun.boundedLoop = boundedLoop("ready_for_verification", "ready");
    const apply = createCodingTaskSessionSnapshot({ agentRun: appliedRun });
    assertSnapshotBasics(apply, "apply snapshot");
    assert.equal(apply.statuses.agentRunState, "ready_for_verification");
    assert.equal(apply.statuses.apply, "applied");
    assert.equal(apply.statuses.verification, "not_requested");

    const verifiedRun = baseRun();
    Object.assign(verifiedRun, {
      applyRequest: { requested: true, source: "user", requestId: "applyCodingTaskSessionSmoke" },
      applyResult: { status: "applied", appliedFileCount: 1, summary: "User-confirmed apply completed." },
      verificationRequest: { requested: true, source: "user", requestId: "verifyCodingTaskSessionSmoke" },
      verificationResult: { status: "succeeded", exitCode: 0, durationMs: 42, outputTail: "allowlisted check passed" },
    });
    verifiedRun.boundedLoop = boundedLoop("verified", "succeeded", { exitCode: 0, durationMs: 42, outputTail: "allowlisted check passed", truncated: false, resultHash: `sha256:${"c".repeat(64)}` });
    const verification = createCodingTaskSessionSnapshot({ agentRun: verifiedRun });
    assertSnapshotBasics(verification, "verification snapshot");
    assert.equal(verification.statuses.agentRunState, "verified");
    assert.equal(verification.statuses.verification, "succeeded");
    assert.equal(verification.nextSafeManualStep.includes("Stop and review"), true);

    const secret = `access_token=${"x".repeat(64)}`;
    const unsafe = createCodingTaskSessionSnapshot({
      goal: `Fix /Users/alice/private/repo with ${secret}`,
      agentRun: { goal: { title: "Safe goal" }, command: "npm run check", rawDiff: "SECRET_SENTINEL", cwd: "PRIVATE_TEMP_PATH" },
      diagnostics: [`private path /Users/alice/project omitted ${secret}`],
    });
    assertSnapshotBasics(unsafe, "unsafe snapshot");
    assert.equal(unsafe.diagnostics.length > 0, true);
    assert.equal(JSON.stringify(unsafe).includes("[redacted]"), true);

    assert.equal(createTaskMemoryLabel("Existing task", "Fallback goal"), "Existing task");
    assert.equal(createTaskMemoryLabel(`raw prompt ${secret}`, `/Users/alice/task ${secret}`), "Task-linked memory attach");
    assert.equal(createSessionMemoryLabel(undefined, "chat-001"), "Chat chat-001");
    assert.equal(createSessionMemoryLabel(undefined, `chat/../../secret-${secret}`), "Chat current");
    assert.equal(createLinkedMemoryAttachTraceLabel("chat-001", "mem-001"), "memory-attach-chat-001-mem-001");
    assert.equal(createLinkedMemoryAttachTraceLabel(`chat-${secret}`, "/Users/alice/mem-001"), "memory-attach-chat-memory");
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Coding task session smoke passed.");
}

export { runSmoke };
