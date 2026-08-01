import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveProject, createProjectRuntimeSettings, listDirectoryDiscovery, listProjects, rebindProject, registerProject, restoreProject, startDirectoryDiscovery } from "./projectClient";

const projectId = "prj_abcdefghijklmnopqrstuA";
const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("projectClient", () => {
  it("constructs explicit direct and same-origin project API bases", () => {
    expect(createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "secret", runtimeAccess: "direct" }, projectId)).toMatchObject({
      baseUrl: "http://127.0.0.1:8001", token: "secret", runtimeAccess: "direct", projectScope: { projectId, generation: 0 }, apiBase: `/p/${projectId}/v1`,
    });
    expect(createProjectRuntimeSettings({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, projectId)).toMatchObject({
      baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy", projectScope: { projectId, generation: 0 }, apiBase: `/p/${projectId}/v1`,
    });
    expect(() => createProjectRuntimeSettings({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, "../root")).toThrow("Invalid project id");
  });

  it("keeps project controls and discovery on global /v1", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost:3000/projects"));
    const settings = createProjectRuntimeSettings({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, projectId);

    await listProjects(settings);
    await registerProject(settings, { displayName: "Local", directorySessionId: "pds_0123456789abcdef0123456789abcdef", directoryHandle: "dir_0123456789abcdef0123456789abcdef" });
    await startDirectoryDiscovery(settings);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/v1/projects", "/v1/projects", "/v1/project-browser/sessions"]);
  });

  it("forwards cancellation signals for registration and discovery", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost:3000/projects"));
    const controller = new AbortController();

    await registerProject({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, { displayName: "Local", directorySessionId: "session", directoryHandle: "root" }, controller.signal);
    await startDirectoryDiscovery({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, controller.signal);
    await listDirectoryDiscovery({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, "session", "root", controller.signal);

    expect(fetchMock.mock.calls.map(([, init]) => init.signal)).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it("rebinds through the strict project route with only opaque request fields", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ projectId }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost:3000/projects"));
    const controller = new AbortController();

    await rebindProject(
      { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" },
      projectId,
      { expectedRevision: "7", directorySessionId: "pds_safe", directoryHandle: "dir_safe", path: "/Users/private" } as { expectedRevision: string; directorySessionId: string; directoryHandle: string },
      controller.signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(`/v1/projects/${projectId}/rebind`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedRevision: "7", directorySessionId: "pds_safe", directoryHandle: "dir_safe" }),
      signal: expect.any(AbortSignal),
    }));
    expect(fetchMock.mock.calls[0][1].signal).not.toBe(controller.signal);
    expect(fetchMock.mock.calls[0][1].body).not.toContain("path");
    expect(fetchMock.mock.calls[0][1].body).not.toContain("/Users/private");
    expect(() => rebindProject({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, "../root", { expectedRevision: "7", directorySessionId: "pds_safe", directoryHandle: "dir_safe" })).toThrow("Invalid project id");
  });

  it("uses the dedicated lifecycle response contract for archive and restore", async () => {
    const lifecycle = { projectId, status: "archived", revision: "2", rootAvailable: true, updatedAt: "2026-07-21T13:00:00.000000Z" };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(lifecycle), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await archiveProject({ baseUrl: "http://127.0.0.1:8001", token: "secret", runtimeAccess: "direct" }, projectId, "1")).toEqual({ ok: true, data: lifecycle });
    await restoreProject({ baseUrl: "http://127.0.0.1:8001", token: "secret", runtimeAccess: "direct" }, projectId, "2");

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      [`http://127.0.0.1:8001/v1/projects/${projectId}/archive`, "POST", JSON.stringify({ expectedRevision: "1" })],
      [`http://127.0.0.1:8001/v1/projects/${projectId}/restore`, "POST", JSON.stringify({ expectedRevision: "2" })],
    ]);
  });

  it("does not install fetch or EventSource shims", () => {
    const beforeFetch = globalThis.fetch;
    const beforeEventSource = globalThis.EventSource;
    createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" }, projectId);
    expect(globalThis.fetch).toBe(beforeFetch);
    expect(globalThis.EventSource).toBe(beforeEventSource);
  });
});
