# 004 Implementation Strategy

Yet AI should be implemented as a standalone local-first AI coding assistant and IDE agent plugin product with its own design, UI, runtime, storage, packaging, and release surfaces.

## Decision context

The earlier architecture package established these constraints:

- Useful subsystem boundaries are local engine, webview GUI, VS Code plugin, JetBrains plugin, HTTP/SSE chat contracts, optional LSP integration, provider/tool registries, local storage, and local-first BYOK operation.
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

### 3. Clean local-first scaffold

A clean scaffold means creating Yet AI packages around its chosen local-first subsystem boundaries: `apps/engine`, `apps/gui`, `apps/plugins/vscode`, `apps/plugins/jetbrains`, `product`, `docs`, and `scripts`. Unapproved third-party implementations are not production source.

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

Use a clean local-first scaffold as the default path, with a controlled option for approved third-party module use later. Yet AI should not start as a full fork or full copy of any external project.

The implementation path is local-first BYOK. Core workflows must run through the local runtime started or reached by the IDE plugin, without requiring a Yet AI account, hosted Yet AI backend, managed model gateway, product credit balance, or cloud workspace. The local runtime owns provider adapters, stores credentials locally, and sends requests directly to configured hosted providers or local model runtimes.

Future Yet AI cloud services are allowed only as optional extensions, such as an optional provider, integration, update channel, synchronization feature, or control-plane service. They must be separable from core chat, completion, agent, provider setup, local project storage, and IDE GUI workflows.

This path balances product differentiation and practical delivery:

- It honors the goal that Yet AI is independent.
- It preserves intentional architecture patterns without inheriting third-party branding or storage.
- It enables a new UI/design from the beginning.
- It leaves room to reuse difficult, non-visual implementation pieces later when the benefit outweighs coupling and attribution cost.

## Current implemented baseline

The clean scaffold path has produced buildable local MVP foundations for the first implementation sequence:

1. `apps/engine` provides the Rust `yet-lsp` local runtime with authenticated loopback HTTP/SSE, identity-aware storage, local provider registry/config files, engine-owned local chat history, redacted provider responses, sanitized provider/model capability readiness summaries, and a narrow OpenAI-compatible direct streaming path.
2. `apps/gui` provides the React/Vite shell with loopback-only runtime client, provider setup/status, sanitized model readiness display, local conversation list/create/switch/delete flows, chat command submission, fetch-streaming SSE, runtime errors, and logical browser/VS Code/JetBrains bridge handling.
3. `apps/plugins/vscode` provides a VS Code extension shell with identity validation, packaged GUI asset loading, local runtime settings, loopback webview/dev URL policy, MVP `connect`/`launch`/`auto` runtime modes, safe bootstrap, narrow bridge handling, controlled IDE action host execution for bounded read-only/navigation/context actions (`getContextSnapshot` metadata only, open/reveal navigation only, no raw file contents in result metadata), and a local ignored root VSIX dev-preview artifact plus checksum published by `npm run prepare:vscode-preview` under `dist/plugins/vscode/`.
4. `apps/plugins/jetbrains` provides a JetBrains plugin shell with identity validation, Gradle tests/build, packaged GUI resource loading, loopback runtime/dev URL policy, MVP `connect`/`launch`/`auto` runtime modes, PasswordSafe local token storage, JCEF hosting, structural bridge validation, and strict wrapper/Kotlin policy for the same safe read-only/navigation/context controlled IDE actions (`getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`) after explicit GUI/user request.
5. `packages/contracts` remains the shared schema/example package for current boundaries.

Active context remains prompt-only and one-shot: selected text is included only after visible GUI preview/attach policy, may be sent to the configured provider as prompt context, and is cleared after the next accepted send. It does not enable autonomous reads, indexing, edits, shell/git/task/tool execution, provider tool calls, or workspace mutation. The explicit multi-file context bundle contract extends only that prompt-context lane: a bundle is non-empty, capped at 4 active-editor-derived excerpts with aggregate bounded text, and schema-denies path/glob/search/index/full-file fields, provider/model/API-key fields, tools, shell, git, unknown fields, and assistant-supplied request correlation. It is not persistence, indexing, arbitrary file reading, or an assistant-triggered attach channel.

Active-file excerpt context follows the same rule. Sprint 13 implements dev-preview VS Code and JetBrains host support for an explicit GUI/user request for the current visible active editor with payload `{ "action": "getActiveFileExcerpt" }`, and a success-only sanitized `active_file_excerpt` attachment containing bounded text, sanitized file metadata, visible-editor range, source, and truncation status. Browser mode remains unavailable/preview-only. Invalid or unsafe host results fail closed without rendering raw payloads and the GUI keeps a safe clear/retry path for pending state. This feature does not permit path input, globbing, full-file retrieval, recursive workspace reads, indexing, provider/model/API-key fields, tools, shell, git, assistant-triggered collection, cloud persistence, or mutation authority.

This is not a production assistant. The IDE shells now have packaged GUI asset flows and MVP local runtime connect/launch/auto modes, but marketplace packaging, signed or notarized engine bundles, a production installer, full agent autonomy, indexing, tool execution, integration workflows, production LSP/completion features, file edits, broader provider support, and privileged IDE actions remain follow-up work. The current functional LSP MVP is contract-first, local-first, opt-in, and read-only: the engine implements separate `yet-lsp --lsp-stdio` mode for `initialize`, `initialized`, `shutdown`, `exit`, bounded document open/change/close notifications, deterministic local completion/status proof, read-only hover/status proof, and bounded document-symbol extraction over editor-supplied in-memory text. VS Code can opt into a separate no-secret stdio client path for bounded local `file` document sync and deterministic completion/hover/document-symbol status proofs. JetBrains LSP native client/editor wiring is not implemented; Sprint 10 verified the default-disabled lifecycle/process/no-secret guardrail path and recorded the T-15 blocked decision that native IntelliJ LSP support remains deferred until the exact platform dependency contract is proven. The LSP MVP must not call providers on keystrokes, read arbitrary files, index workspaces, write files, apply patches, execute shell/tools, expose raw document bodies in logs, produce provider-backed diagnostics, or require a hosted Yet AI backend, account, managed gateway, product credits, or cloud workspace. Current chat is a local provider/chat/history MVP only. Chat history is engine-owned local storage, not GUI browser persistence, cloud sync, production encrypted sync, provider-side deletion, or enterprise retention policy. User prompt content may persist locally, so users should avoid pasting secrets; provider API keys, OAuth tokens, authorization codes, PKCE verifiers, cookies, local runtime session tokens, raw provider responses, and credential paths must stay out of chat metadata. The provider-auth baseline includes a GUI login-first status card, API-key fallback, sanitized engine skeleton endpoints, local mock OAuth/PKCE contract coverage, engine-owned composite secret storage with OS credential storage where available plus protected-file fallback under strict disabled/unavailable policy, safe fallback-to-keychain migration with cleanup retry, and migration for legacy inline provider API keys. It does not include official/public production OpenAI/ChatGPT account login, cloud sync, hosted credential custody, enterprise secret management, or a guarantee that every platform has an unlocked keychain service. The local-first BYOK/no-required-cloud contract remains the controlling constraint.

For VS Code installable dev-preview testing, `npm run prepare:vscode-preview` now produces `dist/plugins/vscode/yet-ai-vscode-<version>-dev-preview.vsix` and a matching `.sha256` checksum as ignored local artifacts. Validate that package route with `npm run smoke:vscode-installable`, then use `npm run smoke:vscode-preview` for the generated extension-workspace artifacts. These checks inspect archive structure, metadata, bundled identity, packaged GUI assets, and the copied engine binary without launching VS Code, using provider credentials, calling real OpenAI/ChatGPT, requiring a hosted Yet AI backend, or requiring a cloud workspace. This status is local dev-preview installability only, not marketplace publication, signing, notarization, production installer work, or a production release. JetBrains remains documented separately with its own local ignored ZIP dev-preview artifact and smokes; this VS Code flow does not imply broader production packaging parity.

Local chat history, HTTP boundary, and provider error verification are part of the local smoke and focused Rust paths: `npm run smoke:local` covers chat create/list/get/delete behavior, persisted user/assistant history, SSE snapshot hydration, and no-secret response/event checks with loopback mocks only. `npm run smoke:provider-errors` covers stable sanitized provider/chat error taxonomy for unauthorized, rate-limit/quota, context-window, invalid-request, upstream, malformed stream, and OpenAI-style stream error-frame paths, including persisted history and no raw provider body or secret leakage. `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp http_boundary` covers sanitized malformed, type-invalid, and oversized JSON failures plus invalid chat id and subscribe-query rejection. Documentation and contract-only changes should still run `npm run check`.

The local IDE release-candidate smoke gate is `npm run smoke:ide-release-candidate`. It is the explicit bundle for release-candidate readiness of the current local dev-preview IDE surfaces: repository contracts/checks, engine `npm run smoke:lsp-stdio`, GUI build/freshness coverage, VS Code and JetBrains preview preparation, plugin layout, VS Code and JetBrains installable artifact inspection, VS Code and JetBrains first-message smokes, installed-plugin visual and Demo Mode first-message coverage, login-first mock provider-auth first-message coverage, local runtime smoke, JetBrains bundled runtime startup, GitHub artifact staging/manifests, workflow/report safety checks, public artifact summary, and clean tracked status. The LSP step is deterministic spawned-engine stdio verification only; it does not assert production IDE LSP support. VS Code LSP remains an off-by-default read-only MVP/status proof, and JetBrains remains a lifecycle feasibility/blocked-decision path until native IntelliJ LSP API dependencies, editor sync, document policy, diagnostics, and deterministic tests are proven. It deliberately omits real provider/cloud calls, real IDE/JCEF automation, provider-backed completion or diagnostics, signing, notarization, marketplace publication, release upload, and production-release claims. Any unavailable local tooling such as Node dependencies, Playwright Chromium, Cargo/Rust, Gradle, JDK archive tools, or zip inspection tools must fail with actionable sanitized diagnostics rather than falling back to weaker coverage. Output from the orchestrator is redacted for bearer/API-key-like secrets, mock provider-auth sentinels, runtime tokens, file URLs, and private absolute paths before it is printed.

Provider secret verification uses focused Rust tests plus `npm run smoke:provider-secret-migration`. `cargo test -p yet-lsp secret_store` covers deterministic composite behavior for keychain-primary/fallback policy, verified fallback-to-keychain migration, read-back mismatch preservation, strict transient-unavailable write/delete rejection, primary-unavailable read fail-closed behavior, disabled-primary fallback behavior, fallback cleanup retry, healthy-primary plus broken-fallback cleanup fail-closed behavior, keychain read timeout handling, keychain mutation completion waiting, in-process put-if-absent protection, and delete coverage across API-key and OAuth secret kinds without using a real OS keychain. `cargo test -p yet-lsp provider_secret` covers provider-path behavior including create put-if-absent and rollback on config failure, create failure without config persistence, retryable provider delete cleanup, missing-config orphan cleanup, explicit-auth update rollback after secret failures, metadata-only updates that avoid credential reads/writes, stored-secret-wins behavior, and sanitized failure bodies. The smoke covers legacy inline `auth.apiKey` migration into the protected-file secret-store fallback, provider config scrubbing, provider-test use of the stored secret via digest/length checks only, stored-secret-wins behavior when inline config is stale, and no raw fake secret leakage. The keychain put-if-absent lock is intentionally in-process for the current local runtime and is not a cross-process keychain locking guarantee. The post-review focused gate is `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp secret_store && cargo test -p yet-lsp provider_secret && cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat && git status --short`. The broader secure local credentials final gate context is `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp secret_store && cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat && cargo test -p yet-lsp && npm run smoke:provider-secret-migration && npm run smoke:local && npm run check && git status --short`.

Provider/model capability readiness is now part of that MVP boundary. `/v1/models`, `/v1/caps`, and provider summaries expose sanitized model metadata with bounded `chat`, `streaming`, `tools`, and `reasoning` booleans plus readiness states `ready`, `disabled`, `missing_credentials`, `missing_model`, and `unsupported`. Runtime chat selection and GUI send readiness require an enabled configured provider with a `ready` model that supports both chat and streaming; missing metadata is intentionally not treated as ready. Provider/chat failures use stable sanitized categories for auth, rate limits or quota, context too large, invalid requests, timeouts, upstream failures, malformed streams, config/not-configured states, and fallback request failures. Context-too-large may include user prompt text plus attached editor context. Classification is best-effort because provider responses are not uniformly OpenAI-compatible, so ambiguous failures fall back to safe generic messages. GUI recovery guidance should be actionable but conservative and must not expose raw provider responses, secrets, request bodies, tokens, private paths, or debug details. This is a conservative local selection and error-reporting contract, not dynamic provider discovery, production model catalog synchronization, automatic retry behavior, tool execution, reasoning-agent support, or a hidden way to enable tasks/knowledge.

Bridge and chat command policy is deny-by-default. The current runtime accepts only strict `user_message` and no-op-safe `abort` chat commands; disabled future commands (`regenerate`, `update_message`, `remove_message`, `set_params`, `tool_decision`, and `ide_tool_result`) stay rejected. The current IDE bridge accepts strict `gui.ready`, non-privileged `gui.unloaded` (empty payload, no requestId), bounded `gui.ideActionRequest` for controlled context/navigation actions, and, for the confirmed edit-proposal MVP, strict `gui.applyWorkspaceEditRequest` only after GUI preview/review and an explicit user apply click; controlled `getContextSnapshot` is metadata-only, open/reveal are navigation-only, and action result metadata must not include raw file contents. VS Code and JetBrains execute only `getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`; JetBrains uses strict wrapper/Kotlin policy and correlated progress/results after explicit GUI/user request. Browser remains preview/test fallback and does not execute controlled actions. Other privileged GUI-to-host requests (`gui.openFile`, `gui.revealRange`, `gui.executeIdeTool`, `gui.copyText`, `gui.showNotification`, and `gui.getHostContext`) remain rejected. Future enablement must be contract-first: define strict schemas and fixtures, add request correlation, verify host origin/source, add engine/host policy checks, require user confirmation for risky effects, log only sanitized audit entries, use least-privilege allowlists, and preserve a no-silent-workspace-mutation rule. The confirmed `gui.applyWorkspaceEditRequest` / `host.applyWorkspaceEditResult` MVP keeps that lifecycle bounded: confirmed edit proposals are preview-only until the GUI user explicitly applies; the GUI never edits files directly and is the only party that mints `requestId`, so assistant-supplied ids are not honored and historical bubbles stay non-runnable; VS Code remains the reference apply host; JetBrains apply is dev-preview only through the existing apply/result bridge messages with IDE/user confirmation for bounded existing workspace-relative text replacements; browser remains preview-only/non-executing for workspace edits; the GUI pending-state clear is client-side only and does not cancel open host UI; stale or duplicate host results are ignored or bounded/cleared; and a non-`applied` status carries a short sanitized repair/retry hint with no auto-retry. Tools, tasks, knowledge, shell execution, file edits beyond confirmed bounded host text replacements, autonomous file reads/indexing, and background autonomy remain out of scope for this milestone.

Agent progress observability is currently contracts plus local deterministic utilities and a read-only runtime/GUI surface. The repository has strict progress event/snapshot/list-response fixtures, a pure reducer/classifier, local JSON event-state read/write helpers, a compact CLI reporter, engine `GET /v1/agent-progress`, a GUI read-only Agent progress panel, `npm run check:agent-progress`, `npm run smoke:agent-progress`, and `npm run smoke:gui-agent-progress`. This proves sanitized progress status, heartbeat/stuck classification, bounded output-tail reporting, context-overflow recovery classification, state/report persistence, strict empty list endpoint behavior, and read-only GUI rendering in local scenarios. The endpoint currently returns empty local state until a future runner is wired, and the GUI exposes refresh/rendering only with no Start, Stop, Merge, Apply, shell, tool, provider-call, or workspace-mutation controls. It does not wire a production agent runner, real lifecycle hooks, a real task board, git merges, shell authority, tool execution, provider calls, workspace mutation, cloud sync, or hosted services. Future runner implementation should emit sanitized lifecycle events into this contract from explicit hooks and keep only ids, phase/status, tool label/kind, elapsed and heartbeat ages, stuck reason, recent summaries, attempt counts, bounded sanitized output tails, and bounded overflow recovery guidance. A `context_length_exceeded` after broad `task_board_get({})`, broad search, or another oversized tool output should be handled as planner/tool-output overflow rather than a code or test failure. Recovery should use scoped calls: `task_ready_cards`, specific `task_board_get(card_id)`, targeted `search_pattern`, targeted `cat`, and summaries. Full task-board reads should be avoided unless necessary and expected to be small. Large tool outputs, prompts, chain-of-thought, raw provider responses, raw file contents, tokens, cookies, provider credentials, runtime session tokens, credential paths, private absolute paths, auth files, shell scripts, patch payloads, and workspace dumps must remain outside progress events, state files, reports, endpoints, and GUI-facing surfaces.

## Dev-preview packaging implementation boundary

The current implementation deliberately stops at install-from-file dev-preview packaging evidence. `npm run prepare:vscode-preview`, `npm run prepare:jetbrains-preview`, the local preview smokes, and the GitHub IDE artifact workflow can produce ignored VSIX/ZIP/checksum/manifest outputs for local dogfood and CI artifact download, but those outputs are validation artifacts only. They are unsigned, unpublished, and not production installers, marketplace packages, automatic update channels, or production releases.

The IDE-bundled `yet-lsp` is staged from the local or CI Cargo build output for the active checkout. It is acceptable for dev-preview `auto`/`launch` validation because the smokes inspect archive layout and loopback startup behavior, but it must not be described as a signed, notarized, hardened, or provenance-attested production engine. Future production work must decide the engine build profile, platform matrix, code-signing/notarization policy, installer/archive layout, update channel, compatibility gates, and any provenance/SBOM/attestation requirements before publication claims are allowed.

Future production packaging should be split into explicit implementation cards rather than hidden inside preview helpers. Required decision points include VS Code publisher/listing workflow, JetBrains Marketplace vendor/listing workflow, signing identities, macOS notarization/hardening, Windows signing, Linux packaging expectations, release artifact naming, updater behavior, checksum/signature publication, rollback/retention policy, license/notice material, and manual release approval gates. Until those cards land, docs and UI copy should keep saying install-from-file dev preview, local/mock-only validation, no signing, no notarization, no marketplace publication, no production installer, and no production release.

This packaging boundary does not change the local-first BYOK contract: core chat, provider setup, IDE GUI workflows, and local storage must continue to run through the local runtime without a required hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, or production/default provider account login.

## OpenAI/ChatGPT auth implementation strategy

Current approved/default real-provider implementation is API-key/OpenAI-compatible direct access only. It does not implement an approved production/default ChatGPT account login or official public OpenAI OAuth path; default real-provider start/exchange return login unavailable and do not call external providers. The engine also contains high-risk experimental Codex-like OAuth/refresh plumbing behind explicit experimental request fields and loopback endpoint restrictions for feasibility testing. That path is not production/default login support, must not be presented as official third-party OpenAI account login, and must stay subordinate to ready API-key providers and Demo Mode. Provider-auth pending/session state is local engine-owned state. Pending state uses hardened local storage for the dev-preview/mock and experimental paths, while raw provider secrets, tokens, authorization codes, PKCE verifiers, cookies, browser profiles, and credential file paths remain outside GUI ownership and GUI-facing responses. New API keys and experimental OAuth access/refresh/metadata records are stored through the engine composite secret store, not provider config JSON. Production builds prefer OS credential storage where the platform service is available and use protected files under user config only when the primary is disabled by policy or for safe fallback reads after an empty healthy primary lookup; debug/test automation deliberately uses the fallback path. Keychain reads are bounded and can return sanitized unavailable status, while keychain writes and deletes wait for completion rather than relying on timeout assumptions about late side effects. Transient primary write/delete failures, locked-keychain read unavailability, read-back mismatches, primary-unavailable reads, and fallback cleanup failures return sanitized errors instead of silently succeeding through fallback. Existing fallback records migrate to keychain only after verified write/read-back, cleanup is retried on later healthy primary reads, keychain values win only when the primary read is healthy, and disconnect/delete attempts both backends without hiding real primary cleanup failures. The keychain put-if-absent lock is in-process only and is paired with read-back verification; it is not a cross-process lock. Legacy inline `auth.apiKey` values are migrated on normal provider/model/test/chat access by atomically creating the missing secret-store record before scrubbing config; an existing stored secret wins over stale inline values, and unsafe secret-store failures return sanitized errors without inline fallback. Provider create stores API-key material with put-if-absent before config creation and rolls back on config failure; provider delete cleans API-key material before config deletion and can retry cleanup when config is already missing; provider update rolls explicit secret state changes back if config persistence fails where rollback succeeds; metadata-only provider updates avoid credential reads and writes. The local mock OAuth/PKCE harness is only for contract and smoke tests. The GUI can render login-first provider-auth statuses and open only safe authorization URLs, but current approved real-provider use remains the API-key fallback.

Provider-auth design keeps this architecture shape:

- The OpenAI API-key provider remains a normal direct provider path.
- The OpenAI Codex account path uses an OAuth authorization-code flow with PKCE against OpenAI auth endpoints, opens a browser URL, uses a loopback callback when available, supports manual/device-style GUI states, and exchanges tokens in the engine.
- Tokens are engine/provider configuration state. Provider settings expose sanitized flags such as auth status, source, connected state, whether an API key is ready, and short diagnostics; raw access tokens, refresh tokens, and API keys are not GUI-facing settings.
- Refresh is engine-owned. Permanent refresh failures clear stored OAuth access/refresh token material and require login again. Disconnect is exposed as a provider OAuth logout action from the GUI to the engine.
- Risky surfaces must not be copied as a default: fallback reads of another CLI's credentials, ChatGPT backend endpoints for usage/model access, provider-specific account headers, and provider-client identifiers that may not be appropriate for Yet AI without explicit compliance review.

Yet AI should implement a safer staged strategy:

1. Preserve the current API-key/OpenAI-compatible path as the baseline and fallback.
2. Add documentation and UI copy that says: sign in first where supported; API key fallback otherwise.
3. Before coding login, verify that the intended OpenAI/ChatGPT flow is official or otherwise compliant for third-party local apps. If the only available account-login route depends on private ChatGPT web-session cookies, browser profile import, or another product's CLI credentials, do not implement it as the default.
4. If a compliant OAuth/device/browser flow is available, implement it with Yet AI-owned identity, redirect URLs, storage names, and endpoint contracts. The engine starts the flow, stores pending PKCE session state, handles callback/exchange, stores tokens through the composite OS-keychain-plus-protected-file secret store, refreshes/revokes credentials, and calls providers directly.
5. If official account login cannot produce API-use credentials, guide users to the OpenAI platform to create an API key and paste it once. The GUI clears the secret after submit and renders only engine-returned sanitized status.

The current provider-auth endpoints are intentionally skeletal and schema-backed. Real login code must not replace the skeleton until this T-49 compliance gate is complete:

- identify an official or otherwise approved OpenAI/ChatGPT auth flow for third-party local apps;
- document the exact allowed authorization, token, model, revoke, refresh, callback, and device/polling endpoints;
- review redirect URI or device flow behavior, PKCE parameters, client identity, scopes, account labels, and local callback security;
- define token storage, refresh, revoke, expiry, disconnect, migration, and no-secret logging policy behind engine-owned secret storage;
- confirm that the flow does not require a Yet AI hosted backend, account, managed gateway, product credit balance, or cloud workspace for core chat/provider setup;
- keep cookie scraping, browser profile import, other-product credential reuse, private ChatGPT web endpoints, and provider-private headers out of the default implementation unless a separate approval, provenance review, and security design explicitly allow a specific exception.

Future production provider-auth work may extend `POST /v1/provider-auth/{provider}/start`, `GET /v1/provider-auth/{provider}/status`, `POST /v1/provider-auth/{provider}/exchange`, `POST /v1/provider-auth/{provider}/disconnect`, and an optional loopback callback endpoint. Those changes should include updated schema fixtures, no-secret regression tests, token lifecycle tests, and docs that avoid claiming production readiness before packaging and compliance review are complete.

## No-idle scheduler implementation strategy

The no-idle planner/watchdog is a future reliability milestone. This document phase defines the contract and roadmap only; it does not claim a production autonomous scheduler is implemented.

Implementation should proceed in narrow, testable increments:

1. Define scheduler state and event contracts for pools, cards, agents, merge attempts, verification attempts, blockers, and audit entries.
2. Add positive and invalid fixtures for state transitions, including completed agents, serial merge queues, verification failures, stuck-agent recovery, blocked cards, pool closure, and autonomous next-pool planning.
3. Implement a pure deterministic reducer or simulator that takes board snapshots and events and returns the next scheduler action without real agent execution, git operations, shell commands, network calls, or workspace mutation. The current repository has this as `npm run check:planner-scheduler`.
4. Add a local smoke that proves the no-idle invariant: actionable completed, mergeable, verifiable, ready, failed, stuck, closeable, and next-pool states produce progress actions or explicit audited blockers. The current repository has this as `npm run smoke:planner-no-idle`.
5. Add durable local simulator state and a process-like tick runner before production wiring. The current repository has a simulator state store with sanitized audit entries and single active lease semantics, plus `npm run planner:scheduler:tick -- --state path/to/scheduler-state.json` for one local tick over an explicit state file.
6. Add restart/resume coverage for durable state. The current repository has this as `npm run smoke:planner-resume`, covering reload across merge, verification, ready-card spawn, autonomous next-pool planning, lease release after each tick, ordered sanitized audit timelines, and stale-heartbeat recovery after reload.
7. Only after contracts and simulator behavior are stable, connect the scheduler to real task execution and merge/verification orchestration behind policy gates. This production wiring is not implemented yet.

The scheduler must treat idle as an explicit audited state, not as absence of activity. If it decides not to act, the state must say why, what condition would unblock progress, and whether a later watchdog check is scheduled. Silent waiting is not an acceptable terminal or long-lived state when autonomous execution is permitted.

Future production wiring must preserve existing safety boundaries. The scheduler may coordinate approved cards and verification commands, but privileged file edits, apply-patch operations, shell/tool execution, autonomous workspace mutation, and broader agent authority remain unavailable until strict contracts, policy checks, request correlation, origin/source checks, and user confirmation flows are designed and verified. Local-first BYOK remains mandatory: scheduler state and progress must work through local runtime/project state and must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.

The current no-idle and durable simulator commands are verification aids only. They are deterministic and local-only; they do not spawn real agents, modify files, run real verification commands, perform git operations, call providers, or mutate project state. The durable tick CLI reads and writes only the explicit simulator state file, records sanitized summaries, and uses lease/tick owner fields to model restart-safe scheduler ownership without becoming a production task-board runner.

## Agent progress observability implementation strategy

Agent progress observability should remain contract-first until a real runner exists. The current MVP covers the safe data shape, local mechanics, and read-only product surface: strict schemas and fixtures, a pure deterministic reducer/classifier, durable local JSON state helpers, a compact report CLI, deterministic simulator smoke scenarios, engine `GET /v1/agent-progress`, and a GUI read-only Agent progress panel. The endpoint returns the strict list response with empty local state until a future runner is wired. The GUI panel only refreshes and renders safe progress states and must not add Start, Stop, Merge, Apply, shell, tool, provider-call, git, or workspace-mutation controls.

Use `npm run check:agent-progress` for reducer/state/report assertions, `npm run smoke:agent-progress` for local scenario coverage including bounded task-board-like and tool-output overflow, and `npm run smoke:gui-agent-progress` for deterministic loopback-only browser coverage of the read-only panel and overflow recovery display. The final gate for this area is `npm run check:agent-progress && npm run smoke:agent-progress && npm run smoke:gui-agent-progress && npm run check && git status --short`.

Future production wiring should attach event emission to explicit runner lifecycle hooks after runner authority and task-board integration are designed. Hooks should report queued, reading context, editing, running commands, waiting for tool output, verifying, finishing, done, failed, or stuck states using only sanitized operational fields: ids, phase/status, tool label/kind, elapsed and heartbeat ages, stuck reason, recent summaries, attempt counts, and bounded sanitized output tails. They should not expose prompts, chain-of-thought, raw provider responses, raw file contents, provider credentials, OAuth tokens, cookies, local runtime session tokens, credential paths, private absolute paths, shell scripts, patch payloads, or workspace file bodies. Progress reporting must not become a backdoor for shell authority, tool execution, file edits, git merges, workspace mutation, provider calls, cloud sync, or hosted Yet AI services. Local-first BYOK remains mandatory.

## Criteria for acceptable third-party module copying

Copying or substantially adapting third-party code is acceptable only when all of these criteria are met:

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

Good early candidates for possible later approved reuse are low-level, non-visual logic with stable boundaries, such as protocol serialization helpers, SSE sequence tests, provider adapter patterns, AST/indexing utilities, or tool policy mechanics. Poor candidates are third-party GUI shells, plugin marketplace manifests, icons, resource bundles, storage path code, release workflows, and user-facing copy.

## Practical implementation policy

### Verification discipline

Smoke and verification tasks are acceptance guardrails, not a replacement for roadmap-visible product work. Future cards should anchor to product roadmap sections, and broad smoke bundles should not turn into open-ended smoke-only loops. A rough sprint balance is 70-80% roadmap-visible implementation and UX, with 20-30% verification tied to that work. GitHub issue #2 is a bounded visual GUI acceptance check, not a dominant sprint theme.

- Start each subsystem empty or minimal; do not import third-party source as the first step.
- Keep unapproved third-party material out of production packages unless a specific implementation card approves a copy.
- Prefer writing thin contracts and tests before adding complex behavior.
- Use `product/identity.json` to validate names, package IDs, storage roots, and plugin metadata.
- Preserve local-first BYOK boundaries: provider adapters and credentials belong to the local runtime, GUI renders sanitized setup/status, and plugins launch or connect to the runtime without duplicating provider logic.
- Keep unapproved third-party material out of build outputs and product archives by default.
- Keep public tracked files free of external project identifiers; private comparison notes belong only in ignored local files.
- When in doubt, preserve the architecture pattern and rewrite the implementation in Yet AI style.

## Next implementation cards

The first six local-first implementation cards have MVP baselines in place:

1. **Local runtime skeleton**: complete as a buildable Rust runtime foundation with health/capability contracts, loopback binding, bearer-token authentication, and storage root resolution.
2. **Provider registry, configuration, and secret redaction**: complete as a local file-backed development baseline with sanitized GUI-facing responses, redacted hints, and atomic migration for legacy inline API keys.
3. **OpenAI-compatible direct provider adapter and streaming**: complete as the first narrow direct BYOK streaming path through the local runtime.
4. **GUI local provider setup and runtime client**: complete as a React/Vite shell with provider setup/status, chat/SSE, loopback runtime validation, and bridge diagnostics.
5. **VS Code local runtime host**: complete as a buildable extension shell with webview bridge, packaged GUI asset flow, MVP local runtime connect/launch/auto settings, and a local ignored root VSIX dev-preview artifact validated by `npm run smoke:vscode-installable` and `npm run smoke:vscode-preview`.
6. **JetBrains local runtime host**: complete as a buildable Gradle plugin shell with JCEF bridge, packaged GUI asset flow, and MVP local runtime connect/launch/auto settings.

Next implementation work should focus on roadmap-visible product foundations without expanding privileged behavior: turn packaged GUI and launcher MVPs into production packaging flows, add signed/notarized engine bundle and installer decisions, improve the local GUI/UX foundations, move local session tokens to platform secret stores where still missing, and tighten schemas for non-`user_message` commands and privileged bridge messages when required by milestone acceptance criteria. Hardening, lifecycle coverage, and smoke tests are required when tied to those milestones and acceptance criteria, but they should not become an open-ended replacement for roadmap work. Broader IDE/file/tool actions may be introduced only behind explicit policy and confirmation after the product foundation and contracts justify them. Current controlled IDE actions in VS Code and JetBrains are limited to local bounded read-only/navigation/context actions (`getContextSnapshot`, `openWorkspaceFile`, and `revealWorkspaceRange`); `getContextSnapshot` returns metadata only (source, active-editor boolean, workspace folder count), open/reveal are navigation only, and action result metadata does not carry file paths for context snapshots, selected text, or raw file contents. Browser remains preview/test fallback and does not execute controlled actions. JetBrains execution is through strict wrapper/Kotlin policy and correlated progress/results only after explicit GUI/user request. The engine may observe sanitized progress/action metadata only and must not execute IDE tools, mutate workspaces, read arbitrary files, call providers for IDE actions, or run shell/git/task/tool operations. Confirmed edit proposals remain the only write path and require explicit confirmation; JetBrains apply is dev-preview only through the existing `gui.applyWorkspaceEditRequest` / `host.applyWorkspaceEditResult` bridge messages, while browser mode remains preview-only/non-executing. Safe-edit model output is proposal-only. The real-provider prompt may ask for either normal explanation or one exact raw JSON `gui.applyWorkspaceEditRequest` envelope so the GUI can detect a reviewable edit, but parsing that envelope does not authorize mutation. The envelope must omit assistant `requestId`, require user confirmation, set `cloudRequired: false`, and stay limited to bounded replacements in existing workspace-relative files; the GUI mints request correlation only when the user explicitly applies the reviewed proposal.

Every follow-up card must keep the no-required-cloud contract intact: core chat, completion, agent, provider setup, local project storage, and IDE GUI workflows must work through the local runtime without a required hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace. Provider-auth follow-up work must keep production/default account login blocked until an official provider-supported local-app flow is approved. The safe real-provider path remains local API-key/project-key setup through engine-owned credential storage, and any experimental login-shaped GUI response must stay bounded and sanitized before crossing into GUI or IDE wrappers.

## Current decision

The default implementation strategy is: clean local-first scaffold first, approved selective reuse later only when justified. Full fork/copy is rejected because Yet AI needs independent identity, storage, packaging, and new UI/design from the start.
