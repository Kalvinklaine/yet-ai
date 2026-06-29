import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import worktreeReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import { ControlledAgentWorkspaceReadinessPanel } from "./ControlledAgentWorkspaceReadinessPanel";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const forbiddenButtons = ["Start Agent", "Create Worktree", "Read Files", "Run", "Apply", "Verify", "Rollback", "Search", "Attach", "Provider"];

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

describe("ControlledAgentWorkspaceReadinessPanel", () => {
  it("renders compact S73 metadata as collapsed display-only readiness", () => {
    renderPanel(worktreeReadiness);

    const details = findDetails();
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Controlled workspace readiness");
    expect(container?.textContent).toContain("S73 future gated");
    expect(container?.textContent).toContain("metadata only");
    expect(container?.textContent).toContain("ready for future controlled mode");
    expect(container?.textContent).not.toContain("Sanitized worktree readiness label");

    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Worktree readiness metadata is available but cannot start an agent");
    expect(text).toContain("Cannot start an agent.");
    expect(text).toContain("Experimental preview only");
    expect(text).toContain("Browser preview remains unsupported for future controlled mode.");
    expect(text).toContain("workspaceMode: worktree");
    expect(text).toContain("host: vscode");
    expect(text).toContain("agentStartAllowed: false");
    expect(text).toContain("Can run commands: false");
    expect(text).toContain("Can call provider: false");
    expect(buttonTexts()).toEqual([]);
    for (const label of forbiddenButtons) {
      expect(buttonTexts()).not.toContain(label);
    }
  });

  it("blocks unsafe metadata without leaking raw values or adding action authority", () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    renderPanel({ ...worktreeReadiness, summary: `unsafe ${rawSecret}`, rawCommand: "npm test", isolation: { ...worktreeReadiness.isolation, workspaceLabel: "/Users/alice/private" } });

    const details = findDetails();
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("blocked");
    expect(text).toContain("unsafe_metadata");
    expect(text).toContain("Can start agent: false");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("s".repeat(64));
    expect(text).not.toContain("/Users/alice");
    expect(buttonTexts()).toEqual([]);
  });

  it("shows browser preview as unsupported without bridge messages", () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    renderPanel({ ...worktreeReadiness, host: "browser" });

    const details = findDetails();
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("unsupported host");
    expect(text).toContain("Browser preview remains unsupported for future controlled mode.");
    expect(postMessage).not.toHaveBeenCalled();
    expect(buttonTexts()).toEqual([]);
  });
});

function renderPanel(metadata: unknown) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ControlledAgentWorkspaceReadinessPanel metadata={metadata} />);
  });
}

function findDetails() {
  const details = container?.querySelector<HTMLDetailsElement>("[data-testid='controlled-agent-workspace-readiness-details']");
  if (!details) {
    throw new Error("Controlled workspace details not found");
  }
  return details;
}

function buttonTexts() {
  return Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent);
}
