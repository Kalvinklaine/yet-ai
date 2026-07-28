# Yet AI Controlled Agent Real-Provider Dogfood Matrix

Manual local BYOK evidence only. This matrix is not CI evidence, not automation evidence, not production autonomy evidence, not release evidence, not marketplace evidence, not real-provider CI evidence, and not a publication gate. Keep every unobserved field and every tracked template row as `not run`; a placeholder is not an observation. Do not paste credentials, account identifiers, raw prompts, raw responses, provider payloads, raw file bodies, raw diffs, raw replacement text, raw commands, stdout, stderr, output dumps, cwd, env, private paths, bridge payload dumps, hosted backend/account/gateway/credit/cloud workspace requirements, production claims, release claims, marketplace claims, or publication claims.

Use a copied matrix only after explicit user-run local dogfood with a user-configured provider credential or local runtime. Keep completed evidence in ignored local evidence locations unless a task explicitly asks for a sanitized tracked excerpt. Manual observations compare provider/runtime families, repeated-run consistency, failure handling, and recovery behavior that deterministic fixtures cannot judge. They complement deterministic safety checks and never replace them.

## Repeatability protocol

1. Copy this template to an ignored local evidence location; do not fill the tracked template.
2. Choose one small, reversible, user-approved scenario and hold its preset, bounded context shape, artifact label, host surface, and verification bundle label constant across the run group.
3. Assign one safe run-group label and one distinct repeated-run label per attempt. Record the planned repeat count before starting and the completed count afterward; use counts only, never timestamps or identifiers that expose an account, machine, workspace, or private path.
4. Record each attempt independently, including blocked and failed attempts. Do not replace an earlier failure with a later successful result.
5. For family comparison, change only the provider family or runtime family where practical. Record any other changed condition with a short sanitized comparability note.
6. Leave all fields `not run` until a human performs and reviews that manual local BYOK attempt. A repeated-run count of `not run` means no repeatability evidence exists.
7. Validate the completed ignored local copy before sharing with `npm run dogfood:controlled-agent-real-provider-matrix -- --check path/to/local-matrix.md`.

## Matrix metadata

- Matrix contract version: v2 repeatable sanitized BYOK evidence
- Matrix date label: <YYYY-MM-DD or sanitized sprint label | not run>
- Run-group label: <safe local label shared by comparable attempts | not run>
- Repeated run plan: <one run | two runs | three runs | other bounded count | not run>
- Repeated runs completed: <sanitized integer count | not run>
- Host surface: <VS Code controlled dev-preview | Browser preview-only/unsupported | JetBrains partial/fail-closed | not run>
- Host/artifact label: <VS Code dev-preview artifact family/name | local dev checkout | sanitized installed artifact label | not run>
- Scenario/preset held constant: <safe scenario and preset labels | not run>
- Context and verification shape held constant: <held constant | changed with sanitized reason | not applicable | not run>
- Scope: manual local BYOK controlled-agent dogfood only; no hosted Yet AI backend, account, managed model gateway, product credit, cloud workspace, production autonomy, release, marketplace, publication, or real-provider CI claim

## Provider family coverage

Use sanitized family labels only. Never record provider account, organization, tenant, project, subscription, credential, endpoint query, or billing identifiers. A non-secret model family label is optional and must not be needed to compare rows.

| Provider family | Runtime family | Dogfood purpose | Local-first boundary |
| --- | --- | --- | --- |
| OpenAI-compatible BYOK | <plugin-managed local engine | manually launched local engine | not run> | Hosted compatible provider with a user-supplied local credential | Credential stays in engine-owned local configuration; no Yet AI hosted gateway or account requirement |
| Anthropic-compatible BYOK | <plugin-managed local engine | manually launched local engine | not run> | Hosted compatible provider with a user-supplied local credential | Credential stays in engine-owned local configuration; no Yet AI hosted gateway or account requirement |
| Local model provider family | <on-device model server family | local network model server family | not run> | User-configured local model runtime | No hosted Yet AI backend, product credit, account, or cloud workspace requirement |
| Other sanitized provider family | <sanitized compatible runtime family | not run> | Optional user-configured compatible family | Record family and local configuration status only; omit provider and account identifiers |

## Manual scenario set

Run only small, reversible, user-approved tasks in a safe local checkout. Record status labels, bounded counts, and short sanitized summaries only.

| Scenario | Suggested preset/task type | Comparison focus | Safe outcome label examples |
| --- | --- | --- | --- |
| Successful small bug fix | `fix-small-bug` | Context relevance, proposal focus, explicit apply, and verification consistency across repeats | `completed`, `useful`, `verification passed` |
| Add focused test | `add-focused-test` | Narrow test scope and repeated proposal usefulness | `completed`, `partially useful`, `needs manual adjustment` |
| Small refactor | `refactor-small-function` | Behavior preservation and reviewable patch-plan size | `completed`, `apply skipped`, `review confidence low` |
| Failed verification plus manual follow-up | `fix-small-bug` or `add-focused-test` | Safe failure summary and bounded user-owned recovery | `verification failed`, `manual follow-up drafted`, `recovery clear` |
| Provider timeout or provider error | Any mutation-capable preset | Visible failure without hidden retry, apply, verification, or repair | `provider timeout`, `provider error`, `blocked safely` |
| Reconnect or reload | Any preset | User-visible interruption and explicit fresh continuation choice | `reconnected`, `reload recovered`, `manual restart required` |
| Stale or duplicate result | Any preset | Old result rejected without workspace mutation or state overwrite | `stale rejected`, `duplicate ignored`, `blocked safely` |
| Unsupported host limitation | Any preset | Browser or JetBrains limitation shown before trusted execution | `unsupported host`, `preview-only`, `fail-closed` |
| Multi-file patch rejected or blocked | `refactor-small-function` or `improve-copy-or-typing` | Bounded policy, mismatch, stale hash, unsupported host, or user stop | `apply rejected`, `blocked by policy`, `manual review needed` |

## Provider and preset matrix

Use one row per manual attempt. Rows with the same run-group label form a repeat set. Family comparisons are meaningful only when scenario, preset, context shape, host/artifact, and verification shape are held constant or the difference is explicitly summarized.

The v2 columns split the prior `Context/search selection status`, `Patch plan/review/apply status`, `Verification bundle status`, `Recovery/follow-up status`, and `Usefulness notes` fields into explicit outcomes while preserving their meaning.

| Row | Run group / repeated run label / ordinal | Provider family/local runtime family | Host surface / artifact label | Preset/task type | Context outcome | Proposal outcome | Apply outcome | Verification outcome | Failure/recovery path | Reconnect/reload/stale outcome | Sanitized final assessment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | <safe group label; safe repeated-run label; 1 of bounded count | not run> | <OpenAI-compatible BYOK; plugin-managed local engine | Anthropic-compatible BYOK; manually launched local engine | local model provider; on-device runtime | other sanitized families | not run> | <VS Code controlled dev-preview; sanitized artifact label | Browser preview-only/unsupported | JetBrains partial/fail-closed | not run> | <fix-small-bug | add-focused-test | refactor-small-function | explain-selected-code | improve-copy-or-typing | not run> | <explicit context selected | bounded lexical search selected | selection omitted | blocked with sanitized reason | not run> | <reviewed and focused | reviewed with manual adjustment | rejected safely | provider unavailable | not applicable | not run> | <explicit apply accepted | apply skipped | explicit apply rejected | blocked by policy | read-only not applicable | not run> | <allowlisted bundle passed | allowlisted bundle failed with sanitized summary | skipped | blocked | read-only not applicable | not run> | <none | provider timeout/error shown | verification failure shown | manual follow-up drafted | stopped | blocked with sanitized reason | not run> | <not exercised | reconnect recovered | reload recovered | manual fresh run required | stale rejected | duplicate ignored | unsupported/fail-closed | not run> | <useful | partially useful | blocked safely | stopped safely | inconsistent across repeats | not comparable with sanitized reason | not run> |
| 2 | <safe group/run labels and ordinal | not run> | <provider/runtime families | not run> | <host/artifact labels | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized assessment | not run> |
| 3 | <safe group/run labels and ordinal | not run> | <provider/runtime families | not run> | <host/artifact labels | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized assessment | not run> |

## Repeat and family comparison summary

Summarize only after the corresponding rows are manually completed. Do not infer an untested family result from another family.

| Comparison | Safe bounded field |
| --- | --- |
| Run group and completed count | <safe group label; completed count of planned count | not run> |
| Conditions held constant | <preset/context/host/artifact/verification held constant | changed with sanitized reason | not run> |
| Provider families compared | <sanitized family labels and counts only | one family only | not run> |
| Runtime families compared | <sanitized family labels and counts only | one family only | not run> |
| Outcome consistency | <consistent | mixed | consistently blocked safely | not comparable | not run> |
| Failure-path comparison | <same safe failure category | different safe categories | no failure observed | not run> |
| Recovery comparison | <same manual recovery outcome | different safe outcomes | not exercised | not run> |
| Reconnect/reload/stale comparison | <consistent fail-closed outcome | mixed sanitized outcomes | not exercised | not run> |
| Comparative assessment | <short sanitized assessment with no raw evidence | not run> |

## Sanitized usefulness rubric

Score each completed row with labels only. Use one short sanitized note when needed.

| Rubric area | Question to answer without raw evidence | Allowed labels |
| --- | --- | --- |
| Task completed | Did the user reach the intended small outcome or a clear safe stop? | `completed`, `partial`, `blocked`, `stopped`, `not run` |
| User effort | How much manual steering was needed after reviewed setup? | `low`, `moderate`, `high`, `not run` |
| Context quality | Was explicit selected context enough for a relevant proposal? | `good`, `partial`, `insufficient`, `not run` |
| Proposal quality | Was the proposal focused, reviewable, and aligned with the preset? | `good`, `partial`, `unsafe rejected`, `not run` |
| Review/apply confidence | Could the user safely understand and decide on apply or rejection? | `high`, `medium`, `low`, `not applicable`, `not run` |
| Verification outcome | Did the allowlisted verification bundle produce a clear safe status? | `passed`, `failed`, `skipped`, `blocked`, `not run` |
| Recovery clarity | Did a failure or unsupported state explain the next manual choice? | `clear`, `partial`, `unclear`, `not applicable`, `not run` |
| Repeat consistency | Did comparable attempts reach the same safe outcome category? | `consistent`, `mixed`, `not comparable`, `not run` |

## Recovery scenario notes

- Failed verification plus follow-up draft: <manual follow-up drafted | recovery guidance shown | blocked with sanitized reason | not run>
- Provider timeout or error: <provider timeout shown | provider error shown | retry left to user | not run>
- Reconnect after interruption: <manual reconnect recovered | fresh run required | reconnect blocked safely | not run>
- Reload during or after run: <reload recovered to safe state | prior result rejected | manual restart required | not run>
- Stale or duplicate result: <stale result rejected | duplicate result ignored | issue fixed before sharing | not run>
- Unsupported host limitation: <Browser preview-only/unsupported shown | JetBrains partial/fail-closed shown | host limitation unclear | not run>
- Multi-file patch rejected or blocked: <policy block shown | stale/mismatch block shown | user rejected | not run>
- Hidden authority check: <no auto-send/apply/verify/repair/retry/rollback observed | issue fixed before sharing | not run>

## Sanitized evidence checklist

- Credentials, tokens, cookies, and account identifiers absent: <checked | issue fixed before sharing | not run>
- Secrets absent: <checked | issue fixed before sharing | not run>
- Raw prompts absent: <checked | issue fixed before sharing | not run>
- Raw responses absent: <checked | issue fixed before sharing | not run>
- Raw file bodies, diffs, and replacement text absent: <checked | issue fixed before sharing | not run>
- Raw commands, stdout, stderr, output dumps, cwd, and env absent: <checked | issue fixed before sharing | not run>
- Private paths absent: <checked | issue fixed before sharing | not run>
- Provider payloads absent: <checked | issue fixed before sharing | not run>
- Bridge payload dumps absent: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement absent: <checked | issue fixed before sharing | not run>
- Browser trusted workspace execution claim absent: <checked | issue fixed before sharing | not run>
- JetBrains controlled-execution parity claim absent: <checked | issue fixed before sharing | not run>
- Production, release, marketplace, publication, signing, notarization, and real-provider CI claims absent: <checked | issue fixed before sharing | not run>

## Result summary

- Overall result: <useful | partially useful | blocked | stopped | not run>
- Repeatability result: <consistent across bounded repeat count | mixed with sanitized category counts | not comparable | not run>
- Provider/preset coverage summary: <sanitized counts or labels only | not run>
- Runtime/host coverage summary: <sanitized counts or labels only | not run>
- Failure/recovery coverage summary: <sanitized category counts only | not run>
- Reconnect/reload/stale summary: <sanitized outcome counts only | not run>
- Usefulness rubric summary: <sanitized label counts only | not run>
- Final assessment: <short sanitized human assessment | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
