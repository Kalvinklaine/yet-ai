import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCommandCenter } from "./ProjectCommandCenter";
import type { ProjectCommandCenterModel } from "../services/projectCommandCenterData";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ProjectCommandCenter", () => {
  it("renders loading, empty, error, and disabled Start states accessibly", () => {
    render({
      readiness: { status: "loading" },
      conversations: { status: "empty" },
      memory: { status: "error", message: "Memory is unavailable." },
      activeWork: { status: "empty" },
      start: { enabled: false, blockedReason: "Choose a ready model first." },
    });

    expect(container.querySelectorAll("[role='status']")).toHaveLength(2);
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Memory is unavailable.");
    expect(container.textContent).toContain("No recent conversations.");
    expect(button("Start new chat").disabled).toBe(true);
    expect(button("Start new chat").getAttribute("aria-describedby")).toBe("project-command-center-start-reason");
  });

  it("invokes only explicit callbacks and never writes browser storage", () => {
    const onStart = vi.fn();
    const onResume = vi.fn();
    const onMemorySelectionChange = vi.fn();
    const onNavigateActiveWork = vi.fn();
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    render(readyModel(), { onStart, onResume, onMemorySelectionChange, onNavigateActiveWork });

    act(() => button("Start new chat").click());
    act(() => button("Resume recent design chat").click());
    act(() => checkbox("Select Architecture note").click());
    act(() => button("Open S142 in Agent").click());

    expect(onStart).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledWith("chat-1");
    expect(onMemorySelectionChange).toHaveBeenCalledWith(["note-1"]);
    expect(onNavigateActiveWork).toHaveBeenCalledWith("run-1");
    expect(localWrite).not.toHaveBeenCalled();
  });

  it("distinguishes active and blocked work and opens each only after an explicit click", () => {
    const onNavigateActiveWork = vi.fn();
    render({
      ...readyModel(),
      activeWork: { status: "ready", items: [
        { runId: "run-active", cardLabel: "S149 active", status: "active", updatedLabel: "Recently updated" },
        { runId: "run-blocked", cardLabel: "S149 blocked", status: "blocked", updatedLabel: "Recently updated" },
      ] },
    }, { onNavigateActiveWork });

    expect(container.textContent).toContain("In progress");
    expect(container.textContent).toContain("Needs attention");
    expect(onNavigateActiveWork).not.toHaveBeenCalled();
    act(() => button("Open S149 active in Agent").click());
    act(() => button("Open S149 blocked in Agent").click());
    expect(onNavigateActiveWork.mock.calls).toEqual([["run-active"], ["run-blocked"]]);
  });

  it("enforces the memory selection limit and keeps raw fields outside the DOM", () => {
    render({
      ...readyModel(),
      memory: { status: "ready", items: [
        { noteId: "note-1", title: "One", tags: [], summary: "Safe one" },
        { noteId: "note-2", title: "Two", tags: [], summary: "Safe two" },
        { noteId: "note-3", title: "Three", tags: [], summary: "Safe three" },
        { noteId: "note-4", title: "Four", tags: [], summary: "Safe four" },
      ] },
    }, { selectedMemoryNoteIds: ["note-1", "note-2", "note-3"] });

    expect(checkbox("Select Four").disabled).toBe(true);
    expect(container.textContent).not.toContain("note-1");
    expect(container.textContent).not.toContain("/private/root");
    expect(container.textContent).not.toContain("secret output");
  });

  it("associates section headings and exposes the creation state without losing long labels", () => {
    const longLabel = "A deliberately long but safe project label that must remain available to assistive technology";
    render({
      ...readyModel(),
      conversations: { status: "ready", items: [{ chatId: "chat-long", title: longLabel, updatedLabel: "Recently updated" }] },
      start: { enabled: false, blockedReason: "Starting…" },
    }, { title: longLabel });

    const commandCenter = container.querySelector(".project-command-center");
    expect(commandCenter?.getAttribute("aria-busy")).toBe("true");
    expect(button("Starting…").disabled).toBe(true);
    expect(container.querySelector("#project-command-center-recent-conversations")?.textContent).toBe("Recent conversations");
    expect(container.querySelector("[aria-labelledby='project-command-center-recent-conversations']")).not.toBeNull();
    expect(button(`Resume ${longLabel}`)).not.toBeNull();
    expect(container.textContent).toContain(longLabel);
  });
});

function render(model: ProjectCommandCenterModel, overrides: Partial<Parameters<typeof ProjectCommandCenter>[0]> = {}) {
  act(() => root.render(<ProjectCommandCenter title="Project Alpha" model={model} onStart={vi.fn()} onResume={vi.fn()} onMemorySelectionChange={vi.fn()} onNavigateActiveWork={vi.fn()} {...overrides} />));
}

function readyModel(): ProjectCommandCenterModel {
  return {
    readiness: { status: "ready", items: [{ id: "runtime", label: "Local runtime", status: "ready" }] },
    conversations: { status: "ready", items: [{ chatId: "chat-1", title: "recent design chat", updatedLabel: "Recently updated" }] },
    memory: { status: "ready", items: [{ noteId: "note-1", title: "Architecture note", tags: ["design"], summary: "Safe summary" }] },
    activeWork: { status: "ready", items: [{ runId: "run-1", cardLabel: "S142", status: "active", updatedLabel: "Recently updated" }] },
    start: { enabled: true },
  };
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label || item.getAttribute("aria-label") === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return match;
}

function checkbox(label: string): HTMLInputElement {
  const match = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.includes(label))?.querySelector("input");
  if (!(match instanceof HTMLInputElement)) throw new Error(`Missing checkbox: ${label}`);
  return match;
}
