# Yet AI JetBrains Plugin

## Ownership and boundary

`apps/plugins/jetbrains` owns the minimal JetBrains plugin host for Yet AI. Its responsibilities are plugin metadata, local runtime connection settings, JCEF tool window hosting, and a narrow JetBrains-to-GUI bridge.

The plugin stays thin. Chat runtime, provider configuration, tool policy, storage, indexing, and model/provider adapters belong to the engine. UI state and design belong to the GUI.

The plugin connects the GUI to the local Yet AI runtime for local-first BYOK workflows. It does not require a Yet AI cloud workspace, account, hosted model gateway, or managed credit balance for normal operation. It must not persist provider API keys or duplicate provider adapters.

## Commands

```sh
node scripts/check-identity.mjs
gradle test --console=plain
gradle build --console=plain
```

## Packaged GUI flow

Build the GUI first, then build the plugin:

```sh
cd apps/gui
npm run build
cd ../plugins/jetbrains
gradle build --console=plain
```

The Gradle build copies `apps/gui/dist` into generated plugin resources under `build/generated/resources/yet-ai-gui/yet-ai-gui`. Generated GUI assets are not committed. If `apps/gui/dist/index.html` is absent, the build still succeeds and the tool window uses the placeholder shell unless `guiDevUrl` is configured.

At runtime the JCEF host prefers `guiDevUrl` when configured. Otherwise it loads packaged GUI resources from `/yet-ai-gui/index.html` when they are present, then falls back to the local placeholder.

Repository-level validation is available from the root:

```sh
npm run check
```

Required verification for this package:

```sh
cd apps/plugins/jetbrains && node scripts/check-identity.mjs && gradle test --console=plain && gradle build --console=plain && cd ../../.. && npm run check
```

If Gradle is not installed locally, run the identity check and root validation, then install Gradle or add a reviewed Gradle wrapper before packaging work. This shell intentionally avoids vendoring a wrapper jar in the first scaffold.

## Plugin surfaces

- Plugin id: `ai.yet.plugin`.
- Plugin group/vendor: `ai.yet`.
- Plugin name: `Yet AI`.
- Kotlin package namespace: `ai.yet.plugin`.
- Tool window: `Yet AI`.
- Action: `ai.yet.plugin.OpenChat` (`Yet AI: Open Chat`).
- Settings:
  - `runtimeUrl`, default `http://127.0.0.1:8001`.
  - `sessionToken`, optional local runtime bearer/session token for debug connections.
  - `guiDevUrl`, optional loopback GUI dev server URL.

`runtimeUrl` and `guiDevUrl` are trimmed, parsed as absolute URIs, and restricted to loopback `http` or `https` URLs before use. Userinfo, missing hosts, malformed values, non-loopback hosts, and non-HTTP schemes are rejected. Only `127.0.0.1`, `localhost`, and IPv6 loopback `[::1]` are allowed, and IPv6 origins are emitted with brackets.

`sessionToken` is a sensitive local runtime credential, not a provider secret. It is stored with JetBrains PasswordSafe instead of the persistent settings XML, passed only through the trusted bootstrap/`host.ready` path needed by the GUI runtime client, never logged, and never rendered in the placeholder UI. Raw provider secrets must never be stored in JetBrains plugin settings.

## Webview and bridge

The tool window uses JCEF when available. If `guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it loads packaged GUI resources copied from `apps/gui/dist` when available, then falls back to a local placeholder with the configured runtime URL.

The wrapper exposes `window.postIntellijMessage` and sends `gui.ready` with a request id. The Kotlin host parses bridge input as JSON, accepts only JSON objects with the exact bridge version and `type: "gui.ready"`, validates optional request ids as short non-empty strings without control characters, requires optional payloads to be JSON objects, rejects arrays/scalars/null/malformed JSON/unknown types without logging payloads, and replies with `host.ready` echoing the request id when present. It also sends `host.openedFromCommand`. Host messages are built as structured JSON objects. Bootstrap JSON is escaped for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

No privileged workspace edits, IDE tools, engine launch process, provider adapters, or provider credential persistence are implemented in this shell.

## Current limitations

- The plugin connects to an already running local runtime; it does not launch the engine binary yet.
- The bridge currently accepts only `gui.ready` from the GUI and emits `host.ready` plus `host.openedFromCommand`.
- Settings use JetBrains application state for non-secret local runtime/debug URLs only. The local session token uses JetBrains PasswordSafe.
- Packaged production GUI assets are generated build output from `apps/gui/dist`; they are copied into Gradle build resources but are not committed.

## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch, require the exact bridge version, and keep the accepted GUI message allowlist narrow.
- Use exact dev iframe target origins and check inbound iframe origins before forwarding.
- Never log bridge payloads that may contain local runtime credentials.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
