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
    "Manual: no autonomy, no auto-clicks, no hidden model/provider calls.",
    "Apply and verification use existing IDE bridge messages only after your explicit click.",
    "Verification sends an allowlisted command id only; raw command, args, cwd, env, private paths, patch text, and file bodies are not shown here.",
    "Browser preview is inert. Open the IDE webview to request apply or verification.",
  ];

  return (
    <section className={`readiness-card ${view.enabled ? "ready" : "warn"} agent-run-panel stack`} aria-label="Experimental Agent Run" data-testid="agent-run-panel">
      <div className="row">
        <strong>Experimental Agent Run · one-step manual shell</strong>
        <span className={`badge ${supported ? "ok" : "warn"}`}>{supported ? `${host} explicit controls` : "browser preview only"}</span>
        <span className="badge">manual only</span>
        <span className={`badge ${view.stopped ? "warn" : view.enabled ? "ok" : ""}`}>{agentRunStateLabel(view.state, details)}</span>
      </div>
      <span>{sanitizeDisplayText(view.summary)}</span>
      <strong>{readinessExplanation(view.state, details)}</strong>
      <div className="agent-progress-grid" aria-label="Agent Run status fields">
        <span>Manual state: {agentRunStateLabel(view.state, details)}</span>
        <span>Goal summary: {textDetail(details.goalTitle) || textDetail(details.goalSummary) || "No local goal selected"}</span>
        <span>Proposal status: {proposalStatus(view.state, details)}</span>
        <span>Checkpoint status: {checkpointStatusLabel}</span>
        <span>Policy decision: {policyDecisionLabel}</span>
        <span>Checkpoint/policy readiness: {checkpointPolicyStatus(checkpointStatusLabel, policyDecisionLabel)}</span>
        <span>Touched files: {touchedFileCount}</span>
        <span>Edit count: {editCount ?? 0}</span>
        <span>Apply status: {applyStatusLabel(details)}</span>
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
        <button type="button" onClick={onApplyReviewedPatch} disabled={!canApply}>Manually apply reviewed patch</button>
        <button type="button" onClick={() => verificationCommandId && onRunAllowlistedVerification(verificationCommandId)} disabled={!canVerify}>Manually run allowlisted verification</button>
        <button type="button" className="secondary-button" onClick={onReviewRollback} disabled={!canReviewRollback}>Manually review rollback</button>
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

function agentRunStateLabel(state: string, details: Record<string, string | number | boolean | string[]>): string {
  if (state === "goal_ready") {
    return "Goal ready";
  }
  if (state === "proposal_detected") {
    return "Proposal detected";
  }
  if (state === "prerequisites_blocked" || state === "blocked") {
    return "Checkpoint required";
  }
  if (state === "ready_for_apply") {
    return "Ready for manual apply";
  }
  if (state === "apply_requested") {
    return "Apply pending";
  }
  if (state === "ready_for_verification") {
    return "Ready for manual verification";
  }
  if (state === "verification_requested" || state === "verification_running") {
    return "Verification running";
  }
  if (state === "verified") {
    return "Verified";
  }
  if (state === "verification_failed") {
    return "Verification failed";
  }
  return sanitizeDisplayText(state);
}

function applyStatusLabel(details: Record<string, string | number | boolean | string[]>): string {
  const result = textDetail(details.applyStatus);
  if (result) {
    return result === "applied" ? "applied after manual request" : result;
  }
  return details.applyRequested === true ? "manual apply pending" : "not requested";
}

function readinessExplanation(state: string, details: Record<string, string | number | boolean | string[]>): string {
  if (state === "goal_ready") {
    return "Goal ready. Draft or send a model proposal request manually; no apply or verification action is available yet.";
  }
  if (hasProposal(details) && (state === "proposal_detected" || state === "prerequisites_blocked") && !hasCheckpointEvidence(details)) {
    return "Proposal detected, but checkpoint readiness metadata is missing. Recovery: refresh runtime/checkpoint readiness, then review again before any manual apply.";
  }
  if (state === "prerequisites_blocked" || state === "blocked") {
    return "Checkpoint required. Recovery: resolve checkpoint or policy readiness first; manual apply stays disabled until runtime metadata is ready.";
  }
  if (state === "ready_for_apply") {
    return "Ready for manual apply. Review the proposal and click Manually apply reviewed patch only when you choose to continue.";
  }
  if (state === "apply_requested") {
    return "Apply pending. Wait for the host apply result; duplicate manual apply requests stay disabled.";
  }
  if (state === "ready_for_verification") {
    return "Ready for manual verification. Click Manually run allowlisted verification when you choose to run the selected command id.";
  }
  if (state === "verification_requested" || state === "verification_running") {
    return "Verification running. Wait for the allowlisted command result; no repair, retry, or rollback starts automatically.";
  }
  if (state === "verified") {
    return "Verified. The manual apply and verification path completed; review the sanitized result before any follow-up.";
  }
  if (state === "verification_failed") {
    return "Verification failed. Recovery: review the sanitized result, then manually draft a follow-up or review rollback; no automatic repair is started.";
  }
  if (state === "rollback_available") {
    return "Rollback review is available. Recovery remains manual through existing checkpoint surfaces; no rollback request was posted.";
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
  if (result === "succeeded") {
    return `Verified${exitCode !== undefined ? ` · exit ${exitCode}` : ""}${output ? " · sanitized result available" : ""}`;
  }
  if (result === "failed") {
    return `Verification failed${exitCode !== undefined ? ` · exit ${exitCode}` : ""}${output ? " · sanitized result available" : ""}`;
  }
  if (result) {
    return `${result}${exitCode !== undefined ? ` · exit ${exitCode}` : ""}${output ? " · sanitized result available" : ""}`;
  }
  if (progress === "running" || progress === "queued") {
    return "Verification running";
  }
  return details.verificationRequested === true ? "Verification running" : "not requested";
}
