export const ideSurfaceStatuses = Object.freeze([
  "supported",
  "unsupported",
  "intentional-gap",
  "deferred",
  "preview-only",
]);

export const ideSurfaceContract = Object.freeze({
  version: 1,
  safety: Object.freeze({
    localOnly: true,
    noRealIdeLaunch: true,
    noProviderCalls: true,
    noHostedBackendRequired: true,
    noSigningPublishingOrReleaseClaim: true,
    noAutonomousMutation: true,
    allowedReadOnlyIdeActions: Object.freeze([
      "getContextSnapshot",
      "openWorkspaceFile",
      "revealWorkspaceRange",
    ]),
  }),
  surfaces: Object.freeze([
    surface("runtime-bootstrap", "Runtime bootstrap", "supported", "supported", {
      vscode: ["npm run prepare:vscode-preview", "npm run smoke:vscode-first-message"],
      jetbrains: ["npm run prepare:jetbrains-preview", "npm run smoke:jetbrains-bundled-runtime", "npm run smoke:jetbrains-first-message"],
    }),
    surface("packaged-gui", "Packaged GUI", "supported", "supported", {
      vscode: ["npm run smoke:vscode-wrapper-browser"],
      jetbrains: ["npm run smoke:jetbrains-wrapper-browser", "npm run smoke:jetbrains-gui-browser"],
    }),
    surface("host-ready", "host.ready bridge bootstrap", "supported", "supported", {
      vscode: ["npm run smoke:vscode-first-message", "npm run smoke:vscode-wrapper-browser"],
      jetbrains: ["npm run smoke:jetbrains-first-message", "npm run smoke:jetbrains-wrapper-browser"],
    }),
    surface("active-context", "host.contextSnapshot / active editor context", "supported", "supported", {
      vscode: ["npm run smoke:vscode-first-message"],
      jetbrains: ["npm run smoke:jetbrains-first-message"],
    }),
    surface("first-message-flow", "First-message flow", "supported", "supported", {
      vscode: ["npm run smoke:vscode-first-message"],
      jetbrains: ["npm run smoke:jetbrains-first-message"],
    }),
    surface("provider-setup", "Provider setup", "supported", "supported", {
      vscode: ["npm run smoke:vscode-first-message"],
      jetbrains: ["npm run smoke:jetbrains-first-message"],
    }),
    surface("read-only-ide-actions", "Read-only IDE actions", "supported", "supported", {
      vscode: ["npm run smoke:vscode-wrapper-browser"],
      jetbrains: ["npm run smoke:jetbrains-wrapper-browser"],
    }),
    surface("confirmed-edit-preview", "Confirmed edit proposal preview", "supported", "preview-only", {
      vscode: ["npm run smoke:vscode-edit-proposal"],
      jetbrains: [],
    }, {
      jetbrains: "JetBrains renders/reviews proposals only; no host apply request is implemented.",
    }),
    surface("confirmed-edit-apply", "Confirmed edit proposal apply", "supported", "intentional-gap", {
      vscode: ["npm run smoke:vscode-edit-proposal"],
      jetbrains: [],
    }, {
      jetbrains: "Intentional JetBrains gap: VS Code is the only host apply MVP, still requiring explicit GUI apply plus host user confirmation for bounded replacements in existing workspace-relative files.",
    }),
    surface("lsp-status", "LSP status", "preview-only", "deferred", {
      vscode: ["npm run smoke:lsp-stdio"],
      jetbrains: [],
    }, {
      vscode: "VS Code LSP is an off-by-default read-only MVP/status proof, not production code intelligence.",
      jetbrains: "JetBrains LSP native/client behavior is foundation-only and deferred; production support is not claimed.",
    }),
    surface("artifact-installability", "Artifact installability", "supported", "supported", {
      vscode: ["npm run prepare:vscode-preview", "npm run smoke:vscode-installable"],
      jetbrains: ["npm run prepare:jetbrains-preview", "npm run smoke:jetbrains-installable", "npm run smoke:jetbrains-bundled-runtime"],
    }),
  ]),
});

function surface(id, name, vscodeStatus, jetbrainsStatus, smoke, reasons = {}) {
  return Object.freeze({
    id,
    name,
    vscode: Object.freeze({ status: vscodeStatus, reason: reasons.vscode ?? "", smoke: Object.freeze(smoke.vscode ?? []) }),
    jetbrains: Object.freeze({ status: jetbrainsStatus, reason: reasons.jetbrains ?? "", smoke: Object.freeze(smoke.jetbrains ?? []) }),
  });
}
