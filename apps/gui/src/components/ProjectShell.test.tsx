import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectShell } from "./ProjectShell";
import * as client from "../services/projectClient";
import * as memoryClient from "../services/projectMemoryClient";
import { parseProjectId } from "../services/projectRouting";
import * as providerAuthClient from "../services/providerAuthClient";
import * as providersClient from "../services/providersClient";
import * as runtimeClient from "../services/runtimeClient";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), getProject: vi.fn(), startDirectoryDiscovery: vi.fn(), listDirectoryDiscovery: vi.fn(), rebindProject: vi.fn() }));
vi.mock("../services/projectMemoryClient", async (original) => ({ ...await original<typeof import("../services/projectMemoryClient")>(), listProjectMemory: vi.fn() }));
vi.mock("../services/providerAuthClient", async (original) => ({ ...await original<typeof import("../services/providerAuthClient")>(), getProviderAuthStatus: vi.fn() }));
vi.mock("../services/providersClient", async (original) => ({ ...await original<typeof import("../services/providersClient")>(), listProviders: vi.fn() }));
vi.mock("../services/runtimeClient", async (original) => ({ ...await original<typeof import("../services/runtimeClient")>(), listChats: vi.fn(), getAgentProgress: vi.fn(), getPing: vi.fn(), getModels: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
const projectId = parseProjectId("prj_abcdefghijklmnopqrstuA")!;
const project = { projectId, displayName: "Quiet Garden", status: "available" as const, revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false as const, providerAccess: "direct" as const };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
beforeEach(() => {
  vi.mocked(runtimeClient.getPing).mockResolvedValue({ ok: true, data: ping(true) });
  vi.mocked(runtimeClient.getModels).mockResolvedValue({ ok: true, data: { models: [readyModel()] } });
  vi.mocked(providersClient.listProviders).mockResolvedValue({ ok: true, data: { providers: [readyProvider()], cloudRequired: false, providerAccess: "direct" } });
  vi.mocked(providerAuthClient.getProviderAuthStatus).mockResolvedValue({ ok: true, data: providerAuth("not_configured") });
});
async function render(status: client.ProjectSummary["status"] = "available", page: "home" | "chat" = "home") {
  vi.mocked(client.getProject).mockResolvedValue({ ok: true, data: { ...project, status, rootAvailable: status === "available" } });
  vi.mocked(runtimeClient.listChats).mockResolvedValue({ ok: true, data: { chats: [] } });
  vi.mocked(memoryClient.listProjectMemory).mockResolvedValue({ ok: true, data: { notes: [] } });
  vi.mocked(runtimeClient.getAgentProgress).mockResolvedValue({ ok: true, data: { snapshots: [], cloudRequired: false, providerAccess: "direct" } });
  const container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page }} settings={settings} navigate={() => undefined}><div>Chat content</div></ProjectShell>); });
  return container;
}

describe("ProjectShell", () => {
  it("keeps the project boundary and active navigation visible", async () => {
    const container = await render("available", "chat");
    expect(container.textContent).toContain("Current projectQuiet Garden");
    expect(container.textContent).toContain("Chat content");
    expect(container.querySelector("a[href$='/chat']")?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelectorAll("nav a").length).toBe(4);
  });

  it("blocks archived and missing projects", async () => {
    let container = await render("archived"); expect(container.textContent).toContain("Project archived");
    expect(container.textContent).not.toContain("Reconnect directory");
    expect(runtimeClient.listChats).not.toHaveBeenCalled();
    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    container = await render("missing"); expect(container.textContent).toContain("Project directory unavailable");
    expect(container.textContent).toContain("Reconnect directory");
    expect(container.textContent).not.toContain("/Users/");
  });

  it("reconnects a missing project without changing its route identity", async () => {
    const navigate = vi.fn();
    const missing = { ...project, status: "missing" as const, rootAvailable: false };
    vi.mocked(client.getProject).mockResolvedValue({ ok: true, data: missing });
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "session", expiresAt: "2027-01-01T00:00:00Z", root: { handle: "opaque-root", displayName: "Recovered", selectable: true }, cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "session", directoryHandle: "opaque-root", expiresAt: "2027-01-01T00:00:00Z", entries: [], cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.rebindProject).mockResolvedValue({ ok: true, data: { ...project, revision: "2" } });
    vi.mocked(runtimeClient.listChats).mockResolvedValue({ ok: true, data: { chats: [] } });
    vi.mocked(memoryClient.listProjectMemory).mockResolvedValue({ ok: true, data: { notes: [] } });
    vi.mocked(runtimeClient.getAgentProgress).mockResolvedValue({ ok: true, data: { snapshots: [], cloudRequired: false, providerAccess: "direct" } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page: "chat" }} settings={settings} navigate={navigate}><div>Chat content</div></ProjectShell>); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Reconnect directory") as HTMLButtonElement).click(); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(client.rebindProject).toHaveBeenCalledWith(settings, projectId, { expectedRevision: "1", directorySessionId: "session", directoryHandle: "opaque-root" }, expect.any(AbortSignal));
    expect(container.textContent).toContain("Chat content");
    expect(navigate).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain("/Users/private");
  });

  it.each([
    { refreshed: "archived", expected: "Project archived" },
    { refreshed: "not-found", expected: "This project could not be found." },
  ] as const)("reloads the blocked route after a rebind conflict resolves to $refreshed", async ({ refreshed, expected }) => {
    const navigate = vi.fn();
    const missing = { ...project, status: "missing" as const, rootAvailable: false };
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({ ok: true, data: missing })
      .mockResolvedValueOnce(refreshed === "archived"
        ? { ok: true, data: { ...project, status: "archived", revision: "2", rootAvailable: false } }
        : { ok: false, error: { status: 404, message: "Project not found. /Users/private" } });
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "session", expiresAt: "2027-01-01T00:00:00Z", root: { handle: "opaque-root", displayName: "Recovered", selectable: true }, cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "session", directoryHandle: "opaque-root", expiresAt: "2027-01-01T00:00:00Z", entries: [], cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.rebindProject).mockResolvedValue({ ok: false, error: { status: 409, message: "revision conflict /Users/private" } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page: "chat" }} settings={settings} navigate={navigate}><div>Chat content</div></ProjectShell>); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Reconnect directory") as HTMLButtonElement).click(); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(container.textContent).toContain("Close and reload project");
    expect(container.textContent).not.toContain("Close and refresh Projects");
    expect(container.textContent).not.toContain("/Users/private");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Close and reload project") as HTMLButtonElement).click(); });

    expect(client.getProject).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(expected);
    expect(container.textContent).not.toContain("Project directory unavailable");
    expect(container.textContent).not.toContain("Chat content");
    expect(container.textContent).not.toContain("/Users/private");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("loads project-scoped command-center data and renders safe section states", async () => {
    vi.mocked(client.getProject).mockResolvedValue({ ok: true, data: project });
    vi.mocked(runtimeClient.listChats).mockResolvedValue({ ok: true, data: { chats: [{ chatId: "chat-latest", title: "Latest chat", createdAt: "2026-07-28T10:00:00Z", updatedAt: "2026-07-28T11:00:00Z", messageCount: 2 }] } });
    vi.mocked(memoryClient.listProjectMemory).mockResolvedValue({ ok: true, data: { notes: [] } });
    vi.mocked(runtimeClient.getAgentProgress).mockResolvedValue({ ok: false, error: { status: 503, message: "/Users/private raw backend" } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page: "home" }} settings={settings} navigate={() => undefined} />); });
    expect(container.textContent).toContain("Latest chat");
    expect(container.textContent).toContain("No memory notes.");
    expect(container.textContent).toContain("Active work could not be loaded.");
    expect(container.textContent).not.toContain("/Users/private");
    const scopedSettings = vi.mocked(runtimeClient.listChats).mock.calls[0][0];
    expect(scopedSettings).toMatchObject({ apiBase: `/p/${projectId}/v1`, projectScope: { projectId } });
  });

  it("gates Start on verified runtime and provider-model readiness", async () => {
    let container = await render();
    expect(startButton(container).disabled).toBe(false);
    expect(container.textContent).toContain("1 ready provider-model pairing");

    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    vi.mocked(runtimeClient.getPing).mockResolvedValue({ ok: true, data: ping(false) });
    container = await render();
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("The local runtime is not ready.");

    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    vi.mocked(runtimeClient.getPing).mockResolvedValue({ ok: true, data: ping(true) });
    vi.mocked(providersClient.listProviders).mockResolvedValue({ ok: true, data: { providers: [], cloudRequired: false, providerAccess: "direct" } });
    container = await render();
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("Set up a ready provider and model before starting chat.");
  });

  it("enables Start for connected account-login fallback only", async () => {
    vi.mocked(runtimeClient.getModels).mockResolvedValue({ ok: true, data: { models: [] } });
    vi.mocked(providersClient.listProviders).mockResolvedValue({ ok: true, data: { providers: [], cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(providerAuthClient.getProviderAuthStatus).mockResolvedValue({ ok: true, data: providerAuth("connected") });

    let container = await render();
    expect(startButton(container).disabled).toBe(false);
    expect(container.textContent).toContain("Provider account login fallback ready");
    expect(container.textContent).not.toContain("ready provider-model pairing");

    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    vi.mocked(providerAuthClient.getProviderAuthStatus).mockResolvedValue({ ok: true, data: providerAuth("pending") });
    container = await render();
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("Provider setup required");
  });

  it("prefers normal pairing and fails closed on runtime or auth failure", async () => {
    vi.mocked(providerAuthClient.getProviderAuthStatus).mockResolvedValue({ ok: false, error: { status: 503, message: "unavailable" } });
    let container = await render();
    expect(startButton(container).disabled).toBe(false);
    expect(container.textContent).toContain("1 ready provider-model pairing");
    expect(container.textContent).not.toContain("Provider account login fallback ready");
    expect(providerAuthClient.getProviderAuthStatus).toHaveBeenCalledWith(settings, "openai");

    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    vi.mocked(runtimeClient.getPing).mockResolvedValue({ ok: true, data: ping(false) });
    vi.mocked(runtimeClient.getModels).mockResolvedValue({ ok: true, data: { models: [] } });
    vi.mocked(providersClient.listProviders).mockResolvedValue({ ok: true, data: { providers: [], cloudRequired: false, providerAccess: "direct" } });
    container = await render();
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("The local runtime is not ready.");

    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    vi.mocked(runtimeClient.getPing).mockResolvedValue({ ok: true, data: ping(true) });
    vi.mocked(providerAuthClient.getProviderAuthStatus).mockResolvedValue({ ok: false, error: { status: 503, message: "/Users/private token=secret" } });
    container = await render();
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("Provider setup required");
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("token=secret");
  });

  it("rejects ready models without chat and streaming capabilities", async () => {
    vi.mocked(runtimeClient.getModels).mockResolvedValue({ ok: true, data: { models: [{ ...readyModel(), capabilities: { chat: true, streaming: false, tools: false, reasoning: false } }] } });
    const container = await render();
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("Provider setup required");
  });

  it("shows readiness loading until verification completes", async () => {
    let resolvePing!: (value: Awaited<ReturnType<typeof runtimeClient.getPing>>) => void;
    vi.mocked(runtimeClient.getPing).mockReturnValue(new Promise((resolve) => { resolvePing = resolve; }));
    const container = await render();
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("Loading readiness");
    await act(async () => resolvePing({ ok: true, data: ping(true) }));
    expect(startButton(container).disabled).toBe(false);
  });

  it("ignores late readiness after settings change", async () => {
    let resolveFirstModels!: (value: Awaited<ReturnType<typeof runtimeClient.getModels>>) => void;
    vi.mocked(client.getProject).mockResolvedValue({ ok: true, data: project });
    vi.mocked(runtimeClient.listChats).mockResolvedValue({ ok: true, data: { chats: [] } });
    vi.mocked(memoryClient.listProjectMemory).mockResolvedValue({ ok: true, data: { notes: [] } });
    vi.mocked(runtimeClient.getAgentProgress).mockResolvedValue({ ok: true, data: { snapshots: [], cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(runtimeClient.getModels)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirstModels = resolve; }))
      .mockResolvedValue({ ok: true, data: { models: [] } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page: "home" }} settings={settings} navigate={() => undefined} />); });
    const newSettings = { ...settings, baseUrl: "/new-runtime" };
    await act(async () => { root?.render(<ProjectShell route={{ kind: "project", projectId, page: "home" }} settings={newSettings} navigate={() => undefined} />); });
    expect(startButton(container).disabled).toBe(true);
    await act(async () => resolveFirstModels({ ok: true, data: { models: [readyModel()] } }));
    expect(startButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("Provider setup required");
  });

  it("ignores a late project response after the route changes", async () => {
    const secondId = parseProjectId("prj_123456789012345678901g")!;
    vi.mocked(runtimeClient.listChats).mockResolvedValue({ ok: true, data: { chats: [] } });
    vi.mocked(memoryClient.listProjectMemory).mockResolvedValue({ ok: true, data: { notes: [] } });
    vi.mocked(runtimeClient.getAgentProgress).mockResolvedValue({ ok: true, data: { snapshots: [], cloudRequired: false, providerAccess: "direct" } });
    let resolveFirst!: (value: Awaited<ReturnType<typeof client.getProject>>) => void;
    vi.mocked(client.getProject)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: { ...project, projectId: secondId, displayName: "New Garden" } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page: "home" }} settings={settings} navigate={() => undefined} />); });
    await act(async () => { root?.render(<ProjectShell route={{ kind: "project", projectId: secondId, page: "home" }} settings={settings} navigate={() => undefined} />); });
    expect(container.textContent).toContain("New Garden");
    await act(async () => resolveFirst({ ok: true, data: { ...project, displayName: "Old Garden" } }));
    expect(container.textContent).toContain("New Garden");
    expect(container.textContent).not.toContain("Old Garden");
  });

  it("rejects late command-center data after a project switch", async () => {
    const secondId = parseProjectId("prj_123456789012345678901g")!;
    let resolveFirstChats!: (value: Awaited<ReturnType<typeof runtimeClient.listChats>>) => void;
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({ ok: true, data: project })
      .mockResolvedValueOnce({ ok: true, data: { ...project, projectId: secondId, displayName: "New Garden" } });
    vi.mocked(runtimeClient.listChats)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirstChats = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: { chats: [{ chatId: "chat-new", title: "New project chat", createdAt: "2026-07-28T10:00:00Z", updatedAt: "2026-07-28T11:00:00Z", messageCount: 1 }] } });
    vi.mocked(memoryClient.listProjectMemory).mockResolvedValue({ ok: true, data: { notes: [] } });
    vi.mocked(runtimeClient.getAgentProgress).mockResolvedValue({ ok: true, data: { snapshots: [], cloudRequired: false, providerAccess: "direct" } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page: "home" }} settings={settings} navigate={() => undefined} />); });
    await act(async () => { root?.render(<ProjectShell route={{ kind: "project", projectId: secondId, page: "home" }} settings={settings} navigate={() => undefined} />); });
    expect(container.textContent).toContain("New project chat");
    await act(async () => resolveFirstChats({ ok: true, data: { chats: [{ chatId: "chat-old", title: "Old project chat", createdAt: "2026-07-28T10:00:00Z", updatedAt: "2026-07-28T12:00:00Z", messageCount: 1 }] } }));
    expect(container.textContent).toContain("New project chat");
    expect(container.textContent).not.toContain("Old project chat");
  });
});

function readyModel(): runtimeClient.ModelSummary {
  return { id: "demo", displayName: "Demo", providerId: "provider-1", capabilities: { chat: true, streaming: true, tools: false, reasoning: false }, readiness: { status: "ready" } };
}

function ping(ready: boolean): runtimeClient.PingResponse {
  return { productId: "yet-ai", displayName: "Yet AI", version: "1", ready, serverTime: "2026-07-28T10:00:00Z" };
}

function readyProvider(): providersClient.ProviderSummary {
  return { id: "provider-1", kind: "openai-compatible", displayName: "Provider", enabled: true, baseUrl: "https://example.test", auth: { type: "api_key", configured: true }, models: [readyModel()], capabilities: { chat: true, completion: false, embeddings: false } };
}

function providerAuth(status: providerAuthClient.ProviderAuthStatus): providerAuthClient.ProviderAuthResponse {
  return { provider: "openai", configured: status === "connected" || status === "pending", status, authSource: status === "connected" || status === "pending" ? "oauth" : "none", supportsLogin: true, supportsApiKey: true, cloudRequired: false };
}

function startButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Start new chat");
  if (!button) throw new Error("Missing Start new chat button");
  return button;
}
