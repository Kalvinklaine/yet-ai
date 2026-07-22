import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getProject, type ProjectSummary } from "../services/projectClient";
import { ProjectLink, type AppRoute, type ProjectNavigation } from "../services/projectRouting";
import type { RuntimeError, RuntimeSettings } from "../services/runtimeClient";
import { ProjectHome } from "./ProjectHome";

export function ProjectShell({ route, settings, navigate, children }: { route: Extract<AppRoute, { kind: "project" }>; settings: RuntimeSettings; navigate: ProjectNavigation; children?: ReactNode }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const result = await getProject(settings, route.projectId, controller.signal);
    if (request !== requestRef.current) return;
    if (result.ok) setProject(result.data); else setError(result.error);
    setLoading(false);
    return controller;
  }, [route.projectId, settings]);
  useEffect(() => {
    const request = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getProject(settings, route.projectId, controller.signal).then((result) => {
      if (request !== requestRef.current || controller.signal.aborted) return;
      if (result.ok) setProject(result.data); else setError(result.error);
      setLoading(false);
    });
    return () => controller.abort();
  }, [route.projectId, settings]);

  if (loading) return <main className="project-page-shell"><section className="project-blocked-state" role="status"><h1>Loading project…</h1><p>Checking the local project boundary.</p></section></main>;
  if (error || !project) return <ProjectBlockedState title="Project unavailable" detail={error?.status === 404 ? "This project could not be found." : "Yet AI could not safely load this project."} navigate={navigate} onRetry={() => void load()} />;
  if (project.status === "archived") return <ProjectBlockedState title="Project archived" detail="Restore this project from the Projects page before opening its local data." navigate={navigate} />;
  if (project.status === "missing" || !project.rootAvailable) return <ProjectBlockedState title="Project directory unavailable" detail="The registered directory is missing, moved, inaccessible, or no longer matches this project. No replacement was guessed." navigate={navigate} />;

  const nav: Array<{ page: "home" | "chat" | "memory" | "agent"; label: string }> = [{ page: "home", label: "Home" }, { page: "chat", label: "Chat" }, { page: "memory", label: "Memory" }, { page: "agent", label: "Agent" }];
  return (
    <main className="project-page-shell">
      <header className="project-shell-header">
        <div className="project-shell-boundary"><ProjectLink route={{ kind: "projects" }} navigate={navigate}>← Projects</ProjectLink><span className="project-boundary-divider" aria-hidden="true" /><div><span className="subtle">Current project</span><strong>{project.displayName}</strong></div></div>
        <div className="row"><span className="status-label ready"><span aria-hidden="true">●</span>Ready</span><ProjectLink className="project-settings-link" route={{ kind: "settings" }} navigate={navigate}>Settings</ProjectLink></div>
      </header>
      <nav className="project-shell-nav" aria-label={`${project.displayName} navigation`}>{nav.map((item) => <ProjectLink key={item.page} route={{ kind: "project", projectId: project.projectId, page: item.page }} navigate={navigate} aria-current={route.page === item.page ? "page" : undefined}>{item.label}</ProjectLink>)}</nav>
      {route.page === "home" ? <ProjectHome project={project} navigate={navigate} /> : children}
    </main>
  );
}

function ProjectBlockedState({ title, detail, navigate, onRetry }: { title: string; detail: string; navigate: ProjectNavigation; onRetry?: () => void }) {
  return <main className="project-page-shell"><section className="project-blocked-state" role="alert"><div className="project-empty-orbit" aria-hidden="true">!</div><h1>{title}</h1><p>{detail}</p><div className="row"><ProjectLink route={{ kind: "projects" }} navigate={navigate}>Back to Projects</ProjectLink>{onRetry && <button type="button" className="secondary-button" onClick={onRetry}>Retry</button>}</div></section></main>;
}
