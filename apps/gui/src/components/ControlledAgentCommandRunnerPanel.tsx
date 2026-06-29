import { useMemo, useState } from "react";
import { evaluateControlledAgentCommandRun, type ControlledAgentCommandRunSummary } from "../services/controlledAgentCommandRunner";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentCommandRunnerPanelProps = {
  metadata?: unknown;
};

export function ControlledAgentCommandRunnerPanel({ metadata }: ControlledAgentCommandRunnerPanelProps) {
  const [open, setOpen] = useState(false);
  const commandRun = useMemo(() => evaluateControlledAgentCommandRun(metadata), [metadata]);
  const detailEntries = Object.entries(commandRun.details).slice(0, 16);
  const diagnostics = commandRun.diagnostics.slice(0, 6);
  const stateLabel = commandRun.state.replace(/_/g, " ");
  const tone = commandRun.state === "succeeded" ? "ready" : "warn";

  return (
    <section className={`readiness-card ${tone} controlled-agent-command-runner-panel stack`} aria-label="Controlled command evidence" data-testid="controlled-agent-command-runner-panel">
      <details className="debug-details" data-testid="controlled-agent-command-runner-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2>Controlled command evidence</h2>
          <span className="badge warn">S75 command id</span>
          <span className="badge">metadata only</span>
          <span className={commandRun.allowedToRunCommand ? "badge ok" : "badge warn"}>{sanitizeDisplayText(stateLabel)}</span>
        </summary>
        {open && (
          <div className="stack">
            <span>{sanitizeDisplayText(commandRun.summary)}</span>
            <strong>Allowlisted command-id evidence.</strong>
            <span className="subtle">Preview-only metadata: this panel cannot execute commands, reveal command strings, choose cwd/env, use shell, use git, call providers, read files, write files, or write browser storage.</span>
            <span className="subtle">Raw command strings, args, cwd, env, stdout, stderr, private paths, and secrets are intentionally omitted. Only sanitized command id, status, limits, exit code, duration, counts, hash, and bounded output-tail evidence are shown.</span>
            <div className="agent-progress-grid" aria-label="Controlled command authority flags">
              <span>Authority: allowlisted command-id evidence</span>
              <span>Allowed to run command: {String(commandRun.allowedToRunCommand)}</span>
              <span>Command id: {sanitizeDisplayText(commandRun.commandId ?? "none")}</span>
              <span>Command label: {sanitizeDisplayText(commandRun.commandIdLabel ?? "none")}</span>
              <span>Can run shell: {String(commandRun.canRunShell)}</span>
              <span>Can use git: {String(commandRun.canUseGit)}</span>
              <span>Can use network: {String(commandRun.canUseNetwork)}</span>
              <span>Can call provider: {String(commandRun.canCallProvider)}</span>
              <span>Can use tools: {String(commandRun.canUseTools)}</span>
              <span>Can read files: {String(commandRun.canReadFiles)}</span>
              <span>Can write files: {String(commandRun.canWriteFiles)}</span>
            </div>
            {commandRun.outputTail && (
              <div className="agent-progress-grid" aria-label="Controlled command bounded output metadata">
                <span>Output tail: {sanitizeDisplayText(commandRun.outputTail.outputTail)}</span>
                <span>Output bytes: {commandRun.outputTail.outputByteCount}</span>
                <span>Output lines: {commandRun.outputTail.outputLineCount}</span>
                <span>Truncated: {String(commandRun.outputTail.truncated)}</span>
                <span>Result hash: {sanitizeDisplayText(commandRun.outputTail.resultHash)}</span>
              </div>
            )}
            {detailEntries.length > 0 && (
              <div className="agent-progress-grid" aria-label="Controlled command sanitized metadata">
                {detailEntries.map(([key, value]) => <span key={key}>{sanitizeDisplayText(key)}: {formatDetailValue(value)}</span>)}
              </div>
            )}
            {diagnostics.length > 0 && (
              <div className="readiness-card warn" role="status" aria-label="Controlled command diagnostics">
                <strong>Diagnostics</strong>
                {diagnostics.map((diagnostic) => <span key={`${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}
              </div>
            )}
            <span className="subtle">No action controls are rendered. Future runtime execution endpoints must be added explicitly before any controlled command request can be made from the GUI.</span>
          </div>
        )}
      </details>
    </section>
  );
}

function formatDetailValue(value: ControlledAgentCommandRunSummary["details"][string]): string {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayText(item)).join(" · ");
  }
  return sanitizeDisplayText(String(value));
}
