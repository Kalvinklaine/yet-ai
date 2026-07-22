import { useCallback, useEffect, useRef, useState } from "react";
import { archiveProject, listProjects, restoreProject, updateProject, type ProjectSummary } from "../services/projectClient";
import { ProjectLink, type ProjectNavigation } from "../services/projectRouting";
import type { RuntimeError, RuntimeSettings } from "../services/runtimeClient";
import { ProjectRegistrationDialog } from "./ProjectRegistrationDialog";

export function ProjectHub({ settings, navigate }: { settings: RuntimeSettings; navigate: ProjectNavigation }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "refreshing" | "error">("loading");
  const [error, setError] = useState<RuntimeError | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const lastRefreshRef = useRef(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async (background = false) => {
    const request = ++requestRef.current;
    const controller = new AbortController();
    setState(background && projects.length > 0 ? "refreshing" : "loading");
    setError(null);
    const result = await listProjects(settings, controller.signal);
    if (request !== requestRef.current || controller.signal.aborted) return;
    lastRefreshRef.current = Date.now();
    if (result.ok) {
      setProjects(result.data.projects);
      setLegacyAvailable(result.data.legacyUnscopedAvailable);
      setState("ready");
      setAnnouncement(`${result.data.projects.length} project${result.data.projects.length === 1 ? "" : "s"} loaded.`);
    } else {
      setError(result.error);
      setState("error");
      setAnnouncement("Project registry unavailable.");
    }
  }, [projects.length, settings]);

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [settings]);
  useEffect(() => {
    const invalidate = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshRef.current > 60_000) void refresh(true);
    };
    window.addEventListener("focus", invalidate);
    window.addEventListener("online", invalidate);
    return () => {
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("online", invalidate);
    };
  }, [refresh]);

  const closeDialog = () => {
    setDialogOpen(false);
    addButtonRef.current?.focus();
  };

  const mutate = async (project: ProjectSummary, action: "rename" | "archive" | "restore") => {
    const request = requestRef.current;
    let result;
    if (action === "rename") {
      const displayName = window.prompt("Rename project", project.displayName)?.trim();
      if (!displayName || displayName === project.displayName) return;
      result = await updateProject(settings, project.projectId, { displayName, expectedRevision: project.revision });
    } else if (action === "archive") {
      if (!window.confirm(`Archive “${project.displayName}”? Project data will be kept and can be restored later.`)) return;
      result = await archiveProject(settings, project.projectId, project.revision);
    } else {
      result = await restoreProject(settings, project.projectId, project.revision);
    }
    if (request !== requestRef.current) return;
    if (!result.ok) {
      setError(result.error);
      setAnnouncement(`Could not ${action} project.`);
      return;
    }
    setAnnouncement(`Project ${action === "archive" ? "archived" : action === "restore" ? "restored" : "renamed"}.`);
    await refresh(true);
  };

  const active = projects.filter((project) => project.status !== "archived");
  const archived = projects.filter((project) => project.status === "archived");
  const stale = state === "error" && projects.length > 0;
  return (
    <main className="project-page-shell">
      <header className="project-product-header">
        <ProjectLink className="product-mark" route={{ kind: "projects" }} navigate={navigate} aria-label="Yet AI projects"><span aria-hidden="true">Y</span><strong>Yet AI</strong></ProjectLink>
        <ProjectLink className="project-settings-link" route={{ kind: "settings" }} navigate={navigate}>Settings</ProjectLink>
      </header>
      <section className="project-hub-hero">
        <div className="stack"><span className="badge ok">local-first workspace</span><h1>Projects</h1><p>Choose a safe local context for chat, memory, and agent work. Projects keep local activity separated without sending directory paths to the browser URL.</p></div>
        <div className="project-hub-actions"><span className={`badge ${state === "error" ? "warn" : "ok"}`}>runtime {state === "error" ? "needs attention" : "local"}</span><button ref={addButtonRef} type="button" onClick={() => setDialogOpen(true)}>Add local project</button><button type="button" className="secondary-button" onClick={() => void refresh(true)} disabled={state === "loading" || state === "refreshing"}>{state === "refreshing" ? "Refreshing…" : "Refresh"}</button></div>
      </section>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {state === "loading" && projects.length === 0 ? <ProjectHubLoading /> : null}
      {error && <div className="project-notice error" role="alert"><strong>{stale ? "Showing the last loaded project list" : "Project registry unavailable"}</strong><span>{safeRegistryMessage(error)}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
      {state !== "loading" && active.length === 0 && !legacyAvailable ? (
        <section className="project-empty-state"><div className="project-empty-orbit" aria-hidden="true">Y</div><div className="stack"><h2>Give your work a clear home</h2><p>A project establishes the local boundary for conversations, memory, and controlled work. Nothing is scanned or started until you choose it.</p><button type="button" onClick={() => setDialogOpen(true)}>Add your first project</button></div></section>
      ) : null}
      {active.length > 0 && <ProjectList title="Your projects" projects={active} onMutate={mutate} navigate={navigate} />}
      {legacyAvailable && <section className="legacy-project-entry"><div><span className="badge warn">compatibility</span><h2>Unscoped legacy data</h2><p>Older local data is kept separate from registered projects.</p></div><ProjectLink route={{ kind: "legacy" }} navigate={navigate}>Open legacy data</ProjectLink></section>}
      {archived.length > 0 && <ProjectList title="Archived projects" projects={archived} onMutate={mutate} navigate={navigate} />}
      {dialogOpen && <ProjectRegistrationDialog settings={settings} onClose={closeDialog} onRegistered={(project) => { closeDialog(); navigate({ kind: "project", projectId: project.projectId, page: "home" }); }} />}
    </main>
  );
}

function ProjectList({ title, projects, onMutate, navigate }: { title: string; projects: ProjectSummary[]; onMutate: (project: ProjectSummary, action: "rename" | "archive" | "restore") => void; navigate: ProjectNavigation }) {
  return <section className="project-list-section"><div className="project-list-heading"><h2>{title}</h2><span className="subtle">{projects.length} total</span></div><div className="project-table-wrap"><table className="project-table"><thead><tr><th scope="col">Project</th><th scope="col">Readiness</th><th scope="col">Recent activity</th><th scope="col">Last opened</th><th scope="col">Actions</th></tr></thead><tbody>{projects.map((project) => <ProjectRow key={project.projectId} project={project} onMutate={onMutate} navigate={navigate} />)}</tbody></table></div></section>;
}

function ProjectRow({ project, onMutate, navigate }: { project: ProjectSummary; onMutate: (project: ProjectSummary, action: "rename" | "archive" | "restore") => void; navigate: ProjectNavigation }) {
  const ready = project.status === "available" && project.rootAvailable;
  const label = project.status === "archived" ? "Archived" : ready ? "Ready" : "Directory unavailable";
  const projectRoute = { kind: "project", projectId: project.projectId, page: "home" } as const;
  return <tr className="project-row"><td data-label="Project"><ProjectLink className="project-name-link" route={projectRoute} navigate={navigate} aria-label={`Open project ${project.displayName}`}>{project.displayName}</ProjectLink><span className="subtle">Local project</span></td><td data-label="Readiness"><span className={`status-label ${ready ? "ready" : "blocked"}`}><span aria-hidden="true">{ready ? "●" : "!"}</span>{label}</span></td><td data-label="Recent activity">{project.lastOpenedAt ? "Previously opened" : "No activity yet"}</td><td data-label="Last opened">{formatTime(project.lastOpenedAt)}</td><td data-label="Actions"><div className="project-row-actions">{project.status !== "archived" && <ProjectLink route={projectRoute} navigate={navigate}>Open</ProjectLink>}<button type="button" className="link-button" onClick={() => onMutate(project, "rename")} aria-label={`Rename project ${project.displayName}`}>Rename</button>{project.status === "archived" ? <button type="button" className="link-button" onClick={() => onMutate(project, "restore")} aria-label={`Restore project ${project.displayName}`}>Restore</button> : <button type="button" className="link-button" onClick={() => onMutate(project, "archive")} aria-label={`Archive project ${project.displayName}`}>Archive</button>}</div></td></tr>;
}

function ProjectHubLoading() { return <section className="project-list-section" role="status"><div className="project-list-heading"><h2>Loading projects</h2></div><div className="project-loading-lines"><span /><span /><span /></div></section>; }
function formatTime(value: string | null) { if (!value) return "Never"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Recently" : date.toLocaleString(); }
function safeRegistryMessage(error: RuntimeError) { return error.status === "network" ? "The local runtime could not be reached. Your last loaded list, if any, remains visible." : "Yet AI could not safely read the local project registry. Retry after checking the local runtime."; }
