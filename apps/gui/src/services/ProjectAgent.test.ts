import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectRuntimeSettings } from "./projectClient";
import { getAgentProgress } from "./runtimeClient";

const fetchMock = vi.fn();

afterEach(() => vi.unstubAllGlobals());

describe("ProjectAgent", () => {
  it("loads overlapping run ids through their route project only", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ cloudRequired: false, providerAccess: "direct", snapshots: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ids = ["prj_abcdefghijklmnopqrstuv", "prj_bcdefghijklmnopqrstuvw"];

    for (const id of ids) await getAgentProgress(createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "" }, id));

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(ids.map((id) => `http://127.0.0.1:8001/p/${id}/v1/agent-progress`));
  });
});
