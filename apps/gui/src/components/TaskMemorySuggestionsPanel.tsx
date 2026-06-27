import type { ProjectMemoryNote } from "../services/projectMemoryClient";
import { sanitizeDisplayText } from "../services/redaction";
import type { TaskMemorySuggestion, TaskMemorySuggestionSummary } from "../services/taskMemorySuggestions";

export function TaskMemorySuggestionsPanel({ summary, notes, onAttach }: { summary: TaskMemorySuggestionSummary; notes: readonly ProjectMemoryNote[]; onAttach: (note: ProjectMemoryNote, suggestion: TaskMemorySuggestion) => void }) {
  const counts = summary.counts;
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const hasActionableSuggestions = summary.suggestions.some((suggestion) => suggestion.status === "suggested");
  return (
    <section className={`readiness-card ${hasActionableSuggestions ? "ready" : "warn"} task-memory-suggestions-card stack`} role="status" aria-label="Task memory suggestions">
      <div className="row">
        <strong>Task memory suggestions</strong>
        <span className="badge">{summary.authority}</span>
        <span className="badge">attach-only guidance</span>
        <span className="badge">suggested {counts.suggested}</span>
        <span className="badge">stale {counts.stale}</span>
        <span className="badge">unsafe {counts.unsafe}</span>
        <span className="badge">attached {counts.already_attached}</span>
        <span className="badge">unrelated {counts.unrelated}</span>
      </div>
      <span className="subtle">Suggestions are sanitized metadata only. Nothing is auto-attached, searched, saved, sent, or added as hidden context; use Attach only when a safe suggested note looks relevant.</span>
      <div className="agent-progress-grid" aria-label="Task memory suggestion policy">
        <span>Auto attach: {String(summary.policy.canAutoAttachMemory)}</span>
        <span>Runtime calls: {String(summary.policy.canCallRuntime)}</span>
        <span>Provider calls: {String(summary.policy.canCallProvider)}</span>
        <span>Memory body reads: {String(summary.policy.canReadMemoryBodies)}</span>
        <span>Explicit attach only: {String(summary.policy.explicitAttachOnly)}</span>
      </div>
      {summary.suggestions.length === 0 ? <div className="readiness-card warn" role="status"><strong>No task memory suggestions</strong><span>Refresh or search local project memory, then attach any note explicitly if needed.</span></div> : summary.suggestions.map((suggestion) => {
        const note = notesById.get(suggestion.noteId);
        const attachable = suggestion.canAttachExplicitly && note !== undefined;
        return (
          <div className={`provider-item stack ${suggestion.status === "suggested" ? "ready" : suggestion.status === "unsafe" || suggestion.status === "stale" ? "warn" : ""}`} key={suggestion.noteId}>
            <div className="row">
              <strong>{suggestion.titleLabel}</strong>
              <span className={`badge ${suggestion.status === "suggested" || suggestion.status === "already_attached" ? "ok" : suggestion.status === "unsafe" || suggestion.status === "stale" ? "warn" : ""}`}>{statusLabel(suggestion.status)}</span>
              <span className="badge">note {sanitizeDisplayText(suggestion.noteId)}</span>
            </div>
            <ul className="first-message-steps" aria-label={`Task memory suggestion reasons for ${suggestion.titleLabel}`}>
              {suggestion.reasonLabels.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            {suggestion.warnings.length > 0 && <div className="readiness-card warn" role="status"><strong>Manual review required</strong><ul className="first-message-steps">{suggestion.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
            {suggestion.status === "already_attached" && <span className="subtle">Already attached to the one-shot bundle. Use the Project Memory or bundle controls to detach before Send.</span>}
            {suggestion.status === "stale" && <span className="subtle">Warning-only suggestion. Review the note in Local project memory before deciding whether to attach it manually.</span>}
            {suggestion.status === "unsafe" && <span className="subtle">Unsafe memory is warning-only and has no primary attach action here.</span>}
            {suggestion.status === "unrelated" && <span className="subtle">No safe metadata overlap was found for this task; attach only from Local project memory after manual review.</span>}
            <div className="row">
              {attachable ? <button type="button" onClick={() => onAttach(note, suggestion)}>Attach suggested memory to next message</button> : <span className="subtle">{attachDisabledCopy(suggestion)}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function statusLabel(status: TaskMemorySuggestion["status"]): string {
  switch (status) {
    case "suggested":
      return "suggested";
    case "already_attached":
      return "already attached";
    case "stale":
      return "stale · review";
    case "unsafe":
      return "unsafe · warning only";
    case "unrelated":
      return "unrelated";
  }
}

function attachDisabledCopy(suggestion: TaskMemorySuggestion): string {
  if (suggestion.status === "already_attached") {
    return "Attached already; detach from Project Memory or the bundle if needed.";
  }
  if (suggestion.status === "stale") {
    return "Review stale memory manually before attaching from Local project memory.";
  }
  if (suggestion.status === "unsafe") {
    return "Unsafe memory cannot be attached from suggestions.";
  }
  if (suggestion.status === "unrelated") {
    return "No suggestion attach action.";
  }
  return "Suggestion cannot be attached.";
}
