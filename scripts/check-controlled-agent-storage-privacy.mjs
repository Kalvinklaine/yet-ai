import { readFile } from "node:fs/promises";

const safePaths = [
  "docs/architecture/031-controlled-agent-storage-privacy-inventory.md",
  "scripts/fixtures/controlled-agent-storage-privacy/safe/report-template.md",
  "scripts/fixtures/controlled-agent-storage-privacy/safe/history-entry.json"
];

const unsafePaths = [
  "scripts/fixtures/controlled-agent-storage-privacy/unsafe/raw-prompt-provider.json",
  "scripts/fixtures/controlled-agent-storage-privacy/unsafe/file-diff-command.json",
  "scripts/fixtures/controlled-agent-storage-privacy/unsafe/storage-path-overclaim.md"
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

const unsafeChecks = [
  ["provider secrets", /\b(?:api[_-]?key|apiKey|provider[_-]?key|providerKey|secret[_-]?key|secretKey|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|runtime[_ -]?token|runtimeToken|session[_ -]?token|sessionToken)\b\s*[\":=]\s*[^\s<][^\r\n]*/i],
  ["bearer or auth headers", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+|Cookie\s*:\s*\S+|Set-Cookie\s*:\s*\S+)/i],
  ["raw prompts", /\b(?:raw\s+prompts?|rawPrompt|prompt\s+dump|promptDump|verbatim\s+prompt|full\s+prompt\s+text|composer\s+text)\b\s*[\":=]\s*[^\r\n]+/i],
  ["provider responses", /\b(?:raw\s+responses?|rawResponse|response\s+dump|responseDump|provider\s+output\s+dump|verbatim\s+response|provider\s+response|providerResponse|provider\s+payload|providerPayload|provider\s+request|completion\s+payload)\b\s*[\":=]\s*[^\r\n]+/i],
  ["file bodies", /\b(?:file\s+contents?|fileContents|source\s+contents?|document\s+contents?|full\s+file\s+text|raw\s+file\s+body|rawFileBody|verbatim\s+source)\b\s*[\":=]\s*[^\r\n]+/i],
  ["diffs or replacement text", /\b(?:raw\s+diff|rawDiff|diff\s+dump|patch\s+body|raw\s+patch|patch\s+dump|replacement\s+body|replacement\s+text|replacementText|edit\s+hunk)\b\s*[\":=]\s*[^\r\n]+/i],
  ["command material", /\b(?:command\s*[:=]\s*[^\s<][^\r\n]*|stdout\s*[:=]\s*[^\s<][^\r\n]*|stderr\s*[:=]\s*[^\s<][^\r\n]*|terminal\s+(?:output|transcript)\s*[:=]\s*[^\s<][^\r\n]*|cwd\s*[:=]\s*[^\s<][^\r\n]*|env\s*[:=]\s*[^\s<][^\r\n]*|process\.env)/i],
  ["bridge dumps", /\b(?:raw\s+bridge\s+payload|bridge\s+payload\s+dump|bridge\s+payload|postMessage\s+dump|runtime\s+http\s+dump|sse\s+payload\s+dump|request\s+body)\b\s*[:=]\s*[^\r\n]+/i],
  ["browser storage dumps", /\b(?:localStorage|sessionStorage|indexedDB|browser\s+storage\s+dump|storage\s+dump|workspace\s+storage\s+dump)\b\s*[:=]\s*[^\r\n]+/i],
  ["private paths", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._ -]+\/|\b[A-Za-z]:\\[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["hosted service requirements", /\b(?:requires?|must\s+use|needs?)\s+(?:a\s+)?(?:hosted\s+Yet\s+AI\s+backend|Yet\s+AI\s+account|managed\s+model\s+gateway|product\s+credits?|cloud\s+workspace)\b/i],
  ["production or release overclaims", releaseOverclaimPattern]
];

const failures = [];

for (const path of safePaths) {
  const text = await readText(path);
  const unsafeMatches = findUnsafe(text);
  for (const match of unsafeMatches) failures.push(`${path}: unsafe ${match.category}`);
  if (path.includes("fixtures/controlled-agent-storage-privacy/safe/")) {
    for (const fragment of requiredSafeFragments) {
      if (!text.toLowerCase().includes(fragment)) failures.push(`${path}: missing safe fixture fragment ${fragment}`);
    }
  }
}

for (const path of unsafePaths) {
  const text = await readText(path);
  const unsafeMatches = findUnsafe(text);
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

function findUnsafe(text) {
  const matches = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isAllowedPolicyLine(line)) continue;
    for (const [category, pattern] of unsafeChecks) {
      if (pattern.test(line)) matches.push({ category, line: index + 1 });
    }
  }
  return matches;
}

function isAllowedPolicyLine(line) {
  return /\b(?:must\s+not|must\s+never|do\s+not|should\s+not|forbidden|absent|exclude|exclusions?|rejects?|rejected|redacted|omitted|blocked|not\s+persist|not\s+include|not\s+claim|not\s+require|not\s+production|not\s+release|not\s+marketplace|future|planned|before\s+implementation|without)\b/i.test(line);
}
