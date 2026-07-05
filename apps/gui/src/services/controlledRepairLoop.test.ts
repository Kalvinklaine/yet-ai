import { describe, expect, it } from "vitest";
import commandFailed from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-failed.json";
import commandRunning from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-running.json";
import commandSucceeded from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-succeeded.json";
import commandTimedOut from "../../../../packages/contracts/examples/engine/controlled-agent-command-runner-timed_out.json";
import { evaluateControlledAgentRepairLoop } from "./controlledAgentRepairLoop";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("controlledRepairLoop", () => {
  it("marks failed verification eligible for one user-confirmed bounded repair", () => {
    const result = evaluateControlledAgentRepairLoop({ verification: clone(commandFailed), attemptCount: 0, maxAttempts: 1 });

    expect(result.state).toBe("eligible");
    expect(result.canAttemptRepair).toBe(true);
    expect(result.mustStop).toBe(false);
    expect(result.attemptCount).toBe(0);
    expect(result.maxAttempts).toBe(1);
    expect(result.autoStartAllowed).toBe(false);
    expect(result.executionAllowed).toBe(false);
    expect(result.canRunCommands).toBe(false);
    expect(result.details.repairEnabled).toBe(true);
  });

  it("treats timed-out verification as eligible failed verification metadata", () => {
    const result = evaluateControlledAgentRepairLoop({ verification: clone(commandTimedOut), attemptCount: 0, maxAttempts: 1 });

    expect(result.state).toBe("eligible");
    expect(result.canAttemptRepair).toBe(true);
    expect(result.details.previousVerificationStatus).toBe("timed_out");
  });

  it("blocks ineligible verification statuses", () => {
    const succeeded = evaluateControlledAgentRepairLoop({ verification: clone(commandSucceeded), attemptCount: 0, maxAttempts: 1 });
    const running = evaluateControlledAgentRepairLoop({ verification: clone(commandRunning), attemptCount: 0, maxAttempts: 1 });

    expect(succeeded.state).toBe("blocked");
    expect(succeeded.canAttemptRepair).toBe(false);
    expect(succeeded.stop?.reason).toBe("ineligible_verification_status");
    expect(running.state).toBe("blocked");
    expect(running.canAttemptRepair).toBe(false);
    expect(running.stop?.reason).toBe("ineligible_verification_status");
  });

  it("enforces the one-attempt cap after repair verification", () => {
    const result = evaluateControlledAgentRepairLoop({
      verification: clone(commandFailed),
      attemptCount: 0,
      maxAttempts: 1,
      userConfirmed: true,
      proposal: { state: "completed", summary: "sanitized repair proposal" },
      edit: { state: "applied", summary: "bounded repair edit" },
      repairVerification: clone(commandFailed),
    });

    expect(result.state).toBe("exhausted");
    expect(result.mustStop).toBe(true);
    expect(result.canAttemptRepair).toBe(false);
    expect(result.attemptCount).toBe(1);
    expect(result.verificationRuns).toBe(1);
  });

  it("stops before another repair when the attempt cap is already spent", () => {
    const result = evaluateControlledAgentRepairLoop({ verification: clone(commandFailed), attemptCount: 1, maxAttempts: 1 });

    expect(result.state).toBe("exhausted");
    expect(result.mustStop).toBe(true);
    expect(result.stop?.reason).toBe("attempts_exhausted");
    expect(result.canAttemptRepair).toBe(false);
  });

  it("stops on explicit user stop without starting repair", () => {
    const result = evaluateControlledAgentRepairLoop({ verification: clone(commandFailed), attemptCount: 0, maxAttempts: 1, userStopped: true });

    expect(result.state).toBe("stopped");
    expect(result.mustStop).toBe(true);
    expect(result.stop?.reason).toBe("user_stop");
    expect(result.canAttemptRepair).toBe(false);
  });

  it("requires user confirmation before proposal, edit, or repair verification metadata", () => {
    const result = evaluateControlledAgentRepairLoop({
      verification: clone(commandFailed),
      attemptCount: 0,
      maxAttempts: 1,
      proposal: { state: "completed", summary: "assistant prepared proposal" },
    });

    expect(result.state).toBe("blocked");
    expect(result.stop?.reason).toBe("missing_user_confirmation");
    expect(result.canAttemptRepair).toBe(false);
  });

  it("sanitizes unsafe diagnostics and never returns raw repair metadata", () => {
    const result = evaluateControlledAgentRepairLoop({
      verification: clone(commandFailed),
      attemptCount: 0,
      maxAttempts: 1,
      userConfirmed: true,
      proposal: { state: "completed", rawPrompt: "secret raw prompt" },
      edit: { state: "applied", rawDiff: "diff -- private" },
    });
    const rendered = JSON.stringify(result);

    expect(result.state).toBe("blocked");
    expect(result.diagnostics.some((item) => item.code === "unsafe_metadata")).toBe(true);
    expect(rendered).not.toContain("secret raw prompt");
    expect(rendered).not.toContain("diff -- private");
    expect(rendered).not.toContain("rawPrompt");
    expect(rendered).not.toContain("rawDiff");
  });
});
