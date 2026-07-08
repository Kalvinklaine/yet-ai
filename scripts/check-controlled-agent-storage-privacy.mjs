import { readFile } from "node:fs/promises";
import { findForbiddenEvidenceText, formatForbiddenEvidenceFailures } from "./lib/forbidden-evidence-text.mjs";

const safePaths = [
  "docs/architecture/031-controlled-agent-storage-privacy-inventory.md",
  "scripts/fixtures/controlled-agent-storage-privacy/safe/report-template.md",
  "scripts/fixtures/controlled-agent-storage-privacy/safe/history-entry.json"
];

const unsafePaths = [
  "scripts/fixtures/controlled-agent-storage-privacy/unsafe/raw-prompt-provider.json",
  "scripts/fixtures/controlled-agent-storage-privacy/unsafe/file-diff-command.json",
  "scripts/fixtures/controlled-agent-storage-privacy/unsafe/storage-path-overclaim.md",
  "scripts/fixtures/controlled-agent-storage-privacy/unsafe/private-path-file-url.json"
];

const requiredSafeFragments = [
  "controlled-agent",
  "sanitized",
  "dev-preview"
];

const releaseOverclaimPattern = new RegExp(
  `\\b(?:${[
    ["production", "ready"].join("-"),
    ["release", "ready"].join("-"),
    ["marketplace", "ready"].join("-"),
    "ready\\s+for\\s+production",
    "ready\\s+for\\s+release",
    "ready\\s+for\\s+marketplace",
    "publication\\s+approved",
    "release\\s+claim\\s*[:=]",
    "marketplace\\s+claim\\s*[:=]",
    "signing\\s+approved",
    "notarization\\s+approved"
  ].join("|")})\\b`,
  "i"
);

const storagePolicyChecks = [
  ["hosted service requirement", /\b(?:requires?|must\s+use|needs?)\s+(?:a\s+)?(?:hosted\s+Yet\s+AI\s+backend|Yet\s+AI\s+account|managed\s+model\s+gateway|product\s+credits?|cloud\s+workspace)\b/i],
  ["production or release overclaim", releaseOverclaimPattern]
];

const allowedStoragePolicyLinePattern = /\b(?:must\s+not|must\s+never|do\s+not|should\s+not|forbidden|absent|exclude|exclusions?|rejects?|rejected|redacted|omitted|blocked|not\s+persist|not\s+include|not\s+claim|not\s+require|not\s+production|not\s+release|not\s+marketplace|future|planned|before\s+implementation|without)\b/i;

const failures = [];

for (const path of safePaths) {
  const text = await readText(path);
  const unsafeMatches = findUnsafe(text, path);
  failures.push(...formatForbiddenEvidenceFailures(unsafeMatches));
  if (path.includes("fixtures/controlled-agent-storage-privacy/safe/")) {
    for (const fragment of requiredSafeFragments) {
      if (!text.toLowerCase().includes(fragment)) failures.push(`${path}: missing safe fixture fragment ${fragment}`);
    }
  }
}

for (const path of unsafePaths) {
  const text = await readText(path);
  const unsafeMatches = findUnsafe(text, path);
  if (unsafeMatches.length === 0) failures.push(`${path}: unsafe fixture was not rejected`);
}

if (failures.length > 0) {
  console.error("Controlled-agent storage/privacy validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Controlled-agent storage/privacy validation passed for ${safePaths.length} safe inputs and ${unsafePaths.length} rejected unsafe fixtures.`);

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    failures.push(`${path}: cannot read file (${error.message})`);
    return "";
  }
}

function findUnsafe(text, label) {
  return [
    ...findForbiddenEvidenceText(text, { label, allowPolicyLines: true }),
    ...findStoragePolicyIssues(text, label)
  ];
}

function findStoragePolicyIssues(text, label) {
  const matches = [];
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (allowedStoragePolicyLinePattern.test(line)) continue;
    for (const [category, pattern] of storagePolicyChecks) {
      if (pattern.test(line)) matches.push({ label, category, line: index + 1 });
    }
  }
  return matches;
}
