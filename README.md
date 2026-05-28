# Yet AI

Yet AI is an architecture-inspired independent AI coding assistant for IDEs. The repository now has a buildable local MVP foundation: a Rust local runtime, provider registry, OpenAI-compatible streaming path, React/Vite GUI shell, VS Code webview host shell, JetBrains JCEF host shell, and typed contracts between them.

## Current status

- Approach: independent architecture-inspired rebuild, not a fork or rename of any external project.
- Baseline: buildable MVP scaffolds exist for the engine, GUI, VS Code plugin, and JetBrains plugin. They are suitable for local development and contract hardening, not production release.
- IDE preview status: VS Code and JetBrains shells can use packaged GUI assets generated from `apps/gui/dist`, or a loopback GUI dev server, and both support MVP local runtime `connect`, `launch`, and `auto` workflows for `yet-lsp`.
- Product-sensitive values should be centralized in `product/identity.json` where practical. Temporary identity placeholders remain until final product IDs, publishers, domains, and marketplace metadata are approved.
- Runtime strategy: local-first BYOK. The IDE plugin starts or connects to the local Yet AI runtime on the user's machine; there is no required Yet AI account, hosted backend, managed model gateway, product credit balance, or cloud workspace for core workflows.
- Model requests go directly from the local runtime to configured hosted providers or local runtimes. Provider settings and credentials remain local, and GUI-facing responses must not include raw secrets.
- Provider-auth status: the safe/default real-provider path is the OpenAI API-key or project-key fallback through the local runtime. The GUI now presents a more productized OpenAI account-login card with guided unavailable, pending, connected, expired/revoked, sanitized-error, API-key-configured, retry, reconnect, disconnect, and API-key fallback states. That account path is still a separate explicit-risk experimental Codex-like flow backed by engine-owned PKCE/session state, sanitized provider-auth status, local secret storage, and chat fallback when no API-key provider is configured. It is private-endpoint-style, not official public OpenAI OAuth support, not an OpenAI partnership claim, and not production-ready. Automated coverage for that account path is loopback/mock-only; any real account testing is manual, high-risk, account-specific, outside CI, and must capture only sanitized evidence.
- Limitations: the baseline is not production-ready; no marketplace packaging, signed or notarized engine bundles, production installer, LSP/completions/tools/file edits, full agent autonomy, indexing, or integration workflows are complete. Current chat is a local provider/chat MVP only.

## Repository map

```text
apps/
  engine/              # Rust local runtime: authenticated loopback HTTP/SSE, providers, OpenAI-compatible streaming
  gui/                 # React/Vite shell: runtime client, provider setup, chat/SSE, debug bridge
  plugins/
    vscode/            # VS Code shell: webview host, loopback runtime settings, bridge hardening
    jetbrains/         # JetBrains shell: JCEF host, loopback runtime settings, PasswordSafe token, bridge hardening
packages/
  contracts/           # Shared schemas, examples, and boundary contracts
```

Each subsystem README describes current ownership, implemented surfaces, commands, dependencies on `product/identity.json` and contracts, current limitations, and safety rules. For the first manual VS Code dev-preview path with the packaged GUI and local engine launcher, see `apps/plugins/vscode/README.md`. For a manual IntelliJ IDEA install-from-disk ZIP preview, see `apps/plugins/jetbrains/README.md`.

## Verification

Install root development dependencies in a fresh checkout before running validation:

```sh
npm ci
```

If a lockfile-compatible install is not available in your local workflow, use:

```sh
npm install
```

Run the local smoke test from the root to exercise the engine/provider/chat path without real provider credentials or hosted services:

```sh
npm run smoke:local
```

`npm run smoke:local` starts the Rust engine on a free loopback port through Cargo, starts local mock OpenAI-compatible, experimental token, and experimental chat endpoints, configures a fake local API key, checks ping/caps/provider setup/chat command/SSE streaming, exercises provider-auth default status plus the local mock OAuth start/exchange/status/disconnect flow, and covers the approved experimental Codex-like start/exchange/chat fallback through loopback mocks only. Runtime and provider-test regressions use deterministic loopback mock helpers; Authorization expectations are asserted by the Rust test bodies from observed mock requests rather than hidden provider calls. It verifies raw fake API keys, OAuth access tokens, refresh tokens, Authorization header values, cookies, PKCE verifier values, mock auth codes, and Codex credential-file paths are not present in client-visible responses or events. Prerequisites: Node 18+ with root dependencies installed and a Rust toolchain with Cargo on `PATH`.

Run repository validation from the root before publishing or handing off changes:

```sh
npm run check
```

`npm run check` validates product identity, public repository hygiene, the documentation index, and contract schemas/examples, including required positive and negative contract fixture coverage.

Contract schemas and examples can be validated separately with:

```sh
npm run validate:contracts
```

`npm run validate:contracts` validates contract schemas/examples only, including mapped examples and product identity fields embedded in contract examples.

Current baseline subsystem checks are:

```sh
cargo check
cargo test
cd apps/gui && npm install && npm run typecheck && npm run build && npm test
cd apps/plugins/vscode && npm install && npm run compile
cd apps/plugins/jetbrains && node scripts/check-identity.mjs && gradle test --console=plain && gradle build --console=plain
```

Manual IDE dev-preview flows are documented in the subsystem READMEs:

- `apps/plugins/vscode/README.md` — packaged GUI copy flow plus `connect`/`launch`/`auto` runtime modes.
- `apps/plugins/jetbrains/README.md` — Gradle packaged GUI resource flow plus `connect`/`launch`/`auto` runtime modes.
- `apps/gui/README.md` — GUI build/dev commands and runtime token behavior.
- `apps/engine/README.md` — local `yet-lsp` run command and runtime API status.

### Runtime token quick guide

There are two separate secret categories in the dev preview:

- Local runtime Session token: authorizes GUI-to-`yet-lsp` loopback HTTP/SSE requests only.
- Provider API key: authorizes model-provider calls made by the local runtime, for example an OpenAI API key saved through Provider setup.

For IDE-launched runtimes, do not paste `local-dev-token` into the GUI. In VS Code and JetBrains `auto` or `launch` mode, the plugin generates a local runtime token, starts `yet-lsp` with `YET_AI_AUTH_TOKEN`, and provides the token to the packaged GUI through trusted `host.ready` bootstrap. In the normal VS Code dev-preview path, run `npm run prepare:vscode-preview`, keep `yetai.launchMode = auto`, open the Extension Development Host, and run `Yet AI: Open Chat`; do not manually run `yet-lsp` or copy a runtime token. In JetBrains normal dev-preview testing, keep `Launch mode = auto` or `launch` and set `Engine binary path = /absolute/path/to/target/debug/yet-lsp` only when discovery from `PATH` is insufficient.

Use `local-dev-token` only for a manually started runtime:

```sh
YET_AI_AUTH_TOKEN=local-dev-token YET_AI_HTTP_PORT=8001 cargo run -p yet-lsp
```

Then set GUI runtime settings to `Runtime base URL = http://127.0.0.1:8001` and `Session token = local-dev-token`. Do not put OpenAI or provider API keys in the Session token field; choose the GUI `OpenAI API` provider preset, paste the provider key once in the API key field, save, and confirm the field clears.

### First-message IDE smoke

Use this concise smoke after preparing either IDE dev preview. For VS Code, the default path is no manual runtime launch and no runtime-token copying:

1. Run `npm run prepare:vscode-preview` from the repository root for VS Code, or the matching prepare command for another IDE preview.
2. In the VS Code Extension Development Host, keep `yetai.launchMode = auto` and run `Yet AI: Open Chat`. The extension discovers or uses the copied engine, starts it with `YET_AI_AUTH_TOKEN`, and sends the local runtime Session token to the GUI only through trusted `host.ready`.
3. Do not manually run `yet-lsp` or paste `local-dev-token` for the normal VS Code preview. Use the manual runtime command only for deliberate `connect`-mode debugging.
4. Click `Refresh runtime`. It checks `/v1/ping`, `/v1/caps`, `/v1/models`, provider summaries, and OpenAI provider-auth status through the local runtime.
5. Interpret runtime feedback: connected means the loopback runtime and model/provider metadata are reachable; network/configuration errors mean URL, port, binary, or runtime startup problems; runtime `401` means the local Session token does not match `YET_AI_AUTH_TOKEN`; provider `401` means the provider API key was rejected by the upstream provider.
6. Configure the safe/default `OpenAI API` API-key fallback or a local OpenAI-compatible mock/provider. The provider key belongs only in Provider setup, is sent to the local runtime, clears after save, and must not be stored in VS Code settings or the Session token field.
7. Use provider test/status as sanitized feedback, then send `Say hello in one sentence.` Expected behavior: the user message is accepted, SSE opens, the assistant streams snapshot/start/delta/finish updates, and no Yet AI hosted backend or account is required.

A login/account-based GPT first-message UX remains a mandatory future milestone. The current experimental Codex-like account path is separate, explicit-risk, mock-only in automation, and not the default first-message path.

For JetBrains runtime failures, use Tools → `Yet AI: Show Runtime Status` for sanitized launch/binary/ping diagnostics and Tools → `Yet AI: Restart Runtime` to restart only the plugin-owned local runtime.

### JetBrains installable ZIP dev preview

Build a local IntelliJ IDEA install-from-disk ZIP with:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:jetbrains-preview
```

The command builds/prepares `yet-lsp`, builds `apps/gui`, runs the JetBrains Gradle build, prints the original ZIP path under `apps/plugins/jetbrains/build/distributions/`, and copies the current dev-preview artifact plus checksum to the stable ignored root path `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` and `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip.sha256`. It also prints the local `Engine binary path` to configure when the plugin cannot discover the engine from `PATH`.

Manual IntelliJ IDEA smoke steps:

1. Run `npm run prepare:jetbrains-preview`.
2. Open IntelliJ IDEA Settings/Preferences → Plugins → gear → Install Plugin from Disk.
3. Choose the stable root ZIP at `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` and restart the IDE. The Gradle output path printed under `apps/plugins/jetbrains/build/distributions/` is kept for diagnostics.
4. Set `Launch mode` / `Engine binary path` if needed.
5. Open the Yet AI tool window and verify the packaged UI/chat path.
6. Optional safe provider smoke: use the OpenAI API-key fallback. The experimental account login remains explicit-risk; automated coverage is mock-only and real account testing is manual/high-risk/outside CI.

Validate the local ZIP without launching an IDE:

```sh
npm run smoke:jetbrains-installable
```

The smoke checks Gradle ZIP structure, the copied root `dist/plugins/jetbrains/` dev-preview artifact, checksum matching, packaged GUI contents, and docs only. No provider credentials, real OpenAI/ChatGPT calls, hosted Yet AI services, signing, marketplace publication, production installer, or bundled notarized engine are involved.

### Manual OpenAI API-key milestone smoke

The current real-provider milestone is a manual VS Code dev-preview smoke path for the OpenAI API-key fallback only. It is not an automated test, does not require a Yet AI hosted backend, and must never commit, log, screenshot, or paste a real key into issue text or repository files.

Use `apps/plugins/vscode/README.md#openai-api-key-fallback-milestone-smoke` for the detailed checklist:

1. Run `npm run prepare:vscode-preview` from the repository root.
2. Open the Extension Development Host, keep `yetai.launchMode = auto`, and run `Yet AI: Open Chat`; do not manually start `yet-lsp` or paste `local-dev-token` for this normal preview path.
3. Choose the GUI `OpenAI API` preset, paste an API key once in Provider setup, save, and confirm the key field clears.
4. Confirm the GUI and runtime show only configured/redacted provider status, never the raw key, and never ask for the provider key in VS Code settings or the Session token field.
5. Use provider test/status as sanitized feedback, then send `Say hello in one sentence.` and verify snapshot plus streaming response behavior.

Current real-provider testing should use an OpenAI API-key or project-key fallback through the local runtime. This remains the safe/default path.

### Manual experimental account-login checklist

Use this checklist only for an explicitly accepted manual real-account run of the experimental Codex-like account path. It is safe to share as a process checklist, but the resulting evidence must stay sanitized. Do not run this checklist in CI, smoke scripts, or unattended automation.

1. Confirm the tester understands the flow is experimental, private-endpoint-style, account-specific, high-risk, not official public OpenAI OAuth support, not an OpenAI partnership, and not production-ready.
2. Record only non-secret preconditions: OS, IDE, launch mode, whether the GUI opened from packaged assets, and whether the local runtime used `auto` / `launch` without manual runtime-token copying.
3. Review visible consent and scopes before continuing. Record scope names and consent wording only if they do not contain tokens, authorization codes, account-private URLs, cookies, or other secrets.
4. Start the account flow from the GUI account-login card. Verify pending guidance appears without raw session IDs, PKCE verifier values, authorization codes, cookies, access tokens, refresh tokens, or credential-file paths.
5. Complete connect/exchange only through the GUI/runtime flow. Do not paste secrets into reports, logs, screenshots, issues, fixtures, or repository files.
6. After connected status, verify the GUI shows only sanitized account labels, scopes, expiry, status, and redacted hints. Send `Say hello in one sentence.` and record only sanitized first-message success or sanitized failure text.
7. Exercise safe failure paths when feasible: denied consent, expired or revoked session, provider outage/unavailable model, and retry/reconnect behavior. Evidence must be sanitized and must not include raw provider responses.
8. Disconnect, then reconnect if the task asks for relogin coverage. Confirm disconnect/reconnect states are sanitized and that API-key fallback remains available.
9. Before sharing results, remove secrets from terminal scrollback, screenshots, browser devtools, notes, and issue text. Reports may include status labels, redacted account hints, non-secret scope names, timestamps, and concise sanitized errors only.

A login/account-based GPT first-message UX is still a mandatory future milestone, but it is not the default current VS Code first-message path. The user approved a T-49 experimental Codex-like login task chain even though no public third-party OpenAI OAuth program has been identified. That approval allows engine-owned PKCE/session state, authorization/token exchange, refresh, revoke/disconnect, sanitized GUI status, and local secret storage modeled after Codex-like behavior. The local smoke test covers this path only with loopback token and chat mocks; CI must not call OpenAI, ChatGPT, private Codex endpoints, or use real account credentials for this flow. Any real provider testing of the experimental path is manual, risky, account-specific, and outside CI. It does not approve cookie scraping, browser profile import, browser cookie reuse, direct import or reading of `~/.codex/auth.json` or other tools' credential files, or any required Yet AI hosted backend, account, managed gateway, product credit balance, or cloud workspace. This approval does not imply production readiness, official OpenAI partnership, or general public OAuth support; private endpoint and client-identity risk must stay visible in implementation and docs.

Run these when changing the corresponding subsystem. The required verification for documentation-only status updates remains `npm run check`.

## Architecture docs

Start here:

- `docs/README.md` — documentation layout and contribution rules.
- `docs/architecture/000-reference-architecture-baseline.md` — external architecture baseline and product-sensitive surfaces to avoid copying blindly.
- `docs/architecture/001-product-identity.md` — identity contract based on `product/identity.json`.
- `docs/architecture/002-product-differentiation-and-provenance.md` — differentiation, provenance, and publication safety rules.
- `docs/architecture/003-target-architecture.md` — target Yet AI architecture, subsystem boundaries, contracts, and roadmap.
- `docs/architecture/004-implementation-strategy.md` — implementation strategy and selective reuse policy.
- `docs/architecture/005-publication-hygiene.md` — public repository hygiene and first-publication checklist.

## Agent guidance

Future agents must read `AGENTS.md` before changing the repository. Important rules: keep public tracked files free of external project identifiers, use local ignored files for private reference notes, avoid broad product renames unless requested, avoid large external code copies without explicit task approval, preserve license and attribution if code or assets are copied later, and keep changes incremental with verification commands.
