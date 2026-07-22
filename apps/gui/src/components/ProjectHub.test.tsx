import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHub } from "./ProjectHub";
import * as client from "../services/projectClient";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), listProjects: vi.fn(), archiveProject: vi.fn(), restoreProject: vi.fn(), updateProject: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
const summary = (name: string, status: "available" | "missing" | "archived" = "available") => ({ projectId: "prj_abcdefghijklmnopqrstuv" as client.ProjectSummary["projectId"], displayName: name, status, revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: status === "available", cloudRequired: false as const, providerAccess: "direct" as const });
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
async function render() { const container = document.createElement("div"); document.body.append(container); await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectHub settings={settings} />); }); return container; }

describe("ProjectHub", () => {
  it("renders the empty product landing state", async () => {
    vi.mocked(client.listProjects).mockResolvedValue({ ok: true, data: { projects: [], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } });
    const container = await render();
    expect(container.textContent).toContain("Give your work a clear home");
    expect(container.textContent).toContain("Add your first project");
  });

  it("renders duplicate, missing, archived and legacy states using safe metadata only", async () => {
    vi.mocked(client.listProjects).mockResolvedValue({ ok: true, data: { projects: [summary("Twin"), { ...summary("Twin", "missing"), projectId: "prj_1234567890123456789012" as client.ProjectSummary["projectId"] }, { ...summary("Old", "archived"), projectId: "prj_abcdefghijklmnopqrstu_" as client.ProjectSummary["projectId"] }], legacyUnscopedAvailable: true, cloudRequired: false, providerAccess: "direct" } });
    const container = await render();
    expect(container.textContent?.match(/Twin/g)?.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Directory unavailable");
    expect(container.textContent).toContain("Archived projects");
    expect(container.textContent).toContain("Unscoped legacy data");
    for (const forbidden of ["/Users/private", "worker", "LSP", "cron", "token-secret", "8001"]) expect(container.textContent).not.toContain(forbidden);
    expect(container.querySelector("table")?.querySelectorAll("th").length).toBe(5);
  });

  it("shows a bounded registry error", async () => {
    vi.mocked(client.listProjects).mockResolvedValue({ ok: false, error: { status: "network", message: "/Users/private registry failed at port 8001" } });
    const container = await render();
    expect(container.textContent).toContain("Project registry unavailable");
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("8001");
  });
});
