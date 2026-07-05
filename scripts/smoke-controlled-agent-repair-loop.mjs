import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const smokeName = "Controlled Agent repair loop smoke";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const rawMarkers = [
  "raw repair output from smoke",
  "raw diff from repair smoke",
  "raw patch from repair smoke",
  "npm run hidden-repair",
  "provider repair payload",
  "shell git network package tool repair claim",
  "/Users/private/repair-loop",
  "sk-repair-loop-secret",
];

const { evaluateControlledAgentRepairLoop } = await importRepairLoopService();

const failedVerification = {
  verification: {
    status: "failed",
    result: { status: "failed", exitCode: 1, message: "Failed allowlisted verification can be reviewed." },
  },
  summary: "Failed allowlisted verification can be reviewed for one bounded repair attempt.",
};

const eligible = evaluateControlledAgentRepairLoop(failedVerification);
assert.equal(eligible.state, "eligible", "failed verification becomes repair-eligible");
assert.equal(eligible.canAttemptRepair, true, "eligible failed verification can attempt repair after confirmation");
assert.equal(eligible.mustStop, false, "eligible metadata does not stop before user choice");
assert.equal(eligible.attemptCount, 0, "eligible state starts with zero repair attempts");
assert.equal(eligible.maxAttempts, 1, "repair loop allows exactly one attempt");
assert.equal(eligible.verificationRuns, 1, "failed verification evidence is counted");
assert.equal(eligible.userTurns, 0, "confirmation is not implied");
assert.equal(eligible.details.repairEnabled, true, "repair eligibility is display metadata only");
assert.equal(eligible.details.previousVerificationStatus, "failed", "previous failed status is preserved as sanitized evidence");
assertNoAuthority(eligible, "eligible failed verification");
assertNoRawMarkers(eligible, "eligible failed verification");

const timedOut = evaluateControlledAgentRepairLoop({ verificationStatus: "timed_out", summary: "Timed out allowlisted verification can be reviewed." });
assert.equal(timedOut.state, "eligible", "timed-out verification is eligible like failure");
assert.equal(timedOut.canAttemptRepair, true, "timed-out verification can enter one confirmed repair attempt");
assertNoAuthority(timedOut, "timed-out eligibility");

const missingConfirmation = evaluateControlledAgentRepairLoop({
  ...failedVerification,
  proposal: { state: "planned", summary: "Sanitized proposal should wait for confirmation." },
});
assert.equal(missingConfirmation.state, "blocked", "repair metadata before confirmation is blocked");
assert.equal(missingConfirmation.stop?.reason, "missing_user_confirmation", "explicit user confirmation is required before repair metadata");
assert.equal(missingConfirmation.canAttemptRepair, false, "unconfirmed repair metadata is not actionable");
assertNoAuthority(missingConfirmation, "missing confirmation block");

const confirmedNoMetadata = evaluateControlledAgentRepairLoop({ ...failedVerification, userConfirmed: true });
assert.equal(confirmedNoMetadata.state, "eligible", "confirmed repair can remain eligible before proposal metadata");
assert.equal(confirmedNoMetadata.userTurns, 1, "confirmation records one user turn");
assert.equal(confirmedNoMetadata.details.repairCycleStarted, true, "confirmed repair cycle is display-only metadata");
assertNoAuthority(confirmedNoMetadata, "confirmed repair before proposal");

const proposalReady = evaluateControlledAgentRepairLoop({
  ...failedVerification,
  userConfirmed: true,
  proposal: { state: "planned", summary: "Sanitized repair proposal ready." },
});
assert.equal(proposalReady.state, "proposal_ready", "user-confirmed proposal metadata reaches proposal-ready state");
assert.equal(proposalReady.canAttemptRepair, true, "proposal-ready state remains within the one attempt budget");
assert.equal(proposalReady.attemptCount, 0, "proposal metadata does not consume the attempt yet");
assertNoAuthority(proposalReady, "proposal-ready repair state");

const editApplied = evaluateControlledAgentRepairLoop({
  ...failedVerification,
  userConfirmed: true,
  proposal: { state: "completed", summary: "Sanitized repair proposal ready." },
  edit: { state: "applied", summary: "Sanitized bounded repair edit applied." },
});
assert.equal(editApplied.state, "edit_applied", "bounded repair edit metadata can be recorded after proposal");
assert.equal(editApplied.canAttemptRepair, true, "edit-applied state can proceed only to the single repair verification");
assert.equal(editApplied.attemptCount, 0, "attempt is consumed by terminal repair verification, not proposal/edit metadata");
assertNoAuthority(editApplied, "edit-applied repair state");

const repaired = evaluateControlledAgentRepairLoop({
  ...failedVerification,
  userConfirmed: true,
  proposal: { state: "completed", summary: "Sanitized repair proposal ready." },
  edit: { state: "applied", summary: "Sanitized bounded repair edit applied." },
  repairVerification: { status: "succeeded", result: { status: "succeeded", exitCode: 0, message: "Repair verification passed." } },
});
assert.equal(repaired.state, "repaired", "successful repair verification reaches terminal repaired state");
assert.equal(repaired.canAttemptRepair, false, "terminal repaired state cannot attempt another repair");
assert.equal(repaired.mustStop, true, "terminal repaired state stops the loop");
assert.equal(repaired.attemptCount, 1, "successful repair consumes the one attempt");
assert.equal(repaired.maxAttempts, 1, "successful repair remains one-attempt max");
assert.equal(repaired.verificationRuns, 1, "repair verification count stays bounded");
assertNoAuthority(repaired, "repaired terminal state");

const exhaustedByFailedRepair = evaluateControlledAgentRepairLoop({
  ...failedVerification,
  userConfirmed: true,
  proposal: { state: "completed", summary: "Sanitized repair proposal ready." },
  edit: { state: "applied", summary: "Sanitized bounded repair edit applied." },
  repairVerification: { status: "failed", result: { status: "failed", exitCode: 1, message: "Repair verification failed." } },
});
assert.equal(exhaustedByFailedRepair.state, "exhausted", "failed repair verification exhausts the single repair attempt");
assert.equal(exhaustedByFailedRepair.attemptCount, 1, "failed repair consumes exactly one attempt");
assert.equal(exhaustedByFailedRepair.canAttemptRepair, false, "no second repair attempt is allowed after failed repair verification");
assertNoAuthority(exhaustedByFailedRepair, "failed repair exhausted state");

const exhaustedByBudget = evaluateControlledAgentRepairLoop({ ...failedVerification, attemptCount: 1 });
assert.equal(exhaustedByBudget.state, "exhausted", "existing attempt count blocks another repair");
assert.equal(exhaustedByBudget.stop?.reason, "attempts_exhausted", "attempt cap reports exhausted stop reason");
assert.equal(exhaustedByBudget.maxAttempts, 1, "attempt cap is fixed at one");
assert.equal(exhaustedByBudget.canAttemptRepair, false, "attempt cap prevents additional repair");
assertNoAuthority(exhaustedByBudget, "attempt cap exhausted state");

const nonFailedStatuses = ["succeeded", "running", "blocked", "disabled", "killed"];
for (const status of nonFailedStatuses) {
  const evaluation = evaluateControlledAgentRepairLoop({ verificationStatus: status, summary: `${status} verification is not eligible.` });
  assert.equal(evaluation.state, "blocked", `${status} verification is blocked`);
  assert.equal(evaluation.stop?.reason, "ineligible_verification_status", `${status} reports ineligible status`);
  assert.equal(evaluation.canAttemptRepair, false, `${status} cannot attempt repair`);
  assertNoAuthority(evaluation, `${status} non-failed status`);
}

const unsafeMetadata = evaluateControlledAgentRepairLoop({
  ...failedVerification,
  rawOutput: rawMarkers[0],
  details: { privatePath: rawMarkers[6], providerPayload: rawMarkers[4] },
});
assert.equal(unsafeMetadata.state, "blocked", "unsafe metadata blocks repair loop");
assert.equal(unsafeMetadata.stop?.reason, "unsafe_metadata", "unsafe metadata stop reason is preserved");
assert.equal(unsafeMetadata.canAttemptRepair, false, "unsafe metadata cannot attempt repair");
assert.equal(unsafeMetadata.diagnostics.some((item) => item.code === "unsafe_metadata"), true, "unsafe diagnostic is present");
assertNoAuthority(unsafeMetadata, "unsafe metadata block");
assertNoRawMarkers(unsafeMetadata, "unsafe metadata block");

const userStopped = evaluateControlledAgentRepairLoop({ ...failedVerification, userStopped: true });
assert.equal(userStopped.state, "stopped", "explicit user stop stops repair loop");
assert.equal(userStopped.stop?.reason, "user_stop", "user stop reason is preserved");
assert.equal(userStopped.stop?.recoverable, true, "user stop is recoverable display metadata");
assert.equal(userStopped.canAttemptRepair, false, "stopped state cannot attempt repair");
assertNoAuthority(userStopped, "user stop state");

const malformed = evaluateControlledAgentRepairLoop(undefined);
assert.equal(malformed.state, "disabled", "missing input stays disabled");
assert.equal(malformed.canAttemptRepair, false, "missing input has no repair action");
assertNoAuthority(malformed, "disabled missing input");

const smokeReport = {
  smoke: smokeName,
  finalStates: {
    failedVerification: eligible.state,
    confirmedProposal: proposalReady.state,
    repairSucceeded: repaired.state,
    repairFailed: exhaustedByFailedRepair.state,
    userStopped: userStopped.state,
    unsafeMetadata: unsafeMetadata.state,
  },
  boundaries: {
    failedVerificationEligible: eligible.canAttemptRepair,
    explicitUserConfirmationRequired: missingConfirmation.stop?.reason === "missing_user_confirmation",
    maxAttempts: repaired.maxAttempts,
    nonFailedVerificationIneligible: true,
    unsafeMetadataBlocks: unsafeMetadata.stop?.reason === "unsafe_metadata",
    userStopStops: userStopped.stop?.reason === "user_stop",
    executionAllowed: false,
    providerAuthority: false,
    networkAuthority: false,
    shellAuthority: false,
    broadWorkspaceAuthority: false,
    automaticRepair: false,
    rawPersistenceAllowed: false,
  },
};
assertNoRawMarkers(smokeReport, "sanitized smoke report");

console.log(`${smokeName} passed.`);
console.log("Verified failed/timed-out verification eligibility, explicit confirmation, proposal/edit/verification repair states, one-attempt exhaustion, non-failed ineligibility, unsafe metadata blocking, and user stop behavior.");
console.log("This smoke is deterministic local/mock evidence only: no runtime/provider/network authority, automatic repair, multiple repairs, hidden reads/search/indexing, broad mutation, shell/git/package/tool authority, raw persistence, real-provider CI, or production autonomy claim.");

function assertNoAuthority(state, label) {
  assert.equal(state.authority, "repair_loop_metadata_only", `${label} uses repair metadata-only authority`);
  assert.equal(state.cloudRequired, false, `${label} cloudRequired stays false`);
  assert.equal(state.executionAllowed, false, `${label} executionAllowed stays false`);
  assert.equal(state.agentStartAllowed, false, `${label} agentStartAllowed stays false`);
  assert.equal(state.autoStartAllowed, false, `${label} autoStartAllowed stays false`);
  assert.equal(state.canReadFiles, false, `${label} canReadFiles stays false`);
  assert.equal(state.canWriteFiles, false, `${label} canWriteFiles stays false`);
  assert.equal(state.canRunCommands, false, `${label} canRunCommands stays false`);
  assert.equal(state.canApplyEdits, false, `${label} canApplyEdits stays false`);
  assert.equal(state.canCallProvider, false, `${label} canCallProvider stays false`);
  assert.equal(state.canUseGit, false, `${label} canUseGit stays false`);
  assert.equal(state.canUseNetwork, false, `${label} canUseNetwork stays false`);
  assert.equal(state.canUseTools, false, `${label} canUseTools stays false`);
  assert.equal(state.canInstallPackages, false, `${label} canInstallPackages stays false`);
}

function assertNoRawMarkers(value, source) {
  const text = JSON.stringify(value).toLowerCase();
  for (const [index, marker] of rawMarkers.entries()) {
    assert.equal(text.includes(marker.toLowerCase()), false, `Raw marker ${index + 1} leaked through ${source}`);
  }
}

async function importRepairLoopService() {
  const { imports, cleanup } = await transpileGuiServices(["services/controlledAgentRepairLoop.ts"]);
  try {
    return imports.get("services/controlledAgentRepairLoop.ts");
  } finally {
    await cleanup();
  }
}

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-controlled-repair-loop-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const sourcePath = queue[index];
    if (seen.has(sourcePath)) {
      continue;
    }
    seen.add(sourcePath);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = join(dirname(sourcePath), `${match[1]}.ts`);
      if (dependency.startsWith(guiSrcRoot) && !seen.has(dependency)) {
        queue.push(dependency);
      }
    }
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
    const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
    const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rewritten);
  }
  const imports = new Map();
  for (const entry of entries) {
    imports.set(entry, await import(pathToFileURL(join(outRoot, entry.replace(/\.ts$/, ".mjs"))).href));
  }
  return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
}
