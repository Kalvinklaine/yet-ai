import { useMemo, useState } from "react";
import { evaluateControlledAgentWorkspaceReadiness, type ControlledAgentWorkspaceReadinessSummary } from "../services/controlledAgentWorkspaceReadiness";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentWorkspaceReadinessPanelProps = {
  metadata?: unknown;
};

export function ControlledAgentWorkspaceReadinessPanel({ metadata }: ControlledAgentWorkspaceReadinessPanelProps) {
  const [open, setOpen] = useState(false);
  const readiness = useMemo(() => evaluateControlledAgentWorkspaceReadiness(metadata), [metadata]);
  const detailEntries = Object.entries(readiness.details).slice(0, 12);
  const diagnostics = readiness.diagnostics.slice(0, 6);
  const stateLabel = readiness.state.replace(/_/g, " ");

  return (
    <section className={`readiness-card ${readiness.state === "ready_for_future_controlled_mode" ? "ready" : "warn"} controlled-agent-workspace-readiness-panel stack`} aria-label="Controlled workspace readiness" data-testid="controlled-agent-workspace-readiness-panel">
      <details className="debug-details" data-testid="controlled-agent-workspace-readiness-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2>Controlled workspace readiness</h2>
          <span className="badge warn">S73 future gated</span>
          <span className="badge">metadata only</span>
          <span className={readiness.state === "ready_for_future_controlled_mode" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(stateLabel)}</span>
        </summary>
        {open && (
          <div className="stack">
          <span>{sanitizeDisplayText(readiness.summary)}</span>
          <strong>Cannot start an agent.</strong>
          <span className="subtle">Experimental preview only: this panel cannot create worktrees, read files, apply edits, run commands, call providers or tools, verify, search, attach context, or roll back.</span>
          <span className="subtle">Browser preview remains unsupported for future controlled mode. Open an IDE host later when controlled workspace authority exists; this S73 panel still grants none.</span>
          <div className="agent-progress-grid" aria-label="Controlled workspace authority flags">
            <span>Authority: metadata only</span>
            <span>Cloud required: false</span>
            <span>Can start agent: {String(readiness.canStartAgent)}</span>
            <span>Can read files: {String(readiness.canReadFiles)}</span>
            <span>Can write files: {String(readiness.canWriteFiles)}</span>
            <span>Can run commands: {String(readiness.canRunCommands)}</span>
            <span>Can apply edits: {String(readiness.canApplyEdits)}</span>
            <span>Can call provider: {String(readiness.canCallProvider)}</span>
            <span>Can use git: {String(readiness.canUseGit)}</span>
            <span>Can auto rollback: {String(readiness.canAutoRollback)}</span>
          </div>
          {detailEntries.length > 0 && (
            <div className="agent-progress-grid" aria-label="Controlled workspace sanitized metadata">
              {detailEntries.map(([key, value]) => <span key={key}>{sanitizeDisplayText(key)}: {formatDetailValue(value)}</span>)}
            </div>
          )}
          {diagnostics.length > 0 && (
            <div className="readiness-card warn" role="status" aria-label="Controlled workspace diagnostics">
              <strong>Diagnostics</strong>
              {diagnostics.map((diagnostic) => <span key={`${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}
            </div>
          )}
          <span className="subtle">No action controls are rendered. Mutating and privileged workspace actions remain unavailable.</span>
        </div>
        )}
      </details>
    </section>
  );
}

function formatDetailValue(value: ControlledAgentWorkspaceReadinessSummary["details"][string]): string {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayText(item)).join(" · ");
  }
  return sanitizeDisplayText(String(value));
}
