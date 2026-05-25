# Yet AI VS Code Plugin

## Ownership and boundary

`apps/plugins/vscode` owns the minimal VS Code extension host for Yet AI. Its responsibilities are extension metadata, local runtime connection settings, webview hosting, and a narrow VS Code `postMessage` bridge.

The plugin stays thin. Chat runtime, provider configuration, tool policy, storage, indexing, and model/provider adapters belong to the engine. UI state and design belong to the GUI.

The plugin connects the GUI to the local Yet AI runtime for local-first BYOK workflows. It does not require a Yet AI cloud workspace, account, hosted model gateway, or managed credit balance for normal operation. It must not persist provider API keys or duplicate provider adapters.

## Commands

VS Code command palette commands:

- `Yet AI: Open Chat` opens the dev-preview chat webview and prepares or checks the local runtime.
- `Yet AI: Show Runtime Status` writes safe local runtime diagnostics to the `Yet AI Runtime` output channel, including the loopback runtime URL without query data, launch mode, engine binary discovery status, and `/v1/ping` result. It does not show session tokens, bearer headers, provider credentials, bridge payloads, provider-auth state, or model-provider responses.
- `Yet AI: Set Local Runtime Session Token` stores the manual local runtime session token in VS Code SecretStorage for `connect` mode or other manual debug connections. This token is not a provider API key.
- `Yet AI: Clear Local Runtime Session Token` removes the SecretStorage token.

From the repository root, run the single dev-preview preparation command:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:vscode-preview
```

The helper orchestrates the existing safe local steps:

1. `npm run prepare:ide-engine` builds the identity-defined `yet-lsp` crate and copies the generated binary into `apps/plugins/vscode/bin/`.
2. `cd apps/gui && npm run build` builds the packaged GUI assets.
3. `cd apps/plugins/vscode && npm run prepare:preview` copies GUI `dist` into `media/gui/` and compiles the extension.

Pass engine-preparation flags after `--` when needed:

```sh
npm run prepare:vscode-preview -- --release
npm run prepare:vscode-preview -- --no-build
```

Generated outputs under `target/`, `apps/gui/dist/`, `apps/plugins/vscode/media/gui/`, `apps/plugins/vscode/bin/`, and extension `out/` are ignored and must not be committed.

After preparing the preview, run the local artifact smoke without launching VS Code or using provider credentials:

```sh
npm run smoke:vscode-preview
```

The smoke checks the copied `yet-lsp` binary, packaged GUI `media/gui/index.html`, compiled `out/extension.js`, manifest `main`, and copied GUI asset references. If preparation has not been run, it fails with the missing artifact and the command to run.

Repository-level validation is available from the root:

```sh
npm run check
```

Required verification for this package:

```sh
export PATH="$HOME/.cargo/bin:$PATH"; npm run prepare:vscode-preview && npm run smoke:vscode-preview && npm run check
```

## VS Code dev-preview run guide

This is the nearest hands-on path for trying the local-first VS Code dev preview with the packaged GUI and a local engine launcher. It does not require a Yet AI cloud account, hosted workspace, managed model gateway, or product credit balance.

1. From the repository root, prepare and smoke-check the extension artifacts:

   ```sh
   export PATH="$HOME/.cargo/bin:$PATH"
   npm run prepare:vscode-preview
   npm run smoke:vscode-preview
   ```

2. Open the extension workspace and start an Extension Development Host:

   ```sh
   cd apps/plugins/vscode
   code .
   ```

   Use your normal VS Code extension development flow, for example Run and Debug → Extension Development Host.

3. Keep `yetai.launchMode` as `auto` for normal dev-preview. The extension discovers the copied `apps/plugins/vscode/bin/yet-lsp` binary automatically. If discovery is not enough, set `yetai.engineBinaryPath` to the absolute binary path printed by the helper.

4. Use these settings only for specific workflows:

   - `yetai.launchMode`: `auto` for normal dev-preview, `launch` to require starting a local binary, or `connect` to use an already running loopback runtime.
   - `yetai.engineBinaryPath`: optional absolute path to the built `yet-lsp`.
   - `yetai.runtimeUrl`: keep a loopback URL such as `http://127.0.0.1:8001`. The port is passed to the launched engine as `YET_AI_HTTP_PORT`.
   - Manual local runtime session token: use `Yet AI: Set Local Runtime Session Token` for `connect` mode when an already running engine requires a known local bearer token. The token is stored in VS Code SecretStorage. In `auto` or `launch`, the extension generates a per-session token and does not persist it.
   - `yetai.sessionToken`: deprecated dev-preview fallback only. Prefer the SecretStorage command.

5. In the Extension Development Host, run `Yet AI: Open Chat` from the Command Palette.

6. Verify the visible success signals:

   - the packaged GUI opens, not the placeholder shell;
   - the GUI shows local runtime connection/status after `/v1/ping` and `/v1/caps` succeed;
   - Provider setup is visible;
   - saved providers show a provider test action;
   - runtime and provider errors are shown in sanitized form, without raw bearer tokens, session tokens, or provider API keys.

7. Configure a local or OpenAI-compatible provider in the GUI. For GPT via API key, choose the `OpenAI API` preset, paste your own API key once, save the provider, confirm that the form clears the raw key, and use the provider test action. Provider settings and credentials are stored by the local engine, not by the VS Code extension.

8. Send a simple chat message, such as `Say hello in one sentence.` Confirm that the response streams in the GUI.

For IDE-launched `auto` or `launch` mode, do not paste `local-dev-token` into the GUI. The extension generates a per-session local runtime token, starts `yet-lsp` with `YET_AI_AUTH_TOKEN`, and provides the token to the GUI through the trusted `host.ready` postMessage path. The token is not serialized into the inline webview bootstrap HTML. Enter `local-dev-token` only when you deliberately use `connect` mode with a runtime started manually:

```sh
YET_AI_AUTH_TOKEN=local-dev-token YET_AI_HTTP_PORT=8001 cargo run -p yet-lsp
```

Then set `yetai.runtimeUrl` to `http://127.0.0.1:8001` and run `Yet AI: Set Local Runtime Session Token` with `local-dev-token`. This Session token is stored in VS Code SecretStorage and is not an OpenAI API key or provider key. The deprecated `yetai.sessionToken` setting remains a dev-preview fallback only when SecretStorage has no token.

## Optional local install/package route

The primary path is Extension Development Host. If you want a local `.vsix` dev-preview package, use the VS Code packaging tool without adding it as a repository dependency:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:vscode-preview
cd apps/plugins/vscode
npx --yes @vscode/vsce package --no-dependencies
code --install-extension yet-ai-0.0.1.vsix
```

This package is for local dev-preview testing only. It is not a marketplace release, does not include a production installer, and does not change the local-first BYOK boundary. `.vsix` files are generated artifacts and should not be committed.

## OpenAI API-key fallback milestone smoke

Use this manual smoke only when you intentionally want to test a real OpenAI API-key fallback through the local VS Code dev preview. This is not a production release flow and is not an automated test. Never commit real keys, add them to fixtures, paste them into logs or issue text, or capture screenshots that show secrets.

This path does not use a Yet AI account, hosted workspace, managed model gateway, or product credit balance. It sends model requests from the local `yet-lsp` runtime directly to the configured OpenAI-compatible endpoint. The `OpenAI API` preset remains the safe/default real-provider path. The experimental Codex-like OpenAI account path is separate, explicit-risk, high-risk, private-endpoint-style, not official public OpenAI OAuth support, and not production-ready: automated coverage is limited to `npm run smoke:local` with loopback token/chat mocks, while real account testing is manual, risky, account-specific, and outside CI. The provider-auth card may show the separate experimental action, but this milestone smoke should use the API-key fallback.

1. Prepare the VS Code dev preview:

   ```sh
   export PATH="$HOME/.cargo/bin:$PATH"
   npm run prepare:ide-engine
   cd apps/gui && npm install && npm run build
   cd ../plugins/vscode && npm install && npm run copy:gui && npm run compile
   ```

2. Open this repository in VS Code and launch the Extension Development Host for `apps/plugins/vscode`.

3. Keep `yetai.launchMode` set to `auto` unless you are deliberately testing `connect` or `launch`. If auto-discovery does not find the binary, set `yetai.engineBinaryPath` to the absolute `apps/plugins/vscode/bin/yet-lsp` path printed by `npm run prepare:ide-engine`.

4. Run `Yet AI: Open Chat` in the Extension Development Host. Confirm the packaged GUI opens, the runtime status becomes reachable, and the `Yet AI Runtime` output channel reports a successful local runtime health check with tokens redacted.

5. In the provider-auth card, keep to the API-key fallback for this milestone. Do not use the experimental Codex-like account action unless you are deliberately performing separate manual high-risk testing outside CI. Do not expect browser account reuse, cookie import, browser profile import/reuse, direct reading of `~/.codex/auth.json`, or credential import from another tool.

6. Choose `Use OpenAI API key` or the `OpenAI API` provider preset. Confirm the form uses:

   - provider kind `openai-compatible`;
   - base URL `https://api.openai.com/v1`;
   - an OpenAI chat model available to your account;
   - an empty API key field before you paste anything.

7. Paste the real API key once, save the provider, and immediately verify secret handling:

   - the API key input clears after submit;
   - provider status shows configured/redacted only, for example a short `sk-...abcd` hint;
   - the raw key is not visible in the GUI, VS Code settings, `Yet AI Runtime` output, browser devtools storage, or repository files.

8. Send this chat message:

   ```text
   Say hello in one sentence.
   ```

9. Expected result: the chat first receives a snapshot, then stream start/delta updates, then a finished state. The assistant should produce a short greeting. The exact text can vary by model, but the response should stream into the GUI without requiring any Yet AI-hosted backend.

10. After testing, remove or rotate the real provider key if your local environment policy requires it. Do not leave copied keys in terminal scrollback, notes, screenshots, or documentation.

## Manual smoke checklist

Use this checklist after the steps above:

- `npm run smoke:vscode-preview` passes after preparation without launching VS Code or using provider credentials.
- Engine binary exists at `apps/plugins/vscode/bin/yet-lsp` or at the configured absolute `yetai.engineBinaryPath`.
- `apps/gui/dist/index.html` exists after `npm run prepare:vscode-preview`.
- `apps/plugins/vscode/media/gui/index.html` exists after `npm run prepare:vscode-preview`.
- `Yet AI: Open Chat` opens the packaged GUI, not only the placeholder text.
- `Yet AI: Show Runtime Status` reports the loopback runtime URL, launch mode, engine binary status, and ping result without tokens or provider secrets.
- `Yet AI: Set Local Runtime Session Token` and `Yet AI: Clear Local Runtime Session Token` update VS Code SecretStorage without printing the raw token.
- The `Yet AI Runtime` output channel reports `Yet AI local runtime health check passed.`
- The GUI shows runtime status as connected/reachable.
- Provider save/test uses an OpenAI API key, OpenAI-compatible endpoint, or local gateway URL and does not require a Yet AI-hosted backend.
- Provider status after save is configured/redacted; the raw key is not rendered back into the form.
- A simple chat message produces `snapshot`, stream start/delta, and finish behavior in the GUI.
- For the real OpenAI API-key fallback smoke, the preset uses `https://api.openai.com/v1`, the API key field clears after save, and no automated test or committed file contains the real key.

## Refresh runtime and first message

In the packaged GUI, `Refresh runtime` checks `/v1/ping`, `/v1/caps`, `/v1/models`, provider summaries, and OpenAI provider-auth status through the local runtime. Connected feedback means the local runtime and provider/model metadata are reachable for current settings. Network/configuration errors usually point to the runtime URL, port, binary discovery, or process startup. Runtime `401` means the local Session token is wrong; provider `401` means the upstream OpenAI/OpenAI-compatible provider rejected the API key.

First-message smoke:

1. Prepare and open the VS Code dev preview.
2. Use `auto` or `launch` mode, or use manual `connect` mode with the `YET_AI_AUTH_TOKEN=local-dev-token` command above.
3. Click `Refresh runtime` and wait for connected feedback or a clear sanitized error.
4. Configure the `OpenAI API` API-key fallback or a local OpenAI-compatible mock/provider. Provider keys belong only in the GUI Provider setup API key field, are sent to the local runtime, and clear after save.
5. Send `Say hello in one sentence.` Expected behavior: the chat receives snapshot/start/delta/finish SSE updates and renders a short assistant response without any Yet AI hosted backend.

Use `Yet AI: Show Runtime Status` to write sanitized local runtime diagnostics to the `Yet AI Runtime` output channel when GUI feedback is not enough.

## Troubleshooting

- Missing Node dependencies: run `npm install` at the repository root, `apps/gui`, or `apps/plugins/vscode` if the corresponding command reports missing packages.
- Runtime token or runtime `401` errors: in `auto` or `launch` mode, do not manually set a token or paste `local-dev-token` into the GUI; the extension generates a token, passes it to the engine as `YET_AI_AUTH_TOKEN`, and sends it to the GUI through `host.ready` without persisting it. In `connect` mode, make sure the SecretStorage token set by `Yet AI: Set Local Runtime Session Token` matches the running engine's `YET_AI_AUTH_TOKEN`, for example `local-dev-token` only if you manually started the runtime with that value. If no SecretStorage token exists, the deprecated `yetai.sessionToken` setting is used as a dev-preview fallback and the output channel shows a sanitized warning. Restart the Extension Development Host after changing token-related settings.
- Provider `401` errors after the runtime is connected: the OpenAI-compatible provider rejected the API key. Check for a missing, expired, revoked, copied-with-whitespace, or wrong-project key. Paste it once in the GUI and save again; do not put it in VS Code settings or repository files.
- Provider `429` errors: the upstream provider reported rate, quota, or billing limits. Wait, reduce test traffic, or check the provider account outside Yet AI.
- Model errors: the selected model is unavailable for the key or endpoint. Update the provider model field to a chat model enabled for that account.
- OpenAI API fallback vs account login: the `OpenAI API` preset is the safe/default real-provider path. The experimental Codex-like OpenAI account action is separate, explicit-risk, private-endpoint-style, covered automatically only by loopback mocks, and not official public OpenAI OAuth support or production-ready. Any real account testing is manual, risky, account-specific, and outside CI. Browser session reuse, cookie import, browser profile import/reuse, direct reading of `~/.codex/auth.json`, and importing other tools' credential files are not allowed.
- Runtime port conflict: `yetai.runtimeUrl` defaults to `http://127.0.0.1:8001`. If another process owns that port, set `yetai.runtimeUrl` to another loopback port such as `http://127.0.0.1:8011` before opening chat. In launch mode the extension passes that port through `YET_AI_HTTP_PORT`.
- Missing `yet-lsp` binary: run `export PATH="$HOME/.cargo/bin:$PATH"; npm run prepare:vscode-preview` from the repository root. If discovery still fails, set `yetai.engineBinaryPath` to the absolute binary path and use `yetai.launchMode` `launch`.
- Packaged GUI not copied: run `npm run prepare:vscode-preview` from the repository root, or `npm run prepare:preview` from `apps/plugins/vscode` after building `apps/gui`. If the webview still shows the placeholder, check that `apps/plugins/vscode/media/gui/index.html` exists and reopen the command.
- GUI dev server URL blocked or blank: `yetai.guiDevUrl` must be a loopback `http` or `https` URL, such as `https://127.0.0.1:5173`. HTTPS loopback GUI dev URLs are supported by the webview CSP; non-loopback dev URLs are rejected.
- Provider base URL normalization: for OpenAI-compatible providers, `http://host/v1`, `http://host/v1/`, and an explicit `http://host/v1/chat/completions` are accepted. The engine appends `/chat/completions` when needed. Use absolute `http` or `https` URLs with a host and no `user:pass@host` userinfo.

## Extension surfaces

- Manifest identity is checked against `product/identity.json`.
- Command: `yetaicmd.openChat` (`Yet AI: Open Chat`).
- Command: `yetaicmd.showRuntimeStatus` (`Yet AI: Show Runtime Status`).
- Command: `yetaicmd.setLocalRuntimeSessionToken` (`Yet AI: Set Local Runtime Session Token`).
- Command: `yetaicmd.clearLocalRuntimeSessionToken` (`Yet AI: Clear Local Runtime Session Token`).
- Activity bar container id: `yet-ai-toolbox-pane`.
- Settings:
  - `yetai.runtimeUrl`, default `http://127.0.0.1:8001`.
  - `yetai.sessionToken`, deprecated dev-preview fallback local runtime bearer/session token for debug connections. Use `Yet AI: Set Local Runtime Session Token` instead.
  - `yetai.guiDevUrl`, optional loopback GUI dev server URL.
  - `yetai.launchMode`, one of `auto`, `connect`, or `launch`.
  - `yetai.engineBinaryPath`, optional absolute path to `yet-lsp`.

`runtimeUrl` and `guiDevUrl` are restricted to loopback `http` or `https` URLs before the webview opens. The manual local runtime `sessionToken` is a sensitive local runtime credential, not a provider secret. It is stored in VS Code SecretStorage through the command palette, passed only in the bootstrap/`host.ready` path needed by the trusted GUI runtime client, is not logged, and is not rendered in the placeholder UI. The legacy `yetai.sessionToken` setting remains a deprecated dev-preview fallback only when SecretStorage has no token; raw provider secrets must never be stored in extension settings or SecretStorage by this plugin.

## Runtime connection and launch

The extension supports two runtime workflows:

- Debug connect mode: set `yetai.launchMode` to `connect`, set `yetai.runtimeUrl` to an already running loopback engine, and run `Yet AI: Set Local Runtime Session Token` with that engine's local bearer token when required. The extension validates the URL and checks `GET /v1/ping` before opening the webview. SecretStorage tokens take priority over the deprecated `yetai.sessionToken` fallback setting.
- Local launch mode: set `yetai.launchMode` to `launch` and configure `yetai.engineBinaryPath` with an absolute path to `yet-lsp`. The extension starts the process, generates a per-session token, passes it in `YET_AI_AUTH_TOKEN`, passes the port from `yetai.runtimeUrl` in `YET_AI_HTTP_PORT`, checks `GET /v1/ping`, and stops the launched process on extension deactivate.

The default `auto` mode launches a configured or discoverable `yet-lsp` binary when available; otherwise it behaves like debug connect mode. Discovery checks packaged `bin/` locations, repository `target/debug` and `target/release`, then `PATH`.

Basic engine stdout/stderr lines are captured in the `Yet AI Runtime` output channel. The generated session token and bearer headers are redacted before logging. `Yet AI: Show Runtime Status` uses only local settings, binary discovery, and `/v1/ping`; it does not call model providers or provider-auth endpoints. Provider configuration and provider secrets remain engine-owned and are not stored or logged by the extension.

Manual local preview:

1. Build and copy GUI assets with the commands above.
2. Set `yetai.launchMode` to `launch` or `auto` and set `yetai.engineBinaryPath` to an absolute `yet-lsp` binary path, or set `yetai.launchMode` to `connect` for an already running loopback engine.
3. Run `Yet AI: Open Chat`.

## Webview and bridge

The command opens a minimal Yet AI webview shell. If `yetai.guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it first looks for packaged GUI assets at `media/gui/index.html`; when those generated assets are absent, it displays a local placeholder with the configured runtime URL.

The wrapper sends strict `gui.ready` with a bounded request id and `supportedBridgeVersion` payload. The extension accepts only exact-version `gui.ready` messages with no unknown top-level or payload fields, rejects unknown or invalid messages without logging payloads, and replies with `host.ready` echoing the request id when present. It also sends `host.openedFromCommand` with an empty payload. Bootstrap data is serialized for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout, and local runtime Session tokens are delivered only through the trusted `host.ready` message path rather than inline HTML.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

No privileged workspace edits, IDE tools, or provider actions are implemented in this shell.

## Current limitations

- The extension shell is a dev-preview MVP, not production-ready.
- No marketplace packaging, signed/notarized engine bundle, or production installer is complete.
- Runtime health recovery after a crashed launched process is limited to retrying the command.
- Packaged GUI assets are supported through the documented `npm run prepare:vscode-preview` flow, but generated assets are not committed and this is not a final release packaging flow.
- No LSP client, completions, tools, privileged workspace edits, IDE tools, file mutation, shell actions, or provider actions are implemented.
- Current chat support is limited to the local provider/chat MVP exposed by the engine and GUI.
- Legacy `yetai.sessionToken` remains only as a deprecated dev-preview fallback for existing local setups.

## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch, require the exact bridge version, and keep the accepted GUI message allowlist narrow.
- Use exact dev iframe target origins and check inbound iframe origins before forwarding.
- Never log bridge payloads that may contain local runtime credentials.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
