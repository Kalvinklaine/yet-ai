# Yet AI

Yet AI is an architecture-inspired independent AI coding assistant for IDEs. The repository now has a buildable local MVP foundation: a Rust local runtime, provider registry, OpenAI-compatible streaming path, React/Vite GUI shell, VS Code webview host shell, JetBrains JCEF host shell, and typed contracts between them.

## Current status

- Approach: independent architecture-inspired rebuild, not a fork or rename of any external project.
- Baseline: buildable MVP scaffolds exist for the engine, GUI, VS Code plugin, and JetBrains plugin. They are suitable for local development and contract hardening, not production release.
- IDE preview status: VS Code and JetBrains shells can use packaged GUI assets generated from `apps/gui/dist`, or a loopback GUI dev server, and both support MVP local runtime `connect`, `launch`, and `auto` workflows for `yet-lsp`. `npm run prepare:vscode-preview` also publishes a local ignored VS Code dev-preview artifact at `dist/plugins/vscode/yet-ai-vscode-<version>-dev-preview.vsix` with a matching `.sha256` checksum for install-from-file smoke testing.
- Product-sensitive values should be centralized in `product/identity.json` where practical. Temporary identity placeholders remain until final product IDs, publishers, domains, and marketplace metadata are approved.
- Runtime strategy: local-first BYOK. The IDE plugin starts or connects to the local Yet AI runtime on the user's machine; there is no required Yet AI account, hosted backend, managed model gateway, product credit balance, or cloud workspace for core workflows.
- Model requests go directly from the local runtime to configured hosted providers or local runtimes. Provider settings and credentials remain local, and GUI-facing responses must not include raw secrets.
- Provider secret storage status: provider credentials are owned by the engine secret store, not provider config JSON or GUI/browser storage. Production builds prefer OS credential storage where the platform service is available and use protected files under user config only when the primary store is disabled by policy or for safe fallback reads after an empty healthy primary lookup. Debug/test/dev automation uses the protected-file fallback by policy to avoid headless keychain prompts. Keychain reads are bounded and can report sanitized unavailable status, but keychain writes and deletes wait for the blocking operation to complete rather than timing out and assuming a late side effect will not occur. Transient primary write/delete failures, locked-keychain read unavailability, read-back mismatches, or fallback cleanup failures return sanitized storage errors instead of silently succeeding through fallback, which prevents stale primary/keychain values from resurrecting later. If the primary is unavailable, reads fail closed instead of returning potentially stale fallback values; fallback reads are allowed only when the primary is explicitly disabled by build/policy. Legacy provider configs that still contain inline `auth.apiKey` are migrated on normal provider/model/test/chat access: the engine writes the secret first with atomic create-if-absent semantics, then scrubs the provider config. Existing stored secrets win over stale inline values. Fallback records migrate to keychain only after verified write/read-back; fallback cleanup is retried on later healthy primary reads, and healthy primary reads fail closed if cleanup still fails. Keychain/primary values win only when the primary is healthy and strict migration/delete policy has not rejected the operation. The keychain create-if-absent path uses an in-process lock and read-back verification, which protects one local runtime process but is not a cross-process keychain lock. Provider create commits API-key material with put-if-absent before config creation and rolls back the committed secret if config creation fails. Provider delete validates the id and attempts API-key cleanup before removing config so retries can clean orphaned secrets even if the config file is already gone. Provider updates commit explicit secret changes before config persistence and roll secret state back if secret commit or config write fails; metadata-only provider updates do not hydrate, read, rewrite, or delete credentials. This is local-first BYOK storage only: not cloud sync, not hosted custody, not enterprise secret management, not an official production OAuth claim, and not a guarantee that every platform has an unlocked or usable credential service.
- Provider/model readiness status: `/v1/models`, `/v1/caps`, and provider summaries now expose sanitized normalized model metadata with `capabilities.chat`, `capabilities.streaming`, `capabilities.tools`, `capabilities.reasoning`, and `readiness.status` values `ready`, `disabled`, `missing_credentials`, `missing_model`, or `unsupported`. Chat send/selection uses only enabled configured providers with models whose metadata is `ready` and supports chat plus streaming; older or missing metadata is not treated as ready. This metadata is local display/selection data only: it does not enable tools, tasks, knowledge, shell execution, file edits, reasoning orchestration, dynamic provider discovery, or a production agent runtime.
- Provider/chat error taxonomy status: chat SSE errors and persisted error messages use stable sanitized categories for not-configured or model-not-configured state, unauthorized credentials, rate limit/quota, context too large, invalid request, timeout, upstream failure, malformed stream, local provider config errors, and safe fallback request failures. Classification can inspect only bounded provider signals and is best-effort because not every provider uses OpenAI-compatible error shapes. GUI recovery guidance maps these categories to user actions such as re-entering local credentials, checking quota, reducing the prompt or attached editor context, selecting a different model, fixing provider configuration, retrying later, or checking provider status. Raw provider error bodies, request bodies, Authorization headers, API keys, OAuth tokens, cookies, private paths, account identifiers, and debug payloads must not be exposed through GUI/SSE/history/docs/tests/smoke output. Provider calls remain direct local BYOK calls from the runtime to configured providers or local runtimes; no Yet AI hosted proxy, managed gateway, account, product credit balance, or cloud workspace is required.
- First-message context status: VS Code and JetBrains can capture a bounded active editor/selection snapshot through the same strict `host.contextSnapshot` bridge contract, the GUI previews it with an opt-in include toggle, and the local runtime can prepend that context to the next accepted chat prompt sent to the configured provider. GUI active context is one-shot: after an accepted send, the attached snapshot is cleared and must be supplied again by the IDE host. Included context is visible to the provider, so users should not attach selections containing secrets or private data.
- Local chat history status: conversations are a dev-preview local MVP owned by the engine under Yet AI local storage. The GUI can list, create, switch, load, and delete chats through engine endpoints, but it must not persist messages in browser `localStorage` or `sessionStorage`. User prompts and assistant replies may be persisted locally as chat history, so users should not paste secrets into prompts. Provider API keys, OAuth tokens, authorization codes, PKCE verifiers, cookies, local runtime session tokens, raw provider responses, credential paths, and private local paths are never chat metadata. Deleting a conversation deletes local Yet AI history only; it is not provider-side deletion, cloud sync, encrypted production retention, or enterprise data governance.
- Engine HTTP boundary status: `/v1` routes use an explicit request body limit sized for current provider, provider-auth, and chat command payloads. Malformed, type-invalid, or oversized JSON bodies return sanitized request-body errors without parser details or request echoes. Chat ids are path-safe bounded identifiers validated before chat history access, chat commands, and SSE subscription work; invalid ids or invalid subscribe queries fail with safe non-SSE errors and do not echo submitted ids. This is boundary hardening only and does not add tools, tasks, knowledge, shell execution, workspace mutation, or production agent functionality.
- Provider-auth status: the safe/default real-provider path is the OpenAI API-key or project-key fallback through the local runtime. The GUI now presents a more productized OpenAI account-login card with guided unavailable, pending, connected, expired/revoked, sanitized-error, API-key-configured, retry, reconnect, disconnect, and API-key fallback states. Provider-auth pending/session state is local engine-owned state: hardened pending files and the composite keychain/fallback secret-store boundary live under engine custody, while raw provider secrets, tokens, authorization codes, PKCE verifiers, cookies, browser profiles, and credential file paths are never GUI-owned or GUI-facing. That account path is still a separate explicit-risk experimental Codex-like flow backed by engine-owned PKCE/session state, sanitized provider-auth status, local secret storage, and chat fallback when no API-key provider is configured. Its refresh path treats refresh tokens as rotating/single-use, refreshes expired or near-expired chat auth before provider requests, serializes refresh per local provider/account/config state, uses a Unix local file lock where supported, reloads latest stored tokens after locking, handles `refresh_token_reused` by checking for a newer usable access token before requiring reconnect where possible, and keeps token endpoint bodies and raw access/refresh tokens engine-only. Cross-process locking is local and platform-limited: unsupported platforms fail closed for this experimental refresh path, and it is not a distributed or production OAuth guarantee. Chat retries through this path only once for pre-stream HTTP `401` status with a changed stored access token, without depending on reading the provider error body; HTTP `403` permission failures and in-stream auth error frames do not refresh or retry. It is private-endpoint-style hardening, not official public OpenAI OAuth support, not an OpenAI partnership claim, and not production-ready. Automated coverage for that account path is loopback/mock-only; any real account testing is manual, high-risk, account-specific, outside CI, and must capture only sanitized evidence.
- Planner reliability status: the no-idle autonomous planner/watchdog is documented as a future contract only. It must not silently wait when completed agents, mergeable work, verification, ready cards, failed/stuck recovery, pool closure, or approved next-pool planning can progress; any true idle state must carry an audited reason.
- Planner scheduler checks are contract/simulator smoke coverage only: `npm run check:planner-scheduler`, `npm run smoke:planner-no-idle`, and `npm run smoke:planner-resume` validate the no-idle invariant, durable local simulator ticks, and restart/resume behavior locally without production autonomous orchestration, real agents, git operations, shell/tool execution, file edits, or workspace mutation.
- Agent progress observability status: current coverage includes strict event/snapshot/list-response contracts, a pure reducer/classifier, durable local simulator state, a CLI reporter, deterministic simulator smoke, engine `GET /v1/agent-progress`, a focused endpoint smoke, and a GUI read-only Agent progress panel with deterministic browser smoke. The engine endpoint reads an engine-owned local progress source, can return populated sanitized snapshots, returns an empty list when the source is missing, and reports corrupt, oversized, or unsafe source data only as sanitized unavailable/error text. The GUI panel only refreshes and renders safe progress states; it has no Start, Stop, Merge, Apply, shell, tool, provider-call, or workspace-mutation controls. This does not implement production background agents, real runner hooks, real task-board integration, git merges, tool execution, shell authority, workspace mutation, cloud sync, or hosted services. Future runner wiring should emit sanitized progress events from lifecycle hooks only. Safe fields are ids, phase/status, tool label/kind, elapsed and heartbeat ages, stuck reason, recent summaries, bounded sanitized output-tail summaries, and bounded overflow recovery guidance. A `context_length_exceeded` after a broad tool call is treated as planner/tool-output overflow, not a source-code or test failure. Recovery should use scoped calls such as `task_ready_cards`, a specific `task_board_get(card_id)`, targeted `search_pattern`, targeted `cat`, and short summaries; avoid full `task_board_get({})` unless necessary and expected to be small. Large tool outputs and task-board dumps must be summarized, bounded, and sanitized before they appear in progress state, reports, docs, or GUI. Forbidden data includes prompts, chain-of-thought, raw file contents, raw provider responses, tokens, cookies, provider credentials, runtime session tokens, credential paths, private absolute paths, shell scripts, and patch payloads.
- Bridge and chat command policy: current accepted chat commands are only `user_message` and no-op-safe `abort`; current accepted GUI-to-host bridge input is only strict `gui.ready`; current host-to-GUI messages are `host.ready`, `host.openedFromCommand`, and non-privileged `host.contextSnapshot`. Future privileged chat commands (`regenerate`, `update_message`, `remove_message`, `set_params`, `tool_decision`, `ide_tool_result`) and future GUI-to-host actions (`gui.openFile`, `gui.revealRange`, `gui.applyWorkspaceEditRequest`, `gui.executeIdeTool`, `gui.copyText`, `gui.showNotification`, `gui.getHostContext`) are intentionally rejected. Before any privileged action is enabled, Yet AI must add strict schemas, request correlation, host origin/source checks, user confirmation where risk exists, sanitized audit/logging, least-privilege allowlists, and a no-silent-workspace-mutation policy.
- Limitations: the baseline is not production-ready; no marketplace packaging, signed or notarized engine bundles, production installer, autonomous file reads/indexing, LSP/completions/tools/file edits/apply patch, shell/tool execution, full agent autonomy, background agent autonomy, production no-idle scheduler, or integration workflows are complete. Tools, tasks, and knowledge remain disabled. Current chat is a local provider/chat MVP only.

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

`npm run smoke:local` starts the Rust engine on a free loopback port through Cargo, starts local mock OpenAI-compatible, experimental token, and experimental chat endpoints, configures a fake local API key, checks ping/caps/provider setup/chat command/SSE streaming, exercises local chat history create/list/get/delete and persisted snapshot hydration, exercises provider-auth default status plus the local mock OAuth start/exchange/status/disconnect flow, and covers the approved experimental Codex-like start/exchange/chat fallback through loopback mocks only. It also verifies that bounded active editor context attached to a chat command reaches the mock provider prompt through the local runtime. Runtime and provider-test regressions use deterministic loopback mock helpers; Authorization expectations are asserted by the Rust test bodies from observed mock requests rather than hidden provider calls. It verifies raw fake API keys, OAuth access tokens, refresh tokens, Authorization header values, cookies, PKCE verifier values, mock auth codes, active selection markers, Codex credential-file paths, and local chat history responses/events do not leak client-visible secrets. JetBrains wrapper/browser smoke separately covers the JetBrains-style `host.contextSnapshot` bridge path, GUI preview/toggle behavior, one-shot disabled-toggle omission, and enabled context delivery to `user_message.payload.context` with local loopback mocks only. Prerequisites: Node 18+ with root dependencies installed and a Rust toolchain with Cargo on `PATH`.

Run the focused provider error smoke when changing provider chat failure classification, SSE stream error handling, or sanitized chat error history:

```sh
npm run smoke:provider-errors
```

`npm run smoke:provider-errors` starts the Rust engine with isolated local storage and loopback-only OpenAI-compatible mocks, configures a fake API-key provider, and exercises unauthorized, rate-limit, context-window, invalid-request, upstream, malformed-SSE, and OpenAI-style stream error-frame failures. It verifies accepted chat commands, stable SSE error codes/messages, sanitized persisted chat history, and no raw fake keys, bearer strings, cookies, provider bodies, auth codes, request-body secret markers, or private paths in client-visible output.

Run the polished IDE Chat MVP browser/runtime smoke after changing the GUI first-message flow, active-context attach behavior, chat history rendering, or IDE bridge wiring:

```sh
cd apps/gui && npm run build
cd ../..
npm run smoke:gui-runtime-e2e
```

`npm run smoke:gui-runtime-e2e` uses only loopback services and fake credentials. It starts the local runtime with an IDE-style trusted session token, drives the built GUI, configures a fake OpenAI-compatible provider, simulates active editor context, sends one message with context included and one with context omitted, verifies provider prompt boundaries, checks streaming assistant rendering, reloads engine-owned local chat history, and asserts that generated runtime tokens, fake provider keys, and active-context sentinels do not appear in DOM text, browser storage, console/page errors, or smoke output.

Run focused provider secret checks when changing legacy inline API-key migration, keychain/fallback policy, or the engine secret-store boundary:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p yet-lsp secret_store
cargo test -p yet-lsp provider_secret
npm run smoke:provider-secret-migration
```

`cargo test -p yet-lsp secret_store` includes deterministic composite secret-store coverage for keychain-primary/fallback behavior, verified fallback-to-primary migration, read-back mismatch preservation, strict transient-unavailable write/delete rejection, disabled-primary fallback policy, cleanup retry, and delete coverage across API-key and OAuth secret kinds without requiring a real OS keychain. `cargo test -p yet-lsp provider_secret` covers provider lifecycle consistency for migration, stored-secret-wins behavior, retryable provider delete cleanup, missing-config orphan cleanup, update rollback after secret failures, and sanitized failure bodies. `npm run smoke:provider-secret-migration` starts the local runtime and loopback provider mocks with isolated storage, seeds legacy provider configs containing fake inline API keys, triggers migration through provider/model endpoints, verifies configs are scrubbed and fallback secret files are created, checks provider-test Authorization with digest/length assertions only, and proves an existing stored secret wins over a different legacy inline key without leaking raw fake secrets. The post-review focused gate for secret-store/provider lifecycle changes is:

```sh
export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp secret_store && cargo test -p yet-lsp provider_secret && cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat && git status --short
```

The broader secure local credentials final gate context is:

```sh
export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp secret_store && cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat && cargo test -p yet-lsp && npm run smoke:provider-secret-migration && npm run smoke:local && npm run check && git status --short
```

Run focused engine HTTP boundary regressions when changing request-body rejection, chat id validation, or chat subscribe behavior:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p yet-lsp http_boundary
npm run smoke:local
```

Run repository validation from the root before publishing or handing off changes:

```sh
npm run check
```

`npm run check` validates product identity, public repository hygiene, the documentation index, and contract schemas/examples, including required positive and negative contract fixture coverage.

Contract schemas and examples can be validated separately with:

```sh
npm run validate:contracts
```

`npm run validate:contracts` validates contract schemas/examples only, including mapped examples and product identity fields embedded in contract examples.

Run the pure planner scheduler reducer check, deterministic no-idle smoke, and durable resume smoke from the root when changing planner contracts, scheduler policy docs, or simulator behavior:

```sh
npm run check:planner-scheduler
npm run smoke:planner-no-idle
npm run smoke:planner-resume
```

These commands are local-only contract/simulator checks. They verify that completed, mergeable, verifiable, ready, failed/stuck, closeable, approved next-pool, and restarted durable-state states produce progress actions or explicit audited idle blockers. They also cover a simulator state file with sanitized audit timeline entries, a single active scheduler lease owner per tick, released leases after process-like ticks, and stale-heartbeat recovery after reload. They do not launch production agents, edit files, apply patches, run shell/tools, perform real merges, call providers, or mutate workspaces.

The durable scheduler simulator tick CLI is available for explicit local state files:

```sh
npm run planner:scheduler:tick -- --state path/to/scheduler-state.json
```

The tick runner loads the given simulator state, acquires a scheduler lease for one owner, applies the pure scheduler decision, appends a sanitized audit tick, releases the lease, persists the state unless `--dry-run` is used, and prints a compact next-action summary. It is a local simulator utility only, not a production task-board, agent, merge, verification, shell, tool, or workspace mutation runner.

Run the agent progress checks and deterministic smokes when changing progress contracts, reducer behavior, local progress state, reporter output, engine read-only progress endpoint, GUI read-only panel, or observability docs:

```sh
npm run check:agent-progress
npm run smoke:agent-progress
npm run smoke:agent-progress-endpoint
npm run smoke:gui-agent-progress
```

Agent Progress is local-only observability. The canonical local progress source for normal engine reads is the Yet AI user cache file `agent-progress/progress.json` under the product cache directory, commonly resolved by the JS writer helper as `<cacheRoot>/yet-ai/agent-progress/progress.json` when `cacheRoot` is the platform cache root. The public `progress.json` file is an `AgentProgressListResponse` that the endpoint can read directly. Internal event accumulation is stored separately by the JS helper in a sibling internal events file and should not be consumed by the engine or GUI. `scripts/planner-agent-progress-state.mjs` exposes the local writer API: `resolveAgentProgressStatePath`, `appendProgressEvent`, `readProgressState`, and `snapshotProgressState`. The resolver uses an explicit `--state` path first, then `YET_AI_AGENT_PROGRESS_STATE`, then the canonical cache path. The writer appends sanitized bounded events with atomic replacement and a private local lock file, then publishes the public list-response file; it is for explicit local developer workflows only, not a production background agent.

Use the compact reporter and command wrapper from the root when deliberately writing local progress:

```sh
npm run planner:agent-progress:report -- --state path/to/progress.json
npm run planner:agent-progress:run -- --card T-123 --run local-run-1 --state path/to/progress.json -- npm run check
```

Omit `--state` only when you intentionally want the wrapper to use `YET_AI_AGENT_PROGRESS_STATE` or the canonical cache path. The wrapper records started/running heartbeat/output/done/failed events around the explicitly supplied command and returns that command's exit code. It captures only bounded sanitized output tails and grants no shell/tool/git/provider/workspace authority beyond the local command the developer already chose to run.

`npm run check:agent-progress` validates deterministic sanitization, reducer classification, stuck/healthy/done states, overflow recovery classification, local state persistence, canonical writer path behavior, wrapper behavior, and compact CLI reports. `npm run smoke:agent-progress` exercises local simulator scenarios for healthy long-running work, heartbeat timeout, failed command redaction, explicit secret redaction, context overflow after oversized task-board-like output, oversized tool output, and terminal done state. `npm run smoke:agent-progress-endpoint` starts the local engine with isolated storage, verifies missing-source empty behavior, writes populated sanitized local progress through the live writer/wrapper path, checks local/direct healthy and failed snapshots with heartbeat/tool-output freshness, and verifies corrupt source errors remain sanitized. `npm run smoke:gui-agent-progress` builds and serves the GUI with loopback-only runtime mocks, verifies the read-only Agent progress panel for empty, healthy, stuck, failed redacted, freshness, and overflow recovery states, and checks that mutating agent controls are absent. Missing source returns an empty list. Corrupt, oversized, or unsafe source data returns only sanitized unavailable/error text. Overflow recovery smoke coverage is deterministic and local-only; it asserts bounded sanitized summaries rather than raw prompts, provider responses, file contents, private paths, auth files, task-board dumps, or large tool output. The final agent-progress read-only surface gate context is:

```sh
npm run check:agent-progress && npm run smoke:agent-progress && npm run smoke:agent-progress-endpoint && npm run smoke:gui-agent-progress && npm run check && git status --short
```

These commands do not run production agents, execute tools, perform git operations, mutate workspaces, call providers, or require a hosted Yet AI backend.

Run the cross-boundary overflow/raw-content hardening gate when changing planner safe-text contracts, scheduler durable state sanitization, agent-progress reducer classification/redaction, or GUI fallback overflow rendering:

```sh
npm run validate:contracts && npm run check:planner-scheduler && npm run smoke:planner-no-idle && npm run smoke:planner-resume && npm run check:agent-progress && npm run smoke:agent-progress && npm run smoke:agent-progress-endpoint && npm run smoke:gui-agent-progress && npm run check && git status --short
```

This gate verifies that contracts reject unsafe public payloads, scheduler simulator state cannot persist unsafe active guidance, agent progress classifies from bounded raw head/tail while persisting sanitized output, and the GUI renders only sanitized bounded overflow guidance.


Prepare and validate the local VS Code installable dev-preview artifact from the root when changing VS Code packaging, packaged GUI, or preview docs:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:vscode-preview
npm run smoke:vscode-installable
npm run smoke:vscode-preview
```

`npm run prepare:vscode-preview` builds/prepares the local engine, builds `apps/gui`, prepares the VS Code extension output, and writes the stable ignored artifact `dist/plugins/vscode/yet-ai-vscode-<version>-dev-preview.vsix` plus `dist/plugins/vscode/yet-ai-vscode-<version>-dev-preview.vsix.sha256`. `npm run smoke:vscode-installable` validates the root VSIX name, checksum, archive paths, package metadata, bundled identity, packaged GUI assets, and copied engine binary without launching VS Code. `npm run smoke:vscode-preview` validates the generated extension workspace artifacts. The generated VSIX, checksum, GUI assets, extension output, engine binaries, and root `dist/` artifacts are ignored and must not be committed. This is a local dev-preview/install-from-file flow only: it is not marketplace publication, signing, notarization, a production installer, or a production release, and it requires no provider credentials, hosted Yet AI backend, real OpenAI/ChatGPT calls, or cloud workspace.

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

### Runtime token quick guide

There are two separate secret categories in the dev preview:

- Local runtime Session token: authorizes GUI-to-`yet-lsp` loopback HTTP/SSE requests only.
- Provider API key: authorizes model-provider calls made by the local runtime, for example an OpenAI API key saved through Provider setup.

For IDE-launched runtimes, do not paste `local-dev-token` into the GUI. In VS Code and JetBrains `auto` or `launch` mode, the plugin generates a local runtime token, starts `yet-lsp` with `YET_AI_AUTH_TOKEN`, and provides the token to the packaged GUI through trusted `host.ready` bootstrap. In the normal VS Code dev-preview path, run `npm run prepare:vscode-preview`, keep `yetai.launchMode = auto`, open the Extension Development Host, and run `Yet AI: Open Chat`; do not manually run `yet-lsp` or copy a runtime token. In JetBrains normal dev-preview testing, keep `Launch mode = auto` or `launch` and set `Engine binary path = /absolute/path/to/target/debug/yet-lsp` only when discovery from `PATH` is insufficient.

Use `local-dev-token` only for a manually started runtime:

```sh
YET_AI_AUTH_TOKEN=local-dev-token YET_AI_HTTP_PORT=8001 cargo run -p yet-lsp
```

Then set GUI runtime settings to `Runtime base URL = http://127.0.0.1:8001` and `Session token = local-dev-token`. Do not put OpenAI or provider API keys in the Session token field; choose the GUI `OpenAI API` provider preset, paste the provider key once in the API key field, save, and confirm the field clears.

### First-message IDE smoke

Use this concise smoke after preparing either IDE dev preview. For VS Code, the default path is no manual runtime launch and no runtime-token copying:

1. Run `npm run prepare:vscode-preview` from the repository root for VS Code, or the matching prepare command for another IDE preview.
2. In the VS Code Extension Development Host, keep `yetai.launchMode = auto` and run `Yet AI: Open Chat`. The extension discovers or uses the copied engine, starts it with `YET_AI_AUTH_TOKEN`, and sends the local runtime Session token to the GUI only through trusted `host.ready`.
3. Do not manually run `yet-lsp` or paste `local-dev-token` for the normal VS Code preview. Use the manual runtime command only for deliberate `connect`-mode debugging.
4. Click `Refresh runtime`. It checks `/v1/ping`, `/v1/caps`, `/v1/models`, provider summaries, and OpenAI provider-auth status through the local runtime.
5. Interpret runtime feedback: connected means the loopback runtime and model/provider metadata are reachable; network/configuration errors mean URL, port, binary, or runtime startup problems; runtime `401` means the local Session token does not match `YET_AI_AUTH_TOKEN`; provider `401` means the provider API key was rejected by the upstream provider.
6. Configure the safe/default `OpenAI API` API-key fallback or a local OpenAI-compatible mock/provider. The provider key belongs only in Provider setup, is sent to the local runtime, clears after save, and must not be stored in VS Code settings or the Session token field.
7. Use provider test/status as sanitized feedback. If the GUI shows an active editor/selection context preview from VS Code or JetBrains, include it only when the selection is safe to send to the configured provider.
8. Send `Say hello in one sentence.` Expected behavior: the user message is accepted, optional included context is prepended by the local runtime, SSE opens, the assistant streams snapshot/start/delta/finish updates, and the conversation appears in engine-owned local history without any Yet AI hosted backend, cloud workspace, managed gateway, product credit balance, or Yet AI account. After the accepted send, the GUI clears the attached context; a later message needs a fresh IDE snapshot.

Active context is a prompt-only, bounded, non-privileged IDE context feature for the next accepted message. The GUI preview shows the source host, file/workspace path, language/range metadata, selected character count, and a bounded sanitized preview before the user chooses whether to attach it. It does not enable autonomous file reads, workspace indexing, file edits/apply patch, shell/tool execution, or background agent autonomy.

A login/account-based GPT first-message UX remains a mandatory future milestone. The safe/default real-provider path is still the OpenAI API-key or project-key fallback through the local runtime. The current experimental Codex-like account path is separate, explicit-risk, private-endpoint-style, mock-only in automation, not official public OpenAI OAuth support, not an OpenAI partnership claim, not production-ready, and not the default first-message path.

For JetBrains runtime failures, use Tools → `Yet AI: Show Runtime Status` for sanitized launch/binary/ping diagnostics and Tools → `Yet AI: Restart Runtime` to restart only the plugin-owned local runtime.

### JetBrains installable ZIP dev preview

Build a local IntelliJ IDEA install-from-disk ZIP with:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm run prepare:jetbrains-preview
```

The command builds/prepares `yet-lsp`, builds `apps/gui`, runs the JetBrains Gradle build, prints the original ZIP path under `apps/plugins/jetbrains/build/distributions/`, and copies the current dev-preview artifact plus checksum to the stable ignored root path `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` and `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip.sha256`. It also prints the local `Engine binary path` to configure when the plugin cannot discover the engine from `PATH`. Missing Gradle is a local prerequisite failure. Gradle failures while resolving JetBrains dependencies such as `java-compiler-ant-tasks`, JetBrains cache metadata, or `instrumentCode` are external Gradle dependency/network failures: retry with a stable network, verify Gradle can resolve JetBrains dependencies, and use cached/offline Gradle only after dependencies are already present locally.

Manual IntelliJ IDEA smoke steps:

1. Run `npm run prepare:jetbrains-preview`.
2. Open IntelliJ IDEA Settings/Preferences → Plugins → gear → Install Plugin from Disk.
3. Choose the stable root ZIP at `dist/plugins/jetbrains/yet-ai-jetbrains-<version>-dev-preview.zip` and restart the IDE. The Gradle output path printed under `apps/plugins/jetbrains/build/distributions/` is kept for diagnostics.
4. Set `Launch mode` / `Engine binary path` if needed.
5. Open the Yet AI tool window and verify the packaged UI/chat path.
6. Optional safe provider smoke: use the OpenAI API-key fallback. The experimental account login remains explicit-risk; automated coverage is mock-only and real account testing is manual/high-risk/outside CI.

Validate the local ZIP without launching an IDE with the canonical preflight sequence:

```sh
npm run prepare:jetbrains-preview
npm run smoke:jetbrains-installable
npm run smoke:jetbrains-gui-browser
npm run smoke:jetbrains-wrapper-browser
```

The installable smoke checks Gradle ZIP structure, the copied root `dist/plugins/jetbrains/` dev-preview artifact, checksum matching, packaged GUI contents, and docs only. The GUI browser smoke verifies the packaged GUI resources from the installable ZIP render on loopback with working JavaScript and CSS assets. The wrapper browser smoke verifies the JetBrains-like wrapper and GUI bridge path on loopback with mock runtime/provider-auth only, including a JetBrains-style active editor/selection `host.contextSnapshot`, attached-context preview, default include behavior, disabled-toggle omission, and enabled context delivery to the runtime command. No provider credentials, real OpenAI/ChatGPT calls, hosted Yet AI services, signing, marketplace publication, production installer, or bundled notarized engine are involved.

### Manual OpenAI API-key milestone smoke

The current real-provider milestone is a manual VS Code dev-preview smoke path for the OpenAI API-key fallback only. It is not an automated test, does not require a Yet AI hosted backend, and must never commit, log, screenshot, or paste a real key into issue text or repository files.

Use `apps/plugins/vscode/README.md#openai-api-key-fallback-milestone-smoke` for the detailed checklist:

1. Run `npm run prepare:vscode-preview` from the repository root.
2. Open the Extension Development Host, keep `yetai.launchMode = auto`, and run `Yet AI: Open Chat`; do not manually start `yet-lsp` or paste `local-dev-token` for this normal preview path.
3. Choose the GUI `OpenAI API` preset, paste an API key once in Provider setup, save, and confirm the key field clears.
4. Confirm the GUI and runtime show only configured/redacted provider status, never the raw key, and never ask for the provider key in VS Code settings or the Session token field.
5. Use provider test/status as sanitized feedback, then send `Say hello in one sentence.` and verify snapshot plus streaming response behavior.

Current real-provider testing should use an OpenAI API-key or project-key fallback through the local runtime. This remains the safe/default path.

### Manual experimental account-login checklist

Use this checklist only for an explicitly accepted manual real-account run of the experimental Codex-like account path. It is safe to share as a process checklist, but the resulting evidence must stay sanitized. Do not run this checklist in CI, smoke scripts, or unattended automation.

1. Confirm the tester understands the flow is experimental, private-endpoint-style, account-specific, high-risk, not official public OpenAI OAuth support, not an OpenAI partnership, and not production-ready.
2. Record only non-secret preconditions: OS, IDE, launch mode, whether the GUI opened from packaged assets, and whether the local runtime used `auto` / `launch` without manual runtime-token copying.
3. Review visible consent and scopes before continuing. Record scope names and consent wording only if they do not contain tokens, authorization codes, account-private URLs, cookies, or other secrets.
4. Start the account flow from the GUI account-login card. Verify pending guidance appears without raw session IDs, PKCE verifier values, authorization codes, cookies, access tokens, refresh tokens, or credential-file paths.
5. Complete connect/exchange only through the GUI/runtime flow. Do not paste secrets into reports, logs, screenshots, issues, fixtures, or repository files.
6. After connected status, verify the GUI shows only sanitized account labels, scopes, expiry, status, and redacted hints. Send `Say hello in one sentence.` and record only sanitized first-message success or sanitized failure text.
7. Exercise safe failure paths when feasible: denied consent, expired or revoked session, provider outage/unavailable model, and retry/reconnect behavior. Evidence must be sanitized and must not include raw provider responses.
8. Disconnect, then reconnect if the task asks for relogin coverage. Confirm disconnect/reconnect states are sanitized and that API-key fallback remains available.
9. Before sharing results, remove secrets from terminal scrollback, screenshots, browser devtools, notes, and issue text. Reports may include status labels, redacted account hints, non-secret scope names, timestamps, and concise sanitized errors only.

A login/account-based GPT first-message UX is still a mandatory future milestone, but it is not the default current VS Code first-message path. The user approved a T-49 experimental Codex-like login task chain even though no public third-party OpenAI OAuth program has been identified. That approval allows engine-owned PKCE/session state, authorization/token exchange, refresh, revoke/disconnect, sanitized GUI status, and local secret storage modeled after Codex-like behavior. The local smoke test covers this path only with loopback token and chat mocks; CI must not call OpenAI, ChatGPT, private Codex endpoints, or use real account credentials for this flow. Any real provider testing of the experimental path is manual, risky, account-specific, and outside CI. It does not approve cookie scraping, browser profile import, browser cookie reuse, direct import or reading of `~/.codex/auth.json` or other tools' credential files, or any required Yet AI hosted backend, account, managed gateway, product credit balance, or cloud workspace. This approval does not imply production readiness, official OpenAI partnership, or general public OAuth support; private endpoint and client-identity risk must stay visible in implementation and docs.

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
