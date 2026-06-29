import { useMemo, useState } from "react";
import { createMultiStepTaskTimeline, type MultiStepTaskTimeline, type MultiStepTaskTimelineInput, type MultiStepTaskTimelineItem } from "../services/multiStepTaskTimeline";
import { sanitizeDisplayText } from "../services/redaction";

export type MultiStepTaskTimelinePanelProps = {
  input?: MultiStepTaskTimelineInput;
  timeline?: MultiStepTaskTimeline;
};

const groupOrder: Array<{ label: string; families: MultiStepTaskTimelineItem["family"][] }> = [
  { label: "Goal and context", families: ["task.goal", "context.attachment", "fileRead.evidence", "command.evidence", "memory.attachment"] },
  { label: "Review and apply", families: ["plan.preview", "proposal.review", "apply.request", "apply.result"] },
  { label: "Verification", families: ["verification.request", "verification.progress", "verification.result"] },
  { label: "Follow-up and final", families: ["checkpoint.decision", "followup.draft", "final.result"] },
];

export function MultiStepTaskTimelinePanel({ input, timeline: providedTimeline }: MultiStepTaskTimelinePanelProps) {
  const [open, setOpen] = useState(false);
  const timeline = useMemo(() => providedTimeline ?? createMultiStepTaskTimeline(input ?? {}), [input, providedTimeline]);
  const latest = timeline.items[timeline.items.length - 1];
  const latestStatus = latest ? latest.status.replace(/_/g, " ") : "empty";
  const grouped = groupTimelineItems(timeline.items);

  return (
    <section className="readiness-card warn multi-step-task-timeline-panel stack" aria-label="Multi-step task timeline" data-testid="multi-step-task-timeline-panel">
      <details className="debug-details" data-testid="multi-step-task-timeline-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2>Manual timeline</h2>
          <span className="badge">metadata only</span>
          <span className="badge warn">no automatic execution</span>
          <span className="badge">{timeline.items.length} step{timeline.items.length === 1 ? "" : "s"}</span>
          <span className={latest?.status === "succeeded" ? "badge ok" : latest?.status === "failed" || latest?.status === "rejected" || latest?.status === "blocked" ? "badge warn" : "badge"}>latest {sanitizeDisplayText(latestStatus)}</span>
        </summary>
        {open && (
          <div className="stack">
            <p className="subtle">Read-only manual timeline: metadata only, no automatic execution, no Send, apply, verification, attach, search, save, repair, retry, rollback, provider call, file read, file write, shell, or browser storage.</p>
            {timeline.items.length === 0 ? <TimelineEmptyState /> : (
              <div className="stack" role="list" aria-label="Manual timeline metadata groups">
                {grouped.map((group) => <TimelineGroup key={group.label} label={group.label} items={group.items} />)}
              </div>
            )}
            {timeline.diagnostics.length > 0 && (
              <div className="readiness-card warn" role="status" aria-label="Manual timeline diagnostics">
                <strong>Sanitized diagnostics</strong>
                {timeline.diagnostics.map((diagnostic) => <span key={diagnostic}>{sanitizeDisplayText(diagnostic)}</span>)}
              </div>
            )}
            <span className="subtle">Policy: {timeline.policy.authority} · display only {String(timeline.policy.displayOnly)} · auto send {String(timeline.policy.canAutoSend)} · auto apply {String(timeline.policy.canAutoApply)} · auto verification {String(timeline.policy.canAutoRunVerification)}</span>
          </div>
        )}
      </details>
    </section>
  );
}

function TimelineEmptyState() {
  return (
    <div className="readiness-card warn" role="status">
      <strong>No manual timeline metadata yet</strong>
      <span>Start with a local task goal, explicit context, a manually reviewed proposal, apply result, verification result, follow-up draft, or final status. This panel stays read-only.</span>
    </div>
  );
}

function TimelineGroup({ label, items }: { label: string; items: MultiStepTaskTimelineItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="readiness-card ready stack" aria-label={`Manual timeline ${label}`} role="listitem">
      <div className="row">
        <strong>{label}</strong>
        <span className="badge">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      <ol className="manual-runner-steps" aria-label={`${label} events`}>
        {items.map((item, index) => <TimelineItemView key={item.id} item={item} index={index} />)}
      </ol>
    </section>
  );
}

function TimelineItemView({ item, index }: { item: MultiStepTaskTimelineItem; index: number }) {
  const status = sanitizeDisplayText(item.status.replace(/_/g, " "));
  return (
    <li className={`manual-runner-step ${item.status === "succeeded" ? "done" : item.status === "pending" || item.status === "in_progress" ? "current" : "waiting"}`}>
      <div className="row">
        <strong>{index + 1}. {sanitizeDisplayText(item.title)}</strong>
        <span className="badge">{sanitizeDisplayText(item.family.replace(/\./g, " · "))}</span>
        <span className={item.status === "failed" || item.status === "rejected" || item.status === "blocked" ? "badge warn" : item.status === "succeeded" ? "badge ok" : "badge"}>{status}</span>
      </div>
      <span>{sanitizeDisplayText(item.summary)}</span>
      {(item.timestamp || item.requestId) && <span className="subtle">{item.timestamp ? sanitizeDisplayText(item.timestamp) : "no timestamp"}{item.requestId ? ` · request ${sanitizeDisplayText(item.requestId)}` : ""}</span>}
      {item.labels && item.labels.length > 0 && <span className="subtle">Labels: {item.labels.map((label) => sanitizeDisplayText(label)).join(" · ")}</span>}
    </li>
  );
}

function groupTimelineItems(items: MultiStepTaskTimelineItem[]): Array<{ label: string; items: MultiStepTaskTimelineItem[] }> {
  const remaining = new Set(items);
  const groups = groupOrder.map((group) => {
    const groupItems = items.filter((item) => group.families.includes(item.family));
    groupItems.forEach((item) => remaining.delete(item));
    return { label: group.label, items: groupItems };
  });
  const otherItems = Array.from(remaining);
  return otherItems.length > 0 ? [...groups, { label: "Other metadata", items: otherItems }] : groups;
}
