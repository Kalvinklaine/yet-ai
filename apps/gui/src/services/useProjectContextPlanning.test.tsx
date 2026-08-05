import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectContextPlanningSelection, RuntimeSettings } from "./runtimeClient";
import { useProjectContextPlanning } from "./useProjectContextPlanning";

const projectId = "prj_abcdefghijklmnopqrstuA";
const otherProjectId = "prj_abcdefghijklmnopqrstuB";
const hash = `sha256:${"a".repeat(64)}`;
let root: Root | undefined;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function response(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
}

function project(targetProjectId = projectId) {
  return { projectId: targetProjectId, displayName: "Test", status: "available", revision: "7", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
}

function status(targetProjectId = projectId) {
  return { protocolVersion: "2026-08-02", schemaVersion: 1, projectId: targetProjectId, state: "ready", inventoryGeneration: 3, cloudRequired: false, providerAccess: "direct" };
}

function plan(mode: "manual_only" | "balanced" | "deep" = "balanced", planId = "plan-1", targetProjectId = projectId) {
  return { protocolVersion: "2026-08-02", schemaVersion: 1, planId, projectId: targetProjectId, mode, queryLabel: "Find start", status: "ready", manifest: { protocolVersion: "2026-08-02", schemaVersion: 1, manifestId: `manifest-${planId}`, projectId: targetProjectId, planId, mode, inventoryGeneration: 3, queryHash: hash, rankingVersion: "lexical-symbol-ranking-1", budget: { maxFiles: 12, maxChunks: 32, maxBytes: 131072, maxEstimatedTokens: 24000, usedFiles: 1, usedChunks: 1, usedBytes: 100, usedEstimatedTokens: 25, truncated: false }, entries: [{ kind: "file_chunk", chunkId: "chunk-1", sourceRef: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 4, character: 2 } }, contentHash: hash, inclusionReason: "lexical_match", provenance: "lexical", redaction: "none", byteCount: 100, estimatedTokens: 25, rank: 1 }], omissions: [], redaction: { metadataOnlyCount: 0, contentRedactedCount: 0, omittedCount: 0 }, createdAt: "2026-08-02T12:00:00Z" }, createdAt: "2026-08-02T12:00:00Z", expiresAt: "2026-08-02T12:05:00Z", cloudRequired: false };
}

type HarnessProps = {
  projectId: string;
  chatId: string | null;
  draft: string;
  settings: RuntimeSettings;
  generationKey: string;
  onSelectionChange?: (selection: ProjectContextPlanningSelection | null) => void;
  onReadyChange?: (ready: boolean) => void;
};

function Harness(props: HarnessProps) {
  const planning = useProjectContextPlanning(props);
  return <div>
    <span data-testid="mode">{planning.mode}</span>
    <span data-testid="state">{planning.state}</span>
    <span data-testid="selection">{planning.selection?.manifestId ?? "none"}</span>
    <span data-testid="ready">{String(planning.ready)}</span>
    <span data-testid="pinned">{planning.pinned.length}</span>
    <button type="button" onClick={() => planning.setMode("deep")}>deep</button>
    <button type="button" onClick={() => planning.exclude(planning.view?.included[0]?.key ?? "")}>exclude</button>
    <button type="button" onClick={() => planning.pin(planning.view?.included[0]?.key ?? "")}>pin</button>
  </div>;
}

async function renderHarness(props: HarnessProps) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(<Harness {...props} />));
}

async function advancePlanning() {
  await act(async () => {
    vi.advanceTimersByTime(350);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useProjectContextPlanning", () => {
  it("does not restart pending planning when rerendered with equivalent fresh settings", async () => {
    vi.useFakeTimers();
    let resolvePlan!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(project()))
      .mockImplementationOnce(() => response(status()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePlan = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost/projects"));
    const onSelectionChange = vi.fn();
    const base = { projectId, chatId: "chat-1", draft: "Find start", generationKey: "1", onSelectionChange };
    await renderHarness({ ...base, settings: { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" } });
    await advancePlanning();
    expect(container.querySelector("[data-testid='state']")?.textContent).toBe("loading");
    await renderHarness({ ...base, settings: { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" } });
    await act(async () => resolvePlan(new Response(JSON.stringify(plan()), { status: 200 })));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[data-testid='selection']")?.textContent).toBe("manifest-plan-1");
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ manifestId: "manifest-plan-1" }));
  });

  it("plans once for the same draft in a new chat and publishes the new correlation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(project()))
      .mockImplementationOnce(() => response(status()))
      .mockImplementationOnce(() => response(plan("balanced", "plan-1")))
      .mockImplementationOnce(() => response(project()))
      .mockImplementationOnce(() => response(status()))
      .mockImplementationOnce(() => response(plan("balanced", "plan-2")));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost/projects"));
    const onSelectionChange = vi.fn();
    const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
    await renderHarness({ projectId, chatId: "chat-1", draft: "Find start", settings, generationKey: "1", onSelectionChange });
    await advancePlanning();
    await renderHarness({ projectId, chatId: "chat-2", draft: "Find start", settings: { ...settings }, generationKey: "1", onSelectionChange });
    expect(container.querySelector("[data-testid='selection']")?.textContent).toBe("none");
    await advancePlanning();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      manifestId: "manifest-plan-2",
      correlation: expect.objectContaining({ chatId: "chat-2", settingsGeneration: "1" }),
    }));
  });

  it("plans once for a new generation and publishes the new correlation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(project()))
      .mockImplementationOnce(() => response(status()))
      .mockImplementationOnce(() => response(plan("balanced", "plan-1")))
      .mockImplementationOnce(() => response(project()))
      .mockImplementationOnce(() => response(status()))
      .mockImplementationOnce(() => response(plan("balanced", "plan-2")));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost/projects"));
    const onSelectionChange = vi.fn();
    const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
    await renderHarness({ projectId, chatId: "chat-1", draft: "Find start", settings, generationKey: "1", onSelectionChange });
    await advancePlanning();
    await renderHarness({ projectId, chatId: "chat-1", draft: "Find start", settings: { ...settings }, generationKey: "2", onSelectionChange });
    expect(container.querySelector("[data-testid='selection']")?.textContent).toBe("none");
    await advancePlanning();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      manifestId: "manifest-plan-2",
      correlation: expect.objectContaining({ chatId: "chat-1", settingsGeneration: "2" }),
    }));
  });

  it("publishes an excluded selection and restores readiness", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(project()))
      .mockImplementationOnce(() => response(status()))
      .mockImplementationOnce(() => response(plan()));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost/projects"));
    const onSelectionChange = vi.fn();
    const onReadyChange = vi.fn();
    const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
    await renderHarness({ projectId, chatId: "chat-1", draft: "Find start", settings, generationKey: "1", onSelectionChange, onReadyChange });
    await advancePlanning();
    const buttons = container.querySelectorAll("button");
    act(() => buttons[1].click());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[data-testid='ready']")?.textContent).toBe("true");
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      manifestId: "manifest-plan-1",
      excludedSources: [{ kind: "file_chunk", chunkId: "chunk-1", contentHash: hash }],
    }));
  });

  it("keeps mode across chats in one project and resets it on project change without storage", async () => {
    vi.useFakeTimers();
    const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
    await renderHarness({ projectId, chatId: "chat-1", draft: "", settings, generationKey: "1" });
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(container.querySelector("[data-testid='mode']")?.textContent).toBe("deep");
    await renderHarness({ projectId, chatId: "chat-2", draft: "", settings: { ...settings }, generationKey: "2" });
    expect(container.querySelector("[data-testid='mode']")?.textContent).toBe("deep");
    await renderHarness({ projectId: otherProjectId, chatId: "chat-3", draft: "", settings: { ...settings }, generationKey: "3" });
    expect(container.querySelector("[data-testid='mode']")?.textContent).toBe("balanced");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects a stale plan after draft and generation correlation change", async () => {
    vi.useFakeTimers();
    let resolvePlan!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(project()))
      .mockImplementationOnce(() => response(status()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePlan = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost/projects"));
    const onSelectionChange = vi.fn();
    const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
    await renderHarness({ projectId, chatId: "chat-1", draft: "Find start", settings, generationKey: "1", onSelectionChange });
    await advancePlanning();
    await renderHarness({ projectId, chatId: "chat-1", draft: "Different", settings: { ...settings }, generationKey: "2", onSelectionChange });
    await act(async () => resolvePlan(new Response(JSON.stringify(plan()), { status: 200 })));
    expect(container.querySelector("[data-testid='selection']")?.textContent).toBe("none");
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it("sends pinned explicit refs into the next plan without browser storage", async () => {
    vi.useFakeTimers();
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const mode = requests.length === 1 ? "balanced" : "deep";
        return new Response(JSON.stringify(plan(mode, `plan-${requests.length}`)), { status: 200 });
      }
      return new Response(JSON.stringify(url.includes("/v1/projects/") ? project() : status()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost/projects"));
    const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };
    await renderHarness({ projectId, chatId: "chat-1", draft: "Find start", settings, generationKey: "1" });
    await advancePlanning();
    const buttons = container.querySelectorAll("button");
    act(() => buttons[2].click());
    expect(container.querySelector("[data-testid='pinned']")?.textContent).toBe("1");
    await act(async () => { await Promise.resolve(); });
    await advancePlanning();
    expect(requests[1]).toMatchObject({ explicitRefs: [{ kind: "file_chunk", chunkId: "chunk-1", sourceRef: "src/main.ts", contentHash: hash }] });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
