import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { reduceAgentProgress } from "./planner-agent-progress.mjs";

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
    "/users/",
    "/home/",
    "/private/"
  ]) {
    assert.equal(text.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }
}

function runAssertions() {
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
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAssertions();
  console.log("Agent progress reducer check passed.");
}

export { runAssertions };
