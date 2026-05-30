import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createProgressState, readProgressState, snapshotProgressState, writeProgressState } from "./planner-agent-progress-state.mjs";
import { formatProgressReport, main as reportMain } from "./planner-agent-progress-report.mjs";

const NOW = "2026-05-29T13:00:00Z";
const RAW_MARKERS = [
  "Bearer agent-progress-secret-000",
  "api_key=sk-agentprogress-secret-000",
  "cookie=session-agent-progress-secret",
  "token=agent-progress-secret-token",
  "/Users/agent/progress/.env",
  "/private/tmp/agent-progress-secret",
  "~/.codex/auth.json",
  "raw prompt: summarize this private workspace",
  "provider response raw dump"
];

function progressEvent(overrides) {
  return {
    protocolVersion: "2026-05-29",
    eventId: "evt-smoke-default",
    runId: "run-smoke-agent-progress",
    cardId: "T272",
    timestamp: "2026-05-29T12:59:00Z",
    phase: "running_command",
    status: "running",
    message: "Agent progress smoke event.",
    ...overrides
  };
}

function assertNoRawMarkers(value, label) {
  const text = JSON.stringify(value);
  for (let index = 0; index < RAW_MARKERS.length; index += 1) {
    assert.equal(text.includes(RAW_MARKERS[index]), false, `${label} leaked raw marker ${index + 1}`);
  }
}

function assertReportIncludes(report, pattern, label) {
  assert.match(report, pattern, `${label} did not match expected report pattern`);
}

async function loadScenario(tmp, name, events) {
  const statePath = join(tmp, `${name}.json`);
  const state = createProgressState(events, { now: NOW });
  await writeProgressState(statePath, state, { now: NOW });
  const readBack = await readProgressState(statePath);
  const snapshot = snapshotProgressState(readBack, { now: NOW });
  const formattedReport = formatProgressReport(snapshot);
  let stdout = "";
  let stderr = "";
  const code = await reportMain(["--state", statePath, "--now", NOW], {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } }
  });
  assert.equal(code, 0, `${name} report command failed`);
  assert.equal(stderr, "", `${name} report command wrote stderr`);
  assert.equal(stdout, formattedReport, `${name} report command differed from formatter`);
  assertNoRawMarkers(readBack, `${name} state`);
  assertNoRawMarkers(snapshot, `${name} snapshot`);
  assertNoRawMarkers(stdout, `${name} report`);
  return { snapshot, report: stdout };
}

async function runSmoke() {
  const tmp = await mkdtemp(join(tmpdir(), "yet-agent-progress-smoke-"));
  try {
    const healthyLong = await loadScenario(tmp, "healthy-long-command", [
      progressEvent({
        eventId: "evt-healthy-long-001",
        timestamp: "2026-05-29T12:00:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      progressEvent({
        eventId: "evt-healthy-long-002",
        timestamp: "2026-05-29T12:59:50Z",
        phase: "running_command",
        status: "running",
        message: "Long command is still producing fresh heartbeats.",
        tool: {
          kind: "test",
          label: "cargo test -p yet-lsp",
          startedAt: "2026-05-29T12:00:00Z"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:58Z",
          lastToolOutputAt: "2026-05-29T12:59:55Z"
        },
        outputTail: "runtime tests are still running"
      })
    ]);
    assert.equal(healthyLong.snapshot.phase, "running_command");
    assert.equal(healthyLong.snapshot.status, "long_running");
    assert.equal(healthyLong.snapshot.stuckReason, "none");
    assert.equal(healthyLong.snapshot.currentTool.label, "cargo test -p yet-lsp");
    assertReportIncludes(healthyLong.report, /status: long_running/, "healthy long command");
    assertReportIncludes(healthyLong.report, /tool: test cargo test -p yet-lsp/, "healthy long command");
    assert.equal(healthyLong.report.includes("status: stuck"), false, "healthy long command was reported stuck");

    const stuck = await loadScenario(tmp, "stalled-stuck-command", [
      progressEvent({
        eventId: "evt-stuck-001",
        timestamp: "2026-05-29T12:30:00Z",
        phase: "running_command",
        status: "running",
        message: "Command has stopped heartbeating.",
        tool: {
          kind: "command",
          label: "npm run check",
          startedAt: "2026-05-29T12:30:00Z"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:45:00Z",
          lastToolOutputAt: "2026-05-29T12:46:00Z"
        }
      })
    ]);
    assert.equal(stuck.snapshot.status, "stuck");
    assert.equal(stuck.snapshot.stuckReason, "heartbeat_timeout");
    assertReportIncludes(stuck.report, /status: stuck/, "stalled command");
    assertReportIncludes(stuck.report, /stuck_reason: heartbeat_timeout/, "stalled command");

    const failed = await loadScenario(tmp, "failed-command", [
      progressEvent({
        eventId: "evt-failed-001",
        timestamp: "2026-05-29T12:56:00Z",
        phase: "running_command",
        status: "running",
        message: "Running verification command."
      }),
      progressEvent({
        eventId: "evt-failed-002",
        timestamp: "2026-05-29T12:57:00Z",
        phase: "failed",
        status: "failed",
        message: "Command failed after sanitized output.",
        outputTail: `failure tail ${RAW_MARKERS.join(" ")}`
      })
    ]);
    assert.equal(failed.snapshot.status, "failed");
    assert.equal(failed.snapshot.stuckReason, "explicit_failure");
    assert.equal(failed.snapshot.completedAt, "2026-05-29T12:57:00Z");
    assert.equal(failed.snapshot.outputTail.includes("[redacted"), true, "failed output was not redacted");
    assertReportIncludes(failed.report, /status: failed/, "failed command");
    assertReportIncludes(failed.report, /output_tail: .*\[redacted/, "failed command");

    const redacted = await loadScenario(tmp, "secret-redaction", [
      progressEvent({
        eventId: "evt-redaction-001",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "running_command",
        status: "running",
        message: "Checking sanitized output.",
        tool: {
          kind: "command",
          label: `node smoke ${RAW_MARKERS[3]} ${RAW_MARKERS[4]}`
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:59Z",
          lastToolOutputAt: "2026-05-29T12:59:59Z"
        },
        outputTail: RAW_MARKERS.join("\n")
      })
    ]);
    assert.equal(redacted.snapshot.status, "healthy_running");
    assert.equal(redacted.snapshot.outputTail.includes("[redacted"), true, "redaction output was not redacted");
    assert.equal(redacted.snapshot.currentTool.label.includes("[redacted"), true, "redaction tool label was not redacted");
    assertReportIncludes(redacted.report, /status: healthy_running/, "secret redaction");

    const overflowDump = `${"task_board_get full task board output too large. ".repeat(120)} ${RAW_MARKERS.join(" ")}`;
    const taskBoardOverflow = await loadScenario(tmp, "task-board-overflow", [
      progressEvent({
        eventId: "evt-overflow-board-001",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "context_length_exceeded after broad task_board_get output.",
        outputTail: overflowDump
      })
    ]);
    assert.equal(taskBoardOverflow.snapshot.status, "failed");
    assert.equal(taskBoardOverflow.snapshot.overflowRecovery?.kind, "task_board_output_too_large");
    assert.equal(taskBoardOverflow.snapshot.overflowRecovery?.retryable, true);
    assert.equal(JSON.stringify(taskBoardOverflow.snapshot).length < 5000, true, "task board overflow snapshot was not bounded");
    assertReportIncludes(taskBoardOverflow.report, /overflow_recovery: task_board_output_too_large/, "task board overflow");
    assertReportIncludes(taskBoardOverflow.report, /task_ready_cards/, "task board overflow");
    assertReportIncludes(taskBoardOverflow.report, /task_board_get\(card_id\)/, "task board overflow");
    assertReportIncludes(taskBoardOverflow.report, /output_tail: .*\[redacted/, "task board overflow");

    const toolOverflow = await loadScenario(tmp, "tool-output-overflow", [
      progressEvent({
        eventId: "evt-overflow-tool-001",
        timestamp: "2026-05-29T12:40:00Z",
        phase: "running_command",
        status: "running",
        message: "Tool output too large while reading broad search output.",
        tool: {
          kind: "planner",
          label: "broad search_pattern output"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:45:00Z",
          lastToolOutputAt: "2026-05-29T12:45:00Z"
        },
        outputTail: `${"search output too large; raw file content. ".repeat(100)} ${RAW_MARKERS.join(" ")}`
      })
    ]);
    assert.equal(toolOverflow.snapshot.status, "stuck");
    assert.equal(toolOverflow.snapshot.overflowRecovery?.kind, "tool_output_too_large");
    assertReportIncludes(toolOverflow.report, /overflow_recovery: tool_output_too_large/, "tool output overflow");
    assertReportIncludes(toolOverflow.report, /targeted search\/cat commands/, "tool output overflow");
    assert.equal(JSON.stringify(toolOverflow.snapshot).length < 5000, true, "tool overflow snapshot was not bounded");

    const done = await loadScenario(tmp, "done-run", [
      progressEvent({
        eventId: "evt-done-001",
        timestamp: "2026-05-29T12:50:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      progressEvent({
        eventId: "evt-done-002",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "done",
        status: "done",
        message: "Agent completed."
      })
    ]);
    assert.equal(done.snapshot.status, "done");
    assert.equal(done.snapshot.phase, "done");
    assert.equal(done.snapshot.stuckReason, "none");
    assert.equal(done.snapshot.completedAt, "2026-05-29T12:59:00Z");
    assertReportIncludes(done.report, /status: done/, "done run");
    assert.equal(done.report.includes("status: stuck"), false, "done run was reported stuck");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Agent progress smoke passed.");
}

export { runSmoke };
