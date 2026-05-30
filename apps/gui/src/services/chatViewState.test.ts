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

  it.each([
    ["provider_unauthorized", "update or check the provider API key"],
    ["provider_rate_limited", "check provider quota or billing"],
    ["provider_context_too_large", "shorten the prompt or reduce attached editor context"],
    ["provider_invalid_request", "check the model id, provider endpoint, and saved provider settings"],
    ["provider_timeout", "check network connectivity or the local provider server"],
    ["provider_upstream_error", "the provider or local server failed"],
    ["provider_malformed_stream", "invalid streaming data"],
    ["provider_config_error", "review provider setup"],
    ["provider_not_configured", "configure and enable a provider"],
    ["model_not_configured", "configure a chat-ready model"],
    ["provider_request_failed", "check local provider configuration and readiness"],
  ])("adds recovery guidance for %s", (code, guidance) => {
    const state = applyChatViewEvent(
      createInitialChatViewState("chat-1"),
      event("error", { code, message: "Provider failed safely." }),
    );

    expect(state.messages[0].content).toContain("Provider failed safely.");
    expect(state.messages[0].content).toContain("Recovery:");
    expect(state.messages[0].content).toContain(guidance);
  });

  it("uses safe fallback recovery for unknown and malformed error codes", () => {
    const state = [
      event("error", { code: "future_provider_error", message: "Future provider failure." }),
      event("error", { code: 123, message: "Malformed code failure." }),
    ].reduce<ChatViewState>(applyChatViewEvent, createInitialChatViewState("chat-1"));

    expect(state.messages[0].content).toContain("Future provider failure.");
    expect(state.messages[0].content).toContain("Recovery: check local provider configuration and readiness, then retry.");
    expect(state.messages[1].content).toContain("Malformed code failure.");
    expect(state.messages[1].content).toContain("Recovery: check local provider configuration and readiness, then retry.");
  });

  it("redacts secret-bearing payloads while preserving recovery guidance", () => {
    const state = applyChatViewEvent(
      createInitialChatViewState("chat-1"),
      event("error", {
        code: "provider_unauthorized",
        message: `Provider rejected Authorization: Bearer provider-secret-token access_token=${"x".repeat(64)} Cookie: session=secret`,
      }),
    );

    expect(state.messages[0].content).toContain("Provider rejected [redacted]");
    expect(state.messages[0].content).toContain("Recovery: update or check the provider API key");
    expect(state.messages[0].content).not.toContain("provider-secret-token");
    expect(state.messages[0].content).not.toContain("access_token");
    expect(state.messages[0].content).not.toContain("session=secret");
    expect(state.messages[0].content).not.toContain("x".repeat(64));
  });

  it("keeps recovery guidance for long secret-bearing error messages", () => {
    const state = applyChatViewEvent(
      createInitialChatViewState("chat-1"),
      event("error", {
        code: "provider_context_too_large",
        message: `Provider failed ${"A".repeat(1100)} Authorization: Bearer long-provider-secret access_token=${"x".repeat(64)}`,
      }),
    );

    expect(state.messages[0].content.length).toBeLessThanOrEqual(501);
    expect(state.messages[0].content).toContain("Recovery: shorten the prompt or reduce attached editor context, then retry.");
    expect(state.messages[0].content).not.toContain("long-provider-secret");
    expect(state.messages[0].content).not.toContain("access_token");
    expect(state.messages[0].content).not.toContain("x".repeat(64));
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
      { id: "chat-1-message-1", role: "error", content: "Chat error\nRecovery: check local provider configuration and readiness, then retry.", status: "error" },
    ]);
  });
});
