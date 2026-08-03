import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHome } from "./ProjectHome";
import type { ProjectSummary } from "../services/projectClient";
import type { ProjectCommandCenterModel } from "../services/projectCommandCenterData";
import { clearProjectChatLaunchIntent, consumeProjectChatLaunchIntent, getBrowserProjectChatLifecycleGeneration } from "../services/projectChatLaunchIntent";

const project: ProjectSummary = { projectId: "prj_abcdefghijklmnopqrstuA" as ProjectSummary["projectId"], displayName: "Quiet Garden", status: "available", revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
const model: ProjectCommandCenterModel = {
  readiness: { status: "ready", items: [{ id: "project", label: "Local project context", status: "ready" }] },
  conversations: { status: "ready", items: [{ chatId: "chat-recent", title: "Recent design", updatedLabel: "Recently updated" }] },
  memory: { status: "ready", items: [{ noteId: "note-1", title: "Architecture", tags: ["design"], summary: "Safe summary" }] },
  activeWork: { status: "ready", items: [
    { runId: "run-1", cardLabel: "S143", status: "active", updatedLabel: "Recently updated" },
    { runId: "run-2", cardLabel: "S144", status: "blocked", updatedLabel: "Recently updated" },
  ] },
  start: { enabled: true },
};
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; clearProjectChatLaunchIntent(); });

describe("ProjectHome", () => {
  it("renders safe readiness and navigation summaries without private content", () => {
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} model={model} navigate={() => undefined} />); });
    expect(container.textContent).toContain("Quiet Garden command center");
    expect(container.textContent).toContain("Recent design");
    expect(container.querySelector("a[href='/p/prj_abcdefghijklmnopqrstuA/chat']")).not.toBeNull();
    expect(container.textContent).not.toContain("/Users/");
  });

  it("wires the inspectable context surface without implying chat attachment", () => {
    const rebuild = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} model={model} context={{ status: "ready", context: { protocolVersion: "2026-08-02", schemaVersion: 1, projectId: project.projectId, state: "not_built", inventoryGeneration: 0, cloudRequired: false, providerAccess: "direct" }, profile: null }} contextRebuilding={false} contextRebuildError={null} onRebuildContext={rebuild} navigate={() => undefined} />); });
    expect(container.textContent).toContain("Build the local structural inventory");
    expect(container.textContent).toContain("not automatically attached to chat");
    expect(rebuild).not.toHaveBeenCalled();
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Rebuild project context") as HTMLButtonElement).click());
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("uses SPA navigation for ordinary clicks and leaves modified clicks native", () => {
    const navigate = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} model={model} navigate={navigate} />); });
    const chat = container.querySelector("a[href$='/chat']") as HTMLAnchorElement;
    act(() => chat.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(navigate).toHaveBeenCalledWith({ kind: "project", projectId: project.projectId, page: "chat" });
    navigate.mockClear();
    const modifiedClick = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    modifiedClick.preventDefault();
    act(() => chat.dispatchEvent(modifiedClick));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("routes resume, memory, and active work without writing browser storage", () => {
    localStorage.clear(); sessionStorage.clear();
    const navigate = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} model={model} navigate={navigate} />); });
    const button = (label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === label)!;
    act(() => button("Open Recent design").click());
    act(() => button("Open S143 in Agent").click());
    act(() => button("Open S144 in Agent").click());
    const memory = container.querySelector("a[href$='/memory']") as HTMLAnchorElement;
    act(() => memory.click());
    expect(navigate.mock.calls.map(([route]) => route)).toEqual([
      { kind: "project", projectId: project.projectId, page: "chat", chatId: "chat-recent" },
      { kind: "project", projectId: project.projectId, page: "agent" },
      { kind: "project", projectId: project.projectId, page: "agent" },
      { kind: "project", projectId: project.projectId, page: "memory" },
    ]);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });

  it("creates selected-memory launch intent only on explicit Resume", () => {
    const navigate = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} model={model} navigate={navigate} />); });
    expect(consumeProjectChatLaunchIntent({ projectId: project.projectId, chatId: "chat-recent", lifecycleGeneration: getBrowserProjectChatLifecycleGeneration() })).toBeNull();
    act(() => container.querySelector("input[type='checkbox']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => Array.from(container.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Open Recent design")?.click());
    const intent = consumeProjectChatLaunchIntent({ projectId: project.projectId, chatId: "chat-recent", lifecycleGeneration: getBrowserProjectChatLifecycleGeneration() });
    expect(intent?.selectedNoteIds).toEqual(["note-1"]);
    expect(navigate).toHaveBeenCalledWith({ kind: "project", projectId: project.projectId, page: "chat", chatId: "chat-recent" });
  });

  it("starts and resumes without launch intents when no memory is selected", () => {
    const navigate = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} model={model} navigate={navigate} />); });

    act(() => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Start new chat")?.click());
    expect(consumeProjectChatLaunchIntent({ projectId: project.projectId, lifecycleGeneration: getBrowserProjectChatLifecycleGeneration() })).toBeNull();
    act(() => Array.from(container.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Open Recent design")?.click());
    expect(consumeProjectChatLaunchIntent({ projectId: project.projectId, chatId: "chat-recent", lifecycleGeneration: getBrowserProjectChatLifecycleGeneration() })).toBeNull();
  });
});
