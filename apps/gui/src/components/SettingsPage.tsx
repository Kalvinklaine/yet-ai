import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { BridgeAdapter, BridgeHost, HostRuntimeStatusPayload } from "../bridge/bridgeAdapter";
import { saveProvider, type ProviderKind, type ProviderSummary, type ProviderWriteRequest } from "../services/providersClient";
import { sanitizeDisplayText } from "../services/redaction";
import { isLoopbackRuntimeUrl, type RuntimeError, type RuntimeSettings } from "../services/runtimeClient";
import { runtimeLifecycleDiagnostics, type RuntimeLifecycleDiagnostics } from "../services/runtimeLifecycle";
import { useRuntimeController, type ProviderTestState } from "../services/useRuntimeController";

type ProviderForm = {
  id: string;
  kind: Exclude<ProviderKind, "demo-local">;
  displayName: string;
  enabled: boolean;
  baseUrl: string;
  authType: "none" | "api_key";
  apiKey: string;
  modelId: string;
};

type SettingsSectionId = "runtime" | "providers" | "account" | "diagnostics";

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "runtime", label: "Runtime" },
  { id: "providers", label: "Providers & models" },
  { id: "account", label: "Account login" },
  { id: "diagnostics", label: "Diagnostics" },
];

export type SettingsPageProps = {
  settings: RuntimeSettings;
  settingsRevision: number;
  onSettingsChange: (settings: RuntimeSettings) => void;
  onBackToProjects?: () => void;
  host?: BridgeHost;
  runtimeLifecycle?: RuntimeLifecycleDiagnostics | null;
  bridgeAdapter?: BridgeAdapter;
  runtimeAuthorityKey?: string | null;
  getCurrentRuntimeAuthorityKey?: () => string | null;
};

const emptyProviderForm: ProviderForm = {
  id: "openai-compatible",
  kind: "openai-compatible",
  displayName: "OpenAI-Compatible Provider",
  enabled: true,
  baseUrl: "https://api.openai.com/v1",
  authType: "api_key",
  apiKey: "",
  modelId: "gpt-4o-mini",
};

export function SettingsPage({ settings, settingsRevision, onSettingsChange, onBackToProjects, host = "browser", runtimeLifecycle = null, bridgeAdapter, runtimeAuthorityKey = null, getCurrentRuntimeAuthorityKey }: SettingsPageProps) {
  const settingsRef = useRef(settings);
  const settingsRevisionRef = useRef(settingsRevision);
  const appendTraceRef = useRef(() => undefined);
  const addTimelineRef = useRef(() => undefined);
  const refreshChatsRef = useRef(async () => undefined);
  settingsRef.current = settings;
  settingsRevisionRef.current = settingsRevision;

  const controller = useRuntimeController({
    settingsRef,
    settingsRevisionRef,
    settingsRevision,
    appendTraceRef,
    addTimelineRef,
    refreshChatsRef,
    providerTestAction,
  });
  const [sessionTokenDraft, setSessionTokenDraft] = useState("");
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [providerSaving, setProviderSaving] = useState(false);
  const [localProviderError, setLocalProviderError] = useState<RuntimeError | null>(null);
  const [liveRuntimeLifecycle, setLiveRuntimeLifecycle] = useState<RuntimeLifecycleDiagnostics | null>(runtimeLifecycle);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("runtime");
  const sectionTabRefs = useRef<Record<SettingsSectionId, HTMLButtonElement | null>>({ runtime: null, providers: null, account: null, diagnostics: null });
  const hostManaged = settings.runtimeAccess === "same_origin_proxy" || host !== "browser";

  useEffect(() => {
    void controller.connect();
  }, [controller.connect, settingsRevision]);

  useEffect(() => {
    setSessionTokenDraft("");
  }, [settingsRevision]);

  useEffect(() => {
    setLiveRuntimeLifecycle(runtimeLifecycle);
  }, [runtimeLifecycle]);

  useEffect(() => {
    if (!bridgeAdapter) return;
    return bridgeAdapter.subscribe((message) => {
      if (message.type !== "host.runtimeStatus") return;
      if (host !== "browser" && runtimeAuthorityKey === null) return;
      if (getCurrentRuntimeAuthorityKey && getCurrentRuntimeAuthorityKey() !== runtimeAuthorityKey) return;
      const payload = message.payload as HostRuntimeStatusPayload;
      if (payload.surface !== host) return;
      const diagnostics = runtimeLifecycleDiagnostics(payload, host);
      setLiveRuntimeLifecycle(diagnostics);
      controller.runtimeLifecycleChanged(diagnostics);
    });
  }, [bridgeAdapter, controller.runtimeLifecycleChanged, getCurrentRuntimeAuthorityKey, host, runtimeAuthorityKey]);

  const activePing = controller.runtimeDataRevision === settingsRevision ? controller.ping : null;
  const activeModels = controller.runtimeDataRevision === settingsRevision ? controller.models : [];
  const activeProviders = controller.providerDataRevision === settingsRevision ? controller.providers : [];
  const activeDemoMode = controller.demoModeDataRevision === settingsRevision ? controller.demoMode : null;
  const activeAuth = controller.providerAuthDataRevision === settingsRevision ? controller.providerAuthStatus : null;
  const authState = useMemo(() => providerAuthState(activeAuth?.authorizationUrl), [activeAuth?.authorizationUrl]);

  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
  };

  const navigateSections = (event: KeyboardEvent<HTMLButtonElement>, section: SettingsSectionId) => {
    const currentIndex = settingsSections.findIndex((item) => item.id === section);
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (currentIndex + 1) % settingsSections.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + settingsSections.length) % settingsSections.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = settingsSections.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextSection = settingsSections[nextIndex].id;
    setActiveSection(nextSection);
    sectionTabRefs.current[nextSection]?.focus();
  };

  const updateRuntimeUrl = (baseUrl: string) => {
    if (!hostManaged) onSettingsChange({ ...settings, baseUrl, runtimeAccess: "direct" });
  };

  const commitSessionToken = () => {
    if (hostManaged || !sessionTokenDraft) return;
    onSettingsChange({ ...settings, token: sessionTokenDraft, runtimeAccess: "direct" });
    setSessionTokenDraft("");
  };

  const editProvider = (provider: ProviderSummary) => {
    if (provider.kind === "demo-local") return;
    setSelectedProviderId(provider.id);
    setProviderForm({
      id: provider.id,
      kind: provider.kind,
      displayName: provider.displayName,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      authType: provider.auth.type,
      apiKey: "",
      modelId: provider.models[0]?.id ?? "",
    });
  };

  const submitProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProviderSaving(true);
    setLocalProviderError(null);
    controller.setProviderError(null);
    const request: ProviderWriteRequest = {
      id: selectedProviderId ? undefined : providerForm.id.trim(),
      kind: providerForm.kind,
      displayName: providerForm.displayName.trim(),
      enabled: providerForm.enabled,
      baseUrl: providerForm.baseUrl.trim(),
      auth: { type: providerForm.authType, apiKey: providerForm.apiKey.trim() || undefined },
      models: providerForm.modelId.trim() ? [{ id: providerForm.modelId.trim(), displayName: providerForm.modelId.trim() }] : [],
      capabilities: { chat: true, completion: false, embeddings: false },
    };
    setProviderForm((current) => ({ ...current, apiKey: "" }));
    const result = await saveProvider(settingsRef.current, selectedProviderId, request);
    setProviderSaving(false);
    if (settingsRevisionRef.current !== settingsRevision) return;
    if (!result.ok) {
      setLocalProviderError(result.error);
      return;
    }
    setSelectedProviderId(result.data.id);
    await controller.connect();
  };

  const startLogin = async () => {
    await controller.startOpenAiLogin(Boolean(runtimeAuthMismatch(controller.connectionError, controller.modelError, controller.providerAuthError)), (url) => {
      if (!isSafeAuthUrl(url)) {
        controller.setProviderAuthUrlWarning("Provider auth URL was not opened because it is not HTTPS or loopback.");
        return;
      }
      controller.setProviderAuthUrlWarning(null);
      window.open(url, "_blank", "noopener,noreferrer");
    });
  };

  const exchangeCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = controller.providerAuthExchangeCode.trim();
    if (!activeAuth?.sessionId || !authState || !safeExchangeValue(code, 4096)) {
      controller.setProviderAuthExchangeCode("");
      controller.setProviderAuthExchangeError("Authorization code or pending login state is missing or malformed. Refresh status and paste only the browser authorization code.");
      return;
    }
    await controller.exchangeOpenAiLoginCode(activeAuth.sessionId, authState);
  };

  return (
    <main className={`settings-page-shell host-${host}`} data-testid="settings-page">
      <header className="settings-header">
        <div className="settings-product-heading">
          <span className="settings-product-mark" aria-hidden="true">Y</span>
          <div className="stack">
            <span className="settings-eyebrow">Yet AI · global settings</span>
            <h1>Settings</h1>
            <p className="subtle">Configure your local runtime and providers. Credentials stay with the local engine.</p>
          </div>
        </div>
        {onBackToProjects && <button type="button" className="secondary-button" onClick={onBackToProjects}>Back to Projects</button>}
      </header>

      <section className={`settings-readiness ${activePing?.ready ? "ready" : "attention"}`} aria-labelledby="settings-readiness-title">
        <div>
          <span className="settings-eyebrow">Readiness</span>
          <h2 id="settings-readiness-title">{activePing?.ready ? "Local assistant is connected" : "Runtime needs attention"}</h2>
          <p>{activePing?.ready ? "Provider and account choices remain local to this runtime." : "Refresh the runtime, then configure a provider to get ready."}</p>
        </div>
        <div className="settings-readiness-statuses" aria-label="Settings status summary">
          <span className={`settings-status-tile ${activePing?.ready ? "ok" : "warn"}`}><strong>Runtime</strong>{activePing?.ready ? "Connected" : "Not connected"}</span>
          <span className={`settings-status-tile ${activeProviders.length > 0 ? "ok" : "warn"}`}><strong>Providers</strong>{activeProviders.length} configured</span>
          <span className={`settings-status-tile ${activeAuth?.status === "connected" ? "ok" : "neutral"}`}><strong>Account</strong>{activeAuth?.status === "connected" ? "Connected" : "Optional"}</span>
        </div>
      </section>

      <div className="settings-layout">
        <nav aria-label="Settings sections" className="settings-section-nav">
          <div role="tablist" aria-orientation="vertical" className="settings-section-tabs">
            {settingsSections.map((section) => <button
              key={section.id}
              ref={(element) => { sectionTabRefs.current[section.id] = element; }}
              type="button"
              role="tab"
              id={`settings-${section.id}-tab`}
              aria-controls={`settings-${section.id}`}
              aria-selected={activeSection === section.id}
              tabIndex={activeSection === section.id ? 0 : -1}
              className={activeSection === section.id ? "active" : undefined}
              onClick={() => selectSection(section.id)}
              onKeyDown={(event) => navigateSections(event, section.id)}
            >{section.label}<span aria-hidden="true">›</span></button>)}
          </div>
          <p className="settings-local-note">Settings and credentials stay on this device. Account login is optional and experimental.</p>
        </nav>

        <div className="settings-section-content">

      <section id="settings-runtime" className="settings-section-card stack" role="tabpanel" aria-labelledby="settings-runtime-tab" tabIndex={0} hidden={activeSection !== "runtime"}>
        <div className="settings-section-heading"><div><span className={`badge ${activePing?.ready ? "ok" : "warn"}`}>{activePing?.ready ? "connected" : "setup needed"}</span><h2>Runtime</h2></div><p>Connect the interface to the local Yet AI engine.</p></div>
        <label>
          Runtime base URL
          <input value={settings.baseUrl} onChange={(event) => updateRuntimeUrl(event.target.value)} readOnly={hostManaged} aria-readonly={hostManaged} />
        </label>
        {!hostManaged && <label>
          Session token
          <input type="password" value={sessionTokenDraft} onChange={(event) => setSessionTokenDraft(event.target.value)} placeholder={settings.token ? "Stored token remains hidden; enter a replacement" : "Optional loopback runtime token"} autoComplete="off" />
          <button type="button" onClick={commitSessionToken} disabled={!sessionTokenDraft}>Apply Session token</button>
        </label>}
        <p className="subtle">{hostManaged ? "The IDE host manages this runtime connection. Its in-memory Session token is never displayed." : "The Session token authorizes this GUI to the loopback runtime only. A stored token is never filled back into this form."}</p>
        <div className="row">
          <button type="button" onClick={() => void controller.connect()} disabled={controller.runtimeRefreshInFlight}>{controller.runtimeRefreshInFlight ? "Checking runtime…" : "Refresh runtime"}</button>
          <span className={`badge ${activePing?.ready ? "ok" : "warn"}`}>{activePing?.ready ? "connected" : "not connected"}</span>
        </div>
        {controller.connectionError && <ErrorBox error={controller.connectionError} />}
        {controller.modelError && <ErrorBox error={controller.modelError} prefix="Models refresh failed" />}
        {controller.identityWarnings.map((warning) => <div className="error" key={warning}>{sanitizeDisplayText(warning)}</div>)}
      </section>

      <section id="settings-providers" className="settings-section-card stack" role="tabpanel" aria-labelledby="settings-providers-tab" tabIndex={0} hidden={activeSection !== "providers"}>
        <div className="settings-section-heading"><div><span className={`badge ${activeProviders.length > 0 ? "ok" : "warn"}`}>{activeProviders.length} configured</span><h2>Providers &amp; models</h2></div><p>Choose direct BYOK or local model connections.</p></div>
        <p className="subtle">Provider credentials are submitted to the local engine only. Raw API keys are cleared immediately and are never browser-persisted or echoed.</p>
        <div className="row">
          <strong>Demo Mode</strong>
          <span className={`badge ${activeDemoMode?.enabled ? "ok" : ""}`}>{activeDemoMode?.enabled ? "enabled" : "disabled"}</span>
          <button type="button" onClick={() => void controller.toggleDemoMode(!activeDemoMode?.enabled)} disabled={controller.demoModeWorking}>{controller.demoModeWorking ? "Changing Demo Mode…" : activeDemoMode?.enabled ? "Disable Demo Mode" : "Try Demo Mode"}</button>
        </div>
        {controller.demoModeError && <ErrorBox error={controller.demoModeError} />}
        <div className="stack" aria-label="Configured providers">
          {activeProviders.map((provider) => <article className="provider-item stack" key={provider.id}>
            <div className="row"><strong>{sanitizeDisplayText(provider.displayName)}</strong><span className="badge">{sanitizeDisplayText(provider.kind)}</span><span>{provider.enabled ? "enabled" : "disabled"}</span></div>
            <span>{provider.models.length} configured model{provider.models.length === 1 ? "" : "s"}</span>
            <div className="row">
              {provider.kind !== "demo-local" && <button type="button" onClick={() => editProvider(provider)}>Edit</button>}
              <button type="button" onClick={() => void controller.runProviderTest(provider.id)} disabled={controller.providerTestState?.providerId === provider.id && controller.providerTestState.state === "testing"}>Test provider</button>
            </div>
            {controller.providerTestState?.providerId === provider.id && <ProviderTestStatus state={controller.providerTestState} />}
          </article>)}
        </div>
        {(localProviderError ?? controller.providerError) && <ErrorBox error={(localProviderError ?? controller.providerError)!} />}
        <form className="form-grid" onSubmit={(event) => void submitProvider(event)} aria-label="Provider editor">
          <label>Provider id<input value={providerForm.id} readOnly={Boolean(selectedProviderId)} onChange={(event) => setProviderForm((current) => ({ ...current, id: event.target.value }))} /></label>
          <label>Display name<input value={providerForm.displayName} onChange={(event) => setProviderForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label>Kind<select value={providerForm.kind} onChange={(event) => setProviderForm((current) => ({ ...current, kind: event.target.value as ProviderForm["kind"] }))}><option value="openai-compatible">OpenAI-compatible</option><option value="ollama">Ollama</option><option value="custom">Custom</option></select></label>
          <label>Provider URL<input value={providerForm.baseUrl} onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
          <label>Authentication<select value={providerForm.authType} onChange={(event) => setProviderForm((current) => ({ ...current, authType: event.target.value as ProviderForm["authType"], apiKey: "" }))}><option value="api_key">API key</option><option value="none">None</option></select></label>
          {providerForm.authType === "api_key" && <label>Provider API key<input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))} autoComplete="off" /></label>}
          <label>Model id<input value={providerForm.modelId} onChange={(event) => setProviderForm((current) => ({ ...current, modelId: event.target.value }))} /></label>
          <label><input type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm((current) => ({ ...current, enabled: event.target.checked }))} /> Enabled</label>
          <div className="row"><button type="submit" disabled={providerSaving}>{providerSaving ? "Saving…" : selectedProviderId ? "Update provider" : "Save provider"}</button>{selectedProviderId && <button type="button" className="secondary-button" onClick={() => { setSelectedProviderId(undefined); setProviderForm(emptyProviderForm); }}>New provider</button>}</div>
        </form>
      </section>

      <section id="settings-account" className="settings-section-card stack" role="tabpanel" aria-labelledby="settings-account-tab" tabIndex={0} hidden={activeSection !== "account"}>
        <div className="settings-section-heading"><div><span className={`badge ${activeAuth?.status === "connected" ? "ok" : "warn"}`}>{activeAuth?.status ?? "optional"}</span><h2>Account login</h2></div><p>Experimental provider access, separate from local BYOK setup.</p></div>
        <p className="subtle">Optional, experimental, and runtime-owned. API-key and local providers remain available without an account.</p>
        <div className="row"><strong>Provider account status</strong><span className={`badge ${activeAuth?.status === "connected" ? "ok" : "warn"}`}>{activeAuth?.status ?? "not checked"}</span></div>
        {activeAuth?.message && <span>{sanitizeDisplayText(activeAuth.message)}</span>}
        <div className="settings-account-actions">
          <button type="button" onClick={() => void controller.refreshProviderAuthStatus()} disabled={controller.providerAuthMutation !== null}>Refresh login status</button>
          {activeAuth?.status === "connected" ? <button type="button" className="danger-button settings-destructive-action" onClick={() => void controller.disconnectOpenAiLogin()} disabled={controller.providerAuthMutation !== null}>Disconnect account</button> : <button type="button" onClick={() => void startLogin()} disabled={controller.providerAuthMutation !== null || activeAuth?.supportsLogin === false}>Start account login</button>}
        </div>
        {activeAuth?.status === "pending" && <form onSubmit={(event) => void exchangeCode(event)} className="form-grid" aria-label="Manual authorization exchange">
          <label>Authorization code<input type="password" value={controller.providerAuthExchangeCode} onChange={(event) => controller.setProviderAuthExchangeCode(event.target.value)} autoComplete="off" /></label>
          <button type="submit" disabled={controller.providerAuthExchangeWorking || controller.providerAuthMutation === "exchange"}>{controller.providerAuthExchangeWorking ? "Exchanging…" : "Exchange code"}</button>
        </form>}
        {controller.providerAuthError && <ErrorBox error={controller.providerAuthError} />}
        {controller.providerAuthUrlWarning && <div className="error">{sanitizeDisplayText(controller.providerAuthUrlWarning)}</div>}
        {controller.providerAuthExchangeError && <div className="error">{sanitizeDisplayText(controller.providerAuthExchangeError)}</div>}
      </section>

      <section id="settings-diagnostics" className="settings-section-card stack" role="tabpanel" aria-labelledby="settings-diagnostics-tab" tabIndex={0} hidden={activeSection !== "diagnostics"}>
        <div className="settings-section-heading"><div><span className="badge ok">sanitized</span><h2>Diagnostics</h2></div><p>Safe summaries for local troubleshooting.</p></div>
        <p className="subtle">Sanitized, read-only summaries only. Raw response bodies, catalogs, tokens, credentials, authorization codes, and session identifiers are omitted.</p>
        <dl>
          <dt>Runtime</dt><dd>{activePing?.ready ? "ready" : controller.connectionError ? "error" : "not checked"}</dd>
          <dt>Models</dt><dd>{activeModels.length} available</dd>
          <dt>Providers</dt><dd>{activeProviders.length} configured</dd>
          <dt>Demo Mode</dt><dd>{activeDemoMode?.enabled ? "enabled" : "disabled"}</dd>
          <dt>Account login</dt><dd>{activeAuth?.status ?? "not checked"}</dd>
          <dt>Host lifecycle</dt><dd>{liveRuntimeLifecycle ? `${sanitizeDisplayText(liveRuntimeLifecycle.lifecycle)} · ${sanitizeDisplayText(liveRuntimeLifecycle.status)}` : "not reported"}</dd>
        </dl>
      </section>
        </div>
      </div>
    </main>
  );
}

function ErrorBox({ error, prefix }: { error: RuntimeError; prefix?: string }) {
  return <div className="error">{prefix ? `${prefix}: ` : ""}{error.status}: {sanitizeDisplayText(error.message)}</div>;
}

function ProviderTestStatus({ state }: { state: ProviderTestState }) {
  return <div role="status" className={`provider-test-status ${state.state}`}>{sanitizeDisplayText(state.detail)}</div>;
}

function runtimeAuthMismatch(...errors: Array<RuntimeError | null | undefined>): RuntimeError | null {
  return errors.find((error) => error?.status === 401) ?? null;
}

function providerAuthState(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const state = new URL(value).searchParams.get("state") ?? undefined;
    return state && safeExchangeValue(state, 512) ? state : undefined;
  } catch {
    return undefined;
  }
}

function safeExchangeValue(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && !/[\r\n\0]/.test(value) && !/(cookie|verifier|authorization:|bearer\s)/i.test(value);
}

function isSafeAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || isLoopbackRuntimeUrl(url.origin);
  } catch {
    return false;
  }
}

function providerTestAction(status: ProviderTestState["status"]): string {
  switch (status) {
    case "missing_secret": return "Add a provider API key in the engine-owned form.";
    case "missing_model": return "Configure an available model id.";
    case "bad_url": return "Check the provider URL.";
    case "unauthorized": return "Replace the saved provider credential.";
    case "timeout":
    case "unreachable": return "Check that the provider is running and reachable.";
    default: return "Review the sanitized provider result.";
  }
}
