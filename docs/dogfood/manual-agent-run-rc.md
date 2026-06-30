# Manual Agent Run RC Checklist and Report Template

Use this checklist for the S70 Manual Agent Run Dogfood RC across browser, VS Code, and JetBrains. S70 status is **manual local dogfood RC only**: it is not production evidence, not autonomy evidence, not real-provider CI evidence, not marketplace readiness evidence, and not a publication gate.

Keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized tracked excerpt. Do not paste provider API keys, bearer headers, auth codes, OAuth tokens, runtime tokens, cookies, private absolute paths, prompt text dumps, provider response dumps, file body dumps, diff or patch body dumps, command strings, cwd or env values, browser-storage dumps, bridge payload dumps, screenshots that reveal secrets, or raw local evidence dumps.

## Host matrix

| Host | S70 RC role | Supported manual evidence | Boundary |
| --- | --- | --- | --- |
| Browser / standalone GUI | Chat, provider setup, and dev-preview review surface | Manual Send, provider/runtime readiness display, proposal/review UI, sanitized report and trace display, local/mock browser smoke evidence | No workspace apply, no verification command execution, no IDE actions, no production claim, no autonomy claim |
| VS Code | Primary manual IDE dogfood host | Manual Send, explicit context, reviewed safe-edit Apply through the existing confirmed host path, allowlisted command-id Verification, sanitized RC report | Dev-preview/local dogfood only; no marketplace publication, production, autonomous, shell/git/free-form command, or real-provider CI claim |
| JetBrains | Dev-preview parity host | Manual Send, hosted GUI parity, explicit confirmation boundaries, bridge parity evidence, sanitized RC report | Parity/dev-preview evidence only; no production parity, no autonomous apply/verify, no marketplace publication, or real-provider CI claim |

## Exact RC verification commands

Run the repository check before sharing RC documentation or reports:

```sh
npm run check
```

Generate a fresh sanitized report template with:

```sh
npm run report:agent-run-rc -- --template
```

Validate a completed local report before sharing with:

```sh
npm run report:agent-run-rc -- --check path/to/local-report.md
```

Optionally self-test the report validator after editing the template or checker:

```sh
npm run report:agent-run-rc -- --self-test
```

Optionally run the full local/mock RC smoke bundle when preparing manual RC evidence across the curated S67-S70 surfaces:

```sh
npm run smoke:agent-run-rc-bundle
```

The RC smoke bundle is fail-fast and local/mock-only. It is not real-provider CI, production evidence, release evidence, hosted-backend evidence, workspace mutation evidence, or autonomy evidence.

## S70 final audit status

S70 Manual Agent Run RC is closed as a manual local dogfood documentation and local/mock evidence milestone. The final audit found no high or critical safety issue in the S70 scope: browser remains preview/review only for IDE actions, VS Code remains the primary explicit Apply and allowlisted Verification dogfood host, JetBrains remains dev-preview parity evidence, and the report helper plus RC smoke bundle do not add product authority.

The S70 RC boundary remains: no auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden memory attach, hidden reads/search/indexing, shell/git/tool/provider authority, raw prompt/provider/file/diff/command/log/browser persistence, production readiness, publication readiness, real-provider CI, or controlled-autonomy claim. T-95, T-98, and T-244 are triaged stale, superseded, or non-blocking for this RC unless a future audit reopens them with current evidence.

## S71 timeline note

S71 adds a collapsed-by-default multi-step task timeline to the manual Agent Run UI as read-only sanitized metadata UX. The timeline is not part of the S70 RC authority model, is not an execution engine, and does not add autonomy. It must not be used to claim multi-step execution, production readiness, marketplace readiness, release readiness, real-provider CI, automatic Send, automatic Apply, automatic Verification, repair, retry, rollback, hidden reads, provider/tool calls, shell/git authority, workspace mutation, or raw-data/browser-storage persistence.

The exact focused S71 smoke is:

```sh
npm run smoke:multi-step-task-timeline
```

T-315 delivered this replacement smoke after the failed T-312 attempt; T-312 is not successful evidence. Focused S71 behavior checks are:

```sh
cd apps/gui && npm test -- multiStepTaskTimeline MultiStepTaskTimelinePanel App
npm run check
```

If a manual RC run observes the S71 timeline, record only sanitized status: collapsed/read-only, metadata-only, no action buttons, no raw prompts/provider responses/file bodies/diffs/command material/private paths/secrets/bridge payloads, and no timeline entries or raw data persisted in browser storage.

## S72 checkpoint decision note

S72 adds manual checkpoint decision metadata to the Agent Run UI and trace/timeline surfaces. It is experimental manual-only UX: continue, stop, rollback review, and separate manual run outcomes are rendered as sanitized guidance only. Rollback remains review-only through the existing manual review path; separate manual run is guidance only and creates nothing; continue means the user may keep working in the current checkpoint by explicit choice only.

The exact focused S72 smoke is:

```sh
npm run smoke:agent-run-checkpoint-decision
```

For S72 documentation/smoke edits, use the full local gate:

```sh
npm run smoke:agent-run-checkpoint-decision && npm run check && git diff --check
```

Do not report S72 as autonomy, production readiness, marketplace readiness, release readiness, real-provider CI, automatic Send, automatic Apply, automatic Verification, automatic repair, automatic retry, automatic rollback, hidden reads/search/indexing, hidden memory attach, provider/tool calls, shell/git authority, workspace mutation, or raw-data/browser-storage persistence. Manual RC notes may record only sanitized decision status and whether rollback review remained review-only.

## S73 controlled workspace readiness note

S73 adds controlled workspace readiness metadata near the manual Agent Run surfaces as future-gated display only. It can show sanitized opt-in, isolated workspace/worktree, checkpoint, rollback, limits, and policy metadata from `/v1/caps.controlledAgentWorkspaceReadiness`, but it cannot start an agent, create a worktree, create a checkpoint, read/search/index files, attach context, apply edits, run verification or shell commands, call providers/tools, use git, roll back, or persist raw readiness data.

The exact focused S73 smoke is:

```sh
npm run smoke:controlled-agent-workspace-readiness
```

For S73 documentation/smoke edits, use the full local gate:

```sh
npm run smoke:controlled-agent-workspace-readiness && npm run check && git diff --check
```

Do not report S73 as autonomy, production readiness, marketplace readiness, release readiness, real-provider CI, worktree creation, checkpoint creation, controlled runtime execution, automatic Send, automatic Apply, automatic Verification, automatic repair, automatic retry, automatic rollback, hidden reads/search/indexing, hidden memory attach, provider/tool calls, shell/git authority, workspace mutation, or raw-data/browser-storage persistence. Manual RC notes may record only sanitized readiness state and that no Start Agent or Create Worktree control was available.

## S74 bounded controlled file-read note

S74 adds bounded controlled file-read evidence for a future controlled workspace only. It can surface sanitized metadata for one explicit GUI- or host-minted read request, one safe workspace-relative text path, byte and line budgets up to 8192 bytes and 240 lines, truncation status, counts, and a content hash. The GUI display remains metadata-only: raw file bodies are intentionally omitted from panels, trace, timeline, session summaries, reports, and browser storage.

The exact focused S74 smoke is:

```sh
npm run smoke:controlled-agent-file-read
```

For the final S74 audit gate, use:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentFileRead ControlledAgentWorkspaceReadinessPanel controlledAgentWorkspaceReadiness codingSessionTrace App && npm run build && cd ../.. && npm run smoke:controlled-agent-file-read && npm run check && git diff --check && git status --short
```

Do not report S74 as hidden context gathering, broad project search, workspace indexing, arbitrary file browsing, write/apply authority, verification or shell command authority, provider/tool authority, agent start, controlled runtime execution, autonomy, production readiness, marketplace readiness, release readiness, or real-provider CI. Manual RC notes may record only sanitized bounded-read state/path labels/counts/truncation/hash evidence and must confirm no raw file body, private path, prompt, command, provider/tool payload, or secret appeared. S75+ capabilities remain unimplemented until their explicit future sprints land.

## S75 allowlisted command-runner note

S75 adds allowlisted command-id evidence for a future controlled workspace only. It can surface sanitized metadata for one trusted GUI- or host-minted request, explicit user/host confirmation, a controlled workspace/run id, one fixed command id (`repository-check`, `gui-app-tests`, or `engine-chat-tests`), bounded timeout and output-tail limits, status, exit code where applicable, duration, counts, truncation, and hash evidence. The GUI display remains metadata-only and reads this evidence only from `/v1/caps.controlledAgentCommandRunner`; it adds no bridge run button, no runtime endpoint, and no browser-storage persistence of raw command output.

The exact focused S75 smoke is:

```sh
npm run smoke:controlled-agent-command-runner
```

For the final S75 audit gate, use:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentCommandRunner agentRunVerification codingSessionTrace App && npm run build && cd ../.. && npm run smoke:controlled-agent-command-runner && npm run check && git diff --check && git status --short
```

Do not report S75 as shell access, arbitrary command execution, model-provided commands, git/package/network authority, provider/tool calling, broad agent runtime, production autonomy, marketplace readiness, release readiness, or real-provider CI. Manual RC notes may record only sanitized command-id state/label/status/limit/count/hash evidence and must confirm no raw command string, args, cwd, env, stdout/stderr dump, private path, provider/tool payload, or secret appeared. S76+ loop, edit, repair, retry, rollback, provider-tool, and controlled-autonomy capabilities remain unimplemented until their explicit future sprints land.

## S76 controlled run state skeleton note

S76 adds deterministic controlled-run state skeleton evidence for a future controlled workspace only. It can surface sanitized metadata for GUI-local phases, current step labels, stop reason, limits, counters, diagnostics, and all-false authority flags derived from `/v1/caps.controlledAgentWorkspaceReadiness`, `/v1/caps.controlledAgentFileRead`, and `/v1/caps.controlledAgentCommandRunner`. The visible Stop control is local React state only and does not call a runtime, bridge, rollback, command, provider, or workspace mutation path.

The exact focused S76 smoke is:

```sh
npm run smoke:controlled-agent-run-state
```

For the final S76 audit gate, use:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentRunState ControlledAgentRunPanel controlledAgentFileRead controlledAgentCommandRunner App && npm run build && cd ../.. && npm run smoke:controlled-agent-run-state && npm run check && git diff --check && git status --short
```

Do not report S76 as an edit executor, real command runner endpoint, provider loop, autonomous runner, production readiness, marketplace readiness, release readiness, or real-provider CI. Manual RC notes may record only sanitized state phase/step/stop/limit/counter/diagnostic metadata and must confirm no raw prompt, file body, command, output, private path, provider/tool payload, secret, bridge payload, or browser-storage persistence appeared. S77+ edit execution, verifier/repair loops, rollback behavior, provider-tool behavior, and controlled-autonomy capabilities remain unimplemented until their explicit future sprints land.

## Manual RC run checklist

1. Start from a clean local checkout or sanitized dev-preview artifact label.
2. Run `npm run check` for documentation, identity, hygiene, contract, and validator coverage.
3. If the RC evidence pass needs the curated local/mock bundle, run `npm run smoke:agent-run-rc-bundle` and record only pass/fail status plus sanitized issue summaries.
4. Generate a fresh report with `npm run report:agent-run-rc -- --template` into an ignored local evidence location.
5. Select the host under test: browser, VS Code, or JetBrains.
6. Record the host role using the host matrix above, not broader capability wording.
7. Connect or launch only the local runtime path required for the host.
8. Configure a local BYOK provider or local model runtime manually if the run uses a real provider. Do not put real provider credentials in automation or tracked files.
9. Draft the Agent Run goal locally and attach only explicit reviewed context, or record that context was intentionally omitted.
10. Click Send manually and record only sanitized status.
11. Review any proposal manually. Record proposal status only; do not paste raw diffs, patch bodies, or file bodies.
12. In VS Code or supported IDE-host dogfood only, click Apply manually after the explicit review and confirmation boundary. Browser remains preview-only.
13. In supported IDE-host dogfood only, click allowlisted Verification manually by command id. Browser does not run verification commands.
14. Confirm no auto-send, auto-apply, auto-verification, automatic repair, automatic retry, automatic rollback, hidden read, provider tool call, shell/git/tool execution, or background indexing occurred.
15. Inspect report/trace evidence for sanitized bounded metadata only.
16. If the S71 timeline is visible, inspect it only as read-only sanitized metadata and confirm it adds no action controls or browser-storage/raw-data persistence.
17. If the S72 checkpoint decision card is visible, record only sanitized status such as continue, stop, rollback review, or separate manual run guidance; confirm rollback remains review-only and no separate run, send, apply, verify, repair, retry, rollback, hidden read, search, indexing, or memory attach started automatically.
18. If the S73 controlled workspace readiness panel is visible, record only sanitized readiness state; confirm it remains metadata-only with no Start Agent, Create Worktree, read/search, apply, verify, rollback, shell/git/tool/provider, browser-storage, or workspace-mutation authority.
19. If the S74 controlled file-read evidence panel is visible, record only sanitized bounded-read metadata; confirm no raw body/private path leaks and no hidden read/search/indexing/write/apply/verify/command/provider/tool authority appeared.
20. If the S75 controlled command evidence panel is visible, record only sanitized command-id metadata; confirm no raw command/args/cwd/env/output dumps/private paths/secrets appeared and no shell/git/network/provider/tool/runtime execution authority or action control was available.
21. Validate the completed local report with `npm run report:agent-run-rc -- --check path/to/local-report.md` before sharing any excerpt.
22. Keep raw local evidence, screenshots, logs, provider transcripts, bridge captures, and browser-storage dumps out of tracked files.

## Sanitized report workflow

- Use `npm run report:agent-run-rc -- --template` to create the report structure.
- Fill unknown or untested fields as `not run`.
- Use sanitized labels, counts, status words, and short issue summaries.
- Prefer host labels such as `browser`, `VS Code`, or `JetBrains` and provider labels such as provider family plus non-secret model id.
- Use `npm run report:agent-run-rc -- --check path/to/local-report.md` before sharing.
- If validation fails, remove the unsafe content rather than weakening the checklist. The tiny raccoon of evidence hygiene accepts only tidy snacks.

## What must not be included in reports

Do not include:

- provider API keys, account identifiers, bearer headers, auth codes, OAuth tokens, runtime tokens, cookies, secret URL query strings, or credential paths;
- private absolute paths, home-directory paths, cwd values, env values, command strings, shell snippets, git remotes, or package-manager output dumps;
- raw prompts, prompt text dumps, provider request bodies, provider response dumps, streamed transcript dumps, or provider quality claims;
- raw file bodies, raw active-file contents, raw memory bodies, raw verification output, raw diffs, raw patch bodies, raw apply payloads, or bridge payload dumps;
- browser-storage dumps, localStorage/sessionStorage/IndexedDB contents, trace dumps, screenshots that expose secrets, or raw local evidence archives;
- claims that S70 proves production, autonomy, marketplace publication, release publication, real-provider CI, hosted-service readiness, signing/notarization readiness, or publication readiness.

## Report

```md
# Yet AI Manual Agent Run RC Report

Manual local evidence only. This report is not CI evidence, not automation evidence, not real-provider CI evidence, not production release evidence, not marketplace readiness evidence, and not a publication gate. Keep untested fields as `not run`. Do not paste provider credentials, bearer headers, auth codes, OAuth tokens, runtime tokens, cookies, private absolute paths, prompt text dumps, provider response dumps, file body dumps, diff or patch body dumps, command strings, cwd or env values, browser-storage dumps, or bridge payload dumps.

## Run metadata

- Commit/artifact label: <git commit or sanitized artifact family/name | local dev checkout | not run>
- Host: <browser | VS Code | JetBrains | not run>
- Host RC role: <browser chat/provider/dev-preview only | VS Code primary manual host | JetBrains dev-preview parity host | not run>
- Runtime connection status: <connected | failed with sanitized summary | not run>
- Provider family/model id: <provider family and non-secret model id only | local runtime family/id only | not run>
- RC scope: manual local dogfood only; no production, marketplace, autonomy, or real-provider CI readiness claim

## Context boundary

- Explicit context attached: <active-file excerpt | snippet | memory note | verification output label | manual note | none | not run>
- Explicit context omitted: <intentionally omitted | not applicable | not run>
- Context sanitization: <sanitized labels/counts only | reviewed bounded excerpt only | issue fixed before sharing | not run>

## Manual Agent Run evidence

- Send evidence: <user clicked Send manually | skipped | failed with sanitized summary | not run>
- Apply evidence: <user clicked Apply manually | blocked | browser preview-only | skipped | failed/rejected with sanitized summary | not run>
- Verify evidence: <user clicked Verification manually | browser unsupported | skipped | failed with sanitized summary | not run>
- No automatic execution observed: <checked | issue found with sanitized summary | not run>
- S71 timeline, if visible: <collapsed/read-only metadata only | no action buttons | no raw-data/browser-storage persistence | not visible | issue found with sanitized summary | not run>

## RC result statuses

- Proposal status: <detected and reviewable | rejected by safety/parser checks | absent | failed with sanitized summary | not run>
- Checkpoint status: <verified | missing | stale | blocked | not needed | not run>
- Final result status: <completed after manual verification | stopped before apply | stopped after failed apply | stopped after failed verification | stopped after proposal rejection | not run>

## Safety checklist

- Provider secrets absent: <checked | issue fixed before sharing | not run>
- Bearer tokens, cookies, auth codes, OAuth/runtime tokens absent: <checked | issue fixed before sharing | not run>
- Private absolute paths absent: <checked | issue fixed before sharing | not run>
- Prompt/provider response/file body/diff/patch body dumps absent: <checked | issue fixed before sharing | not run>
- Command strings, cwd, env, browser storage, and bridge payload dumps absent: <checked | issue fixed before sharing | not run>
- No hosted Yet AI backend, cloud workspace, managed gateway, product credits, production login, marketplace, publishing, signing, notarization, autonomy, or real-provider CI claim: <checked | issue fixed before sharing | not run>

## Known issues

- Known issues: <sanitized issue list or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
```
