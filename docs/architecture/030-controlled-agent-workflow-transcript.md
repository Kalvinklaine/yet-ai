# 030 Controlled Agent Workflow Transcript

This document defines the S126-C1 controlled workflow transcript/export contract. It is documentation, schema, and fixture work only. It does not implement transcript storage, GUI export UI, runtime endpoints, bridge messages, host commands, provider calls, file access, search, apply, verification execution, recovery execution, telemetry, or publication evidence.

## Goal

A workflow transcript is sanitized display/export evidence for the full VS Code-first controlled coding workflow. It lets local dogfood, support review, and future UI work summarize what happened without persisting raw sensitive material or granting authority.

The schema is `packages/contracts/schemas/engine/controlled-agent-workflow-transcript.schema.json`.

Valid examples live under `packages/contracts/examples/engine/controlled-agent-workflow-transcript-*.json`.

Invalid examples live under `packages/contracts/examples-invalid/engine/controlled-agent-workflow-transcript-*.json`.

Run:

```sh
npm run validate:contracts
```

## Contract shape

A valid transcript records only bounded metadata:

- transcript id, run id, generated timestamp, host label, task preset label, and local-first/provider-access labels;
- explicit user gates for start, context/search selection, provider send, proposal review, patch-plan review, apply, verification, follow-up, recovery choice, and final export;
- stage transitions with enum stages, statuses, durations, and safe labels;
- selected context and search labels, counts, byte/line budgets, evidence hashes, and omitted-item counts;
- proposal, patch-plan, apply, verification bundle, follow-up, and recovery summaries;
- omitted, unsafe, unsupported, stale, or blocked status counts;
- final sanitized task evidence with counts, safe result labels, evidence hashes, and export readiness.

## Boundary

The transcript is display/export-only evidence. It is not an action request, replay protocol, runner, audit log with security guarantees, policy engine, permission token, or tool bus. Consumers must treat every field as untrusted presentation data.

A transcript cannot trigger reads, search, provider calls, apply, verification, follow-up generation, recovery, rollback, storage mutation, bridge posts, host commands, shell, git, package, network, local tool, or workspace mutation. Future implementation must keep action authority in existing explicit GUI/host/runtime contracts and validate those contracts independently.

## Forbidden data

The schema and fixtures intentionally reject:

- raw prompts, provider responses, model payloads, bridge dumps, browser-storage dumps, file bodies, diffs, patches, replacement text, command strings, args, cwd, env, shell snippets, stdout/stderr/output dumps, stack traces, git/network/provider/tool fields, private absolute paths, secrets, tokens, cookies, credentials, and hidden scan data;
- assistant-minted user gates, execution flags, auto-send, auto-apply, auto-run verification, automatic repair, automatic rollback, hidden reads, hidden search, background indexing, broad workspace scan, or replay claims;
- production, release, marketplace, signing, notarization, publication, real-provider CI, or broad autonomy overclaims.

## Deterministic evidence

The fixtures are local/mock deterministic contract evidence. They prove schema shape and rejection behavior only. They do not prove real provider quality, real host execution, packaged install behavior, transcript persistence, support readiness, production readiness, release readiness, marketplace publication, signing, notarization, or autonomous operation.

Future UI/export work may render or download transcript metadata only after a separate implementation card. That work must preserve the same leash: safe labels, counts, hashes, bounded arrays, explicit gates, sanitized final evidence, and no raw payload persistence. Cozy paperwork, not a magic wand.
