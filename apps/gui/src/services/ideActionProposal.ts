import type { IdeActionRequestPayload, WorkspaceEditRange } from "../bridge/bridgeAdapter";

type AssistantIdeActionRequestPayload = Exclude<IdeActionRequestPayload, { action: "getActiveFileExcerpt" } | { action: "runVerificationCommand" } | { action: "searchWorkspaceSnippets" }>;

export type AssistantIdeActionProposal = {
  type: "assistant.ideActionProposal";
  version: "2026-05-15";
  requiresUserConfirmation: true;
  cloudRequired: false;
  summary: string;
} & AssistantIdeActionRequestPayload;

export type IdeActionProposalSourceMessage = {
  id: string;
  role: string;
  status?: string;
  content: string;
};

export type IdeActionProposalCandidate = {
  proposal: AssistantIdeActionProposal;
  payload: IdeActionRequestPayload;
  sourceMessageId: string;
  payloadKey: string;
};

export type IdeActionProposalState = IdeActionProposalCandidate & {
  requestId: string;
};

export type IdeActionProposalRejectedReasonCode =
  | "invalid_json"
  | "invalid_shape"
  | "unsafe_action"
  | "assistant_request_id"
  | "unknown_keys"
  | "wrong_version"
  | "invalid_payload";

export type IdeActionProposalRejectedDiagnostic = {
  reasonCode: IdeActionProposalRejectedReasonCode;
  message: string;
};

export type IdeActionProposalAnalysis =
  | { state: "valid"; proposal: AssistantIdeActionProposal }
  | { state: "rejected"; diagnostic: IdeActionProposalRejectedDiagnostic }
  | { state: "none" };

export type IdeActionProposalReview =
  | { state: "valid"; candidate: IdeActionProposalCandidate }
  | { state: "rejected"; sourceMessageId: string; diagnostic: IdeActionProposalRejectedDiagnostic }
  | { state: "none" };

export type IdeActionProposalIdentity = {
  requestId: string;
  sourceMessageId: string;
  payloadKey: string;
};

const proposalVersion = "2026-05-15";

export function analyzeAssistantIdeActionProposalContent(content: string): IdeActionProposalAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return looksLikeIdeActionProposalText(content) ? rejected("invalid_json") : { state: "none" };
  }

  if (!isPlainObject(parsed)) {
    return looksLikeIdeActionProposalText(content) ? rejected("invalid_shape") : { state: "none" };
  }
  if (parsed.type !== "assistant.ideActionProposal" && !looksLikeIdeActionProposalObject(parsed)) {
    return { state: "none" };
  }
  const shape = validateAssistantIdeActionProposal(parsed);
  return shape === true ? { state: "valid", proposal: parsed as AssistantIdeActionProposal } : rejected(shape);
}

export function parseAssistantIdeActionProposalContent(content: string): AssistantIdeActionProposal | null {
  const analysis = analyzeAssistantIdeActionProposalContent(content);
  return analysis.state === "valid" ? analysis.proposal : null;
}

export function toIdeActionRequestPayload(proposal: AssistantIdeActionProposal): IdeActionRequestPayload {
  if (proposal.action === "getContextSnapshot") {
    return { action: "getContextSnapshot" };
  }
  if (proposal.action === "openWorkspaceFile") {
    return { action: "openWorkspaceFile", workspaceRelativePath: proposal.workspaceRelativePath };
  }
  return { action: "revealWorkspaceRange", workspaceRelativePath: proposal.workspaceRelativePath, range: proposal.range };
}

export function describeIdeActionProposal(proposal: AssistantIdeActionProposal): string {
  if (proposal.action === "getContextSnapshot") {
    return "Get IDE context";
  }
  if (proposal.action === "openWorkspaceFile") {
    return "Open workspace file";
  }
  return "Reveal workspace range";
}

export function ideActionProposalPayloadKey(proposal: AssistantIdeActionProposal): string {
  if (proposal.action === "getContextSnapshot") {
    return JSON.stringify({
      type: proposal.type,
      version: proposal.version,
      requiresUserConfirmation: proposal.requiresUserConfirmation,
      cloudRequired: proposal.cloudRequired,
      summary: proposal.summary,
      action: proposal.action,
    });
  }
  if (proposal.action === "openWorkspaceFile") {
    return JSON.stringify({
      type: proposal.type,
      version: proposal.version,
      requiresUserConfirmation: proposal.requiresUserConfirmation,
      cloudRequired: proposal.cloudRequired,
      summary: proposal.summary,
      action: proposal.action,
      workspaceRelativePath: proposal.workspaceRelativePath,
    });
  }
  return JSON.stringify({
    type: proposal.type,
    version: proposal.version,
    requiresUserConfirmation: proposal.requiresUserConfirmation,
    cloudRequired: proposal.cloudRequired,
    summary: proposal.summary,
    action: proposal.action,
    workspaceRelativePath: proposal.workspaceRelativePath,
    range: {
      start: { line: proposal.range.start.line, character: proposal.range.start.character },
      end: { line: proposal.range.end.line, character: proposal.range.end.character },
    },
  });
}

export function isCompleteAssistantIdeActionProposalStatus(status: string | undefined): boolean {
  return status === undefined || status === "complete";
}

export function latestIdeActionProposalReviewFromMessages(messages: IdeActionProposalSourceMessage[]): IdeActionProposalReview {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !isCompleteAssistantIdeActionProposalStatus(message.status)) {
      continue;
    }
    const analysis = analyzeAssistantIdeActionProposalContent(message.content);
    if (analysis.state === "none") {
      return { state: "none" };
    }
    if (analysis.state === "rejected") {
      return { state: "rejected", sourceMessageId: message.id, diagnostic: analysis.diagnostic };
    }
    const proposal = analysis.proposal;
    return {
      state: "valid",
      candidate: {
        proposal,
        payload: toIdeActionRequestPayload(proposal),
        sourceMessageId: message.id,
        payloadKey: ideActionProposalPayloadKey(proposal),
      },
    };
  }
  return { state: "none" };
}

export function latestIdeActionProposalCandidateFromMessages(messages: IdeActionProposalSourceMessage[]): IdeActionProposalCandidate | null {
  const review = latestIdeActionProposalReviewFromMessages(messages);
  return review.state === "valid" ? review.candidate : null;
}

export function ideActionProposalCandidateIdentityMatches(left: Pick<IdeActionProposalCandidate, "sourceMessageId" | "payloadKey"> | null | undefined, right: Pick<IdeActionProposalCandidate, "sourceMessageId" | "payloadKey"> | null | undefined): boolean {
  return Boolean(left && right && left.sourceMessageId === right.sourceMessageId && left.payloadKey === right.payloadKey);
}

export function ideActionProposalMatchesCandidate(proposal: IdeActionProposalState | null, candidate: IdeActionProposalCandidate | null): proposal is IdeActionProposalState {
  return ideActionProposalCandidateIdentityMatches(proposal, candidate);
}

export function ideActionProposalIdentityMatchesCandidate(identity: IdeActionProposalIdentity | null, candidate: IdeActionProposalCandidate | null): identity is IdeActionProposalIdentity {
  return ideActionProposalCandidateIdentityMatches(identity, candidate);
}

function validateAssistantIdeActionProposal(value: Record<string, unknown>): true | IdeActionProposalRejectedReasonCode {
  if (!hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action", "workspaceRelativePath", "range"])) {
    return "requestId" in value ? "assistant_request_id" : "unknown_keys";
  }
  if (value.type !== "assistant.ideActionProposal") {
    return "invalid_shape";
  }
  if (value.version !== proposalVersion) {
    return "wrong_version";
  }
  if (value.requiresUserConfirmation !== true || value.cloudRequired !== false || !safeSummary(value.summary)) {
    return "invalid_payload";
  }
  if (isUnsafeIdeAction(value.action)) {
    return "unsafe_action";
  }

  if (value.action === "getContextSnapshot") {
    return hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action"]) ? true : "unknown_keys";
  }
  if (value.action === "openWorkspaceFile") {
    return hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action", "workspaceRelativePath"]) && requiredSafeRelativePath(value.workspaceRelativePath) ? true : "invalid_payload";
  }
  if (value.action === "revealWorkspaceRange") {
    return hasOnlyKeys(value, ["type", "version", "requiresUserConfirmation", "cloudRequired", "summary", "action", "workspaceRelativePath", "range"]) && requiredSafeRelativePath(value.workspaceRelativePath) && isEditRange(value.range) ? true : "invalid_payload";
  }
  return "unsafe_action";
}

function rejected(reasonCode: IdeActionProposalRejectedReasonCode): { state: "rejected"; diagnostic: IdeActionProposalRejectedDiagnostic } {
  return { state: "rejected", diagnostic: { reasonCode, message: diagnosticMessage(reasonCode) } };
}

function diagnosticMessage(reasonCode: IdeActionProposalRejectedReasonCode): string {
  switch (reasonCode) {
    case "invalid_json":
      return "The IDE action proposal JSON is not valid.";
    case "invalid_shape":
      return "The IDE action proposal shape is invalid.";
    case "unsafe_action":
      return "The IDE action proposal requested an unsupported or unsafe action.";
    case "assistant_request_id":
      return "The assistant must not supply an IDE action request id.";
    case "unknown_keys":
      return "The IDE action proposal contains unsupported fields.";
    case "wrong_version":
      return "The IDE action proposal uses an unsupported bridge version.";
    case "invalid_payload":
      return "The IDE action proposal payload is invalid or unsafe.";
  }
}

function looksLikeIdeActionProposalText(value: string): boolean {
  return /assistant\.ideActionProposal|gui\.ideActionRequest|workspaceRelativePath|revealWorkspaceRange|openWorkspaceFile|getContextSnapshot|runVerificationCommand|applyWorkspaceEdit|editWorkspaceFile|\b(?:shell|git|task|tool)\b/i.test(value);
}

function looksLikeIdeActionProposalObject(value: Record<string, unknown>): boolean {
  return "action" in value || "requiresUserConfirmation" in value || "workspaceRelativePath" in value || "range" in value || "summary" in value;
}

function isUnsafeIdeAction(value: unknown): boolean {
  return typeof value === "string" && /^(?:shell|git|task|tool|applyWorkspaceEdit|editWorkspaceFile|getActiveFileExcerpt|runVerificationCommand|searchWorkspaceSnippets)$/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function requiredSafeRelativePath(value: unknown): boolean {
  return safePath(value, 512);
}

function safePath(value: unknown, maxLength: number): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.startsWith("/") || value.startsWith("~") || value.includes("%") || value.includes("\\") || value.includes(":") || value.includes("?") || value.includes("#")) {
    return false;
  }
  if (/^[^\u0000-\u001f\u007f-\u009f]+$/.test(value) === false) {
    return false;
  }
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !isSecretLikePathSegment(part));
}

function isSecretLikePathSegment(value: string): boolean {
  return /^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(value) ||
    /(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(value) ||
    /^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function isEditRange(value: unknown): value is WorkspaceEditRange {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["start", "end"]) || !isEditPosition(value.start) || !isEditPosition(value.end)) {
    return false;
  }
  return value.end.line > value.start.line || (value.end.line === value.start.line && value.end.character >= value.start.character);
}

function isEditPosition(value: unknown): value is { line: number; character: number } {
  return isPlainObject(value) && hasOnlyKeys(value, ["line", "character"]) && Number.isInteger(value.line) && Number.isInteger(value.character) && optionalBoundedInteger(value.line, 0, 1000000) && optionalBoundedInteger(value.character, 0, 1000000);
}

function optionalBoundedInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
}

function safeSummary(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 280 && !hasControlCharacters(value) && !unsafeDisplayText(value) && !hasPrivatePathLikeText(value) && !hasKeyLikeSecretText(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function hasPrivatePathLikeText(value: string): boolean {
  return /(?:\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|~[\/\\]|[A-Za-z]:[\/\\])/i.test(value);
}

function hasKeyLikeSecretText(value: string): boolean {
  return /(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function unsafeDisplayText(value: string): boolean {
  return /authorization|bearer|cookie|api[_-]?key|token|secret|password|private[_-]?path|provider[_-]?response|raw[_-]?prompt|file[_-]?content/i.test(value);
}
