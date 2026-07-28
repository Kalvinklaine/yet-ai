import { useState } from "react";
import type { ProjectSummary } from "../services/projectClient";
import type { ProjectCommandCenterModel } from "../services/projectCommandCenterData";
import { ProjectLink, type ProjectNavigation } from "../services/projectRouting";
import { createProjectChatLaunchIntent, getBrowserProjectChatLifecycleGeneration } from "../services/projectChatLaunchIntent";
import { ProjectCommandCenter } from "./ProjectCommandCenter";

export function ProjectHome({ project, model, navigate }: { project: ProjectSummary; model: ProjectCommandCenterModel; navigate: ProjectNavigation }) {
  const [selectedMemoryNoteIds, setSelectedMemoryNoteIds] = useState<string[]>([]);
  const projectRoute = (page: "chat" | "memory" | "agent") => ({ kind: "project" as const, projectId: project.projectId, page });
  const openChat = (chatId?: string) => {
    createProjectChatLaunchIntent({
      projectId: project.projectId,
      ...(chatId ? { chatId } : {}),
      source: "project_home",
      selectedNoteIds: selectedMemoryNoteIds,
      lifecycleGeneration: getBrowserProjectChatLifecycleGeneration(),
    });
    navigate({ ...projectRoute("chat"), ...(chatId ? { chatId } : {}) });
  };

  return (
    <section className="project-home stack" aria-label={`${project.displayName} project home`}>
      <ProjectCommandCenter
        title={`${project.displayName} command center`}
        model={model}
        selectedMemoryNoteIds={selectedMemoryNoteIds}
        onStart={() => openChat()}
        onResume={openChat}
        onMemorySelectionChange={setSelectedMemoryNoteIds}
        onNavigateActiveWork={() => navigate(projectRoute("agent"))}
      />
      <nav className="project-home-actions" aria-label="Project command center destinations">
        <ProjectLink className="project-action-card" route={projectRoute("chat")} navigate={navigate}><strong>Chat</strong><span>Open the project chat without sending anything</span></ProjectLink>
        <ProjectLink className="project-action-card" route={projectRoute("memory")} navigate={navigate}><strong>Memory</strong><span>Review or select curated local notes</span></ProjectLink>
        <ProjectLink className="project-action-card" route={projectRoute("agent")} navigate={navigate}><strong>Agent</strong><span>Review project work and progress</span></ProjectLink>
      </nav>
    </section>
  );
}
