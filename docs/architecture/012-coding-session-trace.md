# 012 Coding Session Trace

The coding-session trace is a GUI-local, read-only timeline model for showing sanitized metadata about one visible coding session. It is a foundation for Sprint 39 observability only. It does not add bridge messages, runtime endpoints, host commands, storage, background workers, tool authority, edit authority, verification authority, or autonomous execution.

## Purpose

The trace gives the GUI one typed shape for safe timeline entries across existing surfaces:

- session and runtime lifecycle: `gui.ready`, `host.ready`, `host.runtimeStatus`, runtime refresh, and unload;
- chat lifecycle: send accepted or rejected, stream started, stream delta, stream finished, stream error, and abort;
- explicit context: context snapshot, active excerpt, snippets, memory, and verification attachments;
- IDE actions: request, progress, and result for existing bounded actions;
- edit proposals: detected, accepted, rejected, apply requested, and apply result;
- verification: run requested, progress, result, and follow-up prompt drafted;
- experimental sandbox readiness metadata: sandbox metadata recorded or blocked, checkpoint metadata verified or blocked, and rollback metadata ready or blocked.

Every entry carries only metadata: an id, timestamp, event family, title, status, optional sanitized summary, optional bounded request id, and optional bounded details. The model is intended for display and local debugging of what the GUI already knows; it is not a source of authority.

## Safety boundaries

Trace helpers sanitize text through the shared GUI redaction helpers before returning an entry. Details are bounded by depth, item count, object entry count, node budget, and string length. Entry lists are bounded and drop the oldest entries when full.

Trace entries must not include raw prompt bodies, hidden reasoning, raw provider responses, raw output bodies except bounded sanitized tails, runtime or session tokens, API keys, cookies, auth headers, auth codes, provider credentials, private absolute paths, stack traces, shell scripts, git remotes, hidden file contents, workspace dumps, or unbounded logs.

Unsafe or unknown family and status values are normalized at the helper boundary instead of becoming new event kinds implicitly. Future event families must be added deliberately with tests and documentation.

## Non-goals

This foundation does not persist traces to browser storage, engine state, project files, telemetry, logs, or host storage. It does not send traces over the bridge and does not expand the bridge contract. It does not change Send gating, runtime lifecycle behavior, IDE action behavior, edit proposal behavior, or verification behavior.

The trace is not an audit log with security guarantees, not a replay protocol, not a task runner, not a tool bus, and not a policy engine. It may support future review UI, but trusted GUI or host code must still validate every action against explicit contracts before anything can run.

## Smoke and dogfood coverage

Deterministic Sprint 39 smokes exercise the trace only through local build/browser/mock runtime harnesses. The guided coding task smoke opens the collapsed panel and checks representative metadata for context attachment, Send, mock response, edit proposal detection, explicit apply request/result, verification request/result, and verification attachment. The real coding task dogfood smoke covers the same read-only trace path for context attachment and manual mock-provider Send without creating any real provider dependency. The general GUI browser smoke checks that the built app renders the collapsed read-only panel and does not persist trace data to browser storage.

These smokes prove that the GUI displays sanitized, bounded, in-memory diagnostics for actions the harness explicitly performs. They do not prove model quality, host IDE behavior, real provider behavior, shell/git/tool execution, auto-apply, auto-run verification, or production release readiness.

## Experimental sandbox session metadata

Sprint 41 adds a separate `experimental_sandbox_session` contract for future sandbox readiness display. It is adjacent to the trace but not part of trace storage, bridge transport, runtime state, or host authority. The payload may describe only sanitized mode status, explicit user opt-in metadata, bounded limits, checkpoint metadata, and rollback plan metadata. It must not contain raw file bodies, diffs, prompts, provider payloads, stack traces, command strings, cwd/env, private paths, secrets, git/network/provider tool fields, hidden scan metadata, auto-action flags, or assistant-origin opt-in.

This contract does not add a sandbox agent, event replay protocol, bridge command, runtime endpoint, tool executor, checkpoint writer, rollback executor, auto-apply behavior, auto-run verification, or agent loop. If future UI reads this metadata, it should render prerequisite status only and continue to treat the coding-session trace as GUI-local read-only diagnostics.

The GUI evaluator for this contract is pure: missing input renders disabled metadata, malformed or unsafe input renders blocked metadata, and every outcome returns `allowedToExecute: false` and `canStartLoop: false`. It rejects non-metadata authority, default-enabled or cloud-required flags, assistant-origin opt-in, execution flags, raw command/cwd/env/network/git/provider/tool fields, unsafe paths, secret markers, stack traces, raw file bodies, unverified checkpoint-ready states, and rollback-ready states without plan metadata. Display summaries and diagnostics are redacted and bounded before they can be added to trace entries.

## Bounded patch verification loop metadata

Sprint 42 adds a separate `bounded_patch_verification_loop` contract for a future display/evaluation layer around one manual edit and verification cycle. It is adjacent to the trace but is not trace storage, bridge transport, host execution, or runtime state. The GUI evaluator for this contract is pure: it reads unknown metadata, returns a sanitized display summary, and never mutates browser storage, bridge state, runtime state, files, or host capabilities.

Every evaluator result preserves the non-authority invariants `allowedToAutoApply: false`, `allowedToAutoRunVerification: false`, `allowedToAutoRollback: false`, and `canStartAutonomousLoop: false`. Valid metadata can become only an explicit user-action state such as apply ready, verification ready, or verification result review. Missing metadata stays disabled; malformed, unsafe, unverified, unbounded, or authority-looking metadata is blocked.

The evaluator accepts only metadata aligned with the contract: metadata-only authority, no cloud requirement, no execution flag, checkpoint-ready or rollback-ready sandbox metadata, verified checkpoint metadata, safe GUI/host-minted correlation through bounded ids, assistant-authored patch proposals that remain non-authoritative, safe workspace-relative touched paths, bounded file/edit/byte counts, and an allowlisted verification `commandId` from `repository-check`, `gui-app-tests`, or `engine-chat-tests`.

The evaluator rejects raw or execution-looking fields and text, including free-form `command`, `cmd`, `args`, `cwd`, `env`, `shell`, git/network/provider/tool-call metadata, raw diffs, file bodies, prompts, provider responses, stack traces, private paths, secret markers, and auto-action flags. Outputs contain only safe labels, enum values, ids, counts, booleans, allowlisted command ids, exit codes, durations, and bounded redacted output tails.

Trace entries may summarize bounded-loop metadata through deliberately named families such as policy checked/blocked, apply ready/result, and verification ready/result. These trace entries remain GUI-local and read-only. They must not include raw patch bodies, command strings, private paths, unbounded output, or raw result bodies; verification output is limited to bounded redacted tails only.

The S42 deterministic smoke covers those trace families without persisting them. It records `boundedLoop.policyBlocked`, `boundedLoop.policyChecked`, `boundedLoop.applyReady`, `boundedLoop.applyResult`, `boundedLoop.verificationReady`, and `boundedLoop.verificationResult` entries in memory while modeling explicit user apply and explicit allowlisted verification clicks. The smoke asserts that the trace omits raw file bodies, raw patch bodies, command strings, private temporary paths, and secret markers, and that browser storage remains empty. This is local/mock lifecycle evidence only; it does not add trace transport, storage, bridge messages, IDE execution, or shell-backed verification.


## One-step Agent Run trace and report metadata

Sprint 43 adds a GUI-local Agent Run lifecycle shell on top of the bounded patch verification metadata. Its trace families are deliberately named `agentRun.goalReady`, `agentRun.proposalDetected`, `agentRun.prerequisitesBlocked`, `agentRun.applyReady`, `agentRun.applyRequested`, `agentRun.applyResult`, `agentRun.verificationReady`, `agentRun.verificationRequested`, `agentRun.verificationProgress`, `agentRun.verificationResult`, `agentRun.rollbackAvailable`, `agentRun.completed`, and `agentRun.blocked`.

Agent Run report helpers are pure in-memory formatters over caller-provided metadata and the Agent Run state evaluator. They do not read files, call providers or runtimes, send bridge messages, create commands, mutate browser storage, write telemetry, or persist reports. Reports are display summaries only; they distinguish successful user-confirmed runs, failed user-confirmed verification, blocked prerequisites, blocked unsafe metadata, and rollback-available states.

Allowed Agent Run trace/report details are bounded ids, enum states, GUI or host request ids, file counts, edit counts, an allowlisted verification `commandId`, exit code, duration, rollback availability, explicit user-confirmation markers, and short sanitized summaries or output tails. Reports must continue to say that apply, verification, and rollback are manual or user-confirmed steps, and must not imply an autonomous loop, automatic repair, automatic verification, automatic apply, or automatic rollback.

Forbidden data remains out of both trace and report helpers: raw prompts, raw model responses, raw patches or diffs, file bodies, command strings, args, cwd, env, shell snippets, git or network metadata, provider payloads, private absolute paths, secrets, stack traces, raw output bodies, and unbounded logs. Unsafe arbitrary fields are dropped or redacted at helper boundaries; output is still bounded after shared redaction.

S43-C5 final audit status: Sprint 43 remains a one-step manual Agent Run shell, not production autonomy. The reviewed state evaluator, report helper, panel wiring, App integration, bridge usage, and deterministic smoke add no arbitrary shell/git/tool execution, provider tool calls, new bridge execution messages, free-form command/args/cwd/env, auto-send, auto-apply, auto-run verification, auto-rollback, hidden reads/search/indexing/background scans, home/secret/private-path/network/remote-publish authority, or assistant-minted authority. Apply readiness still composes checkpoint/policy metadata through the bounded-loop evaluator, patch metadata remains bounded to safe relative edits, verification remains allowlisted by `commandId` only, failed verification stops with rollback review only, and trace/report metadata remains sanitized, bounded, and in memory. The local-first BYOK/no-hosted-backend invariant is preserved.

## Model-driven one-step proposal metadata

Sprint 44 adds a pure model-proposal prompt and correlation layer before the existing Agent Run shell. The prompt builder summarizes only the local user goal, explicit one-shot context labels, and provider readiness; it does not call providers, bridge APIs, storage, runtime endpoints, file readers, search, indexing, tools, shell, or git. The proposal evaluator accepts only the latest complete assistant response correlated to the current chat, latest local prompt request id, latest local user message id, and runtime settings version. Assistant responses cannot mint trusted request ids: apply and verification ids remain GUI/host-originated only after explicit user clicks.

Valid model output can become only sanitized proposal metadata for manual review. Raw prompt text, raw model response, raw patch/diff/file bodies, command strings, args, cwd, env, provider payloads, private paths, secrets, hidden scan data, and arbitrary execution metadata remain forbidden. Invalid, malformed, unsafe, stale, wrong-chat, streaming, or settings-stale responses fail closed by returning no proposal metadata, so stale valid proposals are cleared rather than reused. Chat changes, runtime/provider setting changes, and local draft/prompt replacement clear model-proposal correlation in the GUI.

S44-C5 final audit status: Sprint 44 remains a model-driven one-step proposal path, not production autonomy. The reviewed prompt service, proposal correlation service, Agent Run state evaluator, panel wiring, bridge contract, edit proposal parser, coding task prompts, deterministic smoke, and docs add no auto-send, auto-apply, auto-run verification, auto-repair, auto-rollback, new bridge execution message, free-form command/args/cwd/env, arbitrary shell/git/tool execution, provider tool calls, hidden reads/search/indexing/background scans, browser-storage persistence of raw prompt/model response, default rendering of raw patch/diff/file bodies, assistant-trusted request ids, or docs claims of production autonomy. Verification remains allowlisted by `commandId` through existing `gui.ideActionRequest`, and the local-first BYOK/no-hosted-backend invariant is preserved.

## Real checkpoint readiness integration

Sprint 45 wires real checkpoint readiness into the same manual Agent Run shell through pure GUI metadata composition. `composeAgentRunReadiness` reads only already-known goal/proposal metadata, caps-provided checkpoint/sandbox/policy evidence, and an allowlisted verification `commandId`; it does not call the runtime, bridge, storage, provider APIs, file readers, search, indexing, shell, git, or host tools. Missing, unverified, malformed, stale, unsafe, or policy-mismatched metadata stays blocked and produces display diagnostics only.

Readiness may synthesize bounded patch verification metadata only when both the top-level checkpoint evidence and sandbox details confirm a verified checkpoint, the sandbox is checkpoint-ready or rollback-ready, and policy metadata requires explicit confirmation for the selected allowlisted verification command id. The resulting bounded-loop metadata remains `metadata_only`, `cloudRequired: false`, `executionAllowed: false`, and `status: "ready_for_apply"`; it carries safe ids, counts, hashes, enum states, workspace-relative touched paths, and short summaries only.

S45-C5 final audit status: Sprint 45 remains a real-checkpoint-readiness display/composition layer, not production autonomy. The reviewed readiness composer, Agent Run state evaluator, bounded-loop evaluator, model-proposal correlation, panel wiring, App integration, bridge adapter, deterministic smoke, and documentation add no auto-send, auto-apply, auto-run verification, auto-repair, auto-rollback, new bridge execution message, free-form command/args/cwd/env, arbitrary shell/git/tool execution, provider tool calls, hidden reads/search/indexing/background scans, browser-storage persistence, raw patch/diff/file-body exposure, assistant-trusted authority, managed model gateway dependency, hosted Yet AI backend dependency, account requirement, cloud workspace requirement, or product credit balance requirement. Apply still posts only the existing reviewed edit bridge request after an explicit user click; verification still posts only the existing IDE action request with an allowlisted `commandId` after an explicit user click; invalid latest proposals clear readiness instead of remaining actionable.

## Checkpoint rollback UX state contract

Sprint 53 adds `agent_run_checkpoint_rollback_state` as a contract-only display shape for checkpoint and rollback UX. It is intentionally narrower than the earlier sandbox and bounded-loop metadata: consumers may render checkpoint readiness, checkpoint-created, rollback-available, rollback-blocked, rollback-completed, and rollback-failed states from sanitized ids, labels, status enums, and UTC timestamps only. It does not carry file lists, private paths, diffs, file bodies, command strings, cwd/env, provider payloads, stack traces, or raw verification output.

Rollback authority remains outside this payload. The only action metadata allowed is the fixed marker that rollback is user-triggered, host-owned, and not automatic. A valid payload cannot make rollback executable, cannot request rollback, cannot mint bridge correlation, and cannot downgrade host policy. Browser and GUI surfaces should treat it as display state only; any future rollback execution must arrive through a separate reviewed host-owned design with explicit user confirmation and its own contracts/smokes.

S53-C1 status: the contract/docs add no auto-rollback, no auto-repair, no auto-apply, no auto-run verification, no free-form command, no new bridge message, no runtime endpoint, no hidden read/search/indexing, no shell/git/tool/provider execution, and no workspace mutation authority. Invalid fixtures specifically reject raw diffs, private-path labels, automatic rollback flags, and command material.

S46-C5 final audit status: Sprint 46 remains an explicit Apply correlation layer, not production autonomy. The reviewed Agent Run apply normalizer/correlator, Agent Run state/report/trace helpers, App wiring, AgentRunPanel, bridge adapter, deterministic apply smoke, and documentation add no auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, auto-rollback, new bridge execution message, free-form command/args/cwd/env, arbitrary shell/git/tool execution, provider tool calls, hidden reads/search/indexing/background scans, browser-storage persistence, raw patch/diff/file-body exposure, assistant-trusted request ids, managed model gateway dependency, hosted Yet AI backend dependency, account requirement, cloud workspace requirement, or product credit balance requirement. Browser mode stays inert for host actions; IDE mode posts only the existing `gui.applyWorkspaceEditRequest` after an explicit user click with a GUI-owned request id; host apply results are accepted only when correlated to the current request id; duplicate or stale results are ignored; failed/rejected apply stops with rollback review metadata and no automatic retry.

S47-C5 final audit status: Sprint 47 remains an explicit Verification correlation layer, not production autonomy. The reviewed Agent Run verification normalizer/correlator, Agent Run state/report/trace helpers, App wiring, AgentRunPanel, bridge adapter, deterministic verification smoke, and documentation add no auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, auto-rollback, new bridge execution message, free-form command/args/cwd/env, arbitrary shell/git/tool execution, provider tool calls, hidden reads/search/indexing/background scans, browser-storage persistence, raw command/path/secret output exposure, assistant-trusted request ids, managed model gateway dependency, hosted Yet AI backend dependency, account requirement, cloud workspace requirement, or product credit balance requirement. Browser mode stays inert for host actions; IDE mode posts only the existing `gui.ideActionRequest` after an explicit user click with a GUI-owned request id and a payload limited to `{ action: "runVerificationCommand", commandId }`; verification progress/results are accepted only when correlated to the current request id and allowlisted command id; duplicate or stale results are ignored; failed verification stops with no automatic repair while rollback remains user-review only when safe rollback metadata exists.

S48-C5 final audit status: Sprint 48 remains a built-GUI E2E smoke and documentation layer for the manual one-step Agent Run shell, not production autonomy. `npm run smoke:agent-run-e2e` builds the GUI and drives the rendered shell only through deterministic loopback/mock runtime, SSE, provider, bridge, and host data. The reviewed smoke, reusable fixtures, AgentRunPanel/App wiring, and documentation prove only the manual UI flow and failure-path rendering: local goal, explicit context, manual Send, no automatic apply or verification, explicit Apply through the existing reviewed edit bridge request, explicit allowlisted Verify through the existing command-id-only IDE action request, sanitized completion report, malformed proposal rejection, missing checkpoint block, failed verification stop without repair, and stale assistant response rejection after correlation changes. Sprint 48 adds no new runtime endpoint, bridge execution message, provider dependency, real IDE automation, shell/git/tool execution, hidden workspace scan, browser-storage persistence, auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, auto-rollback, production autonomy claim, hosted backend requirement, account requirement, cloud workspace requirement, managed gateway dependency, or product credit balance dependency.

S49-C2 manual dogfood evidence uses `docs/dogfood/one-step-agent-run.md`. The checklist records sanitized local observations for commit or artifact, host/browser surface, provider family/model id without secrets, context attached or omitted, prompt drafted/reviewed, manual Send, proposal detected or rejected, checkpoint readiness, manual Apply, manual Verification, final result, and known issues. It remains a manual local evidence template only and forbids raw provider responses, raw prompts, raw file bodies, raw diffs or patch bodies, private paths, credentials, command strings, cwd/env values, browser-storage dumps, and bridge payload dumps.

S49-C4 final architecture status: the one-step Agent Run is implemented only as a dev-preview, manual-only, checkpoint-gated coding flow. The GUI may draft a prompt from explicit user context, accept a correlated model safe-edit proposal for review, compose readiness from verified checkpoint metadata, and expose explicit Apply and explicit Verify controls. Apply continues to use only the existing `gui.applyWorkspaceEditRequest` bridge path with GUI-owned request ids; verification continues to use only the existing `gui.ideActionRequest` path with `action: "runVerificationCommand"` and an allowlisted `commandId`. Browser surfaces stay preview-only for workspace mutation, IDE hosts remain responsible for their own confirmation/policy, and sanitized trace/report output stays bounded and in memory.

S49-C4 also closes the dev-preview boundary negatively: Agent Run is not a production autonomous coding agent. The reviewed architecture and documentation add no autonomous loop, no automatic Send, no automatic Apply, no automatic verification, no repair/retry loop, no automatic rollback, no hidden file reads, no background search/indexing, no new bridge execution surface, no runtime endpoint, no free-form command/args/cwd/env channel, no shell/git/tool/provider-tool execution, no browser-storage persistence of prompt/proposal/output, no raw patch/diff/file-body exposure, no assistant-minted authority, and no requirement for a hosted Yet AI backend, Yet AI account, managed model gateway, cloud workspace, or product credit balance. Future production autonomy remains separate design work behind new architecture, schemas, host policy, deterministic evidence, and explicit approval.

S49-C5 final product safety audit status: the S45-S49 one-step Agent Run trail has no blocking product-safety findings. The audited App wiring, AgentRunPanel, bridge schema guards, `editProposal`, bounded patch verification evaluator, Agent Run state/readiness/model-proposal/apply/verification/report services, smokes, and docs preserve the same dev-preview manual boundary. No reviewed path adds automatic Send, automatic Apply, automatic verification, repair/retry loops, automatic rollback, hidden reads, workspace indexing, arbitrary shell/git/tool/provider execution, privileged bridge expansion, command/args/cwd/env verification input, assistant-minted trusted request ids, raw browser-storage persistence, raw default rendering, hosted Yet AI backend dependency, account requirement, managed gateway requirement, cloud workspace requirement, or product credit dependency.

The S49-C5 audit also confirms the positive authority shape remains intentionally narrow: stale or invalid model proposals clear readiness or stay blocked; Apply is user-confirmed and posts only the existing `gui.applyWorkspaceEditRequest` with GUI-owned correlation; Verification is user-confirmed and posts only the existing `gui.ideActionRequest` with `{ action: "runVerificationCommand", commandId }`; allowlisted verification command ids remain `repository-check`, `gui-app-tests`, and `engine-chat-tests`; failed apply or verification stops for user review; rollback is metadata/review-only through existing checkpoint surfaces; trace and report output stay sanitized, bounded, and in memory. The deterministic verification evidence is the explicit local/mock S49 bundle plus contracts, GUI tests/typecheck/build, repository `npm run check`, diff hygiene, and clean git status.

## Multi-step Agent Run plan preview metadata

Sprint 61 adds `agent_run.multistep_plan` as a separate plan-preview contract adjacent to the trace. It is assistant-authored metadata for GUI review, not trace storage, bridge transport, runtime state, host execution, provider execution, or workspace authority. If future UI records trace entries for this preview, entries should summarize only safe ids, title or step labels, counts, risk labels, expected workspace-relative file labels, allowlisted verification `commandId` values, and the explicit manual-action policy.

The preview must stay inert. It must not include raw prompts, raw model responses, raw diffs, patch bodies, file bodies, command strings, args, cwd, env, shell snippets, git/network/provider/tool metadata, secrets, private absolute paths, hidden read/search/index hints, stack traces, raw output, browser-storage dumps, request correlation, or auto-action flags. Verification suggestions are labels around allowlisted command ids only; they are not commands and cannot run without a later explicit user click through the existing verification path.

Trace/report copy for this preview must say that no auto-send, auto-apply, automatic verification, automatic repair, automatic rollback, or hidden reads are enabled. Any later Send, Apply, Verify, or Rollback remains a separate explicit user action with its own existing contract and host policy. Sprint 61 does not implement multi-step execution, an autonomous loop, a task runner, a shell/git/tool executor, or a new provider/runtime capability; it only provides sanitized review metadata while preserving local-first BYOK behavior.

## Follow-up prompt draft metadata

Sprint 62 adds `agent_run.followup_prompt_draft` as a separate metadata contract for drafting a second Agent Run model prompt after explicit user-run verification. It is adjacent to trace and report metadata only; it is not trace storage, bridge transport, runtime state, host execution, provider execution, automatic repair, or workspace authority.

Agent Run follow-up and fix prompt draft UI events reuse the existing trace family `verification.followupPromptDrafted`. They do not introduce an `agentRun.followupPromptDrafted` trace family. This keeps all verification-derived draft events in one deliberately allowed trace family while titles and summaries can still identify the Agent Run source.

Trace entries for this draft should summarize only bounded ids, the `followup` or `fix` intent, prior proposal labels, plan or proposal summary labels, allowlisted verification `commandId`, exit code, duration, sanitized status, and short redacted result summaries. Verification output must enter only as sanitized bounded metadata or as explicit one-shot context the user chooses for that send. Trace entries must not include raw command strings, cwd/env, shell snippets, raw verification output dumps, raw prompts, raw model responses, raw diffs, patch bodies, file bodies, provider/tool/git fields, secrets, private absolute paths, stack traces, request authority, or hidden read/search/index hints.

The draft remains idle until the user explicitly reviews it and clicks Send. Trace/report copy must distinguish this from automatic repair: no auto-send, auto-apply, automatic verification, automatic repair, automatic rollback, retry loop, hidden reads, or execution authority is enabled. Any later Send, Apply, Verify, or Rollback remains a separate explicit user action with its own existing contract and host policy. Sprint 62 does not claim multi-step execution or autonomy, and it preserves the local-first BYOK/no-hosted-backend invariant.

## S71 multi-step task timeline UX

Sprint 71 adds a GUI-only multi-step task timeline panel for the manual Agent Run surface. The timeline is read-only sanitized metadata UX over already-known React state: local goal status, explicit context attached or omitted labels, task memory suggestion labels, proposal review status, explicit Apply request/result metadata, explicit Verification request/progress/result metadata, follow-up or fix draft status, and final result labels. It is not an execution engine, task runner, replay protocol, scheduler, storage layer, provider adapter, bridge authority, runtime endpoint, or audit log with security guarantees.

The S71 timeline does not add autonomy. It cannot send chat, attach context, search memory, apply edits, run verification, repair, retry, roll back, call providers or tools, execute shell/git/package/network commands, read files, scan workspaces, or mutate the project. It exposes no action buttons in the timeline itself; Send, Apply, Verification, memory Attach, and follow-up/fix Send remain separate explicit user controls governed by their existing contracts.

Timeline entries must stay bounded and sanitized. They must not include raw prompts, raw provider responses, raw model payloads, raw file bodies, raw active excerpts, raw memory bodies, raw verification bodies, raw diffs, raw patch bodies, raw command strings, args, cwd/env values, private absolute paths, browser-storage dumps, bridge payload dumps, stack traces, credentials, tokens, cookies, or unbounded logs. The timeline remains in GUI memory only and does not persist raw data or timeline entries to browser storage, engine state, project files, telemetry, host storage, logs, or provider/runtime storage.

The focused S71 smoke is:

```sh
npm run smoke:multi-step-task-timeline
```

It is deterministic local/mock built-GUI evidence only. T-315 delivered this replacement smoke after the earlier T-312 smoke attempt failed; do not cite T-312 as successful evidence. The smoke drives the manual Agent Run flow through explicit Send, explicit Apply, explicit Verification failure, and a manual fix-draft state, then expands the collapsed-by-default timeline and checks sanitized metadata coverage, no timeline action buttons, no pre-action apply/verification bridge requests, no hidden runtime/provider/tool calls, loopback-only network, and no raw prompt/file/diff/command/browser-storage leakage.

Focused implementation checks for S71 timeline behavior are:

```sh
cd apps/gui && npm test -- multiStepTaskTimeline MultiStepTaskTimelinePanel App
npm run check
```

Run the repository documentation and identity gate after S71 documentation changes:

```sh
npm run check
```

S71-C5 final audit status: Sprint 71 remains a read-only metadata timeline for manual Agent Run review, not multi-step execution or autonomy. The audited service, panel, App wiring, trace/session/proposal metadata inputs, replacement smoke, and docs add no auto-send, auto-apply, automatic verification, automatic repair, automatic retry, automatic rollback, hidden memory attach, hidden reads/search/indexing, shell/git/tool/provider authority, runtime or bridge authority, browser-storage timeline persistence, raw prompt/provider/file/diff/command/log persistence, production readiness, publication readiness, real-provider CI, or controlled-autonomy approval. T-315 is the passing replacement smoke after T-312 failed, and S72+ work remains deferred.

## Maintenance rules

When a future card wires trace entries into UI state, keep the trace in memory only unless a separate architecture decision approves storage. Do not store raw assistant messages, user prompts, provider payloads, file excerpts, verification output, or host diagnostics directly in trace entries. Store only safe labels, counts, enum values, request correlation, durations, exit codes, and short redacted tails.

Verification for this foundation is:

```bash
npm run smoke:guided-coding-task && npm run smoke:real-coding-task-dogfood && npm run smoke:gui-browser && npm run check && git diff --check
```
