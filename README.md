# Yet AI

Yet AI is an architecture-inspired independent AI coding assistant for IDEs. The repository now has a buildable local MVP foundation: a Rust local runtime, provider registry, OpenAI-compatible streaming path, React/Vite GUI shell, VS Code webview host shell, JetBrains JCEF host shell, and typed contracts between them.

## Current status

- Approach: independent architecture-inspired rebuild, not a fork or rename of any external project.
- Baseline: buildable MVP scaffolds exist for the engine, GUI, VS Code plugin, and JetBrains plugin. They are suitable for local development and contract hardening, not production release.
- Product-sensitive values should be centralized in `product/identity.json` where practical. Temporary identity placeholders remain until final product IDs, publishers, domains, and marketplace metadata are approved.
- Runtime strategy: local-first BYOK. The IDE plugin starts or connects to the local Yet AI runtime on the user's machine; there is no required Yet AI account, hosted backend, managed model gateway, product credit balance, or cloud workspace for core workflows.
- Model requests go directly from the local runtime to configured hosted providers or local runtimes. Provider settings and credentials remain local, and GUI-facing responses must not include raw secrets.
- Limitations: the baseline is not production-ready; full agent autonomy, indexing, tool execution, packaged GUI assets, engine launch packaging, LSP features, and privileged IDE actions are not complete.

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

Each subsystem README describes current ownership, implemented surfaces, commands, dependencies on `product/identity.json` and contracts, current limitations, and safety rules.

## Verification

Install root development dependencies in a fresh checkout before running validation:

```sh
npm ci
```

If a lockfile-compatible install is not available in your local workflow, use:

```sh
npm install
```

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
