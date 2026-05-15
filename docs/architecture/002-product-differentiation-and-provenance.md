# 002 Product Differentiation and Provenance

Yet AI is an architecture-inspired independent implementation, not a fork or rename of any external project. This audit separates product identity surfaces from reusable architecture patterns so implementation can proceed safely: define identity, scaffold clean components, preserve useful contracts where intentional, and redesign the user experience independently.

## Classification rules

- **Identity**: names, IDs, publishers, vendors, package namespaces, product strings, support links, and anything users or marketplaces associate with one product.
- **Architecture**: subsystem boundaries and runtime contracts, such as local engine plus IDE plugin plus webview, command APIs, SSE streams, optional LSP lifecycle, tool confirmation boundaries, and provider capability discovery.
- **UI design**: layout, visual language, iconography, onboarding, copy tone, component styling, and interaction details.
- **Storage**: local config, cache, project state, generated data, secrets, credentials, and migration boundaries.
- **Build**: crate names, package artifacts, release scripts, bundled binary paths, CI outputs, and debug launch defaults.
- **Marketplace**: stable extension/plugin IDs, publisher/vendor accounts, command namespaces, configuration namespaces, update channels, screenshots, descriptions, reviews, and install bases.
- **Provenance**: documented origin, license obligations, notices, and review status for any copied or substantially adapted code/assets.

## Differentiation matrix

| Area | Yet AI rule | Risk if copied blindly | Verification needed |
|---|---|---|---|
| Engine crate and binary naming | Use `engine.rustCrate` and `engine.binaryName` from `product/identity.json`. | Artifact collisions, confusing diagnostics, stale launcher paths, and unclear ownership. | Engine manifests, binary target, release artifacts, IDE launchers, logs, diagnostics, and CI outputs use Yet AI values. |
| HTTP, SSE, and LSP contracts | Keep proven protocol patterns only when they are documented as Yet AI contracts. | Accidental compatibility claims and undocumented quirks. | Contract tests for command submission, SSE snapshot and sequence recovery, LSP startup when present, and IDE bridge readiness. |
| GUI package and app shell | Use `gui.npmPackage` and build a new Yet AI interface. | Inherited visual design, copy, hidden assumptions, and package metadata. | Package metadata, build outputs, page titles, screenshots, and UI tests show Yet AI identity and new design. |
| VS Code marketplace identity | Use Yet AI publisher/name/display values; replace placeholders before publication. | Marketplace lineage confusion, broken migration path, and user trust issues. | VSIX manifest, marketplace preview, README, icons, repository, bugs, support, and publisher account all point to Yet AI. |
| VS Code commands and settings | Use stable Yet AI namespaces from identity. | User settings and keybindings can break if renamed later. | Manifest contributions, command registrations, context keys, docs, keybindings, and settings examples use Yet AI prefixes only. |
| JetBrains marketplace identity | Use Yet AI plugin ID, group, plugin name, and package namespace. | Update lineage and marketplace identity become hard to change. | Plugin metadata, Gradle properties, verifier output, vendor fields, and update checks use Yet AI identity. |
| JetBrains actions and settings | Use Yet AI tool window names, settings IDs, notification groups, and packages. | Persistent IDE settings and action IDs can conflict with other products. | Source package paths, plugin metadata, resource bundles, actions, settings, and notifications use Yet AI wording only. |
| Config, cache, and project dirs | Use `.yet-ai`, user config `yet-ai`, and user cache `yet-ai`. | Local data, secrets, indexes, and task state can collide with another product. | Engine, GUI, plugins, ignore rules, diagnostics, backups, exports, and tests use Yet AI dirs. |
| Docs and site URLs | Use placeholder or final Yet AI URLs from identity. | Users can be routed to unrelated support, issue, and documentation channels. | Grep docs, manifests, plugin metadata, README files, support links, issue templates, and UI error links. |
| UI labels and visual design | Use Yet AI labels and a new design system. | A text-only rename can leave a derivative user experience. | UI inventory, screenshots, resource strings, accessibility labels, notifications, menus, and onboarding use Yet AI wording and design. |
| Update and download channels | Use independent artifacts, release buckets, signing, checksums, and marketplace IDs. | Wrong channels can download incompatible binaries or update the wrong product lineage. | Build scripts, CI workflows, installer assets, update requests, checksums, and release notes point to Yet AI channels. |
| License and attribution | Preserve notices and provenance for copied code/assets. | Missing attribution and unclear ownership. | License files, NOTICE/attribution docs, dependency reports, copied-file provenance log, and distributions include required material. |

## Safe early changes

- Establish `product/identity.json` as the source of truth for new product-sensitive values.
- Use separate storage roots: `.yet-ai`, user config `yet-ai`, and user cache `yet-ai`.
- Scaffold new engine, GUI, VS Code, and JetBrains packages with Yet AI names from the start.
- Define protocol contracts for HTTP, SSE, optional LSP, and IDE bridge behavior before copying implementation details.
- Keep placeholders private and visibly marked until publisher/vendor accounts and URLs are final.
- Build a new UI shell and visual direction instead of recoloring an external UI.
- Keep public tracked files free of external project identifiers; private reference notes belong only in ignored local files.

## Values that become permanent after marketplace publication

- VS Code publisher plus extension name and the resulting extension ID.
- VS Code command IDs, configuration namespace, context keys, view IDs, and user-facing settings.
- JetBrains plugin ID, vendor identity, package/update lineage, configurable IDs, notification group IDs, and action IDs.
- Public update/download channels, release signing, artifact names, and compatibility metadata.
- Public documentation URLs, support URLs, screenshots, marketplace descriptions, and privacy/security claims.

Freeze these values before public release. If a placeholder is still present, do not publish to a public marketplace.

## Non-goals

- No broad copy-and-rename as the first implementation step. That hides architecture decisions, preserves unwanted coupling, and can miss marketplace/storage/legal surfaces.
- No automatic import of secrets, provider credentials, trajectories, task state, privacy settings, telemetry IDs, or local indexes from external products.
- No claim of binary, plugin, or marketplace compatibility with any external product unless a future product requirement explicitly defines and tests that compatibility.
- No reuse of external icons, screenshots, marketplace copy, support links, or visual design as Yet AI final design.

## Legal and attribution reminder

This audit is not legal advice. External implementations can inform architecture, but any later code, asset, documentation, icon, or configuration copied from outside the repository must preserve applicable license terms, copyright notices, attribution, and third-party dependency obligations. Keep provenance records for copied or adapted files and generate a NOTICE or attribution file before distribution if required by the copied material's license.
