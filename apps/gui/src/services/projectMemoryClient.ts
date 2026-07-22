import { chatApiPath, runtimeFetch, type ChatRuntimeSettings, type RuntimeResult } from "./runtimeClient";

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

export function listProjectMemory(settings: ChatRuntimeSettings): Promise<RuntimeResult<ProjectMemoryListResponse>> {
  return runtimeFetch<ProjectMemoryListResponse>(settings, chatApiPath(settings, "/project-memory"));
}

export function createProjectMemory(settings: ChatRuntimeSettings, request: ProjectMemoryCreateRequest): Promise<RuntimeResult<ProjectMemoryNote>> {
  return runtimeFetch<ProjectMemoryNote>(settings, chatApiPath(settings, "/project-memory"), {
    method: "POST",
    body: JSON.stringify({ protocolVersion: "2026-06-17", ...request }),
  });
}

export function searchProjectMemory(settings: ChatRuntimeSettings, query: string): Promise<RuntimeResult<ProjectMemorySearchResponse>> {
  return runtimeFetch<ProjectMemorySearchResponse>(settings, chatApiPath(settings, "/project-memory/search"), {
    method: "POST",
    body: JSON.stringify({ protocolVersion: "2026-06-17", query }),
  });
}

export function deleteProjectMemory(settings: ChatRuntimeSettings, noteId: string): Promise<RuntimeResult<void>> {
  return runtimeFetch<void>(settings, chatApiPath(settings, `/project-memory/${encodeURIComponent(noteId)}`), {
    method: "DELETE",
  });
}
