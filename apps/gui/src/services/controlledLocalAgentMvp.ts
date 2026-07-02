import { evaluateControlledAgentCommandRun } from "./controlledAgentCommandRunner";
import { evaluateControlledAgentEditExecutor } from "./controlledAgentEditExecutor";
import { evaluateControlledAgentFileRead } from "./controlledAgentFileRead";
import { buildControlledAgentProgressReport, type ControlledAgentProgressStatus } from "./controlledAgentProgressReport";
import { evaluateControlledAgentRepairLoop } from "./controlledAgentRepairLoop";
import { evaluateControlledAgentRuntimeSession, type ControlledAgentRuntimeSessionEvaluation } from "./controlledAgentRuntimeSession";
import { evaluateControlledAgentWorkspaceReadiness } from "./controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type ControlledLocalAgentMvpStatus = "disabled" | "blocked" | "ready_to_preview" | "running_metadata_flow" | "completed" | "stopped" | "failed";
export type ControlledLocalAgentMvpChecklistState = "disabled" | "blocked" | "pending" | "ready" | "running" | "completed" | "stopped" | "failed";

export type ControlledLocalAgentMvpSafetyFlags = {
  authority: "controlled_local_agent_mvp_metadata_only";
  shell: false;
  git: false;
  providerTool: false;
  hiddenRead: false;
  freeformCommand: false;
  rawPersistence: false;
  cloudRequired: false;
  executionAllowed: false;
  agentStartAllowed: false;
  autoStartAllowed: false;
  canReadFiles: false;
  canWriteFiles: false;
  canRunCommands: false;
  canApplyEdits: false;
  canCallProvider: false;
  canUseTools: false;
  canUseGit: false;
};

export type ControlledLocalAgentMvpChecklistStep = {
  id: "explicit_opt_in" | "workspace_readiness" | "runtime_session" | "bounded_read" | "edit_metadata" | "verification" | "repair" | "final_report";
  state: ControlledLocalAgentMvpChecklistState;
  label: string;
  diagnostics: string[];
};

export type ControlledLocalAgentMvpRuntimeSessionSummary = {
  present: boolean;
  status: ControlledAgentRuntimeSessionEvaluation["status"];
  label: string;
  nextUserAction: ControlledAgentRuntimeSessionEvaluation["nextUserAction"];
  metadataOnly: boolean;
  displayOnly: true;
  executionAllowed: false;
  agentStartAllowed: false;
  diagnostics: string[];
};

export type ControlledLocalAgentMvpReport = {
  status: ControlledLocalAgentMvpStatus;
  label: string;
  checklist: ControlledLocalAgentMvpChecklistStep[];
  safetyFlags: ControlledLocalAgentMvpSafetyFlags;
  diagnostics: string[];
  runtimeSession: ControlledLocalAgentMvpRuntimeSessionSummary;
  finalReport?: {
    status: "completed" | "stopped" | "failed";
    label: string;
    summary: string;
  };
};

const safetyFlags: ControlledLocalAgentMvpSafetyFlags = {
  authority: "controlled_local_agent_mvp_metadata_only",
  shell: false,
  git: false,
  providerTool: false,
  hiddenRead: false,
  freeformCommand: false,
  rawPersistence: false,
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  autoStartAllowed: false,
  canReadFiles: false,
  canWriteFiles: false,
  canRunCommands: false,
  canApplyEdits: false,
  canCallProvider: false,
  canUseTools: false,
  canUseGit: false,
};

export function buildControlledLocalAgentMvp(input: unknown): ControlledLocalAgentMvpReport {
  const runtimeSessionInput = isRecord(input) ? input.runtimeSession ?? input.controlledAgentRuntimeSession : undefined;
  const runtimeSession = summarizeRuntimeSession(runtimeSessionInput);
  if (!isRecord(input)) {
    return buildMvpReport("disabled", "Controlled local agent MVP metadata is disabled.", [
      step("explicit_opt_in", "disabled", "Explicit user opt-in is required.", ["missing_input"]),
      step("workspace_readiness", "disabled", "Workspace readiness metadata is unavailable.", []),
      runtimeSessionStep(runtimeSession),
      step("bounded_read", "disabled", "Bounded read metadata is unavailable.", []),
      step("edit_metadata", "disabled", "Edit metadata is unavailable.", []),
      step("verification", "disabled", "Verification metadata is unavailable.", []),
      step("repair", "disabled", "Repair metadata is unavailable.", []),
      step("final_report", "disabled", "Final report metadata is unavailable.", []),
    ], ["missing_input"], runtimeSession);
  }

  const optIn = explicitUserOptIn(input.userOptIn ?? input.optIn);
  if (!optIn) {
    return buildMvpReport("disabled", "Controlled local agent MVP requires explicit user opt-in.", [
      step("explicit_opt_in", "disabled", "Explicit user opt-in is required.", ["missing_user_opt_in"]),
      step("workspace_readiness", "pending", "Workspace readiness waits for opt-in.", []),
      runtimeSessionStep(runtimeSession),
      step("bounded_read", "pending", "Bounded read waits for opt-in.", []),
      step("edit_metadata", "pending", "Edit metadata waits for opt-in.", []),
      step("verification", "pending", "Verification waits for opt-in.", []),
      step("repair", "pending", "Repair waits for opt-in.", []),
      step("final_report", "pending", "Final report waits for opt-in.", []),
    ], ["missing_user_opt_in"], runtimeSession);
  }

  const readiness = evaluateControlledAgentWorkspaceReadiness(input.readiness ?? input.workspaceReadiness);
  const readinessDiagnostics = readiness.diagnostics.map((item) => item.code);
  if (readiness.state !== "ready_for_future_controlled_mode") {
    return buildMvpReport("blocked", "Controlled local agent MVP is blocked by workspace readiness metadata.", [
      step("explicit_opt_in", "ready", "Explicit user opt-in metadata is present.", []),
      step("workspace_readiness", "blocked", readiness.summary, readinessDiagnostics),
      runtimeSessionStep(runtimeSession),
      step("bounded_read", "pending", "Bounded read waits for ready workspace metadata.", []),
      step("edit_metadata", "pending", "Edit metadata waits for ready workspace metadata.", []),
      step("verification", "pending", "Verification waits for ready workspace metadata.", []),
      step("repair", "pending", "Repair waits for ready workspace metadata.", []),
      step("final_report", "pending", "Final report waits for ready workspace metadata.", []),
    ], ["workspace_not_ready", ...readinessDiagnostics], runtimeSession);
  }

  const boundedRead = evaluateControlledAgentFileRead(input.boundedRead ?? input.fileRead);
  const edit = evaluateControlledAgentEditExecutor(input.editMetadata ?? input.editExecutor ?? input.edit);
  const verification = evaluateControlledAgentCommandRun(input.verification ?? input.commandRunner ?? input.commandRun);
  const repairMetadata = input.repair ?? input.repairLoop;
  const repair = repairMetadata === undefined ? undefined : evaluateControlledAgentRepairLoop(repairMetadata);
  const progress = buildControlledAgentProgressReport(input.progress ?? input.progressReport ?? input.runState ?? input.finalReport);
  const status = statusFromProgress(progress.status);
  const checklist = [
    step("explicit_opt_in", "ready", "Explicit user opt-in metadata is present.", []),
    step("workspace_readiness", "ready", readiness.summary, readinessDiagnostics),
    runtimeSessionStep(runtimeSession),
    step("bounded_read", fileReadStepState(boundedRead.state), boundedRead.summary, boundedRead.diagnostics.map((item) => item.code)),
    step("edit_metadata", editStepState(edit.state), edit.summary, edit.diagnostics),
    step("verification", verificationStepState(verification.state), verification.summary, verification.diagnostics.map((item) => item.code)),
    step("repair", repair ? repairStepState(repair.state, repair.mustStop) : "pending", repair ? `Repair metadata ${repair.state}.` : "Repair metadata is unavailable.", repair?.diagnostics ?? []),
    step("final_report", finalReportStepState(status), progress.finalReport?.summary ?? progress.currentStepLabel, progress.diagnostics),
  ];
  const diagnostics = uniqueDiagnostics([...readinessDiagnostics, ...runtimeSession.diagnostics, ...progress.diagnostics]);
  const report = buildMvpReport(status, labelForStatus(status, progress.phaseLabel), checklist, diagnostics, runtimeSession);

  if (status === "completed" || status === "stopped" || status === "failed") {
    report.finalReport = {
      status,
      label: labelForStatus(status, progress.phaseLabel),
      summary: safeText(progress.finalReport?.summary ?? progress.currentStepLabel, "Controlled local agent MVP final report metadata is visible."),
    };
  }

  return report;
}

function statusFromProgress(status: ControlledAgentProgressStatus): ControlledLocalAgentMvpStatus {
  if (status === "completed" || status === "stopped" || status === "failed") return status;
  if (status === "blocked") return "blocked";
  if (status === "running" || status === "waiting") return "running_metadata_flow";
  return "ready_to_preview";
}

function fileReadStepState(state: string): ControlledLocalAgentMvpChecklistState {
  if (state === "success" || state === "truncated") return "completed";
  if (state === "blocked") return "blocked";
  return "pending";
}

function editStepState(state: string): ControlledLocalAgentMvpChecklistState {
  if (state === "applied") return "completed";
  if (state === "planned" || state === "pending") return "ready";
  if (state === "failed") return "failed";
  if (state === "blocked") return "blocked";
  return "pending";
}

function verificationStepState(state: string): ControlledLocalAgentMvpChecklistState {
  if (state === "succeeded") return "completed";
  if (state === "running") return "running";
  if (state === "failed" || state === "timed_out") return "failed";
  if (state === "killed") return "stopped";
  if (state === "blocked") return "blocked";
  return "pending";
}

function repairStepState(state: string, mustStop: boolean): ControlledLocalAgentMvpChecklistState {
  if (mustStop) return state === "exhausted" ? "failed" : "blocked";
  if (state === "eligible") return "ready";
  if (state === "completed") return "completed";
  return "pending";
}

function finalReportStepState(status: ControlledLocalAgentMvpStatus): ControlledLocalAgentMvpChecklistState {
  if (status === "completed" || status === "stopped" || status === "failed" || status === "blocked") return status;
  if (status === "running_metadata_flow") return "running";
  return "pending";
}

function buildMvpReport(status: ControlledLocalAgentMvpStatus, label: string, checklist: ControlledLocalAgentMvpChecklistStep[], diagnostics: string[], runtimeSession: ControlledLocalAgentMvpRuntimeSessionSummary): ControlledLocalAgentMvpReport {
  return {
    status,
    label: safeText(label, "Controlled local agent MVP metadata is visible."),
    checklist,
    safetyFlags,
    diagnostics: uniqueDiagnostics(diagnostics),
    runtimeSession,
  };
}

function summarizeRuntimeSession(input: unknown): ControlledLocalAgentMvpRuntimeSessionSummary {
  const evaluation = evaluateControlledAgentRuntimeSession(input);
  return {
    present: input !== undefined,
    status: evaluation.status,
    label: safeText(evaluation.label, "Controlled runtime session metadata is visible."),
    nextUserAction: evaluation.nextUserAction,
    metadataOnly: evaluation.session.metadataOnly,
    displayOnly: true,
    executionAllowed: false,
    agentStartAllowed: false,
    diagnostics: uniqueDiagnostics(evaluation.diagnostics.map((item) => item.code)),
  };
}

function runtimeSessionStep(runtimeSession: ControlledLocalAgentMvpRuntimeSessionSummary): ControlledLocalAgentMvpChecklistStep {
  if (!runtimeSession.present) {
    return step("runtime_session", "pending", "Runtime session metadata is unavailable.", runtimeSession.diagnostics);
  }
  const state: ControlledLocalAgentMvpChecklistState = runtimeSession.status === "blocked" ? "blocked" : runtimeSession.status === "disabled" ? "disabled" : runtimeSession.status === "stopped" ? "stopped" : runtimeSession.status === "session_open_metadata" || runtimeSession.status === "start_requested_metadata" || runtimeSession.status === "stop_requested_metadata" ? "running" : runtimeSession.status === "ready_to_start" ? "ready" : "pending";
  return step("runtime_session", state, runtimeSession.label, runtimeSession.diagnostics);
}

function step(id: ControlledLocalAgentMvpChecklistStep["id"], state: ControlledLocalAgentMvpChecklistState, label: string, diagnostics: string[]): ControlledLocalAgentMvpChecklistStep {
  return {
    id,
    state,
    label: safeText(label, "Controlled local agent MVP metadata is visible."),
    diagnostics: uniqueDiagnostics(diagnostics),
  };
}

function explicitUserOptIn(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.source === "user" && value.confirmed === true) return true;
  return value.origin === "user" && value.confirmedBy === "user" && value.grantsStartAuthority === false;
}

function labelForStatus(status: ControlledLocalAgentMvpStatus, fallback: string): string {
  if (status === "ready_to_preview") return "Ready to preview";
  if (status === "running_metadata_flow") return "Running metadata flow";
  if (status === "completed") return "Completed";
  if (status === "stopped") return "Stopped";
  if (status === "failed") return "Failed";
  if (status === "blocked") return "Blocked";
  return fallback;
}

function uniqueDiagnostics(input: string[]): string[] {
  return Array.from(new Set(input.map((item) => safeText(item, "diagnostic")))).slice(0, 24);
}

function safeText(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const sanitized = sanitizeTimelineText(input).replace(/[<>\r\n\t]+/g, " ").trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return sanitizeDisplayText(safe);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
