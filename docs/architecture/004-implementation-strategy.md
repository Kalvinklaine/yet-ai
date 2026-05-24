# 004 Implementation Strategy

Yet AI should use external architecture references as guidance, not as a fork. The user preference is explicit: build a similar kind of product with different design and UI, taking the main structure and runtime ideas without starting from a direct repository copy.

## Decision context

The earlier architecture package established these constraints:

- External reference implementations demonstrate useful subsystem boundaries: local engine, webview GUI, VS Code plugin, JetBrains plugin, HTTP/SSE chat contracts, optional LSP integration, provider/tool registries, local storage, and local-first BYOK operation.
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

The implementation path is local-first BYOK. Core workflows must run through the local runtime started or reached by the IDE plugin, without requiring a Yet AI account, hosted Yet AI backend, managed model gateway, product credit balance, or cloud workspace. The local runtime owns provider adapters, stores credentials locally, and sends requests directly to configured hosted providers or local model runtimes.

Future Yet AI cloud services are allowed only as optional extensions, such as an optional provider, integration, update channel, synchronization feature, or control-plane service. They must be separable from core chat, completion, agent, provider setup, local project storage, and IDE GUI workflows.

This path balances product differentiation and practical delivery:

- It honors the goal that Yet AI is independent.
- It preserves proven architecture patterns without inheriting external branding or storage.
- It enables a new UI/design from the beginning.
- It leaves room to reuse difficult, non-visual implementation pieces later when the benefit outweighs coupling and attribution cost.

## Current implemented baseline

The clean scaffold path has produced buildable local MVP foundations for the first implementation sequence:

1. `apps/engine` provides the Rust `yet-lsp` local runtime with authenticated loopback HTTP/SSE, identity-aware storage, local provider registry/config files, redacted provider responses, model summaries, and a narrow OpenAI-compatible direct streaming path.
2. `apps/gui` provides the React/Vite shell with loopback-only runtime client, provider setup/status, chat command submission, fetch-streaming SSE, runtime errors, and logical browser/VS Code/JetBrains bridge handling.
3. `apps/plugins/vscode` provides a VS Code extension shell with identity validation, packaged GUI asset loading, local runtime settings, loopback webview/dev URL policy, MVP `connect`/`launch`/`auto` runtime modes, safe bootstrap, and narrow bridge handling.
4. `apps/plugins/jetbrains` provides a JetBrains plugin shell with identity validation, Gradle tests/build, packaged GUI resource loading, loopback runtime/dev URL policy, MVP `connect`/`launch`/`auto` runtime modes, PasswordSafe local token storage, JCEF hosting, and structural bridge validation.
5. `packages/contracts` remains the shared schema/example package for current boundaries.

This is not a production assistant. The IDE shells now have packaged GUI asset flows and MVP local runtime connect/launch/auto modes, but marketplace packaging, signed or notarized engine bundles, a production installer, full agent autonomy, indexing, tool execution, integration workflows, LSP/completion features, file edits, broader provider support, and privileged IDE actions remain follow-up work. Current chat is a local provider/chat MVP only. The provider-auth baseline includes a GUI login-first status card, API-key fallback, sanitized engine skeleton endpoints, local mock OAuth/PKCE contract coverage, and engine-owned secret storage with a protected-file fallback. It does not include real OpenAI/ChatGPT account login. The local-first BYOK/no-required-cloud contract remains the controlling constraint.

## OpenAI/ChatGPT auth implementation strategy

Current real-provider implementation is API-key/OpenAI-compatible direct access only. It does not implement ChatGPT account login, OpenAI OAuth, token refresh, callback handling, or production disconnect/revoke behavior. The engine now exposes provider-auth `start`, `status`, `exchange`, and `disconnect` endpoints as sanitized local skeleton contracts for `openai` and `openai-compatible`; default real-provider start/exchange return login unavailable and do not call external providers. The local mock OAuth/PKCE harness is only for contract and smoke tests. The GUI can render login-first provider-auth statuses and open only safe authorization URLs, but current real-provider use remains the API-key fallback.

External reference inspection for OpenAI/Codex auth found this architecture shape:

- The OpenAI API-key provider remains a normal direct provider path.
- The OpenAI Codex account path uses an OAuth authorization-code flow with PKCE against OpenAI auth endpoints, opens a browser URL, uses a loopback callback when available, supports manual/device-style GUI states, and exchanges tokens in the engine.
- Tokens are engine/provider configuration state. Provider settings expose sanitized flags such as auth status, source, connected state, whether an API key is ready, and short diagnostics; raw access tokens, refresh tokens, and API keys are not GUI-facing settings.
- Refresh is engine-owned. Permanent refresh failures clear stored OAuth access/refresh token material and require login again. Disconnect is exposed as a provider OAuth logout action from the GUI to the engine.
- The implementation also contains risky surfaces that should not be copied as a default: fallback reads of another CLI's credentials, ChatGPT backend endpoints for usage/model access, provider-specific account headers, and provider-client identifiers that may not be appropriate for Yet AI without explicit compliance review.

Yet AI should implement a safer staged strategy:

1. Preserve the current API-key/OpenAI-compatible path as the baseline and fallback.
2. Add documentation and UI copy that says: sign in first where supported; API key fallback otherwise.
3. Before coding login, verify that the intended OpenAI/ChatGPT flow is official or otherwise compliant for third-party local apps. If the only available account-login route depends on private ChatGPT web-session cookies, browser profile import, or another product's CLI credentials, do not implement it as the default.
4. If a compliant OAuth/device/browser flow is available, implement it with Yet AI-owned identity, redirect URLs, storage names, and endpoint contracts. The engine starts the flow, stores pending PKCE session state, handles callback/exchange, stores tokens in OS keychain or protected user config, refreshes/revokes credentials, and calls providers directly.
5. If official account login cannot produce API-use credentials, guide users to the OpenAI platform to create an API key and paste it once. The GUI clears the secret after submit and renders only engine-returned sanitized status.

The current provider-auth endpoints are intentionally skeletal and schema-backed. Real login code must not replace the skeleton until this T-49 compliance gate is complete:

- identify an official or otherwise approved OpenAI/ChatGPT auth flow for third-party local apps;
- document the exact allowed authorization, token, model, revoke, refresh, callback, and device/polling endpoints;
- review redirect URI or device flow behavior, PKCE parameters, client identity, scopes, account labels, and local callback security;
- define token storage, refresh, revoke, expiry, disconnect, migration, and no-secret logging policy behind engine-owned secret storage;
- confirm that the flow does not require a Yet AI hosted backend, account, managed gateway, product credit balance, or cloud workspace for core chat/provider setup;
- keep cookie scraping, browser profile import, other-product credential reuse, private ChatGPT web endpoints, and provider-private headers out of the default implementation unless a separate approval, provenance review, and security design explicitly allow a specific exception.

Future production provider-auth work may extend `POST /v1/provider-auth/{provider}/start`, `GET /v1/provider-auth/{provider}/status`, `POST /v1/provider-auth/{provider}/exchange`, `POST /v1/provider-auth/{provider}/disconnect`, and an optional loopback callback endpoint. Those changes should include updated schema fixtures, no-secret regression tests, token lifecycle tests, and docs that avoid claiming production readiness before packaging and compliance review are complete.

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
- Preserve local-first BYOK boundaries: provider adapters and credentials belong to the local runtime, GUI renders sanitized setup/status, and plugins launch or connect to the runtime without duplicating provider logic.
- Keep vendor/reference material out of build outputs and product archives by default.
- Keep public tracked files free of external project identifiers; private comparison notes belong only in ignored local files.
- When in doubt, preserve the architecture pattern and rewrite the implementation in Yet AI style.

## Next implementation cards

The first six local-first implementation cards have MVP baselines in place:

1. **Local runtime skeleton**: complete as a buildable Rust runtime foundation with health/capability contracts, loopback binding, bearer-token authentication, and storage root resolution.
2. **Provider registry, configuration, and secret redaction**: complete as a local file-backed development baseline with sanitized GUI-facing responses and redacted hints.
3. **OpenAI-compatible direct provider adapter and streaming**: complete as the first narrow direct BYOK streaming path through the local runtime.
4. **GUI local provider setup and runtime client**: complete as a React/Vite shell with provider setup/status, chat/SSE, loopback runtime validation, and bridge diagnostics.
5. **VS Code local runtime host**: complete as a buildable extension shell with webview bridge, packaged GUI asset flow, and MVP local runtime connect/launch/auto settings.
6. **JetBrains local runtime host**: complete as a buildable Gradle plugin shell with JCEF bridge, packaged GUI asset flow, and MVP local runtime connect/launch/auto settings.

Next implementation work should focus on hardening rather than expanding privileged behavior: turn packaged GUI and launcher MVPs into production packaging flows, add signed/notarized engine bundle and installer decisions, move local session tokens to platform secret stores where still missing, tighten schemas for non-`user_message` commands and privileged bridge messages, add lifecycle and smoke tests, and only then introduce IDE/file/tool actions behind explicit policy and confirmation.

Every follow-up card must keep the no-required-cloud contract intact: core chat, completion, agent, provider setup, local project storage, and IDE GUI workflows must work through the local runtime without a required hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace.

## Current decision

The default implementation strategy is: architecture-inspired clean scaffold first, hybrid selective reuse later only when justified. Full fork/copy is rejected as the default because Yet AI needs independent identity, storage, packaging, and new UI/design from the start.
