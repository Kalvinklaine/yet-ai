// @vitest-environment jsdom
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceBindingPayload } from "../bridge/bridgeAdapter";
import { consumeProjectChatLaunchIntent } from "../services/projectChatLaunchIntent";
import { CurrentWorkspaceDashboard, type HostedAuthorityToken } from "./CurrentWorkspaceDashboard";

const projectId = "prj_abcdefghijklmnopqrstuA";
const settings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" as const };
const authorityToken = "authority-1" as HostedAuthorityToken;
let root: ReactDOM.Root | undefined;
let container: HTMLDivElement | undefined;

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
}

function project(displayName = "Cozy Project") {
  return { projectId, displayName, status: "available", revision: "1", createdAt: "2026-07-20T10:00:00Z", lastOpenedAt: "2026-07-26T10:00:00Z", rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
}

const readyModel = { id: "demo", displayName: "Demo", providerId: "demo", readiness: { status: "ready" }, capabilities: { chat: true, streaming: true, tools: false, reasoning: false } };
const readyProvider = { id: "demo", kind: "demo-local", displayName: "Demo", enabled: true, baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [{ ...readyModel, providerId: undefined }], capabilities: { chat: true, completion: false, embeddings: false } };

function installFetch(options: { chats?: unknown[]; failAgent?: boolean; projects?: unknown[]; memory?: unknown[]; models?: unknown[]; providers?: unknown[] } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/ping")) return response({ ready: true });
    if (url.endsWith("/v1/models")) return response({ models: options.models ?? [readyModel] });
    if (url.endsWith("/v1/providers")) return response({ providers: options.providers ?? [readyProvider], cloudRequired: false, providerAccess: "direct" });
    if (url.endsWith(`/v1/projects/${projectId}`)) return response(project());
    if (url.endsWith(`/p/${projectId}/v1/agent-progress`)) return options.failAgent ? response({ error: "private data omitted" }, 503) : response({ snapshots: [], cloudRequired: false, providerAccess: "direct" });
    if (url.endsWith(`/p/${projectId}/v1/project-memory`)) return response({ notes: options.memory ?? [], cloudRequired: false, providerAccess: "direct" });
    if (url.endsWith(`/p/${projectId}/v1/chats`) && init?.method === "POST") return response({ chatId: "chat-new", title: "New chat", createdAt: "2026-07-26T12:00:00Z", updatedAt: "2026-07-26T12:00:00Z", messages: [] });
    if (url.endsWith(`/p/${projectId}/v1/chats`)) return response({ chats: options.chats ?? [] });
    if (url.endsWith("/v1/projects")) return response({ projects: options.projects ?? [project()], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" });
    return response({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderDashboard(binding: WorkspaceBindingPayload | null, onOpen = vi.fn(() => true), hostReadyGeneration?: string | null, getAuthorityToken = vi.fn(() => authorityToken as HostedAuthorityToken | null)) {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = ReactDOM.createRoot(container!);
    root.render(<CurrentWorkspaceDashboard settings={settings} binding={binding} hostReadyGeneration={hostReadyGeneration} getAuthorityToken={getAuthorityToken} onOpen={onOpen} />);
  });
  return onOpen;
}

async function flush() {
  await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function binding(state: "auto_bound" | "selection_required"): WorkspaceBindingPayload {
  return state === "auto_bound"
    ? { protocolVersion: "workspace_binding_v1", requestId: "bind-1", state, projectId, displayName: "Cozy Project" }
    : { protocolVersion: "workspace_binding_v1", requestId: "bind-2", state, reason: "multiple_roots" };
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("CurrentWorkspaceDashboard", () => {
  it("makes no hosted requests before trusted readiness and binding", async () => {
    const fetchMock = installFetch();
    await renderDashboard(null, vi.fn(), null);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Waiting for the trusted IDE workspace binding.");
  });

  it("keeps a valid ready generation inert until its binding arrives", async () => {
    const fetchMock = installFetch();
    await renderDashboard(null, vi.fn(), "ready-1");
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses only delivered trusted settings after the correlated binding", async () => {
    const fetchMock = installFetch();
    const trustedSettings = { baseUrl: "/panel/panel-trusted", token: "", runtimeAccess: "same_origin_proxy" as const };
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container!);
      root.render(<CurrentWorkspaceDashboard settings={trustedSettings} binding={binding("auto_bound")} hostReadyGeneration="ready-1" getAuthorityToken={() => authorityToken} onOpen={vi.fn()} />);
    });
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/panel/panel-trusted/"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("127.0.0.1:8001"))).toBe(false);
  });

  it("aborts old generation requests and hides stale dashboard data", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container!);
      root.render(<CurrentWorkspaceDashboard settings={{ ...settings, baseUrl: "http://127.0.0.1:9123" }} binding={binding("auto_bound")} hostReadyGeneration="ready-1" getAuthorityToken={() => authorityToken} onOpen={vi.fn()} />);
    });
    expect(fetchMock).toHaveBeenCalled();

    await act(async () => {
      root?.render(<CurrentWorkspaceDashboard settings={settings} binding={null} hostReadyGeneration={null} getAuthorityToken={() => null} onOpen={vi.fn()} />);
    });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(container?.textContent).toContain("Waiting for the trusted IDE workspace binding.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("127.0.0.1:8001"))).toBe(false);
  });

  it("loads bound sections independently without creating or subscribing to chat", async () => {
    const fetchMock = installFetch({ failAgent: true });
    const onOpen = await renderDashboard(binding("auto_bound"));
    expect(onOpen).not.toHaveBeenCalled();
    await flush();

    expect(container?.textContent).toContain("Cozy Project");
    expect(container?.textContent).toContain("Local runtimeReady");
    expect(container?.textContent).toContain("No recent conversations.");
    expect(container?.textContent).toContain("Agent progress could not be loaded.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chats/subscribe"))).toBe(false);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("selects a safe existing project for the UI session", async () => {
    installFetch();
    await renderDashboard(binding("selection_required"));
    await flush();

    expect(container?.textContent).toContain("Select a project for this session");
    const button = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Cozy Project");
    act(() => button?.click());
    await flush();

    expect(container?.textContent).toContain("No recent conversations.");
  });

  it("filters non-canonical, unavailable, and unsafe project summaries", async () => {
    installFetch({ projects: [
      project("Safe Project"),
      { ...project("Bad identifier"), projectId: "prj_invalid" },
      { ...project("Archived Project"), status: "archived" },
      { ...project("Missing Root"), rootAvailable: false },
      { ...project("/Users/private/workspace"), projectId: "prj_bcdefghijklmnopqrstuvQ" },
      { ...project("token secret"), projectId: "prj_cdefghijklmnopqrstuvw" },
    ] });
    await renderDashboard(binding("selection_required"));
    await flush();

    const choices = Array.from(container?.querySelectorAll(".workspace-project-choices button") ?? []).map((item) => item.textContent);
    expect(choices).toEqual(["Safe Project"]);
    expect(container?.textContent).not.toContain("/Users/private/workspace");
    expect(container?.textContent).not.toContain("token secret");
  });

  it("passes explicit selection authority for selection-required Start and Resume", async () => {
    const fetchMock = installFetch({ chats: [{ chatId: "chat-latest", title: "Latest", createdAt: "2026-07-26T10:00:00Z", updatedAt: "2026-07-26T11:00:00Z", messageCount: 4 }] });
    const onOpen = await renderDashboard(binding("selection_required"));
    await flush();
    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Cozy Project")?.click());
    await flush();

    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.getAttribute("aria-label") === "Resume Latest")?.click());
    expect(onOpen).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-latest" }, authorityToken, projectId);

    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.click());
    await flush();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    expect(onOpen).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-new" }, authorityToken, projectId);
  });

  it("keeps Start blocked unless an enabled provider has a matching ready chat-streaming model", async () => {
    const cases = [
      { models: [{ ...readyModel, providerId: "other" }], providers: [readyProvider] },
      { models: [{ ...readyModel, capabilities: { ...readyModel.capabilities, chat: false } }], providers: [readyProvider] },
      { models: [{ ...readyModel, capabilities: { ...readyModel.capabilities, streaming: false } }], providers: [readyProvider] },
    ];
    for (const readiness of cases) {
      installFetch(readiness);
      await renderDashboard(binding("auto_bound"));
      await flush();
      expect(Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.disabled).toBe(true);
      act(() => root?.unmount());
      root = undefined;
      container?.remove();
    }

    installFetch();
    await renderDashboard(binding("auto_bound"));
    await flush();
    expect(Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.disabled).toBe(false);
  });

  it("starts and resumes without minting an intent when memory selection is empty", async () => {
    installFetch({ chats: [{ chatId: "chat-latest", title: "Latest", createdAt: "2026-07-26T10:00:00Z", updatedAt: "2026-07-26T11:00:00Z", messageCount: 4 }] });
    await renderDashboard(binding("auto_bound"));
    await flush();

    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.getAttribute("aria-label") === "Resume Latest")?.click());
    expect(consumeProjectChatLaunchIntent({ projectId, chatId: "chat-latest", lifecycleGeneration: "standalone" })).toBeNull();
    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.click());
    await flush();
    expect(consumeProjectChatLaunchIntent({ projectId, chatId: "chat-new", lifecycleGeneration: "standalone" })).toBeNull();
  });

  it("starts exactly one scoped chat and opens it", async () => {
    const fetchMock = installFetch();
    const onOpen = await renderDashboard(binding("auto_bound"));
    await flush();

    const start = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat");
    act(() => { start?.click(); start?.click(); });
    await flush();

    const creates = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(`/p/${projectId}/v1/chats`) && init?.method === "POST");
    expect(creates).toHaveLength(1);
    expect(onOpen).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-new" }, authorityToken, undefined);
  });

  it("clears Starting before accepted open scheduling can rerender the dashboard", async () => {
    installFetch();
    const currentBinding = binding("auto_bound");
    const onOpen = vi.fn(() => {
      root?.render(<CurrentWorkspaceDashboard settings={settings} binding={currentBinding} hostReadyGeneration="ready-1" getAuthorityToken={() => authorityToken} onOpen={onOpen} />);
      return true;
    });
    await renderDashboard(currentBinding, onOpen, "ready-1");
    await flush();

    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.click());
    await flush();

    const start = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat");
    expect(onOpen).toHaveBeenCalledOnce();
    expect(start?.disabled).toBe(false);
  });

  it.each(["auto_bound", "selection_required"] as const)("recovers when a deferred %s Start loses workspace authority", async (bindingState) => {
    let resolveCreate: ((response: Response) => void) | undefined;
    let createCount = 0;
    const fetchMock = installFetch();
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith(`/p/${projectId}/v1/chats`) && init?.method === "POST") {
        createCount += 1;
        if (createCount === 1) return new Promise<Response>((resolve) => { resolveCreate = resolve; });
        return response({ chatId: "chat-retry" });
      }
      return defaultFetch(input, init);
    });
    const onOpen = vi.fn(() => false);
    const currentBinding = binding(bindingState);
    await renderDashboard(currentBinding, onOpen, "ready-1");
    await flush();
    if (bindingState === "selection_required") {
      act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Cozy Project")?.click());
      await flush();
    }

    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.click());
    expect(container?.textContent).toContain("Starting…");
    await act(async () => {
      root?.render(<CurrentWorkspaceDashboard settings={settings} binding={currentBinding} hostReadyGeneration="ready-2" getAuthorityToken={() => "authority-2" as HostedAuthorityToken} onOpen={onOpen} />);
      resolveCreate?.(new Response(JSON.stringify({ chatId: "chat-stale" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    await flush();

    if (bindingState === "selection_required") {
      expect(container?.textContent).toContain("Select a project for this session");
      act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Cozy Project")?.click());
      await flush();
    } else {
      expect(container?.textContent).toContain("The workspace changed. Try again.");
    }
    const retry = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat");
    expect(retry?.disabled).toBe(false);
    onOpen.mockReturnValue(true);
    act(() => retry?.click());
    await flush();
    if (bindingState === "selection_required") {
      expect(onOpen).toHaveBeenLastCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-retry" }, "authority-2", projectId);
    } else {
      expect(onOpen).toHaveBeenLastCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-retry" }, "authority-2", undefined);
    }
  });

  it("keeps create failures generic and allows another Start", async () => {
    const fetchMock = installFetch();
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(`/p/${projectId}/v1/chats`) && init?.method === "POST"
        ? response({ error: "failed" }, 500)
        : defaultFetch(input, init));
    await renderDashboard(binding("auto_bound"));
    await flush();

    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.click());
    await flush();

    expect(container?.textContent).toContain("A new project chat could not be started.");
    expect(Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.disabled).toBe(false);
  });

  it("reports a rejected Resume without disabling it", async () => {
    installFetch({ chats: [{ chatId: "chat-latest", title: "Latest", createdAt: "2026-07-26T10:00:00Z", updatedAt: "2026-07-26T11:00:00Z", messageCount: 4 }] });
    const onOpen = vi.fn(() => false);
    await renderDashboard(binding("auto_bound"), onOpen);
    await flush();

    const resume = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.getAttribute("aria-label") === "Resume Latest");
    act(() => resume?.click());

    expect(container?.textContent).toContain("The workspace changed. Try again.");
    expect(resume?.disabled).toBe(false);
  });

  it("ignores create completion after unmount", async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchMock = installFetch();
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(`/p/${projectId}/v1/chats`) && init?.method === "POST"
        ? new Promise<Response>((resolve) => { resolveCreate = resolve; })
        : defaultFetch(input, init));
    const onOpen = vi.fn(() => true);
    await renderDashboard(binding("auto_bound"), onOpen);
    await flush();
    act(() => Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Start new chat")?.click());

    act(() => root?.unmount());
    root = undefined;
    await act(async () => resolveCreate?.(new Response(JSON.stringify({ chatId: "chat-late" }), { status: 200, headers: { "Content-Type": "application/json" } })));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("resumes the latest chat without creating and leaves storage and DOM private", async () => {
    const fetchMock = installFetch({ chats: [
      { chatId: "chat-old", title: "Old", createdAt: "2026-07-20T10:00:00Z", updatedAt: "2026-07-20T10:00:00Z", messageCount: 2 },
      { chatId: "chat-latest", title: "Latest", createdAt: "2026-07-26T10:00:00Z", updatedAt: "2026-07-26T11:00:00Z", messageCount: 4 },
    ] });
    const onOpen = await renderDashboard(binding("auto_bound"));
    await flush();

    const resume = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.getAttribute("aria-label") === "Resume Latest");
    act(() => resume?.click());

    expect(onOpen).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-latest" }, authorityToken, undefined);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(document.body.textContent).not.toMatch(/\/Users\/|Bearer |sessionToken|multiple_roots/);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("loads bounded memory metadata and exposes selection without attaching or sending it", async () => {
    const rawBody = "PRIVATE NOTE BODY must not render or send";
    const onSelectedMemoryNoteIdsChange = vi.fn();
    const fetchMock = installFetch({ memory: [{ id: "mem-safe", title: "Architecture choice", text: rawBody, tags: ["design"], source: "manual", createdAt: "2026-07-20T10:00:00Z", updatedAt: "2026-07-26T10:00:00Z" }] });
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = ReactDOM.createRoot(container!);
      root.render(<CurrentWorkspaceDashboard settings={settings} binding={binding("auto_bound")} hostReadyGeneration="ready-1" getAuthorityToken={() => authorityToken} onOpen={vi.fn()} onSelectedMemoryNoteIdsChange={onSelectedMemoryNoteIdsChange} />);
    });
    await flush();

    expect(container?.textContent).toContain("Architecture choice");
    expect(container?.textContent).not.toContain(rawBody);
    act(() => Array.from(container?.querySelectorAll("label") ?? []).find((item) => item.textContent?.includes("Select Architecture choice"))?.querySelector("input")?.click());

    expect(onSelectedMemoryNoteIdsChange).toHaveBeenLastCalledWith(["mem-safe"]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
