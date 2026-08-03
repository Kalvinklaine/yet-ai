import { describe, expect, it } from "vitest";
import { buildContextManifestView, contextManifestEntryKey, manifestEntryToExplicitRef, manifestMatchesCorrelation } from "./contextManifestView";
import type { ProjectContextPlan } from "./projectContextClient";

const projectId = "prj_abcdefghijklmnopqrstuA";
const hash = `sha256:${"a".repeat(64)}`;
const entry = { kind: "file_chunk" as const, chunkId: "chunk-1", sourceRef: "src/main.ts", range: { start: { line: 0, character: 0 }, end: { line: 4, character: 2 } }, symbol: "start", contentHash: hash, inclusionReason: "symbol_match" as const, provenance: "symbol" as const, redaction: "none" as const, byteCount: 100, estimatedTokens: 25, rank: 1 };
const plan: ProjectContextPlan = { protocolVersion: "2026-08-02", schemaVersion: 1, planId: "plan-1", projectId, mode: "balanced", queryLabel: "Find start", status: "truncated", manifest: { protocolVersion: "2026-08-02", schemaVersion: 1, manifestId: "manifest-1", projectId, planId: "plan-1", mode: "balanced", inventoryGeneration: 3, queryHash: hash, rankingVersion: "lexical-symbol-ranking-1", budget: { maxFiles: 12, maxChunks: 32, maxBytes: 1000, maxEstimatedTokens: 100, usedFiles: 1, usedChunks: 1, usedBytes: 100, usedEstimatedTokens: 25, truncated: true }, entries: [entry], omissions: [{ reason: "secret_like", provenance: "inventory" }], redaction: { metadataOnlyCount: 0, contentRedactedCount: 1, omittedCount: 1 }, createdAt: "2026-08-02T12:00:00Z" }, createdAt: "2026-08-02T12:00:00Z", expiresAt: "2026-08-02T12:05:00Z", cloudRequired: false };

describe("contextManifestView", () => {
  it("shows only bounded metadata, budget, omissions, and warnings", () => {
    const view = buildContextManifestView(plan);
    expect(view.included[0]).toEqual(expect.objectContaining({ label: "src/main.ts", range: "1:1–5:3", symbol: "start", reason: "symbol_match" }));
    expect(view.omitted[0]).toEqual(expect.objectContaining({ label: "Sensitive candidate", reason: "secret_like" }));
    expect(view.budget).toContain("25/100 estimated tokens");
    expect(view.warnings.join(" ")).toContain("budget");
    expect(view.included[0].label).not.toContain(hash);
    expect(view.omitted[0].label).not.toContain(hash);
  });

  it("moves removed entries to omitted and can pin the explicit reference", () => {
    const key = contextManifestEntryKey(entry);
    const view = buildContextManifestView(plan, new Set([key]));
    expect(view.included).toHaveLength(0);
    expect(view.omitted.some((item) => item.reason === "removed_by_user")).toBe(true);
    expect(manifestEntryToExplicitRef(entry)).toEqual({ kind: "file_chunk", chunkId: "chunk-1", sourceRef: "src/main.ts", range: entry.range, contentHash: hash });
    expect(manifestMatchesCorrelation(plan.manifest, projectId, 3)).toBe(true);
    expect(manifestMatchesCorrelation(plan.manifest, projectId, 4)).toBe(false);
  });

  it("keeps exact same-file chunk exclusion stable when ranks change", () => {
    const sibling = { ...entry, chunkId: "chunk-2", range: { start: { line: 5, character: 0 }, end: { line: 9, character: 0 } }, contentHash: `sha256:${"b".repeat(64)}`, rank: 2 };
    const excludedKey = contextManifestEntryKey(entry);
    const replanned = structuredClone(plan);
    replanned.manifest.entries = [{ ...sibling, rank: 1 }, { ...entry, rank: 2 }];

    const view = buildContextManifestView(replanned, new Set([excludedKey]));

    expect(view.included.map((item) => item.key)).toEqual([contextManifestEntryKey(sibling)]);
    expect(view.omitted).toEqual(expect.arrayContaining([expect.objectContaining({ key: excludedKey, reason: "removed_by_user" })]));
  });

  it("rejects entries without a stable source identity", () => {
    const invalidPlan = structuredClone(plan);
    delete invalidPlan.manifest.entries[0].chunkId;

    expect(() => buildContextManifestView(invalidPlan)).toThrow("Project context manifest entry has no stable source identity.");
  });
});
