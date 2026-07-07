import { describe, expect, it } from "vitest";
import type { ProjectMemoryNote } from "./projectMemoryClient";
import { selectControlledRunProjectMemory } from "./controlledRunProjectMemorySelection";

function note(patch: Partial<ProjectMemoryNote> = {}): ProjectMemoryNote {
  return {
    id: "mem-default",
    title: "Controlled run memory",
    text: "Use the controlled run memory summary only after explicit user selection.",
    tags: ["controlled", "memory"],
    source: "manual",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    ...patch,
  };
}

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

describe("selectControlledRunProjectMemory", () => {
  it("attaches explicitly selected safe notes with bounded sanitized summaries", () => {
    const notes = [note({ id: "mem-safe", title: "Architecture memory", text: "Local-first controlled run note.", tags: ["architecture"], taskLabel: "S104", sessionLabel: "manual" })];
    const result = selectControlledRunProjectMemory({ selectedNoteIds: ["mem-safe"], notes });

    expect(result.kind).toBe("controlled_run_project_memory_selection");
    expect(result.authority).toBe("explicit_user_selection_only");
    expect(result.selectedCount).toBe(1);
    expect(result.attachedCount).toBe(1);
    expect(result.totalSelectedBodyBytes).toBeGreaterThan(0);
    expect(result.attachments[0]).toEqual(expect.objectContaining({
      noteId: "mem-safe",
      titleLabel: "Architecture memory",
      summaryLabel: "Local-first controlled run note.",
      selectedBody: "Local-first controlled run note.",
      status: "selected",
    }));
    expect(result.labels[0]).toContain("controlled memory · selected · Architecture memory");
    expect(result.policy).toEqual({
      explicitSelectionRequired: true,
      canAutoSelectMemory: false,
      canSearchMemory: false,
      canCallRuntime: false,
      canCallProvider: false,
      canPersistRawBodies: false,
      oneShotForCurrentRun: true,
    });
  });

  it("does not attach unselected notes or auto-select by relevance", () => {
    const notes = [note({ id: "mem-match", title: "Controlled memory match", text: "Looks relevant but user did not select it." })];
    const result = selectControlledRunProjectMemory({ selectedNoteIds: [], notes });

    expect(result.selectedCount).toBe(0);
    expect(result.attachedCount).toBe(0);
    expect(result.unselectedCount).toBe(1);
    expect(result.attachments).toEqual([]);
    expect(rendered(result)).not.toContain("Looks relevant");
  });

  it("omits unsafe selected memory bodies without leaking secrets private paths or raw markers", () => {
    const secret = "access_token=" + "s".repeat(64);
    const notes = [
      note({ id: "mem-secret", title: "Provider setup", text: `Keep this hidden ${secret}` }),
      note({ id: "mem-path", title: "Path note", text: "Review /Users/alice/private/project.ts" }),
      note({ id: "mem-raw", title: "Raw payload", text: "raw prompt and file body from bridge payload" }),
    ];
    const result = selectControlledRunProjectMemory({ selectedNoteIds: ["mem-secret", "mem-path", "mem-raw"], notes });
    const output = rendered(result);

    expect(result.attachedCount).toBe(0);
    expect(result.omittedUnsafeCount).toBe(3);
    expect(result.attachments.every((attachment) => attachment.status === "omitted_unsafe")).toBe(true);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("access_token");
    expect(output).not.toContain("/Users/alice");
    expect(output).not.toContain("raw prompt");
    expect(output).not.toContain("file body");
    expect(output).not.toContain("bridge payload");
  });

  it("bounds selected count body bytes duplicates and missing notes", () => {
    const notes = [
      note({ id: "mem-1", title: "First", text: "one" }),
      note({ id: "mem-2", title: "Second", text: "two" }),
      note({ id: "mem-large", title: "Large", text: "x".repeat(40) }),
    ];
    const result = selectControlledRunProjectMemory({ selectedNoteIds: ["mem-1", "mem-2", "mem-large", "mem-missing", "mem-1"], notes, maxSelectedNotes: 1, maxBodyBytesPerNote: 10, maxTotalBodyBytes: 10 });

    expect(result.attachedCount).toBe(1);
    expect(result.omittedLimitCount).toBe(2);
    expect(result.missingCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.attachments.map((attachment) => attachment.status)).toEqual(["selected", "omitted_limit", "omitted_limit", "missing", "duplicate"]);
    expect(result.attachments.find((attachment) => attachment.noteId === "mem-large")?.selectedBody).toBeUndefined();
  });

  it("is pure and does not write browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();
    const result = selectControlledRunProjectMemory({ selectedNoteIds: ["mem-safe"], notes: [note({ id: "mem-safe", text: "Safe selected body." })] });

    expect(result.attachedCount).toBe(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
