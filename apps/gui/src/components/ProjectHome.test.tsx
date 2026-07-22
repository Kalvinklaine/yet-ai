import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHome } from "./ProjectHome";
import type { ProjectSummary } from "../services/projectClient";

const project: ProjectSummary = { projectId: "prj_abcdefghijklmnopqrstuv" as ProjectSummary["projectId"], displayName: "Quiet Garden", status: "available", revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("ProjectHome", () => {
  it("renders safe readiness and navigation summaries without private content", () => {
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} navigate={() => undefined} />); });
    expect(container.textContent).toContain("Welcome to Quiet Garden");
    expect(container.textContent).toContain("No activity yet");
    expect(container.querySelector("a[href='/p/prj_abcdefghijklmnopqrstuv/chat']")).not.toBeNull();
    expect(container.textContent).not.toContain("/Users/");
  });

  it("uses SPA navigation for ordinary clicks and leaves modified clicks native", () => {
    const navigate = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} navigate={navigate} />); });
    const chat = container.querySelector("a[href$='/chat']") as HTMLAnchorElement;
    act(() => chat.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(navigate).toHaveBeenCalledWith({ kind: "project", projectId: project.projectId, page: "chat" });
    navigate.mockClear();
    const modifiedClick = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    modifiedClick.preventDefault();
    act(() => chat.dispatchEvent(modifiedClick));
    expect(navigate).not.toHaveBeenCalled();
  });
});
