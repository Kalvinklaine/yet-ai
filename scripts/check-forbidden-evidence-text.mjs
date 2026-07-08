import { findForbiddenEvidenceText, formatForbiddenEvidenceFailures, hasForbiddenEvidenceText } from "./lib/forbidden-evidence-text.mjs";

const failures = [];

const safeExamples = [
  ["relative source path", "src/file.ts"],
  ["workspace label", "apps/gui/src/App.tsx: Yet AI dev-preview fixture passed"],
  ["redacted secret wording", "Provider credentials are redacted and raw prompt text is omitted."],
  ["bounded artifact path", "dist/plugins/vscode/yet-ai-dev-preview.vsix"],
  ["http local callback without secret", "http://127.0.0.1:5173/callback"]
];

const unsafeExamples = [
  ["macos home path", "Evidence path: /Users/alice/project/report.md"],
  ["linux home path", "Evidence path: /home/alice/project/report.md"],
  ["posix private path", "Evidence path: /tmp/yet-ai/private-output.txt"],
  ["windows user path", "Evidence path: C:\\Users\\Alice\\project\\report.md"],
  ["windows unc path", "Evidence path: \\\\server\\share\\private.txt"],
  ["file url macos", "Open file:///Users/alice/project/report.md"],
  ["file url windows", "Open file:///C:/Users/Alice/project/report.md"],
  ["bearer token", "Authorization: Bearer abcdefgh123456"],
  ["cookie header", "Cookie: sid=secret-session"],
  ["query token", "http://127.0.0.1/callback?access_token=secret-token"],
  ["fragment token", "http://127.0.0.1/callback#id_token=secret-token"],
  ["api key", "api_key: sk-exampleSecret123"],
  ["runtime token", "runtime token: local-secret-token"],
  ["raw command", "command: cat /etc/passwd"],
  ["raw output", "stdout: complete terminal output"],
  ["raw prompt", "raw prompt: implement this private request"],
  ["provider payload", "provider payload: {\"messages\":[\"private\"]}"],
  ["bridge payload", "bridge payload: {\"secret\":true}"],
  ["browser storage", "localStorage: {\"token\":\"secret\"}"],
  ["file body", "file contents: export const secret = true;"],
  ["patch body", "patch body: diff --git a/private b/private"]
];

for (const [label, text] of safeExamples) {
  const matches = findForbiddenEvidenceText(text, { label, allowPolicyLines: true });
  if (matches.length > 0) {
    failures.push(`${label}: safe example was rejected as ${matches.map((match) => match.category).join(", ")}`);
  }
  if (hasForbiddenEvidenceText(text, { allowPolicyLines: true })) {
    failures.push(`${label}: hasForbiddenEvidenceText returned true for safe example`);
  }
}

for (const [label, text] of unsafeExamples) {
  const matches = findForbiddenEvidenceText(text, { label });
  if (matches.length === 0) {
    failures.push(`${label}: unsafe example was not rejected`);
    continue;
  }
  const formatted = formatForbiddenEvidenceFailures(matches);
  if (formatted.some((line) => line.includes(text))) {
    failures.push(`${label}: formatted failure leaked raw unsafe text`);
  }
  if (!hasForbiddenEvidenceText(text)) {
    failures.push(`${label}: hasForbiddenEvidenceText returned false for unsafe example`);
  }
}

const multiLineMatches = findForbiddenEvidenceText(["safe heading", "Evidence path: /home/alice/project/report.md"].join("\n"), { label: "multi-line" });
if (multiLineMatches.length === 0 || multiLineMatches[0].line !== 2) {
  failures.push("multi-line: expected unsafe match on line 2");
}

const unsafeLabelFailures = formatForbiddenEvidenceFailures([{ label: "/Users/alice/private/report.md?token=secret", category: "test category", line: 1 }]);
if (unsafeLabelFailures.some((line) => line.includes("/Users/alice") || line.includes("token=secret"))) {
  failures.push("unsafe label: formatted failure leaked raw unsafe label text");
}

if (failures.length > 0) {
  console.error("Forbidden evidence text validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Forbidden evidence text validation passed for ${safeExamples.length} safe examples and ${unsafeExamples.length} rejected unsafe examples.`);
