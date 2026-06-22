import type { ApplyWorkspaceEditPayload, ApplyWorkspaceEditResultPayload } from "../bridge/bridgeAdapter";
import { analyzeEditProposalContent, editProposalPayloadKey, type EditProposalRejectedDiagnostic } from "./editProposal";
import type { AgentRunApplyResultMetadata, AgentRunInput, AgentRunVerificationResultMetadata } from "./agentRunState";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type AgentRunModelProposalPathState = "idle" | "prompt_ready" | "awaiting_model_response" | "proposal_detected" | "proposal_rejected" | "normal_response" | "stale_response" | "blocked";

export type AgentRunModelProposalDiagnosticCode = "missing_goal" | "awaiting_model_response" | "normal_response" | "stale_response" | "proposal_rejected" | "unsafe_metadata" | "malformed_input";

export type SanitizedDiagnostic = {
  code: AgentRunModelProposalDiagnosticCode;
  message: string;
};

export type AgentRunModelProposalAssistantMessage = {
  id: string;
  chatId?: string;
  role?: string;
  status?: string;
  content: string;
  responseToRequestId?: string;
  userMessageId?: string;
  runtimeSettingsVersion?: string;
};

export type AgentRunModelProposalEditProposalState = {
  sourceMessageId: string;
  payloadKey: string;
};

export type AgentRunModelProposalInput = {
  chatId: string;
  goal: string;
  submittedPromptRequestId?: string;
  latestUserMessageId?: string;
  runtimeSettingsVersion?: string;
  latestAssistantMessage?: AgentRunModelProposalAssistantMessage;
  editProposalState?: AgentRunModelProposalEditProposalState;
  applyResult?: ApplyWorkspaceEditResultPayload | AgentRunApplyResultMetadata;
  verificationResult?: AgentRunVerificationResultMetadata;
};

export type AgentRunModelProposalResult = {
  agentRunInput: AgentRunInput;
  proposalPathState: AgentRunModelProposalPathState;
  diagnostics: SanitizedDiagnostic[];
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const completeStatuses = new Set([undefined, "complete"]);

export function evaluateAgentRunModelProposal(input: AgentRunModelProposalInput): AgentRunModelProposalResult {
  const diagnostics: SanitizedDiagnostic[] = [];
  const goal = safeGoal(input.goal);
  const baseAgentRunInput: AgentRunInput = goal ? { goal } : {};
  if (!goal) {
    diagnostics.push(diagnostic("missing_goal", "Agent Run model proposal correlation requires a local user goal."));
    return result(baseAgentRunInput, "idle", diagnostics);
  }

  const unsafeInput = unsafeCorrelationInput(input);
  if (unsafeInput.length > 0) {
    diagnostics.push(...unsafeInput.map((message) => diagnostic("unsafe_metadata", message)));
    return result(baseAgentRunInput, "blocked", diagnostics);
  }

  const assistant = input.latestAssistantMessage;
  if (!assistant) {
    if (safeOptionalId(input.submittedPromptRequestId)) {
      diagnostics.push(diagnostic("awaiting_model_response", "A safe-edit prompt was submitted and is waiting for a correlated assistant response."));
      return result(baseAgentRunInput, "awaiting_model_response", diagnostics);
    }
    return result(baseAgentRunInput, "prompt_ready", diagnostics);
  }

  const staleReason = staleAssistantReason(input, assistant);
  if (staleReason) {
    diagnostics.push(diagnostic("stale_response", staleReason));
    return result(baseAgentRunInput, "stale_response", diagnostics);
  }

  const analysis = analyzeEditProposalContent(assistant.content);
  if (analysis.state === "none") {
    diagnostics.push(diagnostic("normal_response", "The latest assistant response did not contain a strict safe-edit proposal."));
    return result(baseAgentRunInput, "normal_response", diagnostics);
  }
  if (analysis.state === "rejected") {
    diagnostics.push(proposalRejectedDiagnostic(analysis.diagnostic));
    return result(baseAgentRunInput, "proposal_rejected", diagnostics);
  }

  const proposal = proposalMetadata(assistant.id, analysis.proposal);
  const agentRunInput: AgentRunInput = {
    ...baseAgentRunInput,
    proposal,
    applyResult: normalizeApplyResult(input.applyResult),
    verificationResult: input.verificationResult,
  };
  return result(agentRunInput, "proposal_detected", diagnostics);
}

function result(agentRunInput: AgentRunInput, proposalPathState: AgentRunModelProposalPathState, diagnostics: SanitizedDiagnostic[]): AgentRunModelProposalResult {
  return {
    agentRunInput: stripUndefined(agentRunInput),
    proposalPathState,
    diagnostics: diagnostics.slice(0, 12),
  };
}

function staleAssistantReason(input: AgentRunModelProposalInput, assistant: AgentRunModelProposalAssistantMessage): string | undefined {
  if (assistant.role !== undefined && assistant.role !== "assistant") {
    return "The latest correlated message is not an assistant response.";
  }
  if (!completeStatuses.has(assistant.status)) {
    return "The latest assistant response is still streaming and cannot be used as a proposal.";
  }
  if (assistant.chatId !== undefined && assistant.chatId !== input.chatId) {
    return "The assistant response belongs to a different chat and was ignored.";
  }
  if (input.submittedPromptRequestId !== undefined && assistant.responseToRequestId !== input.submittedPromptRequestId) {
    return "The assistant response does not match the latest safe-edit prompt request.";
  }
  if (input.latestUserMessageId !== undefined && assistant.userMessageId !== input.latestUserMessageId) {
    return "The assistant response predates the latest user message and was ignored.";
  }
  if (input.runtimeSettingsVersion !== undefined && assistant.runtimeSettingsVersion !== input.runtimeSettingsVersion) {
    return "Runtime or provider settings changed after the response, so proposal correlation was cleared.";
  }
  return undefined;
}

function proposalMetadata(sourceMessageId: string, proposal: ApplyWorkspaceEditPayload): NonNullable<AgentRunInput["proposal"]> {
  return {
    id: safeOptionalId(sourceMessageId) ?? editProposalPayloadKey(proposal).slice(0, 120),
    summary: sanitizeLine(proposal.summary, "Safe-edit proposal is ready for manual review."),
    touchedFiles: proposal.edits.map((edit) => sanitizeLine(edit.workspaceRelativePath, "[redacted]")).slice(0, 4),
  };
}

function normalizeApplyResult(value: AgentRunModelProposalInput["applyResult"]): AgentRunApplyResultMetadata | undefined {
  if (!value) {
    return undefined;
  }
  if (value.status === "applied" || value.status === "failed") {
    return {
      status: value.status,
      summary: "summary" in value && typeof value.summary === "string" ? sanitizeLine(value.summary, "Apply result is recorded.") : "message" in value && typeof value.message === "string" ? sanitizeLine(value.message, "Apply result is recorded.") : undefined,
      appliedFileCount: "appliedFileCount" in value && typeof value.appliedFileCount === "number" ? value.appliedFileCount : "appliedEditCount" in value && typeof value.appliedEditCount === "number" ? value.appliedEditCount : undefined,
    };
  }
  return { status: "failed", summary: "Apply was not completed by the host." };
}

function safeGoal(value: string): NonNullable<AgentRunInput["goal"]> | undefined {
  const summary = sanitizeLine(value, "");
  if (!summary) {
    return undefined;
  }
  return { summary };
}

function proposalRejectedDiagnostic(rejected: EditProposalRejectedDiagnostic): SanitizedDiagnostic {
  return diagnostic("proposal_rejected", `${rejected.message} Return exactly one strict safe-edit JSON proposal/envelope, omit requestId, and include no execution, tool, shell, git, search, storage, diff-body, file-body, or private-path fields.`);
}

function unsafeCorrelationInput(input: AgentRunModelProposalInput): string[] {
  const messages: string[] = [];
  if (!safeRequiredId(input.chatId)) {
    messages.push("Chat correlation id is malformed.");
  }
  for (const [label, value] of Object.entries({ submittedPromptRequestId: input.submittedPromptRequestId, latestUserMessageId: input.latestUserMessageId, runtimeSettingsVersion: input.runtimeSettingsVersion })) {
    if (value !== undefined && !safeOptionalId(value)) {
      messages.push(`${label} is malformed or unsafe.`);
    }
  }
  if (input.latestAssistantMessage) {
    const assistant = input.latestAssistantMessage;
    if (!safeRequiredId(assistant.id)) {
      messages.push("Assistant message id is malformed.");
    }
    for (const [label, value] of Object.entries({ chatId: assistant.chatId, responseToRequestId: assistant.responseToRequestId, userMessageId: assistant.userMessageId, runtimeSettingsVersion: assistant.runtimeSettingsVersion })) {
      if (value !== undefined && !safeOptionalId(value)) {
        messages.push(`Assistant ${label} is malformed or unsafe.`);
      }
    }
  }
  return messages;
}

function safeRequiredId(value: unknown): boolean {
  return typeof value === "string" && safeOptionalId(value) !== undefined;
}

function safeOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function sanitizeLine(value: string, fallback: string): string {
  const sanitized = sanitizeTimelineText(value).replace(/[\r\n]+/g, " ").trim();
  return sanitized || fallback;
}

function diagnostic(code: AgentRunModelProposalDiagnosticCode, message: string): SanitizedDiagnostic {
  return { code, message: sanitizeLine(message, "Agent Run model proposal metadata was blocked.") };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
