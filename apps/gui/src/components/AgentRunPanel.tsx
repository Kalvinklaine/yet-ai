import type { BridgeHost, VerificationCommandId } from "../bridge/bridgeAdapter";
import { evaluateAgentRunState } from "../services/agentRunState";
import { sanitizeDisplayText } from "../services/redaction";

export type AgentRunPanelProps = {
  input: unknown;
  host: BridgeHost;
  pendingApply: boolean;
  pendingVerification: boolean;
  onApplyReviewedPatch: () => void;
  onRunAllowlistedVerification: (commandId: VerificationCommandId) => void;
  onReviewRollback: () => void;
};

export function AgentRunPanel({ input, host, pendingApply, pendingVerification, onApplyReviewedPatch, onRunAllowlistedVerification, onReviewRollback }: AgentRunPanelProps) {
  const view = evaluateAgentRunState(input);
  const details = view.details;
  const supported = host === "vscode" || host === "jetbrains";
  const verificationCommandId = verificationCommandIdFromDetails(details.verificationCommandId);
  const canApply = supported && !pendingApply && view.nextUserAction === "confirm_apply";
  const canVerify = supported && !pendingVerification && view.nextUserAction === "confirm_verification" && verificationCommandId !== null;
  const canReviewRollback = view.rollbackAvailable || view.nextUserAction === "review_rollback";
  const touchedFileCount = numberDetail(details.touchedFileCount) ?? stringArrayDetail(details.touchedFiles).length;
  const editCount = numberDetail(details.editCount);
  const safetyItems = [
    "Experimental manual shell only: no autonomy, no auto-clicks, and no hidden model/provider calls.",
    "Apply and verification use existing IDE bridge messages only after your explicit click.",
    "Verification sends an allowlisted command id only; raw command, args, cwd, env, private paths, patch text, and file bodies are not shown here.",
    "Browser preview is inert for host actions. Open the IDE webview to request apply or verification.",
  ];

  return (
    <section className={`readiness-card ${view.enabled ? "ready" : "warn"} agent-run-panel stack`} aria-label="Experimental Agent Run" data-testid="agent-run-panel">
      <div className="row">
        <strong>Experimental Agent Run · one-step manual shell</strong>
        <span className={`badge ${supported ? "ok" : "warn"}`}>{supported ? `${host} explicit controls` : "browser preview only"}</span>
        <span className="badge">manual only</span>
        <span className={`badge ${view.stopped ? "warn" : view.enabled ? "ok" : ""}`}>{sanitizeDisplayText(view.state)}</span>
      </div>
      <span>{sanitizeDisplayText(view.summary)}</span>
      <div className="agent-progress-grid" aria-label="Agent Run status fields">
        <span>Run status: {sanitizeDisplayText(view.state)}</span>
        <span>Goal summary: {textDetail(details.goalTitle) || textDetail(details.goalSummary) || "No local goal selected"}</span>
        <span>Proposal status: {proposalStatus(view.state, details)}</span>
        <span>Checkpoint/policy readiness: {checkpointPolicyStatus(details)}</span>
        <span>Touched files: {touchedFileCount}</span>
        <span>Edit count: {editCount ?? 0}</span>
        <span>Apply status: {textDetail(details.applyStatus) || (details.applyRequested === true ? "requested" : "not requested")}</span>
        <span>Verification command id: {verificationCommandId ?? "not selected"}</span>
        <span>Verification status/result: {verificationStatus(details)}</span>
        <span>Rollback availability: {view.rollbackAvailable ? "available for review" : "not available"}</span>
      </div>
      {view.diagnostics.length > 0 && (
        <div className="readiness-card warn" role="status" aria-label="Agent Run diagnostics">
          <strong>Safety diagnostics</strong>
          {view.diagnostics.map((item) => <span key={`${item.code}:${item.message}`}>{sanitizeDisplayText(item.code)}: {sanitizeDisplayText(item.message)}</span>)}
        </div>
      )}
      <div className="readiness-card warn" role="status" aria-label="Agent Run safety copy">
        <strong>Safety copy</strong>
        {safetyItems.map((item) => <span key={item}>{item}</span>)}
      </div>
      <div className="row" role="group" aria-label="Agent Run explicit actions">
        <button type="button" onClick={onApplyReviewedPatch} disabled={!canApply}>Apply reviewed patch</button>
        <button type="button" onClick={() => verificationCommandId && onRunAllowlistedVerification(verificationCommandId)} disabled={!canVerify}>Run allowlisted verification</button>
        <button type="button" className="secondary-button" onClick={onReviewRollback} disabled={!canReviewRollback}>Review rollback</button>
      </div>
      {!supported && <span className="subtle">Browser preview stays preview-only. These controls will not post privileged host actions here; the cat has put the buttons behind glass.</span>}
      {(pendingApply || pendingVerification) && <span className="subtle" role="status">A user-requested host action is pending. Duplicate requests stay disabled.</span>}
    </section>
  );
}

function textDetail(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? sanitizeDisplayText(value) : "";
}

function numberDetail(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayDetail(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function verificationCommandIdFromDetails(value: unknown): VerificationCommandId | null {
  return value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests" ? value : null;
}

function proposalStatus(state: string, details: Record<string, string | number | boolean | string[]>): string {
  if (!details.proposalId && !details.proposalSummary) {
    return "not detected";
  }
  if (state === "ready_for_apply" || state === "apply_requested") {
    return "detected and awaiting explicit apply";
  }
  if (state === "prerequisites_blocked" || state === "blocked") {
    return "detected but blocked by prerequisites";
  }
  return "detected";
}

function checkpointPolicyStatus(details: Record<string, string | number | boolean | string[]>): string {
  const loopState = textDetail(details.boundedLoopState);
  const policy = textDetail(details.boundedPolicyDecision);
  if (!loopState && !policy) {
    return "not ready";
  }
  return [loopState, policy].filter(Boolean).join(" · ");
}

function verificationStatus(details: Record<string, string | number | boolean | string[]>): string {
  const result = textDetail(details.verificationStatus);
  const progress = textDetail(details.verificationProgress);
  const exitCode = numberDetail(details.verificationExitCode);
  const output = textDetail(details.verificationOutputTail);
  if (result) {
    return `${result}${exitCode !== undefined ? ` · exit ${exitCode}` : ""}${output ? " · sanitized result available" : ""}`;
  }
  if (progress) {
    return progress;
  }
  return details.verificationRequested === true ? "requested" : "not requested";
}
