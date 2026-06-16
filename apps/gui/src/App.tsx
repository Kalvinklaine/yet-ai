import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBridgeAdapter, type ApplyWorkspaceEditPayload, type ApplyWorkspaceEditResultPayload, type BridgeAdapter, type BridgeHost, type HostContextSnapshotPayload, type HostReadyPayload, type IdeActionProgressPayload, type IdeActionRequestPayload, type IdeActionResultPayload, type IdeActionType, type ActiveFileExcerptAttachment } from "./bridge/bridgeAdapter";
import { addAcceptedUserMessage, applyChatViewEvent, createInitialChatViewState, hydrateChatViewFromThread, removeOptimisticUserMessage, resetChatViewState, stopStreamingAssistant, type ChatViewMessage } from "./services/chatViewState";
import { activeEditorSourceLabel, activeFileExcerptPreview, activeFileExcerptSummary, activeFileExcerptToChatContext, attachedContextFileLabel, attachedContextRequiresAcknowledgement, attachedContextSummary, classifyBoundedContextPreview, formatSelectionRange, hasUsableAttachedContext, rangeFromContextSelection } from "./services/activeEditorContext";
import { EditProposalPanel, type ApplyResultState, type EditProposalState } from "./components/EditProposalPanel";
import { IdeActionProposalPanel, IdeActionsPanel, type IdeActionAttemptState } from "./components/IdeActionsPanel";
import { describeIdeActionProposal, ideActionProposalIdentityMatchesCandidate, ideActionProposalMatchesCandidate, ideActionProposalPayloadKey, isCompleteAssistantIdeActionProposalStatus, latestIdeActionProposalCandidateFromMessages, parseAssistantIdeActionProposalContent, type IdeActionProposalState } from "./services/ideActionProposal";
import { chatLifecycleLabels, chatRecoveryCodeForRuntimeError, type ChatLifecycleState } from "./services/chatLifecycle";
import { conversationHistoryStatusLabel, resolveChatAfterList, resolveFallbackChatAfterDelete } from "./services/conversationHistory";
import { disconnectProviderAuth, exchangeProviderAuth, getProviderAuthStatus, startProviderAuth, type ProviderAuthResponse, type ProviderAuthStatus } from "./services/providerAuthClient";
import { modelStatusText, resolveProviderModelReadiness } from "./services/providerReadiness";
import { listProviders, saveProvider, testProvider, type ProviderSummary, type ProviderTestResponse, type ProviderWriteRequest } from "./services/providersClient";
import { createChat, deleteChat, getAgentProgress, getCaps, getChat, getDemoMode, getModels, getPing, isLoopbackRuntimeUrl, listChats, productIdentity, productIdentityWarning, sendAbort, setDemoMode, type AgentOverflowRecovery, type AgentOverflowRecoveryKind, type AgentProgressListResponse, type AgentProgressSnapshot, type CapsResponse, type ChatSummary, type DemoModeResponse, type ModelSummary, type PingResponse, type RuntimeError, type RuntimeSettings, sendUserMessage } from "./services/runtimeClient";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./services/redaction";
import { subscribeToChat, type SseEvent } from "./services/sseClient";
import { editProposalCandidateIdentityMatches, editProposalPayloadKey, isCompleteAssistantEditProposalStatus, latestEditProposalCandidateFromMessages, parseEditProposalContent, type EditProposalIdentity } from "./services/editProposal";
import { codingActions, type CodingAction } from "./services/codingActions";

const defaultBaseUrl = "http://127.0.0.1:8001";
const productName = productIdentity.displayName;
const agentProgressSnapshotDisplayLimit = 20;
const agentProgressRecentEventDisplayLimit = 12;
export const completedIdeActionRequestChatsLimit = 64;
export const completedApplyRequestChatsLimit = 64;
const ignoredDuplicateApplyResultNote = sanitizeDisplayText("Ignored duplicate host apply result.");
const ignoredStaleApplyResultNote = sanitizeDisplayText("Ignored stale host apply result.");

const providerAuthStatusCopy: Record<ProviderAuthStatus, string> = {
  not_configured: "No production OpenAI account login is configured. Use the OpenAI API-key fallback as the safe/default real-provider path.",
  api_key_configured: "OpenAI API-key fallback is configured locally. Account login is not required for the default real-provider path.",
  login_available: "OpenAI account login is exposed by the local runtime, but it is experimental/non-default until official production support is approved.",
  login_unavailable: "OpenAI account login is planned/not available for production; use the OpenAI API-key fallback.",
  pending: "Experimental OpenAI account login is pending. Finish the browser/device step, then refresh status; use API-key fallback for the default path.",
  connected: "Experimental OpenAI account login is connected through the local runtime, but API-key fallback remains the default real-provider path.",
  expired: "Experimental OpenAI account login expired. Start it again only if you accept the risk, or use the API-key fallback.",
  revoked: "Experimental OpenAI account login was revoked. Disconnect it or use the API-key fallback.",
  error: "Experimental OpenAI account login reported an error. Review sanitized details or use the API-key fallback.",
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

type RuntimeConnectionSource = "manual" | "host.ready";

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
    id: "ollama-openai-compatible",
    label: "Ollama OpenAI-compatible",
    description: "Uses Ollama's OpenAI-compatible /v1 API; native Ollama chat is future work.",
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
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [token, setToken] = useState("");
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
  const [chatView, setChatView] = useState(() => createInitialChatViewState("chat-001"));
  const [chatLifecycleState, setChatLifecycleState] = useState<ChatLifecycleState>("idle");
  const [timeline, setTimeline] = useState<string[]>([]);
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);
  const [bridgeHost, setBridgeHost] = useState<BridgeHost>("browser");
  const [attachedContext, setAttachedContext] = useState<{ payload: HostContextSnapshotPayload; settingsRevision: number; chatId: string; excerpt?: ActiveFileExcerptAttachment } | null>(null);
  const [includeAttachedContext, setIncludeAttachedContext] = useState(false);
  const [attachedContextAcknowledged, setAttachedContextAcknowledged] = useState(false);
  const [attachedContextStatus, setAttachedContextStatus] = useState<string | null>(null);
  const [runtimeRefreshStatus, setRuntimeRefreshStatus] = useState<{ state: "checking" | "connected" | "failed"; attempt: number; checkedAt: string; detail: string } | null>(null);
  const [runtimeRefreshInFlight, setRuntimeRefreshInFlight] = useState(false);
  const [runtimeConnectionSource, setRuntimeConnectionSource] = useState<RuntimeConnectionSource>("manual");
  const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState(true);
  const [providerDetailsOpen, setProviderDetailsOpen] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const runtimeRefreshAttemptRef = useRef(0);
  const runtimeRefreshInFlightRef = useRef(false);
  const runtimeRefreshQueuedRef = useRef(false);
  const settingsRevisionRef = useRef(0);
  const settingsRef = useRef<RuntimeSettings>({ baseUrl: defaultBaseUrl, token: "" });
  const chatIdRef = useRef("chat-001");
  const providerTestAttemptRef = useRef(0);
  const providerAuthMutationAttemptRef = useRef(0);
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
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [ideActionAttempt, setIdeActionAttempt] = useState<IdeActionAttemptState | null>(null);
  const [ideActionNote, setIdeActionNote] = useState<string | null>(null);
  const [ideActionProposal, setIdeActionProposal] = useState<IdeActionProposalState | null>(null);
  const bridgeAdapterRef = useRef<BridgeAdapter | null>(null);
  const editProposalCounterRef = useRef(0);
  const editProposalApplyCounterRef = useRef(0);
  const editProposalApplySessionNonceRef = useRef<string>(generateApplyRequestSessionNonce());
  const editProposalIdentityRef = useRef<(EditProposalIdentity & { requestId: string }) | null>(null);
  const ideActionProposalCounterRef = useRef(0);
  const ideActionProposalIdentityRef = useRef<{ requestId: string; sourceMessageId: string; payloadKey: string } | null>(null);
  const chatViewMessagesRef = useRef<ChatViewMessage[]>([]);
  const pendingApplyRequestIdRef = useRef<string | null>(null);
  const pendingApplyProposalRequestIdRef = useRef<string | null>(null);
  const pendingIdeActionRequestIdRef = useRef<string | null>(null);
  const pendingIdeActionChatIdRef = useRef<string | null>(null);
  const completedIdeActionRequestChatsRef = useRef<Map<string, string>>(new Map());
  const completedApplyRequestChatsRef = useRef<Map<string, string>>(new Map());
  const ideActionCounterRef = useRef(0);
  const attachedContextRef = useRef<typeof attachedContext>(null);
  const agentProgressAttemptRef = useRef(0);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRegionRef = useRef<HTMLDivElement | null>(null);
  const optimisticUserMessageCounterRef = useRef(0);

  const settings = useMemo<RuntimeSettings>(() => ({ baseUrl, token }), [baseUrl, token]);
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
  const activeChatSummaries = chatHistoryCurrent ? chatSummaries : [];
  const activeChatSummary = activeChatSummaries.find((item) => item.chatId === chatId);
  const activeChatIndex = activeChatSummaries.findIndex((item) => item.chatId === chatId);
  const runtimeConnected = activePing?.ready === true && !activeConnectionError;
  const connectionStatus = activeConnectionError ? "error" : activePing?.ready ? "connected" : "not checked";
  const hostedRuntimeConnection = bridgeHost !== "browser" || runtimeConnectionSource === "host.ready";
  const enabledProviders = useMemo(() => activeProviders.filter((provider) => provider.enabled), [activeProviders]);
  const apiKeyReadiness = useMemo(() => resolveProviderModelReadiness(activeModels, enabledProviders, activeModelError), [activeModels, activeModelError, enabledProviders]);
  const selectedModel = apiKeyReadiness.model;
  const apiKeyChatReady = runtimeConnected && apiKeyReadiness.ready;
  const demoModeEnabled = activeDemoMode?.enabled === true;
  const providerAuthMutationInFlight = providerAuthMutation !== null;
  const experimentalOauthChatReady = runtimeConnected && !apiKeyChatReady && !providerAuthMutationInFlight && !apiKeyReadiness.mismatch && activeProviderAuthStatus?.configured === true && activeProviderAuthStatus.authSource === "oauth" && activeProviderAuthStatus.status === "connected";
  const canSendChat = apiKeyChatReady || experimentalOauthChatReady;
  const selectedModelRawId = selectedModel?.id;
  const selectedModelProviderRawId = apiKeyReadiness.provider?.id ?? selectedModel?.providerId;
  const activeSelectedDemoMode = demoModeEnabled && selectedModelProviderRawId === activeDemoMode?.providerId && selectedModelRawId === activeDemoMode?.modelId;
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
            ? "Experimental OpenAI account / gpt-5-codex"
            : "Provider required";
  const chatReadinessMessage = !runtimeConnected
    ? "Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send."
    : apiKeyChatReady
      ? activeSelectedDemoMode
        ? "Demo Mode is ready: send a prompt to try the chat flow with local canned responses. No provider call or API key is used."
        : `Ready to send using ${selectedModelDisplayName ?? "the default model"} through the local runtime.`
      : apiKeyReadiness.message
        ? apiKeyReadiness.message
        : providerAuthMutationInFlight && activeProviderAuthStatus?.authSource === "oauth" && !apiKeyChatReady
          ? "OpenAI account login state is changing. Wait for the local runtime to finish, refresh login status, or use the API-key fallback before sending."
          : experimentalOauthChatReady
            ? "Experimental Codex-like OpenAI account chat is connected through the local runtime. This private-endpoint path is high-risk, not official public OAuth support, and not production-ready."
            : activeModelError
              ? "Runtime model refresh failed. Refresh runtime again before sending the first message."
              : "Provider required: choose Demo Mode for a no-key local trial, or configure a BYOK OpenAI-compatible provider/model for real answers.";
  const chatModelStatus = apiKeyReadiness.model ? modelStatusText(apiKeyReadiness.model, apiKeyReadiness.provider) : null;
  const providerAuthPendingState = useMemo(() => parseProviderAuthState(activeProviderAuthStatus), [activeProviderAuthStatus]);
  const currentAttachedContextState = attachedContext?.settingsRevision === settingsRevision && attachedContext.chatId === chatId ? attachedContext : null;
  const currentAttachedContext = currentAttachedContextState?.payload ?? null;
  const currentActiveFileExcerpt = currentAttachedContextState?.excerpt ?? null;
  const codingActionsCanUseContext = Boolean(currentAttachedContext && !currentActiveFileExcerpt && hasUsableAttachedContext(currentAttachedContext) && (!attachedContextRequiresAcknowledgement(currentAttachedContext) || attachedContextAcknowledged));
  const editProposalCandidate = latestEditProposalCandidateFromMessages(chatView.messages);
  const activeEditProposal = editProposalCandidateIdentityMatches(editProposal, editProposalCandidate) ? editProposal : null;
  const ideActionProposalCandidate = useMemo(() => latestIdeActionProposalCandidateFromMessages(chatView.messages), [chatView.messages]);
  const activeIdeActionProposal = ideActionProposalMatchesCandidate(ideActionProposal, ideActionProposalCandidate) ? ideActionProposal : null;
  const safeActiveWorkspacePath = currentAttachedContext?.file?.workspaceRelativePath;
  const safeActiveRange = rangeFromContextSelection(currentAttachedContext?.selection);
  const pendingActiveFileExcerpt = pendingIdeActionRequestIdRef.current !== null && ideActionAttempt?.action === "getActiveFileExcerpt" && (ideActionAttempt.status === "pending" || ideActionAttempt.status === "inProgress");
  const chatHistoryStatus = conversationHistoryStatusLabel({ loading: chatHistoryLoading, current: chatHistoryCurrent, count: activeChatSummaries.length, hasError: Boolean(chatHistoryError) });

  useEffect(() => {
    setRuntimeDetailsOpen(!runtimeConnected);
  }, [runtimeConnected]);

  useEffect(() => {
    setProviderDetailsOpen(!canSendChat);
  }, [canSendChat]);

  const addTimeline = useCallback((entry: string) => {
    setTimeline((current) => [entry, ...current].slice(0, 80));
  }, []);

  const clearEditProposalState = useCallback(() => {
    editProposalIdentityRef.current = null;
    pendingApplyRequestIdRef.current = null;
    pendingApplyProposalRequestIdRef.current = null;
    completedApplyRequestChatsRef.current.clear();
    setEditProposal(null);
    setApplyResult(null);
    setApplyNote(null);
    setPendingApplyRequestId(null);
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

  const clearPendingIdeActionState = useCallback(() => {
    if (!pendingIdeActionRequestIdRef.current) {
      return;
    }
    pendingIdeActionRequestIdRef.current = null;
    pendingIdeActionChatIdRef.current = null;
    setIdeActionAttempt(null);
    setIdeActionNote("Cleared pending IDE action state in the GUI only. No host-side cancellation was requested.");
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
    providerAuthMutationAttemptRef.current += 1;
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
    clearEditProposalState();
    clearIdeActionState();
  }, [abortActiveStream, clearEditProposalState, clearIdeActionState]);

  const updateRuntimeSettings = useCallback((nextSettings: RuntimeSettings) => {
    const changed = settingsRef.current.baseUrl !== nextSettings.baseUrl || settingsRef.current.token !== nextSettings.token;
    if (changed) {
      settingsRef.current = nextSettings;
      markSettingsChanged();
    }
    setBaseUrl(nextSettings.baseUrl);
    setToken(nextSettings.token ?? "");
  }, [markSettingsChanged]);

  const updateBaseUrl = useCallback((nextBaseUrl: string) => {
    setRuntimeConnectionSource("manual");
    updateRuntimeSettings({ ...settingsRef.current, baseUrl: nextBaseUrl });
  }, [updateRuntimeSettings]);

  const updateToken = useCallback((nextToken: string) => {
    setRuntimeConnectionSource("manual");
    updateRuntimeSettings({ ...settingsRef.current, token: nextToken });
  }, [updateRuntimeSettings]);

  const applyHostReady = useCallback((payload: HostReadyPayload | undefined) => {
    if (!payload?.runtimeUrl || !isLoopbackRuntimeUrl(payload.runtimeUrl)) {
      return;
    }
    const hostRuntimeUrl = payload.runtimeUrl;
    const currentBaseUrl = settingsRef.current.baseUrl;
    const nextToken = payload.sessionToken !== undefined
      ? payload.sessionToken
      : normalizeRuntimeUrl(hostRuntimeUrl) !== normalizeRuntimeUrl(currentBaseUrl)
        ? ""
        : settingsRef.current.token;
    setRuntimeConnectionSource("host.ready");
    updateRuntimeSettings({ baseUrl: hostRuntimeUrl, token: nextToken });
    runtimeRefreshQueuedRef.current = true;
    setTimeline((current) => ["Host runtime settings received", ...current].slice(0, 80));
  }, [updateRuntimeSettings]);

  useEffect(() => {
    const adapter = createBridgeAdapter((entry) => setBridgeLog((current) => [entry, ...current].slice(0, 20)));
    bridgeAdapterRef.current = adapter;
    setBridgeHost(adapter.host);
    adapter.subscribe((message) => {
      if (message.type === "host.ready") {
        applyHostReady(message.payload as HostReadyPayload | undefined);
      } else if (message.type === "host.contextSnapshot") {
        const nextContext = message.payload as HostContextSnapshotPayload;
        setAttachedContext({ payload: nextContext, settingsRevision: settingsRevisionRef.current, chatId: chatIdRef.current });
        setIncludeAttachedContext(hasUsableAttachedContext(nextContext) && !attachedContextRequiresAcknowledgement(nextContext));
        setAttachedContextAcknowledged(false);
        setAttachedContextStatus(null);
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
        const proposalRequestId = pendingApplyProposalRequestIdRef.current;
        rememberCompletedApplyRequest(completedApplyRequestChatsRef.current, requestId, chatIdRef.current);
        pendingApplyRequestIdRef.current = null;
        pendingApplyProposalRequestIdRef.current = null;
        setPendingApplyRequestId(null);
        setApplyNote(null);
        setApplyResult({ requestId, proposalRequestId, payload: message.payload as ApplyWorkspaceEditResultPayload });
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
  }, [applyHostReady]);

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
    } finally {
      if (!keepInFlight) {
        runtimeRefreshInFlightRef.current = false;
        setRuntimeRefreshInFlight(false);
      }
    }
  }, [isCurrentRefresh]);

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
      clearEditProposalState();
      clearIdeActionState();
    } else {
      setChatHistoryError(result.error);
      setChatHistoryRevision(targetRevision);
    }
    setChatHistoryLoading(false);
  }, [abortActiveStream, clearEditProposalState, clearIdeActionState, isCurrentRefresh]);

  const selectChat = useCallback((nextChatId: string) => {
    setCompactConversationsOpen(false);
    if (nextChatId === chatIdRef.current) {
      return;
    }
    abortActiveStream("SSE stopped and abort requested before switching chats");
    setChatInput("");
    clearEditProposalState();
    clearIdeActionState();
    setAttachedContextAcknowledged(false);
    setChatId(nextChatId);
    const selectedSummary = chatSummaries.find((summary) => summary.chatId === nextChatId);
    setConversationNotice(`Switched to ${sanitizeDisplayText(selectedSummary?.title || nextChatId)}.`);
    setChatView(resetChatViewState(nextChatId));
    void loadChatThread(nextChatId);
  }, [abortActiveStream, chatSummaries, clearEditProposalState, clearIdeActionState, loadChatThread]);

  const updateDirectChatId = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextChatId = event.target.value;
    if (nextChatId !== chatIdRef.current) {
      abortActiveStream("SSE stopped and abort requested before changing chat id");
      setChatInput("");
      clearEditProposalState();
      clearIdeActionState();
      setAttachedContextAcknowledged(false);
      setChatView(resetChatViewState(nextChatId));
    }
    setChatId(nextChatId);
  }, [abortActiveStream, clearEditProposalState, clearIdeActionState]);

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
  const connect = useCallback(async () => {
    if (bridgeHost === "jetbrains") {
      bridgeAdapterRef.current?.post({
        version: "2026-05-15",
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
  }, [addTimeline, bridgeHost, refreshChats, refreshProviderAuthStatus, refreshProviders, refreshRuntime]);

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
  }, [connect, settings]);

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

  const applyOpenAiApiPreset = () => {
    const preset = providerPresets.find((item) => item.id === "openai-api");
    if (preset) {
      applyProviderPreset(preset);
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
      setProviderTestState({
        providerId,
        state: result.data.ok ? "success" : "failed",
        status: result.data.status,
        detail: `${sanitizeDisplayText(result.data.message)}${model}`,
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
    try {
      const result = await startProviderAuth(targetSettings, "openai");
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

  const startExperimentalOpenAiLogin = async () => {
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
    if (!sessionId || !code || !providerAuthPendingState.state) {
      return;
    }
    setProviderAuthError(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeWorking(true);
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = beginProviderAuthMutation("exchange");
    try {
      const result = await exchangeProviderAuth(targetSettings, "openai", sessionId, code, providerAuthPendingState.state);
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
      setProviderAuthExchangeCode("");
      if (isCurrentRefresh(targetRevision) && providerAuthMutationAttemptRef.current === attempt) {
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
    clearEditProposalState();
    clearIdeActionState();
    if (activeChatSummary) {
      void loadChatThread(chatId);
    }
  }, [abortActiveStream, activeChatSummary?.chatId, chatId, clearEditProposalState, clearIdeActionState, loadChatThread]);

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
        },
      },
      controller.signal,
    ).finally(() => {
      if (activeStreamRef.current === stream) {
        activeStreamRef.current = null;
      }
    });
  }, [addTimeline, appendChatError, chatId]);

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
  }, [addTimeline]);

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
      version: "2026-05-15",
      type: "gui.applyWorkspaceEditRequest",
      requestId: applyRequestId,
      payload: editProposal.payload,
    });
    addTimeline(`Edit proposal apply requested ${applyRequestId}`);
  }, [addTimeline, bridgeHost, clearEditProposalState, editProposal]);

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
      version: "2026-05-15",
      type: "gui.ideActionRequest",
      requestId,
      payload,
    });
    addTimeline(`IDE action requested ${requestId}`);
  }, [addTimeline, bridgeHost]);

  useEffect(() => {
    if (!ideActionProposalCandidate) {
      ideActionProposalIdentityRef.current = null;
      setIdeActionProposal(null);
      return;
    }
    const existing = ideActionProposalIdentityRef.current;
    let requestId = ideActionProposalIdentityMatchesCandidate(existing, ideActionProposalCandidate) ? existing.requestId : null;
    if (!requestId) {
      ideActionProposalCounterRef.current += 1;
      requestId = `gui-ide-proposal-${ideActionProposalCounterRef.current}`;
      ideActionProposalIdentityRef.current = {
        requestId,
        sourceMessageId: ideActionProposalCandidate.sourceMessageId,
        payloadKey: ideActionProposalCandidate.payloadKey,
      };
    }
    const nextProposal = { ...ideActionProposalCandidate, requestId };
    setIdeActionProposal((current) => ideActionProposalMatchesCandidate(current, ideActionProposalCandidate) && current.requestId === requestId ? current : nextProposal);
  }, [ideActionProposalCandidate]);

  useEffect(() => {
    const candidate = latestEditProposalCandidateFromMessages(chatView.messages);
    if (!candidate) {
      clearEditProposalState();
      return;
    }
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
    if (pendingApplyRequestIdRef.current && pendingApplyProposalRequestIdRef.current !== proposal.requestId) {
      pendingApplyRequestIdRef.current = null;
      pendingApplyProposalRequestIdRef.current = null;
      setPendingApplyRequestId(null);
    }
  }, [chatView.messages, clearEditProposalState]);

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
    const context = submittedAttachedContext?.excerpt ? activeFileExcerptToChatContext(submittedAttachedContext.excerpt) : submittedAttachedContext?.payload;
    setChatLifecycleState("command_submitting");
    optimisticUserMessageCounterRef.current += 1;
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
      clearSubmittedAttachedContext(submittedAttachedContext);
      startSse(targetChatId);
      setChatLifecycleState((current) => current === "command_submitting" || current === "sse_connecting" ? "command_accepted" : current);
    } else {
      setChatError(result.error);
      setChatLifecycleState("failed");
      setChatInput(content);
      setChatView((current) => removeOptimisticUserMessage(current, optimisticUserMessageId));
      appendChatError(result.error.message, chatRecoveryCodeForRuntimeError(result.error, "command"));
      addTimeline(`Command error: ${sanitizeDisplayText(result.error.message)}`);
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
        reason: "The account login fallback is connected, but this private-endpoint path is not the safe/default provider setup.",
        nextAction: "Prefer configuring an API-key provider; otherwise type a prompt only if you accept the experimental risk.",
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
        : "No enabled OpenAI-compatible provider/model is ready for chat streaming.",
      nextAction: "For real answers, use the OpenAI API-key fallback (safe/default), paste a provider API key, save, test provider, refresh runtime/model readiness, then send. Choose Demo Mode only to try the chat flow without provider calls.",
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

  return (
    <main className={`app-shell host-${bridgeHost}`}>
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
              <span className={`readiness-pill ${canSendChat ? "ok" : "warn"}`}>{canSendChat ? activeSelectedDemoMode ? "Demo send ready" : "Provider send ready" : "Provider or Demo Mode needed"}</span>
              <span className="readiness-pill ok">Local-first BYOK</span>
            </div>
          </div>
          <div className="stack">
            {chatModelStatus && <span className="subtle">Model status: {chatModelStatus}</span>}
            {demoModeEnabled && <span className="subtle">{activeSelectedDemoMode ? "Demo Mode is active in the local runtime. It uses canned responses only, makes no provider calls, requires no API key, and is not model quality." : `Demo Mode is enabled in the local runtime, but the current ready chat path uses ${selectedModelDisplayName ?? "the selected model"}${selectedModelProviderId ? ` (${selectedModelProviderId})` : ""}. Sends may use that configured provider; disable Demo Mode or choose the demo model only when dogfooding canned local responses.`}</span>}
            {activeDemoModeError && <span className="error">Demo Mode status unavailable: {activeDemoModeError.status}: {sanitizeDisplayText(activeDemoModeError.message)}</span>}
            {runtimeConnected && !canSendChat && <span className="subtle">For the quickest real-provider path, choose OpenAI API-key fallback, paste a provider API key once, save, test provider, refresh runtime/model readiness, then send your first message. Demo Mode is only for trying the chat flow without provider calls.</span>}
            {experimentalOauthChatReady && <span className="subtle">OpenAI API-key fallback remains the safe/default setup and will be preferred when configured.</span>}
            {!canSendChat && <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>}
          </div>
          <FirstRunChecklist runtimeConnected={runtimeConnected} demoModeReady={activeSelectedDemoMode} apiKeyReady={apiKeyChatReady} experimentalAccountReady={experimentalOauthChatReady} canSendChat={canSendChat} />
          <FirstMessageReadinessWizard
            readiness={firstMessageReadiness}
            canSendChat={canSendChat}
            runtimeRefreshInFlight={runtimeRefreshInFlight}
            providerTestState={providerTestState}
            demoModeEnabled={demoModeEnabled}
            demoModeWorking={demoModeWorking}
            onRefreshRuntime={() => void connect()}
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
                <button type="button" onClick={() => { setRuntimeDetailsOpen(true); void connect(); }} disabled={runtimeRefreshInFlight}>{runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime"}</button>
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
                {chatView.messages.length === 0 ? <ChatEmptyState runtimeConnected={runtimeConnected} canSendChat={canSendChat} providerReady={apiKeyChatReady || experimentalOauthChatReady} activeDemoMode={activeSelectedDemoMode} selectedModelDisplayName={selectedModelDisplayName} selectedModelProviderId={selectedModelProviderId} context={currentAttachedContext} hasLocalConversations={activeChatSummaries.length > 0} onProviderSetup={applyOpenAiApiPreset} onRefreshRuntime={() => void connect()} /> : chatView.messages.map((message) => <ChatBubble key={message.id} message={message} activeEditProposal={activeEditProposal} activeIdeActionProposal={activeIdeActionProposal} />)}
                <span className={`chat-lifecycle-state ${chatLifecycleState}`}>{chatLifecycleLabel}</span>
                {chatView.messages.some((message) => message.role === "assistant" && message.status === "streaming") && <span className="subtle">Assistant is streaming…</span>}
              </div>
              <EditProposalPanel proposal={activeEditProposal} result={activeEditProposal ? applyResult : null} host={bridgeHost} pendingRequestId={pendingApplyRequestId} note={applyNote} onApply={submitEditProposal} onCancelPending={cancelPendingEditProposalApply} />
              <IdeActionProposalPanel proposal={activeIdeActionProposal} host={bridgeHost} pending={pendingIdeActionRequestIdRef.current !== null} onRun={(payload) => requestIdeAction(payload, "gui-ide-proposal-action")} />
            </div>
            <form className="chat-composer" onSubmit={(event) => void submitChat(event)}>
              <div className="composer-tools">
                <ActiveFileExcerptAttachPanel host={bridgeHost} excerpt={currentActiveFileExcerpt} include={includeAttachedContext} pending={pendingActiveFileExcerpt} status={attachedContextStatus} onRequest={() => requestIdeAction({ action: "getActiveFileExcerpt" }, "gui-active-file-excerpt")} onIncludeChange={setIncludeAttachedContext} />
                <AttachedContextPreview context={currentAttachedContext} include={includeAttachedContext} acknowledged={attachedContextAcknowledged} status={attachedContextStatus} onIncludeChange={setIncludeAttachedContext} onAcknowledgeChange={setAttachedContextAcknowledged} />
                <CodingActionsPanel canUseContext={codingActionsCanUseContext} context={currentAttachedContext} onAction={applyCodingAction} />
                <IdeActionsPanel host={bridgeHost} attempt={ideActionAttempt} note={ideActionNote} workspaceRelativePath={safeActiveWorkspacePath} range={safeActiveRange} onGetContext={() => requestIdeAction({ action: "getContextSnapshot" })} onOpenFile={(workspaceRelativePath) => requestIdeAction({ action: "openWorkspaceFile", workspaceRelativePath })} onRevealRange={(workspaceRelativePath, range) => requestIdeAction({ action: "revealWorkspaceRange", workspaceRelativePath, range })} onClearPendingIdeAction={clearPendingIdeActionState} />
              </div>
              <div className="composer-input-area">
                <textarea ref={chatInputRef} value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={canSendChat ? "Ask about the current file, selection, or project..." : "Connect the runtime and configure a provider to start chatting..."} />
                <div className="row chat-actions">
                  <button type="submit" disabled={!canSendChat}>Send</button>
                  <button type="button" className="secondary-button" onClick={stopSse}>Stop response</button>
                </div>
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
          : <p className="subtle">In VS Code or JetBrains, the local runtime Session token is normally supplied automatically by the IDE host through trusted host.ready. Paste a token only when connecting to a manually started runtime such as one launched with YET_AI_AUTH_TOKEN=.... This local runtime token authorizes the GUI to the loopback runtime; it is not an OpenAI key or provider API key.</p>}
        {!runtimeConnected && hostedRuntimeConnection && <div className="recovery-card" role="status"><strong>IDE-managed runtime recovery</strong><span>Refresh runtime asks the host-delivered URL/token to reconnect. If the runtime is stale, missing, or unauthorized, use the IDE runtime status/restart command; do not copy raw runtime tokens into chat.</span></div>}
        <div className="row">
          <button onClick={() => void connect()} disabled={runtimeRefreshInFlight}>{runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime"}</button>
          <span className="subtle">Authorization header is sent only to validated loopback runtime URLs.</span>
        </div>
        {runtimeRefreshStatus && <div className={`refresh-status ${runtimeRefreshStatus.state}`} role="status"><strong>{runtimeRefreshStatus.detail}</strong><span>Attempt {runtimeRefreshStatus.attempt} at {runtimeRefreshStatus.checkedAt}</span></div>}
        {activeConnectionError && <ErrorBox error={activeConnectionError} />}
        {activeModelError && <div className="error">Models refresh failed: {activeModelError.status}: {sanitizeDisplayText(activeModelError.message)}</div>}
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

      <section className="card stack secondary-card provider-setup-card">
        <details className="debug-details" data-testid="provider-setup-details" open={providerDetailsOpen} onToggle={(event) => setProviderDetailsOpen(event.currentTarget.open)}>
          <summary><h2>Provider setup</h2></summary>
        {runtimeConnected && !apiKeyChatReady && !experimentalOauthChatReady && (
          <div className="guided-setup-card stack" role="status">
            <strong>Runtime connected — choose the first-message path</strong>
            <span><strong>Real provider (safe default):</strong> use OpenAI API-key fallback, paste a provider API key once, save, test provider, refresh runtime/model readiness, then send.</span>
            <span><strong>Try without provider calls:</strong> enable Demo Mode from Chat readiness. It uses local canned responses only and is not model quality.</span>
            <div className="row">
              <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>
            </div>
          </div>
        )}
        <p className="subtle"><strong>Runtime Session token</strong> is only for this GUI talking to the local loopback runtime. <strong>Provider API key</strong> is for the upstream OpenAI-compatible provider and is sent to the local runtime only on save, cleared from this form immediately after save/update is submitted, and never written to browser storage.</p>
        <p className="subtle">ChatGPT/OpenAI account login is experimental/non-default until officially supported and reviewed. It is not production official login. OpenAI API-key setup is the current safe/default real-provider path.</p>
        <p className="subtle">Current chat uses OpenAI-compatible providers only. Ollama is available here through its OpenAI-compatible /v1 endpoint; native Ollama chat is future work.</p>
        {providerError && <ErrorBox error={providerError} />}
        <div className="provider-item account-login-card stack">
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
          {providerAuthError && <ErrorBox error={providerAuthError} />}
          {providerAuthUrlWarning && <div className="error">{providerAuthUrlWarning}</div>}
          {activeProviderAuthStatus ? (
            <ProviderAuthJourney
              status={activeProviderAuthStatus}
              pendingState={providerAuthPendingState}
              exchangeCode={providerAuthExchangeCode}
              exchangeError={providerAuthExchangeError}
              exchangeWorking={providerAuthExchangeWorking}
              onExchangeCodeChange={setProviderAuthExchangeCode}
              onExchange={(event) => void exchangeOpenAiLoginCode(event)}
              onRefresh={() => void refreshProviderAuthStatus()}
              onLogin={() => void startOpenAiLogin()}
              onExperimentalLogin={() => void startExperimentalOpenAiLogin()}
              onDisconnect={() => void disconnectOpenAiLogin()}
              onApiKeyFallback={applyOpenAiApiPreset}
            />
          ) : (
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
        <div className="grid">
          <form className="stack" onSubmit={(event) => void submitProvider(event)}>
            <div className="stack">
              <strong>Quick presets</strong>
              <div className="row">
                {providerPresets.map((preset) => (
                  <button type="button" key={preset.id} onClick={() => applyProviderPreset(preset)} title={preset.description}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <span className="subtle">Presets only fill provider fields. They never include API keys and do not contact providers from the GUI. The OpenAI API-key fallback preset is the safe/default real-provider starting point.</span>
            </div>
            <div className="form-grid">
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
                <input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} placeholder="Provider API key, not the runtime Session token" autoComplete="off" />
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
            <span className="field-help">After Save/Update: click Test provider in the Providers list, click Refresh runtime to reload model readiness, then use Send when Chat readiness says Send available.</span>
          </form>
          <div className="stack">
            <h3>Providers</h3>
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
          <summary>Bridge debug</summary>
          <p className="subtle">Browser mock mode is non-privileged. It only logs bridge messages.</p>
          <div className="timeline">
            {bridgeLog.map((entry, index) => <div className="timeline-entry" key={`${index}:${entry}`}>{entry}</div>)}
          </div>
        </details>
      </section>
    </main>
  );
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
        <span>Try Demo Mode from Chat readiness for local canned responses with no API key, or configure a BYOK OpenAI-compatible provider for real model answers. Provider credentials are sent only to the local runtime and are not stored by the GUI.</span>
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

function ChatBubble({ message, activeEditProposal, activeIdeActionProposal }: { message: ChatViewMessage; activeEditProposal: EditProposalState | null; activeIdeActionProposal: IdeActionProposalState | null }) {
  const [inspectedProposalPayloadKey, setInspectedProposalPayloadKey] = useState<string | null>(null);
  const [inspectedEditProposalKey, setInspectedEditProposalKey] = useState<string | null>(null);
  const editProposal = message.role === "assistant" && isCompleteAssistantEditProposalStatus(message.status) ? parseEditProposalContent(message.content) : null;
  const editProposalJson = editProposal ? JSON.stringify(editProposal, null, 2) : null;
  const editProposalKey = editProposal ? editProposalPayloadKey(editProposal) : null;
  const isActiveEditProposal = Boolean(editProposalKey && activeEditProposal?.sourceMessageId === message.id && activeEditProposal.payloadKey === editProposalKey);
  const proposal = message.role === "assistant" && isCompleteAssistantIdeActionProposalStatus(message.status) ? parseAssistantIdeActionProposalContent(message.content) : null;
  const proposalJson = proposal ? JSON.stringify(proposal, null, 2) : null;
  const proposalPayloadKey = proposal ? ideActionProposalPayloadKey(proposal) : null;
  const proposalLabel = proposal ? sanitizeDisplayText(describeIdeActionProposal(proposal)) : null;
  const isActiveProposal = Boolean(proposalPayloadKey && activeIdeActionProposal?.sourceMessageId === message.id && activeIdeActionProposal.payloadKey === proposalPayloadKey);
  // Key-based inspect state: the JSON is only visible when the user has explicitly
  // clicked the toggle AND the inspected key still matches the current proposal.
  // This makes the inspect state a per-(proposal-key) gate instead of a boolean
  // that can leak the previous proposal's JSON when the payload changes.
  const editProposalJsonVisible = editProposalKey !== null && inspectedEditProposalKey === editProposalKey;
  const proposalJsonVisible = proposalPayloadKey !== null && inspectedProposalPayloadKey === proposalPayloadKey;

  return (
    <div className={`chat-bubble ${message.role}`}>
      <strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Yet AI" : "Error"}</strong>
      {editProposal && editProposalJson && editProposalKey ? (
        <div className="assistant-proposal-compact stack">
          <span>{isActiveEditProposal ? "Proposed a safe edit. Review the proposal card below. It will not apply automatically." : "Earlier safe edit proposal. Only the latest valid proposal can be requested from the proposal card."}</span>
          <button type="button" className="link-button" onClick={() => setInspectedEditProposalKey(editProposalJsonVisible ? null : editProposalKey)}>{editProposalJsonVisible ? "Hide proposal JSON" : "Inspect proposal JSON"}</button>
          {editProposalJsonVisible && <pre aria-label="Assistant edit proposal JSON">{editProposalJson}</pre>}
        </div>
      ) : proposal && proposalJson && proposalLabel ? (
        <div className="assistant-proposal-compact stack">
          <span>{isActiveProposal ? `Proposed a read-only IDE action: ${proposalLabel}. Review the proposal card below. It will not run automatically.` : `Earlier read-only IDE action proposal: ${proposalLabel}. Only the latest valid proposal can be run from the proposal card.`}</span>
          <button type="button" className="link-button" onClick={() => setInspectedProposalPayloadKey(proposalJsonVisible ? null : proposalPayloadKey)}>{proposalJsonVisible ? "Hide proposal JSON" : "Inspect proposal JSON"}</button>
          {proposalJsonVisible && <pre aria-label="Assistant proposal JSON">{proposalJson}</pre>}
        </div>
      ) : (
        <span>{message.content || (message.status === "streaming" ? "…" : "")}</span>
      )}
    </div>
  );
}

function FirstRunChecklist({ runtimeConnected, demoModeReady, apiKeyReady, experimentalAccountReady, canSendChat }: { runtimeConnected: boolean; demoModeReady: boolean; apiKeyReady: boolean; experimentalAccountReady: boolean; canSendChat: boolean }) {
  const steps = [
    { label: "Runtime", detail: runtimeConnected ? "connected" : "refresh local runtime", ok: runtimeConnected },
    { label: "Demo Mode", detail: demoModeReady ? "local canned trial ready" : "no-key local canned trial", ok: demoModeReady },
    { label: "Real provider", detail: apiKeyReady ? "BYOK API-key ready" : "safe/default API-key fallback", ok: apiKeyReady },
    { label: "First message", detail: canSendChat ? "Send available" : "choose Demo Mode or BYOK provider", ok: canSendChat },
  ];
  return (
    <div className="first-run-checklist" role="list" aria-label="First-run setup checklist">
      {steps.map((step) => (
        <span className={`first-run-step ${step.ok ? "ok" : "todo"}`} role="listitem" key={step.label}>
          <strong>{step.label}</strong>
          <span>{step.detail}</span>
        </span>
      ))}
      <span className={`first-run-step ${experimentalAccountReady ? "warn" : "todo"}`} role="listitem">
        <strong>Account login</strong>
        <span>{experimentalAccountReady ? "experimental high-risk connected" : "experimental non-default"}</span>
      </span>
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
  return (
    <div className={`first-message-wizard ${canSendChat ? "ready" : "blocked"}`} role="status" aria-label="First message readiness guide">
      <div className="stack">
        <div className="row">
          <strong>{readiness.title}</strong>
          <span className={`badge ${canSendChat ? "ok" : "warn"}`}>{canSendChat ? "Send available" : "Send disabled"}</span>
        </div>
        <span>Why: {readiness.reason}</span>
        <span>Next safest action: {readiness.nextAction}</span>
      </div>
      <div className="readiness-action-row">
        {readiness.actions.map((action) => <FirstMessageActionButton key={`${action.kind}:${"providerId" in action ? action.providerId : action.label}`} action={action} runtimeRefreshInFlight={runtimeRefreshInFlight} providerTestState={providerTestState} demoModeEnabled={demoModeEnabled} demoModeWorking={demoModeWorking} onRefreshRuntime={onRefreshRuntime} onToggleDemoMode={onToggleDemoMode} onApiKeyFallback={onApiKeyFallback} onTestProvider={onTestProvider} onFocusPrompt={onFocusPrompt} />)}
      </div>
      <details className="first-message-notes" data-testid="first-message-local-first-notes">
        <summary>Local-first notes</summary>
        <ol className="first-message-steps">
          {readiness.notes.map((note) => <li key={note}>{note}</li>)}
        </ol>
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

function ActiveFileExcerptAttachPanel({ host, excerpt, include, pending, status, onRequest, onIncludeChange }: { host: BridgeHost; excerpt: ActiveFileExcerptAttachment | null; include: boolean; pending: boolean; status: string | null; onRequest: () => void; onIncludeChange: (include: boolean) => void }) {
  const supported = host === "vscode" || host === "jetbrains";
  if (!supported) {
    return (
      <section className="readiness-card warn active-file-excerpt-card" role="status" aria-label="Active file excerpt">
        <div className="row">
          <strong>Active file excerpt</strong>
          <span className="badge warn">IDE host required</span>
        </div>
        <span className="subtle">Open {productName} in VS Code or JetBrains to attach a bounded active-file excerpt. Browser mode will not execute host actions.</span>
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
          <span className="subtle">Excerpt stays in React state only, is prompt-only, and clears after the next accepted message.</span>
        </div>
      ) : (
        <span className="subtle">Click once to request a bounded excerpt from the visible active editor. No request is made automatically.</span>
      )}
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
    stuckReason: agentProgressStuckReasonOrDefault(source?.stuckReason),
    recentEvents,
  };
}

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


type ProviderAuthJourneyProps = {
  status: ProviderAuthResponse;
  pendingState: { state?: string; error?: string };
  exchangeCode: string;
  exchangeError: string | null;
  exchangeWorking: boolean;
  onExchangeCodeChange: (code: string) => void;
  onExchange: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onLogin: () => void;
  onExperimentalLogin: () => void;
  onDisconnect: () => void;
  onApiKeyFallback: () => void;
};

function ProviderAuthJourney({ status, pendingState, exchangeCode, exchangeError, exchangeWorking, onExchangeCodeChange, onExchange, onRefresh, onLogin, onExperimentalLogin, onDisconnect, onApiKeyFallback }: ProviderAuthJourneyProps) {
  const canLogin = status.supportsLogin !== false;
  const canDisconnect = status.configured && status.authSource !== "api_key";
  const reconnectLabel = status.status === "pending" ? "Reconnect login" : status.status === "error" ? "Retry login" : "Reconnect OpenAI account";
  return (
    <div className={`login-state-panel stack ${status.status}`}>
      <div className="stack">
        <strong>{providerAuthStateTitle(status.status)}</strong>
        <span>{providerAuthStatusCopy[status.status]}</span>
        {status.message && <span>{sanitizeDisplayText(status.message)}</span>}
      </div>
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
        {(status.status === "login_available" || status.status === "not_configured") && <button type="button" onClick={onLogin} disabled={!canLogin}>Start experimental OpenAI login</button>}
        {status.status === "login_unavailable" && <button type="button" onClick={onLogin} disabled>Experimental login unavailable</button>}
        {(status.status === "pending" || status.status === "expired" || status.status === "revoked" || status.status === "error") && <button type="button" onClick={onLogin} disabled={!canLogin}>{reconnectLabel}</button>}
        {status.status !== "connected" && <button type="button" className="danger-button" onClick={onExperimentalLogin}>Experimental high-risk account login</button>}
        {status.status === "connected" && <button type="button" className="danger-button" onClick={onExperimentalLogin}>Reconnect experimental account</button>}
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
        {status.expiresAt && <span>Expires: {sanitizeDisplayText(status.expiresAt)}</span>}
        {status.pollIntervalSeconds && <span>Suggested refresh interval: {status.pollIntervalSeconds} seconds</span>}
        {status.scopes && status.scopes.length > 0 && <span>Requested scopes: {sanitizeDisplayText(status.scopes.join(", "))}</span>}
      </div>
    );
  }
  if (status.status === "connected") {
    return (
      <div className="stack">
        <span>Ready for chat through the local runtime when the experimental account path is selected and no API-key provider is configured.</span>
        {status.accountLabel && <span>Account: {sanitizeDisplayText(status.accountLabel)}</span>}
        {status.scopes && status.scopes.length > 0 && <span>Scopes: {sanitizeDisplayText(status.scopes.join(", "))}</span>}
        {status.expiresAt && <span>Expires: {sanitizeDisplayText(status.expiresAt)}</span>}
        {status.redacted && <span>Token hint: {sanitizeDisplayText(status.redacted)}</span>}
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
  return <span className="subtle">Start account login when supported, or use the API-key fallback now.</span>;
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
    case "unauthorized":
    case 401:
      return "Check that the provider API key was saved in the local runtime and belongs to this provider; do not paste the runtime Session token here.";
    case 429:
      return "Provider rate limit or quota reached. Wait, check provider billing/quota, or try another configured model.";
    case "missing_model":
    case 404:
      return "Model unavailable. Check the saved model id or choose a model returned by your OpenAI-compatible provider.";
    case "missing_secret":
      return "Provider API key is missing in the local runtime. Paste the provider key once and save again.";
    case "timeout":
    case "unreachable":
    case "bad_url":
    case "upstream_error":
    case "network":
      return "Provider could not be reached through the local runtime. Check the provider base URL, local server, network, or runtime connection.";
    default:
      return "Review the saved provider settings and try Refresh runtime. Hosted Yet AI is not required for this check.";
  }
}

function ErrorBox({ error }: { error: RuntimeError }) {
  return <div className="error">{error.status}: {sanitizeDisplayText(error.message)}</div>;
}

function StatusBlock({ title, value }: { title: string; value: unknown }) {
  const safeValue = sanitizeDisplayValue(value);
  return (
    <div className="stack">
      <h3>{title}</h3>
      <pre>{value ? JSON.stringify(safeValue, null, 2) : "No data"}</pre>
    </div>
  );
}
