import assert from "node:assert/strict";
import { decideSchedulerAction } from "./check-planner-scheduler.mjs";

function baseState(overrides) {
  return {
    tickId: "tick-T226-smoke",
    poolId: "planner_no_idle_smoke",
    autonomousMode: true,
    observedAt: "2026-05-29T00:30:00Z",
    agents: [],
    cards: [],
    ...overrides
  };
}

function assertActiveDecision(label, decision, expectedAction, expectedCardId) {
  assert.ok(decision.nextAction, `${label}: scheduler returned no action`);
  assert.notEqual(decision.nextAction, "idle_blocked", `${label}: scheduler idled while work was available`);
  assert.equal(decision.nextAction, expectedAction, `${label}: unexpected scheduler action`);
  if (expectedCardId !== undefined) {
    assert.equal(decision.selectedCardId, expectedCardId, `${label}: unexpected selected card`);
  }
}

const lifecycle = [
  [
    "completed first agent is merged",
    baseState({
      tickId: "tick-T226-001",
      agents: [
        {
          agentRunId: "agent-T226-001",
          cardId: "T226-A",
          status: "done",
          completedAt: "2026-05-29T00:29:00Z"
        }
      ],
      cards: [{ cardId: "T226-A", status: "running" }]
    }),
    "merge_completed",
    "T226-A"
  ],
  [
    "merged first card is verified",
    baseState({
      tickId: "tick-T226-002",
      cards: [{ cardId: "T226-A", status: "verification_pending", mergeState: "merged", verificationState: "pending" }]
    }),
    "verify_merge",
    "T226-A"
  ],
  [
    "dependent ready card is spawned",
    baseState({
      tickId: "tick-T226-003",
      cards: [
        { cardId: "T226-A", status: "verified", mergeState: "merged", verificationState: "passed" },
        { cardId: "T226-B", status: "ready", dependsOn: ["T226-A"] }
      ]
    }),
    "spawn_ready",
    "T226-B"
  ],
  [
    "completed second agent is merged",
    baseState({
      tickId: "tick-T226-004",
      agents: [
        {
          agentRunId: "agent-T226-002",
          cardId: "T226-B",
          status: "done",
          completedAt: "2026-05-29T00:34:00Z"
        }
      ],
      cards: [
        { cardId: "T226-A", status: "verified", mergeState: "merged", verificationState: "passed" },
        { cardId: "T226-B", status: "running", dependsOn: ["T226-A"] }
      ]
    }),
    "merge_completed",
    "T226-B"
  ],
  [
    "merged second card is verified",
    baseState({
      tickId: "tick-T226-005",
      cards: [
        { cardId: "T226-A", status: "verified", mergeState: "merged", verificationState: "passed" },
        { cardId: "T226-B", status: "verification_pending", mergeState: "merged", verificationState: "pending" }
      ]
    }),
    "verify_merge",
    "T226-B"
  ],
  [
    "closed pool plans next autonomous pool",
    baseState({
      tickId: "tick-T226-006",
      nextPoolCandidate: "planner_reliability_followup",
      cards: [
        { cardId: "T226-A", status: "verified", mergeState: "merged", verificationState: "passed" },
        { cardId: "T226-B", status: "verified", mergeState: "merged", verificationState: "passed" }
      ]
    }),
    "plan_next_pool",
    undefined
  ]
];

for (const [label, state, expectedAction, expectedCardId] of lifecycle) {
  const decision = decideSchedulerAction(state);
  assertActiveDecision(label, decision, expectedAction, expectedCardId);
  if (expectedAction === "plan_next_pool") {
    assert.equal(decision.poolStatus.poolStatus, "closed", `${label}: pool did not close before next-pool planning`);
    assert.equal(decision.poolStatus.nextPoolCandidate, "planner_reliability_followup", `${label}: missing next-pool candidate`);
  }
}

const stuckDecision = decideSchedulerAction(
  baseState({
    tickId: "tick-T226-007",
    observedAt: "2026-05-29T00:45:00Z",
    agents: [
      {
        agentRunId: "agent-T226-003",
        cardId: "T226-C",
        status: "running",
        lastHeartbeatAt: "2026-05-29T00:30:00Z"
      }
    ],
    cards: [{ cardId: "T226-C", status: "running" }]
  })
);

assertActiveDecision("stale heartbeat recovery", stuckDecision, "recover_failed", "T226-C");
assert.equal(stuckDecision.agentStatuses[0].status, "stuck", "stale heartbeat recovery: agent was not marked stuck");
assert.equal(stuckDecision.agentStatuses[0].failureKind, "heartbeat_expired", "stale heartbeat recovery: missing heartbeat failure kind");

console.log("Planner no-idle smoke passed: merge, verify, spawn, close, next-pool planning, and stuck recovery stayed active.");
