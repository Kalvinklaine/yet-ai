import { sanitizeErrorText } from "./redaction";
import type { ChatHistoryMessage, ChatThread } from "./runtimeClient";
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

type ChatErrorCode =
  | "provider_unauthorized"
  | "provider_rate_limited"
  | "provider_context_too_large"
  | "provider_invalid_request"
  | "provider_timeout"
  | "provider_upstream_error"
  | "provider_malformed_stream"
  | "provider_config_error"
  | "provider_not_configured"
  | "model_not_configured"
  | "provider_request_failed";

const chatErrorRecoveryCopy: Record<ChatErrorCode, string> = {
  provider_unauthorized: "Recovery: update or check the provider API key, reconnect account login, then retry.",
  provider_rate_limited: "Recovery: wait before retrying, check provider quota or billing, or try another configured model/provider.",
  provider_context_too_large: "Recovery: shorten the prompt or reduce attached editor context, then retry.",
  provider_invalid_request: "Recovery: check the model id, provider endpoint, and saved provider settings.",
  provider_timeout: "Recovery: retry, then check network connectivity or the local provider server.",
  provider_upstream_error: "Recovery: the provider or local server failed. Retry or check provider/server status.",
  provider_malformed_stream: "Recovery: the provider returned invalid streaming data. Retry or check the provider/local server.",
  provider_config_error: "Recovery: review provider setup, saved endpoint, credentials, and model readiness.",
  provider_not_configured: "Recovery: configure and enable a provider with local credentials before chatting.",
  model_not_configured: "Recovery: configure a chat-ready model for an enabled provider before chatting.",
  provider_request_failed: "Recovery: check local provider configuration and readiness, then retry.",
};


export function createInitialChatViewState(chatId: string): ChatViewState {
  return resetChatViewState(chatId);
}

export function resetChatViewState(chatId: string): ChatViewState {
  return { chatId, messages: [], subscriptionReady: false };
}

export function addAcceptedUserMessage(state: ChatViewState, content: string): ChatViewState {
  if (state.messages.some((message) => message.role === "user" && message.content === content && message.status === "complete")) {
    return state;
  }
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

export function hydrateChatViewFromThread(state: ChatViewState, thread: ChatThread): ChatViewState {
  if (thread.chatId !== state.chatId) {
    return state;
  }
  return hydrateChatViewFromMessages(state, thread.messages);
}

export function hydrateChatViewFromMessages(state: ChatViewState, messages: ChatHistoryMessage[]): ChatViewState {
  return {
    ...state,
    messages: messages
      .filter((message) => message.chatId === state.chatId)
      .map((message, index) => ({
        id: message.id || `${state.chatId}-message-${index + 1}`,
        role: message.role,
        content: message.role === "error" ? sanitizeErrorText(message.content) : message.content,
        status: message.status ?? (message.role === "error" ? "error" : "complete"),
      })),
  };
}

export function applyChatViewEvent(state: ChatViewState, event: SseEvent): ChatViewState {
  if (event.chatId !== state.chatId) {
    return state;
  }

  switch (event.type) {
    case "snapshot":
      return applySnapshot(state, event.payload);
    case "stream_started":
      return applyStreamStarted(state);
    case "stream_delta":
      return applyStreamDelta(state, event.payload);
    case "stream_finished":
      return applyStreamFinished(state);
    case "error":
      return appendMessage(stopStreamingAssistant(state), {
        role: "error",
        content: formatChatErrorContent(event.payload),
        status: "error",
      });
    default:
      return state;
  }
}

function applySnapshot(state: ChatViewState, payload: SseEvent["payload"]): ChatViewState {
  const messages = readSnapshotMessages(payload);
  if (!messages) {
    return { ...state, subscriptionReady: true };
  }
  return { ...hydrateChatViewFromMessages(state, messages), subscriptionReady: true };
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

function readSnapshotMessages(payload: SseEvent["payload"]): ChatHistoryMessage[] | null {
  if (!payload) {
    return null;
  }
  if (Array.isArray(payload.messages)) {
    const messages = payload.messages.filter(isChatHistoryMessage);
    return messages.length > 0 ? messages : null;
  }
  const thread = payload.thread;
  if (typeof thread === "object" && thread !== null && !Array.isArray(thread)) {
    const messages = (thread as Record<string, unknown>).messages;
    if (Array.isArray(messages)) {
      const historyMessages = messages.filter(isChatHistoryMessage);
      return historyMessages.length > 0 ? historyMessages : null;
    }
  }
  return null;
}

function isChatHistoryMessage(value: unknown): value is ChatHistoryMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return typeof message.id === "string"
    && typeof message.chatId === "string"
    && (message.role === "user" || message.role === "assistant" || message.role === "error")
    && typeof message.content === "string"
    && typeof message.createdAt === "string"
    && (message.status === undefined || message.status === "pending" || message.status === "streaming" || message.status === "complete" || message.status === "error");
}

function readDeltaContent(payload: SseEvent["payload"]): string | null {
  const delta = payload?.delta;
  if (typeof delta !== "object" || delta === null || Array.isArray(delta)) {
    return null;
  }
  const content = (delta as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

function formatChatErrorContent(payload: SseEvent["payload"]): string {
  const message = sanitizeErrorText(readErrorMessage(payload));
  const recovery = readErrorRecovery(payload);
  return recovery ? sanitizeErrorText(`${message}\n${recovery}`) : message;
}

function readErrorRecovery(payload: SseEvent["payload"]): string {
  const code = typeof payload?.code === "string" ? payload.code : "";
  if (isChatErrorCode(code)) {
    return chatErrorRecoveryCopy[code];
  }
  return "Recovery: check local provider configuration and readiness, then retry.";
}

function isChatErrorCode(code: string): code is ChatErrorCode {
  return Object.prototype.hasOwnProperty.call(chatErrorRecoveryCopy, code);
}

function readErrorMessage(payload: SseEvent["payload"]): string {
  return typeof payload?.message === "string" && payload.message.trim() !== "" ? payload.message : "Chat error";
}

