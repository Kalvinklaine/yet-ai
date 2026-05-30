import { pathToFileURL } from "node:url";
import { readProgressState, snapshotProgressState } from "./planner-agent-progress-state.mjs";
import { sanitizeText } from "./planner-agent-progress.mjs";

const MAX_REPORT_TAIL = 360;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--state") {
      args.state = argv[index + 1];
      index += 1;
    } else if (value === "--now") {
      args.now = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.trunc((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.trunc(seconds / 3600);
  const minutes = Math.trunc((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainder}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }
  return `${remainder}s`;
}

function line(label, value) {
  return `${label}: ${sanitizeText(String(value ?? "none"), 500)}`;
}

function formatProgressReport(snapshot) {
  const lines = [
    line("card", snapshot.cardId),
    line("run", snapshot.runId),
    line("phase", snapshot.phase),
    line("status", snapshot.status),
    line("tool", snapshot.currentTool === undefined ? "none" : `${snapshot.currentTool.kind} ${snapshot.currentTool.label}`),
    line("elapsed", formatDuration(snapshot.elapsedMs)),
    line("heartbeat_age", snapshot.heartbeatAgeMs === undefined ? "unknown" : formatDuration(snapshot.heartbeatAgeMs)),
    line("output_age", snapshot.toolOutputAgeMs === undefined ? "unknown" : formatDuration(snapshot.toolOutputAgeMs)),
    line("stuck_reason", snapshot.stuckReason ?? "none")
  ];

  if (snapshot.overflowRecovery !== undefined) {
    lines.push(line("overflow_recovery", `${snapshot.overflowRecovery.kind}: ${snapshot.overflowRecovery.message}`));
  }

  const outputTail = sanitizeText(snapshot.outputTail, MAX_REPORT_TAIL);
  if (outputTail.length > 0) {
    lines.push(line("output_tail", outputTail));
  }

  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2), io = {}) {
  const args = parseArgs(argv);
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  if (typeof args.state !== "string" || args.state.length === 0) {
    stderr.write("Missing required --state path.\n");
    return 2;
  }

  try {
    const state = await readProgressState(args.state);
    const snapshot = snapshotProgressState(state, { now: args.now ?? new Date().toISOString() });
    stdout.write(formatProgressReport(snapshot));
    return 0;
  } catch (error) {
    stderr.write(`${sanitizeText(error?.message, 240) || "Agent progress report failed."}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main();
  process.exitCode = code;
}

export { formatDuration, formatProgressReport, main, parseArgs };
