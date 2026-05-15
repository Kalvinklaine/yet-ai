# Yet AI

Yet AI is a future AI coding assistant for IDEs. The project is an architecture-inspired independent implementation with a local engine, web GUI, VS Code plugin, JetBrains plugin, and typed contracts between them. The repository is currently in the architecture planning and foundation stage; subsystem implementations are not yet claimed as ready.

## Current status

- Approach: independent architecture-inspired rebuild, not a fork or rename of any external project.
- Main focus: architecture documentation, product identity, subsystem boundaries, public repository hygiene, and a safe scaffold plan.
- Temporary identity placeholders are acceptable until final product IDs, publishers, domains, and marketplace metadata are approved.
- Product-sensitive values should be centralized in `product/identity.json` where practical.

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
