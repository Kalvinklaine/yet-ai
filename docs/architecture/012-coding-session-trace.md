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

## Maintenance rules

When a future card wires trace entries into UI state, keep the trace in memory only unless a separate architecture decision approves storage. Do not store raw assistant messages, user prompts, provider payloads, file excerpts, verification output, or host diagnostics directly in trace entries. Store only safe labels, counts, enum values, request correlation, durations, exit codes, and short redacted tails.

Verification for this foundation is:

```bash
npm run smoke:guided-coding-task && npm run smoke:real-coding-task-dogfood && npm run smoke:gui-browser && npm run check && git diff --check
```
