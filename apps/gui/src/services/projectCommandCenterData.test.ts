import { describe, expect, it } from "vitest";
import {
  errorSection,
  projectCommandCenterLimits,
  sanitizeMemorySelection,
  shapeActiveWork,
  shapeMemorySummaries,
  shapeReadiness,
  shapeRecentConversations,
} from "./projectCommandCenterData";
import type { AgentProgressSnapshot, ChatSummary } from "./runtimeClient";

describe("projectCommandCenterData", () => {
  it("sorts and bounds recent conversations while replacing unsafe labels", () => {
    const chats = Array.from({ length: 8 }, (_, index) => chat(`chat-${index}`, index === 7 ? "/Users/private/secret" : `Conversation ${index}`, `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`));
    const result = shapeRecentConversations(chats);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.items).toHaveLength(projectCommandCenterLimits.recentChats);
    expect(result.items[0]).toMatchObject({ chatId: "chat-7", title: "Untitled conversation" });
    expect(result.items.map((item) => item.chatId)).toEqual(["chat-7", "chat-6", "chat-5", "chat-4", "chat-3"]);
  });

  it("creates bounded memory summaries without accepting note bodies or unsafe metadata", () => {
    const result = shapeMemorySummaries(Array.from({ length: 8 }, (_, index) => ({
      id: `note-${index}`,
      title: index === 7 ? "token=private-value" : `Decision ${index}`,
      tags: ["architecture", "/private/root", "authorization: bearer abc", "safe"],
      summary: index === 7 ? "https://private.example/payload" : `Summary ${index}`,
      updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
      text: "NOTE BODY MUST NEVER APPEAR",
    })));

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.items).toHaveLength(projectCommandCenterLimits.memoryNotes);
    expect(result.items[0]).toEqual({ noteId: "note-7", title: "Memory note", tags: ["architecture", "safe"], summary: "Saved project context" });
    expect(JSON.stringify(result)).not.toContain("NOTE BODY");
  });

  it("shapes non-terminal recorded progress without carrying execution payloads", () => {
    const result = shapeActiveWork([
      progress("run-done", "done", "2026-07-28T10:00:00Z"),
      progress("run-active", "running", "2026-07-28T11:00:00Z"),
      progress("run-blocked", "stuck", "2026-07-28T12:00:00Z"),
    ]);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.items.map(({ runId, status }) => ({ runId, status }))).toEqual([
      { runId: "run-blocked", status: "blocked" },
      { runId: "run-active", status: "active" },
    ]);
    expect(JSON.stringify(result)).not.toContain("raw progress payload");
  });

  it("sanitizes errors, malformed ids, and bounded unique selections", () => {
    expect(errorSection("/Users/me/private/root")).toEqual({ status: "error", message: "This section could not be loaded." });
    expect(sanitizeMemorySelection(["note-1", "../unsafe", "note-1", "note-2", "note-3", "note-4"])).toEqual(["note-1", "note-2", "note-3"]);
    expect(shapeRecentConversations([chat("../bad", "Bad", "invalid")])).toEqual({ status: "empty" });
  });

  it("fails closed for shared redaction patterns across displayed fields", () => {
    const jwt = `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}`;
    const opaque = "z".repeat(64);
    const conversations = shapeRecentConversations([
      chat("chat-sk", `Release sk-secret123456789 tail`, "2026-07-28T10:00:00Z"),
      chat("chat-jwt", `Session ${jwt} tail`, "2026-07-28T09:00:00Z"),
    ]);
    const memory = shapeMemorySummaries([
      {
        id: "note-secret",
        title: `Token ${opaque} tail`,
        tags: ["safe", "Bearer bearer-secret-value", "auth.json", "raw output: PRIVATE_BODY"],
        summary: "provider response: RAW_PROVIDER_BODY",
        updatedAt: "2026-07-28T10:00:00Z",
      },
    ]);
    const readiness = shapeReadiness([
      { id: "project", label: "/Users/alice/workspace", status: "blocked" },
      { id: "runtime", label: "Runtime ready", status: "ready" },
      { id: "provider", label: "https://private.example/status", status: "attention" },
    ]);
    const activeWork = shapeActiveWork([
      progress("run-secret", "running", "2026-07-28T10:00:00Z", "Bearer work-secret-value"),
    ]);

    expect(conversations).toMatchObject({ status: "ready", items: [
      { title: "Untitled conversation" },
      { title: "Untitled conversation" },
    ] });
    expect(memory).toEqual({ status: "ready", items: [{
      noteId: "note-secret",
      title: "Memory note",
      tags: ["safe"],
      summary: "Saved project context",
    }] });
    expect(readiness).toMatchObject({ status: "ready", items: [
      { label: "Project status unavailable" },
      { label: "Runtime ready" },
      { label: "Provider status unavailable" },
    ] });
    expect(activeWork).toMatchObject({ status: "ready", items: [{ cardLabel: "Project work" }] });

    const shaped = JSON.stringify({ conversations, memory, readiness, activeWork });
    for (const fragment of ["secret123456789", jwt, opaque, "bearer-secret-value", "auth.json", "PRIVATE_BODY", "RAW_PROVIDER_BODY", "/Users/alice", "private.example", "work-secret-value", "[redacted]"]) {
      expect(shaped).not.toContain(fragment);
    }
  });

  it("fails closed for redacted errors while preserving safe bounded labels", () => {
    expect(errorSection("Request failed Authorization: Bearer hidden-secret-value")).toEqual({
      status: "error",
      message: "This section could not be loaded.",
    });
    expect(errorSection("raw prompt: PRIVATE_PROMPT_BODY")).toEqual({
      status: "error",
      message: "This section could not be loaded.",
    });

    const safeTitle = "Ordinary project discussion ".repeat(4);
    const conversations = shapeRecentConversations([chat("chat-safe", safeTitle, "2026-07-28T10:00:00Z")]);
    expect(conversations).toEqual({ status: "ready", items: [{
      chatId: "chat-safe",
      title: safeTitle.slice(0, 72),
      updatedLabel: "2026-07-28T10:00:00.000Z",
    }] });
    expect(errorSection("Temporary runtime hiccup")).toEqual({ status: "error", message: "Temporary runtime hiccup" });
  });
});

function chat(chatId: string, title: string, updatedAt: string): ChatSummary {
  return { chatId, title, updatedAt, createdAt: updatedAt, messageCount: 1 };
}

function progress(runId: string, status: AgentProgressSnapshot["status"], updatedAt: string, cardId = "S142"): AgentProgressSnapshot {
  return {
    protocolVersion: "2026-05-29", runId, cardId, startedAt: updatedAt, updatedAt,
    phase: status === "done" ? "done" : "editing", status, message: "raw progress payload",
    elapsedMs: 1, ageMs: 1, outputTail: "secret output", recentEvents: [],
  };
}
