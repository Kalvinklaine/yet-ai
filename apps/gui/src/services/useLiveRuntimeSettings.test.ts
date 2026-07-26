import { describe, expect, it } from "vitest";
import { resolveHostReadyRuntimeSettings, resolveWorkspaceBindingUpdate } from "./useLiveRuntimeSettings";

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

describe("useLiveRuntimeSettings workspace binding correlation", () => {
  const binding = (requestId: string) => ({
    type: "host.workspaceBinding" as const,
    requestId,
    payload: { protocolVersion: "workspace_binding_v1", requestId, state: "auto_bound", projectId: "prj_abcdefghijklmnopqrstuA", displayName: "Workspace" } as const,
  });

  it("accepts only the binding correlated to the latest host.ready", () => {
    expect(resolveWorkspaceBindingUpdate(null, binding("ready-1"))).toEqual({ requestId: null, binding: null, changed: false });
    expect(resolveWorkspaceBindingUpdate("ready-2", binding("ready-1"))).toEqual({ requestId: "ready-2", binding: null, changed: false });
    expect(resolveWorkspaceBindingUpdate("ready-2", binding("ready-2"))).toEqual({ requestId: "ready-2", binding: binding("ready-2").payload, changed: true });
  });

  it("invalidates the prior binding generation only when host.ready correlation changes", () => {
    expect(resolveWorkspaceBindingUpdate("ready-1", { type: "host.ready", requestId: "ready-1", payload: {} })).toEqual({ requestId: "ready-1", binding: null, changed: false });
    expect(resolveWorkspaceBindingUpdate("ready-1", { type: "host.ready", requestId: "ready-2", payload: {} })).toEqual({ requestId: "ready-2", binding: null, changed: true });
  });
});
