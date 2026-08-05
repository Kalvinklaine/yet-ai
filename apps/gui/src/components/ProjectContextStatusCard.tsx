import { useCallback, useEffect, useRef, useState } from "react";
import { createProjectRuntimeSettings, getProject, type ProjectRuntimeSettings } from "../services/projectClient";
import { getProjectContextStatus, rebuildProjectContext, type ProjectContextMode, type ProjectContextProfile, type ProjectContextStatus } from "../services/projectContextClient";
import type { ProjectContextPlanningSelection, RuntimeSettings } from "../services/runtimeClient";
import { useProjectContextPlanning, type ProjectContextPlanning } from "../services/useProjectContextPlanning";
import { ProjectChatContextSetupCard } from "./ProjectChatContextSetupCard";

export type ProjectContextCardModel =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: ProjectContextStatus; profile: ProjectContextProfile | null };

const rebuildPollDelayMs = 500;
const rebuildPollLimit = 12;

function isUsableContext(context: ProjectContextStatus) {
  return context.state === "ready";
}

function waitForPoll(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, rebuildPollDelayMs);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function ProjectChatContextController({ projectId, chatId, draft, settings, generationKey, onSelectionChange, onReadyChange }: { projectId: string; chatId: string | null; draft: string; settings: RuntimeSettings; generationKey: string; onSelectionChange?: (selection: ProjectContextPlanningSelection | null) => void; onReadyChange?: (ready: boolean) => void }) {
  const [context, setContext] = useState<ProjectContextStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptOnly, setPromptOnly] = useState(false);
  const requestRef = useRef(0);
  const statusAbortRef = useRef<AbortController | null>(null);
  const buildAbortRef = useRef<AbortController | null>(null);
  const planning = useProjectContextPlanning({ projectId, chatId, draft, settings, generationKey, enabled: context?.state === "ready", onSelectionChange, onReadyChange });
  const planningRefreshRef = useRef(planning.refresh);
  planningRefreshRef.current = planning.refresh;

  const pollBuilding = useCallback(async ({ request, controller, scoped, fallbackContext, waitBeforeFirstPoll }: { request: number; controller: AbortController; scoped: ProjectRuntimeSettings; fallbackContext: ProjectContextStatus; waitBeforeFirstPoll: boolean }) => {
    setWorking(true);
    for (let attempt = 0; attempt < rebuildPollLimit; attempt += 1) {
      if (waitBeforeFirstPoll || attempt > 0) await waitForPoll(controller.signal);
      if (request !== requestRef.current || controller.signal.aborted) return;
      const status = await getProjectContextStatus(scoped);
      if (request !== requestRef.current || controller.signal.aborted) return;
      if (!status.ok) {
        setWorking(false);
        setContext(fallbackContext);
        setError("Project context status could not be checked after the rebuild. Try again or use prompt only.");
        return;
      }
      setContext(status.data);
      if (isUsableContext(status.data)) {
        setWorking(false);
        setError(null);
        await planningRefreshRef.current();
        return;
      }
      if (status.data.state !== "building") {
        setWorking(false);
        setError("Project context rebuild did not become ready. Try again or use prompt only.");
        return;
      }
    }
    setWorking(false);
    setContext(fallbackContext);
    setError("Project context rebuild is taking too long. Try again or use prompt only.");
  }, []);

  const loadStatus = useCallback(async () => {
    statusAbortRef.current?.abort();
    buildAbortRef.current?.abort();
    const request = ++requestRef.current;
    const controller = new AbortController();
    statusAbortRef.current = controller;
    setLoading(true);
    const scoped = createProjectRuntimeSettings(settings, projectId, { generation: request, abortSignal: controller.signal });
    const result = await getProjectContextStatus(scoped);
    if (request !== requestRef.current || controller.signal.aborted) return;
    setContext(result.ok ? result.data : null);
    setError(result.ok ? null : "Project context status is unavailable. You can continue with your prompt only.");
    setLoading(false);
    if (result.ok && result.data.state === "building") await pollBuilding({ request, controller, scoped, fallbackContext: result.data, waitBeforeFirstPoll: true });
  }, [pollBuilding, projectId, settings.baseUrl, settings.token, settings.runtimeAccess]);

  useEffect(() => {
    setPromptOnly(false);
    setContext(null);
    setError(null);
    setWorking(false);
    void loadStatus();
    return () => {
      requestRef.current += 1;
      statusAbortRef.current?.abort();
      buildAbortRef.current?.abort();
    };
  }, [loadStatus, projectId]);

  useEffect(() => {
    if (!loading && (!context || !isUsableContext(context)) && planning.mode !== "manual_only") onReadyChange?.(!draft.trim());
  }, [context, draft, loading, onReadyChange, planning.mode]);

  const build = useCallback(async () => {
    if (!context) return;
    statusAbortRef.current?.abort();
    buildAbortRef.current?.abort();
    const request = ++requestRef.current;
    const controller = new AbortController();
    buildAbortRef.current = controller;
    const scoped = createProjectRuntimeSettings(settings, projectId, { generation: request, abortSignal: controller.signal });
    setWorking(true);
    setError(null);
    const project = await getProject(settings, projectId, controller.signal);
    if (request !== requestRef.current || controller.signal.aborted) return;
    const result = project.ok ? await rebuildProjectContext(scoped, { expectedInventoryGeneration: context.inventoryGeneration, expectedProjectRevision: project.data.revision }) : project;
    if (request !== requestRef.current || controller.signal.aborted) return;
    if (!result.ok) {
      setWorking(false);
      setError("Project context could not be built. Try again or start without project context.");
      return;
    }
    await pollBuilding({ request, controller, scoped, fallbackContext: context, waitBeforeFirstPoll: false });
  }, [context, pollBuilding, projectId, settings.baseUrl, settings.token, settings.runtimeAccess]);

  const startWithoutContext = useCallback(() => {
    setPromptOnly(true);
    planning.useManualFallback();
  }, [planning.useManualFallback]);

  if (loading) return <section className="project-chat-context-status compact-loading" aria-label="Project context" data-testid="project-context-entrypoint" aria-busy="true"><strong>Project context</strong><span className="subtle">Checking local cache…</span></section>;
  if (!context) return <section className="project-chat-context-status" aria-label="Project context" data-testid="project-context-entrypoint"><strong>Project context</strong><span className="subtle">{error}</span><button type="button" className="secondary-button" onClick={startWithoutContext}>Start without project context</button></section>;
  if (context.state === "not_built" || context.state === "stale" || context.state === "migration_required" || context.state === "unavailable") return promptOnly && planning.mode === "manual_only"
    ? <ProjectChatContextStatus context={context} planning={planning} />
    : <ProjectChatContextSetupCard state={context.state} working={working} error={error} onBuild={() => void build()} onStartWithoutContext={startWithoutContext} />;
  if (context.state === "building") return <section className="project-chat-context-status stack" aria-label="Project context" data-testid="project-context-entrypoint" aria-busy={working}><strong>Project context</strong><span className="subtle">{working ? "Building the local project cache…" : error ?? "Project context build needs a status refresh."}</span><div className="project-chat-context-actions"><button type="button" className="secondary-button" onClick={() => void loadStatus()}>{working ? "Refresh build status" : "Retry build status"}</button><button type="button" className="secondary-button" onClick={startWithoutContext}>Use prompt only</button></div></section>;
  return <ProjectChatContextStatus context={context} planning={planning} />;
}

export function ProjectChatContextStatus({ context, planning }: { context: ProjectContextStatus; planning: ProjectContextPlanning }) {
  const [open, setOpen] = useState(false);
  const selectedCount = planning.view?.included.length ?? 0;
  const status = planning.mode === "manual_only" ? "Prompt only" : planning.loading ? "Planning…" : planning.error ? "Plan unavailable" : planning.plan ? `${selectedCount} selected` : "Balanced automatic";
  return <section className="project-chat-context-status" aria-label="Project context" data-testid="project-context-entrypoint">
    <button type="button" className="project-chat-context-trigger" aria-expanded={open} aria-controls="project-chat-context-advanced" onClick={() => setOpen((value) => !value)}>
      <span><strong>Project context</strong><span className="subtle">{status}</span></span>
      <span className={`badge ${planning.error ? "warn" : "ok"}`}>{modeLabel(planning.mode)}</span>
    </button>
    {open && <div id="project-chat-context-advanced" className="project-chat-context-advanced stack">
      <label>Project context mode<select aria-label="Project context mode" value={planning.mode} onChange={(event) => planning.setMode(event.target.value as ProjectContextMode)}><option value="balanced">Balanced</option><option value="deep">Deep</option><option value="manual_only">Manual-only</option></select></label>
      <span className="subtle">This preference lasts for the current project session only. Explicit file and memory attachments remain separate.</span>
      {planning.mode === "manual_only" ? <span>Prompt-only fallback is active. No automatic project context will be sent.</span> : <>
        <div className="project-chat-context-metadata" aria-label="Bounded project context metadata">
          <span>Cache generation {context.inventoryGeneration}</span>
          <span>{selectedCount} selected item{selectedCount === 1 ? "" : "s"}</span>
          {planning.view && <span>{planning.view.budget}</span>}
        </div>
        <div className="project-chat-context-actions"><button type="button" className="secondary-button" onClick={() => void planning.refresh()} disabled={planning.loading}>{planning.loading ? "Planning…" : "Refresh planned context"}</button><button type="button" className="secondary-button" onClick={planning.useManualFallback}>Use prompt only</button></div>
        {planning.error && <span className="error" role="alert">Planned context is unavailable. Use prompt only or retry.</span>}
      </>}
    </div>}
  </section>;
}

export function ProjectContextStatusCard({ model, rebuilding, rebuildError, onRebuild }: { model: ProjectContextCardModel; rebuilding: boolean; rebuildError: string | null; onRebuild: () => void }) {
  if (model.status === "loading") return <section className="project-context-card" aria-labelledby="project-context-heading" aria-busy="true"><h2 id="project-context-heading">Project Context</h2><p role="status">Loading local structural evidence…</p></section>;
  if (model.status === "error") return <section className="project-context-card" aria-labelledby="project-context-heading"><h2 id="project-context-heading">Project Context</h2><p role="alert">{model.message}</p></section>;

  const { context, profile } = model;
  const state = stateCopy(context.state);
  const facts = profile?.facts ?? [];
  const groups = [
    ["Primary languages", facts.filter((fact) => fact.kind === "language")],
    ["Manifests", facts.filter((fact) => fact.kind === "manifest")],
    ["Modules", facts.filter((fact) => fact.kind === "module")],
    ["Entrypoints", facts.filter((fact) => fact.kind === "entry_point")],
    ["Build hints", facts.filter((fact) => fact.kind === "build_command")],
    ["Test hints", facts.filter((fact) => fact.kind === "test_command")],
  ] as const;

  return (
    <section className="project-context-card stack" aria-labelledby="project-context-heading">
      <div className="project-context-heading">
        <div><span className={`status-label ${context.state === "ready" ? "ready" : "pending"}`}>{state.label}</span><h2 id="project-context-heading">Project Context</h2></div>
        <button type="button" className="secondary-button" onClick={onRebuild} disabled={rebuilding || context.state === "building"}>{rebuilding ? "Rebuilding…" : "Rebuild project context"}</button>
      </div>
      <p>{state.detail}</p>
      <p className="subtle">The local engine inventories safe relative paths and derives structural and manifest-convention facts. File bodies are not shown here. This evidence is not semantic indexing and is not automatically attached to chat.</p>
      {context.counts && <dl className="project-context-counts"><div><dt>Generation</dt><dd>{context.inventoryGeneration}</dd></div><div><dt>Eligible files</dt><dd>{context.counts.eligibleFiles}</dd></div><div><dt>Indexed inventory entries</dt><dd>{context.counts.indexedFiles}</dd></div><div><dt>Omitted files</dt><dd>{context.counts.omittedFiles}</dd></div></dl>}
      {context.progress && <p role="status" className="subtle">{context.progress.phase === "idle" ? "Watching for local changes" : context.progress.phase === "reconciling" ? "Reconciling local changes" : "Indexing local changes"} · {context.progress.completedFiles} of {context.progress.totalFiles} files</p>}
      {profile ? <>
        <p>{profile.summary}</p>
        <div className="project-context-facts">{groups.map(([title, items]) => <section key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((item) => <li key={`${item.kind}:${item.sourceRef}`}><strong>{item.label}</strong><code>{item.sourceRef}</code><span>{item.provenance === "structural_inventory" ? "Structural inventory" : "Manifest convention"}</span></li>)}</ul> : <p className="subtle">None detected.</p>}</section>)}</div>
      </> : <p className="subtle">No completed profile is available yet.</p>}
      {rebuildError && <p role="alert">{rebuildError}</p>}
    </section>
  );
}

function modeLabel(mode: ProjectContextMode) {
  if (mode === "manual_only") return "manual-only";
  return mode;
}

function stateCopy(state: ProjectContextStatus["state"]) {
  switch (state) {
    case "not_built": return { label: "Not initialized", detail: "Build the local structural inventory when you are ready." };
    case "building": return { label: "Building", detail: "The local engine is rebuilding structural evidence." };
    case "ready": return { label: "Ready", detail: "The completed local structural profile is available below." };
    case "stale": return { label: "Stale", detail: "Project evidence changed after the completed generation. Rebuild explicitly to refresh it." };
    case "migration_required": return { label: "Error", detail: "The local context cache requires a supported migration before it can be inspected." };
    case "unavailable": return { label: "Error", detail: "The local context cache is unavailable." };
  }
}
