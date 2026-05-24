import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBridgeAdapter, type BridgeHost } from "./bridge/bridgeAdapter";
import { listProviders, saveProvider, type ProviderSummary, type ProviderWriteRequest } from "./services/providersClient";
import { getCaps, getModels, getPing, sendUserMessage, type CapsResponse, type ModelSummary, type PingResponse, type RuntimeError, type RuntimeSettings } from "./services/runtimeClient";
import { subscribeToChat, type SseEvent } from "./services/sseClient";

const defaultBaseUrl = "http://127.0.0.1:8001";
const productName = "Yet AI";

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

export function App() {
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [token, setToken] = useState("");
  const [ping, setPing] = useState<PingResponse | null>(null);
  const [caps, setCaps] = useState<CapsResponse | null>(null);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [connectionError, setConnectionError] = useState<RuntimeError | null>(null);
  const [providerError, setProviderError] = useState<RuntimeError | null>(null);
  const [chatError, setChatError] = useState<RuntimeError | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [chatId, setChatId] = useState("chat-001");
  const [chatInput, setChatInput] = useState("");
  const [timeline, setTimeline] = useState<string[]>([]);
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);
  const [bridgeHost, setBridgeHost] = useState<BridgeHost>("browser");
  const abortRef = useRef<AbortController | null>(null);

  const settings = useMemo<RuntimeSettings>(() => ({ baseUrl, token }), [baseUrl, token]);
  const connectionStatus = connectionError ? "error" : ping?.ready ? "connected" : "not checked";

  useEffect(() => {
    const adapter = createBridgeAdapter((entry) => setBridgeLog((current) => [entry, ...current].slice(0, 20)));
    setBridgeHost(adapter.host);
    return () => adapter.dispose();
  }, []);

  const addTimeline = useCallback((entry: string) => {
    setTimeline((current) => [entry, ...current].slice(0, 80));
  }, []);

  const refreshRuntime = useCallback(async () => {
    setConnectionError(null);
    const [nextPing, nextCaps, nextModels] = await Promise.all([
      getPing(settings),
      getCaps(settings),
      getModels(settings),
    ]);
    if (nextPing.ok) {
      setPing(nextPing.data);
    } else {
      setPing(null);
      setConnectionError(nextPing.error);
    }
    if (nextCaps.ok) {
      setCaps(nextCaps.data);
    } else {
      setCaps(null);
      setConnectionError(nextCaps.error);
    }
    if (nextModels.ok) {
      setModels(nextModels.data.models);
    }
  }, [settings]);

  const refreshProviders = useCallback(async () => {
    setProviderError(null);
    const result = await listProviders(settings);
    if (result.ok) {
      setProviders(result.data.providers);
    } else {
      setProviders([]);
      setProviderError(result.error);
    }
  }, [settings]);

  const connect = useCallback(async () => {
    await refreshRuntime();
    await refreshProviders();
  }, [refreshProviders, refreshRuntime]);

  useEffect(() => {
    void connect();
  }, [connect]);

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
      await refreshRuntime();
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

  const startSse = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    addTimeline(`Opening SSE for ${chatId}`);
    void subscribeToChat(
      settings,
      chatId,
      {
        onEvent: (event: SseEvent) => addTimeline(`${event.seq} ${event.type}\n${JSON.stringify(event.payload ?? {}, null, 2)}`),
        onError: (error) => {
          setChatError(error);
          addTimeline(`SSE error: ${error.message}`);
        },
      },
      controller.signal,
    );
  };

  const stopSse = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    addTimeline("SSE stopped");
  };

  const submitChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content) {
      return;
    }
    setChatError(null);
    const result = await sendUserMessage(settings, chatId, content);
    if (result.ok) {
      addTimeline(`Command accepted ${result.data.requestId}`);
      setChatInput("");
    } else {
      setChatError(result.error);
      addTimeline(`Command error: ${result.error.message}`);
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
        <div className="row">
          <button onClick={() => void connect()}>Refresh runtime</button>
          <span className="subtle">Authorization header is sent only to the configured local runtime.</span>
        </div>
        {connectionError && <ErrorBox error={connectionError} />}
        <div className="grid">
          <StatusBlock title="/v1/ping" value={ping} />
          <StatusBlock title="/v1/caps" value={caps ? { protocolVersion: caps.protocolVersion, capabilities: caps.capabilities, runtime: caps.runtime, providers: caps.providers.length } : null} />
        </div>
      </section>

      <section className="card stack">
        <h2>Provider setup</h2>
        <p className="subtle">Provider requests go to the local runtime. API key input is cleared after submit and is not written to browser storage.</p>
        {providerError && <ErrorBox error={providerError} />}
        <div className="grid">
          <form className="stack" onSubmit={(event) => void submitProvider(event)}>
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
        <h2>Model selection placeholder</h2>
        <select disabled={models.length === 0}>
          {models.length === 0 ? <option>No runtime models available</option> : models.map((model) => <option key={`${model.providerId ?? "provider"}:${model.id}`}>{model.displayName}</option>)}
        </select>
      </section>

      <section className="card stack">
        <h2>Chat command and SSE debug</h2>
        {chatError && <ErrorBox error={chatError} />}
        <div className="form-grid">
          <label>
            Chat id
            <input value={chatId} onChange={(event) => setChatId(event.target.value)} />
          </label>
        </div>
        <form className="stack" onSubmit={(event) => void submitChat(event)}>
          <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Send a user_message command to the local runtime" />
          <div className="row">
            <button type="submit">Send user_message</button>
            <button type="button" onClick={startSse}>Subscribe with fetch SSE</button>
            <button type="button" onClick={stopSse}>Stop SSE</button>
          </div>
        </form>
        <div className="timeline">
          {timeline.length === 0 ? <span>No SSE events yet.</span> : timeline.map((entry, index) => <div className="timeline-entry" key={`${index}:${entry}`}>{entry}</div>)}
        </div>
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

function ErrorBox({ error }: { error: RuntimeError }) {
  return <div className="error">{error.status}: {error.message}</div>;
}

function StatusBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="stack">
      <h3>{title}</h3>
      <pre>{value ? JSON.stringify(value, null, 2) : "No data"}</pre>
    </div>
  );
}
