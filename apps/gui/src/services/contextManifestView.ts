import type { ProjectContextManifest, ProjectContextManifestEntry, ProjectContextPlan } from "./projectContextClient";
import type { ProjectContextSourceIdentity } from "./runtimeClient";

export type ContextManifestEntryView = {
  key: string;
  label: string;
  range?: string;
  symbol?: string;
  reason: string;
  provenance: string;
  redaction: string;
  estimatedTokens: number;
};

export type ContextManifestView = {
  status: ProjectContextPlan["status"];
  included: ContextManifestEntryView[];
  omitted: Array<{ key: string; label: string; reason: string; provenance: string }>;
  budget: string;
  warnings: string[];
};

export function contextManifestEntryKey(entry: ProjectContextManifestEntry): string {
  return JSON.stringify(contextManifestEntryIdentity(entry));
}

export function contextManifestEntryIdentity(entry: ProjectContextManifestEntry): ProjectContextSourceIdentity {
  if (entry.kind === "file_chunk" && entry.chunkId && entry.contentHash) return { kind: "file_chunk", chunkId: entry.chunkId, contentHash: entry.contentHash };
  if (entry.kind === "active_editor" && entry.editorSnapshotId) return { kind: "active_editor", editorSnapshotId: entry.editorSnapshotId };
  if (entry.kind === "memory_note" && entry.memoryNoteId) return { kind: "memory_note", memoryNoteId: entry.memoryNoteId };
  if (entry.kind === "verification_output" && entry.verificationResultId) return { kind: "verification_output", verificationResultId: entry.verificationResultId };
  if (entry.kind === "continuation_prefix" && entry.assistantMessageId && entry.generationId) return { kind: "continuation_prefix", assistantMessageId: entry.assistantMessageId, generationId: entry.generationId };
  throw new Error("Project context manifest entry has no stable source identity.");
}

export function buildContextManifestView(plan: ProjectContextPlan, excludedKeys: ReadonlySet<string> = new Set()): ContextManifestView {
  const manifest = plan.manifest;
  const warnings = plan.status === "stale" ? ["The plan is stale. Refresh context before sending."] : [];
  if (manifest.budget.truncated || plan.status === "truncated") warnings.push("The context budget was exhausted; some candidates were omitted.");
  if (manifest.redaction.metadataOnlyCount > 0 || manifest.redaction.contentRedactedCount > 0) warnings.push(`${manifest.redaction.metadataOnlyCount} metadata-only and ${manifest.redaction.contentRedactedCount} redacted item(s).`);
  return {
    status: plan.status,
    included: manifest.entries.filter((entry) => !excludedKeys.has(contextManifestEntryKey(entry))).map(entryView),
    omitted: [
      ...manifest.omissions.map((item, index) => ({ key: `omission:${index}`, label: item.sourceRef ?? "Sensitive candidate", reason: item.reason, provenance: item.provenance })),
      ...manifest.entries.filter((entry) => excludedKeys.has(contextManifestEntryKey(entry))).map((entry) => ({ key: contextManifestEntryKey(entry), label: entryLabel(entry), reason: "removed_by_user", provenance: entry.provenance })),
    ],
    budget: `${manifest.budget.usedEstimatedTokens}/${manifest.budget.maxEstimatedTokens} estimated tokens · ${manifest.budget.usedChunks}/${manifest.budget.maxChunks} chunks · ${manifest.budget.usedFiles}/${manifest.budget.maxFiles} files`,
    warnings,
  };
}

export function manifestEntryToExplicitRef(entry: ProjectContextManifestEntry) {
  if (entry.kind === "file_chunk" && entry.chunkId && entry.sourceRef && entry.range && entry.contentHash) return { kind: "file_chunk" as const, chunkId: entry.chunkId, sourceRef: entry.sourceRef, range: entry.range, contentHash: entry.contentHash };
  if (entry.kind === "active_editor" && entry.editorSnapshotId && entry.sourceRef && entry.range && entry.contentHash) return { kind: "active_editor" as const, editorSnapshotId: entry.editorSnapshotId, sourceRef: entry.sourceRef, range: entry.range, contentHash: entry.contentHash, byteCount: entry.byteCount, estimatedTokens: entry.estimatedTokens };
  if (entry.kind === "memory_note" && entry.memoryNoteId && entry.contentHash) return { kind: "memory_note" as const, memoryNoteId: entry.memoryNoteId, contentHash: entry.contentHash, byteCount: entry.byteCount, estimatedTokens: entry.estimatedTokens };
  if (entry.kind === "verification_output" && entry.verificationResultId && entry.commandId && entry.contentHash) return { kind: "verification_output" as const, verificationResultId: entry.verificationResultId, commandId: entry.commandId, contentHash: entry.contentHash, byteCount: entry.byteCount, estimatedTokens: entry.estimatedTokens };
  if (entry.kind === "continuation_prefix" && entry.assistantMessageId && entry.generationId && entry.contentPrefixHash) return { kind: "continuation_prefix" as const, assistantMessageId: entry.assistantMessageId, generationId: entry.generationId, contentPrefixHash: entry.contentPrefixHash, byteCount: entry.byteCount, estimatedTokens: entry.estimatedTokens };
  return null;
}

function entryView(entry: ProjectContextManifestEntry): ContextManifestEntryView {
  return { key: contextManifestEntryKey(entry), label: entryLabel(entry), range: entry.range ? `${entry.range.start.line + 1}:${entry.range.start.character + 1}–${entry.range.end.line + 1}:${entry.range.end.character + 1}` : undefined, symbol: entry.symbol, reason: entry.inclusionReason, provenance: entry.provenance, redaction: entry.redaction, estimatedTokens: entry.estimatedTokens };
}

function entryLabel(entry: ProjectContextManifestEntry): string {
  return entry.sourceRef ?? entry.memoryNoteId ?? entry.verificationResultId ?? entry.assistantMessageId ?? entry.kind;
}

export function manifestMatchesCorrelation(manifest: ProjectContextManifest, projectId: string, generation: number): boolean {
  return manifest.projectId === projectId && manifest.inventoryGeneration === generation;
}
