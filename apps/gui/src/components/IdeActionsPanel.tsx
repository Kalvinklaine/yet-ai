import type { BridgeHost, IdeActionProgressPayload, IdeActionRequestPayload, IdeActionResultPayload, IdeActionType, VerificationCommandId, WorkspaceEditRange } from "../bridge/bridgeAdapter";
import { describeIdeActionProposal, type IdeActionProposalState } from "../services/ideActionProposal";
import { sanitizeDisplayText, sanitizeTimelineText } from "../services/redaction";

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

export type VerificationCommand = {
  id: VerificationCommandId;
  label: string;
  description: string;
};

export function IdeActionsPanel({ host, attempt, note, workspaceRelativePath, range, onGetContext, onOpenFile, onRevealRange, onClearPendingIdeAction }: IdeActionsPanelProps) {
  const supported = host === "vscode" || host === "jetbrains";
  const badgeCopy = host === "vscode" ? "VS Code controlled actions" : host === "jetbrains" ? "JetBrains controlled actions" : "browser unsupported";
  const pending = attempt?.status === "pending" || attempt?.status === "inProgress";
  const compact = !attempt && !note;
  const controls = !supported ? (
    <div className="readiness-card warn" role="status">Controlled IDE actions are unsupported in browser. No privileged action will be posted.</div>
  ) : (
    <div className="row">
      <button type="button" onClick={onGetContext} disabled={pending}>{pending ? "IDE action pending…" : "Get IDE context"}</button>
      <button type="button" onClick={() => workspaceRelativePath && onOpenFile(workspaceRelativePath)} disabled={pending || !workspaceRelativePath}>Open file</button>
      <button type="button" onClick={() => workspaceRelativePath && range && onRevealRange(workspaceRelativePath, range)} disabled={pending || !workspaceRelativePath || !range}>Reveal range</button>
    </div>
  );
  const body = (
    <>
      <p className="subtle">Safe local navigation/context actions only. This panel cannot edit files, run shell commands, call tools, read arbitrary file content, or send raw payloads.</p>
      {controls}
      {supported && pending && (
        <button type="button" className="secondary-button" onClick={onClearPendingIdeAction}>Clear pending IDE action state</button>
      )}
      {workspaceRelativePath && <span className="subtle">Active safe path: {sanitizeDisplayText(workspaceRelativePath)}</span>}
      {range && <span className="subtle">Active safe range: {formatEditRange(range)}</span>}
      {attempt ? <IdeActionAttemptPreview attempt={attempt} /> : <span className="subtle">No controlled IDE action requested yet.</span>}
      {note && <span className="subtle" role="status">{sanitizeDisplayText(note)}</span>}
    </>
  );
  return (
    <section className="ide-actions-card stack" aria-label="Agent activity IDE actions">
      {compact ? (
        <details className="compact-safety-details" data-testid="ide-actions-compact-details">
          <summary>
            <span className="compact-summary-title">🛡️ Agent activity · IDE actions</span>
            <span className={`badge ${supported ? "ok" : "warn"}`}>{badgeCopy}</span>
            <span className="badge">idle</span>
          </summary>
          <div className="stack compact-details-body">{body}</div>
        </details>
      ) : (
        <>
          <div className="row">
            <strong>Agent activity · IDE actions</strong>
            <span className={`badge ${supported ? "ok" : "warn"}`}>{badgeCopy}</span>
          </div>
          {body}
        </>
      )}
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
  if (result.action === "getActiveFileExcerpt" && result.contextAttachment) {
    const attachment = result.contextAttachment;
    return <span>Result excerpt: {sanitizeDisplayText(attachment.file.workspaceRelativePath ?? attachment.file.displayPath ?? "active file")} · range {formatEditRange(attachment.range)} · {attachment.text.length} chars · truncated {attachment.truncated ? "yes" : "no"}</span>;
  }
  if (result.action === "openWorkspaceFile" && result.workspaceRelativePath) {
    return <span>Result path: {sanitizeDisplayText(result.workspaceRelativePath)}</span>;
  }
  if (result.action === "revealWorkspaceRange" && result.workspaceRelativePath && result.range) {
    return <span>Result path: {sanitizeDisplayText(result.workspaceRelativePath)} · result range: {formatEditRange(result.range)}</span>;
  }
  return null;
}

export type VerificationCommandPanelProps = {
  host: BridgeHost;
  commands: VerificationCommand[];
  attempt: IdeActionAttemptState | null;
  note: string | null;
  showAppliedEditNextStep: boolean;
  attachedVerificationKey: string | null;
  onRun: (commandId: VerificationCommandId) => void;
  onClearPending: () => void;
  onAttachResult: (result: IdeActionResultPayload) => void;
};

export function VerificationCommandPanel({ host, commands, attempt, note, showAppliedEditNextStep, attachedVerificationKey, onRun, onClearPending, onAttachResult }: VerificationCommandPanelProps) {
  const supported = host === "vscode" || host === "jetbrains";
  const pending = attempt?.status === "pending" || attempt?.status === "inProgress";
  const activeCommandId = attempt?.result?.commandId ?? attempt?.progress?.commandId;
  const attachableResult = attempt?.result?.action === "runVerificationCommand" && (attempt.result.status === "succeeded" || attempt.result.status === "failed") && attempt.result.commandId && attempt.result.exitCode !== undefined && attempt.result.outputTail !== undefined && attempt.result.truncated !== undefined ? attempt.result : null;
  const attachableKey = attachableResult ? verificationOutputKey(attachableResult) : null;
  const alreadyAttached = attachableKey !== null && attachedVerificationKey === attachableKey;
  return (
    <section className={`readiness-card ${supported ? "ready" : "warn"} verification-command-card stack`} aria-label="Verification commands">
      <div className="row">
        <strong>Verification commands</strong>
        <span className={`badge ${supported ? "ok" : "warn"}`}>{supported ? `${host} explicit run` : "browser preview only"}</span>
        {pending && <span className="badge warn">pending</span>}
      </div>
      <span className="subtle">Allowlisted local verification only. Click a button to ask the IDE host to run one command; output stays in this panel and is not attached or sent automatically.</span>
      {showAppliedEditNextStep && <div className="readiness-card ready" role="status"><strong>Next safe step: run verification.</strong><span>Edits were applied by the IDE host. Pick an allowlisted command below when you are ready; the GUI will not run or send anything automatically.</span></div>}
      <div className="row" role="group" aria-label="Allowlisted verification commands">
        {commands.map((command) => (
          <button type="button" key={command.id} onClick={() => onRun(command.id)} disabled={!supported || pending} title={command.description}>
            {pending && activeCommandId === command.id ? "Verification pending…" : command.label}
          </button>
        ))}
      </div>
      {!supported && <div className="readiness-card warn" role="status">Browser preview only. Open {sanitizeDisplayText(host === "browser" ? "Yet AI in VS Code or JetBrains" : "an IDE host")} to request allowlisted verification commands.</div>}
      {supported && pending && <button type="button" className="secondary-button" onClick={onClearPending}>Clear pending verification state</button>}
      {attempt && attempt.action === "runVerificationCommand" ? <VerificationCommandAttemptPreview attempt={attempt} /> : <span className="subtle">No verification command requested yet.</span>}
      {attachableResult && <div className="row" role="group" aria-label="Verification result attachment"><button type="button" onClick={() => onAttachResult(attachableResult)} disabled={alreadyAttached}>{alreadyAttached ? "Verification result attached to next message" : "Attach verification result to next message"}</button><span className="subtle">Explicit one-shot context only. It clears after the next accepted send and stays available if send fails.</span></div>}
      {note && <span className="subtle" role="status">{sanitizeDisplayText(note)}</span>}
    </section>
  );
}

function VerificationCommandAttemptPreview({ attempt }: { attempt: IdeActionAttemptState }) {
  const result = attempt.result;
  return (
    <div className={`ide-action-status ${attempt.status}`} role="status">
      <strong>{sanitizeDisplayText(attempt.label)}: {sanitizeDisplayText(attempt.status)}</strong>
      <span>{sanitizeDisplayText(attempt.message)}</span>
      <span>Request: {sanitizeDisplayText(attempt.requestId)} · cloud required: false</span>
      {result?.commandId && <span>Command id: {sanitizeDisplayText(result.commandId)}</span>}
      {result?.exitCode !== undefined && <span>Exit code: {result.exitCode}</span>}
      {result?.durationMs !== undefined && <span>Duration: {result.durationMs} ms</span>}
      {result?.outputTail !== undefined && <pre aria-label="Verification output tail">{sanitizeTimelineText(result.outputTail)}</pre>}
      {result?.truncated !== undefined && <span>Output truncated: {result.truncated ? "yes" : "no"}</span>}
    </div>
  );
}

export function verificationOutputKey(result: IdeActionResultPayload): string {
  return [result.commandId ?? "unknown", result.status, result.exitCode ?? "unknown", result.truncated === true ? "truncated" : "complete", result.outputTail ?? ""].join("|");
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
      {host === "vscode" || host === "jetbrains" ? (
        <div className="row">
          <button type="button" onClick={() => onRun(proposal.payload)} disabled={pending}>{pending ? "IDE action pending…" : "Run read-only IDE action"}</button>
        </div>
      ) : (
        <div className="readiness-card warn" role="status">Browser preview only. No IDE action will be posted.</div>
      )}
    </section>
  );
}

function formatEditRange(range: WorkspaceEditRange): string {
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}
