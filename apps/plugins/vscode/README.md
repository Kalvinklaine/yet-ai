# Yet AI VS Code Plugin

## Ownership and boundary

`apps/plugins/vscode` owns the minimal VS Code extension host for Yet AI. Its responsibilities are extension metadata, local runtime connection settings, webview hosting, and a narrow VS Code `postMessage` bridge.

The plugin stays thin. Chat runtime, provider configuration, tool policy, storage, indexing, and model/provider adapters belong to the engine. UI state and design belong to the GUI.

The plugin connects the GUI to the local Yet AI runtime for local-first BYOK workflows. It does not require a Yet AI cloud workspace, account, hosted model gateway, or managed credit balance for normal operation. It must not persist provider API keys or duplicate provider adapters.

## Commands

```sh
npm install
npm run compile
```

Repository-level validation is available from the root:

```sh
npm run check
```

Required verification for this package:

```sh
cd apps/plugins/vscode && npm run compile && cd ../../.. && npm run check
```

## Extension surfaces

- Manifest identity is checked against `product/identity.json`.
- Command: `yetaicmd.openChat` (`Yet AI: Open Chat`).
- Activity bar container id: `yet-ai-toolbox-pane`.
- Settings:
  - `yetai.runtimeUrl`, default `http://127.0.0.1:8001`.
  - `yetai.sessionToken`, optional local runtime bearer/session token for debug connections.
  - `yetai.guiDevUrl`, optional loopback GUI dev server URL.

`runtimeUrl` and `guiDevUrl` are restricted to loopback `http` or `https` URLs before the webview opens. `sessionToken` is a sensitive local runtime credential, not a provider secret. It is passed only in the bootstrap/`host.ready` path needed by the trusted GUI runtime client, is not logged, and is not rendered in the placeholder UI. Production token storage with VS Code SecretStorage is a follow-up; raw provider secrets must never be stored in extension settings.

## Webview and bridge

The command opens a minimal Yet AI webview shell. If `yetai.guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it displays a local placeholder with the configured runtime URL.

The wrapper sends `gui.ready` with a request id. The extension accepts only exact-version `gui.ready` messages, rejects unknown or invalid messages without logging payloads, and replies with `host.ready` echoing the request id when present. It also sends `host.openedFromCommand`. Bootstrap data is serialized for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

No privileged workspace edits, IDE tools, or provider actions are implemented in this shell.

## Current limitations

- The extension shell is buildable but not production-ready.
- It connects to an already running local runtime; engine binary launch, lifecycle management, logs, and health recovery are follow-up work.
- No packaged production GUI asset is wired yet; use `yetai.guiDevUrl` for development or the local placeholder shell.
- No LSP client, privileged workspace edits, IDE tools, file mutation, shell actions, or provider actions are implemented.
- `yetai.sessionToken` remains a debug/local runtime setting until VS Code SecretStorage integration is added.

## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch, require the exact bridge version, and keep the accepted GUI message allowlist narrow.
- Use exact dev iframe target origins and check inbound iframe origins before forwarding.
- Never log bridge payloads that may contain local runtime credentials.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
