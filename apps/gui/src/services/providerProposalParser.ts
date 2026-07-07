export type ControlledAgentProviderProposalMetadata = {
  proposalId: string;
  summary?: string;
  planSteps: string[];
  touchedFile: string;
  verificationSuggestion: string;
  replacementByteCount: number;
};

export type ProviderProposalParseDiagnosticCode = "empty" | "oversized" | "ambiguous" | "invalid_json" | "invalid_schema" | "unsafe_metadata";

export type ProviderProposalParseDiagnostic = {
  code: ProviderProposalParseDiagnosticCode;
  message: string;
};

export type ProviderProposalParseResult =
  | { state: "valid"; proposal: ControlledAgentProviderProposalMetadata; payloadKey: string }
  | { state: "rejected"; diagnostic: ProviderProposalParseDiagnostic }
  | { state: "none" };

type JsonCandidateResult =
  | { state: "valid"; text: string }
  | { state: "rejected"; diagnostic: ProviderProposalParseDiagnostic }
  | { state: "none" };

const maxContentLength = 24000;
const maxStringLength = 12000;
const expectedTopLevelKeys = ["kind", "version", "authority", "cloudRequired", "executionAllowed", "providerToolCallingAllowed", "rawProviderPayloadStored", "automaticApplyAllowed", "automaticRunAllowed", "workspace", "providerProposal", "policyFlags"] as const;
const expectedWorkspaceKeys = ["controlledWorkspaceId", "runId", "workspaceMode", "host", "privatePathExposed", "workspaceLabel"] as const;
const expectedProviderProposalKeys = ["proposalId", "source", "sanitizedOnly", "rawPayloadStored", "toolCallsIncluded", "automaticActionsIncluded", "summary", "plan", "editMetadata", "verificationSuggestion"] as const;
const expectedPlanKeys = ["stepCount", "steps"] as const;
const expectedEditKeys = ["operation", "workspaceRelativePath", "expectedContentHash", "startLine", "endLine", "replacementByteCount", "rawReplacementStored", "rawDiffStored", "requiresUserApply", "fileLabel", "summary"] as const;
const expectedVerificationKeys = ["commandId", "allowlistedCommandIdOnly", "freeformCommandAllowed", "requiresUserRun", "summary"] as const;
const expectedPolicyKeys = ["metadataOnly", "boundedPlanMetadataAllowed", "boundedEditMetadataAllowed", "providerToolCallingAllowed", "rawProviderPayloadPersistenceAllowed", "rawPromptPersistenceAllowed", "rawFilePersistenceAllowed", "rawDiffPersistenceAllowed", "rawCommandPersistenceAllowed", "rawOutputPersistenceAllowed", "automaticApplyAllowed", "automaticRunAllowed", "automaticVerifyAllowed", "automaticRepairAllowed", "shellAllowed", "gitAllowed", "networkAllowed", "packageInstallAllowed", "hiddenReadAllowed", "searchAllowed", "indexingAllowed", "toolAuthorityAllowed"] as const;
const safeIdPattern = /^(?!assistant(?:[._-]|$))(?!.*(?:assistant|sk-(?:proj-)?))[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/i;
const workspaceRelativePathPattern = /^(?!\/)(?![A-Za-z]:)(?!~)(?!.*(?:^|\/)\.)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[\\:*?"<>|{}\[\]$^+])(?!(?:^|.*\/)(?:node_modules|vendor|dist|build|out|target|coverage|__pycache__|generated|tmp|temp|secrets?|credentials?|private)(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const hashPattern = /^sha256:(?:[a-f0-9]{64}|\[redacted\])$/;
const unsafeTextPattern = /api[-_ ]?key|authorization|bearer|cookie|token|secret|password|raw[-_ ]?(?:prompt|payload|response|file|diff|command|output)|file[-_ ]?(?:body|content)|provider(?:[-_ ]?(?:tool|payload|response))?|tool(?:[-_ ]?call)?|shell|command|cwd|env|git|network|package[-_ ]?install|hidden[-_ ]?(?:scan|read|search)|index(?:ing)?|auto[-_ ]?(?:start|apply|run|verify|fix|repair)|apply[-_ ]?patch|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)|BEGIN [A-Za-z ]*PRIVATE KEY/i;
const commandLabels: Record<string, string> = {
  "repository-check": "Repository check",
  "gui-app-tests": "GUI app tests",
  "engine-chat-tests": "Engine chat tests",
};

export function parseControlledAgentProviderProposal(content: string): ProviderProposalParseResult {
  if (typeof content !== "string") {
    return rejected("invalid_schema", "Provider proposal content must be text.");
  }
  const candidate = extractJsonCandidate(content);
  if (candidate.state !== "valid") {
    return candidate;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.text);
  } catch {
    return rejected("invalid_json", "Provider proposal JSON is not valid.");
  }
  const validation = validateProviderProposal(parsed);
  if (validation.state !== "valid") {
    return validation;
  }
  return { state: "valid", proposal: validation.proposal, payloadKey: canonicalizeJsonValue(parsed) };
}

function validateProviderProposal(value: unknown): ProviderProposalParseResult {
  if (!looksLikeProviderProposalObject(value)) {
    return { state: "none" };
  }
  if (!isPlainObject(value) || !hasOnlyKeys(value, expectedTopLevelKeys) || hasOversizedString(value)) {
    return rejected("invalid_schema", "Provider proposal metadata does not match the bounded proposal contract.");
  }
  if (value.kind !== "controlled_agent_provider_proposal" || value.version !== "2026-07-07" || value.authority !== "provider_proposal_metadata_only") {
    return rejected("invalid_schema", "Provider proposal metadata uses an unsupported kind, version, or authority.");
  }
  if (value.cloudRequired !== false || value.executionAllowed !== false || value.providerToolCallingAllowed !== false || value.rawProviderPayloadStored !== false || value.automaticApplyAllowed !== false || value.automaticRunAllowed !== false) {
    return rejected("unsafe_metadata", "Provider proposal metadata included raw, tool-calling, execution, or automatic action authority.");
  }
  if (!isWorkspace(value.workspace) || !isPolicyFlags(value.policyFlags)) {
    return rejected("unsafe_metadata", "Provider proposal workspace or policy metadata is unsafe.");
  }
  const providerProposal = value.providerProposal;
  if (!isPlainObject(providerProposal) || !hasOnlyKeys(providerProposal, expectedProviderProposalKeys)) {
    return rejected("invalid_schema", "Provider proposal metadata has unsupported provider fields.");
  }
  if (providerProposal.source !== "model" || providerProposal.sanitizedOnly !== true || providerProposal.rawPayloadStored !== false || providerProposal.toolCallsIncluded !== false || providerProposal.automaticActionsIncluded !== false) {
    return rejected("unsafe_metadata", "Provider proposal included raw payload, tool-call, or automatic action metadata.");
  }
  if (!safeId(providerProposal.proposalId) || !safeOptionalText(providerProposal.summary, 240) || !isPlan(providerProposal.plan) || !isEdit(providerProposal.editMetadata) || !isVerification(providerProposal.verificationSuggestion)) {
    return rejected("invalid_schema", "Provider proposal metadata contains malformed bounded display fields.");
  }
  return {
    state: "valid",
    proposal: {
      proposalId: providerProposal.proposalId,
      summary: providerProposal.summary,
      planSteps: providerProposal.plan.steps,
      touchedFile: providerProposal.editMetadata.workspaceRelativePath,
      verificationSuggestion: commandLabels[providerProposal.verificationSuggestion.commandId],
      replacementByteCount: providerProposal.editMetadata.replacementByteCount,
    },
    payloadKey: "",
  };
}

function isWorkspace(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, expectedWorkspaceKeys) && safeId(value.controlledWorkspaceId) && safeId(value.runId) && (value.workspaceMode === "disposable" || value.workspaceMode === "worktree" || value.workspaceMode === "existing") && (value.host === "vscode" || value.host === "jetbrains") && value.privatePathExposed === false && safeOptionalText(value.workspaceLabel, 100);
}

function isPolicyFlags(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, expectedPolicyKeys)) {
    return false;
  }
  return value.metadataOnly === true && value.boundedPlanMetadataAllowed === true && value.boundedEditMetadataAllowed === true && expectedPolicyKeys.every((key) => key === "metadataOnly" || key === "boundedPlanMetadataAllowed" || key === "boundedEditMetadataAllowed" || value[key] === false);
}

function isPlan(value: unknown): value is { stepCount: number; steps: string[] } {
  if (!isPlainObject(value) || !hasOnlyKeys(value, expectedPlanKeys) || !integerBetween(value.stepCount, 1, 3) || !Array.isArray(value.steps)) {
    return false;
  }
  return value.steps.length === value.stepCount && value.steps.length >= 1 && value.steps.length <= 3 && value.steps.every((item) => safeText(item, 100));
}

function isEdit(value: unknown): value is { workspaceRelativePath: string; replacementByteCount: number } {
  return isPlainObject(value) && hasOnlyKeys(value, expectedEditKeys) && value.operation === "replace" && typeof value.workspaceRelativePath === "string" && workspaceRelativePathPattern.test(value.workspaceRelativePath) && typeof value.expectedContentHash === "string" && hashPattern.test(value.expectedContentHash) && integerBetween(value.startLine, 1, 1000000) && integerBetween(value.endLine, 1, 1000000) && Number(value.startLine) <= Number(value.endLine) && integerBetween(value.replacementByteCount, 0, 12000) && value.rawReplacementStored === false && value.rawDiffStored === false && value.requiresUserApply === true && safeOptionalText(value.fileLabel, 100) && safeOptionalText(value.summary, 240);
}

function isVerification(value: unknown): value is { commandId: keyof typeof commandLabels } {
  return isPlainObject(value) && hasOnlyKeys(value, expectedVerificationKeys) && typeof value.commandId === "string" && value.commandId in commandLabels && value.allowlistedCommandIdOnly === true && value.freeformCommandAllowed === false && value.requiresUserRun === true && safeOptionalText(value.summary, 240);
}

function extractJsonCandidate(content: string): JsonCandidateResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return rejected("empty", "Provider proposal output is empty.");
  }
  if (trimmed.length > maxContentLength) {
    return rejected("oversized", "Provider proposal output is too large to review safely.");
  }
  const fenceMatches = Array.from(trimmed.matchAll(/```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```/g));
  if (fenceMatches.length > 0) {
    if (fenceMatches.length !== 1 || (trimmed.match(/```/g) ?? []).length !== 2 || (fenceMatches[0][1] ?? "").toLowerCase() !== "json") {
      return rejected("ambiguous", "Provider proposal output must contain exactly one json object.");
    }
    const before = trimmed.slice(0, fenceMatches[0].index).trim();
    const after = trimmed.slice((fenceMatches[0].index ?? 0) + fenceMatches[0][0].length).trim();
    if (before || after) {
      return rejected("ambiguous", "Provider proposal output must not mix prose with proposal JSON.");
    }
    return { state: "valid", text: fenceMatches[0][2].trim() };
  }
  if (!isStrictFullJsonObject(trimmed)) {
    return looksLikeProviderProposal(trimmed) ? rejected("invalid_json", "Provider proposal JSON is not valid.") : { state: "none" };
  }
  return { state: "valid", text: trimmed };
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}

function safeOptionalText(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || safeText(value, maxLength);
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && !unsafeTextPattern.test(value);
}

function integerBetween(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function hasOversizedString(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > maxStringLength;
  }
  if (Array.isArray(value)) {
    return value.some(hasOversizedString);
  }
  if (isPlainObject(value)) {
    return Object.values(value).some(hasOversizedString);
  }
  return false;
}

function looksLikeProviderProposalObject(value: unknown): boolean {
  return isPlainObject(value) && (value.kind === "controlled_agent_provider_proposal" || "providerProposal" in value || "policyFlags" in value || "providerToolCallingAllowed" in value || "rawProviderPayloadStored" in value);
}

function looksLikeProviderProposal(text: string): boolean {
  return /controlled_agent_provider_proposal|providerProposal|policyFlags|rawProviderPayloadStored|providerToolCallingAllowed/i.test(text);
}

function isStrictFullJsonObject(text: string): boolean {
  if (text[0] !== "{" || text[text.length - 1] !== "}") {
    return false;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && i !== text.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

function rejected(code: ProviderProposalParseDiagnosticCode, message: string): { state: "rejected"; diagnostic: ProviderProposalParseDiagnostic } {
  return { state: "rejected", diagnostic: { code, message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function canonicalizeJsonValue(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  const objectValue = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(objectValue).sort()) {
    sorted[key] = canonicalizeValue(objectValue[key]);
  }
  return sorted;
}
