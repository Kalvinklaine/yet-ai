import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunPanel } from "./AgentRunPanel";
import type { AgentRunInput } from "../services/agentRunState";
import type { VerificationCommandId } from "../bridge/bridgeAdapter";

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

const readyInput: AgentRunInput = {
  goal: { id: "goal-1", title: "Add safe panel", summary: "Add safe panel" },
  proposal: { id: "proposal-1", summary: "Small safe proposal", touchedFiles: ["src/example.ts"] },
  boundedLoop: baseLoop,
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

    expect(panelText()).toContain("Experimental Agent Run · one-step manual shell");
    expect(panelText()).toContain("Manual state: idle");
    expect(panelText()).toContain("Goal summary: No local goal selected");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(findButton("Manually run allowlisted verification").disabled).toBe(true);
    expect(findButton("Manually review rollback").disabled).toBe(true);
  });

  it("renders goal ready state before a proposal", () => {
    renderPanel({ goal: { id: "goal-1", title: "Add safe panel" } }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Goal ready");
    expect(panelText()).toContain("Goal ready. Draft or send a model proposal request manually; no apply or verification action is available yet.");
    expect(panelText()).toContain("Proposal status: not detected");
    expect(panelText()).toContain("Checkpoint status: missing");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
  });

  it("renders proposal detected with missing checkpoint prerequisites", () => {
    renderPanel({ goal: readyInput.goal, proposal: readyInput.proposal }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Checkpoint required");
    expect(panelText()).toContain("Proposal detected, but checkpoint readiness metadata is missing. Recovery: refresh runtime/checkpoint readiness, then review again before any manual apply.");
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
    });

    expect(panelText()).toContain("Manual state: Checkpoint required");
    expect(panelText()).toContain("Checkpoint required. Recovery: resolve checkpoint or policy readiness first; manual apply stays disabled until runtime metadata is ready.");
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
    expect(panelText()).toContain("Proposal status: detected with verified checkpoint metadata");
    expect(panelText()).toContain("Checkpoint status: verified");
    expect(panelText()).toContain("Policy decision: ready_for_user_apply");
    expect(panelText()).toContain("Verification command id: repository-check");
    expect(panelText()).toContain("Touched files: 1");
    expect(panelText()).toContain("Edit count: 1");
    expect(findButton("Manually apply reviewed patch").disabled).toBe(false);
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

    expect(panelText()).toContain("Manual state: Verified");
    expect(panelText()).toContain("Verification status/result: Verified · exit 0 · sanitized result available");

    renderPanel({
      ...readyInput,
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      verificationResult: { status: "failed", exitCode: 1, outputTail: "failed" },
      boundedLoop: failedVerificationLoop,
    }, { host: "vscode" });

    expect(panelText()).toContain("Manual state: Verification failed");
    expect(panelText()).toContain("Verification failed. Recovery: review the sanitized result, then manually draft a follow-up or review rollback; no automatic repair is started.");
    expect(panelText()).toContain("Verification status/result: Verification failed · exit 1 · sanitized result available");
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
