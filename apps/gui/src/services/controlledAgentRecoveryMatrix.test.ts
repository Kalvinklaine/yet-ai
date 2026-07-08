import { describe, expect, it } from "vitest";
import { controlledAgentRecoveryVisibleStateForCategory, evaluateControlledAgentRecoveryMatrix, type ControlledAgentRecoveryCategory, type ControlledAgentRecoveryVisibleState } from "./controlledAgentRecoveryMatrix";

function input(overrides: Record<string, unknown> = {}) {
  return {
    userVisibleState: "host_disconnect_runtime_restart",
    category: "disconnect",
    terminal: false,
    resultAccepted: false,
    hostSupportClaimed: false,
    attemptBudget: {
      maxAttempts: 1,
      attemptsUsed: 0,
      moreAttemptsAllowed: true,
      requiresUserConfirmation: true,
    },
    allowedNextActions: ["request_user_choice", "manual_retry", "start_new_run"],
    privacy: {
      sanitizedOnly: true,
      rawOutputStored: false,
      privatePathStored: false,
      secretStored: false,
    },
    policyFlags: {
      hiddenRetryAllowed: false,
      automaticRollbackAllowed: false,
      hiddenRepairAllowed: false,
      unboundedRepairAllowed: false,
      rawOutputPersistenceAllowed: false,
      privatePathPersistenceAllowed: false,
      secretPersistenceAllowed: false,
      staleResultAccepted: false,
      unsupportedHostClaimsSupport: false,
    },
    summary: "Disconnected host can resume only after a user choice",
    ...overrides,
  };
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

describe("controlledAgentRecoveryMatrix", () => {
  it("maps each recovery category to visible guidance without executable authority", () => {
    const cases: Array<[ControlledAgentRecoveryCategory, ControlledAgentRecoveryVisibleState]> = [
      ["stop", "stop_requested"],
      ["stale", "stale_duplicate_result"],
      ["disconnect", "host_disconnect_runtime_restart"],
      ["timeout", "provider_timeout"],
      ["edit_mismatch", "edit_hash_mismatch"],
      ["verification_failure", "verification_bundle_failure"],
      ["repair_exhausted", "repair_followup_exhausted"],
      ["rollback_review", "checkpoint_rollback_review"],
      ["unsupported_host", "unsupported_host"],
    ];

    for (const [category, userVisibleState] of cases) {
      const result = evaluateControlledAgentRecoveryMatrix(input({ category, userVisibleState }));

      expect(result.state).toBe("ready");
      expect(result.category).toBe(category);
      expect(result.userVisibleState).toBe(userVisibleState);
      expect(result.guidance).not.toBe("[redacted]");
      expect(result.allowedManualNextActions.every((action) => action.manualOnly && action.actionPayload === null)).toBe(true);
      expect(Object.values(result.authority).filter((value) => value === true)).toEqual([true]);
      expect(result.authority.displayOnly).toBe(true);
      expect(result.authority.executionAllowed).toBe(false);
      expect(result.authority.canAutoRetry).toBe(false);
      expect(result.authority.canAutoRollback).toBe(false);
      expect(result.authority.canAutoRepair).toBe(false);
      expect(result.authority.canMutateWorkspace).toBe(false);
    }
  });

  it("exposes category fallback helper for contract categories", () => {
    expect(controlledAgentRecoveryVisibleStateForCategory("verification_failure")).toBe("verification_bundle_failure");
    expect(controlledAgentRecoveryVisibleStateForCategory("unsupported_host")).toBe("unsupported_host");
  });

  it("keeps manual retry guidance bounded by user confirmation and remaining attempts", () => {
    const result = evaluateControlledAgentRecoveryMatrix(input({
      userVisibleState: "provider_timeout",
      category: "timeout",
      attemptBudget: { maxAttempts: 1, attemptsUsed: 1, moreAttemptsAllowed: false, requiresUserConfirmation: true },
      allowedNextActions: ["acknowledge", "manual_retry", "start_new_run"],
    }));

    expect(result.state).toBe("ready");
    expect(result.allowedManualNextActions.map((action) => action.kind)).toEqual(["acknowledge", "start_new_run"]);
  });

  it("fails closed for missing or malformed input", () => {
    const missing = evaluateControlledAgentRecoveryMatrix(undefined);
    const malformed = evaluateControlledAgentRecoveryMatrix(input({ userVisibleState: "magical_recovery" }));

    expect(missing.state).toBe("blocked");
    expect(missing.diagnostics.map((item) => item.code)).toContain("missing_input");
    expect(malformed.state).toBe("blocked");
    expect(malformed.diagnostics.map((item) => item.code)).toContain("malformed_input");
    expect(missing.allowedManualNextActions).toEqual([]);
    expect(malformed.allowedManualNextActions).toEqual([]);
  });

  it("fails closed for automatic retry, rollback, and hidden repair claims", () => {
    const result = evaluateControlledAgentRecoveryMatrix(input({
      policyFlags: {
        hiddenRetryAllowed: true,
        automaticRollbackAllowed: true,
        hiddenRepairAllowed: true,
      },
    }));

    expect(result.state).toBe("blocked");
    expect(result.allowedManualNextActions).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toContain("automatic_recovery_blocked");
    expect(result.authority.canAutoRetry).toBe(false);
    expect(result.authority.canAutoRollback).toBe(false);
    expect(result.authority.canAutoRepair).toBe(false);
  });

  it("fails closed for stale result acceptance", () => {
    const result = evaluateControlledAgentRecoveryMatrix(input({
      userVisibleState: "stale_duplicate_result",
      category: "stale",
      resultAccepted: true,
      policyFlags: { staleResultAccepted: true },
    }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("stale_acceptance_blocked");
    expect(result.authority.canAcceptStaleResult).toBe(false);
  });

  it("fails closed and redacts raw output, private paths, and secrets", () => {
    const result = evaluateControlledAgentRecoveryMatrix(input({
      summary: "raw output stored at /Users/alice/project with Authorization: Bearer unsafe-token",
      privacy: {
        sanitizedOnly: false,
        rawOutputStored: true,
        privatePathStored: true,
        secretStored: true,
      },
    }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(result.diagnostics.map((item) => item.code)).toContain("raw_private_or_secret_blocked");
    expect(output(result)).not.toContain("/Users/alice");
    expect(output(result)).not.toContain("unsafe-token");
  });

  it("fails closed for unbounded attempts", () => {
    const result = evaluateControlledAgentRecoveryMatrix(input({
      attemptBudget: { maxAttempts: 99, attemptsUsed: 3, moreAttemptsAllowed: true, requiresUserConfirmation: true },
      policyFlags: { unboundedRepairAllowed: true },
    }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unbounded_attempts_blocked");
  });

  it("fails closed for unsupported host support overclaims", () => {
    const result = evaluateControlledAgentRecoveryMatrix(input({
      userVisibleState: "unsupported_host",
      category: "unsupported_host",
      hostSupportClaimed: true,
      policyFlags: { unsupportedHostClaimsSupport: true },
    }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host_overclaim");
    expect(result.authority.hasExecutableAuthority).toBe(false);
  });

  it("blocks unsafe executable metadata keys", () => {
    const result = evaluateControlledAgentRecoveryMatrix(input({ command: "npm test", autoRetry: true }));

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(result.diagnostics.map((item) => item.code)).toContain("automatic_recovery_blocked");
    expect(output(result)).not.toContain("npm test");
  });
});
