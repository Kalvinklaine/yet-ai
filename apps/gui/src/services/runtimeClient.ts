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
  type: "user_message" | "abort";
  payload?: {
    content: string;
  };
};

export type ChatCommandResponse = {
  accepted: boolean;
  chatId: string;
  requestId: string;
  type: string;
};

export const productIdentity = {
  productId: "yet-ai",
  displayName: "Yet AI",
  guiPackage: "yet-ai-chat-js",
} as const;

const runtimeFetchTimeoutMs = 10_000;
const maxErrorMessageChars = 500;

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
  const redacted = value
    .replace(/(["'])(?:access_token|refresh_token|api_key|authorization|client_secret|session_token|cookie|set-cookie|code_verifier|pkce_verifier|verifier)\1\s*:\s*(["'])(?:\\.|(?!\2).)*\2/gi, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(?:access_token|refresh_token|api_key|authorization|client_secret|code|verifier|cookie|set-cookie)\b\s*[:=]\s*[^\s,;)}\]]+/gi, "[redacted]")
    .replace(/\b(?:auth\.json|\.codex\/auth\.json)\b/gi, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "[redacted]");
  return redacted.length > maxErrorMessageChars ? `${redacted.slice(0, maxErrorMessageChars)}…` : redacted;
}
