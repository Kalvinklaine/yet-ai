import { afterEach, describe, expect, it, vi } from "vitest";
import { drainFrames, parseSseFrame, subscribeToChat, validateSseSequence, type SseEvent } from "./sseClient";
import { createProjectRuntimeSettings } from "./projectClient";

const snapshot: SseEvent = { seq: 0, type: "snapshot", chatId: "chat-1", payload: { messages: [] } };
const delta: SseEvent = { seq: 1, type: "stream_delta", chatId: "chat-1", payload: { text: "hello" } };
const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("sseClient", () => {
  it("parses snapshot and delta events", () => {
    const result = parseSseFrame(`data: ${JSON.stringify(snapshot)}`);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.data : undefined).toEqual(snapshot);
  });

  it("drains split chunks, CRLF, and multiple frames", () => {
    const first = `data: ${JSON.stringify(snapshot)}\r\n\r\ndata: {`;
    const drained = drainFrames(first);
    expect(drained.frames).toHaveLength(1);
    expect(drained.rest).toBe("data: {");
    const next = drainFrames(`${drained.rest}` + `"seq":1,"type":"stream_delta","chatId":"chat-1"}\n\n`);
    expect(next.frames).toHaveLength(1);
    const result = parseSseFrame(next.frames[0]);
    expect(result.ok ? result.data?.seq : undefined).toBe(1);
  });

  it("supports multi-line data frames and comments", () => {
    const pretty = JSON.stringify(delta, null, 2).split("\n").map((line) => `data: ${line}`).join("\n");
    const result = parseSseFrame(`: keepalive\n${pretty}`);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.data : undefined).toEqual(delta);
  });

  it("turns malformed JSON into a parse error", () => {
    const result = parseSseFrame("data: {");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("parse");
  });

  it("turns malformed event shape into a protocol error", () => {
    const result = parseSseFrame("data: {\"seq\":1,\"type\":\"unknown\",\"chatId\":\"chat-1\"}");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe("protocol");
  });

  it("reports sequence gaps", () => {
    const afterSnapshot = validateSseSequence(snapshot, null);
    expect(afterSnapshot.nextExpectedSeq).toBe(1);
    const gap = validateSseSequence({ ...delta, seq: 3 }, afterSnapshot.nextExpectedSeq);
    expect(gap.error?.status).toBe("sequence");
    expect(gap.nextExpectedSeq).toBe(4);
  });

  it("rejects a delta before the initial snapshot", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(sseResponse([delta, snapshot], cancel, false));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToChat({ baseUrl: "http://127.0.0.1:8001", token: "token" }, "chat-1", { onEvent, onError }, new AbortController().signal);

    expect(onError).toHaveBeenCalledWith({ status: "sequence", message: "SSE subscription must begin with a snapshot." });
    expect(onEvent).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a second snapshot after sequencing begins", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(sseResponse([snapshot, snapshot, delta], cancel, false));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToChat({ baseUrl: "http://127.0.0.1:8001", token: "token" }, "chat-1", { onEvent, onError }, new AbortController().signal);

    expect(onError).toHaveBeenCalledWith({ status: "sequence", message: "SSE snapshot received after sequencing began." });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(snapshot);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("delivers normal snapshot and sequence path", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    fetchMock.mockResolvedValue(sseResponse([snapshot, delta]));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToChat({ baseUrl: "http://127.0.0.1:8001", token: "token" }, "chat-1", { onEvent, onError }, new AbortController().signal);

    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(["snapshot", "stream_delta"]);
  });

  it("cancels once on abort and does not deliver later buffered events", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const onError = vi.fn();
    const onEvent = vi.fn(() => controller.abort());
    fetchMock.mockResolvedValue(sseResponse([snapshot, delta], cancel, false));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToChat({ baseUrl: "http://127.0.0.1:8001", token: "token" }, "chat-1", { onEvent, onError }, controller.signal);

    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(snapshot);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("bounds reader cancellation failure", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const cancel = vi.fn(() => {
      throw new Error("cancel failed");
    });
    fetchMock.mockResolvedValue(sseResponse([delta], cancel, false));
    vi.stubGlobal("fetch", fetchMock);

    await expect(subscribeToChat(
      { baseUrl: "http://127.0.0.1:8001", token: "token" },
      "chat-1",
      { onEvent, onError },
      new AbortController().signal,
    )).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: "sequence" }));
    expect(onEvent).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("uses the explicit project API base for chat SSE", async () => {
    fetchMock.mockResolvedValue(sseResponse([snapshot]));
    vi.stubGlobal("fetch", fetchMock);
    const projectId = "prj_abcdefghijklmnopqrstuv";
    const settings = createProjectRuntimeSettings({ baseUrl: "/", token: "", runtimeAccess: "same_origin_proxy" }, projectId);
    vi.stubGlobal("location", new URL(`http://localhost:3000/p/${projectId}/chat`));

    await subscribeToChat(settings, "chat-1", { onEvent: vi.fn(), onError: vi.fn() }, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledWith(`/p/${projectId}/v1/chats/subscribe?chat_id=chat-1`, expect.any(Object));
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBeNull();
  });

  it("reports sequence gap and does not deliver the invalid event", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(sseResponse([snapshot, { ...delta, seq: 3 }, { ...delta, seq: 4, payload: { text: "late" } }], cancel, false));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToChat({ baseUrl: "http://127.0.0.1:8001", token: "token" }, "chat-1", { onEvent, onError }, new AbortController().signal);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: "sequence" }));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(snapshot);
    expect(cancel).toHaveBeenCalled();
  });

  it("reports mismatched chat id and does not deliver the invalid event", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(sseResponse([snapshot, { ...delta, chatId: "chat-2" }], cancel, false));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToChat({ baseUrl: "http://127.0.0.1:8001", token: "token" }, "chat-1", { onEvent, onError }, new AbortController().signal);

    expect(onError).toHaveBeenCalledWith({ status: "protocol", message: "SSE event chat id did not match subscription." });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(snapshot);
    expect(cancel).toHaveBeenCalled();
  });

  it("cancels stream on fatal parse protocol error", async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(rawSseResponse(`data: ${JSON.stringify(snapshot)}\n\ndata: {\n\n`, cancel, false));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToChat({ baseUrl: "http://127.0.0.1:8001", token: "token" }, "chat-1", { onEvent, onError }, new AbortController().signal);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: "parse" }));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
  });
});

function sseResponse(events: unknown[], cancel?: () => void, close = true) {
  return rawSseResponse(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), cancel, close);
}

function rawSseResponse(content: string, cancel?: () => void, close = true) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      if (close) {
        controller.close();
      }
    },
    cancel,
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
