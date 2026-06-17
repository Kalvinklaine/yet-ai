import { runtimeFetch, type RuntimeResult, type RuntimeSettings } from "./runtimeClient";

export type ProjectMemoryNote = {
  id: string;
  title: string;
  text: string;
  tags: string[];
  source: "manual";
  createdAt: string;
  updatedAt: string;
};

export type ProjectMemoryListResponse = {
  notes: ProjectMemoryNote[];
  cloudRequired?: false;
  providerAccess?: "direct";
};

export type ProjectMemorySearchResponse = ProjectMemoryListResponse & {
  query?: string;
};

export type ProjectMemoryCreateRequest = {
  title: string;
  text: string;
  tags: string[];
  source: "manual";
};

export function listProjectMemory(settings: RuntimeSettings): Promise<RuntimeResult<ProjectMemoryListResponse>> {
  return runtimeFetch<ProjectMemoryListResponse>(settings, "/v1/project-memory");
}

export function createProjectMemory(settings: RuntimeSettings, request: ProjectMemoryCreateRequest): Promise<RuntimeResult<ProjectMemoryNote>> {
  return runtimeFetch<ProjectMemoryNote>(settings, "/v1/project-memory", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function searchProjectMemory(settings: RuntimeSettings, query: string): Promise<RuntimeResult<ProjectMemorySearchResponse>> {
  return runtimeFetch<ProjectMemorySearchResponse>(settings, "/v1/project-memory/search", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

export function deleteProjectMemory(settings: RuntimeSettings, noteId: string): Promise<RuntimeResult<{ deleted: boolean; noteId: string }>> {
  return runtimeFetch<{ deleted: boolean; noteId: string }>(settings, `/v1/project-memory/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
}
