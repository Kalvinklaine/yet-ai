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
- `POST /v1/chats/{chat_id}/commands`
- `GET /v1/chats/subscribe?chat_id=...`

Provider endpoints manage local BYOK provider configuration files under the user config directory. Provider secret material is centralized behind the engine secret store abstraction and is never owned by GUI/browser storage. Chat accepts `user_message` and a no-op-safe `abort`; `user_message` selects the first enabled `openai-compatible` provider, posts directly to `{baseUrl}/chat/completions` with `stream: true`, and normalizes provider chunks into `snapshot`, `stream_started`, `stream_delta`, `stream_finished`, or `error` SSE events. No Yet AI hosted backend, gateway, account, or cloud workspace is required.

## Provider auth roadmap

Current provider authentication is API-key/OpenAI-compatible direct access only. ChatGPT/OpenAI account login is not implemented in this baseline. The provider-auth endpoints are available as a sanitized local skeleton for `openai` and `openai-compatible`: `status` reports login unavailable plus API-key fallback, detects matching configured API-key providers with only a redacted hint, default `start` and `exchange` do not contact OpenAI and return login-unavailable responses, and `disconnect` clears only mock/future OAuth state. It does not delete current API-key provider configs. The official OpenAI API-key or project-key path remains the safe/default real-provider route.

A local mock OAuth/PKCE harness exists for tests only. `POST /v1/provider-auth/{provider}/start` with `{ "mock": true }` creates a temporary local mock session with a session id, state, simplified PKCE verifier/challenge, local mock authorization URL, and expiry. `POST /v1/provider-auth/{provider}/exchange` validates the provider, session id, state, mock code, and expiry, then stores fake token material only under local mock auth test state. `status` can report sanitized `pending` or `connected` mock OAuth state, and `disconnect` clears it. The harness never calls OpenAI, ChatGPT, or any external provider, and responses must never include fake access or refresh tokens. It is not production OpenAI login and is only a contract/security test harness.

The planned first-phase UX is: sign in first where supported; API key fallback otherwise. The engine should own any future provider-auth flow:

- start browser/device login and hold pending PKCE/session state locally;
- receive loopback callback or exchange/polling requests;
- store access tokens, refresh tokens, API keys, and revocation state in engine-owned OS keychain or protected user config storage;
- refresh or revoke/disconnect credentials without exposing raw secrets;
- return only sanitized status such as connected/configured, auth source, expiry, account label, scopes, redacted hints, and safe error text.

The user approved an experimental, high-risk T-49 Codex-like OpenAI/ChatGPT login task chain despite the lack of a public third-party OpenAI OAuth program. That approval allows a local engine-owned flow modeled after Codex-like behavior. The current experimental slice is available only for `openai`: `start` with `{ "experimentalCodexLike": true }` creates local PKCE/session state, and `exchange` validates session id, state, authorization code, and expiry before posting to the configured token endpoint. The production default token endpoint is the approved Codex-like OpenAI auth URL, while automated tests inject a local loopback mock endpoint so CI never calls OpenAI. On success, the engine stores the access token, refresh token, and auth metadata through the engine secret store under protected local config storage and returns only sanitized connected status, account label, expiry, scopes, redacted hint, and message. `disconnect` removes experimental OAuth secrets and pending state while preserving API-key provider configuration.

Future work in this approved high-risk area remains:

- refresh, revoke/disconnect against the provider, expiry handling, and migration behind the engine secret store;
- OS keychain support behind the same secret-store boundary;
- GUI-facing responses limited to sanitized status, account labels, expiry, scopes, redacted hints, and safe error text.

The approval does not allow cookie import, ChatGPT web-session scraping, browser profile import, browser cookie reuse, direct import or reading of `~/.codex/auth.json` or other tools' credential files, or any required Yet AI cloud/backend/account, managed gateway, product credit balance, or cloud workspace for core chat/provider setup. It also does not claim production readiness, official OpenAI partnership, or general public OAuth support. Private endpoint, client identity, account-header, model-access, token-refresh, revoke, and compatibility risks must remain explicit wherever this flow is implemented.

## Commands

From the repository root:

```sh
cargo check
cargo test
npm run check
npm run smoke:local
```

`npm run smoke:local` is a local-only cross-subsystem smoke test. It starts the engine on a free loopback port through Cargo, starts a mock OpenAI-compatible provider, configures a fake provider key, sends a chat command, reads the SSE stream, checks provider Authorization, exercises provider-auth default status plus the local mock OAuth start/exchange/status/disconnect flow, and asserts fake API keys, provider-auth fake tokens, PKCE verifier values, and mock exchange codes do not appear in client-visible responses or events. It requires Cargo on `PATH` and does not require real provider credentials, external network access, or hosted Yet AI services.

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

Provider configs are stored in the user config dir under `providers.d/{id}.json`. New API keys are written through the engine-owned secret store abstraction to the protected file fallback under `provider-secrets/{providerId}/{secretKind}.json`; provider config files keep only metadata and auth type. The abstraction supports API keys, OAuth access tokens, OAuth refresh tokens, and auth metadata so future login support can use one boundary. On Unix, provider config and fallback secret files are written with private `0600` permissions where feasible. Provider secrets are never written into project `.yet-ai` state and are never returned by HTTP responses; responses only expose `auth.configured` and a redacted hint such as `sk-...abcd`.

The file secret store is a development fallback and compatibility step, not the final production policy. Existing legacy provider config files that still contain `auth.apiKey` can be read as a compatibility fallback; new saves move the API key into `provider-secrets` and clear it from the provider config JSON. The planned next step is OS credential storage/keychain support behind the same trait, followed by a small migration that imports legacy file secrets into the selected secret backend and removes raw keys from provider config files.

Provider ids are path-safe stable identifiers containing only ASCII letters, digits, `-`, and `_`. `custom` and `openai-compatible` providers require an explicit `baseUrl`. `ollama` defaults to `http://127.0.0.1:11434` when `baseUrl` is omitted.

Provider `baseUrl` values must be absolute `http` or `https` URLs with a host and no `user:pass@host` userinfo. Local loopback gateways, LAN gateways, and custom HTTPS endpoints are supported; malformed URLs and non-HTTP schemes are rejected with sanitized errors.

For `openai-compatible`, `baseUrl` may point either at an API root or directly at `/chat/completions`. The runtime normalizes `http://host/v1` and `http://host/v1/` to `http://host/v1/chat/completions`, preserves explicit `http://host/v1/chat/completions`, and sends `Authorization: Bearer <apiKey>` only when API key auth is configured.

## Current limitations

- This is a development MVP, not a production-ready runtime.
- IDE launchers can start or connect to the runtime for local preview, but no signed/notarized engine bundle, marketplace packaging, or production installer is complete.
- No full agent autonomy, indexing, tool registry execution, file mutation, shell execution, integrations, LSP completion/code-lens, completions, tools, or file edits are complete.
- OpenAI-compatible streaming covers the first narrow local provider/chat path only; broader provider quirks, retries, cancellation semantics, OAuth, and keychain-backed secret storage remain follow-up work.
- The local provider file store is a documented development fallback, not the final secret storage policy.

## Safety rules

- Bind local APIs to loopback only and require a local bearer token.
- Do not expose provider secrets, environment secrets, or private integration credentials through GUI-facing endpoints.
- Do not add telemetry or cloud calls by default.
- Keep filesystem mutation, shell execution, and risky tool execution behind future explicit engine policy and confirmation checks.
- Do not hardcode product-sensitive names, paths, binary names, or IDs outside the identity contract where practical.
