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

## Installable ZIP dev preview

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
```

The installable smoke checks that a distribution ZIP exists, contains `META-INF/plugin.xml` and packaged GUI `yet-ai-gui/index.html`, and that docs describe Install Plugin from Disk plus `Engine binary path` expectations. The packaged GUI browser smoke extracts `yet-ai-gui/index.html` and `yet-ai-gui/assets/*` from the ZIP's nested plugin JAR into a temporary local directory, serves it on loopback, and verifies that the core GUI renders non-blank with working JavaScript and CSS assets. If the ZIP is missing, run `npm run prepare:jetbrains-preview` first. No provider credentials, real OpenAI/ChatGPT calls, JetBrains IDE launch, JCEF automation, or hosted Yet AI services are required.

The browser smoke catches broken packaged GUI resources before manual IDE install testing, but it complements rather than replaces manual JetBrains/JCEF testing because browser rendering is not identical to the installed IDE tool window.

This is dev-preview/manual installability only: no signing, marketplace publication, production installer, bundled notarized engine, or official release packaging is produced.

Build the GUI first, then build the plugin:

```sh
cd apps/gui
npm run build
cd ../plugins/jetbrains
gradle build --console=plain
```

The Gradle build copies `apps/gui/dist` into generated plugin resources under `build/generated/resources/yet-ai-gui/yet-ai-gui`. Generated GUI assets are not committed. If `apps/gui/dist/index.html` is absent, the build still succeeds and the tool window uses the placeholder shell unless `guiDevUrl` is configured.

At runtime the JCEF host prefers `guiDevUrl` when configured. Otherwise it loads packaged GUI resources from `/yet-ai-gui/index.html` when they are present, then falls back to the local placeholder.

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

The tool window uses JCEF when available. If `guiDevUrl` is set, the shell embeds the loopback GUI dev server in an iframe. Otherwise it loads packaged GUI resources copied from `apps/gui/dist` when available, then falls back to a local placeholder with the configured runtime URL.

The wrapper exposes `window.postIntellijMessage` and sends `gui.ready` with a request id. The Kotlin host parses bridge input as JSON, accepts only JSON objects with the exact bridge version and `type: "gui.ready"`, validates optional request ids as short non-empty strings without control characters, requires optional payloads to be JSON objects, rejects arrays/scalars/null/malformed JSON/unknown types without logging payloads, and replies with `host.ready` echoing the request id when present. It also sends `host.openedFromCommand`. Host messages are built as structured JSON objects. Bootstrap JSON is escaped for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

The runtime connector supports debug connect mode and local launch mode. In `connect` mode it validates the loopback `runtimeUrl`, reads the optional debug token from PasswordSafe, and checks `GET /v1/ping` with the bearer token when present. In `launch` mode, or `auto` mode when a `yet-lsp` binary is discoverable, it starts the binary with a generated per-session token in `YET_AI_AUTH_TOKEN` and the configured runtime port in `YET_AI_HTTP_PORT`, then checks `/v1/ping`. Launched processes are stopped when the application service is disposed. The connector may discover `yet-lsp` on `PATH`; an explicit `engineBinaryPath` must be absolute and point to a file.

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
