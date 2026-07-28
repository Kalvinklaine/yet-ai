import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCommandCenterMemoryPicker } from "./ProjectCommandCenterMemoryPicker";
import type { MemoryNoteSummaryItem } from "../services/projectCommandCenterData";

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
  vi.restoreAllMocks();
});

describe("ProjectCommandCenterMemoryPicker", () => {
  it("starts empty and returns ids only after explicit selection and deselection", () => {
    const onSelectionChange = vi.fn();
    render(notes(), [], onSelectionChange);
    expect(checkbox("Select Architecture note").checked).toBe(false);
    expect(onSelectionChange).not.toHaveBeenCalled();

    act(() => checkbox("Select Architecture note").click());
    expect(onSelectionChange).toHaveBeenLastCalledWith(["note-1"]);
    render(notes(), ["note-1"], onSelectionChange);
    act(() => checkbox("Select Architecture note").click());
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    expect(JSON.stringify(onSelectionChange.mock.calls)).not.toContain("Safe summary");
  });

  it("enforces the shared selection limit and ignores malformed controlled ids", () => {
    const onSelectionChange = vi.fn();
    const fourNotes = [note("note-1", "One"), note("note-2", "Two"), note("note-3", "Three"), note("note-4", "Four")];
    render(fourNotes, ["bad/id", "note-1", "note-2", "note-3", "note-4"], onSelectionChange);

    expect(checkbox("Select One").checked).toBe(true);
    expect(checkbox("Select Three").checked).toBe(true);
    expect(checkbox("Select Four").disabled).toBe(true);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("re-sanitizes unsafe labels and never renders raw note bodies or hidden fields", () => {
    const unsafe = {
      noteId: "note-safe",
      title: "Bearer sk-secret-value",
      tags: ["/Users/private/key.txt", "design"],
      summary: "https://private.example.test/raw",
      text: "RAW MEMORY BODY",
      path: "/Users/private/project",
    } as MemoryNoteSummaryItem & { text: string; path: string };
    render([unsafe], [], vi.fn());

    expect(container.textContent).toContain("Memory note");
    expect(container.textContent).toContain("Saved project context");
    expect(container.textContent).toContain("design");
    expect(container.textContent).not.toContain("sk-secret-value");
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("private.example");
    expect(container.textContent).not.toContain("RAW MEMORY BODY");
  });

  it("bounds displayed notes and never writes browser storage", () => {
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    render(Array.from({ length: 8 }, (_, index) => note(`note-${index}`, `Note ${index}`)), [], vi.fn());
    expect(container.querySelectorAll("input[type='checkbox']")).toHaveLength(6);
    expect(container.textContent).not.toContain("Note 7");
    act(() => checkbox("Select Note 5").click());
    expect(localWrite).not.toHaveBeenCalled();
  });
});

function render(items: readonly MemoryNoteSummaryItem[], selectedNoteIds: readonly string[], onSelectionChange: (ids: string[]) => void) {
  act(() => root.render(<ProjectCommandCenterMemoryPicker notes={items} selectedNoteIds={selectedNoteIds} onSelectionChange={onSelectionChange} />));
}

function notes(): MemoryNoteSummaryItem[] {
  return [note("note-1", "Architecture note"), note("note-2", "Testing note")];
}

function note(noteId: string, title: string): MemoryNoteSummaryItem {
  return { noteId, title, tags: ["design"], summary: "Safe summary" };
}

function checkbox(label: string): HTMLInputElement {
  const match = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.includes(label))?.querySelector("input");
  if (!(match instanceof HTMLInputElement)) throw new Error(`Missing checkbox: ${label}`);
  return match;
}
