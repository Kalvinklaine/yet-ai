import { describe, expect, it } from "vitest";
import type { CodingSessionTraceEntry } from "./codingSessionTrace";
import { createMultiStepTaskTimeline, type MultiStepTaskTimelineInput } from "./multiStepTaskTimeline";

const traceEntries: CodingSessionTraceEntry[] = [
  {
    id: "trace-goal",
    timestamp: "2026-06-28T08:00:00.000Z",
    family: "agentRun.goalReady",
    title: "Goal ready",
    status: "succeeded",
  },
  {
    id: "trace-apply-request",
    timestamp: "2026-06-28T08:01:00.000Z",
    family: "agentRun.applyRequested",
    title: "Apply requested",
    status: "in_progress",
    requestId: "apply-1",
  },
  {
    id: "trace-verify-progress",
    timestamp: "2026-06-28T08:02:00.000Z",
    family: "agentRun.verificationProgress",
    title: "Verification running",
    status: "in_progress",
    requestId: "verify-1",
  },
  {
    id: "trace-followup",
    timestamp: "2026-06-28T08:03:00.000Z",
    family: "verification.followupPromptDrafted",
    title: "Follow-up drafted",
    status: "pending",
  },
  {
    id: "trace-completed",
    timestamp: "2026-06-28T08:04:00.000Z",
    family: "agentRun.completed",
    title: "Completed",
    status: "succeeded",
  },
];

function fullInput(): MultiStepTaskTimelineInput {
  return {
    goal: { title: "Add timeline metadata panel" },
    contextItems: [
      {
        kind: "workspace_snippet",
        workspaceRelativePath: "apps/gui/src/App.tsx",
        languageId: "tsx",
        range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
        text: "raw snippet body must stay out",
        key: "snippet-1",
      },
      {
        kind: "project_memory",
        noteId: "mem-1",
        title: "Manual Agent Run boundary",
        text: "raw memory note body must stay out",
        tags: ["agent-run"],
        key: "memory-1",
      },
    ],
    memorySuggestions: [
      { noteId: "mem-2", titleLabel: "Timeline safety note", reasonLabels: ["safe overlap"], status: "suggested", warnings: [], canAttachExplicitly: true },
    ],
    planPreview: {
      title: "Review two manual steps",
      summary: "Preview-only plan metadata for user review.",
      steps: [{ title: "Inspect metadata" }, { title: "Render timeline" }],
      labels: ["manual-only"],
    },
    proposalHistory: [
      { id: "plan-1", source: "assistant", kind: "plan_preview", status: "preview", summary: "Preview the plan." },
      { id: "proposal-1", source: "assistant", kind: "original", status: "detected", summary: "Update display metadata.", touchedFiles: ["apps/gui/src/services/multiStepTaskTimeline.ts"] },
    ],
    agentRun: {
      goal: { id: "goal-1", title: "Add timeline metadata panel" },
      proposal: { id: "proposal-1", summary: "Update display metadata.", touchedFiles: ["apps/gui/src/services/multiStepTaskTimeline.ts"] },
      applyRequest: { requested: true, source: "user", requestId: "apply-1" },
      applyResult: { status: "applied", appliedFileCount: 1, summary: "Applied after explicit user request." },
      verificationRequest: { requested: true, source: "user", requestId: "verify-1" },
      verificationProgress: { status: "running" },
      verificationResult: { status: "succeeded", exitCode: 0, durationMs: 1200, summary: "Focused smoke passed." },
    },
    followupDraft: { intent: "followup", summary: "Draft a follow-up only if the user reviews and sends it.", labels: ["draft-only"] },
    traceEntries,
  };
}

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

describe("createMultiStepTaskTimeline", () => {
  it("creates an empty metadata-only timeline with conservative defaults", () => {
    const timeline = createMultiStepTaskTimeline();

    expect(timeline.kind).toBe("multi_step_task_timeline");
    expect(timeline.authority).toBe("metadata_only");
    expect(timeline.displayOnly).toBe(true);
    expect(timeline.items.map((item) => item.family)).toEqual([
      "task.goal",
      "context.attachment",
      "memory.attachment",
      "proposal.review",
    ]);
    expect(timeline.items[0]).toMatchObject({ id: "task-goal", status: "pending" });
    expect(timeline.items[1]).toMatchObject({ id: "context-attachment", status: "skipped" });
    expect(timeline.items[2]).toMatchObject({ id: "memory-skipped", status: "skipped" });
  });

  it("synthesizes a deterministic full manual Agent Run flow", () => {
    const timeline = createMultiStepTaskTimeline(fullInput());

    expect(timeline.items.map((item) => item.family)).toEqual([
      "task.goal",
      "context.attachment",
      "memory.attachment",
      "plan.preview",
      "proposal.review",
      "apply.request",
      "apply.result",
      "verification.request",
      "verification.progress",
      "verification.result",
      "followup.draft",
      "final.result",
    ]);
    expect(timeline.items.map((item) => item.id)).toEqual([
      "task-goal",
      "context-attachment",
      "memory-attached",
      "plan-preview",
      "proposal-detected",
      "apply-request",
      "apply-result",
      "verification-request",
      "verification-progress",
      "verification-result",
      "followup-draft",
      "final-result",
    ]);
    expect(timeline.items.find((item) => item.id === "apply-request")?.requestId).toBe("apply-1");
    expect(timeline.items.find((item) => item.id === "verification-request")?.requestId).toBe("verify-1");
    expect(timeline.items.find((item) => item.id === "verification-result")).toMatchObject({ status: "succeeded", summary: "Focused smoke passed." });
    expect(timeline.items.find((item) => item.id === "final-result")?.status).toBe("succeeded");
    expect(rendered(timeline)).not.toContain("raw snippet body");
    expect(rendered(timeline)).not.toContain("raw memory note body");
  });

  it("adds display-only checkpoint decision timeline metadata", () => {
    const input = fullInput();
    input.checkpointDecision = {
      status: "continue_available",
      recommendedDecision: "continue_current_checkpoint",
      decisionCards: [{ kind: "continue", label: "Continue current checkpoint", state: "recommended", reason: "Continue is manual after verification.", manualOnly: true, actionPayload: null }],
      diagnostics: [],
      details: { displayOnly: true },
      canAutoContinue: false,
      canAutoApply: false,
      canAutoRollback: false,
      canAutoRunVerification: false,
      canStartAutonomousLoop: false,
      hasExecutableAuthority: false,
      displayOnly: true,
    };

    const timeline = createMultiStepTaskTimeline(input);
    const decisionItem = timeline.items.find((item) => item.id === "checkpoint-decision");

    expect(decisionItem).toMatchObject({ family: "checkpoint.decision", status: "succeeded", title: "Checkpoint decision: continue manually available" });
    expect(decisionItem?.summary).toContain("Recommended manual next step: Continue current checkpoint.");
    expect(decisionItem?.labels).toEqual(expect.arrayContaining(["decision status continue_available", "recommended continue_current_checkpoint", "display only", "no automatic action"]));
    expect(rendered(timeline)).not.toContain("autoApply");
  });

  it("redacts unsafe metadata without leaking secrets paths commands diffs or stack traces", () => {
    const secret = "access_token=" + "x".repeat(64);
    const timeline = createMultiStepTaskTimeline({
      goal: `Fix /Users/alice/private/project with ${secret}`,
      planPreview: {
        title: "raw prompt with command npm test",
        summary: "Traceback (most recent call last):\n  at secret (/Users/alice/app.ts:1:1)",
        labels: ["safe label", secret],
      },
      agentRun: {
        rawDiff: "diff --git a/secret b/secret",
        cwd: "/Users/alice/private/project",
        command: "npm test",
        verificationResult: { status: "failed", outputTail: `stderr ${secret}` },
      },
      traceEntries: [
        {
          id: "trace-secret",
          timestamp: "2026-06-28T08:00:00.000Z",
          family: "agentRun.verificationResult",
          title: "Verification result",
          status: "failed",
          requestId: "Bearer-secret-token",
        },
      ],
    });
    const output = rendered(timeline);

    expect(output).toContain("[redacted]");
    expect(timeline.diagnostics.length).toBeGreaterThan(0);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("access_token");
    expect(output).not.toContain("/Users/alice");
    expect(output).not.toContain("npm test");
    expect(output).not.toContain("diff --git");
    expect(output).not.toContain("Traceback");
    expect(output).not.toContain("Bearer-secret-token");
  });

  it("bounds output items labels summaries and diagnostics", () => {
    const input = fullInput();
    input.maxItems = 5;
    input.planPreview = {
      title: "x".repeat(300),
      summary: "y".repeat(500),
      labels: Array.from({ length: 20 }, (_, index) => `label ${index} ${"z".repeat(200)}`),
    };
    input.diagnostics = Array.from({ length: 40 }, (_, index) => `diagnostic ${index}`);

    const timeline = createMultiStepTaskTimeline(input);

    expect(timeline.items).toHaveLength(5);
    expect(timeline.diagnostics.length).toBeLessThanOrEqual(16);
    for (const item of timeline.items) {
      expect(item.title.length).toBeLessThanOrEqual(97);
      expect(item.summary.length).toBeLessThanOrEqual(221);
      expect(item.labels?.length ?? 0).toBeLessThanOrEqual(8);
      for (const label of item.labels ?? []) {
        expect(label.length).toBeLessThanOrEqual(141);
      }
    }
  });

  it("exposes an explicit metadata-only display policy denying execution authority", () => {
    const timeline = createMultiStepTaskTimeline(fullInput());

    expect(timeline.policy).toEqual({
      authority: "metadata_only",
      displayOnly: true,
      canAutoSend: false,
      canAutoApply: false,
      canAutoRunVerification: false,
      canAutoRepair: false,
      canReadFiles: false,
      canWriteFiles: false,
      canCallProvider: false,
    });
  });

  it("adds controlled file read evidence from sanitized trace metadata", () => {
    const timeline = createMultiStepTaskTimeline({
      traceEntries: [
        {
          id: "trace-file-read",
          timestamp: "2026-06-29T08:02:00.000Z",
          family: "controlledAgent.fileReadResult",
          title: "Controlled file read evidence visible",
          status: "succeeded",
          summary: "Bounded controlled workspace read evidence recorded for docs/architecture/013-agent-readiness-milestone.md.",
          details: { text: "raw file body sentinel" },
        },
      ],
    });
    const item = timeline.items.find((entry) => entry.family === "fileRead.evidence");
    const rendered = JSON.stringify(timeline);

    expect(item).toMatchObject({ status: "succeeded", title: "Controlled file read evidence recorded" });
    expect(timeline.policy.canReadFiles).toBe(false);
    expect(rendered).toContain("Bounded controlled workspace read evidence");
    expect(rendered).not.toContain("raw file body sentinel");
  });

  it("does not mutate input objects", () => {
    const input = fullInput();
    const before = structuredClone(input);

    createMultiStepTaskTimeline(input);

    expect(input).toEqual(before);
  });
});
