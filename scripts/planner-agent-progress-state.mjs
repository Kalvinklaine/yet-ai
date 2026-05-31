import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, normalizeEvents, reduceAgentProgress } from "./planner-agent-progress.mjs";

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;
const STATE_ENV_OVERRIDE = "YET_AI_AGENT_PROGRESS_STATE";

function stateError(message) {
  const error = new Error(message);
  error.name = "AgentProgressStateError";
  return error;
}

function validateStateShape(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw stateError("Invalid agent progress state: expected a JSON object.");
  }
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    throw stateError("Invalid agent progress state: unsupported protocol version.");
  }
  if (!Array.isArray(value.events)) {
    throw stateError("Invalid agent progress state: events must be an array.");
  }
  return value;
}

function resolveAgentProgressStatePath(options = {}) {
  if (typeof options.state === "string" && options.state.length > 0) {
    return options.state;
  }
  const env = options.env ?? process.env;
  if (typeof env?.[STATE_ENV_OVERRIDE] === "string" && env[STATE_ENV_OVERRIDE].length > 0) {
    return env[STATE_ENV_OVERRIDE];
  }
  const cacheRoot = typeof options.cacheRoot === "string" && options.cacheRoot.length > 0 ? options.cacheRoot : ".";
  return join(cacheRoot, "yet-ai", "agent-progress", "progress.json");
}

function createProgressState(events = [], options = {}) {
  const now = options.now ?? new Date().toISOString();
  return {
    protocolVersion: PROTOCOL_VERSION,
    updatedAt: reduceAgentProgress(events, { now }).updatedAt,
    events: normalizeEvents(events, Date.parse(now))
  };
}

function eventStatePath(path) {
  return `${path}.events.json`;
}

async function readProgressState(path) {
  const internalPath = eventStatePath(path);
  let raw;
  try {
    raw = await readFile(internalPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw stateError("Agent progress state file could not be read.");
    }
    try {
      raw = await readFile(path, "utf8");
    } catch (readError) {
      if (readError?.code === "ENOENT") {
        throw stateError("Agent progress state file was not found.");
      }
      throw stateError("Agent progress state file could not be read.");
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw stateError("Agent progress state file is not valid JSON.");
  }

  const state = validateStateShape(parsed);
  return createProgressState(state.events, { now: state.updatedAt ?? new Date().toISOString() });
}

async function writeJsonAtomic(path, value) {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, path);
  } catch {
    await rm(tempPath, { force: true }).catch(() => {});
    throw stateError("Agent progress state file could not be written.");
  }
}

async function writeProgressState(path, state, options = {}) {
  const normalized = createProgressState(validateStateShape(state).events, options);
  const dir = dirname(path);
  try {
    await mkdir(dir, { recursive: true });
    await writeJsonAtomic(eventStatePath(path), normalized);
    await writeJsonAtomic(path, createProgressListResponse(normalized, options));
  } catch (error) {
    if (error?.name === "AgentProgressStateError") {
      throw error;
    }
    throw stateError("Agent progress state file could not be written.");
  }
  return normalized;
}

async function acquireProgressLock(path, options = {}) {
  const lockTimeoutMs = Math.max(0, Number(options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS));
  const lockPath = `${path}.lock`;
  const started = Date.now();
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    throw stateError("Agent progress state lock could not be acquired.");
  }
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return { handle, lockPath };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw stateError("Agent progress state lock could not be acquired.");
      }
      if (Date.now() - started >= lockTimeoutMs) {
        throw stateError("Agent progress state lock timed out.");
      }
      await delay(Math.min(LOCK_RETRY_MS, Math.max(1, lockTimeoutMs - (Date.now() - started))));
    }
  }
}

async function releaseProgressLock(lock) {
  try {
    await lock.handle.close();
  } finally {
    await rm(lock.lockPath, { force: true }).catch(() => {});
  }
}

async function appendProgressEvent(path, event, options = {}) {
  const lock = await acquireProgressLock(path, options);
  try {
    let state;
    try {
      state = await readProgressState(path);
    } catch (error) {
      if (error?.message !== "Agent progress state file was not found.") {
        throw error;
      }
      state = createProgressState([], options);
    }
    const next = createProgressState([...state.events, event], options);
    await writeProgressState(path, next, options);
    return next;
  } finally {
    await releaseProgressLock(lock);
  }
}

function snapshotProgressState(state, options = {}) {
  return reduceAgentProgress(validateStateShape(state).events, options);
}

function snapshotProgressStates(state, options = {}) {
  const events = validateStateShape(state).events;
  const byRunId = new Map();
  for (const event of events) {
    const runEvents = byRunId.get(event.runId) ?? [];
    runEvents.push(event);
    byRunId.set(event.runId, runEvents);
  }
  return [...byRunId.values()].map((runEvents) => reduceAgentProgress(runEvents, options));
}

function createProgressListResponse(state, options = {}) {
  const now = options.now ?? state.updatedAt ?? new Date().toISOString();
  return {
    cloudRequired: false,
    providerAccess: "direct",
    generatedAt: now,
    snapshots: snapshotProgressStates(state, { ...options, now })
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  appendProgressEvent,
  createProgressListResponse,
  createProgressState,
  readProgressState,
  resolveAgentProgressStatePath,
  snapshotProgressState,
  snapshotProgressStates,
  validateStateShape,
  writeProgressState
};
