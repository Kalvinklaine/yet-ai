import type { BridgeHost, ControlledHostCapabilitiesPayload } from "../bridge/bridgeAdapter";
import type { CapsResponse } from "./runtimeClient";

export type CapabilityProvenanceStatus = "live_engine" | "live_host" | "local_derived" | "fixture_demo" | "unsupported";
export type ControlledCapabilityReadiness = "ready" | "display_only" | "unsupported";

export type ControlledCapabilitySurface =
  | "workspace_readiness"
  | "controlled_read"
  | "controlled_search"
  | "controlled_edit"
  | "controlled_patch_plan"
  | "controlled_multifile"
  | "controlled_verification_run"
  | "controlled_verification_bundle"
  | "controlled_runtime_session"
  | "controlled_run_state"
  | "controlled_recovery"
  | "controlled_task_harness"
  | "controlled_two_step_run"
  | "controlled_transcript";

export type ControlledCapabilityProvenance = {
  surface: ControlledCapabilitySurface;
  status: CapabilityProvenanceStatus;
  host: BridgeHost | "unknown";
  readiness: ControlledCapabilityReadiness;
  visible: boolean;
  executionSupport: "available" | "unavailable";
  grantsExecutionAuthority: false;
  evidenceLabel: string;
  safeReason: string;
};

export type ControlledCapabilityProvenanceMap = Record<ControlledCapabilitySurface, ControlledCapabilityProvenance>;

export type ControlledCapabilityProvenanceInput = {
  host?: BridgeHost;
  caps?: CapsResponse | null;
  hostCapabilities?: ControlledHostCapabilitiesPayload;
  localState?: Partial<Record<"run_state" | "recovery", boolean>>;
};

export function isLiveControlledCapability(provenance: ControlledCapabilityProvenance | undefined, surface: ControlledCapabilitySurface, host?: BridgeHost | "unknown"): boolean {
  return provenance?.surface === surface
    && provenance.status === "live_host"
    && provenance.readiness === "ready"
    && provenance.executionSupport === "available"
    && (host === undefined || provenance.host === host);
}

export function controlledCapabilityPresentation(provenance: ControlledCapabilityProvenance | undefined, surface: ControlledCapabilitySurface, host?: BridgeHost | "unknown"): { liveReady: boolean; label: string; copy: string } {
  const liveReady = isLiveControlledCapability(provenance, surface, host);
  if (liveReady) {
    return { liveReady, label: "live host", copy: provenance?.safeReason ?? "Live host evidence is available; existing user and request gates still apply." };
  }
  if (!provenance || provenance.surface !== surface || host !== undefined && provenance.host !== host) {
    return { liveReady: false, label: "unsupported", copy: "No matching live host provenance is available. This surface stays fail-closed." };
  }
  if (provenance.status === "fixture_demo") {
    return { liveReady: false, label: "fixture demo", copy: `${provenance.evidenceLabel}. Display evidence only; no live action is enabled.` };
  }
  if (provenance.status === "local_derived") {
    return { liveReady: false, label: "local derived", copy: `${provenance.evidenceLabel}. Local GUI state does not prove a live executor.` };
  }
  return { liveReady: false, label: "unsupported", copy: provenance.safeReason };
}

const surfaces: ControlledCapabilitySurface[] = [
  "workspace_readiness",
  "controlled_read",
  "controlled_search",
  "controlled_edit",
  "controlled_patch_plan",
  "controlled_multifile",
  "controlled_verification_run",
  "controlled_verification_bundle",
  "controlled_runtime_session",
  "controlled_run_state",
  "controlled_recovery",
  "controlled_task_harness",
  "controlled_two_step_run",
  "controlled_transcript",
];

const capsFields: Partial<Record<ControlledCapabilitySurface, string[]>> = {
  workspace_readiness: ["controlledAgentWorkspaceReadiness"],
  controlled_read: ["controlledAgentFileRead"],
  controlled_edit: ["controlledAgentEditExecutor"],
  controlled_patch_plan: ["controlledAgentPatchPlan"],
  controlled_multifile: ["controlledAgentMultifilePatchPlan", "controlledAgentMultifileApply"],
  controlled_verification_run: ["controlledAgentCommandRunner"],
  controlled_verification_bundle: ["controlledAgentVerificationBundle"],
  controlled_runtime_session: ["controlledAgentRuntimeSession"],
  controlled_task_harness: ["controlledAgentTaskHarness"],
  controlled_two_step_run: ["controlledAgentTwoStepRun"],
  controlled_transcript: ["controlledAgentWorkflowTranscript"],
};

const hostCapabilityKeys: Partial<Record<ControlledCapabilitySurface, keyof ControlledHostCapabilitiesPayload["capabilities"]>> = {
  controlled_read: "controlledRead",
  controlled_search: "controlledRead",
  controlled_edit: "controlledEdit",
  controlled_multifile: "controlledEdit",
  controlled_verification_run: "controlledVerification",
  controlled_verification_bundle: "controlledVerification",
};

const liveHostEvidence: Partial<Record<ControlledCapabilitySurface, string>> = {
  controlled_read: "Bounded VS Code host executor",
  controlled_search: "Bounded VS Code lexical search executor",
  controlled_edit: "Bounded VS Code replacement executor",
  controlled_multifile: "Bounded VS Code multi-file executor",
  controlled_verification_run: "Allowlisted VS Code command executor",
  controlled_verification_bundle: "Allowlisted VS Code verification executor",
};

export function classifyControlledCapabilityProvenance(input: ControlledCapabilityProvenanceInput): ControlledCapabilityProvenanceMap {
  const host = input.host ?? "unknown";
  const caps = recordValue(input.caps);
  const trustedHostCapabilities = validHostCapabilities(input.hostCapabilities, host) ? input.hostCapabilities : undefined;
  const localState = input.localState ?? {};

  return Object.fromEntries(surfaces.map((surface) => {
    if (surface === "controlled_run_state" || surface === "controlled_recovery") {
      const present = surface === "controlled_run_state" ? localState.run_state === true : localState.recovery === true;
      return [surface, provenance(surface, host, present ? "local_derived" : "unsupported", present ? "display_only" : "unsupported", present, "unavailable", present ? "GUI-local reducer state" : "No current local reducer evidence", present ? "Computed locally from sanitized GUI state; it does not prove an engine or host runner." : "No current local state proves this surface is available.")];
    }

    const hostCapabilityKey = hostCapabilityKeys[surface];
    const hostSupported = host === "vscode" && hostCapabilityKey !== undefined && trustedHostCapabilities?.capabilities[hostCapabilityKey] === "supported";
    if (hostSupported) {
      return [surface, provenance(surface, host, "live_host", "ready", true, "available", liveHostEvidence[surface] ?? "Bounded VS Code host executor", "The installed host supports this bounded executor, but provenance metadata does not authorize a request; explicit confirmation and request correlation still apply.")];
    }

    const fixturePresent = (capsFields[surface] ?? []).some((field) => caps[field] !== undefined);
    if (fixturePresent) {
      return [surface, provenance(surface, host, "fixture_demo", "display_only", true, "unavailable", "Fixture or mock capability metadata", "Controlled metadata is visible for contract or demo rendering only and does not establish execution authority.")];
    }

    return [surface, provenance(surface, host, "unsupported", "unsupported", false, "unavailable", "No authoritative capability evidence", host === "browser" ? "Browser has no trusted controlled executor for this surface." : host === "jetbrains" ? "JetBrains controlled execution is intentionally fail-closed for this surface." : "Missing or unknown capability data fails closed.")];
  })) as ControlledCapabilityProvenanceMap;
}

function provenance(surface: ControlledCapabilitySurface, host: BridgeHost | "unknown", status: CapabilityProvenanceStatus, readiness: ControlledCapabilityReadiness, visible: boolean, executionSupport: "available" | "unavailable", evidenceLabel: string, safeReason: string): ControlledCapabilityProvenance {
  return { surface, status, host, readiness, visible, executionSupport, grantsExecutionAuthority: false, evidenceLabel, safeReason };
}

function validHostCapabilities(value: ControlledHostCapabilitiesPayload | undefined, host: BridgeHost | "unknown"): value is ControlledHostCapabilitiesPayload {
  return value?.protocolVersion === "controlled_host_capabilities_v2" && value.authority === "metadata_only" && value.hostSurface === host;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
