# 028 Useful Multi-file Controlled Agent Decision

This S124-C1 decision summarizes the S109-S123 evidence trail for the useful multi-file controlled coding agent gate. It is an evidence summary only. It does not add implementation, widen authority, approve production, approve release, approve marketplace publication, approve signing or notarization, or convert manual local BYOK dogfood into CI.

## Decision scope

The reviewed target is a VS Code-first dev-preview controlled coding flow that can support useful small multi-file tasks when every privileged step remains explicit, bounded, reviewed, and sanitized:

1. authority vocabulary and fail-closed boundaries;
2. explicit lexical search and user selection;
3. provider proposal metadata informed by selected evidence;
4. bounded multi-file patch review and explicit apply;
5. allowlisted verification bundle metadata;
6. manual follow-up and recovery states;
7. two-step run state and task presets;
8. real-provider dogfood matrix and packaged task-level beta gate.

The decision question is not whether Yet AI is production-ready. The question is whether the S109-S123 evidence is sufficient to choose the next roadmap emphasis.

## Summary judgment

**Overall decision status: partial.**

**Recommendation: hardening next, not broader autonomy or release work.**

S109-S123 establish a useful dev-preview spine for controlled multi-file work: deny-by-default authority vocabulary, explicit search and selection, bounded provider proposal metadata, bounded patch-plan review, VS Code-focused apply evidence, staged two-step state, visible recovery guidance, task presets, manual real-provider dogfood templates, and a packaged task-level beta smoke bundle. That is enough to continue hardening the VS Code-first controlled task flow.

It is not enough to expand into broader autonomy, hidden search, unattended repair, arbitrary shell, production release, marketplace publication, signing/notarization, or real-provider CI. The next roadmap should prioritize hardening: host-owned VS Code execution proof for every currently displayed lane, CI stability, privacy/storage inventory, support-useful observability, packaged install/update/recovery evidence, and repeatable sanitized dogfood across provider/runtime families.

## Evidence classification

| Sprint | Area | Status | Evidence | Residual risk |
| --- | --- | --- | --- | --- |
| S109 | Authority registry | Pass for dev-preview evidence routing; blocked for production authority | `docs/architecture/018-controlled-agent-authority-registry.md`; `packages/contracts/schemas/engine/controlled-agent-authority-registry.schema.json`; `packages/contracts/examples/engine/controlled-agent-authority-registry-v1.json`; invalid authority fixtures; `npm run check:controlled-agent-authority-registry`; included in `npm run check` | Registry is vocabulary and fixture proof only. It is not runtime permission, host parity proof, storage proof, release proof, or broad autonomy approval. Future widening still needs scoped implementation cards and host-owned tests. |
| S110-S111 | Explicit lexical search | Partial | `docs/architecture/019-controlled-agent-explicit-lexical-search.md`; `npm run smoke:controlled-agent-lexical-search`; `npm run smoke:controlled-agent-real-lexical-search`; `cd apps/plugins/vscode && npm run compile && npm test`; included contract/local smoke in `npm run check` | S110 contract and S111 VS Code executor evidence exist, but Browser remains unsupported and JetBrains fail-closed. Real search is focused VS Code evidence, not broad indexing, background search, provider-tool search, or cross-host parity. |
| S112 | Search selection | Pass for pure GUI metadata selection; partial for full task orchestration | `docs/architecture/019-controlled-agent-explicit-lexical-search.md`; `apps/gui/src/services/controlledAgentSearchSelection.ts`; `npm run smoke:controlled-agent-search-selection`; S123 bundle child gate | Selection is sanitized, explicit, local/mock evidence. It does not attach prompt context automatically, call providers, apply edits, run verification, persist selection, or prove IDE UI automation. |
| S113 | Search-informed provider proposal | Partial | `docs/architecture/020-controlled-agent-search-informed-proposal.md`; `packages/contracts/schemas/engine/controlled-agent-search-informed-proposal.schema.json`; safe and invalid fixtures; `npm run validate:contracts`; included in `npm run check` | Contract/fixture evidence only. There is no provider-call implementation proof, prompt assembly proof, raw provider payload redaction proof across all surfaces, or real-provider CI. |
| S114-S115 | Multi-file patch review | Pass for bounded review metadata; partial for user comprehension | `docs/architecture/021-controlled-agent-multifile-patch-plan.md`; `apps/gui/src/services/controlledAgentMultifilePatchPlan.ts`; `npm run smoke:controlled-agent-patch-plan-preview`; included in `npm run check` | Review metadata is bounded and sanitized, but user comprehension and accessibility of multi-file review remain production gaps. Patch-plan metadata alone cannot apply changes. |
| S116 | Explicit multi-file apply | Partial | `docs/architecture/021-controlled-agent-multifile-patch-plan.md`; `apps/gui/src/services/controlledAgentMultifileApplyRequest.ts`; `apps/plugins/vscode/src/controlledMultifileEdit.ts`; bridge safe/invalid fixtures; `npm run smoke:controlled-agent-real-multifile-edit`; GUI/plugin tests referenced in docs | VS Code-focused apply evidence exists, but it depends on transient reviewed replacement text and host-owned validation. Browser is unsupported, JetBrains fail-closed, packaged wrapper parity and long-run rollback/recovery evidence remain incomplete. |
| S117 | Verification bundles | Partial | `docs/architecture/022-controlled-agent-verification-bundles.md`; `packages/contracts/schemas/engine/controlled-agent-verification-bundle.schema.json`; safe and invalid fixtures; `npm run validate:contracts`; included in `npm run check` | S117 is metadata/fixture evidence only. It does not execute commands, prove host runners, prove output redaction in real failures, or grant shell/args/cwd/env authority. |
| S118 | Verification follow-up | Partial | `docs/architecture/023-controlled-agent-verification-followup.md`; `packages/contracts/schemas/engine/controlled-agent-verification-followup.schema.json`; safe and invalid fixtures; `npm run validate:contracts`; included in `npm run check` | Follow-up remains manual metadata only. There is no automatic repair loop, provider send, apply, verification rerun, rollback, or broad context acquisition. |
| S119 | Two-step run state | Pass for display-only state contract; partial for executable orchestration | `docs/architecture/024-controlled-agent-two-step-run.md`; `packages/contracts/schemas/engine/controlled-agent-two-step-run.schema.json`; `npm run smoke:controlled-agent-two-step-run`; GUI tests referenced in docs; S123 bundle child gate | State proves staged metadata and visible gates, not a runner. It does not prove full provider/apply/verification orchestration, host execution, storage, or recovery behavior in installed packages. |
| S120 | Recovery matrix | Pass for display-only recovery guidance; partial for real recovery operations | `docs/architecture/025-controlled-agent-recovery-matrix.md`; `packages/contracts/schemas/engine/controlled-agent-recovery-matrix.schema.json`; `npm run smoke:controlled-agent-recovery-matrix`; S123 bundle child gate | Recovery states are visible and fail closed in deterministic evidence, but real fault injection, rollback safety, package/runtime reconnect, provider timeout handling, and user-study evidence remain incomplete. |
| S121 | Task presets | Pass for safe task-starting metadata; partial for guided workflow implementation | `docs/architecture/026-controlled-agent-task-presets.md`; `packages/contracts/schemas/engine/controlled-agent-task-preset.schema.json`; `npm run smoke:controlled-agent-task-presets`; S123 bundle child gate | Presets are a bounded menu, not authority. They cannot select context, send prompts, run providers, apply edits, verify, recover, or persist raw data by themselves. |
| S122 | Real-provider dogfood matrix | Partial | `docs/dogfood/controlled-agent-real-provider-matrix.md`; `scripts/dogfood-controlled-agent-real-provider-matrix.mjs`; `npm run dogfood:controlled-agent-real-provider-matrix -- --check-template`; `npm run dogfood:controlled-agent-real-provider-matrix -- --self-test`; included in `npm run check` | The matrix is manual local BYOK evidence and template validation. It is not automated real-provider coverage, not CI, and not proof across provider families until sanitized reports are actually collected and reviewed. |
| S123 | Packaged task-level beta gate | Pass for deterministic local/mock bundle; partial for actual packaged install evidence | `docs/architecture/027-controlled-agent-task-level-beta-gate.md`; `scripts/smoke-controlled-agent-task-beta-bundle.mjs`; `scripts/dogfood-controlled-agent-task-beta-report.mjs`; `npm run smoke:controlled-agent-task-beta-bundle`; `npm run dogfood:controlled-agent-task-beta-report -- --check-template`; `npm run dogfood:controlled-agent-task-beta-report -- --self-test`; report checks included in `npm run check` | The bundle orchestrates child local/mock gates and report validation. It does not install a package, launch VS Code UI, call providers, mutate real projects, sign, notarize, publish, or approve release/marketplace status. |
| S124 | Production/release readiness | Blocked | `docs/architecture/017-controlled-agent-production-gap-audit.md`; this decision record | Required production-like evidence remains missing for threat model review, storage/privacy inventory, CI matrix, host parity, packaged install/update/rollback, support diagnostics, performance budgets, signing/notarization, marketplace publication, and incident response. |

## Preserved non-goals

The S109-S123 trail must continue to preserve these explicit non-goals:

- no production, release, marketplace, signing, notarization, publication, support, or public availability claim;
- no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace requirement for core controlled workflows;
- no hidden reads, hidden search, background indexing, broad workspace discovery, generated/dependency traversal, binary/symlink mutation, or private path exposure;
- no arbitrary shell, free-form command text, args, cwd, env, git, package, network, provider-tool, or local-tool authority;
- no silent mutation, automatic apply, automatic verification, automatic repair, unbounded retry, stale result acceptance, or unattended rollback;
- no raw sensitive persistence in GUI-facing state, reports, traces, history, exports, dogfood notes, smoke output, fixtures, or public docs.

## Roadmap recommendation

Choose **hardening** as the next roadmap lane.

Recommended next work:

1. Convert the strongest metadata/display lanes into focused VS Code-owned execution evidence where authority is already scoped, starting with end-to-end task orchestration tests that still require explicit user gates.
2. Build a stable deterministic CI matrix and quarantine policy for controlled-agent checks, keeping manual BYOK dogfood separate from automation.
3. Add privacy/storage inventory, raw-data exclusion checks, retention/deletion policy, and support-bundle redaction validation.
4. Collect sanitized manual local BYOK reports across provider/runtime families using the S122 and S123 templates without raw prompts, provider responses, file bodies, diffs, replacements, private paths, secrets, or command output.
5. Add packaged VS Code install/update/reconnect/recovery evidence before any release-oriented work.

Broader autonomy/search expansion should wait until hardening closes the main partial areas. Release work should wait until the S107/S124 blockers are explicitly closed or accepted by dated risk decision.

## Verification for this decision

Run from the repository root:

```sh
npm run check:useful-multifile-agent-decision
npm run check
git diff --check
```

## S124-C3 final verification bundle and postmortem

Final verification was run from the repository root on 2026-07-08 for the S109-S124 useful multi-file controlled agent program. Evidence below is sanitized: it records command names, exit status, pass/fail summaries, and bounded counts only. It does not include raw prompts, provider responses, file bodies, diffs, replacement text, command output dumps, private paths, secrets, provider payloads, bridge dumps, browser-storage dumps, release approval, marketplace approval, signing, notarization, publication approval, or production autonomy claims.

### Final command results

| Command | Result | Sanitized evidence |
| --- | --- | --- |
| `npm run validate:contracts` | Pass | Contract validation passed for 65 schemas, 202 examples, and 803 invalid examples. |
| `npm run check` | Pass after local dependency symlink restoration | First attempt failed before repository validation completed because ignored worktree dependency folders were absent and the controlled lexical-search smoke could not resolve GUI TypeScript. After restoring ignored local symlinks to already-installed dependency folders, the full repository validation passed, including product identity, public hygiene, docs index, agent readiness docs, controlled-autonomy wording audit, contracts, authority registry, useful multi-file decision validator, controlled lexical search, dev-preview fixtures, sandbox checkpoint, explicit context, memory attachment, observability, history, patch-plan preview, IDE artifact/surface checks, npm spawn, icon assets, GUI asset freshness, model proposal, and dogfood template checks. |
| Key S109-S123 smoke bundle: `npm run check:controlled-agent-authority-registry && npm run smoke:controlled-agent-search-selection && npm run smoke:controlled-agent-patch-plan-preview && npm run smoke:controlled-agent-real-multifile-edit && npm run smoke:controlled-agent-two-step-run && npm run smoke:controlled-agent-recovery-matrix && npm run smoke:controlled-agent-task-presets && npm run smoke:controlled-agent-task-beta-bundle` | Pass | Authority registry, explicit search selection, patch-plan preview, VS Code-focused multi-file edit, two-step run state, recovery matrix, task presets, and packaged task-level beta local/mock bundle all passed. The S123 bundle passed 7 child gates and stayed dev-preview/local/mock-only. |
| GUI focused typecheck/tests: `cd apps/gui && npm run typecheck && npm test -- controlledAgentSearchSelection controlledAgentTaskPresets controlledAgentMultifilePatchPlan controlledAgentTwoStepRun controlledAgentRecoveryMatrix` | Pass | GUI TypeScript completed, and 5 focused service test files passed with 48 tests for controlled search selection, task presets, multi-file patch plan, two-step run, and recovery matrix surfaces. |
| VS Code plugin compile/tests: `cd apps/plugins/vscode && npm run compile && npm test` | Pass | Plugin TypeScript compile, identity/webview/engine-connection checks, and host-surface tests passed for controlled file read, edit, multi-file edit, command run, verification bundle, lexical search, and webview surfaces. |
| `git diff --check && git status --short` | Required final gate | Run after this postmortem update to confirm whitespace and final changed files. |

### Skipped commands

No available final-verification command from the S124-C3 expected set was intentionally skipped. Manual BYOK dogfood collection remains out of scope for this automation pass: S122/S123 template and self-test validators are included in the repository checks, but real-provider evidence still requires local user-run reports and separate review.

### Failures and follow-up status

The only failure observed during this card was an environment/setup failure: `npm run check` could not resolve the GUI TypeScript dependency because ignored worktree dependency folders were missing. It was remediated by restoring ignored local symlinks to the main checkout's installed dependency folders and rerunning the command successfully. No product code or tracked dependency state was changed for that setup fix.

No new blocker follow-up card is required from the final bundle. Existing residual risks remain: production/release readiness is blocked, real-provider dogfood is manual and not CI evidence, Browser remains unsupported for trusted execution, JetBrains remains partial/fail-closed for controlled execution parity, and hardening should continue before broader autonomy or release-oriented work.

### Postmortem

What went well:

- The S109-S123 deterministic gates compose into a repeatable final verification path with conservative local/mock evidence.
- The S123 task-level beta bundle gives a useful compact regression signal for task preset, search/selection, patch-plan review, staged verification/follow-up metadata, recovery guidance, and sanitized report validation.
- GUI and VS Code focused checks passed without changing production code, which supports the current partial/hardening-next decision.

What remains intentionally unresolved:

- The evidence still does not approve production, release, marketplace publication, signing, notarization, publication, broader autonomy, hidden search, automatic repair, arbitrary shell, or real-provider CI.
- Manual local BYOK real-provider reports need to be collected separately using the S122/S123 templates before usefulness claims can become stronger.
- Dependency availability in isolated worktrees remains a local setup concern; ignored dependency symlinks may need restoration before running GUI-dependent smokes.

Decision after final verification: keep **Overall decision status: partial** and keep **hardening next** as the roadmap recommendation. The little verification cat brought back a mouse, not a release certificate.
