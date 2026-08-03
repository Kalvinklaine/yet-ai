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
import { getProviderAuthStatus } from "../services/providerAuthClient";
import { resolveProjectChatReadiness } from "../services/providerReadiness";
import { getAgentProgress, getModels, getPing, listChats, type RuntimeError, type RuntimeSettings } from "../services/runtimeClient";
import { ProjectHome } from "./ProjectHome";
import type { ProjectContextCardModel } from "./ProjectContextStatusCard";
import { ProjectRegistrationDialog } from "./ProjectRegistrationDialog";
import { getProjectContextProfile, getProjectContextStatus, rebuildProjectContext } from "../services/projectContextClient";

export function ProjectShell({ route, settings, navigate, children }: { route: Extract<AppRoute, { kind: "project" }>; settings: RuntimeSettings; navigate: ProjectNavigation; children?: ReactNode }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [loading, setLoading] = useState(true);
  const [commandCenter, setCommandCenter] = useState<ProjectCommandCenterModel | null>(null);
  const [projectContext, setProjectContext] = useState<ProjectContextCardModel>({ status: "loading" });
  const [contextRebuilding, setContextRebuilding] = useState(false);
  const [contextRebuildError, setContextRebuildError] = useState<string | null>(null);
  const [rebindOpen, setRebindOpen] = useState(false);
  const projectRequestRef = useRef(0);
  const commandCenterRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const rebindGenerationRef = useRef(0);
  const contextRequestRef = useRef(0);
  const load = useCallback(async () => {
    const request = ++projectRequestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const result = await getProject(settings, route.projectId, controller.signal);
    if (request !== projectRequestRef.current) return;
    if (result.ok) setProject(result.data); else { setProject(null); setError(result.error); }
    setLoading(false);
    return controller;
  }, [route.projectId, settings]);
  useEffect(() => {
    mountedRef.current = true;
    setRebindOpen(false);
    const request = ++projectRequestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getProject(settings, route.projectId, controller.signal).then((result) => {
      if (request !== projectRequestRef.current || controller.signal.aborted) return;
      if (result.ok) setProject(result.data); else setError(result.error);
      setLoading(false);
    });
    return () => {
      controller.abort();
      rebindGenerationRef.current += 1;
    };
  }, [route.projectId, settings]);
  useEffect(() => () => { mountedRef.current = false; }, []);

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
    void Promise.all([getPing(settings, controller.signal), getModels(settings, controller.signal), listProviders(settings, controller.signal), getProviderAuthStatus(settings, "openai")]).then(([ping, models, providers, providerAuth]) => {
      const runtimeReady = ping.ok && ping.data.ready;
      const chatReadiness = resolveProjectChatReadiness({
        runtimeReady,
        models: models.ok ? models.data.models : [],
        providers: providers.ok ? providers.data.providers : [],
        providerAuthStatus: providerAuth.ok ? providerAuth.data : null,
      });
      update({
        readiness: shapeReadiness([
          { id: "project", label: "Local project context", status: "ready" },
          { id: "runtime", label: runtimeReady ? "Local runtime" : "Runtime status unavailable", status: runtimeReady ? "ready" : "blocked" },
          { id: "provider", label: chatReadiness.readinessLabel, status: chatReadiness.readinessStatus },
        ]),
        start: chatReadiness.startEnabled ? { enabled: true } : { enabled: false, blockedReason: chatReadiness.blockedReason },
      });
    });
    void listChats(projectSettings).then((result) => update({ conversations: result.ok ? shapeRecentConversations(result.data.chats) : errorSection("Recent conversations could not be loaded.") }));
    void listProjectMemory(projectSettings).then((result) => update({ memory: result.ok ? shapeMemorySummaries(result.data.notes) : errorSection("Memory metadata could not be loaded.") }));
    void getAgentProgress(projectSettings, controller.signal).then((result) => update({ activeWork: result.ok ? shapeActiveWork(result.data.snapshots) : errorSection("Active work could not be loaded.") }));
    return () => controller.abort();
  }, [project, route.page, route.projectId, settings]);

  const loadProjectContext = useCallback(async (projectSettings: ReturnType<typeof createProjectRuntimeSettings>, request: number) => {
    setProjectContext({ status: "loading" });
    const status = await getProjectContextStatus(projectSettings);
    if (request !== contextRequestRef.current || projectSettings.projectScope.abortSignal.aborted) return;
    if (!status.ok || status.data.projectId !== projectSettings.projectScope.projectId) {
      setProjectContext({ status: "error", message: "Project context status could not be loaded safely." });
      return;
    }
    if (status.data.state !== "ready" && status.data.state !== "stale") {
      setProjectContext({ status: "ready", context: status.data, profile: null });
      return;
    }
    const profile = await getProjectContextProfile(projectSettings);
    if (request !== contextRequestRef.current || projectSettings.projectScope.abortSignal.aborted) return;
    setProjectContext({ status: "ready", context: status.data, profile: profile.ok && profile.data.projectId === projectSettings.projectScope.projectId ? profile.data : null });
  }, []);

  useEffect(() => {
    if (route.page !== "home" || !project || project.projectId !== route.projectId || project.status !== "available" || !project.rootAvailable) return;
    const request = ++contextRequestRef.current;
    const controller = new AbortController();
    const projectSettings = createProjectRuntimeSettings(settings, project.projectId, { generation: request, abortSignal: controller.signal });
    setContextRebuildError(null);
    setContextRebuilding(false);
    void loadProjectContext(projectSettings, request);
    return () => controller.abort();
  }, [loadProjectContext, project, route.page, route.projectId, settings]);

  const rebuildContext = useCallback(async () => {
    if (!project || projectContext.status !== "ready") return;
    const request = ++contextRequestRef.current;
    const controller = new AbortController();
    const projectSettings = createProjectRuntimeSettings(settings, project.projectId, { generation: request, abortSignal: controller.signal });
    setContextRebuilding(true);
    setContextRebuildError(null);
    const result = await rebuildProjectContext(projectSettings, { expectedInventoryGeneration: projectContext.context.inventoryGeneration, expectedProjectRevision: project.revision });
    if (request !== contextRequestRef.current || controller.signal.aborted) return;
    if (!result.ok || result.data.projectId !== project.projectId) {
      setContextRebuilding(false);
      setContextRebuildError("Project context could not be rebuilt. Refresh the project status and try again.");
      return;
    }
    await loadProjectContext(projectSettings, request);
    if (request === contextRequestRef.current) setContextRebuilding(false);
  }, [loadProjectContext, project, projectContext, settings]);

  if (loading) return <main className="project-page-shell"><section className="project-blocked-state" role="status"><h1>Loading project…</h1><p>Checking the local project boundary.</p></section></main>;
  if (error || !project) return <ProjectBlockedState title="Project unavailable" detail={error?.status === 404 ? "This project could not be found." : "Yet AI could not safely load this project."} navigate={navigate} onRetry={() => void load()} />;
  if (project.status === "archived") return <ProjectBlockedState title="Project archived" detail="Restore this project from the Projects page before opening its local data." navigate={navigate} />;
  if (project.status === "missing" || !project.rootAvailable) {
    const generation = rebindGenerationRef.current;
    return <><ProjectBlockedState title="Project directory unavailable" detail="The registered directory is missing, moved, inaccessible, or no longer matches this project. No replacement was guessed." navigate={navigate} actionLabel="Reconnect directory" onAction={() => { rebindGenerationRef.current += 1; setRebindOpen(true); }} />{rebindOpen && <ProjectRegistrationDialog settings={settings} mode="rebind" project={project} projectStateChangedActionLabel="Close and reload project" onClose={() => { rebindGenerationRef.current += 1; setRebindOpen(false); }} onProjectStateChanged={() => {
      rebindGenerationRef.current += 1;
      setRebindOpen(false);
      void load();
    }} onRegistered={(repaired) => {
      if (!mountedRef.current || generation !== rebindGenerationRef.current || repaired.projectId !== route.projectId) return;
      rebindGenerationRef.current += 1;
      setRebindOpen(false);
      setProject(repaired);
    }} />}</>;
  }

  const nav: Array<{ page: "home" | "chat" | "memory" | "agent"; label: string }> = [{ page: "home", label: "Home" }, { page: "chat", label: "Chat" }, { page: "memory", label: "Memory" }, { page: "agent", label: "Agent" }];
  return (
    <main className="project-page-shell">
      <header className="project-shell-header">
        <div className="project-shell-boundary"><ProjectLink route={{ kind: "projects" }} navigate={navigate}>← Projects</ProjectLink><span className="project-boundary-divider" aria-hidden="true" /><div><span className="subtle">Current project</span><strong>{project.displayName}</strong></div></div>
        <div className="row"><span className="status-label ready"><span aria-hidden="true">●</span>Ready</span><ProjectLink className="project-settings-link" route={{ kind: "settings" }} navigate={navigate}>Settings</ProjectLink></div>
      </header>
      <nav className="project-shell-nav" aria-label={`${project.displayName} navigation`}>{nav.map((item) => <ProjectLink key={item.page} route={{ kind: "project", projectId: project.projectId, page: item.page }} navigate={navigate} aria-current={route.page === item.page ? "page" : undefined}>{item.label}</ProjectLink>)}</nav>
      {route.page === "home" && commandCenter ? <ProjectHome key={project.projectId} project={project} model={commandCenter} context={projectContext} contextRebuilding={contextRebuilding} contextRebuildError={contextRebuildError} onRebuildContext={() => void rebuildContext()} navigate={navigate} /> : children}
    </main>
  );
}

function ProjectBlockedState({ title, detail, navigate, onRetry, actionLabel, onAction }: { title: string; detail: string; navigate: ProjectNavigation; onRetry?: () => void; actionLabel?: string; onAction?: () => void }) {
  return <main className="project-page-shell"><section className="project-blocked-state" role="alert"><div className="project-empty-orbit" aria-hidden="true">!</div><h1>{title}</h1><p>{detail}</p><div className="row"><ProjectLink route={{ kind: "projects" }} navigate={navigate}>Back to Projects</ProjectLink>{actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>}{onRetry && <button type="button" className="secondary-button" onClick={onRetry}>Retry</button>}</div></section></main>;
}
