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

The helper reuses `prepare:ide-engine`, runs the GUI build, and invokes `gradle buildPlugin --console=plain` in `apps/plugins/jetbrains`. It prints every ZIP found under `apps/plugins/jetbrains/build/distributions/`, plus the local `Engine binary path` to use if the plugin does not discover `yet-lsp` from `PATH`. If `gradle` is not installed, install Gradle or add a reviewed project wrapper later; this repository does not vendor a Gradle wrapper for the preview path.

Manual IntelliJ IDEA install-from-disk steps:

1. Run `npm run prepare:jetbrains-preview` from the repository root.
2. Open IntelliJ IDEA Settings/Preferences → Plugins → gear → Install Plugin from Disk.
3. Choose the ZIP path printed by the preparation command.
4. Restart the IDE when prompted.
5. Open Yet AI settings and keep `Launch mode` as `auto`, or set it to `launch`; set `Engine binary path` to the printed `target/debug/yet-lsp` path if discovery from `PATH` is not enough. Use `connect` only for an already running loopback runtime.
6. Open the Yet AI tool window and verify that the packaged GUI loads.
7. Optional safe real-provider smoke: configure the OpenAI API-key fallback in the GUI, confirm the key field clears after save, then send a short chat prompt. The experimental OpenAI account path remains explicit-risk, mock-covered in automation, and any real account test is manual/high-risk/outside CI.

Verify the installable artifact without launching IntelliJ IDEA:

```sh
npm run smoke:jetbrains-installable
npm run smoke:jetbrains-gui-browser
npm run smoke:jetbrains-wrapper-browser
```

The installable smoke checks that a distribution ZIP exists, contains `META-INF/plugin.xml` and packaged GUI `yet-ai-gui/index.html`, and that docs describe Install Plugin from Disk plus `Engine binary path` expectations. The packaged GUI browser smoke extracts `yet-ai-gui/index.html` and `yet-ai-gui/assets/*` from the ZIP's nested plugin JAR into a temporary local directory, serves it on loopback, and verifies that the core GUI renders non-blank with working JavaScript and CSS assets. If the ZIP is missing, run `npm run prepare:jetbrains-preview` first. The wrapper browser smoke serves the current built `apps/gui/dist` on loopback, opens a generated JetBrains-like wrapper on a separate loopback origin, embeds the GUI iframe with the exact target origin, installs a fake `window.postIntellijMessage` collector, and verifies non-blank iframe rendering, pre-init queued host-message/diagnostic adoption and flush, real iframe-origin `gui.ready` / `host.ready` bridge delivery, and rejection of arbitrary wrapper-origin host `postMessage` relays. No provider credentials, real OpenAI/ChatGPT calls, JetBrains IDE launch, JCEF automation, or hosted Yet AI services are required.

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
- Action: `ai.yet.plugin.OpenChat` (`Yet AI: Open Chat`).
- Settings:
  - `runtimeUrl`, default `http://127.0.0.1:8001`.
  - `launchMode`, one of `auto`, `connect`, or `launch`.
  - `engineBinaryPath`, optional absolute path to the `yet-lsp` binary.
  - `sessionToken`, optional local runtime bearer/session token for debug connections.
  - `guiDevUrl`, optional loopback GUI dev server URL.

`runtimeUrl` and `guiDevUrl` are trimmed, parsed as absolute URIs, and restricted to loopback `http` or `https` URLs before use. Userinfo, missing hosts, malformed values, non-loopback hosts, and non-HTTP schemes are rejected. Only `127.0.0.1`, `localhost`, and IPv6 loopback `[::1]` are allowed, and IPv6 origins are emitted with brackets. `launchMode` is restricted to `auto`, `connect`, or `launch`; `engineBinaryPath` is non-secret local machine configuration stored in settings XML.

`sessionToken` is a sensitive local runtime credential, not a provider secret. It is stored with JetBrains PasswordSafe instead of the persistent settings XML, passed only through the trusted bootstrap/`host.ready` path needed by the GUI runtime client, never logged, and never rendered in the placeholder UI. Raw provider secrets must never be stored in JetBrains plugin settings.

## Webview and bridge

The tool window uses JCEF when available. If `guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it reuses the packaged GUI loopback server and embeds `http://127.0.0.1:<port>/index.html`, then falls back to a local placeholder with the configured runtime URL when resources are missing. The wrapper is rendered before runtime preparation starts and shows a non-secret connecting/loading line with the packaged GUI URL/origin plus a visible timeout fallback if the iframe does not load, so an installed plugin should not fail as a blank panel or wait for the runtime health-check loop on the tool-window UI path. Runtime prepare and `/v1/ping` health checks run on a background application thread; completion or sanitized failure diagnostics are delivered to the GUI through the private wrapper host-send function. Host messages and diagnostics generated before the iframe wrapper is ready are queued in the wrapper and flushed when the frame loads or sends `gui.ready`, rather than being dropped. The browser panel registers disposal with the tool-window content, skips async JavaScript delivery after disposal, and disposes the JCEF query/browser when the content is disposed.

The wrapper exposes `window.postIntellijMessage` only for real iframe-origin `gui.ready` messages. It does not emit wrapper-origin fake `gui.ready` messages. The Kotlin host parses bridge input as JSON, accepts only JSON objects with the exact bridge version and `type: "gui.ready"`, validates optional request ids as short non-empty strings without control characters, requires optional payloads to be JSON objects, rejects arrays/scalars/null/malformed JSON/unknown types without logging payloads, and replies with `host.ready` echoing the request id when present. It also sends `host.openedFromCommand`. Host messages are built as structured JSON objects and delivered to the iframe through the wrapper-private `window.__yetAiSendHostMessageToFrame` function, not through a public `window.postMessage` host relay. Bootstrap `host.ready` uses a wrapper-generated request id only for initial runtime settings delivery. Bootstrap JSON is escaped for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

The runtime connector supports debug connect mode and local launch mode. In `connect` mode it validates the loopback `runtimeUrl`, reads the optional debug token from PasswordSafe, skips engine binary discovery/validation entirely, and checks `GET /v1/ping` with the bearer token when present. In `launch` mode, or `auto` mode when a `yet-lsp` binary is discoverable, it starts the binary with a generated per-session token in `YET_AI_AUTH_TOKEN` and the configured explicit runtime port in `YET_AI_HTTP_PORT`, then checks `/v1/ping`. Launch command construction requires `http` with an explicit nonzero port such as `http://127.0.0.1:8001`; it rejects missing ports, port `0`, and `https` because the launcher only passes `YET_AI_HTTP_PORT`. If settings parse succeeds but launch or health checks fail, the GUI keeps the configured runtime URL and receives sanitized diagnostics instead of being retargeted to the fallback URL. Launched runtime stdout/stderr lines and runtime failure diagnostics are sanitized before IDE display/logging: generated session tokens, bearer/authorization headers, env-style and URL/query-style API key/OAuth/session-token/client-secret names, cookies, verifier fields, JSON-style secret fields, JWT-like/long opaque tokens, and full absolute/bare/relative `auth.json` credential-file paths are redacted and long lines are truncated. Launched processes are stopped when the application service is disposed by calling `destroy()`, waiting briefly, and escalating to `destroyForcibly()` if needed. The connector may discover `yet-lsp` on `PATH`; an explicit `engineBinaryPath` must be absolute and point to an executable file where the platform supports executability checks when launch or auto-launch uses it.

Manual local preview:

1. Build the GUI and plugin with the packaged GUI flow above.
2. Set `launchMode` to `launch` or `auto` and set `engineBinaryPath` to an absolute `yet-lsp` binary path, or set `launchMode` to `connect` for an already running loopback engine.
3. Open the Yet AI tool window or run `Yet AI: Open Chat`.

No privileged workspace edits, IDE tools, provider adapters, or provider credential persistence are implemented in this shell.

## Current limitations

- The plugin shell is a dev-preview MVP, not production-ready.
- No marketplace packaging, signed/notarized engine bundle, or production installer is complete.
- The local launcher is an MVP: it sets token and HTTP port environment variables only, reads `/v1/ping`, and does not add LSP/completion wiring.
- The bridge currently accepts only `gui.ready` from the GUI and emits `host.ready` plus `host.openedFromCommand`.
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
