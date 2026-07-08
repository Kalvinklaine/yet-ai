# 023 Controlled Agent Verification Follow-up

This document defines the S118-C1 contract for bounded follow-up proposal metadata derived from sanitized controlled-agent verification bundle summaries. It is contract, documentation, and fixture work only. It does not implement GUI, runtime, provider, executor, bridge, storage, command, repair, apply, hidden read, search, or workspace mutation behavior.

## Goal

A controlled agent may use a reviewed verification bundle summary to prepare a follow-up proposal only after the user selects a next action. The follow-up proposal is metadata for a draft or explanation path; it is not a provider request, repair loop, or apply payload.

The schema is `packages/contracts/schemas/engine/controlled-agent-verification-followup.schema.json`.

Valid examples live under `packages/contracts/examples/engine/controlled-agent-verification-followup-*.json`.

Invalid examples live under `packages/contracts/examples-invalid/engine/controlled-agent-verification-followup-*.json`.

Run:

```sh
npm run validate:contracts
```

## Required base

This contract uses the S117 verification bundle contract as its only required base. It may reference the S117 bundle kind, bundle id, aggregate status, command count, failed count, aggregate hash, and bounded summaries. It does not depend on any S117 UI, executor, or host implementation.

## Allowed follow-up context

A valid follow-up may include only:

- allowlisted command ids and safe display labels;
- status, exit code, truncation flag, bounded output byte and line counts;
- bounded safe output-tail summaries, output-tail hashes, and aggregate result hash;
- error categories such as test failure, type error, lint error, timeout, policy denied, runner error, or unknown;
- a user-selected next action such as explain result, suggest manual next step, draft manual fix prompt, close run, or no action;
- a draft-only follow-up title and prompt summary;
- policy flags proving the follow-up is manual, metadata-only, and non-executing.

## Explicitly forbidden material

The contract rejects:

- raw stdout or stderr dumps;
- raw output, raw logs, raw prompts, raw diffs, or raw file bodies;
- command strings, command fields, args, cwd, env, shell snippets, git commands, package commands, or free-form runner material;
- private paths, home directories, temp roots, secrets, tokens, cookies, credentials, private keys, provider payloads, provider responses, provider tool calls, or tool-call fields;
- hidden reads, hidden search, hidden scan, indexing, or context gathering beyond the provided sanitized verification summaries;
- automatic provider send, automatic repair, automatic apply, automatic verification, rollback, workspace mutation, runtime execution, or bridge execution;
- production autonomy, release readiness, marketplace readiness, or any claim that this metadata makes the controlled agent production-autonomous.

## Manual action boundary

The user must explicitly select the next action and, if a prompt draft is produced, explicitly review and send it. The metadata cannot auto-send to a provider and cannot start a repair loop. A later assistant response or proposal must be created through existing manual chat/proposal flows and must pass its own contracts.

## Fixture coverage

The valid fixture covers a failed two-command verification bundle summary, bounded safe output summaries, hashes, counts, an error category, and a user-selected manual fix-prompt action.

Invalid fixtures reject raw stdout, raw stderr summary text, private paths and secrets, automatic repair, command fields, provider-tool calls, hidden search/read, production autonomy overclaims, automatic provider send, and cwd/env fields.

## Verification

The required verification commands for this contract lane are:

```sh
npm run validate:contracts
npm run check
```

These commands validate schema and fixture coverage only. They do not prove GUI rendering, runtime execution, provider behavior, or host apply/repair behavior.

For the GUI follow-up draft wiring, also run:

```sh
cd apps/gui && npm test -- App AgentRunPanel controlledAgentVerificationFollowup
npm run smoke:controlled-agent-verification-followup
```

The GUI and smoke checks cover explicit-click local draft creation, stale/unsafe fail-closed behavior, and no automatic send, bridge, provider, repair, apply, verification, or raw-output behavior.
