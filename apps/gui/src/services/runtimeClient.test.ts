import { afterEach, describe, expect, it, vi } from "vitest";
import { authHeaders, productIdentityWarning, runtimeFetch, validateRuntimeBaseUrl } from "./runtimeClient";

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runtimeClient", () => {
  it("sends authorization only for loopback runtime URLs", () => {
    expect(new Headers(authHeaders({ baseUrl: "http://127.0.0.1:8001", token: " secret " })).get("Authorization")).toBe("Bearer secret");
    expect(new Headers(authHeaders({ baseUrl: "https://localhost:8001", token: "secret" })).get("Authorization")).toBe("Bearer secret");
    expect(new Headers(authHeaders({ baseUrl: "http://example.com", token: "secret" })).get("Authorization")).toBeNull();
  });

  it("rejects non-loopback runtime URLs before fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const result = await runtimeFetch({ baseUrl: "https://example.com", token: "secret" }, "/v1/ping");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 401 to an unauthorized local runtime error", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runtimeFetch({ baseUrl: "http://localhost:8001", token: "bad" }, "/v1/ping");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe(401);
    expect(result.ok ? undefined : result.error.message).toContain("Unauthorized local runtime request");
  });

  it("validates loopback hosts", () => {
    expect(validateRuntimeBaseUrl("http://127.0.0.1:8001").ok).toBe(true);
    expect(validateRuntimeBaseUrl("http://localhost:8001").ok).toBe(true);
    expect(validateRuntimeBaseUrl("http://[::1]:8001").ok).toBe(true);
    expect(validateRuntimeBaseUrl("ftp://127.0.0.1:8001").ok).toBe(false);
    expect(validateRuntimeBaseUrl("http://192.168.0.2:8001").ok).toBe(false);
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

  it("does not let caller headers override runtime Authorization", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runtimeFetch({ baseUrl: "http://127.0.0.1:8001", token: "runtime-token" }, "/v1/ping", {
      headers: { Authorization: "Bearer caller-token", Accept: "text/plain" },
    });

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer runtime-token");
    expect(headers.get("Accept")).toBe("application/json");
  });
});
