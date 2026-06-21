import { describe, expect, it, vi } from "vitest";
import {
  appendCodingSessionTraceEntry,
  type CodingSessionTraceEntry,
  createCodingSessionTraceEntry,
  normalizeTraceFamily,
  normalizeTraceStatus,
  sanitizeTraceDetails,
} from "./codingSessionTrace";

const fixedDate = new Date("2026-06-21T12:00:00.000Z");

function fixedOptions() {
  return { id: "trace-1", timestamp: fixedDate };
}

describe("codingSessionTrace", () => {
  it("creates sanitized trace entries for the S39 event families", () => {
    const entry = createCodingSessionTraceEntry({
      family: "verification.result",
      title: "Verification finished",
      status: "succeeded",
      summary: "Command gui-app-tests finished",
      requestId: "request-1",
      details: {
        commandId: "gui-app-tests",
        exitCode: 0,
        truncated: false,
      },
    }, fixedOptions());

    expect(entry).toEqual({
      id: "trace-1",
      timestamp: "2026-06-21T12:00:00.000Z",
      family: "verification.result",
      title: "Verification finished",
      status: "succeeded",
      summary: "Command gui-app-tests finished",
      requestId: "request-1",
      details: {
        commandId: "gui-app-tests",
        exitCode: 0,
        truncated: false,
      },
    });
  });

  it("normalizes unsafe family and status values at the helper boundary", () => {
    const entry = createCodingSessionTraceEntry({
      family: "tool.shell.execute",
      title: "Unsafe family",
      status: "rooted",
    }, fixedOptions());

    expect(entry.family).toBe("runtime.refresh");
    expect(entry.status).toBe("info");
    expect(normalizeTraceFamily("chat.streamDelta")).toBe("chat.streamDelta");
    expect(normalizeTraceFamily("chat.rawProviderResponse")).toBe("runtime.refresh");
    expect(normalizeTraceStatus("failed")).toBe("failed");
    expect(normalizeTraceStatus("leaked")).toBe("info");
  });

  it("redacts secrets and private paths in all text fields", () => {
    const entry = createCodingSessionTraceEntry({
      family: "host.runtimeStatus",
      title: "Authorization: Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /Users/alice/project/file.ts",
      status: "failed",
      summary: "OPENAI_API_KEY=sk-test-secret123456 Cookie: session=secret /home/alice/work raw prompt: PROMPT_SENTINEL",
      requestId: "request-with-token-marker",
      details: {
        outputTail: "api_key=short-secret /Users/alice/private.txt sk-secret123456789",
      },
    }, fixedOptions());
    const rendered = JSON.stringify(entry);

    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(rendered).not.toContain("sk-test-secret123456");
    expect(rendered).not.toContain("session=secret");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("/home/alice");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(entry.requestId).toBeUndefined();
  });

  it("bounds title summary details and oldest trace entries", () => {
    const longTitle = "title ".repeat(40);
    const longSummary = "summary ".repeat(200);
    let trace: CodingSessionTraceEntry[] = [];
    for (let index = 0; index < 4; index += 1) {
      trace = appendCodingSessionTraceEntry(trace, {
        family: "chat.streamDelta",
        title: index === 3 ? longTitle : `Event ${index}`,
        status: "in_progress",
        summary: index === 3 ? longSummary : undefined,
        details: { tail: "tail ".repeat(200) },
      }, { id: `trace-${index}`, timestamp: fixedDate, maxEntries: 3 });
    }

    expect(trace).toHaveLength(3);
    expect(trace.map((entry) => entry.id)).toEqual(["trace-1", "trace-2", "trace-3"]);
    expect(trace[2].title).toHaveLength(121);
    expect(trace[2].title.endsWith("…")).toBe(true);
    expect(trace[2].summary).toHaveLength(1001);
    expect(trace[2].summary?.endsWith("…")).toBe(true);
    expect(String(trace[2].details?.tail).length).toBeLessThanOrEqual(501);
  });

  it("sanitizes structured details without raw object dumps", () => {
    const cyclic: Record<string, unknown> = {
      safe: "visible",
      accessToken: "SECRET_TOKEN_SENTINEL",
      rawPrompt: { body: "PROMPT_SENTINEL" },
      nested: { provider_response: "PROVIDER_SENTINEL", count: 2 },
      values: Array.from({ length: 25 }, (_, index) => `item-${index}`),
    };
    cyclic.self = cyclic;

    const details = sanitizeTraceDetails(cyclic);
    const rendered = JSON.stringify(details);

    expect(rendered).toContain("visible");
    expect(rendered).toContain("[redacted]");
    expect(rendered).toContain("5 more items redacted");
    expect(rendered).not.toContain("SECRET_TOKEN_SENTINEL");
    expect(rendered).not.toContain("PROMPT_SENTINEL");
    expect(rendered).not.toContain("PROVIDER_SENTINEL");
  });

  it("does not retain non-object details or raw function and symbol values", () => {
    expect(sanitizeTraceDetails("raw string detail")).toBeUndefined();
    const details = sanitizeTraceDetails({ fn: () => "raw", sym: Symbol("raw"), ok: true });

    expect(details).toEqual({ fn: "[redacted]", sym: "[redacted]", ok: true });
  });

  it("uses bounded generated identifiers without persisting state", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const entry = createCodingSessionTraceEntry({
      family: "gui.ready",
      title: "GUI ready",
      status: "info",
    }, { now: () => fixedDate });

    expect(entry.id).toMatch(/^trace-/);
    expect(entry.timestamp).toBe("2026-06-21T12:00:00.000Z");
    expect(localStorage.length).toBe(0);
  });
});
