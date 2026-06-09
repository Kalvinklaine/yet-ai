import { describe, expect, it } from "vitest";
import { conversationHistoryStatusLabel, resolveChatAfterList, resolveFallbackChatAfterDelete } from "./conversationHistory";
import type { ChatSummary } from "./runtimeClient";

function summary(chatId: string, updatedAt = chatId): ChatSummary {
  return {
    chatId,
    title: `${chatId} title`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    messageCount: 1,
  };
}

describe("conversationHistory", () => {
  it("keeps the current chat after list refresh when it is still present", () => {
    expect(resolveChatAfterList({ currentChatId: "chat-b", summaries: [summary("chat-a"), summary("chat-b")], defaultChatId: "chat-001" })).toEqual({
      nextChatId: "chat-b",
      shouldResetView: false,
      reason: "current_present",
    });
  });

  it("selects the first returned summary when current chat is absent", () => {
    expect(resolveChatAfterList({ currentChatId: "chat-missing", summaries: [summary("chat-a"), summary("chat-b")], defaultChatId: "chat-001" })).toEqual({
      nextChatId: "chat-a",
      shouldResetView: true,
      reason: "first_summary",
    });
  });

  it("falls back to the default chat when the runtime returns no summaries", () => {
    expect(resolveChatAfterList({ currentChatId: "chat-old", summaries: [], defaultChatId: "chat-001" })).toEqual({
      nextChatId: "chat-001",
      shouldResetView: true,
      reason: "default_chat",
    });
  });

  it("removes a non-current deleted chat without resetting the active view", () => {
    expect(resolveFallbackChatAfterDelete({
      summariesBeforeDelete: [summary("chat-a"), summary("chat-b"), summary("chat-c")],
      deletedChatId: "chat-b",
      activeChatId: "chat-a",
      defaultChatId: "chat-001",
    })).toEqual({
      remainingSummaries: [summary("chat-a"), summary("chat-c")],
      nextChatId: "chat-a",
      deletedCurrent: false,
      shouldResetView: false,
    });
  });

  it("selects a neighboring fallback after deleting the current chat", () => {
    expect(resolveFallbackChatAfterDelete({
      summariesBeforeDelete: [summary("chat-a"), summary("chat-b"), summary("chat-c")],
      deletedChatId: "chat-b",
      activeChatId: "chat-b",
      defaultChatId: "chat-001",
    })).toMatchObject({
      remainingSummaries: [summary("chat-a"), summary("chat-c")],
      nextChatId: "chat-c",
      deletedCurrent: true,
      shouldResetView: true,
    });
  });

  it("uses the default chat after deleting the only current chat", () => {
    expect(resolveFallbackChatAfterDelete({
      summariesBeforeDelete: [summary("chat-only")],
      deletedChatId: "chat-only",
      activeChatId: "chat-only",
      defaultChatId: "chat-001",
    })).toEqual({
      remainingSummaries: [],
      nextChatId: "chat-001",
      deletedCurrent: true,
      shouldResetView: true,
    });
  });

  it("returns stable local-runtime status labels", () => {
    expect(conversationHistoryStatusLabel({ loading: true, current: false, count: 3, hasError: false })).toBe("Loading local runtime conversations…");
    expect(conversationHistoryStatusLabel({ loading: false, current: false, count: 3, hasError: false })).toBe("Local runtime conversation list is waiting for the current settings.");
    expect(conversationHistoryStatusLabel({ loading: false, current: true, count: 0, hasError: true })).toBe("Local runtime conversation history could not be loaded.");
    expect(conversationHistoryStatusLabel({ loading: false, current: true, count: 0, hasError: false })).toBe("No local runtime conversations returned.");
    expect(conversationHistoryStatusLabel({ loading: false, current: true, count: 1, hasError: false })).toBe("1 local runtime conversation returned.");
    expect(conversationHistoryStatusLabel({ loading: false, current: true, count: 2, hasError: false })).toBe("2 local runtime conversations returned.");
  });
});
