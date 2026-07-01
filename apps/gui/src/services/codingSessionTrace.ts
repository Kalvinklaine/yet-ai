import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export const codingSessionTraceFamilies = [
  "gui.ready",
  "host.ready",
  "host.runtimeStatus",
  "runtime.refresh",
  "runtime.unload",
  "chat.sendAccepted",
  "chat.sendRejected",
  "chat.streamStarted",
  "chat.streamDelta",
  "chat.streamFinished",
  "chat.streamError",
  "chat.abort",
  "context.snapshot",
  "context.activeExcerpt",
  "context.snippets",
  "context.memory",
  "context.verificationAttachment",
  "ide.request",
  "ide.progress",
  "ide.result",
  "edit.detected",
  "edit.accepted",
  "edit.rejected",
  "edit.applyRequested",
  "edit.applyResult",
  "verification.runRequested",
  "verification.progress",
  "verification.result",
  "verification.followupPromptDrafted",
  "sandbox.metadataRecorded",
  "sandbox.metadataBlocked",
  "checkpoint.metadataVerified",
  "checkpoint.metadataBlocked",
  "rollback.metadataReady",
  "rollback.metadataBlocked",
  "boundedLoop.policyChecked",
  "boundedLoop.policyBlocked",
  "boundedLoop.applyReady",
  "boundedLoop.applyResult",
  "boundedLoop.verificationReady",
  "boundedLoop.verificationResult",
  "controlledAgent.fileReadPlanned",
  "controlledAgent.fileReadResult",
  "controlledAgent.fileReadBlocked",
  "controlledAgent.commandPlanned",
  "controlledAgent.commandRunning",
  "controlledAgent.commandResult",
  "controlledAgent.commandBlocked",
  "controlledAgent.editPending",
  "controlledAgent.editResult",
  "controlledAgent.editBlocked",
  "agentRun.goalReady",
  "agentRun.proposalDetected",
  "agentRun.prerequisitesBlocked",
  "agentRun.applyReady",
  "agentRun.applyRequested",
  "agentRun.applyResult",
  "agentRun.verificationReady",
  "agentRun.verificationRequested",
  "agentRun.verificationProgress",
  "agentRun.verificationResult",
  "agentRun.rollbackAvailable",
  "agentRun.completed",
  "agentRun.blocked",
] as const;

export const codingSessionTraceStatuses = [
  "info",
  "pending",
  "in_progress",
  "succeeded",
  "rejected",
  "failed",
  "cancelled",
  "unavailable",
] as const;

export type CodingSessionTraceFamily = (typeof codingSessionTraceFamilies)[number];
export type CodingSessionTraceStatus = (typeof codingSessionTraceStatuses)[number];
export type CodingSessionTraceDetailValue = string | number | boolean | null | CodingSessionTraceDetailValue[] | { [key: string]: CodingSessionTraceDetailValue };
export type CodingSessionTraceDetails = Record<string, CodingSessionTraceDetailValue>;

export type CodingSessionTraceEntry = {
  id: string;
  timestamp: string;
  family: CodingSessionTraceFamily;
  title: string;
  status: CodingSessionTraceStatus;
  summary?: string;
  requestId?: string;
  details?: CodingSessionTraceDetails;
};

export type CodingSessionTraceDraft = {
  family: unknown;
  title: unknown;
  status: unknown;
  summary?: unknown;
  requestId?: unknown;
  details?: unknown;
};

export type CodingSessionTraceCreateOptions = {
  id?: string;
  timestamp?: string | Date;
  now?: () => Date;
};

export type CodingSessionTraceAppendOptions = CodingSessionTraceCreateOptions & {
  maxEntries?: number;
};

export type CodingSessionRejectedInputSummary = {
  reasonCode: string;
  summary: string;
  details: CodingSessionTraceDetails;
};

const defaultMaxEntries = 200;
const maxTitleLength = 120;
const maxSummaryLength = 1000;
const maxRequestIdLength = 128;
const maxDetailKeyLength = 80;
const maxDetailStringLength = 500;
const maxDetailArrayItems = 20;
const maxDetailObjectEntries = 20;
const maxDetailDepth = 4;
const maxDetailNodes = 120;

const familySet = new Set<unknown>(codingSessionTraceFamilies);
const statusSet = new Set<unknown>(codingSessionTraceStatuses);

export function summarizeRejectedTraceInput(reasonCode: unknown, metadata: unknown = {}): CodingSessionRejectedInputSummary {
  const safeReasonCode = boundedSanitizedText(reasonCode, 80, "rejected_input");
  const details = sanitizeTraceDetails({ reasonCode: safeReasonCode, metadata: summarizeRejectedMetadata(metadata) }) ?? { reasonCode: safeReasonCode };
  return {
    reasonCode: safeReasonCode,
    summary: `Rejected unsafe input (${safeReasonCode}). Raw payload omitted.`,
    details,
  };
}

export function createCodingSessionTraceEntry(draft: CodingSessionTraceDraft, options: CodingSessionTraceCreateOptions = {}): CodingSessionTraceEntry {
  const entry: CodingSessionTraceEntry = {
    id: safeId(options.id) ?? createTraceId(options.now),
    timestamp: normalizeTimestamp(options.timestamp, options.now),
    family: normalizeTraceFamily(draft.family),
    title: boundedSanitizedText(draft.title, maxTitleLength, "Trace event"),
    status: normalizeTraceStatus(draft.status),
  };

  const summary = optionalBoundedText(draft.summary, maxSummaryLength);
  if (summary !== undefined) {
    entry.summary = summary;
  }

  const requestId = safeRequestId(draft.requestId);
  if (requestId !== undefined) {
    entry.requestId = requestId;
  }

  const details = sanitizeTraceDetails(draft.details);
  if (details !== undefined) {
    entry.details = details;
  }

  return entry;
}

export function appendCodingSessionTraceEntry(
  entries: readonly CodingSessionTraceEntry[],
  draft: CodingSessionTraceDraft,
  options: CodingSessionTraceAppendOptions = {},
): CodingSessionTraceEntry[] {
  const maxEntries = normalizeMaxEntries(options.maxEntries);
  if (maxEntries === 0) {
    return [];
  }
  const next = [...entries, createCodingSessionTraceEntry(draft, options)];
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}

export function sanitizeTraceDetails(value: unknown): CodingSessionTraceDetails | undefined {
  const sanitizedValue = sanitizeTraceUnsafeKeys(sanitizeDisplayValue(value));
  if (!isPlainObject(sanitizedValue)) {
    return undefined;
  }
  const budget = { remaining: maxDetailNodes };
  const entries = Object.entries(sanitizedValue).slice(0, maxDetailObjectEntries);
  const details: CodingSessionTraceDetails = {};
  for (const [key, item] of entries) {
    const safeKey = boundedSanitizedText(key, maxDetailKeyLength, "field");
    details[safeKey] = sanitizeDetailValue(item, 0, budget);
  }
  if (Object.entries(sanitizedValue).length > maxDetailObjectEntries) {
    details["[redacted]"] = `${Object.entries(sanitizedValue).length - maxDetailObjectEntries} more fields redacted`;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

export function normalizeTraceFamily(value: unknown): CodingSessionTraceFamily {
  return familySet.has(value) ? value as CodingSessionTraceFamily : "runtime.refresh";
}

export function normalizeTraceStatus(value: unknown): CodingSessionTraceStatus {
  return statusSet.has(value) ? value as CodingSessionTraceStatus : "info";
}

function sanitizeTraceUnsafeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTraceUnsafeKeys(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => isTraceUnsafeDetailKey(key) ? ["[redacted]", "[redacted]"] : [key, sanitizeTraceUnsafeKeys(item)]));
  }
  return value;
}

function isTraceUnsafeDetailKey(key: string): boolean {
  return /^(?:rawCommand|raw_command|rawFileBody|raw_file_body|fileBody|file_body|rawDiff|raw_diff|diff|rawOutput|raw_output|text|body|memoryBody|memory_body|noteBody|note_body|command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|privatePath|private_path|stackTrace|stack_trace|callstack|affectedFiles|affected_files|touchedFiles|touched_files)$/i.test(key);
}

function summarizeRejectedMetadata(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, maxDetailObjectEntries)) {
    if (typeof item === "string" && (key === "payload" || key === "rawPayload" || item.trim().startsWith("{") || item.trim().startsWith("["))) {
      out[key] = "[redacted]";
    } else {
      out[key] = item;
    }
  }
  return out;
}

function sanitizeDetailValue(value: unknown, depth: number, budget: { remaining: number }): CodingSessionTraceDetailValue {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > maxDetailDepth) {
    return "[redacted]";
  }

  const sanitized = sanitizeDisplayValue(value);
  if (typeof sanitized === "string") {
    return boundedSanitizedText(sanitized, maxDetailStringLength, "");
  }
  if (typeof sanitized === "number") {
    return Number.isFinite(sanitized) ? sanitized : null;
  }
  if (typeof sanitized === "boolean" || sanitized === null) {
    return sanitized;
  }
  if (Array.isArray(sanitized)) {
    const result = sanitized.slice(0, maxDetailArrayItems).map((item) => sanitizeDetailValue(item, depth + 1, budget));
    if (sanitized.length > maxDetailArrayItems) {
      result.push(`${sanitized.length - maxDetailArrayItems} more items redacted`);
    }
    return result;
  }
  if (isPlainObject(sanitized)) {
    const result: Record<string, CodingSessionTraceDetailValue> = {};
    const entries = Object.entries(sanitized).slice(0, maxDetailObjectEntries);
    for (const [key, item] of entries) {
      result[boundedSanitizedText(key, maxDetailKeyLength, "field")] = sanitizeDetailValue(item, depth + 1, budget);
    }
    if (Object.entries(sanitized).length > maxDetailObjectEntries) {
      result["[redacted]"] = `${Object.entries(sanitized).length - maxDetailObjectEntries} more fields redacted`;
    }
    return result;
  }
  return "[redacted]";
}

function boundedSanitizedText(value: unknown, limit: number, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function optionalBoundedText(value: unknown, limit: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = boundedSanitizedText(value, limit, "");
  return text.length > 0 ? text : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(sanitized) || hasSecretRequestIdMarker(sanitized)) {
    return undefined;
  }
  return sanitized.length > maxRequestIdLength ? sanitized.slice(0, maxRequestIdLength) : sanitized;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(sanitized) ? sanitized : undefined;
}

function createTraceId(now: CodingSessionTraceCreateOptions["now"]): string {
  const time = (now?.() ?? new Date()).getTime().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `trace-${time}-${random}`;
}

function normalizeTimestamp(value: CodingSessionTraceCreateOptions["timestamp"], now: CodingSessionTraceCreateOptions["now"]): string {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : now?.() ?? new Date();
  return Number.isNaN(date.getTime()) ? (now?.() ?? new Date()).toISOString() : date.toISOString();
}

function normalizeMaxEntries(value: unknown): number {
  if (!Number.isInteger(value)) {
    return defaultMaxEntries;
  }
  return Math.max(0, Math.min(value as number, defaultMaxEntries));
}

function hasSecretRequestIdMarker(value: string): boolean {
  return /authorization|bearer|api[_-]?key|token|secret|access[_-]?token|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
