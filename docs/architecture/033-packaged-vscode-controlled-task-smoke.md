# Packaged VS Code Controlled Task Smoke Design

S129-C1 defines a local install-from-file packaged VS Code controlled-task smoke boundary. This is documentation and design only. It does not add package automation, new runtime authority, bridge authority, provider behavior, apply execution, verification execution, storage, release automation, marketplace publication, signing, notarization, or production approval.

The smoke is intended to make one narrow local/dev-preview dogfood question repeatable: does the local unsigned/unpublished VS Code artifact prepared for install-from-file review still show the existing controlled-task surfaces, reconnect/reload guidance, and sanitized evidence boundaries without making a release claim? Passing this smoke is local dogfood evidence only. It does not make Yet AI a production product, marketplace listing, signed package, notarized package, published package, or real-provider CI approval.

## Artifact source and preparation path

Use the current VS Code dev-preview package route:

1. From the repository root, run `npm run prepare:vscode-preview`.
2. Optionally run `npm run smoke:vscode-installable` to inspect the generated package layout, bundled identity, packaged GUI assets, checksum, and copied local engine binary before manual install.
3. Install the generated local ignored VSIX from `dist/plugins/vscode/yet-ai-vscode-<version>-dev-preview.vsix` into VS Code with an install-from-file path.
4. Keep the matching `.sha256` checksum as local evidence when useful.

The prepared artifact is a dev-preview validation output staged from the local checkout or CI runner. The bundled `yet-lsp` is the local Cargo build output copied into the package for local `auto` / `launch` preview validation. It is not a signed, notarized, hardened, provenance-attested, or production-distributed engine.

Do not create new packaging automation for this smoke. Do not change artifact names, versioning, signing state, marketplace metadata, or upload behavior as part of this design.

## Local install-from-file assumptions

The smoke assumes a safe local workstation and a disposable or otherwise safe local checkout/workspace:

- VS Code is installed locally and can install a `.vsix` from disk.
- The selected workspace is trusted by the user and safe for bounded controlled-task dogfood.
- The extension uses `yetai.launchMode = auto` or another deliberate local dev-preview mode documented by the user.
- Core chat, provider setup, IDE GUI workflows, and local storage remain local-first BYOK. They must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, marketplace approval, signing, notarization, or production provider account login.
- Provider credentials, if used manually, stay local. They must not be copied into smoke reports, screenshots, issue text, bridge payload dumps, terminal output, or docs.

This smoke is VS Code-first. Browser may be mentioned only as preview-only and unsupported for trusted workspace execution. JetBrains may be mentioned only as not in scope for this packaged VS Code smoke and partial/fail-closed unless a later verified card adds equivalent packaged task evidence.

## Visible controlled-task surfaces and copy

The smoke should inspect visible VS Code-hosted packaged GUI surfaces that already exist. It should not add new controls or enable hidden behavior. The minimum visible checks are:

| Surface | Expected local/dev-preview observation |
| --- | --- |
| Product and package identity | The extension and webview identify as Yet AI using bundled product identity metadata. |
| Runtime status | The GUI shows local runtime readiness or a sanitized local failure with a manual next action. |
| Controlled host status | Copy says VS Code is the supported dev-preview path for controlled task surfaces while Browser is unsupported and JetBrains is not promoted by this smoke. |
| Explicit task start gates | Any controlled task run starts only after an explicit user action. No install, reload, reconnect, provider response, or page render may start a task automatically. |
| Context/search/task preset gates | Preset, context, and search evidence remain user-selected metadata. No hidden reads, indexing, broad search, or automatic attachment is implied. |
| Patch-plan and apply review | Patch-plan evidence remains sanitized review metadata. Apply remains explicit, host-confirmed, bounded to existing safe workspace-relative text replacements, and never automatic. |
| Verification and follow-up | Verification remains allowlisted command-id metadata after explicit user approval. Follow-up and recovery are manual guidance only. |
| Final report/export/history evidence | Evidence remains sanitized labels, counters, statuses, hashes when already safe, and short summaries only. |

The visible copy should keep saying dev-preview, install-from-file, local-first, explicit, bounded, reviewed, and sanitized. It must not say production autonomous agent, release candidate, marketplace package, signed package, notarized package, managed cloud workspace, hosted Yet AI backend requirement, or real-provider CI.

## Reconnect, stale, update, and reload guidance scope

The smoke may exercise or record only user-visible manual recovery guidance. It must not implement or imply automatic recovery authority.

Allowed observations:

- Reloading the VS Code window or webview requires the user to re-check runtime readiness before continuing controlled-task work.
- Runtime disconnect or stale session state stops or blocks later controlled-task steps and shows sanitized manual next actions such as refresh runtime, restart local runtime, reopen chat, or start a new explicit run.
- Stale apply, verification, provider, or follow-up results are ignored unless their visible request/run/session correlation still matches the current task state.
- Updating the local VSIX means rebuilding with `npm run prepare:vscode-preview`, reinstalling from the new local file, and reloading VS Code deliberately. There is no automatic update channel in this smoke.
- Reconnect/reload reports may record status categories, safe labels, and whether stale results were blocked.

Forbidden implications:

- no automatic task restart after reconnect;
- no automatic apply, verification, repair, rollback, provider send, hidden read, search, indexing, git, shell, package, network, tool, or workspace mutation after reload;
- no background updater, marketplace update channel, production installer, daemon-lite runtime lifecycle, cross-project resume, or crash-recovery contract;
- no Browser trusted execution and no JetBrains controlled execution parity claim.

## Sanitized evidence and report shape

A manual report for this smoke should be safe to share inside the project. Record labels and bounded metadata only:

- OS and architecture label;
- VS Code version label if useful;
- artifact family such as `local VSIX dev-preview`;
- artifact path family without private absolute paths, for example `dist/plugins/vscode/*.vsix`;
- checksum match status;
- launch mode label such as `auto`, `launch`, or `connect`;
- runtime status category and sanitized next action;
- controlled host status labels;
- task preset/context/search/patch-plan/apply/verification/follow-up status labels;
- reconnect/reload/stale-result category labels;
- final result category and short safe summary.

Do not record raw prompts, raw provider responses, raw file bodies, raw diffs, replacement text, raw command strings, stdout/stderr dumps, cwd/env/process material, private absolute paths, local runtime session tokens, provider API keys, bearer or Authorization values, OAuth codes or tokens, PKCE verifiers, cookies, query strings, fragments, browser storage dumps, bridge payload dumps, screenshots containing secrets, or account-private identifiers.

The S123 task-level beta report remains the adjacent packaged/dev-preview report contract for useful controlled tasks. This S129 smoke design narrows the installed VS Code package boundary around local install-from-file, visible controlled-task surfaces, reconnect/reload/stale guidance, and sanitized evidence. It does not replace S123 and does not add automation.

## Automated smoke extension

`node scripts/smoke-vscode-packaged-controlled-task.mjs` now checks both the generated local VSIX evidence and this design record for the S129-C3 recovery/update additions. The automated check remains an archive/content inspection only: it does not launch VS Code, install the extension, open a workspace, call a provider, run commands, mutate files, contact a network service, sign, notarize, publish, or create an update channel.

The extended smoke must find evidence for these safe categories:

- reconnect/reload guidance, using manual labels such as refresh runtime, restart local runtime, reopen chat, reload VS Code, or start a new explicit run;
- stale session state blocking, including stale result/session/state labels and correlation language that says mismatched results are ignored;
- update/reinstall guidance, limited to rebuilding with `npm run prepare:vscode-preview`, reinstalling the local VSIX through install-from-file, and reloading VS Code deliberately;
- unsupported/fail-closed controlled-task states, including Browser unsupported and JetBrains partial/fail-closed labels where parity is not verified;
- sanitized report output, including safe labels, status categories, counters, hashes when already safe, and short summaries while raw prompts, raw files, raw diffs, raw command output, private absolute paths, bridge payloads, provider payloads, and secrets stay omitted.

The extended smoke also rejects copy that implies marketplace readiness, release readiness, signing, notarization, hosted Yet AI backend requirements, automatic task start, automatic updates, background updater behavior, cross-project resume, or a crash-recovery contract. These checks are copy/evidence hardening only, not product capability expansion. The little smoke reads labels like a sleepy guard cat: enough to notice trouble, not enough to touch the machinery.

## Suggested manual smoke sequence

1. Prepare the local VS Code dev-preview package with `npm run prepare:vscode-preview`.
2. Optionally inspect it with `npm run smoke:vscode-installable`.
3. Install the generated `.vsix` from disk into VS Code.
4. Open a safe local workspace and run `Yet AI: Open Chat`.
5. Confirm packaged GUI identity, local runtime status, and VS Code host status copy.
6. Confirm controlled task surfaces require explicit user gates before context/search, task preset, apply, verification, and follow-up.
7. Trigger a safe reload or reconnect observation, such as webview reload or runtime refresh, and confirm stale work is blocked until a new explicit user action.
8. Record a sanitized report using the evidence rules above.

This sequence is intentionally manual. Future automation, if approved, should be added by a separate card after the report shape and authority boundaries remain stable.

## Non-goals

This smoke design explicitly does not cover or approve:

- marketplace publication or marketplace listing readiness;
- signing, notarization, hardening, production installer work, update channels, or release automation;
- production release, public launch, support approval, or release-candidate approval;
- real-provider CI, provider credentials in automation, hosted Yet AI backend requirements, Yet AI accounts, managed model gateways, product credit balances, or cloud workspaces;
- Browser trusted workspace execution;
- JetBrains controlled execution parity or packaged JetBrains task smoke promotion;
- arbitrary shell, git, package, network, provider-tool, local-tool, or model-selected command authority;
- hidden reads, hidden search, background indexing, broad workspace scans, automatic context attachment, automatic provider send, automatic apply, automatic verification, automatic repair, automatic rollback, or unattended multi-step autonomy;
- persistence of raw prompts, file contents, diffs, replacements, command output, provider payloads, bridge payloads, private paths, or secrets.

## Verification

For changes to this design document, run:

```sh
npm run check
git diff --check
```
