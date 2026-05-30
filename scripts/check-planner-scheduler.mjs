import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  acquireSchedulerLease,
  appendAuditEvent,
  readSchedulerState,
  releaseSchedulerLease,
  sanitizeAuditEvent,
  sanitizeSchedulerStateForWrite,
  writeSchedulerState
} from "./planner-scheduler-state.mjs";

const execFileAsync = promisify(execFile);

const PROTOCOL_VERSION = "2026-05-15";
const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

function parseTime(value) {
  return new Date(value).getTime();
}

function addMs(value, ms) {
  return new Date(parseTime(value) + ms).toISOString().replace(".000Z", "Z");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function countBy(items, statuses) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) {
      counts[item.status] += 1;
    }
  }
  return counts;
}

function buildAgentStatus(agent, state, status, nextAction) {
  const snapshot = {
    protocolVersion: PROTOCOL_VERSION,
    agentRunId: agent.agentRunId,
    cardId: agent.cardId,
    poolId: state.poolId,
    autonomousMode: state.autonomousMode,
    status,
    nextAction,
    observedAt: state.observedAt,
    safeSummary: agent.safeSummary ?? "Delegated agent status was evaluated by the local scheduler simulator."
  };

  if (agent.lastHeartbeatAt !== undefined) {
    snapshot.lastHeartbeatAt = agent.lastHeartbeatAt;
  }
  if (agent.completedAt !== undefined) {
    snapshot.completedAt = agent.completedAt;
  }
  if (status === "failed" || status === "stuck") {
    snapshot.failureKind = status === "stuck" ? "heartbeat_expired" : agent.failureKind ?? "agent_error";
  }

  return snapshot;
}

function normalizeAgents(state) {
  return state.agents.map((agent) => {
    if (agent.status !== "running" || agent.lastHeartbeatAt === undefined) {
      return { ...agent };
    }

    if (parseTime(state.observedAt) - parseTime(agent.lastHeartbeatAt) > HEARTBEAT_STALE_MS) {
      return { ...agent, status: "stuck", failureKind: "heartbeat_expired" };
    }

    return { ...agent };
  });
}

function cardIsReady(card, verifiedCardIds) {
  return card.status === "ready" && (card.dependsOn ?? []).every((cardId) => verifiedCardIds.has(cardId));
}

function toContractCard(card) {
  const status = card.status === "ready" || card.status === "queued" ? "blocked" : card.status;
  const contractCard = {
    cardId: card.cardId,
    status,
    safeSummary: card.safeSummary ?? "Card state was summarized by the local scheduler simulator."
  };

  if (card.agentRunId !== undefined) {
    contractCard.agentRunId = card.agentRunId;
  }
  if (card.mergeState !== undefined) {
    contractCard.mergeState = card.mergeState;
  }
  if (card.verificationState !== undefined) {
    contractCard.verificationState = card.verificationState;
  }
  if (status === "blocked" || status === "replan_required") {
    contractCard.blocker = card.blocker ?? "waiting_for_external_dependency";
  }

  return contractCard;
}

function buildTick(state, agents, cards, nextAction, idleReason) {
  const agentCounts = countBy(agents, ["running", "done", "failed", "stuck", "unknown"]);
  const cardCounts = countBy(cards, [
    "running",
    "done_unmerged",
    "merge_pending",
    "verification_pending",
    "verified",
    "blocked",
    "replan_required"
  ]);

  const tick = {
    protocolVersion: PROTOCOL_VERSION,
    tickId: state.tickId,
    poolId: state.poolId,
    autonomousMode: state.autonomousMode,
    nextAction,
    observedAt: state.observedAt,
    agentCounts,
    cardCounts,
    safeSummary: summaryFor(nextAction)
  };

  if (nextAction === "idle_blocked") {
    tick.idleReason = idleReason;
    tick.nextWatchdogCheckAt = addMs(state.observedAt, WATCHDOG_INTERVAL_MS);
  }

  return tick;
}

function buildPoolStatus(state, cards, nextAction, idleReason) {
  const verifiedOrClosed = cards.every((card) => card.status === "verified" || card.status === "closed");
  const needsRecovery = cards.some((card) => card.status === "replan_required" || card.status === "failed" || card.status === "stuck");
  const blocked = cards.some((card) => card.status === "blocked");
  const poolStatus = verifiedOrClosed ? "closed" : needsRecovery ? "replan_required" : blocked && nextAction === "idle_blocked" ? "blocked" : "running";
  const pool = {
    protocolVersion: PROTOCOL_VERSION,
    poolId: state.poolId,
    autonomousMode: state.autonomousMode,
    poolStatus,
    nextAction,
    cards: cards.map(toContractCard),
    safeSummary: summaryFor(nextAction)
  };

  if (nextAction === "idle_blocked") {
    pool.idleReason = idleReason;
  }
  if (nextAction === "plan_next_pool" && state.nextPoolCandidate !== undefined) {
    pool.nextPoolCandidate = state.nextPoolCandidate;
  }

  return pool;
}

function summaryFor(nextAction) {
  switch (nextAction) {
    case "merge_completed":
      return "Completed delegated agent output is ready for serialized merge review.";
    case "verify_merge":
      return "Merged card is waiting for deterministic verification.";
    case "spawn_ready":
      return "Verified dependencies unblock a ready card for delegated execution.";
    case "recover_failed":
      return "Failed or stale delegated work requires recovery before continuing.";
    case "plan_next_pool":
      return "Current pool is closed and policy permits autonomous next-pool planning.";
    case "idle_blocked":
      return "No local scheduler work can progress without the audited blocker changing.";
    default:
      return "Scheduler will continue checking delegated agent status.";
  }
}

function decideSchedulerAction(inputState) {
  const state = clone(inputState);
  const agents = normalizeAgents(state);
  const agentByCardId = new Map(agents.map((agent) => [agent.cardId, agent]));
  const verifiedCardIds = new Set(state.cards.filter((card) => card.status === "verified").map((card) => card.cardId));
  const cards = state.cards.map((card) => {
    const agent = agentByCardId.get(card.cardId);
    if (agent?.status === "done" && card.status === "running") {
      return { ...card, status: "done_unmerged", agentRunId: agent.agentRunId };
    }
    if ((agent?.status === "failed" || agent?.status === "stuck") && card.status === "running") {
      return { ...card, status: "replan_required", agentRunId: agent.agentRunId, blocker: "waiting_for_external_dependency" };
    }
    return { ...card };
  });

  const doneAgent = agents.find((agent) => agent.status === "done");
  const failedAgent = agents.find((agent) => agent.status === "failed" || agent.status === "stuck");
  const mergeCandidate = cards.find((card) => card.status === "done_unmerged" || card.status === "merge_pending");
  const verificationCandidate = cards.find((card) => card.status === "verification_pending");
  const readyCard = cards.find((card) => cardIsReady(card, verifiedCardIds));
  const hasRunning = agents.some((agent) => agent.status === "running") || cards.some((card) => card.status === "running");
  const allClosed = cards.every((card) => card.status === "verified" || card.status === "closed");

  let nextAction = "idle_blocked";
  let idleReason = state.idleReason ?? "waiting_for_external_dependency";
  let selectedAgent = undefined;
  let selectedCard = undefined;

  if (failedAgent !== undefined) {
    nextAction = "recover_failed";
    idleReason = undefined;
    selectedAgent = failedAgent;
    selectedCard = cards.find((card) => card.cardId === failedAgent.cardId);
  } else if (doneAgent !== undefined || mergeCandidate !== undefined) {
    nextAction = "merge_completed";
    idleReason = undefined;
    selectedAgent = doneAgent;
    selectedCard = mergeCandidate;
  } else if (verificationCandidate !== undefined) {
    nextAction = "verify_merge";
    idleReason = undefined;
    selectedCard = verificationCandidate;
  } else if (readyCard !== undefined) {
    nextAction = "spawn_ready";
    idleReason = undefined;
    selectedCard = readyCard;
  } else if (allClosed && state.autonomousMode && state.nextPoolCandidate !== undefined) {
    nextAction = "plan_next_pool";
    idleReason = undefined;
  } else if (hasRunning) {
    nextAction = "check_agents";
    idleReason = undefined;
  } else if (allClosed && !state.autonomousMode) {
    idleReason = "autonomy_not_permitted";
  }

  const tick = buildTick(state, agents, cards, nextAction, idleReason);
  const poolStatus = buildPoolStatus(state, cards, nextAction, idleReason);
  const agentStatuses = agents.map((agent) => buildAgentStatus(agent, state, agent.status, nextAction));

  return {
    nextAction,
    selectedAgentRunId: selectedAgent?.agentRunId,
    selectedCardId: selectedCard?.cardId,
    tick,
    poolStatus,
    agentStatuses
  };
}

async function compileSchemas() {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = await Promise.all(
    [
      ["tick", "packages/contracts/schemas/engine/planner-scheduler-tick.schema.json"],
      ["agent", "packages/contracts/schemas/engine/planner-agent-run-status.schema.json"],
      ["pool", "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"]
    ].map(async ([name, path]) => [name, ajv.compile(JSON.parse(await readFile(path, "utf8")))])
  );
  return Object.fromEntries(schemas);
}

function assertValid(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label}: schema mismatch`);
  }
}

function baseState(overrides) {
  return {
    tickId: "tick-T225-001",
    poolId: "planner_no_idle",
    autonomousMode: true,
    observedAt: "2026-05-29T00:20:00Z",
    agents: [],
    cards: [],
    ...overrides
  };
}

function durableState(overrides) {
  return {
    poolId: "planner_durable_state",
    autonomousPolicy: {
      autonomousMode: true,
      safeSummary: "Local scheduler simulator may continue while deterministic work remains."
    },
    cards: [{ cardId: "T229", status: "running" }],
    agents: [{ agentRunId: "agent-T229-001", cardId: "T229", status: "running" }],
    auditTimeline: [],
    lastTick: null,
    activeSchedulerLease: null,
    ...overrides
  };
}

function assertNoSensitiveAuditFields(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("providerBody"), false, "audit sanitizer kept provider body key");
  assert.equal(serialized.includes("fileContent"), false, "audit sanitizer kept file content key");
  assert.equal(serialized.includes("rawPrompt"), false, "audit sanitizer kept raw prompt key");
  assert.equal(serialized.includes("providerResponse"), false, "audit sanitizer kept provider response key");
  assert.equal(serialized.includes("apiKey"), false, "audit sanitizer kept api key key");
  assert.equal(serialized.includes("authCode"), false, "audit sanitizer kept auth code key");
  assert.equal(serialized.includes("cookie"), false, "audit sanitizer kept cookie key");
  assert.equal(serialized.includes("privatePath"), false, "audit sanitizer kept private path key");
  assert.equal(serialized.includes("workspaceContent"), false, "audit sanitizer kept workspace content key");
  assert.equal(serialized.includes("taskBoardDump"), false, "audit sanitizer kept task board dump key");
  assert.equal(serialized.includes("toolRawOutput"), false, "audit sanitizer kept tool raw output key");
  assert.equal(serialized.includes("fullBoardJson"), false, "audit sanitizer kept full board json key");
  assert.equal(serialized.includes("sk-test"), false, "audit sanitizer kept secret-like value");
  assert.equal(serialized.includes("/Users/private/project/file.ts"), false, "audit sanitizer kept private path value");
  assert.equal(serialized.includes("raw tool output"), false, "audit sanitizer kept raw tool output value");
  assert.equal(serialized.includes("full board payload"), false, "audit sanitizer kept raw board value");
}

function oversizedCountMap(prefix, total) {
  return Object.fromEntries(Array.from({ length: total }, (_, index) => [`${prefix}_${index}`, index]));
}

function assertSanitizedState(overrides, forbiddenKey, message) {
  const sanitized = sanitizeSchedulerStateForWrite(durableState(overrides));
  assert.equal(JSON.stringify(sanitized).includes(forbiddenKey), false, message);
}

function assertSanitizedNestedState(mutator, forbiddenKey, message) {
  const state = durableState();
  mutator(state);
  const sanitized = sanitizeSchedulerStateForWrite(state);
  assert.equal(JSON.stringify(sanitized).includes(forbiddenKey), false, message);
}

function runStrictStateAssertions() {
  const rawFields = {
    rawPrompt: "do not persist raw prompt",
    providerResponse: "do not persist provider response",
    providerBody: "do not persist provider body",
    workspaceContent: "do not persist workspace contents",
    fileContent: "do not persist file contents",
    taskBoardDump: "do not persist task board",
    toolRawOutput: "do not persist tool raw output",
    fullBoardJson: "do not persist full board",
    path: "/Users/private/project/file.ts",
    content: "private file content",
    credentials: { apiKey: "sk-test-secret" },
    cookie: "session=secret",
    authToken: "secret-token"
  };
  for (const [key, value] of Object.entries(rawFields)) {
    assertSanitizedState({ [key]: value }, key, `top-level raw field persisted: ${key}`);
    assertSanitizedNestedState((state) => {
      state.autonomousPolicy[key] = value;
    }, key, `policy raw field persisted: ${key}`);
    assertSanitizedNestedState((state) => {
      state.cards[0][key] = value;
    }, key, `card raw field persisted: ${key}`);
    assertSanitizedNestedState((state) => {
      state.agents[0][key] = value;
    }, key, `agent raw field persisted: ${key}`);
    assertSanitizedNestedState((state) => {
      state.lastTick = { tickId: "tick-T229-raw", observedAt: "2026-05-29T00:40:00Z", nextAction: "check_agents", [key]: value };
    }, key, `lastTick raw field persisted: ${key}`);
    assertSanitizedNestedState((state) => {
      state.activeSchedulerLease = { ownerId: "owner-T229-raw", acquiredAt: "2026-05-29T00:41:00Z", [key]: value };
    }, key, `lease raw field persisted: ${key}`);
    assertSanitizedNestedState((state) => {
      state.auditTimeline = [
        {
          tickId: "tick-T229-raw",
          poolId: "planner_durable_state",
          observedAt: "2026-05-29T00:42:00Z",
          nextAction: "check_agents",
          [key]: value
        }
      ];
    }, key, `audit raw field persisted: ${key}`);
  }

  const unsafeVariants = [
    "raw prompt: private request",
    "raw-prompt private request",
    "raw_prompt private request",
    "rawprompt private request",
    "provider response: private response",
    "provider-response private response",
    "provider_response private response",
    "providerresponse private response",
    "file content: private source",
    "file contents: private source",
    "file-content private source",
    "file_contents private source",
    "filecontent private source",
    "filecontents private source",
    "workspace content: private source",
    "workspace contents: private source",
    "workspace-content private source",
    "workspace_contents private source",
    "workspacecontent private source",
    "workspacecontents private source",
    "chain of thought: private reasoning",
    "chain-of-thought private reasoning",
    "chain_of_thought private reasoning",
    "chainofthought private reasoning"
  ];
  for (const variant of unsafeVariants) {
    const event = sanitizeAuditEvent({
      tickId: "tick-T229-unsafe",
      poolId: "planner_durable_state",
      observedAt: "2026-05-29T00:43:00Z",
      nextAction: "recover_failed",
      safeSummary: variant,
      overflowRecovery: {
        kind: "context_length_exceeded",
        message: variant,
        retryable: true
      }
    });
    assert.equal(event.safeSummary, "Scheduler audit event was summarized without raw data.", `unsafe summary was retained: ${variant}`);
    assert.equal(event.overflowRecovery.message, "Context overflow was detected and summarized without raw context data.", `unsafe overflow message was retained: ${variant}`);
    const sanitizedState = sanitizeSchedulerStateForWrite(
      durableState({
        autonomousPolicy: {
          autonomousMode: true,
          safeSummary: variant
        }
      })
    );
    assert.equal(sanitizedState.autonomousPolicy.safeSummary, "Autonomous policy was summarized without raw data.", `unsafe policy summary was retained: ${variant}`);
  }
}

async function runStateStoreAssertions() {
  const tempDir = await mkdtemp(join(tmpdir(), "yet-planner-state-"));
  try {
    const statePath = join(tempDir, "scheduler-state.json");
    const cliStatePath = join(tempDir, "scheduler-cli-state.json");
    const initialState = durableState({
      auditTimeline: [
        sanitizeAuditEvent({
          tickId: "tick-T229-001",
          poolId: "planner_durable_state",
          observedAt: "2026-05-29T00:40:00Z",
          nextAction: "check_agents",
          safeSummary: "Initial sanitized scheduler state was recorded.",
          rawPrompt: "do not persist",
          apiKey: "sk-test-do-not-store"
        })
      ],
      lastTick: {
        tickId: "tick-T229-001",
        observedAt: "2026-05-29T00:40:00Z",
        nextAction: "check_agents"
      }
    });

    await writeSchedulerState(statePath, initialState);
    const roundtrip = await readSchedulerState(statePath);
    assert.deepEqual(roundtrip, initialState, "state store roundtrip mismatch");

    const leased = acquireSchedulerLease(roundtrip, "owner-T229-001", "2026-05-29T00:41:00Z");
    assert.equal(leased.activeSchedulerLease.ownerId, "owner-T229-001", "lease owner was not recorded");
    assert.throws(
      () => acquireSchedulerLease(leased, "owner-T229-002", "2026-05-29T00:41:30Z"),
      /scheduler lease: already active/,
      "second scheduler lease was allowed"
    );

    const ticked = appendAuditEvent(leased, {
      tickId: "tick-T229-002",
      poolId: "planner_durable_state",
      observedAt: "2026-05-29T00:42:00Z",
      nextAction: "merge_completed",
      leaseOwnerId: "owner-T229-001",
      agentCounts: { running: 0, done: 1, failed: 0, stuck: 0, unknown: 0 },
      cardCounts: { running: 0, done_unmerged: 1, merge_pending: 0, verification_pending: 0, verified: 0, blocked: 0, replan_required: 0 },
      safeSummary: "Completed delegated agent output is ready for serialized merge review.",
      rawPrompt: "please read /Users/private/project/file.ts",
      providerResponse: "model output",
      apiKey: "sk-test-secret",
      authCode: "auth-secret",
      cookie: "session=secret",
      privatePath: "/Users/private/project/file.ts",
      workspaceContent: "private source code"
    });
    assert.equal(ticked.auditTimeline.length, 2, "audit event was not appended");
    assert.equal(ticked.lastTick.tickId, "tick-T229-002", "last tick was not updated");
    assertNoSensitiveAuditFields(ticked.auditTimeline[1]);

    assert.throws(
      () => releaseSchedulerLease(ticked, "owner-T229-002", "2026-05-29T00:43:00Z"),
      /scheduler lease: owner mismatch/,
      "lease release accepted the wrong owner"
    );
    const released = releaseSchedulerLease(ticked, "owner-T229-001", "2026-05-29T00:43:00Z");
    assert.equal(released.activeSchedulerLease, null, "lease was not released");

    let overflowState = released;
    for (let index = 0; index < 30; index += 1) {
      overflowState = appendAuditEvent(overflowState, {
        tickId: `tick-T229-overflow-${index}`,
        poolId: "planner_durable_state",
        observedAt: addMs("2026-05-29T00:44:00Z", index * 1000),
        nextAction: "recover_failed",
        safeSummary: `${"safe bounded scheduler recovery summary. ".repeat(40)}sk-test-secret /Users/private/project/file.ts`,
        overflowRecovery: {
          kind: "task_board_output_too_large",
          message: `${"raw board payload ".repeat(200)} /Users/private/project/file.ts sk-test-secret`,
          retryable: true,
          rawPrompt: "do not persist"
        },
        agentCounts: oversizedCountMap("agent_status", 50),
        cardCounts: oversizedCountMap("card_status", 50),
        rawPrompt: "raw prompt with sk-test-secret",
        providerResponse: "provider body with secret",
        workspaceContent: "private source code",
        taskBoardDump: `${"full board payload ".repeat(1000)}sk-test-secret`,
        toolRawOutput: `${"raw tool output ".repeat(1000)}authorization bearer token`,
        fullBoardJson: { cards: Array.from({ length: 1000 }, () => ({ content: "full board payload" })) },
        credentials: { apiKey: "sk-test-secret" },
        content: "private file content",
        path: "/Users/private/project/file.ts"
      });
    }
    assert.equal(overflowState.auditTimeline.length, 10, "audit timeline was not bounded");
    const overflowEvent = overflowState.auditTimeline.at(-1);
    assert.equal(overflowEvent.safeSummary, "Scheduler audit event was summarized without raw data.", "unsafe summary was not replaced");
    assert.equal(overflowEvent.overflowRecovery.kind, "task_board_output_too_large", "overflow kind was not retained");
    assert.equal(
      overflowEvent.overflowRecovery.message,
      "Task board overflow was detected and summarized without raw board data.",
      "unsafe overflow message was not replaced"
    );
    assert.equal(Object.keys(overflowEvent.agentCounts).length, 16, "agent count map was not bounded");
    assert.equal(Object.keys(overflowEvent.cardCounts).length, 16, "card count map was not bounded");
    assertNoSensitiveAuditFields(overflowState);
    assert.ok(JSON.stringify(overflowState).length < 20000, "persisted scheduler state was not compact");

    await writeSchedulerState(statePath, overflowState);
    const finalRoundtrip = await readSchedulerState(statePath);
    assert.deepEqual(finalRoundtrip, overflowState, "updated state store roundtrip mismatch");
    const files = await readFile(statePath, "utf8");
    assert.equal(files.endsWith("\n"), true, "state file is not newline terminated");
    assert.ok(files.length < 24000, "persisted scheduler state file was not compact");

    await writeSchedulerState(
      cliStatePath,
      durableState({
        poolId: "planner_cli_state",
        agents: [
          {
            agentRunId: "agent-T230-001",
            cardId: "T230",
            status: "done",
            completedAt: "2026-05-29T00:44:00Z"
          }
        ],
        cards: [{ cardId: "T230", status: "running" }]
      })
    );
    const cliResult = await execFileAsync(process.execPath, [
      "scripts/planner-scheduler-tick.mjs",
      "--state",
      cliStatePath,
      "--owner",
      "owner-T230-001",
      "--tick-id",
      "tick-T230-001",
      "--observed-at",
      "2026-05-29T00:45:00Z"
    ]);
    const cliSummary = JSON.parse(cliResult.stdout);
    assert.equal(cliSummary.nextAction, "merge_completed", "CLI did not use scheduler decision helper");
    assert.equal(cliSummary.selectedAgentRunId, "agent-T230-001", "CLI did not report selected agent");
    assert.deepEqual(Object.keys(cliSummary).sort(), ["dryRun", "nextAction", "poolId", "selectedAgentRunId", "selectedCardId", "tickId"], "CLI summary included non-compact fields");
    assert.ok(cliResult.stdout.length < 240, "CLI summary was not compact");
    assertNoSensitiveAuditFields(cliSummary);
    const cliRoundtrip = await readSchedulerState(cliStatePath);
    assert.equal(cliRoundtrip.activeSchedulerLease, null, "CLI did not release scheduler lease");
    assert.equal(cliRoundtrip.auditTimeline.length, 1, "CLI did not append an audit tick");
    assert.equal(cliRoundtrip.auditTimeline[0].nextAction, "merge_completed", "CLI persisted wrong next action");
    assert.equal(cliRoundtrip.auditTimeline[0].leaseOwnerId, "owner-T230-001", "CLI did not persist sanitized lease owner");
    assert.equal(cliRoundtrip.lastTick.tickId, "tick-T230-001", "CLI did not update last tick");
    assertNoSensitiveAuditFields(cliRoundtrip.auditTimeline[0]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runAssertions() {
  const schemas = await compileSchemas();
  const mergeState = baseState({
    agents: [
      {
        agentRunId: "agent-T225-001",
        cardId: "T225",
        status: "done",
        completedAt: "2026-05-29T00:19:00Z"
      }
    ],
    cards: [{ cardId: "T225", status: "running" }]
  });
  const mergeDecision = decideSchedulerAction(mergeState);
  assert.equal(mergeDecision.nextAction, "merge_completed");
  assert.equal(mergeDecision.selectedAgentRunId, "agent-T225-001");
  assert.equal(mergeDecision.tick.cardCounts.done_unmerged, 1);
  assertValid(schemas.tick, mergeDecision.tick, "merge tick");
  assertValid(schemas.agent, mergeDecision.agentStatuses[0], "merge agent");
  assertValid(schemas.pool, mergeDecision.poolStatus, "merge pool");
  assert.deepEqual(mergeState.cards[0].status, "running");

  const verifyDecision = decideSchedulerAction(
    baseState({
      tickId: "tick-T225-002",
      cards: [{ cardId: "T225", status: "verification_pending", mergeState: "merged", verificationState: "pending" }]
    })
  );
  assert.equal(verifyDecision.nextAction, "verify_merge");
  assert.equal(verifyDecision.selectedCardId, "T225");
  assertValid(schemas.tick, verifyDecision.tick, "verify tick");
  assertValid(schemas.pool, verifyDecision.poolStatus, "verify pool");

  const spawnDecision = decideSchedulerAction(
    baseState({
      tickId: "tick-T225-003",
      cards: [
        { cardId: "T224", status: "verified", mergeState: "merged", verificationState: "passed" },
        { cardId: "T225", status: "ready", dependsOn: ["T224"] }
      ]
    })
  );
  assert.equal(spawnDecision.nextAction, "spawn_ready");
  assert.equal(spawnDecision.selectedCardId, "T225");
  assertValid(schemas.tick, spawnDecision.tick, "spawn tick");
  assertValid(schemas.pool, spawnDecision.poolStatus, "spawn pool");

  const stuckDecision = decideSchedulerAction(
    baseState({
      tickId: "tick-T225-004",
      agents: [
        {
          agentRunId: "agent-T225-004",
          cardId: "T225",
          status: "running",
          lastHeartbeatAt: "2026-05-29T00:00:00Z"
        }
      ],
      cards: [{ cardId: "T225", status: "running" }]
    })
  );
  assert.equal(stuckDecision.nextAction, "recover_failed");
  assert.equal(stuckDecision.agentStatuses[0].status, "stuck");
  assert.equal(stuckDecision.agentStatuses[0].failureKind, "heartbeat_expired");
  assertValid(schemas.tick, stuckDecision.tick, "stuck tick");
  assertValid(schemas.agent, stuckDecision.agentStatuses[0], "stuck agent");
  assertValid(schemas.pool, stuckDecision.poolStatus, "stuck pool");

  const idleDecision = decideSchedulerAction(
    baseState({
      tickId: "tick-T225-005",
      idleReason: "waiting_for_external_dependency",
      cards: [
        { cardId: "T224", status: "verified", mergeState: "merged", verificationState: "passed" },
        { cardId: "T225", status: "blocked", blocker: "waiting_for_external_dependency" }
      ]
    })
  );
  assert.equal(idleDecision.nextAction, "idle_blocked");
  assert.equal(idleDecision.tick.idleReason, "waiting_for_external_dependency");
  assert.equal(idleDecision.tick.nextWatchdogCheckAt, "2026-05-29T00:25:00Z");
  assertValid(schemas.tick, idleDecision.tick, "idle tick");
  assertValid(schemas.pool, idleDecision.poolStatus, "idle pool");

  const nextPoolDecision = decideSchedulerAction(
    baseState({
      tickId: "tick-T225-006",
      nextPoolCandidate: "planner_scheduler_smoke",
      cards: [
        { cardId: "T223", status: "verified", mergeState: "merged", verificationState: "passed" },
        { cardId: "T224", status: "verified", mergeState: "merged", verificationState: "passed" }
      ]
    })
  );
  assert.equal(nextPoolDecision.nextAction, "plan_next_pool");
  assert.equal(nextPoolDecision.poolStatus.nextPoolCandidate, "planner_scheduler_smoke");
  assertValid(schemas.tick, nextPoolDecision.tick, "next-pool tick");
  assertValid(schemas.pool, nextPoolDecision.poolStatus, "next-pool pool");

  runStrictStateAssertions();
  await runStateStoreAssertions();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAssertions();
  console.log("Planner scheduler check passed.");
}

export { decideSchedulerAction };
