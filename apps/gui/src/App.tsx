import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBridgeAdapter, isApplyWorkspaceEditPayload, type ApplyWorkspaceEditPayload, type ApplyWorkspaceEditResultPayload, type BridgeAdapter, type BridgeHost, type HostContextSnapshotPayload, type HostReadyPayload } from "./bridge/bridgeAdapter";
import { addAcceptedUserMessage, applyChatViewEvent, createInitialChatViewState, hydrateChatViewFromThread, resetChatViewState, stopStreamingAssistant, type ChatViewMessage } from "./services/chatViewState";
import { disconnectProviderAuth, exchangeProviderAuth, getProviderAuthStatus, startProviderAuth, type ProviderAuthResponse, type ProviderAuthStatus } from "./services/providerAuthClient";
import { listProviders, saveProvider, testProvider, type ProviderSummary, type ProviderTestResponse, type ProviderWriteRequest } from "./services/providersClient";
import { createChat, deleteChat, getAgentProgress, getCaps, getChat, getModels, getPing, isLoopbackRuntimeUrl, listChats, productIdentity, productIdentityWarning, sendAbort, type AgentOverflowRecovery, type AgentOverflowRecoveryKind, type AgentProgressListResponse, type AgentProgressSnapshot, type CapsResponse, type ChatSummary, type ModelSummary, type PingResponse, type RuntimeError, type RuntimeSettings, sendUserMessage } from "./services/runtimeClient";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./services/redaction";
import { subscribeToChat, type SseEvent } from "./services/sseClient";

const defaultBaseUrl = "http://127.0.0.1:8001";
const productName = productIdentity.displayName;
const agentProgressSnapshotDisplayLimit = 20;
const agentProgressRecentEventDisplayLimit = 12;

const providerAuthStatusCopy: Record<ProviderAuthStatus, string> = {
  not_configured: "No account login is configured yet. Use Login with OpenAI when available or the API key fallback.",
  api_key_configured: "OpenAI API key fallback is configured locally. Account login is not required.",
  login_available: "OpenAI account login is available through the local runtime.",
  login_unavailable: "OpenAI account login is planned/not available yet; use API key fallback.",
  pending: "OpenAI account login is pending. Finish the browser or device verification flow, then refresh the status.",
  connected: "OpenAI account login is connected through the local runtime.",
  expired: "OpenAI account login expired. Start login again or use the API key fallback.",
  revoked: "OpenAI account login was revoked. Disconnect it or use the API key fallback.",
  error: "OpenAI account login reported an error. Review the sanitized details or use the API key fallback.",
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

type EditProposalState = {
  requestId: string;
  payload: ApplyWorkspaceEditPayload;
};

type ApplyResultState = {
  requestId: string;
  payload: ApplyWorkspaceEditResultPayload;
};

type FirstMessageAction =
  | { kind: "refresh_runtime"; label: string }
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
    label: "OpenAI API",
    description: "Official OpenAI API endpoint. ChatGPT/OpenAI account login is planned where officially supported; API key is the current safe fallback.",
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

export function App() {
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [token, setToken] = useState("");
  const [ping, setPing] = useState<PingResponse | null>(null);
  const [caps, setCaps] = useState<CapsResponse | null>(null);
  const [models, setModels] = useState<ModelSummary[]>([]);
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
  const [chatInput, setChatInput] = useState("");
  const [chatView, setChatView] = useState(() => createInitialChatViewState("chat-001"));
  const [timeline, setTimeline] = useState<string[]>([]);
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);
  const [bridgeHost, setBridgeHost] = useState<BridgeHost>("browser");
  const [attachedContext, setAttachedContext] = useState<{ payload: HostContextSnapshotPayload; settingsRevision: number; chatId: string } | null>(null);
  const [includeAttachedContext, setIncludeAttachedContext] = useState(false);
  const [attachedContextStatus, setAttachedContextStatus] = useState<string | null>(null);
  const [runtimeRefreshStatus, setRuntimeRefreshStatus] = useState<{ state: "checking" | "connected" | "failed"; attempt: number; checkedAt: string; detail: string } | null>(null);
  const [runtimeRefreshInFlight, setRuntimeRefreshInFlight] = useState(false);
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
  const [agentProgress, setAgentProgress] = useState<AgentProgressState>({ state: "not_checked", response: null, error: null });
  const activeStreamRef = useRef<ActiveStream | null>(null);
  const [editProposal, setEditProposal] = useState<EditProposalState | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResultState | null>(null);
  const bridgeAdapterRef = useRef<BridgeAdapter | null>(null);
  const editProposalCounterRef = useRef(0);
  const attachedContextRef = useRef<typeof attachedContext>(null);
  const agentProgressAttemptRef = useRef(0);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const settings = useMemo<RuntimeSettings>(() => ({ baseUrl, token }), [baseUrl, token]);
  settingsRef.current = settings;
  chatIdRef.current = chatId;
  attachedContextRef.current = attachedContext;
  const runtimeDataCurrent = runtimeDataRevision === settingsRevision;
  const providerDataCurrent = providerDataRevision === settingsRevision;
  const providerAuthDataCurrent = providerAuthDataRevision === settingsRevision;
  const chatHistoryCurrent = chatHistoryRevision === settingsRevision;
  const activePing = runtimeDataCurrent ? ping : null;
  const activeCaps = runtimeDataCurrent ? caps : null;
  const activeModels = runtimeDataCurrent ? models : [];
  const activeConnectionError = runtimeDataCurrent ? connectionError : null;
  const activeModelError = runtimeDataCurrent ? modelError : null;
  const activeIdentityWarnings = runtimeDataCurrent ? identityWarnings : [];
  const activeProviders = providerDataCurrent ? providers : [];
  const activeProviderAuthStatus = providerAuthDataCurrent ? providerAuthStatus : null;
  const activeChatSummaries = chatHistoryCurrent ? chatSummaries : [];
  const activeChatSummary = activeChatSummaries.find((item) => item.chatId === chatId);
  const activeChatIndex = activeChatSummaries.findIndex((item) => item.chatId === chatId);
  const runtimeConnected = activePing?.ready === true && !activeConnectionError;
  const connectionStatus = activeConnectionError ? "error" : activePing?.ready ? "connected" : "not checked";
  const enabledProviders = useMemo(() => activeProviders.filter((provider) => provider.enabled), [activeProviders]);
  const apiKeyReadiness = useMemo(() => resolveProviderModelReadiness(activeModels, enabledProviders, activeModelError), [activeModels, activeModelError, enabledProviders]);
  const selectedModel = apiKeyReadiness.model;
  const apiKeyChatReady = runtimeConnected && apiKeyReadiness.ready;
  const providerAuthMutationInFlight = providerAuthMutation !== null;
  const experimentalOauthChatReady = runtimeConnected && !apiKeyChatReady && !providerAuthMutationInFlight && !apiKeyReadiness.mismatch && activeProviderAuthStatus?.configured === true && activeProviderAuthStatus.authSource === "oauth" && activeProviderAuthStatus.status === "connected";
  const canSendChat = apiKeyChatReady || experimentalOauthChatReady;
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
    ? "Runtime is not connected. Refresh runtime and fix the local runtime problem before sending the first GPT message."
    : apiKeyChatReady
      ? `Ready to send using ${selectedModelDisplayName ?? "the default model"}.`
      : apiKeyReadiness.message
        ? apiKeyReadiness.message
        : providerAuthMutationInFlight && activeProviderAuthStatus?.authSource === "oauth" && !apiKeyChatReady
          ? "OpenAI account login state is changing. Wait for the local runtime to finish, refresh login status, or use the API-key fallback before sending."
          : experimentalOauthChatReady
            ? "Experimental Codex-like OpenAI account chat is connected through the local runtime. This private-endpoint path is high-risk, not official public OAuth support, and not production-ready."
            : activeModelError
              ? "Runtime model refresh failed. Refresh runtime again before sending the first GPT message."
              : "Provider required: choose OpenAI API for the API-key fallback or configure a local OpenAI-compatible /v1 provider with a model before sending the first GPT message.";
  const chatModelStatus = apiKeyReadiness.model ? modelStatusText(apiKeyReadiness.model, apiKeyReadiness.provider) : null;
  const providerAuthPendingState = useMemo(() => parseProviderAuthState(activeProviderAuthStatus), [activeProviderAuthStatus]);
  const currentAttachedContext = attachedContext?.settingsRevision === settingsRevision && attachedContext.chatId === chatId ? attachedContext.payload : null;

  const addTimeline = useCallback((entry: string) => {
    setTimeline((current) => [entry, ...current].slice(0, 80));
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
    settingsRevisionRef.current += 1;
    providerTestAttemptRef.current += 1;
    setSettingsRevision(settingsRevisionRef.current);
    setRuntimeDataRevision(null);
    setProviderDataRevision(null);
    setProviderAuthDataRevision(null);
    setChatHistoryRevision(null);
    setChatSummaries([]);
    setChatHistoryError(null);
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
    setAttachedContextStatus(null);
  }, [abortActiveStream]);

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
    updateRuntimeSettings({ ...settingsRef.current, baseUrl: nextBaseUrl });
  }, [updateRuntimeSettings]);

  const updateToken = useCallback((nextToken: string) => {
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
    updateRuntimeSettings({ baseUrl: hostRuntimeUrl, token: nextToken });
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
        setIncludeAttachedContext(hasUsableAttachedContext(nextContext));
        setAttachedContextStatus(null);
      } else if (message.type === "host.applyWorkspaceEditResult") {
        setApplyResult({ requestId: message.requestId ?? "unknown", payload: message.payload as ApplyWorkspaceEditResultPayload });
      }
    });
    return () => {
      bridgeAdapterRef.current = null;
      adapter.dispose();
    };
  }, [applyHostReady]);

  const appendChatError = useCallback((message: string) => {
    setChatView((current) => applyChatViewEvent(current, {
      seq: 0,
      type: "error",
      chatId: current.chatId,
      payload: { message },
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
      setAttachedContextStatus(`Context attached to the last accepted message from ${attachedContextSummary(submittedContext.payload)}.`);
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
      const [nextPing, nextCaps, nextModels] = await Promise.all([
        getPing(targetSettings),
        getCaps(targetSettings),
        getModels(targetSettings),
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
      setIdentityWarnings(warnings);
      setRuntimeDataRevision(revision);
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
      setIdentityWarnings([]);
      setConnectionError(runtimeError);
      setModelError(runtimeError);
      setRuntimeDataRevision(revision);
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
      const currentChat = chatIdRef.current;
      if (summaries.length > 0 && !summaries.some((summary) => summary.chatId === currentChat)) {
        setChatId(summaries[0].chatId);
      }
      if (summaries.length === 0 && currentChat !== "chat-001") {
        setChatId("chat-001");
      }
    } else {
      setChatSummaries([]);
      setChatHistoryError(result.error);
      setChatHistoryRevision(revision);
    }
    setChatHistoryLoading(false);
  }, [isCurrentRefresh]);

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
      setChatId(result.data.chatId);
      setChatView(hydrateChatViewFromThread(resetChatViewState(result.data.chatId), result.data));
      setTimeline([]);
      setAttachedContext(null);
      setIncludeAttachedContext(false);
      setAttachedContextStatus(null);
    } else {
      setChatHistoryError(result.error);
      setChatHistoryRevision(targetRevision);
    }
    setChatHistoryLoading(false);
  }, [abortActiveStream, isCurrentRefresh]);

  const selectChat = useCallback((nextChatId: string) => {
    if (nextChatId === chatIdRef.current) {
      return;
    }
    abortActiveStream("SSE stopped and abort requested before switching chats");
    setChatInput("");
    setChatId(nextChatId);
    setChatView(resetChatViewState(nextChatId));
    void loadChatThread(nextChatId);
  }, [abortActiveStream, loadChatThread]);

  const deleteCurrentChat = useCallback(async (targetChatId: string) => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = chatHistoryAttemptRef.current + 1;
    chatHistoryAttemptRef.current = attempt;
    if (chatIdRef.current === targetChatId) {
      abortActiveStream("SSE stopped and abort requested before deleting the current chat");
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
      const remaining = chatSummaries.filter((summary) => summary.chatId !== targetChatId);
      setChatSummaries(remaining);
      setChatHistoryRevision(targetRevision);
      if (chatIdRef.current === targetChatId) {
        const deletedIndex = chatSummaries.findIndex((summary) => summary.chatId === targetChatId);
        const nextChatId = remaining[Math.max(0, Math.min(deletedIndex, remaining.length - 1))]?.chatId ?? "chat-001";
        setChatId(nextChatId);
        setChatView(resetChatViewState(nextChatId));
        setChatInput("");
        setTimeline([]);
        setAttachedContext(null);
        setIncludeAttachedContext(false);
        setAttachedContextStatus(null);
      }
    } else {
      setChatHistoryError(result.error);
      setChatHistoryRevision(targetRevision);
    }
    setDeletingChatId(null);
    setChatHistoryLoading(false);
  }, [abortActiveStream, chatSummaries, isCurrentRefresh]);

  const connect = useCallback(async () => {
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
  }, [refreshChats, refreshProviderAuthStatus, refreshProviders, refreshRuntime]);

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
    if (activeChatSummary) {
      void loadChatThread(chatId);
    }
  }, [abortActiveStream, activeChatSummary?.chatId, chatId, loadChatThread]);

  useEffect(() => () => {
    abortActiveStream("SSE stopped and abort requested on cleanup", { finalizeStreaming: false, addTimelineEntry: false, reportAbortErrors: false });
  }, [abortActiveStream]);

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
          addTimeline(sanitizeTimelineText(`${event.seq} ${event.type}\n${JSON.stringify(safeEvent.payload ?? {}, null, 2)}`));
        },
        onError: (error) => {
          const activeStream = activeStreamRef.current;
          if (activeStream !== stream || stream.revision !== settingsRevisionRef.current) {
            return;
          }
          setChatError(error);
          appendChatError(error.message);
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

  const submitEditProposal = useCallback(() => {
    if (!editProposal || bridgeHost === "browser") {
      return;
    }
    bridgeAdapterRef.current?.post({
      version: "2026-05-15",
      type: "gui.applyWorkspaceEditRequest",
      requestId: editProposal.requestId,
      payload: editProposal.payload,
    });
    setApplyResult(null);
    addTimeline(`Edit proposal apply requested ${editProposal.requestId}`);
  }, [addTimeline, bridgeHost, editProposal]);

  useEffect(() => {
    const proposal = latestEditProposalFromMessages(chatView.messages, editProposalCounterRef);
    setEditProposal((current) => proposal && (!current || current.requestId !== proposal.requestId || current.payload.summary !== proposal.payload.summary) ? proposal : current);
  }, [chatView.messages]);

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
        message: "Chat is not ready for the current runtime settings. Refresh runtime and configure a provider before sending.",
      };
      setChatError(runtimeError);
      appendChatError(runtimeError.message);
      addTimeline("Command blocked until current runtime settings are ready");
      return;
    }
    const submittedAttachedContext = includeAttachedContext && attachedContextRef.current?.settingsRevision === targetRevision && attachedContextRef.current.chatId === targetChatId && currentAttachedContext && hasUsableAttachedContext(currentAttachedContext) ? attachedContextRef.current : null;
    const context = submittedAttachedContext?.payload;
    startSse(targetChatId);
    const result = await sendUserMessage(targetSettings, targetChatId, content, context);
    if (!isCurrentRefresh(targetRevision) || chatIdRef.current !== targetChatId) {
      return;
    }
    if (result.ok) {
      addTimeline(`Command accepted ${result.data.requestId}`);
      setChatView((current) => addAcceptedUserMessage(current, content));
      setChatInput("");
      clearSubmittedAttachedContext(submittedAttachedContext);
    } else {
      setChatError(result.error);
      appendChatError(result.error.message);
      addTimeline(`Command error: ${sanitizeDisplayText(result.error.message)}`);
    }
  };

  const firstMessageReadiness = useMemo<FirstMessageReadiness>(() => {
    const notes = [
      "Session token unlocks this GUI to the local runtime only; Provider API key unlocks the upstream model through the runtime.",
      "Provider setup stays local-first BYOK: no Yet AI hosted backend, account, cloud workspace, or credit balance is required.",
    ];
    const authStatus = activeProviderAuthStatus?.status;
    if (activeProviderAuthStatus?.configured && activeProviderAuthStatus.authSource === "oauth") {
      notes.push("Experimental account login is connected/available only as an explicit high-risk path; API-key providers remain the safe default when configured.");
    } else if (authStatus === "login_available") {
      notes.push("Account login may be available, but it is not the default first-message path; use an API-key provider unless you intentionally choose the experimental flow.");
    } else if (authStatus === "api_key_configured") {
      notes.push("API-key fallback status is available locally; configure or refresh an OpenAI-compatible provider/model if Send is still disabled.");
    }
    if (!runtimeConnected) {
      const reason = activeConnectionError
        ? `Runtime ${activeConnectionError.status}: ${sanitizeDisplayText(activeConnectionError.message)}`
        : runtimeRefreshStatus?.state === "checking"
          ? "Runtime check is in progress or has not completed for the current settings."
          : "Runtime has not been checked for the current settings.";
      return {
        title: activeConnectionError?.status === 401 ? "Runtime authorization needs attention" : "Connect the local runtime first",
        reason,
        nextAction: "Refresh runtime, then fix the loopback URL or Session token if the check fails.",
        actions: [{ kind: "refresh_runtime", label: runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime" }],
        notes,
      };
    }
    if (apiKeyChatReady) {
      return {
        title: "Ready for your first message",
        reason: `Send is enabled for ${selectedModelDisplayName ?? "the selected model"}${selectedModelProviderId ? ` through ${selectedModelProviderId}` : ""}.`,
        nextAction: "Type a prompt and send it through the local runtime.",
        actions: [{ kind: "send_first_message", label: "Send first message" }],
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
      nextAction: "Use the OpenAI API key fallback or configure a local OpenAI-compatible /v1 provider, save it, optionally test it, then refresh runtime.",
      actions: [{ kind: "api_key_fallback", label: "Use OpenAI API key fallback" }, { kind: "refresh_runtime", label: "Refresh runtime" }],
      notes,
    };
  }, [activeConnectionError, activeModelError, activeProviderAuthStatus, apiKeyChatReady, apiKeyReadiness, enabledProviders, experimentalOauthChatReady, providerAuthMutationInFlight, runtimeConnected, runtimeRefreshInFlight, runtimeRefreshStatus, selectedModelDisplayName, selectedModelProviderId]);

  return (
    <main className="app-shell">
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
          <div className="stack">
            <span>State: {chatReadinessLabel}</span>
            <span>{chatReadinessMessage}</span>
            {chatModelStatus && <span className="subtle">Model status: {chatModelStatus}</span>}
            {runtimeConnected && !canSendChat && <span className="subtle">For the quickest path, choose OpenAI API, paste a provider API key once, save, optionally test the provider, then send your first message. For local models, choose an OpenAI-compatible /v1 preset.</span>}
            {experimentalOauthChatReady && <span className="subtle">OpenAI API-key fallback remains the safe/default setup and will be preferred when configured.</span>}
            {!canSendChat && <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>}
          </div>
          <FirstMessageReadinessWizard
            readiness={firstMessageReadiness}
            canSendChat={canSendChat}
            runtimeRefreshInFlight={runtimeRefreshInFlight}
            providerTestState={providerTestState}
            onRefreshRuntime={() => void connect()}
            onApiKeyFallback={applyOpenAiApiPreset}
            onTestProvider={(providerId) => void runProviderTest(providerId)}
            onFocusPrompt={() => chatInputRef.current?.focus()}
          />
        </div>
        {chatError && <ErrorBox error={chatError} />}
        {chatHistoryError && <ErrorBox error={chatHistoryError} />}
        <div className="conversations-layout">
          <aside className="conversations-panel stack" aria-label="Local conversations">
            <div className="row">
              <h3>Conversations</h3>
              <button type="button" onClick={() => void createNewChat()} disabled={chatHistoryLoading}>{chatHistoryLoading ? "Loading…" : "New chat"}</button>
            </div>
            <span className="subtle">Engine-owned local history. Messages are not written to browser storage.</span>
            <div className="conversation-status" role="status">
              {chatHistoryLoading ? "Loading local conversations…" : chatHistoryCurrent ? `${activeChatSummaries.length} local conversation${activeChatSummaries.length === 1 ? "" : "s"}` : "Conversation history has not loaded yet."}
            </div>
            {activeChatSummaries.length === 0 ? (
              <p className="subtle">{chatHistoryLoading ? "Loading saved conversations from the local runtime…" : chatHistoryError ? "Conversation history is unavailable." : "No saved conversations yet. Start a new local chat or send a message in the current chat."}</p>
            ) : activeChatSummaries.map((summary, index) => {
              const active = summary.chatId === chatId;
              const deleting = deletingChatId === summary.chatId;
              return (
                <div className={`conversation-item ${active ? "active" : ""}`} key={summary.chatId}>
                  <button type="button" className="conversation-select" onClick={() => selectChat(summary.chatId)} disabled={deleting} aria-current={active ? "true" : undefined}>
                    <span className="conversation-title-row">
                      <strong>{sanitizeDisplayText(summary.title || "Untitled chat")}</strong>
                      {active && <span className="badge ok">current</span>}
                    </span>
                    <span>Updated {sanitizeDisplayText(summary.updatedAt)}</span>
                    <span>{summary.messageCount} persisted message{summary.messageCount === 1 ? "" : "s"}</span>
                    <span className="subtle">Conversation {index + 1} of {activeChatSummaries.length}</span>
                  </button>
                  <button type="button" className="danger-button" onClick={() => void deleteCurrentChat(summary.chatId)} disabled={deleting || chatHistoryLoading}>{deleting ? "Deleting…" : active ? "Delete current" : "Delete"}</button>
                </div>
              );
            })}
          </aside>
          <div className="stack">
            <div className="chat-title-card row">
              <div className="stack">
                <strong>{sanitizeDisplayText(activeChatSummary?.title ?? chatId)}</strong>
                <span className="subtle">{activeChatIndex >= 0 ? `Conversation ${activeChatIndex + 1} of ${activeChatSummaries.length} · ` : ""}{chatView.messages.length} visible message{chatView.messages.length === 1 ? "" : "s"} · {chatView.subscriptionReady ? "snapshot loaded" : activeChatSummary ? `${activeChatSummary.messageCount} persisted message${activeChatSummary.messageCount === 1 ? "" : "s"}` : "fresh local chat"}</span>
              </div>
              <span className="badge">{sanitizeDisplayText(chatId)}</span>
            </div>
            <div className="form-grid">
              <label>
                Chat id
                <input value={chatId} onChange={(event) => setChatId(event.target.value)} />
              </label>
            </div>
            <div className="chat-panel" aria-label="Chat messages">
              {chatView.messages.length === 0 ? <ChatEmptyState runtimeConnected={runtimeConnected} canSendChat={canSendChat} providerReady={apiKeyChatReady || experimentalOauthChatReady} context={currentAttachedContext} hasLocalConversations={activeChatSummaries.length > 0} onProviderSetup={applyOpenAiApiPreset} onRefreshRuntime={() => void connect()} /> : chatView.messages.map((message) => <ChatBubble key={message.id} message={message} />)}
              {chatView.messages.some((message) => message.role === "assistant" && message.status === "streaming") && <span className="subtle">Assistant is streaming…</span>}
            </div>
            <EditProposalPanel proposal={editProposal} result={applyResult} host={bridgeHost} onApply={submitEditProposal} />
            <form className="stack chat-composer" onSubmit={(event) => void submitChat(event)}>
              <AttachedContextPreview context={currentAttachedContext} include={includeAttachedContext} status={attachedContextStatus} onIncludeChange={setIncludeAttachedContext} />
              <textarea ref={chatInputRef} value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={canSendChat ? "Ask about the current file, selection, or project..." : "Connect the runtime and configure a provider to start chatting..."} />
              <div className="row chat-actions">
                <button type="submit" disabled={!canSendChat}>Send</button>
                <button type="button" className="secondary-button" onClick={stopSse}>Stop SSE</button>
              </div>
            </form>
            <details className="debug-details">
              <summary>SSE debug details</summary>
          <div className="timeline">
            {timeline.length === 0 ? <span>No SSE events yet.</span> : timeline.map((entry, index) => <div className="timeline-entry" key={`${index}:${entry}`}>{entry}</div>)}
          </div>
        </details>
          </div>
        </div>
      </section>


      <section className="card stack secondary-card runtime-card">
        <h2>Local runtime connection</h2>
        <div className="form-grid">
          <label>
            Runtime base URL
            <input value={baseUrl} onChange={(event) => updateBaseUrl(event.target.value)} />
          </label>
          <label>
            Session token
            <input type="password" value={token} onChange={(event) => updateToken(event.target.value)} placeholder="Bearer token for local runtime" autoComplete="off" />
          </label>
        </div>
        <p className="subtle">In VS Code or JetBrains, the local runtime Session token is normally supplied automatically by the IDE host through trusted host.ready. Paste a token only when connecting to a manually started runtime such as one launched with YET_AI_AUTH_TOKEN=.... This local runtime token authorizes the GUI to the loopback runtime; it is not an OpenAI key or provider API key.</p>
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
      </section>

      <section className="card stack secondary-card agent-progress-card" aria-label="Agent progress">
        <div className="row">
          <h2>Agent progress</h2>
          <button type="button" onClick={() => void refreshAgentProgress()} disabled={agentProgress.state === "loading"}>{agentProgress.state === "loading" ? "Loading agent progress…" : "Refresh agent progress"}</button>
        </div>
        <p className="subtle">Read-only local observability only. This panel does not start agents, run tools, merge git, edit files, execute shell, call providers, or mutate the workspace.</p>
        <AgentProgressPanel progress={agentProgress} />
      </section>

      <section className="card stack secondary-card provider-setup-card">
        <h2>Provider setup</h2>
        {runtimeConnected && !apiKeyChatReady && !experimentalOauthChatReady && (
          <div className="guided-setup-card stack" role="status">
            <strong>Runtime connected — provider required for your first GPT message</strong>
            <span>Choose OpenAI API to paste an API key once, or configure a local OpenAI-compatible /v1 provider such as LM Studio, LocalAI, or Ollama. No hosted Yet AI account, cloud workspace, or credit balance is required.</span>
            <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>
          </div>
        )}
        <p className="subtle">Provider requests go to the local runtime. A provider API key is sent to the local runtime only, cleared from this form after save, never written to browser storage, and is distinct from the runtime Session token.</p>
        <p className="subtle">ChatGPT/OpenAI account login is planned where officially supported. OpenAI API-key setup is the current safe fallback.</p>
        <p className="subtle">Current chat uses OpenAI-compatible providers only. Ollama is available here through its OpenAI-compatible /v1 endpoint; native Ollama chat is future work.</p>
        {providerError && <ErrorBox error={providerError} />}
        <div className="provider-item account-login-card stack">
          <div className="row">
            <h3>OpenAI account login</h3>
            <span className={activeProviderAuthStatus?.configured ? "badge ok" : "badge warn"}>{activeProviderAuthStatus?.status ?? "not checked"}</span>
          </div>
          <p className="subtle">Account login is guided by the local runtime only. The GUI opens safe authorization URLs, renders sanitized account status, and does not store provider auth state in browser storage.</p>
          <div className="risk-card stack">
            <strong>Experimental Codex-like account login risk</strong>
            <span>This OpenAI account path is high-risk and private-endpoint-style. It is not official public OpenAI OAuth support, not production-ready, and must not replace the safe API-key fallback.</span>
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
              <span className="subtle">Presets only fill provider fields. They never include API keys and do not contact providers from the GUI.</span>
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
                {providerTestState?.providerId === provider.id && <div className={`provider-test-status ${providerTestState.state}`} role="status"><strong>{providerTestState.state === "testing" ? "Provider test running" : providerTestState.state === "success" ? "Provider test succeeded" : "Provider test failed"}</strong><span>{providerTestState.status}: {providerTestState.detail}</span>{providerTestState.state === "failed" && <span>{providerTestAction(providerTestState.status)}</span>}</div>}
                <div className="row">
                  <button type="button" onClick={() => editProvider(provider)}>Edit</button>
                  <button type="button" onClick={() => void runProviderTest(provider.id)} disabled={providerTestState?.providerId === provider.id && providerTestState.state === "testing"}>{providerTestState?.providerId === provider.id && providerTestState.state === "testing" ? "Testing provider…" : "Test provider"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      <section className="card stack secondary-card debug-card">
        <details className="debug-details">
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

type ProviderModelReadiness = {
  ready: boolean;
  mismatch: boolean;
  model?: ModelSummary;
  provider?: ProviderSummary;
  message?: string;
};

function resolveProviderModelReadiness(models: ModelSummary[], enabledProviders: ProviderSummary[], modelError: RuntimeError | null): ProviderModelReadiness {
  if (modelError) {
    return { ready: false, mismatch: false };
  }
  const firstRuntimeModel = models[0];
  if (firstRuntimeModel) {
    const modelId = firstRuntimeModel.id.trim();
    if (!modelId) {
      return { ready: false, mismatch: true, model: firstRuntimeModel, message: modelProviderMismatchMessage(firstRuntimeModel) };
    }
    const provider = resolveRuntimeModelProvider(firstRuntimeModel, enabledProviders);
    if (!provider || !provider.models.some((model) => model.id.trim() === modelId)) {
      return { ready: false, mismatch: true, model: firstRuntimeModel, provider, message: modelProviderMismatchMessage(firstRuntimeModel, provider) };
    }
    return modelReadinessResult(firstRuntimeModel, provider);
  }
  const provider = enabledProviders.find((item) => item.models.some((model) => model.id.trim()));
  const model = provider?.models.find((item) => item.id.trim());
  if (!provider || !model) {
    return { ready: false, mismatch: false };
  }
  return modelReadinessResult({ ...model, providerId: model.providerId ?? provider.id }, provider);
}

function modelReadinessResult(model: ModelSummary, provider: ProviderSummary): ProviderModelReadiness {
  const missingMessage = missingModelMetadataMessage(model);
  if (missingMessage) {
    return { ready: false, mismatch: false, model, provider, message: missingMessage };
  }
  if (model.readiness?.status !== "ready") {
    return { ready: false, mismatch: false, model, provider, message: modelUnreadyMessage(model) };
  }
  if (!model.capabilities?.chat || !model.capabilities.streaming) {
    return { ready: false, mismatch: false, model, provider, message: modelUnsupportedMessage(model) };
  }
  return { ready: true, mismatch: false, model, provider };
}

function missingModelMetadataMessage(model: ModelSummary): string | undefined {
  if (!model.capabilities || !model.readiness) {
    return `Model ${sanitizeDisplayText(model.displayName || model.id || "selected model")} is missing readiness metadata from the runtime. Refresh the runtime after updating it before sending.`;
  }
  return undefined;
}

function modelUnreadyMessage(model: ModelSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const status = sanitizeDisplayText(readinessStatusLabel(model.readiness?.status));
  const reason = model.readiness?.reason ? ` ${sanitizeDisplayText(model.readiness.reason)}` : "";
  return `Model ${modelName} is not ready for chat streaming: ${status}.${reason}`;
}

function modelUnsupportedMessage(model: ModelSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const support = modelCapabilitySummary(model);
  return `Model ${modelName} cannot send chat because required capabilities are unavailable: ${support}.`;
}

function resolveRuntimeModelProvider(model: ModelSummary, enabledProviders: ProviderSummary[]): ProviderSummary | undefined {
  const providerId = model.providerId?.trim();
  if (providerId) {
    return enabledProviders.find((provider) => provider.id === providerId);
  }
  const matchingProviders = enabledProviders.filter((provider) => provider.models.some((providerModel) => providerModel.id.trim() === model.id.trim()));
  return matchingProviders.length === 1 ? matchingProviders[0] : undefined;
}

function modelStatusText(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const providerName = provider ? sanitizeDisplayText(provider.displayName || provider.id) : model.providerId ? sanitizeDisplayText(model.providerId) : undefined;
  const providerText = providerName ? ` (${providerName})` : "";
  if (!model.capabilities || !model.readiness) {
    return `${modelName}${providerText}: readiness metadata missing`;
  }
  const reason = model.readiness.reason ? `, ${sanitizeDisplayText(model.readiness.reason)}` : "";
  return `${modelName}${providerText}: ${sanitizeDisplayText(readinessStatusLabel(model.readiness.status))}${reason}; ${modelCapabilitySummary(model)}`;
}

function modelCapabilitySummary(model: ModelSummary): string {
  if (!model.capabilities) {
    return "capabilities missing";
  }
  return `chat ${capabilityLabel(model.capabilities.chat)}, streaming ${capabilityLabel(model.capabilities.streaming)}, tools ${capabilityLabel(model.capabilities.tools)}, reasoning ${capabilityLabel(model.capabilities.reasoning)}`;
}

function capabilityLabel(value: boolean): string {
  return value ? "supported" : "unsupported";
}

function readinessStatusLabel(status: NonNullable<ModelSummary["readiness"]>["status"] | undefined): string {
  switch (status) {
    case "ready":
      return "ready";
    case "disabled":
      return "disabled";
    case "missing_credentials":
      return "missing credentials";
    case "missing_model":
      return "missing model";
    case "unsupported":
      return "unsupported";
    default:
      return "unknown readiness";
  }
}

function modelProviderMismatchMessage(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const providerName = provider ? sanitizeDisplayText(provider.displayName || provider.id) : model.providerId ? sanitizeDisplayText(model.providerId) : undefined;
  const detail = providerName ? ` Model ${modelName} is not available on enabled provider ${providerName}.` : ` Model ${modelName} does not map to exactly one enabled provider.`;
  return `Runtime model/provider mismatch. Refresh runtime or test/save provider before sending.${detail}`;
}

function hasUsableAttachedContext(context: HostContextSnapshotPayload): boolean {
  return Boolean(context.file?.displayPath || context.file?.workspaceRelativePath || context.file?.languageId || context.selection?.text?.trim() || formatSelectionRange(context.selection) !== "unknown range");
}

function attachedContextSummary(context: HostContextSnapshotPayload): string {
  return `${sanitizeDisplayText(context.source)} ${sanitizeDisplayText(context.file?.workspaceRelativePath ?? context.file?.displayPath ?? "active editor")}`;
}

function attachedContextFileLabel(context: HostContextSnapshotPayload): string {
  const displayPath = context.file?.displayPath;
  const workspacePath = context.file?.workspaceRelativePath;
  if (displayPath && workspacePath && displayPath !== workspacePath) {
    return `${sanitizeDisplayText(displayPath)} (${sanitizeDisplayText(workspacePath)})`;
  }
  return sanitizeDisplayText(displayPath ?? workspacePath ?? "Untitled editor");
}

function boundedContextPreview(text: string): string {
  if (!text.trim()) {
    return "No selected text preview.";
  }
  const limit = 360;
  const bounded = text.length > limit ? `${text.slice(0, limit)}…` : text;
  return sanitizeDisplayText(bounded);
}

function boundedReplacementPreview(text: string): string {
  if (!text) {
    return "Empty replacement text.";
  }
  const limit = 320;
  return sanitizeDisplayText(text.length > limit ? `${text.slice(0, limit)}…` : text);
}

function formatEditRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function latestEditProposalFromMessages(messages: ChatViewMessage[], counterRef: { current: number }): EditProposalState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") {
      continue;
    }
    const payload = extractEditProposal(messages[index].content);
    if (payload) {
      counterRef.current += 1;
      return { requestId: `gui-edit-proposal-${counterRef.current}`, payload };
    }
  }
  return null;
}

function extractEditProposal(content: string): ApplyWorkspaceEditPayload | null {
  const parsed = parseFirstJsonObject(content);
  if (!parsed) {
    return null;
  }
  const candidate = asRecord(parsed)?.type === "gui.applyWorkspaceEditRequest" ? asRecord(parsed)?.payload : parsed;
  return isApplyWorkspaceEditPayload(candidate) ? candidate : null;
}

function parseFirstJsonObject(content: string): unknown | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start || end - start > 50000) {
    return null;
  }
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

function formatSelectionRange(selection: HostContextSnapshotPayload["selection"]): string {
  if (!selection) {
    return "unknown range";
  }
  const hasStart = selection.startLine !== undefined && selection.startCharacter !== undefined;
  const hasEnd = selection.endLine !== undefined && selection.endCharacter !== undefined;
  if (hasStart && hasEnd) {
    return `${selection.startLine}:${selection.startCharacter}-${selection.endLine}:${selection.endCharacter}`;
  }
  if (hasStart) {
    return `${selection.startLine}:${selection.startCharacter}`;
  }
  return "unknown range";
}

function ChatEmptyState({ runtimeConnected, canSendChat, providerReady, context, hasLocalConversations, onProviderSetup, onRefreshRuntime }: { runtimeConnected: boolean; canSendChat: boolean; providerReady: boolean; context: HostContextSnapshotPayload | null; hasLocalConversations: boolean; onProviderSetup: () => void; onRefreshRuntime: () => void }) {
  if (!runtimeConnected) {
    return (
      <div className="chat-empty-state" role="status">
        <strong>Connect the local runtime to start chatting.</strong>
        <span>Refresh the loopback runtime connection or start the IDE-managed runtime. No hosted Yet AI backend, account, cloud workspace, or credit balance is required.</span>
        <button type="button" onClick={onRefreshRuntime}>Refresh runtime</button>
      </div>
    );
  }
  if (!providerReady) {
    return (
      <div className="chat-empty-state" role="status">
        <strong>Configure a provider or model before sending.</strong>
        <span>Use the OpenAI API-key fallback or a local OpenAI-compatible /v1 server. Provider credentials stay local to the runtime and are not stored by the GUI.</span>
        <button type="button" onClick={onProviderSetup}>Use OpenAI API key fallback</button>
      </div>
    );
  }
  if (context && hasUsableAttachedContext(context)) {
    const fileLabel = sanitizeDisplayText(context.file?.displayPath ?? context.file?.workspaceRelativePath ?? "the active editor");
    return (
      <div className="chat-empty-state ready" role="status">
        <strong>Ready to ask about {fileLabel}.</strong>
        <span>Send a question about the attached file or selection, or turn off attached context before sending.</span>
      </div>
    );
  }
  return (
    <div className="chat-empty-state ready" role="status">
      <strong>{hasLocalConversations ? "This local conversation is empty." : "Ready for your first local conversation."}</strong>
      <span>Ask about code, architecture, tests, or the current task. Local conversation history is owned by the engine, not browser storage.</span>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatViewMessage }) {
  return (
    <div className={`chat-bubble ${message.role}`}>
      <strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Yet AI" : "Error"}</strong>
      <span>{message.content || (message.status === "streaming" ? "…" : "")}</span>
    </div>
  );
}

function EditProposalPanel({ proposal, result, host, onApply }: { proposal: EditProposalState | null; result: ApplyResultState | null; host: BridgeHost; onApply: () => void }) {
  if (!proposal && !result) {
    return null;
  }
  return (
    <section className="edit-proposal-card stack" aria-label="Edit proposal preview">
      <div className="row">
        <strong>Confirmed edit proposal</strong>
        <span className="badge warn">preview only</span>
      </div>
      {proposal ? <EditProposalPreview proposal={proposal} host={host} onApply={onApply} /> : <span className="subtle">No valid bounded edit proposal is available.</span>}
      {result && <ApplyResultPreview result={result} />}
    </section>
  );
}

function EditProposalPreview({ proposal, host, onApply }: { proposal: EditProposalState; host: BridgeHost; onApply: () => void }) {
  const files = proposal.payload.edits;
  const editCount = files.reduce((count, file) => count + file.textReplacements.length, 0);
  return (
    <div className="stack">
      <span>{sanitizeDisplayText(proposal.payload.summary)}</span>
      <div className="edit-proposal-grid">
        <span>Request: {sanitizeDisplayText(proposal.requestId)}</span>
        <span>Files: {files.length}</span>
        <span>Text edits: {editCount}</span>
        <span>Cloud required: false</span>
      </div>
      <div className="stack">
        {files.map((file) => (
          <article className="edit-file-card stack" key={file.workspaceRelativePath}>
            <strong>{sanitizeDisplayText(file.workspaceRelativePath)}</strong>
            <span>{file.textReplacements.length} replacement{file.textReplacements.length === 1 ? "" : "s"}</span>
            {file.textReplacements.slice(0, 4).map((replacement, index) => (
              <div className="edit-replacement-preview" key={`${file.workspaceRelativePath}:${index}`}>
                <span>Range {formatEditRange(replacement.range)} · replacement characters {replacement.replacementText.length}</span>
                <pre>{boundedReplacementPreview(replacement.replacementText)}</pre>
              </div>
            ))}
            {file.textReplacements.length > 4 && <span className="subtle">{file.textReplacements.length - 4} more replacements hidden.</span>}
          </article>
        ))}
      </div>
      {host === "browser" ? (
        <div className="readiness-card warn" role="status">Browser preview mode cannot apply workspace edits. Open this GUI from VS Code or JetBrains, then review and confirm there.</div>
      ) : (
        <button type="button" onClick={onApply}>Request host apply after review</button>
      )}
      <span className="subtle">The GUI never edits files directly. The host must confirm and apply any workspace mutation.</span>
    </div>
  );
}

function ApplyResultPreview({ result }: { result: ApplyResultState }) {
  return (
    <div className={`apply-result-card ${result.payload.status}`} role="status">
      <strong>Host apply result: {sanitizeDisplayText(result.payload.status)}</strong>
      <span>{sanitizeDisplayText(result.payload.message)}</span>
      <span>Request: {sanitizeDisplayText(result.requestId)} · applied edits: {result.payload.appliedEditCount ?? 0} · cloud required: false</span>
      {result.payload.affectedFiles && result.payload.affectedFiles.length > 0 && <span>Affected files: {result.payload.affectedFiles.map((file) => sanitizeDisplayText(file)).join(", ")}</span>}
    </div>
  );
}

function FirstMessageReadinessWizard({ readiness, canSendChat, runtimeRefreshInFlight, providerTestState, onRefreshRuntime, onApiKeyFallback, onTestProvider, onFocusPrompt }: {
  readiness: FirstMessageReadiness;
  canSendChat: boolean;
  runtimeRefreshInFlight: boolean;
  providerTestState: ProviderTestState | null;
  onRefreshRuntime: () => void;
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
        {readiness.actions.map((action) => <FirstMessageActionButton key={`${action.kind}:${"providerId" in action ? action.providerId : action.label}`} action={action} runtimeRefreshInFlight={runtimeRefreshInFlight} providerTestState={providerTestState} onRefreshRuntime={onRefreshRuntime} onApiKeyFallback={onApiKeyFallback} onTestProvider={onTestProvider} onFocusPrompt={onFocusPrompt} />)}
      </div>
      <ol className="first-message-steps">
        {readiness.notes.map((note) => <li key={note}>{note}</li>)}
      </ol>
    </div>
  );
}

function FirstMessageActionButton({ action, runtimeRefreshInFlight, providerTestState, onRefreshRuntime, onApiKeyFallback, onTestProvider, onFocusPrompt }: {
  action: FirstMessageAction;
  runtimeRefreshInFlight: boolean;
  providerTestState: ProviderTestState | null;
  onRefreshRuntime: () => void;
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
  if (action.kind === "test_provider") {
    const testing = providerTestState?.providerId === action.providerId && providerTestState.state === "testing";
    return <button type="button" onClick={() => onTestProvider(action.providerId)} disabled={testing}>{testing ? "Testing provider…" : action.label}</button>;
  }
  return <button type="button" onClick={onFocusPrompt}>{action.label}</button>;
}

function AttachedContextPreview({ context, include, status, onIncludeChange }: { context: HostContextSnapshotPayload | null; include: boolean; status: string | null; onIncludeChange: (include: boolean) => void }) {
  if (!context || !hasUsableAttachedContext(context)) {
    return (
      <div className="readiness-card warn" role="status">
        <div className="stack">
          <strong>Attached context</strong>
          {status && <span>{sanitizeDisplayText(status)}</span>}
          <span className="subtle">No valid active editor context is attached. Nothing will be included with the next message.</span>
        </div>
      </div>
    );
  }
  const fileLabel = attachedContextFileLabel(context);
  const language = context.file?.languageId ? sanitizeDisplayText(context.file.languageId) : "unknown language";
  const range = formatSelectionRange(context.selection);
  const text = context.selection?.text ?? "";
  const preview = boundedContextPreview(text);
  return (
    <div className="readiness-card ready attached-context-card" role="status">
      <div className="stack">
        <div className="row">
          <strong>Active editor context</strong>
          <span className="badge ok">{sanitizeDisplayText(context.source)}</span>
          <span className={include ? "badge ok" : "badge warn"}>{include ? "Attach to next message" : "Do not attach"}</span>
        </div>
        <div className="attached-context-grid">
          <span>Source host: {sanitizeDisplayText(context.source)}</span>
          <span>File: {fileLabel}</span>
          <span>Language: {language}</span>
          <span>Selection range: {range}</span>
          <span>Selected characters: {text.length}</span>
        </div>
        <div className="attached-context-preview">
          <strong>Bounded preview</strong>
          <pre>{preview}</pre>
        </div>
        <span className="subtle">Context stays in React state only. It is one-shot and is attached only to the next accepted message while enabled.</span>
        <label className="row attached-context-toggle">
          <input style={{ width: "auto" }} type="checkbox" checked={include} onChange={(event) => onIncludeChange(event.target.checked)} />
          {include ? "Attach to next message" : "Do not attach"}
        </label>
      </div>
    </div>
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
        {(status.status === "login_available" || status.status === "not_configured") && <button type="button" onClick={onLogin} disabled={!canLogin}>Login with OpenAI</button>}
        {status.status === "login_unavailable" && <button type="button" onClick={onLogin} disabled>Login with OpenAI</button>}
        {(status.status === "pending" || status.status === "expired" || status.status === "revoked" || status.status === "error") && <button type="button" onClick={onLogin} disabled={!canLogin}>{reconnectLabel}</button>}
        {status.status !== "connected" && <button type="button" className="danger-button" onClick={onExperimentalLogin}>Experimental Login with OpenAI account</button>}
        {status.status === "connected" && <button type="button" className="danger-button" onClick={onExperimentalLogin}>Reconnect experimental account</button>}
        <button type="button" onClick={onDisconnect} disabled={!canDisconnect}>{status.status === "pending" ? "Cancel or disconnect login" : "Disconnect login"}</button>
        <button type="button" onClick={onApiKeyFallback}>Use OpenAI API key fallback</button>
      </div>
    </div>
  );
}

function ProviderAuthStateBody({ status }: { status: ProviderAuthResponse }) {
  if (status.status === "login_unavailable") {
    return <span className="subtle">Account login is unavailable in this runtime. Use the OpenAI API-key fallback: create an API key in the provider console, paste it once below, save, and the GUI clears it from the form.</span>;
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
        <span className="subtle">Raw tokens, cookies, auth codes, and runtime Session token values are not shown here.</span>
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
