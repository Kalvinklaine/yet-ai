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
- `schemas/engine/sse-event.schema.json` for chat SSE event payloads.
- `schemas/engine/provider-*.schema.json` for local provider summaries, writes, model lists, and sanitized provider test responses.
- `schemas/engine/provider-auth-*-response.schema.json` for future sanitized provider login start, status, exchange, and disconnect responses.
- `schemas/bridge/host-message.schema.json` for IDE host to GUI messages.
- `schemas/bridge/gui-message.schema.json` for GUI to IDE host messages.

The current strict runtime contract is intentionally narrow. Chat command validation covers only `user_message` with a bounded non-empty `requestId` and a strict `payload.content`, plus `abort` with no payload or an empty payload object. `POST /v1/chats/{chat_id}/commands` does not carry provider/model selection, API keys, auth tokens, request parameters, or hidden readiness overrides. Bridge validation covers only exact-version `gui.ready`, `host.ready`, and `host.openedFromCommand` shapes. Privileged bridge, tool, and file-edit flows remain disabled until schemas, policy, request correlation, and user confirmation exist.

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

First-message readiness uses provider endpoints, not chat command smuggling. `/v1/models`, `GET /v1/providers`, `GET /v1/providers/{id}`, provider-auth status, and provider-test responses are sanitized readiness signals for GUI and IDE clients. The engine remains the authority for selecting an enabled configured provider/model from local state when a first chat message is sent. A `user_message` command contains only user-visible content and must not include `providerId`, `modelId`, `apiKey`, auth tokens, endpoint overrides, or generation params. API-key/OpenAI-compatible provider readiness remains the safe/default real-provider path and takes precedence over the experimental Codex-like OAuth fallback. Experimental OAuth readiness remains explicit-risk and mock/loopback automation only unless a specific manual task explicitly accepts real-account testing.

Future provider-auth schemas cover sanitized responses for `POST /v1/provider-auth/{provider}/start`, `GET /v1/provider-auth/{provider}/status?session_id=...`, `POST /v1/provider-auth/{provider}/exchange`, and `POST /v1/provider-auth/{provider}/disconnect`. These contracts expose only non-secret login progress and configured-state fields such as `status`, `authSource`, `sessionId`, URLs, account labels, scopes, expiry, redacted hints, and messages. OpenAI/ChatGPT account login contracts are for an approved experimental, high-risk Codex-like path, not a claim of production readiness, official OpenAI partnership, or general public OAuth support. The official OpenAI API-key or project-key fallback remains the safe/default real-provider path.

Provider-auth lifecycle fixtures should cover product UX states across pending login start, connected status/exchange, expired login, revoked disconnect success, login unavailable, API-key configured fallback, and sanitized failure responses when an endpoint can return an error-like status. Positive fixtures must stay free of raw credential material. Invalid provider-auth fixtures should cover rejected raw token-like or unknown fields, invalid provider IDs, non-HTTPS authorization URLs where the schema owns URL shape, invalid `status`/`authSource` combinations where practical, and `cloudRequired` values other than `false`.

Provider response examples must not include API keys, OAuth refresh tokens, environment secrets, or private local paths. GUI clients may submit secrets for save/test actions but must not persist them after the request. In provider response `auth` objects, `redacted` is required only when `type = "api_key"` and `configured = true`; it is omitted for unconfigured API-key auth and non-secret auth types. Provider-auth responses must not include raw access tokens, refresh tokens, API keys, cookies, authorization codes, browser profile paths, browser cookie reuse data, `~/.codex/auth.json` content, other tools' credential file paths, or any imported provider credential file material.

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
- Current bridge schemas are strict only for `gui.ready`, `host.ready`, and `host.openedFromCommand`; privileged GUI/plugin messages remain disabled until strict schemas, policy, request correlation, and confirmation are implemented.
- Current chat command schemas are strict only for non-privileged `user_message` and `abort`; tool decisions, IDE tool results, parameter changes, message mutation, and regeneration remain disabled until schema, policy, and confirmation are implemented.
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
