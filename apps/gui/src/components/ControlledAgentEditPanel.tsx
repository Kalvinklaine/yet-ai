import { useMemo, useState } from "react";
import { evaluateControlledAgentEditExecutor, type ControlledAgentEditExecutorSummary } from "../services/controlledAgentEditExecutor";
import type { ControlledAgentEditRequestResult } from "../services/controlledAgentEditRequest";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentEditPanelProps = {
  metadata?: unknown;
  evaluatedEdit?: ControlledAgentEditExecutorSummary;
  request?: ControlledAgentEditRequestResult;
  pendingRequestId?: string | null;
  note?: string | null;
  onRequest?: () => void;
  onClearPending?: () => void;
};

export function ControlledAgentEditPanel({ metadata, evaluatedEdit, request, pendingRequestId, note, onRequest, onClearPending }: ControlledAgentEditPanelProps) {
  const [open, setOpen] = useState(false);
  const evaluatedMetadata = useMemo(() => evaluateControlledAgentEditExecutor(metadata), [metadata]);
  const edit = evaluatedEdit ?? evaluatedMetadata;
  const requestDiagnostics = request?.diagnostics.slice(0, 4) ?? [];
  const diagnostics = edit.diagnostics.slice(0, 6);
  const canRequest = request?.state === "ready" && !pendingRequestId && onRequest;
  const tone = edit.state === "planned" || edit.state === "applied" ? "ready" : "warn";

  return (
    <section className={`readiness-card ${tone} controlled-agent-edit-panel stack`} aria-label="Controlled edit evidence" data-testid="controlled-agent-edit-panel">
      <details className="debug-details" data-testid="controlled-agent-edit-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2>Controlled edit evidence</h2>
          <span className="badge warn">S84 bounded edit</span>
          <span className="badge">metadata only</span>
          <span className={edit.canApplyControlledEdit ? "badge ok" : "badge warn"}>{sanitizeDisplayText(edit.state.replace(/_/g, " "))}</span>
        </summary>
        {open && (
          <div className="stack">
            <span>{sanitizeDisplayText(edit.summary)}</span>
            <strong>Bounded replacement edit evidence.</strong>
            <span className="subtle">This panel posts only after the explicit request button is clicked. It cannot read files, create/delete/rename files, run commands, call providers, use git, auto-apply, or write browser storage.</span>
            <span className="subtle">Raw replacement text, raw bodies, diffs, secrets, and private paths are intentionally omitted from the UI. Only sanitized labels, hashes, ranges, byte counts, and status are shown.</span>
            <div className="agent-progress-grid" aria-label="Controlled edit authority flags">
              <span>Authority: bounded replacement edit evidence</span>
              <span>Can apply controlled edit: {String(edit.canApplyControlledEdit)}</span>
              <span>Can create files: {String(edit.canCreateFiles)}</span>
              <span>Can delete files: {String(edit.canDeleteFiles)}</span>
              <span>Can rename files: {String(edit.canRenameFiles)}</span>
              <span>Can run commands: {String(edit.canRunCommands)}</span>
              <span>Edit count: {edit.editCount}</span>
              <span>Replacement bytes: {edit.replacementByteCount}</span>
            </div>
            <div className="agent-progress-grid" aria-label="Controlled edit sanitized metadata">
              {edit.touchedFileLabels.slice(0, 6).map((label) => <span key={`file:${label}`}>File label: {sanitizeDisplayText(label)}</span>)}
              {edit.rangeLabels.slice(0, 6).map((label) => <span key={`range:${label}`}>Range: {sanitizeDisplayText(label)}</span>)}
              {edit.expectedContentHashLabels.slice(0, 6).map((label) => <span key={`expected:${label}`}>Expected hash: {sanitizeDisplayText(label)}</span>)}
              {edit.replacementHashLabels.slice(0, 6).map((label) => <span key={`replacement:${label}`}>Replacement hash: {sanitizeDisplayText(label)}</span>)}
            </div>
            {diagnostics.length > 0 && (
              <div className="readiness-card warn" role="status" aria-label="Controlled edit diagnostics">
                <strong>Diagnostics</strong>
                {diagnostics.map((diagnostic) => <span key={diagnostic}>{sanitizeDisplayText(diagnostic)}</span>)}
              </div>
            )}
            <div className={`readiness-card ${request?.state === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled edit request status">
              <div className="row">
                <strong>Explicit controlled edit request</strong>
                <span className={request?.state === "ready" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(request?.state ?? "blocked")}</span>
                {pendingRequestId && <span className="badge warn">pending</span>}
              </div>
              <span className="subtle">Posts only after this button is clicked. No page-load, runtime-ready, workspace-ready, proposal-detected, provider, storage, or hidden background edit is started here.</span>
              {request?.details.editCount !== undefined && <span>Edit count: {sanitizeDisplayText(String(request.details.editCount))}</span>}
              {request?.details.replacementByteCount !== undefined && <span>Replacement bytes: {sanitizeDisplayText(String(request.details.replacementByteCount))}</span>}
              {pendingRequestId && <span>Pending request: {sanitizeDisplayText(pendingRequestId)}</span>}
              {note && <span>{sanitizeDisplayText(note)}</span>}
              {requestDiagnostics.length > 0 && <span className="subtle">Request diagnostics: {requestDiagnostics.map((diagnostic) => sanitizeDisplayText(diagnostic.code)).join(", ")}</span>}
              <div className="row">
                {canRequest && <button type="button" onClick={onRequest}>Request controlled edit</button>}
                {pendingRequestId && <button type="button" className="secondary-button" onClick={onClearPending}>Clear pending edit</button>}
              </div>
              {!canRequest && !pendingRequestId && <span className="subtle">No action controls are rendered.</span>}
            </div>
          </div>
        )}
      </details>
    </section>
  );
}
