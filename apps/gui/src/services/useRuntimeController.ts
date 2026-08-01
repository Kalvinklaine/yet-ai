import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { CodingSessionTraceDraft } from "./codingSessionTrace";
import { disconnectProviderAuth, exchangeProviderAuth, getProviderAuthStatus, startProviderAuth, type ProviderAuthResponse } from "./providerAuthClient";
import { listProviders, testProvider, type ProviderSummary, type ProviderTestResponse } from "./providersClient";
import { sanitizeDisplayText } from "./redaction";
import { getCaps, getDemoMode, getModels, getPing, productIdentityWarning, setDemoMode, type CapsResponse, type DemoModeResponse, type ModelSummary, type PingResponse, type RuntimeError, type RuntimeSettings } from "./runtimeClient";
import type { RuntimeLifecycleDiagnostics } from "./runtimeLifecycle";

const providerAuthPendingPollFallbackSeconds = 3;
const providerAuthPendingPollMinSeconds = 1;
const providerAuthPendingPollMaxSeconds = 30;

export type RuntimeConnectionSource = "startup" | "manual" | "host.ready";

export type ProviderTestState = {
  providerId: string;
  state: "testing" | "success" | "failed";
  detail: string;
  status?: ProviderTestResponse["status"] | RuntimeError["status"];
};

type RuntimeRefreshStatus = {
  state: "checking" | "connected" | "failed";
  attempt: number;
  checkedAt: string;
  detail: string;
};

type RuntimeControllerInput = {
  settingsRef: MutableRefObject<RuntimeSettings>;
  settingsRevisionRef: MutableRefObject<number>;
  settingsRevision: number;
  appendTraceRef: MutableRefObject<(draft: CodingSessionTraceDraft) => void>;
  addTimelineRef: MutableRefObject<(entry: string) => void>;
  refreshChatsRef: MutableRefObject<(settings?: RuntimeSettings, revision?: number) => Promise<void>>;
  providerTestAction: (status: ProviderTestResponse["status"]) => string;
};

export function useRuntimeController({ settingsRef, settingsRevisionRef, settingsRevision, appendTraceRef, addTimelineRef, refreshChatsRef, providerTestAction }: RuntimeControllerInput) {
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
  const [providerAuthMutation, setProviderAuthMutation] = useState<"start" | "exchange" | "disconnect" | null>(null);
  const [providerAuthPollTick, setProviderAuthPollTick] = useState(0);
  const [runtimeDataRevision, setRuntimeDataRevision] = useState<number | null>(null);
  const [providerDataRevision, setProviderDataRevision] = useState<number | null>(null);
  const [providerAuthDataRevision, setProviderAuthDataRevision] = useState<number | null>(null);
  const [demoModeDataRevision, setDemoModeDataRevision] = useState<number | null>(null);
  const [runtimeRefreshStatus, setRuntimeRefreshStatus] = useState<RuntimeRefreshStatus | null>(null);
  const [runtimeRefreshInFlight, setRuntimeRefreshInFlight] = useState(false);

  const runtimeRefreshAttemptRef = useRef(0);
  const runtimeRefreshInFlightRef = useRef(false);
  const runtimeRefreshQueuedRef = useRef(false);
  const providerTestAttemptRef = useRef(0);
  const providerAuthMutationAttemptRef = useRef(0);
  const providerAuthExchangeInFlightRef = useRef(false);
  const providerAuthPollTimerRef = useRef<number | null>(null);
  const providerAuthPollInFlightRef = useRef(false);
  const providerAuthPollRequestRef = useRef(0);
  const providerAuthDataRevisionRef = useRef<number | null>(null);
  const providerAuthStatusRef = useRef<ProviderAuthResponse | null>(null);
  const providerAuthAuthorityRef = useRef<string | null>(null);
  const providerAuthAuthorityRequestsRef = useRef(new Map<string, number>());
  const providerAuthAuthorityAttemptRef = useRef(0);
  const providerAuthAuthorityRevisionRef = useRef(settingsRevision);
  providerAuthDataRevisionRef.current = providerAuthDataRevision;
  providerAuthStatusRef.current = providerAuthStatus;

  useEffect(() => {
    if (providerAuthAuthorityRevisionRef.current === settingsRevision) return;
    providerAuthAuthorityRevisionRef.current = settingsRevision;
    providerAuthAuthorityRef.current = null;
    providerAuthAuthorityRequestsRef.current.clear();
    providerAuthAuthorityAttemptRef.current += 1;
  }, [settingsRevision]);

  const isCurrentRefresh = useCallback((revision: number) => revision === settingsRevisionRef.current, [settingsRevisionRef]);

  const refreshRuntime = useCallback(async (targetSettings: RuntimeSettings, revision: number, keepInFlight = false) => {
    const attempt = runtimeRefreshAttemptRef.current + 1;
    runtimeRefreshAttemptRef.current = attempt;
    const checkedAt = new Date().toLocaleTimeString();
    runtimeRefreshInFlightRef.current = true;
    setRuntimeRefreshInFlight(true);
    setRuntimeRefreshStatus({ state: "checking", attempt, checkedAt, detail: "Checking runtime…" });
    appendTraceRef.current({ family: "runtime.refresh", title: "Runtime refresh started", status: "pending", summary: `Attempt ${attempt} checking local runtime.`, details: { attempt } });
    setConnectionError(null);
    setModelError(null);
    setIdentityWarnings([]);
    try {
      const [nextPing, nextCaps, nextModels, nextDemoMode] = await Promise.all([getPing(targetSettings), getCaps(targetSettings), getModels(targetSettings), getDemoMode(targetSettings)]);
      if (!isCurrentRefresh(revision)) return;
      const warnings: string[] = [];
      let lastError: RuntimeError | null = null;
      if (nextPing.ok) {
        setPing(nextPing.data);
        const warning = productIdentityWarning(nextPing.data);
        if (warning) warnings.push(warning);
      } else {
        setPing(null); setConnectionError(nextPing.error); lastError = nextPing.error;
      }
      if (nextCaps.ok) {
        setCaps(nextCaps.data);
        const warning = productIdentityWarning(nextCaps.data);
        if (warning) warnings.push(warning);
      } else {
        setCaps(null); setConnectionError(nextCaps.error); lastError = nextCaps.error;
      }
      if (nextModels.ok) setModels(nextModels.data.models);
      else { setModels([]); setModelError(nextModels.error); lastError = nextModels.error; }
      if (nextDemoMode.ok) { setDemoModeState(nextDemoMode.data); setDemoModeError(null); }
      else { setDemoModeState(null); setDemoModeError(nextDemoMode.error.status === 404 ? null : nextDemoMode.error); }
      setIdentityWarnings(warnings);
      setRuntimeDataRevision(revision);
      setDemoModeDataRevision(revision);
      setRuntimeRefreshStatus({ state: lastError ? "failed" : "connected", attempt, checkedAt: new Date().toLocaleTimeString(), detail: lastError ? `Runtime check failed: ${lastError.status} ${sanitizeDisplayText(lastError.message)}` : "Runtime connected" });
      appendTraceRef.current({ family: "runtime.refresh", title: lastError ? "Runtime refresh failed" : "Runtime refresh connected", status: lastError ? "failed" : "succeeded", summary: lastError ? `Runtime check failed: ${lastError.status} ${lastError.message}` : "Runtime connected.", details: { attempt, ready: nextPing.ok ? nextPing.data.ready : false, modelCount: nextModels.ok ? nextModels.data.models.length : 0 } });
    } catch (error) {
      const runtimeError: RuntimeError = { status: "network", message: error instanceof Error ? error.message : "Runtime refresh failed" };
      if (!isCurrentRefresh(revision)) return;
      setPing(null); setCaps(null); setModels([]); setDemoModeState(null); setIdentityWarnings([]);
      setConnectionError(runtimeError); setModelError(runtimeError); setDemoModeError(runtimeError);
      setRuntimeDataRevision(revision); setDemoModeDataRevision(revision);
      setRuntimeRefreshStatus({ state: "failed", attempt, checkedAt: new Date().toLocaleTimeString(), detail: `Runtime check failed: ${runtimeError.status} ${sanitizeDisplayText(runtimeError.message)}` });
      appendTraceRef.current({ family: "runtime.refresh", title: "Runtime refresh failed", status: "failed", summary: `Runtime check failed: ${runtimeError.status} ${runtimeError.message}`, details: { attempt } });
    } finally {
      if (!keepInFlight) { runtimeRefreshInFlightRef.current = false; setRuntimeRefreshInFlight(false); }
    }
  }, [appendTraceRef, isCurrentRefresh]);

  const refreshProviders = useCallback(async (targetSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    setProviderError(null);
    const result = await listProviders(targetSettings);
    if (!isCurrentRefresh(revision)) return;
    setProviders(result.ok ? result.data.providers : []);
    if (!result.ok) setProviderError(result.error);
    setProviderDataRevision(revision);
  }, [isCurrentRefresh, settingsRef, settingsRevisionRef]);

  const refreshProviderAuthStatus = useCallback(async (targetSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    setProviderAuthError(null); setProviderAuthUrlWarning(null); setProviderAuthExchangeError(null);
    const result = await getProviderAuthStatus(targetSettings, "openai");
    if (!isCurrentRefresh(revision)) return;
    if (result.ok) {
      setProviderAuthStatus(result.data);
    } else {
      const preserveOAuthLogin = providerAuthDataRevisionRef.current === revision
        && providerAuthStatusRef.current?.authSource === "oauth"
        && (providerAuthStatusRef.current.status === "pending" || providerAuthStatusRef.current.status === "connected");
      if (!preserveOAuthLogin) setProviderAuthStatus(null);
      setProviderAuthError(result.error);
    }
    setProviderAuthDataRevision(revision);
  }, [isCurrentRefresh, settingsRef, settingsRevisionRef]);

  const connect = useCallback(async () => {
    if (runtimeRefreshInFlightRef.current) { runtimeRefreshQueuedRef.current = true; return; }
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
        await refreshChatsRef.current(targetSettings, targetRevision);
      } while (runtimeRefreshQueuedRef.current);
    } finally {
      runtimeRefreshInFlightRef.current = false;
      runtimeRefreshQueuedRef.current = false;
      setRuntimeRefreshInFlight(false);
    }
  }, [refreshChatsRef, refreshProviderAuthStatus, refreshProviders, refreshRuntime, settingsRef, settingsRevisionRef]);

  const toggleDemoMode = useCallback(async (enabled: boolean) => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    setDemoModeWorking(true); setDemoModeError(null);
    const result = await setDemoMode(targetSettings, enabled);
    if (!isCurrentRefresh(targetRevision)) return;
    setDemoModeWorking(false);
    if (result.ok) {
      setDemoModeState(result.data); setDemoModeDataRevision(targetRevision);
      addTimelineRef.current(`Demo Mode ${enabled ? "enabled" : "disabled"} in local runtime`);
      await refreshRuntime(targetSettings, targetRevision);
      await refreshProviders(targetSettings, targetRevision);
    } else {
      setDemoModeError(result.error); setDemoModeDataRevision(targetRevision);
      addTimelineRef.current(`Demo Mode error: ${sanitizeDisplayText(result.error.message)}`);
    }
  }, [addTimelineRef, isCurrentRefresh, refreshProviders, refreshRuntime, settingsRef, settingsRevisionRef]);

  const pollProviderAuthStatus = useCallback(async (targetSettings: RuntimeSettings, revision: number, requestId: number) => {
    if (providerAuthPollInFlightRef.current) return;
    providerAuthPollInFlightRef.current = true;
    try {
      setProviderAuthError(null); setProviderAuthUrlWarning(null); setProviderAuthExchangeError(null);
      const result = await getProviderAuthStatus(targetSettings, "openai");
      if (!isCurrentRefresh(revision) || providerAuthPollRequestRef.current !== requestId) return;
      const completedPendingLogin = result.ok
        && providerAuthDataRevisionRef.current === revision
        && providerAuthStatusRef.current?.status === "pending"
        && providerAuthStatusRef.current.authSource === "oauth"
        && result.data.status === "connected";
      if (result.ok) {
        setProviderAuthStatus(result.data);
        providerAuthStatusRef.current = result.data;
      } else {
        setProviderAuthError(result.error);
      }
      setProviderAuthDataRevision(revision);
      if (completedPendingLogin) await connect();
    } finally {
      if (providerAuthPollRequestRef.current === requestId) {
        providerAuthPollInFlightRef.current = false;
        if (isCurrentRefresh(revision)) setProviderAuthPollTick((tick) => tick + 1);
      }
    }
  }, [connect, isCurrentRefresh]);

  const activeProviderAuthStatus = providerAuthDataRevision === settingsRevision ? providerAuthStatus : null;
  useEffect(() => {
    if (providerAuthPollTimerRef.current !== null) window.clearTimeout(providerAuthPollTimerRef.current);
    providerAuthPollTimerRef.current = null;
    if (activeProviderAuthStatus?.status !== "pending" || activeProviderAuthStatus.authSource !== "oauth") return;
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const delaySeconds = normalizeProviderAuthPollIntervalSeconds(activeProviderAuthStatus.pollIntervalSeconds);
    providerAuthPollTimerRef.current = window.setTimeout(() => {
      providerAuthPollTimerRef.current = null;
      void pollProviderAuthStatus(targetSettings, targetRevision, providerAuthPollRequestRef.current);
    }, delaySeconds * 1000);
    return () => {
      if (providerAuthPollTimerRef.current !== null) window.clearTimeout(providerAuthPollTimerRef.current);
      providerAuthPollTimerRef.current = null;
    };
  }, [activeProviderAuthStatus?.authSource, activeProviderAuthStatus?.pollIntervalSeconds, activeProviderAuthStatus?.sessionId, activeProviderAuthStatus?.status, pollProviderAuthStatus, providerAuthPollTick, settingsRef, settingsRevision, settingsRevisionRef]);

  useEffect(() => {
    if (activeProviderAuthStatus?.status === "pending") return;
    providerAuthExchangeInFlightRef.current = false;
    setProviderAuthExchangeWorking(false); setProviderAuthExchangeCode(""); setProviderAuthExchangeError(null);
  }, [activeProviderAuthStatus?.status]);

  const runtimeLifecycleChanged = useCallback((diagnostics: RuntimeLifecycleDiagnostics, authorityKey: string | null = null) => {
    if (diagnostics.lifecycle !== "connected" && diagnostics.lifecycle !== "degraded") return;
    const revisionIsStale = providerAuthDataRevisionRef.current !== settingsRevisionRef.current;
    if (authorityKey === null) {
      if (revisionIsStale) void refreshProviderAuthStatus();
      return;
    }
    if ((!revisionIsStale && providerAuthAuthorityRef.current === authorityKey) || providerAuthAuthorityRequestsRef.current.has(authorityKey)) return;
    const authorityAttempt = providerAuthAuthorityAttemptRef.current + 1;
    providerAuthAuthorityAttemptRef.current = authorityAttempt;
    providerAuthAuthorityRequestsRef.current.set(authorityKey, authorityAttempt);
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    void refreshProviderAuthStatus(targetSettings, targetRevision).then(() => {
      if (isCurrentRefresh(targetRevision) && providerAuthAuthorityAttemptRef.current === authorityAttempt) {
        providerAuthAuthorityRef.current = authorityKey;
      }
    }).finally(() => {
      if (providerAuthAuthorityRequestsRef.current.get(authorityKey) === authorityAttempt) {
        providerAuthAuthorityRequestsRef.current.delete(authorityKey);
      }
    });
  }, [isCurrentRefresh, refreshProviderAuthStatus, settingsRef, settingsRevisionRef]);

  const beginProviderAuthMutation = useCallback((mutation: "start" | "exchange" | "disconnect") => {
    const attempt = providerAuthMutationAttemptRef.current + 1;
    providerAuthMutationAttemptRef.current = attempt;
    setProviderAuthMutation(mutation);
    return attempt;
  }, []);

  const startOpenAiLogin = useCallback(async (blocked: boolean, openAuthUrl: (url: string) => void) => {
    if (blocked) { setProviderAuthError(null); setProviderAuthUrlWarning(null); setProviderAuthExchangeError(null); setProviderAuthExchangeCode(""); return; }
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = beginProviderAuthMutation("start");
    setProviderAuthError(null); setProviderAuthUrlWarning(null); setProviderAuthExchangeError(null); setProviderAuthExchangeCode("");
    try {
      const result = await startProviderAuth(targetSettings, "openai", { experimentalCodexLike: true });
      if (!isCurrentRefresh(targetRevision) || providerAuthMutationAttemptRef.current !== attempt) return;
      if (!result.ok) { setProviderAuthError(result.error); return; }
      setProviderAuthStatus(result.data); setProviderAuthDataRevision(targetRevision);
      if (result.data.authorizationUrl) openAuthUrl(result.data.authorizationUrl);
    } finally {
      if (isCurrentRefresh(targetRevision) && providerAuthMutationAttemptRef.current === attempt) setProviderAuthMutation(null);
    }
  }, [beginProviderAuthMutation, isCurrentRefresh, settingsRef, settingsRevisionRef]);

  const disconnectOpenAiLogin = useCallback(async () => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = beginProviderAuthMutation("disconnect");
    setProviderAuthError(null); setProviderAuthUrlWarning(null); setProviderAuthExchangeError(null); setProviderAuthExchangeCode("");
    try {
      const result = await disconnectProviderAuth(targetSettings, "openai");
      if (!isCurrentRefresh(targetRevision) || providerAuthMutationAttemptRef.current !== attempt) return;
      if (result.ok) { setProviderAuthStatus(result.data); setProviderAuthDataRevision(targetRevision); await connect(); }
      else setProviderAuthError(result.error);
    } finally {
      if (isCurrentRefresh(targetRevision) && providerAuthMutationAttemptRef.current === attempt) setProviderAuthMutation(null);
    }
  }, [beginProviderAuthMutation, connect, isCurrentRefresh, settingsRef, settingsRevisionRef]);

  const exchangeOpenAiLoginCode = useCallback(async (sessionId: string | undefined, state: string | undefined) => {
    const code = providerAuthExchangeCode.trim();
    setProviderAuthExchangeCode("");
    if (!sessionId || !code || providerAuthExchangeInFlightRef.current || providerAuthExchangeWorking || providerAuthMutation === "exchange") return false;
    setProviderAuthError(null); setProviderAuthExchangeError(null);
    providerAuthExchangeInFlightRef.current = true; setProviderAuthExchangeWorking(true);
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = beginProviderAuthMutation("exchange");
    try {
      const result = await exchangeProviderAuth(targetSettings, "openai", sessionId, code, state);
      if (!isCurrentRefresh(targetRevision) || providerAuthMutationAttemptRef.current !== attempt) return false;
      if (result.ok) {
        setProviderAuthStatus(result.data); setProviderAuthDataRevision(targetRevision);
        if (result.data.success) { await connect(); if (isCurrentRefresh(targetRevision)) { setProviderAuthStatus(result.data); setProviderAuthDataRevision(targetRevision); } }
        else setProviderAuthExchangeError("Authorization exchange did not complete. Retry once with a fresh browser code, reconnect, or use the API-key fallback.");
      } else setProviderAuthError(result.error);
      return result.ok && result.data.success;
    } finally {
      if (isCurrentRefresh(targetRevision) && providerAuthMutationAttemptRef.current === attempt) {
        providerAuthExchangeInFlightRef.current = false; setProviderAuthExchangeWorking(false); setProviderAuthMutation(null);
      }
    }
  }, [beginProviderAuthMutation, connect, isCurrentRefresh, providerAuthExchangeCode, providerAuthExchangeWorking, providerAuthMutation, settingsRef, settingsRevisionRef]);

  const runProviderTest = useCallback(async (providerId: string) => {
    const targetSettings = settingsRef.current;
    const targetRevision = settingsRevisionRef.current;
    const attempt = providerTestAttemptRef.current + 1;
    providerTestAttemptRef.current = attempt;
    setProviderTestState({ providerId, state: "testing", detail: "Testing provider reachability…" });
    const result = await testProvider(targetSettings, providerId);
    if (!isCurrentRefresh(targetRevision) || providerTestAttemptRef.current !== attempt) return false;
    if (result.ok) {
      const model = result.data.modelId ? ` Model: ${sanitizeDisplayText(result.data.modelId)}.` : "";
      const action = providerTestAction(result.data.status);
      setProviderTestState({ providerId, state: result.data.ok ? "success" : "failed", status: result.data.status, detail: `${sanitizeDisplayText(result.data.message)}${model}${action ? ` ${action}` : ""}` });
      if (result.data.ok) await connect();
    } else setProviderTestState({ providerId, state: "failed", status: result.error.status, detail: sanitizeDisplayText(result.error.message) });
    return result.ok && result.data.ok;
  }, [connect, isCurrentRefresh, providerTestAction, settingsRef, settingsRevisionRef]);

  const invalidate = useCallback(() => {
    providerTestAttemptRef.current += 1;
    providerAuthMutationAttemptRef.current += 1;
    providerAuthExchangeInFlightRef.current = false;
    providerAuthPollInFlightRef.current = false;
    providerAuthPollRequestRef.current += 1;
    providerAuthAuthorityRef.current = null;
    providerAuthAuthorityRequestsRef.current.clear();
    providerAuthAuthorityAttemptRef.current += 1;
    setRuntimeDataRevision(null); setProviderDataRevision(null); setProviderAuthDataRevision(null); setDemoModeDataRevision(null);
    setDemoModeWorking(false); setProviderAuthMutation(null); setProviderAuthExchangeCode(""); setProviderAuthExchangeWorking(false); setProviderAuthExchangeError(null); setProviderTestState(null);
    setRuntimeRefreshStatus({ state: "checking", attempt: runtimeRefreshAttemptRef.current + 1, checkedAt: new Date().toLocaleTimeString(), detail: "Runtime settings changed; checking current runtime…" });
  }, []);

  const clearRuntimeData = useCallback(() => {
    setRuntimeDataRevision(null); setProviderDataRevision(null); setProviderAuthDataRevision(null); setDemoModeDataRevision(null);
    providerAuthExchangeInFlightRef.current = false; setProviderAuthExchangeWorking(false); setProviderAuthExchangeCode(""); setProviderAuthExchangeError(null);
    providerAuthAuthorityRef.current = null; providerAuthAuthorityRequestsRef.current.clear(); providerAuthAuthorityAttemptRef.current += 1;
  }, []);

  return useMemo(() => ({
    ping, caps, models, demoMode, demoModeError, demoModeWorking, providers, connectionError, modelError, identityWarnings, providerError, providerTestState,
    providerAuthError, providerAuthStatus, providerAuthUrlWarning, providerAuthExchangeCode, providerAuthExchangeError, providerAuthExchangeWorking, providerAuthMutation,
    runtimeDataRevision, providerDataRevision, providerAuthDataRevision, demoModeDataRevision, runtimeRefreshStatus, runtimeRefreshInFlight,
    runtimeRefreshAttemptRef, runtimeRefreshInFlightRef, runtimeRefreshQueuedRef, providerTestAttemptRef,
    setProviderError, setProviderTestState, setProviderAuthError, setProviderAuthStatus, setProviderAuthUrlWarning, setProviderAuthExchangeCode, setProviderAuthExchangeError,
    setRuntimeDataRevision, setProviderDataRevision, setProviderAuthDataRevision, setDemoModeDataRevision, setRuntimeRefreshStatus,
    refreshRuntime, refreshProviders, refreshProviderAuthStatus, connect, toggleDemoMode, runProviderTest, startOpenAiLogin, disconnectOpenAiLogin, exchangeOpenAiLoginCode, invalidate, clearRuntimeData, runtimeLifecycleChanged, isCurrentRefresh,
  }), [ping, caps, models, demoMode, demoModeError, demoModeWorking, providers, connectionError, modelError, identityWarnings, providerError, providerTestState, providerAuthError, providerAuthStatus, providerAuthUrlWarning, providerAuthExchangeCode, providerAuthExchangeError, providerAuthExchangeWorking, providerAuthMutation, runtimeDataRevision, providerDataRevision, providerAuthDataRevision, demoModeDataRevision, runtimeRefreshStatus, runtimeRefreshInFlight, refreshRuntime, refreshProviders, refreshProviderAuthStatus, connect, toggleDemoMode, runProviderTest, startOpenAiLogin, disconnectOpenAiLogin, exchangeOpenAiLoginCode, invalidate, clearRuntimeData, runtimeLifecycleChanged, isCurrentRefresh]);
}

function normalizeProviderAuthPollIntervalSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return providerAuthPendingPollFallbackSeconds;
  return Math.min(providerAuthPendingPollMaxSeconds, Math.max(providerAuthPendingPollMinSeconds, Math.floor(value)));
}
