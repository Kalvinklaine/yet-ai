import { describe, expect, it } from "vitest";
import type { ProviderSummary } from "./providersClient";
import type { ModelSummary } from "./runtimeClient";
import { classifyProviderReadinessState, missingModelMetadataMessage, modelCapabilitySummary, modelProviderMismatchMessage, modelStatusText, modelUnreadyMessage, readinessStatusLabel, resolveProviderModelReadiness, runtimeModelErrorMessage } from "./providerReadiness";

function model(overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    id: "gpt-4o-mini",
    displayName: "GPT-4o mini",
    providerId: "openai-api",
    capabilities: { chat: true, streaming: true, tools: false, reasoning: false },
    readiness: { status: "ready" },
    ...overrides,
  };
}

function provider(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: "openai-api",
    kind: "openai-compatible",
    displayName: "OpenAI API",
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "api_key", configured: true, redacted: "sk-...test" },
    models: [model({ providerId: undefined })],
    capabilities: { chat: true, completion: false, embeddings: false },
    ...overrides,
  };
}

describe("provider readiness", () => {
  it("resolves the selected runtime model when provider metadata matches", () => {
    const selected = model();
    const readiness = resolveProviderModelReadiness([selected], [provider()], null);

    expect(readiness.ready).toBe(true);
    expect(readiness.mismatch).toBe(false);
    expect(readiness.model).toBe(selected);
    expect(readiness.provider?.id).toBe("openai-api");
  });

  it("falls back to a configured provider model when runtime does not report a selected model", () => {
    const readiness = resolveProviderModelReadiness([], [provider()], null);

    expect(readiness.ready).toBe(true);
    expect(readiness.model?.providerId).toBe("openai-api");
  });

  it("accepts the local demo provider/model as normal runtime-owned readiness", () => {
    const demoModel = model({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" });
    const demoProvider = provider({
      id: "yet-demo",
      kind: "demo-local",
      displayName: "Yet AI Demo Mode",
      baseUrl: "local-runtime-demo-mode",
      auth: { type: "none", configured: true },
      models: [demoModel],
    });

    const readiness = resolveProviderModelReadiness([demoModel], [demoProvider], null);

    expect(readiness.ready).toBe(true);
    expect(readiness.provider?.id).toBe("yet-demo");
    expect(modelStatusText(demoModel, demoProvider)).toBe("Yet AI Demo Chat (Yet AI Demo Mode): ready; chat supported, streaming supported, tools unsupported, reasoning unsupported");
  });

  it("accepts native local Ollama provider readiness without credentials", () => {
    const ollamaModel = model({ id: "llama3.2", displayName: "llama3.2", providerId: "ollama-local" });
    const ollamaProvider = provider({
      id: "ollama-local",
      kind: "ollama",
      displayName: "Ollama Local",
      baseUrl: "http://127.0.0.1:11434",
      auth: { type: "none", configured: false },
      models: [ollamaModel],
    });

    const readiness = resolveProviderModelReadiness([ollamaModel], [ollamaProvider], null);

    expect(readiness.ready).toBe(true);
    expect(readiness.provider?.kind).toBe("ollama");
    expect(classifyProviderReadinessState(readiness, true)).toBe("local_provider_ready");
    expect(modelStatusText(ollamaModel, ollamaProvider)).toBe("llama3.2 (Ollama Local): ready; chat supported, streaming supported, tools unsupported, reasoning unsupported");
  });

  it("classifies browser-first readiness states distinctly", () => {
    const demoModel = model({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" });
    const demo = provider({ id: "yet-demo", kind: "demo-local", displayName: "Yet AI Demo Mode", baseUrl: "local-runtime-demo-mode", auth: { type: "none", configured: true }, models: [demoModel] });
    const realReady = resolveProviderModelReadiness([model()], [provider()], null);
    const demoReady = resolveProviderModelReadiness([demoModel], [demo], null);
    const mismatch = resolveProviderModelReadiness([model({ providerId: "missing-provider" })], [provider()], null);
    const modelNotReady = resolveProviderModelReadiness([model({ readiness: { status: "missing_credentials", reason: "saved key has not tested yet" } })], [provider()], null);
    const required = resolveProviderModelReadiness([], [], null);

    expect(classifyProviderReadinessState(realReady, false)).toBe("runtime_unavailable");
    expect(classifyProviderReadinessState(demoReady, true)).toBe("demo_mode_ready");
    expect(classifyProviderReadinessState(realReady, true)).toBe("openai_compatible_ready");
    expect(classifyProviderReadinessState(resolveProviderModelReadiness([model({ providerId: "custom-local" })], [provider({ id: "custom-local", kind: "custom", displayName: "Custom Local", auth: { type: "none", configured: false } })], null), true)).toBe("local_provider_ready");
    expect(classifyProviderReadinessState(mismatch, true)).toBe("model_provider_mismatch");
    expect(classifyProviderReadinessState(modelNotReady, true)).toBe("missing_credentials");
    expect(classifyProviderReadinessState(required, true)).toBe("provider_required");
  });

  it("keeps model errors and missing provider metadata send-blocking with recovery copy", () => {
    const readiness = resolveProviderModelReadiness([model()], [provider()], { status: "network", message: "failed" });

    expect(readiness.ready).toBe(false);
    expect(readiness.mismatch).toBe(false);
    expect(readiness.message).toContain("could not reach the local runtime or provider");
    expect(classifyProviderReadinessState(readiness, true)).toBe("provider_error");
    expect(resolveProviderModelReadiness([], [], null)).toEqual({ ready: false, mismatch: false });
  });

  it("reports provider/model mismatches with recovery guidance", () => {
    const readiness = resolveProviderModelReadiness([model({ providerId: "other-runtime" })], [provider()], null);

    expect(readiness.ready).toBe(false);
    expect(readiness.mismatch).toBe(true);
    expect(readiness.message).toBe("Runtime model/provider mismatch. Test the saved provider, fix the provider/model id mapping locally, then Refresh runtime before sending. Model GPT-4o mini is not available on enabled provider other-runtime.");
  });

  it("reports missing readiness metadata", () => {
    const incomplete = model({ capabilities: undefined, readiness: undefined });

    expect(missingModelMetadataMessage(incomplete)).toBe("Model GPT-4o mini is missing readiness metadata from the local runtime. Refresh runtime after updating it; if this persists, test the provider before sending.");
    expect(resolveProviderModelReadiness([incomplete], [provider()], null).message).toBe("Model GPT-4o mini is missing readiness metadata from the local runtime. Refresh runtime after updating it; if this persists, test the provider before sending.");
  });

  it("reports missing credentials, missing models, and unsupported models with recovery actions", () => {
    const missingCredentials = model({ readiness: { status: "missing_credentials", reason: "saved key has not tested yet" } });
    const missingHostedModel = model({ readiness: { status: "missing_model", reason: "model id not returned by provider" } });
    const unsupported = model({ capabilities: { chat: true, streaming: false, tools: false, reasoning: false } });

    expect(modelUnreadyMessage(missingCredentials, provider())).toBe("Provider credentials are required before GPT-4o mini can send. Save the provider API key in the local runtime, then Test provider and Refresh runtime. Runtime detail: saved key has not tested yet");
    expect(classifyProviderReadinessState(resolveProviderModelReadiness([missingCredentials], [provider()], null), true)).toBe("missing_credentials");
    expect(modelUnreadyMessage(missingHostedModel, provider())).toBe("Model GPT-4o mini is not available from the configured provider. Check the saved model id or choose a provider-returned model, then Test provider and Refresh runtime. Runtime detail: model id not returned by provider");
    expect(resolveProviderModelReadiness([unsupported], [provider()], null).message).toBe("Model GPT-4o mini cannot send chat because required capabilities are unavailable: chat supported, streaming unsupported, tools unsupported, reasoning unsupported. Choose a chat + streaming capable model, then refresh runtime.");
    expect(classifyProviderReadinessState(resolveProviderModelReadiness([unsupported], [provider()], null), true)).toBe("unsupported_model");
  });

  it("reports local Ollama unready separately from hosted missing models", () => {
    const ollamaModel = model({ id: "llama3.2", displayName: "llama3.2", providerId: "ollama-local", readiness: { status: "missing_model", reason: "pull required" } });
    const ollamaProvider = provider({
      id: "ollama-local",
      kind: "ollama",
      displayName: "Ollama Local",
      baseUrl: "http://127.0.0.1:11434",
      auth: { type: "none", configured: false },
      models: [ollamaModel],
    });
    const readiness = resolveProviderModelReadiness([ollamaModel], [ollamaProvider], null);

    expect(classifyProviderReadinessState(readiness, true)).toBe("local_provider_unready");
    expect(readiness.message).toBe("Local Ollama model llama3.2 is not available yet. Start Ollama, pull or choose the model locally, Test provider, then Refresh runtime. Runtime detail: pull required");
  });

  it("maps timeout and HTTP-like model refresh failures to conservative recovery copy", () => {
    expect(runtimeModelErrorMessage({ status: "timeout", message: "provider timed out" })).toContain("readiness timed out");
    expect(runtimeModelErrorMessage({ status: 401, message: "Authorization: Bearer secret-token" })).toContain("provider API keys are separate");
    expect(runtimeModelErrorMessage({ status: 429, message: "quota exceeded" })).toContain("rate limit");
    expect(runtimeModelErrorMessage({ status: 404, message: "not found" })).toContain("model endpoint was not found");
  });

  it("sanitizes token-like model ids, provider ids, and readiness reasons in visible output", () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    const unsafeModel = model({ id: `model-${rawSecret}`, displayName: `Model ${rawSecret}`, providerId: `provider-${rawSecret}`, readiness: { status: "disabled", reason: `Bearer ${"b".repeat(32)} ${rawSecret}` } });
    const unsafeProvider = provider({ id: `provider-${rawSecret}`, displayName: `Provider ${rawSecret}`, models: [unsafeModel] });

    const status = modelStatusText(unsafeModel, unsafeProvider);
    const unready = modelUnreadyMessage(unsafeModel);
    const mismatch = modelProviderMismatchMessage(unsafeModel, unsafeProvider);

    expect(status).toContain("disabled");
    expect(status).toContain("chat supported, streaming supported, tools unsupported, reasoning unsupported");
    for (const text of [status, unready, mismatch]) {
      expect(text).toContain("[redacted]");
      expect(text).not.toContain("access_token");
      expect(text).not.toContain("s".repeat(64));
      expect(text).not.toContain("b".repeat(32));
    }
  });

  it("keeps status and capability labels stable", () => {
    expect(readinessStatusLabel("missing_credentials")).toBe("missing credentials");
    expect(readinessStatusLabel(undefined)).toBe("unknown readiness");
    expect(modelCapabilitySummary(model({ capabilities: undefined }))).toBe("capabilities missing");
    expect(modelStatusText(model(), provider())).toBe("GPT-4o mini (OpenAI API): ready; chat supported, streaming supported, tools unsupported, reasoning unsupported");
  });
});
