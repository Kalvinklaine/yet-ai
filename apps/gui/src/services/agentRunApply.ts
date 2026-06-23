import type { ApplyWorkspaceEditResultPayload, HostMessage } from "../bridge/bridgeAdapter";
import type { AgentRunApplyResultMetadata, AgentRunExplicitRequestMetadata, AgentRunInput } from "./agentRunState";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type AgentRunApplySource = "user" | "assistant" | "system";

export type AgentRunApplyRequestInput = {
  source: AgentRunApplySource;
  requestId: string;
  requestIdMintedBy: "gui" | "assistant" | "system" | "host";
  runId: string;
  proposalId?: string;
  agentRunInput?: AgentRunInput;
};

export type AgentRunApplyCorrelationMetadata = {
  requestId: string;
  runId: string;
  proposalId: string;
};

export type AgentRunApplyRequestResult = {
  state: "ready" | "blocked";
  applyRequest?: AgentRunExplicitRequestMetadata;
  correlation?: AgentRunApplyCorrelationMetadata;
  diagnostics: AgentRunApplyDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type AgentRunApplyResultInput = {
  current: AgentRunApplyCorrelationMetadata;
  hostMessage: HostMessage | { requestId?: string; payload?: unknown };
  existingResult?: AgentRunApplyResultMetadata;
};

export type AgentRunApplyCorrelationResult = {
  state: "accepted" | "duplicate" | "ignored" | "blocked";
  applyResult?: AgentRunApplyResultMetadata;
  diagnostics: AgentRunApplyDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type AgentRunApplyDiagnosticCode = "malformed_input" | "assistant_authority_blocked" | "unsafe_metadata" | "stale_result" | "duplicate_result";

export type AgentRunApplyDiagnostic = {
  code: AgentRunApplyDiagnosticCode;
  message: string;
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|stackTrace|stack_trace|callstack|privatePath|private_path|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const unsafeTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|stack[_ -]?trace|callstack|shell|\bcommand\s*[:=]|\bcmd\s*[:=]|\bargs\s*[:=]|\bcwd\s*[:=]|\benv\s*[:=]|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:send|apply|run|rollback)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathTextPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;

export function normalizeAgentRunApplyRequest(input: unknown): AgentRunApplyRequestResult {
  const diagnostics: AgentRunApplyDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Apply request metadata must be an object."));
    return blockedRequest(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as Partial<AgentRunApplyRequestInput>;
  if (metadata.source !== "user" || metadata.requestIdMintedBy !== "gui") {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Apply requests must use a GUI-owned id from an explicit user event."));
  }

  const requestId = safeId(metadata.requestId);
  const runId = safeId(metadata.runId);
  const proposalId = safeId(metadata.proposalId) ?? safeId(metadata.agentRunInput?.proposal?.id) ?? safeBoundedLoopProposalId(metadata.agentRunInput?.boundedLoop);
  if (!requestId || !runId || !proposalId) {
    diagnostics.push(diagnostic("malformed_input", "Apply request requires safe request, run, and proposal correlation ids."));
  }

  if (diagnostics.length > 0 || !requestId || !runId || !proposalId) {
    return blockedRequest(diagnostics, requestDetails(requestId, runId, proposalId));
  }

  return {
    state: "ready",
    applyRequest: { requested: true, source: "user", requestId },
    correlation: { requestId, runId, proposalId },
    diagnostics: [],
    details: requestDetails(requestId, runId, proposalId),
  };
}

export function correlateAgentRunApplyResult(input: unknown): AgentRunApplyCorrelationResult {
  const diagnostics: AgentRunApplyDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Apply result correlation metadata must be an object."));
    return blockedResult(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as Partial<AgentRunApplyResultInput>;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Apply result requires current safe correlation metadata."));
    return blockedResult(diagnostics, { displayOnly: true });
  }

  if (diagnostics.length > 0) {
    return blockedResult(diagnostics, resultDetails(current, undefined, undefined));
  }

  const hostRequestId = isPlainObject(metadata.hostMessage) ? safeId(metadata.hostMessage.requestId) : undefined;
  if (!hostRequestId || hostRequestId !== current.requestId) {
    diagnostics.push(diagnostic("stale_result", "Ignored apply result that does not match the current request id."));
    return {
      state: "ignored",
      diagnostics,
      details: resultDetails(current, undefined, hostRequestId),
    };
  }

  if (metadata.existingResult) {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate apply result ignored after the first stable result."));
    return {
      state: "duplicate",
      applyResult: sanitizeExistingResult(metadata.existingResult),
      diagnostics,
      details: resultDetails(current, metadata.existingResult, hostRequestId),
    };
  }

  const payload = isPlainObject(metadata.hostMessage) ? metadata.hostMessage.payload : undefined;
  const resultPayload = sanitizeHostPayload(payload);
  if (!resultPayload) {
    diagnostics.push(diagnostic("malformed_input", "Apply host result payload is malformed."));
    return blockedResult(diagnostics, resultDetails(current, undefined, hostRequestId));
  }

  const applyResult: AgentRunApplyResultMetadata = {
    status: resultPayload.status === "applied" ? "applied" : "failed",
    summary: safeText(resultPayload.message, 240),
    appliedFileCount: resultPayload.status === "applied" ? boundedFileCount(resultPayload.affectedFiles?.length ?? resultPayload.appliedEditCount ?? 0) : undefined,
  };
  const sanitizedResult = stripUndefined(applyResult);

  return {
    state: "accepted",
    applyResult: sanitizedResult,
    diagnostics,
    details: resultDetails(current, sanitizedResult, hostRequestId),
  };
}

function sanitizeHostPayload(value: unknown): ApplyWorkspaceEditResultPayload | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const status = value.status;
  if (!isApplyResultStatus(status)) {
    return undefined;
  }
  const message = typeof value.message === "string" ? safeText(value.message, 240) : undefined;
  if (!message || value.cloudRequired !== false) {
    return undefined;
  }
  const appliedEditCount = boundedInteger(value.appliedEditCount, 0, 64) ? value.appliedEditCount : undefined;
  const affectedFiles = Array.isArray(value.affectedFiles) ? value.affectedFiles.filter((item): item is string => typeof item === "string").slice(0, 4) : undefined;
  const result: ApplyWorkspaceEditResultPayload = { status, message, cloudRequired: false };
  if (appliedEditCount !== undefined) {
    result.appliedEditCount = appliedEditCount;
  }
  if (affectedFiles !== undefined) {
    result.affectedFiles = affectedFiles;
  }
  return result;
}

function isApplyResultStatus(value: unknown): value is ApplyWorkspaceEditResultPayload["status"] {
  return value === "applied" || value === "denied" || value === "rejected" || value === "failed";
}

function sanitizeExistingResult(value: AgentRunApplyResultMetadata): AgentRunApplyResultMetadata {
  return stripUndefined({
    status: value.status === "applied" ? "applied" : "failed",
    summary: typeof value.summary === "string" ? safeText(value.summary, 240) : undefined,
    appliedFileCount: boundedInteger(value.appliedFileCount, 0, 64) ? value.appliedFileCount : undefined,
  });
}

function sanitizeCorrelation(value: unknown): AgentRunApplyCorrelationMetadata | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const proposalId = safeId(value.proposalId);
  return requestId && runId && proposalId ? { requestId, runId, proposalId } : undefined;
}

function requestDetails(requestId: string | undefined, runId: string | undefined, proposalId: string | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId, runId, proposalId, applyRequested: requestId !== undefined });
}

function resultDetails(correlation: AgentRunApplyCorrelationMetadata, result: AgentRunApplyResultMetadata | undefined, hostRequestId: string | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({
    displayOnly: true,
    requestId: correlation.requestId,
    hostRequestId,
    runId: correlation.runId,
    proposalId: correlation.proposalId,
    applyStatus: result?.status,
    appliedFileCount: result?.appliedFileCount,
  });
}

function blockedRequest(diagnostics: AgentRunApplyDiagnostic[], details: Record<string, string | number | boolean | string[]>): AgentRunApplyRequestResult {
  return {
    state: "blocked",
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details),
  };
}

function blockedResult(diagnostics: AgentRunApplyDiagnostic[], details: Record<string, string | number | boolean | string[]>): AgentRunApplyCorrelationResult {
  return {
    state: "blocked",
    diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24),
    details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details),
  };
}

function scanUnsafeMetadata(value: unknown, diagnostics: AgentRunApplyDiagnostic[], keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  if (typeof value === "string") {
    if (unsafeTextPattern.test(value) || secretTextPattern.test(value) || unsafePathTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe Agent Run apply metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (unsafeKeyPattern.test(key)) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported Agent Run apply execution field ${sanitizeDisplayText(key)}.`));
      }
      scanUnsafeMetadata(item, diagnostics, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
    }
  }
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const sanitized = sanitizeDisplayValue(input);
  if (!isPlainObject(sanitized)) {
    return { displayOnly: true };
  }
  const details: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(sanitized).slice(0, 32)) {
    const safeKey = sanitizeDisplayText(key);
    if (typeof value === "string") {
      details[safeKey] = safeText(value, 240);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      details[safeKey] = value;
    } else if (typeof value === "boolean") {
      details[safeKey] = value;
    } else if (Array.isArray(value)) {
      details[safeKey] = value.filter((item): item is string => typeof item === "string").map((item) => safeText(item, 160)).slice(0, 12);
    }
  }
  return details;
}

function safeBoundedLoopProposalId(value: unknown): string | undefined {
  if (!isPlainObject(value) || !isPlainObject(value.patch)) {
    return undefined;
  }
  return safeId(value.patch.proposalId);
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeDisplayText(value).trim();
  return safeIdPattern.test(sanitized) ? sanitized : undefined;
}

function safeText(value: string, limit: number): string {
  const sanitized = sanitizeTimelineText(value).trim();
  const safe = sanitized.length > 0 ? sanitized : "[redacted]";
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
}

function diagnostic(code: AgentRunApplyDiagnosticCode, message: string): AgentRunApplyDiagnostic {
  return { code, message: safeText(message, 200) };
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function boundedFileCount(value: number): number {
  return Math.max(0, Math.min(64, value));
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
