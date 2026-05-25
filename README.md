# Yet AI

Yet AI is an architecture-inspired independent AI coding assistant for IDEs. The repository now has a buildable local MVP foundation: a Rust local runtime, provider registry, OpenAI-compatible streaming path, React/Vite GUI shell, VS Code webview host shell, JetBrains JCEF host shell, and typed contracts between them.

## Current status

- Approach: independent architecture-inspired rebuild, not a fork or rename of any external project.
- Baseline: buildable MVP scaffolds exist for the engine, GUI, VS Code plugin, and JetBrains plugin. They are suitable for local development and contract hardening, not production release.
- IDE preview status: VS Code and JetBrains shells can use packaged GUI assets generated from `apps/gui/dist`, or a loopback GUI dev server, and both support MVP local runtime `connect`, `launch`, and `auto` workflows for `yet-lsp`.
- Product-sensitive values should be centralized in `product/identity.json` where practical. Temporary identity placeholders remain until final product IDs, publishers, domains, and marketplace metadata are approved.
- Runtime strategy: local-first BYOK. The IDE plugin starts or connects to the local Yet AI runtime on the user's machine; there is no required Yet AI account, hosted backend, managed model gateway, product credit balance, or cloud workspace for core workflows.
- Model requests go directly from the local runtime to configured hosted providers or local runtimes. Provider settings and credentials remain local, and GUI-facing responses must not include raw secrets.
- Provider-auth status: the safe/default real-provider path is the OpenAI API-key or project-key fallback through the local runtime. The GUI also exposes a separate explicit-risk experimental Codex-like OpenAI account action backed by engine-owned PKCE/session state, sanitized provider-auth status, local secret storage, and chat fallback when no API-key provider is configured. Automated coverage for that account path is loopback/mock-only; any real account testing is manual, high-risk, account-specific, outside CI, and not official public OpenAI OAuth support or production-ready.
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

`npm run smoke:local` starts the Rust engine on a free loopback port through Cargo, starts local mock OpenAI-compatible, experimental token, and experimental chat endpoints, configures a fake local API key, checks ping/caps/provider setup/chat command/SSE streaming, exercises provider-auth default status plus the local mock OAuth start/exchange/status/disconnect flow, and covers the approved experimental Codex-like start/exchange/chat fallback through loopback mocks only. It asserts the mock providers receive the expected Authorization headers internally while verifying raw fake API keys, OAuth access tokens, refresh tokens, Authorization header values, cookies, PKCE verifier values, mock auth codes, and Codex credential-file paths are not present in client-visible responses or events. Prerequisites: Node 18+ with root dependencies installed and a Rust toolchain with Cargo on `PATH`.

Run repository validation from the root before publishing or handing off changes:

```sh
npm run check
```

`npm run check` validates product identity, public repository hygiene, the documentation index, and contract schemas/examples.

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

### JetBrains installable ZIP dev preview

Build a local IntelliJ IDEA install-from-disk ZIP with:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:jetbrains-preview
```

The command builds/prepares `yet-lsp`, builds `apps/gui`, runs the JetBrains Gradle build, and prints the ZIP path under `apps/plugins/jetbrains/build/distributions/` plus the local `Engine binary path` to configure when the plugin cannot discover the engine from `PATH`.

Manual IntelliJ IDEA smoke steps:

1. Run `npm run prepare:jetbrains-preview`.
2. Open IntelliJ IDEA Settings/Preferences → Plugins → gear → Install Plugin from Disk.
3. Choose the printed ZIP and restart the IDE.
4. Set `Launch mode` / `Engine binary path` if needed.
5. Open the Yet AI tool window and verify the packaged UI/chat path.
6. Optional safe provider smoke: use the OpenAI API-key fallback. The experimental account login remains explicit-risk; automated coverage is mock-only and real account testing is manual/high-risk/outside CI.

Validate the local ZIP without launching an IDE:

```sh
npm run smoke:jetbrains-installable
```

The smoke checks ZIP structure and docs only. No provider credentials, real OpenAI/ChatGPT calls, hosted Yet AI services, signing, marketplace publication, production installer, or bundled notarized engine are involved.

### Manual OpenAI API-key milestone smoke

The current real-provider milestone is a manual VS Code dev-preview smoke path for the OpenAI API-key fallback only. It is not an automated test, does not require a Yet AI hosted backend, and must never commit, log, screenshot, or paste a real key into issue text or repository files.

Use `apps/plugins/vscode/README.md#openai-api-key-fallback-milestone-smoke` for the detailed checklist:

1. Prepare the local VS Code dev preview with the packaged GUI and local `yet-lsp` launcher.
2. Open `Yet AI: Open Chat` in the Extension Development Host.
3. Choose the GUI `OpenAI API` preset, paste an API key once, save, and confirm the key field clears.
4. Confirm the GUI and runtime show only configured/redacted provider status, never the raw key.
5. Send `Say hello in one sentence.` and verify snapshot plus streaming response behavior.

Current real-provider testing should use an OpenAI API-key or project-key fallback through the local runtime. This remains the safe/default path.

The user approved a T-49 experimental Codex-like login task chain even though no public third-party OpenAI OAuth program has been identified. That approval allows engine-owned PKCE/session state, authorization/token exchange, refresh, revoke/disconnect, sanitized GUI status, and local secret storage modeled after Codex-like behavior. The local smoke test covers this path only with loopback token and chat mocks; CI must not call OpenAI, ChatGPT, private Codex endpoints, or use real account credentials for this flow. Any real provider testing of the experimental path is manual, risky, account-specific, and outside CI. It does not approve cookie scraping, browser profile import, browser cookie reuse, direct import or reading of `~/.codex/auth.json` or other tools' credential files, or any required Yet AI hosted backend, account, managed gateway, product credit balance, or cloud workspace. This approval does not imply production readiness, official OpenAI partnership, or general public OAuth support; private endpoint and client-identity risk must stay visible in implementation and docs.

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
