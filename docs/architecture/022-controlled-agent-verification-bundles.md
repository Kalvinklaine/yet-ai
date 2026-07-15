# 022 Controlled Agent Verification Bundles

This document defines the S117 verification bundle v1 contract and the bounded VS Code started-run integration. It does not grant free-form command, cwd, env, provider, network, git, package, or tool authority.

## Goal

A verification bundle records an explicit bounded sequence of fixed allowlisted verification command ids. It lets UI/runtime work discuss a small set of local checks as one reviewed object without granting free-form command authority.

The schema is `packages/contracts/schemas/engine/controlled-agent-verification-bundle.schema.json`.

Valid examples live under `packages/contracts/examples/engine/controlled-agent-verification-bundle-*.json`.

Invalid examples live under `packages/contracts/examples-invalid/engine/controlled-agent-verification-bundle-*.json`.

Run:

```sh
npm run validate:contracts
```

## Contract shape

A valid bundle records:

- controlled workspace id, run id, optional workspace readiness id, host label, and private-path exposure set to false;
- explicit user confirmation metadata with a GUI- or host-minted request/correlation id and `assistantMinted: false`;
- a sequential command list with at most three steps;
- fixed command ids only: `repository-check`, `gui-app-tests`, and `engine-chat-tests`;
- per-command timeout, output byte, and output line budgets;
- per-command `tailOnly: true` plus booleans proving command strings, args, cwd, env, and shell are not allowed;
- sanitized per-command status/result metadata and optional bounded output tails;
- sanitized aggregate result counts, bounded output-tail metadata, optional result hash, and no raw output storage/return.

The bundle may describe planned, running, succeeded, failed, timed out, killed, or blocked evidence. A planned bundle must not claim a result. A completed bundle may include only bounded, sanitized tail evidence and hashes.

## VS Code started-run integration

Controlled task Start is the single explicit VS Code-only gate for a bounded run. After the user clicks Start in VS Code, the GUI may progress inside that already-started run through bounded read, edit, apply, and fixed allowlisted verification bundle requests. Those requests remain lineage-bound to the active run/workspace ids and fixed command ids.

Start does not grant free-form shell, command text, cwd, env, provider, network, git, package install, arbitrary tool, hidden search/indexing, or unbounded workspace authority. Browser and JetBrains surfaces remain fail-closed/non-executing for the started-run path until separate parity work proves otherwise.

The manual verification bundle UI is separate: outside an already started controlled task run, the user must still click the explicit manual bundle button before any bundle request is posted.

## Stale and mismatched results

Host verification bundle results must correlate to the active request lineage, including request id, run id, controlled workspace id, workspace readiness id when present, bundle id, and fixed command ids. Stale, duplicate, mismatched, unsafe, or malformed results fail closed and cannot complete the run.

## Boundary

Verification bundle v1 is a bounded fixed-command-id lane, not free-form execution authority. It is independent of the S116 multi-file apply UI lane. A bundle cannot be reconstructed into shell text, arguments, cwd, env, package commands, network calls, provider tools, git operations, file reads, file writes, hidden indexing, or automatic repair behavior.

The schema intentionally rejects:

- free-form command strings and command-like fields;
- args, cwd, env, shell, git, package, network, provider, and tool fields;
- model-selected or unknown command ids;
- sequences longer than three commands;
- timeout or output budgets above the fixed maximums;
- raw output dumps and oversized output-tail metadata;
- private paths, secrets, raw payload wording, and unsafe markers;
- auto-run claims outside the VS Code user-started bounded run;
- production, release, or marketplace overclaims.

## Deterministic evidence

The fixtures are local/mock deterministic evidence. They prove schema shape, request/result correlation, and rejection behavior only. They do not prove real command execution, real provider behavior, full IDE host parity, CI readiness, production autonomy, release readiness, or marketplace publication safety.

Future implementation work must keep the same boundary: Start or manual confirmation first, fixed command ids only, bounded sequence/output/time budgets, sanitized aggregate summaries only, lineage-correlation fail-closed behavior, and no free-form shell authority. Tiny leash, fewer bite marks.
