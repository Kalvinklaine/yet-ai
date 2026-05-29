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

  it("hydrates snapshot messages from persisted history", () => {
    const next = applyChatViewEvent(createInitialChatViewState("chat-1"), event("snapshot", {
      messages: [
        { id: "msg-1", chatId: "chat-1", role: "user", content: "Persisted prompt", createdAt: "2026-05-29T07:15:00Z", status: "complete" },
        { id: "msg-2", chatId: "chat-1", role: "assistant", content: "Persisted answer", createdAt: "2026-05-29T07:16:00Z", status: "complete" },
      ],
    }));

    expect(next.subscriptionReady).toBe(true);
    expect(next.messages).toEqual([
      { id: "msg-1", role: "user", content: "Persisted prompt", status: "complete" },
      { id: "msg-2", role: "assistant", content: "Persisted answer", status: "complete" },
    ]);
  });

  it("hydrates nested thread snapshot messages", () => {
    const next = applyChatViewEvent(createInitialChatViewState("chat-1"), event("snapshot", {
      thread: {
        messages: [
          { id: "msg-1", chatId: "chat-1", role: "user", content: "Nested prompt", createdAt: "2026-05-29T07:15:00Z" },
        ],
      },
    }));

    expect(next.messages).toEqual([
      { id: "msg-1", role: "user", content: "Nested prompt", status: "complete" },
    ]);
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

  it("terminates active assistant streaming before appending an error", () => {
    const started = applyChatViewEvent(createInitialChatViewState("chat-1"), event("stream_started", { role: "assistant" }));
    const delta = applyChatViewEvent(started, event("stream_delta", { delta: { content: "Partial" } }));
    const failed = applyChatViewEvent(delta, event("error", { message: "Provider failed auth_token=secret" }));

    expect(failed.messages).toHaveLength(2);
    expect(failed.messages[0]).toMatchObject({ role: "assistant", content: "Partial", status: "complete" });
    expect(failed.messages[1]).toMatchObject({ role: "error", status: "error" });
    expect(failed.messages.some((message) => message.status === "streaming")).toBe(false);
    expect(failed.messages[1].content).not.toContain("auth_token");
    expect(failed.messages[1].content).not.toContain("secret");
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
