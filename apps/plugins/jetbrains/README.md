# Yet AI JetBrains Plugin

## Ownership and boundary

`apps/plugins/jetbrains` owns the minimal JetBrains plugin host for Yet AI. Its responsibilities are plugin metadata, local runtime connection settings, JCEF tool window hosting, and a narrow JetBrains-to-GUI bridge.

The plugin stays thin. Chat runtime, provider configuration, tool policy, storage, indexing, and model/provider adapters belong to the engine. UI state and design belong to the GUI.

The plugin connects the GUI to the local Yet AI runtime for local-first BYOK workflows. It does not require a Yet AI cloud workspace, account, hosted model gateway, or managed credit balance for normal operation. It must not persist provider API keys or duplicate provider adapters.

JetBrains now supports only the safe read-only/navigation/context controlled IDE actions: `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`. Execution is local-first, requires an explicit GUI/user request, passes through strict wrapper/Kotlin policy, and returns only correlated `host.ideActionProgress` / `host.ideActionResult` messages. Controlled `getContextSnapshot` result metadata is metadata only (source, active-editor boolean, workspace folder count) and does not include file paths, selected text, or raw file contents; the separate `host.contextSnapshot` active editor/selection prompt-context bridge may include bounded selected text only for visible opt-in first-message attachment. Confirmed edit proposals are not applied by JetBrains; the only implemented write/apply path remains the VS Code confirmed edit-proposal flow with explicit user confirmation.

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

### Bundled engine resource inside the plugin JAR

`npm run prepare:jetbrains-preview` also stages the local cargo-built `yet-lsp` (or `yet-lsp.exe` on Windows) as a stable bundled engine resource at `yet-ai-engine/yet-lsp` (or `yet-ai-engine/yet-lsp.exe` on Windows) inside the plugin JAR. The IDE extracts that resource on first launch and prefers it over `PATH` lookup, so the installable artifact no longer requires the user to copy or configure an absolute `Engine binary path` when `cargo build -p yet-lsp` has already produced the local binary. The bundled binary is the dev-preview local cargo build output staged from `target/debug/yet-lsp` (or `target/debug/yet-lsp.exe`), not a signed or notarized production engine; no signing, notarization, marketplace publication, production installer, or production release claim is made for this artifact. The `smoke:jetbrains-installable` and `smoke:github-ide-artifacts` smokes require both the unzip-first and the direct-install plugin ZIPs to contain this resource path with non-zero bytes. Run `npm run smoke:jetbrains-bundled-runtime` after `npm run prepare:jetbrains-preview` to extract the bundled engine from the root dev-preview ZIP, start it on loopback with a generated local token, verify authenticated `/v1/ping`, and stop it without launching IntelliJ. This startup smoke uses no provider credentials, real provider calls, hosted backend, signing, publishing, release upload, or production-release claim.

### GitHub Actions artifact install

For a downloadable CI-built dev preview, use GitHub Actions workflow `Yet AI IDE Artifacts` (`.github/workflows/ide-artifacts.yml`). The workflow runs local/mock-only validation and uploads unsigned, unpublished dev-preview artifacts. Before upload, it starts the JetBrains bundled runtime extracted from the built artifact, verifies authenticated `/v1/ping` on loopback, and stops it without launching IntelliJ. It does not publish to a marketplace, sign, notarize, create a production release, call real providers, require provider credentials, or contact a hosted Yet AI backend.

The workflow builds per-platform artifacts in a `linux-x64` / `macos-arm64` / `windows-x64` matrix because the plugin JAR bundles a native `yet-lsp` runtime. Download the artifact whose `<os>-<arch>` suffix matches your local OS/architecture; mixing platforms will fail at install time because the bundled engine is platform-specific. The bundled `yet-lsp` is the dev-preview local cargo build output staged from the runner's `target/<profile>/yet-lsp` (or `yet-lsp.exe` on Windows); it is not a signed or notarized production engine and no signing, notarization, marketplace publication, production installer, or production release claim is made.

Public artifact names are exactly 7 total: three `yet-ai-vscode-unzip-first-<os>-<arch>-<sha>` artifacts, three `yet-ai-jetbrains-install-direct-<os>-<arch>-<sha>` artifacts, and one `yet-ai-plugin-manifest-<sha>` combined manifest. CI can write the same expected list to the GitHub Step Summary with `artifact:github-summary`; this summary does not add uploaded artifacts. From the repository root, run `npm run artifact:github-summary -- --sha <sha>` to print the sanitized expected public list without private paths or release/signing claims.

Before relying on GitHub Actions artifacts or manual dogfood, run the local release-candidate artifact gate:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run smoke:ide-release-candidate
```

It validates dev-preview artifact preparation, staging, manifest combination, workflow/report safety checks, and expected public artifact names only. It does not launch real IDEs, call providers, contact hosted services, sign, publish, or claim a production release.

The combined `yet-ai-plugin-manifest-<sha>` is uploaded with a `platforms[]` array aggregating per-platform commit, checksum, platform, runtime, and artifact metadata.

Download/read `yet-ai-plugin-manifest-<sha>` for commit, checksum, and platform metadata.

Recommended direct install:

1. In GitHub Actions, open a successful `Yet AI IDE Artifacts` run for the commit you want to test.
2. Download the `yet-ai-jetbrains-install-direct-<os>-<arch>-<sha>` artifact matching your local OS/architecture.
3. Use the downloaded GitHub artifact ZIP directly in Settings/Preferences → Plugins → gear → Install Plugin from Disk.
4. Restart.
5. Keep `Launch mode` as `auto` or `launch`, set `Engine binary path` only if discovery fails, then open the Yet AI tool window.

Local JetBrains preview preparation still creates `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` for install-from-disk testing, but the public GitHub Actions JetBrains artifact is the platform-specific direct-install ZIP selected directly in the IDE.

Do not install the old combined artifact bundle or any artifact containing both IDE plugins. JetBrains expects a JetBrains plugin ZIP structure; a generic GitHub transport bundle will fail with something like `Fail to load plugin descriptor`. If you see that error, make sure you selected the JetBrains direct-install artifact ZIP.

Manual verification checklist:

- Packaged GUI loads in the tool window, not a placeholder or blank panel.
- Runtime refresh connects or shows only sanitized actionable errors; runtime diagnostics omit session tokens, bearer headers, provider keys, auth codes, cookies, raw process output, and raw bridge payloads.
- Provider setup is visible; provider errors/status are sanitized and provider credentials remain engine-owned local BYOK data.
- Active editor/selection context preview appears only when relevant and is explicitly attached or omitted.
- Safe read-only/navigation/context controlled actions (`getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`) run only after explicit GUI/user request and return correlated sanitized progress/results; confirmed edit proposals are preview-only and cannot be applied by JetBrains.
- No shell, git, task, tool, autonomous edit, silent workspace mutation, or unconfirmed apply controls are present.

Use the root sanitized report helper for manual evidence:

```sh
npm run dogfood:ide-report -- --template
npm run dogfood:ide-report -- --check-template
npm run dogfood:ide-report -- --self-test
npm run dogfood:ide-report -- --check path/to/local-report.md
```

The generated cross-IDE template includes JetBrains fields for install result, launch mode, packaged GUI, runtime refresh, provider setup, active context, read-only IDE action, and first-message status. Mark untested items as `not run`; do not imply production release status. The helper writes nothing by default, and `smoke:ide-dogfood` validates the built-in template plus self-test so the safe report checker cannot rot. If you redirect a report to a file, keep manual/local evidence out of tracked files unless it has been explicitly reviewed as sanitized. Never include tokens, provider keys, bearer headers, auth codes, OAuth tokens, cookies, raw bridge payloads, request bodies, private paths, browser storage dumps, raw provider responses, raw prompts, file contents, or screenshots containing secrets.

Manual IntelliJ IDEA install-from-disk steps:

1. Run `npm run prepare:jetbrains-preview` from the repository root.
2. Open IntelliJ IDEA Settings/Preferences → Plugins → gear → Install Plugin from Disk.
3. Choose the stable root ZIP path `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` printed by the preparation command. The Gradle ZIP path under `apps/plugins/jetbrains/build/distributions/` remains useful for diagnostics.
4. Restart the IDE when prompted.
5. Open Yet AI settings and keep `Launch mode` as `auto`, or set it to `launch`. The installed direct-install/dev-preview artifact bundles `yet-ai-engine/yet-lsp` (or `yet-lsp.exe`), so no `Engine binary path` is needed when that bundled runtime is available; set `Engine binary path` to the printed `target/debug/yet-lsp` path only if bundled runtime discovery and `PATH` discovery both fail. Use `connect` only for an already running loopback runtime.
6. Open the Yet AI tool window and verify that the packaged GUI loads.
7. Optional safe real-provider smoke: configure the OpenAI API-key fallback in the GUI, confirm the key field clears after save, then send a short chat prompt. The experimental OpenAI account path remains explicit-risk, mock-covered in automation, and any real account test is manual/high-risk/outside CI.

Installed IDEA first-message checklist:

1. Run the preflight commands from the repository root: `npm run prepare:jetbrains-preview`, `npm run smoke:jetbrains-installable`, `npm run smoke:jetbrains-bundled-runtime`, `npm run smoke:jetbrains-gui-browser`, and `npm run smoke:jetbrains-first-message`. Use `npm run smoke:ide-preview` when validating both IDEs together.
2. Install the stable root ZIP through Install Plugin from Disk, restart IntelliJ IDEA, and keep `Launch mode` as `auto` or `launch` for the normal plugin-launched runtime path.
3. Do not manually start `yet-lsp` and do not paste `local-dev-token` for the normal installed path. The plugin-launched runtime supplies its loopback URL and session token to the packaged GUI through trusted `host.ready`; there is no manual user paste step for the local runtime token. Set `Engine binary path` only if bundled runtime discovery and `PATH` discovery both fail.
4. Run `Yet AI: Open Chat`, verify the packaged GUI loads, click `Refresh runtime`, and confirm the GUI reports connected or shows only sanitized actionable errors. If refresh keeps failing in the installed JetBrains path, use Tools → `Yet AI: Show Runtime Status`; then use Tools → `Yet AI: Restart Runtime` and click `Refresh runtime` again.
5. Run Tools → `Yet AI: Show Runtime Status` and confirm it contains only sanitized URL, launch mode (`auto` or `launch` for the normal installed path), binary, process, and ping diagnostics without session tokens, bearer headers, provider API keys, OAuth/auth codes, cookies, private paths, or raw process output.
6. After runtime connects, treat Provider setup as the next required step: configure the OpenAI API-key fallback or a local OpenAI-compatible `/v1` provider, save it, optionally test it, and verify the GUI readiness changes from provider-required to ready-to-send before sending.
7. If the GUI shows a JetBrains active editor/selection context preview, review the source host, path, language/range metadata, selected character count, and bounded preview. Keep `Attach to next message` enabled only when the selected text is safe to send to the configured provider, or choose `Do not attach` before sending.
8. For safe real-provider testing, paste an OpenAI API key manually only in the GUI Provider setup API-key field, save, verify the field clears, run provider test/status, send the short sanitized prompt `Say hello in one sentence.`, verify streaming response plus local engine-owned history reload when practical, and record only sanitized success or failure outcomes. Do not include raw prompts containing private code or secrets in reports.
9. Test the experimental account-login path only when explicitly accepted for that manual run. Do not capture or store authorization URLs containing codes, auth codes, tokens, cookies, PKCE verifier values, or screenshots with secrets. Exchange any code manually only inside the GUI/runtime flow, send a first message only after connected status, disconnect after the test, and record only sanitized status labels, redacted account hints, and non-secret error text.

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
npm run smoke:jetbrains-bundled-runtime
npm run smoke:jetbrains-gui-browser
npm run smoke:jetbrains-first-message
```

When a change should validate both IDE preview routes, use the root cross-IDE preview gate:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run smoke:ide-preview
```

It runs `npm run prepare:vscode-preview`, `npm run smoke:vscode-installable`, `npm run smoke:vscode-preview`, `npm run smoke:vscode-wrapper-browser`, `npm run smoke:vscode-first-message`, `npm run prepare:jetbrains-preview`, `npm run smoke:jetbrains-installable`, `npm run smoke:jetbrains-preview`, `npm run smoke:jetbrains-gui-browser`, and `npm run smoke:jetbrains-first-message` in order. It validates ignored local preview artifacts, the VS Code controlled action wrapper browser path, and loopback first-message paths without launching VS Code, IntelliJ IDEA, JCEF automation, real provider calls, hosted Yet AI services, signing, marketplace publication, or production installers.

Use the broader closure gate before declaring the change ready for manual IDE dogfood or when running the manual CI workflow:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run smoke:ide-dogfood
```

It is fail-fast and additionally runs JetBrains Gradle tests, VS Code compile/engine checks, the `dogfood:ide-report -- --check-template` and `--self-test` safety checks, repository validation, and final clean tracked-status output. Passing output prints the manual next steps: install generated VS Code/JetBrains dev-preview artifacts from GitHub Actions or local `dist/plugins/`, keep normal `auto`/`launch` mode, use the generated dogfood report template, record only sanitized statuses or `not run`, and never include tokens, provider keys, auth codes, cookies, private paths, raw bridge payloads, browser storage dumps, or screenshots with secrets. The gate does not launch real IDEs, use real provider credentials, call OpenAI/ChatGPT, contact hosted Yet AI services, sign/publish, or create a production release.

Run the JetBrains first-message smoke directly when changing only the JetBrains packaged GUI or wrapper bridge path:

```sh
npm run smoke:jetbrains-first-message
```

It delegates to the wrapper browser first-message coverage and uses loopback mocks only. It must not use real provider credentials, call OpenAI/ChatGPT, or contact hosted Yet AI services.

The installable smoke checks that a Gradle distribution ZIP exists, that exactly one stable root `dist/plugins/jetbrains/` dev-preview ZIP and matching `.sha256` checksum exist, that the ZIP and nested plugin JAR use safe archive paths, that the root ZIP is not obviously older than source build inputs or the Gradle distribution ZIP, that the ZIP contains `META-INF/plugin.xml` and packaged GUI `yet-ai-gui/index.html` plus referenced JavaScript assets, and that docs describe Install Plugin from Disk plus `Engine binary path` expectations. The bundled runtime startup smoke requires the root dev-preview ZIP produced by `npm run prepare:jetbrains-preview`, extracts only the packaged engine binary to a temporary basename, starts it with a generated local token and free loopback port, verifies authenticated `/v1/ping`, and stops it without launching IntelliJ IDEA; it does not use provider credentials, real provider calls, a hosted backend, signing, publishing, or release uploads. The generated-resource preview smoke fails when `apps/gui/dist/index.html` is newer than `apps/plugins/jetbrains/build/generated/resources/yet-ai-gui/yet-ai-gui/index.html`; rerun `npm run prepare:jetbrains-preview` after rebuilding GUI assets. The packaged GUI browser smoke extracts `yet-ai-gui/index.html` and `yet-ai-gui/assets/*` from the ZIP's nested plugin JAR into a temporary local directory, serves it on loopback, and verifies that the core GUI renders non-blank with working JavaScript and CSS assets. If the ZIP is missing or stale, run `npm run prepare:jetbrains-preview` first. The wrapper browser smoke serves the current built `apps/gui/dist` on loopback, opens a generated JetBrains-like wrapper on a separate loopback origin, embeds the GUI iframe with the exact target origin, installs a fake `window.postIntellijMessage` collector, serves a token-protected mock local runtime on loopback, and verifies non-blank iframe rendering, real iframe-origin `gui.ready` / `host.ready` bridge delivery with wrapper-owned generation/sequence nonce authorization, fail-closed dropping of unready or nonce-stale host messages across reloads, rejection of arbitrary wrapper-origin host `postMessage` relays, connected experimental OpenAI account readiness, JetBrains-style `host.contextSnapshot` active editor/selection preview, default include toggle behavior, disabled-toggle omission, enabled context delivery to `user_message.payload.context`, first-message send/streamed response, and no raw runtime token, OAuth, cookie, API-key, or active-context sentinels in browser-visible state. No provider credentials, real OpenAI/ChatGPT calls, JetBrains IDE launch, JCEF automation, or hosted Yet AI services are required.

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

The wrapper exposes `window.postIntellijMessage` only for real iframe-origin `gui.ready` messages and safe controlled `gui.ideActionRequest` messages. It does not emit wrapper-origin fake `gui.ready` messages. The Kotlin host parses bridge input as JSON, accepts only JSON objects with the exact bridge version, validates optional request ids as short non-empty strings without control characters, requires optional payloads to be JSON objects, rejects arrays/scalars/null/malformed JSON/unknown types without logging payloads, and replies with `host.ready` using the wrapper-owned generation/sequence request id for the accepted current frame. GUI-supplied ready request ids are diagnostic only and are not authoritative for host delivery. It also sends `host.openedFromCommand`. Host messages are built as structured JSON objects and delivered to the iframe through the wrapper-private `window.__yetAiSendHostMessageToFrame` function, not through a public `window.postMessage` host relay. Bootstrap `host.ready` uses a wrapper-generated request id only for initial runtime settings delivery. Bootstrap JSON is escaped for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

For controlled IDE actions, the JetBrains bridge accepts only `gui.ideActionRequest` for `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange` after explicit GUI/user request. Kotlin policy validates safe workspace-relative paths and bounded ranges before any navigation, does not read arbitrary files or index projects, and does not include raw content or selected text in controlled action result metadata. The only controlled `getContextSnapshot` result metadata is source, active-editor boolean, and workspace folder count. This is distinct from `host.contextSnapshot`, where bounded selected text may be included only for the visible, opt-in first-message prompt-context flow. JetBrains emits only correlated sanitized `host.ideActionProgress` and `host.ideActionResult` for these read-only actions.

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

## JetBrains LSP MVP boundary

JetBrains LSP client wiring is deferred. This plugin currently verifies the local runtime through HTTP `/v1/ping`, hosts the GUI in JCEF, and sends bounded active editor/selection context through the non-privileged bridge. It does not start `yet-lsp --lsp-stdio`, register an IntelliJ LSP client, advertise JetBrains completions, or attach document lifecycle notifications to the engine LSP server.

### Feasibility decision

The read-only JetBrains LSP path is version-feasible for the current baseline (`2024.3.7` / `sinceBuild = 243`) because the public IntelliJ Platform LSP API is available from IntelliJ Platform 2023.2+. The likely IntelliJ Platform path is the native LSP API used by current IDE builds, with a project-scoped server support provider and server descriptor that starts an external stdio process. Candidate API surfaces to verify in a follow-up are the IntelliJ `com.intellij.platform.lsp.api` server support/descriptor classes, editor/file applicability hooks, and completion integration supplied by the platform LSP client. If those APIs are unavailable or incompatible in the selected IDE baseline, the fallback candidate is a custom IntelliJ completion/document-listener integration backed by `lsp4j`, but that would be broader and should be treated as a separate design rather than native LSP support.

For this pre-2025.2.1 baseline, native LSP integration is expected to require a plugin/module dependency such as `com.intellij.modules.ultimate` before compile-time API use. The current plugin does NOT add that dependency and does NOT enable/register native JetBrains LSP yet. No Gradle dependency or platform version change is made in this recovery card.

Sprint 2 continues with the off-by-default separate `yet-lsp --lsp-stdio` lifecycle and the no-secret/document-policy foundation first, before any JetBrains native LSP runtime behavior is introduced. The first implementation card must prove the exact dependency coordinates, plugin.xml dependency needs, and minimum supported IDE build with Gradle tests before enabling any setting.

### Future process and lifecycle boundary

Future JetBrains LSP launch must remain separate from the HTTP runtime connector. The existing `RuntimeConnectionManager` owns `connect`/`launch`/`auto` HTTP runtime behavior, `YET_AI_AUTH_TOKEN`, `YET_AI_HTTP_PORT`, PasswordSafe debug session tokens, `/v1/ping`, runtime diagnostics, and restart. A JetBrains LSP client should start a different `yet-lsp --lsp-stdio` process through a dedicated project-scoped LSP service or platform descriptor. It must not reuse the HTTP launched `Process`, must not call `/v1/ping` as LSP readiness, and must not stop or restart the chat runtime when the LSP client stops.

The LSP process environment must be deliberately minimal. It should inherit only non-secret process basics needed to locate the binary and run the process, and must not pass `YET_AI_AUTH_TOKEN`, `YET_AI_HTTP_PORT`, local runtime session tokens, bearer or Authorization values, provider API keys, OAuth tokens, cookies, provider settings, GUI bootstrap payloads, or PasswordSafe values. The engine LSP stdio mode does not require a runtime token and must remain local-only.

Lifecycle ownership should be project-scoped and opt-in. The future setting should default to disabled, start only when a project is open and a supported local file editor/document is active, supervise stdout/stdin/stderr without blocking the IDE, redact bounded stderr diagnostics, send graceful shutdown/exit where supported, and dispose the LSP process on project close, plugin unload, IDE shutdown, or setting disable. Process crashes or missing binaries should surface only sanitized diagnostics and should not affect chat/runtime/active-context behavior.

### Read-only document and URI policy

The future JetBrains LSP path may send only editor-supplied local document lifecycle notifications to `yet-lsp --lsp-stdio`: initialize/initialized, didOpen, didChange, didClose, completion status proof, shutdown, and exit. It must not read arbitrary files, recursively scan workspaces, index projects, inspect VFS files that were not opened through the approved editor path, or request provider-backed completions on keystrokes.

The first implementation should allow only normal local `file://` documents that the IntelliJ editor has opened and that satisfy size/count bounds already compatible with the engine LSP MVP. Unsupported schemes and remote, virtual, malformed, credential-bearing, oversized, binary-like, closed, or unknown documents should produce no completion result or only sanitized diagnostics. LSP state must remain bounded in memory and be cleared on close, shutdown, process exit, or project disposal.

The JetBrains client must not enable workspace edits, file writes, file deletes, apply-patch behavior, code actions that mutate files, shell/tool execution, IDE tool execution, task execution, git operations, autonomous indexing, arbitrary file reads, or background agent behavior. Completion/status output is limited to deterministic local status proof over the in-memory document supplied by the editor until a separate approved card implements richer behavior.

### Verification required before support can be claimed

A future implementation cannot claim JetBrains LSP support until all of these pass with local/mock-only inputs:

- Gradle compile/tests proving the selected IntelliJ LSP API, plugin dependency, default-disabled setting, supported IDE baseline, process descriptor, and disposal behavior.
- Tests or smoke coverage proving `yet-lsp --lsp-stdio` is launched as a separate process from the HTTP runtime with `--lsp-stdio` and without runtime/provider secrets in environment or bridge payloads.
- Tests proving only allowlisted local `file://` documents are synchronized, document size/count limits are enforced, didClose clears state, unsupported URI schemes are ignored or rejected safely, and completion returns only the deterministic local status proof.
- Diagnostics tests proving missing binary, process error, stderr, unsupported API, and shutdown failures are redacted, bounded, and do not include provider secrets, local runtime tokens, private paths, raw document bodies, raw bridge payloads, or unbounded logs.
- A JetBrains smoke or deterministic harness proving the opt-in setting does not change existing chat/runtime/JCEF/active-context behavior when disabled and does not require provider credentials, OpenAI/ChatGPT calls, a hosted Yet AI backend, a cloud workspace, signing, marketplace publication, or a real IDE launch in CI.

The minimum future implementation card outline is:

1. Confirm the IntelliJ LSP API and Gradle/plugin dependency for IDEA Community `2024.3.x` or document the exact platform blocker.
2. Add an off-by-default JetBrains read-only LSP setting and a project-scoped LSP service/descriptor that starts `yet-lsp --lsp-stdio` separately from `RuntimeConnectionManager`.
3. Restrict document sync to bounded local `file://` editor documents and deterministic completion/status proof only.
4. Add sanitized lifecycle diagnostics and graceful disposal without touching HTTP runtime state.
5. Add Gradle tests plus a local smoke/harness proving launch args, no-secret environment, read-only URI/document policy, completion proof, and disabled-by-default behavior.

If the platform LSP API is unavailable to this plugin baseline or requires an unsupported IDE version, the blocker is explicit: do not implement JetBrains LSP until the minimum JetBrains platform version and dependency contract are raised intentionally, or until a separate custom non-native LSP design is approved.

Current GUI-to-host receive policy is deny-by-default. The Kotlin/JCEF bridge accepts strict `gui.ready` and strict `gui.ideActionRequest` only for `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`. GUI messages `gui.openFile`, `gui.revealRange`, `gui.applyWorkspaceEditRequest`, `gui.executeIdeTool`, `gui.copyText`, `gui.showNotification`, and `gui.getHostContext` are not allowlisted and must not call IntelliJ platform APIs. Enabling any additional privileged message later requires strict schemas, request/response correlation, exact iframe origin/source checks where available, user confirmation for risky operations, sanitized audit/logging, least-privilege allowlists, and no silent workspace mutation. Tools, tasks, knowledge, shell execution, file edits/apply patch, autonomous indexing, and background autonomy remain disabled in this milestone.

## Runtime diagnostics and restart

Use the GUI `Refresh runtime` button first for normal troubleshooting. It checks `/v1/ping`, `/v1/caps`, `/v1/models`, provider summaries, and OpenAI provider-auth status through the local runtime. Connected feedback means the local runtime and provider/model metadata are reachable enough for the current settings. Network/configuration failures usually point to URL, port, launch mode, binary path, or runtime startup issues. Runtime `401` means the local Session token does not match the runtime's `YET_AI_AUTH_TOKEN`; provider `401` after runtime connection means the upstream provider rejected the OpenAI/OpenAI-compatible API key.

Use Tools → `Yet AI: Show Runtime Status` when the tool window cannot connect, the packaged GUI reports runtime failures, or before filing a manual reinstall report. The status dialog is sanitized and includes the launch mode, loopback runtime URL without userinfo/query/hash, whether an engine binary path is configured, configured/discovered binary status, whether the plugin currently owns a launched process, the last `/v1/ping` health result or sanitized connection error, and mode-specific guidance for `auto`, `launch`, or `connect`.

Use Tools → `Yet AI: Restart Runtime` to stop only the process launched by this plugin and prepare the current settings again. It does not stop externally managed runtimes used in `connect` mode, does not inspect provider configuration, and does not expose the local runtime session token. If restart reports a missing binary, invalid configured path, port conflict, runtime-down health failure, or 401/token mismatch, copy the sanitized status text and verify the settings above before reinstalling the ZIP.

Concise troubleshooting matrix:

| Symptom/status | Next action |
| --- | --- |
| Runtime unavailable in the GUI or `Failed to fetch` | Click GUI `Refresh runtime`, then open Tools → `Yet AI: Show Runtime Status` for sanitized launch/binary/process/ping details. |
| Bundled runtime available | Keep `Launch mode` as `auto` or `launch` and leave `Engine binary path` empty unless diagnostics says the bundled runtime is missing or invalid. |
| Runtime `401` | Treat it as a local runtime session-token mismatch between the IDE and `YET_AI_AUTH_TOKEN`, not a provider API-key failure. Refresh/restart the plugin-launched runtime, or align the token for an external runtime in `connect` mode. |
| Missing or non-executable binary | Reinstall the matching platform artifact, or configure an absolute executable `yet-lsp` binary path. Do not paste provider credentials into plugin settings. |
| `/v1/ping` failure, process exited early, or port conflict/address in use | Use Tools → `Yet AI: Restart Runtime`; if the port is occupied, stop the other local process or change the loopback Runtime URL port. |

Diagnostics and restart output must not include session tokens, bearer/authorization headers, raw bridge payloads, provider API keys, environment dumps, provider tokens, private absolute paths, or raw process output containing secrets. Runtime process logs and connection failures are redacted before IDE display/logging. Runtime diagnostics/restart do not require provider credentials, a hosted backend, signing, marketplace publication, or production-release claims.

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
- npm run smoke:jetbrains-bundled-runtime: pass | fail | not run
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
- JetBrains read-only LSP is an explicit experimental local-only toggle, off by default, with no provider calls, no edits, and no production completion claim.
- No marketplace packaging, signed/notarized engine bundle, or production installer is complete.
- The local launcher is an MVP: it sets token and HTTP port environment variables only, reads `/v1/ping`, and does not add LSP/completion wiring. JetBrains LSP client wiring is explicitly deferred for this sprint until the IntelliJ API path, stdio lifecycle, document bounds, URI policy, diagnostics, and smoke coverage are designed and verified.
- The bridge accepts `gui.ready` plus strict read-only `gui.ideActionRequest` messages for `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`, and emits `host.ready`, `host.openedFromCommand`, non-privileged active editor/selection `host.contextSnapshot`, and correlated sanitized `host.ideActionProgress` / `host.ideActionResult` messages. Browser fallback remains non-executing, and VS Code remains the only confirmed workspace edit apply host.
- Settings use JetBrains application state for non-secret local runtime/debug URLs only. The local session token uses JetBrains PasswordSafe.
- Packaged GUI assets are generated build output from `apps/gui/dist`; they are copied into Gradle build resources but are not committed and this is not a final release packaging flow.
- No LSP client, completions, workspace edit/write/create/delete/rename/apply patch path, tools, privileged workspace edits, IDE tools beyond the three safe read-only controlled actions, file mutation, shell/git/task actions, arbitrary file reads/indexing, provider actions, or confirmed edit-proposal apply support are implemented.
- Current chat support is limited to the local provider/chat MVP exposed by the engine and GUI.

## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch, require the exact bridge version, and keep the accepted GUI message allowlist narrow.
- Use exact dev iframe target origins and check inbound iframe origins before forwarding.
- Never log bridge payloads that may contain local runtime credentials.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
