import { runtimeFetch, type RuntimeResult, type RuntimeSettings } from "./runtimeClient";

export type ProjectMemoryNote = {
  id: string;
  title: string;
  text: string;
  tags: string[];
  source: "manual";
  createdAt: string;
  updatedAt: string;
  taskLabel?: string;
  sessionLabel?: string;
};

export type ProjectMemoryListResponse = {
  notes: ProjectMemoryNote[];
  cloudRequired?: false;
  providerAccess?: "direct";
};

export type ProjectMemorySearchResponse = Omit<ProjectMemoryListResponse, "notes"> & {
  queryLabel?: string;
  matches?: Array<{ note: ProjectMemoryNote; scoreLabel: string }>;
};

export type ProjectMemoryCreateRequest = {
  title: string;
  text: string;
  tags: string[];
  source: "manual";
  taskLabel?: string;
  sessionLabel?: string;
};

export function listProjectMemory(settings: RuntimeSettings): Promise<RuntimeResult<ProjectMemoryListResponse>> {
  return runtimeFetch<ProjectMemoryListResponse>(settings, "/v1/project-memory");
}

export function createProjectMemory(settings: RuntimeSettings, request: ProjectMemoryCreateRequest): Promise<RuntimeResult<ProjectMemoryNote>> {
  return runtimeFetch<ProjectMemoryNote>(settings, "/v1/project-memory", {
    method: "POST",
    body: JSON.stringify({ protocolVersion: "2026-06-17", ...request }),
  });
}

export function searchProjectMemory(settings: RuntimeSettings, query: string): Promise<RuntimeResult<ProjectMemorySearchResponse>> {
  return runtimeFetch<ProjectMemorySearchResponse>(settings, "/v1/project-memory/search", {
    method: "POST",
    body: JSON.stringify({ protocolVersion: "2026-06-17", query }),
  });
}

export function deleteProjectMemory(settings: RuntimeSettings, noteId: string): Promise<RuntimeResult<void>> {
  return runtimeFetch<void>(settings, `/v1/project-memory/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
}
