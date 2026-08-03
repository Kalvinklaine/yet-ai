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
function plan() { return { protocolVersion: "2026-08-02", schemaVersion: 1, planId: "plan-1", projectId, mode: "balanced", queryLabel: "Find start", status: "ready", manifest: { protocolVersion: "2026-08-02", schemaVersion: 1, manifestId: "manifest-1", projectId, planId: "plan-1", mode: "balanced", inventoryGeneration: 3, queryHash: hash, rankingVersion: "lexical-symbol-ranking-1", budget: { maxFiles: 12, maxChunks: 32, maxBytes: 131072, maxEstimatedTokens: 24000, usedFiles: 1, usedChunks: 1, usedBytes: 100, usedEstimatedTokens: 25, truncated: false }, entries: [{ kind: "file_chunk", sourceRef: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 4, character: 2 } }, contentHash: hash, inclusionReason: "lexical_match", provenance: "lexical", redaction: "none", byteCount: 100, estimatedTokens: 25, rank: 1 }], omissions: [], redaction: { metadataOnlyCount: 0, contentRedactedCount: 0, omittedCount: 0 }, createdAt: "2026-08-02T12:00:00Z" }, createdAt: "2026-08-02T12:00:00Z", expiresAt: "2026-08-02T12:05:00Z", cloudRequired: false }; }

async function render() {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(<ChatContextDrawer projectId={projectId} chatId="chat-1" draft="Find start" settings={{ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }} generationKey="1" />));
}

describe("ChatContextDrawer", () => {
  it("loads an accessible metadata preview and supports remove, pin, and manual-only", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ projectId, displayName: "Test", status: "available", revision: "7", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, rootAvailable: true, cloudRequired: false, providerAccess: "direct" }))
      .mockImplementationOnce(() => response({ protocolVersion: "2026-08-02", schemaVersion: 1, projectId, state: "ready", inventoryGeneration: 3, cloudRequired: false, providerAccess: "direct" }))
      .mockImplementationOnce(() => response(plan()));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("location", new URL("http://localhost/projects"));
    await render();
    await act(async () => { vi.advanceTimersByTime(350); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const toggle = container.querySelector("button[aria-controls='chat-context-drawer-panel']") as HTMLButtonElement;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("src/main.ts");
    expect(container.textContent).not.toContain(hash);
    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => (buttons.find((button) => button.textContent === "Remove") as HTMLButtonElement).click());
    expect(container.textContent).toContain("removed_by_user");
    act(() => (buttons.find((button) => button.textContent === "Send with manual-only") as HTMLButtonElement).click());
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("manual_only");
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
    await new Promise((resolve) => setTimeout(resolve, 380));
    await act(async () => root?.render(<ChatContextDrawer projectId={projectId} chatId="chat-2" draft="Different" settings={{ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }} generationKey="2" />));
    await act(async () => resolvePlan(new Response(JSON.stringify(plan()), { status: 200 })));
    act(() => (container.querySelector("button[aria-controls='chat-context-drawer-panel']") as HTMLButtonElement).click());
    expect(container.textContent).not.toContain("src/main.ts");
  });
});
