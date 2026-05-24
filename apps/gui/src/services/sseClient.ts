import { authHeaders, joinUrl, type RuntimeError, type RuntimeSettings } from "./runtimeClient";

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

export async function subscribeToChat(
  settings: RuntimeSettings,
  chatId: string,
  callbacks: SseCallbacks,
  signal: AbortSignal,
): Promise<void> {
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
      const parsed = drainFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        const event = parseSseFrame(frame);
        if (!event) {
          continue;
        }
        if (event.type === "snapshot") {
          expectedSeq = 1;
        } else if (expectedSeq !== null) {
          if (event.seq !== expectedSeq) {
            callbacks.onError({
              status: "parse",
              message: `SSE sequence gap: expected ${expectedSeq}, received ${event.seq}`,
            });
            expectedSeq = event.seq + 1;
          } else {
            expectedSeq += 1;
          }
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

export function parseSseFrame(frame: string): SseEvent | null {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  const parsed = JSON.parse(dataLines.join("\n")) as unknown;
  if (!isSseEvent(parsed)) {
    throw new Error("Invalid SSE event shape");
  }
  return parsed;
}

function drainFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((part) => part.trim() !== ""), rest };
}

function isSseEvent(value: unknown): value is SseEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.seq === "number" &&
    Number.isInteger(record.seq) &&
    typeof record.type === "string" &&
    typeof record.chatId === "string"
  );
}
