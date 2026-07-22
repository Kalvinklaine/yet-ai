import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRegistrationDialog } from "./ProjectRegistrationDialog";
import * as client from "../services/projectClient";

vi.mock("../services/projectClient", async (original) => ({ ...await original<typeof import("../services/projectClient")>(), startDirectoryDiscovery: vi.fn(), listDirectoryDiscovery: vi.fn(), registerProject: vi.fn() }));
const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const session = { ok: true as const, data: { sessionId: "pds_safe", expiresAt: "2027-01-01T00:00:00Z", root: { handle: "dir_root", displayName: "Home", selectable: true }, cloudRequired: false as const, providerAccess: "direct" as const } };
const listing = { ok: true as const, data: { sessionId: "pds_safe", directoryHandle: "dir_root", expiresAt: "2027-01-01T00:00:00Z", entries: [], cloudRequired: false as const, providerAccess: "direct" as const } };

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
    const project = { projectId: "prj_abcdefghijklmnopqrstuv" as client.ProjectSummary["projectId"], displayName: "Garden", status: "available" as const, revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false as const, providerAccess: "direct" as const };
    vi.mocked(client.registerProject).mockResolvedValue({ ok: true, data: project });
    const onRegistered = vi.fn(); const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectRegistrationDialog settings={settings} onClose={vi.fn()} onRegistered={onRegistered} />); });
    await act(async () => { (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Garden")) as HTMLButtonElement).click(); });
    expect(container.textContent).not.toContain("/Users/");
    await act(async () => { (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(client.registerProject).toHaveBeenCalledWith(settings, { displayName: "Garden", directorySessionId: "pds_safe", directoryHandle: "dir_child" }, expect.any(AbortSignal));
    expect(onRegistered).toHaveBeenCalledWith(project);
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
    await act(async () => { pending.resolve({ ok: true, data: { projectId: "prj_abcdefghijklmnopqrstuv" as client.ProjectSummary["projectId"], displayName: "Home", status: "available", revision: "1", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" } }); await pending.promise; });
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
