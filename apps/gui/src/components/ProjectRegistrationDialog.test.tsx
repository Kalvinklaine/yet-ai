import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRegistrationDialog } from "./ProjectRegistrationDialog";
import * as client from "../services/projectClient";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), startDirectoryDiscovery: vi.fn(), listDirectoryDiscovery: vi.fn(), registerProject: vi.fn(), rebindProject: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const session = { ok: true as const, data: { sessionId: "pds_safe", expiresAt: "2027-01-01T00:00:00Z", root: { handle: "dir_root", displayName: "Home", selectable: true }, cloudRequired: false as const, providerAccess: "direct" as const } };
const listing = { ok: true as const, data: { sessionId: "pds_safe", directoryHandle: "dir_root", expiresAt: "2027-01-01T00:00:00Z", entries: [], cloudRequired: false as const, providerAccess: "direct" as const } };
const project = { projectId: "prj_abcdefghijklmnopqrstuA" as client.ProjectSummary["projectId"], displayName: "Garden", status: "missing" as const, revision: "7", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: false, cloudRequired: false as const, providerAccess: "direct" as const };

describe("ProjectRegistrationDialog", () => {
  it("starts one discovery attempt for a double Retry click", async () => {
    const pending = deferred<Awaited<ReturnType<typeof client.startDirectoryDiscovery>>>();
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValueOnce({ ok: false, error: { status: "network", message: "offline" } }).mockReturnValueOnce(pending.promise);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={vi.fn()} />); });
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Retry discovery") as HTMLButtonElement;
    await act(async () => { retry.click(); retry.click(); });
    expect(client.startDirectoryDiscovery).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(session); await pending.promise; });
  });

  it("starts one list request for a double directory click", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue(session);
    const childListing = deferred<Awaited<ReturnType<typeof client.listDirectoryDiscovery>>>();
    vi.mocked(client.listDirectoryDiscovery)
      .mockResolvedValueOnce({ ...listing, data: { ...listing.data, entries: [{ handle: "dir_child", displayName: "Garden", selectable: true }] } })
      .mockReturnValueOnce(childListing.promise);
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={vi.fn()} />); });
    const directory = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Garden")) as HTMLButtonElement;
    await act(async () => { directory.click(); directory.click(); });
    expect(client.listDirectoryDiscovery).toHaveBeenCalledTimes(2);
    await act(async () => { childListing.resolve({ ...listing, data: { ...listing.data, directoryHandle: "dir_child" } }); await childListing.promise; });
  });

  it("allows a fresh retry after a terminal error", async () => {
    vi.mocked(client.startDirectoryDiscovery)
      .mockResolvedValueOnce({ ok: false, error: { status: "network", message: "offline" } })
      .mockResolvedValueOnce(session);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={vi.fn()} />); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Retry discovery") as HTMLButtonElement).click(); });
    expect(client.startDirectoryDiscovery).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Selected: Home");
  });

  it("starts one registration request for a double submit", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue(session);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    const pending = deferred<Awaited<ReturnType<typeof client.registerProject>>>();
    vi.mocked(client.registerProject).mockReturnValue(pending.promise);
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={vi.fn()} />); });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(client.registerProject).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve({ ok: false, error: { status: "network", message: "offline" } }); await pending.promise; });
  });

  it("navigates opaque entries and registers the selected directory", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue({ ok: true, data: { sessionId: "pds_safe", expiresAt: "2027-01-01T00:00:00Z", root: { handle: "dir_root", displayName: "Home", selectable: false }, cloudRequired: false, providerAccess: "direct" } });
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValueOnce({ ok: true, data: { sessionId: "pds_safe", directoryHandle: "dir_root", expiresAt: "2027-01-01T00:00:00Z", entries: [{ handle: "dir_child", displayName: "Garden", selectable: true }], cloudRequired: false, providerAccess: "direct" } }).mockResolvedValueOnce({ ok: true, data: { sessionId: "pds_safe", directoryHandle: "dir_child", expiresAt: "2027-01-01T00:00:00Z", entries: [], cloudRequired: false, providerAccess: "direct" } });
    const registeredProject = { ...project, status: "available" as const, revision: "1", rootAvailable: true };
    vi.mocked(client.registerProject).mockResolvedValue({ ok: true, data: registeredProject });
    const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={onRegistered} />); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Garden")) as HTMLButtonElement).click(); });
    expect(container.textContent).not.toContain("/Users/");
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(client.registerProject).toHaveBeenCalledWith(settings, { displayName: "Garden", directorySessionId: "pds_safe", directoryHandle: "dir_child" }, expect.any(AbortSignal));
    expect(onRegistered).toHaveBeenCalledWith(registeredProject);
  });

  it("rebinds an existing project with opaque identifiers and returns the updated summary", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue(session);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    const rebound = { ...project, status: "available" as const, revision: "8", rootAvailable: true };
    vi.mocked(client.rebindProject).mockResolvedValue({ ok: true, data: rebound });
    const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog mode="rebind" project={project} settings={settings} onClose={vi.fn()} onRegistered={onRegistered} />); });

    expect(container.textContent).toContain("Reconnect project directory");
    expect(container.textContent).toContain("Garden");
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("/Users/");
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(client.rebindProject).toHaveBeenCalledWith(settings, project.projectId, { expectedRevision: "7", directorySessionId: "pds_safe", directoryHandle: "dir_root" }, expect.any(AbortSignal));
    expect(client.registerProject).not.toHaveBeenCalled();
    expect(onRegistered).toHaveBeenCalledWith(rebound);
  });

  it.each([
    { runtimeError: { status: 409, message: "revision conflict /Users/private" }, recovery: "The saved project state changed", action: "Close and refresh Projects" },
    { runtimeError: { status: 404, message: "Project not found. /Users/private" }, recovery: "The saved project state changed", action: "Close and refresh Projects" },
    { runtimeError: { status: 409, message: "Project is archived. /Users/private" }, recovery: "The saved project state changed", action: "Close and refresh Projects" },
  ] as const)("uses explicit parent recovery for $runtimeError", async ({ runtimeError, recovery, action }) => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue(session);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    vi.mocked(client.rebindProject).mockResolvedValue({ ok: false, error: runtimeError });
    const onProjectStateChanged = vi.fn(); const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog mode="rebind" project={project} settings={settings} onClose={vi.fn()} onProjectStateChanged={onProjectStateChanged} onRegistered={onRegistered} />); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(container.textContent).toContain(recovery);
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("Retry discovery");
    expect(container.textContent).not.toContain("Start a new session");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === action) as HTMLButtonElement).click(); });
    expect(onProjectStateChanged).toHaveBeenCalledOnce();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it.each([
    { runtimeError: { status: 410, message: "expired handle /Users/private" }, recovery: "Start a fresh session and choose the directory again.", action: "Start a new session" },
    { runtimeError: { status: 403, message: "unsafe filesystem /Users/private" }, recovery: "cannot safely access that directory", action: "Retry discovery" },
  ] as const)("retains discovery recovery for $runtimeError", async ({ runtimeError, recovery, action }) => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValueOnce(session).mockResolvedValueOnce(session);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    vi.mocked(client.rebindProject).mockResolvedValue({ ok: false, error: runtimeError });
    const onProjectStateChanged = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog mode="rebind" project={project} settings={settings} onClose={vi.fn()} onProjectStateChanged={onProjectStateChanged} onRegistered={vi.fn()} />); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

    expect(container.textContent).toContain(recovery);
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("Close and refresh Projects");
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === action) as HTMLButtonElement).click(); });
    expect(client.startDirectoryDiscovery).toHaveBeenCalledTimes(2);
    expect(onProjectStateChanged).not.toHaveBeenCalled();
  });

  it("ignores and aborts a late rebind success after cancel", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue(session);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    const pending = deferred<Awaited<ReturnType<typeof client.rebindProject>>>();
    vi.mocked(client.rebindProject).mockReturnValue(pending.promise);
    const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog mode="rebind" project={project} settings={settings} onClose={vi.fn()} onRegistered={onRegistered} />); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const signal = vi.mocked(client.rebindProject).mock.calls[0][3];
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Cancel") as HTMLButtonElement).click(); });
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve({ ok: true, data: { ...project, status: "available", revision: "8", rootAvailable: true } }); await pending.promise; });
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("maps an escape rejection to safe copy", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue({ ok: false, error: { status: 400, message: "escape /Users/private" } });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={vi.fn()} />); });
    expect(container.textContent).toContain("outside the allowed local directory area");
    expect(container.textContent).not.toContain("/Users/private");
  });

  it("ignores a late registration success after cancel", async () => {
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue(session);
    vi.mocked(client.listDirectoryDiscovery).mockResolvedValue(listing);
    const pending = deferred<Awaited<ReturnType<typeof client.registerProject>>>();
    vi.mocked(client.registerProject).mockReturnValue(pending.promise);
    const onClose = vi.fn(); const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={onClose} onRegistered={onRegistered} />); });
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const signal = vi.mocked(client.registerProject).mock.calls[0][2];
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Cancel") as HTMLButtonElement).click(); });
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve({ ok: true, data: { projectId: "prj_abcdefghijklmnopqrstuA" as client.ProjectSummary["projectId"], displayName: "Home", status: "available", revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" } }); await pending.promise; });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("ignores session creation after Escape", async () => {
    const pending = deferred<Awaited<ReturnType<typeof client.startDirectoryDiscovery>>>();
    vi.mocked(client.startDirectoryDiscovery).mockReturnValue(pending.promise);
    const onClose = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={onClose} onRegistered={vi.fn()} />); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(vi.mocked(client.startDirectoryDiscovery).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => { pending.resolve(session); await pending.promise; });
    expect(client.listDirectoryDiscovery).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores a pending directory list after close and unmount", async () => {
    const pending = deferred<Awaited<ReturnType<typeof client.listDirectoryDiscovery>>>();
    vi.mocked(client.startDirectoryDiscovery).mockResolvedValue(session);
    vi.mocked(client.listDirectoryDiscovery).mockReturnValue(pending.promise);
    const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={onRegistered} />); });
    const signal = vi.mocked(client.listDirectoryDiscovery).mock.calls[0][3];
    await act(async () => { (container.querySelector('[aria-label="Close Add local project dialog"]') as HTMLButtonElement).click(); root?.unmount(); root = undefined; });
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(listing); await pending.promise; });
    expect(onRegistered).not.toHaveBeenCalled();
  });
});
