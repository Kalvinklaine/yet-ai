import { ideSurfaceContract } from "./ide-surface-contract.mjs";

const failures = [];
const apply = ideSurfaceContract.surfaces.find((surface) => surface.id === "confirmed-edit-apply");
const preview = ideSurfaceContract.surfaces.find((surface) => surface.id === "confirmed-edit-preview");
const reason = apply?.jetbrains?.reason ?? "";

assert(preview?.jetbrains?.status === "supported", "JetBrains confirmed edit preview must remain supported.");
assert(apply?.jetbrains?.status === "dev-preview", "JetBrains confirmed edit apply must remain dev-preview.");
assert(apply?.jetbrains?.smoke?.includes("npm run smoke:jetbrains-edit-proposal"), "JetBrains edit proposal smoke must be registered in the surface contract.");
assert(/existing gui\.applyWorkspaceEditRequest \/ host\.applyWorkspaceEditResult only/i.test(reason), "JetBrains apply must use only existing apply/result bridge messages.");
assert(/explicit GUI apply/i.test(reason), "JetBrains apply must require explicit GUI apply.");
assert(/user confirmation/i.test(reason), "JetBrains apply must require IDE/user confirmation.");
assert(/bounded/i.test(reason), "JetBrains apply must be bounded.");
assert(/existing workspace-relative files/i.test(reason), "JetBrains apply must stay limited to existing workspace-relative files.");
assert(/sanitized/i.test(reason), "JetBrains apply must return sanitized results.");
assert(apply?.jetbrains?.smoke?.includes("npm run smoke:jetbrains-wrapper-browser"), "JetBrains apply dev-preview must include deterministic wrapper-browser lifecycle smoke coverage.");
assert(/no new write-capable bridge messages/i.test(reason), "JetBrains apply must not add write-capable bridge messages.");
for (const phrase of [
  "shell",
  "git",
  "tools",
  "tasks",
  "provider calls",
  "create/delete/rename",
  "apply-patch",
  "arbitrary reads/indexing",
  "autonomous edits",
  "silent mutation",
]) {
  assert(reason.toLowerCase().includes(phrase), `JetBrains apply reason must forbid ${phrase}.`);
}

if (failures.length > 0) {
  console.error("JetBrains edit proposal smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("JetBrains edit proposal dev-preview boundary smoke passed: existing bridge messages, explicit confirmations, bounded replacements, sanitized results, and no silent/autonomous mutation.");

function assert(condition, message) {
  if (!condition) failures.push(message);
}
