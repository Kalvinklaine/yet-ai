import { spawnSync } from "node:child_process";

const validators = [
  "scripts/validate-product-identity.mjs",
  "scripts/validate-public-hygiene.mjs",
  "scripts/validate-docs-index.mjs",
  "scripts/validate-contracts.mjs",
  "scripts/validate-ide-artifact-contract.mjs",
  "scripts/validate-ide-artifact-workflow.mjs"
];

for (const validator of validators) {
  const result = spawnSync(process.execPath, [validator], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Repository validation passed.");
