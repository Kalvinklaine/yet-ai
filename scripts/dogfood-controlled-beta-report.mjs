import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const maxReportBytes = 256 * 1024;

const template = `# Yet AI Controlled Dev-Preview Beta Dogfood Report

Manual local dev-preview evidence only. This report is not CI evidence, not production autonomy evidence, not release evidence, not marketplace evidence, not real-provider CI evidence, and not a publication gate. Keep untested fields as \`not run\`. Do not paste secrets, raw prompts, raw file bodies, raw diffs, raw commands or stdout, private paths, provider payloads, bridge payload dumps, hosted backend/account/credit requirements, or hidden authority claims.

## Run metadata

- Commit/artifact label: <git commit or sanitized artifact family/name | local dev checkout | not run>
- Host: <VS Code | Browser preview-only | JetBrains partial/fail-closed | not run>
- Runtime status: <connected | unavailable with sanitized summary | not run>
- Provider path: <local BYOK configured | local mock/provider omitted | not run>
- Scope: controlled dev-preview beta dogfood only; local-first, explicit-user-start, no production autonomy, release, marketplace, hosted backend, account, credit, or real-provider CI claim

## Controlled run evidence

- Start control: <user clicked Start explicitly | blocked | not run>
- Stop control: <visible and user-owned | used with sanitized stopped status | not run>
- Read boundary: <one selected safe workspace-relative text label | skipped | blocked | not run>
- Edit boundary: <one bounded replacement metadata label | skipped | blocked | not run>
- Verification boundary: <one allowlisted command-id label | skipped | blocked | not run>
- Repair boundary: <unused | one user-confirmed attempt | exhausted | blocked | not run>

## Sanitized evidence checklist

- Secrets absent: <checked | issue fixed before sharing | not run>
- Raw prompts/file bodies/diffs/replacement text absent: <checked | issue fixed before sharing | not run>
- Raw commands/stdout/cwd/env absent: <checked | issue fixed before sharing | not run>
- Private paths and provider payloads absent: <checked | issue fixed before sharing | not run>
- Bridge payload dumps and browser storage dumps absent: <checked | issue fixed before sharing | not run>
- Hidden reads/search/indexing/background authority absent: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement absent: <checked | issue fixed before sharing | not run>
- Production autonomy, release, marketplace, publication, signing, notarization, and real-provider CI claims absent: <checked | issue fixed before sharing | not run>

## Result

- Result status: <completed with sanitized summary | stopped | failed closed | blocked | not run>
- Known issues: <sanitized issue list or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
`;

const requiredPatterns = [
  ["top-level heading", /^# Yet AI Controlled Dev-Preview Beta Dogfood Report$/m],
  ["manual local dev-preview warning", /Manual local dev-preview evidence only/],
  ["not CI warning", /not CI evidence/],
  ["not production autonomy warning", /not production autonomy evidence/],
  ["not release warning", /not release evidence/],
  ["not marketplace warning", /not marketplace evidence/],
  ["not real-provider CI warning", /not real-provider CI evidence/],
  ["run metadata heading", /^## Run metadata$/m],
  ["commit artifact label field", /- Commit\/artifact label:/],
  ["host field", /- Host:/],
  ["runtime status field", /- Runtime status:/],
  ["provider path field", /- Provider path:/],
  ["scope field", /- Scope:/],
  ["controlled run evidence heading", /^## Controlled run evidence$/m],
  ["start control field", /- Start control:/],
  ["stop control field", /- Stop control:/],
  ["read boundary field", /- Read boundary:/],
  ["edit boundary field", /- Edit boundary:/],
  ["verification boundary field", /- Verification boundary:/],
  ["repair boundary field", /- Repair boundary:/],
  ["sanitized evidence checklist heading", /^## Sanitized evidence checklist$/m],
  ["secrets check", /- Secrets absent:/],
  ["raw prompts file bodies diffs check", /- Raw prompts\/file bodies\/diffs\/replacement text absent:/],
  ["raw commands stdout cwd env check", /- Raw commands\/stdout\/cwd\/env absent:/],
  ["private paths provider payloads check", /- Private paths and provider payloads absent:/],
  ["bridge browser storage check", /- Bridge payload dumps and browser storage dumps absent:/],
  ["hidden authority check", /- Hidden reads\/search\/indexing\/background authority absent:/],
  ["hosted requirements check", /- Hosted Yet AI backend\/account\/managed gateway\/product credit\/cloud workspace requirement absent:/],
  ["production release marketplace claims check", /- Production autonomy, release, marketplace, publication, signing, notarization, and real-provider CI claims absent:/],
  ["result heading", /^## Result$/m],
  ["result status field", /- Result status:/],
  ["known issues field", /- Known issues:/],
  ["explicit not run values", /not run/]
];

const releaseClaimPattern = new RegExp(
  `\\b(?:${[
    ["production", "ready"].join("-"),
    ["release", "ready"].join("-"),
    ["marketplace", "ready"].join("-"),
    "ready\\s+for\\s+production",
    "ready\\s+for\\s+release",
    "ready\\s+for\\s+marketplace",
    "publishable\\s+release",
    "publication\\s+approved",
    "shipping\\s+candidate"
  ].join("|")})\\b`,
  "i"
);

const unsafeChecks = [
  ["provider API keys", /\bsk-(?:proj-)?[A-Za-z0-9_\-]{8,}\b|\b(?:api[_-]?key|apikey|provider[_-]?key|openai[_-]?key|secret[_-]?key)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["bearer tokens", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+)/i],
  ["auth codes and OAuth tokens", /\b(?:auth[_-]?code|authorization[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|pkce[_-]?verifier|code[_-]?verifier)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["cookies", /\b(?:Cookie|Set-Cookie)\s*:\s*\S+|\bcookie\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["runtime tokens", /\b(?:YET_AI_AUTH_TOKEN|session[_ -]?token|runtime[_ -]?token)\b\s*[:=]\s*[^\s<][^\r\n]*|\blocal-dev-token\b/i],
  ["private paths", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._ -]+\/|\/(?:var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+\/|\b[A-Za-z]:\\[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["secret URL query or fragment values", /[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=/i],
  ["raw prompts", /\b(?:raw\s+prompt|prompt\s+dump|verbatim\s+prompt|full\s+prompt\s+text)\b\s*[:=]/i],
  ["raw file bodies", /\b(?:file\s+contents?|source\s+contents?|document\s+contents?|full\s+file\s+text|raw\s+file\s+body|verbatim\s+source)\b\s*[:=]/i],
  ["raw diffs", /\b(?:raw\s+diff|diff\s+dump|patch\s+body|raw\s+patch|patch\s+dump|verbatim\s+diff|replacement\s+text)\b\s*[:=]/i],
  ["raw commands or stdout", /\b(?:command\s*[:=]\s*[^\s<][^\r\n]*|stdout\s*[:=]\s*[^\s<][^\r\n]*|stderr\s*[:=]\s*[^\s<][^\r\n]*|terminal\s+output\s*[:=]\s*[^\s<][^\r\n]*|cwd\s*[:=]\s*[^\s<][^\r\n]*|env\s*[:=]\s*[^\s<][^\r\n]*|process\.env)/i],
  ["provider payloads", /\b(?:provider\s+payload|provider\s+request|provider\s+response|provider\s+json|completion\s+response)\b\s*[:=]/i],
  ["browser-storage dumps", /\b(?:localStorage|sessionStorage|indexedDB|browser\s+storage\s+dump|storage\s+dump|workspace\s+storage\s+dump)\b\s*[:=]/i],
  ["bridge payload dumps", /\b(?:raw\s+bridge\s+payload|bridge\s+payload\s+dump|bridge\s+payload|request\s+body|raw\s+request)\b\s*[:=]/i],
  ["hosted backend/account/credit requirements", /\b(?:requires?|must\s+use|needs?)\s+(?:a\s+)?(?:hosted\s+Yet\s+AI\s+backend|Yet\s+AI\s+account|managed\s+model\s+gateway|product\s+credits?|cloud\s+workspace)\b/i],
  ["release or marketplace claims", releaseClaimPattern],
  ["hidden authority claims", /\b(?:hidden\s+authority\s*[:=]|hidden\s+reads?\s*[:=]|background\s+reads?\s*[:=]|workspace\s+indexing\s*[:=]|automatic\s+workspace\s+search\s*[:=]|unbounded\s+authority\s*[:=])/i]
];

const args = process.argv.slice(2);

if (args.length === 0) {
  runDefaultCheck();
  process.exit(0);
}

if (args.includes("--help")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--template")) {
  process.stdout.write(template);
  process.exit(0);
}

if (args.includes("--check-template")) {
  exitWithValidation("built-in template", validateTemplate(template));
  process.exit(0);
}

if (args.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const checkIndex = args.indexOf("--check");
if (checkIndex !== -1) {
  const reportPath = args[checkIndex + 1];
  if (reportPath === undefined || reportPath.startsWith("--")) {
    console.error("Missing path for --check.");
    process.exit(1);
  }
  const text = await readBoundedReport(reportPath);
  exitWithValidation(reportPath, validateTemplate(text));
  process.exit(0);
}

console.error(`Unknown argument(s): ${args.join(" ")}`);
printHelp();
process.exit(1);

function validateTemplate(text) {
  const failures = validateSafeText(text);
  for (const [name, pattern] of requiredPatterns) {
    if (!pattern.test(text)) {
      failures.push(`missing required ${name}`);
    }
  }
  return failures;
}

function validateSafeText(text) {
  const failures = [];
  for (const [category, pattern] of unsafeChecks) {
    if (pattern.test(text)) {
      failures.push(`unsafe ${category}`);
    }
  }
  return failures;
}

async function readBoundedReport(reportPath) {
  const resolved = path.resolve(process.cwd(), reportPath);
  const fileStat = await stat(resolved).catch((error) => {
    console.error(`Could not read report: ${error?.code === "ENOENT" ? "file not found" : "stat failed"}.`);
    process.exit(1);
  });
  if (!fileStat.isFile()) {
    console.error("Could not read report: path is not a file.");
    process.exit(1);
  }
  if (fileStat.size > maxReportBytes) {
    console.error(`Could not read report: file exceeds ${maxReportBytes} byte safety limit.`);
    process.exit(1);
  }
  return readFile(resolved, "utf8");
}

function exitWithValidation(label, failures) {
  if (failures.length === 0) {
    console.log(`${label} is sanitized and valid.`);
    return;
  }
  console.error(`${label} failed controlled dev-preview beta dogfood report validation:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function runDefaultCheck() {
  const failures = [];
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  failures.push(...selfTestFailures());
  exitWithValidation("default controlled beta report check", failures);
}

function runSelfTest() {
  const failures = selfTestFailures();
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  exitWithValidation("self-test", failures);
}

function selfTestFailures() {
  const unsafeSamples = [
    ["provider API keys", "api_key=redacted-example-key"],
    ["provider API keys", "sk-redactedexample123456"],
    ["bearer tokens", "Authorization: Bearer redacted-example-token"],
    ["auth codes and OAuth tokens", "authorization_code=redacted-example-code"],
    ["auth codes and OAuth tokens", "refresh_token=redacted-example-token"],
    ["cookies", "Cookie: sid=redacted"],
    ["runtime tokens", "runtime token: redacted-example-token"],
    ["private paths", "/Users/example/project/report.md"],
    ["private paths", "C:\\Users\\example\\report.md"],
    ["secret URL query or fragment values", "http://127.0.0.1/callback?code=redacted"],
    ["raw prompts", "raw prompt: implement the feature"],
    ["raw file bodies", "file contents: const value = 1;"],
    ["raw diffs", "raw diff: @@ -1 +1"],
    ["raw diffs", "replacement text: new body"],
    ["raw commands or stdout", "command: npm test"],
    ["raw commands or stdout", "stdout: full output"],
    ["raw commands or stdout", "cwd=/Users/example/project"],
    ["raw commands or stdout", "env=TOKEN=redacted"],
    ["provider payloads", "provider payload: {}"],
    ["browser-storage dumps", "localStorage: { token: redacted }"],
    ["bridge payload dumps", "bridge payload: { action: send }"],
    ["hosted backend/account/credit requirements", "requires hosted Yet AI backend"],
    ["hosted backend/account/credit requirements", "must use Yet AI account"],
    ["hosted backend/account/credit requirements", "needs product credits"],
    ["release or marketplace claims", ["production", "ready"].join("-")],
    ["release or marketplace claims", ["ready", "for", "marketplace"].join(" ")],
    ["hidden authority claims", "hidden reads: enabled"],
    ["hidden authority claims", "workspace indexing: enabled"]
  ];
  const validSanitizedExample = template
    .replace("<git commit or sanitized artifact family/name | local dev checkout | not run>", "local dev checkout")
    .replace("<VS Code | Browser preview-only | JetBrains partial/fail-closed | not run>", "VS Code")
    .replace("<connected | unavailable with sanitized summary | not run>", "connected")
    .replace("<local BYOK configured | local mock/provider omitted | not run>", "local mock/provider omitted")
    .replace("<user clicked Start explicitly | blocked | not run>", "user clicked Start explicitly")
    .replace("<visible and user-owned | used with sanitized stopped status | not run>", "visible and user-owned")
    .replace("<one selected safe workspace-relative text label | skipped | blocked | not run>", "one selected safe workspace-relative text label")
    .replace("<one bounded replacement metadata label | skipped | blocked | not run>", "one bounded replacement metadata label")
    .replace("<one allowlisted command-id label | skipped | blocked | not run>", "one allowlisted command-id label")
    .replace("<unused | one user-confirmed attempt | exhausted | blocked | not run>", "unused")
    .replaceAll("<checked | issue fixed before sharing | not run>", "checked")
    .replace("<completed with sanitized summary | stopped | failed closed | blocked | not run>", "completed with sanitized summary")
    .replace("<sanitized issue list or none | not run>", "none")
    .replace("<sanitized follow-up summary or none | not run>", "none");
  const failures = [];
  const validExampleFailures = validateTemplate(validSanitizedExample);
  if (validExampleFailures.length > 0) {
    failures.push(...validExampleFailures.map((failure) => `valid sanitized example ${failure}`));
  }
  for (const [category, sample] of unsafeSamples) {
    const result = validateSafeText(sample);
    if (!result.some((failure) => failure.includes(category))) {
      failures.push(`self-test did not reject ${category}`);
    }
  }
  return failures;
}

function printHelp() {
  console.log(`Usage:
  npm run dogfood:controlled-beta-report
  npm run dogfood:controlled-beta-report -- --template
  npm run dogfood:controlled-beta-report -- --check-template
  npm run dogfood:controlled-beta-report -- --check path/to/report.md
  npm run dogfood:controlled-beta-report -- --self-test

Generates or checks sanitized manual local controlled dev-preview beta dogfood evidence. It never calls providers, launches runtimes, contacts networks, writes reports by default, or proves production autonomy, release, marketplace, hosted-service, account, credit, hidden-authority, or real-provider CI readiness.`);
}
