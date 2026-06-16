import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const maxReportBytes = 256 * 1024;

const template = `# Yet AI Real-Provider Active-File Chat Dogfood Report

Manual local evidence only. This report is not CI evidence, not production release evidence, and not a publication gate. Keep every untested field as \`not run\`. Do not paste secrets, bearer headers, auth codes, cookies, runtime tokens, private absolute locations, verbatim provider output dumps, prompt text dumps, or file/source text dumps.

## Run metadata

- Commit/artifact: <git commit and sanitized artifact family/name | local dev checkout | not run>
- Runtime launch mode: <plugin auto-launch | manual local launch | browser/local runtime | not run>
- IDE/browser surface: <VS Code | JetBrains | browser dev surface | other sanitized surface | not run>
- Provider type/model id: <provider family and non-secret model id only | not run>

## Active-file context

- Active-file excerpt: <attached bounded excerpt | intentionally omitted | unavailable | not run>
- Attachment source: <selection | visible range | caret-adjacent excerpt | not run>
- Sanitization status: <workspace-relative metadata only | no prompt/source text pasted | sanitized issue summary | not run>

## First streaming answer

- Send result: <streamed answer visible | failed with sanitized summary | not run>
- Streaming behavior: <tokens/chunks visible | final answer only | interrupted with sanitized summary | not run>
- User-visible quality note: <short sanitized outcome, no raw answer dump | not run>

## No-secret checks

- Provider credentials absent from report: <checked | issue fixed before sharing | not run>
- Runtime tokens absent from report: <checked | issue fixed before sharing | not run>
- Auth codes/cookies absent from report: <checked | issue fixed before sharing | not run>
- Private absolute paths absent from report: <checked | issue fixed before sharing | not run>
- Verbatim provider outputs/prompts/file text absent from report: <checked | issue fixed before sharing | not run>

## Known issues

- Known issues: <sanitized issue list or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
`;

const requiredPatterns = [
  ["top-level heading", /^# Yet AI Real-Provider Active-File Chat Dogfood Report$/m],
  ["manual local evidence warning", /Manual local evidence only/],
  ["not CI warning", /not CI evidence/],
  ["not production release warning", /not production release evidence/],
  ["run metadata heading", /^## Run metadata$/m],
  ["commit artifact field", /- Commit\/artifact:/],
  ["runtime launch mode field", /- Runtime launch mode:/],
  ["IDE browser surface field", /- IDE\/browser surface:/],
  ["provider type model id field", /- Provider type\/model id:/],
  ["active-file context heading", /^## Active-file context$/m],
  ["active-file excerpt field", /- Active-file excerpt:/],
  ["attachment source field", /- Attachment source:/],
  ["first streaming answer heading", /^## First streaming answer$/m],
  ["send result field", /- Send result:/],
  ["streaming behavior field", /- Streaming behavior:/],
  ["no-secret checks heading", /^## No-secret checks$/m],
  ["provider credentials check", /- Provider credentials absent from report:/],
  ["runtime tokens check", /- Runtime tokens absent from report:/],
  ["auth codes cookies check", /- Auth codes\/cookies absent from report:/],
  ["private absolute paths check", /- Private absolute paths absent from report:/],
  ["verbatim provider prompts file text check", /- Verbatim provider outputs\/prompts\/file text absent from report:/],
  ["known issues heading", /^## Known issues$/m],
  ["known issues field", /- Known issues:/],
  ["explicit not run values", /not run/]
];

const unsafeChecks = [
  ["raw API keys", /\bsk-(?:proj-)?[A-Za-z0-9_\-]{8,}\b|\b(?:api[_-]?key|apikey|provider[_-]?key|openai[_-]?key|secret[_-]?key)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["bearer tokens", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+)/i],
  ["auth codes", /\b(?:auth[_-]?code|authorization[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|pkce[_-]?verifier|code[_-]?verifier)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["cookies", /\b(?:Cookie|Set-Cookie)\s*:\s*\S+|\bcookie\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["runtime tokens", /\b(?:YET_AI_AUTH_TOKEN|session[_ -]?token|runtime[_ -]?token)\b\s*[:=]\s*[^\s<][^\r\n]*|\blocal-dev-token\b/i],
  ["private absolute paths", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._ -]+\/|\/(?:var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+\/|\b[A-Za-z]:\\[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["secret URL query or fragment values", /[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=/i],
  ["raw provider response dumps", /\b(?:raw\s+provider\s+response|provider\s+response\s+body|provider\s+json\s+dump|completion\s+response\s+dump)\b/i],
  ["raw prompt or file content dumps", /\b(?:raw\s+prompt|prompt\s+dump|file\s+contents?|source\s+contents?|document\s+contents?|full\s+file\s+text|terminal\s+scrollback)\b/i],
  ["raw protocol or storage dumps", /\b(?:raw\s+bridge\s+payload|bridge\s+payload|request\s+body|raw\s+request|localStorage|sessionStorage|browser\s+storage\s+dump|storage\s+dump|har\s+file)\b/i]
];

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help")) {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
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
  console.error(`${label} failed real-provider dogfood report validation:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function runSelfTest() {
  const unsafeSamples = [
    ["raw API keys", "api_key=redacted-example-key"],
    ["raw API keys", "sk-redactedexample123456"],
    ["bearer tokens", "Authorization: Bearer redacted-example-token"],
    ["auth codes", "authorization_code=redacted-example-code"],
    ["cookies", "Cookie: sid=redacted"],
    ["runtime tokens", "runtime token: redacted-example-token"],
    ["private absolute paths", "/Users/example/project/report.md"],
    ["private absolute paths", "C:\\Users\\example\\report.md"],
    ["secret URL query or fragment values", "http://127.0.0.1/callback?code=redacted"],
    ["raw provider response dumps", "raw provider response: {}"],
    ["raw prompt or file content dumps", "raw prompt: explain this file"],
    ["raw prompt or file content dumps", "file contents: const value = 1;"],
    ["raw protocol or storage dumps", "request body: {}"]
  ];
  const failures = [];
  for (const [category, sample] of unsafeSamples) {
    const result = validateSafeText(sample);
    if (!result.some((failure) => failure.includes(category))) {
      failures.push(`self-test did not reject ${category}`);
    }
  }
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  exitWithValidation("self-test", failures);
}

function printHelp() {
  console.log(`Usage:
  npm run dogfood:real-provider-report -- --template
  npm run dogfood:real-provider-report -- --check-template
  npm run dogfood:real-provider-report -- --check path/to/report.md
  npm run dogfood:real-provider-report -- --self-test

Generates or checks sanitized manual local evidence for real BYOK active-file coding chat. It never calls providers, launches runtimes, or writes reports to tracked files by default.`);
}
