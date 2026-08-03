import { runtimeFetch, type RuntimeError, type RuntimeResult } from "./runtimeClient";
import type { ProjectRuntimeSettings } from "./projectClient";
import { parseProjectId } from "./projectRouting";

const protocolVersion = "2026-08-02";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const relativePathPattern = /^(?!\/)(?!~)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*:\/\/)[^\u0000-\u001F\u007F]+$/;

export type ProjectContextState = "not_built" | "building" | "ready" | "stale" | "unavailable" | "migration_required";
export type ProjectContextCounts = { eligibleFiles: number; indexedFiles: number; omittedFiles: number; chunks: number; symbols: number };
export type ProjectContextStatus = {
  protocolVersion: typeof protocolVersion;
  schemaVersion: 1;
  projectId: string;
  state: ProjectContextState;
  inventoryGeneration: number;
  profileId?: string;
  builtAt?: string;
  updatedAt?: string;
  counts?: ProjectContextCounts;
  freshness?: { status: "current" | "stale" | "unknown"; pendingChanges: number };
  error?: { code: "unavailable" | "migration_required" | "corrupt_cache" | "policy_blocked" | "resource_limit"; message: string };
  cloudRequired: false;
  providerAccess: "direct";
};
export type ProjectContextFact = {
  kind: "overview" | "manifest" | "language" | "documentation" | "module" | "entry_point" | "build_command" | "test_command";
  label: string;
  sourceRef: string;
  contentHash: string;
  provenance: "structural_inventory" | "manifest_convention";
};
export type ProjectContextProfile = {
  protocolVersion: typeof protocolVersion;
  schemaVersion: 1;
  profileId: string;
  projectId: string;
  inventoryGeneration: number;
  profileHash: string;
  summary: string;
  summaryProvenance: Array<{ sourceRef: string; contentHash: string }>;
  facts: ProjectContextFact[];
  createdAt: string;
  cloudRequired: false;
};
export type ProjectContextRebuildResponse = {
  protocolVersion: typeof protocolVersion;
  schemaVersion: 1;
  operationId: string;
  projectId: string;
  mode: "full" | "incremental";
  status: "accepted";
  expectedInventoryGeneration: number;
  expectedProjectRevision: string;
  cloudRequired: false;
};
export type ProjectContextMode = "manual_only" | "balanced" | "deep";
export type ContextPosition = { line: number; character: number };
export type ContextRange = { start: ContextPosition; end: ContextPosition };
export type ProjectContextExplicitRef =
  | { kind: "file_chunk"; sourceRef: string }
  | { kind: "active_editor"; editorSnapshotId: string; sourceRef: string; range: ContextRange; contentHash: string; byteCount: number; estimatedTokens: number }
  | { kind: "memory_note"; memoryNoteId: string; contentHash: string; byteCount: number; estimatedTokens: number }
  | { kind: "verification_output"; verificationResultId: string; commandId: "repository-check" | "gui-app-tests" | "engine-chat-tests"; contentHash: string; byteCount: number; estimatedTokens: number }
  | { kind: "continuation_prefix"; assistantMessageId: string; generationId: string; contentPrefixHash: string; byteCount: number; estimatedTokens: number };
export type ProjectContextPlanRequest = {
  query: string;
  mode: ProjectContextMode;
  budget: { maxFiles: number; maxChunks: number; maxBytes: number; maxEstimatedTokens: number };
  explicitRefs: ProjectContextExplicitRef[];
  expectedInventoryGeneration: number;
  expectedProjectRevision: string;
};
export type ProjectContextManifestEntry = {
  kind: "file_chunk" | "active_editor" | "memory_note" | "verification_output" | "continuation_prefix";
  sourceRef?: string;
  range?: ContextRange;
  symbol?: string;
  editorSnapshotId?: string;
  memoryNoteId?: string;
  verificationResultId?: string;
  commandId?: "repository-check" | "gui-app-tests" | "engine-chat-tests";
  assistantMessageId?: string;
  generationId?: string;
  contentHash?: string;
  contentPrefixHash?: string;
  inclusionReason: "profile_candidate" | "lexical_match" | "symbol_match" | "path_match" | "explicit_user_selection" | "continuity_context";
  provenance: "inventory" | "profile" | "lexical" | "symbol" | "explicit_user" | "continuation";
  redaction: "none" | "metadata_only" | "content_redacted";
  byteCount: number;
  estimatedTokens: number;
  rank: number;
};
export type ProjectContextManifest = {
  protocolVersion: typeof protocolVersion; schemaVersion: 1; manifestId: string; projectId: string; profileId?: string; planId: string; mode: ProjectContextMode;
  inventoryGeneration: number; queryHash: string; rankingVersion: "lexical-symbol-ranking-1";
  budget: ProjectContextPlanRequest["budget"] & { usedFiles: number; usedChunks: number; usedBytes: number; usedEstimatedTokens: number; truncated: boolean };
  entries: ProjectContextManifestEntry[];
  omissions: Array<{ sourceRef?: string; reason: "ignored" | "secret_like" | "binary" | "generated" | "dependency" | "oversized" | "symlink" | "outside_root" | "unsupported_type" | "budget_exhausted" | "stale_hash" | "policy_denied"; provenance: ProjectContextManifestEntry["provenance"]; detail?: string }>;
  redaction: { metadataOnlyCount: number; contentRedactedCount: number; omittedCount: number };
  createdAt: string;
};
export type ProjectContextPlan = { protocolVersion: typeof protocolVersion; schemaVersion: 1; planId: string; projectId: string; mode: ProjectContextMode; queryLabel: string; status: "ready" | "truncated" | "blocked" | "stale"; manifest: ProjectContextManifest; createdAt: string; expiresAt: string; cloudRequired: false };

export async function getProjectContextStatus(settings: ProjectRuntimeSettings): Promise<RuntimeResult<ProjectContextStatus>> {
  return scopedValidated(await runtimeFetch<unknown>(settings, `${settings.apiBase}/context/status`), parseStatus, settings.projectScope.projectId);
}

export async function getProjectContextProfile(settings: ProjectRuntimeSettings): Promise<RuntimeResult<ProjectContextProfile>> {
  return scopedValidated(await runtimeFetch<unknown>(settings, `${settings.apiBase}/context/profile`), parseProfile, settings.projectScope.projectId);
}

export async function rebuildProjectContext(settings: ProjectRuntimeSettings, request: { expectedInventoryGeneration: number; expectedProjectRevision: string }): Promise<RuntimeResult<ProjectContextRebuildResponse>> {
  const body = { mode: "full", expectedInventoryGeneration: request.expectedInventoryGeneration, expectedProjectRevision: request.expectedProjectRevision };
  return scopedValidated(await runtimeFetch<unknown>(settings, `${settings.apiBase}/context/rebuild`, { method: "POST", body: JSON.stringify(body) }), parseRebuild, settings.projectScope.projectId);
}

export async function planProjectContext(settings: ProjectRuntimeSettings, request: ProjectContextPlanRequest): Promise<RuntimeResult<ProjectContextPlan>> {
  return scopedValidated(await runtimeFetch<unknown>(settings, `${settings.apiBase}/context/plan`, { method: "POST", body: JSON.stringify(request) }), parsePlan, settings.projectScope.projectId);
}

function scopedValidated<T extends { projectId: string }>(result: RuntimeResult<unknown>, parser: (value: unknown) => T | null, expectedProjectId: string): RuntimeResult<T> {
  if (!result.ok) return result;
  const data = parser(result.data);
  return data?.projectId === expectedProjectId ? { ok: true, data } : protocolError();
}

function parseStatus(value: unknown): ProjectContextStatus | null {
  if (!record(value) || !exact(value, ["protocolVersion", "schemaVersion", "projectId", "state", "inventoryGeneration", "profileId", "builtAt", "updatedAt", "counts", "freshness", "error", "cloudRequired", "providerAccess"])) return null;
  if (value.protocolVersion !== protocolVersion || value.schemaVersion !== 1 || !projectId(value.projectId) || !oneOf(value.state, ["not_built", "building", "ready", "stale", "unavailable", "migration_required"]) || !count(value.inventoryGeneration) || value.cloudRequired !== false || value.providerAccess !== "direct") return null;
  if (value.profileId !== undefined && (!string(value.profileId) || !idPattern.test(value.profileId))) return null;
  if (value.builtAt !== undefined && !time(value.builtAt)) return null;
  if (value.updatedAt !== undefined && !time(value.updatedAt)) return null;
  if (value.counts !== undefined && !counts(value.counts)) return null;
  if (value.freshness !== undefined && (!record(value.freshness) || !exact(value.freshness, ["status", "pendingChanges"]) || !oneOf(value.freshness.status, ["current", "stale", "unknown"]) || !count(value.freshness.pendingChanges))) return null;
  if (value.error !== undefined && (!record(value.error) || !exact(value.error, ["code", "message"]) || !oneOf(value.error.code, ["unavailable", "migration_required", "corrupt_cache", "policy_blocked", "resource_limit"]) || !safeText(value.error.message, 240))) return null;
  return value as ProjectContextStatus;
}

function parseProfile(value: unknown): ProjectContextProfile | null {
  if (!record(value) || !exact(value, ["protocolVersion", "schemaVersion", "profileId", "projectId", "inventoryGeneration", "profileHash", "summary", "summaryProvenance", "facts", "createdAt", "cloudRequired"])) return null;
  if (value.protocolVersion !== protocolVersion || value.schemaVersion !== 1 || !string(value.profileId) || !idPattern.test(value.profileId) || !projectId(value.projectId) || !positiveCount(value.inventoryGeneration) || !hash(value.profileHash) || !safeText(value.summary, 500) || !time(value.createdAt) || value.cloudRequired !== false) return null;
  if (!Array.isArray(value.summaryProvenance) || value.summaryProvenance.length < 1 || value.summaryProvenance.length > 3 || !value.summaryProvenance.every(sourceEvidence)) return null;
  if (!Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 64 || !value.facts.every(fact)) return null;
  return value as ProjectContextProfile;
}

function parseRebuild(value: unknown): ProjectContextRebuildResponse | null {
  if (!record(value) || !exact(value, ["protocolVersion", "schemaVersion", "operationId", "projectId", "mode", "status", "expectedInventoryGeneration", "expectedProjectRevision", "cloudRequired"])) return null;
  if (value.protocolVersion !== protocolVersion || value.schemaVersion !== 1 || !string(value.operationId) || !idPattern.test(value.operationId) || !projectId(value.projectId) || !oneOf(value.mode, ["full", "incremental"]) || value.status !== "accepted" || !count(value.expectedInventoryGeneration) || !string(value.expectedProjectRevision) || !/^[1-9][0-9]{0,19}$/.test(value.expectedProjectRevision) || value.cloudRequired !== false) return null;
  return value as ProjectContextRebuildResponse;
}

function parsePlan(value: unknown): ProjectContextPlan | null {
  if (!record(value) || !exact(value, ["protocolVersion", "schemaVersion", "planId", "projectId", "mode", "queryLabel", "status", "manifest", "createdAt", "expiresAt", "cloudRequired", "continuity"])) return null;
  if (value.protocolVersion !== protocolVersion || value.schemaVersion !== 1 || !validId(value.planId) || !projectId(value.projectId) || !oneOf(value.mode, ["manual_only", "balanced", "deep"]) || !safeText(value.queryLabel, 240) || !oneOf(value.status, ["ready", "truncated", "blocked", "stale"]) || !time(value.createdAt) || !time(value.expiresAt) || value.cloudRequired !== false) return null;
  const manifest = parseManifest(value.manifest);
  if (!manifest || manifest.projectId !== value.projectId || manifest.planId !== value.planId || manifest.mode !== value.mode) return null;
  return { ...value, manifest } as ProjectContextPlan;
}

function parseManifest(value: unknown): ProjectContextManifest | null {
  if (!record(value) || !exact(value, ["protocolVersion", "schemaVersion", "manifestId", "projectId", "profileId", "planId", "mode", "inventoryGeneration", "queryHash", "rankingVersion", "budget", "entries", "omissions", "redaction", "createdAt"])) return null;
  if (value.protocolVersion !== protocolVersion || value.schemaVersion !== 1 || !validId(value.manifestId) || !projectId(value.projectId) || !validId(value.planId) || (value.profileId !== undefined && !validId(value.profileId)) || !oneOf(value.mode, ["manual_only", "balanced", "deep"]) || !count(value.inventoryGeneration) || !hash(value.queryHash) || value.rankingVersion !== "lexical-symbol-ranking-1" || !time(value.createdAt)) return null;
  if (!budget(value.budget) || !Array.isArray(value.entries) || value.entries.length > 256 || !value.entries.every(manifestEntry) || !Array.isArray(value.omissions) || value.omissions.length > 256 || !value.omissions.every(omission) || !redaction(value.redaction)) return null;
  return value as ProjectContextManifest;
}

function manifestEntry(value: unknown): value is ProjectContextManifestEntry {
  if (!record(value) || !oneOf(value.kind, ["file_chunk", "active_editor", "memory_note", "verification_output", "continuation_prefix"]) || !oneOf(value.inclusionReason, ["profile_candidate", "lexical_match", "symbol_match", "path_match", "explicit_user_selection", "continuity_context"]) || !oneOf(value.provenance, ["inventory", "profile", "lexical", "symbol", "explicit_user", "continuation"]) || !oneOf(value.redaction, ["none", "metadata_only", "content_redacted"]) || !count(value.byteCount) || !count(value.estimatedTokens) || !positiveCount(value.rank)) return false;
  if (value.sourceRef !== undefined && !relativePath(value.sourceRef)) return false;
  if (value.range !== undefined && !textRange(value.range)) return false;
  if (value.symbol !== undefined && !safeText(value.symbol, 240)) return false;
  for (const key of ["editorSnapshotId", "memoryNoteId", "verificationResultId", "assistantMessageId", "generationId"]) if (value[key] !== undefined && !validId(value[key])) return false;
  if (value.commandId !== undefined && !oneOf(value.commandId, ["repository-check", "gui-app-tests", "engine-chat-tests"])) return false;
  if (value.contentHash !== undefined && !hash(value.contentHash)) return false;
  if (value.contentPrefixHash !== undefined && !hash(value.contentPrefixHash)) return false;
  return (value.kind === "file_chunk" && relativePath(value.sourceRef) && textRange(value.range) && hash(value.contentHash))
    || (value.kind === "active_editor" && validId(value.editorSnapshotId) && relativePath(value.sourceRef) && textRange(value.range) && hash(value.contentHash))
    || (value.kind === "memory_note" && validId(value.memoryNoteId) && hash(value.contentHash))
    || (value.kind === "verification_output" && validId(value.verificationResultId) && oneOf(value.commandId, ["repository-check", "gui-app-tests", "engine-chat-tests"]) && hash(value.contentHash))
    || (value.kind === "continuation_prefix" && validId(value.assistantMessageId) && validId(value.generationId) && hash(value.contentPrefixHash));
}

function budget(value: unknown) { return record(value) && exact(value, ["maxFiles", "maxChunks", "maxBytes", "maxEstimatedTokens", "usedFiles", "usedChunks", "usedBytes", "usedEstimatedTokens", "truncated"]) && positiveCount(value.maxFiles) && positiveCount(value.maxChunks) && positiveCount(value.maxBytes) && positiveCount(value.maxEstimatedTokens) && count(value.usedFiles) && count(value.usedChunks) && count(value.usedBytes) && count(value.usedEstimatedTokens) && typeof value.truncated === "boolean"; }
function omission(value: unknown) { return record(value) && exact(value, ["sourceRef", "reason", "provenance", "detail"]) && (value.sourceRef === undefined || relativePath(value.sourceRef)) && oneOf(value.reason, ["ignored", "secret_like", "binary", "generated", "dependency", "oversized", "symlink", "outside_root", "unsupported_type", "budget_exhausted", "stale_hash", "policy_denied"]) && oneOf(value.provenance, ["inventory", "profile", "lexical", "symbol", "explicit_user", "continuation"]) && (value.detail === undefined || safeText(value.detail, 240)); }
function redaction(value: unknown) { return record(value) && exact(value, ["metadataOnlyCount", "contentRedactedCount", "omittedCount"]) && count(value.metadataOnlyCount) && count(value.contentRedactedCount) && count(value.omittedCount); }
function textRange(value: unknown): value is ContextRange { return record(value) && exact(value, ["start", "end"]) && position(value.start) && position(value.end); }
function position(value: unknown): value is ContextPosition { return record(value) && exact(value, ["line", "character"]) && count(value.line) && count(value.character); }
function validId(value: unknown): value is string { return string(value) && idPattern.test(value); }

function counts(value: unknown): value is ProjectContextCounts { return record(value) && exact(value, ["eligibleFiles", "indexedFiles", "omittedFiles", "chunks", "symbols"]) && count(value.eligibleFiles) && count(value.indexedFiles) && count(value.omittedFiles) && count(value.chunks) && count(value.symbols); }
function sourceEvidence(value: unknown) { return record(value) && exact(value, ["sourceRef", "contentHash"]) && relativePath(value.sourceRef) && hash(value.contentHash); }
function fact(value: unknown): value is ProjectContextFact { return record(value) && exact(value, ["kind", "label", "sourceRef", "contentHash", "provenance"]) && oneOf(value.kind, ["overview", "manifest", "language", "documentation", "module", "entry_point", "build_command", "test_command"]) && safeText(value.label, 500) && relativePath(value.sourceRef) && hash(value.contentHash) && oneOf(value.provenance, ["structural_inventory", "manifest_convention"]); }
function protocolError<T>(): RuntimeResult<T> { return { ok: false, error: { status: "protocol", message: "Project context response did not match the supported contract." } }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every((key) => allowed.includes(key)); }
function string(value: unknown): value is string { return typeof value === "string"; }
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === "string" && values.includes(value as T); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000_000; }
function positiveCount(value: unknown): value is number { return count(value) && value >= 1; }
function projectId(value: unknown): value is string { return string(value) && parseProjectId(value) !== null; }
function hash(value: unknown): value is string { return string(value) && hashPattern.test(value); }
function relativePath(value: unknown): value is string { return string(value) && value.length <= 512 && relativePathPattern.test(value); }
function safeText(value: unknown, max: number): value is string {
  if (!string(value) || value.length < 1 || value.length > max || /[\u0000-\u001F\u007F]/.test(value)) return false;
  return !/(?:authorization\s*:|\bbearer\s+\S|\b(?:(?:access|refresh|id)[_ -]?)?token\s*[:=]\s*\S|\b(?:api[_ -]?key|cookie|credential|password|secret)\s*[:=]\s*\S|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}|(?:file|https?):\/\/|(?:^|\s)(?:\/|~[/\\])|(?:^|\s)[A-Za-z]:[/\\]|\b(?:ignore (?:all|previous) instructions|reveal (?:secrets?|credentials?)|system prompt)\b|[`$;&|<>])/i.test(value);
}
function time(value: unknown): value is string { return string(value) && value.endsWith("Z") && !Number.isNaN(Date.parse(value)); }

export type { RuntimeError };
