import type { ProposalHistory, ProposalHistoryComparisonSummary } from "../services/proposalHistory";
import { createProposalHistoryComparisonSummary } from "../services/proposalHistory";
import { sanitizeDisplayText } from "../services/redaction";

export type ProposalHistoryPanelProps = {
  history: ProposalHistory;
};

export function ProposalHistoryPanel({ history }: ProposalHistoryPanelProps) {
  const comparison = createProposalHistoryComparisonSummary(history);
  const hasEntries = history.entries.length > 0;
  return (
    <section className={`readiness-card ${hasEntries ? "ready" : "warn"} proposal-history-panel stack`} aria-label="Proposal history and comparison" data-testid="proposal-history-panel">
      <div className="row">
        <strong>Proposal history</strong>
        {hasEntries && <span className="badge">read-only</span>}
        {hasEntries && <span className="badge">metadata only</span>}
        {hasEntries && <span className="badge">{comparison.totalCount} item{comparison.totalCount === 1 ? "" : "s"}</span>}
      </div>
      {hasEntries && <span className="subtle">Display-only metadata; controls unchanged.</span>}
      {hasEntries ? <ProposalHistoryComparison comparison={comparison} /> : <ProposalHistoryEmptyState />}
      {hasEntries && history.entries.length <= 4 && (
        <div className="stack" role="list" aria-label="Proposal history entries">
          {history.entries.map((entry, index) => (
            <article className="provider-item stack" role="listitem" key={`${entry.id ?? entry.source}:${entry.kind}:${index}`}>
              <div className="row">
                <strong>{index + 1}. {statusLabel(entry.status)}</strong>
                <span className="badge">{kindLabel(entry.kind)}</span>
                <span className={entry.status === "rejected" || entry.status === "apply_failed" || entry.status === "verification_failed" ? "badge warn" : "badge ok"}>{sanitizeDisplayText(entry.status)}</span>
              </div>
              <span>Summary: {sanitizeDisplayText(entry.summary ?? "No safe summary available.")}</span>
              <span className="subtle">Source: {sanitizeDisplayText(entry.source)}{entry.id ? ` · id ${sanitizeDisplayText(entry.id)}` : ""}{entry.timestamp ? ` · ${sanitizeDisplayText(entry.timestamp)}` : ""}</span>
              <span>Touched files: {entry.touchedFileCount}{entry.touchedFiles.length > 0 ? ` · ${entry.touchedFiles.map((file) => sanitizeDisplayText(file)).join(" · ")}` : " · no safe file labels"}</span>
              {entry.editCount !== undefined && <span>Text edits: {entry.editCount}</span>}
              {entry.applyStatus && <span>Apply metadata: {entry.applyStatus === "applied" ? "applied after explicit user action" : "failed after explicit user action"}</span>}
              {entry.verificationStatus && <span>Verification metadata: {entry.verificationStatus === "succeeded" ? "succeeded after explicit user action" : "failed after explicit user action"}</span>}
              {entry.diagnostics.length > 0 && <span className="subtle">Diagnostics: {entry.diagnostics.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
            </article>
          ))}
        </div>
      )}
      {comparison.diagnostics.length > 0 && (
        <div className="readiness-card warn" role="status" aria-label="Proposal history diagnostics">
          <strong>Sanitized history diagnostics</strong>
          {comparison.diagnostics.map((diagnostic) => <span key={diagnostic}>{sanitizeDisplayText(diagnostic)}</span>)}
        </div>
      )}
      {hasEntries && <span className="subtle">Policy: display only {String(comparison.policy.displayOnly)} · apply {String(comparison.policy.canRequestApply)} · verification {String(comparison.policy.canRequestVerification)}</span>}
    </section>
  );
}

function ProposalHistoryEmptyState() {
  return (
    <div className="readiness-card warn" role="status">
      <strong>No proposal history yet</strong>
      <span>No sanitized proposal, rejection, apply, verification, or plan-preview metadata is available for this chat. Existing apply and verification controls remain in their own panels.</span>
    </div>
  );
}

function ProposalHistoryComparison({ comparison }: { comparison: ProposalHistoryComparisonSummary }) {
  return (
    <div className="stack">
      <div className="agent-progress-grid" aria-label="Proposal history comparison metadata">
        <span>Total: {comparison.totalCount}</span>
        <span>Visible: {comparison.visibleCount}</span>
        <span>Rejected: {comparison.rejectedCount}</span>
        <span>Applied: {comparison.appliedCount}</span>
        <span>Verified: {comparison.verificationSucceededCount}</span>
        <span>Verify failed: {comparison.verificationFailedCount}</span>
        <span>Plans: {comparison.planPreviewCount}</span>
        <span>Latest: {sanitizeDisplayText(comparison.latestStatus)}</span>
      </div>
      <span>Latest: {sanitizeDisplayText(comparison.latestSummary)}</span>
      {comparison.touchedFileLabels.length > 0 && <span>Files: {comparison.touchedFileLabels.map((file) => sanitizeDisplayText(file)).join(" · ")}</span>}
      {comparison.comparisonLabels.length > 0 && comparison.totalCount <= 4 && <ul className="first-message-steps" aria-label="Proposal comparison labels">{comparison.comparisonLabels.map((label, index) => <li key={`${index}:${label}`}>{sanitizeDisplayText(label)}</li>)}</ul>}
    </div>
  );
}

function kindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
