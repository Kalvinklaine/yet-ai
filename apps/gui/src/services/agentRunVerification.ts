import type { HostMessage, IdeActionProgressPayload, IdeActionRequestPayload, IdeActionResultPayload, VerificationCommandId } from "../bridge/bridgeAdapter";
import type { AgentRunExplicitRequestMetadata, AgentRunVerificationProgressMetadata, AgentRunVerificationResultMetadata } from "./agentRunState";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";

export type AgentRunVerificationSource = "user" | "assistant" | "system";

export type AgentRunVerificationRequestInput = {
  source: AgentRunVerificationSource;
  requestId: string;
  requestIdMintedBy: "gui" | "assistant" | "system" | "host";
  runId: string;
  commandId: VerificationCommandId;
};

export type AgentRunVerificationCorrelationMetadata = {
  requestId: string;
  runId: string;
  commandId: VerificationCommandId;
};

export type AgentRunVerificationRequestResult = {
  state: "ready" | "blocked";
  verificationRequest?: AgentRunExplicitRequestMetadata;
  ideActionRequest?: IdeActionRequestPayload;
  correlation?: AgentRunVerificationCorrelationMetadata;
  diagnostics: AgentRunVerificationDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type AgentRunVerificationProgressInput = {
  current: AgentRunVerificationCorrelationMetadata;
  hostMessage: HostMessage | { requestId?: string; payload?: unknown };
};

export type AgentRunVerificationResultInput = {
  current: AgentRunVerificationCorrelationMetadata;
  hostMessage: HostMessage | { requestId?: string; payload?: unknown };
  existingResult?: AgentRunVerificationResultMetadata;
};

export type AgentRunVerificationProgressCorrelationResult = {
  state: "accepted" | "ignored" | "blocked";
  verificationProgress?: AgentRunVerificationProgressMetadata;
  diagnostics: AgentRunVerificationDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type AgentRunVerificationResultCorrelationResult = {
  state: "accepted" | "duplicate" | "ignored" | "blocked";
  verificationResult?: AgentRunVerificationResultMetadata;
  diagnostics: AgentRunVerificationDiagnostic[];
  details: Record<string, string | number | boolean | string[]>;
};

export type AgentRunVerificationDiagnosticCode = "malformed_input" | "assistant_authority_blocked" | "unsafe_metadata" | "unsupported_command" | "stale_result" | "duplicate_result";

export type AgentRunVerificationDiagnostic = {
  code: AgentRunVerificationDiagnosticCode;
  message: string;
};

const allowedCommandIds = new Set<VerificationCommandId>(["repository-check", "gui-app-tests", "engine-chat-tests"]);
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const unsafeKeyPattern = /^(?:command|cmd|args|arguments|cwd|env|environment|shell|git|network|providerTool|provider_tool|toolCall|tool_call|rawDiff|raw_diff|diff|rawFile|raw_file|rawFileBody|raw_file_body|fileBody|file_body|fileContents|file_contents|rawPrompt|raw_prompt|rawOutput|raw_output|stackTrace|stack_trace|callstack|privatePath|private_path|autoSend|auto_send|autoApply|auto_apply|autoRun|auto_run|autoRollback|auto_rollback|applyPatch|apply_patch)$/i;
const unsafeTextPattern = /raw[_ -]?(?:diff|file|prompt|command|output)|file[_ -]?(?:body|content)|provider[_ -]?(?:payload|response|tool)|stack[_ -]?trace|callstack|shell|\bcommand\s*[:=]|\bcmd\s*[:=]|\bargs\s*[:=]|\bcwd\s*[:=]|\benv\s*[:=]|\bgit\b|network|tool[_ -]?call|private[_ -]?path|auto[_ -]?(?:send|apply|run|rollback)|apply[_ -]?patch/i;
const secretTextPattern = /authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|cookie|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY/i;
const unsafePathTextPattern = /(?:^|\s)(?:\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private)(?=\/|\s|$)|[A-Za-z]:(?:\\|\/)|~(?:\\|\/))/;
const stackTracePattern = /(?:^|\n)\s*at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\):|panicked at .*:\d+:\d+/;
const maxOutputTailLength = 800;

export function normalizeAgentRunVerificationRequest(input: unknown): AgentRunVerificationRequestResult {
  const diagnostics: AgentRunVerificationDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Verification request metadata must be an object."));
    return blockedRequest(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as Partial<AgentRunVerificationRequestInput>;
  if (metadata.source !== "user" || metadata.requestIdMintedBy !== "gui") {
    diagnostics.push(diagnostic("assistant_authority_blocked", "Verification requests must use a GUI-owned id from an explicit user event."));
  }

  const requestId = safeId(metadata.requestId);
  const runId = safeId(metadata.runId);
  const commandId = safeCommandId(metadata.commandId);
  if (metadata.commandId !== undefined && !commandId) {
    diagnostics.push(diagnostic("unsupported_command", "Verification command id is not allowed for Agent Run."));
  }
  if (!requestId || !runId || !commandId) {
    diagnostics.push(diagnostic("malformed_input", "Verification request requires safe request, run, and command correlation ids."));
  }

  if (diagnostics.length > 0 || !requestId || !runId || !commandId) {
    return blockedRequest(diagnostics, requestDetails(requestId, runId, commandId));
  }

  return {
    state: "ready",
    verificationRequest: { requested: true, source: "user", requestId },
    ideActionRequest: { action: "runVerificationCommand", commandId },
    correlation: { requestId, runId, commandId },
    diagnostics: [],
    details: requestDetails(requestId, runId, commandId),
  };
}

export function correlateAgentRunVerificationProgress(input: unknown): AgentRunVerificationProgressCorrelationResult {
  const diagnostics: AgentRunVerificationDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Verification progress correlation metadata must be an object."));
    return blockedProgress(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics);
  const metadata = input as Partial<AgentRunVerificationProgressInput>;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Verification progress requires current safe correlation metadata."));
    return blockedProgress(diagnostics, { displayOnly: true });
  }
  if (diagnostics.length > 0) {
    return blockedProgress(diagnostics, progressDetails(current, undefined, undefined, undefined));
  }

  const hostRequestId = isPlainObject(metadata.hostMessage) ? safeId(metadata.hostMessage.requestId) : undefined;
  const payload = isPlainObject(metadata.hostMessage) ? sanitizeProgressPayload(metadata.hostMessage.payload) : undefined;
  if (!hostRequestId || hostRequestId !== current.requestId || payload?.commandId !== current.commandId) {
    diagnostics.push(diagnostic("stale_result", "Ignored verification progress that does not match the current request and command ids."));
    return { state: "ignored", diagnostics, details: progressDetails(current, undefined, hostRequestId, payload?.commandId) };
  }
  if (!payload) {
    diagnostics.push(diagnostic("malformed_input", "Verification progress payload is malformed."));
    return blockedProgress(diagnostics, progressDetails(current, undefined, hostRequestId, undefined));
  }

  const status = payload.phase === "queued" ? "queued" : "running";
  const verificationProgress = stripUndefined({ status, summary: safeText(payload.summary, 240) }) as AgentRunVerificationProgressMetadata;
  return { state: "accepted", verificationProgress, diagnostics, details: progressDetails(current, verificationProgress, hostRequestId, payload.commandId) };
}

export function correlateAgentRunVerificationResult(input: unknown): AgentRunVerificationResultCorrelationResult {
  const diagnostics: AgentRunVerificationDiagnostic[] = [];
  if (!isPlainObject(input)) {
    diagnostics.push(diagnostic("malformed_input", "Verification result correlation metadata must be an object."));
    return blockedResult(diagnostics, { displayOnly: true });
  }

  scanUnsafeMetadata(input, diagnostics, { allowOutputTail: true });
  const metadata = input as Partial<AgentRunVerificationResultInput>;
  const current = sanitizeCorrelation(metadata.current);
  if (!current) {
    diagnostics.push(diagnostic("malformed_input", "Verification result requires current safe correlation metadata."));
    return blockedResult(diagnostics, { displayOnly: true });
  }
  if (diagnostics.length > 0) {
    return blockedResult(diagnostics, resultDetails(current, undefined, undefined, undefined));
  }

  const hostRequestId = isPlainObject(metadata.hostMessage) ? safeId(metadata.hostMessage.requestId) : undefined;
  const payload = isPlainObject(metadata.hostMessage) ? sanitizeResultPayload(metadata.hostMessage.payload) : undefined;
  const payloadCommandId = payload?.commandId;
  if (!hostRequestId || hostRequestId !== current.requestId || payloadCommandId !== current.commandId) {
    diagnostics.push(diagnostic("stale_result", "Ignored verification result that does not match the current request and command ids."));
    return { state: "ignored", diagnostics, details: resultDetails(current, undefined, hostRequestId, payloadCommandId) };
  }

  if (metadata.existingResult) {
    diagnostics.push(diagnostic("duplicate_result", "Duplicate verification result ignored after the first stable result."));
    return { state: "duplicate", verificationResult: sanitizeExistingResult(metadata.existingResult), diagnostics, details: resultDetails(current, metadata.existingResult, hostRequestId, payloadCommandId) };
  }

  if (!payload) {
    diagnostics.push(diagnostic("malformed_input", "Verification result payload is malformed."));
    return blockedResult(diagnostics, resultDetails(current, undefined, hostRequestId, undefined));
  }

  const verificationResult: AgentRunVerificationResultMetadata = stripUndefined({
    status: payload.status === "succeeded" && payload.exitCode === 0 ? "succeeded" : "failed",
    exitCode: payload.exitCode,
    durationMs: payload.durationMs,
    outputTail: safeOutputTail(payload.outputTail ?? payload.message),
  });
  return { state: "accepted", verificationResult, diagnostics, details: resultDetails(current, verificationResult, hostRequestId, payload.commandId) };
}

function sanitizeProgressPayload(value: unknown): IdeActionProgressPayload | undefined {
  if (!isPlainObject(value) || value.action !== "runVerificationCommand" || value.cloudRequired !== false) {
    return undefined;
  }
  const commandId = safeCommandId(value.commandId);
  if (!commandId || typeof value.summary !== "string") {
    return undefined;
  }
  if (!(value.phase === "queued" || value.phase === "checkingPolicy" || value.phase === "running") || !(value.status === "pending" || value.status === "inProgress")) {
    return undefined;
  }
  return { phase: value.phase, status: value.status, summary: safeText(value.summary, 240), cloudRequired: false, action: "runVerificationCommand", commandId };
}

function sanitizeResultPayload(value: unknown): IdeActionResultPayload | undefined {
  if (!isPlainObject(value) || value.action !== "runVerificationCommand" || value.cloudRequired !== false) {
    return undefined;
  }
  const commandId = safeCommandId(value.commandId);
  if (!commandId || !isTerminalResultStatus(value.status) || typeof value.message !== "string") {
    return undefined;
  }
  const exitCode = boundedInteger(value.exitCode, 0, 255) ? value.exitCode : undefined;
  const durationMs = boundedInteger(value.durationMs, 0, 3600000) ? value.durationMs : undefined;
  const result: IdeActionResultPayload = stripUndefined({
    status: value.status,
    message: safeText(value.message, 240),
    cloudRequired: false,
    action: "runVerificationCommand",
    commandId,
    exitCode,
    durationMs,
    outputTail: typeof value.outputTail === "string" ? safeOutputTail(value.outputTail) : undefined,
    truncated: typeof value.truncated === "boolean" ? value.truncated : undefined,
  });
  return result;
}

function isTerminalResultStatus(value: unknown): value is IdeActionResultPayload["status"] {
  return value === "succeeded" || value === "rejected" || value === "unavailable" || value === "failed";
}

function sanitizeExistingResult(value: AgentRunVerificationResultMetadata): AgentRunVerificationResultMetadata {
  return stripUndefined({
    status: value.status === "succeeded" ? "succeeded" : "failed",
    exitCode: boundedInteger(value.exitCode, 0, 255) ? value.exitCode : undefined,
    durationMs: boundedInteger(value.durationMs, 0, 3600000) ? value.durationMs : undefined,
    outputTail: typeof value.outputTail === "string" ? safeOutputTail(value.outputTail) : undefined,
  });
}

function sanitizeCorrelation(value: unknown): AgentRunVerificationCorrelationMetadata | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const requestId = safeId(value.requestId);
  const runId = safeId(value.runId);
  const commandId = safeCommandId(value.commandId);
  return requestId && runId && commandId ? { requestId, runId, commandId } : undefined;
}

function requestDetails(requestId: string | undefined, runId: string | undefined, commandId: VerificationCommandId | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId, runId, commandId, verificationRequested: requestId !== undefined });
}

function progressDetails(correlation: AgentRunVerificationCorrelationMetadata, progress: AgentRunVerificationProgressMetadata | undefined, hostRequestId: string | undefined, hostCommandId: VerificationCommandId | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId: correlation.requestId, hostRequestId, runId: correlation.runId, commandId: correlation.commandId, hostCommandId, verificationProgress: progress?.status });
}

function resultDetails(correlation: AgentRunVerificationCorrelationMetadata, result: AgentRunVerificationResultMetadata | undefined, hostRequestId: string | undefined, hostCommandId: VerificationCommandId | undefined): Record<string, string | number | boolean | string[]> {
  return sanitizeDetails({ displayOnly: true, requestId: correlation.requestId, hostRequestId, runId: correlation.runId, commandId: correlation.commandId, hostCommandId, verificationStatus: result?.status, verificationExitCode: result?.exitCode, verificationDurationMs: result?.durationMs, verificationOutputTail: result?.outputTail });
}

function blockedRequest(diagnostics: AgentRunVerificationDiagnostic[], details: Record<string, string | number | boolean | string[]>): AgentRunVerificationRequestResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details) };
}

function blockedProgress(diagnostics: AgentRunVerificationDiagnostic[], details: Record<string, string | number | boolean | string[]>): AgentRunVerificationProgressCorrelationResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details) };
}

function blockedResult(diagnostics: AgentRunVerificationDiagnostic[], details: Record<string, string | number | boolean | string[]>): AgentRunVerificationResultCorrelationResult {
  return { state: "blocked", diagnostics: diagnostics.map((item) => diagnostic(item.code, item.message)).slice(0, 24), details: sanitizeDetails(diagnostics.some((item) => item.code === "unsafe_metadata") ? { ...details, redacted: "[redacted]" } : details) };
}

function scanUnsafeMetadata(value: unknown, diagnostics: AgentRunVerificationDiagnostic[], options: { allowOutputTail?: boolean } = {}, keyPath = "", depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    return;
  }
  const keyParts = keyPath.split(".");
  const currentKey = (keyParts[keyParts.length - 1] ?? "").replace(/\[\d+\]$/u, "");
  if (typeof value === "string") {
    if (options.allowOutputTail && currentKey === "outputTail") {
      return;
    }
    if (unsafeTextPattern.test(value) || secretTextPattern.test(value) || unsafePathTextPattern.test(value) || stackTracePattern.test(value)) {
      diagnostics.push(diagnostic("unsafe_metadata", `Unsafe Agent Run verification metadata omitted near ${sanitizeDisplayText(keyPath || "value")}.`));
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    value.slice(0, 50).forEach((item, index) => scanUnsafeMetadata(item, diagnostics, options, `${keyPath}[${index}]`, depth + 1, seen));
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (unsafeKeyPattern.test(key) && !(options.allowOutputTail && key === "outputTail")) {
        diagnostics.push(diagnostic("unsafe_metadata", `Unsupported Agent Run verification execution field ${sanitizeDisplayText(key)}.`));
      }
      scanUnsafeMetadata(item, diagnostics, options, keyPath ? `${keyPath}.${key}` : key, depth + 1, seen);
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

function safeCommandId(value: unknown): VerificationCommandId | undefined {
  return typeof value === "string" && allowedCommandIds.has(value as VerificationCommandId) ? value as VerificationCommandId : undefined;
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

function safeOutputTail(value: string): string {
  return safeText(value, maxOutputTailLength);
}

function diagnostic(code: AgentRunVerificationDiagnosticCode, message: string): AgentRunVerificationDiagnostic {
  return { code, message: safeText(message, 200) };
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
