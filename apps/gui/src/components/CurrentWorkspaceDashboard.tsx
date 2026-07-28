import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isSafeWorkspaceDisplayName, type WorkspaceBindingPayload } from "../bridge/bridgeAdapter";
import { listProjectMemory } from "../services/projectMemoryClient";
import {
  errorSection,
  loadingSection,
  shapeActiveWork,
  shapeMemorySummaries,
  shapeReadiness,
  shapeRecentConversations,
  type CommandCenterSection,
  type MemoryNoteSummaryItem,
  type ProjectCommandCenterModel,
} from "../services/projectCommandCenterData";
import { createProjectRuntimeSettings, getProject, listProjects, type ProjectSummary } from "../services/projectClient";
import { parseProjectId, type AppRoute, type ProjectId } from "../services/projectRouting";
import { createChat, getAgentProgress, getModels, getPing, listChats, type AgentProgressSnapshot, type ChatSummary, type RuntimeError, type RuntimeSettings } from "../services/runtimeClient";
import { listProviders } from "../services/providersClient";
import { ProjectCommandCenter } from "./ProjectCommandCenter";

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
  onSelectedMemoryNoteIdsChange?: (noteIds: string[]) => void;
};

const loading = { status: "loading" } as const;
const chatIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function CurrentWorkspaceDashboard({ settings, binding, hostReadyGeneration, getAuthorityToken, onOpen, onSelectedMemoryNoteIdsChange }: DashboardProps) {
  const [chosenProject, setChosenProject] = useState<{ project: SelectedProject; bindingKey: string } | null>(null);
  const [projects, setProjects] = useState<LoadState<ProjectSummary[]>>(loading);
  const [summary, setSummary] = useState<LoadState<ProjectSummary>>(loading);
  const [conversations, setConversations] = useState<LoadState<ChatSummary[]>>(loading);
  const [memory, setMemory] = useState<CommandCenterSection<MemoryNoteSummaryItem>>(loadingSection);
  const [selectedMemoryNoteIds, setSelectedMemoryNoteIds] = useState<string[]>([]);
  const [activeWork, setActiveWork] = useState<LoadState<AgentProgressSnapshot[]>>(loading);
  const [runtime, setRuntime] = useState<LoadState<boolean>>(loading);
  const [providerModel, setProviderModel] = useState<LoadState<number>>(loading);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(false);
  const selectedMemoryChangeRef = useRef(onSelectedMemoryNoteIdsChange);
  selectedMemoryChangeRef.current = onSelectedMemoryNoteIdsChange;
  const [startError, setStartError] = useState<string | null>(null);
  const trusted = hostReadyGeneration === undefined || (hostReadyGeneration !== null && binding !== null);
  const bindingKey = `${hostReadyGeneration ?? "standalone"}\u0000${binding?.requestId ?? "unbound"}`;
  const selection = useMemo(() => binding?.state === "auto_bound"
    ? toSelectedProject(binding.projectId, binding.displayName)
    : chosenProject?.bindingKey === bindingKey ? chosenProject.project : null,
  [binding, bindingKey, chosenProject]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setChosenProject(null);
    setSelectedMemoryNoteIds([]);
    selectedMemoryChangeRef.current?.([]);
    setProjects(loading);
    setSummary(loading);
    setConversations(loading);
    setMemory(loadingSection());
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
    setMemory(loadingSection());
    setActiveWork(loading);
    void getProject(settings, selection.projectId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSummary(result.ok ? { status: "ready", data: result.data } : { status: "error", message: "Project summary could not be loaded." });
    });
    void listChats(scoped).then((result) => {
      if (!controller.signal.aborted) setConversations(result.ok ? { status: "ready", data: newestFirst(result.data.chats) } : { status: "error", message: "Recent conversations could not be loaded." });
    });
    void listProjectMemory(scoped).then((result) => {
      if (controller.signal.aborted) return;
      setMemory(result.ok
        ? shapeMemorySummaries(result.data.notes.map(({ id, title, tags, updatedAt }) => ({ id, title, tags, updatedAt })))
        : errorSection("Project memory could not be loaded."));
    });
    void getAgentProgress(scoped, controller.signal).then((result) => {
      if (!controller.signal.aborted) setActiveWork(result.ok ? { status: "ready", data: result.data.snapshots } : { status: "error", message: "Agent progress could not be loaded." });
    });
    return () => controller.abort();
  }, [selection, settings, trusted, hostReadyGeneration]);

  const projectName = selection?.displayName;
  const commandCenterModel = useMemo<ProjectCommandCenterModel>(() => ({
    readiness: commandCenterReadiness(summary, runtime, providerModel),
    conversations: conversations.status === "loading" ? loadingSection() : conversations.status === "error" ? errorSection(conversations.message) : shapeRecentConversations(conversations.data),
    memory,
    activeWork: activeWork.status === "loading" ? loadingSection() : activeWork.status === "error" ? errorSection(activeWork.message) : shapeActiveWork(activeWork.data),
    start: starting
      ? { enabled: false, blockedReason: "Starting…" }
      : commandCenterStart(summary, runtime, providerModel),
  }), [activeWork, conversations, memory, providerModel, runtime, starting, summary]);

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
        <div><span className="badge ok">current workspace</span><h1>Hosted workspace</h1><p>Trusted local project controls from your IDE.</p></div>
      </header>

      {binding.state === "selection_required" && !selection && <ProjectChooser projects={projects} onSelect={(project) => setChosenProject({ project, bindingKey })} />}

      {selection && <>
        <ProjectCommandCenter
          title={projectName ?? "Current project"}
          model={commandCenterModel}
          selectedMemoryNoteIds={selectedMemoryNoteIds}
          onStart={() => void startNew()}
          onResume={(chatId) => openSelectedProjectWithCurrentAuthority({ kind: "project", projectId: selection.projectId, page: "chat", chatId })}
          onMemorySelectionChange={(noteIds) => {
            setSelectedMemoryNoteIds(noteIds);
            selectedMemoryChangeRef.current?.(noteIds);
          }}
          onNavigateActiveWork={() => openSelectedProjectWithCurrentAuthority({ kind: "project", projectId: selection.projectId, page: "agent" })}
        />
        <div className="workspace-dashboard-actions" aria-label="Workspace actions">
          {binding.state === "auto_bound" && <button type="button" className="secondary-button" onClick={() => openWithCurrentAuthority({ kind: "settings" })}>Settings</button>}
          <button type="button" className="secondary-button" onClick={loadGlobal}>Diagnostics</button>
          {binding.state === "auto_bound" && <button type="button" className="link-button" onClick={() => openWithCurrentAuthority({ kind: "legacy" })}>Legacy data</button>}
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

function commandCenterReadiness(summary: LoadState<ProjectSummary>, runtime: LoadState<boolean>, providerModel: LoadState<number>): ProjectCommandCenterModel["readiness"] {
  if (summary.status === "loading" || runtime.status === "loading" || providerModel.status === "loading") return loadingSection();
  return shapeReadiness([
    { id: "project", label: summary.status === "ready" ? "Local project context" : "Project status unavailable", status: summary.status === "ready" && summary.data.rootAvailable ? "ready" : "blocked" },
    { id: "runtime", label: runtime.status === "ready" ? "Local runtime" : "Runtime status unavailable", status: runtime.status === "ready" ? "ready" : "blocked" },
    { id: "provider", label: providerModel.status === "ready" && providerModel.data > 0 ? `${providerModel.data} ready provider-model pairing${providerModel.data === 1 ? "" : "s"}` : "Provider setup required", status: providerModel.status === "ready" && providerModel.data > 0 ? "ready" : "attention" },
  ]);
}

function commandCenterStart(summary: LoadState<ProjectSummary>, runtime: LoadState<boolean>, providerModel: LoadState<number>): ProjectCommandCenterModel["start"] {
  if (summary.status === "loading" || runtime.status === "loading" || providerModel.status === "loading") {
    return { enabled: false, blockedReason: "Checking project, runtime, and provider readiness…" };
  }
  if (summary.status !== "ready" || summary.data.status !== "available" || !summary.data.rootAvailable) {
    return { enabled: false, blockedReason: "Project context is unavailable." };
  }
  if (runtime.status !== "ready" || !runtime.data) {
    return { enabled: false, blockedReason: "The local runtime is not ready." };
  }
  if (providerModel.status !== "ready" || providerModel.data < 1) {
    return { enabled: false, blockedReason: "Set up a ready provider and model before starting chat." };
  }
  return { enabled: true };
}
