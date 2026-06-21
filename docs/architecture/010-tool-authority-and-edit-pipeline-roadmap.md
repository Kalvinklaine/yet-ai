# 010 Tool Authority and Edit/Apply Pipeline Roadmap

This note defines the current safe baseline for Yet AI edit proposals and the future policy layers required before broader tool authority, shell/git actions, or model-driven apply behavior can exist. It is documentation-only. It does not add bridge messages, schemas, runtime endpoints, host actions, or implementation authority.

## Decision summary

Yet AI remains deny-by-default and contract-first for every privileged action. Assistant output may describe work or propose a bounded edit, but assistant output is not authority to read files, mutate the workspace, execute commands, run provider tools, or verify changes.

The current safe baseline is the Sprint 35 safe-edit proposal flow:

- The assistant may produce one strict safe-edit proposal envelope or normal explanatory prose.
- The GUI parses and validates the proposal before rendering it as a reviewable preview.
- The GUI mints request correlation only after the user explicitly clicks apply.
- Browser mode remains preview-only and never mutates files.
- VS Code is the reference host for confirmed apply; JetBrains is dev-preview only through the same existing apply/result bridge messages.
- The IDE host still performs its own policy/user confirmation before any bounded replacement is applied.
- Host results are sanitized, correlated, and rendered with repair guidance when not applied.
- There is no auto-apply, no model-triggered apply, no hidden file read, no shell/git/tool execution, and no rollback/undo contract.

## Current safe baseline

The implemented edit path is intentionally narrow:

1. A model-authored proposal is text until parsed by the GUI.
2. A valid proposal must match the existing `gui.applyWorkspaceEditRequest` payload shape without an assistant-supplied `requestId`.
3. Proposals are limited to bounded text replacements in existing workspace-relative files.
4. The proposal must require user confirmation and must state `cloudRequired: false` when that field is present.
5. Unsafe paths, traversal-like values, create/delete/rename/move intent, command/tool smuggling, unknown fields, broad patch semantics, and secret-like summaries are rejected by the current parser/schema boundary.
6. The GUI renders a preview, quality summary, risk badges, redaction acknowledgement where needed, and review-required copy.
7. The GUI never edits files directly and never applies a proposal merely because it appears in assistant output.
8. The user must explicitly request apply from the GUI, after which the host applies or rejects through the existing confirmed apply bridge.
9. Result handling is sanitized and correlated. Stale or duplicate host results are ignored or bounded/cleared.
10. Non-applied outcomes provide human repair guidance only; there is no automatic retry, repair, verification, or follow-up action.

This baseline is enough for a local dev-preview safe-edit loop. It is not a generic tool system, patch engine, agent runner, shell executor, or autonomous coding workflow.

## Explicitly disabled today

The following capabilities are not implemented and must not be described as available:

- generic tool calls;
- `apply_patch` or any patch execution engine;
- shell, git, task, or package-manager execution;
- hidden workspace reads, search, indexing, or background context gathering;
- create, delete, rename, or move authority for files or directories;
- model-triggered verification or auto-run tests;
- provider tool execution;
- automatic application of proposals;
- arbitrary file reads or full-file access through edit proposals;
- autonomous repair, retry, rollback, undo, or merge behavior.

Existing read-only/navigation/context bridge actions and allowlisted verification preview flows remain separate explicit user-driven paths. They do not become generic tool authority and do not authorize workspace mutation.

## Future authority layers

Any broader tool authority or edit/apply expansion must be built as layered policy, not as direct model-to-host execution. The required future pipeline is:

1. **Assistant output/proposal** — model output is only a proposal or explanation. It carries no authority by itself and cannot supply trusted request correlation.
2. **Parser/schema validation** — strict schemas and parsers reject malformed, ambiguous, oversized, unknown, secret-like, path-unsafe, command-like, or authority-smuggling payloads before UI rendering.
3. **GUI review** — the GUI renders a bounded human-readable preview, risk summary, affected surface, and disabled/not-implemented boundaries without persisting raw secrets or treating raw assistant JSON as executable UI.
4. **Host capability check** — the target host reports whether the requested capability is supported for the current environment. Unsupported hosts fail closed; browser remains non-executing for workspace mutation.
5. **Explicit user confirmation** — the user confirms the exact operation after reviewing the GUI and any host confirmation. Confirmation is per operation, not reusable blanket authority.
6. **Host execution** — only the host that owns the workspace performs the bounded operation under its own policy and platform APIs. The GUI and model never mutate files directly.
7. **Sanitized result** — the host returns only bounded status, counts, safe workspace-relative labels where allowed, and short user-facing messages. Raw provider output, secrets, private paths, command strings, full file bodies, and unbounded logs stay out of GUI-facing results.
8. **Progress/audit event** — future progress reporting may record sanitized lifecycle metadata such as ids, phase, status, elapsed time, safe labels, and bounded tails. Audit events are transparency, not authority.
9. **Repair guidance** — failures produce user-facing guidance for requesting a smaller proposal, refreshing context, or manually retrying. The system must not auto-repair, auto-run, or auto-apply from a failure.
10. **Rollback/undo after separate design** — rollback, undo, checkpoint, or revert behavior requires its own design, contracts, user confirmation model, storage policy, and smokes before implementation. It must not be implied by apply results.

## Expansion gates

Future expansion requires all of the following before any new privileged behavior is enabled:

- strict request, progress, result, and invalid-fixture schemas;
- positive examples and negative examples for unsafe payloads;
- deterministic local smokes for the happy path and rejection path;
- host capability and origin/source checks;
- request correlation minted by trusted GUI or host code, never by assistant output;
- explicit user confirmation for risky effects;
- least-privilege allowlists for each action;
- sanitized progress/audit logging;
- security review for path handling, secret handling, denial-of-service bounds, prompt-injection boundaries, and host ownership;
- documentation updates that keep public wording generic and avoid claiming production authority before implementation;
- local-first BYOK compatibility with no required hosted Yet AI backend, account, managed gateway, product credits, or cloud workspace.

New schemas or examples should be added only in the card that implements or validates that specific boundary. This roadmap intentionally does not add them.

Sprint 40 adds the first contract-only design gate for this boundary: `packages/contracts/schemas/engine/tool-authority-policy.schema.json`. It is policy/evaluation fixture metadata only. It is not a runtime endpoint, bridge message, host command, GUI control, policy engine, or executable command API. A valid fixture starts from `defaultDecision: "deny"`, uses `cloudRequired: false`, records only sanitized source/risk/requirement/decision metadata, and grants no authority by itself.

The policy vocabulary is intentionally broader than today's implementation so unsafe future classes stay named and closed: read-only context/navigation, bounded edit apply, allowlisted verification, workspace patch, shell, git, provider tool, network, hidden read/search/index, home/secret access, and remote publish/push. Shell, git, provider tools, network access, hidden reads/search/indexing, home/secret access, and remote publish/push remain deny-only in the fixture schema. `metadata_only` covers inert host/runtime declarations, and `allow_with_confirmation` is limited to current safe baseline concepts as design fixtures, not as executable permission. Raw command strings, cwd/env, assistant-minted request ids, absolute/private/home paths, secret markers, cloud requirements, and unknown authority-smuggling fields are invalid fixture cases.

## Product boundaries to preserve

Tool authority belongs behind local runtime and host policy boundaries. The GUI may render proposals and collect explicit user intent, but it must not persist raw provider secrets, execute shell commands, scan the workspace, or bypass host confirmation. IDE hosts may execute only explicitly designed and schema-validated host-owned capabilities. The engine may observe sanitized progress and own provider/runtime policy, but it must not gain broad IDE mutation or shell authority by accident.

Provider capability metadata such as model tool support is informational until a separate contract enables provider tool calling. A model that claims tool capability does not grant Yet AI permission to call provider tools, execute local tools, mutate the workspace, or run verification.

## Roadmap sequencing

The next safe sequence is:

1. Keep the Sprint 35 safe-edit baseline stable and conservative.
2. Add only documentation or fixture clarifications when current wording could be mistaken for broad tool authority.
3. For any future capability, start with schemas, examples, invalid fixtures, host policy, and mock smokes before implementation.
4. Add implementation in the smallest host/runtime slice that can be reviewed and rolled back.
5. Only after that slice passes security review and local smokes, update user-facing docs to describe the capability as implemented.

Until a future card completes those gates, Yet AI should keep saying: proposals are reviewed by the user, apply is explicit and host-confirmed, verification is user-triggered only where allowlisted, and broader tools remain disabled.
