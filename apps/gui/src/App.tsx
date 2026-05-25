import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBridgeAdapter, type BridgeHost, type HostReadyPayload } from "./bridge/bridgeAdapter";
import { addAcceptedUserMessage, applyChatViewEvent, createInitialChatViewState, resetChatViewState, type ChatViewMessage } from "./services/chatViewState";
import { disconnectProviderAuth, exchangeProviderAuth, getProviderAuthStatus, startProviderAuth, type ProviderAuthResponse, type ProviderAuthStatus } from "./services/providerAuthClient";
import { listProviders, saveProvider, type ProviderSummary, type ProviderWriteRequest } from "./services/providersClient";
import { getCaps, getModels, getPing, isLoopbackRuntimeUrl, productIdentity, productIdentityWarning, sendAbort, type CapsResponse, type ModelSummary, type PingResponse, type RuntimeError, type RuntimeSettings, sendUserMessage } from "./services/runtimeClient";
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

const secretLikePatterns = [
  /\b(access_token|refresh_token|api_key|authorization|bearer)\b\s*[:=]\s*[^\s,;]+/gi,
  /\b(pkce_verifier|code_verifier|verifier|cookie)\b\s*[:=]?\s*[^\s,;]*/gi,
  /(?:^|[\s/])(?:\.codex\/auth\.json|auth\.json)(?=$|[\s,;])/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(sk-[A-Za-z0-9_-]{8,})\b/g,
  /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  /\b[A-Za-z0-9+/=_-]{48,}\b/g,
];

function sanitizeDisplayText(value: string): string {
  const sanitized = secretLikePatterns.reduce((current, pattern) => current.replace(pattern, "[redacted]"), value).trim();
  return sanitized.length > 240 ? `${sanitized.slice(0, 240)}…` : sanitized;
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
  const runtimeRefreshAttemptRef = useRef(0);
  const runtimeRefreshInFlightRef = useRef(false);
  const runtimeRefreshQueuedRef = useRef(false);
  const settingsRef = useRef<RuntimeSettings>({ baseUrl: defaultBaseUrl, token: "" });
  const abortRef = useRef<AbortController | null>(null);

  const settings = useMemo<RuntimeSettings>(() => ({ baseUrl, token }), [baseUrl, token]);
  settingsRef.current = settings;
  const runtimeConnected = ping?.ready === true && !connectionError;
  const connectionStatus = connectionError ? "error" : ping?.ready ? "connected" : "not checked";
  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);
  const selectedModel = useMemo(() => models[0] ?? enabledProviders.flatMap((provider) => provider.models.map((model) => ({ ...model, providerId: model.providerId ?? provider.id })))[0], [enabledProviders, models]);
  const apiKeyChatReady = runtimeConnected && !modelError && enabledProviders.length > 0 && Boolean(selectedModel);
  const experimentalOauthChatReady = runtimeConnected && !apiKeyChatReady && providerAuthStatus?.configured === true && providerAuthStatus.authSource === "oauth" && providerAuthStatus.status === "connected";
  const canSendChat = apiKeyChatReady || experimentalOauthChatReady;
  const chatReadinessLabel = !runtimeConnected
    ? "Runtime unavailable"
    : apiKeyChatReady
      ? `${selectedModel?.displayName ?? "the default model"}${selectedModel?.providerId ? ` (${selectedModel.providerId})` : ""}`
      : experimentalOauthChatReady
        ? "Experimental OpenAI account / gpt-5-codex"
        : "No model available";
  const chatReadinessMessage = !runtimeConnected
    ? "Runtime is not connected. Refresh runtime and fix the local runtime problem before sending the first GPT message."
    : apiKeyChatReady
      ? `Ready to send using ${selectedModel?.displayName ?? "the default model"}.`
      : experimentalOauthChatReady
        ? "Experimental Codex-like OpenAI account chat is connected through the local runtime. This private-endpoint path is high-risk, not official public OAuth support, and not production-ready."
        : modelError
          ? "Runtime model refresh failed. Refresh runtime again before sending the first GPT message."
          : "Configure an enabled OpenAI API key fallback provider with a model before sending the first GPT message.";
  const providerAuthPendingState = useMemo(() => parseProviderAuthState(providerAuthStatus), [providerAuthStatus]);

  const applyHostReady = useCallback((payload: HostReadyPayload | undefined) => {
    if (!payload?.runtimeUrl || !isLoopbackRuntimeUrl(payload.runtimeUrl)) {
      return;
    }
    const hostRuntimeUrl = payload.runtimeUrl;
    const currentBaseUrl = settingsRef.current.baseUrl;
    setBaseUrl(hostRuntimeUrl);
    if (payload.sessionToken !== undefined) {
      setToken(payload.sessionToken);
    } else if (normalizeRuntimeUrl(hostRuntimeUrl) !== normalizeRuntimeUrl(currentBaseUrl)) {
      setToken("");
    }
    setTimeline((current) => ["Host runtime settings received", ...current].slice(0, 80));
  }, []);

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

  const addTimeline = useCallback((entry: string) => {
    setTimeline((current) => [entry, ...current].slice(0, 80));
  }, []);

  const appendChatError = useCallback((message: string) => {
    setChatView((current) => applyChatViewEvent(current, {
      seq: 0,
      type: "error",
      chatId: current.chatId,
      payload: { message },
    }));
  }, []);

  const refreshRuntime = useCallback(async (targetSettings: RuntimeSettings, keepInFlight = false) => {
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
      setPing(null);
      setCaps(null);
      setModels([]);
      setIdentityWarnings([]);
      setConnectionError(runtimeError);
      setModelError(runtimeError);
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
  }, []);

  const refreshProviders = useCallback(async (targetSettings = settingsRef.current) => {
    setProviderError(null);
    const result = await listProviders(targetSettings);
    if (result.ok) {
      setProviders(result.data.providers);
    } else {
      setProviders([]);
      setProviderError(result.error);
    }
  }, []);

  const refreshProviderAuthStatus = useCallback(async (targetSettings = settingsRef.current) => {
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    const result = await getProviderAuthStatus(targetSettings, "openai");
    if (result.ok) {
      setProviderAuthStatus(result.data);
    } else {
      setProviderAuthStatus(null);
      setProviderAuthError(result.error);
    }
  }, []);

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
        await refreshRuntime(targetSettings, true);
        await refreshProviders(targetSettings);
        await refreshProviderAuthStatus(targetSettings);
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
    setProviderError(null);
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
    const result = await saveProvider(settings, selectedProviderId, request);
    setProviderForm((current) => ({ ...current, apiKey: "" }));
    if (result.ok) {
      await refreshProviders();
      await refreshRuntime(settingsRef.current);
      setSelectedProviderId(result.data.id);
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
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    const result = await startProviderAuth(settings, "openai");
    if (!result.ok) {
      setProviderAuthError(result.error);
      return;
    }
    setProviderAuthStatus(result.data);
    const authUrl = result.data.authorizationUrl ?? result.data.verificationUrl;
    if (authUrl) {
      openSafeAuthUrl(authUrl, setProviderAuthUrlWarning);
    }
  };

  const startExperimentalOpenAiLogin = async () => {
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeCode("");
    const result = await startProviderAuth(settings, "openai", { experimentalCodexLike: true });
    if (!result.ok) {
      setProviderAuthError(result.error);
      return;
    }
    setProviderAuthStatus(result.data);
    const authUrl = result.data.authorizationUrl ?? result.data.verificationUrl;
    if (authUrl) {
      openSafeAuthUrl(authUrl, setProviderAuthUrlWarning);
    }
  };

  const disconnectOpenAiLogin = async () => {
    setProviderAuthError(null);
    setProviderAuthUrlWarning(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeCode("");
    const result = await disconnectProviderAuth(settings, "openai");
    if (result.ok) {
      setProviderAuthStatus(result.data);
      await refreshProviders();
      await refreshRuntime(settingsRef.current);
    } else {
      setProviderAuthError(result.error);
    }
  };

  const exchangeOpenAiLoginCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sessionId = providerAuthStatus?.sessionId;
    const code = providerAuthExchangeCode.trim();
    if (!sessionId || !code || !providerAuthPendingState.state) {
      return;
    }
    setProviderAuthError(null);
    setProviderAuthExchangeError(null);
    setProviderAuthExchangeWorking(true);
    try {
      const result = await exchangeProviderAuth(settings, "openai", sessionId, code, providerAuthPendingState.state);
      if (result.ok) {
        setProviderAuthStatus(result.data);
        if (result.data.success) {
          await refreshProviders();
          await refreshRuntime(settingsRef.current);
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
    abortRef.current?.abort();
    abortRef.current = null;
    setChatError(null);
    setChatView(resetChatViewState(chatId));
    setTimeline([]);
  }, [chatId]);

  const startSse = useCallback((targetChatId = chatId) => {
    if (abortRef.current) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    addTimeline(`Opening SSE for ${targetChatId}`);
    void subscribeToChat(
      settings,
      targetChatId,
      {
        onEvent: (event: SseEvent) => {
          setChatView((current) => applyChatViewEvent(current, event));
          addTimeline(`${event.seq} ${event.type}\n${JSON.stringify(event.payload ?? {}, null, 2)}`);
        },
        onError: (error) => {
          setChatError(error);
          appendChatError(error.message);
          addTimeline(`SSE error: ${sanitizeDisplayText(error.message)}`);
        },
      },
      controller.signal,
    ).finally(() => {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    });
  }, [addTimeline, appendChatError, chatId, settings]);

  const stopSse = () => {
    void sendAbort(settings, chatId).then((result) => {
      if (!result.ok) {
        addTimeline(`Abort command error: ${sanitizeDisplayText(result.error.message)}`);
      }
    });
    abortRef.current?.abort();
    abortRef.current = null;
    addTimeline("SSE stopped and abort requested");
  };

  const submitChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content) {
      return;
    }
    setChatError(null);
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
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label>
            Session token
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token for local runtime" />
          </label>
        </div>
        <p className="subtle">In VS Code or JetBrains, the local runtime session token is normally provided by the IDE host through host.ready. Paste a token only when connecting to a manually started runtime such as one launched with YET_AI_AUTH_TOKEN=.... This local runtime token is not an OpenAI key or provider API key.</p>
        <div className="row">
          <button onClick={() => void connect()} disabled={runtimeRefreshInFlight}>{runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime"}</button>
          <span className="subtle">Authorization header is sent only to validated loopback runtime URLs.</span>
        </div>
        {runtimeRefreshStatus && <div className={`refresh-status ${runtimeRefreshStatus.state}`} role="status"><strong>{runtimeRefreshStatus.detail}</strong><span>Attempt {runtimeRefreshStatus.attempt} at {runtimeRefreshStatus.checkedAt}</span></div>}
        {connectionError && <ErrorBox error={connectionError} />}
        {modelError && <div className="error">Models refresh failed: {modelError.status}: {sanitizeDisplayText(modelError.message)}</div>}
        {identityWarnings.map((warning) => <div className="error" key={warning}>{warning}</div>)}
        <div className="grid">
          <StatusBlock title="/v1/ping" value={ping} />
          <StatusBlock title="/v1/caps" value={caps ? { protocolVersion: caps.protocolVersion, capabilities: caps.capabilities, runtime: caps.runtime, providers: caps.providers.length } : null} />
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
            <span className={providerAuthStatus?.configured ? "badge ok" : "badge warn"}>{providerAuthStatus?.status ?? "not checked"}</span>
          </div>
          <p className="subtle">Login-first setup is handled only by the local runtime. The GUI shows sanitized status and never stores provider auth state in browser storage.</p>
          <div className="risk-card stack">
            <strong>Experimental OpenAI account login</strong>
            <span>This Codex-like path is experimental and high-risk. It may rely on private OpenAI/Codex behavior, is not official public third-party OAuth support, and is not production-ready. Use it only if you explicitly accept that risk.</span>
          </div>
          {providerAuthError && <ErrorBox error={providerAuthError} />}
          {providerAuthUrlWarning && <div className="error">{providerAuthUrlWarning}</div>}
          {providerAuthStatus && <ProviderAuthSummary status={providerAuthStatus.status} />}
          {providerAuthStatus?.supportsLogin === false && <p>OpenAI account login is planned/not available yet; use API key fallback.</p>}
          {providerAuthStatus?.message && <span>{sanitizeDisplayText(providerAuthStatus.message)}</span>}
          {providerAuthStatus && <ProviderAuthDetails status={providerAuthStatus} />}
          {providerAuthStatus?.status === "pending" && providerAuthStatus.authSource === "oauth" && providerAuthStatus.sessionId && (
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
            <button type="button" onClick={() => void startOpenAiLogin()} disabled={providerAuthStatus?.supportsLogin === false}>Login with OpenAI</button>
            <button type="button" className="danger-button" onClick={() => void startExperimentalOpenAiLogin()}>Experimental Login with OpenAI account</button>
            <button type="button" onClick={() => void disconnectOpenAiLogin()} disabled={!providerAuthStatus?.configured || providerAuthStatus.authSource === "api_key"}>Disconnect login</button>
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
            {providers.length === 0 ? <p className="subtle">No providers returned.</p> : providers.map((provider) => (
              <div className="provider-item stack" key={provider.id}>
                <div className="row">
                  <strong>{provider.displayName}</strong>
                  <span className={provider.enabled ? "badge ok" : "badge warn"}>{provider.enabled ? "enabled" : "disabled"}</span>
                </div>
                <span className="subtle">{provider.id} · {provider.kind} · {provider.baseUrl}</span>
                <span>Secret configured: {String(provider.auth.configured)} {provider.auth.redacted ? `(${provider.auth.redacted})` : ""}</span>
                <span>Models: {provider.models.map((model) => model.displayName).join(", ") || "none"}</span>
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
