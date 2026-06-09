import { runtimeFetch, type ModelSummary, type RuntimeResult, type RuntimeSettings } from "./runtimeClient";

export type ProviderKind = "openai-compatible" | "ollama" | "custom" | "demo-local";
export type AuthType = "none" | "api_key";

export type ProviderSummary = {
  id: string;
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  baseUrl: string;
  auth: {
    type: AuthType;
    configured: boolean;
    redacted?: string;
  };
  models: ModelSummary[];
  capabilities: {
    chat: boolean;
    completion: boolean;
    embeddings: boolean;
  };
};

export type ProvidersResponse = {
  providers: ProviderSummary[];
  cloudRequired: false;
  providerAccess: "direct";
};

export type ProviderWriteRequest = {
  id?: string;
  kind?: ProviderKind;
  displayName?: string;
  enabled?: boolean;
  baseUrl?: string;
  auth?: {
    type: AuthType;
    apiKey?: string;
  };
  models?: ModelSummary[];
  capabilities?: {
    chat: boolean;
    completion: boolean;
    embeddings: boolean;
  };
};

export type ProviderTestResponse = {
  ok: boolean;
  providerId: string;
  status: "reachable" | "unsupported_kind" | "missing_secret" | "missing_model" | "bad_url" | "unauthorized" | "timeout" | "unreachable" | "upstream_error";
  message: string;
  modelId?: string;
  cloudRequired: false;
};

export function listProviders(settings: RuntimeSettings): Promise<RuntimeResult<ProvidersResponse>> {
  return runtimeFetch<ProvidersResponse>(settings, "/v1/providers");
}

export function saveProvider(
  settings: RuntimeSettings,
  providerId: string | undefined,
  request: ProviderWriteRequest,
): Promise<RuntimeResult<ProviderSummary>> {
  const path = providerId ? `/v1/providers/${encodeURIComponent(providerId)}` : "/v1/providers";
  return runtimeFetch<ProviderSummary>(settings, path, {
    method: providerId ? "PATCH" : "POST",
    body: JSON.stringify(request),
  });
}

export function testProvider(settings: RuntimeSettings, providerId: string): Promise<RuntimeResult<ProviderTestResponse>> {
  return runtimeFetch<ProviderTestResponse>(settings, `/v1/providers/${encodeURIComponent(providerId)}/test`, {
    method: "POST",
  });
}
