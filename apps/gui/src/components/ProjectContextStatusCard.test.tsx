import React, { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectChatContextController, ProjectChatContextStatus, ProjectContextStatusCard, type ProjectContextCardModel } from "./ProjectContextStatusCard";

const projectId = "prj_abcdefghijklmnopqrstuA";
const hash = `sha256:${"a".repeat(64)}`;
let root: ReactDOM.Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("ProjectContextStatusCard", () => {
  it.each([
    [{ status: "loading" }, "Loading local structural evidence"],
    [{ status: "error", message: "Project context status could not be loaded safely." }, "could not be loaded safely"],
    [ready("not_built", null), "Not initialized"],
    [ready("building", null), "Building"],
    [ready("stale", null), "Stale"],
    [ready("unavailable", null), "Error"],
  ] as Array<[ProjectContextCardModel, string]>)("renders an accessible state", (model, text) => {
    const container = render(model);
    expect(container.textContent).toContain(text);
    expect(container.querySelector("h2")?.textContent).toBe("Project Context");
  });

  it("explains bounded evidence and renders safe relative provenance", () => {
    const container = render(ready("ready", profile()));
    expect(container.textContent).toContain("not semantic indexing");
    expect(container.textContent).toContain("not automatically attached to chat");
    expect(container.textContent).toContain("Primary languages");
    expect(container.textContent).toContain("src/main.rs");
    expect(container.textContent).toContain("Watching for local changes");
    expect(container.textContent).not.toContain("/Users/");
    expect(container.textContent).not.toContain("secret-value");
  });

  it("rebuilds only after an explicit click and shows sanitized progress and errors", () => {
    const rebuild = vi.fn();
    const container = render(ready("ready", profile()), { onRebuild: rebuild, rebuilding: true, rebuildError: "Project context could not be rebuilt." });
    expect(rebuild).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Rebuilding…");
    expect(container.textContent).toContain("could not be rebuilt");
    act(() => { root?.render(<ProjectContextStatusCard model={ready("ready", profile())} rebuilding={false} rebuildError={null} onRebuild={rebuild} />); });
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Rebuild project context") as HTMLButtonElement).click());
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("renders one compact Balanced entrypoint with bounded metadata", () => {
    const context = ready("ready", profile());
    if (context.status !== "ready") throw new Error("expected ready context");
    const planning = {
      mode: "balanced", plan: null, view: null, state: "idle", loading: false, error: false, ready: true, selection: null,
      excluded: new Set<string>(), pinned: [], setMode: vi.fn(), refresh: vi.fn(), invalidate: vi.fn(), pin: vi.fn(), exclude: vi.fn(), useManualFallback: vi.fn(),
    } as any;
    const container = document.createElement("div"); document.body.append(container);
    act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectChatContextStatus context={context.context} planning={planning} />); });

    expect(container.querySelectorAll("[data-testid='project-context-entrypoint']")).toHaveLength(1);
    expect(container.textContent).toContain("Project context");
    expect(container.textContent).toContain("Balanced automatic");
    expect(container.querySelector("select")).toBeNull();
    act(() => (container.querySelector("button[aria-controls='project-chat-context-advanced']") as HTMLButtonElement).click());
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("balanced");
    expect(container.textContent).toContain("Cache generation 1");
  });

  it("polls an accepted rebuild through building to ready", async () => {
    vi.useFakeTimers();
    let statusCall = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/projects/")) return json(project());
      if (url.endsWith("/context/rebuild") && init?.method === "POST") return json(rebuild());
      if (url.endsWith("/context/plan") && init?.method === "POST") return json(contextPlan());
      if (url.endsWith("/context/status")) {
        statusCall += 1;
        return json(contextStatus(statusCall === 1 ? "not_built" : statusCall === 2 ? "building" : "ready"));
      }
      throw new Error(`unexpected ${url}`);
    }));
    const container = await renderController("Prompt");
    expect(container.textContent).toContain("Build project context");
    await act(async () => { findButton(container, "Build project context").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("Building the local project cache");
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("1 selected");
  });

  it("recovers an initially building context through bounded polling and fresh planning", async () => {
    vi.useFakeTimers();
    let statusCall = 0;
    const onReadyChange = vi.fn();
    const onSelectionChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/context/plan") && init?.method === "POST") return json(contextPlan());
      if (url.includes("/v1/projects/")) return json(project());
      if (url.endsWith("/context/status")) return json(contextStatus(statusCall++ === 0 ? "building" : "ready"));
      throw new Error(`unexpected ${url}`);
    }));
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectChatContextController projectId={projectId} chatId="chat-1" draft="Prompt" settings={settings} generationKey="1" onReadyChange={onReadyChange} onSelectionChange={onSelectionChange} />); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("Building the local project cache");
    expect(container.textContent).toContain("Refresh build status");
    expect(container.textContent).toContain("Use prompt only");

    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(container.textContent).toContain("1 selected");
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ manifestId: "manifest-plan-1" }));
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
  });

  it("bounds rebuild polling and leaves retry and prompt-only recovery visible", async () => {
    vi.useFakeTimers();
    let statusCall = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/projects/")) return json(project());
      if (url.endsWith("/context/rebuild") && init?.method === "POST") return json(rebuild());
      if (url.endsWith("/context/status")) return json(contextStatus(statusCall++ === 0 ? "not_built" : "building"));
      throw new Error(`unexpected ${url}`);
    }));
    const container = await renderController("Prompt", "not_built");
    await act(async () => { findButton(container, "Build project context").click(); await Promise.resolve(); await Promise.resolve(); });
    for (let index = 0; index < 12; index += 1) await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("taking too long");
    expect(container.textContent).toContain("Build project context");
    expect(container.textContent).toContain("Start without project context");
  });

  it("aborts stale status work on project switch and restores setup after leaving Manual-only", async () => {
    const secondProjectId = "prj_BBBBBBBBBBBBBBBBBBBBBQ";
    let firstSignal: AbortSignal | undefined;
    let resolveFirst!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/context/status") && url.includes(projectId)) {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      }
      return json(contextStatus("not_built", secondProjectId));
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = await renderController("Prompt");
    await act(async () => { root?.render(<ProjectChatContextController projectId={secondProjectId} chatId="chat-1" draft="Prompt" settings={settings} generationKey="2" />); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => resolveFirst(new Response(JSON.stringify(contextStatus("ready")), { status: 200 })));
    expect(container.textContent).toContain("Build project context");
    act(() => findButton(container, "Start without project context").click());
    act(() => (container.querySelector("button[aria-controls='project-chat-context-advanced']") as HTMLButtonElement).click());
    const select = container.querySelector("select") as HTMLSelectElement;
    act(() => { select.value = "balanced"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector("[data-testid='project-chat-context-setup']")).not.toBeNull();
  });
});

const settings = { baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" as const };

async function renderController(draft: string, initialState: "not_built" | "ready" = "not_built") {
  const container = document.createElement("div"); document.body.append(container);
  if (!(globalThis.fetch as any)?.mock) vi.stubGlobal("fetch", vi.fn(() => json(contextStatus(initialState))));
  await act(async () => { root = ReactDOM.createRoot(container); root.render(<ProjectChatContextController projectId={projectId} chatId="chat-1" draft={draft} settings={settings} generationKey="1" />); await Promise.resolve(); await Promise.resolve(); });
  return container;
}

function findButton(container: HTMLElement, text: string) { return Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text) as HTMLButtonElement; }
function json(value: unknown) { return Promise.resolve(new Response(JSON.stringify(value), { status: 200 })); }
function project() { return { projectId, displayName: "Test", status: "available", revision: "7", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" }; }
function rebuild() { return { protocolVersion: "2026-08-02", schemaVersion: 1, operationId: "context-rebuild-1", projectId, mode: "full", status: "accepted", expectedInventoryGeneration: 0, expectedProjectRevision: "7", cloudRequired: false }; }
function contextStatus(state: "not_built" | "building" | "ready", targetProjectId = projectId) { return { protocolVersion: "2026-08-02", schemaVersion: 1, projectId: targetProjectId, state, inventoryGeneration: state === "not_built" ? 0 : 1, cloudRequired: false, providerAccess: "direct" }; }
function contextPlan() { return { protocolVersion: "2026-08-02", schemaVersion: 1, planId: "plan-1", projectId, mode: "balanced", queryLabel: "Prompt", status: "ready", manifest: { protocolVersion: "2026-08-02", schemaVersion: 2, manifestId: "manifest-plan-1", projectId, planId: "plan-1", mode: "balanced", inventoryGeneration: 1, queryHash: hash, rankingVersion: "lexical-symbol-ranking-1", budget: { maxFiles: 12, maxChunks: 32, maxBytes: 131072, maxEstimatedTokens: 24000, usedFiles: 1, usedChunks: 1, usedBytes: 10, usedEstimatedTokens: 3, truncated: false }, entries: [{ kind: "file_chunk", chunkId: "chunk-1", sourceRef: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, contentHash: hash, inclusionReason: "lexical_match", provenance: "lexical", redaction: "none", byteCount: 10, estimatedTokens: 3, rank: 1 }], omissions: [], redaction: { metadataOnlyCount: 0, contentRedactedCount: 0, omittedCount: 0 }, createdAt: "2026-08-02T12:00:00Z" }, createdAt: "2026-08-02T12:00:00Z", expiresAt: "2026-08-02T12:05:00Z", cloudRequired: false }; }

function render(model: ProjectContextCardModel, overrides: Partial<React.ComponentProps<typeof ProjectContextStatusCard>> = {}) {
  const container = document.createElement("div"); document.body.append(container);
  act(() => { root = ReactDOM.createRoot(container); root.render(<ProjectContextStatusCard model={model} rebuilding={false} rebuildError={null} onRebuild={() => undefined} {...overrides} />); });
  return container;
}
function ready(state: "not_built" | "building" | "ready" | "stale" | "unavailable", value: ReturnType<typeof profile> | null): ProjectContextCardModel { return { status: "ready", context: { protocolVersion: "2026-08-02", schemaVersion: 1, projectId, state, inventoryGeneration: state === "not_built" ? 0 : 1, counts: { eligibleFiles: 3, indexedFiles: 2, omittedFiles: 1, chunks: 0, symbols: 0 }, progress: state === "not_built" ? undefined : { phase: "idle", completedFiles: 2, totalFiles: 3 }, cloudRequired: false, providerAccess: "direct" }, profile: value }; }
function profile() { return { protocolVersion: "2026-08-02" as const, schemaVersion: 1 as const, profileId: "profile-1", projectId, inventoryGeneration: 1, profileHash: hash, summary: "Local structural profile.", summaryProvenance: [{ sourceRef: "src/main.rs", contentHash: hash }], facts: [{ kind: "language" as const, label: "Rust source files", sourceRef: "src/main.rs", contentHash: hash, provenance: "structural_inventory" as const }], createdAt: "2026-08-02T12:00:00Z", cloudRequired: false as const }; }
