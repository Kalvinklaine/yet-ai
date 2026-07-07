import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const smokeName = "S96 useful-run smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(repoRoot, "docs", "dogfood", "fixtures", "controlled-agent-dev-preview", "vscode-success-bounded-read-edit-verify.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

const labels = {
  start: "Explicit user Start label: VS Code user-owned start",
  read: `Bounded read label: ${fixture.boundedReadMetadata.fileLabel}`,
  edit: `Bounded replacement edit label: ${fixture.boundedEditMetadata.fileLabel}`,
  verification: `Allowlisted verification command id label: ${fixture.verificationMetadata.commandId}`,
  terminalReport: `Sanitized terminal report label: ${fixture.finalReportStatus.status}`,
};

assert.equal(fixture.host, "vscode", "S96 useful-run evidence stays VS Code-first");
assert.equal(fixture.startCondition.status, "explicit-user-start", "explicit Start is required");
assert.equal(fixture.boundedReadMetadata.status, "completed", "one bounded read completed");
assert.equal(fixture.boundedReadMetadata.contentCaptured, false, "bounded read output omits file body");
assert.equal(fixture.boundedReadMetadata.byteLimit <= 8192, true, "bounded read byte limit remains small");
assert.equal(fixture.boundedReadMetadata.lineLimit <= 240, true, "bounded read line limit remains small");
assert.equal(fixture.boundedEditMetadata.status, "completed", "one bounded edit completed");
assert.equal(fixture.boundedEditMetadata.editKind, "single-existing-text-replacement", "edit is one replacement to an existing text file");
assert.equal(fixture.boundedEditMetadata.filesTouched, 1, "edit touches one file");
assert.equal(fixture.boundedEditMetadata.replacementCaptured, false, "edit output omits replacement text");
assert.equal(fixture.verificationMetadata.status, "succeeded", "allowlisted verification succeeded");
assert.match(fixture.verificationMetadata.commandId, /^(repository-check|gui-app-tests|engine-chat-tests)$/, "verification uses an allowlisted command id");
assert.equal(fixture.verificationMetadata.outputCaptured, false, "verification output is not captured");
assert.equal(fixture.finalReportStatus.status, "completed", "terminal report is completed");
assert.equal(fixture.finalReportStatus.safeEvidenceCount, 5, "terminal report carries five safe evidence labels");
assert.deepEqual(Object.keys(labels), ["start", "read", "edit", "verification", "terminalReport"], "smoke reports exactly the S96 label set");

const report = {
  smoke: smokeName,
  labels,
  counters: {
    starts: 1,
    boundedReads: 1,
    boundedReplacementEdits: 1,
    allowlistedVerificationRuns: 1,
    sanitizedTerminalReports: 1,
  },
  deniedAuthority: {
    realProvider: false,
    realIde: false,
    shellOrGitOrNetworkOrTool: false,
    hiddenReadSearchIndexing: false,
    autoRepair: false,
    broadMutation: false,
  },
};

assertNoRawMarkers(report);

const outputLines = [
  `${smokeName} passed.`,
  `Verified labels: ${Object.values(labels).join("; ")}.`,
  "Verified deterministic local/mock S96 evidence only: no real provider, real IDE, shell, git, network, tool authority, hidden reads/search/indexing, auto-repair, or broad mutation.",
  "Verified smoke output uses safe labels and omits sensitive source, execution, location, credential, and provider markers.",
];

assertNoRawMarkers(outputLines);
for (const line of outputLines) console.log(line);

function assertNoRawMarkers(value) {
  const text = JSON.stringify(value).toLowerCase();
  const rawMarkers = [
    "raw prompt",
    "raw file body",
    "raw diff",
    "replacement text should not leak",
    "npm run hidden",
    "s96-command-output-marker",
    "provider payload",
    "/users/private",
    "/home/private",
    "sk-s96-secret",
    "begin private key",
  ];
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `Unsafe marker leaked: ${marker}`);
  }
}
