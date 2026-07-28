import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHome } from "./ProjectHome";
import type { ProjectSummary } from "../services/projectClient";
import type { ProjectCommandCenterModel } from "../services/projectCommandCenterData";

const project: ProjectSummary = { projectId: "prj_abcdefghijklmnopqrstuA" as ProjectSummary["projectId"], displayName: "Quiet Garden", status: "available", revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
const model: ProjectCommandCenterModel = {
  readiness: { status: "ready", items: [{ id: "project", label: "Local project context", status: "ready" }] },
  conversations: { status: "ready", items: [{ chatId: "chat-recent", title: "Recent design", updatedLabel: "Recently updated" }] },
  memory: { status: "ready", items: [{ noteId: "note-1", title: "Architecture", tags: ["design"], summary: "Safe summary" }] },
  activeWork: { status: "ready", items: [{ runId: "run-1", cardLabel: "S143", status: "active", updatedLabel: "Recently updated" }] },
  start: { enabled: true },
};
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("ProjectHome", () => {
  it("renders safe readiness and navigation summaries without private content", () => {
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} model={model} navigate={() => undefined} />); });
    expect(container.textContent).toContain("Quiet Garden command center");
    expect(container.textContent).toContain("Recent design");
    expect(container.querySelector("a[href='/p/prj_abcdefghijklmnopqrstuA/chat']")).not.toBeNull();
    expect(container.textContent).not.toContain("/Users/");
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
    act(() => button("Resume Recent design").click());
    act(() => button("Open S143").click());
    const memory = container.querySelector("a[href$='/memory']") as HTMLAnchorElement;
    act(() => memory.click());
    expect(navigate.mock.calls.map(([route]) => route)).toEqual([
      { kind: "project", projectId: project.projectId, page: "chat", chatId: "chat-recent" },
      { kind: "project", projectId: project.projectId, page: "agent" },
      { kind: "project", projectId: project.projectId, page: "memory" },
    ]);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
});
