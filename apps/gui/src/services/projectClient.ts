import { runtimeFetch, type RuntimeResult, type RuntimeSettings } from "./runtimeClient";
import { parseProjectId, type ProjectId } from "./projectRouting";
import type { ProjectScopeSnapshot } from "./projectScope";

export type ProjectScope = ProjectScopeSnapshot & { readonly projectId: ProjectId };

export type ProjectRuntimeSettings = RuntimeSettings & {
  readonly projectScope: ProjectScope;
  readonly apiBase: `/p/${ProjectId}/v1`;
};

export type ProjectSummary = {
  projectId: ProjectId;
  displayName: string;
  status: "available" | "missing" | "archived";
  revision: string;
  createdAt: string;
  lastOpenedAt: string | null;
  rootAvailable: boolean;
  cloudRequired: false;
  providerAccess: "direct";
};

export type ProjectListResponse = {
  projects: ProjectSummary[];
  legacyUnscopedAvailable: boolean;
  cloudRequired: false;
  providerAccess: "direct";
};

export type DirectoryEntry = { handle: string; displayName: string; selectable: boolean };
export type DirectoryDiscoverySessionResponse = {
  sessionId: string;
  expiresAt: string;
  root: DirectoryEntry;
  cloudRequired: false;
  providerAccess: "direct";
};
export type DirectoryDiscoveryListResponse = {
  sessionId: string;
  directoryHandle: string;
  expiresAt: string;
  entries: DirectoryEntry[];
  cloudRequired: false;
  providerAccess: "direct";
};
export type ProjectLifecycleResponse = {
  projectId: ProjectId;
  status: ProjectSummary["status"];
  revision: string;
  rootAvailable: boolean;
  updatedAt: string;
};

export function createProjectScope(projectId: string, generation = 0, abortSignal = new AbortController().signal): ProjectScope {
  const validated = parseProjectId(projectId);
  if (!validated) throw new TypeError("Invalid project id.");
  return Object.freeze({ projectId: validated, generation, abortSignal });
}

export function createProjectRuntimeSettings(globalSettings: RuntimeSettings, projectId: string, lifecycle?: Pick<ProjectScopeSnapshot, "generation" | "abortSignal">): ProjectRuntimeSettings {
  const projectScope = createProjectScope(projectId, lifecycle?.generation, lifecycle?.abortSignal);
  return Object.freeze({
    ...globalSettings,
    projectScope,
    apiBase: `/p/${projectScope.projectId}/v1`,
  });
}

export function listProjects(settings: RuntimeSettings, signal?: AbortSignal): Promise<RuntimeResult<ProjectListResponse>> {
  return runtimeFetch<ProjectListResponse>(settings, "/v1/projects", { signal });
}

export function getProject(settings: RuntimeSettings, projectId: string, signal?: AbortSignal): Promise<RuntimeResult<ProjectSummary>> {
  return runtimeFetch<ProjectSummary>(settings, `/v1/projects/${requiredProjectId(projectId)}`, { signal });
}

export function registerProject(settings: RuntimeSettings, request: { displayName: string; directorySessionId: string; directoryHandle: string }): Promise<RuntimeResult<ProjectSummary>> {
  return runtimeFetch<ProjectSummary>(settings, "/v1/projects", { method: "POST", body: JSON.stringify(request) });
}

export function updateProject(settings: RuntimeSettings, projectId: string, request: { displayName: string; expectedRevision: string }): Promise<RuntimeResult<ProjectSummary>> {
  return runtimeFetch<ProjectSummary>(settings, `/v1/projects/${requiredProjectId(projectId)}`, { method: "PATCH", body: JSON.stringify(request) });
}

export function archiveProject(settings: RuntimeSettings, projectId: string, expectedRevision: string): Promise<RuntimeResult<ProjectLifecycleResponse>> {
  return projectLifecycle(settings, projectId, "archive", expectedRevision);
}

export function restoreProject(settings: RuntimeSettings, projectId: string, expectedRevision: string): Promise<RuntimeResult<ProjectLifecycleResponse>> {
  return projectLifecycle(settings, projectId, "restore", expectedRevision);
}

export function startDirectoryDiscovery(settings: RuntimeSettings): Promise<RuntimeResult<DirectoryDiscoverySessionResponse>> {
  return runtimeFetch<DirectoryDiscoverySessionResponse>(settings, "/v1/project-browser/sessions", { method: "POST", body: JSON.stringify({}) });
}

export function listDirectoryDiscovery(settings: RuntimeSettings, sessionId: string, directoryHandle: string): Promise<RuntimeResult<DirectoryDiscoveryListResponse>> {
  return runtimeFetch<DirectoryDiscoveryListResponse>(settings, `/v1/project-browser/sessions/${encodeURIComponent(sessionId)}/list`, {
    method: "POST",
    body: JSON.stringify({ directoryHandle }),
  });
}

function projectLifecycle(settings: RuntimeSettings, projectId: string, action: "archive" | "restore", expectedRevision: string) {
  return runtimeFetch<ProjectLifecycleResponse>(settings, `/v1/projects/${requiredProjectId(projectId)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision }),
  });
}

function requiredProjectId(projectId: string): ProjectId {
  const validated = parseProjectId(projectId);
  if (!validated) throw new TypeError("Invalid project id.");
  return validated;
}
