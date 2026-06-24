export const ideSurfaceStatuses = Object.freeze([
  "supported",
  "unsupported",
  "intentional-gap",
  "deferred",
  "preview-only",
  "dev-preview",
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
      "getActiveFileExcerpt",
      "openWorkspaceFile",
      "revealWorkspaceRange",
      "searchWorkspaceSnippets",
    ]),
    allowedVerificationCommandIds: Object.freeze([
      "repository-check",
      "gui-app-tests",
      "engine-chat-tests",
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
    surface("active-file-excerpt-context", "Active-file excerpt prompt context", "supported", "supported", {
      vscode: ["npm run validate:contracts"],
      jetbrains: ["npm run validate:contracts"],
    }),
    surface("workspace-snippet-search", "Explicit workspace snippet search", "preview-only", "preview-only", {
      vscode: ["npm run validate:contracts"],
      jetbrains: ["npm run validate:contracts"],
    }, {
      vscode: "Contract-only preview: GUI/user-confirmed searchWorkspaceSnippets accepts only a literal bounded query, returns sanitized bounded snippets, uses GUI-minted request ids, and grants no indexing, arbitrary reads, provider, model, API-key, or assistant request authority.",
      jetbrains: "Contract-only preview: GUI/user-confirmed searchWorkspaceSnippets accepts only a literal bounded query, returns sanitized bounded snippets, uses GUI-minted request ids, and grants no indexing, arbitrary reads, provider, model, API-key, or assistant request authority.",
    }),
    surface("verification-command-bridge", "Allowlisted verification command bridge", "preview-only", "preview-only", {
      vscode: ["npm run validate:contracts"],
      jetbrains: ["npm run validate:contracts"],
    }, {
      vscode: "Contract-only preview: GUI/user-confirmed runVerificationCommand uses only allowlisted command ids and GUI-minted request ids; browser remains preview-only and no free-form shell, args, cwd, env, git, package install, network, provider, model, or API-key authority is granted.",
      jetbrains: "Contract-only preview: GUI/user-confirmed runVerificationCommand uses only allowlisted command ids and GUI-minted request ids; browser remains preview-only and no free-form shell, args, cwd, env, git, package install, network, provider, model, or API-key authority is granted.",
    }),
    surface("agent-run-manual-controls", "Agent Run manual controls", "supported", "supported", {
      vscode: ["npm run smoke:agent-run-dogfood"],
      jetbrains: ["npm run smoke:jetbrains-wrapper-browser"],
    }, {
      vscode: "Hosted GUI evidence covers display-only Agent Run state plus explicit user clicks for apply and allowlisted verification through existing bridge messages; no auto-run or background execution is granted.",
      jetbrains: "Hosted GUI evidence covers display-only Agent Run state plus explicit user clicks for apply and allowlisted verification through existing bridge messages; no auto-run or background execution is granted.",
    }),
    surface("context-budget-preview", "Context budget preview", "supported", "supported", {
      vscode: ["npm run smoke:agent-run-dogfood"],
      jetbrains: ["npm run smoke:jetbrains-wrapper-browser"],
    }, {
      vscode: "Hosted GUI evidence covers next-Send preview labels, approximate character counts, omitted/excluded counts, and local review metadata marked not sent; raw bodies are not persisted or sent by the preview.",
      jetbrains: "Hosted GUI evidence covers next-Send preview labels, approximate character counts, omitted/excluded counts, and local review metadata marked not sent; raw bodies are not persisted or sent by the preview.",
    }),
    surface("confirmed-edit-preview", "Confirmed edit proposal preview", "supported", "supported", {
      vscode: ["npm run smoke:vscode-edit-proposal"],
      jetbrains: ["npm run smoke:jetbrains-edit-proposal"],
    }, {
      jetbrains: "JetBrains renders/reviews proposals and may forward apply only through the confirmed edit apply dev-preview boundary.",
    }),
    surface("confirmed-edit-apply", "Confirmed edit proposal apply", "supported", "dev-preview", {
      vscode: ["npm run smoke:vscode-edit-proposal"],
      jetbrains: ["npm run smoke:jetbrains-edit-proposal", "npm run smoke:jetbrains-wrapper-browser"],
    }, {
      jetbrains: "Dev-preview JetBrains apply MVP: existing gui.applyWorkspaceEditRequest / host.applyWorkspaceEditResult only, after explicit GUI apply plus IDE/user confirmation, bounded to sanitized text replacements in existing workspace-relative files; no new write-capable bridge messages, shell, git, tools, tasks, provider calls, create/delete/rename, apply-patch, arbitrary reads/indexing, autonomous edits, or silent mutation.",
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
