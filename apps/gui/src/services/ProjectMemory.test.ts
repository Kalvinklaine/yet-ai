import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectRuntimeSettings } from "./projectClient";
import { createProjectMemory, deleteProjectMemory, listProjectMemory, searchProjectMemory } from "./projectMemoryClient";

const fetchMock = vi.fn();
const projectId = "prj_abcdefghijklmnopqrstuv";

afterEach(() => vi.unstubAllGlobals());

describe("ProjectMemory", () => {
  it("uses only the explicit project memory URLs for CRUD, search, and delete", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ notes: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const settings = createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "" }, projectId);

    await listProjectMemory(settings);
    await createProjectMemory(settings, { title: "Note", text: "Body", tags: [], source: "manual" });
    await searchProjectMemory(settings, "Note");
    await deleteProjectMemory(settings, "shared-note");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `http://127.0.0.1:8001/p/${projectId}/v1/project-memory`,
      `http://127.0.0.1:8001/p/${projectId}/v1/project-memory`,
      `http://127.0.0.1:8001/p/${projectId}/v1/project-memory/search`,
      `http://127.0.0.1:8001/p/${projectId}/v1/project-memory/shared-note`,
    ]);
  });
});
