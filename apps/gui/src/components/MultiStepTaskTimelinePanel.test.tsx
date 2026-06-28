import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiStepTaskTimelinePanel } from "./MultiStepTaskTimelinePanel";
import { createMultiStepTaskTimeline, type MultiStepTaskTimelineInput } from "../services/multiStepTaskTimeline";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const fullInput: MultiStepTaskTimelineInput = {
  goal: { title: "Add manual timeline panel" },
  contextItems: [
    {
      kind: "workspace_snippet",
      workspaceRelativePath: "apps/gui/src/App.tsx",
      languageId: "tsx",
      range: { start: { line: 1, character: 0 }, end: { line: 2, character: 1 } },
      text: "raw context body must not appear",
      key: "snippet-1",
    },
    {
      kind: "project_memory",
      noteId: "mem-1",
      title: "Timeline UX boundary",
      text: "raw memory body must not appear",
      tags: ["timeline"],
      key: "memory-1",
    },
  ],
  memorySuggestions: [{ noteId: "mem-2", titleLabel: "Safe timeline memory", reasonLabels: ["same task"], status: "suggested", warnings: [], canAttachExplicitly: true }],
  planPreview: { title: "Review timeline steps", summary: "Manual plan preview metadata.", steps: ["Goal", "Context"], labels: ["manual-only"] },
  proposalHistory: [
    { id: "plan-1", source: "assistant", kind: "plan_preview", status: "preview", summary: "Preview the manual plan." },
    { id: "proposal-1", source: "assistant", kind: "original", status: "detected", summary: "Render metadata timeline.", touchedFiles: ["apps/gui/src/components/MultiStepTaskTimelinePanel.tsx"] },
  ],
  agentRun: {
    goal: { id: "goal-1", title: "Add manual timeline panel" },
    proposal: { id: "proposal-1", summary: "Render metadata timeline.", touchedFiles: ["apps/gui/src/components/MultiStepTaskTimelinePanel.tsx"] },
    applyRequest: { requested: true, source: "user", requestId: "apply-1" },
    applyResult: { status: "applied", summary: "Applied after explicit user request." },
    verificationRequest: { requested: true, source: "user", requestId: "verify-1" },
    verificationProgress: { status: "running" },
    verificationResult: { status: "succeeded", exitCode: 0, durationMs: 1200, summary: "Panel tests passed." },
  },
  followupDraft: { intent: "followup", summary: "Draft follow-up only after review.", labels: ["draft-only"] },
  traceEntries: [
    { id: "trace-goal", timestamp: "2026-06-28T08:00:00.000Z", family: "agentRun.goalReady", title: "Goal ready", status: "succeeded" },
    { id: "trace-apply", timestamp: "2026-06-28T08:01:00.000Z", family: "agentRun.applyRequested", title: "Apply requested", status: "pending", requestId: "apply-1" },
    { id: "trace-verify", timestamp: "2026-06-28T08:02:00.000Z", family: "agentRun.verificationResult", title: "Verification result", status: "succeeded", requestId: "verify-1" },
    { id: "trace-followup", timestamp: "2026-06-28T08:03:00.000Z", family: "verification.followupPromptDrafted", title: "Follow-up", status: "info" },
    { id: "trace-final", timestamp: "2026-06-28T08:04:00.000Z", family: "agentRun.completed", title: "Completed", status: "succeeded" },
  ],
};

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  localStorage.clear();
  sessionStorage.clear();
});

describe("MultiStepTaskTimelinePanel", () => {
  it("renders collapsed by default with read-only manual timeline summary", () => {
    renderPanel({ input: fullInput });

    const details = timelineDetails();
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Manual timeline");
    expect(container?.textContent).toContain("metadata only");
    expect(container?.textContent).toContain("no automatic execution");
    expect(container?.textContent).toContain("12 steps");
    expect(container?.textContent).toContain("latest succeeded");
    expect(container?.textContent).not.toContain("Goal and context");
    expect(buttons()).toHaveLength(0);
  });

  it("renders a conservative empty state when timeline has no display items", () => {
    renderPanel({ timeline: createMultiStepTaskTimeline({ maxItems: 0 }) });
    openTimeline();

    const text = container?.textContent ?? "";
    expect(text).toContain("0 steps");
    expect(text).toContain("latest empty");
    expect(text).toContain("No manual timeline metadata yet");
    expect(text).toContain("This panel stays read-only");
    expect(buttons()).toHaveLength(0);
  });

  it("renders full manual flow groups and metadata without raw content", () => {
    renderPanel({ input: fullInput });
    openTimeline();

    const text = container?.textContent ?? "";
    expect(text).toContain("Goal and context");
    expect(text).toContain("Review and apply");
    expect(text).toContain("Verification");
    expect(text).toContain("Follow-up and final");
    expect(text).toContain("Task goal ready");
    expect(text).toContain("Explicit context attached");
    expect(text).toContain("Task memory attached");
    expect(text).toContain("Review timeline steps");
    expect(text).toContain("Proposal detected");
    expect(text).toContain("Apply requested");
    expect(text).toContain("Apply completed");
    expect(text).toContain("Verification requested");
    expect(text).toContain("Verification in progress");
    expect(text).toContain("Verification completed");
    expect(text).toContain("Follow-up draft prepared");
    expect(text).toContain("Agent Run completed after user-confirmed verification");
    expect(text).toContain("request apply-1");
    expect(text).toContain("request verify-1");
    expect(text).not.toContain("raw context body");
    expect(text).not.toContain("raw memory body");
    expect(text).not.toContain("raw JSON");
    expect(buttons()).toHaveLength(0);
  });

  it("sanitizes unsafe labels and does not render raw prompt body diff command or output", () => {
    const secret = "access_token=" + "x".repeat(64);
    renderPanel({
      input: {
        goal: `raw prompt ${secret}`,
        planPreview: { title: "command npm test", summary: "raw body /Users/alice/private.ts", labels: ["safe label", secret] },
        agentRun: { rawDiff: "diff --git a/b", verificationResult: { status: "failed", outputTail: `stderr ${secret}` } },
        traceEntries: [{ id: "trace", timestamp: "2026-06-28T08:00:00.000Z", family: "agentRun.verificationResult", title: "Verification", status: "failed", requestId: "Bearer-secret" }],
      },
    });
    openTimeline();

    const text = container?.textContent ?? "";
    expect(text).toContain("[redacted]");
    expect(text).toContain("safe label");
    expect(text).toContain("Sanitized diagnostics");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("npm test");
    expect(text).not.toContain("raw prompt");
    expect(text).not.toContain("raw body");
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("diff --git");
    expect(text).not.toContain("stderr");
    expect(text).not.toContain("Bearer-secret");
  });

  it("does not expose action buttons or browser storage persistence", () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderPanel({ input: fullInput });
    openTimeline();

    const buttonLabels = buttons().map((button) => button.textContent);
    expect(buttonLabels).not.toContain("Send");
    expect(buttonLabels).not.toContain("Apply");
    expect(buttonLabels).not.toContain("Run verification");
    expect(buttonLabels).not.toContain("Attach");
    expect(buttonLabels).not.toContain("Search");
    expect(buttonLabels).not.toContain("Save");
    expect(buttons()).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Manual timeline");
    expect(browserStorageDump()).not.toContain("Panel tests passed");
  });
});

function renderPanel(props: Parameters<typeof MultiStepTaskTimelinePanel>[0]) {
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(<MultiStepTaskTimelinePanel {...props} />);
  });
}

function timelineDetails(): HTMLDetailsElement {
  const details = container?.querySelector<HTMLDetailsElement>("[data-testid='multi-step-task-timeline-details']");
  if (!details) {
    throw new Error("Timeline details not found");
  }
  return details;
}

function openTimeline() {
  act(() => {
    const details = timelineDetails();
    details.open = true;
    details.dispatchEvent(new Event("toggle", { bubbles: true }));
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll("button") ?? []);
}

function browserStorageDump(): string {
  return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } });
}
