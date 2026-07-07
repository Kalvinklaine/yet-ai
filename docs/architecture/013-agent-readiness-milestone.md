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
| VS Code | Dogfood-ready dev-preview | VS Code is the primary manual local IDE dogfood host for explicit context and reviewed safe-edit apply. In S84 it is also the only real bounded controlled replacement-edit executor; controlled-agent verification posting/execution remains disabled until S85. It is not marketplace-ready, autonomous, or a production release surface. |
| JetBrains | Experimental manual-only | JetBrains has dev-preview hosted GUI and bridge parity evidence for manual controls. In S84 controlled replacement edits fail closed with sanitized `edit_disabled`, and controlled-agent verification posting/execution remains disabled until S85. It remains local dogfood evidence, not real production parity or autonomy. |
| One-step safe-edit proposal | Dogfood-ready dev-preview | A model response may be parsed as a strict bounded proposal for existing workspace-relative text replacements. It is review-only until the user explicitly applies it; unsafe or malformed proposals fail closed. |
| Explicit Apply | Dogfood-ready dev-preview | Apply is available only after proposal review and readiness metadata, through existing `gui.applyWorkspaceEditRequest` / `host.applyWorkspaceEditResult` with user confirmation. No auto-apply, create/delete/rename, shell, git, or hidden mutation authority is granted. |
| Explicit Verification | Blocked/deferred for S84 controlled Agent Run | Historical/manual sanitized verification evidence may still render, but S84 controlled Agent Run must not post `gui.ideActionRequest` with `runVerificationCommand` and must not execute verification commands. Real allowlisted controlled-agent verification execution is S85-required. |
| S61 inert plan preview | Experimental manual-only | Multi-step plan preview is metadata-only display: title, summary, step labels, risk labels, expected file labels, and allowlisted verification suggestions. It is not multi-step execution and cannot send, apply, verify, rollback, read files, call providers, schedule work, or mutate the workspace. |
| S62 follow-up/fix draft | Experimental manual-only | Follow-up and fix CTAs can draft sanitized composer text after explicit verification. They only write the composer and focus it; the user must review and click Send. No auto-send, repair, retry, rollback, context attachment, storage persistence, bridge request, or runtime execution is added. |
| S63 safety bundle | Dogfood-ready dev-preview verification aid | `npm run smoke:agent-run-safety-bundle` is an explicit local/mock regression bundle for manual Agent Run boundaries. It is not part of `npm run check`, not real-provider CI, and not production autonomy or release evidence. |
| S65 coding task session backbone | Experimental manual-only | Coding task session snapshots are GUI-local metadata-only summaries of explicit goal/context/memory/proposal/apply/verification/trace labels. They do not add proposal history, guided fix loop, send/apply/verify authority, storage persistence, hidden reads, provider calls, or runtime/bridge endpoints. |
| S66 proposal history/comparison | Experimental manual-only | Proposal history and comparison summaries are GUI-local display metadata over already-known original/follow-up/rejected/applied/verified proposal states. They do not add apply or verification authority, proposal persistence, guided fix loops, runner behavior, storage persistence, hidden reads, provider calls, or runtime/bridge endpoints. |
| S67 guided fix loop | Experimental manual-only | Failed verification can expose sanitized guided-fix status and a draft-only fix CTA when safe prior proposal lineage exists. Clicking the CTA only writes composer text and focuses it; unsafe/raw-looking verification metadata blocks actionable drafting. It adds no auto-send, repair, retry, rollback, apply, verification, provider/tool execution, persistence, hidden reads, or runtime/bridge authority. |
| S68 safer apply UX | Experimental manual-only | Apply readiness and risk display may summarize sanitized proposal metadata, checkpoint/policy readiness, host support, disabled reasons, and manual recovery guidance. It does not expose raw replacement bodies, create apply authority, apply automatically, run verification, repair, retry, roll back, attach context, persist proposal bodies, or add runtime/bridge endpoints. |
| S109 authority registry evidence | Experimental manual-only | The controlled Agent Run surface may show compact sanitized status from `docs/architecture/018-controlled-agent-authority-registry.md` and the S109 registry fixture. This status is registry evidence only: it is not a button, permission grant, bridge request, runtime/provider call, workspace read/search, edit/apply, verification, storage write, production claim, or host-parity claim. Browser remains unsupported for trusted execution and JetBrains remains fail-closed until separately verified. |
| S109-S112 controlled lexical search Phase 1 | Experimental manual-only | Phase 1 establishes explicit bounded lexical search foundations: S109 authority vocabulary, S110 contracts/pure GUI request-result checks, S111 VS Code-only executor evidence, and S112 GUI-local explicit result selection. Safe results can be user-selected and summarized, but the selected context is not auto-attached or sent to a provider. Browser remains unsupported for trusted workspace search, JetBrains remains fail-closed, and this is not production, autonomy, release, provider-proposal, or cross-host parity readiness. |
| S69 task memory suggestions | Experimental manual-only | Task memory suggestions are GUI-local display metadata over already-listed local project memory note metadata. Safe suggested notes can be attached only by explicit user click through the existing one-shot project-memory bundle path; stale, unsafe, already-attached, or unrelated notes show labels/warnings only. Suggestion/session/trace labels do not become hidden runtime chat context and do not add auto-attach, search, save, provider, bridge, storage, hidden-read, indexing, or workspace mutation authority. |
| S71 multi-step task timeline | Experimental manual-only | The multi-step task timeline is read-only sanitized metadata UX over already-known Agent Run GUI state. It is not an execution engine and does not add autonomy, Send, Apply, Verification, repair, retry, rollback, provider/tool calls, hidden reads, runtime endpoints, bridge authority, browser-storage persistence, or raw-data persistence. |
| S72 checkpoint decision UX | Experimental manual-only | Checkpoint decision metadata can show continue, stop, rollback review, and separate manual run guidance over already-known Agent Run state. Rollback review remains review-only, separate manual run creates nothing, and no automatic Send, Apply, Verification, repair, retry, rollback, hidden read/search/indexing, memory attach, provider/tool call, runtime endpoint, bridge authority, storage persistence, production readiness, or autonomy is added. |
| S73 controlled workspace readiness | Experimental manual-only | Controlled workspace readiness renders future-gated metadata from `/v1/caps.controlledAgentWorkspaceReadiness` only. It can show opt-in, isolation, checkpoint, rollback, and limit status, but it cannot start an agent, create a worktree, read/search files, apply edits, run verification or shell commands, call providers/tools, use git, persist raw data, or add runtime/bridge/storage authority. |
| S74 bounded controlled file-read | Experimental manual-only | Controlled file-read evidence renders only sanitized metadata from `/v1/caps.controlledAgentFileRead` for one bounded explicit workspace-relative text read in a controlled workspace. It does not add hidden reads, search/indexing, raw body display, write/apply, command, provider/tool, bridge, runtime, storage, or autonomy authority. |
| S75 allowlisted command-runner evidence | Experimental manual-only | Controlled command evidence renders only sanitized allowlisted command-id metadata from `/v1/caps.controlledAgentCommandRunner` for trusted user/host-confirmed requests. It is not free-form shell or arbitrary command execution and adds no raw command/args/cwd/env, git/network/package/provider/tool, bridge run button, runtime endpoint, automatic verification, repair, retry, rollback, or autonomy authority. |
| S76 controlled run state skeleton | Experimental manual-only | Controlled run state records deterministic metadata-only phases, bounded counters, readiness correlation, stop reasons, and sanitized details for a future state machine. It does not start an agent, execute a loop, read files, apply edits, run verification, repair, retry, roll back, call providers/tools, add runtime/bridge authority, or provide real agent autonomy yet. |
| S77 controlled edit executor contract | Experimental manual-only | Controlled edit executor records replacement-edit metadata only for existing workspace-relative files: expected hashes, bounded ranges, replacement byte counts, and sanitized summaries. It does not create/delete/rename files, expose raw replacement bodies/diffs/patches, add shell/git/provider/tool authority, add runtime/bridge endpoints, or claim broad write/apply/autonomy. |
| S79 controlled progress/final report | Experimental manual-only | Controlled progress/final report evidence renders sanitized metadata only from existing GUI controlled-run state, edit metadata, command metadata, and repair metadata. It records phase labels, counters, limits, diagnostics, terminal final-report summaries, and all-false authority flags; it does not start an agent, execute a loop, persist raw prompts/files/diffs/commands, add bridge/runtime authority, or claim autonomy. |
| S80 controlled local agent MVP dev-preview evidence | Experimental manual-only | Controlled local agent MVP evidence composes explicit user opt-in, controlled workspace readiness, bounded read metadata, edit metadata, allowlisted verification metadata, repair metadata, and progress/final-report metadata into sanitized checklist/status labels. It is local/mock dogfood evidence only and does not start an agent, call providers/tools, read/search/index hidden workspace data, mutate workspaces, run shell/free-form commands, persist raw prompts/files/diffs/commands, add runtime/bridge authority, prove real-provider CI, or claim production autonomy. |
| S82 controlled runtime session metadata | Experimental manual-only | Controlled runtime session evidence adds a sanitized metadata envelope for future lifecycle/precondition status only. Browser remains unsupported; VS Code and JetBrains are future-capable only when metadata preconditions are present. It does not start an agent, implement a real one-step model loop, execute reads/edits/verification/provider calls, or replace the S83 requirement for real bounded read execution. |
| S83 real bounded controlled file-read execution | Experimental manual-only | S83 adds one explicit user-clicked and correlated controlled workspace text-read request path, with real execution in the VS Code host only. Browser remains unsupported and JetBrains fails closed/unsupported. It adds no hidden/background reads, search, indexing, provider/model call, edit/write/apply, verification execution, shell/git/package/network/tool authority, raw-body persistence, or autonomy. S84 remains required for real bounded edit execution; S86 remains the earliest honest one-step controlled-autonomy milestone. |
| S84 real bounded controlled replacement edit execution | Experimental manual-only | S84 adds real bounded controlled replacement edit execution for existing workspace-relative text files through explicit GUI request/click/correlation and expected `sha256:` content hash checks. VS Code is the real executor; browser remains unsupported and JetBrains fails closed with `edit_disabled`. It adds no create/delete/rename/move/chmod/binary/symlink edits, hidden/background edits, provider/model call, verification execution, shell/git/package/network/tool authority, raw file body/diff/replacement persistence, or autonomy. S85 remains required for real allowlisted verification execution, and S86 remains the earliest honest one-step controlled-autonomy milestone. |
| S85 real allowlisted controlled verification execution | Experimental manual-only | S85 adds real allowlisted controlled Agent Run verification execution in VS Code only through explicit user click and `gui.controlledAgentCommandRunRequest` / `host.controlledAgentCommandRunResult`. The GUI request is GUI-minted, correlated to controlled runtime/workspace/readiness/run metadata, and carries one fixed allowlisted `commandId` with bounded timeout/output-tail limits and no command string, args, cwd, env, shell, git, network, provider/tool, file read/write, hidden search/indexing, package install, auto-run, auto-verify, or auto-fix authority. Browser is unsupported and JetBrains remains fail-closed/unsupported for controlled verification execution. Results are sanitized tail-only metadata. S85 adds no repair, retry, rollback, provider/model loop, arbitrary command execution, production autonomy, or real-provider CI; S86 remains the earliest honest one-step controlled-autonomy milestone. |
| S86 one-step controlled loop | Experimental controlled-autonomy preview | S86 is the first intentionally named one-step experimental controlled-autonomy milestone. Its contract is metadata-only and starts only from explicit user confirmation, then records at most one bounded read, one sanitized proposal step, one bounded replacement-edit metadata step, one allowlisted verification metadata step, and a terminal report. It is not production autonomy and grants no auto-repair, free-form command, hidden read/search/indexing, raw prompt/file/diff/output persistence, unbounded edit, git, package, network, provider, or tool authority. |
| S87 bounded repair loop eligibility/UX | Experimental controlled-autonomy preview contract | S87 extends the one-step metadata contract to display eligibility for at most one explicit user-confirmed bounded repair attempt after a failed allowlisted verification. It records attempt budgets, previous verification summary, repair proposal/edit/verification summaries, panel eligibility evidence, and stop reason only. It does not grant automatic repair, multiple repairs, free-form commands, raw output/diff persistence, hidden reads/search, git, package, network, provider, or tool authority. |
| Multi-step execution | Blocked/deferred | There is no implemented runner that executes a plan across multiple steps. S61 is only inert metadata. |
| Controlled autonomy beyond the S86 one-step preview | Blocked/deferred | Broader autonomous loops remain unimplemented. Any future controlled-autonomy work beyond the S86 one-step experimental preview must pass the future eligibility gates below before design or implementation. |
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

## Sprint 76 controlled run state contract status

Sprint 76 closes as a controlled run state skeleton milestone only. The `controlled_agent_run_state` contract records deterministic metadata for `idle`, `opt_in_required`, `workspace_ready`, `reading_context`, `planning`, `waiting_for_user`, `running_verification`, `stopping`, `stopped`, `blocked`, `failed`, and `completed`, with controlled workspace/run/readiness correlation, bounded run limits, bounded counters, sanitized details, and explicit stop reasons for interrupted or failed states.

The implementation remains split across strict contracts, a pure GUI reducer, a preview-only panel with a visible local Stop control, App wiring over existing `/v1/caps` metadata, focused GUI tests, and a built-GUI local/mock smoke. The reducer composes existing readiness, bounded file-read, and allowlisted command-runner metadata evaluators; it does not perform file I/O, spawn processes, call a runtime endpoint, post bridge requests, call providers, write browser storage, or mutate a workspace. The panel renders sanitized phase, current step, limits, counters, diagnostics, stop reason, and all-false authority flags only.

S76 does not implement the real controlled-agent loop. It grants no edit executor, real command runner endpoint, provider loop, agent start, auto-start, hidden file read/search/indexing, file write, apply/edit execution, verification execution, repair, retry, rollback, shell, git, network, package-manager, provider/tool call, runtime endpoint, bridge message, storage authority, production readiness, or autonomous behavior. Invalid fixtures and reducer guards reject assistant-minted authority, auto-action claims, shell/git/provider/tool flags, raw prompt/file/diff/command/log fields, unsafe details, unbounded limits, and stopped/blocked/failed states without explicit sanitized stop metadata.

The S76 final audit found no high or critical issue in the controlled run state skeleton scope: contracts reject unsafe examples, the reducer is pure and fail-closed, GUI state is local/metadata-only, Stop is local React state only, App wiring uses existing capability metadata, the smoke blocks unsafe metadata and checks for no hidden bridge/runtime authority, and local-first BYOK remains unchanged. Core workflows still require no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, or real-provider CI. S77+ edit execution, verifier/repair loops, rollback behavior, provider-tool behavior, and controlled-autonomy capabilities remain deferred until explicit future cards define and verify them.

The exact S76 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentRunState ControlledAgentRunPanel controlledAgentFileRead controlledAgentCommandRunner App && npm run build && cd ../.. && npm run smoke:controlled-agent-run-state && npm run check && git diff --check && git status --short
```

## Sprint 77 controlled edit executor contract boundary

Sprint 77 adds the `controlled_agent_edit_executor` contract boundary as replacement-edit metadata only for future controlled local-agent work. It can describe existing workspace-relative files, expected pre-edit content hashes, bounded line ranges, replacement byte counts, sanitized summaries, trusted request correlation, explicit user confirmation, and bounded file/edit/byte limits.

S77 does not implement an edit executor, write-capable runtime endpoint, bridge message, broad apply path, file browser, search/index feature, verifier, repair loop, rollback executor, provider/tool call, shell, git, package manager, network action, multi-step execution, production agent behavior, or controlled autonomy. It does not allow create, delete, rename, move, arbitrary write, raw replacement body, raw diff, raw patch, raw file body, raw prompt, raw command/log, private path, secret, command/cwd/env, shell/git/tool/provider, auto-apply, auto-run, auto-repair, auto-rollback, or assistant-minted authority claims.

The S77 contract is a safety vocabulary for later review. A `planned` or `applied` metadata state is evidence that bounded replacement-edit metadata was described or recorded after explicit confirmation; it is not proof that a product runtime can apply edits autonomously and must not be presented as broad workspace mutation authority.

## Sprint 79 controlled progress/final report boundary

Sprint 79 adds controlled progress/final report metadata for the future controlled local-agent path. The GUI service and panel consume already-known controlled-run state plus bounded edit, command, and repair metadata, then render only sanitized phase labels, current-step labels, counters, limits, diagnostics, terminal final-report summaries, and all-false authority flags.

S79 does not implement real autonomous execution, a provider loop, an agent starter, a runtime endpoint, a bridge message, browser-storage persistence, raw report persistence, file read/write authority, apply authority, verification execution, repair/retry behavior, rollback behavior, shell/git/tool/provider authority, task-board mutation, production agent behavior, or controlled autonomy. Raw prompts, file bodies, diffs, replacement bodies, command strings, cwd/env, raw output/logs, provider/tool payloads, private paths, and secrets must stay out of progress and final report metadata.

The exact S79 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm run typecheck && npm run build && cd ../.. && npm run smoke:controlled-agent-progress-report && npm run check && git diff --check && git status --short
```

This gate is deterministic local/mock evidence only. The focused smoke transpiles the pure GUI service and verifies disabled, running, stopped, failed, repair-exhausted blocked, completed, unsafe-redacted, terminal final-report, sanitized diagnostic, bounded counter/limit, and fail-closed authority-flag behavior. It is not real-provider CI, production readiness, marketplace readiness, multi-step execution, or autonomy approval.

## Sprint 80 controlled local agent MVP dev-preview evidence

Sprint 80 adds controlled local agent MVP dev-preview evidence as metadata composition only. The GUI service consumes already-known explicit user opt-in, controlled workspace readiness, bounded file-read metadata, controlled edit metadata, allowlisted command-id verification metadata, repair metadata, and controlled progress/final-report metadata, then renders sanitized status labels, checklist state, diagnostics, safety flags, and terminal final-report summaries.

S80 is local/mock dogfood evidence, not production autonomy. It does not implement a real controlled-agent loop, provider loop, agent starter, runtime endpoint, bridge message, hidden workspace read/search/indexing, broad workspace mutation, shell/free-form command execution, git/package/network authority, provider/tool calling, task-board mutation, browser-storage persistence, raw report persistence, real-provider CI, marketplace readiness, or production readiness. Raw prompts, file bodies, diffs, replacement bodies, command strings, cwd/env, raw output/logs, provider/tool payloads, private paths, and secrets must stay out of MVP labels, checklists, diagnostics, and final reports.

The exact focused S80 smoke is:

```sh
npm run smoke:controlled-local-agent-mvp
```

The S80 documentation-only gate is:

```sh
npm run check && git diff --check
```

This evidence remains deterministic and local/mock-only. The focused smoke transpiles the pure GUI aggregation service and verifies disabled, blocked no-workspace, ready preview, running metadata flow, completed/stopped final reports, repair exhaustion, unsafe raw-marker fail-closed behavior, and all-false authority flags. It is not real-provider CI, production readiness, marketplace readiness, multi-step execution, or autonomy approval.

## Sprint 80 final S74-S80 audit status

Sprint 80 closes the S74-S80 controlled local-agent evidence trail as a dev-preview, local/mock-only metadata milestone. The final audit found no high or critical issue in the S74 bounded file-read, S75 allowlisted command-runner, S76 controlled run-state skeleton, S77 edit-executor metadata boundary, S79 progress/final-report metadata, or S80 MVP composition scope: each layer remains sanitized evidence over explicit opt-in and already-known capability metadata, with all authority flags fail-closed and no raw prompt, file body, diff, replacement body, command string, cwd/env, provider/tool payload, private path, or secret persistence.

Known deferred gaps remain explicit. Before S81, S77 had contract and metadata boundary evidence while its dedicated standalone smoke remained deferred. S78 actual auto-repair execution is still not implemented; repair evidence is metadata-only and may stop or report exhaustion without running an automatic fix loop. S80 does not approve production autonomy: there is still no real controlled-agent loop, provider loop, agent starter, runtime endpoint, bridge authority expansion, hidden read/search/indexing, broad mutation path, free-form shell, git/package/network action, provider/tool calling, task-board mutation, real-provider CI, marketplace readiness, or production readiness.

This audit was the stop point before S81. S81 closes only the explicit edit-executor smoke and failure-mode determinism gaps below; future S82+ work must use new explicit cards and keep these S74-S81 boundaries intact unless a later architecture record and verification gate intentionally changes them.

## Sprint 81 final execution-gap audit status

Sprint 81 closes the remaining S77/S78 execution-gap trail before any real controlled-autonomy work. It reconciles the controlled edit executor metadata contract/evaluator shape, adds deterministic standalone edit-executor smoke coverage, hardens controlled run failure and stuck-state reasons, and adds deterministic failure-mode smoke coverage for terminal-state behavior. This is an audit and local/mock verification milestone, not an autonomy approval.

The focused S81 edit executor smoke is:

```sh
npm run smoke:controlled-agent-edit-executor
```

That smoke creates its own disposable sentinel-marked workspace, applies one bounded replacement edit after expected-hash preflight, and reports sanitized metadata only. It also blocks unsafe edit-executor cases for absolute paths, traversal, hidden files, symlinks, binary files, oversized patches, unsupported create/delete/rename or other operations, hash mismatch, raw body/diff fields, and private-path leakage. This closes the dedicated S77 edit-executor smoke gap without granting product write authority or runtime/bridge apply authority.

The focused S81 failure-mode smoke is:

```sh
npm run smoke:controlled-agent-failure-modes
```

That smoke transpiles pure GUI services and verifies deterministic blocked, failed, stopped, and sanitized progress/final-report metadata for unsafe event metadata, duplicate terminal events, timeout, runtime-limit, stuck/no-heartbeat, malformed edit metadata, edit hash mismatch, failed/killed/timed-out verification, and malformed provider metadata. This closes failure-mode determinism coverage for the S78 repair/failure gap without implementing automatic repair, retry, rollback, or a real provider loop.

The exact S81 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm run typecheck && npm run build && cd ../.. && npm run smoke:controlled-agent-edit-executor && npm run smoke:controlled-agent-failure-modes && npm run check && git diff --check && git status --short
```

S81 remains deterministic local/mock evidence only. It does not implement a real one-step model loop, production autonomy, a controlled runtime session, hidden workspace read/search/indexing, broad workspace mutation, free-form shell/git/package/network authority, provider/tool calling, task-board mutation, raw prompt/file/diff/command persistence, real-provider CI, marketplace readiness, release readiness, or production readiness. S82+ work must keep these boundaries unless a later explicit architecture record and verification gate intentionally changes them.

## Sprint 82 controlled runtime session metadata status

Sprint 82 adds the controlled runtime session envelope as metadata only. It defines strict contract fixtures, a pure fail-closed GUI evaluator, sanitized App/report/trace integration, and deterministic smoke evidence for lifecycle metadata such as disabled, unsupported host, missing opt-in, precondition blocked, ready to start, start requested, session open, stop requested, and stopped. These states are evidence labels and correlation metadata only; they are not a runtime loop.

S82 does not start a real agent, does not implement a real one-step model loop, and does not execute reads, edits, verification commands, provider calls, tools, shell, git, network actions, rollback, task-board mutations, or workspace mutations. The runtime-session evaluator and UI expose sanitized metadata and all-false authority flags only. Raw prompts, file bodies, diffs, replacement bodies, command strings, cwd/env, output dumps, provider/tool payloads, private paths, secrets, browser-storage dumps, and bridge payloads remain out of runtime-session evidence.

Browser / standalone GUI remains unsupported for controlled runtime session. Browser may show unavailable metadata, but it must not be described as capable of starting or hosting a controlled runtime session. VS Code and JetBrains are future-capable only when explicit opt-in, controlled workspace readiness, verified checkpoint, rollback plan, correlation ids, bounded limits, and host-owned metadata preconditions are present. Even with those preconditions, S82 means review/evidence only, not agent start authority.

The exact S82 focused smoke is:

```sh
npm run smoke:controlled-agent-runtime-session
```

The exact S82 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentRuntimeSession controlledAgentRunState controlledAgentProgressReport && npm run typecheck && npm run build && cd ../.. && npm run smoke:controlled-agent-runtime-session && npm run smoke:controlled-local-agent-mvp && npm run smoke:controlled-agent-failure-modes && npm run smoke:controlled-agent-edit-executor && npm run check && git diff --check && git status --short
```

S82 is still local-first and requires no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, real-provider CI, or production autonomy. S83 is the later bounded-read execution slice described below.

## Sprint 83 real bounded controlled file-read execution status

Sprint 83 adds real bounded controlled workspace text read execution, but only as a narrow explicit user-controlled path. The GUI may build one `gui.controlledAgentFileReadRequest` after controlled runtime/workspace metadata is ready; it posts that request only after an explicit user click; host results are accepted only when request id, run id, runtime session id, and controlled workspace id correlation match. The VS Code host executes the bounded read against one safe workspace-relative text file using the compiled controlled file-read executor. Browser remains unsupported because it has no trusted workspace host, and JetBrains intentionally fails closed with sanitized unsupported metadata instead of reading files.

S83 is not a hidden context-gathering feature. It adds no background reads, recursive search, glob or regex search, broad file browsing, workspace indexing, provider/model call, provider tool call, edit/write/apply authority, verification execution, shell, git, package-manager, network, local-tool authority, rollback execution, task-board mutation, automatic repair, automatic retry, automatic verification, production autonomy, marketplace readiness, release readiness, or real-provider CI. Raw file bodies may exist only in the transient correlated host result for the explicit read request; they must not be persisted in browser storage, trace, progress metadata, final reports, docs, dogfood reports, or smoke output.

The exact S83 focused real-read smoke is:

```sh
npm run smoke:controlled-agent-real-file-read
```

The exact S83 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentFileRead controlledAgentFileReadRequest controlledAgentRunState controlledAgentProgressReport App && npm run typecheck && npm run build && cd ../.. && cd apps/plugins/vscode && npm run compile && cd ../../.. && npm run smoke:controlled-agent-real-file-read && npm run smoke:controlled-agent-file-read && npm run smoke:controlled-agent-runtime-session && npm run smoke:controlled-local-agent-mvp && npm run check && git diff --check && git status --short
```

S83 remains local-first and requires no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, real-provider CI, or production autonomy. S84 is still required before any real bounded edit execution can be claimed. S86 remains the earliest honest one-step controlled-autonomy milestone, and only after separate bounded read, edit, verification, loop, reporting, and safety gates are implemented and verified.

## Sprint 84 real bounded controlled replacement edit execution status

Sprint 84 adds real bounded controlled replacement edit execution, but only as a narrow explicit user-controlled path. The GUI may build one `gui.controlledAgentEditRequest` only after controlled runtime/workspace metadata is ready; it posts that request only after an explicit user click; host results are accepted only when request id, run id, runtime session id, controlled workspace id, and readiness metadata correlation match. Every edit targets an existing safe workspace-relative text file, uses 1-based inclusive whole-line replacement ranges, and must include an expected `sha256:` content hash for the current UTF-8 file bytes before writing. The VS Code host is the only S84 host with real bounded edit execution. Browser remains unsupported because it has no trusted workspace host, and JetBrains intentionally fails closed with sanitized `edit_disabled` metadata instead of applying edits.

S84 is not broad workspace mutation. It adds no create, delete, rename, move, chmod, directory, binary, symlink, generated/dependency, absolute-path, traversal, hidden-file, or secret-path edit authority. It adds no hidden or background edits, auto-apply, provider/model call, verification execution, shell, git, package-manager, network, local-tool authority, rollback execution, task-board mutation, automatic repair, automatic retry, automatic verification, production autonomy, marketplace readiness, release readiness, or real-provider CI. Raw file bodies, diffs, and replacement text may exist only transiently in the explicit bounded edit request/result execution path and must not be persisted in browser storage, trace, progress metadata, final reports, docs, dogfood reports, or smoke output.

The S84 GUI controlled Agent Run verification control is intentionally disabled/S85-required. It must not post `gui.ideActionRequest` with `{ action: "runVerificationCommand" }`; S84 may only show sanitized historical/manual verification evidence already supplied by older manual IDE flows. Real allowlisted controlled-agent verification execution belongs to S85.

The exact S84 focused real-edit smoke is:

```sh
npm run smoke:controlled-agent-real-edit
```

The exact S84 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentEditExecutor controlledAgentEditRequest controlledAgentRunState controlledAgentProgressReport App && npm run typecheck && npm run build && cd ../.. && cd apps/plugins/vscode && npm run compile && npm test -- controlledEdit && cd ../../.. && cd apps/plugins/jetbrains && gradle test --console=plain --tests "*ControlledEdit*" && cd ../../.. && npm run smoke:controlled-agent-real-edit && npm run smoke:controlled-agent-edit-executor && npm run smoke:controlled-agent-real-file-read && npm run smoke:controlled-agent-runtime-session && npm run smoke:controlled-local-agent-mvp && npm run check && git diff --check && git status --short
```

S84 remains local-first and requires no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, real-provider CI, or production autonomy. S85 is still required for real allowlisted verification execution. S86 remains the earliest honest one-step controlled-autonomy milestone, and only after separate bounded read, edit, verification, loop, reporting, and safety gates are implemented and verified.

## Sprint 85 real allowlisted controlled verification execution status

Sprint 85 adds the real controlled Agent Run verification execution slice, limited to VS Code and limited to command-id allowlist semantics. The GUI may post `gui.controlledAgentCommandRunRequest` only after the user explicitly clicks the controlled Agent Run verification control and only when controlled runtime/workspace/readiness metadata is ready. The request is GUI-minted, user-confirmed, correlated to controlled workspace/run/runtime/readiness metadata, and contains one fixed allowlisted `commandId` (`repository-check`, `gui-app-tests`, or `engine-chat-tests`) plus bounded timeout and output-tail limits.

The VS Code host is the only S85 host that executes the controlled verification request. It maps the command id to an internal allowlist, runs with host-owned cwd selection, and returns `host.controlledAgentCommandRunResult` as sanitized tail-only metadata: status, exit code where applicable, duration, bounded output tail, byte and line counts, result hash, truncation, safe message, and all-false authority flags. Browser remains unsupported for controlled verification execution, and JetBrains remains fail-closed/unsupported instead of gaining command authority. Older/manual `VerificationCommandPanel` flows stay separate and must not be described as the S85 controlled Agent Run request path.

S85 does not allow free-form command text, model-selected commands, args, cwd, env, shell snippets, package installation, git, network, provider/tool calls, file read/write, hidden search/indexing, automatic verification, automatic repair, retry, rollback, task-board mutation, production autonomy, marketplace readiness, release readiness, or real-provider CI. Raw command material and full stdout/stderr logs must not be persisted in browser storage, trace, progress metadata, final reports, docs, dogfood reports, or smoke output.

The exact focused S85 real-verification smoke is:

```sh
npm run smoke:controlled-agent-real-verification
```

The exact S85 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentCommandRunRequest App AgentRunPanel && npm run typecheck && npm run build && cd ../.. && cd apps/plugins/vscode && npm run compile && npm test -- controlledCommandRun webview && cd ../../.. && cd apps/plugins/jetbrains && gradle test --console=plain --tests ai.yet.plugin.bridge.ControlledEditTest --tests ai.yet.plugin.ui.ControlledEditBridgeTest && cd ../../.. && npm run smoke:controlled-agent-real-verification && npm run check && git diff --check && git status --short
```

S86 remains the earliest honest one-step controlled-autonomy milestone, and only after bounded read, edit, verification, loop, reporting, and safety gates are intentionally wired and verified.

## Sprint 86 one-step controlled loop contract status

Sprint 86 is the first one-step experimental controlled-autonomy milestone. The S86 contract and fixtures describe explicit user start metadata, one bounded explicit file-read metadata step, one sanitized proposal-step metadata record, one bounded replacement-edit metadata record, one allowlisted verification metadata record, and one sanitized terminal report.

S86 is not production autonomy. It must not be described as broad multi-step execution, background agent behavior, real-provider CI, marketplace readiness, or release readiness. It grants no automatic repair, free-form command execution, hidden read/search/indexing, raw prompt/file/diff/command/output persistence, unbounded edit authority, create/delete/rename/move authority, git/package/network/provider/tool authority, shell access, rollback execution, or task-board mutation.

The focused S86 one-step controlled loop smoke is:

```sh
npm run smoke:controlled-agent-one-step-loop
```

The smoke is deterministic local/mock evidence over the GUI one-step loop service. It proves one explicit Start can advance through one bounded read, one sanitized proposal step, one bounded replacement-edit metadata step, one allowlisted verification metadata step, and one sanitized terminal report. It also proves missing Start, blocked read, unsafe proposal metadata, explicit Stop, runtime disconnect, and repair attempts fail closed without widening authority.

The S86 contract fixture gate remains:

```sh
npm run validate:contracts
```

These gates validate metadata fixtures and deterministic one-step state only. They do not run a real provider loop, execute broad workspace actions, enable arbitrary shell, read hidden workspace data, mutate broadly, persist raw payloads, run a repair loop, or prove production autonomy.

## Sprint 87 bounded repair eligibility and UX status

Sprint 87 extends the S86 one-step controlled loop metadata contract with bounded repair eligibility after a failed allowlisted verification. The contract permits at most one explicit user-confirmed repair attempt under the same controlled workspace/run/session authority and records previous verification, repair proposal/edit/verification summaries, attempt budgets, panel eligibility evidence, and terminal stop reason as sanitized metadata only.

S87 repair evidence is explicit bounded repair eligibility/UX only. Failed or timed-out allowlisted verification can become eligible, non-failed verification stays ineligible, unsafe metadata blocks, user Stop stops, and the attempt budget remains one. The panel confirmation callback remains a user-click boundary; it is not automatic repair orchestration.

S87 does not grant automatic repair, multiple repairs, free-form commands, raw output or diff persistence, hidden reads/search, git, package, network, provider, or tool authority. The repair contract remains local-first experimental metadata and UX evidence, not production autonomy.

The S87 focused smoke is:

```sh
npm run smoke:controlled-agent-repair-loop
```

The S87 contract fixture gate remains:

```sh
npm run validate:contracts
```

These gates validate deterministic local/mock repair eligibility and metadata fixtures only. They do not run a provider loop, edit files, execute repairs, call a runtime, or prove production autonomy.

## Sprint 88 useful autonomy dogfood matrix

Sprint 88 planning uses [`../dogfood/s88-useful-autonomy-matrix.md`](../dogfood/s88-useful-autonomy-matrix.md) as the deterministic dogfood matrix for useful small-task experimental controlled autonomy. The matrix covers copy change, simple TypeScript fix, failing test fix, one-file code cleanup, and recovery copy fixtures. Each planned task must fit the S86/S87 authority envelope: one explicit Start click, one bounded read, one sanitized proposal step, one bounded replacement edit to one existing safe workspace-relative text file, one allowlisted verification command id, and at most one bounded repair attempt when S87 repair metadata is available.

The S88 matrix is docs/fixture planning plus local fixture-validation evidence. The tracked `fixtures/s88/` files, `npm run smoke:controlled-agent-dogfood`, and final useful-audit alias `npm run smoke:controlled-agent-dogfood-useful` prove only that the deterministic fixtures stay tiny, sanitized, and mapped to the matrix. They do not add a runtime loop, executed GUI dogfood run, provider call, bridge authority, file discovery, shell/git/package/network authority, raw prompt/file/diff/command/output persistence, production autonomy, marketplace readiness, release readiness, or real-provider CI. Future implementation cards must add separate runtime/UI orchestration evidence before any row can be reported as an executed agent run.

## Sprint 89 cross-host controlled autonomy availability

Sprint 89 clarifies cross-host availability for the controlled local-agent path. This is an availability and unsupported-state contract only; it does not add new execution authority.

| Host surface | Controlled workspace/read/edit metadata | Controlled verification execution | One-step controlled loop availability | Required unsupported-state behavior |
| --- | --- | --- | --- | --- |
| Browser / standalone GUI | Preview/display only | Unsupported | Preview-only metadata and local orchestration labels only | Must stay visibly unsupported, must not post controlled read/edit/command bridge requests, and must not imply a trusted workspace host. |
| VS Code | Supported for the implemented explicit controlled paths | Supported for S85 allowlisted command-id requests after explicit user click | Eligible controlled execution host for S86/S89 once required metadata is present | Must use GUI-minted correlated requests and sanitized host results; no legacy Agent Run verification request is posted from the controlled path. |
| JetBrains | Hosted GUI and manual controls may render; controlled execution slices may remain unsupported where not implemented | Unsupported/fail-closed for S85 controlled verification | Fail-closed until a future card implements and verifies parity | Must show unsupported/fail-closed copy, disable controlled verification controls, and post no command-run bridge request. |

The availability rule is intentionally conservative: unsupported hosts fail closed in GUI and contract tests instead of silently widening authority. Browser remains preview-only because it has no trusted workspace host. JetBrains may keep hosted GUI/manual parity evidence but must not claim controlled execution parity until a later implementation and verification gate proves it. VS Code remains the only current real controlled verification executor.

The S89 focused availability checks are:

```sh
npm run validate:contracts
cd apps/gui && npm test -- bridgeAdapter App && npm run typecheck
```

These checks are local/mock evidence only. They do not call providers, require hosted Yet AI services, grant browser workspace authority, or implement JetBrains controlled verification execution.

## Sprint 89 resilience smoke and final audit status

Sprint 89 also adds a focused controlled-agent resilience smoke for stale, Stop, and disconnect behavior:

```sh
npm run smoke:controlled-agent-resilience
```

This smoke is an audit gate over already-scoped S86/S87/S89 behavior. It runs the existing GUI resilience tests for controlled Agent Run verification correlation, one-step loop stop states, and bounded repair eligibility, plus the VS Code webview readiness tests for pre-ready privileged message rejection and stale host-ready correlation. The covered cases are stale controlled verification results after chat changes, stale results after explicit Stop, stale results after runtime disconnect, duplicate controlled verification terminal results, one-step loop explicit Stop, one-step loop runtime disconnect, no automatic repair from S86, capped/user-confirmed S87 repair eligibility, pre-ready controlled command/edit rejection, and stale host-ready privileged-message blocking.

Passing this smoke means unsupported or stale controlled-agent signals fail closed and do not advance the current run. It does not add new execution authority, a provider/model loop, browser or JetBrains controlled verification execution, hidden reads/search/indexing, free-form shell, git/package/network authority, automatic retry, automatic repair, rollback execution, task-board mutation, raw output persistence, production autonomy, marketplace readiness, release readiness, or real-provider CI. Resilience evidence stays local/mock-only and bounded to explicit user-controlled paths.

## Sprint 90 controlled autonomy readiness matrix

Sprint 90 uses [`../dogfood/s90-controlled-autonomy-readiness.md`](../dogfood/s90-controlled-autonomy-readiness.md) as the controlled-autonomy readiness decision matrix. The matrix records evidence and an honest `ready`, `partial`, or `blocked` decision for explicit Start/Stop, bounded read, bounded edit, allowlisted verification, one repair attempt, dogfood usefulness, cross-host availability, resilience, and public wording safety.

The overall S90 decision is `partial`: approve only an experimental controlled local agent dev-preview for narrow local/mock and explicit-user-start evidence. The controlled local-agent path has enough bounded dev-preview evidence for narrow local dogfood planning and further hardening, but it is not production autonomy, not broad workspace automation, not real-provider CI, not release or marketplace evidence, and not cross-host complete. VS Code remains the only current real controlled execution host for implemented slices. Browser remains preview-only/unsupported for trusted workspace execution, and JetBrains remains fail-closed for controlled execution parity until future verified work changes that status.

S90 adds no production autonomy, no broad workspace authority, no hidden reads/search/indexing, no free-form shell/git/package/network/provider-tool authority, no automatic repair/retry/rollback, no raw payload persistence, and no real-provider CI claim. Its evidence summary is the fixed local/mock chain: S86 one-step loop, S87 one-attempt repair eligibility, S88 useful dogfood fixture validation, optional S89 resilience, and S90 public wording safety. The exact S90 verification chain is:

```sh
npm run smoke:controlled-autonomy-readiness && npm run audit:controlled-autonomy-wording && npm run check
```

The readiness smoke includes `npm run audit:controlled-autonomy-wording`, and the audit is repeated explicitly in the acceptance chain to keep final public wording hygiene visible. For smaller documentation-only sanity checks, the minimum repository validation remains:

```sh
npm run check
```

## Sprint 90 final closure status

Sprint 90 closes as `partial` after the final controlled-autonomy readiness gate passed on 2026-07-05. The closure approves only an experimental controlled local agent dev-preview for narrow local/mock and explicit-user-start evidence. It does not approve production autonomy, broad workspace automation, real-provider CI, release evidence, marketplace evidence, browser controlled execution parity, JetBrains controlled execution parity, or any authority beyond the already documented S86-S89 boundaries.

The exact final closure commands were:

```sh
npm run validate:contracts
cd apps/gui && npm test -- AgentRunPanel ControlledAgentRunPanel controlledRepairLoop controlledOneStepAgentLoop App && npm run typecheck && npm run build
npm run smoke:controlled-agent-one-step-loop
npm run smoke:controlled-agent-repair-loop
npm run smoke:controlled-agent-dogfood-useful
npm run smoke:controlled-agent-dogfood
npm run smoke:controlled-agent-resilience
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All final closure commands passed. The closure records evidence only: bounded one-step loop, one-attempt repair eligibility, useful dogfood fixture validation, resilience fail-closed behavior, public wording safety, repository validation, and clean working-tree checks. S90 adds no production autonomy, broad workspace authority, hidden reads/search/indexing, free-form shell/git/package/network/provider-tool authority, automatic repair/retry/rollback, raw payload persistence, or real-provider CI claim.

## Sprint 91 controlled local agent dev-preview target

Sprint 91 uses [`../dogfood/s91-controlled-agent-dev-preview.md`](../dogfood/s91-controlled-agent-dev-preview.md) to align the next dev-preview slice with the S90 `partial` decision. The target is more useful VS Code-first UX and reporting after explicit Start, with explicit Stop still user-owned, bounded read/edit/allowlisted-verification phases, at most one user-confirmed repair attempt, and sanitized progress/final reports.

S91 does not change the S90 approval boundary. It remains an experimental controlled local agent dev-preview for narrow local/mock and explicit-user-start evidence only. It is not production autonomy, not broad workspace automation, not real-provider CI, not release or marketplace evidence, and not cross-host complete. Browser remains preview-only/unsupported for trusted workspace execution, JetBrains remains fail-closed/unsupported for controlled execution parity, and VS Code remains the primary dev-preview host for implemented controlled execution slices.

S91 adds no hidden reads/search/indexing, no arbitrary shell or free-form commands, no git/package/network/provider-tool authority, no broad mutation, no automatic repair beyond the single user-confirmed repair attempt, no automatic retry/rollback, no raw prompt/file/diff/command/output/private-path/secret persistence, and no production or publication claim.

## Sprint 91 final dev-preview status

Sprint 91 closes as a controlled local agent dev-preview status and reporting milestone after the final S91 gate passed. The completion status records bounded evidence for a more useful VS Code-first dev-preview: explicit Start/Stop UX, pure sanitized status aggregation, bounded read/edit/allowlisted-verification capability labels, one user-confirmed repair-attempt label, host limitation labels, and sanitized progress/final-report copy.

The S91 evidence remains local/mock and explicit-user-start only. The integrated GUI status is display/status wiring over already-scoped controlled Agent Run metadata; it does not add bridge authority, runtime authority, provider/tool behavior, background execution, hidden workspace context gathering, broader mutation, or any new trusted host capability. Browser remains preview-only and unsupported for trusted workspace execution. JetBrains remains fail-closed/unsupported for controlled execution parity until a later verified card changes that status. VS Code remains the primary dev-preview host for the implemented controlled execution slices.

S91 does not change the S90 `partial` decision and does not approve production autonomy, broad workspace automation, release evidence, marketplace evidence, cross-host completion, or real-provider CI. It adds no hidden reads/search/indexing, arbitrary shell, free-form commands, git/package/network/provider-tool authority, create/delete/rename/move/patch authority, automatic repair beyond the single user-confirmed repair attempt, automatic retry, automatic rollback, raw payload persistence, task-board mutation, hosted backend requirement, cloud workspace requirement, or production/publication claim.

The exact S91 final gate is:

```sh
npm run validate:contracts
cd apps/gui && npm test -- controlledAgentDevPreviewStatus AgentRunPanel ControlledAgentRunPanel controlledOneStepAgentLoop controlledRepairLoop App && npm run typecheck && npm run build
npm run smoke:controlled-agent-dev-preview
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All S91 final gate commands passed. The completion record is documentation and local/mock verification evidence only; it is not production autonomy, not broad workspace authority, not real-provider CI, not release evidence, not marketplace evidence, and not cross-host parity approval.

## Sprint 92 sanitized dev-preview report evidence

Sprint 92 adds focused deterministic smoke evidence for the controlled local agent dev-preview report service. The report service is a pure sanitized aggregator over supplied host/status, one-step, repair, run, counter, limitation, and evidence metadata. It emits fixed labels, bounded counters, host limitation labels, and safety boundary labels, while omitting or replacing raw-looking report evidence.

The focused S92 report smoke is:

```sh
npm run smoke:controlled-agent-dev-preview-report
```

The aggregate dev-preview smoke includes this report gate:

```sh
npm run smoke:controlled-agent-dev-preview
```

This evidence is local/mock only. It does not call providers, network, package installation, git, free-form shell, runtime authority, bridge authority, storage authority, real IDE execution, or broad workspace actions. It does not change the S90 `partial` decision and does not approve production autonomy, broad workspace automation, real-provider CI, release evidence, marketplace evidence, cross-host completion, or any authority beyond the S91 VS Code-first dev-preview boundary. Browser remains preview-only/unsupported for trusted workspace execution, and JetBrains remains partial/fail-closed until later verified work changes that status.

## Sprint 92 final sanitized report audit status

Sprint 92 closes as a sanitized controlled local agent dev-preview report milestone after the final S92 gate passed. The completed evidence is intentionally narrow: a pure `controlledAgentDevPreviewReport` aggregator, Agent Run and Controlled Agent Run display wiring derived only from existing GUI props/state, focused component coverage, a deterministic local/mock report smoke, the aggregate dev-preview smoke, public wording audit, repository validation, and clean working-tree checks.

The S92 report evidence is sanitized metadata only. Reports may include fixed status labels, host labels, limitation labels, bounded counters, one-step and repair state labels, safe evidence summaries, and fixed safety-boundary text. Reports must omit raw-looking evidence rather than echoing it; raw prompts, provider responses, file bodies, diffs, replacement text, command strings, cwd/env, output dumps, bridge payloads, private paths, secrets, and arbitrary user text remain outside report metadata.

S92 does not change the S90 `partial` decision and does not widen the S91 VS Code-first dev-preview boundary. It does not add bridge authority, runtime authority, storage authority, provider/tool behavior, real IDE execution, background execution, hidden workspace context gathering, broad workspace automation, production autonomy, real-provider CI, release evidence, marketplace evidence, browser trusted workspace execution, or JetBrains controlled execution parity. Browser remains preview-only/unsupported for trusted workspace execution, JetBrains remains fail-closed/unsupported for controlled execution parity, and VS Code remains the primary dev-preview host for implemented controlled execution slices.

The exact S92 final gate is:

```sh
npm run validate:contracts
cd apps/gui && npm test -- controlledAgentDevPreviewReport controlledAgentDevPreviewStatus AgentRunPanel ControlledAgentRunPanel controlledOneStepAgentLoop controlledAgentRepairLoop App
cd apps/gui && npm run typecheck
cd apps/gui && npm run build
npm run smoke:controlled-agent-dev-preview
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All S92 final gate commands passed. This completion record is documentation and local/mock verification evidence only; it is not production autonomy, not broad workspace authority, not real-provider CI, not release evidence, not marketplace evidence, and not cross-host parity approval.

## Sprint 93 dev-preview dogfood runbook status

Sprint 93 keeps the S90 `partial` decision visible and adds a safe manual dogfood runbook for the controlled local agent dev-preview in [`../dogfood/s91-controlled-agent-dev-preview.md`](../dogfood/s91-controlled-agent-dev-preview.md). The runbook is VS Code-first because VS Code is the current primary trusted host for implemented controlled execution slices. Browser remains preview-only and unsupported for controlled workspace execution. JetBrains remains partial/fail-closed for controlled execution parity until a later verified card changes that status.

The runbook describes prerequisites and a manual checklist for explicit **Start** and **Stop**, one bounded selected workspace-relative text read, one bounded replacement edit to an existing safe text file, one allowlisted verification command id, and at most one user-confirmed repair attempt after a failed verification. It defines what each sequence step means and what it does not mean: no hidden reads, search, indexing, broad mutation, create/delete/rename/move, free-form shell, git, package, network, provider-tool authority, model-selected commands, automatic repair, automatic retry, automatic rollback, raw payload persistence, task-board mutation, production autonomy, release evidence, marketplace evidence, or real-provider CI.

The local-first BYOK boundary remains unchanged. Controlled dev-preview dogfood must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, marketplace publication, production login, signing, notarization, or real-provider CI. Manual local provider use remains optional and local-only; dogfood notes must keep credentials, raw prompts, file bodies, diffs, replacement text, command strings, cwd/env values, output dumps, bridge payloads, private paths, secrets, and arbitrary user text out of tracked evidence.

The S93 documentation/runbook verification gate is:

```sh
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

The broader controlled dev-preview smoke remains available as explicit local/mock evidence:

```sh
npm run smoke:controlled-agent-dev-preview
```

That smoke does not change the runbook boundary. It does not call providers, require hosted services, use credentials, prove production autonomy, prove release readiness, publish marketplace artifacts, or complete browser/JetBrains controlled execution parity.

## Sprint 93 final dogfood fixture audit status

Sprint 93 closes as a controlled local agent dev-preview dogfood runbook and fixture-audit milestone after the final S93 gate passed. The completion record is intentionally narrow: the VS Code-first manual runbook remains the human dogfood path, deterministic fixtures validate success, verification-failure repair, user stop, runtime disconnect, browser unsupported, and JetBrains partial/fail-closed scenarios, and the aggregate dev-preview smoke records S91/S92/S93 local/mock evidence together.

S93 evidence is documentation, sanitized fixture metadata, and local/mock smoke output only. It records explicit user Start/Stop, one bounded selected workspace-relative text read, one bounded replacement edit to an existing safe text file, one allowlisted verification command id, at most one user-confirmed repair attempt, host limitation labels, bounded counters, and safe final-report status labels. It does not add runtime authority, bridge authority, storage authority, provider/tool behavior, real-provider CI, production autonomy, release evidence, marketplace evidence, browser trusted workspace execution, JetBrains controlled execution parity, broad workspace authority, hidden read/search/indexing, arbitrary command execution, shell/git/package/network authority, automatic repair/retry/rollback, raw payload persistence, or task-board mutation.

The exact S93 final audit gate is:

```sh
npm run validate:contracts
cd apps/gui && npm test -- controlledAgentDevPreviewReport AgentRunPanel ControlledAgentRunPanel controlledOneStepAgentLoop controlledRepairLoop App
cd apps/gui && npm run typecheck
cd apps/gui && npm run build
npm run smoke:controlled-agent-dev-preview
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All S93 final gate commands passed. The clean-tree check is part of the gate so fixture/runbook completion cannot quietly skip wording, smoke, repository, whitespace, or status evidence.

## Sprint 94 cross-IDE dev-preview limitation audit

Sprint 94 keeps cross-host limitation copy aligned across Browser, VS Code, and JetBrains UI/docs. VS Code is the supported controlled local agent dev-preview path for explicit user-controlled slices. Browser remains preview-only and unsupported for privileged controlled actions because it has no trusted workspace host. JetBrains remains partial/fail-closed where controlled execution gaps remain until a later verified parity card changes that status.

This audit is copy and documentation alignment only. It adds no bridge authority, runtime authority, storage authority, provider/tool behavior, real-provider CI, production autonomy, release evidence, marketplace evidence, browser trusted workspace execution, JetBrains controlled execution parity, broad workspace authority, hidden read/search/indexing, arbitrary command execution, shell/git/package/network authority, automatic repair/retry/rollback, raw payload persistence, or task-board mutation.

## Sprint 94 final S91-S94 roadmap closure

Sprint 94 closes the S91-S94 roadmap as documentation and wording-audit evidence only. The closure preserves the S90 `partial` decision: the approved scope remains an experimental controlled local agent dev-preview for narrow local/mock evidence and explicit user-started VS Code-first dogfood. It is still not production autonomy, not broad workspace automation, not release evidence, not marketplace evidence, not real-provider CI, and not cross-host completion.

The final S91-S94 status is:

- **S91 status service, UI, and audit**: complete as sanitized status/reporting UX over already-scoped controlled Agent Run metadata. It records explicit Start/Stop labels, bounded read/edit/allowlisted-verification phase labels, one user-confirmed repair-attempt label, host limitations, and sanitized progress/final-report copy without adding bridge, runtime, storage, provider/tool, or host authority.
- **S92 sanitized dev-preview report**: complete as a pure report aggregator and UI display path over supplied safe metadata. It emits fixed labels, bounded counters, host limitation labels, safety-boundary text, and safe evidence summaries while omitting raw-looking prompts, provider responses, file bodies, diffs, replacement text, command strings, cwd/env values, output dumps, bridge payloads, private paths, secrets, and arbitrary user text.
- **S93 dogfood fixtures, smoke, and runbook**: complete as VS Code-first manual runbook plus deterministic local/mock fixture evidence for success, verification-failure repair, user stop, runtime disconnect, Browser unsupported, and JetBrains partial/fail-closed scenarios. The runbook remains explicit-user-start and explicit-user-stop evidence only.
- **S94 wording, limitation, and verification audit**: complete as cross-IDE limitation copy alignment and expanded public wording protection. VS Code is described as the supported explicit-control dev-preview path, Browser as preview-only/unsupported for privileged controlled actions, and JetBrains as partial/fail-closed where controlled gaps remain.

All S91-S94 evidence is local/mock or documentation evidence. It does not call providers, require hosted Yet AI services, use credentials in automation, prove real-provider CI, publish artifacts, prove signing or notarization, prove release readiness, prove marketplace readiness, complete Browser or JetBrains controlled execution parity, or approve any authority beyond the S90/S91 bounded dev-preview envelope.

The S94 documentation closure gate is:

```sh
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

This gate keeps public wording hygiene, docs index validation, repository checks, whitespace hygiene, and tracked status visible for the final S91-S94 closure.

## Sprint 94-C4 final through-S94 verification status

Sprint 94-C4 closes the S91-S94 controlled local agent dev-preview sequence after the final through-S94 verification gate passed on 2026-07-06. This is a verification and documentation closure only; it does not widen the S90 `partial` decision or the S91 VS Code-first dev-preview boundary.

The final through-S94 gate was:

```sh
npm run validate:contracts
cd apps/gui && npm test -- controlledAgentDevPreviewStatus controlledAgentDevPreviewReport AgentRunPanel ControlledAgentRunPanel controlledOneStepAgentLoop controlledRepairLoop App
cd apps/gui && npm run typecheck
cd apps/gui && npm run build
npm run smoke:controlled-agent-dev-preview
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All final through-S94 gate commands passed. The clean-tree check completed with no tracked changes after the closure commit. The evidence remains deterministic local/mock and documentation evidence only: no provider calls, hosted Yet AI services, credentials in automation, real-provider CI, release evidence, marketplace evidence, browser trusted workspace execution, JetBrains controlled execution parity, broad workspace authority, hidden reads/search/indexing, arbitrary command execution, shell/git/package/network/provider-tool authority, automatic repair/retry/rollback, raw payload persistence, or task-board mutation is added or approved.

## Sprint 96 one-step useful-run docs contract

Sprint 96 defines the next useful controlled local agent dev-preview target as a documentation contract only. The target remains VS Code-first and explicit-control: the user clicks **Start**, the run performs one bounded controlled read of one selected safe workspace-relative text file, records one bounded replacement edit to an existing safe text file, runs one allowlisted verification command id, and ends with one sanitized terminal report.

The S96 target flow is intentionally one-step:

1. **Explicit Start**: no run begins until the user starts it in the controlled dev-preview surface.
2. **One bounded controlled read**: at most one selected safe workspace-relative text file is read under byte, line, and body limits.
3. **One bounded replacement edit**: at most one existing safe text file receives a bounded replacement edit through the controlled edit path and correlation metadata.
4. **One allowlisted verification**: at most one fixed command id such as `repository-check`, `gui-app-tests`, or `engine-chat-tests` is requested through the controlled verification path, with sanitized tail-only result metadata.
5. **Sanitized terminal report**: the final state records phase labels, host labels, safe file labels, command-id labels, counters, stop or failure reasons, and short safe summaries only.

S96 does not change runtime authority. It does not add production autonomy, multi-step autonomous execution, hidden reads, background reads, search, indexing, arbitrary shell, free-form command text, git, package, network, provider-tool authority, broad mutation, create/delete/rename/move edits, automatic repair, automatic retry, automatic rollback, raw prompt/file/diff/replacement/command/output persistence, task-board mutation, browser trusted workspace execution, JetBrains controlled execution parity, real-provider CI, release evidence, or marketplace evidence.

Host limitations stay explicit. VS Code is the first controlled dev-preview host for the useful-run target. Browser remains preview-only/unsupported for trusted workspace execution and must not post controlled read, edit, or command requests. JetBrains may keep hosted GUI/manual parity and fail-closed copy, but it must not be described as controlled execution parity until a later verified card changes that status.

The focused T-516 replacement smoke is the S96 final useful-run audit evidence:

```sh
npm run smoke:controlled-agent-s96-useful-run
```

It validates exactly the explicit VS Code user Start label, one bounded controlled read label, one bounded replacement edit label, one allowlisted verification command-id label, and one sanitized terminal report label. This is deterministic local/mock evidence only.

The S96 documentation and smoke gate is:

```sh
npm run smoke:controlled-agent-s96-useful-run && npm run check && git diff --check && git status --short
```

This gate validates the useful-run smoke evidence, repository documentation checks, whitespace hygiene, and tracked status only. It does not run providers, require hosted services, publish artifacts, prove production autonomy, prove release readiness, or complete cross-host parity.



## Sprint 101 provider-backed controlled proposal contract

Sprint 101 introduces a provider-backed controlled proposal contract as metadata-only review vocabulary for a controlled run. A model/provider may propose only bounded sanitized plan labels, one bounded replacement-edit metadata candidate for an existing safe workspace-relative file, and one allowlisted verification command-id suggestion that still requires explicit user action.

The contract grants no provider tool calling, no raw provider payload persistence, no automatic apply, no automatic verification, no automatic repair, no shell/git/network/package authority, no hidden read/search/indexing authority, no broad workspace mutation, and no runtime or bridge endpoint. Invalid fixtures reject raw provider payload storage, provider tool-call fields or authority flags, and automatic apply/run/verify authority.

The S101 contract fixture gate is:

```sh
npm run validate:contracts
```

The documentation wording gate remains:

```sh
npm run audit:controlled-autonomy-wording && npm run check
```

These gates validate schemas, examples, invalid examples, wording, and repository checks only. They do not call real providers, execute provider tools, persist raw model responses, apply edits, run verification, read files, search, index, execute shell/git/network/package actions, prove production autonomy, or complete cross-host controlled execution parity.

## Sprint 102 reviewable patch-plan metadata contract

Sprint 102 adds `controlled_agent_patch_plan` as a minimal review-only dry-run metadata contract. A valid payload can describe bounded safe labels and existing-file replacement candidates for user review, while keeping `executionAllowed: false`, `dryRunOnly: true`, and `automaticApplyAllowed: false`.

S102 grants no create, delete, rename, move, chmod, binary, symlink, or directory edit authority; no raw diff, file body, or provider payload persistence; no shell, git, network, package, provider, or tool authority; and no hidden read, search, or indexing authority. It does not add an apply path, bridge message, runtime endpoint, provider call, verification executor, production autonomy, release evidence, or marketplace evidence.

The S102 contract fixture gate is:

```sh
npm run validate:contracts
```

This validates schemas and fixtures only. It does not apply edits, run verification, call providers, execute tools, mutate workspaces, or prove production autonomy.

## Sprint 104 explicit project memory attachment contract

Sprint 104 defines project memory use for controlled runs as an explicit attachment contract only. A controlled run may use project memory notes only when the user deliberately selects or confirms those notes for that run through the existing project-memory attachment path. Project memory suggestions, labels, search results, run history, traces, capability metadata, or prior sessions must not become hidden runtime context and must not be injected automatically into a controlled run prompt, proposal step, repair attempt, terminal report, or provider request.

Attached memory evidence must be sanitized metadata by default: stable note ids when safe, user-visible safe titles, short safe summaries, task/session labels, attach status, and bounded counts. Raw note bodies are allowed into the transient run context only when they were explicitly selected by the user and pass the same safe-content checks as other explicit context. Unsafe note bodies must be omitted rather than partially echoed. Unsafe means secret-looking text, credential material, private absolute paths, raw provider responses, raw prompts, file bodies, diffs, command material, bridge payloads, stack traces, or arbitrary unreviewed note text that could leak private data.

The controlled-run memory boundary adds no memory indexing, background search, automatic relevance selection, provider/tool memory writes, task-board mutation, bridge authority, runtime endpoint, browser-storage persistence, or production autonomy. Memory attachment remains one-shot for the current explicit run context; accepted sends or completed runs must not silently reuse previously attached notes unless the user selects them again. Final reports, traces, dogfood evidence, and smoke output may mention only sanitized labels, summaries, counts, and omitted/unsafe statuses, with no secrets, private paths, raw note bodies, or raw memory-store dumps.

The S104 documentation gate is:

```sh
npm run audit:controlled-autonomy-wording && npm run check
```

This gate validates wording hygiene and repository checks only. It does not implement a new memory subsystem, provider memory feature, hidden context path, storage migration, production autonomy, release evidence, marketplace evidence, or real-provider CI.

## Sprint 112 controlled lexical search Phase 1 audit

Sprint 112 closes S109-S112 as Phase 1 foundation evidence for controlled lexical search. The foundation is explicit and bounded: S109 records fail-closed authority vocabulary, S110 records strict fixtures and pure GUI request/result correlation, S111 proves the real executor only in VS Code, and S112 adds GUI-local explicit result selection over sanitized metadata.

The Phase 1 host audit is intentionally uneven and explicit:

- **VS Code**: has S111 executor evidence for bounded literal lexical search requests and S112 GUI selection evidence for sanitized result summaries. This is local dev-preview evidence only and does not prove production readiness, marketplace readiness, release readiness, autonomy, or provider proposal quality.
- **Browser / standalone GUI**: remains unsupported for trusted workspace search and hidden indexing. It may render GUI-local mock/service state, but it has no trusted workspace host executor and must not post privileged search, apply, verification, command, git, package, network, or provider-tool actions.
- **JetBrains**: remains fail-closed for controlled lexical search execution until a later parity card implements and verifies a bounded host executor. Hosted GUI/manual parity is not controlled search execution parity.

S112 selection does not change the blocked/deferred capabilities. It adds no hidden reads, hidden search, background indexing, broad workspace scan, raw file-body persistence, browser-storage raw persistence, auto-send, auto-attach, auto-provider, auto-apply, automatic verification, command execution, git/package/network/tool authority, provider-tool authority, production autonomy, release evidence, or cross-host completion. The selected search context is ready for S113 provider proposal work only after a future explicit user action and a separate provider proposal contract.

The focused S112 smoke is:

```sh
npm run smoke:controlled-agent-search-selection
```

It is deterministic local/mock evidence over GUI pure services only. It verifies explicit safe selection, unsafe/private/secret/raw omission, bounded summaries, all no-auto policy flags, clean browser-storage mock state, and no automatic send/attach/provider/apply/verification/search/indexing/command/git/package/network/tool calls.

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
