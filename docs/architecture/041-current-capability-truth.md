# ADR 041: Current Capability Truth

- Status: accepted
- Plan traceability: master-plan v5, Wave 0, T-158
- Scope: current product capability provenance and host availability

## Context

Yet AI has real engine and IDE-host behavior alongside GUI-local derivations, contract fixtures, demo paths, and deliberately unsupported operations. A schema, fixture, capability card, reducer, smoke harness, or documentation statement does not prove that the live engine or an installed host supplies the behavior. Mixing those evidence classes makes a polished preview look like runtime authority.

This record is the canonical current-state map for product and capability work. Read it before changing capability claims, readiness metadata, controlled-agent surfaces, host parity, progress, LSP, or packaging. Architecture targets remain in `003-target-architecture.md`; this record answers only what is reachable now and from which boundary.

## Decision

Every capability claim must use one of the following exact provenance statuses:

- `live_engine`: reachable engine behavior backed by an engine code path and focused engine or end-to-end verification.
- `live_host`: reachable browser or IDE-host behavior backed by host code and focused host or end-to-end verification.
- `local_derived`: computed locally from already available data, or produced by an explicit developer/build helper, without proving that a live engine or host originates the underlying capability.
- `fixture_demo`: schema, fixture, mock, canned Demo Mode, preview metadata, or harness-only behavior that must not be presented as live product provenance.
- `unsupported`: absent or intentionally fail-closed on the stated boundary.

A row receives the strongest status proved for the narrowly named boundary, not for a broader feature family. Host differences remain explicit. Experimental, dev-preview, manual-only, unsigned, unpublished, and non-production limitations survive classification; `live_engine` and `live_host` do not mean production-ready.

Documentation and fixtures can preserve a contract but cannot promote it. An implementation claim requires both an authoritative product code path and code/test evidence. When either is absent, use `local_derived`, `fixture_demo`, or `unsupported`.

## Canonical capability matrix

The verification column names the strongest focused evidence currently present. It does not assert that the command passed on every revision; evidence status for a particular run still uses ADR 040's separate vocabulary.

| Capability ID | Current status | Authoritative code path | Strongest current verification | Limitations and truthful interpretation |
| --- | --- | --- | --- | --- |
| `projects` | `live_engine` | `apps/engine/src/projects.rs`, `apps/engine/src/http/project.rs`, `apps/engine/src/storage.rs` | `cargo test -p yet-lsp project_`; `npm run smoke:browser-project-isolation` | Opaque project registry, request-scoped isolation, and project chat/memory/progress storage are real. Multi-root projects, background indexing, and a daemon supervisor are unsupported. |
| `project_context` | `live_engine` | `apps/engine/src/project_context/`, `apps/engine/src/chat_turn_context.rs`, `apps/engine/src/chat.rs`, `apps/engine/src/http/project.rs`, `apps/engine/src/http/mod.rs`, `apps/engine/src/storage.rs` | `cargo test -p yet-lsp project_context_watch`; `cargo test -p yet-lsp project_context_inventory`; `cargo test -p yet-lsp project_chat_context`; `cargo test -p yet-lsp chat_turn_context`; `npm run smoke:project-context-continue` | Authenticated project-scoped inventory/profile, bounded planning, explicit Send integration, durable streaming assistant partials, and explicit Continue for eligible interrupted planned-context turns are live. Completed generations start an engine-owned bounded change monitor: debounced metadata/content fingerprint checks provide prompt invalidation, periodic safe rescans remain authoritative, and the same transactional inventory/chunk/symbol/profile replacement advances generation. Ignore-policy changes are covered by the full safe reconciliation; root identity changes mark context stale and stop monitoring. Archive and rebind stop active workers. No plugin-side index, hidden provider call, embedding, tool authority, raw root response, or reliance on filesystem events is introduced. Every accepted planned-context turn persists its exact effective manifest and effective provider/model metadata before provider streaming. Continue reuses that manifest/model, validates project revision and lineage, allows one successor up to bounded depth, and sends bounded conversation plus partial suffix without adding a user message. ContextManifest schema version 2 owns `continuation_prefix`; persisted version 1 manifests fail closed with `manifest_migration_required` and are not reinterpreted. Old chats report unavailable evidence, chat deletion removes its records, and cache deletion/rebuild does not. The rebuildable cache remains local and unencrypted. |
| `project_command_center` | `live_host` | `apps/gui/src/ProjectRouterShell.tsx`, `apps/gui/src/components/ProjectHub.tsx`, `apps/gui/src/components/ProjectShell.tsx`, `apps/gui/src/components/CurrentWorkspaceDashboard.tsx` | `npm run smoke:project-command-center` | Browser and trusted hosted entry are live product paths. The smoke uses Demo Mode and is not real-provider or installed-IDE evidence. |
| `providers_auth` | `live_engine` | `apps/engine/src/providers.rs`, `apps/engine/src/provider_auth/`, `apps/engine/src/secret_store.rs`, `apps/gui/src/services/providersClient.ts` | `cargo test -p yet-lsp provider_auth`; `npm run smoke:local` | Provider CRUD/test and API-key custody are real. Codex-like account auth is explicit-risk, experimental, non-default, loopback/mock-automated, unofficial, and non-production. The mock OAuth harness itself is `fixture_demo`. |
| `provider_capability_metadata` | `fixture_demo` | `packages/contracts/examples/engine/`, `apps/gui/src/services/providerReadiness.ts`, test `capsResponse` builders | `npm run validate:contracts`; focused GUI tests | The live engine emits narrow configured readiness, but many controlled capability cards and richer provenance inputs used by GUI tests come from fixtures or mock caps. Missing live fields must not be inferred from fixtures. |
| `chat_sse_history` | `live_engine` | `apps/engine/src/chat.rs`, `apps/engine/src/chat_history.rs`, chat routes in `apps/engine/src/http/mod.rs` and `apps/engine/src/http/project.rs`, `apps/gui/src/services/runtimeClient.ts` | `cargo test -p yet-lsp chat`; `cargo test -p yet-lsp --test runtime`; `npm run smoke:local`; `npm run smoke:project-context-continue` | Local command, SSE, abort, engine-owned history, durable assistant partial updates, interrupted-terminal recovery, and explicit project-turn Continue are real. Reload converts abandoned streaming partials to interrupted state; Continue remains fail-closed and bounded rather than an automatic retry. The OpenAI-compatible parser has a known role-only-delta defect until T-159 lands; this status does not waive it. |
| `memory` | `live_engine` | `apps/engine/src/project_memory.rs`, project routes in `apps/engine/src/http/project.rs`, `apps/gui/src/services/projectMemoryClient.ts` | `cargo test -p yet-lsp project_memory`; `npm run smoke:project-command-center` | Project-scoped manual local note CRUD/search and explicit one-shot attachment are real under existing `/p/{projectId}/v1/memory*` routes. Notes remain config-owned durable user content, separate from the planned project-context cache, and cache rebuild/delete cannot change them. No semantic index, hidden workspace collection, automatic relevance search, or cloud sync is implemented. Older built-GUI memory smokes have route-bootstrap debt until the routing remediation wave. |
| `progress_endpoint` | `live_engine` | `apps/engine/src/agent_progress.rs`, `/agent-progress` routes in `apps/engine/src/http/mod.rs` and `apps/engine/src/http/project.rs` | `cargo test -p yet-lsp agent_progress`; `npm run smoke:agent-progress-endpoint` | Read/write metadata endpoints and project isolation are real. They observe sanitized events and do not execute work. |
| `progress_population` | `live_host` | `apps/gui/src/App.tsx`, `apps/gui/src/services/runtimeClient.ts`, `scripts/planner-agent-progress-state.mjs`, `scripts/planner-agent-progress-run.mjs` | focused GUI/runtime-client tests; `npm run check:agent-progress`; `npm run smoke:agent-progress` | Project-scoped VS Code controlled read, search, edit, multi-file, command-run, and verification-bundle requests/results publish bounded sanitized events only after explicit user action and matching `live_host` provenance. Scripts, smokes, and explicit developer calls also populate progress as `local_derived`. Normal chat publishes no progress, no producer supplies a complete autonomous-run lifecycle, Browser and JetBrains controlled execution remain unsupported, and an empty live panel is truthful. |
| `controlled_read` | `live_host` | `apps/plugins/vscode/src/controlledFileRead.ts`, dispatch in `apps/plugins/vscode/src/webview.ts` | `cd apps/plugins/vscode && npm test`; `npm run smoke:controlled-agent-vscode-task-e2e` | Real only as a bounded, explicit, VS Code dev-preview executor. Browser is unsupported; JetBrains controlled-agent read requests fail closed even though its separate active-file excerpt action exists. |
| `controlled_search` | `live_host` | `apps/plugins/vscode/src/controlledLexicalSearch.ts`, `apps/gui/src/services/controlledAgentLexicalSearch.ts` | `cd apps/plugins/vscode && npm test`; `npm run smoke:controlled-agent-real-lexical-search` | Explicit literal, path-bounded VS Code search is real. No hidden indexing, regex/glob authority, Browser execution, or JetBrains executor exists. |
| `controlled_edit` | `live_host` | `apps/plugins/vscode/src/controlledEdit.ts`, `apps/plugins/jetbrains/src/main/kotlin/ai/yet/plugin/bridge/ControlledIdeActions.kt`, GUI confirmed-edit review path | VS Code and JetBrains focused host tests; `npm run smoke:vscode-edit-proposal`; `npm run smoke:jetbrains-edit-proposal` | VS Code controlled replacement edit is real dev-preview behavior. JetBrains supports the separate confirmed-edit apply path but controlled-agent edit envelopes return blocked/disabled. Browser is preview-only. All apply remains explicit and bounded. |
| `controlled_multifile` | `live_host` | `apps/plugins/vscode/src/controlledMultifileEdit.ts`, dispatch in `apps/plugins/vscode/src/webview.ts` | `npm run smoke:controlled-agent-real-multifile-edit`; VS Code package tests | Real explicit VS Code bounded replacement executor. Browser and JetBrains fail closed. Patch-plan schemas and review UI alone are not executor evidence. |
| `controlled_verification_run` | `live_host` | `apps/plugins/vscode/src/controlledCommandRun.ts`, `apps/plugins/vscode/src/controlledVerificationBundle.ts` | `npm run smoke:controlled-agent-real-verification`; VS Code package tests | Fixed allowlisted command IDs run only after explicit confirmation in VS Code dev-preview. No free-form shell, package, git, provider, Browser, or JetBrains command authority follows. |
| `controlled_run_state` | `local_derived` | `apps/gui/src/services/controlledOneStepAgentLoop.ts`, `controlledAgentTwoStepRun.ts`, `controlledAgentProgressReport.ts`, related panels | Focused GUI tests and local controlled-agent smokes | Extensive local reducers and display state are real computations, but they are not an engine-owned autonomous runner and many inputs are fixture/caps supplied. No background autonomy or automatic orchestration is implemented. |
| `controlled_recovery` | `local_derived` | `apps/gui/src/services/controlledAgentRecoveryMatrix.ts`, `apps/gui/src/components/ControlledAgentRunPanel.tsx` | `npm run smoke:controlled-agent-recovery-matrix` | Recovery guidance is bounded display logic. It does not perform retry, repair, rollback, reconnect, or stale-result acceptance automatically. Contract fixtures remain `fixture_demo` evidence for states not produced live. |
| `controlled_transcript` | `fixture_demo` | `packages/contracts/schemas/engine/controlled-agent-workflow-transcript.schema.json`, examples, `scripts/smoke-controlled-agent-workflow-transcript.mjs` | `npm run smoke:controlled-agent-workflow-transcript` | Schema, fixtures, and validator exist; live transcript collection, storage, GUI export, runtime endpoint, and support upload are unsupported. |
| `lsp` | `live_engine` | `apps/engine/src/lsp.rs`, `apps/plugins/vscode/src/lspClient.ts` | `cargo test -p yet-lsp lsp`; `npm run smoke:lsp-stdio`; VS Code engine-connection tests | Engine stdio document lifecycle, deterministic local status completion/hover/symbols, and opt-in VS Code client are real read-only proofs. Provider-backed completion and diagnostics are unsupported; JetBrains has process foundation only, not a native client. |
| `packaging` | `local_derived` | `scripts/prepare-vscode-preview.mjs`, `scripts/prepare-jetbrains-preview.mjs`, plugin build/package definitions | `npm run smoke:vscode-installable`; `npm run smoke:jetbrains-installable`; artifact smokes | Local/CI dev-preview artifacts and archive checks are real build outputs. They are unsigned, unpublished, install-from-file evidence only—not marketplace, signing, notarization, updater, production installer, or release proof. |

## Host matrix

Each cell has one status for that host/capability intersection. A host can render a preview without owning execution; that remains `fixture_demo` or `unsupported`, not `live_host` execution.

| Surface | Browser | VS Code | JetBrains |
| --- | --- | --- | --- |
| Projects and Command Center | `live_host` — canonical `/projects` and project routes | `live_host` — trusted single-root binding and hosted dashboard | `live_host` — trusted binding/dashboard path; installed parity is less deeply evidenced |
| Provider setup and chat | `live_host` — existing loopback runtime only | `live_host` — plugin-owned runtime plus packaged GUI | `live_host` — plugin-owned runtime plus JCEF GUI |
| Project memory | `live_host` — manual notes and explicit one-shot attachment | `live_host` — packaged GUI over engine-owned project memory | `live_host` — packaged GUI over engine-owned project memory |
| Project context status/profile | `live_host` — GUI inspector renders live structural status/profile plus sanitized generation/reconciliation progress; lexical rows are not exposed or attached | `live_host` — packaged GUI uses the same engine path and wrapper-browser evidence; active editor context remains a separate explicit high-priority input | `live_host` — packaged GUI uses the same engine path and wrapper-browser evidence; active editor context remains a separate explicit high-priority input |
| Project context lexical/planner/manifest | `live_host` — bounded planner, reviewed manifest, Send integration, durable partial state, and explicit Continue use the engine path | `live_host` — packaged GUI uses the same engine path | `live_host` — packaged GUI uses the same engine path |
| Progress display | `live_host` — read-only endpoint rendering | `live_host` — read-only endpoint rendering | `live_host` — read-only endpoint rendering |
| Progress lifecycle population | `local_derived` — developer/script events only; normal chat emits none | `live_host` — explicit bounded controlled-host action events, plus `local_derived` developer/script events; no complete autonomous lifecycle | `local_derived` — developer/script events only; controlled executors are unsupported |
| Active editor context | `unsupported` — no trusted IDE context | `live_host` — bounded explicit context | `live_host` — bounded explicit context and active-file excerpt |
| Controlled read | `unsupported` | `live_host` — bounded executor | `unsupported` — controlled-agent envelope fails closed |
| Controlled lexical search | `unsupported` | `live_host` — bounded literal executor | `unsupported` |
| Confirmed single-file edit | `unsupported` — preview only | `live_host` — confirmed apply and controlled replacement paths | `live_host` — confirmed edit dev-preview only; controlled-agent envelope blocked |
| Controlled multi-file apply | `unsupported` | `live_host` — bounded explicit executor | `unsupported` |
| Controlled verification/run | `unsupported` | `live_host` — fixed allowlisted command IDs | `unsupported` |
| Controlled run UI | `local_derived` — reducers and previews | `local_derived` plus live executor results | `local_derived` with unsupported controlled executors |
| Controlled recovery UI | `local_derived` — display guidance | `local_derived` — display guidance over local and host results | `local_derived` — display guidance over fail-closed host results |
| Controlled transcript/export | `fixture_demo` — schema and smoke fixtures only | `fixture_demo` — schema and smoke fixtures only | `fixture_demo` — schema and smoke fixtures only |
| LSP client | `unsupported` | `live_host` — opt-in read-only client | `unsupported` — lifecycle foundation is not a native client |
| Installable packaging | `unsupported` | `local_derived` — unsigned dev-preview VSIX | `local_derived` — unsigned dev-preview ZIP |

## Evidence and claim rules

1. Inspect the authoritative product entrypoint before changing a status. Fixtures and docs are supporting context, never the sole proof of `live_engine` or `live_host`.
2. Name the boundary precisely. A live endpoint does not make its data automatically live-populated; a bridge type does not prove a host executor; a GUI reducer does not prove an engine runner.
3. Preserve qualifiers in every outward claim: experimental auth stays experimental, controlled execution stays dev-preview and explicit, and packaging stays unsigned/unpublished/non-production.
4. Treat `/v1/caps` fields conservatively. A field absent from the real engine response is not live merely because GUI fixtures provide it.
5. Update this ADR in the same card when code and focused tests genuinely move a row. Do not pre-promote a planned implementation.
6. Continue using ADR 040's implementation/evidence vocabulary for card and verification reports; this ADR's five statuses classify provenance, not whether a particular command was run.

## Non-goals

This decision adds no runtime behavior, capability endpoint, executor, progress hook, host authority, provider adapter, storage, packaging publication, production support, or release approval. It does not fix the known SSE, prompt-budget, routed-smoke, or JetBrains-test defects. It does not replace the detailed security and authority contracts.

The local-first BYOK and deny-by-default boundaries remain unchanged: no required hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace; raw provider secrets remain engine-owned; no hidden context, auto-send, autonomous apply, broad shell/git/tool authority, or Browser trusted execution is introduced.

## Verification

`scripts/check-agent-architecture-contract.mjs` enforces the canonical link, all required capability row IDs, all five statuses, and the host rows. Run:

```sh
node scripts/check-agent-architecture-contract.mjs --self-test
npm run check
git diff --check
```

This is `tier_0` documentation and validator evidence only. It does not execute or re-verify every capability listed above.

## Consequences

- Product and capability work has one conservative current-state source before code or claim changes.
- Fixture-driven caps, developer-populated progress, GUI-local reducers, real engine paths, and real host executors no longer share one vague “supported” bucket.
- Browser, VS Code, and JetBrains differences remain visible without erasing useful dev-preview behavior.
- Future provenance work can compute and display these statuses without inventing a second vocabulary. The truth matrix is a map, not a tiny paper engine wearing a convincing hat.
