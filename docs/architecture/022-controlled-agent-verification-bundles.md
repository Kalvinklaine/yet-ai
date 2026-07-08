# 022 Controlled Agent Verification Bundles

This document defines the S117 verification bundle v1 contract. It is contract, documentation, and fixture work only. It does not implement execution, bridge wiring, GUI controls, host runners, runtime behavior, provider calls, storage, command expansion, or workspace mutation.

## Goal

A verification bundle records an explicit user-approved bounded sequence of fixed allowlisted verification command ids. It lets later UI/runtime work discuss a small set of local checks as one reviewed metadata object without granting free-form command authority.

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

## Boundary

Verification bundle v1 is a metadata lane, not an executor. It is independent of the S116 multi-file apply UI lane. A bundle cannot be reconstructed into shell text, arguments, cwd, env, package commands, network calls, provider tools, git operations, file reads, file writes, hidden indexing, or automatic repair behavior.

The schema intentionally rejects:

- free-form command strings and command-like fields;
- args, cwd, env, shell, git, package, network, provider, and tool fields;
- model-selected or unknown command ids;
- sequences longer than three commands;
- timeout or output budgets above the fixed maximums;
- raw output dumps and oversized output-tail metadata;
- private paths, secrets, raw payload wording, and unsafe markers;
- auto-run or automatic verification claims;
- production, release, or marketplace overclaims.

## Deterministic evidence

The fixtures are local/mock deterministic evidence. They prove schema shape and rejection behavior only. They do not prove real command execution, real provider behavior, real IDE host integration, CI readiness, production autonomy, release readiness, or marketplace publication safety.

Future implementation work must keep the same boundary: user confirmation first, fixed command ids only, bounded sequence/output/time budgets, sanitized aggregate summaries only, and no free-form shell authority. Tiny leash, fewer bite marks.
