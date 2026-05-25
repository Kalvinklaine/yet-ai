import { describe, expect, it } from "vitest";
import {
  addAcceptedUserMessage,
  applyChatViewEvent,
  createInitialChatViewState,
  resetChatViewState,
  stopStreamingAssistant,
  type ChatViewState,
} from "./chatViewState";
import type { SseEvent } from "./sseClient";

function event(type: SseEvent["type"], payload?: Record<string, unknown>, chatId = "chat-1"): SseEvent {
  return { seq: 1, type, chatId, payload };
}

describe("chatViewState", () => {
  it("creates initial and reset state", () => {
    expect(createInitialChatViewState("chat-1")).toEqual({
      chatId: "chat-1",
      messages: [],
      subscriptionReady: false,
    });

    expect(resetChatViewState("chat-2")).toEqual({
      chatId: "chat-2",
      messages: [],
      subscriptionReady: false,
    });
  });

  it("adds accepted user messages as user bubbles", () => {
    const state = addAcceptedUserMessage(createInitialChatViewState("chat-1"), "Hello");

    expect(state.messages).toEqual([
      { id: "chat-1-message-1", role: "user", content: "Hello", status: "complete" },
    ]);
  });

  it("marks snapshot ready and keeps same-chat messages", () => {
    const state = addAcceptedUserMessage(createInitialChatViewState("chat-1"), "Hello");
    const next = applyChatViewEvent(state, event("snapshot", { messages: [] }));

    expect(next.subscriptionReady).toBe(true);
    expect(next.messages).toEqual(state.messages);
  });

  it("creates assistant streaming bubble on stream start", () => {
    const state = applyChatViewEvent(createInitialChatViewState("chat-1"), event("stream_started", { role: "assistant" }));

    expect(state.messages).toEqual([
      { id: "chat-1-message-1", role: "assistant", content: "", status: "streaming" },
    ]);
    expect(applyChatViewEvent(state, event("stream_started", { role: "assistant" })).messages).toHaveLength(1);
  });

  it("appends stream deltas from current engine payload shape", () => {
    const started = applyChatViewEvent(createInitialChatViewState("chat-1"), event("stream_started", { role: "assistant" }));
    const first = applyChatViewEvent(started, event("stream_delta", { delta: { content: "Hel" } }));
    const second = applyChatViewEvent(first, event("stream_delta", { delta: { content: "lo" } }));

    expect(second.messages[0]).toMatchObject({ role: "assistant", content: "Hello", status: "streaming" });
  });

  it("creates streaming assistant when a delta arrives first", () => {
    const state = applyChatViewEvent(createInitialChatViewState("chat-1"), event("stream_delta", { delta: { content: "Hello" } }));

    expect(state.messages).toEqual([
      { id: "chat-1-message-1", role: "assistant", content: "Hello", status: "streaming" },
    ]);
  });

  it("marks current streaming assistant complete", () => {
    const started = applyChatViewEvent(createInitialChatViewState("chat-1"), event("stream_delta", { delta: { content: "Done" } }));
    const finished = applyChatViewEvent(started, event("stream_finished", { finishReason: "stop" }));

    expect(finished.messages[0]).toMatchObject({ role: "assistant", content: "Done", status: "complete" });
  });

  it("appends sanitized error messages", () => {
    const state = applyChatViewEvent(
      createInitialChatViewState("chat-1"),
      event("error", {
        code: "provider_request_failed",
        message:
          "Failed Authorization: Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 OPENAI_API_KEY=short Cookie: session=secret; refresh=also-secret /Users/alice/.codex/auth.json ?api_key=short-secret raw abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789tail",
      }),
    );

    expect(state.messages[0].role).toBe("error");
    expect(state.messages[0].status).toBe("error");
    expect(state.messages[0].content).toContain("Failed [redacted]");
    expect(state.messages[0].content).not.toContain("Bearer");
    expect(state.messages[0].content).not.toContain("OPENAI_API_KEY");
    expect(state.messages[0].content).not.toContain("session=secret");
    expect(state.messages[0].content).not.toContain("auth.json");
    expect(state.messages[0].content).not.toContain("api_key");
    expect(state.messages[0].content).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  });

  it("clears streaming status with local stop helper", () => {
    const started = applyChatViewEvent(createInitialChatViewState("chat-1"), event("stream_delta", { delta: { content: "Partial" } }));
    const stopped = stopStreamingAssistant(started);

    expect(stopped.messages[0]).toMatchObject({ role: "assistant", content: "Partial", status: "complete" });
  });

  it("ignores events for other chats", () => {
    const state = addAcceptedUserMessage(createInitialChatViewState("chat-1"), "Hello");
    const next = applyChatViewEvent(state, event("stream_delta", { delta: { content: "Nope" } }, "chat-2"));

    expect(next).toBe(state);
  });

  it("does not throw for malformed payloads", () => {
    const state = createInitialChatViewState("chat-1");
    const malformedEvents: SseEvent[] = [
      event("stream_delta"),
      event("stream_delta", { delta: null }),
      event("stream_delta", { delta: { content: 123 } }),
      event("error", { message: 123 }),
      event("stream_finished", { finishReason: 123 }),
    ];

    expect(() => malformedEvents.reduce<ChatViewState>(applyChatViewEvent, state)).not.toThrow();
    const next = malformedEvents.reduce<ChatViewState>(applyChatViewEvent, state);
    expect(next.messages).toEqual([
      { id: "chat-1-message-1", role: "error", content: "Chat error", status: "error" },
    ]);
  });
});
