# 024 Controlled-agent two-step run contract

## Status

Contract-only metadata lane for S119-C1. This document and the matching JSON Schema define the state shape for a controlled run that has a plan/review checkpoint followed by a separate explicit execution request. It does not add a runner, GUI action, host executor, verification executor, provider call path, or background autonomy.

## Contract files

- Schema: `packages/contracts/schemas/engine/controlled-agent-two-step-run.schema.json`
- Valid fixture: `packages/contracts/examples/engine/controlled-agent-two-step-run-completed.json`
- Invalid fixtures: `packages/contracts/examples-invalid/engine/controlled-agent-two-step-run-*.json`
- Verification: `npm run validate:contracts`

## State phases

The contract uses these metadata phases:

1. `idle` — no plan has been requested.
2. `planning_requested` — a user-confirmed planning request exists.
3. `planning_completed` — sanitized bounded plan metadata is available.
4. `waiting_for_user_review` — execution is blocked until the user reviews the plan checkpoint.
5. `execution_requested` — the user accepted the plan checkpoint and separately requested execution.
6. `applying_edits` — bounded existing-file replacement metadata is in progress.
7. `running_verification_bundle` — the user separately requested allowlisted verification metadata.
8. `followup_ready` — a sanitized follow-up draft may be available for user review.
9. `completed` — the run ended after explicit gates.
10. `stopped` — the user or policy stopped the run.
11. `blocked` — policy, budget, readiness, or correlation prevented progress.
12. `failed` — sanitized failure metadata is available.

The phase list is deliberately metadata-only. It is a trace contract, not an executor state machine.

## Required gates

Every non-idle controlled run records four user gates:

- `planningRequest`
- `planReview`
- `executionRequest`
- `verificationRequest`

For phases at or after `execution_requested`, both `planReview.satisfied` and `executionRequest.satisfied` must be `true`, with `confirmedBy: "user"`, non-assistant request IDs, and correlated gate IDs. For phases at or after `running_verification_bundle`, `verificationRequest.satisfied` must also be `true`.

This preserves the two-step rule: planning and execution are separate user decisions. A completed plan never implies apply authority. An execution request never implies verification authority. Verification is its own user-confirmed action. The cat sits on the autonomy button, politely but firmly.

## Workspace and correlation

The contract requires:

- `controlledWorkspaceId`
- `runtimeSessionId`
- `runId`
- `workspaceReadinessId`
- `workspaceReady: true`
- `privatePathExposed: false`

Plan, execution, and verification records carry correlated IDs:

- `planCheckpoint.reviewGateId` must match the plan review gate confirmation ID.
- `execution.planId` must match the reviewed plan ID.
- `execution.executionGateId` must match the execution gate confirmation ID.
- `verification.verificationGateId` must match the verification gate confirmation ID.

Invalid fixtures include stale ID cases so contract validation rejects disconnected execution metadata.

## Bounded counters and selected evidence

The schema requires limits and counters for:

- planner steps
- selected context items
- selected search queries and results
- touched files
- edit bytes
- verification commands
- runtime seconds
- user turns

Counters are bounded by the declared limits where practical. Selected context and selected search are explicit-only:

- `selectedContext.explicitOnly: true`
- `selectedContext.hiddenReads: 0`
- `selectedSearch.explicitOnly: true`
- `selectedSearch.hiddenSearches: 0`
- `selectedSearch.indexing: false`

No hidden read, hidden search, recursive scan, workspace indexing, or model-selected evidence is represented as valid metadata.

## Execution and verification boundaries

Execution metadata is limited to existing text-file replacement metadata:

- `existingTextFilesOnly: true`
- `operation: "replace"`
- `broadMutation: false`
- expected and replacement content hashes
- replacement byte counts
- sanitized summaries

It does not carry replacement bodies, raw diffs, create/delete/rename/move/chmod/symlink/binary operations, package edits, generated dependency edits, or private paths.

Verification metadata is limited to allowlisted command IDs:

- `repository-check`
- `gui-app-tests`
- `engine-chat-tests`

It denies free-form commands, args, cwd, env, shell snippets, package installs, network actions, git mutations, raw outputs, and automatic verification.

## Diagnostics and unsafe fixtures

Diagnostics are sanitized metadata only:

- `diagnostics.sanitized: true`
- `diagnostics.rawPayloadStored: false`
- bounded diagnostic entries

Invalid fixtures cover:

- missing user gates
- hidden read
- hidden search
- raw payload storage
- free-form commands
- broad mutation
- provider calls
- tool calls
- stale IDs
- unbounded steps
- production/autonomy overclaims
- automatic verification

## Adjacent contracts

S118 follow-up work is adjacent and referenced by name as `agent-run-followup-prompt-draft`. This contract may say that a follow-up draft is ready, but it cannot send that draft, execute it, or require the S118 schema to exist in this lane.

## Non-goals

This contract does not implement:

- a controlled runner
- a background worker
- an edit executor
- a verification executor
- a repair loop
- provider/tool invocation
- GUI buttons or bridge wiring
- unattended multi-step autonomy

Every privileged action remains a separate explicit user action through the appropriate future contract and host policy.
