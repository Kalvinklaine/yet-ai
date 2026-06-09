import { describe, expect, it } from "vitest";
import type { ProviderSummary } from "./providersClient";
import type { ModelSummary } from "./runtimeClient";
import { missingModelMetadataMessage, modelCapabilitySummary, modelProviderMismatchMessage, modelStatusText, modelUnreadyMessage, readinessStatusLabel, resolveProviderModelReadiness } from "./providerReadiness";

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

  it("keeps model errors and missing provider metadata send-blocking", () => {
    expect(resolveProviderModelReadiness([model()], [provider()], { status: "network", message: "failed" })).toEqual({ ready: false, mismatch: false });
    expect(resolveProviderModelReadiness([], [], null)).toEqual({ ready: false, mismatch: false });
  });

  it("reports provider/model mismatches without changing copy", () => {
    const readiness = resolveProviderModelReadiness([model({ providerId: "other-runtime" })], [provider()], null);

    expect(readiness.ready).toBe(false);
    expect(readiness.mismatch).toBe(true);
    expect(readiness.message).toBe("Runtime model/provider mismatch. Refresh runtime or test/save provider before sending. Model GPT-4o mini is not available on enabled provider other-runtime.");
  });

  it("reports missing readiness metadata", () => {
    const incomplete = model({ capabilities: undefined, readiness: undefined });

    expect(missingModelMetadataMessage(incomplete)).toBe("Model GPT-4o mini is missing readiness metadata from the runtime. Refresh the runtime after updating it before sending.");
    expect(resolveProviderModelReadiness([incomplete], [provider()], null).message).toBe("Model GPT-4o mini is missing readiness metadata from the runtime. Refresh the runtime after updating it before sending.");
  });

  it("reports unready and unsupported models with reason/capabilities", () => {
    const unready = model({ readiness: { status: "missing_model", reason: "model id not returned by provider" } });
    const unsupported = model({ capabilities: { chat: true, streaming: false, tools: false, reasoning: false } });

    expect(modelUnreadyMessage(unready)).toBe("Model GPT-4o mini is not ready for chat streaming: missing model. model id not returned by provider");
    expect(resolveProviderModelReadiness([unsupported], [provider()], null).message).toBe("Model GPT-4o mini cannot send chat because required capabilities are unavailable: chat supported, streaming unsupported, tools unsupported, reasoning unsupported.");
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
