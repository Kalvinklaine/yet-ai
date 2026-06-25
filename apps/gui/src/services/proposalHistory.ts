import { redactSecrets, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ProposalHistoryEntryKind = "original" | "follow_up" | "rejected" | "applied" | "verification" | "plan_preview";
export type ProposalHistoryEntryStatus = "detected" | "ready" | "rejected" | "applied" | "apply_failed" | "verification_succeeded" | "verification_failed" | "preview" | "stale";
export type ProposalHistoryDiagnosticCode = "unsafe_metadata" | "unsafe_id" | "unsafe_source" | "duplicate_entry" | "stale_entry" | "bounded_output";

export type ProposalHistoryDiagnostic = {
  code: ProposalHistoryDiagnosticCode;
  message: string;
};

export type ProposalHistoryAuthorityPolicy = {
  canRequestApply: false;
  canRequestVerification: false;
  canRunCommand: false;
  canReadFiles: false;
  canWriteFiles: false;
  canCallProvider: false;
  displayOnly: true;
};

export type ProposalHistoryEntryInput = {
  id?: unknown;
  source?: unknown;
  kind: ProposalHistoryEntryKind;
  status?: unknown;
  summary?: unknown;
  touchedFiles?: readonly unknown[];
  touchedFileCount?: unknown;
  editCount?: unknown;
  diagnostic?: unknown;
  diagnostics?: readonly unknown[];
  applyStatus?: unknown;
  verificationStatus?: unknown;
  timestamp?: unknown;
};

export type ProposalHistoryEntry = {
  id?: string;
  source: string;
  kind: ProposalHistoryEntryKind;
  status: ProposalHistoryEntryStatus;
  summary?: string;
  touchedFiles: string[];
  touchedFileCount: number;
  editCount?: number;
  diagnostics: string[];
  applyStatus?: "applied" | "failed";
  verificationStatus?: "succeeded" | "failed";
  timestamp?: string;
};

export type ProposalHistory = {
  kind: "proposal_history";
  authority: "metadata_only";
  entries: ProposalHistoryEntry[];
  diagnostics: ProposalHistoryDiagnostic[];
  policy: ProposalHistoryAuthorityPolicy;
};

export type ProposalHistoryComparisonSummary = {
  kind: "proposal_history_comparison";
  authority: "metadata_only";
  totalCount: number;
  visibleCount: number;
  rejectedCount: number;
  appliedCount: number;
  verificationSucceededCount: number;
  verificationFailedCount: number;
  planPreviewCount: number;
  latestStatus: string;
  latestSource: string;
  latestSummary: string;
  touchedFileLabels: string[];
  touchedFileCount: number;
  comparisonLabels: string[];
  diagnostics: string[];
  policy: ProposalHistoryAuthorityPolicy;
};

const defaultMaxEntries = 12;
const maxTouchedFiles = 8;
const maxDiagnostics = 12;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\u0000-\u001f\u007f-\u009f]+$/;
const unsafeTextPattern = /raw[_ -]?(?:prompt|file|diff|command|output|replacement)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|bridge[_ -]?dump|tool[_ -]?call|private[_ -]?path|chain[_ -]?of[_ -]?thought|\b(?:command|cmd|cwd|env|shell|git|stdout|stderr)\b|auto[_ -]?(?:apply|run|verify|repair)|apply[_ -]?patch/i;
const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function createProposalHistory(entries: readonly ProposalHistoryEntryInput[] = [], maxEntries = defaultMaxEntries): ProposalHistory {
  return entries.reduce((history, entry) => appendProposalHistoryEntry(history, entry, maxEntries), emptyProposalHistory());
}

export function emptyProposalHistory(): ProposalHistory {
  return {
    kind: "proposal_history",
    authority: "metadata_only",
    entries: [],
    diagnostics: [],
    policy: conservativePolicy(),
  };
}

export function appendProposalHistoryEntry(history: ProposalHistory | readonly ProposalHistoryEntryInput[] | undefined, input: ProposalHistoryEntryInput, maxEntries = defaultMaxEntries): ProposalHistory {
  const current = normalizeHistory(history);
  const sanitized = sanitizeEntry(input);
  const diagnostics = [...current.diagnostics, ...sanitized.diagnostics];
  if (!sanitized.entry) {
    return buildHistory(current.entries, diagnostics, maxEntries);
  }

  const nextEntry = sanitized.entry;
  const duplicateIndex = current.entries.findIndex((entry) => sameEntryIdentity(entry, nextEntry));
  if (duplicateIndex >= 0) {
    const existing = current.entries[duplicateIndex];
    if (!existing) {
      return buildHistory(current.entries, diagnostics, maxEntries);
    }
    if (isStale(existing, nextEntry)) {
      diagnostics.push(diagnostic("stale_entry", "Stale proposal history metadata was ignored."));
      return buildHistory(current.entries, diagnostics, maxEntries);
    }
    diagnostics.push(diagnostic("duplicate_entry", "Duplicate proposal history metadata was replaced."));
    const nextEntries = current.entries.slice();
    nextEntries[duplicateIndex] = mergeEntry(existing, nextEntry);
    return buildHistory(nextEntries, diagnostics, maxEntries);
  }

  return buildHistory([...current.entries, nextEntry], diagnostics, maxEntries);
}

export function updateProposalHistoryEntry(history: ProposalHistory | readonly ProposalHistoryEntryInput[] | undefined, identity: Pick<ProposalHistoryEntryInput, "id" | "source">, patch: Partial<ProposalHistoryEntryInput>, maxEntries = defaultMaxEntries): ProposalHistory {
  const current = normalizeHistory(history);
  const safeIdentity = sanitizeIdentity(identity.id, identity.source);
  const diagnostics = [...current.diagnostics, ...safeIdentity.diagnostics];
  if (!safeIdentity.id && !safeIdentity.source) {
    diagnostics.push(diagnostic("unsafe_metadata", "Proposal history update identity was omitted."));
    return buildHistory(current.entries, diagnostics, maxEntries);
  }
  const index = current.entries.findIndex((entry) => (safeIdentity.id ? entry.id === safeIdentity.id : true) && (safeIdentity.source ? entry.source === safeIdentity.source : true));
  if (index < 0) {
    return buildHistory(current.entries, diagnostics, maxEntries);
  }
  const sanitized = sanitizeEntry({ ...current.entries[index], ...patch, kind: patch.kind ?? current.entries[index].kind });
  diagnostics.push(...sanitized.diagnostics);
  if (!sanitized.entry) {
    return buildHistory(current.entries, diagnostics, maxEntries);
  }
  const nextEntries = current.entries.slice();
  nextEntries[index] = mergeEntry(current.entries[index], sanitized.entry);
  return buildHistory(nextEntries, diagnostics, maxEntries);
}

export function createProposalHistoryComparisonSummary(history: ProposalHistory | readonly ProposalHistoryEntryInput[] | undefined): ProposalHistoryComparisonSummary {
  const current = normalizeHistory(history);
  const entries = current.entries;
  const latest = entries[entries.length - 1];
  const touchedFileLabels = uniqueStrings(entries.flatMap((entry) => entry.touchedFiles)).slice(0, maxTouchedFiles);
  return {
    kind: "proposal_history_comparison",
    authority: "metadata_only",
    totalCount: entries.length,
    visibleCount: entries.filter((entry) => entry.kind === "original" || entry.kind === "follow_up").length,
    rejectedCount: entries.filter((entry) => entry.kind === "rejected" || entry.status === "rejected").length,
    appliedCount: entries.filter((entry) => entry.applyStatus === "applied" || entry.status === "applied").length,
    verificationSucceededCount: entries.filter((entry) => entry.verificationStatus === "succeeded" || entry.status === "verification_succeeded").length,
    verificationFailedCount: entries.filter((entry) => entry.verificationStatus === "failed" || entry.status === "verification_failed").length,
    planPreviewCount: entries.filter((entry) => entry.kind === "plan_preview").length,
    latestStatus: latest?.status ?? "none",
    latestSource: latest?.source ?? "none",
    latestSummary: latest?.summary ?? "none",
    touchedFileLabels,
    touchedFileCount: touchedFileLabels.length,
    comparisonLabels: entries.slice(-defaultMaxEntries).map((entry) => comparisonLabel(entry)).filter(Boolean),
    diagnostics: current.diagnostics.map((item) => item.message).slice(0, maxDiagnostics),
    policy: conservativePolicy(),
  };
}

function comparisonLabel(entry: ProposalHistoryEntry): string {
  const summary = entry.summary && entry.summary !== "[redacted]" ? ` · ${entry.summary}` : "";
  return safeText(`${entry.status} · ${entry.kind}${summary}`, 180, [], "comparison") ?? "";
}

function normalizeHistory(history: ProposalHistory | readonly ProposalHistoryEntryInput[] | undefined): ProposalHistory {
  if (!history) {
    return emptyProposalHistory();
  }
  if (isProposalHistory(history)) {
    return {
      kind: "proposal_history",
      authority: "metadata_only",
      entries: history.entries.slice(0, defaultMaxEntries),
      diagnostics: history.diagnostics.slice(0, maxDiagnostics),
      policy: conservativePolicy(),
    };
  }
  return createProposalHistory(history);
}

function isProposalHistory(history: ProposalHistory | readonly ProposalHistoryEntryInput[]): history is ProposalHistory {
  return typeof history === "object" && history !== null && "kind" in history && history.kind === "proposal_history";
}

function sanitizeEntry(input: ProposalHistoryEntryInput): { entry?: ProposalHistoryEntry; diagnostics: ProposalHistoryDiagnostic[] } {
  const identity = sanitizeIdentity(input.id, input.source);
  const diagnostics = identity.diagnostics.slice();
  const source = identity.source ?? "assistant";
  const status = sanitizeStatus(input.status, input.kind);
  const summary = safeText(input.summary, 240, diagnostics, "summary");
  const touchedFiles = sanitizeTouchedFiles(input.touchedFiles, diagnostics);
  const touchedFileCount = safeCount(input.touchedFileCount) ?? touchedFiles.length;
  const editCount = safeCount(input.editCount);
  const ownDiagnostics = [input.diagnostic, ...(Array.isArray(input.diagnostics) ? input.diagnostics : [])]
    .map((item) => safeText(item, 180, diagnostics, "diagnostic"))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxDiagnostics);
  const applyStatus = sanitizeApplyStatus(input.applyStatus, status);
  const verificationStatus = sanitizeVerificationStatus(input.verificationStatus, status);
  const timestamp = sanitizeTimestamp(input.timestamp, diagnostics);
  return {
    entry: stripUndefined({
      id: identity.id,
      source,
      kind: input.kind,
      status,
      summary,
      touchedFiles,
      touchedFileCount,
      editCount,
      diagnostics: ownDiagnostics,
      applyStatus,
      verificationStatus,
      timestamp,
    }),
    diagnostics,
  };
}

function sanitizeIdentity(id: unknown, source: unknown): { id?: string; source?: string; diagnostics: ProposalHistoryDiagnostic[] } {
  const diagnostics: ProposalHistoryDiagnostic[] = [];
  const sanitizedId = safeId(id);
  const sanitizedSource = safeLabel(source, 80, diagnostics, "source");
  if (id !== undefined && !sanitizedId) {
    diagnostics.push(diagnostic("unsafe_id", "Unsafe proposal history id was omitted."));
  }
  if (source !== undefined && !sanitizedSource) {
    diagnostics.push(diagnostic("unsafe_source", "Unsafe proposal history source was replaced."));
  }
  return stripUndefined({ id: sanitizedId, source: sanitizedSource, diagnostics });
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) && !isUnsafeString(sanitized) ? sanitized : undefined;
}

function safeLabel(value: unknown, limit: number, diagnostics: ProposalHistoryDiagnostic[], field: string): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return undefined;
  }
  const text = safeText(value, limit, diagnostics, field);
  if (!text || text === "[redacted]") {
    return undefined;
  }
  return text;
}

function safeText(value: unknown, limit: number, diagnostics: ProposalHistoryDiagnostic[], field: string): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return undefined;
  }
  const raw = String(value);
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(raw)).replace(/[\r\n]+/g, " ").trim();
  if (isUnsafeString(raw)) {
    diagnostics.push(diagnostic("unsafe_metadata", `Unsafe proposal history ${field} metadata was redacted.`));
    return "[redacted]";
  }
  const redacted = redactUnsafeText(sanitized);
  if (redacted !== sanitized) {
    diagnostics.push(diagnostic("unsafe_metadata", `Unsafe proposal history ${field} metadata was redacted.`));
  }
  if (!redacted) {
    return undefined;
  }
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

function redactUnsafeText(value: string): string {
  const secretRedacted = redactSecrets(value);
  if (privatePathPattern.test(secretRedacted) || stackTracePattern.test(secretRedacted) || unsafeTextPattern.test(secretRedacted)) {
    return "[redacted]";
  }
  return secretRedacted;
}

function isUnsafeString(value: string): boolean {
  return redactSecrets(value) !== value || privatePathPattern.test(value) || stackTracePattern.test(value) || unsafeTextPattern.test(value);
}

function sanitizeTouchedFiles(files: readonly unknown[] | undefined, diagnostics: ProposalHistoryDiagnostic[]): string[] {
  if (!Array.isArray(files)) {
    return [];
  }
  const labels: string[] = [];
  for (const file of files.slice(0, maxTouchedFiles)) {
    if (typeof file !== "string") {
      continue;
    }
    if (isUnsafeString(file)) {
      diagnostics.push(diagnostic("unsafe_metadata", "Unsafe touched file label was omitted."));
      continue;
    }
    const label = sanitizeDisplayText(file).trim();
    if (label && label.length <= 240 && safeRelativePathPattern.test(label)) {
      labels.push(label);
    } else {
      diagnostics.push(diagnostic("unsafe_metadata", "Unsafe touched file label was omitted."));
    }
  }
  if (files.length > maxTouchedFiles) {
    diagnostics.push(diagnostic("bounded_output", "Proposal history touched file labels were bounded."));
  }
  return uniqueStrings(labels);
}

function sanitizeStatus(status: unknown, kind: ProposalHistoryEntryKind): ProposalHistoryEntryStatus {
  if (status === "detected" || status === "ready" || status === "rejected" || status === "applied" || status === "apply_failed" || status === "verification_succeeded" || status === "verification_failed" || status === "preview" || status === "stale") {
    return status;
  }
  const fallback: Record<ProposalHistoryEntryKind, ProposalHistoryEntryStatus> = {
    original: "detected",
    follow_up: "detected",
    rejected: "rejected",
    applied: "applied",
    verification: "verification_succeeded",
    plan_preview: "preview",
  };
  return fallback[kind];
}

function sanitizeApplyStatus(value: unknown, status: ProposalHistoryEntryStatus): ProposalHistoryEntry["applyStatus"] {
  if (value === "applied" || value === "failed") {
    return value;
  }
  if (status === "applied") {
    return "applied";
  }
  if (status === "apply_failed") {
    return "failed";
  }
  return undefined;
}

function sanitizeVerificationStatus(value: unknown, status: ProposalHistoryEntryStatus): ProposalHistoryEntry["verificationStatus"] {
  if (value === "succeeded" || value === "failed") {
    return value;
  }
  if (status === "verification_succeeded") {
    return "succeeded";
  }
  if (status === "verification_failed") {
    return "failed";
  }
  return undefined;
}

function sanitizeTimestamp(value: unknown, diagnostics: ProposalHistoryDiagnostic[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    diagnostics.push(diagnostic("unsafe_metadata", "Unsafe proposal history timestamp was omitted."));
    return undefined;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    diagnostics.push(diagnostic("unsafe_metadata", "Unsafe proposal history timestamp was omitted."));
    return undefined;
  }
  return new Date(time).toISOString();
}

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000 ? value : undefined;
}

function sameEntryIdentity(left: ProposalHistoryEntry, right: ProposalHistoryEntry): boolean {
  if (left.id && right.id) {
    return left.id === right.id && left.source === right.source;
  }
  return left.source === right.source && left.kind === right.kind && left.summary !== undefined && left.summary === right.summary;
}

function isStale(existing: ProposalHistoryEntry, next: ProposalHistoryEntry): boolean {
  if (!existing.timestamp || !next.timestamp) {
    return false;
  }
  return Date.parse(next.timestamp) < Date.parse(existing.timestamp);
}

function mergeEntry(existing: ProposalHistoryEntry, next: ProposalHistoryEntry): ProposalHistoryEntry {
  return stripUndefined({
    ...existing,
    ...next,
    touchedFiles: next.touchedFiles.length > 0 ? next.touchedFiles : existing.touchedFiles,
    touchedFileCount: next.touchedFileCount || existing.touchedFileCount,
    diagnostics: uniqueStrings([...existing.diagnostics, ...next.diagnostics]).slice(0, maxDiagnostics),
  });
}

function buildHistory(entries: ProposalHistoryEntry[], diagnostics: ProposalHistoryDiagnostic[], maxEntries: number): ProposalHistory {
  const boundedMax = Math.max(1, Math.min(maxEntries, 50));
  const boundedDiagnostics = uniqueDiagnostics(diagnostics).slice(-maxDiagnostics);
  const boundedEntries = entries.slice(-boundedMax);
  if (entries.length > boundedMax) {
    boundedDiagnostics.push(diagnostic("bounded_output", "Proposal history entries were bounded."));
  }
  return {
    kind: "proposal_history",
    authority: "metadata_only",
    entries: boundedEntries,
    diagnostics: uniqueDiagnostics(boundedDiagnostics).slice(-maxDiagnostics),
    policy: conservativePolicy(),
  };
}

function diagnostic(code: ProposalHistoryDiagnosticCode, message: string): ProposalHistoryDiagnostic {
  return { code, message: sanitizeTimelineText(message).replace(/[\r\n]+/g, " ").trim() };
}

function uniqueDiagnostics(values: ProposalHistoryDiagnostic[]): ProposalHistoryDiagnostic[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.code}:${value.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function conservativePolicy(): ProposalHistoryAuthorityPolicy {
  return {
    canRequestApply: false,
    canRequestVerification: false,
    canRunCommand: false,
    canReadFiles: false,
    canWriteFiles: false,
    canCallProvider: false,
    displayOnly: true,
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
