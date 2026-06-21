import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export const toolAuthorityPolicyCapabilities = [
  "read_only_context_navigation",
  "bounded_edit_apply",
  "allowlisted_verification",
  "workspace_patch",
  "shell",
  "git",
  "provider_tool",
  "network",
  "hidden_read_search_index",
  "home_secret_access",
  "remote_publish_push",
] as const;

export const toolAuthorityPolicyRiskKinds = [
  "metadata_only",
  "touches_files",
  "mutates_workspace",
  "executes_process",
  "reads_hidden_data",
  "network",
  "secrets",
  "remote_mutation",
] as const;

export const toolAuthorityPolicyRequirementKinds = [
  "explicit_user_confirmation",
  "trusted_request_id",
  "workspace_relative_bounds",
  "schema_validation",
  "trace_entry",
  "checkpoint_required",
  "allowlisted_command_id",
  "rollback_required",
] as const;

export const toolAuthorityPolicyOrigins = ["user", "gui", "assistant", "host", "runtime"] as const;
export const toolAuthorityPolicyRequestIdMinters = ["gui", "host", "none"] as const;
export const toolAuthorityPolicyHostSurfaces = ["browser", "vscode", "jetbrains", "engine_runtime"] as const;
export const toolAuthorityPolicyModes = ["design_gate", "sandbox_preview"] as const;
export const toolAuthorityPolicyFixtureDecisions = ["deny", "allow_with_confirmation", "metadata_only"] as const;
export const toolAuthorityPolicyAllowlistedCommandIds = ["repository-check", "gui-app-tests", "engine-chat-tests"] as const;

export type ToolAuthorityPolicyCapability = (typeof toolAuthorityPolicyCapabilities)[number];
export type ToolAuthorityPolicyRisk = (typeof toolAuthorityPolicyRiskKinds)[number];
export type ToolAuthorityPolicyRequirement = (typeof toolAuthorityPolicyRequirementKinds)[number];
export type ToolAuthorityPolicyOrigin = (typeof toolAuthorityPolicyOrigins)[number];
export type ToolAuthorityPolicyRequestIdMinter = (typeof toolAuthorityPolicyRequestIdMinters)[number];
export type ToolAuthorityPolicyHostSurface = (typeof toolAuthorityPolicyHostSurfaces)[number];
export type ToolAuthorityPolicyMode = (typeof toolAuthorityPolicyModes)[number];
export type ToolAuthorityPolicyFixtureDecision = (typeof toolAuthorityPolicyFixtureDecisions)[number];
export type ToolAuthorityPolicyAllowlistedCommandId = (typeof toolAuthorityPolicyAllowlistedCommandIds)[number];

export type ToolAuthorityPolicySource = {
  origin: ToolAuthorityPolicyOrigin;
  requestIdMintedBy: ToolAuthorityPolicyRequestIdMinter | "assistant";
  hostSurface?: ToolAuthorityPolicyHostSurface;
};

export type ToolAuthorityPolicyRecord = {
  kind: "tool_authority_policy";
  version: "2026-06-21";
  mode: ToolAuthorityPolicyMode;
  defaultDecision: "deny";
  cloudRequired: false;
  summary: string;
  capability: ToolAuthorityPolicyCapability;
  source: ToolAuthorityPolicySource;
  risk: ToolAuthorityPolicyRisk[];
  requirements: ToolAuthorityPolicyRequirement[];
  decision: ToolAuthorityPolicyFixtureDecision;
  workspaceBounds?: string[];
  allowlistedCommandId?: ToolAuthorityPolicyAllowlistedCommandId;
  traceLabel?: string;
};

export type ToolAuthorityPolicyDisplayDecision = "deny" | "metadata_only" | "requires_confirmation";

export type ToolAuthorityPolicyDiagnosticCode =
  | "malformed_policy"
  | "unknown_or_invalid_field"
  | "non_deny_default"
  | "cloud_required"
  | "assistant_sourced_request"
  | "blocked_capability"
  | "risky_category"
  | "unsupported_capability"
  | "unbounded_request"
  | "missing_confirmation"
  | "missing_allowlisted_command_id"
  | "unsafe_display_text";

export type ToolAuthorityPolicyDiagnostic = {
  code: ToolAuthorityPolicyDiagnosticCode;
  message: string;
};

export type ToolAuthorityPolicyEvaluation = {
  decision: ToolAuthorityPolicyDisplayDecision;
  allowedToExecute: false;
  capability?: ToolAuthorityPolicyCapability;
  summary: string;
  traceLabel?: string;
  requestSource?: ToolAuthorityPolicySource;
  workspaceBounds?: string[];
  allowlistedCommandId?: ToolAuthorityPolicyAllowlistedCommandId;
  diagnostics: ToolAuthorityPolicyDiagnostic[];
  details: Record<string, string | boolean | string[]>;
};

const capabilitySet = new Set<unknown>(toolAuthorityPolicyCapabilities);
const riskSet = new Set<unknown>(toolAuthorityPolicyRiskKinds);
const requirementSet = new Set<unknown>(toolAuthorityPolicyRequirementKinds);
const originSet = new Set<unknown>(toolAuthorityPolicyOrigins);
const requestIdMinterSet = new Set<unknown>(toolAuthorityPolicyRequestIdMinters);
const hostSurfaceSet = new Set<unknown>(toolAuthorityPolicyHostSurfaces);
const modeSet = new Set<unknown>(toolAuthorityPolicyModes);
const decisionSet = new Set<unknown>(toolAuthorityPolicyFixtureDecisions);
const allowlistedCommandIdSet = new Set<unknown>(toolAuthorityPolicyAllowlistedCommandIds);

const blockedCapabilities = new Set<ToolAuthorityPolicyCapability>([
  "shell",
  "git",
  "provider_tool",
  "network",
  "hidden_read_search_index",
  "home_secret_access",
  "remote_publish_push",
]);

const blockedRisks = new Set<ToolAuthorityPolicyRisk>(["executes_process", "reads_hidden_data", "network", "secrets", "remote_mutation"]);
const allowedTopLevelKeys = new Set(["kind", "version", "mode", "defaultDecision", "cloudRequired", "summary", "capability", "source", "risk", "requirements", "decision", "workspaceBounds", "allowlistedCommandId", "traceLabel"]);
const allowedSourceKeys = new Set(["origin", "requestIdMintedBy", "hostSurface"]);
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)(?!.*(?:^|\/)(?:auth|authorization|bearer|cookie|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))(?!.*(?:^|\/)sk-(?:proj-)?[A-Za-z0-9_-]{8,})[^\u0000-\u001f\u007f-\u009f]+$/i;

export function evaluateToolAuthorityPolicy(input: unknown): ToolAuthorityPolicyEvaluation {
  const diagnostics: ToolAuthorityPolicyDiagnostic[] = [];
  const policy = parseToolAuthorityPolicy(input, diagnostics);
  if (!policy) {
    return deniedEvaluation(diagnostics);
  }

  if (policy.defaultDecision !== "deny") {
    diagnostics.push({ code: "non_deny_default", message: "Policy default decision is not deny." });
  }
  if (policy.cloudRequired !== false) {
    diagnostics.push({ code: "cloud_required", message: "Policy requires cloud authority." });
  }
  if (policy.source.origin === "assistant" || policy.source.requestIdMintedBy === "assistant") {
    diagnostics.push({ code: "assistant_sourced_request", message: "Assistant-sourced or assistant-minted requests cannot grant authority." });
  }
  if (blockedCapabilities.has(policy.capability)) {
    diagnostics.push({ code: "blocked_capability", message: "Capability is deny-only in the GUI authority display evaluator." });
  }
  if (policy.risk.some((risk) => blockedRisks.has(risk))) {
    diagnostics.push({ code: "risky_category", message: "Risk category requires denial in the GUI authority display evaluator." });
  }

  const safeSummary = sanitizeBoundedText(policy.summary, 280, "Authority request denied.");
  const safeTraceLabel = optionalSanitizedBoundedText(policy.traceLabel, 80);
  if (safeSummary.includes("[redacted]") || (safeTraceLabel?.includes("[redacted]") ?? false)) {
    diagnostics.push({ code: "unsafe_display_text", message: "Display text contained unsafe content and was redacted." });
  }

  if (diagnostics.length > 0) {
    return buildEvaluation("deny", policy, safeSummary, safeTraceLabel, diagnostics);
  }

  if (policy.decision === "metadata_only" && isMetadataOnlyPolicy(policy)) {
    return buildEvaluation("metadata_only", policy, safeSummary, safeTraceLabel, diagnostics);
  }

  if (policy.decision === "allow_with_confirmation" && isConfirmableBaselinePolicy(policy, diagnostics)) {
    return buildEvaluation("requires_confirmation", policy, safeSummary, safeTraceLabel, diagnostics);
  }

  if (policy.decision === "deny") {
    return buildEvaluation("deny", policy, safeSummary, safeTraceLabel, diagnostics);
  }

  if (!isBaselineCapability(policy.capability)) {
    diagnostics.push({ code: "unsupported_capability", message: "Capability is not a supported baseline display outcome." });
  } else {
    diagnostics.push({ code: "unbounded_request", message: "Policy is not bounded enough for a baseline display outcome." });
  }
  return buildEvaluation("deny", policy, safeSummary, safeTraceLabel, diagnostics);
}

export function summarizeToolAuthorityPolicyEvaluation(evaluation: ToolAuthorityPolicyEvaluation): string {
  const capability = evaluation.capability ? ` for ${evaluation.capability}` : "";
  const diagnosticSuffix = evaluation.diagnostics.length > 0 ? ` Diagnostics: ${evaluation.diagnostics.map((item) => item.code).join(", ")}.` : "";
  return sanitizeBoundedText(`${displayDecisionLabel(evaluation.decision)}${capability}. ${evaluation.summary}${diagnosticSuffix}`, 500, "Authority request denied.");
}

function parseToolAuthorityPolicy(input: unknown, diagnostics: ToolAuthorityPolicyDiagnostic[]): ToolAuthorityPolicyRecord | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_policy", message: "Policy must be an object." });
    return undefined;
  }

  for (const key of Object.keys(input)) {
    if (!allowedTopLevelKeys.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported policy field ${sanitizeDisplayText(key)}.` });
    }
  }

  const source = parseSource(input.source, diagnostics);
  const risk = parseStringArray<ToolAuthorityPolicyRisk>(input.risk, riskSet, diagnostics, "risk");
  const requirements = parseStringArray<ToolAuthorityPolicyRequirement>(input.requirements, requirementSet, diagnostics, "requirements");
  const workspaceBounds = input.workspaceBounds === undefined ? undefined : parseWorkspaceBounds(input.workspaceBounds, diagnostics);
  const allowlistedCommandId = allowlistedCommandIdSet.has(input.allowlistedCommandId) ? input.allowlistedCommandId as ToolAuthorityPolicyAllowlistedCommandId : undefined;

  if (input.allowlistedCommandId !== undefined && allowlistedCommandId === undefined) {
    diagnostics.push({ code: "missing_allowlisted_command_id", message: "Allowlisted verification requires a known command id." });
  }

  const capability = capabilitySet.has(input.capability) ? input.capability as ToolAuthorityPolicyCapability : undefined;
  const decision = decisionSet.has(input.decision) ? input.decision as ToolAuthorityPolicyFixtureDecision : undefined;
  const mode = modeSet.has(input.mode) ? input.mode as ToolAuthorityPolicyMode : undefined;

  if (input.kind !== "tool_authority_policy" || input.version !== "2026-06-21" || !mode || typeof input.summary !== "string" || !capability || !source || risk.length === 0 || requirements.length === 0 || !decision) {
    diagnostics.push({ code: "malformed_policy", message: "Policy does not match required authority policy fields." });
    return undefined;
  }

  return {
    kind: "tool_authority_policy",
    version: "2026-06-21",
    mode,
    defaultDecision: input.defaultDecision === "deny" ? "deny" : input.defaultDecision as "deny",
    cloudRequired: input.cloudRequired === false ? false : input.cloudRequired as false,
    summary: input.summary,
    capability,
    source,
    risk,
    requirements,
    decision,
    workspaceBounds,
    allowlistedCommandId,
    traceLabel: typeof input.traceLabel === "string" ? input.traceLabel : undefined,
  };
}

function parseSource(input: unknown, diagnostics: ToolAuthorityPolicyDiagnostic[]): ToolAuthorityPolicySource | undefined {
  if (!isPlainObject(input)) {
    diagnostics.push({ code: "malformed_policy", message: "Policy source must be an object." });
    return undefined;
  }
  for (const key of Object.keys(input)) {
    if (!allowedSourceKeys.has(key)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Unsupported source field ${sanitizeDisplayText(key)}.` });
    }
  }
  const origin = originSet.has(input.origin) ? input.origin as ToolAuthorityPolicyOrigin : undefined;
  const requestIdMintedBy = requestIdMinterSet.has(input.requestIdMintedBy) ? input.requestIdMintedBy as ToolAuthorityPolicyRequestIdMinter : input.requestIdMintedBy === "assistant" ? "assistant" : undefined;
  const hostSurface = input.hostSurface === undefined ? undefined : hostSurfaceSet.has(input.hostSurface) ? input.hostSurface as ToolAuthorityPolicyHostSurface : undefined;
  if (!origin || !requestIdMintedBy || (input.hostSurface !== undefined && !hostSurface)) {
    diagnostics.push({ code: "malformed_policy", message: "Policy source is invalid." });
    return undefined;
  }
  return { origin, requestIdMintedBy, hostSurface };
}

function parseStringArray<T extends string>(input: unknown, allowed: Set<unknown>, diagnostics: ToolAuthorityPolicyDiagnostic[], field: string): T[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 10) {
    diagnostics.push({ code: "malformed_policy", message: `Policy ${field} must be a bounded array.` });
    return [];
  }
  const values: T[] = [];
  for (const item of input) {
    if (!allowed.has(item) || values.includes(item as T)) {
      diagnostics.push({ code: "unknown_or_invalid_field", message: `Policy ${field} contains unsupported values.` });
      continue;
    }
    values.push(item as T);
  }
  return values;
}

function parseWorkspaceBounds(input: unknown, diagnostics: ToolAuthorityPolicyDiagnostic[]): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 4) {
    diagnostics.push({ code: "unbounded_request", message: "Workspace bounds must be a small non-empty array." });
    return undefined;
  }
  const bounds: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || item.length > 512 || !safeRelativePathPattern.test(item) || bounds.includes(item)) {
      diagnostics.push({ code: "unbounded_request", message: "Workspace bounds must be safe relative paths." });
      continue;
    }
    bounds.push(item);
  }
  return bounds.length > 0 ? bounds : undefined;
}

function isMetadataOnlyPolicy(policy: ToolAuthorityPolicyRecord): boolean {
  return policy.capability === "read_only_context_navigation" && policy.risk.length === 1 && policy.risk[0] === "metadata_only";
}

function isConfirmableBaselinePolicy(policy: ToolAuthorityPolicyRecord, diagnostics: ToolAuthorityPolicyDiagnostic[]): boolean {
  if (!isBaselineCapability(policy.capability)) {
    diagnostics.push({ code: "unsupported_capability", message: "Capability is not confirmable baseline metadata." });
    return false;
  }
  if (!policy.requirements.includes("explicit_user_confirmation")) {
    diagnostics.push({ code: "missing_confirmation", message: "Confirmable display outcome requires explicit user confirmation." });
    return false;
  }
  if (policy.capability === "bounded_edit_apply") {
    const bounded = policy.requirements.includes("workspace_relative_bounds") && (policy.workspaceBounds?.length ?? 0) > 0;
    if (!bounded) {
      diagnostics.push({ code: "unbounded_request", message: "Bounded edit apply requires safe workspace bounds." });
      return false;
    }
  }
  if (policy.capability === "allowlisted_verification") {
    const bounded = policy.requirements.includes("allowlisted_command_id") && policy.allowlistedCommandId !== undefined;
    if (!bounded) {
      diagnostics.push({ code: "missing_allowlisted_command_id", message: "Allowlisted verification requires a command id only." });
      return false;
    }
  }
  return true;
}

function isBaselineCapability(capability: ToolAuthorityPolicyCapability): boolean {
  return capability === "read_only_context_navigation" || capability === "bounded_edit_apply" || capability === "allowlisted_verification";
}

function buildEvaluation(
  decision: ToolAuthorityPolicyDisplayDecision,
  policy: ToolAuthorityPolicyRecord,
  summary: string,
  traceLabel: string | undefined,
  diagnostics: ToolAuthorityPolicyDiagnostic[],
): ToolAuthorityPolicyEvaluation {
  const details = sanitizeDetails({
    mode: policy.mode,
    capability: policy.capability,
    sourceOrigin: policy.source.origin,
    requestIdMintedBy: policy.source.requestIdMintedBy,
    risks: policy.risk,
    requirements: policy.requirements,
    displayOnly: true,
  });
  return {
    decision,
    allowedToExecute: false,
    capability: policy.capability,
    summary,
    traceLabel,
    requestSource: policy.source,
    workspaceBounds: policy.workspaceBounds,
    allowlistedCommandId: policy.allowlistedCommandId,
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: sanitizeBoundedText(item.message, 200, "Policy denied.") })),
    details,
  };
}

function deniedEvaluation(diagnostics: ToolAuthorityPolicyDiagnostic[]): ToolAuthorityPolicyEvaluation {
  return {
    decision: "deny",
    allowedToExecute: false,
    summary: "Authority request denied.",
    diagnostics: diagnostics.map((item) => ({ code: item.code, message: sanitizeBoundedText(item.message, 200, "Policy denied.") })),
    details: { displayOnly: true },
  };
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, string | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") {
      details[safeKey] = sanitizeBoundedText(value, 200, "[redacted]");
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => sanitizeBoundedText(item, 120, "[redacted]")).slice(0, 10);
    }
  }
  return details;
}

function optionalSanitizedBoundedText(input: string | undefined, limit: number): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const sanitized = sanitizeBoundedText(input, limit, "");
  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeBoundedText(input: string, limit: number, fallback: string): string {
  const sanitized = sanitizeTimelineText(input).trim();
  const safe = sanitized.length > 0 ? sanitized : fallback;
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function displayDecisionLabel(decision: ToolAuthorityPolicyDisplayDecision): string {
  if (decision === "metadata_only") {
    return "Metadata only";
  }
  if (decision === "requires_confirmation") {
    return "Requires confirmation";
  }
  return "Denied";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
