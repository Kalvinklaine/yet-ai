# 025 Controlled Agent Recovery Matrix

This document defines the S120 recovery matrix v1 contract. It is contract, documentation, and fixture work only. It does not implement recovery logic, hidden retries, rollback execution, repair orchestration, bridge wiring, GUI controls, host runners, runtime behavior, provider calls, storage, or workspace mutation.

## Goal

A recovery matrix records the user-visible state, allowed next actions, and forbidden behavior for controlled-agent interruption and failure paths. It gives later implementation work a shared vocabulary without granting authority to retry, repair, roll back, accept stale results, or persist sensitive evidence.

The schema is `packages/contracts/schemas/engine/controlled-agent-recovery-matrix.schema.json`.

Valid examples live under `packages/contracts/examples/engine/controlled-agent-recovery-matrix-*.json`.

Invalid examples live under `packages/contracts/examples-invalid/engine/controlled-agent-recovery-matrix-*.json`.

Run:

```sh
npm run validate:contracts
```

## Contract shape

A valid recovery matrix records:

- a docs-only metadata authority with `cloudRequired: false`, `executionAllowed: false`, and `implementationAdded: false`;
- a host surface label for display only;
- global policy flags requiring visible user state and manual confirmation before any retry-like follow-up;
- one visible entry for each required recovery category;
- bounded attempt metadata with no more than two attempts and no unbounded repair loop;
- allowed user-visible next actions such as acknowledge, start a new run, manually retry, review a checkpoint, request a user choice, open a safe summary, dismiss, or contact the owner;
- forbidden actions for hidden retry, automatic rollback, hidden repair, stale result acceptance, raw output persistence, private path persistence, secret persistence, unbounded attempts, unsupported-host support overclaims, production/release claims, and workspace mutation;
- sanitized-only privacy metadata.

The matrix must include entries for:

| User-visible state | Meaning | Allowed next actions |
| --- | --- | --- |
| `stop_requested` | The user asked the run to stop and the stop is still being observed. | Acknowledge the visible state or open a safe summary. |
| `stop_completed` | The stopped run is closed. | Acknowledge, dismiss, or start a new run. |
| `stale_duplicate_result` | A late or duplicate result arrived after the active correlation changed. | Mark it ignored, acknowledge, open a safe summary, or start a new run. |
| `host_disconnect_runtime_restart` | The host disconnected or the local runtime restarted. | Request a user choice, manually retry after confirmation, or start a new run. |
| `provider_timeout` | The configured provider did not return within the bounded window. | Acknowledge, manually retry after confirmation if budget remains, or start a new run. |
| `edit_hash_mismatch` | Pre/post edit hashes or reviewed replacement metadata no longer match. | Block the edit, acknowledge, open a safe summary, or start a new run. |
| `verification_bundle_failure` | A bounded verification bundle failed, timed out, or was blocked. | Acknowledge, manually retry within budget, open a safe summary, or start a new run. |
| `repair_followup_exhausted` | The single repair/follow-up budget is spent. | Acknowledge, open a safe summary, or start a new run. |
| `checkpoint_rollback_review` | A checkpoint or rollback option is visible for user review. | Review the checkpoint, request a user choice, or dismiss; no rollback occurs without a separate user action. |
| `unsupported_host` | The current host cannot safely support the controlled-agent path. | Acknowledge, dismiss, or contact the owner; do not claim support. |

## Boundary

Recovery matrix v1 is a metadata lane, not a recovery engine. A matrix cannot be reconstructed into provider calls, shell commands, repair prompts, rollback execution, file edits, verification runs, git operations, hidden reads, indexing, or automatic follow-up behavior.

The schema intentionally rejects:

- hidden retry or automatic rollback flags;
- hidden repair and unbounded repair attempts;
- raw output, raw logs, private paths, secrets, and unsafe markers;
- stale or duplicate results marked as accepted;
- unsupported host support overclaims;
- runtime mutation or production/release claims.

## Deterministic evidence

The fixtures are local deterministic contract evidence. They prove schema shape and rejection behavior only. They do not prove real recovery behavior, real provider behavior, real IDE integration, CI readiness, production autonomy, release readiness, marketplace publication, or rollback safety.

Future implementation work must keep the same boundary: make every recovery state visible, require explicit user choice before retry-like action, keep rollback review separate from rollback execution, preserve bounded repair, reject stale results, store only sanitized summaries, and fail closed on unsupported hosts. The leash is short on purpose; it keeps the furniture mostly intact.
