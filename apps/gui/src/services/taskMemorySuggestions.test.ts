import { describe, expect, it } from "vitest";
import type { ProjectMemoryNote } from "./projectMemoryClient";
import { suggestTaskMemory } from "./taskMemorySuggestions";

function note(patch: Partial<ProjectMemoryNote>): ProjectMemoryNote {
  return {
    id: "mem-default",
    title: "Default memory",
    text: "A long internal body that must not leak through suggestions.",
    tags: [],
    source: "manual",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...patch,
  };
}

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

describe("suggestTaskMemory", () => {
  it("suggests relevant safe notes from metadata overlap only", () => {
    const summary = suggestTaskMemory({
      taskGoalLabel: "Improve Agent Run memory setup",
      explicitContextLabels: ["project memory panel"],
      proposalFileLabels: ["apps/gui/src/services/taskMemorySuggestions.ts"],
      projectMemoryNotes: [note({ id: "mem-1", title: "Agent Run memory note", tags: ["agent", "memory"], text: "SECRET BODY SENTINEL" })],
    });

    expect(summary.kind).toBe("task_memory_suggestions");
    expect(summary.authority).toBe("metadata_only");
    expect(summary.executionAllowed).toBe(false);
    expect(summary.policy).toEqual({
      canAutoAttachMemory: false,
      canReadMemoryBodies: false,
      canCallRuntime: false,
      canCallProvider: false,
      explicitAttachOnly: true,
    });
    expect(summary.suggestions).toEqual([
      expect.objectContaining({
        noteId: "mem-1",
        titleLabel: "Agent Run memory note",
        status: "suggested",
        canAttachExplicitly: true,
      }),
    ]);
    expect(summary.suggestions[0].reasonLabels.join(" ")).toContain("memory");
    expect(rendered(summary)).not.toContain("SECRET BODY SENTINEL");
  });

  it("classifies already attached notes without allowing another attach", () => {
    const summary = suggestTaskMemory({
      taskGoalLabel: "Agent Run memory",
      attachedMemoryNoteIds: ["mem-attached"],
      projectMemoryNotes: [note({ id: "mem-attached", title: "Agent Run memory", tags: ["memory"] })],
    });

    expect(summary.suggestions[0]).toMatchObject({
      noteId: "mem-attached",
      status: "already_attached",
      canAttachExplicitly: false,
      warnings: [],
    });
    expect(summary.suggestions[0].reasonLabels).toEqual(["Memory note is already attached to this task."]);
  });

  it("classifies stale notes from labels dates and session mismatch without hiding them", () => {
    const summary = suggestTaskMemory({
      taskGoalLabel: "Agent Run memory",
      sessionLabel: "current-session",
      staleBeforeIso: "2026-06-15T00:00:00.000Z",
      projectMemoryNotes: [note({
        id: "mem-stale",
        title: "Superseded memory note",
        tags: ["agent"],
        sessionLabel: "older-session",
        updatedAt: "2026-06-10T00:00:00.000Z",
      })],
    });

    expect(summary.suggestions[0]).toMatchObject({
      noteId: "mem-stale",
      status: "stale",
      canAttachExplicitly: false,
    });
    expect(summary.suggestions[0].warnings).toEqual(expect.arrayContaining([
      "Memory note is labeled stale or superseded.",
      "Memory note belongs to a different session label.",
      "Memory note was updated before the stale cutoff.",
    ]));
  });

  it("classifies unsafe notes from secret private path raw prompt provider file body and tool markers", () => {
    const secret = "access_token=" + "x".repeat(64);
    const summary = suggestTaskMemory({
      taskGoalLabel: "Safe task",
      projectMemoryNotes: [note({
        id: "mem-unsafe",
        title: `Provider payload memory ${secret}`,
        text: "raw prompt and file body from /Users/alice/private/repo with tool call output",
        tags: ["tool-call", "private-path"],
      })],
    });
    const output = rendered(summary);

    expect(summary.suggestions[0]).toMatchObject({
      noteId: "mem-unsafe",
      titleLabel: "[redacted]",
      status: "unsafe",
      canAttachExplicitly: false,
    });
    expect(summary.suggestions[0].warnings).toEqual(expect.arrayContaining([
      "Secret-like memory metadata was redacted.",
      "Private path-like memory metadata was omitted.",
      "Sensitive execution marker detected.",
    ]));
    expect(output).not.toContain(secret);
    expect(output).not.toContain("access_token");
    expect(output).not.toContain("/Users/alice");
    expect(output).not.toContain("raw prompt");
    expect(output).not.toContain("file body");
  });

  it("classifies safe non-overlapping notes as unrelated", () => {
    const summary = suggestTaskMemory({
      taskGoalLabel: "Agent Run memory",
      projectMemoryNotes: [note({ id: "mem-other", title: "Theme colors", tags: ["design"] })],
    });

    expect(summary.suggestions[0]).toMatchObject({
      noteId: "mem-other",
      status: "unrelated",
      canAttachExplicitly: false,
      warnings: [],
      reasonLabels: ["No safe metadata overlap with this task."],
    });
  });

  it("bounds suggestions labels reasons warnings and never returns memory bodies", () => {
    const body = "VERY PRIVATE MEMORY BODY SHOULD STAY OUT";
    const summary = suggestTaskMemory({
      taskGoalLabel: "agent memory context proposal labels",
      maxSuggestions: 2,
      projectMemoryNotes: Array.from({ length: 5 }, (_, index) => note({
        id: `mem-${index}-${"x".repeat(200)}`,
        title: `Agent memory context proposal label ${index} ${"y".repeat(200)}`,
        text: body,
        tags: ["agent", "memory", "context", "proposal", "labels", "extra"],
      })),
    });

    expect(summary.suggestions).toHaveLength(2);
    for (const suggestion of summary.suggestions) {
      expect(suggestion.noteId.length).toBeLessThanOrEqual(97);
      expect(suggestion.titleLabel.length).toBeLessThanOrEqual(121);
      expect(suggestion.reasonLabels.length).toBeLessThanOrEqual(4);
      expect(suggestion.warnings.length).toBeLessThanOrEqual(4);
    }
    expect(rendered(summary)).not.toContain(body);
    expect(rendered(summary)).not.toContain("VERY PRIVATE MEMORY BODY");
  });

  it("is deterministic and does not mutate input notes", () => {
    const notes = [note({ id: "mem-deterministic", title: "Agent memory", tags: ["agent"] })];
    const before = structuredClone(notes);

    const first = suggestTaskMemory({ taskGoalLabel: "agent task", projectMemoryNotes: notes });
    const second = suggestTaskMemory({ taskGoalLabel: "agent task", projectMemoryNotes: notes });

    expect(first).toEqual(second);
    expect(notes).toEqual(before);
  });
});
