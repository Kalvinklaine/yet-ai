import { redactSecrets, sanitizeDisplayText } from "./redaction";

export const controlledRunHistoryLimits = {
  defaultMaxItems: 50,
  maxItems: 200,
  maxLabelLength: 120,
  maxSummaryLabels: 5,
  maxArtifactLabels: 10,
  maxChecksumLabels: 10,
  maxCounters: 12,
  maxCounterValue: 9999,
} as const;

export const controlledRunHistoryHostLabels = ["vscode", "browser_preview_only", "jetbrains_unsupported", "unknown_host"] as const;
export const controlledRunHistoryReadinessLabels = ["opt_in_ready", "workspace_ready", "checkpoint_ready", "rollback_plan_ready", "not_ready", "unknown_readiness"] as const;
export const controlledRunHistoryPhaseLabels = ["queued", "ready", "running", "reading", "editing", "verifying", "stopping", "stopped", "failed", "completed", "blocked"] as const;
export const controlledRunHistoryResultLabels = ["pending", "succeeded", "failed", "timed_out", "killed", "user_stopped", "unsupported_host", "unsafe_metadata_blocked"] as const;

export type ControlledRunHistoryHostLabel = (typeof controlledRunHistoryHostLabels)[number];
export type ControlledRunHistoryReadinessLabel = (typeof controlledRunHistoryReadinessLabels)[number];
export type ControlledRunHistoryPhaseLabel = (typeof controlledRunHistoryPhaseLabels)[number];
export type ControlledRunHistoryResultLabel = (typeof controlledRunHistoryResultLabels)[number];

export type ControlledRunHistoryCounterName =
  | "read_count"
  | "edit_count"
  | "verification_count"
  | "repair_attempt_count"
  | "artifact_count"
  | "omitted_unsafe_count"
  | "duration_bucket"
  | "byte_bucket"
  | "line_bucket";

export type ControlledRunHistoryCounter = {
  name: ControlledRunHistoryCounterName;
  value: number;
};

export type ControlledRunHistoryArtifactLabel = {
  label: string;
  checksumLabel?: string;
  sizeBucketLabel?: string;
  retentionLabel?: string;
};

export type ControlledRunHistoryItem = {
  schemaVersion: "controlled_run_history.v1";
  runId: string;
  createdAtLabel: string;
  updatedAtLabel: string;
  hostLabel: ControlledRunHistoryHostLabel;
  readinessLabels: ControlledRunHistoryReadinessLabel[];
  phaseLabel: ControlledRunHistoryPhaseLabel;
  resultLabel: ControlledRunHistoryResultLabel;
  counters: ControlledRunHistoryCounter[];
  summaryLabels: string[];
  artifactLabels: ControlledRunHistoryArtifactLabel[];
  checksumLabels: string[];
  safetyLabels: string[];
};

export type ControlledRunHistoryDraft = {
  runId: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  hostLabel?: unknown;
  readinessLabels?: unknown;
  phaseLabel?: unknown;
  resultLabel?: unknown;
  counters?: unknown;
  summaryLabels?: unknown;
  artifactLabels?: unknown;
  checksumLabels?: unknown;
};

const hostLabelSet = new Set<unknown>(controlledRunHistoryHostLabels);
const readinessLabelSet = new Set<unknown>(controlledRunHistoryReadinessLabels);
const phaseLabelSet = new Set<unknown>(controlledRunHistoryPhaseLabels);
const resultLabelSet = new Set<unknown>(controlledRunHistoryResultLabels);
const counterNameSet = new Set<unknown>(["read_count", "edit_count", "verification_count", "repair_attempt_count", "artifact_count", "omitted_unsafe_count", "duration_bucket", "byte_bucket", "line_bucket"] satisfies ControlledRunHistoryCounterName[]);
const safeChecksumPattern = /^sha256:[a-f0-9]{64}$/i;
const safeTokenPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const unsafeTextPattern = /raw\s+(?:prompt|file|diff|command|stdout|stderr|log|provider|payload)|file\s+bod(?:y|ies)|bridge\s+payload|provider\s+(?:payload|response)|command\s+(?:string|output)|stdout|stderr|private\s+path|secret|api[_ -]?key|access[_ -]?token|bearer\s+[A-Za-z0-9._~+/=-]+|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/i;
const unsafeKeyPattern = /(?:prompt|body|diff|patch|command|cmd|stdout|stderr|provider|payload|path|secret|token|api[_-]?key|authorization|cookie|env|cwd|file|content|transcript|log)/i;

export function createControlledRunHistoryItem(draft: ControlledRunHistoryDraft, now: () => Date = () => new Date()): ControlledRunHistoryItem {
  const createdAtLabel = sanitizeControlledRunHistoryTimestamp(draft.createdAt, now);
  const updatedAtLabel = sanitizeControlledRunHistoryTimestamp(draft.updatedAt, now);
  const counters = sanitizeControlledRunHistoryCounters(draft.counters);
  const summaryLabels = sanitizeControlledRunHistoryLabels(draft.summaryLabels, controlledRunHistoryLimits.maxSummaryLabels);
  const artifactLabels = sanitizeControlledRunHistoryArtifacts(draft.artifactLabels);
  const checksumLabels = sanitizeControlledRunHistoryChecksumLabels(draft.checksumLabels);
  const omittedUnsafeCount = countUnsafeDraftValues(draft);
  const safetyLabels = ["metadata_only", "raw_payloads_omitted"];

  if (omittedUnsafeCount > 0) {
    safetyLabels.push("unsafe_metadata_omitted");
  }

  const safeCounters = omittedUnsafeCount > 0
    ? mergeCounter(counters, { name: "omitted_unsafe_count", value: omittedUnsafeCount })
    : counters;

  return {
    schemaVersion: "controlled_run_history.v1",
    runId: sanitizeControlledRunHistoryId(draft.runId) ?? "run-omitted-unsafe",
    createdAtLabel,
    updatedAtLabel,
    hostLabel: normalizeHostLabel(draft.hostLabel),
    readinessLabels: sanitizeReadinessLabels(draft.readinessLabels),
    phaseLabel: normalizePhaseLabel(draft.phaseLabel),
    resultLabel: omittedUnsafeCount > 0 ? "unsafe_metadata_blocked" : normalizeResultLabel(draft.resultLabel),
    counters: safeCounters,
    summaryLabels,
    artifactLabels,
    checksumLabels,
    safetyLabels,
  };
}

export function appendControlledRunHistoryItem(
  items: readonly ControlledRunHistoryItem[],
  item: ControlledRunHistoryItem,
  maxItems: number = controlledRunHistoryLimits.defaultMaxItems,
): ControlledRunHistoryItem[] {
  const limit = normalizeHistoryLimit(maxItems);
  if (limit === 0) {
    return [];
  }
  const next = [...items, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function sanitizeControlledRunHistoryLabel(value: unknown): string | undefined {
  if (typeof value !== "string" || isUnsafeHistoryText(value)) {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value);
  if (!sanitized || sanitized.includes("[redacted]") || isUnsafeHistoryText(sanitized)) {
    return undefined;
  }
  return sanitized.length > controlledRunHistoryLimits.maxLabelLength ? `${sanitized.slice(0, controlledRunHistoryLimits.maxLabelLength)}…` : sanitized;
}

export function sanitizeControlledRunHistoryCounter(name: unknown, value: unknown): ControlledRunHistoryCounter | undefined {
  if (!counterNameSet.has(name) || typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return {
    name: name as ControlledRunHistoryCounterName,
    value: Math.max(0, Math.min(Math.floor(value), controlledRunHistoryLimits.maxCounterValue)),
  };
}

export function sanitizeControlledRunHistoryArtifactLabel(value: unknown): ControlledRunHistoryArtifactLabel | undefined {
  if (!isPlainObject(value)) {
    const label = sanitizeControlledRunHistoryLabel(value);
    return label ? { label } : undefined;
  }
  const label = sanitizeControlledRunHistoryLabel(value.label);
  if (!label || Object.keys(value).some((key) => isUnsafeHistoryKey(key))) {
    return undefined;
  }
  const checksumLabel = sanitizeControlledRunHistoryChecksumLabel(value.checksumLabel);
  const sizeBucketLabel = sanitizeControlledRunHistoryLabel(value.sizeBucketLabel);
  const retentionLabel = sanitizeControlledRunHistoryLabel(value.retentionLabel);
  return {
    label,
    ...(checksumLabel ? { checksumLabel } : {}),
    ...(sizeBucketLabel ? { sizeBucketLabel } : {}),
    ...(retentionLabel ? { retentionLabel } : {}),
  };
}

function sanitizeControlledRunHistoryId(value: unknown): string | undefined {
  if (typeof value !== "string" || isUnsafeHistoryText(value)) {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeTokenPattern.test(sanitized) && !isUnsafeHistoryText(sanitized) ? sanitized : undefined;
}

function sanitizeControlledRunHistoryTimestamp(value: unknown, now: () => Date): string {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : now();
  const safeDate = Number.isNaN(date.getTime()) ? now() : date;
  return safeDate.toISOString();
}

function sanitizeControlledRunHistoryLabels(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map(sanitizeControlledRunHistoryLabel).filter((label): label is string => Boolean(label)).slice(0, limit);
}

function sanitizeReadinessLabels(value: unknown): ControlledRunHistoryReadinessLabel[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const labels = values.filter((label): label is ControlledRunHistoryReadinessLabel => readinessLabelSet.has(label)).slice(0, 4);
  return labels.length > 0 ? labels : ["unknown_readiness"];
}

function sanitizeControlledRunHistoryCounters(value: unknown): ControlledRunHistoryCounter[] {
  const values = Array.isArray(value) ? value : [];
  const counters: ControlledRunHistoryCounter[] = [];
  for (const item of values.slice(0, controlledRunHistoryLimits.maxCounters)) {
    if (!isPlainObject(item)) {
      continue;
    }
    if (Object.keys(item).some((key) => isUnsafeHistoryKey(key))) {
      continue;
    }
    const counter = sanitizeControlledRunHistoryCounter(item.name, item.value);
    if (counter) {
      counters.push(counter);
    }
  }
  return counters;
}

function sanitizeControlledRunHistoryArtifacts(value: unknown): ControlledRunHistoryArtifactLabel[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map(sanitizeControlledRunHistoryArtifactLabel).filter((label): label is ControlledRunHistoryArtifactLabel => Boolean(label)).slice(0, controlledRunHistoryLimits.maxArtifactLabels);
}

function sanitizeControlledRunHistoryChecksumLabels(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map(sanitizeControlledRunHistoryChecksumLabel).filter((label): label is string => Boolean(label)).slice(0, controlledRunHistoryLimits.maxChecksumLabels);
}

function sanitizeControlledRunHistoryChecksumLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = value.trim().toLowerCase();
  return safeChecksumPattern.test(sanitized) ? sanitized : undefined;
}

function normalizeHostLabel(value: unknown): ControlledRunHistoryHostLabel {
  return hostLabelSet.has(value) ? value as ControlledRunHistoryHostLabel : "unknown_host";
}

function normalizePhaseLabel(value: unknown): ControlledRunHistoryPhaseLabel {
  return phaseLabelSet.has(value) ? value as ControlledRunHistoryPhaseLabel : "blocked";
}

function normalizeResultLabel(value: unknown): ControlledRunHistoryResultLabel {
  return resultLabelSet.has(value) ? value as ControlledRunHistoryResultLabel : "pending";
}

function normalizeHistoryLimit(value: unknown): number {
  if (!Number.isInteger(value)) {
    return controlledRunHistoryLimits.defaultMaxItems;
  }
  return Math.max(0, Math.min(value as number, controlledRunHistoryLimits.maxItems));
}

function mergeCounter(counters: ControlledRunHistoryCounter[], counter: ControlledRunHistoryCounter): ControlledRunHistoryCounter[] {
  const existing = counters.find((item) => item.name === counter.name);
  if (existing) {
    return counters.map((item) => item.name === counter.name ? { ...item, value: Math.min(controlledRunHistoryLimits.maxCounterValue, item.value + counter.value) } : item);
  }
  return [...counters, counter].slice(0, controlledRunHistoryLimits.maxCounters);
}

function countUnsafeDraftValues(value: unknown): number {
  return countUnsafeDraftValuesInner(value, "");
}

function countUnsafeDraftValuesInner(value: unknown, key: string): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countUnsafeDraftValuesInner(item, key), 0);
  }
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((count, [itemKey, item]) => count + (isUnsafeHistoryKey(itemKey) ? 1 : countUnsafeDraftValuesInner(item, itemKey)), 0);
  }
  return typeof value === "string" && key !== "checksumLabel" && key !== "checksumLabels" && isUnsafeHistoryText(value) ? 1 : 0;
}

function isUnsafeHistoryKey(key: string): boolean {
  return unsafeKeyPattern.test(key);
}

function isUnsafeHistoryText(value: string): boolean {
  return redactSecrets(value) !== value || unsafeTextPattern.test(value) || /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
