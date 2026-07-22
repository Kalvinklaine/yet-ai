import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRegistrationDialog } from "./ProjectRegistrationDialog";
import * as client from "../services/projectClient";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), startDirectoryDiscovery: vi.fn(), listDirectoryDiscovery: vi.fn(), registerProject: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("ProjectRegistrationDialog", () => {
  it("navigates opaque entries and registers the selected directory", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "pds_safe", expiresAt: "2027-01-01T00:00:00Z", root: { handle: "dir_root", displayName: "Home", selectable: false }, cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValueOnce({ ok: true, data: { sessionId: "pds_safe", directoryHandle: "dir_root", expiresAt: "2027-01-01T00:00:00Z", entries: [{ handle: "dir_child", displayName: "Garden", selectable: true }], cloudRequired: false, providerAccess: "direct" } }).mockResolvedValueOnce({ ok: true, data: { sessionId: "pds_safe", directoryHandle: "dir_child", expiresAt: "2027-01-01T00:00:00Z", entries: [], cloudRequired: false, providerAccess: "direct" } });
    const project = { projectId: "prj_abcdefghijklmnopqrstuv" as client.ProjectSummary["projectId"], displayName: "Garden", status: "available" as const, revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false as const, providerAccess: "direct" as const };
    vi.mocked(client.registerProject).mockResolvedValue({ ok: true, data: project });
    const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={onRegistered} />); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Garden")) as HTMLButtonElement).click(); });
    expect(container.textContent).not.toContain("/Users/");
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(client.registerProject).toHaveBeenCalledWith(settings, { displayName: "Garden", directorySessionId: "pds_safe", directoryHandle: "dir_child" });
    expect(onRegistered).toHaveBeenCalledWith(project);
  });

  it("maps an escape rejection to safe copy", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue({ ok: false, error: { status: 400, message: "escape /Users/private" } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={vi.fn()} />); });
    expect(container.textContent).toContain("outside the allowed local directory area");
    expect(container.textContent).not.toContain("/Users/private");
  });
});
