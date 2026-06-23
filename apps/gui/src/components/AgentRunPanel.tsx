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
  const checkpointStatusLabel = checkpointStatus(details);
  const policyDecisionLabel = policyDecision(details);
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
      <strong>{readinessExplanation(view.state, details)}</strong>
      <div className="agent-progress-grid" aria-label="Agent Run status fields">
        <span>Run status: {sanitizeDisplayText(view.state)}</span>
        <span>Goal summary: {textDetail(details.goalTitle) || textDetail(details.goalSummary) || "No local goal selected"}</span>
        <span>Proposal status: {proposalStatus(view.state, details)}</span>
        <span>Checkpoint status: {checkpointStatusLabel}</span>
        <span>Policy decision: {policyDecisionLabel}</span>
        <span>Checkpoint/policy readiness: {checkpointPolicyStatus(checkpointStatusLabel, policyDecisionLabel)}</span>
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

function readinessExplanation(state: string, details: Record<string, string | number | boolean | string[]>): string {
  if (state === "goal_ready") {
    return "Goal is ready. Draft or send a model proposal request before Apply can unlock.";
  }
  if (hasProposal(details) && (state === "proposal_detected" || state === "prerequisites_blocked") && !hasCheckpointEvidence(details)) {
    return "Proposal detected, but checkpoint readiness metadata is missing. Apply stays disabled.";
  }
  if (state === "prerequisites_blocked" || state === "blocked") {
    return "Checkpoint or policy prerequisites are blocked. Apply stays disabled until runtime metadata is ready.";
  }
  if (state === "ready_for_apply") {
    return "Verified checkpoint and policy metadata are ready. Apply is still manual and waits for your click.";
  }
  if (state === "ready_for_verification") {
    return "Patch apply metadata is recorded. Verification is manual and uses the allowlisted command id only.";
  }
  return "Manual Agent Run status is display-only until an explicit user action is available.";
}

function proposalStatus(state: string, details: Record<string, string | number | boolean | string[]>): string {
  if (!hasProposal(details)) {
    return "not detected";
  }
  if (state === "ready_for_apply" || state === "apply_requested") {
    return "detected with verified checkpoint metadata";
  }
  if (state === "proposal_detected" || state === "prerequisites_blocked" || state === "blocked") {
    return hasCheckpointEvidence(details) ? "detected but checkpoint or policy is blocked" : "detected but checkpoint metadata is missing";
  }
  return "detected";
}

function checkpointStatus(details: Record<string, string | number | boolean | string[]>): string {
  const mode = textDetail(details.sandboxModeStatus) || textDetail(details.sandboxState) || textDetail(details.boundedLoopState);
  const policy = policyDecision(details);
  if (details.checkpointVerified === true || policy === "ready_for_user_apply" || policy === "ready_for_user_verification") {
    return mode ? "verified · " + mode : "verified";
  }
  if (details.checkpointVerified === false || policy === "blocked") {
    return mode ? "not verified · " + mode : "not verified";
  }
  return mode || "missing";
}

function policyDecision(details: Record<string, string | number | boolean | string[]>): string {
  return textDetail(details.boundedPolicyDecision) || textDetail(details.policyDecision) || "missing";
}

function checkpointPolicyStatus(checkpoint: string, policy: string): string {
  if (checkpoint === "missing" && policy === "missing") {
    return "missing";
  }
  return checkpoint + " · " + policy;
}

function hasProposal(details: Record<string, string | number | boolean | string[]>): boolean {
  return Boolean(details.proposalId || details.proposalSummary);
}

function hasCheckpointEvidence(details: Record<string, string | number | boolean | string[]>): boolean {
  return details.checkpointVerified !== undefined || Boolean(details.sandboxModeStatus || details.sandboxState || details.boundedLoopState || details.boundedPolicyDecision || details.policyDecision);
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
