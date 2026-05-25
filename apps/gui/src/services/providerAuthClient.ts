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

export type ProviderAuthSource = "none" | "api_key" | "oauth" | "device" | "browser";

export type ProviderAuthResponse = {
  provider: string;
  configured: boolean;
  status: ProviderAuthStatus;
  authSource: ProviderAuthSource;
  supportsLogin: boolean;
  supportsApiKey: boolean;
  cloudRequired: false;
  authorizationUrl?: string;
  verificationUrl?: string;
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

export function getProviderAuthStatus(
  settings: RuntimeSettings,
  provider: string,
  sessionId?: string,
): Promise<RuntimeResult<ProviderAuthResponse>> {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  return runtimeFetch<ProviderAuthResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/status${query}`);
}

export function startProviderAuth(
  settings: RuntimeSettings,
  provider: string,
  request: ProviderAuthStartRequest = {},
): Promise<RuntimeResult<ProviderAuthStartResponse>> {
  return runtimeFetch<ProviderAuthStartResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/start`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function exchangeProviderAuth(
  settings: RuntimeSettings,
  provider: string,
  sessionId: string,
  code?: string,
  state?: string,
): Promise<RuntimeResult<ProviderAuthExchangeResponse>> {
  return runtimeFetch<ProviderAuthExchangeResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/exchange`, {
    method: "POST",
    body: JSON.stringify({ sessionId, code, state }),
  });
}

export function disconnectProviderAuth(
  settings: RuntimeSettings,
  provider: string,
): Promise<RuntimeResult<ProviderAuthDisconnectResponse>> {
  return runtimeFetch<ProviderAuthDisconnectResponse>(settings, `/v1/provider-auth/${encodeURIComponent(provider)}/disconnect`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
