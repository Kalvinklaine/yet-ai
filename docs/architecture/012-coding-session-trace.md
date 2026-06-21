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

## Maintenance rules

When a future card wires trace entries into UI state, keep the trace in memory only unless a separate architecture decision approves storage. Do not store raw assistant messages, user prompts, provider payloads, file excerpts, verification output, or host diagnostics directly in trace entries. Store only safe labels, counts, enum values, request correlation, durations, exit codes, and short redacted tails.

Verification for this foundation is:

```bash
npm run smoke:guided-coding-task && npm run smoke:real-coding-task-dogfood && npm run smoke:gui-browser && npm run check && git diff --check
```
