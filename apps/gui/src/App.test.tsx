import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App, completedApplyRequestChatsLimit, completedIdeActionRequestChatsLimit, generateApplyRequestSessionNonce, rememberCompletedApplyRequest, rememberCompletedIdeActionRequest } from "./App";
import type { ProviderAuthResponse, ProviderAuthStatus } from "./services/providerAuthClient";

const bridgeVersion = "2026-05-15";
const fetchMock = vi.fn();

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  delete window.acquireVsCodeApi;
  delete window.postIntellijMessage;
  vi.restoreAllMocks();
});

describe("runtime refresh feedback", () => {
  it("manual Refresh runtime click shows in-flight feedback before resolving and then success status", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockClear();

    const ping = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/ping")) {
        return ping.promise;
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          protocolVersion: "2026-05-15",
          runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
          capabilities: [],
          features: {},
          providers: [],
          ide: { bridge: true, lsp: false },
        }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: readyRuntimeOptions().models }));
      }
      return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
    });

    act(() => {
      findButton("Refresh runtime").click();
    });

    expect(findButton("Checking runtime…").disabled).toBe(true);
    expect(container?.textContent).toContain("Checking runtime…");
    expect(container?.textContent).toContain("Attempt 2 at");

    ping.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();

    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).toContain("Attempt 2 at");
    expect(findButton("Refresh runtime").disabled).toBe(false);
  });

  it("failed Refresh runtime attempts are visibly distinguishable", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Runtime check failed");
    expect(container?.textContent).toContain("Attempt 1 at");

    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Runtime check failed");
    expect(container?.textContent).toContain("Attempt 2 at");
    expect(findButton("Refresh runtime").disabled).toBe(false);
  });

  it("clears stale runtime models when model refresh fails", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockClear();
    mockRuntimeResponses({ providers: [enabledProvider()], modelsFailure: true });

    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Runtime check failed: 503 models unavailable");
    expect(container?.textContent).toContain("Models refresh failed: 503: models unavailable");
    expect(container?.textContent).toContain("State: Provider required");
    expect(container?.textContent).toContain("Runtime model refresh failed. Refresh runtime again before sending the first message.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders Session token guidance and does not persist a manually entered token", async () => {
    const runtimeToken = "local-dev-token-secret";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("normally supplied automatically by the IDE host through trusted host.ready");
    expect(container?.textContent).toContain("YET_AI_AUTH_TOKEN");
    expect(container?.textContent).toContain("This local runtime token authorizes the GUI to the loopback runtime; it is not an OpenAI key or provider API key");

    await act(async () => {
      setInputValue(sessionTokenInput(), runtimeToken);
    });

    expect(sessionTokenInput().value).toBe(runtimeToken);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(runtimeToken);
  });

  it("disables Session token autocomplete", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(sessionTokenInput().autocomplete).toBe("off");
  });


  it("queues latest runtime settings when host.ready arrives during an in-flight refresh", async () => {
    const hostToken = "queuedHostLocalValue";
    const initialPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") {
        return initialPing.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          displayName: "Yet AI",
          version: "0.0.0",
          ready: true,
          serverTime: "2026-05-24T00:00:00Z",
        }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          protocolVersion: "2026-05-15",
          runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
          capabilities: [],
          features: {},
          providers: [],
          ide: { bridge: true, lsp: false },
        }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: hostToken });

    initialPing.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();
    await flushAsync();

    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${hostToken}`)).toBe(true);
  });

  it("uses hosted runtime copy without exposing a host.ready token", async () => {
    const hostToken = "hostReadyLocalRuntimeValue";
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: hostToken });
    await flushAsync();

    expect(container?.textContent).toContain("Runtime connection is IDE-managed");
    expect(container?.textContent).toContain("Trusted host.ready supplied the loopback URL and an in-memory Session token");
    expect(container?.textContent).toContain("there is no visible token to copy");
    expect(container?.textContent).toContain("IDE-managed runtime recovery");
    expect(container?.textContent).toContain("do not copy raw runtime tokens into chat");
    expect(container?.textContent).not.toContain(hostToken);
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(browserStorageDump()).not.toContain(hostToken);
  });

  it("clears stale ping caps and identity warnings after unexpected refresh exceptions", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).toContain("/v1/ping");
    expect(container?.textContent).toContain("\"ready\": true");

    fetchMock.mockImplementation(() => Promise.reject(new Error("unexpected refresh crash")));

    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Runtime check failed: network unexpected refresh crash");
    expect(container?.textContent).toContain("No data");
    expect(container?.textContent).not.toContain("\"ready\": true");
    expect(container?.textContent).not.toContain("\"protocolVersion\": \"2026-05-15\"");
  });

  it("keeps Send disabled after settings change until the new runtime is verified", async () => {
    const runtimeBPing = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8765/v1/ping") {
        return runtimeBPing.promise;
      }
      if (url.startsWith("http://127.0.0.1:8765/")) {
        if (url.endsWith("/v1/caps")) {
          return Promise.resolve(jsonResponse({
            productId: "yet-ai",
            protocolVersion: "2026-05-15",
            runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
            capabilities: [],
            features: {},
            providers: [],
            ide: { bridge: true, lsp: false },
          }));
        }
        if (url.endsWith("/v1/models")) {
          return Promise.resolve(jsonResponse({ models: [readyModel({ id: "gpt-b", displayName: "GPT B", providerId: "runtime-b" })] }));
        }
        if (url.endsWith("/v1/providers")) {
          return Promise.resolve(jsonResponse({ providers: [{ ...enabledProvider(), id: "runtime-b", displayName: "Runtime B", models: [readyModel({ id: "gpt-b", displayName: "GPT B" })] }], cloudRequired: false, providerAccess: "direct" }));
        }
        if (url.endsWith("/v1/provider-auth/openai/status")) {
          return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
        }
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(findButton("Send").disabled).toBe(true);

    runtimeBPing.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("State: GPT B (runtime-b)");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("ignores old refresh results that resolve after settings change", async () => {
    const oldPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") {
        return oldPing.promise;
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          protocolVersion: "2026-05-15",
          runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
          capabilities: [],
          features: {},
          providers: [],
          ide: { bridge: true, lsp: false },
        }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: url.startsWith("http://127.0.0.1:8001/") ? [readyModel({ id: "old-model", displayName: "Old Model", providerId: "old-runtime" })] : [readyModel({ id: "new-model", displayName: "New Model", providerId: "new-runtime" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        const isOld = url.startsWith("http://127.0.0.1:8001/");
        return Promise.resolve(jsonResponse({ providers: [{ ...enabledProvider(), id: isOld ? "old-runtime" : "new-runtime", displayName: isOld ? "Old Runtime" : "New Runtime", models: [readyModel({ id: isOld ? "old-model" : "new-model", displayName: isOld ? "Old Model" : "New Model" })] }], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url === "http://127.0.0.1:8765/v1/ping") {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          displayName: "Yet AI",
          version: "0.0.0",
          ready: true,
          serverTime: "2026-05-24T00:00:00Z",
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await flushAsync();

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });

    oldPing.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("State: New Model (new-runtime)");
    expect(container?.textContent).not.toContain("State: Old Model (old-runtime)");
  });
});

describe("provider secret boundary", () => {
  it("renders OpenAI login unavailable with API key fallback", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Experimental account login (non-default)");
    expect(container?.textContent).toContain("OpenAI account login is planned/not available for production; use the OpenAI API-key fallback.");
    expect(container?.textContent).toContain("Create an API key in the provider console");

    await act(async () => {
      findButton("Use OpenAI API key fallback").click();
    });

    expect(findInputValue("openai-api")).toBeDefined();
    expect(findInputValue("https://api.openai.com/v1")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
  });

  it("does not write provider auth state or secrets to browser storage", async () => {
    const secret = "auth-secret-token-value";
    mockRuntimeResponses({ authMessage: secret });
    renderApp();

    await flushAsync();

    expect(browserStorageDump()).not.toContain(secret);
  });

  it("saves OpenAI API-key fallback, clears the raw key, and refreshes to send readiness", async () => {
    const secret = "sk-save-refresh-secret-value";
    let savedProvider = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/providers")) {
        const body = JSON.parse(String(init.body)) as { auth?: { apiKey?: string } };
        expect(body.auth?.apiKey).toBe(secret);
        savedProvider = true;
        return Promise.resolve(jsonResponse(enabledProvider()));
      }
      return mockRuntimeResponse(input, init, savedProvider ? {
        ...readyRuntimeOptions(),
        authResponse: providerAuthResponse("api_key_configured"),
      } : {
        authResponse: providerAuthResponse("login_unavailable"),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderApp();

    await flushAsync();
    expect(findButton("Send").disabled).toBe(true);

    await act(async () => {
      findButton("Use OpenAI API key fallback").click();
    });
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    expect(apiKeyInput().value).toBe(secret);

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("API-key fallback configured");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Next safest action: Type a prompt and click Send through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
    expect(container?.textContent).not.toContain(secret);
    expect(browserStorageDump()).not.toContain(secret);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("successful provider test clears raw API key input and refreshes model readiness without persisting provider secrets", async () => {
    const secret = "sk-test-refresh-secret-value";
    let providerTested = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/providers/openai-api/test")) {
        providerTested = true;
        return Promise.resolve(jsonResponse({
          ok: true,
          providerId: "openai-api",
          status: "reachable",
          message: "Provider is reachable and accepted the configured credentials.",
          modelId: "gpt-4o-mini",
          cloudRequired: false,
        }));
      }
      return mockRuntimeResponse(input, init, {
        providers: [enabledProvider()],
        models: providerTested ? [readyModel({ providerId: "openai-api" })] : [readyModel({ providerId: "openai-api", readiness: { status: "missing_credentials", reason: "Provider test has not confirmed the saved key yet." } })],
        authResponse: providerAuthResponse("api_key_configured"),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("Model is not ready yet");
    expect(findButton("Send").disabled).toBe(true);

    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("Provider test succeeded");
    expect(container?.textContent).toContain("The raw API-key field was cleared; Test provider uses the saved local runtime credential.");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Next safest action: Type a prompt and click Send through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
    expect(container?.textContent).not.toContain(secret);
    expect(browserStorageDump()).not.toContain(secret);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("does not open invalid provider auth URLs", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    mockRuntimeResponses({ authSupportsLogin: true, startAuthUrl: "file:///tmp/provider-token" });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Start experimental OpenAI login").click();
    });

    expect(openMock).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Provider auth URL was not opened because it is not HTTPS or loopback.");
  });

  it("starts experimental OpenAI login with explicit flag and opens a safe URL", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    mockRuntimeResponses({
      authSupportsLogin: true,
      startAuthUrl: "https://auth.openai.com/oauth/authorize?state=codex-test",
      startAuthMessage: "Experimental high-risk Codex-like OpenAI login is pending.",
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Experimental high-risk account login").click();
    });

    const startCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/start") && init?.method === "POST");
    expect(startCall?.[1]?.body).toBe(JSON.stringify({ experimentalCodexLike: true }));
    expect(openMock).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize?state=codex-test", "_blank", "noopener,noreferrer");
    expect(container?.textContent).toContain("high-risk and private-endpoint-style");
    expect(container?.textContent).toContain("Session is tracked locally by the runtime and hidden here");
    expect(container?.textContent).not.toContain("Session: provider-login-session-001");
    expect(container?.textContent).toContain("Expires: 2026-05-24T01:00:00Z");
    expect(container?.textContent).toContain("Requested scopes: openid, profile, email, offline_access");
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
  });

  it("ignores stale provider auth start responses after runtime settings change", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    const startAuth = deferred<Response>();
    mockRuntimeResponses({ authSupportsLogin: true });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/start") {
        return startAuth.promise;
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Start experimental OpenAI login").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    startAuth.resolve(jsonResponse({
      ...pendingExperimentalAuthResponse(),
      authorizationUrl: "https://auth.openai.com/oauth/authorize?state=stale-secret",
      message: "stale auth response",
    }));
    await flushAsync();

    expect(openMock).not.toHaveBeenCalled();
    expect(container?.textContent).not.toContain("stale auth response");
    expect(container?.textContent).not.toContain("Session: provider-login-session-001");
  });

  it("enables pending experimental authorization-code exchange", async () => {
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Manual authorization-code exchange");
    expect(findButton("Exchange authorization code").disabled).toBe(true);

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-123");
    });

    expect(findButton("Exchange authorization code").disabled).toBe(false);
  });

  it("sends session id state and code for manual exchange and clears code", async () => {
    const code = "manual-code-456";
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse(), exchangeResponse: connectedExperimentalAuthResponse() });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const exchangeCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST");
    expect(exchangeCall?.[1]?.body).toBe(JSON.stringify({ sessionId: "provider-login-session-001", code, state: "codex-state-001" }));
    expect(authCodeInputOptional()?.value ?? "").toBe("");
  });

  it("renders connected sanitized status after successful manual exchange", async () => {
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse(), exchangeResponse: connectedExperimentalAuthResponse() });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-789");
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Experimental OpenAI account login is connected through the local runtime, but API-key fallback remains the default real-provider path.");
    expect(container?.textContent).toContain("Account: user@example.test");
    expect(container?.textContent).not.toContain("manual-code-789");
    expect(container?.textContent).not.toContain("access_token");
  });

  it("renders connected account login as a guided path without raw sessions", async () => {
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI account connected");
    expect(container?.textContent).toContain("Ready for chat through the local runtime");
    expect(container?.textContent).toContain("Account: user@example.test");
    expect(container?.textContent).toContain("Token hint: oauth-...test");
    expect(container?.textContent).toContain("Raw provider tokens, cookies, auth codes, provider API keys, and runtime Session token values are not shown here. Runtime Session token and provider credentials are separate secrets.");
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
    expect(container?.textContent).not.toContain("provider-login-session");
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it("renders sanitized manual exchange failures and clears code", async () => {
    const code = "manual-code-fail";
    const rawToken = "access_token=" + "a".repeat(64);
    mockRuntimeResponses({
      authResponse: pendingExperimentalAuthResponse(),
      exchangeResponse: {
        ...providerAuthResponse("expired"),
        configured: false,
        success: false,
        lastError: `Expired duplicate exchange ${rawToken} verifier=${"b".repeat(64)} auth.json cookie=secret`,
      },
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authCodeInputOptional()?.value ?? "").toBe("");
    expect(container?.textContent).toContain("Expired duplicate exchange [redacted]");
    expect(container?.textContent).not.toContain(code);
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("verifier");
    expect(container?.textContent).not.toContain("auth.json");
    expect(container?.textContent).not.toContain("cookie=secret");
  });

  it("disables manual exchange when pending authorization state cannot be parsed", async () => {
    mockRuntimeResponses({ authResponse: { ...pendingExperimentalAuthResponse(), authorizationUrl: "not a url" } });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-disabled");
    });

    expect(container?.textContent).toContain("Authorization state cannot be parsed from the pending login response.");
    expect(findButton("Exchange authorization code").disabled).toBe(true);
  });

  it("default OpenAI login does not start the experimental path", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    mockRuntimeResponses({ authSupportsLogin: true });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Start experimental OpenAI login").click();
    });

    const startCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/start") && init?.method === "POST");
    expect(startCall?.[1]?.body).toBe(JSON.stringify({}));
  });

  it("surfaces unauthorized provider auth errors safely", async () => {
    mockRuntimeResponses({ authStatusCode: 401 });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Unauthorized local runtime request. Check the session token.");
    expect(container?.textContent).not.toContain("Bearer");
  });

  it.each([
    ["login_unavailable", "OpenAI account login is planned/not available for production; use the OpenAI API-key fallback."],
    ["api_key_configured", "OpenAI API-key fallback is configured locally. Account login is not required for the default real-provider path."],
    ["pending", "Experimental OpenAI account login is pending. Finish the browser/device step, then refresh status; use API-key fallback for the default path."],
    ["connected", "Experimental OpenAI account login is connected through the local runtime, but API-key fallback remains the default real-provider path."],
    ["expired", "Experimental OpenAI account login expired. Start it again only if you accept the risk, or use the API-key fallback."],
    ["revoked", "Experimental OpenAI account login was revoked. Disconnect it or use the API-key fallback."],
  ] satisfies Array<[ProviderAuthStatus, string]>)("renders provider auth status %s", async (status, copy) => {
    mockRuntimeResponses({ authResponse: providerAuthResponse(status) });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain(status);
    expect(container?.textContent).toContain(copy);
  });

  it("enables disconnect for connected account login", async () => {
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(findButton("Disconnect login").disabled).toBe(false);
  });

  it("keeps disconnect disabled for API key configured fallback", async () => {
    mockRuntimeResponses({ authResponse: providerAuthResponse("api_key_configured") });
    renderApp();

    await flushAsync();

    expect(findButton("Disconnect login").disabled).toBe(true);
  });

  it("sanitizes token-like provider auth last errors before display", async () => {
    const rawToken = "Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const rawApiKey = "api_key=sk-testabcdefghijklmnopqrstuvwxyz";
    const longValue = "x".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("error"),
        lastError: `provider failed ${rawToken} ${rawApiKey} access_token=${longValue} refresh_token=${longValue}`,
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Sanitized login error: provider failed [redacted]");
    expect(container?.textContent).not.toContain("Bearer");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("api_key");
    expect(container?.textContent).not.toContain(longValue);
  });

  it("renders error account login with sanitized retry guidance and API-key fallback", async () => {
    const longValue = "q".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("error"),
        lastError: `callback failed access_token=${longValue} Cookie: session=secret`,
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI login needs attention");
    expect(container?.textContent).toContain("Sanitized login error: callback failed [redacted]");
    expect(container?.textContent).toContain("Retry login");
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("session=secret");
    expect(container?.textContent).not.toContain(longValue);
  });

  it("sanitizes experimental provider auth messages and details before display", async () => {
    const rawCode = "authorization=code-secret-value";
    const rawToken = "refresh_token=" + "z".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("pending"),
        message: `experimental pending ${rawCode} Authorization: Bearer short-secret`,
        accountLabel: `${rawToken} Cookie: session=secret; refresh=also-secret`,
        scopes: ["openid", `access_token=${"y".repeat(64)}`, "C:\\Users\\alice\\.codex\\auth.json OPENAI_API_KEY=env-secret"],
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("experimental pending [redacted]");
    expect(container?.textContent).not.toContain("code-secret-value");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("short-secret");
    expect(container?.textContent).not.toContain("session=secret");
    expect(container?.textContent).not.toContain("auth.json");
    expect(container?.textContent).not.toContain("OPENAI_API_KEY");
    expect(container?.textContent).not.toContain("z".repeat(64));
    expect(container?.textContent).not.toContain("y".repeat(64));
  });

  it("browser storage does not contain raw provider API keys", () => {
    localStorage.clear();
    sessionStorage.clear();
    const secret = "sk-yet-test-secret";
    const transientForm = { apiKey: secret };
    const clearedForm = { ...transientForm, apiKey: "" };
    expect(clearedForm.apiKey).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("provider presets fill OpenAI-compatible fields without an API key", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    fetchMock.mockClear();

    await act(async () => {
      findButton("OpenAI API key fallback (safe default)").click();
    });

    expect(findInputValue("openai-api")).toBeDefined();
    expect(findInputValue("https://api.openai.com/v1")).toBeDefined();
    expect(findInputValue("gpt-4o-mini")).toBeDefined();
    expect(findInputValue("GPT-4o mini")).toBeDefined();
    expect(findSelectValue("openai-compatible")).toBeDefined();
    expect(findSelectValue("api_key")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("api.openai.com"))).toBe(true);
    expect(browserStorageDump()).not.toContain("sk-");

    await act(async () => {
      findButton("LM Studio local").click();
    });

    expect(findInputValue("lm-studio-local")).toBeDefined();
    expect(findInputValue("http://127.0.0.1:1234/v1")).toBeDefined();
    expect(findInputValue("local-model")).toBeDefined();
    expect(findSelectValue("openai-compatible")).toBeDefined();
    expect(apiKeyInput().value).toBe("");

    await act(async () => {
      findButton("Ollama OpenAI-compatible").click();
    });

    expect(findInputValue("ollama-openai-compatible")).toBeDefined();
    expect(findInputValue("http://127.0.0.1:11434/v1")).toBeDefined();
    expect(findInputValue("llama3.2")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("native Ollama chat is future work");
  });

  it("keeps Session token and provider API key guidance visibly distinct", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("This local runtime token authorizes the GUI to the loopback runtime");
    expect(container?.textContent).toContain("Provider API key is for the upstream OpenAI-compatible provider and is sent to the local runtime only on save, cleared from this form immediately after save/update is submitted, and never written to browser storage");
    expect(apiKeyInput().placeholder).toBe("Provider API key, not the runtime Session token");
    expect(container?.textContent).toContain("This is your provider/OpenAI API key, not the runtime Session token.");
  });

  it("submit clears preset API key input and keeps secrets out of browser storage", async () => {
    const secret = "sk-test-preset-secret";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await act(async () => {
      findButton("OpenAI API key fallback (safe default)").click();
    });
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    expect(apiKeyInput().value).toBe(secret);

    await act(async () => {
      findButton("Create provider").click();
    });

    expect(apiKeyInput().value).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1:8001/"))).toBe(true);
    const providerSaveCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers") && init?.method === "POST");
    expect(providerSaveCall?.[1]?.body).toContain(secret);
  });

  it("update existing provider clears API key input and keeps secrets out of browser storage", async () => {
    const secret = "sk-test-update-secret";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Edit").click();
    });
    expect(apiKeyInput().value).toBe("");
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    expect(apiKeyInput().value).toBe(secret);

    await act(async () => {
      findButton("Update provider").click();
    });

    expect(apiKeyInput().value).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
    const providerUpdateCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers/openai-api") && init?.method === "PATCH");
    expect(providerUpdateCall?.[1]?.body).toContain(secret);
  });

  it("failed provider save does not restore raw secret into the DOM or browser storage", async () => {
    const secret = "sk-failed-save-secret";
    mockRuntimeResponses({ ...readyRuntimeOptions(), providerSaveStatus: 500, providerSaveResponse: { error: `save failed api_key=${secret}` } });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });

    await act(async () => {
      findButton("Create provider").click();
    });

    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("save failed [redacted]");
    expect(container?.textContent).not.toContain(secret);
    expect(container?.textContent).not.toContain("api_key");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("provider mutation invalidates readiness until provider refresh completes", async () => {
    const providerSave = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/providers")) {
        return providerSave.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
    });

    expect(findButton("Send").disabled).toBe(true);

    providerSave.resolve(jsonResponse(enabledProvider()));
    await flushAsync();
    await flushAsync();

    expect(findButton("Send").disabled).toBe(false);
  });

  it("ignores stale provider save errors after runtime settings change", async () => {
    const providerSave = deferred<Response>();
    const secret = "sk-stale-save-secret";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers") {
        return providerSave.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
    });
    expect(apiKeyInput().value).toBe("");
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    providerSave.resolve(jsonResponse({ error: "stale save failed Bearer verysecrettokenvalue123456789" }, 500));
    await flushAsync();

    expect(container?.textContent).not.toContain("stale save failed");
    expect(container?.textContent).not.toContain("verysecrettokenvalue");
    expect(apiKeyInput().value).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("clears manual authorization code and working state when settings change during exchange", async () => {
    const exchange = deferred<Response>();
    const code = "manual-code-stale";
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/exchange") {
        return exchange.promise;
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    expect(findButton("Exchanging…").disabled).toBe(true);

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    exchange.resolve(jsonResponse({ ...connectedExperimentalAuthResponse(), message: "stale connected" }));
    await flushAsync();

    expect(authCodeInputOptional()?.value ?? "").toBe("");
    expect(container?.textContent).not.toContain("Exchanging…");
    expect(container?.textContent).not.toContain(code);
    expect(container?.textContent).not.toContain("stale connected");
    expect(browserStorageDump()).not.toContain(code);
  });

  it("sanitizes provider metadata before visible rendering", async () => {
    const rawSecret = "access_token=" + "p".repeat(64);
    mockRuntimeResponses({
      providers: [{
        ...enabledProvider(),
        id: `provider-${rawSecret}`,
        displayName: `Provider ${rawSecret}`,
        baseUrl: `http://127.0.0.1:9000/v1?api_key=short-secret`,
        models: [readyModel({ id: "model-1", displayName: `Model refresh_token=${"r".repeat(64)}` })],
      }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Provider [redacted]");
    expect(container?.textContent).toContain("Models: Model [redacted]");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("api_key");
    expect(container?.textContent).not.toContain("short-secret");
    expect(container?.textContent).not.toContain("p".repeat(64));
    expect(container?.textContent).not.toContain("r".repeat(64));
  });

  it("sanitizes provider auth redacted values before visible rendering", async () => {
    mockRuntimeResponses({
      providers: [{
        ...enabledProvider(),
        kind: "openai-compatible Authorization: Bearer provider-kind-secret",
        auth: {
          type: "api_key",
          configured: true,
          redacted: "Authorization: Bearer provider-secret Cookie: session=cookie-secret; refresh=also-secret http://127.0.0.1:8080/v1?api_key=query-secret /Users/Alice Smith/.codex/auth.json",
        },
      }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Secret configured: true ([redacted]");
    expect(container?.textContent).not.toContain("provider-secret");
    expect(container?.textContent).not.toContain("provider-kind-secret");
    expect(container?.textContent).not.toContain("cookie-secret");
    expect(container?.textContent).not.toContain("query-secret");
    expect(container?.textContent).not.toContain("Alice Smith");
    expect(container?.textContent).not.toContain("auth.json");
  });

  it("tests a saved provider through the local runtime and renders success", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });

    const testCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers/openai-api/test") && init?.method === "POST");
    expect(testCall).toBeDefined();
    expect(String(testCall?.[0])).toBe("http://127.0.0.1:8001/v1/providers/openai-api/test");
    expect(container?.textContent).toContain("Provider test succeeded");
    expect(container?.textContent).toContain("reachable: Provider is reachable and accepted the configured credentials. Model: gpt-4o-mini.");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("api.openai.com"))).toBe(true);
  });

  it("renders sanitized actionable provider test failures and keeps browser storage secret-free", async () => {
    const secret = "sk-provider-test-visible-secret";
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      providerTestResponse: {
        ok: false,
        providerId: "openai-api",
        status: "unauthorized",
        message: `Provider authentication failed Authorization: Bearer ${secret} cookie=session-secret`,
        modelId: "gpt-4o-mini",
        cloudRequired: false,
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Provider test failed");
    expect(container?.textContent).toContain("unauthorized: Provider authentication failed [redacted]");
    expect(container?.textContent).toContain("Check that the provider API key was saved in the local runtime");
    expect(container?.textContent).toContain("do not paste the runtime Session token here");
    expect(container?.textContent).not.toContain(secret);
    expect(container?.textContent).not.toContain("session-secret");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it.each([
    [429, "Provider rate limit or quota reached."],
    [404, "Model unavailable. Check the saved model id"],
    ["missing_model", "Model unavailable. Check the saved model id"],
    ["unreachable", "Provider could not be reached through the local runtime."],
  ] as Array<[number | string, string]>)("renders actionable provider test failure copy for %s", async (status, actionCopy) => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      providerTestResponse: {
        ok: false,
        providerId: "openai-api",
        status: typeof status === "string" ? status : "upstream_error",
        message: `Provider test failed with HTTP ${status} api_key=sk-common-secret`,
        cloudRequired: false,
      },
      providerTestStatus: typeof status === "number" ? status : 200,
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Provider test failed");
    expect(container?.textContent).toContain(actionCopy);
    expect(container?.textContent).not.toContain("sk-common-secret");
    expect(container?.textContent).not.toContain("api_key");
    expect(container?.textContent).not.toContain("hosted Yet AI is required");
  });

  it("clears and ignores stale provider test results after runtime settings change", async () => {
    const providerTest = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers/openai-api/test") {
        return providerTest.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("Provider test running");

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    expect(container?.textContent).not.toContain("Provider test running");

    providerTest.resolve(jsonResponse({
      ok: true,
      providerId: "openai-api",
      status: "reachable",
      message: "stale provider test success",
      cloudRequired: false,
    }));
    await flushAsync();

    expect(container?.textContent).not.toContain("Provider test succeeded");
    expect(container?.textContent).not.toContain("stale provider test success");
    expect(browserStorageDump()).not.toContain("stale provider test success");
  });

  it("clears and ignores stale provider test results when provider mutation starts", async () => {
    const providerTest = deferred<Response>();
    const providerSave = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers/openai-api/test") {
        return providerTest.promise;
      }
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers") {
        return providerSave.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("Provider test running");

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
    });
    expect(container?.textContent).not.toContain("Provider test running");

    providerTest.resolve(jsonResponse({
      ok: true,
      providerId: "openai-api",
      status: "reachable",
      message: "stale provider mutation test success",
      cloudRequired: false,
    }));
    await flushAsync();

    expect(container?.textContent).not.toContain("Provider test succeeded");
    expect(container?.textContent).not.toContain("stale provider mutation test success");
    providerSave.resolve(jsonResponse(enabledProvider()));
  });
});

describe("runtime debug redaction", () => {
  it("sanitizes unexpected /v1/ping secret-like fields before rendering", async () => {
    mockRuntimeResponses({
      pingResponse: {
        productId: "yet-ai",
        displayName: "Yet AI",
        version: "0.0.0",
        ready: true,
        serverTime: "2026-05-24T00:00:00Z",
        access_token: "ping-secret",
        header: "Authorization: Bearer ping-bearer-secret",
        path: "/Users/Alice Smith/auth.json",
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain('"[redacted]": "[redacted]"');
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("ping-secret");
    expect(container?.textContent).not.toContain("ping-bearer-secret");
    expect(container?.textContent).not.toContain("Alice Smith");
    expect(container?.textContent).not.toContain("auth.json");
  });

  it("sanitizes unexpected /v1/caps secret-like fields before rendering", async () => {
    mockRuntimeResponses({
      capsResponse: {
        productId: "yet-ai",
        protocolVersion: "2026-05-15",
        runtime: { mode: "local", cloudRequired: false, providerAccess: "direct", cookie: "session=caps-secret" },
        capabilities: ["chat Authorization: Bearer caps-bearer-secret"],
        features: {},
        providers: [{ id: "provider", accessToken: "caps-token-secret", path: "C:\\Users\\Alice Smith\\.codex\\auth.json" }],
        ide: { bridge: true, lsp: false },
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain('"[redacted]": "[redacted]"');
    expect(container?.textContent).not.toContain("accessToken");
    expect(container?.textContent).not.toContain("caps-token-secret");
    expect(container?.textContent).not.toContain("caps-bearer-secret");
    expect(container?.textContent).not.toContain("caps-secret");
    expect(container?.textContent).not.toContain("Alice Smith");
    expect(container?.textContent).not.toContain("auth.json");
  });
});

describe("agent progress panel", () => {
  it("empty list renders no agent runs", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse() });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Agent progress");
    expect(container?.textContent).toContain("No local agent runs");
    expect(container?.textContent).toContain("The local progress source is reachable but currently has no runs to display.");
    expect(container?.textContent).toContain("Generated at: 2026-05-29T15:00:00Z");
  });

  it("populated live writer progress renders snapshot and heartbeat freshness as read-only state", async () => {
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        message: "Running local endpoint verification",
        ageMs: 2500,
        lastHeartbeatAt: "2026-05-29T14:00:55Z",
        heartbeatAgeMs: 1200,
        lastToolOutputAt: "2026-05-29T14:00:50Z",
        toolOutputAgeMs: 6400,
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Populated local progress");
    expect(text).toContain("1 local agent run returned by the read-only runtime endpoint.");
    expect(text).toContain("Generated at: 2026-05-29T15:00:00Z");
    expect(text).toContain("Read-only local observability; refresh only re-reads local progress.");
    expect(text).toContain("Running local endpoint verification");
    expect(text).toContain("Snapshot age: 3 s");
    expect(text).toContain("Last heartbeat: 2026-05-29T14:00:55Z");
    expect(text).toContain("Heartbeat age: 1 s");
    expect(text).toContain("Last tool output: 2026-05-29T14:00:50Z");
    expect(text).toContain("Tool output age: 6 s");
    expect(text).not.toContain("Snapshot age: unknown");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Stop agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });

  it("malformed live writer freshness falls back safely without raw marker leaks", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "h".repeat(64);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        lastHeartbeatAt: `provider response: RAW_HEARTBEAT_BODY ${rawSecret}`,
        heartbeatAgeMs: "fresh",
        lastToolOutputAt: 12345,
        toolOutputAgeMs: null,
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Snapshot age: 1 s");
    expect(text).toContain("Last heartbeat: [redacted]");
    expect(text).toContain("Heartbeat age: unknown");
    expect(text).toContain("Last tool output: unknown");
    expect(text).toContain("Tool output age: unknown");
    expect(text).not.toContain("RAW_HEARTBEAT_BODY");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("h".repeat(64));
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("RAW_HEARTBEAT_BODY");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Stop agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });


  it("defensively renders malformed agent-progress snapshots without leaking raw markers", async () => {
    mockRuntimeResponses({
      agentProgress: {
        cloudRequired: false,
        providerAccess: "direct",
        generatedAt: 42,
        snapshots: [
          {
            cardId: 123,
            runId: null,
            phase: { invalid: true },
            status: "invalid_status",
            message: ["provider response: RAW_MESSAGE_BODY"],
            elapsedMs: "slow",
            ageMs: null,
            currentTool: { kind: "mystery", label: "provider response: RAW_TOOL_LABEL" },
            outputTail: "provider response: RAW_OUTPUT_BODY Authorization: Bearer progress-secret",
            recentEvents: "not an array",
          },
        ],
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Populated local progress");
    expect(text).toContain("unknown-card-1 / unknown-run-1");
    expect(text).toContain("Phase: started");
    expect(text).toContain("Status: running");
    expect(text).toContain("Elapsed: unknown");
    expect(text).toContain("Snapshot age: unknown");
    expect(text).toContain("Heartbeat age: unknown");
    expect(text).toContain("Last heartbeat: unknown");
    expect(text).toContain("Last tool output: unknown");
    expect(text).toContain("Tool output age: unknown");
    expect(text).toContain("No progress message reported.");
    expect(text).toContain("No recent summaries.");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("RAW_MESSAGE_BODY");
    expect(text).not.toContain("RAW_TOOL_LABEL");
    expect(text).not.toContain("RAW_OUTPUT_BODY");
    expect(text).not.toContain("progress-secret");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });
  it("sanitizes generatedAt before rendering", async () => {
    const rawSecret = "access_token=" + "g".repeat(64);
    mockRuntimeResponses({ agentProgress: { ...agentProgressResponse([agentProgressSnapshot()]), generatedAt: `2026-05-29T15:00:00Z ${rawSecret} /Users/Alice/.codex/auth.json` } });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Generated at: 2026-05-29T15:00:00Z [redacted]");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("Alice");
    expect(text).not.toContain("auth.json");
    expect(text).not.toContain("g".repeat(64));
  });

  it("running long-running snapshot renders as not stuck", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ status: "long_running", message: "Verification is still running", elapsedMs: 900000 })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("T-277 / run-001");
    expect(container?.textContent).toContain("long-running, not stuck");
    expect(container?.textContent).toContain("Tool: test · npm test");
    expect(container?.textContent).not.toContain("Stuck reason");
  });

  it("stuck snapshot renders stuck reason", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ phase: "stuck", status: "stuck", stuckReason: "heartbeat_timeout", message: "No heartbeat observed" })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("stuck: heartbeat_timeout");
    expect(container?.textContent).toContain("Stuck reason: heartbeat_timeout");
  });

  it("failed snapshot with secret-like output is redacted", async () => {
    const rawSecret = "access_token=" + "f".repeat(64);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: `Failed ${rawSecret}`,
        outputTail: `Command failed Authorization: Bearer agent-secret Cookie: session=progress-cookie /Users/Alice/.codex/auth.json ${rawSecret}`,
        recentEvents: [{ eventId: "event-secret", timestamp: "2026-05-29T14:00:30Z", phase: "failed", status: "failed", message: `Failed event ${rawSecret}` }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("failed");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("agent-secret");
    expect(text).not.toContain("progress-cookie");
    expect(text).not.toContain("Alice");
    expect(text).not.toContain("auth.json");
    expect(text).not.toContain("f".repeat(64));
  });

  it("failed overflow snapshot renders safe recovery guidance without raw oversized output or mutating controls", async () => {
    const rawSecret = "access_token=" + "o".repeat(64);
    const hugeOutput = "RAW_TASK_BOARD_DUMP_".repeat(300);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: "Planner context failed with context_length_exceeded.",
        stuckReason: "explicit_failure",
        outputTail: `task board output too large. task_board_get dumped too much. Authorization: Bearer planner-secret Cookie: session=planner-cookie /Users/Alice/.codex/auth.json raw prompt: ${hugeOutput} ${rawSecret}`,
        overflowRecovery: {
          kind: "task_board_output_too_large",
          message: `Use task_ready_cards or task_board_get(card_id), not raw prompt: ${hugeOutput} ${rawSecret}`,
          retryable: true,
        },
        recentEvents: [{ eventId: "event-overflow", timestamp: "2026-05-29T14:00:30Z", phase: "failed", status: "failed", message: `maximum context length exceeded provider response: ${hugeOutput} ${rawSecret}` }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Task-board output was too large.");
    expect(text).toContain("Use a specific card id, ready cards, or scoped search instead of a full task-board dump.");
    expect(text).toContain("task_board_get(card_id)");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("planner-secret");
    expect(text).not.toContain("planner-cookie");
    expect(text).not.toContain("Alice");
    expect(text).not.toContain("auth.json");
    expect(text).not.toContain("RAW_TASK_BOARD_DUMP_");
    expect(text).not.toContain("o".repeat(64));
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Stop agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });

  it("explicit stuck snapshot renders contract stuck reason", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ phase: "stuck", status: "stuck", stuckReason: "explicit_stuck", message: "Agent explicitly reported stuck" })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("stuck: explicit_stuck");
    expect(container?.textContent).toContain("Stuck reason: explicit_stuck");
  });

  it("does not render stale overflow recovery for done snapshots", async () => {
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "done",
        status: "done",
        message: "Completed after earlier context_length_exceeded recovery",
        outputTail: "Previous task board output too large event was resolved.",
        overflowRecovery: {
          kind: "task_board_output_too_large",
          message: "Retry with task_ready_cards or task_board_get(card_id).",
          retryable: true,
        },
        recentEvents: [{ eventId: "event-done", timestamp: "2026-05-29T14:00:30Z", phase: "done", status: "done", message: "Done after overflow" }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("done");
    expect(text).not.toContain("Task-board output was too large.");
    expect(text).not.toContain("Use a specific card id, ready cards, or scoped search instead of a full task-board dump.");
  });

  it("redacts raw-content label bodies and bounds oversized noisy output", async () => {
    const noisyChunk = "SAFE_NOISY_AGENT_OUTPUT_";
    const hugeOutput = noisyChunk.repeat(1200);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: "Failed after raw prompt: SECRET_PROMPT_BODY",
        outputTail: `raw prompt SECRET_PROMPT_BODY\nprovider response: SECRET_PROVIDER_BODY\nfile content=SECRET_FILE_BODY\nworkspace contents: SECRET_WORKSPACE_BODY\nchain of thought SECRET_THOUGHT_BODY\n${hugeOutput}`,
        recentEvents: [{ eventId: "event-raw-body", timestamp: "2026-05-29T14:00:30Z", phase: "failed", status: "failed", message: `tool output too large ${hugeOutput}` }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Agent output was too large.");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("SECRET_PROMPT_BODY");
    expect(text).not.toContain("SECRET_PROVIDER_BODY");
    expect(text).not.toContain("SECRET_FILE_BODY");
    expect(text).not.toContain("SECRET_WORKSPACE_BODY");
    expect(text).not.toContain("SECRET_THOUGHT_BODY");
    expect((text.match(/SAFE_NOISY_AGENT_OUTPUT_/g) ?? []).length).toBeLessThan(220);
    expect(text.length).toBeLessThan(16000);
  });

  it("detects fallback overflow before raw-content redaction", async () => {
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: "Provider request failed",
        outputTail: "provider response: context_length_exceeded FALLBACK_RAW_SENTINEL",
        recentEvents: [],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Planner context was too large.");
    expect(text).toContain("Retry with scoped context");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("FALLBACK_RAW_SENTINEL");
  });

  it("bounds oversized agent-progress lists and recent summaries", async () => {
    const snapshots = Array.from({ length: 25 }, (_, index) => agentProgressSnapshot({
      cardId: `T-BOUND-${index}`,
      runId: `run-${index}`,
      recentEvents: Array.from({ length: 18 }, (_, eventIndex) => ({
        eventId: `event-${index}-${eventIndex}`,
        timestamp: "2026-05-29T14:00:30Z",
        phase: "running_command",
        status: "healthy_running",
        message: `safe recent summary ${eventIndex}`,
      })),
    }));
    mockRuntimeResponses({ agentProgress: agentProgressResponse(snapshots) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("T-BOUND-0 / run-0");
    expect(text).toContain("T-BOUND-19 / run-19");
    expect(text).toContain("5 more agent runs hidden.");
    expect(text).toContain("6 more summaries hidden.");
    expect(text).not.toContain("T-BOUND-20 / run-20");
    expect(text).not.toContain("safe recent summary 17");
    expect(text.length).toBeLessThan(33500);
  });

  it("endpoint unavailable or corrupt runtime error is sanitized and non-fatal", async () => {
    mockRuntimeResponses({ agentProgressStatus: 503, agentProgressError: "agent progress unavailable provider response: RAW_CORRUPT_BODY Authorization: Bearer progress-secret" });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Agent progress unavailable");
    expect(container?.textContent).toContain("The local progress source is unavailable, corrupt, oversized, or unsafe. Runtime 503: agent progress unavailable [redacted]");
    expect(container?.textContent).toContain("Chat readiness");
    expect(container?.textContent).not.toContain("RAW_CORRUPT_BODY");
    expect(container?.textContent).not.toContain("progress-secret");
  });

  it("browser storage remains free of raw secret markers", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "sk-agent-progress-secret";
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ outputTail: `failed ${rawSecret}` })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
    expect(container?.textContent).not.toContain(rawSecret);
  });

  it("stale response after settings change is ignored", async () => {
    const oldProgress = deferred<Response>();
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/agent-progress") {
        return oldProgress.promise;
      }
      return mockRuntimeResponse(input, init);
    });

    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    oldProgress.resolve(jsonResponse(agentProgressResponse([agentProgressSnapshot({ cardId: "T-OLD", message: "stale progress secret" })])));
    await flushAsync();

    expect(container?.textContent).toContain("Agent progress not checked");
    expect(container?.textContent).toContain("Refresh to read the local runtime agent-progress source.");
    expect(container?.textContent).not.toContain("T-OLD");
    expect(container?.textContent).not.toContain("stale progress secret");
  });

  it("does not expose mutating agent controls", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot()]) });
    renderApp();

    await flushAsync();

    expect(findButton("Refresh agent progress")).toBeDefined();
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });
});

describe("host.ready runtime bootstrap", () => {
  it("updates runtime settings from host.ready without persisting the token", async () => {
    const token = "hostSessionLocalValue";
    mockRuntimeResponses();
    renderApp();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });

    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(container?.textContent).toContain("Host runtime settings received");
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("http://127.0.0.1:8765/") && new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).not.toContain(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("JetBrains host.ready uses host runtime settings without storing token in browser storage", async () => {
    const postIntellijMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const token = "jetbrainsHostReadyLocalValue";
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });
    await flushAsync();

    expect(postIntellijMessage.mock.calls.some(([message]) => message?.type === "gui.ready" && message?.version === bridgeVersion)).toBe(true);
    expect(container?.textContent).toContain("bridge jetbrains");
    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(container?.textContent).toContain("Host runtime settings received");
    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).not.toContain(token);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(token);
  });

  it("JetBrains runtime unavailable first-message state points to Refresh runtime and runtime status commands", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("bridge jetbrains");
    expect(text).toContain("State: Runtime unavailable");
    expect(text).toContain("Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send.");
    expect(text).toContain("Start here: connect the local runtime.");
    expect(text).toContain("Runtime needs refresh");
    expect(text).toContain("Next safest action: Use Refresh runtime from this chat page; the IDE host will re-deliver trusted runtime settings automatically. If it still fails, use the IDE runtime status/restart command instead of copying a token. In JetBrains installed mode, also use Tools → Yet AI: Show Runtime Status or Restart Runtime if Refresh runtime keeps failing.");
    expect(findButton("Refresh runtime")).toBeDefined();
    expect(findButton("Send").disabled).toBe(true);
  });

  it("provider-required first-message state keeps provider setup visible with API-key and local-provider actions", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("bridge jetbrains");
    expect(text).toContain("Runtime connected — choose the first-message path");
    expect(text).toContain("Provider setup");
    expect(text).toContain("State: Provider required");
    expect(text).toContain("Provider required: choose Demo Mode for a no-key local trial, or configure a BYOK OpenAI-compatible provider/model for real answers.");
    expect(text).toContain("Choose how this first chat should answer.");
    expect(text).toContain("Provider or Demo Mode needed");
    expect(text).toContain("Next safest action: For real answers, use the OpenAI API-key fallback (safe/default), paste a provider API key, save, test provider, refresh runtime/model readiness, then send. Choose Demo Mode only to try the chat flow without provider calls.");
    expect(findButton("Use OpenAI API key fallback")).toBeDefined();
    expect(findButton("Send").disabled).toBe(true);
  });

  it("labels enabled Demo Mode as disable and keeps provider setup open when no chat-ready provider/model exists", async () => {
    mockRuntimeResponses({ demoMode: demoModeResponse(true), providers: [], models: [] });
    renderApp();

    await flushAsync();

    expect(findButton("Disable Demo Mode")).toBeDefined();
    expect(buttonsNamed("Try Demo Mode")).toHaveLength(0);
    expect(findButton("Send").disabled).toBe(true);
    expect(findDetails("provider-setup-details").open).toBe(true);

    fetchMock.mockClear();
    await act(async () => {
      findButton("Disable Demo Mode").click();
      await Promise.resolve();
    });

    const setCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/demo-mode") && init?.method === "POST");
    expect(setCall?.[1]?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it("offers runtime-owned Demo Mode and keeps it out of browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("Try Demo Mode");
    expect(findButton("Send").disabled).toBe(true);

    fetchMock.mockClear();
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [demoProvider()],
      models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" })],
    });
    await act(async () => {
      findButton("Try Demo Mode").click();
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    const setCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/demo-mode") && init?.method === "POST");
    expect(setCall?.[1]?.body).toBe(JSON.stringify({ enabled: true }));
    expect(container?.textContent).toContain("Demo Mode is active in the local runtime");
    expect(container?.textContent).toContain("no provider calls");
    expect(container?.textContent).toContain("not model quality");
    expect(container?.textContent).toContain("Demo Mode is ready for a no-key first message.");
    expect(container?.textContent).toContain("Send a prompt to verify chat UX with runtime-owned canned responses.");
    expect(container?.textContent).toContain("State: Yet AI Demo Chat (yet-demo)");
    expect(chatLifecycleText()).toBe("Demo Mode ready — local canned responses, no provider calls. Ready to send.");
    expect(findButton("Send").disabled).toBe(false);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("yet-demo-chat");
  });

  it("keeps the lifecycle ready label real-provider-specific when Demo Mode is enabled but a real provider/model is active", async () => {
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [enabledProvider(), demoProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Demo Mode is enabled in the local runtime, but the current ready chat path uses");
    expect(container?.textContent).toContain("GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Sends may use that configured provider");
    expect(container?.textContent).not.toContain("Demo Mode is enabled in the local runtime. It uses canned responses only, makes no provider calls");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(findButton("Send").disabled).toBe(false);
    expect(chatLifecycleText()).toBe("Ready to send.");
    expect(chatLifecycleText()).not.toContain("local canned responses");
    expect(chatLifecycleText()).not.toContain("no provider calls");
  });

  it("shows contextual Demo Mode ready status after the assistant response and hides stale waiting copy", async () => {
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [demoProvider()],
      models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" })],
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        { seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Hello from Demo Mode." } } },
        { seq: 3, type: "stream_finished", chatId: "chat-001", payload: { finishReason: "stop" } },
      ],
    });
    renderApp();
    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "demo status prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(container?.textContent).toContain("Hello from Demo Mode.");
    expect(chatLifecycleText()).toBe("Demo Mode ready — local canned responses, no provider calls. Ready to send.");
    expect(chatLifecycleText()).not.toContain("Ready when the local runtime and provider model are ready");
    expect(chatLifecycleText()).not.toContain("Waiting for engine");
  });

  it("collapses installed-host advanced controls while Demo Mode is ready", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [demoProvider()],
      models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" })],
    });
    renderApp();
    await flushAsync();

    expect(findDetails("runtime-connection-details").open).toBe(false);
    expect(findDetails("provider-setup-details").open).toBe(false);
    expect(findDetails("agent-progress-details").open).toBe(false);
    expect(findDetails("chat-advanced-controls").open).toBe(false);
    expect(findDetails("first-message-local-first-notes").open).toBe(false);
    expect(container?.textContent).not.toContain("Use Demo Mode");
    expect(findButton("Disable Demo Mode")).toBeDefined();
    expect(findButton("Send").disabled).toBe(false);
  });

  it("keeps browser runtime connection details open and usable before the runtime connects", async () => {
    delete window.postIntellijMessage;
    delete window.acquireVsCodeApi;
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    const runtimeDetails = findDetails("runtime-connection-details");
    expect(runtimeDetails.open).toBe(true);
    expect(sessionTokenInput()).toBeDefined();

    await act(async () => {
      setInputValue(sessionTokenInput(), "manual-browser-token");
    });
    expect(sessionTokenInput().value).toBe("manual-browser-token");
  });

  it("ignores stale Demo Mode toggle responses after runtime settings change", async () => {
    const demoSet = deferred<Response>();
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/demo-mode") {
        return demoSet.promise;
      }
      return mockRuntimeResponse(input, init);
    });

    await act(async () => {
      findButton("Try Demo Mode").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    demoSet.resolve(jsonResponse(demoModeResponse(true)));
    await flushAsync();

    expect(container?.textContent).not.toContain("Demo Mode enabled in local runtime");
    expect(container?.textContent).not.toContain("State: Yet AI Demo Chat (yet-demo)");
    expect(findButton("Send").disabled).toBe(true);
    expect(browserStorageDump()).not.toContain("yet-demo-chat");
  });

  it("first-message readiness distinguishes runtime unavailable provider required and ready to send", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();
    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(findButton("Send").disabled).toBe(true);

    act(() => root?.unmount());
    root = undefined;
    (container as HTMLDivElement | undefined)?.remove();
    container = undefined;
    fetchMock.mockReset();

    mockRuntimeResponses();
    renderApp();
    await flushAsync();
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("State: Provider required");
    expect(findButton("Send").disabled).toBe(true);

    act(() => root?.unmount());
    root = undefined;
    (container as HTMLDivElement | undefined)?.remove();
    container = undefined;
    fetchMock.mockReset();

    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("Ready for your first message");
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("Provider send ready");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("keeps an existing token when URL-only host.ready repeats the same runtime URL", async () => {
    const token = "sameUrlLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });

    expect(findInputValue("http://127.0.0.1:8001")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("http://127.0.0.1:8001/") && new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).not.toContain(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("clears an existing token when URL-only host.ready changes runtime URL", async () => {
    const token = "retargetLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765" });
    await flushAsync();

    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => !new Headers(init?.headers).get("Authorization")?.includes(token))).toBe(true);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("ignores invalid non-loopback URL-only host.ready", async () => {
    const token = "invalidHostLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "https://example.test:8765" });

    expect(findInputValue("http://127.0.0.1:8001")).toBeDefined();
    expect(sessionTokenInput().value).toBe(token);
    expect(container?.textContent).not.toContain("https://example.test:8765");
  });

  it("ignores empty host.ready sessionToken instead of treating it as a token clear", async () => {
    const token = "emptyClearLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001", sessionToken: "" });

    expect(sessionTokenInput().value).toBe(token);
    expect(browserStorageDump()).not.toContain(token);
  });


  it("does not recreate the bridge adapter when runtime URL input changes", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    expect(postIntellijMessage).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain("bridge jetbrains");

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await flushAsync();

    expect(postIntellijMessage).toHaveBeenCalledTimes(1);
    const bridgeHostEntries = Array.from(container?.querySelectorAll(".timeline-entry") ?? []).filter((entry) => entry.textContent === "Bridge host jetbrains");
    expect(bridgeHostEntries).toHaveLength(1);
  });

  it("host.ready with changed URL and token aborts the old stream once", async () => {
    const stream = mockStreamingReadyRuntime();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), "old-host-ready-token");
    });
    await act(async () => {
      setTextareaValue(chatInput(), "stream before atomic host ready");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: "newHostReadyLocalValue" });
    await flushAsync();

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(new Headers(abortCalls[0][1]?.headers).get("Authorization")).toBe("Bearer old-host-ready-token");
    expect(abortCalls.some(([url]) => String(url).startsWith("http://127.0.0.1:8765/"))).toBe(false);
    stream.close();
  });
});

describe("active editor attached context", () => {
  it("shows disabled coding actions guidance when no usable attached context exists", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Coding Actions");
    expect(container?.textContent).toContain("Attach active editor context first");
    expect(findButton("Explain selection").disabled).toBe(true);
    expect(findButton("Improve safely").disabled).toBe(true);
    expect(findButton("Safe edit").disabled).toBe(true);
  });

  it("fills the prompt for explain selection, enables attached context, focuses prompt, and does not write browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/example.ts", workspaceRelativePath: "src/example.ts", languageId: "typescript" },
      selection: { startLine: 10, startCharacter: 2, endLine: 12, endCharacter: 4, text: "function demo() { return 1; }" },
    });

    await act(async () => {
      findButton("Explain selection").click();
    });

    expect(chatInput().value).toContain("Explain the selected code clearly");
    expect(chatInput().value).toContain("Coding action: explain_selection");
    expect(chatInput().value).toContain("Use only the attached one-shot editor context for src/example.ts (typescript), selection range 10:2-12:4.");
    expect(attachedContextToggle().checked).toBe(true);
    expect(document.activeElement).toBe(chatInput());
    expect(localSetItem).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
  });

  it("fills the safe edit prompt, sets context include, and keeps attached context one-shot after send", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/edit.ts", workspaceRelativePath: "src/edit.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 1, text: "const value = 1;" },
    });

    await act(async () => {
      findButton("Safe edit").click();
    });

    expect(chatInput().value).toContain("Propose a safe edit for the selected code");
    expect(chatInput().value).toContain("Coding action: propose_safe_edit");
    expect(chatInput().value).toContain("Nothing is applied automatically");
    expect(chatInput().value).toContain("wait for explicit review/approval");
    expect(attachedContextToggle().checked).toBe(true);

    await act(async () => {
      findButton("Send").click();
    });
    await flushAsync();

    const body = lastUserMessageBody();
    expect(body.payload?.context).toMatchObject({ file: { workspaceRelativePath: "src/edit.ts" } });
    expect(container?.textContent).toContain("Context attached to the last accepted message from vscode src/edit.ts.");
    expect(attachedContextToggleOptional()).toBeUndefined();
  });

  it("fills stable coding action markers for issue, improve, and tests prompts", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/example.ts", workspaceRelativePath: "src/example.ts", languageId: "typescript" },
      selection: { startLine: 10, startCharacter: 2, endLine: 12, endCharacter: 4, text: "function demo() { return 1; }" },
    });

    await act(async () => {
      findButton("Find issue").click();
    });
    expect(chatInput().value).toContain("Coding action: find_issue");
    expect(chatInput().value).toContain("Review the selected code for likely bugs");

    await act(async () => {
      findButton("Improve safely").click();
    });
    expect(chatInput().value).toContain("Coding action: improve_selection");
    expect(chatInput().value).toContain("Suggest a focused improvement for the selected code");

    await act(async () => {
      findButton("Generate tests").click();
    });
    expect(chatInput().value).toContain("Coding action: generate_tests");
    expect(chatInput().value).toContain("Generate focused tests for the selected code");
  });

  it("renders Agent activity IDE actions panel in browser mode without privileged posting", async () => {
    const postMessage = vi.fn();
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Agent activity · IDE actions");
    expect(container?.textContent).toContain("browser unsupported");
    expect(container?.textContent).toContain("idle");
    expect(findDetails("ide-actions-compact-details").open).toBe(false);
    findDetails("ide-actions-compact-details").open = true;
    expect(container?.textContent).toContain("No controlled IDE action requested yet.");
    expect(container?.textContent).toContain("Safe local navigation/context actions only.");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Get IDE context");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("sends unique bounded JetBrains IDE action requests and blocks pending duplicate clicks", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("bridge jetbrains");
    expect(container?.textContent).toContain("JetBrains controlled actions");
    expect(findButton("Get IDE context")).toBeTruthy();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await act(async () => {
      findButton("IDE action pending…").click();
    });

    const ideActionMessages = postIntellijMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-ide-action-1", payload: { action: "getContextSnapshot" } });
    expect(ideActionMessages[0].requestId.length).toBeLessThanOrEqual(128);
    expect(postIntellijMessage.mock.calls.some(([message]) => message?.type === "gui.applyWorkspaceEditRequest")).toBe(false);
  });

  it("sends unique bounded VS Code IDE action requests and blocks pending duplicate clicks", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await act(async () => {
      findButton("IDE action pending…").click();
    });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-ide-action-1", payload: { action: "getContextSnapshot" } });
    expect(ideActionMessages[0].requestId.length).toBeLessThanOrEqual(128);
    expect(container?.textContent).toContain("Get IDE context: pending");
  });

  it("correlates VS Code IDE action progress and result while ignoring stale results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 2, startCharacter: 1, endLine: 2, endCharacter: 5, text: "main" },
    });
    await act(async () => {
      findButton("Reveal range").click();
    });
    await dispatchHostIdeActionProgress("gui-ide-action-1", { phase: "running", status: "inProgress", summary: "Revealing workspace range.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts" });
    await dispatchHostIdeActionResult("stale-ide-action", { status: "failed", message: "Stale result ignored.", cloudRequired: false, action: "revealWorkspaceRange" });
    expect(container?.textContent).toContain("Ignored stale IDE action result.");
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Revealed workspace range.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 2, character: 1 }, end: { line: 2, character: 5 } } });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages[0].payload).toEqual({ action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 2, character: 1 }, end: { line: 2, character: 5 } } });
    expect(container?.textContent).toContain("Reveal range: succeeded");
    expect(container?.textContent).toContain("Revealed workspace range.");
    expect(container?.textContent).not.toContain("Ignored stale IDE action result.");
    expect(container?.textContent).not.toContain("Stale result ignored.");
  });

  it("renders JetBrains IDE action progress and context result metadata", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await dispatchHostIdeActionProgress("gui-ide-action-1", { phase: "running", status: "inProgress", summary: "Reading IDE context.", cloudRequired: false, action: "getContextSnapshot" });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot", context: { source: "jetbrains", hasActiveEditor: true, workspaceFolderCount: 1 } });

    expect(container?.textContent).toContain("Get IDE context: succeeded");
    expect(container?.textContent).toContain("Result context: source jetbrains · active editor present yes · workspace folders 1");
  });

  it("redacts secret-like active editor preview text from the DOM", async () => {
    const postMessage = vi.fn();
    const rawSecret = "sk-proj-1234567890abcdef";
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 2, startCharacter: 1, endLine: 2, endCharacter: 5, text: `const apiKey = "${rawSecret}";` },
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Bounded preview");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain(rawSecret);
  });

  it("renders browser read-only IDE action proposal without posting a request", async () => {
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/example.ts", summary: "Open the example file." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Browser proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Browser proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("Read-only IDE action proposal");
    expect(container?.textContent).toContain("Open the example file.");
    expect(container?.textContent).toContain("Proposal id: gui-ide-proposal-1");
    expect(container?.querySelector(".ide-action-proposal-card")?.textContent ?? "").not.toContain("Request:");
    expect(container?.textContent).toContain("Browser preview only. No IDE action will be posted.");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Run read-only IDE action");
  });

  it("runs JetBrains read-only IDE action proposal only after click", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "JetBrains proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "JetBrains proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("Read-only IDE action proposal");
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });

    const ideActionMessages = postIntellijMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-ide-proposal-action-1", payload: { action: "getContextSnapshot" } });
    expect(postIntellijMessage.mock.calls.some(([message]) => message?.type === "gui.applyWorkspaceEditRequest")).toBe(false);
  });

  it("renders VS Code read-only IDE action proposal and does not auto-post", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "revealWorkspaceRange", workspaceRelativePath: "src/example.ts", range: testRange(), summary: "Reveal the example range." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "VS Code proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "VS Code proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
  });

  it("lets users clear a stuck VS Code proposal IDE action locally and ignores stale first host updates", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange(), summary: "Reveal the retry proposal range." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "VS Code retry proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "VS Code retry proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });

    let ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0].requestId).toBe("gui-ide-proposal-action-1");
    expect(findButton("IDE action pending…").disabled).toBe(true);
    expect(container?.textContent).toContain("Clear pending IDE action state");
    expect(buttonsNamed("Clear pending IDE action state")).toHaveLength(1);

    await act(async () => {
      findButton("Clear pending IDE action state").click();
    });

    ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(container?.textContent).toContain("Cleared pending IDE action state in the GUI only. No host-side cancellation was requested.");

    await dispatchHostIdeActionProgress("gui-ide-proposal-action-1", { phase: "running", status: "inProgress", summary: "Stale first progress should not render.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts" });
    await dispatchHostIdeActionResult("gui-ide-proposal-action-1", { status: "failed", message: "Stale first result should not render.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange() });
    expect(container?.textContent).not.toContain("Stale first progress should not render.");
    expect(container?.textContent).not.toContain("Stale first result should not render.");

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });
    ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(2);
    expect(ideActionMessages[1].requestId).toBe("gui-ide-proposal-action-2");
    expect(ideActionMessages[1].requestId).not.toBe(ideActionMessages[0].requestId);

    await dispatchHostIdeActionResult("gui-ide-proposal-action-1", { status: "failed", message: "Late stale first result should not overwrite retry.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange() });
    expect(container?.textContent).toContain("Ignored stale IDE action result.");
    await dispatchHostIdeActionResult("gui-ide-proposal-action-2", { status: "succeeded", message: "Retry result rendered.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange() });

    expect(container?.textContent).toContain("Reveal range: succeeded");
    expect(container?.textContent).toContain("Retry result rendered.");
    expect(container?.textContent).not.toContain("Ignored stale IDE action result.");
    expect(container?.textContent).not.toContain("Late stale first result should not overwrite retry.");
    expect(browserStorageDump()).not.toContain("src/retry-proposal.ts");
    expect(browserStorageDump()).not.toContain("Reveal the retry proposal range.");
    expect(localSetItem.mock.calls.some((call) => call.some((value) => String(value).includes("src/retry-proposal.ts") || String(value).includes("Reveal the retry proposal range.")))).toBe(false);
  });

  it("compacts valid assistant IDE proposal JSON until explicit inspect", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/compact-proposal.ts", summary: "Open compact proposal file." });
    const rawJson = JSON.stringify(proposal);
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Compact proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Compact proposal", [chatMessage("chat-001", "assistant-1", "assistant", rawJson)]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const initialText = container?.textContent ?? "";
    expect(initialText).not.toContain(rawJson);
    expect(initialText).not.toContain('"type":"assistant.ideActionProposal"');
    expect(initialText).toContain("Proposed a read-only IDE action: Open workspace file. Review the proposal card below. It will not run automatically.");
    expect(initialText).toContain("Read-only IDE action proposal");
    expect(initialText).toContain("Open compact proposal file.");
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("compact-proposal");

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });

    const inspectedText = container?.textContent ?? "";
    expect(inspectedText).toContain('"type": "assistant.ideActionProposal"');
    expect(inspectedText).toContain('"workspaceRelativePath": "src/compact-proposal.ts"');
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("compact-proposal");
  });

  it("renders compact proposal card for persisted assistant proposal with missing status", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/statusless-proposal.ts", summary: "Open statusless proposal file." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Statusless proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Statusless proposal", [chatMessageWithoutStatus("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Proposed a read-only IDE action: Open workspace file. Review the proposal card below. It will not run automatically.");
    expect(text).toContain("Read-only IDE action proposal");
    expect(text).toContain("Open statusless proposal file.");
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
  });

  it.each([
    [ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." }), { action: "getContextSnapshot" }],
    [ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/example.ts", summary: "Open the example file." }), { action: "openWorkspaceFile", workspaceRelativePath: "src/example.ts" }],
    [ideActionProposal({ action: "revealWorkspaceRange", workspaceRelativePath: "src/example.ts", range: testRange(), summary: "Reveal the example range." }), { action: "revealWorkspaceRange", workspaceRelativePath: "src/example.ts", range: testRange() }],
  ])("posts one GUI-owned VS Code request for proposal variant %#", async (proposal, expectedPayload) => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Variant proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Variant proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0].requestId).toMatch(/^gui-ide-proposal-action-\d+$/);
    expect(ideActionMessages[0].requestId.length).toBeLessThanOrEqual(128);
    expect(ideActionMessages[0].payload).toEqual(expectedPayload);
  });

  it("blocks duplicate proposal clicks while pending", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Duplicate proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Duplicate proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const runButton = findButton("Run read-only IDE action");
    await act(async () => {
      runButton.click();
      runButton.click();
    });

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(1);
    expect(findButton("IDE action pending…").disabled).toBe(true);
  });

  it("renders historical copy and no card when a valid proposal is followed by a normal assistant message", async () => {
    const valid = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Normal latest", 2)], chatThreads: {
      "chat-001": chatThread("chat-001", "Normal latest", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(valid)), chatMessage("chat-001", "assistant-2", "assistant", "Normal assistant response.")]),
    } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Earlier read-only IDE action proposal: Get IDE context. Only the latest valid proposal can be run from the proposal card.");
    expect(text).toContain("Normal assistant response.");
    expect(text).not.toContain("Review the proposal card below");
    expect(text).not.toContain("Read-only IDE action proposal");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Run read-only IDE action");
  });

  it("clears stale read-only proposal card when latest assistant message is invalid", async () => {
    const valid = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    const invalid = { ...valid, requestId: "assistant-supplied" };
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Stale proposal", 2)], chatThreads: {
      "chat-001": chatThread("chat-001", "Stale proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(valid)), chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(invalid))]),
    } });
    renderApp();
    await flushAsync();
    await flushAsync();
    expect(container?.textContent ?? "").toContain("Earlier read-only IDE action proposal: Get IDE context. Only the latest valid proposal can be run from the proposal card.");
    expect(container?.textContent ?? "").not.toContain("Read-only IDE action proposal");
  });

  it("resets proposal JSON inspection when the same message receives changed proposal content", async () => {
    const first = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/first.ts", summary: "Open first file." });
    const second = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/second.ts", summary: "Open second file." });
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, { ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Changed proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Changed proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(first))]) } });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });
    expect(container?.textContent ?? "").toContain('"workspaceRelativePath": "src/first.ts"');

    await act(async () => {
      setTextareaValue(chatInput(), "trigger sse for proposal update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();
    expect(sseController).toBeDefined();

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: "chat-001", payload: { messages: [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(second))] } })}\n\n`));
      await Promise.resolve();
    });
    await flushAsync();

    const changedText = container?.textContent ?? "";
    expect(changedText).toContain("Proposed a read-only IDE action: Open workspace file. Review the proposal card below. It will not run automatically.");
    expect(changedText).toContain("Open second file.");
    expect(changedText).not.toContain('"workspaceRelativePath": "src/first.ts"');
    expect(changedText).not.toContain('"workspaceRelativePath": "src/second.ts"');
    expect(findButton("Inspect proposal JSON").disabled).toBe(false);
  });

  it("correlates proposal action host progress and result in Agent activity", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Correlated action", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Correlated action", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();
    await act(async () => { findButton("Run read-only IDE action").click(); });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.ideActionRequest")?.[0].requestId;

    await dispatchHostIdeActionProgress(requestId, { phase: "running", status: "inProgress", summary: "Reading active editor context.", cloudRequired: false, action: "getContextSnapshot" });
    expect(container?.textContent ?? "").toContain("Get IDE context: inProgress");
    expect(container?.textContent ?? "").toContain("Reading active editor context.");
    await dispatchHostIdeActionResult(requestId, { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });
    expect(container?.textContent ?? "").toContain("Get IDE context: succeeded");
    expect(container?.textContent ?? "").toContain("Context snapshot ready.");
    expect(container?.textContent ?? "").toContain("Result context: source vscode · active editor present yes · workspace folders 1");
  });

  it("renders safe successful openWorkspaceFile result metadata", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/open-target.ts", workspaceRelativePath: "src/open-target.ts", languageId: "typescript" },
    });
    await act(async () => { findButton("Open file").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Opened workspace file.", cloudRequired: false, action: "openWorkspaceFile", workspaceRelativePath: "src/open-target.ts" });

    const text = container?.textContent ?? "";
    expect(text).toContain("Open file: succeeded");
    expect(text).toContain("Result path: src/open-target.ts");
  });

  it("renders safe successful revealWorkspaceRange result metadata", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/reveal-target.ts", workspaceRelativePath: "src/reveal-target.ts", languageId: "typescript" },
      selection: { startLine: 4, startCharacter: 2, endLine: 4, endCharacter: 9, text: "target" },
    });
    await act(async () => { findButton("Reveal range").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Revealed workspace range.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/reveal-target.ts", range: { start: { line: 4, character: 2 }, end: { line: 4, character: 9 } } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Reveal range: succeeded");
    expect(text).toContain("Result path: src/reveal-target.ts · result range: 4:2-4:9");
  });

  it("does not render forbidden IDE action result metadata rejected by bridge validation", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/rejected-open.ts", workspaceRelativePath: "src/rejected-open.ts", languageId: "typescript" },
    });
    await act(async () => { findButton("Open file").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "rejected", message: "Open rejected.", cloudRequired: false, action: "openWorkspaceFile", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Open file: pending");
    expect(text).toContain("Rejected invalid host bridge message");
    expect(text).not.toContain("Result context:");
    expect(text).not.toContain("Open rejected.");
  });

  it("notes duplicate result for the current completed IDE action request without re-rendering payload", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => { findButton("Get IDE context").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "First context result rendered.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "failed", message: "Duplicate result should not render.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Get IDE context: succeeded");
    expect(text).toContain("First context result rendered.");
    expect(text).toContain("Ignored duplicate IDE action result.");
    expect(text).not.toContain("Duplicate result should not render.");
  });

  it("does not render old-chat IDE action progress or results after direct chat id change", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Chat A", 1), chatSummary("chat-002", "Chat B", 0)], chatThreads: {
      "chat-001": chatThread("chat-001", "Chat A", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
      "chat-002": chatThread("chat-002", "Chat B", []),
    } });
    renderApp();
    await flushAsync();
    await flushAsync();
    await act(async () => { findButton("Run read-only IDE action").click(); });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.ideActionRequest")?.[0].requestId;

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await flushAsync();
    expect(container?.textContent ?? "").toContain("Agent activity · IDE actions");
    expect(findDetails("ide-actions-compact-details").open).toBe(false);
    findDetails("ide-actions-compact-details").open = true;
    expect(container?.textContent ?? "").toContain("No controlled IDE action requested yet.");

    await dispatchHostIdeActionProgress(requestId, { phase: "running", status: "inProgress", summary: "Old chat progress should not show.", cloudRequired: false, action: "getContextSnapshot" });
    await dispatchHostIdeActionResult(requestId, { status: "succeeded", message: "Old chat result should not show.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Agent activity · IDE actions");
    expect(text).toContain("No controlled IDE action requested yet.");
    expect(text).not.toContain("Old chat progress should not show.");
    expect(text).not.toContain("Old chat result should not show.");
    expect(text).not.toContain("Get IDE context: succeeded");
    expect(text).not.toContain("Ignored stale IDE action");
  });

  it("does not render old-chat duplicate IDE action results after direct chat id change", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Chat A", 0), chatSummary("chat-002", "Chat B", 0)], chatThreads: { "chat-001": chatThread("chat-001", "Chat A", []), "chat-002": chatThread("chat-002", "Chat B", []) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => { findButton("Get IDE context").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Original chat result rendered.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });
    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await flushAsync();
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "failed", message: "Old chat duplicate should not render.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    expect(container?.textContent ?? "").toContain("Agent activity · IDE actions");
    expect(findDetails("ide-actions-compact-details").open).toBe(false);
    findDetails("ide-actions-compact-details").open = true;
    const text = container?.textContent ?? "";
    expect(text).toContain("No controlled IDE action requested yet.");
    expect(text).not.toContain("Old chat duplicate should not render.");
    expect(text).not.toContain("Ignored duplicate IDE action result.");
  });

  it("bounds completed IDE action request tracking to a fixed small limit", () => {
    const completed = new Map<string, string>();
    for (let index = 0; index < completedIdeActionRequestChatsLimit + 5; index += 1) {
      rememberCompletedIdeActionRequest(completed, `request-${index}`, "chat-001");
    }

    expect(completed.size).toBe(completedIdeActionRequestChatsLimit);
    expect(completed.has("request-0")).toBe(false);
    expect(completed.has(`request-${completedIdeActionRequestChatsLimit + 4}`)).toBe(true);
  });

  it("does not write proposal data to browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/no-storage.ts", summary: "Open no storage file." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Storage proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Storage proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Open no storage file.");
    expect(browserStorageDump()).not.toContain("src/no-storage.ts");
  });

  it("rejects secret-like IDE action results before App renders unsafe payload or stores it", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "i".repeat(64);
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: `Opened /Users/alice/private/file.ts ${rawSecret}`, cloudRequired: false, action: "getContextSnapshot", privatePath: "/Users/alice/private/file.ts", token: rawSecret });

    expect(container?.textContent).toContain("Get IDE context: pending");
    expect(container?.textContent).toContain("Rejected invalid host bridge message");
    expect(container?.textContent).not.toContain("/Users/alice");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("i".repeat(64));
    expect(localSetItem.mock.calls.some((call) => call.some((value) => String(value).includes(rawSecret)))).toBe(false);
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("renders valid host.contextSnapshot preview with default include toggle", async () => {
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 10, startCharacter: 2, endLine: 12, endCharacter: 8, text: "function greet() {\n  return \"hello\";\n}" },
    });

    expect(container?.textContent).toContain("Active editor context");
    expect(container?.textContent).toContain("Source host: vscode");
    expect(container?.textContent).toContain("File: src/main.ts");
    expect(container?.textContent).toContain("Language: typescript");
    expect(container?.textContent).toContain("Selection range: 10:2-12:8");
    expect(container?.textContent).toContain("Bounded previewfunction greet()");
    expect(container?.textContent).toContain("Selected characters: 38");
    expect(container?.textContent).toContain("one-shot and is attached only to the next accepted message while enabled");
    expect(container?.textContent).toContain("Attach to next message");
    expect(attachedContextToggle().checked).toBe(true);
  });

  it("renders chat-first empty state for attached editor context", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { text: "const answer = 42;" },
    });

    expect(container?.textContent).toContain("Ready to ask about src/main.ts.");
    expect(container?.textContent).toContain("Send through GPT-4o mini (openai-api), or turn off attached context before sending.");
  });


  it("lets the user turn off attached context inclusion", async () => {
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({ selection: { text: "selected safe text" } });

    expect(attachedContextToggle().checked).toBe(true);
    await act(async () => {
      attachedContextToggle().click();
    });

    expect(attachedContextToggle().checked).toBe(false);
    expect(container?.textContent).toContain("Do not attach");
  });

  it("shows safe no-context status for missing or invalid context", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    expect(findDetails("attached-context-compact-details").open).toBe(false);
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          version: bridgeVersion,
          type: "host.contextSnapshot",
          payload: {
            kind: "active_editor",
            source: "vscode",
            file: { workspaceRelativePath: "/Users/alice/project/src/secret.ts" },
            edit: { replaceRange: true },
          },
        },
      }));
    });

    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(container?.textContent).toContain("Rejected invalid host bridge message");
    expect(container?.textContent).not.toContain("replaceRange");
    expect(container?.textContent).not.toContain("/Users/alice");
    expect(attachedContextToggleOptional()).toBeUndefined();
  });

  it("redacts secret-like context preview and bridge logs", async () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/session.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 10, text: `const token = "${rawSecret}"; Cookie: session=context-secret` },
    });

    expect(container?.textContent).toContain("Bounded previewconst token = \"[redacted]");
    expect(container?.textContent).toContain("Host message host.contextSnapshot");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("s".repeat(64));
    expect(container?.textContent).not.toContain("context-secret");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("does not send secret-like selected text context without acknowledgement", async () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: `const token = "${rawSecret}";` } });

    expect(container?.textContent).toContain("Context preview requires acknowledgement");
    expect(container?.textContent).toContain("Selected text preview was redacted");
    expect(attachedContextToggle().checked).toBe(false);
    expect(attachedContextToggle().disabled).toBe(true);
    expect(container?.textContent).not.toContain(rawSecret);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "send without secret context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "send without secret context" });
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("sends gated selected text context only after explicit acknowledgement and attach on user Send", async () => {
    const rawSecret = "access_token=" + "a".repeat(64);
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: `const token = "${rawSecret}";` } });
    fetchMock.mockClear();

    await act(async () => {
      attachedContextAcknowledgementToggle().click();
    });
    expect(attachedContextToggle().disabled).toBe(false);
    await act(async () => {
      attachedContextToggle().click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      setTextareaValue(chatInput(), "send acknowledged context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "send acknowledged context",
      context: {
        kind: "active_editor",
        source: "vscode",
        selection: { text: `const token = "${rawSecret}";` },
      },
    });
  });

  it("bounds huge attached context previews", async () => {
    const repeated = "safe context preview ";
    const hugeSelection = repeated.repeat(350);
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/huge.ts", workspaceRelativePath: "src/huge.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 200, endCharacter: 0, text: hugeSelection },
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Selected characters: 7350");
    expect((text.match(/safe context preview/g) ?? []).length).toBeLessThan(30);
    expect(text.length).toBeLessThan(20000);
    expect(text).toContain("Selected text preview was shortened");
    expect(attachedContextToggle().checked).toBe(false);
  });

  it("resets gated context acknowledgement when context payload changes", async () => {
    const firstSecret = "access_token=" + "f".repeat(64);
    const secondSecret = "access_token=" + "g".repeat(64);
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: `first ${firstSecret}` } });
    await act(async () => {
      attachedContextAcknowledgementToggle().click();
    });
    await act(async () => {
      attachedContextToggle().click();
    });
    expect(attachedContextAcknowledgementToggle().checked).toBe(true);
    expect(attachedContextToggle().checked).toBe(true);

    await dispatchHostContextSnapshot({ selection: { text: `second ${secondSecret}` } });

    expect(attachedContextAcknowledgementToggle().checked).toBe(false);
    expect(attachedContextToggle().checked).toBe(false);
    expect(attachedContextToggle().disabled).toBe(true);
  });

  it("sends attached context when valid and included", async () => {
    const contextText = "selected safe context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 21, text: contextText },
    });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello with included context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.type).toBe("user_message");
    expect(body.payload).toEqual({
      content: "hello with included context",
      context: {
        kind: "active_editor",
        source: "vscode",
        file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
        selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 21, text: contextText },
      },
    });
    expect(body.payload).not.toHaveProperty("providerId");
    expect(body.payload).not.toHaveProperty("modelId");
  });

  it("renders and sends valid JetBrains attached context once when included", async () => {
    const contextText = "val greeting = \"hello\"";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({
      source: "jetbrains",
      file: { displayPath: "src/Main.kt", workspaceRelativePath: "src/Main.kt", languageId: "kotlin" },
      selection: { startLine: 7, startCharacter: 4, endLine: 7, endCharacter: 26, text: contextText },
    });

    expect(container?.textContent).toContain("Active editor context");
    expect(container?.textContent).toContain("jetbrains");
    expect(container?.textContent).toContain("File: src/Main.kt");
    expect(container?.textContent).toContain("Language: kotlin");
    expect(container?.textContent).toContain("Selection range: 7:4-7:26");
    expect(container?.textContent).toContain("Bounded previewval greeting");
    expect(attachedContextToggle().checked).toBe(true);
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello with JetBrains context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "hello with JetBrains context",
      context: {
        kind: "active_editor",
        source: "jetbrains",
        file: { displayPath: "src/Main.kt", workspaceRelativePath: "src/Main.kt", languageId: "kotlin" },
        selection: { startLine: 7, startCharacter: 4, endLine: 7, endCharacter: 26, text: contextText },
      },
    });
    expect(container?.textContent).toContain("Context attached to the last accepted message from jetbrains src/Main.kt.");
    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();

    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "second JetBrains message without old context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "second JetBrains message without old context" });
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("does not send JetBrains attached context when the include toggle is disabled", async () => {
    const contextText = "disabled JetBrains context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ source: "jetbrains", selection: { text: contextText } });
    await act(async () => {
      attachedContextToggle().click();
    });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "send without JetBrains context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "send without JetBrains context" });
    expect(container?.textContent).toContain("Active editor context");
    expect(attachedContextToggleOptional()).toBeDefined();
    expect(attachedContextToggle().checked).toBe(false);
    expect(container?.textContent).not.toContain("Context attached to the last accepted message");
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("redacts secret-like JetBrains selection text from preview logs and storage", async () => {
    const rawSecret = "access_token=" + "j".repeat(64);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      source: "jetbrains",
      file: { displayPath: "src/Main.kt", languageId: "kotlin" },
      selection: { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 12, text: `val token = "${rawSecret}" Cookie: session=jetbrains-secret` },
    });

    expect(container?.textContent).toContain("jetbrains");
    expect(container?.textContent).toContain("Bounded previewval token = \"[redacted]");
    expect(container?.textContent).toContain("Host message host.contextSnapshot");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("j".repeat(64));
    expect(container?.textContent).not.toContain("jetbrains-secret");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("sends valid attached context once and clears preview for the next message", async () => {
    const contextText = "one shot selected context";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "first message with context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const firstBody = lastUserMessageBody();
    expect(firstBody.payload).toEqual({
      content: "first message with context",
      context: {
        kind: "active_editor",
        source: "vscode",
        selection: { text: contextText },
      },
    });
    expect(container?.textContent).toContain("Context attached to the last accepted message from vscode active editor.");
    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();

    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "second message without old context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "second message without old context" });
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("does not send attached context when the include toggle is disabled", async () => {
    const contextText = "attached text disabled";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    await act(async () => {
      attachedContextToggle().click();
    });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello without context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.type).toBe("user_message");
    expect(body.payload).toEqual({ content: "hello without context" });
    expect(container?.textContent).toContain("Active editor context");
    expect(attachedContextToggleOptional()).toBeDefined();
    expect(attachedContextToggle().checked).toBe(false);
    expect(container?.textContent).not.toContain("Context attached to the last accepted message");
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("keeps attached context and include toggle after a failed command for retry", async () => {
    const contextText = "retry selected context";
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandStatus: 500, commandError: "command failed safely" });
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "message that fails");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Bounded previewretry selected context");
    expect(attachedContextToggle().checked).toBe(true);

    mockRuntimeResponses(readyRuntimeOptions());
    fetchMock.mockClear();
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "message that fails",
      context: {
        kind: "active_editor",
        source: "vscode",
        selection: { text: contextText },
      },
    });
  });

  it("does not let stale chat command success clear newer attached context after chat change", async () => {
    const oldCommand = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: "old in-flight context" } });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/chats/chat-001/commands") {
        return oldCommand.promise;
      }
      return mockRuntimeResponse(input, init, readyRuntimeOptions());
    });

    await act(async () => {
      setTextareaValue(chatInput(), "old in-flight message");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
      await Promise.resolve();
    });
    await dispatchHostContextSnapshot({ selection: { text: "new chat context" } });

    oldCommand.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "old-request", type: "user_message" }));
    await flushAsync();

    expect(container?.textContent).toContain("Bounded previewnew chat context");
    expect(attachedContextToggle().checked).toBe(true);
    expect(container?.textContent).not.toContain("Command accepted old-request");
  });

  it("clears attached context on runtime settings changes so stale context is not sent", async () => {
    const contextText = "old runtime selected context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    expect(attachedContextToggleOptional()).toBeDefined();

    await act(async () => {
      setInputValue(sessionTokenInput(), "new-runtime-token");
    });
    await flushAsync();

    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello after settings change");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.payload).toEqual({ content: "hello after settings change" });
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("clears attached context on chat changes so stale context is not sent", async () => {
    const contextText = "old chat selected context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
    });

    expect(attachedContextToggleOptional()).toBeUndefined();
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello in new chat");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.payload).toEqual({ content: "hello in new chat" });
  });
});

describe("chat panel", () => {
  it("uses adaptive chat workbench structure with composer pinned outside the scroll region", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Inspect context." });
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-alpha", "Alpha thread", 2), chatSummary("chat-beta", "Beta thread", 1)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [
          chatMessage("chat-alpha", "msg-1", "user", "Hello layout"),
          chatMessage("chat-alpha", "msg-2", "assistant", JSON.stringify(proposal)),
        ]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    const workbench = container?.querySelector(".chat-workbench");
    const threadPane = container?.querySelector(".chat-thread-pane");
    const scrollRegion = container?.querySelector(".chat-scroll-region");
    const composer = container?.querySelector(".chat-composer");
    const list = container?.querySelector(".conversation-list");
    expect(workbench).toBeTruthy();
    expect(threadPane).toBeTruthy();
    expect(scrollRegion).toBeTruthy();
    expect(composer).toBeTruthy();
    expect(list).toBeTruthy();
    expect(scrollRegion?.contains(composer ?? null)).toBe(false);
    expect(scrollRegion?.textContent).toContain("Hello layout");
    expect(scrollRegion?.querySelector(".ide-action-proposal-card")?.textContent).toContain("Inspect context.");
    expect(list?.querySelectorAll(".conversation-item")).toHaveLength(2);
    expect(container?.querySelectorAll("#delete-current-conversation-help-rail")).toHaveLength(1);
    expect(container?.querySelectorAll("#delete-current-conversation-help-drawer")).toHaveLength(1);
    expect(container?.querySelector("[aria-describedby='delete-current-conversation-help-rail']")).toBeTruthy();
    expect(composer?.textContent).toContain("Coding Actions");
    expect(composer?.textContent).toContain("Attached context");
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("opens the compact chats drawer and closes it after selecting a chat", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-1", "user", "Alpha message")]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-2", "assistant", "Beta answer")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    const drawer = () => container?.querySelector<HTMLElement>(".conversations-drawer");
    expect(drawer()?.classList.contains("open")).toBe(false);
    expect(drawer()?.hidden).toBe(true);
    await act(async () => {
      findButton("Chats").click();
    });
    expect(drawer()?.classList.contains("open")).toBe(true);
    expect(drawer()?.hidden).toBe(false);
    expect(drawer()?.querySelector("[aria-describedby='delete-current-conversation-help-drawer']")).toBeTruthy();

    const betaInDrawer = Array.from(drawer()?.querySelectorAll<HTMLButtonElement>("button.conversation-select") ?? []).find((button) => /Open conversation: Beta thread/.test(button.getAttribute("aria-label") ?? ""));
    expect(betaInDrawer).toBeTruthy();
    await act(async () => {
      betaInDrawer?.click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(drawer()?.classList.contains("open")).toBe(false);
    expect(drawer()?.hidden).toBe(true);
    expect(container?.textContent).toContain("Beta answer");
  });

  it("loads conversation list after runtime refresh", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 2), chatSummary("chat-beta", "Beta thread", 2)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-1", "user", "Persisted alpha")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("Conversations");
    expect(container?.textContent).toContain("Alpha thread");
    expect(container?.textContent).toContain("Beta thread");
    expect(container?.textContent).toContain("2 local runtime conversations returned.");
    expect(container?.textContent).toContain("Updated 2026-05-29T07:16:30Z");
    expect(container?.textContent).toContain("2 persisted messages");
    expect(container?.textContent).toContain("active conversation");
    expectConversationRowParts("Alpha thread", {
      updated: "Updated 2026-05-29T07:16:30Z",
      messages: "1 persisted message",
      position: "Conversation 1 of 2",
    });
    expectConversationRowParts("Beta thread", {
      updated: "Updated 2026-05-29T07:16:30Z",
      messages: "2 persisted messages",
      position: "Conversation 2 of 2",
    });
  });

  it("renders conversation empty and loading states", async () => {
    const chats = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        return chats.promise;
      }
      return mockRuntimeResponse(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Loading local runtime conversations…");
    expect(container?.textContent).toContain("Loading saved conversations from the local runtime…");

    chats.resolve(jsonResponse({ chats: [] }));
    await flushAsync();

    expect(container?.textContent).toContain("No local runtime conversations returned.");
    expect(container?.textContent).toContain("No saved conversations remain. The prompt is ready for a fresh local chat, and nothing is written to browser storage.");
    expect(chatInput().value).toBe("");
  });

  it("ignores stale chat list after settings change and clears loading state", async () => {
    const oldChats = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        if (url.startsWith("http://127.0.0.1:8001")) {
          return oldChats.promise;
        }
        return Promise.resolve(jsonResponse({ chats: [] }));
      }
      return mockRuntimeResponse(input, init, readyRuntimeOptions());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("Loading local runtime conversations…");

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    oldChats.resolve(jsonResponse({ chats: [chatSummary("chat-stale", "Stale old list title", 1)] }));
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).not.toContain("Stale old list title");
    expect(container?.textContent).toContain("No local runtime conversations returned.");
    expect(container?.textContent).not.toContain("Loading local runtime conversations…");
  });

  it("ignores stale chat lists after create and delete attempts", async () => {
    const staleInitialList = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        return staleInitialList.promise;
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        createChatThread: chatThread("chat-created", "Created current", []),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Loading…").click();
      await Promise.resolve();
    });
    staleInitialList.resolve(jsonResponse({ chats: [chatSummary("chat-stale-list", "Stale list after create", 1)] }));
    await flushAsync();

    expect(container?.textContent).toContain("chat-created");
    expect(container?.textContent).not.toContain("Stale list after create");

    const staleDeleteList = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        return staleDeleteList.promise;
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-created", "Created current", 0)],
      });
    });
    await act(async () => {
      findButton("Refresh runtime").click();
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });
    staleDeleteList.resolve(jsonResponse({ chats: [chatSummary("chat-deleted-stale", "Deleted stale sentinel", 1)] }));
    await flushAsync();

    expect(container?.textContent).toContain("Selected Deleted stale sentinel because the previous chat is not in this local runtime list.");
    expect(browserStorageDump()).not.toContain("Deleted stale sentinel");
  });

  it("creates a new chat and selects it", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-old", "Old thread", 1)],
      createChatThread: chatThread("chat-created", "Created thread", []),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("New chat").click();
      await Promise.resolve();
    });

    expect(findInputValue("chat-created")).toBeDefined();
    expect(container?.textContent).toContain("chat-created");
    expect(container?.textContent).toContain("current");
    expect(container?.textContent).toContain("0 persisted messages");
    expect(chatInput().value).toBe("");
  });

  it("switches chats and renders persisted messages", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 2)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-a", "user", "Alpha persisted")]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-b1", "user", "Beta prompt"), chatMessage("chat-beta", "msg-b2", "assistant", "Beta answer")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();
    await act(async () => {
      findConversationButton(/Open conversation: Beta thread/).click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Beta prompt");
    expect(container?.textContent).toContain("Beta answer");
    expect(container?.textContent).not.toContain("Alpha persisted");
  });

  it("deletes a chat and safely selects a fallback", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-a", "user", "Alpha persisted")]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-b", "user", "Beta persisted")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => button.textContent === "Delete current")?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Deleted Alpha thread. Selected Beta thread.");
    expect(container?.textContent).toContain("Beta thread");
    expect(findInputValue("chat-beta")).toBeDefined();
  });

  it("resets to a fresh local state after deleting the last current chat", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-solo", "Solo thread", 1)],
      chatThreads: {
        "chat-solo": chatThread("chat-solo", "Solo thread", [chatMessage("chat-solo", "msg-solo", "user", "Solo persisted")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });

    expect(findInputValue("chat-001")).toBeDefined();
    expect(container?.textContent).toContain("No local runtime conversations returned.");
    expect(container?.textContent).toContain("fresh local chat");
    expect(container?.textContent).not.toContain("Solo persisted");
  });

  it("hydrates current chat from SSE snapshot without duplicate optimistic messages", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: { messages: [chatMessage("chat-001", "msg-user", "user", "Snapshot prompt"), chatMessage("chat-001", "msg-assistant", "assistant", "Snapshot answer")] } },
      ],
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "Snapshot prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.querySelectorAll(".chat-bubble")[0]?.textContent).toContain("Snapshot prompt");
    expect((container?.querySelectorAll(".chat-bubble")[0]?.textContent?.match(/Snapshot prompt/g) ?? [])).toHaveLength(1);
    expect(container?.textContent).toContain("Snapshot answer");
  });

  it("does not persist chat history content or secret-like messages to browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const secret = "sk-chat-history-secret";
    mockRuntimeResponses({
      chats: [chatSummary("chat-secret", "Secret thread", 1)],
      chatThreads: {
        "chat-secret": chatThread("chat-secret", "Secret thread", [chatMessage("chat-secret", "msg-secret", "user", `secret ${secret}`)]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain(secret);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("browser storage remains free after create switch and delete", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const runtimeToken = "history-runtime-token-secret";
    const providerKey = "sk-history-provider-secret";
    const deletedSentinel = "deleted-chat-storage-sentinel";
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      createChatThread: chatThread("chat-created", "Created thread", [chatMessage("chat-created", "msg-created", "user", providerKey)]),
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-alpha", "user", deletedSentinel)]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-beta", "user", "Beta visible")]),
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(findInputValue("")!, runtimeToken);
    });
    await act(async () => {
      findConversationButton(/Open conversation: Beta thread/).click();
      await Promise.resolve();
    });
    await act(async () => {
      findButton("New chat").click();
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(runtimeToken);
    expect(browserStorageDump()).not.toContain(providerKey);
    expect(browserStorageDump()).not.toContain(deletedSentinel);
  });

  it("ignores stale chat thread responses after chat selection changes", async () => {
    const alphaThread = deferred<Response>();
    mockRuntimeResponses({ chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)] });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats/chat-alpha")) {
        return alphaThread.promise;
      }
      if (url.endsWith("/v1/chats/chat-beta")) {
        return Promise.resolve(jsonResponse(chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-b", "user", "Beta current")] )));
      }
      return mockRuntimeResponse(input, init, { chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)] });
    });

    await act(async () => {
      setInputValue(chatIdInput(), "chat-alpha");
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(chatIdInput(), "chat-beta");
      await Promise.resolve();
    });
    alphaThread.resolve(jsonResponse(chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-a", "user", "Alpha stale secret")] )));
    await flushAsync();

    expect(container?.textContent).toContain("Beta current");
    expect(container?.textContent).not.toContain("Alpha stale secret");
  });

  it("ignores in-flight thread load after deleting the current chat", async () => {
    const oldThread = deferred<Response>();
    mockRuntimeResponses({
      chats: [chatSummary("chat-old", "Old thread", 1), chatSummary("chat-next", "Next thread", 0)],
      chatThreads: {
        "chat-next": chatThread("chat-next", "Next thread", []),
      },
    });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats/chat-old") && init?.method !== "DELETE") {
        return oldThread.promise;
      }
      return mockRuntimeResponse(input, init, {
        chats: [chatSummary("chat-old", "Old thread", 1), chatSummary("chat-next", "Next thread", 0)],
        chatThreads: {
          "chat-next": chatThread("chat-next", "Next thread", []),
        },
      });
    });
    await act(async () => {
      setInputValue(chatIdInput(), "chat-old");
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });
    oldThread.resolve(jsonResponse(chatThread("chat-old", "Old thread", [chatMessage("chat-old", "msg-old", "user", "deleted stale thread secret")] )));
    await flushAsync();

    expect(findInputValue("chat-next")).toBeDefined();
    expect(container?.textContent).not.toContain("deleted stale thread secret");
    expect(container?.textContent).not.toContain("Old thread");
  });

  it("delete current active chat aborts old stream and ignores later SSE", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Current stream", 1), chatSummary("chat-next", "Next thread", 0)],
        chatThreads: {
          "chat-next": chatThread("chat-next", "Next thread", []),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream then delete");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 3, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "late deleted chat stream secret" } } })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain("late deleted chat stream secret");
    expect(container?.textContent).toContain("Next thread");
  });

  it("ignores active SSE events from an old chat after switching conversations", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/chats/chat-beta")) {
        return Promise.resolve(jsonResponse(chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-beta", "user", "Beta current")] )));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "old chat stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      findConversationButton(/Open conversation: Beta thread/).click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 1, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "stale old chat stream text" } } })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Beta current");
    expect(container?.textContent).not.toContain("stale old chat stream text");
  });

  it("shows guided OpenAI API fallback CTA when runtime is connected with no provider", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Chat readiness");
    expect(container?.textContent).toContain("0 enabled providers");
    expect(container?.textContent).toContain("Runtime connected — choose the first-message path");
    expect(container?.textContent).toContain("Real provider (safe default): use OpenAI API-key fallback, paste a provider API key once, save, test provider, refresh runtime/model readiness, then send.");
    expect(container?.textContent).toContain("OpenAI API-key fallback is the current safe/default real-provider path for first-message GPT; provider setup stays local-first BYOK with no Yet AI hosted backend, account, cloud workspace, or credit balance required.");
    expect(container?.textContent).toContain("State: Provider required");
    expect(container?.textContent).toContain("Provider required: choose Demo Mode for a no-key local trial, or configure a BYOK OpenAI-compatible provider/model for real answers.");
    expect(container?.textContent).toContain("For the quickest real-provider path, choose OpenAI API-key fallback, paste a provider API key once, save, test provider, refresh runtime/model readiness");
    expect(container?.textContent).toContain("Provider required for first message");
    expect(container?.textContent).toContain("Why: No enabled OpenAI-compatible provider/model is ready for chat streaming.");
    expect(container?.textContent).toContain("Next safest action: For real answers, use the OpenAI API-key fallback (safe/default), paste a provider API key, save, test provider, refresh runtime/model readiness, then send. Choose Demo Mode only to try the chat flow without provider calls.");
    expect(container?.textContent).toContain("OpenAI API-key fallback is the current safe/default real-provider path for first-message GPT; provider setup stays local-first BYOK");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders chat-first empty state for provider setup", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Chat with Yet AI");
    expect(container?.textContent).toContain("Choose how this first chat should answer.");
    expect(container?.textContent).toContain("Provider credentials are sent only to the local runtime and are not stored by the GUI.");
  });


  it("enables chat readiness from connected experimental OpenAI OAuth when no provider model is ready", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("0 enabled providers");
    expect(container?.textContent).toContain("State: Experimental OpenAI account / gpt-5-codex");
    expect(container?.textContent).toContain("Experimental Codex-like OpenAI account chat is connected through the local runtime.");
    expect(container?.textContent).toContain("private-endpoint path is high-risk");
    expect(container?.textContent).toContain("OpenAI API-key fallback remains the safe/default setup");
    expect(findButton("Send").disabled).toBe(false);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it("disables Send during OAuth exchange when no API-key provider is ready", async () => {
    const exchange = deferred<Response>();
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/exchange")) {
        return exchange.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: pendingExperimentalAuthResponse() });
    });

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-mutating");
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    expect(findButton("Exchanging…").disabled).toBe(true);
    expect(container?.textContent).toContain("State: OpenAI account login changing");
    expect(findButton("Send").disabled).toBe(true);

    exchange.resolve(jsonResponse(connectedExperimentalAuthResponse()));
    await flushAsync();
  });

  it("disables Send immediately during OAuth disconnect without API-key provider readiness", async () => {
    const disconnect = deferred<Response>();
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();
    expect(findButton("Send").disabled).toBe(false);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/disconnect")) {
        return disconnect.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: providerAuthResponse("connected") });
    });

    await act(async () => {
      findButton("Disconnect login").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("State: OpenAI account login changing");
    expect(container?.textContent).not.toContain("State: Experimental OpenAI account / gpt-5-codex");
    expect(findButton("Send").disabled).toBe(true);

    disconnect.resolve(jsonResponse({ ...providerAuthResponse("not_configured"), success: true }));
    await flushAsync();
  });

  it("keeps Send enabled through API-key provider readiness while OAuth disconnects", async () => {
    const disconnect = deferred<Response>();
    mockRuntimeResponses({
      authResponse: providerAuthResponse("connected"),
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/disconnect")) {
        return disconnect.promise;
      }
      return mockRuntimeResponse(input, init, {
        authResponse: providerAuthResponse("connected"),
        providers: [enabledProvider()],
        models: [readyModel({ providerId: "openai-api" })],
      });
    });

    await act(async () => {
      findButton("Disconnect login").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(findButton("Send").disabled).toBe(false);

    disconnect.resolve(jsonResponse({ ...providerAuthResponse("api_key_configured"), success: true }));
    await flushAsync();
  });

  it("ignores stale disconnect responses after runtime settings change", async () => {
    const disconnect = deferred<Response>();
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/disconnect") {
        return disconnect.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: providerAuthResponse("login_unavailable") });
    });

    await act(async () => {
      findButton("Disconnect login").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    disconnect.resolve(jsonResponse({ ...providerAuthResponse("connected"), success: true, message: "stale disconnect token response" }));
    await flushAsync();

    expect(container?.textContent).not.toContain("stale disconnect token response");
    expect(container?.textContent).not.toContain("State: Experimental OpenAI account / gpt-5-codex");
  });

  it("renders sanitized provider-auth mutation failures without raw code session token or cookie text", async () => {
    const rawCode = "manual-code-visible-secret";
    const rawToken = "access_token=" + "t".repeat(64);
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/exchange")) {
        return Promise.resolve(jsonResponse({ error: `exchange failed ${rawToken} session_token=provider-login-session-001 Cookie: login-cookie-secret code=${rawCode}` }, 500));
      }
      return mockRuntimeResponse(input, init, { authResponse: pendingExperimentalAuthResponse() });
    });

    await act(async () => {
      setInputValue(authCodeInput(), rawCode);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    expect(authCodeInputOptional()?.value ?? "").toBe("");
    expect(container?.textContent).toContain("exchange failed [redacted]");
    expect(container?.textContent).not.toContain(rawCode);
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("provider-login-session-001");
    expect(container?.textContent).not.toContain("login-cookie-secret");
    expect(container?.textContent).not.toContain("t".repeat(64));
    expect(browserStorageDump()).not.toContain(rawCode);
  });

  it("keeps API-key provider readiness preferred over connected experimental OAuth", async () => {
    mockRuntimeResponses({
      authResponse: providerAuthResponse("connected"),
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(container?.textContent).not.toContain("State: Experimental OpenAI account / gpt-5-codex");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("disables Send when runtime model references a missing provider", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "missing-provider" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Refresh runtime or test/save provider before sending.");
    expect(container?.textContent).toContain("Model and provider do not match");
    expect(container?.textContent).toContain("Next safest action: Test the saved provider, then refresh runtime after fixing the provider/model id.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("disables Send when runtime model references a disabled provider", async () => {
    mockRuntimeResponses({
      providers: [{ ...enabledProvider(), enabled: false }],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("0 enabled providers");
    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Refresh runtime or test/save provider before sending.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("resolves a runtime model without provider id only when the enabled provider mapping is unambiguous", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel()],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("disables Send when a runtime model without provider id maps to multiple enabled providers", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider(), { ...enabledProvider(), id: "other-openai", displayName: "Other OpenAI" }],
      models: [readyModel()],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("2 enabled providers");
    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Refresh runtime or test/save provider before sending.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("sanitizes secret-like provider and model labels in mismatch copy", async () => {
    const longModelSecret = "access_token=" + "m".repeat(64);
    const longProviderSecret = "refresh_token=" + "p".repeat(64);
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ id: longModelSecret, displayName: `Model ${longModelSecret}`, providerId: `provider-${longProviderSecret}` })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Refresh runtime or test/save provider before sending.");
    expect(container?.textContent).toContain("Model Model [redacted] is not available on enabled provider provider-[redacted].");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("m".repeat(64));
    expect(container?.textContent).not.toContain("p".repeat(64));
    expect(findButton("Send").disabled).toBe(true);
  });

  it.each(["pending", "expired", "revoked", "error"] satisfies ProviderAuthStatus[])("does not enable Send for %s OAuth status", async (status) => {
    mockRuntimeResponses({ authResponse: providerAuthResponse(status) });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Provider required");
    expect(container?.textContent).toContain("Provider required: choose Demo Mode for a no-key local trial, or configure a BYOK OpenAI-compatible provider/model for real answers.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("transitions chat readiness from runtime unavailable to provider required to ready", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(container?.textContent).toContain("Connect the local runtime first");
    expect(container?.textContent).toContain("Next safest action: Use Refresh runtime from this chat page. If it still fails, fix the loopback URL or Session token in Local runtime connection.");
    expect(container?.textContent).toContain("Runtime Session token unlocks this GUI to the loopback runtime only; Provider API key unlocks the upstream model through the runtime. They are different secrets.");
    expect(findButton("Send").disabled).toBe(true);

    mockRuntimeResponses();
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("State: Provider required");
    expect(container?.textContent).toContain("Provider required for first message");
    expect(findButton("Send").disabled).toBe(true);

    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(container?.textContent).toContain("Ready for your first message");
    expect(container?.textContent).toContain("Next safest action: Type a prompt and click Send through the local runtime.");
    expect(container?.textContent).toContain("Send available");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("shows configured provider and first runtime model readiness", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("requires ready chat streaming model metadata before enabling Send", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model status: GPT-4o mini (OpenAI API): ready; chat supported, streaming supported, tools unsupported, reasoning unsupported");
    expect(container?.textContent).toContain("Model readiness: GPT-4o mini (OpenAI API): ready; chat supported, streaming supported, tools unsupported, reasoning unsupported");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("disables Send for unready models with sanitized visible status", async () => {
    const rawSecret = "access_token=" + "u".repeat(64);
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api", readiness: { status: "missing_credentials", reason: `Provider login failed ${rawSecret}` } })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model GPT-4o mini is not ready for chat streaming: missing credentials. Provider login failed [redacted]");
    expect(container?.textContent).toContain("Model status: GPT-4o mini (OpenAI API): missing credentials, Provider login failed [redacted]");
    expect(container?.textContent).toContain("Model is not ready yet");
    expect(container?.textContent).toContain("Next safest action: Test the provider, fix credentials/model readiness locally, then refresh runtime.");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("u".repeat(64));
    expect(findButton("Send").disabled).toBe(true);
  });

  it("disables Send for models without chat or streaming capabilities", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api", capabilities: { chat: false, streaming: true, tools: false, reasoning: false } })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model GPT-4o mini cannot send chat because required capabilities are unavailable: chat unsupported, streaming supported, tools unsupported, reasoning unsupported.");
    expect(findButton("Send").disabled).toBe(true);

    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api", capabilities: { chat: true, streaming: false, tools: false, reasoning: false } })],
    });
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Model GPT-4o mini cannot send chat because required capabilities are unavailable: chat supported, streaming unsupported, tools unsupported, reasoning unsupported.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("does not treat older model responses without readiness metadata as send-ready", async () => {
    mockRuntimeResponses({
      providers: [{ ...enabledProvider(), models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini" }] }],
      models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model GPT-4o mini is missing readiness metadata from the runtime. Refresh the runtime after updating it before sending.");
    expect(container?.textContent).toContain("Model status: GPT-4o mini (OpenAI API): readiness metadata missing");
    expect(findButton("Send").disabled).toBe(true);
  });


  it("disables Send when provider and model data exists but runtime connectivity fails", async () => {
    mockRuntimeResponses({
      runtimeFailure: true,
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("runtime error");
    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(container?.textContent).toContain("Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders chat-first empty state for runtime connection", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Start here: connect the local runtime.");
    expect(container?.textContent).toContain("no hosted Yet AI backend, account, cloud workspace, or credit balance is required.");
  });


  it("disables experimental OAuth Send when runtime connectivity fails", async () => {
    mockRuntimeResponses({ runtimeFailure: true, authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(container?.textContent).toContain("Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("sending message renders user bubble and clears input after accepted command", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Hello Yet AI");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("You");
    expect(container?.textContent).toContain("Hello Yet AI");
    expect(chatInput().value).toBe("");
  });

  it("ignores stale chat command success after runtime settings change", async () => {
    const oldCommand = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/chats/chat-001/commands") {
        return oldCommand.promise;
      }
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        return Promise.resolve(sseResponse([]));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setTextareaValue(chatInput(), "old runtime question");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    await act(async () => {
      setTextareaValue(chatInput(), "new runtime draft");
    });

    oldCommand.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "old-request", type: "user_message" }));
    await flushAsync();

    expect(container?.textContent).not.toContain("old runtime question");
    expect(container?.textContent).not.toContain("Command accepted old-request");
    expect(chatInput().value).toBe("new runtime draft");
  });

  it("ignores stale chat command failure after chat id change", async () => {
    const oldCommand = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/chats/chat-001/commands") {
        return oldCommand.promise;
      }
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        return Promise.resolve(sseResponse([]));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setTextareaValue(chatInput(), "old chat question");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
      await Promise.resolve();
    });

    oldCommand.resolve(jsonResponse({ error: "old chat failed Authorization: Bearer old-secret" }, 500));
    await flushAsync();

    expect(container?.textContent).not.toContain("old chat failed");
    expect(container?.textContent).not.toContain("Command error");
    expect(container?.textContent).not.toContain("old-secret");
    expect(container?.textContent).toContain("Ready for your first local conversation.");
  });

  it("blocks programmatic submit while Send is disabled without opening SSE or posting a command", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "Blocked message");
    });
    await act(async () => {
      chatInput().closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Chat is not ready for the current runtime settings. Refresh runtime and configure a provider/model before sending.");
    expect(container?.textContent).toContain("Recovery: configure and test a local BYOK provider/model, refresh runtime, then send again.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/chats/subscribe"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/v1/chats/") && String(url).endsWith("/commands") && init?.method === "POST")).toBe(false);
    expect(chatInput().value).toBe("Blocked message");
  });

  it("renders assistant streaming text from SSE events", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        { seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Hello" } } },
        { seq: 3, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: " from Yet AI" } } },
        { seq: 4, type: "stream_finished", chatId: "chat-001", payload: {} },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Stream please");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Yet AI");
    expect(container?.textContent).toContain("Hello from Yet AI");
  });

  it("renders first assistant response from terminal message_added after one Send", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        {
          seq: 2,
          type: "message_added",
          chatId: "chat-001",
          payload: {
            message: chatMessage("chat-001", "assistant-terminal-1", "assistant", "Terminal message_added answer after first send."),
          },
        },
        { seq: 3, type: "stream_finished", chatId: "chat-001", payload: { finishReason: "stop" } },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Terminal event please");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Terminal event please");
    expect(container?.textContent).toContain("Terminal message_added answer after first send.");
    expect(chatLifecycleText()).toBe("Ready to send.");
    expect(chatLifecycleText()).not.toContain("waiting");
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(1);
  });

  it("renders consecutive identical terminal message_added assistant responses after their user prompts", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const commands = [deferred<Response>(), deferred<Response>()];
    let commandIndex = 0;
    let nextSeq = 0;
    const enqueueSseEvent = (type: string, payload: Record<string, unknown> = {}) => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: nextSeq, type, chatId: "chat-001", payload })}\n\n`));
      nextSeq += 1;
    };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (init?.method === "POST" && url.endsWith("/v1/chats/chat-001/commands")) {
        const body = JSON.parse(String(init.body)) as { type?: string };
        if (body.type === "user_message") {
          const command = commands[commandIndex];
          commandIndex += 1;
          return command.promise;
        }
        return mockRuntimeResponse(input, init, readyRuntimeOptions());
      }
      return mockRuntimeResponse(input, init, readyRuntimeOptions());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "First terminal prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/chats/subscribe"))).toBe(false);
    await act(async () => {
      commands[0].resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: "user_message" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      enqueueSseEvent("snapshot");
      enqueueSseEvent("stream_started");
      enqueueSseEvent("message_added", { message: chatMessage("chat-001", "assistant-terminal-1", "assistant", "Demo Mode canned response.") });
      enqueueSseEvent("stream_finished", { finishReason: "stop" });
      await Promise.resolve();
    });
    expect(chatLifecycleText()).toBe("Ready to send.");

    await act(async () => {
      setTextareaValue(chatInput(), "Second terminal prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      enqueueSseEvent("stream_started");
      enqueueSseEvent("message_added", { message: chatMessage("chat-001", "assistant-terminal-2", "assistant", "Demo Mode canned response.") });
      enqueueSseEvent("stream_finished", { finishReason: "stop" });
      await Promise.resolve();
    });

    let bubbles = Array.from(container?.querySelectorAll(".chat-bubble") ?? []).map((bubble) => bubble.textContent ?? "");
    expect(bubbles.filter((text) => text.includes("Demo Mode canned response."))).toHaveLength(2);
    const secondPromptIndexBeforeAck = bubbles.findIndex((text) => text.includes("Second terminal prompt"));
    let secondResponseIndexBeforeAck = -1;
    bubbles.forEach((text, index) => {
      if (text.includes("Demo Mode canned response.")) {
        secondResponseIndexBeforeAck = index;
      }
    });
    expect(secondPromptIndexBeforeAck).toBeGreaterThan(-1);
    expect(secondPromptIndexBeforeAck).toBeLessThan(secondResponseIndexBeforeAck);

    await act(async () => {
      commands[1].resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-002", type: "user_message" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    bubbles = Array.from(container?.querySelectorAll(".chat-bubble") ?? []).map((bubble) => bubble.textContent ?? "");
    expect(chatLifecycleText()).toBe("Ready to send.");
    expect(bubbles).toEqual(expect.arrayContaining([
      expect.stringContaining("First terminal prompt"),
      expect.stringContaining("Second terminal prompt"),
    ]));
    expect(bubbles.filter((text) => text.includes("Demo Mode canned response."))).toHaveLength(2);
    expect(bubbles.findIndex((text) => text.includes("First terminal prompt"))).toBeLessThan(bubbles.findIndex((text) => text.includes("Demo Mode canned response.")));
    const lastDemoResponseIndex = bubbles.reduce((lastIndex, text, index) => text.includes("Demo Mode canned response.") ? index : lastIndex, -1);
    expect(bubbles.findIndex((text) => text.includes("Second terminal prompt"))).toBeLessThan(lastDemoResponseIndex);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(2);
  });

  it("renders visible safe error bubbles for request and SSE errors", async () => {
    const rawToken = "Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandStatus: 500, commandError: `failed ${rawToken}` });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Fail please");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Error");
    expect(container?.textContent).toContain("failed [redacted]");
    expect(container?.textContent).toContain("Recovery: Refresh runtime and resend after the local command endpoint is healthy. No automatic retry was started.");
    expect(container?.textContent).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  });

  it("stale command acceptance after chat change does not clear the current draft", async () => {
    const command = deferred<Response>();
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandResponse: command.promise });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "do not clear stale command");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
    });
    await act(async () => {
      setTextareaValue(chatInput(), "new chat draft");
    });
    command.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "stale-command", type: "user_message" }));
    await flushAsync();

    expect(chatInput().value).toBe("new chat draft");
    expect(container?.textContent).not.toContain("do not clear stale command");
    expect(container?.textContent).not.toContain("stale-command");
  });

  it("stale command failure after runtime change is ignored and sanitized", async () => {
    const secret = "stale-command-secret-token";
    const command = deferred<Response>();
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandResponse: command.promise });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stale failure message");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await act(async () => {
      setTextareaValue(chatInput(), "new runtime draft");
    });
    command.resolve(jsonResponse({ error: `late command error Bearer ${secret}` }, 500));
    await flushAsync();

    expect(chatInput().value).toBe("new runtime draft");
    expect(container?.textContent).not.toContain("late command error");
    expect(container?.textContent).not.toContain(secret);
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("redacts terminal command runtime errors before rendering", async () => {
    const apiKey = "sk-test-command-placeholder";
    const opaqueToken = "Z".repeat(64);
    const jwt = `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}`;
    const rawFragments = [
      "test-runtime-token",
      apiKey,
      "command-cookie-secret",
      "command-set-cookie-secret",
      "command-query-secret",
      "command-oauth-secret",
      "auth.json",
      opaqueToken,
      jwt,
    ];
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      commandStatus: 500,
      commandError: [
        "terminal command failed",
        "Authorization: Bearer test-runtime-token",
        apiKey,
        "Cookie: session=command-cookie-secret",
        "setCookie=sid=command-set-cookie-secret",
        "https://callback.test/return?api_key=command-query-secret",
        "oauth_refresh_token=command-oauth-secret",
        "../.codex/auth.json",
        opaqueToken,
        jwt,
      ].join("\n"),
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Fail with terminal command error");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Error");
    expect(text).toContain("terminal command failed");
    expect(text).toContain("[redacted]");
    for (const fragment of rawFragments) {
      expect(text).not.toContain(fragment);
    }
  });

  it("redacts terminal SSE error events and stops assistant streaming", async () => {
    const opaqueToken = "Y".repeat(64);
    const jwt = `${"d".repeat(16)}.${"e".repeat(16)}.${"f".repeat(16)}`;
    const rawFragments = [
      "test-runtime-token",
      "sse-api-placeholder",
      "sse-cookie-secret",
      "sse-set-cookie-secret",
      "sse-query-secret",
      "sse-oauth-secret",
      "auth.json",
      opaqueToken,
      jwt,
    ];
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        { seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Partial safe answer" } } },
        {
          seq: 3,
          type: "error",
          chatId: "chat-001",
          payload: {
            message: [
              "terminal SSE failed",
              "Authorization: Bearer test-runtime-token",
              "OPENAI_API_KEY=sse-api-placeholder",
              "Cookie: session=sse-cookie-secret",
              "setCookie=sid=sse-set-cookie-secret",
              "https://callback.test/return?api_key=sse-query-secret",
              "oauth_refresh_token=sse-oauth-secret",
              "../.codex/auth.json",
              opaqueToken,
              jwt,
            ].join("\n"),
          },
        },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Stream then terminal error");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Partial safe answer");
    expect(text).toContain("Error");
    expect(text).toContain("terminal SSE failed");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("Assistant is streaming…");
    for (const fragment of rawFragments) {
      expect(text).not.toContain(fragment);
    }
  });

  it("renders actionable sanitized provider recovery guidance from SSE error codes", async () => {
    const rawToken = "access_token=" + "g".repeat(64);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        {
          seq: 1,
          type: "error",
          chatId: "chat-001",
          payload: {
            code: "provider_context_too_large",
            message: `The request is too large ${rawToken} Cookie: session=chat-cookie`,
          },
        },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Prompt with too much context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("The request is too large [redacted]");
    expect(text).toContain("Recovery: reduce the prompt or attached editor context, then send again.");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("chat-cookie");
    expect(text).not.toContain("g".repeat(64));
  });

  it("changing chat id clears messages for the new chat", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "First chat message");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("First chat message");

    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
    });

    expect(container?.textContent).not.toContain("First chat message");
    expect(container?.textContent).toContain("Ready for your first local conversation.");
  });

  it("does not write chat messages or secrets to browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const secret = "sk-chat-secret-value";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), `message ${secret}`);
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("Stop response with no active stream sends no abort", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(() => findButton("Stop SSE")).toThrow();
    await act(async () => {
      findButton("Stop response").click();
      await Promise.resolve();
    });

    const abortCall = fetchMock.mock.calls.find(([url, init]) => {
      if (!String(url).endsWith("/v1/chats/chat-001/commands") || init?.method !== "POST") {
        return false;
      }
      const body = JSON.parse(String(init.body)) as { type?: string };
      return body.type === "abort";
    });
    expect(abortCall).toBeUndefined();
    expect(container?.textContent).toContain("SSE stopped");
  });

  it("Stop response during active streaming sends abort and removes streaming indicator", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
        return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: JSON.parse(String(init.body)).type }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream then stop");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: "chat-001", payload: {} })}\n\n`));
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 1, type: "stream_started", chatId: "chat-001", payload: {} })}\n\n`));
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Partial" } } })}\n\n`));
      await Promise.resolve();
    });
    fetchMock.mockClear();

    expect(container?.textContent).toContain("Assistant is streaming…");
    expect(() => findButton("Stop SSE")).toThrow();

    await act(async () => {
      findButton("Stop response").click();
      await Promise.resolve();
    });

    const abortCalls = fetchMock.mock.calls.filter(([url, init]) => {
      if (!String(url).endsWith("/v1/chats/chat-001/commands") || init?.method !== "POST") {
        return false;
      }
      return (JSON.parse(String(init.body)) as { type?: string }).type === "abort";
    });
    expect(abortCalls).toHaveLength(1);
    expect(container?.textContent).not.toContain("Assistant is streaming…");
  });

  it("ignores active SSE events from old runtime settings after settings change", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
        return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: "user_message" }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "old runtime stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 1, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "stale old runtime token" } } })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain("stale old runtime token");
  });

  it("settings changes send abort to the active stream runtime settings instead of the new runtime", async () => {
    const oldToken = "old-runtime-token";
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
        return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: JSON.parse(String(init.body)).type }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), oldToken);
    });
    await act(async () => {
      setTextareaValue(chatInput(), "stream before retarget");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });

    const abortCalls = fetchMock.mock.calls.filter(([url, init]) => {
      if (!String(url).includes("/v1/chats/chat-001/commands") || init?.method !== "POST") {
        return false;
      }
      return (JSON.parse(String(init.body)) as { type?: string }).type === "abort";
    });
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(new Headers(abortCalls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${oldToken}`);
    sseController?.close();
  });

  it("token-only changes abort the active stream with the old token", async () => {
    const oldToken = "old-token-only-secret";
    const stream = mockStreamingReadyRuntime();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), oldToken);
    });
    await act(async () => {
      setTextareaValue(chatInput(), "stream before token change");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await act(async () => {
      setInputValue(sessionTokenInput(), "new-token-only-secret");
      await Promise.resolve();
    });

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(new Headers(abortCalls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${oldToken}`);
    stream.close();
  });

  it("chat id changes abort the old active chat and not the new chat", async () => {
    const stream = mockStreamingReadyRuntime();
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream before chat change");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
      await Promise.resolve();
    });

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(String(abortCalls[0][0])).not.toContain("chat-002");
    stream.close();
  });

  it("unmount cleanup aborts the active stream without state updates or async abort error reporting", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abortFailure = deferred<Response>();
    const stream = mockStreamingReadyRuntime({ abortResponse: abortFailure.promise });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream before unmount");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await act(async () => {
      root?.unmount();
      root = undefined;
      await Promise.resolve();
    });
    abortFailure.resolve(jsonResponse({ error: "Abort failed Authorization: Bearer post-unmount-secret" }, 500));
    await flushAsync();

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(consoleError).not.toHaveBeenCalled();
    stream.close();
  });

  it("sanitizes SSE debug timeline payloads before rendering", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "safe text", accessToken: "short" }, access_token: "s".repeat(64), nested: { clientSecret: "tiny" }, header: "Authorization: Bearer short-secret", cookie: "Cookie: session=secret; refresh=also-secret", path: "../.codex/auth.json" } },
      ],
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "secret stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("safe text");
    expect(container?.textContent).toContain('"[redacted]": "[redacted]"');
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("accessToken");
    expect(container?.textContent).not.toContain("clientSecret");
    expect(container?.textContent).not.toContain("tiny");
    expect(container?.textContent).not.toContain("short-secret");
    expect(container?.textContent).not.toContain("session=secret");
    expect(container?.textContent).not.toContain("auth.json");
  });
});

describe("edit proposal preview", () => {
  it("renders a bounded proposal in browser mode without auto-applying or writing browser storage", async () => {
    localStorage.setItem("sentinel", "keep");
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replace one visible editor line after user review.");
    expect(text).toContain("src/example.ts");
    expect(text).toContain("Files: 1");
    expect(text).toContain("Text edits: 1");
    expect(text).toContain("const label = \"Yet AI\";");
    expect(text).toContain("Preview only in this host. Browser and JetBrains cannot apply proposed edits");
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in VS Code after review")).toBe(false);
    expect(browserStorageDump()).toContain("sentinel");
    expect(browserStorageDump()).not.toContain("Replace one visible editor line");
  });

  it("does not leak secret-like replacement text into DOM or storage, and shows redaction warning", async () => {
    localStorage.setItem("sentinel", "keep");
    const rawToken = "sk-" + "x".repeat(40);
    const longToken = "y".repeat(64);
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: `api_key=${longToken} Bearer ${rawToken}`,
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Redacted edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Redacted edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    expect(text).not.toContain(rawToken);
    expect(text).not.toContain(longToken);
    expect(text).not.toContain("api_key=");
    expect(text).not.toContain("Bearer");
    expect(browserStorageDump()).toContain("sentinel");
    expect(browserStorageDump()).not.toContain(rawToken);
    expect(browserStorageDump()).not.toContain(longToken);
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in VS Code after review")).toBe(false);
  });

  it("disables apply for redacted replacement preview until acknowledged, then emits gui.applyWorkspaceEditRequest on click in VS Code", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const longToken = "z".repeat(64);
    const rawToken = "sk-" + "a".repeat(40);
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: `api_key=${longToken} Bearer ${rawToken}`,
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Redacted apply gated", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Redacted apply gated", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    expect(text).toContain("I understand the raw replacement text may differ from the redacted preview.");
    expect(text).not.toContain(rawToken);
    expect(text).not.toContain(longToken);
    expect(text).not.toContain("api_key=");
    expect(text).not.toContain("Bearer");
    expect(browserStorageDump()).not.toContain(rawToken);
    expect(browserStorageDump()).not.toContain(longToken);

    const applyButton = findButton("Apply in VS Code after review");
    expect(applyButton.disabled).toBe(true);

    // Even if the user tries to click while disabled, no apply is emitted.
    await act(async () => {
      applyButton.click();
    });
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);

    // Acknowledge the warning; the apply button becomes enabled.
    const ack = container?.querySelector<HTMLInputElement>("[data-testid='edit-proposal-acknowledge-redaction']");
    expect(ack).not.toBeNull();
    await act(async () => {
      ack!.click();
    });
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);

    // Clicking now emits the apply request with the raw proposal text.
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
    // The raw replacement is sent only after the explicit acknowledgement and apply click.
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
  });

  it("keeps non-redacted apply enabled without acknowledgement in VS Code", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Non-redacted apply", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Non-redacted apply", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Replacement preview was redacted or shortened");
    expect(text).not.toContain("I understand the raw replacement text may differ from the redacted preview.");
    expect(container?.querySelector("[data-testid='edit-proposal-acknowledge-redaction']")).toBeNull();
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
  });

  it("does not expose raw secret-like replacement text in DOM or storage before acknowledgement for a redacted proposal", async () => {
    localStorage.setItem("sentinel", "keep");
    const rawToken = "sk-" + "b".repeat(40);
    const longToken = "c".repeat(64);
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: `Bearer ${rawToken} api_key=${longToken}`,
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Redacted secret isolation", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Redacted secret isolation", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const html = container?.innerHTML ?? "";
    expect(container?.textContent ?? "").toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    expect(container?.textContent ?? "").toContain("I understand the raw replacement text may differ from the redacted preview.");
    expect(container?.querySelector("[data-testid='edit-proposal-acknowledge-redaction']")).not.toBeNull();
    expect(html).not.toContain(rawToken);
    expect(html).not.toContain(longToken);
    expect(html).not.toContain(`Bearer ${rawToken}`);
    expect(html).not.toContain(`api_key=${longToken}`);
    expect(browserStorageDump()).toContain("sentinel");
    expect(browserStorageDump()).not.toContain(rawToken);
    expect(browserStorageDump()).not.toContain(longToken);
    // In browser mode the apply button is not rendered; in VS Code it would be disabled. Either way the acknowledgement control is required before any apply can be issued.
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in VS Code after review")).toBe(false);
  });

  it("resets acknowledgement when the edit proposal payload changes", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const shortenedReplacementText = "safe replacement text segment ".repeat(14);
    const firstProposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: shortenedReplacementText,
            },
          ],
        },
      ],
    };
    const secondProposal = {
      ...firstProposal,
      summary: "Different confirmed edit after first review.",
    };

    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Edit proposal acknowledge reset", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal acknowledge reset", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(firstProposal))]) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();
    await flushAsync();

    const firstAck = container?.querySelector<HTMLInputElement>("[data-testid='edit-proposal-acknowledge-redaction']");
    expect(firstAck).not.toBeNull();
    expect(findButton("Apply in VS Code after review").disabled).toBe(true);
    await act(async () => {
      firstAck!.click();
    });
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);

    // Send a new user message that produces a new (changed) assistant edit proposal.
    await act(async () => {
      setTextareaValue(chatInput(), "trigger sse for second edit proposal");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 2,
        type: "snapshot",
        chatId: "chat-001",
        payload: { messages: [chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(secondProposal))] },
      })}\n\n`));
      sseController?.close();
    });
    await flushAsync();
    await flushAsync();

    const secondText = container?.textContent ?? "";
    expect(secondText).toContain("Different confirmed edit after first review.");
    expect(secondText).toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    const secondAck = container?.querySelector<HTMLInputElement>("[data-testid='edit-proposal-acknowledge-redaction']");
    expect(secondAck).not.toBeNull();
    expect(secondAck?.checked).toBe(false);
    expect(findButton("Apply in VS Code after review").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("rejects duplicate edit proposal file groups before rendering or posting", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: "const label = \"Yet AI\";",
            },
          ],
        },
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 9, character: 0 }, end: { line: 9, character: 12 } },
              replacementText: "const next = \"Yet AI\";",
            },
          ],
        },
        {
          workspaceRelativePath: "src/another.ts",
          textReplacements: [
            {
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
              replacementText: "const another = \"Yet AI\";",
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Duplicate file edit groups chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Duplicate file edit groups chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Propose safe edit");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(container?.querySelector("[data-testid='edit-proposal-unique-files']")).toBeNull();
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("does not transfer edit-proposal inspect state to a changed proposal JSON", async () => {
    const first = safeEditProposalPayload();
    const second = { ...first, summary: "Different confirmed edit after first review." };
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Edit proposal inspect transfer", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal inspect transfer", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(first))]) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();
    await flushAsync();

    const initialText = container?.textContent ?? "";
    expect(initialText).not.toContain(JSON.stringify(first, null, 2));

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });
    expect(container?.textContent ?? "").toContain("Replace one visible editor line after user review.");

    await act(async () => {
      setTextareaValue(chatInput(), "trigger sse for edit proposal update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();
    expect(sseController).toBeDefined();

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: "chat-001", payload: { messages: [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(second))] } })}\n\n`));
      await Promise.resolve();
    });
    await flushAsync();

    const changedText = container?.textContent ?? "";
    expect(changedText).toContain("Different confirmed edit after first review.");
    expect(changedText).not.toContain("Replace one visible editor line after user review.");
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(findButton("Inspect proposal JSON").disabled).toBe(false);
  });


  it("renders JetBrains proposal preview without apply emission", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "JetBrains edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "JetBrains edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replace one visible editor line after user review.");
    expect(text).toContain("src/example.ts");
    expect(text).toContain("Preview only in this host. Browser and JetBrains cannot apply proposed edits");
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in VS Code after review")).toBe(false);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("emits an apply request only after explicit user click in a privileged host", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });

    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
  });

  it("uses a GUI-owned bounded apply request id and ignores an assistant-supplied requestId", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    const assistantRequestId = "assistant-request-id-must-not-correlate";
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, requestId: assistantRequestId, payload: proposal };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Assistant request id ignored", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Assistant request id ignored", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(envelope))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent ?? "").toContain("Propose safe edit");
    expect(container?.textContent ?? "").not.toContain(assistantRequestId);
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
    expect(applyCalls[0][0].requestId).not.toBe(assistantRequestId);
    expect(applyCalls[0][0].payload).toEqual(proposal);
  });

  it("clears proposal apply state synchronously on direct chat id changes", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal chat", 1), chatSummary("chat-002", "Other chat", 0)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
        "chat-002": chatThread("chat-002", "Other chat", []),
      },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(findButton("Apply in VS Code after review")).toBeDefined();
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const oldRequestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(oldRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
    });

    let text = container?.textContent ?? "";
    expect(text).not.toContain("Propose safe edit");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(text).not.toContain(oldRequestId);

    await dispatchHostApplyResult(oldRequestId, {
      status: "applied",
      message: "Stale direct chat id result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    text = container?.textContent ?? "";
    expect(text).not.toContain("Host apply result");
    expect(text).not.toContain("Stale direct chat id result.");
  });

  it("keeps proposal request id stable across unrelated chat view updates and prevents duplicate apply while pending", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Stable proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Stable proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
      sseEvents: [],
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const initialRequestId = editProposalRequestId();
    await act(async () => {
      setTextareaValue(chatInput(), "cause unrelated chat update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editProposalRequestId()).toBe(initialRequestId);
    const applyButton = findButton("Apply in VS Code after review");
    await act(async () => {
      applyButton.click();
      applyButton.click();
    });

    expect(findButton("VS Code apply request pending…").disabled).toBe(true);
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);

    await dispatchHostApplyResult(applyCalls[0][0].requestId, {
      status: "applied",
      message: "Stable proposal result displayed.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Stable proposal result displayed.");

    await act(async () => {
      setTextareaValue(chatInput(), "cause another unrelated chat update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editProposalRequestId()).toBe(initialRequestId);
    expect(container?.textContent ?? "").toContain("Stable proposal result displayed.");
  });

  it("allows explicit pending apply cancel without emitting another request or accepting stale results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Cancelable proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Cancelable proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(findButton("VS Code apply request pending…").disabled).toBe(true);

    await act(async () => {
      findButton("Clear pending apply state").click();
    });

    expect(findButton("Apply in VS Code after review").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(1);

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Stale canceled apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Stale canceled apply result.");
  });

  it("uses a fresh apply attempt id after clearing pending state and ignores the stale first result", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Retry proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Retry proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const firstApplyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    const firstRequestId = firstApplyCalls[firstApplyCalls.length - 1]?.[0].requestId;
    expect(firstRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await act(async () => {
      findButton("Clear pending apply state").click();
    });
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    const secondRequestId = applyCalls[applyCalls.length - 1]?.[0].requestId;
    expect(applyCalls).toHaveLength(2);
    expect(secondRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
    expect(secondRequestId).not.toBe(firstRequestId);
    // Session-nonce contract: two retries inside the same App mount must share
    // the same per-session nonce segment but differ in the counter segment.
    const firstMatch = firstRequestId?.match(/^gui-edit-proposal-apply-([A-Za-z0-9][A-Za-z0-9_.-]*)-(\d+)$/);
    const secondMatch = secondRequestId?.match(/^gui-edit-proposal-apply-([A-Za-z0-9][A-Za-z0-9_.-]*)-(\d+)$/);
    expect(firstMatch).not.toBeNull();
    expect(secondMatch).not.toBeNull();
    expect(firstMatch?.[1]).toBe(secondMatch?.[1]);
    expect(firstMatch?.[1].length ?? 0).toBeGreaterThan(0);
    expect(firstMatch?.[2]).not.toBe(secondMatch?.[2]);

    await dispatchHostApplyResult(firstRequestId, {
      status: "applied",
      message: "Stale first apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Stale first apply result.");
    expect(findButton("VS Code apply request pending…").disabled).toBe(true);

    await dispatchHostApplyResult(secondRequestId, {
      status: "applied",
      message: "Second apply result displayed.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Second apply result displayed.");
  });

  it("regenerates the apply session nonce on each App mount and shares it across retries", () => {
    // Per-session contract: the helper must return a non-empty, bridge-safe
    // nonce (no forbidden secret/api_key/sk markers, no token/secret words).
    const nonce = generateApplyRequestSessionNonce();
    expect(nonce).toMatch(/^s[0-9a-f]{12}$/);
    expect(nonce.length).toBeLessThanOrEqual(128);
    expect(/authorization|bearer|api[_-]?key|token|secret|access[_-]?token|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(nonce)).toBe(false);

    // Two independent calls produce different nonces (high-entropy).
    const other = generateApplyRequestSessionNonce();
    expect(other).not.toBe(nonce);
  });

  it("rejects invalid proposal objects before rendering or sending", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const invalidProposal = { ...safeEditProposalPayload(), requiresUserConfirmation: false };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Invalid proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Invalid proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(invalidProposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Propose safe edit");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("clears a stale valid proposal when an invalid latest assistant proposal replaces it", async () => {
    const proposal = safeEditProposalPayload();
    const invalidProposal = { ...proposal, requiresUserConfirmation: false };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Invalid latest proposal chat", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Invalid latest proposal chat", [
          chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal)),
          chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(invalidProposal)),
        ]),
      },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent ?? "").not.toContain("Propose safe edit");
    expect(container?.querySelector(".edit-proposal-card")).toBeNull();
  });

  it("fail-closes a stale apply when latest chat messages replace a valid proposal with invalid content", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Dynamic invalid proposal chat", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Dynamic invalid proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(findButton("Apply in VS Code after review")).toBeDefined();
    const staleRequestId = editProposalRequestId();
    await act(async () => {
      setTextareaValue(chatInput(), "open dynamic proposal stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 1,
        type: "snapshot",
        chatId: "chat-001",
        payload: {
          messages: [
            chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal)),
            chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify({ ...proposal, requiresUserConfirmation: false })),
          ],
        },
      })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent ?? "").not.toContain("Propose safe edit");
    expect(container?.textContent ?? "").not.toContain("Apply in VS Code after review");
    expect(container?.querySelector(".edit-proposal-card")).toBeNull();

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 2,
        type: "snapshot",
        chatId: "chat-001",
        payload: {
          messages: [chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify({ ...proposal, requiresUserConfirmation: false }))],
        },
      })}\n\n`));
      await Promise.resolve();
    });
    await dispatchHostApplyResult(staleRequestId, {
      status: "applied",
      message: "Stale dynamic apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(container?.textContent ?? "").not.toContain("Stale dynamic apply result.");
  });

  it("shows only matching pending host apply results and ignores unsolicited or stale results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Correlated proposal chat", 1), chatSummary("chat-002", "Other chat", 1)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Correlated proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
        "chat-002": chatThread("chat-002", "Other chat", []),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "applied",
      message: "Unsolicited apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Unsolicited apply result.");

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "failed",
      message: "Mismatched apply result.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    expect(container?.textContent ?? "").not.toContain("Mismatched apply result.");

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Applied after user confirmation.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    let text = container?.textContent ?? "";
    expect(text).toContain("Host apply result: applied");
    expect(text).toContain("Applied after user confirmation.");
    expect(text).toContain("src/example.ts");

    await dispatchHostApplyResult(requestId, {
      status: "failed",
      message: "Authorization Bearer unsafe-secret",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });

    text = container?.textContent ?? "";
    expect(text).toContain("Applied after user confirmation.");
    expect(text).not.toContain("unsafe-secret");

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    expect(container?.textContent ?? "").not.toContain("Host apply result");
    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Stale result after chat switch.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Stale result after chat switch.");
  });

  it("bounds completed host apply request tracking to a fixed small limit", () => {
    const completed = new Map<string, string>();
    for (let index = 0; index < completedApplyRequestChatsLimit + 5; index += 1) {
      rememberCompletedApplyRequest(completed, `request-${index}`, "chat-001");
    }

    expect(completed.size).toBe(completedApplyRequestChatsLimit);
    expect(completed.has("request-0")).toBe(false);
    expect(completed.has(`request-${completedApplyRequestChatsLimit + 4}`)).toBe(true);
  });

  it("does not overwrite a rendered host apply result when a duplicate result arrives for the same chat", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Confirmed edit apply chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Confirmed edit apply chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "First host apply result rendered.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("First host apply result rendered.");

    await dispatchHostApplyResult(requestId, {
      status: "failed",
      message: "Duplicate host apply result should not render.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    const text = container?.textContent ?? "";
    expect(text).toContain("First host apply result rendered.");
    expect(text).toContain("Ignored duplicate host apply result.");
    expect(text).not.toContain("Duplicate host apply result should not render.");
  });

  it("rejects unsafe host apply result messages and paths before rendering", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Sanitized result chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Sanitized result chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    const secret = "sk-" + "d".repeat(40);
    await dispatchHostApplyResult(requestId, {
      status: "failed",
      message: `Failed with Bearer ${secret} at /Users/private/me/.config/auth.json ${"detail ".repeat(80)}`,
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: ["src/example.ts", "credentials/private-token.txt"],
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Rejected invalid host bridge message");
    expect(text).not.toContain("Host apply result: failed");
    expect(text).not.toContain("[redacted]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("/Users/private/me");
    expect(text).not.toContain("credentials/private-token.txt");
    expect(text.length).toBeLessThan(12000);
  });

  it("ignores stale host apply result while a different apply request is pending in the same chat", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Stale apply chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Stale apply chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "failed",
      message: "Unsolicited host apply result.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    expect(container?.textContent ?? "").not.toContain("Unsolicited host apply result.");
    expect(container?.textContent ?? "").not.toContain("Ignored stale host apply result.");

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const pendingRequestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(pendingRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "failed",
      message: "Mismatched stale host apply result should not render.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    const text = container?.textContent ?? "";
    expect(text).toContain("Ignored stale host apply result.");
    expect(text).not.toContain("Mismatched stale host apply result should not render.");
    expect(findButton("VS Code apply request pending…").disabled).toBe(true);

    await dispatchHostApplyResult(pendingRequestId, {
      status: "applied",
      message: "Pending apply result displayed.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Pending apply result displayed.");
    expect(container?.textContent ?? "").not.toContain("Ignored stale host apply result.");
  });

  it("does not render an old-chat host apply result or a duplicate for a previous chat", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Original chat", 1), chatSummary("chat-002", "Switched chat", 0)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Original chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
        "chat-002": chatThread("chat-002", "Switched chat", []),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Original chat apply result rendered.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Original chat apply result rendered.");

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await flushAsync();
    expect(container?.textContent ?? "").not.toContain("Host apply result");

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Old chat duplicate apply result should not render.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    const text = container?.textContent ?? "";
    expect(text).not.toContain("Old chat duplicate apply result should not render.");
    expect(text).not.toContain("Ignored duplicate host apply result.");
    expect(text).not.toContain("Ignored stale host apply result.");
  });

  it("compacts latest valid edit proposal bubble and hides raw JSON by default", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = safeEditProposalPayload();
    const rawJson = JSON.stringify(proposal);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Compact edit proposal", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Compact edit proposal", [chatMessage("chat-001", "assistant-1", "assistant", rawJson)]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const initialText = container?.textContent ?? "";
    expect(initialText).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(initialText).toContain("Propose safe edit");
    expect(initialText).toContain("Replace one visible editor line after user review.");
    expect(initialText).not.toContain(rawJson);
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Replace one visible editor line");

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });

    const inspectedText = container?.textContent ?? "";
    const inspectedPre = container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']");
    expect(inspectedPre).not.toBeNull();
    expect(inspectedPre?.textContent).toContain("\"workspaceRelativePath\": \"src/example.ts\"");
    expect(inspectedPre?.textContent).toContain("\"summary\":");
    expect(inspectedText).toContain("\"workspaceRelativePath\": \"src/example.ts\"");
    expect(inspectedText).toContain("\"requiresUserConfirmation\": true");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Replace one visible editor line");
  });

  it("renders historical confirmed edit proposal copy and shows no active card when latest is normal", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const valid = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Historical edit proposal", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Historical edit proposal", [
          chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(valid)),
          chatMessage("chat-001", "assistant-2", "assistant", "Normal assistant response."),
        ]),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Earlier safe edit proposal. Only the latest valid proposal can be requested from the proposal card.");
    expect(text).toContain("Normal assistant response.");
    expect(text).not.toContain("Propose safe edit");
    expect(text).not.toContain("Replace one visible editor line after user review.");
    expect(container?.querySelector(".edit-proposal-card")).toBeNull();
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply in VS Code after review");
    expect(container?.querySelectorAll("pre[aria-label=\"Assistant edit proposal JSON\"]")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("resets edit proposal inspect state when payload changes and the new proposal is hidden by default", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const firstProposal = safeEditProposalPayload();
    const secondProposal = {
      ...safeEditProposalPayload(),
      summary: "Replace a different editor line after user review.",
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 7, character: 0 }, end: { line: 7, character: 20 } },
              replacementText: "const other = \"Yet AI\";",
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal change", 1)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Edit proposal change", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(firstProposal))]),
      },
      sseEvents: [],
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).not.toBeNull();

    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) { sseController = controller; },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Edit proposal change", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal change", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(secondProposal))]) },
      });
    });

    await act(async () => {
      setTextareaValue(chatInput(), "open edit proposal stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 1,
        type: "snapshot",
        chatId: "chat-001",
        payload: {
          messages: [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(secondProposal))],
        },
      })}\n\n`));
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Replace a different editor line after user review.");
    expect(text).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(findButton("Inspect proposal JSON")).toBeDefined();

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });
    const inspectedPre = container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']");
    expect(inspectedPre).not.toBeNull();
    expect(inspectedPre?.textContent).toContain("\"summary\": \"Replace a different editor line after user review.\"");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("does not render compact edit proposal bubble or card when the latest assistant message is invalid", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    const invalidProposal = { ...proposal, requiresUserConfirmation: false };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Invalid latest edit", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Invalid latest edit", [
          chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal)),
          chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(invalidProposal)),
        ]),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Earlier safe edit proposal. Only the latest valid proposal can be requested from the proposal card.");
    expect(text).not.toContain("Proposed a safe edit.");
    expect(text).not.toContain("Propose safe edit");
    expect(container?.querySelector(".edit-proposal-card")).toBeNull();
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply in VS Code after review");
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it.each([
    ["applied", "Edits were applied by the host after confirmation."],
    ["denied", "The host/user declined the edit. Review the host confirmation and request apply again only if you still want it."],
    ["rejected", "The host rejected the edit by policy or validation. Ask for a smaller/safe proposal before trying again."],
    ["failed", "The host failed while applying. The file may have changed; refresh context and ask for an updated proposal before retrying."],
  ] satisfies Array<["applied" | "denied" | "rejected" | "failed", string]>)(
    "renders per-status repair guidance with the host apply result for %s",
    async (status, guidance) => {
      const postMessage = vi.fn();
      window.acquireVsCodeApi = () => ({ postMessage });
      const proposal = safeEditProposalPayload();
      mockRuntimeResponses({
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Repair guidance chat", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Repair guidance chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
      });
      renderApp();
      await flushAsync();
      await flushAsync();

      await act(async () => {
        findButton("Apply in VS Code after review").click();
      });
      const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
      expect(requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

      const hostResultMessage = `Host result ${status} should be shown alongside the static repair hint.`;
      await dispatchHostApplyResult(requestId, {
        status,
        message: hostResultMessage,
        cloudRequired: false,
        appliedEditCount: status === "applied" ? 1 : 0,
        affectedFiles: status === "applied" ? ["src/example.ts"] : [],
      });

      const text = container?.textContent ?? "";
      expect(text).toContain(`Host apply result: ${status}`);
      expect(text).toContain(guidance);
      expect(container?.querySelector(".apply-result-card .subtle[data-testid='apply-result-guidance']")).not.toBeNull();
      expect(text).toContain(hostResultMessage);
      // The GUI only renders the sanitized host result alongside the bounded/static repair hint;
      // it never claims to have applied, retried, or edited files itself.
      expect(text).not.toContain("Authorization Bearer");
    },
  );

  it("drops host apply results whose status is not in the bounded repair-guidance set", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Unsafe status chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Unsafe status chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    // Unknown statuses are rejected by the bridge payload validator before reaching the panel,
    // so no result card or repair guidance is rendered for them.
    await dispatchHostApplyResult(undefined, {
      status: "exploded",
      message: "Should not render at all.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    expect(container?.querySelector(".apply-result-card")).toBeNull();
    expect(container?.textContent ?? "").not.toContain("Should not render at all.");
    expect(container?.textContent ?? "").not.toContain("Edits were applied by the host after confirmation.");
    expect(container?.textContent ?? "").not.toContain("The host failed while applying.");
  });
});

async function dispatchHostReady(payload: { runtimeUrl: string; sessionToken?: string }) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.ready",
        payload: {
          ...payload,
          productId: "yet-ai",
          displayName: "Yet AI",
          cloudRequired: false,
        },
      },
    }));
  });
}

async function dispatchHostContextSnapshot(payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.contextSnapshot",
        requestId: "context-001",
        payload: {
          kind: "active_editor",
          source: "vscode",
          ...payload,
        },
      },
    }));
  });
}

async function dispatchHostApplyResult(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.applyWorkspaceEditResult",
        requestId,
        payload,
      },
    }));
  });
}

async function dispatchHostIdeActionProgress(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.ideActionProgress",
        requestId,
        payload,
      },
    }));
  });
}

async function dispatchHostIdeActionResult(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.ideActionResult",
        requestId,
        payload,
      },
    }));
  });
}

function renderApp() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<App />);
  });
}

function editProposalRequestId(): string {
  const match = (container?.textContent ?? "").match(/Proposal id: (gui-edit-proposal-\d+)/);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

type MockRuntimeOptions = {
  authStatusCode?: number;
  authMessage?: string;
  authSupportsLogin?: boolean;
  authResponse?: ProviderAuthResponse;
  startAuthUrl?: string;
  startAuthMessage?: string;
  exchangeResponse?: ProviderAuthResponse & { success: boolean };
  sseEvents?: unknown[];
  commandResponse?: Promise<Response>;
  commandStatus?: number;
  commandError?: string;
  providers?: unknown[];
  models?: unknown[];
  modelsFailure?: boolean;
  demoMode?: unknown;
  demoModeStatus?: number;
  demoModeSetResponse?: unknown;
  demoModeSetStatus?: number;
  runtimeFailure?: boolean;
  pingResponse?: unknown;
  capsResponse?: unknown;
  providerTestResponse?: unknown;
  providerTestStatus?: number;
  providerSaveResponse?: unknown;
  providerSaveStatus?: number;
  chats?: unknown[];
  chatThreads?: Record<string, unknown>;
  createChatThread?: unknown;
  agentProgress?: unknown;
  agentProgressStatus?: number;
  agentProgressError?: string;
};

function providerAuthResponse(status: ProviderAuthStatus): ProviderAuthResponse {
  const authSource = status === "api_key_configured" ? "api_key" : status === "login_unavailable" ? "none" : "oauth";
  return {
    provider: "openai",
    configured: status === "api_key_configured" || status === "connected",
    status,
    authSource,
    supportsLogin: status !== "login_unavailable" && status !== "api_key_configured",
    supportsApiKey: true,
    cloudRequired: false,
    message: `Mock status ${status}`,
    accountLabel: status === "connected" ? "user@example.test" : undefined,
    expiresAt: status === "connected" || status === "expired" ? "2026-05-24T01:00:00Z" : undefined,
    redacted: status === "api_key_configured" ? "sk-...test" : status === "connected" ? "oauth-...test" : undefined,
    pollIntervalSeconds: status === "pending" ? 5 : undefined,
  };
}

function pendingExperimentalAuthResponse(): ProviderAuthResponse {
  return {
    provider: "openai",
    configured: false,
    status: "pending",
    authSource: "oauth",
    supportsLogin: true,
    supportsApiKey: true,
    authorizationUrl: "https://auth.openai.com/oauth/authorize?client_id=yet-ai-local&state=codex-state-001",
    sessionId: "provider-login-session-001",
    expiresAt: "2026-05-24T01:00:00Z",
    scopes: ["openid", "profile", "email", "offline_access"],
    cloudRequired: false,
    message: "Experimental high-risk Codex-like OpenAI login is pending.",
  };
}

function connectedExperimentalAuthResponse(): ProviderAuthResponse & { success: boolean } {
  return {
    ...providerAuthResponse("connected"),
    success: true,
    message: "OpenAI login is connected.",
  };
}

function demoModeResponse(enabled: boolean) {
  return {
    enabled,
    providerId: "yet-demo",
    modelId: "yet-demo-chat",
    displayName: "Yet AI Demo Mode",
    cloudRequired: false,
    providerAccess: "direct",
    message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality.",
  };
}

function demoProvider() {
  return {
    id: "yet-demo",
    kind: "demo-local",
    displayName: "Yet AI Demo Mode",
    enabled: true,
    baseUrl: "local-runtime-demo-mode",
    auth: { type: "none", configured: true },
    models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat" })],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function enabledProvider() {
  return {
    id: "openai-api",
    kind: "openai-compatible",
    displayName: "OpenAI API",
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "api_key", configured: true, redacted: "sk-...test" },
    models: [readyModel()],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function readyModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "gpt-4o-mini",
    displayName: "GPT-4o mini",
    capabilities: { chat: true, streaming: true, tools: false, reasoning: false },
    readiness: { status: "ready" },
    ...overrides,
  };
}

function readyRuntimeOptions(): Pick<MockRuntimeOptions, "providers" | "models"> {
  return {
    providers: [enabledProvider()],
    models: [readyModel({ providerId: "openai-api" })],
  };
}

function chatSummary(chatId: string, title: string, messageCount: number) {
  return {
    chatId,
    title,
    createdAt: "2026-05-29T07:15:00Z",
    updatedAt: "2026-05-29T07:16:30Z",
    messageCount,
  };
}

function chatMessage(chatId: string, id: string, role: "user" | "assistant" | "error", content: string, status: "complete" | "error" = "complete") {
  return {
    id,
    chatId,
    role,
    content,
    createdAt: "2026-05-29T07:15:00Z",
    status,
  };
}

function chatMessageWithoutStatus(chatId: string, id: string, role: "user" | "assistant" | "error", content: string) {
  return {
    id,
    chatId,
    role,
    content,
    createdAt: "2026-05-29T07:15:00Z",
  };
}

function chatThread(chatId: string, title: string, messages: unknown[]) {
  return {
    chatId,
    title,
    createdAt: "2026-05-29T07:15:00Z",
    updatedAt: "2026-05-29T07:16:30Z",
    messages,
  };
}

function safeEditProposalPayload() {
  return {
    requiresUserConfirmation: true,
    summary: "Replace one visible editor line after user review.",
    cloudRequired: false,
    edits: [
      {
        workspaceRelativePath: "src/example.ts",
        textReplacements: [
          {
            range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
            replacementText: "const label = \"Yet AI\";",
          },
        ],
      },
    ],
  };
}

function testRange() {
  return { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } };
}

function ideActionProposal(overrides: Record<string, unknown>) {
  return {
    type: "assistant.ideActionProposal",
    version: bridgeVersion,
    requiresUserConfirmation: true,
    cloudRequired: false,
    ...overrides,
  };
}

function agentProgressResponse(snapshots: unknown[] = []) {
  return { cloudRequired: false, providerAccess: "direct", generatedAt: "2026-05-29T15:00:00Z", snapshots };
}

function agentProgressSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "2026-05-29",
    runId: "run-001",
    cardId: "T-277",
    startedAt: "2026-05-29T14:00:00Z",
    updatedAt: "2026-05-29T14:01:00Z",
    phase: "running_command",
    status: "healthy_running",
    message: "Running verification",
    elapsedMs: 61000,
    ageMs: 1000,
    currentTool: { kind: "test", label: "npm test", startedAt: "2026-05-29T14:00:30Z", elapsedMs: 30000 },
    stuckReason: "none",
    recentEvents: [
      { eventId: "event-001", timestamp: "2026-05-29T14:00:30Z", phase: "running_command", status: "healthy_running", message: "Started test command" },
    ],
    ...overrides,
  };
}

function mockStreamingReadyRuntime(options: { abortResponse?: Promise<Response> } = {}) {
  let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/chats/subscribe?chat_id=")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          sseController = controller;
        },
        cancel() {},
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    }
    if (url.endsWith("/v1/ping")) {
      return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
    }
    if (url.endsWith("/v1/caps")) {
      return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
    }
    if (url.endsWith("/v1/models")) {
      return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
    }
    if (url.endsWith("/v1/providers")) {
      return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
    }
    if (url.endsWith("/v1/provider-auth/openai/status")) {
      return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
    }
    if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
      if ((JSON.parse(String(init.body)) as { type?: string }).type === "abort" && options.abortResponse) {
        return options.abortResponse;
      }
      return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: JSON.parse(String(init.body)).type }));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { close: () => sseController?.close() };
}

function abortCommandCalls() {
  return fetchMock.mock.calls.filter(([url, init]) => {
    if (!String(url).includes("/v1/chats/") || !String(url).endsWith("/commands") || init?.method !== "POST") {
      return false;
    }
    return (JSON.parse(String(init.body)) as { type?: string }).type === "abort";
  });
}

function lastUserMessageBody() {
  const commandCalls = fetchMock.mock.calls.filter(([url, init]) => (String(url).endsWith("/v1/chats/chat-001/commands") || String(url).endsWith("/v1/chats/chat-002/commands")) && init?.method === "POST");
  for (let index = commandCalls.length - 1; index >= 0; index -= 1) {
    const commandCall = commandCalls[index];
    const body = JSON.parse(String(commandCall[1]?.body)) as { type?: string; payload?: Record<string, unknown> };
    if (body.type === "user_message") {
      return body;
    }
  }
  throw new Error("User message command not found");
}

function mockRuntimeResponse(input: RequestInfo | URL, init: RequestInit | undefined, options: MockRuntimeOptions = {}) {
  const url = String(input);
  if (url.endsWith("/v1/provider-auth/openai/status")) {
    if (options.authStatusCode) {
      return Promise.resolve(jsonResponse({ error: "raw-secret should not appear" }, options.authStatusCode));
    }
    return Promise.resolve(jsonResponse(options.authResponse ?? {
      provider: "openai",
      configured: false,
      status: options.authSupportsLogin ? "login_available" : "login_unavailable",
      authSource: "none",
      supportsLogin: options.authSupportsLogin ?? false,
      supportsApiKey: true,
      cloudRequired: false,
      message: options.authMessage ?? "Experimental account login (non-default) is not available for this local provider path. Create an API key in the provider console and paste it once into Yet AI.",
    }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/start")) {
    return Promise.resolve(jsonResponse({
      provider: "openai",
      configured: false,
      status: "pending",
      authSource: "oauth",
      supportsLogin: true,
      supportsApiKey: true,
      authorizationUrl: options.startAuthUrl ?? "https://auth.openai.com/oauth/authorize?state=test",
      sessionId: "provider-login-session-001",
      expiresAt: "2026-05-24T01:00:00Z",
      scopes: ["openid", "profile", "email", "offline_access"],
      cloudRequired: false,
      success: true,
      message: options.startAuthMessage ?? "Open the authorization URL to continue signing in.",
    }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/exchange")) {
    return Promise.resolve(jsonResponse(options.exchangeResponse ?? connectedExperimentalAuthResponse()));
  }
  if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/disconnect")) {
    return Promise.resolve(jsonResponse({ ...providerAuthResponse("not_configured"), success: true }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/providers")) {
    return Promise.resolve(jsonResponse(options.providerSaveResponse ?? {
      id: "openai-compatible-custom",
      kind: "openai-compatible",
      displayName: "OpenAI-Compatible Provider",
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      auth: { type: "api_key", configured: true, redacted: "sk-...test" },
      models: [readyModel({ displayName: "gpt-4o-mini" })],
      capabilities: { chat: true, completion: false, embeddings: false },
    }, options.providerSaveStatus ?? 200));
  }
  if (init?.method === "PATCH" && url.includes("/v1/providers/")) {
    return Promise.resolve(jsonResponse(options.providerSaveResponse ?? enabledProvider(), options.providerSaveStatus ?? 200));
  }
  if (init?.method === "POST" && url.includes("/v1/providers/") && url.endsWith("/test")) {
    return Promise.resolve(jsonResponse(options.providerTestResponse ?? {
      ok: true,
      providerId: "openai-api",
      status: "reachable",
      message: "Provider is reachable and accepted the configured credentials.",
      modelId: "gpt-4o-mini",
      cloudRequired: false,
    }, options.providerTestStatus ?? 200));
  }
  if (url.endsWith("/v1/chats") && init?.method === "POST") {
    return Promise.resolve(jsonResponse(options.createChatThread ?? chatThread("chat-new", "New local chat", [])));
  }
  if (url.endsWith("/v1/chats")) {
    return Promise.resolve(jsonResponse({ chats: options.chats ?? [] }));
  }
  if (url.endsWith("/v1/agent-progress")) {
    if (options.agentProgressStatus) {
      return Promise.resolve(jsonResponse({ error: options.agentProgressError ?? "agent progress unavailable" }, options.agentProgressStatus));
    }
    return Promise.resolve(jsonResponse(options.agentProgress ?? agentProgressResponse()));
  }
  const chatMatch = /\/v1\/chats\/([^/?]+)$/.exec(url);
  if (chatMatch && init?.method === "DELETE") {
    return Promise.resolve(jsonResponse({ deleted: true, chatId: decodeURIComponent(chatMatch[1]) }));
  }
  if (chatMatch) {
    const requestedChatId = decodeURIComponent(chatMatch[1]);
    return Promise.resolve(jsonResponse(options.chatThreads?.[requestedChatId] ?? chatThread(requestedChatId, requestedChatId, [])));
  }
  if (url.includes("/v1/chats/subscribe?chat_id=")) {
    return Promise.resolve(sseResponse(options.sseEvents ?? []));
  }
  if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
    if (options.commandResponse) {
      return options.commandResponse;
    }
    if (options.commandStatus) {
      return Promise.resolve(jsonResponse({ error: options.commandError ?? "command failed" }, options.commandStatus));
    }
    return Promise.resolve(jsonResponse({
      accepted: true,
      chatId: "chat-001",
      requestId: "request-001",
      type: "user_message",
    }));
  }
  if (url.endsWith("/v1/ping")) {
    if (options.runtimeFailure) {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8001"));
    }
    return Promise.resolve(jsonResponse(options.pingResponse ?? {
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
  }
  if (url.endsWith("/v1/caps")) {
    if (options.runtimeFailure) {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8001"));
    }
    return Promise.resolve(jsonResponse(options.capsResponse ?? {
      productId: "yet-ai",
      protocolVersion: "2026-05-15",
      runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
      capabilities: [],
      features: {},
      providers: [],
      ide: { bridge: true, lsp: false },
    }));
  }
  if (url.endsWith("/v1/models")) {
    if (options.modelsFailure) {
      return Promise.resolve(jsonResponse({ error: "models unavailable" }, 503));
    }
    return Promise.resolve(jsonResponse({ models: options.models ?? [] }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/demo-mode")) {
    return Promise.resolve(jsonResponse(options.demoModeSetResponse ?? demoModeResponse(JSON.parse(String(init.body)).enabled === true), options.demoModeSetStatus ?? 200));
  }
  if (url.endsWith("/v1/demo-mode")) {
    return Promise.resolve(jsonResponse(options.demoMode ?? demoModeResponse(false), options.demoModeStatus ?? 200));
  }
  if (url.endsWith("/v1/providers")) {
    return Promise.resolve(jsonResponse({ providers: options.providers ?? [], cloudRequired: false, providerAccess: "direct" }));
  }
  return Promise.resolve(jsonResponse({}));
}

function mockRuntimeResponses(options: MockRuntimeOptions = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => mockRuntimeResponse(input, init, options));
  vi.stubGlobal("fetch", fetchMock);
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function browserStorageDump() {
  const values: string[] = [];
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) {
        values.push(key, storage.getItem(key) ?? "");
      }
    }
  }
  return values.join("\n");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function findButton(name: string) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((item) => item.textContent === name);
  if (!button) {
    throw new Error(`Button not found: ${name}`);
  }
  return button;
}

function findConversationButton(label: RegExp) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button.conversation-select") ?? []).find((item) => label.test(item.getAttribute("aria-label") ?? ""));
  if (!button) {
    throw new Error(`Conversation button not found: ${label}`);
  }
  return button;
}

function expectConversationRowParts(title: string, expected: { updated: string; messages: string; position: string }) {
  const button = findConversationButton(new RegExp(`^(Open conversation|Current conversation): ${escapeRegExp(title)}`));
  const titleLine = button.querySelector<HTMLElement>(".conversation-title-line");
  const metaLine = button.querySelector<HTMLElement>(".conversation-meta-line");
  expect(titleLine?.querySelector(".conversation-title")?.textContent).toBe(title);
  expect(metaLine?.querySelector(".conversation-updated")?.textContent).toBe(expected.updated);
  expect(metaLine?.querySelector(".conversation-message-count")?.textContent).toBe(expected.messages);
  expect(metaLine?.querySelector(".conversation-position")?.textContent).toBe(expected.position);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buttonsNamed(name: string) {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter((item) => item.textContent === name);
}

function findDetails(id: string) {
  const details = container?.querySelector(`[data-testid='${id}']`);
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error(`Details not found: ${id}`);
  }
  return details;
}

function findInputValue(value: string) {
  return Array.from(container?.querySelectorAll<HTMLInputElement>("input") ?? []).find((input) => input.value === value);
}

function findSelectValue(value: string) {
  return Array.from(container?.querySelectorAll<HTMLSelectElement>("select") ?? []).find((select) => select.value === value);
}

function sessionTokenInput() {
  const input = runtimeSessionTokenInputOptional();
  if (!input) {
    throw new Error("Session token input not found");
  }
  return input;
}

function runtimeSessionTokenInputOptional() {
  return Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []).find((input) => input.placeholder === "Bearer token for local runtime");
}

function apiKeyInput() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []).find((item) => item.placeholder === "Provider API key, not the runtime Session token");
  if (!input) {
    throw new Error("API key input not found");
  }
  return input;
}

function authCodeInput() {
  const input = authCodeInputOptional();
  if (!input) {
    throw new Error("Authorization code input not found");
  }
  return input;
}

function authCodeInputOptional() {
  return Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []).find((item) => item.placeholder === "Paste authorization code");
}

function chatInput() {
  const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) {
    throw new Error("Chat textarea not found");
  }
  return textarea;
}

function chatLifecycleText() {
  const lifecycle = container?.querySelector<HTMLElement>(".chat-lifecycle-state");
  if (!lifecycle) {
    throw new Error("Chat lifecycle state not found");
  }
  return lifecycle.textContent ?? "";
}

function attachedContextToggle() {
  const input = attachedContextToggleOptional();
  if (!input) {
    throw new Error("Attached context toggle not found");
  }
  return input;
}

function attachedContextToggleOptional() {
  return Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []).find((item) => item.parentElement?.textContent?.includes("Attach to next message") || item.parentElement?.textContent?.includes("Do not attach"));
}

function attachedContextAcknowledgementToggle() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []).find((item) => item.parentElement?.textContent?.includes("I understand the hidden selected text may be included"));
  if (!input) {
    throw new Error("Attached context acknowledgement toggle not found");
  }
  return input;
}

function chatIdInput() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>("input") ?? []).find((item) => item.parentElement?.textContent?.includes("Chat id"));
  if (!input) {
    throw new Error("Chat id input not found");
  }
  return input;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
