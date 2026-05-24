import { describe, expect, it } from "vitest";
import { drainFrames, parseSseFrame, validateSseSequence, type SseEvent } from "./sseClient";

const snapshot: SseEvent = { seq: 0, type: "snapshot", chatId: "chat-1", payload: { messages: [] } };
const delta: SseEvent = { seq: 1, type: "stream_delta", chatId: "chat-1", payload: { text: "hello" } };

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
});
