import type { ProjectMemoryNote } from "./projectMemoryClient";
import { redactSecrets, sanitizeDisplayText } from "./redaction";

export const controlledRunProjectMemorySelectionLimits = {
  maxSelectedNotes: 5,
  maxSummaryChars: 180,
  maxBodyBytesPerNote: 2048,
  maxTotalBodyBytes: 6144,
  maxLabels: 12,
} as const;

export type ControlledRunProjectMemorySelectionStatus = "selected" | "omitted_unsafe" | "omitted_limit" | "missing" | "duplicate" | "unselected";

export type ControlledRunProjectMemoryAttachment = {
  noteId: string;
  titleLabel: string;
  summaryLabel: string;
  tagLabels: string[];
  taskLabel?: string;
  sessionLabel?: string;
  selectedBody?: string;
  bodyByteCount: number;
  status: ControlledRunProjectMemorySelectionStatus;
  reason: string;
};

export type ControlledRunProjectMemorySelectionInput = {
  selectedNoteIds?: readonly unknown[];
  notes?: readonly ProjectMemoryNote[];
  maxSelectedNotes?: number;
  maxBodyBytesPerNote?: number;
  maxTotalBodyBytes?: number;
};

export type ControlledRunProjectMemorySelectionSummary = {
  kind: "controlled_run_project_memory_selection";
  authority: "explicit_user_selection_only";
  cloudRequired: false;
  executionAllowed: false;
  selectedCount: number;
  attachedCount: number;
  omittedUnsafeCount: number;
  omittedLimitCount: number;
  missingCount: number;
  duplicateCount: number;
  unselectedCount: number;
  totalSelectedBodyBytes: number;
  labels: string[];
  attachments: ControlledRunProjectMemoryAttachment[];
  policy: {
    explicitSelectionRequired: true;
    canAutoSelectMemory: false;
    canSearchMemory: false;
    canCallRuntime: false;
    canCallProvider: false;
    canPersistRawBodies: false;
    oneShotForCurrentRun: true;
  };
};

const privatePathPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const unsafeTextPattern = /raw[_ -]?(?:prompt|file|diff|command|output|replacement)|file[_ -]?(?:body|content)|full[_ -]?(?:memory|body|text)|provider[_ -]?(?:payload|response|body)|bridge[_ -]?(?:payload|dump)|tool[_ -]?(?:call|output|raw)|stack[_ -]?trace|traceback|private[_ -]?path|chain[_ -]?of[_ -]?thought|\b(?:command|cmd|cwd|env|shell|git|stdout|stderr)\b|auto[_ -]?(?:attach|apply|send|run|verify|repair)|apply[_ -]?patch/i;
const textEncoder = new TextEncoder();

export function selectControlledRunProjectMemory(input: ControlledRunProjectMemorySelectionInput = {}): ControlledRunProjectMemorySelectionSummary {
  const maxSelectedNotes = clampCount(input.maxSelectedNotes, controlledRunProjectMemorySelectionLimits.maxSelectedNotes, 1, 20);
  const maxBodyBytesPerNote = clampCount(input.maxBodyBytesPerNote, controlledRunProjectMemorySelectionLimits.maxBodyBytesPerNote, 1, 8192);
  const maxTotalBodyBytes = clampCount(input.maxTotalBodyBytes, controlledRunProjectMemorySelectionLimits.maxTotalBodyBytes, 1, 24576);
  const notes = Array.isArray(input.notes) ? input.notes : [];
  const notesById = new Map(notes.map((note) => [safeId(note.id), note]).filter((entry): entry is [string, ProjectMemoryNote] => Boolean(entry[0])));
  const selectedIds = normalizeSelectedIds(input.selectedNoteIds ?? []);
  const selectedUniqueIds: string[] = [];
  const duplicateIds: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    if (seen.has(id)) {
      duplicateIds.push(id);
      continue;
    }
    seen.add(id);
    selectedUniqueIds.push(id);
  }

  const attachments: ControlledRunProjectMemoryAttachment[] = [];
  let totalBodyBytes = 0;
  for (const id of selectedUniqueIds) {
    const note = notesById.get(id);
    if (!note) {
      attachments.push(omittedAttachment(id, "missing", "Selected memory note is unavailable."));
      continue;
    }
    if (attachments.filter((attachment) => attachment.status === "selected").length >= maxSelectedNotes) {
      attachments.push(noteAttachment(note, "omitted_limit", "Selected memory note exceeds the controlled-run memory note limit."));
      continue;
    }
    const unsafeReasons = unsafeNoteReasons(note);
    if (unsafeReasons.length > 0) {
      attachments.push(noteAttachment(note, "omitted_unsafe", unsafeReasons[0] ?? "Unsafe memory note was omitted."));
      continue;
    }
    const bodyBytes = byteLength(note.text);
    if (bodyBytes > maxBodyBytesPerNote || totalBodyBytes + bodyBytes > maxTotalBodyBytes) {
      attachments.push(noteAttachment(note, "omitted_limit", "Selected memory note exceeds the controlled-run memory body budget."));
      continue;
    }
    totalBodyBytes += bodyBytes;
    attachments.push(noteAttachment(note, "selected", "Explicitly selected safe project memory for this controlled run only.", note.text, bodyBytes));
  }

  for (const id of duplicateIds) {
    attachments.push(omittedAttachment(id, "duplicate", "Duplicate memory selection was ignored."));
  }

  const selectedSet = new Set(selectedUniqueIds);
  const unselectedCount = notes.filter((note) => {
    const id = safeId(note.id);
    return id && !selectedSet.has(id);
  }).length;

  return {
    kind: "controlled_run_project_memory_selection",
    authority: "explicit_user_selection_only",
    cloudRequired: false,
    executionAllowed: false,
    selectedCount: selectedUniqueIds.length,
    attachedCount: attachments.filter((attachment) => attachment.status === "selected").length,
    omittedUnsafeCount: attachments.filter((attachment) => attachment.status === "omitted_unsafe").length,
    omittedLimitCount: attachments.filter((attachment) => attachment.status === "omitted_limit").length,
    missingCount: attachments.filter((attachment) => attachment.status === "missing").length,
    duplicateCount: duplicateIds.length,
    unselectedCount,
    totalSelectedBodyBytes: totalBodyBytes,
    labels: attachments.map(attachmentLabel).slice(0, controlledRunProjectMemorySelectionLimits.maxLabels),
    attachments,
    policy: conservativePolicy(),
  };
}

function noteAttachment(note: ProjectMemoryNote, status: ControlledRunProjectMemorySelectionStatus, reason: string, selectedBody?: string, bodyByteCount = 0): ControlledRunProjectMemoryAttachment {
  return stripUndefined({
    noteId: safeId(note.id) || "memory-note",
    titleLabel: safeLabel(note.title) || "Untitled memory note",
    summaryLabel: safeSummary(note),
    tagLabels: Array.isArray(note.tags) ? note.tags.map(safeLabel).filter((label): label is string => Boolean(label)).slice(0, 6) : [],
    taskLabel: safeLabel(note.taskLabel),
    sessionLabel: safeLabel(note.sessionLabel),
    selectedBody,
    bodyByteCount,
    status,
    reason: safeLabel(reason) || "Memory selection metadata was sanitized.",
  });
}

function omittedAttachment(noteId: string, status: ControlledRunProjectMemorySelectionStatus, reason: string): ControlledRunProjectMemoryAttachment {
  return {
    noteId: safeId(noteId) || "memory-note",
    titleLabel: "Unavailable memory note",
    summaryLabel: "Memory body omitted.",
    tagLabels: [],
    bodyByteCount: 0,
    status,
    reason: safeLabel(reason) || "Memory selection metadata was sanitized.",
  };
}

function attachmentLabel(attachment: ControlledRunProjectMemoryAttachment): string {
  return boundLabel(`controlled memory · ${attachment.status} · ${attachment.titleLabel} · ${attachment.summaryLabel}`, controlledRunProjectMemorySelectionLimits.maxSummaryChars);
}

function unsafeNoteReasons(note: ProjectMemoryNote): string[] {
  const metadataFields = [note.id, note.title, ...(Array.isArray(note.tags) ? note.tags : []), note.taskLabel, note.sessionLabel];
  const bodyFields = [note.text];
  const fields = [...metadataFields, ...bodyFields];
  const reasons: string[] = [];
  if (fields.some(isSecretLike)) {
    reasons.push("Secret-like memory content was omitted.");
  }
  if (fields.some(isPrivatePathLike)) {
    reasons.push("Private path-like memory content was omitted.");
  }
  if (fields.some(isUnsafeRawLike)) {
    reasons.push("Raw or executable memory content was omitted.");
  }
  if (!String(note.text ?? "").trim()) {
    reasons.push("Empty memory body was omitted.");
  }
  return uniqueLabels(reasons);
}

function normalizeSelectedIds(values: readonly unknown[]): string[] {
  return values.map(safeId).filter((id): id is string => Boolean(id));
}

function safeSummary(note: ProjectMemoryNote): string {
  const safeText = safeLabel(note.text);
  if (!safeText) {
    return "Memory body omitted.";
  }
  return boundLabel(safeText, controlledRunProjectMemorySelectionLimits.maxSummaryChars);
}

function safeLabel(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return undefined;
  }
  const raw = String(value);
  if (!raw.trim() || isSecretLike(raw) || isPrivatePathLike(raw) || isUnsafeRawLike(raw)) {
    return undefined;
  }
  return boundLabel(sanitizeDisplayText(raw).replace(/[\r\n]+/g, " ").trim(), controlledRunProjectMemorySelectionLimits.maxSummaryChars);
}

function safeId(value: unknown): string | undefined {
  const label = safeLabel(value);
  if (!label) {
    return undefined;
  }
  const compact = label.replace(/[^A-Za-z0-9_.:-]/g, "");
  return compact ? boundLabel(compact, 96) : undefined;
}

function isSecretLike(value: unknown): boolean {
  return typeof value === "string" && redactSecrets(value) !== value;
}

function isPrivatePathLike(value: unknown): boolean {
  return typeof value === "string" && privatePathPattern.test(value);
}

function isUnsafeRawLike(value: unknown): boolean {
  return typeof value === "string" && unsafeTextPattern.test(value);
}

function boundLabel(value: string, limit: number): string {
  const sanitized = sanitizeDisplayText(value).replace(/[\r\n]+/g, " ").trim();
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function uniqueLabels(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => boundLabel(value, controlledRunProjectMemorySelectionLimits.maxSummaryChars)).filter(Boolean)));
}

function clampCount(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(min, Math.min(value, max)) : fallback;
}

function conservativePolicy(): ControlledRunProjectMemorySelectionSummary["policy"] {
  return {
    explicitSelectionRequired: true,
    canAutoSelectMemory: false,
    canSearchMemory: false,
    canCallRuntime: false,
    canCallProvider: false,
    canPersistRawBodies: false,
    oneShotForCurrentRun: true,
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}
