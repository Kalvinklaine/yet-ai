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

Build the GUI and copy its generated `dist` into the extension when testing packaged webview assets:

```sh
cd apps/gui && npm install && npm run build
cd ../plugins/vscode && npm install && npm run copy:gui && npm run compile
```

`npm run copy:gui` copies `apps/gui/dist` to `apps/plugins/vscode/media/gui`. That directory is ignored because it contains generated assets; release packaging should run this copy step after each GUI build instead of committing the generated files.

## Local engine binary for dev previews

Prepare the local engine binary from the repository root before opening the extension dev host:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:ide-engine
```

The helper reads `yet-lsp` from `product/identity.json`, runs `cargo build -p yet-lsp`, copies `target/debug/yet-lsp` to `apps/plugins/vscode/bin/yet-lsp`, and prints the matching settings. `apps/plugins/vscode/bin/` is ignored because it contains generated local binaries. Use `npm run prepare:ide-engine -- --release` when testing a release build, or `-- --no-build` after manually running Cargo.

For first run, keep `yetai.launchMode` as `auto`. The extension discovers the copied `bin/yet-lsp` automatically; alternatively set `yetai.engineBinaryPath` to the absolute path printed by the helper. The helper is intended for macOS/Linux dev previews. Windows is not verified yet; if needed, use the printed absolute `.exe` path.

Repository-level validation is available from the root:

```sh
npm run check
```

Required verification for this package:

```sh
cd apps/gui && npm run build && cd ../plugins/vscode && npm run compile && cd ../../.. && npm run check
```

## VS Code dev-preview run guide

This is the first manual path for trying the local-first VS Code dev preview with the packaged GUI and a local engine launcher. It does not require a Yet AI cloud account, hosted workspace, managed model gateway, or product credit balance.

1. From the repository root, build the local runtime binary:

   ```sh
   export PATH="$HOME/.cargo/bin:$PATH"; cargo build -p yet-lsp
   ```

2. Build the GUI assets:

   ```sh
   cd apps/gui && npm install && npm run build
   ```

3. Copy the GUI into the VS Code extension and compile the extension:

   ```sh
   cd apps/plugins/vscode && npm install && npm run copy:gui && npm run compile
   ```

   If you ran step 2 from `apps/gui`, `cd ../plugins/vscode` is equivalent.

4. In VS Code, open this repository and start an Extension Development Host for `apps/plugins/vscode`. For example, use the VS Code extension development launch flow, or run the extension from that folder in your normal VS Code development setup.

5. Configure runtime settings when auto-discovery is not enough:

   - `yetai.launchMode`: use `auto` for normal dev-preview, `launch` to require starting a local binary, or `connect` to use an already running loopback runtime.
   - `yetai.engineBinaryPath`: set an absolute path to the built `yet-lsp` when discovery does not find it. From the repository root after step 1 this is usually `<repo>/target/debug/yet-lsp`.
   - `yetai.runtimeUrl`: keep a loopback URL such as `http://127.0.0.1:8001`. The port is passed to the launched engine as `YET_AI_HTTP_PORT`.
   - `yetai.sessionToken`: only for `connect` mode when the already running engine requires a known local bearer token. In `auto` or `launch`, the extension generates a per-session token.

6. In the Extension Development Host, run `Yet AI: Open Chat` from the Command Palette.

7. Verify that the packaged GUI opens instead of the placeholder. The GUI runtime status should show the local runtime as reachable after `/v1/ping` and `/v1/caps` succeed. Runtime logs are available in the `Yet AI Runtime` output channel with bearer tokens redacted.

8. Configure a provider in the GUI. For the current MVP, choose an OpenAI-compatible provider or local gateway. Examples:

   - Local OpenAI-compatible gateway: `http://127.0.0.1:1234/v1`
   - Local/LAN OpenAI-compatible gateway: `http://localhost:11434/v1` when your gateway exposes an OpenAI-compatible API
   - Hosted OpenAI-compatible endpoint: use the provider's HTTPS API root and your own BYOK key

   Provider settings and credentials are stored by the local engine, not by the VS Code extension. The GUI clears raw API-key inputs after save and renders only configured/redacted status returned by the engine.

9. Send a simple chat message, such as `Say hello in one sentence.` Confirm that the response streams in the GUI.

## Manual smoke checklist

Use this checklist after the steps above:

- Engine binary exists at `target/debug/yet-lsp` or at the configured absolute `yetai.engineBinaryPath`.
- `apps/gui/dist/index.html` exists before running `npm run copy:gui`.
- `apps/plugins/vscode/media/gui/index.html` exists after running `npm run copy:gui`.
- `Yet AI: Open Chat` opens the packaged GUI, not only the placeholder text.
- The `Yet AI Runtime` output channel reports `Yet AI local runtime health check passed.`
- The GUI shows runtime status as connected/reachable.
- Provider save/test uses an OpenAI-compatible or local gateway URL and does not require a Yet AI-hosted backend.
- Provider status after save is configured/redacted; the raw key is not rendered back into the form.
- A simple chat message produces `snapshot`, stream start/delta, and finish behavior in the GUI.

## Troubleshooting

- Token or `401` errors: in `auto` or `launch` mode, do not manually set `yetai.sessionToken`; the extension generates a token and passes it to the engine. In `connect` mode, make sure `yetai.sessionToken` matches the running engine's `YET_AI_AUTH_TOKEN`. Restart the Extension Development Host after changing token-related settings.
- Runtime port conflict: `yetai.runtimeUrl` defaults to `http://127.0.0.1:8001`. If another process owns that port, set `yetai.runtimeUrl` to another loopback port such as `http://127.0.0.1:8011` before opening chat. In launch mode the extension passes that port through `YET_AI_HTTP_PORT`.
- Missing `yet-lsp` binary: run `export PATH="$HOME/.cargo/bin:$PATH"; cargo build -p yet-lsp` from the repository root. If discovery still fails, set `yetai.engineBinaryPath` to the absolute `target/debug/yet-lsp` path and use `yetai.launchMode` `launch`.
- Packaged GUI not copied: run `cd apps/gui && npm install && npm run build`, then `cd ../plugins/vscode && npm install && npm run copy:gui && npm run compile`. If the webview still shows the placeholder, check that `apps/plugins/vscode/media/gui/index.html` exists and reopen the command.
- Provider base URL normalization: for OpenAI-compatible providers, `http://host/v1`, `http://host/v1/`, and an explicit `http://host/v1/chat/completions` are accepted. The engine appends `/chat/completions` when needed. Use absolute `http` or `https` URLs with a host and no `user:pass@host` userinfo.

## Extension surfaces

- Manifest identity is checked against `product/identity.json`.
- Command: `yetaicmd.openChat` (`Yet AI: Open Chat`).
- Activity bar container id: `yet-ai-toolbox-pane`.
- Settings:
  - `yetai.runtimeUrl`, default `http://127.0.0.1:8001`.
  - `yetai.sessionToken`, optional local runtime bearer/session token for debug connections.
  - `yetai.guiDevUrl`, optional loopback GUI dev server URL.
  - `yetai.launchMode`, one of `auto`, `connect`, or `launch`.
  - `yetai.engineBinaryPath`, optional absolute path to `yet-lsp`.

`runtimeUrl` and `guiDevUrl` are restricted to loopback `http` or `https` URLs before the webview opens. `sessionToken` is a sensitive local runtime credential, not a provider secret. It is passed only in the bootstrap/`host.ready` path needed by the trusted GUI runtime client, is not logged, and is not rendered in the placeholder UI. Production token storage with VS Code SecretStorage is a follow-up; raw provider secrets must never be stored in extension settings.

## Runtime connection and launch

The extension supports two runtime workflows:

- Debug connect mode: set `yetai.launchMode` to `connect`, set `yetai.runtimeUrl` to an already running loopback engine, and set `yetai.sessionToken` to that engine's local bearer token when required. The extension validates the URL and checks `GET /v1/ping` before opening the webview.
- Local launch mode: set `yetai.launchMode` to `launch` and configure `yetai.engineBinaryPath` with an absolute path to `yet-lsp`. The extension starts the process, generates a per-session token, passes it in `YET_AI_AUTH_TOKEN`, passes the port from `yetai.runtimeUrl` in `YET_AI_HTTP_PORT`, checks `GET /v1/ping`, and stops the launched process on extension deactivate.

The default `auto` mode launches a configured or discoverable `yet-lsp` binary when available; otherwise it behaves like debug connect mode. Discovery checks packaged `bin/` locations, repository `target/debug` and `target/release`, then `PATH`.

Basic engine stdout/stderr lines are captured in the `Yet AI Runtime` output channel. The generated session token and bearer headers are redacted before logging. Provider configuration and provider secrets remain engine-owned and are not stored or logged by the extension.

## Webview and bridge

The command opens a minimal Yet AI webview shell. If `yetai.guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it first looks for packaged GUI assets at `media/gui/index.html`; when those generated assets are absent, it displays a local placeholder with the configured runtime URL.

The wrapper sends `gui.ready` with a request id. The extension accepts only exact-version `gui.ready` messages, rejects unknown or invalid messages without logging payloads, and replies with `host.ready` echoing the request id when present. It also sends `host.openedFromCommand`. Bootstrap data is serialized for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

No privileged workspace edits, IDE tools, or provider actions are implemented in this shell.

## Current limitations

- The extension shell is buildable but not production-ready.
- Runtime health recovery after a crashed launched process is limited to retrying the command.
- Packaged production GUI assets are supported through the documented `apps/gui` build plus `npm run copy:gui` flow, but generated assets are not committed.
- No marketplace package, LSP client, completions, privileged workspace edits, IDE tools, file mutation, shell actions, or provider actions are implemented.
- `yetai.sessionToken` remains a debug/local runtime setting until VS Code SecretStorage integration is added.

## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch, require the exact bridge version, and keep the accepted GUI message allowlist narrow.
- Use exact dev iframe target origins and check inbound iframe origins before forwarding.
- Never log bridge payloads that may contain local runtime credentials.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
