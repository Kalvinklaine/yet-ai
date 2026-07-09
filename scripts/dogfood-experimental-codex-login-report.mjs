import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const maxReportBytes = 256 * 1024;

const template = `# Experimental Codex-like Login Dogfood Report

Manual real-account dogfood evidence only. Use this checklist only after explicit acceptance for the current task. Keep completed reports in ignored local evidence locations unless a task asks for a sanitized excerpt. This is not CI evidence, not official OAuth evidence, not production login evidence, not release evidence, not marketplace evidence, not signing evidence, not support-readiness evidence, and not a publication gate.

The experimental Codex-like path remains high-risk, private-endpoint-style, non-default, account-specific, and separate from the safe/default API-key or project-key provider setup. Do not paste secrets, authorization headers, bearer tokens, access tokens, refresh tokens, auth codes, PKCE verifiers, cookies, secret URL query or fragment values, raw provider responses, raw prompts, raw file bodies, raw diffs, raw command output, provider payloads, private absolute paths, bridge dumps, browser storage dumps, screenshots with secrets, or account-private identifiers.

## Run metadata

- Surface: <web/dev GUI | VS Code plugin | not run>
- Runtime launch/connect status: <runtime auto-launched | runtime connected | runtime unavailable | blocked with sanitized reason | not run>
- Date label: <YYYY-MM-DD or sanitized sprint label | not run>
- Build/artifact label: <local dev checkout | VS Code dev-preview artifact family/name | not run>
- Provider path under test: experimental Codex-like account login only; safe/default API-key or project-key path remains the approved real-provider path

## Experimental login lifecycle

- Login start outcome: <started and browser handoff shown | blocked by runtime | unsafe authorization URL blocked | unavailable | not run>
- Pending status outcome: <pending visible with manual exchange guidance | expired before exchange | state mismatch handled | not run>
- Exchange outcome: <connected with sanitized status | denied | expired | provider rejected | sanitized error | not run>
- Connected status evidence: <sanitized account label/scopes/expiry visible | redacted hint visible | connected status unavailable | not run>
- Disconnect outcome: <disconnect cleared experimental account auth | disconnect unavailable | not run>

## First chat result

- Provider selection expectation: <experimental account auth used because no safer ready provider won | API-key/project-key path won by precedence | Demo Mode won by precedence | not run>
- First chat result: <streamed answer visible | failed with sanitized provider category | blocked before send | not run>
- Recovery after first chat: <none | reconnect needed | API-key fallback used | provider/model unavailable | not run>

## VS Code controlled task smoke and dogfood note

- VS Code host readiness: <runtime host.ready visible | controlled task surface visible | unsupported or blocked with sanitized reason | not run>
- Controlled task start: <explicit small task started after first chat | not attempted | blocked with sanitized reason | not run>
- Controlled task provider proposal: <proposal visible with sanitized labels | provider/model unavailable | not attempted | not run>
- Controlled task gates observed: <explicit start/context/review/apply/verification gates visible | blocked before gates | not run>
- Controlled task result label: <small task completed | stopped by user | verification failed with sanitized category | not attempted | not run>
- Authority boundary observed: <no automatic task execution | no workspace mutation from login alone | Browser unsupported | JetBrains fail-closed unless separately verified | not run>

## Disconnect and reconnect observations

- Disconnect observation: <experimental auth removed | API-key fallback preserved | disconnect failed safely | not run>
- Reconnect observation: <reconnect started | pending recovered | exchange retried | reconnect blocked with sanitized reason | not run>
- Refresh/expiry observation: <refresh invisible and chat still worked | expired state visible | reconnect required | not observed | not run>

## Known issue categories

- Browser handoff issue: <none | pop-up blocked | unsafe URL blocked | manual code unclear | not run>
- Exchange issue: <none | denied | expired | state mismatch | provider rejected | sanitized runtime error | not run>
- Chat issue: <none | provider unauthorized | model unavailable | streaming interrupted | safer provider precedence surprise | not run>
- VS Code host issue: <none | runtime launch/connect issue | host.ready issue | controlled task surface not ready | not run>
- Documentation/UI issue: <none | copy unclear | recovery unclear | risk framing unclear | not run>

## Sanitized evidence checklist

- API keys absent: <checked | issue fixed before sharing | not run>
- Bearer or authorization headers absent: <checked | issue fixed before sharing | not run>
- Access tokens, refresh tokens, auth codes, and PKCE verifiers absent: <checked | issue fixed before sharing | not run>
- Cookies absent: <checked | issue fixed before sharing | not run>
- Secret URL query and fragment values absent: <checked | issue fixed before sharing | not run>
- Raw provider responses absent: <checked | issue fixed before sharing | not run>
- Raw prompts absent: <checked | issue fixed before sharing | not run>
- Raw file bodies and raw diffs absent: <checked | issue fixed before sharing | not run>
- Raw command output absent: <checked | issue fixed before sharing | not run>
- Provider payloads absent: <checked | issue fixed before sharing | not run>
- Private absolute paths absent: <checked | issue fixed before sharing | not run>
- Bridge dumps absent: <checked | issue fixed before sharing | not run>
- Browser storage dumps absent: <checked | issue fixed before sharing | not run>
- Screenshots with secrets absent: <checked | issue fixed before sharing | not run>
- Account-private identifiers absent: <checked | issue fixed before sharing | not run>

## Explicit non-claims

- Official OAuth claim: not claimed
- Production login claim: not claimed
- Release or marketplace readiness claim: not claimed
- Signing, notarization, or support readiness claim: not claimed
- CI real-provider automation claim: not claimed
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement: not required for this local dogfood checklist

## Result

- Result status: <connected and first chat worked | connected but first chat blocked | login blocked | failed closed | not run>
- Sanitized summary: <short safe label-only summary | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
`;

const requiredPatterns = [
  ["top-level heading", /^# Experimental Codex-like Login Dogfood Report$/m],
  ["manual real-account warning", /Manual real-account dogfood evidence only/],
  ["explicit acceptance warning", /explicit acceptance/],
  ["not CI warning", /not CI evidence/],
  ["not official OAuth warning", /not official OAuth evidence/],
  ["not production login warning", /not production login evidence/],
  ["not release warning", /not release evidence/],
  ["not marketplace warning", /not marketplace evidence/],
  ["not signing warning", /not signing evidence/],
  ["not support readiness warning", /not support-readiness evidence/],
  ["private endpoint risk", /private-endpoint-style/],
  ["non-default risk", /non-default/],
  ["run metadata heading", /^## Run metadata$/m],
  ["surface field", /- Surface:/],
  ["runtime status field", /- Runtime launch\/connect status:/],
  ["provider path field", /- Provider path under test:/],
  ["login lifecycle heading", /^## Experimental login lifecycle$/m],
  ["login start field", /- Login start outcome:/],
  ["pending status field", /- Pending status outcome:/],
  ["exchange field", /- Exchange outcome:/],
  ["connected status field", /- Connected status evidence:/],
  ["disconnect outcome field", /- Disconnect outcome:/],
  ["first chat heading", /^## First chat result$/m],
  ["provider selection field", /- Provider selection expectation:/],
  ["first chat field", /- First chat result:/],
  ["recovery after chat field", /- Recovery after first chat:/],
  ["VS Code controlled task heading", /^## VS Code controlled task smoke and dogfood note$/m],
  ["VS Code host readiness field", /- VS Code host readiness:/],
  ["controlled task start field", /- Controlled task start:/],
  ["controlled task provider proposal field", /- Controlled task provider proposal:/],
  ["controlled task gates field", /- Controlled task gates observed:/],
  ["controlled task result field", /- Controlled task result label:/],
  ["authority boundary field", /- Authority boundary observed:/],
  ["disconnect reconnect heading", /^## Disconnect and reconnect observations$/m],
  ["disconnect observation field", /- Disconnect observation:/],
  ["reconnect observation field", /- Reconnect observation:/],
  ["refresh expiry field", /- Refresh\/expiry observation:/],
  ["known issue categories heading", /^## Known issue categories$/m],
  ["browser issue field", /- Browser handoff issue:/],
  ["exchange issue field", /- Exchange issue:/],
  ["chat issue field", /- Chat issue:/],
  ["VS Code host issue field", /- VS Code host issue:/],
  ["documentation UI issue field", /- Documentation\/UI issue:/],
  ["sanitized evidence heading", /^## Sanitized evidence checklist$/m],
  ["API keys check", /- API keys absent:/],
  ["bearer authorization check", /- Bearer or authorization headers absent:/],
  ["tokens codes PKCE check", /- Access tokens, refresh tokens, auth codes, and PKCE verifiers absent:/],
  ["cookies check", /- Cookies absent:/],
  ["secret URL values check", /- Secret URL query and fragment values absent:/],
  ["raw provider responses check", /- Raw provider responses absent:/],
  ["raw prompts check", /- Raw prompts absent:/],
  ["raw file bodies diffs check", /- Raw file bodies and raw diffs absent:/],
  ["raw command output check", /- Raw command output absent:/],
  ["provider payloads check", /- Provider payloads absent:/],
  ["private absolute paths check", /- Private absolute paths absent:/],
  ["bridge dumps check", /- Bridge dumps absent:/],
  ["browser storage dumps check", /- Browser storage dumps absent:/],
  ["screenshots with secrets check", /- Screenshots with secrets absent:/],
  ["account-private identifiers check", /- Account-private identifiers absent:/],
  ["explicit non-claims heading", /^## Explicit non-claims$/m],
  ["official OAuth non-claim", /- Official OAuth claim: not claimed/],
  ["production non-claim", /- Production login claim: not claimed/],
  ["release marketplace non-claim", /- Release or marketplace readiness claim: not claimed/],
  ["support non-claim", /- Signing, notarization, or support readiness claim: not claimed/],
  ["CI automation non-claim", /- CI real-provider automation claim: not claimed/],
  ["hosted requirement non-claim", /- Hosted Yet AI backend\/account\/managed gateway\/product credit\/cloud workspace requirement:/],
  ["result heading", /^## Result$/m],
  ["result status field", /- Result status:/],
  ["sanitized summary field", /- Sanitized summary:/],
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
    "production\\s+login\\s+is\\s+supported",
    "official\\s+OAuth\\s+is\\s+supported",
    "marketplace\\s+approved",
    "release\\s+approved",
    "signing\\s+approved",
    "notarization\\s+approved",
    "support\\s+ready"
  ].join("|")})\\b`,
  "i"
);

const unsafeChecks = [
  ["API keys", /\bsk-(?:proj-)?[A-Za-z0-9_\-]{8,}\b|\b(?:api[_-]?key|apikey|provider[_-]?key|openai[_-]?key|anthropic[_-]?key|secret[_-]?key)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["bearer or authorization headers", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+)/i],
  ["access or refresh tokens", /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["auth codes", /\b(?:auth[_-]?code|authorization[_-]?code|code)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["PKCE verifiers", /\b(?:pkce[_-]?verifier|code[_-]?verifier)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["cookies", /\b(?:Cookie|Set-Cookie)\s*:\s*\S+|\bcookie\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["runtime tokens", /\b(?:YET_AI_AUTH_TOKEN|session[_ -]?token|runtime[_ -]?token)\b\s*[:=]\s*[^\s<][^\r\n]*|\blocal-dev-token\b/i],
  ["secret URL query or fragment values", /[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=/i],
  ["private absolute paths", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._ -]+\/|\/(?:var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+\/|\b[A-Za-z]:\\[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["raw provider responses", /\b(?:raw\s+provider\s+responses?|provider\s+response\s+body|provider\s+json\s+dump|raw\s+provider\s+payload|provider\s+payload|provider\s+request|provider\s+response)\b\s*[:=]/i],
  ["raw prompts", /\b(?:raw\s+prompts?|prompt\s+dump|verbatim\s+prompt|full\s+prompt\s+text)\b\s*[:=]/i],
  ["raw file bodies", /\b(?:file\s+contents?|source\s+contents?|document\s+contents?|full\s+file\s+text|raw\s+file\s+body|verbatim\s+source)\b\s*[:=]/i],
  ["raw diffs", /\b(?:raw\s+diff|diff\s+dump|patch\s+body|raw\s+patch|patch\s+dump|verbatim\s+diff)\b\s*[:=]/i],
  ["bridge dumps", /\b(?:raw\s+bridge\s+payload|bridge\s+payload\s+dump|bridge\s+dump|postMessage\s+dump|request\s+body|raw\s+request)\b\s*[:=]/i],
  ["browser storage dumps", /\b(?:localStorage|sessionStorage|indexedDB|browser\s+storage\s+dump|storage\s+dump|workspace\s+storage\s+dump)\b\s*[:=]/i],
  ["screenshots with secrets", /\b(?:screenshot|screen\s+capture|image)\b\s*[:=]\s*(?:.*(?:token|secret|api\s*key|authorization|cookie|code))/i],
  ["account-private identifiers", /\b(?:account[_ -]?id|user[_ -]?id|email|organization[_ -]?id|tenant[_ -]?id)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["hosted backend/account/gateway requirements", /\b(?:requires?|must\s+use|needs?)\s+(?:a\s+)?(?:hosted\s+Yet\s+AI\s+backend|Yet\s+AI\s+account|managed\s+model\s+gateway|product\s+credits?|cloud\s+workspace)\b/i],
  ["automation claims", /\b(?:real-provider\s+CI\s*[:=]|automated\s+real-provider\s+test\s*[:=]|CI\s+called\s+real\s+provider\s*[:=]|CI\s+real-provider\s+automation\s*[:=])/i],
  ["official or readiness claims", releaseClaimPattern]
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
  console.error(`${label} failed experimental Codex-like login dogfood report validation:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

async function runDefaultCheck() {
  const failures = [];
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  failures.push(...selfTestFailures());
  exitWithValidation("default experimental Codex-like login dogfood report check", failures);
}

async function runSelfTest() {
  const failures = selfTestFailures();
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  exitWithValidation("self-test", failures);
}

function selfTestFailures() {
  const unsafeSamples = [
    ["API keys", "api_key=redacted-example-key"],
    ["API keys", "sk-redactedexample123456"],
    ["bearer or authorization headers", "Authorization: Bearer redacted-example-token"],
    ["access or refresh tokens", "access_token=redacted-example-token"],
    ["access or refresh tokens", "refresh_token=redacted-example-token"],
    ["auth codes", "authorization_code=redacted-example-code"],
    ["auth codes", "code=redacted-example-code"],
    ["PKCE verifiers", "code_verifier=redacted-example-verifier"],
    ["cookies", "Cookie: sid=redacted"],
    ["runtime tokens", "runtime token: redacted-example-token"],
    ["secret URL query or fragment values", "http://127.0.0.1/callback?code=redacted"],
    ["secret URL query or fragment values", "https://example.invalid/#access_token=redacted"],
    ["private absolute paths", "/Users/example/project/report.md"],
    ["private absolute paths", "C:\\Users\\example\\report.md"],
    ["raw provider responses", "raw provider response: {}"],
    ["raw prompts", "raw prompt: explain this file"],
    ["raw file bodies", "file contents: const value = 1;"],
    ["raw diffs", "raw diff: @@ -1 +1"],
    ["bridge dumps", "bridge payload dump: {}"],
    ["bridge dumps", "request body: {}"],
    ["browser storage dumps", "localStorage: { token: redacted }"],
    ["screenshots with secrets", "screenshot: token visible"],
    ["account-private identifiers", "account_id: private-account"],
    ["hosted backend/account/gateway requirements", "requires hosted Yet AI backend"],
    ["hosted backend/account/gateway requirements", "must use managed model gateway"],
    ["hosted backend/account/gateway requirements", "needs cloud workspace"],
    ["automation claims", "real-provider CI: passed"],
    ["official or readiness claims", "official OAuth is supported"],
    ["official or readiness claims", ["production", "ready"].join("-")],
    ["official or readiness claims", ["ready", "for", "marketplace"].join(" ")],
    ["official or readiness claims", "support ready"]
  ];
  const validSanitizedExample = template
    .replace("<web/dev GUI | VS Code plugin | not run>", "VS Code plugin")
    .replace("<runtime auto-launched | runtime connected | runtime unavailable | blocked with sanitized reason | not run>", "runtime connected")
    .replace("<YYYY-MM-DD or sanitized sprint label | not run>", "sprint label")
    .replace("<local dev checkout | VS Code dev-preview artifact family/name | not run>", "local dev checkout")
    .replace("<started and browser handoff shown | blocked by runtime | unsafe authorization URL blocked | unavailable | not run>", "started and browser handoff shown")
    .replace("<pending visible with manual exchange guidance | expired before exchange | state mismatch handled | not run>", "pending visible with manual exchange guidance")
    .replace("<connected with sanitized status | denied | expired | provider rejected | sanitized error | not run>", "connected with sanitized status")
    .replace("<sanitized account label/scopes/expiry visible | redacted hint visible | connected status unavailable | not run>", "sanitized account label and expiry visible")
    .replace("<disconnect cleared experimental account auth | disconnect unavailable | not run>", "disconnect cleared experimental account auth")
    .replace("<experimental account auth used because no safer ready provider won | API-key/project-key path won by precedence | Demo Mode won by precedence | not run>", "experimental account auth used because no safer ready provider won")
    .replace("<streamed answer visible | failed with sanitized provider category | blocked before send | not run>", "streamed answer visible")
    .replace("<none | reconnect needed | API-key fallback used | provider/model unavailable | not run>", "none")
    .replace("<runtime host.ready visible | controlled task surface visible | unsupported or blocked with sanitized reason | not run>", "runtime host ready visible")
    .replace("<explicit small task started after first chat | not attempted | blocked with sanitized reason | not run>", "explicit small task started after first chat")
    .replace("<proposal visible with sanitized labels | provider/model unavailable | not attempted | not run>", "proposal visible with sanitized labels")
    .replace("<explicit start/context/review/apply/verification gates visible | blocked before gates | not run>", "explicit start and review gates visible")
    .replace("<small task completed | stopped by user | verification failed with sanitized category | not attempted | not run>", "small task completed")
    .replace("<no automatic task execution | no workspace mutation from login alone | Browser unsupported | JetBrains fail-closed unless separately verified | not run>", "no automatic task execution")
    .replace("<experimental auth removed | API-key fallback preserved | disconnect failed safely | not run>", "experimental auth removed")
    .replace("<reconnect started | pending recovered | exchange retried | reconnect blocked with sanitized reason | not run>", "reconnect started")
    .replace("<refresh invisible and chat still worked | expired state visible | reconnect required | not observed | not run>", "not observed")
    .replace("<none | pop-up blocked | unsafe URL blocked | manual code unclear | not run>", "none")
    .replace("<none | denied | expired | state mismatch | provider rejected | sanitized runtime error | not run>", "none")
    .replace("<none | provider unauthorized | model unavailable | streaming interrupted | safer provider precedence surprise | not run>", "none")
    .replace("<none | runtime launch/connect issue | host.ready issue | controlled task surface not ready | not run>", "none")
    .replace("<none | copy unclear | recovery unclear | risk framing unclear | not run>", "none")
    .replaceAll("<checked | issue fixed before sharing | not run>", "checked")
    .replace("<connected and first chat worked | connected but first chat blocked | login blocked | failed closed | not run>", "connected and first chat worked")
    .replace("<short safe label-only summary | not run>", "connected status and first chat verified with sanitized labels")
    .replace("<sanitized follow-up summary or none | not run>", "none; not run for follow-up");
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
  npm run dogfood:experimental-codex-login-report
  npm run dogfood:experimental-codex-login-report -- --template
  npm run dogfood:experimental-codex-login-report -- --check-template
  npm run dogfood:experimental-codex-login-report -- --check path/to/local-report.md
  npm run dogfood:experimental-codex-login-report -- --self-test

Generates or checks sanitized manual real-account experimental Codex-like login dogfood evidence. It never calls providers, launches runtimes, automates real-provider CI, writes reports by default, stores secrets, posts bridge messages, mutates workspaces, signs, notarizes, publishes, or proves official OAuth, production, release, marketplace, support, hosted-service, account, gateway, credit, cloud-workspace, or CI readiness.`);
}
