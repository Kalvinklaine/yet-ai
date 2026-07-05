# S90 Controlled Autonomy Readiness Matrix

This matrix is the Sprint 90 readiness gate for the controlled local-agent path. It is experimental/dev-preview evidence only, not production autonomy, not real-provider CI, not a marketplace or release gate, and not approval for broad workspace authority. The current evidence remains local-first, explicit-user-start, bounded, and sanitized.

Decision values:

- `ready` means the area has enough bounded dev-preview evidence for continued local dogfood inside the stated limits.
- `partial` means the evidence exists only for some hosts, some steps, or local/mock coverage and needs more implementation before broader claims.
- `blocked` means the capability must not be claimed or used as implemented.

## Decision matrix

| Area | Evidence | Decision |
| --- | --- | --- |
| Explicit Start / Stop | S86 one-step loop starts only after explicit user Start metadata. S89 resilience smoke covers explicit Stop and runtime disconnect staying terminal and not auto-repairing. | ready |
| Bounded read | S83 added one explicit correlated safe workspace-relative text read in VS Code only. Browser remains unsupported, JetBrains fails closed, and there is no hidden read, search, or indexing. | partial |
| Bounded edit | S84 added one explicit correlated replacement edit for an existing safe workspace-relative text file in VS Code only, with expected `sha256:` pre-edit hash. Browser remains unsupported and JetBrains fails closed for controlled execution. | partial |
| Allowlisted verification | S85 added VS Code-only controlled verification by fixed command id after explicit user click. It carries no command text, args, cwd, env, shell, git, package, network, provider, or tool authority. Browser and JetBrains controlled verification remain unsupported/fail-closed. | partial |
| One repair attempt | S87 exposes bounded repair eligibility and user-confirmed repair metadata after failed allowlisted verification, capped at one attempt. It is not automatic repair, multiple repair, or a provider/runtime repair loop. | partial |
| Dogfood usefulness | S88 defines tiny useful-task fixtures for copy change, TypeScript fix, failing test fix, one-file cleanup, and recovery copy. `npm run smoke:controlled-agent-dogfood-useful` validates fixture shape only; it does not execute GUI orchestration or provider calls. | partial |
| Cross-host availability | S89 documents Browser as preview-only/unsupported for trusted workspace execution, VS Code as the current controlled execution host, and JetBrains as hosted GUI/manual parity with controlled execution fail-closed unless future parity lands. | partial |
| Resilience | S89 resilience smoke covers stale verification results after chat changes, Stop, disconnect, duplicate terminal results, capped repair eligibility, and pre-ready or stale privileged host messages failing closed. | ready |
| Public wording safety | Architecture and dogfood docs keep dev-preview, local/mock, local-first BYOK, no production autonomy, no real-provider CI, no broad workspace authority, and no hidden reads/search/indexing boundaries explicit. | ready |

## S90 readiness decision

S90 is `partial` overall. The controlled local-agent path is useful enough for narrow local/mock dogfood planning and continued dev-preview hardening, but it is not production autonomy, not broad workspace automation, not real-provider CI, and not cross-host complete.

Final S90 wording: approve only an experimental controlled local agent dev-preview for narrow local/mock and explicit-user-start evidence. This approval is limited to the documented S86-S89 evidence chain and does not approve production autonomy, broad workspace automation, real-provider CI, release evidence, marketplace evidence, or cross-host controlled execution parity.

Evidence summary:

- S86 proves a deterministic one-step controlled loop can advance after explicit Start through one bounded read, one sanitized proposal step, one bounded edit metadata step, one allowlisted verification metadata step, and a sanitized terminal report, with Stop and unsafe states failing closed.
- S87 proves at most one bounded repair eligibility path after failed or timed-out verification, and only after explicit user confirmation; it is not automatic repair.
- S88 proves useful small-task fixture shape and matrix wiring for local/mock planning only; it does not execute GUI orchestration or provider calls.
- S89 proves resilience for stale results, Stop, runtime disconnect, duplicate terminal results, capped repair eligibility, and stale privileged host messages failing closed.
- The S90 readiness bundle runs these local/mock gates in fixed fail-fast order and includes the public wording audit.

Allowed S90 claims:

- experimental/dev-preview controlled local-agent evidence;
- explicit Start and Stop boundaries;
- bounded read, bounded edit, allowlisted verification, and bounded repair metadata inside the documented limits;
- VS Code as the only current real controlled execution host for the implemented slices;
- Browser and JetBrains limitations as explicit unsupported or fail-closed states;
- local/mock smokes and fixture validators as safety evidence only.

Disallowed S90 claims:

- production autonomy, production release readiness, marketplace readiness, or real-provider CI;
- browser or JetBrains controlled execution parity;
- broad workspace reads, hidden reads, search, indexing, or file discovery;
- create/delete/rename/move edits, arbitrary patches, broad mutation, or background edits;
- free-form shell, git, package, network, provider-tool, local-tool, or model-selected command authority;
- automatic repair, automatic retry, automatic rollback, or multi-step autonomous execution;
- raw prompt, file body, diff, command, output, private path, secret, or bridge payload persistence.

Remaining limitations:

- Browser remains preview-only/unsupported for trusted workspace execution and must not be reported as a controlled execution host.
- JetBrains remains fail-closed/unsupported for controlled execution parity until future verified work changes that status.
- VS Code is the only current real controlled execution host for implemented bounded read, bounded edit, and allowlisted verification slices.
- Dogfood usefulness is fixture-validation and planning evidence, not executed real-provider or cross-host CI evidence.
- Release, marketplace, signing, notarization, installer, update-channel, and production support evidence remain out of scope.

## Verification

## Final S90 closure status

Final S90 closure status: `partial`, with all final local/mock closure gates passing on 2026-07-05. This closes S90 only as an experimental controlled local agent dev-preview readiness milestone for narrow local/mock and explicit-user-start evidence. It does not approve production autonomy, broad workspace automation, real-provider CI, release evidence, marketplace evidence, browser controlled execution parity, or JetBrains controlled execution parity.

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

All commands above passed for the closure audit. No new authority was added; the evidence remains deterministic local/mock verification plus existing VS Code-only implemented controlled execution slices documented in the matrix.

For this S90 documentation and readiness audit gate, run the exact acceptance chain:

```sh
npm run smoke:controlled-autonomy-readiness && npm run audit:controlled-autonomy-wording && npm run check
```

The readiness smoke runs S86 one-step loop, S87 one-attempt repair loop, S88 useful dogfood fixture validation, the S90 public wording audit, and the S89 resilience gate when that script exists. The separate wording audit invocation is kept explicit so final docs remain public-hygiene-safe even though `npm run check` also runs it.

For documentation-only sanity during smaller edits, the minimum repository validation remains:

```sh
npm run check
```

Before sharing the branch, also run:

```sh
git diff --check && git status --short
```
