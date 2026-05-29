import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, normalizeEvents, reduceAgentProgress } from "./planner-agent-progress.mjs";

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

function createProgressState(events = [], options = {}) {
  const now = options.now ?? new Date().toISOString();
  return {
    protocolVersion: PROTOCOL_VERSION,
    updatedAt: reduceAgentProgress(events, { now }).updatedAt,
    events: normalizeEvents(events, Date.parse(now))
  };
}

async function readProgressState(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw stateError("Agent progress state file was not found.");
    }
    throw stateError("Agent progress state file could not be read.");
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

async function writeProgressState(path, state, options = {}) {
  const normalized = createProgressState(validateStateShape(state).events, options);
  const dir = dirname(path);
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw stateError("Agent progress state file could not be written.");
  }
  return normalized;
}

async function appendProgressEvent(path, event, options = {}) {
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
}

function snapshotProgressState(state, options = {}) {
  return reduceAgentProgress(validateStateShape(state).events, options);
}

export {
  appendProgressEvent,
  createProgressState,
  readProgressState,
  snapshotProgressState,
  validateStateShape,
  writeProgressState
};
