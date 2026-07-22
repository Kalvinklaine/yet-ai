import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { deleteProjectMemory, listProjectMemory, type ProjectMemoryNote } from "../services/projectMemoryClient";
import { deleteChat, getAgentProgress, listChats, type AgentProgressSnapshot, type ChatSummary, type RuntimeError, type RuntimeSettings } from "../services/runtimeClient";
import { ProjectLink, type ProjectNavigation } from "../services/projectRouting";
import { sanitizeDisplayText } from "../services/redaction";

type LegacyState = {
  chats: ChatSummary[];
  notes: ProjectMemoryNote[];
  runs: AgentProgressSnapshot[];
  loading: boolean;
  error: RuntimeError | null;
};

const emptyState: LegacyState = { chats: [], notes: [], runs: [], loading: true, error: null };

export function LegacyData({ settings, navigate }: { settings: RuntimeSettings; navigate: ProjectNavigation }) {
  const [state, setState] = useState<LegacyState>(emptyState);
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    const [chats, notes, runs] = await Promise.all([listChats(settings), listProjectMemory(settings), getAgentProgress(settings)]);
    if (request !== requestRef.current) return;
    const error = !chats.ok ? chats.error : !notes.ok ? notes.error : !runs.ok ? runs.error : null;
    setState({
      chats: chats.ok ? chats.data.chats : [],
      notes: notes.ok ? notes.data.notes : [],
      runs: runs.ok ? runs.data.snapshots : [],
      loading: false,
      error,
    });
  }, [settings]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const removeChat = async (chat: ChatSummary) => {
    const result = await deleteChat(settings, chat.chatId);
    if (result.ok) setState((current) => ({ ...current, chats: current.chats.filter((item) => item.chatId !== chat.chatId) }));
    else setState((current) => ({ ...current, error: result.error }));
  };
  const removeNote = async (note: ProjectMemoryNote) => {
    const result = await deleteProjectMemory(settings, note.id);
    if (result.ok) setState((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== note.id) }));
    else setState((current) => ({ ...current, error: result.error }));
  };

  return (
    <main className="app-shell" data-testid="legacy-data">
      <section className="hero"><div><span className="badge warn">unscoped compatibility data</span><h1>Legacy data</h1><p className="subtle">Ownerless data from before project isolation. It is not attached to any project.</p></div><ProjectLink route={{ kind: "projects" }} navigate={navigate}>Back to Projects</ProjectLink></section>
      <section className="readiness-card warn" role="status"><strong>Read and delete only</strong><span>No project attachment, project agent execution, automatic import, move, or inferred ownership is available here.</span></section>
      {state.loading && <section className="card" role="status">Loading unscoped legacy data…</section>}
      {state.error && <section className="card" role="alert">Legacy data unavailable: {state.error.status} {sanitizeDisplayText(state.error.message)}</section>}
      {!state.loading && <>
        <LegacySection title="Legacy chats" empty="No unscoped chats.">{state.chats.map((chat) => <LegacyRow key={chat.chatId} label={chat.title || "Untitled chat"} onDelete={() => void removeChat(chat)} />)}</LegacySection>
        <LegacySection title="Legacy memory" empty="No unscoped memory notes.">{state.notes.map((note) => <LegacyRow key={note.id} label={note.title || "Untitled memory note"} onDelete={() => void removeNote(note)} />)}</LegacySection>
        <LegacySection title="Legacy agent progress" empty="No unscoped progress records.">{state.runs.map((run) => <div className="provider-item stack" key={run.runId}><strong>{sanitizeDisplayText(run.message)}</strong><span className="subtle">{sanitizeDisplayText(run.status)}</span></div>)}</LegacySection>
      </>}
    </main>
  );
}

function LegacySection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return <section className="card stack"><h2>{title}</h2>{items.length === 0 ? <span className="subtle">{empty}</span> : children}</section>;
}

function LegacyRow({ label, onDelete }: { label: string; onDelete: () => void }) {
  return <div className="provider-item row"><strong>{sanitizeDisplayText(label)}</strong><button type="button" className="danger-button" onClick={onDelete}>Delete</button></div>;
}
