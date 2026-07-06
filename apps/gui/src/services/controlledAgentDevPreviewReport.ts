import { sanitizeTimelineText } from "./redaction";

export type ControlledAgentDevPreviewReportHost = "browser" | "vscode" | "jetbrains" | "unknown";
export type ControlledAgentDevPreviewReportStatus = "not_started" | "ready" | "running" | "completed" | "stopped" | "failed" | "blocked";
export type ControlledAgentDevPreviewCapability = "explicit_start" | "bounded_read" | "bounded_edit" | "allowlisted_verification" | "bounded_repair" | "sanitized_report";
export type ControlledAgentDevPreviewEvidenceKind = "start" | "read" | "edit" | "verification" | "repair" | "stop" | "status";

export type ControlledAgentDevPreviewReportCounters = {
  loopSteps?: number;
  fileReads?: number;
  filesTouched?: number;
  verificationRuns?: number;
  repairAttempts?: number;
  userTurns?: number;
  runtimeSeconds?: number;
};

export type ControlledAgentDevPreviewEvidenceInput = {
  kind?: unknown;
  status?: unknown;
  summary?: unknown;
};

export type ControlledAgentDevPreviewReportInput = {
  host?: unknown;
  status?: unknown;
  capabilities?: Partial<Record<ControlledAgentDevPreviewCapability, unknown>>;
  counters?: Partial<Record<keyof ControlledAgentDevPreviewReportCounters, unknown>>;
  currentUserAction?: unknown;
  limitations?: unknown;
  evidence?: unknown;
  safetyBoundaries?: unknown;
};

export type ControlledAgentDevPreviewEvidence = {
  label: string;
  summary: string;
};

export type ControlledAgentDevPreviewReport = {
  host: ControlledAgentDevPreviewReportHost;
  hostLabel: string;
  status: ControlledAgentDevPreviewReportStatus;
  statusLabel: string;
  capabilityLabels: string[];
  counters: ControlledAgentDevPreviewReportCounters;
  currentUserActionLabel: string;
  limitationLabels: string[];
  evidence: ControlledAgentDevPreviewEvidence[];
  safetyBoundaryLabels: string[];
};

const capabilityLabels: Record<ControlledAgentDevPreviewCapability, string> = {
  explicit_start: "Explicit user start required",
  bounded_read: "One bounded local read",
  bounded_edit: "One bounded user-confirmed edit",
  allowlisted_verification: "One allowlisted verification run",
  bounded_repair: "One user-confirmed bounded repair attempt",
  sanitized_report: "Sanitized display-only report",
};

const hostLabels: Record<ControlledAgentDevPreviewReportHost, string> = {
  browser: "Browser preview host",
  vscode: "VS Code host",
  jetbrains: "JetBrains host",
  unknown: "Unknown host",
};

const statusLabels: Record<ControlledAgentDevPreviewReportStatus, string> = {
  not_started: "Not started",
  ready: "Ready for explicit user start",
  running: "Running after explicit user start",
  completed: "Completed with sanitized evidence",
  stopped: "Stopped by explicit boundary",
  failed: "Failed closed",
  blocked: "Blocked until local readiness returns",
};

const actionLabels: Record<string, string> = {
  start: "User may start the dev-preview from VS Code when local readiness is present.",
  wait: "User should wait for current bounded metadata to finish.",
  review: "User should review sanitized report evidence.",
  stop: "User may start again only with a new explicit action.",
  retry: "User may retry after fixing the reported local limitation.",
  none: "No user action is currently available.",
};

const limitationLabels: Record<string, string> = {
  browser_unsupported: "Browser preview cannot start the controlled local agent dev-preview.",
  jetbrains_partial: "JetBrains support is partial and fail-closed in this VS Code-first dev-preview.",
  missing_runtime: "Local runtime readiness metadata is required.",
  missing_workspace: "Workspace readiness metadata is required.",
  verification_failed: "Allowlisted verification failed; no automatic repair is started.",
  stopped: "Controlled dev-preview is stopped until the user starts it again.",
  unsupported_host: "Supported IDE host metadata is unavailable.",
};

const safetyLabels: Record<string, string> = {
  local_first: "Local-first BYOK boundary: no hosted Yet AI backend is required.",
  explicit_user_start: "No automatic start; the user must explicitly start the dev-preview.",
  metadata_only: "Report is display-only sanitized metadata, not runtime authority.",
  bounded_work: "Work remains bounded to one read, one edit, one verification, and one repair attempt.",
  no_raw_secrets: "Raw file bodies, diffs, command output, provider payloads, private paths, and secrets are omitted.",
};

const evidenceLabels: Record<ControlledAgentDevPreviewEvidenceKind, string> = {
  start: "Explicit start evidence",
  read: "Bounded read evidence",
  edit: "Bounded edit evidence",
  verification: "Allowlisted verification evidence",
  repair: "Bounded repair evidence",
  stop: "Stop evidence",
  status: "Status evidence",
};

const allowedCounters: Array<keyof ControlledAgentDevPreviewReportCounters> = ["loopSteps", "fileReads", "filesTouched", "verificationRuns", "repairAttempts", "userTurns", "runtimeSeconds"];
const capabilityOrder: ControlledAgentDevPreviewCapability[] = ["explicit_start", "bounded_read", "bounded_edit", "allowlisted_verification", "bounded_repair", "sanitized_report"];
const defaultBoundaries = ["local_first", "explicit_user_start", "metadata_only", "bounded_work", "no_raw_secrets"];
const unsafeKeyPattern = /(?:command|cmd|args|cwd|env|shell|git|network|provider|tool|package|raw|fileBody|fileContents|prompt|diff|patch|privatePath|path|token|secret|password|cookie|authorization)/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff|patch)|file[_ -]?(?:body|content)|provider(?:[_ -]?(?:payload|response))?|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|\bnpm\s+run\b|network|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;

export function createControlledAgentDevPreviewReport(input: unknown): ControlledAgentDevPreviewReport {
  const metadata = isPlainObject(input) ? (input as ControlledAgentDevPreviewReportInput) : {};
  const host = normalizeHost(metadata.host);
  const status = normalizeStatus(metadata.status, host);

  return {
    host,
    hostLabel: hostLabels[host],
    status,
    statusLabel: statusLabels[status],
    capabilityLabels: normalizeCapabilities(metadata.capabilities, host),
    counters: normalizeCounters(metadata.counters),
    currentUserActionLabel: normalizeAction(metadata.currentUserAction, status),
    limitationLabels: normalizeLimitations(metadata.limitations, host, status),
    evidence: normalizeEvidence(metadata.evidence),
    safetyBoundaryLabels: normalizeSafetyBoundaries(metadata.safetyBoundaries),
  };
}

function normalizeHost(value: unknown): ControlledAgentDevPreviewReportHost {
  if (value === "browser" || value === "vscode" || value === "jetbrains") return value;
  return "unknown";
}

function normalizeStatus(value: unknown, host: ControlledAgentDevPreviewReportHost): ControlledAgentDevPreviewReportStatus {
  if (host === "browser" || host === "unknown") return "blocked";
  if (host === "jetbrains" && value !== "not_started" && value !== "ready") return "blocked";
  if (value === "not_started" || value === "ready" || value === "running" || value === "completed" || value === "stopped" || value === "failed" || value === "blocked") return value;
  return "not_started";
}

function normalizeCapabilities(input: ControlledAgentDevPreviewReportInput["capabilities"], host: ControlledAgentDevPreviewReportHost): string[] {
  if (host === "browser" || host === "unknown") return [capabilityLabels.sanitized_report];
  if (!isPlainObject(input)) return [capabilityLabels.sanitized_report];
  return capabilityOrder.filter((key) => input[key] === true || key === "sanitized_report").map((key) => capabilityLabels[key]).slice(0, 6);
}

function normalizeCounters(input: ControlledAgentDevPreviewReportInput["counters"]): ControlledAgentDevPreviewReportCounters {
  if (!isPlainObject(input)) return {};
  const counters: ControlledAgentDevPreviewReportCounters = {};
  for (const key of allowedCounters) {
    const value = input[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 9999) counters[key] = value;
  }
  return counters;
}

function normalizeAction(value: unknown, status: ControlledAgentDevPreviewReportStatus): string {
  if (typeof value === "string" && actionLabels[value]) return actionLabels[value];
  if (status === "ready" || status === "not_started") return actionLabels.start;
  if (status === "running") return actionLabels.wait;
  if (status === "completed") return actionLabels.review;
  if (status === "stopped") return actionLabels.stop;
  if (status === "failed" || status === "blocked") return actionLabels.retry;
  return actionLabels.none;
}

function normalizeLimitations(value: unknown, host: ControlledAgentDevPreviewReportHost, status: ControlledAgentDevPreviewReportStatus): string[] {
  const keys = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && limitationLabels[item] !== undefined) : [];
  if (host === "browser") keys.push("browser_unsupported");
  if (host === "jetbrains") keys.push("jetbrains_partial");
  if (host === "unknown") keys.push("unsupported_host");
  if (status === "failed") keys.push("verification_failed");
  if (status === "stopped") keys.push("stopped");
  const labels = Array.from(new Set(keys)).map((key) => limitationLabels[key]).slice(0, 8);
  return labels.length > 0 ? labels : ["No current dev-preview limitations were reported."];
}

function normalizeEvidence(value: unknown): ControlledAgentDevPreviewEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map(toEvidence).filter((item): item is ControlledAgentDevPreviewEvidence => item !== undefined);
}

function toEvidence(value: unknown): ControlledAgentDevPreviewEvidence | undefined {
  if (!isPlainObject(value)) return { label: "Omitted unsafe evidence", summary: "Evidence omitted because it looked unsafe for dev-preview reporting." };
  const kind = normalizeEvidenceKind(value.kind);
  const status = typeof value.status === "string" && !unsafeTextPattern.test(value.status) ? safeText(value.status, 80) : "recorded";
  if (hasUnsafeKey(value)) return { label: "Omitted unsafe evidence", summary: "Evidence omitted because it looked unsafe for dev-preview reporting." };
  if (hasUnsafeText(value)) return { label: `${evidenceLabels[kind]}: ${status}`, summary: "Sanitized evidence summary was unavailable." };
  const summary = typeof value.summary === "string" && !unsafeTextPattern.test(value.summary) ? safeText(value.summary, 180) : "Sanitized evidence summary was unavailable.";
  return { label: `${evidenceLabels[kind]}: ${status}`, summary };
}

function normalizeEvidenceKind(value: unknown): ControlledAgentDevPreviewEvidenceKind {
  if (value === "start" || value === "read" || value === "edit" || value === "verification" || value === "repair" || value === "stop" || value === "status") return value;
  return "status";
}

function normalizeSafetyBoundaries(value: unknown): string[] {
  const keys = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && safetyLabels[item] !== undefined) : defaultBoundaries;
  return Array.from(new Set(keys.length > 0 ? keys : defaultBoundaries)).map((key) => safetyLabels[key]).slice(0, 8);
}


function hasUnsafeKey(value: Record<string, unknown>): boolean {
  return Object.keys(value).slice(0, 24).some((key) => unsafeKeyPattern.test(key));
}

function hasUnsafeText(value: Record<string, unknown>): boolean {
  return Object.values(value).slice(0, 24).some((item) => typeof item === "string" && unsafeTextPattern.test(item));
}

function safeText(input: string, limit: number): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : "Controlled dev-preview report metadata is unavailable.";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
