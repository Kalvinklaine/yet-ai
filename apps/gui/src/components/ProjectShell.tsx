import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createProjectRuntimeSettings, getProject, type ProjectSummary } from "../services/projectClient";
import { listProjectMemory } from "../services/projectMemoryClient";
import {
  errorSection,
  loadingSection,
  shapeActiveWork,
  shapeMemorySummaries,
  shapeReadiness,
  shapeRecentConversations,
  type ProjectCommandCenterModel,
} from "../services/projectCommandCenterData";
import { ProjectLink, type AppRoute, type ProjectNavigation } from "../services/projectRouting";
import { listProviders } from "../services/providersClient";
import { countReadyProviderModels } from "../services/providerReadiness";
import { getAgentProgress, getModels, getPing, listChats, type RuntimeError, type RuntimeSettings } from "../services/runtimeClient";
import { ProjectHome } from "./ProjectHome";

export function ProjectShell({ route, settings, navigate, children }: { route: Extract<AppRoute, { kind: "project" }>; settings: RuntimeSettings; navigate: ProjectNavigation; children?: ReactNode }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [loading, setLoading] = useState(true);
  const [commandCenter, setCommandCenter] = useState<ProjectCommandCenterModel | null>(null);
  const projectRequestRef = useRef(0);
  const commandCenterRequestRef = useRef(0);
  const load = useCallback(async () => {
    const request = ++projectRequestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const result = await getProject(settings, route.projectId, controller.signal);
    if (request !== projectRequestRef.current) return;
    if (result.ok) setProject(result.data); else setError(result.error);
    setLoading(false);
    return controller;
  }, [route.projectId, settings]);
  useEffect(() => {
    const request = ++projectRequestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getProject(settings, route.projectId, controller.signal).then((result) => {
      if (request !== projectRequestRef.current || controller.signal.aborted) return;
      if (result.ok) setProject(result.data); else setError(result.error);
      setLoading(false);
    });
    return () => controller.abort();
  }, [route.projectId, settings]);

  useEffect(() => {
    if (route.page !== "home" || !project || project.projectId !== route.projectId || project.status !== "available" || !project.rootAvailable) {
      setCommandCenter(null);
      return;
    }
    const request = ++commandCenterRequestRef.current;
    const controller = new AbortController();
    const projectSettings = createProjectRuntimeSettings(settings, project.projectId, { generation: request, abortSignal: controller.signal });
    setCommandCenter({
      readiness: loadingSection(),
      conversations: loadingSection(),
      memory: loadingSection(),
      activeWork: loadingSection(),
      start: { enabled: false, blockedReason: "Checking project, runtime, and provider readiness…" },
    });
    const update = (patch: Partial<ProjectCommandCenterModel>) => {
      if (request !== commandCenterRequestRef.current || controller.signal.aborted) return;
      setCommandCenter((current) => current ? { ...current, ...patch } : current);
    };
    void Promise.all([getPing(settings, controller.signal), getModels(settings, controller.signal), listProviders(settings, controller.signal)]).then(([ping, models, providers]) => {
      const runtimeReady = ping.ok && ping.data.ready;
      const readyPairings = models.ok && providers.ok ? countReadyProviderModels(models.data.models, providers.data.providers) : 0;
      update({
        readiness: shapeReadiness([
          { id: "project", label: "Local project context", status: "ready" },
          { id: "runtime", label: runtimeReady ? "Local runtime" : "Runtime status unavailable", status: runtimeReady ? "ready" : "blocked" },
          { id: "provider", label: readyPairings > 0 ? `${readyPairings} ready provider-model pairing${readyPairings === 1 ? "" : "s"}` : "Provider setup required", status: readyPairings > 0 ? "ready" : "attention" },
        ]),
        start: runtimeReady && readyPairings > 0
          ? { enabled: true }
          : { enabled: false, blockedReason: !runtimeReady ? "The local runtime is not ready." : "Set up a ready provider and model before starting chat." },
      });
    });
    void listChats(projectSettings).then((result) => update({ conversations: result.ok ? shapeRecentConversations(result.data.chats) : errorSection("Recent conversations could not be loaded.") }));
    void listProjectMemory(projectSettings).then((result) => update({ memory: result.ok ? shapeMemorySummaries(result.data.notes) : errorSection("Memory metadata could not be loaded.") }));
    void getAgentProgress(projectSettings, controller.signal).then((result) => update({ activeWork: result.ok ? shapeActiveWork(result.data.snapshots) : errorSection("Active work could not be loaded.") }));
    return () => controller.abort();
  }, [project, route.page, route.projectId, settings]);

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
      {route.page === "home" && commandCenter ? <ProjectHome key={project.projectId} project={project} model={commandCenter} navigate={navigate} /> : children}
    </main>
  );
}

function ProjectBlockedState({ title, detail, navigate, onRetry }: { title: string; detail: string; navigate: ProjectNavigation; onRetry?: () => void }) {
  return <main className="project-page-shell"><section className="project-blocked-state" role="alert"><div className="project-empty-orbit" aria-hidden="true">!</div><h1>{title}</h1><p>{detail}</p><div className="row"><ProjectLink route={{ kind: "projects" }} navigate={navigate}>Back to Projects</ProjectLink>{onRetry && <button type="button" className="secondary-button" onClick={onRetry}>Retry</button>}</div></section></main>;
}
