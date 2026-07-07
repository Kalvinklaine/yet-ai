import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "S102 controlled patch plan preview smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const appPath = join(guiSrcRoot, "App.tsx");
const panelPath = join(guiSrcRoot, "components", "ControlledAgentEditPanel.tsx");
const validFixturePath = join(repoRoot, "packages", "contracts", "examples", "engine", "controlled-agent-patch-plan.json");
const rawDiffFixturePath = join(repoRoot, "packages", "contracts", "examples-invalid", "engine", "controlled-agent-patch-plan-raw-diff.json");
const createOperationFixturePath = join(repoRoot, "packages", "contracts", "examples-invalid", "engine", "controlled-agent-patch-plan-create-operation.json");
const rawMarkers = [
  "diff body",
  "const privatePatchBody = true;",
  "raw replacement from S102 smoke",
  "/Users/private/s102-patch-plan",
  "sk-s102-patch-plan-secret",
  "Authorization: Bearer s102-patch-plan-token",
  "provider payload from S102 patch plan smoke",
  "docs/new-copy.md",
];

const [appSource, panelSource, validFixture, rawDiffFixture, createOperationFixture] = await Promise.all([
  readFile(appPath, "utf8"),
  readFile(panelPath, "utf8"),
  readJson(validFixturePath),
  readJson(rawDiffFixturePath),
  readJson(createOperationFixturePath),
]);

const { evaluateControlledAgentPatchPlanPreview } = await importPatchPlanPreviewService();

assertSourceContracts();
assertPreviewEvaluation();
assertConfirmationGateAudit();

console.log(`${smokeName} passed.`);
console.log("Verified controlled_agent_patch_plan preview remains review-only dry-run metadata, blocks raw diff/body and unsafe operations, and leaves edit requests locked until explicit preview confirmation.");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertSourceContracts() {
  assert.match(appSource, /controlledAgentPatchPlanMetadata === undefined \? undefined : evaluateControlledAgentPatchPlanPreview\(controlledAgentPatchPlanMetadata\)/, "App must evaluate patch-plan metadata through the dedicated preview service");
  assert.match(appSource, /controlledAgentPatchPlanPreview && \(controlledAgentPatchPlanPreview\.state !== "ready" \|\| !controlledPatchPlanConfirmed\)/, "App must block controlled edit request until the preview is ready and confirmed");
  assert.match(appSource, /setControlledEditNote\(controlledAgentPatchPlanPreview\.state === "ready" \? "Confirm the dry-run patch plan preview before requesting the controlled edit\." : "Controlled edit request blocked because dry-run patch plan preview is non-actionable\."\)/, "App must explain unconfirmed or non-actionable preview blocking");
  assert.match(appSource, /onConfirmPatchPlan=\{\(\) => setControlledPatchPlanConfirmed\(true\)\}/, "App must require an explicit confirmation action to unlock the request path");
  assert.doesNotMatch(appSource, /localStorage\.setItem\([^\n]*(controlledAgentPatchPlan|patchPlanPreview|rawDiff|rawReplacement|fileBody)/, "App must not persist patch-plan preview or raw bodies to localStorage");
  assert.doesNotMatch(appSource, /sessionStorage\.setItem\([^\n]*(controlledAgentPatchPlan|patchPlanPreview|rawDiff|rawReplacement|fileBody)/, "App must not persist patch-plan preview or raw bodies to sessionStorage");

  assert.match(panelSource, /const previewAllowsRequest = !previewRequired \|\| \(previewReady && patchPlanConfirmed\);/, "Panel must derive request availability from explicit preview confirmation");
  assert.match(panelSource, /const canConfirmPatchPlan = previewReady && !patchPlanConfirmed && !pendingRequestId && onConfirmPatchPlan;/, "Panel must render confirmation only for ready previews without pending edits");
  assert.match(panelSource, /\{canConfirmPatchPlan && <button type="button" onClick=\{onConfirmPatchPlan\}>Confirm dry-run preview<\/button>\}/, "Panel must expose an explicit dry-run confirmation button");
  assert.match(panelSource, /\{canRequest && <button type="button" onClick=\{onRequest\}>Request controlled edit<\/button>\}/, "Panel must render request button only when canRequest is true");
  assert.match(panelSource, /Raw replacement text, raw bodies, diffs, secrets, and private paths are intentionally omitted from the UI\./, "Panel must disclose that raw patch bodies and diffs are omitted");
  assert.match(panelSource, /It does not apply, read, verify, call providers, run commands, or persist raw patch bodies\./, "Panel must keep confirmation scoped to UI unlock only");
}

function assertPreviewEvaluation() {
  const ready = evaluateControlledAgentPatchPlanPreview(clone(validFixture));
  assert.equal(ready.state, "ready", "valid patch plan fixture must be preview-ready");
  assert.equal(ready.preview.metadataOnly, true, "ready preview must be metadata-only");
  assert.equal(ready.preview.reviewOnly, true, "ready preview must be review-only");
  assert.equal(ready.preview.dryRunOnly, true, "ready preview must be dry-run-only");
  assert.equal(ready.preview.automaticApplyAllowed, false, "ready preview must deny automatic apply");
  assert.equal(ready.preview.rows[0]?.requiresUserApply, true, "ready preview rows must require user apply");
  assertNoRawMarkers(ready, "ready preview result");

  const rawDiff = evaluateControlledAgentPatchPlanPreview(clone(rawDiffFixture));
  assert.equal(rawDiff.state, "blocked", "raw diff fixture must be blocked");
  assertNoRawMarkers(rawDiff, "raw diff blocked result");

  const rawBody = clone(validFixture);
  rawBody.patchPlan.fileBody = rawMarkers[1];
  rawBody.patchPlan.candidates[0].rawReplacement = rawMarkers[2];
  const rawBodyResult = evaluateControlledAgentPatchPlanPreview(rawBody);
  assert.equal(rawBodyResult.state, "blocked", "raw body or replacement metadata must be blocked");
  assertNoRawMarkers(rawBodyResult, "raw body blocked result");

  const createOperation = evaluateControlledAgentPatchPlanPreview(clone(createOperationFixture));
  assert.equal(createOperation.state, "blocked", "create operation fixture must be blocked");
  assertNoRawMarkers(createOperation, "create operation blocked result");

  const privatePath = clone(validFixture);
  privatePath.patchPlan.candidates[0].workspaceRelativePath = rawMarkers[3];
  const privatePathResult = evaluateControlledAgentPatchPlanPreview(privatePath);
  assert.equal(privatePathResult.state, "blocked", "private path metadata must be blocked");
  assertNoRawMarkers(privatePathResult, "private path blocked result");
}

function assertConfirmationGateAudit() {
  const gateStates = [
    { label: "no preview", previewRequired: false, previewReady: false, confirmed: false, requestReady: true, pending: false, canRequest: true },
    { label: "ready but unconfirmed", previewRequired: true, previewReady: true, confirmed: false, requestReady: true, pending: false, canRequest: false },
    { label: "ready and confirmed", previewRequired: true, previewReady: true, confirmed: true, requestReady: true, pending: false, canRequest: true },
    { label: "blocked preview", previewRequired: true, previewReady: false, confirmed: true, requestReady: true, pending: false, canRequest: false },
    { label: "pending edit", previewRequired: true, previewReady: true, confirmed: true, requestReady: true, pending: true, canRequest: false },
  ];

  for (const state of gateStates) {
    const previewAllowsRequest = !state.previewRequired || (state.previewReady && state.confirmed);
    const canRequest = previewAllowsRequest && state.requestReady && !state.pending;
    assert.equal(canRequest, state.canRequest, `confirmation gate mismatch for ${state.label}`);
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

async function importPatchPlanPreviewService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentPatchPlanPreview.ts"]);
  try {
    return imports.get("services/controlledAgentPatchPlanPreview.ts");
  } finally {
    await cleanup();
  }
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-agent-patch-plan-smoke-ts-"));
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
