import { describe, expect, it } from "vitest";
import { createAgentRunReport, createAgentRunTraceDetails } from "./agentRunReport";
import type { AgentRunInput } from "./agentRunState";
import type { BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";

const readyLoop: BoundedPatchVerificationLoopMetadata = {
  kind: "bounded_patch_verification_loop",
  version: "2026-06-21",
  authority: "metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  status: "ready_for_apply",
  loopId: "loop-s43-report",
  sandbox: {
    modeStatus: "checkpoint_ready",
    checkpointId: "checkpoint-s43-report",
    checkpointVerified: true,
    checkpointHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  limits: {
    maxTouchedFiles: 4,
    maxPatchBytes: 12000,
    maxSteps: 4,
    maxVerificationSeconds: 600,
  },
  patch: {
    proposalId: "proposal-s43-report",
    source: "assistant_proposal",
    touchedFiles: ["apps/gui/src/App.tsx", "docs/architecture/012-coding-session-trace.md"],
    editCount: 2,
    patchBytes: 2048,
    contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    summary: "Reviewable patch metadata is ready",
  },
  policy: {
    decision: "ready_for_user_apply",
    requiresUserConfirmation: true,
    reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only"],
  },
  verification: {
    commandId: "repository-check",
    status: "not_requested",
  },
  summary: "Patch can be applied after explicit user confirmation",
};

const baseRun: AgentRunInput = {
  goal: {
    id: "goal-s43-report",
    title: "Add a visible one-step Agent Run shell",
    summary: "Prepare one manual Agent Run step",
  },
  proposal: {
    id: "proposal-s43-report",
    summary: "Patch metadata detected",
    touchedFiles: ["apps/gui/src/App.tsx", "docs/architecture/012-coding-session-trace.md"],
  },
  boundedLoop: readyLoop,
};

function cloneRun(): AgentRunInput {
  return structuredClone(baseRun) as AgentRunInput;
}

describe("createAgentRunReport", () => {
  it("creates a successful one-step run report without overclaiming autonomy", () => {
    const run = cloneRun();
    run.applyRequest = { requested: true, source: "user", requestId: "apply-report-1" };
    run.applyResult = { status: "applied", appliedFileCount: 2, summary: "User-confirmed apply completed" };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-report-1" };
    run.verificationResult = { status: "succeeded", exitCode: 0, durationMs: 1234, outputTail: "repository check passed" };

    const report = createAgentRunReport(run);

    expect(report.kind).toBe("success");
    expect(report.status).toBe("succeeded");
    expect(report.state).toBe("verified");
    expect(report.title).toContain("user-confirmed verification");
    expect(report.summary).toContain("no autonomous follow-up");
    expect(report.userConfirmedSteps).toEqual(["apply_requested_by_user", "apply_result_recorded", "verification_requested_by_user", "verification_result_recorded"]);
    expect(report.details.verificationCommandId).toBe("repository-check");
    expect(report.details.verificationExitCode).toBe(0);
    expect(report.details.touchedFileCount).toBe(2);
    expect(report.details.editCount).toBe(2);
  });

  it("creates a failed verification report with bounded sanitized output tail", () => {
    const run = cloneRun();
    run.applyRequest = { requested: true, source: "user", requestId: "apply-report-1" };
    run.applyResult = { status: "applied", appliedFileCount: 2 };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-report-1" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 2222, outputTail: "repository check failed with bounded output tail" };

    const report = createAgentRunReport(run);

    expect(report.kind).toBe("failed_verification");
    expect(report.status).toBe("failed");
    expect(report.state).toBe("verification_failed");
    expect(report.summary).toContain("no automatic repair");
    expect(report.details.verificationExitCode).toBe(1);
    expect(report.details.verificationOutputTail).toContain("bounded output tail");
  });

  it("creates a failed apply report with only sanitized bounded apply metadata", () => {
    const run = cloneRun();
    run.applyRequest = { requested: true, source: "user", requestId: "apply-report-failed" };
    run.applyResult = { status: "failed", summary: "Host declined apply after user confirmation", appliedFileCount: 9999 };

    const report = createAgentRunReport(run);
    const traceDetails = createAgentRunTraceDetails(run);
    const rendered = JSON.stringify({ report, traceDetails });

    expect(report.kind).toBe("failed_apply");
    expect(report.status).toBe("failed");
    expect(report.state).toBe("blocked");
    expect(report.summary).toContain("no automatic repair or retry");
    expect(report.userConfirmedSteps).toEqual(["apply_requested_by_user", "apply_result_recorded"]);
    expect(report.details.applyRequestId).toBe("apply-report-failed");
    expect(report.details.applyStatus).toBe("failed");
    expect(report.details.applySummary).toBe("Host declined apply after user confirmation");
    expect(report.details.appliedFileCount).toBeUndefined();
    expect(traceDetails.applyStatus).toBe("failed");
    expect(rendered).not.toContain("apps/gui/src/App.tsx");
  });

  it("distinguishes rollback-available state as user-reviewable only", () => {
    const run = cloneRun();
    run.applyResult = { status: "applied", appliedFileCount: 2 };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-report-1" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 2222, outputTail: "repository check failed" };
    run.rollback = { available: true, summary: "Checkpoint rollback can be offered to the user" };

    const report = createAgentRunReport(run);

    expect(report.kind).toBe("rollback_available");
    expect(report.status).toBe("pending");
    expect(report.rollbackAvailable).toBe(true);
    expect(report.summary).toContain("never runs by itself");
    expect(report.details.rollbackAvailable).toBe(true);
  });

  it("creates a blocked prerequisites report", () => {
    const report = createAgentRunReport({
      goal: { id: "goal-blocked", title: "Ship one safe run" },
      proposal: { id: "proposal-blocked", summary: "Patch detected" },
    });

    expect(report.kind).toBe("blocked_prerequisites");
    expect(report.status).toBe("blocked");
    expect(report.state).toBe("prerequisites_blocked");
    expect(report.summary).toContain("Prerequisites must be reviewed");
    expect(report.diagnostics.join(" ")).toContain("Checkpoint and policy metadata");
  });

  it("drops or redacts unsafe fields from report helpers", () => {
    const run = cloneRun() as AgentRunInput & {
      rawPrompt: string;
      rawDiff: string;
      command: string;
      cwd: string;
      providerPayload: string;
      stackTrace: string;
      privatePath: string;
    };
    run.rawPrompt = "PROMPT_SENTINEL";
    run.rawDiff = "DIFF_SENTINEL";
    run.command = "npm test -- --watch";
    run.cwd = "/Users/alice/project";
    run.providerPayload = "MODEL_RESPONSE_SENTINEL";
    run.stackTrace = "Traceback (most recent call last):\n  File \"/Users/alice/x.py\", line 1";
    run.privatePath = "/Users/alice/private/file.ts";
    run.applyRequest = { requested: true, source: "assistant", requestId: "apply-report-unsafe" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 10, outputTail: "api_key=sk-secret123456789 /Users/alice/private" };

    const report = createAgentRunReport(run);
    const traceDetails = createAgentRunTraceDetails(run);
    const rendered = JSON.stringify({ report, traceDetails });

    expect(report.kind).toBe("blocked");
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(rendered).not.toContain("DIFF_SENTINEL");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("--watch");
    expect(rendered).not.toContain("MODEL_RESPONSE_SENTINEL");
    expect(rendered).not.toContain("Traceback");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("bounds report details and output text", () => {
    const run = cloneRun();
    run.applyResult = { status: "applied", appliedFileCount: 2 };
    run.verificationRequest = { requested: true, source: "user", requestId: "verify-report-1" };
    run.verificationResult = { status: "failed", exitCode: 1, durationMs: 2222, outputTail: "tail ".repeat(400) };

    const report = createAgentRunReport(run);

    expect(Object.keys(report.details).length).toBeLessThanOrEqual(36);
    expect(String(report.details.verificationOutputTail).length).toBeLessThanOrEqual(321);
    expect(report.summary.length).toBeLessThanOrEqual(760);
  });

  it("does not persist reports to browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();

    const report = createAgentRunReport(baseRun);

    expect(report.kind).toBe("in_progress");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
