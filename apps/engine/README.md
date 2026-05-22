# Yet AI Engine

## Ownership and boundary

`apps/engine` owns the local Yet AI runtime. Its current responsibilities are a loopback HTTP API skeleton, SSE chat snapshot streaming, provider/model registry stubs, storage resolution, and authentication boundaries.

The engine resolves product, binary, and storage names from `product/identity.json`. It is the local-first BYOK runtime, not a required cloud backend. Core workflows must not require a Yet AI account, managed model gateway, product credit balance, or cloud workspace.

## Current status

The Rust crate and binary are named `yet-lsp`. The runtime currently exposes:

- `GET /v1/ping`
- `GET /v1/caps`
- `GET /v1/providers`
- `GET /v1/models`
- `POST /v1/chats/{chat_id}/commands`
- `GET /v1/chats/subscribe?chat_id=...`

Provider and model endpoints return empty local summaries for now. Chat commands only accept the minimal `user_message` shape. Privileged or unimplemented commands are rejected until strict schemas and behavior exist.

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

## Safety rules

- Bind local APIs to loopback only and require a local bearer token.
- Do not expose provider secrets, environment secrets, or private integration credentials through GUI-facing endpoints.
- Do not add telemetry or cloud calls by default.
- Keep filesystem mutation, shell execution, and risky tool execution behind future explicit engine policy and confirmation checks.
- Do not hardcode product-sensitive names, paths, binary names, or IDs outside the identity contract where practical.
