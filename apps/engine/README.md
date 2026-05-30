# Yet AI Engine

## Ownership and boundary

`apps/engine` owns the local Yet AI runtime. Its current responsibilities are authenticated loopback HTTP APIs, SSE chat streaming, local provider/model registry, OpenAI-compatible direct streaming, storage resolution, and authentication boundaries.

The engine resolves product, binary, and storage names from `product/identity.json`. It is the local-first BYOK runtime, not a required cloud backend. Core workflows must not require a Yet AI account, managed model gateway, product credit balance, or cloud workspace.

## Current status

The Rust crate and binary are named `yet-lsp`. The runtime currently exposes:

- `GET /v1/ping`
- `GET /v1/caps`
- `GET /v1/providers`
- `POST /v1/providers`
- `GET /v1/providers/{id}`
- `PATCH /v1/providers/{id}`
- `DELETE /v1/providers/{id}`
- `POST /v1/providers/{id}/test`
- `POST /v1/provider-auth/{provider}/start`
- `GET /v1/provider-auth/{provider}/status`
- `POST /v1/provider-auth/{provider}/exchange`
- `POST /v1/provider-auth/{provider}/disconnect`
- `GET /v1/models`
- `GET /v1/chats`
- `POST /v1/chats`
- `GET /v1/chats/{chat_id}`
- `DELETE /v1/chats/{chat_id}`
- `POST /v1/chats/{chat_id}/commands`
- `GET /v1/chats/subscribe?chat_id=...`
- `GET /v1/agent-progress`

Provider endpoints manage local BYOK provider configuration files under the user config directory. Provider secret material is centralized behind the engine secret store abstraction and is never owned by GUI/browser storage. `/v1/models`, `/v1/caps`, and provider summaries expose aligned sanitized model metadata: `capabilities.chat`, `capabilities.streaming`, `capabilities.tools`, `capabilities.reasoning`, and `readiness.status` values `ready`, `disabled`, `missing_credentials`, `missing_model`, or `unsupported`, with only short sanitized reasons when present. Chat accepts only strict current `user_message` and no-op-safe `abort` commands: `requestId` must be non-empty and bounded, `user_message.payload` may contain only non-empty bounded `content`, and `abort.payload` must be omitted or an empty object. Unsupported privileged command types remain disabled. `user_message` selects the first enabled `openai-compatible` API-key provider with a model whose readiness is `ready` and whose capabilities include both chat and streaming, posts directly to `{baseUrl}/chat/completions` with `stream: true`, and normalizes provider chunks into `snapshot`, `stream_started`, `stream_delta`, `stream_finished`, or `error` SSE events. Disabled providers, missing credentials, missing model metadata, unsupported models, and non-chat or non-streaming models are skipped. `abort` cancels the active provider streaming task for that chat id when one exists and emits a safe `stream_finished` event with `finishReason: "abort"`; abort without an active stream is accepted without emitting deltas or errors. If no enabled OpenAI-compatible API-key provider/model is usable, chat may use a locally stored, unexpired experimental OpenAI OAuth access token from the approved Codex-like path. No Yet AI hosted backend, gateway, account, or cloud workspace is required.

The `/v1` HTTP boundary has an explicit request body limit suitable for current provider configuration, provider-auth, and chat command payloads. Routes that accept JSON return sanitized request-body failures for malformed, type-invalid, or oversized bodies instead of parser details, raw bodies, secrets, private paths, or submitted tokens. Chat ids are path-safe bounded identifiers validated before local chat history access, command handling, and SSE subscribe work. Invalid chat ids and missing or invalid `chat_id` subscribe queries return safe errors without opening an SSE stream and without echoing the raw submitted id. This is request-boundary hardening only; it does not add tools, tasks, knowledge, shell execution, workspace mutation, provider discovery, or production agent functionality.

`GET /v1/agent-progress` is a read-only local observability endpoint for the current agent progress MVP. It returns the strict list-response shape with `cloudRequired: false`, `providerAccess: "direct"`, and currently an empty `snapshots` array until a future runner is wired. It must not start, stop, merge, apply, execute tools, run shell commands, call providers, read task-board state, mutate workspaces, or require hosted services or cloud sync. Future non-empty snapshots may include only safe operational fields such as ids, phase/status, tool label/kind, elapsed and heartbeat ages, stuck reason, recent summaries, and bounded sanitized output tails. They must not include prompts, chain-of-thought, raw file contents, raw provider responses, tokens, cookies, provider credentials, runtime session tokens, credential paths, private absolute paths, shell scripts, or patch payloads.

## Local chat history

The engine owns local chat history for the dev-preview conversations MVP. Chat threads and messages are stored under Yet AI local storage resolved from `product/identity.json`; GUI and IDE hosts access them only through authenticated loopback endpoints. The store persists bounded user and assistant message content, local thread metadata, timestamps, and status fields needed to restore snapshots and conversation lists.

Chat history must not contain provider routing secrets or auth/session metadata. Provider API keys, OAuth access tokens, OAuth refresh tokens, authorization codes, PKCE verifiers, cookies, local runtime bearer tokens, raw provider responses, provider credential paths, and private filesystem paths are never chat metadata or history response fields. User-provided prompt content can be stored locally, so users should avoid pasting secrets, credentials, private keys, or sensitive private data into chat prompts.

`DELETE /v1/chats/{chat_id}` deletes local Yet AI history for that conversation only. It does not delete data from upstream providers, provider accounts, logs outside Yet AI local storage, cloud services, or backups. This is a local dev-preview persistence feature, not production encrypted sync, enterprise retention management, legal hold, or provider-side data deletion.

## Provider auth roadmap

The safe/default real-provider route is API-key/OpenAI-compatible direct access. Users can configure an OpenAI API key or project key through the local runtime, and this route remains preferred whenever an enabled OpenAI-compatible provider exists. The provider-auth endpoints are available as sanitized local endpoints for `openai` and `openai-compatible`: default `status` reports API-key fallback or an API-key-configured state with only a redacted hint, default non-experimental `start` and `exchange` do not contact OpenAI, and `disconnect` does not delete current API-key provider configs.

An explicit-risk experimental Codex-like OpenAI account path now exists for `openai` only. It is not the safe/default route, not official public OpenAI OAuth support, and not production-ready. Automated coverage is limited to loopback/mock token and chat endpoints; any real account testing is manual, high-risk, account-specific, and outside CI.

A local mock OAuth/PKCE harness exists for tests only. `POST /v1/provider-auth/{provider}/start` with `{ "mock": true }` creates a temporary local mock session with a session id, state, simplified PKCE verifier/challenge, local mock authorization URL, and expiry. `POST /v1/provider-auth/{provider}/exchange` validates the provider, session id, state, mock code, and expiry, then stores fake token material only under local mock auth test state. `status` can report sanitized `pending` or `connected` mock OAuth state, and `disconnect` clears it. The harness never calls OpenAI, ChatGPT, or any external provider, and responses must never include fake access or refresh tokens. It is not production OpenAI login and is only a contract/security test harness.

Provider-auth flows remain engine-owned. For safe/default provider use, configure an API key or project key through the local runtime. For any supported account-style flow, including the explicit-risk experimental Codex-like path, the engine owns the sensitive state:

- start browser/device login and hold pending PKCE/session state locally;
- store pending provider-auth state in hardened local engine storage with provider id validation, path confinement, private permissions where supported, symlink rejection, atomic replacement, and sanitized corrupt-state handling;
- receive loopback callback or exchange/polling requests;
- store access tokens, refresh tokens, API keys, and revocation state through the engine-owned composite secret store, using OS credential storage where available and protected-file fallback only under the safe disabled/unavailable policy;
- refresh, revoke, or disconnect credentials where implemented without exposing raw secrets;
- return only sanitized status such as connected/configured, auth source, expiry, account label, scopes, redacted hints, and safe error text.

Production builds use the composite secret-store policy: OS credential storage is the preferred primary backend where the configured platform keychain service is available, and the protected-file backend under user config is used when the primary backend is disabled by build/policy or for safe reads when the primary is explicitly unavailable. Debug/test builds deliberately use a disabled primary plus the protected-file fallback so automated tests do not prompt or depend on a real keychain. Transient primary write/delete failures, locked-keychain timeouts, and verification mismatches are not treated as successful fallback writes or deletes; they return sanitized storage errors so stale primary/keychain values cannot later shadow newer fallback state. Existing fallback records can migrate to keychain only after a verified write/read-back. If fallback cleanup fails after migration, later healthy primary reads retry cleanup. Keychain/primary values win only when the primary read is healthy and the strict migration/delete policy has not rejected the operation; fallback records never overwrite newer keychain secrets. Delete/disconnect paths attempt to delete both keychain and fallback records where applicable and surface sanitized errors on real cleanup failures. This is local custody for BYOK credentials, not hosted custody, cloud sync, enterprise secret management, production compliance certification, official production OAuth support, or a guarantee that every platform has an unlocked credential service. Raw provider secrets, access or refresh tokens, authorization codes, PKCE verifiers, cookies, browser profiles, credential file paths, and other provider secret material must never be GUI-owned, stored by GUI/browser code, returned through GUI-facing responses, or used in fixtures.

The user approved an experimental, high-risk T-49 Codex-like OpenAI/ChatGPT login task chain despite the lack of a public third-party OpenAI OAuth program. That approval allows a local engine-owned flow modeled after Codex-like behavior. The current experimental slice is available only for `openai`: `start` with `{ "experimentalCodexLike": true }` creates local PKCE/session state, and `exchange` validates session id, state, authorization code, and expiry before posting to the configured token endpoint. The production default token endpoint remains the approved Codex-like OpenAI auth URL when no override is supplied, while automated tests may inject only local loopback mock `tokenEndpointUrl` / `chatEndpointUrl` overrides so CI never calls OpenAI. Request-provided experimental endpoint overrides must be absolute `http` or `https` URLs with a host, no userinfo, and loopback-only hosts (`127.0.0.1`, `localhost`, or `[::1]`); non-loopback, malformed, credential-bearing, or non-HTTP(S) override URLs are rejected with sanitized errors. On success, the engine stores the access token, refresh token, and auth metadata through the engine composite secret store and returns only sanitized connected status, account label, expiry, scopes, redacted hint, and message. If the token endpoint fails before successful token storage, the pending session remains available so the same session, state, and authorization code can be retried; mismatch and expiry failures remain terminal. When no enabled OpenAI-compatible API-key provider is configured, chat can use the unexpired stored OAuth access token with the explicit experimental chat defaults `baseUrl: https://chatgpt.com/backend-api/codex` and `model: gpt-5-codex`; tests override the chat endpoint to a local loopback mock. This private-backend-style route is experimental/high-risk, not official public third-party OpenAI OAuth support, and raw access tokens, refresh tokens, and Authorization headers must never be returned or logged. `disconnect` removes experimental OAuth secrets and pending state while preserving API-key provider configuration. Provider deletion uses the same sanitized secret boundary for API-key material: it validates the provider id, attempts secret cleanup before config deletion, and treats a missing config file as success after cleanup so a retry can remove orphaned credentials left by an earlier partial failure. Provider updates commit API-key secret changes before writing the scrubbed provider config and attempt to restore the previous secret state if the secret commit or config write fails; if rollback itself fails, the operation returns a sanitized storage error rather than claiming consistency.

Future work in this approved high-risk area remains:

- provider-side refresh/revoke behavior and broader expiry handling behind the engine secret store;
- broader production packaging and platform verification for the keychain/fallback policy;
- GUI-facing responses limited to sanitized status, account labels, expiry, scopes, redacted hints, and safe error text.

The approval does not allow cookie import, ChatGPT web-session scraping, browser profile import, browser cookie reuse, direct import or reading of `~/.codex/auth.json` or other tools' credential files, or any required Yet AI cloud/backend/account, managed gateway, product credit balance, or cloud workspace for core chat/provider setup. It also does not claim production readiness, official OpenAI partnership, or general public OAuth support. Private endpoint, client identity, account-header, model-access, token-refresh, revoke, and compatibility risks must remain explicit wherever this flow is implemented.

## Commands

From the repository root:

```sh
cargo check
cargo test
export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp http_boundary
npm run check
npm run smoke:local
npm run smoke:provider-secret-migration
npm run check:agent-progress
npm run smoke:agent-progress
npm run smoke:gui-agent-progress
```

`npm run smoke:local` is a local-only cross-subsystem smoke test. It starts the engine on a free loopback port through Cargo, starts mock OpenAI-compatible, experimental token, and experimental chat endpoints, configures a fake provider key, sends chat commands, reads SSE streams, checks provider Authorization internally, verifies local chat history persistence/snapshot hydration/delete behavior, exercises provider-auth default status plus the local mock OAuth start/exchange/status/disconnect flow, and covers the approved experimental Codex-like start/exchange/chat fallback through loopback mocks only. It asserts fake API keys, OAuth access tokens, refresh tokens, Authorization headers, cookies, PKCE verifier values, mock auth codes, Codex credential-file paths, and local history responses/events do not expose client-visible secrets. It requires Cargo on `PATH` and does not require real provider credentials, external network access, or hosted Yet AI services. Real experimental OpenAI/ChatGPT account testing remains manual, high-risk, and outside CI; the API-key fallback remains the safe/default real-provider path.

`npm run smoke:provider-secret-migration` is the focused loopback smoke for legacy inline `auth.apiKey` migration. It verifies config scrubbing, fallback secret-store record creation in isolated dev/test storage, provider-test Authorization by digest/length only, stored-secret-wins behavior, and no raw fake secret leakage. For keychain/fallback policy or provider lifecycle changes, also run `cargo test -p yet-lsp secret_store` and `cargo test -p yet-lsp provider_secret`; those focused tests cover strict primary-unavailable write/delete behavior, disabled-primary fallback behavior, safe migration and cleanup retry, retryable provider delete cleanup, missing-config orphan cleanup, update rollback, and sanitized failure bodies without requiring a real OS keychain. The post-review focused gate is `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp secret_store && cargo test -p yet-lsp provider_secret && cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat && git status --short`.

To run the engine locally:

```sh
YET_AI_AUTH_TOKEN=local-dev-token cargo run -p yet-lsp
```

The process binds to `127.0.0.1:8001` by default. Override only the port with `YET_AI_HTTP_PORT`; the host remains loopback.

VS Code and JetBrains dev-preview launchers can also start `yet-lsp` in `launch` or `auto` mode. They pass a generated per-session token through `YET_AI_AUTH_TOKEN`, pass the configured HTTP port through `YET_AI_HTTP_PORT`, and verify readiness with `GET /v1/ping`. `connect` mode is for an already running loopback engine.

## IDE dev preview binary helper

Build and prepare the local engine binary for IDE plugin dev previews from the repository root:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:ide-engine
```

The helper reads the crate and binary names from `product/identity.json`, runs `cargo build -p yet-lsp`, copies `target/debug/yet-lsp` to `apps/plugins/vscode/bin/yet-lsp`, and prints exact VS Code and JetBrains settings values. Use `npm run prepare:ide-engine -- --release` to build and prepare `target/release/yet-lsp`; use `-- --no-build` after an existing Cargo build.

Generated binaries under `target/` and `apps/plugins/vscode/bin/` are ignored and must not be committed. The helper is intended for macOS/Linux dev previews. Windows is not verified yet; the script prints absolute settings values and uses `.exe` when run on Windows.

## Authentication

All endpoints require:

```text
Authorization: Bearer <token>
```

The token is read from `YET_AI_AUTH_TOKEN` or falls back to a development token for local experiments. It is not persisted and is not accepted through the query string. Browser native `EventSource` cannot send bearer headers, so GUI streaming uses fetch streaming.

## Storage names

Storage names come from `product/identity.json`:

- project dir: `.yet-ai`
- user config dir: `yet-ai`
- user cache dir: `yet-ai`

Provider configs are stored in the user config dir under `providers.d/{id}.json`. Local chat history is stored by the engine under the same Yet AI local storage boundary, separate from browser storage and provider secret files. New API keys are written through the engine-owned composite secret store; provider config files keep only metadata and auth type. The abstraction supports API keys, OAuth access tokens, OAuth refresh tokens, and auth metadata so provider and provider-auth paths use one boundary. Production builds prefer OS credential storage under a stable product-scoped keychain service/account naming scheme. The protected-file fallback under `provider-secrets/{providerId}/{secretKind}.json` is used when the primary is disabled by build/policy or for safe reads when the primary is unavailable; transient primary write/delete failures, timeouts, and read-back mismatches return sanitized storage errors instead of being treated as fallback success. Debug/test builds use the fallback path intentionally to keep local automation deterministic. On Unix, provider config and fallback secret files are written with private `0600` permissions where feasible. Provider secrets are never written into project `.yet-ai` state or chat metadata and are never returned by HTTP responses; responses only expose `auth.configured` and a redacted hint.

Legacy provider config files that still contain `auth.apiKey` are migrated during normal provider/model/test/chat access. Migration first writes the inline value to the secret store with atomic create-if-absent semantics, then rewrites the provider config without `auth.apiKey`. If a secret already exists, that stored value wins and the stale inline value is scrubbed without overwriting it. If the engine cannot safely write or read the secret store, access fails with sanitized errors and does not fall back to using or exposing the inline key. If config scrubbing fails after a successful secret write, the stored secret remains usable and a later access can retry the scrub.

Fallback-to-keychain migration is also conservative. When a production keychain lookup is empty and a fallback record exists, the composite store writes the fallback value to keychain and deletes the fallback record only after reading back the same value. If the write, read-back, or cleanup fails or differs, the fallback record is preserved where possible and a sanitized storage error is returned. A later healthy primary read retries fallback cleanup. When keychain already has a value, that value wins over fallback and the fallback never overwrites it. Delete, provider delete, and provider-auth disconnect paths call the same secret-store delete operation for API-key and OAuth secret kinds, so they attempt to remove both keychain and fallback records where applicable; transient primary delete failures are not hidden by fallback cleanup because that could allow stale primary values to reappear. Provider config updates commit secret changes first and roll back to the previous API-key state if the config write fails. These behaviors are local credential custody only, not cloud sync, not hosted custody, not enterprise secret management, not official production OpenAI/ChatGPT OAuth support, and not a guarantee that every platform has an unlocked credential service.

Provider ids are path-safe stable identifiers containing only ASCII letters, digits, `-`, and `_`. `custom` and `openai-compatible` providers require an explicit `baseUrl`. `ollama` defaults to `http://127.0.0.1:11434` when `baseUrl` is omitted.

Provider `baseUrl` values must be absolute `http` or `https` URLs with a host and no `user:pass@host` userinfo, query parameters, or fragments. Local loopback gateways, LAN gateways, and custom HTTPS endpoints are supported; malformed URLs and non-HTTP schemes are rejected with sanitized errors.

For `openai-compatible`, `baseUrl` may point either at an API root or directly at `/chat/completions`. The runtime normalizes `http://host/v1` and `http://host/v1/` to `http://host/v1/chat/completions`, preserves explicit `http://host/v1/chat/completions`, and sends `Authorization: Bearer <apiKey>` only when API key auth is configured. Provider testing derives `/models` from the API root, including when the configured base URL already ends in `/chat/completions`, so the reachability probe does not append `/models` under the chat-completions path. This API-key path remains preferred over experimental OAuth whenever an enabled OpenAI-compatible provider exists.

## Current limitations

- This is a development MVP, not a production-ready runtime.
- IDE launchers can start or connect to the runtime for local preview, but no signed/notarized engine bundle, marketplace packaging, or production installer is complete.
- No full agent autonomy, indexing, tool registry execution, file mutation, shell execution, integrations, LSP completion/code-lens, completions, tools, tasks, knowledge, or file edits are complete.
- OpenAI-compatible streaming covers the first narrow local provider/chat path only; readiness metadata does not perform dynamic provider discovery, enable tool execution, or implement production model catalog synchronization. Broader provider quirks, retries, cancellation semantics, and production OAuth remain follow-up work.
- OS credential storage is preferred only where the platform service is available and usable. The protected-file backend remains the documented fallback for disabled-primary policy and safe unavailable-primary reads, while transient primary write/delete failures and timeouts return sanitized errors instead of silently succeeding through fallback. This is not cloud sync, hosted custody, enterprise secret management, or a production compliance guarantee.

## Safety rules

- Bind local APIs to loopback only and require a local bearer token.
- Do not expose provider secrets, environment secrets, or private integration credentials through GUI-facing endpoints.
- Do not add telemetry or cloud calls by default.
- Keep filesystem mutation, shell execution, and risky tool execution behind future explicit engine policy and confirmation checks.
- Do not hardcode product-sensitive names, paths, binary names, or IDs outside the identity contract where practical.
