import { isApplyWorkspaceEditPayload, type ApplyWorkspaceEditPayload, type VerificationCommandId } from "../bridge/bridgeAdapter";

const bridgeVersion = "2026-05-15";
const applyEditRequestType = "gui.applyWorkspaceEditRequest";
const planToPatchProposalType = "agent_run.plan_to_patch_proposal";
const planToPatchProposalVersion = "2026-06-24";

export type EditProposalSourceMessage = {
  id: string;
  role: string;
  status?: string;
  content: string;
};

export type EditProposalCandidate = {
  proposal: ApplyWorkspaceEditPayload;
  sourceMessageId: string;
  payloadKey: string;
  planToPatchMetadata?: PlanToPatchProposalMetadata;
};

export type PlanToPatchVerificationSuggestion = {
  commandId: VerificationCommandId;
  label: string;
};

export type PlanToPatchProposalMetadata = {
  summary: string;
  plan: string[];
  risks: string[];
  verificationSuggestions: PlanToPatchVerificationSuggestion[];
};

export type EditProposalIdentity = {
  sourceMessageId: string;
  payloadKey: string;
};

export type EditProposalRejectedReasonCode =
  | "empty"
  | "oversized"
  | "no_json"
  | "ambiguous"
  | "invalid_json"
  | "invalid_fence"
  | "fenced_payload_requires_envelope"
  | "invalid_envelope"
  | "wrong_version"
  | "assistant_request_id"
  | "unknown_keys"
  | "envelope_like_direct_payload"
  | "command_tool_smuggling"
  | "unsafe_path"
  | "missing_confirmation"
  | "oversized_content"
  | "unsupported_verification"
  | "invalid_payload"
  | "proposal_like_rejected";

export type EditProposalRejectedDiagnostic = {
  reasonCode: EditProposalRejectedReasonCode;
  message: string;
};

export type EditProposalRejectedRecoveryGuidance = {
  title: string;
  nextStep: string;
  formatHint: string;
};

export type EditProposalAnalysis =
  | { state: "valid"; proposal: ApplyWorkspaceEditPayload; planToPatchMetadata?: PlanToPatchProposalMetadata }
  | { state: "rejected"; diagnostic: EditProposalRejectedDiagnostic }
  | { state: "none" };

export type EditProposalReview =
  | { state: "valid"; candidate: EditProposalCandidate }
  | { state: "rejected"; sourceMessageId: string; diagnostic: EditProposalRejectedDiagnostic }
  | { state: "none" };

const envelopeKeys = ["type", "version", "payload"] as const;
const planToPatchEnvelopeKeys = ["version", "type", "summary", "plan", "risks", "editProposal", "verificationSuggestions"] as const;
const maxContentLength = 50000;

export function analyzeEditProposalContent(content: string): EditProposalAnalysis {
  if (typeof content !== "string") {
    return rejected("proposal_like_rejected");
  }
  const candidate = extractSingleJsonCandidate(content);
  if (candidate.state === "none") {
    return { state: "none" };
  }
  if (candidate.state === "rejected") {
    return { state: "rejected", diagnostic: candidate.diagnostic };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.text);
  } catch {
    return rejected("invalid_json");
  }
  if (!isPlainObject(parsed)) {
    return rejected(isProposalLikeParsedValue(parsed) ? "proposal_like_rejected" : "invalid_payload");
  }

  if (parsed.type === applyEditRequestType) {
    if ("requestId" in parsed) {
      return rejected("assistant_request_id");
    }
    if (!hasOnlyKeys(parsed, envelopeKeys)) {
      return rejected("unknown_keys");
    }
    if (parsed.version !== bridgeVersion) {
      return rejected("wrong_version");
    }
    if (!isPlainObject(parsed.payload)) {
      return rejected("invalid_envelope");
    }
    if (hasCommandToolSmuggling(parsed.payload)) {
      return rejected("command_tool_smuggling");
    }
    return isApplyWorkspaceEditPayload(parsed.payload) ? { state: "valid", proposal: parsed.payload } : rejected("invalid_payload");
  }

  if (parsed.type === planToPatchProposalType) {
    return analyzePlanToPatchProposal(parsed);
  }

  if (candidate.requireEnvelope) {
    if (isApplyWorkspaceEditPayload(parsed)) {
      return rejected("fenced_payload_requires_envelope");
    }
    return isProposalLikeParsedValue(parsed) || "type" in parsed || "version" in parsed || "payload" in parsed ? rejected("invalid_envelope") : { state: "none" };
  }
  if ("type" in parsed || "version" in parsed || "payload" in parsed) {
    return rejected("envelope_like_direct_payload");
  }
  if (hasCommandToolSmuggling(parsed)) {
    return rejected("command_tool_smuggling");
  }
  if (isApplyWorkspaceEditPayload(parsed)) {
    return { state: "valid", proposal: parsed };
  }
  return isProposalLikeParsedValue(parsed) ? rejected("invalid_payload") : { state: "none" };
}

export function parseEditProposalContent(content: string): ApplyWorkspaceEditPayload | null {
  const analysis = analyzeEditProposalContent(content);
  return analysis.state === "valid" ? analysis.proposal : null;
}

export function editProposalRejectedRecoveryGuidance(reasonCode: EditProposalRejectedReasonCode): EditProposalRejectedRecoveryGuidance {
  switch (reasonCode) {
    case "no_json":
    case "invalid_json":
    case "invalid_fence":
    case "fenced_payload_requires_envelope":
      return {
        title: "Proposal format needs correction.",
        nextStep: "Ask for one strict safe-edit JSON proposal and review it again before requesting IDE apply.",
        formatHint: "Use either one direct replacement-only payload or one json-fenced full envelope, not prose plus partial JSON.",
      };
    case "ambiguous":
      return {
        title: "Only one proposal can be reviewed at a time.",
        nextStep: "Ask for a single smaller patch proposal that targets the intended change only.",
        formatHint: "Send one bounded safe-edit JSON object with one clear set of replacement-only edits.",
      };
    case "unsafe_path":
      return {
        title: "A path was not workspace-relative and safe.",
        nextStep: "Ask for the same edit with corrected workspace-relative paths only.",
        formatHint: "Paths should look like src/file.ts, without absolute paths, home folders, parent traversal, drive letters, secrets, or URL/query parts.",
      };
    case "missing_confirmation":
      return {
        title: "Explicit user confirmation is missing.",
        nextStep: "Ask for a safe-edit proposal that sets requiresUserConfirmation to true.",
        formatHint: "The GUI keeps apply unavailable until the proposal explicitly requires manual confirmation.",
      };
    case "oversized":
    case "oversized_content":
      return {
        title: "The proposed change is too large for safe review.",
        nextStep: "Ask for a smaller patch focused on one reviewable change.",
        formatHint: "Keep replacement text bounded and split broad changes into separate manually reviewed proposals.",
      };
    case "command_tool_smuggling":
      return {
        title: "The proposal mixed edits with command or tool fields.",
        nextStep: "Ask for replacement-only safe-edit JSON with no command, tool, or execution fields.",
        formatHint: "A valid proposal describes workspace-relative text replacements only; verification remains a separate explicit user choice.",
      };
    case "assistant_request_id":
      return {
        title: "The proposal tried to provide an apply request id.",
        nextStep: "Ask for the same edit without any requestId field.",
        formatHint: "Request ids are created by the GUI only after you choose to request apply.",
      };
    case "unsupported_verification":
      return {
        title: "The verification suggestion is not supported here.",
        nextStep: "Ask for a proposal that uses only supported display-only verification suggestions.",
        formatHint: "Supported suggestions are repository-check, gui-app-tests, or engine-chat-tests labels only.",
      };
    case "invalid_payload":
    case "proposal_like_rejected":
      return {
        title: "The edit shape is not a supported safe-edit proposal.",
        nextStep: "Ask for a corrected replacement-only safe-edit JSON proposal.",
        formatHint: "Use requiresUserConfirmation true, cloudRequired false, workspace-relative files, and textReplacements ranges only.",
      };
    case "invalid_envelope":
    case "wrong_version":
    case "unknown_keys":
    case "envelope_like_direct_payload":
    case "empty":
      return {
        title: "The proposal envelope is not accepted.",
        nextStep: "Ask for one strict safe-edit JSON proposal using the supported schema only.",
        formatHint: "Remove unsupported fields and keep envelope metadata separate from the edit payload.",
      };
  }
}

export function editProposalPayloadKey(payload: ApplyWorkspaceEditPayload): string {
  const normalized: ApplyWorkspaceEditPayload = payload.cloudRequired === false
    ? payload
    : { ...payload, cloudRequired: false };
  return canonicalizeJsonValue(normalized);
}

export function isCompleteAssistantEditProposalStatus(status: string | undefined): boolean {
  return status === undefined || status === "complete";
}

export function latestEditProposalReviewFromMessages(messages: EditProposalSourceMessage[]): EditProposalReview {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }
    if (!isCompleteAssistantEditProposalStatus(message.status)) {
      continue;
    }
    const analysis = analyzeEditProposalContent(message.content);
    if (analysis.state === "none") {
      continue;
    }
    if (analysis.state === "rejected") {
      if (!isLatestReviewRejectedProposalLike(message.content, analysis.diagnostic.reasonCode)) {
        continue;
      }
      return { state: "rejected", sourceMessageId: message.id, diagnostic: analysis.diagnostic };
    }
    const candidate: EditProposalCandidate = {
      proposal: analysis.proposal,
      sourceMessageId: message.id,
      payloadKey: editProposalPayloadKey(analysis.proposal),
      planToPatchMetadata: analysis.planToPatchMetadata,
    };
    return { state: "valid", candidate };
  }
  return { state: "none" };
}

export function latestEditProposalCandidateFromMessages(messages: EditProposalSourceMessage[]): EditProposalCandidate | null {
  const review = latestEditProposalReviewFromMessages(messages);
  return review.state === "valid" ? review.candidate : null;
}

export function editProposalCandidateIdentityMatches(
  left: Pick<EditProposalCandidate, "sourceMessageId" | "payloadKey"> | null | undefined,
  right: Pick<EditProposalCandidate, "sourceMessageId" | "payloadKey"> | null | undefined,
): boolean {
  return Boolean(left && right && left.sourceMessageId === right.sourceMessageId && left.payloadKey === right.payloadKey);
}

export function editProposalIdentityMatchesCandidate(
  identity: EditProposalIdentity | null | undefined,
  candidate: EditProposalCandidate | null | undefined,
): identity is EditProposalIdentity {
  return editProposalCandidateIdentityMatches(identity, candidate);
}

export function editProposalCandidateMatchesIdentity(
  candidate: EditProposalCandidate | null | undefined,
  identity: EditProposalIdentity | null | undefined,
): candidate is EditProposalCandidate {
  return editProposalCandidateIdentityMatches(candidate, identity);
}

type JsonCandidateResult =
  | { state: "valid"; text: string; requireEnvelope: boolean }
  | { state: "rejected"; diagnostic: EditProposalRejectedDiagnostic }
  | { state: "none" };

function extractSingleJsonCandidate(content: string): JsonCandidateResult {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return rejected("empty");
  }
  if (trimmed.length > maxContentLength) {
    return rejected("oversized");
  }
  const fenceMatches = Array.from(trimmed.matchAll(/```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```/g));
  if (fenceMatches.length > 0) {
    if (fenceMatches.length !== 1 || (trimmed.match(/```/g) ?? []).length !== 2) {
      return rejected("ambiguous");
    }
    const match = fenceMatches[0];
    if ((match[1] ?? "").toLowerCase() !== "json") {
      return rejected("invalid_fence");
    }
    const before = trimmed.slice(0, match.index).trim();
    const after = trimmed.slice((match.index ?? 0) + match[0].length).trim();
    if (looksLikeEditProposalText(before) || looksLikeEditProposalText(after)) {
      return rejected("ambiguous");
    }
    const inner = match[2].trim();
    if (inner.length === 0) {
      return rejected("empty");
    }
    if (!isStrictFullJsonObject(inner)) {
      return looksLikeJsonObjectStart(inner) ? rejected("invalid_json") : rejected("no_json");
    }
    return { state: "valid", text: inner, requireEnvelope: true };
  }
  if (!isStrictFullJsonObject(trimmed)) {
    if (countTopLevelJsonObjectStarts(trimmed) > 1) {
      return rejected("ambiguous");
    }
    if (looksLikeJsonObjectStart(trimmed)) {
      return rejected("invalid_json");
    }
    return looksLikeEditProposalText(trimmed) ? rejected("no_json") : { state: "none" };
  }
  return { state: "valid", text: trimmed, requireEnvelope: false };
}

function isLatestReviewRejectedProposalLike(content: string, reasonCode: EditProposalRejectedReasonCode): boolean {
  if (reasonCode === "empty" || reasonCode === "oversized") {
    return false;
  }
  if (reasonCode === "invalid_json") {
    return looksLikeEditProposalText(content);
  }
  return true;
}

function rejected(reasonCode: EditProposalRejectedReasonCode): { state: "rejected"; diagnostic: EditProposalRejectedDiagnostic } {
  return { state: "rejected", diagnostic: { reasonCode, message: diagnosticMessage(reasonCode) } };
}

function diagnosticMessage(reasonCode: EditProposalRejectedReasonCode): string {
  switch (reasonCode) {
    case "empty":
      return "The edit proposal is empty.";
    case "oversized":
      return "The edit proposal is too large to review safely.";
    case "no_json":
      return "The assistant response looks like an edit proposal but does not contain one JSON proposal.";
    case "ambiguous":
      return "The assistant response contains multiple or ambiguous edit proposal candidates.";
    case "invalid_json":
      return "The edit proposal JSON is not valid.";
    case "invalid_fence":
      return "Fenced edit proposals must use a json code fence.";
    case "fenced_payload_requires_envelope":
      return "Fenced edit proposals must use the full request envelope.";
    case "invalid_envelope":
      return "The edit proposal envelope is invalid.";
    case "wrong_version":
      return "The edit proposal uses an unsupported bridge version.";
    case "assistant_request_id":
      return "The assistant must not supply an apply request id.";
    case "unknown_keys":
      return "The edit proposal envelope contains unsupported fields.";
    case "envelope_like_direct_payload":
      return "Direct edit proposal payloads must not include envelope fields.";
    case "command_tool_smuggling":
      return "The edit proposal must not include commands or tool calls.";
    case "unsafe_path":
      return "The edit proposal contains an unsafe workspace path.";
    case "missing_confirmation":
      return "The edit proposal must require explicit user confirmation.";
    case "oversized_content":
      return "The edit proposal content is too large to review safely.";
    case "unsupported_verification":
      return "The plan-to-patch proposal includes unsupported verification.";
    case "invalid_payload":
      return "The edit proposal payload is invalid or unsafe.";
    case "proposal_like_rejected":
      return "The assistant response looks like an edit proposal but is not a valid proposal.";
  }
}

function isProposalLikeParsedValue(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  return "requiresUserConfirmation" in value || "edits" in value || "summary" in value || "cloudRequired" in value || "workspaceRelativePath" in value || "textReplacements" in value;
}

function analyzePlanToPatchProposal(value: Record<string, unknown>): EditProposalAnalysis {
  if ("requestId" in value) {
    return rejected("assistant_request_id");
  }
  if (!hasOnlyKeys(value, planToPatchEnvelopeKeys)) {
    return rejected("unknown_keys");
  }
  if (value.version !== planToPatchProposalVersion) {
    return rejected("wrong_version");
  }
  if (!safePlanText(value.summary, 400) || !isSafePlanTextArray(value.plan, 1, 6, 180) || !isSafePlanTextArray(value.risks, 0, 6, 220)) {
    return rejected("invalid_envelope");
  }
  if (!isVerificationSuggestions(value.verificationSuggestions)) {
    return rejected("unsupported_verification");
  }
  if (!isPlainObject(value.editProposal)) {
    return rejected("invalid_payload");
  }
  const editProposal = value.editProposal;
  if ("requestId" in editProposal) {
    return rejected("assistant_request_id");
  }
  const classified = classifyUnsafeEditProposal(editProposal);
  if (classified) {
    return rejected(classified);
  }
  if (!isApplyWorkspaceEditPayload(editProposal)) {
    return rejected("invalid_payload");
  }
  const summary = value.summary;
  const plan = value.plan;
  const risks = value.risks;
  const verificationSuggestions = value.verificationSuggestions;
  return {
    state: "valid",
    proposal: editProposal,
    planToPatchMetadata: {
      summary,
      plan,
      risks,
      verificationSuggestions,
    },
  };
}

function classifyUnsafeEditProposal(value: Record<string, unknown>): EditProposalRejectedReasonCode | null {
  if (hasCommandToolSmugglingDeep(value)) {
    return "command_tool_smuggling";
  }
  if (value.requiresUserConfirmation !== true) {
    return "missing_confirmation";
  }
  if (hasUnsafeWorkspacePath(value)) {
    return "unsafe_path";
  }
  if (hasOversizedEditContent(value)) {
    return "oversized_content";
  }
  return null;
}

function isVerificationSuggestions(value: unknown): value is PlanToPatchVerificationSuggestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    return false;
  }
  return value.every((item) => {
    if (!isPlainObject(item) || typeof item.commandId !== "string" || typeof item.label !== "string") {
      return false;
    }
    return (item.commandId === "repository-check" && item.label === "Repository check") ||
      (item.commandId === "gui-app-tests" && item.label === "GUI app tests") ||
      (item.commandId === "engine-chat-tests" && item.label === "Engine chat tests");
  });
}

function isSafePlanTextArray(value: unknown, minLength: number, maxLength: number, maxTextLength: number): value is string[] {
  return Array.isArray(value) && value.length >= minLength && value.length <= maxLength && value.every((item) => safePlanText(item, maxTextLength));
}

function safePlanText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !hasControlCharacters(value) && !unsafePlanText(value);
}

function hasCommandToolSmugglingDeep(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasCommandToolSmugglingDeep(item));
  }
  if (!isPlainObject(value)) {
    return false;
  }
  if (hasCommandToolSmuggling(value)) {
    return true;
  }
  return Object.values(value).some((item) => hasCommandToolSmugglingDeep(item));
}

function hasUnsafeWorkspacePath(value: Record<string, unknown>): boolean {
  const edits = value.edits;
  if (!Array.isArray(edits)) {
    return false;
  }
  return edits.some((edit) => isPlainObject(edit) && typeof edit.workspaceRelativePath === "string" && !safeWorkspaceRelativePath(edit.workspaceRelativePath));
}

function hasOversizedEditContent(value: Record<string, unknown>): boolean {
  const edits = value.edits;
  if (!Array.isArray(edits)) {
    return false;
  }
  let total = 0;
  for (const edit of edits) {
    if (!isPlainObject(edit) || !Array.isArray(edit.textReplacements)) {
      continue;
    }
    for (const replacement of edit.textReplacements) {
      if (!isPlainObject(replacement) || typeof replacement.replacementText !== "string") {
        continue;
      }
      total += replacement.replacementText.length;
      if (replacement.replacementText.length > 8192 || total > 32768) {
        return true;
      }
    }
  }
  return false;
}

function safeWorkspaceRelativePath(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes("\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && !hasControlCharacters(value) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !/^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(part) && !/(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(part) && !/^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(part));
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function unsafePlanText(value: string): boolean {
  return /api[-_ ]?key|authorization|bearer|cookie|token|secret|password|pkce|refresh|access[-_ ]?token|auth[-_ ]?code|chain[-_ ]?of[-_ ]?thought|raw[-_ ]?(?:prompt|command|dump|output|file|workspace|secret)|provider[-_ ]?(?:response|body|tool|call)|tool[-_ ]?(?:call|use|name)|file[-_ ]?(?:body|content)|workspace[-_ ]?(?:file|content)|shell|git|cwd|env|args|arguments|exec|cmd|command|npm\s+run|cargo\s+(?:check|test)|apply[-_ ]?patch|auto[-_ ]?(?:apply|run|verify|fix|repair)|hidden[-_ ]?(?:read|search|scan)|index[-_ ]?workspace|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)|\.codex\/auth\.json|(?:auth|credentials?)\.json|begin [A-Za-z ]*private key/i.test(value);
}

function looksLikeEditProposalText(text: string): boolean {
  return /agent_run\.plan_to_patch_proposal|editProposal|verificationSuggestions|gui.applyWorkspaceEditRequest|requiresUserConfirmation|workspaceRelativePath|textReplacements|cloudRequired|requestId|\bedits\b/i.test(text) || (/\b(?:tool|command)\b/i.test(text) && /\b(?:apply|edit|proposal|workspace)\b/i.test(text));
}

function hasCommandToolSmuggling(value: Record<string, unknown>): boolean {
  return "command" in value || "tool" in value || "toolCall" in value || "tool_call" in value || "functionCall" in value || "function_call" in value;
}

function looksLikeJsonObjectStart(text: string): boolean {
  return text.trimStart().startsWith("{");
}

function countTopLevelJsonObjectStarts(text: string): number {
  let count = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      count += 1;
    }
  }
  return count;
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
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && i !== text.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
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
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    out[key] = canonicalizeValue(obj[key]);
  }
  return out;
}
