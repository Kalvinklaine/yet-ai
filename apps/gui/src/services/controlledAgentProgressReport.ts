export type ControlledAgentProgressStatus = "disabled" | "running" | "waiting" | "completed" | "stopped" | "failed" | "blocked";

export type ControlledAgentProgressCounters = {
  stepsCompleted: number;
  fileReadsUsed: number;
  readBytesUsed: number;
  filesTouched: number;
  patchBytesUsed: number;
  verificationRuns: number;
  repairAttempts: number;
  runtimeSeconds: number;
  userTurns: number;
};

export type ControlledAgentProgressLimits = {
  maxSteps: number;
  maxFileReads: number;
  maxReadBytes: number;
  maxTouchedFiles: number;
  maxPatchBytes: number;
  maxRuntimeSeconds: number;
  maxRepairAttempts: number;
};

export type ControlledAgentProgressSafetyFlags = {
  authority: "progress_report_metadata_only";
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  autoStartAllowed: false;
  canReadFiles: false;
  canWriteFiles: false;
  canRunCommands: false;
  canApplyEdits: false;
  canCallProvider: false;
  canUseGit: false;
  canUseTools: false;
  canAutoRollback: false;
  canStartAutonomousLoop: false;
};

export type ControlledAgentProgressFinalReport = {
  status: ControlledAgentProgressStatus;
  title: string;
  summary: string;
  counters: ControlledAgentProgressCounters;
  limits: ControlledAgentProgressLimits;
  diagnostics: string[];
};

export type ControlledAgentProgressReport = {
  status: ControlledAgentProgressStatus;
  phaseLabel: string;
  currentStepLabel: string;
  counters: ControlledAgentProgressCounters;
  limits: ControlledAgentProgressLimits;
  safetyFlags: ControlledAgentProgressSafetyFlags;
  finalReport?: ControlledAgentProgressFinalReport;
  diagnostics: string[];
};

type ReportParts = {
  status?: ControlledAgentProgressStatus;
  phaseLabel?: string;
  currentStepLabel?: string;
  counters?: Partial<ControlledAgentProgressCounters>;
  limits?: Partial<ControlledAgentProgressLimits>;
  diagnostics: string[];
};

const zeroCounters: ControlledAgentProgressCounters = {
  stepsCompleted: 0,
  fileReadsUsed: 0,
  readBytesUsed: 0,
  filesTouched: 0,
  patchBytesUsed: 0,
  verificationRuns: 0,
  repairAttempts: 0,
  runtimeSeconds: 0,
  userTurns: 0,
};

const defaultLimits: ControlledAgentProgressLimits = {
  maxSteps: 6,
  maxFileReads: 6,
  maxReadBytes: 8192,
  maxTouchedFiles: 4,
  maxPatchBytes: 12000,
  maxRuntimeSeconds: 600,
  maxRepairAttempts: 0,
};

const safetyFlags: ControlledAgentProgressSafetyFlags = {
  authority: "progress_report_metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  autoStartAllowed: false,
  canReadFiles: false,
  canWriteFiles: false,
  canRunCommands: false,
  canApplyEdits: false,
  canCallProvider: false,
  canUseGit: false,
  canUseTools: false,
  canAutoRollback: false,
  canStartAutonomousLoop: false,
};

const terminalStatuses = new Set<ControlledAgentProgressStatus>(["completed", "stopped", "failed", "blocked"]);
const unsafeKeyPattern = /^(?:prompt|rawPrompt|raw_prompt|file|rawFile|raw_file|fileBody|file_body|fileContents|file_contents|diff|rawDiff|raw_diff|patch|body|rawBody|raw_body|replacement|command|cmd|args|arguments|cwd|env|environment|shell|provider|providerPayload|provider_payload|providerResponse|provider_response|tool|toolCall|tool_call|output|rawOutput|raw_output|log|rawLog|raw_log|secret|password|token|apiKey|api_key)$/i;
const unsafeTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|raw[_ -]?(?:file|prompt|command|output|log|diff)|file[_ -]?(?:body|content)|provider(?:[-_ ]?(?:payload|response))?|shell|\bcommand\b|\bcwd\b|\benv\b|\bgit\b|\btool\b|network|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/)/i;

export function buildControlledAgentProgressReport(input: unknown): ControlledAgentProgressReport {
  const diagnostics: string[] = [];

  if (input === undefined || input === null) {
    diagnostics.push("missing_input");
    return buildReport({ status: "disabled", phaseLabel: "Disabled", currentStepLabel: "Controlled agent progress metadata is unavailable.", diagnostics });
  }

  if (!isRecord(input)) {
    diagnostics.push("malformed_input");
    return buildReport({ status: "blocked", phaseLabel: "Blocked", currentStepLabel: "Controlled agent progress metadata is malformed.", diagnostics });
  }

  scanUnsafeMetadata(input, diagnostics);
  const parts = collectReportParts(input, diagnostics);
  if (diagnostics.includes("unsafe_metadata")) {
    return buildReport({ ...parts, status: "blocked", phaseLabel: "Blocked", currentStepLabel: "Unsafe controlled agent metadata was omitted.", diagnostics });
  }

  return buildReport({ ...parts, diagnostics });
}

function collectReportParts(input: Record<string, unknown>, diagnostics: string[]): ReportParts {
  const runState = firstRecord(input.runState, input.state, input.run, input.controlledAgentRunState, input);
  const editExecutor = firstRecord(input.editExecutor, input.edit, input.controlledAgentEditExecutor);
  const commandRunner = firstRecord(input.commandRunner, input.commandRun, input.verification, input.controlledAgentCommandRunner);
  const repairLoop = firstRecord(input.repairLoop, input.repair, input.controlledAgentRepairLoop);

  const counters = normalizeCounters(firstRecord(runState?.counters, input.counters));
  const limits = normalizeLimits(firstRecord(runState?.limits, input.limits));
  const runPhase = safeText(readString(runState, "phase") ?? readString(input, "phase"), "blocked", 80);
  const runSummary = safeText(readString(runState, "summary") ?? readString(input, "summary"), "Controlled agent progress metadata is visible.", 180);
  const status = statusFromMetadata(runPhase, runState, editExecutor, commandRunner, repairLoop);

  mergeEditMetadata(counters, editExecutor);
  mergeCommandMetadata(counters, commandRunner);
  mergeRepairMetadata(counters, limits, repairLoop);
  collectDiagnostics(diagnostics, runState, editExecutor, commandRunner, repairLoop);

  if (!runState && !editExecutor && !commandRunner && !repairLoop) {
    diagnostics.push("missing_known_metadata");
  }

  return {
    status,
    phaseLabel: labelForPhase(runPhase, status),
    currentStepLabel: currentStepLabel(status, runSummary, editExecutor, commandRunner, repairLoop),
    counters,
    limits,
    diagnostics,
  };
}

function buildReport(parts: ReportParts): ControlledAgentProgressReport {
  const counters = { ...zeroCounters, ...normalizeCounters(parts.counters) };
  const limits = { ...defaultLimits, ...normalizeLimits(parts.limits) };
  const diagnostics = uniqueDiagnostics(parts.diagnostics);
  const status = parts.status ?? (diagnostics.length > 0 ? "blocked" : "disabled");
  const report: ControlledAgentProgressReport = {
    status,
    phaseLabel: safeText(parts.phaseLabel, labelForStatus(status), 80),
    currentStepLabel: safeText(parts.currentStepLabel, "Controlled agent progress metadata is visible.", 180),
    counters,
    limits,
    safetyFlags,
    diagnostics,
  };

  if (terminalStatuses.has(status)) {
    report.finalReport = {
      status,
      title: `Controlled agent ${status}`,
      summary: finalSummary(status),
      counters,
      limits,
      diagnostics,
    };
  }

  return report;
}

function statusFromMetadata(phase: string, runState: Record<string, unknown> | undefined, editExecutor: Record<string, unknown> | undefined, commandRunner: Record<string, unknown> | undefined, repairLoop: Record<string, unknown> | undefined): ControlledAgentProgressStatus {
  const stopped = readBoolean(runState, "stopped") === true;
  const runEnabled = readBoolean(runState, "enabled");
  const editState = readString(editExecutor, "state");
  const commandState = readString(commandRunner, "state") ?? readString(commandRunner, "status") ?? readString(firstRecord(commandRunner?.result), "status");
  const repairMustStop = readBoolean(repairLoop, "mustStop");

  if (phase === "completed" || editState === "applied") return "completed";
  if (phase === "stopped" || commandState === "killed" || stopped) return "stopped";
  if (phase === "failed" || commandState === "failed" || commandState === "timed_out" || editState === "failed") return "failed";
  if (phase === "blocked" || commandState === "blocked" || editState === "blocked" || repairMustStop === true) return "blocked";
  if (phase === "waiting_for_user" || editState === "planned" || editState === "pending") return "waiting";
  if (phase === "idle" || runEnabled === false || commandState === "disabled" || editState === "disabled") return "disabled";
  return "running";
}

function mergeEditMetadata(counters: ControlledAgentProgressCounters, editExecutor: Record<string, unknown> | undefined): void {
  if (!editExecutor) return;
  counters.filesTouched = Math.max(counters.filesTouched, boundedInteger(readNumber(editExecutor, "touchedFileCount"), 0, 8, 0));
  counters.patchBytesUsed = Math.max(counters.patchBytesUsed, boundedInteger(readNumber(editExecutor, "replacementByteCount"), 0, 24000, 0));
  counters.filesTouched = Math.max(counters.filesTouched, Array.isArray(editExecutor.touchedFileLabels) ? Math.min(editExecutor.touchedFileLabels.length, 8) : 0);
}

function mergeCommandMetadata(counters: ControlledAgentProgressCounters, commandRunner: Record<string, unknown> | undefined): void {
  if (!commandRunner) return;
  const status = readString(commandRunner, "state") ?? readString(commandRunner, "status") ?? readString(firstRecord(commandRunner.result), "status");
  if (status && status !== "disabled" && status !== "blocked") {
    counters.verificationRuns = Math.max(counters.verificationRuns, 1);
  }
  const durationMs = readNumber(commandRunner, "durationMs") ?? readNumber(firstRecord(commandRunner.result), "durationMs");
  if (durationMs !== undefined) {
    counters.runtimeSeconds = Math.max(counters.runtimeSeconds, Math.ceil(boundedInteger(durationMs, 0, 1800000, 0) / 1000));
  }
}

function mergeRepairMetadata(counters: ControlledAgentProgressCounters, limits: ControlledAgentProgressLimits, repairLoop: Record<string, unknown> | undefined): void {
  if (!repairLoop) return;
  counters.repairAttempts = Math.max(counters.repairAttempts, boundedInteger(readNumber(repairLoop, "attemptCount"), 0, 3, 0));
  limits.maxRepairAttempts = Math.max(limits.maxRepairAttempts, boundedInteger(readNumber(repairLoop, "maxAttempts"), 0, 3, 0));
}

function collectDiagnostics(diagnostics: string[], ...records: Array<Record<string, unknown> | undefined>): void {
  for (const record of records) {
    if (!record || !Array.isArray(record.diagnostics)) continue;
    for (const item of record.diagnostics.slice(0, 12)) {
      if (typeof item === "string") {
        diagnostics.push(safeText(item, "diagnostic", 80));
      } else if (isRecord(item)) {
        diagnostics.push(safeText(readString(item, "code") ?? readString(item, "message"), "diagnostic", 80));
      }
    }
  }
}

function labelForPhase(phase: string, status: ControlledAgentProgressStatus): string {
  if (phase === "opt_in_required") return "Opt-in required";
  if (phase === "workspace_ready") return "Workspace ready";
  if (phase === "reading_context") return "Reading context";
  if (phase === "planning") return "Planning";
  if (phase === "waiting_for_user") return "Waiting for user";
  if (phase === "running_verification") return "Running verification";
  return labelForStatus(status);
}

function labelForStatus(status: ControlledAgentProgressStatus): string {
  if (status === "completed") return "Completed";
  if (status === "stopped") return "Stopped";
  if (status === "failed") return "Failed";
  if (status === "blocked") return "Blocked";
  if (status === "waiting") return "Waiting";
  if (status === "running") return "Running";
  return "Disabled";
}

function currentStepLabel(status: ControlledAgentProgressStatus, summary: string, editExecutor: Record<string, unknown> | undefined, commandRunner: Record<string, unknown> | undefined, repairLoop: Record<string, unknown> | undefined): string {
  const commandSummary = safeOptionalText(readString(commandRunner, "summary") ?? readString(firstRecord(commandRunner?.result), "message"));
  const editSummary = safeOptionalText(readString(editExecutor, "summary"));
  const repairState = safeOptionalText(readString(repairLoop, "state"));
  if (commandSummary) return commandSummary;
  if (editSummary) return editSummary;
  if (repairState) return `Repair loop ${repairState}.`;
  if (status === "disabled") return "Controlled agent progress metadata is unavailable.";
  return summary;
}

function finalSummary(status: ControlledAgentProgressStatus): string {
  if (status === "completed") return "Controlled agent run completed with sanitized metadata only.";
  if (status === "stopped") return "Controlled agent run stopped with sanitized metadata only.";
  if (status === "failed") return "Controlled agent run failed with sanitized metadata only.";
  return "Controlled agent run is blocked with sanitized metadata only.";
}

function normalizeCounters(input: unknown): ControlledAgentProgressCounters {
  const record = isRecord(input) ? input : {};
  return {
    stepsCompleted: boundedInteger(readNumber(record, "stepsCompleted"), 0, 12, 0),
    fileReadsUsed: boundedInteger(readNumber(record, "fileReadsUsed"), 0, 24, 0),
    readBytesUsed: boundedInteger(readNumber(record, "readBytesUsed"), 0, 50000, 0),
    filesTouched: boundedInteger(readNumber(record, "filesTouched"), 0, 8, 0),
    patchBytesUsed: boundedInteger(readNumber(record, "patchBytesUsed"), 0, 24000, 0),
    verificationRuns: boundedInteger(readNumber(record, "verificationRuns"), 0, 12, 0),
    repairAttempts: boundedInteger(readNumber(record, "repairAttempts"), 0, 3, 0),
    runtimeSeconds: boundedInteger(readNumber(record, "runtimeSeconds"), 0, 1800, 0),
    userTurns: boundedInteger(readNumber(record, "userTurns"), 0, 20, 0),
  };
}

function normalizeLimits(input: unknown): ControlledAgentProgressLimits {
  const record = isRecord(input) ? input : {};
  return {
    maxSteps: boundedInteger(readNumber(record, "maxSteps"), 1, 12, defaultLimits.maxSteps),
    maxFileReads: boundedInteger(readNumber(record, "maxFileReads"), 0, 24, defaultLimits.maxFileReads),
    maxReadBytes: boundedInteger(readNumber(record, "maxReadBytes"), 0, 50000, defaultLimits.maxReadBytes),
    maxTouchedFiles: boundedInteger(readNumber(record, "maxTouchedFiles"), 0, 8, defaultLimits.maxTouchedFiles),
    maxPatchBytes: boundedInteger(readNumber(record, "maxPatchBytes"), 0, 24000, defaultLimits.maxPatchBytes),
    maxRuntimeSeconds: boundedInteger(readNumber(record, "maxRuntimeSeconds"), 1, 1800, defaultLimits.maxRuntimeSeconds),
    maxRepairAttempts: boundedInteger(readNumber(record, "maxRepairAttempts"), 0, 3, defaultLimits.maxRepairAttempts),
  };
}

function scanUnsafeMetadata(value: unknown, diagnostics: string[], key = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8 || diagnostics.includes("unsafe_metadata")) return;
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value)) diagnostics.push("unsafe_metadata");
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, `${key}[${index}]`, depth + 1, seen));
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [nextKey, item] of Object.entries(value).slice(0, 60)) {
    if (unsafeKeyPattern.test(nextKey)) {
      diagnostics.push("unsafe_metadata");
      return;
    }
    scanUnsafeMetadata(item, diagnostics, key ? `${key}.${nextKey}` : nextKey, depth + 1, seen);
  }
}

function uniqueDiagnostics(input: string[]): string[] {
  return Array.from(new Set(input.map((item) => safeText(item, "diagnostic", 80)))).slice(0, 24);
}

function safeOptionalText(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const safe = safeText(input, "", 180);
  return safe.length > 0 ? safe : undefined;
}

function safeText(input: unknown, fallback: string, limit: number): string {
  if (typeof input !== "string") return fallback;
  const sanitized = input.replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "").trim();
  if (!sanitized || unsafeTextPattern.test(sanitized)) return fallback;
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined;
  return typeof record[key] === "string" ? record[key] : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!record) return undefined;
  return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!record) return undefined;
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
