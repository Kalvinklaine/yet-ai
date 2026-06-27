import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunPanel } from "./AgentRunPanel";
import type { AgentRunInput } from "../services/agentRunState";
import type { VerificationCommandId } from "../bridge/bridgeAdapter";
import { createProposalHistory, type ProposalHistory } from "../services/proposalHistory";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const baseLoop = {
  kind: "bounded_patch_verification_loop",
  version: "2026-06-21",
  authority: "metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  status: "ready_for_apply",
  loopId: "guiAgentRunLoop",
  sandbox: { modeStatus: "checkpoint_ready", checkpointId: "checkpoint-1", checkpointVerified: true, checkpointHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
  limits: { maxTouchedFiles: 4, maxPatchBytes: 50000, maxSteps: 16, maxVerificationSeconds: 1800 },
  patch: { proposalId: "proposal-1", source: "gui_review", touchedFiles: ["src/example.ts"], editCount: 1, patchBytes: 12, contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000", summary: "Small safe proposal" },
  policy: { decision: "ready_for_user_apply", requiresUserConfirmation: true, reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only"] },
  verification: { commandId: "repository-check", status: "not_requested" },
  summary: "Ready for explicit apply.",
};

const verificationLoop = {
  ...baseLoop,
  status: "ready_for_verification",
  policy: { decision: "ready_for_user_verification", requiresUserConfirmation: true, reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "user_apply_result_recorded"] },
  verification: { commandId: "repository-check", status: "ready" },
  summary: "Ready for explicit verification.",
};

const verifiedLoop = {
  ...baseLoop,
  status: "verified",
  policy: { decision: "completed", requiresUserConfirmation: true, reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "user_apply_result_recorded"] },
  verification: { commandId: "repository-check", status: "succeeded", result: { exitCode: 0, durationMs: 10, outputTail: "passed", truncated: false, resultHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" } },
  summary: "Verification succeeded.",
};

const failedVerificationLoop = {
  ...verificationLoop,
  status: "verification_failed",
  verification: { commandId: "repository-check", status: "failed", result: { exitCode: 1, durationMs: 10, outputTail: "failed", truncated: false, resultHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" } },
  summary: "Verification failed.",
};

const proposalHistory = createProposalHistory([
  { id: "proposal-1", source: "assistant", kind: "original", summary: "Small safe proposal", touchedFiles: ["src/example.ts"] },
]);

const checkpointReadinessState = {
  kind: "agent_run_checkpoint_rollback_state" as const,
  displayState: "checkpoint_readiness",
  checkpoint: { status: "ready", label: "Checkpoint readiness confirmed" },
  rollbackAction: { trigger: "user", owner: "host", automatic: false, label: "Rollback stays a user action" },
  summary: "Checkpoint prerequisites are ready for display",
};

const rollbackBlockedState = {
  ...checkpointReadinessState,
  displayState: "rollback_blocked",
  checkpoint: { status: "verified", label: "Checkpoint metadata verified" },
  rollback: { status: "blocked", label: "Rollback blocked pending host review" },
  rollbackAction: { trigger: "user", owner: "host", automatic: false, label: "User action required after host review" },
  summary: "Rollback is blocked and shown as status only",
};

const rollbackFailedState = {
  ...checkpointReadinessState,
  displayState: "rollback_failed",
  checkpoint: { status: "verified", label: "Checkpoint metadata still available" },
  rollback: { status: "failed", label: "Rollback failed with sanitized status" },
  rollbackAction: { trigger: "user", owner: "host", automatic: false, label: "User can review host guidance" },
  summary: "Rollback failure is display metadata only",
};

const rollbackCompletedState = {
  ...checkpointReadinessState,
  displayState: "rollback_completed",
  checkpoint: { status: "verified", label: "Checkpoint restored by host" },
  rollback: { status: "completed", label: "Restore completed after user request" },
  rollbackAction: { trigger: "user", owner: "host", automatic: false, label: "Completed rollback was user triggered" },
  summary: "Rollback completion is reported with sanitized status",
};

const readyInput: AgentRunInput = {
  goal: { id: "goal-1", title: "Add safe panel", summary: "Add safe panel" },
  proposal: { id: "proposal-1", summary: "Small safe proposal", touchedFiles: ["src/example.ts"] },
  boundedLoop: baseLoop,
};

const readyInputWithPlanMetadata: AgentRunInput = {
  ...readyInput,
  proposal: {
    ...readyInput.proposal,
    planSummary: "Update the visible status label for manual review.",
    planSteps: ["Review the visible proposal", "Apply only after user confirmation"],
    risks: ["Copy may need follow-up review"],
    verificationSuggestions: ["GUI app tests (gui-app-tests)"],
  },
};
const readyInputWithInertPlanPreview: AgentRunInput = {
  goal: { id: "goal-1", title: "Preview a safe multi-step plan", summary: "Preview a safe multi-step plan" },
  planPreview: {
    title: "Review settings panel plan",
    summary: "Preview the plan before any manual future action.",
    steps: ["Inspect current panel: Review labels only", "Update tests later: User must request edits explicitly"],
    risks: ["Copy may need owner review"],
    expectedTouchedFiles: ["apps/gui/src/components/AgentRunPanel.tsx", "apps/gui/src/App.test.tsx"],
    verificationSuggestions: ["GUI app tests (gui-app-tests)"],
  },
};

const readyInputWithRejectedPlan: AgentRunInput = {
  goal: { id: "goal-1", title: "Preview rejected plan", summary: "Preview rejected plan" },
  planDiagnostics: ["unsafe_metadata: The multi-step plan preview contains assistant-minted authority or execution metadata."],
};


afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  localStorage.clear();
  sessionStorage.clear();
});

describe("AgentRunPanel", () => {
  it("renders idle state", () => {
    renderPanel(undefined);

    expect(panelText()).toContain("Agent Run · dev-preview, not autonomy");
    expect(panelText()).toContain("no hidden model/provider calls; manual");
    expect(panelText()).toContain("Manual state: idle");
    expect(panelText()).toContain("Goal summary: No local goal selected");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
    expect(findButton("Manually review rollback").disabled).toBe(true);
  });

  it("renders goal ready state before a proposal", () => {
    renderPanel({ goal: { id: "goal-1", title: "Add safe panel" } }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Goal ready");
    expect(panelText()).toContain("Goal ready, but no safe proposal is available yet. Recovery: add explicit context if needed, confirm provider readiness in Chat readiness, then send or draft a model proposal manually.");
    expect(panelText()).toContain("Attach context if needed, confirm provider readiness, then manually draft/send a safe-edit proposal request.");
    expect(panelText()).toContain("Proposal status: not detected");
    expect(panelText()).toContain("Checkpoint status: missing");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
  });

  it("renders proposal detected with missing checkpoint prerequisites", () => {
    renderPanel({ goal: readyInput.goal, proposal: readyInput.proposal }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Checkpoint required");
    expect(panelText()).toContain("Safe proposal detected, but checkpoint readiness metadata is missing. Recovery: refresh runtime/checkpoint readiness, then review again before any manual apply.");
    expect(panelText()).toContain("Checkpoint metadata is not ready. Refresh runtime/checkpoint readiness; apply remains disabled until verified metadata arrives.");
    expect(panelText()).toContain("Proposal status: detected but checkpoint metadata is missing");
    expect(panelText()).toContain("Checkpoint status: missing");
    expect(panelText()).toContain("Policy decision: missing");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
  });

  it("renders prerequisites blocked state", () => {
    renderPanel({
      ...readyInput,
      boundedLoop: {
        ...baseLoop,
        status: "blocked",
        sandbox: { ...baseLoop.sandbox, modeStatus: "blocked", checkpointVerified: false },
        policy: { decision: "blocked", requiresUserConfirmation: true, reasonCodes: ["explicit_user_confirmation_required", "blocked_by_policy"], blockReason: "Checkpoint is not ready." },
      },
    }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Checkpoint required");
    expect(panelText()).toContain("Checkpoint or policy is not ready. Recovery: resolve checkpoint/policy readiness first; manual apply stays disabled until runtime metadata is ready.");
    expect(panelText()).toContain("Checkpoint or policy blocked this proposal. Fix readiness metadata or request a new safe proposal; no workspace change was posted.");
    expect(panelText()).toContain("Checkpoint status: not verified");
    expect(panelText()).toContain("Policy decision: blocked");
    expect(panelText()).toContain("Checkpoint/policy readiness: not verified · blocked");
    expect(panelText()).toContain("Safety diagnostics");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
  });

  it("renders ready-for-apply state", () => {
    renderPanel(readyInput, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Ready for manual apply");
    expect(panelText()).toContain("Goal summary: Add safe panel");
    expect(panelText()).toContain("Ready for manual apply. Review the proposal and click Manually apply reviewed patch only when you choose to continue.");
    expect(panelText()).toContain("Review the sanitized proposal summary; apply only if you choose to continue.");
    expect(panelText()).toContain("Proposal status: detected with verified checkpoint metadata");
    expect(panelText()).toContain("Checkpoint status: verified");
    expect(panelText()).toContain("Policy decision: ready_for_user_apply");
    expect(panelText()).toContain("Verification command id: repository-check");
    expect(panelText()).toContain("Touched files: 1");
    expect(panelText()).toContain("Edit count: 1");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(false);
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
  });

  it("renders checkpoint readiness and rollback states as display-only status", () => {
    renderPanel({ ...readyInput, checkpointRollbackState: checkpointReadinessState }, { host: "vscode" });

    expect(panelText()).toContain("Checkpoint and rollback readiness");
    expect(panelText()).toContain("Checkpoint prerequisites are ready for display");
    expect(panelText()).toContain("Checkpoint: Checkpoint readiness confirmed");
    expect(panelText()).toContain("Rollback: not available");
    expect(panelText()).toContain("No automatic rollback or workspace mutation starts from this panel.");
    expect(findButton("Manually review rollback").disabled).toBe(true);

    renderPanel({ ...readyInput, checkpointRollbackState: rollbackBlockedState }, { host: "vscode" });

    expect(panelText()).toContain("Rollback is blocked and shown as status only");
    expect(panelText()).toContain("Checkpoint: Checkpoint metadata verified");
    expect(panelText()).toContain("Rollback: Rollback blocked pending host review");
    expect(panelText()).toContain("Recovery: resolve host checkpoint guidance first; the rollback button stays review-only and does not mutate the workspace.");
    expect(findButton("Manually review rollback").disabled).toBe(true);

    renderPanel({ ...readyInput, checkpointRollbackState: rollbackFailedState }, { host: "vscode" });

    expect(panelText()).toContain("Rollback failure is display metadata only");
    expect(panelText()).toContain("Rollback: Rollback failed with sanitized status");
    expect(panelText()).toContain("Recovery: review host guidance and existing checkpoint surfaces, then decide the next manual step; nothing retries or repairs itself.");
    expect(findButton("Manually review rollback").disabled).toBe(true);

    renderPanel({ ...readyInput, checkpointRollbackState: rollbackCompletedState }, { host: "vscode" });

    expect(panelText()).toContain("Rollback completion is reported with sanitized status");
    expect(panelText()).toContain("Checkpoint: Checkpoint restored by host");
    expect(panelText()).toContain("Rollback: Restore completed after user request");
    expect(panelText()).toContain("Recovery: review the sanitized completion status before drafting follow-up work.");
    expect(findButton("Manually review rollback").disabled).toBe(true);
  });

  it("renders restore review availability without automatic workspace restore", () => {
    const onReviewRollback = vi.fn();
    renderPanel({
      ...readyInput,
      applyResult: { status: "failed", summary: "Apply failed.", appliedFileCount: 0 },
      rollback: { available: true, summary: "Rollback review available." },
      checkpointRollbackState: {
        ...checkpointReadinessState,
        displayState: "rollback_available",
        checkpoint: { status: "verified", label: "Checkpoint verified by host" },
        rollback: { status: "available", label: "Restore option shown after user review" },
        rollbackAction: { trigger: "user", owner: "host", automatic: false, label: "User may request host rollback" },
        summary: "Restore option is shown but not automatic",
      },
    }, { host: "vscode", onReviewRollback });

    expect(panelText()).toContain("Rollback availability: available for review");
    expect(panelText()).toContain("Restore option is shown but not automatic");
    expect(panelText()).toContain("Recovery: use the existing manual rollback review path only if you choose; this panel posts no rollback request by itself.");
    expect(onReviewRollback).not.toHaveBeenCalled();
    act(() => {
      findButton("Manually review rollback").click();
    });
    expect(onReviewRollback).toHaveBeenCalledTimes(1);
  });

  it("renders sanitized plan-to-patch metadata as display-only review context", () => {
    renderPanel(readyInputWithPlanMetadata, { host: "vscode" });

    expect(panelText()).toContain("Proposal review metadata");
    expect(panelText()).toContain("Plan summary: Update the visible status label for manual review.");
    expect(panelText()).toContain("Plan: Review the visible proposal · Apply only after user confirmation");
    expect(panelText()).toContain("Risks: Copy may need follow-up review");
    expect(panelText()).toContain("Verification suggestions (display-only command IDs): GUI app tests (gui-app-tests)");
  });

  it("renders valid inert multi-step plan preview without granting readiness", () => {
    const onApply = vi.fn();
    const onVerify = vi.fn();
    renderPanel(readyInputWithInertPlanPreview, { host: "vscode", onApplyReviewedPatch: onApply, onRunAllowlistedVerification: onVerify });

    expect(panelText()).toContain("Multi-step plan preview · Review only");
    expect(panelText()).toContain("inert");
    expect(panelText()).toContain("metadata only");
    expect(panelText()).toContain("This plan preview cannot send chat, apply edits, run verification, read files, call providers, or mutate the workspace. Future send, apply, and verification remain explicit user actions.");
    expect(panelText()).toContain("Title: Review settings panel plan");
    expect(panelText()).toContain("Steps: Inspect current panel: Review labels only · Update tests later: User must request edits explicitly");
    expect(panelText()).toContain("Expected file labels: apps/gui/src/components/AgentRunPanel.tsx · apps/gui/src/App.test.tsx");
    expect(panelText()).toContain("Verification suggestions (display-only command IDs): GUI app tests (gui-app-tests)");
    expect(panelText()).toContain("Manual state: Goal ready");
    expect(panelText()).toContain("Proposal status: not detected");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("renders rejected unsafe plan diagnostics without readiness", () => {
    renderPanel(readyInputWithRejectedPlan, { host: "vscode" });

    expect(panelText()).toContain("Rejected multi-step plan preview");
    expect(panelText()).toContain("Unsafe or malformed plan preview metadata was rejected. No apply, verification, read, send, or readiness state was created.");
    expect(panelText()).toContain("unsafe_metadata: The multi-step plan preview contains assistant-minted authority or execution metadata.");
    expect(panelText()).toContain("Manual state: Goal ready");
    expect(panelText()).toContain("Proposal status: not detected");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
  });

  it("does not call bridge callbacks before click and applies only after explicit click", () => {
    const onApply = vi.fn();
    renderPanel(readyInput, { host: "vscode", onApplyReviewedPatch: onApply });

    expect(onApply).not.toHaveBeenCalled();
    act(() => {
      findButton("Manually apply reviewed patch").click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("runs verification only after explicit click with commandId-only payload", () => {
    const onVerify = vi.fn();
    renderPanel({
      ...readyInput,
      applyRequest: { requested: true, source: "user", requestId: "apply-1" },
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      boundedLoop: verificationLoop,
    }, { host: "vscode", onRunAllowlistedVerification: onVerify });

    expect(onVerify).not.toHaveBeenCalled();
    act(() => {
      findButton("Manually run allowlisted verification").click();
    });

    expect(onVerify).toHaveBeenCalledWith("repository-check");
    expect(JSON.stringify({ action: "runVerificationCommand", commandId: onVerify.mock.calls[0]?.[0] })).toBe("{\"action\":\"runVerificationCommand\",\"commandId\":\"repository-check\"}");
  });

  it("renders pending, verification, and terminal dogfood state labels", () => {
    renderPanel({
      ...readyInput,
      applyRequest: { requested: true, source: "user", requestId: "apply-1" },
    }, { host: "vscode", pendingApply: true });

    expect(panelText()).toContain("Manual state: Apply pending");
    expect(panelText()).toContain("Apply pending. Wait for the host apply result; duplicate manual apply requests stay disabled.");
    expect(panelText()).toContain("Apply status: manual apply pending");

    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      boundedLoop: verificationLoop,
    }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Ready for manual verification");
    expect(panelText()).toContain("Ready for manual verification. Click Manually run allowlisted verification when you choose to run the selected command id.");

    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationRequest: { requested: true, source: "user", requestId: "verify-1" },
      verificationProgress: { status: "running", summary: "Running repository check." },
      boundedLoop: verificationLoop,
    }, { host: "vscode", pendingVerification: true });

    expect(panelText()).toContain("Manual state: Verification running");
    expect(panelText()).toContain("Verification status/result: Verification running");

    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "succeeded", exitCode: 0, outputTail: "passed" },
      boundedLoop: verifiedLoop,
    }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Ready for follow-up");
    expect(panelText()).toContain("Review the sanitized verification result, then manually draft a follow-up or close the run.");
    expect(panelText()).toContain("Verification status/result: Verified · exit 0 · sanitized result available");
    expect(panelText()).toContain("Manual follow-up draft available");
    expect(panelText()).toContain("review it, then click Send manually");
    expect(findButton("Draft Agent Run follow-up prompt").disabled).toBe(false);

    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "failed", exitCode: 1, outputTail: "failed" },
      boundedLoop: failedVerificationLoop,
    }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Verification failed");
    expect(panelText()).toContain("Verification failed. Recovery: review the sanitized result, then manually draft a follow-up or review rollback; no automatic repair is started.");
    expect(panelText()).toContain("Review the sanitized verification failure, then manually draft a fix follow-up or review rollback. Nothing repairs itself, how polite.");
    expect(panelText()).toContain("Verification status/result: Verification failed · exit 1 · sanitized result available");
    expect(panelText()).toContain("Manual fix draft available");
    expect(panelText()).toContain("Manual guided fix");
    expect(panelText()).toContain("fix draft available");
    expect(panelText()).toContain("Draft a fix prompt for manual review only.");
    expect(panelText()).toContain("Review first; the user must click Send manually.");
    expect(findButton("Draft Agent Run fix prompt").disabled).toBe(false);
  });

  it("renders no-fix and blocked guided-fix states without a fix CTA", () => {
    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "succeeded", exitCode: 0, outputTail: "passed" },
      boundedLoop: verifiedLoop,
    }, { host: "vscode" });

    expect(panelText()).toContain("Manual guided fix");
    expect(panelText()).toContain("no fix needed");
    expect(panelText()).toContain("Verification succeeded; no guided fix is needed.");
    expect(optionalButton("Draft Agent Run fix prompt")).toBeUndefined();

    renderPanel({
      ...readyInput,
      proposal: undefined,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "failed", exitCode: 1, outputTail: "failed" },
      boundedLoop: failedVerificationLoop,
    }, { host: "vscode", proposalHistory: createProposalHistory([]) });

    expect(panelText()).toContain("Manual guided fix");
    expect(panelText()).toContain("blocked");
    expect(panelText()).toContain("Failed verification has no prior safe proposal metadata.");
    expect(optionalButton("Draft Agent Run fix prompt")).toBeUndefined();
  });

  it("renders guided-fix draft-only and correlated proposal labels without raw unsafe content", () => {
    const secret = "access_token=" + "s".repeat(64);
    const laterHistory = createProposalHistory([
      { id: "proposal-1", source: "assistant", kind: "original", summary: "Small safe proposal", touchedFiles: ["src/example.ts"] },
      { id: "proposal-2", source: "assistant-follow-up", kind: "follow_up", summary: "Follow-up proposal label", touchedFiles: ["src/example.ts"] },
    ]);
    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "failed", exitCode: 1, outputTail: "failed" },
      boundedLoop: failedVerificationLoop,
    }, { host: "vscode", proposalHistory: laterHistory });

    expect(panelText()).toContain("Manual guided fix");
    expect(panelText()).toContain("new proposal detected");
    expect(panelText()).toContain("latest proposal proposal-2");
    expect(panelText()).toContain("Follow-up proposal label");
    expect(panelText()).toContain("Draft only: this panel never sends chat, applies edits, runs verification, retries, repairs, rolls back, attaches context, saves memory, or changes the workspace.");
    expect(optionalButton("Draft Agent Run fix prompt")).toBeUndefined();
    expect(panelText()).not.toContain(secret);
    expect(panelText()).not.toContain("/Users/alice");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("draft follow-up CTAs call only explicit draft callbacks", () => {
    const onDraftVerificationFollowup = vi.fn();
    const onDraftVerificationFix = vi.fn();
    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "succeeded", exitCode: 0, outputTail: "passed" },
      boundedLoop: verifiedLoop,
    }, { host: "vscode", onDraftVerificationFollowup, onDraftVerificationFix });

    act(() => {
      findButton("Draft Agent Run follow-up prompt").click();
    });

    expect(onDraftVerificationFollowup).toHaveBeenCalledTimes(1);
    expect(onDraftVerificationFix).not.toHaveBeenCalled();

    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "failed", exitCode: 1, outputTail: "failed" },
      boundedLoop: failedVerificationLoop,
    }, { host: "vscode", onDraftVerificationFollowup, onDraftVerificationFix });

    act(() => {
      findButton("Draft Agent Run fix prompt").click();
    });

    expect(onDraftVerificationFollowup).toHaveBeenCalledTimes(1);
    expect(onDraftVerificationFix).toHaveBeenCalledTimes(1);
  });

  it("does not persist run internals or expose raw unsafe data", () => {
    const secret = "sk-" + "x".repeat(40);
    renderPanel({
      goal: { title: `Do not show ${secret}` },
      proposal: { summary: "Unsafe", touchedFiles: ["/Users/alice/private.ts"] },
      boundedLoop: { rawCommand: "npm test", cwd: "/Users/alice/project", apiKey: secret },
    });

    const text = panelText();
    expect(text).toContain("[redacted]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("npm test");
    expect(browserStorageDump()).not.toContain(secret);
    expect(browserStorageDump()).not.toContain("rawCommand");
  });
});

type PanelTestProps = {
  host?: "browser" | "vscode" | "jetbrains";
  pendingApply?: boolean;
  pendingVerification?: boolean;
  onApplyReviewedPatch?: () => void;
  onRunAllowlistedVerification?: (commandId: VerificationCommandId) => void;
  onReviewRollback?: () => void;
  onDraftVerificationFollowup?: () => void;
  onDraftVerificationFix?: () => void;
  proposalHistory?: ProposalHistory;
};

function renderPanel(input: unknown, props: PanelTestProps = {}) {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AgentRunPanel
        input={input}
        host={props.host ?? "browser"}
        pendingApply={props.pendingApply ?? false}
        pendingVerification={props.pendingVerification ?? false}
        onApplyReviewedPatch={props.onApplyReviewedPatch ?? vi.fn()}
        onRunAllowlistedVerification={props.onRunAllowlistedVerification ?? vi.fn()}
        onReviewRollback={props.onReviewRollback ?? vi.fn()}
        onDraftVerificationFollowup={props.onDraftVerificationFollowup ?? vi.fn()}
        onDraftVerificationFix={props.onDraftVerificationFix ?? vi.fn()}
        proposalHistory={props.proposalHistory ?? proposalHistory}
      />,
    );
  });
}

function panelText() {
  return container?.textContent ?? "";
}

function findButton(name: string) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((item) => item.textContent === name);
  if (!button) {
    throw new Error(`Button not found: ${name}`);
  }
  return button;
}

function optionalButton(name: string) {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((item) => item.textContent === name);
}

function browserStorageDump() {
  const values: string[] = [];
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) {
        values.push(key, storage.getItem(key) ?? "");
      }
    }
  }
  return values.join("\n");
}
