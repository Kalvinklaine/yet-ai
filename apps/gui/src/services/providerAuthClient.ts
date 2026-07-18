import { runtimeFetch, type RuntimeResult, type RuntimeSettings } from "./runtimeClient";

export type ProviderAuthStatus =
  | "not_configured"
  | "api_key_configured"
  | "login_available"
  | "login_unavailable"
  | "pending"
  | "connected"
  | "expired"
  | "revoked"
  | "error";

type LegacyProviderAuthStatus = "provider_error" | "exchange_failed" | "storage_error";

type RawProviderAuthStatus = ProviderAuthStatus | LegacyProviderAuthStatus;

export type ProviderAuthSource = "none" | "api_key" | "oauth";

export type ProviderAuthResponse = {
  provider: string;
  configured: boolean;
  status: ProviderAuthStatus;
  authSource: ProviderAuthSource;
  supportsLogin: boolean;
  supportsApiKey: boolean;
  cloudRequired: false;
  authorizationUrl?: string;
  sessionId?: string;
  accountLabel?: string;
  expiresAt?: string;
  scopes?: string[];
  redacted?: string;
  lastError?: string;
  message?: string;
  pollIntervalSeconds?: number;
};

export type ProviderAuthStartRequest = {
  experimentalCodexLike?: boolean;
};

export type ProviderAuthStartResponse = ProviderAuthResponse & {
  success: boolean;
};

export type ProviderAuthExchangeResponse = ProviderAuthResponse & {
  success: boolean;
};

export type ProviderAuthDisconnectResponse = ProviderAuthResponse & {
  success: boolean;
};

type RawProviderAuthResponse = Omit<ProviderAuthResponse, "status"> & {
  status: RawProviderAuthStatus;
};

type RawProviderAuthStartResponse = RawProviderAuthResponse & {
  success: boolean;
};

type RawProviderAuthExchangeResponse = RawProviderAuthResponse & {
  success: boolean;
};

type RawProviderAuthDisconnectResponse = RawProviderAuthResponse & {
  success: boolean;
};

function normalizeProviderAuthStatus(status: RawProviderAuthStatus): ProviderAuthStatus {
  if (status === "provider_error" || status === "exchange_failed" || status === "storage_error") {
    return "error";
  }
  return status;
}

function isProviderAuthSource(source: unknown): source is ProviderAuthSource {
  return source === "none" || source === "api_key" || source === "oauth";
}

async function normalizeProviderAuthResult<T extends RawProviderAuthResponse>(result: Promise<RuntimeResult<T>>): Promise<RuntimeResult<Omit<T, "status"> & { status: ProviderAuthStatus }>> {
  const response = await result;
  if (!response.ok) {
    return response;
  }
  if (!isProviderAuthSource(response.data.authSource)) {
    return { ok: false, error: { status: "protocol", message: "Provider auth response used an unsupported auth source." } };
  }
  const data = response.data;
  return {
    ok: true,
    data: {
      provider: data.provider,
      configured: data.configured,
      status: normalizeProviderAuthStatus(data.status),
      authSource: data.authSource,
      supportsLogin: data.supportsLogin,
      supportsApiKey: data.supportsApiKey,
      cloudRequired: data.cloudRequired,
      authorizationUrl: data.authorizationUrl,
      sessionId: data.sessionId,
      accountLabel: data.accountLabel,
      expiresAt: data.expiresAt,
      scopes: data.scopes,
      redacted: data.redacted,
      lastError: data.lastError,
      message: data.message,
      pollIntervalSeconds: data.pollIntervalSeconds,
      ...("success" in data ? { success: data.success } : {}),
    } as Omit<T, "status"> & { status: ProviderAuthStatus },
  };
}

export function getProviderAuthStatus(
  settings: RuntimeSettings,
  provider: string,
  sessionId?: string,
): Promise<RuntimeResult<ProviderAuthResponse>> {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  return normalizeProviderAuthResult(runtimeFetch<RawProviderAuthResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/status${query}`));
}

export function startProviderAuth(
  settings: RuntimeSettings,
  provider: string,
  request: ProviderAuthStartRequest = {},
): Promise<RuntimeResult<ProviderAuthStartResponse>> {
  return normalizeProviderAuthResult(runtimeFetch<RawProviderAuthStartResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/start`, {
    method: "POST",
    body: JSON.stringify(request),
  }));
}

export function exchangeProviderAuth(
  settings: RuntimeSettings,
  provider: string,
  sessionId: string,
  code?: string,
  state?: string,
): Promise<RuntimeResult<ProviderAuthExchangeResponse>> {
  return normalizeProviderAuthResult(runtimeFetch<RawProviderAuthExchangeResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/exchange`, {
    method: "POST",
    body: JSON.stringify({ sessionId, code, state }),
  }));
}

export function disconnectProviderAuth(
  settings: RuntimeSettings,
  provider: string,
): Promise<RuntimeResult<ProviderAuthDisconnectResponse>> {
  return normalizeProviderAuthResult(runtimeFetch<RawProviderAuthDisconnectResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/disconnect`, {
    method: "POST",
    body: JSON.stringify({}),
  }));
}
