import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildContextManifestView, contextManifestEntryKey, manifestEntryToExplicitRef, manifestMatchesCorrelation } from "./contextManifestView";
import { createProjectRuntimeSettings, getProject } from "./projectClient";
import { getProjectContextStatus, planProjectContext, type ProjectContextExplicitRef, type ProjectContextMode, type ProjectContextPlan } from "./projectContextClient";
import type { ProjectContextPlanningSelection, ProjectContextSourceIdentity, RuntimeSettings } from "./runtimeClient";

export const projectContextPlanningBudget = { maxFiles: 12, maxChunks: 32, maxBytes: 131072, maxEstimatedTokens: 24000 };
export const projectContextPlanningDebounceMs = 350;

type PlanningState = "idle" | "loading" | "error" | "stopped";

type UseProjectContextPlanningInput = {
  projectId: string;
  chatId: string | null;
  draft: string;
  settings: RuntimeSettings;
  generationKey: string;
  enabled?: boolean;
  onSelectionChange?: (selection: ProjectContextPlanningSelection | null) => void;
  onReadyChange?: (ready: boolean) => void;
};

export type ProjectContextPlanning = {
  mode: ProjectContextMode;
  plan: ProjectContextPlan | null;
  view: ReturnType<typeof buildContextManifestView> | null;
  state: PlanningState;
  loading: boolean;
  error: boolean;
  ready: boolean;
  selection: ProjectContextPlanningSelection | null;
  excluded: ReadonlySet<string>;
  pinned: ProjectContextExplicitRef[];
  setMode: (mode: ProjectContextMode) => void;
  refresh: () => Promise<void>;
  invalidate: (clearPlan?: boolean) => void;
  pin: (key: string) => void;
  exclude: (key: string) => void;
  useManualFallback: () => void;
  cancel: () => void;
};

export function useProjectContextPlanning({ projectId, chatId, draft, settings, generationKey, enabled = true, onSelectionChange, onReadyChange }: UseProjectContextPlanningInput): ProjectContextPlanning {
  const [modeState, setModeState] = useState<{ projectId: string; mode: ProjectContextMode }>({ projectId, mode: "balanced" });
  const mode = modeState.projectId === projectId ? modeState.mode : "balanced";
  const [plan, setPlan] = useState<ProjectContextPlan | null>(null);
  const [state, setState] = useState<PlanningState>("idle");
  const [ready, setReady] = useState(() => !draft.trim());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<ProjectContextExplicitRef[]>([]);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const revisionRef = useRef("");
  const completedCorrelationRef = useRef("");
  const selectionCallbackRef = useRef(onSelectionChange);
  const readyCallbackRef = useRef(onReadyChange);
  selectionCallbackRef.current = onSelectionChange;
  readyCallbackRef.current = onReadyChange;

  const runtimeAccess = settings.runtimeAccess ?? "direct";
  const settingsFingerprint = JSON.stringify({ baseUrl: settings.baseUrl, token: settings.token, runtimeAccess });
  const pinnedFingerprint = JSON.stringify(pinned);
  const excludedKeys = useMemo(() => Array.from(excluded).sort(), [excluded]);
  const excludedSources = useMemo<ProjectContextSourceIdentity[]>(() => excludedKeys.map((key) => JSON.parse(key) as ProjectContextSourceIdentity), [excludedKeys]);
  const controlFingerprint = JSON.stringify({ excludedSources, explicitRefs: pinned, mode });
  const controlIdentity = JSON.stringify({ mode, explicitRefs: pinned, excludedKeys });
  const query = draft.trim();
  const scopeIdentity = JSON.stringify({ projectId, chatId, draft, generationKey, settingsFingerprint });
  const correlation = JSON.stringify({ projectId, chatId, draft, generationKey, settingsFingerprint, controlIdentity });
  const correlationRef = useRef(correlation);
  correlationRef.current = correlation;

  const publishReady = useCallback((value: boolean) => {
    setReady(value);
    readyCallbackRef.current?.(value);
  }, []);

  const invalidate = useCallback((clearPlan = true) => {
    requestRef.current += 1;
    abortRef.current?.abort();
    if (clearPlan) {
      completedCorrelationRef.current = "";
      setPlan(null);
      setState(query ? "loading" : "idle");
    }
    selectionCallbackRef.current?.(null);
    publishReady(!query);
  }, [publishReady, query]);

  const runPlanning = useCallback(async (force: boolean) => {
    abortRef.current?.abort();
    if (!query) {
      completedCorrelationRef.current = "";
      setPlan(null);
      setState("idle");
      selectionCallbackRef.current?.(null);
      publishReady(true);
      return;
    }
    if (mode === "manual_only") {
      completedCorrelationRef.current = "";
      setPlan(null);
      setState("idle");
      selectionCallbackRef.current?.(null);
      publishReady(true);
      return;
    }
    if (!force && completedCorrelationRef.current === correlationRef.current) return;
    const request = ++requestRef.current;
    const expectedCorrelation = correlationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const baseSettings: RuntimeSettings = { baseUrl: settings.baseUrl, token: settings.token, runtimeAccess };
    const scoped = createProjectRuntimeSettings(baseSettings, projectId, { generation: request, abortSignal: controller.signal });
    setState("loading");
    setPlan(null);
    selectionCallbackRef.current?.(null);
    publishReady(false);
    const [projectResult, statusResult] = await Promise.all([getProject(baseSettings, projectId, controller.signal), getProjectContextStatus(scoped)]);
    if (request !== requestRef.current || expectedCorrelation !== correlationRef.current) return;
    if (!projectResult.ok || !statusResult.ok || statusResult.data.state !== "ready") {
      setPlan(null);
      setState("error");
      selectionCallbackRef.current?.(null);
      publishReady(false);
      return;
    }
    revisionRef.current = projectResult.data.revision;
    const result = await planProjectContext(scoped, { query, mode, budget: projectContextPlanningBudget, explicitRefs: pinned, expectedInventoryGeneration: statusResult.data.inventoryGeneration, expectedProjectRevision: projectResult.data.revision });
    if (request !== requestRef.current || expectedCorrelation !== correlationRef.current) return;
    if (!result.ok || !["ready", "truncated"].includes(result.data.status) || result.data.mode !== mode || !manifestMatchesCorrelation(result.data.manifest, projectId, statusResult.data.inventoryGeneration)) {
      setPlan(null);
      setState("error");
      selectionCallbackRef.current?.(null);
      publishReady(false);
      return;
    }
    const currentKeys = new Set(result.data.manifest.entries.map(contextManifestEntryKey));
    setExcluded((current) => new Set(Array.from(current).filter((key) => currentKeys.has(key))));
    setPlan(result.data);
    setState("idle");
    completedCorrelationRef.current = expectedCorrelation;
    publishReady(true);
  }, [mode, pinnedFingerprint, projectId, publishReady, query, settings.baseUrl, settings.token, runtimeAccess]);

  const refresh = useCallback(() => runPlanning(true), [runPlanning]);

  useEffect(() => {
    setModeState((current) => current.projectId === projectId ? current : { projectId, mode: "balanced" });
  }, [projectId]);

  useLayoutEffect(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    completedCorrelationRef.current = "";
    setPlan(null);
    setExcluded(new Set());
    setPinned([]);
    setState("idle");
    selectionCallbackRef.current?.(null);
    publishReady(!query || mode === "manual_only");
  }, [publishReady, scopeIdentity]);

  const planningTrigger = JSON.stringify({ chatId, generationKey });
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void runPlanning(false), projectContextPlanningDebounceMs);
    return () => {
      window.clearTimeout(timer);
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, [enabled, planningTrigger, runPlanning]);

  useEffect(() => () => {
    requestRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const view = useMemo(() => plan ? buildContextManifestView(plan, excluded) : null, [excluded, plan]);
  const selection = useMemo<ProjectContextPlanningSelection | null>(() => plan ? {
    planId: plan.planId,
    manifestId: plan.manifest.manifestId,
    mode,
    expectedInventoryGeneration: plan.manifest.inventoryGeneration,
    expectedProjectRevision: revisionRef.current,
    queryHash: plan.manifest.queryHash,
    rankingVersion: plan.manifest.rankingVersion,
    budget: projectContextPlanningBudget,
    explicitRefs: pinned,
    excludedSources,
    correlation: { projectId, chatId, settingsGeneration: generationKey, controlFingerprint },
  } : null, [chatId, controlFingerprint, excludedSources, generationKey, mode, pinned, plan, projectId]);

  useEffect(() => {
    selectionCallbackRef.current?.(selection);
  }, [selection]);

  const setMode = useCallback((nextMode: ProjectContextMode) => {
    if (nextMode === mode) return;
    invalidate();
    setModeState({ projectId, mode: nextMode });
    if (nextMode === "manual_only") publishReady(true);
  }, [invalidate, mode, projectId, publishReady]);

  const pin = useCallback((key: string) => {
    const entry = plan?.manifest.entries.find((item) => contextManifestEntryKey(item) === key);
    const ref = entry ? manifestEntryToExplicitRef(entry) : null;
    if (!ref) return;
    invalidate();
    setPinned((current) => current.some((item) => JSON.stringify(item) === JSON.stringify(ref)) ? current : [...current, ref]);
  }, [invalidate, plan]);

  const exclude = useCallback((key: string) => {
    if (!plan?.manifest.entries.some((item) => contextManifestEntryKey(item) === key)) return;
    invalidate(false);
    setExcluded((current) => new Set(current).add(key));
    publishReady(true);
  }, [invalidate, plan, publishReady]);

  const useManualFallback = useCallback(() => setMode("manual_only"), [setMode]);

  const cancel = useCallback(() => {
    if (state !== "loading") return;
    requestRef.current += 1;
    abortRef.current?.abort();
    completedCorrelationRef.current = "";
    setPlan(null);
    setState("stopped");
    selectionCallbackRef.current?.(null);
    publishReady(!query || mode === "manual_only");
  }, [mode, publishReady, query, state]);

  return { mode, plan, view, state, loading: state === "loading", error: state === "error", ready, selection, excluded, pinned, setMode, refresh, invalidate, pin, exclude, useManualFallback, cancel };
}
