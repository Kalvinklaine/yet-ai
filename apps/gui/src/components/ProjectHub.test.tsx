import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHub } from "./ProjectHub";
import * as client from "../services/projectClient";
import type { ProjectNavigation } from "../services/projectRouting";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), listProjects: vi.fn(), archiveProject: vi.fn(), restoreProject: vi.fn(), updateProject: vi.fn(), startDirectoryDiscovery: vi.fn(), listDirectoryDiscovery: vi.fn(), registerProject: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
const summary = (name: string, status: "available" | "missing" | "archived" = "available") => ({ projectId: "prj_abcdefghijklmnopqrstuA" as client.ProjectSummary["projectId"], displayName: name, status, revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: status === "available", cloudRequired: false as const, providerAccess: "direct" as const });
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
async function render(navigate: ProjectNavigation = () => undefined) { const container = document.createElement("div"); document.body.append(container); await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectHub settings={settings} navigate={navigate} />); }); return container; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("ProjectHub", () => {
  it("renders the empty product landing state", async () => {
    vi.mocked(client.listProjects).mockResolvedValue({ ok: true, data: { projects: [], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } });
    const container = await render();
    expect(container.textContent).toContain("Give your work a clear home");
    expect(container.textContent).toContain("Add your first project");
  });

  it("renders duplicate, missing, archived and legacy states using safe metadata only", async () => {
    vi.mocked(client.listProjects).mockResolvedValue({ ok: true, data: { projects: [summary("Twin"), { ...summary("Twin", "missing"), projectId: "prj_123456789012345678901g" as client.ProjectSummary["projectId"] }, { ...summary("Old", "archived"), projectId: "prj_abcdefghijklmnopqrstuw" as client.ProjectSummary["projectId"] }], legacyUnscopedAvailable: true, cloudRequired: false, providerAccess: "direct" } });
    const container = await render();
    expect(container.textContent?.match(/Twin/g)?.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Directory unavailable");
    expect(container.textContent).toContain("Archived projects");
    expect(container.textContent).toContain("Unscoped legacy data");
    for (const forbidden of ["/Users/private", "worker", "LSP", "cron", "token-secret", "8001"]) expect(container.textContent).not.toContain(forbidden);
    expect(container.querySelector("table")?.querySelectorAll("th").length).toBe(5);
  });

  it("launches an available project in the same window or a safe canonical new tab", async () => {
    const project = summary("Launchable");
    const navigate = vi.fn();
    vi.mocked(client.listProjects).mockResolvedValue({ ok: true, data: { projects: [project], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } });
    const container = await render(navigate);
    const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("Launchable")) as HTMLTableRowElement;
    const sameWindow = Array.from(row.querySelectorAll("a")).find((link) => link.textContent === "Open") as HTMLAnchorElement;
    const newTab = Array.from(row.querySelectorAll("a")).find((link) => link.textContent === "Open in new tab") as HTMLAnchorElement;
    expect(sameWindow.getAttribute("aria-label")).toBe("Open Launchable");
    expect(sameWindow.getAttribute("href")).toBe(`/p/${project.projectId}/`);
    expect(newTab.getAttribute("aria-label")).toBe("Open Launchable in new tab");
    expect(newTab.getAttribute("href")).toBe(`/p/${project.projectId}/`);
    expect(newTab.getAttribute("target")).toBe("_blank");
    expect(newTab.getAttribute("rel")).toBe("noopener noreferrer");
    sameWindow.click();
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ kind: "project", projectId: project.projectId, page: "home" });
  });

  it("keeps unavailable project lifecycle controls without exposing launch hrefs or private values", async () => {
    const missing = { ...summary("Missing", "missing"), projectId: "prj_123456789012345678901g" as client.ProjectSummary["projectId"], rootPath: "/Users/private/missing-workspace" };
    const archived = { ...summary("Archived", "archived"), projectId: "prj_abcdefghijklmnopqrstuw" as client.ProjectSummary["projectId"], providerToken: "token-secret-archived" };
    vi.spyOn(window, "prompt").mockReturnValue("Missing renamed");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(client.updateProject).mockResolvedValue({ ok: true, data: { ...missing, displayName: "Missing renamed", revision: "2" } });
    vi.mocked(client.archiveProject).mockResolvedValue({ ok: true, data: { projectId: missing.projectId, status: "archived", revision: "2", rootAvailable: false, updatedAt: "2026-01-02T00:00:00Z" } });
    vi.mocked(client.restoreProject).mockResolvedValue({ ok: true, data: { projectId: archived.projectId, status: "available", revision: "2", rootAvailable: true, updatedAt: "2026-01-02T00:00:00Z" } });
    vi.mocked(client.listProjects).mockResolvedValue({ ok: true, data: { projects: [missing, archived], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } });
    const container = await render();
    const rowFor = (name: string) => Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.querySelector("strong")?.textContent === name) as HTMLTableRowElement;
    const missingRow = rowFor("Missing");
    const archivedRow = rowFor("Archived");
    expect(missingRow.querySelector(`a[href="/p/${missing.projectId}/"]`)).toBeNull();
    expect(archivedRow.querySelector(`a[href="/p/${archived.projectId}/"]`)).toBeNull();
    expect(missingRow.querySelector('[aria-label="Rename project Missing"]')).not.toBeNull();
    expect(missingRow.querySelector('[aria-label="Archive project Missing"]')).not.toBeNull();
    expect(archivedRow.querySelector('[aria-label="Rename project Archived"]')).not.toBeNull();
    expect(archivedRow.querySelector('[aria-label="Restore project Archived"]')).not.toBeNull();
    await act(async () => { (missingRow.querySelector('[aria-label="Rename project Missing"]') as HTMLButtonElement).click(); });
    expect(client.updateProject).toHaveBeenCalledWith(settings, missing.projectId, { displayName: "Missing renamed", expectedRevision: "1" });
    await act(async () => { (missingRow.querySelector('[aria-label="Archive project Missing"]') as HTMLButtonElement).click(); });
    expect(client.archiveProject).toHaveBeenCalledWith(settings, missing.projectId, "1");
    await act(async () => { (archivedRow.querySelector('[aria-label="Restore project Archived"]') as HTMLButtonElement).click(); });
    expect(client.restoreProject).toHaveBeenCalledWith(settings, archived.projectId, "1");
    expect(container.innerHTML).not.toContain(missing.rootPath);
    expect(container.innerHTML).not.toContain(archived.providerToken);
  });

  it("shows loading without a false empty state", async () => {
    const pending = deferred<Awaited<ReturnType<typeof client.listProjects>>>();
    vi.mocked(client.listProjects).mockReturnValue(pending.promise);
    const container = await render();
    expect(container.textContent).toContain("Loading projects");
    expect(container.textContent).not.toContain("Give your work a clear home");
    await act(async () => { pending.resolve({ ok: true, data: { projects: [], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } }); await pending.promise; });
  });

  it("shows a bounded registry error", async () => {
    vi.mocked(client.listProjects).mockResolvedValue({ ok: false, error: { status: "network", message: "/Users/private registry failed at port 8001" } });
    const container = await render();
    expect(container.textContent).toContain("Project registry unavailable");
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("8001");
  });

  it("lets a newer refresh win and aborts the older request", async () => {
    const older = deferred<Awaited<ReturnType<typeof client.listProjects>>>();
    const newer = deferred<Awaited<ReturnType<typeof client.listProjects>>>();
    vi.mocked(client.listProjects).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const container = await render();
    const olderSignal = vi.mocked(client.listProjects).mock.calls[0][1];
    await act(async () => { root?.render(<ProjectHub settings={{ ...settings, token: "new-session" }} navigate={() => undefined} />); });
    expect(olderSignal?.aborted).toBe(true);
    await act(async () => { newer.resolve({ ok: true, data: { projects: [summary("New")], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } }); await newer.promise; });
    await act(async () => { older.resolve({ ok: true, data: { projects: [summary("Old")], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } }); await older.promise; });
    expect(container.textContent).toContain("New");
    expect(container.textContent).not.toContain("Old");
  });

  it("navigates once on registration success and restores add-button focus", async () => {
    const project = summary("Home");
    vi.mocked(client.listProjects).mockResolvedValue({ ok: true, data: { projects: [], legacyUnscopedAvailable: false, cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "session", expiresAt: "2027-01-01T00:00:00Z", root: { handle: "root", displayName: "Home", selectable: true }, cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "session", directoryHandle: "root", expiresAt: "2027-01-01T00:00:00Z", entries: [], cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.registerProject).mockResolvedValue({ ok: true, data: project });
    const navigate = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectHub settings={settings} navigate={navigate} />); });
    const add = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Add local project") as HTMLButtonElement;
    await act(async () => { add.click(); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ kind: "project", projectId: project.projectId, page: "home" });
    expect(document.activeElement).toBe(add);
  });
});
