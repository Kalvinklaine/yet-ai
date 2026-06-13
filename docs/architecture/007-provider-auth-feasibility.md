# 007 Provider Auth Feasibility Decision

This note records the current feasibility and compliance decision for the first target provider in the login-based GPT first-message milestone described in `006-login-based-gpt-first-message.md`.

## Target under evaluation

- Provider: OpenAI / ChatGPT account access for a first GPT message from Yet AI.
- Desired mechanism: provider-supported local-app account login suitable for third-party applications, preferably browser OAuth with PKCE, device authorization, or a documented account-to-API credential exchange that the local `yet-lsp` engine can own end to end.
- Product boundary: Yet AI must remain local-first and BYOK-compatible. Core provider setup and chat must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.

## Evidence status

No official third-party/local-app OpenAI account-login path has been identified and approved in this repository context. In particular, this note does not verify or claim official OpenAI OAuth support for Yet AI, OpenAI partnership status, marketplace approval, or production ChatGPT account-login support.

The only approved real-provider default remains direct configured provider access through local runtime configuration, using an OpenAI API key, project key, OpenAI-compatible gateway key, or local runtime credential supplied by the user and stored by the engine-owned provider secret boundary.

## Explicitly disallowed paths

The following mechanisms are not allowed as production/default login paths for Yet AI:

- cookie scraping or cookie reuse;
- browser profile import;
- importing or reading credentials from other tools;
- private web-session state as the default API credential path;
- hidden or provider-private headers without explicit compliance approval;
- GUI, browser webview, or IDE plugin storage of raw provider access tokens, refresh tokens, API keys, cookies, auth codes, PKCE verifiers, session IDs, or equivalent provider secret material.

Any future exception would require separate explicit approval, provenance review, privacy/security design, user-facing risk copy, and a non-default implementation plan before implementation.

## Current safe/default path

The approved safe/default path for the milestone is still API-key or project-key fallback through the local runtime:

1. The GUI may guide the user to create or paste an OpenAI API key, project key, OpenAI-compatible gateway key, or local runtime credential.
2. The engine owns validation, storage, migration, status, and model/chat calls.
3. Raw credentials are not persisted by GUI code, returned through GUI-facing status, or stored by IDE plugins.
4. Provider/model readiness is represented only through sanitized local engine responses.

This preserves the local-first BYOK and no-required-cloud contract while keeping production/default account login blocked.

## Experimental Codex-like path status

The existing experimental Codex-like path for `openai` remains high-risk, private-endpoint-style, and non-default. It may be used only under the current explicit-risk boundary:

- automation must stay loopback/mock-only with fake credentials, fake tokens, fake sessions, and local mock endpoints;
- real-account testing is manual only and requires explicit acceptance for the specific task;
- documentation and UI copy must not describe it as official OpenAI OAuth, public provider-supported login, production-ready login, or an OpenAI partnership;
- it must not become the default production login UX or CI path.

Hardening this path can reduce accidental leakage and improve contract coverage, but it does not convert the path into an approved official provider-auth mechanism.

## Decision outcome

Production/default OpenAI account login remains blocked. Yet AI must not enable account-login as the default first-message path until an official/provider-supported local-app flow is identified, documented, compliance-approved, implemented behind engine-owned secret storage, and verified through the gates in `006-login-based-gpt-first-message.md`.

Until then, product and architecture claims must say that account login is unavailable for production/default use, and users should use the local API-key/project-key fallback for real provider calls.

## Implementation impact

Next cards may:

- harden provider-auth contracts and schemas for login-shaped start/status/exchange/disconnect states;
- add positive and negative mock fixtures for unavailable, pending, connected, expired, revoked, sanitized-error, and API-key fallback states;
- keep improving no-secret tests for GUI, IDE, engine, logs, diagnostics, and smoke evidence;
- improve user-facing fallback copy that explains safe API-key/project-key setup.

Next cards must not:

- enable production/default account login;
- claim official OpenAI OAuth support;
- store raw provider secrets in GUI/browser/IDE state;
- use cookies, browser profiles, other-tool credentials, private web-session state, or hidden/private provider headers as the default path;
- add CI or smoke coverage that depends on real OpenAI/ChatGPT accounts or credentials.

## Verification

For this documentation decision, run from the repository root:

```sh
npm run check
git diff --check
```

Both commands must pass before treating this note as the current architecture decision.
