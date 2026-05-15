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

function findMatches(value) {
  const lowerValue = value.toLowerCase();
  return forbiddenIdentifiers.filter((identifier) => lowerValue.includes(identifier.toLowerCase()));
}

async function trackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files"], { encoding: "utf8" });
  return stdout.split("\n").filter(Boolean);
}

const files = await trackedFiles();
const failures = [];

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

  const contentMatches = findMatches(content);
  for (const identifier of contentMatches) {
    const line = content.toLowerCase().split("\n").findIndex((value) => value.includes(identifier.toLowerCase())) + 1;
    failures.push(`${file}:${line}: content contains forbidden identifier ${identifier}`);
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
