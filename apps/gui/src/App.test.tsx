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

    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
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
        message: `experimental pending ${rawCode}`,
        accountLabel: rawToken,
        scopes: ["openid", "access_token=" + "y".repeat(64)],
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("experimental pending [redacted]");
    expect(container?.textContent).not.toContain("code-secret-value");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("access_token");
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
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
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
    expect(JSON.stringify(localStorage)).not.toContain("sk-");
    expect(JSON.stringify(sessionStorage)).not.toContain("sk-");

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
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1:8001/"))).toBe(true);
  });
});

describe("host.ready runtime bootstrap", () => {
  it("updates runtime settings from host.ready without persisting the token", async () => {
    const token = "host-session-token-secret";
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          version: bridgeVersion,
          type: "host.ready",
          payload: {
            runtimeUrl: "http://127.0.0.1:8765",
            sessionToken: token,
            productId: "yet-ai",
            displayName: "Yet AI",
            cloudRequired: false,
          },
        },
      }));
    });

    const runtimeUrlInput = Array.from(container.querySelectorAll("input")).find((input) => input.value === "http://127.0.0.1:8765");
    const tokenInput = Array.from(container.querySelectorAll("input")).find((input) => input.value === token);
    expect(runtimeUrlInput).toBeDefined();
    expect(tokenInput).toBeDefined();
    expect(container.textContent).toContain("Host runtime settings received");
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
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
    expect(JSON.stringify(localStorage)).not.toContain("oauth");
    expect(JSON.stringify(sessionStorage)).not.toContain("oauth");
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
    expect(container?.textContent).toContain("failed Bearer [redacted]");
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
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(JSON.stringify(sessionStorage)).not.toContain(secret);
  });

  it("Stop SSE sends abort and clears the local subscription", async () => {
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
    expect(abortCall).toBeDefined();
    expect(container?.textContent).toContain("SSE stopped and abort requested");
  });
});

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
