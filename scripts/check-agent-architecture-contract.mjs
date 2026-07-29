import { readFile } from "node:fs/promises";

const ADR_PATH = "docs/architecture/040-agent-execution-and-architecture-discipline.md";
const CAPABILITY_TRUTH_PATH = "docs/architecture/041-current-capability-truth.md";

const REQUIRED_LINKS = new Map([
  ["AGENTS.md", ADR_PATH],
  ["docs/README.md", "architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/engine/README.md", "../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/gui/README.md", "../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/plugins/vscode/README.md", "../../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
  ["apps/plugins/jetbrains/README.md", "../../../docs/architecture/040-agent-execution-and-architecture-discipline.md"],
]);

const REQUIRED_CAPABILITY_LINKS = new Map([
  ["AGENTS.md", CAPABILITY_TRUTH_PATH],
  ["docs/README.md", "architecture/041-current-capability-truth.md"],
  ["apps/engine/README.md", "../../docs/architecture/041-current-capability-truth.md"],
  ["apps/gui/README.md", "../../docs/architecture/041-current-capability-truth.md"],
  ["apps/plugins/vscode/README.md", "../../../docs/architecture/041-current-capability-truth.md"],
  ["apps/plugins/jetbrains/README.md", "../../../docs/architecture/041-current-capability-truth.md"],
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
const CAPABILITY_STATUSES = ["live_engine", "live_host", "local_derived", "fixture_demo", "unsupported"];
const REQUIRED_CAPABILITY_SECTIONS = ["Context", "Decision", "Canonical capability matrix", "Host matrix", "Evidence and claim rules", "Non-goals", "Verification", "Consequences"];
const REQUIRED_CAPABILITY_ROWS = [
  "projects",
  "project_command_center",
  "providers_auth",
  "provider_capability_metadata",
  "chat_sse_history",
  "memory",
  "progress_endpoint",
  "progress_population",
  "controlled_read",
  "controlled_search",
  "controlled_edit",
  "controlled_multifile",
  "controlled_verification_run",
  "controlled_run_state",
  "controlled_recovery",
  "controlled_transcript",
  "lsp",
  "packaging",
];
const REQUIRED_HOST_ROWS = ["Projects and Command Center", "Provider setup and chat", "Project memory", "Progress display", "Progress lifecycle population", "Controlled read", "Controlled lexical search", "Confirmed single-file edit", "Controlled multi-file apply", "Controlled verification/run", "Controlled run UI", "Controlled recovery UI", "Controlled transcript/export", "LSP client", "Installable packaging"];

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

  const capabilityTruth = files.get(CAPABILITY_TRUTH_PATH);
  if (typeof capabilityTruth !== "string") {
    errors.push(`Missing ${CAPABILITY_TRUTH_PATH}`);
  } else {
    if (!capabilityTruth.includes("- Status: accepted")) {
      errors.push(`${CAPABILITY_TRUTH_PATH} must declare Status: accepted`);
    }
    for (const section of REQUIRED_CAPABILITY_SECTIONS) {
      if (!hasMarkdownSection(capabilityTruth, section)) {
        errors.push(`${CAPABILITY_TRUTH_PATH} is missing section: ${section}`);
      }
    }
    for (const status of CAPABILITY_STATUSES) {
      if (!capabilityTruth.includes(`\`${status}\``)) {
        errors.push(`${CAPABILITY_TRUTH_PATH} is missing capability status: ${status}`);
      }
    }
    for (const row of REQUIRED_CAPABILITY_ROWS) {
      if (!capabilityTruth.includes(`| \`${row}\` |`)) {
        errors.push(`${CAPABILITY_TRUTH_PATH} is missing capability row: ${row}`);
      }
    }
    for (const hostRow of REQUIRED_HOST_ROWS) {
      if (!capabilityTruth.includes(`| ${hostRow} |`)) {
        errors.push(`${CAPABILITY_TRUTH_PATH} is missing host row: ${hostRow}`);
      }
    }
    for (const phrase of ["fixtures", "developer", "experimental", "dev-preview", "non-production", "authoritative code path", "strongest focused evidence"]) {
      if (!capabilityTruth.toLowerCase().includes(phrase)) {
        errors.push(`${CAPABILITY_TRUTH_PATH} is missing required truth qualifier: ${phrase}`);
      }
    }
  }

  for (const [file, link] of REQUIRED_CAPABILITY_LINKS) {
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
  const paths = [ADR_PATH, CAPABILITY_TRUTH_PATH, ...new Set([...REQUIRED_LINKS.keys(), ...REQUIRED_CAPABILITY_LINKS.keys()]), "scripts/check.mjs"];
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
  expectFailure(
    files,
    (candidate) => candidate.set(CAPABILITY_TRUTH_PATH, candidate.get(CAPABILITY_TRUTH_PATH).replace("| `progress_population` |", "| `progress_source_removed` |")),
    "missing capability row: progress_population",
  );
  expectFailure(
    files,
    (candidate) => candidate.set(CAPABILITY_TRUTH_PATH, candidate.get(CAPABILITY_TRUTH_PATH).replaceAll("`fixture_demo`", "fixture demo")),
    "missing capability status: fixture_demo",
  );
  expectFailure(
    files,
    (candidate) => candidate.set("apps/plugins/vscode/README.md", candidate.get("apps/plugins/vscode/README.md").replace(REQUIRED_CAPABILITY_LINKS.get("apps/plugins/vscode/README.md"), "missing-capability-truth-link")),
    "apps/plugins/vscode/README.md must link",
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
