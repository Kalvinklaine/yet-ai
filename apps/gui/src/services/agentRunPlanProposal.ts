import type { VerificationCommandId } from "../bridge/bridgeAdapter";
import { isRawContentLikeKey, isSecretLikeKey, sanitizeDisplayText, sanitizeTimelineText } from "./redaction";

export type AgentRunPlanProposalState = "plan_detected" | "plan_rejected" | "normal_response" | "blocked";

export type AgentRunPlanProposalDiagnosticCode =
  | "normal_response"
  | "malformed_input"
  | "unsafe_metadata"
  | "unsupported_plan"
  | "oversized_content";

export type AgentRunPlanProposalDiagnostic = {
  code: AgentRunPlanProposalDiagnosticCode;
  message: string;
};

export type AgentRunPlanStepPreview = {
  id: string;
  title: string;
  summary: string;
  expectedTouchedFiles: string[];
  riskLabels: string[];
};

export type AgentRunVerificationSuggestionPreview = {
  commandId: VerificationCommandId;
  label: string;
};

export type AgentRunPlanPreviewMetadata = {
  kind: "agent_run.multistep_plan";
  title: string;
  summary: string;
  steps: AgentRunPlanStepPreview[];
  risks: string[];
  expectedTouchedFiles: string[];
  verificationSuggestions: AgentRunVerificationSuggestionPreview[];
};

export type AgentRunPlanProposalAnalysis =
  | { state: "plan_detected"; plan: AgentRunPlanPreviewMetadata; diagnostics: [] }
  | { state: "plan_rejected" | "blocked" | "normal_response"; diagnostics: AgentRunPlanProposalDiagnostic[] };

const planKind = "agent_run.multistep_plan";
const planVersion = "2026-06-25";
const maxContentLength = 50000;
const allowedPlanKeys = ["version", "kind", "authority", "cloudRequired", "executionAllowed", "title", "summary", "steps", "risks", "expectedTouchedFiles", "verificationSuggestions", "manualActionPolicy"] as const;
const allowedStepKeys = ["id", "title", "summary", "status", "expectedTouchedFiles", "riskLabels"] as const;
const allowedVerificationKeys = ["commandId", "label", "description", "riskLevel", "expectedDuration", "cwdPolicyLabel", "outputBoundLabel"] as const;
const allowedManualPolicyKeys = ["noAutoSend", "noAutoApply", "noAutoVerification", "noAutoRollback", "noHiddenReads", "requiresExplicitUserAction"] as const;
const verificationLabels: Record<VerificationCommandId, string> = {
  "repository-check": "Repository check",
  "gui-app-tests": "GUI app tests",
  "engine-chat-tests": "Engine chat tests",
};
const verificationDescriptions: Record<VerificationCommandId, string> = {
  "repository-check": "Run the repository validation gate after explicit user selection.",
  "gui-app-tests": "Run the focused GUI application test gate after explicit user selection.",
  "engine-chat-tests": "Run the focused engine chat test gate after explicit user selection.",
};
const verificationRiskLevels: Record<VerificationCommandId, "low" | "medium"> = {
  "repository-check": "medium",
  "gui-app-tests": "medium",
  "engine-chat-tests": "low",
};
const verificationDurations: Record<VerificationCommandId, string> = {
  "repository-check": "Usually 1 to 5 minutes",
  "gui-app-tests": "Usually 5 to 10 minutes",
  "engine-chat-tests": "Usually under 1 minute",
};

type ValidatedPlan = {
  title: string;
  summary: string;
  steps: Array<{ id: string; title: string; summary: string; status: "preview_only"; expectedTouchedFiles?: string[]; riskLabels?: string[] }>;
  risks: string[];
  expectedTouchedFiles: string[];
  verificationSuggestions: Array<{ commandId: VerificationCommandId; label: string }>;
};

export function evaluateAgentRunPlanProposal(content: string): AgentRunPlanProposalAnalysis {
  if (typeof content !== "string") {
    return rejected("malformed_input", "The assistant response must be text before plan preview parsing.");
  }
  const candidate = extractSingleJsonCandidate(content);
  if (candidate.state === "none") {
    return { state: "normal_response", diagnostics: [diagnostic("normal_response", "The latest assistant response did not contain an inert multi-step plan preview.")] };
  }
  if (candidate.state === "rejected") {
    return candidate.blocked ? blocked(candidate.code, candidate.message) : rejected(candidate.code, candidate.message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.text);
  } catch {
    return rejected("malformed_input", "The multi-step plan preview JSON is not valid.");
  }
  if (!isPlainObject(parsed)) {
    return rejected("malformed_input", "The multi-step plan preview must be one JSON object.");
  }
  if (parsed.kind !== planKind) {
    if (looksLikePlanObject(parsed)) {
      return rejected("unsupported_plan", "The assistant response looks like a plan preview but does not use the supported inert plan kind.");
    }
    return { state: "normal_response", diagnostics: [diagnostic("normal_response", "The latest assistant response did not contain an inert multi-step plan preview.")] };
  }

  const unsafeReason = findUnsafeAuthorityReason(parsed);
  if (unsafeReason) {
    return blocked("unsafe_metadata", unsafeReason);
  }
  const validated = validatePlanShape(parsed);
  if ("code" in validated) {
    return rejected(validated.code, validated.message);
  }

  return {
    state: "plan_detected",
    plan: {
      kind: planKind,
      title: sanitizeLine(validated.title, "Multi-step plan preview"),
      summary: sanitizeLine(validated.summary, "Plan preview is ready for manual review."),
      steps: validated.steps.map((step) => ({
        id: step.id,
        title: sanitizeLine(step.title, "Plan step"),
        summary: sanitizeLine(step.summary, "Preview-only step."),
        expectedTouchedFiles: (step.expectedTouchedFiles ?? []).map((item) => sanitizeLine(item, "[redacted]")).slice(0, 6),
        riskLabels: (step.riskLabels ?? []).map((item) => sanitizeLine(item, "[redacted]")).slice(0, 4),
      })),
      risks: validated.risks.map((item) => sanitizeLine(item, "[redacted]")).slice(0, 8),
      expectedTouchedFiles: validated.expectedTouchedFiles.map((item) => sanitizeLine(item, "[redacted]")).slice(0, 12),
      verificationSuggestions: validated.verificationSuggestions.map((item) => ({ commandId: item.commandId, label: verificationLabels[item.commandId] })).slice(0, 3),
    },
    diagnostics: [],
  };
}

type JsonCandidateResult =
  | { state: "valid"; text: string; requirePlan: boolean }
  | { state: "rejected"; code: AgentRunPlanProposalDiagnosticCode; message: string; blocked?: boolean }
  | { state: "none" };

function extractSingleJsonCandidate(content: string): JsonCandidateResult {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { state: "none" };
  }
  if (trimmed.length > maxContentLength) {
    return { state: "rejected", code: "oversized_content", message: "The multi-step plan preview is too large to review safely." };
  }
  const fenceMatches = Array.from(trimmed.matchAll(/```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```/g));
  if (fenceMatches.length > 0) {
    if (fenceMatches.length !== 1 || (trimmed.match(/```/g) ?? []).length !== 2) {
      return { state: "rejected", code: "malformed_input", message: "The assistant response contains multiple or ambiguous plan preview candidates." };
    }
    const match = fenceMatches[0];
    if ((match[1] ?? "").toLowerCase() !== "json") {
      return looksLikePlanText(trimmed) ? { state: "rejected", code: "malformed_input", message: "Fenced plan previews must use a json code fence." } : { state: "none" };
    }
    const before = trimmed.slice(0, match.index).trim();
    const after = trimmed.slice((match.index ?? 0) + match[0].length).trim();
    if (looksLikePlanText(before) || looksLikePlanText(after)) {
      return { state: "rejected", code: "malformed_input", message: "The assistant response contains ambiguous plan preview text." };
    }
    const inner = match[2].trim();
    if (!isStrictFullJsonObject(inner)) {
      return { state: "rejected", code: "malformed_input", message: "The fenced multi-step plan preview must contain exactly one JSON object." };
    }
    return { state: "valid", text: inner, requirePlan: true };
  }
  if (!isStrictFullJsonObject(trimmed)) {
    if (!looksLikePlanText(trimmed)) {
      return { state: "none" };
    }
    if (countTopLevelJsonObjectStarts(trimmed) > 1) {
      return { state: "rejected", code: "malformed_input", message: "The assistant response contains multiple or ambiguous plan preview candidates." };
    }
    if (looksLikeJsonObjectStart(trimmed)) {
      return { state: "rejected", code: "malformed_input", message: "The multi-step plan preview JSON is not valid." };
    }
    return { state: "rejected", code: "malformed_input", message: "The assistant response looks like a plan preview but does not contain one JSON plan object." };
  }
  return { state: "valid", text: trimmed, requirePlan: false };
}

function validatePlanShape(value: Record<string, unknown>): ValidatedPlan | { code: AgentRunPlanProposalDiagnosticCode; message: string } {
  if (!hasOnlyKeys(value, allowedPlanKeys)) {
    return { code: "unsafe_metadata", message: "The multi-step plan preview contains unsupported metadata fields." };
  }
  if (value.version !== planVersion || value.authority !== "metadata_only" || value.cloudRequired !== false || value.executionAllowed !== false) {
    return { code: "unsafe_metadata", message: "The multi-step plan preview must be metadata-only with no execution authority." };
  }
  if (!safePlanText(value.title, 1, 120) || !safePlanText(value.summary, 1, 360)) {
    return { code: "unsafe_metadata", message: "The multi-step plan preview contains unsafe display text." };
  }
  if (!isStepArray(value.steps)) {
    return { code: "malformed_input", message: "The multi-step plan preview steps are malformed or unsafe." };
  }
  if (!isSafeTextArray(value.risks, 0, 8, 160)) {
    return { code: "unsafe_metadata", message: "The multi-step plan preview risks are malformed or unsafe." };
  }
  if (!isSafePathArray(value.expectedTouchedFiles, 0, 12)) {
    return { code: "unsafe_metadata", message: "The multi-step plan preview contains unsafe expected file labels." };
  }
  if (!isVerificationSuggestions(value.verificationSuggestions)) {
    return { code: "unsafe_metadata", message: "The multi-step plan preview contains unsupported verification metadata." };
  }
  if (!isManualPolicy(value.manualActionPolicy)) {
    return { code: "unsafe_metadata", message: "The multi-step plan preview must require explicit user action and no automatic actions." };
  }
  return {
    title: value.title,
    summary: value.summary,
    steps: value.steps,
    risks: value.risks,
    expectedTouchedFiles: value.expectedTouchedFiles,
    verificationSuggestions: value.verificationSuggestions,
  };
}

function isStepArray(value: unknown): value is Array<{ id: string; title: string; summary: string; status: "preview_only"; expectedTouchedFiles?: string[]; riskLabels?: string[] }> {
  return Array.isArray(value) && value.length >= 2 && value.length <= 10 && value.every((item, index) => {
    if (!isPlainObject(item) || !hasOnlyKeys(item, allowedStepKeys)) {
      return false;
    }
    return item.id === `step-${index + 1}` && safePlanText(item.title, 1, 180) && safePlanText(item.summary, 1, 360) && item.status === "preview_only" && isSafePathArray(item.expectedTouchedFiles ?? [], 0, 6) && isSafeTextArray(item.riskLabels ?? [], 0, 4, 160);
  });
}

function isVerificationSuggestions(value: unknown): value is Array<{ commandId: VerificationCommandId; label: string }> {
  return Array.isArray(value) && value.length <= 3 && value.every((item) => {
    if (!isPlainObject(item) || !hasOnlyKeys(item, allowedVerificationKeys) || !isVerificationCommandId(item.commandId)) {
      return false;
    }
    return item.label === verificationLabels[item.commandId] && item.description === verificationDescriptions[item.commandId] && item.riskLevel === verificationRiskLevels[item.commandId] && item.expectedDuration === verificationDurations[item.commandId] && item.cwdPolicyLabel === "Repository root selected by host" && item.outputBoundLabel === "Sanitized tail only";
  });
}

function isManualPolicy(value: unknown): boolean {
  return isPlainObject(value) && hasOnlyKeys(value, allowedManualPolicyKeys) && value.noAutoSend === true && value.noAutoApply === true && value.noAutoVerification === true && value.noAutoRollback === true && value.noHiddenReads === true && value.requiresExplicitUserAction === true;
}

function findUnsafeAuthorityReason(value: unknown, path: string[] = []): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const reason = findUnsafeAuthorityReason(item, path);
      if (reason) {
        return reason;
      }
    }
    return null;
  }
  if (!isPlainObject(value)) {
    return typeof value === "string" && unsafePlanText(value) ? "The multi-step plan preview contains unsafe text metadata." : null;
  }
  for (const [key, item] of Object.entries(value)) {
    if (isUnsafeAuthorityKey(key, path)) {
      return "The multi-step plan preview contains assistant-minted authority or execution metadata.";
    }
    if (isSecretLikeKey(key) || isRawContentLikeKey(key)) {
      return "The multi-step plan preview contains raw content or secret-like metadata.";
    }
    const reason = findUnsafeAuthorityReason(item, path.concat(key));
    if (reason) {
      return reason;
    }
  }
  return null;
}

function isUnsafeAuthorityKey(key: string, path: string[]): boolean {
  const normalized = key.replace(/[\s._-]+/g, "_").toLowerCase();
  if (path.length === 0 && (normalized === "authority" || normalized === "executionallowed" || normalized === "cloudrequired")) {
    return false;
  }
  if (path.length === 0 && normalized === "kind") {
    return false;
  }
  if (path[path.length - 1] === "manualActionPolicy" && ["noautosend", "noautoapply", "noautoverification", "noautorollback", "nohiddenreads", "requiresexplicituseraction"].includes(normalized)) {
    return false;
  }
  if (path[path.length - 1] === "verificationSuggestions" && normalized === "commandid") {
    return false;
  }
  return /^(?:requestid|correlationid|applyrequest|verificationrequest|rollbackrequest|command|cmd|exec|executable|args|arguments|cwd|env|environment|shell|git|tool|toolcall|tool_call|functioncall|function_call|provider|providerpayload|providerresponse|raw|rawprompt|rawcommand|rawdiff|diff|patch|filebody|filecontent|filecontents|workspacecontent|workspacecontents|autosend|autoapply|autorun|autoverify|autorollback|autofix|autorepair|hiddenread|hiddensearch|hiddenscan|indexworkspace)$/.test(normalized);
}

function isSafeTextArray(value: unknown, minLength: number, maxLength: number, maxTextLength: number): value is string[] {
  return Array.isArray(value) && value.length >= minLength && value.length <= maxLength && value.every((item) => safePlanText(item, 1, maxTextLength));
}

function isSafePathArray(value: unknown, minLength: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length >= minLength && value.length <= maxLength && new Set(value).size === value.length && value.every((item) => typeof item === "string" && safeRelativePath(item));
}

function safePlanText(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength && !hasControlCharacters(value) && !unsafePlanText(value);
}

function safeRelativePath(value: string): boolean {
  return value.length > 0 && value.length <= 240 && !value.startsWith("/") && !value.startsWith("~") && !value.includes("%") && !value.includes("\\") && !value.includes(":") && !value.includes("?") && !value.includes("#") && !value.endsWith("/") && !value.includes("//") && !hasControlCharacters(value) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !/^(?:auth|authorization|bearer|cookie|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:\.|-|_|$)/i.test(part) && !/(?:^|[._-])(?:auth|credential|credentials|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$)/i.test(part) && !/^sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(part));
}

function unsafePlanText(value: string): boolean {
  return /api[-_ ]?key|authorization|bearer|cookie|token|secret|password|pkce|refresh|access[-_ ]?token|auth[-_ ]?code|chain[-_ ]?of[-_ ]?thought|raw[-_ ]?(?:prompt|command|diff|dump|output|file|workspace|secret)|provider[-_ ]?(?:payload|response|body|tool|call)|tool[-_ ]?(?:call|use|name)|file[-_ ]?(?:body|content|contents)|workspace[-_ ]?(?:file|content|contents)|shell|git|cwd|env|args|arguments|exec|cmd|command|npm\s+run|cargo\s+(?:check|test)|apply[-_ ]?patch|auto[-_ ]?(?:send|apply|run|verify|fix|repair|rollback)|hidden[-_ ]?(?:read|search|scan)|index[-_ ]?workspace|(?:^|[^A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}|\/(?:Users|home|tmp|var|Volumes|Private|etc|opt|mnt)(?=\/|$|[^A-Za-z0-9_])|[A-Za-z]:(?:\/|\\)|~(?:\/|\\)|\.codex\/auth\.json|(?:auth|credentials?)\.json|begin [A-Za-z ]*private key/i.test(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function looksLikePlanText(text: string): boolean {
  return /agent_run\.multistep_plan|multi-step plan|multistep plan|manualActionPolicy|executionAllowed|expectedTouchedFiles|verificationSuggestions|metadata_only|noAutoApply|noAutoVerification/i.test(text);
}

function looksLikePlanObject(value: Record<string, unknown>): boolean {
  return "manualActionPolicy" in value || "executionAllowed" in value || value.authority === "metadata_only";
}

function looksLikeJsonObjectStart(text: string): boolean {
  return text.trimStart().startsWith("{");
}

function countTopLevelJsonObjectStarts(text: string): number {
  let count = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      count += 1;
    }
  }
  return count;
}

function isStrictFullJsonObject(text: string): boolean {
  if (text[0] !== "{" || text[text.length - 1] !== "}") {
    return false;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && i !== text.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

function isVerificationCommandId(value: unknown): value is VerificationCommandId {
  return value === "repository-check" || value === "gui-app-tests" || value === "engine-chat-tests";
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(code: AgentRunPlanProposalDiagnosticCode, message: string): AgentRunPlanProposalDiagnostic {
  return { code, message: sanitizeLine(message, "Agent Run plan preview metadata was blocked.") };
}

function rejected(code: AgentRunPlanProposalDiagnosticCode, message: string): AgentRunPlanProposalAnalysis {
  return { state: "plan_rejected", diagnostics: [diagnostic(code, message)] };
}

function blocked(code: AgentRunPlanProposalDiagnosticCode, message: string): AgentRunPlanProposalAnalysis {
  return { state: "blocked", diagnostics: [diagnostic(code, message)] };
}

function sanitizeLine(value: string, fallback: string): string {
  const sanitized = sanitizeTimelineText(sanitizeDisplayText(value)).replace(/[\r\n]+/g, " ").trim();
  return sanitized || fallback;
}
