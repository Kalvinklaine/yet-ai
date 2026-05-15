import { readdir, readFile } from "node:fs/promises";

const architectureDir = "docs/architecture";
const docsIndexPath = "docs/README.md";
const entries = await readdir(architectureDir, { withFileTypes: true });
const docs = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));
const index = await readFile(docsIndexPath, "utf8");
const missing = docs.filter((doc) => !index.includes(`architecture/${doc}`));

if (missing.length > 0) {
  console.error("Docs index validation failed:");
  console.error(`${docsIndexPath} is missing architecture docs:`);
  for (const doc of missing) {
    console.error(`- architecture/${doc}`);
  }
  process.exit(1);
}

console.log("Docs index validation passed.");
