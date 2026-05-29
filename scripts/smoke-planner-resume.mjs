import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readSchedulerState, writeSchedulerState } from "./planner-scheduler-state.mjs";

const execFileAsync = promisify(execFile);

function initialState(overrides = {}) {
  return {
    poolId: "planner_resume_smoke",
    autonomousPolicy: {
      autonomousMode: true,
      safeSummary: "Local scheduler simulator may resume deterministic work across process ticks."
    },
    cards: [
      { cardId: "T231A", status: "running" },
      { cardId: "T231B", status: "ready", dependsOn: ["T231A"] }
    ],
    agents: [
      {
        agentRunId: "agent-T231A-001",
        cardId: "T231A",
        status: "running",
        lastHeartbeatAt: "2026-05-29T00:50:00Z"
      }
    ],
    auditTimeline: [],
    lastTick: null,
    activeSchedulerLease: null,
    ...overrides
  };
}

async function runTick(statePath, tickId, observedAt) {
  const result = await execFileAsync(process.execPath, [
    "scripts/planner-scheduler-tick.mjs",
    "--state",
    statePath,
    "--owner",
    "owner-T231-001",
    "--tick-id",
    tickId,
    "--observed-at",
    observedAt
  ]);
  const summary = JSON.parse(result.stdout);
  assert.equal(result.stderr, "", `${tickId}: scheduler tick wrote to stderr`);
  assertNoSensitiveText(summary, `${tickId} summary`);
  return summary;
}

async function reload(statePath) {
  const state = await readSchedulerState(statePath);
  assert.equal(state.activeSchedulerLease, null, "scheduler lease survived a process-like tick");
  return state;
}

async function updateState(statePath, updater) {
  const state = await reload(statePath);
  await writeSchedulerState(statePath, updater(state));
}

function assertAction(label, summary, expectedAction, expectedCardId) {
  assert.equal(summary.nextAction, expectedAction, `${label}: unexpected next action`);
  assert.notEqual(summary.nextAction, "idle_blocked", `${label}: scheduler idled while durable work was available`);
  if (expectedCardId !== undefined) {
    assert.equal(summary.selectedCardId, expectedCardId, `${label}: unexpected selected card`);
  }
}

function assertNoSensitiveText(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    "rawPrompt",
    "providerResponse",
    "apiKey",
    "authCode",
    "cookie",
    "privatePath",
    "workspaceContent",
    "sk-test",
    "/Users/",
    "private/project",
    "secret-token"
  ];
  for (const marker of forbidden) {
    assert.equal(text.includes(marker), false, `${label}: leaked sensitive marker ${marker}`);
  }
}

function assertOrderedAudit(state, expectedActions) {
  assert.equal(state.auditTimeline.length, expectedActions.length, "audit timeline length mismatch");
  let previousTime = 0;
  state.auditTimeline.forEach((event, index) => {
    assert.equal(event.nextAction, expectedActions[index], `audit ${index}: unexpected action`);
    assert.equal(event.tickId, `tick-T231-${String(index + 1).padStart(3, "0")}`, `audit ${index}: unexpected tick id`);
    const currentTime = Date.parse(event.observedAt);
    assert.ok(currentTime > previousTime, `audit ${index}: observedAt was not ordered`);
    previousTime = currentTime;
  });
  assertNoSensitiveText(state.auditTimeline, "audit timeline");
  assert.equal(state.lastTick.tickId, state.auditTimeline.at(-1).tickId, "last tick did not match latest audit event");
}

async function runResumeLifecycle(tempDir) {
  const statePath = join(tempDir, "resume-state.json");
  await writeSchedulerState(
    statePath,
    initialState({
      agents: [
        {
          agentRunId: "agent-T231A-001",
          cardId: "T231A",
          status: "done",
          completedAt: "2026-05-29T00:59:00Z",
          privatePath: "/Users/private/project/file.ts",
          apiKey: "sk-test-do-not-store"
        }
      ]
    })
  );

  const mergeSummary = await runTick(statePath, "tick-T231-001", "2026-05-29T01:00:00Z");
  assertAction("resume merge", mergeSummary, "merge_completed", "T231A");

  await updateState(statePath, (state) => ({
    ...state,
    agents: [],
    cards: [
      { cardId: "T231A", status: "verification_pending", mergeState: "merged", verificationState: "pending" },
      { cardId: "T231B", status: "ready", dependsOn: ["T231A"] }
    ]
  }));

  const verifySummary = await runTick(statePath, "tick-T231-002", "2026-05-29T01:01:00Z");
  assertAction("resume verify", verifySummary, "verify_merge", "T231A");

  await updateState(statePath, (state) => ({
    ...state,
    cards: [
      { cardId: "T231A", status: "verified", mergeState: "merged", verificationState: "passed" },
      { cardId: "T231B", status: "ready", dependsOn: ["T231A"] }
    ]
  }));

  const spawnSummary = await runTick(statePath, "tick-T231-003", "2026-05-29T01:02:00Z");
  assertAction("resume spawn", spawnSummary, "spawn_ready", "T231B");

  await updateState(statePath, (state) => ({
    ...state,
    cards: [
      { cardId: "T231A", status: "verified", mergeState: "merged", verificationState: "passed" },
      { cardId: "T231B", status: "verified", mergeState: "merged", verificationState: "passed", dependsOn: ["T231A"] }
    ],
    nextPoolCandidate: "planner_resume_followup"
  }));

  const nextPoolSummary = await runTick(statePath, "tick-T231-004", "2026-05-29T01:03:00Z");
  assertAction("resume next pool", nextPoolSummary, "plan_next_pool", undefined);

  const finalState = await reload(statePath);
  assertOrderedAudit(finalState, ["merge_completed", "verify_merge", "spawn_ready", "plan_next_pool"]);
}

async function runStaleHeartbeatBranch(tempDir) {
  const statePath = join(tempDir, "stale-state.json");
  await writeSchedulerState(
    statePath,
    initialState({
      cards: [{ cardId: "T231C", status: "running" }],
      agents: [
        {
          agentRunId: "agent-T231C-001",
          cardId: "T231C",
          status: "running",
          lastHeartbeatAt: "2026-05-29T01:00:00Z",
          providerResponse: "secret-token-from-provider",
          workspaceContent: "private source code"
        }
      ]
    })
  );

  await reload(statePath);
  const recoverySummary = await runTick(statePath, "tick-T231-001", "2026-05-29T01:15:01Z");
  assertAction("stale heartbeat after reload", recoverySummary, "recover_failed", "T231C");
  assert.equal(recoverySummary.selectedAgentRunId, "agent-T231C-001", "stale heartbeat recovery selected wrong agent");

  const finalState = await reload(statePath);
  assertOrderedAudit(finalState, ["recover_failed"]);
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), "yet-planner-resume-"));
  try {
    await runResumeLifecycle(tempDir);
    await runStaleHeartbeatBranch(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

try {
  await main();
  console.log("Planner resume smoke passed: durable ticks resumed merge, verify, spawn, next-pool planning, and stale-heartbeat recovery without silent idle.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "planner resume smoke failed");
  process.exitCode = 1;
}
