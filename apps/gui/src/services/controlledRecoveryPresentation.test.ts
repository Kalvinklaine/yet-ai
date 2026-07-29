import { describe, expect, it } from "vitest";
import { buildControlledRecoveryPresentation } from "./controlledRecoveryPresentation";

describe("controlledRecoveryPresentation", () => {
  it("centralizes sanitized labels and bounded retry-budget presentation", () => {
    const presentation = buildControlledRecoveryPresentation({
      host: "vscode",
      visibleStates: ["provider_timeout", "checkpoint_rollback_review", "provider_timeout"],
      provenanceLabel: "local derived",
    });

    expect(presentation.provenanceLabel).toBe("local derived");
    expect(presentation.items).toHaveLength(2);
    expect(presentation.items[0]).toMatchObject({
      state: "ready",
      label: "provider timeout",
      retryBudgetLabel: "Retry budget: 0/1 used · one manual retry available · user confirmation required",
    });
    expect(presentation.items[1]?.retryBudgetLabel).toBe("Retry budget: no retry available · user confirmation required");
  });

  it("blocks and redacts unknown unsafe metadata", () => {
    const secret = "access_token=" + "s".repeat(64);
    const presentation = buildControlledRecoveryPresentation({
      host: "browser",
      visibleStates: [secret],
      provenanceLabel: `fixture demo ${secret}`,
    });
    const output = JSON.stringify(presentation);

    expect(presentation.items[0]?.state).toBe("blocked");
    expect(presentation.items[0]?.label).toBe("blocked");
    expect(presentation.items[0]?.diagnosticLabels.join(" ")).toContain("unsafe_metadata");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("s".repeat(64));
  });
});
