import type { ProjectMemoryNote } from "./projectMemoryClient";
import type { AgentProgressSnapshot, ChatSummary } from "./runtimeClient";

export const projectCommandCenterLimits = {
  recentChats: 5,
  memoryNotes: 6,
  activeWork: 5,
  memorySelections: 3,
} as const;

export type CommandCenterSection<T> =
  | { status: "loading" }
  | { status: "ready"; items: T[] }
  | { status: "empty" }
  | { status: "error"; message: string };

export type ProjectReadinessItem = {
  id: "project" | "runtime" | "provider";
  label: string;
  status: "ready" | "blocked" | "attention";
};

export type RecentConversationItem = {
  chatId: string;
  title: string;
  updatedLabel: string;
};

export type MemoryNoteSummaryItem = {
  noteId: string;
  title: string;
  tags: string[];
  summary: string;
};

export type ActiveWorkItem = {
  runId: string;
  cardLabel: string;
  status: "active" | "blocked";
  updatedLabel: string;
};

export type ProjectCommandCenterModel = {
  readiness: CommandCenterSection<ProjectReadinessItem>;
  conversations: CommandCenterSection<RecentConversationItem>;
  memory: CommandCenterSection<MemoryNoteSummaryItem>;
  activeWork: CommandCenterSection<ActiveWorkItem>;
  start: { enabled: boolean; blockedReason?: string };
};

export type MemorySummaryInput = Pick<ProjectMemoryNote, "id" | "title" | "tags" | "updatedAt"> & {
  summary?: string;
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const unsafeTextPattern = /(?:[A-Za-z]:\\|(?:^|\s)[~/]|\.{2}\/|\\\\|https?:\/\/|(?:api[_ -]?key|authorization|bearer|token|secret|password)\s*[:=])/i;

export function shapeReadiness(items: Array<{ id: ProjectReadinessItem["id"]; label: unknown; status: ProjectReadinessItem["status"] }>): CommandCenterSection<ProjectReadinessItem> {
  const safeItems = items.flatMap((item) => {
    const label = safeLabel(item.label, readinessFallback(item.id), 64);
    return [{ id: item.id, label, status: item.status }];
  }).slice(0, 3);
  return sectionFromItems(safeItems);
}

export function shapeRecentConversations(chats: readonly ChatSummary[]): CommandCenterSection<RecentConversationItem> {
  const items = chats
    .filter((chat) => safeIdPattern.test(chat.chatId))
    .map((chat) => ({ chat, timestamp: validTimestamp(chat.updatedAt) }))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, projectCommandCenterLimits.recentChats)
    .map(({ chat, timestamp }) => ({
      chatId: chat.chatId,
      title: safeLabel(chat.title, "Untitled conversation", 72),
      updatedLabel: timestamp ? new Date(timestamp).toISOString() : "Recently updated",
    }));
  return sectionFromItems(items);
}

export function shapeMemorySummaries(notes: readonly MemorySummaryInput[]): CommandCenterSection<MemoryNoteSummaryItem> {
  const items = notes
    .filter((note) => safeIdPattern.test(note.id))
    .map((note) => ({ note, timestamp: validTimestamp(note.updatedAt) }))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, projectCommandCenterLimits.memoryNotes)
    .map(({ note }) => ({
      noteId: note.id,
      title: safeLabel(note.title, "Memory note", 72),
      tags: note.tags.map((tag) => safeLabel(tag, "", 24)).filter(Boolean).slice(0, 4),
      summary: safeLabel(note.summary, "Saved project context", 120),
    }));
  return sectionFromItems(items);
}

export function shapeActiveWork(snapshots: readonly AgentProgressSnapshot[]): CommandCenterSection<ActiveWorkItem> {
  const items = snapshots
    .filter((snapshot) => snapshot.status !== "done" && safeIdPattern.test(snapshot.runId))
    .map((snapshot) => ({ snapshot, timestamp: validTimestamp(snapshot.updatedAt) }))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, projectCommandCenterLimits.activeWork)
    .map(({ snapshot, timestamp }) => ({
      runId: snapshot.runId,
      cardLabel: safeLabel(snapshot.cardId, "Project work", 64),
      status: isBlockedProgress(snapshot.status) ? "blocked" as const : "active" as const,
      updatedLabel: timestamp ? new Date(timestamp).toISOString() : "Recently updated",
    }));
  return sectionFromItems(items);
}

export function loadingSection<T>(): CommandCenterSection<T> {
  return { status: "loading" };
}

export function errorSection<T>(message: unknown): CommandCenterSection<T> {
  return { status: "error", message: safeLabel(message, "This section could not be loaded.", 120) };
}

export function sanitizeMemorySelection(noteIds: readonly string[]): string[] {
  return Array.from(new Set(noteIds.filter((id) => safeIdPattern.test(id)))).slice(0, projectCommandCenterLimits.memorySelections);
}

function sectionFromItems<T>(items: T[]): CommandCenterSection<T> {
  return items.length === 0 ? { status: "empty" } : { status: "ready", items };
}

function safeLabel(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || unsafeTextPattern.test(normalized)) return fallback;
  return normalized.slice(0, maxLength);
}

function validTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function readinessFallback(id: ProjectReadinessItem["id"]): string {
  return id === "project" ? "Project status unavailable" : id === "runtime" ? "Runtime status unavailable" : "Provider status unavailable";
}

function isBlockedProgress(status: AgentProgressSnapshot["status"]): boolean {
  return status === "stalled" || status === "stuck" || status === "failed";
}
