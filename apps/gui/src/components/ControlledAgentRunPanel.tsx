import { useMemo } from "react";
import type { BridgeHost } from "../bridge/bridgeAdapter";
import { createControlledAgentDevPreviewReport } from "../services/controlledAgentDevPreviewReport";
import type { ControlledAgentProgressReport } from "../services/controlledAgentProgressReport";
import { evaluateControlledAgentDevPreviewStatus } from "../services/controlledAgentDevPreviewStatus";
import type { ControlledLocalAgentMvpReport } from "../services/controlledLocalAgentMvp";
import type { ControlledAgentRunState } from "../services/controlledAgentRunState";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentRunPanelProps = {
  state: ControlledAgentRunState;
  progressReport?: ControlledAgentProgressReport;
  mvpReport?: ControlledLocalAgentMvpReport;
  host?: BridgeHost | "unknown";
  onStop: () => void;
};

export function ControlledAgentRunPanel({ state, progressReport, mvpReport, host = "unknown", onStop }: ControlledAgentRunPanelProps) {
  const phaseLabel = sanitizeDisplayText(state.phase.replace(/_/g, " "));
  const stopReason = state.stop?.reason ? sanitizeDisplayText(state.stop.reason.replace(/_/g, " ")) : "none";
  const currentStep = currentStepLabel(state);
  const limits = useMemo(() => Object.entries(state.limits), [state.limits]);
  const counters = useMemo(() => Object.entries(state.counters), [state.counters]);
  const progressCounters = useMemo(() => Object.entries(progressReport?.counters ?? {}), [progressReport?.counters]);
  const progressLimits = useMemo(() => Object.entries(progressReport?.limits ?? {}), [progressReport?.limits]);
  const progressSafetyFlags = useMemo(() => Object.entries(progressReport?.safetyFlags ?? {}), [progressReport?.safetyFlags]);
  const mvpSafetyFlags = useMemo(() => Object.entries(mvpReport?.safetyFlags ?? {}), [mvpReport?.safetyFlags]);
  const diagnostics = state.diagnostics.slice(0, 6);
  const progressDiagnostics = progressReport?.diagnostics.slice(0, 6) ?? [];
  const mvpDiagnostics = mvpReport?.diagnostics.slice(0, 6) ?? [];
  const runtimeSessionDiagnostics = mvpReport?.runtimeSession.diagnostics.slice(0, 6) ?? [];
  const stopDisabled = state.stopped || state.phase === "idle" || state.phase === "opt_in_required" || state.phase === "blocked" || state.phase === "failed" || state.phase === "completed";
  const devPreviewStatus = evaluateControlledAgentDevPreviewStatus({
    host,
    workspaceReady: state.phase !== "idle" && state.phase !== "opt_in_required" && state.phase !== "blocked",
    runtimeReady: mvpReport?.runtimeSession.present === true || state.enabled,
    oneStepReady: state.counters.fileReadsUsed > 0 || state.phase === "reading_context" || state.phase === "planning" || state.phase === "waiting_for_user" || state.phase === "running_verification" || state.phase === "completed",
    verificationReady: state.counters.verificationRuns > 0 || state.phase === "running_verification" || state.phase === "completed",
    repairReady: state.limits.maxRepairAttempts > 0,
    stopped: state.stopped,
    runtimeDisconnected: mvpReport?.runtimeSession.status === "blocked",
  });
  const devPreviewReport = createControlledAgentDevPreviewReport({
    host,
    status: controlledReportStatusFromRunPhase(state.phase),
    capabilities: {
      explicit_start: host === "vscode" && state.enabled,
      bounded_read: state.counters.fileReadsUsed > 0 || state.phase === "reading_context" || state.phase === "planning" || state.phase === "waiting_for_user" || state.phase === "running_verification" || state.phase === "completed",
      bounded_edit: state.counters.filesTouched > 0 || state.phase === "waiting_for_user" || state.phase === "completed",
      allowlisted_verification: state.counters.verificationRuns > 0 || state.phase === "running_verification" || state.phase === "completed",
      bounded_repair: state.limits.maxRepairAttempts > 0,
      sanitized_report: true,
    },
    counters: {
      loopSteps: state.counters.stepsCompleted,
      fileReads: state.counters.fileReadsUsed,
      filesTouched: state.counters.filesTouched,
      verificationRuns: state.counters.verificationRuns,
      repairAttempts: state.counters.repairAttempts,
      userTurns: state.counters.userTurns,
      runtimeSeconds: state.counters.runtimeSeconds,
    },
    currentUserAction: state.phase === "completed" ? "review" : state.phase === "stopped" ? "stop" : state.phase === "failed" || state.phase === "blocked" ? "retry" : state.phase === "idle" || state.phase === "opt_in_required" ? "none" : "wait",
    limitations: host === "browser" ? ["browser_unsupported"] : host === "jetbrains" ? ["jetbrains_partial"] : [],
    evidence: [
      { kind: state.phase === "stopped" ? "stop" : "status", status: state.phase, summary: state.summary },
    ],
  });

  return (
    <section className={`readiness-card ${state.stopped ? "warn" : "ready"} controlled-agent-run-panel stack`} aria-label="Controlled agent run skeleton" data-testid="controlled-agent-run-panel">
      <div className="row">
        <strong>S91 controlled agent dev-preview</strong>
        <span className="badge warn">dev-preview, not production autonomy</span>
        <span className="badge">VS Code supported path</span>
        <span className="badge">sanitized metadata only</span>
        <span className={state.stopped ? "badge warn" : "badge ok"}>{phaseLabel}</span>
      </div>
      <span>{sanitizeDisplayText(state.summary)}</span>
      <section className={`readiness-card ${devPreviewStatus.state === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled agent dev-preview status">
        <div className="row">
          <strong>Dev-preview readiness</strong>
          <span className={devPreviewStatus.state === "ready" ? "badge ok" : "badge warn"}>{devPreviewStatus.state}</span>
          <span className="badge">explicit Start/Stop</span>
          <span className="badge">one repair attempt max</span>
        </div>
        <span>{devPreviewStatus.summary}</span>
        <span>Host: {devPreviewStatus.host} · Bounded read/edit: {devPreviewStatus.capabilities.boundedRead && devPreviewStatus.capabilities.boundedEdit ? "ready" : "blocked"} · Allowlisted verification: {devPreviewStatus.capabilities.allowlistedVerification ? "ready" : "blocked"} · One bounded repair: {devPreviewStatus.capabilities.boundedRepair ? "ready" : "blocked"} · Sanitized report: ready</span>
        <span>Limitations: {devPreviewStatus.limitations.join(" · ")}</span>
      </section>
      <section className={`readiness-card ${devPreviewReport.status === "completed" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled dev-preview report">
        <div className="row">
          <strong>Controlled dev-preview report</strong>
          <span className={devPreviewReport.status === "completed" ? "badge ok" : "badge warn"}>{devPreviewReport.statusLabel}</span>
          <span className="badge">metadata only</span>
          <span className="badge">display only</span>
        </div>
        <span>Host: {devPreviewReport.hostLabel}</span>
        <span>Current user action: {devPreviewReport.currentUserActionLabel}</span>
        <span>Capabilities: {devPreviewReport.capabilityLabels.join(" · ")}</span>
        <div className="agent-progress-grid" aria-label="Controlled dev-preview report counters">
          {Object.entries(devPreviewReport.counters).map(([key, value]) => <span key={key}>Report counter {sanitizeDisplayText(key)}: {value}</span>)}
        </div>
        <span>Limitations: {devPreviewReport.limitationLabels.join(" · ")}</span>
        {devPreviewReport.evidence.length > 0 && <span>Evidence: {devPreviewReport.evidence.map((item) => `${sanitizeDisplayText(item.label)} — ${sanitizeDisplayText(item.summary)}`).join(" · ")}</span>}
        <span className="subtle">Safety boundaries: {devPreviewReport.safetyBoundaryLabels.join(" · ")}</span>
      </section>
      <span className="subtle">S91 dev-preview: VS Code is the supported explicit-control path. Browser is preview-only and unsupported for privileged controlled actions. JetBrains stays partial/fail-closed where controlled gaps remain. Sanitized reports only.</span>
      {progressReport && <section className={`readiness-card ${progressReport.status === "blocked" || progressReport.status === "failed" || progressReport.status === "stopped" ? "warn" : "ready"} stack`} aria-label="Controlled progress report metadata">
        <div className="row">
          <strong>Progress report</strong>
          <span className="badge">S79 metadata</span>
          <span className="badge">sanitized labels only</span>
          <span className={progressReport.status === "blocked" || progressReport.status === "failed" ? "badge warn" : "badge ok"}>{sanitizeDisplayText(progressReport.status)}</span>
        </div>
        <div className="agent-progress-grid" aria-label="Controlled progress report status">
          <span>Report phase: {sanitizeDisplayText(progressReport.phaseLabel)}</span>
          <span>Report step: {sanitizeDisplayText(progressReport.currentStepLabel)}</span>
          <span>Final report: {progressReport.finalReport ? sanitizeDisplayText(progressReport.finalReport.title) : "none"}</span>
          {progressReport.finalReport && <span>Final summary: {sanitizeDisplayText(progressReport.finalReport.summary)}</span>}
        </div>
        <div className="agent-progress-grid" aria-label="Controlled progress report counters">
          {progressCounters.map(([key, value]) => <span key={key}>Report counter {sanitizeDisplayText(key)}: {value}</span>)}
        </div>
        <div className="agent-progress-grid" aria-label="Controlled progress report limits">
          {progressLimits.map(([key, value]) => <span key={key}>Report limit {sanitizeDisplayText(key)}: {value}</span>)}
        </div>
        <div className="agent-progress-grid" aria-label="Controlled progress report authority flags">
          {progressSafetyFlags.map(([key, value]) => <span key={key}>Report flag {sanitizeDisplayText(key)}: {typeof value === "string" ? sanitizeDisplayText(value) : String(value)}</span>)}
        </div>
        {progressDiagnostics.length > 0 && <div className="readiness-card warn" role="status" aria-label="Controlled progress report diagnostics"><strong>Progress diagnostics</strong>{progressDiagnostics.map((diagnostic, index) => <span key={`${index}:${diagnostic}`}>{sanitizeDisplayText(diagnostic)}</span>)}</div>}
      </section>}
      {mvpReport && <section className={`readiness-card ${mvpReport.status === "blocked" || mvpReport.status === "failed" || mvpReport.status === "stopped" ? "warn" : "ready"} stack`} aria-label="Controlled local agent MVP metadata">
        <div className="row">
          <strong>Controlled local agent MVP</strong>
          <span className="badge warn">dev preview</span>
          <span className="badge">S80 metadata</span>
          <span className="badge">display only</span>
          <span className={mvpReport.status === "blocked" || mvpReport.status === "failed" ? "badge warn" : "badge ok"}>{sanitizeDisplayText(mvpReport.status.replace(/_/g, " "))}</span>
        </div>
        <span>{sanitizeDisplayText(mvpReport.label)}</span>
        <span className="subtle">MVP metadata is aggregated from existing sanitized readiness, bounded read, edit, verification, progress, and final-report labels only. This panel still cannot start agents, post bridge/runtime commands, read hidden files, apply edits, run verification, call providers, use shell, or use git.</span>
        <section className={`readiness-card ${mvpReport.runtimeSession.present && mvpReport.runtimeSession.status !== "blocked" ? "ready" : "warn"} stack`} aria-label="Controlled runtime session metadata">
          <div className="row">
            <strong>Controlled runtime session metadata</strong>
            <span className="badge">S82 evidence</span>
            <span className="badge">read only</span>
            <span className={mvpReport.runtimeSession.present ? "badge ok" : "badge warn"}>{mvpReport.runtimeSession.present ? sanitizeDisplayText(mvpReport.runtimeSession.status.replace(/_/g, " ")) : "pending"}</span>
          </div>
          <span>{sanitizeDisplayText(mvpReport.runtimeSession.label)}</span>
          <span className="subtle">Runtime session evidence is sanitized metadata only. No Start Agent button, runtime call, bridge message, browser storage, provider call, filesystem access, shell command, git action, or tool execution is created here.</span>
          <div className="agent-progress-grid" aria-label="Controlled runtime session authority flags">
            <span>Runtime session display only: {String(mvpReport.runtimeSession.displayOnly)}</span>
            <span>Runtime session metadata only: {String(mvpReport.runtimeSession.metadataOnly)}</span>
            <span>Runtime session execution allowed: {String(mvpReport.runtimeSession.executionAllowed)}</span>
            <span>Runtime session agent start allowed: {String(mvpReport.runtimeSession.agentStartAllowed)}</span>
            <span>Runtime session next user action: {sanitizeDisplayText(mvpReport.runtimeSession.nextUserAction.replace(/_/g, " "))}</span>
          </div>
          {runtimeSessionDiagnostics.length > 0 && <span className="subtle">Runtime session diagnostics: {runtimeSessionDiagnostics.map((diagnostic) => sanitizeDisplayText(diagnostic)).join(", ")}</span>}
        </section>
        <ol className="manual-runner-steps" aria-label="Controlled local agent MVP checklist">
          {mvpReport.checklist.map((item) => (
            <li className={`manual-runner-step ${item.state === "completed" || item.state === "ready" ? "done" : item.state === "running" ? "current" : "waiting"}`} key={item.id}>
              <strong>{sanitizeDisplayText(item.id.replace(/_/g, " "))}: {sanitizeDisplayText(item.state.replace(/_/g, " "))}</strong>
              <span>{sanitizeDisplayText(item.label)}</span>
              {item.diagnostics.length > 0 && <span className="subtle">Diagnostics: {item.diagnostics.map((diagnostic) => sanitizeDisplayText(diagnostic)).join(", ")}</span>}
            </li>
          ))}
        </ol>
        {mvpReport.finalReport && <div className={`readiness-card ${mvpReport.finalReport.status === "completed" ? "ready" : "warn"}`} role="status" aria-label="Controlled local agent MVP final report">
          <strong>Final report: {sanitizeDisplayText(mvpReport.finalReport.label)}</strong>
          <span>{sanitizeDisplayText(mvpReport.finalReport.summary)}</span>
        </div>}
        <div className="agent-progress-grid" aria-label="Controlled local agent MVP safety flags">
          {mvpSafetyFlags.map(([key, value]) => <span key={key}>MVP flag {sanitizeDisplayText(key)}: {typeof value === "string" ? sanitizeDisplayText(value) : String(value)}</span>)}
        </div>
        {mvpDiagnostics.length > 0 && <div className="readiness-card warn" role="status" aria-label="Controlled local agent MVP diagnostics"><strong>MVP diagnostics</strong>{mvpDiagnostics.map((diagnostic, index) => <span key={`${index}:${diagnostic}`}>{sanitizeDisplayText(diagnostic)}</span>)}</div>}
      </section>}
      <div className="agent-progress-grid" aria-label="Controlled run status">
        <span>Phase: {phaseLabel}</span>
        <span>Current step: {currentStep}</span>
        <span>Next user action: {sanitizeDisplayText(state.nextUserAction.replace(/_/g, " "))}</span>
        <span>Stop reason: {stopReason}</span>
        <span>Stopped: {String(state.stopped)}</span>
        <span>Enabled: {String(state.enabled)}</span>
      </div>
      <div className="agent-progress-grid" aria-label="Controlled run authority flags">
        <span>Authority: {sanitizeDisplayText(state.authority)}</span>
        <span>Execution allowed: {String(state.executionAllowed)}</span>
        <span>Agent start allowed: {String(state.agentStartAllowed)}</span>
        <span>Auto start allowed: {String(state.autoStartAllowed)}</span>
        <span>Can read files: {String(state.canReadFiles)}</span>
        <span>Can write files: {String(state.canWriteFiles)}</span>
        <span>Can run commands: {String(state.canRunCommands)}</span>
        <span>Can apply edits: {String(state.canApplyEdits)}</span>
        <span>Can call provider: {String(state.canCallProvider)}</span>
        <span>Can use tools: {String(state.canUseTools)}</span>
      </div>
      <div className="agent-progress-grid" aria-label="Controlled run limits">
        {limits.map(([key, value]) => <span key={key}>Limit {sanitizeDisplayText(key)}: {value}</span>)}
      </div>
      <div className="agent-progress-grid" aria-label="Controlled run counters">
        {counters.map(([key, value]) => <span key={key}>Counter {sanitizeDisplayText(key)}: {value}</span>)}
      </div>
      {state.stop && <div className="readiness-card warn" role="status" aria-label="Controlled run stop reason"><strong>Stop reason</strong><span>{stopReason}: {sanitizeDisplayText(state.stop.message)}</span><span>Recoverable: {String(state.stop.recoverable)}</span></div>}
      {diagnostics.length > 0 && <div className="readiness-card warn" role="status" aria-label="Controlled run diagnostics"><strong>Diagnostics</strong>{diagnostics.map((diagnostic, index) => <span key={`${index}:${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}</div>}
      <div className="row">
        <button type="button" className="secondary-button" disabled={true}>Start controlled dev-preview</button>
        <button type="button" className="danger-button" onClick={onStop} disabled={stopDisabled}>Stop controlled run</button>
        <span className="subtle">Stop updates GUI-local React state only. No runtime, bridge, storage, provider, command, file, process, or git request is sent.</span>
      </div>
    </section>
  );
}

function currentStepLabel(state: ControlledAgentRunState): string {
  if (state.phase === "workspace_ready") return "Review plan";
  if (state.phase === "reading_context") return "Review bounded read metadata";
  if (state.phase === "planning") return "Review sanitized plan metadata";
  if (state.phase === "waiting_for_user") return "Wait for explicit user review";
  if (state.phase === "running_verification") return "Review allowlisted verification metadata";
  if (state.phase === "stopped") return "Stopped by user";
  if (state.phase === "blocked") return "Review blocking diagnostic";
  if (state.phase === "failed") return "Review failure diagnostic";
  if (state.phase === "completed") return "Review completion metadata";
  if (state.phase === "opt_in_required") return "Review opt-in requirement";
  return "Idle";
}

function controlledReportStatusFromRunPhase(phase: ControlledAgentRunState["phase"]): string {
  if (phase === "completed") return "completed";
  if (phase === "stopped") return "stopped";
  if (phase === "failed") return "failed";
  if (phase === "blocked" || phase === "idle" || phase === "opt_in_required") return "blocked";
  return "running";
}
