import type { ProviderSummary } from "./providersClient";
import type { ModelSummary, RuntimeError } from "./runtimeClient";
import { sanitizeDisplayText } from "./redaction";

export type ProviderModelReadiness = {
  ready: boolean;
  mismatch: boolean;
  model?: ModelSummary;
  provider?: ProviderSummary;
  message?: string;
  error?: RuntimeError;
};

export type ProviderReadinessState = "runtime_unavailable" | "demo_mode_ready" | "openai_compatible_ready" | "local_provider_ready" | "model_provider_mismatch" | "missing_credentials" | "missing_model" | "unsupported_model" | "local_provider_unready" | "provider_error" | "model_not_ready" | "provider_required";

export function classifyProviderReadinessState(readiness: ProviderModelReadiness, runtimeConnected: boolean): ProviderReadinessState {
  if (!runtimeConnected) {
    return "runtime_unavailable";
  }
  if (readiness.ready) {
    if (readiness.provider?.kind === "demo-local") {
      return "demo_mode_ready";
    }
    if (isLocalProviderKind(readiness.provider?.kind)) {
      return "local_provider_ready";
    }
    return "openai_compatible_ready";
  }
  if (readiness.mismatch) {
    return "model_provider_mismatch";
  }
  if (readiness.error) {
    return "provider_error";
  }
  if (readiness.model?.readiness?.status === "missing_credentials") {
    return "missing_credentials";
  }
  if (readiness.model?.readiness?.status === "missing_model") {
    return isLocalProviderKind(readiness.provider?.kind) ? "local_provider_unready" : "missing_model";
  }
  if (readiness.model?.readiness?.status === "unsupported" || (readiness.model && (!readiness.model.capabilities?.chat || !readiness.model.capabilities.streaming))) {
    return "unsupported_model";
  }
  if (readiness.model || readiness.message) {
    return "model_not_ready";
  }
  return "provider_required";
}

export function resolveProviderModelReadiness(models: ModelSummary[], enabledProviders: ProviderSummary[], modelError: RuntimeError | null): ProviderModelReadiness {
  if (modelError) {
    return { ready: false, mismatch: false, error: modelError, message: runtimeModelErrorMessage(modelError) };
  }
  const firstRuntimeModel = models[0];
  if (firstRuntimeModel) {
    const modelId = firstRuntimeModel.id.trim();
    if (!modelId) {
      return { ready: false, mismatch: true, model: firstRuntimeModel, message: modelProviderMismatchMessage(firstRuntimeModel) };
    }
    const provider = resolveRuntimeModelProvider(firstRuntimeModel, enabledProviders);
    if (!provider || !provider.models.some((model) => model.id.trim() === modelId)) {
      return { ready: false, mismatch: true, model: firstRuntimeModel, provider, message: modelProviderMismatchMessage(firstRuntimeModel, provider) };
    }
    return modelReadinessResult(firstRuntimeModel, provider);
  }
  const provider = enabledProviders.find((item) => item.models.some((model) => model.id.trim()));
  const model = provider?.models.find((item) => item.id.trim());
  if (!provider || !model) {
    return { ready: false, mismatch: false };
  }
  return modelReadinessResult({ ...model, providerId: model.providerId ?? provider.id }, provider);
}

function modelReadinessResult(model: ModelSummary, provider: ProviderSummary): ProviderModelReadiness {
  const missingMessage = missingModelMetadataMessage(model);
  if (missingMessage) {
    return { ready: false, mismatch: false, model, provider, message: missingMessage };
  }
  if (model.readiness?.status !== "ready") {
    return { ready: false, mismatch: false, model, provider, message: modelUnreadyMessage(model, provider) };
  }
  if (!model.capabilities?.chat || !model.capabilities.streaming) {
    return { ready: false, mismatch: false, model, provider, message: modelUnsupportedMessage(model, provider) };
  }
  return { ready: true, mismatch: false, model, provider };
}

export function missingModelMetadataMessage(model: ModelSummary): string | undefined {
  if (!model.capabilities || !model.readiness) {
    return `Model ${sanitizeDisplayText(model.displayName || model.id || "selected model")} is missing readiness metadata from the local runtime. Refresh runtime after updating it; if this persists, test the provider before sending.`;
  }
  return undefined;
}

export function modelUnreadyMessage(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const status = model.readiness?.status;
  const reason = model.readiness?.reason ? ` Runtime detail: ${sanitizeDisplayText(model.readiness.reason)}` : "";
  switch (status) {
    case "missing_credentials":
      return `Provider credentials are required before ${modelName} can send. Save the provider API key in the local runtime, then Test provider and Refresh runtime.${reason}`;
    case "missing_model":
      if (provider?.kind === "ollama") {
        return `Local Ollama model ${modelName} is not available yet. Start Ollama, pull or choose the model locally, Test provider, then Refresh runtime.${reason}`;
      }
      if (isLocalProviderKind(provider?.kind)) {
        return `Local provider model ${modelName} is not available yet. Check the local server and saved model id, Test provider, then Refresh runtime.${reason}`;
      }
      return `Model ${modelName} is not available from the configured provider. Check the saved model id or choose a provider-returned model, then Test provider and Refresh runtime.${reason}`;
    case "unsupported":
      return modelUnsupportedMessage(model, provider);
    case "disabled":
      return `Model ${modelName} is disabled for chat. Enable the provider/model locally or choose Demo Mode for a no-key preview before sending.${reason}`;
    default:
      return `Model ${modelName} is not ready for chat streaming: ${sanitizeDisplayText(readinessStatusLabel(status))}.${reason}`;
  }
}

export function modelUnsupportedMessage(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const support = modelCapabilitySummary(model);
  const providerHint = provider?.kind === "demo-local" ? " Choose a real BYOK/local provider when you need model capabilities beyond Demo Mode." : " Choose a chat + streaming capable model, then refresh runtime.";
  return `Model ${modelName} cannot send chat because required capabilities are unavailable: ${support}.${providerHint}`;
}

export function runtimeModelErrorMessage(error: RuntimeError): string {
  const detail = sanitizeDisplayText(error.message);
  switch (error.status) {
    case 401:
      return `Runtime rejected the model/provider refresh as unauthorized. Refresh runtime with the correct local Session token; provider API keys are separate. Detail: ${detail}`;
    case 429:
      return `Provider or runtime rate limit was reported while refreshing models. Wait, then Test provider or Refresh runtime. Detail: ${detail}`;
    case 404:
      return `Runtime or provider model endpoint was not found. Check the local runtime version, provider base URL, and saved model id, then Refresh runtime. Detail: ${detail}`;
    case "timeout":
      return `Model/provider readiness timed out. Check the local runtime or local provider server, reduce load if needed, then Refresh runtime. Detail: ${detail}`;
    case "network":
      return `Model/provider readiness could not reach the local runtime or provider through it. Inspect the local runtime and provider server, then Refresh runtime. Detail: ${detail}`;
    default:
      return `Runtime model refresh failed before a send-ready model was selected. Refresh runtime, Test provider, or inspect local runtime logs. Detail: ${detail}`;
  }
}

function resolveRuntimeModelProvider(model: ModelSummary, enabledProviders: ProviderSummary[]): ProviderSummary | undefined {
  const providerId = model.providerId?.trim();
  if (providerId) {
    return enabledProviders.find((provider) => provider.id === providerId);
  }
  const matchingProviders = enabledProviders.filter((provider) => provider.models.some((providerModel) => providerModel.id.trim() === model.id.trim()));
  return matchingProviders.length === 1 ? matchingProviders[0] : undefined;
}

function isLocalProviderKind(kind: ProviderSummary["kind"] | undefined): boolean {
  return kind === "ollama" || kind === "custom";
}

export function modelStatusText(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const providerName = provider ? sanitizeDisplayText(provider.displayName || provider.id) : model.providerId ? sanitizeDisplayText(model.providerId) : undefined;
  const providerText = providerName ? ` (${providerName})` : "";
  if (!model.capabilities || !model.readiness) {
    return `${modelName}${providerText}: readiness metadata missing`;
  }
  const reason = model.readiness.reason ? `, ${sanitizeDisplayText(model.readiness.reason)}` : "";
  return `${modelName}${providerText}: ${sanitizeDisplayText(readinessStatusLabel(model.readiness.status))}${reason}; ${modelCapabilitySummary(model)}`;
}

export function modelCapabilitySummary(model: ModelSummary): string {
  if (!model.capabilities) {
    return "capabilities missing";
  }
  return `chat ${capabilityLabel(model.capabilities.chat)}, streaming ${capabilityLabel(model.capabilities.streaming)}, tools ${capabilityLabel(model.capabilities.tools)}, reasoning ${capabilityLabel(model.capabilities.reasoning)}`;
}

function capabilityLabel(value: boolean): string {
  return value ? "supported" : "unsupported";
}

export function readinessStatusLabel(status: NonNullable<ModelSummary["readiness"]>["status"] | undefined): string {
  switch (status) {
    case "ready":
      return "ready";
    case "disabled":
      return "disabled";
    case "missing_credentials":
      return "missing credentials";
    case "missing_model":
      return "missing model";
    case "unsupported":
      return "unsupported";
    default:
      return "unknown readiness";
  }
}

export function modelProviderMismatchMessage(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const providerName = provider ? sanitizeDisplayText(provider.displayName || provider.id) : model.providerId ? sanitizeDisplayText(model.providerId) : undefined;
  const detail = providerName ? ` Model ${modelName} is not available on enabled provider ${providerName}.` : ` Model ${modelName} does not map to exactly one enabled provider.`;
  return `Runtime model/provider mismatch. Test the saved provider, fix the provider/model id mapping locally, then Refresh runtime before sending.${detail}`;
}
