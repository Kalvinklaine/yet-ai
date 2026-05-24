import { authHeaders, joinUrl, validateRuntimeBaseUrl, type RuntimeError, type RuntimeSettings } from "./runtimeClient";

export type SseEvent = {
  seq: number;
  type:
    | "snapshot"
    | "stream_started"
    | "stream_delta"
    | "stream_finished"
    | "message_added"
    | "message_updated"
    | "message_removed"
    | "thread_updated"
    | "runtime_updated"
    | "queue_updated"
    | "pause_required"
    | "ide_tool_required"
    | "error";
  chatId: string;
  payload?: Record<string, unknown>;
};

export type SseCallbacks = {
  onEvent: (event: SseEvent) => void;
  onError: (error: RuntimeError) => void;
};

const sseEventTypes = new Set<SseEvent["type"]>([
  "snapshot",
  "stream_started",
  "stream_delta",
  "stream_finished",
  "message_added",
  "message_updated",
  "message_removed",
  "thread_updated",
  "runtime_updated",
  "queue_updated",
  "pause_required",
  "ide_tool_required",
  "error",
]);

const maxBufferBytes = 1_000_000;
const maxFrameBytes = 250_000;

export async function subscribeToChat(
  settings: RuntimeSettings,
  chatId: string,
  callbacks: SseCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const validation = validateRuntimeBaseUrl(settings.baseUrl);
  if (!validation.ok) {
    callbacks.onError(validation.error);
    return;
  }

  let response: Response;
  try {
    response = await fetch(
      joinUrl(settings.baseUrl, `/v1/chats/subscribe?chat_id=${encodeURIComponent(chatId)}`),
      {
        headers: {
          ...authHeaders(settings),
          Accept: "text/event-stream",
        },
        signal,
      },
    );
  } catch (error) {
    if (!signal.aborted) {
      callbacks.onError({
        status: "network",
        message: error instanceof Error ? error.message : "SSE connection failed",
      });
    }
    return;
  }

  if (!response.ok || !response.body) {
    callbacks.onError({
      status: response.status,
      message:
        response.status === 401
          ? "Unauthorized SSE request. Check the session token."
          : `SSE request failed with HTTP ${response.status}`,
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let expectedSeq: number | null = null;

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > maxBufferBytes) {
        callbacks.onError({ status: "protocol", message: "SSE buffer exceeded maximum size." });
        return;
      }
      const parsed = drainFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        const result = parseSseFrame(frame);
        if (!result.ok) {
          callbacks.onError(result.error);
          continue;
        }
        const event = result.data;
        if (!event) {
          continue;
        }
        const sequenceError = validateSseSequence(event, expectedSeq);
        expectedSeq = sequenceError.nextExpectedSeq;
        if (sequenceError.error) {
          callbacks.onError(sequenceError.error);
        }
        callbacks.onEvent(event);
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      callbacks.onError({
        status: "network",
        message: error instanceof Error ? error.message : "SSE stream failed",
      });
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseSseFrame(frame: string): { ok: true; data: SseEvent | null } | { ok: false; error: RuntimeError } {
  if (frame.length > maxFrameBytes) {
    return { ok: false, error: { status: "protocol", message: "SSE frame exceeded maximum size." } };
  }
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) {
    return { ok: true, data: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch (error) {
    return {
      ok: false,
      error: {
        status: "parse",
        message: error instanceof Error ? `Invalid SSE JSON: ${error.message}` : "Invalid SSE JSON.",
      },
    };
  }

  if (!isSseEvent(parsed)) {
    return { ok: false, error: { status: "protocol", message: "Invalid SSE event shape." } };
  }
  return { ok: true, data: parsed };
}

export function drainFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((part) => part.trim() !== ""), rest };
}

export function validateSseSequence(
  event: SseEvent,
  expectedSeq: number | null,
): { nextExpectedSeq: number | null; error?: RuntimeError } {
  if (event.type === "snapshot") {
    return { nextExpectedSeq: 1 };
  }
  if (expectedSeq === null) {
    return { nextExpectedSeq: null };
  }
  if (event.seq !== expectedSeq) {
    return {
      nextExpectedSeq: event.seq + 1,
      error: {
        status: "sequence",
        message: `SSE sequence gap: expected ${expectedSeq}, received ${event.seq}`,
      },
    };
  }
  return { nextExpectedSeq: expectedSeq + 1 };
}

function isSseEvent(value: unknown): value is SseEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.seq === "number" &&
    Number.isInteger(record.seq) &&
    record.seq >= 0 &&
    typeof record.type === "string" &&
    sseEventTypes.has(record.type as SseEvent["type"]) &&
    typeof record.chatId === "string" &&
    record.chatId.length > 0 &&
    (record.payload === undefined || (typeof record.payload === "object" && record.payload !== null && !Array.isArray(record.payload)))
  );
}
