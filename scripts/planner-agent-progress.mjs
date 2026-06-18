const PROTOCOL_VERSION = "2026-05-29";
const MAX_MESSAGE_LENGTH = 280;
const MAX_TOOL_LABEL_LENGTH = 160;
const MAX_OUTPUT_TAIL_LENGTH = 2000;
const MAX_OVERFLOW_RECOVERY_MESSAGE_LENGTH = 320;
const MAX_PLAN_TITLE_LENGTH = 80;
const MAX_PLAN_LABEL_LENGTH = 140;
const MAX_PLAN_RATIONALE_LENGTH = 280;
const MAX_PLAN_STEPS = 6;
const MAX_TASK_SESSION_REFS = 4;
const MAX_TASK_SESSION_TITLE_LENGTH = 80;
const MAX_TASK_SESSION_GOAL_LENGTH = 240;
const MAX_TASK_SESSION_LABEL_LENGTH = 140;
const MAX_RECENT_EVENTS = 20;
const MAX_ELAPSED_MS = 604800000;
const MAX_TOOL_ELAPSED_MS = 86400000;

const DEFAULT_POLICY = {
  heartbeatStalledMs: 5 * 60 * 1000,
  heartbeatStuckMs: 10 * 60 * 1000,
  toolOutputStalledMs: 10 * 60 * 1000,
  toolOutputStuckMs: 20 * 60 * 1000,
  longRunningMs: 30 * 60 * 1000,
  freshHeartbeatMs: 2 * 60 * 1000,
  freshOutputMs: 5 * 60 * 1000
};

const ALLOWED_PHASES = new Set([
  "queued",
  "started",
  "reading_context",
  "editing",
  "running_command",
  "waiting_for_tool",
  "verifying",
  "finishing",
  "done",
  "failed",
  "stuck"
]);

const ALLOWED_STATUSES = new Set([
  "pending",
  "running",
  "healthy_running",
  "long_running",
  "stalled",
  "stuck",
  "done",
  "failed"
]);

const ALLOWED_TOOL_KINDS = new Set(["read", "edit", "command", "test", "validation", "network", "planner", "other"]);

function parseTime(value) {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : undefined;
}

function toIso(value) {
  const time = parseTime(value);
  if (time === undefined) {
    return undefined;
  }
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function clampDuration(value, max = MAX_ELAPSED_MS) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function boundedText(value, maxLength, fallback) {
  const text = sanitizeText(value, maxLength);
  return text.length > 0 ? text : fallback;
}

function containsUnsafeActionText(value) {
  const normalized = value.toLowerCase().replace(/[-_ ]/g, "");
  for (const marker of ["shell", "git", "tool", "patch", "apply", "exec", "cmd", "command", "autorun", "autoread", "autosearch", "autosave", "autosend", "autoapply", "hiddenread"]) {
    if (normalized.includes(marker)) {
      return true;
    }
  }
  const lower = value.toLowerCase();
  return lower.includes("npm run") || lower.includes("cargo check") || lower.includes("cargo test");
}

function containsUnsafePlanText(value) {
  return containsUnsafeActionText(value) || value.toLowerCase().replace(/[-_ ]/g, "").includes("task");
}

function boundedPlanText(value, maxLength) {
  const text = sanitizeText(value, maxLength);
  if (text.length === 0 || containsUnsafePlanText(text)) {
    return undefined;
  }
  return text;
}

function redactUnsafeText(value) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/(^|\n)[^\n]*(?:\b(?:chain[\t\r\s_-]*of[\t\r\s_-]*thought|raw[\t\r\s_-]*prompt|provider[\t\r\s_-]*(?:response|body)|tool[\t\r\s_-]*raw[\t\r\s_-]*output|raw[\t\r\s_-]*tool[\t\r\s_-]*output|file[\t\r\s_-]*contents?|workspace[\t\r\s_-]*contents?)\b\s*[:=]?)[^\n]*/gi, "$1[redacted-field]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "[redacted-auth]")
    .replace(/\b(?:api[_-]?key|authorization|token|secret|password|cookie|pkce|refresh|access[_-]?token|credential)\b\s*[:=]\s*\S+/gi, "[redacted-sensitive]")
    .replace(/\b(?:sk|pk|ghp|gho|github_pat|ya29)_[A-Za-z0-9_\-]{12,}\b/g, "[redacted-key]")
    .replace(/\bsk-[A-Za-z0-9_\-]{12,}\b/g, "[redacted-key]")
    .replace(/BEGIN [A-Z ]*PRIVATE KEY[\s\S]*?END [A-Z ]*PRIVATE KEY/g, "[redacted-private-key]")
    .replace(/\/(?:Users|home|private)\/[^\s"'`<>]*/g, "[redacted-path]")
    .replace(/~\/[^\s"'`<>]*/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\[^\s"'`<>]*/g, "[redacted-path]")
    .replace(/(?:\.codex\/)?auth\.json/gi, "[redacted-file]")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function truncateTail(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(Math.max(0, text.length - maxLength));
}

function truncateHeadTail(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  const marker = "\n…\n";
  const headLength = Math.max(0, Math.floor((maxLength - marker.length) / 2));
  const tailLength = Math.max(0, maxLength - marker.length - headLength);
  return `${text.slice(0, headLength)}${marker}${text.slice(Math.max(0, text.length - tailLength))}`;
}

function boundedHeadTailText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return truncateHeadTail(redactUnsafeText(value), maxLength);
}

function boundedRawHeadTailText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return truncateHeadTail(value, maxLength)
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

function sanitizeText(value, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof value !== "string") {
    return "";
  }
  return truncateTail(redactUnsafeText(value), maxLength);
}

function safeId(value, fallback) {
  if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    return value;
  }
  return fallback;
}

function overflowRecoveryMessage(kind) {
  if (kind === "task_board_output_too_large") {
    return "Retry with scoped context: use task_ready_cards or task_board_get(card_id) for one card, and summarize results instead of dumping the full task board.";
  }
  if (kind === "tool_output_too_large") {
    return "Retry with scoped context: use targeted search/cat commands and summarized outputs instead of a full tool dump.";
  }
  return "Retry with scoped context: use task_ready_cards, specific task_board_get(card_id), scoped search/cat, and summarized outputs.";
}

function classifyOverflowRecoveryText(value) {
  const text = boundedRawHeadTailText(value, MAX_OUTPUT_TAIL_LENGTH).toLowerCase();
  if (text.length === 0) {
    return undefined;
  }

  const mentionsTaskBoard = /task[_ -]?board|task_board_get|task_ready_cards/.test(text);
  const mentionsTool = /\b(?:tool|outputtail|command|search|cat)\b/.test(text);
  const mentionsContext = /context|prompt|window/.test(text);
  const mentionsTooLarge = /too large|output too large|exceeded|maximum context length|context length/.test(text);

  let kind;
  if (/task board output too large/.test(text) || (/task_board_get/.test(text) && mentionsTooLarge) || (mentionsTaskBoard && /too large|maximum context length|context length exceeded/.test(text))) {
    kind = "task_board_output_too_large";
  } else if (/tool output too large/.test(text) || (mentionsTool && /output too large|too large/.test(text))) {
    kind = "tool_output_too_large";
  } else if (/context_length_exceeded|maximum context length|context length exceeded/.test(text) || (mentionsContext && /too large|exceeded/.test(text))) {
    kind = "context_length_exceeded";
  }

  if (kind === undefined) {
    return undefined;
  }

  return {
    kind,
    message: sanitizeText(overflowRecoveryMessage(kind), MAX_OVERFLOW_RECOVERY_MESSAGE_LENGTH),
    retryable: true
  };
}

function classifyOverflowRecovery(event) {
  return event.overflowRecovery;
}

function sanitizeOverflowRecovery(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  if (value.kind !== "context_length_exceeded" && value.kind !== "tool_output_too_large" && value.kind !== "task_board_output_too_large") {
    return undefined;
  }
  return {
    kind: value.kind,
    message: boundedText(value.message, MAX_OVERFLOW_RECOVERY_MESSAGE_LENGTH, overflowRecoveryMessage(value.kind)),
    retryable: value.retryable === false ? false : true
  };
}

function safeCardId(value) {
  if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    return value;
  }
  return "unknown";
}

function sanitizeTool(tool, nowMs) {
  if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
    return undefined;
  }

  const kind = ALLOWED_TOOL_KINDS.has(tool.kind) ? tool.kind : "other";
  const summary = {
    kind,
    label: boundedText(tool.label, MAX_TOOL_LABEL_LENGTH, "Agent tool")
  };

  const startedAt = toIso(tool.startedAt);
  if (startedAt !== undefined) {
    summary.startedAt = startedAt;
  }

  if (Number.isInteger(tool.elapsedMs) && tool.elapsedMs >= 0) {
    summary.elapsedMs = clampDuration(tool.elapsedMs, MAX_TOOL_ELAPSED_MS);
  } else if (startedAt !== undefined) {
    summary.elapsedMs = clampDuration(nowMs - parseTime(startedAt), MAX_TOOL_ELAPSED_MS);
  }

  return summary;
}


function containsUnsafeTaskSessionText(value) {
  const lower = value.toLowerCase();
  if (/\b(?:api[_-]?key|authorization|bearer|token|secret|password|cookie|pkce|refresh|access[_-]?token|credential)\b/.test(lower)) {
    return true;
  }
  if (/(?:^|[^a-z0-9_-])sk-(?:proj-)?[a-z0-9_-]{8,}/i.test(value)) {
    return true;
  }
  if (/\/(?:users|home|tmp|etc|opt|mnt|var|volumes|private)(?=\/|$|[^a-z0-9_])/i.test(value) || /[a-z]:(?:\/|\\)/i.test(value) || value.includes("~/")) {
    return true;
  }
  if (/\.codex\/auth\.json|(?:auth|credentials?)\.json|begin [a-z ]*private key/i.test(value)) {
    return true;
  }
  const normalized = lower.replace(/[-_\s]/g, "");
  for (const marker of ["authcode", "chainofthought", "rawprompt", "rawcommand", "rawdump", "rawoutput", "rawfile", "rawworkspace", "providerresponse", "providerbody", "filecontent", "workspacefile", "workspacecontent"]) {
    if (normalized.includes(marker)) {
      return true;
    }
  }
  return containsUnsafeActionText(value);
}

function safeTaskSessionText(value, maxLength) {
  if (typeof value !== "string" || containsUnsafeTaskSessionText(value)) {
    return undefined;
  }
  const text = sanitizeText(value, maxLength);
  if (text.length === 0 || containsUnsafeTaskSessionText(text)) {
    return undefined;
  }
  return text;
}

function safeTaskSessionId(value) {
  if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value)) {
    return value;
  }
  return undefined;
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function sanitizeTaskSessionRefs(value, sanitizeRef) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.refs) || !hasOnlyKeys(value, ["count", "refs"])) {
    return undefined;
  }
  if (!Number.isInteger(value.count) || value.count < 0 || value.count > MAX_TASK_SESSION_REFS || value.refs.length > MAX_TASK_SESSION_REFS || value.count !== value.refs.length) {
    return undefined;
  }
  const refs = value.refs.map(sanitizeRef);
  if (refs.some((ref) => ref === undefined)) {
    return undefined;
  }
  return { count: value.count, refs };
}

function sanitizeTaskSessionContextRef(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["kind", "label", "refId"])) {
    return undefined;
  }
  if (!["active_file_excerpt", "workspace_snippet", "verification_output", "project_memory"].includes(value.kind)) {
    return undefined;
  }
  const label = safeTaskSessionText(value.label, MAX_TASK_SESSION_LABEL_LENGTH);
  if (label === undefined) {
    return undefined;
  }
  const ref = { kind: value.kind, label };
  if (value.refId !== undefined) {
    const refId = safeTaskSessionId(value.refId);
    if (refId === undefined) {
      return undefined;
    }
    ref.refId = refId;
  }
  return ref;
}

function sanitizeTaskSessionMemoryRef(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["noteId", "title"])) {
    return undefined;
  }
  const noteId = safeTaskSessionId(value.noteId);
  const title = safeTaskSessionText(value.title, MAX_TASK_SESSION_TITLE_LENGTH);
  if (noteId === undefined || title === undefined) {
    return undefined;
  }
  return { noteId, title };
}

function sanitizeTaskSessionStatusSummary(value, allowed) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["status", "summary"]) || !allowed.includes(value.status)) {
    return undefined;
  }
  const summary = { status: value.status };
  if (value.summary !== undefined) {
    const text = safeTaskSessionText(value.summary, MAX_TASK_SESSION_LABEL_LENGTH);
    if (text === undefined) {
      return undefined;
    }
    summary.summary = text;
  }
  return summary;
}

function sanitizeTaskSessionVerification(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["status", "commandId", "summary"])) {
    return undefined;
  }
  if (!["not_requested", "user_ready", "running", "succeeded", "failed", "unavailable"].includes(value.status)) {
    return undefined;
  }
  const verification = { status: value.status };
  if (value.commandId !== undefined) {
    if (!["repository-check", "gui-app-tests", "engine-chat-tests"].includes(value.commandId)) {
      return undefined;
    }
    verification.commandId = value.commandId;
  }
  if (value.summary !== undefined) {
    const summary = safeTaskSessionText(value.summary, MAX_TASK_SESSION_LABEL_LENGTH);
    if (summary === undefined) {
      return undefined;
    }
    verification.summary = summary;
  }
  return verification;
}

function sanitizeCodingTaskSession(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !hasOnlyKeys(value, ["protocolVersion", "kind", "sessionId", "title", "goal", "status", "selectedContext", "memory", "latestResponse", "editProposal", "verification", "nextStepSuggestions", "cloudRequired", "providerAccess"])) {
    return undefined;
  }
  if (value.protocolVersion !== "2026-06-18" || value.kind !== "coding_task_session" || value.cloudRequired !== false || value.providerAccess !== "direct") {
    return undefined;
  }
  const sessionId = safeTaskSessionId(value.sessionId);
  const title = safeTaskSessionText(value.title, MAX_TASK_SESSION_TITLE_LENGTH);
  const goal = safeTaskSessionText(value.goal, MAX_TASK_SESSION_GOAL_LENGTH);
  if (sessionId === undefined || title === undefined || goal === undefined || !["draft", "context_selected", "response_visible", "edit_proposed", "user_applied_edit", "verification_visible", "summarized", "blocked"].includes(value.status)) {
    return undefined;
  }
  const selectedContext = sanitizeTaskSessionRefs(value.selectedContext, sanitizeTaskSessionContextRef);
  const memory = sanitizeTaskSessionRefs(value.memory, sanitizeTaskSessionMemoryRef);
  const latestResponse = sanitizeTaskSessionStatusSummary(value.latestResponse, ["none", "waiting_for_user", "streaming", "completed", "failed", "aborted"]);
  const editProposal = sanitizeTaskSessionStatusSummary(value.editProposal, ["none", "proposed", "user_reviewing", "applied", "denied", "rejected", "failed"]);
  const verification = sanitizeTaskSessionVerification(value.verification);
  if (selectedContext === undefined || memory === undefined || latestResponse === undefined || editProposal === undefined || verification === undefined || !Array.isArray(value.nextStepSuggestions) || value.nextStepSuggestions.length > MAX_TASK_SESSION_REFS) {
    return undefined;
  }
  const nextStepSuggestions = value.nextStepSuggestions.map((suggestion) => safeTaskSessionText(suggestion, MAX_TASK_SESSION_LABEL_LENGTH));
  if (nextStepSuggestions.some((suggestion) => suggestion === undefined)) {
    return undefined;
  }
  return {
    protocolVersion: "2026-06-18",
    kind: "coding_task_session",
    sessionId,
    title,
    goal,
    status: value.status,
    selectedContext,
    memory,
    latestResponse,
    editProposal,
    verification,
    nextStepSuggestions,
    cloudRequired: false,
    providerAccess: "direct"
  };
}

function sanitizePlanProposal(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  if (value.protocolVersion !== PROTOCOL_VERSION || value.kind !== "manual_runner_plan_proposal") {
    return undefined;
  }
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > MAX_PLAN_STEPS) {
    return undefined;
  }
  const title = boundedPlanText(value.title, MAX_PLAN_TITLE_LENGTH);
  const steps = value.steps.map((step) => boundedPlanText(step, MAX_PLAN_LABEL_LENGTH));
  const rationale = boundedPlanText(value.rationale, MAX_PLAN_RATIONALE_LENGTH);
  const nextAction = boundedPlanText(value.nextAction, MAX_PLAN_LABEL_LENGTH);
  if (title === undefined || steps.some((step) => step === undefined) || rationale === undefined || nextAction === undefined) {
    return undefined;
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "manual_runner_plan_proposal",
    title,
    steps,
    rationale,
    nextAction
  };
}

function sanitizeEvent(event, index, nowMs) {
  const timestamp = toIso(event?.timestamp);
  if (timestamp === undefined) {
    return undefined;
  }

  const eventId = safeId(event?.eventId, `event-${String(index + 1).padStart(3, "0")}`);
  const phase = ALLOWED_PHASES.has(event?.phase) ? event.phase : "started";
  const status = ALLOWED_STATUSES.has(event?.status) ? event.status : phase === "failed" ? "failed" : phase === "done" ? "done" : "running";
  const rawMessage = typeof event?.message === "string" ? event.message : "";
  const rawOutputTail = typeof event?.outputTail === "string" ? event.outputTail : "";
  const sanitized = {
    protocolVersion: PROTOCOL_VERSION,
    eventId,
    runId: safeId(event?.runId, "unknown-run"),
    cardId: safeCardId(event?.cardId),
    timestamp,
    phase,
    status,
    message: boundedText(rawMessage, MAX_MESSAGE_LENGTH, "Agent progress updated.")
  };

  const tool = sanitizeTool(event?.tool, nowMs);
  if (tool !== undefined) {
    sanitized.tool = tool;
  }

  if (event?.heartbeat !== null && typeof event?.heartbeat === "object" && !Array.isArray(event.heartbeat)) {
    const lastHeartbeatAt = toIso(event.heartbeat.lastHeartbeatAt);
    const lastToolOutputAt = toIso(event.heartbeat.lastToolOutputAt);
    if (lastHeartbeatAt !== undefined) {
      sanitized.heartbeat = { lastHeartbeatAt };
      if (lastToolOutputAt !== undefined) {
        sanitized.heartbeat.lastToolOutputAt = lastToolOutputAt;
      }
      if (Number.isInteger(event.heartbeat.attempt) && event.heartbeat.attempt >= 1) {
        sanitized.heartbeat.attempt = Math.min(event.heartbeat.attempt, 100);
      }
    }
  }

  const outputTail = sanitizeText(rawOutputTail, MAX_OUTPUT_TAIL_LENGTH);
  if (outputTail.length > 0) {
    sanitized.outputTail = outputTail;
  }

  const overflowRecovery = classifyOverflowRecoveryText(rawMessage) ?? classifyOverflowRecoveryText(rawOutputTail) ?? sanitizeOverflowRecovery(event?.overflowRecovery);
  if (overflowRecovery !== undefined) {
    sanitized.overflowRecovery = overflowRecovery;
  }

  const planProposal = sanitizePlanProposal(event?.planProposal);
  if (planProposal !== undefined) {
    sanitized.planProposal = planProposal;
  }

  const codingTaskSession = sanitizeCodingTaskSession(event?.codingTaskSession);
  if (codingTaskSession !== undefined) {
    sanitized.codingTaskSession = codingTaskSession;
  }

  return sanitized;
}

function compareEvents(left, right) {
  const leftTime = parseTime(left.timestamp) ?? 0;
  const rightTime = parseTime(right.timestamp) ?? 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.eventId.localeCompare(right.eventId);
}

function normalizeEvents(events, nowMs) {
  const sanitized = Array.isArray(events) ? events.map((event, index) => sanitizeEvent(event, index, nowMs)).filter(Boolean) : [];
  const byEventId = new Map();

  for (const event of sanitized) {
    const existing = byEventId.get(event.eventId);
    if (existing === undefined || JSON.stringify(event) < JSON.stringify(existing)) {
      byEventId.set(event.eventId, event);
    }
  }

  return [...byEventId.values()].sort(compareEvents);
}

function mostRecentBy(events, selector) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = selector(events[index]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function classifyRunning({ latest, elapsedMs, heartbeatAgeMs, toolOutputAgeMs, policy }) {
  if (latest.phase === "stuck" || latest.status === "stuck") {
    return { status: "stuck", stuckReason: "explicit_stuck" };
  }

  if (heartbeatAgeMs !== undefined && heartbeatAgeMs > policy.heartbeatStuckMs) {
    return { status: "stuck", stuckReason: "heartbeat_timeout" };
  }

  if (toolOutputAgeMs !== undefined && toolOutputAgeMs > policy.toolOutputStuckMs) {
    return { status: "stuck", stuckReason: "tool_output_timeout" };
  }

  if (heartbeatAgeMs !== undefined && heartbeatAgeMs > policy.heartbeatStalledMs) {
    return { status: "stalled", stuckReason: "heartbeat_timeout" };
  }

  if (toolOutputAgeMs !== undefined && toolOutputAgeMs > policy.toolOutputStalledMs) {
    return { status: "stalled", stuckReason: "tool_output_timeout" };
  }

  if (elapsedMs >= policy.longRunningMs) {
    return { status: "long_running", stuckReason: "none" };
  }

  if (latest.status === "pending" || latest.phase === "queued") {
    return { status: "pending", stuckReason: "none" };
  }

  return { status: "healthy_running", stuckReason: "none" };
}

function reduceAgentProgress(events, options = {}) {
  const nowIso = toIso(options.now ?? new Date().toISOString()) ?? new Date().toISOString().replace(".000Z", "Z");
  const nowMs = parseTime(nowIso);
  const policy = { ...DEFAULT_POLICY, ...(options.policy ?? {}) };
  const normalizedEvents = normalizeEvents(events, nowMs);

  if (normalizedEvents.length === 0) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      runId: "unknown-run",
      cardId: "unknown",
      startedAt: nowIso,
      updatedAt: nowIso,
      phase: "queued",
      status: "pending",
      message: "Agent progress is pending.",
      elapsedMs: 0,
      ageMs: 0,
      stuckReason: "none",
      recentEvents: []
    };
  }

  const first = normalizedEvents[0];
  const latest = normalizedEvents[normalizedEvents.length - 1];
  const terminal = mostRecentBy(normalizedEvents, (event) => (event.status === "failed" || event.phase === "failed" || event.status === "done" || event.phase === "done" ? event : undefined));
  const current = terminal ?? latest;
  const startedAt = first.timestamp;
  const updatedAt = current.timestamp;
  const completedAt = terminal !== undefined ? terminal.timestamp : undefined;
  const lastHeartbeatAt = mostRecentBy(normalizedEvents, (event) => event.heartbeat?.lastHeartbeatAt);
  const lastToolOutputAt = mostRecentBy(normalizedEvents, (event) => event.heartbeat?.lastToolOutputAt ?? (event.outputTail !== undefined ? event.timestamp : undefined));
  const heartbeatAgeMs = lastHeartbeatAt === undefined ? undefined : clampDuration(nowMs - parseTime(lastHeartbeatAt));
  const toolOutputAgeMs = lastToolOutputAt === undefined ? undefined : clampDuration(nowMs - parseTime(lastToolOutputAt));
  const elapsedMs = clampDuration((completedAt === undefined ? nowMs : parseTime(completedAt)) - parseTime(startedAt));
  const ageMs = clampDuration(nowMs - parseTime(updatedAt));

  let status = current.status;
  let stuckReason = "none";
  if (terminal !== undefined) {
    status = terminal.status === "failed" || terminal.phase === "failed" ? "failed" : "done";
    stuckReason = status === "failed" ? "explicit_failure" : "none";
  } else {
    const classified = classifyRunning({ latest: current, elapsedMs, heartbeatAgeMs, toolOutputAgeMs, policy });
    status = classified.status;
    stuckReason = classified.stuckReason;
  }

  const snapshot = {
    protocolVersion: PROTOCOL_VERSION,
    runId: current.runId,
    cardId: current.cardId,
    startedAt,
    updatedAt,
    phase: status === "done" ? "done" : status === "failed" ? "failed" : status === "stuck" && current.phase === "stuck" ? "stuck" : current.phase,
    status,
    message: current.message,
    elapsedMs,
    ageMs,
    stuckReason,
    recentEvents: normalizedEvents.slice(-MAX_RECENT_EVENTS).map((event) => ({
      eventId: event.eventId,
      timestamp: event.timestamp,
      phase: event.phase,
      status: event.status,
      message: event.message
    }))
  };

  if (completedAt !== undefined) {
    snapshot.completedAt = completedAt;
  }

  const currentTool = mostRecentBy(normalizedEvents, (event) => event.tool);
  if (currentTool !== undefined && status !== "done" && status !== "failed") {
    snapshot.currentTool = currentTool;
  } else if (currentTool !== undefined && terminal?.tool !== undefined) {
    snapshot.currentTool = terminal.tool;
  }

  const outputTail = mostRecentBy(normalizedEvents, (event) => event.outputTail);
  if (outputTail !== undefined) {
    snapshot.outputTail = outputTail;
  }

  const overflowRecovery = mostRecentBy(normalizedEvents, classifyOverflowRecovery);
  if (overflowRecovery !== undefined && (status === "failed" || status === "stuck" || status === "stalled")) {
    snapshot.overflowRecovery = overflowRecovery;
  }

  const planProposal = mostRecentBy(normalizedEvents, (event) => event.planProposal);
  if (planProposal !== undefined) {
    snapshot.planProposal = planProposal;
  }

  const codingTaskSession = mostRecentBy(normalizedEvents, (event) => event.codingTaskSession);
  if (codingTaskSession !== undefined) {
    snapshot.codingTaskSession = codingTaskSession;
  }

  if (lastHeartbeatAt !== undefined) {
    snapshot.lastHeartbeatAt = lastHeartbeatAt;
    snapshot.heartbeatAgeMs = heartbeatAgeMs;
  }
  if (lastToolOutputAt !== undefined) {
    snapshot.lastToolOutputAt = lastToolOutputAt;
    snapshot.toolOutputAgeMs = toolOutputAgeMs;
  }

  return snapshot;
}

export {
  DEFAULT_POLICY,
  PROTOCOL_VERSION,
  normalizeEvents,
  reduceAgentProgress,
  sanitizeText
};
