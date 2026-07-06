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
| User experience | UX still emphasizes dev-preview status and host limitations. Production-like user trust needs clearer consent, progress, stop, failure, recovery, and evidence review patterns across hosts. | Usability review for Start, Stop, consent, context selection, edit review, verification, repair eligibility, final report, unsupported states, and dangerous-action copy; accessibility checks; screenshots or smoke reports showing no misleading production, release, marketplace, or cross-host parity wording. |
| CI/CD | Existing checks are local/mock and docs/fixture oriented. Real-provider, packaged, cross-platform, and long-run evidence are not complete CI gates. | Stable CI matrix with deterministic unit, contract, GUI, plugin, packaging, wording, docs, and artifact checks; explicit quarantine policy for flaky smokes; sanitized logs; no credentials in automation; separate manual BYOK evidence path that is not treated as CI approval. |
| Host parity | Browser is preview-only for trusted workspace execution; VS Code is first host for implemented controlled slices; JetBrains remains partial/fail-closed where parity is absent. | Host capability negotiation v2 evidence; Browser unsupported-state tests; VS Code execution-path tests; JetBrains parity or explicit fail-closed tests; user-facing limitation copy aligned across GUI, docs, and packaged wrappers. |
| Recovery | Stop, stale result, disconnect, failed verification, and one user-confirmed repair attempt have dev-preview evidence, but production-like resilience needs broader fault injection and rollback review proof. | Deterministic recovery matrix for Stop, stale/duplicate events, host disconnect, runtime restart, provider timeout, edit hash mismatch, verification failure, repair exhaustion, checkpoint/rollback review, and interrupted package/runtime update; evidence that recovery remains user-visible and does not become unbounded automatic retry or rollback. |
| Persistence and privacy | Sanitized metadata is the intended boundary, but future run history, task queue, memory integration, and export features expand privacy review scope. | Storage inventory for browser, GUI, engine, plugin, runtime, logs, reports, exports, memory, and package artifacts; retention/deletion policy; migration plan; raw-data exclusion tests; local-only credential handling proof; user controls for clearing history and exports. |
| Performance | Current useful-run evidence does not establish sustained latency, memory, CPU, startup, package size, or large-workspace behavior. | Benchmarks for startup, provider request orchestration, bounded context preparation, edit request handling, verification result handling, report rendering, packaged wrapper startup, memory growth, and large-repository safeguards; budgets with regression thresholds. |
| Packaging and release operations | Dev-preview artifacts are unsigned/unpublished validation outputs. Production packaging, update, rollback, support, and provenance gates are not complete. | Signed/notarized artifact plan when approved; marketplace metadata review; SBOM/provenance manifest; update and rollback policy; artifact retention policy; install/upgrade/uninstall tests; support and incident-response runbook; clear separation between dev-preview and production channels. |
| Real-provider dogfood | Manual local BYOK dogfood may exist, but it is not automated real-provider CI and must not expose credentials or raw provider responses. | Sanitized manual dogfood reports across provider families and local runtimes; provider error/fallback matrix; cost and rate-limit guidance; no hosted Yet AI backend/account/gateway requirement; no secrets or raw prompts/responses in tracked evidence; explicit statement that manual BYOK evidence complements but does not replace deterministic tests. |
| Observability | Existing trace/report work is sanitized metadata only. Production-like operations need enough diagnostics for support without raw leakage. | Event taxonomy for run lifecycle, authority decisions, host capability decisions, provider interactions, failures, recovery, exports, and package/runtime diagnostics; bounded metrics; redaction tests; correlation-id policy; local log retention controls; sanitized export validator; support triage checklist. |

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
