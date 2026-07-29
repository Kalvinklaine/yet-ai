import { describe, expect, it } from "vitest";
import { acceptsChatResult, type ChatResultLineage } from "./useChatController";

const currentLineage = (overrides: Partial<ChatResultLineage> = {}): ChatResultLineage => ({
  mounted: true,
  expectedRevision: 3,
  currentRevision: 3,
  expectedAttempt: 7,
  currentAttempt: 7,
  expectedChatId: "chat-engine-issued",
  currentChatId: "chat-engine-issued",
  scopeAccepted: true,
  ...overrides,
});

describe("useChatController race lineage", () => {
  it("accepts only the current engine-issued chat result", () => {
    expect(acceptsChatResult(currentLineage())).toBe(true);
    expect(acceptsChatResult(currentLineage({ currentChatId: "chat-client-stale" }))).toBe(false);
  });

  it("rejects SSE and history results after unmount or scope change", () => {
    expect(acceptsChatResult(currentLineage({ mounted: false }))).toBe(false);
    expect(acceptsChatResult(currentLineage({ scopeAccepted: false }))).toBe(false);
  });

  it("rejects delete, reload, and select completions from an older attempt", () => {
    expect(acceptsChatResult(currentLineage({ currentAttempt: 8 }))).toBe(false);
  });

  it("rejects stale optimistic send completion after runtime revision or chat change", () => {
    expect(acceptsChatResult(currentLineage({ currentRevision: 4 }))).toBe(false);
    expect(acceptsChatResult(currentLineage({ currentChatId: "chat-selected-next" }))).toBe(false);
  });

  it("allows callers to omit attempt and chat checks while preserving mount, revision, and scope guards", () => {
    const lineage = currentLineage({
      expectedAttempt: undefined,
      currentAttempt: undefined,
      expectedChatId: undefined,
      currentChatId: undefined,
    });
    expect(acceptsChatResult(lineage)).toBe(true);
  });
});
