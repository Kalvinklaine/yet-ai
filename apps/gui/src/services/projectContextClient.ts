import { runtimeFetch, type RuntimeError, type RuntimeResult } from "./runtimeClient";
import type { ProjectRuntimeSettings } from "./projectClient";

const protocolVersion = "2026-08-02";
const projectIdPattern = /^prj_[A-Za-z0-9_-]{22}$/;
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
function projectId(value: unknown): value is string { return string(value) && projectIdPattern.test(value); }
function hash(value: unknown): value is string { return string(value) && hashPattern.test(value); }
function relativePath(value: unknown): value is string { return string(value) && value.length <= 512 && relativePathPattern.test(value); }
function safeText(value: unknown, max: number): value is string { return string(value) && value.length >= 1 && value.length <= max && !/[\u0000-\u001F\u007F]/.test(value) && !/(api[_ -]?key|authorization|bearer|cookie|credential|password|secret|token|(?:file|https?):\/\/|(?:^|\s)(?:\/|~[/\\])|(?:^|\s)[A-Za-z]:[/\\]|[`$;&|<>])/i.test(value); }
function time(value: unknown): value is string { return string(value) && value.endsWith("Z") && !Number.isNaN(Date.parse(value)); }

export type { RuntimeError };
