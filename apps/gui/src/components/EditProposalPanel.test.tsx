import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditProposalPanel, type RejectedEditProposalState } from "./EditProposalPanel";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("EditProposalPanel rejected proposal guidance", () => {
  it.each([
    ["invalid_json", "Proposal format needs correction.", "one strict safe-edit JSON proposal"],
    ["unsafe_path", "A path was not workspace-relative and safe.", "corrected workspace-relative paths only"],
    ["command_tool_smuggling", "The proposal mixed edits with command or tool fields.", "replacement-only safe-edit JSON"],
    ["oversized_content", "The proposed change is too large for safe review.", "smaller patch focused on one reviewable change"],
    ["missing_confirmation", "Explicit user confirmation is missing.", "requiresUserConfirmation to true"],
  ] as Array<[RejectedEditProposalState["diagnostic"]["reasonCode"], string, string]>)("renders manual recovery guidance for %s", (reasonCode, title, nextStep) => {
    renderRejected({
      sourceMessageId: "assistant-1",
      diagnostic: { reasonCode, message: "The edit proposal was rejected." },
    });

    const text = rejectedCardText();
    expect(text).toContain("Apply is unavailable because this response did not pass safe-edit proposal validation.");
    expect(text).toContain("No apply request is available for this response.");
    expect(text).toContain(title);
    expect(text).toContain(nextStep);
    expect(text).toContain("Recovery stays manual");
    expect(text).toContain("review the next proposal card");
    expect(buttons()).toHaveLength(0);
  });

  it("redacts unsafe diagnostic content before rendering recovery guidance", () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    const rawPath = "/Users/alice/private/project/src/secret.ts";
    renderRejected({
      sourceMessageId: "assistant-1",
      diagnostic: {
        reasonCode: "unsafe_path",
        message: `Rejected ${rawPath} Authorization: Bearer provider-secret ${rawSecret}`,
      },
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("[redacted]");
    expect(text).toContain("corrected workspace-relative paths only");
    expect(text).not.toContain(rawPath);
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("Authorization");
    expect(text).not.toContain("provider-secret");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("s".repeat(64));
  });

  it("does not render apply controls for a rejected proposal", () => {
    renderRejected({
      sourceMessageId: "assistant-1",
      diagnostic: { reasonCode: "invalid_payload", message: "The edit proposal payload is invalid or unsafe." },
    });

    expect(buttons()).toHaveLength(0);
    expect(container?.textContent).not.toContain("Apply in VS Code after review");
    expect(container?.textContent).not.toContain("Apply in JetBrains after review");
  });
});

function renderRejected(rejected: RejectedEditProposalState) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <EditProposalPanel
        proposal={null}
        rejected={rejected}
        result={null}
        host="vscode"
        pendingRequestId={null}
        note={null}
        onApply={vi.fn()}
        onCancelPending={vi.fn()}
      />,
    );
  });
}

function rejectedCardText(): string {
  return container?.querySelector<HTMLElement>("[data-testid='edit-proposal-rejected-card']")?.textContent ?? "";
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll("button") ?? []);
}
