import { describe, expect, it } from "vitest";
import { chatLifecycleLabels, chatRecoveryCopyForCode, chatRecoveryCopyForRuntimeError, formatChatErrorMessage, type ChatLifecycleState } from "./chatLifecycle";

describe("chatLifecycle", () => {
  it("defines stable labels for all chat send and SSE states", () => {
    const states: ChatLifecycleState[] = ["idle", "command_submitting", "command_accepted", "sse_connecting", "streaming", "stopped", "failed"];
    for (const state of states) {
      expect(chatLifecycleLabels[state]).toEqual(expect.any(String));
      expect(chatLifecycleLabels[state].length).toBeGreaterThan(10);
    }
    expect(chatLifecycleLabels.command_accepted).toContain("waiting");
    expect(chatLifecycleLabels.streaming).toContain("streaming");
    expect(chatLifecycleLabels.stopped).toContain("abort requested");
    expect(chatLifecycleLabels.failed).toContain("No automatic retry");
  });

  it("returns actionable recovery copy for runtime, command, SSE, provider, and Stop cases", () => {
    expect(chatRecoveryCopyForCode("provider_unauthorized")).toContain("Provider API key");
    expect(chatRecoveryCopyForCode("provider_unauthorized")).toContain("Session token");
    expect(chatRecoveryCopyForCode("provider_context_too_large")).toContain("reduce the prompt or attached editor context");
    expect(chatRecoveryCopyForCode("user_stop")).toContain("stream stopped locally");
    expect(chatRecoveryCopyForCode("unknown_code")).toContain("No automatic retry");
  });

  it("classifies runtime errors without exposing provider secrets", () => {
    expect(chatRecoveryCopyForRuntimeError({ status: 401, message: "Unauthorized" }, "sse")).toContain("Session token mismatch");
    expect(chatRecoveryCopyForRuntimeError({ status: "network", message: "failed" }, "sse")).toContain("Refresh runtime");
    expect(chatRecoveryCopyForRuntimeError({ status: "configuration", message: "provider missing" }, "command")).toContain("BYOK provider/model");
    expect(chatRecoveryCopyForRuntimeError({ status: 500, message: "server failed" }, "command")).toContain("command endpoint");
  });

  it("formats sanitized bounded error messages with recovery guidance", () => {
    const formatted = formatChatErrorMessage("failed Authorization: Bearer super-secret-token", chatRecoveryCopyForCode("provider_request_failed"), 160);
    expect(formatted).toContain("failed [redacted]");
    expect(formatted).toContain("Recovery:");
    expect(formatted).not.toContain("super-secret-token");
    expect(formatted.length).toBeLessThanOrEqual(170);
  });
});
