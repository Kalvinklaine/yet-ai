# Agent Run One-step Dogfood Report Template

Use this safe-share template for a manual one-step Agent Run dogfood run with a real local BYOK provider or a local model runtime. It is local evidence only: not CI evidence, not automation evidence, not a production release gate, and not a publication claim.

The flow is intentionally manual. The user configures or selects a local provider path, attaches explicit context, reviews the drafted task, clicks Send, reviews the model safe-edit proposal, clicks Apply only after checkpoint readiness, clicks Verification only after apply, and records a sanitized result.

## Boundaries

In scope:

- Local runtime connected through an IDE/plugin or browser dev surface.
- BYOK provider configured locally, or local model runtime selected locally.
- Provider kind recorded only as a redacted/sanitized category, with a non-secret model label.
- Explicit context attached or intentionally omitted before Send.
- Model safe-edit proposal reviewed before Apply.
- Apply and Verification started only by explicit user action.
- Final report records sanitized metadata, checksums when applicable, screenshot paths, result summary, and failure state.

Out of scope:

- Hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, or cloud-required task execution.
- Production/default account login remains unavailable/blocked; production autonomy, background agent execution, automatic repair, automatic retry, automatic rollback, marketplace publication, signing, notarization, and release readiness are not claimed.
- Real-provider CI, automated provider calls, real apply actions in CI, or real verification commands in CI.

## Never include in a shareable report

Do not paste or preserve any of these values in tracked docs or shared reports:

- Raw API keys, bearer tokens, runtime tokens, auth headers, cookies, auth codes, credential file paths, account identifiers, organization IDs, billing details, or secret URL query/fragment values.
- Raw prompt dumps, raw provider request bodies, raw provider responses, raw model traces, raw bridge payloads, browser-storage dumps, or runtime logs with sensitive payloads.
- Raw file bodies, raw diffs, raw patch bodies, full verification output, command strings, cwd/env values, private absolute paths, private repository names, or unredacted screenshot paths.

Prefer short summaries, sanitized labels, relative/ignored evidence paths, redacted IDs, hashes/checksums of generated artifacts, and bounded status fields. A report that says less but leaks nothing is doing the quiet heroic work.

## Manual dogfood checklist

Keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized tracked excerpt.

1. Start from a clean local checkout or dev-preview artifact.
2. Record the commit hash or sanitized artifact family/name. If using an artifact, record its SHA-256 checksum when applicable.
3. Launch or connect the local runtime from the selected host/browser surface.
4. Confirm no hosted Yet AI backend, Yet AI account, managed gateway, product credits, or cloud workspace is required.
5. Configure/test the BYOK provider through local provider settings, or select a local model runtime.
6. Record only provider kind as a redacted category and model label as non-secret text.
7. Open Agent Run and draft a concise one-step coding goal.
8. Attach explicit context such as active-file excerpt, snippet, memory note, prior verification summary, or manual note; or record intentional omission.
9. Confirm context preview/summary is visible and bounded before Send.
10. Draft the one-step prompt and review it; record only a sanitized task intent summary.
11. Confirm no hidden workspace read, background indexing, auto-send, auto-apply, auto-verification, shell/git/tool execution, or provider automation happened before Send.
12. Click Send manually once.
13. Confirm the selected one-shot context bundle was included with that Send and cleared after accepted Send, or remained available after a failed Send.
14. Review the streamed/final model response; record only sanitized usefulness and failure status.
15. If a safe-edit proposal appears, inspect it in the GUI before Apply and record only whether it was bounded/reviewable.
16. If the proposal is rejected by safety/parser checks or absent, record the sanitized failure state and stop unless a manual retry is intentionally started as a separate run.
17. Confirm checkpoint readiness before Apply; record only verified/missing/stale/blocked/not-needed status.
18. Click Apply manually only when proposal review and checkpoint readiness are acceptable.
19. Confirm no apply request occurred before the explicit Apply click.
20. If Apply fails or is rejected, record sanitized failure state and whether rollback-review metadata was available; do not record raw diffs or raw file bodies.
21. After successful Apply, click allowlisted Verification manually through the visible control.
22. Confirm verification uses command-id-only allowlisted routing; record command label, sanitized status, exit code when safe, duration when safe, and short outcome only.
23. Confirm no verification request occurred before the explicit Verification click.
24. If Verification fails, record sanitized failure state and confirm no automatic repair/retry/rollback occurred.
25. If Verification passes, record the sanitized final result summary.
26. Capture screenshots only when useful; store them in ignored local evidence paths and record sanitized relative labels or redacted paths.
27. Check the coding-session trace/report panel for sanitized metadata only: context, Send, proposal, checkpoint, apply, verification, final result, and failures.
28. Confirm browser storage does not contain provider credentials, raw prompts, raw responses, raw context, raw file bodies, raw diffs, Agent Run reports, trace entries, or secrets.
29. Review the completed report against the forbidden-data list before sharing.

## Safe-share report template

```md
# Yet AI Agent Run One-step Dogfood Report

Manual local evidence only. This report is not CI evidence, not automation evidence, not production autonomy evidence, not production release evidence, and not a publication gate. Keep untested fields as `not run`. Do not include raw API keys, bearer tokens, cookies, auth codes, raw prompt dumps, raw file bodies, raw diffs, raw provider responses, private paths, or full verification output.

## Run metadata

- Commit/artifact: <git commit | sanitized artifact family/name | local dev checkout | not run>
- Artifact checksum(s): <sha256 labels only | not applicable | not run>
- Runtime connection: <plugin auto-launch | manual local runtime | browser local runtime | failed with sanitized summary | not run>
- Host/browser surface: <VS Code | JetBrains | browser dev surface | plugin wrapper browser | other sanitized label | not run>
- Provider kind: <redacted BYOK provider category | local runtime | not run>
- Model label: <non-secret model family/id label | not run>
- Screenshot evidence: <ignored relative/redacted path labels | none | not run>
- CI status: mock/loopback-only; this real-provider run was manual local dogfood only

## Setup checks

- Local runtime connected before task drafting: <checked | failed with sanitized summary | not run>
- Provider configured/tested locally: <checked | failed with sanitized summary | not run>
- No hosted Yet AI backend/account/gateway/credits/cloud workspace required: <checked | issue found with sanitized summary | not run>
- Production/default account login unavailable/blocked: <checked | issue found with sanitized summary | not run>
- No production autonomy or background execution claimed: <checked | issue found with sanitized summary | not run>

## One-step Agent Run flow

- Task goal summary: <short sanitized goal summary, no raw prompt | not run>
- Explicit context attached: <active-file excerpt | snippet | memory note | verification summary | manual note | intentionally omitted | not run>
- Context preview before Send: <checked with sanitized labels/counts | issue found with sanitized summary | intentionally omitted | not run>
- Prompt reviewed before Send: <checked with sanitized intent summary | issue found with sanitized summary | not run>
- Manual Send: <clicked once | failed before send with sanitized summary | not run>
- One-shot context behavior: <included then cleared | send failed and bundle remained | no bundle | issue found with sanitized summary | not run>
- Model response summary: <useful | partially useful | not useful | failed with sanitized summary | not run>
- Safe-edit proposal result: <detected and reviewable | rejected by safety/parser checks | absent | failed with sanitized summary | not run>
- Proposal failure state: <malformed | unsafe metadata | stale correlation | wrong chat | settings changed | no proposal | other sanitized summary | none | not run>
- Checkpoint readiness: <verified | missing | stale | blocked | not needed because proposal rejected/absent | not run>
- Manual Apply status: <applied by explicit user action | blocked by checkpoint readiness | skipped | failed/rejected with sanitized summary | not run>
- Apply safety/correlation: <no apply before explicit click; correlated result accepted | issue found with sanitized summary | skipped | not run>
- Manual Verification status: <passed with sanitized summary | failed with sanitized summary | skipped | out of scope | not run>
- Verification command label: <repository-check | gui-app-tests | engine-chat-tests | other approved command id label | skipped | not run>
- Verification result summary: <exit code/duration/non-sensitive tail summary | failed with sanitized summary | skipped | not run>
- Verification safety/correlation: <no verification before explicit click; command-id-only request; correlated result accepted | issue found with sanitized summary | skipped | not run>
- Final result: <completed after user-confirmed verification | stopped after proposal rejection | stopped before apply | stopped after failed apply | stopped after failed verification | not run>

## Failure states and issues

- Failure state reached: <none | setup failed | send failed | provider failed | proposal rejected | checkpoint blocked | apply failed | verification failed | sanitization issue | other sanitized summary | not run>
- User-visible recovery guidance: <clear | unclear with sanitized summary | not shown | not run>
- Rollback-review metadata: <available | unavailable | not applicable | not run>
- Known issues: <sanitized issue list or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>

## Safety checks

- Raw API keys/bearer tokens/cookies/auth codes absent: <checked | fixed before sharing | not run>
- Runtime tokens/auth headers/credential paths absent: <checked | fixed before sharing | not run>
- Prompt dumps/provider request or response bodies absent: <checked | fixed before sharing | not run>
- Raw file bodies/diffs/patch bodies absent: <checked | fixed before sharing | not run>
- Private paths/private repo names absent or redacted: <checked | fixed before sharing | not run>
- Full verification output/command strings/cwd/env absent: <checked | fixed before sharing | not run>
- Browser-storage dumps/bridge payloads/raw trace entries absent: <checked | fixed before sharing | not run>
- Screenshot paths are ignored/redacted and screenshots contain no secrets: <checked | fixed before sharing | none | not run>
- Report stays local-first and safe-share only: <checked | fixed before sharing | not run>
- No hosted-service, production-login, production-autonomy, real-provider-CI, publishing, signing, notarization, marketplace, or release claim: <checked | fixed before sharing | not run>
```

## Sharing rule

Before sharing, read the report once as if every line were public. If a field needs a secret, a private path, a raw prompt, a raw diff, a raw provider response, or full verification output to be useful, replace it with a sanitized summary or leave it as `not shared`.
