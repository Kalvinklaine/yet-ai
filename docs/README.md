# Yet AI Documentation

This directory stores durable documentation for Yet AI architecture, decisions, and future implementation. Documentation should help agents make incremental changes while keeping Yet AI a standalone local-first product.

## Layout

```text
docs/
  README.md             # documentation index
  architecture/         # architecture baselines, decisions, contracts, roadmaps
```

Additional local evidence templates live under `docs/dogfood/`, including the real-provider active-file chat report, the manual real coding task dogfood checklist, the historical one-step Agent Run dogfood checklist, and the safe-share Agent Run one-step report template. The deterministic mock-only built-GUI validation for the safe-share Agent Run path is `npm run smoke:agent-run-dogfood`; it uses loopback-only runtime/host mocks and sanitized evidence, not real-provider CI. The inert multi-step Agent Run plan preview smoke is `npm run smoke:agent-run-multistep-plan`; it covers valid and rejected preview metadata with no automatic apply or verification bridge messages and no browser-storage leakage.

## Where to add documents

- `docs/architecture/` — add architecture decisions, subsystem boundaries, protocol contracts, storage rules, product-sensitive audits, release packaging decision records, roadmaps, implementation plans, and risks.
- `docs/dogfood/` — add sanitized manual local evidence templates and checklists for dogfood runs; keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized tracked example.
- Implementation notes — add them next to the future subsystem when it exists, or in `docs/architecture/` if the note affects multiple subsystems.
- Decisions — record them as separate numbered architecture documents when they affect layout, identity, public protocols, storage, packaging, licensing, or long-term maintenance.

## Current architecture documents

- `architecture/000-reference-architecture-baseline.md` — baseline subsystem boundaries for the standalone product.
- `architecture/001-product-identity.md` — explains `product/identity.json` and how to avoid scattered product-sensitive hardcodes.
- `architecture/002-product-differentiation-and-provenance.md` — identity, legal/provenance, publication safety, and differentiation audit.
- `architecture/003-target-architecture.md` — target Yet AI subsystem boundaries, HTTP/SSE/LSP/postMessage contracts, storage isolation, and roadmap.
- `architecture/004-implementation-strategy.md` — implementation strategy and staged local-first delivery guidance.
- `architecture/005-publication-hygiene.md` — rules for keeping public tracked files clean before publication.
- `architecture/006-login-based-gpt-first-message.md` — future mandatory login-based GPT first-message milestone, official/experimental path split, and required gates.
- `architecture/007-provider-auth-feasibility.md` — provider-auth feasibility decision for OpenAI account-login evaluation, blocking production/default login until an official provider-supported local-app flow is approved.
- `architecture/008-reference-divergence-guardrails.md` — public-safe guardrails for using reference implementations as architectural signal without copying identity, source, assets, or public wording.
- `architecture/009-runtime-lifecycle-roadmap.md` — runtime lifecycle ownership, metadata-only `host.runtimeStatus` diagnostics, IDE/browser parity matrix, and future daemon-lite decision criteria.
- `architecture/010-tool-authority-and-edit-pipeline-roadmap.md` — current safe-edit proposal baseline and future deny-by-default tool authority/edit-apply policy layers.
- `architecture/011-sandbox-agent-prerequisites.md` — conservative prerequisites for any future experimental sandbox-agent mode, including opt-in, checkpoints, rollback, limits, allowlisted verification, and no hidden reads or broad authority.
- `architecture/012-coding-session-trace.md` — GUI-local read-only coding-session trace model, event families, sanitization rules, in-memory scope, and non-authority boundaries.
  It also records the adjacent Sprint 41 experimental sandbox session metadata boundary: sanitized readiness/checkpoint/rollback status only, with no sandbox agent, bridge command, runtime endpoint, execution authority, or agent loop.
  It now also records the Sprint 42 bounded patch verification loop metadata boundary for one explicit user-confirmed apply plus one allowlisted verification command, with no autonomous loop or new execution surface.
  Sprint 43 deterministic local smoke coverage for the one-step Agent Run shell is available with `npm run smoke:agent-run-state`; it uses mock host events plus disposable checkpoint/patch helpers and must stay free of provider, IDE, network, shell, git, browser-storage, or hidden workspace-scan authority.
  Sprint 44 deterministic model-proposal coverage is available with `npm run smoke:model-proposal-agent-run`; it exercises the pure one-step prompt/proposal services with valid and rejected mock assistant responses, proves prompt explicit-context-only wording, strict safe-edit recognition, fail-closed malformed/unsafe proposal handling, sanitized repair guidance, no browser storage, and no auto apply or auto verification.
  Sprint 45 deterministic checkpoint-readiness coverage is available with `npm run smoke:agent-run-checkpoint-readiness`; it composes the model-proposal, real disposable checkpoint, readiness, bounded-loop, and Agent Run state services to prove verified checkpoint metadata can reach `ready_for_apply`, while missing or unverified checkpoint metadata remains prerequisites-blocked with no apply or verification.
  Sprint 46 deterministic explicit-apply coverage is available with `npm run smoke:agent-run-apply`; it exercises the pure Agent Run apply/state/report/trace services to prove verified readiness reaches `ready_for_apply`, no apply request is emitted before an explicit click, the click uses the existing `gui.applyWorkspaceEditRequest` bridge request, a mock host apply result reaches `ready_for_verification`, and rejected/failed apply results stop with rollback metadata and no automatic retry.
  Sprint 47 deterministic explicit-verification coverage is available with `npm run smoke:agent-run-verification`; it exercises the pure Agent Run verification/state/report/trace services to prove applied metadata reaches `ready_for_verification`, no verification request is emitted before an explicit click, the click uses the existing `gui.ideActionRequest` bridge request with `commandId` only, mock progress/result metadata reaches verified/completed report state, and failed verification stops without automatic repair while rollback remains user-review only when metadata exists.
  Sprint 48 built-GUI one-step Agent Run coverage is available with `npm run smoke:agent-run-e2e`; it builds and loads the GUI with mock runtime/provider/bridge/host data, drafts the one-step safe-edit prompt, sends only after manual Send, confirms no automatic apply or verification, then clicks explicit Apply and explicit allowlisted Verify before asserting a sanitized final report. It also covers failure paths for malformed proposal rejection with no apply, missing checkpoint prerequisites blocked with no apply, failed verification stopping without automatic repair, and stale assistant responses ignored after runtime/chat correlation changes.
  The Agent Run safety regression bundle is currently documented as a manual command sequence rather than a root npm script because the built-GUI E2E gate is slower and can fail independently of the pure safety regressions. Keep this bundle explicit and failure-preserving: it is a local/mock safety regression gate for Agent Run boundaries, not part of `npm run check`, and it must not be described as real-provider, production autonomy, marketplace, or hosted-service evidence.
  Sprint 49 final architecture status records the implemented Agent Run as dev-preview, manual-only, checkpoint-gated, and limited to existing bridge surfaces: explicit Apply through `gui.applyWorkspaceEditRequest` and explicit command-id-only Verify through `gui.ideActionRequest`. It remains non-autonomous and adds no hidden reads, new execution surface, shell/git/tool/provider-tool authority, browser-storage persistence, or production autonomy claim.
  The S49-C5 final product safety audit closes the S45-S49 trail with no blocking findings: App, AgentRunPanel, bridge guards, Agent Run services, bounded patch/evaluation, edit proposals, smokes, and docs preserve manual Send/Apply/Verify, GUI-owned or host-owned correlation, command-id-only verification, sanitized in-memory trace/report output, and local-first BYOK boundaries.

## Current login-first milestone status

The current milestone is local-first and conservative:

- API-key or project-key provider setup through the local runtime is the safe/default real-provider path.
- Demo Mode is a no-key local trial for chat UX with canned local responses only.
- The experimental Codex-like provider-auth path is high-risk, non-default, and mock-only in automation.
- Official production OpenAI/ChatGPT account login is not implemented, not approved, and not claimed as supported.
- Core chat, provider setup, IDE GUI workflows, and local storage must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.
- Native Ollama provider support is documented as direct local-engine access to the user's configured Ollama server at default `http://127.0.0.1:11434`, with auth type `none` and no Yet AI hosted service or provider secret requirement.
- Current IDE/plugin artifacts and smokes are dev-preview verification surfaces only; they do not imply marketplace publication, signing, notarization, installer readiness, or production release status.

## IDE surface capability matrix

This matrix summarizes current browser, VS Code, and JetBrains surfaces for local development and dev-preview evidence. It is intentionally conservative: supported means implemented for the bounded local-first flow described here, preview-only means visible or contract/smoke-covered but not production support, and deferred means not implemented as an active user feature. None of these surfaces require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production account login, marketplace publication, signing, or real provider credentials in automation.

| Capability | Browser / standalone GUI | VS Code | JetBrains |
| --- | --- | --- | --- |
| Active context | Preview-only mock/fallback rendering; no IDE workspace authority | Supported dev-preview via bounded `host.contextSnapshot`, opt-in, one-shot prompt context | Supported dev-preview via the same bounded `host.contextSnapshot`, opt-in, one-shot prompt context |
| Multi-file context | Preview-only explicit bundle UI; no hidden workspace reads | Supported dev-preview only through explicit user-selected active-file/snippet/memory/verification bundle items, capped and one-shot | Supported dev-preview only through the same explicit capped one-shot bundle path |
| Memory | Supported local GUI/runtime project-memory MVP; manual notes only, no browser storage persistence | Supported through GUI/runtime local memory flow; plugin does not store raw memory or secrets | Supported through GUI/runtime local memory flow; plugin does not store raw memory or secrets |
| Snippet search | Preview-only/non-executing in browser harnesses | Preview-only explicit literal `searchWorkspaceSnippets` contract/smoke path; no indexing, regex/glob/path input, or background scans | Preview-only explicit literal `searchWorkspaceSnippets` contract/smoke path with the same no-index/no-background-scan boundary |
| Safe edit apply | Preview-only review UI; browser never mutates files | Supported dev-preview confirmed apply path after GUI apply plus VS Code user confirmation; bounded text replacements in existing workspace-relative files only | Dev-preview confirmed apply path through existing apply/result bridge after GUI apply plus IDE/user confirmation; no production apply claim |
| Verification commands | Preview-only/non-executing; no shell authority | Preview-only allowlisted `runVerificationCommand` contract; explicit user confirmation, sanitized result tail, no free-form shell/args/cwd/env/git/network | Preview-only allowlisted `runVerificationCommand` contract with the same confirmation and sanitization limits |
| Controlled runner | Supported as a user-driven GUI smoke/flow only; no auto-send/apply/run | Supported dev-preview UI flow using explicit context, safe-edit, and verification controls; no autonomous execution | Supported dev-preview UI flow using the same explicit controls; no autonomous execution |
| LSP | Not applicable; browser has no editor LSP host | Preview-only off-by-default read-only MVP/status proof over `yet-lsp --lsp-stdio`; no provider-backed completions or diagnostics | Deferred/foundation only; native IntelliJ LSP client/editor wiring is not implemented or claimed |

Known limitations: real-provider use still requires user-supplied local credentials; account-login feasibility remains blocked until an official provider-supported local-app flow is documented and approved; the Codex-like path must not use real accounts in CI or smoke automation.

## Icon asset convention

The source icon asset is `assets/identity/yet-ai-icon.svg`; PNG derivatives live next to it. VS Code and JetBrains dev-preview plugin icons are derived copies under their plugin folders. The root `npm run check` bundle validates that these icon files exist, that SVG files remain self-contained with no scripts or remote image references, and that plugin copies match the source assets.

## Versioning policy follow-up

Current package and plugin versions remain static dev-preview values (`0.0.1` for VS Code and `0.1.0` for JetBrains). Do not bump them for routine dev-preview docs/assets changes. Before release automation or any production publication claim, add a single version source and an artifact manifest consistency check across generated plugin artifacts.

## Dev-preview packaging boundary

Current IDE artifacts are install-from-file dev-preview evidence only. Local `dist/plugins/vscode/*.vsix`, local `dist/plugins/jetbrains/*.zip`, CI downloadable artifacts, checksums, and manifests are unsigned and unpublished validation outputs. They prove local package layout, packaged GUI freshness, identity metadata, safe archive paths, and loopback/mock startup checks; they do not prove marketplace publication, signing, notarization, a production installer, an update channel, or production release readiness.

`npm run artifact:manifest` writes the bounded dev-preview provenance manifest at `dist/plugins/manifest.json`. That manifest records the source commit, generation timestamp, runner platform, plugin artifact paths and SHA-256 checksums, bundled engine binary name/path/SHA-256, and explicit `signed: false`, `published: false`, and `notarized: false` status. `npm run smoke:github-ide-artifacts` validates the embedded manifest after local GitHub artifact staging. These checks are deterministic/local and do not sign, notarize, publish, upload marketplace packages, call providers, or include secrets/private paths.

The bundled `yet-lsp` in those artifacts is a local Cargo build staged from the checkout or CI runner for dev-preview testing. It is not a signed or notarized production engine. Future production packaging decisions still need durable records for marketplace publisher/vendor IDs, signing and notarization, installer or archive format, platform engine matrix, update and rollback policy, artifact retention, release provenance/SBOM expectations, and manual release approval gates. Until those records are implemented and verified, docs should keep production release wording explicitly framed as dev-preview, not implemented, planned, or future decision work.

## Verification

Run the root validation command after documentation or identity changes:

```sh
npm run check
```

For the Sprint 41 sandbox checkpoint/rollback substrate, run the focused disposable-workspace smoke:

```sh
npm run smoke:sandbox-checkpoint
```

The smoke creates only a temporary workspace with the `.yet-ai-disposable-workspace.json` sentinel, checkpoints explicit relative files, mutates and restores them, checks exact byte equality, and verifies fail-closed handling for unsafe paths, symlinks, large files, execution-like metadata, and background scan requests. It is local/disposable evidence only: it does not launch an IDE, call providers or hosted services, execute shell/git/tool commands, use network access, scan a real workspace, or print raw file bodies/private temp roots.

For the Sprint 42 bounded patch verification loop contract and documentation slice, run:

```sh
npm run validate:contracts && npm run check && git diff --check
```

This validates only strict schemas, positive fixtures, invalid fixtures, documentation, and diff hygiene. It does not apply patches, run verification commands, add bridge messages, launch runtimes, or start an autonomous loop.

For the Sprint 42 disposable bounded patch/checkpoint substrate and GUI-visible lifecycle smoke, run:

```sh
npm run smoke:bounded-patch-loop
```

The smoke creates only a sentinel-marked temporary workspace, checkpoints explicit existing relative files, builds a replacement-only bounded patch plan, and models the user-visible bounded loop with in-memory mock browser/bridge/host state. It proves proposal visibility, blocked readiness before checkpoint/policy metadata, explicit user apply through the existing `gui.applyWorkspaceEditRequest`, mock `host.applyWorkspaceEditResult`, explicit allowlisted verification through existing `gui.ideActionRequest` with `action: "runVerificationCommand"` and `commandId` only, mock host progress/result, sanitized bounded-loop trace families, clean browser storage, no non-loopback network requests, and no auto-send, auto-apply, auto-run verification, or auto-rollback. It also applies/restores locally after checkpoint/hash preflight and verifies fail-closed handling for unsafe paths, symlinks, binary/oversized files, patch limits, create/delete/rename/move intents, execution-like metadata, unknown verification ids, and background scan requests. It is deterministic local/mock evidence only: it does not launch a real IDE, spawn shell commands, call git/network/provider APIs, scan a real workspace, execute verification commands, or print raw file bodies/private temp roots.

For the Sprint 44 model-driven one-step proposal path, run:

```sh
npm run smoke:model-proposal-agent-run
```

The smoke transpiles and imports the pure GUI services locally, drafts a one-step safe-edit prompt from explicit attached context only, feeds mock assistant safe-edit responses into proposal correlation, and evaluates Agent Run readiness metadata. It covers both a valid strict safe-edit proposal and malformed/unsafe proposal rejection with sanitized repair guidance. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, auto-apply edits, or auto-run verification.

For the Sprint 45 model proposal plus real checkpoint readiness path, run:

```sh
npm run smoke:agent-run-checkpoint-readiness
```

The smoke transpiles and imports the pure GUI services locally, drafts a one-step safe-edit prompt from explicit attached context only, feeds a mock safe-edit proposal through proposal correlation, creates and verifies a disposable checkpoint for an explicit relative file, composes readiness metadata, and evaluates the Agent Run state. It covers the verified-checkpoint success path through `ready_for_apply` and the missing/unverified checkpoint failure path through `prerequisites_blocked`. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, auto-apply edits, or auto-run verification.

For the Sprint 46 explicit Agent Run apply path, run:

```sh
npm run smoke:agent-run-apply
```

The smoke transpiles and imports the pure GUI services locally, starts from mock proposal plus verified checkpoint readiness metadata, proves `ready_for_apply`, proves no apply request is emitted before the explicit user click, sends exactly one existing `gui.applyWorkspaceEditRequest` bridge message on click, correlates the mock host apply result into `ready_for_verification`, and covers rejected/failed apply results as stopped with rollback metadata and no automatic retry. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, add a bridge message, leak raw command/path/secret output, auto-apply edits, auto-run verification, auto-retry, or auto-rollback.

For the Sprint 47 explicit Agent Run verification path, run:

```sh
npm run smoke:agent-run-verification
```

The smoke transpiles and imports the pure GUI services locally, starts from mock proposal plus applied Agent Run metadata, proves `ready_for_verification`, proves no verification request is emitted before the explicit user click, sends exactly one existing `gui.ideActionRequest` bridge message on click with only `{ action: "runVerificationCommand", commandId: "repository-check" }`, correlates mock progress and result metadata into verified/completed report state, and covers failed verification as stopped with no automatic repair while rollback remains user-review only when metadata exists. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, add a bridge message, leak raw command/path/secret output, auto-run verification, auto-repair, auto-retry, or auto-rollback.

For the Sprint 48 built-GUI one-step Agent Run E2E path, run:

```sh
npm run smoke:agent-run-e2e
```

The smoke builds the GUI, serves the built assets from loopback, and drives Playwright against deterministic mock runtime/SSE/provider/bridge/host data. It proves the manual one-step Agent Run journey at the rendered UI boundary: local goal entry, explicit context attachment, prompt draft, manual Send, no automatic apply or verification, explicit Apply through the existing reviewed edit bridge request, explicit allowlisted Verify through the existing `gui.ideActionRequest` with `commandId` only, sanitized final report rendering, malformed proposal rejection, missing checkpoint prerequisite blocking, failed verification stopping without repair, and stale assistant response rejection after correlation changes. It is mock/loopback-only evidence: it does not launch a real IDE, call providers or hosted Yet AI services, use real credentials, scan hidden workspace files, execute shell/git/tool endpoints, use non-loopback network, persist browser-storage secrets/context, auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, auto-rollback, or claim production autonomy.

Keep this smoke as an explicit verification gate rather than part of `npm run check` unless a future card approves browser/build smoke expansion for the default local validation bundle. It builds the GUI and launches Playwright, while `npm run check` remains the focused repository validation bundle for docs, identity, contracts, deterministic local validators, and safe self-tests that do not run browser or packaged IDE smoke gates.

For the S61 inert multi-step Agent Run plan preview path, run:

```sh
npm run smoke:agent-run-multistep-plan
```

The smoke builds the GUI, serves the built assets from loopback, and drives Playwright with deterministic mock runtime/SSE/provider/bridge data. It covers a valid `agent_run.multistep_plan` preview and an unsafe rejected preview, asserts the preview remains review-only metadata, checks no automatic `gui.applyWorkspaceEditRequest` or `runVerificationCommand` bridge messages are emitted before explicit user clicks, and verifies browser storage does not persist raw prompts, diffs, file bodies, secrets, commands, or private paths. It is mock/loopback-only evidence: it does not call real providers, launch real IDEs, require hosted services, run shell/git/tool actions through the product, or grant execution authority.

For the Sprint 49 Agent Run safety regression bundle, run:

```sh
npm run smoke:model-proposal-agent-run && \
npm run smoke:agent-run-checkpoint-readiness && \
npm run smoke:agent-run-apply && \
npm run smoke:agent-run-verification && \
npm run smoke:agent-run-built-gui-fixtures && \
npm run smoke:agent-run-e2e
```

The manual bundle intentionally uses shell `&&` semantics so the first failing safety smoke stops the run. It is local/mock-only and failure-preserving: it does not hide failures, launch a real IDE, call providers or hosted Yet AI services, use credentials, scan hidden workspace files, execute shell/git/tool endpoints, use non-loopback network, persist browser-storage secrets/context, auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, or auto-rollback.

The command runs the repository's local validation bundle: product identity, public hygiene, docs index coverage, IDE surface contract parity, docs validation, and focused self-tests/validators that are safe for the current checkout. It does not run the browser or packaged IDE smoke gates, call providers, require hosted Yet AI services, publish marketplace artifacts, or claim production release status.

### Sprint 10 verification matrix

| Area | Command | What it proves | Boundary |
| --- | --- | --- | --- |
| Repository docs, identity, hygiene, IDE surface validators | `npm run check` | Docs index validity, product identity, public hygiene, focused local validators | Local only; no provider calls, hosted Yet AI backend, publishing, signing, or release claim |
| Shared protocol contracts | `npm run validate:contracts` | Strict schemas and positive/invalid fixtures for engine, provider-auth, bridge, planner, and agent-progress boundaries | Contract validation only; no runtime provider login |
| Sandbox checkpoint smoke | `npm run smoke:sandbox-checkpoint` | Deterministic disposable-workspace checkpoint creation, exact-byte restore, fail-closed unsafe input cases, and sanitized metadata-only report boundaries | Local temp-dir only; no IDE launch, provider calls, hosted service, shell/git/tool execution, network, background scan, or raw file-body evidence |
| Rust provider-auth and chat regressions | `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat` | Engine-owned provider-auth state, sanitized responses, and chat behavior | Local tests; fake/mock credentials only |
| GUI app tests and build | `cd apps/gui && npm test -- App && npm run build` | Login-first/Demo/API-key fallback rendering and production web assets compile | GUI must not persist raw provider secrets or require hosted services |
| Login-first mock smoke | `npm run smoke:login-first-message` | API-key fallback precedence, mock provider-auth lifecycle, first canned message, sanitized evidence | Loopback/mock-only; no real OpenAI/ChatGPT account or provider call |
| Local provider first-message smoke | `npm run smoke:local-provider-first-message` | Native Ollama/local-provider setup becomes send-ready, sends one first message, streams a rendered assistant response, enforces runtime local auth, and checks sanitized evidence | Loopback/mock-only; no real Ollama, provider credentials, hosted Yet AI service, IDE launch, signing, publication, or non-loopback network |
| Demo Mode smoke | `npm run smoke:gui-demo-mode` | No-key local trial path and canned assistant response flow | Local canned responses only, not model quality or provider access |
| Project memory smoke | `npm run smoke:project-memory` | Manual local project memory create/list/search, explicit one-shot attach to chat, accepted-send clear, delete, browser-storage non-persistence, no hidden IDE workspace reads, and sanitized loopback/mock-provider boundaries | Local loopback runtime and one mock chat provider only; no workspace file reads, hosted Yet AI backend, cloud workspace, real provider call, or secret/private path evidence |
| Project memory v2 smoke | `npm run smoke:project-memory-v2` | Deterministic local project memory v2 curation/search/attach flow: create sanitized manual note, search, attach to the next message, send one prompt, assert memory context appears exactly once in the mock provider prompt, clear after accepted send, delete note, and check browser-storage cleanliness | Local loopback runtime and one mock chat provider only; no workspace indexing or hidden reads, no hosted Yet AI backend, cloud workspace, real provider call, non-loopback network, or secret/private path evidence |
| Task-linked memory contract | `npm run validate:contracts && npm run check && git diff --check` | Optional `taskLabel`, `sessionLabel`, and explicit `attachTraceLabel` metadata stays bounded, sanitized, and schema-owned for guided coding task display/linkage | Metadata only; no automatic memory attach, background indexing, hidden reads, raw prompts/provider responses, private paths, secrets, provider calls, or cloud workspace |
| Agent Run built-GUI fixture smoke | `npm run smoke:agent-run-built-gui-fixtures` | Reusable S48 fixture data for built-GUI one-step Agent Run smokes: mock runtime/provider readiness, explicit context, strict safe-edit assistant response, checkpoint metadata, bridge apply/progress/result, and sanitized evidence | Mock/loopback fixture data only; no non-loopback network, browser-storage persistence, shell/git/tool execution, hosted Yet AI backend, cloud workspace, real provider call, secrets, or private paths |
| Agent Run built-GUI E2E smoke | `npm run smoke:agent-run-e2e` | Deterministic built-GUI one-step Agent Run loop: local goal, one-step prompt draft, explicit context, manual Send, no auto apply/verify, explicit Apply, explicit allowlisted Verify, sanitized final report, malformed proposal rejection, missing checkpoint block, failed verification stop, and stale response ignore | Mock/loopback only; no auto-send/apply/run/repair, no browser-storage persistence, no non-loopback network, no shell/git/tool endpoints, no hosted Yet AI backend, no cloud workspace, no real provider call, and no secrets |
| Guided coding task smoke | `npm run smoke:guided-coding-task` | Deterministic built-GUI guided coding task loop with local goal draft, explicit mocked active context/snippet/memory attachments, one explicit mock send, safe edit proposal review, explicit apply result, explicit verification result attachment, and follow-up cue | Mock/loopback only; no auto-send/apply/run, browser-storage persistence, non-loopback network, shell/git/tool execution, hosted Yet AI backend, cloud workspace, real provider call, or secrets |
| Snippet search v2 smoke | `npm run smoke:snippet-search-v2` | Deterministic built-GUI explicit project-snippet flow: no auto-search while typing, one GUI-owned literal search request, bounded mock-host result selection, one-shot attach to Send, and post-send clear/no reuse | Mock/loopback only; no indexing, background reads, browser-storage persistence, non-loopback network, shell/git/tool endpoints, hosted Yet AI backend, cloud workspace, real provider call, or secrets |
| Verification loop v2 smoke | `npm run smoke:verification-loop` | Deterministic built-GUI edit→verify→follow-up loop with one explicit mock send, safe edit proposal review, explicit apply result, explicit allowlisted failed/succeeded verification progress/results, manual follow-up prompt draft, and explicit one-shot verification-output attachment | Mock/loopback only; no auto-send/apply/run/fix, no browser-storage persistence, no non-loopback network, no shell/git/tool endpoints, no hosted Yet AI backend, no cloud workspace, no real provider call, and no secrets |
| Controlled runner v2 smoke | `npm run smoke:controlled-runner-v2` | Deterministic built-GUI controlled runner manual lifecycle with local task goal, explicit active context/snippet/memory attachments, prompt draft, one explicit mock send, safe edit proposal review, explicit apply result, explicit verification result, manual follow-up draft, and explicit verification-output attachment | Mock/loopback only; no auto-send/apply/run, no browser-storage persistence, no non-loopback network, no shell/git/tool endpoints, no hosted Yet AI backend, no cloud workspace, no real provider call, and no secrets |
| Real coding task dogfood smoke | `npm run smoke:real-coding-task-dogfood` | Deterministic built-GUI dogfood UX loop with real-provider-like loopback readiness, local task goal, explicit mocked active context/snippet/memory attachments, drafted prompt, one manual mock send, one attached context bundle, and a mock coding answer | Mock/loopback only; no auto-send/apply/run, browser-storage memory/context/secret persistence, non-loopback network, shell/git/tool endpoint calls, hosted Yet AI backend, cloud workspace, real provider credentials, or real provider calls |
| Local runtime smoke | `npm run smoke:local` | Local chat/history/SSE loopback behavior and no-secret client-visible output | Loopback mocks only |
| IDE first-message smokes | `npm run smoke:vscode-first-message` and `npm run smoke:jetbrains-first-message` | Packaged GUI/IDE wrapper first-message behavior through local runtime paths | Dev-preview local smokes; no marketplace, signing, or production release claim |
| Engine LSP stdio smoke | `npm run smoke:lsp-stdio` | Spawned `yet-lsp --lsp-stdio` initializes, handles bounded editor-supplied `file://` document open/change/close, deterministic local completion/hover/document-symbol proofs, unsupported-method behavior, and shutdown | Local read-only engine smoke; no IDE launch, provider call, provider-backed completion, diagnostics, indexing, hosted service, or production support claim |
| VS Code read-only LSP proof | `cd apps/plugins/vscode && npm run compile && npm run check:engine-connection`; root `npm run smoke:lsp-stdio` | Off-by-default `yetai.lsp.enabled` client path, no-secret stdio process policy, bounded local `file` document sync, capability-gated completion/hover/document-symbol registration, and deterministic status proof | Opt-in dev MVP only; no AI completion, provider diagnostics, model calls on keystrokes, workspace mutation, or marketplace/release claim |
| JetBrains LSP feasibility/deferred outcome | `cd apps/plugins/jetbrains && gradle test --console=plain --tests "*JetBrainsLsp*"`; root `npm run smoke:lsp-stdio` | Default-disabled lifecycle/process/no-secret diagnostic guardrails plus documented T-15 blocked decision; native IntelliJ LSP client/editor wiring remains unimplemented until the platform dependency contract is proven | Feasibility and guardrails only; no JetBrains completion support, native client proof, provider-backed behavior, or production support claim |
| Release-candidate smoke | `npm run smoke:ide-release-candidate` | Aggregated engine LSP stdio smoke, installed-plugin/IDE visual, Demo coverage, and artifact gates without publishing | Verification surface only; does not publish, sign, notarize, upload marketplaces, launch real IDEs/JCEF automation, call providers, or create a release |
| Diff hygiene | `git diff --check` | No whitespace errors in tracked changes | Local git check |

For documentation-only login-first changes, run the focused acceptance gate:

```sh
npm run check && npm run validate:contracts && git diff --check
```

For the local IDE release-candidate smoke gate, run this root command:

```sh
npm run smoke:ide-release-candidate
```

The gate explicitly chains the local release-candidate subgates: repository contracts/checks, engine `yet-lsp --lsp-stdio` smoke coverage, GUI build plus packaged-GUI freshness, VS Code and JetBrains dev-preview preparation, plugin layout checks, VS Code and JetBrains installable artifact checks, VS Code and JetBrains first-message wrapper smokes, installed-plugin visual coverage, installed-plugin Demo Mode first-message coverage, login-first mock provider-auth first-message coverage, local runtime/chat/provider smoke, JetBrains bundled runtime startup, GitHub artifact staging/manifest validation, dogfood report safety checks, public artifact summary, and clean tracked git status. The LSP coverage in this gate is the spawned engine stdio smoke only: VS Code remains an off-by-default read-only MVP/status proof, and JetBrains remains a default-disabled lifecycle feasibility boundary with native IntelliJ LSP client/editor wiring deferred by the T-15 blocked decision. It is intentionally local/mock-only: it does not use real provider credentials, call OpenAI/ChatGPT or other providers, contact hosted Yet AI services, require a Yet AI account/cloud workspace/managed gateway/product credits, launch real IDEs/JCEF automation, sign, publish, upload marketplace packages, or create a production release. Failure and skip diagnostics should stay bounded and sanitized: no runtime/provider tokens, private paths beyond redacted diagnostics, request bodies, cookies, auth codes, raw provider responses, or raw document bodies.

For installed-plugin Demo Mode first-message coverage, run `npm run smoke:installed-plugin-demo-mode` from the root after preparing current packaged GUI assets. It orchestrates the VS Code and JetBrains wrapper-browser smokes with `--demo-mode-first-message` and is included in `npm run smoke:ide-release-candidate` after installed-plugin visual coverage. Demo Mode is runtime-owned no-key canned local response coverage for chat UX only, not model quality; it is local/mock-only, uses no provider credentials, makes no OpenAI/ChatGPT or other provider calls, contacts no hosted Yet AI services, performs no real IDE/JCEF automation, and does not sign, publish, or create a release.

For the login-based GPT first-message milestone foundation, run `cd apps/gui && npm run build` and then `npm run smoke:login-first-message` from the root. This is a bounded mock-only GUI/browser smoke against a loopback runtime stub: it exercises the experimental/non-default provider-auth lifecycle (`login_available` → `pending` → `connected`), preserves the API-key fallback copy, sends one first message through a canned local chat path, and writes sanitized visual evidence. It does not use real provider credentials, OpenAI/ChatGPT calls, hosted Yet AI services, real IDE/JCEF automation, signing, publishing, release flows, or production/default account-login enablement.

### Safe IDE dogfood reports

Use `npm run dogfood:ide-report -- --template` for local safe-share installed first-message reports, especially VS Code dogfood runs. The template/checker records artifact/checksum, launch mode, runtime status, provider path, first-message result, and second-message refresh result while excluding provider API keys, runtime tokens, auth headers/codes, secret URL query or fragment values, private absolute paths, raw provider responses, and bridge payload dumps. Keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized excerpt in tracked docs.

Use `npm run dogfood:real-provider-report -- --template` for manual real BYOK active-file coding chat evidence. Validate any completed local report with `npm run dogfood:real-provider-report -- --check path/to/local-report.md` before sharing. This helper is a sanitizer/template checker only: it does not call providers, launch runtimes, use real credentials, create CI evidence, or prove production release readiness. The checklist records commit/artifact, runtime launch mode, IDE/browser surface, non-secret provider/model ID, active-file excerpt attached/omitted status, first streaming answer result, no-secret checks, and known issues.

Use `docs/dogfood/real-coding-task.md` for manual guided coding task dogfood runs with a real local BYOK provider or local model runtime. The path requires a connected local runtime, locally configured/tested provider, drafted task goal, explicit context/snippet/memory attachments, reviewed prompt draft, manual Send click, and reviewed response. Its report template is sanitized: provider kind and non-secret model family/id only, no API keys or tokens, no production/default account login, no raw private paths, no raw prompts/provider responses, and no raw file bodies except bounded reviewed excerpts. This is manual local dogfood only; guided coding task CI remains mock/loopback-only and must not use real providers, hosted Yet AI services, cloud workspaces, production logins, publishing, signing, or release workflows.

Use `docs/dogfood/agent-run-one-step.md` for the current safe-share manual one-step Agent Run dogfood report with a real local BYOK provider or local model runtime. The template records commit or artifact, artifact checksums when applicable, host/browser surface, redacted provider kind, non-secret model label, explicit context attached or omitted, prompt reviewed before manual Send, model safe-edit proposal detection or rejection, checkpoint readiness, explicit Apply, explicit Verification, screenshot evidence paths, result summary, failure states, and follow-up issues. It forbids raw API keys, bearer tokens, cookies, auth codes, prompt dumps, raw file bodies, raw diffs or patch bodies, raw provider responses, private paths, command strings, cwd/env values, browser-storage dumps, bridge payload dumps, and full verification output. This is local-first safe-share evidence only; it must not require hosted Yet AI services, cloud workspaces, production logins, managed gateways, product credits, real-provider CI, publishing, signing, release workflows, or any production autonomy claim. The older `docs/dogfood/one-step-agent-run.md` remains available as the historical S49 checklist.

### Chat response refresh verification bundle

For local chat response refresh fixes, run this existing-command bundle from a clean checkout with Node, Rust, and GUI dependencies installed. The bundle stays local/mock-only and does not add a new build or smoke command:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p yet-lsp
cd apps/gui && npm test -- chatViewState App && npm run build
cd ../..
npm run smoke:gui-demo-mode
npm run smoke:gui-runtime-e2e
npm run smoke:gui-conversation-history
npm run prepare:vscode-preview
npm run smoke:vscode-first-message
npm run prepare:jetbrains-preview
npm run smoke:jetbrains-first-message
npm run check
```

Use the focused GUI test filter above for the chat view reducer and `App` refresh behavior, then keep the browser/runtime, conversation history, and packaged first-message smokes in the same local pass before the final docs/identity check.

For GitHub issue #2's bounded visual GUI acceptance only, run `cd apps/gui && npm run build && cd ../.. && npm run smoke:gui-visual`. It reuses the local Demo Mode browser flow, sends two canned messages through loopback/mock runtime only, checks the immediate assistant responses, duplicate assistant bubble guard, and readable active conversation list text, then writes sanitized screenshot/DOM evidence under ignored `dist/visual-smoke/gui-demo-mode/`. This is not the default sprint checklist.

For the S25 guided coding task smoke, run `npm run smoke:guided-coding-task` from the repository root. It builds the GUI and uses deterministic Playwright mocks for the loopback runtime and IDE bridge to exercise the local coding task session panel, explicit context/memory/snippet attachment, one explicit mock send, safe edit proposal review, explicit apply result, and explicit verification result follow-up cue. It is mock-only and asserts no auto-send/apply/run, no browser-storage memory/secret persistence, no non-loopback network, and no shell/git/tool execution.

For the S26 mock real coding task dogfood smoke, run `npm run smoke:real-coding-task-dogfood` from the repository root. It builds the GUI and uses deterministic Playwright mocks for real-provider-like loopback readiness, local task-goal drafting, explicit active file/snippet/memory attachments, one manual Send click, one context bundle, and a mock coding answer. It is CI-safe and mock-only: no real provider credentials/calls, no auto-send/apply/run, no browser-storage memory/context/secret persistence, no non-loopback network, and no shell/git/tool endpoint calls.

For the S27 patch proposal quality smoke, run `npm run smoke:patch-proposal-quality` from the repository root. It builds the GUI and uses deterministic Playwright mocks for a loopback runtime/provider plus a mock VS Code bridge to exercise one fenced JSON safe edit proposal, exactly one extracted proposal, the quality summary/risk panel, browser preview-only behavior, explicit apply clicks, and applied/rejected host results. It is CI-safe and mock-only: no real provider credentials/calls, no auto-apply, no shell/git/tool or verification bridge actions, no non-loopback network, and no browser-storage proposal/secret persistence.

For the S28 verification loop v2 smoke, run `npm run smoke:verification-loop` from the repository root. It builds the GUI and uses deterministic Playwright mocks for a loopback runtime/provider plus a mock VS Code bridge to exercise one explicit mock send, safe edit proposal review, explicit apply, explicit allowlisted failed and succeeded verification progress/results, manual follow-up prompt drafting, and explicit verification-output attachment. It is CI-safe and mock-only: no real provider credentials/calls, no auto-send/apply/run/fix, no shell/git/tool endpoints, no non-loopback network, and no browser-storage proposal/output/secret persistence.

For the S30 controlled runner v2 smoke, run `npm run smoke:controlled-runner-v2` from the repository root. It builds the GUI and uses deterministic Playwright mocks for a loopback runtime/provider plus a mock VS Code bridge to exercise the manual controlled-runner lifecycle: local task goal, explicit active context/snippet/memory attachment, prompt draft, one manual Send click, safe edit proposal review, explicit apply, explicit verification, manual follow-up prompt drafting, and explicit verification-output attachment. It is CI-safe and mock-only: no real provider credentials/calls, no auto-send/apply/run, no shell/git/tool endpoints, no non-loopback network, and no browser-storage goal/context/memory/output/secret persistence.

This bundle is specific to chat response refresh, SSE, history, and packaged first-message regressions. It is not the default sprint checklist for unrelated roadmap work. Normal docs changes use `npm run check`; product/code changes should use focused subsystem gates and add smoke only for changed user journeys or recently fixed regressions.

## Documentation rules

- Write in Russian or bilingual style when useful; keep technical identifiers in English.
- Do not claim that implementation exists before code and verification exist.
- Mention assumptions and unknowns explicitly.
- Keep product identity references aligned with `product/identity.json`; temporary placeholders are allowed until final IDs, publishers, and domains are approved.
- Keep public tracked docs free of external project identifiers. Store private local reference notes only in ignored local files such as `AGENTS.local.md`, `.local/`, or `.agent-local/`.
- If future tasks approve third-party code or assets, document license and attribution requirements plus provenance before or alongside the copy.
- Update this index when a new documentation section or convention is introduced.
