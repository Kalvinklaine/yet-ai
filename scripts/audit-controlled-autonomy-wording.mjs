import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

const docsAllowlist = [
  "docs/README.md",
  "docs/architecture/003-target-architecture.md",
  "docs/architecture/010-tool-authority-and-edit-pipeline-roadmap.md",
  "docs/architecture/011-sandbox-agent-prerequisites.md",
  "docs/architecture/012-coding-session-trace.md",
  "docs/architecture/013-agent-readiness-milestone.md",
  "docs/dogfood/agent-run-one-step.md",
  "docs/dogfood/manual-agent-run-rc.md",
  "docs/dogfood/one-step-agent-run.md",
  "docs/dogfood/s88-useful-autonomy-matrix.md",
  "docs/dogfood/s90-controlled-autonomy-readiness.md",
  "docs/dogfood/s91-controlled-agent-dev-preview.md",
  "docs/dogfood/fixtures/controlled-agent-dev-preview/README.md",
  "apps/gui/README.md",
  "apps/gui/src/components/AgentRunPanel.tsx",
  "apps/gui/src/components/ControlledAgentRunPanel.tsx",
  "apps/gui/src/services/controlledAgentDevPreviewReport.ts"
];

const boundaryAllow = /\b(?:not|no|never|without|blocked|deferred|future|must\s+not|do\s+not|does\s+not|did\s+not|cannot|can't|is\s+not|are\s+not|remains?\s+unimplemented|unavailable|unsupported|deny[- ]only|invalid|reject(?:s|ed)?|disable(?:d|s)?|forbid(?:s|ding)?|prohibit(?:s|ed|ing)?|adds\s+no|grant\s+no|grants\s+no|must\s+not\s+claim|do\s+not\s+report|do\s+not\s+use|must\s+not\s+be\s+reported|not\s+claimed|are\s+not\s+claimed|does\s+not\s+claim|does\s+not\s+approve|no\s+.*claim)\b/i;
const qualifiedClaimAllow = /\b(?:bounded|dev-preview|manual|explicit|user[- ](?:confirmed|owned|controlled|started)|local\/mock|mock|preview-only|metadata-only|experimental|allowlisted|sanitized|fail[- ]closed|unsupported|one[- ]step|one\s+(?:selected|bounded|allowlisted|user-confirmed)|trusted\s+workspace\s+execution)\b/i;

const unsafeRules = [
  {
    name: "production-autonomous-agent",
    pattern: /\bproduction[- ](?:ready\s+)?autonomous\s+(?:coding\s+)?agent\b/i,
    allow: boundaryAllow
  },
  {
    name: "production-ready-autonomy",
    pattern: /\bproduction[- ]ready\s+(?:controlled[- ]?)?autonomy\b/i,
    allow: boundaryAllow
  },
  {
    name: "production-autonomy",
    pattern: /\bproduction\s+(?:controlled[- ]?)?autonomy\b/i,
    allow: boundaryAllow
  },
  {
    name: "fully-autonomous",
    pattern: /\bfully\s+autonomous\b/i,
    allow: boundaryAllow
  },
  {
    name: "unqualified-autonomous-agent",
    pattern: /\bautonomous\s+(?:coding\s+)?agent\b/i,
    allow: new RegExp(`${boundaryAllow.source}|${qualifiedClaimAllow.source}`, "i")
  },
  {
    name: "marketplace publication overclaim",
    pattern: /\bmarketplace[- ]ready\b|\bready\s+for\s+(?:the\s+)?marketplace\b/i,
    allow: boundaryAllow
  },
  {
    name: "release publication overclaim",
    pattern: /\brelease[- ]ready\b|\bready\s+for\s+release\b/i,
    allow: boundaryAllow
  },
  {
    name: "real-provider-ci-proves-autonomy",
    pattern: /\breal[- ]provider\s+CI\s+(?:proves|validates|certifies|approves)\s+(?:controlled[- ]?)?autonomy\b/i,
    allow: boundaryAllow
  },
  {
    name: "automatic-repair",
    pattern: /\bautomatic\s+repair\b|\bauto[- ]repair\b/i,
    allow: boundaryAllow
  },
  {
    name: "hidden-reads",
    pattern: /\bhidden\s+(?:workspace\s+)?reads?\b|\bhidden\s+file\s+reads?\b/i,
    allow: boundaryAllow
  },
  {
    name: "arbitrary-commands",
    pattern: /\barbitrary\s+(?:runtime\s+)?commands?\b|\barbitrary\s+command\s+execution\b/i,
    allow: boundaryAllow
  },
  {
    name: "unqualified-runs-commands",
    pattern: /\b(?:runs|executes?)\s+commands?\b/i,
    allow: new RegExp(`${boundaryAllow.source}|${qualifiedClaimAllow.source}`, "i")
  },
  {
    name: "unqualified-reads-workspace",
    pattern: /\breads?\s+(?:the\s+)?workspace\b/i,
    allow: new RegExp(`${boundaryAllow.source}|${qualifiedClaimAllow.source}`, "i")
  },
  {
    name: "fixes-automatically",
    pattern: /\bfix(?:es)?\s+automatically\b|\bautomatically\s+fix(?:es)?\b/i,
    allow: boundaryAllow
  }
];

const safeSelfTestSamples = [
  "S86 is not production autonomy and grants no automatic repair.",
  "The flow has no hidden reads, no arbitrary commands, and no marketplace-ready claim.",
  "Future production autonomy remains deferred until a later approved gate.",
  "Do not report this as release ready or real-provider CI proves autonomy.",
  "The dev-preview controlled agent runs commands only by allowlisted command id after explicit user confirmation.",
  "The bounded flow reads the workspace only through one selected safe workspace-relative text file."
];

const unsafeSelfTestSamples = [
  "Yet AI is a production autonomous agent for coding tasks.",
  "The controlled runner is production-ready autonomy.",
  "The agent is fully autonomous across the workspace.",
  "The package is marketplace ready after this smoke.",
  "The build is release ready for users.",
  "Real-provider CI proves autonomy for Agent Run.",
  "Automatic repair fixes failing verification.",
  "The agent performs hidden reads for context.",
  "The runner can execute arbitrary commands.",
  "Yet AI is an autonomous agent for coding tasks.",
  "The agent runs commands for the user.",
  "The agent reads the workspace before fixing code.",
  "Yet AI fixes automatically after tests fail."
];

function splitSentences(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const entries = [];
  const contextLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    const contextPrefix = contextLines.slice(-8).join(" ");
    const parts = line.split(/(?<=[.!?])\s+/u).filter(Boolean);
    for (const part of parts) {
      entries.push({ line: index + 1, text: part, context: `${contextPrefix} ${part}`.trim() });
    }
    contextLines.push(line);
  }

  return entries;
}

function auditText(text, label) {
  const violations = [];
  for (const entry of splitSentences(text)) {
    for (const rule of unsafeRules) {
      if (!rule.pattern.test(entry.text)) {
        continue;
      }
      if (rule.allow.test(entry.context)) {
        continue;
      }
      violations.push({ label, line: entry.line, rule: rule.name, text: entry.text });
    }
  }
  return violations;
}

function runSelfTest() {
  const safeViolations = safeSelfTestSamples.flatMap((sample, index) => auditText(sample, `safe-self-test-${index + 1}`));
  if (safeViolations.length > 0) {
    return {
      ok: false,
      message: "Controlled autonomy wording audit self-test rejected safe boundary copy.",
      violations: safeViolations
    };
  }

  const missed = [];
  for (let index = 0; index < unsafeSelfTestSamples.length; index += 1) {
    const sample = unsafeSelfTestSamples[index];
    const violations = auditText(sample, `unsafe-self-test-${index + 1}`);
    if (violations.length === 0) {
      missed.push({ label: `unsafe-self-test-${index + 1}`, text: sample });
    }
  }

  if (missed.length > 0) {
    return {
      ok: false,
      message: "Controlled autonomy wording audit self-test missed unsafe overclaim samples.",
      violations: missed
    };
  }

  return { ok: true, message: "self-test passed" };
}

function printViolations(title, violations) {
  console.error(title);
  for (const violation of violations) {
    const location = violation.line ? `${violation.label}:${violation.line}` : violation.label;
    console.error(`- ${location} [${violation.rule ?? "missed"}] ${violation.text}`);
  }
}

const selfTest = runSelfTest();
if (!selfTest.ok) {
  printViolations(selfTest.message, selfTest.violations);
  process.exit(1);
}

const violations = [];
for (const docPath of docsAllowlist) {
  const absolutePath = resolve(root, docPath);
  const text = readFileSync(absolutePath, "utf8");
  violations.push(...auditText(text, relative(root, absolutePath)));
}

if (violations.length > 0) {
  printViolations("Controlled autonomy wording audit failed.", violations);
  process.exit(1);
}

console.log(`Controlled autonomy wording audit passed for ${docsAllowlist.length} docs with ${unsafeRules.length} rules.`);
