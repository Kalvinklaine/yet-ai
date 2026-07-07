import { sanitizeTimelineText } from "./redaction";

export type ControlledAgentDevPreviewReportHost = "browser" | "vscode" | "jetbrains" | "unknown";
export type ControlledAgentDevPreviewReportStatus = "not_started" | "ready" | "running" | "completed" | "stopped" | "failed" | "blocked";
export type ControlledAgentDevPreviewCapability = "explicit_start" | "bounded_read" | "bounded_edit" | "allowlisted_verification" | "bounded_repair" | "sanitized_report";
export type ControlledAgentDevPreviewEvidenceKind = "start" | "read" | "edit" | "verification" | "repair" | "stop" | "status";
export type SanitizedControlledRunExportStatus = "not_started" | "running" | "completed" | "stopped" | "failed" | "blocked";
export type SanitizedControlledRunExportTraceType = "start" | "read" | "edit" | "verify" | "report" | "stop" | "recovery";
export type SanitizedControlledRunExportDiagnosticCode = "malformed_input" | "unsafe_metadata" | "raw_payload_omitted";

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
export type SanitizedControlledRunExportTraceInput = {
  type?: unknown;
  outcome?: unknown;
  label?: unknown;
  summary?: unknown;
  requestId?: unknown;
  runId?: unknown;
  details?: unknown;
};

export type SanitizedControlledRunExportInput = {
  runId?: unknown;
  host?: unknown;
  status?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  counters?: Partial<Record<keyof ControlledAgentDevPreviewReportCounters, unknown>>;
  trace?: unknown;
  evidence?: unknown;
  safetyBoundaries?: unknown;
};

export type SanitizedControlledRunExportTraceItem = {
  type: SanitizedControlledRunExportTraceType;
  status: string;
  label: string;
  summary: string;
};

export type SanitizedControlledRunExportDiagnostic = {
  code: SanitizedControlledRunExportDiagnosticCode;
  message: string;
};

export type SanitizedControlledRunExport = {
  kind: "controlled_run.sanitized_export";
  version: "2026-07-07";
  displayOnly: true;
  metadataOnly: true;
  rawPayloadStored: false;
  rawPayloadReturned: false;
  executionAuthority: false;
  runId?: string;
  host: ControlledAgentDevPreviewReportHost;
  status: SanitizedControlledRunExportStatus;
  statusLabel: string;
  startedAt?: string;
  completedAt?: string;
  counters: ControlledAgentDevPreviewReportCounters;
  trace: SanitizedControlledRunExportTraceItem[];
  evidence: ControlledAgentDevPreviewEvidence[];
  safetyBoundaryLabels: string[];
  diagnostics: SanitizedControlledRunExportDiagnostic[];
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
const exportStatusLabels: Record<SanitizedControlledRunExportStatus, string> = {
  not_started: "Not started",
  running: "Running after explicit user start",
  completed: "Completed with sanitized metadata",
  stopped: "Stopped by explicit boundary",
  failed: "Failed closed",
  blocked: "Blocked because safe export metadata was unavailable",
};

const exportTraceLabels: Record<SanitizedControlledRunExportTraceType, string> = {
  start: "Explicit start",
  read: "Bounded read",
  edit: "Bounded edit",
  verify: "Allowlisted verification",
  report: "Sanitized report",
  stop: "Controlled stop",
  recovery: "Recovery evidence",
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

export function createSanitizedControlledRunExport(input: unknown): SanitizedControlledRunExport {
  const diagnostics: SanitizedControlledRunExportDiagnostic[] = [];
  if (!isPlainObject(input)) diagnostics.push(exportDiagnostic("malformed_input", "Controlled run export metadata must be an object."));
  const metadata = isPlainObject(input) ? input as SanitizedControlledRunExportInput : {};
  const host = normalizeHost(metadata.host);
  const status = normalizeExportStatus(metadata.status, host);
  const runId = safeId(metadata.runId);
  if (metadata.runId !== undefined && runId === undefined) diagnostics.push(exportDiagnostic("unsafe_metadata", "Unsafe run identifier was omitted from the controlled-run export."));
  const startedAt = safeTimestamp(metadata.startedAt);
  const completedAt = safeTimestamp(metadata.completedAt);
  if (metadata.startedAt !== undefined && startedAt === undefined) diagnostics.push(exportDiagnostic("unsafe_metadata", "Unsafe start timestamp was omitted from the controlled-run export."));
  if (metadata.completedAt !== undefined && completedAt === undefined) diagnostics.push(exportDiagnostic("unsafe_metadata", "Unsafe completion timestamp was omitted from the controlled-run export."));
  const trace = normalizeExportTrace(metadata.trace, diagnostics);
  const evidence = normalizeEvidence(metadata.evidence);

  return {
    kind: "controlled_run.sanitized_export",
    version: "2026-07-07",
    displayOnly: true,
    metadataOnly: true,
    rawPayloadStored: false,
    rawPayloadReturned: false,
    executionAuthority: false,
    ...(runId ? { runId } : {}),
    host,
    status,
    statusLabel: exportStatusLabels[status],
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    counters: normalizeCounters(metadata.counters),
    trace,
    evidence,
    safetyBoundaryLabels: normalizeSafetyBoundaries(metadata.safetyBoundaries),
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

function normalizeExportStatus(value: unknown, host: ControlledAgentDevPreviewReportHost): SanitizedControlledRunExportStatus {
  if (host === "browser" || host === "unknown") return "blocked";
  if (value === "not_started" || value === "running" || value === "completed" || value === "stopped" || value === "failed" || value === "blocked") return value;
  return "blocked";
}

function normalizeExportTrace(value: unknown, diagnostics: SanitizedControlledRunExportDiagnostic[]): SanitizedControlledRunExportTraceItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((item) => toExportTraceItem(item, diagnostics)).filter((item): item is SanitizedControlledRunExportTraceItem => item !== undefined);
}

function toExportTraceItem(value: unknown, diagnostics: SanitizedControlledRunExportDiagnostic[]): SanitizedControlledRunExportTraceItem | undefined {
  if (!isPlainObject(value)) {
    diagnostics.push(exportDiagnostic("malformed_input", "Non-object controlled-run trace item was omitted."));
    return undefined;
  }
  if (hasUnsafeKey(value)) {
    diagnostics.push(exportDiagnostic("raw_payload_omitted", "Controlled-run trace item with raw payload fields was omitted."));
    return undefined;
  }
  const type = normalizeExportTraceType(value.type);
  const status = safeExportStatus(value.outcome ?? value.status);
  const label = safeExportText(value.label, exportTraceLabels[type], 100);
  const summary = safeExportText(value.summary, "Sanitized controlled-run metadata recorded; raw payload omitted.", 180);
  if (hasUnsafeText({ status, label, summary }) || hasUnsafeText(value)) {
    diagnostics.push(exportDiagnostic("raw_payload_omitted", "Unsafe controlled-run trace text was replaced with sanitized export metadata."));
    return {
      type,
      status: "recorded",
      label: exportTraceLabels[type],
      summary: "Sanitized controlled-run metadata recorded; raw payload omitted.",
    };
  }
  return { type, status, label, summary };
}

function normalizeExportTraceType(value: unknown): SanitizedControlledRunExportTraceType {
  if (value === "start" || value === "read" || value === "edit" || value === "verify" || value === "report" || value === "stop" || value === "recovery") return value;
  return "report";
}

function safeExportStatus(value: unknown): string {
  if (typeof value !== "string" || unsafeTextPattern.test(value)) return "recorded";
  return safeText(value, 40);
}

function safeExportText(value: unknown, fallback: string, limit: number): string {
  if (typeof value !== "string" || unsafeTextPattern.test(value)) return fallback;
  return safeText(value, limit);
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string" || unsafeTextPattern.test(value)) return undefined;
  const sanitized = sanitizeTimelineText(value).trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(sanitized) ? sanitized : undefined;
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || unsafeTextPattern.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function exportDiagnostic(code: SanitizedControlledRunExportDiagnosticCode, message: string): SanitizedControlledRunExportDiagnostic {
  return { code, message };
}

function dedupeDiagnostics(diagnostics: SanitizedControlledRunExportDiagnostic[]): SanitizedControlledRunExportDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  }).slice(0, 8);
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
