import { useMemo } from "react";
import {
  projectCommandCenterLimits,
  sanitizeMemorySelection,
  type ActiveWorkItem,
  type CommandCenterSection,
  type MemoryNoteSummaryItem,
  type ProjectCommandCenterModel,
  type ProjectReadinessItem,
  type RecentConversationItem,
} from "../services/projectCommandCenterData";

export type ProjectCommandCenterProps = {
  title: string;
  model: ProjectCommandCenterModel;
  selectedMemoryNoteIds?: readonly string[];
  onStart: () => void;
  onResume: (chatId: string) => void;
  onMemorySelectionChange: (noteIds: string[]) => void;
  onNavigateActiveWork: (runId: string) => void;
};

export function ProjectCommandCenter({
  title,
  model,
  selectedMemoryNoteIds = [],
  onStart,
  onResume,
  onMemorySelectionChange,
  onNavigateActiveWork,
}: ProjectCommandCenterProps) {
  const selectedIds = useMemo(() => sanitizeMemorySelection(selectedMemoryNoteIds), [selectedMemoryNoteIds]);
  const selected = new Set(selectedIds);
  const starting = !model.start.enabled && model.start.blockedReason === "Starting…";

  const toggleMemory = (noteId: string) => {
    const next = selected.has(noteId)
      ? selectedIds.filter((id) => id !== noteId)
      : sanitizeMemorySelection([...selectedIds, noteId]);
    onMemorySelectionChange(next);
  };

  return (
    <section className="project-command-center stack" aria-labelledby="project-command-center-title" aria-busy={starting}>
      <header className="project-command-center-heading">
        <div className="project-command-center-heading-copy"><span className="badge ok">project command center</span><h1 id="project-command-center-title">{title}</h1><p>Review project status, then choose what happens next.</p></div>
        <button type="button" onClick={onStart} disabled={!model.start.enabled} aria-describedby={!model.start.enabled ? "project-command-center-start-reason" : undefined}>{starting ? "Starting…" : "Start new chat"}</button>
      </header>
      {!model.start.enabled && <p id="project-command-center-start-reason" className="project-command-center-notice" role="status" aria-live="polite">{model.start.blockedReason ?? "Chat start is unavailable."}</p>}

      <div className="project-command-center-grid">
        <CommandCenterSection title="Readiness" section={model.readiness} emptyLabel="No readiness details are available." renderItem={(item) => <ReadinessRow item={item} />} />
        <CommandCenterSection title="Recent conversations" section={model.conversations} emptyLabel="No recent conversations." renderItem={(item) => <article><strong>{item.title}</strong><span>{item.updatedLabel}</span><button type="button" onClick={() => onResume(item.chatId)} aria-label={`Open ${item.title}`}>Open chat</button></article>} />
        <CommandCenterSection title="Memory" section={model.memory} emptyLabel="No memory notes." renderItem={(item) => {
          const checked = selected.has(item.noteId);
          const limitReached = selectedIds.length >= projectCommandCenterLimits.memorySelections && !checked;
          return <article><label className="project-command-center-memory-option"><input type="checkbox" checked={checked} disabled={limitReached} onChange={() => toggleMemory(item.noteId)} /><span>Select {item.title}</span></label><p>{item.summary}</p>{item.tags.length > 0 && <span aria-label="Memory tags">{item.tags.join(" · ")}</span>}</article>;
        }} />
        <section className="project-command-center-section" aria-labelledby="project-command-center-recorded-activity">
          <h2 id="project-command-center-recorded-activity">Recorded activity</h2>
          <p className="subtle">Sanitized entries come from explicit developer progress or bounded VS Code host actions. They do not show background autonomy or start or continue work.</p>
          <CommandCenterSectionContent section={model.activeWork} loadingLabel="Loading recorded activity…" emptyLabel="No recorded activity is available." renderItem={(item) => <article><strong>{item.cardLabel}</strong><span>{item.status === "blocked" ? "Needs attention" : "In progress"} · {item.updatedLabel}</span><button type="button" onClick={() => onNavigateActiveWork(item.runId)} aria-label={`Open ${item.cardLabel} in Agent`}>Open in Agent</button></article>} />
        </section>
      </div>
    </section>
  );
}

function CommandCenterSection<T>({ title, section, emptyLabel, renderItem }: { title: string; section: CommandCenterSection<T>; emptyLabel: string; renderItem: (item: T) => React.ReactNode }) {
  const headingId = `project-command-center-${title.toLowerCase().replace(/ /g, "-")}`;
  return <section className="project-command-center-section" aria-labelledby={headingId}><h2 id={headingId}>{title}</h2><CommandCenterSectionContent section={section} loadingLabel={`Loading ${title.toLowerCase()}…`} emptyLabel={emptyLabel} renderItem={renderItem} /></section>;
}

function CommandCenterSectionContent<T>({ section, loadingLabel, emptyLabel, renderItem }: { section: CommandCenterSection<T>; loadingLabel: string; emptyLabel: string; renderItem: (item: T) => React.ReactNode }) {
  return section.status === "loading" ? <p role="status">{loadingLabel}</p> : section.status === "error" ? <p role="alert">{section.message}</p> : section.status === "empty" ? <p>{emptyLabel}</p> : <div className="stack">{section.items.map((item, index) => <div key={itemKey(item, index)}>{renderItem(item)}</div>)}</div>;
}

function ReadinessRow({ item }: { item: ProjectReadinessItem }) {
  return <article><strong>{item.label}</strong><span>{item.status === "ready" ? "Ready" : item.status === "blocked" ? "Blocked" : "Needs attention"}</span></article>;
}

function itemKey(item: unknown, index: number): string {
  if (typeof item === "object" && item !== null) {
    for (const key of ["id", "chatId", "noteId", "runId"] as const) {
      const value = (item as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  }
  return String(index);
}

export type { ActiveWorkItem, MemoryNoteSummaryItem, RecentConversationItem };
