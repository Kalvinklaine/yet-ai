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

`runtimeUrl` and `guiDevUrl` are restricted to loopback `http` or `https` URLs before the webview opens. `sessionToken` is passed only in the webview bootstrap/`host.ready` payload for the local runtime path and is not treated as a provider secret.

## Webview and bridge

The command opens a minimal Yet AI webview shell. If `yetai.guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it displays a local placeholder with the configured runtime URL.

The webview sends `gui.ready`. The extension validates the message shape, logs the event, and replies with `host.ready` plus non-secret bootstrap fields: product id, display name, runtime URL, optional local session token, and `cloudRequired: false`. It also sends `host.openedFromCommand`. In GUI dev mode the wrapper forwards `host.ready` to the loopback iframe.

No privileged workspace edits, IDE tools, or provider actions are implemented in this shell.

## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
