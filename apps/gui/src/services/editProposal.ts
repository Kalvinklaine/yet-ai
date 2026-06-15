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

const envelopeKeys = ["type", "version", "payload", "requestId"] as const;
const maxContentLength = 50000;

export function parseEditProposalContent(content: string): ApplyWorkspaceEditPayload | null {
  if (typeof content !== "string") {
    return null;
  }
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > maxContentLength) {
    return null;
  }
  if (!isStrictFullJsonObject(trimmed)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }

  // Envelope form: { type, version, payload } with no extra keys. If an
  // assistant includes requestId, it is inspect-only metadata: the GUI always
  // creates its own runnable request id for host correlation.
  if (parsed.type === applyEditRequestType) {
    if (!hasOnlyKeys(parsed, envelopeKeys)) {
      return null;
    }
    if (parsed.version !== bridgeVersion) {
      return null;
    }
    if ("requestId" in parsed && typeof parsed.requestId !== "string") {
      return null;
    }
    if (!isPlainObject(parsed.payload)) {
      return null;
    }
    return isApplyWorkspaceEditPayload(parsed.payload) ? parsed.payload : null;
  }

  // Bounded payload form: the ApplyWorkspaceEditPayload object directly.
  if ("type" in parsed || "version" in parsed || "payload" in parsed) {
    return null;
  }
  return isApplyWorkspaceEditPayload(parsed) ? parsed : null;
}

export function editProposalPayloadKey(payload: ApplyWorkspaceEditPayload): string {
  // Normalize the optional `cloudRequired` flag before computing the canonical key
  // so payloads with `cloudRequired` omitted and `cloudRequired: false` produce the
  // same key. The bridge contract only allows `cloudRequired === false`; treating
  // both forms as equivalent is a canonicalization choice, not an authority change.
  const normalized: ApplyWorkspaceEditPayload = payload.cloudRequired === false
    ? payload
    : { ...payload, cloudRequired: false };
  return canonicalizeJsonValue(normalized);
}

export function isCompleteAssistantEditProposalStatus(status: string | undefined): boolean {
  return status === undefined || status === "complete";
}

export function latestEditProposalCandidateFromMessages(messages: EditProposalSourceMessage[]): EditProposalCandidate | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }
    if (!isCompleteAssistantEditProposalStatus(message.status)) {
      continue;
    }
    const proposal = parseEditProposalContent(message.content);
    if (!proposal && isEditProposalLikeContent(message.content)) {
      return null;
    }
    if (!proposal) {
      continue;
    }
    return {
      proposal,
      sourceMessageId: message.id,
      payloadKey: editProposalPayloadKey(proposal),
    };
  }
  return null;
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

function isEditProposalLikeContent(content: string): boolean {
  if (typeof content !== "string") {
    return false;
  }
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > maxContentLength || !isStrictFullJsonObject(trimmed)) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) {
    return false;
  }
  if (parsed.type === applyEditRequestType) {
    return true;
  }
  return "requiresUserConfirmation" in parsed || "edits" in parsed || "summary" in parsed || "cloudRequired" in parsed;
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
