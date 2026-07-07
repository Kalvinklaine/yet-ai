import { isRawContentLikeKey, isSecretLikeKey, redactSecrets, sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type ControlledAgentAuthorityRegistryCategory =
  | "fileRead"
  | "lexicalSearch"
  | "editApply"
  | "verification"
  | "providerProposal"
  | "memoryAttachment"
  | "evidenceWrites"
  | "hostActions"
  | "unsupportedOperations";

export type ControlledAgentAuthorityRegistryHost = "browser" | "vscode" | "jetbrains";
export type ControlledAgentAuthorityRegistryDecision = "metadata_only" | "fail_closed";

export type ControlledAgentAuthorityRegistryDiagnosticCode =
  | "malformed_registry"
  | "unknown_or_invalid_field"
  | "unsafe_text"
  | "unsupported_host_overclaim"
  | "hidden_indexing_or_search"
  | "freeform_command_authority"
  | "broad_mutation_authority"
  | "provider_or_local_tool_authority"
  | "production_or_release_claim"
  | "unsupported_privileged_authority";

export type ControlledAgentAuthorityRegistryDiagnostic = {
  code: ControlledAgentAuthorityRegistryDiagnosticCode;
  message: string;
};

export type ControlledAgentAuthorityCategorySummary = {
  category: ControlledAgentAuthorityRegistryCategory;
  state: string;
  decision: ControlledAgentAuthorityRegistryDecision;
  host: ControlledAgentAuthorityRegistryHost | "none";
  allowedLabels: string[];
  blockedLabels: string[];
  summary: string;
};

export type ControlledAgentAuthorityHostSummary = {
  host: ControlledAgentAuthorityRegistryHost;
  trustedExecution: false;
  canClaimExecution: false;
  canMintPrivilegedRequests: false;
  supportState: string;
  label: string;
};

export type ControlledAgentAuthorityRegistrySummary = {
  decision: ControlledAgentAuthorityRegistryDecision;
  allowedToExecute: false;
  canReadFiles: false;
  canSearchWorkspace: false;
  canApplyEdits: false;
  canRunVerification: false;
  canCallProviderTools: false;
  canUseLocalTools: false;
  canRunShell: false;
  canUseGit: false;
  canUseNetwork: false;
  canPublishRelease: false;
  summary: string;
  categories: Record<ControlledAgentAuthorityRegistryCategory, ControlledAgentAuthorityCategorySummary>;
  hosts: Record<ControlledAgentAuthorityRegistryHost, ControlledAgentAuthorityHostSummary>;
  diagnostics: ControlledAgentAuthorityRegistryDiagnostic[];
  details: Record<string, string | boolean | string[]>;
};

type CategoryContractKey =
  | "fileRead"
  | "lexicalSearch"
  | "editApply"
  | "verificationCommandIds"
  | "providerProposalUse"
  | "memoryAttachment"
  | "runHistoryReportExportObservabilityWrites"
  | "hostActions"
  | "unsupportedPrivilegedOperations";

type CategoryDefinition = {
  output: ControlledAgentAuthorityRegistryCategory;
  input: CategoryContractKey;
};

const categoryDefinitions: CategoryDefinition[] = [
  { output: "fileRead", input: "fileRead" },
  { output: "lexicalSearch", input: "lexicalSearch" },
  { output: "editApply", input: "editApply" },
  { output: "verification", input: "verificationCommandIds" },
  { output: "providerProposal", input: "providerProposalUse" },
  { output: "memoryAttachment", input: "memoryAttachment" },
  { output: "evidenceWrites", input: "runHistoryReportExportObservabilityWrites" },
  { output: "hostActions", input: "hostActions" },
  { output: "unsupportedOperations", input: "unsupportedPrivilegedOperations" },
];

const allowedTopLevelKeys = new Set([
  "kind",
  "version",
  "authority",
  "status",
  "localFirstByok",
  "cloudRequired",
  "productionClaimAllowed",
  "releaseClaimAllowed",
  "marketplaceClaimAllowed",
  "summary",
  "userGesture",
  "hosts",
  "categories",
  "unsupportedPrivilegedOperations",
]);
const allowedUserGestureKeys = new Set(["required", "correlationRequired", "trustedRequester", "assistantMayMintRequests", "gestureLabel"]);
const allowedHostsKeys = new Set(["browser", "vscode", "jetbrains"]);
const allowedHostKeys = new Set(["trustedExecution", "canClaimExecution", "canMintPrivilegedRequests", "supportState", "label"]);
const allowedCategoriesKeys = new Set(categoryDefinitions.map((item) => item.input));
const allowedCategoryKeys = new Set([
  "state",
  "allowed",
  "blocked",
  "requiresUserGesture",
  "requiresHostSupport",
  "persistsRawSensitiveData",
  "singleExplicitFileOnly",
  "noBackgroundReads",
  "literalOnly",
  "hiddenSearchAllowed",
  "indexingAllowed",
  "backgroundScanAllowed",
  "existingFileReplacementOnly",
  "broadMutationAllowed",
  "automaticApplyAllowed",
  "createDeleteRenameMoveAllowed",
  "commandIds",
  "allowlistedCommandIdOnly",
  "freeformCommandAllowed",
  "cwdAllowed",
  "envAllowed",
  "proposalMetadataOnly",
  "providerToolAuthorityAllowed",
  "localToolAuthorityAllowed",
  "rawProviderPayloadStored",
  "explicitAttachmentOnly",
  "automaticMemorySelectionAllowed",
  "rawNoteBodyPersistenceAllowed",
  "sanitizedMetadataOnly",
  "rawPromptStored",
  "rawFileStored",
  "rawCommandStored",
  "rawProviderStored",
  "openRevealPreviewOnly",
  "packageUpdateAllowed",
  "taskBoardMutationAllowed",
  "shellAllowed",
  "gitAllowed",
  "networkAllowed",
  "packageInstallAllowed",
  "releaseOperationAllowed",
  "notes",
]);
const allowedUnsupportedOperationKeys = new Set(["defaultState", "operations", "futureChangeRequires"]);
const productionClaimKeys = new Set(["productionReady", "productionClaim", "releaseReady", "marketplaceReady", "publishReady", "releaseClaim", "marketplaceClaim"]);
const boundedTextLimit = 220;
const categoryLabelLimit = 6;

export function evaluateControlledAgentAuthorityRegistry(input: unknown): ControlledAgentAuthorityRegistrySummary {
  const diagnostics: ControlledAgentAuthorityRegistryDiagnostic[] = [];
  const registry = parseRegistry(input, diagnostics);
  if (registry) {
    inspectRegistry(registry, diagnostics);
  }
  const failClosed = !registry || diagnostics.length > 0;
  const categories = buildCategorySummaries(registry, failClosed);
  const hosts = buildHostSummaries(registry, failClosed);
  const safeSummary = registry && !failClosed && typeof registry.summary === "string" ? boundedText(registry.summary, "Authority registry summary is metadata only.") : "Authority registry failed closed.";
  return {
    decision: failClosed ? "fail_closed" : "metadata_only",
    allowedToExecute: false,
    canReadFiles: false,
    canSearchWorkspace: false,
    canApplyEdits: false,
    canRunVerification: false,
    canCallProviderTools: false,
    canUseLocalTools: false,
    canRunShell: false,
    canUseGit: false,
    canUseNetwork: false,
    canPublishRelease: false,
    summary: safeSummary,
    categories,
    hosts,
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: boundedText(item.message, "Authority registry denied.") })),
    details: sanitizeDetails({
      displayOnly: true,
      localFirstByok: registry?.localFirstByok === true,
      cloudRequired: registry?.cloudRequired === true,
      authority: registry?.authority,
      status: registry?.status,
    }),
  };
}

function parseRegistry(input: unknown, diagnostics: ControlledAgentAuthorityRegistryDiagnostic[]): Record<string, unknown> | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_registry", message: "Authority registry must be an object." });
    return undefined;
  }
  inspectUnsafeText(input, diagnostics);
  inspectUnexpectedFields(input, diagnostics);
  if (input.kind !== "controlled_agent_authority_registry" || typeof input.version !== "string" || typeof input.authority !== "string" || typeof input.status !== "string" || typeof input.summary !== "string" || !isPlainObject(input.hosts) || !isPlainObject(input.categories)) {
    diagnostics.push({ code: "malformed_registry", message: "Authority registry does not match the required display contract." });
    return undefined;
  }
  return input;
}

function inspectRegistry(registry: Record<string, unknown>, diagnostics: ControlledAgentAuthorityRegistryDiagnostic[]): void {
  if (registry.localFirstByok !== true || registry.cloudRequired !== false) {
    diagnostics.push({ code: "malformed_registry", message: "Authority registry must preserve local-first BYOK and no-cloud-required constraints." });
  }
  if (registry.productionClaimAllowed !== false || registry.releaseClaimAllowed !== false || registry.marketplaceClaimAllowed !== false) {
    diagnostics.push({ code: "production_or_release_claim", message: "Production, release, and marketplace claims must remain blocked." });
  }
  const userGesture = registry.userGesture;
  if (!isPlainObject(userGesture) || userGesture.required !== true || userGesture.correlationRequired !== true || userGesture.assistantMayMintRequests !== false) {
    diagnostics.push({ code: "malformed_registry", message: "Authority registry requires explicit user gesture correlation and blocks assistant-minted requests." });
  }
  inspectHosts(registry.hosts, diagnostics);
  inspectCategories(registry.categories, diagnostics);
  inspectUnsupportedOperations(registry.unsupportedPrivilegedOperations, diagnostics);
}

function inspectHosts(input: unknown, diagnostics: ControlledAgentAuthorityRegistryDiagnostic[]): void {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_registry", message: "Authority registry hosts must be an object." });
    return;
  }
  const browser = input.browser;
  if (!isPlainObject(browser) || browser.trustedExecution !== false || browser.canClaimExecution !== false || browser.canMintPrivilegedRequests !== false) {
    diagnostics.push({ code: "unsupported_host_overclaim", message: "Browser trusted execution must remain unsupported." });
  }
  const vscode = input.vscode;
  if (!isPlainObject(vscode) || vscode.trustedExecution !== true || vscode.canClaimExecution !== true || vscode.canMintPrivilegedRequests !== true || vscode.supportState !== "first_execution_host") {
    diagnostics.push({ code: "unsupported_host_overclaim", message: "VS Code may only be summarized as the first execution host from the registry contract." });
  }
  const jetbrains = input.jetbrains;
  if (!isPlainObject(jetbrains) || jetbrains.trustedExecution !== false || jetbrains.canClaimExecution !== false || jetbrains.canMintPrivilegedRequests !== false) {
    diagnostics.push({ code: "unsupported_host_overclaim", message: "JetBrains controlled execution remains fail-closed in this GUI summary." });
  }
}

function inspectCategories(input: unknown, diagnostics: ControlledAgentAuthorityRegistryDiagnostic[]): void {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_registry", message: "Authority categories must be an object." });
    return;
  }
  for (const definition of categoryDefinitions) {
    const category = input[definition.input];
    if (!isPlainObject(category)) {
      diagnostics.push({ code: "malformed_registry", message: `Authority category ${definition.output} is missing or malformed.` });
      continue;
    }
    if (category.requiresUserGesture !== true || category.requiresHostSupport !== true || category.persistsRawSensitiveData !== false) {
      diagnostics.push({ code: "malformed_registry", message: `Authority category ${definition.output} is not bounded by gesture, host support, and no raw sensitive persistence.` });
    }
  }
  const lexicalSearch = input.lexicalSearch;
  if (isPlainObject(lexicalSearch) && (lexicalSearch.hiddenSearchAllowed !== false || lexicalSearch.indexingAllowed !== false || lexicalSearch.backgroundScanAllowed !== false)) {
    diagnostics.push({ code: "hidden_indexing_or_search", message: "Hidden search, indexing, and background scans must fail closed." });
  }
  const editApply = input.editApply;
  if (isPlainObject(editApply) && (editApply.broadMutationAllowed !== false || editApply.automaticApplyAllowed !== false || editApply.createDeleteRenameMoveAllowed !== false)) {
    diagnostics.push({ code: "broad_mutation_authority", message: "Broad mutation and automatic apply authority must remain blocked." });
  }
  const verification = input.verificationCommandIds;
  if (isPlainObject(verification) && (verification.allowlistedCommandIdOnly !== true || verification.freeformCommandAllowed !== false || verification.cwdAllowed !== false || verification.envAllowed !== false)) {
    diagnostics.push({ code: "freeform_command_authority", message: "Verification must use allowlisted command ids only, without free-form command, cwd, or env authority." });
  }
  const providerProposal = input.providerProposalUse;
  if (isPlainObject(providerProposal) && (providerProposal.providerToolAuthorityAllowed !== false || providerProposal.localToolAuthorityAllowed !== false || providerProposal.rawProviderPayloadStored !== false)) {
    diagnostics.push({ code: "provider_or_local_tool_authority", message: "Provider and local tool authority must remain blocked and metadata-only." });
  }
  const memoryAttachment = input.memoryAttachment;
  if (isPlainObject(memoryAttachment) && (memoryAttachment.automaticMemorySelectionAllowed !== false || memoryAttachment.rawNoteBodyPersistenceAllowed !== false)) {
    diagnostics.push({ code: "unsupported_privileged_authority", message: "Memory attachment must remain explicit metadata only." });
  }
  const evidence = input.runHistoryReportExportObservabilityWrites;
  if (isPlainObject(evidence) && (evidence.rawPromptStored !== false || evidence.rawFileStored !== false || evidence.rawCommandStored !== false || evidence.rawProviderStored !== false || evidence.sanitizedMetadataOnly !== true)) {
    diagnostics.push({ code: "unsupported_privileged_authority", message: "Evidence writes must remain sanitized metadata only." });
  }
  const hostActions = input.hostActions;
  if (isPlainObject(hostActions) && (hostActions.packageUpdateAllowed !== false || hostActions.taskBoardMutationAllowed !== false || hostActions.openRevealPreviewOnly !== true)) {
    diagnostics.push({ code: "unsupported_privileged_authority", message: "Host actions must remain bounded preview actions only." });
  }
  const unsupported = input.unsupportedPrivilegedOperations;
  if (isPlainObject(unsupported) && (unsupported.shellAllowed !== false || unsupported.gitAllowed !== false || unsupported.networkAllowed !== false || unsupported.packageInstallAllowed !== false || unsupported.releaseOperationAllowed !== false)) {
    diagnostics.push({ code: "unsupported_privileged_authority", message: "Privileged operations must remain blocked." });
  }
}

function inspectUnsupportedOperations(input: unknown, diagnostics: ControlledAgentAuthorityRegistryDiagnostic[]): void {
  if (!isPlainObject(input) || input.defaultState !== "blocked") {
    diagnostics.push({ code: "unsupported_privileged_authority", message: "Unsupported privileged operations must default to blocked." });
    return;
  }
  const operations = input.operations;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 20) {
    diagnostics.push({ code: "unsupported_privileged_authority", message: "Unsupported privileged operations must be a bounded blocked list." });
  }
}

function inspectUnexpectedFields(value: unknown, diagnostics: ControlledAgentAuthorityRegistryDiagnostic[], path = "registry"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectUnexpectedFields(item, diagnostics, `${path}.${index}`));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  const allowedKeys = allowedKeysForPath(path);
  for (const [key, item] of Object.entries(value)) {
    if (productionClaimKeys.has(key)) {
      diagnostics.push({ code: "production_or_release_claim", message: `Production or publication claim field ${sanitizeDisplayText(key)} is not supported.` });
    }
    if (allowedKeys && !allowedKeys.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported authority registry field ${sanitizeDisplayText(key)}.` });
    }
    inspectUnexpectedFields(item, diagnostics, nextPath(path, key));
  }
}

function allowedKeysForPath(path: string): Set<string> | undefined {
  if (path === "registry") {
    return allowedTopLevelKeys;
  }
  if (path === "registry.userGesture") {
    return allowedUserGestureKeys;
  }
  if (path === "registry.hosts") {
    return allowedHostsKeys;
  }
  if (path.startsWith("registry.hosts.")) {
    return allowedHostKeys;
  }
  if (path === "registry.categories") {
    return allowedCategoriesKeys;
  }
  if (path.startsWith("registry.categories.")) {
    return allowedCategoryKeys;
  }
  if (path === "registry.unsupportedPrivilegedOperations") {
    return allowedUnsupportedOperationKeys;
  }
  return undefined;
}

function nextPath(path: string, key: string): string {
  if (path === "registry.categories" || path === "registry.hosts") {
    return `${path}.${key}`;
  }
  if (path === "registry") {
    return `${path}.${key}`;
  }
  return path;
}

function inspectUnsafeText(value: unknown, diagnostics: ControlledAgentAuthorityRegistryDiagnostic[]): void {
  const seen = new WeakSet<object>();
  const unsafe = inspectUnsafeTextInner(value, seen);
  if (unsafe) {
    diagnostics.push({ code: "unsafe_text", message: "Authority registry contained unsafe display text or raw payload markers and was redacted." });
  }
}

function inspectUnsafeTextInner(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === "string") {
    return value.trim().toLowerCase() !== "file contents" && redactSecrets(value) !== value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.some((item) => inspectUnsafeTextInner(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.entries(value).some(([key, item]) => {
      const safeBlockedFlag = item === false && allowedCategoryKeys.has(key);
      return (!safeBlockedFlag && (isSecretLikeKey(key) || isRawContentLikeKey(key))) || redactSecrets(key) !== key || inspectUnsafeTextInner(item, seen);
    });
  }
  return false;
}

function buildCategorySummaries(registry: Record<string, unknown> | undefined, failClosed: boolean): Record<ControlledAgentAuthorityRegistryCategory, ControlledAgentAuthorityCategorySummary> {
  return Object.fromEntries(categoryDefinitions.map((definition) => {
    const categoryValue = isPlainObject(registry?.categories) ? registry.categories[definition.input] : undefined;
    const category = isPlainObject(categoryValue) ? categoryValue : undefined;
    return [definition.output, buildCategorySummary(definition.output, category, failClosed)];
  })) as Record<ControlledAgentAuthorityRegistryCategory, ControlledAgentAuthorityCategorySummary>;
}

function buildCategorySummary(category: ControlledAgentAuthorityRegistryCategory, input: Record<string, unknown> | undefined, failClosed: boolean): ControlledAgentAuthorityCategorySummary {
  const state = typeof input?.state === "string" ? boundedText(input.state, "blocked") : "blocked";
  const allowedLabels = safeStringArray(input?.allowed, categoryLabelLimit, 90);
  const blockedLabels = safeStringArray(input?.blocked, categoryLabelLimit, 90);
  return {
    category,
    state: failClosed ? "blocked" : state,
    decision: failClosed || state === "blocked" ? "fail_closed" : "metadata_only",
    host: failClosed || state === "blocked" ? "none" : "vscode",
    allowedLabels: failClosed ? [] : allowedLabels,
    blockedLabels,
    summary: failClosed ? "Authority category failed closed." : boundedText(typeof input?.notes === "string" ? input.notes : state, "Authority category metadata only."),
  };
}

function buildHostSummaries(registry: Record<string, unknown> | undefined, failClosed: boolean): Record<ControlledAgentAuthorityRegistryHost, ControlledAgentAuthorityHostSummary> {
  return {
    browser: buildHostSummary("browser", isPlainObject(registry?.hosts) && isPlainObject(registry.hosts.browser) ? registry.hosts.browser : undefined, failClosed),
    vscode: buildHostSummary("vscode", isPlainObject(registry?.hosts) && isPlainObject(registry.hosts.vscode) ? registry.hosts.vscode : undefined, failClosed),
    jetbrains: buildHostSummary("jetbrains", isPlainObject(registry?.hosts) && isPlainObject(registry.hosts.jetbrains) ? registry.hosts.jetbrains : undefined, failClosed),
  };
}

function buildHostSummary(host: ControlledAgentAuthorityRegistryHost, input: Record<string, unknown> | undefined, failClosed: boolean): ControlledAgentAuthorityHostSummary {
  const supportState = typeof input?.supportState === "string" ? boundedText(input.supportState, "unsupported") : "unsupported";
  const label = typeof input?.label === "string" ? boundedText(input.label, `${host} host`) : `${host} host`;
  if (host === "vscode" && !failClosed && supportState === "first_execution_host") {
    return { host, trustedExecution: false, canClaimExecution: false, canMintPrivilegedRequests: false, supportState, label };
  }
  if (host === "jetbrains") {
    return { host, trustedExecution: false, canClaimExecution: false, canMintPrivilegedRequests: false, supportState: failClosed ? "fail_closed" : supportState, label };
  }
  return { host, trustedExecution: false, canClaimExecution: false, canMintPrivilegedRequests: false, supportState: failClosed ? "unsupported" : supportState, label };
}

function safeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => boundedText(item, "metadata", maxLength)).slice(0, maxItems);
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const output: Record<string, string | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") {
      output[safeKey] = boundedText(value, "metadata");
    } else if (typeof value === "boolean") {
      output[safeKey] = value;
    } else if (Array.isArray(value)) {
      output[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => boundedText(item, "metadata", 90)).slice(0, 8);
    }
  }
  return output;
}

function boundedText(input: string, fallback: string, limit = boundedTextLimit): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
