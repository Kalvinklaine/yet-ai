import { isApplyWorkspaceEditPayload, type ApplyWorkspaceEditPayload } from "../bridge/bridgeAdapter";

const bridgeVersion = "2026-05-15";
const applyEditRequestType = "gui.applyWorkspaceEditRequest";

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
  | "invalid_payload"
  | "proposal_like_rejected";

export type EditProposalRejectedDiagnostic = {
  reasonCode: EditProposalRejectedReasonCode;
  message: string;
};

export type EditProposalAnalysis =
  | { state: "valid"; proposal: ApplyWorkspaceEditPayload }
  | { state: "rejected"; diagnostic: EditProposalRejectedDiagnostic }
  | { state: "none" };

export type EditProposalReview =
  | { state: "valid"; candidate: EditProposalCandidate }
  | { state: "rejected"; sourceMessageId: string; diagnostic: EditProposalRejectedDiagnostic }
  | { state: "none" };

const envelopeKeys = ["type", "version", "payload"] as const;
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

function looksLikeEditProposalText(text: string): boolean {
  return /gui.applyWorkspaceEditRequest|requiresUserConfirmation|workspaceRelativePath|textReplacements|cloudRequired|requestId|\bedits\b/i.test(text) || (/\b(?:tool|command)\b/i.test(text) && /\b(?:apply|edit|proposal|workspace)\b/i.test(text));
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
