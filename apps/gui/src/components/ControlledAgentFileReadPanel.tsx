import { useMemo, useState } from "react";
import { evaluateControlledAgentFileRead, type ControlledAgentFileReadSummary } from "../services/controlledAgentFileRead";
import type { ControlledAgentFileReadRequestResult } from "../services/controlledAgentFileReadRequest";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentFileReadPanelProps = {
  metadata?: unknown;
  evaluatedRead?: ControlledAgentFileReadSummary;
  request?: ControlledAgentFileReadRequestResult;
  pendingRequestId?: string | null;
  note?: string | null;
  onRequest?: () => void;
  onClearPending?: () => void;
};

export function ControlledAgentFileReadPanel({ metadata, evaluatedRead, request, pendingRequestId, note, onRequest, onClearPending }: ControlledAgentFileReadPanelProps) {
  const [open, setOpen] = useState(false);
  const evaluatedMetadata = useMemo(() => evaluateControlledAgentFileRead(metadata), [metadata]);
  const read = evaluatedRead ?? evaluatedMetadata;
  const detailEntries = Object.entries(read.details).slice(0, 12);
  const diagnostics = read.diagnostics.slice(0, 6);
  const requestDiagnostics = request?.diagnostics.slice(0, 4) ?? [];
  const stateLabel = read.state.replace(/_/g, " ");
  const tone = read.state === "success" || read.state === "truncated" ? "ready" : "warn";
  const canRequest = request?.state === "ready" && !pendingRequestId && onRequest;

  return (
    <section className={`readiness-card ${tone} controlled-agent-file-read-panel stack`} aria-label="Controlled file read evidence" data-testid="controlled-agent-file-read-panel">
      <details className="debug-details" data-testid="controlled-agent-file-read-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2>Controlled file read evidence</h2>
          <span className="badge warn">S74 bounded read</span>
          <span className="badge">metadata only</span>
          <span className={read.allowedToRead ? "badge ok" : "badge warn"}>{sanitizeDisplayText(stateLabel)}</span>
        </summary>
        {open && (
          <div className="stack">
            <span>{sanitizeDisplayText(read.summary)}</span>
            <strong>Bounded controlled workspace read evidence.</strong>
            <span className="subtle">Preview-only metadata: this panel cannot read files, search, attach context, run commands, call providers, apply edits, write files, use git, or write browser storage.</span>
            <span className="subtle">Raw file bodies are intentionally omitted from this S74 display. Only sanitized path labels, counts, status, truncation, and content hash evidence are shown.</span>
            <div className="agent-progress-grid" aria-label="Controlled file read authority flags">
              <span>Authority: bounded controlled workspace read evidence</span>
              <span>Allowed to read: {String(read.allowedToRead)}</span>
              <span>Can read hidden files: {String(read.canReadHiddenFiles)}</span>
              <span>Can search workspace: {String(read.canSearchWorkspace)}</span>
              <span>Can run commands: {String(read.canRunCommands)}</span>
              <span>Can write files: {String(read.canWriteFiles)}</span>
              <span>Can use git: {String(read.canUseGit)}</span>
              <span>Can call provider: {String(read.canCallProvider)}</span>
              <span>Can use tools: {String(read.canUseTools)}</span>
            </div>
            {read.preview && (
              <div className="agent-progress-grid" aria-label="Controlled file read sanitized preview metadata">
                <span>Path label: {sanitizeDisplayText(read.preview.pathLabel)}</span>
                <span>Bytes: {read.preview.byteCount}</span>
                <span>Lines: {read.preview.lineCount}</span>
                <span>Truncated: {String(read.preview.truncated)}</span>
                <span>Content hash: {sanitizeDisplayText(read.preview.contentHash)}</span>
              </div>
            )}
            {detailEntries.length > 0 && (
              <div className="agent-progress-grid" aria-label="Controlled file read sanitized metadata">
                {detailEntries.map(([key, value]) => <span key={key}>{sanitizeDisplayText(key)}: {formatDetailValue(value)}</span>)}
              </div>
            )}
            {diagnostics.length > 0 && (
              <div className="readiness-card warn" role="status" aria-label="Controlled file read diagnostics">
                <strong>Diagnostics</strong>
                {diagnostics.map((diagnostic) => <span key={`${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}
              </div>
            )}
            <div className={`readiness-card ${request?.state === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled file read request status">
              <div className="row">
                <strong>Explicit controlled read request</strong>
                <span className={request?.state === "ready" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(request?.state ?? "blocked")}</span>
                {pendingRequestId && <span className="badge warn">pending</span>}
              </div>
              <span className="subtle">Posts only after this button is clicked. No page-load, capability-refresh, runtime-session, search, command, provider, storage, or hidden background read is started here.</span>
              {request?.details.pathLabel && <span>Path label: {sanitizeDisplayText(String(request.details.pathLabel))}</span>}
              {pendingRequestId && <span>Pending request: {sanitizeDisplayText(pendingRequestId)}</span>}
              {note && <span>{sanitizeDisplayText(note)}</span>}
              {requestDiagnostics.length > 0 && <span className="subtle">Request diagnostics: {requestDiagnostics.map((diagnostic) => sanitizeDisplayText(diagnostic.code)).join(", ")}</span>}
              <div className="row">
                {canRequest && <button type="button" onClick={onRequest}>Request controlled read</button>}
                {pendingRequestId && <button type="button" className="secondary-button" onClick={onClearPending}>Clear pending read</button>}
              </div>
              {!canRequest && !pendingRequestId && <span className="subtle">No action controls are rendered.</span>}
            </div>
          </div>
        )}
      </details>
    </section>
  );
}

function formatDetailValue(value: ControlledAgentFileReadSummary["details"][string]): string {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayText(item)).join(" · ");
  }
  return sanitizeDisplayText(String(value));
}
