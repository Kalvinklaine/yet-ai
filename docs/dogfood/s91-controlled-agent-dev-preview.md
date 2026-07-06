# S91 Controlled Agent Dev-Preview

S91 follows the S90 `partial` decision. The goal is to make the experimental controlled local agent dev-preview more useful in VS Code through clearer Start/Stop UX, bounded progress reporting, and safer final reports without widening authority.

## Target

S91 is VS Code-first. It should improve the local dev-preview experience for a small controlled task after the user explicitly starts it:

- explicit Start and Stop controls stay visible and user-owned;
- the run stays bounded to one selected safe workspace-relative text read, one bounded replacement edit to an existing safe text file, one allowlisted verification command id, and at most one user-confirmed repair attempt;
- progress and final reports stay sanitized: phase labels, safe file labels, command-id labels, bounded counters, stop reasons, and short safe summaries only;
- failed, stopped, stale, unsupported, or unsafe states fail closed and explain the next manual choice.

## Boundaries

S91 does not change the S90 decision. It remains an experimental controlled local agent dev-preview, not production autonomy, not release evidence, not marketplace evidence, not real-provider CI, and not broad workspace automation.

S91 must not add or imply:

- browser trusted workspace execution;
- JetBrains controlled execution parity;
- hidden reads, background reads, workspace search, indexing, or file discovery;
- create, delete, rename, move, patch, generated-file, dependency-file, binary, symlink, or broad mutation authority;
- arbitrary shell, free-form command text, git, package, network, provider-tool, local-tool, or model-selected command authority;
- automatic repair beyond the single user-confirmed repair attempt, automatic retry, automatic rollback, or multi-step autonomous execution;
- raw prompt, file body, diff, replacement text, command, output, private path, secret, or bridge payload persistence.

## Host status

| Host | S91 status |
| --- | --- |
| Browser / standalone GUI | Preview-only and unsupported for trusted workspace execution. It may render bounded metadata but must not post controlled read, edit, or command requests. |
| VS Code | Primary dev-preview host for the implemented explicit controlled read, edit, allowlisted verification, one-step loop, and one repair-attempt UX. |
| JetBrains | Hosted GUI/manual parity may remain visible, but controlled execution stays fail-closed/unsupported until future verified work changes that status. |

## Safe manual dogfood checklist

Use this checklist for S93 dev-preview dogfood runs. It is a manual local dev-preview runbook for VS Code-first validation only. It does not turn the S90 `partial` decision into production autonomy, release evidence, marketplace evidence, real-provider CI, or cross-host completion.

### Prerequisites

- Work from a disposable or otherwise safe local checkout/worktree with no secret-bearing target files selected.
- Use the VS Code host for any trusted workspace execution. Browser/standalone GUI is preview-only and unsupported for controlled read, edit, or command execution. JetBrains may render hosted/manual parity surfaces, but controlled execution remains partial/fail-closed unless a later verified card changes that status.
- Keep local-first BYOK boundaries intact: the run must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, marketplace publication, or real-provider CI. If a real local provider is used manually, keep credentials local and do not paste secrets or raw provider output into dogfood notes.
- Choose one small existing safe workspace-relative text file and one allowlisted verification command id. Do not select hidden, generated, dependency, binary, symlink, secret-like, private-path, or broad workspace targets.
- Decide the expected bounded replacement before starting. Do not use this checklist for create, delete, rename, move, patch, generated-file, dependency-file, broad mutation, shell, git, package, network, provider-tool, or model-selected command experiments.
- Keep dogfood notes sanitized: record labels, counters, statuses, command ids, and short safe summaries only. Do not record raw prompts, file bodies, diffs, replacement text, command strings, cwd/env values, output dumps, bridge payloads, private paths, secrets, or arbitrary user text.

### VS Code-first manual path

1. Open the controlled dev-preview surface in VS Code and confirm the host copy says VS Code is the primary dev-preview host while Browser is unsupported and JetBrains is partial/fail-closed.
2. Confirm Start is visible but not already running. The user must click **Start** explicitly; there is no auto-start, hidden background run, or model-selected task start.
3. After **Start**, confirm the bounded read phase means exactly one selected safe workspace-relative text read under byte, line, and body limits. It must not mean workspace search, indexing, recursive discovery, hidden reads, or multiple-file context gathering.
4. Confirm the bounded edit phase means at most one bounded replacement edit to the selected existing safe text file after explicit user-controlled flow/correlation. It must not mean create/delete/rename/move/chmod, broad apply, patch authority, generated/dependency edits, or raw diff/replacement persistence.
5. Confirm the verification phase means exactly one allowlisted command id such as `repository-check`, `gui-app-tests`, or `engine-chat-tests`, with bounded tail metadata. It must not mean free-form shell, args/cwd/env input, git/package/network authority, model-selected commands, full output persistence, or automatic verification outside the explicit flow.
6. Confirm **Stop** remains visible while running. Clicking **Stop** must end the current run or leave it in a fail-closed stopped state with sanitized status only; it must not trigger rollback, retry, repair, or another run automatically.
7. If verification fails and the UI offers repair, confirm it means at most one user-confirmed repair attempt. The attempt budget is one; there is no automatic repair, second repair, automatic retry, automatic rollback, broad mutation, or follow-up send.
8. Review the progress/final report. It should contain sanitized phase labels, host/limitation labels, safe file labels, command-id labels, bounded counters, stop reasons, repair-attempt state, and short safe summaries only.
9. Save any dogfood observation outside tracked public docs unless a task explicitly asks for a sanitized tracked excerpt.

### Local smoke commands

For this dev-preview documentation/runbook path, run the wording and repository gates from the repository root:

```sh
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

When repeating the broader controlled dev-preview evidence bundle, use:

```sh
npm run smoke:controlled-agent-dev-preview
```

That aggregate smoke is deterministic local/mock evidence only. It includes bounded sanitized status/report/fixture gates and does not call providers, require hosted services, use credentials, execute real-provider CI, publish artifacts, prove release readiness, or approve production autonomy.

## Useful-reporting focus

S91 documentation and UX should make reports useful without exposing raw data. A good S91 report answers:

- Did the user explicitly start or stop the run?
- Which bounded phase completed or failed?
- Which safe file label and command id were involved?
- Was the one repair attempt unused, used, blocked, or exhausted?
- Did the run complete, stop, fail closed, or need manual follow-up?

The report must keep S90 partial approval clear: this is narrow local/mock and explicit-user-start evidence for continued dev-preview hardening only.

## S92 sanitized report evidence

S92 adds deterministic local/mock evidence for the sanitized dev-preview report service. The focused smoke is:

```sh
npm run smoke:controlled-agent-dev-preview-report
```

The root dev-preview smoke includes that focused report gate:

```sh
npm run smoke:controlled-agent-dev-preview
```

This S92 evidence is intentionally narrow. It exercises pure report formatting over supplied status, one-step, repair, and run metadata only. It does not call providers, network, package installation, git, free-form shell, runtime authority, bridge authority, storage authority, real IDE execution, or broad workspace actions. It proves sanitized report labels, bounded counters, host limitations, fixed safety boundaries, and raw-looking evidence omission only.

S92 does not change the S90 `partial` decision and does not expand S91 authority. It is not production autonomy, not real-provider CI, not release evidence, not marketplace evidence, and not broad workspace authority.

## Final status

S91 is complete as a dev-preview status and reporting audit. The completed evidence is intentionally narrow:

- the GUI uses pure sanitized status evaluation for the controlled local agent dev-preview;
- Agent Run and Controlled Agent Run panels show honest Start/Stop, bounded read/edit/verification, one repair-attempt, host limitation, and sanitized report labels;
- Browser stays preview-only and unsupported for trusted workspace execution;
- JetBrains stays fail-closed/unsupported for controlled execution parity;
- VS Code remains the primary dev-preview host for the implemented controlled execution slices;
- public wording keeps the S90 `partial` decision visible.

Sprint 92 is also complete as a sanitized report evidence audit. The completed S92 evidence is intentionally narrower still:

- `controlledAgentDevPreviewReport` is a pure report aggregator over supplied status, one-step, repair, run, counter, limitation, and evidence metadata only;
- Agent Run and Controlled Agent Run panels render report labels derived from existing GUI props/state only, with no new bridge, runtime, storage, provider, command, or host authority;
- report evidence is sanitized metadata only: fixed labels, bounded counters, host limitation labels, one-step and repair state labels, safe evidence summaries, and fixed safety-boundary copy;
- raw-looking evidence is omitted instead of echoed, including raw prompts, provider responses, file bodies, diffs, replacement text, command strings, cwd/env, output dumps, bridge payloads, private paths, secrets, and arbitrary user text;
- Browser stays preview-only/unsupported, JetBrains stays fail-closed/unsupported, and VS Code remains the primary dev-preview host for implemented controlled execution slices.

This completion does not widen authority. It is local/mock and explicit-user-start evidence only, not production autonomy, not broad workspace automation, not release evidence, not marketplace evidence, not real-provider CI, and not cross-host completion.

## Verification

The final S91 gate was:

```sh
npm run validate:contracts
cd apps/gui && npm test -- controlledAgentDevPreviewStatus AgentRunPanel ControlledAgentRunPanel controlledOneStepAgentLoop controlledRepairLoop App && npm run typecheck && npm run build
npm run smoke:controlled-agent-dev-preview
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All final gate commands passed for S91.

The final S92 gate is:

```sh
npm run validate:contracts
cd apps/gui && npm test -- controlledAgentDevPreviewReport controlledAgentDevPreviewStatus AgentRunPanel ControlledAgentRunPanel controlledOneStepAgentLoop controlledAgentRepairLoop App
cd apps/gui && npm run typecheck
cd apps/gui && npm run build
npm run smoke:controlled-agent-dev-preview
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All final gate commands passed for S92. Keep this command list together when repeating the final audit so later evidence cannot quietly skip the wording, smoke, repository, or clean-tree checks.
