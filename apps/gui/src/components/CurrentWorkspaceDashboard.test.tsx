// @vitest-environment jsdom
import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceBindingPayload } from "../bridge/bridgeAdapter";
import { CurrentWorkspaceDashboard } from "./CurrentWorkspaceDashboard";

const projectId = "prj_abcdefghijklmnopqrstuA";
const settings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" as const };
let root: ReactDOM.Root | undefined;
let container: HTMLDivElement | undefined;

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
}

function project(displayName = "Cozy Project") {
  return { projectId, displayName, status: "available", revision: "1", createdAt: "2026-07-20T10:00:00Z", lastOpenedAt: "2026-07-26T10:00:00Z", rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
}

function installFetch(options: { chats?: unknown[]; failAgent?: boolean } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/ping")) return response({ ready: true });
    if (url.endsWith("/v1/models")) return response({ models: [{ id: "demo", displayName: "Demo", readiness: { status: "ready" } }] });
    if (url.endsWith("/v1/providers")) return response({ providers: [{ id: "demo", enabled: true }], cloudRequired: false, providerAccess: "direct" });
    if (url.endsWith(`/v1/projects/${projectId}`)) return response(project());
    if (url.endsWith(`/p/${projectId}/v1/agent-progress`)) return options.failAgent ? response({ error: "private data omitted" }, 503) : response({ snapshots: [], cloudRequired: false, providerAccess: "direct" });
    if (url.endsWith(`/p/${projectId}/v1/chats`) && init?.method === "POST") return response({ chatId: "chat-new", title: "New chat", createdAt: "2026-07-26T12:00:00Z", updatedAt: "2026-07-26T12:00:00Z", messages: [] });
    if (url.endsWith(`/p/${projectId}/v1/chats`)) return response({ chats: options.chats ?? [] });
    if (url.endsWith("/v1/projects")) return response({ projects: [project()], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" });
    return response({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderDashboard(binding: WorkspaceBindingPayload, onOpen = vi.fn()) {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = ReactDOM.createRoot(container!);
    root.render(<CurrentWorkspaceDashboard settings={settings} binding={binding} onOpen={onOpen} />);
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
  it("loads bound sections independently without creating or subscribing to chat", async () => {
    const fetchMock = installFetch({ failAgent: true });
    const onOpen = await renderDashboard(binding("auto_bound"));
    expect(onOpen).not.toHaveBeenCalled();
    await flush();

    expect(container?.textContent).toContain("Cozy Project");
    expect(container?.textContent).toContain("Runtime ready");
    expect(container?.textContent).toContain("No conversations yet.");
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

    expect(container?.textContent).toContain("No conversations yet.");
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
    expect(onOpen).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-new" });
  });

  it("resumes the latest chat without creating and leaves storage and DOM private", async () => {
    const fetchMock = installFetch({ chats: [
      { chatId: "chat-old", title: "Old", createdAt: "2026-07-20T10:00:00Z", updatedAt: "2026-07-20T10:00:00Z", messageCount: 2 },
      { chatId: "chat-latest", title: "Latest", createdAt: "2026-07-26T10:00:00Z", updatedAt: "2026-07-26T11:00:00Z", messageCount: 4 },
    ] });
    const onOpen = await renderDashboard(binding("auto_bound"));
    await flush();

    const resume = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === "Resume last");
    act(() => resume?.click());

    expect(onOpen).toHaveBeenCalledWith({ kind: "project", projectId, page: "chat", chatId: "chat-latest" });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(document.body.textContent).not.toMatch(/\/Users\/|Bearer |sessionToken|multiple_roots/);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
