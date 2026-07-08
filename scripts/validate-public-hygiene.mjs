import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const forbiddenIdentifiers = [
  ["re", "fact"],
  ["small", "cloud"],
  ["co", "dify"],
  ["re", "fact", "-", "lsp"],
  ["re", "fact", "-", "chat", "-", "js"],
  ["docs", ".", "re", "fact", ".", "ai"],
  ["github", ".", "com", "/", "small", "cloud", "ai"]
].map((parts) => parts.join(""));

const productionLoginDenyPatterns = [
  /official\s+openai\s+login/i,
  /chatgpt\s+account\s+login\s+supported/i,
  /production\s+openai\s+oauth/i,
  /sign\s+in\s+with\s+chatgpt/i,
  /production\s+openai\s+login(?:\s+support(?:ed)?)?/i,
  /production\s+chatgpt\s+account(?:-login|\s+login)?\s+support(?:ed)?/i,
  /official\s+openai\s+oauth(?:\s+support(?:ed)?)?/i,
  /default\s+production\s+login\s+ux/i,
  /production\/default\s+account\s+login/i
];

const productionPackagingDenyPatterns = [
  /marketplace\s+(?:publication|release)\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  new RegExp(["marketplace", "ready"].join("-"), "i"),
  /(?:ready|approved)\s+(?:for\s+)?(?:the\s+)?(?:vs\s*code|jetbrains|ide\s+)?\s*marketplace/i,
  /published\s+(?:to|on)\s+(?:the\s+)?(?:vs\s*code|jetbrains|ide\s+)?\s*marketplace/i,
  /(?:is\s+)?published\s+(?:to|on)\s+(?:the\s+)?(?:vs\s*code|jetbrains|ide\s+)?\s*marketplace/i,
  /production\s+(?:installer|release)\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  /production\s+release\s+(?:has\s+)?(?:shipped|launched)/i,
  /signed\s+(?:and\s+notarized\s+)?production\s+engine/i,
  /notarized\s+production\s+engine/i,
  /signed\s+engine\s+bundle\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  /(?:signing|notarization)\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  /automatic\s+update\s+channel\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  /rollback\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  /artifact\s+retention\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  /(?:sbom|provenance|attestation)\s+(?:is\s+)?(?:ready|complete|available|supported)/i,
  /production-grade\s+bundled\s+engine/i
];

const selfTestDenyExamples = [
  "Yet AI offers official OpenAI login for every user.",
  "ChatGPT account login supported in production.",
  "Use production OpenAI OAuth to connect your account.",
  "Click sign in with ChatGPT to start.",
  "The default production login UX uses OpenAI accounts."
];

const packagingSelfTestDenyExamples = [
  "Marketplace publication is ready for Yet AI.",
  "Yet AI is marketplace-ready for developers.",
  "Yet AI is approved for the JetBrains Marketplace.",
  "Yet AI is published to the VS Code Marketplace.",
  "The production installer is complete.",
  "The production release has shipped.",
  "Yet AI includes a signed production engine.",
  "Notarization is complete for the engine.",
  "The automatic update channel is supported.",
  "Rollback is ready for released artifacts.",
  "Artifact retention is complete for public releases.",
  "SBOM is complete for public distribution.",
  "Provenance attestation is supported.",
  "Yet AI ships a production-grade bundled engine.",
  "Current artifacts are dev-preview.\nMarketplace publication is ready for Yet AI.",
  "Artifacts are unsigned validation outputs.\nThe production installer is complete."
];

const selfTestAllowExamples = [
  "Official OpenAI login is planned/not available; use the API-key fallback safe/default path.",
  "ChatGPT account login supported is not a current claim because production/default account login remains blocked.",
  "Production OpenAI OAuth is experimental/non-default and not production-ready.",
  "Do not show sign in with ChatGPT until official support is approved.",
  "No production/default account login is enabled; API-key fallback remains safe/default."
];

const packagingSelfTestAllowExamples = [
  "Marketplace publication is not implemented for dev-preview artifacts.",
  "Yet AI is not marketplace-ready; this remains future decision work.",
  "Yet AI is not published to the VS Code Marketplace.",
  "The production installer is planned but not complete.",
  "The production release has not shipped; this is a dev-preview artifact.",
  "The bundled engine is not a signed production engine.",
  "No notarization is complete for the current unsigned dev-preview engine.",
  "No automatic update channel is available for install-from-file dev previews.",
  "Rollback is planned but not supported for dev-preview artifacts.",
  "Artifact retention is future production packaging work, not current release support.",
  "SBOM is planned decision work and not complete for public distribution.",
  "Provenance attestation is not implemented for current dev-preview artifacts.",
  "Current artifacts do not ship a production-grade bundled engine."
];

const productionLoginAllowPatterns = [
  /planned\s*\/\s*not\s+available/i,
  /not\s+available/i,
  /unavailable/i,
  /experimental/i,
  /non-default/i,
  /safe\s*\/\s*default/i,
  /api-key\s+fallback/i,
  /no\s+production\s*\/\s*default\s+account\s+login/i,
  /production\s*\/\s*default\s+account\s+login\s+(?:remains\s+)?blocked/i,
  /blocked/i,
  /not\s+official/i,
  /not\s+production/i,
  /not\s+production(?:-|\s*)ready/i,
  /not\s+implemented/i,
  /not\s+enabled/i,
  /not\s+claim/i,
  /does\s+not\s+(?:verify\s+or\s+)?claim/i,
  /must\s+not\s+(?:be\s+)?(?:described|claim|enable|become)/i,
  /must\s+not\s+enable/i,
  /must\s+not/i,
  /until\s+official/i,
  /requires?\s+(?:separate\s+)?(?:approval|review)/i,
  /before\s+approval/i,
  /no\s+official\s+(?:third-party\/local-app\s+)?openai/i
];

const productionPackagingAllowPatterns = [
  /not\s+(?:a\s+)?(?:marketplace|production|signed|notarized|published|release)/i,
  /not\s+(?:implemented|complete|available|ready|supported|shipped)/i,
  /no\s+(?:marketplace|signing|notarization|production|automatic\s+update|installer|publication|release|rollback|artifact\s+retention|sbom|provenance|attestation)/i,
  /does\s+not\s+(?:publish|sign|notarize|create|claim|represent|ship)/i,
  /do\s+not\s+(?:claim|represent|publish|install)/i,
  /must\s+not\s+(?:claim|represent|publish|sign|notarize|require|ship)/i,
  /dev-preview/i,
  /install-from-file/i,
  /unsigned/i,
  /unpublished/i,
  /future\s+(?:production\s+)?packaging/i,
  /future\s+(?:decision|decisions|work|workflow)/i,
  /decision\s+record/i,
  /planned\s+but\s+not\s+(?:complete|supported|implemented)/i,
  /(?:no|not)\s+(?:[^.]*\s+)?(?:complete|ready|available|supported|shipped|implemented)/i,
  /remains?\s+(?:a\s+)?(?:decision|future|follow-up|unimplemented)/i,
  /current\s+artifacts\s+do\s+not/i
];

const benignIdentifierFragments = [new RegExp(`\\b${["re", "factor"].join("")}(?:ing|ed|s)?\\b`, "gi")];

function normalizeForIdentifierScan(value) {
  let normalized = value;
  for (const pattern of benignIdentifierFragments) {
    normalized = normalized.replace(pattern, "");
  }
  return normalized;
}

function findMatches(value) {
  const lowerValue = normalizeForIdentifierScan(value).toLowerCase();
  return forbiddenIdentifiers.filter((identifier) => lowerValue.includes(identifier.toLowerCase()));
}

function findProductionLoginOverclaims(content) {
  const lines = content.split("\n");
  const failures = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchedPattern = productionLoginDenyPatterns.find((pattern) => pattern.test(line));
    if (!matchedPattern) {
      continue;
    }
    const context = [lines[index - 2] ?? "", lines[index - 1] ?? "", line, lines[index + 1] ?? "", lines[index + 2] ?? ""].join(" ");
    if (productionLoginAllowPatterns.some((pattern) => pattern.test(context))) {
      continue;
    }
    failures.push({ line: index + 1, text: summarizeLine(line) });
  }
  return failures;
}

function findProductionPackagingOverclaims(content) {
  const lines = content.split("\n");
  const failures = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchedPattern = productionPackagingDenyPatterns.find((pattern) => pattern.test(line));
    if (!matchedPattern) {
      continue;
    }
    const claimContext = sentenceForMatch(line, matchedPattern);
    if (productionPackagingAllowPatterns.some((pattern) => pattern.test(claimContext))) {
      continue;
    }
    failures.push({ line: index + 1, text: summarizeLine(line) });
  }
  return failures;
}

function sentenceForMatch(line, matchedPattern) {
  const match = matchedPattern.exec(line);
  if (!match) {
    return line;
  }
  const before = line.slice(0, match.index);
  const after = line.slice(match.index + match[0].length);
  const previousBoundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"));
  const nextBoundaries = [after.indexOf("."), after.indexOf("!"), after.indexOf("?")].filter((index) => index >= 0);
  const start = previousBoundary >= 0 ? previousBoundary + 1 : 0;
  const end = nextBoundaries.length > 0 ? match.index + match[0].length + Math.min(...nextBoundaries) + 1 : line.length;
  return line.slice(start, end).trim();
}

function summarizeLine(line) {
  return line.trim().replace(/\s+/g, " ").slice(0, 160);
}

function runSelfTest() {
  const failures = [];
  for (const example of selfTestDenyExamples) {
    if (findProductionLoginOverclaims(example).length === 0) {
      failures.push(`self-test did not reject: ${example}`);
    }
  }
  for (const example of selfTestAllowExamples) {
    const matches = findProductionLoginOverclaims(example);
    if (matches.length > 0) {
      failures.push(`self-test rejected approved wording: ${example}`);
    }
  }
  for (const example of packagingSelfTestDenyExamples) {
    if (findProductionPackagingOverclaims(example).length === 0) {
      failures.push(`self-test did not reject packaging claim: ${example}`);
    }
  }
  for (const example of packagingSelfTestAllowExamples) {
    const matches = findProductionPackagingOverclaims(example);
    if (matches.length > 0) {
      failures.push(`self-test rejected approved packaging wording: ${example}`);
    }
  }
  return failures;
}

async function trackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files"], { encoding: "utf8" });
  return stdout.split("\n").filter(Boolean);
}

const failures = runSelfTest();
const files = await trackedFiles();

for (const file of files) {
  const filenameMatches = findMatches(file);
  for (const identifier of filenameMatches) {
    failures.push(`${file}: tracked filename contains forbidden identifier ${identifier}`);
  }

  let content;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    failures.push(`${file}: cannot read tracked file (${error.message})`);
    continue;
  }

  if (file === "scripts/validate-public-hygiene.mjs") {
    for (const example of selfTestDenyExamples) {
      content = content.replace(example, "");
    }
    for (const example of selfTestAllowExamples) {
      content = content.replace(example, "");
    }
    for (const example of packagingSelfTestDenyExamples) {
      content = content.replace(example, "");
      content = content.replace(example.replaceAll("\n", "\\n"), "");
    }
    for (const example of packagingSelfTestAllowExamples) {
      content = content.replace(example, "");
    }
  }

  const contentMatches = findMatches(content);
  for (const identifier of contentMatches) {
    const line = content.toLowerCase().split("\n").findIndex((value) => value.includes(identifier.toLowerCase())) + 1;
    failures.push(`${file}:${line}: content contains forbidden identifier ${identifier}`);
  }

  const overclaims = findProductionLoginOverclaims(content);
  for (const overclaim of overclaims) {
    failures.push(`${file}:${overclaim.line}: risky production-login claim must be framed as unavailable, blocked, experimental/non-default, or API-key fallback safe/default (${overclaim.text})`);
  }

  const packagingOverclaims = findProductionPackagingOverclaims(content);
  for (const overclaim of packagingOverclaims) {
    failures.push(`${file}:${overclaim.line}: risky production-packaging claim must be framed as dev-preview/install-from-file, unsigned/unpublished, not implemented, or future decision work (${overclaim.text})`);
  }
}

if (!files.includes(".gitignore")) {
  failures.push(".gitignore: file is not tracked");
} else {
  const gitignore = await readFile(".gitignore", "utf8");
  for (const identifier of findMatches(gitignore)) {
    failures.push(`.gitignore: contains forbidden identifier ${identifier}`);
  }
}

if (failures.length > 0) {
  console.error("Public hygiene validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Public hygiene validation passed.");
