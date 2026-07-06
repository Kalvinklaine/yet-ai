# 014 Controlled Run History Contract

This document defines the Sprint 99 controlled run history contract for future controlled local-agent dev-preview work. It is a local-first design and storage contract foundation only. It does not add persistence, runtime endpoints, bridge messages, GUI behavior, task queue execution, background work, or production autonomy.

Controlled run history is intended to help a user review what a bounded controlled dev-preview run claimed happened after the user explicitly started it. The record is sanitized metadata only: enough to correlate phases, status labels, safe artifact evidence, and user-visible summaries without storing raw task material.

## Status and authority boundary

S99 controlled run history remains an experimental controlled local agent dev-preview contract. No run starts from this document. No queue runner, persistence implementation, scheduler, storage migration, bridge request, runtime endpoint, provider loop, file read, edit, verification execution, repair, retry, rollback, task-board mutation, or cross-host parity is implemented by this record.

The explicit-control boundary from S90-S96 stays intact:

- The user must explicitly start a bounded controlled dev-preview run before any future record can be created.
- The user must retain explicit Stop visibility and review control.
- VS Code remains the first controlled dev-preview host for implemented trusted workspace slices.
- Browser remains preview-only and unsupported for trusted workspace execution.
- JetBrains remains partial or fail-closed until a later verified card changes controlled execution parity.
- The local-first BYOK contract remains unchanged: core workflows must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, real-provider CI, or production autonomy.

## Contract purpose

A future local task queue or history store may use this contract to record sanitized evidence for a controlled run after explicit user action. The record is for review, diagnostics, bounded reporting, and safe migration planning only. It is not replay data, not a prompt cache, not a patch store, not command logging, not provider transcript storage, and not a recovery journal with raw workspace data.

The history model must be host-owned or engine-owned local storage when implemented. GUI code may render sanitized history metadata returned by trusted local services, but GUI code must not persist raw provider secrets, raw prompts, file bodies, diffs, replacement text, full command output, command material, private paths, or bridge dumps in browser storage.

## Sanitized record shape

A controlled run history entry may contain only bounded metadata fields like these:

| Field family | Allowed sanitized examples | Notes |
| --- | --- | --- |
| Run identity | `runId`, optional `sessionId`, safe correlation labels | Opaque ids only; no private path or prompt-derived id material. |
| Timestamps | created, explicit-start, phase transition, terminal timestamps | ISO-like timestamps or monotonic durations; no raw event payload dumps. |
| Host labels | `vscode`, `browser_preview_only`, `jetbrains_unsupported`, host capability label | Host labels only; no machine username, private absolute path, or environment dump. |
| Readiness labels | opt-in, controlled workspace readiness, checkpoint readiness, rollback-plan readiness, bounded-limit labels | Safe status labels only. |
| Phase and status | queued, ready, running, reading, editing, verifying, stopping, stopped, failed, completed, blocked | Deterministic labels only; no raw request body. |
| Result labels | succeeded, failed, timed-out, killed, user-stopped, unsupported-host, unsafe-metadata-blocked | Safe terminal labels only. |
| Counters | read count, edit count, verification count, repair attempt count, byte/line count, duration buckets | Bounded numbers only. |
| Artifact references | local artifact id, relative evidence label, checksum, size bucket, retention label | References must be safe labels or checksums, not private paths or raw artifact contents. |
| Safe summaries | short fixed-status summary, sanitized diagnostic label, stop reason label | Bounded summaries must be generated from allowlisted safe vocabulary or pass strict sanitization. |

Identifiers must be opaque and non-sensitive. Artifact references must use stable safe labels and checksums such as `sha256:` values over sanitized artifacts, not raw prompt, file, command, provider, or bridge payloads. If an artifact cannot be represented without private data, the history entry should record `artifact_omitted_unsafe` or an equivalent safe label.

## Explicit raw-data prohibitions

Controlled run history must never persist or expose these raw data classes:

- raw prompt text, composer text, system prompts, model instructions, or arbitrary user task text;
- raw file bodies, selected context bodies, snippets, active-file excerpts, hidden workspace data, or indexed workspace content;
- replacement text, raw diff, patch body, hunks, edit body, before/after file content, or rollback file content;
- command string, shell snippet, args, cwd, env, PATH, process environment, package-manager invocation, git command, or model-selected command material;
- full stdout, full stderr, raw logs, terminal transcript, stack trace with private paths, or unbounded output tail;
- provider request payloads, provider responses, provider tool payloads, model transcripts, tokens, API keys, bearer tokens, cookies, auth codes, runtime tokens, or account identifiers;
- private absolute paths, usernames, home directories, repository checkout paths, temporary directory roots, file URLs, or bridge payload dumps;
- browser storage dumps, localStorage/sessionStorage snapshots, IndexedDB dumps, webview postMessage dumps, or raw runtime HTTP/SSE payloads.

If future code receives any prohibited field while building history metadata, it must fail closed, omit the unsafe value, and record only a safe blocked or redacted label. The history entry must not try to partially quote, hash-and-display, or summarize raw sensitive text unless a later security review explicitly approves a safe derived field. Tiny teeth, no chewing on secrets.

## Local task queue relationship

A future local task queue may reference this history contract for queue item status, but queue data must remain sanitized too. A queue item may store a safe task label, run id, host label, readiness label, phase, priority bucket, created timestamp, updated timestamp, and terminal status. It must not store prompt bodies, file bodies, diffs, command material, provider payloads, private paths, or bridge dumps.

Queue and history retention must be local-only and bounded. Future settings should include retention limits by entry count, age, and artifact size. Deleting a run history entry must remove its local sanitized artifact references or mark them orphaned for cleanup. Sync, telemetry, cloud backup, or account-linked history is out of scope unless a future architecture record defines a separate opt-in privacy contract.

## Future test strategy

When persistence code is added, the first implementation card must add focused tests before claiming the contract is implemented:

1. Schema or fixture tests for positive sanitized entries and negative raw-data examples.
2. Sanitizer tests proving raw prompts, file bodies, replacement text, diffs, command material, stdout/stderr dumps, provider payloads, tokens, private paths, and bridge dumps fail closed.
3. Storage tests proving entries are local-only, bounded by count and size, and never written to browser storage as raw payloads.
4. Migration tests proving older sanitized versions upgrade without introducing raw fields, and unknown or unsafe fields are dropped or converted to safe labels.
5. UI rendering tests proving history panels show labels, counters, checksums, and safe summaries only.
6. Smoke evidence proving the future history flow requires explicit user-started controlled dev-preview runs and does not create background task execution.

The required future gate should include `npm run audit:controlled-autonomy-wording`, `npm run check`, schema validation, focused sanitizer/storage tests, and `git diff --check && git status --short`. If runtime or GUI code is changed, add the focused subsystem gates for that changed surface.

## Migration notes

Version the first persisted record as `controlled_run_history.v1` or an equivalent explicit schema label. Store the schema version on every entry. Prefer additive sanitized fields and explicit deprecation labels over implicit shape changes.

Migration rules for future implementations:

- Unknown fields must be ignored unless they are allowlisted by the new schema.
- Unsafe raw-looking fields must be dropped, not copied into replacement fields.
- Deprecated fields must migrate only to sanitized labels, counters, checksums, or bounded summaries.
- Failed migration must preserve the original local file only if it is already known sanitized; otherwise it should quarantine or delete the unsafe entry according to a documented local-only recovery policy.
- Migration reports must use safe counts and labels only, with no raw entry dumps.

## Verification for this document

This S99-C1 card is documentation only. Verify it with:

```sh
npm run audit:controlled-autonomy-wording && npm run check && git diff --check && git status --short
```

Passing this gate proves wording hygiene, documentation index coverage, repository checks, whitespace hygiene, and visible tracked status only. It does not prove persistence, task queue behavior, production autonomy, release readiness, marketplace readiness, real-provider CI, or cross-host controlled execution parity.
