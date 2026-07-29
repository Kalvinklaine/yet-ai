import type { BridgeHost } from "../bridge/bridgeAdapter";
import { evaluateControlledAgentRecoveryMatrix, type ControlledAgentRecoveryVisibleState } from "./controlledAgentRecoveryMatrix";
import { sanitizeDisplayText } from "./redaction";

export type ControlledRecoveryPresentationItem = {
  key: string;
  state: "ready" | "blocked";
  label: string;
  guidance: string;
  retryBudgetLabel: string;
  diagnosticLabels: string[];
};

export type ControlledRecoveryPresentation = {
  items: ControlledRecoveryPresentationItem[];
  provenanceLabel: string;
};

export function buildControlledRecoveryPresentation(input: {
  host: BridgeHost | "unknown";
  visibleStates: readonly unknown[];
  provenanceLabel?: string;
}): ControlledRecoveryPresentation {
  const seen = new Set<string>();
  const items = input.visibleStates.flatMap((userVisibleState) => {
    const key = typeof userVisibleState === "string" ? userVisibleState : "blocked";
    if (seen.has(key)) return [];
    seen.add(key);
    const attemptBudget = recoveryAttemptBudget(userVisibleState);
    const evaluation = evaluateControlledAgentRecoveryMatrix({
      userVisibleState,
      host: input.host,
      terminal: userVisibleState === "stop_completed" || userVisibleState === "repair_followup_exhausted" || userVisibleState === "unsupported_host",
      attemptBudget,
      privacy: { sanitizedOnly: true, rawOutputStored: false, privatePathStored: false, secretStored: false },
      policyFlags: { hiddenRetryAllowed: false, automaticRollbackAllowed: false, hiddenRepairAllowed: false, staleResultAccepted: false, rawOutputPersistenceAllowed: false, privatePathPersistenceAllowed: false, secretPersistenceAllowed: false, unboundedRepairAllowed: false, unsupportedHostClaimsSupport: false },
    });
    return [{
      key: sanitizeDisplayText(evaluation.userVisibleState ?? key),
      state: evaluation.state,
      label: sanitizeDisplayText((evaluation.userVisibleState ?? "blocked").replace(/_/g, " ")),
      guidance: sanitizeDisplayText(evaluation.guidance),
      retryBudgetLabel: retryBudgetPresentation(attemptBudget),
      diagnosticLabels: evaluation.diagnostics.map((item) => `${sanitizeDisplayText(item.code)}: ${sanitizeDisplayText(item.message)}`),
    }];
  });
  return {
    items,
    provenanceLabel: sanitizeDisplayText(input.provenanceLabel ?? "unsupported"),
  };
}

function recoveryAttemptBudget(userVisibleState: unknown) {
  const retryable = userVisibleState === "host_disconnect_runtime_restart" || userVisibleState === "provider_timeout" || userVisibleState === "verification_bundle_failure";
  return { maxAttempts: retryable ? 1 : 0, attemptsUsed: 0, moreAttemptsAllowed: retryable, requiresUserConfirmation: true };
}

function retryBudgetPresentation(budget: ReturnType<typeof recoveryAttemptBudget>): string {
  if (budget.maxAttempts === 0) return "Retry budget: no retry available · user confirmation required";
  return `Retry budget: ${budget.attemptsUsed}/${budget.maxAttempts} used · ${budget.moreAttemptsAllowed ? "one manual retry available" : "exhausted"} · user confirmation required`;
}

export function controlledRecoveryBaseStates(): ControlledAgentRecoveryVisibleState[] {
  return ["stale_duplicate_result", "host_disconnect_runtime_restart", "provider_timeout", "edit_hash_mismatch", "verification_bundle_failure", "checkpoint_rollback_review"];
}
