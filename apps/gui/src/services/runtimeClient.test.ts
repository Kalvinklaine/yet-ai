import { afterEach, describe, expect, it, vi } from "vitest";
import { createChat, deleteChat, getChat, listChats, authHeaders, isPanelScopedProxyBaseUrl, productIdentityWarning, runtimeFetch, sendUserMessage, validateRuntimeBaseUrl } from "./runtimeClient";

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runtimeClient", () => {
  it("sends authorization only for direct loopback runtime URLs", () => {
    const loopbackHeaders = new Headers(authHeaders({ baseUrl: "http://127.0.0.1:8001", token: " secret ", runtimeAccess: "direct" }));
    expect(loopbackHeaders.get("Authorization")).toBe("Bearer secret");
    expect(loopbackHeaders.get("X-Yet-AI-Caller")).toBe("gui_runtime_client");
    expect(new Headers(authHeaders({ baseUrl: "https://localhost:8001", token: "secret", runtimeAccess: "direct" })).get("Authorization")).toBe("Bearer secret");
    expect(new Headers(authHeaders({ baseUrl: "http://example.com", token: "secret", runtimeAccess: "direct" })).get("Authorization")).toBeNull();
    expect(new Headers(authHeaders({ baseUrl: "/panel/panel-123", token: "secret", runtimeAccess: "same_origin_proxy" })).get("Authorization")).toBeNull();
  });

  it("uses panel-scoped same-origin proxy paths without GUI Authorization", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(isPanelScopedProxyBaseUrl("/panel/panel-123")).toBe(true);
    expect(isPanelScopedProxyBaseUrl("/panel/panel-123/v1")).toBe(false);
    expect(new Headers(authHeaders({ baseUrl: "/panel/panel-123", token: "proxy-mode-token", runtimeAccess: "same_origin_proxy" })).get("Authorization")).toBeNull();

    const result = await runtimeFetch({ baseUrl: "/panel/panel-123", token: "proxy-mode-token", runtimeAccess: "same_origin_proxy" }, "/v1/ping");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/panel/panel-123/v1/ping", expect.objectContaining({
      headers: expect.any(Headers),
    }));
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Yet-AI-Caller")).toBe("gui_runtime_client");
  });

  it("rejects panel proxy paths in direct mode before fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const result = await runtimeFetch({ baseUrl: "/panel/panel-123", token: "runtime-token", runtimeAccess: "direct" }, "/v1/ping");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-loopback runtime URLs before fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const result = await runtimeFetch({ baseUrl: "https://example.com", token: "secret" }, "/v1/ping");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-root runtime URL paths before fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    for (const baseUrl of [
      "http://127.0.0.1:8001/foo",
      "http://127.0.0.1:8001/foo/..",
      "http://127.0.0.1:8001/foo/%2e%2e",
      "http://127.0.0.1:8001/%2e",
      "http://127.0.0.1:8001/%2e%2e",
      "http://127.0.0.1:8001/a/b/../..",
      "http://127.0.0.1:8001/foo/../bar",
      "http://127.0.0.1:8001/%2e%2e/foo",
    ]) {
      const result = await runtimeFetch({ baseUrl, token: "runtime-token" }, "/v1/ping");
      expect(result.ok).toBe(false);
      expect(result.ok ? undefined : result.error.status).toBe("configuration");
      expect(result.ok ? "" : result.error.message).toContain("must not include a path");
      expect(result.ok ? "" : result.error.message).not.toContain("runtime-token");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts root runtime URL paths before fetch", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runtimeFetch({ baseUrl: "http://127.0.0.1:8001/", token: "runtime-token" }, "/v1/ping");
    await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping");

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8001/v1/ping", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps 401 to an unauthorized local runtime error", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runtimeFetch({ baseUrl: "http://localhost:8001", token: "bad" }, "/v1/ping");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe(401);
    expect(result.ok ? undefined : result.error.message).toContain("Unauthorized local runtime request");
  });

  it("validates loopback hosts and root paths", () => {
    expect(validateRuntimeBaseUrl("http://127.0.0.1:8001").ok).toBe(true);
    expect(validateRuntimeBaseUrl("http://127.0.0.1:8001/").ok).toBe(true);
    expect(validateRuntimeBaseUrl("http://localhost:8001").ok).toBe(true);
    expect(validateRuntimeBaseUrl("http://[::1]:8001").ok).toBe(true);
    expect(validateRuntimeBaseUrl("ftp://127.0.0.1:8001").ok).toBe(false);
    expect(validateRuntimeBaseUrl("http://192.168.0.2:8001").ok).toBe(false);
    for (const baseUrl of [
      "http://127.0.0.1:8001/foo",
      "http://127.0.0.1:8001/foo/..",
      "http://127.0.0.1:8001/foo/%2e%2e",
      "http://127.0.0.1:8001/%2e",
      "http://127.0.0.1:8001/%2e%2e",
      "http://127.0.0.1:8001/a/b/../..",
      "http://127.0.0.1:8001/foo/../bar",
      "http://127.0.0.1:8001/%2e%2e/foo",
    ]) {
      const result = validateRuntimeBaseUrl(baseUrl);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error.message).toContain("must not include a path");
    }
  });

  it("does not echo invalid runtime path secret markers", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const result = await runtimeFetch({ baseUrl: "http://127.0.0.1:8001/path-secret-marker/..", token: "runtime-token" }, "/v1/ping");

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("configuration");
    expect(result.ok ? "" : result.error.message).toContain("must not include a path");
    expect(result.ok ? "" : result.error.message).not.toContain("path-secret-marker");
    expect(result.ok ? "" : result.error.message).not.toContain("runtime-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects runtime URLs with userinfo query or hash without echoing secrets", async () => {
    vi.stubGlobal("fetch", fetchMock);
    for (const baseUrl of [
      "http://user:secret@127.0.0.1:8001",
      "http://127.0.0.1:8001?token=secret",
      "http://127.0.0.1:8001#secret",
    ]) {
      const result = await runtimeFetch({ baseUrl, token: "runtime-token" }, "/v1/ping");
      expect(result.ok).toBe(false);
      expect(result.ok ? undefined : result.error.status).toBe("configuration");
      expect(result.ok ? "" : result.error.message).toContain("must not include credentials");
      expect(result.ok ? "" : result.error.message).not.toContain("secret");
      expect(result.ok ? "" : result.error.message).not.toContain("runtime-token");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("warns on runtime product identity mismatch", () => {
    expect(productIdentityWarning({ productId: "yet-ai", displayName: "Yet AI" })).toBeNull();
    expect(productIdentityWarning({ productId: "other", displayName: "Other" })).toContain("Runtime identity mismatch");
  });

  it("times out hung runtime fetches with a safe error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token-secret" }, "/v1/ping");
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("timeout");
    expect(result.ok ? undefined : result.error.message).toBe("Runtime request timed out.");
    expect(result.ok ? "" : result.error.message).not.toContain("runtime-token-secret");
  });

  it("preserves caller abort signal without reporting timeout", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("AbortError Bearer caller-secret-token")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping", { signal: controller.signal });
    controller.abort();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("network");
    expect(result.ok ? undefined : result.error.message).toContain("AbortError");
    expect(result.ok ? "" : result.error.message).not.toContain("Bearer");
    expect(result.ok ? "" : result.error.message).not.toContain("caller-secret-token");
  });

  it("sanitizes and truncates HTTP error bodies", async () => {
    const longToken = "a".repeat(64);
    const body = {
      error: `failure Bearer bearer-secret-value sk-testabcdefghijklmnopqrstuvwxyz access_token=${longToken} refresh_token=${longToken} cookie=session verifier=${longToken} auth.json ${"z".repeat(700)}`,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping");

    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.error.message;
    expect(message).toContain("failure [redacted]");
    expect(message.length).toBeLessThanOrEqual(501);
    expect(message).not.toContain("Bearer");
    expect(message).not.toContain("sk-test");
    expect(message).not.toContain("access_token");
    expect(message).not.toContain("refresh_token");
    expect(message).not.toContain("cookie=session");
    expect(message).not.toContain("verifier");
    expect(message).not.toContain("auth.json");
    expect(message).not.toContain(longToken);
  });

  it("sanitizes JSON-style secret fields and JWT-like values in HTTP errors", async () => {
    const jwt = `${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
    const body = {
      error: `provider rejected {"access_token":"short-secret","refresh_token": "${jwt}","client_secret":"tiny","cookie":"sid=abc"}`,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping");

    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.error.message;
    expect(message).toContain("provider rejected");
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("access_token");
    expect(message).not.toContain("refresh_token");
    expect(message).not.toContain("client_secret");
    expect(message).not.toContain("cookie");
    expect(message).not.toContain("short-secret");
    expect(message).not.toContain("tiny");
    expect(message).not.toContain("sid=abc");
    expect(message).not.toContain(jwt);
  });

  it("uses shared redaction coverage for runtime HTTP errors", async () => {
    const body = {
      error: [
        "setCookie=sid=secret; refresh=also-secret",
        "set_cookie=sid=secret; Path=/; auth_token=also-secret",
        "session_token=runtime-secret",
        "OPENAI_API_KEY=provider-secret",
        "YET_AI_AUTH_TOKEN=yet-secret",
        "?api_key=query-secret",
        "C:\\Users\\Alice Smith\\.codex\\auth.json",
        "/Users/Alice Smith/.codex/auth.json",
        "../.codex/auth.json",
      ].join(" "),
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping");

    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.error.message;
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("setCookie");
    expect(message).not.toContain("set_cookie");
    expect(message).not.toContain("sid=secret");
    expect(message).not.toContain("also-secret");
    expect(message).not.toContain("session_token");
    expect(message).not.toContain("runtime-secret");
    expect(message).not.toContain("OPENAI_API_KEY");
    expect(message).not.toContain("provider-secret");
    expect(message).not.toContain("YET_AI_AUTH_TOKEN");
    expect(message).not.toContain("yet-secret");
    expect(message).not.toContain("api_key");
    expect(message).not.toContain("query-secret");
    expect(message).not.toContain("Alice Smith");
    expect(message).not.toContain("auth.json");
  });

  it("sanitizes network and parse errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error(`network failed access_token=${"a".repeat(64)} .codex/auth.json`));
    vi.stubGlobal("fetch", fetchMock);
    const network = await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping");
    expect(network.ok ? "" : network.error.message).not.toContain("access_token");
    expect(network.ok ? "" : network.error.message).not.toContain("auth.json");

    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    const parsed = await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping");
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? undefined : parsed.error.status).toBe("parse");
  });

  it("calls engine-owned chat history endpoints", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ chats: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await listChats({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" });
    await createChat({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" });
    await getChat({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "chat-001");
    await deleteChat({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "chat-001");

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8001/v1/chats");
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8001/v1/chats", expect.objectContaining({ method: "POST", body: JSON.stringify({}) }));
    expect(fetchMock.mock.calls[2][0]).toBe("http://127.0.0.1:8001/v1/chats/chat-001");
    expect(fetchMock.mock.calls[2][1].method).toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(4, "http://127.0.0.1:8001/v1/chats/chat-001", expect.objectContaining({ method: "DELETE" }));
  });

  it("sends user message commands without context by default", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: true, chatId: "chat-001", requestId: "request-001", type: "user_message" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");

    await sendUserMessage({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "chat-001", "hello");

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8001/v1/chats/chat-001/commands", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000001", type: "user_message", payload: { content: "hello" } }),
    }));
  });

  it("sends user message commands with optional active editor context", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: true, chatId: "chat-001", requestId: "request-001", type: "user_message" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000002");
    const context = {
      kind: "active_editor" as const,
      source: "vscode" as const,
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 2, startCharacter: 1, endLine: 3, endCharacter: 4, text: "selected code" },
    };

    await sendUserMessage({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "chat-001", "hello", context);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(body).toEqual({ requestId: "00000000-0000-4000-8000-000000000002", type: "user_message", payload: { content: "hello", context } });
    expect(body).not.toHaveProperty("providerId");
    expect(body).not.toHaveProperty("modelId");
  });

  it("has no runtime lifecycle endpoint or launch authority", () => {
    expect(Object.keys({ createChat, deleteChat, getChat, listChats, runtimeFetch, sendUserMessage }).join(" ")).not.toContain("launch");
    expect(Object.keys({ createChat, deleteChat, getChat, listChats, runtimeFetch, sendUserMessage }).join(" ")).not.toContain("restart");
  });

  it("does not let caller headers override runtime Authorization", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping", {
      headers: { Authorization: "Bearer caller-token", Accept: "text/plain", "X-Yet-AI-Caller": "evil" },
    });

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer runtime-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Yet-AI-Caller")).toBe("gui_runtime_client");
  });
});
