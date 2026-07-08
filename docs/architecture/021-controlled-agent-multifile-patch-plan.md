# 021 Controlled Agent Multi-file Patch Plan

This document defines the S114 contract for bounded multi-file patch plan metadata. It is contract, documentation, and fixture work only. It does not implement apply, host, runtime, bridge, provider, storage, verification, command, or workspace mutation behavior.

## Goal

A controlled agent may prepare a review-only plan for a small multi-file change before any future explicit apply path exists. The plan can describe only existing workspace-relative text files and bounded replacement edits. It is intended to give S115 review UI and S116 VS Code explicit apply work a narrow metadata contract to render and validate later.

The schema is `packages/contracts/schemas/engine/controlled-agent-multifile-patch-plan.schema.json`.

The S116 bridge contract for a future explicit apply path extends `packages/contracts/schemas/bridge/gui-message.schema.json` with `gui.controlledAgentMultifileApplyRequest` and `packages/contracts/schemas/bridge/host-message.schema.json` with `host.controlledAgentMultifileApplyResult`. This is still contract, documentation, and fixture work only: it does not add a VS Code executor, GUI apply button, Browser execution, JetBrains execution, runtime mutation, provider call, command execution, or storage of raw replacements/diffs/file bodies.

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

## S116 bridge apply boundary## S116 bridge apply boundary

An apply request must be GUI/user-minted, explicitly confirmed, and correlated to a reviewed multi-file patch plan id. The request may name only existing workspace-relative text files, expected pre-edit and range hashes, replacement content hashes, bounded line ranges, replacement byte counts, per-edit sanitized summaries, max file/edit/byte budgets, and per-edit `replacementText` values that the caller already reviewed with the user.

`replacementText` is a transient GUI-to-VS Code apply payload. It exists only so the host can apply a non-empty bounded replacement after user confirmation. It must match `replacementByteCount` as UTF-8 bytes and `replacementContentHash` as SHA-256, and sanitizers must reject secrets, private paths, binary/control characters, raw diff markers, command/provider/tool payload fields, and broad patch blobs. It is not persistent evidence and must not be stored in history, trace, report, export, summaries, host results, or correlation metadata.

Initial execution is explicitly VS Code-only. Browser is unsupported and non-executing. JetBrains must fail closed unless a future parity card defines and verifies equivalent bounded execution. The S116 host result is sanitized per file with statuses, counts, hashes, and safe summaries only; it must not persist or return raw replacement text, raw diffs, or file bodies. This contract does not grant implementation authority yet.

## Fixture coverage

Valid fixtures cover a two-file, two-edit review plan with expected hashes, bounded ranges, byte counts, summaries, risk labels, and all deny-by-default policy flags.

Invalid fixtures reject broad mutation, raw replacement bodies, create/delete/rename operations, absolute/private paths, dependency paths, generated paths, assistant-minted apply, missing pre-edit hashes, over-budget file or replacement byte metadata, and command/provider/tool fields.

S116 bridge fixtures add a valid GUI multi-file apply request with tiny non-empty transient replacement text and a sanitized metadata-only host result. Invalid bridge fixtures reject raw replacement bodies/diffs, text/byte/hash mismatches, unsafe secret/private/raw-diff replacement text, create/delete/rename-shaped edits, private/absolute/traversal paths, dependency/generated/hidden files, missing hashes, over-budget values, assistant-minted ids, Browser and JetBrains execution overclaims, and command/provider/tool fields.
