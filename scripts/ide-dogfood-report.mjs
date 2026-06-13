import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const maxReportBytes = 256 * 1024;

const template = `# Yet AI Cross-IDE Manual Dogfood Report

Local-only sanitized evidence template. Keep every untested field as \`not run\`. Do not paste secrets, machine-local absolute locations, unsanitized protocol/debug dumps, HTTP bodies, browser saved state, provider output, prompt text, or source text.

## Run metadata

- OS/arch: <os>/<arch>
- Commit hash: <git-commit-sha>
- Artifact family: <local-dev-preview | github-vscode-unzip-first | github-jetbrains-direct-install | other-sanitized-family>
- Checksum status: <matched | mismatch | missing | not run>
- Commands run: <artifact/report gate commands completed | sanitized command summary | not run>
- Sanitized failure status: <none | sanitized summary only | not run>

## VS Code installed first-message dogfood

- VS Code artifact: <sanitized artifact family/name only; no absolute path | not run>
- VS Code checksum: <matched | mismatch | missing | not run>
- Install result: <installed | failed with sanitized summary | not run>
- Runtime launch mode: <auto | launch | connect | not run>
- Runtime status: <connected | sanitized runtime error | not run>
- Packaged GUI status: <loaded | placeholder | blank | failed with sanitized summary | not run>
- Provider path: <Demo Mode/local mock | real BYOK api-key provider | official login (future/not implemented) | experimental login | unavailable | not run>
- Provider setup status: <configured and redacted | local mock | unavailable | failed with sanitized summary | not run>
- Active context status: <not shown | shown and omitted | shown and attached safe selection | not run>
- Read-only IDE action status: <explicitly confirmed and succeeded | explicitly confirmed and failed with sanitized summary | not run>
- First-message result: <accepted and assistant response visible | failed with sanitized summary | not run>
- Second-message refresh result: <new assistant response visible after second send/history refresh | failed with sanitized summary | not run>

## JetBrains

- Install path/result: <sanitized artifact family only; installed | failed with sanitized summary | not run>
- Runtime launch mode: <auto | launch | connect | not run>
- Packaged GUI status: <loaded | placeholder | blank | failed with sanitized summary | not run>
- Runtime status: <connected | sanitized runtime error | not run>
- Provider path: <Demo Mode/local mock | real BYOK api-key provider | official login (future/not implemented) | experimental login | unavailable | not run>
- Provider setup status: <configured and redacted | local mock | unavailable | failed with sanitized summary | not run>
- Active context status: <not shown | shown and omitted | shown and attached safe selection | not run>
- Read-only IDE action status: <explicitly confirmed and succeeded | explicitly confirmed and failed with sanitized summary | not run>
- First-message result: <accepted and assistant response visible | failed with sanitized summary | not run>
- Second-message refresh result: <new assistant response visible after second send/history refresh | failed with sanitized summary | not run>

## Sanitized notes

- Summary: <short sanitized outcome or not run>
- Failures/blockers: <sanitized summary only or not run>
- Follow-up needed: <sanitized summary only or not run>
`;

const requiredPatterns = [
  ["top-level heading", /^# Yet AI Cross-IDE Manual Dogfood Report$/m],
  ["run metadata heading", /^## Run metadata$/m],
  ["VS Code installed first-message heading", /^## VS Code installed first-message dogfood$/m],
  ["JetBrains heading", /^## JetBrains$/m],
  ["OS/arch field", /- OS\/arch:/],
  ["commit hash field", /- Commit hash:/],
  ["artifact family field", /- Artifact family:/],
  ["checksum status field", /- Checksum status:/],
  ["commands run field", /- Commands run:/],
  ["sanitized failure status field", /- Sanitized failure status:/],
  ["VS Code artifact field", /^## VS Code installed first-message dogfood[\s\S]*- VS Code artifact:/m],
  ["VS Code checksum field", /^## VS Code installed first-message dogfood[\s\S]*- VS Code checksum:/m],
  ["VS Code install result field", /^## VS Code installed first-message dogfood[\s\S]*- Install result:/m],
  ["JetBrains install path/result field", /^## JetBrains[\s\S]*- Install path\/result:/m],
  ["runtime launch mode field", /- Runtime launch mode:/],
  ["packaged GUI status field", /- Packaged GUI status:/],
  ["runtime status field", /- Runtime status:/],
  ["provider path field", /- Provider path:/],
  ["Demo Mode provider option", /Demo Mode\/local mock/],
  ["real BYOK provider option", /real BYOK api-key provider/],
  ["provider setup status field", /- Provider setup status:/],
  ["active context status field", /- Active context status:/],
  ["read-only IDE action status field", /- Read-only IDE action status:/],
  ["first-message result field", /- First-message result:/],
  ["second-message refresh result field", /- Second-message refresh result:/],
  ["explicit not run values", /not run/],
];

const unsafeChecks = [
  ["bearer/authorization headers", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+)/i],
  ["provider API keys", /\bsk-(?:proj-)?[A-Za-z0-9_\-]{8,}\b|\b(?:api[_-]?key|apikey|provider[_-]?key|openai[_-]?key|secret[_-]?key|key)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["runtime session tokens", /\b(?:YET_AI_AUTH_TOKEN|session[_ -]?token|runtime[_ -]?token)\b\s*[:=]\s*[^\s<][^\r\n]*|\blocal-dev-token\b/i],
  ["OAuth auth codes/tokens/PKCE verifiers", /\b(?:auth[_-]?code|authorization[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|pkce[_-]?verifier|code[_-]?verifier)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["cookies", /\b(?:Cookie|Set-Cookie)\s*:\s*\S+|\bcookie\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["private absolute paths", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._ -]+\/|\/(?:var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+\/|\b[A-Za-z]:\\[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["query/fragment secrets", /[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=/i],
  ["raw bridge payloads/request bodies/browser storage dumps", /\b(?:raw\s+bridge\s+payload|bridge\s+payload|request\s+body|raw\s+request|localStorage|sessionStorage|browser\s+storage\s+dump|storage\s+dump)\b/i],
  ["unsafe screenshot or dump references", /\b(?:screenshot|screen\s*capture|recording|har|heap\s*dump|database\s*dump|sqlite|workspace\s*storage|extension\s*storage)\b.*\b(?:secret|token|cookie|key|auth|credential|dump|raw|path)\b/i],
  ["provider responses/raw prompts/file contents", /\b(?:raw\s+provider\s+response|provider\s+response\s+body|raw\s+prompt|prompt\s+dump|file\s+contents?|source\s+contents?|terminal\s+scrollback)\b/i],
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
  exitWithValidation(reportPath, validateSafeText(text));
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
  console.error(`${label} failed dogfood report validation:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function runSelfTest() {
  const unsafeSamples = [
    ["bearer/authorization headers", "Authorization: Bearer redacted-example-token"],
    ["provider API keys", "api_key=redacted-example-key"],
    ["provider API keys", "sk-redactedexample123456"],
    ["runtime session tokens", "Session token: redacted-example-token"],
    ["OAuth auth codes/tokens/PKCE verifiers", "refresh_token=redacted-example-token"],
    ["cookies", "Cookie: sid=redacted"],
    ["private absolute paths", "/Users/example/project/report.md"],
    ["private absolute paths", "C:\\Users\\example\\report.md"],
    ["query/fragment secrets", "http://127.0.0.1/callback?code=redacted"],
    ["unsafe screenshot or dump references", "screenshot with token path attached"],
    ["unsafe screenshot or dump references", "workspace storage dump contains cookie"],
    ["raw bridge payloads/request bodies/browser storage dumps", "raw bridge payload: {}"],
    ["provider responses/raw prompts/file contents", "raw provider response: {}"],
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
  npm run dogfood:ide-report -- --template
  npm run dogfood:ide-report -- --check-template
  npm run dogfood:ide-report -- --check path/to/report.md
  npm run dogfood:ide-report -- --self-test

Generates or checks sanitized local-only cross-IDE manual dogfood evidence. It never writes reports to tracked files by default.`);
}
