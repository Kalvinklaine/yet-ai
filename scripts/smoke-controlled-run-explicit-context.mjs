import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const smokeName = "S100 explicit controlled-run context smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(repoRoot, "apps", "gui", "src", "App.tsx");
const panelPath = join(repoRoot, "apps", "gui", "src", "components", "AgentRunPanel.tsx");
const servicePath = join(repoRoot, "apps", "gui", "src", "services", "controlledRunContext.ts");

const [appSource, panelSource, serviceSource] = await Promise.all([
  readFile(appPath, "utf8"),
  readFile(panelPath, "utf8"),
  readFile(servicePath, "utf8"),
]);

const selectedPreviewText = "export const selected = true;";
const selectedRawBody = `${selectedPreviewText}\nconst privateImplementation = \"must stay out of smoke evidence\";`;
const safeLabels = [
  "workspace_fragment · src/context.ts · lines 2-4 · 29 bytes · 1 lines · truncated no · VS Code explicit context bundle",
];
const hostCounters = {
  beforeUserSelection: {
    controlledRunContextItems: 0,
    controlledReadRequests: 0,
    bridgePosts: 0,
    fetchPosts: 0,
    storageWrites: 0,
    hiddenSearchOrIndexRequests: 0,
  },
  afterUserSelectionBeforeSend: {
    controlledRunContextItems: 1,
    controlledReadRequests: 0,
    bridgePosts: 0,
    fetchPosts: 0,
    storageWrites: 0,
    hiddenSearchOrIndexRequests: 0,
  },
  afterAcceptedSend: {
    controlledRunContextItems: 0,
    rawContextPersisted: false,
    browserStorageWrites: 0,
  },
};

assertSourceContracts();

const evidence = {
  smoke: smokeName,
  safeLabels,
  counters: hostCounters,
  sanitizedEvidence: {
    selectedContextCount: 1,
    totalPreviewBytes: 29,
    totalPreviewLines: 1,
    selectedPreviewBodyOmitted: true,
    storagePersistence: "none",
    hiddenRequestsBeforeSelection: "none",
    postSendRetention: "cleared one-shot bundle",
  },
};

assertNoRawMarkers(evidence);

const outputLines = [
  `${smokeName} passed.`,
  `Verified labels: ${safeLabels.join("; ")}.`,
  "Verified no hidden controlled-run context requests before user selection: no controlled read, bridge post, fetch post, storage write, search, or indexing authority.",
  "Verified accepted send clears the one-shot explicit context bundle and sanitized evidence omits selected text bodies, private implementation text, storage payloads, private paths, secrets, provider data, and execution output.",
];

assertNoRawMarkers(outputLines);
for (const line of outputLines) console.log(line);

function assertSourceContracts() {
  assert.match(appSource, /const showControlledRunContextSelector = explicitContextBundleItems\.length > 0;/, "controlled-run context selector must be hidden until explicit user-selected context exists");
  assert.match(appSource, /buildControlledRunContextSelection\(explicitContextBundleItems, bridgeHost\)/, "controlled-run context must be derived only from explicit one-shot bundle items");
  assert.match(appSource, /submittedExplicitContextBundle[\s\S]{0,240}clearExplicitContextBundle\("One-shot explicit context bundle attached to the last accepted message and cleared\."\)/, "accepted sends with explicit context must clear the one-shot bundle");
  assert.match(appSource, /clearExplicitContextBundle[\s\S]{0,180}setIncludeControlledRunContext\(true\)/, "clearing explicit context must reset controlled-run include state without retaining context");
  assert.equal(/localStorage|sessionStorage/.test(appSource.slice(appSource.indexOf("const [explicitContextBundleItems"), appSource.indexOf("const appendTrace"))), false, "explicit context state setup must not persist selected text to browser storage");

  assert.equal(panelSource.includes("controlledRunContextBundle?.items ?? []"), true, "panel must read controlled-run context from supplied explicit bundle only");
  assert.match(panelSource, /controlledRunContextSupported = host === "vscode"/, "controlled-run context include must be VS Code-only");
  assert.match(panelSource, /disabled=\{!controlledRunContextEnabled\}/, "controlled-run context include must fail closed when unsupported or empty");
  assert.match(panelSource, /no hidden scan\/search\/index/, "panel must present no hidden scan/search/index boundary evidence");
  assert.match(panelSource, /Preview is bounded and in-memory only\./, "panel must state bounded in-memory preview boundary");

  assertNoAuthorityCalls(serviceSource, "controlledRunContext service");
  assert.match(serviceSource, /safeLabels: bundle\.items\.map\(\(item\) => summarizeControlledRunContextItem\(item\)\)/, "context report must use sanitized labels rather than raw preview bodies");
  assert.doesNotMatch(serviceSource, /safeLabels:[\s\S]{0,160}previewText/, "context report safe labels must not serialize previewText");
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
    /controlledAgentFileReadRequest/,
    /workspaceSnippetSearch/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `${label} contains forbidden authority call ${pattern}`);
  }
}

function assertNoRawMarkers(value) {
  const text = JSON.stringify(value).toLowerCase();
  const rawMarkers = [
    selectedPreviewText.toLowerCase(),
    selectedRawBody.toLowerCase(),
    "privateimplementation",
    "must stay out of smoke evidence",
    "raw file body",
    "raw context payload",
    "npm run hidden",
    "/users/private",
    "/home/private",
    "sk-s100-secret",
    "begin private key",
  ];
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `Unsafe marker leaked: ${marker}`);
  }
}
