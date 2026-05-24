# Yet AI GUI

Minimal React/Vite browser shell for local-first Yet AI workflows.

## Boundary

The GUI talks only to the local Yet AI runtime and logical IDE host bridge. It does not call hosted model providers directly, does not own provider adapters, and does not store raw provider secrets in browser storage.

## Commands

```sh
npm install
npm run typecheck
npm run build
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

A session token can be entered for local runtime API calls. The runtime clients attach it as:

```txt
Authorization: Bearer <token>
```

The token is kept only in React state for the current page lifetime.

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

## Bridge behavior

Browser mock mode is non-privileged and logs messages locally. The adapter sends `gui.ready`, accepts/logs `host.ready`, and validates the basic `version`/`type` shape for bridge messages.
