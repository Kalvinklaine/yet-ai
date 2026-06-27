# Manual Agent Run RC Report Template

Use this safe-share template for manual local Agent Run release-candidate dogfood evidence. It is local evidence only: not CI evidence, not automation evidence, not real-provider CI evidence, not production readiness evidence, not marketplace readiness evidence, and not a publication gate.

Keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized tracked excerpt. Do not paste provider API keys, bearer headers, auth codes, OAuth tokens, runtime tokens, cookies, private absolute paths, prompt text dumps, provider response dumps, file body dumps, diff or patch body dumps, command strings, cwd or env values, browser-storage dumps, or bridge payload dumps.

Generate a fresh copy with:

```sh
npm run report:agent-run-rc -- --template
```

Validate a completed local report before sharing with:

```sh
npm run report:agent-run-rc -- --check path/to/local-report.md
```

## Report

```md
# Yet AI Manual Agent Run RC Report

Manual local evidence only. This report is not CI evidence, not automation evidence, not real-provider CI evidence, not production release evidence, not marketplace readiness evidence, and not a publication gate. Keep untested fields as `not run`. Do not paste provider credentials, bearer headers, auth codes, OAuth tokens, runtime tokens, cookies, private absolute paths, prompt text dumps, provider response dumps, file body dumps, diff or patch body dumps, command strings, cwd or env values, browser-storage dumps, or bridge payload dumps.

## Run metadata

- Commit/artifact label: <git commit or sanitized artifact family/name | local dev checkout | not run>
- Host: <browser | VS Code | JetBrains | not run>
- Runtime connection status: <connected | failed with sanitized summary | not run>
- Provider family/model id: <provider family and non-secret model id only | local runtime family/id only | not run>
- RC scope: manual local dogfood only; no production, marketplace, autonomy, or real-provider CI readiness claim

## Context boundary

- Explicit context attached: <active-file excerpt | snippet | memory note | verification output label | manual note | none | not run>
- Explicit context omitted: <intentionally omitted | not applicable | not run>
- Context sanitization: <sanitized labels/counts only | reviewed bounded excerpt only | issue fixed before sharing | not run>

## Manual Agent Run evidence

- Send evidence: <user clicked Send manually | skipped | failed with sanitized summary | not run>
- Apply evidence: <user clicked Apply manually | blocked | skipped | failed/rejected with sanitized summary | not run>
- Verify evidence: <user clicked Verification manually | skipped | failed with sanitized summary | not run>
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
