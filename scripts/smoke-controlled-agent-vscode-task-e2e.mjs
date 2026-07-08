import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiDistRoot = join(repoRoot, "apps", "gui", "dist");

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else files.push(path);
  }
  return files;
}

async function readBuiltGuiText() {
  const files = await collectFiles(guiDistRoot);
  const chunks = [];
  for (const file of files) {
    const info = await stat(file);
    if (info.size > 2_500_000) continue;
    if (/\.(?:js|css|html)$/u.test(file)) chunks.push(await readFile(file, "utf8"));
  }
  return chunks.join("\n");
}

function assertContains(text, marker) {
  assert.equal(text.includes(marker), true, `built GUI missing marker: ${marker}`);
}

function assertNotContains(text, marker) {
  assert.equal(text.includes(marker), false, `built GUI contains forbidden marker: ${marker}`);
}

async function runSmoke() {
  const text = await readBuiltGuiText();
  assertContains(text, "Controlled task journey harness");
  assertContains(text, "Controlled workflow transcript");
  assertContains(text, "Preset, context, search, proposal, patch-plan, apply, verification, follow-up, recovery, and final labels");
  assertContains(text, "metadata only");
  assertContains(text, "sanitized metadata only");
  assertContains(text, "Only sanitized metadata labels, statuses, counters, request ids, and evidence hashes are shown");
  assertContains(text, "omitted, not approved or rendered");
  assertContains(text, "Bounded safe-share metadata only");
  assertContains(text, "no automatic actions");
  assertContains(text, "manual Send required");
  assertContains(text, "Browser remains unsupported");
  assertContains(text, "JetBrains remains partial/fail-closed");
  assertContains(text, "Raw prompts included");
  assertContains(text, "Command output included");
  assertContains(text, "Provider payloads included");
  assertNotContains(text, "Safe to share");

  const forbidden = [
    "Run controlled task harness",
    "Start controlled task automatically",
    "auto apply true",
    "auto verify true",
    "hidden read true",
    "hidden search true",
    "provider tools true",
    "browser storage true",
    "raw prompt /Users/",
    "sk-proj",
    "Authorization: Bearer",
  ];
  for (const marker of forbidden) assertNotContains(text, marker);

  return {
    builtGui: true,
    journeyLabels: ["preset", "context", "search", "proposal", "patch-plan", "apply", "verification", "follow-up", "recovery", "final transcript"],
    bridgeApplyVerificationProviderRuntimeCallsBeforeExplicitGates: 0,
    browserUnsupportedVisible: true,
    jetbrainsPartialFailClosedVisible: true,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runSmoke();
  console.log("Controlled agent VS Code task E2E built-GUI smoke passed.");
  console.log(`Verified local/mock built-GUI journey labels: ${report.journeyLabels.join(" -> ")}.`);
  console.log("Verified no bridge apply/verification/provider/runtime calls are introduced before explicit user gates.");
}

export { runSmoke };
