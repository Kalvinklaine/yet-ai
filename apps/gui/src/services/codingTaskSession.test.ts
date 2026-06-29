import { describe, expect, it } from "vitest";
import type { ExplicitContextBundleItem } from "./activeEditorContext";
import type { BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";
import type { CodingSessionTraceEntry } from "./codingSessionTrace";
import { createCodingTaskSessionSnapshot, createLinkedMemoryAttachTraceLabel, createMemoryAttachTraceLabel, createSessionAttachTraceLabel, createSessionMemoryLabel, createTaskAttachTraceLabel, createTaskMemoryLabel } from "./codingTaskSession";

const readyLoop: BoundedPatchVerificationLoopMetadata = {
  kind: "bounded_patch_verification_loop",
  version: "2026-06-21",
  authority: "metadata_only",
  cloudRequired: false,
  executionAllowed: false,
  status: "ready_for_apply",
  loopId: "loop-s65-ready",
  sandbox: {
    modeStatus: "checkpoint_ready",
    checkpointId: "checkpoint-s65-ready",
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
    proposalId: "proposal-s65-ready",
    source: "assistant_proposal",
    touchedFiles: ["apps/gui/src/App.tsx"],
    editCount: 1,
    patchBytes: 1024,
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

const contextItems: ExplicitContextBundleItem[] = [
  {
    kind: "active_editor",
    source: "vscode",
    file: { displayPath: "/Users/alice/private/repo/src/editor.ts", workspaceRelativePath: "src/editor.ts", languageId: "typescript" },
    selection: { startLine: 2, startCharacter: 1, endLine: 5, endCharacter: 3, text: "export const selected = true;" },
    key: "active-editor-1",
  },
  {
    kind: "workspace_snippet",
    workspaceRelativePath: "apps/gui/src/App.tsx",
    languageId: "tsx",
    range: { start: { line: 10, character: 0 }, end: { line: 20, character: 2 } },
    text: "function App() { return null; }",
    key: "snippet-1",
  },
  {
    kind: "project_memory",
    noteId: "mem-1",
    title: "Architecture note",
    text: "Long memory body that should never appear in the snapshot.",
    tags: ["architecture", "local-first"],
    taskLabel: "S65",
    sessionLabel: "manual-session",
    attachTraceLabel: "trace-memory",
    key: "memory-1",
  },
  {
    kind: "verification_output",
    commandId: "gui-app-tests",
    status: "failed",
    exitCode: 1,
    outputTail: "Raw failure body that should never appear in the snapshot.",
    truncated: true,
    key: "verification-1",
  },
];

const traceEntries: CodingSessionTraceEntry[] = [
  {
    id: "trace-1",
    timestamp: "2026-06-25T18:00:00.000Z",
    family: "agentRun.goalReady",
    title: "Goal ready",
    status: "succeeded",
    summary: "Goal metadata was recorded",
  },
  {
    id: "trace-2",
    timestamp: "2026-06-25T18:01:00.000Z",
    family: "agentRun.applyResult",
    title: "Apply result metadata",
    status: "failed",
  },
  {
    id: "trace-3",
    timestamp: "2026-06-25T18:02:00.000Z",
    family: "agentRun.applyResult",
    title: "Apply result reviewed",
    status: "succeeded",
  },
];

function readyAgentRun() {
  return {
    goal: { id: "goal-s65", title: "Add coding task session snapshot" },
    proposal: { id: "proposal-s65-ready", summary: "Patch metadata detected", touchedFiles: ["apps/gui/src/services/codingTaskSession.ts"] },
    boundedLoop: structuredClone(readyLoop),
  };
}

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

describe("createCodingTaskSessionSnapshot", () => {
  it("creates an empty metadata-only snapshot with no execution authority", () => {
    const snapshot = createCodingTaskSessionSnapshot();

    expect(snapshot.kind).toBe("coding_task_session");
    expect(snapshot.authority).toBe("metadata_only");
    expect(snapshot.cloudRequired).toBe(false);
    expect(snapshot.executionAllowed).toBe(false);
    expect(snapshot.goal.present).toBe(false);
    expect(snapshot.context.totalCount).toBe(0);
    expect(snapshot.memory.count).toBe(0);
    expect(snapshot.statuses.agentRunState).toBe("idle");
    expect(snapshot.nextSafeManualStep).toContain("Select or describe");
  });

  it("summarizes goal-only input as reviewable manual metadata", () => {
    const snapshot = createCodingTaskSessionSnapshot({ goal: { title: "Plan the local task" } });

    expect(snapshot.goal).toEqual({ present: true, label: "Plan the local task" });
    expect(snapshot.statuses.agentRunState).toBe("goal_ready");
    expect(snapshot.statuses.proposal).toBe("not_detected");
    expect(snapshot.nextSafeManualStep).toContain("Review the goal");
  });

  it("summarizes selected context labels and counts without raw bodies", () => {
    const snapshot = createCodingTaskSessionSnapshot({ goal: "Use explicit context", contextItems });

    expect(snapshot.context.totalCount).toBe(4);
    expect(snapshot.context.activeEditorCount).toBe(1);
    expect(snapshot.context.snippetCount).toBe(1);
    expect(snapshot.context.verificationAttachmentCount).toBe(1);
    expect(snapshot.context.labels).toEqual(expect.arrayContaining([
      expect.stringContaining("active file excerpt · src/editor.ts"),
      expect.stringContaining("project snippet · apps/gui/src/App.tsx"),
      expect.stringContaining("verification output · gui-app-tests"),
    ]));
    expect(rendered(snapshot)).not.toContain("export const selected");
    expect(rendered(snapshot)).not.toContain("function App()");
    expect(rendered(snapshot)).not.toContain("Raw failure body");
  });

  it("summarizes memory labels and safe attach trace labels only", () => {
    const snapshot = createCodingTaskSessionSnapshot({ contextItems });

    expect(snapshot.memory.count).toBe(1);
    expect(snapshot.memory.labels).toEqual(["Architecture note"]);
    expect(createTaskAttachTraceLabel("S65 Task")).toBe("task:S65 Task");
    expect(createSessionAttachTraceLabel("Manual Session")).toBe("session:Manual Session");
    expect(createMemoryAttachTraceLabel("Architecture note")).toBe("memory:Architecture note");
    expect(rendered(snapshot)).not.toContain("Long memory body");
  });

  it("summarizes memory suggestion labels and counts without note bodies", () => {
    const snapshot = createCodingTaskSessionSnapshot({
      contextItems,
      memorySuggestions: [
        { noteId: "mem-1", titleLabel: "Architecture note", reasonLabels: ["Safe metadata overlap: architecture."], status: "suggested", warnings: [], canAttachExplicitly: true },
        { noteId: "mem-2", titleLabel: "Stale note", reasonLabels: ["Memory note may be stale; review before reusing."], status: "stale", warnings: ["Memory note is labeled stale or superseded."], canAttachExplicitly: false },
        { noteId: "mem-3", titleLabel: "Unsafe note", reasonLabels: ["Memory note needs manual review before attach."], status: "unsafe", warnings: ["Sensitive execution marker detected."], canAttachExplicitly: false },
      ],
    });
    const output = rendered(snapshot);

    expect(snapshot.memory.suggestionCounts).toEqual({ suggested: 1, already_attached: 0, stale: 1, unsafe: 1, unrelated: 0 });
    expect(snapshot.memory.suggestionLabels).toEqual([
      "memory suggestion · suggested · Architecture note",
      "memory suggestion · stale · Stale note",
      "memory suggestion · unsafe · Unsafe note",
    ]);
    expect(output).not.toContain("Long memory body");
    expect(output).not.toContain("Raw failure body");
  });

  it("creates safe memory linkage labels without leaking unsafe ids", () => {
    const secret = "access_token=" + "l".repeat(64);

    expect(createTaskMemoryLabel("Existing Task", "Fallback Goal")).toBe("Existing Task");
    expect(createTaskMemoryLabel(undefined, "Fix the memory trace labels")).toBe("Fix the memory trace labels");
    expect(createTaskMemoryLabel(`raw prompt ${secret}`, `private path /Users/alice/task ${secret}`)).toBe("Task-linked memory attach");
    expect(createSessionMemoryLabel("Session Label", "chat-001")).toBe("Session Label");
    expect(createSessionMemoryLabel(undefined, "chat-001")).toBe("Chat chat-001");
    expect(createSessionMemoryLabel(undefined, `chat/../../secret-${secret}`)).toBe("Chat current");
    expect(createLinkedMemoryAttachTraceLabel("chat-001", "mem-001")).toBe("memory-attach-chat-001-mem-001");
    expect(createLinkedMemoryAttachTraceLabel(`chat-${secret}`, "/Users/alice/mem-001")).toBe("memory-attach-chat-memory");
  });

  it("summarizes proposal and apply readiness from Agent Run state", () => {
    const snapshot = createCodingTaskSessionSnapshot({ agentRun: readyAgentRun() });

    expect(snapshot.statuses.proposal).toBe("proposal-s65-ready");
    expect(snapshot.statuses.apply).toBe("not_requested");
    expect(snapshot.statuses.verification).toBe("not_requested");
    expect(snapshot.statuses.agentRunState).toBe("ready_for_apply");
    expect(snapshot.nextSafeManualStep).toContain("explicitly confirm apply");
  });

  it("summarizes applied and verification result metadata", () => {
    const run = readyAgentRun();
    Object.assign(run, {
      applyRequest: { requested: true, source: "user", requestId: "apply-s65" },
      applyResult: { status: "applied", appliedFileCount: 1, summary: "Patch applied by explicit user action" },
      verificationRequest: { requested: true, source: "user", requestId: "verify-s65" },
      verificationResult: { status: "succeeded", exitCode: 0, durationMs: 1000, outputTail: "check passed" },
    });

    const snapshot = createCodingTaskSessionSnapshot({ agentRun: run });

    expect(snapshot.statuses.apply).toBe("applied");
    expect(snapshot.statuses.verification).toBe("succeeded");
    expect(snapshot.statuses.agentRunState).toBe("verified");
    expect(snapshot.nextSafeManualStep).toContain("Stop and review");
  });

  it("summarizes checkpoint decision status and recommended manual step", () => {
    const snapshot = createCodingTaskSessionSnapshot({
      agentRun: readyAgentRun(),
      checkpointDecision: {
        status: "separate_run_suggested",
        recommendedDecision: "start_separate_manual_run",
        decisionCards: [{ kind: "start_separate_manual_run", label: "Start separate manual run", state: "recommended", reason: "Manual follow-up only.", manualOnly: true, actionPayload: null }],
        diagnostics: [],
        details: { displayOnly: true },
        canAutoContinue: false,
        canAutoApply: false,
        canAutoRollback: false,
        canAutoRunVerification: false,
        canStartAutonomousLoop: false,
        hasExecutableAuthority: false,
        displayOnly: true,
      },
    });

    expect(snapshot.statuses.checkpointDecision).toBe("separate_run_suggested");
    expect(snapshot.statuses.checkpointRecommendedStep).toBe("start_separate_manual_run · Start separate manual run");
    expect(rendered(snapshot)).not.toContain("Manual follow-up only");
  });

  it("summarizes trace family counts and labels", () => {
    const snapshot = createCodingTaskSessionSnapshot({ traceEntries });

    expect(snapshot.trace.totalCount).toBe(3);
    expect(snapshot.trace.families).toEqual([
      { family: "agentRun.goalReady", count: 1, latestStatus: "succeeded" },
      { family: "agentRun.applyResult", count: 2, latestStatus: "succeeded" },
    ]);
    expect(snapshot.trace.labels).toEqual(expect.arrayContaining([expect.stringContaining("agentRun.applyResult · succeeded · Apply result reviewed")]));
  });

  it("summarizes controlled file read trace labels as session metadata only", () => {
    const snapshot = createCodingTaskSessionSnapshot({
      traceEntries: [
        ...traceEntries,
        {
          id: "trace-file-read",
          timestamp: "2026-06-29T08:02:00.000Z",
          family: "controlledAgent.fileReadResult",
          title: "Controlled file read evidence visible",
          status: "succeeded",
          summary: "Bounded controlled workspace read evidence recorded.",
          details: { pathLabel: "docs/architecture/013-agent-readiness-milestone.md", text: "raw body sentinel" },
        },
      ],
    });
    const rendered = JSON.stringify(snapshot);

    expect(snapshot.controlledFileRead.present).toBe(true);
    expect(snapshot.controlledFileRead.latestStatus).toBe("succeeded");
    expect(snapshot.controlledFileRead.labels).toEqual(["controlledAgent.fileReadResult · succeeded · Controlled file read evidence visible"]);
    expect(snapshot.policy.canReadHiddenFiles).toBe(false);
    expect(rendered).not.toContain("raw body sentinel");
  });

  it("includes an empty proposal history summary when no history is provided", () => {
    const snapshot = createCodingTaskSessionSnapshot({ goal: "Review history later" });

    expect(snapshot.proposalHistory).toMatchObject({
      kind: "proposal_history_comparison",
      authority: "metadata_only",
      totalCount: 0,
      latestStatus: "none",
      latestSummary: "none",
      touchedFileLabels: [],
      comparisonLabels: [],
    });
    expect(snapshot.statuses.proposal).toBe("not_detected");
  });

  it("includes sanitized proposal history labels without granting readiness", () => {
    const snapshot = createCodingTaskSessionSnapshot({
      goal: "Compare safe proposals",
      proposalHistory: [
        { id: "proposal-1", source: "assistant-1", kind: "original", summary: "Change the visible heading.", touchedFiles: ["apps/gui/src/App.tsx"] },
        { id: "proposal-2", source: "assistant-2", kind: "follow_up", summary: "Use calmer button copy.", touchedFiles: ["apps/gui/src/App.tsx", "apps/gui/src/main.tsx"] },
      ],
    });

    expect(snapshot.proposalHistory).toMatchObject({
      totalCount: 2,
      visibleCount: 2,
      latestStatus: "detected",
      latestSummary: "Use calmer button copy.",
      touchedFileCount: 2,
    });
    expect(snapshot.proposalHistory.touchedFileLabels).toEqual(["apps/gui/src/App.tsx", "apps/gui/src/main.tsx"]);
    expect(snapshot.proposalHistory.comparisonLabels).toEqual(expect.arrayContaining([expect.stringContaining("detected · follow_up · Use calmer button copy.")]));
    expect(snapshot.statuses.apply).toBe("not_requested");
    expect(snapshot.statuses.verification).toBe("not_requested");
    expect(snapshot.nextSafeManualStep).toContain("Review the goal");
  });

  it("summarizes rejected applied and verified proposal history as display metadata only", () => {
    const snapshot = createCodingTaskSessionSnapshot({
      goal: "Review prior proposals",
      proposalHistory: [
        { id: "proposal-rejected", source: "assistant-1", kind: "rejected", status: "rejected", summary: "Rejected because manual confirmation was missing." },
        { id: "proposal-applied", source: "assistant-2", kind: "applied", status: "applied", applyStatus: "applied", summary: "Applied after explicit user action." },
        { id: "proposal-verified", source: "assistant-2", kind: "verification", status: "verification_succeeded", verificationStatus: "succeeded", summary: "Verification metadata succeeded." },
      ],
    });

    expect(snapshot.proposalHistory.rejectedCount).toBe(1);
    expect(snapshot.proposalHistory.appliedCount).toBe(1);
    expect(snapshot.proposalHistory.verificationSucceededCount).toBe(1);
    expect(snapshot.proposalHistory.latestStatus).toBe("verification_succeeded");
    expect(snapshot.statuses.apply).toBe("not_requested");
    expect(snapshot.statuses.verification).toBe("not_requested");
    expect(snapshot.policy.canAutoApply).toBe(false);
    expect(snapshot.policy.canAutoRunVerification).toBe(false);
    expect(snapshot.proposalHistory.policy.canRequestApply).toBe(false);
    expect(snapshot.proposalHistory.policy.canRequestVerification).toBe(false);
  });

  it("redacts unsafe proposal history input before adding it to the session snapshot", () => {
    const secret = "access_token=" + "p".repeat(64);
    const snapshot = createCodingTaskSessionSnapshot({
      proposalHistory: [
        {
          id: "proposal-/Users/alice/secret",
          source: "assistant-/Users/alice/private",
          kind: "original",
          summary: `raw diff with ${secret}`,
          touchedFiles: ["/Users/alice/project/private.ts", "apps/gui/src/App.tsx"],
          diagnostic: "command npm test cwd /Users/alice/project",
        },
      ],
    });
    const output = rendered(snapshot);

    expect(snapshot.proposalHistory.latestSummary).toBe("[redacted]");
    expect(snapshot.proposalHistory.latestSource).toBe("assistant");
    expect(snapshot.proposalHistory.touchedFileLabels).toEqual(["apps/gui/src/App.tsx"]);
    expect(snapshot.proposalHistory.diagnostics.length).toBeGreaterThan(0);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("access_token");
    expect(output).not.toContain("/Users/alice");
    expect(output).not.toContain("npm test");
    expect(output).not.toContain("raw diff");
  });

  it("redacts unsafe values and reports diagnostics", () => {
    const secret = "access_token=" + "x".repeat(64);
    const snapshot = createCodingTaskSessionSnapshot({
      goal: `Fix /Users/alice/private/repo with ${secret}`,
      contextItems: [
        {
          kind: "project_memory",
          noteId: "mem-secret",
          title: `Token note ${secret}`,
          text: "raw memory body",
          tags: [secret],
          key: "memory-secret",
        },
      ],
      agentRun: { goal: { title: "Safe goal" }, command: "npm test", rawDiff: "SECRET_SENTINEL", cwd: "/Users/alice/project" },
      diagnostics: ["private path /Users/alice/project omitted"],
    });
    const output = rendered(snapshot);

    expect(output).toContain("[redacted]");
    expect(snapshot.diagnostics.length).toBeGreaterThan(0);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("access_token");
    expect(output).not.toContain("/Users/alice");
    expect(output).not.toContain("npm test");
    expect(output).not.toContain("SECRET_SENTINEL");
    expect(output).not.toContain("raw memory body");
  });

  it("keeps all manual-action policy flags conservative", () => {
    const snapshot = createCodingTaskSessionSnapshot({ agentRun: readyAgentRun() });

    expect(snapshot.policy).toEqual({
      canAutoSend: false,
      canAutoAttachContext: false,
      canAutoApply: false,
      canAutoRunVerification: false,
      canAutoRepair: false,
      canAutoRetry: false,
      canAutoRollback: false,
      canReadHiddenFiles: false,
      canRunHiddenTools: false,
    });
  });

  it("bounds labels diagnostics and trace summaries", () => {
    const manyContextItems = Array.from({ length: 20 }, (_, index): ExplicitContextBundleItem => ({
      kind: "project_memory",
      noteId: `mem-${index}`,
      title: `Memory ${index} ${"x".repeat(300)}`,
      text: "body omitted",
      tags: [],
      key: `memory-${index}`,
    }));
    const manyTraceEntries = Array.from({ length: 20 }, (_, index): CodingSessionTraceEntry => ({
      id: `trace-${index}`,
      timestamp: "2026-06-25T18:00:00.000Z",
      family: index % 2 === 0 ? "context.memory" : "agentRun.verificationResult",
      title: `Trace ${index} ${"y".repeat(300)}`,
      status: "info",
    }));

    const snapshot = createCodingTaskSessionSnapshot({
      goal: "x".repeat(500),
      contextItems: manyContextItems,
      traceEntries: manyTraceEntries,
      diagnostics: Array.from({ length: 40 }, (_, index) => `diagnostic ${index}`),
    });

    expect(snapshot.goal.label.length).toBeLessThanOrEqual(181);
    expect(snapshot.context.labels).toHaveLength(12);
    expect(snapshot.memory.labels).toHaveLength(12);
    expect(snapshot.trace.labels).toHaveLength(12);
    expect(snapshot.trace.families.length).toBeLessThanOrEqual(12);
    expect(snapshot.diagnostics).toHaveLength(24);
    for (const label of [...snapshot.context.labels, ...snapshot.memory.labels, ...snapshot.trace.labels, ...snapshot.diagnostics]) {
      expect(label.length).toBeLessThanOrEqual(161);
    }
  });

  it("bounds proposal history output inside the session snapshot", () => {
    const snapshot = createCodingTaskSessionSnapshot({
      proposalHistory: Array.from({ length: 20 }, (_, index) => ({
        id: `proposal-${index}`,
        source: `assistant-${index}`,
        kind: "follow_up" as const,
        summary: `Proposal ${index} ${"z".repeat(300)}`,
        touchedFiles: Array.from({ length: 12 }, (_unused, fileIndex) => `apps/gui/src/proposal-${index}-${fileIndex}.ts`),
      })),
    });

    expect(snapshot.proposalHistory.totalCount).toBe(12);
    expect(snapshot.proposalHistory.comparisonLabels).toHaveLength(12);
    expect(snapshot.proposalHistory.touchedFileLabels).toHaveLength(8);
    expect(snapshot.proposalHistory.diagnostics.length).toBeLessThanOrEqual(12);
    expect(snapshot.proposalHistory.latestSummary.length).toBeLessThanOrEqual(241);
    for (const label of [...snapshot.proposalHistory.comparisonLabels, ...snapshot.proposalHistory.touchedFileLabels, ...snapshot.proposalHistory.diagnostics]) {
      expect(label.length).toBeLessThanOrEqual(181);
    }
  });

  it("does not mutate input objects", () => {
    const input = {
      goal: { title: "Do not mutate" },
      contextItems: structuredClone(contextItems),
      agentRun: readyAgentRun(),
      traceEntries: structuredClone(traceEntries),
    };
    const before = structuredClone(input);

    createCodingTaskSessionSnapshot(input);

    expect(input).toEqual(before);
  });
});
