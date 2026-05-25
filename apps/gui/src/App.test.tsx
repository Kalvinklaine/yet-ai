import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App";
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

    expect(container?.textContent).toContain("Model: GPT-4o mini (openai-api)");
    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockClear();
    mockRuntimeResponses({ providers: [enabledProvider()], modelsFailure: true });

    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Runtime check failed: 503 models unavailable");
    expect(container?.textContent).toContain("Models refresh failed: 503: models unavailable");
    expect(container?.textContent).toContain("Model: No model available");
    expect(container?.textContent).toContain("Runtime model refresh failed. Refresh runtime again before sending the first GPT message.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders Session token guidance and does not persist a manually entered token", async () => {
    const runtimeToken = "local-dev-token-secret";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("normally provided by the IDE host through host.ready");
    expect(container?.textContent).toContain("YET_AI_AUTH_TOKEN");
    expect(container?.textContent).toContain("not an OpenAI key or provider API key");

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
    const hostToken = "queued-host-token-secret";
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
          return Promise.resolve(jsonResponse({ models: [{ id: "gpt-b", displayName: "GPT B", providerId: "runtime-b" }] }));
        }
        if (url.endsWith("/v1/providers")) {
          return Promise.resolve(jsonResponse({ providers: [{ ...enabledProvider(), id: "runtime-b", displayName: "Runtime B", models: [{ id: "gpt-b", displayName: "GPT B" }] }], cloudRequired: false, providerAccess: "direct" }));
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

    expect(container?.textContent).toContain("Model: Runtime unavailable");
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

    expect(container?.textContent).toContain("Model: GPT B (runtime-b)");
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
        return Promise.resolve(jsonResponse({ models: url.startsWith("http://127.0.0.1:8001/") ? [{ id: "old-model", displayName: "Old Model", providerId: "old-runtime" }] : [{ id: "new-model", displayName: "New Model", providerId: "new-runtime" }] }));
      }
      if (url.endsWith("/v1/providers")) {
        const isOld = url.startsWith("http://127.0.0.1:8001/");
        return Promise.resolve(jsonResponse({ providers: [{ ...enabledProvider(), id: isOld ? "old-runtime" : "new-runtime", displayName: isOld ? "Old Runtime" : "New Runtime", models: [{ id: isOld ? "old-model" : "new-model", displayName: isOld ? "Old Model" : "New Model" }] }], cloudRequired: false, providerAccess: "direct" }));
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

    expect(container?.textContent).toContain("Model: New Model (new-runtime)");
    expect(container?.textContent).not.toContain("Model: Old Model (old-runtime)");
  });
});

describe("provider secret boundary", () => {
  it("renders OpenAI login unavailable with API key fallback", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI account login");
    expect(container?.textContent).toContain("OpenAI account login is planned/not available yet; use API key fallback.");
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

  it("does not open invalid provider auth URLs", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    mockRuntimeResponses({ authSupportsLogin: true, startAuthUrl: "file:///tmp/provider-token" });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Login with OpenAI").click();
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
      findButton("Experimental Login with OpenAI account").click();
    });

    const startCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/start") && init?.method === "POST");
    expect(startCall?.[1]?.body).toBe(JSON.stringify({ experimentalCodexLike: true }));
    expect(openMock).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize?state=codex-test", "_blank", "noopener,noreferrer");
    expect(container?.textContent).toContain("experimental and high-risk");
    expect(container?.textContent).toContain("Session: provider-login-session-001");
    expect(container?.textContent).toContain("Expires: 2026-05-24T01:00:00Z");
    expect(container?.textContent).toContain("Scopes: openid, profile, email, offline_access");
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
      findButton("Login with OpenAI").click();
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

    expect(container?.textContent).toContain("OpenAI account login is connected through the local runtime.");
    expect(container?.textContent).toContain("Account: user@example.test");
    expect(container?.textContent).not.toContain("manual-code-789");
    expect(container?.textContent).not.toContain("access_token");
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
      findButton("Login with OpenAI").click();
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
    ["login_unavailable", "OpenAI account login is planned/not available yet; use API key fallback."],
    ["api_key_configured", "OpenAI API key fallback is configured locally. Account login is not required."],
    ["pending", "OpenAI account login is pending. Finish the browser or device verification flow, then refresh the status."],
    ["connected", "OpenAI account login is connected through the local runtime."],
    ["expired", "OpenAI account login expired. Start login again or use the API key fallback."],
    ["revoked", "OpenAI account login was revoked. Disconnect it or use the API key fallback."],
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

    expect(container?.textContent).toContain("Last error: provider failed [redacted]");
    expect(container?.textContent).not.toContain("Bearer");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("api_key");
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
      findButton("OpenAI API").click();
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

  it("submit clears preset API key input and keeps secrets out of browser storage", async () => {
    const secret = "sk-test-preset-secret";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await act(async () => {
      findButton("OpenAI API").click();
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
        return Promise.resolve(jsonResponse({ models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }] }));
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
        models: [{ id: "model-1", displayName: `Model refresh_token=${"r".repeat(64)}` }],
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

  it("renders sanitized provider test failures and keeps browser storage secret-free", async () => {
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
    expect(container?.textContent).not.toContain(secret);
    expect(container?.textContent).not.toContain("session-secret");
    expect(browserStorageDump()).not.toContain(secret);
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

describe("host.ready runtime bootstrap", () => {
  it("updates runtime settings from host.ready without persisting the token", async () => {
    const token = "host-session-token-secret";
    mockRuntimeResponses();
    renderApp();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });

    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(sessionTokenInput().value).toBe(token);
    expect(container?.textContent).toContain("Host runtime settings received");
    expect(browserStorageDump()).not.toContain(token);
  });

  it("keeps an existing token when URL-only host.ready repeats the same runtime URL", async () => {
    const token = "same-url-token-secret";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });

    expect(findInputValue("http://127.0.0.1:8001")).toBeDefined();
    expect(sessionTokenInput().value).toBe(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("clears an existing token when URL-only host.ready changes runtime URL", async () => {
    const token = "retarget-token-secret";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765" });
    await flushAsync();

    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(sessionTokenInput().value).toBe("");
    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => !new Headers(init?.headers).get("Authorization")?.includes(token))).toBe(true);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("ignores invalid non-loopback URL-only host.ready", async () => {
    const token = "invalid-host-token-secret";
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

  it("treats empty host.ready sessionToken as an explicit token clear", async () => {
    const token = "empty-token-clear-secret";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001", sessionToken: "" });

    expect(sessionTokenInput().value).toBe("");
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

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: "new-host-ready-token" });
    await flushAsync();

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(new Headers(abortCalls[0][1]?.headers).get("Authorization")).toBe("Bearer old-host-ready-token");
    expect(abortCalls.some(([url]) => String(url).startsWith("http://127.0.0.1:8765/"))).toBe(false);
    stream.close();
  });
});

describe("chat panel", () => {
  it("shows provider/model CTA and disables send when no model is ready", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Chat readiness");
    expect(container?.textContent).toContain("0 enabled providers");
    expect(container?.textContent).toContain("Model: No model available");
    expect(container?.textContent).toContain("Configure an enabled OpenAI API key fallback provider with a model before sending the first GPT message.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("enables chat readiness from connected experimental OpenAI OAuth when no provider model is ready", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("0 enabled providers");
    expect(container?.textContent).toContain("Model: Experimental OpenAI account / gpt-5-codex");
    expect(container?.textContent).toContain("Experimental Codex-like OpenAI account chat is connected through the local runtime.");
    expect(container?.textContent).toContain("private-endpoint path is high-risk");
    expect(container?.textContent).toContain("OpenAI API-key fallback remains the safe/default setup");
    expect(findButton("Send").disabled).toBe(false);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it("keeps API-key provider readiness preferred over connected experimental OAuth", async () => {
    mockRuntimeResponses({
      authResponse: providerAuthResponse("connected"),
      providers: [enabledProvider()],
      models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("Model: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini.");
    expect(container?.textContent).not.toContain("Model: Experimental OpenAI account / gpt-5-codex");
    expect(findButton("Send").disabled).toBe(false);
  });

  it.each(["pending", "expired", "revoked", "error"] satisfies ProviderAuthStatus[])("does not enable Send for %s OAuth status", async (status) => {
    mockRuntimeResponses({ authResponse: providerAuthResponse(status) });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model: No model available");
    expect(container?.textContent).toContain("Configure an enabled OpenAI API key fallback provider with a model before sending the first GPT message.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("shows configured provider and first runtime model readiness", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("Model: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini.");
    expect(findButton("Send").disabled).toBe(false);
  });


  it("disables Send when provider and model data exists but runtime connectivity fails", async () => {
    mockRuntimeResponses({
      runtimeFailure: true,
      providers: [enabledProvider()],
      models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("runtime error");
    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("Model: Runtime unavailable");
    expect(container?.textContent).toContain("Runtime is not connected. Refresh runtime and fix the local runtime problem before sending the first GPT message.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("disables experimental OAuth Send when runtime connectivity fails", async () => {
    mockRuntimeResponses({ runtimeFailure: true, authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model: Runtime unavailable");
    expect(container?.textContent).toContain("Runtime is not connected. Refresh runtime and fix the local runtime problem before sending the first GPT message.");
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

    expect(container?.textContent).toContain("Chat is not ready for the current runtime settings. Refresh runtime and configure a provider before sending.");
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
    expect(container?.textContent).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
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
    expect(container?.textContent).toContain("Ask a question to start this local chat.");
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

  it("Stop SSE with no active stream sends no abort", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Stop SSE").click();
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

  it("Stop SSE during active streaming sends abort and removes streaming indicator", async () => {
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
        return Promise.resolve(jsonResponse({ models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }] }));
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

    await act(async () => {
      findButton("Stop SSE").click();
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
        return Promise.resolve(jsonResponse({ models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }] }));
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
        return Promise.resolve(jsonResponse({ models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }] }));
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

function renderApp() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<App />);
  });
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
  commandStatus?: number;
  commandError?: string;
  providers?: unknown[];
  models?: unknown[];
  modelsFailure?: boolean;
  runtimeFailure?: boolean;
  pingResponse?: unknown;
  capsResponse?: unknown;
  providerTestResponse?: unknown;
  providerTestStatus?: number;
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
    redacted: status === "api_key_configured" ? "sk-...test" : undefined,
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

function enabledProvider() {
  return {
    id: "openai-api",
    kind: "openai-compatible",
    displayName: "OpenAI API",
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "api_key", configured: true, redacted: "sk-...test" },
    models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini" }],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function readyRuntimeOptions(): Pick<MockRuntimeOptions, "providers" | "models"> {
  return {
    providers: [enabledProvider()],
    models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }],
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
      return Promise.resolve(jsonResponse({ models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }] }));
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

function mockRuntimeResponses(options: MockRuntimeOptions = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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
        message: options.authMessage ?? "OpenAI account login is not available for this local provider path. Create an API key in the provider console and paste it once into Yet AI.",
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
    if (init?.method === "POST" && url.endsWith("/v1/providers")) {
      return Promise.resolve(jsonResponse({
        id: "openai-compatible-custom",
        kind: "openai-compatible",
        displayName: "OpenAI-Compatible Provider",
        enabled: true,
        baseUrl: "https://api.openai.com/v1",
        auth: { type: "api_key", configured: true, redacted: "sk-...test" },
        models: [{ id: "gpt-4o-mini", displayName: "gpt-4o-mini" }],
        capabilities: { chat: true, completion: false, embeddings: false },
      }));
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
    if (url.includes("/v1/chats/subscribe?chat_id=")) {
      return Promise.resolve(sseResponse(options.sseEvents ?? []));
    }
    if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
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
    if (url.endsWith("/v1/providers")) {
      return Promise.resolve(jsonResponse({ providers: options.providers ?? [], cloudRequired: false, providerAccess: "direct" }));
    }
    return Promise.resolve(jsonResponse({}));
  });
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

function findInputValue(value: string) {
  return Array.from(container?.querySelectorAll<HTMLInputElement>("input") ?? []).find((input) => input.value === value);
}

function findSelectValue(value: string) {
  return Array.from(container?.querySelectorAll<HTMLSelectElement>("select") ?? []).find((select) => select.value === value);
}

function sessionTokenInput() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? [])[0];
  if (!input) {
    throw new Error("Session token input not found");
  }
  return input;
}

function apiKeyInput() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? [])[1];
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
