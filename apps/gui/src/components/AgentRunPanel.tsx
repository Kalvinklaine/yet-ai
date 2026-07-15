import { useState } from "react";
import type { ApplyWorkspaceEditPayload, BridgeHost, VerificationCommandId } from "../bridge/bridgeAdapter";
import { buildAgentRunApplyRiskSummary } from "../services/agentRunApplyRisk";
import { buildAgentRunCheckpointDecision, type AgentRunCheckpointDecisionSummary } from "../services/agentRunCheckpointDecision";
import { evaluateAgentRunState, type AgentRunInput } from "../services/agentRunState";
import type { ControlledAgentCommandRunRequestResult } from "../services/controlledAgentCommandRunRequest";
import { createControlledAgentDevPreviewReport } from "../services/controlledAgentDevPreviewReport";
import { evaluateControlledAgentDevPreviewStatus } from "../services/controlledAgentDevPreviewStatus";
import type { ControlledAgentEditRequestResult } from "../services/controlledAgentEditRequest";
import type { ControlledAgentFileReadRequestResult } from "../services/controlledAgentFileReadRequest";
import type { ControlledOneStepAgentLoopState } from "../services/controlledOneStepAgentLoop";
import type { ControlledTaskExecutionState, ControlledTaskExecutionSummary } from "../services/controlledTaskExecution";
import type { ControlledAgentRepairLoopEvaluation } from "../services/controlledAgentRepairLoop";
import type { ControlledRunHistoryItem } from "../services/controlledRunHistory";
import type { ControlledRunContextBundle, ControlledRunContextReport } from "../services/controlledRunContext";
import type { ControlledAgentLexicalSearchSummary } from "../services/controlledAgentLexicalSearch";
import type { ControlledAgentMultifilePatchPlanResult } from "../services/controlledAgentMultifilePatchPlan";
import type { ControlledAgentMultifileApplyRequestResult, ControlledAgentMultifileApplySummary } from "../services/controlledAgentMultifileApplyRequest";
import type { ControlledAgentVerificationBundleEvaluation, ControlledAgentVerificationBundleRequestResult } from "../services/controlledAgentVerificationBundle";
import type { ControlledAgentVerificationFollowupDraft } from "../services/controlledAgentVerificationFollowup";
import type { ControlledAgentTwoStepRunState } from "../services/controlledAgentTwoStepRun";
import { controlledAgentSearchSelectionResultId, type ControlledAgentSearchSelectionResult } from "../services/controlledAgentSearchSelection";
import { evaluateControlledAgentRecoveryMatrix, type ControlledAgentRecoveryEvaluation, type ControlledAgentRecoveryVisibleState } from "../services/controlledAgentRecoveryMatrix";
import { deriveGuidedFixLoopStatus, type GuidedFixLoopDraftState } from "../services/guidedFixLoop";
import type { ProposalHistory } from "../services/proposalHistory";
import type { ControlledHostCapabilityMatrixDisplay } from "../services/toolAuthorityPolicy";
import { sanitizeDisplayText } from "../services/redaction";
import { buildControlledAgentTaskPresetGuidance, controlledAgentTaskPresets, type ControlledAgentTaskPresetGuidance, type ControlledAgentTaskPresetId } from "../services/controlledAgentTaskPresets";
import type { ControlledAgentTaskHarnessSummary } from "../services/controlledAgentTaskHarness";

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
  oneStepLoopState?: ControlledOneStepAgentLoopState;
  controlledTaskExecutionState?: ControlledTaskExecutionState;
  controlledTaskExecutionSummary?: ControlledTaskExecutionSummary;
  oneStepReadRequest?: ControlledAgentFileReadRequestResult;
  oneStepEditRequest?: ControlledAgentEditRequestResult;
  oneStepCommandRunRequest?: ControlledAgentCommandRunRequestResult;
  repairLoop?: ControlledAgentRepairLoopEvaluation;
  repairDraftReady?: boolean;
  pendingRepairEdit?: boolean;
  pendingRepairVerification?: boolean;
  onConfirmRepairAttempt?: () => void;
  onStartOneStepRun?: () => void;
  onStopOneStepRun?: () => void;
  controlledHostCapabilityMatrix?: ControlledHostCapabilityMatrixDisplay;
  controlledRunContextBundle?: ControlledRunContextBundle;
  controlledRunContextReport?: ControlledRunContextReport;
  includeControlledRunContext?: boolean;
  onIncludeControlledRunContextChange?: (include: boolean) => void;
  controlledRunHistory?: ControlledRunHistoryItem[];
  controlledLexicalSearch?: ControlledAgentLexicalSearchSummary;
  controlledMultifilePatchPlan?: ControlledAgentMultifilePatchPlanResult;
  controlledMultifileApplyRequest?: ControlledAgentMultifileApplyRequestResult;
  controlledMultifileApplyResult?: ControlledAgentMultifileApplySummary;
  controlledMultifileApplyNote?: string | null;
  pendingControlledMultifileApply?: boolean;
  controlledMultifileApplyConfirmed?: boolean;
  onConfirmControlledMultifileApply?: () => void;
  onRequestControlledMultifileApply?: () => void;
  onClearControlledMultifileApply?: () => void;
  controlledVerificationBundle?: ControlledAgentVerificationBundleEvaluation;
  controlledVerificationBundleRequest?: ControlledAgentVerificationBundleRequestResult;
  controlledVerificationBundleNote?: string | null;
  pendingControlledVerificationBundle?: boolean;
  controlledVerificationFollowupDraft?: ControlledAgentVerificationFollowupDraft;
  onRequestControlledVerificationBundle?: () => void;
  onDraftControlledVerificationFollowup?: () => void;
  onDraftControlledVerificationFix?: () => void;
  controlledSearchResultId?: string;
  selectedControlledSearchResultIds?: string[];
  controlledSearchSelection?: ControlledAgentSearchSelectionResult;
  controlledSearchRequestState?: "ready" | "blocked" | "unsupported";
  pendingControlledSearch?: boolean;
  onRequestControlledSearch?: () => void;
  onControlledSearchResultSelectionChange?: (resultId: string, selected: boolean) => void;
  controlledTwoStepRunState?: ControlledAgentTwoStepRunState;
  controlledTaskHarness?: ControlledAgentTaskHarnessSummary;
};

export function AgentRunPanel({ input, host, pendingApply, pendingVerification, onApplyReviewedPatch, onRunAllowlistedVerification, onReviewRollback, onDraftVerificationFollowup, onDraftVerificationFix, proposalHistory, verificationFixDraft, oneStepLoopState, controlledTaskExecutionState, controlledTaskExecutionSummary, oneStepReadRequest, oneStepEditRequest, oneStepCommandRunRequest, repairLoop, repairDraftReady = false, pendingRepairEdit = false, pendingRepairVerification = false, onConfirmRepairAttempt, onStartOneStepRun, onStopOneStepRun, controlledHostCapabilityMatrix, controlledRunContextBundle, controlledRunContextReport, includeControlledRunContext = true, onIncludeControlledRunContextChange, controlledRunHistory = [], controlledLexicalSearch, controlledMultifilePatchPlan, controlledMultifileApplyRequest, controlledMultifileApplyResult, controlledMultifileApplyNote, pendingControlledMultifileApply = false, controlledMultifileApplyConfirmed = false, onConfirmControlledMultifileApply, onRequestControlledMultifileApply, onClearControlledMultifileApply, controlledVerificationBundle, controlledVerificationBundleRequest, controlledVerificationBundleNote, pendingControlledVerificationBundle = false, controlledVerificationFollowupDraft, onRequestControlledVerificationBundle, onDraftControlledVerificationFollowup, onDraftControlledVerificationFix, controlledSearchResultId, selectedControlledSearchResultIds = [], controlledSearchSelection, controlledSearchRequestState, pendingControlledSearch = false, onRequestControlledSearch, onControlledSearchResultSelectionChange, controlledTwoStepRunState, controlledTaskHarness }: AgentRunPanelProps) {
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
  const showOneStepLoop = Boolean(oneStepLoopState);
  const oneStepReadReady = oneStepReadRequest?.state === "ready";
  const oneStepEditReady = oneStepEditRequest?.state === "ready";
  const oneStepCommandReady = oneStepCommandRunRequest?.state === "ready";
  const oneStepActive = Boolean(controlledTaskExecutionState && !["idle", "completed", "blocked", "stopped"].includes(controlledTaskExecutionState.phase));
  const canStartOneStep = host === "vscode" && Boolean(onStartOneStepRun) && !oneStepActive && oneStepReadReady && oneStepEditReady && oneStepCommandReady;
  const canStopOneStep = Boolean(onStopOneStepRun) && oneStepActive;
  const showRepairLoop = Boolean(repairLoop && repairLoop.state !== "disabled");
  const repairEligibleState = repairLoop?.state === "eligible" || repairLoop?.state === "proposal_ready";
  const repairActionPending = pendingRepairEdit || pendingRepairVerification;
  const canConfirmRepair = Boolean(onConfirmRepairAttempt) && repairEligibleState && repairLoop?.canAttemptRepair === true && repairDraftReady && !repairActionPending;
  const devPreviewStatus = evaluateControlledAgentDevPreviewStatus({
    host,
    workspaceReady: supported,
    runtimeReady: supported,
    oneStepReady: oneStepReadReady && oneStepEditReady,
    verificationReady: oneStepCommandReady,
    repairReady: Boolean(repairLoop && repairLoop.state !== "disabled"),
    stopped: oneStepLoopState?.phase === "stopped",
  });
  const devPreviewReport = showOneStepLoop || showRepairLoop ? createControlledAgentDevPreviewReport({
    host,
    status: oneStepLoopState ? controlledReportStatusFromOneStep(oneStepLoopState.phase) : repairLoop?.state === "eligible" || repairLoop?.state === "proposal_ready" ? "failed" : "blocked",
    capabilities: {
      explicit_start: host === "vscode" && Boolean(onStartOneStepRun),
      bounded_read: oneStepReadReady,
      bounded_edit: oneStepEditReady,
      allowlisted_verification: oneStepCommandReady,
      bounded_repair: Boolean(repairLoop && repairLoop.state !== "disabled"),
      sanitized_report: true,
    },
    counters: oneStepLoopState ? {
      loopSteps: oneStepLoopState.counters.loopSteps,
      fileReads: oneStepLoopState.counters.fileReads,
      filesTouched: oneStepLoopState.counters.filesTouched,
      verificationRuns: oneStepLoopState.counters.verificationRuns,
      repairAttempts: oneStepLoopState.counters.repairAttempts,
      userTurns: oneStepLoopState.counters.userTurns,
      runtimeSeconds: oneStepLoopState.counters.runtimeSeconds,
    } : repairLoop ? {
      verificationRuns: repairLoop.verificationRuns,
      repairAttempts: repairLoop.attemptCount,
      userTurns: repairLoop.userTurns,
    } : {},
    currentUserAction: oneStepLoopState?.phase === "stopped" ? "stop" : oneStepActive ? "wait" : oneStepLoopState?.phase === "completed" ? "review" : "start",
    limitations: host === "browser" ? ["browser_unsupported"] : host === "jetbrains" ? ["jetbrains_partial"] : [],
    evidence: [
      { kind: "status", status: oneStepLoopState?.phase ?? repairLoop?.state ?? "blocked", summary: oneStepLoopState?.summary ?? controlledReportEvidenceSummary(oneStepLoopState?.phase, repairLoop?.state) },
    ],
  }) : undefined;
  const controlledRunContextItems = controlledRunContextBundle?.items ?? [];
  const showControlledRunContextSelector = controlledRunContextBundle !== undefined || controlledRunContextReport !== undefined;
  const controlledRunContextSupported = host === "vscode";
  const controlledRunContextEnabled = controlledRunContextSupported && controlledRunContextItems.length > 0;
  const controlledSearchSnippets = controlledLexicalSearch?.snippets ?? [];
  const controlledSearchSelectedIds = new Set(selectedControlledSearchResultIds);
  const controlledSearchSafeItems = controlledSearchSnippets.map((snippet) => ({ id: controlledAgentSearchSelectionResultId(snippet), snippet }));
  const controlledSearchSafeIds = new Set(controlledSearchSafeItems.map((item) => item.id));
  const controlledSearchSelectedSafeCount = selectedControlledSearchResultIds.filter((id) => controlledSearchSafeIds.has(id)).length;
  const controlledSearchUnsafeOmittedCount = Math.max(0, (controlledLexicalSearch?.resultCount ?? 0) - controlledSearchSafeItems.length) + controlledSearchSelectionUnsafeCount(controlledSearchSelection);
  const showControlledSearchSelection = controlledLexicalSearch !== undefined || controlledSearchSelection !== undefined || controlledSearchRequestState !== undefined;
  const canRequestControlledSearch = host === "vscode" && controlledSearchRequestState === "ready" && !pendingControlledSearch && Boolean(onRequestControlledSearch);
  const showControlledMultifileApply = controlledMultifilePatchPlan !== undefined || controlledMultifileApplyResult !== undefined;
  const canConfirmControlledMultifileApply = host === "vscode" && controlledMultifilePatchPlan?.state === "ready" && controlledMultifileApplyRequest?.state === "blocked" && !controlledMultifileApplyConfirmed && !pendingControlledMultifileApply && Boolean(onConfirmControlledMultifileApply);
  const canRequestControlledMultifileApply = host === "vscode" && controlledMultifilePatchPlan?.state === "ready" && controlledMultifileApplyRequest?.state === "ready" && controlledMultifileApplyConfirmed && !pendingControlledMultifileApply && Boolean(onRequestControlledMultifileApply);
  const showControlledVerificationBundle = controlledVerificationBundle !== undefined || controlledVerificationBundleRequest !== undefined;
  const canRequestControlledVerificationBundle = host === "vscode" && controlledVerificationBundle?.state === "accepted" && controlledVerificationBundle.status === "planned" && controlledVerificationBundleRequest?.state === "ready" && !pendingControlledVerificationBundle && Boolean(onRequestControlledVerificationBundle);
  const canDraftControlledVerificationFollowup = host === "vscode" && controlledVerificationBundle?.state === "accepted" && isTerminalControlledVerificationStatus(controlledVerificationBundle.status) && Boolean(onDraftControlledVerificationFollowup);
  const canDraftControlledVerificationFix = host === "vscode" && controlledVerificationBundle?.state === "accepted" && controlledVerificationBundle.status !== "succeeded" && isTerminalControlledVerificationStatus(controlledVerificationBundle.status) && Boolean(onDraftControlledVerificationFix);
  const controlledVerificationUnsafeOmitted = controlledVerificationBundle?.commands.filter((command) => command.outputTail === undefined && (command.outputByteCount !== undefined || command.outputLineCount !== undefined || command.truncated)).length ?? 0;
  const [selectedTaskPresetId, setSelectedTaskPresetId] = useState<ControlledAgentTaskPresetId | null>(null);
  const [taskPresetGuidance, setTaskPresetGuidance] = useState<ControlledAgentTaskPresetGuidance | null>(null);
  const selectTaskPreset = (presetId: ControlledAgentTaskPresetId) => {
    setSelectedTaskPresetId(presetId);
    setTaskPresetGuidance(buildControlledAgentTaskPresetGuidance(presetId, { goal: textDetail(details.goalTitle) || textDetail(details.goalSummary) || "Review a local coding task before sending.", selectedSearchResultCount: controlledSearchSelectedSafeCount }));
  };
  const recoveryGuidance = buildControlledRecoveryGuidance(host, oneStepLoopState?.phase, repairLoop?.state, view.state);
  const showRecoveryGuidance = showOneStepLoop || showRepairLoop || view.state === "verification_failed";

  return (
    <section className={`readiness-card ${view.enabled ? "ready" : "warn"} agent-run-panel stack`} aria-label="Experimental Agent Run" data-testid="agent-run-panel">
      <div className="row">
        <strong>Agent Run · dev-preview, not autonomy</strong>
        <span className={`badge ${host === "vscode" ? "ok" : "warn"}`}>{host === "vscode" ? "VS Code explicit controls" : host === "jetbrains" ? "JetBrains partial/fail-closed" : "browser preview only"}</span>
        <span className={`badge ${view.stopped ? "warn" : view.enabled ? "ok" : ""}`}>{agentRunStateLabel(view.state, details)}</span>
      </div>
      <span>{sanitizeDisplayText(view.summary)}</span>
      <strong>{readinessExplanation(view.state, details)}</strong>
      {showRecoveryGuidance && <ControlledRecoveryGuidanceCard title="Controlled recovery guidance" guidance={recoveryGuidance} />}
      {controlledHostCapabilityMatrix && (
        <div className="readiness-card warn stack" role="status" aria-label="Agent Run host capability matrix">
          <div className="row">
            <strong>Host capability v2 matrix</strong>
            <span className="badge">metadata only</span>
            <span className="badge">allowed to execute: {String(controlledHostCapabilityMatrix.allowedToExecute)}</span>
          </div>
          <span>Host: {controlledHostCapabilityMatrix.hostLabel} · {controlledHostCapabilityMatrix.supportLabel}</span>
          <span>Capabilities: {controlledHostCapabilityMatrix.statusLabels.join(" · ")}</span>
          <span className="subtle">Dev-preview labels are display evidence only and do not grant controlled Start, read, edit, verification, repair, shell, git, provider, tool, or workspace authority.</span>
        </div>
      )}
      <div className="readiness-card warn stack" role="status" aria-label="Controlled agent task presets">
        <div className="row">
          <strong>Task presets · draft guidance only</strong>
          <span className={host === "vscode" ? "badge ok" : "badge warn"}>{host === "vscode" ? "VS Code draft" : host === "jetbrains" ? "JetBrains display-only" : "browser preview"}</span>
          <span className="badge">no auto actions</span>
        </div>
        <span>Draft only; no hidden read/search/index, send, provider, apply, verify, storage, or bridge action.</span>
        <div className="row" role="group" aria-label="Controlled agent task preset choices">
          {controlledAgentTaskPresets.map((preset) => <button key={preset.presetId} type="button" className="secondary-button" onClick={() => selectTaskPreset(preset.presetId)}>{preset.label}</button>)}
        </div>
        {taskPresetGuidance ? <div className="provider-item stack" role="status" aria-label="Controlled agent task preset draft guidance">
          <div className="row">
            <strong>{sanitizeDisplayText(taskPresetGuidance.label)} guidance draft</strong>
            <span className="badge">draft guidance only</span>
            <span className={taskPresetGuidance.useful ? "badge ok" : "badge warn"}>{taskPresetGuidance.useful ? "safe preset" : "blocked preset"}</span>
          </div>
          <span>Selected preset id: {selectedTaskPresetId ? sanitizeDisplayText(selectedTaskPresetId) : "none"}</span>
          <span>Policy: auto-send {String(taskPresetGuidance.policy.canAutoSend)} · auto-search {String(taskPresetGuidance.policy.canAutoSearch)} · auto-attach {String(taskPresetGuidance.policy.canAutoAttachContext)} · auto-apply {String(taskPresetGuidance.policy.canAutoApply)} · auto-verification {String(taskPresetGuidance.policy.canAutoRunVerification)} · provider calls {String(taskPresetGuidance.policy.canCallProviders)} · hidden reads {String(taskPresetGuidance.policy.canReadHiddenFiles)} · free-form commands {String(taskPresetGuidance.policy.canUseFreeformCommands)}</span>
          {taskPresetGuidance.diagnostics.length > 0 && <span className="subtle">Preset diagnostics: {taskPresetGuidance.diagnostics.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
          <strong>User-reviewed draft prompt</strong>
          <div className="attached-context-preview" aria-label="Controlled agent task preset draft prompt"><pre>{sanitizeDisplayText(taskPresetGuidance.draftPrompt).slice(0, 320)}</pre></div>
        </div> : <span className="subtle">Choose a preset to generate a visible draft. Nothing starts until the user reviews and sends later, if they choose. Cozy boundaries, no surprise zoomies.</span>}
      </div>
      {controlledTaskHarness && <section className={`readiness-card ${controlledTaskHarness.state === "ready" || controlledTaskHarness.state === "followup_ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled task harness journey metadata" data-testid="controlled-task-harness-panel">
        <div className="row">
          <strong>Controlled task journey harness</strong>
          <span className={controlledTaskHarness.host === "vscode" && controlledTaskHarness.state === "ready" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(controlledTaskHarness.statusLabel)}</span>
          <span className="badge">metadata only</span>
          <span className="badge">no automatic actions</span>
        </div>
        <span>Preset, context, search, proposal, patch-plan, apply, verification, follow-up, recovery, and final labels are display-only evidence from the local/mock controlled task journey.</span>
        <span className="subtle">No hidden read, search, indexing, send, provider call, apply, verification, repair, rollback, bridge post, runtime call, raw data persistence, or browser storage write starts from this harness panel.</span>
        <div className="agent-progress-grid" aria-label="Controlled task harness counters and gates">
          <span>Host: {sanitizeDisplayText(controlledTaskHarness.host)}</span>
          <span>State: {sanitizeDisplayText(controlledTaskHarness.state.replace(/_/g, " "))}</span>
          <span>Preset id: {sanitizeDisplayText(controlledTaskHarness.presetId)}</span>
          <span>Selected context: {controlledTaskHarness.counters.selectedItemCount}</span>
          <span>Search queries: {controlledTaskHarness.counters.searchQueryCount}</span>
          <span>Search results: {controlledTaskHarness.counters.searchResultCount}</span>
          <span>Patch files: {controlledTaskHarness.counters.patchFileCount}</span>
          <span>Replacement bytes: {controlledTaskHarness.counters.replacementByteCount}</span>
          <span>Verification commands: {controlledTaskHarness.counters.verificationCommandCount}</span>
          <span>Unsafe omitted: {controlledTaskHarness.counters.unsafeOmittedCount}</span>
          <span>Gates: preset {String(controlledTaskHarness.gates.presetSelected)} · context {String(controlledTaskHarness.gates.contextSelected)} · proposal {String(controlledTaskHarness.gates.proposalReviewed)} · patch plan {String(controlledTaskHarness.gates.patchPlanReviewed)} · apply {String(controlledTaskHarness.gates.applyConfirmed)} · verification {String(controlledTaskHarness.gates.verificationConfirmed)}</span>
          <span>Authority: auto-send {String(controlledTaskHarness.policy.canAutoSend)} · read hidden files {String(controlledTaskHarness.policy.canReadHiddenFiles)} · search hidden files {String(controlledTaskHarness.policy.canSearchHiddenFiles)} · indexing {String(controlledTaskHarness.policy.canIndexWorkspace)} · auto-apply {String(controlledTaskHarness.policy.canAutoApply)} · auto-verify {String(controlledTaskHarness.policy.canAutoVerify)} · repair without user click {String(controlledTaskHarness.policy.canAutoRepair)} · provider tools {String(controlledTaskHarness.policy.canUseProviderTools)} · browser storage {String(controlledTaskHarness.policy.canStoreBrowserData)}</span>
        </div>
        {controlledTaskHarness.labels.length > 0 && <span>Journey labels: {controlledTaskHarness.labels.map((label) => sanitizeDisplayText(label)).join(" · ")}</span>}
        {controlledTaskHarness.host === "browser" && <span className="subtle">Browser remains unsupported and fail-closed for controlled task execution.</span>}
        {controlledTaskHarness.host === "jetbrains" && <span className="subtle">JetBrains remains partial/fail-closed until controlled workflow parity is verified.</span>}
        {controlledTaskHarness.diagnostics.length > 0 && <span className="subtle">Harness diagnostics: {controlledTaskHarness.diagnostics.map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span>}
      </section>}
      {controlledTwoStepRunState && <section className={`readiness-card ${controlledTwoStepRunState.phase === "failed" || controlledTwoStepRunState.phase === "stopped" ? "warn" : "ready"} stack`} role="status" aria-label="Two-step controlled run staged evidence">
        <div className="row">
          <strong>S119 two-step run staged evidence</strong>
          <span className={controlledTwoStepRunState.phase === "failed" || controlledTwoStepRunState.phase === "stopped" ? "badge warn" : "badge ok"}>{sanitizeDisplayText(controlledTwoStepRunState.phase.replace(/_/g, " "))}</span>
          <span className="badge">display only</span>
          <span className="badge">metadata only</span>
          <span className="badge">no unattended autonomy</span>
        </div>
        <span>{sanitizeDisplayText(controlledTwoStepRunState.summary)}</span>
        <span>{twoStepRunManualGateCopy(controlledTwoStepRunState)}</span>
        <div className="agent-progress-grid" aria-label="Two-step controlled run gates">
          <span>Planning gate: {controlledTwoStepRunState.correlation.planningGateId ? "user confirmed" : "waiting for explicit user request"}</span>
          <span>Plan review gate: {controlledTwoStepRunState.correlation.planReviewGateId ? "user reviewed" : "blocked until user review"}</span>
          <span>Execution gate: {controlledTwoStepRunState.correlation.executionGateId ? "user requested execution" : "execution not requested"}</span>
          <span>Verification gate: {controlledTwoStepRunState.correlation.verificationGateId ? "user requested verification" : "verification not requested"}</span>
          <span>Next user action: {sanitizeDisplayText(controlledTwoStepRunState.nextUserAction.replace(/_/g, " "))}</span>
          <span>Run id: {sanitizeDisplayText(controlledTwoStepRunState.correlation.runId ?? "missing")}</span>
        </div>
        <div className="agent-progress-grid" aria-label="Two-step controlled run counters">
          <span>Planner steps: {controlledTwoStepRunState.counters.plannerSteps}/{controlledTwoStepRunState.budgets.maxPlannerSteps}</span>
          <span>Selected context: {controlledTwoStepRunState.counters.selectedContextItems}/{controlledTwoStepRunState.budgets.maxSelectedContextItems}</span>
          <span>Selected search: {controlledTwoStepRunState.counters.searchResults}/{controlledTwoStepRunState.budgets.maxSearchResults}</span>
          <span>Touched files: {controlledTwoStepRunState.counters.filesTouched}/{controlledTwoStepRunState.budgets.maxTouchedFiles}</span>
          <span>Edit bytes: {controlledTwoStepRunState.counters.editBytes}/{controlledTwoStepRunState.budgets.maxEditBytes}</span>
          <span>Verification commands: {controlledTwoStepRunState.counters.verificationCommands}/{controlledTwoStepRunState.budgets.maxVerificationCommands}</span>
          <span>User turns: {controlledTwoStepRunState.counters.userTurns}</span>
          <span>Stale or duplicate events: {controlledTwoStepRunState.counters.staleOrDuplicateEvents}</span>
        </div>
        <span>Authority flags: execute {String(controlledTwoStepRunState.executionAllowed)} · apply without click {String(controlledTwoStepRunState.autoApplyAllowed)} · verify without click {String(controlledTwoStepRunState.autoVerifyAllowed)} · repair without click {String(controlledTwoStepRunState.autoRepairAllowed)} · read {String(controlledTwoStepRunState.canReadFiles)} · write {String(controlledTwoStepRunState.canWriteFiles)} · command {String(controlledTwoStepRunState.canRunCommands)} · provider {String(controlledTwoStepRunState.canCallProvider)} · tools {String(controlledTwoStepRunState.canUseTools)}</span>
        {controlledTwoStepRunState.stop && <span>Blocked safely: {sanitizeDisplayText(controlledTwoStepRunState.stop.reason.replace(/_/g, " "))} · recoverable {String(controlledTwoStepRunState.stop.recoverable)}</span>}
        {controlledTwoStepRunState.diagnostics.length > 0 && <span>Diagnostics: {controlledTwoStepRunState.diagnostics.slice(0, 4).map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span>}
        <span className="subtle">Planning complete does not imply execution. Execution requested does not imply verification. Apply, verification, and follow-up outcomes stay separate user-reviewed evidence; Browser is unsupported for trusted execution and JetBrains remains fail-closed where parity is not verified.</span>
      </section>}

      {showControlledRunContextSelector && <div className={`readiness-card ${controlledRunContextEnabled ? "ready" : "warn"} stack`} role="status" aria-label="Explicit controlled-run context selector">
        <div className="row">
          <strong>Explicit controlled-run context</strong>
          <span className={controlledRunContextSupported ? "badge ok" : "badge warn"}>{controlledRunContextSupported ? "VS Code visible selection" : "unsupported host"}</span>
          <span className="badge">one-shot include</span>
          <span className="badge">no hidden scan/search/index</span>
        </div>
        <span>{controlledRunContextEnabled ? "Only the user-selected bounded context below is eligible for the controlled run preview." : controlledRunContextSupported ? "Attach explicit context snippets first; no workspace scan, search, index, or file read starts here." : "Controlled-run context include is disabled outside VS Code and posts no bridge request."}</span>
        <label className="row attached-context-toggle">
          <input style={{ width: "auto" }} type="checkbox" checked={includeControlledRunContext && controlledRunContextEnabled} disabled={!controlledRunContextEnabled} onChange={(event) => onIncludeControlledRunContextChange?.(event.target.checked)} />
          {includeControlledRunContext && controlledRunContextEnabled ? "Include selected context with the next controlled run" : "Do not include selected context"}
        </label>
        <div className="agent-progress-grid" aria-label="Explicit controlled-run context budget">
          <span>Selected bounded items: {controlledRunContextReport?.selectedContextCount ?? controlledRunContextItems.length}</span>
          <span>Total preview bytes: {controlledRunContextReport?.totalPreviewBytes ?? 0}</span>
          <span>Total preview lines: {controlledRunContextReport?.totalPreviewLines ?? 0}</span>
          <span>Truncated previews: {controlledRunContextReport?.truncatedCount ?? 0}</span>
          <span>Omitted unsafe items: {controlledRunContextReport?.omittedUnsafeItemCount ?? 0}</span>
        </div>
        {controlledRunContextReport && controlledRunContextReport.blockedReasons.length > 0 && <span className="subtle">Blocked context reasons: {controlledRunContextReport.blockedReasons.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>}
        {controlledRunContextItems.length > 0 ? controlledRunContextItems.map((item, index) => (
          <div className="provider-item stack" key={item.key}>
            <div className="row">
              <strong>{index + 1}. {sanitizeDisplayText(item.label)}</strong>
              <span className="badge ok">{sanitizeDisplayText(item.sourceKind.replace(/_/g, " "))}</span>
              {item.workspaceRelativePath && <span className="badge">{sanitizeDisplayText(item.workspaceRelativePath)}</span>}
            </div>
            <span className="subtle">{item.range ? `Lines ${item.range.startLine}-${item.range.endLine} · ` : ""}{item.previewByteCount} bytes · {item.previewLineCount} lines · truncated {item.truncated ? "yes" : "no"} · {sanitizeDisplayText(item.hostSurfaceLabel)}</span>
            <div className="attached-context-preview"><pre>{sanitizeDisplayText(item.previewText)}</pre></div>
          </div>
        )) : <span className="subtle">No explicit controlled-run context selected. The cat sees no basket, therefore carries no files.</span>}
        <span className="subtle">Preview is bounded and in-memory only. This panel never persists raw file bodies, starts search/indexing, or attaches hidden workspace context.</span>
      </div>}
      {showControlledSearchSelection && <div className={`readiness-card ${controlledSearchSelectedSafeCount > 0 && controlledSearchSelection?.state === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled lexical search explicit selection">
        <div className="row">
          <strong>Controlled lexical search results</strong>
          <span className={host === "vscode" ? "badge ok" : "badge warn"}>{host === "vscode" ? "VS Code explicit search" : host === "jetbrains" ? "JetBrains fail-closed" : "browser unsupported"}</span>
          <span className="badge">explicit user-selected context only</span>
          <span className="badge">no auto attach/send/provider/apply/verify</span>
        </div>
        <span>{host === "vscode" ? "Sanitized lexical search results can be selected here as display metadata for later explicit context inclusion." : host === "jetbrains" ? "JetBrains controlled lexical search selection is display-only and fail-closed until host parity is verified." : "Browser preview cannot run or select controlled lexical search results; no bridge request is posted."}</span>
        <span className="subtle">This panel does not start search on render, read files, index the workspace, persist raw snippets, attach to prompts, send chat, call providers, apply edits, or run verification. Tiny paws, strict boundaries.</span>
        <div className="agent-progress-grid" aria-label="Controlled lexical search selection budget">
          <span>Search result id: {controlledSearchResultId ? sanitizeDisplayText(controlledSearchResultId) : "not recorded"}</span>
          <span>Search status: {controlledLexicalSearch?.status ?? "no accepted result"}</span>
          <span>Displayed safe results: {controlledSearchSafeItems.length}</span>
          <span>Selected safe results: {controlledSearchSelection?.selectedContext?.selectedCount ?? controlledSearchSelectedSafeCount}</span>
          <span>Selected bytes: {controlledSearchSelection?.selectedContext?.totalSnippetBytes ?? 0}/{controlledSearchSelection?.selectedContext?.budgets.maxTotalSnippetBytes ?? 1200}</span>
          <span>Selected lines: {controlledSearchSelection?.selectedContext?.totalSnippetLines ?? 0}/{controlledSearchSelection?.selectedContext?.budgets.maxTotalSnippetLines ?? 80}</span>
          <span>Omitted unsafe/stale results: {controlledSearchUnsafeOmittedCount}</span>
          <span>Truncated search result: {controlledLexicalSearch?.truncated ? "yes" : "no"}</span>
        </div>
        <button type="button" className="secondary-button" onClick={onRequestControlledSearch} disabled={!canRequestControlledSearch}>{pendingControlledSearch ? "Controlled search pending" : "Request controlled lexical search"}</button>
        {controlledSearchSelection?.state === "blocked" && controlledSearchSelection.diagnostics.length > 0 && <span className="subtle">Selection diagnostics: {controlledSearchSelection.diagnostics.map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span>}
        {controlledSearchSafeItems.length === 0 && <span>No safe sanitized lexical search results are available for selection.</span>}
        {controlledSearchSafeItems.map(({ id, snippet }) => (
          <label className="row attached-context-toggle" key={id}>
            <input style={{ width: "auto" }} type="checkbox" checked={controlledSearchSelectedIds.has(id)} disabled={host !== "vscode" || !onControlledSearchResultSelectionChange} onChange={(event) => onControlledSearchResultSelectionChange?.(id, event.target.checked)} />
            {sanitizeDisplayText(snippet.pathLabel)} · {snippet.range.start.line}:{snippet.range.start.character}-{snippet.range.end.line}:{snippet.range.end.character} · {sanitizeDisplayText(snippet.languageId ?? "unknown")} · {snippet.snippetByteCount} bytes · {snippet.matchCount} matches{id ? ` · ${sanitizeDisplayText(id)}` : ""}
          </label>
        ))}
      </div>}
      {controlledMultifilePatchPlan && <div className={`readiness-card ${controlledMultifilePatchPlan.state === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled multi-file patch dry-run review">
        <div className="row">
          <strong>Multi-file patch dry-run review</strong>
          <span className={controlledMultifilePatchPlan.state === "ready" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(controlledMultifilePatchPlan.state)}</span>
          <span className="badge">review only</span>
          <span className="badge">metadata only</span>
          <span className="badge">no multi-file apply</span>
        </div>
        <span>This bounded multi-file patch plan is dry-run review evidence only. It cannot apply, create, delete, rename, run commands, call providers or tools, read files, write files, send chat, verify, or persist raw payloads.</span>
        <span className="subtle">Raw replacement text, raw diffs, raw file bodies, provider/tool payloads, private paths, secrets, and command output are intentionally omitted. Browser preview and JetBrains remain display-only/fail-closed for this S115 review path.</span>
        {controlledMultifilePatchPlan.state === "ready" ? <>
          <span>{sanitizeDisplayText(controlledMultifilePatchPlan.preview.summary)}</span>
          <div className="agent-progress-grid" aria-label="Controlled multi-file patch dry-run counts">
            <span>Plan id: {sanitizeDisplayText(controlledMultifilePatchPlan.preview.planId)}</span>
            <span>Workspace: {sanitizeDisplayText(controlledMultifilePatchPlan.preview.workspaceLabel)}</span>
            <span>Files: {controlledMultifilePatchPlan.preview.fileCount}/{controlledMultifilePatchPlan.preview.budgets.maxFiles}</span>
            <span>Edits: {controlledMultifilePatchPlan.preview.editCount}/{controlledMultifilePatchPlan.preview.budgets.maxEdits}</span>
            <span>Total replacement bytes: {controlledMultifilePatchPlan.preview.totalReplacementBytes}/{controlledMultifilePatchPlan.preview.budgets.maxTotalReplacementBytes}</span>
            <span>Per-edit byte budget: {controlledMultifilePatchPlan.preview.budgets.maxReplacementBytesPerEdit}</span>
            <span>Automatic apply allowed: {String(controlledMultifilePatchPlan.preview.automaticApplyAllowed)}</span>
            <span>Assistant apply authority: {String(controlledMultifilePatchPlan.preview.assistantMintedApplyAllowed)}</span>
          </div>
          <span>Safe touched path labels: {controlledMultifilePatchPlan.preview.touchedPathLabels.map((item) => sanitizeDisplayText(item)).join(" · ")}</span>
          {controlledMultifilePatchPlan.preview.files.map((file) => <div className="provider-item stack" key={file.workspaceRelativePath}>
            <div className="row">
              <strong>{sanitizeDisplayText(file.fileLabel)}</strong>
              <span className={file.riskLabel === "low" ? "badge ok" : "badge warn"}>risk {sanitizeDisplayText(file.riskLabel)}</span>
              <span className="badge">{file.editCount} edits</span>
              <span className="badge">{file.replacementByteTotal} bytes</span>
            </div>
            <span>{sanitizeDisplayText(file.fileSummary)}</span>
            <span className="subtle">Expected pre-edit hash: {sanitizeDisplayText(file.expectedPreEditHashLabel)}</span>
            {file.edits.map((edit) => <span key={edit.editId}>{sanitizeDisplayText(edit.editId)} · {sanitizeDisplayText(edit.operation)} · {sanitizeDisplayText(edit.rangeLabel)} · {edit.replacementByteCount} bytes · expected {sanitizeDisplayText(edit.expectedRangeHashLabel)} · {sanitizeDisplayText(edit.replacementSummary)}</span>)}
          </div>)}
        </> : <>
          <span>Unsafe or malformed multi-file patch plan metadata is blocked and non-actionable. No apply, bridge post, provider call, command, file operation, browser storage write, or auto-action was introduced.</span>
          {controlledMultifilePatchPlan.diagnostics.map((diagnostic) => <span key={`${diagnostic.code}:${diagnostic.message}`}>{sanitizeDisplayText(diagnostic.code)}: {sanitizeDisplayText(diagnostic.message)}</span>)}
        </>}
      </div>}
      {showControlledVerificationBundle && <div className={`readiness-card ${canRequestControlledVerificationBundle || controlledVerificationBundle?.status === "succeeded" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled verification bundle review and run">
        <div className="row">
          <strong>Controlled verification bundle</strong>
          <span className={host === "vscode" ? "badge ok" : "badge warn"}>{host === "vscode" ? "VS Code explicit run" : host === "jetbrains" ? "JetBrains fail-closed" : "browser unsupported"}</span>
          <span className="badge">fixed command ids only</span>
          <span className="badge">sequence-aware</span>
          <span className="badge">sanitized summaries</span>
          {pendingControlledVerificationBundle && <span className="badge warn">pending</span>}
        </div>
        <span>{host === "vscode" ? "Review the bounded fixed command ids below, then run the bundle only with the explicit button." : host === "jetbrains" ? "JetBrains verification bundle execution remains fail-closed and posts no bridge request until parity is verified." : "Browser preview cannot request verification bundle execution and posts no bridge request."}</span>
        <span className="subtle">No verification bundle starts on render, provider proposal, apply result, search selection, or history load. No command strings, args, cwd, env, shell, git, package, network, provider, tool, file read, file write, raw output, private path, or secret authority is exposed.</span>
        <div className="agent-progress-grid" aria-label="Controlled verification bundle status">
          <span>Bundle id: {controlledVerificationBundle?.bundleId ? sanitizeDisplayText(controlledVerificationBundle.bundleId) : "not accepted"}</span>
          <span>Run id: {controlledVerificationBundle?.runId ? sanitizeDisplayText(controlledVerificationBundle.runId) : "not accepted"}</span>
          <span>Status: {sanitizeDisplayText(controlledVerificationBundle?.status ?? controlledVerificationBundleRequest?.state ?? "missing")}</span>
          <span>Command count: {controlledVerificationBundle?.commandCount ?? 0}</span>
          <span>Request state: {sanitizeDisplayText(controlledVerificationBundleRequest?.state ?? "missing")}</span>
          <span>Omitted unsafe output tails: {controlledVerificationUnsafeOmitted}</span>
          <span>Raw output persisted/rendered: false</span>
          <span>Free-form command authority: false</span>
          <span>Follow-up draft authority: {controlledVerificationFollowupDraft ? "local draft only · manual Send required" : "not drafted"}</span>
        </div>
        {controlledVerificationBundleRequest?.diagnostics.length ? <span className="subtle">Bundle request diagnostics: {controlledVerificationBundleRequest.diagnostics.slice(0, 4).map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span> : null}
        {controlledVerificationBundle?.diagnostics.length ? <span className="subtle">Bundle diagnostics: {controlledVerificationBundle.diagnostics.slice(0, 4).map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span> : null}
        {controlledVerificationBundle?.commands.map((command) => <div className="provider-item stack" key={command.stepId}>
          <div className="row">
            <strong>Step {command.sequenceIndex + 1}: {sanitizeDisplayText(command.commandId)}</strong>
            <span className={command.status === "succeeded" ? "badge ok" : command.status === "planned" || command.status === "running" ? "badge" : "badge warn"}>{sanitizeDisplayText(command.status)}</span>
            <span className="badge">timeout {command.timeoutMs}ms</span>
          </div>
          <span>{sanitizeDisplayText(command.summary)}</span>
          <span>Limits: {command.maxOutputBytes} bytes · {command.maxOutputLines} lines · tail only true · args/cwd/env/shell false</span>
          {(command.exitCode !== undefined || command.durationMs !== undefined || command.resultHash) && <span>Result metadata: exit {String(command.exitCode ?? "none")} · duration {String(command.durationMs ?? "none")}ms · hash {sanitizeDisplayText(command.resultHash ?? "not reported")} · truncated {String(command.truncated ?? false)}</span>}
          {command.outputTail ? <span>Sanitized summary tail: {sanitizeDisplayText(command.outputTail)}</span> : <span className="subtle">Raw stdout/stderr is omitted; only safe summaries and hashes may appear.</span>}
        </div>)}
        {controlledVerificationFollowupDraft && <div className="provider-item stack" aria-label="Controlled verification follow-up draft">
          <div className="row">
            <strong>{sanitizeDisplayText(controlledVerificationFollowupDraft.followupProposal.title)}</strong>
            <span className="badge ok">draft only</span>
            <span className="badge">manual Send required</span>
          </div>
          <span>{sanitizeDisplayText(controlledVerificationFollowupDraft.followupProposal.promptSummary)}</span>
          <span>Source bundle: {sanitizeDisplayText(controlledVerificationFollowupDraft.sourceBundle.bundleId)} · {sanitizeDisplayText(controlledVerificationFollowupDraft.sourceBundle.aggregateStatus)} · failed {controlledVerificationFollowupDraft.sourceBundle.failedCount}</span>
          <span>No auto-send, provider call, repair, apply, verify, bridge post, raw output, command string, cwd/env, file/diff payload, private path, or secret is included.</span>
        </div>}
        {controlledVerificationBundleNote && <span>{sanitizeDisplayText(controlledVerificationBundleNote)}</span>}
        <div className="row" role="group" aria-label="Controlled verification bundle actions">
          <button type="button" onClick={onRequestControlledVerificationBundle} disabled={!canRequestControlledVerificationBundle}>{pendingControlledVerificationBundle ? "Verification bundle pending" : "Run controlled verification bundle"}</button>
          <button type="button" onClick={onDraftControlledVerificationFollowup} disabled={!canDraftControlledVerificationFollowup}>Draft sanitized verification follow-up</button>
          <button type="button" onClick={onDraftControlledVerificationFix} disabled={!canDraftControlledVerificationFix}>Draft manual fix prompt</button>
        </div>
      </div>}
      {showControlledMultifileApply && <div className={`readiness-card ${canRequestControlledMultifileApply || controlledMultifileApplyResult?.state === "applied" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled multi-file apply confirmation">
        <div className="row">
          <strong>Explicit multi-file apply confirmation</strong>
          <span className={host === "vscode" ? "badge ok" : "badge warn"}>{host === "vscode" ? "VS Code executor" : host === "jetbrains" ? "JetBrains fail-closed" : "browser unsupported"}</span>
          <span className="badge">user confirmed only</span>
          <span className="badge">existing text files only</span>
          {controlledMultifileApplyConfirmed && <span className="badge ok">review confirmed</span>}
          {pendingControlledMultifileApply && <span className="badge warn">pending</span>}
        </div>
        <span>{host === "vscode" ? "Review every file label, count, range, hash, and limit above before requesting bounded multi-file apply." : host === "jetbrains" ? "JetBrains multi-file apply remains disabled and posts no bridge request until host parity is separately verified." : "Browser preview cannot request multi-file apply and posts no bridge request."}</span>
        <span className="subtle">No apply starts on render, provider response, search selection, or dry-run preview. This control cannot create, delete, rename, move, run commands, call providers or tools, expose private paths, display replacement bodies, display diff bodies, or persist file bodies.</span>
        <div className="agent-progress-grid" aria-label="Controlled multi-file apply request status">
          <span>Request status: {sanitizeDisplayText(controlledMultifileApplyRequest?.state ?? "blocked")}</span>
          <span>Plan status: {sanitizeDisplayText(controlledMultifilePatchPlan?.state ?? "missing")}</span>
          <span>Confirmed: {String(controlledMultifileApplyConfirmed)}</span>
          <span>Pending: {String(pendingControlledMultifileApply)}</span>
          <span>Can create/delete/rename: false</span>
          <span>Command/provider/tool authority: false</span>
        </div>
        {controlledMultifileApplyRequest?.diagnostics.length ? <span className="subtle">Apply diagnostics: {controlledMultifileApplyRequest.diagnostics.slice(0, 4).map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span> : null}
        {controlledMultifileApplyResult && <div className={`readiness-card ${controlledMultifileApplyResult.state === "applied" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled multi-file apply result summary">
          <strong>Multi-file apply result summary</strong>
          <span>{sanitizeDisplayText(controlledMultifileApplyResult.message)}</span>
          <div className="agent-progress-grid" aria-label="Controlled multi-file apply result counts">
            <span>State: {sanitizeDisplayText(controlledMultifileApplyResult.state)}</span>
            <span>Applied files: {controlledMultifileApplyResult.appliedFileCount}</span>
            <span>Applied edits: {controlledMultifileApplyResult.appliedEditCount}</span>
            <span>Blocked files: {controlledMultifileApplyResult.blockedFileCount}</span>
            <span>Failed edits: {controlledMultifileApplyResult.failedEditCount}</span>
            <span>Metadata only: {String(controlledMultifileApplyResult.metadataOnly)}</span>
          </div>
          {controlledMultifileApplyResult.files.map((file) => <span key={file.editId}>{sanitizeDisplayText(file.fileLabel)} · {sanitizeDisplayText(file.status)} · lines {file.startLine}-{file.endLine} · {file.replacementByteCount} bytes · post {sanitizeDisplayText(file.actualPostEditHashLabel ?? "not reported")}</span>)}
        </div>}
        {controlledMultifileApplyNote && <span>{sanitizeDisplayText(controlledMultifileApplyNote)}</span>}
        <div className="row" role="group" aria-label="Controlled multi-file apply actions">
          <button type="button" className="secondary-button" onClick={onConfirmControlledMultifileApply} disabled={!canConfirmControlledMultifileApply}>Confirm multi-file apply review</button>
          <button type="button" onClick={onRequestControlledMultifileApply} disabled={!canRequestControlledMultifileApply}>Apply reviewed multi-file patch in VS Code</button>
          <button type="button" className="secondary-button" onClick={onClearControlledMultifileApply} disabled={!pendingControlledMultifileApply && !controlledMultifileApplyResult && !controlledMultifileApplyConfirmed}>Clear multi-file apply state</button>
        </div>
      </div>}
      {(showOneStepLoop || showRepairLoop) && (      <div className={`readiness-card ${devPreviewStatus.state === "ready" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled agent dev-preview status">
        <div className="row">
          <strong>S91 controlled dev-preview status</strong>
          <span className={devPreviewStatus.state === "ready" ? "badge ok" : "badge warn"}>{devPreviewStatus.state}</span>
          <span className="badge">explicit Start/Stop</span>
          <span className="badge">sanitized report</span>
        </div>
        <span>{devPreviewStatus.summary}</span>
        <span>Host: {devPreviewStatus.host} · Explicit start: {devPreviewStatus.capabilities.explicitStart ? "ready" : "blocked"} · Bounded read/edit: {devPreviewStatus.capabilities.boundedRead && devPreviewStatus.capabilities.boundedEdit ? "ready" : "blocked"} · Allowlisted verification: {devPreviewStatus.capabilities.allowlistedVerification ? "ready" : "blocked"} · One repair attempt: {devPreviewStatus.capabilities.boundedRepair ? "ready" : "blocked"} · Sanitized report: ready</span>
        <span>Limitations: {devPreviewStatus.limitations.join(" · ")}</span>
        <span className="subtle">Dev-preview only: no production autonomy, sanitized reports only, no raw output.</span>
      </div>
      )}
      {devPreviewReport && (
        <div className={`readiness-card ${devPreviewReport.status === "completed" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled dev-preview report">
          <div className="row">
            <strong>Controlled dev-preview report</strong>
            <span className={devPreviewReport.status === "completed" ? "badge ok" : "badge warn"}>{devPreviewReport.statusLabel}</span>
            <span className="badge">metadata only</span>
            <span className="badge">display only</span>
          </div>
          <span>Host: {devPreviewReport.hostLabel}</span>
          <span>Current user action: {devPreviewReport.currentUserActionLabel}</span>
          <span>Capabilities: {devPreviewReport.capabilityLabels.join(" · ")}</span>
          <div className="agent-progress-grid" aria-label="Controlled dev-preview report counters">
            {Object.entries(devPreviewReport.counters).map(([key, value]) => <span key={key}>Report counter {sanitizeDisplayText(key)}: {value}</span>)}
          </div>
          <span>Limitations: {devPreviewReport.limitationLabels.join(" · ")}</span>
          {devPreviewReport.evidence.length > 0 && <span>Evidence: {devPreviewReport.evidence.map((item) => `${sanitizeDisplayText(item.label)} — ${sanitizeDisplayText(item.summary)}`).join(" · ")}</span>}
          <span className="subtle">Safety boundaries: {devPreviewReport.safetyBoundaryLabels.join(" · ")}</span>
        </div>
      )}
      {controlledRunHistory.length > 0 && (
        <div className="readiness-card stack" role="status" aria-label="Controlled run local history" data-testid="controlled-run-history-panel">
          <div className="row">
            <strong>Controlled run history</strong>
            <span className="badge">local metadata</span>
            <span className="badge">sanitized labels only</span>
            <span className="badge">no persistence</span>
          </div>
          <span className="subtle">Read-only GUI history of recent controlled-run metadata. Raw prompts, file bodies, diffs, command strings/output, provider payloads, private paths, and secrets are omitted.</span>
          {controlledRunHistory.map((item) => (
            <div className="provider-item stack" key={item.runId}>
              <div className="row">
                <strong>{sanitizeDisplayText(item.runId)}</strong>
                <span className="badge">{sanitizeDisplayText(item.phaseLabel.replace(/_/g, " "))}</span>
                <span className={item.resultLabel === "succeeded" ? "badge ok" : "badge warn"}>{sanitizeDisplayText(item.resultLabel.replace(/_/g, " "))}</span>
              </div>
              <span>Host: {sanitizeDisplayText(item.hostLabel.replace(/_/g, " "))} · Readiness: {item.readinessLabels.map((label) => sanitizeDisplayText(label.replace(/_/g, " "))).join(" · ")}</span>
              <span>Updated: {sanitizeDisplayText(item.updatedAtLabel)}</span>
              {item.summaryLabels.length > 0 && <span>Summary labels: {item.summaryLabels.map((label) => sanitizeDisplayText(label)).join(" · ")}</span>}
              {item.counters.length > 0 && <span>Counters: {item.counters.map((counter) => `${sanitizeDisplayText(counter.name.replace(/_/g, " "))} ${counter.value}`).join(" · ")}</span>}
              {item.artifactLabels.length > 0 && <span>Artifact labels: {item.artifactLabels.map((artifact) => [sanitizeDisplayText(artifact.label), artifact.checksumLabel ? sanitizeDisplayText(artifact.checksumLabel) : "", artifact.sizeBucketLabel ? sanitizeDisplayText(artifact.sizeBucketLabel) : "", artifact.retentionLabel ? sanitizeDisplayText(artifact.retentionLabel) : ""].filter(Boolean).join(" · ")).join(" | ")}</span>}
              {item.checksumLabels.length > 0 && <span>Checksum labels: {item.checksumLabels.map((label) => sanitizeDisplayText(label)).join(" · ")}</span>}
              <span className="subtle">Safety labels: {item.safetyLabels.map((label) => sanitizeDisplayText(label.replace(/_/g, " "))).join(" · ")}</span>
            </div>
          ))}
        </div>
      )}
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
      {showOneStepLoop && oneStepLoopState && (
        <div className={`readiness-card ${canStartOneStep || controlledTaskExecutionState?.phase === "context_ready" || controlledTaskExecutionState?.phase === "completed" ? "ready" : "warn"} stack`} role="status" aria-label="Controlled task execution Start">
          <div className="row">
            <strong>Controlled task execution Start</strong>
            <span className={host === "vscode" ? "badge ok" : "badge warn"}>{host === "vscode" ? "VS Code-only" : host === "jetbrains" ? "JetBrains fail-closed" : "browser unsupported"}</span>
            <span className="badge">single explicit gate</span>
            <span className="badge">reducer only</span>
            <span className="badge">no host commands</span>
          </div>
          <span>{controlledTaskExecutionState?.phase === "context_ready" ? "VS Code Start recorded; planning/context is ready in controlled task execution state." : sanitizeDisplayText(oneStepLoopState.summary)}</span>
          <div className="agent-progress-grid" aria-label="Controlled task execution readiness fields">
            <span>Controlled phase: {(controlledTaskExecutionSummary?.phase ?? controlledTaskExecutionState?.phase ?? "idle").replace(/_/g, " ")}</span>
            <span>Active run: {controlledTaskExecutionSummary?.hasRunId ? "yes" : "no"}</span>
            <span>Workspace lineage: {controlledTaskExecutionSummary?.lineage.hasWorkspaceReadinessId ? "present" : "not recorded"}</span>
            <span>Runtime lineage: {controlledTaskExecutionSummary?.lineage.hasRuntimeSessionId ? "present" : "not recorded"}</span>
            <span>Read request: {oneStepReadReady ? "ready" : oneStepReadRequest?.state ?? "missing"}</span>
            <span>Edit request: {oneStepEditReady ? "ready" : oneStepEditRequest?.state ?? "missing"}</span>
            <span>Verification request: {oneStepCommandReady ? "ready" : oneStepCommandRunRequest?.state ?? "missing"}</span>
          </div>
          {controlledTaskExecutionState?.frozenContextSummary && <span>{sanitizeDisplayText(controlledTaskExecutionState.frozenContextSummary)}</span>}
          {host !== "vscode" && <span className="subtle">Controlled task execution Start is disabled outside VS Code and posts no bridge request.</span>}
          {host === "vscode" && !canStartOneStep && !oneStepActive && <span className="subtle">Start needs visible ready VS Code runtime, workspace, controlled read, controlled edit, and verification metadata.</span>}
          {oneStepActive && <span className="subtle" role="status">Controlled task execution is already active. Duplicate Start clicks stay disabled and do not mint another run.</span>}
          <span className="subtle">Start advances only the GUI controlled task execution reducer into planning/context-ready state. It does not post read, apply, verification, shell, git, provider, network, or workspace mutation commands. Cozy leash, no sprinting into traffic.</span>
          <div className="row" role="group" aria-label="Controlled task execution actions">
            <button type="button" onClick={onStartOneStepRun} disabled={!canStartOneStep}>Start one-step Agent Run</button>
            <button type="button" className="secondary-button" onClick={onStopOneStepRun} disabled={!canStopOneStep}>Stop one-step Agent Run</button>
          </div>
        </div>
      )}
      {showRepairLoop && repairLoop && (
        <div className={`readiness-card ${canConfirmRepair ? "ready" : "warn"} stack`} role="status" aria-label="Agent Run controlled repair eligibility">
          <div className="row">
            <strong>Controlled repair eligibility</strong>
            <span className="badge">one attempt max</span>
            <span className="badge">explicit user click</span>
            <span className="badge">no automatic repair</span>
            <span className={repairLoop.canAttemptRepair ? "badge ok" : "badge warn"}>{sanitizeDisplayText(repairLoop.state.replace(/_/g, " "))}</span>
          </div>
          <span>{sanitizeDisplayText(repairLoop.summary)}</span>
          <span>Repair is display-only until the user explicitly clicks the repair confirmation button. This card never reads files, applies edits, runs commands, posts bridge messages, calls providers, or starts repair automatically.</span>
          <div className="agent-progress-grid" aria-label="Agent Run repair eligibility fields">
            <span>State: {sanitizeDisplayText(repairLoop.state.replace(/_/g, " "))}</span>
            <span>Attempts: {repairLoop.attemptCount}/{repairLoop.maxAttempts}</span>
            <span>Verification runs: {repairLoop.verificationRuns}</span>
            <span>User turns: {repairLoop.userTurns}</span>
            <span>Can attempt repair: {repairLoop.canAttemptRepair ? "yes" : "no"}</span>
            <span>Draft ready: {repairDraftReady ? "yes" : "no"}</span>
            <span>Repair edit pending: {pendingRepairEdit ? "yes" : "no"}</span>
            <span>Repair verification pending: {pendingRepairVerification ? "yes" : "no"}</span>
          </div>
          {repairLoop.stop && <span>Stop reason: {sanitizeDisplayText(repairLoop.stop.reason.replace(/_/g, " "))} · {sanitizeDisplayText(repairLoop.stop.message)}</span>}
          {repairLoop.diagnostics.length > 0 && <span className="subtle">Repair diagnostics: {repairLoop.diagnostics.map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`).join(" · ")}</span>}
          <div className="row" role="group" aria-label="Agent Run controlled repair actions">
            <button type="button" className="secondary-button" onClick={onConfirmRepairAttempt} disabled={!canConfirmRepair}>Confirm one repair attempt</button>
          </div>
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

function controlledReportStatusFromOneStep(phase: ControlledOneStepAgentLoopState["phase"]): string {
  if (phase === "completed") return "completed";
  if (phase === "stopped") return "stopped";
  if (phase === "failed") return "failed";
  if (phase === "idle") return "ready";
  return "running";
}

function controlledReportEvidenceSummary(phase: ControlledOneStepAgentLoopState["phase"] | undefined, repairState: ControlledAgentRepairLoopEvaluation["state"] | undefined): string {
  if (phase === "completed") return "Controlled one-step run completed with sanitized metadata.";
  if (phase === "stopped") return "Controlled one-step run stopped after explicit user boundary.";
  if (phase === "failed") return "Controlled one-step run failed closed with sanitized metadata.";
  if (phase) return "Controlled one-step run is active with bounded metadata.";
  if (repairState === "eligible" || repairState === "proposal_ready") return "Controlled repair metadata is available after failed verification.";
  return "Controlled dev-preview prerequisites are blocked or unavailable.";
}

function buildControlledRecoveryGuidance(host: BridgeHost, oneStepPhase: ControlledOneStepAgentLoopState["phase"] | undefined, repairState: ControlledAgentRepairLoopEvaluation["state"] | undefined, agentRunState: string): ControlledAgentRecoveryEvaluation[] {
  const states = new Set<ControlledAgentRecoveryVisibleState>(["stale_duplicate_result", "host_disconnect_runtime_restart", "provider_timeout", "edit_hash_mismatch", "verification_bundle_failure", "checkpoint_rollback_review"]);
  if (oneStepPhase === "stopped") states.add("stop_completed");
  if (oneStepPhase === "failed" || agentRunState === "verification_failed") states.add("verification_bundle_failure");
  if (repairState === "exhausted") states.add("repair_followup_exhausted");
  if (host !== "vscode") states.add("unsupported_host");
  return [...states].map((userVisibleState) => evaluateControlledAgentRecoveryMatrix({
    userVisibleState,
    host,
    terminal: userVisibleState === "stop_completed" || userVisibleState === "repair_followup_exhausted" || userVisibleState === "unsupported_host",
    attemptBudget: recoveryAttemptBudget(userVisibleState),
    privacy: { sanitizedOnly: true, rawOutputStored: false, privatePathStored: false, secretStored: false },
    policyFlags: { hiddenRetryAllowed: false, automaticRollbackAllowed: false, hiddenRepairAllowed: false, staleResultAccepted: false, rawOutputPersistenceAllowed: false, privatePathPersistenceAllowed: false, secretPersistenceAllowed: false, unboundedRepairAllowed: false, unsupportedHostClaimsSupport: false },
  }));
}

function recoveryAttemptBudget(userVisibleState: ControlledAgentRecoveryVisibleState) {
  const retryable = userVisibleState === "host_disconnect_runtime_restart" || userVisibleState === "provider_timeout" || userVisibleState === "verification_bundle_failure";
  return { maxAttempts: retryable ? 1 : 0, attemptsUsed: 0, moreAttemptsAllowed: retryable, requiresUserConfirmation: true };
}

function ControlledRecoveryGuidanceCard({ title, guidance }: { title: string; guidance: ControlledAgentRecoveryEvaluation[] }) {
  return (
    <section className="readiness-card warn stack" role="status" aria-label={title}>
      <div className="row">
        <strong>{title}</strong>
        <span className="badge">display only</span>
        <span className="badge">manual recovery</span>
        <span className="badge">no auto retry/rollback/repair</span>
      </div>
      <span>Visible, bounded, sanitized, manual recovery guidance. Browser remains unsupported; JetBrains remains partial/fail-closed.</span>
      <div className="agent-progress-grid" aria-label={`${title} authority`}>
        <span>Execution allowed: false</span>
        <span>Workspace mutation: false</span>
        <span>Provider calls: false</span>
        <span>Commands/tools/git/network: false</span>
        <span>Raw output/private paths/secrets persisted: false</span>
      </div>
      {guidance.map((item) => (
        <span key={item.userVisibleState ?? item.guidance}><strong>{sanitizeDisplayText((item.userVisibleState ?? "blocked").replace(/_/g, " "))}</strong>: {sanitizeDisplayText(item.guidance)}</span>
      ))}
    </section>
  );
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

function controlledSearchSelectionUnsafeCount(selection: ControlledAgentSearchSelectionResult | undefined): number {
  if (!selection || selection.state === "ready") {
    return 0;
  }
  return selection.diagnostics.filter((item) => item.code === "unsafe_metadata" || item.code === "stale_result").length;
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

function isTerminalControlledVerificationStatus(status: ControlledAgentVerificationBundleEvaluation["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "timed_out" || status === "killed" || status === "blocked";
}

function twoStepRunManualGateCopy(state: ControlledAgentTwoStepRunState): string {
  if (state.phase === "planning_requested") return "Planning was requested by the user; sanitized plan evidence must be reviewed before execution can be requested.";
  if (state.phase === "waiting_for_user_review") return "Planning complete; waiting for explicit user review before any execution request.";
  if (state.phase === "execution_requested") return "Execution was separately requested by the user; apply outcome is still staged evidence, not automatic verification.";
  if (state.phase === "applying_edits") return "Apply outcome metadata is visible; allowlisted verification still needs its own explicit user gate.";
  if (state.phase === "running_verification_bundle") return "Verification was separately requested by the user; follow-up remains manual review only.";
  if (state.phase === "followup_ready") return "A sanitized follow-up is ready for manual review; the panel does not send it.";
  if (state.phase === "completed") return "Planning, review, execution, apply, and verification evidence are complete after explicit user gates.";
  if (state.phase === "failed") return "Unsafe, missing, stale, duplicate, or failed metadata blocked the two-step run safely.";
  if (state.phase === "stopped") return "The two-step run stopped after an explicit user or policy stop signal.";
  return "Two-step run is idle until the user explicitly requests planning.";
}
