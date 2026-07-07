import { useMemo, useState } from "react";
import { evaluateControlledAgentEditExecutor, type ControlledAgentEditExecutorSummary } from "../services/controlledAgentEditExecutor";
import type { ControlledAgentEditRequestResult } from "../services/controlledAgentEditRequest";
import type { ControlledAgentPatchPlanPreviewResult } from "../services/controlledAgentPatchPlanPreview";
import { sanitizeDisplayText } from "../services/redaction";

export type ControlledAgentEditPanelProps = {
  metadata?: unknown;
  evaluatedEdit?: ControlledAgentEditExecutorSummary;
  request?: ControlledAgentEditRequestResult;
  pendingRequestId?: string | null;
  note?: string | null;
  patchPlanPreview?: ControlledAgentPatchPlanPreviewResult;
  patchPlanConfirmed?: boolean;
  onRequest?: () => void;
  onConfirmPatchPlan?: () => void;
  onClearPending?: () => void;
};

export function ControlledAgentEditPanel({ metadata, evaluatedEdit, request, pendingRequestId, note, patchPlanPreview, patchPlanConfirmed = false, onRequest, onConfirmPatchPlan, onClearPending }: ControlledAgentEditPanelProps) {
  const [open, setOpen] = useState(false);
  const evaluatedMetadata = useMemo(() => evaluateControlledAgentEditExecutor(metadata), [metadata]);
  const edit = evaluatedEdit ?? evaluatedMetadata;
  const requestDiagnostics = request?.diagnostics.slice(0, 4) ?? [];
  const diagnostics = edit.diagnostics.slice(0, 6);
  const previewRequired = patchPlanPreview !== undefined;
  const previewReady = patchPlanPreview?.state === "ready";
  const previewAllowsRequest = !previewRequired || (previewReady && patchPlanConfirmed);
  const canConfirmPatchPlan = previewReady && !patchPlanConfirmed && !pendingRequestId && onConfirmPatchPlan;
  const canRequest = previewAllowsRequest && request?.state === "ready" && !pendingRequestId && onRequest;
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
            {patchPlanPreview && (
              <div className={`readiness-card ${patchPlanPreview.state === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled patch plan dry-run preview">
                <div className="row">
                  <strong>Dry-run patch plan preview</strong>
                  <span className={patchPlanPreview.state === "ready" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(patchPlanPreview.state)}</span>
                  <span className="badge">review only</span>
                  <span className="badge">no auto-apply</span>
                  {patchPlanConfirmed && <span className="badge ok">confirmed</span>}
                </div>
                {patchPlanPreview.state === "ready" ? (
                  <>
                    <span>{sanitizeDisplayText(patchPlanPreview.preview.summary)}</span>
                    <span className="subtle">Plan {sanitizeDisplayText(patchPlanPreview.preview.planId)} · {sanitizeDisplayText(patchPlanPreview.preview.workspaceLabel)} · metadata only {String(patchPlanPreview.preview.metadataOnly)} · dry-run only {String(patchPlanPreview.preview.dryRunOnly)} · automatic apply allowed {String(patchPlanPreview.preview.automaticApplyAllowed)}</span>
                    <div className="agent-progress-grid" aria-label="Controlled patch plan preview rows">
                      {patchPlanPreview.preview.rows.map((row) => <span key={`${row.workspaceRelativePath}:${row.lineRangeLabel}`}>{sanitizeDisplayText(row.fileLabel)} · {sanitizeDisplayText(row.lineRangeLabel)} · {sanitizeDisplayText(row.replacementLabel)} · {sanitizeDisplayText(row.replacementByteCountLabel)} · expected {sanitizeDisplayText(row.expectedContentHashLabel)} · user apply required {String(row.requiresUserApply)}</span>)}
                    </div>
                    <span className="subtle">Confirming this preview only unlocks the explicit controlled edit request button. It does not apply, read, verify, call providers, run commands, or persist raw patch bodies.</span>
                    {canConfirmPatchPlan && <button type="button" onClick={onConfirmPatchPlan}>Confirm dry-run preview</button>}
                  </>
                ) : (
                  <>
                    <span>Unsafe or malformed patch plan preview metadata is non-actionable. No controlled edit request can be posted from this panel.</span>
                    {patchPlanPreview.diagnostics.map((diagnostic) => <span key={`${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}
                  </>
                )}
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
              {previewRequired && !patchPlanConfirmed && patchPlanPreview?.state === "ready" && <span className="subtle">Confirm the dry-run patch plan preview before requesting the controlled edit.</span>}
              {patchPlanPreview && patchPlanPreview.state !== "ready" && <span className="subtle">Controlled edit request is disabled because the dry-run patch plan preview is non-actionable.</span>}
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
