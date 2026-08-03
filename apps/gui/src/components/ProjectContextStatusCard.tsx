import type { ProjectContextProfile, ProjectContextStatus } from "../services/projectContextClient";

export type ProjectContextCardModel =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: ProjectContextStatus; profile: ProjectContextProfile | null };

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
      {profile ? <>
        <p>{profile.summary}</p>
        <div className="project-context-facts">{groups.map(([title, items]) => <section key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((item) => <li key={`${item.kind}:${item.sourceRef}`}><strong>{item.label}</strong><code>{item.sourceRef}</code><span>{item.provenance === "structural_inventory" ? "Structural inventory" : "Manifest convention"}</span></li>)}</ul> : <p className="subtle">None detected.</p>}</section>)}</div>
      </> : <p className="subtle">No completed profile is available yet.</p>}
      {rebuildError && <p role="alert">{rebuildError}</p>}
    </section>
  );
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
