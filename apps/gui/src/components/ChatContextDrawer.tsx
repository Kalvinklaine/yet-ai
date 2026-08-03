import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createProjectRuntimeSettings, getProject } from "../services/projectClient";
import { getProjectContextStatus, planProjectContext, type ProjectContextExplicitRef, type ProjectContextMode, type ProjectContextPlan } from "../services/projectContextClient";
import { buildContextManifestView, contextManifestEntryKey, manifestEntryToExplicitRef, manifestMatchesCorrelation } from "../services/contextManifestView";
import type { ProjectContextPlanningSelection, RuntimeSettings } from "../services/runtimeClient";

const budget = { maxFiles: 12, maxChunks: 32, maxBytes: 131072, maxEstimatedTokens: 24000 };

export function ChatContextDrawer({ projectId, chatId, draft, settings, generationKey, onSelectionChange, onReadyChange }: { projectId: string; chatId: string | null; draft: string; settings: RuntimeSettings; generationKey: string; onSelectionChange?: (selection: ProjectContextPlanningSelection | null) => void; onReadyChange?: (ready: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ProjectContextMode>("balanced");
  const [plan, setPlan] = useState<ProjectContextPlan | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<ProjectContextExplicitRef[]>([]);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const revisionRef = useRef("");
  const includedRanks = plan?.manifest.entries.filter((entry) => !excluded.has(contextManifestEntryKey(entry))).map((entry) => entry.rank) ?? [];
  const excludedRanks = plan?.manifest.entries.filter((entry) => excluded.has(contextManifestEntryKey(entry))).map((entry) => entry.rank) ?? [];
  const controlFingerprint = JSON.stringify({ excludedRanks, explicitRefs: pinned, includedRanks, mode });
  const controlIdentity = JSON.stringify({ mode, explicitRefs: pinned, excludedKeys: Array.from(excluded).sort() });
  const correlation = `${projectId}:${chatId ?? "draft"}:${draft}:${generationKey}:${controlIdentity}`;
  const correlationRef = useRef(correlation);
  correlationRef.current = correlation;

  const refresh = useCallback(async () => {
    const query = draft.trim();
    abortRef.current?.abort();
    if (!query) { setPlan(null); setState("idle"); onSelectionChange?.(null); return; }
    const request = ++requestRef.current;
    const expectedCorrelation = correlationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const scoped = createProjectRuntimeSettings(settings, projectId, { generation: request, abortSignal: controller.signal });
    setState("loading");
    setPlan(null);
    onSelectionChange?.(null);
    const [projectResult, statusResult] = await Promise.all([getProject(settings, projectId, controller.signal), getProjectContextStatus(scoped)]);
    if (request !== requestRef.current || expectedCorrelation !== correlationRef.current || !projectResult.ok || !statusResult.ok) { if (request === requestRef.current) { setPlan(null); setState("error"); onSelectionChange?.(null); onReadyChange?.(true); } return; }
    revisionRef.current = projectResult.data.revision;
    const result = await planProjectContext(scoped, { query, mode, budget, explicitRefs: pinned, expectedInventoryGeneration: statusResult.data.inventoryGeneration, expectedProjectRevision: projectResult.data.revision });
    if (request !== requestRef.current || expectedCorrelation !== correlationRef.current) return;
    if (!result.ok || !manifestMatchesCorrelation(result.data.manifest, projectId, statusResult.data.inventoryGeneration)) { setPlan(null); setState("error"); onSelectionChange?.(null); onReadyChange?.(true); return; }
    setPlan(result.data);
    setState("idle");
  }, [draft, mode, onReadyChange, onSelectionChange, pinned, projectId, settings]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 350);
    return () => { window.clearTimeout(timer); requestRef.current += 1; abortRef.current?.abort(); };
  }, [chatId, draft, generationKey, mode, projectId, refresh]);

  useEffect(() => { setPlan(null); setExcluded(new Set()); setPinned([]); }, [chatId, generationKey, projectId]);

  const view = useMemo(() => plan ? buildContextManifestView(plan, excluded) : null, [excluded, plan]);
  useEffect(() => {
    if (!plan) { onSelectionChange?.(null); return; }
    onSelectionChange?.({
      planId: plan.planId,
      manifestId: plan.manifest.manifestId,
      mode,
      expectedInventoryGeneration: plan.manifest.inventoryGeneration,
      expectedProjectRevision: revisionRef.current,
      queryHash: plan.manifest.queryHash,
      rankingVersion: plan.manifest.rankingVersion,
      budget,
      explicitRefs: pinned,
      includedRanks,
      excludedRanks,
      correlation: { projectId, chatId, settingsGeneration: generationKey, controlFingerprint },
    });
    onReadyChange?.(true);
  }, [chatId, controlFingerprint, draft, generationKey, mode, onReadyChange, onSelectionChange, plan, projectId]);
  const invalidate = (clearPlan = true) => {
    requestRef.current += 1;
    abortRef.current?.abort();
    if (clearPlan) { setPlan(null); setState("loading"); }
    onSelectionChange?.(null);
    onReadyChange?.(false);
  };
  const pin = (key: string) => {
    const entry = plan?.manifest.entries.find((item) => contextManifestEntryKey(item) === key);
    const ref = entry ? manifestEntryToExplicitRef(entry) : null;
    if (ref) { invalidate(); setPinned((current) => current.some((item) => JSON.stringify(item) === JSON.stringify(ref)) ? current : [...current, ref]); }
  };

  return <section className="composer-tool-drawer" aria-label="Context for this message" data-testid="chat-context-drawer">
    <button type="button" aria-expanded={open} aria-controls="chat-context-drawer-panel" onClick={() => setOpen((value) => !value)}>Context for this message</button>
    {open && <div id="chat-context-drawer-panel" className="composer-drawer-body stack" role="region" aria-live="polite">
      <label>Context mode<select aria-label="Context mode" value={mode} onChange={(event) => { invalidate(); setMode(event.target.value as ProjectContextMode); }}><option value="manual_only">Minimal (manual only)</option><option value="balanced">Balanced</option><option value="deep">Deep</option></select></label>
      <div className="row"><button type="button" onClick={() => void refresh()} disabled={!draft.trim() || state === "loading"}>{state === "loading" ? "Refreshing context…" : "Refresh context"}</button><button type="button" onClick={() => { invalidate(); setMode("manual_only"); }}>Send with manual-only</button></div>
      <span className="subtle">Preview is metadata-only and uses the same vocabulary in browser, VS Code, and JetBrains. The local engine remains context authority.</span>
      {!draft.trim() && <span>Type a message to preview its planned context.</span>}
      {state === "error" && <span className="error">Context plan is unavailable or no longer matches this project, chat, draft, or generation.</span>}
      {view && <>
        <div className="row"><strong>Included</strong><span className="badge">{view.included.length}</span><span>{view.budget}</span></div>
        <ul>{view.included.map((item) => <li key={item.key}><strong>{item.label}</strong>{item.range && <span> · {item.range}</span>}{item.symbol && <span> · symbol {item.symbol}</span>}<span> · {item.reason} · {item.provenance} · {item.redaction}</span><div className="row"><button type="button" onClick={() => { invalidate(false); setExcluded((current) => new Set(current).add(item.key)); }}>Remove</button><button type="button" onClick={() => pin(item.key)}>Pin explicit item</button></div></li>)}</ul>
        <div className="row"><strong>Omitted</strong><span className="badge">{view.omitted.length}</span></div>
        <ul>{view.omitted.map((item) => <li key={item.key}>{item.label} · {item.reason} · {item.provenance}</li>)}</ul>
        {view.warnings.map((warning) => <span className="error" key={warning}>{warning}</span>)}
      </>}
    </div>}
  </section>;
}
