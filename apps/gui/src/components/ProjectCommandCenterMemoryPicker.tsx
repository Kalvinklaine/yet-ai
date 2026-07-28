import { useMemo } from "react";
import {
  projectCommandCenterLimits,
  sanitizeMemorySelection,
  shapeMemorySummaries,
  type MemoryNoteSummaryItem,
} from "../services/projectCommandCenterData";

export type ProjectCommandCenterMemoryPickerProps = {
  notes: readonly MemoryNoteSummaryItem[];
  selectedNoteIds?: readonly string[];
  onSelectionChange: (noteIds: string[]) => void;
};

export function ProjectCommandCenterMemoryPicker({
  notes,
  selectedNoteIds = [],
  onSelectionChange,
}: ProjectCommandCenterMemoryPickerProps) {
  const safeNotes = useMemo(() => sanitizeNotes(notes), [notes]);
  const availableIds = useMemo(() => new Set(safeNotes.map((note) => note.noteId)), [safeNotes]);
  const selectedIds = useMemo(
    () => sanitizeMemorySelection(selectedNoteIds).filter((id) => availableIds.has(id)),
    [availableIds, selectedNoteIds],
  );
  const selected = new Set(selectedIds);

  const toggle = (noteId: string) => {
    const next = selected.has(noteId)
      ? selectedIds.filter((id) => id !== noteId)
      : sanitizeMemorySelection([...selectedIds, noteId]);
    onSelectionChange(next);
  };

  if (safeNotes.length === 0) return <p>No memory notes.</p>;

  return (
    <fieldset className="project-command-center-memory-picker">
      <legend>Choose project memory</legend>
      <p>Select up to {projectCommandCenterLimits.memorySelections} notes to carry into chat.</p>
      <div className="stack">
        {safeNotes.map((note) => {
          const checked = selected.has(note.noteId);
          const limitReached = selectedIds.length >= projectCommandCenterLimits.memorySelections && !checked;
          return (
            <article key={note.noteId}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={limitReached}
                  onChange={() => toggle(note.noteId)}
                />
                Select {note.title}
              </label>
              <p>{note.summary}</p>
              {note.tags.length > 0 && <span aria-label="Memory tags">{note.tags.join(" · ")}</span>}
            </article>
          );
        })}
      </div>
    </fieldset>
  );
}

function sanitizeNotes(notes: readonly MemoryNoteSummaryItem[]): MemoryNoteSummaryItem[] {
  const shaped = shapeMemorySummaries(notes.map((note, index) => ({
    id: note.noteId,
    title: note.title,
    tags: Array.isArray(note.tags) ? note.tags : [],
    summary: note.summary,
    updatedAt: new Date(index).toISOString(),
  })));
  return shaped.status === "ready" ? shaped.items : [];
}
