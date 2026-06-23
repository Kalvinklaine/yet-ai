import { evaluateAgentRunState, type AgentRunInput, type AgentRunState, type AgentRunViewModel } from "./agentRunState";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type AgentRunReportKind = "success" | "failed_apply" | "failed_verification" | "blocked_prerequisites" | "rollback_available" | "blocked" | "in_progress";
export type AgentRunReportStatus = "succeeded" | "failed" | "blocked" | "pending";
export type AgentRunReportDetailValue = string | number | boolean | string[];

export type AgentRunReport = {
  kind: AgentRunReportKind;
  status: AgentRunReportStatus;
  state: AgentRunState;
  title: string;
  summary: string;
  userConfirmedSteps: string[];
  details: Record<string, AgentRunReportDetailValue>;
  diagnostics: string[];
  rollbackAvailable: boolean;
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const allowedCommandIds = new Set(["repository-check", "gui-app-tests", "engine-chat-tests"]);
const maxSummaryLength = 600;
const maxDetailStringLength = 320;
const maxOutputTailLength = 800;
const maxDetails = 36;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\u0000-\u001f\u007f-\u009f]+$/;

type PlainRecord = Record<string, unknown>;

export function createAgentRunReport(input: unknown): AgentRunReport {
  const view = evaluateAgentRunState(input);
  const metadata = isPlainObject(input) ? input as Partial<AgentRunInput> : {};
  const kind = reportKind(view, metadata);
  const details = buildReportDetails(view, metadata);
  const diagnostics = view.diagnostics.map((item) => safeText(item.message, 220)).slice(0, 12);

  return {
    kind,
    status: reportStatus(kind),
    state: view.state,
    title: titleForKind(kind),
    summary: summaryForKind(kind, view.summary),
    userConfirmedSteps: userConfirmedSteps(metadata),
    details,
    diagnostics,
    rollbackAvailable: view.rollbackAvailable,
  };
}

export function createAgentRunTraceDetails(input: unknown): Record<string, AgentRunReportDetailValue> {
  const report = createAgentRunReport(input);
  return sanitizeDetails({
    reportKind: report.kind,
    reportStatus: report.status,
    state: report.state,
    rollbackAvailable: report.rollbackAvailable,
    userConfirmedSteps: report.userConfirmedSteps,
    ...report.details,
  });
}

function reportKind(view: AgentRunViewModel, metadata: Partial<AgentRunInput>): AgentRunReportKind {
  if (view.rollbackAvailable || view.state === "rollback_available") {
    return "rollback_available";
  }
  if (metadata.applyResult?.status === "failed") {
    return "failed_apply";
  }
  if (view.state === "verified" || view.state === "completed") {
    return "success";
  }
  if (view.state === "verification_failed") {
    return "failed_verification";
  }
  if (view.state === "prerequisites_blocked") {
    return "blocked_prerequisites";
  }
  if (view.state === "blocked") {
    return "blocked";
  }
  return "in_progress";
}

function reportStatus(kind: AgentRunReportKind): AgentRunReportStatus {
  if (kind === "success") {
    return "succeeded";
  }
  if (kind === "failed_apply") {
    return "failed";
  }
  if (kind === "failed_verification") {
    return "failed";
  }
  if (kind === "blocked" || kind === "blocked_prerequisites") {
    return "blocked";
  }
  return "pending";
}

function titleForKind(kind: AgentRunReportKind): string {
  switch (kind) {
    case "success":
      return "Agent Run completed after user-confirmed verification";
    case "failed_apply":
      return "Agent Run apply failed after user confirmation";
    case "failed_verification":
      return "Agent Run verification failed after user confirmation";
    case "blocked_prerequisites":
      return "Agent Run prerequisites are blocked";
    case "rollback_available":
      return "Agent Run has a user-reviewable rollback option";
    case "blocked":
      return "Agent Run is blocked";
    case "in_progress":
      return "Agent Run is waiting for the next manual step";
  }
}

function summaryForKind(kind: AgentRunReportKind, summary: string): string {
  const safe = safeText(summary, maxSummaryLength);
  switch (kind) {
    case "success":
      return `${safe} Manual apply and verification metadata are complete; no autonomous follow-up was started.`;
    case "failed_apply":
      return `${safe} Apply failed after an explicit user request; no automatic repair or retry was started.`;
    case "failed_verification":
      return `${safe} Verification failed after an explicit user request; no automatic repair was started.`;
    case "blocked_prerequisites":
      return `${safe} Prerequisites must be reviewed before apply can be offered.`;
    case "rollback_available":
      return `${safe} A rollback option is available for user review only; it never runs by itself.`;
    case "blocked":
      return `${safe} Unsafe or invalid metadata was blocked before any automatic action.`;
    case "in_progress":
      return `${safe} The next step requires explicit user action.`;
  }
}

function userConfirmedSteps(metadata: Partial<AgentRunInput>): string[] {
  const steps: string[] = [];
  if (metadata.applyRequest?.requested === true && metadata.applyRequest.source === "user") {
    steps.push("apply_requested_by_user");
  }
  if (metadata.applyResult?.status === "applied" || metadata.applyResult?.status === "failed") {
    steps.push("apply_result_recorded");
  }
  if (metadata.verificationRequest?.requested === true && metadata.verificationRequest.source === "user") {
    steps.push("verification_requested_by_user");
  }
  if (metadata.verificationResult?.status === "succeeded" || metadata.verificationResult?.status === "failed") {
    steps.push("verification_result_recorded");
  }
  return steps;
}

function buildReportDetails(view: AgentRunViewModel, metadata: Partial<AgentRunInput>): Record<string, AgentRunReportDetailValue> {
  const boundedLoop = isPlainObject(metadata.boundedLoop) ? metadata.boundedLoop : undefined;
  const verification = isPlainObject(boundedLoop?.verification) ? boundedLoop.verification : undefined;
  const patch = isPlainObject(boundedLoop?.patch) ? boundedLoop.patch : undefined;
  const details = sanitizeDetails({
    displayOnly: true,
    state: view.state,
    nextUserAction: view.nextUserAction,
    enabled: view.enabled,
    stopped: view.stopped,
    rollbackAvailable: view.rollbackAvailable,
    goalId: safeId(metadata.goal?.id),
    proposalId: safeId(metadata.proposal?.id),
    boundedLoopState: valueAsString(view.details.boundedLoopState),
    boundedPolicyDecision: valueAsString(view.details.boundedPolicyDecision),
    touchedFileCount: boundedCount(metadata.proposal?.touchedFiles?.length ?? arrayLength(patch?.touchedFiles), 0, 200),
    editCount: boundedCount(valueAsNumber(patch?.editCount), 0, 10000),
    applyRequestId: safeId(metadata.applyRequest?.requestId),
    applyRequested: metadata.applyRequest?.requested === true,
    applyRequestSource: safeEnum(metadata.applyRequest?.source, ["user", "assistant", "system"]),
    applyStatus: safeEnum(metadata.applyResult?.status, ["applied", "failed"]),
    applySummary: safeText(metadata.applyResult?.summary, 240),
    appliedFileCount: boundedCount(metadata.applyResult?.appliedFileCount, 0, 200),
    verificationRequestId: safeId(metadata.verificationRequest?.requestId),
    verificationRequested: metadata.verificationRequest?.requested === true,
    verificationRequestSource: safeEnum(metadata.verificationRequest?.source, ["user", "assistant", "system"]),
    verificationProgress: safeEnum(metadata.verificationProgress?.status, ["queued", "running"]),
    verificationCommandId: safeCommandId(verification?.commandId),
    verificationStatus: safeEnum(metadata.verificationResult?.status, ["succeeded", "failed"]),
    verificationExitCode: boundedCount(metadata.verificationResult?.exitCode, 0, 255),
    verificationDurationMs: boundedCount(metadata.verificationResult?.durationMs, 0, 1800000),
    verificationOutputTail: safeText(metadata.verificationResult?.outputTail, maxOutputTailLength),
    rollbackSummary: safeText(metadata.rollback?.summary, 240),
  });
  return Object.fromEntries(Object.entries(details).slice(0, maxDetails));
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, AgentRunReportDetailValue> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, AgentRunReportDetailValue> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    if (value === undefined) {
      continue;
    }
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") {
      const safe = safeText(value, maxDetailStringLength);
      if (safe.length > 0) {
        details[safeKey] = safe;
      }
    } else if (typeof value === "number" && Number.isFinite(value)) {
      details[safeKey] = value;
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 120)).filter(Boolean).slice(0, 12);
    }
  }
  return details;
}

function safeText(value: unknown, limit: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const sanitized = sanitizeTimelineText(value).trim();
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}…` : sanitized;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safeCommandId(value: unknown): string | undefined {
  return typeof value === "string" && allowedCommandIds.has(value) ? value : undefined;
}

function safeEnum(value: unknown, allowed: readonly string[]): string | undefined {
  return typeof value === "string" && allowed.includes(value) ? value : undefined;
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arrayLength(value: unknown): number | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item) => typeof item === "string" && item.length <= 240 && safeRelativePathPattern.test(item)).length;
}

function boundedCount(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return undefined;
  }
  return value;
}

function isPlainObject(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
