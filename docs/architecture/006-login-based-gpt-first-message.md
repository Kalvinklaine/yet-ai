# 006 Login-Based GPT First Message Milestone

This document plans a mandatory future milestone for a login-based GPT first-message UX. It is separate from the current VS Code no-manual-runtime milestone and from the current API-key fallback baseline. It is a plan only; it does not claim that production login is implemented or officially supported.

## User goal

The target user flow is:

1. Open the IDE with the Yet AI plugin installed.
2. Run the chat command or open the Yet AI panel.
3. The IDE host starts or connects to the local `yet-lsp` runtime without manual engine launch.
4. The IDE host and GUI receive the runtime session token through trusted local bootstrap only, without copy-pasting `local-dev-token`.
5. The user chooses a safe login or provider connection path.
6. The local engine owns the provider credential/session flow.
7. The GUI shows sanitized readiness and account/provider status.
8. The user sends the first GPT message.

The milestone is successful only when a fresh IDE user can reach the first GPT response without manual runtime-token copying, manual engine launch, or unsafe credential import.

## Relationship to the current first-message milestone

The current near-term milestone is VS Code first GPT message without manual runtime setup. That milestone should make runtime startup, `host.ready` token delivery, provider readiness, and API-key fallback reliable and obvious.

The login-based milestone comes after that. Until the login milestone passes its contracts, tests, and reviews, the safe/default real-provider path remains the local API-key or project-key fallback through the engine. The GUI may present login as planned, unavailable, experimental, or explicitly high risk, but it must not make login the default production path until this milestone is complete.

## Supported official path criteria

A production login path is acceptable only if it uses provider-supported mechanisms intended for third-party or local applications. Acceptable candidates include:

- browser OAuth with PKCE and a provider-approved redirect or loopback callback;
- device authorization flow with provider-approved polling;
- provider-documented account-to-API credential exchange intended for API calls;
- provider-documented token refresh, revoke, disconnect, and account status endpoints.

The implementation must use Yet AI-owned product identity, redirect URI, storage names, contract schemas, and UI copy. It must not imply an official OpenAI partnership, marketplace approval, or production support before those are explicitly established.

The supported path must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace for core local chat/provider setup. If a provider requires its own hosted auth service, that dependency belongs to the provider account flow, not to Yet AI's local-first runtime contract.

## Disallowed credential paths

The production login path must not use:

- cookie scraping;
- browser profile import;
- browser session reuse;
- importing or reading other tools' credential files;
- private ChatGPT web-session state as the default API credential path;
- hidden provider-private headers without explicit compliance approval;
- GUI or IDE storage for raw provider tokens, refresh tokens, API keys, cookies, auth codes, or session IDs.

Any exception would require a separate explicit approval, provenance review, privacy/security design, user-facing risk copy, and non-default implementation plan.

## Experimental Codex-like path status

The current Codex-like path is high-risk and private-endpoint-style. It is not production-ready and must remain separate from the supported official path.

Allowed status for the experimental path:

- loopback/mock-only automation;
- contract and smoke tests with fake credentials, fake tokens, fake sessions, and local mock endpoints;
- manual real-account testing only when explicitly accepted for a specific task;
- clear documentation that it is experimental, account-specific, high risk, and not official public OpenAI OAuth support.

The experimental path must not become the default login UX, must not run in CI against real accounts, and must not be described as production OpenAI login support.

## Engine, GUI, and IDE boundaries

The engine owns:

- provider auth sessions and PKCE/device-flow state;
- callback, exchange, polling, refresh, revoke, disconnect, and expiry handling;
- local credential storage through OS keychain or protected local fallback;
- migration of legacy local provider secrets where needed;
- direct provider/model calls after authentication;
- sanitized provider status, readiness, and error responses.

The GUI owns:

- provider-auth onboarding screens;
- login/API-key fallback choice presentation;
- progress, status, errors, retry, and disconnect controls;
- clearing one-time secret inputs after submission;
- rendering only engine-returned sanitized fields.

The GUI must not persist raw provider secrets in browser storage and must not call model providers directly.

IDE plugins own:

- local runtime discovery, launch, and lifecycle;
- local runtime session-token generation and trusted `host.ready` delivery;
- opening provider authorization URLs or device-code pages when the engine asks for it;
- hosting the webview and native notifications.

IDE plugins must not duplicate provider adapters and must not store provider API keys or provider OAuth tokens.

## Required contracts and gates before enabling login by default

Before login can become the default first-message path, the following gates are required.

### Contract schemas and fixtures

- Strict JSON schemas for provider-auth start, status, exchange, callback, polling, refresh, disconnect, and errors.
- Positive fixtures for official pending, connected, expired, revoked, unavailable, and API-key fallback states.
- Negative fixtures for unknown fields, malformed request IDs/session IDs, unsafe authorization URLs, raw tokens in responses, invalid status/source combinations, and provider IDs outside the allowed pattern.
- Shared GUI/engine/IDE validation where practical.

### Runtime and storage tests

- Engine tests for start, callback/exchange, polling, refresh, revoke, disconnect, expiry, and retry behavior with loopback mocks.
- Secret-store tests proving access tokens, refresh tokens, API keys, auth metadata, and provider configs are written, migrated, rolled back, and deleted safely.
- No-secret regression tests for HTTP responses, SSE events, logs, diagnostics, panic/error paths, and provider failure summaries.
- Local mock tests for authorization URL validation, state/PKCE verification, CSRF/session mismatch rejection, and loopback callback origin handling.

### GUI and IDE tests

- GUI render tests for login unavailable, pending, connected, expired, revoked, provider-down, auth-denied, and API-key fallback states.
- Tests that raw tokens, auth codes, cookies, device codes where sensitive, API keys, and session IDs are not stored in browser storage or rendered after save.
- VS Code and JetBrains bridge tests for trusted runtime-token delivery and safe opening of authorization/device URLs.
- Local smoke tests using mock provider auth and mock chat so the first-message path can run without real accounts.

### Manual real-provider checklist

Manual real-provider testing must be explicit and outside CI. The checklist should record:

- provider auth mechanism and documentation reviewed;
- account type and model access assumptions;
- redirect/device flow behavior;
- scopes and consent copy;
- token refresh and revoke behavior;
- disconnect and re-login behavior;
- first GPT message success;
- sanitized status/errors screenshots or logs with no secrets;
- failure cases for denied consent, expired session, unavailable model, and provider outage.

### Privacy and security review

A release candidate for default login must pass a documented privacy/security review covering:

- no cookie scraping, browser profile import, or other-tool credential import;
- raw secret locality in engine-owned storage only;
- OS keychain or protected fallback behavior and permissions;
- redaction coverage for diagnostics, logs, UI, and smoke output;
- local callback binding, origin, state, and CSRF protections;
- disconnect/revoke semantics;
- account labels and scopes as non-secret GUI-facing fields;
- no required Yet AI hosted backend for core local chat/provider setup.

## Future card pool

A focused implementation pool should be created after the no-manual-runtime VS Code first-message milestone is green:

1. Finalize official provider-auth feasibility and compliance notes for the first target provider.
2. Extend provider-auth schemas and positive/negative fixtures for the official login lifecycle.
3. Implement engine-owned official auth start/callback or device flow behind the secret-store boundary.
4. Add token refresh, revoke/disconnect, expiry, and sanitized status handling.
5. Add GUI login-first onboarding with API-key fallback preserved and clear unavailable/experimental copy.
6. Add VS Code and JetBrains URL-opening and status integration without provider-token storage.
7. Add local mock smoke for IDE-opened first GPT message through login-shaped auth.
8. Run manual real-provider checklist and privacy/security review before enabling login as default.

## Non-goals for this milestone plan

- No implementation code is introduced by this document.
- This plan does not claim official OpenAI partnership or production OpenAI login support.
- This plan does not remove the API-key fallback.
- This plan does not permit required Yet AI cloud services for core local-first chat or provider setup.
