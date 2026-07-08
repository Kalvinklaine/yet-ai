import { spawnSync } from "node:child_process";

const validators = [
  ["scripts/validate-product-identity.mjs"],
  ["scripts/validate-public-hygiene.mjs"],
  ["scripts/validate-docs-index.mjs"],
  ["scripts/check-agent-readiness-docs.mjs"],
  ["scripts/audit-controlled-autonomy-wording.mjs"],
  ["scripts/validate-contracts.mjs"],
  ["scripts/check-controlled-agent-authority-registry.mjs"],
  ["scripts/check-controlled-agent-storage-privacy.mjs"],
  ["scripts/check-controlled-agent-workflow-transcript-contract.mjs"],
  ["scripts/check-useful-multifile-agent-decision.mjs"],
  ["scripts/validate-controlled-agent-dev-preview-fixtures.mjs"],
  ["scripts/smoke-sandbox-checkpoint.mjs"],
  ["scripts/smoke-controlled-run-explicit-context.mjs"],
  ["scripts/smoke-controlled-run-memory-attachment.mjs"],
  ["scripts/validate-ide-artifact-contract.mjs"],
  ["scripts/validate-ide-artifact-workflow.mjs"],
  ["scripts/validate-ide-surface-contract.mjs"],
  ["scripts/validate-npm-spawn.mjs"],
  ["scripts/validate-icon-assets.mjs"],
  ["scripts/check-gui-asset-freshness.mjs"],
  ["scripts/dogfood-real-provider-report.mjs", "--check-template"],
  ["scripts/dogfood-real-provider-report.mjs", "--self-test"],
  ["scripts/dogfood-agent-run-rc-report.mjs", "--check-template"],
  ["scripts/dogfood-agent-run-rc-report.mjs", "--self-test"],
  ["scripts/dogfood-controlled-beta-report.mjs", "--check-template"],
  ["scripts/dogfood-controlled-beta-report.mjs", "--self-test"],
  ["scripts/dogfood-controlled-agent-real-provider-matrix.mjs", "--check-template"],
  ["scripts/dogfood-controlled-agent-real-provider-matrix.mjs", "--self-test"],
  ["scripts/dogfood-controlled-agent-task-beta-report.mjs", "--check-template"],
  ["scripts/dogfood-controlled-agent-task-beta-report.mjs", "--self-test"]
];

for (const validator of validators) {
  const result = spawnSync(process.execPath, validator, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Repository validation passed.");
