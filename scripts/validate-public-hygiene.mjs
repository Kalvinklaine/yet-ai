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

const selfTestDenyExamples = [
  "Yet AI offers official OpenAI login for every user.",
  "ChatGPT account login supported in production.",
  "Use production OpenAI OAuth to connect your account.",
  "Click sign in with ChatGPT to start.",
  "The default production login UX uses OpenAI accounts."
];

const selfTestAllowExamples = [
  "Official OpenAI login is planned/not available; use the API-key fallback safe/default path.",
  "ChatGPT account login supported is not a current claim because production/default account login remains blocked.",
  "Production OpenAI OAuth is experimental/non-default and not production-ready.",
  "Do not show sign in with ChatGPT until official support is approved.",
  "No production/default account login is enabled; API-key fallback remains safe/default."
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

function findMatches(value) {
  const lowerValue = value.toLowerCase();
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
