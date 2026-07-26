// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceBindingPayload } from "../bridge/bridgeAdapter";
import { resolveHostReadyRuntimeSettings, resolveWorkspaceBindingUpdate, useLiveRuntimeSettings } from "./useLiveRuntimeSettings";
import type { RuntimeSettings } from "./runtimeClient";

const direct = { baseUrl: "http://127.0.0.1:8001", token: "old-token", runtimeAccess: "direct" as const };
let root: ReactDOM.Root | undefined;

type HookState = {
  settings: RuntimeSettings;
  workspaceBinding: WorkspaceBindingPayload | null;
  hostReadyGeneration: string | null;
};

function HookProbe({ onChange }: { onChange: (state: HookState) => void }) {
  const state = useLiveRuntimeSettings();
  useEffect(() => { onChange(state); }, [onChange, state.settings, state.workspaceBinding, state.hostReadyGeneration]);
  return null;
}

async function send(message: object) {
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: message })));
}

function ready(requestId: string | undefined, payload: object = { runtimeUrl: "http://127.0.0.1:9123", sessionToken: "trusted" }) {
  return { version: "2026-05-15", type: "host.ready", ...(requestId === undefined ? {} : { requestId }), payload };
}

function binding(requestId: string) {
  return {
    version: "2026-05-15",
    type: "host.workspaceBinding",
    requestId,
    payload: { protocolVersion: "workspace_binding_v1", requestId, state: "auto_bound", projectId: "prj_abcdefghijklmnopqrstuA", displayName: "Workspace" },
  };
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete window.__yetAiInitialRuntimeConfig;
});

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

describe("useLiveRuntimeSettings accepted host.ready generation", () => {
  it("keeps established trusted state through missing-correlation and rejected ready messages", async () => {
    const states: HookState[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(React.createElement(HookProbe, { onChange: (state) => states.push(state) }));
    });

    await send(ready("ready-1", { runtimeProxyBaseUrl: "/panel/panel-trusted" }));
    await send(binding("ready-1"));
    const established = states[states.length - 1]!;
    expect(established.hostReadyGeneration).toBe("ready-1");
    expect(established.workspaceBinding?.state).toBe("auto_bound");
    expect(established.settings.baseUrl).toBe("/panel/panel-trusted");

    await send(ready(undefined, { runtimeProxyBaseUrl: "/panel/panel-uncorrelated" }));
    await send(ready("ready-2", { runtimeUrl: "http://127.0.0.1:9333", sessionToken: "rejected-downgrade" }));

    expect(states[states.length - 1]).toBe(established);
  });

  it("preserves binding for an accepted same-ID retry and clears it for a new accepted generation", async () => {
    const states: HookState[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(React.createElement(HookProbe, { onChange: (state) => states.push(state) }));
    });

    await send(ready("ready-1"));
    await send(binding("ready-1"));
    await send(ready("ready-1"));
    expect(states[states.length - 1]?.hostReadyGeneration).toBe("ready-1");
    expect(states[states.length - 1]?.workspaceBinding?.state).toBe("auto_bound");

    await send(ready("ready-2", { runtimeProxyBaseUrl: "/panel/panel-next" }));
    expect(states[states.length - 1]).toMatchObject({
      settings: { baseUrl: "/panel/panel-next", token: "", runtimeAccess: "same_origin_proxy" },
      workspaceBinding: null,
      hostReadyGeneration: "ready-2",
    });
    await send(binding("ready-1"));
    expect(states[states.length - 1]?.workspaceBinding).toBeNull();
  });
});
