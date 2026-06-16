# Yet AI Contracts

## Ownership and boundary

`packages/contracts` owns shared JSON Schemas, golden examples, and eventually generated or hand-maintained types for boundaries between Yet AI subsystems.

These contracts are the source of truth for engine, GUI, VS Code plugin, and JetBrains plugin protocol payloads. Future implementations should validate HTTP, SSE, and IDE bridge payloads against these schemas before dispatching them across subsystem boundaries.

Contract areas include engine HTTP requests and responses, SSE chat events, IDE bridge messages, capability summaries, tool metadata, and golden examples used by engine, GUI, and plugin tests.

## Current status

This package is schema and example scaffold only. It contains no runtime application code, generated types, package manifests, or protocol implementation.

Current login-first milestone status for these contracts is deliberately bounded: API-key/project-key setup through the local runtime is the safe/default real-provider path; Demo Mode is a no-key local trial outside provider-auth contracts; the Codex-like provider-auth lifecycle is experimental, high-risk, non-default, and mock-only in automation; official production OpenAI/ChatGPT account login is not implemented or approved. Contract examples and validators must not imply a hosted Yet AI backend requirement, marketplace release, signing/notarization, or production account-login support.

Current schemas:

- `schemas/engine/ping.schema.json` for `GET /v1/ping` responses.
- `schemas/engine/caps.schema.json` for `GET /v1/caps` responses.
- `schemas/engine/chat-command.schema.json` for `POST /v1/chats/{chat_id}/commands` requests.
- `schemas/engine/chat-list-response.schema.json`, `schemas/engine/chat-thread.schema.json`, and `schemas/engine/chat-message.schema.json` for engine-owned local chat history list, thread, and message payloads.
- `schemas/engine/sse-event.schema.json` for chat SSE event payloads.
- `schemas/engine/provider-*.schema.json` for local provider summaries, writes, model lists, and sanitized provider test responses.
- `schemas/engine/provider-auth-*-request.schema.json` and `schemas/engine/provider-auth-*-response.schema.json` for strict provider login start, exchange, disconnect request bodies and sanitized provider login start, status, exchange, and disconnect responses.
- `schemas/engine/planner-*.schema.json` for future/simulator-facing no-idle planner scheduler audits, agent run snapshots, and card/pool summaries.
- `schemas/engine/agent-progress-*.schema.json` for local sanitized planner/agent progress events and snapshots.
- `schemas/bridge/host-message.schema.json` for IDE host to GUI messages.
- `schemas/bridge/gui-message.schema.json` for GUI to IDE host messages.

The current strict runtime contract is intentionally narrow. Chat command validation covers only `user_message` with a bounded non-empty `requestId`, strict `payload.content`, and optional bounded active editor context, plus `abort` with no payload or an empty payload object. `POST /v1/chats/{chat_id}/commands` does not carry provider/model selection, API keys, auth tokens, request parameters, or hidden readiness overrides. Invalid fixtures explicitly keep future command types such as `regenerate`, `update_message`, `remove_message`, `set_params`, `tool_decision`, and `ide_tool_result` rejected. Bridge validation covers exact-version `gui.ready`, `gui.unloaded`, `host.ready`, `host.openedFromCommand`, non-privileged `host.contextSnapshot` active editor context shapes, current controlled IDE action messages (`gui.ideActionRequest`, `host.ideActionProgress`, and `host.ideActionResult`), the first strict confirmed edit proposal/result contracts (`gui.applyWorkspaceEditRequest` and `host.applyWorkspaceEditResult`), and strict assistant-authored read-only IDE action proposal envelopes (`assistant.ideActionProposal`). `gui.ready` may include an optional `payload.frameNonce` only as a 32-character lowercase hex iframe generation nonce for wrapper ready correlation; it is non-secret and is not a provider credential, runtime session token, bearer token, or host authorization token.

Assistant IDE action proposals are strict full JSON objects parsed by the GUI from assistant content; markdown, prose wrappers, partial objects, and mixed content are rejected by that parser. The schema owns the strict full-object payload contract. Each envelope requires `type: "assistant.ideActionProposal"`, exact version `2026-05-15`, `requiresUserConfirmation: true`, `cloudRequired: false`, and a bounded sanitized `summary` that rejects control characters. The only allowed actions are `getContextSnapshot` with no path or range, `openWorkspaceFile` with a safe workspace-relative path and no range, and `revealWorkspaceRange` with a safe workspace-relative path plus ordered bounded range. Assistant proposals must not include assistant-supplied `requestId` values or unknown fields. They are compact read-only proposals only: no auto-execution, no write path, no shell/git/tasks/tools/provider calls, and no arbitrary file reads/indexing. Current execution occurs only after explicit user confirmation through the existing controlled IDE action bridge in VS Code or JetBrains; browser surfaces remain preview/test fallback and do not execute controlled actions.

Controlled IDE actions are local-first, bounded, and limited in VS Code and JetBrains to read-only context snapshot metadata plus workspace navigation (`getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`). JetBrains execution is guarded by strict wrapper/Kotlin policy and emits only correlated `host.ideActionProgress` / `host.ideActionResult` after explicit GUI/user request. Controlled `getContextSnapshot` returns metadata only: source, active-editor boolean, and workspace folder count. It does not include a file path, selected text, or raw file contents; selected text is included only through the separate `host.contextSnapshot` visible prompt-attach/policy flow and may be sent to the configured provider as prompt context. Open/reveal actions are navigation only and must not mutate files. Controlled actions require bounded request correlation, safe workspace-relative paths, bounded ranges, sanitized progress/result messages, and `cloudRequired: false`; successful `openWorkspaceFile` host progress/results may identify the safe workspace-relative path, and successful `revealWorkspaceRange` host progress/results may identify both the safe workspace-relative path and bounded range. `host.ready` runtime bootstrap is local-first: runtime URLs are loopback `http(s)` URLs with explicit ports and no userinfo/query/fragment/path, and session tokens are bounded local runtime bearer tokens. They must not expose raw provider secrets, runtime tokens outside `host.ready`, absolute private paths, raw full file contents, shell output, git output, task output, provider responses, or arbitrary payloads. Browser remains preview/test fallback and does not execute controlled actions. Client-side pending-state clear is a GUI lifecycle behavior, not a contract cancellation message: stale progress/results after clear, chat switch, or settings/runtime changes must be ignored by clients, and duplicate completed results must stay bounded/cleared. The engine may observe sanitized progress/action metadata only; it does not execute IDE tools or mutate workspaces. Controlled actions do not add edit, shell, git, task, tool, provider-call, apply-patch, indexing, arbitrary file-read, or workspace mutation authority; the confirmed edit proposal remains the only bridge write path and still requires explicit confirmation. JetBrains confirmed edit apply is dev-preview only through the existing apply/result bridge messages, while browser mode remains preview-only/non-executing.

The `getActiveFileExcerpt` controlled action is the narrow prompt-context exception for the active editor only. The GUI request payload is exactly `{ "action": "getActiveFileExcerpt" }`; request payloads with path, glob, `includeFullFile`, recursive/index-workspace flags, provider/model/API-key fields, tools, shell, or git fields are invalid. A host may include `contextAttachment` only on a successful `host.ideActionResult` for this action. That attachment is strict `kind: "active_file_excerpt"`, source `vscode` or `jetbrains`, sanitized file metadata, bounded ordered range, bounded excerpt text, and a `truncated` boolean. Unavailable, rejected, or failed results must not include excerpt text. The excerpt is explicit user context for the active file, prompt-only, and one-shot; it is not arbitrary path reading, full-file access, recursive workspace indexing, assistant-triggered background context gathering, provider/tool execution, or cloud persistence. Chat commands may carry multiple user-selected excerpts only through `context.kind = "explicit_context_bundle"`. Each item is the same active-editor-derived context shape, so the bundle remains explicit one-shot prompt context and not a persisted collection, background scan, indexing request, arbitrary path read, glob/search input, full-file request, or assistant-triggered attach mechanism.

The `runVerificationCommand` controlled action is a contract-only preview for user-triggered allowlisted local verification. The GUI request payload is exactly `{ "action": "runVerificationCommand", "commandId": "repository-check" }`, `{ "action": "runVerificationCommand", "commandId": "gui-app-tests" }`, or `{ "action": "runVerificationCommand", "commandId": "engine-chat-tests" }`; the GUI, not the assistant/model, mints the top-level `requestId` only after explicit user confirmation. Request payloads with free-form `command`, `shell`, `args`, `cwd`, `env`, git, package-install, network, provider, model, API-key, tool, path, or assistant-supplied request correlation fields are invalid. Host results for this action are correlated `host.ideActionResult` payloads with sanitized `status`, `commandId`, `exitCode`, `durationMs`, bounded `outputTail`, `truncated`, `cloudRequired: false`, and user-facing `message`; they must not expose raw shell scripts, private paths, credentials, provider output, or unbounded logs. Browser surfaces remain preview-only/non-executing, and this contract does not enable model-triggered runs, arbitrary shell execution, package installation, network access, provider calls, git operations, workspace mutation, or background autonomy.

The edit proposal contract is local-only and confirmation-only: requests require `requiresUserConfirmation: true`, safe bounded summaries, `cloudRequired: false` when present, and text replacements for existing workspace-relative files only. Paths reject absolute paths, traversal, encoded traversal-like values, backslashes, drive letters, home paths, URLs, query strings, fragments, empty paths, and overlong values. Ranges use bounded non-negative line/character positions and reject reversed ranges. The result contract is request-correlated and sanitized with statuses `applied`, `denied`, `rejected`, or `failed`; it must not expose raw private paths, provider payloads, credentials, or secrets. The implemented MVP uses these contracts for GUI preview/review plus explicit GUI apply action, followed by IDE/user confirmation before the host applies bounded text edits. VS Code remains the reference host. JetBrains may use the same existing `gui.applyWorkspaceEditRequest` / `host.applyWorkspaceEditResult` messages only as a dev-preview confirmed edit apply host; this does not add a new write-capable bridge message, production support claim, or broader mutation authority. Browser surfaces remain preview-only/non-executing for workspace edits. The contract keeps the lifecycle bounded: confirmed edit proposals are preview-only until the GUI user explicitly applies; the GUI never edits files directly and is the only party that mints the `requestId`, so assistant-supplied request ids are not honored and only the latest valid proposal can be run from the chat view while historical bubbles stay non-runnable; the GUI's pending-state clear is client-side only and must not be interpreted as a host cancellation; stale results that arrive after clear, chat switch, or settings/runtime change are ignored; duplicate completed results for the same request id are bounded/cleared instead of overwriting a rendered outcome; and a non-`applied` status carries only sanitized status/message plus a short user-facing repair/retry hint with no auto-retry contract. Contracts still do not grant authority for autonomous edits, model-triggered apply, provider tool execution, provider calls, shell/tools/tasks/git, file create/delete/rename, apply-patch, arbitrary file reads/indexing, production JetBrains apply support, or production agent behavior.

Invalid fixtures explicitly keep legacy/unsafe GUI-to-host messages such as `gui.openFile`, `gui.revealRange`, `gui.executeIdeTool`, `gui.copyText`, `gui.showNotification`, and `gui.getHostContext` rejected, keep shell/tool/git/task/edit controlled action types rejected, and cover unsafe controlled action and edit proposal/result payloads. Positive and negative controlled IDE action fixtures explicitly cover metadata parity for action type, `cloudRequired: false`, safe workspace-relative path, range, summary/message, and progress/result correlation across `gui.ideActionRequest`, `host.ideActionProgress`, `host.ideActionResult`, and assistant read-only proposal envelopes. All other privileged bridge, tool, shell, task, git, and file-action flows remain disabled until schemas, request correlation, origin/source checks, policy, least-privilege allowlists, sanitized audit/logging, and user confirmation exist. The current milestone does not enable tools, tasks, knowledge, shell execution, unconfirmed file edits/apply patch, workspace indexing, or autonomous workspace mutation.

Chat history contracts are for local engine-owned conversation persistence only. `ChatListResponse` returns bounded `ChatThreadSummary` entries with `chatId`, `title`, `createdAt`, `updatedAt`, and `messageCount`. `ChatThread` returns the same local thread identity and bounded `messages`; each `ChatMessage` includes only `id`, `chatId`, `role`, `content`, `createdAt`, and optional `status`. History ids are path-safe strings, timestamps are ISO-like UTC strings, content is bounded, and every schema is strict. These payloads do not define or require cloud sync, hosted Yet AI accounts, a managed backend, provider routing metadata, auth/session metadata, raw provider responses, API keys, OAuth tokens, authorization codes, PKCE verifiers, cookies, local runtime session tokens, credential paths, private local paths, tool calls, file reads, or workspace mutation requests. User prompt and assistant content may be stored locally as history, so clients should present this as local persistence and users should avoid pasting secrets. Delete operations mean local Yet AI history deletion only; they do not represent provider-side deletion, encrypted sync, production retention policy, enterprise governance, or cloud workspace behavior.

Positive example payloads live under `examples/` and should stay small, stable, and free of secrets or local paths. Negative examples live under `examples-invalid/` and intentionally demonstrate payloads that must fail a mapped schema without using real secrets or local paths.

Range ordering constraints use Ajv `$data` references (for example, to ensure an end position is not before its start position). Repository contract validation therefore requires Ajv configured with `$data: true`; validators without `$data` support may compile these schemas incorrectly or miss ordering checks. The confirmed edit proposal schema also uses the repository-specific custom Ajv keyword `maxTotalReplacementText` to cap aggregate replacement text across all file edits; any local contract validator must register that keyword with the same summing behavior before compiling schemas. Contract validators for `packages/contracts/schemas/bridge/gui-message.schema.json` must include this custom keyword even when validating only bridge messages, because `gui.applyWorkspaceEditRequest` depends on it.

Confirmed edit proposal contract changes should run:

```sh
npm run validate:contracts
npm run check
```

If implementation behavior changes with the contract, also run the affected GUI and VS Code checks, including `cd apps/plugins/vscode && npm run check:webview-safety` and root `npm run smoke:vscode-edit-proposal` for confirmed edit-proposal smoke coverage.

`GET /v1/caps` includes a minimal local runtime signal: `runtime.mode = "local"`, `runtime.cloudRequired = false`, and `runtime.providerAccess = "direct"`. This records the product contract that Yet AI core runs through the local runtime and does not require a hosted Yet AI backend or managed model gateway.

## Provider endpoints

Provider configuration is an engine-owned, local-first BYOK boundary. Current schemas cover:

- `GET /v1/providers` returns sanitized provider summaries, direct local access flags, model placeholders, capability summaries, and secret placeholders only.
- `GET /v1/providers/{id}` returns one sanitized provider summary.
- `POST /v1/providers` creates a provider configuration with credentials or endpoint settings stored by the local runtime.
- `PATCH /v1/providers/{id}` updates provider metadata, enabled state, model placeholders, and replacement credentials without returning raw secrets.
- `DELETE /v1/providers/{id}` removes a provider configuration and associated local credential material where possible.
- `POST /v1/providers/{id}/test` checks config validity from the local runtime and returns sanitized status/errors; current behavior is intentionally narrow and adapter-specific checks should expand incrementally.
- `GET /v1/models` returns normalized model summaries from configured providers and local capability metadata.

Model summaries in `/v1/models`, provider `models`, and `/v1/caps` provider model entries use aligned sanitized metadata: `capabilities` declares bounded booleans for `chat`, `streaming`, `tools`, and `reasoning`, and `readiness.status` declares whether the model is `ready`, `disabled`, `missing_credentials`, `missing_model`, or `unsupported`. Optional readiness reasons are short user-facing labels only. Chat selection and GUI send readiness require an enabled configured provider plus a model with `readiness.status = "ready"`, `capabilities.chat = true`, and `capabilities.streaming = true`; missing metadata must not be treated as ready. This metadata is for local selection, display, and future gating; it does not enable tool execution, reasoning orchestration, shell access, file edits, dynamic provider discovery, production model catalog sync, or privileged runtime features. Global runtime feature flags such as `features.tools`, `features.tasks`, and `features.knowledge` remain separate and currently disabled unless a later contract explicitly changes them.

First-message readiness uses provider endpoints, not chat command smuggling. `/v1/models`, `GET /v1/providers`, `GET /v1/providers/{id}`, provider-auth status, and provider-test responses are sanitized readiness signals for GUI and IDE clients. The engine remains the authority for selecting an enabled configured provider/model from local state when a first chat message is sent. A `user_message` command contains only user-visible content and optional bounded active editor context with sanitized relative display paths, selection positions, language id, and selection text. VS Code and JetBrains hosts target the same strict `host.contextSnapshot` bridge contract for this active editor/selection context. It may alternatively contain one `explicit_context_bundle` whose non-empty `items` are all active-editor-derived context objects using the same sanitized file metadata, language id, range, and bounded selection text rules. Bundles are capped at 4 items and an aggregate selection-text limit, deny unknown fields, and do not accept provider/model/API-key, tool, shell, git, index/search/glob/path, full-file, or assistant-supplied request correlation fields. `host.contextSnapshot.selection.text` is the bounded active user/editor-selected prompt-context exception: it may contain the user's selected text for the first-message preview/send path, but it is not controlled IDE action result/progress metadata and must not be reused in `host.ideActionResult`, `host.ideActionProgress`, audit summaries, or engine progress metadata. The active context is previewed by the GUI before opt-in and is sent to the configured provider as prompt text when included, so users must not attach secrets or sensitive private data. GUI attachment is one-shot for the next accepted message and should be treated as prompt-only, bounded, non-privileged IDE context. It must not include `providerId`, `modelId`, `apiKey`, auth tokens, endpoint overrides, generation params, metadata secret bags, autonomous file-read or indexing requests, tool calls, edit commands, apply-patch requests, shell commands, or workspace mutation requests. API-key/OpenAI-compatible provider readiness remains the safe/default real-provider path and takes precedence over the experimental Codex-like OAuth fallback. Experimental OAuth readiness remains explicit-risk and mock/loopback automation only unless a specific manual task explicitly accepts real-account testing.

Provider-auth schemas cover strict request bodies and sanitized responses for `POST /v1/provider-auth/{provider}/start`, `GET /v1/provider-auth/{provider}/status?session_id=...`, `POST /v1/provider-auth/{provider}/exchange`, and `POST /v1/provider-auth/{provider}/disconnect`. Request contracts are deliberately narrow: start accepts only `{}` or explicit dev-preview/mock and high-risk experimental flags already used by the engine, bounded TTL, and loopback-only experimental endpoint overrides; it rejects provider/model/API-key overrides, hidden readiness, auth tokens, cookies, authorization headers, raw provider secrets, arbitrary endpoints, and unknown fields. Exchange accepts only bounded `sessionId`, `state`, and authorization-code-shaped inbound strings (or `{}` for status-like fallback behavior) and rejects unknown fields, control characters, and oversized values. Disconnect accepts `{}` only; provider identity is path-owned. Response contracts expose only non-secret login progress and configured-state fields such as `status`, `authSource`, `sessionId`, URLs, account labels, scopes, expiry, redacted hints, and messages. Provider-auth pending/session state is local engine-owned state; current pending storage is hardened for dev-preview mock and experimental flows but does not make those flows production OAuth. Raw provider secrets, tokens, authorization codes, PKCE verifiers, cookies, browser profiles, and credential file paths must not become GUI-owned, GUI-facing, or fixture-visible. OpenAI/ChatGPT account login contracts are for an approved experimental, high-risk Codex-like path, not a claim of production readiness, official OpenAI partnership, or general public OAuth support. Production/default account login remains blocked until an official/provider-supported local-app flow is approved. The official OpenAI API-key or project-key fallback remains the safe/default real-provider path. Provider-auth response schemas bound GUI-facing strings and reject obvious secret or private-path markers in `message`, `lastError`, `accountLabel`, `redacted`, `sessionId`, `authorizationUrl`, `verificationUrl`, and `scopes[]`, including authorization/bearer headers, raw access or refresh token labels, API-key markers, cookies, client secrets, `auth.json`, private absolute paths, long `sk-*` key shapes, and JWT-like strings. Redacted hints may show short placeholders such as `sk-...abcd`, but must not carry usable credential material.

Provider-auth lifecycle fixtures should cover product UX states across pending login start, connected status/exchange, expired login, revoked disconnect success, login unavailable, API-key configured fallback, and sanitized failure responses when an endpoint can return an error-like status. Positive request fixtures cover empty/default-safe bodies, explicit mock start, experimental loopback-only start, bounded exchange fields, and empty disconnect only. Positive fixtures must stay free of raw credential material. Invalid provider-auth fixtures should cover rejected raw token-like or unknown fields, invalid provider IDs, non-HTTPS/non-loopback or query/userinfo endpoint URLs where the schema owns URL shape, endpoint overrides without the explicit experimental flag, invalid `status`/`authSource` combinations where practical, oversized/control-character values, non-empty disconnect bodies, and `cloudRequired` values other than `false`.

Provider response examples must not include API keys, OAuth refresh tokens, environment secrets, or private local paths. GUI clients may submit secrets for save/test actions but must not persist them after the request. In provider response `auth` objects, `redacted` is required only when `type = "api_key"` and `configured = true`; it is omitted for unconfigured API-key auth and non-secret auth types. Provider-auth responses must not include raw access tokens, refresh tokens, API keys, cookies, authorization codes, browser profile paths, browser cookie reuse data, `~/.codex/auth.json` content, other tools' credential file paths, or any imported provider credential file material.

## Planner scheduler contracts

Planner scheduler contracts are future/simulator-facing product contracts only. They do not implement production runtime orchestration, background agents, merges, verification execution, file edits, shell commands, tool execution, or workspace mutation. Their purpose is to keep the no-idle scheduler vocabulary strict before implementation.

Current planner schemas cover sanitized scheduler tick audits, delegated agent run status snapshots, and card/pool status summaries. They require explicit `autonomousMode`, a bounded `nextAction`, audited `idleReason` whenever `nextAction = "idle_blocked"`, explicit agent statuses such as `running`, `done`, `failed`, `stuck`, and `unknown`, and card statuses such as `done_unmerged`, `merge_pending`, `verification_pending`, `verified`, `blocked`, and `replan_required`. A card can be `verified` only when merge and verification states show `merged` and `passed`.

Planner overflow recovery is represented by the optional `overflowRecovery` object where the schema shape supports it: planner agent run snapshots, scheduler tick summaries, pool summaries, individual card summaries, and agent progress snapshots/list entries. Its `kind` enum is limited to `context_length_exceeded`, `tool_output_too_large`, and `task_board_output_too_large`; its message is a short sanitized user-facing summary, not a raw prompt, raw tool result, raw task-board dump, transcript, log tail, provider body, file content, credential material, or private path. Planner `overflowRecovery` is active recovery guidance, not historical metadata: planner agent snapshots may include it only for `failed` or `stuck` runs with `nextAction = "recover_failed"`; scheduler ticks and pool summaries may include it only for recovery or audited blocked actions; card summaries may include it only for `blocked`, `replan_required`, `failed`, or `stuck` cards. Closed, successful, `done`, `verified`, and merge-completed planner states must omit active `overflowRecovery`; consumers must not show stale recovery guidance for those states. Historical audit entries may retain sanitized summaries of past outcomes, but they must not be reinterpreted as active guidance after the state becomes successful or closed. These contracts allow future planner/agent progress to report recoverable overflow and safe retry guidance while preserving local-first operation and without introducing hosted recovery services. Safe summary fields reject mixed-case unsafe markers such as authorization headers, bearer strings, cookies, credential labels, provider-response labels, raw prompt/file/workspace markers, and credential filenames. JSON Schema `pattern` does not carry a JavaScript-style `/i` flag, so planner safe-text schemas use explicit mixed-case-safe pattern alternatives and aligned invalid fixtures instead of relying on case-insensitive regex options.

The repository also includes local-only planner verification commands:

```sh
npm run check:planner-scheduler
npm run smoke:planner-no-idle
npm run smoke:planner-resume
npm run planner:scheduler:tick -- --state path/to/scheduler-state.json
```

These commands exercise the pure scheduler reducer, durable local simulator state, one-tick CLI runner, deterministic no-idle smoke, and restart/resume smoke against the planner contract vocabulary. They prove that actionable merge, verification, ready-card, stuck-recovery, pool-close, approved next-pool, and reloaded durable-state states produce progress actions or explicit audited idle blockers. The simulator state records sanitized audit timeline entries, one lease owner per tick, released leases after process-like ticks, and stale-heartbeat recovery after reload. They do not implement production orchestration, spawn real agents, execute shell commands, run real merges, edit files, call providers, or mutate workspaces.

Planner fixtures must stay small and sanitized. They may include non-secret IDs, timestamps, counts, bounded status enums, and safe summaries. They must not include raw prompts, provider responses, API keys, OAuth tokens, authorization codes, cookies, private paths, raw local logs, workspace file contents, hidden credential bags, privileged tool commands, shell commands, or apply-patch/edit payloads.

## Agent progress observability contracts

Agent progress contracts are local contract foundations for transparent planner/agent status reporting and the current read-only progress surface. Current coverage is contracts plus a pure reducer/classifier, durable local simulator state, a compact CLI reporter, deterministic simulator smoke scenarios, strict `AgentProgressListResponse`, engine `GET /v1/agent-progress` backed by an engine-owned local source, focused endpoint smoke, and a GUI read-only Agent progress panel covered by deterministic browser smoke. They do not implement a production agent runner, real runner hooks, real task-board integration, tool execution, shell execution, provider calls, git operations, merges, hosted services, cloud sync, or workspace mutation. The current engine-folder placement is temporary so existing contract validation can map examples consistently.

`AgentProgressEvent` records one bounded operational event with `protocolVersion`, path-safe `eventId` and `runId`, bounded `cardId`, UTC `timestamp` with an explicit trailing `Z`, strict `phase` and `status` enums, and a short sanitized `message`. Optional fields are limited to a safe tool summary, heartbeat timestamps and attempt count, and a bounded sanitized `outputTail`.

`AgentProgressSnapshot` records the current run/card ids, start/update/completion UTC `Z` timestamps, current phase/status/message, bounded elapsed and age metrics, optional current tool summary, optional heartbeat/tool-output UTC `Z` timestamps and bounded ages, optional sanitized output tail, optional `stuckReason` (`heartbeat_timeout`, `tool_output_timeout`, `explicit_failure`, `explicit_stuck`, or `none`), optional bounded sanitized `overflowRecovery`, and a bounded list of recent event summaries. Active `overflowRecovery` is valid only for `failed`, `stuck`, or `stalled` snapshots whose phase is not `done`; all `done` phase snapshots must omit it so stale recovery guidance is not exposed after completion.

`AgentProgressListResponse` is the current read-only engine/GUI list surface for local progress observability. The engine owns the local progress source behind `GET /v1/agent-progress`; clients receive only the response contract, never source paths, file metadata, raw parser errors, or local storage details. The current source is the engine cache `agent-progress/progress.json`; the JS writer helper resolves the normal cache file as `<cacheRoot>/yet-ai/agent-progress/progress.json`, with explicit local overrides through `--state` or `YET_AI_AGENT_PROGRESS_STATE` for tests and developer workflows. The public `progress.json` file is an `AgentProgressListResponse` and is the endpoint-readable file. Internal event accumulation is stored separately by the JS helper in helper-owned state and should not be consumed by the engine or GUI. This source can produce populated sanitized progress snapshots before production runner hooks exist. A missing local progress source is represented as an empty list. A corrupt, invalid, oversized, or unsafe source is treated as unavailable/error at runtime with sanitized text and without echoing file contents, raw paths, auth-file names, parser details, or storage internals. The response returns `cloudRequired: false`, `providerAccess: "direct"`, an optional bounded UTC `Z` `generatedAt`, and a bounded `snapshots` array aligned with the strict sanitized snapshot shape. Empty lists are valid and mean no local progress has been written yet. The response does not define start, stop, merge, apply, write, shell, tool, provider, hosted-backend, account, cloud-workspace, source-metadata, or mutation actions. The GUI panel may refresh and render this response only; it must not expose Start, Stop, Merge, Apply, shell, tool, provider-call, git, or workspace-mutation controls.

The local writer workflow is outside the response contract and remains explicit developer tooling. `scripts/planner-agent-progress-state.mjs` provides `resolveAgentProgressStatePath`, `appendProgressEvent`, `readProgressState`, and `snapshotProgressState`; `appendProgressEvent` stores helper-owned internal event accumulation separately and publishes the public list-response file. `readProgressState` is for helper/report compatibility with that internal event state, not an engine or GUI input. `npm run planner:agent-progress:run -- --card T-123 --run local-run-1 --state path/to/progress.json -- npm run check` wraps only the deliberate local command after `--`, records sanitized heartbeat/tool-output/done/failed events, and returns the wrapped command exit code. `npm run planner:agent-progress:report -- --state path/to/progress.json` prints a compact sanitized snapshot. These helpers do not change the GUI contract, do not implement production background agents, and do not grant shell/tool/git/provider/workspace mutation authority from the endpoint or GUI.

These payloads are intended for user-visible progress such as queued, reading context, editing, running commands, waiting for tools, verifying, finishing, done, failed, or stuck. A future runner should emit them from explicit sanitized lifecycle hooks. They may include only safe operational summaries, non-secret ids, UTC `Z` timestamps, bounded elapsed and heartbeat/tool-output times, status enums, phase names, tool kind/label, attempt count, short sanitized output tails, and sanitized overflow recovery summaries for context, tool-output, or task-board overflow. They must not include raw prompts, chain-of-thought, hidden reasoning, provider raw responses, API keys, OAuth tokens, authorization headers, cookies, PKCE verifiers, passwords, provider credentials, runtime session tokens, private absolute paths, credential paths, raw file contents, large logs, shell scripts, apply-patch payloads, workspace file bodies, or secret-like keys/values. Invalid fixtures cover forbidden extra fields, secret-like terms, private absolute paths, oversized output tails, raw provider responses, file-content-like payloads, mixed-case unsafe markers, and unsafe or overlong overflow recovery fields.

Local verification commands for this boundary are:

```sh
npm run check:agent-progress
npm run smoke:agent-progress
npm run smoke:agent-progress-endpoint
npm run smoke:gui-agent-progress
```

Use the final gate context `npm run check:agent-progress && npm run smoke:agent-progress && npm run smoke:agent-progress-endpoint && npm run smoke:gui-agent-progress && npm run check && git status --short` when syncing docs or changing progress contracts/utilities, endpoint behavior, or the GUI read-only panel. These commands validate sanitized reducer/state/report behavior, local simulator smoke scenarios, local endpoint source handling, and loopback-only GUI rendering only; they do not run production agents, execute tools, perform git operations, mutate workspaces, call providers, or require hosted Yet AI services.

### Overflow and raw-content hardening matrix

| Boundary | Final behavior | Focused verification |
| --- | --- | --- |
| Contracts | Reject unsafe public payloads with strict enums, bounded fields, active-state `overflowRecovery` restrictions, and explicit mixed-case-safe safe-text patterns. Positive and invalid fixtures define the allowed sanitized vocabulary. | `npm run validate:contracts` |
| Scheduler durable state | Reconstructs, bounds, rejects, or sanitizes simulator state fields before persistence, including known status/action fields and audit summaries, so unsafe state cannot become durable public guidance. | `npm run check:planner-scheduler`, `npm run smoke:planner-no-idle`, `npm run smoke:planner-resume` |
| Agent-progress reducer | Classifies overflow from bounded raw head/tail text before raw-content line redaction, then persists and reports only sanitized, bounded messages, output tails, recent events, and recovery summaries. | `npm run check:agent-progress`, `npm run smoke:agent-progress` |
| GUI read-only panel | Uses typed `overflowRecovery` when present and otherwise classifies fallback overflow from bounded raw snapshot fields before display redaction; rendered output remains sanitized and bounded, including structured raw-content key variants. | `npm run smoke:gui-agent-progress`, plus `cd apps/gui && npm test && npm run typecheck` |

When syncing overflow/raw-content contracts, scheduler state, reducer behavior, or GUI rendering together, use the cross-boundary gate:

```sh
npm run validate:contracts && npm run check:planner-scheduler && npm run smoke:planner-no-idle && npm run smoke:planner-resume && npm run check:agent-progress && npm run smoke:agent-progress && npm run smoke:agent-progress-endpoint && npm run smoke:gui-agent-progress && npm run check && git status --short
```


## Versioning

Schemas use JSON Schema draft 2020-12. The initial protocol version is represented as a string in protocol payloads, for example `2026-05-15`.

Schemas are intentionally minimal and will evolve as implementation starts. Changes should be additive when practical. Breaking changes must update schema IDs or protocol version fields, refresh examples, and be coordinated across engine, GUI, and both IDE plugins.

`snapshot` SSE events reset client state and sequence tracking. Other chat events use monotonic `seq` values within a chat stream.

SSE events with `type: "error"` use a stable sanitized payload shape with a bounded user-facing `message` and one taxonomy `code`. Error payloads are intentionally small and do not carry raw provider responses, provider URLs, request bodies, authorization headers, API keys, OAuth tokens, cookies, account or organization ids, credential paths, private absolute paths, or debug payloads. Current provider/chat error codes are:

- `provider_not_configured` when no usable local provider is configured.
- `model_not_configured` when the selected model is missing, disabled, or not ready.
- `provider_unauthorized` when local credentials are missing, expired, revoked, or rejected.
- `provider_rate_limited` when the provider reports rate limit, quota, or credit exhaustion.
- `provider_context_too_large` when the prompt/request, including any attached active editor context, exceeds the selected model context window.
- `provider_invalid_request` when the provider rejects a sanitized malformed or unsupported request.
- `provider_timeout` when the provider request or stream times out.
- `provider_upstream_error` when the provider service returns an upstream failure.
- `provider_malformed_stream` when streaming provider output is malformed or ends unexpectedly.
- `provider_config_error` when local provider configuration is invalid.
- `provider_request_failed` as the legacy fallback for provider request failures that cannot yet be mapped more specifically.

Classification may use bounded HTTP status, bounded response text, or bounded stream error-frame signals, but it is best-effort because providers and local gateways do not all use OpenAI-compatible error shapes. Runtime and GUI-facing implementations must prefer safe fallback codes and stable Yet AI-generated messages over raw provider text. GUI recovery guidance should map the codes to user actions such as configure a provider, select a ready model, re-enter credentials, check quota, reduce prompt or attached editor context, fix invalid configuration, check provider status, or retry later. The contract does not define automatic retries or production-grade provider compatibility.

Provider error taxonomy changes should keep positive and invalid SSE fixtures aligned and can be checked with:

```sh
npm run validate:contracts
npm run smoke:provider-errors
```

`npm run smoke:provider-errors` is loopback-only and validates stable sanitized SSE codes/messages, sanitized persisted chat history, and absence of raw fake secrets, provider bodies, request-body markers, cookies, bearer strings, auth codes, or private paths in client-visible smoke output.

## Login-first verification matrix

Use the focused command for the boundary changed and keep provider-auth automation fake/loopback-only:

| Area | Command | Contract expectation |
| --- | --- | --- |
| Contracts | `npm run validate:contracts` | Provider-auth request/response fixtures stay strict and sanitized |
| Rust provider-auth/chat | `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat` | Runtime behavior preserves engine-owned auth state and no-secret chat surfaces |
| GUI app | `cd apps/gui && npm test -- App && npm run build` | GUI consumes sanitized statuses and preserves API-key fallback/Demo copy |
| Login-first smoke | `npm run smoke:login-first-message` | Mock-only lifecycle and canned first-message flow stay wired |
| Demo/local smokes | `npm run smoke:gui-demo-mode` and `npm run smoke:local` | No-key local trial and loopback runtime behavior remain available |
| IDE smokes | `npm run smoke:vscode-first-message` and `npm run smoke:jetbrains-first-message` | IDE wrappers preserve local runtime first-message paths without storing provider secrets |
| Release-candidate smoke | `npm run smoke:ide-release-candidate` | Aggregated dev-preview smoke only, not publishing or signing |
| Repository check | `npm run check` | Docs, identity, hygiene, and focused validators remain aligned |

Docs-only contract publication changes should finish with `npm run check && npm run validate:contracts && git diff --check`.

## Future commands

These commands are available from the repository root:

```sh
npm run validate:contracts
```

Contract validation recursively discovers every schema under `schemas/**/*.json`, every positive example under `examples/**/*.json`, and every negative example under `examples-invalid/**/*.json`. Discovered paths and configured mappings are normalized to POSIX-style `/` separators so mappings stay portable across platforms. Validation fails if any of these fixture groups disappears or is empty after successful directory discovery. Every discovered schema is compiled with AJV in strict mode, even if no example currently maps to it. Every positive example must have an explicit example-to-schema mapping unless it is intentionally allowlisted in the validator with a clear reason. Every negative example must have an explicit invalid example-to-schema mapping and must fail that schema; validation fails if a negative example unexpectedly passes. Examples that include product identity fields must match `product/identity.json`.

These commands are not available until generation and package-specific tests exist:

```sh
npm run generate:contracts
npm run test:contracts
```

Repository-level validation is currently available from the root:

```sh
npm run check
```

## Dependencies

- Contract examples that include product identity fields must read from or match `product/identity.json`.
- Engine, GUI, VS Code plugin, and JetBrains plugin should depend on contracts for shared boundary shapes once schemas exist.
- Contracts should remain product-level interfaces, not hidden application logic.

## Security expectations

- Every privileged bridge message must be schema-validated and policy-checked by future implementations before it can trigger file edits, IDE tool execution, shell-like behavior, workspace mutation, or privileged host actions.
- Current bridge schemas are strict for `gui.ready`, `host.ready`, `host.openedFromCommand`, non-privileged `host.contextSnapshot`, read-only/navigation controlled IDE actions (`gui.ideActionRequest`, `host.ideActionProgress`, and `host.ideActionResult`), confirmed `gui.applyWorkspaceEditRequest`, and sanitized `host.applyWorkspaceEditResult`; the engine assistant proposal schema is strict for full-object `assistant.ideActionProposal` read-only/navigation proposals requiring explicit user confirmation. Controlled IDE actions and assistant proposals do not write files or execute shell/tool/git/task/provider operations, and the confirmed edit proposal remains the only write path.
- Current chat command schemas are strict only for non-privileged `user_message` with optional bounded active editor context and `abort`; tool decisions, IDE tool results, parameter changes, message mutation, regeneration, file edits, shell-like actions, and workspace mutation remain disabled until schema, policy, request correlation where needed, and confirmation are implemented.
- Receivers should validate every engine HTTP request, engine HTTP response, SSE event, and bridge message at subsystem boundaries.
- Bridge receivers must verify host/source/origin where the platform supports it and correlate request-response messages with outstanding requests.
- Safe UI messages such as theme and active file updates must remain conceptually separate from privileged requests such as workspace edits and IDE tool execution.
- The engine must remain the authority for tool authorization and confirmation policy even when requests originate from GUI or IDE bridge messages.

## Safety rules

- Do not add runtime application code in this scaffold phase.
- Keep schemas explicit, versioned, and validated before they are used by privileged boundaries.
- Avoid embedding secrets, local paths, or user-specific values in examples.
- Keep bridge contracts separated between safe UI messages and privileged requests.
- Do not hardcode product-sensitive values that should be sourced from `product/identity.json`.
