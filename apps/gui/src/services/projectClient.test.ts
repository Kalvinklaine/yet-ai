import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectRuntimeSettings, listProjects, registerProject, startDirectoryDiscovery } from "./projectClient";

const projectId = "prj_abcdefghijklmnopqrstuv";
const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("projectClient", () => {
  it("constructs explicit direct and same-origin project API bases", () => {
    expect(createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "secret", runtimeAccess: "direct" }, projectId)).toEqual({
      baseUrl: "http://127.0.0.1:8001", token: "secret", runtimeAccess: "direct", projectScope: { projectId }, apiBase: `/p/${projectId}/v1`,
    });
    expect(createProjectRuntimeSettings({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, projectId)).toEqual({
      baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy", projectScope: { projectId }, apiBase: `/p/${projectId}/v1`,
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

  it("does not install fetch or EventSource shims", () => {
    const beforeFetch = globalThis.fetch;
    const beforeEventSource = globalThis.EventSource;
    createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" }, projectId);
    expect(globalThis.fetch).toBe(beforeFetch);
    expect(globalThis.EventSource).toBe(beforeEventSource);
  });
});
