import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import successFixture from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-success.json";
import blockedFixture from "../../../../packages/contracts/examples/engine/controlled-agent-file-read-blocked.json";
import { ControlledAgentFileReadPanel } from "./ControlledAgentFileReadPanel";

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

describe("ControlledAgentFileReadPanel", () => {
  it("renders bounded read evidence collapsed and omits raw file body", () => {
    renderPanel(successFixture);

    const details = findDetails();
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Controlled file read evidence");
    expect(container?.textContent).toContain("S74 bounded read");
    expect(container?.textContent).toContain("metadata only");
    expect(container?.textContent).toContain("success");
    expect(container?.textContent).not.toContain("This bounded excerpt is explicit");

    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Bounded controlled workspace read evidence.");
    expect(text).toContain("Path label: docs/architecture/013-agent-readiness-milestone.md");
    expect(text).toContain("Bytes: 72");
    expect(text).toContain("Lines: 2");
    expect(text).toContain("Content hash: sha256:[redacted]");
    expect(text).not.toContain("# 013 Agent Run Readiness Milestone");
    expect(text).not.toContain("This bounded excerpt is explicit");
    expect(container?.querySelectorAll("button")).toHaveLength(0);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("renders blocked metadata without action controls or body", () => {
    renderPanel(blockedFixture);

    const details = findDetails();
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("blocked");
    expect(text).toContain("Allowed to read: false");
    expect(text).toContain("blockedReason: policy_denied");
    expect(text).toContain("No action controls are rendered.");
    expect(text).not.toContain("raw file body");
    expect(container?.querySelectorAll("button")).toHaveLength(0);
  });
});

function renderPanel(metadata: unknown) {
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(<ControlledAgentFileReadPanel metadata={metadata} />);
  });
}

function findDetails() {
  const details = container?.querySelector("[data-testid='controlled-agent-file-read-details']");
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error("Details not found");
  }
  return details;
}
