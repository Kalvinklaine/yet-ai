import { authHeaders, chatApiPath, joinUrl, validateRuntimeSettings, type ChatRuntimeSettings, type RuntimeError } from "./runtimeClient";

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

const maxBufferChars = 1_000_000;
const maxFrameChars = 250_000;

export async function subscribeToChat(
  settings: ChatRuntimeSettings,
  chatId: string,
  callbacks: SseCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const validation = validateRuntimeSettings(settings);
  if (!validation.ok) {
    callbacks.onError(validation.error);
    return;
  }

  let response: Response;
  try {
    response = await fetch(
      joinUrl(settings.baseUrl, `${chatApiPath(settings, "/chats/subscribe")}?chat_id=${encodeURIComponent(chatId)}`),
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
  let cancellation: Promise<void> | null = null;
  const cancelOnce = () => {
    cancellation ??= cancelReader(reader);
    return cancellation;
  };
  const onAbort = () => {
    void cancelOnce();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (signal.aborted) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > maxBufferChars) {
        callbacks.onError({ status: "protocol", message: "SSE buffer exceeded maximum size." });
        await cancelOnce();
        return;
      }
      const parsed = drainFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        const result = parseSseFrame(frame);
        if (!result.ok) {
          callbacks.onError(result.error);
          await cancelOnce();
          return;
        }
        const event = result.data;
        if (!event) {
          continue;
        }
        if (signal.aborted) {
          break;
        }
        if (event.chatId !== chatId) {
          callbacks.onError({ status: "protocol", message: "SSE event chat id did not match subscription." });
          await cancelOnce();
          return;
        }
        const sequenceError = validateSseSequence(event, expectedSeq);
        expectedSeq = sequenceError.nextExpectedSeq;
        if (sequenceError.error) {
          callbacks.onError(sequenceError.error);
          await cancelOnce();
          return;
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
    signal.removeEventListener("abort", onAbort);
    if (signal.aborted) {
      await cancelOnce();
    }
    try {
      reader.releaseLock();
    } catch {}
  }
}

export function parseSseFrame(frame: string): { ok: true; data: SseEvent | null } | { ok: false; error: RuntimeError } {
  if (frame.length > maxFrameChars) {
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
    if (expectedSeq !== null) {
      return {
        nextExpectedSeq: expectedSeq,
        error: { status: "sequence", message: "SSE snapshot received after sequencing began." },
      };
    }
    if (event.seq !== 0) {
      return {
        nextExpectedSeq: null,
        error: { status: "sequence", message: `SSE snapshot must reset sequence to 0, received ${event.seq}` },
      };
    }
    return { nextExpectedSeq: 1 };
  }
  if (expectedSeq === null) {
    return {
      nextExpectedSeq: null,
      error: { status: "sequence", message: "SSE subscription must begin with a snapshot." },
    };
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

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    return;
  }
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
