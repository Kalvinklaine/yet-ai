# Yet AI Agent Instructions

Yet AI is a local-first AI coding assistant and IDE agent plugin product for developer IDEs. The repository must present Yet AI as its own product with its own identity, UI, packaging, storage, and runtime contracts.

## Core rules for future agents

- Do not perform broad product renames unless a task explicitly asks for one.
- Do not copy unapproved third-party code or assets into the product.
- Keep product-sensitive values centralized in `product/identity.json` where practical: names, IDs, package names, binary names, storage dirs, marketplace metadata, URLs, and publishers.
- Preserve the local-first BYOK contract: core Yet AI workflows must not require a hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace.
- Keep provider settings and credentials local-only. Raw provider secrets must not be persisted by GUI code or returned through GUI-facing responses after save.
- Temporary identity placeholders are acceptable until final product IDs, publishers, domains, support links, and marketplace accounts are finalized.
- If third-party code or assets are approved for use later, check license and attribution requirements first, then preserve required notices and provenance intentionally.
- Keep public tracked files free of external project identifiers. Use ignored local-only files for private reference notes, such as `AGENTS.local.md`, `.local/`, or `.agent-local/`.
- Do not add external project names to ignore rules, public docs, scripts, examples, or generated files.
- Make incremental, testable changes. Every task should have a clear verification command and avoid mixing unrelated changes.
- Maintain architecture docs in `docs/architecture/`. Update them before irreversible decisions about layout, protocols, storage, identity, or packaging.
- Document new conventions when they appear: where to store data, how to verify changes, which commands to run, and which subsystem boundaries to respect.

## Expected subsystem boundaries

Long-term project boundaries are described in `docs/architecture/003-target-architecture.md`. Do not create implementation before it is needed, but preserve these ownership boundaries:

- `engine`: local runtime authority for provider adapters, direct configured provider/local-runtime calls, credentials, LSP / HTTP / SSE / tools / storage.
- `GUI`: React webview, new Yet AI UI/design system, typed engine and IDE bridge clients; renders provider setup/status but does not persist raw provider secrets.
- `VS Code plugin`: extension manifest, local runtime launcher/connector, webview host, postMessage bridge, optional LSP client; does not duplicate provider adapters.
- `JetBrains plugin`: plugin metadata, local runtime launcher/connector, JCEF webview host, bridge, optional LSP client; does not duplicate provider adapters.
- `product identity`: `product/identity.json` and its schema/docs.
- `scripts`: validation, generation, build/package helpers; no hidden app logic.

## Documentation map

Read these before architecture or scaffold work:

- `docs/architecture/000-reference-architecture-baseline.md` — standalone subsystem baseline and product-sensitive surfaces.
- `docs/architecture/001-product-identity.md` — Yet AI identity contract and maintenance rule.
- `docs/architecture/002-product-differentiation-and-provenance.md` — differentiation, provenance, and publication safety rules.
- `docs/architecture/003-target-architecture.md` — target boundaries, contracts, and phased roadmap.
- `docs/architecture/004-implementation-strategy.md` — implementation strategy and selective reuse gates.
- `docs/architecture/005-publication-hygiene.md` — public repository hygiene and first-publication checklist.
- `product/identity.json` — current source of truth for temporary product identity values.

## Working style

- Keep changes small and report clear verification steps.
- When asked to add something to the backlog, leave it for later, create a task, or do it later, create a GitHub Issue in the Yet AI repository using local `gh` under the user's authenticated GitHub account. Do not treat it as backlogged until an issue URL is returned; if the request is ambiguous, summarize the proposed issue title/body and ask for confirmation first.
- Do not claim a subsystem is implemented if only a plan or documentation scaffold exists.
- Prefer bilingual or Russian documentation when useful for the current owner; keep technical identifiers in English.
- If you introduce a new build or test command, add it to the appropriate README or docs page.
