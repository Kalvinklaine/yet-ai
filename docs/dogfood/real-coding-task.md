# Real Coding Task Dogfood Checklist

Use this checklist for a manual guided coding task dogfood run with a real local BYOK provider or local model runtime. This is local evidence only. It is not CI evidence, not automation, not a publication gate, and production/default account login remains unavailable and blocked.

CI and smoke automation for guided coding tasks remain mock/loopback-only. Do not put real provider credentials, production accounts, hosted Yet AI services, managed gateways, cloud workspaces, or provider account-login flows into CI.

## Scope and boundaries

In scope:

- A local runtime is connected from the IDE/plugin or browser dev surface.
- A provider is configured and tested through local BYOK settings, or a local model runtime is selected.
- The user drafts a coding-task goal in the guided task UI.
- The user explicitly attaches context, snippets, and memory notes.
- The user reviews the prompt draft and clicks Send.
- The user reviews the model response, any proposed edit, and any verification summary.
- The report records sanitized observations only.

Out of scope:

- Production/default account login remains unavailable/blocked; ChatGPT/OpenAI account-login claims, provider web-session reuse, browser profile import, or private provider endpoints are out of scope.
- Hosted Yet AI backend requirements, Yet AI accounts, managed model gateways, product credit balances, cloud workspaces, cloud sync, or cloud-required task execution.
- Auto-send, auto-apply, auto-run verification, shell/git/tool execution, workspace indexing, hidden file reads, background autonomy, publishing, signing, notarization, marketplace release, or real-provider CI.
- Raw provider credentials, runtime tokens, auth codes, cookies, request bodies, raw provider responses, raw prompts, raw file bodies, private absolute paths, or bridge payload dumps in tracked docs or shareable reports.

## Manual run checklist

Keep the completed report in an ignored local evidence location unless a task explicitly asks for a sanitized tracked excerpt.

1. Start from a clean local checkout or dev-preview artifact and record only the commit or sanitized artifact family/name.
2. Launch or connect the local runtime through the selected IDE/plugin or browser dev surface.
3. Confirm the runtime is connected and record only the launch mode and surface type.
4. Configure and test the provider through local BYOK settings, or select a local model runtime.
5. Record provider kind and non-secret model family/id only; do not record API keys, tokens, account identifiers, organization IDs, billing details, or credential paths.
6. Draft a concise coding-task goal in the guided coding task UI.
7. Explicitly attach intended context: active-file excerpt, selected snippets, project-memory notes, or manual notes.
8. Confirm every excerpt is bounded and reviewed before send. Use workspace-relative labels or generic descriptions; do not paste raw private paths.
9. Confirm no hidden indexing, recursive workspace read, shell/git/tool execution, auto-send, auto-apply, or auto-run behavior occurred.
10. Review the prompt draft in the UI. Record only a sanitized summary of the intent, not the raw prompt.
11. Click Send manually.
12. Review the streaming or final model response. Record only a short sanitized outcome and whether it was useful.
13. If an edit proposal appears, review it in the GUI. Record only whether it was reviewable and bounded; do not paste raw patch bodies or full file contents.
14. If the user explicitly applies an edit or runs verification outside this report path, record only sanitized status and command family where allowed by the active task instructions.
15. Run the report through the relevant local sanitizer/checker if one exists before sharing.

## Sanitized report template

```md
# Yet AI Real Coding Task Dogfood Report

Manual local evidence only. This report is not CI evidence, not automation evidence, not production release evidence, and not a publication gate. Keep untested fields as `not run`. Do not paste provider credentials, bearer headers, auth codes, cookies, runtime tokens, private absolute paths, raw provider responses, raw prompts, raw bridge payloads, raw patch bodies, or raw file/source bodies.

## Run metadata

- Commit/artifact: <git commit or sanitized artifact family/name | local dev checkout | not run>
- Runtime connection: <connected via plugin auto-launch | connected to manual local runtime | browser local runtime | failed with sanitized summary | not run>
- Surface: <VS Code | JetBrains | browser dev surface | other sanitized surface | not run>
- Provider kind/model: <provider kind and non-secret model family/id only | local runtime family/id only | not run>
- CI status: mock/loopback-only; real provider was manual local dogfood only

## Setup checks

- Runtime connected before task drafting: <checked | failed with sanitized summary | not run>
- Provider configured and tested locally: <checked | failed with sanitized summary | not run>
- Production/default account login remains unavailable/blocked: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/cloud workspace not required: <checked | issue fixed before sharing | not run>

## Guided task flow

- Task goal drafted: <short sanitized goal summary, no raw prompt | not run>
- Explicit context attached: <active-file excerpt | snippets | memory notes | manual notes | intentionally omitted | not run>
- Reviewed excerpt policy: <bounded reviewed excerpts only | no raw file bodies pasted | not run>
- Prompt draft reviewed before send: <checked | issue found with sanitized summary | not run>
- User clicked Send manually: <checked | not run>
- Response reviewed: <useful | partially useful | not useful | failed with sanitized summary | not run>
- Edit proposal reviewed: <reviewable bounded proposal | no proposal | failed with sanitized summary | not run>
- Verification status, if any: <user-run sanitized summary | not run | out of scope for this run>

## Safety checks

- Provider secrets absent from report: <checked | issue fixed before sharing | not run>
- Runtime tokens/auth codes/cookies absent from report: <checked | issue fixed before sharing | not run>
- Raw private paths absent from report: <checked | issue fixed before sharing | not run>
- Raw prompts/provider responses absent from report: <checked | issue fixed before sharing | not run>
- Raw file bodies/patch bodies/bridge payloads absent from report: <checked | issue fixed before sharing | not run>
- No cloud-required workflow used or claimed: <checked | issue fixed before sharing | not run>
- No real-provider CI, publishing, signing, notarization, marketplace, or production release claim: <checked | issue fixed before sharing | not run>

## Known issues

- Known issues: <sanitized issue list or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
```

## Sanitization rules

Shareable tracked excerpts may mention only sanitized facts: provider kind, non-secret model family/id, surface type, bounded reviewed excerpt status, response usefulness, and sanitized issue summaries. Do not include raw file bodies except short bounded excerpts that were explicitly reviewed and are safe to share for the current task. Prefer summaries over excerpts when unsure. A sleepy checklist is cheaper than a leaked token; let the checklist do the guarding.
