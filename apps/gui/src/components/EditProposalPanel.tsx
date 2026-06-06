import { useEffect, useState } from "react";
import type { ApplyWorkspaceEditPayload, ApplyWorkspaceEditResultPayload, BridgeHost } from "../bridge/bridgeAdapter";
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

export type EditProposalPanelProps = {
  proposal: EditProposalState | null;
  result: ApplyResultState | null;
  host: BridgeHost;
  pendingRequestId: string | null;
  note: string | null;
  onApply: () => void;
  onCancelPending: () => void;
};

export function EditProposalPanel({ proposal, result, host, pendingRequestId, note, onApply, onCancelPending }: EditProposalPanelProps) {
  if (!proposal && !result && !note) {
    return null;
  }
  return (
    <section className="edit-proposal-card stack" aria-label="Edit proposal preview">
      <div className="row">
        <strong>Confirmed edit proposal</strong>
        <span className="badge warn">preview only</span>
      </div>
      {proposal ? <EditProposalPreview proposal={proposal} host={host} pending={pendingRequestId !== null} onApply={onApply} onCancelPending={onCancelPending} /> : <span className="subtle">No valid bounded edit proposal is available.</span>}
      {result && <ApplyResultPreview result={result} />}
      {note && <span className="subtle" role="status">{sanitizeDisplayText(note)}</span>}
    </section>
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
  const replacementPreviewSummaries = files.flatMap((file) =>
    file.textReplacements.map((replacement) => ({
      workspaceRelativePath: file.workspaceRelativePath,
      replacementText: replacement.replacementText,
      preview: boundedReplacementPreview(replacement.replacementText),
      isRedacted: isReplacementPreviewRedacted(replacement.replacementText),
    })),
  );
  const redactedPreviewCount = replacementPreviewSummaries.filter((entry) => entry.isRedacted).length;
  const hasRedactedPreview = hasRedactedReplacementPreview(proposal);
  const acknowledgementKey = proposal.payloadKey || proposal.requestId;
  const [acknowledgedRedactedPreview, setAcknowledgedRedactedPreview] = useState(false);
  useEffect(() => {
    setAcknowledgedRedactedPreview(false);
  }, [acknowledgementKey]);
  const applyBlockedByRedaction = hasRedactedPreview && !acknowledgedRedactedPreview;
  const applyDisabled = pending || applyBlockedByRedaction;
  return (
    <div className="stack">
      <span>{sanitizeDisplayText(proposal.payload.summary)}</span>
      <div className="edit-proposal-grid">
        <span>Request: {sanitizeDisplayText(proposal.requestId)}</span>
        <span data-testid="edit-proposal-unique-files">Files: {fileCount}</span>
        <span data-testid="edit-proposal-edit-count">Text edits: {editCount}</span>
        <span>Cloud required: false</span>
      </div>
      {hasRedactedPreview && (
        <div className="readiness-card warn" role="status" data-testid="edit-proposal-redaction-warning">
          Replacement preview was redacted or shortened. Applying uses the raw proposal text; inspect proposal JSON before applying.
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
      {host !== "vscode" ? (
        <div className="readiness-card warn" role="status">This MVP can apply workspace edits only from VS Code. Browser and JetBrains preview mode cannot request apply yet.</div>
      ) : (
        <div className="row">
          <button
            type="button"
            onClick={onApply}
            disabled={applyDisabled}
            data-testid="edit-proposal-apply-button"
          >
            {pending ? "Host apply pending…" : "Request host apply after review"}
          </button>
          {pending && <button type="button" onClick={onCancelPending}>Clear pending apply state</button>}
        </div>
      )}
      <span className="subtle">The GUI never edits files directly. The host must confirm and apply any workspace mutation. Clearing pending state only lets the GUI ignore an old host result; it does not close an already-open VS Code confirmation dialog.</span>
    </div>
  );
}

export type ApplyResultPreviewProps = {
  result: ApplyResultState;
};

const APPLY_RESULT_REPAIR_GUIDANCE: Readonly<Record<ApplyWorkspaceEditResultPayload["status"], string>> = Object.freeze({
  applied: "Edits were applied by the host after confirmation.",
  denied: "The host/user declined the edit. Review the proposal and request apply again only if you still want it.",
  rejected: "The host rejected the edit by policy or validation. Ask for a smaller/safe proposal or regenerate the edit.",
  failed: "The host failed while applying. The file may have changed; ask for an updated proposal or retry after checking the target range.",
});

export function ApplyResultPreview({ result }: ApplyResultPreviewProps) {
  const guidance = APPLY_RESULT_REPAIR_GUIDANCE[result.payload.status];
  return (
    <div className={`apply-result-card ${result.payload.status}`} role="status">
      <strong>Host apply result: {sanitizeDisplayText(result.payload.status)}</strong>
      <span>{sanitizeDisplayText(result.payload.message)}</span>
      <span>Request: {sanitizeDisplayText(result.requestId)} · applied edits: {result.payload.appliedEditCount ?? 0} · cloud required: false</span>
      {result.payload.affectedFiles && result.payload.affectedFiles.length > 0 && <span>Affected files: {result.payload.affectedFiles.map((file) => sanitizeDisplayText(file)).join(", ")}</span>}
      {guidance && <span className="subtle" data-testid="apply-result-guidance">{sanitizeDisplayText(guidance)}</span>}
    </div>
  );
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
