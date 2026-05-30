import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reduceAgentProgress } from "./planner-agent-progress.mjs";
import { appendProgressEvent, createProgressState, readProgressState, snapshotProgressState, writeProgressState } from "./planner-agent-progress-state.mjs";
import { formatProgressReport, main as reportMain } from "./planner-agent-progress-report.mjs";

const NOW = "2026-05-29T13:00:00Z";

function event(overrides) {
  return {
    protocolVersion: "2026-05-29",
    eventId: "evt-default",
    runId: "run-T270-001",
    cardId: "T270",
    timestamp: "2026-05-29T12:59:00Z",
    phase: "running_command",
    status: "running",
    message: "Agent progress updated.",
    ...overrides
  };
}

function serialized(value) {
  return JSON.stringify(value);
}

function assertNoSensitiveContent(value) {
  const text = serialized(value).toLowerCase();
  for (const forbidden of [
    "rawprompt",
    "raw_prompt",
    "chainofthought",
    "chain_of_thought",
    "chain-of-thought",
    "providerresponse",
    "provider_response",
    "api_key",
    "apikey",
    "authorization",
    "bearer ",
    "cookie",
    "pkce",
    "refresh_token",
    "access_token",
    "credential",
    "sk-live-secret",
    "c:\\users\\",
    "/users/",
    "/home/",
    "/private/",
    "~/",
    "auth.json"
  ]) {
    assert.equal(text.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }
}

async function runAssertions() {
  const healthy = reduceAgentProgress(
    [
      event({
        eventId: "evt-healthy-001",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      event({
        eventId: "evt-healthy-002",
        timestamp: "2026-05-29T12:59:45Z",
        phase: "running_command",
        status: "running",
        message: "Running validation with fresh heartbeat.",
        tool: {
          kind: "validation",
          label: "npm run validate:contracts",
          startedAt: "2026-05-29T12:59:00Z"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:55Z",
          lastToolOutputAt: "2026-05-29T12:59:50Z"
        },
        outputTail: "Validation is still running."
      })
    ],
    { now: NOW }
  );
  assert.equal(healthy.status, "healthy_running");
  assert.equal(healthy.stuckReason, "none");
  assert.equal(healthy.currentTool.label, "npm run validate:contracts");
  assert.equal(healthy.lastHeartbeatAt, "2026-05-29T12:59:55Z");
  assert.equal(healthy.heartbeatAgeMs, 5000);
  assertNoSensitiveContent(healthy);

  const longRunning = reduceAgentProgress(
    [
      event({
        eventId: "evt-long-001",
        timestamp: "2026-05-29T12:00:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      event({
        eventId: "evt-long-002",
        timestamp: "2026-05-29T12:59:50Z",
        phase: "verifying",
        status: "running",
        message: "Verification is still producing heartbeats.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:58Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(longRunning.status, "long_running");
  assert.equal(longRunning.stuckReason, "none");
  assert.equal(longRunning.elapsedMs, 3600000);

  const stalled = reduceAgentProgress(
    [
      event({
        eventId: "evt-stalled-001",
        timestamp: "2026-05-29T12:40:00Z",
        phase: "running_command",
        status: "running",
        message: "Command is running.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:54:30Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(stalled.status, "stalled");
  assert.equal(stalled.stuckReason, "heartbeat_timeout");

  const stuck = reduceAgentProgress(
    [
      event({
        eventId: "evt-stuck-001",
        timestamp: "2026-05-29T12:30:00Z",
        phase: "running_command",
        status: "running",
        message: "Command is still running.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:45:00Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(stuck.status, "stuck");
  assert.equal(stuck.stuckReason, "heartbeat_timeout");

  const failed = reduceAgentProgress(
    [
      event({
        eventId: "evt-failed-001",
        timestamp: "2026-05-29T12:57:00Z",
        phase: "running_command",
        status: "running",
        message: "Running command."
      }),
      event({
        eventId: "evt-failed-002",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "Command failed with sanitized error.",
        outputTail: "authorization: Bearer abcdefghijklmnop api_key=sk-live-secret-token path /Users/person/project/.env cookie=session=private"
      })
    ],
    { now: NOW }
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.stuckReason, "explicit_failure");
  assert.equal(failed.completedAt, "2026-05-29T12:58:00Z");
  assertNoSensitiveContent(failed);
  assert.equal(failed.outputTail.includes("[redacted"), true);

  const done = reduceAgentProgress(
    [
      event({
        eventId: "evt-done-001",
        timestamp: "2026-05-29T12:50:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      event({
        eventId: "evt-done-002",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "done",
        status: "done",
        message: "Agent completed verification."
      })
    ],
    { now: NOW }
  );
  assert.equal(done.status, "done");
  assert.equal(done.phase, "done");
  assert.equal(done.completedAt, "2026-05-29T12:59:00Z");
  assert.equal(done.stuckReason, "none");

  const unordered = [
    event({
      eventId: "evt-order-003",
      timestamp: "2026-05-29T12:59:00Z",
      phase: "verifying",
      status: "running",
      message: "Later event."
    }),
    event({
      eventId: "evt-order-001",
      timestamp: "2026-05-29T12:57:00Z",
      phase: "started",
      status: "running",
      message: "Earlier event."
    }),
    event({
      eventId: "evt-order-003",
      timestamp: "2026-05-29T12:59:00Z",
      phase: "failed",
      status: "failed",
      message: "Duplicate should be ignored."
    }),
    event({
      eventId: "evt-order-002",
      timestamp: "2026-05-29T12:58:00Z",
      phase: "stuck",
      status: "stuck",
      message: "Agent explicitly stuck."
    }),
    event({
      eventId: "evt-order-004",
      timestamp: "2026-05-29T12:59:30Z",
      phase: "done",
      status: "done",
      message: "Terminal done supersedes stuck."
    })
  ];
  const unorderedA = reduceAgentProgress(unordered, { now: NOW });
  const unorderedB = reduceAgentProgress([...unordered].reverse(), { now: NOW });
  assert.deepEqual(unorderedA, unorderedB);
  assert.equal(unorderedA.status, "done");
  assert.equal(unorderedA.stuckReason, "none");
  assert.deepEqual(
    unorderedA.recentEvents.map((recent) => recent.eventId),
    ["evt-order-001", "evt-order-002", "evt-order-003", "evt-order-004"]
  );

  const malicious = reduceAgentProgress(
    [
      event({
        eventId: "evt-malicious-001",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "running_command",
        status: "running",
        message: "raw_prompt: read /Users/person/project/file.ts with chain-of-thought and provider_response",
        tool: {
          kind: "command",
          label: "cat /home/person/.credentials token=secret"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:59Z",
          lastToolOutputAt: "2026-05-29T12:59:59Z"
        },
        outputTail: "chain of thought: hidden\nprovider response: raw\ncredential=/private/tmp/key\naccess_token=abc123\nfile content: export API_KEY=sk-live-secret-token"
      })
    ],
    { now: NOW }
  );
  assert.equal(malicious.status, "healthy_running");
  assertNoSensitiveContent(malicious);
  assert.equal(serialized(malicious).length < 5000, true, "snapshot was not bounded");

  const hugeSecretOutput = [
    "task_board_get failed because task board output too large and maximum context length was exceeded.",
    "authorization: Bearer abcdefghijklmnop cookie=session=private api_key=sk-live-secret-token",
    "raw_prompt: include provider_response and file content from /Users/person/project/file.ts",
    "C:\\Users\\person\\AppData\\secret auth.json ~/.codex/auth.json /private/tmp/key /home/person/file"
  ].join("\n") + "\n" + "provider response raw dump ".repeat(1000);
  const overflowFailed = reduceAgentProgress(
    [
      event({
        eventId: "evt-overflow-failed",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "context_length_exceeded while reading task_board_get output.",
        outputTail: hugeSecretOutput
      })
    ],
    { now: NOW }
  );
  assert.equal(overflowFailed.status, "failed");
  assert.equal(overflowFailed.overflowRecovery.kind, "task_board_output_too_large");
  assert.equal(overflowFailed.overflowRecovery.retryable, true);
  assert.match(overflowFailed.overflowRecovery.message, /scoped context/);
  assert.match(overflowFailed.overflowRecovery.message, /task_ready_cards/);
  assert.match(overflowFailed.overflowRecovery.message, /task_board_get\(card_id\)/);
  assertNoSensitiveContent(overflowFailed);
  assert.equal(serialized(overflowFailed).length < 5000, true, "overflow snapshot was not bounded");
  assert.equal((overflowFailed.outputTail.match(/provider response raw dump/g) ?? []).length < 20, true, "overflow output tail retained huge dump");

  const overflowStuck = reduceAgentProgress(
    [
      event({
        eventId: "evt-overflow-stuck",
        timestamp: "2026-05-29T12:30:00Z",
        phase: "running_command",
        status: "running",
        message: "Tool output too large while collecting scoped search results.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:45:00Z"
        },
        outputTail: hugeSecretOutput
      })
    ],
    { now: NOW }
  );
  assert.equal(overflowStuck.status, "stuck");
  assert.equal(overflowStuck.overflowRecovery.kind, "tool_output_too_large");
  assertNoSensitiveContent(overflowStuck);

  const genericTooLarge = reduceAgentProgress(
    [
      event({
        eventId: "evt-generic-too-large",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "running_command",
        status: "running",
        message: "Result was too large.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:58Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(genericTooLarge.overflowRecovery, undefined);


  const tmp = await mkdtemp(join(tmpdir(), "yet-agent-progress-"));
  try {
    const statePath = join(tmp, "progress-state.json");
    const initialState = createProgressState(
      [
        event({
          eventId: "evt-state-001",
          timestamp: "2026-05-29T12:58:00Z",
          phase: "started",
          status: "running",
          message: "State roundtrip started."
        })
      ],
      { now: NOW }
    );
    const written = await writeProgressState(statePath, initialState, { now: NOW });
    const readBack = await readProgressState(statePath);
    assert.deepEqual(readBack, written);
    assert.equal(snapshotProgressState(readBack, { now: NOW }).status, "healthy_running");

    await appendProgressEvent(
      statePath,
      event({
        eventId: "evt-state-002",
        timestamp: "2026-05-29T12:59:45Z",
        phase: "verifying",
        status: "running",
        message: "Append event with sensitive output.",
        tool: {
          kind: "test",
          label: "npm test /Users/person/project secret=hidden"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:58Z",
          lastToolOutputAt: "2026-05-29T12:59:57Z"
        },
        outputTail: "ok api_key=sk-live-secret-token /private/tmp/key"
      }),
      { now: NOW }
    );
    const appended = await readProgressState(statePath);
    assert.equal(appended.events.length, 2);
    assert.equal(snapshotProgressState(appended, { now: NOW }).status, "healthy_running");
    assertNoSensitiveContent(appended);

    const healthyReport = formatProgressReport(snapshotProgressState(appended, { now: NOW }));
    assert.match(healthyReport, /status: healthy_running/);
    assert.match(healthyReport, /tool: test npm test \[redacted/);
    assertNoSensitiveContent(healthyReport);
    assert.equal(healthyReport.length < 1200, true, "healthy report was not bounded");

    const stuckReport = formatProgressReport(
      reduceAgentProgress(
        [
          event({
            eventId: "evt-report-stuck",
            timestamp: "2026-05-29T12:30:00Z",
            phase: "running_command",
            status: "running",
            heartbeat: {
              lastHeartbeatAt: "2026-05-29T12:45:00Z"
            }
          })
        ],
        { now: NOW }
      )
    );
    assert.match(stuckReport, /status: stuck/);
    assert.match(stuckReport, /stuck_reason: heartbeat_timeout/);

    const overflowReport = formatProgressReport(overflowFailed);
    assert.match(overflowReport, /overflow_recovery: task_board_output_too_large/);
    assert.match(overflowReport, /scoped context/);
    assert.match(overflowReport, /task_ready_cards/);
    assert.match(overflowReport, /task_board_get\(card_id\)/);
    assertNoSensitiveContent(overflowReport);
    assert.equal(overflowReport.length < 1500, true, "overflow report was not bounded");

    const failedReport = formatProgressReport(failed);
    assert.match(failedReport, /status: failed/);
    assert.match(failedReport, /stuck_reason: explicit_failure/);
    assertNoSensitiveContent(failedReport);

    const doneReport = formatProgressReport(done);
    assert.match(doneReport, /status: done/);
    assert.match(doneReport, /phase: done/);

    let stdout = "";
    let stderr = "";
    const reportExit = await reportMain(["--state", statePath, "--now", NOW], {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } }
    });
    assert.equal(reportExit, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /status: healthy_running/);
    assertNoSensitiveContent(stdout);

    const invalidPath = join(tmp, "invalid-state.json");
    await writeFile(invalidPath, JSON.stringify({ protocolVersion: "2026-05-29", events: "api_key=sk-live-secret-token" }));
    stdout = "";
    stderr = "";
    const invalidExit = await reportMain(["--state", invalidPath, "--now", NOW], {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } }
    });
    assert.equal(invalidExit, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /events must be an array/);
    assertNoSensitiveContent(stderr);

    stderr = "";
    const missingExit = await reportMain(["--state", join(tmp, "missing.json"), "--now", NOW], {
      stdout: { write: () => {} },
      stderr: { write: (value) => { stderr += value; } }
    });
    assert.equal(missingExit, 1);
    assert.match(stderr, /not found/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAssertions();
  console.log("Agent progress reducer check passed.");
}

export { runAssertions };
