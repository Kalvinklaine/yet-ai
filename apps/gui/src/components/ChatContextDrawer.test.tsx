import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatContextDrawer } from "./ChatContextDrawer";

const projectId = "prj_abcdefghijklmnopqrstuA";
const hash = `sha256:${"a".repeat(64)}`;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); });

function response(value: unknown) { return Promise.resolve(new Response(JSON.stringify(value), { status: 200 })); }
function plan() { return { protocolVersion: "2026-08-02", schemaVersion: 1, planId: "plan-1", projectId, mode: "balanced", queryLabel: "Find start", status: "ready", manifest: { protocolVersion: "2026-08-02", schemaVersion: 1, manifestId: "manifest-1", projectId, planId: "plan-1", mode: "balanced", inventoryGeneration: 3, queryHash: hash, rankingVersion: "lexical-symbol-ranking-1", budget: { maxFiles: 12, maxChunks: 32, maxBytes: 131072, maxEstimatedTokens: 24000, usedFiles: 1, usedChunks: 1, usedBytes: 100, usedEstimatedTokens: 25, truncated: false }, entries: [{ kind: "file_chunk", chunkId: "chunk-1", sourceRef: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 4, character: 2 } }, contentHash: hash, inclusionReason: "lexical_match", provenance: "lexical", redaction: "none", byteCount: 100, estimatedTokens: 25, rank: 1 }], omissions: [], redaction: { metadataOnlyCount: 0, contentRedactedCount: 0, omittedCount: 0 }, createdAt: "2026-08-02T12:00:00Z" }, createdAt: "2026-08-02T12:00:00Z", expiresAt: "2026-08-02T12:05:00Z", cloudRequired: false }; }

async function render(onSelectionChange?: (selection: any) => void) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(<ChatContextDrawer projectId={projectId} chatId="chat-1" draft="Find start" settings={{ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }} generationKey="1" onSelectionChange={onSelectionChange} />));
}

describe("ChatContextDrawer", () => {
  it("loads an accessible metadata preview and invalidates selection synchronously on controls", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ projectId, displayName: "Test", status: "available", revision: "7", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" }))
      .mockImplementationOnce(() => response({ protocolVersion: "2026-08-02", schemaVersion: 1, projectId, state: "ready", inventoryGeneration: 3, cloudRequired: false, providerAccess: "direct" }))
      .mockImplementationOnce(() => response(plan()));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));
    const onSelectionChange = vi.fn();
    const onReadyChange = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(<ChatContextDrawer projectId={projectId} chatId="chat-1" draft="Find start" settings={{ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }} generationKey="1" onSelectionChange={onSelectionChange} onReadyChange={onReadyChange} />));
    await act(async () => { vi.advanceTimersByTime(350); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const toggle = container.querySelector("button[aria-controls='chat-context-drawer-panel']") as HTMLButtonElement;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("src/main.ts");
    expect(container.textContent).not.toContain(hash);
    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => (buttons.find((button) => button.textContent === "Remove") as HTMLButtonElement).click());
    expect(onSelectionChange).toHaveBeenNthCalledWith(onSelectionChange.mock.calls.length - 1, null);
    expect(container.textContent).toContain("removed_by_user");
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ excludedSources: [{ kind: "file_chunk", chunkId: "chunk-1", contentHash: hash }], manifestId: "manifest-1" }));
    act(() => (buttons.find((button) => button.textContent === "Send with manual-only") as HTMLButtonElement).click());
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("manual_only");
    expect(container.textContent).not.toContain("Refreshing context…");
    expect(container.textContent).toContain("Refresh context");
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });

  it("ignores a stale result after correlation changes", async () => {
    let resolvePlan!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ projectId, displayName: "Test", status: "available", revision: "7", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" }))
      .mockImplementationOnce(() => response({ protocolVersion: "2026-08-02", schemaVersion: 1, projectId, state: "ready", inventoryGeneration: 3, cloudRequired: false, providerAccess: "direct" }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePlan = resolve; }));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));
    await render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 380)); });
    await act(async () => root?.render(<ChatContextDrawer projectId={projectId} chatId="chat-2" draft="Different" settings={{ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }} generationKey="2" />));
    await act(async () => resolvePlan(new Response(JSON.stringify(plan()), { status: 200 })));
    act(() => (container.querySelector("button[aria-controls='chat-context-drawer-panel']") as HTMLButtonElement).click());
    expect(container.textContent).not.toContain("src/main.ts");
  });

  it("keeps one exact same-file chunk removed across a replan without removing its sibling", async () => {
    vi.useFakeTimers();
    const secondHash = `sha256:${"b".repeat(64)}`;
    const entries = [
      { kind: "file_chunk", chunkId: "chunk-1", sourceRef: "src/shared.ts", range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } }, contentHash: hash, inclusionReason: "lexical_match", provenance: "lexical", redaction: "none", byteCount: 80, estimatedTokens: 20, rank: 1 },
      { kind: "file_chunk", chunkId: "chunk-2", sourceRef: "src/shared.ts", range: { start: { line: 5, character: 0 }, end: { line: 9, character: 0 } }, contentHash: secondHash, inclusionReason: "lexical_match", provenance: "lexical", redaction: "none", byteCount: 80, estimatedTokens: 20, rank: 2 },
    ];
    const replanned = structuredClone(plan());
    replanned.planId = "plan-2"; replanned.mode = "deep"; replanned.manifest.planId = "plan-2"; replanned.manifest.manifestId = "manifest-2"; replanned.manifest.mode = "deep";
    replanned.manifest.entries = [{ ...entries[1], rank: 1 }, { ...entries[0], rank: 2 }];
    const initial = structuredClone(plan()); initial.manifest.entries = entries; initial.manifest.budget.usedChunks = 2;
    const project = { projectId, displayName: "Test", status: "available", revision: "7", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" };
    const status = { protocolVersion: "2026-08-02", schemaVersion: 1, projectId, state: "ready", inventoryGeneration: 3, cloudRequired: false, providerAccess: "direct" };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(project)).mockImplementationOnce(() => response(status)).mockImplementationOnce(() => response(initial))
      .mockImplementationOnce(() => response(project)).mockImplementationOnce(() => response(status)).mockImplementationOnce(() => response(replanned));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));
    const onSelectionChange = vi.fn();
    await render(onSelectionChange);
    await act(async () => { vi.advanceTimersByTime(350); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    act(() => (container.querySelector("button[aria-controls='chat-context-drawer-panel']") as HTMLButtonElement).click());
    const removeButtons = Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Remove");
    act(() => removeButtons[0].click());
    expect(container.textContent?.match(/src\/shared\.ts/g)).toHaveLength(2);
    act(() => { const select = container.querySelector("select") as HTMLSelectElement; select.value = "deep"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { vi.advanceTimersByTime(350); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const selection = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1]?.[0];
    expect(selection).toMatchObject({ manifestId: "manifest-2", excludedSources: [{ kind: "file_chunk", chunkId: "chunk-1", contentHash: hash }] });
    const included = container.querySelectorAll("ul")[0].textContent ?? "";
    expect(included).toContain("6:1–10:1");
    expect(included).not.toContain("1:1–5:1");
  });
});
