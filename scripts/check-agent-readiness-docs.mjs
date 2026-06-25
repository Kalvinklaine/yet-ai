import { access, readFile } from "node:fs/promises";

const readinessDocPath = "docs/architecture/013-agent-readiness-milestone.md";
const docsIndexPath = "docs/README.md";

const requiredHeadings = [
  "# 013 Agent Run Readiness Milestone",
  "## Readiness taxonomy",
  "## Current Agent Run status matrix",
  "## Blocked and deferred capabilities",
  "## Future controlled-autonomy eligibility gates",
  "## Reporting rules",
  "## Verification"
];

const requiredConcepts = [
  ["no auto-send", /no auto-send/i],
  ["no auto-apply", /no auto-apply/i],
  ["no auto-run verification", /automatic verification|cannot send, apply, verify|must still trigger every .*verification/i],
  ["no auto-repair", /automatic repair|auto-repair/i],
  ["no auto-rollback", /automatic rollback|auto-rollback|cannot .*rollback/i],
  ["no hidden reads", /hidden workspace reads|read hidden files|hidden context gathering/i],
  ["local-first BYOK", /local-first BYOK/i],
  ["no required cloud", /must not require .*cloud workspace|cloud workspace/i],
  ["not production autonomy", /not a production release claim|not production autonomy|no production or autonomy claim/i]
];

const requiredStatusEntries = [
  "| Browser / standalone GUI | Experimental manual-only |",
  "| VS Code | Dogfood-ready dev-preview |",
  "| JetBrains | Experimental manual-only |"
];

const failures = [];

let readinessDoc = "";
let docsIndex = "";

try {
  await access(readinessDocPath);
  readinessDoc = await readFile(readinessDocPath, "utf8");
} catch {
  failures.push(`Missing readiness doc: ${readinessDocPath}`);
}

try {
  docsIndex = await readFile(docsIndexPath, "utf8");
} catch {
  failures.push(`Missing docs index: ${docsIndexPath}`);
}

if (readinessDoc.length > 0) {
  for (const heading of requiredHeadings) {
    if (!readinessDoc.includes(heading)) {
      failures.push(`Missing required heading in ${readinessDocPath}: ${heading}`);
    }
  }

  for (const [concept, pattern] of requiredConcepts) {
    if (!pattern.test(readinessDoc)) {
      failures.push(`Missing required safety concept in ${readinessDocPath}: ${concept}`);
    }
  }

  for (const statusEntry of requiredStatusEntries) {
    if (!readinessDoc.includes(statusEntry)) {
      failures.push(`Missing required status entry in ${readinessDocPath}: ${statusEntry}`);
    }
  }
}

if (docsIndex.length > 0 && !docsIndex.includes("architecture/013-agent-readiness-milestone.md")) {
  failures.push(`Missing docs index link in ${docsIndexPath}: architecture/013-agent-readiness-milestone.md`);
}

if (failures.length > 0) {
  console.error("Agent readiness docs validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent readiness docs validation passed.");

