import type { ChatSummary } from "./runtimeClient";

export type ResolveChatAfterListReason = "current_present" | "first_summary" | "default_chat";

export type ResolveChatAfterListInput = {
  currentChatId: string;
  summaries: ChatSummary[];
  defaultChatId: string;
};

export type ResolveChatAfterListResult = {
  nextChatId: string;
  shouldResetView: boolean;
  reason: ResolveChatAfterListReason;
};

export function resolveChatAfterList({ currentChatId, summaries, defaultChatId }: ResolveChatAfterListInput): ResolveChatAfterListResult {
  if (summaries.some((summary) => summary.chatId === currentChatId)) {
    return { nextChatId: currentChatId, shouldResetView: false, reason: "current_present" };
  }
  const firstSummaryChatId = summaries[0]?.chatId;
  if (firstSummaryChatId) {
    return { nextChatId: firstSummaryChatId, shouldResetView: firstSummaryChatId !== currentChatId, reason: "first_summary" };
  }
  return { nextChatId: defaultChatId, shouldResetView: defaultChatId !== currentChatId, reason: "default_chat" };
}

export type ResolveFallbackChatAfterDeleteInput = {
  summariesBeforeDelete: ChatSummary[];
  deletedChatId: string;
  activeChatId: string;
  defaultChatId: string;
};

export type ResolveFallbackChatAfterDeleteResult = {
  remainingSummaries: ChatSummary[];
  nextChatId: string;
  deletedCurrent: boolean;
  shouldResetView: boolean;
};

export function resolveFallbackChatAfterDelete({ summariesBeforeDelete, deletedChatId, activeChatId, defaultChatId }: ResolveFallbackChatAfterDeleteInput): ResolveFallbackChatAfterDeleteResult {
  const deletedIndex = summariesBeforeDelete.findIndex((summary) => summary.chatId === deletedChatId);
  const remainingSummaries = summariesBeforeDelete.filter((summary) => summary.chatId !== deletedChatId);
  const deletedCurrent = activeChatId === deletedChatId;
  if (!deletedCurrent) {
    return { remainingSummaries, nextChatId: activeChatId, deletedCurrent, shouldResetView: false };
  }
  const fallbackIndex = Math.max(0, Math.min(deletedIndex, remainingSummaries.length - 1));
  const nextChatId = remainingSummaries[fallbackIndex]?.chatId ?? defaultChatId;
  return { remainingSummaries, nextChatId, deletedCurrent, shouldResetView: true };
}

export function conversationHistoryStatusLabel({ loading, current, count, hasError }: { loading: boolean; current: boolean; count: number; hasError: boolean }): string {
  if (loading) {
    return "Loading local runtime conversations…";
  }
  if (!current) {
    return "Local runtime conversation list is waiting for the current settings.";
  }
  if (hasError) {
    return "Local runtime conversation history could not be loaded.";
  }
  if (count === 0) {
    return "No local runtime conversations returned.";
  }
  return `${count} local runtime conversation${count === 1 ? "" : "s"} returned.`;
}
