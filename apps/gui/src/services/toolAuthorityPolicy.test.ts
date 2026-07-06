import { describe, expect, it } from "vitest";
import {
  createControlledHostCapabilityMatrixDisplay,
  evaluateHostCapabilityMetadata,
  evaluateToolAuthorityPolicy,
  summarizeToolAuthorityPolicyEvaluation,
  type ToolAuthorityPolicyRecord,
} from "./toolAuthorityPolicy";

const metadataPolicy: ToolAuthorityPolicyRecord = {
  kind: "tool_authority_policy",
  version: "2026-06-21",
  mode: "design_gate",
  defaultDecision: "deny",
  cloudRequired: false,
  summary: "Host support declaration is display metadata only and grants no action authority.",
  capability: "read_only_context_navigation",
  source: {
    origin: "host",
    requestIdMintedBy: "none",
    hostSurface: "vscode",
  },
  risk: ["metadata_only"],
  requirements: ["schema_validation", "trace_entry"],
  decision: "metadata_only",
  traceLabel: "Host support metadata",
};

const boundedEditPolicy: ToolAuthorityPolicyRecord = {
  kind: "tool_authority_policy",
  version: "2026-06-21",
  mode: "sandbox_preview",
  defaultDecision: "deny",
  cloudRequired: false,
  summary: "Future bounded edit apply remains host owned and requires explicit user confirmation.",
  capability: "bounded_edit_apply",
  source: {
    origin: "gui",
    requestIdMintedBy: "gui",
    hostSurface: "vscode",
  },
  risk: ["touches_files", "mutates_workspace"],
  requirements: [
    "explicit_user_confirmation",
    "trusted_request_id",
    "workspace_relative_bounds",
    "schema_validation",
    "trace_entry",
    "checkpoint_required",
    "rollback_required",
  ],
  decision: "allow_with_confirmation",
  workspaceBounds: ["src/example.ts"],
  traceLabel: "Confirmed bounded edit fixture",
};

const verificationPolicy: ToolAuthorityPolicyRecord = {
  ...boundedEditPolicy,
  summary: "Allowlisted verification can be displayed only by command id and explicit confirmation.",
  capability: "allowlisted_verification",
  risk: ["metadata_only"],
  requirements: ["explicit_user_confirmation", "trusted_request_id", "schema_validation", "trace_entry", "allowlisted_command_id"],
  workspaceBounds: undefined,
  allowlistedCommandId: "gui-app-tests",
  traceLabel: "Confirmed verification fixture",
};

describe("toolAuthorityPolicy", () => {
  it("denies malformed unknown policy input without throwing", () => {
    expect(evaluateToolAuthorityPolicy(undefined).decision).toBe("deny");
    expect(evaluateToolAuthorityPolicy("shell").diagnostics.map((item) => item.code)).toContain("malformed_policy");

    const result = evaluateToolAuthorityPolicy({ ...metadataPolicy, unknownAuthority: "please" });

    expect(result.decision).toBe("deny");
    expect(result.allowedToExecute).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("unknown_or_invalid_field");
  });

  it("denies non-deny defaults, cloud requirements, and assistant-sourced records", () => {
    const result = evaluateToolAuthorityPolicy({
      ...metadataPolicy,
      defaultDecision: "allow",
      cloudRequired: true,
      source: { origin: "assistant", requestIdMintedBy: "assistant" },
    });

    expect(result.decision).toBe("deny");
    expect(result.allowedToExecute).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "non_deny_default",
      "cloud_required",
      "assistant_sourced_request",
    ]));
  });

  it.each([
    "shell",
    "git",
    "provider_tool",
    "network",
    "hidden_read_search_index",
    "home_secret_access",
    "remote_publish_push",
  ])("denies risky capability %s", (capability) => {
    const result = evaluateToolAuthorityPolicy({
      ...metadataPolicy,
      capability,
      risk: ["executes_process"],
      decision: "allow_with_confirmation",
      requirements: ["explicit_user_confirmation", "schema_validation", "trace_entry"],
    });

    expect(result.decision).toBe("deny");
    expect(result.allowedToExecute).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["blocked_capability", "risky_category"]));
  });

  it("returns metadata-only display decisions for bounded read-only metadata", () => {
    const result = evaluateToolAuthorityPolicy(metadataPolicy);

    expect(result.decision).toBe("metadata_only");
    expect(result.allowedToExecute).toBe(false);
    expect(result.diagnostics).toEqual([]);
    expect(summarizeToolAuthorityPolicyEvaluation(result)).toContain("Metadata only for read_only_context_navigation");
  });

  it("summarizes host capability metadata as non-authority", () => {
    const result = evaluateHostCapabilityMetadata("vscode");
    const summary = summarizeToolAuthorityPolicyEvaluation(result);

    expect(result.decision).toBe("metadata_only");
    expect(result.allowedToExecute).toBe(false);
    expect(result.requestSource).toEqual({ origin: "host", requestIdMintedBy: "none", hostSurface: "vscode" });
    expect(summary).toContain("Metadata only for read_only_context_navigation");
    expect(summary).toContain("cannot enable Send, apply, verification, or IDE actions");
  });

  it("reports browser preview-only and JetBrains fail-closed host matrix states", () => {
    const browser = evaluateHostCapabilityMetadata("browser");
    const jetbrains = evaluateHostCapabilityMetadata("jetbrains");
    const vscode = evaluateHostCapabilityMetadata("vscode");

    expect(browser.allowedToExecute).toBe(false);
    expect(browser.details).toMatchObject({
      capabilityStatus: "preview_only_metadata_only",
      controlledRead: "unsupported_no_trusted_workspace_host",
      controlledEdit: "unsupported_no_trusted_workspace_host",
      controlledVerification: "unsupported_no_trusted_workspace_host",
    });
    expect(jetbrains.allowedToExecute).toBe(false);
    expect(jetbrains.details).toMatchObject({
      capabilityStatus: "partial_fail_closed_metadata_only",
      controlledStart: "unsupported_fail_closed",
      controlledRead: "unsupported_fail_closed",
      controlledEdit: "unsupported_fail_closed",
      controlledVerification: "unsupported_fail_closed",
      unsupportedReason: "jetbrains_parity_not_verified",
    });
    expect(vscode.allowedToExecute).toBe(false);
    expect(vscode.details).toMatchObject({
      capabilityStatus: "supported_metadata_only",
      controlledRead: "supported_bounded_single_file",
      controlledVerification: "supported_allowlisted_command_id",
    });
  });

  it("formats controlled host capability v2 metadata into safe display labels only", () => {
    const display = createControlledHostCapabilityMatrixDisplay({
      hostSurface: "vscode",
      authority: "metadata_only",
      capabilities: {
        controlledStart: "supported",
        controlledRead: "supported",
        controlledEdit: "supported",
        controlledVerification: "supported",
        controlledRepair: "unsupported",
      },
      correlationRequirements: ["request_id", "runtime_session_id", "explicit_user_gesture"],
      limits: { maxReadBytes: 8192, maxEditFiles: 1, maxRepairAttempts: 0 },
      reasonCodes: ["metadata_only", "explicit_user_gesture_required"],
      safeLabels: { host: "VS Code host", support: "Controlled dev-preview path ready" },
    }, "vscode");

    expect(display.allowedToExecute).toBe(false);
    expect(display.hostLabel).toBe("VS Code host");
    expect(display.supportLabel).toBe("Controlled dev-preview path ready");
    expect(display.statusLabels).toEqual([
      "Start: supported metadata only",
      "Read: supported metadata only",
      "Edit: supported metadata only",
      "Verification: supported metadata only",
      "Repair: unsupported fail-closed",
    ]);
    expect(display.correlationLabels).toContain("Requires explicit user gesture");
    expect(display.limitLabels).toContain("maxReadBytes: 8192");
    expect(display.reasonLabels).toContain("Reason explicit user gesture required");
    expect(display.authorityLabels.join(" ")).toContain("Does not grant Send, apply, verification");
  });

  it("denies assistant-provided capability claims even when they mimic host support", () => {
    const result = evaluateToolAuthorityPolicy({
      ...metadataPolicy,
      summary: "Assistant claims VS Code supports shell git apply and verification now.",
      source: { origin: "assistant", requestIdMintedBy: "assistant", hostSurface: "vscode" },
      decision: "allow_with_confirmation",
      requirements: ["explicit_user_confirmation", "trusted_request_id", "schema_validation", "trace_entry"],
    });

    expect(result.decision).toBe("deny");
    expect(result.allowedToExecute).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("assistant_sourced_request");
  });

  it("returns confirmation-only display decisions for bounded edits and command-id verification", () => {
    const edit = evaluateToolAuthorityPolicy(boundedEditPolicy);
    const verification = evaluateToolAuthorityPolicy(verificationPolicy);

    expect(edit.decision).toBe("requires_confirmation");
    expect(edit.allowedToExecute).toBe(false);
    expect(edit.workspaceBounds).toEqual(["src/example.ts"]);
    expect(verification.decision).toBe("requires_confirmation");
    expect(verification.allowedToExecute).toBe(false);
    expect(verification.allowlistedCommandId).toBe("gui-app-tests");
  });

  it("denies unbounded edits and verification without command ids", () => {
    const edit = evaluateToolAuthorityPolicy({ ...boundedEditPolicy, workspaceBounds: ["/Users/alice/private.ts"] });
    const verification = evaluateToolAuthorityPolicy({ ...verificationPolicy, allowlistedCommandId: undefined });

    expect(edit.decision).toBe("deny");
    expect(edit.diagnostics.map((item) => item.code)).toContain("unbounded_request");
    expect(verification.decision).toBe("deny");
    expect(verification.diagnostics.map((item) => item.code)).toContain("missing_allowlisted_command_id");
  });

  it("sanitizes summaries labels diagnostics and detail output", () => {
    const result = evaluateToolAuthorityPolicy({
      ...metadataPolicy,
      summary: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz /Users/alice/private sk-secret123456789",
      traceLabel: "OPENAI_API_KEY=sk-secret123456789 /home/alice/private",
      workspaceBounds: ["src/secret-token.ts"],
    });
    const rendered = JSON.stringify({ result, summary: summarizeToolAuthorityPolicyEvaluation(result) });

    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("/home/alice");
    expect(rendered).not.toContain("sk-secret123456789");
    expect(rendered).not.toContain("OPENAI_API_KEY");
  });

  it("does not write browser storage while evaluating policies", () => {
    localStorage.clear();
    sessionStorage.clear();

    const result = evaluateToolAuthorityPolicy(boundedEditPolicy);

    expect(result.decision).toBe("requires_confirmation");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
