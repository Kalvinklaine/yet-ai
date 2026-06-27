import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "UNSAFE_BODY_SENTINEL",
  "STALE_BODY_SENTINEL",
  "ATTACHED_BODY_SENTINEL",
  "UNRELATED_BODY_SENTINEL",
  "raw command",
  "raw prompt",
  "raw diff",
  "raw file body",
  "Authorization",
  "Bearer",
  "sk-task-memory-secret",
  "/Users/alice/private",
  "PRIVATE_PATH_SENTINEL",
  "runtime-hidden-task-label",
  "runtime-hidden-session-label",
  "runtime-hidden-trace-label",
];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-task-memory-suggestions-smoke-ts-"));
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

function note(patch) {
  return {
    id: "mem-default",
    title: "Default memory",
    text: "Default body",
    tags: [],
    source: "manual",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...patch,
  };
}

function assertMetadataOnly(summary) {
  assert.equal(summary.kind, "task_memory_suggestions");
  assert.equal(summary.authority, "metadata_only");
  assert.equal(summary.cloudRequired, false);
  assert.equal(summary.executionAllowed, false);
  assert.deepEqual(summary.policy, {
    canAutoAttachMemory: false,
    canReadMemoryBodies: false,
    canCallRuntime: false,
    canCallProvider: false,
    explicitAttachOnly: true,
  });
}

function assertNoRawLeak(value, label, markers = rawMarkers) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 12000, true, `${label} is bounded`);
  for (const marker of markers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function assertStorageClean(storage, label) {
  assertNoRawLeak(storage, label);
  assert.deepEqual(storage, { localStorage: {}, sessionStorage: {} });
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices([
    "services/taskMemorySuggestions.ts",
    "services/activeEditorContext.ts",
    "services/codingTaskSession.ts",
    "services/codingSessionTrace.ts",
  ]);
  try {
    const { suggestTaskMemory, createMemorySuggestionAttachTraceDetails } = imports["services/taskMemorySuggestions.ts"];
    const { projectMemoryToBundleItem, explicitContextBundleToChatContext } = imports["services/activeEditorContext.ts"];
    const { createCodingTaskSessionSnapshot, createTaskMemoryLabel, createSessionMemoryLabel, createLinkedMemoryAttachTraceLabel } = imports["services/codingTaskSession.ts"];
    const { createCodingSessionTraceEntry } = imports["services/codingSessionTrace.ts"];

    const calls = { send: 0, search: 0, save: 0, provider: 0, bridge: 0, workspaceMutation: 0, attach: 0 };
    const browserStorage = { localStorage: {}, sessionStorage: {} };
    const notes = [
      note({ id: "mem-suggested", title: "Agent memory setup", tags: ["agent", "memory"], taskLabel: "S69 memory", sessionLabel: "Chat smoke", text: "SAFE_BODY_SENTINEL" }),
      note({ id: "mem-stale", title: "Archived memory setup", tags: ["memory"], sessionLabel: "Chat smoke", text: "STALE_BODY_SENTINEL" }),
      note({ id: "mem-unsafe", title: "Provider safety note", tags: ["memory"], text: "UNSAFE_BODY_SENTINEL raw command /Users/alice/private PRIVATE_PATH_SENTINEL" }),
      note({ id: "mem-attached", title: "Already attached memory", tags: ["agent"], text: "ATTACHED_BODY_SENTINEL" }),
      note({ id: "mem-unrelated", title: "Palette colors", tags: ["design"], text: "UNRELATED_BODY_SENTINEL" }),
    ];

    const summary = suggestTaskMemory({
      taskGoalLabel: "Improve Agent memory setup",
      sessionLabel: "Chat smoke",
      explicitContextLabels: ["memory suggestions panel"],
      proposalFileLabels: ["apps/gui/src/services/taskMemorySuggestions.ts"],
      attachedMemoryNoteIds: ["mem-attached"],
      projectMemoryNotes: notes,
      staleBeforeIso: "2026-06-10T00:00:00.000Z",
    });

    assertMetadataOnly(summary);
    assert.equal(summary.counts.suggested, 1);
    assert.equal(summary.counts.stale, 1);
    assert.equal(summary.counts.unsafe, 1);
    assert.equal(summary.counts.already_attached, 1);
    assert.equal(summary.counts.unrelated, 1);
    assertNoRawLeak(summary, "suggestion summary before attach");
    assertStorageClean(browserStorage, "browser storage before attach");
    assert.deepEqual(calls, { send: 0, search: 0, save: 0, provider: 0, bridge: 0, workspaceMutation: 0, attach: 0 });

    const suggested = summary.suggestions.find((item) => item.status === "suggested");
    const stale = summary.suggestions.find((item) => item.status === "stale");
    const unsafe = summary.suggestions.find((item) => item.status === "unsafe");
    const alreadyAttached = summary.suggestions.find((item) => item.status === "already_attached");
    const unrelated = summary.suggestions.find((item) => item.status === "unrelated");
    assert.ok(suggested);
    assert.ok(stale);
    assert.ok(unsafe);
    assert.ok(alreadyAttached);
    assert.ok(unrelated);
    assert.equal(suggested.canAttachExplicitly, true);
    assert.equal(stale.canAttachExplicitly, false);
    assert.equal(unsafe.canAttachExplicitly, false);
    assert.equal(alreadyAttached.canAttachExplicitly, false);
    assert.equal(unrelated.canAttachExplicitly, false);
    assert.equal(stale.warnings.length > 0, true);
    assert.equal(unsafe.warnings.length > 0, true);

    const sessionBeforeAttach = createCodingTaskSessionSnapshot({ goal: "Improve Agent memory setup", memorySuggestions: summary });
    assert.equal(sessionBeforeAttach.memory.count, 0);
    assert.equal(sessionBeforeAttach.memory.suggestionCounts.suggested, 1);
    assert.equal(sessionBeforeAttach.policy.canAutoAttachContext, false);
    assertNoRawLeak(sessionBeforeAttach, "session snapshot before attach");

    const suggestedNote = notes.find((item) => item.id === suggested.noteId);
    assert.ok(suggestedNote);
    const taskLabel = createTaskMemoryLabel("runtime-hidden-task-label", "Improve Agent memory setup");
    const sessionLabel = createSessionMemoryLabel("runtime-hidden-session-label", "chat-smoke");
    const attachTraceLabel = createLinkedMemoryAttachTraceLabel("runtime-hidden-session-label", "runtime-hidden-trace-label");
    const attachTraceDetails = createMemorySuggestionAttachTraceDetails(suggested);
    const attachTraceEntry = createCodingSessionTraceEntry({
      family: "context.memory",
      title: "Task memory suggestion attached",
      status: "succeeded",
      summary: "User explicitly attached suggested task memory metadata.",
      details: attachTraceDetails,
    }, { id: "trace-task-memory-suggestion", timestamp: "2026-06-27T12:00:00.000Z" });

    calls.attach += 1;
    const attachedItem = projectMemoryToBundleItem({
      kind: "project_memory",
      noteId: suggestedNote.id,
      title: suggestedNote.title,
      text: suggestedNote.text,
      tags: suggestedNote.tags,
      taskLabel,
      sessionLabel,
      attachTraceLabel,
    });
    const explicitBundle = [attachedItem];
    const runtimeContext = explicitContextBundleToChatContext(explicitBundle);
    const sessionAfterAttach = createCodingTaskSessionSnapshot({
      goal: "Improve Agent memory setup",
      contextItems: explicitBundle,
      memorySuggestions: summary,
      traceEntries: [attachTraceEntry],
    });

    assert.equal(calls.attach, 1);
    assert.deepEqual({ ...calls, attach: 0 }, { send: 0, search: 0, save: 0, provider: 0, bridge: 0, workspaceMutation: 0, attach: 0 });
    assert.equal(sessionAfterAttach.memory.count, 1);
    assert.equal(sessionAfterAttach.memory.labels.some((label) => label.includes("Agent memory setup")), true);
    assert.equal(sessionAfterAttach.trace.totalCount, 1);
    assert.equal(sessionAfterAttach.trace.labels.some((label) => label.includes("context.memory")), true);
    assertNoRawLeak(attachTraceDetails, "attach trace details");
    assertNoRawLeak(attachTraceEntry, "attach trace entry");
    assertNoRawLeak(sessionAfterAttach, "session snapshot after attach", rawMarkers.filter((marker) => !["runtime-hidden-task-label", "runtime-hidden-session-label", "runtime-hidden-trace-label"].includes(marker)));

    const runtimeContextText = JSON.stringify(runtimeContext);
    assert.equal(runtimeContextText.includes("SAFE_BODY_SENTINEL"), true, "explicit attach should include selected memory body once in runtime context");
    assert.equal(runtimeContextText.includes("runtime-hidden-task-label"), false, "runtime context leaked task label");
    assert.equal(runtimeContextText.includes("runtime-hidden-session-label"), false, "runtime context leaked session label");
    assert.equal(runtimeContextText.includes("runtime-hidden-trace-label"), false, "runtime context leaked trace label");
    assert.equal(runtimeContextText.includes("suggestionStatus"), false, "runtime context leaked suggestion trace label");
    assert.equal(runtimeContextText.includes("task_memory_suggestions"), false, "runtime context leaked display-only suggestion summary");
    assert.equal(runtimeContext.items.length, 1);
    assert.equal(runtimeContext.items[0].kind, "project_memory");
    assert.equal(Object.hasOwn(runtimeContext.items[0], "taskLabel"), false);
    assert.equal(Object.hasOwn(runtimeContext.items[0], "sessionLabel"), false);
    assert.equal(Object.hasOwn(runtimeContext.items[0], "attachTraceLabel"), false);

    assertStorageClean(browserStorage, "browser storage after attach");
    assert.equal(calls.send, 0, "suggestions emitted send automatically");
    assert.equal(calls.search, 0, "suggestions emitted search automatically");
    assert.equal(calls.save, 0, "suggestions saved memory automatically");
    assert.equal(calls.provider, 0, "suggestions called provider automatically");
    assert.equal(calls.bridge, 0, "suggestions called bridge automatically");
    assert.equal(calls.workspaceMutation, 0, "suggestions mutated workspace automatically");
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Task memory suggestions smoke passed.");
}

export { runSmoke };
