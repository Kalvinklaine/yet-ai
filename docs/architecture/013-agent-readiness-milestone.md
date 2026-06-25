# 013 Agent Run Readiness Milestone

This document records the Sprint 64 Agent Run readiness status. It is a conservative milestone audit for local dogfood and future planning, not a production release claim and not an autonomy approval.

Agent Run currently remains a manual local dev-preview flow. The user drafts the goal, reviews prompt text, clicks Send, reviews any safe-edit proposal, clicks Apply only through the existing confirmation path, and clicks Verification only through the existing allowlisted command-id path. S61, S62, and S63 improved review metadata and safety verification around that flow, but they did not add multi-step execution, controlled autonomy, hidden workspace reads, provider/tool calling, or production readiness.

The local-first BYOK contract is unchanged: core chat, provider setup, Agent Run dogfood, local runtime storage, and IDE-hosted GUI workflows must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production account login, marketplace publication, signing, notarization, or real-provider CI.

## Readiness taxonomy

Use these statuses when describing Agent Run surfaces:

- **Dogfood-ready dev-preview**: implemented enough for local manual dogfood with explicit user actions, bounded mock/local verification, sanitized evidence, and no production or autonomy claim. This status can include known limitations.
- **Experimental manual-only**: implemented or visible for local development, but intentionally constrained to review, prompt drafting, metadata, or preview behavior. The user must still trigger every model send, apply, verification, retry, rollback review, or follow-up action manually.
- **Blocked/deferred**: not implemented as a supported capability. It may be documented as a future direction or prerequisite, but users and agents must not claim it works.
- **Future eligibility gate**: criteria that must be satisfied before a blocked/deferred capability can be designed, enabled, dogfooded, or considered for production. A gate is not an implementation.

Avoid softer wording that implies implementation, autonomy, production publication, marketplace publication, or release publication unless a future document explicitly defines and verifies that stronger status.

## Current Agent Run status matrix

| Surface or capability | Current status | Conservative interpretation |
| --- | --- | --- |
| Browser / standalone GUI | Experimental manual-only | Browser can exercise local GUI/runtime flows and mock/local dogfood paths, but it cannot apply workspace edits, run IDE verification commands, launch IDE host actions, or prove production readiness. |
| VS Code | Dogfood-ready dev-preview | VS Code is the primary manual local IDE dogfood host for explicit context, reviewed safe-edit apply, and allowlisted verification. It is not marketplace-ready, autonomous, or a production release surface. |
| JetBrains | Experimental manual-only | JetBrains has dev-preview hosted GUI and bridge parity evidence for manual controls, including confirmed edit and verification boundaries. It remains local dogfood evidence, not real production parity or autonomy. |
| One-step safe-edit proposal | Dogfood-ready dev-preview | A model response may be parsed as a strict bounded proposal for existing workspace-relative text replacements. It is review-only until the user explicitly applies it; unsafe or malformed proposals fail closed. |
| Explicit Apply | Dogfood-ready dev-preview | Apply is available only after proposal review and readiness metadata, through existing `gui.applyWorkspaceEditRequest` / `host.applyWorkspaceEditResult` with user confirmation. No auto-apply, create/delete/rename, shell, git, or hidden mutation authority is granted. |
| Explicit Verification | Dogfood-ready dev-preview | Verification is available only as an explicit user action through allowlisted command ids such as `repository-check`, `gui-app-tests`, or `engine-chat-tests`, with sanitized result metadata. It is not free-form shell, git, package install, network, provider call, or automatic repair authority. |
| S61 inert plan preview | Experimental manual-only | Multi-step plan preview is metadata-only display: title, summary, step labels, risk labels, expected file labels, and allowlisted verification suggestions. It is not multi-step execution and cannot send, apply, verify, rollback, read files, call providers, schedule work, or mutate the workspace. |
| S62 follow-up/fix draft | Experimental manual-only | Follow-up and fix CTAs can draft sanitized composer text after explicit verification. They only write the composer and focus it; the user must review and click Send. No auto-send, repair, retry, rollback, context attachment, storage persistence, bridge request, or runtime execution is added. |
| S63 safety bundle | Dogfood-ready dev-preview verification aid | `npm run smoke:agent-run-safety-bundle` is an explicit local/mock regression bundle for manual Agent Run boundaries. It is not part of `npm run check`, not real-provider CI, and not production autonomy or release evidence. |
| Multi-step execution | Blocked/deferred | There is no implemented runner that executes a plan across multiple steps. S61 is only inert metadata. |
| Controlled autonomy | Blocked/deferred | No autonomous loop is implemented. Any future controlled-autonomy work must pass the future eligibility gates below before design or implementation. |
| Auto-repair / auto-retry / auto-rollback | Blocked/deferred | Failed verification can stop and may produce a draft-only prompt. The product must not claim automatic repair, retry, verification, or rollback. |
| Background reads or indexing | Blocked/deferred | Agent Run has no authority to scan workspaces, read hidden files, index in the background, or gather context without explicit user selection. |
| Provider/tool calling | Blocked/deferred | Agent Run does not grant provider tool calls, local tools, shell, git, MCP, task execution, package installs, network actions, or arbitrary runtime commands. |
| Real-provider CI | Blocked/deferred | CI and smokes remain mock/loopback/local deterministic. Real provider use is manual local BYOK dogfood only and must not use secrets in automation. |
| Production release / marketplace claims | Blocked/deferred | Current artifacts and docs are dev-preview evidence only. They do not prove signing, notarization, publishing, marketplace listing readiness, installer readiness, production support, or production autonomy. |

## Blocked and deferred capabilities

These capabilities are explicitly not implemented as active Agent Run features:

- multi-step execution that sends, applies, verifies, repairs, retries, or rolls back across a plan;
- controlled autonomy or background agent loops;
- automatic repair, automatic retry, automatic verification, automatic rollback, or automatic follow-up sends;
- background workspace reads, recursive scanning, indexing, hidden context gathering, or file discovery;
- provider tool calling, local tool execution, shell, git, package manager, network, MCP, task-board, or integration execution authority;
- arbitrary file reads, create/delete/rename/move operations, apply-patch behavior, or silent workspace mutation;
- real-provider CI, credentialed automation, production account login automation, or provider-quality claims;
- production release, marketplace publication, signing, notarization, installer, update-channel, or release-candidate claims.

Documents, dogfood reports, test names, and UI copy should describe these as blocked, deferred, future, planned, or not implemented. They should not imply that S61/S62/S63 completed them. The small goblin in the wiring is allowed to stay asleep.

## Future controlled-autonomy eligibility gates

Controlled autonomy remains future-gated. Before any implementation can begin, a future architecture record and task plan must define and verify all of these criteria:

1. **Explicit opt-in**: the user must knowingly enable the autonomous mode for a bounded run. Manual Agent Run must remain the safe default.
2. **Disposable or sandbox workspace**: autonomous edits may run only in a disposable/sandbox workspace or an equivalent protected environment that cannot silently damage the user's main working tree.
3. **Checkpoint before mutation**: every mutation-capable run must create and verify a checkpoint before any apply operation.
4. **Rollback review path**: rollback must be available as user-reviewed recovery metadata and flow, not silent automatic mutation, unless a later policy explicitly proves safe rollback behavior.
5. **Allowlists**: allowed actions, files, command ids, tools, network behavior, provider use, and mutation types must be narrowly enumerated and fail closed.
6. **Sanitized evidence**: progress, reports, traces, errors, and dogfood artifacts must contain bounded metadata only, with no raw prompts, provider responses, file bodies, diffs, secrets, private paths, command strings, cwd/env, or bridge dumps.
7. **Proposal history**: the user must be able to review proposal lineage, accepted/rejected states, touched file labels, verification outcomes, and failed attempts without raw sensitive payloads.
8. **Failed verification recovery UX**: failed verification must stop in a clear user-visible state with safe recovery choices. Recovery must not become unbounded auto-repair or retry.
9. **Bounded storage and no raw persistence**: browser, GUI, engine, plugin, and report storage must be bounded and must not persist raw secrets, prompts, file bodies, diffs, verification output, or private paths.
10. **Cross-host parity**: browser, VS Code, and JetBrains status, unavailable states, confirmation boundaries, and safety copy must be consistent enough that unsupported hosts fail visibly rather than acting with broader authority.

Meeting these gates would only make controlled-autonomy design eligible for a future card. It would not by itself implement or approve autonomy.

## Reporting rules

When summarizing Agent Run readiness, use language such as:

- manual local dogfood dev-preview;
- mock/loopback-only smoke evidence;
- explicit user Send, Apply, and Verification;
- inert plan preview metadata;
- draft-only follow-up or fix prompt;
- future-gated controlled autonomy;
- blocked/deferred production release and marketplace claims.

Do not use language such as:

- autonomous Agent Run is ready;
- multi-step execution is implemented;
- automatic repair or rollback works today;
- Yet AI can index/read the workspace in the background for Agent Run;
- provider tools, shell, git, or arbitrary commands are available to the agent;
- real-provider CI proves Agent Run;
- browser, VS Code, or JetBrains Agent Run is production-ready;
- current artifacts have completed signing, publication, notarization, marketplace publication, or release publication.

## Verification

For this documentation milestone, run:

```sh
npm run check
```

For future behavior changes, use the focused Agent Run gates documented in `docs/README.md` and `003-target-architecture.md` for the changed surface. Keep those gates local/mock-only unless a future approved card explicitly changes the verification boundary.
