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
- `POST /v1/chats/:chat_id/commands` with `user_message`
- `GET /v1/chats/subscribe?chat_id=...` through fetch streaming SSE
- Browser, VS Code, and JetBrains-style logical bridge detection

## Provider secret handling

The provider form allows entering an API key for create/update. After submit, the key field is cleared. The UI renders only `auth.configured` and `auth.redacted` returned by the runtime. Do not add localStorage or sessionStorage persistence for provider keys.

## SSE and bridge behavior

SSE uses fetch streaming, not native EventSource. The parser handles CRLF, comments, split frame boundaries, multiple events per chunk, and multi-line `data:` frames. Network, HTTP, parse/protocol, sequence, and configuration failures are surfaced as typed runtime errors.

Browser mock mode is non-privileged and logs messages locally. The adapter sends `gui.ready`, validates the current bridge `version`, known host `type`, optional string `requestId`, and optional object `payload`, and accepts only the current host message allowlist: `host.ready`, `host.themeChanged`, `host.activeFileChanged`, `host.selectionChanged`, `host.workspaceChanged`, `host.toolResult`, and `host.openedFromCommand`. `host.ready` may include `runtimeUrl`, `sessionToken`, `productId`, `displayName`, and `cloudRequired`; subscribers receive the validated message so the app can update runtime settings without browser storage persistence.

## Current limitations

- This is a development MVP shell, not the final production GUI or design system.
- VS Code packaged GUI assets are generated with `npm run build` and copied into the extension with `cd ../plugins/vscode && npm run copy:gui`; the copied assets remain ignored build output.
- JetBrains packaged GUI assets are generated with `npm run build` and copied automatically into Gradle generated resources by `cd ../plugins/jetbrains && gradle build --console=plain`; generated assets remain ignored build output.
- Chat is limited to the current local runtime command/SSE baseline and does not implement full agent autonomy, tool confirmations, indexing, tasks, knowledge, or privileged IDE actions.
- Runtime tokens are held only in page state; do not add persistence without a reviewed host/runtime token policy.

## Product identity

GUI constants mirror `product/identity.json` for the Yet AI product id, display name, and package name. `/v1/ping` and `/v1/caps` identity mismatches are shown as warnings without crashing the shell.
