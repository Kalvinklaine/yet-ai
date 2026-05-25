import { sanitizeErrorText } from "./redaction";
import type { SseEvent } from "./sseClient";

export type ChatViewMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  status?: "pending" | "streaming" | "complete" | "error";
};

export type ChatViewState = {
  chatId: string;
  messages: ChatViewMessage[];
  subscriptionReady: boolean;
};


export function createInitialChatViewState(chatId: string): ChatViewState {
  return resetChatViewState(chatId);
}

export function resetChatViewState(chatId: string): ChatViewState {
  return { chatId, messages: [], subscriptionReady: false };
}

export function addAcceptedUserMessage(state: ChatViewState, content: string): ChatViewState {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: nextMessageId(state),
        role: "user",
        content,
        status: "complete",
      },
    ],
  };
}

export function applyChatViewEvent(state: ChatViewState, event: SseEvent): ChatViewState {
  if (event.chatId !== state.chatId) {
    return state;
  }

  switch (event.type) {
    case "snapshot":
      return { ...state, subscriptionReady: true };
    case "stream_started":
      return applyStreamStarted(state);
    case "stream_delta":
      return applyStreamDelta(state, event.payload);
    case "stream_finished":
      return applyStreamFinished(state);
    case "error":
      return appendMessage(state, {
        role: "error",
        content: sanitizeErrorText(readErrorMessage(event.payload)),
        status: "error",
      });
    default:
      return state;
  }
}

function applyStreamStarted(state: ChatViewState): ChatViewState {
  if (findStreamingAssistantIndex(state.messages) >= 0) {
    return state;
  }
  return appendMessage(state, { role: "assistant", content: "", status: "streaming" });
}

function applyStreamDelta(state: ChatViewState, payload: SseEvent["payload"]): ChatViewState {
  const content = readDeltaContent(payload);
  if (content === null) {
    return state;
  }
  const streamingIndex = findStreamingAssistantIndex(state.messages);
  if (streamingIndex < 0) {
    return appendMessage(state, { role: "assistant", content, status: "streaming" });
  }
  return updateMessage(state, streamingIndex, {
    ...state.messages[streamingIndex],
    content: `${state.messages[streamingIndex].content}${content}`,
  });
}

function applyStreamFinished(state: ChatViewState): ChatViewState {
  return stopStreamingAssistant(state);
}

export function stopStreamingAssistant(state: ChatViewState): ChatViewState {
  const streamingIndex = findStreamingAssistantIndex(state.messages);
  if (streamingIndex < 0) {
    return state;
  }
  return updateMessage(state, streamingIndex, {
    ...state.messages[streamingIndex],
    status: "complete",
  });
}

export const finishStreamingAssistant = stopStreamingAssistant;

function appendMessage(
  state: ChatViewState,
  message: Omit<ChatViewMessage, "id">,
): ChatViewState {
  return {
    ...state,
    messages: [...state.messages, { id: nextMessageId(state), ...message }],
  };
}

function updateMessage(state: ChatViewState, index: number, message: ChatViewMessage): ChatViewState {
  return {
    ...state,
    messages: state.messages.map((current, currentIndex) => (currentIndex === index ? message : current)),
  };
}

function findStreamingAssistantIndex(messages: ChatViewMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.status === "streaming") {
      return index;
    }
  }
  return -1;
}

function nextMessageId(state: ChatViewState): string {
  return `${state.chatId}-message-${state.messages.length + 1}`;
}

function readDeltaContent(payload: SseEvent["payload"]): string | null {
  const delta = payload?.delta;
  if (typeof delta !== "object" || delta === null || Array.isArray(delta)) {
    return null;
  }
  const content = (delta as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

function readErrorMessage(payload: SseEvent["payload"]): string {
  return typeof payload?.message === "string" && payload.message.trim() !== "" ? payload.message : "Chat error";
}

