import type { ProviderSummary } from "./providersClient";
import type { CapabilityProvenance, ModelSummary, ProviderFamily, ProviderTestStatus, RuntimeError } from "./runtimeClient";
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
    if (providerFamily(readiness.model, readiness.provider) === "demo_local" || readiness.provider?.kind === "demo-local") {
      return "demo_mode_ready";
    }
    if (isLocalProviderKind(readiness.provider?.kind) || isLocalProviderFamily(providerFamily(readiness.model, readiness.provider))) {
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
    return isLocalProviderKind(readiness.provider?.kind) || isLocalProviderFamily(providerFamily(readiness.model, readiness.provider)) ? "local_provider_unready" : "missing_model";
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
  const evidence = modelReadinessEvidenceSentence(model, provider);
  switch (status) {
    case "missing_credentials":
      return `Provider credentials are required before ${modelName} can send. Save the provider API key or local credential in the local runtime, then Test provider and Refresh runtime. If the provider rejected the key, replace the provider key there; do not use the runtime Session token.${reason}${evidence}`;
    case "missing_model":
      if (provider?.kind === "ollama" || providerFamily(model, provider) === "ollama") {
        return `Local Ollama model ${modelName} is not available yet. Start Ollama at the saved loopback URL, run ollama pull for this model or choose an installed local model, Test provider, then Refresh runtime.${reason}${localAvailabilityRecoverySentence(model)}${evidence}`;
      }
      if (isLocalProviderKind(provider?.kind) || isLocalProviderFamily(providerFamily(model, provider))) {
        return `Local provider model ${modelName} is not available yet. Start the local server, verify the saved loopback/base URL and model id, Test provider, then Refresh runtime.${reason}${localAvailabilityRecoverySentence(model)}${evidence}`;
      }
      return `Model ${modelName} is not available from the configured provider. Check the saved model id, choose a provider-returned model, or confirm the OpenAI-compatible base URL points to the right provider, then Test provider and Refresh runtime.${reason}${evidence}`;
    case "unsupported":
      return modelUnsupportedMessage(model, provider);
    case "disabled":
      return `Model ${modelName} is disabled for chat. Enable the provider/model locally, choose another send-ready model, or choose Demo Mode for a no-key local canned preview before sending.${reason}${evidence}`;
    default:
      return `Model ${modelName} is not ready for chat streaming: ${sanitizeDisplayText(readinessStatusLabel(status))}.${reason}${evidence}`;
  }
}

export function modelUnsupportedMessage(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const support = modelCapabilitySummary(model);
  const providerHint = provider?.kind === "demo-local" ? " Choose a real BYOK/local provider when you need model capabilities beyond Demo Mode." : " Choose a chat + streaming capable model, then refresh runtime.";
  return `Model ${modelName} cannot send chat because required capabilities are unavailable: ${support}.${providerHint}${modelReadinessEvidenceSentence(model, provider)}`;
}

export function runtimeModelErrorMessage(error: RuntimeError): string {
  const detail = sanitizeDisplayText(error.message);
  switch (error.status) {
    case 401:
      return `Runtime rejected the model/provider refresh as unauthorized. If the local runtime returned 401, refresh with the correct local Session token; if the provider test returned unauthorized, replace the saved provider API key/local credential. These secrets are separate. Detail: ${detail}`;
    case 429:
      return `Provider or runtime rate limit was reported while refreshing models. Wait, then Test provider or Refresh runtime. Detail: ${detail}`;
    case 404:
      return `Runtime or provider model endpoint was not found. Check the local runtime version, provider base URL, and saved model id, then Refresh runtime. Detail: ${detail}`;
    case "timeout":
      return `Model/provider readiness timed out. Check the local runtime and provider server; for Ollama/local providers, confirm the loopback server is running and the model is pulled. Reduce load if needed, then Test provider and Refresh runtime. Detail: ${detail}`;
    case "network":
      return `Model/provider readiness could not reach the local runtime or provider through it. Inspect the local runtime, provider base URL, and local server state; for Ollama, start the Ollama service on the saved loopback URL. Then Test provider and Refresh runtime. Detail: ${detail}`;
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

function isLocalProviderFamily(family: ProviderFamily | undefined): boolean {
  return family === "ollama" || family === "custom";
}

export function modelStatusText(model: ModelSummary, provider?: ProviderSummary): string {
  const modelName = sanitizeDisplayText(model.displayName || model.id || "selected model");
  const providerName = provider ? sanitizeDisplayText(provider.displayName || provider.id) : model.providerId ? sanitizeDisplayText(model.providerId) : undefined;
  const providerText = providerName ? ` (${providerName})` : "";
  if (!model.capabilities || !model.readiness) {
    return `${modelName}${providerText}: readiness metadata missing`;
  }
  const reason = model.readiness.reason ? `, ${sanitizeDisplayText(model.readiness.reason)}` : "";
  const metadata = modelReadinessMetadataSummary(model, provider);
  return `${modelName}${providerText}: ${sanitizeDisplayText(readinessStatusLabel(model.readiness.status))}${reason}; ${modelCapabilitySummary(model)}${metadata ? `; ${metadata}` : ""}`;
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

export function modelReadinessEvidenceText(model: ModelSummary, provider?: ProviderSummary): string | undefined {
  const summary = modelReadinessMetadataSummary(model, provider);
  if (!summary) {
    return undefined;
  }
  return `${summary}. This metadata is evidence only; Send stays gated by local runtime readiness and required chat/streaming capabilities.`;
}

function modelReadinessEvidenceSentence(model: ModelSummary, provider?: ProviderSummary): string {
  const text = modelReadinessEvidenceText(model, provider);
  return text ? ` ${text}` : "";
}

function modelReadinessMetadataSummary(model: ModelSummary, provider?: ProviderSummary): string | undefined {
  const parts = [providerFamilySummary(model, provider), readinessProvenanceSummary(model), capabilityProvenanceSummary(model), localAvailabilitySummary(model)].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function providerFamily(model: ModelSummary | undefined, provider?: ProviderSummary): ProviderFamily | undefined {
  return model?.providerFamily ?? provider?.providerFamily;
}

function providerFamilySummary(model: ModelSummary, provider?: ProviderSummary): string | undefined {
  const family = providerFamily(model, provider);
  if (!family) {
    return undefined;
  }
  return `provider family ${providerFamilyLabel(family)}`;
}

export function providerFamilyLabel(family: ProviderFamily): string {
  switch (family) {
    case "demo_local":
      return "demo-local runtime preview";
    case "ollama":
      return "Ollama/local";
    case "openai_compatible":
      return "OpenAI-compatible BYOK";
    case "custom":
      return "custom provider";
  }
}

function readinessProvenanceSummary(model: ModelSummary): string | undefined {
  const readiness = model.readiness;
  if (!readiness?.provenance && !readiness?.lastTestStatus && !readiness?.lastTestedAt) {
    return undefined;
  }
  const parts = [];
  if (readiness.provenance) {
    parts.push(`readiness ${provenanceLabel(readiness.provenance)}`);
  }
  if (readiness.lastTestStatus) {
    parts.push(`last test ${providerTestStatusLabel(readiness.lastTestStatus)}`);
  }
  if (readiness.lastTestedAt) {
    parts.push(`tested ${sanitizeDisplayText(readiness.lastTestedAt)}`);
  }
  return parts.join(", ");
}

function capabilityProvenanceSummary(model: ModelSummary): string | undefined {
  const provenance = model.capabilityProvenance;
  if (!provenance) {
    return undefined;
  }
  const entries = ["chat", "streaming", "tools", "reasoning"].flatMap((key) => {
    const value = provenance[key as keyof typeof provenance];
    return value ? [`${key} ${provenanceLabel(value)}`] : [];
  });
  return entries.length > 0 ? `capability evidence ${entries.join(", ")}` : undefined;
}

function localAvailabilitySummary(model: ModelSummary): string | undefined {
  const availability = model.localAvailability;
  if (!availability) {
    return undefined;
  }
  const parts = [`local availability ${localAvailabilityStatusLabel(availability.status)}`];
  if (availability.checkedAt) {
    parts.push(`checked ${sanitizeDisplayText(availability.checkedAt)}`);
  }
  if (availability.reason) {
    parts.push(sanitizeDisplayText(availability.reason));
  }
  return parts.join(", ");
}

function localAvailabilityRecoverySentence(model: ModelSummary): string {
  const availability = model.localAvailability;
  if (!availability || availability.status === "reachable" || availability.status === "not_applicable") {
    return "";
  }
  if (availability.status === "missing_model") {
    return " Local availability says the server was reached but the model is missing; pull/install the model locally before retrying.";
  }
  if (availability.status === "unreachable") {
    return " Local availability says the provider is unreachable; start the local server and check the loopback URL before retrying.";
  }
  return " Local availability has not been confirmed; test the provider locally before retrying.";
}

function provenanceLabel(value: CapabilityProvenance): string {
  switch (value) {
    case "configured":
      return "configured only";
    case "runtime_tested":
      return "runtime-tested";
    case "provider_declared":
      return "provider-declared";
    case "local_default":
      return "local default";
  }
}

function providerTestStatusLabel(status: ProviderTestStatus): string {
  return sanitizeDisplayText(status.replace(/_/g, " "));
}

function localAvailabilityStatusLabel(status: NonNullable<ModelSummary["localAvailability"]>["status"]): string {
  return sanitizeDisplayText(status.replace(/_/g, " "));
}
