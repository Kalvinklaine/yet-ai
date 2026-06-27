import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const maxReportBytes = 256 * 1024;

const template = `# Yet AI Manual Agent Run RC Report

Manual local evidence only. This report is not CI evidence, not automation evidence, not real-provider CI evidence, not production release evidence, not marketplace readiness evidence, and not a publication gate. Keep untested fields as \`not run\`. Do not paste provider credentials, bearer headers, auth codes, OAuth tokens, runtime tokens, cookies, private absolute paths, prompt text dumps, provider response dumps, file body dumps, diff or patch body dumps, command strings, cwd or env values, browser-storage dumps, or bridge payload dumps.

## Run metadata

- Commit/artifact label: <git commit or sanitized artifact family/name | local dev checkout | not run>
- Host: <browser | VS Code | JetBrains | not run>
- Runtime connection status: <connected | failed with sanitized summary | not run>
- Provider family/model id: <provider family and non-secret model id only | local runtime family/id only | not run>
- RC scope: manual local dogfood only; no production, marketplace, autonomy, or real-provider CI readiness claim

## Context boundary

- Explicit context attached: <active-file excerpt | snippet | memory note | verification output label | manual note | none | not run>
- Explicit context omitted: <intentionally omitted | not applicable | not run>
- Context sanitization: <sanitized labels/counts only | reviewed bounded excerpt only | issue fixed before sharing | not run>

## Manual Agent Run evidence

- Send evidence: <user clicked Send manually | skipped | failed with sanitized summary | not run>
- Apply evidence: <user clicked Apply manually | blocked | skipped | failed/rejected with sanitized summary | not run>
- Verify evidence: <user clicked Verification manually | skipped | failed with sanitized summary | not run>
- No automatic execution observed: <checked | issue found with sanitized summary | not run>

## RC result statuses

- Proposal status: <detected and reviewable | rejected by safety/parser checks | absent | failed with sanitized summary | not run>
- Checkpoint status: <verified | missing | stale | blocked | not needed | not run>
- Final result status: <completed after manual verification | stopped before apply | stopped after failed apply | stopped after failed verification | stopped after proposal rejection | not run>

## Safety checklist

- Provider secrets absent: <checked | issue fixed before sharing | not run>
- Bearer tokens, cookies, auth codes, OAuth/runtime tokens absent: <checked | issue fixed before sharing | not run>
- Private absolute paths absent: <checked | issue fixed before sharing | not run>
- Prompt/provider response/file body/diff/patch body dumps absent: <checked | issue fixed before sharing | not run>
- Command strings, cwd, env, browser storage, and bridge payload dumps absent: <checked | issue fixed before sharing | not run>
- No hosted Yet AI backend, cloud workspace, managed gateway, product credits, production login, marketplace, publishing, signing, notarization, autonomy, or real-provider CI claim: <checked | issue fixed before sharing | not run>

## Known issues

- Known issues: <sanitized issue list or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
`;

const requiredPatterns = [
  ["top-level heading", /^# Yet AI Manual Agent Run RC Report$/m],
  ["manual local evidence warning", /Manual local evidence only/],
  ["not CI warning", /not CI evidence/],
  ["not automation warning", /not automation evidence/],
  ["not real-provider CI warning", /not real-provider CI evidence/],
  ["not production release warning", /not production release evidence/],
  ["not marketplace readiness warning", /not marketplace readiness evidence/],
  ["run metadata heading", /^## Run metadata$/m],
  ["commit artifact label field", /- Commit\/artifact label:/],
  ["host field", /- Host:/],
  ["runtime connection status field", /- Runtime connection status:/],
  ["provider family model id field", /- Provider family\/model id:/],
  ["RC scope field", /- RC scope:/],
  ["context boundary heading", /^## Context boundary$/m],
  ["explicit context attached field", /- Explicit context attached:/],
  ["explicit context omitted field", /- Explicit context omitted:/],
  ["manual Agent Run evidence heading", /^## Manual Agent Run evidence$/m],
  ["send evidence field", /- Send evidence:/],
  ["apply evidence field", /- Apply evidence:/],
  ["verify evidence field", /- Verify evidence:/],
  ["proposal status field", /- Proposal status:/],
  ["checkpoint status field", /- Checkpoint status:/],
  ["final result status field", /- Final result status:/],
  ["safety checklist heading", /^## Safety checklist$/m],
  ["provider secrets check", /- Provider secrets absent:/],
  ["tokens cookies auth check", /- Bearer tokens, cookies, auth codes, OAuth\/runtime tokens absent:/],
  ["private absolute paths check", /- Private absolute paths absent:/],
  ["raw dumps check", /- Prompt\/provider response\/file body\/diff\/patch body dumps absent:/],
  ["command cwd env storage bridge check", /- Command strings, cwd, env, browser storage, and bridge payload dumps absent:/],
  ["known issues heading", /^## Known issues$/m],
  ["known issues field", /- Known issues:/],
  ["explicit not run values", /not run/]
];

const unsafeChecks = [
  ["provider API keys", /\bsk-(?:proj-)?[A-Za-z0-9_\-]{8,}\b|\b(?:api[_-]?key|apikey|provider[_-]?key|openai[_-]?key|secret[_-]?key)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["bearer tokens", /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*\S+)/i],
  ["auth codes and OAuth tokens", /\b(?:auth[_-]?code|authorization[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|pkce[_-]?verifier|code[_-]?verifier)\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["cookies", /\b(?:Cookie|Set-Cookie)\s*:\s*\S+|\bcookie\b\s*[:=]\s*[^\s<][^\r\n]*/i],
  ["runtime tokens", /\b(?:YET_AI_AUTH_TOKEN|session[_ -]?token|runtime[_ -]?token)\b\s*[:=]\s*[^\s<][^\r\n]*|\blocal-dev-token\b/i],
  ["private absolute paths", /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|\/Volumes\/[A-Za-z0-9._ -]+\/|\/(?:var|tmp|private|opt|mnt|srv)\/[A-Za-z0-9._ -]+\/|\b[A-Za-z]:\\[^\s"'<>]+|\\\\[^\s"'<>\\]+\\[^\s"'<>\\]+)/],
  ["secret URL query or fragment values", /[?#&](?:access_token|refresh_token|id_token|api_key|apikey|key|token|code|secret|auth_code|authorization_code|code_verifier|cookie)=/i],
  ["raw prompts", /\b(?:raw\s+prompt|prompt\s+dump|verbatim\s+prompt|full\s+prompt\s+text)\b/i],
  ["raw provider responses", /\b(?:raw\s+provider\s+response|provider\s+response\s+body|provider\s+json\s+dump|completion\s+response\s+dump|verbatim\s+provider\s+output)\b/i],
  ["raw file bodies", /\b(?:file\s+contents?|source\s+contents?|document\s+contents?|full\s+file\s+text|raw\s+file\s+body|verbatim\s+source)\b/i],
  ["raw diffs or patch bodies", /\b(?:raw\s+diff\s*[:=]|diff\s+dump\s*[:=]?|patch\s+body\s*[:=]|raw\s+patch\s*[:=]|patch\s+dump\s*[:=]?|verbatim\s+diff\s*[:=]?)/i],
  ["command strings or cwd/env", /\b(?:command\s*[:=]\s*[^\s<][^\r\n]*|cwd\s*[:=]\s*[^\s<][^\r\n]*|env\s*[:=]\s*[^\s<][^\r\n]*|process\.env)/i],
  ["browser-storage dumps", /\b(?:localStorage|sessionStorage|indexedDB|browser\s+storage\s+dump|storage\s+dump|workspace\s+storage\s+dump)\b/i],
  ["raw bridge payload dumps", /\b(?:raw\s+bridge\s+payload\s*[:=]|bridge\s+payload\s+dump\s*[:=]|bridge\s+payload\s*[:=]|request\s+body\s*[:=]|raw\s+request\s*[:=])/i]
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
  console.error(`${label} failed manual Agent Run RC report validation:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function runSelfTest() {
  const unsafeSamples = [
    ["provider API keys", "api_key=redacted-example-key"],
    ["provider API keys", "sk-redactedexample123456"],
    ["bearer tokens", "Authorization: Bearer redacted-example-token"],
    ["auth codes and OAuth tokens", "authorization_code=redacted-example-code"],
    ["auth codes and OAuth tokens", "refresh_token=redacted-example-token"],
    ["cookies", "Cookie: sid=redacted"],
    ["runtime tokens", "runtime token: redacted-example-token"],
    ["private absolute paths", "/Users/example/project/report.md"],
    ["private absolute paths", "C:\\Users\\example\\report.md"],
    ["secret URL query or fragment values", "http://127.0.0.1/callback?code=redacted"],
    ["raw prompts", "raw prompt: implement the feature"],
    ["raw provider responses", "raw provider response: {}"],
    ["raw file bodies", "file contents: const value = 1;"],
    ["raw diffs or patch bodies", "raw diff: @@ -1 +1"],
    ["raw diffs or patch bodies", "patch body: replace the whole file"],
    ["command strings or cwd/env", "Command: npm test"],
    ["command strings or cwd/env", "cwd=/Users/example/project"],
    ["command strings or cwd/env", "env=TOKEN=redacted"],
    ["browser-storage dumps", "localStorage: { token: redacted }"],
    ["raw bridge payload dumps", "bridge payload: { action: send }"],
    ["raw bridge payload dumps", "request body: {}"]
  ];
  const validSanitizedExample = template
    .replace("<git commit or sanitized artifact family/name | local dev checkout | not run>", "local dev checkout")
    .replace("<browser | VS Code | JetBrains | not run>", "VS Code")
    .replace("<connected | failed with sanitized summary | not run>", "connected")
    .replace("<provider family and non-secret model id only | local runtime family/id only | not run>", "local runtime family/id only")
    .replace("<active-file excerpt | snippet | memory note | verification output label | manual note | none | not run>", "snippet")
    .replace("<intentionally omitted | not applicable | not run>", "not applicable")
    .replace("<sanitized labels/counts only | reviewed bounded excerpt only | issue fixed before sharing | not run>", "sanitized labels/counts only")
    .replace("<user clicked Send manually | skipped | failed with sanitized summary | not run>", "user clicked Send manually")
    .replace("<user clicked Apply manually | blocked | skipped | failed/rejected with sanitized summary | not run>", "blocked")
    .replace("<user clicked Verification manually | skipped | failed with sanitized summary | not run>", "skipped")
    .replace("<checked | issue found with sanitized summary | not run>", "checked")
    .replace("<detected and reviewable | rejected by safety/parser checks | absent | failed with sanitized summary | not run>", "detected and reviewable")
    .replace("<verified | missing | stale | blocked | not needed | not run>", "verified")
    .replace("<completed after manual verification | stopped before apply | stopped after failed apply | stopped after failed verification | stopped after proposal rejection | not run>", "stopped before apply")
    .replaceAll("<checked | issue fixed before sharing | not run>", "checked")
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
  failures.push(...validateTemplate(template).map((failure) => `template ${failure}`));
  exitWithValidation("self-test", failures);
}

function printHelp() {
  console.log(`Usage:
  npm run report:agent-run-rc -- --template
  npm run report:agent-run-rc -- --check-template
  npm run report:agent-run-rc -- --check path/to/report.md
  npm run report:agent-run-rc -- --self-test

Generates or checks sanitized manual local Agent Run release-candidate dogfood evidence. It never calls providers, launches runtimes, contacts networks, writes reports by default, or proves production, marketplace, autonomy, or real-provider CI readiness.`);
}
