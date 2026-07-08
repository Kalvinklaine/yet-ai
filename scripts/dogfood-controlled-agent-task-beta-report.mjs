import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const maxReportBytes = 256 * 1024;
const template = `# Controlled Agent Task-Level Beta Gate

S123 packaged VS Code task-level beta gate. Manual local dev-preview evidence only. This report is not CI evidence, not packaged automation evidence, not production autonomy evidence, not release evidence, not marketplace evidence, not real-provider CI evidence, and not a publication gate. Keep untested fields as \`not run\`. Do not paste secrets, raw prompts, raw responses, raw file bodies, raw diffs, raw replacement text, raw commands, stdout, stderr, cwd, env, private paths, provider payloads, bridge payload dumps, browser storage dumps, hosted backend/account/gateway/credit/cloud workspace requirements, hidden authority claims, production claims, release claims, marketplace claims, signing claims, notarization claims, or publication claims.

## Run metadata

- Artifact label: <packaged VS Code dev-preview artifact family/name | local dev checkout | not run>
- Host: <VS Code packaged dev-preview | Browser preview-only unsupported | JetBrains partial fail-closed | not run>
- Date label: <YYYY-MM-DD or sanitized sprint label | not run>
- Runtime/provider family: <plugin-managed local runtime with BYOK provider family | local model runtime family | provider omitted | not run>
- Scope: task-level controlled-agent dev-preview beta gate only; no hosted Yet AI backend, account, managed model gateway, product credit, cloud workspace, production autonomy, release, marketplace, publication, signing, notarization, or real-provider CI claim

## Task-level gate checklist

- Task preset selected: <fix-small-bug | add-focused-test | refactor-small-function | explain-selected-code | improve-copy-or-typing | not run>
- Explicit context/search selected: <context selected | search selected | context and search selected | blocked with sanitized reason | not run>
- Provider proposal received/reviewed: <proposal reviewed | proposal rejected safely | provider unavailable | not run>
- Multi-file patch plan reviewed: <plan reviewed | blocked by policy | read-only preset no patch | not run>
- Explicit apply if safe: <explicit apply accepted | apply skipped | apply rejected | not applicable | not run>
- Verification bundle run: <allowlisted bundle passed | allowlisted bundle failed with sanitized summary | skipped | blocked | not run>
- Follow-up/recovery if needed: <none | recovery guidance shown | manual follow-up drafted | stopped | blocked with sanitized reason | not run>
- Sanitized final report/export/history evidence: <report checked | export checked | history checked | issue fixed before sharing | not run>

## Sanitized evidence checklist

- Secrets absent: <checked | issue fixed before sharing | not run>
- Raw prompts absent: <checked | issue fixed before sharing | not run>
- Raw responses absent: <checked | issue fixed before sharing | not run>
- Raw file bodies, diffs, and replacement text absent: <checked | issue fixed before sharing | not run>
- Raw commands, stdout, stderr, cwd, and env absent: <checked | issue fixed before sharing | not run>
- Private paths absent: <checked | issue fixed before sharing | not run>
- Provider payloads absent: <checked | issue fixed before sharing | not run>
- Bridge payload dumps absent: <checked | issue fixed before sharing | not run>
- Browser storage dumps absent: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement absent: <checked | issue fixed before sharing | not run>
- Hidden authority and automatic send/apply/verify/repair/retry/rollback claims absent: <checked | issue fixed before sharing | not run>
- Production, release, marketplace, publication, signing, notarization, and real-provider CI claims absent: <checked | issue fixed before sharing | not run>

## Result

- Result status: <useful | partially useful | blocked | stopped | failed closed | not run>
- Usefulness summary: <sanitized label counts or short safe summary | not run>
- Blockers: <sanitized blocker labels or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
`;

const requiredPatterns = [
  ["top-level heading", /^# Controlled Agent Task-Level Beta Gate$/m],
  ["S123 marker", /S123/],
  ["manual local dev-preview warning", /Manual local dev-preview evidence only/],
  ["not CI warning", /not CI evidence/],
  ["not packaged automation warning", /not packaged automation evidence/],
  ["not production autonomy warning", /not production autonomy evidence/],
  ["not release warning", /not release evidence/],
  ["not marketplace warning", /not marketplace evidence/],
  ["not real-provider CI warning", /not real-provider CI evidence/],
  ["not publication gate warning", /not a publication gate/],
  ["run metadata heading", /^## Run metadata$/m],
  ["artifact label field", /- Artifact label:/],
  ["host field", /- Host:/],
  ["runtime provider field", /- Runtime\/provider family:/],
  ["scope field", /- Scope:/],
  ["task-level gate checklist heading", /^## Task-level gate checklist$/m],
  ["task preset selected field", /- Task preset selected:/],
  ["explicit context search field", /- Explicit context\/search selected:/],
  ["provider proposal field", /- Provider proposal received\/reviewed:/],
  ["multi-file patch plan field", /- Multi-file patch plan reviewed:/],
  ["explicit apply field", /- Explicit apply if safe:/],
  ["verification bundle field", /- Verification bundle run:/],
  ["follow-up recovery field", /- Follow-up\/recovery if needed:/],
  ["final evidence field", /- Sanitized final report\/export\/history evidence:/],
  ["fix small bug preset", /fix-small-bug/],
  ["add focused test preset", /add-focused-test/],
  ["refactor small function preset", /refactor-small-function/],
  ["explain selected code preset", /explain-selected-code/],
  ["improve copy or typing preset", /improve-copy-or-typing/],
  ["sanitized evidence checklist heading", /^## Sanitized evidence checklist$/m],
  ["secrets check", /- Secrets absent:/],
  ["raw prompts check", /- Raw prompts absent:/],
  ["raw responses check", /- Raw responses absent:/],
  ["raw bodies diffs replacements check", /- Raw file bodies, diffs, and replacement text absent:/],
  ["raw command material check", /- Raw commands, stdout, stderr, cwd, and env absent:/],
  ["private paths check", /- Private paths absent:/],
  ["provider payloads check", /- Provider payloads absent:/],
  ["bridge dumps check", /- Bridge payload dumps absent:/],
  ["browser storage dumps check", /- Browser storage dumps absent:/],
  ["hosted requirements check", /- Hosted Yet AI backend\/account\/managed gateway\/product credit\/cloud workspace requirement absent:/],
  ["hidden authority check", /- Hidden authority and automatic send\/apply\/verify\/repair\/retry\/rollback claims absent:/],
  ["production claims check", /- Production, release, marketplace, publication, signing, notarization, and real-provider CI claims absent:/],
  ["result heading", /^## Result$/m],
  ["result status field", /- Result status:/],
  ["usefulness summary field", /- Usefulness summary:/],
  ["blockers field", /- Blockers:/],
  ["follow-up field", /- Follow-up needed:/],
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
    "shipping\\s+candidate",
    "production\\s+claim\\s*[:=]",
    "release\\s+claim\\s*[:=]",
    "marketplace\\s+claim\\s*[:=]",
    "signing\\s+approved",
    "notarization\\s+approved"
  ].join("|")})\\b`,
  "i"
);

const unsafeChecks = [
  ["provider API keys", /\bsk-(?:proj-)?[A-Za-z0-9_\-]{8,}\b|\b(?:api[_-]?key|apikey|provider[_-]?key|openai[_-]?key|anthropic[_-]?key|secret[_-]?key)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["bearer tokens", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+)/i],
  ["auth codes and OAuth tokens", /\b(?:auth[_-]?code|authorization[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|pkce[_-]?verifier|code[_-]?verifier)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["cookies", /\b(?:Cookie|Set-Cookie)\s*:\s*\S+|\bcookie\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["runtime tokens", /\b(?:YET_AI_AUTH_TOKEN|session[_ -]?token|runtime[_ -]?token)\b\s*[:=]\s*[^\s<][^\r\n]*|\blocal-dev-token\b/i],
  ["private paths", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._ -]+\/|\/(?:var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+\/|\b[A-Za-z]:\\[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["secret URL query or fragment values", /[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=/i],
  ["raw prompts", /\b(?:raw\s+prompts?|prompt\s+dump|verbatim\s+prompt|full\s+prompt\s+text)\b\s*[:=]/i],
  ["raw responses", /\b(?:raw\s+responses?|response\s+dump|provider\s+output\s+dump|verbatim\s+response|full\s+assistant\s+response|assistant\s+response\s+dump)\b\s*[:=]/i],
  ["raw file bodies", /\b(?:file\s+contents?|source\s+contents?|document\s+contents?|full\s+file\s+text|raw\s+file\s+body|verbatim\s+source)\b\s*[:=]/i],
  ["raw diffs or replacement text", /\b(?:raw\s+diff|diff\s+dump|patch\s+body|raw\s+patch|patch\s+dump|verbatim\s+diff|replacement\s+body|replacement\s+text)\b\s*[:=]/i],
  ["raw commands stdout cwd env", /\b(?:command\s*[:=]\s*[^\s<][^\r\n]*|stdout\s*[:=]\s*[^\s<][^\r\n]*|stderr\s*[:=]\s*[^\s<][^\r\n]*|terminal\s+output\s*[:=]\s*[^\s<][^\r\n]*|cwd\s*[:=]\s*[^\s<][^\r\n]*|env\s*[:=]\s*[^\s<][^\r\n]*|process\.env)/i],
  ["provider payloads", /\b(?:provider\s+payload|provider\s+request|provider\s+response|provider\s+json|completion\s+response|chat\s+completion\s+payload)\b\s*[:=]/i],
  ["bridge payload dumps", /\b(?:raw\s+bridge\s+payload|bridge\s+payload\s+dump|bridge\s+payload|postMessage\s+dump|request\s+body|raw\s+request)\b\s*[:=]/i],
  ["browser-storage dumps", /\b(?:localStorage|sessionStorage|indexedDB|browser\s+storage\s+dump|storage\s+dump|workspace\s+storage\s+dump)\b\s*[:=]/i],
  ["hosted backend/account/gateway requirements", /\b(?:requires?|must\s+use|needs?)\s+(?:a\s+)?(?:hosted\s+Yet\s+AI\s+backend|Yet\s+AI\s+account|managed\s+model\s+gateway|product\s+credits?|cloud\s+workspace)\b/i],
  ["hidden authority claims", /\b(?:hidden\s+authority\s*[:=]|hidden\s+reads?\s*[:=]|background\s+reads?\s*[:=]|workspace\s+indexing\s*[:=]|automatic\s+workspace\s+search\s*[:=]|auto\s*[- ]?(?:send|apply|verify|repair|retry|rollback)\s*[:=]|unbounded\s+authority\s*[:=])/i],
  ["release or marketplace claims", releaseClaimPattern],
  ["automation claims", /\b(?:real-provider\s+CI\s*[:=]|automated\s+real-provider\s+test\s*[:=]|CI\s+called\s+real\s+provider\s*[:=]|packaged\s+automation\s*[:=])/i]
];

const args = process.argv.slice(2);

if (args.length === 0) {
  await runDefaultCheck();
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
  await runSelfTest();
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
    if (!pattern.test(text)) failures.push(`missing required ${name}`);
  }
  return failures;
}

function validateSafeText(text) {
  const failures = [];
  for (const [category, pattern] of unsafeChecks) {
    if (pattern.test(text)) failures.push(`unsafe ${category}`);
  }
  return failures;
}

async function readBoundedReport(reportPath) {
  const resolved = path.resolve(process.cwd(), reportPath);
  const fileStat = await stat(resolved).catch((error) => {
    const message = error?.code === "ENOENT" ? "file not found" : "stat failed";
    throw new Error(`Could not read report: ${message}.`);
  });
  if (!fileStat.isFile()) throw new Error("Could not read report: path is not a file.");
  if (fileStat.size > maxReportBytes) throw new Error(`Could not read report: file exceeds ${maxReportBytes} byte safety limit.`);
  return readFile(resolved, "utf8");
}

function exitWithValidation(label, failures) {
  if (failures.length === 0) {
    console.log(`${label} is sanitized and valid.`);
    return;
  }
  console.error(`${label} failed controlled-agent task-level beta report validation:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

async function runDefaultCheck() {
  const failures = [];
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  failures.push(...selfTestFailures());
  exitWithValidation("default controlled-agent task-level beta report check", failures);
}

async function runSelfTest() {
  const failures = selfTestFailures();
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  exitWithValidation("self-test", failures);
}

function selfTestFailures() {
  const unsafeSamples = [
    ["provider API keys", "api_key=redacted-example-key"],
    ["provider API keys", "sk-redactedexample123456"],
    ["bearer tokens", "Authorization: Bearer redacted-example-token"],
    ["auth codes and OAuth tokens", "access_token=redacted-example-token"],
    ["cookies", "Cookie: sid=redacted"],
    ["runtime tokens", "runtime token: redacted-example-token"],
    ["private paths", "/Users/example/project/report.md"],
    ["private paths", "C:\\Users\\example\\report.md"],
    ["secret URL query or fragment values", "http://127.0.0.1/callback?code=redacted"],
    ["raw prompts", "raw prompt: implement the feature"],
    ["raw responses", "raw response: model answer text"],
    ["raw file bodies", "file contents: const value = 1;"],
    ["raw diffs or replacement text", "raw diff: @@ -1 +1"],
    ["raw diffs or replacement text", "replacement text: new body"],
    ["raw commands stdout cwd env", "command: npm test"],
    ["raw commands stdout cwd env", "stdout: full output"],
    ["raw commands stdout cwd env", "stderr: full output"],
    ["raw commands stdout cwd env", "cwd=/Users/example/project"],
    ["raw commands stdout cwd env", "env=TOKEN=redacted"],
    ["provider payloads", "provider payload: {}"],
    ["bridge payload dumps", "bridge payload: { action: send }"],
    ["browser-storage dumps", "localStorage: { token: redacted }"],
    ["hosted backend/account/gateway requirements", "requires hosted Yet AI backend"],
    ["hosted backend/account/gateway requirements", "must use managed model gateway"],
    ["hosted backend/account/gateway requirements", "needs cloud workspace"],
    ["hidden authority claims", "hidden reads: enabled"],
    ["hidden authority claims", "auto-apply: enabled"],
    ["release or marketplace claims", ["production", "ready"].join("-")],
    ["release or marketplace claims", ["ready", "for", "marketplace"].join(" ")],
    ["automation claims", "real-provider CI: passed"],
    ["automation claims", "packaged automation: passed"]
  ];
  const validSanitizedExample = template
    .replace("<packaged VS Code dev-preview artifact family/name | local dev checkout | not run>", "packaged VS Code dev-preview")
    .replace("<VS Code packaged dev-preview | Browser preview-only unsupported | JetBrains partial fail-closed | not run>", "VS Code packaged dev-preview")
    .replace("<YYYY-MM-DD or sanitized sprint label | not run>", "sprint label")
    .replace("<plugin-managed local runtime with BYOK provider family | local model runtime family | provider omitted | not run>", "plugin-managed local runtime with BYOK provider family")
    .replace("<fix-small-bug | add-focused-test | refactor-small-function | explain-selected-code | improve-copy-or-typing | not run>", "fix-small-bug; add-focused-test; refactor-small-function; explain-selected-code; improve-copy-or-typing")
    .replace("<context selected | search selected | context and search selected | blocked with sanitized reason | not run>", "context and search selected")
    .replace("<proposal reviewed | proposal rejected safely | provider unavailable | not run>", "proposal reviewed")
    .replace("<plan reviewed | blocked by policy | read-only preset no patch | not run>", "plan reviewed")
    .replace("<explicit apply accepted | apply skipped | apply rejected | not applicable | not run>", "explicit apply accepted")
    .replace("<allowlisted bundle passed | allowlisted bundle failed with sanitized summary | skipped | blocked | not run>", "allowlisted bundle passed")
    .replace("<none | recovery guidance shown | manual follow-up drafted | stopped | blocked with sanitized reason | not run>", "none")
    .replace("<report checked | export checked | history checked | issue fixed before sharing | not run>", "report checked")
    .replaceAll("<checked | issue fixed before sharing | not run>", "checked")
    .replace("<useful | partially useful | blocked | stopped | failed closed | not run>", "useful")
    .replace("<sanitized label counts or short safe summary | not run>", "one useful task-level row")
    .replace("<sanitized blocker labels or none | not run>", "none")
    .replace("<sanitized follow-up summary or none | not run>", "none");
  const failures = [];
  const validExampleFailures = validateTemplate(validSanitizedExample);
  if (validExampleFailures.length > 0) failures.push(...validExampleFailures.map((failure) => `valid sanitized example ${failure}`));
  for (const [category, sample] of unsafeSamples) {
    const result = validateSafeText(sample);
    if (!result.some((failure) => failure.includes(category))) failures.push(`self-test did not reject ${category}`);
  }
  return failures;
}

function printHelp() {
  console.log(`Usage:
  npm run dogfood:controlled-agent-task-beta-report
  npm run dogfood:controlled-agent-task-beta-report -- --template
  npm run dogfood:controlled-agent-task-beta-report -- --check-template
  npm run dogfood:controlled-agent-task-beta-report -- --check path/to/local-report.md
  npm run dogfood:controlled-agent-task-beta-report -- --self-test

Generates or checks sanitized manual local packaged VS Code task-level controlled-agent beta evidence. It never calls providers, launches runtimes, contacts networks, writes reports by default, mutates workspaces, posts bridge messages, runs verification bundles, signs, notarizes, publishes, or proves production autonomy, release, marketplace, hosted-service, account, gateway, credit, cloud-workspace, automation, or real-provider CI readiness.`);
}
