import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  githubIdeArtifactStagingPaths,
  githubIdePlatforms,
  githubIdeWorkflowCombinedUploadArtifactName,
  githubIdeWorkflowMatrixUploadArtifactNames,
} from "./ide-artifact-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "ide-artifacts.yml");

const staleRefs = [
  `jetbrains-${"unzip-first"}`,
  `dist/github-artifacts/${"manifest"}`,
  `yet-ai-plugin-manifest-${"${{ matrix.label }}"}`,
];
const combinedManifestPath = "dist/combined-plugin-manifest/manifest.json";
const requiredPreUploadSmokeCommands = [
  "npm run smoke:installed-plugin-chat-visual",
  "npm run smoke:plugin-layout",
  "npm run smoke:vscode-first-message",
  "npm run smoke:jetbrains-first-message",
  "npm run smoke:github-ide-artifacts",
];
const browserSmokeCommands = [
  "npm run smoke:installed-plugin-chat-visual",
  "npm run smoke:vscode-wrapper-browser",
  "npm run smoke:jetbrains-gui-browser",
  "npm run smoke:jetbrains-wrapper-browser",
];

const workflow = await readFile(workflowPath, "utf8");
const failures = [];

for (const requiredPath of githubIdeArtifactStagingPaths) {
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
  const buildSteps = workflowSteps(buildJob, workflow.indexOf(buildJob));
  const buildRunCommands = runCommands(buildSteps);
  const names = uploadArtifactNames(buildJob);
  assertSetEquals(names, githubIdeWorkflowMatrixUploadArtifactNames, "Matrix job upload artifact names must be only the VS Code unzip-first and JetBrains direct-install public families.");
  for (const command of requiredPreUploadSmokeCommands) {
    assert(commandRunExists(buildRunCommands, command), `Build job must run ${command} from an actual run step before uploading artifacts.`);
  }
  assert(commandRunExists(buildRunCommands, "npm run smoke:jetbrains-bundled-runtime"), "Build job must run npm run smoke:jetbrains-bundled-runtime from an actual run step before uploading artifacts.");
  assert(commandRunExists(buildRunCommands, "npm run artifact:github-summary"), "Build job must write the expected public artifact summary with npm run artifact:github-summary from an actual run step.");
  assertSetEquals(matrixLabels(buildJob), githubIdePlatforms.map((platform) => platform.label), "Workflow matrix labels must match the public IDE artifact platform labels.");
  const firstUploadIndex = firstUploadStepIndex(buildSteps);
  const bundledSmokeIndex = commandRunIndex(buildRunCommands, "npm run smoke:jetbrains-bundled-runtime");
  const summaryIndex = commandRunIndex(buildRunCommands, "npm run artifact:github-summary");
  const jetbrainsPrepareIndex = commandRunIndex(buildRunCommands, "npm run prepare:jetbrains-preview");
  const vscodePrepareIndex = commandRunIndex(buildRunCommands, "npm run prepare:vscode-preview");
  assert(jetbrainsPrepareIndex !== -1 && vscodePrepareIndex !== -1 && jetbrainsPrepareIndex < vscodePrepareIndex, "Build job must prepare JetBrains artifacts before VS Code artifacts so packaged GUI freshness checks read current assets.");
  if (firstUploadIndex !== -1) {
    for (const command of requiredPreUploadSmokeCommands) {
      const smokeIndex = commandRunIndex(buildRunCommands, command);
      assert(smokeIndex !== -1 && smokeIndex < firstUploadIndex, `${command} must run before matrix artifact uploads.`);
    }
    assert(bundledSmokeIndex !== -1 && bundledSmokeIndex < firstUploadIndex, "JetBrains bundled runtime startup smoke must run before matrix artifact uploads.");
    assert(summaryIndex !== -1 && summaryIndex < firstUploadIndex, "Expected public artifact summary must be generated before matrix artifact uploads.");
  }
  const lastChromiumInstallIndex = lastCommandRunIndex(buildRunCommands, /^npx playwright install(?: --with-deps)? chromium$/);
  assert(lastChromiumInstallIndex !== -1, "Build job must install Playwright Chromium from an actual run step before browser smokes.");
  for (const command of browserSmokeCommands) {
    const smokeIndex = commandRunIndex(buildRunCommands, command);
    assert(smokeIndex === -1 || lastChromiumInstallIndex < smokeIndex, `Playwright Chromium install step must appear before browser smoke ${command}.`);
  }
}
if (combineJob !== undefined) {
  const names = uploadArtifactNames(combineJob);
  assertSetEquals(names, [githubIdeWorkflowCombinedUploadArtifactName], "Combine job upload artifact name must be the single combined plugin manifest family.");
}

const allUploadNames = uploadArtifactNames(workflow);
assertSetEquals(allUploadNames, [...githubIdeWorkflowMatrixUploadArtifactNames, githubIdeWorkflowCombinedUploadArtifactName], "Workflow upload artifact names must remain the two per-platform families plus the combined manifest.");
assert(workflow.includes(`path: ${combinedManifestPath}`), `Combined manifest upload path must be ${combinedManifestPath}.`);
const staleManifestUploadPath = `path: dist/github-artifacts/${"manifest"}`;
assert(!workflow.includes(staleManifestUploadPath), `Combined manifest upload must not point under ${staleManifestUploadPath.replace(/^path: /, "")}.`);
const firstWorkflowUploadIndex = workflow.indexOf("uses: actions/upload-artifact@v4");
if (firstWorkflowUploadIndex !== -1) {
  const workflowCommands = runCommands(workflowSteps(workflow, 0));
  for (const command of requiredPreUploadSmokeCommands) {
    const smokeIndex = commandRunIndex(workflowCommands, command);
    assert(smokeIndex !== -1 && smokeIndex < firstWorkflowUploadIndex, `${command} must appear before any actions/upload-artifact usage.`);
  }
}

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
  const uploadSteps = workflowSteps(text, 0).filter((step) => /^\s*uses:\s*actions\/upload-artifact@v4\s*$/m.test(step.block));
  for (const block of uploadSteps) {
    const name = block.block.match(/^\s*name:\s*(.+?)\s*$/m)?.[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

function workflowSteps(text, baseIndex) {
  const matches = [...text.matchAll(/^\s*- name:\s*(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    return { name: match[1], index: baseIndex + start, block: text.slice(start, end) };
  });
}

function runCommands(steps) {
  const commands = [];
  for (const step of steps) {
    const run = step.block.match(/^\s*run:\s*\|\s*$(\n[\s\S]*?)(?=^\s*(?:working-directory:|uses:|with:|env:|if:|shell:|$))/m)?.[1]
      ?? step.block.match(/^\s*run:\s*(.+?)\s*$/m)?.[1];
    if (run === undefined) {
      continue;
    }
    const runStart = step.block.indexOf(run);
    for (const lineMatch of run.matchAll(/^\s*([^#\n].*?)\s*$/gm)) {
      const command = lineMatch[1].replace(/\s+#.*$/, "").trim();
      if (command !== "") {
        commands.push({ command, index: step.index + runStart + lineMatch.index, stepName: step.name });
      }
    }
  }
  return commands;
}

function commandRunExists(commands, expected) {
  return commandRunIndex(commands, expected) !== -1;
}

function commandRunIndex(commands, expected) {
  const found = commands.find((entry) => commandMatches(entry.command, expected));
  return found === undefined ? -1 : found.index;
}

function lastCommandRunIndex(commands, expectedPattern) {
  const found = commands.filter((entry) => expectedPattern.test(entry.command)).at(-1);
  return found === undefined ? -1 : found.index;
}

function commandMatches(actual, expected) {
  return actual === expected || actual.startsWith(`${expected} `);
}

function firstUploadStepIndex(steps) {
  const uploadStep = steps.find((step) => /^\s*uses:\s*actions\/upload-artifact@v4\s*$/m.test(step.block));
  return uploadStep === undefined ? -1 : uploadStep.index;
}

function matrixLabels(text) {
  return [...text.matchAll(/^\s*label:\s*([A-Za-z0-9_-]+)\s*$/gm)].map((match) => match[1]);
}

function assertSetEquals(actual, expected, message) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(actualSorted.length === expectedSorted.length && actualSorted.every((value, index) => value === expectedSorted[index]), `${message} Expected ${expectedSorted.join(", ")}; got ${actualSorted.join(", ") || "<none>"}.`);
}
