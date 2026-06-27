# One-step Agent Run Dogfood Checklist

Use this checklist for a manual one-step Agent Run dogfood run with a real local BYOK provider or local model runtime. This is local evidence only. It is not CI evidence, not automation evidence, not production release evidence, and not a publication gate.

The one-step Agent Run path stays manual-only: the user drafts the goal, reviews the prompt, clicks Send, reviews or rejects the proposal, confirms checkpoint readiness, clicks Apply if appropriate, and clicks Verification if appropriate. Do not treat a completed report as proof of autonomous execution.

Sprint 61 may show an inert multi-step plan preview before any later user decision. Treat that preview as review-only display metadata, not as multi-step execution. It may summarize steps, risks, expected file labels, and allowlisted verification command-id suggestions, but it must not be reported as having sent chat, read files, applied edits, run verification, repaired, retried, rolled back, called providers, or mutated the workspace. Any future action still needs the separate visible manual control and existing confirmation boundary.

Sprint 62 may draft a second-step follow-up prompt after the user explicitly runs verification. Treat that draft as local reviewed prompt text plus metadata only: it may reference sanitized verification status, allowlisted command id, exit code, duration, short bounded result summary, prior proposal labels or ids, plan/proposal summary labels, and the user's explicit `followup` or `fix` intent. It is not sent until the user reviews it and clicks Send. Do not report it as automatic repair, automatic retry, automatic verification, automatic rollback, provider execution, shell/git/tool execution, or workspace mutation. Raw verification output, command strings, cwd/env values, raw prompts, raw diffs, file bodies, private paths, credentials, provider/tool/git fields, and hidden context must not be copied into the draft or report unless the user intentionally attaches sanitized one-shot context for that send.

Sprint 62 final audit status: this is bounded prompt drafting, not multi-step execution. The service, UI CTA, and smoke evidence are expected to preserve composer/focus-only behavior with no auto-send, apply, verification, repair, rollback, retry, context attachment, hidden reads, browser-storage persistence, provider/tool calls, shell/git execution, or new runtime/bridge authority. The focused local/mock verification gate is `npm run validate:contracts && cd apps/gui && npm test -- verificationFollowupPrompt AgentRunPanel App && npm run build && cd ../.. && npm run smoke:agent-run-followup-loop && npm run check && git diff --check`.

Sprint 63 hardening keeps those gates stable rather than broadening authority. For manual dogfood prep, treat `npm run check` as the docs/identity validation gate and the S61/S62 focused commands as behavior gates for Agent Run changes. The built-GUI smokes are local/mock-only and require local root dependencies, `apps/gui` dependencies, and Playwright/Chromium; missing GUI deps or Chromium are setup issues, not product readiness failures. Vite chunk-size warnings during GUI build are currently non-failing warnings only and must not be reported as release readiness or production autonomy evidence.

Sprint 64 status is recorded in [`../architecture/013-agent-readiness-milestone.md`](../architecture/013-agent-readiness-milestone.md). Use it as the canonical readiness taxonomy: current one-step Agent Run is manual local dogfood/dev-preview evidence, S61 plan preview and S62 follow-up/fix drafts are experimental manual-only adjuncts, and S64 classification does not enable autonomy, production readiness, marketplace readiness, real-provider CI, hidden reads, provider/tool calling, or automatic execution.

Sprint 67 adds a guided fix loop presentation for failed verification, but it remains manual and draft-only. A failed verification may show a sanitized "Manual guided fix" status and a "Draft Agent Run fix prompt" CTA when safe proposal lineage exists. Clicking that CTA only writes a fix prompt into the composer and focuses it; the user must review, edit if needed, and click Send manually. Unsafe verification metadata or raw-looking command/output/private-path fields must block the CTA or render sanitized blocked metadata only. The local/mock evidence gate is `npm run smoke:agent-run-guided-fix-loop`; it is not real-provider CI, auto-repair, auto-retry, auto-rollback, automatic verification, provider/tool execution, shell/git authority, production readiness, or autonomy evidence.

Sprint 67 final audit status: guided fix loop is complete for local dev-preview dogfood only. The audit expectation is no auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden reads, indexing, search, shell/git/tool/provider authority, or raw prompt/provider/file/diff/command/log browser-storage persistence. Use the full S67 verification bundle before changing this surface: `npm run validate:contracts && cd apps/gui && npm test -- guidedFixLoop verificationFollowupPrompt proposalHistory codingTaskSession AgentRunPanel App && npm run build && cd ../.. && npm run smoke:agent-run-guided-fix-loop && npm run smoke:agent-run-safety-bundle && npm run check && git diff --check`.

Sprint 68 adds safer apply review UX as display guidance only. The apply readiness and risk card may show sanitized file labels, edit counts, readiness items, risk badges, disabled reasons, and manual recovery guidance for ready, blocked, browser-preview, rejected, or unsafe proposal states. It does not inspect or expose raw replacement bodies, persist proposal bodies, create a new apply path, apply automatically, run verification, repair, retry, roll back, attach context, call providers/tools, or add runtime/bridge authority. Apply remains available only through the existing explicit user click and IDE-host confirmation path when the proposal, checkpoint, policy, host, and pending-state metadata are ready. The focused local/mock evidence gate is `npm run smoke:agent-run-safer-apply-ux`; it is included deliberately in `npm run smoke:agent-run-safety-bundle` because it is loopback-only and guards the same manual no-auto apply boundary before the S70 release-candidate bundle.

Sprint 68 safer apply UX audit expectation: no apply or verification request is emitted before the existing explicit user action; blocked checkpoint/policy or browser-preview states show blocked/manual guidance only; rejected or malformed proposals show recovery guidance with no apply action; unsafe labels or content are redacted from UI and browser storage. This remains dev-preview review guidance, not production readiness, autonomous apply, automatic verification, host mutation, real-provider CI, or release-candidate evidence.

Sprint 68 final audit status: safer apply UX is complete for local dev-preview dogfood only. The final audit expectation is met when the S68 verification bundle passes and no high or critical issue remains: apply readiness/risk and rejection recovery stay sanitized bounded metadata, apply enablement stays no broader than the existing supported-host manual confirmation path, and the smokes cover ready, blocked/browser-preview, rejected, and unsafe/no-leak states without auto-send, auto-apply, auto-verification, auto-repair, auto-retry, auto-rollback, hidden reads, indexing, search, shell/git/tool/provider authority, or raw prompt/provider/file/diff/command/log browser-storage persistence.

Sprint 69 adds task memory suggestions as display-only local metadata. Suggested notes come from safe bounded metadata overlap, stale or unsafe notes show warning labels, and only safe `suggested` notes expose an Attach control. Nothing is attached until the user clicks Attach; the click delegates to the existing one-shot project-memory bundle path and sanitized trace/session labels. Suggestion labels are not hidden runtime chat context, not a browser-storage persistence contract, and not a background memory search, save, provider call, bridge call, workspace read, or workspace mutation. The focused local/mock evidence gate is `npm run smoke:task-memory-suggestions`; it is not real-provider CI, production readiness, autonomy evidence, or memory indexing evidence.

CI and smoke automation for Agent Run remain mock/loopback-only. Do not put real provider credentials, production accounts, hosted Yet AI services, managed gateways, cloud workspaces, provider account-login flows, real apply actions, or real verification commands into CI.

## Scope and boundaries

In scope:

- A local runtime is connected from the IDE/plugin or browser dev surface.
- A provider is configured and tested through local BYOK settings, or a local model runtime is selected.
- The user drafts a one-step coding goal in the Agent Run UI.
- The user explicitly attaches or intentionally omits reviewed context.
- The user reviews the prompt draft and clicks Send manually.
- The user records whether a model proposal was detected, rejected, or absent.
- The user confirms checkpoint readiness before any apply request.
- The user clicks Apply manually only after reviewing the proposal.
- The user clicks allowlisted Verification manually only after apply succeeds.
- The report records sanitized observations, result, and known issues only.

Out of scope:

- Production/default account login is unavailable/blocked; provider web-session reuse, browser profile import, and private provider endpoints are out of scope.
- Hosted Yet AI backend requirements, Yet AI accounts, managed model gateways, product credit balances, cloud workspaces, cloud sync, or cloud-required task execution.
- Auto-send, auto-apply, auto-run verification, automatic repair, automatic retry, automatic rollback, shell/git/tool execution outside the explicit allowlisted verification bridge, workspace indexing, hidden file reads, background autonomy, publishing, signing, notarization, marketplace release, or real-provider CI.
- Raw provider credentials, runtime tokens, auth codes, cookies, request bodies, raw provider responses, raw prompts, raw verification output dumps, raw file bodies, raw diffs, raw patch bodies, private absolute paths, command strings, cwd/env values, bridge payload dumps, or browser-storage dumps in tracked docs, follow-up prompt drafts, or shareable reports.

## Manual run checklist

Keep the completed report in an ignored local evidence location unless a task explicitly asks for a sanitized tracked excerpt.

1. Start from a clean local checkout or dev-preview artifact and record only the commit or sanitized artifact family/name.
2. Record the host surface and browser/runtime surface using sanitized labels only, such as VS Code, JetBrains, browser dev surface, or plugin wrapper browser.
3. Launch or connect the local runtime through the selected IDE/plugin or browser dev surface.
4. Confirm the runtime is connected and record only the launch mode and surface type.
5. Configure and test the provider through local BYOK settings, or select a local model runtime.
6. Record provider family and non-secret model id only; do not record API keys, tokens, account identifiers, organization IDs, billing details, or credential paths.
7. Open the Agent Run panel and draft a concise one-step coding goal in local UI state.
8. Explicitly attach intended context, or record that context was intentionally omitted. Allowed report values are sanitized labels such as active-file excerpt, snippet, memory note, verification output, manual note, or omitted.
9. Confirm the context preview/summary is visible before Send when context is attached, uses bounded metadata or reviewed excerpts only, and does not show private absolute paths.
10. Draft the one-step Agent Run prompt from the UI control.
11. Review the final prompt draft in the chat box. Record only a sanitized summary of the intent, not the raw prompt.
12. Confirm no hidden indexing, recursive workspace read, shell/git/tool execution, auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, or auto-rollback occurred before Send.
13. Click Send manually once.
14. Confirm the selected one-shot context bundle was included with that manual send and cleared after accepted Send. If Send fails, confirm the bundle remains available for manual retry.
15. Review the streaming or final model response. Record only a short sanitized outcome and whether it was useful.
16. Record proposal handling: detected and reviewable, rejected by safety/parser checks, absent, or failed with a sanitized summary.
17. If a proposal is detected, inspect it in the GUI before any apply request. Record only whether it was bounded and reviewable; do not paste raw patch bodies, raw diffs, or full file contents.
18. Confirm checkpoint readiness before Apply. Record only sanitized checkpoint status such as verified, missing, stale, blocked, or not run.
19. If checkpoint readiness is missing or blocked, confirm the Apply control is unavailable or blocked and stop the run without applying.
20. If the user explicitly applies an edit, use only the visible manual Apply control and record sanitized apply status only.
21. Confirm no apply request was emitted before the explicit manual Apply click.
22. If apply fails or is rejected, record a sanitized failed/rejected status and whether rollback review metadata was available; do not retry automatically.
23. If apply succeeds, click allowlisted Verification manually only through the visible verification control.
24. Confirm the verification request uses the command-id-only allowlisted verification path. Record only command family or command id label, sanitized status, exit code when safe, duration when safe, and non-sensitive outcome.
25. Confirm no verification request was emitted before the explicit manual Verification click.
26. If verification fails, confirm the run stops without automatic repair, retry, or rollback. If a follow-up prompt draft appears, confirm it is draft-only, uses only sanitized verification metadata or explicit one-shot context, and waits for the user's separate Send click.
27. If verification succeeds, confirm the final Agent Run report renders a sanitized completed result. If a follow-up prompt draft appears for additional work, confirm it remains unsent until explicit user Send.
28. Open the `Coding session trace` panel. Confirm it starts collapsed/read-only, then inspect only sanitized metadata entries for explicit actions you performed: context attach or omit, Send, response/stream finish, proposal detection/rejection, checkpoint readiness, apply request/result, verification request/progress/result, follow-up prompt drafted if present, and final report.
29. Confirm the trace remains a bounded in-memory diagnostic view: no action buttons, no auto-send/apply/run controls, no raw prompt, raw provider response, raw verification output dump, raw file body, raw diff, memory body, verification body, private path, token, cookie, credential, or bridge payload dump.
30. Confirm browser storage does not contain provider credentials, raw prompts, raw responses, raw verification output, raw file bodies, raw diffs, private paths, memory note text, context bodies, verification bodies, follow-up prompt drafts, Agent Run reports, or coding-session trace entries.
31. Run the report through the relevant local sanitizer/checker if one exists before sharing.

## Sanitized report template

```md
# Yet AI One-step Agent Run Dogfood Report

Manual local evidence only. This report is not CI evidence, not automation evidence, not production release evidence, and not a publication gate. Keep untested fields as `not run`. Do not paste provider credentials, bearer headers, auth codes, cookies, runtime tokens, private absolute paths, raw provider responses, raw prompts, raw bridge payloads, raw patch bodies, raw diffs, raw file/source bodies, command strings, cwd/env values, or browser-storage dumps.

## Run metadata

- Commit/artifact: <git commit or sanitized artifact family/name | local dev checkout | not run>
- Runtime connection: <connected via plugin auto-launch | connected to manual local runtime | browser local runtime | failed with sanitized summary | not run>
- Host/browser: <VS Code | JetBrains | browser dev surface | plugin wrapper browser | other sanitized surface | not run>
- Provider family/model id: <provider family and non-secret model id only | local runtime family/id only | not run>
- CI status: mock/loopback-only; real provider was manual local dogfood only

## Setup checks

- Runtime connected before goal drafting: <checked | failed with sanitized summary | not run>
- Provider configured and tested locally: <checked | failed with sanitized summary | not run>
- Production/default account login remains unavailable/blocked: <checked | issue fixed before sharing | not run>
- Hosted Yet AI backend/cloud workspace not required: <checked | issue fixed before sharing | not run>

## One-step Agent Run flow

- Task goal drafted: <short sanitized goal summary, no raw prompt | not run>
- Explicit context: <active-file excerpt | snippets | memory notes | verification output | manual notes | intentionally omitted | not run>
- Context preview/summary visible before Send: <checked with sanitized labels/counts | issue found with sanitized summary | intentionally omitted | not run>
- Prompt drafted: <checked with sanitized intent summary | issue found with sanitized summary | not run>
- Prompt reviewed before Send: <checked | issue found with sanitized summary | not run>
- User clicked Send manually: <checked | not run>
- One-shot context bundle behavior: <included on accepted Send and cleared | Send failed and bundle remained | no bundle | issue found with sanitized summary | not run>
- Response reviewed: <useful | partially useful | not useful | failed with sanitized summary | not run>
- Proposal result: <detected and reviewable | rejected by safety/parser checks | absent | failed with sanitized summary | not run>
- Proposal rejection reason, if any: <malformed | unsafe metadata | stale correlation | wrong chat | settings changed | other sanitized summary | none | not run>
- Checkpoint readiness: <verified | missing | stale | blocked | not needed because proposal rejected/absent | not run>
- Manual apply status: <applied by explicit user action | blocked by checkpoint readiness | skipped | failed/rejected with sanitized summary | not run>
- Apply correlation: <no apply before explicit click; correlated result accepted | issue found with sanitized summary | not run>
- Manual verification status: <user-run sanitized summary | skipped | failed with sanitized summary | not run | out of scope for this run>
- Verification command label: <repository-check | gui-app-tests | engine-chat-tests | other approved command id label | skipped | not run>
- Verification correlation: <no verification before explicit click; command-id-only request; correlated result accepted | issue found with sanitized summary | skipped | not run>
- Follow-up prompt draft: <drafted after explicit verification with sanitized metadata only | not drafted | issue found with sanitized summary | not run>
- Follow-up Send: <user clicked Send explicitly | left as draft | skipped | not run>
- Final result: <completed after user-confirmed verification | stopped after proposal rejection | stopped before apply | stopped after failed apply | stopped after failed verification | not run>
- Trace panel default state: <collapsed and read-only | issue found with sanitized summary | not run>
- Trace entries inspected: <context attach/omit | Send | response/stream finish | proposal detection/rejection | checkpoint readiness | apply request/result | verification request/progress/result | final report | none | not run>
- Trace sanitization/bounds: <sanitized bounded metadata only | issue fixed before sharing | issue found with sanitized summary | not run>

## Safety checks

- Provider secrets absent from report: <checked | issue fixed before sharing | not run>
- Runtime tokens/auth codes/cookies absent from report: <checked | issue fixed before sharing | not run>
- Raw private paths absent from report: <checked | issue fixed before sharing | not run>
- Raw prompts/provider responses absent from report: <checked | issue fixed before sharing | not run>
- Raw file bodies/diffs/patch bodies/bridge payloads absent from report: <checked | issue fixed before sharing | not run>
- Command strings/cwd/env/browser-storage dumps absent from report: <checked | issue fixed before sharing | not run>
- Context/memory/verification bodies absent from tracked report unless explicitly approved and sanitized: <checked | issue fixed before sharing | not run>
- Browser storage checked for sensitive prompt/context/provider data: <checked | issue fixed before sharing | not run>
- Browser storage checked for Agent Run report and trace persistence: <checked; absent from storage | issue fixed before sharing | not run>
- No cloud-required workflow used or claimed: <checked | issue fixed before sharing | not run>
- No auto-send, auto-apply, auto-run verification, automatic repair, automatic retry, automatic rollback, shell/git/tool execution, hidden file reads, or real-provider automation; follow-up prompts stay draft-only until explicit Send: <checked | issue fixed before sharing | not run>
- No real-provider CI, publishing, signing, notarization, marketplace, or production release claim: <checked | issue fixed before sharing | not run>

## Known issues

- Known issues: <sanitized issue list or none | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
```

## Sanitization rules

Shareable tracked excerpts may mention only sanitized facts: commit or artifact family, host/browser surface, provider family, non-secret model id, context attached/omitted labels, prompt intent summary, proposal detected/rejected status, checkpoint status, manual apply status, manual verification status, final result, and sanitized issue summaries.

Do not include raw provider responses, raw prompts, raw file bodies, raw diffs, raw patch bodies, private paths, command strings, cwd/env values, credentials, browser-storage dumps, or bridge payload dumps. Prefer summaries over excerpts when unsure. A tidy manual checklist is not glamorous, but neither is chasing a leaked token through a Tuesday afternoon.
