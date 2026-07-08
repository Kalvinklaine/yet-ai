import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const maxReportBytes = 256 * 1024;
const templatePath = "docs/dogfood/controlled-agent-real-provider-matrix.md";

const fallbackTemplate = `# Yet AI Controlled Agent Real-Provider Dogfood Matrix

Manual local BYOK evidence only. This matrix is not CI evidence, not automation evidence, not production autonomy evidence, not release evidence, not marketplace evidence, not real-provider CI evidence, and not a publication gate. Keep untested cells as \`not run\`. Do not paste secrets, raw prompts, raw responses, raw file bodies, raw diffs, raw replacement text, raw commands, stdout, cwd, env, private paths, provider payloads, bridge payload dumps, hosted backend/account/gateway/credit/cloud workspace requirements, production claims, release claims, marketplace claims, or publication claims.

Use this matrix after explicit user-run local dogfood with a user-configured provider key or local runtime. Keep completed evidence in ignored local evidence locations unless a task explicitly asks for a sanitized tracked excerpt.

## Matrix metadata

- Host/artifact label: <VS Code dev-preview artifact family/name | local dev checkout | sanitized installed artifact label | not run>
- Matrix date label: <YYYY-MM-DD or sanitized sprint label | not run>
- Runtime launch label: <plugin-managed local runtime | manually launched local runtime | local model runtime | not run>
- Scope: manual local BYOK controlled-agent dogfood only; no hosted Yet AI backend, account, managed model gateway, product credit, cloud workspace, production autonomy, release, marketplace, publication, or real-provider CI claim

## Provider and preset matrix

| Row | Provider family/local runtime family | Preset/task type | Context/search selection status | Patch plan/review/apply status | Verification bundle status | Recovery/follow-up status | Usefulness notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | <OpenAI-compatible BYOK | Anthropic-compatible BYOK | local Ollama/runtime family | other sanitized provider family | not run> | <fix-small-bug | add-focused-test | refactor-small-function | explain-selected-code | improve-copy-or-typing | not run> | <explicit context selected | bounded lexical search selected | selection omitted | blocked with sanitized reason | not run> | <plan reviewed | apply skipped | explicit apply accepted | explicit apply rejected with sanitized summary | read-only preset no patch | not run> | <allowlisted bundle passed | allowlisted bundle failed with sanitized summary | skipped | read-only not applicable | not run> | <none | manual follow-up drafted | recovery guidance shown | stopped | blocked with sanitized reason | not run> | <short sanitized usefulness label; no raw prompt, response, file body, diff, command, private path, or secret | not run> |
| 2 | <provider/runtime family | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized notes | not run> |
| 3 | <provider/runtime family | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized notes | not run> |

## Sanitized evidence checklist

- Secrets absent: <checked | issue fixed before sharing | not run>
- Raw prompts absent: <checked | issue fixed before sharing | not run>
- Raw responses absent: <checked | issue fixed before sharing | not run>
- Raw file bodies, diffs, and replacement text absent: <checked | issue fixed before sharing | not run>
- Raw commands, stdout, cwd, and env absent: <checked | issue fixed before sharing | not run>
- Private paths absent: <checked | issue fixed before sharing | not run>
- Provider payloads absent: <checked | issue fixed before sharing | not run>
- Bridge payload dumps absent: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement absent: <checked | issue fixed before sharing | not run>
- Production, release, marketplace, publication, signing, notarization, and real-provider CI claims absent: <checked | issue fixed before sharing | not run>

## Result summary

- Overall result: <useful | partially useful | blocked | stopped | not run>
- Provider/preset coverage summary: <sanitized counts or labels only | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
`;

const requiredPatterns = [
  ["top-level heading", /^# Yet AI Controlled Agent Real-Provider Dogfood Matrix$/m],
  ["manual local BYOK warning", /Manual local BYOK evidence only/],
  ["not CI warning", /not CI evidence/],
  ["not automation warning", /not automation evidence/],
  ["not production autonomy warning", /not production autonomy evidence/],
  ["not release warning", /not release evidence/],
  ["not marketplace warning", /not marketplace evidence/],
  ["not real-provider CI warning", /not real-provider CI evidence/],
  ["matrix metadata heading", /^## Matrix metadata$/m],
  ["host artifact label field", /- Host\/artifact label:/],
  ["provider matrix heading", /^## Provider and preset matrix$/m],
  ["provider family column", /Provider family\/local runtime family/],
  ["preset column", /Preset\/task type/],
  ["context search column", /Context\/search selection status/],
  ["patch status column", /Patch plan\/review\/apply status/],
  ["verification bundle column", /Verification bundle status/],
  ["recovery follow-up column", /Recovery\/follow-up status/],
  ["usefulness notes column", /Usefulness notes/],
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
  ["raw command material check", /- Raw commands, stdout, cwd, and env absent:/],
  ["private paths check", /- Private paths absent:/],
  ["provider payloads check", /- Provider payloads absent:/],
  ["bridge dumps check", /- Bridge payload dumps absent:/],
  ["hosted requirements check", /- Hosted Yet AI backend\/account\/managed gateway\/product credit\/cloud workspace requirement absent:/],
  ["production claims check", /- Production, release, marketplace, publication, signing, notarization, and real-provider CI claims absent:/],
  ["result summary heading", /^## Result summary$/m],
  ["overall result field", /- Overall result:/],
  ["coverage summary field", /- Provider\/preset coverage summary:/],
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
    "marketplace\\s+claim\\s*[:=]"
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
  ["release or marketplace claims", releaseClaimPattern],
  ["automation claims", /\b(?:real-provider\s+CI\s*[:=]|automated\s+real-provider\s+test\s*[:=]|CI\s+called\s+real\s+provider\s*[:=])/i]
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
  process.stdout.write(await loadTemplate());
  process.exit(0);
}

if (args.includes("--check-template")) {
  exitWithValidation("tracked template", validateTemplate(await loadTemplate()));
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

async function loadTemplate() {
  try {
    return await readBoundedReport(templatePath);
  } catch {
    return fallbackTemplate;
  }
}

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
  console.error(`${label} failed controlled-agent real-provider matrix validation:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

async function runDefaultCheck() {
  const failures = [];
  failures.push(...validateTemplate(await loadTemplate()).map((failure) => `template ${failure}`));
  failures.push(...selfTestFailures());
  exitWithValidation("default controlled-agent real-provider matrix check", failures);
}

async function runSelfTest() {
  const failures = selfTestFailures();
  failures.push(...validateTemplate(await loadTemplate()).map((failure) => `template ${failure}`));
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
    ["raw commands stdout cwd env", "cwd=/Users/example/project"],
    ["raw commands stdout cwd env", "env=TOKEN=redacted"],
    ["provider payloads", "provider payload: {}"],
    ["bridge payload dumps", "bridge payload: { action: send }"],
    ["browser-storage dumps", "localStorage: { token: redacted }"],
    ["hosted backend/account/gateway requirements", "requires hosted Yet AI backend"],
    ["hosted backend/account/gateway requirements", "must use managed model gateway"],
    ["hosted backend/account/gateway requirements", "needs cloud workspace"],
    ["release or marketplace claims", ["production", "ready"].join("-")],
    ["release or marketplace claims", ["ready", "for", "marketplace"].join(" ")],
    ["automation claims", "real-provider CI: passed"]
  ];
  const validSanitizedExample = fallbackTemplate
    .replace("<VS Code dev-preview artifact family/name | local dev checkout | sanitized installed artifact label | not run>", "local dev checkout")
    .replace("<YYYY-MM-DD or sanitized sprint label | not run>", "sprint label")
    .replace("<plugin-managed local runtime | manually launched local runtime | local model runtime | not run>", "plugin-managed local runtime")
    .replace("<OpenAI-compatible BYOK | Anthropic-compatible BYOK | local Ollama/runtime family | other sanitized provider family | not run>", "OpenAI-compatible BYOK")
    .replace("<fix-small-bug | add-focused-test | refactor-small-function | explain-selected-code | improve-copy-or-typing | not run>", "fix-small-bug; add-focused-test; refactor-small-function; explain-selected-code; improve-copy-or-typing")
    .replace("<explicit context selected | bounded lexical search selected | selection omitted | blocked with sanitized reason | not run>", "explicit context selected")
    .replace("<plan reviewed | apply skipped | explicit apply accepted | explicit apply rejected with sanitized summary | read-only preset no patch | not run>", "plan reviewed")
    .replace("<allowlisted bundle passed | allowlisted bundle failed with sanitized summary | skipped | read-only not applicable | not run>", "allowlisted bundle passed")
    .replace("<none | manual follow-up drafted | recovery guidance shown | stopped | blocked with sanitized reason | not run>", "none")
    .replace("<short sanitized usefulness label; no raw prompt, response, file body, diff, command, private path, or secret | not run>", "useful with sanitized labels")
    .replaceAll("<provider/runtime family | not run>", "not run")
    .replaceAll("<preset id | not run>", "not run")
    .replaceAll("<sanitized status | not run>", "not run")
    .replaceAll("<sanitized notes | not run>", "not run")
    .replaceAll("<checked | issue fixed before sharing | not run>", "checked")
    .replace("<useful | partially useful | blocked | stopped | not run>", "useful")
    .replace("<sanitized counts or labels only | not run>", "one sanitized row")
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
  npm run dogfood:controlled-agent-real-provider-matrix
  npm run dogfood:controlled-agent-real-provider-matrix -- --template
  npm run dogfood:controlled-agent-real-provider-matrix -- --check-template
  npm run dogfood:controlled-agent-real-provider-matrix -- --check path/to/local-matrix.md
  npm run dogfood:controlled-agent-real-provider-matrix -- --self-test

Generates or checks sanitized manual local BYOK controlled-agent real-provider matrix evidence. It never calls providers, launches runtimes, contacts networks, writes reports by default, or proves production autonomy, release, marketplace, hosted-service, account, gateway, credit, cloud-workspace, automation, or real-provider CI readiness.`);
}
