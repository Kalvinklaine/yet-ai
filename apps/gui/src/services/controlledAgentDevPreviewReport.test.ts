import { describe, expect, it } from "vitest";
import { createControlledAgentDevPreviewReport, createSanitizedControlledRunExport } from "./controlledAgentDevPreviewReport";

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

  it("exports controlled-run metadata without raw prompt file diff command output provider or private path", () => {
    const result = createSanitizedControlledRunExport({
      runId: "run-105",
      host: "vscode",
      status: "completed",
      startedAt: "2026-07-07T01:00:00.000Z",
      completedAt: "2026-07-07T01:01:00.000Z",
      counters: { loopSteps: 4, fileReads: 1, filesTouched: 1, verificationRuns: 1, runtimeSeconds: 60 },
      trace: [
        { type: "start", outcome: "succeeded", label: "VS Code explicit start", summary: "User started the controlled run." },
        { type: "read", outcome: "succeeded", label: "docs/architecture", summary: "Read bounded architecture metadata.", fileBody: "FILE_BODY_SENTINEL" },
        { type: "verify", outcome: "succeeded", label: "repository-check", summary: "Allowlisted verification passed." },
      ],
      evidence: [
        { kind: "report", status: "completed", summary: "Sanitized final report ready." },
        { kind: "verification", status: "succeeded", summary: "Provider payload omitted." },
      ],
    });
    const rendered = JSON.stringify(result);

    expect(result.kind).toBe("controlled_run.sanitized_export");
    expect(result.displayOnly).toBe(true);
    expect(result.metadataOnly).toBe(true);
    expect(result.rawPayloadStored).toBe(false);
    expect(result.rawPayloadReturned).toBe(false);
    expect(result.executionAuthority).toBe(false);
    expect(result.host).toBe("vscode");
    expect(result.status).toBe("completed");
    expect(result.runId).toBe("run-105");
    expect(result.trace).toEqual([
      { type: "start", status: "succeeded", label: "VS Code explicit start", summary: "User started the controlled run." },
      { type: "verify", status: "succeeded", label: "repository-check", summary: "Allowlisted verification passed." },
    ]);
    expect(result.diagnostics).toEqual([{ code: "raw_payload_omitted", message: "Controlled-run trace item with raw payload fields was omitted." }]);
    expect(result.safetyBoundaryLabels).toContain("Report is display-only sanitized metadata, not runtime authority.");
    expect(rendered).not.toContain("FILE_BODY_SENTINEL");
    expect(rendered).not.toContain("rawPrompt");
    expect(rendered).not.toContain("rawDiff");
    expect(rendered).not.toContain("npm run");
    expect(rendered).not.toContain("outputTail");
    expect(rendered).not.toContain("providerPayload");
    expect(rendered).not.toContain("/Users/alice");
  });

  it("fails closed for unsafe controlled-run export metadata", () => {
    const result = createSanitizedControlledRunExport({
      runId: "sk-proj-123456789",
      host: "browser",
      status: "completed",
      startedAt: "/Users/alice/private/start",
      counters: { loopSteps: 1, runtimeSeconds: 2, rawOutputBytes: 9000 },
      trace: [
        { type: "shell", outcome: "executed", label: "npm run check", summary: "raw command output /Users/alice/private sk-proj-123456789" },
        { type: "report", outcome: "completed", label: "safe report", summary: "Sanitized metadata is available." },
        { type: "edit", outcome: "failed", label: "patch", summary: "diff sentinel", rawDiff: "DIFF_SENTINEL" },
      ],
      evidence: [
        { kind: "verification", status: "failed", summary: "raw output /Users/alice/private" },
        { kind: "status", status: "blocked", providerPayload: "PROVIDER_SENTINEL" },
      ],
      safetyBoundaries: ["metadata_only", "no_raw_secrets"],
    });
    const rendered = JSON.stringify(result);

    expect(result.host).toBe("browser");
    expect(result.status).toBe("blocked");
    expect(result.runId).toBeUndefined();
    expect(result.startedAt).toBeUndefined();
    expect(result.counters).toEqual({ loopSteps: 1, runtimeSeconds: 2 });
    expect(result.trace).toEqual([
      { type: "report", status: "recorded", label: "Sanitized report", summary: "Sanitized controlled-run metadata recorded; raw payload omitted." },
      { type: "report", status: "completed", label: "safe report", summary: "Sanitized metadata is available." },
    ]);
    expect(result.evidence).toEqual([
      { label: "Allowlisted verification evidence: failed", summary: "Sanitized evidence summary was unavailable." },
      { label: "Omitted unsafe evidence", summary: "Evidence omitted because it looked unsafe for dev-preview reporting." },
    ]);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["unsafe_metadata", "raw_payload_omitted"]);
    expect(rendered).not.toContain("sk-proj-123456789");
    expect(rendered).not.toContain("npm run check");
    expect(rendered).not.toContain("raw command output");
    expect(rendered).not.toContain("DIFF_SENTINEL");
    expect(rendered).not.toContain("PROVIDER_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("rawOutputBytes");
  });
});
