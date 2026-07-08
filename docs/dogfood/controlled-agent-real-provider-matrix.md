# Yet AI Controlled Agent Real-Provider Dogfood Matrix

Manual local BYOK evidence only. This matrix is not CI evidence, not automation evidence, not production autonomy evidence, not release evidence, not marketplace evidence, not real-provider CI evidence, and not a publication gate. Keep untested cells as `not run`. Do not paste secrets, raw prompts, raw responses, raw file bodies, raw diffs, raw replacement text, raw commands, stdout, cwd, env, private paths, provider payloads, bridge payload dumps, hosted backend/account/gateway/credit/cloud workspace requirements, production claims, release claims, marketplace claims, or publication claims.

Use this matrix after explicit user-run local dogfood with a user-configured provider key or local runtime. Keep completed evidence in ignored local evidence locations unless a task explicitly asks for a sanitized tracked excerpt.

## Matrix metadata

- Host/artifact label: <VS Code dev-preview artifact family/name | local dev checkout | sanitized installed artifact label | not run>
- Matrix date label: <YYYY-MM-DD or sanitized sprint label | not run>
- Runtime launch label: <plugin-managed local runtime | manually launched local runtime | local model runtime | not run>
- Scope: manual local BYOK controlled-agent dogfood only; no hosted Yet AI backend, account, managed model gateway, product credit, cloud workspace, production autonomy, release, marketplace, publication, or real-provider CI claim

## Provider and preset matrix

| Row | Provider family/local runtime family | Preset/task type | Context/search selection status | Patch plan/review/apply status | Verification bundle status | Recovery/follow-up status | Usefulness notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | <OpenAI-compatible BYOK | Anthropic-compatible BYOK | local Ollama/runtime family | other sanitized provider family | not run> | <fix-small-bug | add-focused-test | refactor-small-function | explain-selected-code | improve-copy-or-typing | not run> | <explicit context selected | bounded lexical search selected | selection omitted | blocked with sanitized reason | not run> | <plan reviewed | apply skipped | explicit apply accepted | explicit apply rejected with sanitized summary | read-only preset no patch | not run> | <allowlisted bundle passed | allowlisted bundle failed with sanitized summary | skipped | read-only not applicable | not run> | <none | manual follow-up drafted | recovery guidance shown | stopped | blocked with sanitized reason | not run> | <short sanitized usefulness label; no raw prompt, response, file body, diff, command, private path, or secret | not run> |
| 2 | <provider/runtime family | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized notes | not run> |
| 3 | <provider/runtime family | not run> | <preset id | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized status | not run> | <sanitized notes | not run> |

## Sanitized evidence checklist

- Secrets absent: <checked | issue fixed before sharing | not run>
- Raw prompts absent: <checked | issue fixed before sharing | not run>
- Raw responses absent: <checked | issue fixed before sharing | not run>
- Raw file bodies, diffs, and replacement text absent: <checked | issue fixed before sharing | not run>
- Raw commands, stdout, cwd, and env absent: <checked | issue fixed before sharing | not run>
- Private paths absent: <checked | issue fixed before sharing | not run>
- Provider payloads absent: <checked | issue fixed before sharing | not run>
- Bridge payload dumps absent: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement absent: <checked | issue fixed before sharing | not run>
- Production, release, marketplace, publication, signing, notarization, and real-provider CI claims absent: <checked | issue fixed before sharing | not run>

## Result summary

- Overall result: <useful | partially useful | blocked | stopped | not run>
- Provider/preset coverage summary: <sanitized counts or labels only | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
