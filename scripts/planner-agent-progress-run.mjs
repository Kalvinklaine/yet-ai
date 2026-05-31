import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendProgressEvent, resolveAgentProgressStatePath } from "./planner-agent-progress-state.mjs";
import { PROTOCOL_VERSION, sanitizeText } from "./planner-agent-progress.mjs";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const MIN_HEARTBEAT_INTERVAL_MS = 100;
const MAX_HEARTBEAT_INTERVAL_MS = 60000;
const MAX_OUTPUT_TAIL_LENGTH = 2000;
const ALLOWED_TOOL_KINDS = new Set(["validation", "test", "command", "other"]);
const ALLOWED_PHASES = new Set(["running_command", "verifying"]);

function usage() {
  return [
    "Usage: node scripts/planner-agent-progress-run.mjs --card <id> --run <id> [--state <path>] [--phase <phase>] [--tool-kind <kind>] [--tool-label <label>] [--heartbeat-interval-ms <ms>] -- <command> [args...]"
  ].join("\n");
}

function safeError(message) {
  return `${sanitizeText(message, 1000) || "Agent progress command wrapper failed."}\n`;
}

function parseArgs(argv) {
  const options = {
    phase: "running_command",
    toolKind: "command",
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS
  };
  const separator = argv.indexOf("--");
  const optionArgs = separator === -1 ? argv : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);

  for (let index = 0; index < optionArgs.length; index += 1) {
    const name = optionArgs[index];
    const value = optionArgs[index + 1];
    if (name === "--card") {
      options.cardId = value;
      index += 1;
    } else if (name === "--run") {
      options.runId = value;
      index += 1;
    } else if (name === "--state") {
      options.state = value;
      index += 1;
    } else if (name === "--phase") {
      options.phase = value;
      index += 1;
    } else if (name === "--tool-kind") {
      options.toolKind = value;
      index += 1;
    } else if (name === "--tool-label") {
      options.toolLabel = value;
      index += 1;
    } else if (name === "--heartbeat-interval-ms") {
      options.heartbeatIntervalMs = Number(value);
      index += 1;
    } else {
      throw new Error("Invalid agent progress wrapper arguments.");
    }
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.cardId ?? "")) {
    throw new Error("Invalid or missing card id.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.runId ?? "")) {
    throw new Error("Invalid or missing run id.");
  }
  if (!ALLOWED_PHASES.has(options.phase)) {
    throw new Error("Invalid command phase.");
  }
  if (!ALLOWED_TOOL_KINDS.has(options.toolKind)) {
    throw new Error("Invalid tool kind.");
  }
  if (!Number.isFinite(options.heartbeatIntervalMs)) {
    throw new Error("Invalid heartbeat interval.");
  }
  options.heartbeatIntervalMs = Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.min(MAX_HEARTBEAT_INTERVAL_MS, Math.trunc(options.heartbeatIntervalMs)));
  if (command.length === 0 || typeof command[0] !== "string" || command[0].length === 0) {
    throw new Error("Missing wrapped command.");
  }
  options.command = command;
  options.toolLabel = options.toolLabel ?? command.join(" ");
  return options;
}

function nowIso() {
  return new Date().toISOString().replace(".000Z", "Z");
}

function makeEvent(options, phase, status, message, extra = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId: `evt-${Date.now()}-${randomUUID()}`,
    runId: options.runId,
    cardId: options.cardId,
    timestamp: nowIso(),
    phase,
    status,
    message,
    ...extra
  };
}

function makeTool(options, startedAt) {
  return {
    kind: options.toolKind,
    label: options.toolLabel,
    startedAt
  };
}

function appendChunk(current, chunk) {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return (current + text).slice(Math.max(0, current.length + text.length - MAX_OUTPUT_TAIL_LENGTH * 4));
}

function boundedOutputTail(rawOutput) {
  return sanitizeText(rawOutput, MAX_OUTPUT_TAIL_LENGTH);
}

async function appendSafe(statePath, event) {
  await appendProgressEvent(statePath, event);
}

async function run(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr, env: process.env }) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(safeError(`${error.message}\n${usage()}`));
    return 2;
  }

  const statePath = resolveAgentProgressStatePath({ state: options.state, env: io.env });
  const startedAt = nowIso();
  const tool = makeTool(options, startedAt);
  let outputTail = "";
  let child;
  let heartbeatTimer;
  let heartbeatAttempt = 0;
  let finished = false;
  let heartbeatWrites = Promise.resolve();
  let lastToolOutputAt;

  const writeEvent = async (event) => appendSafe(statePath, event);

  try {
    await writeEvent(makeEvent(options, "started", "running", "Command wrapper started."));
    await writeEvent(makeEvent(options, options.phase, "running", "Wrapped command started.", { tool }));
  } catch (error) {
    io.stderr.write(safeError(error.message));
    return 1;
  }

  try {
    child = spawn(options.command[0], options.command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env: io.env
    });
  } catch (error) {
    await writeEvent(makeEvent(options, "failed", "failed", "Wrapped command could not be started.", { tool })).catch(() => {});
    io.stderr.write(safeError(error.message));
    return 1;
  }

  child.stdout?.on("data", (chunk) => {
    io.stdout.write(chunk);
    outputTail = appendChunk(outputTail, chunk);
    lastToolOutputAt = nowIso();
  });
  child.stderr?.on("data", (chunk) => {
    io.stderr.write(chunk);
    outputTail = appendChunk(outputTail, chunk);
    lastToolOutputAt = nowIso();
  });

  const queueHeartbeat = () => {
    if (finished) {
      return heartbeatWrites;
    }
    heartbeatWrites = heartbeatWrites.then(async () => {
      if (finished) {
        return;
      }
      heartbeatAttempt += 1;
      const heartbeat = { lastHeartbeatAt: nowIso(), attempt: heartbeatAttempt };
      if (lastToolOutputAt !== undefined) {
        heartbeat.lastToolOutputAt = lastToolOutputAt;
      }
      await writeEvent(makeEvent(options, options.phase, "running", "Wrapped command heartbeat.", {
        tool,
        heartbeat,
        outputTail: boundedOutputTail(outputTail)
      })).catch(() => {});
    });
    heartbeatWrites = heartbeatWrites.catch(() => {});
    return heartbeatWrites;
  };

  heartbeatTimer = setInterval(queueHeartbeat, options.heartbeatIntervalMs);
  await queueHeartbeat();

  const interrupt = async (signal) => {
    if (finished) {
      return;
    }
    finished = true;
    clearInterval(heartbeatTimer);
    child.kill(signal);
    await heartbeatWrites;
    await writeEvent(makeEvent(options, "failed", "failed", "Wrapped command interrupted.", {
      tool,
      outputTail: boundedOutputTail(outputTail)
    })).catch(() => {});
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onSigint = () => { void interrupt("SIGINT"); };
  const onSigterm = () => { void interrupt("SIGTERM"); };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return await new Promise((resolve) => {
    child.once("error", async (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearInterval(heartbeatTimer);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      await heartbeatWrites;
      await writeEvent(makeEvent(options, "failed", "failed", "Wrapped command spawn failed.", { tool })).catch(() => {});
      io.stderr.write(safeError(error.message));
      resolve(1);
    });

    child.once("close", async (code, signal) => {
      if (finished) {
        return;
      }
      finished = true;
      clearInterval(heartbeatTimer);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      await heartbeatWrites;
      const cleanTail = boundedOutputTail(outputTail);
      const terminal = code === 0 ? "done" : "failed";
      const message = code === 0 ? "Wrapped command completed." : signal === null ? "Wrapped command failed." : "Wrapped command interrupted.";
      try {
        await writeEvent(makeEvent(options, terminal, terminal, message, {
          tool,
          heartbeat: {
            lastHeartbeatAt: nowIso(),
            ...(lastToolOutputAt === undefined ? {} : { lastToolOutputAt }),
            attempt: Math.max(1, heartbeatAttempt)
          },
          outputTail: cleanTail
        }));
      } catch (error) {
        io.stderr.write(safeError(error.message));
        resolve(1);
        return;
      }
      resolve(code === 0 ? 0 : code ?? 1);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await run();
  process.exit(exitCode);
}

export { parseArgs, run };
