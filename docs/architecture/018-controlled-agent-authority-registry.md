# 018 Controlled Agent Authority Registry

This document defines the S109 controlled-agent authority registry v1. It is the source of truth for S109-S124 expansion: later search, edit, verification, provider proposal, memory, history, report, export, observability, and host-action cards must use this vocabulary before they widen any contract or implementation.

The registry is a contract and documentation foundation only. It does not implement runtime behavior, bridge messages, provider calls, workspace search, edit application, command execution, host parity, storage migration, release operations, or marketplace operations. The corresponding strict schema is `packages/contracts/schemas/engine/controlled-agent-authority-registry.schema.json`, the safe fixture is `packages/contracts/examples/engine/controlled-agent-authority-registry-v1.json`, and unsafe fixtures live under `packages/contracts/examples-invalid/engine/controlled-agent-authority-registry-*.json`.

This record closes the first authority-registry decision called out by the S107 production gap audit in `docs/architecture/017-controlled-agent-production-gap-audit.md`. The S107 audit remains blocked for any production-like autonomous-agent decision. This registry gives later cards one fail-closed language for evidence; it is not approval for broader authority.

## Contract status

- **Status**: dev-preview contract only.
- **Local-first BYOK**: required. Core controlled-agent workflows must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, real-provider CI, publication flow, or managed credential path.
- **User gesture**: every privileged category requires explicit user action, correlation ids, and GUI- or host-owned request minting. The assistant must not mint privileged request ids.
- **Host support**: host capability metadata is prerequisite evidence, not authority by itself.
- **Sensitive data boundary**: reports, traces, exports, history, observability, and fixtures may persist sanitized metadata only. They must omit prompts, provider exchanges, file contents, replacement details, process material, private paths, credentials, bridge payloads, and local tool payloads.
- **Claims**: production, release, marketplace, signing, notarization, support, and publication claims remain false.

## Host authority states

| Host | Registry state | Meaning |
| --- | --- | --- |
| Browser | Unsupported for trusted execution | Browser may render preview or metadata states, but it cannot claim trusted workspace execution and cannot mint privileged controlled-agent requests. |
| VS Code | First execution host | VS Code is the first host for existing explicit controlled dev-preview slices, subject to per-category contracts, user action, correlation, and sanitized results. |
| JetBrains | Fail-closed until verified | JetBrains must stay visibly unavailable or metadata-only for controlled execution until a separate verified parity card proves a narrower path. |

## Authority categories

| Category | Dev-preview allowed state | Blocked or future state |
| --- | --- | --- |
| File read | One selected safe workspace-relative text file with bounded byte and line limits, explicit user action, host support, and sanitized metadata. | Background reads, recursive scans, dependency/generated paths, hidden files, broad project browsing, and raw body persistence outside the transient explicit request path. |
| Lexical search | Future requires verified card. The only acceptable future shape starts as explicit literal query evidence with host proof. | Hidden search, background scanning, project indexing, glob or regex expansion, path discovery, generated/dependency traversal, and automatic context gathering. |
| Edit/apply | Existing-file bounded replacement with expected hash, visible review, explicit user action, and host correlation. | Create, delete, rename, move, chmod, directory mutation, broad patch application, automatic apply, binary/symlink mutation, and raw replacement or diff persistence. |
| Verification command ids | Fixed command ids such as `repository-check`, `gui-app-tests`, and `engine-chat-tests`, with explicit user action, host mapping, timeout and output-tail limits, and sanitized result metadata. | Free-form command text, args, cwd, env, shell expansion, git, package, network, model-selected process paths, automatic verification, and process transcript persistence. |
| Provider proposal use | Sanitized proposal metadata only: bounded plan labels, bounded replacement-candidate metadata, and allowlisted verification suggestions for review. | Provider tool calls, local tool calls, raw provider exchange storage, automatic apply/run/repair, credential echoing, managed gateway requirement, and provider-owned workspace authority. |
| Memory attachment | Explicit one-shot user-selected memory note metadata: safe ids, titles, summaries, labels, and bounded counts. | Automatic memory selection, indexing, background relevance lookup, provider memory writes, report persistence of note bodies, and silent reuse in later runs. |
| Run history, report, export, observability writes | Sanitized metadata only: phase labels, host labels, counters, artifact ids/checksums, stop reasons, and safe summaries. | Raw prompts, provider exchanges, file contents, replacement details, process material, private paths, secrets, browser-storage dumps, bridge payloads, and local tool payloads. |
| Host actions | Explicit safe UI actions such as reveal/open labels, visible stop, and review-only recovery guidance where separately scoped. | Package updates, task-board mutation, release publication, unattended rollback, support escalation, broad IDE automation, or privileged host commands. |
| Unsupported privileged operations | Blocked by default. Future changes require architecture record, implementation card, contract fixtures, host-owned tests, sanitized evidence, and human review. | Shell execution, git mutation, network action, package install, provider tool call, local tool call, broad mutation, background project scan, publication, signing, notarization, and marketplace operations. |

## Registry rules for later cards

1. Start from deny-by-default. A missing category, missing host, missing user gesture, missing correlation, or unknown state is blocked.
2. Treat this registry as vocabulary and evidence routing, not runtime permission. Implementations still need their own bridge/runtime schemas, host tests, GUI tests, smokes, and documentation.
3. Keep VS Code-first execution wording narrow. Browser remains unsupported for trusted workspace execution, and JetBrains remains fail-closed unless a later card verifies parity.
4. Keep local-first BYOK explicit. Provider settings and credentials stay local-only, and Yet AI controlled-agent workflows must not depend on hosted Yet AI services or product credits.
5. Never persist raw sensitive material in history, report, export, trace, smoke output, or public docs.
6. Do not use production, release, marketplace, signing, notarization, or support language as an achieved claim for controlled-agent authority.

## Fixture coverage

The v1 contract includes one safe registry fixture and invalid fixtures for:

- raw payload fields in observability/report metadata;
- unsupported host claiming trusted execution;
- hidden search, background scan, and indexing;
- free-form command, cwd, env, and process text fields;
- broad mutation and automatic apply flags;
- provider-tool and local-tool authority;
- production, release, and marketplace claims.

## Verification

For this contract foundation, run:

```sh
npm run validate:contracts
npm run check
```

These commands validate schemas, fixtures, docs index, public wording, product identity, and hygiene only. They do not launch runtimes, call providers, read workspaces, search files, apply edits, run controlled verification commands, mutate hosts, publish artifacts, or approve production autonomy.
