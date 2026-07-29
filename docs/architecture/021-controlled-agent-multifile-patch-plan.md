# 021 Controlled Agent Multi-file Patch Plan

This document began as the S114 contract for bounded multi-file patch plan metadata. S114 itself was contract, documentation, and fixture work only. The later S116 slice implemented a separate explicit bounded apply path in the VS Code host; that implementation does not turn the S114 review plan into authority by itself.

## Goal

A controlled agent may prepare a review-only plan for a small multi-file change. The plan can describe only existing workspace-relative text files and bounded replacement edits. S115 review UI renders that metadata, while the implemented S116 VS Code path requires a separate explicit apply request, user confirmation, and host validation before mutation.

The schema is `packages/contracts/schemas/engine/controlled-agent-multifile-patch-plan.schema.json`.

The S116 bridge contract extends `packages/contracts/schemas/bridge/gui-message.schema.json` with `gui.controlledAgentMultifileApplyRequest` and `packages/contracts/schemas/bridge/host-message.schema.json` with `host.controlledAgentMultifileApplyResult`. The bridge schema alone is `fixture_demo` evidence. The separately implemented VS Code executor and dispatch in `apps/plugins/vscode/src/controlledMultifileEdit.ts` and `apps/plugins/vscode/src/webview.ts` are `live_host` dev-preview behavior. Browser and JetBrains execution remain `unsupported`; no engine executor, provider call, free-form command authority, or storage of raw replacements, diffs, or file bodies is added.

Valid examples live under `packages/contracts/examples/engine/controlled-agent-multifile-patch-plan-*.json`.

Invalid examples live under `packages/contracts/examples-invalid/engine/controlled-agent-multifile-patch-plan-*.json`.

Run:

```sh
npm run validate:contracts
```

## Contract shape

A valid plan records:

- controlled workspace id, run id, host label, and private-path exposure set to false;
- conservative budgets for file count, edit count, per-edit replacement bytes, and total replacement bytes;
- plan-level file count, edit count, and total replacement byte metadata;
- each existing workspace-relative text file path label;
- expected pre-edit file hash for each file;
- expected range hash and bounded line range for each replacement edit;
- replacement byte counts and sanitized replacement summaries only;
- per-file sanitized summaries and risk labels;
- explicit false flags for raw replacement bodies, raw diffs, raw bodies in report/export/history, automatic apply, assistant-minted apply, model-minted apply authority, commands, provider tools, local tools, shell, git, network, package, create, delete, rename, move, chmod, binary, symlink, dependency, generated, hidden, and private-path edits.

The contract intentionally carries no replacement body. Future UI can show file labels, ranges, hashes, sizes, summaries, and risks, but must not treat this metadata as an apply payload.

## Scope and budgets

S114 is small-change metadata only:

- at most five files;
- at most twenty replacement edits;
- at most 12,000 replacement bytes per edit;
- at most 48,000 total replacement bytes;
- path labels must be workspace-relative, visible, non-dependency, non-generated, non-hidden, and text-file-like.

The schema bounds individual values. Future implementation may add cross-field arithmetic checks, but this contract already rejects over-budget declared limits and oversized per-edit or total replacement byte metadata.

## Explicit non-authority

This contract does not grant apply authority. In particular, it forbids:

- automatic apply;
- assistant-minted apply requests;
- model-minted apply authority;
- create, delete, rename, move, chmod, binary, symlink, directory, generated, dependency, hidden, or private-path edits;
- raw replacement bodies, raw diffs, raw file bodies, raw provider payloads, command strings, tool calls, shell/git/network/package authority, or provider tool authority;
- hidden reads, indexing, broad mutation, production autonomy, release, or marketplace claims.

S115 review UI should treat this as display-only review metadata. S116 VS Code explicit apply must require a separate user gesture and host-owned validation of current hashes/ranges before any replacement happens.

## S116 bridge apply boundary

An apply request must be GUI/user-minted, explicitly confirmed, and correlated to a reviewed multi-file patch plan id. The request may name only existing workspace-relative text files, expected pre-edit and range hashes, replacement content hashes, bounded line ranges, replacement byte counts, per-edit sanitized summaries, max file/edit/byte budgets, and per-edit `replacementText` values that the caller already reviewed with the user.

`replacementText` is a transient GUI-to-VS Code apply payload. It exists only so the host can apply a non-empty bounded replacement after user confirmation. It must match `replacementByteCount` as UTF-8 bytes and `replacementContentHash` as SHA-256, and sanitizers must reject secrets, private paths, binary/control characters, raw diff markers, command/provider/tool payload fields, and broad patch blobs. It is not persistent evidence and must not be stored in history, trace, report, export, summaries, host results, or correlation metadata.

Execution is explicitly VS Code-only and classified `live_host` for this bounded dev-preview path. It requires a GUI/user-minted correlated request, explicit confirmation, and host-owned hash, path, range, and budget validation. Browser is `unsupported` and non-executing. JetBrains is `unsupported` for this envelope and must fail closed unless a future parity card implements and verifies equivalent bounded execution. The S116 host result is sanitized per file with statuses, counts, hashes, and safe summaries only; it must not persist or return raw replacement text, raw diffs, or file bodies. Contract fixtures and review UI remain `fixture_demo` or `local_derived` evidence and do not independently prove execution.

## Fixture coverage

Valid fixtures cover a two-file, two-edit review plan with expected hashes, bounded ranges, byte counts, summaries, risk labels, and all deny-by-default policy flags.

Invalid fixtures reject broad mutation, raw replacement bodies, create/delete/rename operations, absolute/private paths, dependency paths, generated paths, assistant-minted apply, missing pre-edit hashes, over-budget file or replacement byte metadata, and command/provider/tool fields.

S116 bridge fixtures add a valid GUI multi-file apply request with tiny non-empty transient replacement text and a sanitized metadata-only host result. Invalid bridge fixtures reject raw replacement bodies/diffs, text/byte/hash mismatches, unsafe secret/private/raw-diff replacement text, create/delete/rename-shaped edits, private/absolute/traversal paths, dependency/generated/hidden files, missing hashes, over-budget values, assistant-minted ids, Browser and JetBrains execution overclaims, and command/provider/tool fields.

## Verification and evidence limit

Run `npm run validate:contracts` for the S114/S116 schemas and fixtures. That command proves contract shape only. Run `npm run smoke:controlled-agent-real-multifile-edit` and the VS Code package tests for focused executor evidence. The smoke compiles/imports the host executor and mutates only a disposable sentinel workspace; it does not launch an installed VS Code UI, call a provider, prove production autonomy, or establish Browser or JetBrains execution parity.
