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
    expect(panelText()).toContain("Run status: idle");
    expect(panelText()).toContain("Goal summary: No local goal selected");
    expect(findButton("Apply reviewed patch").disabled).toBe(true);
    expect(findButton("Run allowlisted verification").disabled).toBe(true);
    expect(findButton("Review rollback").disabled).toBe(true);
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

    expect(panelText()).toContain("Run status: prerequisites_blocked");
    expect(panelText()).toContain("Checkpoint/policy readiness: blocked");
    expect(panelText()).toContain("Safety diagnostics");
    expect(findButton("Apply reviewed patch").disabled).toBe(true);
  });

  it("renders ready-for-apply state", () => {
    renderPanel(readyInput, { host: "vscode" });

    expect(panelText()).toContain("Run status: ready_for_apply");
    expect(panelText()).toContain("Goal summary: Add safe panel");
    expect(panelText()).toContain("Proposal status: detected and awaiting explicit apply");
    expect(panelText()).toContain("Touched files: 1");
    expect(panelText()).toContain("Edit count: 1");
    expect(findButton("Apply reviewed patch").disabled).toBe(false);
    expect(findButton("Run allowlisted verification").disabled).toBe(true);
  });

  it("does not call bridge callbacks before click and applies only after explicit click", () => {
    const onApply = vi.fn();
    renderPanel(readyInput, { host: "vscode", onApplyReviewedPatch: onApply });

    expect(onApply).not.toHaveBeenCalled();
    act(() => {
      findButton("Apply reviewed patch").click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("runs verification only after explicit click with commandId-only payload", () => {
    const onVerify = vi.fn();
    renderPanel({
      ...readyInput,
      applyRequest: { requested: true, source: "user", requestId: "apply-1" },
      applyResult: { status: "applied", summary: "Applied.", appliedFileCount: 1 },
      boundedLoop: {
        ...baseLoop,
        status: "ready_for_verification",
        policy: { decision: "ready_for_user_verification", requiresUserConfirmation: true, reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "user_apply_result_recorded"] },
        verification: { commandId: "repository-check", status: "ready" },
      },
    }, { host: "vscode", onRunAllowlistedVerification: onVerify });

    expect(onVerify).not.toHaveBeenCalled();
    act(() => {
      findButton("Run allowlisted verification").click();
    });

    expect(onVerify).toHaveBeenCalledWith("repository-check");
    expect(JSON.stringify({ action: "runVerificationCommand", commandId: onVerify.mock.calls[0]?.[0] })).toBe("{\"action\":\"runVerificationCommand\",\"commandId\":\"repository-check\"}");
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
