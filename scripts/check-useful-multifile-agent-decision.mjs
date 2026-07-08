import { readFile } from "node:fs/promises";

const decisionPath = "docs/architecture/028-useful-multifile-controlled-agent-decision.md";
const docsIndexPath = "docs/README.md";
const targetArchitecturePath = "docs/architecture/003-target-architecture.md";

const failures = [];

const readRequiredFile = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    failures.push(`Missing required file: ${path}`);
    return "";
  }
};

const decision = await readRequiredFile(decisionPath);
const docsIndex = await readRequiredFile(docsIndexPath);
const targetArchitecture = await readRequiredFile(targetArchitecturePath);

const requireIncludes = (label, text, needle, path = decisionPath) => {
  if (!text.includes(needle)) {
    failures.push(`Missing ${label} in ${path}: ${needle}`);
  }
};

const requirePattern = (label, text, pattern, path = decisionPath) => {
  if (!pattern.test(text)) {
    failures.push(`Missing ${label} in ${path}: ${pattern}`);
  }
};

if (decision.length > 0) {
  for (const heading of [
    "# 028 Useful Multi-file Controlled Agent Decision",
    "## Decision scope",
    "## Summary judgment",
    "## Evidence classification",
    "## Preserved non-goals",
    "## Roadmap recommendation",
    "## Verification for this decision"
  ]) {
    requireIncludes("required heading", decision, heading);
  }

  requireIncludes("S109-S123 evidence table header", decision, "| Sprint | Area | Status | Evidence | Residual risk |");
  for (const sprint of ["S109", "S110", "S111", "S112", "S113", "S114", "S115", "S116", "S117", "S118", "S119", "S120", "S121", "S122", "S123"]) {
    requirePattern(`${sprint} evidence table coverage`, decision, new RegExp(`\\|[^\\n|]*${sprint}[^\\n|]*\\|`));
  }

  for (const [label, pattern] of [
    ["pass status", /\|[^\n|]*\bPass\b[^\n|]*\|/],
    ["partial status", /\|[^\n|]*\bPartial\b[^\n|]*\|/],
    ["blocked status", /\|[^\n|]*\bBlocked\b[^\n|]*\|/],
    ["overall decision status", /\*\*Overall decision status:\s*partial\.\*\*/i],
    ["authority evidence", /Authority registry/i],
    ["search evidence", /Explicit lexical search|Search selection/i],
    ["edit evidence", /Multi-file patch review|Explicit multi-file apply/i],
    ["verification evidence", /Verification bundles|Verification follow-up/i],
    ["privacy evidence", /raw sensitive persistence|privacy\/storage inventory|raw prompts/i],
    ["host evidence", /VS Code|Browser|JetBrains|host-owned/i],
    ["dogfood evidence", /Real-provider dogfood matrix|manual local BYOK/i],
    ["packaging evidence", /Packaged task-level beta gate|packaged VS Code install/i],
    ["residual risks", /Residual risk|Residual risks/i],
    ["next roadmap recommendation", /hardening next|Choose \*\*hardening\*\*/i],
    ["local-first BYOK boundary", /local BYOK|local-first BYOK/i],
    ["explicit non-goals", /explicit non-goals|Preserved non-goals/i]
  ]) {
    requirePattern(label, decision, pattern);
  }

  for (const forbidden of [
    ["ready for production overclaim", /\bready for production\b/i],
    ["production approval overclaim", /\bapproved for production\b/i],
    ["release approval overclaim", /\bapproved for release\b/i],
    ["marketplace approval overclaim", /\bapproved for marketplace\b/i],
    ["marketplace-ready overclaim", /\bmarketplace-ready\b/i],
    ["release-ready overclaim", /\brelease-ready\b/i],
    ["publication approval overclaim", /\bpublication approved\b/i],
    ["signing completion overclaim", /\bsigning (is )?complete\b/i],
    ["notarization completion overclaim", /\bnotarization (is )?complete\b/i]
  ]) {
    const [label, pattern] = forbidden;
    if (pattern.test(decision)) {
      failures.push(`Forbidden ${label} in ${decisionPath}: ${pattern}`);
    }
  }
}

if (docsIndex.length > 0) {
  requireIncludes(
    "docs index decision entry",
    docsIndex,
    "architecture/028-useful-multifile-controlled-agent-decision.md",
    docsIndexPath
  );
  requireIncludes(
    "docs index validator command",
    docsIndex,
    "npm run check:useful-multifile-agent-decision",
    docsIndexPath
  );
}

if (targetArchitecture.length > 0) {
  requirePattern(
    "target architecture S124 status",
    targetArchitecture,
    /S124 useful multi-file controlled agent decision/i,
    targetArchitecturePath
  );
  requirePattern(
    "target architecture hardening recommendation",
    targetArchitecture,
    /hardening remains the next roadmap lane/i,
    targetArchitecturePath
  );
  requirePattern(
    "target architecture no release overclaim",
    targetArchitecture,
    /does not approve production, release, marketplace publication, signing, notarization, broader autonomy, hidden search, or unattended repair/i,
    targetArchitecturePath
  );
}

if (failures.length > 0) {
  console.error("Useful multi-file controlled agent decision validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Useful multi-file controlled agent decision validation passed.");
