import { useMemo } from "react";
import type { ControlledAgentProgressReport } from "../services/controlledAgentProgressReport";
import type { ControlledLocalAgentMvpReport } from "../services/controlledLocalAgentMvp";
import type { ControlledAgentRunState } from "../services/controlledAgentRunState";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentRunPanelProps = {
  state: ControlledAgentRunState;
  progressReport?: ControlledAgentProgressReport;
  mvpReport?: ControlledLocalAgentMvpReport;
  onStop: () => void;
};

export function ControlledAgentRunPanel({ state, progressReport, mvpReport, onStop }: ControlledAgentRunPanelProps) {
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
  const stopDisabled = state.stopped || state.phase === "idle" || state.phase === "opt_in_required" || state.phase === "blocked" || state.phase === "failed" || state.phase === "completed";

  return (
    <section className={`readiness-card ${state.stopped ? "warn" : "ready"} controlled-agent-run-panel stack`} aria-label="Controlled agent run skeleton" data-testid="controlled-agent-run-panel">
      <div className="row">
        <strong>Controlled agent run skeleton</strong>
        <span className="badge warn">S76 preview only</span>
        <span className="badge">GUI-local state</span>
        <span className="badge">metadata only</span>
        <span className={state.stopped ? "badge warn" : "badge ok"}>{phaseLabel}</span>
      </div>
      <span>{sanitizeDisplayText(state.summary)}</span>
      <span className="subtle">Preview-only skeleton: this panel cannot start agents, read files, write files, run commands, call providers, apply edits, use git, post bridge messages, or write browser storage.</span>
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
