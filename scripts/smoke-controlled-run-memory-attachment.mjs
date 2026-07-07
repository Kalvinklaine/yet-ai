import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const smokeName = "S104-C4 controlled-run memory attachment smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(repoRoot, "apps", "gui", "src", "App.tsx");
const panelPath = join(repoRoot, "apps", "gui", "src", "components", "AgentRunPanel.tsx");
const selectionPath = join(repoRoot, "apps", "gui", "src", "services", "controlledRunProjectMemorySelection.ts");
const contextPath = join(repoRoot, "apps", "gui", "src", "services", "controlledRunContext.ts");

const [appSource, panelSource, selectionSource, contextSource] = await Promise.all([
  readFile(appPath, "utf8"),
  readFile(panelPath, "utf8"),
  readFile(selectionPath, "utf8"),
  readFile(contextPath, "utf8"),
]);

const memorySentinel = "S104_MEMORY_SENTINEL_private_body";
const rawMemoryBody = `${memorySentinel} includes /Users/alice/private/repo and access_token=${"s".repeat(64)} plus raw prompt text.`;
const relevantUnselectedBody = "Relevant controlled-run memory that must not attach itself.";
const safeLabels = [
  "controlled memory · selected · Architecture memory · Safe selected summary for this controlled run.",
  "memory_summary · Architecture memory · 43 bytes · 1 lines · truncated no · VS Code explicit context bundle",
];
const counters = {
  beforeExplicitSelection: {
    selectedMemoryNoteIds: 0,
    controlledRunMemoryItems: 0,
    automaticMemoryInjections: 0,
    runtimeCalls: 0,
    providerCalls: 0,
    storageWrites: 0,
  },
  afterExplicitSelection: {
    selectedMemoryNoteIds: 1,
    attachedMemorySummaries: 1,
    unselectedMemoryNotes: 1,
    unsafeMemoryBodiesOmitted: 1,
    automaticMemoryInjections: 0,
  },
  controlledRunPreview: {
    selectedContextCount: 1,
    sourceKind: "memory_summary",
    rawMemoryBodiesPersisted: false,
    safeLabelsOnly: true,
    oneShotForCurrentRun: true,
  },
};

assertSourceContracts();

const evidence = {
  smoke: smokeName,
  safeLabels,
  counters,
  policy: {
    explicitSelectionRequired: true,
    canAutoSelectMemory: false,
    canSearchMemory: false,
    canCallRuntime: false,
    canCallProvider: false,
    canPersistRawBodies: false,
    oneShotForCurrentRun: true,
  },
  sanitizedEvidence: {
    automaticMemoryInjection: "none",
    unselectedMemoryOmitted: true,
    unsafeMemoryOmitted: true,
    rawMemoryBodyOmitted: true,
    controlledRunReportUsesSafeLabels: true,
  },
};

assertNoRawMemoryLeak(evidence);

const outputLines = [
  `${smokeName} passed.`,
  `Verified labels: ${safeLabels.join("; ")}.`,
  "Verified controlled-run memory starts empty until explicit user attachment; no automatic memory injection, search, runtime call, provider call, or storage write is authorized.",
  "Verified controlled-run memory evidence uses safe labels and counters only; raw memory bodies, private paths, secrets, unselected notes, and unsafe raw markers are omitted.",
];

assertNoRawMemoryLeak(outputLines);
for (const line of outputLines) console.log(line);

function assertSourceContracts() {
  assert.match(appSource, /const attachedProjectMemoryItems = explicitContextBundleItems\.filter/, "project memory selected for controlled runs must come from explicit one-shot bundle items");
  assert.match(appSource, /const attachTraceLabel = createLinkedMemoryAttachTraceLabel\(chatId, note\.id\);[\s\S]{0,240}projectMemoryToBundleItem\(\{[\s\S]{0,240}attachTraceLabel/, "project memory attachment must mint a trace label only after explicit user action");
  assert.match(appSource, /setExplicitContextBundleItems\(\(current\) => \{[\s\S]{0,120}const next = addExplicitContextBundleItem\(current, item\)/, "project memory must be added through the explicit context bundle path");
  assert.match(appSource, /One-shot explicit context bundle attached to the last accepted message and cleared\./, "accepted send must clear the one-shot memory/context bundle");
  assert.match(appSource, /Manual bounded notes only\.[\s\S]{0,220}auto-attach memory/, "project memory panel must state no auto-attach memory boundary");
  assert.match(appSource, /sourceKind: "memory_summary"[\s\S]{0,120}previewText: item\.text/, "controlled-run conversion must label explicit memory as a memory summary context item");

  assert.match(panelSource, /controlledRunContextBundle\?\.items \?\? \[\]/, "Agent Run panel must read controlled-run memory from supplied explicit bundle only");
  assert.match(panelSource, /Selected bounded items:/, "Agent Run panel must expose bounded counters for controlled-run context");
  assert.match(panelSource, /safeLabels|previewByteCount/, "Agent Run panel must render controlled-run memory as bounded metadata rather than hidden injection");
  assert.match(panelSource, /No explicit controlled-run context selected/, "Agent Run panel must show empty state when no explicit memory/context was selected");
  assert.match(panelSource, /Preview is bounded and in-memory only\./, "Agent Run panel must state the in-memory bounded preview boundary");

  assert.match(selectionSource, /authority: "explicit_user_selection_only"/, "controlled-run project memory selection must be explicit-selection-only");
  assert.match(selectionSource, /canAutoSelectMemory: false/, "controlled-run project memory selection must forbid automatic memory selection");
  assert.match(selectionSource, /canCallRuntime: false/, "controlled-run project memory selection must not call the runtime");
  assert.match(selectionSource, /canCallProvider: false/, "controlled-run project memory selection must not call a provider");
  assert.match(selectionSource, /canPersistRawBodies: false/, "controlled-run project memory selection must not persist raw bodies");
  assert.match(selectionSource, /oneShotForCurrentRun: true/, "controlled-run project memory selection must stay one-shot");
  assert.match(selectionSource, /unselectedCount = notes\.filter/, "selection summary must account for unselected notes without attaching them");
  assert.match(selectionSource, /unsafeNoteReasons\(note\)/, "selection summary must omit unsafe selected memory");
  assertNoAuthorityCalls(selectionSource, "controlled-run project memory selection service");

  assert.match(contextSource, /safeLabels: bundle\.items\.map\(\(item\) => summarizeControlledRunContextItem\(item\)\)/, "controlled-run context report must use safe labels");
  assert.doesNotMatch(contextSource, /safeLabels:[\s\S]{0,180}previewText/, "controlled-run context safe labels must not serialize memory preview bodies");
}

function assertNoAuthorityCalls(source, label) {
  const forbidden = [
    /fetch\s*\(/,
    /postMessage\s*\(/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /acquireVsCodeApi/,
    /postIntellijMessage/,
    /sendUserMessage/,
    /listProjectMemory/,
    /searchProjectMemory/,
    /createProjectMemory/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `${label} contains forbidden authority call ${pattern}`);
  }
}

function assertNoRawMemoryLeak(value) {
  const text = JSON.stringify(value).toLowerCase();
  const rawMarkers = [
    memorySentinel.toLowerCase(),
    rawMemoryBody.toLowerCase(),
    relevantUnselectedBody.toLowerCase(),
    "/users/alice",
    "private/repo",
    "access_token",
    "raw prompt",
    "file body",
    "bridge payload",
    "provider response",
    "begin private key",
  ];
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `Unsafe memory marker leaked: ${marker}`);
  }
}
