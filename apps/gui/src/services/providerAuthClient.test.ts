import { afterEach, describe, expect, it, vi } from "vitest";
import { getProviderAuthStatus } from "./providerAuthClient";

const settings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" as const };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("providerAuthClient public projection", () => {
  it("normalizes legacy status and preserves browser polling metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: "openai",
      configured: false,
      status: "exchange_failed",
      authSource: "oauth",
      supportsLogin: true,
      supportsApiKey: true,
      cloudRequired: false,
      authorizationUrl: "https://auth.example.test/authorize",
      verificationUrl: "https://device.example.test/activate",
      sessionId: "session-001",
      expiresAt: "2026-07-18T18:00:00Z",
      pollIntervalSeconds: 1,
    }), { status: 200 })));

    const result = await getProviderAuthStatus(settings, "openai");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("error");
      expect(result.data).not.toHaveProperty("verificationUrl");
      expect(result.data.pollIntervalSeconds).toBe(1);
    }
  });

  it.each(["device", "browser"])("rejects non-public %s auth sources", async (authSource) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: "openai",
      configured: false,
      status: "pending",
      authSource,
      supportsLogin: true,
      supportsApiKey: true,
      cloudRequired: false,
      sessionId: "session-001",
      expiresAt: "2026-07-18T18:00:00Z",
    }), { status: 200 })));

    const result = await getProviderAuthStatus(settings, "openai");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe("protocol");
      expect(result.error.message).toBe("Provider auth response used an unsupported auth source.");
    }
  });
});
