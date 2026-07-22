import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectHome } from "./ProjectHome";
import type { ProjectSummary } from "../services/projectClient";

const project: ProjectSummary = { projectId: "prj_abcdefghijklmnopqrstuv" as ProjectSummary["projectId"], displayName: "Quiet Garden", status: "available", revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("ProjectHome", () => {
  it("renders safe readiness and navigation summaries without private content", () => {
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectHome project={project} />); });
    expect(container.textContent).toContain("Welcome to Quiet Garden");
    expect(container.textContent).toContain("No activity yet");
    expect(container.querySelector("a[href='/p/prj_abcdefghijklmnopqrstuv/chat']")).not.toBeNull();
    expect(container.textContent).not.toContain("/Users/");
  });
});
