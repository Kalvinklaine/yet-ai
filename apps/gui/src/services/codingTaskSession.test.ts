import { describe, expect, it } from "vitest";
import type { ExplicitContextBundleItem } from "./activeEditorContext";
import type { BoundedPatchVerificationLoopMetadata } from "./boundedPatchVerificationLoop";
import type { CodingSessionTraceEntry } from "./codingSessionTrace";
import { createCodingTaskSessionSnapshot, createMemoryAttachTraceLabel, createSessionAttachTraceLabel, createTaskAttachTraceLabel } from "./codingTaskSession";

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

  it("summarizes trace family counts and labels", () => {
    const snapshot = createCodingTaskSessionSnapshot({ traceEntries });

    expect(snapshot.trace.totalCount).toBe(3);
    expect(snapshot.trace.families).toEqual([
      { family: "agentRun.goalReady", count: 1, latestStatus: "succeeded" },
      { family: "agentRun.applyResult", count: 2, latestStatus: "succeeded" },
    ]);
    expect(snapshot.trace.labels).toEqual(expect.arrayContaining([expect.stringContaining("agentRun.applyResult · succeeded · Apply result reviewed")]));
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
