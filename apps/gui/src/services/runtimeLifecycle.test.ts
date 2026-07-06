import { describe, expect, it } from "vitest";
import type { HostRuntimeStatusPayload } from "../bridge/bridgeAdapter";
import { runtimeLifecycleDiagnostics, runtimeLifecycleHostCopy } from "./runtimeLifecycle";

const connected: HostRuntimeStatusPayload = {
  protocolVersion: "2026-06-21",
  surface: "vscode",
  lifecycle: "connected",
  runtimeOwner: "ide_host",
  launchMode: "auto",
  tokenState: "present",
  processState: "running",
  diagnosis: "runtime connected",
  nextAction: "Type a prompt or refresh provider readiness.",
  cloudRequired: false,
  authority: "metadata_only",
};

describe("runtimeLifecycle", () => {
  it("formats connected lifecycle evidence without token values", () => {
    const diagnostics = runtimeLifecycleDiagnostics(connected, "vscode");

    expect(diagnostics.title).toBe("Runtime connected");
    expect(diagnostics.status).toContain("VS Code reports runtime connected");
    expect(diagnostics.evidence).toContain("Token: present, value hidden");
    expect(diagnostics.guidance).toContain("Refresh runtime first");
    expect(diagnostics.evidence).not.toContain("Bearer");
  });

  it("renders auth mismatch guidance without exposing token copy", () => {
    const diagnostics = runtimeLifecycleDiagnostics({ ...connected, lifecycle: "auth_mismatch", tokenState: "mismatch", diagnosis: "runtime rejected the current local credentials", nextAction: "Update local connection." }, "jetbrains");

    expect(diagnostics.title).toBe("Runtime authorization mismatch");
    expect(diagnostics.guidance).toContain("Runtime session mismatch");
    expect(diagnostics.guidance).toContain("Raw token values are never shown here");
    expect(diagnostics.guidance).not.toContain("session-token-value");
  });

  it("bounds and sanitizes lifecycle guidance", () => {
    const diagnostics = runtimeLifecycleDiagnostics({ ...connected, lifecycle: "failed", diagnosis: `runtime failed Bearer unsafe-secret-value ${"z".repeat(500)}`, nextAction: "Check /Users/alice/private/runtime.log and retry." }, "vscode");

    expect(diagnostics.evidence.length).toBeLessThanOrEqual(360);
    expect(diagnostics.guidance.length).toBeLessThanOrEqual(360);
    expect(diagnostics.evidence).toContain("[redacted]");
    expect(diagnostics.guidance).toContain("[redacted]");
    expect(diagnostics.evidence).not.toContain("Bearer");
    expect(diagnostics.guidance).not.toContain("/Users/alice");
  });

  it("keeps browser preview copy connect-only", () => {
    const browserCopy = runtimeLifecycleHostCopy("browser");

    expect(browserCopy).toContain("Browser standalone mode connects to a running loopback runtime");
    expect(browserCopy).toContain("Demo Mode, Ollama, and OpenAI-compatible BYOK models");
    expect(browserCopy).toContain("it cannot launch/restart runtime or run host actions");
    expect(runtimeLifecycleHostCopy("vscode")).toContain("Runtime recovery is IDE-managed");
  });
});
