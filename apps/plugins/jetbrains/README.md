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

The dev-preview packaged flow builds the GUI, copies generated assets into the JetBrains plugin resources, and verifies the installable ZIP plus browser-rendered wrapper paths before manual IDE testing.

### Installable ZIP dev preview

From the repository root, build the local engine, GUI, and JetBrains installable ZIP with one command:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:jetbrains-preview
```

The helper reuses `prepare:ide-engine`, runs the GUI build, and invokes `gradle buildPlugin --console=plain` in `apps/plugins/jetbrains`. It prints every original Gradle ZIP found under `apps/plugins/jetbrains/build/distributions/`, then overwrites the current stable ignored root artifact at `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` with a matching `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip.sha256` checksum. It also prints the local `Engine binary path` to use if the plugin does not discover `yet-lsp` from `PATH`. If `gradle` is not installed, install Gradle or add a reviewed project wrapper later; this repository does not vendor a Gradle wrapper for the preview path. If Gradle fails while resolving JetBrains dependencies such as `java-compiler-ant-tasks` through JetBrains cache endpoints or during `instrumentCode`, treat it as an external Gradle dependency/network failure: retry with a stable network, verify Gradle can resolve JetBrains dependencies, and use cached/offline Gradle only after those dependencies are already present locally.

Manual IntelliJ IDEA install-from-disk steps:

1. Run `npm run prepare:jetbrains-preview` from the repository root.
2. Open IntelliJ IDEA Settings/Preferences → Plugins → gear → Install Plugin from Disk.
3. Choose the stable root ZIP path `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` printed by the preparation command. The Gradle ZIP path under `apps/plugins/jetbrains/build/distributions/` remains useful for diagnostics.
4. Restart the IDE when prompted.
5. Open Yet AI settings and keep `Launch mode` as `auto`, or set it to `launch`; set `Engine binary path` to the printed `target/debug/yet-lsp` path if discovery from `PATH` is not enough. Use `connect` only for an already running loopback runtime.
6. Open the Yet AI tool window and verify that the packaged GUI loads.
7. Optional safe real-provider smoke: configure the OpenAI API-key fallback in the GUI, confirm the key field clears after save, then send a short chat prompt. The experimental OpenAI account path remains explicit-risk, mock-covered in automation, and any real account test is manual/high-risk/outside CI.

Installed IDEA first-message checklist:

1. Run the preflight commands from the repository root: `npm run prepare:jetbrains-preview`, `npm run smoke:jetbrains-installable`, `npm run smoke:jetbrains-gui-browser`, and `npm run smoke:jetbrains-first-message`. Use `npm run smoke:ide-preview` when validating both IDEs together.
2. Install the stable root ZIP through Install Plugin from Disk, restart IntelliJ IDEA, and keep `Launch mode` as `auto` or `launch` for the normal plugin-launched runtime path.
3. Do not manually start `yet-lsp` and do not paste `local-dev-token` for the normal path. Set `Engine binary path` only if discovery from `PATH` fails.
4. Run `Yet AI: Open Chat`, verify the packaged GUI loads, click `Refresh runtime`, and confirm the GUI reports connected or shows only sanitized actionable errors.
5. Run Tools → `Yet AI: Show Runtime Status` and confirm it contains only sanitized URL, launch, binary, process, and ping diagnostics without session tokens, bearer headers, provider API keys, auth codes, cookies, or raw process output.
6. If the GUI shows a JetBrains active editor/selection context preview, review the source host, path, language/range metadata, selected character count, and bounded preview. Keep `Attach to next message` enabled only when the selected text is safe to send to the configured provider, or choose `Do not attach` before sending.
7. For safe real-provider testing, paste an OpenAI API key manually only in the GUI Provider setup API-key field, save, verify the field clears, run provider test/status, send `Say hello in one sentence.`, verify streaming response plus local engine-owned history reload when practical, and record only sanitized success or failure outcomes.
8. Test the experimental account-login path only when explicitly accepted for that manual run. Do not capture or store authorization URLs containing codes, auth codes, tokens, cookies, PKCE verifier values, or screenshots with secrets. Exchange any code manually only inside the GUI/runtime flow, send a first message only after connected status, disconnect after the test, and record only sanitized status labels, redacted account hints, and non-secret error text.

For the normal plugin-launched path, do not paste `local-dev-token` into the GUI. Keep `Launch mode` as `auto` or `launch`; the plugin generates the local runtime session token, starts `yet-lsp` with it, stores debug tokens only in PasswordSafe when configured, and sends the active token to the GUI through trusted `host.ready`. Configure `Engine binary path = /absolute/path/to/target/debug/yet-lsp` only when discovery from `PATH` is insufficient.

Use `local-dev-token` only for manual `connect` mode with a runtime you started yourself:

```sh
YET_AI_AUTH_TOKEN=local-dev-token YET_AI_HTTP_PORT=8001 cargo run -p yet-lsp
```

Then set JetBrains `Launch mode = connect`, `runtimeUrl = http://127.0.0.1:8001`, and the local session token to `local-dev-token`. This token is only the local runtime bearer token; it is not an OpenAI API key or provider key.

Verify the installable artifact without launching IntelliJ IDEA with the canonical preflight sequence:

```sh
npm run prepare:jetbrains-preview
npm run smoke:jetbrains-installable
npm run smoke:jetbrains-gui-browser
npm run smoke:jetbrains-first-message
```

When a change should validate both IDE preview routes, use the root cross-IDE gate:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run smoke:ide-preview
```

It runs `npm run prepare:vscode-preview`, `npm run smoke:vscode-installable`, `npm run smoke:vscode-preview`, `npm run smoke:vscode-first-message`, `npm run prepare:jetbrains-preview`, `npm run smoke:jetbrains-installable`, `npm run smoke:jetbrains-preview`, `npm run smoke:jetbrains-gui-browser`, and `npm run smoke:jetbrains-first-message` in order. It validates ignored local preview artifacts and loopback first-message paths without launching VS Code, IntelliJ IDEA, JCEF automation, real provider calls, hosted Yet AI services, signing, marketplace publication, or production installers.

Run the JetBrains first-message smoke directly when changing only the JetBrains packaged GUI or wrapper bridge path:

```sh
npm run smoke:jetbrains-first-message
```

It delegates to the wrapper browser first-message coverage and uses loopback mocks only. It must not use real provider credentials, call OpenAI/ChatGPT, or contact hosted Yet AI services.

The installable smoke checks that a Gradle distribution ZIP exists, that exactly one stable root `dist/plugins/jetbrains/` dev-preview ZIP and matching `.sha256` checksum exist, that the ZIP and nested plugin JAR use safe archive paths, that the root ZIP is not obviously older than source build inputs or the Gradle distribution ZIP, that the ZIP contains `META-INF/plugin.xml` and packaged GUI `yet-ai-gui/index.html` plus referenced JavaScript assets, and that docs describe Install Plugin from Disk plus `Engine binary path` expectations. The generated-resource preview smoke fails when `apps/gui/dist/index.html` is newer than `apps/plugins/jetbrains/build/generated/resources/yet-ai-gui/yet-ai-gui/index.html`; rerun `npm run prepare:jetbrains-preview` after rebuilding GUI assets. The packaged GUI browser smoke extracts `yet-ai-gui/index.html` and `yet-ai-gui/assets/*` from the ZIP's nested plugin JAR into a temporary local directory, serves it on loopback, and verifies that the core GUI renders non-blank with working JavaScript and CSS assets. If the ZIP is missing or stale, run `npm run prepare:jetbrains-preview` first. The wrapper browser smoke serves the current built `apps/gui/dist` on loopback, opens a generated JetBrains-like wrapper on a separate loopback origin, embeds the GUI iframe with the exact target origin, installs a fake `window.postIntellijMessage` collector, serves a token-protected mock local runtime on loopback, and verifies non-blank iframe rendering, real iframe-origin `gui.ready` / `host.ready` bridge delivery with wrapper-owned generation/sequence nonce authorization, fail-closed dropping of unready or nonce-stale host messages across reloads, rejection of arbitrary wrapper-origin host `postMessage` relays, connected experimental OpenAI account readiness, JetBrains-style `host.contextSnapshot` active editor/selection preview, default include toggle behavior, disabled-toggle omission, enabled context delivery to `user_message.payload.context`, first-message send/streamed response, and no raw runtime token, OAuth, cookie, API-key, or active-context sentinels in browser-visible state. No provider credentials, real OpenAI/ChatGPT calls, JetBrains IDE launch, JCEF automation, or hosted Yet AI services are required.

The browser smokes catch broken packaged GUI resources and wrapper/iframe bridge regressions before manual IDE install testing, but they complement rather than replace manual JetBrains/JCEF testing because browser rendering is not identical to the installed IDE tool window.

This is dev-preview/manual installability only: no signing, marketplace publication, production installer, bundled notarized engine, or official release packaging is produced.

Build the GUI first, then build the plugin:

```sh
cd apps/gui
npm run build
cd ../plugins/jetbrains
gradle build --console=plain
```

The Gradle build copies `apps/gui/dist` into generated plugin resources under `build/generated/resources/yet-ai-gui/yet-ai-gui`. Generated GUI assets are not committed. If `apps/gui/dist/index.html` is absent, the build still succeeds and the tool window uses the placeholder shell unless `guiDevUrl` is configured.

At runtime the JCEF host prefers `guiDevUrl` when configured. Otherwise it starts a plugin-owned static HTTP server bound to `127.0.0.1` on an ephemeral port, serves packaged `/yet-ai-gui/index.html` and `/yet-ai-gui/assets/*` from plugin resources as `/index.html` and `/assets/*`, and embeds `http://127.0.0.1:<port>/index.html` with the exact loopback origin. This replaces direct `jar:file:` iframe loading in installed IDEs, keeps the GUI on a normal local HTTP origin for JCEF asset loading, and falls back to the local placeholder if packaged resources are absent. The static server is separate from the engine runtime and serves only generated GUI files, never provider secrets.

## Local engine binary for dev previews

Prepare the local engine binary from the repository root before launching a JetBrains plugin dev preview:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:ide-engine
```

The helper reads `yet-lsp` from `product/identity.json`, runs `cargo build -p yet-lsp`, copies a VS Code dev binary for that host, and prints the JetBrains `Engine binary path` value pointing at `target/debug/yet-lsp`. Use `npm run prepare:ide-engine -- --release` when testing `target/release/yet-lsp`, or `-- --no-build` after manually running Cargo.

For first run, keep `Launch mode` as `auto` and either paste the printed absolute `Engine binary path` in the Yet AI settings page or start the IDE with `target/debug` on `PATH` as printed by the helper. Generated binaries under `target/` and the VS Code `bin/` copy are ignored and must not be committed. The helper is intended for macOS/Linux dev previews. Windows is not verified yet; if needed, use the printed absolute `.exe` path.

Repository-level validation is available from the root:

```sh
npm run check
```

## Dev-preview smoke

From the repository root, run the JetBrains preview readiness smoke after preparing the local engine binary:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:ide-engine
npm run smoke:jetbrains-preview
```

The smoke is local and deterministic. It checks the JetBrains plugin project files, identity-aligned plugin configuration, `target/debug/yet-lsp`, GUI source build output under `apps/gui/dist`, and generated Gradle GUI resources when present. It does not launch a JetBrains IDE, require provider credentials, call OpenAI, or contact hosted Yet AI services.

For a full packaged-GUI readiness check, build the GUI and run the JetBrains Gradle build first:

```sh
cd apps/gui && npm run build
cd ../plugins/jetbrains && gradle build --console=plain
cd ../../..
npm run smoke:jetbrains-preview
```

If `apps/gui/dist/index.html` or generated resources are missing, the smoke prints the exact prerequisite command to run. Generated binaries and Gradle output remain ignored and must not be committed.

Required verification for this package:

```sh
cd apps/plugins/jetbrains && node scripts/check-identity.mjs && gradle build --console=plain && cd ../../.. && export PATH="$HOME/.cargo/bin:$PATH"; cargo check && cargo test && npm run check
```

If Gradle is not installed locally, run the identity check and root validation, then install Gradle or add a reviewed Gradle wrapper before packaging work. This shell intentionally avoids vendoring a wrapper jar in the first scaffold.

## Plugin surfaces

- Plugin id: `ai.yet.plugin`.
- Plugin group/vendor: `ai.yet`.
- Plugin name: `Yet AI`.
- Kotlin package namespace: `ai.yet.plugin`.
- Tool window: `Yet AI`.
- Actions:
  - `ai.yet.plugin.OpenChat` (`Yet AI: Open Chat`).
  - `ai.yet.plugin.ShowRuntimeStatus` (`Yet AI: Show Runtime Status`).
  - `ai.yet.plugin.RestartRuntime` (`Yet AI: Restart Runtime`).
- Settings:
  - `runtimeUrl`, default `http://127.0.0.1:8001`.
  - `launchMode`, one of `auto`, `connect`, or `launch`.
  - `engineBinaryPath`, optional absolute path to the `yet-lsp` binary.
  - `sessionToken`, optional local runtime bearer/session token for debug connections.
  - `guiDevUrl`, optional loopback GUI dev server URL.

`runtimeUrl` and `guiDevUrl` are trimmed, parsed as absolute URIs, and restricted to loopback `http` or `https` URLs before use. Userinfo, missing hosts, malformed values, non-loopback hosts, and non-HTTP schemes are rejected. Only `127.0.0.1`, `localhost`, and IPv6 loopback `[::1]` are allowed, and IPv6 origins are emitted with brackets. `launchMode` is restricted to `auto`, `connect`, or `launch`; `engineBinaryPath` is non-secret local machine configuration stored in settings XML.

`sessionToken` is a sensitive local runtime credential, not a provider secret. It is stored with JetBrains PasswordSafe instead of the persistent settings XML, passed only through the trusted bootstrap/`host.ready` path needed by the GUI runtime client, never logged, and never rendered in the placeholder UI. Raw provider secrets must never be stored in JetBrains plugin settings.

## Webview and bridge

The tool window uses JCEF when available. If `guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it reuses the packaged GUI loopback server and embeds `http://127.0.0.1:<port>/index.html`, then falls back to a local placeholder with the configured runtime URL when resources are missing. The wrapper is rendered before runtime preparation starts and shows a non-secret connecting/loading line with the packaged GUI URL/origin plus a visible timeout fallback if the iframe does not load, so an installed plugin should not fail as a blank panel or wait for the runtime health-check loop on the tool-window UI path. Runtime prepare and `/v1/ping` health checks run on a background application thread; completion or sanitized failure diagnostics are delivered to the GUI through the private wrapper host-send function only after the current iframe sends a valid `gui.ready`. Pre-wrapper non-secret diagnostics may be held for the current setup path, but host messages sent while the iframe is unready, for an old frame generation, or with a nonce-stale delivery are fail-closed and dropped rather than replayed into a later frame. The browser panel registers disposal with the tool-window content, skips async JavaScript delivery after disposal, and disposes the JCEF query/browser when the content is disposed.

The wrapper exposes `window.postIntellijMessage` only for real iframe-origin `gui.ready` messages. It does not emit wrapper-origin fake `gui.ready` messages. The Kotlin host parses bridge input as JSON, accepts only JSON objects with the exact bridge version and `type: "gui.ready"`, validates optional request ids as short non-empty strings without control characters, requires optional payloads to be JSON objects, rejects arrays/scalars/null/malformed JSON/unknown types without logging payloads, and replies with `host.ready` using the wrapper-owned generation/sequence request id for the accepted current frame. GUI-supplied request ids are diagnostic only and are not authoritative for host delivery. It also sends `host.openedFromCommand`. Host messages are built as structured JSON objects and delivered to the iframe through the wrapper-private `window.__yetAiSendHostMessageToFrame` function, not through a public `window.postMessage` host relay. Bootstrap `host.ready` uses a wrapper-generated request id only for initial runtime settings delivery. Bootstrap JSON is escaped for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

The runtime connector supports debug connect mode and local launch mode. In `connect` mode it validates the loopback `runtimeUrl`, reads the optional debug token from PasswordSafe, skips engine binary discovery/validation entirely, and checks `GET /v1/ping` with the bearer token when present. In `launch` mode, or `auto` mode when a `yet-lsp` binary is discoverable, it starts the binary with a generated per-session token in `YET_AI_AUTH_TOKEN` and the configured explicit runtime port in `YET_AI_HTTP_PORT`, then checks `/v1/ping`. Launch command construction requires `http` with an explicit nonzero port such as `http://127.0.0.1:8001`; it rejects missing ports, port `0`, and `https` because the launcher only passes `YET_AI_HTTP_PORT`. If settings parse succeeds but launch or health checks fail, the GUI keeps the configured runtime URL and receives sanitized diagnostics instead of being retargeted to the fallback URL. Launched runtime stdout/stderr lines and runtime failure diagnostics are sanitized before IDE display/logging: generated session tokens, bearer/authorization headers, env-style and URL/query-style API key/OAuth/session-token/client-secret names, cookies, verifier fields, JSON-style secret fields, JWT-like/long opaque tokens, and full absolute/bare/relative `auth.json` credential-file paths are redacted and long lines are truncated. Launched processes are stopped when the application service is disposed by calling `destroy()`, waiting briefly, and escalating to `destroyForcibly()` if needed. The connector may discover `yet-lsp` on `PATH`; an explicit `engineBinaryPath` must be absolute and point to an executable file where the platform supports executability checks when launch or auto-launch uses it.

Manual local preview:

1. Build the GUI and plugin with the packaged GUI flow above.
2. Set `launchMode` to `launch` or `auto` and set `engineBinaryPath` to an absolute `yet-lsp` binary path, or set `launchMode` to `connect` for an already running loopback engine.
3. Open the Yet AI tool window or run `Yet AI: Open Chat`.
4. Click `Refresh runtime` in the GUI. It checks `/v1/ping`, `/v1/caps`, `/v1/models`, provider summaries, and OpenAI provider-auth status through the local runtime.
5. Configure either the `OpenAI API` API-key fallback or a local OpenAI-compatible mock/provider. The OpenAI/provider key belongs only in the Provider setup API key field, is sent to the local runtime, and is cleared after save; never put it in the Session token setting.
6. If the GUI shows an active editor/selection context preview, include it only when the content is safe to send to the configured provider. JetBrains uses the same strict `host.contextSnapshot` active context contract as VS Code, and included context is prompt-only, bounded, non-privileged, and one-shot for the next accepted message.
7. Send `Say hello in one sentence.` Expected behavior: chat accepts the message, optional included context is prepended by the local runtime, the GUI clears accepted active context, and snapshot/start/delta/finish updates stream without a Yet AI hosted backend.

No autonomous file reads/indexing, privileged workspace edits, IDE tools, shell/tool execution, provider adapters, or provider credential persistence are implemented in this shell.

Current GUI-to-host receive policy is deny-by-default. The Kotlin/JCEF bridge accepts only strict `gui.ready` from the GUI. Future GUI messages `gui.openFile`, `gui.revealRange`, `gui.applyWorkspaceEditRequest`, `gui.executeIdeTool`, `gui.copyText`, `gui.showNotification`, and `gui.getHostContext` are not allowlisted and must not call IntelliJ platform APIs. Enabling any privileged message later requires strict schemas, request/response correlation, exact iframe origin/source checks where available, user confirmation for risky operations, sanitized audit/logging, least-privilege allowlists, and no silent workspace mutation. Tools, tasks, knowledge, shell execution, file edits/apply patch, autonomous indexing, and background autonomy remain disabled in this milestone.

## Runtime diagnostics and restart

Use the GUI `Refresh runtime` button first for normal troubleshooting. It checks `/v1/ping`, `/v1/caps`, `/v1/models`, provider summaries, and OpenAI provider-auth status through the local runtime. Connected feedback means the local runtime and provider/model metadata are reachable enough for the current settings. Network/configuration failures usually point to URL, port, launch mode, binary path, or runtime startup issues. Runtime `401` means the local Session token does not match the runtime's `YET_AI_AUTH_TOKEN`; provider `401` after runtime connection means the upstream provider rejected the OpenAI/OpenAI-compatible API key.

Use Tools → `Yet AI: Show Runtime Status` when the tool window cannot connect, the packaged GUI reports runtime failures, or before filing a manual reinstall report. The status dialog is sanitized and includes the launch mode, loopback runtime URL without userinfo/query/hash, whether an engine binary path is configured, configured/discovered binary status, whether the plugin currently owns a launched process, the last `/v1/ping` health result or sanitized connection error, and mode-specific guidance for `auto`, `launch`, or `connect`.

Use Tools → `Yet AI: Restart Runtime` to stop only the process launched by this plugin and prepare the current settings again. It does not stop externally managed runtimes used in `connect` mode, does not inspect provider configuration, and does not expose the local runtime session token. If restart reports a missing binary, invalid configured path, port conflict, runtime-down health failure, or 401/token mismatch, copy the sanitized status text and verify the settings above before reinstalling the ZIP.

Diagnostics and restart output must not include session tokens, bearer/authorization headers, raw bridge payloads, provider API keys, environment dumps, provider tokens, or raw process output containing secrets. Runtime process logs and connection failures are redacted before IDE display/logging.

## Manual preview report template

Use this template for hands-on JetBrains dev-preview issues. Keep reports safe to share and include only sanitized runtime/provider evidence.

```text
JetBrains preview report

Environment:
- OS/architecture:
- IntelliJ IDEA version:
- ZIP path family: dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip
- ZIP checksum: present and matched | missing | not checked
- Install path: Install Plugin from Disk | Gradle run/debug | not installed
- Launch mode: auto | launch | connect
- Engine binary: discovered | configured absolute path | missing | not checked
- Runtime URL: http://127.0.0.1:<port> (omit query/hash)
- GUI mode: packaged GUI | guiDevUrl loopback

Commands run:
- npm run prepare:jetbrains-preview: pass | fail
- npm run smoke:jetbrains-installable: pass | fail | not run
- npm run smoke:jetbrains-preview: pass | fail | not run
- npm run smoke:jetbrains-gui-browser: pass | fail | not run
- npm run smoke:jetbrains-wrapper-browser: pass | fail | not run
- npm run smoke:jetbrains-first-message: pass | fail | not run
- npm run smoke:ide-preview: pass | fail | not run
- Yet AI: Open Chat/tool window: pass | fail
- Tools → Yet AI: Show Runtime Status: not run | pass | sanitized failure
- Tools → Yet AI: Restart Runtime: not run | pass | sanitized failure

Visible results:
- Tool window: packaged GUI | placeholder | blank/error
- Runtime refresh: connected | sanitized failure
- Runtime diagnostics: sanitized pass | sanitized failure | not checked
- Provider path: OpenAI API-key fallback | local OpenAI-compatible mock | experimental account-login
- Provider setup/test: visible | not visible | sanitized failure
- Provider secret handling: key field cleared | not checked | sanitized issue
- Active context preview: not shown | shown and attached | shown and omitted
- First chat message: streamed | accepted but no stream | failed with sanitized error
- Local history: reloaded | not checked | sanitized failure

Notes:
- Include concise sanitized error text only.
- Mention only artifact path families, not private absolute paths.
- Never paste provider API keys, local runtime session tokens, bearer headers, Authorization values, OAuth auth codes, access tokens, refresh tokens, cookies, PKCE verifiers, query values, fragment values, private absolute paths, raw provider responses, raw bridge payloads, request bodies, browser storage dumps, or screenshots showing secrets.
```

## Current limitations

- The plugin shell is a dev-preview MVP, not production-ready.
- No marketplace packaging, signed/notarized engine bundle, or production installer is complete.
- The local launcher is an MVP: it sets token and HTTP port environment variables only, reads `/v1/ping`, and does not add LSP/completion wiring.
- The bridge currently accepts only `gui.ready` from the GUI and emits `host.ready`, `host.openedFromCommand`, and non-privileged active editor/selection `host.contextSnapshot` messages.
- Settings use JetBrains application state for non-secret local runtime/debug URLs only. The local session token uses JetBrains PasswordSafe.
- Packaged GUI assets are generated build output from `apps/gui/dist`; they are copied into Gradle build resources but are not committed and this is not a final release packaging flow.
- No LSP client, completions, tools, privileged workspace edits, IDE tools, file mutation, shell actions, or provider actions are implemented.
- Current chat support is limited to the local provider/chat MVP exposed by the engine and GUI.

## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch, require the exact bridge version, and keep the accepted GUI message allowlist narrow.
- Use exact dev iframe target origins and check inbound iframe origins before forwarding.
- Never log bridge payloads that may contain local runtime credentials.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
