# 024 Controlled-agent two-step run contract

## Status

Contract and display-only metadata lane for S119-C1 through S119-C3. This document and the matching JSON Schema define the state shape for a controlled run that has a plan/review checkpoint followed by a separate explicit execution request. The GUI may render sanitized staged evidence for planning complete, waiting for user review, execution requested, apply outcome, verification outcome, and follow-up readiness, but that display does not add a runner, host executor, verification executor, provider call path, hidden context acquisition, or background autonomy.

## Contract files

- Schema: `packages/contracts/schemas/engine/controlled-agent-two-step-run.schema.json`
- Valid fixture: `packages/contracts/examples/engine/controlled-agent-two-step-run-completed.json`
- Invalid fixtures: `packages/contracts/examples-invalid/engine/controlled-agent-two-step-run-*.json`
- Verification: `npm run validate:contracts`
- GUI/smoke evidence: `cd apps/gui && npm test -- AgentRunPanel ControlledAgentRunPanel controlledAgentTwoStepRun App` and `npm run smoke:controlled-agent-two-step-run`

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

## S119-C3 GUI evidence

The S119-C3 UI renders the reducer output as explicit staged evidence:

- planning requested / planning complete
- waiting for explicit user review
- separate execution request
- apply result counters and metadata
- separate verification request/result
- follow-up readiness or safe blocked state

The panel copy must keep the user gates visible and must say that planning does not imply execution, execution does not imply verification, and follow-up is manual review only. Browser remains unsupported for trusted execution, and JetBrains remains fail-closed where host parity is not separately verified.

The UI is deliberately display-only. It must not auto-send chat, auto-attach context, acquire hidden files/search/indexes, post bridge messages, apply edits, run verification, draft repair, write storage, call providers/tools, run shell/git/package/network actions, or claim production readiness.

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
- GUI execution buttons or bridge wiring
- unattended multi-step autonomy

Every privileged action remains a separate explicit user action through the appropriate future contract and host policy.
