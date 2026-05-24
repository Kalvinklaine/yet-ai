import { afterEach, describe, expect, it, vi } from "vitest";
import { authHeaders, productIdentityWarning, runtimeFetch, validateRuntimeBaseUrl } from "./runtimeClient";

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
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
});
