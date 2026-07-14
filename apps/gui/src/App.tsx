import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GUI_BRIDGE_VERSION, createBridgeAdapter, type ApplyWorkspaceEditPayload, type ApplyWorkspaceEditResultPayload, type BridgeAdapter, type BridgeHost, type HostContextSnapshotPayload, type HostReadyPayload, type HostRuntimeStatusPayload, type IdeActionProgressPayload, type IdeActionRequestPayload, type IdeActionResultPayload, type IdeActionType, type VerificationCommandId, type ActiveFileExcerptAttachment, type WorkspaceSnippetSearchResult } from "./bridge/bridgeAdapter";
import { addAcceptedUserMessage, applyChatViewEvent, createInitialChatViewState, hydrateChatViewFromThread, removeOptimisticUserMessage, resetChatViewState, stopStreamingAssistant, type ChatViewMessage } from "./services/chatViewState";
import { activeEditorSourceLabel, activeFileExcerptPreview, activeFileExcerptSummary, activeFileExcerptToBundleItem, activeFileExcerptToChatContext, addExplicitContextBundleItem, explicitContextBundleMaxItems, explicitContextBundleToChatContext, attachedContextFileLabel, attachedContextRequiresAcknowledgement, attachedContextSummary, classifyBoundedContextPreview, formatSelectionRange, hasUsableAttachedContext, projectMemoryToBundleItem, rangeFromContextSelection, summarizeExplicitContextBundleItem, validateWorkspaceSnippetQuery, workspaceSnippetToBundleItem, type ExplicitContextBundleItem, type ProjectMemoryBundleItem, type WorkspaceSnippetBundleItem } from "./services/activeEditorContext";
import { AgentRunPanel } from "./components/AgentRunPanel";
import { TaskMemorySuggestionsPanel } from "./components/TaskMemorySuggestionsPanel";
import { CodingSessionTracePanel } from "./components/CodingSessionTracePanel";
import { ProposalHistoryPanel } from "./components/ProposalHistoryPanel";
import { MultiStepTaskTimelinePanel } from "./components/MultiStepTaskTimelinePanel";
import { ControlledAgentWorkspaceReadinessPanel } from "./components/ControlledAgentWorkspaceReadinessPanel";
import { ControlledAgentFileReadPanel } from "./components/ControlledAgentFileReadPanel";
import { ControlledAgentEditPanel } from "./components/ControlledAgentEditPanel";
import { ControlledAgentCommandRunnerPanel } from "./components/ControlledAgentCommandRunnerPanel";
import { ControlledAgentRunPanel } from "./components/ControlledAgentRunPanel";
import { ControlledAgentWorkflowTranscriptPanel } from "./components/ControlledAgentWorkflowTranscriptPanel";
import { EditProposalPanel, type ApplyResultState, type EditProposalState } from "./components/EditProposalPanel";
import { IdeActionProposalPanel, IdeActionsPanel, VerificationCommandPanel, verificationOutputKey, type IdeActionAttemptState, type VerificationCommand } from "./components/IdeActionsPanel";
import { analyzeAssistantIdeActionProposalContent, describeIdeActionProposal, ideActionProposalIdentityMatchesCandidate, ideActionProposalMatchesCandidate, ideActionProposalPayloadKey, isCompleteAssistantIdeActionProposalStatus, latestIdeActionProposalCandidateFromMessages, latestIdeActionProposalReviewFromMessages, parseAssistantIdeActionProposalContent, type IdeActionProposalState } from "./services/ideActionProposal";
import { chatLifecycleLabels, chatRecoveryCodeForRuntimeError, type ChatLifecycleState } from "./services/chatLifecycle";
import { runtimeLifecycleDiagnostics, runtimeLifecycleHostCopy, type RuntimeLifecycleDiagnostics } from "./services/runtimeLifecycle";
import { conversationHistoryStatusLabel, resolveChatAfterList, resolveFallbackChatAfterDelete } from "./services/conversationHistory";
import { disconnectProviderAuth, exchangeProviderAuth, getProviderAuthStatus, startProviderAuth, type ProviderAuthResponse, type ProviderAuthStatus } from "./services/providerAuthClient";
import { classifyProviderReadinessState, modelReadinessEvidenceText, modelStatusText, resolveProviderModelReadiness, type ProviderReadinessState } from "./services/providerReadiness";
import { listProviders, saveProvider, testProvider, type ProviderSummary, type ProviderTestResponse, type ProviderWriteRequest } from "./services/providersClient";
import { createChat, deleteChat, getAgentProgress, getCaps, getChat, getDemoMode, getModels, getPing, isLoopbackRuntimeUrl, isSameOriginProxyBaseUrl, listChats, productIdentity, productIdentityWarning, sendAbort, setDemoMode, setRuntimeFetchTraceConnectionSource, setRuntimeFetchTraceSink, type AgentOverflowRecovery, type AgentOverflowRecoveryKind, type AgentProgressListResponse, type AgentProgressSnapshot, type CapsResponse, type ChatSummary, type DemoModeResponse, type ManualRunnerPlanProposal, type ModelSummary, type PingResponse, type RuntimeError, type RuntimeSettings, sendUserMessage } from "./services/runtimeClient";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./services/redaction";
import { subscribeToChat, type SseEvent } from "./services/sseClient";
import { analyzeEditProposalContent, editProposalCandidateIdentityMatches, editProposalPayloadKey, isCompleteAssistantEditProposalStatus, latestEditProposalCandidateFromMessages, latestEditProposalReviewFromMessages, parseEditProposalContent, type EditProposalIdentity, type EditProposalRejectedDiagnostic } from "./services/editProposal";
import { codingActions, type CodingAction } from "./services/codingActions";
import { buildCodingTaskPrompt, type CodingTaskPromptMode } from "./services/codingTaskPrompt";
import { buildContextBudgetSummary, type ContextBudgetSummary } from "./services/contextBudget";
import { buildOneStepModelProposalPrompt } from "./services/modelProposalPrompt";
import { evaluateAgentRunModelProposal, type AgentRunModelProposalResult, type AgentRunModelProviderProposalState } from "./services/agentRunModelProposal";
import { normalizeAgentRunApplyRequest, correlateAgentRunApplyResult, type AgentRunApplyCorrelationMetadata } from "./services/agentRunApply";
import { correlateAgentRunVerificationProgress, correlateAgentRunVerificationResult, type AgentRunVerificationCorrelationMetadata } from "./services/agentRunVerification";
import { createAgentRunReport, createAgentRunTraceDetails } from "./services/agentRunReport";
import { buildAgentRunCheckpointDecision, type AgentRunCheckpointDecisionSummary } from "./services/agentRunCheckpointDecision";
import { composeAgentRunReadiness, type AgentRunReadinessResult } from "./services/agentRunReadiness";
import { buildVerificationFollowupPrompt, buildVerificationFollowupPromptDraft, type VerificationFollowupPromptDraftMetadata, type VerificationFollowupPromptMode, type VerificationResultForPrompt } from "./services/verificationFollowupPrompt";
import { createProjectMemory, deleteProjectMemory, listProjectMemory, searchProjectMemory, type ProjectMemoryNote } from "./services/projectMemoryClient";
import { appendCodingSessionTraceEntry, type CodingSessionTraceDraft, type CodingSessionTraceEntry } from "./services/codingSessionTrace";
import { createProposalHistory, type ProposalHistoryEntryInput } from "./services/proposalHistory";
import { createCodingTaskSessionSnapshot, createLinkedMemoryAttachTraceLabel, createSessionMemoryLabel, createTaskMemoryLabel, type CodingTaskSessionSnapshot } from "./services/codingTaskSession";
import { createMemorySuggestionAttachTraceDetails, suggestTaskMemory, type TaskMemorySuggestion } from "./services/taskMemorySuggestions";
import { createControlledHostCapabilityMatrixDisplay, evaluateHostCapabilityMetadata } from "./services/toolAuthorityPolicy";
import { evaluateControlledAgentFileRead } from "./services/controlledAgentFileRead";
import { buildControlledAgentFileReadRequest, correlateControlledAgentFileReadResult, type ControlledAgentFileReadRequestCorrelation } from "./services/controlledAgentFileReadRequest";
import { buildControlledAgentEditRequest, correlateControlledAgentEditResult, type ControlledAgentEditRequestCorrelation } from "./services/controlledAgentEditRequest";
import { buildControlledAgentCommandRunRequest, correlateControlledAgentCommandRunResult, type ControlledAgentCommandRunRequestCorrelation, type ControlledAgentCommandRunResultSummary } from "./services/controlledAgentCommandRunRequest";
import { buildControlledAgentLexicalSearchRequest, correlateControlledAgentLexicalSearchResult, type ControlledAgentLexicalSearchCorrelation, type ControlledAgentLexicalSearchSummary } from "./services/controlledAgentLexicalSearch";
import { createControlledAgentSearchSelection, type ControlledAgentSearchSelectionResult } from "./services/controlledAgentSearchSelection";
import { evaluateControlledAgentCommandRun } from "./services/controlledAgentCommandRunner";
import { evaluateControlledAgentTaskHarness } from "./services/controlledAgentTaskHarness";
import { evaluateControlledAgentPatchPlanPreview } from "./services/controlledAgentPatchPlanPreview";
import { evaluateControlledAgentMultifilePatchPlan } from "./services/controlledAgentMultifilePatchPlan";
import { buildControlledAgentMultifileApplyRequest, correlateControlledAgentMultifileApplyResult, type ControlledAgentMultifileApplyCorrelation, type ControlledAgentMultifileApplySummary } from "./services/controlledAgentMultifileApplyRequest";
import { buildControlledAgentVerificationBundleRequest, correlateControlledAgentVerificationBundleResult, evaluateControlledAgentVerificationBundle, type ControlledAgentVerificationBundleEvaluation, type ControlledAgentVerificationBundleRequestCorrelation, type ControlledAgentVerificationBundleRequestResult } from "./services/controlledAgentVerificationBundle";
import { buildControlledAgentVerificationFollowup, type ControlledAgentVerificationFollowupAction, type ControlledAgentVerificationFollowupDraft } from "./services/controlledAgentVerificationFollowup";
import { buildControlledAgentProgressReport } from "./services/controlledAgentProgressReport";
import { buildControlledLocalAgentMvp } from "./services/controlledLocalAgentMvp";
import { evaluateControlledAgentRuntimeSession } from "./services/controlledAgentRuntimeSession";
import { initializeControlledAgentRunState, reduceControlledAgentRunState, type ControlledAgentRunState } from "./services/controlledAgentRunState";
import { createControlledOneStepAgentLoopState, reduceControlledOneStepAgentLoopState, type ControlledOneStepAgentLoopState } from "./services/controlledOneStepAgentLoop";
import { createControlledAgentTwoStepRunState, evaluateControlledAgentTwoStepRun } from "./services/controlledAgentTwoStepRun";
import { addControlledRunContextItem, buildControlledRunContextReport, createControlledRunContextBundle, validateControlledRunContextItem, type ControlledRunContextBlockedReason, type ControlledRunContextInput } from "./services/controlledRunContext";
import { appendControlledRunHistoryItem, createControlledRunHistoryItem, type ControlledRunHistoryHostLabel, type ControlledRunHistoryItem, type ControlledRunHistoryPhaseLabel, type ControlledRunHistoryResultLabel } from "./services/controlledRunHistory";
import type { BoundedPatchVerificationLoopMetadata } from "./services/boundedPatchVerificationLoop";
import type { AgentRunInput } from "./services/agentRunState";

const defaultBaseUrl = "http://127.0.0.1:8001";
const productName = productIdentity.displayName;
const preHostRuntimeRefreshRetryCooldownMs = 1500;

type InitialRuntimeConfig = {
  runtimeAccess?: "same_origin_proxy";
  runtimeBaseUrl?: string;
  runtimeProxyBaseUrl?: string;
};

declare global {
  interface Window {
    __yetAiInitialRuntimeConfig?: InitialRuntimeConfig;
  }
}

function readInitialRuntimeSettings(): RuntimeSettings {
  if (typeof window === "undefined") {
    return { baseUrl: defaultBaseUrl, token: "", runtimeAccess: "direct" };
  }
  const config = window.__yetAiInitialRuntimeConfig;
  const proxyBaseUrl = config?.runtimeProxyBaseUrl ?? config?.runtimeBaseUrl;
  if (config?.runtimeAccess === "same_origin_proxy" && proxyBaseUrl !== undefined && isSameOriginProxyBaseUrl(proxyBaseUrl)) {
    return { baseUrl: proxyBaseUrl, token: "", runtimeAccess: "same_origin_proxy" };
  }
  return { baseUrl: defaultBaseUrl, token: "", runtimeAccess: "direct" };
}

function detectInitialBridgeHost(): BridgeHost {
  if (typeof window === "undefined") {
    return "browser";
  }
  if (window.acquireVsCodeApi) {
    return "vscode";
  }
  if (window.postIntellijMessage || window.parent !== window) {
    return "jetbrains";
  }
  return "browser";
}
const agentProgressSnapshotDisplayLimit = 18;
const agentProgressRecentEventDisplayLimit = 11;
const manualRunnerPlanProposalStepLimit = 6;
export const completedIdeActionRequestChatsLimit = 64;
export const completedApplyRequestChatsLimit = 64;
const ignoredDuplicateApplyResultNote = sanitizeDisplayText("Ignored duplicate host apply result.");
const ignoredStaleApplyResultNote = sanitizeDisplayText("Ignored stale host apply result.");
const controlledVerificationFollowupDraftAction: ControlledAgentVerificationFollowupAction = "suggest_manual_next_step";
const controlledVerificationFixDraftAction: ControlledAgentVerificationFollowupAction = "draft_manual_fix_prompt";
const verificationCommands: VerificationCommand[] = [
  { id: "repository-check", label: "Repository check", description: "Run the repository validation command allowlisted by the IDE host." },
  { id: "gui-app-tests", label: "GUI app tests", description: "Run the GUI application test command allowlisted by the IDE host." },
  { id: "engine-chat-tests", label: "Engine chat tests", description: "Run the engine chat test command allowlisted by the IDE host." },
];

const providerAuthStatusCopy: Record<ProviderAuthStatus, string> = {
  not_configured: "No production OpenAI account login is configured. Use the OpenAI API-key fallback as the safe/default real-provider path; the experimental account path is optional and high-risk.",
  api_key_configured: "OpenAI API-key fallback is configured locally. Account login is not required for the default real-provider path, and API-key/Demo Mode precedence stays intact.",
  login_available: "OpenAI account login is exposed by the local runtime, but it is experimental/non-default until official production support is approved.",
  login_unavailable: "OpenAI account login is planned/not available for production; use the OpenAI API-key fallback.",
  pending: "Experimental OpenAI account login is pending. Finish the browser/device step, then exchange the code or refresh status; use API-key fallback for the default path.",
  connected: "Experimental OpenAI account login is connected through the local runtime, but API-key fallback remains the default real-provider path.",
  expired: "Experimental OpenAI account login expired. Reconnect only if you accept the risk, or use the API-key fallback.",
  revoked: "Experimental OpenAI account login was revoked or disconnected. Reconnect only if you accept the risk, or use the API-key fallback.",
  error: "Experimental OpenAI account login reported a sanitized error. Retry/reconnect only if you accept the risk, or use the API-key fallback.",
};

function sanitizeSseEvent(event: SseEvent): SseEvent {
  return {
    ...event,
    payload: sanitizeDisplayValue(event.payload) as Record<string, unknown> | undefined,
  };
}

type ProviderForm = {
  providerId: string;
  kind: "openai-compatible" | "ollama" | "custom";
  displayName: string;
  enabled: boolean;
  baseUrl: string;
  authType: "none" | "api_key";
  apiKey: string;
  modelId: string;
  modelDisplayName: string;
};

type ProviderPreset = {
  id: string;
  label: string;
  description: string;
  form: Omit<ProviderForm, "apiKey" | "enabled">;
  enabled?: boolean;
};

type ActiveStream = {
  controller: AbortController;
  settings: RuntimeSettings;
  revision: number;
  chatId: string;
};

type AbortActiveStreamOptions = {
  finalizeStreaming?: boolean;
  addTimelineEntry?: boolean;
  reportAbortErrors?: boolean;
};

type ProviderTestState = {
  providerId: string;
  state: "testing" | "success" | "failed";
  detail: string;
  status?: ProviderTestResponse["status"] | RuntimeError["status"];
};

type AgentProgressState = {
  state: "not_checked" | "loading" | "ready" | "error";
  response: AgentProgressListResponse | null;
  error: RuntimeError | null;
};

type FirstMessageAction =
  | { kind: "refresh_runtime"; label: string }
  | { kind: "enable_demo_mode"; label: string }
  | { kind: "api_key_fallback"; label: string }
  | { kind: "test_provider"; label: string; providerId: string }
  | { kind: "send_first_message"; label: string };

type FirstMessageReadiness = {
  title: string;
  reason: string;
  nextAction: string;
  actions: FirstMessageAction[];
  notes: string[];
};

type ActiveFilePromptAction = {
  label: string;
  prompt: string;
};

type ModelProposalDraftState = {
  prompt: string;
  goalSummary: string;
  contextSummary: string[];
  safetySummary: string[];
  draftId: string;
};

type SubmittedModelProposalPrompt = ModelProposalDraftState & {
  chatId: string;
  runtimeSettingsVersion: string;
  userMessageId: string;
  commandRequestId: string;
};

type CodingTaskTemplate = {
  mode: CodingTaskPromptMode;
  label: string;
  detail: string;
};

type RuntimeConnectionSource = "startup" | "manual" | "host.ready";

type VerificationOutputBundleItem = Extract<ExplicitContextBundleItem, { kind: "verification_output" }>;
type WorkspaceSnippetSearchResultPayload = IdeActionResultPayload & { action: "searchWorkspaceSnippets"; status: "succeeded"; queryLabel: string; resultCount: number; snippets: WorkspaceSnippetSearchResult[]; truncated: boolean };

type ProjectMemoryState = {
  state: "idle" | "loading" | "saving" | "searching" | "deleting" | "error";
  notes: ProjectMemoryNote[];
  error: RuntimeError | null;
};

const emptyProviderForm: ProviderForm = {
  providerId: "openai-local",
  kind: "openai-compatible",
  displayName: "Local OpenAI-Compatible Provider",
  enabled: true,
  baseUrl: "http://127.0.0.1:8080/v1",
  authType: "api_key",
  apiKey: "",
  modelId: "gpt-4o-mini",
  modelDisplayName: "gpt-4o-mini",
};

const providerPresets: ProviderPreset[] = [
  {
    id: "openai-api",
    label: "OpenAI API key fallback (safe default)",
    description: "Official OpenAI API endpoint. Paste an API key into the local runtime for the current safe/default real-provider path; account login stays experimental/non-default.",
    form: {
      providerId: "openai-api",
      kind: "openai-compatible",
      displayName: "OpenAI API",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      modelId: "gpt-4o-mini",
      modelDisplayName: "GPT-4o mini",
    },
  },
  {
    id: "openai-compatible-custom",
    label: "OpenAI-compatible /v1",
    description: "Custom OpenAI-compatible endpoint; add your provider URL and key locally.",
    form: {
      providerId: "openai-compatible-custom",
      kind: "openai-compatible",
      displayName: "OpenAI-Compatible Provider",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      modelId: "gpt-4o-mini",
      modelDisplayName: "gpt-4o-mini",
    },
  },
  {
    id: "lm-studio-local",
    label: "LM Studio local",
    description: "Common LM Studio OpenAI-compatible local server default.",
    form: {
      providerId: "lm-studio-local",
      kind: "openai-compatible",
      displayName: "LM Studio Local",
      baseUrl: "http://127.0.0.1:1234/v1",
      authType: "none",
      modelId: "local-model",
      modelDisplayName: "local-model",
    },
  },
  {
    id: "localai-local",
    label: "LocalAI local",
    description: "Common LocalAI OpenAI-compatible local server default.",
    form: {
      providerId: "localai-local",
      kind: "openai-compatible",
      displayName: "LocalAI Local",
      baseUrl: "http://127.0.0.1:8080/v1",
      authType: "none",
      modelId: "local-model",
      modelDisplayName: "local-model",
    },
  },
  {
    id: "ollama-local",
    label: "Ollama local (native)",
    description: "Direct local Ollama engine at http://127.0.0.1:11434. No API key, account, hosted Yet AI service, or cloud workspace is required.",
    form: {
      providerId: "ollama-local",
      kind: "ollama",
      displayName: "Ollama Local",
      baseUrl: "http://127.0.0.1:11434",
      authType: "none",
      modelId: "llama3.2",
      modelDisplayName: "llama3.2",
    },
  },
  {
    id: "ollama-openai-compatible",
    label: "Ollama OpenAI-compatible /v1",
    description: "Optional compatibility path for Ollama's /v1 API. Prefer Ollama local (native) when your runtime supports it.",
    form: {
      providerId: "ollama-openai-compatible",
      kind: "openai-compatible",
      displayName: "Ollama OpenAI-Compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      authType: "none",
      modelId: "llama3.2",
      modelDisplayName: "llama3.2",
    },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Blank custom local-first provider form.",
    form: {
      providerId: "custom-provider",
      kind: "openai-compatible",
      displayName: "Custom Provider",
      baseUrl: "http://127.0.0.1:8080/v1",
      authType: "api_key",
      modelId: "custom-model",
      modelDisplayName: "custom-model",
    },
  },
];

const codingTaskTemplates: CodingTaskTemplate[] = [
  { mode: "ask", label: "Ask", detail: "Ask a bounded task question and request the next safe manual step." },
  { mode: "explain", label: "Explain", detail: "Explain selected code or task facts without hidden context." },
  { mode: "find_bug", label: "Find bug", detail: "Look for visible bugs, edge cases, and uncertainty." },
  { mode: "suggest_tests", label: "Suggest tests", detail: "Draft focused test scenarios from explicit context only." },
  { mode: `re${"factor_safely"}`, label: `Re${"factor safely"}`, detail: "Propose the smallest safe rework for manual review." },
  { mode: "safe_edit", label: "Safe edit/proposal", detail: "Request a small edit proposal that is not applied automatically." },
  { mode: "implementation_plan", label: "Implementation plan", detail: "Plan files, tests, risks, and a stop point before edits." },
  { mode: "follow_up", label: "Follow-up", detail: "Use visible response/edit/verification state for the next manual step." },
];

export function generateApplyRequestSessionNonce(): string {
  const alphabet = "0123456789abcdef";
  let hex = "";
  const cryptoObj = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(12);
    cryptoObj.getRandomValues(bytes);
    for (const byte of bytes) {
      hex += alphabet[byte & 0x0f];
    }
  } else {
    for (let index = 0; index < 12; index += 1) {
      hex += alphabet[Math.floor(Math.random() * 16)];
    }
  }
  return `s${hex}`;
}

export function App() {
  const initialRuntimeSettings = useMemo(() => readInitialRuntimeSettings(), []);
  const [baseUrl, setBaseUrl] = useState(initialRuntimeSettings.baseUrl);
  const [token, setToken] = useState(initialRuntimeSettings.token);
  const [runtimeAccess, setRuntimeAccess] = useState(initialRuntimeSettings.runtimeAccess);
  const [ping, setPing] = useState<PingResponse | null>(null);
  const [caps, setCaps] = useState<CapsResponse | null>(null);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [demoMode, setDemoModeState] = useState<DemoModeResponse | null>(null);
  const [demoModeError, setDemoModeError] = useState<RuntimeError | null>(null);
  const [demoModeWorking, setDemoModeWorking] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [connectionError, setConnectionError] = useState<RuntimeError | null>(null);
  const [modelError, setModelError] = useState<RuntimeError | null>(null);
  const [identityWarnings, setIdentityWarnings] = useState<string[]>([]);
  const [providerError, setProviderError] = useState<RuntimeError | null>(null);
  const [providerTestState, setProviderTestState] = useState<ProviderTestState | null>(null);
  const [providerAuthError, setProviderAuthError] = useState<RuntimeError | null>(null);
  const [providerAuthStatus, setProviderAuthStatus] = useState<ProviderAuthResponse | null>(null);
  const [providerAuthUrlWarning, setProviderAuthUrlWarning] = useState<string | null>(null);
  const [providerAuthExchangeCode, setProviderAuthExchangeCode] = useState("");
  const [providerAuthExchangeError, setProviderAuthExchangeError] = useState<string | null>(null);
  const [providerAuthExchangeWorking, setProviderAuthExchangeWorking] = useState(false);
  const [chatError, setChatError] = useState<RuntimeError | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [chatId, setChatId] = useState("chat-001");
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([]);
  const [chatHistoryError, setChatHistoryError] = useState<RuntimeError | null>(null);
  const [chatHistoryRevision, setChatHistoryRevision] = useState<number | null>(null);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [conversationNotice, setConversationNotice] = useState<string | null>(null);
  const [compactConversationsOpen, setCompactConversationsOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [manualRunnerDraftPlan, setManualRunnerDraftPlan] = useState("");
  const [codingTaskGoal, setCodingTaskGoal] = useState("");
  const [modelProposalDraft, setModelProposalDraft] = useState<ModelProposalDraftState | null>(null);
  const [submittedModelProposalPrompt, setSubmittedModelProposalPrompt] = useState<SubmittedModelProposalPrompt | null>(null);
  const [adoptedProviderProposalState, setAdoptedProviderProposalState] = useState<AgentRunModelProviderProposalState | undefined>(undefined);
  const [chatView, setChatView] = useState(() => createInitialChatViewState("chat-001"));
  const [chatLifecycleState, setChatLifecycleState] = useState<ChatLifecycleState>("idle");
  const [timeline, setTimeline] = useState<string[]>([]);
  const [codingSessionTrace, setCodingSessionTrace] = useState<CodingSessionTraceEntry[]>([]);
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);
  const [bridgeHost, setBridgeHost] = useState<BridgeHost>(() => detectInitialBridgeHost());
  const [controlledHostCapabilities, setControlledHostCapabilities] = useState<HostReadyPayload["controlledCapabilities"] | undefined>(undefined);
  const [attachedContext, setAttachedContext] = useState<{ payload: HostContextSnapshotPayload; settingsRevision: number; chatId: string; excerpt?: ActiveFileExcerptAttachment } | null>(null);
  const [includeAttachedContext, setIncludeAttachedContext] = useState(false);
  const [attachedContextAcknowledged, setAttachedContextAcknowledged] = useState(false);
  const [attachedContextStatus, setAttachedContextStatus] = useState<string | null>(null);
  const [explicitContextBundleItems, setExplicitContextBundleItems] = useState<ExplicitContextBundleItem[]>([]);
  const [includeExplicitContextBundle, setIncludeExplicitContextBundle] = useState(true);
  const [includeControlledRunContext, setIncludeControlledRunContext] = useState(true);
  const [explicitContextBundleStatus, setExplicitContextBundleStatus] = useState<string | null>(null);
  const [workspaceSnippetQuery, setWorkspaceSnippetQuery] = useState("");
  const [workspaceSnippetResult, setWorkspaceSnippetResult] = useState<WorkspaceSnippetSearchResultPayload | null>(null);
  const [selectedWorkspaceSnippetKeys, setSelectedWorkspaceSnippetKeys] = useState<string[]>([]);
  const [workspaceSnippetStatus, setWorkspaceSnippetStatus] = useState<string | null>(null);
  const [projectMemoryTitle, setProjectMemoryTitle] = useState("");
  const [projectMemoryText, setProjectMemoryText] = useState("");
  const [projectMemoryTags, setProjectMemoryTags] = useState("");
  const [projectMemoryQuery, setProjectMemoryQuery] = useState("");
  const [projectMemory, setProjectMemory] = useState<ProjectMemoryState>({ state: "idle", notes: [], error: null });
  const [projectMemoryStatus, setProjectMemoryStatus] = useState<string | null>(null);
  const [runtimeRefreshStatus, setRuntimeRefreshStatus] = useState<{ state: "checking" | "connected" | "failed"; attempt: number; checkedAt: string; detail: string } | null>(null);
  const [runtimeLifecycle, setRuntimeLifecycle] = useState<{ diagnostics: RuntimeLifecycleDiagnostics; settingsRevision: number } | null>(null);
  const [runtimeRefreshInFlight, setRuntimeRefreshInFlight] = useState(false);
  const [runtimeConnectionSource, setRuntimeConnectionSource] = useState<RuntimeConnectionSource>(() => isSameOriginProxyBaseUrl(initialRuntimeSettings.baseUrl) ? "host.ready" : "startup");
  const [hostReadyRefreshNonce, setHostReadyRefreshNonce] = useState(0);
  const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState(true);
  const [providerDetailsOpen, setProviderDetailsOpen] = useState(false);
  const [providerSetupHighlight, setProviderSetupHighlight] = useState(false);
  const [providerSetupStatus, setProviderSetupStatus] = useState<string | null>(null);
  const [providerSetupFocusRequest, setProviderSetupFocusRequest] = useState(0);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const runtimeRefreshAttemptRef = useRef(0);
  const runtimeRefreshInFlightRef = useRef(false);
  const runtimeRefreshQueuedRef = useRef(false);
  const hostReadyAppliedRef = useRef(isSameOriginProxyBaseUrl(initialRuntimeSettings.baseUrl));
  const preHostRuntimeRefreshRequestedAtRef = useRef<number | null>(null);
  const preHostRuntimeRefreshRequestCounterRef = useRef(0);
  const settingsRevisionRef = useRef(0);
  const settingsRef = useRef<RuntimeSettings>(initialRuntimeSettings);
  const chatIdRef = useRef("chat-001");
  const providerTestAttemptRef = useRef(0);
  const providerAuthMutationAttemptRef = useRef(0);
  const providerAuthExchangeInFlightRef = useRef(false);
  const chatHistoryAttemptRef = useRef(0);
  const [providerAuthMutation, setProviderAuthMutation] = useState<"start" | "exchange" | "disconnect" | null>(null);
  const [runtimeDataRevision, setRuntimeDataRevision] = useState<number | null>(null);
  const [providerDataRevision, setProviderDataRevision] = useState<number | null>(null);
  const [providerAuthDataRevision, setProviderAuthDataRevision] = useState<number | null>(null);
  const [demoModeDataRevision, setDemoModeDataRevision] = useState<number | null>(null);
  const [agentProgress, setAgentProgress] = useState<AgentProgressState>({ state: "not_checked", response: null, error: null });
  const activeStreamRef = useRef<ActiveStream | null>(null);
  const [editProposal, setEditProposal] = useState<EditProposalState | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResultState | null>(null);
  const [pendingApplyRequestId, setPendingApplyRequestId] = useState<string | null>(null);
  const [agentRunApplyRequest, setAgentRunApplyRequest] = useState<AgentRunInput["applyRequest"] | null>(null);
  const [agentRunVerificationRequest, setAgentRunVerificationRequest] = useState<AgentRunInput["verificationRequest"] | null>(null);
  const [agentRunVerificationProgress, setAgentRunVerificationProgress] = useState<AgentRunInput["verificationProgress"] | null>(null);
  const [agentRunVerificationResult, setAgentRunVerificationResult] = useState<AgentRunInput["verificationResult"] | null>(null);
  const [agentRunVerificationFixDraft, setAgentRunVerificationFixDraft] = useState<{ present: boolean; awaitingManualSend: boolean; metadata?: VerificationFollowupPromptDraftMetadata; label?: string } | null>(null);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [ideActionAttempt, setIdeActionAttempt] = useState<IdeActionAttemptState | null>(null);
  const [ideActionNote, setIdeActionNote] = useState<string | null>(null);
  const [ideActionProposal, setIdeActionProposal] = useState<IdeActionProposalState | null>(null);
  const [attachedVerificationKey, setAttachedVerificationKey] = useState<string | null>(null);
  const bridgeAdapterRef = useRef<BridgeAdapter | null>(null);
  const editProposalCounterRef = useRef(0);
  const editProposalApplyCounterRef = useRef(0);
  const editProposalApplySessionNonceRef = useRef<string>(generateApplyRequestSessionNonce());
  const editProposalIdentityRef = useRef<(EditProposalIdentity & { requestId: string }) | null>(null);
  const agentRunApplyCounterRef = useRef(0);
  const agentRunApplyCorrelationRef = useRef<AgentRunApplyCorrelationMetadata | null>(null);
  const agentRunApplyChatIdRef = useRef<string | null>(null);
  const agentRunVerificationCorrelationRef = useRef<AgentRunVerificationCorrelationMetadata | null>(null);
  const agentRunVerificationChatIdRef = useRef<string | null>(null);
  const agentRunVerificationResultRef = useRef<AgentRunInput["verificationResult"] | null>(null);
  const agentRunInputRef = useRef<AgentRunInput | null>(null);
  const editProposalRejectedTraceKeyRef = useRef<string | null>(null);
  const ideActionProposalCounterRef = useRef(0);
  const ideActionProposalIdentityRef = useRef<{ requestId: string; sourceMessageId: string; payloadKey: string } | null>(null);
  const chatViewMessagesRef = useRef<ChatViewMessage[]>([]);
  const pendingApplyRequestIdRef = useRef<string | null>(null);
  const pendingApplyProposalRequestIdRef = useRef<string | null>(null);
  const pendingIdeActionRequestIdRef = useRef<string | null>(null);
  const pendingIdeActionChatIdRef = useRef<string | null>(null);
  const controlledFileReadCorrelationRef = useRef<ControlledAgentFileReadRequestCorrelation | null>(null);
  const controlledFileReadCompletedRequestIdRef = useRef<string | null>(null);
  const controlledEditCorrelationRef = useRef<ControlledAgentEditRequestCorrelation | null>(null);
  const controlledEditCompletedRequestIdRef = useRef<string | null>(null);
  const controlledCommandRunCorrelationRef = useRef<ControlledAgentCommandRunRequestCorrelation | null>(null);
  const controlledCommandRunCompletedRequestIdRef = useRef<string | null>(null);
  const controlledLexicalSearchCorrelationRef = useRef<ControlledAgentLexicalSearchCorrelation | null>(null);
  const controlledMultifileApplyCorrelationRef = useRef<ControlledAgentMultifileApplyCorrelation | null>(null);
  const controlledMultifileApplyCompletedRequestIdRef = useRef<string | null>(null);
  const controlledVerificationBundleCorrelationRef = useRef<ControlledAgentVerificationBundleRequestCorrelation | null>(null);
  const controlledVerificationBundleCompletedRequestIdRef = useRef<string | null>(null);
  const providerSetupCardRef = useRef<HTMLElement | null>(null);
  const providerApiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const providerSetupHighlightTimerRef = useRef<number | null>(null);
  const oneStepFileReadRequestIdRef = useRef<string | null>(null);
  const oneStepEditRequestIdRef = useRef<string | null>(null);
  const oneStepCommandRunRequestIdRef = useRef<string | null>(null);
  const oneStepFileReadRequestRef = useRef<ReturnType<typeof buildControlledAgentFileReadRequest> | null>(null);
  const oneStepEditRequestRef = useRef<ReturnType<typeof buildControlledAgentEditRequest> | null>(null);
  const oneStepCommandRunRequestRef = useRef<ReturnType<typeof buildControlledAgentCommandRunRequest> | null>(null);
  const oneStepLoopRunCounterRef = useRef(0);
  const completedIdeActionRequestChatsRef = useRef<Map<string, string>>(new Map());
  const completedApplyRequestChatsRef = useRef<Map<string, string>>(new Map());
  const ideActionCounterRef = useRef(0);
  const attachedContextRef = useRef<typeof attachedContext>(null);
  const agentProgressAttemptRef = useRef(0);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRegionRef = useRef<HTMLDivElement | null>(null);
  const optimisticUserMessageCounterRef = useRef(0);
  const modelProposalDraftCounterRef = useRef(0);
  const [controlledFileReadResultMetadata, setControlledFileReadResultMetadata] = useState<unknown>(null);
  const [pendingControlledFileReadRequestId, setPendingControlledFileReadRequestId] = useState<string | null>(null);
  const [controlledFileReadNote, setControlledFileReadNote] = useState<string | null>(null);
  const [controlledEditResultMetadata, setControlledEditResultMetadata] = useState<unknown>(null);
  const [pendingControlledEditRequestId, setPendingControlledEditRequestId] = useState<string | null>(null);
  const [controlledEditNote, setControlledEditNote] = useState<string | null>(null);
  const [controlledPatchPlanConfirmed, setControlledPatchPlanConfirmed] = useState(false);
  const [controlledCommandRunResultMetadata, setControlledCommandRunResultMetadata] = useState<unknown>(null);
  const [pendingControlledCommandRunRequestId, setPendingControlledCommandRunRequestId] = useState<string | null>(null);
  const [controlledCommandRunNote, setControlledCommandRunNote] = useState<string | null>(null);
  const [controlledLexicalSearchResult, setControlledLexicalSearchResult] = useState<ControlledAgentLexicalSearchSummary | undefined>(undefined);
  const [controlledMultifileApplyResult, setControlledMultifileApplyResult] = useState<ControlledAgentMultifileApplySummary | undefined>(undefined);
  const [pendingControlledMultifileApplyRequestId, setPendingControlledMultifileApplyRequestId] = useState<string | null>(null);
  const [controlledMultifileApplyNote, setControlledMultifileApplyNote] = useState<string | null>(null);
  const [controlledMultifileApplyConfirmed, setControlledMultifileApplyConfirmed] = useState(false);
  const [controlledVerificationBundleResult, setControlledVerificationBundleResult] = useState<ControlledAgentVerificationBundleEvaluation | undefined>(undefined);
  const [controlledVerificationBundleSourceResult, setControlledVerificationBundleSourceResult] = useState<unknown>(undefined);
  const [controlledVerificationBundleAcceptedCorrelation, setControlledVerificationBundleAcceptedCorrelation] = useState<ControlledAgentVerificationBundleRequestCorrelation | null>(null);
  const [controlledVerificationBundleRequest, setControlledVerificationBundleRequest] = useState<ControlledAgentVerificationBundleRequestResult | undefined>(undefined);
  const [pendingControlledVerificationBundleRequestId, setPendingControlledVerificationBundleRequestId] = useState<string | null>(null);
  const [controlledVerificationBundleNote, setControlledVerificationBundleNote] = useState<string | null>(null);
  const [controlledVerificationFollowupDraft, setControlledVerificationFollowupDraft] = useState<ControlledAgentVerificationFollowupDraft | null>(null);
  const [controlledLexicalSearchResultId, setControlledLexicalSearchResultId] = useState<string | undefined>(undefined);
  const [selectedControlledSearchResultIds, setSelectedControlledSearchResultIds] = useState<string[]>([]);
  const [oneStepLoopState, setOneStepLoopState] = useState<ControlledOneStepAgentLoopState>(() => createControlledOneStepAgentLoopState());
  const [controlledRunHistory, setControlledRunHistory] = useState<ControlledRunHistoryItem[]>([]);

  const settings = useMemo<RuntimeSettings>(() => ({ baseUrl, token, runtimeAccess }), [baseUrl, runtimeAccess, token]);
  settingsRef.current = settings;
  chatIdRef.current = chatId;
  chatViewMessagesRef.current = chatView.messages;
  attachedContextRef.current = attachedContext;
  const runtimeDataCurrent = runtimeDataRevision === settingsRevision;
  const providerDataCurrent = providerDataRevision === settingsRevision;
  const providerAuthDataCurrent = providerAuthDataRevision === settingsRevision;
  const demoModeDataCurrent = demoModeDataRevision === settingsRevision;
  const chatHistoryCurrent = chatHistoryRevision === settingsRevision;
  const activePing = runtimeDataCurrent ? ping : null;
  const activeCaps = runtimeDataCurrent ? caps : null;
  const activeModels = runtimeDataCurrent ? models : [];
  const activeConnectionError = runtimeDataCurrent ? connectionError : null;
  const activeModelError = runtimeDataCurrent ? modelError : null;
  const activeIdentityWarnings = runtimeDataCurrent ? identityWarnings : [];
  const activeProviders = providerDataCurrent ? providers : [];
  const activeDemoMode = demoModeDataCurrent ? demoMode : null;
  const activeDemoModeError = demoModeDataCurrent ? demoModeError : null;
  const activeProviderAuthStatus = providerAuthDataCurrent ? providerAuthStatus : null;
  const activeProviderAuthError = providerAuthDataCurrent ? providerAuthError : null;
  const activeChatSummaries = chatHistoryCurrent ? chatSummaries : [];
  const activeRuntimeLifecycle = runtimeLifecycle?.settingsRevision === settingsRevision ? runtimeLifecycle.diagnostics : null;
  const activeChatSummary = activeChatSummaries.find((item) => item.chatId === chatId);
  const activeChatIndex = activeChatSummaries.findIndex((item) => item.chatId === chatId);
  const runtimeConnected = activePing?.ready === true && !activeConnectionError;
  const runtimeAuthMismatchError = runtimeAuthMismatch(activeConnectionError, activeModelError, activeProviderAuthError);
  const connectionStatus = activeConnectionError ? "error" : activePing?.ready ? "connected" : "not checked";
  const hostedRuntimeConnection = bridgeHost !== "browser" || runtimeConnectionSource === "host.ready";
  const enabledProviders = useMemo(() => activeProviders.filter((provider) => provider.enabled), [activeProviders]);
  const apiKeyReadiness = useMemo(() => resolveProviderModelReadiness(activeModels, enabledProviders, activeModelError), [activeModels, activeModelError, enabledProviders]);
  const selectedModel = apiKeyReadiness.model;
  const apiKeyReadinessState = classifyProviderReadinessState(apiKeyReadiness, runtimeConnected);
  const apiKeyChatReady = runtimeConnected && apiKeyReadiness.ready;
  const demoModeEnabled = activeDemoMode?.enabled === true;
  const providerAuthMutationInFlight = providerAuthMutation !== null;
  const experimentalOauthChatReady = runtimeConnected && !apiKeyChatReady && !providerAuthMutationInFlight && !apiKeyReadiness.mismatch && activeProviderAuthStatus?.configured === true && activeProviderAuthStatus.authSource === "oauth" && activeProviderAuthStatus.status === "connected";
  const canSendChat = apiKeyChatReady || experimentalOauthChatReady;
  const selectedModelRawId = selectedModel?.id;
  const selectedModelProviderRawId = apiKeyReadiness.provider?.id ?? selectedModel?.providerId;
  const activeSelectedDemoMode = demoModeEnabled && selectedModelProviderRawId === activeDemoMode?.providerId && selectedModelRawId === activeDemoMode?.modelId;
  const activeSelectedLocalProvider = apiKeyReadiness.provider?.kind === "ollama" || apiKeyReadiness.provider?.kind === "custom";
  const selectedModelDisplayName = selectedModel ? sanitizeDisplayText(selectedModel.displayName || selectedModel.id) : undefined;
  const selectedModelProviderId = apiKeyReadiness.provider?.id ? sanitizeDisplayText(apiKeyReadiness.provider.id) : selectedModel?.providerId ? sanitizeDisplayText(selectedModel.providerId) : undefined;
  const chatReadinessLabel = !runtimeConnected
    ? "Runtime unavailable"
    : apiKeyChatReady
      ? `${selectedModelDisplayName ?? "the default model"}${selectedModelProviderId ? ` (${selectedModelProviderId})` : ""}`
      : apiKeyReadiness.mismatch
        ? "Runtime model/provider mismatch"
        : providerAuthMutationInFlight && activeProviderAuthStatus?.authSource === "oauth" && !apiKeyChatReady
          ? "OpenAI account login changing"
          : experimentalOauthChatReady
            ? "Experimental OpenAI account fallback / gpt-5-codex"
            : apiKeyReadiness.message
              ? readinessStateLabel(apiKeyReadinessState, false)
              : "Provider required";
  const chatReadinessMessage = !runtimeConnected
    ? "Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send."
    : apiKeyChatReady
      ? activeSelectedDemoMode
        ? "Demo Mode is ready: send a prompt to try the chat flow with runtime-owned local canned responses. No provider call, provider API key, account, hosted Yet AI backend, cloud workspace, or credit balance is used."
        : activeSelectedLocalProvider
          ? `Ready to send using ${selectedModelDisplayName ?? "the default model"} through the local runtime directly to your local provider.`
          : `Ready to send using ${selectedModelDisplayName ?? "the default model"} through the local runtime.`
      : apiKeyReadiness.message
        ? apiKeyReadiness.message
        : providerAuthMutationInFlight && activeProviderAuthStatus?.authSource === "oauth" && !apiKeyChatReady
          ? "OpenAI account login state is changing. Wait for the local runtime to finish, refresh login status, or use the API-key fallback before sending."
          : experimentalOauthChatReady
            ? "Experimental Codex-like OpenAI account chat is available as a fallback through the local runtime because no safer API-key, OpenAI-compatible, local, or Demo Mode path is ready. This private-endpoint path is high-risk, not official public OAuth support, not default, and not production-ready."
            : activeModelError
              ? "Runtime model refresh failed. Check the local runtime/provider details shown here, Test provider if one is saved, then Refresh runtime again before sending the first message."
              : "Provider required: choose Demo Mode for a no-key local canned trial, or configure a BYOK provider/model such as local Ollama or OpenAI-compatible for real answers. No production account login is required.";
  const chatModelStatus = apiKeyReadiness.model ? modelStatusText(apiKeyReadiness.model, apiKeyReadiness.provider) : null;
  const chatReadinessEvidence = apiKeyReadiness.model ? modelReadinessEvidenceText(apiKeyReadiness.model, apiKeyReadiness.provider) : null;
  const providerAuthPendingState = useMemo(() => parseProviderAuthState(activeProviderAuthStatus), [activeProviderAuthStatus]);
  const currentAttachedContextState = attachedContext?.settingsRevision === settingsRevision && attachedContext.chatId === chatId ? attachedContext : null;
  const currentAttachedContext = currentAttachedContextState?.payload ?? null;
  const currentActiveFileExcerpt = currentAttachedContextState?.excerpt ?? null;
  const codingActionsCanUseContext = Boolean(currentAttachedContext && !currentActiveFileExcerpt && hasUsableAttachedContext(currentAttachedContext) && (!attachedContextRequiresAcknowledgement(currentAttachedContext) || attachedContextAcknowledged));
  const editProposalReview = useMemo(() => latestEditProposalReviewFromMessages(chatView.messages), [chatView.messages]);
  const editProposalCandidate = editProposalReview.state === "valid" ? editProposalReview.candidate : null;
  const activeEditProposal = editProposalCandidateIdentityMatches(editProposal, editProposalCandidate) ? editProposal : null;
  const activeRejectedEditProposal = editProposalReview.state === "rejected" ? { sourceMessageId: editProposalReview.sourceMessageId, diagnostic: editProposalReview.diagnostic } : null;
  const ideActionProposalReview = useMemo(() => latestIdeActionProposalReviewFromMessages(chatView.messages), [chatView.messages]);
  const ideActionProposalCandidate = ideActionProposalReview.state === "valid" ? ideActionProposalReview.candidate : null;
  const activeIdeActionProposal = ideActionProposalMatchesCandidate(ideActionProposal, ideActionProposalCandidate) ? ideActionProposal : null;
  const activeRejectedIdeActionProposal = ideActionProposalReview.state === "rejected" ? { sourceMessageId: ideActionProposalReview.sourceMessageId, diagnostic: ideActionProposalReview.diagnostic } : null;
  const safeActiveWorkspacePath = currentAttachedContext?.file?.workspaceRelativePath;
  const safeActiveRange = rangeFromContextSelection(currentAttachedContext?.selection);
  const attachedProjectMemoryItems = explicitContextBundleItems.filter((item): item is ProjectMemoryBundleItem => item.kind === "project_memory");
  const attachedProjectMemoryCount = attachedProjectMemoryItems.length;
  const attachedProjectMemoryNoteIds = useMemo(() => new Set(attachedProjectMemoryItems.map((item) => item.noteId)), [attachedProjectMemoryItems]);
  const pendingActiveFileExcerpt = pendingIdeActionRequestIdRef.current !== null && ideActionAttempt?.action === "getActiveFileExcerpt" && (ideActionAttempt.status === "pending" || ideActionAttempt.status === "inProgress");
  const activeFilePromptAction = useMemo(() => currentActiveFileExcerpt ? buildActiveFilePromptAction(currentActiveFileExcerpt) : null, [currentActiveFileExcerpt]);
  const chatHistoryStatus = conversationHistoryStatusLabel({ loading: chatHistoryLoading, current: chatHistoryCurrent, count: activeChatSummaries.length, hasError: Boolean(chatHistoryError) });
  const showAppliedEditVerificationStep = applyResult?.payload.status === "applied";
  const latestPlanProposal = useMemo(() => latestManualRunnerPlanProposal(agentProgress.response), [agentProgress.response]);
  const verificationAttempt = ideActionAttempt?.action === "runVerificationCommand" ? ideActionAttempt : null;
  const latestModelProposalAssistant = useMemo(() => submittedModelProposalPrompt ? latestAssistantMessageAfterPrompt(chatView.messages, submittedModelProposalPrompt.prompt) : undefined, [chatView.messages, submittedModelProposalPrompt]);
  const agentRunModelProposal = useMemo<AgentRunModelProposalResult>(() => evaluateAgentRunModelProposal({
    chatId,
    goal: codingTaskGoal,
    submittedPromptRequestId: submittedModelProposalPrompt?.commandRequestId,
    latestUserMessageId: submittedModelProposalPrompt?.userMessageId,
    runtimeSettingsVersion: submittedModelProposalPrompt?.runtimeSettingsVersion,
    latestAssistantMessage: latestModelProposalAssistant && submittedModelProposalPrompt ? {
      id: latestModelProposalAssistant.id,
      chatId,
      role: latestModelProposalAssistant.role,
      status: latestModelProposalAssistant.status,
      content: latestModelProposalAssistant.content,
      responseToRequestId: submittedModelProposalPrompt.commandRequestId,
      userMessageId: submittedModelProposalPrompt.userMessageId,
      runtimeSettingsVersion: submittedModelProposalPrompt.runtimeSettingsVersion,
    } : undefined,
    providerProposalState: adoptedProviderProposalState && latestModelProposalAssistant?.id !== adoptedProviderProposalState.sourceMessageId ? adoptedProviderProposalState : undefined,
  }), [adoptedProviderProposalState, chatId, codingTaskGoal, latestModelProposalAssistant, submittedModelProposalPrompt]);
  const legacyAgentRunInput = useMemo(() => buildAgentRunInput(codingTaskGoal, activeEditProposal, applyResult, verificationAttempt), [activeEditProposal, applyResult, codingTaskGoal, verificationAttempt]);
  const agentRunReadiness = useMemo<AgentRunReadinessResult | null>(() => {
    if (agentRunModelProposal.proposalPathState !== "proposal_detected") {
      return null;
    }
    const readinessMetadata = activeCaps?.agentRunReadiness;
    return composeAgentRunReadiness({
      ...(isRecord(readinessMetadata) ? readinessMetadata : {}),
      loopId: agentRunReadinessLoopId(agentRunModelProposal.agentRunInput.proposal?.id, submittedModelProposalPrompt?.commandRequestId),
      goal: agentRunReadinessGoalMetadata(agentRunModelProposal.agentRunInput.goal),
      proposal: agentRunReadinessProposalMetadata(agentRunModelProposal.agentRunInput.proposal, activeEditProposal),
    });
  }, [activeCaps, activeEditProposal, agentRunModelProposal, submittedModelProposalPrompt]);
  const agentRunInput = useMemo<AgentRunInput | undefined>(() => {
    const baseInput = submittedModelProposalPrompt || modelProposalDraft ? agentRunModelProposal.proposalPathState === "proposal_detected" && activeEditProposal ? agentRunReadiness ? { ...(legacyAgentRunInput ?? {}), ...agentRunReadiness.agentRunInput, boundedLoop: agentRunReadiness.boundedLoop, applyRequest: agentRunApplyRequest ?? legacyAgentRunInput?.applyRequest, applyResult: legacyAgentRunInput?.applyResult, verificationRequest: agentRunVerificationRequest ?? legacyAgentRunInput?.verificationRequest, verificationProgress: agentRunVerificationProgress ?? legacyAgentRunInput?.verificationProgress, verificationResult: agentRunVerificationResult ?? legacyAgentRunInput?.verificationResult, rollback: agentRunVerificationResult ? undefined : legacyAgentRunInput?.rollback } : agentRunModelProposal.agentRunInput : agentRunModelProposal.agentRunInput : legacyAgentRunInput;
    const withControlledVerification = baseInput ? {
      ...baseInput,
      verificationRequest: agentRunVerificationRequest ?? baseInput.verificationRequest,
      verificationProgress: agentRunVerificationProgress ?? baseInput.verificationProgress,
      verificationResult: agentRunVerificationResult ?? baseInput.verificationResult,
      rollback: agentRunVerificationResult ? undefined : baseInput.rollback,
    } : baseInput;
    if (agentRunModelProposal.planPreview) {
      return {
        ...(withControlledVerification ?? agentRunModelProposal.agentRunInput),
        planPreview: agentRunPlanPreviewInput(agentRunModelProposal.planPreview.plan),
      };
    }
    if (agentRunModelProposal.proposalPathState === "plan_rejected" || agentRunModelProposal.proposalPathState === "blocked") {
      return {
        ...(withControlledVerification ?? agentRunModelProposal.agentRunInput),
        planDiagnostics: agentRunModelProposal.diagnostics.map((item) => `${item.code}: Plan preview metadata was rejected safely.`),
      };
    }
    return withControlledVerification;
  }, [activeEditProposal, agentRunApplyRequest, agentRunModelProposal, agentRunReadiness, agentRunVerificationProgress, agentRunVerificationRequest, agentRunVerificationResult, legacyAgentRunInput, modelProposalDraft, submittedModelProposalPrompt]);
  agentRunInputRef.current = agentRunInput ?? null;
  useEffect(() => {
    if (agentRunModelProposal.providerProposalState) {
      setAdoptedProviderProposalState((current) => current?.payloadKey === agentRunModelProposal.providerProposalState?.payloadKey ? current : agentRunModelProposal.providerProposalState);
    }
  }, [agentRunModelProposal.providerProposalState]);
  const agentRunCheckpointDecision = useMemo<AgentRunCheckpointDecisionSummary | undefined>(() => agentRunInput ? buildAgentRunCheckpointDecision({ host: bridgeHost, agentRun: agentRunInput }) : undefined, [agentRunInput, bridgeHost]);
  const agentRunCheckpointDecisionTraceEntry = useMemo<CodingSessionTraceEntry | null>(() => createCheckpointDecisionTraceEntry(agentRunCheckpointDecision), [agentRunCheckpointDecision]);
  const controlledAgentFileReadMetadata = activeCaps?.controlledAgentFileRead;
  const effectiveControlledAgentFileReadMetadata = controlledFileReadResultMetadata ?? controlledAgentFileReadMetadata;
  const controlledAgentFileReadSummary = useMemo(() => evaluateControlledAgentFileRead(effectiveControlledAgentFileReadMetadata), [effectiveControlledAgentFileReadMetadata]);
  const controlledAgentFileReadTraceEntry = useMemo<CodingSessionTraceEntry | null>(() => createControlledAgentFileReadTraceEntry(effectiveControlledAgentFileReadMetadata), [effectiveControlledAgentFileReadMetadata]);
  const controlledAgentTwoStepRunMetadata = activeCaps?.controlledAgentTwoStepRun;
  const controlledAgentTwoStepRunState = useMemo(() => controlledAgentTwoStepRunMetadata === undefined ? createControlledAgentTwoStepRunState() : evaluateControlledAgentTwoStepRun(controlledAgentTwoStepRunMetadata), [controlledAgentTwoStepRunMetadata]);
  const controlledAgentVerificationBundleMetadata = activeCaps?.controlledAgentVerificationBundle;
  const activeCapsMetadata: Record<string, unknown> = isRecord(activeCaps) ? activeCaps : {};
  const controlledAgentTaskHarnessMetadata = activeCapsMetadata.controlledAgentTaskHarness;
  const controlledAgentWorkflowTranscriptMetadata = activeCapsMetadata.controlledAgentWorkflowTranscript;
  const controlledAgentTaskHarness = useMemo(() => controlledAgentTaskHarnessMetadata === undefined ? undefined : evaluateControlledAgentTaskHarness(controlledAgentTaskHarnessMetadata), [controlledAgentTaskHarnessMetadata]);
  const controlledAgentVerificationBundle = useMemo(() => controlledAgentVerificationBundleMetadata === undefined ? undefined : evaluateControlledAgentVerificationBundle(controlledAgentVerificationBundleMetadata), [controlledAgentVerificationBundleMetadata]);
  const effectiveControlledVerificationBundle = controlledVerificationBundleResult ?? controlledAgentVerificationBundle;
  const controlledAgentCommandRunnerMetadata = activeCaps?.controlledAgentCommandRunner;
  const effectiveControlledAgentCommandRunnerMetadata = controlledCommandRunResultMetadata ?? controlledAgentCommandRunnerMetadata;
  const controlledAgentCommandRunTraceEntry = useMemo<CodingSessionTraceEntry | null>(() => createControlledAgentCommandRunTraceEntry(effectiveControlledAgentCommandRunnerMetadata), [effectiveControlledAgentCommandRunnerMetadata]);
  const controlledAgentRuntimeSessionMetadata = activeCaps?.controlledAgentRuntimeSession;
  const controlledAgentRuntimeSessionTraceEntry = useMemo<CodingSessionTraceEntry | null>(() => createControlledAgentRuntimeSessionTraceEntry(controlledAgentRuntimeSessionMetadata), [controlledAgentRuntimeSessionMetadata]);
  const codingSessionTraceWithCheckpointDecision = useMemo(() => {
    const entries = [
      ...codingSessionTrace,
      ...(controlledAgentFileReadTraceEntry ? [controlledAgentFileReadTraceEntry] : []),
      ...(controlledAgentCommandRunTraceEntry ? [controlledAgentCommandRunTraceEntry] : []),
      ...(controlledAgentRuntimeSessionTraceEntry ? [controlledAgentRuntimeSessionTraceEntry] : []),
    ];
    return agentRunCheckpointDecisionTraceEntry ? [...entries, agentRunCheckpointDecisionTraceEntry] : entries;
  }, [agentRunCheckpointDecisionTraceEntry, codingSessionTrace, controlledAgentCommandRunTraceEntry, controlledAgentFileReadTraceEntry, controlledAgentRuntimeSessionTraceEntry]);
  const codingTaskPromptDraft = useMemo(() => buildCodingTaskPrompt({ mode: "ask", goal: codingTaskGoal, contextItems: explicitContextBundleItems, providerReadiness: chatReadinessLabel }), [chatReadinessLabel, codingTaskGoal, explicitContextBundleItems]);
  const proposalHistory = useMemo(() => createProposalHistory(buildProposalHistoryEntries({
    modelProposalResult: agentRunModelProposal,
    editProposal: activeEditProposal,
    rejectedEditProposal: activeRejectedEditProposal,
    applyResult,
    verificationAttempt,
    planProposal: latestPlanProposal,
  })), [activeEditProposal, activeRejectedEditProposal, agentRunModelProposal, applyResult, latestPlanProposal, verificationAttempt]);
  const contextBudgetSummary = useMemo(() => buildContextBudgetSummary({
    goal: codingTaskGoal,
    activeFileExcerpt: currentActiveFileExcerpt,
    includeActiveFileExcerpt: includeAttachedContext,
    explicitContextItems: explicitContextBundleItems,
    includeExplicitContextBundle,
    proposalMetadata: [
      ...(modelProposalDraft ? [{ label: `Model proposal draft · ${modelProposalDraft.goalSummary}`, charCount: modelProposalDraft.prompt.length, itemCount: 1 }] : []),
      ...(activeEditProposal ? [{ label: `Edit proposal metadata · ${activeEditProposal.payload.summary}`, charCount: activeEditProposal.payload.summary.length, itemCount: activeEditProposal.payload.edits.length }] : []),
    ],
  }), [activeEditProposal, codingTaskGoal, currentActiveFileExcerpt, explicitContextBundleItems, includeAttachedContext, includeExplicitContextBundle, modelProposalDraft]);
  const controlledRunContextSelection = useMemo(() => buildControlledRunContextSelection(explicitContextBundleItems, bridgeHost), [bridgeHost, explicitContextBundleItems]);
  const showControlledRunContextSelector = explicitContextBundleItems.length > 0;
  const codingTaskSessionBase = useMemo(() => createCodingTaskSessionSnapshot({
    goal: codingTaskGoal,
    contextItems: explicitContextBundleItems,
    memoryItems: attachedProjectMemoryItems,
    agentRun: agentRunInput,
    traceEntries: codingSessionTraceWithCheckpointDecision,
    checkpointDecision: agentRunCheckpointDecision,
    proposalHistory,
    diagnostics: [
      ...(activeRejectedEditProposal ? [`edit proposal rejected: ${activeRejectedEditProposal.diagnostic.reasonCode}`] : []),
      ...(activeRejectedIdeActionProposal ? [`IDE action proposal rejected: ${activeRejectedIdeActionProposal.diagnostic.reasonCode}`] : []),
    ],
  }), [activeRejectedEditProposal, activeRejectedIdeActionProposal, agentRunInput, attachedProjectMemoryItems, codingSessionTraceWithCheckpointDecision, agentRunCheckpointDecision, codingTaskGoal, explicitContextBundleItems, proposalHistory]);
  const taskMemorySuggestions = useMemo(() => suggestTaskMemory({
    taskGoalLabel: codingTaskSessionBase.goal.label,
    sessionLabel: createSessionMemoryLabel(undefined, chatId),
    explicitContextLabels: codingTaskSessionBase.context.labels,
    proposalFileLabels: proposalHistory.entries.flatMap((entry) => entry.touchedFiles ?? []),
    attachedMemoryNoteIds: Array.from(attachedProjectMemoryNoteIds),
    projectMemoryNotes: projectMemory.notes,
  }), [attachedProjectMemoryNoteIds, chatId, codingTaskSessionBase.context.labels, codingTaskSessionBase.goal.label, projectMemory.notes, proposalHistory.entries]);
  const codingTaskSession = useMemo(() => createCodingTaskSessionSnapshot({
    goal: codingTaskGoal,
    contextItems: explicitContextBundleItems,
    memoryItems: attachedProjectMemoryItems,
    memorySuggestions: taskMemorySuggestions,
    agentRun: agentRunInput,
    traceEntries: codingSessionTraceWithCheckpointDecision,
    checkpointDecision: agentRunCheckpointDecision,
    proposalHistory,
    diagnostics: [
      ...(activeRejectedEditProposal ? [`edit proposal rejected: ${activeRejectedEditProposal.diagnostic.reasonCode}`] : []),
      ...(activeRejectedIdeActionProposal ? [`IDE action proposal rejected: ${activeRejectedIdeActionProposal.diagnostic.reasonCode}`] : []),
    ],
  }), [activeRejectedEditProposal, activeRejectedIdeActionProposal, agentRunInput, attachedProjectMemoryItems, codingSessionTraceWithCheckpointDecision, agentRunCheckpointDecision, codingTaskGoal, explicitContextBundleItems, proposalHistory, taskMemorySuggestions]);
  const multiStepTaskTimelineInput = useMemo(() => ({
    goal: codingTaskGoal,
    contextItems: explicitContextBundleItems,
    memoryItems: attachedProjectMemoryItems,
    memorySuggestions: taskMemorySuggestions,
    agentRun: agentRunInput,
    traceEntries: codingSessionTraceWithCheckpointDecision,
    checkpointDecision: agentRunCheckpointDecision,
    proposalHistory,
    planPreview: agentRunInput?.planPreview,
    followupDraft: agentRunVerificationFixDraft?.metadata,
    diagnostics: [
      ...(activeRejectedEditProposal ? [`edit proposal rejected: ${activeRejectedEditProposal.diagnostic.reasonCode}`] : []),
      ...(activeRejectedIdeActionProposal ? [`IDE action proposal rejected: ${activeRejectedIdeActionProposal.diagnostic.reasonCode}`] : []),
    ],
  }), [activeRejectedEditProposal, activeRejectedIdeActionProposal, agentRunInput, agentRunVerificationFixDraft, attachedProjectMemoryItems, codingSessionTraceWithCheckpointDecision, agentRunCheckpointDecision, codingTaskGoal, explicitContextBundleItems, proposalHistory, taskMemorySuggestions]);
  const controlledWorkspaceReadinessMetadata = activeCaps?.controlledAgentWorkspaceReadiness;
  const controlledAgentEditExecutorMetadata = activeCaps?.controlledAgentEditExecutor;
  const controlledAgentPatchPlanMetadata = activeCaps?.controlledAgentPatchPlan;
  const controlledAgentMultifilePatchPlanMetadata = activeCaps?.controlledAgentMultifilePatchPlan;
  const controlledAgentMultifileApplyMetadata = activeCaps?.controlledAgentMultifileApply;
  const controlledAgentPatchPlanPreview = useMemo(() => controlledAgentPatchPlanMetadata === undefined ? undefined : evaluateControlledAgentPatchPlanPreview(controlledAgentPatchPlanMetadata), [controlledAgentPatchPlanMetadata]);
  const controlledAgentMultifilePatchPlanPreview = useMemo(() => controlledAgentMultifilePatchPlanMetadata === undefined ? undefined : evaluateControlledAgentMultifilePatchPlan(controlledAgentMultifilePatchPlanMetadata), [controlledAgentMultifilePatchPlanMetadata]);
  const controlledPatchPlanConfirmationKey = controlledAgentPatchPlanPreview?.state === "ready" ? `${controlledAgentPatchPlanPreview.preview.planId}:${controlledAgentPatchPlanPreview.preview.rows.map((row) => `${row.workspaceRelativePath}:${row.lineRangeLabel}:${row.expectedContentHashLabel}`).join("|")}` : controlledAgentPatchPlanPreview?.state ?? "none";
  const controlledAgentFileReadRequest = useMemo(() => buildControlledAgentFileReadRequest({
    host: bridgeHost,
    runtimeSessionMetadata: controlledAgentRuntimeSessionMetadata,
    workspaceReadinessMetadata: controlledWorkspaceReadinessMetadata,
    workspaceRelativePath: "docs/architecture/013-agent-readiness-milestone.md",
    requestSeed: "panel",
    jetbrainsFileReadSupported: false,
  }), [bridgeHost, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata]);
  const oneStepControlledAgentFileReadRequest = useMemo(() => buildControlledAgentFileReadRequest({
    host: bridgeHost,
    runtimeSessionMetadata: controlledAgentRuntimeSessionMetadata,
    workspaceReadinessMetadata: controlledWorkspaceReadinessMetadata,
    workspaceRelativePath: "docs/architecture/013-agent-readiness-milestone.md",
    requestSeed: "s86-one-step",
    jetbrainsFileReadSupported: false,
  }), [bridgeHost, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata]);
  const effectiveControlledEditMetadata = controlledEditResultMetadata ?? controlledAgentEditExecutorMetadata;
  const controlledAgentEditRequest = useMemo(() => buildControlledAgentEditRequest({
    host: bridgeHost,
    runtimeSessionMetadata: controlledAgentRuntimeSessionMetadata,
    workspaceReadinessMetadata: controlledWorkspaceReadinessMetadata,
    plannedEditMetadata: controlledAgentEditExecutorMetadata,
    requestSeed: "panel",
    jetbrainsEditSupported: false,
  }), [bridgeHost, controlledAgentEditExecutorMetadata, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata]);
  const oneStepControlledAgentEditRequest = useMemo(() => buildControlledAgentEditRequest({
    host: bridgeHost,
    runtimeSessionMetadata: controlledAgentRuntimeSessionMetadata,
    workspaceReadinessMetadata: controlledWorkspaceReadinessMetadata,
    plannedEditMetadata: oneStepEditMetadata(controlledAgentEditExecutorMetadata, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata),
    requestSeed: "s86-one-step",
    jetbrainsEditSupported: false,
  }), [bridgeHost, controlledAgentEditExecutorMetadata, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata]);
  const controlledAgentVerificationCommandId = agentRunInput?.boundedLoop && isRecord(agentRunInput.boundedLoop) ? verificationCommandIdOrUndefined(isRecord(agentRunInput.boundedLoop.verification) ? agentRunInput.boundedLoop.verification.commandId : undefined) : undefined;
  const controlledAgentCommandRunRequest = useMemo(() => buildControlledAgentCommandRunRequest({
    host: bridgeHost,
    runtimeSessionMetadata: controlledAgentRuntimeSessionMetadata,
    workspaceReadinessMetadata: controlledWorkspaceReadinessMetadata,
    plannedCommandRunMetadata: {
      runId: agentRunInput ? agentRunRunId(agentRunInput) : undefined,
      workspaceReadinessId: isRecord(controlledWorkspaceReadinessMetadata) && isRecord(controlledWorkspaceReadinessMetadata.isolation) ? controlledWorkspaceReadinessMetadata.isolation.readinessId : undefined,
      commandId: controlledAgentVerificationCommandId,
      userConfirmed: true,
    },
    commandId: controlledAgentVerificationCommandId,
    userConfirmed: true,
    requestSeed: agentRunInput?.applyRequest?.requestId ?? agentRunInput?.proposal?.id ?? "agent-run-verification",
  }), [agentRunInput, bridgeHost, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata, controlledAgentVerificationCommandId]);
  const controlledAgentLexicalSearchRequest = useMemo(() => buildControlledAgentLexicalSearchRequest({
    host: bridgeHost,
    runtimeSessionMetadata: controlledAgentRuntimeSessionMetadata,
    workspaceReadinessMetadata: controlledWorkspaceReadinessMetadata,
    query: "Agent Run",
    includePathLabels: ["apps/gui/src/App.tsx", "apps/gui/src/components/AgentRunPanel.tsx"],
    explicitUserGesture: true,
    userGestureId: "agent-run-controlled-search-button",
    requestSeed: "agent-run-controlled-search",
  }), [bridgeHost, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata]);
  const controlledAgentVerificationBundleRequest = useMemo(() => buildControlledAgentVerificationBundleRequest({
    host: bridgeHost,
    bundleMetadata: controlledAgentVerificationBundleMetadata,
    userConfirmed: true,
    requestSeed: "s117-verification-bundle",
  }), [bridgeHost, controlledAgentVerificationBundleMetadata]);
  const controlledAgentMultifileApplyRequest = useMemo(() => buildControlledAgentMultifileApplyRequest({
    host: bridgeHost,
    patchPlanMetadata: controlledAgentMultifilePatchPlanMetadata,
    userConfirmed: controlledMultifileApplyConfirmed,
    requestSeed: "agent-run-multifile-apply",
    runtimeSessionId: isRecord(controlledAgentRuntimeSessionMetadata) ? stringOrUndefined(controlledAgentRuntimeSessionMetadata.sessionId) : undefined,
    workspaceReadinessId: isRecord(controlledWorkspaceReadinessMetadata) && isRecord(controlledWorkspaceReadinessMetadata.isolation) ? stringOrUndefined(controlledWorkspaceReadinessMetadata.isolation.readinessId) : undefined,
    replacementContentHashes: isRecord(controlledAgentMultifileApplyMetadata) && isRecord(controlledAgentMultifileApplyMetadata.replacementContentHashes) ? controlledAgentMultifileApplyMetadata.replacementContentHashes as Record<string, string> : undefined,
    reviewedReplacementTexts: isRecord(controlledAgentMultifileApplyMetadata) && isRecord(controlledAgentMultifileApplyMetadata.reviewedReplacementTexts) ? controlledAgentMultifileApplyMetadata.reviewedReplacementTexts as Record<string, string> : undefined,
  }), [bridgeHost, controlledAgentMultifileApplyMetadata, controlledAgentMultifilePatchPlanMetadata, controlledAgentRuntimeSessionMetadata, controlledMultifileApplyConfirmed, controlledWorkspaceReadinessMetadata]);
  const controlledSearchSelection = useMemo<ControlledAgentSearchSelectionResult | undefined>(() => {
    if (!controlledLexicalSearchResult || !controlledLexicalSearchResultId || selectedControlledSearchResultIds.length === 0) {
      return undefined;
    }
    return createControlledAgentSearchSelection({
      searchResultId: controlledLexicalSearchResultId,
      lexicalSearch: controlledLexicalSearchResult,
      selectedResultIds: selectedControlledSearchResultIds,
      explicitUserGesture: true,
      userGestureId: "agent-run-controlled-search-selection",
      selectionMintedBy: "user",
      assistantMinted: false,
    });
  }, [controlledLexicalSearchResult, controlledLexicalSearchResultId, selectedControlledSearchResultIds]);
  const oneStepControlledAgentCommandRunRequest = useMemo(() => buildControlledAgentCommandRunRequest({
    host: bridgeHost,
    runtimeSessionMetadata: controlledAgentRuntimeSessionMetadata,
    workspaceReadinessMetadata: controlledWorkspaceReadinessMetadata,
    plannedCommandRunMetadata: {
      runId: oneStepControlledAgentEditRequest.correlation?.runId,
      workspaceReadinessId: oneStepControlledAgentEditRequest.correlation?.workspaceReadinessId,
      commandId: "repository-check",
      userConfirmed: true,
    },
    commandId: "repository-check",
    userConfirmed: true,
    requestSeed: "s86-one-step",
  }), [bridgeHost, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata, oneStepControlledAgentEditRequest.correlation?.runId, oneStepControlledAgentEditRequest.correlation?.workspaceReadinessId]);
  oneStepFileReadRequestRef.current = oneStepControlledAgentFileReadRequest;
  oneStepEditRequestRef.current = oneStepControlledAgentEditRequest;
  oneStepCommandRunRequestRef.current = oneStepControlledAgentCommandRunRequest;
  const showWhatWillBeSentPanel = chatInput.trim().length > 0 || contextBudgetSummary.sources.some((source) => source.itemCount > 0 || source.charCount > 0) || contextBudgetSummary.omittedItemCount > 0 || contextBudgetSummary.excludedItemCount > 0 || contextBudgetSummary.warnings.length > 0;
  const [controlledAgentRunState, setControlledAgentRunState] = useState<ControlledAgentRunState>(() => initializeControlledAgentRunState(undefined));
  const showControlledAgentRunPanel = controlledWorkspaceReadinessMetadata !== undefined || effectiveControlledAgentFileReadMetadata !== undefined || effectiveControlledAgentCommandRunnerMetadata !== undefined || controlledAgentEditExecutorMetadata !== undefined || controlledAgentRuntimeSessionMetadata !== undefined || controlledAgentTwoStepRunMetadata !== undefined;
  const hasOneStepControlledMetadata = controlledWorkspaceReadinessMetadata !== undefined || controlledAgentRuntimeSessionMetadata !== undefined || controlledAgentEditExecutorMetadata !== undefined;
  const showOneStepAgentRunPanel = oneStepLoopState.phase !== "idle" || (bridgeHost === "vscode" && oneStepControlledAgentFileReadRequest.state === "ready" && oneStepControlledAgentEditRequest.state === "ready" && oneStepControlledAgentCommandRunRequest.state === "ready") || (hasOneStepControlledMetadata && (oneStepControlledAgentFileReadRequest.state === "unsupported" || oneStepControlledAgentEditRequest.state === "unsupported" || oneStepControlledAgentCommandRunRequest.state === "unsupported"));
  const controlledAgentProgressReport = useMemo(() => buildControlledAgentProgressReport({
    runState: controlledAgentRunState,
    controlledAgentFileRead: effectiveControlledAgentFileReadMetadata,
    controlledAgentCommandRunner: effectiveControlledAgentCommandRunnerMetadata,
    controlledAgentEditExecutor: controlledAgentEditExecutorMetadata,
  }), [effectiveControlledAgentCommandRunnerMetadata, controlledAgentEditExecutorMetadata, effectiveControlledAgentFileReadMetadata, controlledAgentRunState]);
  const controlledLocalAgentMvpReport = useMemo(() => buildControlledLocalAgentMvp({
    userOptIn: { source: "user", confirmed: true, requestId: "s80-controlled-local-agent-mvp-preview" },
    workspaceReadiness: controlledWorkspaceReadinessMetadata,
    boundedRead: effectiveControlledAgentFileReadMetadata,
    editMetadata: controlledAgentEditExecutorMetadata,
    verification: effectiveControlledAgentCommandRunnerMetadata,
    runtimeSession: controlledAgentRuntimeSessionMetadata,
    progress: controlledAgentProgressReport,
  }), [effectiveControlledAgentCommandRunnerMetadata, controlledAgentEditExecutorMetadata, effectiveControlledAgentFileReadMetadata, controlledAgentProgressReport, controlledAgentRuntimeSessionMetadata, controlledWorkspaceReadinessMetadata]);

  useEffect(() => {
    if (controlledAgentRunState.phase === "idle" && oneStepLoopState.phase === "idle") {
      return;
    }
    if (!showControlledAgentRunPanel && !showOneStepAgentRunPanel) {
      return;
    }
    const item = createControlledRunHistoryItem({
      runId: oneStepLoopState.correlation.runId ?? `controlled-run-${controlledAgentRunState.phase}`,
      hostLabel: controlledRunHistoryHostLabel(bridgeHost),
      readinessLabels: controlledRunHistoryReadinessLabels(controlledAgentRunState, oneStepLoopState),
      phaseLabel: controlledRunHistoryPhaseLabel(controlledAgentRunState, oneStepLoopState),
      resultLabel: controlledRunHistoryResultLabel(controlledAgentRunState, oneStepLoopState),
      counters: controlledRunHistoryCounters(controlledAgentRunState, oneStepLoopState),
      summaryLabels: [controlledAgentRunState.summary, oneStepLoopState.summary],
      artifactLabels: controlledRunHistoryArtifactLabels(controlledAgentRunState, oneStepLoopState),
      checksumLabels: controlledRunHistoryChecksumLabels(controlledAgentRunState, oneStepLoopState),
    });
    setControlledRunHistory((current) => appendControlledRunHistoryItem(current.filter((existing) => existing.runId !== item.runId), item, 8));
  }, [bridgeHost, controlledAgentRunState, oneStepLoopState, showControlledAgentRunPanel, showOneStepAgentRunPanel]);

  useEffect(() => {
    setControlledAgentRunState(buildControlledAgentRunPreviewState(controlledWorkspaceReadinessMetadata, effectiveControlledAgentFileReadMetadata, controlledAgentCommandRunnerMetadata));
  }, [controlledAgentCommandRunnerMetadata, effectiveControlledAgentFileReadMetadata, controlledWorkspaceReadinessMetadata]);

  useEffect(() => {
    setControlledPatchPlanConfirmed(false);
  }, [controlledPatchPlanConfirmationKey]);

  const workspaceSnippetQueryValidation = useMemo(() => validateWorkspaceSnippetQuery(workspaceSnippetQuery), [workspaceSnippetQuery]);

  useEffect(() => {
    setRuntimeDetailsOpen(!runtimeConnected);
  }, [runtimeConnected]);

  useEffect(() => {
    setWorkspaceSnippetResult(null);
    setSelectedWorkspaceSnippetKeys([]);
    setWorkspaceSnippetStatus(null);
  }, [chatId, settingsRevision]);

  useEffect(() => {
    setProviderDetailsOpen(!canSendChat);
  }, [canSendChat]);

  useEffect(() => () => {
    if (providerSetupHighlightTimerRef.current !== null) {
      window.clearTimeout(providerSetupHighlightTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (providerSetupFocusRequest === 0) {
      return;
    }
    providerSetupCardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    providerApiKeyInputRef.current?.focus({ preventScroll: true });
  }, [providerSetupFocusRequest]);

  useEffect(() => {
    setRuntimeFetchTraceConnectionSource(runtimeConnectionSource);
  }, [runtimeConnectionSource]);

  const addTimeline = useCallback((entry: string) => {
    setTimeline((current) => [entry, ...current].slice(0, 80));
  }, []);

  const appendTrace = useCallback((draft: CodingSessionTraceDraft) => {
    setCodingSessionTrace((current) => appendCodingSessionTraceEntry(current, draft));
  }, []);

  useEffect(() => {
    setRuntimeFetchTraceSink((event) => {
      appendTrace({
        family: event.type,
        title: event.type === "runtime.fetch.start" ? "Runtime fetch started" : "Runtime fetch failed",
        status: event.type === "runtime.fetch.start" ? "pending" : "failed",
        summary: event.type === "runtime.fetch.start" ? "Runtime request metadata recorded." : "Runtime request failure metadata recorded.",
        details: event,
      });
    });
    return () => setRuntimeFetchTraceSink(null);
  }, [appendTrace]);

  const clearExplicitContextBundle = useCallback((status: string | null = null) => {
    setExplicitContextBundleItems([]);
    setIncludeExplicitContextBundle(true);
    setIncludeControlledRunContext(true);
    setExplicitContextBundleStatus(status);
    setAttachedVerificationKey(null);
  }, []);

  const clearEditProposalState = useCallback(() => {
    editProposalIdentityRef.current = null;
    pendingApplyRequestIdRef.current = null;
    editProposalRejectedTraceKeyRef.current = null;
    agentRunApplyCorrelationRef.current = null;
    agentRunApplyChatIdRef.current = null;
    agentRunVerificationCorrelationRef.current = null;
    agentRunVerificationChatIdRef.current = null;
    pendingApplyProposalRequestIdRef.current = null;
    completedApplyRequestChatsRef.current.clear();
    setEditProposal(null);
    setApplyResult(null);
    setAgentRunApplyRequest(null);
    setAgentRunVerificationRequest(null);
    setAgentRunVerificationProgress(null);
    agentRunVerificationResultRef.current = null;
    setAgentRunVerificationResult(null);
    setAgentRunVerificationFixDraft(null);
    setApplyNote(null);
    setPendingApplyRequestId(null);
  }, []);

  const clearModelProposalState = useCallback(() => {
    setModelProposalDraft(null);
    setSubmittedModelProposalPrompt(null);
    setAdoptedProviderProposalState(undefined);
  }, []);

  const clearIdeActionState = useCallback(() => {
    pendingIdeActionRequestIdRef.current = null;
    pendingIdeActionChatIdRef.current = null;
    completedIdeActionRequestChatsRef.current.clear();
    ideActionProposalIdentityRef.current = null;
    setIdeActionProposal(null);
    setIdeActionAttempt(null);
    setIdeActionNote(null);
  }, []);

  const clearControlledFileReadState = useCallback((note: string | null = null) => {
    controlledFileReadCorrelationRef.current = null;
    controlledFileReadCompletedRequestIdRef.current = null;
    oneStepFileReadRequestIdRef.current = null;
    setPendingControlledFileReadRequestId(null);
    setControlledFileReadResultMetadata(null);
    setControlledFileReadNote(note);
  }, []);

  const clearControlledEditState = useCallback((note: string | null = null) => {
    controlledEditCorrelationRef.current = null;
    controlledEditCompletedRequestIdRef.current = null;
    oneStepEditRequestIdRef.current = null;
    setPendingControlledEditRequestId(null);
    setControlledEditResultMetadata(null);
    setControlledEditNote(note);
    setControlledPatchPlanConfirmed(false);
  }, []);

  const clearControlledMultifileApplyState = useCallback((note: string | null = null) => {
    controlledMultifileApplyCorrelationRef.current = null;
    controlledMultifileApplyCompletedRequestIdRef.current = null;
    setPendingControlledMultifileApplyRequestId(null);
    setControlledMultifileApplyResult(undefined);
    setControlledMultifileApplyNote(note);
    setControlledMultifileApplyConfirmed(false);
  }, []);

  const clearControlledCommandRunState = useCallback((note: string | null = null) => {
    controlledCommandRunCorrelationRef.current = null;
    controlledCommandRunCompletedRequestIdRef.current = null;
    oneStepCommandRunRequestIdRef.current = null;
    agentRunVerificationCorrelationRef.current = null;
    agentRunVerificationChatIdRef.current = null;
    setPendingControlledCommandRunRequestId(null);
    setControlledCommandRunResultMetadata(null);
    setControlledCommandRunNote(note);
  }, []);

  const stopPendingControlledCommandRunState = useCallback((note: string) => {
    controlledCommandRunCorrelationRef.current = null;
    controlledCommandRunCompletedRequestIdRef.current = null;
    oneStepCommandRunRequestIdRef.current = null;
    agentRunVerificationCorrelationRef.current = null;
    agentRunVerificationChatIdRef.current = null;
    setPendingControlledCommandRunRequestId(null);
    setAgentRunVerificationRequest(null);
    setAgentRunVerificationProgress(null);
    agentRunVerificationResultRef.current = null;
    setAgentRunVerificationResult(null);
    setAgentRunVerificationFixDraft(null);
    setControlledCommandRunNote(note);
  }, []);

  const stopControlledAgentRun = useCallback(() => {
    stopPendingControlledCommandRunState("Controlled Agent Run verification stopped in the GUI. Stale host results will be ignored.");
    setOneStepLoopState((current) => current.phase === "idle" || current.phase === "completed" || current.phase === "failed" || current.phase === "stopped" ? current : reduceControlledOneStepAgentLoopState(current, { type: "stop", summary: "One-step run stopped in the GUI. Stale host results will be ignored." }));
    setControlledAgentRunState((current) => reduceControlledAgentRunState(current, { type: "stop", reason: "user_stop", summary: "Controlled run stopped from the S76 skeleton UI." }));
  }, [stopPendingControlledCommandRunState]);

  const clearPendingIdeActionState = useCallback(() => {
    if (!pendingIdeActionRequestIdRef.current) {
      return;
    }
    pendingIdeActionRequestIdRef.current = null;
    pendingIdeActionChatIdRef.current = null;
    setIdeActionAttempt(null);
    setIdeActionNote("Cleared pending IDE action state in the GUI only. No host-side cancellation was requested.");
  }, []);

  const clearPendingControlledFileReadState = useCallback(() => {
    if (!controlledFileReadCorrelationRef.current) {
      return;
    }
    controlledFileReadCorrelationRef.current = null;
    oneStepFileReadRequestIdRef.current = null;
    setPendingControlledFileReadRequestId(null);
    setControlledFileReadNote("Cleared pending controlled read state in the GUI only. No host-side cancellation was requested.");
  }, []);

  const clearPendingControlledEditState = useCallback(() => {
    if (!controlledEditCorrelationRef.current) {
      return;
    }
    controlledEditCorrelationRef.current = null;
    oneStepEditRequestIdRef.current = null;
    setPendingControlledEditRequestId(null);
    setControlledEditNote("Cleared pending controlled edit state in the GUI only. No host-side cancellation was requested.");
  }, []);

  const clearPendingControlledCommandRunState = useCallback(() => {
    if (!controlledCommandRunCorrelationRef.current) {
      return;
    }
    controlledCommandRunCorrelationRef.current = null;
    oneStepCommandRunRequestIdRef.current = null;
    agentRunVerificationCorrelationRef.current = null;
    agentRunVerificationChatIdRef.current = null;
    setPendingControlledCommandRunRequestId(null);
    setControlledCommandRunNote("Cleared pending controlled verification state in the GUI only. No host-side cancellation was requested.");
  }, []);

  const abortActiveStream = useCallback((timelineMessage: string, options: AbortActiveStreamOptions = {}) => {
    const { finalizeStreaming = true, addTimelineEntry = true, reportAbortErrors = true } = options;
    const activeStream = activeStreamRef.current;
    if (!activeStream) {
      return null;
    }
    activeStream.controller.abort();
    activeStreamRef.current = null;
    if (finalizeStreaming) {
      setChatView((current) => stopStreamingAssistant(current));
    }
    setChatLifecycleState("stopped");
    void sendAbort(activeStream.settings, activeStream.chatId).then((result) => {
      if (reportAbortErrors && !result.ok) {
        addTimeline(`Abort command error: ${sanitizeDisplayText(result.error.message)}`);
      }
    });
    if (addTimelineEntry) {
      addTimeline(timelineMessage);
    }
    return activeStream;
  }, [addTimeline]);

  const markSettingsChanged = useCallback(() => {
    abortActiveStream("SSE stopped and abort requested for previous runtime settings");
    setChatLifecycleState("idle");
    settingsRevisionRef.current += 1;
    providerTestAttemptRef.current += 1;
    setSettingsRevision(settingsRevisionRef.current);
    setRuntimeDataRevision(null);
    setProviderDataRevision(null);
    setProviderAuthDataRevision(null);
    setDemoModeDataRevision(null);
    setDemoModeWorking(false);
    chatHistoryAttemptRef.current += 1;
    setChatHistoryRevision(null);
    setChatSummaries([]);
    setChatHistoryError(null);
    setChatHistoryLoading(false);
    setDeletingChatId(null);
    setRuntimeRefreshStatus({
      state: "checking",
      attempt: runtimeRefreshAttemptRef.current + 1,
      checkedAt: new Date().toLocaleTimeString(),
      detail: "Runtime settings changed; checking current runtime…",
    });
    setRuntimeLifecycle(null);
    providerAuthMutationAttemptRef.current += 1;
    providerAuthExchangeInFlightRef.current = false;
    setProviderAuthMutation(null);
    setProviderAuthExchangeCode("");
    setProviderAuthExchangeWorking(false);
    setProviderAuthExchangeError(null);
    setProviderTestState(null);
    agentProgressAttemptRef.current += 1;
    setAgentProgress({ state: "not_checked", response: null, error: null });
    setAttachedContext(null);
    setIncludeAttachedContext(false);
    setAttachedContextAcknowledged(false);
    setAttachedContextStatus(null);
    clearExplicitContextBundle(null);
    clearEditProposalState();
    clearModelProposalState();
    clearIdeActionState();
    clearControlledFileReadState(null);
    clearControlledEditState(null);
    clearControlledCommandRunState(null);
  }, [abortActiveStream, clearEditProposalState, clearExplicitContextBundle, clearModelProposalState, clearIdeActionState, clearControlledFileReadState, clearControlledEditState, clearControlledCommandRunState]);

  const updateRuntimeSettings = useCallback((nextSettings: RuntimeSettings) => {
    const normalizedSettings: RuntimeSettings = { ...nextSettings, token: nextSettings.token ?? "", runtimeAccess: nextSettings.runtimeAccess ?? "direct" };
    const changed = settingsRef.current.baseUrl !== normalizedSettings.baseUrl || settingsRef.current.token !== normalizedSettings.token || settingsRef.current.runtimeAccess !== normalizedSettings.runtimeAccess;
    if (changed) {
      settingsRef.current = normalizedSettings;
      markSettingsChanged();
    }
    setBaseUrl(normalizedSettings.baseUrl);
    setToken(normalizedSettings.token);
    setRuntimeAccess(normalizedSettings.runtimeAccess);
    return changed;
  }, [markSettingsChanged]);

  const updateBaseUrl = useCallback((nextBaseUrl: string) => {
    hostReadyAppliedRef.current = false;
    preHostRuntimeRefreshRequestedAtRef.current = null;
    setRuntimeConnectionSource("manual");
    updateRuntimeSettings({ ...settingsRef.current, baseUrl: nextBaseUrl, runtimeAccess: "direct" });
  }, [updateRuntimeSettings]);

  const updateToken = useCallback((nextToken: string) => {
    hostReadyAppliedRef.current = false;
    preHostRuntimeRefreshRequestedAtRef.current = null;
    setRuntimeConnectionSource("manual");
    updateRuntimeSettings({ ...settingsRef.current, token: nextToken, runtimeAccess: "direct" });
  }, [updateRuntimeSettings]);

  const applyHostReady = useCallback((payload: HostReadyPayload | undefined) => {
    if (!payload) {
      return;
    }
    const readyPayload = payload;
    const hostRuntimeUrl = readyPayload.runtimeProxyBaseUrl ?? readyPayload.runtimeUrl;
    if (!hostRuntimeUrl || !isLoopbackRuntimeUrl(hostRuntimeUrl)) {
      return;
    }
    const proxyMode = Boolean(readyPayload.runtimeProxyBaseUrl);
    setControlledHostCapabilities(readyPayload.controlledCapabilities);
    if (!proxyMode && settingsRef.current.runtimeAccess === "same_origin_proxy") {
      return;
    }
    const currentBaseUrl = settingsRef.current.baseUrl;
    const nextToken = proxyMode
      ? ""
      : readyPayload.sessionToken
      ? readyPayload.sessionToken
      : normalizeRuntimeUrl(hostRuntimeUrl) !== normalizeRuntimeUrl(currentBaseUrl)
        ? ""
        : settingsRef.current.token;
    const wasHostReadyApplied = hostReadyAppliedRef.current;
    hostReadyAppliedRef.current = true;
    preHostRuntimeRefreshRequestedAtRef.current = null;
    setRuntimeConnectionSource("host.ready");
    const changed = updateRuntimeSettings({ baseUrl: hostRuntimeUrl, token: nextToken, runtimeAccess: proxyMode ? "same_origin_proxy" : "direct" });
    appendTrace({
      family: "runtime.settings.applied",
      title: "Runtime settings applied",
      status: "succeeded",
      summary: "Trusted host runtime settings applied; token value remains hidden in memory.",
      details: { connectionSource: "host.ready", runtimeOrigin: runtimeOriginLabel(hostRuntimeUrl), tokenState: nextToken ? "present" : "absent" },
    });
    if (changed || !wasHostReadyApplied) {
      runtimeRefreshQueuedRef.current = true;
      setHostReadyRefreshNonce((current) => current + 1);
    }
    setTimeline((current) => ["Host runtime settings received", ...current].slice(0, 80));
    appendTrace({
      family: "host.ready",
      title: "Host runtime settings received",
      status: "info",
      summary: "IDE host supplied loopback runtime settings; token value remains hidden in memory.",
      details: { hasSessionToken: Boolean(readyPayload.sessionToken), runtimeUrl: hostRuntimeUrl },
    });
  }, [appendTrace, updateRuntimeSettings]);

  useEffect(() => {
    const adapter = createBridgeAdapter((entry) => setBridgeLog((current) => [entry, ...current].slice(0, 20)));
    bridgeAdapterRef.current = adapter;
    setBridgeHost(adapter.host);
    adapter.subscribe((message) => {
      if (message.type === "host.ready") {
        applyHostReady(message.payload as HostReadyPayload | undefined);
      } else if (message.type === "host.runtimeStatus") {
        const payload = message.payload as HostRuntimeStatusPayload;
        const revision = settingsRevisionRef.current;
        setRuntimeLifecycle({ diagnostics: runtimeLifecycleDiagnostics(payload, adapter.host), settingsRevision: revision });
        setTimeline((current) => [`Runtime lifecycle status received: ${payload.lifecycle}`, ...current].slice(0, 80));
        appendTrace({ family: "host.runtimeStatus", title: "Runtime lifecycle status received", status: payload.lifecycle === "connected" ? "succeeded" : payload.lifecycle === "failed" || payload.lifecycle === "auth_mismatch" ? "failed" : "info", summary: `Host reported runtime ${payload.lifecycle}.`, details: { lifecycle: payload.lifecycle, tokenState: payload.tokenState, authority: payload.authority } });
        if (payload.lifecycle === "disconnected" || payload.lifecycle === "stopped" || payload.lifecycle === "failed" || payload.lifecycle === "auth_mismatch") {
          controlledFileReadCorrelationRef.current = null;
          controlledEditCorrelationRef.current = null;
          oneStepFileReadRequestIdRef.current = null;
          oneStepEditRequestIdRef.current = null;
          setRuntimeDataRevision(null);
          setProviderDataRevision(null);
          setProviderAuthDataRevision(null);
          providerAuthExchangeInFlightRef.current = false;
          setProviderAuthExchangeWorking(false);
          setProviderAuthExchangeCode("");
          setProviderAuthExchangeError(null);
          setDemoModeDataRevision(null);
          stopPendingControlledCommandRunState("Runtime disconnected or blocked controlled verification. Stale host results will be ignored; no auto-retry was started.");
          setPendingControlledFileReadRequestId(null);
          setPendingControlledEditRequestId(null);
          setOneStepLoopState((current) => current.phase === "idle" || current.phase === "completed" || current.phase === "failed" || current.phase === "stopped" ? current : reduceControlledOneStepAgentLoopState(current, { type: "runtime_disconnect", summary: "One-step run stopped because runtime lifecycle became unavailable." }));
          setControlledAgentRunState((current) => reduceControlledAgentRunState(current, { type: "stop", reason: "partial_execution_stopped", summary: "Controlled run stopped because runtime lifecycle became unavailable." }));
        }
      } else if (message.type === "host.controlledAgentLexicalSearchResult") {
        const current = controlledLexicalSearchCorrelationRef.current;
        if (!current) {
          return;
        }
        const correlation = correlateControlledAgentLexicalSearchResult({ current, hostMessage: message, existingResult: controlledLexicalSearchResult });
        controlledLexicalSearchCorrelationRef.current = null;
        if (correlation.state === "accepted" && correlation.lexicalSearch) {
          setControlledLexicalSearchResult(correlation.lexicalSearch);
          setControlledLexicalSearchResultId(current.requestId);
          setSelectedControlledSearchResultIds([]);
          appendTrace({ family: "controlledAgent.fileReadResult", title: "Controlled lexical search result accepted", status: "succeeded", summary: "Sanitized lexical search result metadata accepted for explicit user selection.", requestId: current.requestId, details: correlation.details });
        }
      } else if (message.type === "host.controlledAgentVerificationBundleResult") {
        const requestId = message.requestId ?? "unknown";
        const current = controlledVerificationBundleCorrelationRef.current;
        if (controlledVerificationBundleCompletedRequestIdRef.current === requestId) {
          setControlledVerificationBundleNote("Ignored duplicate verification bundle result.");
          return;
        }
        if (!current) {
          setControlledVerificationBundleNote("Ignored stale verification bundle result.");
          return;
        }
        const correlation = correlateControlledAgentVerificationBundleResult({ current, bundleResult: message.payload, existingResult: controlledVerificationBundleResult });
        if (correlation.state === "accepted" && correlation.bundle) {
          controlledVerificationBundleCompletedRequestIdRef.current = requestId;
          controlledVerificationBundleCorrelationRef.current = null;
          setPendingControlledVerificationBundleRequestId(null);
          setControlledVerificationBundleResult(correlation.bundle);
          setControlledVerificationBundleSourceResult(message.payload);
          setControlledVerificationBundleAcceptedCorrelation(current);
          setControlledVerificationFollowupDraft(null);
          setControlledVerificationBundleNote(`Verification bundle result accepted: ${correlation.bundle.status ?? "accepted"}.`);
          appendTrace({ family: "controlledAgent.verificationBundleResult", title: "Controlled verification bundle result received", status: correlation.bundle.status === "succeeded" ? "succeeded" : correlation.bundle.status === "running" ? "in_progress" : "failed", summary: "Sanitized sequence-aware verification bundle metadata accepted.", requestId, details: correlation.details });
          return;
        }
        if (correlation.state === "duplicate") {
          controlledVerificationBundleCorrelationRef.current = null;
          setPendingControlledVerificationBundleRequestId(null);
          setControlledVerificationBundleNote("Ignored duplicate verification bundle result.");
          return;
        }
        if (correlation.state === "ignored") {
          setControlledVerificationBundleNote("Ignored stale verification bundle result.");
          return;
        }
        controlledVerificationBundleCorrelationRef.current = null;
        setPendingControlledVerificationBundleRequestId(null);
        setControlledVerificationBundleNote(correlation.diagnostics[0]?.message ?? "Verification bundle result was blocked.");
      } else if (message.type === "host.controlledAgentMultifileApplyResult") {
        const requestId = message.requestId ?? "unknown";
        const current = controlledMultifileApplyCorrelationRef.current;
        if (controlledMultifileApplyCompletedRequestIdRef.current === requestId) {
          setControlledMultifileApplyNote("Ignored duplicate multi-file apply result.");
          return;
        }
        if (!current) {
          setControlledMultifileApplyNote("Ignored stale multi-file apply result.");
          return;
        }
        const correlation = correlateControlledAgentMultifileApplyResult({ current, hostMessage: message, existingResult: controlledMultifileApplyResult });
        if (correlation.state === "accepted" && correlation.summary) {
          controlledMultifileApplyCompletedRequestIdRef.current = requestId;
          controlledMultifileApplyCorrelationRef.current = null;
          setPendingControlledMultifileApplyRequestId(null);
          setControlledMultifileApplyResult(correlation.summary);
          setControlledMultifileApplyNote(`Multi-file apply result accepted: ${correlation.summary.state}.`);
          appendTrace({ family: correlation.summary.state === "applied" ? "controlledAgent.editResult" : "controlledAgent.editBlocked", title: "Controlled multi-file apply result received", status: correlation.summary.state === "applied" ? "succeeded" : "failed", summary: correlation.summary.message, requestId, details: correlation.details });
          return;
        }
        if (correlation.state === "duplicate") {
          controlledMultifileApplyCorrelationRef.current = null;
          setPendingControlledMultifileApplyRequestId(null);
          setControlledMultifileApplyNote("Ignored duplicate multi-file apply result.");
          return;
        }
        if (correlation.state === "ignored") {
          setControlledMultifileApplyNote("Ignored stale multi-file apply result.");
          return;
        }
        controlledMultifileApplyCorrelationRef.current = null;
        setPendingControlledMultifileApplyRequestId(null);
        setControlledMultifileApplyNote(correlation.diagnostics[0]?.message ?? "Multi-file apply result was blocked.");
      } else if (message.type === "host.controlledAgentFileReadResult") {
        const requestId = message.requestId ?? "unknown";
        const current = controlledFileReadCorrelationRef.current;
        if (controlledFileReadCompletedRequestIdRef.current === requestId) {
          setControlledFileReadNote("Ignored duplicate controlled read result.");
          return;
        }
        if (!current) {
          setControlledFileReadNote("Ignored stale controlled read result.");
          return;
        }
        const correlation = correlateControlledAgentFileReadResult({ current, hostMessage: message });
        const oneStepPendingRead = oneStepFileReadRequestIdRef.current === requestId;
        if (correlation.state === "accepted" && correlation.fileRead) {
          controlledFileReadCompletedRequestIdRef.current = requestId;
          controlledFileReadCorrelationRef.current = null;
          oneStepFileReadRequestIdRef.current = null;
          setPendingControlledFileReadRequestId(null);
          setControlledFileReadResultMetadata(message.payload);
          setControlledFileReadNote(`Controlled read result accepted: ${correlation.fileRead.state}.`);
          appendTrace({ family: correlation.fileRead.state === "blocked" ? "controlledAgent.fileReadBlocked" : "controlledAgent.fileReadResult", title: "Controlled file read result received", status: correlation.fileRead.state === "blocked" ? "failed" : "succeeded", summary: correlation.fileRead.summary, requestId, details: correlation.details });
          if (oneStepPendingRead) {
            setOneStepLoopState((currentLoop) => reduceControlledOneStepAgentLoopState(reduceControlledOneStepAgentLoopState(currentLoop, { type: "read", metadata: message.payload }), { type: "model_step", metadata: { state: "completed", stepCount: 1, sanitizedOnly: true, modelProposalAllowed: true, providerPayloadStored: false, providerResponseStored: false, summary: "Sanitized one-step proposal metadata recorded." } }));
            postOneStepEditRequest();
          }
          return;
        }
        if (correlation.state === "duplicate") {
          controlledFileReadCorrelationRef.current = null;
          oneStepFileReadRequestIdRef.current = null;
          setPendingControlledFileReadRequestId(null);
          setControlledFileReadNote("Ignored duplicate controlled read result.");
          return;
        }
        if (correlation.state === "ignored") {
          setControlledFileReadNote("Ignored stale controlled read result.");
          return;
        }
        controlledFileReadCorrelationRef.current = null;
        oneStepFileReadRequestIdRef.current = null;
        setPendingControlledFileReadRequestId(null);
        if (oneStepPendingRead) {
          setOneStepLoopState((currentLoop) => reduceControlledOneStepAgentLoopState(currentLoop, { type: "read", metadata: message.payload }));
        }
        setControlledFileReadNote(correlation.diagnostics[0]?.message ?? "Controlled read result was blocked.");
      } else if (message.type === "host.controlledAgentEditResult") {
        const requestId = message.requestId ?? "unknown";
        const current = controlledEditCorrelationRef.current;
        if (controlledEditCompletedRequestIdRef.current === requestId) {
          setControlledEditNote("Ignored duplicate controlled edit result.");
          return;
        }
        if (!current) {
          setControlledEditNote("Ignored stale controlled edit result.");
          return;
        }
        const correlation = correlateControlledAgentEditResult({ current, hostMessage: message });
        const oneStepPendingEdit = oneStepEditRequestIdRef.current === requestId;
        if (correlation.state === "accepted" && correlation.edit) {
          controlledEditCompletedRequestIdRef.current = requestId;
          controlledEditCorrelationRef.current = null;
          oneStepEditRequestIdRef.current = null;
          setPendingControlledEditRequestId(null);
          setControlledEditResultMetadata(message.payload);
          setControlledEditNote(`Controlled edit result accepted: ${correlation.edit.state}.`);
          appendTrace({ family: correlation.edit.state === "applied" ? "controlledAgent.editResult" : "controlledAgent.editBlocked", title: "Controlled edit result received", status: correlation.edit.state === "applied" ? "succeeded" : "failed", summary: correlation.edit.summary, requestId, details: correlation.details });
          if (oneStepPendingEdit) {
            setOneStepLoopState((currentLoop) => reduceControlledOneStepAgentLoopState(currentLoop, { type: "edit", metadata: controlledEditResultToOneStepMetadata(message.payload) }));
            if (correlation.edit.state === "applied") {
              postOneStepCommandRunRequest();
            }
          }
          return;
        }
        if (correlation.state === "duplicate") {
          controlledEditCorrelationRef.current = null;
          oneStepEditRequestIdRef.current = null;
          setPendingControlledEditRequestId(null);
          setControlledEditNote("Ignored duplicate controlled edit result.");
          return;
        }
        if (correlation.state === "ignored") {
          setControlledEditNote("Ignored stale controlled edit result.");
          return;
        }
        controlledEditCorrelationRef.current = null;
        oneStepEditRequestIdRef.current = null;
        setPendingControlledEditRequestId(null);
        if (oneStepPendingEdit) {
          setOneStepLoopState((currentLoop) => reduceControlledOneStepAgentLoopState(currentLoop, { type: "edit", metadata: controlledEditResultToOneStepMetadata(message.payload) }));
        }
        setControlledEditNote(correlation.diagnostics[0]?.message ?? "Controlled edit result was blocked.");
      } else if (message.type === "host.controlledAgentCommandRunResult") {
        const requestId = message.requestId ?? "unknown";
        const current = controlledCommandRunCorrelationRef.current;
        if (controlledCommandRunCompletedRequestIdRef.current === requestId) {
          setControlledCommandRunNote("Ignored duplicate controlled verification result.");
          return;
        }
        if (!current) {
          setControlledCommandRunNote("Ignored stale controlled verification result.");
          return;
        }
        const correlation = correlateControlledAgentCommandRunResult({ current, hostMessage: message });
        const oneStepPendingCommand = oneStepCommandRunRequestIdRef.current === requestId;
        if (correlation.state === "accepted" && correlation.commandRun) {
          const commandRun = correlation.commandRun;
          const commandRunMetadata = controlledCommandRunResultToRunnerMetadata(current, commandRun);
          setControlledCommandRunResultMetadata(commandRunMetadata);
          setControlledCommandRunNote(`Controlled verification result accepted: ${commandRun.status}.`);
          if (commandRun.status === "running") {
            setAgentRunVerificationProgress({ status: "running", summary: commandRun.message });
            if (oneStepPendingCommand) {
              setOneStepLoopState((currentLoop) => reduceControlledOneStepAgentLoopState(currentLoop, { type: "verification", metadata: commandRunMetadata }));
            }
            appendTrace({ family: "controlledAgent.commandRunning", title: "Controlled Agent Run verification running", status: "in_progress", summary: commandRun.message, requestId, details: correlation.details });
            return;
          }
          controlledCommandRunCompletedRequestIdRef.current = requestId;
          controlledCommandRunCorrelationRef.current = null;
          oneStepCommandRunRequestIdRef.current = null;
          agentRunVerificationCorrelationRef.current = null;
          agentRunVerificationChatIdRef.current = null;
          setPendingControlledCommandRunRequestId(null);
          setAgentRunVerificationProgress(null);
          const verificationResult = {
            status: commandRun.status === "succeeded" ? "succeeded" as const : "failed" as const,
            exitCode: typeof commandRun.exitCode === "number" ? commandRun.exitCode : undefined,
            durationMs: commandRun.durationMs,
            outputTail: commandRun.outputTail,
          };
          agentRunVerificationResultRef.current = verificationResult;
          setAgentRunVerificationResult(verificationResult);
          const reportInput = { ...(agentRunInputRef.current ?? {}), verificationResult, verificationProgress: undefined, rollback: undefined };
          const report = createAgentRunReport(reportInput);
          appendTrace({ family: verificationResult.status === "succeeded" ? "agentRun.completed" : "agentRun.verificationResult", title: report.title, status: report.status === "succeeded" ? "succeeded" : "failed", summary: report.summary, requestId, details: createAgentRunTraceDetails(reportInput) });
          if (oneStepPendingCommand) {
            setOneStepLoopState((currentLoop) => reduceControlledOneStepAgentLoopState(currentLoop, { type: "verification", metadata: commandRunMetadata }));
          }
          return;
        }
        if (correlation.state === "duplicate") {
          controlledCommandRunCorrelationRef.current = null;
          oneStepCommandRunRequestIdRef.current = null;
          agentRunVerificationCorrelationRef.current = null;
          agentRunVerificationChatIdRef.current = null;
          setPendingControlledCommandRunRequestId(null);
          setControlledCommandRunNote("Ignored duplicate controlled verification result.");
          return;
        }
        if (correlation.state === "ignored") {
          setControlledCommandRunNote("Ignored stale controlled verification result.");
          return;
        }
        controlledCommandRunCorrelationRef.current = null;
        oneStepCommandRunRequestIdRef.current = null;
        agentRunVerificationCorrelationRef.current = null;
        agentRunVerificationChatIdRef.current = null;
        setPendingControlledCommandRunRequestId(null);
        if (oneStepPendingCommand) {
          setOneStepLoopState((currentLoop) => reduceControlledOneStepAgentLoopState(currentLoop, { type: "verification", metadata: message.payload }));
        }
        setControlledCommandRunNote(correlation.diagnostics[0]?.message ?? "Controlled verification result was blocked.");
      } else if (message.type === "host.contextSnapshot") {
        const nextContext = message.payload as HostContextSnapshotPayload;
        setAttachedContext({ payload: nextContext, settingsRevision: settingsRevisionRef.current, chatId: chatIdRef.current });
        setIncludeAttachedContext(hasUsableAttachedContext(nextContext) && !attachedContextRequiresAcknowledgement(nextContext));
        setAttachedContextAcknowledged(false);
        setAttachedContextStatus(null);
        appendTrace({ family: "context.snapshot", title: "Active editor context received", status: hasUsableAttachedContext(nextContext) ? "succeeded" : "unavailable", summary: attachedContextSummary(nextContext), details: { source: nextContext.source, file: nextContext.file?.workspaceRelativePath ?? nextContext.file?.displayPath, range: formatSelectionRange(nextContext.selection), hasSelection: Boolean(nextContext.selection?.text) } });
      } else if (message.type === "host.applyWorkspaceEditResult") {
        const requestId = message.requestId ?? "unknown";
        const completedChatId = completedApplyRequestChatsRef.current.get(requestId);
        if (completedChatId) {
          if (completedChatId === chatIdRef.current) {
            setApplyNote(ignoredDuplicateApplyResultNote);
          }
          return;
        }
        if (requestId !== pendingApplyRequestIdRef.current) {
          if (pendingApplyRequestIdRef.current && pendingApplyRequestIdRef.current !== requestId) {
            setApplyNote(ignoredStaleApplyResultNote);
          }
          return;
        }
        const agentRunCorrelation = agentRunApplyCorrelationRef.current;
        if (agentRunCorrelation && agentRunApplyChatIdRef.current === chatIdRef.current) {
          const correlation = correlateAgentRunApplyResult({ current: agentRunCorrelation, hostMessage: message });
          if (correlation.state !== "accepted" || !correlation.applyResult) {
            setApplyNote(correlation.diagnostics[0]?.message ?? "Agent Run apply result was blocked.");
            return;
          }
          rememberCompletedApplyRequest(completedApplyRequestChatsRef.current, requestId, chatIdRef.current);
          pendingApplyRequestIdRef.current = null;
          pendingApplyProposalRequestIdRef.current = null;
          agentRunApplyCorrelationRef.current = null;
          agentRunApplyChatIdRef.current = null;
          setPendingApplyRequestId(null);
          setApplyNote(null);
          setApplyResult({ requestId, proposalRequestId: agentRunCorrelation.proposalId, payload: message.payload as ApplyWorkspaceEditResultPayload });
          appendTrace({ family: "agentRun.applyResult", title: "Agent Run apply result received", status: correlation.applyResult.status === "applied" ? "succeeded" : "failed", summary: correlation.applyResult.summary ?? "Agent Run apply result received.", requestId, details: correlation.details });
          return;
        }
        const proposalRequestId = pendingApplyProposalRequestIdRef.current;
        rememberCompletedApplyRequest(completedApplyRequestChatsRef.current, requestId, chatIdRef.current);
        pendingApplyRequestIdRef.current = null;
        pendingApplyProposalRequestIdRef.current = null;
        setPendingApplyRequestId(null);
        setApplyNote(null);
        setApplyResult({ requestId, proposalRequestId, payload: message.payload as ApplyWorkspaceEditResultPayload });
        const payload = message.payload as ApplyWorkspaceEditResultPayload;
        appendTrace({ family: "edit.applyResult", title: "Edit apply result received", status: payload.status === "applied" ? "succeeded" : payload.status === "denied" || payload.status === "rejected" ? "rejected" : "failed", summary: payload.message, requestId, details: { status: payload.status, appliedEditCount: payload.appliedEditCount ?? 0, affectedFiles: payload.affectedFiles ?? [] } });
      } else if (message.type === "host.ideActionProgress") {
        const requestId = message.requestId ?? "unknown";
        if (requestId !== pendingIdeActionRequestIdRef.current || pendingIdeActionChatIdRef.current !== chatIdRef.current) {
          if (pendingIdeActionRequestIdRef.current && pendingIdeActionChatIdRef.current === chatIdRef.current) {
            setIdeActionNote("Ignored stale IDE action progress.");
          }
          return;
        }
        const payload = message.payload as IdeActionProgressPayload;
        setIdeActionNote(null);
        appendTrace({ family: payload.action === "runVerificationCommand" ? "verification.progress" : "ide.progress", title: payload.action === "runVerificationCommand" ? "Verification progress received" : "IDE action progress received", status: payload.status === "inProgress" ? "in_progress" : payload.status, summary: payload.summary, requestId, details: { action: payload.action, commandId: payload.commandId, workspaceRelativePath: payload.workspaceRelativePath } });
        const agentRunCorrelation = agentRunVerificationCorrelationRef.current;
        if (payload.action === "runVerificationCommand" && agentRunCorrelation && agentRunVerificationChatIdRef.current === chatIdRef.current) {
          const correlation = correlateAgentRunVerificationProgress({ current: agentRunCorrelation, hostMessage: message });
          if (correlation.state === "accepted" && correlation.verificationProgress) {
            setAgentRunVerificationProgress(correlation.verificationProgress);
            appendTrace({ family: "agentRun.verificationProgress", title: "Agent Run verification progress received", status: correlation.verificationProgress.status === "running" ? "in_progress" : "pending", summary: correlation.verificationProgress.summary ?? "Agent Run verification progress received.", requestId, details: correlation.details });
          } else if (correlation.state === "blocked") {
            setIdeActionNote(correlation.diagnostics[0]?.message ?? "Agent Run verification progress was blocked.");
          }
        }
        setIdeActionAttempt((current) => current?.requestId === requestId ? {
          ...current,
          status: payload.status,
          message: payload.summary,
          workspaceRelativePath: payload.workspaceRelativePath ?? current.workspaceRelativePath,
          progress: payload,
        } : current);
      } else if (message.type === "host.ideActionResult") {
        const requestId = message.requestId ?? "unknown";
        const completedChatId = completedIdeActionRequestChatsRef.current.get(requestId);
        if (completedChatId) {
          if (completedChatId === chatIdRef.current) {
            setIdeActionNote("Ignored duplicate IDE action result.");
          }
          return;
        }
        if (requestId !== pendingIdeActionRequestIdRef.current || pendingIdeActionChatIdRef.current !== chatIdRef.current) {
          if (pendingIdeActionRequestIdRef.current && pendingIdeActionChatIdRef.current === chatIdRef.current) {
            setIdeActionNote("Ignored stale IDE action result.");
          }
          return;
        }
        const payload = message.payload as IdeActionResultPayload;
        rememberCompletedIdeActionRequest(completedIdeActionRequestChatsRef.current, requestId, chatIdRef.current);
        appendTrace({ family: payload.action === "runVerificationCommand" ? "verification.result" : payload.action === "getActiveFileExcerpt" ? "context.activeExcerpt" : payload.action === "searchWorkspaceSnippets" ? "context.snippets" : "ide.result", title: payload.action === "runVerificationCommand" ? "Verification result received" : "IDE action result received", status: payload.status, summary: payload.message, requestId, details: { action: payload.action, commandId: payload.commandId, exitCode: payload.exitCode, workspaceRelativePath: payload.workspaceRelativePath, resultCount: payload.resultCount } });
        const agentRunCorrelation = agentRunVerificationCorrelationRef.current;
        if (payload.action === "runVerificationCommand" && agentRunCorrelation && agentRunVerificationChatIdRef.current === chatIdRef.current) {
          const correlation = correlateAgentRunVerificationResult({ current: agentRunCorrelation, hostMessage: message, existingResult: agentRunVerificationResultRef.current ?? undefined });
          if ((correlation.state === "accepted" || correlation.state === "duplicate") && correlation.verificationResult) {
            agentRunVerificationResultRef.current = correlation.verificationResult;
            setAgentRunVerificationResult(correlation.verificationResult);
            setAgentRunVerificationProgress(null);
            const reportInput = { ...(agentRunInputRef.current ?? {}), verificationResult: correlation.verificationResult, verificationProgress: undefined, rollback: undefined };
            const report = createAgentRunReport(reportInput);
            appendTrace({ family: correlation.verificationResult.status === "succeeded" ? "agentRun.completed" : "agentRun.verificationResult", title: report.title, status: report.status === "succeeded" ? "succeeded" : "failed", summary: report.summary, requestId, details: createAgentRunTraceDetails(reportInput) });
          } else if (correlation.state === "blocked") {
            setIdeActionNote(correlation.diagnostics[0]?.message ?? "Agent Run verification result was blocked.");
          }
          agentRunVerificationCorrelationRef.current = null;
          agentRunVerificationChatIdRef.current = null;
        }
        pendingIdeActionRequestIdRef.current = null;
        pendingIdeActionChatIdRef.current = null;
        setIdeActionNote(null);
        if (payload.status === "succeeded" && payload.action === "getActiveFileExcerpt" && payload.contextAttachment) {
          const attachment = payload.contextAttachment;
          setAttachedContext({ payload: activeFileExcerptToChatContext(attachment), settingsRevision: settingsRevisionRef.current, chatId: chatIdRef.current, excerpt: attachment });
          setIncludeAttachedContext(true);
          setAttachedContextAcknowledged(false);
          setAttachedContextStatus(null);
        }
        if (isWorkspaceSnippetSearchResult(payload)) {
          setWorkspaceSnippetResult(payload);
          setSelectedWorkspaceSnippetKeys([]);
          setWorkspaceSnippetStatus(`${payload.resultCount} sanitized snippet${payload.resultCount === 1 ? "" : "s"} returned for ${sanitizeDisplayText(payload.queryLabel)}. Select snippets, then attach them to the next message.`);
        }
        setIdeActionAttempt((current) => current?.requestId === requestId ? {
          ...current,
          status: payload.status,
          message: payload.message,
          workspaceRelativePath: payload.workspaceRelativePath ?? current.workspaceRelativePath,
          range: payload.range ?? current.range,
          result: payload,
        } : current);
      }
    });
    return () => {
      bridgeAdapterRef.current = null;
      adapter.dispose();
    };
  }, [appendTrace, applyHostReady, stopPendingControlledCommandRunState]);

  const appendChatError = useCallback((message: string, code?: string) => {
    setChatView((current) => applyChatViewEvent(current, {
      seq: 0,
      type: "error",
      chatId: current.chatId,
      payload: { message, code },
    }));
  }, []);

  const clearSubmittedAttachedContext = useCallback((submittedContext: typeof attachedContext) => {
    if (!submittedContext) {
      return;
    }
    const current = attachedContextRef.current;
    if (current?.settingsRevision === submittedContext.settingsRevision && current.chatId === submittedContext.chatId && current.payload === submittedContext.payload) {
      setAttachedContext(null);
      setIncludeAttachedContext(false);
      setAttachedContextAcknowledged(false);
      setAttachedContextStatus(`Context attached to the last accepted message from ${submittedContext.excerpt ? activeFileExcerptSummary(submittedContext.excerpt) : attachedContextSummary(submittedContext.payload)}.`);
    }
  }, []);

  const isCurrentRefresh = useCallback((revision: number) => revision === settingsRevisionRef.current, []);

  const refreshRuntime = useCallback(async (targetSettings: RuntimeSettings, revision: number, keepInFlight = false) => {
    const attempt = runtimeRefreshAttemptRef.current + 1;
    runtimeRefreshAttemptRef.current = attempt;
    const checkedAt = new Date().toLocaleTimeString();
    runtimeRefreshInFlightRef.current = true;
    setRuntimeRefreshInFlight(true);
    setRuntimeRefreshStatus({ state: "checking", attempt, checkedAt, detail: "Checking runtime…" });
    appendTrace({ family: "runtime.refresh", title: "Runtime refresh started", status: "pending", summary: `Attempt ${attempt} checking local runtime.`, details: { attempt } });
    setConnectionError(null);
    setModelError(null);
    setIdentityWarnings([]);
    try {
      const [nextPing, nextCaps, nextModels, nextDemoMode] = await Promise.all([
        getPing(targetSettings),
        getCaps(targetSettings),
        getModels(targetSettings),
        getDemoMode(targetSettings),
      ]);
      if (!isCurrentRefresh(revision)) {
        return;
      }
      const warnings: string[] = [];
      let lastError: RuntimeError | null = null;
      if (nextPing.ok) {
        setPing(nextPing.data);
        const warning = productIdentityWarning(nextPing.data);
        if (warning) {
          warnings.push(warning);
        }
      } else {
        setPing(null);
        setConnectionError(nextPing.error);
        lastError = nextPing.error;
      }
      if (nextCaps.ok) {
        setCaps(nextCaps.data);
        const warning = productIdentityWarning(nextCaps.data);
        if (warning) {
          warnings.push(warning);
        }
      } else {
        setCaps(null);
        setConnectionError(nextCaps.error);
        lastError = nextCaps.error;
      }
      if (nextModels.ok) {
        setModels(nextModels.data.models);
      } else {
        setModels([]);
        setModelError(nextModels.error);
        lastError = nextModels.error;
      }
      if (nextDemoMode.ok) {
        setDemoModeState(nextDemoMode.data);
        setDemoModeError(null);
      } else {
        setDemoModeState(null);
        setDemoModeError(nextDemoMode.error.status === 404 ? null : nextDemoMode.error);
      }
      setIdentityWarnings(warnings);
      setRuntimeDataRevision(revision);
      setDemoModeDataRevision(revision);
      setRuntimeRefreshStatus({
        state: lastError ? "failed" : "connected",
        attempt,
        checkedAt: new Date().toLocaleTimeString(),
        detail: lastError ? `Runtime check failed: ${lastError.status} ${sanitizeDisplayText(lastError.message)}` : "Runtime connected",
      });
      appendTrace({
        family: "runtime.refresh",
        title: lastError ? "Runtime refresh failed" : "Runtime refresh connected",
        status: lastError ? "failed" : "succeeded",
        summary: lastError ? `Runtime check failed: ${lastError.status} ${lastError.message}` : "Runtime connected.",
        details: { attempt, ready: nextPing.ok ? nextPing.data.ready : false, modelCount: nextModels.ok ? nextModels.data.models.length : 0 },
      });
    } catch (error) {
      const runtimeError: RuntimeError = {
        status: "network",
        message: error instanceof Error ? error.message : "Runtime refresh failed",
      };
      if (!isCurrentRefresh(revision)) {
        return;
      }
      setPing(null);
      setCaps(null);
      setModels([]);
      setDemoModeState(null);
      setIdentityWarnings([]);
      setConnectionError(runtimeError);
      setModelError(runtimeError);
      setDemoModeError(runtimeError);
      setRuntimeDataRevision(revision);
      setDemoModeDataRevision(revision);
      setRuntimeRefreshStatus({
        state: "failed",
        attempt,
        checkedAt: new Date().toLocaleTimeString(),
        detail: `Runtime check failed: ${runtimeError.status} ${sanitizeDisplayText(runtimeError.message)}`,
      });
      appendTrace({ family: "runtime.refresh", title: "Runtime refresh failed", status: "failed", summary: `Runtime check failed: ${runtimeError.status} ${runtimeError.message}`, details: { attempt } });
    } finally {
      if (!keepInFlight) {
        runtimeRefreshInFlightRef.current = false;
        setRuntimeRefreshInFlight(false);
      }
    }
  }, [appendTrace, isCurrentRefresh]);

  const refreshProviders = useCallback(async (targetSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    setProviderError(null);
    const result = await listProviders(targetSettings);
    if (!isCurrentRefresh(revision)) {
      return;
    }
    if (result.ok) {
      setProviders(result.data.providers);
      setProviderDataRevision(revision);
    } else {
      setProviders([]);
      setProviderError(result.error);
      setProviderDataRevision(revision);
    }
  }, [isCurrentRefresh]);

  const toggleDemoMode = useCallback(async (enabled: boolean) => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setDemoModeWorking(true);
    setDemoModeError(null);
    const result = await setDemoMode(targetSettings, enabled);
    if (!isCurrentRefresh(targetRevision)) {
      return;
    }
    setDemoModeWorking(false);
    if (result.ok) {
      setDemoModeState(result.data);
      setDemoModeDataRevision(targetRevision);
      addTimeline(`Demo Mode ${enabled ? "enabled" : "disabled"} in local runtime`);
      await refreshRuntime(targetSettings, targetRevision);
      await refreshProviders(targetSettings, targetRevision);
    } else {
      setDemoModeError(result.error);
      setDemoModeDataRevision(targetRevision);
      addTimeline(`Demo Mode error: ${sanitizeDisplayText(result.error.message)}`);
    }
  }, [addTimeline, isCurrentRefresh, refreshProviders, refreshRuntime]);

  const refreshProviderAuthStatus = useCallback(async (targetSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    const result = await getProviderAuthStatus(targetSettings, "openai");
    if (!isCurrentRefresh(revision)) {
      return;
    }
    if (result.ok) {
      setProviderAuthStatus(result.data);
      setProviderAuthDataRevision(revision);
    } else {
      setProviderAuthStatus(null);
      setProviderAuthError(result.error);
      setProviderAuthDataRevision(revision);
    }
  }, [isCurrentRefresh]);

  useEffect(() => {
    if (activeProviderAuthStatus?.status === "pending") {
      return;
    }
    providerAuthExchangeInFlightRef.current = false;
    setProviderAuthExchangeWorking(false);
    setProviderAuthExchangeCode("");
    setProviderAuthExchangeError(null);
  }, [activeProviderAuthStatus?.status]);

  useEffect(() => {
    const lifecycle = activeRuntimeLifecycle?.lifecycle;
    if ((lifecycle === "connected" || lifecycle === "degraded") && providerAuthDataRevision !== settingsRevision) {
      void refreshProviderAuthStatus();
    }
  }, [activeRuntimeLifecycle?.lifecycle, providerAuthDataRevision, refreshProviderAuthStatus, settingsRevision]);

  const refreshChats = useCallback(async (targetSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    const attempt = chatHistoryAttemptRef.current + 1;
    chatHistoryAttemptRef.current = attempt;
    setChatHistoryLoading(true);
    setChatHistoryError(null);
    const result = await listChats(targetSettings);
    if (!isCurrentRefresh(revision) || chatHistoryAttemptRef.current !== attempt) {
      return;
    }
    if (result.ok) {
      const summaries = result.data.chats ?? [];
      setChatSummaries(summaries);
      setChatHistoryRevision(revision);
      const resolution = resolveChatAfterList({ currentChatId: chatIdRef.current, summaries, defaultChatId: "chat-001" });
      if (resolution.reason === "first_summary") {
        setConversationNotice(`Selected ${sanitizeDisplayText(summaries[0]?.title || resolution.nextChatId)} because the previous chat is not in this local runtime list.`);
      } else if (resolution.reason === "default_chat") {
        setConversationNotice("No saved conversations are available; showing a fresh local chat.");
      } else {
        setConversationNotice(null);
      }
      if (resolution.shouldResetView) {
        clearEditProposalState();
        clearIdeActionState();
        setChatInput("");
        setChatView(resetChatViewState(resolution.nextChatId));
        setChatId(resolution.nextChatId);
      }
    } else {
      setChatSummaries([]);
      setChatHistoryError(result.error);
      setChatHistoryRevision(revision);
    }
    setChatHistoryLoading(false);
  }, [clearEditProposalState, clearIdeActionState, isCurrentRefresh]);

  const loadChatThread = useCallback(async (targetChatId: string, targetSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    const attempt = chatHistoryAttemptRef.current + 1;
    chatHistoryAttemptRef.current = attempt;
    setChatHistoryLoading(true);
    setChatHistoryError(null);
    const result = await getChat(targetSettings, targetChatId);
    if (!isCurrentRefresh(revision) || chatHistoryAttemptRef.current !== attempt || chatIdRef.current !== targetChatId) {
      return;
    }
    if (result.ok) {
      setChatView((current) => hydrateChatViewFromThread(current, result.data));
      setChatSummaries((current) => upsertChatSummary(current, result.data));
      setChatHistoryRevision(revision);
    } else {
      setChatHistoryError(result.error);
      setChatHistoryRevision(revision);
    }
    setChatHistoryLoading(false);
  }, [isCurrentRefresh]);

  const createNewChat = useCallback(async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = chatHistoryAttemptRef.current + 1;
    chatHistoryAttemptRef.current = attempt;
    abortActiveStream("SSE stopped and abort requested before creating a new chat");
    setChatHistoryLoading(true);
    setChatHistoryError(null);
    setChatError(null);
    setChatInput("");
    const result = await createChat(targetSettings);
    if (!isCurrentRefresh(targetRevision) || chatHistoryAttemptRef.current !== attempt) {
      setChatHistoryLoading(false);
      return;
    }
    if (result.ok) {
      setChatSummaries((current) => upsertChatSummary(current, result.data));
      setChatHistoryRevision(targetRevision);
      setCompactConversationsOpen(false);
      setChatId(result.data.chatId);
      setConversationNotice(`Created and selected ${sanitizeDisplayText(result.data.title || result.data.chatId)}.`);
      setChatView(hydrateChatViewFromThread(resetChatViewState(result.data.chatId), result.data));
      setTimeline([]);
      setAttachedContext(null);
      setIncludeAttachedContext(false);
      setAttachedContextAcknowledged(false);
      setAttachedContextStatus(null);
      clearExplicitContextBundle(null);
      clearEditProposalState();
      clearModelProposalState();
      clearIdeActionState();
      clearControlledFileReadState(null);
      clearControlledEditState(null);
      clearControlledCommandRunState(null);
    } else {
      setChatHistoryError(result.error);
      setChatHistoryRevision(targetRevision);
    }
    setChatHistoryLoading(false);
  }, [abortActiveStream, clearControlledFileReadState, clearControlledEditState, clearControlledCommandRunState, clearEditProposalState, clearExplicitContextBundle, clearModelProposalState, clearIdeActionState, isCurrentRefresh]);

  const selectChat = useCallback((nextChatId: string) => {
    setCompactConversationsOpen(false);
    if (nextChatId === chatIdRef.current) {
      return;
    }
    abortActiveStream("SSE stopped and abort requested before switching chats");
    setChatInput("");
    clearEditProposalState();
    clearModelProposalState();
    clearIdeActionState();
    clearControlledFileReadState(null);
    clearControlledEditState(null);
    clearControlledCommandRunState(null);
    clearExplicitContextBundle(null);
    setAttachedContextAcknowledged(false);
    setChatId(nextChatId);
    const selectedSummary = chatSummaries.find((summary) => summary.chatId === nextChatId);
    setConversationNotice(`Switched to ${sanitizeDisplayText(selectedSummary?.title || nextChatId)}.`);
    setChatView(resetChatViewState(nextChatId));
    void loadChatThread(nextChatId);
  }, [abortActiveStream, chatSummaries, clearControlledFileReadState, clearControlledEditState, clearControlledCommandRunState, clearEditProposalState, clearExplicitContextBundle, clearIdeActionState, clearModelProposalState, loadChatThread]);

  const updateDirectChatId = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextChatId = event.target.value;
    if (nextChatId !== chatIdRef.current) {
      abortActiveStream("SSE stopped and abort requested before changing chat id");
      setChatInput("");
      clearEditProposalState();
      clearModelProposalState();
      clearIdeActionState();
      setAttachedContextAcknowledged(false);
      setChatView(resetChatViewState(nextChatId));
    }
    setChatId(nextChatId);
  }, [abortActiveStream, clearEditProposalState, clearExplicitContextBundle, clearModelProposalState, clearIdeActionState]);

  const deleteCurrentChat = useCallback(async (targetChatId: string) => {
    const targetSummary = chatSummaries.find((summary) => summary.chatId === targetChatId);
    const targetTitle = sanitizeDisplayText(targetSummary?.title || targetChatId);
    const deletingCurrent = chatIdRef.current === targetChatId;
    setCompactConversationsOpen(false);
    const confirmation = deletingCurrent
      ? `Delete the current conversation "${targetTitle}"? This removes it from engine-owned local history and selects the next available local chat.`
      : `Delete conversation "${targetTitle}" from engine-owned local history?`;
    if (!window.confirm(confirmation)) {
      setConversationNotice(`Kept ${targetTitle}; delete was cancelled.`);
      return;
    }
    setConversationNotice(`Deleting ${targetTitle}…`);
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = chatHistoryAttemptRef.current + 1;
    chatHistoryAttemptRef.current = attempt;
    if (deletingCurrent) {
      abortActiveStream("SSE stopped and abort requested before deleting the current chat");
      setChatView(resetChatViewState(targetChatId));
      setChatInput("");
      setTimeline([]);
      setAttachedContext(null);
      setIncludeAttachedContext(false);
      setAttachedContextAcknowledged(false);
      setAttachedContextStatus(null);
      clearExplicitContextBundle(null);
      clearEditProposalState();
      clearIdeActionState();
    }
    setDeletingChatId(targetChatId);
    setChatHistoryLoading(true);
    setChatHistoryError(null);
    const result = await deleteChat(targetSettings, targetChatId);
    if (!isCurrentRefresh(targetRevision) || chatHistoryAttemptRef.current !== attempt) {
      setDeletingChatId((current) => current === targetChatId ? null : current);
      return;
    }
    if (result.ok) {
      const fallback = resolveFallbackChatAfterDelete({ summariesBeforeDelete: chatSummaries, deletedChatId: targetChatId, activeChatId: chatIdRef.current, defaultChatId: "chat-001" });
      setChatSummaries(fallback.remainingSummaries);
      setChatHistoryRevision(targetRevision);
      if (fallback.deletedCurrent) {
        const fallbackSummary = fallback.remainingSummaries.find((summary) => summary.chatId === fallback.nextChatId);
        setConversationNotice(fallbackSummary ? `Deleted ${targetTitle}. Selected ${sanitizeDisplayText(fallbackSummary.title || fallback.nextChatId)}.` : `Deleted ${targetTitle}. No saved conversations remain; showing a fresh local chat.`);
        setChatId(fallback.nextChatId);
        setChatView(resetChatViewState(fallback.nextChatId));
        setChatInput("");
        setTimeline([]);
        setAttachedContext(null);
        setIncludeAttachedContext(false);
        setAttachedContextAcknowledged(false);
        setAttachedContextStatus(null);
        clearEditProposalState();
        clearIdeActionState();
      } else {
        setConversationNotice(`Deleted ${targetTitle}.`);
      }
    } else {
      setChatHistoryError(result.error);
      setConversationNotice(`Could not delete ${targetTitle}: ${sanitizeDisplayText(result.error.message)}`);
      setChatHistoryRevision(targetRevision);
    }
    setDeletingChatId(null);
    setChatHistoryLoading(false);
  }, [abortActiveStream, chatSummaries, clearEditProposalState, clearIdeActionState, isCurrentRefresh]);
  const connect = useCallback(async (requestHostRefresh = false) => {
    if (bridgeHost !== "browser" && !hostReadyAppliedRef.current && runtimeConnectionSource !== "manual") {
      if (requestHostRefresh && bridgeHost === "jetbrains") {
        const adapter = bridgeAdapterRef.current;
        const now = Date.now();
        const lastRequestedAt = preHostRuntimeRefreshRequestedAtRef.current;
        const canRetry = lastRequestedAt === null || now - lastRequestedAt >= preHostRuntimeRefreshRetryCooldownMs;
        if (adapter && canRetry) {
          const nextRequestCounter = preHostRuntimeRefreshRequestCounterRef.current + 1;
          try {
            adapter.post({
              version: GUI_BRIDGE_VERSION,
              type: "gui.runtimeRefresh",
              requestId: `gui-runtime-refresh-${nextRequestCounter}`,
              payload: {},
            });
            preHostRuntimeRefreshRequestedAtRef.current = now;
            preHostRuntimeRefreshRequestCounterRef.current = nextRequestCounter;
            addTimeline("Requested IDE-managed runtime refresh");
          } catch {
            addTimeline("IDE-managed runtime refresh bridge unavailable");
          }
        }
      }
      addTimeline("Waiting for IDE host runtime settings");
      return;
    }
    if (bridgeHost === "jetbrains" && !isSameOriginProxyBaseUrl(settingsRef.current.baseUrl)) {
      bridgeAdapterRef.current?.post({
        version: GUI_BRIDGE_VERSION,
        type: "gui.runtimeRefresh",
        requestId: `gui-runtime-refresh-${runtimeRefreshAttemptRef.current + 1}`,
        payload: {},
      });
      addTimeline("Requested IDE-managed runtime refresh");
    }
    if (runtimeRefreshInFlightRef.current) {
      runtimeRefreshQueuedRef.current = true;
      return;
    }
    runtimeRefreshInFlightRef.current = true;
    setRuntimeRefreshInFlight(true);
    try {
      do {
        runtimeRefreshQueuedRef.current = false;
        const targetSettings = settingsRef.current;
        const targetRevision = settingsRevisionRef.current;
        await refreshRuntime(targetSettings, targetRevision, true);
        await refreshProviders(targetSettings, targetRevision);
        await refreshProviderAuthStatus(targetSettings, targetRevision);
        await refreshChats(targetSettings, targetRevision);
      } while (runtimeRefreshQueuedRef.current);
    } finally {
      runtimeRefreshInFlightRef.current = false;
      runtimeRefreshQueuedRef.current = false;
      setRuntimeRefreshInFlight(false);
    }
  }, [addTimeline, bridgeHost, refreshChats, refreshProviderAuthStatus, refreshProviders, refreshRuntime, runtimeConnectionSource]);

  const refreshAgentProgress = useCallback(async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = agentProgressAttemptRef.current + 1;
    agentProgressAttemptRef.current = attempt;
    setAgentProgress({ state: "loading", response: null, error: null });
    const result = await getAgentProgress(targetSettings);
    if (!isCurrentRefresh(targetRevision) || agentProgressAttemptRef.current !== attempt) {
      return;
    }
    if (result.ok) {
      setAgentProgress({ state: "ready", response: result.data, error: null });
    } else {
      setAgentProgress({ state: "error", response: null, error: result.error });
    }
  }, [isCurrentRefresh]);

  useEffect(() => {
    void connect();
  }, [connect, settings, hostReadyRefreshNonce]);

  const submitProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    providerTestAttemptRef.current += 1;
    setProviderError(null);
    setProviderTestState(null);
    setProviderDataRevision(null);
    const modelsToSave = providerForm.modelId.trim()
      ? [
          {
            id: providerForm.modelId.trim(),
            displayName: providerForm.modelDisplayName.trim() || providerForm.modelId.trim(),
          },
        ]
      : [];
    const request: ProviderWriteRequest = {
      id: selectedProviderId ? undefined : providerForm.providerId.trim(),
      kind: providerForm.kind,
      displayName: providerForm.displayName.trim(),
      enabled: providerForm.enabled,
      baseUrl: providerForm.baseUrl.trim(),
      auth: {
        type: providerForm.authType,
        apiKey: providerForm.apiKey.trim() || undefined,
      },
      models: modelsToSave,
      capabilities: {
        chat: true,
        completion: false,
        embeddings: false,
      },
    };
    setProviderForm((current) => ({ ...current, apiKey: "" }));
    const result = await saveProvider(targetSettings, selectedProviderId, request);
    if (!isCurrentRefresh(targetRevision)) {
      return;
    }
    if (result.ok) {
      setSelectedProviderId(result.data.id);
      await connect();
    } else {
      setProviderError(result.error);
    }
  };

  const editProvider = (provider: ProviderSummary) => {
    if (provider.kind === "demo-local") {
      return;
    }
    setProviderDetailsOpen(true);
    setSelectedProviderId(provider.id);
    setProviderForm({
      providerId: provider.id,
      kind: provider.kind,
      displayName: provider.displayName,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      authType: provider.auth.type,
      apiKey: "",
      modelId: provider.models[0]?.id ?? "",
      modelDisplayName: provider.models[0]?.displayName ?? "",
    });
  };

  const applyProviderPreset = (preset: ProviderPreset) => {
    setSelectedProviderId(undefined);
    setProviderForm({
      ...preset.form,
      enabled: preset.enabled ?? true,
      apiKey: "",
    });
  };

  const showProviderSetupFocus = () => {
    setProviderDetailsOpen(true);
    setProviderSetupHighlight(true);
    setProviderSetupFocusRequest((current) => current + 1);
    if (providerSetupHighlightTimerRef.current !== null) {
      window.clearTimeout(providerSetupHighlightTimerRef.current);
    }
    providerSetupHighlightTimerRef.current = window.setTimeout(() => {
      setProviderSetupHighlight(false);
      providerSetupHighlightTimerRef.current = null;
    }, 1800);
  };

  const applyOpenAiApiPreset = () => {
    const preset = providerPresets.find((item) => item.id === "openai-api");
    if (preset) {
      applyProviderPreset(preset);
      setProviderSetupStatus(runtimeAuthMismatchError
        ? "OpenAI API-key fallback selected, but it cannot fix the local GUI-to-runtime session token mismatch. Fix the runtime URL/session token first, then save, test provider, refresh runtime/model readiness, and send."
        : "OpenAI API-key fallback selected. Paste your provider API key, save or update the provider, test provider, then refresh runtime/model readiness before sending.");
      showProviderSetupFocus();
    }
  };

  const runProviderTest = async (providerId: string) => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = providerTestAttemptRef.current + 1;
    providerTestAttemptRef.current = attempt;
    setProviderTestState({ providerId, state: "testing", detail: "Testing provider reachability…" });
    const result = await testProvider(targetSettings, providerId);
    if (!isCurrentRefresh(targetRevision) || providerTestAttemptRef.current !== attempt) {
      return;
    }
    if (result.ok) {
      const model = result.data.modelId ? ` Model: ${sanitizeDisplayText(result.data.modelId)}.` : "";
      const action = providerTestAction(result.data.status);
      setProviderTestState({
        providerId,
        state: result.data.ok ? "success" : "failed",
        status: result.data.status,
        detail: `${sanitizeDisplayText(result.data.message)}${model}${action ? ` ${action}` : ""}`,
      });
      if (result.data.ok) {
        setProviderForm((current) => ({ ...current, apiKey: "" }));
        await connect();
      }
    } else {
      setProviderTestState({
        providerId,
        state: "failed",
        status: result.error.status,
        detail: sanitizeDisplayText(result.error.message),
      });
    }
  };

  const beginProviderAuthMutation = (mutation: "start" | "exchange" | "disconnect") => {
    const attempt = providerAuthMutationAttemptRef.current + 1;
    providerAuthMutationAttemptRef.current = attempt;
    setProviderAuthMutation(mutation);
    if (activeProviderAuthStatus?.authSource === "oauth" && activeProviderAuthStatus.status === "connected") {
      setProviderAuthStatus({
        ...activeProviderAuthStatus,
        configured: false,
        status: mutation === "disconnect" ? "not_configured" : "pending",
        accountLabel: undefined,
        redacted: undefined,
        message: mutation === "disconnect" ? "Disconnecting OpenAI account login." : "Updating OpenAI account login.",
      });
      setProviderAuthDataRevision(settingsRevisionRef.current);
    }
    return attempt;
  };

  const startOpenAiLogin = async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = beginProviderAuthMutation("start");
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeCode("");
    try {
      const result = await startProviderAuth(targetSettings, "openai", { experimentalCodexLike: true });
      if (!isCurrentRefresh(targetRevision) || providerAuthMutationAttemptRef.current !== attempt) {
        return;
      }
      if (!result.ok) {
        setProviderAuthError(result.error);
        return;
      }
      setProviderAuthStatus(result.data);
      setProviderAuthDataRevision(targetRevision);
      const authUrl = result.data.authorizationUrl ?? result.data.verificationUrl;
      if (authUrl) {
        openSafeAuthUrl(authUrl, setProviderAuthUrlWarning);
      }
    } finally {
      if (isCurrentRefresh(targetRevision) && providerAuthMutationAttemptRef.current === attempt) {
        setProviderAuthMutation(null);
      }
    }
  };

  const disconnectOpenAiLogin = async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = beginProviderAuthMutation("disconnect");
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeCode("");
    try {
      const result = await disconnectProviderAuth(targetSettings, "openai");
      if (!isCurrentRefresh(targetRevision) || providerAuthMutationAttemptRef.current !== attempt) {
        return;
      }
      if (result.ok) {
        setProviderAuthStatus(result.data);
        setProviderAuthDataRevision(targetRevision);
        await connect();
      } else {
        setProviderAuthError(result.error);
      }
    } finally {
      if (isCurrentRefresh(targetRevision) && providerAuthMutationAttemptRef.current === attempt) {
        setProviderAuthMutation(null);
      }
    }
  };

  const exchangeOpenAiLoginCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sessionId = activeProviderAuthStatus?.sessionId;
    const code = providerAuthExchangeCode.trim();
    const state = providerAuthPendingState.state;
    const validation = validateProviderAuthExchangeInput(sessionId, code, state, providerAuthExchangeInFlightRef.current || providerAuthExchangeWorking || providerAuthMutation === "exchange");
    setProviderAuthExchangeCode("");
    if (!validation.ok) {
      setProviderAuthExchangeError(validation.error);
      return;
    }
    setProviderAuthError(null);
    setProviderAuthExchangeError(null);
    providerAuthExchangeInFlightRef.current = true;
    setProviderAuthExchangeWorking(true);
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = beginProviderAuthMutation("exchange");
    try {
      const result = await exchangeProviderAuth(targetSettings, "openai", validation.sessionId, validation.code, validation.state);
      if (!isCurrentRefresh(targetRevision) || providerAuthMutationAttemptRef.current !== attempt) {
        return;
      }
      if (result.ok) {
        setProviderAuthStatus(result.data);
        setProviderAuthDataRevision(targetRevision);
        if (result.data.success) {
          await connect();
          if (isCurrentRefresh(targetRevision)) {
            setProviderAuthStatus(result.data);
            setProviderAuthDataRevision(targetRevision);
          }
        } else {
          setProviderAuthExchangeError(result.data.lastError ?? result.data.message ?? providerAuthStatusCopy[result.data.status]);
        }
      } else {
        setProviderAuthError(result.error);
      }
    } finally {
      if (isCurrentRefresh(targetRevision) && providerAuthMutationAttemptRef.current === attempt) {
        providerAuthExchangeInFlightRef.current = false;
        setProviderAuthExchangeWorking(false);
        setProviderAuthMutation(null);
      }
    }
  };

  useEffect(() => {
    abortActiveStream("SSE stopped and abort requested for previous chat");
    setChatError(null);
    setChatView(resetChatViewState(chatId));
    setTimeline([]);
    setAttachedContext(null);
    setIncludeAttachedContext(false);
    setAttachedContextStatus(null);
    clearExplicitContextBundle(null);
    clearEditProposalState();
    clearModelProposalState();
    clearIdeActionState();
    if (activeChatSummary) {
      void loadChatThread(chatId);
    }
  }, [abortActiveStream, activeChatSummary?.chatId, chatId, clearEditProposalState, clearIdeActionState, clearModelProposalState, loadChatThread]);

  useEffect(() => () => {
    abortActiveStream("SSE stopped and abort requested on cleanup", { finalizeStreaming: false, addTimelineEntry: false, reportAbortErrors: false });
  }, [abortActiveStream]);

  useEffect(() => {
    const scrollRegion = chatScrollRegionRef.current;
    if (!scrollRegion) {
      return;
    }
    scrollRegion.scrollTop = scrollRegion.scrollHeight;
  }, [chatView.messages, activeEditProposal, activeIdeActionProposal, applyResult, applyNote, ideActionNote]);

  const startSse = useCallback((targetChatId = chatId) => {
    if (activeStreamRef.current) {
      return;
    }
    const controller = new AbortController();
    const stream: ActiveStream = {
      controller,
      settings: settingsRef.current,
      revision: settingsRevisionRef.current,
      chatId: targetChatId,
    };
    activeStreamRef.current = stream;
    setChatLifecycleState("sse_connecting");
    addTimeline(`Opening SSE for ${targetChatId}`);
    appendTrace({ family: "chat.streamStarted", title: "Opening chat stream", status: "pending", summary: `Opening SSE for ${targetChatId}.`, details: { chatId: targetChatId } });
    void subscribeToChat(
      stream.settings,
      targetChatId,
      {
        onEvent: (event: SseEvent) => {
          const activeStream = activeStreamRef.current;
          if (activeStream !== stream || stream.revision !== settingsRevisionRef.current || event.chatId !== stream.chatId) {
            return;
          }
          const safeEvent = sanitizeSseEvent(event);
          setChatView((current) => applyChatViewEvent(current, safeEvent));
          if (event.type === "stream_started" || event.type === "stream_delta") {
            setChatLifecycleState("streaming");
          } else if (event.type === "stream_finished") {
            setChatLifecycleState("idle");
          } else if (event.type === "error") {
            setChatLifecycleState("failed");
          }
          if (event.type === "stream_started") {
            appendTrace({ family: "chat.streamStarted", title: "Chat stream started", status: "in_progress", summary: `Stream event ${event.seq} started.`, details: { seq: event.seq, chatId: event.chatId } });
          } else if (event.type === "stream_delta") {
            appendTrace({ family: "chat.streamDelta", title: "Chat stream delta", status: "in_progress", summary: `Stream event ${event.seq} delivered sanitized delta.`, details: { seq: event.seq, chatId: event.chatId } });
          } else if (event.type === "stream_finished") {
            appendTrace({ family: "chat.streamFinished", title: "Chat stream finished", status: "succeeded", summary: `Stream event ${event.seq} finished.`, details: { seq: event.seq, chatId: event.chatId, payload: safeEvent.payload } });
          } else if (event.type === "error") {
            appendTrace({ family: "chat.streamError", title: "Chat stream error", status: "failed", summary: "SSE error event received.", details: { seq: event.seq, chatId: event.chatId, payload: safeEvent.payload } });
          }
          addTimeline(sanitizeTimelineText(`${event.seq} ${event.type}\n${JSON.stringify(safeEvent.payload ?? {}, null, 2)}`));
        },
        onError: (error) => {
          const activeStream = activeStreamRef.current;
          if (activeStream !== stream || stream.revision !== settingsRevisionRef.current) {
            return;
          }
          setChatError(error);
          setChatLifecycleState("failed");
          appendChatError(error.message, chatRecoveryCodeForRuntimeError(error, "sse"));
          addTimeline(`SSE error: ${sanitizeDisplayText(error.message)}`);
          appendTrace({ family: "chat.streamError", title: "Chat stream error", status: "failed", summary: error.message, details: { status: error.status } });
        },
      },
      controller.signal,
    ).finally(() => {
      if (activeStreamRef.current === stream) {
        activeStreamRef.current = null;
      }
    });
  }, [addTimeline, appendChatError, appendTrace, chatId]);

  const stopSse = () => {
    if (!abortActiveStream("SSE stopped and abort requested")) {
      addTimeline("SSE stopped");
    }
  };

  const cancelPendingEditProposalApply = useCallback(() => {
    if (!pendingApplyRequestIdRef.current) {
      return;
    }
    const requestId = pendingApplyRequestIdRef.current;
    pendingApplyRequestIdRef.current = null;
    pendingApplyProposalRequestIdRef.current = null;
    setPendingApplyRequestId(null);
    setApplyNote("Cleared pending apply state in the GUI only. No host-side cancellation was requested.");
    addTimeline(`Edit proposal pending apply cleared ${requestId}`);
    appendTrace({ family: "edit.applyRequested", title: "Edit apply request cleared", status: "cancelled", summary: "Pending apply state cleared in GUI only.", requestId });
  }, [addTimeline, appendTrace]);

  const submitEditProposal = useCallback(() => {
    if (!editProposal || (bridgeHost !== "vscode" && bridgeHost !== "jetbrains") || pendingApplyRequestIdRef.current) {
      return;
    }
    if (!editProposalCandidateIdentityMatches(editProposal, latestEditProposalCandidateFromMessages(chatViewMessagesRef.current))) {
      clearEditProposalState();
      return;
    }
    editProposalApplyCounterRef.current += 1;
    const applyRequestId = `gui-edit-proposal-apply-${editProposalApplySessionNonceRef.current}-${editProposalApplyCounterRef.current}`;
    pendingApplyRequestIdRef.current = applyRequestId;
    pendingApplyProposalRequestIdRef.current = editProposal.requestId;
    setPendingApplyRequestId(applyRequestId);
    setApplyResult(null);
    setApplyNote(null);
    bridgeAdapterRef.current?.post({
      version: GUI_BRIDGE_VERSION,
      type: "gui.applyWorkspaceEditRequest",
      requestId: applyRequestId,
      payload: editProposal.payload,
    });
    addTimeline(`Edit proposal apply requested ${applyRequestId}`);
    appendTrace({ family: "edit.applyRequested", title: "Edit apply requested", status: "pending", summary: editProposal.payload.summary, requestId: applyRequestId, details: { proposalRequestId: editProposal.requestId, fileCount: editProposal.payload.edits.length } });
  }, [addTimeline, appendTrace, bridgeHost, clearEditProposalState, editProposal]);

  const submitAgentRunApply = useCallback(() => {
    if (!activeEditProposal || !agentRunInput || (bridgeHost !== "vscode" && bridgeHost !== "jetbrains") || pendingApplyRequestIdRef.current) {
      return;
    }
    if (!editProposalCandidateIdentityMatches(activeEditProposal, latestEditProposalCandidateFromMessages(chatViewMessagesRef.current))) {
      clearEditProposalState();
      return;
    }
    agentRunApplyCounterRef.current += 1;
    const applyRequestId = `gui-agent-run-apply-${editProposalApplySessionNonceRef.current}-${agentRunApplyCounterRef.current}`;
    const normalized = normalizeAgentRunApplyRequest({
      source: "user",
      requestId: applyRequestId,
      requestIdMintedBy: "gui",
      runId: agentRunRunId(agentRunInput),
      proposalId: activeEditProposal.requestId,
      agentRunInput,
    });
    if (normalized.state !== "ready" || !normalized.correlation || !normalized.applyRequest) {
      setApplyNote(normalized.diagnostics[0]?.message ?? "Agent Run apply request was blocked.");
      return;
    }
    pendingApplyRequestIdRef.current = applyRequestId;
    pendingApplyProposalRequestIdRef.current = activeEditProposal.requestId;
    agentRunApplyCorrelationRef.current = normalized.correlation;
    agentRunApplyChatIdRef.current = chatIdRef.current;
    setPendingApplyRequestId(applyRequestId);
    setAgentRunApplyRequest(normalized.applyRequest);
    setApplyResult(null);
    setApplyNote(null);
    setAgentRunVerificationRequest(null);
    setAgentRunVerificationProgress(null);
    agentRunVerificationResultRef.current = null;
    setAgentRunVerificationResult(null);
    setAgentRunVerificationFixDraft(null);
    bridgeAdapterRef.current?.post({
      version: GUI_BRIDGE_VERSION,
      type: "gui.applyWorkspaceEditRequest",
      requestId: applyRequestId,
      payload: activeEditProposal.payload,
    });
    addTimeline(`Agent Run apply requested ${applyRequestId}`);
    appendTrace({ family: "agentRun.applyRequested", title: "Agent Run apply requested", status: "pending", summary: "User requested Agent Run apply through the existing workspace-edit bridge.", requestId: applyRequestId, details: normalized.details });
  }, [activeEditProposal, addTimeline, agentRunInput, appendTrace, bridgeHost, clearEditProposalState]);

  const submitAgentRunVerification = useCallback((commandId: VerificationCommandId) => {
    if (bridgeHost !== "vscode") {
      setControlledCommandRunNote(bridgeHost === "jetbrains" ? "Controlled Agent Run verification is unsupported in JetBrains for S85." : "Controlled Agent Run verification is unsupported in browser preview.");
      return;
    }
    if (!agentRunInput || !agentRunInput.applyResult || pendingControlledCommandRunRequestId || controlledCommandRunCorrelationRef.current) {
      setControlledCommandRunNote("Controlled Agent Run verification is not ready or already pending.");
      return;
    }
    if (controlledAgentCommandRunRequest.state !== "ready" || !controlledAgentCommandRunRequest.bridgeRequest || !controlledAgentCommandRunRequest.correlation) {
      setControlledCommandRunNote(controlledAgentCommandRunRequest.diagnostics[0]?.message ?? "Controlled Agent Run verification request is not ready.");
      return;
    }
    if (controlledAgentCommandRunRequest.correlation.commandId !== commandId) {
      setControlledCommandRunNote("Controlled Agent Run verification command id does not match the current run metadata.");
      return;
    }
    controlledCommandRunCorrelationRef.current = controlledAgentCommandRunRequest.correlation;
    controlledCommandRunCompletedRequestIdRef.current = null;
    agentRunVerificationCorrelationRef.current = { requestId: controlledAgentCommandRunRequest.correlation.requestId, runId: controlledAgentCommandRunRequest.correlation.runId, commandId };
    agentRunVerificationChatIdRef.current = chatIdRef.current;
    setPendingControlledCommandRunRequestId(controlledAgentCommandRunRequest.bridgeRequest.requestId);
    setControlledCommandRunResultMetadata(null);
    setControlledCommandRunNote("Controlled Agent Run verification request posted after explicit user click.");
    setAgentRunVerificationRequest({ requested: true, source: "user", requestId: controlledAgentCommandRunRequest.bridgeRequest.requestId });
    setAgentRunVerificationProgress({ status: "queued", summary: "Controlled Agent Run verification request posted." });
    agentRunVerificationResultRef.current = null;
    setAgentRunVerificationResult(null);
    setAgentRunVerificationFixDraft(null);
    bridgeAdapterRef.current?.post(controlledAgentCommandRunRequest.bridgeRequest);
    addTimeline(`Controlled Agent Run verification requested ${controlledAgentCommandRunRequest.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.commandPlanned", title: "Controlled Agent Run verification requested", status: "pending", summary: "User clicked explicit controlled Agent Run verification.", requestId: controlledAgentCommandRunRequest.bridgeRequest.requestId, details: controlledAgentCommandRunRequest.details });
  }, [addTimeline, agentRunInput, appendTrace, bridgeHost, controlledAgentCommandRunRequest, pendingControlledCommandRunRequestId]);

  const requestControlledLexicalSearch = useCallback(() => {
    if (controlledAgentLexicalSearchRequest.state !== "ready" || !controlledAgentLexicalSearchRequest.bridgeRequest || !controlledAgentLexicalSearchRequest.correlation || controlledLexicalSearchCorrelationRef.current) {
      return;
    }
    controlledLexicalSearchCorrelationRef.current = controlledAgentLexicalSearchRequest.correlation;
    setControlledLexicalSearchResult(undefined);
    setControlledLexicalSearchResultId(undefined);
    setSelectedControlledSearchResultIds([]);
    bridgeAdapterRef.current?.post(controlledAgentLexicalSearchRequest.bridgeRequest);
    addTimeline(`Controlled lexical search requested ${controlledAgentLexicalSearchRequest.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.fileReadPlanned", title: "Controlled lexical search requested", status: "pending", summary: "User clicked explicit controlled lexical search; sanitized snippet metadata only is expected.", requestId: controlledAgentLexicalSearchRequest.bridgeRequest.requestId, details: controlledAgentLexicalSearchRequest.details });
  }, [addTimeline, appendTrace, controlledAgentLexicalSearchRequest]);

  const requestControlledVerificationBundle = useCallback(() => {
    setControlledVerificationBundleRequest(controlledAgentVerificationBundleRequest);
    if (controlledAgentVerificationBundleRequest.state !== "ready" || !controlledAgentVerificationBundleRequest.bridgeRequest || !controlledAgentVerificationBundleRequest.correlation || controlledVerificationBundleCorrelationRef.current || pendingControlledVerificationBundleRequestId) {
      setControlledVerificationBundleNote(controlledAgentVerificationBundleRequest.diagnostics[0]?.message ?? "Verification bundle request is not ready.");
      return;
    }
    controlledVerificationBundleCorrelationRef.current = controlledAgentVerificationBundleRequest.correlation;
    controlledVerificationBundleCompletedRequestIdRef.current = null;
    setPendingControlledVerificationBundleRequestId(controlledAgentVerificationBundleRequest.bridgeRequest.requestId);
    setControlledVerificationBundleResult(undefined);
    setControlledVerificationBundleSourceResult(undefined);
    setControlledVerificationBundleAcceptedCorrelation(null);
    setControlledVerificationFollowupDraft(null);
    setControlledVerificationBundleNote("Verification bundle request posted after explicit user click.");
    bridgeAdapterRef.current?.post(controlledAgentVerificationBundleRequest.bridgeRequest);
    addTimeline(`Controlled verification bundle requested ${controlledAgentVerificationBundleRequest.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.verificationBundleRequested", title: "Controlled verification bundle requested", status: "pending", summary: "User clicked explicit controlled verification bundle run.", requestId: controlledAgentVerificationBundleRequest.bridgeRequest.requestId, details: controlledAgentVerificationBundleRequest.details });
  }, [addTimeline, appendTrace, controlledAgentVerificationBundleRequest, pendingControlledVerificationBundleRequestId]);

  const draftControlledVerificationFollowup = useCallback((userSelectedNextAction: ControlledAgentVerificationFollowupAction) => {
    const result = buildControlledAgentVerificationFollowup({
      current: controlledVerificationBundleAcceptedCorrelation,
      bundleResult: controlledVerificationBundleSourceResult,
      userSelectedNextAction,
    });
    if (result.state !== "ready" || !result.draft) {
      setControlledVerificationFollowupDraft(null);
      setControlledVerificationBundleNote(result.diagnostics[0]?.message ?? "Verification follow-up draft was blocked.");
      chatInputRef.current?.focus();
      return;
    }
    const draft = result.draft;
    setControlledVerificationFollowupDraft(draft);
    setChatInput(controlledVerificationFollowupPrompt(draft));
    setControlledVerificationBundleNote(`${draft.followupProposal.title} created as a local draft. Review it, then click Send yourself if wanted.`);
    chatInputRef.current?.focus();
    appendTrace({ family: "controlledAgent.verificationFollowupDrafted", title: draft.followupProposal.title, status: "info", summary: "Sanitized verification follow-up prompt drafted locally after explicit click.", details: result.details });
  }, [appendTrace, controlledVerificationBundleAcceptedCorrelation, controlledVerificationBundleSourceResult]);


  const confirmControlledMultifileApplyReview = useCallback(() => {
    setControlledMultifileApplyConfirmed(true);
    setControlledMultifileApplyNote("Multi-file apply review confirmed. Use the explicit apply button only if the bounded VS Code request is ready.");
  }, []);

  const requestControlledMultifileApply = useCallback(() => {
    if (controlledAgentMultifileApplyRequest.state !== "ready" || !controlledAgentMultifileApplyRequest.bridgeRequest || !controlledAgentMultifileApplyRequest.correlation || controlledMultifileApplyCorrelationRef.current || pendingControlledMultifileApplyRequestId) {
      setControlledMultifileApplyNote(controlledAgentMultifileApplyRequest.diagnostics[0]?.message ?? "Multi-file apply request is not ready.");
      return;
    }
    controlledMultifileApplyCorrelationRef.current = controlledAgentMultifileApplyRequest.correlation;
    controlledMultifileApplyCompletedRequestIdRef.current = null;
    setPendingControlledMultifileApplyRequestId(controlledAgentMultifileApplyRequest.bridgeRequest.requestId);
    setControlledMultifileApplyResult(undefined);
    setControlledMultifileApplyNote("Multi-file apply request posted after explicit user click.");
    bridgeAdapterRef.current?.post(controlledAgentMultifileApplyRequest.bridgeRequest);
    addTimeline(`Controlled multi-file apply requested ${controlledAgentMultifileApplyRequest.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.editPending", title: "Controlled multi-file apply requested", status: "pending", summary: "User clicked explicit VS Code-only bounded multi-file apply.", requestId: controlledAgentMultifileApplyRequest.bridgeRequest.requestId, details: controlledAgentMultifileApplyRequest.details });
  }, [addTimeline, appendTrace, controlledAgentMultifileApplyRequest, pendingControlledMultifileApplyRequestId]);

  const updateControlledSearchSelection = useCallback((resultId: string, selected: boolean) => {
    setSelectedControlledSearchResultIds((current) => {
      const without = current.filter((item) => item !== resultId);
      return selected ? [...without, resultId] : without;
    });
  }, []);

  const postOneStepEditRequest = useCallback(() => {
    const request = oneStepEditRequestRef.current;
    if (!request || request.state !== "ready" || !request.bridgeRequest || !request.correlation || controlledEditCorrelationRef.current || pendingControlledEditRequestId) {
      setControlledEditNote(request?.diagnostics[0]?.message ?? "One-step controlled edit request is not ready.");
      setOneStepLoopState((current) => reduceControlledOneStepAgentLoopState(current, { type: "edit", metadata: undefined }));
      return;
    }
    controlledEditCorrelationRef.current = request.correlation;
    controlledEditCompletedRequestIdRef.current = null;
    oneStepEditRequestIdRef.current = request.bridgeRequest.requestId;
    setPendingControlledEditRequestId(request.bridgeRequest.requestId);
    setControlledEditResultMetadata(null);
    setControlledEditNote("One-step controlled edit request posted after explicit Start.");
    bridgeAdapterRef.current?.post(request.bridgeRequest);
    addTimeline(`S86 one-step controlled edit requested ${request.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.editPending", title: "S86 one-step controlled edit requested", status: "pending", summary: "One-step run posted one bounded controlled edit request.", requestId: request.bridgeRequest.requestId, details: request.details });
  }, [addTimeline, appendTrace, pendingControlledEditRequestId]);

  const postOneStepCommandRunRequest = useCallback(() => {
    const request = oneStepCommandRunRequestRef.current;
    if (!request || request.state !== "ready" || !request.bridgeRequest || !request.correlation || controlledCommandRunCorrelationRef.current || pendingControlledCommandRunRequestId) {
      setControlledCommandRunNote(request?.diagnostics[0]?.message ?? "One-step controlled verification request is not ready.");
      setOneStepLoopState((current) => reduceControlledOneStepAgentLoopState(current, { type: "verification", metadata: undefined }));
      return;
    }
    controlledCommandRunCorrelationRef.current = request.correlation;
    controlledCommandRunCompletedRequestIdRef.current = null;
    oneStepCommandRunRequestIdRef.current = request.bridgeRequest.requestId;
    setPendingControlledCommandRunRequestId(request.bridgeRequest.requestId);
    setControlledCommandRunResultMetadata(null);
    setControlledCommandRunNote("One-step controlled verification request posted after bounded edit success.");
    bridgeAdapterRef.current?.post(request.bridgeRequest);
    addTimeline(`S86 one-step controlled verification requested ${request.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.commandPlanned", title: "S86 one-step controlled verification requested", status: "pending", summary: "One-step run posted one allowlisted controlled verification request.", requestId: request.bridgeRequest.requestId, details: request.details });
  }, [addTimeline, appendTrace, pendingControlledCommandRunRequestId]);

  const startOneStepAgentRun = useCallback(() => {
    const readRequest = oneStepFileReadRequestRef.current;
    const editRequest = oneStepEditRequestRef.current;
    const commandRequest = oneStepCommandRunRequestRef.current;
    if (bridgeHost !== "vscode" || !readRequest || !editRequest || !commandRequest || readRequest.state !== "ready" || editRequest.state !== "ready" || commandRequest.state !== "ready" || !readRequest.bridgeRequest || !readRequest.correlation || controlledFileReadCorrelationRef.current || controlledEditCorrelationRef.current || controlledCommandRunCorrelationRef.current || pendingControlledFileReadRequestId || pendingControlledEditRequestId || pendingControlledCommandRunRequestId) {
      setControlledFileReadNote("S86 one-step Start requires VS Code and ready controlled read, edit, and verification metadata.");
      return;
    }
    oneStepLoopRunCounterRef.current += 1;
    oneStepFileReadRequestIdRef.current = readRequest.bridgeRequest.requestId;
    oneStepEditRequestIdRef.current = null;
    oneStepCommandRunRequestIdRef.current = null;
    controlledFileReadCorrelationRef.current = readRequest.correlation;
    controlledFileReadCompletedRequestIdRef.current = null;
    setPendingControlledFileReadRequestId(readRequest.bridgeRequest.requestId);
    setControlledFileReadResultMetadata(null);
    setControlledEditResultMetadata(null);
    setControlledCommandRunResultMetadata(null);
    setControlledFileReadNote("S86 one-step controlled read request posted after explicit Start.");
    setControlledEditNote(null);
    setControlledCommandRunNote(null);
    let next = createControlledOneStepAgentLoopState();
    next = reduceControlledOneStepAgentLoopState(next, { type: "start", metadata: { source: "gui", confirmedBy: "user", assistantMinted: false, explicitUserStart: true, requestId: `s86-one-step-${oneStepLoopRunCounterRef.current}`, summary: "Explicit S86 one-step Agent Run start recorded." } });
    setOneStepLoopState(next);
    bridgeAdapterRef.current?.post(readRequest.bridgeRequest);
    addTimeline(`S86 one-step controlled read requested ${readRequest.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.fileReadPlanned", title: `S86 one-step controlled read requested ${oneStepLoopRunCounterRef.current}`, status: "pending", summary: "User clicked Start one-step Agent Run; one bounded read was posted.", requestId: readRequest.bridgeRequest.requestId, details: readRequest.details });
  }, [addTimeline, appendTrace, bridgeHost, pendingControlledCommandRunRequestId, pendingControlledEditRequestId, pendingControlledFileReadRequestId]);

  const stopOneStepAgentRun = useCallback(() => {
    controlledFileReadCorrelationRef.current = null;
    controlledEditCorrelationRef.current = null;
    controlledCommandRunCorrelationRef.current = null;
    oneStepFileReadRequestIdRef.current = null;
    oneStepEditRequestIdRef.current = null;
    oneStepCommandRunRequestIdRef.current = null;
    agentRunVerificationCorrelationRef.current = null;
    agentRunVerificationChatIdRef.current = null;
    setPendingControlledFileReadRequestId(null);
    setPendingControlledEditRequestId(null);
    setPendingControlledCommandRunRequestId(null);
    setControlledFileReadNote("S86 one-step run stopped in the GUI. Stale read results will be ignored.");
    setControlledEditNote("S86 one-step run stopped in the GUI. Stale edit results will be ignored.");
    setControlledCommandRunNote("S86 one-step run stopped in the GUI. Stale verification results will be ignored.");
    setOneStepLoopState((current) => reduceControlledOneStepAgentLoopState(current, { type: "stop", summary: "One-step run stopped in the GUI. Stale host results will be ignored." }));
  }, []);

  const submitControlledFileRead = useCallback(() => {
    if (controlledAgentFileReadRequest.state !== "ready" || !controlledAgentFileReadRequest.bridgeRequest || !controlledAgentFileReadRequest.correlation || pendingControlledFileReadRequestId) {
      setControlledFileReadNote(controlledAgentFileReadRequest.diagnostics[0]?.message ?? "Controlled read request is not ready.");
      return;
    }
    controlledFileReadCorrelationRef.current = controlledAgentFileReadRequest.correlation;
    controlledFileReadCompletedRequestIdRef.current = null;
    setPendingControlledFileReadRequestId(controlledAgentFileReadRequest.bridgeRequest.requestId);
    setControlledFileReadResultMetadata(null);
    setControlledFileReadNote("Controlled read request posted after explicit user click.");
    bridgeAdapterRef.current?.post(controlledAgentFileReadRequest.bridgeRequest);
    addTimeline(`Controlled read requested ${controlledAgentFileReadRequest.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.fileReadPlanned", title: "Controlled file read requested", status: "pending", summary: "User clicked explicit controlled read request.", requestId: controlledAgentFileReadRequest.bridgeRequest.requestId, details: controlledAgentFileReadRequest.details });
  }, [addTimeline, appendTrace, controlledAgentFileReadRequest, pendingControlledFileReadRequestId]);

  const submitControlledEdit = useCallback(() => {
    if (controlledAgentPatchPlanPreview && (controlledAgentPatchPlanPreview.state !== "ready" || !controlledPatchPlanConfirmed)) {
      setControlledEditNote(controlledAgentPatchPlanPreview.state === "ready" ? "Confirm the dry-run patch plan preview before requesting the controlled edit." : "Controlled edit request blocked because dry-run patch plan preview is non-actionable.");
      return;
    }
    if (controlledAgentEditRequest.state !== "ready" || !controlledAgentEditRequest.bridgeRequest || !controlledAgentEditRequest.correlation || pendingControlledEditRequestId) {
      setControlledEditNote(controlledAgentEditRequest.diagnostics[0]?.message ?? "Controlled edit request is not ready.");
      return;
    }
    controlledEditCorrelationRef.current = controlledAgentEditRequest.correlation;
    controlledEditCompletedRequestIdRef.current = null;
    setPendingControlledEditRequestId(controlledAgentEditRequest.bridgeRequest.requestId);
    setControlledEditResultMetadata(null);
    setControlledEditNote("Controlled edit request posted after explicit user click.");
    bridgeAdapterRef.current?.post(controlledAgentEditRequest.bridgeRequest);
    addTimeline(`Controlled edit requested ${controlledAgentEditRequest.bridgeRequest.requestId}`);
    appendTrace({ family: "controlledAgent.editPending", title: "Controlled edit requested", status: "pending", summary: "User clicked explicit controlled edit request.", requestId: controlledAgentEditRequest.bridgeRequest.requestId, details: controlledAgentEditRequest.details });
  }, [addTimeline, appendTrace, controlledAgentEditRequest, controlledAgentPatchPlanPreview, controlledPatchPlanConfirmed, pendingControlledEditRequestId]);

  const requestIdeAction = useCallback((payload: IdeActionRequestPayload, requestIdPrefix = "gui-ide-action") => {
    if ((bridgeHost !== "vscode" && bridgeHost !== "jetbrains") || pendingIdeActionRequestIdRef.current) {
      return;
    }
    ideActionCounterRef.current += 1;
    const requestId = `${requestIdPrefix}-${ideActionCounterRef.current}`;
    const label = ideActionLabel(payload.action);
    pendingIdeActionRequestIdRef.current = requestId;
    pendingIdeActionChatIdRef.current = chatIdRef.current;
    setIdeActionNote(null);
    setIdeActionAttempt({
      requestId,
      action: payload.action,
      label,
      status: "pending",
      message: `${label} requested.`,
      workspaceRelativePath: "workspaceRelativePath" in payload ? payload.workspaceRelativePath : undefined,
      range: "range" in payload ? payload.range : undefined,
    });
    bridgeAdapterRef.current?.post({
      version: GUI_BRIDGE_VERSION,
      type: "gui.ideActionRequest",
      requestId,
      payload,
    });
    addTimeline(`IDE action requested ${requestId}`);
    appendTrace({ family: payload.action === "runVerificationCommand" ? "verification.runRequested" : "ide.request", title: payload.action === "runVerificationCommand" ? "Verification command requested" : "IDE action requested", status: "pending", summary: `${label} requested.`, requestId, details: { action: payload.action, commandId: "commandId" in payload ? payload.commandId : undefined, workspaceRelativePath: "workspaceRelativePath" in payload ? payload.workspaceRelativePath : undefined } });
  }, [addTimeline, appendTrace, bridgeHost]);

  const searchWorkspaceSnippets = () => {
    const validation = workspaceSnippetQueryValidation;
    if (!validation.valid) {
      setWorkspaceSnippetStatus(validation.message);
      return;
    }
    if (bridgeHost !== "vscode" && bridgeHost !== "jetbrains") {
      setWorkspaceSnippetStatus("Browser preview only. Open Yet AI in VS Code or JetBrains to search local workspace snippets.");
      return;
    }
    setWorkspaceSnippetResult(null);
    setSelectedWorkspaceSnippetKeys([]);
    setWorkspaceSnippetStatus(`Searching local workspace snippets for ${validation.query}. Select snippets from the result list, then attach them explicitly.`);
    requestIdeAction({ action: "searchWorkspaceSnippets", query: validation.query }, "gui-workspace-snippet-search");
  };

  const attachSelectedWorkspaceSnippetsToBundle = () => {
    if (!workspaceSnippetResult || selectedWorkspaceSnippetKeys.length === 0) {
      setWorkspaceSnippetStatus("Select at least one snippet before attaching.");
      return;
    }
    const selected = workspaceSnippetResult.snippets.filter((snippet) => selectedWorkspaceSnippetKeys.includes(workspaceSnippetToBundleItem(snippet).key));
    setExplicitContextBundleItems((current) => {
      let next = current;
      for (const snippet of selected) {
        next = addExplicitContextBundleItem(next, workspaceSnippetToBundleItem(snippet));
      }
      if (next === current) {
        setWorkspaceSnippetStatus(`Selected snippets are already attached or the bundle is full; max ${explicitContextBundleMaxItems} items.`);
        return current;
      }
      const addedCount = next.length - current.length;
      setIncludeExplicitContextBundle(true);
      setExplicitContextBundleStatus(`Added ${addedCount} project snippet${addedCount === 1 ? "" : "s"} to the one-shot bundle.`);
      setWorkspaceSnippetStatus(`Attached ${addedCount} selected project snippet${addedCount === 1 ? "" : "s"} to the next message context. The bundle is one-shot and clears after accepted Send; use Remove snippet to detach before sending.`);
      setSelectedWorkspaceSnippetKeys([]);
      appendTrace({ family: "context.snippets", title: "Project snippets attached", status: "succeeded", summary: `Attached ${addedCount} selected project snippet${addedCount === 1 ? "" : "s"} to the next message context.`, details: { addedCount } });
      return next;
    });
  };

  const refreshProjectMemory = useCallback(async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProjectMemory((current) => ({ ...current, state: "loading", error: null }));
    const result = await listProjectMemory(targetSettings);
    if (!isCurrentRefresh(targetRevision)) {
      return;
    }
    if (result.ok) {
      setProjectMemory({ state: "idle", notes: result.data.notes ?? [], error: null });
      setProjectMemoryStatus(`${result.data.notes?.length ?? 0} local memory note${(result.data.notes?.length ?? 0) === 1 ? "" : "s"} loaded.`);
    } else {
      setProjectMemory({ state: "error", notes: [], error: result.error });
      setProjectMemoryStatus("Project memory unavailable from the local runtime.");
    }
  }, [isCurrentRefresh]);

  const createProjectMemoryNote = async () => {
    const title = projectMemoryTitle.trim();
    const text = projectMemoryText.trim();
    if (!title || !text) {
      setProjectMemoryStatus("Enter a title and bounded note text before saving local memory.");
      return;
    }
    const tags = projectMemoryTags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 10);
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProjectMemory((current) => ({ ...current, state: "saving", error: null }));
    const result = await createProjectMemory(targetSettings, { title, text, tags, source: "manual" });
    if (!isCurrentRefresh(targetRevision)) {
      return;
    }
    if (result.ok) {
      setProjectMemoryTitle("");
      setProjectMemoryText("");
      setProjectMemoryTags("");
      setProjectMemory((current) => ({ state: "idle", notes: [result.data, ...current.notes.filter((note) => note.id !== result.data.id)], error: null }));
      setProjectMemoryStatus(`Saved local memory note ${sanitizeDisplayText(result.data.title)}.`);
    } else {
      setProjectMemory((current) => ({ ...current, state: "error", error: result.error }));
      setProjectMemoryStatus("Could not save local memory note.");
    }
  };

  const searchProjectMemoryNotes = async () => {
    const query = projectMemoryQuery.trim();
    if (!query) {
      await refreshProjectMemory();
      return;
    }
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProjectMemory((current) => ({ ...current, state: "searching", error: null }));
    const result = await searchProjectMemory(targetSettings, query);
    if (!isCurrentRefresh(targetRevision)) {
      return;
    }
    if (result.ok) {
      const notes = result.data.matches?.map((item) => item.note) ?? [];
      setProjectMemory({ state: "idle", notes, error: null });
      setProjectMemoryStatus(`${notes.length} local memory note${notes.length === 1 ? "" : "s"} matched ${sanitizeDisplayText(result.data.queryLabel ?? query)}.`);
    } else {
      setProjectMemory((current) => ({ ...current, state: "error", error: result.error }));
      setProjectMemoryStatus("Could not search local memory notes.");
    }
  };

  const deleteProjectMemoryNote = async (note: ProjectMemoryNote) => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProjectMemory((current) => ({ ...current, state: "deleting", error: null }));
    const result = await deleteProjectMemory(targetSettings, note.id);
    if (!isCurrentRefresh(targetRevision)) {
      return;
    }
    if (result.ok) {
      setProjectMemory((current) => ({ state: "idle", notes: current.notes.filter((item) => item.id !== note.id), error: null }));
      setExplicitContextBundleItems((current) => current.filter((item) => !(item.kind === "project_memory" && item.noteId === note.id)));
      setProjectMemoryStatus(`Deleted local memory note ${sanitizeDisplayText(note.title)}.`);
    } else {
      setProjectMemory((current) => ({ ...current, state: "error", error: result.error }));
      setProjectMemoryStatus("Could not delete local memory note.");
    }
  };

  const attachProjectMemoryNote = (note: ProjectMemoryNote, suggestion?: TaskMemorySuggestion) => {
    const taskLabel = createTaskMemoryLabel(note.taskLabel, codingTaskGoal);
    const sessionLabel = createSessionMemoryLabel(note.sessionLabel, chatId);
    const attachTraceLabel = createLinkedMemoryAttachTraceLabel(chatId, note.id);
    const item = projectMemoryToBundleItem({ kind: "project_memory", noteId: note.id, title: note.title, text: note.text, tags: note.tags, taskLabel, sessionLabel, attachTraceLabel });
    setExplicitContextBundleItems((current) => {
      const next = addExplicitContextBundleItem(current, item);
      if (next === current) {
        setProjectMemoryStatus(current.some((existing) => existing.key === item.key) ? "This memory note is already attached." : `Bundle limit reached. Remove an item before attaching memory; max ${explicitContextBundleMaxItems} items.`);
        return current;
      }
      setIncludeExplicitContextBundle(true);
      setExplicitContextBundleStatus(`Added task-linked local memory note ${sanitizeDisplayText(note.title)} to the one-shot bundle. Trace label: ${attachTraceLabel}.`);
      setProjectMemoryStatus(`Attached task-linked local memory note ${sanitizeDisplayText(note.title)} to the next message context. Trace label: ${attachTraceLabel}.`);
      appendTrace({
        family: "context.memory",
        title: "Task-linked project memory attached",
        status: "succeeded",
        summary: `Attached task-linked local memory note ${sanitizeDisplayText(note.title)} to the next message context.`,
        details: {
          memoryLabel: sanitizeDisplayText(note.title),
          taskLabel,
          sessionLabel,
          attachTraceLabel,
          attachedMemoryCount: attachedProjectMemoryCount + 1,
          ...(createMemorySuggestionAttachTraceDetails(suggestion) ?? {}),
        },
      });
      return next;
    });
  };

  useEffect(() => {
    if (runtimeConnected) {
      void refreshProjectMemory();
    } else {
      setProjectMemory({ state: "idle", notes: [], error: null });
      setProjectMemoryStatus(null);
    }
  }, [refreshProjectMemory, runtimeConnected, settingsRevision]);

  useEffect(() => {
    if (ideActionProposalReview.state !== "valid") {
      if (ideActionProposalReview.state === "rejected") {
        appendTrace({ family: "ide.result", title: "IDE action proposal rejected", status: "rejected", summary: ideActionProposalReview.diagnostic.message, details: { sourceMessageId: ideActionProposalReview.sourceMessageId, reason: ideActionProposalReview.diagnostic.reasonCode } });
      }
      ideActionProposalIdentityRef.current = null;
      setIdeActionProposal(null);
      return;
    }
    const ideActionProposalCandidate = ideActionProposalReview.candidate;
    const existing = ideActionProposalIdentityRef.current;
    let requestId = ideActionProposalIdentityMatchesCandidate(existing, ideActionProposalCandidate) ? existing.requestId : null;
    if (!requestId) {
      ideActionProposalCounterRef.current += 1;
      requestId = `gui-ide-proposal-`;
      ideActionProposalIdentityRef.current = {
        requestId,
        sourceMessageId: ideActionProposalCandidate.sourceMessageId,
        payloadKey: ideActionProposalCandidate.payloadKey,
      };
    }
    const nextProposal = { ...ideActionProposalCandidate, requestId };
    setIdeActionProposal((current) => ideActionProposalMatchesCandidate(current, ideActionProposalCandidate) && current.requestId === requestId ? current : nextProposal);
  }, [appendTrace, ideActionProposalReview]);

  useEffect(() => {
    const review = latestEditProposalReviewFromMessages(chatView.messages);
    if (review.state !== "valid") {
      if (review.state === "rejected") {
        const rejectedTraceKey = `${review.sourceMessageId}:${review.diagnostic.reasonCode}`;
        if (editProposalRejectedTraceKeyRef.current !== rejectedTraceKey) {
          editProposalRejectedTraceKeyRef.current = rejectedTraceKey;
          appendTrace({ family: "edit.rejected", title: "Edit proposal rejected", status: "rejected", summary: review.diagnostic.message, details: { sourceMessageId: review.sourceMessageId, reason: review.diagnostic.reasonCode } });
        }
      }
      clearEditProposalState();
      return;
    }
    const candidate = review.candidate;
    const existing = editProposalIdentityRef.current;
    const stableRequestId = existing && editProposalCandidateIdentityMatches(existing, candidate) ? existing.requestId : null;
    const proposal = stableRequestId
      ? { requestId: stableRequestId, payload: candidate.proposal, sourceMessageId: candidate.sourceMessageId, payloadKey: candidate.payloadKey }
      : (() => {
          editProposalCounterRef.current += 1;
          const requestId = `gui-edit-proposal-${editProposalCounterRef.current}`;
          editProposalIdentityRef.current = { requestId, sourceMessageId: candidate.sourceMessageId, payloadKey: candidate.payloadKey };
          return { requestId, payload: candidate.proposal, sourceMessageId: candidate.sourceMessageId, payloadKey: candidate.payloadKey };
        })();
    setEditProposal((current) => current?.requestId === proposal.requestId ? current : proposal);
    setApplyResult((current) => current?.proposalRequestId === proposal.requestId ? current : null);
    if (!stableRequestId) {
      appendTrace({ family: "edit.detected", title: "Edit proposal detected", status: "info", summary: candidate.proposal.summary, requestId: proposal.requestId, details: { sourceMessageId: candidate.sourceMessageId, fileCount: candidate.proposal.edits.length } });
    }
    if (pendingApplyRequestIdRef.current && pendingApplyProposalRequestIdRef.current !== proposal.requestId) {
      pendingApplyRequestIdRef.current = null;
      pendingApplyProposalRequestIdRef.current = null;
      setPendingApplyRequestId(null);
    }
  }, [appendTrace, chatView.messages, clearEditProposalState]);

  const applyCodingAction = (action: CodingAction) => {
    if (!currentAttachedContext || !codingActionsCanUseContext) {
      chatInputRef.current?.focus();
      return;
    }
    setAttachedContext({ payload: currentAttachedContext, settingsRevision: settingsRevisionRef.current, chatId: chatIdRef.current });
    setChatInput(action.buildPrompt(currentAttachedContext));
    setIncludeAttachedContext(true);
    chatInputRef.current?.focus();
  };

  const applyActiveFilePrompt = (action: ActiveFilePromptAction) => {
    if (!currentActiveFileExcerpt || !currentAttachedContext) {
      chatInputRef.current?.focus();
      return;
    }
    setAttachedContext({ payload: currentAttachedContext, settingsRevision: settingsRevisionRef.current, chatId: chatIdRef.current, excerpt: currentActiveFileExcerpt });
    setChatInput(action.prompt);
    setIncludeAttachedContext(true);
    chatInputRef.current?.focus();
  };

  const focusCodingTaskPrompt = () => {
    chatInputRef.current?.focus();
  };

  const buildCodingTaskDraft = (mode: CodingTaskPromptMode) => buildCodingTaskPrompt({ mode, goal: codingTaskGoal, contextItems: explicitContextBundleItems, providerReadiness: chatReadinessLabel });

  const useCodingTaskDraftPrompt = (mode: CodingTaskPromptMode) => {
    setChatInput(buildCodingTaskDraft(mode));
    chatInputRef.current?.focus();
  };

  const useCodingTaskDraftPlan = () => {
    setManualRunnerDraftPlan(buildCodingTaskDraft("implementation_plan"));
  };

  const draftOneStepModelProposalPrompt = () => {
    const draft = buildOneStepModelProposalPrompt({ mode: "safe_edit", goal: codingTaskGoal, contextItems: explicitContextBundleItems, providerReadiness: chatReadinessLabel });
    modelProposalDraftCounterRef.current += 1;
    setModelProposalDraft({ ...draft, draftId: `model-proposal-draft-${modelProposalDraftCounterRef.current}` });
    setSubmittedModelProposalPrompt(null);
    setChatInput(draft.prompt);
    chatInputRef.current?.focus();
  };

  const addActiveFileExcerptToBundle = () => {
    if (!currentActiveFileExcerpt) {
      return;
    }
    const nextItem = activeFileExcerptToBundleItem(currentActiveFileExcerpt);
    setExplicitContextBundleItems((current) => {
      const next = addExplicitContextBundleItem(current, nextItem);
      if (next === current) {
        setExplicitContextBundleStatus(current.some((item) => item.key === nextItem.key) ? "This excerpt is already in the one-shot bundle." : `Bundle limit reached. Remove an item before adding another; max ${explicitContextBundleMaxItems} excerpts.`);
        return current;
      }
      setIncludeExplicitContextBundle(true);
      setExplicitContextBundleStatus(`Added ${activeFileExcerptSummary(currentActiveFileExcerpt)} to the one-shot bundle.`);
      return next;
    });
  };

  const removeExplicitContextBundleItem = (key: string, status = "Removed one excerpt from the one-shot bundle.") => {
    setExplicitContextBundleItems((current) => current.filter((item) => item.key !== key));
    if (attachedVerificationKey === key) {
      setAttachedVerificationKey(null);
    }
    setExplicitContextBundleStatus(status);
  };

  const detachProjectMemoryNote = (noteId: string, title: string) => {
    const item = explicitContextBundleItems.find((current): current is ProjectMemoryBundleItem => current.kind === "project_memory" && current.noteId === noteId);
    if (!item) {
      setProjectMemoryStatus("This memory note is not attached to the one-shot bundle.");
      return;
    }
    removeExplicitContextBundleItem(item.key, `Detached local memory note ${sanitizeDisplayText(title)} from the one-shot bundle.`);
    setProjectMemoryStatus(`Detached local memory note ${sanitizeDisplayText(title)} from the next message context.`);
  };

  const useVerificationFollowupDraft = (result: IdeActionResultPayload, mode: VerificationFollowupPromptMode) => {
    if (!isVerificationOutputResult(result)) {
      return;
    }
    setChatInput(buildVerificationFollowupPrompt(result, mode));
    chatInputRef.current?.focus();
    appendTrace({ family: "verification.followupPromptDrafted", title: mode === "fix" ? "Verification fix prompt drafted" : "Verification follow-up prompt drafted", status: "info", summary: `Drafted ${mode} prompt from verification result.`, details: { commandId: result.commandId, status: result.status, exitCode: result.exitCode } });
  };

  const useAgentRunVerificationFollowupDraft = (mode: VerificationFollowupPromptMode) => {
    const result = agentRunVerificationPromptResult(agentRunInput, mode);
    if (!result) {
      chatInputRef.current?.focus();
      return;
    }
    const draftId = mode === "fix" && agentRunInput?.verificationRequest?.requestId ? `fix-draft-${agentRunInput.verificationRequest.requestId}` : undefined;
    const draft = buildVerificationFollowupPromptDraft(result, mode, {
      priorProposal: agentRunInput?.proposal,
      proposalHistory,
      planPreview: agentRunInput?.planPreview,
      touchedFiles: agentRunInput?.proposal?.touchedFiles ?? agentRunInput?.planPreview?.expectedTouchedFiles,
      sessionLabel: codingTaskSession.goal.label,
      verificationRequestId: agentRunInput?.verificationRequest?.requestId,
      followupDraftId: draftId,
    });
    setChatInput(draft.prompt);
    if (mode === "fix") {
      setAgentRunVerificationFixDraft({ present: true, awaitingManualSend: true, metadata: draft.metadata, label: "fix draft waiting for manual Send" });
    }
    chatInputRef.current?.focus();
    appendTrace({ family: "verification.followupPromptDrafted", title: mode === "fix" ? "Agent Run verification fix prompt drafted" : "Agent Run verification follow-up prompt drafted", status: "info", summary: `Drafted Agent Run ${mode} prompt from sanitized verification metadata.`, details: { commandId: result.commandId, status: result.status, exitCode: result.exitCode } });
  };

  const attachVerificationResultToBundle = (result: IdeActionResultPayload) => {
    if (!isVerificationOutputResult(result)) {
      return;
    }
    const key = verificationOutputKey(result);
    setExplicitContextBundleItems((current) => {
      const next = addExplicitContextBundleItem(current, {
        kind: "verification_output",
        commandId: result.commandId,
        status: result.status,
        exitCode: result.exitCode,
        outputTail: result.outputTail,
        truncated: result.truncated,
        key,
      });
      if (next === current) {
        setExplicitContextBundleStatus(current.some((item) => item.key === key) ? "This verification result is already in the one-shot bundle." : `Bundle limit reached. Remove an item before adding another; max ${explicitContextBundleMaxItems} items.`);
        return current;
      }
      setAttachedVerificationKey(key);
      setIncludeExplicitContextBundle(true);
      setExplicitContextBundleStatus(`Added ${result.commandId} verification output to the one-shot bundle.`);
      setChatInput((current) => current || `Use the attached verification_output from ${result.commandId} to explain the verification result and suggest the next safe step.`);
      chatInputRef.current?.focus();
      appendTrace({ family: "context.verificationAttachment", title: "Verification output attached", status: "succeeded", summary: `Added ${result.commandId} verification output to the one-shot bundle.`, details: { commandId: result.commandId, status: result.status, exitCode: result.exitCode, truncated: result.truncated } });
      return next;
    });
  };

  const submitChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content) {
      return;
    }

    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const targetChatId = chatIdRef.current;
    setChatError(null);
    if (!canSendChat) {
      const runtimeError: RuntimeError = {
        status: "configuration",
        message: "Chat is not ready for the current runtime settings. Refresh runtime and configure a provider/model before sending.",
      };
      setChatError(runtimeError);
      setChatLifecycleState("failed");
      appendChatError(runtimeError.message, chatRecoveryCodeForRuntimeError(runtimeError, "command"));
      addTimeline("Command blocked until current runtime settings are ready");
      return;
    }
    const attachedContextAllowed = currentAttachedContext && (currentActiveFileExcerpt || !attachedContextRequiresAcknowledgement(currentAttachedContext) || attachedContextAcknowledged);
    const submittedAttachedContext = includeAttachedContext && attachedContextAllowed && attachedContextRef.current?.settingsRevision === targetRevision && attachedContextRef.current.chatId === targetChatId && currentAttachedContext && hasUsableAttachedContext(currentAttachedContext) ? attachedContextRef.current : null;
    const submittedExplicitContextBundle = includeExplicitContextBundle ? explicitContextBundleToChatContext(explicitContextBundleItems) : undefined;
    const context = submittedExplicitContextBundle ?? (submittedAttachedContext?.excerpt ? activeFileExcerptToChatContext(submittedAttachedContext.excerpt) : submittedAttachedContext?.payload);
    setChatLifecycleState("command_submitting");
    optimisticUserMessageCounterRef.current += 1;
    appendTrace({ family: "chat.sendAccepted", title: "Send requested", status: "pending", summary: "User message submitted from the GUI.", details: { chatId: targetChatId, hasContext: Boolean(context), contextKind: context?.kind } });
    const optimisticUserMessageId = `${targetChatId}-optimistic-user-${optimisticUserMessageCounterRef.current}`;
    setChatView((current) => addAcceptedUserMessage(current, content, optimisticUserMessageId));
    setChatInput("");
    const result = await sendUserMessage(targetSettings, targetChatId, content, context);
    if (!isCurrentRefresh(targetRevision) || chatIdRef.current !== targetChatId) {
      setChatView((current) => removeOptimisticUserMessage(current, optimisticUserMessageId));
      return;
    }
    if (result.ok) {
      addTimeline(`Command accepted ${result.data.requestId}`);
      appendTrace({ family: "chat.sendAccepted", title: "Send accepted", status: "succeeded", summary: "Runtime accepted user message command.", requestId: result.data.requestId, details: { chatId: targetChatId, hasContext: Boolean(context), contextKind: context?.kind } });
      if (modelProposalDraft?.prompt === content) {
        setSubmittedModelProposalPrompt({ ...modelProposalDraft, chatId: targetChatId, runtimeSettingsVersion: String(targetRevision), userMessageId: optimisticUserMessageId, commandRequestId: result.data.requestId });
      } else {
        setSubmittedModelProposalPrompt(null);
      }
      clearSubmittedAttachedContext(submittedExplicitContextBundle ? null : submittedAttachedContext);
      if (submittedExplicitContextBundle) {
        clearExplicitContextBundle("One-shot explicit context bundle attached to the last accepted message and cleared.");
      }
      startSse(targetChatId);
      setChatLifecycleState((current) => current === "command_submitting" || current === "sse_connecting" ? "command_accepted" : current);
    } else {
      setChatError(result.error);
      setChatLifecycleState("failed");
      setChatInput(content);
      setChatView((current) => removeOptimisticUserMessage(current, optimisticUserMessageId));
      appendChatError(result.error.message, chatRecoveryCodeForRuntimeError(result.error, "command"));
      addTimeline(`Command error: ${sanitizeDisplayText(result.error.message)}`);
      appendTrace({ family: "chat.sendRejected", title: "Send rejected", status: "failed", summary: result.error.message, details: { chatId: targetChatId, status: result.error.status } });
    }
  };

  const demoModeToggleLabel = demoModeWorking ? "Changing Demo Mode…" : demoModeEnabled ? "Disable Demo Mode" : "Try Demo Mode";

  const firstMessageReadiness = useMemo<FirstMessageReadiness>(() => {
    const notes = [
      "Runtime Session token unlocks this GUI to the loopback runtime only; Provider API key unlocks the upstream model through the runtime. They are different secrets.",
      "OpenAI API-key fallback is the current safe/default real-provider path for first-message GPT; provider setup stays local-first BYOK with no Yet AI hosted backend, account, cloud workspace, or credit balance required.",
      "Demo Mode is only a try-without-provider-calls path: runtime-owned local canned responses, no API key, no provider calls, and not model quality.",
      "After saving or updating a provider: test provider, refresh runtime/model readiness, then send when the readiness card says Send is available.",
    ];
    const authStatus = activeProviderAuthStatus?.status;
    if (activeProviderAuthStatus?.configured && activeProviderAuthStatus.authSource === "oauth") {
      notes.push("Experimental account login is connected/available only as an explicit high-risk path; API-key providers remain the safe default when configured.");
      notes.push("If the first message fails through experimental account auth, review the sanitized error only: retry login, reconnect runtime, disconnect the account path, reduce attached context when the error says the request is too large, or switch to the API-key fallback.");
    } else if (authStatus === "login_available") {
      notes.push("Account login may be available, but it is not the default first-message path; use an API-key provider unless you intentionally choose the experimental flow.");
    } else if (authStatus === "api_key_configured") {
      notes.push("API-key fallback status is available locally; test the saved provider and refresh runtime/model readiness if Send is still disabled.");
    }
    if (!runtimeConnected) {
      const reason = activeConnectionError
        ? `Runtime ${activeConnectionError.status}: ${sanitizeDisplayText(activeConnectionError.message)}`
        : runtimeRefreshStatus?.state === "checking"
          ? "Runtime check is in progress or has not completed for the current settings."
          : "Runtime has not been checked for the current settings.";
      const ideRuntimeHint = bridgeHost === "jetbrains"
        ? " In JetBrains installed mode, also use Tools → Yet AI: Show Runtime Status or Restart Runtime if Refresh runtime keeps failing."
        : bridgeHost === "vscode"
          ? " In VS Code installed mode, the extension auto/launch/connect lifecycle supplies the runtime URL and token through trusted host.ready. Use Yet AI: Show Runtime Status if recovery keeps failing."
        : "";
      return {
        title: activeConnectionError?.status === 401 ? "Runtime authorization needs attention" : "Connect the local runtime first",
        reason,
        nextAction: hostedRuntimeConnection
          ? `Use Refresh runtime from this chat page; the IDE host will re-deliver trusted runtime settings automatically. If it still fails, use the IDE runtime status/restart command instead of copying a token.${ideRuntimeHint}`
          : `Use Refresh runtime from this chat page. If it still fails, fix the loopback URL or Session token in Local runtime connection.${ideRuntimeHint}`,
        actions: [{ kind: "refresh_runtime", label: runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime" }],
        notes,
      };
    }
    if (apiKeyChatReady) {
      return {
        title: activeSelectedDemoMode ? "Demo Mode is ready" : "Ready for your first message",
        reason: activeSelectedDemoMode ? "Send is enabled for local canned responses; this verifies chat UX without a provider API key." : `Send is enabled for ${selectedModelDisplayName ?? "the selected model"}${selectedModelProviderId ? ` through ${selectedModelProviderId}` : ""}.`,
        nextAction: activeSelectedDemoMode ? "Type a prompt and click Send to try the local flow without provider calls; configure a BYOK provider when you need real model quality." : "Type a prompt and click Send through the local runtime.",
        actions: [...(demoModeEnabled ? [{ kind: "enable_demo_mode" as const, label: demoModeToggleLabel }] : []), { kind: "send_first_message" as const, label: "Send first message" }],
        notes,
      };
    }
    if (experimentalOauthChatReady) {
      return {
        title: "Experimental account login can send",
        reason: "The account login fallback is connected only because no safer API-key/OpenAI-compatible, local, or Demo Mode chat path is ready; this private-endpoint path is not the safe/default provider setup.",
        nextAction: "Prefer configuring an API-key or local provider. If you send through this experimental path and the first message fails, use the sanitized error to choose one manual action: retry login, reconnect runtime, disconnect, reduce context if the request is too large, or switch to the API-key fallback.",
        actions: [{ kind: "api_key_fallback", label: "Use OpenAI API key fallback" }, { kind: "send_first_message", label: "Send first message" }],
        notes,
      };
    }
    if (providerAuthMutationInFlight && activeProviderAuthStatus?.authSource === "oauth") {
      return {
        title: "Account login is changing",
        reason: "Send is disabled while the local runtime updates account-login state and no API-key provider is ready.",
        nextAction: "Wait for the login operation, refresh login/runtime status, or use the API-key fallback.",
        actions: [{ kind: "refresh_runtime", label: "Refresh runtime" }, { kind: "api_key_fallback", label: "Use OpenAI API key fallback" }],
        notes,
      };
    }
    if (apiKeyReadiness.mismatch) {
      const providerId = apiKeyReadiness.provider?.id ?? enabledProviders[0]?.id;
      return {
        title: "Model and provider do not match",
        reason: apiKeyReadiness.message ?? "The runtime selected model does not map to one enabled provider with that model id.",
        nextAction: providerId ? "Test the saved provider, then refresh runtime after fixing the provider/model id." : "Configure an OpenAI-compatible provider, then refresh runtime.",
        actions: [
          { kind: "enable_demo_mode" as const, label: demoModeToggleLabel },
          ...(providerId ? [{ kind: "test_provider" as const, label: "Test provider", providerId }] : [{ kind: "api_key_fallback" as const, label: "Use OpenAI API key fallback" }]),
          { kind: "refresh_runtime", label: "Refresh runtime" },
        ],
        notes,
      };
    }
    if (apiKeyReadiness.model && apiKeyReadiness.message) {
      const providerId = apiKeyReadiness.provider?.id ?? enabledProviders[0]?.id;
      return {
        title: "Model is not ready yet",
        reason: apiKeyReadiness.message,
        nextAction: providerId ? "Test the provider, fix credentials/model readiness locally, then refresh runtime." : "Choose the API-key fallback or configure a usable OpenAI-compatible provider.",
        actions: [
          { kind: "enable_demo_mode" as const, label: demoModeToggleLabel },
          ...(providerId ? [{ kind: "test_provider" as const, label: "Test provider", providerId }] : [{ kind: "api_key_fallback" as const, label: "Use OpenAI API key fallback" }]),
          { kind: "refresh_runtime", label: "Refresh runtime" },
        ],
        notes,
      };
    }
    return {
      title: enabledProviders.length > 0 ? "Provider model required" : "Provider required for first message",
      reason: activeModelError
        ? "Runtime model refresh failed, so no send-ready model can be selected."
        : "No enabled local Ollama, OpenAI-compatible, or custom provider/model is ready for chat streaming. Demo Mode remains available only as a local canned-response trial.",
      nextAction: "For local answers without a provider key, choose Ollama local, confirm http://127.0.0.1:11434 and a pulled model id, save, test provider, refresh runtime/model readiness, then send. For hosted OpenAI-compatible answers, use the API-key fallback. Choose Demo Mode only to try the chat flow without provider calls.",
      actions: [{ kind: "enable_demo_mode", label: demoModeToggleLabel }, { kind: "api_key_fallback", label: "Use OpenAI API key fallback" }, { kind: "refresh_runtime", label: "Refresh runtime" }],
      notes,
    };
  }, [activeConnectionError, activeModelError, activeProviderAuthStatus, activeSelectedDemoMode, apiKeyChatReady, apiKeyReadiness, bridgeHost, demoModeToggleLabel, enabledProviders, experimentalOauthChatReady, hostedRuntimeConnection, providerAuthMutationInFlight, runtimeConnected, runtimeRefreshInFlight, runtimeRefreshStatus, selectedModelDisplayName, selectedModelProviderId]);
  const chatLifecycleLabel = chatLifecycleState === "idle"
    ? canSendChat
      ? activeSelectedDemoMode
        ? "Demo Mode ready — local canned responses, no provider calls. Ready to send."
        : "Ready to send."
      : runtimeConnected
        ? "Configure a provider/model or enable Demo Mode before sending."
        : "Connect the local runtime before sending."
    : chatLifecycleLabels[chatLifecycleState];
  const tracePanelEntries = codingSessionTraceWithCheckpointDecision.slice(-12);
  const currentChatTitle = sanitizeDisplayText(activeChatSummary?.title ?? chatId);
  const renderConversationList = (deleteHelpId: string) => (
    <div className="conversation-list" role="list" aria-label="Local conversations list">
      {activeChatSummaries.length === 0 ? (
        <div className="conversation-empty-state" role="status">
          <strong>{chatHistoryLoading ? "Loading conversations…" : chatHistoryError ? "Conversation history unavailable" : "No saved conversations"}</strong>
          <span>{chatHistoryLoading ? "Loading saved conversations from the local runtime…" : chatHistoryError ? "Conversation history is unavailable." : "No saved conversations remain. The prompt is ready for a fresh local chat, and nothing is written to browser storage."}</span>
        </div>
      ) : activeChatSummaries.map((summary, index) => {
        const active = summary.chatId === chatId;
        const deleting = deletingChatId === summary.chatId;
        const title = sanitizeDisplayText(summary.title || "Untitled chat");
        const updatedAt = sanitizeDisplayText(summary.updatedAt);
        const positionLabel = `Conversation ${index + 1} of ${activeChatSummaries.length}`;
        const messageCountLabel = `${summary.messageCount} persisted message${summary.messageCount === 1 ? "" : "s"}`;
        const rowLabel = `${positionLabel}: ${title}${active ? ", current conversation" : ""}. Updated ${updatedAt}. ${messageCountLabel}.`;
        return (
          <div className={`conversation-item ${active ? "active" : ""}`} key={summary.chatId} role="listitem" aria-label={rowLabel}>
            <button type="button" className="conversation-select" onClick={() => selectChat(summary.chatId)} disabled={deleting || active} aria-current={active ? "page" : undefined} aria-label={`${active ? "Current conversation" : "Open conversation"}: ${title}. ${positionLabel}. ${messageCountLabel}.`}>
              <span className="conversation-title-line">
                <strong className="conversation-title">{title}</strong>
                {active && <span className="badge ok">active conversation</span>}
              </span>
              <span className="conversation-meta-line">
                <span className="conversation-updated">Updated {updatedAt}</span>
                <span className="conversation-message-count">{messageCountLabel}</span>
                <span className="conversation-position subtle">{positionLabel}</span>
              </span>
              {active && <span className="conversation-active-copy">Currently selected. New messages will be sent here.</span>}
            </button>
            <button type="button" className="danger-button conversation-delete" onClick={() => void deleteCurrentChat(summary.chatId)} disabled={deleting || chatHistoryLoading} aria-describedby={active ? deleteHelpId : undefined} aria-label={`Delete conversation: ${title}${active ? " (current; confirmation required)" : " (confirmation required)"}`}>{deleting ? "Deleting…" : active ? "Delete current" : "Delete"}</button>
          </div>
        );
      })}
    </div>
  );

  const hostedWebview = bridgeHost === "vscode" || bridgeHost === "jetbrains";
  const hostCapabilityEvaluation = useMemo(() => evaluateHostCapabilityMetadata(bridgeHost), [bridgeHost]);
  const controlledHostCapabilityMatrix = useMemo(() => createControlledHostCapabilityMatrixDisplay(controlledHostCapabilities, controlledHostCapabilityDisplayHost(controlledHostCapabilities, bridgeHost)), [bridgeHost, controlledHostCapabilities]);

  return (
    <main className={`app-shell host-${bridgeHost} ${activeChatSummaries.length <= 1 ? "single-conversation" : "multi-conversation"}`}>
      <section className="hero">
        <div>
          <span className="badge ok">local-first</span>
          <h1>{productName}</h1>
          <p className="subtle">Local-first coding chat for your IDE runtime. Cloud backend required = false.</p>
        </div>
        <div className="stack">
          <span className={`badge ${connectionStatus === "connected" ? "ok" : connectionStatus === "error" ? "warn" : ""}`}>
            runtime {connectionStatus}
          </span>
          <span className="badge">bridge {bridgeHost}</span>
        </div>
      </section>

      {!hostedWebview && (
        <section className="readiness-card warn browser-preview-card" role="status" aria-label="Browser preview limits">
          <div className="row">
            <strong>Browser standalone mode</strong>
            <span className="badge warn">runtime chat yes · IDE actions no</span>
          </div>
          <span className="subtle">Browser connects to a running loopback runtime, configures/tests providers, and chats with Demo Mode, Ollama, or OpenAI-compatible BYOK models. It cannot launch/restart runtime or run host actions.</span>
          <span className="subtle">IDE-only: editor context, excerpts, snippets, apply, and verification. Browser uses explicit prompt/provider controls.</span>
        </section>
      )}

      {activeRuntimeLifecycle && <section className="readiness-card warn" role="status" aria-label="Host capability metadata authority">
        <div className="row">
          <strong>Host capability metadata</strong>
          <span className="badge warn">metadata only</span>
          <span className="badge">allowed to execute: {String(hostCapabilityEvaluation.allowedToExecute)}</span>
        </div>
        <span className="subtle">Host/plugin support signals are display evidence only; they never enable Send, apply, verification, or IDE actions.</span>
        <span className="subtle">Controlled host matrix: {String(hostCapabilityEvaluation.details.controlledStart)} · read {String(hostCapabilityEvaluation.details.controlledRead)} · edit {String(hostCapabilityEvaluation.details.controlledEdit)} · verification {String(hostCapabilityEvaluation.details.controlledVerification)}.</span>
        {controlledHostCapabilities && <span className="subtle">Controlled capabilities v2: {controlledHostCapabilityMatrix.hostLabel} · {controlledHostCapabilityMatrix.supportLabel} · allowed to execute: {String(controlledHostCapabilityMatrix.allowedToExecute)}.</span>}
        {controlledHostCapabilities && <span className="subtle">Safe capability labels: {controlledHostCapabilityMatrix.statusLabels.join(" · ")}.</span>}
        {controlledHostCapabilities && controlledHostCapabilityMatrix.correlationLabels.length > 0 && <span className="subtle">Correlation requirements: {controlledHostCapabilityMatrix.correlationLabels.join(" · ")}.</span>}
        {controlledHostCapabilities && controlledHostCapabilityMatrix.limitLabels.length > 0 && <span className="subtle">Bounded limits: {controlledHostCapabilityMatrix.limitLabels.join(" · ")}.</span>}
        {controlledHostCapabilities && controlledHostCapabilityMatrix.reasonLabels.length > 0 && <span className="subtle">Reason labels: {controlledHostCapabilityMatrix.reasonLabels.join(" · ")}.</span>}
      </section>}

      <CodingSessionTracePanel entries={tracePanelEntries} />

      <section className="card stack chat-primary-card">
        <div className="chat-hero-row">
          <div className="stack">
            <span className="badge ok">primary chat</span>
            <h2>Chat with {productName}</h2>
            <p className="subtle">Ask about the current file, selected code, or local project context. Messages stay in engine-owned local history and provider calls go through your configured local runtime.</p>
          </div>
          <div className="chat-hero-status stack">
            <span className={`badge ${canSendChat ? "ok" : "warn"}`}>{canSendChat ? "ready to chat" : "setup needed"}</span>
            <span className={`badge ${connectionStatus === "connected" ? "ok" : connectionStatus === "error" ? "warn" : ""}`}>runtime {connectionStatus}</span>
          </div>
        </div>
        <div className={`readiness-card ${canSendChat ? "ready" : "warn"}`}>
          <div className="row">
            <strong>Chat readiness</strong>
            <span className={`badge ${connectionStatus === "connected" ? "ok" : connectionStatus === "error" ? "warn" : ""}`}>runtime {connectionStatus}</span>
            <span className={enabledProviders.length > 0 ? "badge ok" : "badge warn"}>{enabledProviders.length} enabled provider{enabledProviders.length === 1 ? "" : "s"}</span>
          </div>
          <div className="chat-readiness-summary">
            <div className="chat-readiness-copy stack">
              <span>State: {chatReadinessLabel}</span>
              <span>{chatReadinessMessage}</span>
            </div>
            <div className="chat-readiness-tiles" aria-label="Chat readiness checkpoints">
              <span className={`readiness-pill ${runtimeConnected ? "ok" : "warn"}`}>{runtimeConnected ? "Runtime ready" : "Runtime needs refresh"}</span>
              <span className={`readiness-pill ${canSendChat ? "ok" : "warn"}`}>{canSendChat ? activeSelectedDemoMode ? "Demo send ready" : experimentalOauthChatReady ? "Experimental fallback send ready" : "Provider send ready" : "Provider or Demo Mode needed"}</span>
              <span className="readiness-pill ok">Local-first BYOK</span>
            </div>
          </div>
          <div className="stack">
            {chatModelStatus && <span className="subtle">Model status: {chatModelStatus}</span>}
            {chatReadinessEvidence && <span className="subtle">Readiness evidence: {chatReadinessEvidence}</span>}
            {demoModeEnabled && <span className="subtle">{activeSelectedDemoMode ? "Demo Mode is active in the local runtime. It uses canned responses only, makes no provider calls, requires no API key, and is not model quality." : `Demo Mode is enabled in the local runtime, but the current ready chat path uses ${selectedModelDisplayName ?? "the selected model"}${selectedModelProviderId ? ` (${selectedModelProviderId})` : ""}. Sends may use that configured provider; disable Demo Mode or choose the demo model only when dogfooding canned local responses.`}</span>}
            {activeDemoModeError && <span className="error">Demo Mode status unavailable: {activeDemoModeError.status}: {sanitizeDisplayText(activeDemoModeError.message)}</span>}
            {runtimeConnected && !canSendChat && <span className="subtle">For the quickest real-provider path, choose OpenAI API-key fallback, paste a provider API key once, save, test provider, refresh runtime/model readiness, then send your first message. Demo Mode is only for trying the chat flow without provider calls.</span>}
            {experimentalOauthChatReady && <span className="subtle">OpenAI API-key fallback remains the safe/default setup and will be preferred when configured.</span>}
            {!canSendChat && <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>}
          </div>
          <FirstRunChecklist runtimeConnected={runtimeConnected} demoModeReady={activeSelectedDemoMode} apiKeyReady={apiKeyChatReady} experimentalAccountReady={experimentalOauthChatReady} canSendChat={canSendChat} readinessState={apiKeyReadinessState} />
          <FirstMessageReadinessWizard
            readiness={firstMessageReadiness}
            canSendChat={canSendChat}
            runtimeRefreshInFlight={runtimeRefreshInFlight}
            providerTestState={providerTestState}
            demoModeEnabled={demoModeEnabled}
            demoModeWorking={demoModeWorking}
            onRefreshRuntime={() => void connect(true)}
            onToggleDemoMode={(enabled) => void toggleDemoMode(enabled)}
            onApiKeyFallback={applyOpenAiApiPreset}
            onTestProvider={(providerId) => void runProviderTest(providerId)}
            onFocusPrompt={() => chatInputRef.current?.focus()}
          />
        </div>
        {hostedWebview && (
          <details className="compact-host-setup" data-testid="compact-host-setup">
            <summary>
              <span className="compact-summary-title">Provider setup</span>
              <span className={`badge ${connectionStatus === "connected" ? "ok" : connectionStatus === "error" ? "warn" : ""}`}>runtime {connectionStatus}</span>
              <span className={canSendChat ? "badge ok" : "badge warn"}>{canSendChat ? "send ready" : "provider/demo needed"}</span>
            </summary>
            <div className="compact-host-setup-body stack">
              <span className="subtle">Chat stays primary in compact IDE layout. Runtime, provider API-key setup, experimental OpenAI account login, and Demo Mode controls remain available below.</span>
              <div className="row">
                <button type="button" onClick={() => { setRuntimeDetailsOpen(true); void connect(true); }} disabled={runtimeRefreshInFlight}>{runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime"}</button>
                <button type="button" onClick={() => { setProviderDetailsOpen(true); applyOpenAiApiPreset(); }}>Use OpenAI API key fallback</button>
                <button type="button" onClick={() => void toggleDemoMode(!demoModeEnabled)} disabled={demoModeWorking}>{demoModeWorking ? "Changing Demo Mode…" : demoModeToggleLabel}</button>
                <button type="button" className="secondary-button" onClick={() => setProviderDetailsOpen(true)}>Open provider/login setup below</button>
              </div>
            </div>
          </details>
        )}
        {chatError && <ErrorBox error={chatError} />}
        {chatHistoryError && <ErrorBox error={chatHistoryError} />}
        <div className="chat-workbench">
          <aside className="conversations-panel conversations-rail stack" aria-label="Local conversations">
            <div className="row">
              <h3>Conversations</h3>
              <button type="button" onClick={() => void createNewChat()}>{chatHistoryLoading ? "Loading…" : "New chat"}</button>
            </div>
            <span className="subtle">Engine-owned local history. Messages are not written to browser storage.</span>
            <span id="delete-current-conversation-help-rail" className="sr-only">Deleting the current conversation asks for confirmation, removes it from engine-owned local history, and selects the next available conversation or a fresh local chat.</span>
            <div className="conversation-status" role="status">
              {conversationNotice ? `${chatHistoryStatus} ${conversationNotice}` : chatHistoryStatus}
            </div>
            {renderConversationList("delete-current-conversation-help-rail")}
          </aside>
          {compactConversationsOpen && <button type="button" className="conversation-drawer-backdrop" aria-label="Close chats drawer" onClick={() => setCompactConversationsOpen(false)} />}
          <aside className={`conversations-panel conversations-drawer stack ${compactConversationsOpen ? "open" : ""}`} aria-label="Local conversations drawer" aria-hidden={!compactConversationsOpen} hidden={!compactConversationsOpen}>
            <div className="row">
              <h3>Chats</h3>
              <button type="button" className="secondary-button" onClick={() => setCompactConversationsOpen(false)}>Close</button>
            </div>
            <button type="button" onClick={() => void createNewChat()}>{chatHistoryLoading ? "Loading…" : "New chat"}</button>
            <span className="subtle">Engine-owned local history. Messages are not written to browser storage.</span>
            <span id="delete-current-conversation-help-drawer" className="sr-only">Deleting the current conversation asks for confirmation, removes it from engine-owned local history, and selects the next available conversation or a fresh local chat.</span>
            <div className="conversation-status" role="status">
              {conversationNotice ? `${chatHistoryStatus} ${conversationNotice}` : chatHistoryStatus}
            </div>
            {renderConversationList("delete-current-conversation-help-drawer")}
          </aside>
          <section className="chat-thread-pane" aria-label="Current chat thread">
            <div className="chat-title-card chat-compact-header row">
              <button type="button" className="secondary-button chats-toggle" aria-expanded={compactConversationsOpen} onClick={() => setCompactConversationsOpen((open) => !open)}>Chats</button>
              <div className="stack">
                <strong>{currentChatTitle}</strong>
                <span className="subtle">{activeChatIndex >= 0 ? `Conversation ${activeChatIndex + 1} of ${activeChatSummaries.length} · ` : ""}{chatView.messages.length} visible message{chatView.messages.length === 1 ? "" : "s"} · {chatView.subscriptionReady ? "snapshot loaded" : activeChatSummary ? `${activeChatSummary.messageCount} persisted message${activeChatSummary.messageCount === 1 ? "" : "s"}` : "fresh local chat"}</span>
              </div>
              <button type="button" onClick={() => void createNewChat()}>{chatHistoryLoading ? "Loading…" : "New"}</button>
              <span className="badge chat-id-badge">{sanitizeDisplayText(chatId)}</span>
            </div>
            <details className="debug-details" data-testid="chat-advanced-controls">
              <summary>Advanced chat controls</summary>
              <div className="form-grid">
                <label>
                  Chat id
                  <input value={chatId} onChange={updateDirectChatId} />
                </label>
              </div>
            </details>
            <div className="chat-scroll-region" ref={chatScrollRegionRef} aria-label="Chat messages">
              <div className="chat-panel">
                {chatView.messages.length === 0 ? <ChatEmptyState runtimeConnected={runtimeConnected} canSendChat={canSendChat} providerReady={apiKeyChatReady || experimentalOauthChatReady} activeDemoMode={activeSelectedDemoMode} selectedModelDisplayName={selectedModelDisplayName} selectedModelProviderId={selectedModelProviderId} context={currentAttachedContext} hasLocalConversations={activeChatSummaries.length > 0} onProviderSetup={applyOpenAiApiPreset} onRefreshRuntime={() => void connect(true)} /> : chatView.messages.map((message) => <ChatBubble key={message.id} message={message} activeEditProposal={activeEditProposal} rejectedEditProposalSourceMessageId={activeRejectedEditProposal?.sourceMessageId ?? null} activeIdeActionProposal={activeIdeActionProposal} rejectedIdeActionProposalSourceMessageId={activeRejectedIdeActionProposal?.sourceMessageId ?? null} />)}
                <span className={`chat-lifecycle-state ${chatLifecycleState}`}>{chatLifecycleLabel}</span>
                {chatView.messages.some((message) => message.role === "assistant" && message.status === "streaming") && <span className="subtle">Assistant is streaming…</span>}
              </div>
              <EditProposalPanel proposal={activeEditProposal} rejected={activeRejectedEditProposal} result={activeEditProposal ? applyResult : null} host={bridgeHost} pendingRequestId={pendingApplyRequestId} note={applyNote} onApply={submitEditProposal} onCancelPending={cancelPendingEditProposalApply} />
              {proposalHistory.entries.length > 0 && pendingApplyRequestId === null && <ProposalHistoryPanel history={proposalHistory} />}
              <IdeActionProposalPanel proposal={activeIdeActionProposal} host={bridgeHost} pending={pendingIdeActionRequestIdRef.current !== null} onRun={(payload) => requestIdeAction(payload, "gui-ide-proposal-action")} />
            </div>
            <form className="chat-composer" data-testid="chat-composer" onSubmit={(event) => void submitChat(event)}>
              <div className="composer-input-area">
                <div className="composer-context-chips" aria-label="Next-send context chips">
                  <span className={`composer-chip ${canSendChat ? "ok" : "warn"}`}>{canSendChat ? "Send ready" : "Setup needed"}</span>
                  <span className="composer-chip">Next send: {includeExplicitContextBundle && explicitContextBundleItems.length > 0 ? `${explicitContextBundleItems.length} explicit item${explicitContextBundleItems.length === 1 ? "" : "s"}` : includeAttachedContext && currentAttachedContext && hasUsableAttachedContext(currentAttachedContext) ? currentActiveFileExcerpt ? activeFileExcerptSummary(currentActiveFileExcerpt) : attachedContextSummary(currentAttachedContext) : "prompt only"}</span>
                  {attachedProjectMemoryCount > 0 && <span className="composer-chip">Memory {attachedProjectMemoryCount}</span>}
                  {attachedVerificationKey && <span className="composer-chip">Verification attached</span>}
                  {modelProposalDraft && <span className="composer-chip">Model proposal draft</span>}
                </div>
                <textarea ref={chatInputRef} value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={canSendChat ? "Ask about the current file, selection, or project..." : "Connect the runtime and configure a provider to start chatting..."} />
                <div className="row chat-actions">
                  <button type="submit" disabled={!canSendChat}>Send</button>
                  <button type="button" className="secondary-button" data-testid="chat-stop-response" onClick={stopSse}>Stop response</button>
                </div>
              </div>
              <div className="composer-tools">
                <details className="composer-tool-drawer" data-testid="task-agent-tools-drawer">
                  <summary>
                    <span className="compact-summary-title">Task / Agent tools</span>
                    <span className="badge">Agent Run</span>
                    <span className="badge">Context budget</span>
                    <span className="badge">Memory</span>
                  </summary>
                  <div className="composer-drawer-body stack">
                    <AgentRunPanel input={agentRunInput} host={bridgeHost} pendingApply={pendingApplyRequestId !== null} pendingVerification={pendingControlledCommandRunRequestId !== null || verificationAttempt?.status === "pending" || verificationAttempt?.status === "inProgress" || (agentRunInput?.applyResult !== undefined && controlledAgentCommandRunRequest.state !== "ready")} onApplyReviewedPatch={submitAgentRunApply} onRunAllowlistedVerification={submitAgentRunVerification} onReviewRollback={() => setApplyNote("Rollback review is display-only in this experimental shell. Use existing checkpoint/rollback surfaces when available; no bridge request was posted.")} onDraftVerificationFollowup={() => useAgentRunVerificationFollowupDraft("followup")} onDraftVerificationFix={() => useAgentRunVerificationFollowupDraft("fix")} proposalHistory={proposalHistory} verificationFixDraft={agentRunVerificationFixDraft ?? undefined} oneStepLoopState={showOneStepAgentRunPanel ? oneStepLoopState : undefined} oneStepReadRequest={showOneStepAgentRunPanel ? oneStepControlledAgentFileReadRequest : undefined} oneStepEditRequest={showOneStepAgentRunPanel ? oneStepControlledAgentEditRequest : undefined} oneStepCommandRunRequest={showOneStepAgentRunPanel ? oneStepControlledAgentCommandRunRequest : undefined} onStartOneStepRun={startOneStepAgentRun} onStopOneStepRun={stopOneStepAgentRun} controlledHostCapabilityMatrix={controlledHostCapabilities ? controlledHostCapabilityMatrix : undefined} controlledRunContextBundle={showControlledRunContextSelector ? controlledRunContextSelection.bundle : undefined} controlledRunContextReport={showControlledRunContextSelector ? controlledRunContextSelection.report : undefined} includeControlledRunContext={includeControlledRunContext} onIncludeControlledRunContextChange={setIncludeControlledRunContext} controlledRunHistory={controlledRunHistory} controlledLexicalSearch={controlledLexicalSearchResult} controlledMultifilePatchPlan={controlledAgentMultifilePatchPlanPreview} controlledMultifileApplyRequest={controlledAgentMultifileApplyRequest} controlledMultifileApplyResult={controlledMultifileApplyResult} controlledMultifileApplyNote={controlledMultifileApplyNote} pendingControlledMultifileApply={pendingControlledMultifileApplyRequestId !== null} controlledMultifileApplyConfirmed={controlledMultifileApplyConfirmed} onConfirmControlledMultifileApply={confirmControlledMultifileApplyReview} onRequestControlledMultifileApply={requestControlledMultifileApply} onClearControlledMultifileApply={clearControlledMultifileApplyState} controlledVerificationBundle={effectiveControlledVerificationBundle} controlledVerificationBundleRequest={controlledAgentVerificationBundleMetadata !== undefined || controlledVerificationBundleRequest !== undefined ? controlledVerificationBundleRequest ?? controlledAgentVerificationBundleRequest : undefined} controlledVerificationBundleNote={controlledVerificationBundleNote} pendingControlledVerificationBundle={pendingControlledVerificationBundleRequestId !== null} controlledVerificationFollowupDraft={controlledVerificationFollowupDraft ?? undefined} onRequestControlledVerificationBundle={requestControlledVerificationBundle} onDraftControlledVerificationFollowup={() => draftControlledVerificationFollowup(controlledVerificationFollowupDraftAction)} onDraftControlledVerificationFix={() => draftControlledVerificationFollowup(controlledVerificationFixDraftAction)} controlledSearchResultId={controlledLexicalSearchResultId} selectedControlledSearchResultIds={selectedControlledSearchResultIds} controlledSearchSelection={controlledSearchSelection} controlledSearchRequestState={controlledWorkspaceReadinessMetadata !== undefined || controlledAgentRuntimeSessionMetadata !== undefined || controlledLexicalSearchResult !== undefined ? controlledAgentLexicalSearchRequest.state : undefined} pendingControlledSearch={controlledLexicalSearchCorrelationRef.current !== null} onRequestControlledSearch={requestControlledLexicalSearch} onControlledSearchResultSelectionChange={updateControlledSearchSelection} controlledTwoStepRunState={controlledAgentTwoStepRunMetadata !== undefined ? controlledAgentTwoStepRunState : undefined} controlledTaskHarness={controlledAgentTaskHarness} />
                    {controlledAgentWorkflowTranscriptMetadata !== undefined && <ControlledAgentWorkflowTranscriptPanel metadata={controlledAgentWorkflowTranscriptMetadata} />}
                    {showControlledAgentRunPanel && <ControlledAgentRunPanel state={controlledAgentRunState} progressReport={controlledAgentProgressReport} mvpReport={controlledLocalAgentMvpReport} host={bridgeHost} capabilityMatrix={controlledHostCapabilities ? controlledHostCapabilityMatrix : undefined} twoStepRunState={controlledAgentTwoStepRunMetadata !== undefined ? controlledAgentTwoStepRunState : undefined} onStop={stopControlledAgentRun} />}
                    {controlledWorkspaceReadinessMetadata !== undefined && <ControlledAgentWorkspaceReadinessPanel metadata={controlledWorkspaceReadinessMetadata} />}
                    {(controlledAgentFileReadMetadata !== undefined || controlledAgentFileReadRequest.state !== "blocked") && <ControlledAgentFileReadPanel metadata={effectiveControlledAgentFileReadMetadata} evaluatedRead={controlledAgentFileReadSummary} request={controlledAgentFileReadRequest} pendingRequestId={pendingControlledFileReadRequestId} note={controlledFileReadNote} onRequest={submitControlledFileRead} onClearPending={clearPendingControlledFileReadState} />}
                    {(controlledAgentEditExecutorMetadata !== undefined || controlledAgentEditRequest.state !== "blocked" || controlledAgentPatchPlanPreview !== undefined) && <ControlledAgentEditPanel metadata={effectiveControlledEditMetadata} request={controlledAgentEditRequest} pendingRequestId={pendingControlledEditRequestId} note={controlledEditNote} patchPlanPreview={controlledAgentPatchPlanPreview} patchPlanConfirmed={controlledPatchPlanConfirmed} onConfirmPatchPlan={() => setControlledPatchPlanConfirmed(true)} onRequest={submitControlledEdit} onClearPending={clearPendingControlledEditState} />}
                    {effectiveControlledAgentCommandRunnerMetadata !== undefined && <ControlledAgentCommandRunnerPanel metadata={effectiveControlledAgentCommandRunnerMetadata} />}
                    <MultiStepTaskTimelinePanel input={multiStepTaskTimelineInput} />
                    {showWhatWillBeSentPanel && <WhatWillBeSentPanel summary={contextBudgetSummary} draftPromptCharacters={chatInput.trim().length} />}
                    <CodingTaskSessionPanel session={codingTaskSession} goal={codingTaskGoal} contextItems={explicitContextBundleItems} memoryAttachedCount={attachedProjectMemoryCount} modelStatus={chatReadinessLabel} canSendChat={canSendChat} latestResponseStatus={chatLifecycleLabel} editProposal={activeEditProposal} applyResult={applyResult} verificationAttempt={verificationAttempt} verificationAttached={Boolean(attachedVerificationKey)} draftPrompt={codingTaskPromptDraft} contextBudgetSummary={contextBudgetSummary} modelProposalDraft={modelProposalDraft} modelProposalResult={agentRunModelProposal} onGoalChange={setCodingTaskGoal} onUseDraftPrompt={useCodingTaskDraftPrompt} onUseDraftPlan={useCodingTaskDraftPlan} onDraftOneStepModelProposal={draftOneStepModelProposalPrompt} onFocusPrompt={focusCodingTaskPrompt} />
                    <ManualRunnerPanel host={bridgeHost} draftPlan={manualRunnerDraftPlan} planProposal={latestPlanProposal} hasContext={Boolean((currentAttachedContext && hasUsableAttachedContext(currentAttachedContext)) || explicitContextBundleItems.length > 0)} hasPrompt={Boolean(chatInput.trim())} hasAssistantActivity={chatView.messages.some((message) => message.role === "assistant") || chatLifecycleState !== "idle"} hasEditProposal={Boolean(activeEditProposal)} applyResult={applyResult} verificationAttempt={ideActionAttempt?.action === "runVerificationCommand" ? ideActionAttempt : null} verificationAttached={Boolean(attachedVerificationKey)} canSendChat={canSendChat} onDraftPlanChange={setManualRunnerDraftPlan} onFocusPrompt={() => chatInputRef.current?.focus()} />
                    <TaskMemorySuggestionsPanel summary={taskMemorySuggestions} notes={projectMemory.notes} onAttach={attachProjectMemoryNote} />
                    <ProjectMemoryPanel notes={projectMemory.notes} state={projectMemory.state} error={projectMemory.error} title={projectMemoryTitle} text={projectMemoryText} tags={projectMemoryTags} query={projectMemoryQuery} status={projectMemoryStatus} attachedCount={attachedProjectMemoryCount} attachedNoteIds={attachedProjectMemoryNoteIds} canAddToBundle={explicitContextBundleItems.length < explicitContextBundleMaxItems} taskGoal={codingTaskGoal} chatId={chatId} onTitleChange={setProjectMemoryTitle} onTextChange={setProjectMemoryText} onTagsChange={setProjectMemoryTags} onQueryChange={setProjectMemoryQuery} onCreate={() => void createProjectMemoryNote()} onSearch={() => void searchProjectMemoryNotes()} onRefresh={() => void refreshProjectMemory()} onAttach={attachProjectMemoryNote} onDetach={detachProjectMemoryNote} onDelete={(note) => void deleteProjectMemoryNote(note)} />
                  </div>
                </details>
                <details className="composer-tool-drawer" data-testid="ide-actions-drawer">
                  <summary>
                    <span className="compact-summary-title">IDE actions</span>
                    <span className="badge">Coding Actions</span>
                    <span className="badge">Context</span>
                    <span className="badge">Verification</span>
                  </summary>
                  <div className="composer-drawer-body stack">
                    <ActiveFileExcerptAttachPanel host={bridgeHost} excerpt={currentActiveFileExcerpt} include={includeAttachedContext} pending={pendingActiveFileExcerpt} status={attachedContextStatus} promptAction={activeFilePromptAction} canAddToBundle={explicitContextBundleItems.length < explicitContextBundleMaxItems} onRequest={() => requestIdeAction({ action: "getActiveFileExcerpt" }, "gui-active-file-excerpt")} onClearPending={clearPendingIdeActionState} onIncludeChange={setIncludeAttachedContext} onApplyPrompt={applyActiveFilePrompt} onAddToBundle={addActiveFileExcerptToBundle} />
                    <WorkspaceSnippetSearchPanel host={bridgeHost} query={workspaceSnippetQuery} validation={workspaceSnippetQueryValidation} result={workspaceSnippetResult} selectedKeys={selectedWorkspaceSnippetKeys} pending={ideActionAttempt?.action === "searchWorkspaceSnippets" && (ideActionAttempt.status === "pending" || ideActionAttempt.status === "inProgress")} status={workspaceSnippetStatus} canAddToBundle={explicitContextBundleItems.length < explicitContextBundleMaxItems} onQueryChange={setWorkspaceSnippetQuery} onSearch={searchWorkspaceSnippets} onClearPending={clearPendingIdeActionState} onSelectionChange={setSelectedWorkspaceSnippetKeys} onAttachSelected={attachSelectedWorkspaceSnippetsToBundle} />
                    <ExplicitContextBundlePanel items={explicitContextBundleItems} include={includeExplicitContextBundle} status={explicitContextBundleStatus} onIncludeChange={setIncludeExplicitContextBundle} onRemove={(key) => removeExplicitContextBundleItem(key)} onClear={() => clearExplicitContextBundle("Cleared the one-shot explicit context bundle.")} />
                    <AttachedContextPreview context={currentAttachedContext} include={includeAttachedContext} acknowledged={attachedContextAcknowledged} status={attachedContextStatus} onIncludeChange={setIncludeAttachedContext} onAcknowledgeChange={setAttachedContextAcknowledged} />
                    <CodingActionsPanel canUseContext={codingActionsCanUseContext} context={currentAttachedContext} onAction={applyCodingAction} />
                    <VerificationCommandPanel host={bridgeHost} commands={verificationCommands} attempt={ideActionAttempt?.action === "runVerificationCommand" ? ideActionAttempt : null} note={ideActionAttempt?.action === "runVerificationCommand" ? ideActionNote : null} showAppliedEditNextStep={showAppliedEditVerificationStep} attachedVerificationKey={attachedVerificationKey} onRun={(commandId) => requestIdeAction({ action: "runVerificationCommand", commandId }, "gui-verification-command")} onClearPending={clearPendingIdeActionState} onAttachResult={attachVerificationResultToBundle} onDraftFollowupPrompt={(result) => useVerificationFollowupDraft(result, "followup")} onDraftFixPrompt={(result) => useVerificationFollowupDraft(result, "fix")} />
                    <IdeActionsPanel host={bridgeHost} attempt={ideActionAttempt} note={ideActionNote} workspaceRelativePath={safeActiveWorkspacePath} range={safeActiveRange} onGetContext={() => requestIdeAction({ action: "getContextSnapshot" })} onOpenFile={(workspaceRelativePath) => requestIdeAction({ action: "openWorkspaceFile", workspaceRelativePath })} onRevealRange={(workspaceRelativePath, range) => requestIdeAction({ action: "revealWorkspaceRange", workspaceRelativePath, range })} onClearPendingIdeAction={clearPendingIdeActionState} />
                  </div>
                </details>
              </div>
            </form>
            {!hostedWebview && <details className="debug-details chat-secondary-debug" data-testid="sse-debug-details">
              <summary>SSE debug details</summary>
              <div className="timeline">
                {timeline.length === 0 ? <span>No SSE events yet.</span> : timeline.map((entry, index) => <div className="timeline-entry" key={`${index}:${entry}`}>{entry}</div>)}
              </div>
            </details>}
          </section>
        </div>
      </section>


      <section className="card stack secondary-card runtime-card">
        <details className="debug-details" data-testid="runtime-connection-details" open={runtimeDetailsOpen} onToggle={(event) => setRuntimeDetailsOpen(event.currentTarget.open)}>
          <summary><h2>Local runtime connection</h2></summary>
        <div className="form-grid">
          <label>
            Runtime base URL
            <input value={baseUrl} onChange={(event) => updateBaseUrl(event.target.value)} readOnly={hostedRuntimeConnection} aria-readonly={hostedRuntimeConnection} />
          </label>
          {!hostedRuntimeConnection && (
            <label>
              Session token
              <input type="password" value={token} onChange={(event) => updateToken(event.target.value)} placeholder="Bearer token for local runtime" autoComplete="off" />
            </label>
          )}
        </div>
        {hostedRuntimeConnection
          ? <p className="subtle">Runtime connection is IDE-managed. Trusted host.ready supplied the loopback URL{token ? " and an in-memory Session token" : ""}; there is no visible token to copy, and provider API keys are still configured only in the local runtime.</p>
          : bridgeHost === "browser"
            ? <p className="subtle">Browser standalone mode connects to a running loopback runtime. Enter its URL and optional Session token, then configure Demo Mode, Ollama, or OpenAI-compatible BYOK providers. This token authorizes GUI-to-runtime only; it is not a provider API key.</p>
            : <p className="subtle">In VS Code or JetBrains, the local runtime Session token is normally supplied automatically by the IDE host through trusted host.ready. Paste a token only when connecting to a manually started runtime such as one launched with YET_AI_AUTH_TOKEN=.... This local runtime token authorizes the GUI to the loopback runtime; it is not an OpenAI key or provider API key.</p>}
        {!runtimeConnected && hostedRuntimeConnection && <div className="recovery-card" role="status"><strong>IDE-managed runtime recovery</strong><span>Refresh runtime asks the host-delivered URL/token to reconnect. If the runtime is stale, missing, or unauthorized, use the IDE runtime status/restart command; do not copy raw runtime tokens into chat.</span></div>}
        <div className={`recovery-card ${activeRuntimeLifecycle ? "" : "subtle"}`} role="status" aria-label="Runtime lifecycle diagnostics">
          <strong>{activeRuntimeLifecycle ? activeRuntimeLifecycle.title : "Runtime lifecycle diagnostics"}</strong>
          {activeRuntimeLifecycle ? (
            <>
              <span>{activeRuntimeLifecycle.status}</span>
              <span>{activeRuntimeLifecycle.evidence}</span>
              <span>{activeRuntimeLifecycle.guidance}</span>
            </>
          ) : <span>{runtimeLifecycleHostCopy(bridgeHost)}</span>}
        </div>
        {bridgeHost === "jetbrains" && <div className="recovery-card subtle" role="status" aria-label="JetBrains diagnostics handoff">
          <strong>Diagnostics available</strong>
          <span>Use JetBrains Tools → Yet AI: Copy Diagnostics or Open Logs Folder for a sanitized bundle and local logs folder. Raw logs are not shown in the Web UI.</span>
        </div>}
        <div className="row">
          <button onClick={() => void connect(true)} disabled={runtimeRefreshInFlight}>{runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime"}</button>
          <span className="subtle">Authorization header is sent only to validated loopback runtime URLs.</span>
        </div>
        {runtimeRefreshStatus && <div className={`refresh-status ${runtimeRefreshStatus.state}`} role="status"><strong>{runtimeRefreshStatus.detail}</strong><span>Attempt {runtimeRefreshStatus.attempt} at {runtimeRefreshStatus.checkedAt}</span></div>}
        {activeConnectionError && <ErrorBox error={activeConnectionError} />}
        {activeModelError && <div className="error">Models refresh failed: {activeModelError.status}: {sanitizeDisplayText(activeModelError.message)}</div>}
        {runtimeAuthMismatchError && <RuntimeAuthMismatchRecovery host={bridgeHost} hostedRuntimeConnection={hostedRuntimeConnection} />}
        {activeIdentityWarnings.map((warning) => <div className="error" key={warning}>{warning}</div>)}
        <div className="grid">
          <StatusBlock title="/v1/ping" value={activePing} />
          <StatusBlock title="/v1/caps" value={activeCaps ? { protocolVersion: activeCaps.protocolVersion, capabilities: activeCaps.capabilities, runtime: activeCaps.runtime, providers: activeCaps.providers.length } : null} />
        </div>
        </details>
      </section>

      <section className="card stack secondary-card agent-progress-card" aria-label="Agent progress">
        <details className="debug-details" data-testid="agent-progress-details">
          <summary><h2>Agent progress</h2></summary>
        <div className="row">
          <button type="button" onClick={() => void refreshAgentProgress()} disabled={agentProgress.state === "loading"}>{agentProgress.state === "loading" ? "Loading agent progress…" : "Refresh agent progress"}</button>
        </div>
        <p className="subtle">Read-only local observability only. This panel does not start agents, run tools, merge git, edit files, execute shell, call providers, or mutate the workspace.</p>
        <AgentProgressPanel progress={agentProgress} />
        </details>
      </section>

      <section ref={providerSetupCardRef} className={`card stack secondary-card provider-setup-card${providerSetupHighlight ? " provider-setup-card-highlight" : ""}`}>
        <details className="debug-details provider-setup-details" data-testid="provider-setup-details" open={providerDetailsOpen} onToggle={(event) => setProviderDetailsOpen(event.currentTarget.open)}>
          <summary><h2>Provider setup</h2><span className="subtle">BYOK, local, demo, login</span></summary>
        {runtimeConnected && !apiKeyChatReady && !experimentalOauthChatReady && (
          <div className="guided-setup-card stack" role="status">
            <strong>Runtime connected — choose the first-message path</strong>
            <span><strong>Browser standalone local model:</strong> choose Ollama local for a direct engine call to http://127.0.0.1:11434, confirm a pulled model id, save, test provider, refresh runtime/model readiness, then send. No API key, hosted Yet AI service, account, managed gateway, product credits, or cloud workspace is required.</span>
            <span><strong>Hosted BYOK provider:</strong> use OpenAI API-key fallback or another OpenAI-compatible /v1 endpoint, paste a provider API key once when required, save, test provider, refresh runtime/model readiness, then send.</span>
            <span><strong>Try without provider calls:</strong> enable Demo Mode from Chat readiness. It uses local canned responses only and is not model quality.</span>
            <div className="row">
              <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>
            </div>
          </div>
        )}
        <p className="subtle"><strong>Runtime Session token</strong> is only for this GUI talking to the local loopback runtime. <strong>Provider API key</strong> is for upstream providers that require one and is sent to the local runtime only on save, cleared from this form immediately after save/update is submitted, and never written to browser storage. Ollama local uses auth None.</p>
        <p className="subtle">ChatGPT/OpenAI account login is experimental/non-default until officially supported and reviewed. It is not production official login. OpenAI API-key setup remains available as the safe/default hosted real-provider path.</p>
        <p className="subtle">For local Ollama, the engine calls your Ollama server directly at http://127.0.0.1:11434. No API key, hosted Yet AI service, account, managed model gateway, cloud workspace, or product credit balance is required.</p>
        {providerSetupStatus && <div className="provider-setup-status" role="status"><strong>OpenAI API-key setup opened</strong><span>{providerSetupStatus}</span></div>}
        {providerError && <ErrorBox error={providerError} />}
        <div className="provider-item account-login-card stack" data-testid="provider-auth-card">
          <div className="row">
            <h3>Experimental account login (non-default)</h3>
            <span className="badge warn">experimental</span>
            <span className={activeProviderAuthStatus?.configured ? "badge ok" : "badge warn"}>{activeProviderAuthStatus?.status ?? "not checked"}</span>
          </div>
          <p className="subtle">This card is not production official OpenAI login. The local runtime owns the experimental account state, the GUI opens only safe authorization URLs and renders sanitized status, and browser storage never stores provider auth state.</p>
          <div className="risk-card stack">
            <strong>Experimental Codex-like account login risk</strong>
            <span>This OpenAI account path is high-risk and private-endpoint-style. It is not official public OpenAI OAuth support, not production-ready, and must not replace the OpenAI API-key fallback as the safe/default real-provider path.</span>
          </div>
          {providerAuthError && <ProviderAuthStartErrorRecovery error={providerAuthError} onRefresh={() => void refreshProviderAuthStatus()} onLogin={() => void startOpenAiLogin()} onApiKeyFallback={applyOpenAiApiPreset} />}
          {providerAuthUrlWarning && <div className="error">{providerAuthUrlWarning}</div>}
          {runtimeAuthMismatchError && !activeProviderAuthStatus && <BlockedProviderAuthJourney host={bridgeHost} hostedRuntimeConnection={hostedRuntimeConnection} onRefresh={() => void connect()} onApiKeyFallback={applyOpenAiApiPreset} />}
          {activeProviderAuthStatus ? (
            <ProviderAuthJourney
              status={activeProviderAuthStatus}
              pendingState={providerAuthPendingState}
              exchangeCode={providerAuthExchangeCode}
              exchangeError={providerAuthExchangeError}
              exchangeWorking={providerAuthExchangeWorking}
              runtimeConnected={runtimeConnected}
              onExchangeCodeChange={setProviderAuthExchangeCode}
              onExchange={(event) => void exchangeOpenAiLoginCode(event)}
              onRefresh={() => void refreshProviderAuthStatus()}
              onLogin={() => void startOpenAiLogin()}
              onDisconnect={() => void disconnectOpenAiLogin()}
              onApiKeyFallback={applyOpenAiApiPreset}
            />
          ) : runtimeAuthMismatchError ? null : (
            <div className="login-state-panel stack">
              <strong>Checking account login status…</strong>
              <span className="subtle">Refresh the local runtime status or continue with the API-key fallback.</span>
              <div className="row">
                <button type="button" onClick={() => void refreshProviderAuthStatus()}>Refresh login status</button>
                <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>
              </div>
            </div>
          )}
        </div>
        <div className="provider-setup-grid">
          <form className="provider-form-card stack" onSubmit={(event) => void submitProvider(event)}>
            <div className="provider-setup-group stack">
              <strong>1. Pick a provider preset</strong>
              <div className="row provider-preset-row">
                {providerPresets.map((preset) => (
                  <button type="button" key={preset.id} onClick={() => applyProviderPreset(preset)} title={preset.description}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <span className="subtle">Presets fill fields only; no API keys or GUI provider calls.</span>
            </div>
            <div className="provider-setup-group stack">
              <strong>2. Fill local runtime provider settings</strong>
              <span className="subtle">Save sends settings to the local runtime; the API-key field is cleared after save/update.</span>
            </div>
            <div className="form-grid provider-form-grid">
              <label>
                Provider id
                <input disabled={Boolean(selectedProviderId)} value={providerForm.providerId} onChange={(event) => setProviderForm({ ...providerForm, providerId: event.target.value })} />
              </label>
              <label>
                Kind
                <select value={providerForm.kind} onChange={(event) => setProviderForm({ ...providerForm, kind: event.target.value as ProviderForm["kind"] })}>
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="ollama">Ollama</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                Display name
                <input value={providerForm.displayName} onChange={(event) => setProviderForm({ ...providerForm, displayName: event.target.value })} />
              </label>
              <label>
                Base URL
                <input value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} />
              </label>
              <label>
                Auth
                <select value={providerForm.authType} onChange={(event) => setProviderForm({ ...providerForm, authType: event.target.value as ProviderForm["authType"] })}>
                  <option value="api_key">API key</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label>
                API key
                <input ref={providerApiKeyInputRef} type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} placeholder="Provider API key, not the runtime Session token" autoComplete="off" />
                <span className="field-help">Sent only to the local runtime on save, then cleared. This is your provider/OpenAI API key, not the runtime Session token.</span>
              </label>
              <label>
                Model id
                <input value={providerForm.modelId} onChange={(event) => setProviderForm({ ...providerForm, modelId: event.target.value })} />
              </label>
              <label>
                Model display name
                <input value={providerForm.modelDisplayName} onChange={(event) => setProviderForm({ ...providerForm, modelDisplayName: event.target.value })} />
              </label>
            </div>
            <label className="row">
              <input style={{ width: "auto" }} type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm({ ...providerForm, enabled: event.target.checked })} />
              Enabled
            </label>
            <div className="row">
              <button type="submit">{selectedProviderId ? "Update provider" : "Create provider"}</button>
              <button type="button" onClick={() => { setSelectedProviderId(undefined); setProviderForm(emptyProviderForm); }}>New provider</button>
            </div>
            <div className="provider-setup-group stack">
              <strong>3. Save, test, refresh</strong>
              <span className="subtle">Save/update, test provider, refresh runtime, then send.</span>
            </div>
            <span className="field-help">Then test provider, refresh runtime, and send when ready.</span>
          </form>
          <div className="provider-list-card stack">
            <h3>Saved providers</h3>
            <span className="subtle">Secrets stay runtime-owned; only configured/redacted status is shown.</span>
            {activeProviders.length === 0 ? <p className="subtle">No providers returned.</p> : activeProviders.map((provider) => (
              <div className="provider-item stack" key={provider.id}>
                <div className="row">
                  <strong>{sanitizeDisplayText(provider.displayName)}</strong>
                  <span className={provider.enabled ? "badge ok" : "badge warn"}>{provider.enabled ? "enabled" : "disabled"}</span>
                </div>
                <span className="subtle">{sanitizeDisplayText(provider.id)} · {sanitizeDisplayText(provider.kind)} · {sanitizeDisplayText(provider.baseUrl)}</span>
                <span>Secret configured: {String(provider.auth.configured)} {provider.auth.redacted ? `(${sanitizeDisplayText(provider.auth.redacted)})` : ""}</span>
                <span>Models: {provider.models.map((model) => sanitizeDisplayText(model.displayName)).join(", ") || "none"}</span>
                {provider.models.length > 0 && <span className="subtle">Model readiness: {provider.models.map((model) => modelStatusText(model, provider)).join("; ")}</span>}
                {provider.models.some((model) => modelReadinessEvidenceText(model, provider)) && <span className="subtle">Readiness metadata: {provider.models.map((model) => modelReadinessEvidenceText(model, provider)).filter(Boolean).join("; ")}</span>}
                {providerTestState?.providerId === provider.id && <div className={`provider-test-status ${providerTestState.state}`} role="status"><strong>{providerTestState.state === "testing" ? "Provider test running" : providerTestState.state === "success" ? "Provider test succeeded" : "Provider test failed"}</strong><span>{providerTestState.status}: {providerTestState.detail}</span>{providerTestState.state === "success" && <span>The raw API-key field was cleared; Test provider uses the saved local runtime credential. Next: refresh runtime/model readiness, then send when Chat readiness says Send available.</span>}{providerTestState.state === "failed" && <span>{providerTestAction(providerTestState.status)}</span>}</div>}
                <div className="row">
                  <button type="button" onClick={() => editProvider(provider)}>Edit</button>
                  <button type="button" onClick={() => void runProviderTest(provider.id)} disabled={providerTestState?.providerId === provider.id && providerTestState.state === "testing"}>{providerTestState?.providerId === provider.id && providerTestState.state === "testing" ? "Testing provider…" : "Test provider"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        </details>
      </section>


      <section className="card stack secondary-card debug-card">
        <details className="debug-details" data-testid="bridge-debug-details">
          <summary>Diagnostics / bridge debug</summary>
          <p className="subtle">Compact UI keeps bridge internals collapsed. Browser mock mode is non-privileged and logs sanitized bridge messages only.</p>
          <details className="inspect-details">
            <summary>Inspect bridge message log</summary>
            <div className="timeline">
              {bridgeLog.length === 0 ? <div className="timeline-entry">No bridge messages logged.</div> : bridgeLog.map((entry, index) => <div className="timeline-entry" key={`${index}:${entry}`}>{entry}</div>)}
            </div>
          </details>
        </details>
      </section>
    </main>
  );
}

function controlledVerificationFollowupPrompt(draft: ControlledAgentVerificationFollowupDraft): string {
  const lines = [
    `${draft.followupProposal.title}: ${draft.followupProposal.promptSummary}`,
    "Use only the sanitized verification summary metadata below. Do not infer raw stdout/stderr, command strings, cwd/env, private paths, secrets, provider payloads, raw file contents, diffs, replacement text, or hidden context.",
    `Bundle ${draft.sourceBundle.bundleId}: ${draft.sourceBundle.summary}; status ${draft.sourceBundle.aggregateStatus}; commands ${draft.sourceBundle.commandCount}; failed ${draft.sourceBundle.failedCount}; hash ${draft.sourceBundle.resultHash}.`,
    ...draft.verificationSummaries.map((item, index) => `Step ${index + 1} ${item.label}: status ${item.status}; exit ${String(item.exitCode ?? "none")}; category ${item.errorCategory}; summary ${item.safeOutputTailSummary}; hash ${item.outputTailHash}; bounded output ${item.outputByteCount} bytes/${item.outputLineCount} lines; truncated ${String(item.truncated)}.`),
    "Draft a concise manual next step for the user. Do not run tools, apply edits, verify, repair automatically, or send anything without an explicit Send click.",
  ];
  return lines.map((line) => sanitizeDisplayText(line)).join("\n");
}

function controlledHostCapabilityDisplayHost(payload: HostReadyPayload["controlledCapabilities"] | undefined, fallback: BridgeHost): BridgeHost {
  return payload?.hostSurface === "vscode" || payload?.hostSurface === "jetbrains" || payload?.hostSurface === "browser" ? payload.hostSurface : fallback;
}

function controlledRunHistoryHostLabel(host: BridgeHost): ControlledRunHistoryHostLabel {
  if (host === "vscode") {
    return "vscode";
  }
  if (host === "jetbrains") {
    return "jetbrains_unsupported";
  }
  if (host === "browser") {
    return "browser_preview_only";
  }
  return "unknown_host";
}

function controlledRunHistoryReadinessLabels(runState: ControlledAgentRunState, oneStepState: ControlledOneStepAgentLoopState) {
  const labels = [];
  if (runState.enabled || oneStepState.enabled || oneStepState.phase !== "idle") {
    labels.push("opt_in_ready", "workspace_ready");
  }
  if (runState.phase === "planning" || runState.phase === "waiting_for_user" || runState.phase === "running_verification" || runState.phase === "completed" || oneStepState.phase !== "idle") {
    labels.push("checkpoint_ready");
  }
  if (runState.stop?.recoverable || oneStepState.stop?.recoverable) {
    labels.push("rollback_plan_ready");
  }
  return labels.length > 0 ? labels : ["not_ready"];
}

function controlledRunHistoryPhaseLabel(runState: ControlledAgentRunState, oneStepState: ControlledOneStepAgentLoopState): ControlledRunHistoryPhaseLabel {
  if (oneStepState.phase === "completed" || runState.phase === "completed") {
    return "completed";
  }
  if (oneStepState.phase === "failed" || runState.phase === "failed") {
    return "failed";
  }
  if (oneStepState.phase === "stopped" || runState.phase === "stopped") {
    return "stopped";
  }
  if (runState.phase === "blocked") {
    return "blocked";
  }
  if (oneStepState.phase === "verification_requested" || runState.phase === "running_verification") {
    return "verifying";
  }
  if (oneStepState.phase === "edit_ready" || oneStepState.phase === "edit_applied" || runState.phase === "waiting_for_user") {
    return "editing";
  }
  if (oneStepState.phase === "read_context" || runState.phase === "reading_context") {
    return "reading";
  }
  if (oneStepState.phase === "start_requested" || oneStepState.phase === "model_step_pending" || runState.phase === "planning") {
    return "running";
  }
  if (runState.phase === "workspace_ready") {
    return "ready";
  }
  return "queued";
}

function controlledRunHistoryResultLabel(runState: ControlledAgentRunState, oneStepState: ControlledOneStepAgentLoopState): ControlledRunHistoryResultLabel {
  const stopReason = oneStepState.stop?.reason ?? runState.stop?.reason;
  if (stopReason === "user_stop") {
    return "user_stopped";
  }
  if (oneStepState.phase === "completed" || runState.phase === "completed") {
    return "succeeded";
  }
  if (oneStepState.phase === "failed" || runState.phase === "failed" || runState.phase === "blocked") {
    return "failed";
  }
  if (oneStepState.phase === "stopped" || runState.phase === "stopped") {
    return "user_stopped";
  }
  return "pending";
}

function controlledRunHistoryCounters(runState: ControlledAgentRunState, oneStepState: ControlledOneStepAgentLoopState) {
  return [
    { name: "read_count", value: Math.max(runState.counters.fileReadsUsed, oneStepState.counters.fileReads) },
    { name: "edit_count", value: Math.max(runState.counters.filesTouched, oneStepState.counters.filesTouched) },
    { name: "verification_count", value: Math.max(runState.counters.verificationRuns, oneStepState.counters.verificationRuns) },
    { name: "repair_attempt_count", value: Math.max(runState.counters.repairAttempts, oneStepState.counters.repairAttempts) },
    { name: "duration_bucket", value: Math.max(runState.counters.runtimeSeconds, oneStepState.counters.runtimeSeconds) },
    { name: "byte_bucket", value: Math.max(runState.counters.readBytesUsed + runState.counters.patchBytesUsed, oneStepState.counters.readBytes + oneStepState.counters.editBytes) },
  ];
}

function controlledRunHistoryArtifactLabels(runState: ControlledAgentRunState, oneStepState: ControlledOneStepAgentLoopState) {
  const labels = [];
  if (runState.counters.fileReadsUsed > 0 || oneStepState.counters.fileReads > 0) {
    labels.push({ label: "bounded read metadata", sizeBucketLabel: "bounded", retentionLabel: "gui_memory_only" });
  }
  if (runState.counters.filesTouched > 0 || oneStepState.counters.filesTouched > 0) {
    labels.push({ label: "bounded edit metadata", sizeBucketLabel: "bounded", retentionLabel: "gui_memory_only" });
  }
  if (runState.counters.verificationRuns > 0 || oneStepState.counters.verificationRuns > 0) {
    labels.push({ label: "allowlisted verification metadata", sizeBucketLabel: "bounded_tail", retentionLabel: "gui_memory_only" });
  }
  return labels;
}

function controlledRunHistoryChecksumLabels(runState: ControlledAgentRunState, oneStepState: ControlledOneStepAgentLoopState): string[] {
  const labels = [];
  const checkpointHash = typeof runState.details.checkpointHash === "string" ? runState.details.checkpointHash : undefined;
  const contentHash = typeof oneStepState.details.resultHash === "string" ? oneStepState.details.resultHash : undefined;
  if (checkpointHash) {
    labels.push(checkpointHash);
  }
  if (contentHash) {
    labels.push(contentHash);
  }
  return labels;
}

type ControlledRunContextSelection = {
  bundle: ReturnType<typeof createControlledRunContextBundle>;
  report: ReturnType<typeof buildControlledRunContextReport>;
};

function buildControlledRunContextSelection(items: ExplicitContextBundleItem[], host: BridgeHost): ControlledRunContextSelection {
  let bundle = createControlledRunContextBundle();
  const blockedReasons: ControlledRunContextBlockedReason[] = [];
  for (const item of items) {
    const input = explicitBundleItemToControlledRunContextInput(item, host);
    if (!input) {
      blockedReasons.push("unsafe_label");
      continue;
    }
    const result = validateControlledRunContextItem(input);
    if (!result.ok) {
      blockedReasons.push(result.reason);
      continue;
    }
    const next = addControlledRunContextItem(bundle, result.item);
    if (next === bundle) {
      blockedReasons.push(bundle.items.some((existing) => existing.key === result.item.key || existing.id === result.item.id) ? "duplicate_item" : "total_bytes_exceeded");
    }
    bundle = next;
  }
  return { bundle, report: buildControlledRunContextReport(bundle, blockedReasons) };
}

function explicitBundleItemToControlledRunContextInput(item: ExplicitContextBundleItem, host: BridgeHost): ControlledRunContextInput | null {
  const hostSurfaceLabel = host === "vscode" ? "VS Code explicit context bundle" : host === "jetbrains" ? "JetBrains explicit context bundle" : "Browser explicit context bundle";
  if (item.kind === "workspace_snippet") {
    return {
      id: controlledRunContextId("workspace", item.key),
      sourceKind: "workspace_fragment",
      label: item.workspaceRelativePath,
      workspaceRelativePath: item.workspaceRelativePath,
      range: { startLine: item.range.start.line + 1, endLine: item.range.end.line + 1 },
      previewText: item.text,
      hostSurfaceLabel,
    };
  }
  if (item.kind === "verification_output") {
    return {
      id: controlledRunContextId("verification", item.key),
      sourceKind: "verification_summary",
      label: item.commandId,
      previewText: item.outputTail,
      hostSurfaceLabel,
      truncated: item.truncated,
    };
  }
  if (item.kind === "project_memory") {
    return {
      id: controlledRunContextId("memory", item.key),
      sourceKind: "memory_summary",
      label: item.title,
      previewText: item.text,
      hostSurfaceLabel,
    };
  }
  const range = item.selection && item.selection.startLine !== undefined && item.selection.endLine !== undefined ? { startLine: item.selection.startLine + 1, endLine: item.selection.endLine + 1 } : undefined;
  return {
    id: controlledRunContextId("active", item.key),
    sourceKind: "active_editor_selection",
    label: item.file?.workspaceRelativePath ?? item.file?.displayPath ?? "active editor selection",
    workspaceRelativePath: item.file?.workspaceRelativePath,
    range,
    previewText: item.selection?.text ?? "",
    hostSurfaceLabel,
  };
}

function controlledRunContextId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "context"}`;
}

function controlledEditResultToOneStepMetadata(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  const edits = Array.isArray(payload.edits) ? payload.edits.map((edit) => {
    if (!isRecord(edit)) {
      return edit;
    }
    return {
      operation: edit.operation,
      workspaceRelativePath: edit.workspaceRelativePath,
      fileLabel: edit.fileLabel,
      expectedContentHash: edit.expectedContentHash,
      startLine: edit.startLine,
      endLine: edit.endLine,
      replacementByteCount: edit.replacementByteCount,
      sanitizedSummary: edit.sanitizedSummary,
    };
  }) : payload.edits;
  return {
    type: payload.type,
    schemaVersion: payload.schemaVersion,
    state: payload.state,
    runId: payload.runId,
    workspaceReadinessId: payload.workspaceReadinessId,
    requestId: payload.requestId,
    requestIdMintedBy: payload.requestIdMintedBy,
    userConfirmed: payload.userConfirmed,
    limits: payload.limits,
    edits,
  };
}

function oneStepEditMetadata(editMetadata: unknown, runtimeSessionMetadata: unknown, workspaceReadinessMetadata: unknown): unknown {
  if (!isRecord(editMetadata)) {
    return editMetadata;
  }
  const runtimeWorkspace = isRecord(runtimeSessionMetadata) && isRecord(runtimeSessionMetadata.workspace) ? runtimeSessionMetadata.workspace : undefined;
  const runtimeSession = isRecord(runtimeSessionMetadata) && isRecord(runtimeSessionMetadata.session) ? runtimeSessionMetadata.session : undefined;
  const workspaceReadinessIsolation = isRecord(workspaceReadinessMetadata) && isRecord(workspaceReadinessMetadata.isolation) ? workspaceReadinessMetadata.isolation : undefined;
  const runId = typeof runtimeSession?.sessionId === "string" ? runtimeSession.sessionId : editMetadata.runId;
  const workspaceReadinessId = typeof runtimeWorkspace?.readinessId === "string" ? runtimeWorkspace.readinessId : typeof workspaceReadinessIsolation?.readinessId === "string" ? workspaceReadinessIsolation.readinessId : editMetadata.workspaceReadinessId;
  return { ...editMetadata, runId, workspaceReadinessId };
}

function controlledCommandRunResultToRunnerMetadata(correlation: ControlledAgentCommandRunRequestCorrelation, result: ControlledAgentCommandRunResultSummary): Record<string, unknown> {
  return {
    kind: "controlled_agent_command_runner",
    version: "2026-06-29",
    authority: "allowlisted_command_id_metadata",
    cloudRequired: false,
    executionAllowed: false,
    freeformCommandAllowed: false,
    agentStartAllowed: false,
    workspace: {
      controlledWorkspaceId: correlation.controlledWorkspaceId,
      runId: correlation.runId,
      workspaceMode: "worktree",
      host: "vscode",
      privatePathExposed: false,
      workspaceLabel: "Controlled Agent Run verification",
    },
    request: {
      requestId: correlation.requestId,
      source: "gui",
      requestIdMintedBy: "gui",
      assistantMinted: false,
      correlation: {
        origin: "user",
        confirmedBy: "user",
        confirmationId: correlation.requestId,
        hostCorrelationId: correlation.runtimeSessionId,
        label: "User confirmed controlled Agent Run verification",
      },
      commandId: correlation.commandId,
      limits: {
        timeoutMs: 600000,
        maxOutputBytes: 12000,
        maxOutputLines: 240,
        tailOnly: true,
        commandStringAllowed: false,
        argsAllowed: false,
        cwdAllowed: false,
        envAllowed: false,
        shellAllowed: false,
        limitLabel: "Bounded sanitized tail only",
      },
      reason: "Verify controlled Agent Run after applied edit",
    },
    policyFlags: {
      allowlistedCommandIdOnly: true,
      freeformCommandAllowed: false,
      argsAllowed: false,
      cwdAllowed: false,
      envAllowed: false,
      shellAllowed: false,
      gitAllowed: false,
      networkAllowed: false,
      providerAllowed: false,
      toolAllowed: false,
      packageInstallAllowed: false,
      fileReadAllowed: false,
      fileWriteAllowed: false,
      hiddenSearchAllowed: false,
      indexingAllowed: false,
      autoStartAllowed: false,
      autoApplyAllowed: false,
      autoRunAllowed: false,
      autoVerifyAllowed: false,
      autoFixAllowed: false,
    },
    result: {
      status: result.status,
      cloudRequired: false,
      freeformCommandAllowed: false,
      truncated: result.truncated ?? false,
      message: result.message,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      outputTail: result.outputTail,
      outputByteCount: result.outputByteCount,
      outputLineCount: result.outputLineCount,
      resultHash: result.resultHash,
      blockedReason: result.status === "blocked" ? "policy_denied" : undefined,
    },
  };
}

function buildControlledAgentRunPreviewState(readinessMetadata: unknown, fileReadMetadata: unknown, commandRunnerMetadata: unknown): ControlledAgentRunState {
  const initialized = initializeControlledAgentRunState({
    readiness: readinessMetadata,
    userOptIn: { source: "user", confirmed: true, requestId: "s76-controlled-run-preview" },
  });
  if (!initialized.enabled || initialized.stopped) {
    return initialized;
  }
  let next = reduceControlledAgentRunState(initialized, { type: "workspace_ready" });
  if (fileReadMetadata !== undefined) {
    next = reduceControlledAgentRunState(next, { type: "read", metadata: fileReadMetadata });
  }
  if (commandRunnerMetadata !== undefined) {
    next = reduceControlledAgentRunState(next, { type: "command", metadata: commandRunnerMetadata });
  }
  return next;
}

function createCheckpointDecisionTraceEntry(decision: AgentRunCheckpointDecisionSummary | undefined): CodingSessionTraceEntry | null {
  if (!decision || decision.status === "unavailable") {
    return null;
  }
  const recommendedCard = decision.decisionCards.find((card) => card.state === "recommended");
  const title = decision.status === "continue_available"
    ? "Checkpoint decision continue metadata visible"
    : decision.status === "rollback_review_available"
      ? "Checkpoint decision rollback review metadata visible"
      : decision.status === "separate_run_suggested"
        ? "Checkpoint decision separate manual run metadata visible"
        : "Checkpoint decision stop metadata visible";
  const status: CodingSessionTraceEntry["status"] = decision.status === "blocked" ? "failed" : decision.status === "continue_available" ? "succeeded" : "pending";
  return {
    id: `checkpoint-decision-${decision.status}`,
    timestamp: "1970-01-01T00:00:00.000Z",
    family: decision.status === "rollback_review_available" ? "agentRun.rollbackAvailable" : decision.status === "continue_available" ? "agentRun.completed" : "agentRun.blocked",
    title,
    status,
    summary: recommendedCard ? `Decision status ${decision.status}; recommended manual next step ${recommendedCard.label}.` : `Decision status ${decision.status}; recommended manual next step ${decision.recommendedDecision}.`,
    details: {
      decisionStatus: decision.status,
      recommendedDecision: decision.recommendedDecision,
      displayOnly: decision.displayOnly,
      canAutoContinue: decision.canAutoContinue,
      canAutoApply: decision.canAutoApply,
      canAutoRollback: decision.canAutoRollback,
      canAutoRunVerification: decision.canAutoRunVerification,
    },
  };
}

function createControlledAgentFileReadTraceEntry(metadata: unknown): CodingSessionTraceEntry | null {
  if (metadata === undefined) {
    return null;
  }
  const read = evaluateControlledAgentFileRead(metadata);
  const family: CodingSessionTraceEntry["family"] = read.state === "blocked" ? "controlledAgent.fileReadBlocked" : read.state === "success" || read.state === "truncated" ? "controlledAgent.fileReadResult" : "controlledAgent.fileReadPlanned";
  const status: CodingSessionTraceEntry["status"] = read.state === "blocked" ? "failed" : read.state === "success" || read.state === "truncated" ? "succeeded" : "info";
  const pathLabel = read.preview?.pathLabel ?? (typeof read.details.pathLabel === "string" ? read.details.pathLabel : undefined);
  return {
    id: `controlled-file-read-${read.state}`,
    timestamp: "1970-01-01T00:00:00.000Z",
    family,
    title: read.state === "blocked" ? "Controlled file read blocked" : read.state === "success" || read.state === "truncated" ? "Controlled file read evidence visible" : "Controlled file read planned metadata visible",
    status,
    summary: `Bounded controlled workspace read evidence: ${read.summary}`,
    details: {
      displayOnly: true,
      boundedControlledWorkspaceReadEvidence: true,
      allowedToRead: read.allowedToRead,
      state: read.state,
      pathLabel: pathLabel ?? "none",
      byteCount: read.preview?.byteCount ?? (typeof read.details.byteCount === "number" ? read.details.byteCount : 0),
      lineCount: read.preview?.lineCount ?? (typeof read.details.lineCount === "number" ? read.details.lineCount : 0),
      truncated: read.preview?.truncated ?? false,
      contentHash: read.preview?.contentHash ?? "none",
      canSearchWorkspace: read.canSearchWorkspace,
      canRunCommands: read.canRunCommands,
      canWriteFiles: read.canWriteFiles,
      canCallProvider: read.canCallProvider,
    },
  };
}

function createControlledAgentCommandRunTraceEntry(metadata: unknown): CodingSessionTraceEntry | null {
  if (metadata === undefined) {
    return null;
  }
  const commandRun = evaluateControlledAgentCommandRun(metadata);
  const terminalResult = commandRun.state === "succeeded" || commandRun.state === "failed" || commandRun.state === "timed_out" || commandRun.state === "killed";
  const family: CodingSessionTraceEntry["family"] = commandRun.state === "blocked" || commandRun.state === "disabled" ? "controlledAgent.commandBlocked" : commandRun.state === "running" ? "controlledAgent.commandRunning" : terminalResult ? "controlledAgent.commandResult" : "controlledAgent.commandPlanned";
  const status: CodingSessionTraceEntry["status"] = commandRun.state === "blocked" || commandRun.state === "disabled" || commandRun.state === "failed" || commandRun.state === "timed_out" || commandRun.state === "killed" ? "failed" : commandRun.state === "running" ? "in_progress" : commandRun.state === "succeeded" ? "succeeded" : "info";
  return {
    id: `controlled-command-run-${commandRun.state}`,
    timestamp: "1970-01-01T00:00:00.000Z",
    family,
    title: commandRun.state === "blocked" || commandRun.state === "disabled" ? "Controlled command blocked" : commandRun.state === "running" ? "Controlled command running metadata visible" : terminalResult ? "Controlled command result evidence visible" : "Controlled command planned metadata visible",
    status,
    summary: `Allowlisted controlled command-id evidence: ${commandRun.summary}`,
    details: {
      displayOnly: true,
      allowlistedCommandIdEvidence: true,
      allowedToRunCommand: commandRun.allowedToRunCommand,
      state: commandRun.state,
      commandId: commandRun.commandId ?? "none",
      commandIdLabel: commandRun.commandIdLabel ?? "none",
      exitCode: typeof commandRun.details.exitCode === "number" ? commandRun.details.exitCode : -1,
      durationMs: typeof commandRun.details.durationMs === "number" ? commandRun.details.durationMs : 0,
      outputByteCount: commandRun.outputTail?.outputByteCount ?? (typeof commandRun.details.outputByteCount === "number" ? commandRun.details.outputByteCount : 0),
      outputLineCount: commandRun.outputTail?.outputLineCount ?? (typeof commandRun.details.outputLineCount === "number" ? commandRun.details.outputLineCount : 0),
      truncated: commandRun.outputTail?.truncated ?? false,
      resultHash: commandRun.outputTail?.resultHash ?? "none",
      canRunShell: commandRun.canRunShell,
      canUseGit: commandRun.canUseGit,
      canUseNetwork: commandRun.canUseNetwork,
      canCallProvider: commandRun.canCallProvider,
      canUseTools: commandRun.canUseTools,
      canReadFiles: commandRun.canReadFiles,
      canWriteFiles: commandRun.canWriteFiles,
    },
  };
}

function createControlledAgentRuntimeSessionTraceEntry(metadata: unknown): CodingSessionTraceEntry | null {
  if (metadata === undefined) {
    return null;
  }
  const session = evaluateControlledAgentRuntimeSession(metadata);
  const family: CodingSessionTraceEntry["family"] = session.status === "ready_to_start" || session.status === "session_open_metadata" || session.status === "stopped" ? "controlledAgent.runtimeSessionReady" : session.status === "start_requested_metadata" ? "controlledAgent.runtimeSessionStartRequested" : session.status === "stop_requested_metadata" ? "controlledAgent.runtimeSessionStopRequested" : "controlledAgent.runtimeSessionBlocked";
  const status: CodingSessionTraceEntry["status"] = session.status === "blocked" || session.status === "unsupported_host" || session.status === "preconditions_blocked" || session.status === "opt_in_required" ? "failed" : session.status === "start_requested_metadata" || session.status === "stop_requested_metadata" ? "pending" : "info";
  return {
    id: `controlled-runtime-session-${session.status}`,
    timestamp: "1970-01-01T00:00:00.000Z",
    family,
    title: session.status === "blocked" ? "Controlled runtime session metadata blocked" : session.status === "start_requested_metadata" ? "Controlled runtime session start metadata visible" : session.status === "stop_requested_metadata" ? "Controlled runtime session stop metadata visible" : "Controlled runtime session evidence visible",
    status,
    summary: `Controlled runtime session metadata evidence: ${session.label}`,
    details: {
      displayOnly: true,
      metadataOnly: session.session.metadataOnly,
      status: session.status,
      nextUserAction: session.nextUserAction,
      host: session.hostSupport.host,
      hostSupported: session.hostSupport.supported,
      workspaceReady: session.preconditions.workspaceReady,
      sessionState: session.session.state,
      sequence: session.session.sequence,
      terminal: session.session.terminal,
      executionAllowed: session.safetyFlags.executionAllowed,
      agentStartAllowed: session.safetyFlags.agentStartAllowed,
      autoStartAllowed: session.safetyFlags.autoStartAllowed,
      canReadFiles: session.safetyFlags.canReadFiles,
      canWriteFiles: session.safetyFlags.canWriteFiles,
      canRunCommands: session.safetyFlags.canRunCommands,
      canApplyEdits: session.safetyFlags.canApplyEdits,
      canCallProvider: session.safetyFlags.canCallProvider,
      diagnosticCodes: session.diagnostics.map((item) => item.code),
    },
  };
}

function buildProposalHistoryEntries({ modelProposalResult, editProposal, rejectedEditProposal, applyResult, verificationAttempt, planProposal }: { modelProposalResult: AgentRunModelProposalResult; editProposal: EditProposalState | null; rejectedEditProposal: { sourceMessageId: string; diagnostic: EditProposalRejectedDiagnostic } | null; applyResult: ApplyResultState | null; verificationAttempt: IdeActionAttemptState | null; planProposal: ManualRunnerPlanProposal | null }): ProposalHistoryEntryInput[] {
  const entries: ProposalHistoryEntryInput[] = [];
  const modelProposal = modelProposalResult.agentRunInput.proposal;
  if (modelProposalResult.proposalPathState === "proposal_detected" && modelProposal) {
    entries.push({ id: modelProposal.id, source: "model-proposal", kind: "original", status: "detected", summary: modelProposal.summary, touchedFiles: modelProposal.touchedFiles, editCount: editProposal?.payload.edits.reduce((count, edit) => count + edit.textReplacements.length, 0) });
  }
  if (modelProposalResult.proposalPathState === "plan_detected" && modelProposalResult.planPreview) {
    entries.push({ id: modelProposalResult.planPreview.sourceMessageId, source: "model-plan-preview", kind: "plan_preview", status: "preview", summary: modelProposalResult.planPreview.plan.summary || modelProposalResult.planPreview.plan.title, touchedFiles: modelProposalResult.planPreview.plan.expectedTouchedFiles });
  }
  if (modelProposalResult.proposalPathState === "proposal_rejected" || modelProposalResult.proposalPathState === "plan_rejected" || modelProposalResult.proposalPathState === "blocked") {
    entries.push({ id: submittedProposalDiagnosticId(modelProposalResult), source: "model-proposal", kind: "rejected", status: "rejected", summary: "Model proposal metadata was rejected safely.", diagnostics: modelProposalResult.diagnostics.map((item) => `${item.code}: ${item.message}`) });
  }
  if (editProposal) {
    entries.push({ id: editProposal.requestId, source: editProposal.sourceMessageId, kind: "original", status: "detected", summary: editProposal.payload.summary, touchedFiles: editProposal.payload.edits.map((edit) => edit.workspaceRelativePath), editCount: editProposal.payload.edits.reduce((count, edit) => count + edit.textReplacements.length, 0) });
  }
  if (rejectedEditProposal) {
    entries.push({ id: rejectedEditProposal.sourceMessageId, source: "edit-proposal", kind: "rejected", status: "rejected", summary: rejectedEditProposal.diagnostic.message, diagnostic: rejectedEditProposal.diagnostic.reasonCode });
  }
  if (applyResult) {
    entries.push({ id: applyResult.proposalRequestId ?? applyResult.requestId, source: applyResult.requestId, kind: "applied", status: applyResult.payload.status === "applied" ? "applied" : "apply_failed", applyStatus: applyResult.payload.status === "applied" ? "applied" : "failed", summary: applyResult.payload.message, touchedFiles: applyResult.payload.affectedFiles, editCount: applyResult.payload.appliedEditCount });
  }
  if (verificationAttempt?.action === "runVerificationCommand" && verificationAttempt.result?.action === "runVerificationCommand" && (verificationAttempt.result.status === "succeeded" || verificationAttempt.result.status === "failed")) {
    entries.push({ id: verificationAttempt.requestId, source: verificationAttempt.result.commandId ?? "verification", kind: "verification", status: verificationAttempt.result.status === "succeeded" ? "verification_succeeded" : "verification_failed", verificationStatus: verificationAttempt.result.status === "succeeded" ? "succeeded" : "failed", summary: verificationAttempt.result.message, diagnostic: verificationAttempt.result.exitCode !== undefined ? `Exit code ${verificationAttempt.result.exitCode}` : undefined });
  }
  if (planProposal) {
    entries.push({ id: planProposal.title, source: "manual-runner", kind: "plan_preview", status: "preview", summary: planProposal.rationale, diagnostics: planProposal.steps });
  }
  return entries;
}

function submittedProposalDiagnosticId(result: AgentRunModelProposalResult): string {
  return `proposal-history-${result.proposalPathState}`;
}

function agentRunPlanPreviewInput(plan: NonNullable<AgentRunModelProposalResult["planPreview"]>["plan"]): NonNullable<AgentRunInput["planPreview"]> {
  return {
    title: plan.title,
    summary: plan.summary,
    steps: plan.steps.map((step) => `${step.title}: ${step.summary}`),
    risks: plan.risks,
    expectedTouchedFiles: plan.expectedTouchedFiles,
    verificationSuggestions: plan.verificationSuggestions.map((item) => `${item.label} (${item.commandId})`),
  };
}

function agentRunRunId(input: AgentRunInput): string {
  const loopId = isRecord(input.boundedLoop) && typeof input.boundedLoop.loopId === "string" ? input.boundedLoop.loopId : undefined;
  const proposalId = input.proposal?.id;
  const goalId = input.goal?.id;
  return (loopId ?? proposalId ?? goalId ?? "agent-run").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128) || "agent-run";
}

function latestAssistantMessageAfterPrompt(messages: ChatViewMessage[], prompt: string): ChatViewMessage | undefined {
  let promptIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content === prompt) {
      promptIndex = index;
      break;
    }
  }
  if (promptIndex < 0) {
    return undefined;
  }
  for (let index = messages.length - 1; index > promptIndex; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message;
    }
  }
  return undefined;
}

function agentRunReadinessLoopId(proposalId: string | undefined, requestId: string | undefined): string {
  const source = proposalId ?? requestId ?? "model-proposal";
  const safe = source.replace(/[^A-Za-z0-9._-]/g, "");
  return `agentRun${safe || "proposal"}`.slice(0, 80);
}

function agentRunReadinessGoalMetadata(goal: AgentRunInput["goal"]) {
  if (!goal) {
    return undefined;
  }
  return { id: "model-proposal-goal", ...goal };
}

function agentRunReadinessProposalMetadata(proposal: AgentRunInput["proposal"], editProposal: EditProposalState | null) {
  if (!proposal) {
    return undefined;
  }
  const editCount = editProposal?.payload.edits.reduce((count, edit) => count + edit.textReplacements.length, 0) ?? Math.max(1, proposal.touchedFiles?.length ?? 1);
  const patchBytes = editProposal?.payload.edits.reduce((count, edit) => count + edit.textReplacements.reduce((inner, replacement) => inner + replacement.replacementText.length, 0), 0) ?? 1;
  return {
    ...proposal,
    source: "assistant_proposal" as const,
    editCount,
    patchBytes: Math.max(1, patchBytes),
    contentHash: safeAgentRunHash(),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAgentRunInput(goal: string, proposal: EditProposalState | null, applyResult: ApplyResultState | null, verificationAttempt: IdeActionAttemptState | null): AgentRunInput | undefined {
  const goalText = goal.trim();
  if (!goalText && !proposal) {
    return undefined;
  }
  const boundedLoop = proposal ? buildAgentRunBoundedLoop(proposal, applyResult, verificationAttempt) : undefined;
  const input: AgentRunInput = {
    goal: { id: "local-agent-run-goal", title: goalText || "Review latest safe edit proposal", summary: goalText || proposal?.payload.summary },
    proposal: proposal ? { id: proposal.requestId, summary: proposal.payload.summary, touchedFiles: proposal.payload.edits.map((edit) => edit.workspaceRelativePath) } : undefined,
    boundedLoop,
    rollback: { available: Boolean(applyResult) && !(verificationAttempt?.result?.action === "runVerificationCommand"), summary: applyResult && !(verificationAttempt?.result?.action === "runVerificationCommand") ? "Rollback review is available through existing checkpoint surfaces only." : undefined },
  };
  if (applyResult) {
    input.applyRequest = { requested: true, source: "user", requestId: applyResult.requestId };
    input.applyResult = {
      status: applyResult.payload.status === "applied" ? "applied" : "failed",
      summary: applyResult.payload.message,
      appliedFileCount: applyResult.payload.affectedFiles?.length,
    };
  }
  if (verificationAttempt?.action === "runVerificationCommand") {
    if (verificationAttempt.status === "pending" || verificationAttempt.status === "inProgress") {
      input.verificationRequest = { requested: true, source: "user", requestId: verificationAttempt.requestId };
      input.verificationProgress = { status: verificationAttempt.status === "pending" ? "queued" : "running", summary: verificationAttempt.message };
    }
    if (verificationAttempt.result?.action === "runVerificationCommand" && (verificationAttempt.result.status === "succeeded" || verificationAttempt.result.status === "failed")) {
      input.verificationRequest = { requested: true, source: "user", requestId: verificationAttempt.requestId };
      input.verificationResult = {
        status: verificationAttempt.result.status === "succeeded" ? "succeeded" : "failed",
        exitCode: verificationAttempt.result.exitCode,
        durationMs: verificationAttempt.result.durationMs,
        outputTail: verificationAttempt.result.outputTail,
      };
    }
  }
  return input;
}

function buildAgentRunBoundedLoop(proposal: EditProposalState, applyResult: ApplyResultState | null, verificationAttempt: IdeActionAttemptState | null): BoundedPatchVerificationLoopMetadata {
  const editCount = proposal.payload.edits.reduce((count, edit) => count + edit.textReplacements.length, 0);
  const patchBytes = proposal.payload.edits.reduce((count, edit) => count + edit.textReplacements.reduce((inner, replacement) => inner + replacement.replacementText.length, 0), 0);
  const verificationResult = verificationAttempt?.result?.action === "runVerificationCommand" && (verificationAttempt.result.status === "succeeded" || verificationAttempt.result.status === "failed") ? verificationAttempt.result : null;
  const status: BoundedPatchVerificationLoopMetadata["status"] = verificationResult
    ? verificationResult.status === "succeeded" ? "verified" : "verification_failed"
    : applyResult?.payload.status === "applied" ? "ready_for_verification" : "ready_for_apply";
  const policyDecision: BoundedPatchVerificationLoopMetadata["policy"]["decision"] = status === "ready_for_apply" ? "ready_for_user_apply" : status === "verified" ? "completed" : "ready_for_user_verification";
  const verificationCommandId = verificationCommandIdOrDefault(verificationResult?.commandId ?? verificationAttempt?.progress?.commandId);
  const verificationStatus: BoundedPatchVerificationLoopMetadata["verification"]["status"] = verificationResult ? verificationResult.status === "succeeded" ? "succeeded" : "failed" : applyResult?.payload.status === "applied" ? "ready" : "not_requested";
  return {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status,
    loopId: `guiAgentRun${proposal.requestId.replace(/[^A-Za-z0-9._-]/g, "")}`.slice(0, 80),
    sandbox: { modeStatus: applyResult ? "rollback_ready" : "checkpoint_ready", checkpointId: "gui-agent-run-checkpoint", checkpointVerified: true, checkpointHash: safeAgentRunHash() },
    limits: { maxTouchedFiles: 4, maxPatchBytes: 50000, maxSteps: 16, maxVerificationSeconds: 1800 },
    patch: { proposalId: proposal.requestId, source: "gui_review", touchedFiles: proposal.payload.edits.map((edit) => edit.workspaceRelativePath), editCount, patchBytes: Math.max(1, patchBytes), contentHash: safeAgentRunHash(), summary: proposal.payload.summary },
    policy: { decision: policyDecision, requiresUserConfirmation: true, reasonCodes: policyDecision === "ready_for_user_apply" ? ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only"] : ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "user_apply_result_recorded"] },
    verification: {
      commandId: verificationCommandId,
      status: verificationStatus,
      result: verificationResult && verificationResult.exitCode !== undefined && verificationResult.durationMs !== undefined && verificationResult.outputTail !== undefined && verificationResult.truncated !== undefined ? { exitCode: verificationResult.exitCode, durationMs: verificationResult.durationMs, outputTail: verificationResult.outputTail, truncated: verificationResult.truncated, resultHash: safeAgentRunHash() } : undefined,
    },
    summary: status === "ready_for_apply" ? "Agent Run is ready for explicit reviewed patch apply." : status === "verified" ? "Agent Run verification succeeded after explicit user request." : status === "verification_failed" ? "Agent Run verification failed after explicit user request." : "Agent Run is ready for explicit allowlisted verification.",
  };
}

function verificationCommandIdOrDefault(value: VerificationCommandId | undefined): VerificationCommandId {
  return value === "gui-app-tests" || value === "engine-chat-tests" || value === "repository-check" ? value : "repository-check";
}

function verificationCommandIdOrUndefined(value: unknown): VerificationCommandId | undefined {
  return value === "gui-app-tests" || value === "engine-chat-tests" || value === "repository-check" ? value : undefined;
}

function safeAgentRunHash(): `sha256:${string}` {
  return "sha256:0000000000000000000000000000000000000000000000000000000000000000";
}

function isVerificationOutputResult(result: IdeActionResultPayload): result is IdeActionResultPayload & Omit<VerificationOutputBundleItem, "kind" | "key"> & { action: "runVerificationCommand"; status: "succeeded" | "failed"; commandId: NonNullable<IdeActionResultPayload["commandId"]>; exitCode: number; outputTail: string; truncated: boolean } {
  return result.action === "runVerificationCommand" && (result.status === "succeeded" || result.status === "failed") && result.commandId !== undefined && result.exitCode !== undefined && result.outputTail !== undefined && result.truncated !== undefined;
}

function agentRunVerificationPromptResult(input: AgentRunInput | undefined, mode: VerificationFollowupPromptMode): VerificationResultForPrompt | null {
  const result = input?.verificationResult;
  if (!result || (mode === "followup" && result.status !== "succeeded") || (mode === "fix" && result.status !== "failed")) {
    return null;
  }
  const boundedLoop = isRecord(input?.boundedLoop) ? input.boundedLoop : undefined;
  const verification = isRecord(boundedLoop?.verification) ? boundedLoop.verification : undefined;
  const nestedResult = isRecord(verification?.result) ? verification.result : undefined;
  const commandId = verificationCommandIdOrDefault(verificationCommandIdOrUndefined(verification?.commandId));
  return {
    status: result.status,
    message: result.status === "succeeded" ? "Agent Run verification succeeded." : "Agent Run verification failed.",
    cloudRequired: false as const,
    action: "runVerificationCommand" as const,
    commandId,
    exitCode: result.exitCode ?? (result.status === "succeeded" ? 0 : 1),
    durationMs: result.durationMs,
    outputTail: result.outputTail ?? "Agent Run verification result metadata is available without raw output.",
    truncated: typeof nestedResult?.truncated === "boolean" ? nestedResult.truncated : false,
  };
}

function isVerificationOutputBundleItem(item: ExplicitContextBundleItem): item is VerificationOutputBundleItem {
  return item.kind === "verification_output";
}

function isWorkspaceSnippetBundleItem(item: ExplicitContextBundleItem): item is WorkspaceSnippetBundleItem {
  return item.kind === "workspace_snippet";
}

function isProjectMemoryBundleItem(item: ExplicitContextBundleItem): item is ProjectMemoryBundleItem {
  return item.kind === "project_memory";
}

function isWorkspaceSnippetSearchResult(result: IdeActionResultPayload): result is WorkspaceSnippetSearchResultPayload {
  return result.action === "searchWorkspaceSnippets" && result.status === "succeeded" && result.queryLabel !== undefined && result.resultCount !== undefined && Array.isArray(result.snippets) && result.truncated !== undefined;
}

function buildActiveFilePromptAction(excerpt: ActiveFileExcerptAttachment): ActiveFilePromptAction {
  const fileLabel = activeFileExcerptSummary(excerpt);
  const language = excerpt.file.languageId ? sanitizeDisplayText(excerpt.file.languageId) : "unknown language";
  const range = `${excerpt.range.start.line}:${excerpt.range.start.character}-${excerpt.range.end.line}:${excerpt.range.end.character}`;
  return {
    label: "Ask about active file",
    prompt: `Use only the attached one-shot active-file excerpt for ${fileLabel} (${language}), excerpt range ${range}.\nCoding action: ask_about_active_file\n\nExplain what this active file excerpt is doing, call out any likely issues or follow-up questions, and suggest one safe next step. Do not read hidden files, run tools, or apply changes automatically.`,
  };
}

function upsertChatSummary(current: ChatSummary[], thread: { chatId: string; title: string; createdAt: string; updatedAt: string; messages: unknown[] }): ChatSummary[] {
  const summary: ChatSummary = {
    chatId: thread.chatId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
  };
  const withoutExisting = current.filter((item) => item.chatId !== summary.chatId);
  return [summary, ...withoutExisting].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function ideActionLabel(action: IdeActionType): string {
  switch (action) {
    case "getContextSnapshot":
      return "Get IDE context";
    case "getActiveFileExcerpt":
      return "Attach active file excerpt";
    case "openWorkspaceFile":
      return "Open file";
    case "revealWorkspaceRange":
      return "Reveal range";
    case "runVerificationCommand":
      return "Run verification command";
    case "searchWorkspaceSnippets":
      return "Search project snippets";
  }
}


export function rememberCompletedIdeActionRequest(completedRequests: Map<string, string>, requestId: string, chatId: string, limit = completedIdeActionRequestChatsLimit) {
  if (limit <= 0) {
    completedRequests.clear();
    return;
  }
  if (completedRequests.has(requestId)) {
    completedRequests.delete(requestId);
  }
  completedRequests.set(requestId, chatId);
  while (completedRequests.size > limit) {
    const oldestRequestId = completedRequests.keys().next().value;
    if (typeof oldestRequestId !== "string") {
      completedRequests.clear();
      return;
    }
    completedRequests.delete(oldestRequestId);
  }
}

export function rememberCompletedApplyRequest(completedRequests: Map<string, string>, requestId: string, chatId: string, limit = completedApplyRequestChatsLimit) {
  if (limit <= 0) {
    completedRequests.clear();
    return;
  }
  if (completedRequests.has(requestId)) {
    completedRequests.delete(requestId);
  }
  completedRequests.set(requestId, chatId);
  while (completedRequests.size > limit) {
    const oldestRequestId = completedRequests.keys().next().value;
    if (typeof oldestRequestId !== "string") {
      completedRequests.clear();
      return;
    }
    completedRequests.delete(oldestRequestId);
  }
}

function ChatEmptyState({ runtimeConnected, canSendChat, providerReady, activeDemoMode, selectedModelDisplayName, selectedModelProviderId, context, hasLocalConversations, onProviderSetup, onRefreshRuntime }: { runtimeConnected: boolean; canSendChat: boolean; providerReady: boolean; activeDemoMode: boolean; selectedModelDisplayName?: string; selectedModelProviderId?: string; context: HostContextSnapshotPayload | null; hasLocalConversations: boolean; onProviderSetup: () => void; onRefreshRuntime: () => void }) {
  if (!runtimeConnected) {
    return (
      <div className="chat-empty-state" role="status">
        <span className="badge warn">Runtime unavailable</span>
        <strong>Start here: connect the local runtime.</strong>
        <span>Click Refresh runtime, or start the IDE-managed local runtime if this installed host did not start it. Chat, providers, and history stay local-first; no hosted Yet AI backend, account, cloud workspace, or credit balance is required.</span>
        <button type="button" onClick={onRefreshRuntime}>Refresh runtime</button>
      </div>
    );
  }
  if (!providerReady) {
    return (
      <div className="chat-empty-state" role="status">
        <span className="badge warn">Provider required</span>
        <strong>Choose how this first chat should answer.</strong>
        <span>Try Demo Mode from Chat readiness for local canned responses with no API key, configure Ollama local for direct loopback model answers with auth None, or configure a BYOK OpenAI-compatible provider. Provider credentials are sent only to the local runtime and are not stored by the GUI.</span>
        <button type="button" onClick={onProviderSetup}>Use OpenAI API key fallback</button>
      </div>
    );
  }
  if (context && hasUsableAttachedContext(context)) {
    const fileLabel = sanitizeDisplayText(context.file?.displayPath ?? context.file?.workspaceRelativePath ?? "the active editor");
    return (
      <div className="chat-empty-state ready" role="status">
        <span className="badge ok">{activeDemoMode ? "Demo Mode ready" : "Ready"}</span>
        <strong>Ready to ask about {fileLabel}.</strong>
        <span>{activeDemoMode ? "Send to try the attached-context flow with local canned responses; no provider call will be made." : `Send through ${selectedModelDisplayName ?? "the selected model"}${selectedModelProviderId ? ` (${selectedModelProviderId})` : ""}, or turn off attached context before sending.`}</span>
      </div>
    );
  }
  return (
    <div className="chat-empty-state ready" role="status">
      <span className="badge ok">{activeDemoMode ? "Demo Mode ready" : "Ready"}</span>
      <strong>{activeDemoMode ? "Demo Mode is ready for a no-key first message." : hasLocalConversations ? "This local conversation is empty." : "Ready for your first local conversation."}</strong>
      <span>{activeDemoMode ? "Send a prompt to verify chat UX with runtime-owned canned responses. Configure a BYOK provider when you need real model quality." : `Ask about code, architecture, tests, or the current task. Sends go through ${selectedModelDisplayName ?? "the selected model"}${selectedModelProviderId ? ` (${selectedModelProviderId})` : ""} via the local runtime, and history is engine-owned local storage.`}</span>
    </div>
  );
}

function ChatBubble({ message, activeEditProposal, rejectedEditProposalSourceMessageId, activeIdeActionProposal, rejectedIdeActionProposalSourceMessageId }: { message: ChatViewMessage; activeEditProposal: EditProposalState | null; rejectedEditProposalSourceMessageId: string | null; activeIdeActionProposal: IdeActionProposalState | null; rejectedIdeActionProposalSourceMessageId: string | null }) {
  const editProposal = message.role === "assistant" && isCompleteAssistantEditProposalStatus(message.status) ? parseEditProposalContent(message.content) : null;
  const editProposalAnalysis = message.role === "assistant" && isCompleteAssistantEditProposalStatus(message.status) ? analyzeEditProposalContent(message.content) : { state: "none" as const };
  const editProposalJson = editProposal ? JSON.stringify(editProposal, null, 2) : null;
  const editProposalKey = editProposal ? editProposalPayloadKey(editProposal) : null;
  const isActiveEditProposal = Boolean(editProposalKey && activeEditProposal?.sourceMessageId === message.id && activeEditProposal.payloadKey === editProposalKey);
  const isRejectedEditProposal = editProposalAnalysis.state === "rejected" && rejectedEditProposalSourceMessageId === message.id;
  const proposal = message.role === "assistant" && isCompleteAssistantIdeActionProposalStatus(message.status) ? parseAssistantIdeActionProposalContent(message.content) : null;
  const proposalJson = proposal ? JSON.stringify(proposal, null, 2) : null;
  const proposalPayloadKey = proposal ? ideActionProposalPayloadKey(proposal) : null;
  const proposalLabel = proposal ? sanitizeDisplayText(describeIdeActionProposal(proposal)) : null;
  const isActiveProposal = Boolean(proposalPayloadKey && activeIdeActionProposal?.sourceMessageId === message.id && activeIdeActionProposal.payloadKey === proposalPayloadKey);
  const proposalAnalysis = message.role === "assistant" && isCompleteAssistantIdeActionProposalStatus(message.status) ? analyzeAssistantIdeActionProposalContent(message.content) : { state: "none" as const };
  const isRejectedIdeActionProposal = proposalAnalysis.state === "rejected" && rejectedIdeActionProposalSourceMessageId === message.id;

  return (
    <div className={`chat-bubble ${message.role}`}>
      <strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Yet AI" : "Error"}</strong>
      {editProposal && editProposalJson && editProposalKey ? (
        <div className="assistant-proposal-compact stack">
          <span>{isActiveEditProposal ? "Safe edit proposal ready for review. Nothing applies automatically." : "Earlier safe edit proposal. Only the latest valid proposal can be requested from the proposal card."}</span>
          <div className="proposal-summary-grid" aria-label="Edit proposal summary">
            <span>Files: {editProposal.edits.length}</span>
            <span>Edits: {editProposal.edits.reduce((count, edit) => count + edit.textReplacements.length, 0)}</span>
            <span>Confirmation: {editProposal.requiresUserConfirmation ? "required" : "missing"}</span>
          </div>
          <details className="inspect-details">
            <summary>Inspect sanitized proposal JSON</summary>
            <pre aria-label="Assistant edit proposal JSON">{editProposalJson}</pre>
          </details>
        </div>
      ) : isRejectedEditProposal && editProposalAnalysis.state === "rejected" ? (
        <div className="assistant-proposal-compact stack rejection-summary-card" role="status">
          <strong>Edit proposal blocked</strong>
          <span>{sanitizeDisplayText(editProposalAnalysis.diagnostic.message)}</span>
          <span className="subtle">No apply action is available. Security-relevant rejection summary is shown here first.</span>
          <details className="inspect-details">
            <summary>Inspect rejection policy details</summary>
            <pre aria-label="Edit proposal rejection details">{JSON.stringify(sanitizeDisplayValue(editProposalAnalysis.diagnostic), null, 2)}</pre>
          </details>
        </div>
      ) : isRejectedIdeActionProposal && proposalAnalysis.state === "rejected" ? (
        <div className="assistant-proposal-compact stack rejection-summary-card" role="status">
          <strong>IDE action proposal blocked</strong>
          <span>{sanitizeDisplayText(proposalAnalysis.diagnostic.message)}</span>
          <span className="subtle">No IDE action is available. Security-relevant rejection summary is shown here first.</span>
          <details className="inspect-details">
            <summary>Inspect rejection policy details</summary>
            <pre aria-label="IDE action proposal rejection details">{JSON.stringify(sanitizeDisplayValue(proposalAnalysis.diagnostic), null, 2)}</pre>
          </details>
        </div>
      ) : proposal && proposalJson && proposalLabel ? (
        <div className="assistant-proposal-compact stack">
          <span>{isActiveProposal ? `Read-only IDE action proposal ready: . It will not run automatically.` : `Earlier read-only IDE action proposal: . Only the latest valid proposal can be run from the proposal card.`}</span>
          <div className="proposal-summary-grid" aria-label="IDE action proposal summary">
            <span>Action: {sanitizeDisplayText(proposal.action)}</span>
            <span>Confirmation: {proposal.requiresUserConfirmation ? "required" : "missing"}</span>
            <span>Cloud required: {String(proposal.cloudRequired)}</span>
          </div>
          <details className="inspect-details">
            <summary>Inspect sanitized proposal JSON</summary>
            <pre aria-label="Assistant proposal JSON">{proposalJson}</pre>
          </details>
        </div>
      ) : (
        <span>{message.content || (message.status === "streaming" ? "…" : "")}</span>
      )}
    </div>
  );
}

function readinessStateLabel(state: ProviderReadinessState, canSendChat: boolean): string {
  if (state === "demo_mode_ready") {
    return "Demo Mode ready — local canned responses, no provider calls";
  }
  if (state === "openai_compatible_ready") {
    return "OpenAI-compatible BYOK ready through the local runtime";
  }
  if (state === "local_provider_ready") {
    return "Local provider ready through direct local runtime calls";
  }
  if (state === "model_provider_mismatch") {
    return "Model/provider mismatch";
  }
  if (state === "missing_credentials") {
    return "Provider API key or local credential required";
  }
  if (state === "missing_model") {
    return "Configured provider model missing";
  }
  if (state === "unsupported_model") {
    return "Selected model lacks chat streaming support";
  }
  if (state === "local_provider_unready") {
    return "Local provider or Ollama model not ready";
  }
  if (state === "provider_error") {
    return "Runtime/provider refresh failed";
  }
  if (state === "model_not_ready") {
    return "Model not ready";
  }
  if (state === "provider_required") {
    return "Provider required";
  }
  return canSendChat ? "Runtime connected" : "Runtime unavailable";
}

function FirstRunChecklist({ runtimeConnected, demoModeReady, apiKeyReady, experimentalAccountReady, canSendChat, readinessState }: { runtimeConnected: boolean; demoModeReady: boolean; apiKeyReady: boolean; experimentalAccountReady: boolean; canSendChat: boolean; readinessState: ProviderReadinessState }) {
  const modelReady = demoModeReady || apiKeyReady || experimentalAccountReady;
  const steps = [
    { label: "Runtime", detail: runtimeConnected ? "connected" : "refresh local runtime", ok: runtimeConnected },
    { label: "Model path", detail: demoModeReady ? "Demo Mode ready" : apiKeyReady ? readinessState === "local_provider_ready" ? "local provider ready" : "BYOK provider ready" : experimentalAccountReady ? "experimental fallback ready" : "choose Demo Mode or BYOK", ok: modelReady },
    { label: "First message", detail: canSendChat ? "Send available" : "Send disabled", ok: canSendChat },
  ];
  return (
    <div className="first-run-checklist compact" role="list" aria-label="First-run setup checklist">
      {steps.map((step) => (
        <span className={`first-run-step ${step.ok ? "ok" : "todo"}`} role="listitem" key={step.label}>
          <strong>{step.label}</strong>
          <span>{step.detail}</span>
        </span>
      ))}
    </div>
  );
}

function FirstMessageReadinessWizard({ readiness, canSendChat, runtimeRefreshInFlight, providerTestState, demoModeEnabled, demoModeWorking, onRefreshRuntime, onToggleDemoMode, onApiKeyFallback, onTestProvider, onFocusPrompt }: {
  readiness: FirstMessageReadiness;
  canSendChat: boolean;
  runtimeRefreshInFlight: boolean;
  providerTestState: ProviderTestState | null;
  demoModeEnabled: boolean;
  demoModeWorking: boolean;
  onRefreshRuntime: () => void;
  onToggleDemoMode: (enabled: boolean) => void;
  onApiKeyFallback: () => void;
  onTestProvider: (providerId: string) => void;
  onFocusPrompt: () => void;
}) {
  const primaryAction = readiness.actions[0];
  const secondaryActions = readiness.actions.slice(1);
  return (
    <div className={`first-message-wizard compact ${canSendChat ? "ready" : "blocked"}`} role="status" aria-label="First message readiness guide">
      <div className="readiness-compact-main">
        <div className="stack">
          <div className="row">
            <strong>{readiness.title}</strong>
            <span className={`badge ${canSendChat ? "ok" : "warn"}`}>{canSendChat ? "Send available" : "Send disabled"}</span>
          </div>
          <span>Next: {readiness.nextAction}</span>
        </div>
        {primaryAction && <div className="readiness-primary-action"><FirstMessageActionButton action={primaryAction} runtimeRefreshInFlight={runtimeRefreshInFlight} providerTestState={providerTestState} demoModeEnabled={demoModeEnabled} demoModeWorking={demoModeWorking} onRefreshRuntime={onRefreshRuntime} onToggleDemoMode={onToggleDemoMode} onApiKeyFallback={onApiKeyFallback} onTestProvider={onTestProvider} onFocusPrompt={onFocusPrompt} /></div>}
      </div>
      <details className="first-message-notes" data-testid="first-message-local-first-notes">
        <summary>Why this is safe</summary>
        <div className="stack">
          <span>Why: {readiness.reason}</span>
          {secondaryActions.length > 0 && <div className="readiness-action-row" aria-label="Additional readiness actions">
            {secondaryActions.map((action) => <FirstMessageActionButton key={`${action.kind}:${"providerId" in action ? action.providerId : action.label}`} action={action} runtimeRefreshInFlight={runtimeRefreshInFlight} providerTestState={providerTestState} demoModeEnabled={demoModeEnabled} demoModeWorking={demoModeWorking} onRefreshRuntime={onRefreshRuntime} onToggleDemoMode={onToggleDemoMode} onApiKeyFallback={onApiKeyFallback} onTestProvider={onTestProvider} onFocusPrompt={onFocusPrompt} />)}
          </div>}
          <ol className="first-message-steps">
            {readiness.notes.map((note) => <li key={note}>{note}</li>)}
          </ol>
        </div>
      </details>
    </div>
  );
}

function FirstMessageActionButton({ action, runtimeRefreshInFlight, providerTestState, demoModeEnabled, demoModeWorking, onRefreshRuntime, onToggleDemoMode, onApiKeyFallback, onTestProvider, onFocusPrompt }: {
  action: FirstMessageAction;
  runtimeRefreshInFlight: boolean;
  providerTestState: ProviderTestState | null;
  demoModeEnabled: boolean;
  demoModeWorking: boolean;
  onRefreshRuntime: () => void;
  onToggleDemoMode: (enabled: boolean) => void;
  onApiKeyFallback: () => void;
  onTestProvider: (providerId: string) => void;
  onFocusPrompt: () => void;
}) {
  if (action.kind === "refresh_runtime") {
    return <button type="button" onClick={onRefreshRuntime} disabled={runtimeRefreshInFlight}>{runtimeRefreshInFlight ? "Checking runtime…" : action.label}</button>;
  }
  if (action.kind === "api_key_fallback") {
    return <button type="button" onClick={onApiKeyFallback}>{action.label}</button>;
  }
  if (action.kind === "enable_demo_mode") {
    return <button type="button" onClick={() => onToggleDemoMode(!demoModeEnabled)} disabled={demoModeWorking}>{demoModeWorking ? "Changing Demo Mode…" : action.label}</button>;
  }
  if (action.kind === "test_provider") {
    const testing = providerTestState?.providerId === action.providerId && providerTestState.state === "testing";
    return <button type="button" onClick={() => onTestProvider(action.providerId)} disabled={testing}>{testing ? "Testing provider…" : action.label}</button>;
  }
  return <button type="button" onClick={onFocusPrompt}>{action.label}</button>;
}

function WhatWillBeSentPanel({ summary, draftPromptCharacters }: { summary: ContextBudgetSummary; draftPromptCharacters: number }) {
  const visibleSources = summary.sources.filter((source) => source.itemCount > 0 || source.charCount > 0);
  const visibleLocalReviewMetadata = summary.localReviewMetadata.slice(0, 4);
  const visibleLabels = summary.labels.slice(0, 6);
  const included = summary.totalIncludedItems;
  const omitted = summary.omittedItemCount;
  const tone = summary.warnings.length > 0 ? "warn" : included > 0 || draftPromptCharacters > 0 ? "ready" : "warn";
  return (
    <section className={`what-will-be-sent-card readiness-card ${tone} stack`} aria-label="What will be sent">
      <div className="row">
        <strong>What will be sent</strong>
        <span className="badge">preview labels only</span>
        <span className={summary.warnings.length === 0 ? "badge ok" : "badge warn"}>{summary.warnings.length} warning{summary.warnings.length === 1 ? "" : "s"}</span>
      </div>
      <div className="what-will-be-sent-totals" aria-label="What will be sent totals">
        <span>Draft prompt: {draftPromptCharacters} chars</span>
        <span>Included context: {included} item{included === 1 ? "" : "s"} · {summary.totalIncludedCharacters} chars</span>
        <span>Omitted: {omitted} · Excluded: {summary.excludedItemCount}</span>
      </div>
      <span className="subtle">{visibleSources.length === 0 && draftPromptCharacters === 0 ? "One-shot labels only; no raw bodies or browser storage." : "One-shot next-Send preview: labels, status, and approximate chars only; no raw prompt dump, context bodies, or browser storage."}</span>
      {visibleSources.length === 0 ? <span className="subtle">No extra context labels selected.</span> : (
        <ul className="what-will-be-sent-list" aria-label="What will be sent labels">
          {visibleSources.map((source) => (
            <li key={`${source.kind}:${source.label}`}>
              <span className={source.included ? "badge ok" : "badge warn"}>{source.included ? "included" : "omitted"}</span>
              <span>{sanitizeDisplayText(source.label)}: {source.included ? "included" : "omitted"} · {source.itemCount} item{source.itemCount === 1 ? "" : "s"} · {source.charCount} chars</span>
            </li>
          ))}
        </ul>
      )}
      {visibleLocalReviewMetadata.length > 0 && <ul className="what-will-be-sent-list" aria-label="Local review metadata not sent">{visibleLocalReviewMetadata.map((metadata) => (
        <li key={`${metadata.label}:${metadata.itemCount}:${metadata.charCount}`}>
          <span className="badge warn">not sent</span>
          <span>{sanitizeDisplayText(metadata.label)}: local review metadata only · not sent · {metadata.itemCount} item{metadata.itemCount === 1 ? "" : "s"} · {metadata.charCount} chars</span>
        </li>
      ))}</ul>}
      {visibleLabels.length > 0 && <ul className="what-will-be-sent-labels" aria-label="What will be sent item labels">{visibleLabels.map((label) => <li key={label}>{label}</li>)}</ul>}
      {summary.warnings.length > 0 && <ul className="first-message-steps">{summary.warnings.map((warning) => <li key={`${warning.code}:${warning.message}`}>{sanitizeDisplayText(warning.message)}</li>)}</ul>}
    </section>
  );
}

function CodingTaskSessionPanel({ session, goal, contextItems, modelStatus, canSendChat, latestResponseStatus, editProposal, verificationAttempt, verificationAttached, draftPrompt, contextBudgetSummary, modelProposalDraft, modelProposalResult, onGoalChange, onUseDraftPrompt, onUseDraftPlan, onDraftOneStepModelProposal, onFocusPrompt }: { session: CodingTaskSessionSnapshot; goal: string; contextItems: ExplicitContextBundleItem[]; memoryAttachedCount: number; modelStatus: string; canSendChat: boolean; latestResponseStatus: string; editProposal: EditProposalState | null; applyResult: ApplyResultState | null; verificationAttempt: IdeActionAttemptState | null; verificationAttached: boolean; draftPrompt: string; contextBudgetSummary: ContextBudgetSummary; modelProposalDraft: ModelProposalDraftState | null; modelProposalResult: AgentRunModelProposalResult; onGoalChange: (goal: string) => void; onUseDraftPrompt: (mode: CodingTaskPromptMode) => void; onUseDraftPlan: () => void; onDraftOneStepModelProposal: () => void; onFocusPrompt: () => void }) {
  const contextLabels = session.context.labels;
  const memoryLabels = session.memory.labels;
  const promptDrafted = draftPrompt.trim().length > 0;
  const goalReady = session.goal.present;
  const editProposalStatus = session.statuses.agentRunState === "idle" ? "none" : session.statuses.apply !== "not_requested" ? session.statuses.apply : session.statuses.proposal !== "not_detected" ? session.statuses.proposal : "none";
  const displaySessionStatus = session.statuses.agentRunState === "idle" ? "draft not started" : session.statuses.agentRunState;
  const displayVerificationStatus = session.statuses.verification.replace(/_/g, " ");
  const recoveryCopy = codingTaskRecoveryCopy(modelStatus, latestResponseStatus);
  const nextSafeStep = canSendChat && !goalReady ? "Write the task goal, choose a template, review any explicit context, then click Send yourself when ready." : canSendChat ? session.nextSafeManualStep : "Connect runtime and choose Demo Mode or a local/BYOK provider before sending; templates can still draft locally.";
  const modelProposalDiagnostics = modelProposalResult.diagnostics;
  const showContextBudgetSummary = goalReady || contextItems.length > 0 || contextBudgetSummary.sources.some((source) => source.kind === "active_file_excerpt") || contextBudgetSummary.omittedItemCount > 0 || contextBudgetSummary.excludedItemCount > 0 || contextBudgetSummary.warnings.length > 0;
  return (
    <section className={`coding-task-session-card readiness-card ${goalReady || contextItems.length > 0 || editProposal || verificationAttempt ? "ready" : "warn"} stack`} aria-label="Coding task session">
      <div className="row">
        <strong>Coding task session</strong>
        <span className="badge ok">local draft</span>
        <span className="badge">inert workflow</span>
      </div>
      <span className="subtle">Buttons only focus the prompt or write local draft text; they never auto-attach, send, apply, verify, save memory, call providers, read files, or write browser storage.</span>
      <span className="subtle">One-shot context is not browser-stored or auto-attached; selected explicit context clears only after an accepted Send and remains available if Send fails.</span>
      <label className="stack">
        Task goal (local React state only)
        <textarea value={goal} onChange={(event) => onGoalChange(event.target.value)} placeholder="Describe the coding task goal before choosing context and asking the model." />
      </label>
      <div className="agent-progress-grid" aria-label="Coding task session status">
        <span>Session: {displaySessionStatus}</span>
        <span>Goal: {session.goal.present ? session.goal.label : "not written"}</span>
        <span>Context selected: {session.context.selectedCount > 0 ? `${session.context.selectedCount} explicit item${session.context.selectedCount === 1 ? "" : "s"}` : "none"}</span>
        <span>Explicit context bundle: {session.context.selectedCount > 0 ? `${session.context.selectedCount} selected · one-shot manual include` : "empty · add context manually if needed"}</span>
        <span>Prompt drafted: {promptDrafted ? "ready" : "available"}</span>
        <span>Response lifecycle: {latestResponseStatus}</span>
        <span>Proposal lifecycle: {session.statuses.proposal}</span>
        <span>Apply lifecycle: {session.statuses.apply}</span>
        <span>Edit lifecycle: {editProposalStatus}</span>
        <span>Verification lifecycle: {displayVerificationStatus}{verificationAttached ? " · attached for follow-up" : " · draft or attach manually"}</span>
        {session.statuses.checkpointDecision !== "unavailable" && <span>Checkpoint decision: {session.statuses.checkpointDecision}</span>}
        {session.statuses.checkpointDecision !== "unavailable" && <span>Recommended checkpoint step: {session.statuses.checkpointRecommendedStep}</span>}
        <span>Provider/model readiness: {canSendChat ? `ready · ${modelStatus}` : `blocked · ${modelStatus}`}</span>
        <span>Memory attachments: {session.memory.count}</span>
        <span>Memory suggestions: suggested {session.memory.suggestionCounts.suggested} · stale {session.memory.suggestionCounts.stale} · unsafe {session.memory.suggestionCounts.unsafe} · already attached {session.memory.suggestionCounts.already_attached}</span>
      </div>
      <div className={`readiness-card ${canSendChat ? "ready" : "warn"}`} role="status" aria-label="Coding task next safe step">
        <strong>Next safe manual step</strong>
        <span>{nextSafeStep}</span>
      </div>
      <section className={`readiness-card ${modelProposalResult.proposalPathState === "proposal_detected" ? "ready" : "warn"} stack`} aria-label="One-step model proposal path">
        <div className="row">
          <strong>One-step model proposal</strong>
          <span className="badge">draft only</span>
          <span className={`badge ${modelProposalResult.proposalPathState === "proposal_detected" ? "ok" : "warn"}`}>{modelProposalResult.proposalPathState}</span>
        </div>
        <span className="subtle">Drafts a safe-edit prompt into the composer only. Send remains the only model/runtime call; apply and verification remain explicit future clicks.</span>
        <span>Goal summary: {session.goal.present ? session.goal.label : "No local goal selected"}</span>
        <span>Explicit bundle summary: {contextLabels.length === 0 ? "No explicit context selected" : `${session.context.selectedCount} selected item${session.context.selectedCount === 1 ? "" : "s"}`}</span>
        <span>Provider readiness: {sanitizeDisplayText(modelStatus)}</span>
        <span className="subtle">Agent Run apply requires valid proposal correlation plus verified checkpoint and policy-ready readiness metadata; apply and verification still require explicit clicks.</span>
        {modelProposalDraft && <span className="subtle">Latest drafted prompt: {modelProposalDraft.goalSummary} · {modelProposalDraft.contextSummary.length} context summary item{modelProposalDraft.contextSummary.length === 1 ? "" : "s"}</span>}
        {modelProposalDiagnostics.length > 0 && <div className="readiness-card warn" role="status" aria-label="One-step model proposal diagnostics">{modelProposalDiagnostics.map((diagnostic) => <span key={`${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}</div>}
        <button type="button" className="secondary-button" onClick={onDraftOneStepModelProposal}>Draft one-step safe-edit prompt</button>
      </section>
      {recoveryCopy && <div className="readiness-card warn" role="status"><strong>Prompt recovery</strong><span>{recoveryCopy}</span></div>}
      {(memoryLabels.length > 0 || session.memory.suggestionLabels.length > 0 || session.diagnostics.length > 0) && <section className="readiness-card ready stack" aria-label="Unified session metadata">
        <div className="row">
          <strong>Unified session metadata</strong>
          <span className="badge">{session.authority}</span>
          <span className="badge">execution allowed {String(session.executionAllowed)}</span>
        </div>
        {memoryLabels.length > 0 && <div className="stack"><strong>Memory metadata</strong><ul className="first-message-steps">{memoryLabels.map((label) => <li key={label}>{label}</li>)}</ul></div>}
        {session.memory.suggestionLabels.length > 0 && <div className="stack"><strong>Memory suggestion metadata</strong><ul className="first-message-steps">{session.memory.suggestionLabels.map((label) => <li key={label}>{label}</li>)}</ul></div>}
        {session.diagnostics.length > 0 && <div className="stack"><strong>Session diagnostics</strong><ul className="first-message-steps">{session.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></div>}
      </section>}
      {session.controlledFileRead.present && <section className="readiness-card ready stack" aria-label="Controlled file read session metadata">
        <div className="row">
          <strong>Controlled file read session metadata</strong>
          <span className="badge">bounded read evidence</span>
          <span className="badge">latest {sanitizeDisplayText(session.controlledFileRead.latestStatus)}</span>
        </div>
        <span className="subtle">Sanitized trace/session labels only. No raw file body, hidden read, search, bridge request, runtime command, provider call, or browser storage is created here.</span>
        <ul className="first-message-steps">{session.controlledFileRead.labels.map((label) => <li key={label}>{sanitizeDisplayText(label)}</li>)}</ul>
      </section>}
      {session.controlledCommandRun.present && <section className="readiness-card ready stack" aria-label="Controlled command session metadata">
        <div className="row">
          <strong>Controlled command session metadata</strong>
          <span className="badge">command-id evidence</span>
          <span className="badge">latest {sanitizeDisplayText(session.controlledCommandRun.latestStatus)}</span>
        </div>
        <span className="subtle">Sanitized trace/session labels only. No raw command string, cwd, env, shell, bridge request, runtime execution, provider call, file access, or browser storage is created here.</span>
        <ul className="first-message-steps">{session.controlledCommandRun.labels.map((label) => <li key={label}>{sanitizeDisplayText(label)}</li>)}</ul>
      </section>}
      {session.controlledRuntimeSession.present && <section className="readiness-card ready stack" aria-label="Controlled runtime session metadata">
        <div className="row">
          <strong>Controlled runtime session metadata</strong>
          <span className="badge">runtime evidence</span>
          <span className="badge">latest {sanitizeDisplayText(session.controlledRuntimeSession.latestStatus)}</span>
        </div>
        <span className="subtle">Sanitized trace/session labels only. No Start Agent button, bridge request, runtime call, provider call, file access, shell command, git action, tool execution, or browser storage is created here.</span>
        <ul className="first-message-steps">{session.controlledRuntimeSession.labels.map((label) => <li key={label}>{sanitizeDisplayText(label)}</li>)}</ul>
      </section>}
      <div className="stack">
        <strong>Task templates</strong>
        <span className="subtle">Choose a template to draft the chat prompt only. Send remains your explicit action.</span>
        <div className="coding-task-template-grid" role="group" aria-label="Coding task prompt templates">
          {codingTaskTemplates.map((template) => (
            <button type="button" className="secondary-button" key={template.mode} onClick={() => onUseDraftPrompt(template.mode)} title={template.detail}>Draft {template.label} prompt</button>
          ))}
        </div>
      </div>
      {showContextBudgetSummary && <section className={`readiness-card ${contextBudgetSummary.warnings.length === 0 ? "ready" : "warn"} stack`} aria-label="Context budget summary">
        <div className="row">
          <strong>Context budget summary</strong>
          <span className="badge">pre-Send</span>
          <span className={contextBudgetSummary.warnings.length === 0 ? "badge ok" : "badge warn"}>{contextBudgetSummary.warnings.length} warning{contextBudgetSummary.warnings.length === 1 ? "" : "s"}</span>
        </div>
        <span>Included: {contextBudgetSummary.totalIncludedItems} item{contextBudgetSummary.totalIncludedItems === 1 ? "" : "s"} · {contextBudgetSummary.totalIncludedCharacters} chars</span>
        <span>Omitted: {contextBudgetSummary.omittedItemCount} · Excluded: {contextBudgetSummary.excludedItemCount}</span>
        <span className="subtle">Pure local estimate using character counts and item counts only. Raw context bodies are not shown, persisted, logged, tokenized, or sent to a provider by this summary.</span>
        <div className="agent-progress-grid" aria-label="Context budget source counts">
          {contextBudgetSummary.sources.map((source) => <span key={`${source.kind}:${source.label}`}>{source.label}: {source.included ? "included" : "omitted"} · {source.itemCount} item{source.itemCount === 1 ? "" : "s"} · {source.charCount} chars</span>)}
          {contextBudgetSummary.localReviewMetadata.map((metadata) => <span key={`local-review:${metadata.label}`}>{metadata.label}: local review metadata only · not sent · {metadata.itemCount} item{metadata.itemCount === 1 ? "" : "s"} · {metadata.charCount} chars</span>)}
        </div>
        {contextBudgetSummary.warnings.length > 0 ? <ul className="first-message-steps">{contextBudgetSummary.warnings.map((warning) => <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>)}</ul> : <span className="subtle">No budget warnings for the selected context.</span>}
      </section>}
      <div className="stack">
        <strong>Explicit context bundle summary</strong>
        {contextLabels.length === 0 ? <span className="subtle">No explicit bundle items selected. Existing active-context controls remain below.</span> : <ul className="first-message-steps">{contextLabels.map((label) => <li key={label}>{label}</li>)}</ul>}
      </div>
      <div className="row" role="group" aria-label="Coding task next steps">
        <button type="button" className="secondary-button" onClick={onUseDraftPlan}>Copy plan prompt to manual draft</button>
        <button type="button" className="secondary-button" onClick={onFocusPrompt}>Focus chat prompt</button>
      </div>
    </section>
  );
}

function codingTaskSessionStatus(goal: string, contextCount: number, latestResponseStatus: string, editProposalStatus: string, verificationStatus: string): string {
  if (verificationStatus !== "not requested") {
    return "verification visible";
  }
  if (editProposalStatus !== "none") {
    return "safe edit proposal visible";
  }
  if (!latestResponseStatus.startsWith("Ready") && !latestResponseStatus.startsWith("Demo Mode ready") && latestResponseStatus !== "Configure a provider/model or enable Demo Mode before sending." && latestResponseStatus !== "Connect the local runtime before sending.") {
    return "model response in progress";
  }
  if (contextCount > 0) {
    return "context selected";
  }
  return goal.trim() ? "draft goal" : "draft not started";
}

function codingTaskNextSafeStep({ goalReady, contextCount, canSendChat, verificationStatus, editProposalStatus, latestResponseStatus }: { goalReady: boolean; contextCount: number; canSendChat: boolean; verificationStatus: string; editProposalStatus: string; latestResponseStatus: string }): string {
  if (verificationStatus !== "not requested") {
    return "Review visible verification output, then manually draft a follow-up or attach that result as one-shot context if needed.";
  }
  if (editProposalStatus !== "none") {
    return "Review the visible edit proposal or apply result; request apply or verification only from the explicit controls.";
  }
  if (!canSendChat) {
    return "Connect runtime and choose Demo Mode or a local/BYOK provider before sending; templates can still draft locally.";
  }
  if (!goalReady) {
    return "Write the task goal, choose a template, review any explicit context, then click Send yourself when ready.";
  }
  if (contextCount === 0) {
    return "Choose whether the goal needs explicit context; if yes, add it manually, otherwise draft a template and send yourself.";
  }
  if (!latestResponseStatus.startsWith("Ready") && !latestResponseStatus.startsWith("Demo Mode ready")) {
    return "Wait for the visible response lifecycle to settle before applying, verifying, or drafting a follow-up.";
  }
  return "Review the selected one-shot context, choose a task template, then click Send manually when the draft looks safe.";
}

function codingTaskRecoveryCopy(modelStatus: string, latestResponseStatus: string): string | null {
  const text = `${modelStatus} ${latestResponseStatus}`.toLowerCase();
  if (/context.*(too large|large|length|window)|too large|maximum context/.test(text)) {
    return "Context is too large. Remove low-value bundle items, keep only explicit summaries/snippets, and ask for a narrower answer before sending again.";
  }
  if (/rate|quota|429/.test(text)) {
    return "Provider rate limit or quota is visible. Wait, choose a smaller prompt, or switch to another ready local/BYOK model before sending.";
  }
  if (/timeout|timed out/.test(text)) {
    return "Provider timeout is visible. Narrow the prompt, reduce explicit context, verify provider reachability, then retry manually.";
  }
  if (/mismatch|model\/provider/.test(text)) {
    return "Model/provider mismatch is visible. Test the saved provider, fix the model id mapping locally, refresh runtime, then draft/send again.";
  }
  if (/runtime unavailable|provider required|provider or demo mode needed|blocked/.test(text)) {
    return "Provider is not ready. Refresh runtime or choose Demo Mode/local/BYOK provider first; drafts stay local until you explicitly send.";
  }
  return null;
}

function codingTaskContextLabel(item: ExplicitContextBundleItem): string {
  return summarizeExplicitContextBundleItem(item).line;
}

type ManualRunnerStepState = "done" | "current" | "waiting";

type ManualRunnerStep = {
  label: string;
  detail: string;
  state: ManualRunnerStepState;
};

function ManualRunnerPanel({ host, draftPlan, planProposal, hasContext, hasPrompt, hasAssistantActivity, hasEditProposal, applyResult, verificationAttempt, verificationAttached, canSendChat, onDraftPlanChange, onFocusPrompt }: { host: BridgeHost; draftPlan: string; planProposal: ManualRunnerPlanProposal | null; hasContext: boolean; hasPrompt: boolean; hasAssistantActivity: boolean; hasEditProposal: boolean; applyResult: ApplyResultState | null; verificationAttempt: IdeActionAttemptState | null; verificationAttached: boolean; canSendChat: boolean; onDraftPlanChange: (plan: string) => void; onFocusPrompt: () => void }) {
  const supported = host === "vscode" || host === "jetbrains";
  const applySettled = applyResult?.payload.status === "applied" || applyResult?.payload.status === "denied" || applyResult?.payload.status === "rejected" || applyResult?.payload.status === "failed";
  const applied = applyResult?.payload.status === "applied";
  const verified = verificationAttempt?.result?.action === "runVerificationCommand" && (verificationAttempt.result.status === "succeeded" || verificationAttempt.result.status === "failed");
  const steps: ManualRunnerStep[] = [
    { label: "1. Goal", detail: draftPlan.trim() ? "Goal and local draft plan are written in this panel." : "Write the goal or plan here; it stays in React state only.", state: draftPlan.trim() ? "done" : "current" },
    { label: "2. Context selected", detail: hasContext ? "Context is selected for your next explicit Send." : "Use active file, multi-file bundle, memory, or project snippets below when needed.", state: hasContext ? "done" : draftPlan.trim() ? "current" : "waiting" },
    { label: "3. Prompt drafted", detail: hasAssistantActivity ? "Prompt was sent manually and chat activity exists." : hasPrompt ? "Prompt is drafted; click Send when ready." : "Draft or focus the chat box; nothing is sent by this panel.", state: hasAssistantActivity ? "done" : hasPrompt || hasContext ? "current" : "waiting" },
    { label: "4. Response received", detail: hasAssistantActivity ? "A response or stream state is visible in chat." : "Wait for the manual Send and assistant response.", state: hasAssistantActivity ? "done" : hasPrompt ? "current" : "waiting" },
    { label: "5. Edit proposed/applied", detail: applied ? "Host reported edits applied after confirmation." : applySettled ? "Host returned an apply result; review it before continuing." : hasEditProposal ? "Review the latest proposal card before applying." : "No edit is proposed or applied automatically.", state: applied ? "done" : applySettled ? "done" : hasEditProposal ? "current" : "waiting" },
    { label: "6. Verification", detail: verified ? "Verification result is visible in the verification panel." : "Click one allowlisted verification command when ready.", state: verified ? "done" : applied ? "current" : "waiting" },
    { label: "7. Follow-up", detail: verificationAttached ? "Verification output is attached as explicit one-shot context." : verified ? "Attach the result or draft a follow-up prompt." : "No verification output or follow-up is attached automatically.", state: verificationAttached ? "done" : verified ? "current" : "waiting" },
  ];
  const currentStep = [...steps].reverse().find((step) => step.state === "current") ?? steps[steps.length - 1];
  const useProposalAsDraft = () => {
    if (!planProposal) {
      return;
    }
    onDraftPlanChange(formatManualRunnerPlanProposalDraft(planProposal));
  };
  return (
    <section className={`manual-runner-card readiness-card ${currentStep.state === "waiting" ? "warn" : "ready"}`} aria-label="Manual runner coding loop">
      <div className="row">
        <strong>Manual runner · Coding loop</strong>
        <span className={`badge ${supported ? "ok" : "warn"}`}>{supported ? `${host} explicit controls` : "browser preview only"}</span>
        <span className="badge">manual only</span>
      </div>
      <span className="subtle">Progress guide only. It never auto-sends, auto-attaches context, auto-applies edits, auto-runs verification, reads hidden files, or writes browser storage.</span>
      {!supported && <span className="subtle">Browser preview can draft and chat with the runtime, but IDE context, apply, and verification buttons stay preview/manual until an IDE host is available.</span>}
      <label className="stack manual-runner-plan">
        Draft plan (local UI state only)
        <textarea value={draftPlan} onChange={(event) => onDraftPlanChange(event.target.value)} placeholder="Example: inspect context, ask model, review proposal, apply only after confirmation, run verification." />
      </label>
      {planProposal && <ManualRunnerPlanProposalCard proposal={planProposal} onUseAsDraft={useProposalAsDraft} onFocusPrompt={onFocusPrompt} />}
      <div className="manual-runner-current" role="status">
        <strong>Current manual lifecycle step: {currentStep.label}</strong>
        <span>{currentStep.detail}</span>
      </div>
      <ol className="manual-runner-steps" aria-label="Manual coding loop steps">
        {steps.map((step) => (
          <li className={`manual-runner-step ${step.state}`} key={step.label}>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" className="secondary-button" onClick={onFocusPrompt} disabled={!canSendChat}>Focus chat prompt</button>
        {!canSendChat && <span className="subtle">Connect runtime and choose Demo Mode or a BYOK provider before Send is available.</span>}
      </div>
    </section>
  );
}

function ManualRunnerPlanProposalCard({ proposal, onUseAsDraft, onFocusPrompt }: { proposal: ManualRunnerPlanProposal; onUseAsDraft: () => void; onFocusPrompt: () => void }) {
  return (
    <section className="readiness-card ready manual-runner-proposal-card stack" aria-label="Manual runner plan proposal review">
      <div className="row">
        <strong>Plan proposal · Review only</strong>
        <span className="badge ok">inert</span>
        <span className="badge">display only</span>
      </div>
      <h3>{proposal.title}</h3>
      <span>{proposal.rationale}</span>
      <ol className="manual-runner-steps" aria-label="Proposed manual runner steps">
        {proposal.steps.map((step, index) => <li className="manual-runner-step waiting" key={`${index}:${step}`}>{step}</li>)}
      </ol>
      <span>Suggested next user step: {proposal.nextAction}</span>
      <span className="subtle">This proposal is inert. It cannot attach context, send chat, apply edits, run verification, call providers, execute tools, or mutate the workspace. Tiny velvet rope, surprisingly effective.</span>
      <div className="row">
        <button type="button" className="secondary-button" onClick={onUseAsDraft}>Use proposal as local draft</button>
        <button type="button" className="secondary-button" onClick={onFocusPrompt}>Focus chat prompt</button>
      </div>
    </section>
  );
}

function formatManualRunnerPlanProposalDraft(proposal: ManualRunnerPlanProposal): string {
  return [
    proposal.title,
    ...proposal.steps.map((step, index) => `${index + 1}. ${step}`),
    `Rationale: ${proposal.rationale}`,
    `Next user step: ${proposal.nextAction}`,
  ].join("\n");
}

function ActiveFileExcerptAttachPanel({ host, excerpt, include, pending, status, promptAction, canAddToBundle, onRequest, onClearPending, onIncludeChange, onApplyPrompt, onAddToBundle }: { host: BridgeHost; excerpt: ActiveFileExcerptAttachment | null; include: boolean; pending: boolean; status: string | null; promptAction: ActiveFilePromptAction | null; canAddToBundle: boolean; onRequest: () => void; onClearPending: () => void; onIncludeChange: (include: boolean) => void; onApplyPrompt: (action: ActiveFilePromptAction) => void; onAddToBundle: () => void }) {
  const supported = host === "vscode" || host === "jetbrains";
  if (!supported) {
    return (
      <section className="readiness-card warn active-file-excerpt-card" role="status" aria-label="Active file excerpt">
        <div className="row">
          <strong>Active file excerpt</strong>
          <span className="badge warn">IDE host required</span>
        </div>
        <span className="subtle">Standalone browser cannot read your editor, attach active files, search snippets, apply edits, or run IDE verification. Use VS Code/JetBrains for excerpts; include only chosen prompt text.</span>
      </section>
    );
  }
  const preview = excerpt ? activeFileExcerptPreview(excerpt) : null;
  return (
    <section className={`readiness-card ${excerpt ? "ready" : "warn"} active-file-excerpt-card stack`} role="status" aria-label="Active file excerpt">
      <div className="row">
        <strong>Active file excerpt</strong>
        <span className="badge ok">{activeEditorSourceLabel(host)}</span>
        <button type="button" onClick={onRequest} disabled={pending}>{pending ? "Active file excerpt pending…" : "Attach active file excerpt"}</button>
        {pending && <button type="button" className="secondary-button" onClick={onClearPending}>Clear pending active-file excerpt</button>}
      </div>
      {preview ? (
        <div className="stack">
          <div className="attached-context-grid">
            <span>File: {preview.fileLabel}</span>
            <span>Language: {preview.language}</span>
            <span>Excerpt range: {preview.range}</span>
            <span>Excerpt characters: {preview.characters}</span>
            <span>Host truncated: {preview.hostTruncated ? "yes" : "no"}</span>
          </div>
          <div className="attached-context-preview">
            <strong>Bounded redacted preview</strong>
            <pre>{preview.text}</pre>
          </div>
          {(preview.redacted || preview.truncated || preview.hostTruncated) && <span className="subtle">Preview metadata: {preview.redacted ? "redacted" : "not redacted"}, {preview.truncated ? "preview shortened" : "preview complete"}, {preview.hostTruncated ? "host truncated" : "host complete"}.</span>}
          <label className="row attached-context-toggle">
            <input style={{ width: "auto" }} type="checkbox" checked={include} onChange={(event) => onIncludeChange(event.target.checked)} />
            {include ? "Attach excerpt to next message" : "Omit excerpt from next message"}
          </label>
          <div className="row" role="group" aria-label="Explicit context bundle actions">
            <button type="button" onClick={onAddToBundle} disabled={!canAddToBundle}>{canAddToBundle ? "Add to multi-file context bundle" : `Bundle full (${explicitContextBundleMaxItems} max)`}</button>
          </div>
          <span className="subtle">Bundle items are explicit one-shot prompt context only. They are not indexed, not auto-attached by the assistant, and not stored in browser storage.</span>
          {promptAction && <div className="active-file-prompt-cta stack" role="group" aria-label="Active-file coding prompt">
            <strong>Real-provider active-file chat path</strong>
            <span className="subtle">Use this after provider readiness says OpenAI-compatible BYOK is ready. It fills the prompt with the bounded excerpt, keeps it one-shot attached, and still waits for your explicit Send.</span>
            <button type="button" onClick={() => onApplyPrompt(promptAction)}>{promptAction.label}</button>
          </div>}
          <span className="subtle">Excerpt stays in React state only, is prompt-only, and clears after the next accepted message.</span>
        </div>
      ) : (
        <span className="subtle">Click once to request a bounded excerpt from the visible active editor. No request is made automatically.</span>
      )}
      {status && <span className="subtle">{sanitizeDisplayText(status)}</span>}
    </section>
  );
}

function WorkspaceSnippetSearchPanel({ host, query, validation, result, selectedKeys, pending, status, canAddToBundle, onQueryChange, onSearch, onClearPending, onSelectionChange, onAttachSelected }: { host: BridgeHost; query: string; validation: ReturnType<typeof validateWorkspaceSnippetQuery>; result: WorkspaceSnippetSearchResultPayload | null; selectedKeys: string[]; pending: boolean; status: string | null; canAddToBundle: boolean; onQueryChange: (query: string) => void; onSearch: () => void; onClearPending: () => void; onSelectionChange: (keys: string[]) => void; onAttachSelected: () => void }) {
  const supported = host === "vscode" || host === "jetbrains";
  const selectedSet = new Set(selectedKeys);
  const searchDisabled = !supported || pending || !validation.valid;
  const toggleSnippet = (key: string, selected: boolean) => {
    onSelectionChange(selected ? [...selectedKeys, key] : selectedKeys.filter((item) => item !== key));
  };
  return (
    <section className={`readiness-card ${result ? "ready" : "warn"} workspace-snippet-search-card stack`} role="status" aria-label="Project snippet search">
      <div className="row">
        <strong>Project snippets</strong>
        <span className={`badge ${supported ? "ok" : "warn"}`}>{supported ? "IDE search" : "browser preview only"}</span>
        <span className={`badge ${validation.valid ? "ok" : "warn"}`}>{validation.valid ? "literal query ready" : "query needs review"}</span>
        {selectedKeys.length > 0 && <span className="badge ok">{selectedKeys.length} selected</span>}
      </div>
      <div className="form-grid">
        <label>
          Literal snippet query
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="function name or symbol text" autoComplete="off" aria-describedby="workspace-snippet-query-help" />
        </label>
      </div>
      <span id="workspace-snippet-query-help" className="subtle">{sanitizeDisplayText(validation.message)}</span>
      <div className="row">
        <button type="button" onClick={onSearch} disabled={searchDisabled}>{pending ? "Project snippet search pending…" : "Search project snippets"}</button>
        {pending && <button type="button" className="secondary-button" onClick={onClearPending}>Clear pending project snippet search</button>}
      </div>
      <span className="subtle">Explicit click only; no auto-search, indexing, regex/glob, shell, provider, background reads, or browser storage.</span>
      {!supported && <span className="subtle">Open {productName} in VS Code or JetBrains to request sanitized local workspace snippets.</span>}
      {result && (
        <div className="stack">
          <div className="row">
            <span className="badge ok">{result.resultCount} result{result.resultCount === 1 ? "" : "s"}</span>
            <span className={selectedKeys.length > 0 ? "badge ok" : "badge warn"}>{selectedKeys.length} selected for attach</span>
            <span className="subtle">Query: {sanitizeDisplayText(result.queryLabel)} · truncated {result.truncated ? "yes" : "no"}</span>
          </div>
          {result.snippets.length === 0 ? <span className="subtle">No sanitized snippets returned for this query.</span> : result.snippets.map((snippet, index) => {
            const item = workspaceSnippetToBundleItem(snippet);
            const preview = classifyBoundedContextPreview(snippet.text);
            return (
              <label className="provider-item stack" key={item.key}>
                <span className="row">
                  <input style={{ width: "auto" }} type="checkbox" checked={selectedSet.has(item.key)} onChange={(event) => toggleSnippet(item.key, event.target.checked)} />
                  <strong>{index + 1}. {sanitizeDisplayText(snippet.workspaceRelativePath)}</strong>
                  <span className="badge ok">{sanitizeDisplayText(snippet.languageId)}</span>
                  {selectedSet.has(item.key) && <span className="badge ok">selected</span>}
                </span>
                <span className="subtle">Range {formatSelectionRange({ startLine: snippet.range.start.line, startCharacter: snippet.range.start.character, endLine: snippet.range.end.line, endCharacter: snippet.range.end.character })} · {snippet.text.length} chars</span>
                <div className="attached-context-preview"><pre>{preview.text}</pre></div>
              </label>
            );
          })}
          <div className="row">
            <button type="button" onClick={onAttachSelected} disabled={!canAddToBundle || selectedKeys.length === 0}>{canAddToBundle ? `Attach selected snippets (${selectedKeys.length})` : `Bundle full (${explicitContextBundleMaxItems} max)`}</button>
            <span className="subtle">Attached snippets appear in the one-shot bundle below. Use Remove snippet there to detach before Send.</span>
          </div>
        </div>
      )}
      {status && <span className="subtle">{sanitizeDisplayText(status)}</span>}
    </section>
  );
}

function ProjectMemoryPanel({ notes, state, error, title, text, tags, query, status, attachedCount, attachedNoteIds, canAddToBundle, taskGoal, chatId, onTitleChange, onTextChange, onTagsChange, onQueryChange, onCreate, onSearch, onRefresh, onAttach, onDetach, onDelete }: { notes: ProjectMemoryNote[]; state: ProjectMemoryState["state"]; error: RuntimeError | null; title: string; text: string; tags: string; query: string; status: string | null; attachedCount: number; attachedNoteIds: Set<string>; canAddToBundle: boolean; taskGoal: string; chatId: string; onTitleChange: (value: string) => void; onTextChange: (value: string) => void; onTagsChange: (value: string) => void; onQueryChange: (value: string) => void; onCreate: () => void; onSearch: () => void; onRefresh: () => void; onAttach: (note: ProjectMemoryNote) => void; onDetach: (noteId: string, title: string) => void; onDelete: (note: ProjectMemoryNote) => void }) {
  const busy = state === "loading" || state === "saving" || state === "searching" || state === "deleting";
  const stateLabel = state === "idle" ? "ready" : state;
  const emptyCopy = query.trim() ? "No local memory notes matched this search. Try a narrower literal query or list all memory again." : "No local memory notes are listed. Create one manually or refresh from the engine-owned local store.";
  const busyCopy = state === "loading"
    ? "Loading memory notes from the engine-owned local store…"
    : state === "saving"
      ? "Saving a manual local memory note…"
      : state === "searching"
        ? "Searching engine-owned local memory…"
        : state === "deleting"
          ? "Deleting a selected local memory note…"
          : null;
  return (
    <section className={`readiness-card ${notes.length > 0 || attachedCount > 0 ? "ready" : "warn"} project-memory-card stack`} role="status" aria-label="Local project memory">
      <div className="row">
        <strong>Local project memory</strong>
        <span className="badge ok">engine-owned</span>
        <span className={`badge ${busy ? "warn" : "ok"}`}>{stateLabel}</span>
        <span className="badge">{attachedCount} attached</span>
      </div>
      <span className="subtle">Manual bounded notes only. The GUI does not write notes to browser storage, auto-save model output, auto-attach memory, scan the workspace, or expose raw secrets. Task-linked Attach is explicit one-shot prompt context with a trace label and clears after accepted Send.</span>
      <div className="form-grid">
        <label>
          Memory title
          <input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Short note title" autoComplete="off" />
        </label>
        <label>
          Tags (comma separated)
          <input value={tags} onChange={(event) => onTagsChange(event.target.value)} placeholder="architecture, decision" autoComplete="off" />
        </label>
      </div>
      <label className="stack">
        Memory note text
        <textarea value={text} onChange={(event) => onTextChange(event.target.value)} placeholder="Manual local note. Do not paste secrets, raw provider responses, private paths, or file bodies." />
      </label>
      <div className="row">
        <button type="button" onClick={onCreate} disabled={busy || !title.trim() || !text.trim()}>{state === "saving" ? "Saving memory…" : "Create memory note"}</button>
        <button type="button" className="secondary-button" onClick={onRefresh} disabled={busy}>{state === "loading" ? "Loading memory…" : "Refresh memory"}</button>
      </div>
      <div className="form-grid">
        <label>
          Search local memory
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Literal memory query" autoComplete="off" />
        </label>
      </div>
      <div className="row">
        <button type="button" onClick={onSearch} disabled={busy}>{state === "searching" ? "Searching memory…" : query.trim() ? "Search memory" : "List memory"}</button>
      </div>
      {busyCopy && <div className="readiness-card warn" role="status"><strong>{busyCopy}</strong><span>Memory curation stays local and manual while this request finishes.</span></div>}
      {error && <div className="readiness-card warn" role="alert"><strong>Project memory request failed</strong><ErrorBox error={error} /><span className="subtle">No memory was attached automatically. Check the local runtime, then refresh or retry manually.</span></div>}
      {status && <span className="subtle">{sanitizeDisplayText(status)}</span>}
      {notes.length === 0 ? <div className="readiness-card warn" role="status"><strong>{state === "error" ? "Memory list unavailable" : "No memory notes listed"}</strong><span>{emptyCopy}</span></div> : notes.map((note) => {
        const preview = classifyBoundedContextPreview(note.text);
        const attached = attachedNoteIds.has(note.id);
        const sourceLabel = sanitizeDisplayText(note.source || "manual");
        const taskLabel = createTaskMemoryLabel(note.taskLabel, taskGoal);
        const sessionLabel = createSessionMemoryLabel(note.sessionLabel, chatId);
        const safeTags = note.tags.map((tag) => sanitizeDisplayText(tag));
        return (
          <div className={`provider-item stack ${attached ? "ready" : ""}`} key={note.id}>
            <div className="row">
              <strong>{sanitizeDisplayText(note.title)}</strong>
              <span className="badge ok">source {sourceLabel}</span>
              {attached && <span className="badge ok">task-linked attached to next message</span>}
              {safeTags.length === 0 ? <span className="badge">no tags</span> : safeTags.map((tag) => <span className="badge" key={tag}>{tag}</span>)}
            </div>
            <span className="subtle">Updated {sanitizeDisplayText(note.updatedAt)} · {note.text.length} chars · tags {safeTags.join(", ") || "none"}</span>
            <span className="subtle">Task link: {taskLabel} · Session: {sessionLabel} · Attach trace minted only after explicit click.</span>
            <div className="attached-context-preview"><strong>Sanitized bounded preview</strong><pre>{preview.text}</pre></div>
            {(preview.redacted || preview.truncated) && <span className="subtle">Preview metadata: {preview.redacted ? "redacted" : "not redacted"}, {preview.truncated ? "preview shortened" : "preview complete"}.</span>}
            <div className="row">
              {attached ? <button type="button" className="secondary-button" onClick={() => onDetach(note.id, note.title)}>Detach memory from next message</button> : <button type="button" onClick={() => onAttach(note)} disabled={!canAddToBundle}>{canAddToBundle ? "Attach task-linked memory to next message" : `Bundle full (${explicitContextBundleMaxItems} max)`}</button>}
              <button type="button" className="danger-button" onClick={() => onDelete(note)} disabled={busy}>Delete memory</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
function ExplicitContextBundlePanel({ items, include, status, onIncludeChange, onRemove, onClear }: { items: ExplicitContextBundleItem[]; include: boolean; status: string | null; onIncludeChange: (include: boolean) => void; onRemove: (key: string) => void; onClear: () => void }) {
  if (items.length === 0) {
    return (
      <section className="readiness-card warn explicit-context-bundle-card" role="status" aria-label="Multi-file context bundle">
        <div className="row">
          <strong>Multi-file context bundle</strong>
          <span className="badge warn">empty</span>
        </div>
        <span className="subtle">Add explicitly reviewed active-file excerpts here. Bundle context is one-shot prompt context, not indexed, not stored, and never attached by the assistant.</span>
        {status && <span className="subtle">{sanitizeDisplayText(status)}</span>}
      </section>
    );
  }
  return (
    <section className="readiness-card ready explicit-context-bundle-card stack" role="status" aria-label="Multi-file context bundle">
      <div className="row">
        <strong>Multi-file context bundle</strong>
        <span className="badge ok">{items.length}/{explicitContextBundleMaxItems} excerpts</span>
        <button type="button" className="secondary-button" onClick={onClear}>Clear bundle</button>
      </div>
      <span className="subtle">Explicit one-shot prompt context only. Not indexed, not persisted to browser storage, and cleared after the next accepted send.</span>
      <label className="row attached-context-toggle">
        <input style={{ width: "auto" }} type="checkbox" checked={include} onChange={(event) => onIncludeChange(event.target.checked)} />
        {include ? "Include bundle with next message" : "Omit bundle from next message"}
      </label>
      <div className="stack">
        {items.map((item, index) => {
          if (isVerificationOutputBundleItem(item)) {
            const preview = classifyBoundedContextPreview(item.outputTail);
            return (
              <div className="provider-item stack" key={item.key}>
                <div className="row">
                  <strong>{index + 1}. Verification output</strong>
                  <span className="badge ok">{sanitizeDisplayText(item.commandId)}</span>
                  <button type="button" className="secondary-button" onClick={() => onRemove(item.key)}>Remove item</button>
                </div>
                <span className="subtle">Status {sanitizeDisplayText(item.status)} · exit code {item.exitCode} · truncated {item.truncated ? "yes" : "no"}</span>
                <div className="attached-context-preview"><pre>{preview.text}</pre></div>
              </div>
            );
          }
          if (isWorkspaceSnippetBundleItem(item)) {
            const preview = classifyBoundedContextPreview(item.text);
            return (
              <div className="provider-item stack" key={item.key}>
                <div className="row">
                  <strong>{index + 1}. Project snippet</strong>
                  <span className="badge ok">{sanitizeDisplayText(item.workspaceRelativePath)}</span>
                  <button type="button" className="secondary-button" onClick={() => onRemove(item.key)}>Remove snippet</button>
                </div>
                <span className="subtle">Language {sanitizeDisplayText(item.languageId)} · range {formatSelectionRange({ startLine: item.range.start.line, startCharacter: item.range.start.character, endLine: item.range.end.line, endCharacter: item.range.end.character })} · {item.text.length} chars</span>
                <div className="attached-context-preview"><pre>{preview.text}</pre></div>
              </div>
            );
          }
          if (isProjectMemoryBundleItem(item)) {
            const preview = classifyBoundedContextPreview(item.text);
            return (
              <div className="provider-item stack" key={item.key}>
                <div className="row">
                  <strong>{index + 1}. Project memory</strong>
                  <span className="badge ok">{sanitizeDisplayText(item.title)}</span>
                  <button type="button" className="secondary-button" onClick={() => onRemove(item.key)}>Remove memory</button>
                </div>
                <span className="subtle">Tags {item.tags.map((tag) => sanitizeDisplayText(tag)).join(", ") || "none"} · {item.text.length} chars</span>
                <div className="attached-context-preview"><pre>{preview.text}</pre></div>
              </div>
            );
          }
          const fileLabel = sanitizeDisplayText(item.file?.workspaceRelativePath ?? item.file?.displayPath ?? "active editor");
          const range = formatSelectionRange(item.selection);
          const preview = classifyBoundedContextPreview(item.selection?.text ?? "");
          return (
            <div className="provider-item stack" key={item.key}>
              <div className="row">
                <strong>{index + 1}. {fileLabel}</strong>
                <span className="badge ok">{activeEditorSourceLabel(item.source)}</span>
                <button type="button" className="secondary-button" onClick={() => onRemove(item.key)}>Remove excerpt</button>
              </div>
              <span className="subtle">Range {range} · {item.selection?.text?.length ?? 0} chars</span>
              <div className="attached-context-preview"><pre>{preview.text}</pre></div>
            </div>
          );
        })}
      </div>
      {items.length >= explicitContextBundleMaxItems && <span className="subtle">Bundle limit reached. Remove an item before adding another; max {explicitContextBundleMaxItems} excerpts.</span>}
      {status && <span className="subtle">{sanitizeDisplayText(status)}</span>}
    </section>
  );
}

function AttachedContextPreview({ context, include, acknowledged, status, onIncludeChange, onAcknowledgeChange }: { context: HostContextSnapshotPayload | null; include: boolean; acknowledged: boolean; status: string | null; onIncludeChange: (include: boolean) => void; onAcknowledgeChange: (acknowledged: boolean) => void }) {
  if (!context || !hasUsableAttachedContext(context)) {
    return (
      <details className="readiness-card warn compact-safety-details attached-context-compact" data-testid="attached-context-compact-details" role="status">
        <summary>
          <span className="compact-summary-title">📎 Attached context</span>
          <span className="badge warn">not attached</span>
          {status && <span className="compact-summary-note">{sanitizeDisplayText(status)}</span>}
        </summary>
        <div className="stack compact-details-body">
          <span className="subtle">No valid active editor context is attached. Nothing will be included with the next message.</span>
        </div>
      </details>
    );
  }
  const fileLabel = attachedContextFileLabel(context);
  const language = context.file?.languageId ? sanitizeDisplayText(context.file.languageId) : "unknown language";
  const range = formatSelectionRange(context.selection);
  const text = context.selection?.text ?? "";
  const preview = classifyBoundedContextPreview(text);
  const requiresAcknowledgement = preview.redacted || preview.truncated;
  const canAttach = !requiresAcknowledgement || acknowledged;
  return (
    <details className="readiness-card ready compact-safety-details attached-context-card attached-context-compact" data-testid="attached-context-active-details" role="status">
      <summary>
        <span className="compact-summary-title">Active editor context</span>
        <span className="badge ok">{activeEditorSourceLabel(context.source)}</span>
        <span className={include && canAttach ? "badge ok" : "badge warn"}>{include && canAttach ? "Attach to next message" : "Do not attach"}</span>
        <span className="compact-summary-note">{fileLabel} · {range} · {text.length} chars</span>
      </summary>
      <div className="stack compact-details-body">
        <div className="attached-context-grid">
          <span>Source host: {activeEditorSourceLabel(context.source)}</span>
          <span>File: {fileLabel}</span>
          <span>Language: {language}</span>
          <span>Selection range: {range}</span>
          <span>Selected characters: {text.length}</span>
        </div>
        <div className="attached-context-preview">
          <strong>Bounded preview</strong>
          <pre>{preview.text}</pre>
        </div>
        {requiresAcknowledgement && <div className="readiness-card warn" role="alert"><strong>Context preview requires acknowledgement</strong><span>Selected text preview was {preview.redacted && preview.truncated ? "redacted and shortened" : preview.redacted ? "redacted" : "shortened"}. Raw selected text will not be attached unless you acknowledge this warning and enable attachment.</span></div>}
        <span className="subtle">Context stays in React state only. It is one-shot and is attached only to the next accepted message while enabled.</span>
      </div>
      {requiresAcknowledgement && <label className="row attached-context-toggle">
        <input style={{ width: "auto" }} type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledgeChange(event.target.checked)} />
        I understand the hidden selected text may be included
      </label>}
      <label className="row attached-context-toggle">
        <input style={{ width: "auto" }} type="checkbox" checked={include} disabled={requiresAcknowledgement && !acknowledged} onChange={(event) => onIncludeChange(event.target.checked)} />
        {include && canAttach ? "Attach to next message" : "Do not attach"}
      </label>
    </details>
  );
}

function CodingActionsPanel({ canUseContext, context, onAction }: { canUseContext: boolean; context: HostContextSnapshotPayload | null; onAction: (action: CodingAction) => void }) {
  const hasContext = Boolean(context && hasUsableAttachedContext(context));
  return (
    <section className={`readiness-card ${canUseContext ? "ready" : "warn"} coding-actions-card`} aria-label="Coding Actions">
      <div className="stack">
        <div className="row">
          <strong>Coding Actions</strong>
          <span className={`badge ${canUseContext ? "ok" : "warn"}`}>{canUseContext ? "attached context ready" : "needs attached context"}</span>
        </div>
        <div className="coding-actions-row">
          {codingActions.map((action) => <button type="button" key={action.id} disabled={!canUseContext} title={action.description} onClick={() => onAction(action)}>{action.label}</button>)}
        </div>
        <span className="subtle">{canUseContext ? "Actions only fill the prompt and enable the one-shot attached-context toggle. They never auto-send, read hidden files, write browser storage, or apply edits." : hasContext ? "Acknowledge the attached-context warning before using coding actions. Nothing will be included until you opt in." : "Attach active editor context first. Coding actions stay disabled until there is usable selected code or file context."}</span>
        <span className="subtle"><strong>Safe edit:</strong> nothing is applied automatically; proposals require explicit review before any workspace edit can be requested.</span>
      </div>
    </section>
  );
}

function AgentProgressPanel({ progress }: { progress: AgentProgressState }) {
  if (progress.state === "not_checked") {
    return <AgentProgressStatusCard tone="idle" title="Agent progress not checked" detail="Refresh to read the local runtime agent-progress source. No agents are started from this panel." />;
  }
  if (progress.state === "loading") {
    return <AgentProgressStatusCard tone="loading" title="Loading agent progress" detail="Reading the local runtime progress endpoint…" />;
  }
  if (progress.state === "error" && progress.error) {
    return <AgentProgressStatusCard tone="error" title="Agent progress unavailable" detail={`The local progress source is unavailable, corrupt, oversized, or unsafe. Runtime ${progress.error.status}: ${sanitizeDisplayText(progress.error.message)}`} />;
  }
  const normalized = normalizeAgentProgressResponse(progress.response);
  const snapshots = normalized.snapshots;
  if (snapshots.length === 0) {
    return <AgentProgressStatusCard tone="empty" title="No local agent runs" detail="The local progress source is reachable but currently has no runs to display." generatedAt={normalized.generatedAt} />;
  }
  const visibleSnapshots = snapshots.slice(0, agentProgressSnapshotDisplayLimit);
  const hiddenSnapshotCount = Math.max(0, snapshots.length - visibleSnapshots.length);
  return (
    <div className="agent-progress-list">
      <AgentProgressStatusCard tone="ready" title="Populated local progress" detail={`${snapshots.length} local agent run${snapshots.length === 1 ? "" : "s"} returned by the read-only runtime endpoint.`} generatedAt={normalized.generatedAt} />
      {visibleSnapshots.map((snapshot) => <AgentProgressSnapshotCard key={`${snapshot.cardId}:${snapshot.runId}`} snapshot={snapshot} />)}
      {hiddenSnapshotCount > 0 && <div className="agent-progress-empty" role="status">{hiddenSnapshotCount} more agent run{hiddenSnapshotCount === 1 ? "" : "s"} hidden.</div>}
    </div>
  );
}

function normalizeAgentProgressResponse(response: AgentProgressListResponse | null): { generatedAt: string | null; snapshots: AgentProgressSnapshot[] } {
  const source = asRecord(response);
  const generatedAt = stringOrNull(source?.generatedAt);
  const rawSnapshots = Array.isArray(source?.snapshots) ? source.snapshots : [];
  return {
    generatedAt: generatedAt ? sanitizeDisplayText(generatedAt) : null,
    snapshots: rawSnapshots.map((snapshot, index) => normalizeAgentProgressSnapshot(snapshot, index)),
  };
}

function normalizeAgentProgressSnapshot(value: unknown, index: number): AgentProgressSnapshot {
  const source = asRecord(value);
  const cardId = stringOrNull(source?.cardId) ?? `unknown-card-${index + 1}`;
  const runId = stringOrNull(source?.runId) ?? `unknown-run-${index + 1}`;
  const phase = agentProgressPhaseOrDefault(source?.phase);
  const status = agentProgressStatusOrDefault(source?.status);
  const currentTool = normalizeAgentProgressTool(source?.currentTool);
  const recentEvents = Array.isArray(source?.recentEvents) ? source.recentEvents.map((event, eventIndex) => normalizeAgentProgressEvent(event, eventIndex)) : [];
  const overflowRecovery = normalizeAgentOverflowRecovery(source?.overflowRecovery);
  const planProposal = normalizeManualRunnerPlanProposal(source?.planProposal);
  return {
    protocolVersion: "2026-05-29",
    runId,
    cardId,
    startedAt: stringOrNull(source?.startedAt) ?? "unknown",
    updatedAt: stringOrNull(source?.updatedAt) ?? "unknown",
    completedAt: stringOrNull(source?.completedAt) ?? undefined,
    phase,
    status,
    message: stringOrNull(source?.message) ?? "No progress message reported.",
    elapsedMs: numberOrUnknown(source?.elapsedMs),
    ageMs: numberOrUnknown(source?.ageMs),
    lastHeartbeatAt: stringOrNull(source?.lastHeartbeatAt) ?? undefined,
    heartbeatAgeMs: numberOrUndefined(source?.heartbeatAgeMs),
    lastToolOutputAt: stringOrNull(source?.lastToolOutputAt) ?? undefined,
    toolOutputAgeMs: numberOrUndefined(source?.toolOutputAgeMs),
    currentTool,
    outputTail: stringOrNull(source?.outputTail) ?? undefined,
    overflowRecovery,
    planProposal,
    stuckReason: agentProgressStuckReasonOrDefault(source?.stuckReason),
    recentEvents,
  };
}

function latestManualRunnerPlanProposal(response: AgentProgressListResponse | null): ManualRunnerPlanProposal | null {
  const snapshot = normalizeAgentProgressResponse(response).snapshots.find((item) => item.planProposal);
  return snapshot?.planProposal ?? null;
}

function normalizeManualRunnerPlanProposal(value: unknown): ManualRunnerPlanProposal | undefined {
  const source = asRecord(value);
  if (!source || source.protocolVersion !== "2026-05-29" || source.kind !== "manual_runner_plan_proposal") {
    return undefined;
  }
  const title = safeManualRunnerPlanText(source.title, 80);
  const rationale = safeManualRunnerPlanText(source.rationale, 280);
  const nextAction = safeManualRunnerPlanText(source.nextAction, 140);
  if (!title || !rationale || !nextAction || !Array.isArray(source.steps) || source.steps.length < 1 || source.steps.length > manualRunnerPlanProposalStepLimit) {
    return undefined;
  }
  const steps = source.steps.map((step) => safeManualRunnerPlanText(step, 140));
  if (steps.some((step) => !step)) {
    return undefined;
  }
  return {
    protocolVersion: "2026-05-29",
    kind: "manual_runner_plan_proposal",
    title,
    steps: steps as string[],
    rationale,
    nextAction,
  };
}

function safeManualRunnerPlanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    return null;
  }
  const sanitized = sanitizeDisplayText(value);
  if (sanitized !== value || unsafeManualRunnerPlanTextPattern.test(value)) {
    return null;
  }
  return sanitized;
}

const unsafeManualRunnerPlanTextPattern = /api[-_ ]?key|authorization|bearer|token|secret|password|cookie|pkce|refresh|access[-_ ]?token|auth[-_ ]?code|chain[-_ ]?of[-_ ]?thought|raw[-_ ]?(prompt|command|dump|output|file|workspace)|provider[-_ ]?(response|body)|credential|file[-_ ]?content|workspace[-_ ]?(file|content)|shell|git|tool|task|patch|apply|exec|cmd|command|auto[-_ ]?run|hidden[-_ ]?read|npm\s+run|cargo\s+(check|test)|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/users(?=\/|$|[^A-Za-z0-9_])|\/home(?=\/|$|[^A-Za-z0-9_])|\/tmp(?=\/|$|[^A-Za-z0-9_])|\/etc(?=\/|$|[^A-Za-z0-9_])|\/opt(?=\/|$|[^A-Za-z0-9_])|\/mnt(?=\/|$|[^A-Za-z0-9_])|\/var(?=\/|$|[^A-Za-z0-9_])|\/volumes(?=\/|$|[^A-Za-z0-9_])|\/private(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\\\)|~\/|\.codex\/auth\.json|(?:auth|credentials?)\.json|begin [A-Za-z ]*private key/i;

function normalizeAgentProgressTool(value: unknown): AgentProgressSnapshot["currentTool"] {
  const source = asRecord(value);
  if (!source) {
    return undefined;
  }
  const label = stringOrNull(source.label);
  return {
    kind: agentProgressToolKindOrDefault(source.kind),
    label: label ?? "unknown tool",
    startedAt: stringOrNull(source.startedAt) ?? undefined,
    elapsedMs: numberOrUndefined(source.elapsedMs),
  };
}

function normalizeAgentProgressEvent(value: unknown, index: number) {
  const source = asRecord(value);
  return {
    eventId: stringOrNull(source?.eventId) ?? `event-${index + 1}`,
    timestamp: stringOrNull(source?.timestamp) ?? "unknown time",
    phase: agentProgressPhaseOrDefault(source?.phase),
    status: agentProgressStatusOrDefault(source?.status),
    message: stringOrNull(source?.message) ?? "No summary reported.",
  };
}

function normalizeAgentOverflowRecovery(value: unknown): AgentOverflowRecovery | undefined {
  const source = asRecord(value);
  const kind = agentOverflowRecoveryKindOrNull(source?.kind);
  if (!source || !kind) {
    return undefined;
  }
  return {
    kind,
    message: stringOrNull(source.message) ?? agentOverflowRecoveryFallbackMessage(kind),
    retryable: typeof source.retryable === "boolean" ? source.retryable : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrUnknown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function agentProgressPhaseOrDefault(value: unknown): AgentProgressSnapshot["phase"] {
  return typeof value === "string" && ["queued", "started", "reading_context", "editing", "running_command", "waiting_for_tool", "verifying", "finishing", "done", "failed", "stuck"].includes(value) ? value as AgentProgressSnapshot["phase"] : "started";
}

function agentProgressStatusOrDefault(value: unknown): AgentProgressSnapshot["status"] {
  return typeof value === "string" && ["pending", "running", "healthy_running", "long_running", "stalled", "stuck", "done", "failed"].includes(value) ? value as AgentProgressSnapshot["status"] : "running";
}

function agentProgressToolKindOrDefault(value: unknown): NonNullable<AgentProgressSnapshot["currentTool"]>["kind"] {
  return typeof value === "string" && ["read", "edit", "command", "test", "validation", "network", "planner", "other"].includes(value) ? value as NonNullable<AgentProgressSnapshot["currentTool"]>["kind"] : "other";
}

function agentProgressStuckReasonOrDefault(value: unknown): AgentProgressSnapshot["stuckReason"] {
  return typeof value === "string" && ["heartbeat_timeout", "tool_output_timeout", "explicit_failure", "explicit_stuck", "none"].includes(value) ? value as AgentProgressSnapshot["stuckReason"] : "none";
}

function agentOverflowRecoveryKindOrNull(value: unknown): AgentOverflowRecoveryKind | null {
  return typeof value === "string" && ["context_length_exceeded", "tool_output_too_large", "task_board_output_too_large"].includes(value) ? value as AgentOverflowRecoveryKind : null;
}

function AgentProgressStatusCard({ tone, title, detail, generatedAt }: { tone: "idle" | "loading" | "empty" | "ready" | "error"; title: string; detail: string; generatedAt?: string | null }) {
  return (
    <div className={`agent-progress-status ${tone}`} role="status">
      <div className="row">
        <strong>{title}</strong>
        <span className={`badge ${tone === "ready" || tone === "empty" ? "ok" : tone === "error" ? "warn" : ""}`}>{tone}</span>
      </div>
      <span>{detail}</span>
      {generatedAt && <span className="subtle">Generated at: {generatedAt}</span>}
      <span className="subtle">Read-only local observability; refresh only re-reads local progress.</span>
    </div>
  );
}

function AgentProgressSnapshotCard({ snapshot }: { snapshot: AgentProgressSnapshot }) {
  const state = agentProgressStateLabel(snapshot);
  const overflowRecovery = agentOverflowRecovery(snapshot);
  const visibleEvents = snapshot.recentEvents.slice(0, agentProgressRecentEventDisplayLimit);
  const hiddenEventCount = Math.max(0, snapshot.recentEvents.length - visibleEvents.length);
  return (
    <article className={`agent-progress-run ${snapshot.status}`}>
      <div className="row">
        <strong>{sanitizeDisplayText(snapshot.cardId)} / {sanitizeDisplayText(snapshot.runId)}</strong>
        <span className={`badge ${snapshot.status === "failed" || snapshot.status === "stuck" || snapshot.status === "stalled" ? "warn" : snapshot.status === "done" || snapshot.status === "healthy_running" ? "ok" : ""}`}>{state}</span>
      </div>
      <div className="agent-progress-grid">
        <span>Phase: {sanitizeDisplayText(snapshot.phase)}</span>
        <span>Status: {sanitizeDisplayText(snapshot.status)}</span>
        <span>Elapsed: {formatDuration(snapshot.elapsedMs)}</span>
        <span>Snapshot age: {formatDuration(snapshot.ageMs)}</span>
        <span>Last heartbeat: {formatFreshnessTimestamp(snapshot.lastHeartbeatAt)}</span>
        <span>Heartbeat age: {formatOptionalDuration(snapshot.heartbeatAgeMs)}</span>
        <span>Last tool output: {formatFreshnessTimestamp(snapshot.lastToolOutputAt)}</span>
        <span>Tool output age: {formatOptionalDuration(snapshot.toolOutputAgeMs)}</span>
        {snapshot.completedAt && <span>Completed: {sanitizeDisplayText(snapshot.completedAt)}</span>}
        {snapshot.currentTool && <span>Tool: {sanitizeDisplayText(snapshot.currentTool.kind)} · {sanitizeDisplayText(snapshot.currentTool.label)}{snapshot.currentTool.elapsedMs !== undefined ? ` · ${formatDuration(snapshot.currentTool.elapsedMs)}` : ""}</span>}
        {snapshot.stuckReason && snapshot.stuckReason !== "none" && <span>Stuck reason: {sanitizeDisplayText(snapshot.stuckReason)}</span>}
      </div>
      <span>{sanitizeDisplayText(snapshot.message)}</span>
      {overflowRecovery && <AgentOverflowRecoveryCard recovery={overflowRecovery} />}
      {snapshot.outputTail && <pre className="agent-progress-output">{sanitizeTimelineText(snapshot.outputTail)}</pre>}
      <div className="stack">
        <strong>Recent summaries</strong>
        {snapshot.recentEvents.length === 0 ? <span className="subtle">No recent summaries.</span> : visibleEvents.map((event) => (
          <div className="agent-progress-event" key={event.eventId}>
            <span>{sanitizeDisplayText(event.timestamp)} · {sanitizeDisplayText(event.phase)} · {sanitizeDisplayText(event.status)}</span>
            <span>{sanitizeDisplayText(event.message)}</span>
          </div>
        ))}
        {hiddenEventCount > 0 && <span className="subtle">{hiddenEventCount} more summaries hidden.</span>}
      </div>
    </article>
  );
}

function AgentOverflowRecoveryCard({ recovery }: { recovery: AgentOverflowRecovery }) {
  return (
    <div className="readiness-card warn" role="status">
      <div className="stack">
        <strong>{agentOverflowRecoveryTitle(recovery.kind)}</strong>
        <span>{agentOverflowRecoveryAction(recovery.kind)}</span>
        <span className="subtle">{sanitizeDisplayText(recovery.message)}</span>
      </div>
    </div>
  );
}

function agentOverflowRecovery(snapshot: AgentProgressSnapshot): AgentOverflowRecovery | null {
  if (!isActiveOverflowStatus(snapshot)) {
    return null;
  }
  if (snapshot.overflowRecovery) {
    return {
      ...snapshot.overflowRecovery,
      message: snapshot.overflowRecovery.message || agentOverflowRecoveryFallbackMessage(snapshot.overflowRecovery.kind),
    };
  }
  const kind = detectAgentOverflowKind(snapshot);
  if (!kind) {
    return null;
  }
  return {
    kind,
    message: agentOverflowRecoveryFallbackMessage(kind),
    retryable: true,
  };
}

function isActiveOverflowStatus(snapshot: AgentProgressSnapshot): boolean {
  return snapshot.status === "failed" || snapshot.status === "stuck" || snapshot.status === "stalled" || snapshot.phase === "failed" || snapshot.phase === "stuck";
}

function detectAgentOverflowKind(snapshot: AgentProgressSnapshot): AgentOverflowRecoveryKind | null {
  const text = boundedAgentOverflowDetectionText([
    snapshot.message,
    snapshot.outputTail ?? "",
    ...snapshot.recentEvents.map((event) => event.message),
  ]).toLowerCase();
  if (!text) {
    return null;
  }
  const tooLarge = /too large|output too large|exceeded|maximum context length|context length/.test(text);
  if (!tooLarge) {
    return null;
  }
  if (/task board output too large|task[_ -]?board|task_board_get|task_ready_cards/.test(text)) {
    return "task_board_output_too_large";
  }
  if (/tool output too large|outputtail|command output|tool dump|search output|cat output/.test(text)) {
    return "tool_output_too_large";
  }
  if (/context_length_exceeded|maximum context length|context length|context window|prompt/.test(text)) {
    return "context_length_exceeded";
  }
  return null;
}

function boundedAgentOverflowDetectionText(values: string[]): string {
  return values.map((value) => `${value.slice(0, 2000)}\n${value.slice(-2000)}`).join("\n").slice(0, 12000);
}

function agentOverflowRecoveryTitle(kind: AgentOverflowRecoveryKind): string {
  if (kind === "tool_output_too_large") {
    return "Agent output was too large.";
  }
  if (kind === "task_board_output_too_large") {
    return "Task-board output was too large.";
  }
  return "Planner context was too large.";
}

function agentOverflowRecoveryAction(kind: AgentOverflowRecoveryKind): string {
  if (kind === "task_board_output_too_large") {
    return "Use a specific card id, ready cards, or scoped search instead of a full task-board dump.";
  }
  if (kind === "tool_output_too_large") {
    return "Continue with targeted commands, scoped search, and summarized output instead of a full tool dump.";
  }
  return "Continue with a narrower request.";
}

function agentOverflowRecoveryFallbackMessage(kind: AgentOverflowRecoveryKind): string {
  if (kind === "task_board_output_too_large") {
    return "Retry with task_ready_cards or task_board_get(card_id) for one card, then summarize results.";
  }
  if (kind === "tool_output_too_large") {
    return "Retry with targeted search or cat commands and summarize the useful lines.";
  }
  return "Retry with scoped context, a specific card id, and summarized outputs.";
}

function agentProgressStateLabel(snapshot: AgentProgressSnapshot): string {
  if (snapshot.status === "stuck" || snapshot.status === "stalled" || snapshot.phase === "stuck") {
    return `stuck${snapshot.stuckReason && snapshot.stuckReason !== "none" ? `: ${snapshot.stuckReason}` : ""}`;
  }
  if (snapshot.status === "failed" || snapshot.phase === "failed") {
    return "failed";
  }
  if (snapshot.status === "done" || snapshot.phase === "done") {
    return "done";
  }
  if (snapshot.status === "long_running") {
    return "long-running, not stuck";
  }
  if (snapshot.status === "healthy_running") {
    return "running healthy, not stuck";
  }
  if (snapshot.status === "running") {
    return "running, not stuck";
  }
  return sanitizeDisplayText(snapshot.status);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "unknown";
  }
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))} ms`;
  }
  return `${Math.round(ms / 1000)} s`;
}

function formatOptionalDuration(ms: number | undefined): string {
  return ms === undefined ? "unknown" : formatDuration(ms);
}

function formatFreshnessTimestamp(value: string | undefined): string {
  return value ? sanitizeDisplayText(value) : "unknown";
}


function runtimeAuthMismatch(...errors: Array<RuntimeError | null | undefined>): RuntimeError | null {
  return errors.find((error) => error?.status === 401) ?? null;
}

function RuntimeAuthMismatchRecovery({ host, hostedRuntimeConnection }: { host: BridgeHost; hostedRuntimeConnection: boolean }) {
  const hostLabel = host === "jetbrains" ? "JetBrains" : host === "vscode" ? "VS Code" : "browser standalone";
  return (
    <div className="recovery-card stack" role="status">
      <strong>Local runtime session token mismatch</strong>
      <span>The local runtime rejected this GUI session with 401. This is a GUI-to-runtime Session token or loopback URL mismatch, not an OpenAI, GPT, OAuth, or provider API-key problem.</span>
      {host === "browser" && <span>Browser standalone cannot launch or restart the runtime. GPT/OpenAI experimental login cannot start until you provide a matching loopback runtime URL and Session token from the already running local runtime.</span>}
      {host !== "browser" && hostedRuntimeConnection && <span>{hostLabel} manages runtime recovery: use Refresh runtime or the IDE restart-runtime command, then retry login or provider setup after the runtime connection works.</span>}
      {host !== "browser" && !hostedRuntimeConnection && <span>{hostLabel} has not supplied matching runtime settings yet. Refresh/restart the IDE-managed runtime, then wait for the host to provide the loopback URL and hidden Session token.</span>}
      <span>Next actions: fix the runtime URL/Session token, refresh runtime, then retry experimental login or configure a provider. OpenAI API-key fallback remains available, but it does not repair this runtime session-token mismatch.</span>
    </div>
  );
}

function ProviderAuthStartErrorRecovery({ error, onRefresh, onLogin, onApiKeyFallback }: { error: RuntimeError; onRefresh: () => void; onLogin: () => void; onApiKeyFallback: () => void }) {
  return (
    <div className="recovery-card" role="alert">
      <strong>Account login start needs attention</strong>
      <span>OpenAI account login could not start. The runtime returned a sanitized error ({error.status}: {sanitizeDisplayText(error.message)}).</span>
      <span>Use Refresh login status, retry the experimental account login once, or switch to the OpenAI API-key fallback. This remains a private-endpoint-style experimental path, not official public OpenAI OAuth.</span>
      <span className="subtle">Do not paste raw session ids, auth codes, tokens, cookies, provider files, or private paths into the GUI.</span>
      <div className="row">
        <button type="button" onClick={onRefresh}>Refresh login status</button>
        <button type="button" onClick={onLogin}>Retry experimental account login</button>
        <button type="button" onClick={onApiKeyFallback}>Use OpenAI API key fallback</button>
      </div>
    </div>
  );
}

function BlockedProviderAuthJourney({ host, hostedRuntimeConnection, onRefresh, onApiKeyFallback }: { host: BridgeHost; hostedRuntimeConnection: boolean; onRefresh: () => void; onApiKeyFallback: () => void }) {
  const hostAction = host === "browser"
    ? "Prerequisite: enter the matching loopback runtime URL and Session token from your running local runtime. Browser standalone cannot launch or restart it."
    : hostedRuntimeConnection
      ? "Prerequisite: refresh or restart the IDE-managed runtime so this GUI receives a matching local Session token."
      : "Prerequisite: wait for the IDE host to provide a matching loopback runtime URL and hidden Session token, or restart the IDE-managed runtime.";
  return (
    <div className="login-state-panel stack blocked">
      <div className="stack">
        <strong>Experimental GPT/OpenAI login is blocked by runtime auth</strong>
        <span>This experimental, non-default account-login entrypoint is still here, but it cannot start while local runtime requests return 401.</span>
        <span>{hostAction}</span>
        <span className="subtle">No production OAuth claim. No raw tokens, authorization URLs, provider secrets, or Session token values are stored in browser storage or shown here.</span>
      </div>
      <div className="recovery-card" role="status">
        <strong>Blocked prerequisite</strong>
        <span>Fix the local GUI-to-runtime Session token mismatch first, then refresh login status and retry the experimental GPT/OpenAI login only if you accept the dev-preview risk.</span>
        <span>OpenAI API-key fallback is visible for BYOK provider setup, but it does not fix runtime 401 session-token mismatch.</span>
        <span className="subtle">Login/chat only. No workspace execution.</span>
      </div>
      <div className="row">
        <button type="button" onClick={onRefresh}>Refresh runtime</button>
        <button type="button" disabled>Connect OpenAI account (experimental)</button>
        <button type="button" onClick={onApiKeyFallback}>Use OpenAI API key fallback</button>
      </div>
    </div>
  );
}

type ProviderAuthJourneyProps = {
  status: ProviderAuthResponse;
  pendingState: { state?: string; error?: string };
  exchangeCode: string;
  exchangeError: string | null;
  exchangeWorking: boolean;
  runtimeConnected: boolean;
  onExchangeCodeChange: (code: string) => void;
  onExchange: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onLogin: () => void;
  onDisconnect: () => void;
  onApiKeyFallback: () => void;
};

function ProviderAuthJourney({ status, pendingState, exchangeCode, exchangeError, exchangeWorking, runtimeConnected, onExchangeCodeChange, onExchange, onRefresh, onLogin, onDisconnect, onApiKeyFallback }: ProviderAuthJourneyProps) {
  const canLogin = status.supportsLogin !== false;
  const canDisconnect = status.configured && status.authSource !== "api_key";
  const loginLabel = status.status === "pending" ? "Reconnect login" : status.status === "error" ? "Retry login" : status.status === "connected" ? "Reconnect experimental account" : status.status === "expired" || status.status === "revoked" ? "Reconnect OpenAI account" : "Connect OpenAI account (experimental)";
  return (
    <div className={`login-state-panel stack ${status.status}`} data-testid="provider-auth-state" data-provider-auth-status={status.status}>
      <div className="stack">
        <strong>{providerAuthStateTitle(status.status)}</strong>
        <span>{providerAuthStatusCopy[status.status]}</span>
        {status.message && <span>{sanitizeDisplayText(status.message)}</span>}
      </div>
      {status.status !== "login_unavailable" && (
        <div className="recovery-card" role="status">
          <strong>{"Recovery guidance"}</strong>
          <span>{providerAuthRecoveryCopy(status)}</span>
          {!runtimeConnected && <span>Runtime unavailable or restarted: click Refresh runtime, then Refresh login status. If the pending browser session is stale, reconnect or use the API-key fallback.</span>}
          <span className="subtle">Login/chat only. No workspace execution.</span>
        </div>
      )}
      <ProviderAuthStateBody status={status} />
      {status.status === "pending" && status.authSource === "oauth" && status.sessionId && (
        <form className="manual-exchange-card stack" onSubmit={onExchange}>
          <strong>Manual authorization-code exchange</strong>
          <span className="subtle">Finish the browser step before the pending session expires. If the browser redirect is not captured, paste only the authorization code here. The code is sent once to the local runtime and then cleared.</span>
          <span className="subtle">Session is tracked locally by the runtime and hidden here; refresh status, reconnect, cancel, or disconnect if the browser step stalls.</span>
          {pendingState.error && <div className="error">{pendingState.error}</div>}
          {exchangeError && <div className="error">{sanitizeDisplayText(exchangeError)}</div>}
          <div className="row auth-code-row">
            <label>
              Authorization code
              <input type="password" value={exchangeCode} onChange={(event) => onExchangeCodeChange(event.target.value)} placeholder="Paste authorization code" autoComplete="off" />
            </label>
            <button type="submit" disabled={exchangeWorking || !exchangeCode.trim() || !pendingState.state}>
              {exchangeWorking ? "Exchanging…" : "Exchange authorization code"}
            </button>
          </div>
        </form>
      )}
      <div className="row">
        <button type="button" onClick={onRefresh}>Refresh login status</button>
        {status.status === "login_unavailable" ? <button type="button" onClick={onLogin} disabled>Experimental login unavailable</button> : <button type="button" data-testid="provider-auth-login" onClick={onLogin} disabled={!canLogin}>{loginLabel}</button>}
        <button type="button" onClick={onDisconnect} disabled={!canDisconnect}>{status.status === "pending" ? "Cancel or disconnect login" : "Disconnect login"}</button>
        <button type="button" onClick={onApiKeyFallback}>Use OpenAI API key fallback</button>
      </div>
    </div>
  );
}

function ProviderAuthStateBody({ status }: { status: ProviderAuthResponse }) {
  if (status.status === "login_unavailable") {
    return <span className="subtle">Production account login is unavailable in this runtime. Use the OpenAI API-key fallback: create an API key in the provider console, paste it once below, save, test provider, refresh runtime/model readiness, then send. The GUI clears the key from the form.</span>;
  }
  if (status.status === "pending") {
    return (
      <div className="stack">
        <span>Browser or device verification is pending.</span>
        <details className="inspect-details">
          <summary>Inspect sanitized login metadata</summary>
          {status.expiresAt && <span>Expires: {sanitizeDisplayText(status.expiresAt)}</span>}
          {status.pollIntervalSeconds && <span>Suggested refresh interval: {status.pollIntervalSeconds} seconds</span>}
          {status.scopes && status.scopes.length > 0 && <span>Requested scopes: {sanitizeDisplayText(status.scopes.join(", "))}</span>}
        </details>
      </div>
    );
  }
  if (status.status === "connected") {
    return (
      <div className="stack">
        <span>Ready for chat through the local runtime when the experimental account path is selected and no API-key provider is configured.</span>
        {status.accountLabel && <span>Account: {sanitizeDisplayText(status.accountLabel)}</span>}
        <details className="inspect-details">
          <summary>Inspect sanitized login metadata</summary>
          {status.scopes && status.scopes.length > 0 && <span>Scopes: {sanitizeDisplayText(status.scopes.join(", "))}</span>}
          {status.expiresAt && <span>Expires: {sanitizeDisplayText(status.expiresAt)}</span>}
          {status.redacted && <span>Token hint: {sanitizeDisplayText(status.redacted)}</span>}
        </details>
        <span className="subtle">Raw provider tokens, cookies, auth codes, provider API keys, and runtime Session token values are not shown here. Runtime Session token and provider credentials are separate secrets.</span>
      </div>
    );
  }
  if (status.status === "expired" || status.status === "revoked") {
    return (
      <div className="stack">
        <span>{status.status === "expired" ? "The account session expired." : "The account session was revoked."} Reconnect or use the API-key fallback.</span>
        {status.expiresAt && <span>Expired at: {sanitizeDisplayText(status.expiresAt)}</span>}
        {status.lastError && <span>Last status detail: {sanitizeDisplayText(status.lastError)}</span>}
      </div>
    );
  }
  if (status.status === "error") {
    return <div className="error">Sanitized login error: {sanitizeDisplayText(status.lastError ?? status.message ?? "Unknown provider-auth error")}</div>;
  }
  if (status.status === "api_key_configured") {
    return <span className="subtle">The safe API-key fallback is already configured locally. You can keep using it or set up account login later.</span>;
  }
  return <span className="subtle">Account login is not configured. Use the API-key fallback for the safe/default hosted provider path, or start experimental login explicitly.</span>;
}

function providerAuthRecoveryCopy(status: ProviderAuthResponse): string {
  switch (status.status) {
    case "pending":
      return "Complete browser verification, paste only the authorization code if needed, then Exchange authorization code. If exchange is rejected, retry exchange with a fresh browser code once; if it expires, denied, or mismatches, use Reconnect login, Cancel or disconnect login, or the API-key fallback.";
    case "connected":
      return "Connected status is sanitized runtime evidence only. API-key providers and Demo Mode still take precedence for chat when ready. If the first message fails, use the sanitized error to retry login, reconnect runtime, disconnect, reduce context when relevant, or switch to the API-key fallback; no automatic retry or managed support is implied.";
    case "expired":
      return "The session can no longer power chat. Reconnect experimental account only after accepting the private-endpoint risk, or switch to the API-key fallback.";
    case "revoked":
      return "The runtime reports the account path as revoked or disconnected. Use Disconnect login to clear local state, reconnect explicitly, or switch to the API-key fallback.";
    case "error":
      return "Only sanitized error details are shown. Retry login, reconnect, disconnect, or use the API-key fallback; raw provider payloads are never needed in the GUI.";
    case "api_key_configured":
      return "The safe/default API-key path is already available locally. Keep using it unless you intentionally start the experimental high-risk path.";
    case "login_unavailable":
      return "Normal account login is unavailable. Continue with API-key fallback or Demo Mode; this is not a blocked local-first setup.";
    case "login_available":
      return "Account login is available only as an explicit experimental path. Prefer API-key fallback for real-provider setup unless dogfooding this risk path.";
    default:
      return "Choose API-key fallback for the supported real-provider setup, or explicitly start the experimental high-risk account path.";
  }
}

function providerAuthStateTitle(status: ProviderAuthStatus): string {
  switch (status) {
    case "login_unavailable":
      return "Account login unavailable";
    case "pending":
      return "Finish browser verification";
    case "connected":
      return "OpenAI account connected";
    case "expired":
      return "OpenAI account expired";
    case "revoked":
      return "OpenAI account revoked";
    case "error":
      return "OpenAI login needs attention";
    case "api_key_configured":
      return "API-key fallback configured";
    case "login_available":
      return "Account login available";
    default:
      return "Choose a provider auth path";
  }
}

type ProviderAuthExchangeValidation =
  | { ok: true; sessionId: string; code: string; state: string }
  | { ok: false; error: string };

function validateProviderAuthExchangeInput(sessionId: string | undefined, code: string, state: string | undefined, inFlight: boolean): ProviderAuthExchangeValidation {
  if (inFlight) {
    return { ok: false, error: "Authorization-code exchange is already pending. Wait for the local runtime response, refresh status, or reconnect before retrying." };
  }
  if (!sessionId || !isSafeProviderAuthExchangeValue(sessionId, 256)) {
    return { ok: false, error: "Pending login session is missing or malformed. Refresh login status, reconnect, or use the API-key fallback." };
  }
  if (!state || !isSafeProviderAuthExchangeValue(state, 512)) {
    return { ok: false, error: "Authorization state is missing or malformed. Refresh login status, reconnect, or use the API-key fallback." };
  }
  if (!code || !isSafeProviderAuthExchangeValue(code, 4096)) {
    return { ok: false, error: "Authorization code is empty, too large, or contains unsafe token/cookie/verifier markers. Paste only the browser authorization code." };
  }
  return { ok: true, sessionId, code, state };
}

function isSafeProviderAuthExchangeValue(value: string, maxLength: number): boolean {
  if (value.length > maxLength) {
    return false;
  }
  if (/\s/.test(value)) {
    return false;
  }
  const lowered = value.toLowerCase();
  return !(
    lowered.includes("access_token") ||
    lowered.includes("refresh_token") ||
    lowered.includes("id_token") ||
    lowered.includes("authorization:") ||
    lowered.includes("bearer") ||
    lowered.includes("cookie") ||
    lowered.includes("verifier") ||
    lowered.includes("auth.json") ||
    lowered.includes("/users/") ||
    lowered.includes("\\users\\") ||
    lowered.includes("openai_api_key")
  );
}

function parseProviderAuthState(status: ProviderAuthResponse | null): { state?: string; error?: string } {
  if (!status || status.status !== "pending" || status.authSource !== "oauth" || !status.sessionId) {
    return {};
  }
  if (!status.authorizationUrl) {
    return { error: "Authorization state cannot be read from the pending login response. Start experimental login again or use API key fallback." };
  }
  try {
    const state = new URL(status.authorizationUrl).searchParams.get("state")?.trim();
    if (!state) {
      return { error: "Authorization state is missing from the pending login response. Start experimental login again or use API key fallback." };
    }
    if (!isSafeProviderAuthExchangeValue(state, 512)) {
      return { error: "Authorization state is malformed or unsafe in the pending login response. Start experimental login again or use API key fallback." };
    }
    return { state };
  } catch {
    return { error: "Authorization state cannot be parsed from the pending login response. Start experimental login again or use API key fallback." };
  }
}

function openSafeAuthUrl(url: string, setWarning: (warning: string | null) => void) {
  if (!isSafeAuthUrl(url)) {
    setWarning("Provider auth URL was not opened because it is not HTTPS or loopback.");
    return;
  }
  setWarning(null);
  window.open(url, "_blank", "noopener,noreferrer");
}

function isSafeAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") {
      return true;
    }
    return isLoopbackRuntimeUrl(url.origin);
  } catch {
    return false;
  }
}

function runtimeOriginLabel(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "invalid";
  }
}

function normalizeRuntimeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.href.replace(/\/+$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function providerTestAction(status: ProviderTestState["status"]): string {
  switch (status) {
    case "reachable":
      return "Local runtime reached the provider. For Ollama, missing model errors mean the model id was not pulled locally yet.";
    case "unauthorized":
    case 401:
      return "Provider rejected the saved credential. Replace the provider API key/local credential in the local runtime, Test provider again, then Refresh runtime; do not paste the runtime Session token here.";
    case 429:
      return "Provider rate limit or quota reached. Wait, check provider billing/quota, or try another configured model.";
    case "missing_model":
    case 404:
      return "Model unavailable. Check the saved model id, choose a model returned by your provider, or pull/install it locally for Ollama/local servers.";
    case "missing_secret":
      return "Provider API key is missing in the local runtime. Paste the provider key once and save again.";
    case "timeout":
    case "unreachable":
    case "bad_url":
    case "upstream_error":
    case "network":
      return "Provider could not be reached through the local runtime. Check the provider base URL, local server, network, or runtime connection; for Ollama, start the local service at the saved loopback URL.";
    default:
      return "Review the saved provider settings and try Refresh runtime. Hosted Yet AI is not required for this check.";
  }
}

function ErrorBox({ error }: { error: RuntimeError }) {
  return <div className="error">{error.status}: {sanitizeDisplayText(error.message)}</div>;
}

function StatusBlock({ title, value }: { title: string; value: unknown }) {
  const safeValue = sanitizeDisplayValue(value);
  const summary = runtimeStatusSummary(title, safeValue);
  return (
    <div className="runtime-status-card stack">
      <div className="row">
        <h3>{title}</h3>
        <span className={`badge ${value ? "ok" : "warn"}`}>{value ? "available" : "no data"}</span>
      </div>
      <span>{summary}</span>
      <details className="inspect-details">
        <summary>Inspect sanitized runtime JSON</summary>
        <pre>{value ? JSON.stringify(safeValue, null, 2) : "No data"}</pre>
      </details>
    </div>
  );
}

function runtimeStatusSummary(title: string, value: unknown): string {
  if (!value) {
    return "Runtime evidence has not been loaded for the current settings.";
  }
  const record = isRecord(value) ? value : {};
  if (title === "/v1/ping") {
    const ready = record.ready === true ? "reports ready" : "did not report ready";
    const version = typeof record.version === "string" ? ` · version ${sanitizeDisplayText(record.version)}` : "";
    return `Runtime ${ready}${version}.`;
  }
  if (title === "/v1/caps") {
    const providerCount = typeof record.providers === "number" ? record.providers : 0;
    const capabilities = Array.isArray(record.capabilities) ? record.capabilities.length : 0;
    return `Protocol ${sanitizeDisplayText(String(record.protocolVersion ?? "unknown"))} · ${capabilities} capability label${capabilities === 1 ? "" : "s"} · ${providerCount} provider entr${providerCount === 1 ? "y" : "ies"}.`;
  }
  return "Sanitized runtime evidence is available for diagnostics.";
}
