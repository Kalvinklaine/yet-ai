import type { ApplyWorkspaceEditPayload, ApplyWorkspaceEditResultPayload } from "../bridge/bridgeAdapter";
import { analyzeEditProposalContent, editProposalPayloadKey, type EditProposalRejectedDiagnostic, type PlanToPatchProposalMetadata } from "./editProposal";
import { parseControlledAgentProviderProposal, type ControlledAgentProviderProposalMetadata } from "./providerProposalParser";
import type { AgentRunApplyResultMetadata, AgentRunInput, AgentRunVerificationResultMetadata } from "./agentRunState";
import { evaluateAgentRunPlanProposal, type AgentRunPlanPreviewMetadata } from "./agentRunPlanProposal";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type AgentRunModelProposalPathState = "idle" | "prompt_ready" | "awaiting_model_response" | "proposal_detected" | "proposal_rejected" | "plan_detected" | "plan_rejected" | "normal_response" | "stale_response" | "blocked";

export type AgentRunModelProposalDiagnosticCode = "missing_goal" | "awaiting_model_response" | "normal_response" | "stale_response" | "proposal_rejected" | "plan_rejected" | "unsafe_metadata" | "malformed_input" | "duplicate_proposal";

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

export type AgentRunModelProviderProposalState = {
  sourceMessageId: string;
  proposalId: string;
  payloadKey: string;
};

export type AgentRunModelPlanPreviewState = {
  sourceMessageId: string;
  plan: AgentRunPlanPreviewMetadata;
};

export type AgentRunModelProposalInput = {
  chatId: string;
  goal: string;
  submittedPromptRequestId?: string;
  latestUserMessageId?: string;
  runtimeSettingsVersion?: string;
  latestAssistantMessage?: AgentRunModelProposalAssistantMessage;
  editProposalState?: AgentRunModelProposalEditProposalState;
  providerProposalState?: AgentRunModelProviderProposalState;
  planPreviewState?: AgentRunModelPlanPreviewState;
  applyResult?: ApplyWorkspaceEditResultPayload | AgentRunApplyResultMetadata;
  verificationResult?: AgentRunVerificationResultMetadata;
};

export type AgentRunModelProposalResult = {
  agentRunInput: AgentRunInput;
  proposalPathState: AgentRunModelProposalPathState;
  providerProposalState?: AgentRunModelProviderProposalState;
  planPreview?: AgentRunModelPlanPreviewState;
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

  const providerAnalysis = parseControlledAgentProviderProposal(assistant.content);
  if (providerAnalysis.state === "valid") {
    if (isDuplicateProviderProposal(input.providerProposalState, assistant.id, providerAnalysis.proposal.proposalId, providerAnalysis.payloadKey)) {
      diagnostics.push(diagnostic("duplicate_proposal", "The provider proposal was already adopted and will not be adopted again."));
      return result(baseAgentRunInput, "stale_response", diagnostics);
    }
    const agentRunInput: AgentRunInput = {
      ...baseAgentRunInput,
      proposal: providerProposalMetadata(providerAnalysis.proposal),
      applyResult: normalizeApplyResult(input.applyResult),
      verificationResult: input.verificationResult,
    };
    return result(agentRunInput, "proposal_detected", diagnostics, { sourceMessageId: assistant.id, proposalId: providerAnalysis.proposal.proposalId, payloadKey: providerAnalysis.payloadKey });
  }
  if (providerAnalysis.state === "rejected") {
    const code = providerAnalysis.diagnostic.code === "unsafe_metadata" ? "unsafe_metadata" : "proposal_rejected";
    diagnostics.push(diagnostic(code, `${providerAnalysis.diagnostic.message} Return exactly one controlled provider proposal metadata object with no raw provider payloads, tools, commands, automatic actions, secrets, or private paths.`));
    return result(baseAgentRunInput, code === "unsafe_metadata" ? "blocked" : "proposal_rejected", diagnostics);
  }

  const planAnalysis = evaluateAgentRunPlanProposal(assistant.content);
  if (planAnalysis.state === "plan_detected") {
    return result(baseAgentRunInput, "plan_detected", diagnostics, { sourceMessageId: assistant.id, plan: planAnalysis.plan });
  }
  if (planAnalysis.state === "plan_rejected" || planAnalysis.state === "blocked") {
    const code = planAnalysis.state === "blocked" ? "unsafe_metadata" : "plan_rejected";
    diagnostics.push(...planAnalysis.diagnostics.map((item) => diagnostic(code, item.message)));
    return result(baseAgentRunInput, planAnalysis.state, diagnostics);
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

  const proposal = proposalMetadata(assistant.id, analysis.proposal, analysis.planToPatchMetadata);
  const agentRunInput: AgentRunInput = {
    ...baseAgentRunInput,
    proposal,
    applyResult: normalizeApplyResult(input.applyResult),
    verificationResult: input.verificationResult,
  };
  return result(agentRunInput, "proposal_detected", diagnostics);
}

function result(agentRunInput: AgentRunInput, proposalPathState: AgentRunModelProposalPathState, diagnostics: SanitizedDiagnostic[], providerProposalStateOrPlanPreview?: AgentRunModelProviderProposalState | AgentRunModelPlanPreviewState, planPreview?: AgentRunModelPlanPreviewState): AgentRunModelProposalResult {
  const providerProposalState = providerProposalStateOrPlanPreview && "proposalId" in providerProposalStateOrPlanPreview ? providerProposalStateOrPlanPreview : undefined;
  const resolvedPlanPreview = providerProposalStateOrPlanPreview && "plan" in providerProposalStateOrPlanPreview ? providerProposalStateOrPlanPreview : planPreview;
  return stripUndefined({
    agentRunInput: stripUndefined(agentRunInput),
    proposalPathState,
    providerProposalState,
    planPreview: resolvedPlanPreview,
    diagnostics: diagnostics.slice(0, 12),
  });
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

function proposalMetadata(sourceMessageId: string, proposal: ApplyWorkspaceEditPayload, planToPatchMetadata: PlanToPatchProposalMetadata | undefined): NonNullable<AgentRunInput["proposal"]> {
  const base = {
    id: safeOptionalId(sourceMessageId) ?? editProposalPayloadKey(proposal).slice(0, 120),
    summary: sanitizeLine(proposal.summary, "Safe-edit proposal is ready for manual review."),
    touchedFiles: proposal.edits.map((edit) => sanitizeLine(edit.workspaceRelativePath, "[redacted]")).slice(0, 4),
  };
  if (!planToPatchMetadata) {
    return base;
  }
  return stripUndefined({
    ...base,
    planSummary: sanitizeLine(planToPatchMetadata.summary, "Plan-to-patch summary is ready for manual review."),
    planSteps: planToPatchMetadata.plan.map((item) => sanitizeLine(item, "[redacted]")).slice(0, 6),
    risks: planToPatchMetadata.risks.map((item) => sanitizeLine(item, "[redacted]")).slice(0, 6),
    verificationSuggestions: planToPatchMetadata.verificationSuggestions.map((item) => sanitizeLine(`${item.label} (${item.commandId})`, "[redacted]")).slice(0, 3),
  });
}

function providerProposalMetadata(proposal: ControlledAgentProviderProposalMetadata): NonNullable<AgentRunInput["proposal"]> {
  return stripUndefined({
    id: proposal.proposalId,
    summary: sanitizeLine(proposal.summary ?? "Provider proposal metadata is ready for manual review.", "Provider proposal metadata is ready for manual review."),
    touchedFiles: [sanitizeLine(proposal.touchedFile, "[redacted]")],
    planSteps: proposal.planSteps.map((item) => sanitizeLine(item, "[redacted]")).slice(0, 3),
    verificationSuggestions: [sanitizeLine(proposal.verificationSuggestion, "[redacted]")],
  });
}

function isDuplicateProviderProposal(state: AgentRunModelProviderProposalState | undefined, sourceMessageId: string, proposalId: string, payloadKey: string): boolean {
  return state?.sourceMessageId === sourceMessageId || state?.proposalId === proposalId || state?.payloadKey === payloadKey;
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
  if (input.providerProposalState) {
    if (!safeRequiredId(input.providerProposalState.sourceMessageId) || !safeRequiredId(input.providerProposalState.proposalId) || typeof input.providerProposalState.payloadKey !== "string" || input.providerProposalState.payloadKey.length > 20000) {
      messages.push("Provider proposal correlation state is malformed or unsafe.");
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
