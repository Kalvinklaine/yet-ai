import type { ApplyWorkspaceEditPayload, BridgeHost, VerificationCommandId } from "../bridge/bridgeAdapter";
import { buildAgentRunApplyRiskSummary } from "../services/agentRunApplyRisk";
import { buildAgentRunCheckpointDecision, type AgentRunCheckpointDecisionSummary } from "../services/agentRunCheckpointDecision";
import { evaluateAgentRunState, type AgentRunInput } from "../services/agentRunState";
import { deriveGuidedFixLoopStatus, type GuidedFixLoopDraftState } from "../services/guidedFixLoop";
import type { ProposalHistory } from "../services/proposalHistory";
import { sanitizeDisplayText } from "../services/redaction";

export type AgentRunPanelProps = {
  input: unknown;
  host: BridgeHost;
  pendingApply: boolean;
  pendingVerification: boolean;
  onApplyReviewedPatch: () => void;
  onRunAllowlistedVerification: (commandId: VerificationCommandId) => void;
  onReviewRollback: () => void;
  onDraftVerificationFollowup: () => void;
  onDraftVerificationFix: () => void;
  proposalHistory?: ProposalHistory;
  verificationFixDraft?: GuidedFixLoopDraftState;
};

export function AgentRunPanel({ input, host, pendingApply, pendingVerification, onApplyReviewedPatch, onRunAllowlistedVerification, onReviewRollback, onDraftVerificationFollowup, onDraftVerificationFix, proposalHistory, verificationFixDraft }: AgentRunPanelProps) {
  const view = evaluateAgentRunState(input);
  const metadata = isAgentRunInput(input) ? input : undefined;
  const guidedFix = deriveGuidedFixLoopStatus({
    verificationResult: metadata?.verificationResult,
    priorProposal: metadata?.proposal,
    proposalHistory,
    draft: verificationFixDraft,
    lineage: {
      verificationRequestId: metadata?.verificationRequest?.requestId,
      priorProposalId: metadata?.proposal?.id,
      followupDraftId: verificationFixDraft?.metadata?.draftId,
    },
  });
  const details = view.details;
  const supported = host === "vscode" || host === "jetbrains";
  const verificationSupported = host === "vscode";
  const applyRiskSummary = buildAgentRunApplyRiskSummary({
    proposal: metadata?.proposal ? agentRunProposalToApplyRiskPayload(metadata.proposal, details) : undefined,
    agentRun: input,
    host,
    pendingApply,
    applyResult: metadata?.applyResult,
  });
  const checkpointDecision = buildAgentRunCheckpointDecision({ agentRun: input, host });
  const showCheckpointDecision = metadata && checkpointDecision.status !== "unavailable";
  const showApplyRiskSummary = Boolean(metadata && !metadata.applyResult && (!pendingApply || metadata.applyRequest?.requested === true) && (hasProposal(details) || view.nextUserAction === "confirm_apply" || view.nextUserAction === "wait_for_apply" || view.state === "prerequisites_blocked" || view.state === "blocked"));
  const verificationCommandId = verificationCommandIdFromDetails(details.verificationCommandId);
  const canApply = supported && !pendingApply && view.nextUserAction === "confirm_apply";
  const canVerify = verificationSupported && !pendingVerification && view.nextUserAction === "confirm_verification" && verificationCommandId !== null;
  const showS85VerificationRequired = supported && !verificationSupported && view.nextUserAction === "confirm_verification" && verificationCommandId !== null;
  const canReviewRollback = view.rollbackAvailable || view.nextUserAction === "review_rollback";
  const canDraftFollowup = view.state === "verified";
  const canDraftFix = view.state === "verification_failed" && guidedFix.status === "fix_draft_available";
  const touchedFileCount = numberDetail(details.touchedFileCount) ?? stringArrayDetail(details.touchedFiles).length;
  const editCount = numberDetail(details.editCount);
  const checkpointStatusLabel = checkpointStatus(details);
  const policyDecisionLabel = policyDecision(details);
  const nextStepCopy = nextManualStep(view.state, details, supported);
  const proposalPlanSteps = stringArrayDetail(details.proposalPlanSteps);
  const proposalRisks = stringArrayDetail(details.proposalRisks);
  const proposalVerificationSuggestions = stringArrayDetail(details.proposalVerificationSuggestions);
  const planPreviewSteps = stringArrayDetail(details.planPreviewSteps);
  const planPreviewRisks = stringArrayDetail(details.planPreviewRisks);
  const planPreviewExpectedTouchedFiles = stringArrayDetail(details.planPreviewExpectedTouchedFiles);
  const planPreviewVerificationSuggestions = stringArrayDetail(details.planPreviewVerificationSuggestions);
  const planDiagnostics = stringArrayDetail(details.planDiagnostics);
  const showPlanPreview = Boolean(textDetail(details.planPreviewTitle) || textDetail(details.planPreviewSummary) || planPreviewSteps.length > 0 || planPreviewRisks.length > 0 || planPreviewExpectedTouchedFiles.length > 0 || planPreviewVerificationSuggestions.length > 0);
  const showProposalReviewMetadata = Boolean(textDetail(details.proposalPlanSummary) || proposalPlanSteps.length > 0 || proposalRisks.length > 0 || proposalVerificationSuggestions.length > 0);
  const checkpointRollbackCopy = checkpointRollbackStatusCopy(details);

  return (
    <section className={`readiness-card ${view.enabled ? "ready" : "warn"} agent-run-panel stack`} aria-label="Experimental Agent Run" data-testid="agent-run-panel">
      <div className="row">
        <strong>Agent Run · dev-preview, not autonomy</strong>
        <span className={`badge ${supported ? "ok" : "warn"}`}>{supported ? `${host} explicit controls` : "browser preview only"}</span>
        <span className={`badge ${view.stopped ? "warn" : view.enabled ? "ok" : ""}`}>{agentRunStateLabel(view.state, details)}</span>
      </div>
      <span>{sanitizeDisplayText(view.summary)}</span>
      <strong>{readinessExplanation(view.state, details)}</strong>
      <div className={`readiness-card ${view.nextUserAction === "confirm_apply" || view.nextUserAction === "confirm_verification" || view.state === "verified" ? "ready" : "warn"}`} role="status" aria-label="Agent Run next manual step">
        <strong>Next manual step</strong>
        <span>{nextStepCopy}</span>
      </div>
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
        <span>Rollback availability: {view.rollbackAvailable ? "available for review" : rollbackAvailabilityLabel(details)}</span>
      </div>
      {checkpointRollbackCopy.visible && (
        <div className={`readiness-card ${checkpointRollbackCopy.tone}`} role="status" aria-label="Agent Run checkpoint rollback status">
          <strong>Checkpoint and rollback readiness</strong>
          <span>{checkpointRollbackCopy.summary}</span>
          <span>Checkpoint: {checkpointRollbackCopy.checkpoint}</span>
          <span>Rollback: {checkpointRollbackCopy.rollback}</span>
          <span>{checkpointRollbackCopy.recovery}</span>
          <span>{checkpointRollbackCopy.safety}</span>
        </div>
      )}
      {showCheckpointDecision && (
        <div className={`readiness-card ${checkpointDecisionTone(checkpointDecision)} stack`} role="status" aria-label="Agent Run manual checkpoint decision">
          <div className="row">
            <strong>Manual checkpoint decision</strong>
            <span className="badge">manual decisions only</span>
            <span className="badge">sanitized metadata</span>
            <span className={checkpointDecision.status === "blocked" ? "badge warn" : "badge ok"}>{sanitizeDisplayText(checkpointDecision.status.replace(/_/g, " "))}</span>
          </div>
          <span>{checkpointDecisionSummaryCopy(checkpointDecision)}</span>
          <span>No automatic rollback, continuation, apply, verification, repair, retry, chat send, context attach, file read, search, or separate run starts from this panel.</span>
          <span>Recommended manual decision: {checkpointDecisionLabel(checkpointDecision.recommendedDecision)}</span>
          <div className="agent-progress-grid" aria-label="Agent Run manual checkpoint decision options">
            {checkpointDecision.decisionCards.map((card) => <span key={card.kind}>{sanitizeDisplayText(card.label)}: {sanitizeDisplayText(card.state.replace(/_/g, " "))} · {sanitizeDisplayText(card.reason)}</span>)}
          </div>
          {checkpointDecision.details.reason && <span>Decision reason: {sanitizeDisplayText(String(checkpointDecision.details.reason))}</span>}
          {checkpointDecision.details.applyStatus && <span>Apply status: {sanitizeDisplayText(String(checkpointDecision.details.applyStatus))}</span>}
          {checkpointDecision.details.verificationStatus && <span>Verification status: {sanitizeDisplayText(String(checkpointDecision.details.verificationStatus))}</span>}
          {checkpointDecision.details.verificationExitCode !== undefined && <span>Verification exit code: {String(checkpointDecision.details.verificationExitCode)}</span>}
          {checkpointDecision.diagnostics.length > 0 && <span className="subtle">Decision diagnostics: {checkpointDecision.diagnostics.map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span>}
          <span className="subtle">Continue means keep working in the current checkpoint by explicit user choice only. Review rollback opens the existing review-only path when available. Start separate manual run is guidance only and creates nothing.</span>
        </div>
      )}
      {view.diagnostics.length > 0 && (
        <div className="readiness-card warn" role="status" aria-label="Agent Run diagnostics">
          <strong>Safety diagnostics</strong>
          {view.diagnostics.map((item) => <span key={`${item.code}:${item.message}`}>{sanitizeDisplayText(item.code)}: {sanitizeDisplayText(item.message)}</span>)}
        </div>
      )}
      {planDiagnostics.length > 0 && (
        <div className="readiness-card warn" role="status" aria-label="Agent Run rejected plan preview">
          <strong>Rejected multi-step plan preview</strong>
          <span>Unsafe or malformed plan preview metadata was rejected. No apply, verification, read, send, or readiness state was created.</span>
          {planDiagnostics.map((item) => <span key={item}>{sanitizeDisplayText(item)}</span>)}
        </div>
      )}
      {showPlanPreview && (
        <div className="readiness-card warn" role="status" aria-label="Agent Run inert multi-step plan preview">
          <div className="row">
            <strong>Multi-step plan preview · Review only</strong>
            <span className="badge warn">inert</span>
            <span className="badge">metadata only</span>
          </div>
          <span>This plan preview cannot send chat, apply edits, run verification, read files, call providers, or mutate the workspace. Future send, apply, and verification remain explicit user actions.</span>
          {textDetail(details.planPreviewTitle) && <span>Title: {textDetail(details.planPreviewTitle)}</span>}
          {textDetail(details.planPreviewSummary) && <span>Summary: {textDetail(details.planPreviewSummary)}</span>}
          {planPreviewSteps.length > 0 && <span>Steps: {planPreviewSteps.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {planPreviewRisks.length > 0 && <span>Risks: {planPreviewRisks.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {planPreviewExpectedTouchedFiles.length > 0 && <span>Expected file labels: {planPreviewExpectedTouchedFiles.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {planPreviewVerificationSuggestions.length > 0 && <span>Verification suggestions (display-only command IDs): {planPreviewVerificationSuggestions.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
        </div>
      )}
      {showProposalReviewMetadata && (
        <div className="readiness-card" role="status" aria-label="Agent Run proposal review metadata">
          <strong>Proposal review metadata</strong>
          {textDetail(details.proposalPlanSummary) && <span>Plan summary: {textDetail(details.proposalPlanSummary)}</span>}
          {proposalPlanSteps.length > 0 && <span>Plan: {proposalPlanSteps.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {proposalRisks.length > 0 && <span>Risks: {proposalRisks.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {proposalVerificationSuggestions.length > 0 && <span>Verification suggestions (display-only command IDs): {proposalVerificationSuggestions.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
        </div>
      )}
      {showApplyRiskSummary && (
        <div className={`readiness-card ${applyRiskSummary.status === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Agent Run apply readiness and risk">
          <div className="row">
            <strong>Apply readiness and risk</strong>
            <span className={`badge ${applyRiskSummary.status === "ready" ? "ok" : "warn"}`}>{applyRiskSummary.status.replace(/_/g, " ")}</span>
            <span className="badge">manual apply only</span>
            <span className="badge">sanitized metadata</span>
          </div>
          <span>Display only: no workspace change happens until an explicit supported-IDE apply click.</span>
          <div className="agent-progress-grid" aria-label="Agent Run apply readiness items">
            {applyRiskSummary.readinessItems.map((item) => <span key={item.label}>{sanitizeDisplayText(item.label)}: {sanitizeDisplayText(item.state.replace(/_/g, " "))}</span>)}
          </div>
          <div className="agent-progress-grid" aria-label="Agent Run apply risk counts">
            <span>Files: {applyRiskSummary.fileCount}</span>
            <span>Edits: {applyRiskSummary.editCount}</span>
          </div>
          {applyRiskSummary.fileLabels.length > 0 && <span>File labels: {applyRiskSummary.fileLabels.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {applyRiskSummary.riskBadges.length > 0 && <span>Risk badges: {applyRiskSummary.riskBadges.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {applyRiskSummary.disabledReasons.length > 0 && <span>Apply disabled reasons: {applyRiskSummary.disabledReasons.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {applyRiskSummary.recoveryGuidance.length > 0 && <span>Manual recovery guidance: {applyRiskSummary.recoveryGuidance.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
        </div>
      )}
      {guidedFix.status !== "idle" && (
        <div className={`readiness-card ${guidedFix.status === "fix_draft_available" || guidedFix.status === "no_fix_needed" || guidedFix.status === "new_proposal_detected" ? "ready" : "warn"} stack`} role="status" aria-label="Agent Run manual guided fix">
          <div className="row">
            <strong>Manual guided fix</strong>
            <span className="badge">draft only</span>
            <span className="badge">metadata only</span>
            <span className={guidedFix.status === "blocked" ? "badge warn" : "badge ok"}>{sanitizeDisplayText(guidedFix.status.replace(/_/g, " "))}</span>
          </div>
          {canDraftFix && <strong>Manual fix draft available</strong>}
          <span>{sanitizeDisplayText(guidedFix.reason)}</span>
          <span>{sanitizeDisplayText(guidedFix.cta)}</span>
          <span className="subtle">Draft only: this panel never sends chat, applies edits, runs verification, retries, repairs, rolls back, attaches context, saves memory, or changes the workspace. Review first; the user must click Send manually.</span>
          {guidedFix.labels.length > 0 && <span>Lineage/status labels: {guidedFix.labels.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {guidedFix.diagnostics.length > 0 && <span className="subtle">Blocked metadata labels: {guidedFix.diagnostics.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          {canDraftFix && <div className="row" role="group" aria-label="Agent Run manual guided fix actions"><button type="button" className="secondary-button" onClick={onDraftVerificationFix}>Draft Agent Run fix prompt</button></div>}
        </div>
      )}
      {canDraftFollowup && (
        <div className="readiness-card ready stack" role="status" aria-label="Agent Run verification follow-up draft">
          <strong>Manual follow-up draft available</strong>
          <span>Verification succeeded after your explicit run. Draft a sanitized follow-up prompt into the composer, review it, then click Send manually if you choose.</span>
          <div className="row" role="group" aria-label="Agent Run verification follow-up actions">
            <button type="button" className="secondary-button" onClick={onDraftVerificationFollowup}>Draft Agent Run follow-up prompt</button>
          </div>
          <span className="subtle">Drafting only writes the composer and focuses it. It never sends, applies, runs verification, attaches context, saves memory, changes readiness, or stores browser data.</span>
        </div>
      )}
      <span className="subtle">no hidden model/provider calls; manual</span>
      {showS85VerificationRequired && (
        <div className="readiness-card warn" role="status" aria-label="Agent Run S85 verification required">
          <strong>S85 controlled verification unsupported here</strong>
          <span>Controlled Agent Run verification is VS Code-only in S85. This host stays fail-closed and posts no verification bridge request.</span>
        </div>
      )}
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

function checkpointDecisionTone(decision: AgentRunCheckpointDecisionSummary): "ready" | "warn" {
  return decision.status === "continue_available" ? "ready" : "warn";
}

function checkpointDecisionSummaryCopy(decision: AgentRunCheckpointDecisionSummary): string {
  if (decision.recommendedDecision === "continue_current_checkpoint") {
    return "Continue in the current checkpoint is available as manual guidance after successful apply and verification metadata.";
  }
  if (decision.recommendedDecision === "review_rollback") {
    return "Rollback review is available as a manual review-only decision; this card has no rollback execution payload.";
  }
  if (decision.recommendedDecision === "start_separate_manual_run") {
    return "Verification failed; start a separate manual run only if the user chooses to draft follow-up work.";
  }
  if (decision.recommendedDecision === "stop") {
    return "Stop is the safe manual decision for this checkpoint; no automatic recovery action is started.";
  }
  return "Checkpoint decision metadata is display-only and unavailable for action.";
}

function checkpointDecisionLabel(decision: AgentRunCheckpointDecisionSummary["recommendedDecision"]): string {
  if (decision === "continue_current_checkpoint") {
    return "continue in current checkpoint";
  }
  if (decision === "review_rollback") {
    return "review rollback";
  }
  if (decision === "start_separate_manual_run") {
    return "start separate manual run";
  }
  if (decision === "stop") {
    return "stop";
  }
  return "none";
}

function isAgentRunInput(value: unknown): value is AgentRunInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function agentRunProposalToApplyRiskPayload(proposal: AgentRunInput["proposal"], details: Record<string, string | number | boolean | string[]>): ApplyWorkspaceEditPayload | undefined {
  const touchedFiles = stringArrayDetail(details.touchedFiles);
  if (!proposal || touchedFiles.length === 0) {
    return undefined;
  }
  const editCount = Math.max(1, numberDetail(details.editCount) ?? touchedFiles.length);
  let remainingEdits = editCount;
  return {
    requiresUserConfirmation: true,
    cloudRequired: false,
    summary: textDetail(proposal.summary) || "Agent Run proposal metadata.",
    edits: touchedFiles.map((workspaceRelativePath) => {
      const editsForFile = Math.max(1, Math.ceil(remainingEdits / Math.max(1, touchedFiles.length)));
      remainingEdits = Math.max(0, remainingEdits - editsForFile);
      return {
        workspaceRelativePath,
        textReplacements: Array.from({ length: editsForFile }, (_, index) => ({
          range: { start: { line: index, character: 0 }, end: { line: index, character: 0 } },
          replacementText: "metadata-only replacement label",
        })),
      };
    }),
  };
}

function verificationCommandIdFromDetails(value: unknown): VerificationCommandId | null {
  return value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests" ? value : null;
}

function agentRunStateLabel(state: string, details: Record<string, string | number | boolean | string[]>): string {
  if (textDetail(details.applyStatus) === "failed") {
    return "Apply failed";
  }
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
    return "Ready for controlled verification";
  }
  if (state === "verification_requested" || state === "verification_running") {
    return "Verification running";
  }
  if (state === "verified") {
    return "Ready for follow-up";
  }
  if (state === "verification_failed") {
    return "Verification failed";
  }
  if (state === "rollback_available") {
    return "Rollback review available";
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
  if (textDetail(details.applyStatus) === "failed") {
    return "Apply failed after an explicit request. Recovery: review the sanitized apply result and rollback option; no retry, repair, or rollback is started automatically.";
  }
  if (state === "goal_ready") {
    return "Goal ready, but no safe proposal is available yet. Recovery: add explicit context if needed, confirm provider readiness in Chat readiness, then send or draft a model proposal manually.";
  }
  if (hasProposal(details) && (state === "proposal_detected" || state === "prerequisites_blocked") && !hasCheckpointEvidence(details)) {
    return "Safe proposal detected, but checkpoint readiness metadata is missing. Recovery: refresh runtime/checkpoint readiness, then review again before any manual apply.";
  }
  if (state === "prerequisites_blocked" || state === "blocked") {
    return hasProposal(details) ? "Checkpoint or policy is not ready. Recovery: resolve checkpoint/policy readiness first; manual apply stays disabled until runtime metadata is ready." : "No safe proposal is available yet. Recovery: add explicit context if needed and request a bounded safe-edit proposal manually.";
  }
  if (state === "ready_for_apply") {
    return "Ready for manual apply. Review the proposal and click Manually apply reviewed patch only when you choose to continue.";
  }
  if (state === "apply_requested") {
    return "Apply pending. Wait for the host apply result; duplicate manual apply requests stay disabled.";
  }
  if (state === "ready_for_verification") {
    return "Ready for explicit S85 allowlisted controlled verification in VS Code. Browser and JetBrains stay fail-closed for this Agent Run verification path.";
  }
  if (state === "verification_requested" || state === "verification_running") {
    return "Verification running. Wait for the allowlisted command result; no repair, retry, or rollback starts automatically.";
  }
  if (state === "verified") {
    return "Ready for follow-up. The manual apply and verification path completed; review the sanitized result before drafting any follow-up.";
  }
  if (state === "verification_failed") {
    return "Verification failed. Recovery: review the sanitized result, then manually draft a follow-up or review rollback; no automatic repair is started.";
  }
  if (state === "rollback_available") {
    return "Rollback review is available. Recovery remains manual through existing checkpoint surfaces; no rollback request was posted.";
  }
  return "Manual Agent Run status is display-only until an explicit user action is available.";
}

function nextManualStep(state: string, details: Record<string, string | number | boolean | string[]>, supported: boolean): string {
  if (textDetail(details.applyStatus) === "failed") {
    return "Review the sanitized apply failure, then manually review rollback or revise the proposal in chat; no automatic retry is available.";
  }
  if (!hasProposal(details)) {
    return "Attach context if needed, confirm provider readiness, then manually draft/send a safe-edit proposal request.";
  }
  if ((state === "proposal_detected" || state === "prerequisites_blocked" || state === "blocked") && !hasCheckpointEvidence(details)) {
    return "Checkpoint metadata is not ready. Refresh runtime/checkpoint readiness; apply remains disabled until verified metadata arrives.";
  }
  if (!supported) {
    return "Open the IDE webview for apply or verification controls. Browser preview stays inert and posts no privileged action.";
  }
  if (!details.goalTitle && !details.goalSummary) {
    return "Write a task goal in Coding task session before asking for a proposal. If Send is disabled, use Chat readiness to fix provider readiness first.";
  }
  if (state === "prerequisites_blocked" || state === "blocked") {
    return "Checkpoint or policy blocked this proposal. Fix readiness metadata or request a new safe proposal; no workspace change was posted.";
  }
  if (state === "ready_for_apply") {
    return "Review the sanitized proposal summary; apply only if you choose to continue.";
  }
  if (state === "apply_requested") {
    return "Wait for the host apply result. Duplicate apply requests are disabled while this explicit request is pending.";
  }
  if (state === "ready_for_verification") {
    return "Click Manually run allowlisted verification in VS Code to send the S85 controlled command-run request; no legacy IDE verification request is posted from Agent Run.";
  }
  if (state === "verification_requested" || state === "verification_running") {
    return "Wait for verification to finish, then review the sanitized result before any follow-up.";
  }
  if (state === "verification_failed") {
    return "Review the sanitized verification failure, then manually draft a fix follow-up or review rollback. Nothing repairs itself, how polite.";
  }
  if (state === "verified") {
    return "Review the sanitized verification result, then manually draft a follow-up or close the run.";
  }
  if (state === "rollback_available") {
    return "Review rollback through existing checkpoint surfaces if needed; no rollback request was posted from this panel.";
  }
  return "Use the visible chat, context, provider, and proposal controls manually; this panel is status-only until a safe next click appears.";
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

function rollbackAvailabilityLabel(details: Record<string, string | number | boolean | string[]>): string {
  const status = textDetail(details.checkpointRollbackStatus);
  if (status === "blocked") {
    return "blocked pending host review";
  }
  if (status === "completed") {
    return "completed after user request";
  }
  if (status === "failed") {
    return "failed after user request";
  }
  if (status === "unavailable") {
    return "not available";
  }
  return "not available";
}

type CheckpointRollbackCopy = {
  visible: boolean;
  tone: "ready" | "warn";
  summary: string;
  checkpoint: string;
  rollback: string;
  recovery: string;
  safety: string;
};

function checkpointRollbackStatusCopy(details: Record<string, string | number | boolean | string[]>): CheckpointRollbackCopy {
  const displayState = textDetail(details.checkpointRollbackDisplayState);
  const summary = textDetail(details.checkpointRollbackSummary);
  const checkpointStatusValue = textDetail(details.checkpointRollbackCheckpointStatus);
  const checkpointLabel = textDetail(details.checkpointRollbackCheckpointLabel);
  const rollbackStatusValue = textDetail(details.checkpointRollbackStatus);
  const rollbackLabel = textDetail(details.checkpointRollbackLabel);
  const automatic = details.checkpointRollbackActionAutomatic === true;
  const checkpoint = checkpointLabel || checkpointStatusLabel(checkpointStatusValue) || checkpointStatus(details);
  const rollback = rollbackLabel || rollbackStatusLabel(rollbackStatusValue, details);
  const safety = automatic ? "Unsafe rollback automation metadata was blocked; no rollback starts from this panel." : "No automatic rollback or workspace mutation starts from this panel.";

  if (displayState === "rollback_failed" || rollbackStatusValue === "failed") {
    return {
      visible: true,
      tone: "warn",
      summary: summary || "Rollback failed with sanitized status metadata.",
      checkpoint,
      rollback,
      recovery: "Recovery: review host guidance and existing checkpoint surfaces, then decide the next manual step; nothing retries or repairs itself.",
      safety,
    };
  }
  if (displayState === "rollback_completed" || rollbackStatusValue === "completed") {
    return {
      visible: true,
      tone: "ready",
      summary: summary || "Rollback completion is recorded for review.",
      checkpoint,
      rollback,
      recovery: "Recovery: review the sanitized completion status before drafting follow-up work.",
      safety,
    };
  }
  if (displayState === "rollback_blocked" || rollbackStatusValue === "blocked") {
    return {
      visible: true,
      tone: "warn",
      summary: summary || "Rollback is blocked and shown as status only.",
      checkpoint,
      rollback,
      recovery: "Recovery: resolve host checkpoint guidance first; the rollback button stays review-only and does not mutate the workspace.",
      safety,
    };
  }
  if (displayState === "rollback_available" || rollbackStatusValue === "available" || details.rollbackAvailable === true) {
    return {
      visible: true,
      tone: "ready",
      summary: summary || textDetail(details.rollbackSummary) || "Rollback review is available through existing checkpoint surfaces.",
      checkpoint,
      rollback,
      recovery: "Recovery: use the existing manual rollback review path only if you choose; this panel posts no rollback request by itself.",
      safety,
    };
  }
  if (displayState === "checkpoint_created") {
    return {
      visible: true,
      tone: "ready",
      summary: summary || "Checkpoint was created and is ready for manual review.",
      checkpoint,
      rollback,
      recovery: "Recovery: continue with manual apply or verification only after reviewing checkpoint readiness.",
      safety,
    };
  }
  if (displayState === "checkpoint_readiness" || checkpointStatusValue) {
    return {
      visible: true,
      tone: checkpointStatusValue === "ready" || checkpointStatusValue === "verified" ? "ready" : "warn",
      summary: summary || "Checkpoint readiness is displayed before any manual workspace action.",
      checkpoint,
      rollback,
      recovery: checkpointStatusValue === "ready" || checkpointStatusValue === "verified" ? "Recovery: checkpoint prerequisites look ready; continue only through explicit manual controls." : "Recovery: refresh or resolve checkpoint readiness before applying changes.",
      safety,
    };
  }
  return {
    visible: false,
    tone: "warn",
    summary: "Checkpoint and rollback metadata has not been reported yet.",
    checkpoint,
    rollback,
    recovery: "Recovery: refresh runtime/checkpoint readiness before applying changes; rollback remains unavailable until host metadata says otherwise.",
    safety,
  };
}

function checkpointStatusLabel(status: string): string {
  if (status === "ready") {
    return "ready";
  }
  if (status === "verified") {
    return "verified";
  }
  if (status === "created") {
    return "created";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "not_ready") {
    return "not ready";
  }
  if (status === "unavailable") {
    return "unavailable";
  }
  return "missing";
}

function rollbackStatusLabel(status: string, details: Record<string, string | number | boolean | string[]>): string {
  if (status === "available") {
    return "available for manual review";
  }
  if (status === "blocked") {
    return "blocked pending host review";
  }
  if (status === "completed") {
    return "completed after user request";
  }
  if (status === "failed") {
    return "failed after user request";
  }
  if (status === "unavailable") {
    return "unavailable";
  }
  return details.rollbackAvailable === true ? "available for manual review" : "not available";
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
