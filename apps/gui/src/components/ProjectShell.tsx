import { useEffect, useState, type ReactNode } from "react";
import { getProject, type ProjectSummary } from "../services/projectClient";
import { buildProjectRoute, type AppRoute } from "../services/projectRouting";
import type { RuntimeError, RuntimeSettings } from "../services/runtimeClient";
import { ProjectHome } from "./ProjectHome";

export function ProjectShell({ route, settings, children }: { route: Extract<AppRoute, { kind: "project" }>; settings: RuntimeSettings; children?: ReactNode }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await getProject(settings, route.projectId);
    if (result.ok) setProject(result.data); else setError(result.error);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [route.projectId, settings]);

  if (loading) return <main className="project-page-shell"><section className="project-blocked-state" role="status"><h1>Loading project…</h1><p>Checking the local project boundary.</p></section></main>;
  if (error || !project) return <ProjectBlockedState title="Project unavailable" detail={error?.status === 404 ? "This project could not be found." : "Yet AI could not safely load this project."} onRetry={() => void load()} />;
  if (project.status === "archived") return <ProjectBlockedState title="Project archived" detail="Restore this project from the Projects page before opening its local data." />;
  if (project.status === "missing" || !project.rootAvailable) return <ProjectBlockedState title="Project directory unavailable" detail="The registered directory is missing, moved, inaccessible, or no longer matches this project. No replacement was guessed." />;

  const nav: Array<{ page: "home" | "chat" | "memory" | "agent"; label: string }> = [{ page: "home", label: "Home" }, { page: "chat", label: "Chat" }, { page: "memory", label: "Memory" }, { page: "agent", label: "Agent" }];
  return (
    <main className="project-page-shell">
      <header className="project-shell-header">
        <div className="project-shell-boundary"><a href={buildProjectRoute({ kind: "projects" })}>← Projects</a><span className="project-boundary-divider" aria-hidden="true" /><div><span className="subtle">Current project</span><strong>{project.displayName}</strong></div></div>
        <div className="row"><span className="status-label ready"><span aria-hidden="true">●</span>Ready</span><a className="project-settings-link" href={buildProjectRoute({ kind: "settings" })}>Settings</a></div>
      </header>
      <nav className="project-shell-nav" aria-label={`${project.displayName} navigation`}>{nav.map((item) => <a key={item.page} href={buildProjectRoute({ kind: "project", projectId: project.projectId, page: item.page })} aria-current={route.page === item.page ? "page" : undefined}>{item.label}</a>)}</nav>
      {route.page === "home" ? <ProjectHome project={project} /> : children}
    </main>
  );
}

function ProjectBlockedState({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return <main className="project-page-shell"><section className="project-blocked-state" role="alert"><div className="project-empty-orbit" aria-hidden="true">!</div><h1>{title}</h1><p>{detail}</p><div className="row"><a href={buildProjectRoute({ kind: "projects" })}>Back to Projects</a>{onRetry && <button type="button" className="secondary-button" onClick={onRetry}>Retry</button>}</div></section></main>;
}
