import type { ProjectContextState } from "../services/projectContextClient";

export function ProjectChatContextSetupCard({ state, working, error, onBuild, onStartWithoutContext }: { state: Extract<ProjectContextState, "not_built" | "stale" | "migration_required" | "unavailable">; working: boolean; error: string | null; onBuild: () => void; onStartWithoutContext: () => void }) {
  const rebuild = state !== "not_built";
  return <section className="project-chat-context-setup stack" aria-labelledby="project-chat-context-setup-heading" data-testid="project-chat-context-setup">
    <div className="project-chat-context-setup-heading">
      <div className="stack">
        <strong id="project-chat-context-setup-heading">Prepare project context</strong>
        <span className="subtle">{setupCopy(state)}</span>
      </div>
      <span className="badge warn">setup needed</span>
    </div>
    <div className="project-chat-context-actions">
      <button type="button" onClick={onBuild} disabled={working}>{working ? `${rebuild ? "Rebuilding" : "Building"}…` : `${rebuild ? "Rebuild" : "Build"} project context`}</button>
      <button type="button" className="secondary-button" onClick={onStartWithoutContext}>Start without project context</button>
    </div>
    <span className="subtle">Nothing is built or sent automatically. Starting without project context keeps this prompt manual-only; explicit file and memory attachments stay separate.</span>
    {error && <span className="error" role="alert">{error}</span>}
  </section>;
}

function setupCopy(state: ProjectContextState) {
  switch (state) {
    case "not_built": return "Build the local project cache once for this project, or continue with your prompt only.";
    case "stale": return "The local project cache is stale. Rebuild it before using automatic project context, or continue with your prompt only.";
    case "migration_required": return "The local project cache needs rebuilding for the current format before automatic project context can be used.";
    case "unavailable": return "Project context is unavailable. Rebuild the local cache or continue with your prompt only.";
    default: return "Project context is not ready.";
  }
}
