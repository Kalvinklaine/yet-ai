import type { BridgeHost, HostRuntimeStatusPayload } from "../bridge/bridgeAdapter";
import { sanitizeDisplayText } from "./redaction";

export type RuntimeLifecycleDiagnostics = {
  title: string;
  status: string;
  evidence: string;
  guidance: string;
  surface: BridgeHost;
  lifecycle: HostRuntimeStatusPayload["lifecycle"];
};

const lifecycleLabels: Record<HostRuntimeStatusPayload["lifecycle"], string> = {
  unknown: "Runtime status unknown",
  checking: "Runtime check in progress",
  starting: "Runtime starting",
  connected: "Runtime connected",
  degraded: "Runtime degraded",
  disconnected: "Runtime disconnected",
  restarting: "Runtime restarting",
  stopped: "Runtime stopped",
  auth_mismatch: "Runtime authorization mismatch",
  invalid_settings: "Runtime settings need review",
  failed: "Runtime launch failed",
};

const surfaceLabels: Record<BridgeHost, string> = {
  browser: "Browser preview",
  vscode: "VS Code",
  jetbrains: "JetBrains",
};

export function runtimeLifecycleDiagnostics(payload: HostRuntimeStatusPayload, host: BridgeHost): RuntimeLifecycleDiagnostics {
  const surface = payload.surface;
  const title = lifecycleLabels[payload.lifecycle];
  const status = `${surfaceLabels[surface]} reports ${title.toLowerCase()}.`;
  const evidence = boundLifecycleText([
    `Owner: ${payload.runtimeOwner}`,
    `Launch: ${payload.launchMode}`,
    `Process: ${payload.processState}`,
    `Token: ${tokenStateLabel(payload.tokenState)}`,
    `Diagnosis: ${payload.diagnosis}`,
  ].join(" · "));
  return {
    title,
    status,
    evidence,
    guidance: lifecycleGuidance(payload, host),
    surface,
    lifecycle: payload.lifecycle,
  };
}

export function runtimeLifecycleHostCopy(host: BridgeHost): string {
  if (host === "browser") {
    return "Browser standalone mode connects to a running loopback runtime for chat/provider setup, including Demo Mode, Ollama, and OpenAI-compatible BYOK models; it cannot launch/restart runtime or run host actions.";
  }
  return "Runtime recovery is IDE-managed: click Refresh runtime first; if it still fails, use the IDE runtime status or restart command.";
}

function lifecycleGuidance(payload: HostRuntimeStatusPayload, host: BridgeHost): string {
  if (payload.lifecycle === "auth_mismatch" && (host === "browser" || payload.surface === "browser")) {
    return boundLifecycleText("Runtime session mismatch. Browser standalone cannot launch or restart runtime; provide the matching loopback runtime URL and Session token, then refresh. Raw token values are never shown here.");
  }
  if (payload.lifecycle === "auth_mismatch") {
    return boundLifecycleText("Runtime session mismatch. Refresh runtime first; if still failing, use the IDE runtime status or restart command. Raw token values are never shown here.");
  }
  if (host === "browser" || payload.surface === "browser") {
    return boundLifecycleText(`${payload.nextAction} Browser standalone mode only connects to a running loopback runtime; it cannot launch, restart, apply edits, run commands, read editor context, or run host actions.`);
  }
  if (payload.lifecycle === "invalid_settings" || payload.lifecycle === "failed") {
    return boundLifecycleText(`${payload.nextAction} Refresh runtime first; if still failing, use the IDE runtime status or restart command.`);
  }
  return boundLifecycleText(`${payload.nextAction} Refresh runtime first if this status looks stale; deeper recovery stays in the IDE host.`);
}

function tokenStateLabel(tokenState: HostRuntimeStatusPayload["tokenState"]): string {
  if (tokenState === "present") {
    return "present, value hidden";
  }
  if (tokenState === "mismatch") {
    return "mismatch, value hidden";
  }
  if (tokenState === "invalid") {
    return "invalid, value hidden";
  }
  return tokenState;
}

function boundLifecycleText(value: string): string {
  return sanitizeDisplayText(value).slice(0, 360);
}
