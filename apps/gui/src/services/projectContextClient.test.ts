import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectRuntimeSettings } from "./projectClient";
import { getProjectContextProfile, getProjectContextStatus, rebuildProjectContext } from "./projectContextClient";

const projectId = "prj_abcdefghijklmnopqrstuA";
const settings = createProjectRuntimeSettings({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, projectId);
const fetchMock = vi.fn();
const hash = `sha256:${"a".repeat(64)}`;

afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });

describe("projectContextClient", () => {
  it("uses only strict project-scoped status, profile, and rebuild routes", async () => {
    fetchMock
      .mockResolvedValueOnce(json(status()))
      .mockResolvedValueOnce(json(profile()))
      .mockResolvedValueOnce(json({ protocolVersion: "2026-08-02", schemaVersion: 1, operationId: "context-rebuild-2", projectId, mode: "full", status: "accepted", expectedInventoryGeneration: 1, expectedProjectRevision: "7", cloudRequired: false }));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));

    expect((await getProjectContextStatus(settings)).ok).toBe(true);
    expect((await getProjectContextProfile(settings)).ok).toBe(true);
    expect((await rebuildProjectContext(settings, { expectedInventoryGeneration: 1, expectedProjectRevision: "7" })).ok).toBe(true);

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      [`/p/${projectId}/v1/context/status`, undefined, undefined],
      [`/p/${projectId}/v1/context/profile`, undefined, undefined],
      [`/p/${projectId}/v1/context/rebuild`, "POST", JSON.stringify({ mode: "full", expectedInventoryGeneration: 1, expectedProjectRevision: "7" })],
    ]);
  });

  it("rejects unknown fields, canonical paths, and cross-project payloads", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ...status(), root: "/Users/private" }))
      .mockResolvedValueOnce(json({ ...profile(), facts: [{ ...profile().facts[0], sourceRef: "/Users/private/main.rs" }] }))
      .mockResolvedValueOnce(json({ ...status(), projectId: "prj_AbCdEfGhIjKlMnOpQrStUA" }));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));

    expect(await getProjectContextStatus(settings)).toMatchObject({ ok: false, error: { status: "protocol" } });
    expect(await getProjectContextProfile(settings)).toMatchObject({ ok: false, error: { status: "protocol" } });
    const other = await getProjectContextStatus(settings);
    expect(other).toMatchObject({ ok: false, error: { status: "protocol" } });
  });

  it("uses canonical project ids and permits vocabulary without permitting secret shapes", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ...status(), projectId: "prj_abcdefghijklmnopqrstuB" }))
      .mockResolvedValueOnce(json({ ...profile(), facts: [{ ...profile().facts[0], label: "Authentication token parser" }] }))
      .mockResolvedValueOnce(json({ ...profile(), facts: [{ ...profile().facts[0], label: "token=placeholder" }] }));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));

    expect(await getProjectContextStatus(settings)).toMatchObject({ ok: false, error: { status: "protocol" } });
    expect((await getProjectContextProfile(settings)).ok).toBe(true);
    expect(await getProjectContextProfile(settings)).toMatchObject({ ok: false, error: { status: "protocol" } });
  });

  it("forwards the project lifecycle abort signal", async () => {
    fetchMock.mockResolvedValue(json(status()));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));
    await getProjectContextStatus(settings);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

function status() { return { protocolVersion: "2026-08-02", schemaVersion: 1, projectId, state: "ready", inventoryGeneration: 1, profileId: "profile-1", counts: { eligibleFiles: 3, indexedFiles: 2, omittedFiles: 1, chunks: 0, symbols: 0 }, freshness: { status: "current", pendingChanges: 0 }, cloudRequired: false, providerAccess: "direct" }; }
function profile() { return { protocolVersion: "2026-08-02", schemaVersion: 1, profileId: "profile-1", projectId, inventoryGeneration: 1, profileHash: hash, summary: "Local project profile derived from structural inventory evidence.", summaryProvenance: [{ sourceRef: "src/main.rs", contentHash: hash }], facts: [{ kind: "language", label: "Rust source files", sourceRef: "src/main.rs", contentHash: hash, provenance: "structural_inventory" }], createdAt: "2026-08-02T12:00:00Z", cloudRequired: false }; }
function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }); }
