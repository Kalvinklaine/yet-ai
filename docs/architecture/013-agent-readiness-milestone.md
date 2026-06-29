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
| S65 coding task session backbone | Experimental manual-only | Coding task session snapshots are GUI-local metadata-only summaries of explicit goal/context/memory/proposal/apply/verification/trace labels. They do not add proposal history, guided fix loop, send/apply/verify authority, storage persistence, hidden reads, provider calls, or runtime/bridge endpoints. |
| S66 proposal history/comparison | Experimental manual-only | Proposal history and comparison summaries are GUI-local display metadata over already-known original/follow-up/rejected/applied/verified proposal states. They do not add apply or verification authority, proposal persistence, guided fix loops, runner behavior, storage persistence, hidden reads, provider calls, or runtime/bridge endpoints. |
| S67 guided fix loop | Experimental manual-only | Failed verification can expose sanitized guided-fix status and a draft-only fix CTA when safe prior proposal lineage exists. Clicking the CTA only writes composer text and focuses it; unsafe/raw-looking verification metadata blocks actionable drafting. It adds no auto-send, repair, retry, rollback, apply, verification, provider/tool execution, persistence, hidden reads, or runtime/bridge authority. |
| S68 safer apply UX | Experimental manual-only | Apply readiness and risk display may summarize sanitized proposal metadata, checkpoint/policy readiness, host support, disabled reasons, and manual recovery guidance. It does not expose raw replacement bodies, create apply authority, apply automatically, run verification, repair, retry, roll back, attach context, persist proposal bodies, or add runtime/bridge endpoints. |
| S69 task memory suggestions | Experimental manual-only | Task memory suggestions are GUI-local display metadata over already-listed local project memory note metadata. Safe suggested notes can be attached only by explicit user click through the existing one-shot project-memory bundle path; stale, unsafe, already-attached, or unrelated notes show labels/warnings only. Suggestion/session/trace labels do not become hidden runtime chat context and do not add auto-attach, search, save, provider, bridge, storage, hidden-read, indexing, or workspace mutation authority. |
| S71 multi-step task timeline | Experimental manual-only | The multi-step task timeline is read-only sanitized metadata UX over already-known Agent Run GUI state. It is not an execution engine and does not add autonomy, Send, Apply, Verification, repair, retry, rollback, provider/tool calls, hidden reads, runtime endpoints, bridge authority, browser-storage persistence, or raw-data persistence. |
| S72 checkpoint decision UX | Experimental manual-only | Checkpoint decision metadata can show continue, stop, rollback review, and separate manual run guidance over already-known Agent Run state. Rollback review remains review-only, separate manual run creates nothing, and no automatic Send, Apply, Verification, repair, retry, rollback, hidden read/search/indexing, memory attach, provider/tool call, runtime endpoint, bridge authority, storage persistence, production readiness, or autonomy is added. |
| S73 controlled workspace readiness | Experimental manual-only | Controlled workspace readiness renders future-gated metadata from `/v1/caps.controlledAgentWorkspaceReadiness` only. It can show opt-in, isolation, checkpoint, rollback, and limit status, but it cannot start an agent, create a worktree, read/search files, apply edits, run verification or shell commands, call providers/tools, use git, persist raw data, or add runtime/bridge/storage authority. |
| S74 bounded controlled file-read | Experimental manual-only | Controlled file-read evidence renders only sanitized metadata from `/v1/caps.controlledAgentFileRead` for one bounded explicit workspace-relative text read in a controlled workspace. It does not add hidden reads, search/indexing, raw body display, write/apply, command, provider/tool, bridge, runtime, storage, or autonomy authority. |
| S75 allowlisted command-runner evidence | Experimental manual-only | Controlled command evidence renders only sanitized allowlisted command-id metadata from `/v1/caps.controlledAgentCommandRunner` for trusted user/host-confirmed requests. It is not free-form shell or arbitrary command execution and adds no raw command/args/cwd/env, git/network/package/provider/tool, bridge run button, runtime endpoint, automatic verification, repair, retry, rollback, or autonomy authority. |
| Multi-step execution | Blocked/deferred | There is no implemented runner that executes a plan across multiple steps. S61 is only inert metadata. |
| Controlled autonomy | Blocked/deferred | No autonomous loop is implemented. Any future controlled-autonomy work must pass the future eligibility gates below before design or implementation. |
| Auto-repair / auto-retry / auto-rollback | Blocked/deferred | Failed verification can stop and may produce a draft-only prompt. The product must not claim automatic repair, retry, verification, or rollback. |
| Background reads or indexing | Blocked/deferred | Agent Run has no authority to scan workspaces, read hidden files, index in the background, or gather context without explicit user selection. |
| Provider/tool calling | Blocked/deferred | Agent Run does not grant provider tool calls, local tools, shell, git, MCP, task execution, package installs, network actions, or arbitrary runtime commands. |
| Real-provider CI | Blocked/deferred | CI and smokes remain mock/loopback/local deterministic. Real provider use is manual local BYOK dogfood only and must not use secrets in automation. |
| Production release / marketplace claims | Blocked/deferred | Current artifacts and docs are dev-preview evidence only. They do not prove signing, notarization, publishing, marketplace listing readiness, installer readiness, production support, or production autonomy. |

## Sprint 70 Manual Agent Run RC status

Sprint 70 is a manual local dogfood RC documentation and evidence pass only. It does not change the readiness taxonomy above and does not approve production, autonomy, marketplace readiness, release readiness, or real-provider CI.

Host boundaries for S70 RC evidence:

- **Browser / standalone GUI**: chat, provider setup/status, and dev-preview Agent Run review evidence only. Browser does not apply workspace edits, run verification commands, launch IDE actions, or prove production readiness.
- **VS Code**: primary manual local IDE dogfood host. It may provide evidence for explicit user Send, reviewed Apply through the existing confirmed host path, and allowlisted command-id Verification. It remains dev-preview and manual-only.
- **JetBrains**: dev-preview parity host. It may provide hosted GUI and bridge parity evidence for manual controls and boundaries, but it is not a production parity or marketplace publication claim.

Use `docs/dogfood/manual-agent-run-rc.md` for the S70 checklist and sanitized report template. The exact RC commands are `npm run check`, `npm run report:agent-run-rc -- --template`, `npm run report:agent-run-rc -- --check path/to/local-report.md`, optional `npm run report:agent-run-rc -- --self-test`, and optional `npm run smoke:agent-run-rc-bundle`. Completed reports must omit secrets, raw prompts, provider responses, file bodies, diffs, patch bodies, command strings, cwd/env values, private paths, browser-storage dumps, and bridge payload dumps.

## Sprint 71 multi-step task timeline status

Sprint 71 adds the multi-step task timeline as a read-only, sanitized, metadata-only GUI panel for the manual Agent Run path. It summarizes only already-known GUI metadata such as goal/context labels, proposal status, explicit Apply and Verification request/result labels, follow-up or fix draft status, and final result labels. It does not persist raw data or timeline entries to browser storage, engine state, host storage, project files, telemetry, logs, or provider/runtime storage.

S71 does not change the readiness taxonomy and does not approve multi-step execution, controlled autonomy, production readiness, marketplace readiness, release readiness, or real-provider CI. The timeline is not an execution engine, task runner, scheduler, replay system, bridge command, runtime endpoint, storage contract, or provider/tool surface. It adds no auto-send, auto-apply, automatic verification, automatic repair, automatic retry, automatic rollback, hidden reads, workspace indexing, shell/git/tool/provider authority, browser-storage raw persistence, or workspace mutation authority.

The exact S71 focused smoke is:

```sh
npm run smoke:multi-step-task-timeline
```

T-315 is the replacement smoke evidence for the failed T-312 attempt; T-312 must not be referenced as a successful smoke. Focused S71 behavior checks are:

```sh
cd apps/gui && npm test -- multiStepTaskTimeline MultiStepTaskTimelinePanel App
npm run check
```

These commands are local/mock or repository validation evidence only. They do not launch real IDE automation, call real providers, require credentials, contact hosted Yet AI services, persist raw timeline data, mutate workspaces through the timeline, or prove production autonomy.

## Sprint 72 checkpoint decision UX status

Sprint 72 adds manual checkpoint decision metadata for the existing manual Agent Run path. It renders sanitized guidance for continue, stop, rollback review, and separate manual run outcomes in the Agent Run panel, coding task session summary, timeline, and trace metadata. The decision data is display-only over already-known GUI state: it does not create a new runtime endpoint, bridge message, storage contract, model/provider call, execution loop, task runner, scheduler, rollback request, or separate run.

S72 does not change the readiness taxonomy and does not approve controlled autonomy, multi-step execution, production readiness, marketplace readiness, release readiness, or real-provider CI. Continue means the user may keep working in the current checkpoint by explicit choice only. Rollback remains review-only through the existing manual review path. Separate manual run is guidance only and creates nothing. Stop is fail-closed guidance when metadata is unsafe or authority-like.

The exact S72 focused smoke is:

```sh
npm run smoke:agent-run-checkpoint-decision
```

The S72 documentation and smoke gate is:

```sh
npm run smoke:agent-run-checkpoint-decision && npm run check && git diff --check
```

These commands are local/mock or repository validation evidence only. They do not launch real IDE automation, call real providers, require credentials, contact hosted Yet AI services, mutate workspaces except through explicitly mocked host messages, persist raw data, or prove production autonomy. S72 adds no auto-send, auto-apply, automatic verification, automatic repair, automatic retry, automatic rollback, hidden reads/search/indexing, hidden memory attach, provider/tool calls, shell/git authority, browser-storage raw persistence, workspace mutation authority, or raw prompt/file/diff/command/output/private-path/secret exposure.

## Sprint 73 controlled workspace readiness status

Sprint 73 adds a controlled workspace readiness panel for future local controlled-agent work. The panel consumes only `/v1/caps.controlledAgentWorkspaceReadiness` metadata and stays future-gated: it evaluates whether user opt-in, isolated workspace/worktree metadata, verified checkpoint metadata, rollback-plan metadata, bounded limits, and all-false policy flags are present, then renders sanitized display state only.

S73 does not start an agent, create a worktree, create checkpoints, roll back, read files, search, index, attach context, apply edits, run verification, run shell commands, call providers/tools, use git, persist browser storage payloads, add runtime endpoints, add bridge messages, or grant execution authority. Browser preview remains unsupported for future controlled mode and must fail visibly as metadata-only. A future-ready fixture only means prerequisites are described for later review; it still has no Start Agent control and all authority flags remain false.

The exact S73 focused smoke is:

```sh
npm run smoke:controlled-agent-workspace-readiness
```

The S73 documentation and smoke gate is:

```sh
npm run smoke:controlled-agent-workspace-readiness && npm run check && git diff --check
```

These commands are deterministic local/mock evidence only. They build/load the GUI through loopback mocks and verify safe/inert defaults, explicit opt-in display readiness, blocked isolation/checkpoint/rollback prerequisites, no Start Agent or worktree-creation controls, no bridge apply/verify/read/search/rollback messages, no runtime tool/git/shell/provider endpoints, no non-loopback network, clean browser storage, and no private path, secret, raw prompt/file/diff/command/log leakage. They are not real-provider CI, worktree creation evidence, production readiness, marketplace readiness, multi-step execution, or autonomy approval.

## Sprint 73 final audit status

Sprint 73 is closed as a controlled workspace/worktree readiness metadata milestone after the final safety/product audit and full local verification pass. The audit found no high or critical issue in the S73 scope: the contract remains strict metadata-only prerequisite state, the evaluator is a pure fail-closed sanitizer, the panel is collapsed-by-default display-only UI, App wiring consumes only `/v1/caps.controlledAgentWorkspaceReadiness`, and the smoke remains standalone local/mock evidence.

This completion status confirms only future controlled-mode prerequisite readiness. A `ready_for_future_controlled_mode` state means user opt-in, host-owned isolated workspace/worktree metadata, verified checkpoint metadata, rollback-plan metadata, bounded limits, and all-false policy flags are present for later review; it still does not permit starting an agent or running any controlled-agent action.

S73 adds no agent start, worktree creation, file read/write/search/indexing, apply/edit execution, verification execution, rollback execution, hidden reads, shell/git/tool/provider authority, runtime endpoint, bridge message type, browser raw-data persistence, production readiness, marketplace readiness, real-provider CI, multi-step execution, or autonomy claim. S74 and later controlled local-agent work remain deferred until explicit future cards approve their narrower contracts, implementation, tests, and audit gates.

## Sprint 74 bounded file-read status

Sprint 74 adds the first narrow explicit bounded file-read authority for future controlled local-agent work, limited to an already controlled disposable workspace or worktree. The authority is intentionally small: one trusted GUI- or host-minted `controlled_agent_file_read` metadata envelope, one safe workspace-relative text path, text-only expectations, byte and line budgets up to 8192 bytes and 240 lines, optional body only when `budget.allowBody` is true, and sanitized disabled/blocked/success/truncated result metadata.

The S74 implementation remains split across strict contracts, a pure GUI evaluator, sanitized GUI/trace/session/timeline display, and a standalone local/mock smoke substrate. The evaluator performs no file I/O, bridge call, runtime call, provider call, persistence, or workspace mutation. GUI surfaces display only sanitized state, path label, counts, truncation, and hash evidence; raw file bodies are intentionally omitted from DOM-facing controlled-read evidence, trace, timeline, session metadata, reports, and browser storage. The smoke creates its own disposable sentinel-marked workspace and reports only sanitized metadata.

S74 does not create a production runtime endpoint, bridge message, file browser, workspace search, workspace index, provider context fetch, command runner, apply path, verification executor, or autonomous loop. It does not allow absolute paths, traversal, home/private paths, hidden files, secret-like paths, dependency/build/generated paths, globs, regex, recursive search, background indexing, binary reads, symlink traversal, oversized bodies, assistant-minted request ids, raw data leakage, or command/cwd/env/git/tool/provider fields. All write, shell, git, tool, provider, auto-start, auto-apply, auto-run, rollback, hidden-read, and broad-context authority remains absent.

The S74 final audit found no high or critical issue in the bounded file-read scope: contracts fail closed for unsafe examples, the GUI evaluator is pure metadata evaluation, the panel is collapsed and metadata-only, App wiring consumes only `/v1/caps.controlledAgentFileRead` metadata, the smoke is standalone local/mock evidence, and local-first BYOK remains unchanged. Core workflows still require no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, or real-provider CI.

The exact S74 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentFileRead ControlledAgentWorkspaceReadinessPanel controlledAgentWorkspaceReadiness codingSessionTrace App && npm run build && cd ../.. && npm run smoke:controlled-agent-file-read && npm run check && git diff --check && git status --short
```

S75 and later capabilities remain deferred until explicit future cards define their contracts, implementation, tests, and audits. In particular, S74 does not implement command execution, write/apply flows, provider/tool calling, multi-step execution, automatic repair/retry/rollback, or controlled autonomy.

## Sprint 75 allowlisted command-runner contract status

Sprint 75 adds the `controlled_agent_command_runner` contract as a verification foundation only for future controlled local-agent work. The contract is intentionally limited to one trusted GUI- or host-minted metadata envelope, explicit user/host request correlation, controlled workspace/run ids, one fixed allowlisted `commandId` (`repository-check`, `gui-app-tests`, or `engine-chat-tests`), bounded timeout and output-tail limits, all-false non-command-id authority flags, and sanitized disabled/blocked/running/succeeded/failed/timed-out/killed result metadata.

The S75 implementation remains split across strict contracts, a pure GUI evaluator, collapsed display-only GUI/trace/session/timeline evidence, and a deterministic local smoke. App wiring consumes only `/v1/caps.controlledAgentCommandRunner` metadata. The evaluator performs no process spawn, bridge call, runtime call, provider call, file I/O, persistence, workspace mutation, or browser-storage write. GUI surfaces render sanitized command id, label, status, limits, exit code, duration, counts, truncation, hash, and bounded output-tail evidence only; raw command strings, args, cwd, env, stdout/stderr dumps, private paths, secrets, provider/tool payloads, and bridge payloads are intentionally omitted.

The deterministic smoke is `npm run smoke:controlled-agent-command-runner`. It uses an internal allowlist map from the three S75 command ids to deterministic local Node actions, then verifies allowed success, failure, and timeout/kill metadata plus fail-closed unknown command, raw command, cwd, env, timeout, and output-limit cases. Its report is sanitized bounded metadata only and is not a product runtime, shell gateway, package-manager path, provider tool call, git action, or broad agent loop.

S75 does not implement a runtime endpoint, bridge message, shell runner, git action, package manager, network call, provider/tool call, file read/write path, automatic verification, repair, retry, rollback, multi-step execution, or controlled autonomy. It is not a free-form command/cwd/env/args contract and it does not allow model-provided commands. Raw command strings, args, cwd, env, shell/git/network/provider/tool fields, unknown command ids, assistant-minted request ids, unbounded timeout/output limits, private-path or secret-looking output, and auto-run authority claims are invalid fixtures that must fail closed.

The S75 final audit found no high or critical issue in the allowlisted command-id scope: contracts reject unsafe examples, the GUI evaluator is pure metadata evaluation, the panel has no action controls, App wiring uses only runtime caps metadata, command evidence is sanitized and bounded, and local-first BYOK remains unchanged. Core workflows still require no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, or real-provider CI. S76+ loop, edit, repair, retry, rollback, provider-tool, and controlled-autonomy capabilities remain deferred until explicit future cards define and verify them.

The exact S75 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentCommandRunner agentRunVerification codingSessionTrace App && npm run build && cd ../.. && npm run smoke:controlled-agent-command-runner && npm run check && git diff --check && git status --short
```

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

## Sprint 64 final audit status

Sprint 64 is closed as a status and readiness audit milestone after the final local verification pass. The audit found no high or critical Agent Run safety issue in the S64 scope: no new bridge message, runtime endpoint, hidden read, background indexing, search authority, auto-send, auto-apply, auto-verification, auto-repair, auto-retry, or auto-rollback behavior was introduced.

This completion status is documentation and local/mock verification evidence only. It confirms that the current manual Agent Run boundaries remain accurately described for browser, VS Code, and JetBrains dev-preview surfaces; it does not approve production release, marketplace readiness, real-provider CI, multi-step execution, controlled autonomy, provider/tool calling, shell/git/tool authority, hidden workspace reads, or autonomous recovery.

## Sprint 65 final audit status

Sprint 65 is closed as a coding task session backbone milestone after the focused final local verification pass. The audit found no high or critical safety issue in the S65 scope: the snapshot remains GUI-local metadata-only state, the smoke remains explicit and outside `npm run check`, and no new bridge message, runtime endpoint, browser-storage persistence, hidden read, shell/git/tool/provider authority, auto-send, auto-attach, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, proposal history, or guided fix loop was introduced.

This completion status is local/mock verification evidence only. It confirms that the S65 coding task session surface accurately summarizes explicit manual workflow metadata without expanding Agent Run authority; it does not approve production release, marketplace readiness, real-provider CI, multi-step execution, controlled autonomy, provider/tool calling, shell/git/tool authority, hidden workspace reads, or autonomous recovery.

## Sprint 66 proposal history boundary

Sprint 66 proposal history and comparison remains an experimental manual-only display metadata surface. It may summarize original, follow-up, rejected, user-applied, and explicitly verified proposal states for review, but it does not persist proposals, make actions runnable, create apply or verification readiness, draft fixes, run a loop, or grant new runtime/bridge/provider/storage authority.

The focused local smoke is `npm run smoke:proposal-history`. It is deterministic local/mock evidence only: it transpiles the pure GUI service and asserts metadata-only authority, conservative no-authority flags, bounded output, redaction, and no raw payload leakage. It is not real-provider CI, production autonomy, proposal storage, marketplace/release evidence, or proof that multi-step execution exists.

## Sprint 66 final audit status

Sprint 66 is closed as a proposal history and comparison metadata milestone after the focused final local verification pass. The audit found no high or critical safety issue in the S66 scope: proposal history remains display-only sanitized metadata, the smoke remains explicit local/mock evidence, and no new bridge message, runtime endpoint, browser-storage persistence, hidden read, shell/git/tool/provider authority, auto-send, auto-attach, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, proposal persistence, guided fix loop, raw payload leakage, or controlled-autonomy behavior was introduced.

This completion status is local/mock verification evidence only. It confirms that S66 helps compare proposal lineage without expanding Agent Run authority; it does not approve production release, marketplace readiness, real-provider CI, multi-step execution, controlled autonomy, provider/tool calling, shell/git/tool authority, hidden workspace reads, or autonomous recovery.

## Sprint 67 guided fix loop boundary

Sprint 67 guided fix loop remains an experimental manual-only failed-verification recovery surface. It may show sanitized status, reason, CTA text, lineage labels, and proposal-history correlation after an explicit user-run verification fails. The fix CTA is draft-only: it writes a bounded prompt into the existing composer and focuses it for user review; it does not send chat, apply edits, run verification, attach context, save memory, repair, retry, roll back, persist raw data, call providers/tools, or add runtime/bridge authority.

The focused local smoke is `npm run smoke:agent-run-guided-fix-loop`. It is deterministic local/mock evidence only: it builds the GUI, serves it from loopback, drives an explicit model proposal/apply/verification fixture, asserts the failed-verification fix prompt remains unsent, and asserts unsafe raw-looking verification metadata blocks actionable guided-fix behavior. It is not real-provider CI, autonomous repair, production readiness, marketplace/release evidence, or proof that controlled autonomy exists.

## Sprint 67 final audit status

Sprint 67 is closed as a guided fix loop dev-preview milestone after the focused final safety audit. The audit found no high or critical safety issue in the S67 scope: guided fix status is derived from sanitized Agent Run verification, proposal-history, session, and draft metadata; fix drafting writes only the composer for user review; unsafe raw-looking verification metadata blocks actionable drafting; and the built-GUI smoke covers both the manual happy path and the unsafe/no-auto path.

This completion status is local/mock verification evidence only. It confirms that S67 preserves the manual Agent Run boundary with no auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden reads, indexing, search, shell/git/tool/provider authority, raw prompt/provider/file/diff/command/log browser-storage persistence, new runtime/bridge authority, production readiness, or controlled-autonomy approval.

## Sprint 68 safer apply UX boundary

Sprint 68 safer apply UX remains an experimental manual-only review surface. It may show apply readiness/risk status, sanitized file labels, edit counts, readiness items, disabled reasons, risk badges, and manual recovery guidance derived from sanitized proposal, Agent Run, checkpoint, policy, host, and pending-action metadata. It is review/display guidance only: replacement bodies remain outside the display summary, and rejected or unsafe proposals fail closed with no apply action.

The focused local smoke is `npm run smoke:agent-run-safer-apply-ux`. It is deterministic local/mock evidence only: it builds the GUI, serves it from loopback, drives ready, blocked checkpoint/policy, browser-preview, rejected/malformed, and unsafe/no-leak states, and asserts that no apply or verification request is posted before the existing explicit user action. It is deliberately included in `npm run smoke:agent-run-safety-bundle` because it guards the same manual no-auto apply boundary and remains local/mock-only. It is not real-provider CI, production readiness, autonomous apply, release-candidate evidence, marketplace evidence, or proof that controlled autonomy exists.

Sprint 68 safer apply UX does not add auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden reads, indexing, search, provider/tool execution, shell/git authority, attach behavior, browser-storage persistence of raw prompts/files/diffs/proposals/commands, new runtime endpoints, or new bridge authority. Future S70 release-candidate bundling may revisit broader bundle composition, but this S68 gate is already safe to keep in the local safety regression bundle.

## Sprint 68 final audit status

Sprint 68 is closed as a safer apply UX review milestone after the focused final safety audit. The audit found no high or critical safety issue in the S68 scope: apply readiness remains display-only sanitized metadata, rejection recovery remains manual guidance, the apply button remains no broader than the existing supported-host, no-pending-request, `confirm_apply` gate, and the smoke coverage exercises ready, blocked/browser-preview, rejected, and unsafe/no-leak states.

This completion status is local/mock verification evidence only. It confirms that S68 preserves the manual Agent Run boundary with no auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden reads, indexing, search, shell/git/tool/provider authority, raw prompt/provider/file/diff/command/log browser-storage persistence, new runtime/bridge authority, production readiness, or controlled-autonomy approval.

## Sprint 69 task memory suggestions boundary

Sprint 69 task memory suggestions remain an experimental manual-only display surface. They may summarize safe metadata overlap between the current task/session/proposal labels and already-listed local project memory notes. Safe `suggested` notes can be attached only by an explicit user click, which uses the existing one-shot project-memory bundle path. Stale, unsafe, already-attached, and unrelated notes are warning or status labels only and must not expose unsafe note text.

The focused local smoke is `npm run smoke:task-memory-suggestions`. It is deterministic local/mock evidence only: it transpiles GUI services, builds suggested/stale/unsafe/already-attached/unrelated mock notes, asserts no auto-attach before click, checks explicit attach updates one-shot bundle plus sanitized session/trace labels, and verifies display-only task/session/trace labels are excluded from runtime chat context. It is not real-provider CI, memory indexing, production readiness, marketplace/release evidence, or proof that controlled autonomy exists.

Sprint 69 task memory suggestions do not add auto-send, auto-attach, auto-save, auto-search, provider calls, runtime calls, bridge calls, hidden reads, indexing, shell/git/tool authority, workspace mutation, browser-storage persistence of raw memory text or suggestion metadata, new runtime endpoints, production readiness, or controlled-autonomy approval.

## Sprint 69 final audit status

Sprint 69 is closed as a task memory suggestions safety milestone after the focused final local verification pass. The audit found no high or critical safety issue in the S69 scope: suggestions remain bounded sanitized metadata/status labels over already-listed project memory notes; unsafe, stale, already-attached, and unrelated notes have no suggestion attach action; and safe `suggested` notes enter runtime chat context only after an explicit user Attach click through the existing one-shot project-memory bundle path.

This completion status is local/mock verification evidence only. It confirms that S69 preserves the manual Agent Run boundary with no hidden memory attach, auto-send, auto-apply, auto-verification, auto-repair, auto-rollback, hidden reads, indexing, search, shell/git/tool/provider authority, raw prompt/provider/file/diff/command/log/browser persistence, runtime/bridge expansion, production readiness, or controlled-autonomy approval. Display-only task, session, trace, and suggestion labels remain sanitized metadata and are stripped from runtime chat context.

## Sprint 70 final audit status

Sprint 70 is closed as a Manual Agent Run RC documentation, local/mock smoke, and final safety audit milestone after the full S70 verification pass. The audit found no high or critical safety issue in the S70 scope: the RC report helper is a template/sanitizer only, the RC smoke bundle aggregates existing local/mock evidence only, and browser, VS Code, and JetBrains surfaces remain manual dev-preview evidence with explicit user Send, Apply, Verification, memory Attach, snippet search, follow-up/fix draft, and rollback review controls.

This completion status is local/mock verification evidence only. It confirms that S70 preserves the manual Agent Run boundary with no auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden memory attach, hidden reads, search or indexing, shell/git/tool/provider authority, raw prompt/provider/file/diff/command/log/browser persistence, production readiness, publication readiness, real-provider CI, or controlled-autonomy approval. T-95, T-98, and T-244 remain triaged stale, superseded, or non-blocking for S70 unless a future audit reopens them with current evidence.

## Sprint 71 final audit status

Sprint 71 is closed as a read-only multi-step task timeline UX milestone after the full S71 verification pass. The final audit found no high or critical safety issue in the S71 scope: the timeline service remains a pure bounded metadata formatter, the panel remains collapsed-by-default and display-only with no action buttons, App wiring passes already-known React metadata only, and the focused smoke remains the standalone T-315 replacement for the failed T-312 attempt.

This completion status is local/mock verification evidence only. It confirms that S71 preserves the manual Agent Run boundary with no auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden memory attach, hidden reads/search/indexing, shell/git/tool/provider authority, raw prompt/provider/file/diff/command/log/browser persistence, runtime/bridge/storage expansion, production readiness, publication readiness, real-provider CI, or controlled-autonomy approval. S72 and later controlled local-agent work remain deferred behind future explicit cards and readiness decisions.

## Sprint 72 checkpoint decision smoke and docs status

Sprint 72 checkpoint decision docs and smoke are focused on experimental manual-only UX. The local/mock smoke covers continue, stop, rollback review, and separate manual run checkpoint decisions with sanitized metadata. It verifies rollback review stays review-only, separate manual run creates nothing, existing Apply and Verification bridge messages occur only after explicit user clicks, and no automatic send/apply/verification/repair/retry/rollback, hidden reads/search/indexing, hidden memory attach, raw-data persistence, new runtime/bridge/storage authority, production readiness, real-provider CI, or controlled-autonomy approval is introduced.

## Sprint 72 final audit status

Sprint 72 is closed as an experimental manual checkpoint decision UX milestone after the final safety/product audit and full local verification pass. The audit found no high or critical issue in the S72 scope: checkpoint decisions remain sanitized display metadata over already-known GUI state, rollback is review-only through the existing manual review path, separate manual run is guidance only and creates nothing, and continue is only a manual recommendation after successful apply and verification metadata.

This completion status is local/mock verification evidence only. It confirms that S72 preserves the manual Agent Run boundary with no auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden reads/search/indexing, hidden memory attach, shell/git/tool/provider authority, raw prompt/provider/file/diff/command/output/private-path/secret/browser persistence, runtime/bridge/storage expansion, production readiness, publication readiness, real-provider CI, multi-step execution, or controlled-autonomy approval.

The exact S72 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- agentRunCheckpointDecision AgentRunPanel App multiStepTaskTimeline codingTaskSession && npm run build && cd ../.. && npm run smoke:agent-run-checkpoint-decision && npm run check && git diff --check && git status --short
```

## Verification

For this documentation milestone, run:

```sh
npm run check
```

For future behavior changes, use the focused Agent Run gates documented in `docs/README.md` and `003-target-architecture.md` for the changed surface. Keep those gates local/mock-only unless a future approved card explicitly changes the verification boundary.
