# VS Code Installed Controlled-Task Recovery Report

Use this template to record a real, user-driven VS Code install-from-file controlled-task launch and recovery session. This is sanitized manual/local evidence only. A completed report can show what a person observed in one disposable trusted workspace; it is not CI evidence, automation evidence, production or release approval, marketplace readiness, signing or notarization evidence, or cross-platform proof.

Archive inspection and `npm run smoke:vscode-packaged-controlled-task` may establish static package and copy evidence, but they do not prove that VS Code installed the artifact, launched the extension, connected a runtime, rendered the webview, blocked a stale result, or recovered a running session. Record those outcomes only after observing them in a live local VS Code session.

Keep completed reports in an ignored local evidence location unless a task explicitly requests a reviewed sanitized excerpt. Use `not run` for every unobserved item. Do not infer success from an earlier stage: for example, `install passed` does not imply `launch passed` or `runtime ready`.

## Evidence boundary

The session must preserve these boundaries:

- The artifact is a local unsigned and unpublished VS Code dev-preview artifact installed from a file.
- The workspace is disposable, user-trusted, and safe for the bounded task. Record only the label `disposable trusted workspace`, never its path or contents.
- Every task start, context or search selection, proposal review, apply, verification, repair choice, retry, reinstall, reload, and recovery continuation requires an explicit user action. Install, launch, reconnect, reload, or a late result must not start or resume work automatically.
- Core chat, provider setup, IDE GUI workflows, runtime connection, and local storage remain local-first BYOK. They must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.
- Provider credentials remain under local engine/runtime custody. A report must not contain or echo them.
- Browser remains preview-only and unsupported for trusted workspace execution. JetBrains remains outside this VS Code evidence and partial/fail-closed where equivalent controlled execution has not been verified.
- This report records safe labels, bounded counts, booleans, and short sanitized summaries only. It grants no runtime, bridge, provider, tool, shell, git, package, network, workspace, update, or release authority.

## Safe vocabulary

Use only the following status labels where they apply:

- Lifecycle: `not run`, `passed`, `partial`, `blocked safely`, `failed safely`, `stopped by user`, `not applicable`.
- Install and launch: `artifact prepared`, `checksum matched`, `installed from file`, `install failed safely`, `extension launched`, `launch failed safely`.
- Runtime: `runtime ready`, `runtime unavailable`, `runtime disconnected`, `runtime reconnected`, `manual next action shown`.
- Reload and correlation: `webview reloaded`, `state rechecked`, `new explicit run required`, `stale result blocked`, `mismatched result ignored`, `duplicate result ignored`.
- Reinstall/update: `new local artifact prepared`, `reinstalled from file`, `VS Code reloaded`, `automatic update absent`, `reinstall failed safely`.
- Terminal outcome: `completed`, `completed with manual follow-up`, `blocked safely`, `failed safely`, `stopped by user`, `recovery incomplete`, `not run`.

Do not replace these with optimistic claims such as `production ready`, `release ready`, `marketplace ready`, `signed`, `notarized`, `fully recovered`, or `cross-host supported`.

## Manual observation sequence

1. Prepare the local dev-preview artifact through the documented package path and, when used, record checksum comparison as a status only.
2. Open VS Code and install the artifact through the user-driven install-from-file UI.
3. Open a disposable trusted workspace and launch Yet AI through an explicit user action.
4. Observe packaged product identity, VS Code host status, launch mode, and local runtime readiness. If readiness fails, record only a safe category and whether a manual next action appeared.
5. Start a small bounded controlled task only through the visible explicit user gate. Confirm selected context/search, proposal review, apply, verification, and any repair or follow-up remain separately reviewed and user-triggered.
6. Exercise runtime disconnect and reconnect manually. Confirm later task steps remain blocked until readiness and current correlation are rechecked; confirm no task restarts automatically.
7. Reload the webview manually. Confirm readiness/state is rechecked and continuing or starting again requires an explicit user action.
8. Cause or simulate only through an already-approved safe local method a stale, duplicate, or mismatched host result. Confirm it is ignored and cannot advance apply, verification, follow-up, or terminal state.
9. Prepare a new local artifact when update/reinstall evidence is in scope, reinstall it from file, and reload VS Code deliberately. Confirm no automatic updater or marketplace channel is involved.
10. Record one terminal outcome from the safe vocabulary and complete the redaction review before sharing anything.

If a recovery case cannot be exercised safely, record `not run`; do not invent a result or paste diagnostic payloads to compensate. Tiny honest gaps are friendlier than heroic fiction.

## Report template

```md
# Yet AI VS Code Installed Controlled-Task Recovery Report

Sanitized manual/local evidence only. This report describes one user-driven install-from-file session in a disposable trusted workspace. It is not archive-inspection proof, automation or CI evidence, cross-platform proof, production/release approval, marketplace readiness, signing, notarization, publication, support readiness, or real-provider CI evidence. Untested fields are `not run`.

## Session labels

- Observation date: <YYYY-MM-DD | sanitized sprint label | not run>
- Artifact family: <local VSIX dev-preview | not run>
- Artifact path family: <dist/plugins/vscode/*.vsix | not run>
- Artifact preparation status: <artifact prepared | failed safely | not run>
- Checksum status: <checksum matched | checksum mismatch blocked install | not checked | not run>
- Host family: <VS Code desktop | not run>
- VS Code version label: <major.minor family only | not run>
- OS/architecture label: <macOS arm64 | macOS x64 | Linux arm64 | Linux x64 | Windows arm64 | Windows x64 | other sanitized family | not run>
- Workspace label: <disposable trusted workspace | not run>
- Launch mode: <auto | launch | connect | not run>
- Scope: <manual local install-from-file dev-preview evidence only | not run>

## Install and launch observations

- Install-from-file outcome: <installed from file | install failed safely | blocked safely | not run>
- VS Code reload after install: <user reloaded VS Code | not required | failed safely | not run>
- Extension launch outcome: <extension launched | launch failed safely | blocked safely | not run>
- Packaged identity observation: <Yet AI identity shown | mismatch blocked session | not run>
- Explicit launch gate: <user launched explicitly | automatic launch issue found and session stopped | not run>
- Short safe install/launch summary: <safe label or bounded sanitized summary | none | not run>

## Runtime readiness and controlled-task gates

- Initial runtime status: <runtime ready | runtime unavailable | runtime disconnected | not run>
- Manual readiness action: <refresh runtime | restart local runtime | reconnect runtime | reopen chat | none | not run>
- Readiness after manual action: <runtime ready | runtime unavailable | blocked safely | not run>
- Controlled host status: <VS Code dev-preview path shown | unsupported or stale host status blocked task | not run>
- Explicit task Start: <user started explicitly | blocked safely | stopped by user | not run>
- Explicit context/search selection: <user selected explicitly | omitted | blocked safely | not run>
- Explicit proposal and patch-plan review: <reviewed | rejected | not applicable | not run>
- Explicit apply gate: <user confirmed apply | skipped | rejected | blocked safely | not run>
- Explicit allowlisted verification gate: <user confirmed verification | skipped | blocked safely | not run>
- Explicit repair/follow-up gate: <user selected manual next action | not offered | skipped | not run>
- Automatic execution absent: <checked | issue found and session stopped | not run>

## Runtime disconnect and reconnect

- Disconnect observation: <runtime disconnected | not run>
- State after disconnect: <later steps blocked safely | stopped by user | issue found and session stopped | not run>
- Reconnect action: <user refreshed runtime | user restarted local runtime | user reconnected | not run>
- Reconnect outcome: <runtime reconnected | runtime unavailable | failed safely | not run>
- Readiness/correlation recheck: <state rechecked | new explicit run required | blocked safely | not run>
- Automatic task restart absent: <checked | issue found and session stopped | not run>
- Short safe reconnect summary: <safe labels only | none | not run>

## Webview reload

- Reload action: <user reloaded webview | user reloaded VS Code window | not run>
- Reload outcome: <webview reloaded | reload failed safely | not run>
- Post-reload readiness: <state rechecked | runtime ready | runtime unavailable | not run>
- Post-reload continuation: <new explicit run required | explicit user continuation required | blocked safely | not run>
- Automatic send/apply/verify/repair/resume absent: <checked | issue found and session stopped | not run>
- Short safe reload summary: <safe labels only | none | not run>

## Stale-result blocking

- Result category exercised: <stale result | mismatched result | duplicate result | not run>
- Result stage: <proposal | apply | verification | follow-up | terminal | other safe label | not run>
- Correlation outcome: <stale result blocked | mismatched result ignored | duplicate result ignored | issue found and session stopped | not run>
- State advancement absent: <checked | issue found and session stopped | not run>
- New explicit action required: <checked | blocked safely | not run>
- Short safe stale-result summary: <safe labels only; no identifiers or payloads | none | not run>

## Reinstall or local update observation

- New artifact status: <new local artifact prepared | not applicable | not run>
- Reinstall action: <user reinstalled from file | skipped | not run>
- Reinstall outcome: <reinstalled from file | reinstall failed safely | blocked safely | not run>
- Reload action: <user reloaded VS Code | not required | not run>
- Post-reinstall launch/readiness: <extension launched and runtime ready | launch failed safely | runtime unavailable | not run>
- Explicit task gate preserved: <checked | issue found and session stopped | not run>
- Automatic update/marketplace channel absent: <checked | issue found and session stopped | not run>
- Short safe reinstall summary: <safe labels only | none | not run>

## Host and local-first boundaries

- Browser boundary: <preview-only and unsupported for trusted workspace execution confirmed | not observed | not run>
- JetBrains boundary: <partial/fail-closed boundary confirmed | not observed | not run>
- Local-first BYOK boundary: <no hosted Yet AI backend/account/managed gateway/product credit/cloud workspace required | issue found and session stopped | not run>
- Local credential custody: <raw provider secrets remained local and absent from GUI-facing evidence | no provider used | issue found and session stopped | not run>
- Explicit user gates preserved: <checked | issue found and session stopped | not run>

## Terminal outcome

- Terminal outcome: <completed | completed with manual follow-up | blocked safely | failed safely | stopped by user | recovery incomplete | not run>
- Lifecycle coverage: <install/launch/runtime/reconnect/reload/stale/reinstall all observed | sanitized list of stages not run | not run>
- Short safe outcome summary: <bounded sanitized summary | none | not run>
- Follow-up: <sanitized issue label or none | not run>

## Redaction review

- Secrets, credentials, tokens, auth material, cookies, and account-private identifiers absent: <checked | issue fixed before sharing | not run>
- Raw prompts and raw provider responses absent: <checked | issue fixed before sharing | not run>
- File bodies, diffs, patches, and replacement text absent: <checked | issue fixed before sharing | not run>
- Commands, args, cwd, env, stdout, stderr, logs, and output dumps absent: <checked | issue fixed before sharing | not run>
- Provider requests/responses or payload dumps absent: <checked | issue fixed before sharing | not run>
- Bridge messages or payload dumps absent: <checked | issue fixed before sharing | not run>
- Private absolute paths and workspace-identifying paths absent: <checked | issue fixed before sharing | not run>
- Unsafe screenshots and raw diagnostic captures absent: <checked | issue fixed before sharing | not run>
- Production, release, marketplace, signing, notarization, publication, support, cross-host parity, and real-provider CI claims absent: <checked | issue fixed before sharing | not run>
```

## Forbidden evidence

Never include any of the following in the template, a completed report, tracked excerpts, issue text, screenshots, or copied diagnostics:

- provider keys, runtime/session tokens, bearer or authorization values, OAuth/auth codes, PKCE material, cookies, credentials, secret environment values, or account-private identifiers;
- raw prompts, system messages, provider responses, streamed transcripts, model reasoning, request bodies, or provider payloads;
- raw file bodies, selected excerpts, memory note bodies, diffs, patches, replacement text, apply payloads, or workspace content;
- command strings, command arguments, command lines, cwd, env, process details, stdout, stderr, logs, stack traces, output tails, or output dumps;
- bridge requests, bridge responses, postMessage captures, browser-storage dumps, runtime payloads, network captures, query strings, or fragments;
- private absolute paths, home-directory paths, workspace names that identify private work, repository remotes, or local artifact absolute paths;
- screenshots containing any forbidden material, unsafe editor content, account details, notifications, terminals, private paths, or unreviewed background windows;
- claims of production readiness, release readiness, release-candidate status, marketplace readiness/publication, signing, notarization, update-channel readiness, managed support, cross-platform proof, Browser trusted execution, JetBrains parity, real-provider CI, or broader autonomy.

If diagnostics are needed to investigate a failure, keep them local and untracked. Put only a safe failure category and a short sanitized next action in the report.

## Non-goals

This contract does not:

- add or automate VS Code launch, extension installation, webview driving, runtime restart, stale-result injection, artifact preparation, reinstall, update, or screenshots;
- claim that archive layout, checksum validation, packaged copy checks, or static smoke output proves a live install or recovery session;
- create an update channel, rollback policy, installer, marketplace package, signing/notarization flow, release gate, support process, or production approval;
- approve real-provider CI, credential use in automation, hosted Yet AI services, accounts, managed gateways, credits, or cloud workspaces;
- enable automatic task restart, send, context attachment, read, search, indexing, provider call, apply, verification, repair, retry, rollback, shell, git, package, network, tool use, or workspace mutation;
- expand Browser beyond unsupported trusted workspace execution or promote JetBrains beyond its existing partial/fail-closed boundary;
- replace deterministic contract, GUI, plugin, package, privacy, or hygiene checks.

## Verification

For changes to this report contract, run:

```sh
npm run validate:docs && npm run validate:hygiene && git diff --check
```
