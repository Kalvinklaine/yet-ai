import type { ProviderSummary } from "./providersClient";
import type { ModelSummary, RuntimeError } from "./runtimeClient";
import { sanitizeDisplayText } from "./redaction";

export type ProviderModelReadiness = {
  ready: boolean;
  mismatch: boolean;
  model?: ModelSummary;
  provider?: ProviderSummary;
  message?: string;
};

export type ProviderReadinessState = "runtime_unavailable" | "demo_mode_ready" | "openai_compatible_ready" | "model_provider_mismatch" | "model_not_ready" | "provider_required";

export function classifyProviderReadinessState(readiness: ProviderModelReadiness, runtimeConnected: boolean): ProviderReadinessState {
  if (!runtimeConnected) {
    return "runtime_unavailable";
  }
  if (readiness.ready) {
    return readiness.provider?.kind === "demo-local" ? "demo_mode_ready" : "openai_compatible_ready";
  }
  if (readiness.mismatch) {
    return "model_provider_mismatch";
  }
  if (readiness.model || readiness.message) {
    return "model_not_ready";
  }
  return "provider_required";
}

export function resolveProviderModelReadiness(models: ModelSummary[], enabledProviders: ProviderSummary[], modelError: RuntimeError | null): ProviderModelReadiness {
  if (modelError) {
    return { ready: false, mismatch: false };
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
    return { ready: false, mismatch: false, model, provider, message: modelUnreadyMessage(model) };
  }
  if (!model.capabilities?.chat || !model.capabilities.streaming) {
    return { ready: false, mismatch: false, model, provider, message: modelUnsupportedMessage(model) };
  }
  return { ready: true, mismatch: false, model, provider };
}

export function missingModelMetadataMessage(model: ModelSummary): string | undefined {
  if (!model.capabilities || !model.readiness) {
    return `Model ${sanitizeDisplayText(model.displayName || model.id || "selected model")} is missing readiness metadata from the runtime. Refresh the runtime after updating it before sending.`;
  }
  return undefined;
}

export function modelUnreadyMessage(model: ModelSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const status = sanitizeDisplayText(readinessStatusLabel(model.readiness?.status));
  const reason = model.readiness?.reason ? ` ${sanitizeDisplayText(model.readiness.reason)}` : "";
  return `Model ${modelName} is not ready for chat streaming: ${status}.${reason}`;
}

export function modelUnsupportedMessage(model: ModelSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const support = modelCapabilitySummary(model);
  return `Model ${modelName} cannot send chat because required capabilities are unavailable: ${support}.`;
}

function resolveRuntimeModelProvider(model: ModelSummary, enabledProviders: ProviderSummary[]): ProviderSummary | undefined {
  const providerId = model.providerId?.trim();
  if (providerId) {
    return enabledProviders.find((provider) => provider.id === providerId);
  }
  const matchingProviders = enabledProviders.filter((provider) => provider.models.some((providerModel) => providerModel.id.trim() === model.id.trim()));
  return matchingProviders.length === 1 ? matchingProviders[0] : undefined;
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
  return `Runtime model/provider mismatch. Refresh runtime or test/save provider before sending.${detail}`;
}
