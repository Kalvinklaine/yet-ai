// @vitest-environment jsdom
import React, { act, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRuntimeController } from "./useRuntimeController";
import type { RuntimeSettings } from "./runtimeClient";

let root: ReactDOM.Root | undefined;
const fetchMock = vi.fn();

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

type Controller = ReturnType<typeof useRuntimeController>;

function Probe({ settings, revision, onChange }: { settings: RuntimeSettings; revision: number; onChange: (controller: Controller) => void }) {
  const settingsRef = useRef(settings);
  const revisionRef = useRef(revision);
  const appendTraceRef = useRef(() => undefined);
  const addTimelineRef = useRef(() => undefined);
  const refreshChatsRef = useRef(async () => undefined);
  settingsRef.current = settings;
  revisionRef.current = revision;
  const controller = useRuntimeController({
    settingsRef,
    settingsRevisionRef: revisionRef,
    settingsRevision: revision,
    appendTraceRef,
    addTimelineRef,
    refreshChatsRef,
    providerTestAction: () => "",
  });
  useEffect(() => onChange(controller), [controller, onChange]);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function runtimeReply(url: string, identity = "yet-ai") {
  if (url.endsWith("/v1/ping")) return response({ productId: identity, displayName: identity === "yet-ai" ? "Yet AI" : "Other", version: "0", ready: true, serverTime: "now" });
  if (url.endsWith("/v1/caps")) return response({ productId: identity, protocolVersion: "1", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } });
  if (url.endsWith("/v1/models")) return response({ models: [{ id: url.includes("8765") ? "new" : "old", displayName: "Model" }] });
  if (url.endsWith("/v1/demo-mode")) return response({ enabled: false, providerId: "yet-demo", modelId: "yet-demo-chat", displayName: "Yet AI Demo Mode", cloudRequired: false, providerAccess: "direct", message: "off" });
  if (url.endsWith("/v1/providers")) return response({ providers: [], cloudRequired: false, providerAccess: "direct" });
  if (url.endsWith("/v1/provider-auth/openai/status")) return response({ provider: "openai", configured: false, status: "login_unavailable", authSource: "none", supportsLogin: true, supportsApiKey: true, cloudRequired: false });
  return response({});
}

async function mount(onChange: (controller: Controller) => void, settings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" as const }, revision = 0) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(<Probe settings={settings} revision={revision} onChange={onChange} />);
  });
  return container;
}

describe("useRuntimeController", () => {
  it("ignores stale runtime results after the settings generation changes", async () => {
    const oldPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") return oldPing.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    const onChange = (next: Controller) => { controller = next; };
    await mount(onChange);
    await act(async () => { void controller.connect(); await Promise.resolve(); });
    await act(async () => {
      root?.render(<Probe settings={{ baseUrl: "http://127.0.0.1:8765", token: "", runtimeAccess: "direct" }} revision={1} onChange={onChange} />);
      oldPing.resolve(runtimeReply("http://127.0.0.1:8001/v1/ping"));
      await Promise.resolve();
    });
    expect(controller.runtimeDataRevision).not.toBe(0);
    expect(controller.models).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "old" })]));
  });

  it("queues a refresh and uses the latest settings after the active refresh completes", async () => {
    const oldPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") return oldPing.promise;
      return Promise.resolve(runtimeReply(url));
    });
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    const onChange = (next: Controller) => { controller = next; };
    await mount(onChange);
    await act(async () => { void controller.connect(); await Promise.resolve(); });
    await act(async () => {
      root?.render(<Probe settings={{ baseUrl: "http://127.0.0.1:8765", token: "latest", runtimeAccess: "direct" }} revision={1} onChange={onChange} />);
      void controller.connect();
      oldPing.resolve(runtimeReply("http://127.0.0.1:8001/v1/ping"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("http://127.0.0.1:8765/") && new Headers(init?.headers).get("Authorization") === "Bearer latest")).toBe(true);
  });

  it("preserves identity mismatch warnings for the current generation only", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => Promise.resolve(runtimeReply(String(input), "other")));
    vi.stubGlobal("fetch", fetchMock);
    let controller!: Controller;
    await mount((next) => { controller = next; });
    await act(async () => { await controller.connect(); });
    expect(controller.identityWarnings).toHaveLength(2);
    expect(controller.identityWarnings.every((warning) => warning.includes("Runtime identity mismatch"))).toBe(true);
  });
});
