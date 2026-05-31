import { sanitizeErrorText } from "./redaction";

export type RuntimeSettings = {
  baseUrl: string;
  token: string;
};

export type RuntimeError = {
  status: number | "network" | "timeout" | "parse" | "protocol" | "sequence" | "configuration";
  message: string;
};

export type RuntimeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RuntimeError };

export type PingResponse = {
  productId: string;
  displayName: string;
  version: string;
  ready: boolean;
  serverTime: string;
};

export type CapsResponse = {
  productId: string;
  protocolVersion: string;
  runtime: {
    mode: "local";
    cloudRequired: false;
    providerAccess: "direct";
  };
  capabilities: string[];
  features: Record<string, boolean>;
  providers: Array<{
    id: string;
    displayName: string;
    enabled: boolean;
    models: ModelSummary[];
  }>;
  ide: {
    bridge: boolean;
    lsp: boolean;
    host?: string;
  };
};

export type ModelCapabilities = {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  reasoning: boolean;
};

export type ModelReadiness = {
  status: "ready" | "disabled" | "missing_credentials" | "missing_model" | "unsupported";
  reason?: string;
};

export type ModelSummary = {
  id: string;
  displayName: string;
  providerId?: string;
  capabilities?: ModelCapabilities;
  readiness?: ModelReadiness;
};

export type ModelsResponse = {
  models: ModelSummary[];
};

export type ChatContext = {
  kind: "active_editor";
  source: "browser" | "vscode" | "jetbrains";
  file?: {
    displayPath?: string;
    workspaceRelativePath?: string;
    languageId?: string;
  };
  selection?: {
    startLine?: number;
    startCharacter?: number;
    endLine?: number;
    endCharacter?: number;
    text?: string;
  };
};

export type ChatCommand = {
  requestId: string;
  type: "user_message" | "abort";
  payload?: {
    content: string;
    context?: ChatContext;
  };
};

export type ChatCommandResponse = {
  accepted: boolean;
  chatId: string;
  requestId: string;
  type: string;
};

export type ChatHistoryMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "error";
  content: string;
  createdAt: string;
  status?: "pending" | "streaming" | "complete" | "error";
};

export type ChatThread = {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatHistoryMessage[];
};

export type ChatSummary = Omit<ChatThread, "messages"> & {
  messageCount: number;
};

export type ChatListResponse = {
  chats: ChatSummary[];
};

export type AgentProgressPhase = "queued" | "started" | "reading_context" | "editing" | "running_command" | "waiting_for_tool" | "verifying" | "finishing" | "done" | "failed" | "stuck";

export type AgentProgressStatus = "pending" | "running" | "healthy_running" | "long_running" | "stalled" | "stuck" | "done" | "failed";

export type AgentProgressToolKind = "read" | "edit" | "command" | "test" | "validation" | "network" | "planner" | "other";

export type AgentProgressToolSummary = {
  kind: AgentProgressToolKind;
  label: string;
  startedAt?: string;
  elapsedMs?: number;
};

export type AgentProgressRecentEvent = {
  eventId: string;
  timestamp: string;
  phase: AgentProgressPhase;
  status: AgentProgressStatus;
  message: string;
};

export type AgentOverflowRecoveryKind = "context_length_exceeded" | "tool_output_too_large" | "task_board_output_too_large";

export type AgentOverflowRecovery = {
  kind: AgentOverflowRecoveryKind;
  message: string;
  retryable?: boolean;
};

export type AgentProgressSnapshot = {
  protocolVersion: "2026-05-29";
  runId: string;
  cardId: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  phase: AgentProgressPhase;
  status: AgentProgressStatus;
  message: string;
  elapsedMs: number;
  ageMs: number;
  lastHeartbeatAt?: string;
  heartbeatAgeMs?: number;
  lastToolOutputAt?: string;
  toolOutputAgeMs?: number;
  currentTool?: AgentProgressToolSummary;
  outputTail?: string;
  overflowRecovery?: AgentOverflowRecovery;
  stuckReason?: "heartbeat_timeout" | "tool_output_timeout" | "explicit_failure" | "explicit_stuck" | "none";
  recentEvents: AgentProgressRecentEvent[];
};

export type AgentProgressListResponse = {
  cloudRequired: false;
  providerAccess: "direct";
  generatedAt?: string;
  snapshots: AgentProgressSnapshot[];
};

export const productIdentity = {
  productId: "yet-ai",
  displayName: "Yet AI",
  guiPackage: "yet-ai-chat-js",
} as const;

const runtimeFetchTimeoutMs = 10_000;

export function authHeaders(settings: RuntimeSettings): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const token = settings.token.trim();
  if (token && isLoopbackRuntimeUrl(settings.baseUrl)) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function runtimeFetch<T>(
  settings: RuntimeSettings,
  path: string,
  init: RequestInit = {},
): Promise<RuntimeResult<T>> {
  const validation = validateRuntimeBaseUrl(settings.baseUrl);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  new Headers(authHeaders(settings)).forEach((value, key) => headers.set(key, value));

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), runtimeFetchTimeoutMs);
  const combinedSignal = combineSignals(init.signal, timeoutController.signal);

  let response: Response;
  try {
    response = await fetch(joinUrl(settings.baseUrl, path), {
      ...init,
      headers,
      signal: combinedSignal,
    });
  } catch (error) {
    const timedOut = timeoutController.signal.aborted && !init.signal?.aborted;
    return {
      ok: false,
      error: {
        status: timedOut ? "timeout" : "network",
        message: timedOut ? "Runtime request timed out." : sanitizeRuntimeErrorText(error instanceof Error ? error.message : "Runtime is unavailable"),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        status: response.status,
        message: await errorMessage(response),
      },
    };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: {
        status: "parse",
        message: sanitizeRuntimeErrorText(error instanceof Error ? error.message : "Invalid runtime JSON response"),
      },
    };
  }
}

export function getPing(settings: RuntimeSettings): Promise<RuntimeResult<PingResponse>> {
  return runtimeFetch<PingResponse>(settings, "/v1/ping");
}

export function getCaps(settings: RuntimeSettings): Promise<RuntimeResult<CapsResponse>> {
  return runtimeFetch<CapsResponse>(settings, "/v1/caps");
}

export function getModels(settings: RuntimeSettings): Promise<RuntimeResult<ModelsResponse>> {
  return runtimeFetch<ModelsResponse>(settings, "/v1/models");
}

export function listChats(settings: RuntimeSettings): Promise<RuntimeResult<ChatListResponse>> {
  return runtimeFetch<ChatListResponse>(settings, "/v1/chats");
}

export function createChat(settings: RuntimeSettings): Promise<RuntimeResult<ChatThread>> {
  return runtimeFetch<ChatThread>(settings, "/v1/chats", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getChat(settings: RuntimeSettings, chatId: string): Promise<RuntimeResult<ChatThread>> {
  return runtimeFetch<ChatThread>(settings, `/v1/chats/${encodeURIComponent(chatId)}`);
}

export function deleteChat(settings: RuntimeSettings, chatId: string): Promise<RuntimeResult<{ deleted: boolean; chatId: string }>> {
  return runtimeFetch<{ deleted: boolean; chatId: string }>(settings, `/v1/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
  });
}

export function getAgentProgress(settings: RuntimeSettings, signal?: AbortSignal): Promise<RuntimeResult<AgentProgressListResponse>> {
  return runtimeFetch<AgentProgressListResponse>(settings, "/v1/agent-progress", { signal });
}

export function sendUserMessage(
  settings: RuntimeSettings,
  chatId: string,
  content: string,
  context?: ChatContext,
): Promise<RuntimeResult<ChatCommandResponse>> {
  const command: ChatCommand = {
    requestId: crypto.randomUUID(),
    type: "user_message",
    payload: context ? { content, context } : { content },
  };
  return runtimeFetch<ChatCommandResponse>(settings, `/v1/chats/${encodeURIComponent(chatId)}/commands`, {
    method: "POST",
    body: JSON.stringify(command),
  });
}

export function sendAbort(
  settings: RuntimeSettings,
  chatId: string,
): Promise<RuntimeResult<ChatCommandResponse>> {
  const command: ChatCommand = {
    requestId: crypto.randomUUID(),
    type: "abort",
  };
  return runtimeFetch<ChatCommandResponse>(settings, `/v1/chats/${encodeURIComponent(chatId)}/commands`, {
    method: "POST",
    body: JSON.stringify(command),
  });
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function validateRuntimeBaseUrl(baseUrl: string): RuntimeResult<URL> {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      error: {
        status: "configuration",
        message: "Runtime base URL must be a valid local loopback URL.",
      },
    };
  }

  if (!isLoopbackUrl(parsed) || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return {
      ok: false,
      error: {
        status: "configuration",
        message: "Runtime base URL must use http(s) on local loopback: 127.0.0.1, localhost, or ::1.",
      },
    };
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return {
      ok: false,
      error: {
        status: "configuration",
        message: "Runtime base URL must not include credentials, query parameters, or fragments.",
      },
    };
  }

  if (parsed.pathname !== "/" || !hasRootRawUrlPath(baseUrl)) {
    return {
      ok: false,
      error: {
        status: "configuration",
        message: "Runtime base URL must not include a path.",
      },
    };
  }

  return { ok: true, data: parsed };
}

export function isLoopbackRuntimeUrl(baseUrl: string): boolean {
  const validation = validateRuntimeBaseUrl(baseUrl);
  return validation.ok;
}

export function productIdentityWarning(response: Pick<PingResponse, "productId" | "displayName"> | Pick<CapsResponse, "productId">): string | null {
  const displayName = "displayName" in response ? response.displayName : productIdentity.displayName;
  if (response.productId !== productIdentity.productId || displayName !== productIdentity.displayName) {
    return `Runtime identity mismatch: expected ${productIdentity.displayName} (${productIdentity.productId}), received ${displayName} (${response.productId}).`;
  }
  return null;
}

function isLoopbackUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function hasRootRawUrlPath(value: string): boolean {
  const rawPath = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#]*([^?#]*)/.exec(value)?.[1];
  return rawPath === "" || rawPath === "/";
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) {
    return "Unauthorized local runtime request. Check the session token.";
  }
  const text = await response.text();
  if (!text) {
    return `Runtime request failed with HTTP ${response.status}`;
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
    const message = parsed.error ?? parsed.message ?? parsed.detail;
    return sanitizeRuntimeErrorText(typeof message === "string" ? message : text);
  } catch {
    return sanitizeRuntimeErrorText(text);
  }
}

function combineSignals(callerSignal: AbortSignal | null | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!callerSignal) {
    return timeoutSignal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (callerSignal.aborted || timeoutSignal.aborted) {
    controller.abort();
    return controller.signal;
  }
  callerSignal.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function sanitizeRuntimeErrorText(value: string): string {
  return sanitizeErrorText(value);
}
