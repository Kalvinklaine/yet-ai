# 001 Product Identity

Yet AI needs one product identity contract before implementation starts. The project is an architecture-inspired rebuild, not a direct an external project rename, so the contract records the new product names, package IDs, storage names, plugin IDs, and public URLs independently from any source project.

The source of truth is `product/identity.json`. The companion `product/identity.schema.json` keeps the contract valid with required sections and simple string patterns.

## Why this exists

Product identity values appear in package manifests, plugin marketplace metadata, binary names, settings keys, filesystem paths, generated documentation, and support links. If each implementation hardcodes these strings independently, branding and IDs will drift and migrations will become risky.

New product-sensitive implementation should read from this identity file, generate from it, or document why generation is not practical. Do not hardcode product-sensitive strings in new code when a value belongs in the identity contract.

## Field ownership and future usage

### `product`

Owned by product architecture.

- `displayName`: user-facing product name, currently `Yet AI`. Use in app chrome, marketplace titles, documentation headings, and onboarding.
- `id`: stable product identifier, currently `yet-ai`. Use for generated slugs, release metadata, and cross-component references.
- `shortName`: compact name, currently `Yet`. Use where UI space is constrained.
- `strategy`: records that this is an `architecture-inspired-rebuild`, not a an external project fork rename.
- `description`: human-readable explanation for maintainers and future audits.

### `storage`

Owned by engine and plugin platform maintainers.

- `projectDir`: project-local state directory, currently `.yet-ai`. Use for trajectories, knowledge, task state, integration config, and project metadata.
- `configDir`: user config directory name, currently `yet-ai`. Use under platform-specific config roots.
- `cacheDir`: user cache directory name, currently `yet-ai`. Use under platform-specific cache roots for logs, indexes, downloads, and temporary state.

### `engine`

Owned by the Rust engine maintainers.

- `rustCrate`: Rust crate package placeholder, currently `yet-lsp`. Use in `Cargo.toml` when the engine scaffold is created.
- `binaryName`: shipped LSP/HTTP server binary placeholder, currently `yet-lsp`. Use in build scripts, plugin launchers, diagnostics, and release artifacts.

### `gui`

Owned by the web chat UI maintainers.

- `npmPackage`: browser/chat package placeholder, currently `yet-ai-chat-js`. Use in `package.json`, import examples, release automation, and package registry metadata.

### `vscode`

Owned by VS Code extension maintainers.

- `publisher`: temporary Marketplace publisher placeholder. Replace when the final publisher account exists.
- `name`: VS Code extension package name placeholder, currently `yet-ai`.
- `displayName`: VS Code Marketplace and extension UI name, currently `Yet AI`.
- `configurationPrefix`: settings namespace placeholder, currently `yetai`.
- `commandPrefix`: command ID namespace placeholder, currently `yetaicmd`.
- `activityBarId`: activity bar container ID placeholder, currently `yet-ai-toolbox-pane`.

These values correspond to fields and contribution IDs found in VS Code extension manifests.

### `jetbrains`

Owned by JetBrains plugin maintainers.

- `pluginId`: JetBrains plugin ID placeholder, currently `ai.yet.plugin`.
- `pluginGroup`: Gradle plugin group placeholder, currently `ai.yet`.
- `pluginName`: marketplace and IDE-visible plugin name, currently `Yet AI`.
- `packageNamespace`: Kotlin/Java package namespace placeholder, currently `ai.yet.plugin`.

These values correspond to Gradle properties, `plugin.xml`, service implementation namespaces, and marketplace metadata.

### `urls`

Owned by product and release maintainers.

- `repository`: placeholder source repository URL.
- `documentation`: placeholder documentation URL.
- `support`: placeholder support URL.
- `homepage`: placeholder product homepage URL.

Replace these when final public endpoints are available. Until then, placeholders make missing decisions explicit.

### `metadata`

Owned by product architecture.

- `status`: marks whether the identity is still `temporary-placeholders` or final.
- `owner`: accountable owner for reviewing identity changes.
- `lastReviewed`: review date for audits.

## Maintenance rule

When adding a new product-sensitive value, first decide whether it belongs in `product/identity.json`. If it does, update the JSON, update the schema, and update this document before using it elsewhere. Generated files and implementation code should consume the identity contract where practical instead of scattering hardcoded strings.
