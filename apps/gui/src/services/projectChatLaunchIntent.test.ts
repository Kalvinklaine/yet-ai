import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectChatLaunchIntent,
  bindProjectChatLaunchIntentChatId,
  consumeProjectChatLaunchIntent,
  createProjectChatLaunchIntent,
  createProjectChatLaunchIntentStore,
  peekProjectChatLaunchIntent,
  type ProjectChatLaunchIntentInput,
  type ProjectChatLaunchIntentStore,
} from "./projectChatLaunchIntent";

const projectA = "prj_abcdefghijklmnopqrstuA";
const projectB = "prj_BBBBBBBBBBBBBBBBBBBBBQ";
const baseInput: ProjectChatLaunchIntentInput = {
  projectId: projectA,
  chatId: "chat-1",
  source: "project_home",
  selectedNoteIds: ["note-1", "note-2"],
  lifecycleGeneration: "ready-1",
};
const match = { projectId: projectA, chatId: "chat-1", lifecycleGeneration: "ready-1" };

beforeEach(() => clearProjectChatLaunchIntent());

describe("projectChatLaunchIntent", () => {
  it("creates frozen bounded metadata and consumes a matching intent once", () => {
    const selectedNoteIds = ["note-1", "note-2"];
    const intent = createProjectChatLaunchIntent({ ...baseInput, selectedNoteIds }, { nowEpochMs: 1_000, ttlMs: 500 });
    selectedNoteIds.push("note-late");

    expect(intent).toEqual(expect.objectContaining({ version: 1, projectId: projectA, chatId: "chat-1", source: "project_home", selectedNoteIds: ["note-1", "note-2"], createdAtEpochMs: 1_000, expiresAtEpochMs: 1_500 }));
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent?.selectedNoteIds)).toBe(true);
    expect(peekProjectChatLaunchIntent(match, { nowEpochMs: 1_100 })).toEqual(intent);
    expect(consumeProjectChatLaunchIntent(match, { nowEpochMs: 1_100 })).toEqual(intent);
    expect(consumeProjectChatLaunchIntent(match, { nowEpochMs: 1_100 })).toBeNull();
  });

  it("binds an engine-issued chat id to a matching draft intent", () => {
    createProjectChatLaunchIntent({ ...baseInput, chatId: undefined }, { nowEpochMs: 1_000 });
    expect(bindProjectChatLaunchIntentChatId({ projectId: projectA, lifecycleGeneration: "ready-1" }, "chat-created", { nowEpochMs: 1_001 })?.chatId).toBe("chat-created");
    expect(consumeProjectChatLaunchIntent({ projectId: projectA, chatId: "chat-created", lifecycleGeneration: "ready-1" }, { nowEpochMs: 1_002 })?.selectedNoteIds).toEqual(["note-1", "note-2"]);
  });

  it("fails closed and consumes on project, chat, generation, and expiry mismatches", () => {
    const cases = [
      { projectId: projectB, chatId: "chat-1", lifecycleGeneration: "ready-1" },
      { projectId: projectA, chatId: "chat-2", lifecycleGeneration: "ready-1" },
      { projectId: projectA, chatId: "chat-1", lifecycleGeneration: "ready-2" },
    ];
    for (const rejectedMatch of cases) {
      createProjectChatLaunchIntent(baseInput, { nowEpochMs: 1_000 });
      expect(consumeProjectChatLaunchIntent(rejectedMatch, { nowEpochMs: 1_001 })).toBeNull();
      expect(consumeProjectChatLaunchIntent(match, { nowEpochMs: 1_001 })).toBeNull();
    }

    createProjectChatLaunchIntent(baseInput, { nowEpochMs: 1_000, ttlMs: 10 });
    expect(consumeProjectChatLaunchIntent(match, { nowEpochMs: 1_010 })).toBeNull();
  });

  it("rejects malformed, duplicate, and over-limit data while clearing prior intent", () => {
    const rejectedInputs: ProjectChatLaunchIntentInput[] = [
      { ...baseInput, projectId: "bad-project" },
      { ...baseInput, chatId: "bad/chat" },
      { ...baseInput, lifecycleGeneration: "bad generation" },
      { ...baseInput, selectedNoteIds: ["note-1", "note-1"] },
      { ...baseInput, selectedNoteIds: ["note-1", "note-2", "note-3", "note-4"] },
      { ...baseInput, selectedNoteIds: ["note-1", "/private/note"] },
    ];
    for (const rejectedInput of rejectedInputs) {
      createProjectChatLaunchIntent(baseInput, { nowEpochMs: 1_000 });
      expect(createProjectChatLaunchIntent(rejectedInput, { nowEpochMs: 1_001 })).toBeNull();
      expect(peekProjectChatLaunchIntent(match, { nowEpochMs: 1_002 })).toBeNull();
    }
  });

  it("replaces and clears injected in-memory intent without browser persistence", () => {
    const store = createProjectChatLaunchIntentStore();
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    const historyWrite = vi.spyOn(History.prototype, "pushState");
    createProjectChatLaunchIntent(baseInput, { store, nowEpochMs: 1_000 });
    createProjectChatLaunchIntent({ ...baseInput, chatId: "chat-2", selectedNoteIds: ["note-3"] }, { store, nowEpochMs: 1_001 });

    expect(consumeProjectChatLaunchIntent(match, { store, nowEpochMs: 1_002 })).toBeNull();
    expect(store.read()).toBeNull();
    createProjectChatLaunchIntent(baseInput, { store, nowEpochMs: 1_003 });
    clearProjectChatLaunchIntent(store);
    expect(store.read()).toBeNull();
    expect(localWrite).not.toHaveBeenCalled();
    expect(historyWrite).not.toHaveBeenCalled();
  });

  it("rejects malformed values supplied by an injected store", () => {
    const store: ProjectChatLaunchIntentStore = { read: () => ({ ...baseInput, version: 1, createdAtEpochMs: 1_000, expiresAtEpochMs: 2_000, selectedNoteIds: ["note-1", "note-1"] }), write: vi.fn() };
    expect(peekProjectChatLaunchIntent(match, { store, nowEpochMs: 1_001 })).toBeNull();
    expect(store.write).toHaveBeenCalledWith(null);
  });
});
