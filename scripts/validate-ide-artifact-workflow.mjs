import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "ide-artifacts.yml");

const requiredUploadPaths = [
  "dist/github-artifacts/vscode-unzip-first/*",
  "dist/github-artifacts/jetbrains-install-direct/*",
];
const staleRefs = [
  `jetbrains-${"unzip-first"}`,
  `dist/github-artifacts/${"manifest"}`,
  `yet-ai-plugin-manifest-${"${{ matrix.label }}"}`,
];
const matrixUploadNames = [
  "yet-ai-vscode-unzip-first-${{ matrix.label }}-${{ github.sha }}",
  "yet-ai-jetbrains-install-direct-${{ matrix.label }}-${{ github.sha }}",
];
const combinedUploadName = "yet-ai-plugin-manifest-${{ github.sha }}";
const combinedManifestPath = "dist/combined-plugin-manifest/manifest.json";

const workflow = await readFile(workflowPath, "utf8");
const failures = [];

for (const requiredPath of requiredUploadPaths) {
  assert(countOccurrences(workflow, requiredPath) === 1, `Workflow must contain upload path exactly once: ${requiredPath}`);
}

for (const staleRef of staleRefs) {
  assert(!workflow.includes(staleRef), `Workflow must not contain stale artifact layout reference: ${staleRef}`);
}

const downloadStep = findStepBlock(workflow, "Download all per-platform VS Code artifacts");
assert(downloadStep !== undefined, "Workflow must include the per-platform VS Code artifact download step.");
if (downloadStep !== undefined) {
  assert(downloadStep.includes("pattern: yet-ai-vscode-unzip-first-*"), "Combine job must download only per-platform VS Code artifact manifests with pattern: yet-ai-vscode-unzip-first-*");
  assert(!/merge-multiple:\s*true\b/.test(downloadStep), "Combine job download must not use merge-multiple: true; each artifact must remain in a separate downloaded directory.");
}

const combineStep = findStepBlock(workflow, "Combine per-platform manifests");
assert(combineStep !== undefined, "Workflow must include a combine per-platform manifests step.");
if (combineStep !== undefined) {
  assert(combineStep.includes(`--output ${combinedManifestPath}`), `Combined manifest output must stay outside dist/github-artifacts at ${combinedManifestPath}.`);
  assert(!/--output\s+dist\/github-artifacts\b/.test(combineStep), "Combined manifest output must not be written under dist/github-artifacts.");
}

const buildJob = jobBlock(workflow, "build-ide-artifacts");
const combineJob = jobBlock(workflow, "combine-manifests");
assert(buildJob !== undefined, "Workflow must include build-ide-artifacts job.");
assert(combineJob !== undefined, "Workflow must include combine-manifests job.");

if (buildJob !== undefined) {
  const names = uploadArtifactNames(buildJob);
  assertSetEquals(names, matrixUploadNames, "Matrix job upload artifact names must be only the VS Code unzip-first and JetBrains direct-install public families.");
  assert(buildJob.includes("npm run smoke:jetbrains-bundled-runtime"), "Build job must run npm run smoke:jetbrains-bundled-runtime before uploading artifacts.");
  assert(buildJob.includes("artifact:github-summary"), "Build job must write the expected public artifact summary with artifact:github-summary.");
  const firstUploadIndex = buildJob.indexOf("uses: actions/upload-artifact@v4");
  const bundledSmokeIndex = buildJob.indexOf("npm run smoke:jetbrains-bundled-runtime");
  const summaryIndex = buildJob.indexOf("artifact:github-summary");
  if (firstUploadIndex !== -1) {
    assert(bundledSmokeIndex !== -1 && bundledSmokeIndex < firstUploadIndex, "JetBrains bundled runtime startup smoke must run before matrix artifact uploads.");
    assert(summaryIndex !== -1 && summaryIndex < firstUploadIndex, "Expected public artifact summary must be generated before matrix artifact uploads.");
  }
}
if (combineJob !== undefined) {
  const names = uploadArtifactNames(combineJob);
  assertSetEquals(names, [combinedUploadName], "Combine job upload artifact name must be the single combined plugin manifest family.");
}

const allUploadNames = uploadArtifactNames(workflow);
assertSetEquals(allUploadNames, [...matrixUploadNames, combinedUploadName], "Workflow upload artifact names must remain the two per-platform families plus the combined manifest.");
assert(workflow.includes(`path: ${combinedManifestPath}`), `Combined manifest upload path must be ${combinedManifestPath}.`);
const staleManifestUploadPath = `path: dist/github-artifacts/${"manifest"}`;
assert(!workflow.includes(staleManifestUploadPath), `Combined manifest upload must not point under ${staleManifestUploadPath.replace(/^path: /, "")}.`);

if (failures.length > 0) {
  console.error("IDE artifact workflow validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("IDE artifact workflow layout validation passed.");

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function findStepBlock(text, stepName) {
  const marker = `- name: ${stepName}`;
  const start = text.indexOf(marker);
  if (start === -1) {
    return undefined;
  }
  const nextStep = text.indexOf("\n      - name:", start + marker.length);
  const nextJob = text.slice(start + marker.length).search(/\n  [A-Za-z0-9_-]+:\n/);
  const candidates = [nextStep, nextJob === -1 ? -1 : start + marker.length + nextJob].filter((index) => index !== -1);
  const end = candidates.length === 0 ? text.length : Math.min(...candidates);
  return text.slice(start, end);
}

function jobBlock(text, jobName) {
  const marker = `  ${jobName}:\n`;
  const start = text.indexOf(marker);
  if (start === -1) {
    return undefined;
  }
  const matches = [...text.slice(start + marker.length).matchAll(/^  [A-Za-z0-9_-]+:\s*$/gm)];
  const end = matches.length === 0 ? text.length : start + marker.length + matches[0].index;
  return text.slice(start, end);
}

function uploadArtifactNames(text) {
  const names = [];
  const uploadSteps = text.split(/\n(?=\s*- name: )/).filter((block) => /^\s*uses:\s*actions\/upload-artifact@v4\s*$/m.test(block));
  for (const block of uploadSteps) {
    const name = block.match(/^\s*name:\s*(.+?)\s*$/m)?.[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

function assertSetEquals(actual, expected, message) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(actualSorted.length === expectedSorted.length && actualSorted.every((value, index) => value === expectedSorted[index]), `${message} Expected ${expectedSorted.join(", ")}; got ${actualSorted.join(", ") || "<none>"}.`);
}
