import { readFile } from "node:fs/promises";

const ADR_PATH = "docs/architecture/040-agent-execution-and-architecture-discipline.md";

const REQUIRED_LINKS = new Map([
  ["AGENTS.md", ADR_PATH],
  ["docs/README.md", "architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/engine/README.md", "../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/gui/README.md", "../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/plugins/vscode/README.md", "../../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/plugins/jetbrains/README.md", "../../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
]);

const REQUIRED_SECTIONS = [
  "Context",
  "Decision",
  "Required-reading matrix",
  "Task and card traceability",
  "Implementation and evidence vocabulary",
  "Verification tiers",
  "Self-verification and handoff",
  "Review and fix gates",
  "Public-metadata safety",
  "Enforcement and limitations",
  "Consequences",
];

const IMPLEMENTATION_STATUSES = ["implemented", "partial", "planned", "unsupported"];
const EVIDENCE_STATUSES = ["verified", "agent_reported", "not_run", "failed"];
const VERIFICATION_TIERS = ["tier_0", "tier_1", "tier_2", "tier_3"];
const REQUIRED_ADR_REFERENCES = [
  "docs/architecture/001-product-identity.md",
  "docs/architecture/003-target-architecture.md",
  "docs/architecture/004-implementation-strategy.md",
  "docs/architecture/005-publication-hygiene.md",
  "product/identity.json",
];

function hasMarkdownSection(text, heading) {
  return text.split("\n").some((line) => line.trim() === `## ${heading}`);
}

export function validateAgentArchitectureContract(files) {
  const errors = [];
  const adr = files.get(ADR_PATH);

  if (typeof adr !== "string") {
    return [`Missing ${ADR_PATH}`];
  }

  if (!adr.includes("- Status: accepted")) {
    errors.push(`${ADR_PATH} must declare Status: accepted`);
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!hasMarkdownSection(adr, section)) {
      errors.push(`${ADR_PATH} is missing section: ${section}`);
    }
  }

  for (const reference of REQUIRED_ADR_REFERENCES) {
    if (!adr.includes(reference)) {
      errors.push(`${ADR_PATH} is missing required architecture reference: ${reference}`);
    }
  }

  for (const status of [...IMPLEMENTATION_STATUSES, ...EVIDENCE_STATUSES]) {
    if (!adr.includes(`\`${status}\``)) {
      errors.push(`${ADR_PATH} is missing status vocabulary: ${status}`);
    }
  }

  for (const tier of VERIFICATION_TIERS) {
    if (!adr.includes(`| \`${tier}\` |`)) {
      errors.push(`${ADR_PATH} is missing verification tier: ${tier}`);
    }
  }

  const requiredPolicyPhrases = [
    "local-first BYOK",
    "deny-by-default",
    "Documentation cannot prove",
    "explicit card context",
    "diff review",
    "code review",
    "public product surfaces",
  ];
  for (const phrase of requiredPolicyPhrases) {
    if (!adr.includes(phrase)) {
      errors.push(`${ADR_PATH} is missing required policy text: ${phrase}`);
    }
  }

  for (const [file, link] of REQUIRED_LINKS) {
    const text = files.get(file);
    if (typeof text !== "string") {
      errors.push(`Missing guidance file: ${file}`);
    } else if (!text.includes(link)) {
      errors.push(`${file} must link to ${link}`);
    }
  }

  const checkScript = files.get("scripts/check.mjs");
  if (typeof checkScript !== "string" || !checkScript.includes("scripts/check-agent-architecture-contract.mjs")) {
    errors.push("scripts/check.mjs must invoke scripts/check-agent-architecture-contract.mjs");
  }

  return errors;
}

async function loadRepositoryFiles() {
  const paths = [ADR_PATH, ...REQUIRED_LINKS.keys(), "scripts/check.mjs"];
  return new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path, "utf8")])));
}

function expectFailure(files, mutate, expectedFragment) {
  const candidate = new Map(files);
  mutate(candidate);
  const errors = validateAgentArchitectureContract(candidate);
  if (!errors.some((error) => error.includes(expectedFragment))) {
    throw new Error(`Self-test expected failure containing ${JSON.stringify(expectedFragment)}, received: ${errors.join("; ")}`);
  }
}

async function runSelfTest() {
  const files = await loadRepositoryFiles();
  const baselineErrors = validateAgentArchitectureContract(files);
  if (baselineErrors.length > 0) {
    throw new Error(`Compliant baseline failed: ${baselineErrors.join("; ")}`);
  }

  expectFailure(
    files,
    (candidate) => candidate.set(ADR_PATH, candidate.get(ADR_PATH).replace("## Review and fix gates", "## Review gates removed")),
    "missing section: Review and fix gates",
  );
  expectFailure(
    files,
    (candidate) => candidate.set("apps/gui/README.md", candidate.get("apps/gui/README.md").replace(REQUIRED_LINKS.get("apps/gui/README.md"), "missing-adr-link")),
    "apps/gui/README.md must link",
  );
  expectFailure(
    files,
    (candidate) => candidate.set(ADR_PATH, candidate.get(ADR_PATH).replaceAll("`agent_reported`", "agent reported")),
    "missing status vocabulary: agent_reported",
  );
  expectFailure(
    files,
    (candidate) => candidate.set(ADR_PATH, candidate.get(ADR_PATH).replace("| `tier_2` |", "| tier two |")),
    "missing verification tier: tier_2",
  );

  console.log("Agent architecture contract self-test passed.");
}

async function main() {
  if (process.argv.slice(2).includes("--self-test")) {
    await runSelfTest();
    return;
  }

  const errors = validateAgentArchitectureContract(await loadRepositoryFiles());
  if (errors.length > 0) {
    console.error("Agent architecture contract validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Agent architecture contract validation passed.");
}

await main();
