import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunPanel } from "./AgentRunPanel";
import type { AgentRunInput } from "../services/agentRunState";
import type { VerificationCommandId } from "../bridge/bridgeAdapter";
import { createProposalHistory, type ProposalHistory } from "../services/proposalHistory";
import { evaluateControlledAgentRepairLoop } from "../services/controlledAgentRepairLoop";
import { createControlledRunHistoryItem } from "../services/controlledRunHistory";
import { evaluateControlledAgentMultifilePatchPlan } from "../services/controlledAgentMultifilePatchPlan";
import { evaluateControlledAgentTwoStepRun } from "../services/controlledAgentTwoStepRun";
import twoStepCompletedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-two-step-run-completed.json";
import { controlledAgentSearchSelectionResultId, createControlledAgentSearchSelection } from "../services/controlledAgentSearchSelection";
import type { ControlledAgentLexicalSearchSnippet, ControlledAgentLexicalSearchSummary } from "../services/controlledAgentLexicalSearch";
import { controlledAgentTaskPresets } from "../services/controlledAgentTaskPresets";
import plannedVerificationBundle from "../../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-planned.json";
import succeededVerificationBundle from "../../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-succeeded.json";
import { buildControlledAgentVerificationBundleRequest, evaluateControlledAgentVerificationBundle } from "../services/controlledAgentVerificationBundle";
import { evaluateControlledAgentTaskHarness } from "../services/controlledAgentTaskHarness";
import taskHarnessHappyFixture from "../../../../packages/contracts/examples/engine/controlled-agent-task-harness-vscode-happy-path.json";

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

const idleOneStepLoop = {
  phase: "idle",
  authority: "one_step_loop_metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  agentStartAllowed: false,
  autoStartAllowed: false,
  canReadFiles: false,
  canWriteFiles: false,
  canRunCommands: false,
  canApplyEdits: false,
  canCallProvider: false,
  canUseGit: false,
  canUseNetwork: false,
  canUseTools: false,
  canInstallPackages: false,
  canRepair: false,
  enabled: false,
  stopped: false,
  budgets: { maxLoopSteps: 1, maxFileReads: 1, maxReadBytes: 8192, maxTouchedFiles: 1, maxEditBytes: 12000, maxVerificationRuns: 1, maxRuntimeSeconds: 300, maxRepairAttempts: 0 },
  counters: { loopSteps: 0, fileReads: 0, readBytes: 0, filesTouched: 0, editBytes: 0, verificationRuns: 0, runtimeSeconds: 0, userTurns: 0, repairAttempts: 0 },
  summary: "One-step controlled loop is idle until explicit user start.",
  diagnostics: [],
  details: {},
} as const;

const activeOneStepLoop = {
  ...idleOneStepLoop,
  phase: "read_context",
  enabled: true,
  summary: "Bounded read completed.",
  counters: { ...idleOneStepLoop.counters, fileReads: 1, readBytes: 120 },
} as const;

const completedOneStepLoop = {
  ...activeOneStepLoop,
  phase: "completed",
  summary: "One-step controlled loop completed.",
  counters: { ...activeOneStepLoop.counters, loopSteps: 1, filesTouched: 1, verificationRuns: 1 },
} as const;

const stoppedOneStepLoop = {
  ...activeOneStepLoop,
  phase: "stopped",
  summary: "One-step controlled loop stopped.",
  stop: { reason: "user_stop", recoverable: true, message: "Stopped after explicit user request." },
} as const;

const failedOneStepLoop = {
  ...activeOneStepLoop,
  phase: "failed",
  summary: "One-step controlled loop failed closed.",
} as const;

const readyOneStepRequest = { state: "ready", diagnostics: [], details: {}, authority: {} } as any;
const blockedOneStepRequest = { state: "blocked", diagnostics: [{ code: "blocked", message: "not ready" }], details: {}, authority: {} } as any;
const capabilityMatrixFixture = {
  allowedToExecute: false,
  hostLabel: "VS Code host",
  supportLabel: "Controlled dev-preview path ready",
  statusLabels: ["Start: supported metadata only", "Read: supported metadata only", "Edit: supported metadata only", "Verification: supported metadata only", "Repair: unsupported fail-closed"],
  correlationLabels: ["Requires request id"],
  limitLabels: ["maxReadBytes: 8192"],
  reasonLabels: ["Reason metadata only"],
  authorityLabels: ["Metadata only"],
  summary: "Display evidence only.",
} as const;

const searchHash = `sha256:${"a".repeat(64)}`;

function twoStepFixture(overrides: Record<string, unknown> = {}) {
  return { ...(JSON.parse(JSON.stringify(twoStepCompletedFixture)) as Record<string, unknown>), ...overrides };
}

function lexicalSnippet(overrides: Partial<ControlledAgentLexicalSearchSnippet> = {}): ControlledAgentLexicalSearchSnippet {
  const snippet = overrides.snippet ?? "function ChatComposer() {\n  return null;\n}";
  return {
    pathLabel: "apps/gui/src/App.tsx",
    range: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } },
    languageId: "typescriptreact",
    snippet,
    snippetByteCount: new TextEncoder().encode(snippet).length,
    snippetHash: searchHash,
    matchCount: 1,
    truncated: false,
    ...overrides,
  };
}

function lexicalSearch(snippets: ControlledAgentLexicalSearchSnippet[] = [lexicalSnippet()]): ControlledAgentLexicalSearchSummary {
  return {
    status: "succeeded",
    resultCount: snippets.length,
    totalMatchCount: snippets.reduce((total, item) => total + item.matchCount, 0),
    totalSnippetBytes: snippets.reduce((total, item) => total + item.snippetByteCount, 0),
    truncated: false,
    resultHash: `sha256:${"b".repeat(64)}`,
    snippets,
    message: "Sanitized lexical search completed.",
  };
}

function multifilePatchPlan(overrides: Record<string, unknown> = {}) {
  return {
    kind: "controlled_agent_multifile_patch_plan",
    version: "2026-07-07",
    authority: "review_only_multifile_replacement_metadata",
    cloudRequired: false,
    reviewOnly: true,
    applyAuthority: { automaticApplyAllowed: false, assistantMintedApplyAllowed: false, requiresFutureExplicitHostApply: true, modelMintedApplyAuthorityAllowed: false },
    workspace: { controlledWorkspaceId: "controlled-workspace-s115", runId: "controlled-run-s115", workspaceMode: "worktree", host: "vscode", privatePathExposed: false, workspaceLabel: "controlled worktree" },
    limits: { maxFiles: 3, maxEdits: 6, maxReplacementBytesPerEdit: 800, maxTotalReplacementBytes: 1600 },
    plan: {
      planId: "multifile-plan-s115",
      status: "review_pending",
      summary: "Two bounded text replacements are ready for user review.",
      fileCount: 2,
      editCount: 2,
      totalReplacementBytes: 220,
      files: [
        { workspaceRelativePath: "apps/gui/src/SafePanel.tsx", fileLabel: "apps/gui/src/SafePanel.tsx", existingTextFileRequired: true, expectedPreEditHash: `sha256:${"a".repeat(64)}`, fileSummary: "Adjusts a small display label for review.", riskLabel: "low", edits: [{ editId: "edit-s115-1", operation: "replace", range: { startLine: 12, endLine: 14 }, expectedRangeHash: `sha256:${"b".repeat(64)}`, replacementByteCount: 120, replacementSummary: "Updates a bounded label branch.", rawReplacementIncluded: false, rawDiffIncluded: false }] },
        { workspaceRelativePath: "docs/architecture/safe-note.md", fileLabel: "docs/architecture/safe-note.md", existingTextFileRequired: true, expectedPreEditHash: `sha256:${"c".repeat(64)}`, fileSummary: "Refreshes a short architecture note.", riskLabel: "medium", edits: [{ editId: "edit-s115-2", operation: "replace", range: { startLine: 20, endLine: 22 }, expectedRangeHash: `sha256:${"d".repeat(64)}`, replacementByteCount: 100, replacementSummary: "Updates a bounded note paragraph.", rawReplacementIncluded: false, rawDiffIncluded: false }] },
      ],
    },
    policyFlags: { metadataOnly: true, reviewOnly: true, existingFileReplacementOnly: true, rawReplacementBodiesAllowed: false, rawDiffsAllowed: false, rawBodiesInReportExportHistoryAllowed: false, createAllowed: false, deleteAllowed: false, renameAllowed: false, moveAllowed: false, chmodAllowed: false, binaryEditAllowed: false, symlinkEditAllowed: false, generatedFileEditAllowed: false, dependencyEditAllowed: false, hiddenPathEditAllowed: false, privatePathAllowed: false, assistantMintedApplyAllowed: false, modelMintedApplyAuthorityAllowed: false, automaticApplyAllowed: false, commandExecutionAllowed: false, providerToolCallingAllowed: false, localToolAuthorityAllowed: false, shellAllowed: false, gitAllowed: false, networkAllowed: false, packageInstallAllowed: false },
    ...overrides,
  };
}


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

const eligibleRepairLoop = evaluateControlledAgentRepairLoop({
  verification: { status: "failed", result: { status: "failed", exitCode: 1, message: "Failed allowlisted verification." } },
  summary: "Failed allowlisted verification is eligible for one bounded repair attempt.",
});

const proposalReadyRepairLoop = evaluateControlledAgentRepairLoop({
  verification: { status: "failed", result: { status: "failed", exitCode: 1, message: "Failed allowlisted verification." } },
  userConfirmed: true,
  proposal: { state: "planned", summary: "Sanitized repair draft ready." },
});

const blockedRepairLoop = evaluateControlledAgentRepairLoop({
  verification: { status: "succeeded", result: { status: "succeeded", exitCode: 0, message: "Passed." } },
});


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
  it("renders controlled task harness journey as metadata-only display evidence", () => {
    renderPanel(undefined, {
      host: "vscode",
      controlledTaskHarness: evaluateControlledAgentTaskHarness(taskHarnessHappyFixture),
    });

    expect(panelText()).toContain("Controlled task journey harness");
    expect(panelText()).toContain("Preset, context, search, proposal, patch-plan, apply, verification, follow-up, recovery, and final labels");
    expect(panelText()).toContain("Selected context: 3");
    expect(panelText()).toContain("Search queries: 1");
    expect(panelText()).toContain("Verification commands: 2");
    expect(panelText()).toContain("auto-send false");
    expect(panelText()).toContain("auto-apply false");
    expect(panelText()).toContain("auto-verify false");
    expect(actionButtonLabels()).not.toContain("Run controlled task harness");
    expect(browserStorageDump()).toBe("");
  });

  it("renders explicit controlled verification bundle review and posts only after click", () => {
    const onRequestControlledVerificationBundle = vi.fn();
    const bundle = evaluateControlledAgentVerificationBundle(plannedVerificationBundle);
    const request = buildControlledAgentVerificationBundleRequest({ host: "vscode", bundleMetadata: plannedVerificationBundle, userConfirmed: true });

    renderPanel(undefined, {
      host: "vscode",
      controlledVerificationBundle: bundle,
      controlledVerificationBundleRequest: request,
      onRequestControlledVerificationBundle,
    });

    expect(panelText()).toContain("Controlled verification bundle");
    expect(panelText()).toContain("fixed command ids only");
    expect(panelText()).toContain("Step 1: repository-check");
    expect(panelText()).toContain("Step 2: gui-app-tests");
    expect(panelText()).toContain("Step 3: engine-chat-tests");
    expect(panelText()).toContain("Raw output persisted/rendered: false");
    expect(onRequestControlledVerificationBundle).not.toHaveBeenCalled();

    act(() => {
      findButton("Run controlled verification bundle").click();
    });

    expect(onRequestControlledVerificationBundle).toHaveBeenCalledTimes(1);
    expect(browserStorageDump()).toBe("");
  });

  it("renders controlled verification bundle sanitized result and unsupported host copy", () => {
    const onRequestControlledVerificationBundle = vi.fn();
    const bundle = evaluateControlledAgentVerificationBundle(succeededVerificationBundle);
    const request = buildControlledAgentVerificationBundleRequest({ host: "jetbrains", bundleMetadata: plannedVerificationBundle, userConfirmed: true });

    renderPanel(undefined, {
      host: "jetbrains",
      controlledVerificationBundle: bundle,
      controlledVerificationBundleRequest: request,
      onRequestControlledVerificationBundle,
    });

    expect(panelText()).toContain("JetBrains verification bundle execution remains fail-closed");
    expect(panelText()).toContain("Status: succeeded");
    expect(panelText()).toContain("Step 1: repository-check");
    expect(panelText()).toContain("Sanitized summary tail: Repository check completed with bounded sanitized evidence.");
    expect(panelText()).toContain("Omitted unsafe output tails: 0");
    expect(findButton("Run controlled verification bundle").disabled).toBe(true);
    expect(onRequestControlledVerificationBundle).not.toHaveBeenCalled();
    expect(panelText()).not.toContain("/Users/");
    expect(panelText()).not.toContain("Authorization");
  });

  it("renders controlled verification follow-up CTAs as explicit draft-only actions", () => {
    const onDraftControlledVerificationFollowup = vi.fn();
    const onDraftControlledVerificationFix = vi.fn();
    const bundle = evaluateControlledAgentVerificationBundle(succeededVerificationBundle);

    renderPanel(undefined, {
      host: "vscode",
      controlledVerificationBundle: bundle,
      onDraftControlledVerificationFollowup,
      onDraftControlledVerificationFix,
    });

    expect(findButton("Draft sanitized verification follow-up").disabled).toBe(false);
    expect(findButton("Draft manual fix prompt").disabled).toBe(true);
    act(() => {
      findButton("Draft sanitized verification follow-up").click();
    });
    expect(onDraftControlledVerificationFollowup).toHaveBeenCalledTimes(1);
    expect(onDraftControlledVerificationFix).not.toHaveBeenCalled();
    expect(panelText()).toContain("Follow-up draft authority: not drafted");
  });

  it("renders failed verification manual fix draft without raw leakage or auto-actions", () => {
    const onDraftControlledVerificationFix = vi.fn();
    const failedBundleInput = JSON.parse(JSON.stringify(succeededVerificationBundle)) as Record<string, any>;
    failedBundleInput.bundle.commands[1].status = "failed";
    failedBundleInput.bundle.commands[1].exitCode = 1;
    failedBundleInput.bundle.commands[1].summary = "GUI app tests failed with bounded local evidence.";
    failedBundleInput.bundle.commands.push({ ...failedBundleInput.bundle.commands[1], stepId: "step-s117-engine", sequenceIndex: 2, commandId: "engine-chat-tests", status: "succeeded", exitCode: 0, resultHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333", outputTail: "Engine chat tests completed with bounded sanitized evidence.", summary: "Engine chat tests passed with local deterministic evidence." });
    failedBundleInput.bundle.requestedCommandCount = 3;
    failedBundleInput.bundle.summary = "One user approved check reported a bounded failure category.";
    failedBundleInput.aggregateResult.status = "failed";
    failedBundleInput.aggregateResult.failedCount = 1;
    failedBundleInput.aggregateResult.succeededCount = 1;
    failedBundleInput.aggregateResult.truncated = true;
    failedBundleInput.aggregateResult.commandCount = 3;
    const bundle = evaluateControlledAgentVerificationBundle(failedBundleInput);
    const draft = {
      kind: "controlled_agent_verification_followup",
      version: "2026-07-08",
      followupProposal: { title: "Draft manual fix prompt", promptSummary: "Prepare a manual fix prompt from sanitized failed verification metadata." },
      sourceBundle: { bundleId: "bundle-s117", aggregateStatus: "failed", failedCount: 1 },
    };

    renderPanel(undefined, {
      host: "vscode",
      controlledVerificationBundle: bundle,
      controlledVerificationFollowupDraft: draft,
      onDraftControlledVerificationFix,
    });

    expect(findButton("Draft manual fix prompt").disabled).toBe(false);
    expect(panelText()).toContain("Draft manual fix prompt");
    expect(panelText()).toContain("draft only");
    expect(panelText()).toContain("manual Send required");
    expect(panelText()).toContain("No auto-send, provider call, repair, apply, verify, bridge post");
    expect(panelText()).not.toContain("/Users/");
    expect(panelText()).not.toContain("Authorization");
    act(() => {
      findButton("Draft manual fix prompt").click();
    });
    expect(onDraftControlledVerificationFix).toHaveBeenCalledTimes(1);
  });

  it("renders task preset choices and generates user-reviewed draft guidance after explicit selection", () => {
    const onApplyReviewedPatch = vi.fn();
    const onRunAllowlistedVerification = vi.fn();
    const onRequestControlledSearch = vi.fn();
    const onRequestControlledMultifileApply = vi.fn();

    renderPanel({ goal: { id: "goal-1", title: "Fix flaky login copy" } }, {
      host: "vscode",
      controlledSearchRequestState: "ready",
      selectedControlledSearchResultIds: ["safe-search-result"],
      onApplyReviewedPatch,
      onRunAllowlistedVerification,
      onRequestControlledSearch,
      onRequestControlledMultifileApply,
    });

    expect(panelText()).toContain("Task presets · draft guidance only");

    expect(panelText()).toContain("Draft only; no hidden read/search/index");
    for (const preset of controlledAgentTaskPresets) {
      expect(optionalButton(preset.label)).toBeTruthy();
    }
    expect(panelText()).not.toContain("Fix small bug guidance draft");
    expect(onApplyReviewedPatch).not.toHaveBeenCalled();
    expect(onRunAllowlistedVerification).not.toHaveBeenCalled();
    expect(onRequestControlledSearch).not.toHaveBeenCalled();
    expect(onRequestControlledMultifileApply).not.toHaveBeenCalled();

    act(() => {
      findButton("Fix small bug").click();
    });

    expect(panelText()).toContain("Fix small bug guidance draft");
    expect(panelText()).toContain("Selected preset id: fix-small-bug");
    expect(panelText()).toContain("draft guidance only");
    expect(panelText()).toContain("auto-send false · auto-search false · auto-attach false · auto-apply false · auto-verification false");
    expect(panelText()).toContain("Fix small bug preset guidance");
    expect(panelText()).toContain("Fix flaky login copy");


    expect(panelText()).toContain("Preset intent");
    expect(onApplyReviewedPatch).not.toHaveBeenCalled();
    expect(onRunAllowlistedVerification).not.toHaveBeenCalled();
    expect(onRequestControlledSearch).not.toHaveBeenCalled();
    expect(onRequestControlledMultifileApply).not.toHaveBeenCalled();
    expect(browserStorageDump()).toBe("");
  });

  it("covers every task preset as inert guidance and keeps Browser and JetBrains limitation copy honest", () => {
    for (const host of ["browser", "jetbrains"] as const) {
      renderPanel(undefined, { host });

    expect(panelText()).toContain(host === "browser" ? "browser preview" : "JetBrains display-only");
      for (const preset of controlledAgentTaskPresets) {
        act(() => {
          findButton(preset.label).click();
        });
        expect(panelText()).toContain(`${preset.label} guidance draft`);
        expect(panelText()).toContain(`Selected preset id: ${preset.presetId}`);
        expect(panelText()).toContain("provider calls false · hidden reads false · free-form commands false");
      }
    }
  });

  it("renders controlled lexical search results and selects only after explicit user checkbox", () => {
    const search = lexicalSearch();
    const resultId = controlledAgentSearchSelectionResultId(search.snippets[0]);
    const onSelectionChange = vi.fn();
    const onRequestControlledSearch = vi.fn();

    renderPanel(undefined, {
      host: "vscode",
      controlledLexicalSearch: search,
      controlledSearchResultId: "lexical-result-s112",
      selectedControlledSearchResultIds: [],
      controlledSearchRequestState: "ready",
      onRequestControlledSearch,
      onControlledSearchResultSelectionChange: onSelectionChange,
    });

    expect(panelText()).toContain("Controlled lexical search results");
    expect(panelText()).toContain("explicit user-selected context only");
    expect(panelText()).toContain("Displayed safe results: 1");
    expect(panelText()).toContain("Selected safe results: 0");
    expect(panelText()).toContain("no auto attach/send/provider/apply/verify");
    expect(browserStorageDump()).toBe("");
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onRequestControlledSearch).not.toHaveBeenCalled();

    const checkbox = Array.from(container?.querySelectorAll<HTMLInputElement>("input[type='checkbox']") ?? []).find((item) => item.parentElement?.textContent?.includes(resultId));
    expect(checkbox).toBeDefined();
    act(() => {
      checkbox?.click();
    });
    expect(onSelectionChange).toHaveBeenCalledWith(resultId, true);
    expect(onRequestControlledSearch).not.toHaveBeenCalled();
  });

  it("shows selected controlled lexical search budget and unsafe omission diagnostics without raw persistence", () => {
    const search = lexicalSearch();
    const resultId = controlledAgentSearchSelectionResultId(search.snippets[0]);
    const selection = createControlledAgentSearchSelection({
      searchResultId: "lexical-result-s112",
      lexicalSearch: search,
      selectedResultIds: [resultId],
      explicitUserGesture: true,
      userGestureId: "gesture-s112-selection",
      selectionMintedBy: "user",
      assistantMinted: false,
    });

    renderPanel(undefined, {
      host: "vscode",
      controlledLexicalSearch: { ...search, resultCount: 2 },
      controlledSearchResultId: "lexical-result-s112",
      selectedControlledSearchResultIds: [resultId],
      controlledSearchSelection: selection,
    });

    expect(panelText()).toContain("Selected safe results: 1");
    expect(panelText()).toContain("Selected bytes: 42/1200");
    expect(panelText()).toContain("Selected lines: 3/80");
    expect(panelText()).toContain("Omitted unsafe/stale results: 1");
    expect(panelText()).not.toContain("Authorization: Bearer");
    expect(browserStorageDump()).toBe("");
  });

  it("keeps browser and JetBrains controlled lexical search selection fail-closed", () => {
    const search = lexicalSearch();
    renderPanel(undefined, {
      host: "browser",
      controlledLexicalSearch: search,
      controlledSearchRequestState: "unsupported",
      onControlledSearchResultSelectionChange: vi.fn(),
    });

    expect(panelText()).toContain("browser unsupported");
    expect(panelText()).toContain("Browser preview cannot run or select controlled lexical search results; no bridge request is posted.");
    expect(optionalButton("Request controlled lexical search")?.disabled).toBe(true);

    renderPanel(undefined, {
      host: "jetbrains",
      controlledLexicalSearch: search,
      controlledSearchRequestState: "unsupported",
      onControlledSearchResultSelectionChange: vi.fn(),
    });

    expect(panelText()).toContain("JetBrains fail-closed");
    expect(panelText()).toContain("JetBrains controlled lexical search selection is display-only and fail-closed until host parity is verified.");
    expect(optionalButton("Request controlled lexical search")?.disabled).toBe(true);
  });

  it("renders multi-file patch dry-run review metadata without apply authority or auto-action", () => {
    const onApplyReviewedPatch = vi.fn();
    const onRunAllowlistedVerification = vi.fn();
    const preview = evaluateControlledAgentMultifilePatchPlan(multifilePatchPlan());

    renderPanel(undefined, {
      host: "vscode",
      controlledMultifilePatchPlan: preview,
      onApplyReviewedPatch,
      onRunAllowlistedVerification,
    });

    expect(panelText()).toContain("Multi-file patch dry-run review");
    expect(panelText()).toContain("review only");
    expect(panelText()).toContain("no multi-file apply");
    expect(panelText()).toContain("It cannot apply, create, delete, rename, run commands, call providers or tools, read files, write files, send chat, verify, or persist raw payloads.");
    expect(panelText()).toContain("Files: 2/3");
    expect(panelText()).toContain("Edits: 2/6");
    expect(panelText()).toContain("Total replacement bytes: 220/1600");
    expect(panelText()).toContain("apps/gui/src/SafePanel.tsx");
    expect(panelText()).toContain("lines 12-14");
    expect(panelText()).toContain("risk medium");
    expect(panelText()).toContain("Automatic apply allowed: false");
    expect(panelText()).toContain("Assistant apply authority: false");
    expect(actionButtonLabels()).not.toContain("Apply multi-file patch");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(onApplyReviewedPatch).not.toHaveBeenCalled();
    expect(onRunAllowlistedVerification).not.toHaveBeenCalled();
    expect(browserStorageDump()).toBe("");
  });

  it("renders unsafe multi-file patch plans as blocked sanitized review-only state", () => {
    const unsafePlan = multifilePatchPlan({ rawDiff: "diff --git a/private b/private" });
    const preview = evaluateControlledAgentMultifilePatchPlan(unsafePlan);

    renderPanel(undefined, {
      host: "browser",
      controlledMultifilePatchPlan: preview,
    });

    expect(panelText()).toContain("Multi-file patch dry-run review");
    expect(panelText()).toContain("blocked");
    expect(panelText()).toContain("Unsafe or malformed multi-file patch plan metadata is blocked and non-actionable.");
    expect(panelText()).toContain("No apply, bridge post, provider call, command, file operation, browser storage write, or auto-action was introduced.");
    expect(panelText()).toContain("unsafe_metadata");
    expect(panelText()).toContain("Browser preview and JetBrains remain display-only/fail-closed");
    expect(panelText()).not.toContain("diff --git");
    expect(optionalButton("Apply multi-file patch")).toBeUndefined();
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(browserStorageDump()).toBe("");
  });

  it("requires explicit VS Code confirmation before requesting multi-file apply", () => {
    const onConfirm = vi.fn();
    const onRequest = vi.fn();
    const preview = evaluateControlledAgentMultifilePatchPlan(multifilePatchPlan());

    renderPanel(undefined, {
      host: "vscode",
      controlledMultifilePatchPlan: preview,
      controlledMultifileApplyRequest: { state: "blocked", diagnostics: [{ code: "explicit_confirmation_required", message: "Bounded multi-file apply requires explicit user confirmation." }], details: {}, authority: {} },
      onConfirmControlledMultifileApply: onConfirm,
      onRequestControlledMultifileApply: onRequest,
    });

    expect(panelText()).toContain("Explicit multi-file apply confirmation");
    expect(panelText()).toContain("VS Code executor");
    expect(panelText()).toContain("No apply starts on render, provider response, search selection, or dry-run preview.");
    expect(findButton("Confirm multi-file apply review").disabled).toBe(false);
    expect(findButton("Apply reviewed multi-file patch in VS Code").disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
    act(() => findButton("Confirm multi-file apply review").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("enables explicit VS Code multi-file apply and renders sanitized result summaries", () => {
    const onRequest = vi.fn();
    const preview = evaluateControlledAgentMultifilePatchPlan(multifilePatchPlan());

    renderPanel(undefined, {
      host: "vscode",
      controlledMultifilePatchPlan: preview,
      controlledMultifileApplyConfirmed: true,
      controlledMultifileApplyRequest: { state: "ready", diagnostics: [], details: {}, authority: {} },
      controlledMultifileApplyResult: {
        state: "applied",
        message: "Bounded multi-file replacements applied by VS Code host.",
        patchPlanId: "multifile-plan-s115",
        appliedFileCount: 2,
        appliedEditCount: 2,
        blockedFileCount: 0,
        failedEditCount: 0,
        affectedFiles: ["apps/gui/src/SafePanel.tsx", "docs/architecture/safe-note.md"],
        files: [
          { editId: "edit-s115-1", workspaceRelativePath: "apps/gui/src/SafePanel.tsx", fileLabel: "apps/gui/src/SafePanel.tsx", status: "applied", startLine: 12, endLine: 14, replacementByteCount: 120, expectedPreEditHashLabel: "sha256:aaaaaaaaaa…", expectedRangeHashLabel: "sha256:bbbbbbbbbb…", replacementContentHashLabel: "sha256:1111111111…", actualPostEditHashLabel: "sha256:2222222222…", sanitizedSummary: "Updates a bounded label branch." },
        ],
        metadataOnly: true,
        rawReplacementIncluded: false,
        rawDiffIncluded: false,
        fileBodyIncluded: false,
      },
      onRequestControlledMultifileApply: onRequest,
    });

    expect(findButton("Apply reviewed multi-file patch in VS Code").disabled).toBe(false);
    expect(panelText()).toContain("Multi-file apply result summary");
    expect(panelText()).toContain("Applied files: 2");
    expect(panelText()).toContain("Metadata only: true");
    expect(panelText()).not.toContain("replacementText");
    expect(panelText()).not.toContain("diff --git");
    expect(onRequest).not.toHaveBeenCalled();
    act(() => findButton("Apply reviewed multi-file patch in VS Code").click());
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps browser and JetBrains multi-file apply fail-closed", () => {
    const onRequest = vi.fn();
    const preview = evaluateControlledAgentMultifilePatchPlan(multifilePatchPlan());

    for (const host of ["browser", "jetbrains"] as const) {
      renderPanel(undefined, {
        host,
        controlledMultifilePatchPlan: preview,
        controlledMultifileApplyConfirmed: true,
        controlledMultifileApplyRequest: { state: "unsupported", diagnostics: [{ code: "unsupported_host", message: "Bounded multi-file apply requests require the VS Code host." }], details: {}, authority: {} },
        onRequestControlledMultifileApply: onRequest,
      });

      expect(panelText()).toContain(host === "browser" ? "browser unsupported" : "JetBrains fail-closed");
      expect(findButton("Apply reviewed multi-file patch in VS Code").disabled).toBe(true);
    }
    expect(onRequest).not.toHaveBeenCalled();
  });

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

  it("renders host capability v2 matrix as display-only labels", () => {
    renderPanel(undefined, { controlledHostCapabilityMatrix: capabilityMatrixFixture });

    expect(panelText()).toContain("Host capability v2 matrix");
    expect(panelText()).toContain("allowed to execute: false");
    expect(panelText()).toContain("Host: VS Code host · Controlled dev-preview path ready");
    expect(panelText()).toContain("Capabilities: Start: supported metadata only · Read: supported metadata only · Edit: supported metadata only · Verification: supported metadata only · Repair: unsupported fail-closed");
    expect(panelText()).toContain("Dev-preview labels are display evidence only and do not grant controlled Start, read, edit, verification, repair, shell, git, provider, tool, or workspace authority.");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
  });

  it("renders explicit S86 one-step Start and Stop controls", () => {
    const onStartOneStepRun = vi.fn();
    const onStopOneStepRun = vi.fn();
    renderPanel(undefined, {
      host: "vscode",
      oneStepLoopState: idleOneStepLoop,
      oneStepReadRequest: readyOneStepRequest,
      oneStepEditRequest: readyOneStepRequest,
      oneStepCommandRunRequest: readyOneStepRequest,
      onStartOneStepRun,
      onStopOneStepRun,
    });

    expect(panelText()).toContain("S91 controlled dev-preview status");
    expect(panelText()).toContain("Controlled agent dev-preview is partially ready and still missing bounded capability metadata.");
    expect(panelText()).toContain("Host: vscode");
    expect(panelText()).toContain("Explicit start: ready");
    expect(panelText()).toContain("Allowlisted verification: ready");
    expect(panelText()).toContain("One repair attempt: blocked");
    expect(panelText()).toContain("no production autonomy");

    expect(panelText()).toContain("S96 useful one-step Agent Run");
    expect(panelText()).toContain("VS Code-only");
    expect(panelText()).toContain("explicit Start/Stop");
    expect(panelText()).toContain("Read request: ready");
    expect(panelText()).toContain("Edit request: ready");
    expect(panelText()).toContain("Verification request: ready");
    expect(findButton("Start one-step Agent Run").disabled).toBe(false);
    expect(findButton("Stop one-step Agent Run").disabled).toBe(true);

    act(() => {
      findButton("Start one-step Agent Run").click();
    });
    expect(onStartOneStepRun).toHaveBeenCalledTimes(1);
    expect(onStopOneStepRun).not.toHaveBeenCalled();

    renderPanel(undefined, {
      host: "vscode",
      oneStepLoopState: activeOneStepLoop,
      oneStepReadRequest: readyOneStepRequest,
      oneStepEditRequest: readyOneStepRequest,
      oneStepCommandRunRequest: readyOneStepRequest,
      onStartOneStepRun,
      onStopOneStepRun,
    });

    expect(findButton("Start one-step Agent Run").disabled).toBe(true);
    expect(findButton("Stop one-step Agent Run").disabled).toBe(false);
    act(() => {
      findButton("Stop one-step Agent Run").click();
    });
    expect(onStopOneStepRun).toHaveBeenCalledTimes(1);
  });

  it("disables S86 one-step Start outside VS Code and when prerequisites are blocked", () => {
    renderPanel(undefined, {
      host: "jetbrains",
      oneStepLoopState: idleOneStepLoop,
      oneStepReadRequest: readyOneStepRequest,
      oneStepEditRequest: readyOneStepRequest,
      oneStepCommandRunRequest: readyOneStepRequest,
    });

    expect(panelText()).toContain("One-step controlled run Start is disabled outside VS Code and posts no bridge request.");
    expect(panelText()).toContain("JetBrains partial/fail-closed");
    expect(findButton("Start one-step Agent Run").disabled).toBe(true);

    renderPanel(undefined, {
      host: "vscode",
      oneStepLoopState: idleOneStepLoop,
      oneStepReadRequest: readyOneStepRequest,
      oneStepEditRequest: blockedOneStepRequest,
      oneStepCommandRunRequest: readyOneStepRequest,
    });

    expect(panelText()).toContain("Start needs ready VS Code host, runtime, workspace, controlled read, controlled edit, and allowlisted verification request metadata.");
    expect(panelText()).toContain("Edit request: blocked");
    expect(findButton("Start one-step Agent Run").disabled).toBe(true);
  });

  it("renders sanitized controlled dev-preview reports for active and terminal one-step states", () => {
    const onStartOneStepRun = vi.fn();
    const onStopOneStepRun = vi.fn();
    for (const [loop, label] of [[activeOneStepLoop, "Running after explicit user start"], [completedOneStepLoop, "Completed with sanitized evidence"], [stoppedOneStepLoop, "User stop recorded; stale results ignored"], [failedOneStepLoop, "Verification failed or recovery failed closed"]] as const) {
      renderPanel(undefined, {
        host: "vscode",
        oneStepLoopState: loop,
        oneStepReadRequest: readyOneStepRequest,
        oneStepEditRequest: readyOneStepRequest,
        oneStepCommandRunRequest: readyOneStepRequest,
        onStartOneStepRun,
        onStopOneStepRun,
      });

      expect(panelText()).toContain("Controlled dev-preview report");
      expect(panelText()).toContain(label);
      expect(panelText()).toContain("Host: VS Code host");
      expect(panelText()).toContain("Explicit user start required");
      expect(panelText()).toContain("Sanitized display-only report");
      expect(panelText()).toContain("Report counter fileReads: 1");
      expect(panelText()).toContain("Evidence: Status evidence:");
      expect(panelText()).toContain("Raw file bodies, diffs, command output, provider payloads, private paths, and secrets are omitted.");
    }
    expect(actionButtonLabels()).toEqual(["Start one-step Agent Run", "Stop one-step Agent Run", "Manually apply reviewed patch", "Manually run allowlisted verification", "Manually review rollback"]);
  });

  it("renders stop and repair-exhausted recovery guidance without automatic actions", () => {
    renderPanel(undefined, {
      host: "vscode",
      oneStepLoopState: stoppedOneStepLoop,
      oneStepReadRequest: readyOneStepRequest,
      oneStepEditRequest: readyOneStepRequest,
      oneStepCommandRunRequest: readyOneStepRequest,
    });

    expect(panelText()).toContain("Controlled recovery guidance");
    expect(panelText()).toContain("stale duplicate result");
    expect(panelText()).toContain("host disconnect runtime restart");
    expect(panelText()).toContain("provider timeout");
    expect(panelText()).toContain("edit hash mismatch");
    expect(panelText()).toContain("verification bundle failure");
    expect(panelText()).toContain("checkpoint rollback review");
    expect(panelText()).toContain("no auto retry/rollback/repair");
    expect(panelText()).toContain("Execution allowed: false");
    expect(panelText()).toContain("Raw output/private paths/secrets persisted: false");
    expect(panelText()).toContain("stop completed");
    expect(panelText()).toContain("The stopped run is closed. Start a new run only after an explicit user choice.");
    expect(panelText()).not.toMatch(/Run repair/i);

    renderPanel(undefined, {
      host: "vscode",
      repairLoop: { ...evaluateControlledAgentRepairLoop(failedVerificationLoop), state: "exhausted", attemptCount: 1, canAttemptRepair: false },
    });

    expect(panelText()).toContain("repair followup exhausted");
    expect(panelText()).toContain("The repair budget is exhausted. Stop repair guidance and wait for a new user-started run.");expect(panelText()).toContain("The repair budget is exhausted. Stop repair guidance and wait for a new user-started run.");
    expect(optionalButton("Confirm one repair attempt")?.disabled).toBe(true);
  });

  it("keeps controlled dev-preview report limitations visible and unsafe report data omitted", () => {
    const secret = "sk-" + "z".repeat(40);
    renderPanel(undefined, {
      host: "browser",
      oneStepLoopState: { ...activeOneStepLoop, summary: `Unsafe ${secret} /Users/alice/private.ts` },
      oneStepReadRequest: readyOneStepRequest,
      oneStepEditRequest: readyOneStepRequest,
      oneStepCommandRunRequest: readyOneStepRequest,
    });

    expect(panelText()).toContain("Host: Browser preview host");
    expect(panelText()).toContain("Blocked until local readiness returns");
    expect(panelText()).toContain("Browser preview cannot start the controlled local agent dev-preview.");
    expect(panelText()).toContain("Evidence: Status evidence: read context — Sanitized evidence summary was unavailable.");
    expect(panelText()).not.toContain(secret);
    expect(panelText()).not.toContain("/Users/alice");

    renderPanel(undefined, {
      host: "jetbrains",
      oneStepLoopState: activeOneStepLoop,
      oneStepReadRequest: readyOneStepRequest,
      oneStepEditRequest: readyOneStepRequest,
      oneStepCommandRunRequest: readyOneStepRequest,
    });

    expect(panelText()).toContain("Host: JetBrains host");
    expect(panelText()).toContain("Blocked until local readiness returns");
    expect(panelText()).toContain("JetBrains support is partial and fail-closed in this VS Code-first dev-preview.");
    expect(findButton("Start one-step Agent Run").disabled).toBe(true);
  });

  it("renders controlled repair eligibility with sanitized counters and explicit callback", () => {
    const onConfirmRepairAttempt = vi.fn();
    renderPanel(readyInput, {
      host: "vscode",
      repairLoop: eligibleRepairLoop,
      repairDraftReady: true,
      onConfirmRepairAttempt,
    });

    expect(panelText()).toContain("Controlled repair eligibility");
    expect(panelText()).toContain("one attempt max");
    expect(panelText()).toContain("explicit user click");
    expect(panelText()).toContain("no automatic repair");
    expect(panelText()).toContain("Failed allowlisted verification is eligible for one bounded repair attempt.");
    expect(panelText()).toContain("State: eligible");
    expect(panelText()).toContain("Attempts: 0/1");
    expect(panelText()).toContain("Verification runs: 1");
    expect(panelText()).toContain("User turns: 0");
    expect(panelText()).toContain("Can attempt repair: yes");
    expect(panelText()).toContain("Draft ready: yes");
    expect(panelText()).toContain("Repair edit pending: no");
    expect(panelText()).toContain("Repair verification pending: no");
    expect(panelText()).toContain("This card never reads files, applies edits, runs commands, posts bridge messages, calls providers, or starts repair automatically.");
    expect(onConfirmRepairAttempt).not.toHaveBeenCalled();

    act(() => {
      findButton("Confirm one repair attempt").click();
    });
    expect(onConfirmRepairAttempt).toHaveBeenCalledTimes(1);
  });

  it("enables controlled repair confirmation for proposal-ready draft only and keeps unsafe output hidden", () => {
    const onConfirmRepairAttempt = vi.fn();
    const secret = "sk-" + "r".repeat(40);
    renderPanel(readyInput, {
      host: "vscode",
      repairLoop: {
        ...proposalReadyRepairLoop,
        summary: `Repair draft ready ${secret} /Users/alice/private.ts`,
        diagnostics: [{ code: "policy_blocked", message: `Unsafe path /Users/alice/private.ts and ${secret}` }],
      },
      repairDraftReady: true,
      onConfirmRepairAttempt,
    });

    expect(panelText()).toContain("State: proposal ready");
    expect(panelText()).toContain("Repair diagnostics: policy_blocked:");
    expect(panelText()).not.toContain(secret);
    expect(panelText()).not.toContain("/Users/alice");
    expect(findButton("Confirm one repair attempt").disabled).toBe(false);

    act(() => {
      findButton("Confirm one repair attempt").click();
    });
    expect(onConfirmRepairAttempt).toHaveBeenCalledTimes(1);
  });

  it("disables controlled repair confirmation without draft readiness or while pending", () => {
    const onConfirmRepairAttempt = vi.fn();
    renderPanel(readyInput, {
      host: "vscode",
      repairLoop: eligibleRepairLoop,
      repairDraftReady: false,
      onConfirmRepairAttempt,
    });

    expect(panelText()).toContain("Draft ready: no");
    expect(findButton("Confirm one repair attempt").disabled).toBe(true);
    act(() => {
      findButton("Confirm one repair attempt").click();
    });
    expect(onConfirmRepairAttempt).not.toHaveBeenCalled();

    renderPanel(readyInput, {
      host: "vscode",
      repairLoop: eligibleRepairLoop,
      repairDraftReady: true,
      pendingRepairEdit: true,
      onConfirmRepairAttempt,
    });

    expect(panelText()).toContain("Repair edit pending: yes");
    expect(findButton("Confirm one repair attempt").disabled).toBe(true);
  });

  it("renders blocked repair diagnostics without enabling callback and hides disabled repair metadata", () => {
    const onConfirmRepairAttempt = vi.fn();
    renderPanel(readyInput, {
      host: "vscode",
      repairLoop: blockedRepairLoop,
      repairDraftReady: true,
      onConfirmRepairAttempt,
    });

    expect(panelText()).toContain("Controlled repair eligibility");
    expect(panelText()).toContain("State: blocked");
    expect(panelText()).toContain("Stop reason: ineligible verification status");
    expect(panelText()).toContain("Repair diagnostics: policy_blocked: Controlled repair loop is ineligible for this verification status.");
    expect(findButton("Confirm one repair attempt").disabled).toBe(true);
    expect(onConfirmRepairAttempt).not.toHaveBeenCalled();

    renderPanel(readyInput, {
      host: "vscode",
      repairLoop: evaluateControlledAgentRepairLoop(undefined),
      repairDraftReady: true,
      onConfirmRepairAttempt,
    });

    expect(panelText()).not.toContain("Controlled repair eligibility");
    expect(optionalButton("Confirm one repair attempt")).toBeUndefined();
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
    expect(panelText()).toContain("VS Code explicit controls");
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

  it("renders apply readiness and risk for ready manual apply", () => {
    renderPanel(readyInput, { host: "vscode" });

    expect(panelText()).toContain("Apply readiness and risk");
    expect(panelText()).toContain("ready");
    expect(panelText()).toContain("manual apply only");
    expect(panelText()).toContain("sanitized metadata");
    expect(panelText()).toContain("proposal parsed: ready");
    expect(panelText()).toContain("checkpoint ready: ready");
    expect(panelText()).toContain("host supports apply: ready");
    expect(panelText()).toContain("no pending apply: ready");
    expect(panelText()).toContain("Files: 1");
    expect(panelText()).toContain("Edits: 1");
    expect(panelText()).toContain("File labels: src/example.ts");
    expect(panelText()).toContain("Display only: no workspace change happens until an explicit supported-IDE apply click.");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(false);
  });

  it("renders apply readiness blocked by checkpoint and policy", () => {
    renderPanel({
      ...readyInput,
      boundedLoop: {
        ...baseLoop,
        status: "blocked",
        sandbox: { ...baseLoop.sandbox, modeStatus: "blocked", checkpointVerified: false },
        policy: { decision: "blocked", requiresUserConfirmation: true, reasonCodes: ["explicit_user_confirmation_required", "blocked_by_policy"], blockReason: "Checkpoint is not ready." },
      },
    }, { host: "vscode" });

    expect(panelText()).toContain("Apply readiness and risk");
    expect(panelText()).toContain("checkpoint ready: blocked");
    expect(panelText()).toContain("Risk badges: checkpoint missing · policy blocked");
    expect(panelText()).toContain("Checkpoint metadata is not ready for manual apply.");
    expect(panelText()).toContain("Apply policy metadata is blocked or unavailable.");
    expect(panelText()).toContain("Resolve blocked policy or checkpoint metadata before manual apply.");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
  });

  it("renders browser-only apply guidance without enabling apply", () => {
    renderPanel(readyInput, { host: "browser" });

    expect(panelText()).toContain("Apply readiness and risk");
    expect(panelText()).toContain("browser preview only");
    expect(panelText()).toContain("host supports apply: blocked");
    expect(panelText()).toContain("Browser preview cannot apply. Open VS Code or JetBrains for host confirmation.");
    expect(panelText()).toContain("Open the workspace in a supported IDE host for manual apply confirmation.");
    expect(panelText()).toContain("Browser preview stays preview-only. These controls will not post privileged host actions here");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
  });

  it("renders pending apply as blocked readiness", () => {
    renderPanel({
      ...readyInput,
      applyRequest: { requested: true, source: "user", requestId: "apply-1" },
    }, { host: "vscode", pendingApply: true });

    expect(panelText()).toContain("Apply readiness and risk");
    expect(panelText()).toContain("no pending apply: blocked");
    expect(panelText()).toContain("An IDE apply request is already pending; wait for the current result before requesting another apply.");
    expect(panelText()).toContain("Wait for the pending apply result metadata before starting another manual apply request.");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
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

  it("renders manual checkpoint rollback-review decision without new execution controls", () => {
    const onApply = vi.fn();
    const onVerify = vi.fn();
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
    }, { host: "vscode", onApplyReviewedPatch: onApply, onRunAllowlistedVerification: onVerify, onReviewRollback });

    expect(panelText()).toContain("Manual checkpoint decision");
    expect(panelText()).toContain("manual decisions only");
    expect(panelText()).toContain("sanitized metadata");
    expect(panelText()).toContain("Rollback review is available as a manual review-only decision; this card has no rollback execution payload.");
    expect(panelText()).toContain("Recommended manual decision: review rollback");
    expect(panelText()).toContain("Review rollback: recommended · Rollback is review-only and has no execute payload.");
    expect(panelText()).toContain("No automatic rollback, continuation, apply, verification, repair, retry, chat send, context attach, file read, search, or separate run starts from this panel.");
    expect(panelText()).toContain("Review rollback opens the existing review-only path when available.");
    expect(actionButtonLabels()).toEqual(["Manually apply reviewed patch", "Manually run allowlisted verification", "Manually review rollback"]);
    expect(onApply).not.toHaveBeenCalled();
    expect(onVerify).not.toHaveBeenCalled();
    expect(onReviewRollback).not.toHaveBeenCalled();
    act(() => {
      findButton("Manually review rollback").click();
    });
    expect(onReviewRollback).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("renders safe continue checkpoint decision as guidance only", () => {
    const onApply = vi.fn();
    const onVerify = vi.fn();
    const onReviewRollback = vi.fn();
    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "succeeded", exitCode: 0, outputTail: "passed" },
      boundedLoop: verifiedLoop,
    }, { host: "vscode", onApplyReviewedPatch: onApply, onRunAllowlistedVerification: onVerify, onReviewRollback });

    expect(panelText()).toContain("Manual checkpoint decision");
    expect(panelText()).toContain("Continue in the current checkpoint is available as manual guidance after successful apply and verification metadata.");
    expect(panelText()).toContain("Recommended manual decision: continue in current checkpoint");
    expect(panelText()).toContain("Continue current checkpoint: recommended · Continue is a manual recommendation after successful apply and verification metadata.");
    expect(panelText()).toContain("No automatic rollback, continuation, apply, verification, repair, retry, chat send, context attach, file read, search, or separate run starts from this panel.");
    expect(panelText()).toContain("Continue means keep working in the current checkpoint by explicit user choice only.");
    expect(actionButtonLabels()).toEqual(["Draft Agent Run follow-up prompt", "Manually apply reviewed patch", "Manually run allowlisted verification", "Manually review rollback"]);
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
    expect(findButton("Manually review rollback").disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    expect(onVerify).not.toHaveBeenCalled();
    expect(onReviewRollback).not.toHaveBeenCalled();
  });

  it("renders failed verification as separate manual run guidance only", () => {
    const onApply = vi.fn();
    const onVerify = vi.fn();
    const onReviewRollback = vi.fn();
    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "failed", exitCode: 1, outputTail: "failed" },
      boundedLoop: failedVerificationLoop,
    }, { host: "vscode", onApplyReviewedPatch: onApply, onRunAllowlistedVerification: onVerify, onReviewRollback });

    expect(panelText()).toContain("Manual checkpoint decision");
    expect(panelText()).toContain("Verification failed; start a separate manual run only if the user chooses to draft follow-up work.");
    expect(panelText()).toContain("Recommended manual decision: start separate manual run");
    expect(panelText()).toContain("Start separate manual run: recommended · Follow-up work should start as a separate user-controlled run.");
    expect(panelText()).toContain("Decision diagnostics: manual_review_required: Verification failed; use a separate manual run for follow-up work.");
    expect(panelText()).toContain("Start separate manual run is guidance only and creates nothing.");
    expect(actionButtonLabels()).toEqual(["Draft Agent Run fix prompt", "Manually apply reviewed patch", "Manually run allowlisted verification", "Manually review rollback"]);
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
    expect(findButton("Manually review rollback").disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    expect(onVerify).not.toHaveBeenCalled();
    expect(onReviewRollback).not.toHaveBeenCalled();
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

  it("runs controlled verification only after explicit S85 click", () => {
    const onVerify = vi.fn();
    renderPanel({
      ...readyInput,
      applyRequest: { requested: true, source: "user", requestId: "apply-1" },
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      boundedLoop: verificationLoop,
    }, { host: "vscode", onRunAllowlistedVerification: onVerify });

    expect(panelText()).toContain("Manual state: Ready for controlled verification");
    expect(panelText()).toContain("no legacy IDE verification request is posted from Agent Run");
    expect(findButton("Manually run allowlisted verification").disabled).toBe(false);
    expect(onVerify).not.toHaveBeenCalled();
    act(() => {
      findButton("Manually run allowlisted verification").click();
    });

    expect(onVerify).toHaveBeenCalledTimes(1);
    expect(onVerify).toHaveBeenCalledWith("repository-check");
  });

  it("keeps JetBrains controlled verification unsupported and posts no request", () => {
    const onVerify = vi.fn();
    renderPanel({
      ...readyInput,
      applyRequest: { requested: true, source: "user", requestId: "apply-1" },
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      boundedLoop: verificationLoop,
    }, { host: "jetbrains", onRunAllowlistedVerification: onVerify });

    expect(panelText()).toContain("S85 controlled verification unsupported here");
    expect(panelText()).toContain("VS Code-only in S85");
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
    act(() => {
      findButton("Manually run allowlisted verification").click();
    });
    expect(onVerify).not.toHaveBeenCalled();
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

    expect(panelText()).toContain("Manual state: Ready for controlled verification");
    expect(panelText()).toContain("Ready for explicit S85 allowlisted controlled verification in VS Code.");
    expect(panelText()).toContain("no legacy IDE verification request is posted from Agent Run");
    expect(findButton("Manually run allowlisted verification").disabled).toBe(false);

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
      { id: "proposal-2", source: "assistant-follow-up", kind: "follow_up", summary: "Follow-up proposal label", touchedFiles: ["src/example.ts"], lineage: { priorProposalId: "proposal-1", verificationRequestId: "verify-1", intent: "fix" } },
    ]);
    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationRequest: { requested: true, source: "user", requestId: "verify-1" },
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

  it("does not render unrelated follow-up proposals as guided-fix results", () => {
    const unrelatedHistory = createProposalHistory([
      { id: "proposal-1", source: "assistant", kind: "original", summary: "Small safe proposal", touchedFiles: ["src/example.ts"] },
      { id: "proposal-2", source: "assistant-follow-up", kind: "follow_up", summary: "Unrelated follow-up proposal", touchedFiles: ["src/example.ts"], lineage: { priorProposalId: "proposal-other", verificationRequestId: "verify-other", intent: "followup" } },
    ]);

    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationRequest: { requested: true, source: "user", requestId: "verify-1" },
      verificationResult: { status: "failed", exitCode: 1, outputTail: "failed" },
      boundedLoop: failedVerificationLoop,
    }, { host: "vscode", proposalHistory: unrelatedHistory });

    expect(panelText()).toContain("Manual guided fix");
    expect(panelText()).toContain("fix draft available");
    expect(panelText()).not.toContain("new proposal detected");
    expect(panelText()).not.toContain("Unrelated follow-up proposal");
    expect(findButton("Draft Agent Run fix prompt").disabled).toBe(false);
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

  it("renders explicit controlled-run context selector with bounded preview and disabled unsupported hosts", () => {
    const onIncludeControlledRunContextChange = vi.fn();
    const bundle = {
      cleared: false,
      items: [{
        id: "workspace-ctx-1",
        sourceKind: "workspace_fragment" as const,
        label: "src/context.ts",
        previewText: "export const selected = true;",
        previewByteCount: 29,
        previewLineCount: 1,
        truncated: false,
        workspaceRelativePath: "src/context.ts",
        range: { startLine: 2, endLine: 4 },
        hostSurfaceLabel: "VS Code explicit context bundle",
        key: "workspace|src/context.ts|2-4|hash",
      }],
    };
    const report = {
      selectedContextCount: 1,
      safeLabels: ["workspace fragment · src/context.ts"],
      omittedUnsafeItemCount: 0,
      totalPreviewBytes: 29,
      totalPreviewLines: 1,
      truncatedCount: 0,
      blockedReasons: [],
    };

    renderPanel(undefined, { host: "vscode", controlledRunContextBundle: bundle, controlledRunContextReport: report, onIncludeControlledRunContextChange });

    expect(panelText()).toContain("Explicit controlled-run context");
    expect(panelText()).toContain("VS Code visible selection");
    expect(panelText()).toContain("Only the user-selected bounded context below is eligible for the controlled run preview.");
    expect(panelText()).toContain("Selected bounded items: 1");
    expect(panelText()).toContain("src/context.ts");
    expect(panelText()).toContain("export const selected = true;");
    expect(panelText()).toContain("Preview is bounded and in-memory only. This panel never persists raw file bodies, starts search/indexing, or attaches hidden workspace context.");
    const checkbox = container?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.disabled).toBe(false);
    act(() => { checkbox?.click(); });
    expect(onIncludeControlledRunContextChange).toHaveBeenCalledWith(false);

    renderPanel(undefined, { host: "jetbrains", controlledRunContextBundle: bundle, controlledRunContextReport: report });
    expect(panelText()).toContain("unsupported host");
    expect(panelText()).toContain("Controlled-run context include is disabled outside VS Code and posts no bridge request.");
    expect(container?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(browserStorageDump()).not.toContain("export const selected");
  });

  it("renders controlled run history from sanitized metadata only", () => {
    const secret = "sk-" + "h".repeat(40);
    const historyItem = createControlledRunHistoryItem({
      runId: "history-run-1",
      hostLabel: "vscode",
      readinessLabels: ["opt_in_ready", "workspace_ready", "checkpoint_ready"],
      phaseLabel: "completed",
      resultLabel: "succeeded",
      counters: [
        { name: "read_count", value: 1 },
        { name: "edit_count", value: 1 },
        { name: "verification_count", value: 1 },
      ],
      summaryLabels: ["safe completion label", `raw prompt ${secret} /Users/alice/private.ts`],
      artifactLabels: [{ label: "allowlisted verification metadata", sizeBucketLabel: "bounded_tail", retentionLabel: "gui_memory_only" }],
      checksumLabels: [`sha256:${"b".repeat(64)}`],
      rawDiff: `raw diff ${secret} /Users/alice/private.ts`,
    } as any, () => new Date("2026-07-07T10:00:00.000Z"));

    renderPanel(undefined, { controlledRunHistory: [historyItem] });

    const text = panelText();
    expect(text).toContain("Controlled run history");
    expect(text).toContain("local metadata");
    expect(text).toContain("sanitized labels only");
    expect(text).toContain("no persistence");
    expect(text).toContain("history-run-1");
    expect(text).toContain("completed");
    expect(text).toContain("unsafe metadata blocked");
    expect(text).toContain("Summary labels: safe completion label");
    expect(text).toContain("Counters: read count 1 · edit count 1 · verification count 1");
    expect(text).toContain("Artifact labels: allowlisted verification metadata · bounded_tail · gui_memory_only");
    expect(text).toContain("Checksum labels: sha256:[redacted]");
    expect(text).toContain("unsafe metadata omitted");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("raw diff");
    expect(browserStorageDump()).not.toContain("history-run-1");
  });

  it("renders S119 two-step run staged evidence with explicit gates and no action authority", () => {
    const state = evaluateControlledAgentTwoStepRun(twoStepFixture());

    renderPanel(undefined, { host: "vscode", controlledTwoStepRunState: state });

    const text = panelText();
    expect(text).toContain("S119 two-step run staged evidence");
    expect(text).toContain("completed");
    expect(text).toContain("Planning, review, execution, apply, and verification evidence are complete after explicit user gates.");
    expect(text).toContain("Planning gate: user confirmed");
    expect(text).toContain("Plan review gate: user reviewed");
    expect(text).toContain("Execution gate: user requested execution");
    expect(text).toContain("Verification gate: user requested verification");
    expect(text).toContain("Authority flags: execute false · apply without click false · verify without click false · repair without click false · read false · write false · command false · provider false · tools false");
    expect(text).toContain("Browser is unsupported for trusted execution and JetBrains remains fail-closed");
    expect(actionButtonLabels()).not.toContain("Start two-step run");
    expect(browserStorageDump()).not.toContain("controlled_agent_two_step_run");
  });

  it("renders S119 blocked gate diagnostics without raw leakage", () => {
    const secret = "sk-" + "z".repeat(40);
    const unsafe = evaluateControlledAgentTwoStepRun(twoStepFixture({ rawPayload: `raw payload ${secret} /Users/alice/private.ts` }));
    const missingGate = evaluateControlledAgentTwoStepRun(twoStepFixture({ gates: { planningRequest: { satisfied: false } } }));

    renderPanel(undefined, { host: "browser", controlledTwoStepRunState: unsafe });

    let text = panelText();
    expect(text).toContain("S119 two-step run staged evidence");
    expect(text).toContain("failed");
    expect(text).toContain("Blocked safely: unsafe metadata");
    expect(text).toContain("Unsafe, missing, stale, duplicate, or failed metadata blocked the two-step run safely.");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("/Users/alice");

    renderPanel(undefined, { host: "jetbrains", controlledTwoStepRunState: missingGate });
    text = panelText();
    expect(text).toContain("Blocked safely: missing user gate");
    expect(text).toContain("Planning gate: waiting for explicit user request");
    expect(text).toContain("Execution gate: execution not requested");
    expect(text).toContain("JetBrains remains fail-closed");
    expect(browserStorageDump()).not.toContain(secret);
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

  it("does not render unsafe apply readiness file labels", () => {
    renderPanel({
      goal: { id: "goal-1", title: "Review unsafe label" },
      proposal: { id: "proposal-unsafe", summary: "Unsafe label proposal", touchedFiles: ["src/example.ts", "/Users/alice/private.ts", "../secret.ts", "auth/token.ts"] },
      boundedLoop: {
        ...baseLoop,
        patch: { ...baseLoop.patch, proposalId: "proposal-unsafe", touchedFiles: ["src/example.ts"], editCount: 1, summary: "Unsafe label proposal" },
      },
    }, { host: "vscode" });

    expect(panelText()).toContain("Apply readiness and risk");
    expect(panelText()).toContain("File labels: src/example.ts");
    expect(panelText()).not.toContain("/Users/alice");
    expect(panelText()).not.toContain("../secret.ts");
    expect(panelText()).not.toContain("auth/token.ts");
    expect(browserStorageDump()).not.toContain("/Users/alice");
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
  oneStepLoopState?: any;
  oneStepReadRequest?: any;
  oneStepEditRequest?: any;
  oneStepCommandRunRequest?: any;
  repairLoop?: any;
  repairDraftReady?: boolean;
  pendingRepairEdit?: boolean;
  pendingRepairVerification?: boolean;
  onConfirmRepairAttempt?: () => void;
  onStartOneStepRun?: () => void;
  onStopOneStepRun?: () => void;
  controlledHostCapabilityMatrix?: any;
  controlledRunContextBundle?: any;
  controlledRunContextReport?: any;
  includeControlledRunContext?: boolean;
  onIncludeControlledRunContextChange?: (include: boolean) => void;
  controlledLexicalSearch?: ControlledAgentLexicalSearchSummary;
  controlledMultifilePatchPlan?: ReturnType<typeof evaluateControlledAgentMultifilePatchPlan>;
  controlledMultifileApplyRequest?: any;
  controlledMultifileApplyResult?: any;
  controlledMultifileApplyNote?: string | null;
  pendingControlledMultifileApply?: boolean;
  controlledMultifileApplyConfirmed?: boolean;
  onConfirmControlledMultifileApply?: () => void;
  onRequestControlledMultifileApply?: () => void;
  onClearControlledMultifileApply?: () => void;
  controlledVerificationBundle?: any;
  controlledVerificationBundleRequest?: any;
  controlledVerificationBundleNote?: string | null;
  pendingControlledVerificationBundle?: boolean;
  controlledVerificationFollowupDraft?: any;
  onRequestControlledVerificationBundle?: () => void;
  onDraftControlledVerificationFollowup?: () => void;
  onDraftControlledVerificationFix?: () => void;
  controlledSearchResultId?: string;
  selectedControlledSearchResultIds?: string[];
  controlledSearchSelection?: any;
  controlledSearchRequestState?: "ready" | "blocked" | "unsupported";
  pendingControlledSearch?: boolean;
  onRequestControlledSearch?: () => void;
  onControlledSearchResultSelectionChange?: (resultId: string, selected: boolean) => void;
  controlledRunHistory?: any;
  controlledTwoStepRunState?: any;
  controlledTaskHarness?: any;
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
        oneStepLoopState={props.oneStepLoopState}
        oneStepReadRequest={props.oneStepReadRequest}
        oneStepEditRequest={props.oneStepEditRequest}
        oneStepCommandRunRequest={props.oneStepCommandRunRequest}
        repairLoop={props.repairLoop}
        repairDraftReady={props.repairDraftReady}
        pendingRepairEdit={props.pendingRepairEdit}
        pendingRepairVerification={props.pendingRepairVerification}
        onConfirmRepairAttempt={props.onConfirmRepairAttempt}
        onStartOneStepRun={props.onStartOneStepRun}
        onStopOneStepRun={props.onStopOneStepRun}
        controlledHostCapabilityMatrix={props.controlledHostCapabilityMatrix}
        controlledRunContextBundle={props.controlledRunContextBundle}
        controlledRunContextReport={props.controlledRunContextReport}
        includeControlledRunContext={props.includeControlledRunContext}
        onIncludeControlledRunContextChange={props.onIncludeControlledRunContextChange}
        controlledRunHistory={props.controlledRunHistory}
        controlledLexicalSearch={props.controlledLexicalSearch}
        controlledMultifilePatchPlan={props.controlledMultifilePatchPlan}
        controlledMultifileApplyRequest={props.controlledMultifileApplyRequest}
        controlledMultifileApplyResult={props.controlledMultifileApplyResult}
        controlledMultifileApplyNote={props.controlledMultifileApplyNote}
        pendingControlledMultifileApply={props.pendingControlledMultifileApply}
        controlledMultifileApplyConfirmed={props.controlledMultifileApplyConfirmed}
        onConfirmControlledMultifileApply={props.onConfirmControlledMultifileApply}
        onRequestControlledMultifileApply={props.onRequestControlledMultifileApply}
        onClearControlledMultifileApply={props.onClearControlledMultifileApply}
        controlledVerificationBundle={props.controlledVerificationBundle}
        controlledVerificationBundleRequest={props.controlledVerificationBundleRequest}
        controlledVerificationBundleNote={props.controlledVerificationBundleNote}
        pendingControlledVerificationBundle={props.pendingControlledVerificationBundle}
        controlledVerificationFollowupDraft={props.controlledVerificationFollowupDraft}
        onRequestControlledVerificationBundle={props.onRequestControlledVerificationBundle}
        onDraftControlledVerificationFollowup={props.onDraftControlledVerificationFollowup}
        onDraftControlledVerificationFix={props.onDraftControlledVerificationFix}
        controlledSearchResultId={props.controlledSearchResultId}
        selectedControlledSearchResultIds={props.selectedControlledSearchResultIds}
        controlledSearchSelection={props.controlledSearchSelection}
        controlledSearchRequestState={props.controlledSearchRequestState}
        pendingControlledSearch={props.pendingControlledSearch}
        onRequestControlledSearch={props.onRequestControlledSearch}
        onControlledSearchResultSelectionChange={props.onControlledSearchResultSelectionChange}
        controlledTwoStepRunState={props.controlledTwoStepRunState}
        controlledTaskHarness={props.controlledTaskHarness}
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

function actionButtonLabels() {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).map((item) => item.textContent ?? "").filter((label) => !controlledAgentTaskPresets.some((preset) => preset.label === label));
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
