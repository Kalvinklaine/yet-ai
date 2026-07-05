import { sanitizeTimelineText } from "./redaction";

export type ControlledAgentDevPreviewState = "ready" | "partial" | "blocked" | "unsupported";
export type ControlledAgentDevPreviewHost = "vscode" | "jetbrains" | "browser" | "unknown";

export type ControlledAgentDevPreviewCapabilities = {
  explicitStart: boolean;
  boundedRead: boolean;
  boundedEdit: boolean;
  allowlistedVerification: boolean;
  boundedRepair: boolean;
  sanitizedReport: boolean;
};

export type ControlledAgentDevPreviewStatus = {
  state: ControlledAgentDevPreviewState;
  host: ControlledAgentDevPreviewHost;
  summary: string;
  capabilities: ControlledAgentDevPreviewCapabilities;
  limitations: string[];
};

type ControlledAgentDevPreviewStatusInput = {
  host?: unknown;
  workspaceReady?: unknown;
  runtimeReady?: unknown;
  oneStepReady?: unknown;
  verificationReady?: unknown;
  repairReady?: unknown;
  stopped?: unknown;
  runtimeDisconnected?: unknown;
};

const maxLimitations = 8;
const maxDisplayLength = 240;

export function evaluateControlledAgentDevPreviewStatus(input: unknown): ControlledAgentDevPreviewStatus {
  const metadata = isPlainObject(input) ? (input as ControlledAgentDevPreviewStatusInput) : {};
  const host = normalizeHost(metadata.host);
  const workspaceReady = metadata.workspaceReady === true;
  const runtimeReady = metadata.runtimeReady === true;
  const oneStepReady = metadata.oneStepReady === true;
  const verificationReady = metadata.verificationReady === true;
  const repairReady = metadata.repairReady === true;
  const stopped = metadata.stopped === true;
  const runtimeDisconnected = metadata.runtimeDisconnected === true;
  const limitations: string[] = [];

  if (host === "browser") limitations.push("Browser preview cannot start the controlled local agent dev-preview.");
  if (host === "unknown") limitations.push("Supported IDE host metadata is unavailable.");
  if (host === "jetbrains") limitations.push("JetBrains host support is partial in this VS Code-first dev-preview.");
  if (!workspaceReady) limitations.push("Workspace readiness metadata is required before controlled dev-preview actions.");
  if (!runtimeReady) limitations.push("Runtime readiness metadata is required before controlled dev-preview actions.");
  if (!oneStepReady) limitations.push("One-step bounded read and edit readiness is not complete.");
  if (!verificationReady) limitations.push("Allowlisted verification readiness is not complete.");
  if (!repairReady) limitations.push("One user-confirmed bounded repair attempt is not ready.");
  if (stopped) limitations.push("Controlled dev-preview is stopped until the user starts it again.");
  if (runtimeDisconnected) limitations.push("Runtime is disconnected; no automatic retry is started.");

  const baseReady = (host === "vscode" || host === "jetbrains") && workspaceReady && runtimeReady && !stopped && !runtimeDisconnected;
  const capabilities: ControlledAgentDevPreviewCapabilities = {
    explicitStart: baseReady,
    boundedRead: baseReady && oneStepReady,
    boundedEdit: baseReady && oneStepReady,
    allowlistedVerification: baseReady && oneStepReady && verificationReady,
    boundedRepair: baseReady && oneStepReady && verificationReady && repairReady,
    sanitizedReport: true,
  };

  const state = evaluateState(host, workspaceReady, runtimeReady, oneStepReady, verificationReady, repairReady, stopped, runtimeDisconnected);

  return {
    state,
    host,
    summary: summaryForState(state, host),
    capabilities,
    limitations: sanitizeLimitations(limitations),
  };
}

function evaluateState(host: ControlledAgentDevPreviewHost, workspaceReady: boolean, runtimeReady: boolean, oneStepReady: boolean, verificationReady: boolean, repairReady: boolean, stopped: boolean, runtimeDisconnected: boolean): ControlledAgentDevPreviewState {
  if (host === "browser") return "unsupported";
  if (host === "unknown") return "blocked";
  if (stopped || runtimeDisconnected || !workspaceReady || !runtimeReady) return "blocked";
  if (host === "vscode" && oneStepReady && verificationReady && repairReady) return "ready";
  return "partial";
}

function summaryForState(state: ControlledAgentDevPreviewState, host: ControlledAgentDevPreviewHost): string {
  if (state === "ready") return safeText("Controlled agent dev-preview is ready for explicit VS Code user start.");
  if (state === "unsupported") return safeText("Controlled agent dev-preview is not supported in the browser host.");
  if (state === "blocked") return safeText("Controlled agent dev-preview is blocked until required local readiness returns.");
  if (host === "jetbrains") return safeText("Controlled agent dev-preview is partially available for JetBrains metadata only.");
  return safeText("Controlled agent dev-preview is partially ready and still missing bounded capability metadata.");
}

function normalizeHost(value: unknown): ControlledAgentDevPreviewHost {
  if (value === "vscode" || value === "jetbrains" || value === "browser") return value;
  return "unknown";
}

function sanitizeLimitations(limitations: string[]): string[] {
  const safe = limitations.map((item) => safeText(item)).filter((item) => item.length > 0).slice(0, maxLimitations);
  return safe.length > 0 ? safe : [safeText("No current dev-preview limitations were reported.")];
}

function safeText(input: string): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : "Controlled dev-preview status is unavailable.";
  return safe.length > maxDisplayLength ? `${safe.slice(0, maxDisplayLength)}…` : safe;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
