import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { listDirectoryDiscovery, registerProject, startDirectoryDiscovery, type DirectoryEntry, type ProjectSummary } from "../services/projectClient";
import type { RuntimeError, RuntimeSettings } from "../services/runtimeClient";

type DirectoryLevel = { entry: DirectoryEntry; entries: DirectoryEntry[] };

export function ProjectRegistrationDialog({ settings, onClose, onRegistered }: { settings: RuntimeSettings; onClose: () => void; onRegistered: (project: ProjectSummary) => void }) {
  const [sessionId, setSessionId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [levels, setLevels] = useState<DirectoryLevel[]>([]);
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [state, setState] = useState<"starting" | "ready" | "loading" | "registering" | "error">("starting");
  const [error, setError] = useState<RuntimeError | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const registeringRef = useRef(false);

  const invalidate = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const beginAttempt = useCallback(() => {
    invalidate();
    const controller = new AbortController();
    controllerRef.current = controller;
    return { generation: generationRef.current, controller };
  }, [invalidate]);

  const isCurrent = useCallback((generation: number, controller: AbortController) => generation === generationRef.current && controllerRef.current === controller && !controller.signal.aborted, []);

  const begin = useCallback(async () => {
    registeringRef.current = false;
    const { generation, controller } = beginAttempt();
    setState("starting");
    setError(null);
    setLevels([]);
    setSelected(null);
    const result = await startDirectoryDiscovery(settings, controller.signal);
    if (!isCurrent(generation, controller)) return;
    if (!result.ok) {
      setState("error");
      setError(result.error);
      return;
    }
    const listing = await listDirectoryDiscovery(settings, result.data.sessionId, result.data.root.handle, controller.signal);
    if (!isCurrent(generation, controller)) return;
    if (!listing.ok) {
      setState("error");
      setError(listing.error);
      return;
    }
    setSessionId(result.data.sessionId);
    setExpiresAt(listing.data.expiresAt);
    setLevels([{ entry: result.data.root, entries: listing.data.entries }]);
    setSelected(result.data.root.selectable ? result.data.root : null);
    setDisplayName(result.data.root.displayName);
    setState("ready");
  }, [beginAttempt, isCurrent, settings]);

  useEffect(() => {
    void begin();
    return invalidate;
  }, [begin, invalidate]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]") ?? []);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  function handleClose() {
    invalidate();
    onClose();
  }

  const openDirectory = async (entry: DirectoryEntry) => {
    const { generation, controller } = beginAttempt();
    setState("loading");
    setError(null);
    const result = await listDirectoryDiscovery(settings, sessionId, entry.handle, controller.signal);
    if (!isCurrent(generation, controller)) return;
    if (!result.ok) {
      setState("error");
      setError(result.error);
      return;
    }
    setLevels((current) => [...current, { entry, entries: result.data.entries }]);
    setSelected(entry.selectable ? entry : null);
    setDisplayName(entry.displayName);
    setExpiresAt(result.data.expiresAt);
    setState("ready");
  };

  const returnToLevel = (index: number) => {
    registeringRef.current = false;
    invalidate();
    setLevels((current) => current.slice(0, index + 1));
    const entry = levels[index].entry;
    setSelected(entry.selectable ? entry : null);
    setDisplayName(entry.displayName);
    setError(null);
    setState("ready");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !displayName.trim() || registeringRef.current) return;
    registeringRef.current = true;
    const { generation, controller } = beginAttempt();
    setState("registering");
    setError(null);
    const result = await registerProject(settings, { displayName: displayName.trim(), directorySessionId: sessionId, directoryHandle: selected.handle }, controller.signal);
    if (!isCurrent(generation, controller)) return;
    if (!result.ok) {
      registeringRef.current = false;
      setState("error");
      setError(result.error);
      return;
    }
    invalidate();
    onRegistered(result.data);
  };

  const current = levels[levels.length - 1];
  const expired = error?.message.toLowerCase().includes("expired") || error?.status === 410;
  return (
    <div className="project-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <section ref={dialogRef} className="project-dialog stack" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
        <div className="project-dialog-header row">
          <div className="stack">
            <span className="badge ok">local directory</span>
            <h2 id="add-project-title">Add local project</h2>
          </div>
          <button ref={closeRef} type="button" className="secondary-button" onClick={handleClose} aria-label="Close Add local project dialog">Close</button>
        </div>
        <p className="subtle">Choose one directory through the local runtime. Yet AI receives opaque navigation handles; no path is placed in the URL or saved by this page.</p>
        {levels.length > 0 && (
          <nav className="directory-breadcrumbs" aria-label="Selected directory hierarchy">
            {levels.map((level, index) => <button key={level.entry.handle} type="button" className="link-button" onClick={() => returnToLevel(index)} aria-current={index === levels.length - 1 ? "location" : undefined}>{level.entry.displayName}</button>)}
          </nav>
        )}
        <div className="directory-browser" aria-busy={state === "starting" || state === "loading"}>
          {state === "starting" ? <p role="status">Starting a private discovery session…</p> : current && current.entries.length > 0 ? (
            <ul className="directory-list" aria-label="Child directories">
              {current.entries.map((entry) => <li key={entry.handle}><button type="button" className="directory-entry" onClick={() => void openDirectory(entry)} disabled={state !== "ready"}><span aria-hidden="true">▰</span><span>{entry.displayName}</span><span className="subtle">Open</span></button></li>)}
            </ul>
          ) : state !== "error" ? <p role="status">No child directories are available here. You may select this directory if allowed.</p> : null}
        </div>
        {error && <div className="error" role="alert"><strong>{expired ? "Discovery session expired" : "Directory unavailable"}</strong><span>{safeDiscoveryMessage(error)}</span><button type="button" onClick={() => void begin()}>{expired ? "Start a new session" : "Retry discovery"}</button></div>}
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <label>Project display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} autoComplete="off" /></label>
          <span className="subtle">Selected: {selected ? selected.displayName : "Choose a selectable directory"}. Session expires {expiresAt ? new Date(expiresAt).toLocaleTimeString() : "soon"}.</span>
          <div className="row">
            <button type="submit" disabled={!selected || !displayName.trim() || state !== "ready"}>{state === "registering" ? "Adding project…" : "Add project"}</button>
            <button type="button" className="secondary-button" onClick={handleClose}>Cancel</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function safeDiscoveryMessage(error: RuntimeError): string {
  const message = error.message.toLowerCase();
  if (message.includes("expired") || error.status === 410) return "Start a fresh session and choose the directory again.";
  if (message.includes("outside") || message.includes("escape")) return "That selection is outside the allowed local directory area. Choose another directory.";
  if (message.includes("permission") || message.includes("unsafe")) return "The local runtime cannot safely access that directory. Choose another directory or adjust local permissions.";
  if (message.includes("missing") || error.status === 404) return "That directory is no longer available. Return to a parent directory and choose again.";
  return "Directory discovery is unavailable. Retry when the local runtime is ready.";
}
