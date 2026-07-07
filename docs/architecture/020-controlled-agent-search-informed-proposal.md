# 020 Controlled Agent Search-Informed Provider Proposal

This document defines the S113 contract for provider-backed controlled-agent proposals that may use selected controlled search/context evidence. It is contract and fixture work only. It does not implement a provider call, runtime endpoint, bridge message, prompt assembler, storage path, apply path, verification path, or automatic follow-up loop.

## Goal

A provider proposal step may be informed by explicit user-selected controlled search/context evidence after the S109-S112 lexical search and selection foundation. The proposal contract can carry only safe metadata:

- selected context labels;
- workspace-relative path labels;
- bounded ranges;
- sanitized snippet summaries;
- snippet and source-result hashes;
- counts and fixed conservative policy flags.

It must not carry raw prompt text, raw file bodies, raw search result bodies, full snippets for broad transfer, hidden results, provider response bodies, provider tool-call payloads, local tool calls, command strings, shell/git/package/network material, private paths, secrets, or production/autonomy claims.

## Contract

The schema is `packages/contracts/schemas/engine/controlled-agent-search-informed-proposal.schema.json`.

Valid examples live under `packages/contracts/examples/engine/controlled-agent-search-informed-proposal-*.json`.

Invalid examples live under `packages/contracts/examples-invalid/engine/controlled-agent-search-informed-proposal-*.json` and cover:

- raw search result bodies;
- hidden search results;
- assistant-minted selected context;
- provider tool calls;
- command fields;
- private paths and secret-like values;
- production/autonomy overclaims.

The fixture gate is:

```sh
npm run validate:contracts
```

## Ownership and local-first provider boundary

Provider selection and credentials remain engine-owned. The contract records this with `providerSelectionOwner: "engine"`, `providerCredentialsOwner: "engine_local_only"`, `cloudRequired: false`, and all raw-provider-payload persistence flags set to false.

This contract must not require a hosted Yet AI backend, Yet AI account, managed provider gateway, product credit balance, cloud workspace, or persisted GUI-facing provider secret. It is compatible with local-first BYOK because it describes only sanitized proposal metadata after the engine uses user-configured provider access.

## Evidence rules

A valid `selectedEvidence` block must be user-selected and explicit:

- `source` is `controlled_search_selection`;
- `selectedBy` is `user`;
- `explicitUserSelection` is `true`;
- `hiddenResultsIncluded`, `rawBodiesIncluded`, and `broadOutputIncluded` are `false`;
- each item has `sanitized: true`, `rawBodyIncluded: false`, and `hiddenResult: false`.

The evidence block is not a hidden context expansion channel. It cannot request more files, include broad search output, represent unselected search results, or smuggle raw bodies into a provider request or durable record.

## Explicit non-authority

S113-C1 grants no new authority. In particular, it forbids:

- provider tool calling;
- local tool calling;
- shell, git, package, network, or command execution;
- hidden context expansion, hidden reads, hidden search, workspace indexing, or broad search dumps;
- raw prompt, raw file, raw search result, raw provider payload, raw command, or raw output persistence;
- auto-apply, auto-run, auto-verify, auto-repair, or automatic follow-up drafting;
- production autonomy, release readiness, marketplace readiness, or real-provider CI claims.

Future implementation cards must preserve these boundaries unless a later architecture decision explicitly widens a specific authority with schema fixtures, policy checks, host/runtime validation, and user controls.
