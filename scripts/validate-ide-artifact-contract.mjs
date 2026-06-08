import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  expectedPublicGithubIdeArtifactCount,
  expectedPublicGithubIdeArtifactNames,
  githubIdePlatforms,
} from "./ide-artifact-contract.mjs";

const fakeSha = "0123456789abcdef0123456789abcdef01234567";
const expectedPlatformLabels = ["linux-x64", "macos-arm64", "windows-x64"];
const expectedNames = [
  "yet-ai-vscode-unzip-first-linux-x64-0123456789abcdef0123456789abcdef01234567",
  "yet-ai-vscode-unzip-first-macos-arm64-0123456789abcdef0123456789abcdef01234567",
  "yet-ai-vscode-unzip-first-windows-x64-0123456789abcdef0123456789abcdef01234567",
  "yet-ai-jetbrains-install-direct-linux-x64-0123456789abcdef0123456789abcdef01234567",
  "yet-ai-jetbrains-install-direct-macos-arm64-0123456789abcdef0123456789abcdef01234567",
  "yet-ai-jetbrains-install-direct-windows-x64-0123456789abcdef0123456789abcdef01234567",
  "yet-ai-plugin-manifest-0123456789abcdef0123456789abcdef01234567",
];
const secretOrPrivatePathMarkers = [
  "Bearer",
  "Authorization",
  "api_key",
  "access_token",
  "refresh_token",
  "/Users/",
  "C:\\Users\\",
  ".codex/auth.json",
];
const failures = [];

const names = expectedPublicGithubIdeArtifactNames(fakeSha);
assert(names.length === expectedPublicGithubIdeArtifactCount, `Expected ${expectedPublicGithubIdeArtifactCount} public artifact names; got ${names.length}.`);
assert(new Set(names).size === names.length, "Expected public artifact names must be unique.");
for (const name of names) {
  assert(countOccurrences(name, fakeSha) === 1, `Artifact name must include the fake SHA exactly once: ${name}`);
}
assertArrayEquals(githubIdePlatforms.map((platform) => platform.label), expectedPlatformLabels, "Platform labels must remain exactly linux-x64, macos-arm64, windows-x64.");
assertArrayEquals(names, expectedNames, "Expected public artifact names must remain stable and exact.");

const summary = spawnSync(platformCommand("npm"), ["run", "artifact:github-summary", "--", "--sha", fakeSha], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: safeEnv(),
});
if (summary.error?.code === "ENOENT") {
  failures.push("Required command `npm` was not found on PATH.");
} else if (summary.error !== undefined) {
  failures.push(`Could not run artifact:github-summary: ${summary.error.message}`);
} else if (summary.status !== 0) {
  failures.push("artifact:github-summary failed for the fake SHA.");
} else {
  const output = summary.stdout;
  const bulletLines = output.split(/\r?\n/).filter((line) => line.startsWith("- "));
  assertArrayEquals(bulletLines, expectedNames.map((name) => `- ${name}`), "Summary output must contain exactly the expected 7 artifact bullet lines and no extras.");
  for (const marker of secretOrPrivatePathMarkers) {
    assert(!output.includes(marker), `Summary output must not contain secret/private-path marker: ${marker}`);
  }
}

if (failures.length > 0) {
  console.error("IDE artifact contract validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("IDE artifact contract validation passed: 7 public artifact names share the workflow/summary contract.");

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function assertArrayEquals(actual, expected, message) {
  const matches = actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  assert(matches, `${message} Expected ${expected.join(", ")}; got ${actual.join(", ") || "<none>"}.`);
}

function safeEnv() {
  return { ...process.env, PATH: process.env.PATH ?? "" };
}

function platformCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return { npm: "npm.cmd" }[command] ?? command;
}
