# S90 Controlled Autonomy Readiness Matrix

This matrix is the Sprint 90 readiness gate for the controlled local-agent path. It is experimental/dev-preview evidence only, not production autonomy, not real-provider CI, not a marketplace or release gate, and not approval for broad workspace authority. The current evidence remains local-first, explicit-user, bounded, and sanitized.

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

S90 is `partial` overall. The controlled local-agent path is useful enough for narrow local dogfood planning and continued dev-preview hardening, but it is not production autonomy and not cross-host complete.

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

## Verification

For this documentation gate, run:

```sh
npm run check
```

Before sharing the branch, also run:

```sh
git diff --check && git status --short
```
