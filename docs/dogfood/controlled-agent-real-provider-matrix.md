# Yet AI Controlled Agent Real-Provider Dogfood Matrix

Manual local BYOK evidence only. This matrix is not CI evidence, not automation evidence, not production autonomy evidence, not release evidence, not marketplace evidence, not real-provider CI evidence, and not a publication gate. Keep untested cells as `not run`. Do not paste secrets, raw prompts, raw responses, raw file bodies, raw diffs, raw replacement text, raw commands, stdout, stderr, output dumps, cwd, env, private paths, provider payloads, bridge payload dumps, hosted backend/account/gateway/credit/cloud workspace requirements, production claims, release claims, marketplace claims, or publication claims.

Use this matrix after explicit user-run local dogfood with a user-configured provider key or local runtime. Keep completed evidence in ignored local evidence locations unless a task explicitly asks for a sanitized tracked excerpt. Manual real-provider evidence complements deterministic local checks by sampling provider-family behavior, latency, refusal/error handling, and proposal usefulness that mock fixtures cannot judge. Deterministic checks remain the repeatable safety gate; this matrix is human observation, not approval.

## Matrix metadata

- Host/artifact label: <VS Code dev-preview artifact family/name | local dev checkout | sanitized installed artifact label | not run>
- Matrix date label: <YYYY-MM-DD or sanitized sprint label | not run>
- Runtime launch label: <plugin-managed local runtime | manually launched local runtime | local model runtime | not run>
- Scope: manual local BYOK controlled-agent dogfood only; no hosted Yet AI backend, account, managed model gateway, product credit, cloud workspace, production autonomy, release, marketplace, publication, or real-provider CI claim

## Provider family coverage

Use sanitized family labels only. Record model ids only when they are non-secret and safe to share.

| Provider family/local runtime family | Dogfood purpose | Local-first boundary |
| --- | --- | --- |
| OpenAI-compatible BYOK | Hosted provider family with user-supplied local credential | Credential stays in local runtime configuration; no Yet AI hosted gateway/account requirement |
| Anthropic-compatible BYOK | Hosted provider family with user-supplied local credential | Credential stays in local runtime configuration; no Yet AI hosted gateway/account requirement |
| Local model runtime family | Local runtime family such as an on-device model server | No hosted Yet AI backend, product credit, account, or cloud workspace requirement |
| Other sanitized provider family | Optional user-configured compatible family | Record only a safe family label and local configuration status |

## Manual scenario set

Run only small, reversible, user-approved dogfood tasks in a safe local checkout. Each scenario should be recorded with sanitized labels, status, counts, and short safe summaries only.

| Scenario | Suggested preset/task type | What to observe | Safe outcome label examples |
| --- | --- | --- | --- |
| Successful small bug fix | `fix-small-bug` | Provider proposal follows explicit context, patch review is understandable, apply is user-approved, verification reaches a clear result | `completed`, `useful`, `verification passed` |
| Add focused test | `add-focused-test` | Proposal targets selected behavior, test scope is narrow, review/apply confidence is high, verification result is clear | `completed`, `partially useful`, `needs manual adjustment` |
| Small refactor | `refactor-small-function` | Proposal preserves behavior, avoids broad mutation, and keeps reviewable patch size | `completed`, `apply skipped`, `review confidence low` |
| Failed verification plus follow-up draft | `fix-small-bug` or `add-focused-test` | Failed verification is summarized without raw output and follow-up guidance is manual, bounded, and clear | `failed verification`, `manual follow-up drafted`, `recovery clear` |
| Provider timeout or provider error | Any mutation-capable preset | Timeout/error is visible as sanitized provider-family status and does not trigger hidden retry, apply, verify, or repair | `provider timeout`, `provider error`, `blocked safely` |
| Unsupported host limitation | Any preset | Browser or partial host limitation is shown before trusted execution and no workspace mutation path is offered | `unsupported host`, `preview-only`, `fail-closed` |
| Multi-file patch rejected or blocked | `refactor-small-function` or `improve-copy-or-typing` | Rejection explains bounded policy, missing replacement source, stale hash, unsupported host, or user stop without raw diff or file content | `apply rejected`, `blocked by policy`, `manual review needed` |

## Provider and preset matrix

| Row | Provider family/local runtime family | Preset/task type | Context/search selection status | Patch plan/review/apply status | Verification bundle status | Recovery/follow-up status | Usefulness notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | <OpenAI-compatible BYOK | Anthropic-compatible BYOK | local Ollama/runtime family | other sanitized provider family | not run> | <fix-small-bug | add-focused-test | refactor-small-function | explain-selected-code | improve-copy-or-typing | not run> | <explicit context selected | bounded lexical search selected | selection omitted | blocked with sanitized reason | not run> | <plan reviewed | apply skipped | explicit apply accepted | explicit apply rejected with sanitized summary | read-only preset no patch | not run> | <allowlisted bundle passed | allowlisted bundle failed with sanitized summary | skipped | read-only not applicable | not run> | <none | manual follow-up drafted | recovery guidance shown | stopped | blocked with sanitized reason | not run> | <short sanitized usefulness label; no raw prompt, response, file body, diff, command, private path, or secret | not run> |
| 2 | <provider/runtime family | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized notes | not run> |
| 3 | <provider/runtime family | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized notes | not run> |

## Sanitized usefulness rubric

Score each completed row with labels only. Use `good`, `partial`, `blocked`, `not applicable`, or `not run`; add one short sanitized note when useful.

| Rubric area | Question to answer without raw evidence | Allowed labels |
| --- | --- | --- |
| Task completed | Did the user reach the intended small outcome or a clear safe stop? | `completed`, `partial`, `blocked`, `stopped`, `not run` |
| User effort | How much manual steering was needed after the initial reviewed setup? | `low`, `moderate`, `high`, `not run` |
| Context quality | Was explicit selected context enough for a relevant proposal? | `good`, `partial`, `insufficient`, `not run` |
| Proposal quality | Was the provider proposal focused, reviewable, and aligned with the preset? | `good`, `partial`, `unsafe rejected`, `not run` |
| Review/apply confidence | Could the user safely understand and decide on apply or rejection? | `high`, `medium`, `low`, `not applicable`, `not run` |
| Verification outcome | Did the allowlisted verification bundle produce a clear safe status? | `passed`, `failed`, `skipped`, `blocked`, `not run` |
| Recovery clarity | If something failed or was unsupported, did the UI explain the next manual choice? | `clear`, `partial`, `unclear`, `not applicable`, `not run` |

## Recovery scenario notes

Use this section to summarize recovery coverage across provider families and presets. Keep notes short and sanitized.

- Failed verification plus follow-up draft: <manual follow-up drafted | recovery guidance shown | blocked with sanitized reason | not run>
- Provider timeout or error: <provider timeout shown | provider error shown | retry left to user | not run>
- Unsupported host limitation: <Browser preview-only shown | JetBrains partial/fail-closed shown | host limitation unclear | not run>
- Multi-file patch rejected or blocked: <policy block shown | stale/mismatch block shown | user rejected | not run>
- Hidden authority check: <no auto-send/apply/verify/repair/retry/rollback observed | issue fixed before sharing | not run>

## Sanitized evidence checklist

- Secrets absent: <checked | issue fixed before sharing | not run>
- Raw prompts absent: <checked | issue fixed before sharing | not run>
- Raw responses absent: <checked | issue fixed before sharing | not run>
- Raw file bodies, diffs, and replacement text absent: <checked | issue fixed before sharing | not run>
- Raw commands, stdout, stderr, output dumps, cwd, and env absent: <checked | issue fixed before sharing | not run>
- Private paths absent: <checked | issue fixed before sharing | not run>
- Provider payloads absent: <checked | issue fixed before sharing | not run>
- Bridge payload dumps absent: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement absent: <checked | issue fixed before sharing | not run>
- Production, release, marketplace, publication, signing, notarization, and real-provider CI claims absent: <checked | issue fixed before sharing | not run>

## Result summary

- Overall result: <useful | partially useful | blocked | stopped | not run>
- Provider/preset coverage summary: <sanitized counts or labels only | not run>
- Scenario coverage summary: <small bug fix | focused test | small refactor | failed verification follow-up | provider timeout/error | unsupported host | multi-file patch blocked | not run>
- Usefulness rubric summary: <sanitized label counts only | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
