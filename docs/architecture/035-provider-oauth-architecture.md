# 035 Reference-informed Provider OAuth Architecture ADR

Status: approved architecture direction for future migration work; implementation remains gated by the sequencing below.

This ADR defines the target Yet AI provider OAuth framework before further code migration. It uses the inspected reference implementation behavior as architectural signal only. No source, assets, public copy, provider identifiers beyond required protocol facts, or storage paths are copied into Yet AI.

Implementation status: the current engine has crossed from ADR-only design into a framework-oriented implementation for the existing provider-auth routes. `provider_auth/mod.rs` remains the compatibility façade for `/v1/provider-auth/...`, request validation, legacy mock-test harness compatibility, hardened local state helpers, and Codex-like token/storage primitives. `provider_auth/adapters/mod.rs` owns the adapter SPI, dispatch selector, sanitized status projection, and the current `openai` Codex-like adapter. `provider_auth/session_registry.rs` and `provider_auth/session_store.rs` own the persisted pending-session registry used by loopback callback state checks and test-only device-flow proof coverage.

Task traceability: LT-1 / G1 requested a reference-shaped provider OAuth ADR; this public tracked document intentionally describes that requirement as a reference-informed Yet AI architecture to satisfy publication hygiene while still comparing against the inspected source patterns.

## Context

Yet AI currently has a conservative provider-auth surface for API-key fallback, mock OAuth, and an experimental Codex-like OpenAI path. The production/default OpenAI account-login path remains blocked by `007-provider-auth-feasibility.md`: no official provider-supported local-app OpenAI account-login flow has been approved for Yet AI.

The target framework must still support providers that do have compliant local OAuth or device-flow contracts. It must also preserve the local-first BYOK contract: core chat and provider setup must not require a hosted Yet AI backend, Yet AI account, managed gateway, product credit balance, or cloud workspace.

## Reference implementation patterns inspected

The following reference files were inspected for patterns, not copied:

- `openai_codex_oauth.rs` — PKCE browser flow, fixed loopback callback preference on port 1455, in-memory pending session registry, form-urlencoded token exchange, account metadata derived from token claims, bounded callback HTML responses, and refresh-token custody in provider-owned token state.
- `github_copilot_oauth.rs` — device authorization flow, pending device-session registry, polling outcomes for pending, slow-down, expired, denied, and success, plus host/API-base validation before credentials are accepted.
- `claude_code_oauth.rs` — PKCE browser flow on a bound callback listener, pending session pruning, state and provider-instance validation, manual `code#state` fallback parsing, JSON token exchange for that provider, and refresh responses that may omit a new refresh token.
- `oauth_refresh.rs` — permanent refresh failure detection and invalid refresh-token memoization so a known-bad refresh token is not retried indefinitely.
- `mcp_oauth.rs` — HTTP route split for start, exchange, callback, status, and logout; callback HTML escaping; token save/clear helpers; and integration reload after successful token persistence.

## Decision

Yet AI will define a provider-auth framework with engine-owned OAuth adapters, a shared state machine, a session registry, local persistence, and a compatibility layer for the existing `/v1/provider-auth/...` API. The GUI and IDE plugins may render status, open approved URLs, and submit user-entered codes, but raw provider secrets stay under engine custody.

The target framework supports three auth modes:

1. Browser PKCE callback: engine creates verifier, challenge, state, redirect URI, and pending session; browser or IDE opens the authorization URL; engine callback performs exchange before reporting success.
2. Device flow: engine starts device authorization, returns verification URI, optional complete URI, user code, expiry, and polling interval; GUI polls status or explicit poll endpoint through sanitized responses.
3. Manual fallback: GUI accepts a pasted authorization code, full callback URL, or provider-approved code/state bundle only when an adapter declares the accepted format; engine validates state/session before exchange.

## State machine

Every provider adapter projects to one sanitized framework state:

| State | Meaning | User-facing boundary |
| --- | --- | --- |
| `Unavailable` | Provider has no approved login mode in this build or policy context. | Show API-key or local-runtime fallback guidance. |
| `LoginAvailable` | Login can start but no session or credential is active. | Show allowed auth modes and risk/policy copy. |
| `Pending` | A browser PKCE or device-flow session exists and has not expired. | Show next action, expiry, safe retry, and polling interval when relevant. |
| `Connected` | Engine has stored usable credentials and sanitized account metadata. | Show account label, expiry, scopes, and auth source only. |
| `Expired` | Stored credentials or pending session expired and refresh did not recover them. | Offer reconnect, disconnect, or API-key fallback. |
| `Revoked` | User disconnected or provider denied/revoked credentials. | Confirm local removal and preserve unrelated API-key configuration. |
| `ProviderError` | Provider returned a non-secret recoverable or terminal OAuth error. | Show sanitized category and retry/reconnect guidance. |
| `ExchangeFailed` | Code/token exchange failed or returned invalid token shape. | Preserve retryable pending session only when safe; never expose code/token/provider body. |
| `StorageError` | Engine could not persist, read, lock, migrate, or delete auth state safely. | Fail closed; do not mark connected. |

Adapters may keep internal sub-states, but GUI-facing status must use this vocabulary or an explicitly versioned extension.

## Provider adapter SPI

Each provider auth adapter should implement an engine-owned SPI with these responsibilities:

- declare provider id, display-safe label, supported auth modes, scopes, callback requirements, policy gates, and fallback guidance;
- start login by producing a pending session plus sanitized `authorizationUrl`, `verificationUrl`, `userCode`, `expiresAt`, and `pollIntervalSeconds` fields as applicable;
- validate provider-specific host, redirect, scope, token endpoint, and enterprise/base URL inputs before secrets can be transmitted;
- exchange authorization code, callback query, device token, or manual fallback input into engine-owned credential material;
- refresh credentials when supported, including permanent failure classification and refresh-token reuse/invalid-token handling;
- disconnect by deleting only that provider's OAuth credential bundle while preserving unrelated API-key provider configuration;
- sanitize status metadata so raw access tokens, refresh tokens, auth codes, PKCE verifiers, cookies, account ids, token claims, authorization headers, provider error bodies, and private paths are not returned to GUI or IDE surfaces.

This mirrors the inspected reference separation between provider-specific OAuth modules and higher-level HTTP routes, while making Yet AI's state projection, storage, and policy gates explicit.

## Session registry and persistence model

The engine owns two distinct data classes:

- Pending sessions: short-lived records with session id, state, verifier reference, auth mode, provider id, redirect URI, requested scopes, expiry, token endpoint metadata, callback ownership metadata, and optional device-flow polling metadata.
- Credential bundles: durable engine-secret-store records for access token, refresh token when available, expiry, scope list, provider metadata, sanitized account label, and adapter-specific non-secret routing metadata.

Pending sessions may be in-memory with durable rehydration only for flows that need restart/reload recovery. If persisted, pending files must use private permissions, symlink-safe access, bounded JSON shapes, and expiry cleanup. Credential bundles must be written transactionally: if metadata persistence fails after token storage, the adapter must roll back the partial bundle. Disconnect must attempt all relevant deletes and report `StorageError` if cleanup cannot be trusted.

The registry is keyed by opaque session id and state. State lookup must be direct and unambiguous so stale or corrupt sessions cannot hijack a callback. Pending sessions are single-use: a successful exchange removes the session; terminal mismatch/expired/not-found failures clear mappings; retryable provider failures may preserve the session until expiry.

## Callback server ownership

The engine owns callback listeners. GUI and IDE plugins must not bind provider callback ports or store PKCE verifiers.

Target callback rules:

- Browser PKCE adapters declare a redirect URI strategy: fixed loopback port, dynamic loopback port, or existing engine HTTP route.
- The engine starts or verifies callback ownership before returning an authorization URL.
- Callback handling validates method, path, state, code/error shape, and session mapping before exchange.
- Success HTML is returned only after token exchange and storage complete; callback receipt alone is not success.
- Callback HTML is minimal, escaped, CSP-protected, and secret-free.
- Occupied-port, bind failure, stale mapping, duplicate callback, provider-denied, token-exchange failure, and storage failure all map to sanitized framework states.

This adopts the strongest reference pattern from the inspected OpenAI and MCP flows: the local runtime completes exchange/storage before user-visible success, with bounded callback responses.

## `/v1/provider-auth/...` compatibility strategy

Existing Yet AI routes stay stable during migration:

- `GET /v1/provider-auth/:provider/status`
- `POST /v1/provider-auth/:provider/start`
- `POST /v1/provider-auth/:provider/exchange`
- `POST /v1/provider-auth/:provider/disconnect`

The compatibility layer maps the new state machine to the existing response envelope where possible:

- `Unavailable` maps to current `login_unavailable` with `supportsApiKey: true` when API-key fallback is valid.
- `LoginAvailable` maps to a new or versioned login-available status without implying default production login.
- `Pending`, `Connected`, `Expired`, and `Revoked` retain their current meanings.
- `ProviderError`, `ExchangeFailed`, and `StorageError` map to sanitized HTTP errors and status responses without raw provider payloads.

Additive fields may be introduced only after contract/schema updates and GUI handling exist. Existing mock and API-key fallback behavior must remain available until replacement tests cover the same local-first paths.

## Migration sequencing

1. Document this ADR and keep production OpenAI account login policy-gated.
2. Add contracts/fixtures for the state machine and adapter capabilities without changing runtime behavior.
3. Extract provider-auth state projection behind an internal adapter trait while preserving existing HTTP responses.
4. Move current mock and experimental Codex-like logic behind adapters with no user-visible behavior drift.
5. Add device-flow adapter support using local/mock fixtures first.
6. Add callback-server ownership hardening and callback route tests around exchange-before-success semantics.
7. Add GUI state rendering for all framework states and recovery copy.
8. Run mock-only smokes for start/status/exchange/disconnect, refresh/expiry/revocation, callback failure, and no-secret responses.
9. Only after an official provider-supported flow is approved, enable any production/default account-login adapter through a separate policy decision.

## Current implementation and runbook

Current production-facing provider-auth behavior is intentionally narrower than the target framework:

- Supported provider ids are `openai` and `openai-compatible`. The production/default login path still reports API-key fallback or unavailable status unless the request explicitly opts into test/mock or experimental modes.
- The `openai` experimental Codex-like path is routed through the adapter dispatch path. It supports browser PKCE/manual-code exchange, loopback callback completion, sanitized status, disconnect cleanup, chat-auth snapshots, and refresh of stored unexpired credentials.
- The `openai-compatible` device-flow adapter remains test-only proof coverage. It validates the SPI and shared registry shape without making `openai-compatible` a production OAuth provider.
- Mock OAuth remains a local test harness for compatibility and smoke coverage. It is not a production adapter and cannot coexist with active Codex-like OpenAI pending/secrets state.
- Adapter internal terminal states `ProviderError`, `ExchangeFailed`, and `StorageError` project to the existing public `error` status until a versioned GUI contract extends the wire vocabulary.

Debug callback/login failures in this order:

1. Confirm the safe/default API-key fallback first: `GET /v1/provider-auth/openai/status` should report `api_key_configured` when an API-key provider exists, or `login_unavailable` when no explicit experimental login is active.
2. For experimental Codex-like login, `POST /v1/provider-auth/openai/start` must include `{ "experimentalCodexLike": true }`; otherwise the engine must not start a real provider login.
3. Check whether the loopback listener can bind `127.0.0.1:1455`. A bind failure maps to sanitized callback-unavailable behavior; do not move callback ownership into GUI or IDE code.
4. Inspect only sanitized state: pending sessions live under the engine provider-auth session registry and Codex-like pending state. Do not paste raw authorization URLs, codes, tokens, callback query strings, or private paths into reports.
5. If callback receipt succeeds but status stays pending, separate token-exchange failure from storage failure. Retryable exchange failure may preserve the pending session until expiry; session mismatch, expiry, callback error, and successful exchange remove the mapping.
6. If chat fallback fails after connected status, check refresh behavior and model discovery using loopback mocks first. Refresh-token reuse can clear OAuth secrets; API-key provider configuration must remain untouched.
7. Use `disconnect` to clear OAuth pending state and OAuth secret bundles. It must preserve unrelated API-key provider configs and report sanitized storage errors if cleanup cannot be trusted.

Final cutover verification for provider-auth changes is:

```sh
cargo test -p yet-lsp provider_auth
cargo test -p yet-lsp --test runtime
npm run smoke:local
npm run check
cd apps/gui && npm test && npm run typecheck
```

Use `cargo check -p yet-lsp` before the Rust test commands when doing code changes, because it catches type drift quickly. Use `git diff --check` before handoff for whitespace hygiene.

## Rollback plan

Each migration step must be revertible:

- keep existing `/v1/provider-auth/...` response compatibility until the new contract is fully verified;
- keep API-key fallback and Demo Mode independent of OAuth adapters;
- feature-gate new adapters and callback ownership changes by provider and mode;
- preserve old secret bundles until migration has a verified read/write/delete path, then migrate with backup-safe metadata and rollback documentation;
- on adapter failure, return `Unavailable`, `ProviderError`, `ExchangeFailed`, or `StorageError` without deleting unrelated API-key configuration;
- allow disconnect to clear migrated OAuth bundles even if login is later disabled.

## Local-first, BYOK, and secret-custody boundaries

The engine is the only subsystem allowed to hold raw provider OAuth secrets, API keys, PKCE verifiers, auth codes during exchange, refresh tokens, access tokens, cookies if a future approved provider ever requires them, or provider account identifiers that could act as credential material.

The GUI may hold only transient form input long enough to submit it to the engine and must clear raw fields after submit. GUI-facing responses must be sanitized. IDE plugins may open approved browser URLs and pass explicit user input to the engine, but must not persist provider secrets or duplicate provider adapters.

No core provider-auth flow may require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, or real-provider CI credentials.

## Production/default OpenAI policy gate

Production/default OpenAI account login remains unavailable and policy-gated. The current Codex-like path is experimental, private-endpoint-style, non-default, manual/dev-preview, and mock-only in automation. It is not official public OpenAI OAuth support, not partnership evidence, not marketplace readiness, and not production readiness.

Default production OpenAI account login may be enabled only after a separate ADR or policy decision confirms all of the following:

- an official provider-supported local-app flow exists for Yet AI;
- terms, privacy, security, and publication risks are approved;
- provider identifiers, redirect URIs, scopes, and user-facing copy are approved;
- engine-owned storage and refresh semantics are implemented and tested;
- GUI and IDE surfaces show safe fallback and recovery copy;
- automation remains mock-only unless provider terms explicitly permit non-secret test credentials;
- API-key/project-key fallback remains available and visibly safe/default where appropriate.

## Consequences

This ADR lets future cards migrate provider auth incrementally without turning experimental login into a product claim. It also gives tests and GUI copy a stable vocabulary for pending, connected, expired, revoked, exchange-failed, provider-error, and storage-error states.

The tradeoff is additional framework code before new real-provider login value appears. That is intentional: small gates now prevent a sleepy little token dragon from nesting in GUI storage later.

## Verification

For this ADR, run from the repository root:

```sh
npm run check
git diff --check
```
