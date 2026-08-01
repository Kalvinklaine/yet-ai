// @vitest-environment jsdom
import React, { act, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRuntimeController } from "./useRuntimeController";
import type { RuntimeSettings } from "./runtimeClient";
import type { RuntimeLifecycleDiagnostics } from "./runtimeLifecycle";

let root: ReactDOM.Root | undefined;
const fetchMock = vi.fn();

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

type Controller = ReturnType<typeof useRuntimeController>;

function Probe({ settings, revision, onChange, refreshChats = async () => undefined }: { settings: RuntimeSettings; revision: number; onChange: (controller: Controller) => void; refreshChats?: (settings?: RuntimeSettings, revision?: number) => Promise<void> }) {
  const settingsRef = useRef(settings);
  const revisionRef = useRef(revision);
  const appendTraceRef = useRef(() => undefined);
  const addTimelineRef = useRef(() => undefined);
  const refreshChatsRef = useRef(refreshChats);
  settingsRef.current = settings;
  revisionRef.current = revision;
  refreshChatsRef.current = refreshChats;
  const controller = useRuntimeController({
    settingsRef,
    settingsRevisionRef: revisionRef,
    settingsRevision: revision,
    appendTraceRef,
    addTimelineRef,
    refreshChatsRef,
    providerTestAction: () => "",
  });
  useEffect(() => onChange(controller), [controller, onChange]);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function runtimeReply(url: string, identity = "yet-ai") {
  if (url.endsWith("/v1/ping")) return response({ productId: identity, displayName: identity === "yet-ai" ? "Yet AI" : "Other", version: "0", ready: true, serverTime: "now" });
  if (url.endsWith("/v1/caps")) return response({ productId: identity, protocolVersion: "1", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
  if (url.endsWith("/v1/models")) return response({ models: [{ id: url.includes("8765") ? "new" : "old", displayName: "Model" }] });
  if (url.endsWith("/v1/demo-mode")) return response({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "off" });
  if (url.endsWith("/v1/providers")) return response({ providers: [], cloudRequired: false, providerAccess: "direct" });
  if (url.endsWith("/v1/provider-auth/openai/status")) return response({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: true, supportsApiKey: true, cloudRequired: false });
  return response({});
}

async function mount(onChange: (controller: Controller) => void, settings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" as const }, revision = 0, refreshChats?: (settings?: RuntimeSettings, revision?: number) => Promise<void>) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(<Probe settings={settings} revision={revision} onChange={onChange} refreshChats={refreshChats} />);
  });
  return container;
}

describe("useRuntimeController", () => {
  it("refreshes auth once per accepted runtime authority at the same settings revision", async () => {
    const authorityRefresh = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 2) return authorityRefresh.promise;
      }
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    const connected = { lifecycle: "connected" } as RuntimeLifecycleDiagnostics;

    await act(async () => {
      controller.runtimeLifecycleChanged(connected, "authority-a");
      controller.runtimeLifecycleChanged(connected, "authority-a");
      await Promise.resolve();
    });
    expect(authCalls).toBe(2);

    authorityRefresh.resolve(runtimeReply("http://127.0.0.1:8001/v1/provider-auth/openai/status"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { controller.runtimeLifecycleChanged(connected, "authority-a"); await Promise.resolve(); });
    expect(authCalls).toBe(2);

    await act(async () => { controller.runtimeLifecycleChanged(connected, "authority-b"); await Promise.resolve(); });
    expect(authCalls).toBe(3);
  });

  it("hides old-authority auth, retries a failed switch, and ignores a late old-authority completion", async () => {
    const lateAuthorityA = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 2) return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "authority-a" }));
        if (authCalls === 3) return lateAuthorityA.promise;
        if (authCalls === 4) return Promise.resolve(new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "Content-Type": "application/json" } }));
        if (authCalls === 5) return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "authority-b" }));
      }
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    const currentSettings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" as const };
    await mount((next) => { controller = next; }, currentSettings);
    await act(async () => { await controller.connect(); });
    const connected = { lifecycle: "connected" } as RuntimeLifecycleDiagnostics;

    await act(async () => { controller.runtimeLifecycleChanged(connected, "authority-a"); await Promise.resolve(); await Promise.resolve(); });
    expect(controller.providerAuthStatus).toMatchObject({ status: "connected", accountLabel: "authority-a" });

    await act(async () => {
      void controller.refreshProviderAuthStatus(currentSettings, 0);
      await Promise.resolve();
      controller.runtimeLifecycleChanged(connected, "authority-b");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(controller.providerAuthDataRevision).toBeNull();
    expect(controller.providerAuthStatus).toBeNull();

    await act(async () => { controller.runtimeLifecycleChanged(connected, "authority-b"); await Promise.resolve(); await Promise.resolve(); });
    expect(controller.providerAuthStatus).toMatchObject({ status: "connected", accountLabel: "authority-b" });

    lateAuthorityA.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "late-authority-a" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(controller.providerAuthStatus).toMatchObject({ status: "connected", accountLabel: "authority-b" });
    expect(authCalls).toBe(5);
  });

  it("does not let a pending poll overwrite a successful disconnect", async () => {
    vi.useFakeTimers();
    const stalePoll = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 1) return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1 }));
        if (authCalls === 2) return stalePoll.promise;
        return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1 }));
      }
      if (url.endsWith("/v1/provider-auth/openai/disconnect") && init?.method === "POST") return Promise.resolve(response({ provider: "openai", configured: false, status: "revoked", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true }));
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    await act(async () => { await controller.disconnectOpenAiLogin(); });
    stalePoll.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(controller.providerAuthStatus?.status).toBe("revoked");
  });

  it("does not let a pending poll overwrite a successful exchange", async () => {
    vi.useFakeTimers();
    const stalePoll = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 1) return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1, sessionId: "session-1" }));
        if (authCalls === 2) return stalePoll.promise;
        return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1 }));
      }
      if (url.endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST") return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true }));
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    await act(async () => { controller.setProviderAuthExchangeCode("code"); });
    await act(async () => { await controller.exchangeOpenAiLoginCode("session-1", "state-1"); });
    stalePoll.resolve(response({ provider: "openai", configured: false, status: "expired", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(controller.providerAuthStatus?.status).toBe("connected");
  });

  it("invalidates an older lifecycle auth refresh when login start begins and allows a later authority refresh", async () => {
    const staleLifecycleRefresh = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 2) return staleLifecycleRefresh.promise;
        if (authCalls === 3) return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "authority-a" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/start") && init?.method === "POST") return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true, authorizationUrl: "https://login.example.test" }));
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    const connected = { lifecycle: "connected" } as RuntimeLifecycleDiagnostics;

    await act(async () => {
      controller.runtimeLifecycleChanged(connected, "authority-a");
      await Promise.resolve();
    });
    expect(authCalls).toBe(2);

    await act(async () => { await controller.startOpenAiLogin(false, vi.fn()); });
    expect(controller.providerAuthStatus?.status).toBe("pending");

    staleLifecycleRefresh.resolve(response({ provider: "openai", configured: false, status: "expired", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(controller.providerAuthStatus?.status).toBe("pending");

    await act(async () => {
      controller.runtimeLifecycleChanged(connected, "authority-a");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(authCalls).toBe(3);
    expect(controller.providerAuthStatus).toMatchObject({ status: "connected", accountLabel: "authority-a" });
  });

  it("defers and coalesces lifecycle auth refreshes until an active login start finishes", async () => {
    const delayedStart = deferred<Response>();
    const deferredLifecycleRefresh = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 2) return deferredLifecycleRefresh.promise;
      }
      if (url.endsWith("/v1/provider-auth/openai/start") && init?.method === "POST") return delayedStart.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    const connected = { lifecycle: "connected" } as RuntimeLifecycleDiagnostics;

    await act(async () => {
      void controller.startOpenAiLogin(false, vi.fn());
      controller.runtimeLifecycleChanged(connected, "authority-a");
      controller.runtimeLifecycleChanged(connected, "authority-a");
      await Promise.resolve();
    });

    expect(authCalls).toBe(1);
    expect(controller.providerAuthMutation).toBe("start");

    delayedStart.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true, authorizationUrl: "https://login.example.test" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(authCalls).toBe(2);
    expect(controller.providerAuthStatus?.status).toBe("pending");
    expect(controller.providerAuthMutation).toBeNull();

    deferredLifecycleRefresh.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "authority-a" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(controller.providerAuthStatus).toMatchObject({ status: "connected", accountLabel: "authority-a" });
    await act(async () => { controller.runtimeLifecycleChanged(connected, "authority-a"); await Promise.resolve(); });
    expect(authCalls).toBe(2);
  });

  it("runs one deferred lifecycle refresh after a failed login start", async () => {
    const delayedStart = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 1) return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "safe-account" }));
        return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "refreshed-account" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/start") && init?.method === "POST") return delayedStart.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    const connected = { lifecycle: "connected" } as RuntimeLifecycleDiagnostics;

    await act(async () => {
      void controller.startOpenAiLogin(false, vi.fn());
      controller.runtimeLifecycleChanged(connected, "authority-a");
      await Promise.resolve();
    });

    expect(authCalls).toBe(1);
    expect(controller.providerAuthStatus).toMatchObject({ accountLabel: "safe-account" });

    delayedStart.resolve(new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "Content-Type": "application/json" } }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(authCalls).toBe(2);
    expect(controller.providerAuthStatus).toMatchObject({ status: "connected", accountLabel: "refreshed-account" });
    expect(controller.providerAuthError).toBeNull();
  });

  it.each(["exchange", "disconnect"] as const)("does not start a lifecycle auth refresh during delayed %s", async (mutation) => {
    const delayedMutation = deferred<Response>();
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        return Promise.resolve(response({ provider: "openai", configured: mutation === "disconnect", status: mutation === "exchange" ? "pending" : "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, sessionId: "session-1" }));
      }
      if (url.endsWith(`/v1/provider-auth/openai/${mutation}`) && init?.method === "POST") return delayedMutation.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    const connected = { lifecycle: "connected" } as RuntimeLifecycleDiagnostics;
    if (mutation === "exchange") await act(async () => { controller.setProviderAuthExchangeCode("code"); });

    await act(async () => {
      if (mutation === "exchange") {
        void controller.exchangeOpenAiLoginCode("session-1", "state-1");
      } else {
        void controller.disconnectOpenAiLogin();
      }
      controller.runtimeLifecycleChanged(connected, "authority-a");
      await Promise.resolve();
    });

    expect(authCalls).toBe(1);

    delayedMutation.resolve(response({ provider: "openai", configured: mutation === "exchange", status: mutation === "exchange" ? "connected" : "revoked", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(authCalls).toBe(2);
    expect(controller.providerAuthStatus?.status).toBe(mutation === "exchange" ? "connected" : "revoked");
  });

  it("ignores a stale login start completion after runtime data is cleared", async () => {
    const staleStart = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/start") && init?.method === "POST") return staleStart.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    await act(async () => { void controller.startOpenAiLogin(false, vi.fn()); await Promise.resolve(); controller.clearRuntimeData(); });
    staleStart.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true, authorizationUrl: "https://login.example.test" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(controller.providerAuthStatus).toBeNull();
    expect(controller.providerAuthDataRevision).toBeNull();
    expect(controller.providerAuthMutation).toBeNull();
  });

  it.each([
    ["start", "/v1/provider-auth/openai/start", "startOpenAiLogin"],
    ["disconnect", "/v1/provider-auth/openai/disconnect", "disconnectOpenAiLogin"],
  ] as const)("preserves connected auth when %s fails", async (_mutation, endpoint, action) => {
    vi.useFakeTimers();
    const refreshChats = vi.fn(async () => undefined);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, accountLabel: "safe-account", redacted: "safe-redaction", message: "Engine-confirmed connection" }));
      if (url.endsWith(endpoint) && init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ error: "failed access_token=private-token" }), { status: 503, headers: { "Content-Type": "application/json" } }));
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; }, undefined, 0, refreshChats);
    await act(async () => { await controller.connect(); });
    fetchMock.mockClear();
    refreshChats.mockClear();

    await act(async () => {
      if (action === "startOpenAiLogin") await controller.startOpenAiLogin(false, vi.fn());
      else await controller.disconnectOpenAiLogin();
    });

    expect(controller.providerAuthStatus).toMatchObject({ configured: true, status: "connected", authSource: "oauth", accountLabel: "safe-account", redacted: "safe-redaction", message: "Engine-confirmed connection" });
    expect(controller.providerAuthMutation).toBeNull();
    expect(controller.providerAuthError).toMatchObject({ status: 503 });
    expect(controller.providerAuthError?.message).not.toContain("private-token");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(endpoint))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status"))).toHaveLength(0);
    expect(refreshChats).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status"))).toHaveLength(0);
  });

  it("ignores a stale reconnect completion after the settings revision changes", async () => {
    const staleStart = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/provider-auth/openai/status") return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
      if (url === "http://127.0.0.1:8001/v1/provider-auth/openai/start" && init?.method === "POST") return staleStart.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    const onChange = (next: Controller) => { controller = next; };
    await mount(onChange);
    await act(async () => { await controller.connect(); });
    await act(async () => { void controller.startOpenAiLogin(false, vi.fn()); await Promise.resolve(); });

    await act(async () => {
      root?.render(<Probe settings={{ baseUrl: "http://127.0.0.1:8765", token: "latest", runtimeAccess: "direct" }} revision={1} onChange={onChange} />);
      staleStart.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true, authorizationUrl: "https://private.example.test" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.providerAuthStatus?.status).toBe("connected");
    expect(controller.providerAuthDataRevision).toBe(0);
  });

  it("preserves callback-connected auth when the shared status refresh fails once", async () => {
    vi.useFakeTimers();
    let authCalls = 0;
    const refreshChats = vi.fn(async () => undefined);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 1) return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1 }));
        if (authCalls === 2) return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
        if (authCalls === 3) return Promise.resolve(new Response(JSON.stringify({ error: "temporary access_token=private" }), { status: 503, headers: { "Content-Type": "application/json" } }));
        return Promise.resolve(response({ provider: "openai", configured: false, status: "expired", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
      }
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; }, undefined, 0, refreshChats);
    await act(async () => { await controller.connect(); });
    fetchMock.mockClear();
    refreshChats.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.providerAuthStatus?.status).toBe("connected");
    expect(controller.providerAuthError?.status).toBe(503);
    expect(controller.providerAuthError?.message).not.toContain("private");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/models"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/providers"))).toHaveLength(1);
    expect(refreshChats).toHaveBeenCalledTimes(1);
    expect(refreshChats).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://127.0.0.1:8001" }), 0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats") && init?.method === "POST")).toHaveLength(0);

    await act(async () => { await controller.refreshProviderAuthStatus(); });

    expect(controller.providerAuthStatus?.status).toBe("expired");
    expect(controller.providerAuthError).toBeNull();
  });

  it("keeps pending auth through a transient poll failure and refreshes after connection", async () => {
    vi.useFakeTimers();
    let authCalls = 0;
    const refreshChats = vi.fn(async () => undefined);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 1) return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1 }));
        if (authCalls === 2) return Promise.resolve(new Response(JSON.stringify({ error: "temporary access_token=private" }), { status: 503, headers: { "Content-Type": "application/json" } }));
        return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
      }
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; }, undefined, 0, refreshChats);
    await act(async () => { await controller.connect(); });
    fetchMock.mockClear();
    refreshChats.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.providerAuthStatus?.status).toBe("pending");
    expect(controller.providerAuthError?.status).toBe(503);
    expect(controller.providerAuthError?.message).not.toContain("private");
    expect(refreshChats).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.providerAuthStatus?.status).toBe("connected");
    expect(refreshChats).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status"))).toHaveLength(3);
  });

  it("keeps pending auth through a shared refresh failure and completes through polling", async () => {
    vi.useFakeTimers();
    let authCalls = 0;
    const refreshChats = vi.fn(async () => undefined);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        authCalls += 1;
        if (authCalls === 1) return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1 }));
        if (authCalls === 2) return Promise.resolve(new Response(JSON.stringify({ error: "temporary access_token=private" }), { status: 503, headers: { "Content-Type": "application/json" } }));
        return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
      }
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; }, undefined, 0, refreshChats);
    await act(async () => { await controller.connect(); });
    refreshChats.mockClear();

    await act(async () => { await controller.connect(); });

    expect(controller.providerAuthStatus?.status).toBe("pending");
    expect(controller.providerAuthError?.status).toBe(503);
    expect(controller.providerAuthError?.message).not.toContain("private");
    expect(refreshChats).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    refreshChats.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.providerAuthStatus?.status).toBe("connected");
    expect(refreshChats).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats") && init?.method === "POST")).toHaveLength(0);
  });

  it("keeps manual exchange on the shared refresh path at the current settings revision", async () => {
    const refreshChats = vi.fn(async () => undefined);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, sessionId: "session-1" }));
      if (url.endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST") return Promise.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, success: true }));
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; }, { baseUrl: "http://127.0.0.1:8765", token: "current", runtimeAccess: "direct" }, 4, refreshChats);
    await act(async () => { await controller.connect(); });
    refreshChats.mockClear();
    await act(async () => { controller.setProviderAuthExchangeCode("manual-code"); });
    await act(async () => { await controller.exchangeOpenAiLoginCode("session-1", "state-1"); });

    expect(refreshChats).toHaveBeenCalledTimes(1);
    expect(refreshChats).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://127.0.0.1:8765", token: "current" }), 4);
    expect(controller.providerAuthStatus?.status).toBe("connected");
  });

  it("ignores a stale connected polling completion after the settings revision changes", async () => {
    vi.useFakeTimers();
    const stalePoll = deferred<Response>();
    const refreshChats = vi.fn(async () => undefined);
    let authCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/provider-auth/openai/status") {
        authCalls += 1;
        if (authCalls > 1) return stalePoll.promise;
        return Promise.resolve(response({ provider: "openai", configured: false, status: "pending", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false, pollIntervalSeconds: 1 }));
      }
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    const onChange = (next: Controller) => { controller = next; };
    const oldSettings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" as const };
    await mount(onChange, oldSettings, 0, refreshChats);
    await act(async () => { await controller.connect(); });
    refreshChats.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    await act(async () => {
      root?.render(<Probe settings={{ baseUrl: "http://127.0.0.1:8765", token: "latest", runtimeAccess: "direct" }} revision={1} onChange={onChange} refreshChats={refreshChats} />);
      stalePoll.resolve(response({ provider: "openai", configured: true, status: "connected", authSource: "oauth", supportsLogin: true, supportsApiKey: true, cloudRequired: false }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.providerAuthStatus?.status).not.toBe("connected");
    expect(refreshChats).not.toHaveBeenCalled();
  });

  it("ignores stale runtime results after the settings generation changes", async () => {
    const oldPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") return oldPing.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    const onChange = (next: Controller) => { controller = next; };
    await mount(onChange);
    await act(async () => { void controller.connect(); await Promise.resolve(); });
    await act(async () => {
      root?.render(<Probe settings={{ baseUrl: "http://127.0.0.1:8765", token: "", runtimeAccess: "direct" }} revision={1} onChange={onChange} />);
      oldPing.resolve(runtimeReply("http://127.0.0.1:8001/v1/ping"));
      await Promise.resolve();
    });
    expect(controller.runtimeDataRevision).not.toBe(0);
    expect(controller.models).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "old" })]));
  });

  it("queues a refresh and uses the latest settings after the active refresh completes", async () => {
    const oldPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") return oldPing.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    const onChange = (next: Controller) => { controller = next; };
    await mount(onChange);
    await act(async () => { void controller.connect(); await Promise.resolve(); });
    await act(async () => {
      root?.render(<Probe settings={{ baseUrl: "http://127.0.0.1:8765", token: "latest", runtimeAccess: "direct" }} revision={1} onChange={onChange} />);
      void controller.connect();
      oldPing.resolve(runtimeReply("http://127.0.0.1:8001/v1/ping"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("http://127.0.0.1:8765/") && new Headers(init?.headers).get("Authorization") === "Bearer latest")).toBe(true);
  });

  it("preserves identity mismatch warnings for the current generation only", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => Promise.resolve(runtimeReply(String(input), "other")));
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    expect(controller.identityWarnings).toHaveLength(2);
    expect(controller.identityWarnings.every((warning) => warning.includes("Runtime identity mismatch"))).toBe(true);
  });
});
