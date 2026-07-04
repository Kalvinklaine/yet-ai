import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import worktreeReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import { initializeControlledAgentRunState, reduceControlledAgentRunState, type ControlledAgentRunState } from "../services/controlledAgentRunState";
import { ControlledAgentRunPanel } from "./ControlledAgentRunPanel";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let runState: ControlledAgentRunState;
const stopSpy = vi.fn();

const forbiddenButtons = ["Start Agent", "Run Agent", "Prepare Run", "Read Files", "Run command", "Apply", "Verify", "Provider"];

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  stopSpy.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe("ControlledAgentRunPanel", () => {
  it("renders skeleton state, limits, counters, current step, and stop without execution controls", () => {
    renderPanel(readyState());

    const text = panelText();
    expect(text).toContain("Controlled agent run skeleton");
    expect(text).toContain("S76 preview only");
    expect(text).toContain("GUI-local state");
    expect(text).toContain("Phase: workspace ready");
    expect(text).toContain("Current step: Review plan");
    expect(text).toContain("Stop reason: none");
    expect(text).toContain("Limit maxSteps: 4");
    expect(text).toContain("Counter userTurns: 1");
    expect(text).toContain("Execution allowed: false");
    expect(text).toContain("Agent start allowed: false");
    expect(text).toContain("Can run commands: false");
    expect(buttonTexts()).toContain("Stop controlled run");
    for (const label of forbiddenButtons) {
      expect(buttonTexts()).not.toContain(label);
    }
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("stop updates GUI-local reducer state only and exposes stop reason", () => {
    renderInteractivePanel();

    act(() => {
      findButton("Stop controlled run").click();
    });

    const text = panelText();
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(text).toContain("Phase: stopped");
    expect(text).toContain("Current step: Stopped by user");
    expect(text).toContain("Stop reason: user stop");
    expect(text).toContain("Controlled run stopped from the S76 skeleton UI.");
    expect(findButton("Stop controlled run").disabled).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("sanitizes unsafe initialization metadata without leaking raw values", () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    renderPanel(initializeControlledAgentRunState({ readiness: { ...worktreeReadiness, summary: rawSecret, rawCommand: "npm test" }, userOptIn: { source: "user", confirmed: true } }));

    const text = panelText();
    expect(text).toContain("Phase: blocked");
    expect(text).toContain("unsafe metadata");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("s".repeat(64));
    expect(text).not.toContain("npm test");
    expect(findButton("Stop controlled run").disabled).toBe(true);
  });
});

function readyState() {
  return initializeControlledAgentRunState({
    readiness: structuredClone(worktreeReadiness),
    userOptIn: { source: "user", confirmed: true, requestId: "s76-panel-test" },
    limits: { maxSteps: 4, maxFileReads: 2, maxReadBytes: 4096, maxTouchedFiles: 2, maxPatchBytes: 2048, maxRuntimeSeconds: 60, maxRepairAttempts: 1 },
  });
}

function renderInteractivePanel() {
  container = document.createElement("div");
  document.body.append(container);
  runState = readyState();
  root = createRoot(container);
  const onStop = () => {
    stopSpy();
    runState = reduceControlledAgentRunState(runState, { type: "stop", reason: "user_stop", summary: "Controlled run stopped from the S76 skeleton UI." });
    root?.render(<ControlledAgentRunPanel state={runState} onStop={onStop} />);
  };
  act(() => {
    root?.render(<ControlledAgentRunPanel state={runState} onStop={onStop} />);
  });
}

function renderPanel(state: ControlledAgentRunState) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ControlledAgentRunPanel state={state} onStop={stopSpy} />);
  });
}

function panelText() {
  return container?.textContent ?? "";
}

function buttonTexts() {
  return Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent);
}

function findButton(label: string) {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent === label);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}
