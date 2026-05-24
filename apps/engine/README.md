# Yet AI Engine

## Ownership and boundary

`apps/engine` owns the local Yet AI runtime. Its current responsibilities are a loopback HTTP API skeleton, SSE chat snapshot streaming, provider/model registry stubs, storage resolution, and authentication boundaries.

The engine resolves product, binary, and storage names from `product/identity.json`. It is the local-first BYOK runtime, not a required cloud backend. Core workflows must not require a Yet AI account, managed model gateway, product credit balance, or cloud workspace.

## Current status

The Rust crate and binary are named `yet-lsp`. The runtime currently exposes:
The Rust crate and binary are named `yet-lsp`. The runtime currently exposes:

- `GET /v1/ping`
- `GET /v1/caps`
- `GET /v1/providers`
- `POST /v1/providers`
- `GET /v1/providers/{id}`
- `PATCH /v1/providers/{id}`
- `DELETE /v1/providers/{id}`
- `POST /v1/providers/{id}/test`
- `GET /v1/models`
- `POST /v1/chats/{chat_id}/commands`
- `GET /v1/chats/subscribe?chat_id=...`

Provider endpoints manage local BYOK provider configuration files under the user config directory. Chat accepts `user_message` and a no-op-safe `abort`; `user_message` selects the first enabled `openai-compatible` provider, posts directly to `{baseUrl}/chat/completions` with `stream: true`, and normalizes provider chunks into `snapshot`, `stream_started`, `stream_delta`, `stream_finished`, or `error` SSE events. No Yet AI hosted backend, gateway, account, or cloud workspace is required.

## Commands

From the repository root:

```sh
cargo check
cargo test
npm run check
```

To run the engine locally:

```sh
YET_AI_AUTH_TOKEN=local-dev-token cargo run -p yet-lsp
```

The process binds to `127.0.0.1:8001` by default. Override only the port with `YET_AI_HTTP_PORT`; the host remains loopback.

## Authentication

All endpoints require:

```text
Authorization: Bearer <token>
```

The token is read from `YET_AI_AUTH_TOKEN` or falls back to a development token for local experiments. It is not persisted and is not accepted through the query string. Browser native `EventSource` cannot send bearer headers, so GUI streaming should use fetch streaming later.

## Storage names

Storage names come from `product/identity.json`:

- project dir: `.yet-ai`
- user config dir: `yet-ai`
- user cache dir: `yet-ai`

Provider configs are stored in the user config dir under `providers.d/{id}.json`. The MVP stores API keys in these local files as an explicit development/file fallback until OS keychain support exists. On Unix, provider config files are written with private `0600` permissions where feasible. Provider secrets are never written into project `.yet-ai` state and are never returned by HTTP responses; responses only expose `auth.configured` and a redacted hint such as `sk-...abcd`.

Provider ids are path-safe stable identifiers containing only ASCII letters, digits, `-`, and `_`. `custom` and `openai-compatible` providers require an explicit `baseUrl`. `ollama` defaults to `http://127.0.0.1:11434` when `baseUrl` is omitted.

For `openai-compatible`, `baseUrl` may point either at an API root or directly at `/chat/completions`; the runtime appends `/chat/completions` when needed and sends `Authorization: Bearer <apiKey>` only when API key auth is configured.

## Safety rules

- Bind local APIs to loopback only and require a local bearer token.
- Do not expose provider secrets, environment secrets, or private integration credentials through GUI-facing endpoints.
- Do not add telemetry or cloud calls by default.
- Keep filesystem mutation, shell execution, and risky tool execution behind future explicit engine policy and confirmation checks.
- Do not hardcode product-sensitive names, paths, binary names, or IDs outside the identity contract where practical.
