import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import completedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-workflow-transcript-completed.json";
import blockedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-workflow-transcript-blocked.json";
import { ControlledAgentWorkflowTranscriptPanel } from "./ControlledAgentWorkflowTranscriptPanel";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const forbiddenButtons = ["Start", "Send", "Apply", "Verify", "Search", "Run", "Rollback", "Recover", "Follow up", "Provider"];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

describe("ControlledAgentWorkflowTranscriptPanel", () => {
  it("renders collapsed sanitized transcript metadata without action controls", () => {
    renderPanel(completedFixture);

    const details = findDetails();
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Controlled workflow transcript");
    expect(container?.textContent).toContain("display only");
    expect(container?.textContent).toContain("sanitized metadata only");
    expect(container?.textContent).toContain("completed");
    expect(container?.textContent).not.toContain("User started controlled task");

    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("No workflow authority is available here.");
    expect(text).toContain("Only sanitized metadata labels, statuses, counters, request ids, and evidence hashes are shown.");
    expect(text).toContain("omitted, not approved or rendered");
    expect(text).toContain("Authority: display_export_metadata_only");
    expect(text).toContain("Execution allowed: false");
    expect(text).toContain("Task preset: Small focused fix");
    expect(text).toContain("User gates");
    expect(text).toContain("context_search_selection");
    expect(text).toContain("draft → context_selection");
    expect(text).toContain("Context labels: active file excerpt · memory note");
    expect(text).toContain("Proposal: status=confirmed");
    expect(text).toContain("Patch plan: status=confirmed");
    expect(text).toContain("Apply: status=succeeded");
    expect(text).toContain("Verification: status=succeeded");
    expect(text).toContain("Follow-up: status=skipped");
    expect(text).toContain("Recovery: status=skipped");
    expect(text).toContain("Raw data omitted: true");
    expect(text).toContain("Changed file count: 2");
    expect(text).toContain("Test count: 1");
    expect(text).toContain("Raw prompts included: false");
    expect(text).toContain("Bounded safe-share metadata only: true");
    expect(text).toContain("Transcript data remains bounded presentation-only evidence, not permission to share raw workflow data.");
    expect(buttonTexts()).toEqual([]);
    for (const label of forbiddenButtons) {
      expect(buttonTexts()).not.toContain(label);
    }
  });

  it("shows JetBrains blocked and partial host transcript evidence as conservative", () => {
    renderPanel(blockedFixture);

    const details = findDetails();
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Host: jetbrains");
    expect(text).toContain("JetBrains or partial-host transcript evidence remains conservative");
    expect(text).toContain("sanitized metadata stays manual-only and fail-closed");
    expect(text).toContain("Final bounded evidence");
    expect(text).toContain("Result: blocked");
    expect(text).toContain("Unsupported host count: 1");
    expect(text).toContain("Recovery: status=stopped");
    expect(text).toContain("Manual stop selected");
    expect(buttonTexts()).toEqual([]);
  });

  it("omits unsafe raw data and does not leak prompts, paths, diffs, commands, output, provider payloads, or secrets", () => {
    const unsafe = clone(completedFixture) as Record<string, unknown>;
    unsafe.hostSurface = "browser-preview";
    unsafe.rawPrompt = "Please use raw prompt /Users/alice/private sk-proj-123456789";
    unsafe.taskPresetLabel = "Small focused fix /Users/alice/private";
    (unsafe.contextSearch as Record<string, unknown>).selectedContextLabels = ["safe label", "/Users/alice/private/file.ts"];
    (unsafe.proposal as Record<string, unknown>).summary = "Raw provider payload included a secret token.";
    (unsafe.patchPlan as Record<string, unknown>).diffText = "diff --git a/private b/private";
    (unsafe.apply as Record<string, unknown>).replacementText = "replacement body";
    (unsafe.verification as Record<string, unknown>).commandOutput = "stdout showed full command output";
    (unsafe.finalEvidence as Record<string, unknown>).summary = "production release marketplace ready";

    renderPanel(unsafe);

    const details = findDetails();
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Browser preview remains unsupported");
    expect(text).toContain("unsafe_metadata_omitted");
    expect(text).toContain("unsafe_text_replaced");
    expect(text).toContain("Sanitized metadata omitted unsafe raw content.");
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("sk-proj-123456789");
    expect(text).not.toContain("Raw provider payload");
    expect(text).not.toContain("diff --git");
    expect(text).not.toContain("replacement body");
    expect(text).not.toContain("command output");
    expect(text).not.toContain("production release marketplace");
    expect(text).not.toContain("rawPrompt");
    expect(buttonTexts()).toEqual([]);
  });

  it("renders completed with follow-up as ready sanitized evidence", () => {
    const completedWithFollowup = clone(completedFixture) as Record<string, unknown>;
    (completedWithFollowup.finalEvidence as Record<string, unknown>).result = "completed_with_followup";

    renderPanel(completedWithFollowup);

    const panel = container?.querySelector<HTMLElement>("[data-testid='controlled-agent-workflow-transcript-panel']");
    expect(panel?.className).toContain("ready");
    expect(container?.textContent).toContain("completed_with_followup");
    expect(buttonTexts()).toEqual([]);
  });

  it("does not post bridge messages or write browser storage while rendering", () => {
    const postMessage = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    window.acquireVsCodeApi = () => ({ postMessage });

    renderPanel(completedFixture);
    const details = findDetails();
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(buttonTexts()).toEqual([]);
  });
});

function renderPanel(metadata: unknown) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ControlledAgentWorkflowTranscriptPanel metadata={metadata} />);
  });
}

function findDetails() {
  const details = container?.querySelector<HTMLDetailsElement>("[data-testid='controlled-agent-workflow-transcript-details']");
  if (!details) {
    throw new Error("Controlled workflow transcript details not found");
  }
  return details;
}

function buttonTexts() {
  return Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent);
}
