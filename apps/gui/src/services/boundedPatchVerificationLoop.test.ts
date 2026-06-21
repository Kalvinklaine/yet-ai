import { describe, expect, it } from "vitest";
import { createCodingSessionTraceEntry } from "./codingSessionTrace";
import { evaluateBoundedPatchVerificationLoop, type BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";

const readyLoop: BoundedPatchVerificationLoopMetadata = {
  kind: "bounded_patch_verification_loop",
  version: "2026-06-21",
  authority: "metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  status: "ready_for_apply",
  loopId: "loop-s42-ready",
  sandbox: {
    modeStatus: "checkpoint_ready",
    checkpointId: "checkpoint-s42-ready",
    checkpointVerified: true,
    checkpointHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    checkedAt: "2026-06-21T18:00:00Z",
    label: "Verified disposable checkpoint",
  },
  limits: {
    maxTouchedFiles: 4,
    maxPatchBytes: 12000,
    maxSteps: 4,
    maxVerificationSeconds: 600,
  },
  patch: {
    proposalId: "proposal-s42-ready",
    source: "assistant_proposal",
    touchedFiles: ["apps/gui/src/App.tsx", "docs/README.md"],
    editCount: 3,
    patchBytes: 2048,
    contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    summary: "Reviewable bounded patch metadata is ready",
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
  summary: "One reviewed patch can be applied after explicit user confirmation",
};

function cloneReadyLoop(): Record<string, unknown> {
  return structuredClone(readyLoop) as Record<string, unknown>;
}

function nestedObject(input: Record<string, unknown>, key: string): Record<string, unknown> {
  return input[key] as Record<string, unknown>;
}

describe("evaluateBoundedPatchVerificationLoop", () => {
  it("returns disabled incomplete state for missing input", () => {
    const result = evaluateBoundedPatchVerificationLoop(undefined);

    expect(result.state).toBe("disabled");
    expect(result.nextUserAction).toBe("none");
    expect(result.allowedToAutoApply).toBe(false);
    expect(result.allowedToAutoRunVerification).toBe(false);
    expect(result.allowedToAutoRollback).toBe(false);
    expect(result.canStartAutonomousLoop).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("missing_input");
  });

  it("blocks malformed and unsafe input without leaking raw payload", () => {
    const result = evaluateBoundedPatchVerificationLoop("command: npm test cwd /Users/alice/project sk-secret123456789");
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unsafe_metadata", "malformed_input"]));
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("reaches explicit user apply ready state for valid metadata only", () => {
    const result = evaluateBoundedPatchVerificationLoop(readyLoop);

    expect(result.state).toBe("ready_for_user_apply");
    expect(result.nextUserAction).toBe("confirm_apply");
    expect(result.diagnostics).toEqual([]);
    expect(result.allowedToAutoApply).toBe(false);
    expect(result.allowedToAutoRunVerification).toBe(false);
    expect(result.allowedToAutoRollback).toBe(false);
    expect(result.canStartAutonomousLoop).toBe(false);
    expect(result.details.touchedFiles).toEqual(["apps/gui/src/App.tsx", "docs/README.md"]);
    expect(result.details.verificationCommandId).toBe("repository-check");
    expect(JSON.stringify(result)).not.toContain("sha256:aaaaaaaa");
  });

  it("requires checkpoint-ready or rollback-ready verified sandbox metadata", () => {
    const input = cloneReadyLoop();
    nestedObject(input, "sandbox").modeStatus = "blocked";
    nestedObject(input, "sandbox").checkpointVerified = false;

    const result = evaluateBoundedPatchVerificationLoop(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["sandbox_not_ready", "checkpoint_not_verified"]));
  });

  it("blocks assistant authority attempts even when patch is assistant authored", () => {
    const input = cloneReadyLoop();
    nestedObject(input, "policy").requiresUserConfirmation = false;
    input.loopId = "assistant-loop-1";

    const result = evaluateBoundedPatchVerificationLoop(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["assistant_authority_blocked", "missing_trusted_request_correlation"]));
    expect(result.allowedToAutoApply).toBe(false);
  });

  it("blocks unsafe touched paths", () => {
    const input = cloneReadyLoop();
    nestedObject(input, "patch").touchedFiles = ["../secret.txt", "apps/gui/src/App.tsx"];

    const result = evaluateBoundedPatchVerificationLoop(input);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_path");
    expect(rendered).not.toContain("../secret.txt");
  });

  it("blocks touched file count edit count and patch bytes outside limits", () => {
    const input = cloneReadyLoop();
    nestedObject(input, "limits").maxTouchedFiles = 1;
    nestedObject(input, "limits").maxPatchBytes = 100;
    nestedObject(input, "limits").maxSteps = 1;

    const result = evaluateBoundedPatchVerificationLoop(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code).filter((code) => code === "limit_exceeded").length).toBeGreaterThanOrEqual(3);
  });

  it("blocks patch bytes larger than the absolute contract maximum", () => {
    const input = cloneReadyLoop();
    nestedObject(input, "patch").patchBytes = 50001;

    const result = evaluateBoundedPatchVerificationLoop(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("malformed_input");
  });

  it("blocks raw command cwd env args and execution payload fields", () => {
    const input = cloneReadyLoop();
    input.command = "npm test";
    input.cwd = "/Users/alice/project";
    input.env = { API_KEY: "sk-secret123456789" };
    input.args = ["--runInBand"];

    const result = evaluateBoundedPatchVerificationLoop(input);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unknown_or_invalid_field", "raw_execution_metadata", "unsafe_metadata"]));
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("--runInBand");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("blocks unknown command ids", () => {
    const input = cloneReadyLoop();
    nestedObject(input, "verification").commandId = "npm-test";

    const result = evaluateBoundedPatchVerificationLoop(input);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unknown_command_id");
  });

  it("blocks raw diff file body private path secret marker and stack trace text", () => {
    const input = cloneReadyLoop();
    input.rawDiff = "diff --git SECRET_SENTINEL";
    nestedObject(input, "patch").summary = "raw file body SECRET_SENTINEL at run (/Users/alice/project/app.ts:1:2) sk-secret123456789";

    const result = evaluateBoundedPatchVerificationLoop(input);
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["raw_execution_metadata", "unsafe_metadata"]));
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("returns ready-for-verification state after user apply metadata", () => {
    const input = cloneReadyLoop();
    input.status = "ready_for_verification";
    nestedObject(input, "patch").source = "gui_review";
    nestedObject(input, "policy").decision = "ready_for_user_verification";
    nestedObject(input, "policy").reasonCodes = ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "user_apply_result_recorded", "allowlisted_verification_command_id"];
    nestedObject(input, "verification").status = "ready";

    const result = evaluateBoundedPatchVerificationLoop(input);

    expect(result.state).toBe("ready_for_user_verification");
    expect(result.nextUserAction).toBe("confirm_verification");
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps trace entries sanitized and bounded for verification results", () => {
    const input = cloneReadyLoop();
    input.status = "verified";
    nestedObject(input, "patch").source = "gui_review";
    nestedObject(input, "policy").decision = "completed";
    nestedObject(input, "policy").reasonCodes = ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "user_apply_result_recorded", "allowlisted_verification_command_id", "sanitized_result_metadata_only"];
    nestedObject(input, "verification").status = "succeeded";
    nestedObject(input, "verification").result = {
      exitCode: 0,
      durationMs: 1250,
      outputTail: "Repository check completed with sanitized metadata".repeat(20),
      truncated: true,
      resultHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    };
    const evaluation = evaluateBoundedPatchVerificationLoop(input);
    const entry = createCodingSessionTraceEntry({
      family: "boundedLoop.verificationResult",
      title: "Bounded verification result",
      status: "succeeded",
      summary: evaluation.summary,
      requestId: "loop-s42-ready",
      details: {
        ...evaluation.details,
        command: "npm test",
        cwd: "/Users/alice/project",
        rawOutput: "SECRET_SENTINEL",
      },
    }, { id: "trace-bounded-loop", timestamp: new Date("2026-06-21T18:00:00Z") });
    const rendered = JSON.stringify(entry);

    expect(evaluation.state).toBe("completed");
    expect(entry.family).toBe("boundedLoop.verificationResult");
    expect(rendered).toContain("[redacted]");
    expect(rendered.length).toBeLessThan(2200);
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("SECRET_SENTINEL");
  });

  it("does not write browser storage while evaluating metadata", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = evaluateBoundedPatchVerificationLoop(readyLoop);

    expect(result.state).toBe("ready_for_user_apply");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
