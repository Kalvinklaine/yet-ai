import { isRawContentLikeKey, isSecretLikeKey, sanitizeTimelineText } from "./redaction";

export type ControlledAgentTaskHarnessState = "ready" | "blocked" | "unsupported" | "partial_fail_closed" | "failed" | "followup_ready";
export type ControlledAgentTaskHarnessHost = "vscode" | "jetbrains" | "browser" | "unknown";
export type ControlledAgentTaskHarnessDiagnosticCode =
  | "missing_input"
  | "malformed_input"
  | "unsafe_metadata"
  | "unsupported_host"
  | "partial_host"
  | "invalid_lineage"
  | "blocked_precondition"
  | "failed_verification"
  | "unsafe_authority"
  | "unsafe_claim";

export type ControlledAgentTaskHarnessDiagnostic = {
  code: ControlledAgentTaskHarnessDiagnosticCode;
  message: string;
};

export type ControlledAgentTaskHarnessCounters = {
  selectedItemCount: number;
  searchQueryCount: number;
  searchResultCount: number;
  activeFileExcerptCount: number;
  patchFileCount: number;
  replacementByteCount: number;
  verificationCommandCount: number;
  unsafeOmittedCount: number;
};

export type ControlledAgentTaskHarnessGates = {
  presetSelected: boolean;
  contextSelected: boolean;
  proposalReviewed: boolean;
  proposalAccepted: boolean;
  patchPlanReviewed: boolean;
  patchPlanAccepted: boolean;
  applyConfirmed: boolean;
  verificationConfirmed: boolean;
  followupRequiresUserChoice: boolean;
};

export type ControlledAgentTaskHarnessPolicy = {
  metadataOnly: boolean;
  cloudRequired: boolean;
  executionAllowed: boolean;
  canAutoSend: boolean;
  canReadHiddenFiles: boolean;
  canSearchHiddenFiles: boolean;
  canIndexWorkspace: boolean;
  canAutoApply: boolean;
  canAutoVerify: boolean;
  canAutoRepair: boolean;
  canUseFreeformCommands: boolean;
  canUseProviderTools: boolean;
  canUseNetwork: boolean;
  canMutateGit: boolean;
  canInstallPackages: boolean;
  canStoreRawData: boolean;
  canStoreBrowserData: boolean;
};

export type ControlledAgentTaskHarnessSummary = {
  kind: "controlled_agent_task_harness_summary";
  state: ControlledAgentTaskHarnessState;
  host: ControlledAgentTaskHarnessHost;
  presetId: string;
  statusLabel: string;
  labels: string[];
  counters: ControlledAgentTaskHarnessCounters;
  gates: ControlledAgentTaskHarnessGates;
  policy: ControlledAgentTaskHarnessPolicy;
  diagnostics: ControlledAgentTaskHarnessDiagnostic[];
};

type HarnessObject = Record<string, any>;

const maxLabels = 12;
const maxLabelLength = 100;
const unsafeStringPattern = /(?:raw\s*(?:prompt|file|body|diff|replacement|command|output|payload|log)|provider\s*(?:response|payload|tool)|browser\s*storage|bridge\s*dump|authorization|bearer|cookie|secret|password|api[_ -]?key|sk-[a-z0-9_-]{8,}|\/Users\/|\/home\/|\/tmp\/|\/var\/|\/etc\/|[A-Za-z]:[\\/]|~[\\/]|shell|cwd|env|package\s*install|hidden\s*(?:read|search|scan)|indexing|auto[-_ ]?(?:send|apply|verify|repair))/iu;

export function evaluateControlledAgentTaskHarness(input: unknown): ControlledAgentTaskHarnessSummary {
  const diagnostics: ControlledAgentTaskHarnessDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("missing_input", "Controlled task harness metadata is required."));
    return blockedSummary("blocked", "unknown", diagnostics, 0);
  }

  const metadata = input as HarnessObject;
  const unsafeOmittedCount = countUnsafe(metadata, diagnostics);
  const host = normalizeHost(metadata.host?.kind);
  const lineageStatus = stringValue(metadata.correlation?.lineageStatus);
  const invalidLineage = lineageStatus !== "" && lineageStatus !== "valid";
  const unsupportedHost = host === "browser";
  const partialHost = host === "jetbrains" || metadata.host?.supportState === "partial_fail_closed";

  if (metadata.kind !== "controlled_agent_task_harness" || metadata.version !== "2026-07-08" || metadata.authority !== "vscode_controlled_task_harness_metadata_only") diagnostics.push(diagnostic("malformed_input", "Harness identity metadata is missing or malformed."));
  if (metadata.metadataOnly !== true || metadata.cloudRequired !== false) diagnostics.push(diagnostic("unsafe_authority", "Harness must remain local metadata only without cloud requirement."));
  if (unsupportedHost) diagnostics.push(diagnostic("unsupported_host", "Browser host is unsupported for controlled task harness execution."));
  if (partialHost) diagnostics.push(diagnostic("partial_host", "Non-VS Code host is partial and fail-closed."));
  if (invalidLineage) diagnostics.push(diagnostic("invalid_lineage", "Invalid correlation lineage fails closed before proposal, apply, and verification."));

  const policy = policyFrom(metadata, host);
  if (hasUnsafeAuthority(policy, metadata)) diagnostics.push(diagnostic("unsafe_authority", "Unsafe authority flag was present and the harness is blocked."));
  if (hasUnsafeClaim(metadata)) diagnostics.push(diagnostic("unsafe_claim", "Production, release, or marketplace readiness claim was present and omitted."));
  if (!validFailClosedLineage(metadata, invalidLineage)) diagnostics.push(diagnostic("invalid_lineage", "Invalid lineage was not represented as blocked metadata."));

  const gates = gatesFrom(metadata);
  if (!gates.presetSelected || !gates.contextSelected || !gates.proposalReviewed || !gates.patchPlanReviewed) diagnostics.push(diagnostic("blocked_precondition", "Required explicit user gate metadata is incomplete."));
  if (metadata.verification?.state === "failed") diagnostics.push(diagnostic("failed_verification", "Verification metadata reports a bounded failed state."));

  const counters: ControlledAgentTaskHarnessCounters = {
    selectedItemCount: boundedInteger(metadata.contextSelection?.selectedItemCount, 0, 12),
    searchQueryCount: boundedInteger(metadata.contextSelection?.searchQueryCount, 0, 4),
    searchResultCount: boundedInteger(metadata.contextSelection?.searchResultCount, 0, 16),
    activeFileExcerptCount: boundedInteger(metadata.contextSelection?.activeFileExcerptCount, 0, 4),
    patchFileCount: boundedInteger(metadata.patchPlanReview?.fileCount, 0, 8),
    replacementByteCount: boundedInteger(metadata.patchPlanReview?.replacementByteCount, 0, 50000),
    verificationCommandCount: boundedInteger(metadata.verification?.commandCount, 0, 3),
    unsafeOmittedCount,
  };

  const state = stateFrom({ diagnostics, host, invalidLineage, partialHost, unsupportedHost, verificationState: metadata.verification?.state, followupState: metadata.followupRecovery?.state });
  return {
    kind: "controlled_agent_task_harness_summary",
    state,
    host,
    presetId: safeIdentifier(metadata.preset?.presetId, "unknown"),
    statusLabel: statusLabel(state, host),
    labels: labelsFrom(metadata, state, host),
    counters,
    gates,
    policy,
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

function blockedSummary(state: ControlledAgentTaskHarnessState, host: ControlledAgentTaskHarnessHost, diagnostics: ControlledAgentTaskHarnessDiagnostic[], unsafeOmittedCount: number): ControlledAgentTaskHarnessSummary {
  return {
    kind: "controlled_agent_task_harness_summary",
    state,
    host,
    presetId: "unknown",
    statusLabel: statusLabel(state, host),
    labels: ["Harness metadata unavailable"],
    counters: { selectedItemCount: 0, searchQueryCount: 0, searchResultCount: 0, activeFileExcerptCount: 0, patchFileCount: 0, replacementByteCount: 0, verificationCommandCount: 0, unsafeOmittedCount },
    gates: { presetSelected: false, contextSelected: false, proposalReviewed: false, proposalAccepted: false, patchPlanReviewed: false, patchPlanAccepted: false, applyConfirmed: false, verificationConfirmed: false, followupRequiresUserChoice: true },
    policy: { metadataOnly: true, cloudRequired: false, executionAllowed: false, canAutoSend: false, canReadHiddenFiles: false, canSearchHiddenFiles: false, canIndexWorkspace: false, canAutoApply: false, canAutoVerify: false, canAutoRepair: false, canUseFreeformCommands: false, canUseProviderTools: false, canUseNetwork: false, canMutateGit: false, canInstallPackages: false, canStoreRawData: false, canStoreBrowserData: false },
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

function stateFrom(input: { diagnostics: ControlledAgentTaskHarnessDiagnostic[]; host: ControlledAgentTaskHarnessHost; invalidLineage: boolean; partialHost: boolean; unsupportedHost: boolean; verificationState: unknown; followupState: unknown }): ControlledAgentTaskHarnessState {
  if (input.unsupportedHost || input.host === "browser") return "unsupported";
  if (input.partialHost) return "partial_fail_closed";
  if (input.invalidLineage || input.diagnostics.some((item) => item.code === "unsafe_authority" || item.code === "unsafe_claim" || item.code === "unsafe_metadata" || item.code === "malformed_input" || item.code === "blocked_precondition")) return "blocked";
  if (input.verificationState === "failed") return "failed";
  if (input.followupState === "ready" && input.verificationState !== "succeeded") return "followup_ready";
  return "ready";
}

function policyFrom(metadata: HarnessObject, host: ControlledAgentTaskHarnessHost): ControlledAgentTaskHarnessPolicy {
  const flags = isPlainObject(metadata.policyFlags) ? metadata.policyFlags as HarnessObject : {};
  const persistence = isPlainObject(metadata.persistence) ? metadata.persistence as HarnessObject : {};
  return {
    metadataOnly: metadata.metadataOnly === true && flags.metadataOnly === true,
    cloudRequired: metadata.cloudRequired === true,
    executionAllowed: host === "vscode" && metadata.host?.executionAllowed === true,
    canAutoSend: flags.autoSendAllowed === true,
    canReadHiddenFiles: flags.hiddenReadAllowed === true || metadata.contextSelection?.hiddenReadAllowed === true,
    canSearchHiddenFiles: flags.hiddenSearchAllowed === true || metadata.contextSelection?.hiddenSearchAllowed === true,
    canIndexWorkspace: flags.indexingAllowed === true || metadata.contextSelection?.indexingAllowed === true,
    canAutoApply: flags.autoApplyAllowed === true || metadata.apply?.automaticApplyAllowed === true,
    canAutoVerify: flags.autoVerifyAllowed === true || metadata.verification?.automaticVerifyAllowed === true,
    canAutoRepair: flags.autoRepairAllowed === true || metadata.followupRecovery?.automaticRepairAllowed === true,
    canUseFreeformCommands: flags.arbitraryShellAllowed === true || metadata.verification?.freeformCommandAllowed === true,
    canUseProviderTools: flags.providerToolsAllowed === true || metadata.proposal?.providerToolsAllowed === true,
    canUseNetwork: flags.networkAllowed === true,
    canMutateGit: flags.gitAllowed === true,
    canInstallPackages: flags.packageInstallAllowed === true,
    canStoreRawData: Object.values(persistence).some((value) => value === true) || metadata.proposal?.providerPayloadStored === true || metadata.proposal?.rawPromptStored === true || metadata.patchPlanReview?.rawDiffStored === true || metadata.patchPlanReview?.rawReplacementStored === true || metadata.verification?.rawOutputStored === true,
    canStoreBrowserData: false,
  };
}

function gatesFrom(metadata: HarnessObject): ControlledAgentTaskHarnessGates {
  return {
    presetSelected: metadata.preset?.selectedByUser === true,
    contextSelected: metadata.contextSelection?.selectedByUser === true && boundedInteger(metadata.contextSelection?.selectedItemCount, 0, 12) > 0,
    proposalReviewed: metadata.proposal?.reviewedByUser === true || metadata.proposal?.decision === "blocked",
    proposalAccepted: metadata.proposal?.decision === "accepted" && metadata.proposal?.state === "accepted",
    patchPlanReviewed: metadata.patchPlanReview?.reviewedByUser === true || metadata.patchPlanReview?.decision === "blocked",
    patchPlanAccepted: metadata.patchPlanReview?.decision === "accepted",
    applyConfirmed: metadata.apply?.userConfirmed === true && metadata.apply?.state === "applied",
    verificationConfirmed: metadata.verification?.userConfirmed === true && (metadata.verification?.state === "succeeded" || metadata.verification?.state === "failed"),
    followupRequiresUserChoice: metadata.followupRecovery?.requiresUserChoice !== false,
  };
}

function hasUnsafeAuthority(policy: ControlledAgentTaskHarnessPolicy, metadata: HarnessObject): boolean {
  return policy.cloudRequired || !policy.metadataOnly || policy.canAutoSend || policy.canReadHiddenFiles || policy.canSearchHiddenFiles || policy.canIndexWorkspace || policy.canAutoApply || policy.canAutoVerify || policy.canAutoRepair || policy.canUseFreeformCommands || policy.canUseProviderTools || policy.canUseNetwork || policy.canMutateGit || policy.canInstallPackages || policy.canStoreRawData || metadata.apply?.assistantMinted === true || metadata.apply?.boundedExistingTextFilesOnly === false || metadata.verification?.allowlistedCommandIdsOnly === false || metadata.followupRecovery?.automaticProviderSendAllowed === true || metadata.followupRecovery?.automaticRerunAllowed === true;
}

function hasUnsafeClaim(metadata: HarnessObject): boolean {
  return metadata.claims?.productionReady === true || metadata.claims?.releaseReady === true || metadata.claims?.marketplaceReady === true;
}

function validFailClosedLineage(metadata: HarnessObject, invalidLineage: boolean): boolean {
  if (!invalidLineage) return metadata.correlation?.acceptedAfterInvalidLineage !== true;
  return metadata.correlation?.acceptedAfterInvalidLineage !== true
    && metadata.proposal?.state === "blocked"
    && metadata.proposal?.decision === "blocked"
    && metadata.patchPlanReview?.decision === "blocked"
    && (metadata.apply?.state === "blocked" || metadata.apply?.state === "not_requested")
    && metadata.apply?.userConfirmed === false
    && (metadata.verification?.state === "blocked" || metadata.verification?.state === "not_requested")
    && metadata.verification?.userConfirmed === false
    && metadata.followupRecovery?.automaticRepairAllowed === false;
}

function labelsFrom(metadata: HarnessObject, state: ControlledAgentTaskHarnessState, host: ControlledAgentTaskHarnessHost): string[] {
  const labels = [
    `Host: ${host}`,
    `State: ${state}`,
    `Preset: ${safeIdentifier(metadata.preset?.presetId, "unknown")}`,
    `Context items: ${boundedInteger(metadata.contextSelection?.selectedItemCount, 0, 12)}`,
    `Proposal: ${safeIdentifier(metadata.proposal?.decision, "unknown")}`,
    `Patch plan: ${safeIdentifier(metadata.patchPlanReview?.decision, "unknown")}`,
    `Apply: ${safeIdentifier(metadata.apply?.state, "unknown")}`,
    `Verification: ${safeIdentifier(metadata.verification?.state, "unknown")}`,
    `Follow-up: ${safeIdentifier(metadata.followupRecovery?.state, "unknown")}`,
    `Lineage: ${safeIdentifier(metadata.correlation?.lineageStatus, "unknown")}`,
  ];
  return labels.map((label) => safeLabel(label)).filter(Boolean).slice(0, maxLabels);
}

function countUnsafe(value: unknown, diagnostics: ControlledAgentTaskHarnessDiagnostic[], path = "metadata"): number {
  if (typeof value === "string") {
    if (unsafeStringPattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe raw marker omitted from ${safeLabel(path)}.`));
      return 1;
    }
    return 0;
  }
  if (Array.isArray(value)) return value.reduce((count, item, index) => count + countUnsafe(item, diagnostics, `${path}[${index}]`), 0);
  if (!isPlainObject(value)) return 0;
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (isSecretLikeKey(key) || isRawContentLikeKey(key) || unsafeKey(key)) {
      if (item === false || item === 0 || item === undefined || item === null) continue;
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe raw field omitted from .`));
      count += 1;
      continue;
    }
    count += countUnsafe(item, diagnostics, `${path}.${key}`);
  }
  return count;
}

function unsafeKey(key: string): boolean {
  return /^(?:rawDiff|diff|rawReplacement|replacement|rawCommand|command|rawOutput|output|privatePath|secret|bridgeDump|browserStorageDump|fileBody|fileContent|providerResponse|providerPayload|cwd|env|args|shell)$/iu.test(key);
}

function statusLabel(state: ControlledAgentTaskHarnessState, host: ControlledAgentTaskHarnessHost): string {
  if (state === "unsupported") return "Unsupported host; trusted execution blocked";
  if (state === "partial_fail_closed") return "Partial host; metadata fail-closed";
  if (state === "blocked") return "Blocked until safe explicit metadata is restored";
  if (state === "failed") return "Verification failed; manual follow-up only";
  if (state === "followup_ready") return "Follow-up ready; user choice required";
  return host === "vscode" ? "VS Code harness metadata ready" : "Harness metadata ready";
}

function normalizeHost(value: unknown): ControlledAgentTaskHarnessHost {
  if (value === "vscode" || value === "jetbrains" || value === "browser") return value;
  return "unknown";
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value)) return min;
  return Math.min(max, Math.max(min, value as number));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,100}$/u.test(value)) return fallback;
  return value;
}

function safeLabel(value: string): string {
  const sanitized = sanitizeTimelineText(value).replace(unsafeStringPattern, "[redacted]").trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > maxLabelLength ? `${safe.slice(0, maxLabelLength)}…` : safe;
}

function diagnostic(code: ControlledAgentTaskHarnessDiagnosticCode, message: string): ControlledAgentTaskHarnessDiagnostic {
  return { code, message: safeLabel(message) };
}

function dedupeDiagnostics(diagnostics: ControlledAgentTaskHarnessDiagnostic[]): ControlledAgentTaskHarnessDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
