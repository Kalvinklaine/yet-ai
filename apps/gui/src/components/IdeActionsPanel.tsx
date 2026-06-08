import type { BridgeHost, IdeActionProgressPayload, IdeActionRequestPayload, IdeActionResultPayload, IdeActionType, WorkspaceEditRange } from "../bridge/bridgeAdapter";
import { describeIdeActionProposal, type IdeActionProposalState } from "../services/ideActionProposal";
import { sanitizeDisplayText } from "../services/redaction";

export type IdeActionAttemptState = {
  requestId: string;
  action: IdeActionType;
  label: string;
  status: "pending" | "inProgress" | "succeeded" | "rejected" | "unavailable" | "failed";
  message: string;
  workspaceRelativePath?: string;
  range?: WorkspaceEditRange;
  progress?: IdeActionProgressPayload;
  result?: IdeActionResultPayload;
};

export type IdeActionsPanelProps = {
  host: BridgeHost;
  attempt: IdeActionAttemptState | null;
  note: string | null;
  workspaceRelativePath?: string;
  range?: WorkspaceEditRange;
  onGetContext: () => void;
  onOpenFile: (workspaceRelativePath: string) => void;
  onRevealRange: (workspaceRelativePath: string, range: WorkspaceEditRange) => void;
  onClearPendingIdeAction: () => void;
};

export function IdeActionsPanel({ host, attempt, note, workspaceRelativePath, range, onGetContext, onOpenFile, onRevealRange, onClearPendingIdeAction }: IdeActionsPanelProps) {
  const supported = host === "vscode";
  const pending = attempt?.status === "pending" || attempt?.status === "inProgress";
  return (
    <section className="ide-actions-card stack" aria-label="Agent activity IDE actions">
      <div className="row">
        <strong>Agent activity · IDE actions</strong>
        <span className={`badge ${supported ? "ok" : "warn"}`}>{supported ? "VS Code controlled actions" : host === "jetbrains" ? "JetBrains preview-only" : "browser unsupported"}</span>
      </div>
      <p className="subtle">Safe local navigation/context actions only. This panel cannot edit files, run shell commands, call tools, read arbitrary file content, or send raw payloads.</p>
      {!supported ? (
        <div className="readiness-card warn" role="status">Controlled IDE actions are unsupported/preview-only in {host}. No privileged action will be posted.</div>
      ) : (
        <div className="row">
          <button type="button" onClick={onGetContext} disabled={pending}>{pending ? "IDE action pending…" : "Get IDE context"}</button>
          <button type="button" onClick={() => workspaceRelativePath && onOpenFile(workspaceRelativePath)} disabled={pending || !workspaceRelativePath}>Open file</button>
          <button type="button" onClick={() => workspaceRelativePath && range && onRevealRange(workspaceRelativePath, range)} disabled={pending || !workspaceRelativePath || !range}>Reveal range</button>
        </div>
      )}
      {supported && pending && (
        <button type="button" className="secondary-button" onClick={onClearPendingIdeAction}>Clear pending IDE action state</button>
      )}
      {workspaceRelativePath && <span className="subtle">Active safe path: {sanitizeDisplayText(workspaceRelativePath)}</span>}
      {range && <span className="subtle">Active safe range: {formatEditRange(range)}</span>}
      {attempt ? <IdeActionAttemptPreview attempt={attempt} /> : <span className="subtle">No controlled IDE action requested yet.</span>}
      {note && <span className="subtle" role="status">{sanitizeDisplayText(note)}</span>}
    </section>
  );
}

export type IdeActionAttemptPreviewProps = {
  attempt: IdeActionAttemptState;
};

export function IdeActionAttemptPreview({ attempt }: IdeActionAttemptPreviewProps) {
  return (
    <div className={`ide-action-status ${attempt.status}`} role="status">
      <strong>{sanitizeDisplayText(attempt.label)}: {sanitizeDisplayText(attempt.status)}</strong>
      <span>{sanitizeDisplayText(attempt.message)}</span>
      <span>Request: {sanitizeDisplayText(attempt.requestId)} · cloud required: false</span>
      {attempt.workspaceRelativePath && <span>Path: {sanitizeDisplayText(attempt.workspaceRelativePath)}</span>}
      {attempt.range && <span>Range: {formatEditRange(attempt.range)}</span>}
      {renderIdeActionResultMetadata(attempt.result)}
    </div>
  );
}

function renderIdeActionResultMetadata(result: IdeActionResultPayload | undefined) {
  if (!result || result.status !== "succeeded") {
    return null;
  }
  if (result.action === "getContextSnapshot" && result.context) {
    return <span>Result context: source {sanitizeDisplayText(result.context.source)} · active editor present {result.context.hasActiveEditor ? "yes" : "no"} · workspace folders {result.context.workspaceFolderCount}</span>;
  }
  if (result.action === "openWorkspaceFile" && result.workspaceRelativePath) {
    return <span>Result path: {sanitizeDisplayText(result.workspaceRelativePath)}</span>;
  }
  if (result.action === "revealWorkspaceRange" && result.workspaceRelativePath && result.range) {
    return <span>Result path: {sanitizeDisplayText(result.workspaceRelativePath)} · result range: {formatEditRange(result.range)}</span>;
  }
  return null;
}

export type IdeActionProposalPanelProps = {
  proposal: IdeActionProposalState | null;
  host: BridgeHost;
  pending: boolean;
  onRun: (payload: IdeActionRequestPayload) => void;
};

export function IdeActionProposalPanel({ proposal, host, pending, onRun }: IdeActionProposalPanelProps) {
  if (!proposal) {
    return null;
  }
  const label = describeIdeActionProposal(proposal.proposal);
  return (
    <section className="ide-action-proposal-card stack" aria-label="Read-only IDE action proposal">
      <div className="row">
        <strong>Read-only IDE action proposal</strong>
        <span className="badge ok">cloud required: false</span>
        <span className="badge warn">requires confirmation</span>
      </div>
      <span>{sanitizeDisplayText(proposal.proposal.summary)}</span>
      <div className="edit-proposal-grid">
        <span>Action: {sanitizeDisplayText(label)}</span>
        <span>Proposal id: {sanitizeDisplayText(proposal.requestId)}</span>
        <span>Cloud required: false</span>
        {"workspaceRelativePath" in proposal.payload && <span>Path: {sanitizeDisplayText(proposal.payload.workspaceRelativePath)}</span>}
        {"range" in proposal.payload && <span>Range: {formatEditRange(proposal.payload.range)}</span>}
      </div>
      <span className="subtle">Review this assistant-proposed read-only navigation/context action before running. The GUI will not run it automatically and never accepts assistant-supplied request ids.</span>
      {host === "vscode" ? (
        <div className="row">
          <button type="button" onClick={() => onRun(proposal.payload)} disabled={pending}>{pending ? "IDE action pending…" : "Run read-only IDE action"}</button>
        </div>
      ) : (
        <div className="readiness-card warn" role="status">{host === "jetbrains" ? "JetBrains preview-only unsupported. No IDE action will be posted." : "Browser preview only. No IDE action will be posted."}</div>
      )}
    </section>
  );
}

function formatEditRange(range: WorkspaceEditRange): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}
