import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectShell } from "./ProjectShell";
import * as client from "../services/projectClient";
import * as memoryClient from "../services/projectMemoryClient";
import { parseProjectId } from "../services/projectRouting";
import * as runtimeClient from "../services/runtimeClient";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), getProject: vi.fn() }));
vi.mock("../services/projectMemoryClient", async (original) => ({ ...await original<typeof import("../services/projectMemoryClient")>(), listProjectMemory: vi.fn() }));
vi.mock("../services/runtimeClient", async (original) => ({ ...await original<typeof import("../services/runtimeClient")>(), listChats: vi.fn(), getAgentProgress: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
const projectId = parseProjectId("prj_abcdefghijklmnopqrstuA")!;
const project = { projectId, displayName: "Quiet Garden", status: "available" as const, revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false as const, providerAccess: "direct" as const };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
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
    expect(runtimeClient.listChats).not.toHaveBeenCalled();
    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    container = await render("missing"); expect(container.textContent).toContain("Project directory unavailable");
    expect(container.textContent).not.toContain("/Users/");
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
