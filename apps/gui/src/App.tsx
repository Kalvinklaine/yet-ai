import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBridgeAdapter, type BridgeHost, type HostReadyPayload } from "./bridge/bridgeAdapter";
import { addAcceptedUserMessage, applyChatViewEvent, createInitialChatViewState, resetChatViewState, stopStreamingAssistant, type ChatViewMessage } from "./services/chatViewState";
import { disconnectProviderAuth, exchangeProviderAuth, getProviderAuthStatus, startProviderAuth, type ProviderAuthResponse, type ProviderAuthStatus } from "./services/providerAuthClient";
import { listProviders, saveProvider, type ProviderSummary, type ProviderWriteRequest } from "./services/providersClient";
import { getCaps, getModels, getPing, isLoopbackRuntimeUrl, productIdentity, productIdentityWarning, sendAbort, type CapsResponse, type ModelSummary, type PingResponse, type RuntimeError, type RuntimeSettings, sendUserMessage } from "./services/runtimeClient";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./services/redaction";
import { subscribeToChat, type SseEvent } from "./services/sseClient";

const defaultBaseUrl = "http://127.0.0.1:8001";
const productName = productIdentity.displayName;

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
  const [chatInput, setChatInput] = useState("");
  const [chatView, setChatView] = useState(() => createInitialChatViewState("chat-001"));
  const [timeline, setTimeline] = useState<string[]>([]);
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);
  const [bridgeHost, setBridgeHost] = useState<BridgeHost>("browser");
  const [runtimeRefreshStatus, setRuntimeRefreshStatus] = useState<{ state: "checking" | "connected" | "failed"; attempt: number; checkedAt: string; detail: string } | null>(null);
  const [runtimeRefreshInFlight, setRuntimeRefreshInFlight] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const runtimeRefreshAttemptRef = useRef(0);
  const runtimeRefreshInFlightRef = useRef(false);
  const runtimeRefreshQueuedRef = useRef(false);
  const settingsRevisionRef = useRef(0);
  const settingsRef = useRef<RuntimeSettings>({ baseUrl: defaultBaseUrl, token: "" });
  const [runtimeDataRevision, setRuntimeDataRevision] = useState<number | null>(null);
  const [providerDataRevision, setProviderDataRevision] = useState<number | null>(null);
  const [providerAuthDataRevision, setProviderAuthDataRevision] = useState<number | null>(null);
  const activeStreamRef = useRef<ActiveStream | null>(null);

  const settings = useMemo<RuntimeSettings>(() => ({ baseUrl, token }), [baseUrl, token]);
  settingsRef.current = settings;
  const runtimeDataCurrent = runtimeDataRevision === settingsRevision;
  const providerDataCurrent = providerDataRevision === settingsRevision;
  const providerAuthDataCurrent = providerAuthDataRevision === settingsRevision;
  const activePing = runtimeDataCurrent ? ping : null;
  const activeCaps = runtimeDataCurrent ? caps : null;
  const activeModels = runtimeDataCurrent ? models : [];
  const activeConnectionError = runtimeDataCurrent ? connectionError : null;
  const activeModelError = runtimeDataCurrent ? modelError : null;
  const activeIdentityWarnings = runtimeDataCurrent ? identityWarnings : [];
  const activeProviders = providerDataCurrent ? providers : [];
  const activeProviderAuthStatus = providerAuthDataCurrent ? providerAuthStatus : null;
  const runtimeConnected = activePing?.ready === true && !activeConnectionError;
  const connectionStatus = activeConnectionError ? "error" : activePing?.ready ? "connected" : "not checked";
  const enabledProviders = useMemo(() => activeProviders.filter((provider) => provider.enabled), [activeProviders]);
  const selectedModel = useMemo(() => activeModels[0] ?? enabledProviders.flatMap((provider) => provider.models.map((model) => ({ ...model, providerId: model.providerId ?? provider.id })))[0], [enabledProviders, activeModels]);
  const apiKeyChatReady = runtimeConnected && !activeModelError && enabledProviders.length > 0 && Boolean(selectedModel);
  const experimentalOauthChatReady = runtimeConnected && !apiKeyChatReady && activeProviderAuthStatus?.configured === true && activeProviderAuthStatus.authSource === "oauth" && activeProviderAuthStatus.status === "connected";
  const canSendChat = apiKeyChatReady || experimentalOauthChatReady;
  const selectedModelDisplayName = selectedModel ? sanitizeDisplayText(selectedModel.displayName) : undefined;
  const selectedModelProviderId = selectedModel?.providerId ? sanitizeDisplayText(selectedModel.providerId) : undefined;
  const chatReadinessLabel = !runtimeConnected
    ? "Runtime unavailable"
    : apiKeyChatReady
      ? `${selectedModelDisplayName ?? "the default model"}${selectedModelProviderId ? ` (${selectedModelProviderId})` : ""}`
      : experimentalOauthChatReady
        ? "Experimental OpenAI account / gpt-5-codex"
        : "No model available";
  const chatReadinessMessage = !runtimeConnected
    ? "Runtime is not connected. Refresh runtime and fix the local runtime problem before sending the first GPT message."
    : apiKeyChatReady
      ? `Ready to send using ${selectedModelDisplayName ?? "the default model"}.`
      : experimentalOauthChatReady
        ? "Experimental Codex-like OpenAI account chat is connected through the local runtime. This private-endpoint path is high-risk, not official public OAuth support, and not production-ready."
        : activeModelError
          ? "Runtime model refresh failed. Refresh runtime again before sending the first GPT message."
          : "Configure an enabled OpenAI API key fallback provider with a model before sending the first GPT message.";
  const providerAuthPendingState = useMemo(() => parseProviderAuthState(activeProviderAuthStatus), [activeProviderAuthStatus]);

  const addTimeline = useCallback((entry: string) => {
    setTimeline((current) => [entry, ...current].slice(0, 80));
  }, []);

  const abortActiveStream = useCallback((timelineMessage: string, finalizeStreaming: boolean) => {
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
      if (!result.ok) {
        addTimeline(`Abort command error: ${sanitizeDisplayText(result.error.message)}`);
      }
    });
    addTimeline(timelineMessage);
    return activeStream;
  }, [addTimeline]);

  const markSettingsChanged = useCallback(() => {
    abortActiveStream("SSE stopped and abort requested for previous runtime settings", true);
    settingsRevisionRef.current += 1;
    setSettingsRevision(settingsRevisionRef.current);
    setRuntimeDataRevision(null);
    setProviderDataRevision(null);
    setProviderAuthDataRevision(null);
    setRuntimeRefreshStatus({
      state: "checking",
      attempt: runtimeRefreshAttemptRef.current + 1,
      checkedAt: new Date().toLocaleTimeString(),
      detail: "Runtime settings changed; checking current runtime…",
    });
    setProviderAuthExchangeCode("");
    setProviderAuthExchangeWorking(false);
    setProviderAuthExchangeError(null);
  }, [abortActiveStream]);

  const updateBaseUrl = useCallback((nextBaseUrl: string) => {
    if (settingsRef.current.baseUrl !== nextBaseUrl) {
      settingsRef.current = { ...settingsRef.current, baseUrl: nextBaseUrl };
      markSettingsChanged();
    }
    setBaseUrl(nextBaseUrl);
  }, [markSettingsChanged]);

  const updateToken = useCallback((nextToken: string) => {
    if (settingsRef.current.token !== nextToken) {
      settingsRef.current = { ...settingsRef.current, token: nextToken };
      markSettingsChanged();
    }
    setToken(nextToken);
  }, [markSettingsChanged]);

  const applyHostReady = useCallback((payload: HostReadyPayload | undefined) => {
    if (!payload?.runtimeUrl || !isLoopbackRuntimeUrl(payload.runtimeUrl)) {
      return;
    }
    const hostRuntimeUrl = payload.runtimeUrl;
    const currentBaseUrl = settingsRef.current.baseUrl;
    updateBaseUrl(hostRuntimeUrl);
    if (payload.sessionToken !== undefined) {
      updateToken(payload.sessionToken);
    } else if (normalizeRuntimeUrl(hostRuntimeUrl) !== normalizeRuntimeUrl(currentBaseUrl)) {
      updateToken("");
    }
    setTimeline((current) => ["Host runtime settings received", ...current].slice(0, 80));
  }, [updateBaseUrl, updateToken]);

  useEffect(() => {
    const adapter = createBridgeAdapter((entry) => setBridgeLog((current) => [entry, ...current].slice(0, 20)));
    setBridgeHost(adapter.host);
    adapter.subscribe((message) => {
      if (message.type === "host.ready") {
        applyHostReady(message.payload as HostReadyPayload | undefined);
      }
    });
    return () => adapter.dispose();
  }, [applyHostReady]);

  const appendChatError = useCallback((message: string) => {
    setChatView((current) => applyChatViewEvent(current, {
      seq: 0,
      type: "error",
      chatId: current.chatId,
      payload: { message },
    }));
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
      } while (runtimeRefreshQueuedRef.current);
    } finally {
      runtimeRefreshInFlightRef.current = false;
      runtimeRefreshQueuedRef.current = false;
      setRuntimeRefreshInFlight(false);
    }
  }, [refreshProviderAuthStatus, refreshProviders, refreshRuntime]);

  useEffect(() => {
    void connect();
  }, [connect, settings]);

  const submitProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProviderError(null);
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

  const startOpenAiLogin = async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    const result = await startProviderAuth(targetSettings, "openai");
    if (!isCurrentRefresh(targetRevision)) {
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
  };

  const startExperimentalOpenAiLogin = async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeCode("");
    const result = await startProviderAuth(targetSettings, "openai", { experimentalCodexLike: true });
    if (!isCurrentRefresh(targetRevision)) {
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
  };

  const disconnectOpenAiLogin = async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeCode("");
    const result = await disconnectProviderAuth(targetSettings, "openai");
    if (!isCurrentRefresh(targetRevision)) {
      return;
    }
    if (result.ok) {
      setProviderAuthStatus(result.data);
      setProviderAuthDataRevision(targetRevision);
      await connect();
    } else {
      setProviderAuthError(result.error);
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
    try {
      const result = await exchangeProviderAuth(targetSettings, "openai", sessionId, code, providerAuthPendingState.state);
      if (!isCurrentRefresh(targetRevision)) {
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
      setProviderAuthExchangeWorking(false);
    }
  };

  useEffect(() => {
    abortActiveStream("SSE stopped and abort requested for previous chat", true);
    setChatError(null);
    setChatView(resetChatViewState(chatId));
    setTimeline([]);
  }, [abortActiveStream, chatId]);

  useEffect(() => () => {
    abortActiveStream("SSE stopped and abort requested on cleanup", true);
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
    if (!abortActiveStream("SSE stopped and abort requested", true)) {
      addTimeline("SSE stopped");
    }
  };

  const submitChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content) {
      return;
    }
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
    startSse(chatId);
    const result = await sendUserMessage(settings, chatId, content);
    if (result.ok) {
      addTimeline(`Command accepted ${result.data.requestId}`);
      setChatView((current) => addAcceptedUserMessage(current, content));
      setChatInput("");
    } else {
      setChatError(result.error);
      appendChatError(result.error.message);
      addTimeline(`Command error: ${sanitizeDisplayText(result.error.message)}`);
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <span className="badge ok">local-first</span>
          <h1>{productName}</h1>
          <p className="subtle">Browser development shell for the local runtime. Cloud backend required = false.</p>
        </div>
        <div className="stack">
          <span className={`badge ${connectionStatus === "connected" ? "ok" : connectionStatus === "error" ? "warn" : ""}`}>
            runtime {connectionStatus}
          </span>
          <span className="badge">bridge {bridgeHost}</span>
        </div>
      </section>

      <section className="card stack">
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
        <p className="subtle">In VS Code or JetBrains, the local runtime session token is normally provided by the IDE host through host.ready. Paste a token only when connecting to a manually started runtime such as one launched with YET_AI_AUTH_TOKEN=.... This local runtime token is not an OpenAI key or provider API key.</p>
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

      <section className="card stack">
        <h2>Provider setup</h2>
        <p className="subtle">Provider requests go to the local runtime. API key input is cleared after submit and is not written to browser storage.</p>
        <p className="subtle">ChatGPT/OpenAI account login is planned where officially supported. OpenAI API-key setup is the current safe fallback.</p>
        <p className="subtle">Current chat uses OpenAI-compatible providers only. Ollama is available here through its OpenAI-compatible /v1 endpoint; native Ollama chat is future work.</p>
        {providerError && <ErrorBox error={providerError} />}
        <div className="provider-item stack">
          <div className="row">
            <h3>OpenAI account login</h3>
            <span className={activeProviderAuthStatus?.configured ? "badge ok" : "badge warn"}>{activeProviderAuthStatus?.status ?? "not checked"}</span>
          </div>
          <p className="subtle">Login-first setup is handled only by the local runtime. The GUI shows sanitized status and never stores provider auth state in browser storage.</p>
          <div className="risk-card stack">
            <strong>Experimental OpenAI account login</strong>
            <span>This Codex-like path is experimental and high-risk. It may rely on private OpenAI/Codex behavior, is not official public third-party OAuth support, and is not production-ready. Use it only if you explicitly accept that risk.</span>
          </div>
          {providerAuthError && <ErrorBox error={providerAuthError} />}
          {providerAuthUrlWarning && <div className="error">{providerAuthUrlWarning}</div>}
          {activeProviderAuthStatus && <ProviderAuthSummary status={activeProviderAuthStatus.status} />}
          {activeProviderAuthStatus?.supportsLogin === false && <p>OpenAI account login is planned/not available yet; use API key fallback.</p>}
          {activeProviderAuthStatus?.message && <span>{sanitizeDisplayText(activeProviderAuthStatus.message)}</span>}
          {activeProviderAuthStatus && <ProviderAuthDetails status={activeProviderAuthStatus} />}
          {activeProviderAuthStatus?.status === "pending" && activeProviderAuthStatus.authSource === "oauth" && activeProviderAuthStatus.sessionId && (
            <form className="manual-exchange-card stack" onSubmit={(event) => void exchangeOpenAiLoginCode(event)}>
              <strong>Manual authorization-code exchange</strong>
              <span className="subtle">After approving the experimental login in the browser, paste only the authorization code here. The code is sent once to the local runtime, then cleared from the form.</span>
              {providerAuthPendingState.error && <div className="error">{providerAuthPendingState.error}</div>}
              {providerAuthExchangeError && <div className="error">{sanitizeDisplayText(providerAuthExchangeError)}</div>}
              <div className="row auth-code-row">
                <label>
                  Authorization code
                  <input type="password" value={providerAuthExchangeCode} onChange={(event) => setProviderAuthExchangeCode(event.target.value)} placeholder="Paste authorization code" autoComplete="off" />
                </label>
                <button type="submit" disabled={providerAuthExchangeWorking || !providerAuthExchangeCode.trim() || !providerAuthPendingState.state}>
                  {providerAuthExchangeWorking ? "Exchanging…" : "Exchange authorization code"}
                </button>
              </div>
            </form>
          )}
          <div className="row">
            <button type="button" onClick={() => void refreshProviderAuthStatus()}>Refresh login status</button>
            <button type="button" onClick={() => void startOpenAiLogin()} disabled={activeProviderAuthStatus?.supportsLogin === false}>Login with OpenAI</button>
            <button type="button" className="danger-button" onClick={() => void startExperimentalOpenAiLogin()}>Experimental Login with OpenAI account</button>
            <button type="button" onClick={() => void disconnectOpenAiLogin()} disabled={!activeProviderAuthStatus?.configured || activeProviderAuthStatus.authSource === "api_key"}>Disconnect login</button>
            <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>
          </div>
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
                <input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} autoComplete="off" />
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
                <span className="subtle">{sanitizeDisplayText(provider.id)} · {provider.kind} · {sanitizeDisplayText(provider.baseUrl)}</span>
                <span>Secret configured: {String(provider.auth.configured)} {provider.auth.redacted ? `(${provider.auth.redacted})` : ""}</span>
                <span>Models: {provider.models.map((model) => sanitizeDisplayText(model.displayName)).join(", ") || "none"}</span>
                <button type="button" onClick={() => editProvider(provider)}>Edit</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Chat</h2>
        <div className={`readiness-card ${canSendChat ? "ready" : "warn"}`}>
          <div className="row">
            <strong>Chat readiness</strong>
            <span className={`badge ${connectionStatus === "connected" ? "ok" : connectionStatus === "error" ? "warn" : ""}`}>runtime {connectionStatus}</span>
            <span className={enabledProviders.length > 0 ? "badge ok" : "badge warn"}>{enabledProviders.length} enabled provider{enabledProviders.length === 1 ? "" : "s"}</span>
          </div>
          <div className="stack">
            <span>Model: {chatReadinessLabel}</span>
            <span>{chatReadinessMessage}</span>
            {experimentalOauthChatReady && <span className="subtle">OpenAI API-key fallback remains the safe/default setup and will be preferred when configured.</span>}
            {!canSendChat && <button type="button" onClick={applyOpenAiApiPreset}>Use OpenAI API key fallback</button>}
          </div>
        </div>
        {chatError && <ErrorBox error={chatError} />}
        <div className="form-grid">
          <label>
            Chat id
            <input value={chatId} onChange={(event) => setChatId(event.target.value)} />
          </label>
        </div>
        <div className="chat-panel" aria-label="Chat messages">
          {chatView.messages.length === 0 ? <p className="subtle">Ask a question to start this local chat.</p> : chatView.messages.map((message) => <ChatBubble key={message.id} message={message} />)}
          {chatView.messages.some((message) => message.role === "assistant" && message.status === "streaming") && <span className="subtle">Assistant is streaming…</span>}
        </div>
        <form className="stack" onSubmit={(event) => void submitChat(event)}>
          <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask Yet AI..." />
          <div className="row">
            <button type="submit" disabled={!canSendChat}>Send</button>
            <button type="button" onClick={stopSse}>Stop SSE</button>
          </div>
        </form>
        <details>
          <summary>SSE debug details</summary>
          <div className="timeline">
            {timeline.length === 0 ? <span>No SSE events yet.</span> : timeline.map((entry, index) => <div className="timeline-entry" key={`${index}:${entry}`}>{entry}</div>)}
          </div>
        </details>
      </section>

      <section className="card stack">
        <h2>Bridge debug</h2>
        <p className="subtle">Browser mock mode is non-privileged. It only logs bridge messages.</p>
        <div className="timeline">
          {bridgeLog.map((entry, index) => <div className="timeline-entry" key={`${index}:${entry}`}>{entry}</div>)}
        </div>
      </section>
    </main>
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

function ProviderAuthSummary({ status }: { status: ProviderAuthStatus }) {
  return <p>{providerAuthStatusCopy[status]}</p>;
}

function ProviderAuthDetails({ status }: { status: ProviderAuthResponse }) {
  return (
    <div className="stack">
      <span>Configured: {String(status.configured)}</span>
      <span>Auth source: {status.authSource}</span>
      <span>Login supported: {String(status.supportsLogin)}</span>
      <span>API key fallback supported: {String(status.supportsApiKey)}</span>
      {status.accountLabel && <span>Account: {sanitizeDisplayText(status.accountLabel)}</span>}
      {status.sessionId && <span>Session: {sanitizeDisplayText(status.sessionId)}</span>}
      {status.expiresAt && <span>Expires: {sanitizeDisplayText(status.expiresAt)}</span>}
      {status.scopes && status.scopes.length > 0 && <span>Scopes: {sanitizeDisplayText(status.scopes.join(", "))}</span>}
      {status.redacted && <span>Secret configured: {sanitizeDisplayText(status.redacted)}</span>}
      {status.lastError && <span>Last error: {sanitizeDisplayText(status.lastError)}</span>}
      {status.pollIntervalSeconds && <span>Poll interval: {status.pollIntervalSeconds} seconds</span>}
    </div>
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

function ErrorBox({ error }: { error: RuntimeError }) {
  return <div className="error">{error.status}: {sanitizeDisplayText(error.message)}</div>;
}

function StatusBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="stack">
      <h3>{title}</h3>
      <pre>{value ? JSON.stringify(value, null, 2) : "No data"}</pre>
    </div>
  );
}
