import { describe, expect, it } from "vitest";
import type { ControlledHostCapabilitiesPayload } from "../bridge/bridgeAdapter";
import { classifyControlledCapabilityProvenance, type ControlledCapabilitySurface } from "./controlledCapabilityProvenance";

const vscodeHostCapabilities: ControlledHostCapabilitiesPayload = {
  protocolVersion: "controlled_host_capabilities_v2",
  hostSurface: "vscode",
  authority: "metadata_only",
  capabilities: {
    controlledStart: "supported",
    controlledRead: "supported",
    controlledEdit: "supported",
    controlledVerification: "supported",
    controlledRepair: "preview_only",
  },
  correlationRequirements: ["host_ready_request_id"],
  authorityFlags: { metadataOnly: true, controlledRead: false, controlledEdit: false, controlledVerification: false },
  limits: {
    maxReadBytes: 1,
    maxReadLines: 1,
    maxEditFiles: 1,
    maxEditOperations: 1,
    maxPatchBytes: 1,
    maxVerificationOutputBytes: 1,
    maxVerificationOutputLines: 1,
    maxRepairAttempts: 1,
  },
  reasonCodes: [],
  safeLabels: { host: "VS Code", support: "bounded executor" },
};

describe("classifyControlledCapabilityProvenance", () => {
  it.each([
    { name: "real caps absent", input: { host: "vscode" as const }, surface: "workspace_readiness" as const, status: "unsupported", executionSupport: "unavailable" },
    { name: "host-supported VS Code executor", input: { host: "vscode" as const, hostCapabilities: vscodeHostCapabilities }, surface: "controlled_read" as const, status: "live_host", executionSupport: "available" },
    { name: "JetBrains fail-closed", input: { host: "jetbrains" as const, hostCapabilities: { ...vscodeHostCapabilities, hostSurface: "jetbrains" as const } }, surface: "controlled_read" as const, status: "unsupported", executionSupport: "unavailable" },
    { name: "browser unsupported", input: { host: "browser" as const }, surface: "controlled_edit" as const, status: "unsupported", executionSupport: "unavailable" },
    { name: "fixture demo", input: { host: "vscode" as const, caps: { controlledAgentWorkflowTranscript: { state: "completed" } } as never }, surface: "controlled_transcript" as const, status: "fixture_demo", executionSupport: "unavailable" },
    { name: "local reducer state", input: { host: "browser" as const, localState: { run_state: true } }, surface: "controlled_run_state" as const, status: "local_derived", executionSupport: "unavailable" },
  ])("classifies $name conservatively", ({ input, surface, status, executionSupport }) => {
    const result = classifyControlledCapabilityProvenance(input)[surface];

    expect(result.status).toBe(status);
    expect(result.executionSupport).toBe(executionSupport);
    expect(result.grantsExecutionAuthority).toBe(false);
    expect(result.evidenceLabel.length).toBeGreaterThan(0);
    expect(result.safeReason.length).toBeGreaterThan(0);
  });

  it("returns a typed classification for every controlled App surface", () => {
    const result = classifyControlledCapabilityProvenance({ host: "vscode", hostCapabilities: vscodeHostCapabilities, localState: { run_state: true, recovery: true } });
    const expected: ControlledCapabilitySurface[] = [
      "workspace_readiness", "controlled_read", "controlled_search", "controlled_edit", "controlled_patch_plan", "controlled_multifile", "controlled_verification_run", "controlled_verification_bundle", "controlled_runtime_session", "controlled_run_state", "controlled_recovery", "controlled_task_harness", "controlled_two_step_run", "controlled_transcript",
    ];

    expect(Object.keys(result).sort()).toEqual([...expected].sort());
    expect(Object.values(result).every((item) => item.host === "vscode")).toBe(true);
  });

  it("does not promote unknown host metadata or fixture presence to live authority", () => {
    const mismatched = classifyControlledCapabilityProvenance({
      host: "jetbrains",
      hostCapabilities: vscodeHostCapabilities,
      caps: { controlledAgentFileRead: { allowedToRead: true } } as never,
    });

    expect(mismatched.controlled_read.status).toBe("fixture_demo");
    expect(mismatched.controlled_read.readiness).toBe("display_only");
    expect(mismatched.controlled_read.executionSupport).toBe("unavailable");
    expect(mismatched.controlled_read.grantsExecutionAuthority).toBe(false);
  });
});
