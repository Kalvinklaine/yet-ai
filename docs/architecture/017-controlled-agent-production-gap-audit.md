# 017 Controlled Agent Production Gap Audit

This document is the Sprint 107 production-readiness gap audit scaffold for the controlled-agent path. It is a future gate scaffold only: it records categories, known gaps, and required evidence so later sprints can fill proof deliberately instead of inventing criteria late.

Current status remains dev-preview, not production autonomous agent. The controlled-agent path is bounded to explicit user-controlled local/dev-preview evidence, sanitized metadata, and local-first BYOK constraints. This scaffold does not block current implementation, does not approve broader authority, and does not create a release, marketplace, production support, or autonomy decision.

## Audit use

Use this document before any production-like agent decision. A later decision must fill every category with dated evidence, owner, command or report link, residual risk, and an explicit pass, partial, or blocked judgment. Empty evidence means the category is not ready; it does not invalidate ongoing dev-preview work.

Minimum entry shape for future evidence:

- **Evidence artifact**: command output, sanitized report, architecture record, code/test link, manual checklist, or signed-off risk decision.
- **Scope**: host surface, runtime surface, provider path, storage surface, packaging channel, and operating system matrix covered.
- **Boundary statement**: what authority remains absent or unsupported.
- **Residual risk**: accepted limitation, owner, and revisit trigger.

## Current known gaps

### UX, CI, and host parity focus

- UX evidence does not yet prove that Start/Stop, consent, context selection, edit review, verification, one repair attempt, failure states, recovery choices, and final reports are understandable and consistently labeled across Browser, VS Code, and JetBrains.
- User controls need production-like review for visible opt-in, clear stop behavior, no hidden retries, no unbounded repair, explicit confirmation before workspace mutation, clear unsupported-host states, and understandable recovery guidance after disconnects, stale results, failed verification, or repair exhaustion.
- Packaged evidence remains dev-preview artifact evidence only. It does not yet prove signed or notarized packages, marketplace channel behavior, update or rollback UX, packaged wrapper parity, or user-facing install/upgrade recovery.
- CI/CD evidence needs a stable deterministic gate matrix plus a documented flaky-smoke quarantine policy. Manual local BYOK dogfood must stay separate from automation and must not be treated as production CI approval.
- Host parity evidence needs host-owned proof for VS Code execution, Browser unsupported-state behavior, and JetBrains parity or explicit fail-closed behavior. Snapshot or capability labels alone are not enough unless correlated to the current bridge host and authority boundary.
- Observability evidence needs a support-useful event taxonomy, local retention controls, redaction validation, and sanitized export/report checks that do not expose raw prompts, file bodies, diffs, command material, provider payloads, secrets, private paths, or bridge payload dumps.
- Dogfood readiness needs repeatable sanitized reports for useful controlled dev-preview tasks, recovery paths, provider error handling, and local runtime/provider combinations without requiring a hosted Yet AI backend, Yet AI account, managed gateway, product credit balance, cloud workspace, or real-provider CI.

- The S90 decision is `partial`: it supports only experimental controlled local agent dev-preview evidence.
- VS Code is the primary controlled execution host for implemented slices; Browser is preview-only/unsupported for trusted workspace execution, and JetBrains remains partial/fail-closed where controlled execution gaps remain.
- Current evidence is mostly deterministic local/mock, bounded fixture, and documentation evidence. Real-provider dogfood is manual local BYOK evidence only and is not CI evidence.
- Production release surfaces such as signing, notarization, marketplace publication, update channels, support process, and incident response are not complete production gates.
- Long-running reliability, performance, observability, and recovery evidence is not yet sufficient for a production-like agent decision.

## Risk categories and required evidence

| Category | Current known gaps | Acceptance evidence required before a production-like decision |
| --- | --- | --- |
| Security | Threat model coverage is incomplete for provider-backed proposals, host bridges, local runtime endpoints, packaged artifacts, update channels, and report/export flows. | Reviewed threat model; deny-by-default authority matrix; bridge/runtime schema tests; secret-handling audit; dependency and artifact vulnerability scan; sanitized evidence that raw secrets, private paths, raw prompts, file bodies, diffs, command material, provider payloads, and bridge payloads are not persisted or exposed. |
| Authority model | Current authority is intentionally narrow: explicit Start/Stop, bounded selected context, bounded replacement edits, fixed command-id verification, and at most one user-confirmed repair attempt in dev-preview evidence. Future sprints may add context, provider proposal, dry-run plan, memory, or host capability features that need renewed authority review. | A single authority registry that enumerates allowed reads, edits, command ids, provider use, memory use, host actions, storage writes, exports, and unsupported actions; schema fixtures for safe and unsafe cases; fail-closed host behavior across Browser, VS Code, and JetBrains; proof that unsupported hosts do not mint privileged requests. |
| User experience | UX still emphasizes dev-preview status and host limitations. Production-like user trust needs clearer consent, progress, stop, failure, recovery, and evidence review patterns across hosts. Current copy and smoke evidence do not yet prove that users understand when a run is safe to start, what context is included, which host owns each action, how to stop, what happens after verification fails, or how to review final evidence without reading raw private data. | Usability review for Start, Stop, consent, context selection, edit review, verification, repair eligibility, final report, unsupported states, and dangerous-action copy; accessibility checks; screenshots or smoke reports for Browser, VS Code, and JetBrains states; evidence that packaged UI copy still says dev-preview where appropriate; proof of no misleading production, release, marketplace, or cross-host parity wording. |
| CI/CD | Existing checks are local/mock and docs/fixture oriented. Real-provider, packaged, cross-platform, long-run, and flaky-smoke evidence are not complete CI gates. The project needs a clear line between deterministic CI evidence, optional packaged smoke evidence, and manual local BYOK dogfood so a failed or skipped host smoke cannot be quietly mistaken for approval. | Stable CI matrix with deterministic unit, contract, GUI, plugin, packaging, wording, docs, and artifact checks; explicit quarantine policy for flaky smokes with owners and expiry dates; sanitized logs; no credentials in automation; platform matrix for supported runners; separate manual BYOK evidence path that is not treated as CI approval. |
| Host parity | Browser is preview-only for trusted workspace execution; VS Code is first host for implemented controlled slices; JetBrains remains partial/fail-closed where parity is absent. Capability labels can drift from the actual bridge host, and packaged wrappers may show stale or optimistic limitation copy without host-owned proof. | Host capability negotiation v2 evidence correlated to the current bridge host; Browser unsupported-state tests; VS Code execution-path tests; JetBrains parity or explicit fail-closed tests; packaged wrapper limitation-copy checks; proof that unsupported hosts do not mint privileged requests; user-facing limitation copy aligned across GUI, docs, and packaged wrappers. |
| Recovery | Stop, stale result, disconnect, failed verification, and one user-confirmed repair attempt have dev-preview evidence, but production-like resilience needs broader fault injection and rollback review proof. Recovery UX also needs clear user choices after provider timeout, edit mismatch, package/runtime interruption, and repair exhaustion. | Deterministic recovery matrix for Stop, stale/duplicate events, host disconnect, runtime restart, provider timeout, edit hash mismatch, verification failure, repair exhaustion, checkpoint/rollback review, interrupted package/runtime update, and packaged wrapper reconnect; screenshots or reports proving recovery remains user-visible and does not become unbounded automatic retry or rollback. |
| Persistence and privacy | Sanitized metadata is the intended boundary, but future run history, task queue, memory integration, observability, dogfood reports, and export features expand privacy review scope. User controls for clearing history, exports, logs, and local evidence are not yet production-ready. | Storage inventory for browser, GUI, engine, plugin, runtime, logs, reports, exports, memory, dogfood evidence, and package artifacts; retention/deletion policy; migration plan; raw-data exclusion tests; local-only credential handling proof; user controls for clearing history, logs, reports, exports, and local dogfood evidence. |
| Performance | Current useful-run evidence does not establish sustained latency, memory, CPU, startup, package size, large-workspace behavior, long-running controlled sessions, or packaged wrapper startup behavior. | Benchmarks for startup, provider request orchestration, bounded context preparation, edit request handling, verification result handling, report rendering, packaged wrapper startup, memory growth, long-run sessions, and large-repository safeguards; budgets with regression thresholds. |
| Packaging and release operations | Dev-preview artifacts are unsigned/unpublished validation outputs. Production packaging, update, rollback, support, and provenance gates are not complete, and packaged evidence does not yet prove install, upgrade, uninstall, or user-facing recovery UX. | Signed/notarized artifact plan when approved; marketplace metadata review; SBOM/provenance manifest; update and rollback policy; artifact retention policy; install/upgrade/uninstall tests; packaged wrapper parity evidence; support and incident-response runbook; clear separation between dev-preview and production channels. |
| Real-provider dogfood | Manual local BYOK dogfood may exist, but it is not automated real-provider CI and must not expose credentials or raw provider responses. Current useful-run dogfood still needs repeatable host, provider-family, local runtime, failure, and recovery coverage before production-like trust. | Sanitized manual dogfood reports across provider families, local runtimes, and supported host surfaces; provider error/fallback matrix; cost and rate-limit guidance; recovery observations; no hosted Yet AI backend/account/gateway requirement; no secrets or raw prompts/responses in tracked evidence; explicit statement that manual BYOK evidence complements but does not replace deterministic tests. |
| Observability | Existing trace/report work is sanitized metadata only. Production-like operations need enough diagnostics for support without raw leakage, including clear correlation across GUI, runtime, bridge, host, provider, recovery, export, and packaged wrapper events. | Event taxonomy for run lifecycle, authority decisions, host capability decisions, provider interactions, failures, recovery, exports, package/runtime diagnostics, and dogfood reports; bounded metrics; redaction tests; correlation-id policy; local log retention controls; sanitized export validator; support triage checklist. |

## Security and authority production gaps

This section records the Sprint 107 security/authority audit detail. It is not an approval gate. Each item below is a gap statement plus the evidence that must exist before any later production-like decision can be considered.

### Threat model gaps

The current threat model is incomplete for the controlled-agent path. A future review must cover at least these abuse cases:

- Malicious or confused model output attempts to mint capability metadata, request ids, file paths, command ids, provider calls, tool calls, memory writes, exports, or host actions.
- A compromised or stale GUI frame replays old run ids, readiness ids, host-ready generations, bridge payloads, or terminal results.
- A provider response includes prompt injection that asks for hidden reads, broad edits, free-form shell use, raw secret disclosure, raw file body persistence, or unbounded retry behavior.
- Local runtime endpoints, packaged wrapper ports, plugin webviews, and report/export surfaces receive malformed or cross-origin messages.
- Dependency, package, update, or artifact tampering changes bridge schemas, safe labels, command ids, packaged runtime bits, or generated GUI/plugin assets.
- Support or diagnostic workflows accidentally capture private paths, raw prompts, file bodies, diffs, command material, provider payloads, tokens, cookies, or bridge payloads.

Required evidence before a production-like decision: a reviewed threat model with owner, date, affected host/runtime/provider/storage surfaces, mitigations, residual risks, and tests or manual checks for every abuse case above.

### Authority boundaries and registry gaps

The implemented controlled slices remain deliberately narrow. Today, the trustworthy boundary is explicit user action plus host-owned validation; capability metadata is display and prerequisite data only. It never grants read, edit, verification, provider, tool, memory, export, shell, git, package, network, or release authority. Browser remains preview-only for trusted workspace execution, VS Code is the first dev-preview host for implemented bounded paths, and JetBrains must remain fail-closed until a future verified parity card changes the boundary.

A future authority registry must enumerate:

- Allowed read authority: exact host surface, one selected safe workspace-relative text target, size/line limits, path validation, correlation fields, sanitized result shape, and unsupported cases.
- Allowed edit authority: existing-file replacement only, safe workspace-relative target, pre-edit hash requirement, bounded replacement limits, user-visible review, result correlation, and unsupported mutation types.
- Allowed verification authority: fixed command-id list, explicit user click, timeout/output-tail bounds, no command strings, no cwd/env/args authority, no shell expansion, and no model-selected command path.
- Provider authority: which code owns provider selection and credentials, what proposal material may be sent, how BYOK remains local-first, and which provider/tool calls remain unsupported.
- Memory, run history, report, export, and observability authority: what sanitized fields may be written, retained, deleted, or exported, and which raw fields are forbidden.
- Host actions and unsupported operations: open/reveal/context preview actions, start/stop boundaries, repair eligibility, rollback review, package/update operations, and every unsupported privileged action.

Required evidence before a production-like decision: a single source-of-truth authority registry linked from this audit, contract fixtures for safe and unsafe messages, host fail-closed tests for Browser and JetBrains, VS Code execution-path tests for each allowed slice, and proof that unsupported hosts cannot produce privileged bridge requests.

### Secrets, provider data, and credential handling gaps

The local-first BYOK contract requires provider settings and credentials to remain local-only. GUI-facing save flows must not persist or echo raw provider secrets after save, and tracked evidence must not include secrets or raw provider payloads. The production gap is that the current audit does not yet link a complete credential-flow proof across GUI, engine, plugin, local runtime, logs, crash reports, exports, and packaged wrappers.

Required evidence before a production-like decision:

- Secret inventory for provider keys, session tokens, cookies, local runtime tokens, plugin settings, environment variables, OS keychain entries, logs, reports, and exports.
- Tests or manual review proving raw secrets are redacted from GUI responses, bridge messages, local storage, run history, traces, reports, exports, CI logs, package manifests, and support bundles.
- Credential lifecycle policy for creation, storage, rotation, deletion, migration, and failure recovery.
- Manual BYOK dogfood template that records provider family, local runtime family, errors, cost/rate-limit notes, and redaction status without raw prompts, responses, credentials, or private paths.

### Persistence, privacy, and export gaps

Sanitized metadata is the intended persistence boundary, but future run history, memory integration, task queues, trace export, support bundles, and packaged diagnostics increase privacy scope. The current evidence is not enough to prove raw-data exclusion or deletion behavior across browser storage, GUI state, engine storage, plugin settings, runtime logs, memory files, package artifacts, and exported reports.

Required evidence before a production-like decision:

- Storage inventory by component, field name, retention duration, deletion control, migration path, and whether the field is sanitized metadata or forbidden raw data.
- Tests for raw prompt, raw response, file body, diff, replacement text, command material, output dump, bridge payload, private path, token, cookie, and secret exclusion.
- Export validator for trace/report/support bundles with fixed redaction rules and failing fixtures for unsafe payloads.
- User controls for clearing local history, reports, exports, and memory surfaces, with documented limits for files managed outside Yet AI.

### Host capability and CI evidence gaps

Host capability negotiation v2 is a design record and safe-label contract, not executable authority. Production-like confidence requires evidence that GUI labels, bridge contracts, plugin hosts, local runtime readiness, and CI gates agree on the same fail-closed behavior.

Required evidence before a production-like decision:

- Capability snapshot contract tests for supported, preview-only, unsupported, disabled, degraded, unknown, stale, malformed, and mismatched states.
- Cross-host smoke or contract evidence that Browser cannot start trusted workspace execution, VS Code only enables implemented bounded dev-preview paths after all correlation and readiness checks, and JetBrains remains visibly fail-closed where parity is absent.
- CI matrix covering wording audit, docs index, contracts, GUI, engine, VS Code plugin, JetBrains plugin, packaging artifacts, generated assets, dependency scanning, and artifact provenance.
- A quarantine policy for flaky browser/plugin smokes and a rule that manual real-provider BYOK reports complement deterministic checks but do not replace them.
- Sanitized CI log retention and evidence links that contain no credentials, raw prompts, file bodies, diffs, command material, provider payloads, private paths, or bridge dumps.

### Unsafe operations that remain blocked

The following operations remain blockers unless a later architecture decision, implementation card, and evidence package explicitly narrows and verifies them:

- Browser trusted workspace read, edit, verification, or controlled run start.
- JetBrains controlled execution parity for read, edit, verification, repair eligibility, or one-step loop.
- Workspace search, indexing, background context gathering, broad multi-file read, generated/dependency/binary/symlink traversal, or hidden file discovery.
- File create, delete, rename, move, chmod, patch-format mutation, broad directory mutation, or mutation outside a safe workspace-relative existing text file.
- Free-form command text, arbitrary command execution, args/cwd/env selection, shell/git/package/network execution, model-selected command ids, provider-tool calls, or local-tool calls.
- Unbounded retry, repeated repair attempts, unattended rollback, silent checkpoint restore, task-board mutation, release publication, update publication, signing, notarization, marketplace publication, or support escalation without a documented human-owned process.
- Persistence or export of raw prompts, provider responses, file bodies, diffs, replacements, command material, output dumps, private paths, tokens, cookies, secrets, stack traces, bridge payloads, or provider payloads.

### Remaining production blockers

Security and authority cannot pass a production-like gate until the following blockers are closed or explicitly accepted by dated risk decision:

- Threat model and authority registry are incomplete.
- Host capability v2 remains a design record without full schema, fixture, and cross-host evidence.
- Secret-handling, storage inventory, redaction tests, retention/deletion policy, and export validation are incomplete.
- CI does not yet provide packaged, cross-host, cross-platform, dependency, provenance, long-run, and recovery evidence.
- Manual real-provider BYOK dogfood is not structured enough to prove provider-family behavior, and it must not become CI approval.
- Packaging, update, rollback, signing/notarization, marketplace, support, and incident-response gates are incomplete.
- Observability and support diagnostics are not yet proven useful without raw data leakage.

## Future evidence checklist

Before any production-like agent decision, create or link evidence for every item below:

- Security review complete, with unresolved risks assigned and dated.
- Authority registry complete, with safe/unsafe fixtures and host fail-closed proof.
- UX review complete for consent, limitation copy, recovery, final reports, and unsupported hosts.
- CI/CD gate defined, stable, and separated from manual real-provider dogfood.
- Host parity matrix complete, including explicit unsupported behavior where parity is absent.
- Recovery matrix complete for stop, stale, disconnect, verification failure, edit mismatch, repair exhaustion, and rollback review.
- Persistence/privacy inventory complete for all local storage, logs, reports, exports, and memory surfaces.
- Performance budgets measured and regression thresholds documented.
- Packaging/release operations documented and verified for the intended channel.
- Real-provider dogfood reports sanitized and reviewed without secrets or raw provider payloads.
- Observability export/logging validated for useful support diagnostics without raw leakage.

## Verification

For this scaffold, run:

```sh
npm run audit:controlled-autonomy-wording && npm run check && git diff --check && git status --short
```
