import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectShell } from "./ProjectShell";
import * as client from "../services/projectClient";
import { parseProjectId } from "../services/projectRouting";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), getProject: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
const projectId = parseProjectId("prj_abcdefghijklmnopqrstuv")!;
const project = { projectId, displayName: "Quiet Garden", status: "available" as const, revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false as const, providerAccess: "direct" as const };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
async function render(status: client.ProjectSummary["status"] = "available", page: "home" | "chat" = "home") { vi.mocked(client.getProject).mockResolvedValue({ ok: true, data: { ...project, status, rootAvailable: status === "available" } }); const container = document.createElement("div"); document.body.append(container); await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectShell route={{ kind: "project", projectId, page }} settings={settings} navigate={() => undefined}><div>Chat content</div></ProjectShell>); }); return container; }

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
    act(() => root?.unmount()); root = undefined; document.body.innerHTML = "";
    container = await render("missing"); expect(container.textContent).toContain("Project directory unavailable");
    expect(container.textContent).not.toContain("/Users/");
  });

  it("ignores a late project response after the route changes", async () => {
    const secondId = parseProjectId("prj_1234567890123456789012")!;
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
});
