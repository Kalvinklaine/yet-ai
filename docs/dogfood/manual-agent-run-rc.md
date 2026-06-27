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
16. Validate the completed local report with `npm run report:agent-run-rc -- --check path/to/local-report.md` before sharing any excerpt.
17. Keep raw local evidence, screenshots, logs, provider transcripts, bridge captures, and browser-storage dumps out of tracked files.

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
