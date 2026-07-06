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

## Useful-reporting focus

S91 documentation and UX should make reports useful without exposing raw data. A good S91 report answers:

- Did the user explicitly start or stop the run?
- Which bounded phase completed or failed?
- Which safe file label and command id were involved?
- Was the one repair attempt unused, used, blocked, or exhausted?
- Did the run complete, stop, fail closed, or need manual follow-up?

The report must keep S90 partial approval clear: this is narrow local/mock and explicit-user-start evidence for continued dev-preview hardening only.

## Final status

S91 is complete as a dev-preview status and reporting audit. The completed evidence is intentionally narrow:

- the GUI uses pure sanitized status evaluation for the controlled local agent dev-preview;
- Agent Run and Controlled Agent Run panels show honest Start/Stop, bounded read/edit/verification, one repair-attempt, host limitation, and sanitized report labels;
- Browser stays preview-only and unsupported for trusted workspace execution;
- JetBrains stays fail-closed/unsupported for controlled execution parity;
- VS Code remains the primary dev-preview host for the implemented controlled execution slices;
- public wording keeps the S90 `partial` decision visible.

This completion does not widen authority. It is local/mock and explicit-user-start evidence only, not production autonomy, not broad workspace automation, not release evidence, not marketplace evidence, not real-provider CI, and not cross-host completion.

## Verification

The final S91 gate is:

```sh
npm run validate:contracts
cd apps/gui && npm test -- controlledAgentDevPreviewStatus AgentRunPanel ControlledAgentRunPanel controlledOneStepAgentLoop controlledRepairLoop App && npm run typecheck && npm run build
npm run smoke:controlled-agent-dev-preview
npm run smoke:controlled-autonomy-readiness
npm run audit:controlled-autonomy-wording
npm run check
git diff --check && git status --short
```

All final gate commands passed for S91. Keep this command list together when repeating the final audit so later evidence cannot quietly skip the wording, smoke, repository, or clean-tree checks.
