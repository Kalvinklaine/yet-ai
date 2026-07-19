# Yet AI JetBrains Plugin

## Ownership and boundary

`apps/plugins/jetbrains` owns the minimal JetBrains plugin host for Yet AI. Its responsibilities are plugin metadata, local runtime connection settings, JCEF tool window hosting, and a narrow JetBrains-to-GUI bridge.

The plugin stays thin. Chat runtime, provider configuration, tool policy, storage, indexing, and model/provider adapters belong to the engine. UI state and design belong to the GUI.

The plugin connects the GUI to the local Yet AI runtime for local-first BYOK workflows. It does not require a Yet AI cloud workspace, account, hosted model gateway, or managed credit balance for normal operation. It must not persist provider API keys or duplicate provider adapters.

JetBrains supports the safe read-only/navigation/context controlled IDE actions: `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`. Execution is local-first, requires an explicit GUI/user request, passes through strict wrapper/Kotlin policy, and returns only correlated `host.ideActionProgress` / `host.ideActionResult` messages. Controlled `getContextSnapshot` result metadata is metadata only (source, active-editor boolean, workspace folder count) and does not include file paths, selected text, or raw file contents; the separate `host.contextSnapshot` active editor/selection prompt-context bridge may include bounded selected text only for visible opt-in first-message attachment. JetBrains confirmed edit apply is a dev-preview MVP only through the existing `gui.applyWorkspaceEditRequest` / `host.applyWorkspaceEditResult` bridge messages. It requires explicit GUI apply plus IDE/user confirmation, is bounded to sanitized text replacements in existing workspace-relative files, and does not add new bridge messages. Browser confirmed edit cards remain preview-only: raw proposal JSON is inspect-only, the GUI never edits files directly, and browser mode never executes workspace edits.

## IDE surface parity
Runtime lifecycle parity is documented in `docs/architecture/009-runtime-lifecycle-roadmap.md`. JetBrains currently remains an IDE-owned lifecycle host for `auto` / `connect` / `launch`; it does not depend on or implement a daemon-lite, proxy worker, global runtime registry, or resumable background-session model. JetBrains lifecycle parity remains an explicit risk area because restart behavior, bundled runtime discovery, token handling, JCEF delivery, and future LSP behavior must stay aligned with VS Code before stronger IDE lifecycle claims are made.


The repository-level parity contract is `scripts/ide-surface-contract.mjs`; validate it with `npm run validate:ide-surface-contract` and run `npm run smoke:ide-parity` for local-only parity smoke coverage. Current parity is intentional, not identical: both IDEs support the packaged GUI, trusted `host.ready`, active editor context, provider setup, first-message smoke, explicit read-only IDE action proposals, and confirmed edit proposal preview. VS Code remains the production reference host for confirmed edit proposal apply. JetBrains apply now has deterministic dev-preview smoke evidence and is bounded to explicit GUI apply plus IDE/user confirmation through existing apply/result bridge messages for sanitized text replacements in existing workspace-relative files. Browser remains preview-only/non-executing. LSP is also bounded: VS Code has an off-by-default read-only MVP/status proof, while JetBrains native/client behavior is foundation/deferred only and not production enabled. Artifact installability is dev-preview only for both IDEs; JetBrains additionally has bundled runtime startup smoke. These checks do not launch real IDEs, call providers, require hosted services, sign, publish, or claim production release status.

`npm run smoke:jetbrains-wrapper-browser` asserts this parity boundary directly: JetBrains chat/first-message, active context, read-only IDE action, and confirmed edit apply status must match the repository contract; snippet search and verification commands must remain preview-only, and native JetBrains LSP must remain deferred. The smoke also exercises the dev-preview apply lifecycle only through explicit GUI apply plus host result messages, while forbidden shell, git, task, provider, unsafe-path, and malformed edit messages stay non-executing.

The browser smoke obtains the shipped wrapper HTML through `cd apps/plugins/jetbrains && gradle printSmokeWrapperHtml --quiet --console=plain --args "<panel-origin> <panel-id> <panel-base-path>"`; the Node smoke adds only smoke-only observability and timeout instrumentation around that production output. It loads the wrapper at the production-like `GET /panel/<panel-id>/wrapper.html` route on a dedicated loopback wrapper origin. The packaged GUI iframe uses a different loopback origin, while `/panel/<panel-id>/index.html`, GUI assets, and the panel runtime proxy remain same-origin with that GUI only. This isolated-origin boundary prevents the iframe from directly accessing wrapper globals. The smoke uses Chromium and is production-like browser coverage, not real IntelliJ/JCEF CI automation.

## Production wrapper parity contract

The JetBrains tool window uses a production Kotlin-owned JCEF wrapper around the packaged GUI, not a browser-only bridge shim. The wrapper loads the generated GUI resources in a loopback iframe and enforces the same invariants covered by `npm run smoke:jetbrains-wrapper-browser` and the Kotlin unit tests:

- The iframe source and target origin must be the exact generated packaged-GUI loopback origin. Parent-to-iframe delivery uses that origin only, and inbound iframe messages are accepted only from the current iframe window and exact origin.
- `gui.ready` is nonce-backed: the wrapper sends a fresh frame nonce challenge for the current iframe document, accepts ready only with the matching nonce and bridge version, and mints the authoritative ready request id itself. GUI-supplied ready request ids are ignored, stale ids are not reused, and old-document/reload messages cannot authorize delivery.
- The wrapper forwards only strict allowlisted GUI-to-host messages: `gui.ready`, strict `gui.unloaded` lifecycle notifications, `gui.runtimeRefresh`, and read-only `gui.ideActionRequest` for `getContextSnapshot`, `openWorkspaceFile`, or `revealWorkspaceRange`. Runtime refresh and read-only IDE action requests are accepted only after the current frame is ready and the current `host.ready` handshake is established.
- An iframe `load` event is not readiness. Until the current-frame nonce challenge produces an accepted `gui.ready`, the wrapper keeps the shell visible and eventually shows the loaded-but-not-ready fallback. After accepted ready, the readiness fallback must be hidden; a separate sanitized runtime status may remain visible when actionable. The production-like browser smoke fails loaded-without-ready or fallback-after-ready regressions.
- Stale, unready, wrong-origin, wrong-source, wrong-version, wrong-nonce, malformed, oversized, secret-marker request id, or unsafe-path messages are dropped. Pending host/diagnostic queues are bounded and are cleared rather than replaying stale host messages across reloads.
- JetBrains has only the confirmed edit dev-preview mutation bridge: it may accept `gui.applyWorkspaceEditRequest` through the existing schema after explicit GUI apply and IDE/user confirmation, and it may reply only with sanitized `host.applyWorkspaceEditResult`. It must reject GUI open/reveal shortcuts outside the controlled read-only action contract, shell/git/task/tool execution, provider invocation, arbitrary file reads/indexing, file create/delete/rename/write outside bounded existing-file text replacements, apply-patch behavior, autonomous edits, or silent workspace mutation.
- Provider setup and credentials remain local-first/BYOK and engine-owned. The wrapper and GUI smoke must not leak runtime tokens, provider keys, OAuth material, cookies, raw bridge payloads, private paths, or browser storage/console secrets.

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

The ZIP and checksum are install-from-file dev-preview evidence only. They are not JetBrains Marketplace publication, signed plugin distribution, notarized engine packaging, an updater channel, a production installer, or a production release.

### Searchable options build modes

For local/dev-preview artifact builds, use the deterministic non-daemon Gradle path:

```sh
cd apps/plugins/jetbrains
gradle buildPlugin --no-daemon
```

The Gradle `buildSearchableOptions` task is disabled by default because it can hang in headless local environments. Keeping it off for local artifact builds makes the dev-preview ZIP path non-interactive and repeatable.

For a release/full artifact build that intentionally includes JetBrains searchable options, opt in explicitly:

```sh
cd apps/plugins/jetbrains
gradle buildPlugin --no-daemon -PyetAiBuildSearchableOptions=true
```

Verify that opt-in release path only in an environment where `buildSearchableOptions` is known not to hang. Do not treat the default local/dev-preview build as release searchable-options evidence.

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

It validates dev-preview artifact preparation, the engine LSP stdio smoke, installed-plugin visual coverage, installed-plugin Demo Mode first-message coverage, first-message coverage, staging, manifest combination, workflow/report safety checks, and expected public artifact names only. The LSP portion is direct `yet-lsp --lsp-stdio` verification; VS Code LSP remains an off-by-default read-only MVP/status proof, and JetBrains native/client LSP remains deferred behind the feasibility decision below. Demo Mode is runtime-owned no-key canned local chat UX coverage, not model-quality evidence or provider traffic. The gate does not launch real IDEs, run real JCEF automation, call providers, contact hosted services, sign, publish, or claim a production release. It also runs `npm run smoke:jetbrains-lsp-foundation` as a local guardrail for the default-disabled JetBrains lifecycle/process foundation; that smoke uses a sanitized safe environment and does not claim native IntelliJ editor/client LSP support.


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
- Safe read-only/navigation/context controlled actions (`getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`) run only after explicit GUI/user request and return correlated sanitized progress/results; confirmed edit apply is dev-preview only, uses the existing apply/result bridge messages, and requires explicit GUI apply plus IDE/user confirmation for bounded existing workspace-relative text replacements.
- No shell, git, task, tool, provider-call, arbitrary read/index, create/delete/rename, apply-patch, autonomous edit, silent workspace mutation, or unconfirmed apply controls are present.

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
3. Choose the stable root ZIP path `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` printed by the preparation command. Always reinstall from this path after rebuilding; the Gradle ZIP under `apps/plugins/jetbrains/build/distributions/` is diagnostic output, not the stable install path.
4. Restart IntelliJ IDEA after every reinstall, even if the Plugins UI does not prompt. An already-open IDE can keep the previous plugin classes, wrapper, or packaged GUI in memory.
5. Open Yet AI settings and keep `Launch mode` as `auto`, or set it to `launch`. The installed direct-install/dev-preview artifact bundles `yet-ai-engine/yet-lsp` (or `yet-lsp.exe`), so no `Engine binary path` is needed when that bundled runtime is available; set `Engine binary path` to the printed `target/debug/yet-lsp` path only if bundled runtime discovery and `PATH` discovery both fail. Use `connect` only for an already running loopback runtime.
6. Open the Yet AI tool window and verify that the packaged GUI loads.
7. Optional safe real-provider smoke: configure the OpenAI API-key fallback in the GUI, confirm the key field clears after save, then send a short chat prompt. The experimental OpenAI account path remains explicit-risk, mock-covered in automation, and any real account test is manual/high-risk/outside CI.

Installed IDEA first-message checklist:

Installed-plugin dogfood may use GUI Demo Mode before a real provider is configured. Demo Mode is local runtime-owned (`/v1/demo-mode` plus normal model/provider readiness), not a JetBrains/JCEF/browser-storage fake. It streams canned local responses through the same command/SSE/history path, requires no API key, makes no OpenAI/ChatGPT or other provider call, and is not model-quality validation. Disable Demo Mode and configure a BYOK provider for real answers.


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

It runs `npm run prepare:jetbrains-preview`, `npm run smoke:jetbrains-installable`, `npm run smoke:jetbrains-preview`, `npm run smoke:jetbrains-gui-browser`, `npm run smoke:jetbrains-wrapper-browser`, `npm run smoke:jetbrains-first-message`, `npm run prepare:vscode-preview`, `npm run smoke:plugin-layout`, `npm run smoke:vscode-first-message`, `npm run smoke:vscode-installable`, `npm run smoke:vscode-preview`, and `npm run smoke:vscode-wrapper-browser` in order. It validates ignored local preview artifacts, IDE-specific controlled action wrapper browser paths, packaged plugin layout, and loopback first-message paths without launching VS Code, IntelliJ IDEA, JCEF automation, real provider calls, hosted Yet AI services, signing, marketplace publication, or production installers.

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

The installable smoke checks that a Gradle distribution ZIP exists, that exactly one stable root `dist/plugins/jetbrains/` dev-preview ZIP and matching `.sha256` checksum exist, that the ZIP and nested plugin JAR use safe archive paths, that the ZIP contains `META-INF/plugin.xml` plus packaged GUI `yet-ai-gui/index.html`, and that packaged generated resources are byte-for-byte fresh against `apps/gui/dist`: every source `assets/*.js` and `assets/*.css` file must exist in the generated resources / nested plugin JAR / archive location with matching bytes, and stale extra packaged JavaScript or CSS assets are rejected. It also validates docs describe Install Plugin from Disk plus `Engine binary path` expectations. The bundled runtime startup smoke requires the root dev-preview ZIP produced by `npm run prepare:jetbrains-preview`, extracts only the packaged engine binary to a temporary basename, starts it with a generated local token and free loopback port, verifies authenticated `/v1/ping`, and stops it without launching IntelliJ IDEA; it does not use provider credentials, real provider calls, a hosted backend, signing, publishing, or release uploads. The generated-resource preview smoke uses the same byte-level freshness check for packaged generated resources rather than timestamp-only index freshness; rerun `npm run prepare:jetbrains-preview` after rebuilding GUI assets. The packaged GUI browser smoke extracts `yet-ai-gui/index.html` and `yet-ai-gui/assets/*` from the ZIP's nested plugin JAR into a temporary local directory, serves the packaged generated resources on loopback, and verifies that the core GUI renders non-blank with working JavaScript and CSS assets. If the ZIP is missing or stale, run `npm run prepare:jetbrains-preview` first. The wrapper browser smoke serves the production wrapper and packaged/archive-validated GUI iframe from distinct loopback origins. The wrapper uses `GET /panel/<panel-id>/wrapper.html` on the wrapper-only server; the GUI uses `/panel/<panel-id>/index.html`, assets, and the panel runtime proxy on its own origin. It installs a fake `window.postIntellijMessage` collector, serves a token-protected mock local runtime on loopback, and verifies non-blank iframe rendering, real iframe-origin `gui.ready` / `host.ready` bridge delivery with wrapper-owned generation/sequence nonce authorization, the actual timer-driven loaded-but-not-ready fallback using a smoke-only iframe that never sends `gui.ready`, hidden fallback after accepted ready, fail-closed dropping of unready or nonce-stale host messages across reloads, and rejection of wrong-source, wrong-origin, wrong-nonce, invalid-shape, unavailable-randomness, or arbitrary wrapper-origin inputs. It also covers account readiness, active context, and first-message streaming without leaking runtime or provider secrets. No provider credentials, real OpenAI/ChatGPT calls, JetBrains IDE launch, JCEF automation, or hosted Yet AI services are required. JetBrains confirmed-edit dev-preview coverage in this smoke drives a packaged-GUI proposal through preview, explicit GUI apply, accepted/denied/rejected host outcomes, duplicate-pending prevention, unsafe proposal rejection, and sanitized result rendering with loopback mocks only. The dedicated `npm run smoke:jetbrains-edit-proposal` command first validates that the surface contract keeps preview supported, apply as `dev-preview`, and browser mode preview-only/non-executing, then delegates real local apply evidence to focused Kotlin tests: `ControlledIdeActionsTest` covers apply request schema, explicit confirmation requirements, invalid/oversized requests, unsafe paths, duplicate files, invalid ranges, and sanitized results; `JetBrainsIdeActionHostTest` covers bounded existing-file target resolution and atomic-safe replacement preparation; and `YetToolWindowFactoryTest` covers wrapper apply forwarding after readiness, pre-ready rejection, accepted/denied/rejected/failed host outcomes, oversized non-correlation, and sanitized failure output. This is deterministic local evidence, not real IntelliJ/JCEF automation.

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

At runtime the JCEF host prefers `guiDevUrl` when configured. Otherwise it starts two plugin-owned HTTP servers bound to `127.0.0.1` on separate ephemeral ports. The wrapper-only server serves registered panel wrapper HTML at `/panel/<panel-id>/wrapper.html`; the packaged GUI server serves panel-scoped index/assets and the runtime proxy. The wrapper and iframe are intentionally cross-origin, while the GUI and its proxy stay same-origin with each other. This replaces direct `jar:file:` iframe loading in installed IDEs, preserves the browser-origin boundary around wrapper globals, and falls back to the local placeholder if packaged resources or wrapper registration are unavailable. Both servers are separate from the engine runtime and never serve provider secrets.

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

The wrapper exposes `window.postIntellijMessage` only for real iframe-origin `gui.ready` messages and safe controlled `gui.ideActionRequest` messages. It does not emit wrapper-origin fake `gui.ready` messages. The Kotlin host parses bridge input as JSON, accepts only JSON objects with the exact bridge version, validates optional request ids as short non-empty strings without control characters, requires optional payloads to be JSON objects, rejects arrays/scalars/null/malformed JSON/unknown types without logging payloads, and replies with `host.ready` using the wrapper-owned generation/sequence request id for the accepted current frame. GUI-supplied ready request ids are diagnostic only and are not authoritative for host delivery. It also sends uncorrelated `host.openedFromCommand` without a request id. Host messages are built as structured JSON objects and delivered to the iframe through the wrapper-private `window.__yetAiSendHostMessageToFrame` function, not through a public `window.postMessage` host relay. Bootstrap `host.ready` uses a wrapper-generated request id only for initial runtime settings delivery. Bootstrap JSON is escaped for script context with `<`, U+2028, and U+2029 escaped to avoid script breakout.

For controlled IDE actions, the JetBrains bridge accepts only `gui.ideActionRequest` for `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange` after explicit GUI/user request. Kotlin policy validates safe workspace-relative paths and bounded ranges before any navigation, does not read arbitrary files or index projects, and does not include raw content or selected text in controlled action result metadata. The only controlled `getContextSnapshot` result metadata is source, active-editor boolean, and workspace folder count. This is distinct from `host.contextSnapshot`, where bounded selected text may be included only for the visible, opt-in first-message prompt-context flow. JetBrains emits only correlated sanitized `host.ideActionProgress` and `host.ideActionResult` for these read-only actions.

In GUI dev mode the wrapper embeds only loopback GUI URLs, computes the exact dev origin, forwards iframe messages only after checking `event.origin`, and sends iframe `postMessage` calls with that exact `targetOrigin` rather than `*`.

The runtime connector supports debug connect mode and local launch mode. In `connect` mode it validates the loopback `runtimeUrl`, reads the optional debug token from PasswordSafe, skips engine binary discovery/validation entirely, and checks `GET /v1/ping` with the bearer token when present. In `launch` mode, or `auto` mode when a `yet-lsp` binary is discoverable, it starts the binary with a generated per-session token in `YET_AI_AUTH_TOKEN` and the configured explicit runtime port in `YET_AI_HTTP_PORT`, then checks `/v1/ping`. Launch command construction requires `http` with an explicit nonzero port such as `http://127.0.0.1:8001`; it rejects missing ports, port `0`, and `https` because the launcher only passes `YET_AI_HTTP_PORT`. If settings parse succeeds but launch or health checks fail, the GUI keeps the configured runtime URL and receives sanitized diagnostics instead of being retargeted to the fallback URL. Launched runtime stdout/stderr lines and runtime failure diagnostics are sanitized before IDE display/logging: generated session tokens, bearer/authorization headers, env-style and URL/query-style API key/OAuth/session-token/client-secret names, cookies, verifier fields, JSON-style secret fields, JWT-like/long opaque tokens, and full absolute/bare/relative `auth.json` credential-file paths are redacted and long lines are truncated. Launched processes are stopped when the application service is disposed by calling `destroy()`, waiting briefly, and escalating to `destroyForcibly()` if needed. The connector prefers the bundled runtime resource or configured absolute `engineBinaryPath`; `PATH` discovery remains a dev-preview fallback only and should not be the release/installable expectation because it can select an unreviewed local `yet-lsp`. An explicit `engineBinaryPath` must be absolute and point to an executable file where the platform supports executability checks when launch or auto-launch uses it. The plugin-launched runtime receives a minimal allowlisted environment only: secret-like environment names are stripped, while safe local basics such as `PATH`, home/temp directories, locale variables, and non-secret desktop/session variables needed by OS credential storage such as `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR` are preserved when present.

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

JetBrains native LSP client/editor wiring is deferred, but the local-only lifecycle boundary is now verified by focused Kotlin policy tests. The `Enable read-only LSP MVP` setting defaults to disabled and the plugin does not register an IntelliJ LSP client, advertise JetBrains completions, attach editor document synchronization to the engine, or claim production LSP support. When the experimental setting is enabled by a developer, the project-scoped lifecycle service can start a separate stdio process with exactly `yet-lsp --lsp-stdio`, using the bundled/configured/discovered engine binary and a minimal allowlisted environment. That process is distinct from the HTTP chat runtime, receives no `YET_AI_AUTH_TOKEN`, `YET_AI_HTTP_PORT`, provider API keys, bearer/Authorization values, cookies, GUI bootstrap payloads, or PasswordSafe session tokens, and is stopped on service stop/dispose. Missing binary, launch failure, stdout, and stderr diagnostics are redacted and bounded before IDE logging.

This remains a feasibility/lifecycle boundary only. It makes no provider calls and performs no edits.
 The plugin currently verifies the local runtime through HTTP `/v1/ping`, hosts the GUI in JCEF, sends bounded active editor/selection context through the non-privileged bridge, and keeps JetBrains LSP off unless the developer explicitly opts in to the experimental lifecycle shell. Root `npm run smoke:lsp-stdio` verifies the engine stdio contract directly and is included in `npm run smoke:ide-release-candidate`; JetBrains-specific evidence remains focused Kotlin lifecycle/blocked-decision tests such as `cd apps/plugins/jetbrains && gradle test --console=plain --tests "*JetBrainsLsp*"`. No provider-backed completions, keystroke model calls, edits, indexing, file reads, shell/git/tool execution, JetBrains apply path, native IntelliJ LSP client, or production support claim for JetBrains LSP is implemented.

### Feasibility decision

The current sprint outcome is: lifecycle/process/document policy is feasible and tested; native IntelliJ LSP client integration is deferred until the exact IntelliJ Platform dependency contract is proven. The selected baseline is IDEA Community `2024.3.7` with `sinceBuild = 243`, and the build currently declares only `com.intellij.modules.platform` plus the bundled Java plugin dependency. The public IntelliJ Platform LSP API is expected to be available in modern IDE builds, but compile-time use from this plugin baseline likely requires an additional plugin/module dependency, such as Ultimate-language-platform LSP modules, and may be unavailable for Community-only dependencies without intentionally changing the supported IDE contract.

T-15 blocked decision: no native JetBrains editor/LSP proof is added in this sprint. Therefore this card does not add `com.intellij.platform.lsp.api` imports, plugin.xml LSP dependencies, Gradle dependency changes, editor sync, completion registration, native server descriptors, or a production completion claim. A future implementation card must prove the exact Gradle/plugin.xml dependency coordinates, Community versus Ultimate availability, minimum supported IDE build, and deterministic tests before any JetBrains LSP support claim is made. If the native platform API is unavailable or incompatible for the selected baseline, the blocker is explicit: do not implement JetBrains LSP until the minimum JetBrains platform version/dependency contract is raised intentionally, or until a separate custom non-native LSP design is approved.

### Verified process and lifecycle boundary

JetBrains LSP launch remains separate from the HTTP runtime connector. The existing `RuntimeConnectionManager` owns `connect`/`launch`/`auto` HTTP runtime behavior, `YET_AI_AUTH_TOKEN`, `YET_AI_HTTP_PORT`, PasswordSafe debug session tokens, `/v1/ping`, runtime diagnostics, and restart. The LSP lifecycle service starts a different process with `--lsp-stdio`; it must not reuse the HTTP launched `Process`, must not call `/v1/ping` as LSP readiness, and must not stop or restart the chat runtime when the LSP lifecycle stops.

The LSP process environment is deliberately minimal. It inherits only allowlisted process basics needed to locate and run the binary (`PATH`, Windows `Path`, `SystemRoot`, and `WINDIR`) and strips secret-like names even if they are allowlisted later. It must not pass `YET_AI_AUTH_TOKEN`, `YET_AI_HTTP_PORT`, local runtime session tokens, bearer or Authorization values, provider API keys, OAuth tokens, cookies, provider settings, GUI bootstrap payloads, or PasswordSafe values. The engine LSP stdio mode does not require a runtime token and must remain local-only.

Lifecycle ownership is project-scoped and opt-in. The setting defaults to disabled; disabled startup does not resolve environment or spawn a process. Enabled startup supervises stdout/stderr without blocking the IDE, redacts bounded diagnostics, spawns at most one live process, and stops/disposes the process through the shared process-stop helper. Process crashes or missing binaries surface only sanitized diagnostics and do not affect chat/runtime/active-context behavior.

### Read-only document and URI policy

The future JetBrains LSP path may send only editor-supplied local document lifecycle notifications to `yet-lsp --lsp-stdio`: initialize/initialized, didOpen, didChange, didClose, completion status proof, shutdown, and exit. It must not read arbitrary files, recursively scan workspaces, index projects, inspect VFS files that were not opened through the approved editor path, or request provider-backed completions on keystrokes.

The document policy foundation allows only normal local `file://` documents that satisfy size/count bounds compatible with the engine LSP MVP. Unsupported schemes and remote, virtual, malformed, credential-bearing, oversized, binary-like, closed, or unknown documents are rejected safely. LSP state stays bounded in memory and is cleared on close, unsafe reopen, shutdown, process exit, or project disposal.

The JetBrains client must not enable workspace edits, file writes, file deletes, apply-patch behavior, code actions that mutate files, shell/tool execution, IDE tool execution, task execution, git operations, autonomous indexing, arbitrary file reads, or background agent behavior. Completion/status output is limited to deterministic local status proof over the in-memory document supplied by the editor until a separate approved card implements richer behavior.

### Verification required before support can be claimed

A future native/client implementation cannot claim JetBrains LSP support until all of these pass with local/mock-only inputs:

- Gradle compile/tests proving the selected IntelliJ LSP API, plugin dependency, default-disabled setting, supported IDE baseline, process descriptor, and disposal behavior.
- Tests or smoke coverage proving `yet-lsp --lsp-stdio` is launched as a separate process from the HTTP runtime with `--lsp-stdio` and without runtime/provider secrets in environment or bridge payloads.
- Tests proving only allowlisted local `file://` documents are synchronized, document size/count limits are enforced, didClose clears state, unsupported URI schemes are ignored or rejected safely, and completion returns only the deterministic local status proof.
- Diagnostics tests proving missing binary, process error, stderr/stdout, unsupported API, and shutdown failures are redacted, bounded, and do not include provider secrets, local runtime tokens, private paths, raw document bodies, raw bridge payloads, or unbounded logs.
- A JetBrains smoke or deterministic harness proving the opt-in setting does not change existing chat/runtime/JCEF/active-context behavior when disabled and does not require provider credentials, OpenAI/ChatGPT calls, a hosted Yet AI backend, a cloud workspace, signing, marketplace publication, or a real IDE launch in CI.

The minimum future implementation card outline is:

1. Confirm the IntelliJ LSP API and Gradle/plugin dependency for IDEA Community `2024.3.x` or document the exact platform blocker.
2. Wire an off-by-default native JetBrains read-only LSP service/descriptor that starts `yet-lsp --lsp-stdio` separately from `RuntimeConnectionManager`.
3. Restrict document sync to bounded local `file://` editor documents and deterministic completion/status proof only.
4. Add sanitized lifecycle diagnostics and graceful disposal without touching HTTP runtime state.
5. Add Gradle tests plus a local smoke/harness proving launch args, no-secret environment, read-only URI/document policy, completion proof, and disabled-by-default behavior.

Current GUI-to-host receive policy is deny-by-default. The Kotlin/JCEF bridge accepts strict `gui.ready`, strict `gui.ideActionRequest` only for `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`, and the dev-preview confirmed edit `gui.applyWorkspaceEditRequest` contract only for explicit GUI apply plus IDE/user confirmation. GUI messages `gui.openFile`, `gui.revealRange`, `gui.executeIdeTool`, `gui.copyText`, `gui.showNotification`, and `gui.getHostContext` are not allowlisted and must not call IntelliJ platform APIs. Enabling any additional privileged message later requires strict schemas, request/response correlation, exact iframe origin/source checks where available, user confirmation for risky operations, sanitized audit/logging, least-privilege allowlists, and no silent workspace mutation. Tools, tasks, knowledge, shell execution, create/delete/rename/apply-patch, autonomous indexing, arbitrary reads, and background autonomy remain disabled in this milestone.

## Runtime diagnostics and restart

Use the GUI `Refresh runtime` button first for normal troubleshooting. It checks `/v1/ping`, `/v1/caps`, `/v1/models`, provider summaries, and OpenAI provider-auth status through the local runtime. Connected feedback means the local runtime and provider/model metadata are reachable enough for the current settings. Network/configuration failures usually point to URL, port, launch mode, binary path, or runtime startup issues. Runtime `401` means the local Session token does not match the runtime's `YET_AI_AUTH_TOKEN`; provider `401` after runtime connection means the upstream provider rejected the OpenAI/OpenAI-compatible API key.

Use Tools → `Yet AI: Show Runtime Status` when the tool window cannot connect, the packaged GUI reports runtime failures, or before filing a manual reinstall report. The status dialog is sanitized and includes the launch mode, loopback runtime URL without userinfo/query/hash, whether an engine binary path is configured, bundled/configured/PATH binary status, whether the plugin currently owns a launched process, the last `/v1/ping` health result or sanitized connection error, and mode-specific guidance for `auto`, `launch`, or `connect`. It should make the installable preference explicit: bundled runtime first, configured absolute binary only when needed, and PATH discovery as a dev-preview fallback only.

Use Tools → `Yet AI: Restart Runtime` to stop only the process launched by this plugin and prepare the current settings again. It does not stop externally managed runtimes used in `connect` mode, does not inspect provider configuration, and does not expose the local runtime session token. If restart reports a missing binary, invalid configured path, port conflict, runtime-down health failure, or 401/token mismatch, copy the sanitized status text and verify the settings above before reinstalling the ZIP.

Before spending time on an installed-plugin 401, the root local smokes can narrow the failure boundary without launching IntelliJ IDEA:

```sh
cargo build -p yet-lsp
npm --prefix apps/gui run build
npm run smoke:real-engine-startup
npm run smoke:hosted-gui-host-ready-gate
```

`npm run smoke:real-engine-startup` proves the real local engine starts with loopback auth and emits structured auth reject/request summary evidence. `npm run smoke:hosted-gui-host-ready-gate` proves the built browser-hosted GUI waits for `host.ready` before runtime fetches and sends bearer auth plus the GUI caller header after handoff. These smokes require no provider credentials or hosted Yet AI service, and they do not replace installed JetBrains/JCEF verification; passing them only points the remaining investigation toward plugin packaging, bridge delivery, runtime lifecycle, or installed IDE token handoff.

### Sanitized readiness troubleshooting

The installed wrapper reports only one bounded readiness phase from this frozen vocabulary: `frame_waiting_for_load`, `frame_loaded_waiting_for_nonce`, `frame_nonce_unavailable`, `frame_nonce_sent_waiting_for_gui_ready`, `gui_ready_rejected_wrong_origin`, `gui_ready_rejected_wrong_source`, `gui_ready_rejected_wrong_nonce`, `gui_ready_rejected_invalid_shape`, or `gui_ready_accepted`.

If the red fallback appears, record only that phase and the sanitized Tools → `Yet AI: Show Runtime Status` result. Do not capture or paste event data, payloads, origins, URLs, nonces, request ids, exception details, tokens, provider credentials, cookies, private paths, browser storage, or raw logs. A loaded iframe with a phase other than `gui_ready_accepted` is still not ready. Rebuild with `npm run prepare:jetbrains-preview`, reinstall the stable `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip`, restart IntelliJ IDEA, and retry before investigating deeper.

### Installed artifact freshness fields

Tools → `Yet AI: Show Runtime Status` and Tools → `Yet AI: Copy Diagnostics` include non-secret artifact freshness evidence when the installed plugin was built with metadata:

- `Build commit`: short commit SHA for the packaged artifact, or `unknown` when metadata is absent or malformed.
- `Build timestamp`: ISO build timestamp, or `unknown`.
- `Packaged GUI fingerprint`: short SHA-256 fingerprint for packaged GUI resources, or `unknown`.
- `Bundled engine fingerprint`: short SHA-256 fingerprint for the bundled `yet-lsp` resource when the plugin-owned bundled runtime path is in use, or `unknown` for external/connect/configured runtimes.
- `Runtime binary freshness`: `bundled match`, `mismatch`, `configured external`, `connect-mode external`, `unavailable`, or `unknown`.

Use these fields to confirm whether an installed ZIP includes the current 401 fixes:

1. Run `git rev-parse --short=12 HEAD` in the checkout used to build the artifact.
2. Open Tools → `Yet AI: Show Runtime Status` or copy diagnostics from the installed plugin.
3. Compare `Build commit` with the short checkout SHA. If it differs, reinstall a JetBrains artifact built from the intended commit.
4. For normal `auto`/`launch` installs with no configured engine path, expect `Runtime binary freshness: bundled match`. `mismatch` means the metadata and bundled engine bytes do not agree; rebuild/reinstall the artifact before debugging runtime 401s further.
5. For `connect` or configured external engine paths, freshness intentionally reports an external classification and does not claim the bundled engine is the runtime being used. Verify the external `yet-lsp` process separately with its own commit/build evidence.

If any metadata is unavailable, diagnostics stay usable and report `unknown` instead of failing. These fields are fingerprints only; they must not include private paths, tokens, provider secrets, full local environment dumps, or raw process output.

### Logs-based JetBrains 401 checklist

Use this checklist for one fresh local-runtime 401 reproduce in JetBrains Yet AI:

1. Reproduce the 401 once in the JetBrains Yet AI tool window.
2. Run Tools → Yet AI → Show Runtime Status and note the sanitized launch mode, runtime URL, runtime owner, token state, process state, and diagnosis.
3. Run Tools → Yet AI → Copy Diagnostics. Diagnostics are redacted; users should still never paste raw provider keys, local runtime session tokens, bearer headers, auth codes, cookies, request bodies, private paths, or other secrets into reports.
4. Run Tools → Yet AI → Open Logs Folder.
5. Inspect `yet-ai.log` for plugin-owned launch, reuse, health, retry, bridge, and host-ready correlation events.
6. Inspect `engine-&lt;port&gt;.log` for runtime-owned request/auth events. The filename uses the local runtime port, for example `engine-8001.log`.
7. If the port owner is unclear, replace `<PORT>` with the runtime URL port from status/diagnostics and run:

```sh
lsof -nP -iTCP:<PORT> -sTCP:LISTEN
ps aux | grep yet-lsp | grep -v grep
```

Classify the result from the copied diagnostics and the two log files:

| Evidence | Likely diagnosis |
| --- | --- |
| `connect` or external mode, no engine log, and 401 | External runtime token/URL mismatch. Start the intended loopback runtime yourself, then make the JetBrains Runtime URL and debug/session token match it. |
| `http.auth.reject reason=missing_header` | GUI/host handoff did not send the Authorization header to the runtime. Check `host.ready` delivery and refresh the runtime connection. |
| `http.auth.reject reason=token_mismatch` before a successful `runtime.401_retry` | Stale plugin-launched token was recovered by the one-time retry. Continue after the retry succeeds. |
| Repeated `http.auth.reject reason=token_mismatch` after `runtime.401_retry` | Wrong process owns the port, a stale external runtime is still being used, or the host-ready token was not propagated to the GUI. Check the port owner commands above, then restart the plugin-owned runtime or change the loopback port. |
| Engine log missing for `auto` or `launch` with a plugin-managed runtime | Launch environment/logging issue. Check `yet-ai.log`, Show Runtime Status, bundled/configured binary status, and whether `YET_AI_LOG_DIR` reached the launched runtime. |

These logs diagnose the local loopback runtime boundary only. Runtime 401s are local session-token/auth-header problems; provider 401s after the runtime connects are upstream BYOK provider credential problems handled by the engine/provider setup flow. This checklist does not require a hosted Yet AI backend, account, managed model gateway, product credit balance, cloud workspace, signing, marketplace publication, or production-release workflow.

### Installed OAuth callback 502 checklist

The callback page intentionally sends a restrictive Content Security Policy with `default-src 'none'`. DevTools warnings about blocked callback-page image or connection probes are expected and non-causal. Do not disable the policy or diagnose those warnings as the login failure.

A browser callback HTTP 502 means the listener at `localhost:1455` worked: the engine received the redirect, then token exchange or a post-exchange validation/storage step failed. Diagnose that boundary as follows:

1. Open Tools → `Yet AI: Show Runtime Status`. Record only the sanitized provider-auth category/status plus `Build commit` and `Runtime binary freshness`.
2. Compare `Build commit` with `git rev-parse --short=12 HEAD` from the checkout used for the ZIP. Reinstall the intended artifact if they differ. For normal bundled `auto`/`launch`, require `Runtime binary freshness: bundled match`; otherwise resolve the stale/mismatched/external runtime first.
3. Open Tools → `Yet AI: Open Logs Folder` and inspect `engine-<port>.log`, using the port from the sanitized runtime URL. Look for the allowlisted `provider_auth.exchange_failed` event fields only: provider, stage, category, endpoint class, and sanitized detail.
4. For transport or HTTP 5xx categories, the pending session should remain retryable. Retry once or use the GUI manual authorization-code exchange while it remains pending.
5. For exact HTTP 400 plus `oauth_error=invalid_grant`, start a fresh browser login and do not reuse the authorization code. Use the OpenAI API-key fallback when account login remains unavailable.

Never paste a raw callback URL, code, state, access/refresh token, Authorization header, cookie, query, provider response/body, session id, or private log path into diagnostics. This procedure does not claim official OpenAI OAuth support or production readiness; the account path remains experimental and real-account testing remains manual/high-risk/outside CI.

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
- JetBrains read-only LSP is an explicit experimental local-only lifecycle toggle, off by default, with verified `yet-lsp --lsp-stdio` process/no-secret/diagnostic policy tests but no native IntelliJ LSP client, provider calls, edits, or production completion claim.
- No marketplace packaging, signed/notarized engine bundle, or production installer is complete.
- The local launcher is an MVP: it sets token and HTTP port environment variables only, reads `/v1/ping`, and does not add LSP/completion wiring. JetBrains LSP client wiring is explicitly deferred for this sprint until the IntelliJ API path, stdio lifecycle, document bounds, URI policy, diagnostics, and smoke coverage are designed and verified.
- The bridge accepts `gui.ready`, strict read-only `gui.ideActionRequest` messages for `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`, plus dev-preview confirmed `gui.applyWorkspaceEditRequest` messages for bounded existing-file text replacements after explicit GUI apply and IDE/user confirmation. It emits `host.ready`, `host.openedFromCommand`, non-privileged active editor/selection `host.contextSnapshot`, correlated sanitized `host.ideActionProgress` / `host.ideActionResult` messages, and sanitized `host.applyWorkspaceEditResult` for confirmed edit outcomes. Browser fallback remains non-executing, and VS Code remains the reference confirmed workspace edit apply host.
- Settings use JetBrains application state for non-secret local runtime/debug URLs only. The local session token uses JetBrains PasswordSafe.
- Packaged GUI assets are generated build output from `apps/gui/dist`; they are copied into Gradle build resources but are not committed and this is not a final release packaging flow.
- No LSP client, completions, production workspace edit support, workspace create/delete/rename/apply-patch path, tools, IDE tools beyond the three safe read-only controlled actions, shell/git/task actions, arbitrary file reads/indexing, provider actions, autonomous edits, silent mutation, or unconfirmed edit apply support is implemented. Confirmed edit-proposal apply is dev-preview only and bounded to existing workspace-relative text replacements through the existing apply/result bridge contract.
- Current chat support is limited to the local provider/chat MVP exposed by the engine and GUI.
- Runtime binary `PATH` discovery is retained only as a dev-preview fallback after bundled/configured discovery; installable artifacts should use the bundled runtime or an explicit absolute engine path.


## Safety rules

- Do not add hosted backend requirements for core chat or agent workflows.
- Do not duplicate chat state, provider secrets, provider adapters, or engine-owned configuration inside plugin storage.
- Validate bridge messages before dispatch, require the exact bridge version, and keep the accepted GUI message allowlist narrow.
- Use exact dev iframe target origins and check inbound iframe origins before forwarding.
- Never log bridge payloads that may contain local runtime credentials.
- Keep privileged editor operations behind strict schemas, request-response correlation, and confirmation policy before adding them.
- Keep marketplace identity values aligned with `product/identity.json`.
