import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const docPath = "docs/architecture/018-controlled-agent-authority-registry.md";
const registryPath = "packages/contracts/examples/engine/controlled-agent-authority-registry-v1.json";
const invalidDir = "packages/contracts/examples-invalid/engine";
const invalidPrefix = "controlled-agent-authority-registry-";

const failures = [];
const docText = await readFile(docPath, "utf8");
const registryText = await readFile(registryPath, "utf8");
const registry = JSON.parse(registryText);
const invalidFiles = (await readdir(invalidDir)).filter((file) => file.startsWith(invalidPrefix) && file.endsWith(".json")).sort();
const invalidTexts = await Promise.all(invalidFiles.map(async (file) => [file, await readFile(join(invalidDir, file), "utf8")]));
const corpus = normalize([docText, registryText, ...invalidTexts.flat()].join("\n"));

const requiredConcepts = [
  ["file read", [/file read/, /fileread|file read/]],
  ["lexical search", [/lexical search/, /lexicalsearch|literal query/]],
  ["edit/apply", [/edit\/apply|edit apply/, /editapply|replacement/]],
  ["verification", [/verification/, /verificationcommandids|command ids?/]],
  ["provider proposal", [/provider proposal/, /providerproposaluse|proposal metadata/]],
  ["memory", [/memory/, /memoryattachment|memory attachment/]],
  ["history/report/export/observability", [/history/, /report/, /export/, /observability/]],
  ["host actions", [/host actions?/, /hostactions/]],
  ["unsupported operations", [/unsupported privileged operations?/, /unsupportedprivilegedoperations/]],
  ["explicit user gesture/correlation", [/explicit user action|user gesture/, /correlation/]],
  ["Browser unsupported for trusted workspace execution", [/browser/, /unsupported for trusted execution|unsupported_for_trusted_execution|unsupported for trusted workspace execution/]],
  ["JetBrains fail-closed unless separately verified", [/jetbrains/, /fail closed|fail-closed|fail_closed_until_verified/]],
  ["VS Code first execution host", [/vs code|vscode/, /first execution host|first_execution_host/]],
  ["no hidden reads/indexing", [/hidden reads?|hidden read|hidden files?|nobackgroundreads/, /indexing|project index/]],
  ["no arbitrary shell/git/package/network/provider-tool/local-tool authority", [/shell/, /git/, /package/, /network/, /provider tool|providertool/, /local tool|localtool/]],
  ["no raw sensitive persistence", [/raw/, /sensitive|secret|payload|file contents?|prompts?/, /persist|stored|storage/]],
  ["no production/release/marketplace claim", [/production/, /release/, /marketplace/]]
];

const requiredCategories = [
  "fileRead",
  "lexicalSearch",
  "editApply",
  "verificationCommandIds",
  "providerProposalUse",
  "memoryAttachment",
  "runHistoryReportExportObservabilityWrites",
  "hostActions",
  "unsupportedPrivilegedOperations"
];

const requiredInvalidFiles = [
  "controlled-agent-authority-registry-raw-payload-fields.json",
  "controlled-agent-authority-registry-unsupported-host-execution.json",
  "controlled-agent-authority-registry-hidden-search-indexing.json",
  "controlled-agent-authority-registry-freeform-command-cwd-env.json",
  "controlled-agent-authority-registry-broad-mutation.json",
  "controlled-agent-authority-registry-provider-tool-authority.json",
  "controlled-agent-authority-registry-production-release-claims.json"
];

for (const [label, patterns] of requiredConcepts) {
  if (!patterns.every((pattern) => pattern.test(corpus))) {
    failures.push(`missing concept: ${label}`);
  }
}

for (const category of requiredCategories) {
  if (!(category in (registry.categories ?? {}))) {
    failures.push(`registry missing category: ${category}`);
  }
}

for (const file of requiredInvalidFiles) {
  if (!invalidFiles.includes(file)) {
    failures.push(`missing invalid fixture: ${file}`);
  }
}

checkRegistryShape();
checkInvalidFixtures();
checkDocsMentionLocalCheck();

if (failures.length > 0) {
  console.error("Controlled agent authority registry check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Controlled agent authority registry check passed (${requiredCategories.length} categories, ${invalidFiles.length} invalid fixtures).`);

function checkRegistryShape() {
  try {
    assert.equal(registry.kind, "controlled_agent_authority_registry");
    assert.equal(registry.authority, "s109_fail_closed_registry_contract");
    assert.equal(registry.status, "dev_preview_contract_only");
    assert.equal(registry.localFirstByok, true);
    assert.equal(registry.cloudRequired, false);
    assert.equal(registry.productionClaimAllowed, false);
    assert.equal(registry.releaseClaimAllowed, false);
    assert.equal(registry.marketplaceClaimAllowed, false);
    assert.equal(registry.userGesture?.required, true);
    assert.equal(registry.userGesture?.correlationRequired, true);
    assert.equal(registry.userGesture?.assistantMayMintRequests, false);
    assert.equal(registry.hosts?.browser?.trustedExecution, false);
    assert.equal(registry.hosts?.browser?.supportState, "unsupported_for_trusted_execution");
    assert.equal(registry.hosts?.vscode?.trustedExecution, true);
    assert.equal(registry.hosts?.vscode?.supportState, "first_execution_host");
    assert.equal(registry.hosts?.jetbrains?.trustedExecution, false);
    assert.equal(registry.hosts?.jetbrains?.supportState, "fail_closed_until_verified");
    assert.equal(registry.categories.fileRead.noBackgroundReads, true);
    assert.equal(registry.categories.lexicalSearch.hiddenSearchAllowed, false);
    assert.equal(registry.categories.lexicalSearch.indexingAllowed, false);
    assert.equal(registry.categories.editApply.broadMutationAllowed, false);
    assert.equal(registry.categories.editApply.automaticApplyAllowed, false);
    assert.equal(registry.categories.verificationCommandIds.allowlistedCommandIdOnly, true);
    assert.equal(registry.categories.verificationCommandIds.freeformCommandAllowed, false);
    assert.equal(registry.categories.verificationCommandIds.cwdAllowed, false);
    assert.equal(registry.categories.verificationCommandIds.envAllowed, false);
    assert.equal(registry.categories.providerProposalUse.providerToolAuthorityAllowed, false);
    assert.equal(registry.categories.providerProposalUse.localToolAuthorityAllowed, false);
    assert.equal(registry.categories.providerProposalUse.rawProviderPayloadStored, false);
    assert.equal(registry.categories.memoryAttachment.explicitAttachmentOnly, true);
    assert.equal(registry.categories.memoryAttachment.automaticMemorySelectionAllowed, false);
    assert.equal(registry.categories.runHistoryReportExportObservabilityWrites.sanitizedMetadataOnly, true);
    assert.equal(registry.categories.runHistoryReportExportObservabilityWrites.rawPromptStored, false);
    assert.equal(registry.categories.runHistoryReportExportObservabilityWrites.rawFileStored, false);
    assert.equal(registry.categories.runHistoryReportExportObservabilityWrites.rawCommandStored, false);
    assert.equal(registry.categories.runHistoryReportExportObservabilityWrites.rawProviderStored, false);
    assert.equal(registry.categories.hostActions.packageUpdateAllowed, false);
    assert.equal(registry.categories.hostActions.taskBoardMutationAllowed, false);
    assert.equal(registry.categories.unsupportedPrivilegedOperations.shellAllowed, false);
    assert.equal(registry.categories.unsupportedPrivilegedOperations.gitAllowed, false);
    assert.equal(registry.categories.unsupportedPrivilegedOperations.networkAllowed, false);
    assert.equal(registry.categories.unsupportedPrivilegedOperations.packageInstallAllowed, false);
    assert.equal(registry.categories.unsupportedPrivilegedOperations.releaseOperationAllowed, false);
    assert.equal(registry.unsupportedPrivilegedOperations?.defaultState, "blocked");
  } catch (error) {
    failures.push(`registry shape drift: ${error.message}`);
  }
}

function checkInvalidFixtures() {
  const invalidMarkers = new Map([
    ["raw-payload-fields", /raw|payload/i],
    ["unsupported-host-execution", /browser|trustedExecution|canClaimExecution/i],
    ["hidden-search-indexing", /hidden|index|background/i],
    ["freeform-command-cwd-env", /freeform|command|cwd|env/i],
    ["broad-mutation", /broad|mutation|automaticApply|createDeleteRenameMove/i],
    ["provider-tool-authority", /providerTool|localTool|tool/i],
    ["production-release-claims", /production|release|marketplace/i]
  ]);

  for (const [marker, pattern] of invalidMarkers) {
    const match = invalidTexts.find(([file, text]) => file.includes(marker) && pattern.test(text));
    if (!match) {
      failures.push(`invalid fixture does not cover expected drift: ${marker}`);
    }
  }
}

function checkDocsMentionLocalCheck() {
  if (!docText.includes("npm run check:controlled-agent-authority-registry")) {
    failures.push(`${docPath} does not mention the focused authority registry check`);
  }
}

function normalize(value) {
  return value.toLowerCase().replace(/[\s_-]+/g, " ");
}
