import type { ProjectMemoryNote } from "./projectMemoryClient";
import { redactSecrets, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type TaskMemorySuggestionStatus = "suggested" | "already_attached" | "stale" | "unsafe" | "unrelated";

export type TaskMemorySuggestionInput = {
  taskGoalLabel?: unknown;
  sessionLabel?: unknown;
  explicitContextLabels?: readonly unknown[];
  proposalFileLabels?: readonly unknown[];
  attachedMemoryNoteIds?: readonly unknown[];
  projectMemoryNotes?: readonly ProjectMemoryNote[];
  staleBeforeIso?: unknown;
  maxSuggestions?: number;
};

export type TaskMemorySuggestion = {
  noteId: string;
  titleLabel: string;
  reasonLabels: string[];
  status: TaskMemorySuggestionStatus;
  warnings: string[];
  canAttachExplicitly: boolean;
};

export type TaskMemorySuggestionSummary = {
  kind: "task_memory_suggestions";
  authority: "metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  counts: Record<TaskMemorySuggestionStatus, number>;
  labels: string[];
  suggestions: TaskMemorySuggestion[];
  policy: {
    canAutoAttachMemory: false;
    canReadMemoryBodies: false;
    canCallRuntime: false;
    canCallProvider: false;
    explicitAttachOnly: true;
  };
};

const defaultMaxSuggestions = 12;
const maxReasons = 4;
const maxWarnings = 4;
const labelLimit = 120;
const idLimit = 96;
const staleLabelPattern = /(?:^|\b)(?:stale|outdated|deprecated|superseded|obsolete|old|archive|archived)(?:\b|$)/i;
const unsafeTextPattern = /raw[_ -]?(?:prompt|file|diff|command|output|replacement)|file[_ -]?(?:body|content)|full[_ -]?(?:memory|body|text)|provider[_ -]?(?:payload|response|body|tool)|tool[_ -]?(?:call|output|raw)|private[_ -]?path|chain[_ -]?of[_ -]?thought|\b(?:command|cmd|cwd|env|shell|git|stdout|stderr)\b|auto[_ -]?(?:attach|apply|send|run|verify|repair)|apply[_ -]?patch/i;
const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const tokenPattern = /[a-z0-9][a-z0-9._-]{2,}/g;

export function suggestTaskMemory(input: TaskMemorySuggestionInput = {}): TaskMemorySuggestionSummary {
  const maxSuggestions = clampCount(input.maxSuggestions, defaultMaxSuggestions, 1, 50);
  const attachedIds = new Set<string>((input.attachedMemoryNoteIds ?? []).map((id) => safeId(id)).filter((id): id is string => Boolean(id)));
  const queryTokens = collectTokens([
    input.taskGoalLabel,
    input.sessionLabel,
    ...(input.explicitContextLabels ?? []),
    ...(input.proposalFileLabels ?? []),
  ]);
  const staleBefore = safeTimestamp(input.staleBeforeIso);
  const notes = Array.isArray(input.projectMemoryNotes) ? input.projectMemoryNotes : [];

  const suggestions = notes.slice(0, maxSuggestions).map((note) => classifyNote(note, { attachedIds, queryTokens, sessionLabel: safeLabel(input.sessionLabel), staleBefore }));
  return {
    kind: "task_memory_suggestions",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    counts: countSuggestionStatuses(suggestions),
    labels: suggestionLabels(suggestions),
    suggestions,
    policy: conservativePolicy(),
  };
}

export function countSuggestionStatuses(suggestions: readonly TaskMemorySuggestion[]): Record<TaskMemorySuggestionStatus, number> {
  return suggestions.reduce<Record<TaskMemorySuggestionStatus, number>>((counts, suggestion) => ({ ...counts, [suggestion.status]: counts[suggestion.status] + 1 }), emptySuggestionCounts());
}

export function createMemorySuggestionAttachTraceDetails(suggestion: TaskMemorySuggestion | null | undefined): Record<string, string | string[]> | undefined {
  if (!suggestion) {
    return undefined;
  }
  return {
    suggestionStatus: suggestion.status,
    suggestionTitleLabel: boundLabel(suggestion.titleLabel, labelLimit),
    suggestionReasonLabels: suggestion.reasonLabels.map((label) => boundLabel(label, labelLimit)).slice(0, maxReasons),
    suggestionWarningLabels: suggestion.warnings.map((label) => boundLabel(label, labelLimit)).slice(0, maxWarnings),
  };
}

function classifyNote(note: ProjectMemoryNote, context: { attachedIds: Set<string>; queryTokens: Set<string>; sessionLabel?: string; staleBefore?: number }): TaskMemorySuggestion {
  const noteId = safeId(note.id) || "memory-note";
  const titleLabel = safeLabel(note.title) || "Untitled memory note";
  const warnings: string[] = [];
  const reasons: string[] = [];
  const unsafeReasons = unsafeNoteReasons(note);
  if (unsafeReasons.length > 0) {
    warnings.push(...unsafeReasons);
    return suggestion(noteId, titleLabel, ["Memory note needs manual review before attach."], "unsafe", warnings);
  }

  if (context.attachedIds.has(noteId) || context.attachedIds.has(safeLabel(note.id) ?? "")) {
    reasons.push("Memory note is already attached to this task.");
    return suggestion(noteId, titleLabel, reasons, "already_attached", warnings);
  }

  const staleReasons = staleNoteReasons(note, context.sessionLabel, context.staleBefore);
  if (staleReasons.length > 0) {
    warnings.push(...staleReasons);
    return suggestion(noteId, titleLabel, ["Memory note may be stale; review before reusing."], "stale", warnings);
  }

  const overlaps = overlapReasons(note, context.queryTokens);
  if (overlaps.length > 0) {
    reasons.push(...overlaps);
    return suggestion(noteId, titleLabel, reasons, "suggested", warnings);
  }

  return suggestion(noteId, titleLabel, ["No safe metadata overlap with this task."], "unrelated", warnings);
}

function suggestion(noteId: string, titleLabel: string, reasonLabels: string[], status: TaskMemorySuggestionStatus, warnings: string[]): TaskMemorySuggestion {
  return {
    noteId: boundLabel(noteId, idLimit),
    titleLabel: boundLabel(titleLabel, labelLimit),
    reasonLabels: uniqueLabels(reasonLabels).slice(0, maxReasons),
    status,
    warnings: uniqueLabels(warnings).slice(0, maxWarnings),
    canAttachExplicitly: status === "suggested",
  };
}

function suggestionLabels(suggestions: readonly TaskMemorySuggestion[]): string[] {
  return suggestions.slice(0, defaultMaxSuggestions).map((suggestion) => boundLabel(`memory suggestion · ${suggestion.status} · ${suggestion.titleLabel}`, labelLimit));
}

function emptySuggestionCounts(): Record<TaskMemorySuggestionStatus, number> {
  return {
    suggested: 0,
    already_attached: 0,
    stale: 0,
    unsafe: 0,
    unrelated: 0,
  };
}

function unsafeNoteReasons(note: ProjectMemoryNote): string[] {
  const fields = [note.title, note.text, ...(Array.isArray(note.tags) ? note.tags : []), note.taskLabel, note.sessionLabel];
  const reasons: string[] = [];
  if (fields.some((field) => typeof field === "string" && redactSecrets(field) !== field)) {
    reasons.push("Secret-like memory metadata was redacted.");
  }
  if (fields.some((field) => typeof field === "string" && privatePathPattern.test(field))) {
    reasons.push("Private path-like memory metadata was omitted.");
  }
  if (fields.some((field) => typeof field === "string" && unsafeTextPattern.test(field))) {
    reasons.push("Sensitive execution marker detected.");
  }
  return reasons;
}

function staleNoteReasons(note: ProjectMemoryNote, sessionLabel: string | undefined, staleBefore: number | undefined): string[] {
  const labels = [note.title, ...(Array.isArray(note.tags) ? note.tags : [])];
  const reasons: string[] = [];
  if (labels.some((label) => typeof label === "string" && staleLabelPattern.test(label))) {
    reasons.push("Memory note is labeled stale or superseded.");
  }
  if (sessionLabel && note.sessionLabel) {
    const noteSession = safeLabel(note.sessionLabel);
    if (noteSession && normalizeComparable(noteSession) !== normalizeComparable(sessionLabel)) {
      reasons.push("Memory note belongs to a different session label.");
    }
  }
  if (staleBefore !== undefined) {
    const updatedAt = safeTimestamp(note.updatedAt);
    if (updatedAt !== undefined && updatedAt < staleBefore) {
      reasons.push("Memory note was updated before the stale cutoff.");
    }
  }
  return reasons;
}

function overlapReasons(note: ProjectMemoryNote, queryTokens: Set<string>): string[] {
  if (queryTokens.size === 0) {
    return [];
  }
  const noteTokens = collectTokens([note.title, ...(Array.isArray(note.tags) ? note.tags : []), note.taskLabel, note.sessionLabel]);
  const overlaps = Array.from(noteTokens).filter((token) => queryTokens.has(token)).slice(0, maxReasons);
  return overlaps.map((token) => `Safe metadata overlap: ${boundLabel(token, 40)}.`);
}

function collectTokens(values: readonly unknown[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    const label = safeLabel(value);
    if (!label || label === "[redacted]") {
      continue;
    }
    for (const token of label.toLowerCase().match(tokenPattern) ?? []) {
      if (!unsafeTextPattern.test(token) && token.length <= 40) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function safeLabel(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return undefined;
  }
  const raw = String(value);
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(raw)).replace(/[\r\n]+/g, " ").trim();
  if (!sanitized) {
    return undefined;
  }
  if (redactSecrets(raw) !== raw || privatePathPattern.test(raw)) {
    return "[redacted]";
  }
  return boundLabel(sanitized, labelLimit);
}

function safeId(value: unknown): string | undefined {
  const label = safeLabel(value);
  if (!label || label === "[redacted]") {
    return undefined;
  }
  const compact = label.replace(/[^A-Za-z0-9_.:-]/g, "");
  return compact ? boundLabel(compact, idLimit) : undefined;
}

function boundLabel(value: string, limit: number): string {
  const sanitized = sanitizeDisplayText(value).replace(/[\r\n]+/g, " ").trim();
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function uniqueLabels(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => boundLabel(value, labelLimit)).filter(Boolean)));
}

function safeTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function clampCount(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(min, Math.min(value, max)) : fallback;
}

function conservativePolicy(): TaskMemorySuggestionSummary["policy"] {
  return {
    canAutoAttachMemory: false,
    canReadMemoryBodies: false,
    canCallRuntime: false,
    canCallProvider: false,
    explicitAttachOnly: true,
  };
}
