import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectMemoryNote } from "../services/projectMemoryClient";
import { suggestTaskMemory } from "../services/taskMemorySuggestions";
import { TaskMemorySuggestionsPanel } from "./TaskMemorySuggestionsPanel";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function note(patch: Partial<ProjectMemoryNote>): ProjectMemoryNote {
  return {
    id: "mem-default",
    title: "Default memory",
    text: "Private memory body that must not render.",
    tags: [],
    source: "manual",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...patch,
  };
}

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

describe("TaskMemorySuggestionsPanel", () => {
  it("renders bounded summary labels and attaches only after explicit click", () => {
    const onAttach = vi.fn();
    const notes = [note({ id: "mem-agent", title: "Agent memory metadata", tags: ["agent", "memory"], text: "SECRET BODY SENTINEL" })];
    renderPanel(notes, onAttach, { taskGoalLabel: "agent memory task" });

    const text = panelText();
    expect(text).toContain("Task memory suggestions");
    expect(text).toContain("metadata_only");
    expect(text).toContain("attach-only guidance");
    expect(text).toContain("suggested 1");
    expect(text).toContain("Agent memory metadata");
    expect(text).toContain("Safe metadata overlap");
    expect(text).not.toContain("SECRET BODY SENTINEL");
    expect(onAttach).not.toHaveBeenCalled();

    act(() => {
      findButton("Attach suggested memory to next message").click();
    });

    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach).toHaveBeenCalledWith(notes[0], expect.objectContaining({ status: "suggested", titleLabel: "Agent memory metadata" }));
    expect(browserStorageDump()).not.toContain("SECRET BODY SENTINEL");
  });

  it("shows already attached state and detach guidance without another attach CTA", () => {
    const onAttach = vi.fn();
    renderPanel([note({ id: "mem-attached", title: "Agent memory", tags: ["agent"] })], onAttach, {
      taskGoalLabel: "agent task",
      attachedMemoryNoteIds: ["mem-attached"],
    });

    expect(panelText()).toContain("attached 1");
    expect(panelText()).toContain("already attached");
    expect(panelText()).toContain("Use the Project Memory or bundle controls to detach before Send.");
    expect(optionalButton("Attach suggested memory to next message")).toBeUndefined();
    expect(onAttach).not.toHaveBeenCalled();
  });

  it("renders stale and unsafe notes as warning-only sanitized guidance", () => {
    const secret = "access_token=" + "x".repeat(64);
    const onAttach = vi.fn();
    renderPanel([
      note({ id: "mem-stale", title: "Superseded agent note", tags: ["agent"], sessionLabel: "old-session", updatedAt: "2026-06-01T00:00:00.000Z" }),
      note({ id: "mem-unsafe", title: `Provider payload ${secret}`, text: "raw prompt file body /Users/alice/private.ts", tags: ["tool-call"] }),
    ], onAttach, {
      taskGoalLabel: "agent task",
      sessionLabel: "current-session",
      staleBeforeIso: "2026-06-15T00:00:00.000Z",
    });

    const text = panelText();
    expect(text).toContain("stale 1");
    expect(text).toContain("unsafe 1");
    expect(text).toContain("stale · review");
    expect(text).toContain("unsafe · warning only");
    expect(text).toContain("Manual review required");
    expect(text).toContain("Unsafe memory cannot be attached from suggestions.");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("raw prompt");
    expect(optionalButton("Attach suggested memory to next message")).toBeUndefined();
    expect(onAttach).not.toHaveBeenCalled();
  });
});

function renderPanel(notes: ProjectMemoryNote[], onAttach: (note: ProjectMemoryNote) => void, input: Parameters<typeof suggestTaskMemory>[0] = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const summary = suggestTaskMemory({ projectMemoryNotes: notes, ...input });
  act(() => {
    root?.render(<TaskMemorySuggestionsPanel summary={summary} notes={notes} onAttach={onAttach} />);
  });
}

function panelText() {
  return container?.textContent ?? "";
}

function findButton(name: string) {
  const button = optionalButton(name);
  if (!button) {
    throw new Error(`Button not found: ${name}`);
  }
  return button;
}

function optionalButton(name: string) {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => button.textContent === name);
}

function browserStorageDump() {
  const values: string[] = [];
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) {
        values.push(key, storage.getItem(key) ?? "");
      }
    }
  }
  return values.join("\n");
}
