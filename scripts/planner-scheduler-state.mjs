import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_POOL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const SAFE_IDLE_REASONS = new Set([
  "waiting_for_user_decision",
  "waiting_for_external_dependency",
  "concurrency_limit_reached",
  "blocked_by_failed_verification",
  "blocked_by_policy",
  "all_work_closed",
  "autonomy_not_permitted"
]);
const OVERFLOW_RECOVERY_KINDS = new Set(["context_length_exceeded", "tool_output_too_large", "task_board_output_too_large"]);
const SAFE_SUMMARY_MAX_LENGTH = 512;
const SAFE_OVERFLOW_MESSAGE_MAX_LENGTH = 320;
const AUDIT_TIMELINE_MAX_EVENTS = 10;
const COUNT_MAP_MAX_ENTRIES = 16;
const SENSITIVE_KEY = /(prompt|provider|response|token|api.?key|auth|cookie|secret|credential|path|content|dump|raw|board|workspace|tool.*output|full.*json)/i;
const UNSAFE_TEXT = /(api[_-]?key|authorization|bearer|token|secret|password|cookie|pkce|refresh|access[_-]?token|auth[_-]?code|chain[-_ ]?of[-_ ]?thought|raw[_-]?(?:prompt|dump|output)|provider[_-]?(?:response|body)|credential|file[_-]?content|workspace[_-]?file|\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\|~\/|\.codex\/auth\.json|auth\.json|BEGIN [A-Z ]*PRIVATE KEY)/i;

function boundedSafeText(value, maxLength, fallback) {
  if (typeof value !== "string" || value.length < 1 || UNSAFE_TEXT.test(value)) {
    return fallback;
  }
  return value.slice(0, maxLength);
}

function overflowMessageFor(kind) {
  switch (kind) {
    case "context_length_exceeded":
      return "Context overflow was detected and summarized without raw context data.";
    case "tool_output_too_large":
      return "Tool output overflow was detected and summarized without raw tool output.";
    case "task_board_output_too_large":
      return "Task board overflow was detected and summarized without raw board data.";
    default:
      return "Overflow was detected and summarized without raw data.";
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: invalid scheduler state`);
  }
}

function assertSafeId(value, label, pattern = SAFE_ID) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label}: invalid scheduler state`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label}: invalid scheduler state`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: invalid scheduler state`);
  }
}

function assertDateTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label}: invalid scheduler state`);
  }
}

function validatePolicy(policy) {
  assertObject(policy, "policy");
  assertBoolean(policy.autonomousMode, "policy.autonomousMode");
  if (policy.safeSummary !== undefined && (typeof policy.safeSummary !== "string" || policy.safeSummary.length < 1 || policy.safeSummary.length > SAFE_SUMMARY_MAX_LENGTH || UNSAFE_TEXT.test(policy.safeSummary))) {
    throw new Error("policy.safeSummary: invalid scheduler state");
  }
}

function validateCards(cards) {
  assertArray(cards, "cards");
  for (const card of cards) {
    assertObject(card, "card");
    assertSafeId(card.cardId, "card.cardId");
    if (typeof card.status !== "string") {
      throw new Error("card.status: invalid scheduler state");
    }
  }
}

function validateAgents(agents) {
  assertArray(agents, "agents");
  for (const agent of agents) {
    assertObject(agent, "agent");
    assertSafeId(agent.agentRunId, "agent.agentRunId");
    assertSafeId(agent.cardId, "agent.cardId");
    if (typeof agent.status !== "string") {
      throw new Error("agent.status: invalid scheduler state");
    }
  }
}

function validateLease(lease) {
  if (lease === null || lease === undefined) {
    return;
  }
  assertObject(lease, "activeSchedulerLease");
  assertSafeId(lease.ownerId, "activeSchedulerLease.ownerId");
  assertDateTime(lease.acquiredAt, "activeSchedulerLease.acquiredAt");
}

function validateAuditTimeline(timeline) {
  assertArray(timeline, "auditTimeline");
  if (timeline.length > AUDIT_TIMELINE_MAX_EVENTS) {
    throw new Error("auditTimeline: invalid scheduler state");
  }
  for (const event of timeline) {
    assertObject(event, "auditTimeline.event");
    assertSafeId(event.tickId, "auditTimeline.tickId");
    assertSafeId(event.poolId, "auditTimeline.poolId", SAFE_POOL_ID);
    assertDateTime(event.observedAt, "auditTimeline.observedAt");
    if (typeof event.nextAction !== "string") {
      throw new Error("auditTimeline.nextAction: invalid scheduler state");
    }
    if (event.idleReason !== undefined && !SAFE_IDLE_REASONS.has(event.idleReason)) {
      throw new Error("auditTimeline.idleReason: invalid scheduler state");
    }
    if (event.safeSummary !== undefined && (typeof event.safeSummary !== "string" || event.safeSummary.length < 1 || event.safeSummary.length > SAFE_SUMMARY_MAX_LENGTH || UNSAFE_TEXT.test(event.safeSummary))) {
      throw new Error("auditTimeline.safeSummary: invalid scheduler state");
    }
    if (event.agentCounts !== undefined) {
      validateCountMap(event.agentCounts, "auditTimeline.agentCounts");
    }
    if (event.cardCounts !== undefined) {
      validateCountMap(event.cardCounts, "auditTimeline.cardCounts");
    }
    if (event.leaseOwnerId !== undefined) {
      assertSafeId(event.leaseOwnerId, "auditTimeline.leaseOwnerId");
    }
    if (event.overflowRecovery !== undefined) {
      validateOverflowRecovery(event.overflowRecovery, "auditTimeline.overflowRecovery");
    }
  }
}

function validateCountMap(value, label) {
  assertObject(value, label);
  const entries = Object.entries(value);
  if (entries.length > COUNT_MAP_MAX_ENTRIES) {
    throw new Error(`${label}: invalid scheduler state`);
  }
  for (const [key, count] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || !Number.isInteger(count) || count < 0 || count > 10000) {
      throw new Error(`${label}: invalid scheduler state`);
    }
  }
}

function validateOverflowRecovery(value, label) {
  assertObject(value, label);
  if (!OVERFLOW_RECOVERY_KINDS.has(value.kind)) {
    throw new Error(`${label}.kind: invalid scheduler state`);
  }
  if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > SAFE_OVERFLOW_MESSAGE_MAX_LENGTH || UNSAFE_TEXT.test(value.message)) {
    throw new Error(`${label}.message: invalid scheduler state`);
  }
  if (value.retryable !== undefined && typeof value.retryable !== "boolean") {
    throw new Error(`${label}.retryable: invalid scheduler state`);
  }
  for (const key of Object.keys(value)) {
    if (!["kind", "message", "retryable"].includes(key)) {
      throw new Error(`${label}: invalid scheduler state`);
    }
  }
}

function validateLastTick(lastTick) {
  if (lastTick === null || lastTick === undefined) {
    return;
  }
  assertObject(lastTick, "lastTick");
  assertSafeId(lastTick.tickId, "lastTick.tickId");
  assertDateTime(lastTick.observedAt, "lastTick.observedAt");
  if (typeof lastTick.nextAction !== "string") {
    throw new Error("lastTick.nextAction: invalid scheduler state");
  }
}

function validateSchedulerState(state) {
  assertObject(state, "state");
  assertSafeId(state.poolId, "poolId", SAFE_POOL_ID);
  validatePolicy(state.autonomousPolicy);
  validateCards(state.cards);
  validateAgents(state.agents);
  validateAuditTimeline(state.auditTimeline);
  validateLastTick(state.lastTick);
  validateLease(state.activeSchedulerLease);
  return state;
}

async function readSchedulerState(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("scheduler state: read failed");
  }
  return validateSchedulerState(parsed);
}

async function writeSchedulerState(filePath, state) {
  validateSchedulerState(state);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = join(dirname(filePath), `.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function copySafeCountMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const counts = {};
  for (const [key, count] of Object.entries(value)) {
    if (Object.keys(counts).length >= COUNT_MAP_MAX_ENTRIES) {
      break;
    }
    if (/^[A-Za-z0-9_-]{1,64}$/.test(key) && Number.isInteger(count) && count >= 0 && count <= 10000) {
      counts[key] = count;
    }
  }
  return counts;
}

function sanitizeOverflowRecovery(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const kind = OVERFLOW_RECOVERY_KINDS.has(value.kind) ? value.kind : undefined;
  if (kind === undefined) {
    return undefined;
  }
  const recovery = {
    kind,
    message: boundedSafeText(value.message, SAFE_OVERFLOW_MESSAGE_MAX_LENGTH, overflowMessageFor(kind))
  };
  if (typeof value.retryable === "boolean") {
    recovery.retryable = value.retryable;
  }
  return recovery;
}

function sanitizeAuditEvent(event) {
  assertObject(event, "audit event");
  const sanitized = {
    tickId: event.tickId,
    poolId: event.poolId,
    observedAt: event.observedAt,
    nextAction: event.nextAction
  };
  assertSafeId(sanitized.tickId, "audit event.tickId");
  assertSafeId(sanitized.poolId, "audit event.poolId", SAFE_POOL_ID);
  assertDateTime(sanitized.observedAt, "audit event.observedAt");
  if (typeof sanitized.nextAction !== "string") {
    throw new Error("audit event.nextAction: invalid scheduler state");
  }
  for (const key of Object.keys(event)) {
    if (SENSITIVE_KEY.test(key)) {
      continue;
    }
    if (key === "idleReason" && SAFE_IDLE_REASONS.has(event.idleReason)) {
      sanitized.idleReason = event.idleReason;
    }
    if (key === "safeSummary" && typeof event.safeSummary === "string") {
      sanitized.safeSummary = boundedSafeText(
        event.safeSummary,
        SAFE_SUMMARY_MAX_LENGTH,
        "Scheduler audit event was summarized without raw data."
      );
    }
    if (key === "agentCounts") {
      sanitized.agentCounts = copySafeCountMap(event.agentCounts);
    }
    if (key === "cardCounts") {
      sanitized.cardCounts = copySafeCountMap(event.cardCounts);
    }
    if (key === "leaseOwnerId" && typeof event.leaseOwnerId === "string" && SAFE_ID.test(event.leaseOwnerId)) {
      sanitized.leaseOwnerId = event.leaseOwnerId;
    }
    if (key === "overflowRecovery") {
      sanitized.overflowRecovery = sanitizeOverflowRecovery(event.overflowRecovery);
    }
  }
  if (sanitized.overflowRecovery === undefined) {
    delete sanitized.overflowRecovery;
  }
  return sanitized;
}

function appendAuditEvent(state, event) {
  const nextState = clone(state);
  const sanitized = sanitizeAuditEvent(event);
  nextState.auditTimeline = [...nextState.auditTimeline, sanitized].slice(-AUDIT_TIMELINE_MAX_EVENTS);
  nextState.lastTick = {
    tickId: sanitized.tickId,
    observedAt: sanitized.observedAt,
    nextAction: sanitized.nextAction
  };
  if (sanitized.leaseOwnerId !== undefined) {
    nextState.lastTick.leaseOwnerId = sanitized.leaseOwnerId;
  }
  validateSchedulerState(nextState);
  return nextState;
}

function acquireSchedulerLease(state, ownerId, acquiredAt) {
  assertSafeId(ownerId, "lease owner");
  assertDateTime(acquiredAt, "lease acquiredAt");
  if (state.activeSchedulerLease !== null && state.activeSchedulerLease !== undefined) {
    throw new Error("scheduler lease: already active");
  }
  const nextState = clone(state);
  nextState.activeSchedulerLease = { ownerId, acquiredAt };
  validateSchedulerState(nextState);
  return nextState;
}

function releaseSchedulerLease(state, ownerId, releasedAt) {
  assertSafeId(ownerId, "lease owner");
  assertDateTime(releasedAt, "lease releasedAt");
  if (state.activeSchedulerLease?.ownerId !== ownerId) {
    throw new Error("scheduler lease: owner mismatch");
  }
  const nextState = clone(state);
  nextState.activeSchedulerLease = null;
  nextState.lastLeaseReleasedAt = releasedAt;
  validateSchedulerState(nextState);
  return nextState;
}

export {
  acquireSchedulerLease,
  appendAuditEvent,
  readSchedulerState,
  releaseSchedulerLease,
  sanitizeAuditEvent,
  validateSchedulerState,
  writeSchedulerState
};
