# Yet AI Contracts

## Ownership and boundary

`packages/contracts` owns shared JSON Schemas, golden examples, and eventually generated or hand-maintained types for boundaries between Yet AI subsystems.

These contracts are the source of truth for engine, GUI, VS Code plugin, and JetBrains plugin protocol payloads. Future implementations should validate HTTP, SSE, and IDE bridge payloads against these schemas before dispatching them across subsystem boundaries.

Contract areas include engine HTTP requests and responses, SSE chat events, IDE bridge messages, capability summaries, tool metadata, and golden examples used by engine, GUI, and plugin tests.

## Current status

This package is schema and example scaffold only. It contains no runtime application code, generated types, package manifests, or protocol implementation.

Current schemas:

- `schemas/engine/ping.schema.json` for `GET /v1/ping` responses.
- `schemas/engine/caps.schema.json` for `GET /v1/caps` responses.
- `schemas/engine/chat-command.schema.json` for `POST /v1/chats/{chat_id}/commands` requests.
- `schemas/engine/chat-list-response.schema.json`, `schemas/engine/chat-thread.schema.json`, and `schemas/engine/chat-message.schema.json` for engine-owned local chat history list, thread, and message payloads.
- `schemas/engine/sse-event.schema.json` for chat SSE event payloads.
- `schemas/engine/provider-*.schema.json` for local provider summaries, writes, model lists, and sanitized provider test responses.
- `schemas/engine/provider-auth-*-response.schema.json` for future sanitized provider login start, status, exchange, and disconnect responses.
- `schemas/engine/planner-*.schema.json` for future/simulator-facing no-idle planner scheduler audits, agent run snapshots, and card/pool summaries.
- `schemas/engine/agent-progress-*.schema.json` for local sanitized planner/agent progress events and snapshots.
- `schemas/bridge/host-message.schema.json` for IDE host to GUI messages.
- `schemas/bridge/gui-message.schema.json` for GUI to IDE host messages.

The current strict runtime contract is intentionally narrow. Chat command validation covers only `user_message` with a bounded non-empty `requestId`, strict `payload.content`, and optional bounded active editor context, plus `abort` with no payload or an empty payload object. `POST /v1/chats/{chat_id}/commands` does not carry provider/model selection, API keys, auth tokens, request parameters, or hidden readiness overrides. Invalid fixtures explicitly keep future command types such as `regenerate`, `update_message`, `remove_message`, `set_params`, `tool_decision`, and `ide_tool_result` rejected. Bridge validation covers only exact-version `gui.ready`, `host.ready`, `host.openedFromCommand`, and non-privileged `host.contextSnapshot` active editor context shapes. Invalid fixtures explicitly keep future GUI-to-host messages such as `gui.openFile`, `gui.revealRange`, `gui.applyWorkspaceEditRequest`, `gui.executeIdeTool`, `gui.copyText`, `gui.showNotification`, and `gui.getHostContext` rejected. Privileged bridge, tool, and file-edit flows remain disabled until schemas, request correlation, origin/source checks, policy, least-privilege allowlists, sanitized audit/logging, and user confirmation exist. The current milestone does not enable tools, tasks, knowledge, shell execution, file edits/apply patch, workspace indexing, or autonomous workspace mutation.

Chat history contracts are for local engine-owned conversation persistence only. `ChatListResponse` returns bounded `ChatThreadSummary` entries with `chatId`, `title`, `createdAt`, `updatedAt`, and `messageCount`. `ChatThread` returns the same local thread identity and bounded `messages`; each `ChatMessage` includes only `id`, `chatId`, `role`, `content`, `createdAt`, and optional `status`. History ids are path-safe strings, timestamps are ISO-like UTC strings, content is bounded, and every schema is strict. These payloads do not define or require cloud sync, hosted Yet AI accounts, a managed backend, provider routing metadata, auth/session metadata, raw provider responses, API keys, OAuth tokens, authorization codes, PKCE verifiers, cookies, local runtime session tokens, credential paths, private local paths, tool calls, file reads, or workspace mutation requests. User prompt and assistant content may be stored locally as history, so clients should present this as local persistence and users should avoid pasting secrets. Delete operations mean local Yet AI history deletion only; they do not represent provider-side deletion, encrypted sync, production retention policy, enterprise governance, or cloud workspace behavior.

Positive example payloads live under `examples/` and should stay small, stable, and free of secrets or local paths. Negative examples live under `examples-invalid/` and intentionally demonstrate payloads that must fail a mapped schema without using real secrets or local paths.

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

First-message readiness uses provider endpoints, not chat command smuggling. `/v1/models`, `GET /v1/providers`, `GET /v1/providers/{id}`, provider-auth status, and provider-test responses are sanitized readiness signals for GUI and IDE clients. The engine remains the authority for selecting an enabled configured provider/model from local state when a first chat message is sent. A `user_message` command contains only user-visible content and optional bounded active editor context with sanitized relative display paths, selection positions, language id, and selection text. VS Code and JetBrains hosts target the same strict `host.contextSnapshot` bridge contract for this active editor/selection context. The active context is previewed by the GUI before opt-in and is sent to the configured provider as prompt text when included, so users must not attach secrets or sensitive private data. GUI attachment is one-shot for the next accepted message and should be treated as prompt-only, bounded, non-privileged IDE context. It must not include `providerId`, `modelId`, `apiKey`, auth tokens, endpoint overrides, generation params, metadata secret bags, autonomous file-read or indexing requests, tool calls, edit commands, apply-patch requests, shell commands, or workspace mutation requests. API-key/OpenAI-compatible provider readiness remains the safe/default real-provider path and takes precedence over the experimental Codex-like OAuth fallback. Experimental OAuth readiness remains explicit-risk and mock/loopback automation only unless a specific manual task explicitly accepts real-account testing.

Future provider-auth schemas cover sanitized responses for `POST /v1/provider-auth/{provider}/start`, `GET /v1/provider-auth/{provider}/status?session_id=...`, `POST /v1/provider-auth/{provider}/exchange`, and `POST /v1/provider-auth/{provider}/disconnect`. These contracts expose only non-secret login progress and configured-state fields such as `status`, `authSource`, `sessionId`, URLs, account labels, scopes, expiry, redacted hints, and messages. Provider-auth pending/session state is local engine-owned state; current pending storage is hardened for dev-preview mock and experimental flows but does not make those flows production OAuth. Raw provider secrets, tokens, authorization codes, PKCE verifiers, cookies, browser profiles, and credential file paths must not become GUI-owned, GUI-facing, or fixture-visible. OpenAI/ChatGPT account login contracts are for an approved experimental, high-risk Codex-like path, not a claim of production readiness, official OpenAI partnership, or general public OAuth support. The official OpenAI API-key or project-key fallback remains the safe/default real-provider path.

Provider-auth lifecycle fixtures should cover product UX states across pending login start, connected status/exchange, expired login, revoked disconnect success, login unavailable, API-key configured fallback, and sanitized failure responses when an endpoint can return an error-like status. Positive fixtures must stay free of raw credential material. Invalid provider-auth fixtures should cover rejected raw token-like or unknown fields, invalid provider IDs, non-HTTPS authorization URLs where the schema owns URL shape, invalid `status`/`authSource` combinations where practical, and `cloudRequired` values other than `false`.

Provider response examples must not include API keys, OAuth refresh tokens, environment secrets, or private local paths. GUI clients may submit secrets for save/test actions but must not persist them after the request. In provider response `auth` objects, `redacted` is required only when `type = "api_key"` and `configured = true`; it is omitted for unconfigured API-key auth and non-secret auth types. Provider-auth responses must not include raw access tokens, refresh tokens, API keys, cookies, authorization codes, browser profile paths, browser cookie reuse data, `~/.codex/auth.json` content, other tools' credential file paths, or any imported provider credential file material.

## Planner scheduler contracts

Planner scheduler contracts are future/simulator-facing product contracts only. They do not implement production runtime orchestration, background agents, merges, verification execution, file edits, shell commands, tool execution, or workspace mutation. Their purpose is to keep the no-idle scheduler vocabulary strict before implementation.

Current planner schemas cover sanitized scheduler tick audits, delegated agent run status snapshots, and card/pool status summaries. They require explicit `autonomousMode`, a bounded `nextAction`, audited `idleReason` whenever `nextAction = "idle_blocked"`, explicit agent statuses such as `running`, `done`, `failed`, `stuck`, and `unknown`, and card statuses such as `done_unmerged`, `merge_pending`, `verification_pending`, `verified`, `blocked`, and `replan_required`. A card can be `verified` only when merge and verification states show `merged` and `passed`.

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

Agent progress contracts are local contract foundations for transparent planner/agent status reporting. They do not implement a production agent runner, real task-board integration, tool execution, shell execution, git operations, merges, hosted services, cloud sync, or workspace mutation. The current engine-folder placement is temporary so existing contract validation can map examples consistently.

`AgentProgressEvent` records one bounded operational event with `protocolVersion`, path-safe `eventId` and `runId`, bounded `cardId`, UTC `timestamp`, strict `phase` and `status` enums, and a short sanitized `message`. Optional fields are limited to a safe tool summary, heartbeat timestamps and attempt count, and a bounded sanitized `outputTail`.

`AgentProgressSnapshot` records the current run/card ids, start/update/completion timestamps, current phase/status/message, bounded elapsed and age metrics, optional current tool summary, optional sanitized output tail, optional `stuckReason` (`heartbeat_timeout`, `tool_output_timeout`, `explicit_failure`, or `none`), and a bounded list of recent event summaries.

These payloads are intended for user-visible progress such as queued, reading context, editing, running commands, waiting for tools, verifying, finishing, done, failed, or stuck. They may include only safe operational summaries, non-secret ids, UTC timestamps, bounded elapsed times, status enums, generic command labels, and short sanitized output tails. They must not include raw prompts, chain-of-thought, hidden reasoning, provider raw responses, API keys, OAuth tokens, authorization headers, cookies, PKCE verifiers, passwords, private local paths, credential paths, raw file contents, large logs, shell scripts, apply-patch payloads, workspace file bodies, or secret-like keys/values. Invalid fixtures cover forbidden extra fields, secret-like terms, private absolute paths, oversized output tails, raw provider responses, and file-content-like payloads.

## Versioning

Schemas use JSON Schema draft 2020-12. The initial protocol version is represented as a string in protocol payloads, for example `2026-05-15`.

Schemas are intentionally minimal and will evolve as implementation starts. Changes should be additive when practical. Breaking changes must update schema IDs or protocol version fields, refresh examples, and be coordinated across engine, GUI, and both IDE plugins.

`snapshot` SSE events reset client state and sequence tracking. Other chat events use monotonic `seq` values within a chat stream.

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
- Current bridge schemas are strict only for `gui.ready`, `host.ready`, `host.openedFromCommand`, and non-privileged `host.contextSnapshot`; privileged GUI/plugin messages including file open/reveal, workspace edits, IDE tool execution, clipboard, notifications, and host context requests remain disabled until strict schemas, policy, request correlation, and confirmation are implemented.
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
