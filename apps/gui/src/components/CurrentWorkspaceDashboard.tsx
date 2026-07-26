import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isSafeWorkspaceDisplayName, type WorkspaceBindingPayload } from "../bridge/bridgeAdapter";
import { createProjectRuntimeSettings, getProject, listProjects, type ProjectSummary } from "../services/projectClient";
import { parseProjectId, type AppRoute, type ProjectId } from "../services/projectRouting";
import { createChat, getAgentProgress, getModels, getPing, listChats, type AgentProgressSnapshot, type ChatSummary, type RuntimeError, type RuntimeSettings } from "../services/runtimeClient";
import { listProviders } from "../services/providersClient";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

type SelectedProject = { projectId: ProjectId; displayName: string };

declare const hostedAuthorityTokenBrand: unique symbol;
export type HostedAuthorityToken = string & { readonly [hostedAuthorityTokenBrand]: true };

type DashboardProps = {
  settings: RuntimeSettings;
  binding: WorkspaceBindingPayload | null;
  hostReadyGeneration?: string | null;
  getAuthorityToken: (selectedProjectId?: ProjectId) => HostedAuthorityToken | null;
  onOpen: (route: Extract<AppRoute, { kind: "legacy" | "settings" | "project" }>, authorityToken: HostedAuthorityToken, selectedProjectId?: ProjectId) => boolean;
};

const loading = { status: "loading" } as const;
const chatIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function CurrentWorkspaceDashboard({ settings, binding, hostReadyGeneration, getAuthorityToken, onOpen }: DashboardProps) {
  const [selection, setSelection] = useState<SelectedProject | null>(null);
  const [projects, setProjects] = useState<LoadState<ProjectSummary[]>>(loading);
  const [summary, setSummary] = useState<LoadState<ProjectSummary>>(loading);
  const [conversations, setConversations] = useState<LoadState<ChatSummary[]>>(loading);
  const [activeWork, setActiveWork] = useState<LoadState<AgentProgressSnapshot[]>>(loading);
  const [runtime, setRuntime] = useState<LoadState<boolean>>(loading);
  const [providerModel, setProviderModel] = useState<LoadState<number>>(loading);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(false);
  const [startError, setStartError] = useState<string | null>(null);
  const trusted = hostReadyGeneration === undefined || (hostReadyGeneration !== null && binding !== null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setSelection(binding?.state === "auto_bound" ? toSelectedProject(binding.projectId, binding.displayName) : null);
  }, [binding]);

  useEffect(() => {
    setProjects(loading);
    setSummary(loading);
    setConversations(loading);
    setActiveWork(loading);
    setRuntime(loading);
    setProviderModel(loading);
    setStarting(false);
    startingRef.current = false;
    setStartError(null);
  }, [binding, hostReadyGeneration]);

  const loadGlobal = useCallback(() => {
    if (!trusted) return;
    const controller = new AbortController();
    setRuntime(loading);
    setProviderModel(loading);
    void getPing(settings, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setRuntime(result.ok && result.data.ready ? { status: "ready", data: true } : { status: "error", message: runtimeMessage(result.ok ? null : result.error) });
    });
    void Promise.all([getModels(settings, controller.signal), listProviders(settings, controller.signal)]).then(([models, providers]) => {
      if (controller.signal.aborted) return;
      if (!models.ok || !providers.ok) {
        setProviderModel({ status: "error", message: "Provider or model readiness could not be loaded." });
        return;
      }
      const readyModels = models.data.models.filter((model) => model.readiness?.status === "ready").length;
      const enabledProviders = providers.data.providers.filter((provider) => provider.enabled).length;
      setProviderModel({ status: "ready", data: Math.min(readyModels, enabledProviders) });
    });
    return () => controller.abort();
  }, [settings, trusted, hostReadyGeneration]);

  useEffect(loadGlobal, [loadGlobal]);

  useEffect(() => {
    if (!trusted || binding?.state !== "selection_required") return;
    const controller = new AbortController();
    setProjects(loading);
    void listProjects(settings, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setProjects(result.ok
        ? { status: "ready", data: result.data.projects.flatMap(toSafeAvailableProject) }
        : { status: "error", message: "Existing projects could not be loaded." });
    });
    return () => controller.abort();
  }, [binding, settings, trusted, hostReadyGeneration]);

  useEffect(() => {
    if (!trusted || !selection) return;
    const controller = new AbortController();
    const scoped = createProjectRuntimeSettings(settings, selection.projectId, { generation: 0, abortSignal: controller.signal });
    setSummary(loading);
    setConversations(loading);
    setActiveWork(loading);
    void getProject(settings, selection.projectId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSummary(result.ok ? { status: "ready", data: result.data } : { status: "error", message: "Project summary could not be loaded." });
    });
    void listChats(scoped).then((result) => {
      if (!controller.signal.aborted) setConversations(result.ok ? { status: "ready", data: newestFirst(result.data.chats) } : { status: "error", message: "Recent conversations could not be loaded." });
    });
    void getAgentProgress(scoped, controller.signal).then((result) => {
      if (!controller.signal.aborted) setActiveWork(result.ok ? { status: "ready", data: result.data.snapshots } : { status: "error", message: "Agent progress could not be loaded." });
    });
    return () => controller.abort();
  }, [selection, settings, trusted, hostReadyGeneration]);

  const latestChat = conversations.status === "ready" ? conversations.data[0] : undefined;
  const projectName = summary.status === "ready" ? summary.data.displayName : selection?.displayName;
  const activeSnapshots = useMemo(() => activeWork.status === "ready" ? activeWork.data.filter((item) => item.status !== "done") : [], [activeWork]);

  const startNew = async () => {
    if (!selection || startingRef.current) return;
    const selectedProjectId = binding?.state === "selection_required" ? selection.projectId : undefined;
    const authorityToken = getAuthorityToken(selectedProjectId);
    if (!authorityToken) {
      setStartError("The workspace changed. Try again.");
      return;
    }
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    const result = await createChat(createProjectRuntimeSettings(settings, selection.projectId));
    if (!mountedRef.current) return;
    setStarting(false);
    startingRef.current = false;
    if (result.ok && chatIdPattern.test(result.data.chatId)) {
      openSelectedProject({ kind: "project", projectId: selection.projectId, page: "chat", chatId: result.data.chatId }, authorityToken, selectedProjectId);
      return;
    }
    setStartError("A new project chat could not be started.");
  };

  if (!trusted || !binding) {
    return <DashboardFrame><section className="workspace-dashboard-card" role="status"><h2>Connecting workspace</h2><p>Waiting for the trusted IDE workspace binding.</p></section></DashboardFrame>;
  }

  return (
    <DashboardFrame>
      <header className="workspace-dashboard-heading">
        <div><span className="badge ok">current workspace</span><h1>{projectName ?? "Choose a project"}</h1><p>Review local readiness, then explicitly resume or start a project chat.</p></div>
        <span className={`status-label ${runtime.status === "ready" ? "ready" : "blocked"}`}>{runtime.status === "loading" ? "Checking runtime" : runtime.status === "ready" ? "Runtime ready" : "Runtime needs attention"}</span>
      </header>

      {binding.state === "selection_required" && !selection && <ProjectChooser projects={projects} onSelect={setSelection} />}

      {selection && <>
        <div className="workspace-dashboard-grid">
          <DashboardSection title="Project" state={summary} ready={summary.status === "ready" ? (summary.data.rootAvailable ? "Local context ready" : "Local context unavailable") : undefined} empty="No project summary is available." />
          <DashboardSection title="Provider & model" state={providerModel} ready={providerModel.status === "ready" ? (providerModel.data > 0 ? `${providerModel.data} ready pairing${providerModel.data === 1 ? "" : "s"}` : "Setup required") : undefined} empty="No ready provider and model pairing." />
          <DashboardSection title="Recent conversations" state={conversations} ready={conversations.status === "ready" && conversations.data.length ? `${conversations.data.length} recent conversation${conversations.data.length === 1 ? "" : "s"}` : undefined} empty="No conversations yet." />
          <DashboardSection title="Active work" state={activeWork} ready={activeWork.status === "ready" && activeSnapshots.length ? `${activeSnapshots.length} active or blocked run${activeSnapshots.length === 1 ? "" : "s"}` : undefined} empty="No active agent work." />
        </div>
        <div className="workspace-dashboard-actions" aria-label="Workspace actions">
          {latestChat && chatIdPattern.test(latestChat.chatId) && <button type="button" onClick={() => openSelectedProjectWithCurrentAuthority({ kind: "project", projectId: selection.projectId, page: "chat", chatId: latestChat.chatId })}>Resume last</button>}
          <button type="button" onClick={() => void startNew()} disabled={starting}>{starting ? "Starting…" : "Start new chat"}</button>
          <button type="button" className="secondary-button" onClick={() => openWithCurrentAuthority({ kind: "settings" })}>Settings</button>
          <button type="button" className="secondary-button" onClick={loadGlobal}>Diagnostics</button>
          <button type="button" className="link-button" onClick={() => openWithCurrentAuthority({ kind: "legacy" })}>Legacy data</button>
        </div>
        {startError && <p className="workspace-dashboard-error" role="alert">{startError}</p>}
      </>}
    </DashboardFrame>
  );

  function openSelectedProjectWithCurrentAuthority(route: Extract<AppRoute, { kind: "project" }>): boolean {
    const selectedProjectId = binding?.state === "selection_required" ? selection?.projectId : undefined;
    const authorityToken = getAuthorityToken(selectedProjectId);
    return authorityToken ? openSelectedProject(route, authorityToken, selectedProjectId) : rejectOpen();
  }

  function openSelectedProject(route: Extract<AppRoute, { kind: "project" }>, authorityToken: HostedAuthorityToken, selectedProjectId?: ProjectId): boolean {
    const opened = onOpen(route, authorityToken, selectedProjectId);
    if (!opened) setStartError("The workspace changed. Try again.");
    return opened;
  }

  function openWithCurrentAuthority(route: Extract<AppRoute, { kind: "legacy" | "settings" }>): boolean {
    const authorityToken = getAuthorityToken();
    if (!authorityToken) return rejectOpen();
    const opened = onOpen(route, authorityToken);
    if (!opened) setStartError("The workspace changed. Try again.");
    return opened;
  }

  function rejectOpen(): false {
    setStartError("The workspace changed. Try again.");
    return false;
  }
}

function DashboardFrame({ children }: { children: ReactNode }) {
  return <main className="workspace-dashboard-shell"><section className="workspace-dashboard stack" aria-labelledby="workspace-dashboard-title"><span className="workspace-dashboard-product">Yet AI</span><div id="workspace-dashboard-title" className="sr-only">Current Workspace Dashboard</div>{children}</section></main>;
}

function ProjectChooser({ projects, onSelect }: { projects: LoadState<ProjectSummary[]>; onSelect: (project: SelectedProject) => void }) {
  return <section className="workspace-dashboard-card stack" aria-labelledby="workspace-project-choice"><h2 id="workspace-project-choice">Select a project for this session</h2>{projects.status === "loading" ? <p role="status">Loading safe project names…</p> : projects.status === "error" ? <p role="alert">{projects.message}</p> : projects.data.length === 0 ? <p>No available projects are registered.</p> : <div className="workspace-project-choices">{projects.data.map((project) => <button type="button" className="secondary-button" key={project.projectId} onClick={() => onSelect({ projectId: project.projectId, displayName: project.displayName })}>{project.displayName}</button>)}</div>}</section>;
}

function DashboardSection<T>({ title, state, ready, empty }: { title: string; state: LoadState<T>; ready?: string; empty: string }) {
  return <section className="workspace-dashboard-card" aria-label={title}><h2>{title}</h2>{state.status === "loading" ? <p role="status">Loading…</p> : state.status === "error" ? <p role="alert">{state.message}</p> : <p>{ready ?? empty}</p>}</section>;
}

function toSelectedProject(projectId: string, displayName: string): SelectedProject | null {
  const parsed = parseProjectId(projectId);
  return parsed && isSafeWorkspaceDisplayName(displayName) ? { projectId: parsed, displayName } : null;
}

function toSafeAvailableProject(project: ProjectSummary): ProjectSummary[] {
  const selected = project.status === "available" && project.rootAvailable
    ? toSelectedProject(project.projectId, project.displayName)
    : null;
  return selected ? [{ ...project, projectId: selected.projectId, displayName: selected.displayName }] : [];
}

function newestFirst(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function runtimeMessage(error: RuntimeError | null): string {
  return error?.status === "network" ? "The local runtime could not be reached." : "The local runtime is not ready.";
}
