import { useEffect, useState } from "react";
import type { ApplyWorkspaceEditPayload, ApplyWorkspaceEditResultPayload, BridgeHost } from "../bridge/bridgeAdapter";
import { editProposalRejectedRecoveryGuidance, type EditProposalRejectedDiagnostic } from "../services/editProposal";
import { buildEditProposalQualitySummary } from "../services/editProposalQuality";
import { sanitizeDisplayText } from "../services/redaction";

export type EditProposalState = {
  requestId: string;
  payload: ApplyWorkspaceEditPayload;
  sourceMessageId: string;
  payloadKey: string;
};

export type ApplyResultState = {
  requestId: string;
  proposalRequestId: string | null;
  payload: ApplyWorkspaceEditResultPayload;
};

export type RejectedEditProposalState = {
  sourceMessageId: string;
  diagnostic: EditProposalRejectedDiagnostic;
};

export type EditProposalPanelProps = {
  proposal: EditProposalState | null;
  rejected: RejectedEditProposalState | null;
  result: ApplyResultState | null;
  host: BridgeHost;
  pendingRequestId: string | null;
  note: string | null;
  onApply: () => void;
  onCancelPending: () => void;
};

export function EditProposalPanel({ proposal, rejected, result, host, pendingRequestId, note, onApply, onCancelPending }: EditProposalPanelProps) {
  if (!proposal && !rejected && !result && !note) {
    return null;
  }
  const title = rejected && !proposal ? "Edit proposal detected but rejected" : "Propose safe edit";
  return (
    <section className={`edit-proposal-card stack ${rejected && !proposal ? "rejected" : ""}`} aria-label={rejected && !proposal ? "Rejected edit proposal" : "Propose safe edit preview"}>
      <div className="row">
        <strong>{title}</strong>
        <span className="badge warn">review required</span>
        <span className="badge ok">no auto-apply</span>
      </div>
      {rejected && !proposal ? <RejectedEditProposalPreview rejected={rejected} /> : proposal ? <EditProposalPreview proposal={proposal} host={host} pending={pendingRequestId !== null} onApply={onApply} onCancelPending={onCancelPending} /> : <span className="subtle">No valid bounded edit proposal is available.</span>}
      {result && !rejected && <ApplyResultPreview result={result} />}
      {note && <span className="subtle" role="status">{sanitizeDisplayText(note)}</span>}
    </section>
  );
}

export function RejectedEditProposalPreview({ rejected }: { rejected: RejectedEditProposalState }) {
  const guidance = editProposalRejectedRecoveryGuidance(rejected.diagnostic.reasonCode);
  return (
    <div className="readiness-card warn stack" role="status" data-testid="edit-proposal-rejected-card">
      <strong>Edit proposal detected but rejected</strong>
      <span>{sanitizeDisplayText(rejected.diagnostic.message)}</span>
      <span className="subtle">Reason: {sanitizeDisplayText(rejected.diagnostic.reasonCode)}</span>
      <span>Apply is unavailable because this response did not pass safe-edit proposal validation. No apply request is available for this response.</span>
      <strong>{sanitizeDisplayText(guidance.title)}</strong>
      <span>{sanitizeDisplayText(guidance.nextStep)}</span>
      <span className="subtle">Expected correction: {sanitizeDisplayText(guidance.formatHint)}</span>
      <span className="subtle">Recovery stays manual: use the Safe edit/proposal template. Ask the model to resend one strict edit proposal, then review the next proposal card before choosing any IDE apply request.</span>
    </div>
  );
}

export type EditProposalPreviewProps = {
  proposal: EditProposalState;
  host: BridgeHost;
  pending: boolean;
  onApply: () => void;
  onCancelPending: () => void;
};

export function EditProposalPreview({ proposal, host, pending, onApply, onCancelPending }: EditProposalPreviewProps) {
  const files = proposal.payload.edits;
  const editCount = files.reduce((count, file) => count + file.textReplacements.length, 0);
  const fileCount = files.length;
  const hasRedactedPreview = hasRedactedReplacementPreview(proposal);
  const acknowledgementKey = proposal.payloadKey || proposal.requestId;
  const [acknowledgedRedactedPreview, setAcknowledgedRedactedPreview] = useState(false);
  useEffect(() => {
    setAcknowledgedRedactedPreview(false);
  }, [acknowledgementKey]);
  const quality = buildEditProposalQualitySummary({
    payload: proposal.payload,
    host,
    pending,
    hasRedactedPreview,
    acknowledgedRedactedPreview,
  });
  const applyBlockedByRedaction = hasRedactedPreview && !acknowledgedRedactedPreview;
  const applyDisabled = pending || applyBlockedByRedaction;
  return (
    <div className="stack">
      <span>{sanitizeDisplayText(proposal.payload.summary)}</span>
      <div className="edit-proposal-grid">
        <span>Proposal id: {sanitizeDisplayText(proposal.requestId)}</span>
        <span data-testid="edit-proposal-unique-files">Files: {fileCount}</span>
        <span data-testid="edit-proposal-edit-count">Text edits: {editCount}</span>
        <span>Cloud required: false</span>
      </div>
      <div className="readiness-card" data-testid="edit-proposal-quality-summary">
        <strong>Quality summary</strong>
        <span>{quality.fileCount} files · {quality.replacementCount} replacements · total chars {quality.totalReplacementChars} · max chars {quality.maxReplacementChars} · preview {quality.hasRedactedPreview ? "redacted/shortened" : "none"} · status {sanitizeDisplayText(quality.latestStatus)}</span>
      </div>
      <div className="row" aria-label="Edit proposal risk badges" data-testid="edit-proposal-risk-badges">
        {quality.riskBadges.map((badge) => <span className="badge warn" key={badge}>{sanitizeDisplayText(badge)}</span>)}
      </div>
      {quality.disabledApplyReasons.length > 0 && (
        <div className="readiness-card warn" role="status" data-testid="edit-proposal-disabled-reasons">
          <strong>Apply disabled</strong>
          {quality.disabledApplyReasons.map((reason) => <span key={reason}>{sanitizeDisplayText(reason)}</span>)}
        </div>
      )}
      {hasRedactedPreview && (
        <div className="readiness-card warn" role="status" data-testid="edit-proposal-redaction-warning">
          Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.
          <label className="stack edit-proposal-ack" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              data-testid="edit-proposal-acknowledge-redaction"
              checked={acknowledgedRedactedPreview}
              onChange={(event) => setAcknowledgedRedactedPreview(event.target.checked)}
            />
            <span>I understand the raw replacement text may differ from the redacted preview.</span>
          </label>
        </div>
      )}
      <div className="stack">
        {files.map((file, index) => (
          <article className="edit-file-card stack" key={`${file.workspaceRelativePath}:${index}`}>
            <strong>{sanitizeDisplayText(file.workspaceRelativePath)}</strong>
            <span>{file.textReplacements.length} replacement{file.textReplacements.length === 1 ? "" : "s"}</span>
            {file.textReplacements.slice(0, 4).map((replacement, index) => (
              <div className="edit-replacement-preview" key={`${file.workspaceRelativePath}:${index}`}>
                <span>Range {formatEditRange(replacement.range)} · replacement characters {replacement.replacementText.length}</span>
                <pre>{boundedReplacementPreview(replacement.replacementText)}</pre>
              </div>
            ))}
            {file.textReplacements.length > 4 && <span className="subtle">{file.textReplacements.length - 4} more replacements hidden.</span>}
          </article>
        ))}
      </div>
      {host !== "vscode" && host !== "jetbrains" ? (
        <div className="readiness-card warn" role="status">Preview only in this host. Browser cannot apply proposed edits; VS Code and JetBrains can receive an apply request after you review and click.</div>
      ) : (
        <div className="row">
          <button
            type="button"
            onClick={onApply}
            disabled={applyDisabled}
            data-testid="edit-proposal-apply-button"
          >
            {pending ? `${applyHostLabel(host)} apply request pending…` : `Apply in ${applyHostLabel(host)} after review`}
          </button>
          {pending && <button type="button" onClick={onCancelPending}>Clear pending apply state</button>}
        </div>
      )}
      <span className="subtle">No auto-apply. IDE host confirmation is required.</span>
    </div>
  );
}

function applyHostLabel(host: BridgeHost): string {
  return host === "jetbrains" ? "JetBrains" : "VS Code";
}

export type ApplyResultPreviewProps = {
  result: ApplyResultState;
};

const APPLY_RESULT_REPAIR_GUIDANCE: Readonly<Record<ApplyWorkspaceEditResultPayload["status"], string>> = Object.freeze({
  applied: "Edits were applied by the host after confirmation.",
  denied: "The host/user declined the edit. Review the host confirmation and request apply again only if you still want it.",
  rejected: "The host rejected the edit by policy or validation. Ask for a smaller/safe proposal before trying again.",
  failed: "The host failed while applying. The file may have changed; refresh context and ask for an updated proposal before retrying.",
});

export function ApplyResultPreview({ result }: ApplyResultPreviewProps) {
  const guidance = APPLY_RESULT_REPAIR_GUIDANCE[result.payload.status];
  return (
    <div className={`apply-result-card ${result.payload.status}`} role="status">
      <strong>Host apply result: {sanitizeDisplayText(result.payload.status)}</strong>
      <span>{sanitizeDisplayText(result.payload.message)}</span>
      <span>Request: {sanitizeDisplayText(result.requestId)} · applied edits: {result.payload.appliedEditCount ?? 0} · cloud required: false</span>
      {result.payload.affectedFiles && result.payload.affectedFiles.length > 0 && <span>Affected files: {result.payload.affectedFiles.map((file) => sanitizeDisplayText(safeDisplayPath(file))).join(", ")}</span>}
      {guidance && <span className="subtle" data-testid="apply-result-guidance">{sanitizeDisplayText(guidance)}</span>}
    </div>
  );
}

function safeDisplayPath(path: string): string {
  if (/^\/|^~|^[A-Za-z]:[\\/]|\\|:|\?|#|(^|\/)\.\.?($|\/)|(?:^|[._\/-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._\/-]|$)|^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(path)) {
    return "[redacted]";
  }
  return path;
}

const replacementPreviewLimit = 320;

export function boundedReplacementPreview(text: string): string {
  if (!text) {
    return "Empty replacement text.";
  }
  return sanitizeDisplayText(text.length > replacementPreviewLimit ? `${text.slice(0, replacementPreviewLimit)}…` : text);
}

export function isReplacementPreviewRedacted(text: string): boolean {
  if (!text) {
    return false;
  }
  const rawPreview = text.length > replacementPreviewLimit ? `${text.slice(0, replacementPreviewLimit)}…` : text;
  const sanitized = sanitizeDisplayText(rawPreview);
  return text.length > replacementPreviewLimit || sanitized !== rawPreview;
}

export function hasRedactedReplacementPreview(proposal: EditProposalState): boolean {
  if (!proposal || !proposal.payload || !Array.isArray(proposal.payload.edits)) {
    return false;
  }
  for (const file of proposal.payload.edits) {
    if (!file || !Array.isArray(file.textReplacements)) {
      continue;
    }
    for (const replacement of file.textReplacements) {
      if (isReplacementPreviewRedacted(replacement.replacementText)) {
        return true;
      }
    }
  }
  return false;
}

function formatEditRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}
