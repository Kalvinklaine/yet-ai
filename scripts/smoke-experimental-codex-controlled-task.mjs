import { findForbiddenEvidenceText, formatForbiddenEvidenceFailures } from "./lib/forbidden-evidence-text.mjs";

const supportedHost = "vscode-dev-preview";

const closureEvidence = Object.freeze({
  mode: "local-mock-metadata-only",
  providerAutomation: "none",
  realCredentials: "none",
  hostedRequirement: "none",
  login: {
    start: "explicit-experimental-start",
    pending: "manual-exchange-guidance-visible",
    connected: "sanitized-connected-status",
    secretCustody: "engine-owned-local-secret-store"
  },
  firstChat: {
    providerPrecedence: "safe-provider-precedence-checked",
    path: "experimental-auth-fallback-when-no-safer-provider-ready",
    providerProposal: "controlled-task-proposal-visible",
    promptEvidence: "safe-intent-label-only"
  },
  controlledTask: {
    host: supportedHost,
    taskLabel: "small-controlled-task-label",
    startGate: "explicit-user-start-required",
    contextGate: "explicit-context-selection-required",
    proposalGate: "user-review-required",
    applyGate: "explicit-host-confirmed-apply-required",
    verificationGate: "allowlisted-command-id-review-required",
    followupGate: "manual-followup-only",
    workspaceMutationFromLogin: "none",
    automaticExecution: "none"
  },
  reloadReconnect: {
    reload: "recheck-runtime-before-continuing",
    reconnect: "manual-refresh-or-restart-runtime",
    staleResults: "mismatched-results-ignored",
    restart: "new-explicit-run-required"
  },
  unsupportedHosts: {
    browser: "unsupported-for-trusted-workspace-execution",
    jetbrains: "fail-closed-unless-separately-verified"
  },
  nonClaims: {
    officialOauth: "not-claimed",
    productionLogin: "not-claimed",
    releaseMarketplace: "not-claimed",
    signingNotarizationSupport: "not-claimed",
    realProviderCi: "not-claimed"
  },
  s141s142: "not-recommended-from-current-s136-s140-evidence"
});

const requiredLabels = [
  ["mock-only mode", closureEvidence.mode === "local-mock-metadata-only"],
  ["no provider automation", closureEvidence.providerAutomation === "none"],
  ["no real credentials", closureEvidence.realCredentials === "none"],
  ["no hosted requirement", closureEvidence.hostedRequirement === "none"],
  ["experimental login start", closureEvidence.login.start === "explicit-experimental-start"],
  ["manual pending exchange", closureEvidence.login.pending === "manual-exchange-guidance-visible"],
  ["sanitized connected status", closureEvidence.login.connected === "sanitized-connected-status"],
  ["engine secret custody", closureEvidence.login.secretCustody === "engine-owned-local-secret-store"],
  ["safe provider precedence", closureEvidence.firstChat.providerPrecedence === "safe-provider-precedence-checked"],
  ["experimental fallback path", closureEvidence.firstChat.path === "experimental-auth-fallback-when-no-safer-provider-ready"],
  ["provider proposal path", closureEvidence.firstChat.providerProposal === "controlled-task-proposal-visible"],
  ["VS Code host", closureEvidence.controlledTask.host === supportedHost],
  ["explicit task start", closureEvidence.controlledTask.startGate === "explicit-user-start-required"],
  ["explicit context gate", closureEvidence.controlledTask.contextGate === "explicit-context-selection-required"],
  ["reviewed proposal gate", closureEvidence.controlledTask.proposalGate === "user-review-required"],
  ["host-confirmed apply gate", closureEvidence.controlledTask.applyGate === "explicit-host-confirmed-apply-required"],
  ["allowlisted verification gate", closureEvidence.controlledTask.verificationGate === "allowlisted-command-id-review-required"],
  ["manual followup", closureEvidence.controlledTask.followupGate === "manual-followup-only"],
  ["login cannot mutate workspace", closureEvidence.controlledTask.workspaceMutationFromLogin === "none"],
  ["no automatic execution", closureEvidence.controlledTask.automaticExecution === "none"],
  ["reload requires recheck", closureEvidence.reloadReconnect.reload === "recheck-runtime-before-continuing"],
  ["manual reconnect", closureEvidence.reloadReconnect.reconnect === "manual-refresh-or-restart-runtime"],
  ["stale results blocked", closureEvidence.reloadReconnect.staleResults === "mismatched-results-ignored"],
  ["new explicit run after restart", closureEvidence.reloadReconnect.restart === "new-explicit-run-required"],
  ["browser unsupported", closureEvidence.unsupportedHosts.browser === "unsupported-for-trusted-workspace-execution"],
  ["JetBrains fail closed", closureEvidence.unsupportedHosts.jetbrains === "fail-closed-unless-separately-verified"],
  ["no official OAuth claim", closureEvidence.nonClaims.officialOauth === "not-claimed"],
  ["no production login claim", closureEvidence.nonClaims.productionLogin === "not-claimed"],
  ["no release marketplace claim", closureEvidence.nonClaims.releaseMarketplace === "not-claimed"],
  ["no signing support claim", closureEvidence.nonClaims.signingNotarizationSupport === "not-claimed"],
  ["no real-provider CI claim", closureEvidence.nonClaims.realProviderCi === "not-claimed"],
  ["S141/S142 decision", closureEvidence.s141s142 === "not-recommended-from-current-s136-s140-evidence"]
];

const failures = [];
for (const [label, passed] of requiredLabels) {
  if (!passed) failures.push(`missing required closure label: ${label}`);
}

const evidenceText = JSON.stringify(closureEvidence, null, 2);
failures.push(...formatForbiddenEvidenceFailures(findForbiddenEvidenceText(evidenceText, { label: "closure evidence" })));
failures.push(...unsafeSelfTestFailures());

if (failures.length > 0) {
  console.error("Experimental Codex-like controlled-task closure smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Experimental Codex-like controlled-task closure smoke passed.");
console.log(evidenceText);

function unsafeSelfTestFailures() {
  const samples = [
    ["auth code", "authorization_code: redacted-example"],
    ["access token", "access_token: redacted-example"],
    ["refresh token", "refresh_token: redacted-example"],
    ["PKCE verifier", "code_verifier: redacted-example"],
    ["cookie", "Cookie: sid=redacted"],
    ["raw prompt", "raw prompt: change this file"],
    ["raw response", "provider response: full response"],
    ["raw file body", "file contents: example"],
    ["raw diff", "raw diff: @@ -1 +1"],
    ["raw command output", "stdout: example"],
    ["private path", "/Users/example/project"],
    ["bridge dump", "bridge payload: {}"],
    ["browser storage", "localStorage: {}"]
  ];
  const results = [];
  for (const [label, sample] of samples) {
    const matches = findForbiddenEvidenceText(sample, { label });
    if (matches.length === 0) results.push(`unsafe self-test did not reject ${label}`);
  }
  return results;
}
