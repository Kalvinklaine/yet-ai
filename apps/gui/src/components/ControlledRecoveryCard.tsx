import type { ControlledRecoveryPresentation } from "../services/controlledRecoveryPresentation";

export function ControlledRecoveryCard({ title, presentation }: { title: string; presentation: ControlledRecoveryPresentation }) {
  return (
    <section className="readiness-card warn stack" role="status" aria-label={title}>
      <div className="row">
        <strong>{title}</strong>
        <span className="badge">display only</span>
        <span className="badge">manual recovery</span>
        <span className="badge">no auto retry/rollback/repair</span>
        <span className="badge warn">{presentation.provenanceLabel}</span>
      </div>
      <span>Visible, bounded, sanitized, manual recovery guidance. Browser remains unsupported; JetBrains remains partial/fail-closed.</span>
      <div className="agent-progress-grid" aria-label={`${title} authority`}>
        <span>Execution allowed: false</span>
        <span>Workspace mutation: false</span>
        <span>Provider calls: false</span>
        <span>Commands/tools/git/network: false</span>
        <span>Raw output/private paths/secrets persisted: false</span>
      </div>
      {presentation.items.map((item) => (
        <div className="stack" key={item.key}>
          <span><strong>{item.label}</strong>: {item.guidance}</span>
          <span className="subtle">{item.retryBudgetLabel}</span>
          {item.state === "blocked" && <span className="subtle">Blocked unsafe recovery metadata. {item.diagnosticLabels.join(" · ")}</span>}
        </div>
      ))}
      <span className="subtle">No automatic retry, rollback, repair, apply, verification, provider call, hidden read, storage write, command, git, tool, network, or workspace mutation is available from this guidance.</span>
    </section>
  );
}
