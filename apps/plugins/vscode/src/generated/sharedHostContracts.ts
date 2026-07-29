export const GENERATED_BRIDGE_CONTRACT_PROVENANCE = "Generated from packages/contracts/schemas/bridge/host-message.schema.json; run npm run generate:bridge-contracts";

export type GeneratedRuntimeStatusPayload = {
  protocolVersion: "2026-06-21";
  surface: "browser" | "vscode" | "jetbrains";
  lifecycle: "unknown" | "checking" | "starting" | "connected" | "degraded" | "disconnected" | "restarting" | "stopped" | "auth_mismatch" | "invalid_settings" | "failed";
  runtimeOwner: "browser_preview" | "ide_host" | "external" | "user" | "test_harness";
  launchMode: "auto" | "connect" | "launch" | "preview" | "manual" | "unknown";
  tokenState: "unknown" | "not_required" | "absent" | "present" | "mismatch" | "invalid";
  processState: "unknown" | "not_owned" | "checking" | "starting" | "running" | "exited" | "stopped" | "failed";
  diagnosis: string;
  nextAction: string;
  cloudRequired: false;
  authority: "metadata_only";
};

export type GeneratedWorkspaceBindingPayload =
  | { protocolVersion: "workspace_binding_v1"; requestId: string; state: "auto_bound"; projectId: string; displayName: string }
  | { protocolVersion: "workspace_binding_v1"; requestId: string; state: "selection_required"; reason: "no_root" | "multiple_roots" | "root_unavailable" };

const runtimeKeys = ["protocolVersion", "surface", "lifecycle", "runtimeOwner", "launchMode", "tokenState", "processState", "diagnosis", "nextAction", "cloudRequired", "authority"] as const;
const autoBoundKeys = ["protocolVersion", "requestId", "state", "projectId", "displayName"] as const;
const selectionRequiredKeys = ["protocolVersion", "requestId", "state", "reason"] as const;
const lifecycleValues = new Set<string>(["unknown", "checking", "starting", "connected", "degraded", "disconnected", "restarting", "stopped", "auth_mismatch", "invalid_settings", "failed"]);
const surfaceValues = new Set<string>(["browser", "vscode", "jetbrains"]);
const runtimeOwnerValues = new Set<string>(["browser_preview", "ide_host", "external", "user", "test_harness"]);
const launchModeValues = new Set<string>(["auto", "connect", "launch", "preview", "manual", "unknown"]);
const tokenStateValues = new Set<string>(["unknown", "not_required", "absent", "present", "mismatch", "invalid"]);
const processStateValues = new Set<string>(["unknown", "not_owned", "checking", "starting", "running", "exited", "stopped", "failed"]);
const bindingReasons = new Set<string>(["no_root", "multiple_roots", "root_unavailable"]);
const requestIdPattern = "^(?!.*(?:[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr]|[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Aa][Cc][Cc][Ee][Ss][Ss][-_]?[Tt][Oo][Kk][Ee][Nn]|[Pp][Rr][Oo][Vv][Ii][Dd][Ee][Rr][-_]?[Kk][Ee][Yy]|[Oo][Pp][Ee][Nn][Aa][Ii][-_]?[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]|[Ss][Kk]-(?:[Pp][Rr][Oo][Jj]-)?[A-Za-z0-9_-]{8,}))[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$";
const projectIdPattern = "^prj_[A-Za-z0-9_-]{21}[AQgw]$";
const displayNamePattern = "^(?!\\s)(?![\\s\\S]*\\s$)(?![\\s\\S]*(?:[Aa][Pp][Ii][-_ ]?[Kk][Ee][Yy]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|(?:^|[^A-Za-z0-9_-])[Ss][Kk]-(?:[Pp][Rr][Oo][Jj]-)?[A-Za-z0-9_-]{8,}|https?://|file:))[^\\x00-\\x1F\\x7F-\\x9F/\\\\]+$";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const matches = (value: unknown, pattern: string) => typeof value === "string" && new RegExp(pattern, "u").test(value);

export function isGeneratedRuntimeStatusPayload(value: unknown): value is GeneratedRuntimeStatusPayload {
  return isRecord(value) && hasExactKeys(value, runtimeKeys) && value.protocolVersion === "2026-06-21" && typeof value.surface === "string" && surfaceValues.has(value.surface) && typeof value.lifecycle === "string" && lifecycleValues.has(value.lifecycle) && typeof value.runtimeOwner === "string" && runtimeOwnerValues.has(value.runtimeOwner) && typeof value.launchMode === "string" && launchModeValues.has(value.launchMode) && typeof value.tokenState === "string" && tokenStateValues.has(value.tokenState) && typeof value.processState === "string" && processStateValues.has(value.processState) && typeof value.diagnosis === "string" && value.diagnosis.length >= 1 && value.diagnosis.length <= 1000 && matches(value.diagnosis, "^(?!.*(?:[\u0000-\u001f-]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr]|[Cc][Oo][Oo][Kk][Ii][Ee]|[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Rr][Ii][Vv][Aa][Tt][Ee][_-]?[Pp][Aa][Tt][Hh]|[Pp][Rr][Oo][Vv][Ii][Dd][Ee][Rr][_-]?[Rr][Ee][Ss][Pp][Oo][Nn][Ss][Ee]|[Rr][Aa][Ww][_-]?[Pp][Rr][Oo][Mm][Pp][Tt]|[Ff][Ii][Ll][Ee][_-]?[Cc][Oo][Nn][Tt][Ee][Nn][Tt]|/[Uu][Ss][Ee][Rr][Ss](?=/|$|[^A-Za-z0-9_])|/[Hh][Oo][Mm][Ee](?=/|$|[^A-Za-z0-9_])|/[Tt][Mm][Pp](?=/|$|[^A-Za-z0-9_])|/[Vv][Aa][Rr](?=/|$|[^A-Za-z0-9_])|/[Ee][Tt][Cc](?=/|$|[^A-Za-z0-9_])|/[Oo][Pp][Tt](?=/|$|[^A-Za-z0-9_])|/[Mm][Nn][Tt](?=/|$|[^A-Za-z0-9_])|/[Vv][Oo][Ll][Uu][Mm][Ee][Ss](?=/|$|[^A-Za-z0-9_])|/[Pp][Rr][Ii][Vv][Aa][Tt][Ee](?=/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:/|\\\\)|~(?:/|\\\\)|(?:^|[^A-Za-z0-9_-])[Ss][Kk]-(?:[Pp][Rr][Oo][Jj]-)?[A-Za-z0-9_-]{8,})).*$") && typeof value.nextAction === "string" && value.nextAction.length >= 1 && value.nextAction.length <= 1000 && matches(value.nextAction, "^(?!.*(?:[\u0000-\u001f-]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Bb][Ee][Aa][Rr][Ee][Rr]|[Cc][Oo][Oo][Kk][Ii][Ee]|[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Rr][Ii][Vv][Aa][Tt][Ee][_-]?[Pp][Aa][Tt][Hh]|[Pp][Rr][Oo][Vv][Ii][Dd][Ee][Rr][_-]?[Rr][Ee][Ss][Pp][Oo][Nn][Ss][Ee]|[Rr][Aa][Ww][_-]?[Pp][Rr][Oo][Mm][Pp][Tt]|[Ff][Ii][Ll][Ee][_-]?[Cc][Oo][Nn][Tt][Ee][Nn][Tt]|/[Uu][Ss][Ee][Rr][Ss](?=/|$|[^A-Za-z0-9_])|/[Hh][Oo][Mm][Ee](?=/|$|[^A-Za-z0-9_])|/[Tt][Mm][Pp](?=/|$|[^A-Za-z0-9_])|/[Vv][Aa][Rr](?=/|$|[^A-Za-z0-9_])|/[Ee][Tt][Cc](?=/|$|[^A-Za-z0-9_])|/[Oo][Pp][Tt](?=/|$|[^A-Za-z0-9_])|/[Mm][Nn][Tt](?=/|$|[^A-Za-z0-9_])|/[Vv][Oo][Ll][Uu][Mm][Ee][Ss](?=/|$|[^A-Za-z0-9_])|/[Pp][Rr][Ii][Vv][Aa][Tt][Ee](?=/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:/|\\\\)|~(?:/|\\\\)|(?:^|[^A-Za-z0-9_-])[Ss][Kk]-(?:[Pp][Rr][Oo][Jj]-)?[A-Za-z0-9_-]{8,})).*$") && value.cloudRequired === false && value.authority === "metadata_only";
}

export function isGeneratedWorkspaceBindingPayload(value: unknown): value is GeneratedWorkspaceBindingPayload {
  if (!isRecord(value) || value.protocolVersion !== "workspace_binding_v1" || typeof value.requestId !== "string" || value.requestId.length < 1 || value.requestId.length > 128 || !matches(value.requestId, requestIdPattern)) return false;
  if (value.state === "auto_bound") return hasExactKeys(value, autoBoundKeys) && matches(value.projectId, projectIdPattern) && typeof value.displayName === "string" && Array.from(value.displayName).length >= 1 && Array.from(value.displayName).length <= 120 && matches(value.displayName, displayNamePattern);
  return value.state === "selection_required" && hasExactKeys(value, selectionRequiredKeys) && typeof value.reason === "string" && bindingReasons.has(value.reason);
}
