import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import worktreeReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import authorityRegistry from "../../../../packages/contracts/examples/engine/controlled-agent-authority-registry-v1.json";
import { initializeControlledAgentRunState, reduceControlledAgentRunState, type ControlledAgentRunState } from "../services/controlledAgentRunState";
import { ControlledAgentRunPanel } from "./ControlledAgentRunPanel";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let runState: ControlledAgentRunState;
const stopSpy = vi.fn();

const forbiddenButtons = ["Start Agent", "Run Agent", "Prepare Run", "Read Files", "Run command", "Apply", "Verify", "Provider"];
const forbiddenRaw = "access_token=" + "s".repeat(64);

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
  it("renders dev-preview state, limits, counters, current step, and stop without execution controls", () => {
    renderPanel(readyState());

    const text = panelText();
    expect(text).toContain("S91 controlled agent dev-preview");
    expect(text).toContain("dev-preview, not production autonomy");
    expect(text).toContain("VS Code supported path");
    expect(text).toContain("Dev-preview readiness");
    expect(text).toContain("Controlled agent dev-preview is blocked until required local readiness returns.");
    expect(text).toContain("Host: unknown");
    expect(text).toContain("Bounded read/edit: blocked");
    expect(text).toContain("Allowlisted verification: blocked");
    expect(text).toContain("One bounded repair: blocked");
    expect(text).toContain("Sanitized report: ready");
    expect(text).toContain("explicit Start/Stop");
    expect(text).toContain("VS Code is the supported explicit-control path");
    expect(text).toContain("Browser is preview-only and unsupported for privileged controlled actions");
    expect(text).toContain("JetBrains stays partial/fail-closed where controlled gaps remain");
    expect(text).toContain("Phase: workspace ready");
    expect(text).toContain("Current step: Review plan");
    expect(text).toContain("Stop reason: none");
    expect(text).toContain("Limit maxSteps: 4");
    expect(text).toContain("Counter userTurns: 1");
    expect(text).toContain("Execution allowed: false");
    expect(text).toContain("Agent start allowed: false");
    expect(text).toContain("Can run commands: false");
    expect(buttonTexts()).toContain("Start controlled dev-preview");
    expect(buttonTexts()).toContain("Stop controlled run");
    for (const label of forbiddenButtons) {
      expect(buttonTexts()).not.toContain(label);
    }
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("renders VS Code ready dev-preview status without enabling start authority", () => {
    const state = readyState();
    renderPanel({ ...state, counters: { ...state.counters, fileReadsUsed: 1, verificationRuns: 1 } }, "vscode");

    const text = panelText();
    expect(text).toContain("Controlled agent dev-preview is ready for explicit VS Code user start.");
    expect(text).toContain("Host: vscode");
    expect(text).toContain("Bounded read/edit: ready");
    expect(text).toContain("Allowlisted verification: ready");
    expect(text).toContain("One bounded repair: ready");
    expect(text).toContain("Limitations: No current dev-preview limitations were reported.");
    expect(findButton("Start controlled dev-preview").disabled).toBe(true);
    expect(findButton("Stop controlled run").disabled).toBe(false);
  });

  it("renders controlled run host capability v2 matrix as metadata only", () => {
    renderPanelWithMatrix(readyState(), "jetbrains");

    const text = panelText();
    expect(text).toContain("Host capability v2 matrix");
    expect(text).toContain("allowed to execute: false");
    expect(text).toContain("Host: JetBrains host · Partial fail-closed metadata only");
    expect(text).toContain("Capabilities: Start: unsupported fail-closed · Read: unsupported fail-closed · Edit: unsupported fail-closed · Verification: unsupported fail-closed · Repair: unsupported fail-closed");
    expect(text).toContain("These labels are safe display evidence only; unsupported hosts remain disabled and fail-closed.");
    expect(findButton("Start controlled dev-preview").disabled).toBe(true);
  });

  it("renders S109 authority registry evidence as sanitized display-only status", () => {
    renderPanel(readyState(), "vscode");

    const text = panelText();
    expect(text).toContain("S109 authority registry evidence");
    expect(text).toContain("registry status");
    expect(text).toContain("display-only evidence");
    expect(text).toContain("not a permission grant");
    expect(text).toContain("metadata only");
    expect(text).toContain("S109 contract registry for bounded dev preview authority vocabulary only.");
    expect(text).toContain("Categories: 9 total · metadata evidence 8 · fail-closed or blocked 1");
    expect(text).toContain("Hosts: Browser unsupported for trusted execution · VS Code first execution host · JetBrains fail closed until verified");
    expect(text).toContain("Authority booleans: execute false · read false · search false · apply false · verification false · provider tools false · shell false · git false · network false");
    expect(text).toContain("Registry status is sanitized evidence for future S110-S124 contracts only.");
    expect(text).toContain("grants no authority");
    expect(text).not.toContain(JSON.stringify(authorityRegistry.categories.fileRead));
    expect(text).not.toContain("safe workspace relative path");
    expect(text).not.toContain("repository-check");
    expect(buttonTexts()).not.toContain("Search");
    expect(buttonTexts()).not.toContain("Apply");
    expect(buttonTexts()).not.toContain("Verification");
    expect(buttonTexts()).not.toContain("Provider");
    expect(findButton("Start controlled dev-preview").disabled).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps unsupported host registry limitations visible without action authority", () => {
    renderPanel(readyState(), "browser");
    expect(panelText()).toContain("Browser unsupported for trusted execution");
    expect(panelText()).toContain("JetBrains fail closed until verified");
    expect(panelText()).toContain("Browser preview cannot start the controlled local agent dev-preview.");

    renderPanel(readyState(), "jetbrains");
    expect(panelText()).toContain("Browser unsupported for trusted execution");
    expect(panelText()).toContain("JetBrains fail closed until verified");
    expect(panelText()).toContain("JetBrains host support is partial in this VS Code-first dev-preview.");
    expect(findButton("Start controlled dev-preview").disabled).toBe(true);
  });

  it("renders sanitized controlled dev-preview reports for active and terminal run states", () => {
    const active = reduceControlledAgentRunState(readyState(), { type: "workspace_ready" });
    const completed = reduceControlledAgentRunState(readyState(), { type: "complete", summary: "Completed with metadata only." });
    const stopped = reduceControlledAgentRunState(readyState(), { type: "stop", reason: "user_stop", summary: "Stopped after explicit user request." });
    const failed = failedState();

    for (const [state, label] of [[active, "Running after explicit user start"], [completed, "Completed with sanitized evidence"], [stopped, "User stop recorded; stale results ignored"], [failed, "Verification failed or recovery failed closed"]] as const) {
      renderPanel(state, "vscode");
      const text = panelText();
      expect(text).toContain("Controlled dev-preview report");
      expect(text).toContain(label);
      expect(text).toContain("Host: VS Code host");
      expect(text).toContain("Report counter loopSteps:");
      expect(text).toContain("Evidence:");
      expect(text).toContain("Sanitized display-only report");
      expect(text).toContain("Raw file bodies, diffs, command output, provider payloads, private paths, and secrets are omitted.");
      expect(findButton("Start controlled dev-preview").disabled).toBe(true);
    }
  });

  it("omits unsafe controlled dev-preview report evidence", () => {
    const secret = "sk-" + "q".repeat(40);
    renderPanel({ ...readyState(), summary: `Unsafe ${secret} /Users/alice/private.ts` }, "vscode");

    const text = panelText();
    expect(text).toContain("Controlled dev-preview report");
    expect(text).toContain("Sanitized evidence summary was unavailable.");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("/Users/alice");
  });

  it("renders browser and JetBrains limitations explicitly", () => {
    renderPanel(readyState(), "browser");
    expect(panelText()).toContain("Controlled agent dev-preview is not supported in the browser host.");
    expect(panelText()).toContain("Browser preview cannot start the controlled local agent dev-preview.");
    expect(panelText()).toContain("Host: browser");

    renderPanel(readyState(), "jetbrains");
    expect(panelText()).toContain("Controlled agent dev-preview is partially available for JetBrains metadata only.");
    expect(panelText()).toContain("JetBrains host support is partial in this VS Code-first dev-preview.");
    expect(panelText()).toContain("Host: jetbrains");
    expect(findButton("Start controlled dev-preview").disabled).toBe(true);
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
    renderPanel(initializeControlledAgentRunState({ readiness: { ...worktreeReadiness, summary: forbiddenRaw, rawCommand: "npm test" }, userOptIn: { source: "user", confirmed: true } }));

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

function failedState() {
  return {
    ...readyState(),
    phase: "failed" as const,
    stopped: true,
    enabled: false,
    summary: "Verification failed without raw output.",
    nextUserAction: "review_failure" as const,
    stop: { reason: "verification_failed" as const, recoverable: true, message: "Verification failed without raw output." },
    diagnostics: [{ code: "invalid_authority" as const, message: "Verification failed without raw output." }],
  };
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

function renderPanel(state: ControlledAgentRunState, host: "browser" | "vscode" | "jetbrains" | "unknown" = "unknown") {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ControlledAgentRunPanel state={state} host={host} onStop={stopSpy} />);
  });
}

function renderPanelWithMatrix(state: ControlledAgentRunState, host: "browser" | "vscode" | "jetbrains" | "unknown" = "unknown") {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ControlledAgentRunPanel state={state} host={host} capabilityMatrix={{
      allowedToExecute: false,
      hostLabel: "JetBrains host",
      supportLabel: "Partial fail-closed metadata only",
      statusLabels: ["Start: unsupported fail-closed", "Read: unsupported fail-closed", "Edit: unsupported fail-closed", "Verification: unsupported fail-closed", "Repair: unsupported fail-closed"],
      correlationLabels: [],
      limitLabels: [],
      reasonLabels: ["Reason jetbrains parity not verified"],
      authorityLabels: ["Metadata only"],
      summary: "Display evidence only.",
    }} onStop={stopSpy} />);
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
