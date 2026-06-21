# 012 Coding Session Trace

The coding-session trace is a GUI-local, read-only timeline model for showing sanitized metadata about one visible coding session. It is a foundation for Sprint 39 observability only. It does not add bridge messages, runtime endpoints, host commands, storage, background workers, tool authority, edit authority, verification authority, or autonomous execution.

## Purpose

The trace gives the GUI one typed shape for safe timeline entries across existing surfaces:

- session and runtime lifecycle: `gui.ready`, `host.ready`, `host.runtimeStatus`, runtime refresh, and unload;
- chat lifecycle: send accepted or rejected, stream started, stream delta, stream finished, stream error, and abort;
- explicit context: context snapshot, active excerpt, snippets, memory, and verification attachments;
- IDE actions: request, progress, and result for existing bounded actions;
- edit proposals: detected, accepted, rejected, apply requested, and apply result;
- verification: run requested, progress, result, and follow-up prompt drafted.

Every entry carries only metadata: an id, timestamp, event family, title, status, optional sanitized summary, optional bounded request id, and optional bounded details. The model is intended for display and local debugging of what the GUI already knows; it is not a source of authority.

## Safety boundaries

Trace helpers sanitize text through the shared GUI redaction helpers before returning an entry. Details are bounded by depth, item count, object entry count, node budget, and string length. Entry lists are bounded and drop the oldest entries when full.

Trace entries must not include raw prompt bodies, hidden reasoning, raw provider responses, raw output bodies except bounded sanitized tails, runtime or session tokens, API keys, cookies, auth headers, auth codes, provider credentials, private absolute paths, stack traces, shell scripts, git remotes, hidden file contents, workspace dumps, or unbounded logs.

Unsafe or unknown family and status values are normalized at the helper boundary instead of becoming new event kinds implicitly. Future event families must be added deliberately with tests and documentation.

## Non-goals

This foundation does not persist traces to browser storage, engine state, project files, telemetry, logs, or host storage. It does not send traces over the bridge and does not expand the bridge contract. It does not change Send gating, runtime lifecycle behavior, IDE action behavior, edit proposal behavior, or verification behavior.

The trace is not an audit log with security guarantees, not a replay protocol, not a task runner, not a tool bus, and not a policy engine. It may support future review UI, but trusted GUI or host code must still validate every action against explicit contracts before anything can run.

## Maintenance rules

When a future card wires trace entries into UI state, keep the trace in memory only unless a separate architecture decision approves storage. Do not store raw assistant messages, user prompts, provider payloads, file excerpts, verification output, or host diagnostics directly in trace entries. Store only safe labels, counts, enum values, request correlation, durations, exit codes, and short redacted tails.

Verification for this foundation is:

```bash
cd apps/gui && npm test -- codingSessionTrace redaction && npm run typecheck && npm run build && cd ../.. && npm run check && git diff --check
```
