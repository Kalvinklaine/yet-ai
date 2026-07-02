import { describe, expect, it, vi } from "vitest";
import {
  appendCodingSessionTraceEntry,
  type CodingSessionTraceEntry,
  createCodingSessionTraceEntry,
  normalizeTraceFamily,
  normalizeTraceStatus,
  sanitizeTraceDetails,
  summarizeRejectedTraceInput,
} from "./codingSessionTrace";

const fixedDate = new Date("2026-06-21T12:00:00.000Z");

function fixedOptions() {
  return { id: "trace-1", timestamp: fixedDate };
}

describe("codingSessionTrace", () => {
  it("creates sanitized trace entries for the S39 event families", () => {
    const entry = createCodingSessionTraceEntry({
      family: "verification.result",
      title: "Verification finished",
      status: "succeeded",
      summary: "Command gui-app-tests finished",
      requestId: "request-1",
      details: {
        commandId: "gui-app-tests",
        exitCode: 0,
        truncated: false,
      },
    }, fixedOptions());

    expect(entry).toEqual({
      id: "trace-1",
      timestamp: "2026-06-21T12:00:00.000Z",
      family: "verification.result",
      title: "Verification finished",
      status: "succeeded",
      summary: "Command gui-app-tests finished",
      requestId: "request-1",
      details: {
        commandId: "gui-app-tests",
        exitCode: 0,
        truncated: false,
      },
    });
  });

  it("creates sanitized sandbox metadata-only trace entries", () => {
    const entry = createCodingSessionTraceEntry({
      family: "checkpoint.metadataVerified",
      title: "Checkpoint metadata verified",
      status: "succeeded",
      summary: "Verified disposable checkpoint metadata; execution remains disabled",
      requestId: "sandbox-request-1",
      details: {
        displayOnly: true,
        allowedToExecute: false,
        canStartLoop: false,
        checkpointStatus: "verified",
        rawFileBody: "SECRET_SENTINEL",
        command: "npm test",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("checkpoint.metadataVerified");
    expect(entry.details?.displayOnly).toBe(true);
    expect(entry.details?.allowedToExecute).toBe(false);
    expect(entry.details?.canStartLoop).toBe(false);
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("npm test");
    expect(localStorage.length).toBe(0);
  });

  it("creates sanitized bounded loop metadata-only trace entries", () => {
    localStorage.clear();
    const entry = createCodingSessionTraceEntry({
      family: "boundedLoop.applyReady",
      title: "Bounded loop apply ready",
      status: "pending",
      summary: "Patch metadata is waiting for explicit user action",
      requestId: "loop-s42-ready",
      details: {
        displayOnly: true,
        allowedToAutoApply: false,
        allowedToAutoRunVerification: false,
        allowedToAutoRollback: false,
        canStartAutonomousLoop: false,
        touchedFiles: ["apps/gui/src/App.tsx"],
        command: "npm test",
        rawDiff: "SECRET_SENTINEL",
        args: ["--watch"],
        cwd: "/Users/alice/project",
        env: { API_KEY: "sk-secret123456789" },
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("boundedLoop.applyReady");
    expect(entry.details?.displayOnly).toBe(true);
    expect(entry.details?.allowedToAutoApply).toBe(false);
    expect(entry.details?.allowedToAutoRunVerification).toBe(false);
    expect(entry.details?.allowedToAutoRollback).toBe(false);
    expect(entry.details?.canStartAutonomousLoop).toBe(false);
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("--watch");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
    expect(localStorage.length).toBe(0);
  });

  it("accepts controlled file read trace families while redacting raw bodies", () => {
    const entry = createCodingSessionTraceEntry({
      family: "controlledAgent.fileReadResult",
      title: "Controlled file read evidence visible",
      status: "succeeded",
      summary: "Bounded controlled workspace read evidence recorded.",
      requestId: "file-read-1",
      details: {
        displayOnly: true,
        pathLabel: "docs/architecture/013-agent-readiness-milestone.md",
        byteCount: 72,
        lineCount: 2,
        text: "raw file body sentinel",
        canSearchWorkspace: false,
        canRunCommands: false,
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("controlledAgent.fileReadResult");
    expect(entry.details?.pathLabel).toBe("docs/architecture/013-agent-readiness-milestone.md");
    expect(entry.details?.canSearchWorkspace).toBe(false);
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("raw file body sentinel");
  });

  it("creates sanitized agent run trace entries for deliberate S43 families", () => {
    localStorage.clear();
    sessionStorage.clear();

    const entry = createCodingSessionTraceEntry({
      family: "agentRun.verificationResult",
      title: "Agent Run verification result",
      status: "failed",
      summary: "User-confirmed verification failed; no automatic repair started",
      requestId: "verify-run-1",
      details: {
        displayOnly: true,
        state: "verification_failed",
        commandId: "repository-check",
        exitCode: 1,
        durationMs: 1234,
        outputTail: "failed with Authorization: Bearer abcdefghijklmnopqrstuvwxyz /Users/alice/private",
        rawPrompt: "PROMPT_SENTINEL",
        rawDiff: "DIFF_SENTINEL",
        command: "npm test -- --watch",
        cwd: "/Users/alice/project",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("agentRun.verificationResult");
    expect(normalizeTraceFamily("agentRun.goalReady")).toBe("agentRun.goalReady");
    expect(normalizeTraceFamily("agentRun.rollbackAvailable")).toBe("agentRun.rollbackAvailable");
    expect(entry.details?.displayOnly).toBe(true);
    expect(entry.details?.commandId).toBe("repository-check");
    expect(entry.details?.exitCode).toBe(1);
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(rendered).not.toContain("DIFF_SENTINEL");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("--watch");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("preserves verification follow-up prompt draft trace family for Agent Run guided fix drafts", () => {
    localStorage.clear();
    sessionStorage.clear();

    const entry = createCodingSessionTraceEntry({
      family: "verification.followupPromptDrafted",
      title: "Agent Run verification fix prompt drafted",
      status: "info",
      summary: "Drafted Agent Run fix prompt from sanitized verification metadata.",
      details: {
        commandId: "gui-app-tests",
        status: "failed",
        exitCode: 1,
        rawPrompt: "PROMPT_SENTINEL",
        rawOutput: "OUTPUT_SENTINEL",
        command: "npm test -- codingSessionTrace App verificationFollowupPrompt",
        cwd: "/Users/alice/private/project",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("verification.followupPromptDrafted");
    expect(normalizeTraceFamily("verification.followupPromptDrafted")).toBe("verification.followupPromptDrafted");
    expect(normalizeTraceFamily("agentRun.followupPromptDrafted")).toBe("runtime.refresh");
    expect(entry.details?.commandId).toBe("gui-app-tests");
    expect(entry.details?.status).toBe("failed");
    expect(entry.details?.exitCode).toBe(1);
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(rendered).not.toContain("OUTPUT_SENTINEL");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("/Users/alice");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("creates safe Agent Run completed handoff trace entries", () => {
    const entry = createCodingSessionTraceEntry({
      family: "agentRun.completed",
      title: "Agent Run completed after user-confirmed verification",
      status: "succeeded",
      summary: "Completed after user-confirmed verification. Manual apply and verification metadata are complete; no autonomous follow-up was started.",
      requestId: "verify-run-2",
      details: {
        displayOnly: true,
        reportKind: "success",
        reportStatus: "succeeded",
        state: "verified",
        verificationStatus: "succeeded",
        verificationExitCode: 0,
        rawOutput: "OUTPUT_SENTINEL",
        command: "npm test -- --watch",
        cwd: "/Users/alice/project",
        env: { API_KEY: "sk-secret123456789" },
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("agentRun.completed");
    expect(entry.status).toBe("succeeded");
    expect(entry.summary).toContain("no autonomous follow-up");
    expect(entry.details?.reportKind).toBe("success");
    expect(entry.details?.verificationStatus).toBe("succeeded");
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("OUTPUT_SENTINEL");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("--watch");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("keeps memory suggestion attach trace details sanitized", () => {
    const entry = createCodingSessionTraceEntry({
      family: "context.memory",
      title: "Task-linked project memory attached",
      status: "succeeded",
      summary: "Attached task-linked local memory note from suggestion metadata.",
      details: {
        memoryLabel: "Agent memory",
        taskLabel: "Task S69",
        sessionLabel: "Chat chat-001",
        attachTraceLabel: "memory-attach-chat-001-mem-1",
        suggestionStatus: "suggested",
        suggestionReasonLabels: ["Safe metadata overlap: agent."],
        suggestionWarningLabels: [],
        text: "RAW MEMORY BODY SENTINEL",
        rawPrompt: "PROMPT_SENTINEL",
        privatePath: "/Users/alice/private/memory.md",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("context.memory");
    expect(entry.details?.suggestionStatus).toBe("suggested");
    expect(entry.details?.suggestionReasonLabels).toEqual(["Safe metadata overlap: agent."]);
    expect(rendered).toContain("Task S69");
    expect(rendered).toContain("memory-attach-chat-001-mem-1");
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("RAW MEMORY BODY SENTINEL");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
  });

  it("creates sanitized Agent Run apply requested and result trace entries", () => {
    const requested = createCodingSessionTraceEntry({
      family: "agentRun.applyRequested",
      title: "Agent Run apply requested",
      status: "pending",
      summary: "User requested Agent Run apply through the existing workspace-edit bridge.",
      requestId: "gui-agent-run-apply-1",
      details: {
        displayOnly: true,
        requestId: "gui-agent-run-apply-1",
        runId: "agent-run-loop-1",
        proposalId: "proposal-1",
        applyRequested: true,
        rawDiff: "DIFF_SENTINEL",
        fileBody: "FILE_BODY_SENTINEL",
        privatePath: "/Users/alice/private/project.ts",
      },
    }, fixedOptions());
    const result = createCodingSessionTraceEntry({
      family: "agentRun.applyResult",
      title: "Agent Run apply result received",
      status: "failed",
      summary: "Host declined apply after explicit user confirmation",
      requestId: "gui-agent-run-apply-1",
      details: {
        displayOnly: true,
        requestId: "gui-agent-run-apply-1",
        hostRequestId: "gui-agent-run-apply-1",
        runId: "agent-run-loop-1",
        proposalId: "proposal-1",
        applyStatus: "failed",
        appliedFileCount: 0,
        affectedFiles: ["apps/gui/src/App.tsx"],
        rawOutput: "OUTPUT_SENTINEL",
        env: { API_KEY: "sk-secret123456789" },
      },
    }, fixedOptions());
    const rendered = JSON.stringify({ requested, result });

    expect(requested.family).toBe("agentRun.applyRequested");
    expect(result.family).toBe("agentRun.applyResult");
    expect(normalizeTraceFamily("agentRun.applyRequested")).toBe("agentRun.applyRequested");
    expect(normalizeTraceFamily("agentRun.applyResult")).toBe("agentRun.applyResult");
    expect(requested.details?.displayOnly).toBe(true);
    expect(requested.details?.applyRequested).toBe(true);
    expect(result.details?.applyStatus).toBe("failed");
    expect(result.details?.appliedFileCount).toBe(0);
    expect(rendered).toContain("[redacted]");
    expect(rendered.length).toBeLessThan(1800);
    expect(rendered).not.toContain("DIFF_SENTINEL");
    expect(rendered).not.toContain("FILE_BODY_SENTINEL");
    expect(rendered).not.toContain("OUTPUT_SENTINEL");
    expect(rendered).not.toContain("apps/gui/src/App.tsx");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret123456789");
  });

  it("normalizes unsafe family and status values at the helper boundary", () => {
    const entry = createCodingSessionTraceEntry({
      family: "tool.shell.execute",
      title: "Unsafe family",
      status: "rooted",
    }, fixedOptions());

    expect(entry.family).toBe("runtime.refresh");
    expect(entry.status).toBe("info");
    expect(normalizeTraceFamily("chat.streamDelta")).toBe("chat.streamDelta");
    expect(normalizeTraceFamily("chat.rawProviderResponse")).toBe("runtime.refresh");
    expect(normalizeTraceStatus("failed")).toBe("failed");
    expect(normalizeTraceStatus("leaked")).toBe("info");
  });

  it("redacts secrets and private paths in all text fields", () => {
    const entry = createCodingSessionTraceEntry({
      family: "host.runtimeStatus",
      title: "Authorization: Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /Users/alice/project/file.ts",
      status: "failed",
      summary: "OPENAI_API_KEY=sk-test-secret123456 Cookie: session=secret /home/alice/work raw prompt: PROMPT_SENTINEL",
      requestId: "request-with-token-marker",
      details: {
        outputTail: "api_key=short-secret /Users/alice/private.txt sk-secret123456789",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(rendered).not.toContain("sk-test-secret123456");
    expect(rendered).not.toContain("session=secret");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("/home/alice");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(entry.requestId).toBeUndefined();
  });

  it("bounds title summary details and oldest trace entries", () => {
    const longTitle = "title ".repeat(40);
    const longSummary = "summary ".repeat(200);
    let trace: CodingSessionTraceEntry[] = [];
    for (let index = 0; index < 4; index += 1) {
      trace = appendCodingSessionTraceEntry(trace, {
        family: "chat.streamDelta",
        title: index === 3 ? longTitle : `Event ${index}`,
        status: "in_progress",
        summary: index === 3 ? longSummary : undefined,
        details: { tail: "tail ".repeat(200) },
      }, { id: `trace-${index}`, timestamp: fixedDate, maxEntries: 3 });
    }

    expect(trace).toHaveLength(3);
    expect(trace.map((entry) => entry.id)).toEqual(["trace-1", "trace-2", "trace-3"]);
    expect(trace[2].title).toHaveLength(121);
    expect(trace[2].title.endsWith("…")).toBe(true);
    expect(trace[2].summary).toHaveLength(1001);
    expect(trace[2].summary?.endsWith("…")).toBe(true);
    expect(String(trace[2].details?.tail).length).toBeLessThanOrEqual(501);
  });

  it("sanitizes structured details without raw object dumps", () => {
    const cyclic: Record<string, unknown> = {
      safe: "visible",
      accessToken: "SECRET_TOKEN_SENTINEL",
      rawPrompt: { body: "PROMPT_SENTINEL" },
      nested: { provider_response: "PROVIDER_SENTINEL", count: 2 },
      values: Array.from({ length: 25 }, (_, index) => `item-${index}`),
    };
    cyclic.self = cyclic;

    const details = sanitizeTraceDetails(cyclic);
    const rendered = JSON.stringify(details);

    expect(rendered).toContain("visible");
    expect(rendered).toContain("[redacted]");
    expect(rendered).toContain("5 more items redacted");
    expect(rendered).not.toContain("SECRET_TOKEN_SENTINEL");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(rendered).not.toContain("PROVIDER_SENTINEL");
  });

  it("does not retain non-object details or raw function and symbol values", () => {
    expect(sanitizeTraceDetails("raw string detail")).toBeUndefined();
    const details = sanitizeTraceDetails({ fn: () => "raw", sym: Symbol("raw"), ok: true });

    expect(details).toEqual({ fn: "[redacted]", sym: "[redacted]", ok: true });
  });

  it("summarizes rejected unsafe inputs without raw payload leakage", () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    const rawPayload = JSON.stringify({ requestId: rawSecret, command: "rm -rf /Users/alice/private", payload: { token: rawSecret, rawPrompt: "PROMPT_BODY" } });
    const summary = summarizeRejectedTraceInput("assistant_request_id", { payload: rawPayload, action: "shell", privatePath: "/Users/alice/private" });
    const entry = createCodingSessionTraceEntry({
      family: "edit.rejected",
      title: "Rejected unsafe proposal",
      status: "rejected",
      summary: summary.summary,
      details: summary.details,
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(summary.reasonCode).toBe("assistant_request_id");
    expect(rendered).toContain("Raw payload omitted");
    expect(rendered).toContain("[redacted]");
    expect(rendered.length).toBeLessThan(1400);
    expect(rendered).not.toContain(rawSecret);
    expect(rendered).not.toContain("access_token");
    expect(rendered).not.toContain("PROMPT_BODY");
    expect(rendered).not.toContain("rm -rf");
    expect(rendered).not.toContain("/Users/alice");
  });

  it("accepts controlled command trace families and redacts executable details", () => {
    const entry = createCodingSessionTraceEntry({
      family: "controlledAgent.commandResult",
      title: "Controlled command result evidence visible",
      status: "succeeded",
      summary: "Allowlisted command-id evidence for repository-check.",
      requestId: "controlled-command-1",
      details: {
        commandId: "repository-check",
        command: "npm test -- --watch",
        cwd: "/Users/alice/private",
        env: { API_KEY: "sk-secret123456789" },
        outputTail: "bounded sanitized tail",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("controlledAgent.commandResult");
    expect(normalizeTraceFamily("controlledAgent.commandPlanned")).toBe("controlledAgent.commandPlanned");
    expect(normalizeTraceFamily("controlledAgent.commandRunning")).toBe("controlledAgent.commandRunning");
    expect(normalizeTraceFamily("controlledAgent.commandBlocked")).toBe("controlledAgent.commandBlocked");
    expect(rendered).toContain("repository-check");
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret");
  });

  it("accepts controlled runtime session trace families and redacts executable details", () => {
    const entry = createCodingSessionTraceEntry({
      family: "controlledAgent.runtimeSessionReady",
      title: "Controlled runtime session evidence visible",
      status: "info",
      summary: "Runtime session metadata is visible only as read-only evidence.",
      requestId: "controlled-runtime-session-1",
      details: {
        displayOnly: true,
        metadataOnly: true,
        executionAllowed: false,
        agentStartAllowed: false,
        command: "npm test -- --watch",
        privatePath: "/Users/alice/private",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(entry.family).toBe("controlledAgent.runtimeSessionReady");
    expect(normalizeTraceFamily("controlledAgent.runtimeSessionStartRequested")).toBe("controlledAgent.runtimeSessionStartRequested");
    expect(normalizeTraceFamily("controlledAgent.runtimeSessionStopRequested")).toBe("controlledAgent.runtimeSessionStopRequested");
    expect(normalizeTraceFamily("controlledAgent.runtimeSessionBlocked")).toBe("controlledAgent.runtimeSessionBlocked");
    expect(entry.details?.displayOnly).toBe(true);
    expect(entry.details?.executionAllowed).toBe(false);
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("/Users/alice");
  });

  it("uses bounded generated identifiers without persisting state", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const entry = createCodingSessionTraceEntry({
      family: "gui.ready",
      title: "GUI ready",
      status: "info",
    }, { now: () => fixedDate });

    expect(entry.id).toMatch(/^trace-/);
    expect(entry.timestamp).toBe("2026-06-21T12:00:00.000Z");
    expect(localStorage.length).toBe(0);
  });
});
