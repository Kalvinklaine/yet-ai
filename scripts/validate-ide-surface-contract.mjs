import process from "node:process";
import { ideSurfaceContract, ideSurfaceStatuses } from "./ide-surface-contract.mjs";

const allowedStatuses = new Set(ideSurfaceStatuses);
const reasonRequired = new Set(["unsupported", "intentional-gap", "deferred", "preview-only", "dev-preview"]);
const forbiddenClaimPattern = /\b(shell|tools?|tasks?|git|provider-backed|provider calls?|autonomous mutation|autonomous edits?|workspace edit apply|apply patch)\b/i;
const failures = [];

assert(ideSurfaceContract?.safety?.localOnly === true, "Contract must remain local-only.");
assert(ideSurfaceContract?.safety?.noRealIdeLaunch === true, "Contract must not require real IDE launch.");
assert(ideSurfaceContract?.safety?.noProviderCalls === true, "Contract must not use provider calls.");
assert(ideSurfaceContract?.safety?.noHostedBackendRequired === true, "Contract must not require a hosted backend.");
assert(ideSurfaceContract?.safety?.noSigningPublishingOrReleaseClaim === true, "Contract must not claim signing, marketplace publication, or production release.");
assert(ideSurfaceContract?.safety?.noAutonomousMutation === true, "Contract must forbid autonomous mutation.");
assertArrayEquals(
  ideSurfaceContract?.safety?.allowedReadOnlyIdeActions ?? [],
  ["getContextSnapshot", "openWorkspaceFile", "revealWorkspaceRange"],
  "Allowed read-only IDE actions must remain exactly bounded."
);

const surfaces = Array.isArray(ideSurfaceContract?.surfaces) ? ideSurfaceContract.surfaces : [];
assert(surfaces.length > 0, "Contract must define at least one surface.");
assert(new Set(surfaces.map((surface) => surface.id)).size === surfaces.length, "Surface ids must be unique.");

for (const surface of surfaces) {
  assert(typeof surface.id === "string" && surface.id.length > 0, "Every surface needs an id.");
  assert(typeof surface.name === "string" && surface.name.length > 0, `Surface ${surface.id} needs a name.`);

  for (const ide of ["vscode", "jetbrains"]) {
    const entry = surface[ide];
    assert(entry && typeof entry === "object", `Surface ${surface.id} must define ${ide}.`);
    assert(allowedStatuses.has(entry?.status), `Surface ${surface.id} has invalid ${ide} status: ${entry?.status ?? "<missing>"}.`);
    assert(Array.isArray(entry?.smoke), `Surface ${surface.id} ${ide} smoke commands must be an array.`);
    if (entry?.status === "supported") {
      assert(entry.smoke.length > 0, `Supported surface ${surface.id} ${ide} must have at least one smoke/test command.`);
    }
    if (entry?.status === "dev-preview") {
      assert(entry.smoke.length > 0, `Dev-preview surface ${surface.id} ${ide} must have at least one smoke/test command.`);
    }
    if (reasonRequired.has(entry?.status)) {
      assert(typeof entry.reason === "string" && entry.reason.trim().length > 0, `Surface ${surface.id} ${ide} status ${entry.status} must include a reason.`);
    }
    for (const command of entry?.smoke ?? []) {
      assert(typeof command === "string" && command.startsWith("npm run "), `Surface ${surface.id} ${ide} smoke command must be an npm script: ${command}`);
    }
  }

  const searchable = JSON.stringify(surface);
  if (!["lsp-status", "confirmed-edit-apply"].includes(surface.id)) {
    assert(!forbiddenClaimPattern.test(searchable), `Surface ${surface.id} must not claim shell/tools/tasks/git/provider-backed IDE actions or autonomous mutation.`);
  }
}

const browserPreview = surfaces.find((surface) => surface.id === "confirmed-edit-preview");
assert(browserPreview?.vscode?.status === "supported", "VS Code confirmed edit preview must remain supported.");
assert(browserPreview?.jetbrains?.status === "supported", "JetBrains confirmed edit preview must be supported when apply is dev-preview.");

const editApply = surfaces.find((surface) => surface.id === "confirmed-edit-apply");
assert(editApply?.jetbrains?.status === "dev-preview", "JetBrains confirmed edit apply must be marked dev-preview, not supported or production-ready.");
assert(editApply?.jetbrains?.smoke?.includes("npm run smoke:jetbrains-edit-proposal"), "JetBrains confirmed edit apply dev-preview must have focused smoke coverage.");
const jetbrainsApplyReason = editApply?.jetbrains?.reason ?? "";
for (const [pattern, message] of [
  [/existing gui\.applyWorkspaceEditRequest \/ host\.applyWorkspaceEditResult only/i, "JetBrains apply reason must use only existing apply/result bridge messages."],
  [/explicit GUI apply/i, "JetBrains apply reason must require explicit GUI apply."],
  [/(IDE|host)\/user confirmation|user confirmation/i, "JetBrains apply reason must require IDE/user confirmation."],
  [/bounded/i, "JetBrains apply reason must state bounded edits."],
  [/existing workspace-relative files/i, "JetBrains apply reason must restrict edits to existing workspace-relative files."],
  [/sanitized/i, "JetBrains apply reason must require sanitized requests/results."],
  [/no new write-capable bridge messages/i, "JetBrains apply reason must forbid new write-capable bridge messages."],
  [/no .*shell/i, "JetBrains apply reason must forbid shell authority."],
  [/git/i, "JetBrains apply reason must forbid git authority."],
  [/tools/i, "JetBrains apply reason must forbid tool authority."],
  [/tasks/i, "JetBrains apply reason must forbid task authority."],
  [/provider calls/i, "JetBrains apply reason must forbid provider calls."],
  [/create\/delete\/rename/i, "JetBrains apply reason must forbid create/delete/rename."],
  [/apply-patch/i, "JetBrains apply reason must forbid apply-patch."],
  [/arbitrary reads\/indexing/i, "JetBrains apply reason must forbid arbitrary reads/indexing."],
  [/autonomous edits/i, "JetBrains apply reason must forbid autonomous edits."],
  [/silent mutation/i, "JetBrains apply reason must forbid silent mutation."],
]) {
  assert(pattern.test(jetbrainsApplyReason), message);
}

const readOnlyActions = surfaces.find((surface) => surface.id === "read-only-ide-actions");
assert(readOnlyActions?.vscode?.status === "supported" && readOnlyActions?.jetbrains?.status === "supported", "Read-only IDE actions must remain supported in VS Code and JetBrains.");

const lsp = surfaces.find((surface) => surface.id === "lsp-status");
assert(lsp?.vscode?.status === "preview-only", "VS Code LSP must remain off-by-default preview-only MVP status.");
assert(/off-by-default/i.test(lsp?.vscode?.reason ?? ""), "VS Code LSP reason must state off-by-default.");
assert(["deferred", "preview-only", "intentional-gap"].includes(lsp?.jetbrains?.status), "JetBrains LSP must remain deferred/preview-only/intentional-gap, not supported.");
assert(/not claimed|no .*production|deferred/i.test(lsp?.jetbrains?.reason ?? ""), "JetBrains LSP reason must explicitly avoid production LSP support claims.");

if (failures.length > 0) {
  console.error("IDE surface contract validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`IDE surface contract validation passed: ${surfaces.length} local-only cross-IDE surfaces checked.`);

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertArrayEquals(actual, expected, message) {
  const matches = actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  assert(matches, `${message} Expected ${expected.join(", ")}; got ${actual.join(", ") || "<none>"}.`);
}
