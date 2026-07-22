import type { ProjectSummary } from "../services/projectClient";
import { ProjectLink, type ProjectNavigation } from "../services/projectRouting";

export function ProjectHome({ project, navigate }: { project: ProjectSummary; navigate: ProjectNavigation }) {
  const ready = project.status === "available" && project.rootAvailable;
  return (
    <section className="project-home stack" aria-labelledby="project-home-title">
      <div className="project-home-welcome">
        <div className="stack"><span className="badge ok">project home</span><h1 id="project-home-title">Welcome to {project.displayName}</h1><p>This is the safe local overview for this project. Open a workspace surface when you are ready; no scan or agent starts automatically.</p></div>
        <span className={`status-label ${ready ? "ready" : "blocked"}`}>{ready ? "Ready for local work" : "Needs attention"}</span>
      </div>
      <div className="project-summary-grid" aria-label="Project summary">
        <article><strong>Readiness</strong><span>{ready ? "Local context available" : "Local context unavailable"}</span></article>
        <article><strong>Recent activity</strong><span>{project.lastOpenedAt ? "Previously opened" : "No activity yet"}</span></article>
        <article><strong>Last opened</strong><span>{formatTime(project.lastOpenedAt)}</span></article>
      </div>
      <div className="project-home-actions">
        <ProjectLink className="project-action-card" route={{ kind: "project", projectId: project.projectId, page: "chat" }} navigate={navigate}><strong>Chat</strong><span>Continue project conversations</span></ProjectLink>
        <ProjectLink className="project-action-card" route={{ kind: "project", projectId: project.projectId, page: "memory" }} navigate={navigate}><strong>Memory</strong><span>Review curated local notes</span></ProjectLink>
        <ProjectLink className="project-action-card" route={{ kind: "project", projectId: project.projectId, page: "agent" }} navigate={navigate}><strong>Agent</strong><span>Review controlled project work</span></ProjectLink>
      </div>
    </section>
  );
}

function formatTime(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : date.toLocaleString();
}
