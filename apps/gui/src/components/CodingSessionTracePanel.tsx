import { useState } from "react";
import type { CodingSessionTraceEntry } from "../services/codingSessionTrace";
import { sanitizeDisplayText, sanitizeDisplayValue } from "../services/redaction";

export function CodingSessionTracePanel({ entries }: { entries: CodingSessionTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  const visibleEntries = open ? [...entries].reverse() : [];
  return (
    <section className="card stack secondary-card coding-session-trace-card" aria-label="Coding session trace">
      <details className="debug-details" data-testid="coding-session-trace-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary><h2>Coding session trace</h2><span className="badge">{entries.length} entries</span><span className="badge ok">read-only</span></summary>
        {open && (
          <>
            <p className="subtle">Read-only sanitized in-memory trace; no actions, execution, persistence, or auto-run.</p>
            <div className="timeline" aria-label="Coding session trace entries">
              {visibleEntries.length === 0 ? <span>No coding-session trace entries yet.</span> : visibleEntries.map((entry) => <CodingSessionTraceEntryView entry={entry} key={entry.id} />)}
            </div>
          </>
        )}
      </details>
    </section>
  );
}

function CodingSessionTraceEntryView({ entry }: { entry: CodingSessionTraceEntry }) {
  return (
    <article className={`timeline-entry coding-session-trace-entry ${entry.status}`}>
      <div className="row">
        <strong>{sanitizeDisplayText(entry.title)}</strong>
        <span className="badge">{sanitizeDisplayText(entry.family)}</span>
        <span className={entry.status === "failed" || entry.status === "rejected" ? "badge warn" : entry.status === "succeeded" ? "badge ok" : "badge"}>{sanitizeDisplayText(entry.status)}</span>
      </div>
      <span className="subtle">{sanitizeDisplayText(entry.timestamp)}{entry.requestId ? ` · request ${sanitizeDisplayText(entry.requestId)}` : ""}</span>
      {entry.summary && <span>{sanitizeDisplayText(entry.summary)}</span>}
      {entry.details && <pre aria-label="Trace entry sanitized details">{JSON.stringify(sanitizeDisplayValue(entry.details), null, 2)}</pre>}
    </article>
  );
}
