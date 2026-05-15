# Yet AI Agent Instructions

Yet AI is an architecture-inspired independent implementation of an AI coding assistant for developer IDEs. The repository must present Yet AI as its own product with its own identity, UI, packaging, storage, and runtime contracts.

## Core rules for future agents

- Do not perform broad product renames unless a task explicitly asks for one.
- Do not copy large code blocks from external reference implementations without explicit approval in the task.
- Keep product-sensitive values centralized in `product/identity.json` where practical: names, IDs, package names, binary names, storage dirs, marketplace metadata, URLs, and publishers.
- Temporary identity placeholders are acceptable until final product IDs, publishers, domains, support links, and marketplace accounts are finalized.
- If external code or assets are copied later, check license and attribution requirements first, then preserve required notices and provenance intentionally.
- Keep public tracked files free of external project identifiers. Use ignored local-only files for private reference notes, such as `AGENTS.local.md`, `.local/`, or `.agent-local/`.
- Do not add external project names to ignore rules, public docs, scripts, examples, or generated files.
- Make incremental, testable changes. Every task should have a clear verification command and avoid mixing unrelated changes.
- Maintain architecture docs in `docs/architecture/`. Update them before irreversible decisions about layout, protocols, storage, identity, or packaging.
- Document new conventions when they appear: where to store data, how to verify changes, which commands to run, and which subsystem boundaries to respect.

## Expected subsystem boundaries

Long-term project boundaries are described in `docs/architecture/003-target-architecture.md`. Do not create implementation before it is needed, but preserve these ownership boundaries:

- `engine`: local service / LSP / HTTP / SSE / tools / providers / storage.
- `GUI`: React webview, new Yet AI UI/design system, typed engine and IDE bridge clients.
- `VS Code plugin`: extension manifest, engine launcher, webview host, postMessage bridge, optional LSP client.
- `JetBrains plugin`: plugin metadata, engine launcher, JCEF webview host, bridge, optional LSP client.
- `product identity`: `product/identity.json` and its schema/docs.
- `scripts`: validation, generation, build/package helpers; no hidden app logic.

## Documentation map

Read these before architecture or scaffold work:

- `docs/architecture/000-reference-architecture-baseline.md` — external architecture baseline and product-sensitive surfaces.
- `docs/architecture/001-product-identity.md` — Yet AI identity contract and maintenance rule.
- `docs/architecture/002-product-differentiation-and-provenance.md` — differentiation, provenance, and publication safety rules.
- `docs/architecture/003-target-architecture.md` — target boundaries, contracts, and phased roadmap.
- `docs/architecture/004-implementation-strategy.md` — implementation strategy and selective reuse gates.
- `docs/architecture/005-publication-hygiene.md` — public repository hygiene and first-publication checklist.
- `product/identity.json` — current source of truth for temporary product identity values.

## Working style

- Keep changes small and report clear verification steps.
- Do not claim a subsystem is implemented if only a plan or documentation scaffold exists.
- Prefer bilingual or Russian documentation when useful for the current owner; keep technical identifiers in English.
- If you introduce a new build or test command, add it to the appropriate README or docs page.
