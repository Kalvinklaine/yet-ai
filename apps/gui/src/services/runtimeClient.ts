export type RuntimeSettings = {
  baseUrl: string;
  token: string;
};

export type RuntimeError = {
  status: number | "network" | "parse";
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

export type ModelSummary = {
  id: string;
  displayName: string;
  providerId?: string;
};

export type ModelsResponse = {
  models: ModelSummary[];
};

export type ChatCommand = {
  requestId: string;
  type: "user_message";
  payload: {
    content: string;
  };
};

export type ChatCommandResponse = {
  accepted: boolean;
  chatId: string;
  requestId: string;
  type: string;
};

export function authHeaders(settings: RuntimeSettings): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (settings.token.trim()) {
    headers.Authorization = `Bearer ${settings.token.trim()}`;
  }
  return headers;
}

export async function runtimeFetch<T>(
  settings: RuntimeSettings,
  path: string,
  init: RequestInit = {},
): Promise<RuntimeResult<T>> {
  const headers = new Headers(authHeaders(settings));
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  let response: Response;
  try {
    response = await fetch(joinUrl(settings.baseUrl, path), {
      ...init,
      headers,
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        status: "network",
        message: error instanceof Error ? error.message : "Runtime is unavailable",
      },
    };
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
        message: error instanceof Error ? error.message : "Invalid runtime JSON response",
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

export function sendUserMessage(
  settings: RuntimeSettings,
  chatId: string,
  content: string,
): Promise<RuntimeResult<ChatCommandResponse>> {
  const command: ChatCommand = {
    requestId: crypto.randomUUID(),
    type: "user_message",
    payload: { content },
  };
  return runtimeFetch<ChatCommandResponse>(settings, `/v1/chats/${encodeURIComponent(chatId)}/commands`, {
    method: "POST",
    body: JSON.stringify(command),
  });
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
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
    return typeof message === "string" ? message : text;
  } catch {
    return text;
  }
}
