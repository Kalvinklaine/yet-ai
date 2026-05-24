# Yet AI GUI

Minimal React/Vite browser shell for local-first Yet AI workflows.

## Boundary

The GUI talks only to the local Yet AI runtime and logical IDE host bridge. It does not call hosted model providers directly, does not own provider adapters, and does not store raw provider secrets in browser storage.

## Commands

```sh
npm install
npm run typecheck
npm run build
npm test
npm run dev
```

Repository validation remains available from the root:

```sh
npm run check
```

Manual IDE packaged-asset preview flows:

```sh
cd apps/gui && npm run build
cd ../plugins/vscode && npm run copy:gui && npm run compile
```

```sh
cd apps/gui && npm run build
cd ../plugins/jetbrains && gradle build --console=plain
```

The IDE plugins can also point to `npm run dev` through their loopback GUI dev URL settings during local development.

## Runtime settings

The browser shell defaults to:

```txt
http://127.0.0.1:8001
```

A session token can be entered for local runtime API calls, or supplied by a trusted IDE host through a validated `host.ready` bridge message with `runtimeUrl` and `sessionToken`. The runtime clients attach it only after validating that the runtime URL is loopback (`127.0.0.1`, `localhost`, or `[::1]` / `::1`) over `http` or `https`:

```txt
Authorization: Bearer <token>
```

Non-loopback runtime URLs are rejected with a visible configuration error before fetch, and the bearer token is not sent. The token is kept only in React state for the current page lifetime. Bridge logs show `Host runtime settings received` for `host.ready` and never include raw tokens.

## Implemented surfaces

- `/v1/ping`
- `/v1/caps`
- `/v1/models`
- `/v1/providers`
- `POST /v1/providers` and `PATCH /v1/providers/:id`
- `/v1/provider-auth/:provider/start`, `/status`, `/exchange`, and `/disconnect` for sanitized engine-owned provider login state
- `POST /v1/chats/:chat_id/commands` with `user_message`
- `GET /v1/chats/subscribe?chat_id=...` through fetch streaming SSE
- Browser, VS Code, and JetBrains-style logical bridge detection

## Chat panel

The primary chat area renders a message-oriented local chat view with user, assistant, and safe error bubbles. A compact readiness summary near the chat shows local runtime status, enabled provider count, and the first model returned by the runtime as the MVP display default. If no enabled provider/model is available, Send is disabled and the panel points to the OpenAI API-key fallback preset before the first GPT message. Sending opens the fetch-streaming SSE subscription for the active chat, posts `user_message` through the local runtime, clears the input only after the command is accepted, and appends streaming assistant text from snapshot/start/delta/finish events. The raw SSE timeline remains available under `SSE debug details` for development troubleshooting.

## Provider secret handling

The provider form allows entering an API key for create/update. After submit, the key field is cleared. The UI renders only `auth.configured` and `auth.redacted` returned by the runtime. Do not add localStorage or sessionStorage persistence for provider keys.

## Provider presets

Provider setup includes quick presets that only prefill local form fields. They do not include real API keys, do not persist secrets in browser storage, and do not call model providers from the GUI. Saving still sends the configuration only to the local runtime.

Current chat generation selects an enabled `openai-compatible` provider in the runtime. The quick presets therefore target OpenAI-compatible `/v1` endpoints:

- OpenAI API, using `https://api.openai.com/v1`, provider kind `openai-compatible`, API-key auth, a sensible default model, and a blank API key field.
- OpenAI-compatible custom `/v1`, with `https://api.openai.com/v1` as an editable example endpoint and a blank API key field.
- LM Studio local, using the common OpenAI-compatible server default `http://127.0.0.1:1234/v1`.
- LocalAI local, using the common OpenAI-compatible server default `http://127.0.0.1:8080/v1`.
- Ollama OpenAI-compatible, using `http://127.0.0.1:11434/v1` with provider kind `openai-compatible`.
- Custom, for manually editing every field.

Native provider-specific chat adapters, including native Ollama chat, are future work for this GUI/runtime MVP. Until then, configure Ollama through its OpenAI-compatible `/v1` API if that endpoint is enabled in your local Ollama version.

ChatGPT/OpenAI account login-first support is planned as an experimental, high-risk Codex-like path after explicit user approval despite the lack of a public third-party OpenAI OAuth program. The GUI shows an OpenAI account login card that calls only engine-owned provider-auth endpoints and renders explicit local-first statuses for `login_unavailable`, `api_key_configured`, `pending`, `connected`, `expired`, and `revoked`, plus sanitized fields such as `status`, `authSource`, `supportsLogin`, `supportsApiKey`, `accountLabel`, `sessionId`, `expiresAt`, `scopes`, redacted hints, messages, and `lastError`. The normal `Login with OpenAI` action remains the safe/default start request and does not enable the risky path silently. A separate `Experimental Login with OpenAI account` action sends `{ "experimentalCodexLike": true }`, displays explicit private-endpoint/Codex-like risk copy, and opens returned authorization or verification URLs only when they are HTTPS or loopback. The GUI defensively redacts obvious secret-like substrings before rendering provider-auth messages/errors/details, including access-token, refresh-token, API-key, bearer-token, auth-code-like fields, and long token-like values. The GUI must not store or display raw access tokens, refresh tokens, API keys, cookies, verifiers, sessions with secret material, authorization codes after exchange, or provider credential files. If account login is not available or too risky for API use, the GUI should guide the user to the OpenAI platform to create an API key or project key and paste it once, then clear the field after save.

T-67 supports only experimental pending PKCE start/status in the runtime. Manual authorization-code exchange, refresh, and disconnect for the Codex-like path remain follow-up work until the engine exchange slice is available. This differs from richer reference provider OAuth UX that supports provider-specific modes and exchange/polling flows; Yet AI intentionally keeps the GUI smaller, explicit-risk, local-runtime-only, and API-key-fallback-first.

The approved T-49 task chain may implement engine-owned PKCE/session handling, authorization/token exchange, refresh, revoke/disconnect, sanitized GUI status, and local secret storage modeled after Codex-like behavior. That approval does not allow cookie scraping, browser profile import, browser cookie reuse, direct import or reading of `~/.codex/auth.json` or other tools' credential files, or any required Yet AI hosted backend, account, managed gateway, product credit balance, or cloud workspace. It does not claim production readiness, official OpenAI partnership, or general public OAuth support, and the GUI must label private endpoint/client-identity risk clearly if the flow becomes visible to users.

## Manual OpenAI API-key fallback smoke

The milestone manual smoke path uses the `OpenAI API` preset as the safe/default API-key fallback only. Real ChatGPT/OpenAI account login is not implemented in this baseline; the approved Codex-like path remains experimental and high-risk. Do not add automated tests that use real provider keys, and do not commit, log, screenshot, or paste real keys into docs, examples, issues, or test fixtures.

Expected GUI behavior during the smoke:

1. The OpenAI account login card should either report `login_unavailable` with API-key fallback copy, or report an existing `api_key_configured` state with only a redacted hint.
2. Selecting `Use OpenAI API key` or the `OpenAI API` preset should fill provider kind `openai-compatible`, base URL `https://api.openai.com/v1`, OpenAI-oriented defaults, and a blank API key field.
3. Paste the key once, save through the local runtime, and confirm the input clears after submit.
4. Provider summaries and provider-auth status should show only configured/redacted values such as `sk-...abcd`; the raw key must not appear in the form, rendered status, browser storage, bridge logs, or runtime responses.
5. Sending `Say hello in one sentence.` should create a chat command and render a streaming assistant response as SSE snapshot/start/delta/finish events arrive.

Common real-provider troubleshooting from the GUI side:

- `401` or unauthorized provider errors usually mean the OpenAI API key is missing, expired, revoked, or pasted with extra whitespace. Re-enter it once and save again; do not store it anywhere else.
- `429` errors mean the upstream provider rejected the request because of rate limits, quota, or billing limits. Wait, lower usage, or check the provider account outside Yet AI.
- Model errors mean the selected model is unavailable for that key or endpoint. Edit the provider model field to a model enabled for the account.
- Base URL errors mean the provider URL is malformed. For this preset, keep `https://api.openai.com/v1`; for other OpenAI-compatible gateways, use an absolute `http` or `https` URL with a host and no userinfo.
- Runtime `401` errors are different from provider `401` errors: they indicate the GUI local runtime bearer token does not match the engine session token.

## SSE and bridge behavior

SSE uses fetch streaming, not native EventSource. The parser handles CRLF, comments, split frame boundaries, multiple events per chunk, and multi-line `data:` frames. Network, HTTP, parse/protocol, sequence, and configuration failures are surfaced as typed runtime errors.

Browser mock mode is non-privileged and logs messages locally. The adapter sends `gui.ready`, validates the current bridge `version`, known host `type`, optional string `requestId`, and optional object `payload`, and accepts only the current host message allowlist: `host.ready`, `host.themeChanged`, `host.activeFileChanged`, `host.selectionChanged`, `host.workspaceChanged`, `host.toolResult`, and `host.openedFromCommand`. `host.ready` may include `runtimeUrl`, `sessionToken`, `productId`, `displayName`, and `cloudRequired`; subscribers receive the validated message so the app can update runtime settings without browser storage persistence.

## Current limitations

- This is a development MVP shell, not the final production GUI or design system.
- VS Code packaged GUI assets are generated with `npm run build` and copied into the extension with `cd ../plugins/vscode && npm run copy:gui`; the copied assets remain ignored build output.
- JetBrains packaged GUI assets are generated with `npm run build` and copied automatically into Gradle generated resources by `cd ../plugins/jetbrains && gradle build --console=plain`; generated assets remain ignored build output.
- No marketplace packaging, signed/notarized engine bundle, or production installer is complete.
- Chat is limited to the current local provider/chat MVP and does not implement full agent autonomy, tool confirmations, indexing, tasks, knowledge, LSP/completions, file edits, or privileged IDE actions.
- Runtime tokens are held only in page state; do not add persistence without a reviewed host/runtime token policy.

## Product identity

GUI constants mirror `product/identity.json` for the Yet AI product id, display name, and package name. `/v1/ping` and `/v1/caps` identity mismatches are shown as warnings without crashing the shell.
