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

## Final through-S107 audit status

The through-S107 audit result is still **blocked for any production-like agent decision** and **allowed only as controlled local dev-preview evidence**. The completed S96-S107 work improves the evidence trail for narrow, explicit user-started runs, but it does not ship a production autonomous agent, does not approve broader workspace authority, and does not create release, marketplace, support, signing, notarization, hosted backend, or real-provider CI approval.

Evidence now available after S96-S107:

- **S96 useful-run contract**: documents the VS Code-first one-step useful-run target with explicit Start, one bounded read, one bounded replacement edit, one allowlisted verification command id, and one sanitized terminal report.
- **S102 replacement contract**: adds the review-only `controlled_agent_patch_plan` dry-run metadata contract with execution, apply, provider/tool, search, and raw-payload authority absent.
- **S104 memory smoke**: keeps controlled-run project memory as explicit user-selected attachment metadata only, with no automatic memory injection, indexing, background relevance search, provider memory writes, bridge authority, runtime authority, or raw note-body persistence in reports/traces/dogfood evidence.
- **S105 observability smoke**: verifies controlled-run trace/report/export evidence remains sanitized metadata and rejects raw prompts, file bodies, diffs, command material, provider payloads, secrets, private paths, and bridge payload dumps.
- **S106 beta report validator**: adds a deterministic local validator for sanitized controlled dev-preview beta dogfood notes, including a safe template/check/self-test path and unsafe evidence rejection without provider calls, runtime launch, artifact publication, or production approval.

Remaining blockers are not closed by those evidence items. After S109, `docs/architecture/018-controlled-agent-authority-registry.md` is the source-of-truth authority vocabulary and safe/unsafe fixture foundation for later S110-S124 capability expansion. That foundation updates the first S107 blocker from "decide the owner and shape" to "use and extend the registry only through scoped verified cards." It is still evidence routing, not runtime permission or production autonomy.

The next decisions before any later production-like gate are:

1. Extend the S109 authority registry only through scoped cards with architecture updates, schema/fixture changes, host-owned tests, GUI evidence, and fail-closed unsafe cases before widening reads, search, edits, command ids, provider use, memory use, host actions, storage writes, exports, or unsupported operations.
2. Decide the host-parity plan: VS Code execution evidence scope, Browser unsupported-state proof, and whether JetBrains remains fail-closed or gets a separate verified parity track.
3. Decide the privacy/storage workstream for credential-flow proof, storage inventory, retention/deletion controls, export validation, support-bundle redaction, and local log handling.
4. Decide the CI/CD and packaging evidence strategy, including deterministic gate matrix, flaky-smoke quarantine, cross-platform/package evidence, dependency/provenance checks, update/rollback policy, and clear separation from manual local BYOK dogfood.
5. Decide the real-provider dogfood policy for sanitized local BYOK reports across provider families and failure/recovery paths, with no credentials, raw prompts, raw responses, private paths, or hosted Yet AI backend/account/gateway requirement.
6. Decide the UX/recovery review scope for consent, Start/Stop, edit review, verification, one repair attempt, repair exhaustion, disconnects, stale results, provider timeout, rollback review, and final report comprehension across supported and unsupported hosts.

## Through-S124 useful multi-file controlled agent status

S124 adds `docs/architecture/028-useful-multifile-controlled-agent-decision.md` as the decision evidence summary for S109-S123. The through-S124 status remains **blocked for any production-like or release-like agent decision** and **partial/pass only for narrow VS Code-first controlled dev-preview hardening**.

Evidence now available after S109-S123:

- **S109 authority registry**: source-of-truth authority vocabulary, schema, safe fixture, unsafe fixtures, and `npm run check:controlled-agent-authority-registry` evidence for deny-by-default routing. This is a pass for dev-preview evidence vocabulary, not runtime permission or production autonomy.
- **S110-S112 explicit lexical search and selection**: contract/local smoke evidence for bounded literal search and GUI-local user selection, plus focused VS Code executor evidence for real lexical search. This is partial because Browser remains unsupported, JetBrains remains fail-closed, and no hidden indexing or broad search is approved.
- **S113 search-informed proposal**: contract and fixture evidence for provider proposal metadata informed only by explicit selected evidence. This is partial because no provider-call implementation or real-provider CI proof is added.
- **S114-S116 multi-file patch review/apply**: bounded review metadata, GUI request construction, bridge fixtures, and VS Code-focused apply evidence. This is partial because apply remains explicit VS Code-only and packaged parity, rollback, long-run, Browser, and JetBrains evidence remain incomplete.
- **S117-S118 verification bundle and follow-up**: schema/fixture evidence for allowlisted command-id bundles and manual follow-up metadata. This is partial because there is no production runner, shell authority, automatic repair, or real command-output redaction proof across all surfaces.
- **S119-S121 two-step state, recovery matrix, and task presets**: deterministic local/mock GUI and contract evidence for staged review/execution gates, visible recovery guidance, and safe task-starting presets. These pass as display-only or metadata lanes and remain partial for executable orchestration.
- **S122-S123 dogfood and beta gate**: manual local BYOK real-provider matrix template/check/self-test and packaged task-level beta report validator plus `npm run smoke:controlled-agent-task-beta-bundle`. These pass as sanitized template/local bundle evidence and remain partial because they are not real-provider CI, packaged install proof, release approval, or marketplace approval.

Through-S124 decision recommendation: continue with **hardening** before broader autonomy/search expansion or release work. Required next evidence remains host-owned VS Code execution proof for currently displayed lanes, stable deterministic CI/quarantine policy, storage/privacy inventory, support-useful observability and export redaction, packaged install/update/recovery evidence, and repeatable sanitized manual BYOK reports across provider/runtime families.

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
| S109 authority registry foundation | The S109 registry now exists as the source-of-truth vocabulary and fixture-backed evidence foundation in `docs/architecture/018-controlled-agent-authority-registry.md`. Controlled Agent Run may display its sanitized status as evidence only. The registry foundation does not grant Start, search, apply, verification, provider, memory, shell, git, network, storage, release, production, or host-parity authority. | Future S110-S124 cards must cite and update the registry when they narrow a category, add schema/fixture proof, add host-owned tests, preserve Browser/JetBrains fail-closed behavior, and prove the GUI renders sanitized labels/counts/booleans without raw registry payloads or action authority. |
| User experience | UX still emphasizes dev-preview status and host limitations. Production-like user trust needs clearer consent, progress, stop, failure, recovery, and evidence review patterns across hosts. Current copy and smoke evidence do not yet prove that users understand when a run is safe to start, what context is included, which host owns each action, how to stop, what happens after verification fails, or how to review final evidence without reading raw private data. | Usability review for Start, Stop, consent, context selection, edit review, verification, repair eligibility, final report, unsupported states, and dangerous-action copy; accessibility checks; screenshots or smoke reports for Browser, VS Code, and JetBrains states; evidence that packaged UI copy still says dev-preview where appropriate; proof of no misleading production, release, marketplace, or cross-host parity wording. |
| CI/CD | Existing checks are local/mock and docs/fixture oriented. Real-provider, packaged, cross-platform, long-run, and flaky-smoke evidence are not complete CI gates. The project needs a clear line between deterministic CI evidence, optional packaged smoke evidence, and manual local BYOK dogfood so a failed or skipped host smoke cannot be quietly mistaken for approval. | Stable CI matrix with deterministic unit, contract, GUI, plugin, packaging, wording, docs, and artifact checks; explicit quarantine policy for flaky smokes with owners and expiry dates; sanitized logs; no credentials in automation; platform matrix for supported runners; separate manual BYOK evidence path that is not treated as CI approval. |
| Host parity | Browser is preview-only for trusted workspace execution; VS Code is first host for implemented controlled slices; JetBrains remains partial/fail-closed where parity is absent. Capability labels can drift from the actual bridge host, and packaged wrappers may show stale or optimistic limitation copy without host-owned proof. | Host capability negotiation v2 evidence correlated to the current bridge host; Browser unsupported-state tests; VS Code execution-path tests; JetBrains parity or explicit fail-closed tests; packaged wrapper limitation-copy checks; proof that unsupported hosts do not mint privileged requests; user-facing limitation copy aligned across GUI, docs, and packaged wrappers. |
| Recovery | Stop, stale result, disconnect, failed verification, and one user-confirmed repair attempt have dev-preview evidence, but production-like resilience needs broader fault injection and rollback review proof. Recovery UX also needs clear user choices after provider timeout, edit mismatch, package/runtime interruption, and repair exhaustion. | Deterministic recovery matrix for Stop, stale/duplicate events, host disconnect, runtime restart, provider timeout, edit hash mismatch, verification failure, repair exhaustion, checkpoint/rollback review, interrupted package/runtime update, and packaged wrapper reconnect; screenshots or reports proving recovery remains user-visible and does not become unbounded automatic retry or rollback. |
| Persistence and privacy | Sanitized metadata is the intended boundary, but future run history, task queue, memory integration, observability, dogfood reports, and export features expand privacy review scope. User controls for clearing history, exports, logs, and local evidence are not yet production-ready. | Storage inventory for browser, GUI, engine, plugin, runtime, logs, reports, exports, memory, dogfood evidence, and package artifacts; retention/deletion policy; migration plan; raw-data exclusion tests; local-only credential handling proof; user controls for clearing history, logs, reports, exports, and local dogfood evidence. |
| Performance | Current useful-run evidence does not establish sustained latency, memory, CPU, startup, package size, large-workspace behavior, long-running controlled sessions, or packaged wrapper startup behavior. | Benchmarks for startup, provider request orchestration, bounded context preparation, edit request handling, verification result handling, report rendering, packaged wrapper startup, memory growth, long-run sessions, and large-repository safeguards; budgets with regression thresholds. |
| Packaging and release operations | Dev-preview artifacts are unsigned/unpublished validation outputs. Production packaging, update, rollback, support, and provenance gates are not complete, and packaged evidence does not yet prove install, upgrade, uninstall, or user-facing recovery UX. | Signed/notarized artifact plan when approved; marketplace metadata review; SBOM/provenance manifest; update and rollback policy; artifact retention policy; install/upgrade/uninstall tests; packaged wrapper parity evidence; support and incident-response runbook; clear separation between dev-preview and production channels. |
| Real-provider dogfood | Manual local BYOK dogfood may exist, but it is not automated real-provider CI and must not expose credentials or raw provider responses. Current useful-run dogfood still needs repeatable host, provider-family, local runtime, failure, and recovery coverage before production-like trust. | Sanitized manual dogfood reports across provider families, local runtimes, and supported host surfaces; provider error/fallback matrix; cost and rate-limit guidance; recovery observations; no hosted Yet AI backend/account/gateway requirement; no secrets or raw prompts/responses in tracked evidence; explicit statement that manual BYOK evidence complements but does not replace deterministic tests. |
| Observability | Existing trace/report work is sanitized metadata only. Production-like operations need enough diagnostics for support without raw leakage, including clear correlation across GUI, runtime, bridge, host, provider, recovery, export, and packaged wrapper events. | Event taxonomy for run lifecycle, authority decisions, host capability decisions, provider interactions, failures, recovery, exports, package/runtime diagnostics, and dogfood reports; bounded metrics; redaction tests; correlation-id policy; local log retention controls; sanitized export validator; support triage checklist. |

## Production-like autonomous agent risk register

This register is a planning artifact for a later production-like decision. It does not approve broader autonomy, background execution, hidden workspace access, provider/tool authority, shell authority, persistence expansion, or release operations. Severity describes potential impact if the risk escapes the current dev-preview boundary; it is not a statement that the feature is ready.

| Risk | Severity | Mitigation | Evidence needed | Owner area |
| --- | --- | --- | --- | --- |
| Hidden authority or scope creep | Critical | Keep a deny-by-default authority registry; require explicit user action, host-owned validation, bounded selected context, fixed command ids, and fail-closed unsupported hosts before any privileged action. | Authority registry with safe/unsafe fixtures; bridge/runtime schema tests; Browser and JetBrains fail-closed tests; VS Code path tests for every allowed read, edit, verification, and repair slice. | Engine, GUI, VS Code plugin, JetBrains plugin |
| Raw data leakage through traces, reports, exports, logs, or support bundles | Critical | Treat sanitized metadata as the only default persistence/export boundary; block raw prompts, provider responses, file bodies, diffs, replacements, command material, private paths, secrets, tokens, cookies, bridge payloads, and provider payloads. | Storage inventory; redaction tests; unsafe export fixtures; sanitized support-bundle validator; manual review of CI logs, local logs, run reports, and packaged diagnostics. | Engine, GUI, observability, support operations |
| Provider or tool calls gain unintended authority | Critical | Keep BYOK provider credentials local-only; make provider proposal flows explicit and bounded; forbid provider-tool and local-tool calls until an architecture decision, implementation card, and evidence package narrow them. | Credential-flow proof across GUI, engine, plugins, runtime, logs, exports, and packages; provider request/response redaction review; prompt-injection tests; manual BYOK dogfood reports without raw prompts, responses, or credentials. | Engine, provider adapters, GUI |
| Command execution expands beyond fixed verification ids | Critical | Preserve fixed command-id verification, explicit user click, timeout/output-tail bounds, and no command strings, args, cwd, env, shell expansion, git, package, or network authority. | Command registry review; unsafe command fixture tests; host bridge tests proving model-selected command text is rejected; verification smoke reports with bounded output. | Engine, VS Code plugin, GUI |
| CI reliability or flaky smokes create false production confidence | High | Separate deterministic CI gates from optional packaged smokes and manual local BYOK dogfood; require quarantine owners, expiry dates, sanitized logs, and explicit non-approval wording for skipped or quarantined evidence. | Stable CI matrix; flaky-smoke quarantine policy; repeated green runs for wording, docs, contracts, GUI, plugins, packaging, artifact provenance, and dependency checks; evidence links with no secrets or raw data. | CI/CD, release engineering |
| Host parity drift creates misleading controls or labels | High | Correlate capability snapshots to the current bridge host; keep Browser unsupported for trusted workspace execution and JetBrains fail-closed unless host-owned parity proof exists; align limitation copy across GUI, docs, and packaged wrappers. | Capability negotiation v2 fixtures for supported, preview-only, unsupported, disabled, degraded, unknown, stale, malformed, and mismatched states; Browser unsupported-state tests; VS Code execution tests; JetBrains parity or fail-closed tests. | GUI, VS Code plugin, JetBrains plugin, packaging |
| UX confusion causes unsafe consent, review, stop, or recovery decisions | High | Keep dev-preview status visible; require clear Start/Stop, context selection, edit review, verification, one repair attempt, final report, unsupported state, and dangerous-action copy across hosts. | Usability review; accessibility checks; screenshots or smoke reports for Browser, VS Code, and JetBrains; copy audit proving no misleading production, release, marketplace, or cross-host parity claims. | GUI, UX, documentation |
| Recovery failure leads to unbounded retry, stale result use, or hidden rollback | High | Keep recovery user-visible and bounded; require one user-confirmed repair attempt at most until a later gate; reject stale/duplicate events; require explicit rollback/checkpoint review. | Fault-injection matrix for Stop, stale/duplicate events, disconnect, runtime restart, provider timeout, edit hash mismatch, verification failure, repair exhaustion, package/runtime interruption, and reconnect. | Engine, GUI, host plugins |
| Performance or resource use blocks safe production-like operation | Medium | Define budgets and regression thresholds before broad enablement; keep context bounded and guard large repositories, long sessions, packaged startup, report rendering, and memory growth. | Benchmarks for startup, bounded context preparation, provider orchestration, edit handling, verification result handling, report rendering, packaged wrapper startup, memory growth, long-run sessions, and large-repository safeguards. | Engine, GUI, packaging, CI/CD |
| Persistence migration corrupts or exposes local history, memory, credentials, or reports | High | Version storage schemas; provide retention/deletion controls; keep credential storage separate from GUI-facing state; require migration rollback and raw-data exclusion tests before changing persisted surfaces. | Storage schema inventory; migration plan with rollback cases; deletion/retention tests; raw-data exclusion tests for browser storage, GUI state, engine storage, plugin settings, runtime logs, memory files, package artifacts, and exports. | Engine, GUI, plugins, product identity/storage |

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

The implemented controlled slices remain deliberately narrow. Today, the trustworthy boundary is explicit user action plus host-owned validation; capability metadata and registry status are display and prerequisite evidence only. They never grant read, search, edit, verification, provider, tool, memory, export, shell, git, package, network, release, storage, or host-action authority. Browser remains preview-only for trusted workspace execution, VS Code is the first dev-preview host for implemented bounded paths, and JetBrains must remain fail-closed until a future verified parity card changes the boundary.

S109 created the single source-of-truth authority registry in `docs/architecture/018-controlled-agent-authority-registry.md`, with schema and safe/unsafe fixtures for reads, lexical search, edits, verification command ids, provider proposal use, memory attachment, run-history/report/export/observability writes, host actions, and unsupported privileged operations. That closes the ownership/shape decision for the registry foundation, but it does not close production readiness or broader autonomy. Later cards must update the registry before widening any category and must keep its deny-by-default, user-gesture, host-support, local-first BYOK, sanitized-metadata, and unsupported-host rules intact.

Required evidence before a production-like decision: maintained S109 authority registry with safe and unsafe fixtures, host fail-closed tests for Browser and JetBrains, VS Code execution-path tests for each allowed slice, GUI tests proving registry status renders only sanitized labels/counts/booleans without raw payloads, and proof that unsupported hosts cannot produce privileged bridge requests.

### Project memory attachment boundary

Until a later authority registry intentionally changes it, controlled-run project memory is explicit attachment only. The allowed dev-preview boundary is user-selected local project memory notes, carried into the current controlled run through the visible one-shot attachment path. There is no automatic memory injection from project history, run history, trace labels, suggestions, search results, prior sessions, capability metadata, or model/provider output.

Safe memory metadata may include sanitized note ids, user-visible safe titles, short safe summaries, task/session labels, attach status, and bounded counts. Raw note bodies must not appear in final reports, traces, dogfood reports, smoke output, browser storage, bridge payload dumps, or GUI-facing status after save. A raw note body may enter only the transient explicit run context when the user selected that note and the note passes safe-content checks. If a note body contains or resembles secrets, credentials, private absolute paths, raw prompts, provider responses, file bodies, diffs, replacement text, command material, full output dumps, bridge payloads, stack traces, or arbitrary unreviewed private text, the body is unsafe and must be omitted with a sanitized omitted/unsafe label.

This boundary does not grant memory indexing, background relevance search, automatic selection, provider/tool memory writes, task-board mutation, storage migration, export authority, bridge authority, runtime authority, hidden workspace reads, or production autonomy. Required future evidence before widening memory use: safe/unsafe fixtures for memory notes, raw-body exclusion tests, no-secret/private-path evidence across GUI/runtime/plugin/report surfaces, explicit re-selection behavior for later runs, and host fail-closed proof that unsupported surfaces cannot mint privileged memory attachments.

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
