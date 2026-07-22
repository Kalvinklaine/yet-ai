import type { ProjectId } from "./projectRouting";

export const projectBoundStateFamilies = [
  "active_chat",
  "active_editor_context",
  "workspace_search",
  "project_memory",
  "task_drafts",
  "proposals",
  "bridge_correlations",
  "controlled_run",
  "recovery_followup",
] as const;

export type ProjectBoundStateFamily = typeof projectBoundStateFamilies[number];

export type ProjectScopeSnapshot = {
  readonly projectId: ProjectId | undefined;
  readonly generation: number;
  readonly abortSignal: AbortSignal;
};

export type ProjectScopeCorrelation = Pick<ProjectScopeSnapshot, "projectId" | "generation">;

export type ProjectScopeResetters = Record<ProjectBoundStateFamily, () => void>;

export function createProjectScopeCorrelation(scope: ProjectScopeSnapshot): ProjectScopeCorrelation {
  return { projectId: scope.projectId, generation: scope.generation };
}

export function projectScopeMatches(current: ProjectScopeCorrelation, candidate: ProjectScopeCorrelation): boolean {
  return current.projectId === candidate.projectId && current.generation === candidate.generation;
}

export function resetProjectBoundState(resetters: ProjectScopeResetters): void {
  for (const family of projectBoundStateFamilies) {
    resetters[family]();
  }
}

export class ProjectScopeController {
  private projectId: ProjectId | undefined;
  private generation = 0;
  private controller = new AbortController();
  private cancellations = new Set<() => void>();

  constructor(projectId?: ProjectId) {
    this.projectId = projectId;
  }

  current(): ProjectScopeSnapshot {
    return {
      projectId: this.projectId,
      generation: this.generation,
      abortSignal: this.controller.signal,
    };
  }

  transition(projectId: ProjectId | undefined, resetters: ProjectScopeResetters): boolean {
    if (projectId === this.projectId) {
      return false;
    }
    this.invalidate();
    this.projectId = projectId;
    resetProjectBoundState(resetters);
    return true;
  }

  dispose(resetters?: ProjectScopeResetters): void {
    this.invalidate();
    if (resetters) {
      resetProjectBoundState(resetters);
    }
  }

  registerCancellation(cancel: () => void): () => void {
    const generation = this.generation;
    this.cancellations.add(cancel);
    return () => {
      if (generation === this.generation) {
        this.cancellations.delete(cancel);
      }
    };
  }

  accepts(candidate: ProjectScopeCorrelation): boolean {
    return projectScopeMatches(this.current(), candidate);
  }

  private invalidate(): void {
    const cancellations = this.cancellations;
    this.cancellations = new Set();
    this.controller.abort();
    this.generation += 1;
    this.controller = new AbortController();
    for (const cancel of cancellations) {
      cancel();
    }
  }
}
