import { describe, expect, it } from "vitest";
import { resolveHostReadyRuntimeSettings } from "./useLiveRuntimeSettings";

const direct = { baseUrl: "http://127.0.0.1:8001", token: "old-token", runtimeAccess: "direct" as const };

describe("useLiveRuntimeSettings host.ready handoff", () => {
  it("prefers a valid same-origin proxy and clears direct credentials", () => {
    expect(resolveHostReadyRuntimeSettings(direct, {
      runtimeUrl: "http://127.0.0.1:9123",
      runtimeProxyBaseUrl: "/panel/panel-next",
      sessionToken: "server-side-only",
    })).toEqual({ baseUrl: "/panel/panel-next", token: "", runtimeAccess: "same_origin_proxy" });
  });

  it("accepts only loopback direct settings and preserves a same-url token", () => {
    expect(resolveHostReadyRuntimeSettings(direct, { runtimeUrl: "http://127.0.0.1:8001" })).toEqual(direct);
    expect(resolveHostReadyRuntimeSettings(direct, { runtimeUrl: "http://127.0.0.1:9123", sessionToken: "new-token" })).toEqual({ baseUrl: "http://127.0.0.1:9123", token: "new-token", runtimeAccess: "direct" });
    expect(resolveHostReadyRuntimeSettings(direct, { runtimeUrl: "https://runtime.example" })).toBeNull();
  });

  it("ignores malformed proxy payloads and stale direct downgrades", () => {
    const proxy = { baseUrl: "/panel/panel-current", token: "", runtimeAccess: "same_origin_proxy" as const };
    expect(resolveHostReadyRuntimeSettings(proxy, { runtimeProxyBaseUrl: "/panel", runtimeUrl: "http://127.0.0.1:9123" })).toBeNull();
    expect(resolveHostReadyRuntimeSettings(proxy, { runtimeUrl: "http://127.0.0.1:9123", sessionToken: "stale-token" })).toBeNull();
  });
});
