# 026 Controlled Agent Task Presets

This document defines the S121 controlled coding task preset contract. It is contract, documentation, and fixture work only. It does not implement UI, prompt selection, runtime execution, provider calls, bridge wiring, host mutation, verification running, storage, or release behavior.

## Goal

Task presets give the user a small set of starting intents for useful controlled-agent workflows while preserving the existing manual authority boundaries. A preset may classify intent, describe which already-controlled capability lanes can be offered, and explain recovery guidance. A preset is not an executor and cannot grant new authority.

The schema is `packages/contracts/schemas/engine/controlled-agent-task-preset.schema.json`.

Valid examples live under `packages/contracts/examples/engine/controlled-agent-task-presets.json`.

Invalid examples live under `packages/contracts/examples-invalid/engine/controlled-agent-task-presets-*.json`.

Run:

```sh
npm run validate:contracts
```

## Preset taxonomy

The initial preset set contains exactly these user-started intents:

- `fix-small-bug` for a focused defect in explicit context;
- `add-focused-test` for a narrow test addition around selected behavior;
- `refactor-small-function` for a small selected function with behavior preservation;
- `explain-selected-code` for read-only explanation of selected code;
- `improve-copy-or-typing` for small wording or type annotation improvements.

Each preset records a user-facing label, sanitized intent summary, workflow class, explicit context policy, provider proposal policy, optional apply policy, optional verification policy, required user gates, and recovery guidance.

## Allowed capability lanes

A preset may refer only to these bounded lanes:

- explicit user-selected context, including active file excerpts, selected ranges, user-selected files, and user-selected search results;
- provider-authored proposal or dry-run plan metadata;
- optional bounded multi-file apply after review and explicit user confirmation;
- optional verification bundle after explicit user approval;
- recovery guidance that waits for the user's next step.

The `explain-selected-code` preset has no apply or verification lane. The mutation-capable presets still describe only bounded existing text-file changes and remain gated by review and confirmation.

## Explicit non-authority

The contract intentionally rejects:

- hidden reads, hidden search, indexing, or broad workspace scanning;
- arbitrary shell, free-form command text, git, network, package, provider tools, or local tools;
- automatic apply, automatic verification, automatic repair, or autonomous continuation;
- broad workspace mutation or mutation outside bounded existing text files;
- raw prompt, file body, raw diff, provider payload, or command output persistence;
- production, release, or marketplace readiness claims.

Presets are intent metadata only. They cannot mint request ids, select context without the user, reconstruct replacement text, run verification, or imply that adjacent controlled-agent contracts are already implemented.

## Fixture coverage

The valid fixture covers all five presets with explicit context gates, dry-run provider proposal metadata, optional apply and verification metadata, persistence exclusions, false production claims, and recovery guidance.

Invalid fixtures reject unsafe preset authority, broad workspace mutation, hidden search, free-form command authority, missing explicit user gates, raw prompt/file/diff persistence, and production/release/marketplace claims.

## GUI implementation boundary

S121-C3 exposes these presets in `AgentRunPanel` as visible, user-reviewed draft guidance. Selecting a preset calls the pure GUI prompt builder only and renders the draft prompt, recommended next steps, context counts, and all-false no-auto policy in the panel.

Selection does not post bridge messages, read files, search, index, attach context, send chat, call providers, apply edits, run verification, save memory, write browser storage, or mint execution authority. Browser remains preview-only for trusted workspace execution. JetBrains remains display-only / partial fail-closed until separate host parity work proves controlled execution. VS Code copy is guidance-only until the user explicitly reviews and uses existing controlled lanes.

Smoke coverage is:

```sh
npm run smoke:controlled-agent-task-presets
```

The smoke covers all five preset ids, unsafe preset metadata rejection, bounded sanitized draft output, and no automatic send/search/index/attach/provider/apply/verification/bridge/storage/command/git/network/tool authority.

## Future implementation boundary

Future UI or prompt work may render these presets as starting choices, but must still perform separate explicit context selection, review, apply confirmation, and verification approval. Any implementation must treat this contract as a small labeled menu, not as permission to read, mutate, run, store, or claim readiness. Tiny menu, tiny leash; the agent may sniff, not sprint.
