# 004 Implementation Strategy

Yet AI should use external architecture references as guidance, not as a fork. The user preference is explicit: build a similar kind of product with different design and UI, taking the main structure and runtime ideas without starting from a direct repository copy.

## Decision context

The earlier architecture package established these constraints:

- External reference implementations demonstrate useful subsystem boundaries: local engine, webview GUI, VS Code plugin, JetBrains plugin, HTTP/SSE chat contracts, optional LSP integration, provider/tool registries, and local storage.
- Yet AI has its own identity in `product/identity.json`: `Yet AI`, `yet-ai`, `yet-lsp`, `yet-ai-chat-js`, `.yet-ai`, `yetai`, and `ai.yet.plugin` placeholders.
- The target architecture prioritizes a new UI and design system, isolated storage, independent plugin IDs, and explicit runtime contracts.
- A broad copy-and-rename would preserve hidden coupling across storage, package metadata, UI wording, marketplace identity, update paths, and legal attribution surfaces.

## Approach comparison

### 1. Full fork or full copy

A full fork means copying an external repository as the Yet AI starting point and renaming or modifying it in place.

**Advantages**

- Fastest route to a large feature surface if the copied tree builds immediately.
- Existing engine, GUI, providers, tools, integrations, and plugin packaging may already be connected.
- Good for quickly evaluating reference behavior end to end in a private experiment.
- Reduces early blank-page implementation work.

**Disadvantages**

- Conflicts with the stated product direction: Yet AI is independent and should have different design/UI.
- Carries product-sensitive strings, storage paths, package names, marketplace IDs, update channels, URLs, UI labels, icons, and support links.
- Encourages broad renaming before architecture decisions are clear.
- Makes it hard to distinguish intentional compatibility from accidental copied behavior.
- Can leave external UX assumptions embedded in reducers, routes, settings, tests, docs, screenshots, and resource bundles.

**Recommendation**: reject as the default path.

### 2. Vendor reference copy, subtree, or submodule

A vendor reference means keeping external source available inside or beside the Yet AI repository as a read-only reference, git subtree, submodule, or archived source snapshot, while building Yet AI separately.

**Advantages**

- Keeps a concrete implementation nearby for comparison while avoiding a direct product fork.
- Makes it easier to inspect exact engine, GUI, and plugin behavior during implementation.
- Can support diff-based audits when deciding whether a module is worth porting.
- Avoids mixing external source directly into main Yet AI packages if kept clearly separate.

**Disadvantages**

- Adds repository weight and can confuse contributors about which code is production code.
- If not isolated, developers may import from the vendor tree casually and bypass interface decisions.
- Requires clear tooling rules so builds, package manifests, grep checks, and IDE indexing do not treat vendor code as Yet AI code.
- Can still create license and attribution obligations if redistributed with the product repository or source release.

**Recommendation**: avoid in the public repository unless a future task explicitly approves it with license/provenance rules.

### 3. Architecture-inspired clean scaffold

A clean scaffold means creating Yet AI packages from scratch around the chosen architecture: `apps/engine`, `apps/gui`, `apps/plugins/vscode`, `apps/plugins/jetbrains`, `product`, `docs`, and `scripts`. External implementations remain references, not production source.

**Advantages**

- Best match for the explicit user preference.
- Lets Yet AI identity, storage, package names, plugin IDs, and UI vocabulary be correct from day one.
- Makes new UI/design a foundation rather than a later cleanup.
- Keeps subsystem contracts intentional: HTTP, SSE, optional LSP, IDE bridge, storage, provider registry, and tool confirmations can be documented and tested before large feature work.
- Keeps early implementation small and practical.

**Disadvantages**

- Slower to reach feature parity.
- Requires rebuilding integrations and provider/tool behavior incrementally.
- Some solved implementation details will need to be rediscovered unless selectively reused later.
- Requires strong scope control so the scaffold does not become an overdesigned rewrite.

**Recommendation**: use as the default path.

### 4. Hybrid: scaffold now, copy specific modules only after interface decisions

The hybrid path starts with the clean scaffold and permits selective copying or adaptation of specific external modules later, after Yet AI interfaces, identity, storage, and UI direction are defined.

**Advantages**

- Keeps the initial direction independent while preserving an escape hatch for implementation velocity.
- Lets high-value low-identity modules be evaluated one at a time.
- Supports practical reuse for hard problems such as protocol edge cases, provider adapter patterns, SSE sequence handling, indexing patterns, or tool execution policies.
- Makes provenance and review manageable because each copied module has a specific reason and boundary.

**Disadvantages**

- Requires discipline and explicit decision records for each copied module.
- Can gradually become a fork if too many modules are copied without redesign pressure.
- Interfaces may need adapters when external internals do not match Yet AI contracts.
- Copied modules still bring license, attribution, and maintenance obligations.

**Recommendation**: allow only with explicit task approval and documented provenance.

## Default recommendation

Use an architecture-inspired clean scaffold as the default path, with a controlled hybrid option for selective module reuse later. Yet AI should not start as a full fork or full copy of any external project.

This path balances product differentiation and practical delivery:

- It honors the goal that Yet AI is independent.
- It preserves proven architecture patterns without inheriting external branding or storage.
- It enables a new UI/design from the beginning.
- It leaves room to reuse difficult, non-visual implementation pieces later when the benefit outweighs coupling and attribution cost.

## Criteria for acceptable external module copying

Copying or substantially adapting external code is acceptable only when all of these criteria are met:

1. **Interface first**: the Yet AI public interface is already defined for the area, such as HTTP/SSE event shape, storage API, provider adapter trait, tool contract, or IDE bridge message.
2. **Identity isolation**: the module has been audited for product names, package paths, storage directories, URLs, marketplace IDs, telemetry/support links, icons, screenshots, and UI copy.
3. **Low UI/design impact**: copied code is not a user-facing screen, visual design, marketplace copy, icon set, onboarding flow, or branded resource bundle unless it is intentionally rewritten.
4. **Clear velocity gain**: copying saves meaningful implementation time for a hard, well-bounded problem compared with writing the module cleanly.
5. **Test coverage**: Yet AI tests or contract fixtures prove the copied module behaves according to Yet AI contracts.
6. **License and provenance**: copied files retain required notices, are recorded in a provenance log, and are included in distribution attribution if required.
7. **Ownership decision**: after copying, the module is treated as Yet AI-owned code with a documented sync policy rather than an invisible upstream dependency.
8. **No storage collision**: the module cannot read or write another product's config, cache, project state, plugin settings, or update channels.
9. **No marketplace coupling**: the module cannot depend on external VS Code or JetBrains extension IDs, command prefixes, configuration namespaces, package namespaces, or update IDs.
10. **Review checkpoint**: the decision is approved in an architecture note or implementation card before the copy happens.

Good early candidates for possible later reuse are low-level, non-visual logic with stable boundaries, such as protocol serialization helpers, SSE sequence tests, provider adapter patterns, AST/indexing utilities, or tool policy mechanics. Poor candidates are external GUI shells, plugin marketplace manifests, icons, resource bundles, storage path code, release workflows, and user-facing copy.

## Practical implementation policy

- Start each subsystem empty or minimal; do not import external source as the first step.
- Keep external reference material out of production packages unless a specific implementation card approves a copy.
- Prefer writing thin contracts and tests before adding complex behavior.
- Use `product/identity.json` to validate names, package IDs, storage roots, and plugin metadata.
- Keep vendor/reference material out of build outputs and product archives by default.
- Keep public tracked files free of external project identifiers; private comparison notes belong only in ignored local files.
- When in doubt, preserve the architecture pattern and rewrite the implementation in Yet AI style.

## Next implementation cards

After this architecture package, create implementation cards in this order:

1. **Minimal monorepo scaffold**: add the initial `apps/engine`, `apps/gui`, `apps/plugins/vscode`, `apps/plugins/jetbrains`, and `scripts` structure with README ownership notes and no unnecessary feature code.
2. **CI/build commands**: define root-level validation commands that discover existing subsystem checks and keep empty scaffolds passing.
3. **Product identity validation script**: validate `product/identity.json` and check new manifests/config files for required Yet AI identity values and forbidden external identifiers.
4. **Config/storage isolation implementation**: implement `.yet-ai`, user config `yet-ai`, and user cache `yet-ai` path resolution with tests and no automatic external data import.
5. **VS Code shell**: create a private-build VS Code extension shell with Yet AI manifest fields, command/config prefixes, webview placeholder, and debug engine connection settings.
6. **JetBrains shell**: create a private-build JetBrains plugin shell with Yet AI plugin ID/package namespace, tool window placeholder, settings placeholder, and debug engine connection settings.
7. **GUI design system start**: create the first Yet AI GUI package with a new visual direction, component primitives, app shell, browser dev mode, and typed host bridge placeholder.

## Current decision

The default implementation strategy is: architecture-inspired clean scaffold first, hybrid selective reuse later only when justified. Full fork/copy is rejected as the default because Yet AI needs independent identity, storage, packaging, and new UI/design from the start.
