import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_POOL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const SENSITIVE_KEY = /(prompt|provider|response|token|api.?key|auth|cookie|secret|path|content)/i;

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
  if (policy.safeSummary !== undefined && (typeof policy.safeSummary !== "string" || policy.safeSummary.length < 1 || policy.safeSummary.length > 512)) {
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
  for (const event of timeline) {
    assertObject(event, "auditTimeline.event");
    assertSafeId(event.tickId, "auditTimeline.tickId");
    assertSafeId(event.poolId, "auditTimeline.poolId", SAFE_POOL_ID);
    assertDateTime(event.observedAt, "auditTimeline.observedAt");
    if (typeof event.nextAction !== "string") {
      throw new Error("auditTimeline.nextAction: invalid scheduler state");
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
    if (/^[A-Za-z0-9_-]{1,64}$/.test(key) && Number.isInteger(count) && count >= 0 && count <= 10000) {
      counts[key] = count;
    }
  }
  return counts;
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
    if (key === "idleReason" && typeof event.idleReason === "string") {
      sanitized.idleReason = event.idleReason;
    }
    if (key === "safeSummary" && typeof event.safeSummary === "string") {
      sanitized.safeSummary = event.safeSummary.slice(0, 512);
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
  }
  return sanitized;
}

function appendAuditEvent(state, event) {
  const nextState = clone(state);
  const sanitized = sanitizeAuditEvent(event);
  nextState.auditTimeline = [...nextState.auditTimeline, sanitized];
  nextState.lastTick = {
    tickId: sanitized.tickId,
    observedAt: sanitized.observedAt,
    nextAction: sanitized.nextAction,
    leaseOwnerId: sanitized.leaseOwnerId
  };
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
