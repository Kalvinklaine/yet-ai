import { describe, expect, it } from "vitest";
import { createControlledAgentDevPreviewReport } from "./controlledAgentDevPreviewReport";

function readyInput(): Record<string, unknown> {
  return {
    host: "vscode",
    status: "completed",
    capabilities: {
      explicit_start: true,
      bounded_read: true,
      bounded_edit: true,
      allowlisted_verification: true,
      bounded_repair: true,
      sanitized_report: true,
    },
    counters: {
      loopSteps: 1,
      fileReads: 1,
      filesTouched: 1,
      verificationRuns: 1,
      repairAttempts: 0,
      userTurns: 2,
      runtimeSeconds: 18,
    },
    currentUserAction: "review",
    evidence: [
      { kind: "start", status: "confirmed", summary: "Explicit VS Code user start recorded." },
      { kind: "verification", status: "succeeded", summary: "Allowlisted verification passed." },
    ],
  };
}

describe("createControlledAgentDevPreviewReport", () => {
  it("reports VS Code completed with bounded capabilities counters and safety boundaries", () => {
    const result = createControlledAgentDevPreviewReport(readyInput());

    expect(result.host).toBe("vscode");
    expect(result.hostLabel).toBe("VS Code host");
    expect(result.status).toBe("completed");
    expect(result.statusLabel).toBe("Completed with sanitized evidence");
    expect(result.capabilityLabels).toEqual([
      "Explicit user start required",
      "One bounded local read",
      "One bounded user-confirmed edit",
      "One allowlisted verification run",
      "One user-confirmed bounded repair attempt",
      "Sanitized display-only report",
    ]);
    expect(result.counters).toEqual({ loopSteps: 1, fileReads: 1, filesTouched: 1, verificationRuns: 1, repairAttempts: 0, userTurns: 2, runtimeSeconds: 18 });
    expect(result.currentUserActionLabel).toBe("User should review sanitized report evidence.");
    expect(result.limitationLabels).toEqual(["No current dev-preview limitations were reported."]);
    expect(result.evidence).toEqual([
      { label: "Explicit start evidence: confirmed", summary: "Explicit VS Code user start recorded." },
      { label: "Allowlisted verification evidence: succeeded", summary: "Allowlisted verification passed." },
    ]);
    expect(result.safetyBoundaryLabels).toContain("Report is display-only sanitized metadata, not runtime authority.");
  });

  it("reports failed verification without automatic repair or raw output", () => {
    const result = createControlledAgentDevPreviewReport({
      ...readyInput(),
      status: "failed",
      currentUserAction: "retry",
      limitations: ["verification_failed"],
      evidence: [{ kind: "verification", status: "failed", summary: "Allowlisted verification failed." }],
    });

    expect(result.status).toBe("failed");
    expect(result.statusLabel).toBe("Failed closed");
    expect(result.currentUserActionLabel).toBe("User may retry after fixing the reported local limitation.");
    expect(result.limitationLabels).toContain("Allowlisted verification failed; no automatic repair is started.");
    expect(result.safetyBoundaryLabels).toContain("No automatic start; the user must explicitly start the dev-preview.");
  });

  it("reports stopped dev-preview as requiring a new explicit action", () => {
    const result = createControlledAgentDevPreviewReport({
      host: "vscode",
      status: "stopped",
      capabilities: { explicit_start: true, sanitized_report: true },
      counters: { loopSteps: 1, runtimeSeconds: 7 },
      evidence: [{ kind: "stop", status: "user_stop", summary: "User stopped the dev-preview." }],
    });

    expect(result.status).toBe("stopped");
    expect(result.statusLabel).toBe("Stopped by explicit boundary");
    expect(result.currentUserActionLabel).toBe("User may start again only with a new explicit action.");
    expect(result.limitationLabels).toContain("Controlled dev-preview is stopped until the user starts it again.");
  });

  it("reports browser as unsupported and capability-limited", () => {
    const result = createControlledAgentDevPreviewReport({
      ...readyInput(),
      host: "browser",
      status: "completed",
    });

    expect(result.host).toBe("browser");
    expect(result.status).toBe("blocked");
    expect(result.capabilityLabels).toEqual(["Sanitized display-only report"]);
    expect(result.limitationLabels).toContain("Browser preview cannot start the controlled local agent dev-preview.");
  });

  it("reports JetBrains as partial and fail-closed beyond readiness metadata", () => {
    const ready = createControlledAgentDevPreviewReport({
      host: "jetbrains",
      status: "ready",
      capabilities: { explicit_start: true, sanitized_report: true },
    });
    const running = createControlledAgentDevPreviewReport({
      host: "jetbrains",
      status: "running",
      capabilities: { explicit_start: true, bounded_read: true, sanitized_report: true },
    });

    expect(ready.status).toBe("ready");
    expect(ready.limitationLabels).toContain("JetBrains support is partial and fail-closed in this VS Code-first dev-preview.");
    expect(running.status).toBe("blocked");
    expect(running.statusLabel).toBe("Blocked until local readiness returns");
    expect(running.limitationLabels).toContain("JetBrains support is partial and fail-closed in this VS Code-first dev-preview.");
  });

  it("redacts unsafe evidence and omits raw-looking metadata", () => {
    const result = createControlledAgentDevPreviewReport({
      host: "vscode /Users/alice/private sk-proj-123456789",
      status: "completed",
      capabilities: { sanitized_report: true, bounded_read: true },
      counters: { loopSteps: 1, runtimeSeconds: 4, editBytes: 5000 },
      evidence: [
        { kind: "verification", status: "failed", summary: "raw command output /Users/alice/private sk-proj-123456789" },
        { kind: "read", status: "completed", rawFileBody: "secret file body" },
      ],
      safetyBoundaries: ["metadata_only", "no_raw_secrets"],
    });
    const rendered = JSON.stringify(result);

    expect(result.host).toBe("unknown");
    expect(result.status).toBe("blocked");
    expect(result.counters).toEqual({ loopSteps: 1, runtimeSeconds: 4 });
    expect(result.capabilityLabels).toEqual(["Sanitized display-only report"]);
    expect(result.evidence).toEqual([
      { label: "Allowlisted verification evidence: failed", summary: "Sanitized evidence summary was unavailable." },
      { label: "Omitted unsafe evidence", summary: "Evidence omitted because it looked unsafe for dev-preview reporting." },
    ]);
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-proj-123456789");
    expect(rendered).not.toContain("raw command output");
    expect(rendered).not.toContain("secret file body");
    expect(rendered).not.toContain("editBytes");
  });
});
