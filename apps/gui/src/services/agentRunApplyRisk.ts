import type { ApplyWorkspaceEditPayload, BridgeHost, WorkspaceEditRange, WorkspaceFileTextEdits, WorkspaceTextReplacement } from "../bridge/bridgeAdapter";
import { evaluateAgentRunState } from "./agentRunState";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type AgentRunApplyRiskStatus = "ready" | "blocked" | "review_required";

export type AgentRunApplyRiskBadge =
  | "multi-file"
  | "large replacement"
  | "deletion-like replacement"
  | "preview redacted"
  | "checkpoint missing"
  | "browser preview only"
  | "policy blocked";

export type AgentRunApplyRiskReadinessItem = {
  label: string;
  state: "ready" | "blocked" | "review_required";
};

export type AgentRunApplyRiskSummary = {
  status: AgentRunApplyRiskStatus;
  fileCount: number;
  editCount: number;
  totalReplacementChars: number;
  maxReplacementChars: number;
  fileLabels: string[];
  riskBadges: AgentRunApplyRiskBadge[];
  readinessItems: AgentRunApplyRiskReadinessItem[];
  disabledReasons: string[];
  recoveryGuidance: string[];
};

export type BuildAgentRunApplyRiskSummaryOptions = {
  proposal?: unknown;
  agentRun?: unknown;
  host?: BridgeHost;
  pendingApply?: boolean;
  hasRedactedPreview?: boolean;
  acknowledgedRedactedPreview?: boolean;
  applyResult?: unknown;
};

type ProposalFacts = {
  parsed: boolean;
  unsafe: boolean;
  fileCount: number;
  editCount: number;
  totalReplacementChars: number;
  maxReplacementChars: number;
  fileLabels: string[];
  hasLargeReplacement: boolean;
  hasDeletionLikeReplacement: boolean;
};

const largeReplacementChars = 120;
const maxFileLabels = 8;
const maxReasons = 8;
const maxGuidance = 6;
const safeRelativePathPattern = /^(?!\/)(?!~)(?!.*%)(?!.*\\)(?!.*:)(?!.*[?#])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)(?!.*(?:^|\/)(?:auth|authorization|bearer|cookie|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|\/|$))(?!.*(?:^|[._-])(?:auth|credentials?|password|secret|token|access[_-]?token|api[_-]?key)(?:[._-]|$))(?!.*(?:^|\/)sk-(?:proj-)?[A-Za-z0-9_-]{8,})[^\u0000-\u001f\u007f-\u009f]+$/i;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|stackTrace|stack_trace|callstack|privatePath|private_path|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const unsafeTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|stack[_ -]?trace|callstack|shell|\bcommand\s*[:=]|\bcmd\s*[:=]|\bargs\s*[:=]|\bcwd\s*[:=]|\benv\s*[:=]|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:send|apply|run|rollback)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathTextPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function buildAgentRunApplyRiskSummary(options: BuildAgentRunApplyRiskSummaryOptions = {}): AgentRunApplyRiskSummary {
  const host = options.host ?? "browser";
  const pendingApply = options.pendingApply === true;
  const hasRedactedPreview = options.hasRedactedPreview === true;
  const acknowledgedRedactedPreview = options.acknowledgedRedactedPreview === true;
  const proposal = parseProposal(options.proposal);
  const unsafeApplyResult = options.applyResult !== undefined && hasUnsafeMetadata(options.applyResult, new WeakSet<object>(), "", 0, false);
  const agentRunState = evaluateAgentRunState(options.agentRun);
  const checkpointReady = agentRunState.state === "ready_for_apply" || agentRunState.state === "apply_requested";
  const policyBlocked = agentRunState.state === "blocked" || agentRunState.state === "prerequisites_blocked" || agentRunState.diagnostics.length > 0;
  const browserPreviewOnly = host !== "vscode" && host !== "jetbrains";
  const disabledReasons = boundedList([
    ...(!proposal.parsed ? ["Proposal metadata could not be safely parsed for manual apply review."] : []),
    ...(proposal.unsafe ? ["Proposal metadata contains unsafe or private labels and must be reviewed from a sanitized source."] : []),
    ...(unsafeApplyResult ? ["Apply result metadata contains unsafe fields and is omitted from readiness."] : []),
    ...(!checkpointReady ? ["Checkpoint metadata is not ready for manual apply."] : []),
    ...(policyBlocked ? ["Apply policy metadata is blocked or unavailable."] : []),
    ...(browserPreviewOnly ? ["Browser preview cannot apply. Open VS Code or JetBrains for host confirmation."] : []),
    ...(pendingApply ? ["An IDE apply request is already pending; wait for the current result before requesting another apply."] : []),
    ...(hasRedactedPreview && !acknowledgedRedactedPreview ? ["Acknowledge the redacted preview before requesting manual IDE apply."] : []),
  ], maxReasons);
  const riskBadges = uniqueBadges([
    ...(proposal.fileCount > 1 ? ["multi-file" as const] : []),
    ...(proposal.hasLargeReplacement ? ["large replacement" as const] : []),
    ...(proposal.hasDeletionLikeReplacement ? ["deletion-like replacement" as const] : []),
    ...(hasRedactedPreview ? ["preview redacted" as const] : []),
    ...(!checkpointReady ? ["checkpoint missing" as const] : []),
    ...(browserPreviewOnly ? ["browser preview only" as const] : []),
    ...(policyBlocked ? ["policy blocked" as const] : []),
  ]);
  const readinessItems: AgentRunApplyRiskReadinessItem[] = [
    { label: "proposal parsed", state: proposal.parsed && !proposal.unsafe ? "ready" : "blocked" },
    { label: "checkpoint ready", state: checkpointReady ? "ready" : "blocked" },
    { label: "host supports apply", state: browserPreviewOnly ? "blocked" : "ready" },
    { label: "user review required", state: riskBadges.length > 0 ? "review_required" : "ready" },
    { label: "no pending apply", state: pendingApply ? "blocked" : "ready" },
  ];
  const status: AgentRunApplyRiskStatus = disabledReasons.length > 0 ? "blocked" : riskBadges.length > 0 ? "review_required" : "ready";
  const recoveryGuidance = boundedList([
    ...(status === "ready" ? ["Review the listed workspace-relative files, then use the IDE confirmation dialog if you choose to apply."] : []),
    ...(status === "review_required" ? ["Review each badge and listed file before deciding whether to request manual IDE apply."] : []),
    ...(!proposal.parsed || proposal.unsafe ? ["Regenerate or reopen the proposal from sanitized metadata before applying."] : []),
    ...(!checkpointReady ? ["Create or verify a local checkpoint before manual apply."] : []),
    ...(policyBlocked ? ["Resolve blocked policy or checkpoint metadata before manual apply."] : []),
    ...(browserPreviewOnly ? ["Open the workspace in a supported IDE host for manual apply confirmation."] : []),
    ...(pendingApply ? ["Wait for the pending apply result metadata before starting another manual apply request."] : []),
    ...(hasRedactedPreview && !acknowledgedRedactedPreview ? ["Inspect the sanitized proposal metadata and acknowledge the redacted preview only if it is sufficient for review."] : []),
  ], maxGuidance);

  return {
    status,
    fileCount: proposal.fileCount,
    editCount: proposal.editCount,
    totalReplacementChars: proposal.totalReplacementChars,
    maxReplacementChars: proposal.maxReplacementChars,
    fileLabels: proposal.fileLabels,
    riskBadges,
    readinessItems,
    disabledReasons,
    recoveryGuidance,
  };
}

function parseProposal(input: unknown): ProposalFacts {
  const unsafe = hasUnsafeMetadata(input, new WeakSet<object>(), "", 0, true);
  if (!isApplyWorkspaceEditPayload(input)) {
    return emptyProposal(false, unsafe);
  }
  const fileLabels = input.edits.map((file) => safeFileLabel(file.workspaceRelativePath));
  const hasUnsafePath = fileLabels.some((label) => label === "[redacted]");
  const replacements = input.edits.flatMap((file) => file.textReplacements);
  const lengths = replacements.map((replacement) => replacement.replacementText.length);
  const totalReplacementChars = lengths.reduce((total, length) => total + length, 0);
  const maxReplacementChars = lengths.reduce((max, length) => Math.max(max, length), 0);
  return {
    parsed: true,
    unsafe: unsafe || hasUnsafePath,
    fileCount: input.edits.length,
    editCount: replacements.length,
    totalReplacementChars,
    maxReplacementChars,
    fileLabels: boundFileLabels(fileLabels),
    hasLargeReplacement: maxReplacementChars >= largeReplacementChars,
    hasDeletionLikeReplacement: replacements.some((replacement) => replacement.replacementText.trim().length === 0),
  };
}

function emptyProposal(parsed: boolean, unsafe: boolean): ProposalFacts {
  return {
    parsed,
    unsafe,
    fileCount: 0,
    editCount: 0,
    totalReplacementChars: 0,
    maxReplacementChars: 0,
    fileLabels: [],
    hasLargeReplacement: false,
    hasDeletionLikeReplacement: false,
  };
}

function isApplyWorkspaceEditPayload(value: unknown): value is ApplyWorkspaceEditPayload {
  if (!isPlainObject(value) || value.requiresUserConfirmation !== true || value.cloudRequired !== false && value.cloudRequired !== undefined || !Array.isArray(value.edits) || typeof value.summary !== "string") {
    return false;
  }
  return value.edits.length > 0 && value.edits.length <= 64 && value.edits.every(isWorkspaceFileTextEdits);
}

function isWorkspaceFileTextEdits(value: unknown): value is WorkspaceFileTextEdits {
  return isPlainObject(value) && typeof value.workspaceRelativePath === "string" && Array.isArray(value.textReplacements) && value.textReplacements.length > 0 && value.textReplacements.length <= 64 && value.textReplacements.every(isWorkspaceTextReplacement);
}

function isWorkspaceTextReplacement(value: unknown): value is WorkspaceTextReplacement {
  return isPlainObject(value) && isRange(value.range) && typeof value.replacementText === "string";
}

function isRange(value: unknown): value is WorkspaceEditRange {
  return isPlainObject(value) && isPosition(value.start) && isPosition(value.end) && (value.end.line > value.start.line || value.end.line === value.start.line && value.end.character >= value.start.character);
}

function isPosition(value: unknown): value is WorkspaceEditRange["start"] {
  return isPlainObject(value) && boundedInteger(value.line, 0, 1000000) && boundedInteger(value.character, 0, 1000000);
}

function safeFileLabel(path: string): string {
  const sanitized = sanitizeDisplayText(path);
  if (sanitized.length === 0 || sanitized.length > 160 || !safeRelativePathPattern.test(sanitized)) {
    return "[redacted]";
  }
  return sanitized;
}

function boundFileLabels(labels: string[]): string[] {
  const visible = labels.slice(0, maxFileLabels);
  if (labels.length > maxFileLabels) {
    visible.push(`+${labels.length - maxFileLabels} more files`);
  }
  return visible;
}

function hasUnsafeMetadata(value: unknown, seen: WeakSet<object>, keyPath: string, depth: number, inProposalReplacementText: boolean): boolean {
  if (depth > 8) {
    return false;
  }
  if (typeof value === "string") {
    if (inProposalReplacementText) {
      return false;
    }
    return unsafeTextPattern.test(value) || secretTextPattern.test(value) || unsafePathTextPattern.test(value) || stackTracePattern.test(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.slice(0, 50).some((item, index) => hasUnsafeMetadata(item, seen, `${keyPath}[${index}]`, depth + 1, false));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.entries(value).slice(0, 50).some(([key, item]) => {
      if (unsafeKeyPattern.test(key)) {
        return true;
      }
      return hasUnsafeMetadata(item, seen, keyPath ? `${keyPath}.${key}` : key, depth + 1, key === "replacementText");
    });
  }
  return false;
}

function uniqueBadges(items: AgentRunApplyRiskBadge[]): AgentRunApplyRiskBadge[] {
  return Array.from(new Set(items)).slice(0, 12);
}

function boundedList(items: string[], limit: number): string[] {
  const sanitized = sanitizeDisplayValue(items);
  if (!Array.isArray(sanitized)) {
    return [];
  }
  return sanitized.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 220)).filter((item) => item.length > 0).slice(0, limit);
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
