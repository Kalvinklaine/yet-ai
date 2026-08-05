import { useState } from "react";
import type { ProjectContextMode } from "../services/projectContextClient";
import type { ProjectContextPlanningSelection, RuntimeSettings } from "../services/runtimeClient";
import { useProjectContextPlanning } from "../services/useProjectContextPlanning";

export function ChatContextDrawer({ projectId, chatId, draft, settings, generationKey, onSelectionChange, onReadyChange }: { projectId: string; chatId: string | null; draft: string; settings: RuntimeSettings; generationKey: string; onSelectionChange?: (selection: ProjectContextPlanningSelection | null) => void; onReadyChange?: (ready: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const planning = useProjectContextPlanning({ projectId, chatId, draft, settings, generationKey, onSelectionChange, onReadyChange });

  return <section className="composer-tool-drawer" aria-label="Context for this message" data-testid="chat-context-drawer">
    <button type="button" aria-expanded={open} aria-controls="chat-context-drawer-panel" onClick={() => setOpen((value) => !value)}>Context for this message</button>
    {open && <div id="chat-context-drawer-panel" className="composer-drawer-body stack" role="region" aria-live="polite">
      <label>Context mode<select aria-label="Context mode" value={planning.mode} onChange={(event) => planning.setMode(event.target.value as ProjectContextMode)}><option value="manual_only">Minimal (manual only)</option><option value="balanced">Balanced</option><option value="deep">Deep</option></select></label>
      <div className="row"><button type="button" onClick={() => void planning.refresh()} disabled={!draft.trim() || planning.loading}>{planning.loading ? "Refreshing context…" : "Refresh context"}</button><button type="button" onClick={planning.useManualFallback}>Send with manual-only</button></div>
      <span className="subtle">Preview is metadata-only and uses the same vocabulary in browser, VS Code, and JetBrains. The local engine remains context authority.</span>
      {!draft.trim() && <span>Type a message to preview its planned context.</span>}
      {planning.error && <span className="error">Context plan is unavailable or no longer matches this project, chat, draft, or generation.</span>}
      {planning.view && <>
        <div className="row"><strong>Included</strong><span className="badge">{planning.view.included.length}</span><span>{planning.view.budget}</span></div>
        <ul>{planning.view.included.map((item) => <li key={item.key}><strong>{item.label}</strong>{item.range && <span> · {item.range}</span>}{item.symbol && <span> · symbol {item.symbol}</span>}<span> · {item.reason} · {item.provenance} · {item.redaction}</span><div className="row"><button type="button" onClick={() => planning.exclude(item.key)}>Remove</button><button type="button" onClick={() => planning.pin(item.key)}>Pin explicit item</button></div></li>)}</ul>
        <div className="row"><strong>Omitted</strong><span className="badge">{planning.view.omitted.length}</span></div>
        <ul>{planning.view.omitted.map((item) => <li key={item.key}>{item.label} · {item.reason} · {item.provenance}</li>)}</ul>
        {planning.view.warnings.map((warning) => <span className="error" key={warning}>{warning}</span>)}
      </>}
    </div>}
  </section>;
}
