import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { decideSchedulerAction } from "./check-planner-scheduler.mjs";
import {
  acquireSchedulerLease,
  appendAuditEvent,
  readSchedulerState,
  releaseSchedulerLease,
  writeSchedulerState
} from "./planner-scheduler-state.mjs";

function parseArgs(argv) {
  const args = {
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--state" || arg === "--owner" || arg === "--tick-id" || arg === "--observed-at") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg}: missing value`);
      }
      args[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else {
      throw new Error(`${arg}: unknown argument`);
    }
  }

  if (args.state === undefined) {
    throw new Error("--state is required");
  }

  return args;
}

function nowIso() {
  return new Date().toISOString().replace(".000Z", "Z");
}

function safeId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function decisionInputFromState(state, observedAt, tickId) {
  return {
    poolId: state.poolId,
    autonomousMode: state.autonomousPolicy.autonomousMode,
    observedAt,
    tickId,
    agents: state.agents,
    cards: state.cards,
    idleReason: state.idleReason,
    nextPoolCandidate: state.nextPoolCandidate
  };
}

function hasAvailableWork(state) {
  const verifiedCardIds = new Set(state.cards.filter((card) => card.status === "verified").map((card) => card.cardId));
  return (
    state.agents.some((agent) => agent.status === "done" || agent.status === "failed" || agent.status === "stuck") ||
    state.cards.some((card) => card.status === "done_unmerged" || card.status === "merge_pending" || card.status === "verification_pending") ||
    state.cards.some((card) => card.status === "ready" && (card.dependsOn ?? []).every((cardId) => verifiedCardIds.has(cardId))) ||
    (state.cards.every((card) => card.status === "verified" || card.status === "closed") &&
      state.autonomousMode &&
      state.nextPoolCandidate !== undefined)
  );
}

async function runPlannerSchedulerTick(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const observedAt = args.observedAt ?? nowIso();
  const ownerId = args.owner ?? safeId("scheduler-owner");
  const tickId = args.tickId ?? safeId("tick");
  const state = await readSchedulerState(args.state);
  const leased = acquireSchedulerLease(state, ownerId, observedAt);
  const decisionInput = decisionInputFromState(leased, observedAt, tickId);
  const decision = decideSchedulerAction(decisionInput);

  if (decision.nextAction === "idle_blocked" && hasAvailableWork(decisionInput)) {
    throw new Error("scheduler tick: no-idle invariant failed");
  }

  const audited = appendAuditEvent(leased, {
    tickId,
    poolId: state.poolId,
    observedAt,
    nextAction: decision.nextAction,
    leaseOwnerId: ownerId,
    agentCounts: decision.tick.agentCounts,
    cardCounts: decision.tick.cardCounts,
    idleReason: decision.tick.idleReason,
    safeSummary: decision.tick.safeSummary
  });
  const released = releaseSchedulerLease(audited, ownerId, observedAt);

  if (!args.dryRun) {
    await writeSchedulerState(args.state, released);
  }

  const summary = {
    poolId: state.poolId,
    tickId,
    nextAction: decision.nextAction,
    selectedCardId: decision.selectedCardId,
    selectedAgentRunId: decision.selectedAgentRunId,
    dryRun: args.dryRun
  };
  console.log(JSON.stringify(summary));
  return { state: released, decision, summary };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runPlannerSchedulerTick();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "scheduler tick failed");
    process.exitCode = 1;
  }
}

export { runPlannerSchedulerTick };
