import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ProposalHistoryPanel } from "./ProposalHistoryPanel";
import { createProposalHistory } from "../services/proposalHistory";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

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

describe("ProposalHistoryPanel", () => {
  it("renders a conservative empty state", () => {
    renderPanel(createProposalHistory());

    expect(container?.textContent).toContain("Proposal history");
    expect(container?.textContent).toContain("No proposal history yet");
    expect(container?.textContent).toContain("Existing apply and verification controls remain in their own panels.");
    expect(buttons()).toHaveLength(0);
  });

  it("renders proposal comparison metadata without raw unsafe content", () => {
    const secret = "access_token=" + "p".repeat(64);
    const history = createProposalHistory([
      { id: "proposal-1", source: "assistant-1", kind: "original", summary: "Update visible copy.", touchedFiles: ["apps/gui/src/App.tsx"], editCount: 1 },
      { id: "proposal-2", source: "assistant-2", kind: "rejected", status: "rejected", summary: `raw diff ${secret}`, touchedFiles: ["/Users/alice/private.ts"], diagnostic: `private path /Users/alice/private.ts ${secret}` },
      { id: "proposal-3", source: "apply-result", kind: "applied", status: "applied", applyStatus: "applied", summary: "Host applied one file.", touchedFiles: ["apps/gui/src/App.tsx"] },
      { id: "proposal-4", source: "gui-app-tests", kind: "verification", status: "verification_succeeded", verificationStatus: "succeeded", summary: "GUI tests passed." },
    ]);

    renderPanel(history);

    const text = container?.textContent ?? "";
    expect(text).toContain("Total: 4");
    expect(text).toContain("Rejected: 1");
    expect(text).toContain("Applied: 1");
    expect(text).toContain("Verified: 1");
    expect(text).toContain("Update visible copy.");
    expect(text).toContain("Host applied one file.");
    expect(text).toContain("Verification metadata: succeeded after explicit user action");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("/Users/alice");
    expect(buttons()).toHaveLength(0);
  });
});

function renderPanel(history: Parameters<typeof ProposalHistoryPanel>[0]["history"]) {
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(<ProposalHistoryPanel history={history} />);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll("button") ?? []);
}
